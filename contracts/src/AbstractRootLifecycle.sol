// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./TimelockGovernance.sol";

/// @title AbstractRootLifecycle
/// @notice Shared root lifecycle management for all registry contracts
/// @dev Extracts the duplicated PendingRootOperation struct, pendingRootOperations mapping,
///      and 7 lifecycle functions (initiate/execute deactivation/expiry/reactivation + cancel)
///      that were copy-pasted across UserRootRegistry, CellMapRegistry, EngagementRootRegistry,
///      and DistrictRegistry.
///
/// Concrete registries implement 4 virtual hooks to bridge their own metadata storage:
///   - _rootExists(root)       : whether the root is registered
///   - _getRootIsActive(root)  : whether the root is currently active
///   - _setRootActive(root, b) : toggle the isActive flag
///   - _setRootExpiresAt(root) : set the expiresAt timestamp
abstract contract AbstractRootLifecycle is TimelockGovernance {
    // ============ Shared Struct ============

    /// @notice Pending root operation type
    /// @dev 1 = deactivate, 2 = set expiry, 3 = reactivate
    struct PendingRootOperation {
        uint8 operationType;    // 1=deactivate, 2=expire, 3=reactivate
        uint64 executeTime;     // When operation can be executed
        uint64 newExpiresAt;    // Only used for expire operations (type 2)
    }

    /// @notice Maps root to pending lifecycle operation
    mapping(bytes32 => PendingRootOperation) public pendingRootOperations;

    // ============ Events ============

    /// @notice Emitted when any root lifecycle operation is initiated (timelock starts)
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

    error RootNotRegistered();
    error RootAlreadyInactive();
    error RootAlreadyActive();
    error NoOperationPending();
    error InvalidExpiry();
    error OperationAlreadyPending();

    // ============ Virtual Hooks ============

    /// @notice Check if a root is registered
    function _rootExists(bytes32 root) internal view virtual returns (bool);

    /// @notice Get whether a root is active
    function _getRootIsActive(bytes32 root) internal view virtual returns (bool);

    /// @notice Set a root's active flag
    function _setRootActive(bytes32 root, bool active) internal virtual;

    /// @notice Set a root's expiry timestamp
    function _setRootExpiresAt(bytes32 root, uint64 expiresAt) internal virtual;

    // ============ Lifecycle Functions ============

    /// @notice Initiate root deactivation (starts timelock)
    /// @param root Merkle root to deactivate
    function initiateRootDeactivation(bytes32 root)
        external
        onlyGovernance
    {
        if (!_rootExists(root)) revert RootNotRegistered();
        if (!_getRootIsActive(root)) revert RootAlreadyInactive();
        if (pendingRootOperations[root].executeTime != 0) {
            revert OperationAlreadyPending();
        }

        uint64 executeTime = uint64(block.timestamp + GOVERNANCE_TIMELOCK);
        pendingRootOperations[root] = PendingRootOperation({
            operationType: 1,
            executeTime: executeTime,
            newExpiresAt: 0
        });

        emit RootOperationInitiated(root, 1, executeTime);
    }

    /// @notice Execute pending root deactivation (after timelock)
    /// @param root Merkle root to deactivate
    function executeRootDeactivation(bytes32 root) external {
        PendingRootOperation memory op = pendingRootOperations[root];
        if (op.executeTime == 0 || op.operationType != 1) revert NoOperationPending();
        if (block.timestamp < op.executeTime) revert TimelockNotExpired();

        _setRootActive(root, false);
        delete pendingRootOperations[root];

        emit RootDeactivated(root);
    }

    /// @notice Initiate root expiry setting (starts timelock)
    /// @param root Merkle root
    /// @param expiresAt Timestamp when root expires (must be future, 0 = never)
    function initiateRootExpiry(bytes32 root, uint64 expiresAt)
        external
        onlyGovernance
    {
        if (!_rootExists(root)) revert RootNotRegistered();
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

        emit RootOperationInitiated(root, 2, executeTime);
    }

    /// @notice Execute pending root expiry (after timelock)
    /// @param root Merkle root
    function executeRootExpiry(bytes32 root) external {
        PendingRootOperation memory op = pendingRootOperations[root];
        if (op.executeTime == 0 || op.operationType != 2) revert NoOperationPending();
        if (block.timestamp < op.executeTime) revert TimelockNotExpired();

        _setRootExpiresAt(root, op.newExpiresAt);
        delete pendingRootOperations[root];

        emit RootExpirySet(root, op.newExpiresAt);
    }

    /// @notice Initiate root reactivation (starts timelock)
    /// @param root Merkle root to reactivate
    function initiateRootReactivation(bytes32 root)
        external
        onlyGovernance
    {
        if (!_rootExists(root)) revert RootNotRegistered();
        if (_getRootIsActive(root)) revert RootAlreadyActive();
        if (pendingRootOperations[root].executeTime != 0) {
            revert OperationAlreadyPending();
        }

        uint64 executeTime = uint64(block.timestamp + GOVERNANCE_TIMELOCK);
        pendingRootOperations[root] = PendingRootOperation({
            operationType: 3,
            executeTime: executeTime,
            newExpiresAt: 0
        });

        emit RootOperationInitiated(root, 3, executeTime);
    }

    /// @notice Execute pending root reactivation (after timelock)
    /// @param root Merkle root to reactivate
    function executeRootReactivation(bytes32 root) external {
        PendingRootOperation memory op = pendingRootOperations[root];
        if (op.executeTime == 0 || op.operationType != 3) revert NoOperationPending();
        if (block.timestamp < op.executeTime) revert TimelockNotExpired();

        _setRootActive(root, true);
        delete pendingRootOperations[root];

        emit RootReactivated(root);
    }

    /// @notice Cancel pending root operation
    /// @param root Merkle root
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
}
