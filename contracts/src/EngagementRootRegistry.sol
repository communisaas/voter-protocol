// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "./TimelockGovernance.sol";

/// @title EngagementRootRegistry
/// @notice On-chain registry for Tree 3 (Engagement) Merkle roots
/// @dev Manages engagement tree roots with lifecycle states:
///      REGISTERED -> ACTIVE -> SUNSET -> EXPIRED
///
/// ARCHITECTURE (Three-Tree Design):
/// Tree 3 stores engagement data commitments:
///   leaf = H2(identity_commitment, H3(engagement_tier, action_count, diversity_score))
/// This tree is UPDATED after each batch of verified on-chain actions.
///
/// ROOT LIFECYCLE:
///   1. REGISTERED -> Governance registers root (immediate activation)
///   2. ACTIVE     -> Root is valid for proving (isActive=true, not expired)
///   3. SUNSET     -> Grace period (7 days) before expiry
///   4. EXPIRED    -> Root no longer accepted (block.timestamp > expiresAt)
///
/// IMPORTANT: Engagement roots change more frequently than user/cell-map roots
/// because new actions continuously update the engagement tree. The operator
/// publishes new roots after each batch of nullifier consumption events.
///
/// Multiple roots can be ACTIVE simultaneously to support:
///   - Batch updates (new engagement data)
///   - Grace periods during transitions
///
/// SECURITY:
///   - All lifecycle operations have 7-day timelocks
///   - Governance-controlled (initially founder, later multisig)
///   - Append-only registration (roots cannot be modified after creation)
///   - All changes emit events for community audit
///
/// See: specs/REPUTATION-ARCHITECTURE-SPEC.md Section 6
contract EngagementRootRegistry is TimelockGovernance {
    /// @notice Engagement root metadata structure
    struct EngagementRootMetadata {
        uint8 depth;            // Merkle tree depth (18, 20, 22, or 24)
        bool isActive;          // Governance toggle (default true on registration)
        uint32 registeredAt;    // Registration timestamp (packed for gas efficiency)
        uint64 expiresAt;       // Auto-sunset timestamp (0 = never expires)
    }

    /// @notice Maps engagement Merkle root to metadata
    mapping(bytes32 => EngagementRootMetadata) public engagementRoots;

    /// @notice Pending root operation type
    /// @dev 1 = deactivate, 2 = set expiry, 3 = reactivate
    struct PendingRootOperation {
        uint8 operationType;    // 1=deactivate, 2=expire, 3=reactivate
        uint64 executeTime;     // When operation can be executed
        uint64 newExpiresAt;    // Only used for expire operations (type 2)
    }

    /// @notice Maps engagement root to pending lifecycle operation
    mapping(bytes32 => PendingRootOperation) public pendingRootOperations;

    /// @notice Grace period for sunset state (7 days)
    /// @dev Shorter than UserRootRegistry (30 days) because engagement roots
    ///      change more frequently and clients auto-update
    uint256 public constant SUNSET_GRACE_PERIOD = 7 days;

    // ============ Events ============

    /// @notice Emitted when a new engagement root is registered
    event EngagementRootRegistered(
        bytes32 indexed root,
        uint8 depth,
        uint256 timestamp
    );

    /// @notice Emitted when any root lifecycle operation is initiated (7-day timelock starts)
    /// @param operationType 1=deactivate, 2=expire, 3=reactivate
    event RootOperationInitiated(bytes32 indexed root, uint8 operationType, uint256 executeTime);

    /// @notice Emitted when root is deactivated
    event RootDeactivated(bytes32 indexed root);

    /// @notice Emitted when root expiry is set
    event RootExpirySet(bytes32 indexed root, uint64 expiresAt);

    /// @notice Emitted when root is reactivated
    event RootReactivated(bytes32 indexed root);

    /// @notice Emitted when root operation is cancelled
    event RootOperationCancelled(bytes32 indexed root);

    // ============ Errors ============

    error RootAlreadyRegistered();
    error InvalidDepth();
    error RootNotRegistered();
    error RootAlreadyInactive();
    error RootAlreadyActive();
    error NoOperationPending();
    error InvalidExpiry();
    error OperationAlreadyPending();

    // ============ Constructor ============

    /// @notice Deploy registry with governance address
    /// @param _governance Multi-sig or founder address that controls root management
    /// @param _governanceTimelock Timelock for governance operations (minimum 10 minutes)
    constructor(address _governance, uint256 _governanceTimelock) TimelockGovernance(_governanceTimelock) {
        _initializeGovernance(_governance);
    }

    // ============ Root Registration ============

    /// @notice Register a new engagement tree root
    /// @param root Engagement Merkle root from Shadow Atlas
    /// @param depth Merkle tree depth (18, 20, 22, or 24)
    /// @dev Only callable by governance. Append-only (cannot modify existing).
    ///      New roots are ACTIVE immediately (no timelock for registration).
    ///      Deactivation/expiry require 7-day timelock for safety.
    function registerEngagementRoot(bytes32 root, uint8 depth)
        external
        onlyGovernance
    {
        if (depth < 18 || depth > 24 || depth % 2 != 0) revert InvalidDepth();
        if (engagementRoots[root].registeredAt != 0) revert RootAlreadyRegistered();

        engagementRoots[root] = EngagementRootMetadata({
            depth: depth,
            isActive: true,
            registeredAt: uint32(block.timestamp),
            expiresAt: 0
        });

        emit EngagementRootRegistered(root, depth, block.timestamp);
    }

    // ============ Root Lifecycle Management ============

    /// @notice Check if an engagement root is currently valid for proving
    /// @param root Engagement Merkle root
    /// @return True if registered, active, and not expired
    function isValidEngagementRoot(bytes32 root) public view returns (bool) {
        EngagementRootMetadata memory meta = engagementRoots[root];
        if (meta.registeredAt == 0) return false;       // Not registered
        if (!meta.isActive) return false;                // Deactivated
        if (meta.expiresAt != 0 && block.timestamp > meta.expiresAt) return false; // Expired
        return true;
    }

    /// @notice Get full metadata for an engagement root
    /// @param root Engagement Merkle root
    /// @return metadata Full root metadata struct
    function getEngagementRootMetadata(bytes32 root)
        external
        view
        returns (EngagementRootMetadata memory metadata)
    {
        return engagementRoots[root];
    }

    /// @notice Initiate root deactivation (starts 7-day timelock)
    /// @param root Engagement Merkle root to deactivate
    function initiateRootDeactivation(bytes32 root)
        external
        onlyGovernance
    {
        EngagementRootMetadata memory meta = engagementRoots[root];
        if (meta.registeredAt == 0) revert RootNotRegistered();
        if (!meta.isActive) revert RootAlreadyInactive();
        if (pendingRootOperations[root].executeTime != 0) {
            revert OperationAlreadyPending();
        }

        uint64 executeTime = uint64(block.timestamp + GOVERNANCE_TIMELOCK);
        pendingRootOperations[root] = PendingRootOperation({
            operationType: 1,
            executeTime: executeTime,
            newExpiresAt: 0
        });

        emit RootOperationInitiated(root, pendingRootOperations[root].operationType, executeTime);
    }

    /// @notice Execute pending root deactivation (after 7-day timelock)
    /// @param root Engagement Merkle root to deactivate
    function executeRootDeactivation(bytes32 root) external {
        PendingRootOperation memory op = pendingRootOperations[root];
        if (op.executeTime == 0 || op.operationType != 1) revert NoOperationPending();
        if (block.timestamp < op.executeTime) revert TimelockNotExpired();

        engagementRoots[root].isActive = false;
        delete pendingRootOperations[root];

        emit RootDeactivated(root);
    }

    /// @notice Initiate root expiry setting (starts 7-day timelock)
    /// @param root Engagement Merkle root
    /// @param expiresAt Timestamp when root expires (must be future, 0 = never)
    function initiateRootExpiry(bytes32 root, uint64 expiresAt)
        external
        onlyGovernance
    {
        EngagementRootMetadata memory meta = engagementRoots[root];
        if (meta.registeredAt == 0) revert RootNotRegistered();
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert InvalidExpiry();
        if (pendingRootOperations[root].executeTime != 0) {
            revert OperationAlreadyPending();
        }

        uint64 executeTime = uint64(block.timestamp + GOVERNANCE_TIMELOCK);
        pendingRootOperations[root] = PendingRootOperation({
            operationType: 2,
            executeTime: executeTime,
            newExpiresAt: expiresAt
        });

        emit RootOperationInitiated(root, pendingRootOperations[root].operationType, executeTime);
    }

    /// @notice Execute pending root expiry (after 7-day timelock)
    /// @param root Engagement Merkle root
    function executeRootExpiry(bytes32 root) external {
        PendingRootOperation memory op = pendingRootOperations[root];
        if (op.executeTime == 0 || op.operationType != 2) revert NoOperationPending();
        if (block.timestamp < op.executeTime) revert TimelockNotExpired();

        engagementRoots[root].expiresAt = op.newExpiresAt;
        delete pendingRootOperations[root];

        emit RootExpirySet(root, op.newExpiresAt);
    }

    /// @notice Initiate root reactivation (starts 7-day timelock)
    /// @param root Engagement Merkle root to reactivate
    function initiateRootReactivation(bytes32 root)
        external
        onlyGovernance
    {
        EngagementRootMetadata memory meta = engagementRoots[root];
        if (meta.registeredAt == 0) revert RootNotRegistered();
        if (meta.isActive) revert RootAlreadyActive();
        if (pendingRootOperations[root].executeTime != 0) {
            revert OperationAlreadyPending();
        }

        uint64 executeTime = uint64(block.timestamp + GOVERNANCE_TIMELOCK);
        pendingRootOperations[root] = PendingRootOperation({
            operationType: 3,
            executeTime: executeTime,
            newExpiresAt: 0
        });

        emit RootOperationInitiated(root, pendingRootOperations[root].operationType, executeTime);
    }

    /// @notice Execute pending root reactivation (after 7-day timelock)
    /// @param root Engagement Merkle root to reactivate
    function executeRootReactivation(bytes32 root) external {
        PendingRootOperation memory op = pendingRootOperations[root];
        if (op.executeTime == 0 || op.operationType != 3) revert NoOperationPending();
        if (block.timestamp < op.executeTime) revert TimelockNotExpired();

        engagementRoots[root].isActive = true;
        delete pendingRootOperations[root];

        emit RootReactivated(root);
    }

    /// @notice Cancel pending root operation
    /// @param root Engagement Merkle root
    function cancelRootOperation(bytes32 root)
        external
        onlyGovernance
    {
        if (pendingRootOperations[root].executeTime == 0) {
            revert NoOperationPending();
        }

        delete pendingRootOperations[root];
        emit RootOperationCancelled(root);
    }

    // ============ View Functions ============

    /// @notice Get depth for a root
    /// @param root Engagement Merkle root
    /// @return depth Merkle tree depth
    function getDepth(bytes32 root)
        external
        view
        returns (uint8 depth)
    {
        return engagementRoots[root].depth;
    }
}
