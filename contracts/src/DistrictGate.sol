// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "./DistrictRegistry.sol";
import "./NullifierRegistry.sol";
import "./CampaignRegistry.sol";
import "./TimelockGovernance.sol";
import "openzeppelin/utils/cryptography/ECDSA.sol";
import "openzeppelin/security/Pausable.sol";

/// @title DistrictGate
/// @notice Master verification contract for district membership proofs
/// @dev Orchestrates four-step verification:
///      Step 1: ZK proof verification (district membership)
///      Step 2: On-chain registry lookup (district→country mapping)
///      Step 3: Nullifier recording (double-action prevention + rate limiting)
///      Step 4: Campaign participation recording (if action linked to campaign)
///
/// PERMISSIONLESS ACTIONS:
/// - Any bytes32 actionId is valid (no authorization required)
/// - Spam mitigated by: rate limits (60s), gas costs, ZK proof generation time
/// - Action namespaces are user-defined (typically hash of template/campaign ID)
///
/// HYBRID 24-SLOT DISTRICT APPROACH:
/// The ZK circuit supports 24 district slots per proof using a hybrid allocation:
/// - Slots 0-19: 20 defined district types (federal, state, county, city, school, etc.)
/// - Slots 20-21: Reserved for future defined district types
/// - Slots 22-23: Overflow slots for rare/regional districts (water districts, etc.)
/// This approach balances circuit efficiency with coverage for edge cases.
/// Empty slots use bytes32(0) and are skipped during verification.
///
/// CAMPAIGN INTEGRATION (Phase 1.5):
/// - Optional CampaignRegistry records participation metrics
/// - Actions work without campaigns (backwards compatible)
/// - If action is linked to campaign, participation is recorded
///
/// PHASE 1 SECURITY MODEL (Honest):
/// - Single point of failure: Founder key compromise = governance compromise
/// - Mitigation: 7-day governance timelock, 14-day verifier timelock
/// - Community can monitor events and exit during timelock if malicious
/// - NO nation-state resistance until Phase 2 (requires real multi-jurisdiction guardians)
///
/// UPGRADE PATH (Phase 2+):
/// - Add GuardianShield when real guardians are recruited
/// - Guardians must be humans in different legal jurisdictions
/// - NOT LLM agents, NOT VPN-separated keys from same person
contract DistrictGate is Pausable, TimelockGovernance {
    /// @notice Maximum district slots in proof (hybrid: 20 defined + 4 overflow)
    /// @dev Slots 0-19: Defined district types, Slots 20-21: Reserved, Slots 22-23: Overflow
    uint8 public constant MAX_DISTRICT_SLOTS = 24;

    /// @notice Address of the ZK verifier contract (upgradeable with timelock)
    address public verifier;

    /// @notice Pending verifier upgrade
    address public pendingVerifier;

    /// @notice Execution timestamp for verifier upgrade
    uint256 public verifierUpgradeTime;

    /// @notice Timelock for verifier upgrades (14 days - more critical than governance)
    /// @dev Longer timelock because verifier bugs could accept invalid proofs
    uint256 public constant VERIFIER_UPGRADE_TIMELOCK = 14 days;

    /// @notice Address of the district registry
    DistrictRegistry public immutable districtRegistry;

    /// @notice Address of the nullifier registry
    NullifierRegistry public immutable nullifierRegistry;

    /// @notice Address of the campaign registry (optional, can be zero)
    /// @dev Not immutable - can be set after deployment for Phase 1.5 upgrade
    CampaignRegistry public campaignRegistry;

    /// @notice EIP-712 domain separator for signature verification
    bytes32 public immutable DOMAIN_SEPARATOR;

    /// @notice EIP-712 typehash for proof submission
    bytes32 public constant SUBMIT_PROOF_TYPEHASH = keccak256(
        "SubmitProof(bytes32 proofHash,bytes32 districtRoot,bytes32 nullifier,bytes32 actionId,bytes3 country,uint256 nonce,uint256 deadline)"
    );

    /// @notice Nonces for replay protection (per-address)
    mapping(address => uint256) public nonces;

    // Events
    event ActionVerified(
        address indexed user,
        address indexed submitter,
        bytes32 indexed districtRoot,
        bytes3 country,
        bytes32 nullifier,
        bytes32 actionId
    );
    event VerifierUpgradeInitiated(address indexed newVerifier, uint256 executeTime);
    event VerifierUpgraded(address indexed previousVerifier, address indexed newVerifier);
    event VerifierUpgradeCancelled(address indexed target);
    event CampaignRegistrySet(address indexed previousRegistry, address indexed newRegistry);
    event ContractPaused(address indexed governance);
    event ContractUnpaused(address indexed governance);

    // Errors
    error VerificationFailed();
    error UnauthorizedDistrict();
    error DistrictNotRegistered();
    error InvalidSignature();
    error SignatureExpired();
    error UpgradeNotInitiated();

    /// @notice Deploy gate with verifier, registries, and governance
    /// @param _verifier Address of deployed ZK verifier contract
    /// @param _districtRegistry Address of deployed DistrictRegistry contract
    /// @param _nullifierRegistry Address of deployed NullifierRegistry contract
    /// @param _governance Governance address (initially founder, later multisig)
    constructor(
        address _verifier,
        address _districtRegistry,
        address _nullifierRegistry,
        address _governance
    ) {
        if (_verifier == address(0)) revert ZeroAddress();
        if (_districtRegistry == address(0)) revert ZeroAddress();
        if (_nullifierRegistry == address(0)) revert ZeroAddress();

        _initializeGovernance(_governance);

        verifier = _verifier;
        districtRegistry = DistrictRegistry(_districtRegistry);
        nullifierRegistry = NullifierRegistry(_nullifierRegistry);

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("DistrictGate")),
                keccak256(bytes("4")), // Version 4: Phase 1 honest governance
                block.chainid,
                address(this)
            )
        );
    }

    // ============================================================================
    // Proof Verification
    // ============================================================================

    /// @notice Verify district membership proof with EIP-712 signature (MEV-resistant)
    /// @param signer Address that signed the proof submission
    /// @param proof ZK proof bytes
    /// @param districtRoot Merkle root of the district
    /// @param nullifier Unique nullifier for this action
    /// @param actionId Action identifier (any bytes32 is valid)
    /// @param expectedCountry Expected country code for the district
    /// @param deadline Signature expiration timestamp
    /// @param signature EIP-712 signature from signer
    function verifyAndAuthorizeWithSignature(
        address signer,
        bytes calldata proof,
        bytes32 districtRoot,
        bytes32 nullifier,
        bytes32 actionId,
        bytes3 expectedCountry,
        uint256 deadline,
        bytes calldata signature
    ) external whenNotPaused {
        if (signer == address(0)) revert ZeroAddress();
        if (block.timestamp > deadline) revert SignatureExpired();

        // Compute EIP-712 digest
        bytes32 proofHash = keccak256(proof);
        bytes32 structHash = keccak256(
            abi.encode(
                SUBMIT_PROOF_TYPEHASH,
                proofHash,
                districtRoot,
                nullifier,
                actionId,
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

        // Step 1: Verify ZK proof
        uint256[3] memory publicInputs = [
            uint256(districtRoot),
            uint256(nullifier),
            uint256(actionId)
        ];

        (bool success, bytes memory result) = verifier.call(
            abi.encodeWithSignature(
                "verifyProof(bytes,uint256[3])",
                proof,
                publicInputs
            )
        );

        if (!success || !abi.decode(result, (bool))) {
            revert VerificationFailed();
        }

        // Step 2: Verify district is registered
        bytes3 actualCountry = districtRegistry.getCountry(districtRoot);
        if (actualCountry == bytes3(0)) revert DistrictNotRegistered();
        if (actualCountry != expectedCountry) revert UnauthorizedDistrict();

        // Step 3: Record nullifier
        nullifierRegistry.recordNullifier(actionId, nullifier, districtRoot);

        // Step 4: Record campaign participation (if registry is set)
        // Fails gracefully if campaignRegistry is not set or action not linked to campaign
        if (address(campaignRegistry) != address(0)) {
            // Use try/catch to ensure verification succeeds even if campaign recording fails
            // This maintains backwards compatibility and prevents campaign issues from blocking verification
            try campaignRegistry.recordParticipation(actionId, districtRoot) {
                // Success - participation recorded
            } catch {
                // Fail silently - action not linked to campaign or campaign paused
                // This is expected behavior for permissionless actions
            }
        }

        emit ActionVerified(
            signer,
            msg.sender,
            districtRoot,
            actualCountry,
            nullifier,
            actionId
        );
    }

    // ============================================================================
    // View Functions
    // ============================================================================

    /// @notice Check if a nullifier has been used for an action
    /// @param actionId Action identifier
    /// @param nullifier Nullifier to check
    /// @return True if nullifier was already used
    function isNullifierUsed(bytes32 actionId, bytes32 nullifier) external view returns (bool) {
        return nullifierRegistry.isNullifierUsed(actionId, nullifier);
    }

    /// @notice Get participant count for an action
    /// @param actionId Action identifier
    /// @return Number of participants
    function getParticipantCount(bytes32 actionId) external view returns (uint256) {
        return nullifierRegistry.getParticipantCount(actionId);
    }

    // ============================================================================
    // Campaign Registry Integration
    // ============================================================================

    /// @notice Set the campaign registry address (governance only)
    /// @param _campaignRegistry Address of CampaignRegistry contract (can be zero to disable)
    /// @dev This is not timelocked because:
    ///      1. CampaignRegistry failure doesn't affect core verification
    ///      2. Setting to zero only disables optional feature
    ///      3. CampaignRegistry has its own governance controls
    function setCampaignRegistry(address _campaignRegistry) external onlyGovernance {
        address previousRegistry = address(campaignRegistry);
        campaignRegistry = CampaignRegistry(_campaignRegistry);
        emit CampaignRegistrySet(previousRegistry, _campaignRegistry);
    }

    // ============================================================================
    // Verifier Upgrade (14-day timelock)
    // ============================================================================

    /// @notice Initiate verifier upgrade (starts 14-day timelock)
    /// @param newVerifier New verifier contract address
    /// @dev Monitor VerifierUpgradeInitiated events - community has 14 days to respond
    function initiateVerifierUpgrade(address newVerifier) external onlyGovernance {
        if (newVerifier == address(0)) revert ZeroAddress();
        if (newVerifier == verifier) revert SameAddress();

        pendingVerifier = newVerifier;
        verifierUpgradeTime = block.timestamp + VERIFIER_UPGRADE_TIMELOCK;

        emit VerifierUpgradeInitiated(newVerifier, verifierUpgradeTime);
    }

    /// @notice Execute verifier upgrade (after 14-day timelock)
    /// @dev Can be called by anyone after timelock expires
    function executeVerifierUpgrade() external {
        if (pendingVerifier == address(0)) revert UpgradeNotInitiated();
        if (block.timestamp < verifierUpgradeTime) revert TimelockNotExpired();

        address previousVerifier = verifier;
        verifier = pendingVerifier;
        delete pendingVerifier;
        delete verifierUpgradeTime;

        emit VerifierUpgraded(previousVerifier, verifier);
    }

    /// @notice Cancel pending verifier upgrade
    function cancelVerifierUpgrade() external onlyGovernance {
        if (pendingVerifier == address(0)) revert UpgradeNotInitiated();

        address target = pendingVerifier;
        delete pendingVerifier;
        delete verifierUpgradeTime;

        emit VerifierUpgradeCancelled(target);
    }

    /// @notice Get time remaining until verifier upgrade can execute
    /// @return secondsRemaining Time in seconds (0 if ready or not initiated)
    function getVerifierUpgradeDelay() external view returns (uint256 secondsRemaining) {
        if (pendingVerifier == address(0) || block.timestamp >= verifierUpgradeTime) {
            return 0;
        }
        return verifierUpgradeTime - block.timestamp;
    }

    // ============================================================================
    // Pause Controls
    // ============================================================================

    /// @notice Pause contract (governance only)
    /// @dev Use for emergency situations. Blocks all proof verification.
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
