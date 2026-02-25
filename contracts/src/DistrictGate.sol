// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "./DistrictRegistry.sol";
import "./NullifierRegistry.sol";
import "./VerifierRegistry.sol";
import "./CampaignRegistry.sol";
import "./UserRootRegistry.sol";
import "./CellMapRegistry.sol";
import "./EngagementRootRegistry.sol";
import "./TimelockGovernance.sol";
import "openzeppelin/utils/cryptography/ECDSA.sol";
import "openzeppelin/security/Pausable.sol";
import "openzeppelin/security/ReentrancyGuard.sol";

/// @title DistrictGate
/// @notice Multi-depth verifier orchestration for international district support
/// @dev Routes verification to depth-specific verifiers (18, 20, 22, 24)
///
/// ARCHITECTURE:
/// 1. Proof submitted with districtRoot
/// 2. Look up depth from DistrictRegistry
/// 3. Route to appropriate verifier from VerifierRegistry
/// 4. Verify ZK proof with depth-specific verifier
/// 5. Record nullifier and emit event
///
/// DEPTH ROUTING (International Coverage):
/// - Depth 18: Small countries (262K addresses, K=16 circuit, ~22KB verifier)
/// - Depth 20: Medium countries (1M addresses, K=18 circuit, ~26KB verifier)
/// - Depth 22: Large countries (4M addresses, K=20 circuit, split deployment)
/// - Depth 24: Very large (16M addresses, K=22 circuit, split deployment)
///
/// MULTI-DISTRICT REGISTRATION MODEL (24 District Slots):
/// Users can be registered in up to 24 district types (federal, state, county, city, etc.):
/// - Slots 0-19: 20 defined district types
/// - Slots 20-21: Administrative (Township, Voting Precinct)
/// - Slots 22-23: Overflow slots for rare/regional districts (water districts, etc.)
///
/// PROOF MODELS (path-dependent):
/// - Three-tree path (verifyThreeTreeProof) [PRIMARY]: All 24 district slots
///   revealed plus engagement_root and engagement_tier (31 public inputs).
///   This is the canonical verification path for new integrations.
/// - Two-tree path (verifyTwoTreeProof) [DEPRECATED]: All 24 district slots are
///   revealed as public inputs (29 total). Superseded by three-tree path.
/// - Legacy path (verifyAndAuthorizeWithSignature) [DEPRECATED]: Single-district
///   proof model. Each ZK proof proves membership in exactly ONE district.
///
/// GAS COSTS (measured on Scroll Sepolia, 2026-02-20):
/// - Single three-tree proof (31 public inputs): ~2.2M gas [PRIMARY]
/// - Single two-tree proof (29 public inputs): ~2.2M gas [DEPRECATED]
/// - See docs/DOCUMENTATION-COHERENCE-AUDIT.md Section 1 for cost projections
///
/// VERIFICATION PATHS:
/// 1. verifyThreeTreeProof()   — 31 public inputs [PRIMARY]
///                                (user_root, cell_map_root, districts[24], nullifier,
///                                action_domain, authority_level, engagement_root, engagement_tier)
/// 2. verifyTwoTreeProof()     — 29 public inputs [DEPRECATED — use verifyThreeTreeProof]
/// 3. verifyAndAuthorizeWithSignature() — Legacy single-tree path (5 inputs) [DEPRECATED]
///
/// DEPTH ROUTING:
/// - Verifiers registered per depth (18/20/22/24) via VerifierRegistry
/// - Separate two-tree and three-tree verifier mappings
/// - Gradual migration: old districts (depth 12) → new districts (depth 18-24)
///
/// UPGRADE PATH:
/// - Add new depths via VerifierRegistry (14-day timelock)
/// - Register new districts with depth via DistrictRegistry (7-day timelock)
/// - No changes to this contract required
contract DistrictGate is Pausable, ReentrancyGuard, TimelockGovernance {
    /// @notice Maximum district types a user can be registered in (20 defined + 4 overflow)
    /// @dev Two-tree and three-tree proofs reveal ALL 24 slots as public inputs.
    ///      Legacy single-tree proofs prove one district per proof.
    ///      Slots 0-19: Defined types, Slots 20-21: Administrative, Slots 22-23: Overflow
    uint8 public constant MAX_DISTRICT_SLOTS = 24;

    /// @notice Verifier registry (depth → verifier address)
    VerifierRegistry public immutable verifierRegistry;

    /// @notice District registry (root → country + depth)
    DistrictRegistry public immutable districtRegistry;

    /// @notice Nullifier registry (prevents double-voting)
    NullifierRegistry public immutable nullifierRegistry;

    /// @notice User root registry (Tree 1 - user identity roots)
    UserRootRegistry public userRootRegistry;

    /// @notice Cell map registry (Tree 2 - cell-district mapping roots)
    CellMapRegistry public cellMapRegistry;

    /// @notice Engagement root registry (Tree 3 - engagement data roots)
    EngagementRootRegistry public engagementRootRegistry;

    /// @notice Campaign registry (optional, can be zero)
    CampaignRegistry public campaignRegistry;

    /// @notice Timelock delay for campaign registry changes (7 days, same as district registration)
    uint256 public constant CAMPAIGN_REGISTRY_TIMELOCK = 7 days;

    /// @notice Proposed campaign registry address (zero if no proposal pending)
    address public pendingCampaignRegistry;

    /// @notice Timestamp after which the pending campaign registry change can execute
    uint256 public pendingCampaignRegistryExecuteTime;

    /// @notice Allowed action domains (governance-controlled whitelist)
    /// @dev SA-001 FIX: Prevents users from generating fresh nullifiers with arbitrary actionDomains
    mapping(bytes32 => bool) public allowedActionDomains;

    /// @notice Timelock for action domain registration (7 days)
    uint256 public constant ACTION_DOMAIN_TIMELOCK = 7 days;

    /// @notice Pending action domain registrations (actionDomain => executeTime)
    mapping(bytes32 => uint256) public pendingActionDomains;

    /// @notice Minimum authority level required per action domain (0 = no enforcement)
    /// @dev Wave 14d: Prevents low-authority proofs from being accepted for sensitive domains
    mapping(bytes32 => uint8) public actionDomainMinAuthority;

    /// @notice Timelock for authority level increases (24 hours)
    /// @dev Increases are timelocked to prevent front-running user proofs.
    ///      Decreases take effect immediately (only relaxes requirements).
    uint256 public constant MIN_AUTHORITY_INCREASE_TIMELOCK = 24 hours;

    /// @notice Pending authority level increases (actionDomain => proposed minLevel)
    mapping(bytes32 => uint8) public pendingMinAuthority;

    /// @notice Timestamp when pending authority increase can execute
    mapping(bytes32 => uint256) public pendingMinAuthorityExecuteTime;

    // ============================================================================
    // Derived Domain Authorization
    // ============================================================================

    /// @notice Contracts authorized to register derived action domains without timelock
    /// @dev Derived domains inherit authorization from registered base domains.
    ///      Authorized derivers can ONLY register domains when the base domain is
    ///      already in allowedActionDomains. Authorizing a deriver requires 7-day timelock.
    mapping(address => bool) public authorizedDerivers;

    /// @notice Pending deriver authorization (deriver => execute timestamp)
    mapping(address => uint256) public pendingDeriverAuthorization;

    /// @notice Pending deriver revocation (deriver => execute timestamp)
    mapping(address => uint256) public pendingDeriverRevocation;

    /// @notice Tracks which base domain a derived domain was derived from
    /// @dev For auditability and governance traceability. Zero means not a derived domain.
    mapping(bytes32 => bytes32) public derivedDomainBase;

    /// @notice EIP-712 domain separator
    bytes32 public immutable DOMAIN_SEPARATOR;

    /// @notice EIP-712 typehash for single-tree proof submission
    bytes32 public constant SUBMIT_PROOF_TYPEHASH = keccak256(
        "SubmitProof(bytes32 proofHash,bytes32 districtRoot,bytes32 nullifier,bytes32 authorityLevel,bytes32 actionDomain,bytes32 districtId,bytes3 country,uint256 nonce,uint256 deadline)"
    );

    /// @notice EIP-712 typehash for two-tree proof submission
    /// @dev DEPRECATED: Use SUBMIT_THREE_TREE_PROOF_TYPEHASH for new integrations.
    bytes32 public constant SUBMIT_TWO_TREE_PROOF_TYPEHASH = keccak256(
        "SubmitTwoTreeProof(bytes32 proofHash,bytes32 publicInputsHash,uint8 verifierDepth,uint256 nonce,uint256 deadline)"
    );

    /// @notice Nonces for replay protection
    mapping(address => uint256) public nonces;

    /// @notice Whether genesis phase is complete
    /// @dev Once sealed, campaign registry, action domain, and two-tree registry
    ///      changes all require their respective timelock paths.
    bool public genesisSealed;

    // Events
    event GenesisSealed();
    event CampaignRegistrySetGenesis(address indexed registry);
    event ActionDomainActivatedGenesis(bytes32 indexed actionDomain);
    event TwoTreeRegistriesSetGenesis(address userRootRegistry, address cellMapRegistry);

    event ActionVerified(
        address indexed user,
        address indexed submitter,
        bytes32 indexed districtRoot,
        bytes3 country,
        uint8 depth,
        bytes32 nullifier,
        bytes32 authorityLevel,
        bytes32 actionDomain,
        bytes32 districtId
    );

    event CampaignRegistrySet(address indexed previousRegistry, address indexed newRegistry);
    event CampaignRegistryChangeProposed(address indexed proposed, uint256 executeTime);
    event CampaignRegistryChangeCancelled(address indexed proposed);
    event ContractPaused(address indexed governance);
    event ContractUnpaused(address indexed governance);
    event ActionDomainProposed(bytes32 indexed actionDomain, uint256 executeTime);
    event ActionDomainActivated(bytes32 indexed actionDomain);
    event ActionDomainRevoked(bytes32 indexed actionDomain);
    event ActionDomainMinAuthoritySet(bytes32 indexed actionDomain, uint8 minLevel);
    event MinAuthorityIncreaseProposed(bytes32 indexed actionDomain, uint8 proposedLevel, uint256 executeTime);

    // Derived domain events
    event DeriverAuthorizedGenesis(address indexed deriver);
    event DeriverAuthorizationProposed(address indexed deriver, uint256 executeTime);
    event DeriverAuthorized(address indexed deriver);
    event DeriverAuthorizationCancelled(address indexed deriver);
    event DeriverRevocationProposed(address indexed deriver, uint256 executeTime);
    event DeriverRevoked(address indexed deriver);
    event DeriverRevocationCancelled(address indexed deriver);
    event DerivedDomainRegistered(bytes32 indexed baseDomain, bytes32 indexed derivedDomain, address indexed deriver);

    // Errors
    error VerificationFailed();
    error UnauthorizedDistrict();
    error DistrictNotRegistered();
    error DistrictRootNotActive();
    error VerifierNotFound();
    error InvalidSignature();
    error SignatureExpired();
    error InvalidPublicInputCount();
    error CampaignRegistryChangeNotProposed();
    error CampaignRegistryTimelockNotExpired();
    error ActionDomainNotAllowed();
    error ActionDomainNotPending();
    error ActionDomainTimelockNotExpired();
    error OperationAlreadyPending();
    error InsufficientAuthority(uint8 submitted, uint8 required);
    error GenesisAlreadySealed();

    // Derived domain errors
    error DeriverNotAuthorized();
    error DeriverAlreadyAuthorized();
    error DeriverAuthorizationNotPending();
    error DeriverAuthorizationAlreadyPending();
    error DeriverRevocationNotPending();
    error DeriverRevocationAlreadyPending();
    error BaseDomainNotAllowed();
    error DerivedDomainAlreadyRegistered();

    /// @notice Number of public inputs for two-tree proofs
    /// @dev DEPRECATED: Use THREE_TREE_PUBLIC_INPUT_COUNT for new integrations.
    ///      [0] user_root, [1] cell_map_root, [2-25] districts[24],
    ///      [26] nullifier, [27] action_domain, [28] authority_level
    uint256 public constant TWO_TREE_PUBLIC_INPUT_COUNT = 29;

    /// @notice Number of public inputs for three-tree proofs
    /// @dev [0] user_root, [1] cell_map_root, [2-25] districts[24],
    ///      [26] nullifier, [27] action_domain, [28] authority_level,
    ///      [29] engagement_root, [30] engagement_tier
    uint256 public constant THREE_TREE_PUBLIC_INPUT_COUNT = 31;

    /// @notice EIP-712 typehash for three-tree proof submission
    bytes32 public constant SUBMIT_THREE_TREE_PROOF_TYPEHASH = keccak256(
        "SubmitThreeTreeProof(bytes32 proofHash,bytes32 publicInputsHash,uint8 verifierDepth,uint256 nonce,uint256 deadline)"
    );

    // Two-tree events
    event TwoTreeProofVerified(
        address indexed signer,
        address indexed submitter,
        bytes32 indexed userRoot,
        bytes32 cellMapRoot,
        bytes32 nullifier,
        bytes32 actionDomain,
        bytes32 authorityLevel,
        uint8 verifierDepth
    );

    // Two-tree errors
    error InvalidUserRoot();
    error InvalidCellMapRoot();
    error InvalidTwoTreePublicInputCount();
    error TwoTreeVerificationFailed();
    error CountryMismatch();
    error DepthMismatch();

    // Three-tree events
    event ThreeTreeProofVerified(
        address indexed signer,
        address indexed submitter,
        bytes32 indexed userRoot,
        bytes32 cellMapRoot,
        bytes32 engagementRoot,
        bytes32 nullifier,
        bytes32 actionDomain,
        bytes32 authorityLevel,
        uint8 engagementTier,
        uint8 verifierDepth
    );

    event EngagementRegistrySetGenesis(address indexed engagementRootRegistry);
    event EngagementRegistryProposed(address indexed proposed, uint256 executeTime);
    event EngagementRegistrySet(address indexed previousRegistry, address indexed newRegistry);
    event EngagementRegistryCancelled(address indexed proposed);

    // Three-tree errors
    error InvalidEngagementRoot();
    error InvalidEngagementTier();
    error ThreeTreeVerificationFailed();
    error ThreeTreeVerifierNotFound();
    error EngagementRegistryNotProposed();
    error EngagementRegistryTimelockNotExpired();

    /// @notice Deploy multi-depth gate
    /// @param _verifierRegistry Address of VerifierRegistry
    /// @param _districtRegistry Address of DistrictRegistry
    /// @param _nullifierRegistry Address of NullifierRegistry
    /// @param _governance Governance address
    constructor(
        address _verifierRegistry,
        address _districtRegistry,
        address _nullifierRegistry,
        address _governance
    ) {
        if (_verifierRegistry == address(0)) revert ZeroAddress();
        if (_districtRegistry == address(0)) revert ZeroAddress();
        if (_nullifierRegistry == address(0)) revert ZeroAddress();

        _initializeGovernance(_governance);

        verifierRegistry = VerifierRegistry(_verifierRegistry);
        districtRegistry = DistrictRegistry(_districtRegistry);
        nullifierRegistry = NullifierRegistry(_nullifierRegistry);

        // Two-tree registries default to address(0)
        // Configure via proposeTwoTreeRegistries() after deployment

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("DistrictGate")),
                keccak256(bytes("1")), // Version 1: Multi-depth support
                block.chainid,
                address(this)
            )
        );
    }

    // ============================================================================
    // Genesis Configuration (no timelock — deployer IS governance)
    // ============================================================================

    /// @notice Set campaign registry directly during genesis phase
    /// @param _campaignRegistry Address of CampaignRegistry contract
    /// @dev Only available before sealGenesis(). Bypasses 7-day timelock.
    function setCampaignRegistryGenesis(address _campaignRegistry) external onlyGovernance {
        if (genesisSealed) revert GenesisAlreadySealed();

        address previous = address(campaignRegistry);
        campaignRegistry = CampaignRegistry(_campaignRegistry);

        emit CampaignRegistrySetGenesis(_campaignRegistry);
        emit CampaignRegistrySet(previous, _campaignRegistry);
    }

    /// @notice Register an action domain directly during genesis phase
    /// @param actionDomain Action domain to whitelist
    /// @dev Only available before sealGenesis(). Bypasses 7-day timelock.
    function registerActionDomainGenesis(bytes32 actionDomain) external onlyGovernance {
        if (genesisSealed) revert GenesisAlreadySealed();

        allowedActionDomains[actionDomain] = true;

        emit ActionDomainActivatedGenesis(actionDomain);
        emit ActionDomainActivated(actionDomain);
    }

    /// @notice Authorize a derived-domain deriver during genesis phase
    /// @param deriver Contract address to authorize (e.g., DebateMarket)
    /// @dev Only available before sealGenesis(). Bypasses 7-day timelock.
    function authorizeDeriverGenesis(address deriver) external onlyGovernance {
        if (genesisSealed) revert GenesisAlreadySealed();
        if (deriver == address(0)) revert ZeroAddress();
        if (authorizedDerivers[deriver]) revert DeriverAlreadyAuthorized();

        authorizedDerivers[deriver] = true;

        emit DeriverAuthorizedGenesis(deriver);
        emit DeriverAuthorized(deriver);
    }

    /// @notice Set two-tree registries directly during genesis phase
    /// @dev DEPRECATED: Use setEngagementRegistryGenesis for three-tree path. Shared registries
    ///      (UserRootRegistry, CellMapRegistry) are still configured here.
    /// @param _userRootRegistry Address of UserRootRegistry
    /// @param _cellMapRegistry Address of CellMapRegistry
    /// @dev Only available before sealGenesis(). Bypasses 7-day timelock.
    function setTwoTreeRegistriesGenesis(
        address _userRootRegistry,
        address _cellMapRegistry
    ) external onlyGovernance {
        if (genesisSealed) revert GenesisAlreadySealed();
        if (_userRootRegistry == address(0)) revert ZeroAddress();
        if (_cellMapRegistry == address(0)) revert ZeroAddress();

        userRootRegistry = UserRootRegistry(_userRootRegistry);
        cellMapRegistry = CellMapRegistry(_cellMapRegistry);

        emit TwoTreeRegistriesSetGenesis(_userRootRegistry, _cellMapRegistry);
        emit TwoTreeRegistriesSet(_userRootRegistry, _cellMapRegistry);
    }

    /// @notice Set engagement root registry directly during genesis phase
    /// @param _engagementRootRegistry Address of EngagementRootRegistry
    /// @dev Only available before sealGenesis(). Bypasses 7-day timelock.
    function setEngagementRegistryGenesis(
        address _engagementRootRegistry
    ) external onlyGovernance {
        if (genesisSealed) revert GenesisAlreadySealed();
        if (_engagementRootRegistry == address(0)) revert ZeroAddress();

        engagementRootRegistry = EngagementRootRegistry(_engagementRootRegistry);

        emit EngagementRegistrySetGenesis(_engagementRootRegistry);
        emit EngagementRegistrySet(address(0), _engagementRootRegistry);
    }

    /// @notice Seal genesis phase — all future changes require timelocks
    /// @dev Irreversible. Call after initial configuration is complete.
    function sealGenesis() external onlyGovernance {
        if (genesisSealed) revert GenesisAlreadySealed();
        genesisSealed = true;
        emit GenesisSealed();
    }

    // ============================================================================
    // Proof Verification (Multi-Depth Routing)
    // ============================================================================

    /// @notice Verify district membership proof with depth-aware routing
    /// @param signer Address that signed the proof submission
    /// @param proof ZK proof bytes
    /// @param districtRoot District Merkle root
    /// @param nullifier Unique nullifier for this action
    /// @param authorityLevel Authority level (1-5 integer, encoded as bytes32)
    /// @param actionDomain Domain separator for nullifier scoping
    /// @param districtId District identifier
    /// @param expectedCountry Expected country code
    /// @param deadline Signature expiration timestamp
    /// @param signature EIP-712 signature from signer
    function verifyAndAuthorizeWithSignature(
        address signer,
        bytes calldata proof,
        bytes32 districtRoot,
        bytes32 nullifier,
        bytes32 authorityLevel,
        bytes32 actionDomain,
        bytes32 districtId,
        bytes3 expectedCountry,
        uint256 deadline,
        bytes calldata signature
    ) external whenNotPaused nonReentrant {
        if (signer == address(0)) revert ZeroAddress();
        if (block.timestamp > deadline) revert SignatureExpired();

        // Verify EIP-712 signature
        bytes32 proofHash = keccak256(proof);
        bytes32 structHash = keccak256(
            abi.encode(
                SUBMIT_PROOF_TYPEHASH,
                proofHash,
                districtRoot,
                nullifier,
                authorityLevel,
                actionDomain,
                districtId,
                expectedCountry,
                nonces[signer],
                deadline
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash)
        );

        address recoveredSigner = ECDSA.recover(digest, signature);
        if (recoveredSigner != signer) revert InvalidSignature();

        nonces[signer]++;

        // Step 1: Look up district metadata (country + depth)
        (bytes3 actualCountry, uint8 depth) = districtRegistry.getCountryAndDepth(districtRoot);
        if (actualCountry == bytes3(0)) revert DistrictNotRegistered();
        if (actualCountry != expectedCountry) revert UnauthorizedDistrict();

        // SA-004 FIX: Validate root lifecycle (isActive and not expired)
        // getCountryAndDepth() only checks registration, NOT lifecycle state
        if (!districtRegistry.isValidRoot(districtRoot)) revert DistrictRootNotActive();

        // SA-001 FIX: Validate actionDomain is on the governance-controlled whitelist
        // This prevents users from generating fresh nullifiers by choosing arbitrary actionDomains
        if (!allowedActionDomains[actionDomain]) revert ActionDomainNotAllowed();

        // Wave 14d: Enforce minimum authority level per action domain
        // Wave 14R: Bounds-check before uint8 cast to prevent truncation
        {
            uint256 authorityRaw = uint256(authorityLevel);
            require(authorityRaw >= 1 && authorityRaw <= 5, "Authority level out of range");
            uint8 submittedAuthority = uint8(authorityRaw);
            uint8 requiredAuthority = actionDomainMinAuthority[actionDomain];
            if (requiredAuthority > 0 && submittedAuthority < requiredAuthority) {
                revert InsufficientAuthority(submittedAuthority, requiredAuthority);
            }
        }

        // Step 2: Get depth-specific verifier
        address verifier = verifierRegistry.getVerifier(depth);
        if (verifier == address(0)) revert VerifierNotFound();

        // Step 3: Verify ZK proof with depth-specific verifier
        // Public inputs: (merkle_root, nullifier, authority_level, action_domain, district_id)
        bytes32[] memory publicInputs = new bytes32[](5);
        publicInputs[0] = districtRoot;
        publicInputs[1] = nullifier;
        publicInputs[2] = bytes32(uint256(authorityLevel));
        publicInputs[3] = actionDomain;
        publicInputs[4] = districtId;

        (bool success, bytes memory result) = verifier.call(
            abi.encodeWithSignature(
                "verify(bytes,bytes32[])",
                proof,
                publicInputs
            )
        );

        if (!success || !abi.decode(result, (bool))) {
            revert VerificationFailed();
        }

        // Step 4: Record nullifier (use actionDomain as actionId — circuit's domain separator for nullifiers)
        nullifierRegistry.recordNullifier(actionDomain, nullifier, districtRoot);

        // Step 5: Record campaign participation (if registry is set)
        if (address(campaignRegistry) != address(0)) {
            try campaignRegistry.recordParticipation(actionDomain, districtRoot) {
                // Success - participation recorded
            } catch {
                // Fail silently - action not linked to campaign or campaign paused
            }
        }

        emit ActionVerified(
            signer,
            msg.sender,
            districtRoot,
            actualCountry,
            depth,
            nullifier,
            authorityLevel,
            actionDomain,
            districtId
        );
    }

    // ============================================================================
    // View Functions
    // ============================================================================

    /// @notice Check if a nullifier has been used for an action
    function isNullifierUsed(bytes32 actionId, bytes32 nullifier) external view returns (bool) {
        return nullifierRegistry.isNullifierUsed(actionId, nullifier);
    }

    /// @notice Get participant count for an action
    function getParticipantCount(bytes32 actionId) external view returns (uint256) {
        return nullifierRegistry.getParticipantCount(actionId);
    }

    /// @notice Get verifier address for a district (by looking up depth)
    /// @param districtRoot District Merkle root
    /// @return Verifier contract address (address(0) if not found)
    function getVerifierForDistrict(bytes32 districtRoot) external view returns (address) {
        uint8 depth = districtRegistry.getDepth(districtRoot);
        if (depth == 0) return address(0);
        return verifierRegistry.getVerifier(depth);
    }

    /// @notice Get all supported depths with registered verifiers
    /// @return Array of depths (e.g., [18, 20, 22, 24])
    function getSupportedDepths() external view returns (uint8[] memory) {
        return verifierRegistry.getRegisteredDepths();
    }

    // ============================================================================
    // Campaign Registry Integration
    // ============================================================================

    /// @notice Propose a new campaign registry address (starts 7-day timelock)
    /// @param _campaignRegistry New campaign registry address (address(0) to remove)
    /// @dev Emits CampaignRegistryChangeProposed. Community has 7 days to respond.
    function proposeCampaignRegistry(address _campaignRegistry) external onlyGovernance {
        // BR3-007: Prevent overwriting pending proposal (resetting timelock)
        if (pendingCampaignRegistryExecuteTime != 0) revert OperationAlreadyPending();

        pendingCampaignRegistry = _campaignRegistry;
        pendingCampaignRegistryExecuteTime = block.timestamp + CAMPAIGN_REGISTRY_TIMELOCK;

        emit CampaignRegistryChangeProposed(_campaignRegistry, pendingCampaignRegistryExecuteTime);
    }

    /// @notice Execute the pending campaign registry change (after 7-day timelock)
    /// @dev Can be called by anyone after timelock expires
    function executeCampaignRegistry() external {
        if (pendingCampaignRegistryExecuteTime == 0) revert CampaignRegistryChangeNotProposed();
        if (block.timestamp < pendingCampaignRegistryExecuteTime) revert CampaignRegistryTimelockNotExpired();

        address previousRegistry = address(campaignRegistry);
        address newRegistry = pendingCampaignRegistry;

        campaignRegistry = CampaignRegistry(newRegistry);
        pendingCampaignRegistry = address(0);
        pendingCampaignRegistryExecuteTime = 0;

        emit CampaignRegistrySet(previousRegistry, newRegistry);
    }

    /// @notice Cancel a pending campaign registry change
    function cancelCampaignRegistry() external onlyGovernance {
        if (pendingCampaignRegistryExecuteTime == 0) revert CampaignRegistryChangeNotProposed();

        address proposed = pendingCampaignRegistry;
        pendingCampaignRegistry = address(0);
        pendingCampaignRegistryExecuteTime = 0;

        emit CampaignRegistryChangeCancelled(proposed);
    }

    // ============================================================================
    // Action Domain Whitelist Management (SA-001 Fix)
    // ============================================================================

    /// @notice Propose a new action domain (starts 7-day timelock)
    /// @param actionDomain Action domain to whitelist
    /// @dev Emits ActionDomainProposed. Community has 7 days to respond.
    ///      Action domains are used to scope nullifiers - each domain represents a distinct action.
    function proposeActionDomain(bytes32 actionDomain) external onlyGovernance {
        // BR3-007: Prevent resetting timelock for already-pending domain
        if (pendingActionDomains[actionDomain] != 0) revert OperationAlreadyPending();

        pendingActionDomains[actionDomain] = block.timestamp + ACTION_DOMAIN_TIMELOCK;
        emit ActionDomainProposed(actionDomain, pendingActionDomains[actionDomain]);
    }

    /// @notice Execute a pending action domain activation (after 7-day timelock)
    /// @param actionDomain Action domain to activate
    /// @dev Can be called by anyone after timelock expires
    function executeActionDomain(bytes32 actionDomain) external {
        uint256 executeTime = pendingActionDomains[actionDomain];
        if (executeTime == 0) revert ActionDomainNotPending();
        if (block.timestamp < executeTime) revert ActionDomainTimelockNotExpired();

        allowedActionDomains[actionDomain] = true;
        delete pendingActionDomains[actionDomain];

        emit ActionDomainActivated(actionDomain);
    }

    /// @notice Cancel a pending action domain proposal
    /// @param actionDomain Action domain to cancel
    function cancelActionDomain(bytes32 actionDomain) external onlyGovernance {
        if (pendingActionDomains[actionDomain] == 0) revert ActionDomainNotPending();
        delete pendingActionDomains[actionDomain];
    }

    /// @notice Revoke an active action domain (immediate effect, governance only)
    /// @param actionDomain Action domain to revoke
    /// @dev Revocation is immediate for emergency response. Use with caution.
    ///      Existing submissions with this domain remain valid (nullifiers already recorded).
    ///      Future submissions will be rejected.
    function revokeActionDomain(bytes32 actionDomain) external onlyGovernance {
        allowedActionDomains[actionDomain] = false;
        emit ActionDomainRevoked(actionDomain);
    }

    /// @notice Set minimum authority level for an action domain
    /// @param actionDomain Registered action domain
    /// @param minLevel Minimum authority level (0 = no enforcement, 1-5 = minimum required)
    /// @dev Wave 14R: Increases are timelocked (24h) to prevent front-running user proofs.
    ///      Decreases (including setting to 0) take effect immediately since they only relax requirements.
    function setActionDomainMinAuthority(bytes32 actionDomain, uint8 minLevel) external onlyGovernance {
        require(allowedActionDomains[actionDomain], "Domain not registered");
        require(minLevel <= 5, "Invalid authority level");

        uint8 currentLevel = actionDomainMinAuthority[actionDomain];

        if (minLevel <= currentLevel) {
            // Decrease or no change: immediate effect (only relaxes requirements)
            actionDomainMinAuthority[actionDomain] = minLevel;
            emit ActionDomainMinAuthoritySet(actionDomain, minLevel);
        } else {
            // Increase: requires 24h timelock to prevent front-running
            pendingMinAuthority[actionDomain] = minLevel;
            pendingMinAuthorityExecuteTime[actionDomain] = block.timestamp + MIN_AUTHORITY_INCREASE_TIMELOCK;
            emit MinAuthorityIncreaseProposed(actionDomain, minLevel, pendingMinAuthorityExecuteTime[actionDomain]);
        }
    }

    /// @notice Execute a pending authority level increase after timelock
    /// @param actionDomain Action domain with pending increase
    function executeMinAuthorityIncrease(bytes32 actionDomain) external {
        uint256 executeTime = pendingMinAuthorityExecuteTime[actionDomain];
        require(executeTime != 0, "No pending increase");
        require(block.timestamp >= executeTime, "Timelock not expired");

        uint8 newLevel = pendingMinAuthority[actionDomain];
        actionDomainMinAuthority[actionDomain] = newLevel;

        delete pendingMinAuthority[actionDomain];
        delete pendingMinAuthorityExecuteTime[actionDomain];

        emit ActionDomainMinAuthoritySet(actionDomain, newLevel);
    }

    /// @notice Cancel a pending authority level increase
    /// @param actionDomain Action domain with pending increase
    function cancelMinAuthorityIncrease(bytes32 actionDomain) external onlyGovernance {
        require(pendingMinAuthorityExecuteTime[actionDomain] != 0, "No pending increase");
        delete pendingMinAuthority[actionDomain];
        delete pendingMinAuthorityExecuteTime[actionDomain];
    }

    // ============================================================================
    // Derived Domain Authorization
    // ============================================================================

    /// @notice Propose authorizing a derived-domain deriver (starts 7-day timelock)
    /// @param deriver Contract to authorize for derived domain registration
    /// @dev Derived domains bypass the per-domain 7-day timelock by inheriting
    ///      authorization from registered base domains. The deriver contract is
    ///      responsible for computing the derivation deterministically.
    function proposeDeriverAuthorization(address deriver) external onlyGovernance {
        if (deriver == address(0)) revert ZeroAddress();
        if (authorizedDerivers[deriver]) revert DeriverAlreadyAuthorized();
        if (pendingDeriverAuthorization[deriver] != 0) revert DeriverAuthorizationAlreadyPending();

        pendingDeriverAuthorization[deriver] = block.timestamp + ACTION_DOMAIN_TIMELOCK;

        emit DeriverAuthorizationProposed(deriver, pendingDeriverAuthorization[deriver]);
    }

    /// @notice Execute pending deriver authorization (after 7-day timelock)
    /// @param deriver Address to authorize
    function executeDeriverAuthorization(address deriver) external {
        uint256 executeTime = pendingDeriverAuthorization[deriver];
        if (executeTime == 0) revert DeriverAuthorizationNotPending();
        if (block.timestamp < executeTime) revert ActionDomainTimelockNotExpired();

        authorizedDerivers[deriver] = true;
        delete pendingDeriverAuthorization[deriver];

        emit DeriverAuthorized(deriver);
    }

    /// @notice Cancel pending deriver authorization
    /// @param deriver Address to cancel authorization for
    function cancelDeriverAuthorization(address deriver) external onlyGovernance {
        if (pendingDeriverAuthorization[deriver] == 0) revert DeriverAuthorizationNotPending();
        delete pendingDeriverAuthorization[deriver];

        emit DeriverAuthorizationCancelled(deriver);
    }

    /// @notice Propose revoking a deriver's authorization (starts 7-day timelock)
    /// @param deriver Address to revoke
    function proposeDeriverRevocation(address deriver) external onlyGovernance {
        if (!authorizedDerivers[deriver]) revert DeriverNotAuthorized();
        if (pendingDeriverRevocation[deriver] != 0) revert DeriverRevocationAlreadyPending();

        pendingDeriverRevocation[deriver] = block.timestamp + ACTION_DOMAIN_TIMELOCK;

        emit DeriverRevocationProposed(deriver, pendingDeriverRevocation[deriver]);
    }

    /// @notice Execute pending deriver revocation (after 7-day timelock)
    /// @param deriver Address to revoke
    function executeDeriverRevocation(address deriver) external {
        uint256 executeTime = pendingDeriverRevocation[deriver];
        if (executeTime == 0) revert DeriverRevocationNotPending();
        if (block.timestamp < executeTime) revert ActionDomainTimelockNotExpired();

        authorizedDerivers[deriver] = false;
        delete pendingDeriverRevocation[deriver];

        emit DeriverRevoked(deriver);
    }

    /// @notice Cancel pending deriver revocation
    /// @param deriver Address to cancel revocation for
    function cancelDeriverRevocation(address deriver) external onlyGovernance {
        if (pendingDeriverRevocation[deriver] == 0) revert DeriverRevocationNotPending();
        delete pendingDeriverRevocation[deriver];

        emit DeriverRevocationCancelled(deriver);
    }

    /// @notice Register a derived action domain atomically (no timelock)
    /// @param baseDomain An already-registered action domain
    /// @param derivedDomain The derived domain to register
    /// @dev Only callable by authorized derivers. The baseDomain MUST be in
    ///      allowedActionDomains. DistrictGate does NOT verify the derivation
    ///      formula — it trusts the authorized deriver contract's bytecode,
    ///      which was vetted during the 7-day authorization timelock.
    function registerDerivedDomain(
        bytes32 baseDomain,
        bytes32 derivedDomain
    ) external {
        if (!authorizedDerivers[msg.sender]) revert DeriverNotAuthorized();
        if (!allowedActionDomains[baseDomain]) revert BaseDomainNotAllowed();
        if (allowedActionDomains[derivedDomain]) revert DerivedDomainAlreadyRegistered();

        allowedActionDomains[derivedDomain] = true;
        derivedDomainBase[derivedDomain] = baseDomain;

        emit DerivedDomainRegistered(baseDomain, derivedDomain, msg.sender);
        emit ActionDomainActivated(derivedDomain);
    }

    // ============================================================================
    // Two-Tree Registry Configuration [DEPRECATED — use Engagement Registry for three-tree]
    // ============================================================================

    /// @notice Pending two-tree registry addresses
    address public pendingUserRootRegistry;
    address public pendingCellMapRegistry;
    uint256 public pendingTwoTreeRegistriesExecuteTime;

    event TwoTreeRegistriesProposed(address userRootRegistry, address cellMapRegistry, uint256 executeTime);
    event TwoTreeRegistriesSet(address userRootRegistry, address cellMapRegistry);
    event TwoTreeRegistriesCancelled();

    error TwoTreeRegistriesNotProposed();
    error TwoTreeRegistriesTimelockNotExpired();

    /// @notice Propose two-tree registry addresses (starts 7-day timelock)
    /// @dev DEPRECATED: Shared registries (UserRootRegistry, CellMapRegistry) are used by both
    ///      two-tree and three-tree paths. Use proposeEngagementRegistry for three-tree.
    /// @param _userRootRegistry Address of UserRootRegistry
    /// @param _cellMapRegistry Address of CellMapRegistry
    function proposeTwoTreeRegistries(
        address _userRootRegistry,
        address _cellMapRegistry
    ) external onlyGovernance {
        if (_userRootRegistry == address(0)) revert ZeroAddress();
        if (_cellMapRegistry == address(0)) revert ZeroAddress();
        // BR3-007: Prevent overwriting pending proposal
        if (pendingTwoTreeRegistriesExecuteTime != 0) revert OperationAlreadyPending();

        pendingUserRootRegistry = _userRootRegistry;
        pendingCellMapRegistry = _cellMapRegistry;
        pendingTwoTreeRegistriesExecuteTime = block.timestamp + GOVERNANCE_TIMELOCK;

        emit TwoTreeRegistriesProposed(
            _userRootRegistry,
            _cellMapRegistry,
            pendingTwoTreeRegistriesExecuteTime
        );
    }

    /// @notice Execute pending two-tree registry configuration (after 7-day timelock)
    /// @dev DEPRECATED: See proposeTwoTreeRegistries.
    function executeTwoTreeRegistries() external {
        if (pendingTwoTreeRegistriesExecuteTime == 0) revert TwoTreeRegistriesNotProposed();
        if (block.timestamp < pendingTwoTreeRegistriesExecuteTime) {
            revert TwoTreeRegistriesTimelockNotExpired();
        }

        userRootRegistry = UserRootRegistry(pendingUserRootRegistry);
        cellMapRegistry = CellMapRegistry(pendingCellMapRegistry);

        emit TwoTreeRegistriesSet(pendingUserRootRegistry, pendingCellMapRegistry);

        pendingUserRootRegistry = address(0);
        pendingCellMapRegistry = address(0);
        pendingTwoTreeRegistriesExecuteTime = 0;
    }

    /// @notice Cancel pending two-tree registry configuration
    /// @dev DEPRECATED: See proposeTwoTreeRegistries.
    function cancelTwoTreeRegistries() external onlyGovernance {
        if (pendingTwoTreeRegistriesExecuteTime == 0) revert TwoTreeRegistriesNotProposed();

        pendingUserRootRegistry = address(0);
        pendingCellMapRegistry = address(0);
        pendingTwoTreeRegistriesExecuteTime = 0;

        emit TwoTreeRegistriesCancelled();
    }

    // ============================================================================
    // Engagement Registry Configuration
    // ============================================================================

    /// @notice Pending engagement registry address
    address public pendingEngagementRegistry;
    uint256 public pendingEngagementRegistryExecuteTime;

    /// @notice Propose a new engagement root registry (starts 7-day timelock)
    /// @param _engagementRootRegistry New engagement root registry address
    function proposeEngagementRegistry(address _engagementRootRegistry) external onlyGovernance {
        if (_engagementRootRegistry == address(0)) revert ZeroAddress();
        if (pendingEngagementRegistryExecuteTime != 0) revert OperationAlreadyPending();

        pendingEngagementRegistry = _engagementRootRegistry;
        pendingEngagementRegistryExecuteTime = block.timestamp + GOVERNANCE_TIMELOCK;

        emit EngagementRegistryProposed(_engagementRootRegistry, pendingEngagementRegistryExecuteTime);
    }

    /// @notice Execute pending engagement registry change (after 7-day timelock)
    function executeEngagementRegistry() external {
        if (pendingEngagementRegistryExecuteTime == 0) revert EngagementRegistryNotProposed();
        if (block.timestamp < pendingEngagementRegistryExecuteTime) revert EngagementRegistryTimelockNotExpired();

        address previousRegistry = address(engagementRootRegistry);
        address newRegistry = pendingEngagementRegistry;

        engagementRootRegistry = EngagementRootRegistry(newRegistry);
        pendingEngagementRegistry = address(0);
        pendingEngagementRegistryExecuteTime = 0;

        emit EngagementRegistrySet(previousRegistry, newRegistry);
    }

    /// @notice Cancel pending engagement registry change
    function cancelEngagementRegistry() external onlyGovernance {
        if (pendingEngagementRegistryExecuteTime == 0) revert EngagementRegistryNotProposed();

        address proposed = pendingEngagementRegistry;
        pendingEngagementRegistry = address(0);
        pendingEngagementRegistryExecuteTime = 0;

        emit EngagementRegistryCancelled(proposed);
    }

    // ============================================================================
    // Two-Tree Proof Verification [DEPRECATED — use Three-Tree path]
    // ============================================================================

    /// @notice Verify a two-tree ZK proof (user identity + cell-district mapping) with EIP-712 signature
    /// @dev DEPRECATED: Use verifyThreeTreeProof which adds engagement tree verification (31 public inputs).
    /// @param signer Address that signed the proof submission
    /// @param proof ZK proof bytes from the two-tree circuit
    /// @param publicInputs Array of 29 public inputs:
    ///        [0]     user_root          (Tree 1 root)
    ///        [1]     cell_map_root      (Tree 2 root)
    ///        [2-25]  districts[24]      (All 24 district IDs)
    ///        [26]    nullifier          (Action-scoped)
    ///        [27]    action_domain      (Contract-controlled whitelist)
    ///        [28]    authority_level    (1-5)
    /// @param verifierDepth Depth to look up the two-tree verifier (from VerifierRegistry)
    /// @param deadline Signature expiration timestamp
    /// @param signature EIP-712 signature from signer
    /// @dev Steps:
    ///      0. Verify EIP-712 signature (nonce, deadline, parameter binding)
    ///      1. Validate user_root via UserRootRegistry
    ///      2. Validate cell_map_root via CellMapRegistry
    ///      3. Validate action_domain via whitelist (SA-001)
    ///      4. Call verifier with proof + public inputs
    ///      5. Record nullifier via NullifierRegistry
    ///      6. Emit event
    function verifyTwoTreeProof(
        address signer,
        bytes calldata proof,
        uint256[29] calldata publicInputs,
        uint8 verifierDepth,
        uint256 deadline,
        bytes calldata signature
    ) external whenNotPaused nonReentrant {
        if (signer == address(0)) revert ZeroAddress();
        if (block.timestamp > deadline) revert SignatureExpired();

        // Step 0: Verify EIP-712 signature
        bytes32 proofHash = keccak256(proof);

        // Hash public inputs array for signature binding
        bytes32 publicInputsHash = keccak256(abi.encodePacked(publicInputs));

        bytes32 structHash = keccak256(
            abi.encode(
                SUBMIT_TWO_TREE_PROOF_TYPEHASH,
                proofHash,
                publicInputsHash,
                verifierDepth,
                nonces[signer],
                deadline
            )
        );

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash)
        );

        address recoveredSigner = ECDSA.recover(digest, signature);
        if (recoveredSigner != signer) revert InvalidSignature();

        nonces[signer]++;
        // Step 0: Validate registries are configured
        if (address(userRootRegistry) == address(0)) revert InvalidUserRoot();
        if (address(cellMapRegistry) == address(0)) revert InvalidCellMapRoot();

        // Extract key fields from public inputs
        bytes32 userRoot = bytes32(publicInputs[0]);
        bytes32 cellMapRoot = bytes32(publicInputs[1]);
        bytes32 nullifier = bytes32(publicInputs[26]);
        bytes32 actionDomain = bytes32(publicInputs[27]);
        bytes32 authorityLevel = bytes32(publicInputs[28]);

        // Step 1: Validate user_root via UserRootRegistry
        if (!userRootRegistry.isValidUserRoot(userRoot)) revert InvalidUserRoot();

        // Step 2: Validate cell_map_root via CellMapRegistry
        if (!cellMapRegistry.isValidCellMapRoot(cellMapRoot)) revert InvalidCellMapRoot();

        // BR3-004: Cross-check country between both trees
        (bytes3 userCountry, uint8 userDepth) = userRootRegistry.getCountryAndDepth(userRoot);
        (bytes3 cellMapCountry,) = cellMapRegistry.getCountryAndDepth(cellMapRoot);
        if (userCountry != cellMapCountry) revert CountryMismatch();

        // BR3-009: Validate verifierDepth matches registry metadata
        if (userDepth != verifierDepth) revert DepthMismatch();

        // Step 3: Validate action_domain via whitelist (SA-001)
        if (!allowedActionDomains[actionDomain]) revert ActionDomainNotAllowed();

        // Wave 14d: Enforce minimum authority level per action domain
        // Wave 14R: Bounds-check before uint8 cast to prevent truncation
        {
            uint256 authorityRaw = publicInputs[28];
            require(authorityRaw >= 1 && authorityRaw <= 5, "Authority level out of range");
            uint8 submittedAuthority = uint8(authorityRaw);
            uint8 requiredAuthority = actionDomainMinAuthority[actionDomain];
            if (requiredAuthority > 0 && submittedAuthority < requiredAuthority) {
                revert InsufficientAuthority(submittedAuthority, requiredAuthority);
            }
        }

        // Step 4: Get depth-specific verifier and verify proof
        address verifier = verifierRegistry.getVerifier(verifierDepth);
        if (verifier == address(0)) revert VerifierNotFound();

        // Convert uint256[29] calldata to bytes32[] for Honk verifier interface
        bytes32[] memory honkInputs = new bytes32[](29);
        for (uint256 i = 0; i < 29; i++) {
            honkInputs[i] = bytes32(publicInputs[i]);
        }

        (bool success, bytes memory result) = verifier.call(
            abi.encodeWithSignature(
                "verify(bytes,bytes32[])",
                proof,
                honkInputs
            )
        );

        if (!success || result.length == 0 || !abi.decode(result, (bool))) {
            revert TwoTreeVerificationFailed();
        }

        // Step 5: Record nullifier (use actionDomain as actionId)
        nullifierRegistry.recordNullifier(actionDomain, nullifier, userRoot);

        // Step 6: Record campaign participation (if registry is set)
        if (address(campaignRegistry) != address(0)) {
            try campaignRegistry.recordParticipation(actionDomain, userRoot) {
                // Success
            } catch {
                // Fail silently
            }
        }

        // Step 7: Emit event
        emit TwoTreeProofVerified(
            signer,
            msg.sender,
            userRoot,
            cellMapRoot,
            nullifier,
            actionDomain,
            authorityLevel,
            verifierDepth
        );
    }

    // ============================================================================
    // Three-Tree Proof Verification
    // ============================================================================

    /// @notice Verify a three-tree ZK proof (user + cell-map + engagement) with EIP-712 signature
    /// @param signer Address that signed the proof submission
    /// @param proof ZK proof bytes from the three-tree circuit
    /// @param publicInputs Array of 31 public inputs:
    ///        [0]     user_root          (Tree 1 root)
    ///        [1]     cell_map_root      (Tree 2 root)
    ///        [2-25]  districts[24]      (All 24 district IDs)
    ///        [26]    nullifier          (Action-scoped)
    ///        [27]    action_domain      (Contract-controlled whitelist)
    ///        [28]    authority_level    (1-5)
    ///        [29]    engagement_root    (Tree 3 root)
    ///        [30]    engagement_tier    (0-4)
    /// @param verifierDepth Depth to look up the three-tree verifier
    /// @param deadline Signature expiration timestamp
    /// @param signature EIP-712 signature from signer
    function verifyThreeTreeProof(
        address signer,
        bytes calldata proof,
        uint256[31] calldata publicInputs,
        uint8 verifierDepth,
        uint256 deadline,
        bytes calldata signature
    ) external whenNotPaused nonReentrant {
        if (signer == address(0)) revert ZeroAddress();
        if (block.timestamp > deadline) revert SignatureExpired();

        // Step 0: Verify EIP-712 signature
        bytes32 proofHash = keccak256(proof);
        bytes32 publicInputsHash = keccak256(abi.encodePacked(publicInputs));

        bytes32 structHash = keccak256(
            abi.encode(
                SUBMIT_THREE_TREE_PROOF_TYPEHASH,
                proofHash,
                publicInputsHash,
                verifierDepth,
                nonces[signer],
                deadline
            )
        );

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash)
        );

        address recoveredSigner = ECDSA.recover(digest, signature);
        if (recoveredSigner != signer) revert InvalidSignature();

        nonces[signer]++;

        // Step 0b: Validate registries are configured
        if (address(userRootRegistry) == address(0)) revert InvalidUserRoot();
        if (address(cellMapRegistry) == address(0)) revert InvalidCellMapRoot();
        if (address(engagementRootRegistry) == address(0)) revert InvalidEngagementRoot();

        // Extract key fields from public inputs
        bytes32 userRoot = bytes32(publicInputs[0]);
        bytes32 cellMapRoot = bytes32(publicInputs[1]);
        bytes32 nullifier = bytes32(publicInputs[26]);
        bytes32 actionDomain = bytes32(publicInputs[27]);
        bytes32 authorityLevel = bytes32(publicInputs[28]);
        bytes32 engagementRoot = bytes32(publicInputs[29]);
        uint256 engagementTierRaw = publicInputs[30];

        // Step 1: Validate user_root via UserRootRegistry
        if (!userRootRegistry.isValidUserRoot(userRoot)) revert InvalidUserRoot();

        // Step 2: Validate cell_map_root via CellMapRegistry
        if (!cellMapRegistry.isValidCellMapRoot(cellMapRoot)) revert InvalidCellMapRoot();

        // Step 3: Cross-check country between Tree 1 and Tree 2
        (bytes3 userCountry, uint8 userDepth) = userRootRegistry.getCountryAndDepth(userRoot);
        (bytes3 cellMapCountry,) = cellMapRegistry.getCountryAndDepth(cellMapRoot);
        if (userCountry != cellMapCountry) revert CountryMismatch();

        // Step 4: Validate verifierDepth matches registry metadata
        if (userDepth != verifierDepth) revert DepthMismatch();

        // Step 5: Validate action_domain via whitelist (SA-001)
        if (!allowedActionDomains[actionDomain]) revert ActionDomainNotAllowed();

        // Step 6: Authority level bounds check and minimum enforcement
        {
            uint256 authorityRaw = publicInputs[28];
            require(authorityRaw >= 1 && authorityRaw <= 5, "Authority level out of range");
            uint8 submittedAuthority = uint8(authorityRaw);
            uint8 requiredAuthority = actionDomainMinAuthority[actionDomain];
            if (requiredAuthority > 0 && submittedAuthority < requiredAuthority) {
                revert InsufficientAuthority(submittedAuthority, requiredAuthority);
            }
        }

        // Step 7: Validate engagement_root via EngagementRootRegistry
        if (!engagementRootRegistry.isValidEngagementRoot(engagementRoot)) revert InvalidEngagementRoot();

        // Step 7b: Defense-in-depth — engagement root depth must match user root depth
        {
            uint8 engagementDepth = engagementRootRegistry.getDepth(engagementRoot);
            if (engagementDepth != userDepth) revert DepthMismatch();
        }

        // Step 8: Engagement tier bounds check [0, 4]
        if (engagementTierRaw > 4) revert InvalidEngagementTier();

        // Step 9: Get three-tree verifier and verify proof
        address verifier = verifierRegistry.getThreeTreeVerifier(verifierDepth);
        if (verifier == address(0)) revert ThreeTreeVerifierNotFound();

        // Convert uint256[31] calldata to bytes32[] for Honk verifier interface
        bytes32[] memory honkInputs = new bytes32[](31);
        for (uint256 i = 0; i < 31; i++) {
            honkInputs[i] = bytes32(publicInputs[i]);
        }

        (bool success, bytes memory result) = verifier.call(
            abi.encodeWithSignature(
                "verify(bytes,bytes32[])",
                proof,
                honkInputs
            )
        );

        if (!success || result.length == 0 || !abi.decode(result, (bool))) {
            revert ThreeTreeVerificationFailed();
        }

        // Step 10: Record nullifier (use actionDomain as actionId)
        nullifierRegistry.recordNullifier(actionDomain, nullifier, userRoot);

        // Step 11: Record campaign participation (if registry is set)
        if (address(campaignRegistry) != address(0)) {
            try campaignRegistry.recordParticipation(actionDomain, userRoot) {
            } catch {
            }
        }

        // Step 12: Emit event
        emit ThreeTreeProofVerified(
            signer,
            msg.sender,
            userRoot,
            cellMapRoot,
            engagementRoot,
            nullifier,
            actionDomain,
            authorityLevel,
            uint8(engagementTierRaw),
            verifierDepth
        );
    }

    // ============================================================================
    // Pause Controls
    // ============================================================================

    /// @notice Pause contract (governance only)
    function pause() external onlyGovernance {
        _pause();
        emit ContractPaused(msg.sender);
    }

    /// @notice Unpause contract (governance only)
    function unpause() external onlyGovernance {
        _unpause();
        emit ContractUnpaused(msg.sender);
    }
}
