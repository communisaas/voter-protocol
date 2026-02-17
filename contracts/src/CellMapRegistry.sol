// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "./TimelockGovernance.sol";

/// @title CellMapRegistry
/// @notice On-chain registry for Tree 2 (Cell-District Mapping) SMT roots
/// @dev Manages cell-district mapping tree roots with lifecycle states:
///      PROPOSED -> ACTIVE -> DEPRECATED -> EXPIRED
///
/// ARCHITECTURE (Two-Tree Design):
/// Tree 2 stores cell-to-district mappings: SMT[cell_id] = H(cell_id, district_commitment)
/// This tree is DYNAMIC - updated when:
///   - Congressional redistricting (every 10 years)
///   - State legislative redistricting (every 10 years)
///   - City council/school district adjustments (annually)
///
/// ROOT LIFECYCLE (Spec Section 3.6):
///   1. PROPOSED   -> Governance registers root (7-day timelock for deactivation/expiry)
///   2. ACTIVE     -> Root is valid for proving
///   3. DEPRECATED -> Old root still valid (90-day grace period)
///   4. EXPIRED    -> Root no longer accepted
///
/// KEY DIFFERENCE FROM UserRootRegistry:
/// The grace period is 90 days (not 30) because:
///   - Users need time to update cached district data
///   - Old proofs must remain valid during redistricting transitions
///   - No user action required (client auto-updates)
///
/// SECURITY:
///   - All lifecycle operations have 7-day timelocks
///   - 90-day grace period prevents sudden invalidation of existing proofs
///   - Governance-controlled (initially founder, later multisig)
///   - Append-only registration
///   - All changes emit events for community audit
contract CellMapRegistry is TimelockGovernance {
    /// @notice Cell map root metadata structure
    struct CellMapRootMetadata {
        bytes3 country;         // ISO 3166-1 alpha-3 country code
        uint8 depth;            // Sparse Merkle tree depth (typically 20)
        bool isActive;          // Governance toggle (default true on registration)
        uint32 registeredAt;    // Registration timestamp (packed for gas efficiency)
        uint64 expiresAt;       // Auto-deprecation timestamp (0 = never expires)
    }

    /// @notice Maps cell map SMT root to metadata
    mapping(bytes32 => CellMapRootMetadata) public cellMapRoots;

    /// @notice Pending root operation type
    /// @dev 1 = deactivate, 2 = set expiry, 3 = reactivate
    struct PendingRootOperation {
        uint8 operationType;    // 1=deactivate, 2=expire, 3=reactivate
        uint64 executeTime;     // When operation can be executed
        uint64 newExpiresAt;    // Only used for expire operations (type 2)
    }

    /// @notice Maps cell map root to pending lifecycle operation
    mapping(bytes32 => PendingRootOperation) public pendingRootOperations;

    /// @notice Grace period for deprecated state (90 days)
    /// @dev Old cell map roots remain valid for 90 days after deprecation
    ///      to allow users to transition to updated district mappings
    uint256 public constant DEPRECATION_GRACE_PERIOD = 90 days;

    // ============ Events ============

    /// @notice Emitted when a new cell map root is registered
    event CellMapRootRegistered(
        bytes32 indexed root,
        bytes3 indexed country,
        uint8 depth,
        uint256 timestamp
    );

    /// @notice Emitted when any root lifecycle operation is initiated (7-day timelock starts)
    /// @param operationType 1=deactivate, 2=expire, 3=reactivate
    event RootOperationInitiated(bytes32 indexed root, uint8 operationType, uint256 executeTime);

    /// @notice Emitted when root is deactivated
    event RootDeactivated(bytes32 indexed root);

    /// @notice Emitted when root expiry is set (enters DEPRECATED state)
    event RootExpirySet(bytes32 indexed root, uint64 expiresAt);

    /// @notice Emitted when root is reactivated
    event RootReactivated(bytes32 indexed root);

    /// @notice Emitted when root operation is cancelled
    event RootOperationCancelled(bytes32 indexed root);

    // ============ Errors ============

    error RootAlreadyRegistered();
    error InvalidCountryCode();
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
    constructor(address _governance) {
        _initializeGovernance(_governance);
    }

    // ============ Root Registration ============

    /// @notice Register a new cell-district mapping tree root
    /// @param root Cell map SMT root from Shadow Atlas
    /// @param country ISO 3166-1 alpha-3 country code
    /// @param depth Sparse Merkle tree depth (18, 20, 22, or 24)
    /// @dev Only callable by governance. Append-only (cannot modify existing).
    ///      New roots are ACTIVE immediately.
    ///      Deprecation/expiry require 7-day timelock for safety.
    function registerCellMapRoot(bytes32 root, bytes3 country, uint8 depth)
        external
        onlyGovernance
    {
        if (country == bytes3(0)) revert InvalidCountryCode();
        if (depth < 18 || depth > 24 || depth % 2 != 0) revert InvalidDepth();
        if (cellMapRoots[root].registeredAt != 0) revert RootAlreadyRegistered();

        cellMapRoots[root] = CellMapRootMetadata({
            country: country,
            depth: depth,
            isActive: true,
            registeredAt: uint32(block.timestamp),
            expiresAt: 0
        });

        emit CellMapRootRegistered(root, country, depth, block.timestamp);
    }

    // ============ Root Lifecycle Management ============

    /// @notice Check if a cell map root is currently valid for proving
    /// @param root Cell map SMT root
    /// @return True if registered, active, and not expired
    function isValidCellMapRoot(bytes32 root) public view returns (bool) {
        CellMapRootMetadata memory meta = cellMapRoots[root];
        if (meta.registeredAt == 0) return false;       // Not registered
        if (!meta.isActive) return false;                // Deactivated
        if (meta.expiresAt != 0 && block.timestamp > meta.expiresAt) return false; // Expired
        return true;
    }

    /// @notice Get full metadata for a cell map root
    /// @param root Cell map SMT root
    /// @return metadata Full root metadata struct
    function getCellMapRootMetadata(bytes32 root)
        external
        view
        returns (CellMapRootMetadata memory metadata)
    {
        return cellMapRoots[root];
    }

    /// @notice Initiate root deactivation (starts 7-day timelock)
    /// @param root Cell map SMT root to deactivate
    /// @dev Only callable by governance.
    ///      Use cases: compromised mapping data, emergency invalidation
    ///      Timelock gives users 7-day warning before root becomes invalid
    function initiateRootDeactivation(bytes32 root)
        external
        onlyGovernance
    {
        CellMapRootMetadata memory meta = cellMapRoots[root];
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
    /// @param root Cell map SMT root to deactivate
    /// @dev Anyone can execute after timelock expires
    function executeRootDeactivation(bytes32 root) external {
        PendingRootOperation memory op = pendingRootOperations[root];
        if (op.executeTime == 0 || op.operationType != 1) revert NoOperationPending();
        if (block.timestamp < op.executeTime) revert TimelockNotExpired();

        cellMapRoots[root].isActive = false;
        delete pendingRootOperations[root];

        emit RootDeactivated(root);
    }

    /// @notice Initiate root expiry / deprecation (starts 7-day timelock)
    /// @param root Cell map SMT root
    /// @param expiresAt Timestamp when root expires (must be future, 0 = never)
    /// @dev Only callable by governance.
    ///      For redistricting transitions, set expiresAt = now + 90 days
    ///      to give users the full DEPRECATION_GRACE_PERIOD.
    function initiateRootExpiry(bytes32 root, uint64 expiresAt)
        external
        onlyGovernance
    {
        CellMapRootMetadata memory meta = cellMapRoots[root];
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
    /// @param root Cell map SMT root
    /// @dev Anyone can execute after timelock expires
    function executeRootExpiry(bytes32 root) external {
        PendingRootOperation memory op = pendingRootOperations[root];
        if (op.executeTime == 0 || op.operationType != 2) revert NoOperationPending();
        if (block.timestamp < op.executeTime) revert TimelockNotExpired();

        cellMapRoots[root].expiresAt = op.newExpiresAt;
        delete pendingRootOperations[root];

        emit RootExpirySet(root, op.newExpiresAt);
    }

    /// @notice Initiate root reactivation (starts 7-day timelock)
    /// @param root Cell map SMT root to reactivate
    /// @dev Only callable by governance.
    ///      Use cases: reversing accidental deactivation
    function initiateRootReactivation(bytes32 root)
        external
        onlyGovernance
    {
        CellMapRootMetadata memory meta = cellMapRoots[root];
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
    /// @param root Cell map SMT root to reactivate
    /// @dev Anyone can execute after timelock expires
    function executeRootReactivation(bytes32 root) external {
        PendingRootOperation memory op = pendingRootOperations[root];
        if (op.executeTime == 0 || op.operationType != 3) revert NoOperationPending();
        if (block.timestamp < op.executeTime) revert TimelockNotExpired();

        cellMapRoots[root].isActive = true;
        delete pendingRootOperations[root];

        emit RootReactivated(root);
    }

    /// @notice Cancel pending root operation
    /// @param root Cell map SMT root
    /// @dev Only governance can cancel
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

    // ============ Convenience View Functions ============

    /// @notice Deprecate a cell map root with the standard 90-day grace period
    /// @param root Cell map SMT root to deprecate
    /// @dev Convenience: initiates expiry at now + 90 days (after 7-day timelock)
    ///      Total time until expiry: 7 days (timelock) + 90 days (grace) = 97 days
    function deprecateCellMapRoot(bytes32 root)
        external
        onlyGovernance
    {
        CellMapRootMetadata memory meta = cellMapRoots[root];
        if (meta.registeredAt == 0) revert RootNotRegistered();
        if (pendingRootOperations[root].executeTime != 0) {
            revert OperationAlreadyPending();
        }

        uint64 expiresAt = uint64(block.timestamp + DEPRECATION_GRACE_PERIOD);
        uint64 executeTime = uint64(block.timestamp + GOVERNANCE_TIMELOCK);
        pendingRootOperations[root] = PendingRootOperation({
            operationType: 2,
            executeTime: executeTime,
            newExpiresAt: expiresAt
        });

        emit RootOperationInitiated(root, pendingRootOperations[root].operationType, executeTime);
    }

    /// @notice Get country and depth for a root in single call
    /// @param root Cell map SMT root
    /// @return country ISO 3166-1 alpha-3 code
    /// @return depth Sparse Merkle tree depth
    function getCountryAndDepth(bytes32 root)
        external
        view
        returns (bytes3 country, uint8 depth)
    {
        CellMapRootMetadata memory meta = cellMapRoots[root];
        return (meta.country, meta.depth);
    }
}
