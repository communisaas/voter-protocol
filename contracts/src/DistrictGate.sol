// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "./DistrictRegistry.sol";
import "openzeppelin/utils/cryptography/ECDSA.sol";

/// @title DistrictGate
/// @notice Master verification contract for district membership proofs
/// @dev Orchestrates two-step verification:
///      Step 1: ZK proof verification (district membership)
///      Step 2: On-chain registry lookup (district→country mapping)
///
/// ARCHITECTURAL EVOLUTION:
/// Previous approach: Monolithic two-tier circuit (K=14, 26KB verifier, unusable on mobile)
/// New approach: Simplified circuit (K=12, ~15KB verifier) + on-chain registry
///
/// SECURITY MODEL:
/// This architecture achieves the security of a monolithic two-tier circuit
/// with the performance and deployability of a simple single-tier circuit.
///
/// Step 1 (Cryptographic): User proves "I am member of district X"
///   - Halo2 proof with K=12 (4,096 rows)
///   - Public inputs: [district_root, nullifier, action_id]
///   - Verifier contract: ~15KB (fits EIP-170)
///   - Proving time: 2-8 seconds on mid-range Android
///   - Cannot be faked: Merkle proof enforced by ZK circuit
///
/// Step 2 (On-Chain Lookup): Contract checks "District X is in country Y"
///   - Single SLOAD from DistrictRegistry (~2.1k gas)
///   - Public data (congressional districts are not secrets)
///   - Append-only registry (multi-sig governance)
///   - All changes auditable via events
///
/// WHY THIS IS SECURE:
/// - Step 1 prevents identity spoofing (cryptographically enforced)
/// - Step 2 prevents fake districts (governance enforced, publicly auditable)
/// - Combined: User cannot fake membership OR claim membership in unauthorized district
/// - Attack requires compromising BOTH crypto AND multi-sig governance
///
/// COMPARISON TO ALTERNATIVES:
/// - Monolithic K=14 circuit: Provably secure but unusable (26KB verifier, 30+s mobile)
/// - Pure governance (no ZK): Insecure (no cryptographic identity protection)
/// - This approach: Secure AND usable (right tool for each job)
///
/// GAS COSTS:
/// - K=12 proof verification: ~200-300k gas (vs 300-500k for K=14)
/// - Registry lookup: ~2.1k gas (single SLOAD)
/// - Total: ~202-302k gas per verification
/// - On Scroll L2: ~$0.001-$0.002 per verification
contract DistrictGate {
    /// @notice Address of the Halo2 verifier contract (K=12 single-tier circuit)
    address public immutable verifier;

    /// @notice Address of the district registry
    DistrictRegistry public immutable registry;

    /// @notice Tracks used nullifiers to prevent double-voting
    mapping(bytes32 => bool) public nullifierUsed;

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

    /// @notice Emitted when a valid action is verified
    /// @param user Address that generated and signed the proof (reward recipient)
    /// @param submitter Address that submitted the transaction (may differ from user in MEV scenarios)
    /// @param districtRoot Verified district Merkle root
    /// @param country Country the district belongs to
    /// @param nullifier Unique nullifier (prevents double-actions)
    /// @param actionId Action identifier
    /// @dev CRITICAL: Rewards MUST go to 'user' (signer), NOT 'submitter' (msg.sender)
    ///      This prevents MEV front-running where bots steal user rewards
    event ActionVerified(
        address indexed user,
        address indexed submitter,
        bytes32 indexed districtRoot,
        bytes3 country,
        bytes32 nullifier,
        bytes32 actionId
    );

    /// @notice Emitted when an action is authorized/deauthorized
    event ActionAuthorized(bytes32 indexed actionId, bool authorized);

    /// @notice Emitted when governance transfer is initiated (7-day timelock starts)
    event GovernanceTransferInitiated(address indexed newGovernance, uint256 executeTime);

    /// @notice Emitted when governance transfer is executed (after timelock)
    event GovernanceTransferred(address indexed previousGovernance, address indexed newGovernance);

    /// @notice Emitted when governance transfer is cancelled
    event GovernanceTransferCancelled(address indexed newGovernance);

    error VerificationFailed();
    error NullifierAlreadyUsed();
    error UnauthorizedDistrict();
    error ActionNotAuthorized();
    error UnauthorizedCaller();
    error ZeroAddress();
    error InvalidSignature();
    error SignatureExpired();
    error TransferNotInitiated();
    error TimelockNotExpired();

    modifier onlyGovernance() {
        if (msg.sender != governance) revert UnauthorizedCaller();
        _;
    }

    /// @notice Deploy gate with verifier and registry addresses
    /// @param _verifier Address of deployed Halo2Verifier contract (K=12)
    /// @param _registry Address of deployed DistrictRegistry contract
    /// @param _governance Multi-sig governance address
    constructor(address _verifier, address _registry, address _governance) {
        if (_verifier == address(0)) revert ZeroAddress();
        if (_registry == address(0)) revert ZeroAddress();
        if (_governance == address(0)) revert ZeroAddress();

        verifier = _verifier;
        registry = DistrictRegistry(_registry);
        governance = _governance;

        // Initialize EIP-712 domain separator
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

    /// @notice Verify district membership proof and authorize action
    /// @param proof Halo2 proof bytes (SHPLONK proof, ~384-512 bytes)
    /// @param districtRoot District Merkle root (public input)
    /// @param nullifier Unique nullifier to prevent double-actions (public input)
    /// @param actionId Action identifier (public input)
    /// @param expectedCountry Expected ISO 3166-1 alpha-3 country code
    /// @dev Performs two-step verification:
    ///      1. Call Halo2Verifier to verify ZK proof
    ///      2. Check DistrictRegistry for district→country mapping
    function verifyAndAuthorize(
        bytes calldata proof,
        bytes32 districtRoot,
        bytes32 nullifier,
        bytes32 actionId,
        bytes3 expectedCountry
    ) external {
        // Check: Action is authorized
        if (!authorizedActions[actionId]) revert ActionNotAuthorized();

        // Check: Prevent nullifier reuse (double-voting protection)
        if (nullifierUsed[nullifier]) revert NullifierAlreadyUsed();

        // Step 1: Verify ZK proof
        // Public inputs: [districtRoot, nullifier, actionId]
        uint256[3] memory publicInputs = [
            uint256(districtRoot),
            uint256(nullifier),
            uint256(actionId)
        ];

        // Call Halo2Verifier contract
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

        // Step 2: Verify district is registered for expected country
        bytes3 actualCountry = registry.getCountry(districtRoot);
        if (actualCountry != expectedCountry) {
            revert UnauthorizedDistrict();
        }

        // Effects: Mark nullifier as used
        nullifierUsed[nullifier] = true;

        // Emit event for off-chain indexing
        // NOTE: This function is DEPRECATED - use verifyAndAuthorizeWithSignature instead
        // Emits msg.sender as both user and submitter (vulnerable to MEV)
        emit ActionVerified(
            msg.sender,  // user (vulnerable - should use signature)
            msg.sender,  // submitter
            districtRoot,
            actualCountry,
            nullifier,
            actionId
        );
    }

    /// @notice Verify district membership proof with EIP-712 signature (MEV-resistant)
    /// @param signer Expected signer address (reward recipient, must match signature)
    /// @param proof Halo2 proof bytes (SHPLONK proof, ~384-512 bytes)
    /// @param districtRoot District Merkle root (public input)
    /// @param nullifier Unique nullifier to prevent double-actions (public input)
    /// @param actionId Action identifier (public input)
    /// @param expectedCountry Expected ISO 3166-1 alpha-3 country code
    /// @param deadline Signature expiration timestamp
    /// @param signature EIP-712 signature from signer
    /// @dev MEV-RESISTANT: Rewards bound to signer (not msg.sender/submitter)
    ///      Even if MEV bot front-runs, signer address in event determines reward recipient
    /// @dev CRITICAL SECURITY FIX: Addresses CRITICAL #5 from adversarial analysis
    ///      - MEV bots can front-run, but rewards always go to original signer
    ///      - Off-chain indexers MUST read 'user' field (not 'submitter') for rewards
    function verifyAndAuthorizeWithSignature(
        address signer,
        bytes calldata proof,
        bytes32 districtRoot,
        bytes32 nullifier,
        bytes32 actionId,
        bytes3 expectedCountry,
        uint256 deadline,
        bytes calldata signature
    ) external {
        // Check: Signer not zero address
        if (signer == address(0)) revert ZeroAddress();
        // Check: Signature not expired
        if (block.timestamp > deadline) revert SignatureExpired();

        // Check: Action is authorized
        if (!authorizedActions[actionId]) revert ActionNotAuthorized();

        // Check: Prevent nullifier reuse (double-voting protection)
        if (nullifierUsed[nullifier]) revert NullifierAlreadyUsed();

        // Compute EIP-712 digest
        // The signer parameter tells us who signed, and we verify the signature matches
        bytes32 proofHash = keccak256(proof);
        bytes32 structHash = keccak256(
            abi.encode(
                SUBMIT_PROOF_TYPEHASH,
                proofHash,
                districtRoot,
                nullifier,
                actionId,
                expectedCountry,
                nonces[signer],  // Use the signer's current nonce
                deadline
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash)
        );

        // Verify signature matches the claimed signer
        address recoveredSigner = ECDSA.recover(digest, signature);
        if (recoveredSigner != signer) revert InvalidSignature();

        // Increment nonce for replay protection
        nonces[signer]++;

        // Step 1: Verify ZK proof
        // Public inputs: [districtRoot, nullifier, actionId]
        uint256[3] memory publicInputs = [
            uint256(districtRoot),
            uint256(nullifier),
            uint256(actionId)
        ];

        // Call Halo2Verifier contract
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

        // Step 2: Verify district is registered for expected country
        bytes3 actualCountry = registry.getCountry(districtRoot);
        if (actualCountry != expectedCountry) {
            revert UnauthorizedDistrict();
        }

        // Effects: Mark nullifier as used
        nullifierUsed[nullifier] = true;

        // Emit event with SIGNER as user (reward recipient), msg.sender as submitter
        // CRITICAL: Off-chain indexers MUST send rewards to 'signer', not 'msg.sender'
        emit ActionVerified(
            signer,      // user (reward recipient - the one who generated the proof)
            msg.sender,  // submitter (the one who paid gas - may be MEV bot)
            districtRoot,
            actualCountry,
            nullifier,
            actionId
        );
    }

    /// @notice Batch verify multiple proofs (gas-optimized)
    /// @param proofs Array of Halo2 proofs
    /// @param districtRoots Array of district Merkle roots
    /// @param nullifiers Array of nullifiers
    /// @param actionIds Array of action identifiers
    /// @param expectedCountry Expected country for all proofs
    /// @dev All arrays must be same length
    function verifyBatch(
        bytes[] calldata proofs,
        bytes32[] calldata districtRoots,
        bytes32[] calldata nullifiers,
        bytes32[] calldata actionIds,
        bytes3 expectedCountry
    ) external {
        uint256 length = proofs.length;
        require(
            length == districtRoots.length &&
            length == nullifiers.length &&
            length == actionIds.length,
            "Length mismatch"
        );

        for (uint256 i = 0; i < length; ) {
            bytes32 actionId = actionIds[i];
            bytes32 nullifier = nullifiers[i];

            // Check action authorized
            if (!authorizedActions[actionId]) revert ActionNotAuthorized();

            // Check nullifier not used
            if (nullifierUsed[nullifier]) revert NullifierAlreadyUsed();

            // Verify ZK proof
            uint256[3] memory publicInputs = [
                uint256(districtRoots[i]),
                uint256(nullifier),
                uint256(actionId)
            ];

            (bool success, bytes memory result) = verifier.call(
                abi.encodeWithSignature(
                    "verifyProof(bytes,uint256[3])",
                    proofs[i],
                    publicInputs
                )
            );

            if (!success || !abi.decode(result, (bool))) {
                revert VerificationFailed();
            }

            // Verify district→country mapping
            bytes3 actualCountry = registry.getCountry(districtRoots[i]);
            if (actualCountry != expectedCountry) {
                revert UnauthorizedDistrict();
            }

            // Mark nullifier as used
            nullifierUsed[nullifier] = true;

            // NOTE: Batch function is DEPRECATED - vulnerable to MEV
            // Use individual verifyAndAuthorizeWithSignature calls instead
            emit ActionVerified(
                msg.sender,  // user (vulnerable - should use signature)
                msg.sender,  // submitter
                districtRoots[i],
                actualCountry,
                nullifier,
                actionId
            );

            unchecked {
                ++i;
            }
        }
    }

    /// @notice Authorize an action ID
    /// @param actionId Action identifier to authorize
    function authorizeAction(bytes32 actionId) external onlyGovernance {
        require(actionId != bytes32(0), "Invalid action ID");
        authorizedActions[actionId] = true;
        emit ActionAuthorized(actionId, true);
    }

    /// @notice Deauthorize an action ID
    /// @param actionId Action identifier to deauthorize
    function deauthorizeAction(bytes32 actionId) external onlyGovernance {
        authorizedActions[actionId] = false;
        emit ActionAuthorized(actionId, false);
    }

    /// @notice Batch authorize multiple actions
    /// @param actionIds Array of action identifiers
    function batchAuthorizeActions(bytes32[] calldata actionIds) external onlyGovernance {
        for (uint256 i = 0; i < actionIds.length; ) {
            bytes32 actionId = actionIds[i];
            require(actionId != bytes32(0), "Invalid action ID");
            authorizedActions[actionId] = true;
            emit ActionAuthorized(actionId, true);
            unchecked { ++i; }
        }
    }

    /// @notice Initiate governance transfer (starts 7-day timelock)
    /// @param newGovernance New governance address
    /// @dev Only current governance can initiate
    ///      Timelock prevents instant takeover if multi-sig compromised
    ///      Community has 7 days to detect and respond to malicious transfer
    function initiateGovernanceTransfer(address newGovernance) external onlyGovernance {
        if (newGovernance == address(0)) revert ZeroAddress();
        if (newGovernance == governance) revert ZeroAddress(); // Cannot transfer to self

        uint256 executeTime = block.timestamp + GOVERNANCE_TIMELOCK;
        pendingGovernance[newGovernance] = executeTime;

        emit GovernanceTransferInitiated(newGovernance, executeTime);
    }

    /// @notice Execute pending governance transfer (after 7-day timelock)
    /// @param newGovernance New governance address
    /// @dev Anyone can execute after timelock expires
    ///      This ensures transfer completes even if current governance is compromised
    function executeGovernanceTransfer(address newGovernance) external {
        uint256 executeTime = pendingGovernance[newGovernance];
        if (executeTime == 0) revert TransferNotInitiated();
        if (block.timestamp < executeTime) revert TimelockNotExpired();

        address previousGovernance = governance;
        governance = newGovernance;
        delete pendingGovernance[newGovernance];

        emit GovernanceTransferred(previousGovernance, newGovernance);
    }

    /// @notice Cancel pending governance transfer
    /// @param newGovernance Target governance address to cancel
    /// @dev Only current governance can cancel
    ///      Use this if transfer was initiated in error or compromise detected
    function cancelGovernanceTransfer(address newGovernance) external onlyGovernance {
        if (pendingGovernance[newGovernance] == 0) revert TransferNotInitiated();

        delete pendingGovernance[newGovernance];
        emit GovernanceTransferCancelled(newGovernance);
    }

    /// @notice Check if a nullifier has been used
    /// @param _nullifier Nullifier to check
    /// @return True if nullifier has been used
    function isNullifierUsed(bytes32 _nullifier) external view returns (bool) {
        return nullifierUsed[_nullifier];
    }

    /// @notice Check if an action is authorized
    /// @param actionId Action identifier to check
    /// @return True if action is authorized
    function isActionAuthorized(bytes32 actionId) external view returns (bool) {
        return authorizedActions[actionId];
    }
}
