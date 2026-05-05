// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./DistrictRegistry.sol";
import "./NullifierRegistry.sol";
import "./VerifierRegistry.sol";
import "./CampaignRegistry.sol";
import "./UserRootRegistry.sol";
import "./CellMapRegistry.sol";
import "./EngagementRootRegistry.sol";
import "./RevocationRegistry.sol";
import "./TimelockGovernance.sol";
import "./Constants.sol";
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
/// MULTI-DISTRICT REGISTRATION MODEL (MAX_DISTRICT_SLOTS District Slots):
/// Users can be registered in up to MAX_DISTRICT_SLOTS district types:
/// - Slots 0-19: 20 defined district types
/// - Slots 20-21: Administrative (Township, Voting Precinct)
/// - Slots 22-23: Overflow slots for rare/regional districts
///
/// VERIFICATION PATH:
/// verifyThreeTreeProof() — 31 public inputs
///   (user_root, cell_map_root, districts[24], nullifier,
///    action_domain, authority_level, engagement_root, engagement_tier)
///
/// UPGRADE PATH:
/// - Add new depths via VerifierRegistry (14-day timelock)
/// - Register new districts with depth via DistrictRegistry (7-day timelock)
/// - No changes to this contract required
contract DistrictGate is Pausable, ReentrancyGuard, TimelockGovernance {
    /// @notice Verifier registry (depth -> verifier address)
    VerifierRegistry public immutable verifierRegistry;

    /// @notice District registry (root -> country + depth)
    DistrictRegistry public immutable districtRegistry;

    /// @notice Nullifier registry (prevents double-voting)
    NullifierRegistry public immutable nullifierRegistry;

    /// @notice User root registry (Tree 1 - user identity roots)
    UserRootRegistry public userRootRegistry;

    /// @notice Cell map registry (Tree 2 - cell-district mapping roots)
    CellMapRegistry public cellMapRegistry;

    /// @notice Engagement root registry (Tree 3 - engagement data roots)
    EngagementRootRegistry public engagementRootRegistry;

    /// @notice Revocation registry (F1 closure — stale-proof replay).
    /// @dev Zero address permitted at genesis; set via genesis or governance
    ///      transfer when the v2 circuit is activated. When unset,
    ///      verifyThreeTreeProof falls back to the v1 (31-input) path.
    RevocationRegistry public revocationRegistry;

    /// @notice Campaign registry (optional, can be zero)
    CampaignRegistry public campaignRegistry;

    /// @notice Minimum timelock for campaign registry changes
    uint256 public constant MIN_CAMPAIGN_TIMELOCK = 10 minutes;

    /// @notice Timelock delay for campaign registry changes (minimum 10 minutes, set at deploy)
    uint256 public immutable CAMPAIGN_REGISTRY_TIMELOCK;

    /// @notice Proposed campaign registry address (zero if no proposal pending)
    address public pendingCampaignRegistry;

    /// @notice Timestamp after which the pending campaign registry change can execute
    uint256 public pendingCampaignRegistryExecuteTime;

    /// @notice Allowed action domains (governance-controlled whitelist)
    /// @dev SA-001 FIX: Prevents users from generating fresh nullifiers with arbitrary actionDomains
    mapping(bytes32 => bool) public allowedActionDomains;

    /// @notice Pending action domain revocations (actionDomain => executeTime)
    /// @dev SM-3 FIX: Two-phase revocation prevents stranding active debate stakes
    mapping(bytes32 => uint256) public pendingRevocations;

    /// @notice Minimum timelock for action domain registration
    uint256 public constant MIN_ACTION_DOMAIN_TIMELOCK = 10 minutes;

    /// @notice Timelock for action domain registration (minimum 10 minutes, set at deploy)
    uint256 public immutable ACTION_DOMAIN_TIMELOCK;

    /// @notice Pending action domain registrations (actionDomain => executeTime)
    mapping(bytes32 => uint256) public pendingActionDomains;

    /// @notice Minimum authority level required per action domain (0 = no enforcement)
    mapping(bytes32 => uint8) public actionDomainMinAuthority;

    /// @notice Minimum timelock for authority level increases
    uint256 public constant MIN_AUTH_INCREASE_TIMELOCK = 10 minutes;

    /// @notice Timelock for authority level increases (minimum 10 minutes, set at deploy)
    uint256 public immutable MIN_AUTHORITY_INCREASE_TIMELOCK;

    /// @notice Pending authority level increases (actionDomain => proposed minLevel)
    mapping(bytes32 => uint8) public pendingMinAuthority;

    /// @notice Timestamp when pending authority increase can execute
    mapping(bytes32 => uint256) public pendingMinAuthorityExecuteTime;

    // ============================================================================
    // Derived Domain Authorization
    // ============================================================================

    mapping(address => bool) public authorizedDerivers;
    mapping(address => uint256) public pendingDeriverAuthorization;
    mapping(address => uint256) public pendingDeriverRevocation;
    mapping(bytes32 => bytes32) public derivedDomainBase;

    /// @notice EIP-712 domain separator
    bytes32 public immutable DOMAIN_SEPARATOR;

    /// @notice Nonces for replay protection
    mapping(address => uint256) public nonces;

    /// @notice Whether genesis phase is complete
    bool public genesisSealed;

    // Events
    event GenesisSealed();
    event CampaignRegistrySetGenesis(address indexed registry);
    event ActionDomainActivatedGenesis(bytes32 indexed actionDomain);
    event RegistriesSetGenesis(address userRootRegistry, address cellMapRegistry);

    event CampaignRegistrySet(address indexed previousRegistry, address indexed newRegistry);
    event CampaignRegistryChangeProposed(address indexed proposed, uint256 executeTime);
    event CampaignRegistryChangeCancelled(address indexed proposed);
    event ContractPaused(address indexed governance);
    event ContractUnpaused(address indexed governance);
    event ActionDomainProposed(bytes32 indexed actionDomain, uint256 executeTime);
    event ActionDomainActivated(bytes32 indexed actionDomain);
    event ActionDomainRevoked(bytes32 indexed actionDomain);
    event ActionDomainRevocationInitiated(bytes32 indexed actionDomain, uint256 executeTime);
    event ActionDomainRevocationCancelled(bytes32 indexed actionDomain);
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
    error RevocationAlreadyPending();
    error RevocationNotPending();
    error DomainNotActive();
    error InsufficientAuthority(uint8 submitted, uint8 required);
    error GenesisAlreadySealed();
    error AuthorityLevelOutOfRange();

    // Derived domain errors
    error DeriverNotAuthorized();
    error DeriverAlreadyAuthorized();
    error DeriverAuthorizationNotPending();
    error DeriverAuthorizationAlreadyPending();
    error DeriverRevocationNotPending();
    error DeriverRevocationAlreadyPending();
    error BaseDomainNotAllowed();
    error DerivedDomainAlreadyRegistered();

    /// @notice Number of public inputs for three-tree proofs (v1 — pre-revocation).
    uint256 public constant THREE_TREE_PUBLIC_INPUT_COUNT = 31;

    /// @notice Number of public inputs for three-tree proofs (v2 — revocation-enforced).
    /// @dev v2 adds `revocation_nullifier` (index 31) and
    ///      `revocation_registry_root` (index 32).
    uint256 public constant THREE_TREE_V2_PUBLIC_INPUT_COUNT = 33;

    /// @notice EIP-712 typehash for three-tree proof submission
    bytes32 public constant SUBMIT_THREE_TREE_PROOF_TYPEHASH = keccak256(
        "SubmitThreeTreeProof(bytes32 proofHash,bytes32 publicInputsHash,uint8 verifierDepth,uint256 nonce,uint256 deadline)"
    );

    /// @notice EIP-712 typehash for v2 (revocation-enforced) three-tree proof submission.
    /// @dev Separate typehash so v1/v2 signatures cannot be replayed against
    ///      the other code path.
    bytes32 public constant SUBMIT_THREE_TREE_PROOF_V2_TYPEHASH = keccak256(
        "SubmitThreeTreeProofV2(bytes32 proofHash,bytes32 publicInputsHash,uint8 verifierDepth,uint256 nonce,uint256 deadline)"
    );

    // Validation errors
    error InvalidUserRoot();
    error InvalidCellMapRoot();
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

    // Revocation errors (F1 closure — Stage 5)
    error CredentialRevoked();
    error StaleRevocationRoot();
    error RevocationRegistryNotConfigured();
    error RevocationRegistryAlreadyProposed();
    error RevocationRegistryNotProposed();
    error RevocationRegistryTimelockNotExpired();

    // Revocation events (F1 closure)
    event RevocationRegistrySetGenesis(address indexed registry);
    event RevocationRegistryProposed(address indexed proposed, uint256 executeTime);
    event RevocationRegistrySet(address indexed previousRegistry, address indexed newRegistry);
    event RevocationRegistryCancelled(address indexed proposed);
    event RevocationBlockedSubmission(bytes32 indexed revocationNullifier, address indexed submitter);

    // Revocation registry proposal state
    address public pendingRevocationRegistry;
    uint256 public pendingRevocationRegistryExecuteTime;

    constructor(
        address _verifierRegistry,
        address _districtRegistry,
        address _nullifierRegistry,
        address _governance,
        uint256 _governanceTimelock,
        uint256 _campaignTimelock,
        uint256 _actionDomainTimelock,
        uint256 _authorityTimelock
    ) TimelockGovernance(_governanceTimelock) {
        if (_verifierRegistry == address(0)) revert ZeroAddress();
        if (_districtRegistry == address(0)) revert ZeroAddress();
        if (_nullifierRegistry == address(0)) revert ZeroAddress();

        if (_campaignTimelock < MIN_CAMPAIGN_TIMELOCK) revert TimelockTooShort();
        if (_actionDomainTimelock < MIN_ACTION_DOMAIN_TIMELOCK) revert TimelockTooShort();
        if (_authorityTimelock < MIN_AUTH_INCREASE_TIMELOCK) revert TimelockTooShort();
        CAMPAIGN_REGISTRY_TIMELOCK = _campaignTimelock;
        ACTION_DOMAIN_TIMELOCK = _actionDomainTimelock;
        MIN_AUTHORITY_INCREASE_TIMELOCK = _authorityTimelock;

        _initializeGovernance(_governance);

        verifierRegistry = VerifierRegistry(_verifierRegistry);
        districtRegistry = DistrictRegistry(_districtRegistry);
        nullifierRegistry = NullifierRegistry(_nullifierRegistry);

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("DistrictGate")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    // ============================================================================
    // Genesis Configuration (no timelock)
    // ============================================================================

    function setCampaignRegistryGenesis(address _campaignRegistry) external onlyGovernance {
        if (genesisSealed) revert GenesisAlreadySealed();
        address previous = address(campaignRegistry);
        campaignRegistry = CampaignRegistry(_campaignRegistry);
        emit CampaignRegistrySetGenesis(_campaignRegistry);
        emit CampaignRegistrySet(previous, _campaignRegistry);
    }

    function registerActionDomainGenesis(bytes32 actionDomain) external onlyGovernance {
        if (genesisSealed) revert GenesisAlreadySealed();
        allowedActionDomains[actionDomain] = true;
        emit ActionDomainActivatedGenesis(actionDomain);
        emit ActionDomainActivated(actionDomain);
    }

    function authorizeDeriverGenesis(address deriver) external onlyGovernance {
        if (genesisSealed) revert GenesisAlreadySealed();
        if (deriver == address(0)) revert ZeroAddress();
        if (authorizedDerivers[deriver]) revert DeriverAlreadyAuthorized();
        authorizedDerivers[deriver] = true;
        emit DeriverAuthorizedGenesis(deriver);
        emit DeriverAuthorized(deriver);
    }

    /// @notice Set shared registries (UserRootRegistry, CellMapRegistry) during genesis
    function setRegistriesGenesis(
        address _userRootRegistry,
        address _cellMapRegistry
    ) external onlyGovernance {
        if (genesisSealed) revert GenesisAlreadySealed();
        if (_userRootRegistry == address(0)) revert ZeroAddress();
        if (_cellMapRegistry == address(0)) revert ZeroAddress();
        userRootRegistry = UserRootRegistry(_userRootRegistry);
        cellMapRegistry = CellMapRegistry(_cellMapRegistry);
        emit RegistriesSetGenesis(_userRootRegistry, _cellMapRegistry);
    }

    function setEngagementRegistryGenesis(address _engagementRootRegistry) external onlyGovernance {
        if (genesisSealed) revert GenesisAlreadySealed();
        if (_engagementRootRegistry == address(0)) revert ZeroAddress();
        engagementRootRegistry = EngagementRootRegistry(_engagementRootRegistry);
        emit EngagementRegistrySetGenesis(_engagementRootRegistry);
        emit EngagementRegistrySet(address(0), _engagementRootRegistry);
    }

    /// @notice Set the RevocationRegistry during genesis.
    /// @dev F1 closure (Stage 5). Before the v2 cutover, the registry address
    ///      is zero and `verifyThreeTreeProofV2` is unusable; only the v1
    ///      (31-input) path verifies. After genesis seal, the registry may be
    ///      changed only via the timelocked propose/execute flow.
    function setRevocationRegistryGenesis(address _revocationRegistry) external onlyGovernance {
        if (genesisSealed) revert GenesisAlreadySealed();
        if (_revocationRegistry == address(0)) revert ZeroAddress();
        revocationRegistry = RevocationRegistry(_revocationRegistry);
        emit RevocationRegistrySetGenesis(_revocationRegistry);
        emit RevocationRegistrySet(address(0), _revocationRegistry);
    }

    function sealGenesis() external onlyGovernance {
        if (genesisSealed) revert GenesisAlreadySealed();
        genesisSealed = true;
        emit GenesisSealed();
    }

    // ============================================================================
    // View Functions
    // ============================================================================

    function isNullifierUsed(bytes32 actionId, bytes32 nullifier) external view returns (bool) {
        return nullifierRegistry.isNullifierUsed(actionId, nullifier);
    }

    function getParticipantCount(bytes32 actionId) external view returns (uint256) {
        return nullifierRegistry.getParticipantCount(actionId);
    }

    function getVerifierForDistrict(bytes32 districtRoot) external view returns (address) {
        uint8 depth = districtRegistry.getDepth(districtRoot);
        if (depth == 0) return address(0);
        return verifierRegistry.getVerifier(depth);
    }

    function getSupportedDepths() external view returns (uint8[] memory) {
        return verifierRegistry.getRegisteredDepths();
    }

    // ============================================================================
    // Campaign Registry Integration
    // ============================================================================

    function proposeCampaignRegistry(address _campaignRegistry) external onlyGovernance {
        if (pendingCampaignRegistryExecuteTime != 0) revert OperationAlreadyPending();
        pendingCampaignRegistry = _campaignRegistry;
        pendingCampaignRegistryExecuteTime = block.timestamp + CAMPAIGN_REGISTRY_TIMELOCK;
        emit CampaignRegistryChangeProposed(_campaignRegistry, pendingCampaignRegistryExecuteTime);
    }

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

    function proposeActionDomain(bytes32 actionDomain) external onlyGovernance {
        if (pendingActionDomains[actionDomain] != 0) revert OperationAlreadyPending();
        pendingActionDomains[actionDomain] = block.timestamp + ACTION_DOMAIN_TIMELOCK;
        emit ActionDomainProposed(actionDomain, pendingActionDomains[actionDomain]);
    }

    function executeActionDomain(bytes32 actionDomain) external {
        uint256 executeTime = pendingActionDomains[actionDomain];
        if (executeTime == 0) revert ActionDomainNotPending();
        if (block.timestamp < executeTime) revert ActionDomainTimelockNotExpired();
        allowedActionDomains[actionDomain] = true;
        delete pendingActionDomains[actionDomain];
        emit ActionDomainActivated(actionDomain);
    }

    function cancelActionDomain(bytes32 actionDomain) external onlyGovernance {
        if (pendingActionDomains[actionDomain] == 0) revert ActionDomainNotPending();
        delete pendingActionDomains[actionDomain];
    }

    function initiateActionDomainRevocation(bytes32 actionDomain) external onlyGovernance {
        if (!allowedActionDomains[actionDomain]) revert DomainNotActive();
        if (pendingRevocations[actionDomain] != 0) revert RevocationAlreadyPending();
        uint256 executeTime = block.timestamp + GOVERNANCE_TIMELOCK;
        pendingRevocations[actionDomain] = executeTime;
        emit ActionDomainRevocationInitiated(actionDomain, executeTime);
    }

    function executeActionDomainRevocation(bytes32 actionDomain) external {
        uint256 executeTime = pendingRevocations[actionDomain];
        if (executeTime == 0) revert RevocationNotPending();
        if (block.timestamp < executeTime) revert TimelockNotExpired();
        allowedActionDomains[actionDomain] = false;
        delete pendingRevocations[actionDomain];
        emit ActionDomainRevoked(actionDomain);
    }

    function cancelActionDomainRevocation(bytes32 actionDomain) external onlyGovernance {
        if (pendingRevocations[actionDomain] == 0) revert RevocationNotPending();
        delete pendingRevocations[actionDomain];
        emit ActionDomainRevocationCancelled(actionDomain);
    }

    function setActionDomainMinAuthority(bytes32 actionDomain, uint8 minLevel) external onlyGovernance {
        require(allowedActionDomains[actionDomain], "Domain not registered");
        require(minLevel <= 5, "Invalid authority level");
        uint8 currentLevel = actionDomainMinAuthority[actionDomain];
        if (minLevel <= currentLevel) {
            actionDomainMinAuthority[actionDomain] = minLevel;
            emit ActionDomainMinAuthoritySet(actionDomain, minLevel);
        } else {
            pendingMinAuthority[actionDomain] = minLevel;
            pendingMinAuthorityExecuteTime[actionDomain] = block.timestamp + MIN_AUTHORITY_INCREASE_TIMELOCK;
            emit MinAuthorityIncreaseProposed(actionDomain, minLevel, pendingMinAuthorityExecuteTime[actionDomain]);
        }
    }

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

    function cancelMinAuthorityIncrease(bytes32 actionDomain) external onlyGovernance {
        require(pendingMinAuthorityExecuteTime[actionDomain] != 0, "No pending increase");
        delete pendingMinAuthority[actionDomain];
        delete pendingMinAuthorityExecuteTime[actionDomain];
    }

    // ============================================================================
    // Derived Domain Authorization
    // ============================================================================

    function proposeDeriverAuthorization(address deriver) external onlyGovernance {
        if (deriver == address(0)) revert ZeroAddress();
        if (authorizedDerivers[deriver]) revert DeriverAlreadyAuthorized();
        if (pendingDeriverAuthorization[deriver] != 0) revert DeriverAuthorizationAlreadyPending();
        pendingDeriverAuthorization[deriver] = block.timestamp + ACTION_DOMAIN_TIMELOCK;
        emit DeriverAuthorizationProposed(deriver, pendingDeriverAuthorization[deriver]);
    }

    function executeDeriverAuthorization(address deriver) external {
        uint256 executeTime = pendingDeriverAuthorization[deriver];
        if (executeTime == 0) revert DeriverAuthorizationNotPending();
        if (block.timestamp < executeTime) revert ActionDomainTimelockNotExpired();
        authorizedDerivers[deriver] = true;
        delete pendingDeriverAuthorization[deriver];
        emit DeriverAuthorized(deriver);
    }

    function cancelDeriverAuthorization(address deriver) external onlyGovernance {
        if (pendingDeriverAuthorization[deriver] == 0) revert DeriverAuthorizationNotPending();
        delete pendingDeriverAuthorization[deriver];
        emit DeriverAuthorizationCancelled(deriver);
    }

    function proposeDeriverRevocation(address deriver) external onlyGovernance {
        if (!authorizedDerivers[deriver]) revert DeriverNotAuthorized();
        if (pendingDeriverRevocation[deriver] != 0) revert DeriverRevocationAlreadyPending();
        pendingDeriverRevocation[deriver] = block.timestamp + ACTION_DOMAIN_TIMELOCK;
        emit DeriverRevocationProposed(deriver, pendingDeriverRevocation[deriver]);
    }

    function executeDeriverRevocation(address deriver) external {
        uint256 executeTime = pendingDeriverRevocation[deriver];
        if (executeTime == 0) revert DeriverRevocationNotPending();
        if (block.timestamp < executeTime) revert ActionDomainTimelockNotExpired();
        authorizedDerivers[deriver] = false;
        delete pendingDeriverRevocation[deriver];
        emit DeriverRevoked(deriver);
    }

    function cancelDeriverRevocation(address deriver) external onlyGovernance {
        if (pendingDeriverRevocation[deriver] == 0) revert DeriverRevocationNotPending();
        delete pendingDeriverRevocation[deriver];
        emit DeriverRevocationCancelled(deriver);
    }

    function registerDerivedDomain(bytes32 baseDomain, bytes32 derivedDomain) external {
        if (!authorizedDerivers[msg.sender]) revert DeriverNotAuthorized();
        if (!allowedActionDomains[baseDomain]) revert BaseDomainNotAllowed();
        if (allowedActionDomains[derivedDomain]) revert DerivedDomainAlreadyRegistered();
        allowedActionDomains[derivedDomain] = true;
        derivedDomainBase[derivedDomain] = baseDomain;
        emit DerivedDomainRegistered(baseDomain, derivedDomain, msg.sender);
        emit ActionDomainActivated(derivedDomain);
    }

    // ============================================================================
    // Engagement Registry Configuration
    // ============================================================================

    address public pendingEngagementRegistry;
    uint256 public pendingEngagementRegistryExecuteTime;

    function proposeEngagementRegistry(address _engagementRootRegistry) external onlyGovernance {
        if (_engagementRootRegistry == address(0)) revert ZeroAddress();
        if (pendingEngagementRegistryExecuteTime != 0) revert OperationAlreadyPending();
        pendingEngagementRegistry = _engagementRootRegistry;
        pendingEngagementRegistryExecuteTime = block.timestamp + GOVERNANCE_TIMELOCK;
        emit EngagementRegistryProposed(_engagementRootRegistry, pendingEngagementRegistryExecuteTime);
    }

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

    function cancelEngagementRegistry() external onlyGovernance {
        if (pendingEngagementRegistryExecuteTime == 0) revert EngagementRegistryNotProposed();
        address proposed = pendingEngagementRegistry;
        pendingEngagementRegistry = address(0);
        pendingEngagementRegistryExecuteTime = 0;
        emit EngagementRegistryCancelled(proposed);
    }

    // ============================================================================
    // Revocation Registry Configuration (F1 closure — Stage 5)
    // ============================================================================

    function proposeRevocationRegistry(address _revocationRegistry) external onlyGovernance {
        if (_revocationRegistry == address(0)) revert ZeroAddress();
        if (pendingRevocationRegistryExecuteTime != 0) revert RevocationRegistryAlreadyProposed();
        pendingRevocationRegistry = _revocationRegistry;
        pendingRevocationRegistryExecuteTime = block.timestamp + GOVERNANCE_TIMELOCK;
        emit RevocationRegistryProposed(_revocationRegistry, pendingRevocationRegistryExecuteTime);
    }

    function executeRevocationRegistry() external {
        if (pendingRevocationRegistryExecuteTime == 0) revert RevocationRegistryNotProposed();
        if (block.timestamp < pendingRevocationRegistryExecuteTime) revert RevocationRegistryTimelockNotExpired();
        address previous = address(revocationRegistry);
        address newRegistry = pendingRevocationRegistry;
        revocationRegistry = RevocationRegistry(newRegistry);
        pendingRevocationRegistry = address(0);
        pendingRevocationRegistryExecuteTime = 0;
        emit RevocationRegistrySet(previous, newRegistry);
    }

    function cancelRevocationRegistry() external onlyGovernance {
        if (pendingRevocationRegistryExecuteTime == 0) revert RevocationRegistryNotProposed();
        address proposed = pendingRevocationRegistry;
        pendingRevocationRegistry = address(0);
        pendingRevocationRegistryExecuteTime = 0;
        emit RevocationRegistryCancelled(proposed);
    }

    // ============================================================================
    // Three-Tree Proof Verification
    // ============================================================================

    /// @notice Verify a three-tree ZK proof (user + cell-map + engagement) with EIP-712 signature
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

        if (address(userRootRegistry) == address(0)) revert InvalidUserRoot();
        if (address(cellMapRegistry) == address(0)) revert InvalidCellMapRoot();
        if (address(engagementRootRegistry) == address(0)) revert InvalidEngagementRoot();

        bytes32 userRoot = bytes32(publicInputs[0]);
        bytes32 cellMapRoot = bytes32(publicInputs[1]);
        bytes32 nullifier = bytes32(publicInputs[26]);
        bytes32 actionDomain = bytes32(publicInputs[27]);
        bytes32 authorityLevel = bytes32(publicInputs[28]);
        bytes32 engagementRoot = bytes32(publicInputs[29]);
        uint256 engagementTierRaw = publicInputs[30];

        if (!userRootRegistry.isValidUserRoot(userRoot)) revert InvalidUserRoot();
        if (!cellMapRegistry.isValidCellMapRoot(cellMapRoot)) revert InvalidCellMapRoot();

        (bytes3 userCountry, uint8 userDepth) = userRootRegistry.getCountryAndDepth(userRoot);
        (bytes3 cellMapCountry,) = cellMapRegistry.getCountryAndDepth(cellMapRoot);
        if (userCountry != cellMapCountry) revert CountryMismatch();
        if (userDepth != verifierDepth) revert DepthMismatch();

        if (!allowedActionDomains[actionDomain]) revert ActionDomainNotAllowed();

        {
            uint256 authorityRaw = publicInputs[28];
            if (authorityRaw < 1 || authorityRaw > 5) revert AuthorityLevelOutOfRange();
            uint8 submittedAuthority = uint8(authorityRaw);
            uint8 requiredAuthority = actionDomainMinAuthority[actionDomain];
            if (requiredAuthority > 0 && submittedAuthority < requiredAuthority) {
                revert InsufficientAuthority(submittedAuthority, requiredAuthority);
            }
        }

        if (!engagementRootRegistry.isValidEngagementRoot(engagementRoot)) revert InvalidEngagementRoot();

        {
            uint8 engagementDepth = engagementRootRegistry.getDepth(engagementRoot);
            if (engagementDepth != userDepth) revert DepthMismatch();
        }

        if (engagementTierRaw > 4) revert InvalidEngagementTier();

        address verifier = verifierRegistry.getThreeTreeVerifier(verifierDepth);
        if (verifier == address(0)) revert ThreeTreeVerifierNotFound();

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

        nullifierRegistry.recordNullifier(actionDomain, nullifier, userRoot);

        if (address(campaignRegistry) != address(0)) {
            try campaignRegistry.recordParticipation(actionDomain, userRoot, nullifier) {
            } catch {
            }
        }

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
    // Three-Tree Proof V2 Verification (F1 closure — Stage 5)
    // ============================================================================

    /// @notice Verify a v2 three-tree ZK proof with revocation non-membership check.
    /// @dev v2 adds two public inputs:
    ///        - publicInputs[31] = revocation_nullifier (derived in-circuit from
    ///          district_commitment)
    ///        - publicInputs[32] = revocation_registry_root (the SMT root the
    ///          proof's non-membership witness was built against)
    ///      The contract cross-checks:
    ///        1. revocation_nullifier is NOT in the flat `isRevoked` mapping
    ///           (fast-path dedup; the circuit's non-membership proof is the
    ///           cryptographic enforcement, this is defense-in-depth).
    ///        2. revocation_registry_root matches the current root OR a
    ///           recently-archived root within the TTL window.
    ///      If either check fails, the proof is rejected.
    function verifyThreeTreeProofV2(
        address signer,
        bytes calldata proof,
        uint256[33] calldata publicInputs,
        uint8 verifierDepth,
        uint256 deadline,
        bytes calldata signature
    ) external whenNotPaused nonReentrant {
        if (signer == address(0)) revert ZeroAddress();
        if (block.timestamp > deadline) revert SignatureExpired();
        if (address(revocationRegistry) == address(0)) revert RevocationRegistryNotConfigured();

        bytes32 proofHash = keccak256(proof);
        bytes32 publicInputsHash = keccak256(abi.encodePacked(publicInputs));

        bytes32 structHash = keccak256(
            abi.encode(
                SUBMIT_THREE_TREE_PROOF_V2_TYPEHASH,
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

        if (address(userRootRegistry) == address(0)) revert InvalidUserRoot();
        if (address(cellMapRegistry) == address(0)) revert InvalidCellMapRoot();
        if (address(engagementRootRegistry) == address(0)) revert InvalidEngagementRoot();

        bytes32 userRoot = bytes32(publicInputs[0]);
        bytes32 cellMapRoot = bytes32(publicInputs[1]);
        bytes32 nullifier = bytes32(publicInputs[26]);
        bytes32 actionDomain = bytes32(publicInputs[27]);
        bytes32 authorityLevel = bytes32(publicInputs[28]);
        bytes32 engagementRoot = bytes32(publicInputs[29]);
        uint256 engagementTierRaw = publicInputs[30];
        bytes32 revocationNullifier = bytes32(publicInputs[31]);
        bytes32 revocationRoot = bytes32(publicInputs[32]);

        // Revocation checks FIRST — cheap SLOADs, fail fast.
        // (a) The revocation nullifier must not already be in the flat set.
        //     The circuit also proves non-membership against the SMT; this is
        //     a defense-in-depth fast-path using the registry's O(1) mapping.
        if (revocationRegistry.isRevoked(revocationNullifier)) {
            emit RevocationBlockedSubmission(revocationNullifier, msg.sender);
            revert CredentialRevoked();
        }
        // (b) The root the circuit witnessed must match the current root or a
        //     recently-archived root (TTL window for in-flight proofs).
        if (!revocationRegistry.isRootAcceptable(revocationRoot)) {
            revert StaleRevocationRoot();
        }

        if (!userRootRegistry.isValidUserRoot(userRoot)) revert InvalidUserRoot();
        if (!cellMapRegistry.isValidCellMapRoot(cellMapRoot)) revert InvalidCellMapRoot();

        (bytes3 userCountry, uint8 userDepth) = userRootRegistry.getCountryAndDepth(userRoot);
        (bytes3 cellMapCountry,) = cellMapRegistry.getCountryAndDepth(cellMapRoot);
        if (userCountry != cellMapCountry) revert CountryMismatch();
        if (userDepth != verifierDepth) revert DepthMismatch();

        if (!allowedActionDomains[actionDomain]) revert ActionDomainNotAllowed();

        {
            uint256 authorityRaw = publicInputs[28];
            if (authorityRaw < 1 || authorityRaw > 5) revert AuthorityLevelOutOfRange();
            uint8 submittedAuthority = uint8(authorityRaw);
            uint8 requiredAuthority = actionDomainMinAuthority[actionDomain];
            if (requiredAuthority > 0 && submittedAuthority < requiredAuthority) {
                revert InsufficientAuthority(submittedAuthority, requiredAuthority);
            }
        }

        if (!engagementRootRegistry.isValidEngagementRoot(engagementRoot)) revert InvalidEngagementRoot();

        {
            uint8 engagementDepth = engagementRootRegistry.getDepth(engagementRoot);
            if (engagementDepth != userDepth) revert DepthMismatch();
        }

        if (engagementTierRaw > 4) revert InvalidEngagementTier();

        address verifier = verifierRegistry.getThreeTreeVerifier(verifierDepth);
        if (verifier == address(0)) revert ThreeTreeVerifierNotFound();

        bytes32[] memory honkInputs = new bytes32[](33);
        for (uint256 i = 0; i < 33; i++) {
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

        nullifierRegistry.recordNullifier(actionDomain, nullifier, userRoot);

        if (address(campaignRegistry) != address(0)) {
            try campaignRegistry.recordParticipation(actionDomain, userRoot, nullifier) {
            } catch {
            }
        }

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

    function pause() external onlyGovernance {
        _pause();
        emit ContractPaused(msg.sender);
    }

    function unpause() external onlyGovernance {
        _unpause();
        emit ContractUnpaused(msg.sender);
    }
}
