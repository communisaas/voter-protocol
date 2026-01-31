// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "./DistrictRegistry.sol";
import "./NullifierRegistry.sol";
import "./VerifierRegistry.sol";
import "./CampaignRegistry.sol";
import "./TimelockGovernance.sol";
import "openzeppelin/utils/cryptography/ECDSA.sol";
import "openzeppelin/security/Pausable.sol";

/// @title DistrictGateV2
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
/// HYBRID 24-SLOT DISTRICT APPROACH:
/// The ZK circuit supports 24 district slots per proof using a hybrid allocation:
/// - Slots 0-19: 20 defined district types (federal, state, county, city, school, etc.)
/// - Slots 20-21: Reserved for future defined district types
/// - Slots 22-23: Overflow slots for rare/regional districts (water districts, etc.)
/// This approach balances circuit efficiency with coverage for edge cases.
/// Empty slots use bytes32(0) and are skipped during verification.
///
/// PUBLIC INPUTS (SAME across all depths, matches circuit output order):
/// - publicInputs[0]: merkleRoot (district Merkle root)
/// - publicInputs[1]: nullifier (prevents double-voting)
/// - publicInputs[2]: authorityLevel (1-5 integer authority level)
/// - publicInputs[3]: actionDomain (domain separator for nullifier scoping)
/// - publicInputs[4]: districtId (district identifier)
///
/// BACKWARDS COMPATIBILITY:
/// - Existing depth-12 proofs continue to work via fallback verifier
/// - New proofs use depth-aware routing
/// - Gradual migration: old districts (depth 12) → new districts (depth 18-24)
///
/// UPGRADE PATH:
/// - Add new depths via VerifierRegistry (14-day timelock)
/// - Register new districts with depth via DistrictRegistry (7-day timelock)
/// - No changes to this contract required
contract DistrictGateV2 is Pausable, TimelockGovernance {
    /// @notice Maximum district slots in proof (hybrid: 20 defined + 4 overflow)
    /// @dev Slots 0-19: Defined district types, Slots 20-21: Reserved, Slots 22-23: Overflow
    uint8 public constant MAX_DISTRICT_SLOTS = 24;

    /// @notice Verifier registry (depth → verifier address)
    VerifierRegistry public immutable verifierRegistry;

    /// @notice District registry (root → country + depth)
    DistrictRegistry public immutable districtRegistry;

    /// @notice Nullifier registry (prevents double-voting)
    NullifierRegistry public immutable nullifierRegistry;

    /// @notice Campaign registry (optional, can be zero)
    CampaignRegistry public campaignRegistry;

    /// @notice Timelock delay for campaign registry changes (7 days, same as district registration)
    uint256 public constant CAMPAIGN_REGISTRY_TIMELOCK = 7 days;

    /// @notice Proposed campaign registry address (zero if no proposal pending)
    address public pendingCampaignRegistry;

    /// @notice Timestamp after which the pending campaign registry change can execute
    uint256 public pendingCampaignRegistryExecuteTime;

    /// @notice EIP-712 domain separator
    bytes32 public immutable DOMAIN_SEPARATOR;

    /// @notice EIP-712 typehash for proof submission
    bytes32 public constant SUBMIT_PROOF_TYPEHASH = keccak256(
        "SubmitProof(bytes32 proofHash,bytes32 districtRoot,bytes32 nullifier,bytes32 authorityLevel,bytes32 actionDomain,bytes32 districtId,bytes3 country,uint256 nonce,uint256 deadline)"
    );

    /// @notice Nonces for replay protection
    mapping(address => uint256) public nonces;

    // Events
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

    // Errors
    error VerificationFailed();
    error UnauthorizedDistrict();
    error DistrictNotRegistered();
    error VerifierNotFound();
    error InvalidSignature();
    error SignatureExpired();
    error InvalidPublicInputCount();
    error CampaignRegistryChangeNotProposed();
    error CampaignRegistryTimelockNotExpired();

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

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("DistrictGateV2")),
                keccak256(bytes("1")), // Version 1: Multi-depth support
                block.chainid,
                address(this)
            )
        );
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
    ) external whenNotPaused {
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

        // Step 2: Get depth-specific verifier
        address verifier = verifierRegistry.getVerifier(depth);
        if (verifier == address(0)) revert VerifierNotFound();

        // Step 3: Verify ZK proof with depth-specific verifier
        // Public inputs: (merkle_root, nullifier, authority_level, action_domain, district_id)
        uint256[5] memory publicInputs = [
            uint256(districtRoot),
            uint256(nullifier),
            uint256(authorityLevel),
            uint256(actionDomain),
            uint256(districtId)
        ];

        (bool success, bytes memory result) = verifier.call(
            abi.encodeWithSignature(
                "verifyProof(bytes,uint256[5])",
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
            try campaignRegistry.recordParticipation(districtId, districtRoot) {
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
