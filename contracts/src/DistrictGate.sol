// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "./DistrictRegistry.sol";
import "./NullifierRegistry.sol";
import "./GuardianShield.sol";
import "openzeppelin/utils/cryptography/ECDSA.sol";
import "openzeppelin/security/Pausable.sol";

/// @title DistrictGate
/// @notice Master verification contract for district membership proofs
/// @dev Orchestrates three-step verification:
///      Step 1: ZK proof verification (district membership)
///      Step 2: On-chain registry lookup (district→country mapping)
///      Step 3: Nullifier recording (double-action prevention + rate limiting)
///
/// SECURITY MODEL:
/// - GuardianShield: Multi-jurisdiction veto power against legal coercion
/// - Timelocked upgrades: 7 days for governance, 14 days for verifier
/// - Combined with pause mechanism for emergency response
///
/// NATION-STATE RESISTANCE:
/// - Guardians in different legal jurisdictions can veto malicious transfers
/// - 14-day verifier upgrade timelock allows community response to bugs
/// - Single guardian veto blocks any pending transfer/upgrade
contract DistrictGate is Pausable, GuardianShield {
    /// @notice Address of the ZK verifier contract (upgradeable with timelock)
    address public verifier;
    
    /// @notice Pending verifier upgrade
    address public pendingVerifier;
    
    /// @notice Execution timestamp for verifier upgrade
    uint256 public verifierUpgradeTime;
    
    /// @notice Timelock for verifier upgrades (14 days - more critical than governance)
    uint256 public constant VERIFIER_UPGRADE_TIMELOCK = 14 days;

    /// @notice Address of the district registry
    DistrictRegistry public immutable districtRegistry;

    /// @notice Address of the nullifier registry
    NullifierRegistry public immutable nullifierRegistry;

    /// @notice Authorized action IDs (only these can be proven)
    mapping(bytes32 => bool) public authorizedActions;

    /// @notice Multi-sig governance address
    address public governance;

    /// @notice Timelock period for governance transfers (7 days)
    uint256 public constant GOVERNANCE_TIMELOCK = 7 days;

    /// @notice Pending governance transfer target → execution timestamp
    mapping(address => uint256) public pendingGovernance;

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
    event ActionAuthorized(bytes32 indexed actionId, bool authorized);
    event GovernanceTransferInitiated(address indexed newGovernance, uint256 executeTime);
    event GovernanceTransferred(address indexed previousGovernance, address indexed newGovernance);
    event GovernanceTransferCancelled(address indexed newGovernance);
    event VerifierUpgradeInitiated(address indexed newVerifier, uint256 executeTime);
    event VerifierUpgraded(address indexed previousVerifier, address indexed newVerifier);
    event VerifierUpgradeCancelled(address indexed target);
    event ContractPaused(address indexed governance);
    event ContractUnpaused(address indexed governance);

    // Errors
    error VerificationFailed();
    error UnauthorizedDistrict();
    error DistrictNotRegistered();
    error ActionNotAuthorized();
    error UnauthorizedCaller();
    error ZeroAddress();
    error InvalidSignature();
    error SignatureExpired();
    error TransferNotInitiated();
    error TimelockNotExpired();
    error UpgradeNotInitiated();

    modifier onlyGovernance() {
        if (msg.sender != governance) revert UnauthorizedCaller();
        _;
    }

    /// @notice Deploy gate with verifier, registries, governance, and initial guardians
    /// @param _verifier Address of deployed ZK verifier contract
    /// @param _districtRegistry Address of deployed DistrictRegistry contract
    /// @param _nullifierRegistry Address of deployed NullifierRegistry contract
    /// @param _governance Multi-sig governance address
    /// @param _guardians Initial guardian addresses (min 2, different jurisdictions)
    constructor(
        address _verifier,
        address _districtRegistry,
        address _nullifierRegistry,
        address _governance,
        address[] memory _guardians
    ) {
        if (_verifier == address(0)) revert ZeroAddress();
        if (_districtRegistry == address(0)) revert ZeroAddress();
        if (_nullifierRegistry == address(0)) revert ZeroAddress();
        if (_governance == address(0)) revert ZeroAddress();
        if (_guardians.length < MIN_GUARDIANS) revert InsufficientGuardians();

        verifier = _verifier;
        districtRegistry = DistrictRegistry(_districtRegistry);
        nullifierRegistry = NullifierRegistry(_nullifierRegistry);
        governance = _governance;

        // Initialize guardians
        for (uint256 i = 0; i < _guardians.length; i++) {
            if (_guardians[i] == address(0)) revert ZeroAddress();
            _addGuardian(_guardians[i]);
        }

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("DistrictGate")),
                keccak256(bytes("3")), // Version 3 with GuardianShield
                block.chainid,
                address(this)
            )
        );
    }

    // ============================================================================
    // Proof Verification
    // ============================================================================

    /// @notice Verify district membership proof with EIP-712 signature (MEV-resistant)
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
        if (!authorizedActions[actionId]) revert ActionNotAuthorized();

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

    function isNullifierUsed(bytes32 actionId, bytes32 nullifier) external view returns (bool) {
        return nullifierRegistry.isNullifierUsed(actionId, nullifier);
    }

    function getParticipantCount(bytes32 actionId) external view returns (uint256) {
        return nullifierRegistry.getParticipantCount(actionId);
    }

    function isActionAuthorized(bytes32 actionId) external view returns (bool) {
        return authorizedActions[actionId];
    }

    // ============================================================================
    // Action Authorization
    // ============================================================================

    function authorizeAction(bytes32 actionId) external onlyGovernance {
        require(actionId != bytes32(0), "Invalid action ID");
        authorizedActions[actionId] = true;
        emit ActionAuthorized(actionId, true);
    }

    function deauthorizeAction(bytes32 actionId) external onlyGovernance {
        authorizedActions[actionId] = false;
        emit ActionAuthorized(actionId, false);
    }

    function batchAuthorizeActions(bytes32[] calldata actionIds) external onlyGovernance {
        for (uint256 i = 0; i < actionIds.length; ) {
            bytes32 actionId = actionIds[i];
            require(actionId != bytes32(0), "Invalid action ID");
            authorizedActions[actionId] = true;
            emit ActionAuthorized(actionId, true);
            unchecked { ++i; }
        }
    }

    // ============================================================================
    // Governance Transfer (7-day timelock + Guardian veto)
    // ============================================================================

    function initiateGovernanceTransfer(address newGovernance) external onlyGovernance {
        if (newGovernance == address(0)) revert ZeroAddress();
        if (newGovernance == governance) revert ZeroAddress();

        uint256 executeTime = block.timestamp + GOVERNANCE_TIMELOCK;
        pendingGovernance[newGovernance] = executeTime;

        emit GovernanceTransferInitiated(newGovernance, executeTime);
    }

    function executeGovernanceTransfer(address newGovernance) external {
        uint256 executeTime = pendingGovernance[newGovernance];
        if (executeTime == 0) revert TransferNotInitiated();
        if (block.timestamp < executeTime) revert TimelockNotExpired();
        if (isVetoed(newGovernance)) revert TransferVetoed();

        address previousGovernance = governance;
        governance = newGovernance;
        delete pendingGovernance[newGovernance];

        emit GovernanceTransferred(previousGovernance, newGovernance);
    }

    function cancelGovernanceTransfer(address newGovernance) external onlyGovernance {
        if (pendingGovernance[newGovernance] == 0) revert TransferNotInitiated();

        delete pendingGovernance[newGovernance];
        _clearVeto(newGovernance);
        emit GovernanceTransferCancelled(newGovernance);
    }

    // ============================================================================
    // Verifier Upgrade (14-day timelock + Guardian veto)
    // ============================================================================

    /// @notice Initiate verifier upgrade (starts 14-day timelock)
    /// @param newVerifier New verifier contract address
    function initiateVerifierUpgrade(address newVerifier) external onlyGovernance {
        if (newVerifier == address(0)) revert ZeroAddress();
        if (newVerifier == verifier) revert ZeroAddress();

        pendingVerifier = newVerifier;
        verifierUpgradeTime = block.timestamp + VERIFIER_UPGRADE_TIMELOCK;

        emit VerifierUpgradeInitiated(newVerifier, verifierUpgradeTime);
    }

    /// @notice Execute verifier upgrade (after 14-day timelock, if not vetoed)
    function executeVerifierUpgrade() external {
        if (pendingVerifier == address(0)) revert UpgradeNotInitiated();
        if (block.timestamp < verifierUpgradeTime) revert TimelockNotExpired();
        if (isVetoed(pendingVerifier)) revert TransferVetoed();

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
        _clearVeto(target);

        emit VerifierUpgradeCancelled(target);
    }

    // ============================================================================
    // Guardian Management
    // ============================================================================

    /// @notice Add a guardian (governance only)
    function addGuardian(address guardian) external onlyGovernance {
        if (guardian == address(0)) revert ZeroAddress();
        _addGuardian(guardian);
    }

    /// @notice Remove a guardian (governance only)
    function removeGuardian(address guardian) external onlyGovernance {
        _removeGuardian(guardian);
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
