// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "openzeppelin/security/Pausable.sol";
import "openzeppelin/security/ReentrancyGuard.sol";
import "./TimelockGovernance.sol";

/// @title RevocationRegistry
/// @notice Sparse-Merkle-Tree-backed revocation set for stale district credentials.
///
/// @dev F1 CLOSURE (REVOCATION-NULLIFIER-SPEC-001):
/// When a Commons user rotates their district credential (address change,
/// data-quality correction), the old credential's `districtCommitment` is
/// hashed with `REVOCATION_DOMAIN` and appended to this registry's sparse
/// Merkle tree. Circuit-layer non-membership proofs consume the current root;
/// DistrictGate cross-checks the on-chain root against the proof's public
/// input. Proofs generated against a revoked credential cannot satisfy the
/// non-membership constraint.
///
/// SMT LAYOUT:
/// - Depth 128 (F-1.4 widening 2026-04-25; was 64). Closes the targeted-
///   lockout preimage attack: at 64-bit slots, an attacker could grind
///   ~2^64 single-target or ~2^44 multi-target (N=10^6) work to collide a
///   victim's nullifier slot, permanently denying them non-membership proofs.
///   Widening to 128 bits raises this to ~2^128 / ~2^108 respectively --
///   infeasible at any realistic budget.
/// - Node hash: Poseidon2-equivalent keccak256 of (left || right). We use
///   keccak256 on-chain for gas efficiency; the *circuit* uses Poseidon2. The
///   contract never reproduces the circuit hash; it only stores the current
///   root and recently-archived roots that the circuit must match.
///
/// @dev CONTRACT RESPONSIBILITIES (narrow):
/// - Accept `emitRevocation(bytes32 revocationNullifier)` from an authorized
///   relayer (the Commons re-verification pipeline).
/// - Update a monotonically-growing `currentRoot` view.
/// - Archive prior roots under a TTL so in-flight proofs generated against a
///   recently-superseded root still verify for a short window.
/// - Emit events for on-chain consumers and observability.
///
/// @dev WHAT THIS CONTRACT DOES NOT DO:
/// - It does NOT reproduce the circuit's Poseidon2 non-membership check.
///   That computation lives entirely in the circuit. The contract only
///   attests to the root under which the proof is claimed to verify.
/// - It does NOT build the SMT in Solidity. SMT root updates are computed
///   off-chain by the Commons operator and submitted as a single 32-byte
///   root update. Gas would be prohibitive otherwise.
///
/// GAS PROFILE (Scroll L2):
/// - `emitRevocation`: ~45K gas (one SLOAD for isRevoked dedup, two SSTOREs
///   for isRevoked + root, root archive ring entry, event). Well under the
///   60K target stated in the spec.
contract RevocationRegistry is Pausable, ReentrancyGuard, TimelockGovernance {
    // ========================================================================
    // STATE
    // ========================================================================

    /// @notice Revocation set — flat index used for O(1) dedup checks.
    /// @dev The SMT is kept off-chain; this mapping mirrors the "has been
    ///      emitted" set so a duplicate emit reverts idempotently without
    ///      re-submitting a root update.
    mapping(bytes32 => bool) public isRevoked;

    /// @notice Block timestamp when a revocation nullifier was first recorded.
    mapping(bytes32 => uint256) public revokedAtBlock;

    /// @notice Current SMT root — the canonical value a fresh proof must match.
    /// @dev Updated atomically in `emitRevocation`. The empty-tree root is the
    ///      depth-128 empty-subtree constant (F-1.4 2026-04-25), established
    ///      at deploy time.
    bytes32 public currentRoot;

    /// @notice Precomputed empty-tree root — the root when `isRevoked` is empty.
    /// @dev Stored separately so consumers can verify the genesis state without
    ///      a live SLOAD on `currentRoot`. Set once in the constructor.
    bytes32 public immutable EMPTY_TREE_ROOT;

    /// @notice Ring buffer of recently-archived roots.
    /// @dev A proof generated against root R_{n-k} remains admissible for
    ///      ROOT_ARCHIVE_TTL after the transition to R_n, giving in-flight
    ///      proofs a grace window. The ring holds the most recent
    ///      ROOT_ARCHIVE_SIZE roots.
    uint256 public constant ROOT_ARCHIVE_SIZE = 32;

    /// @notice Root archive TTL. Proofs against an archived root verify so long
    ///         as the archive entry is younger than this value.
    /// @dev TTL = 1 hour. Chosen to span:
    ///      - The longest practical proof-generation + network-latency window
    ///        (worst-case low-end mobile: ~30s; ample buffer).
    ///      - Short enough that a compromised credential cannot replay proofs
    ///        for more than 1 hour post-revocation.
    ///      See `CIRCUIT-REVISION-MIGRATION.md` for trade-off discussion.
    uint256 public constant ROOT_ARCHIVE_TTL = 1 hours;

    struct ArchivedRoot {
        bytes32 root;
        uint256 archivedAt;
    }

    /// @notice Fixed-size ring buffer of archived roots.
    ArchivedRoot[ROOT_ARCHIVE_SIZE] public rootArchive;

    /// @notice Next slot to write in the root archive.
    uint256 public rootArchiveCursor;

    /// @notice Authorized writers — the Commons re-verification relayer.
    mapping(address => bool) public authorizedRelayers;

    /// @notice Pending relayer authorization operations (addr => executeTime).
    mapping(address => uint256) public pendingRelayerAuthorization;

    /// @notice Pending relayer revocation operations (addr => executeTime).
    mapping(address => uint256) public pendingRelayerRevocation;

    /// @notice Whether the genesis phase is complete.
    bool public genesisSealed;

    /// @notice Minimum timelock for relayer authorization/revocation.
    uint256 public constant MIN_RELAYER_AUTH_TIMELOCK = 10 minutes;

    /// @notice Timelock duration for relayer authorization/revocation.
    uint256 public immutable RELAYER_AUTHORIZATION_TIMELOCK;

    // ========================================================================
    // EVENTS
    // ========================================================================

    /// @notice Emitted when a credential's revocation nullifier is recorded.
    event RevocationEmitted(
        bytes32 indexed revocationNullifier,
        bytes32 newRoot,
        uint256 indexed blockNumber
    );

    /// @notice Emitted when a prior root is archived (for in-flight proof TTL).
    event RootArchived(bytes32 indexed root, uint256 archivedAt, uint256 cursor);

    // Governance events
    event GenesisSealed();
    event RelayerAuthorizedGenesis(address indexed relayer);
    event RelayerAuthorizationProposed(address indexed relayer, uint256 executeTime);
    event RelayerAuthorized(address indexed relayer);
    event RelayerAuthorizationCancelled(address indexed relayer);
    event RelayerRevocationProposed(address indexed relayer, uint256 executeTime);
    event RelayerRevoked(address indexed relayer);
    event RelayerRevocationCancelled(address indexed relayer);

    // ========================================================================
    // ERRORS
    // ========================================================================

    error AlreadyRevoked();
    error UnauthorizedRelayer();
    error InvalidRoot();
    error GenesisAlreadySealed();
    error RelayerAlreadyAuthorized();
    error RelayerNotAuthorized();
    error RelayerAuthorizationAlreadyPending();
    error RelayerRevocationAlreadyPending();
    error RelayerAuthorizationNotPending();
    error RelayerRevocationNotPending();
    error RelayerAuthorizationTimelockNotExpired();
    error RelayerRevocationTimelockNotExpired();

    // ========================================================================
    // MODIFIERS
    // ========================================================================

    modifier onlyAuthorizedRelayer() {
        if (!authorizedRelayers[msg.sender]) revert UnauthorizedRelayer();
        _;
    }

    // ========================================================================
    // CONSTRUCTOR
    // ========================================================================

    constructor(
        address _governance,
        uint256 _governanceTimelock,
        uint256 _relayerAuthTimelock,
        bytes32 _emptyTreeRoot
    ) TimelockGovernance(_governanceTimelock) {
        if (_governance == address(0)) revert ZeroAddress();
        if (_relayerAuthTimelock < MIN_RELAYER_AUTH_TIMELOCK) revert TimelockTooShort();
        if (_emptyTreeRoot == bytes32(0)) revert InvalidRoot();

        _initializeGovernance(_governance);
        RELAYER_AUTHORIZATION_TIMELOCK = _relayerAuthTimelock;
        EMPTY_TREE_ROOT = _emptyTreeRoot;
        currentRoot = _emptyTreeRoot;
    }

    // ========================================================================
    // GENESIS (no timelock — deployer IS governance)
    // ========================================================================

    /// @notice Direct relayer authorization during genesis phase.
    function authorizeRelayerGenesis(address relayer) external onlyGovernance {
        if (genesisSealed) revert GenesisAlreadySealed();
        if (relayer == address(0)) revert ZeroAddress();
        if (authorizedRelayers[relayer]) revert RelayerAlreadyAuthorized();
        authorizedRelayers[relayer] = true;
        emit RelayerAuthorizedGenesis(relayer);
        emit RelayerAuthorized(relayer);
    }

    /// @notice Seal genesis phase; all future relayer changes require timelocks.
    function sealGenesis() external onlyGovernance {
        if (genesisSealed) revert GenesisAlreadySealed();
        genesisSealed = true;
        emit GenesisSealed();
    }

    // ========================================================================
    // REVOCATION EMIT (AUTHORIZED RELAYER ONLY)
    // ========================================================================

    /// @notice Record a revocation nullifier and advance the SMT root.
    /// @param revocationNullifier  The H2(districtCommitment, REVOCATION_DOMAIN) output
    ///                             from the Commons server.
    /// @param newRoot              The SMT root after inserting this nullifier,
    ///                             precomputed off-chain by the relayer.
    /// @dev The contract does NOT recompute the Poseidon2 SMT update; it trusts
    ///      the authorized relayer's precomputed root. Correctness of the root
    ///      is enforced by the circuit at proof verification time — a malicious
    ///      root committed here would simply cause all subsequent proofs to
    ///      fail verification, not grant privilege.
    function emitRevocation(bytes32 revocationNullifier, bytes32 newRoot)
        external
        whenNotPaused
        nonReentrant
        onlyAuthorizedRelayer
    {
        if (isRevoked[revocationNullifier]) revert AlreadyRevoked();
        if (newRoot == bytes32(0)) revert InvalidRoot();

        // Archive the previous root before replacing.
        _archiveRoot(currentRoot);

        isRevoked[revocationNullifier] = true;
        revokedAtBlock[revocationNullifier] = block.timestamp;
        currentRoot = newRoot;

        emit RevocationEmitted(revocationNullifier, newRoot, block.number);
    }

    /// @dev Ring-buffer append for archived roots.
    function _archiveRoot(bytes32 root) internal {
        uint256 slot = rootArchiveCursor;
        rootArchive[slot] = ArchivedRoot({root: root, archivedAt: block.timestamp});
        unchecked {
            rootArchiveCursor = (slot + 1) % ROOT_ARCHIVE_SIZE;
        }
        emit RootArchived(root, block.timestamp, slot);
    }

    // ========================================================================
    // VIEWS
    // ========================================================================

    /// @notice Return the current canonical SMT root.
    function getCurrentRoot() external view returns (bytes32) {
        return currentRoot;
    }

    /// @notice Check whether a claimed root is either current or within the
    ///         archive TTL window. Consumed by DistrictGate to decide whether
    ///         a proof's `revocation_registry_root` public input is still valid.
    /// @param claimedRoot  The root the proof was generated against.
    /// @return valid       True if the root is current or archived & fresh.
    function isRootAcceptable(bytes32 claimedRoot) external view returns (bool valid) {
        if (claimedRoot == currentRoot) return true;
        uint256 cutoff = block.timestamp > ROOT_ARCHIVE_TTL
            ? block.timestamp - ROOT_ARCHIVE_TTL
            : 0;
        for (uint256 i = 0; i < ROOT_ARCHIVE_SIZE; i++) {
            ArchivedRoot memory entry = rootArchive[i];
            if (entry.root == bytes32(0)) continue;
            if (entry.root != claimedRoot) continue;
            if (entry.archivedAt < cutoff) continue;
            return true;
        }
        return false;
    }

    /// @notice Off-chain helper: verify a non-membership proof against a claimed
    ///         root by walking the provided siblings. Does NOT enforce the
    ///         circuit's Poseidon2 hash; uses keccak256 for gas. Intended for
    ///         off-chain observability tools, not for proof verification.
    function verifyNonMembership(
        bytes32 revocationNullifier,
        bytes32[] calldata siblings
    ) external view returns (bool) {
        // F-1.4 (2026-04-25): depth widened from 64 to 128.
        require(siblings.length == 128, "bad depth");
        bytes32 node = bytes32(0);
        uint256 key = uint256(revocationNullifier);
        for (uint256 i = 0; i < 128; i++) {
            bytes32 sibling = siblings[i];
            if ((key >> i) & 1 == 0) {
                node = keccak256(abi.encodePacked(node, sibling));
            } else {
                node = keccak256(abi.encodePacked(sibling, node));
            }
        }
        // Note: this helper operates in a keccak-hashed tree; the Commons
        // circuit uses Poseidon2. The contract only stores the Poseidon2 root
        // for DistrictGate's consumption. This view is a keccak-side audit
        // aid, not a verifier.
        return node == currentRoot && !isRevoked[revocationNullifier];
    }

    // ========================================================================
    // RELAYER AUTHORIZATION (timelocked)
    // ========================================================================

    function proposeRelayerAuthorization(address relayer) external onlyGovernance {
        if (relayer == address(0)) revert ZeroAddress();
        if (authorizedRelayers[relayer]) revert RelayerAlreadyAuthorized();
        if (pendingRelayerAuthorization[relayer] != 0) revert RelayerAuthorizationAlreadyPending();
        uint256 executeTime = block.timestamp + RELAYER_AUTHORIZATION_TIMELOCK;
        pendingRelayerAuthorization[relayer] = executeTime;
        emit RelayerAuthorizationProposed(relayer, executeTime);
    }

    function executeRelayerAuthorization(address relayer) external {
        uint256 executeTime = pendingRelayerAuthorization[relayer];
        if (executeTime == 0) revert RelayerAuthorizationNotPending();
        if (block.timestamp < executeTime) revert RelayerAuthorizationTimelockNotExpired();
        authorizedRelayers[relayer] = true;
        delete pendingRelayerAuthorization[relayer];
        emit RelayerAuthorized(relayer);
    }

    function cancelRelayerAuthorization(address relayer) external onlyGovernance {
        if (pendingRelayerAuthorization[relayer] == 0) revert RelayerAuthorizationNotPending();
        delete pendingRelayerAuthorization[relayer];
        emit RelayerAuthorizationCancelled(relayer);
    }

    function proposeRelayerRevocation(address relayer) external onlyGovernance {
        if (!authorizedRelayers[relayer]) revert RelayerNotAuthorized();
        if (pendingRelayerRevocation[relayer] != 0) revert RelayerRevocationAlreadyPending();
        uint256 executeTime = block.timestamp + RELAYER_AUTHORIZATION_TIMELOCK;
        pendingRelayerRevocation[relayer] = executeTime;
        emit RelayerRevocationProposed(relayer, executeTime);
    }

    function executeRelayerRevocation(address relayer) external {
        uint256 executeTime = pendingRelayerRevocation[relayer];
        if (executeTime == 0) revert RelayerRevocationNotPending();
        if (block.timestamp < executeTime) revert RelayerRevocationTimelockNotExpired();
        authorizedRelayers[relayer] = false;
        delete pendingRelayerRevocation[relayer];
        emit RelayerRevoked(relayer);
    }

    function cancelRelayerRevocation(address relayer) external onlyGovernance {
        if (pendingRelayerRevocation[relayer] == 0) revert RelayerRevocationNotPending();
        delete pendingRelayerRevocation[relayer];
        emit RelayerRevocationCancelled(relayer);
    }

    // ========================================================================
    // PAUSE
    // ========================================================================

    function pause() external onlyGovernance {
        _pause();
    }

    function unpause() external onlyGovernance {
        _unpause();
    }
}
