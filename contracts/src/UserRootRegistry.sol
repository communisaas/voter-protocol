// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "./TimelockGovernance.sol";

/// @title UserRootRegistry
/// @notice On-chain registry for Tree 1 (User Identity) Merkle roots
/// @dev Manages user identity tree roots with lifecycle states:
///      PROPOSED -> ACTIVE -> SUNSET -> EXPIRED
///
/// ARCHITECTURE (Two-Tree Design):
/// Tree 1 stores user identity commitments: leaf = H(user_secret, cell_id, salt)
/// This tree is STABLE - only changes when:
///   - A new user registers
///   - A user moves to a new address (re-registration)
///   - Census redefines cell boundaries (every 10 years)
///
/// ROOT LIFECYCLE (Spec Section 2.4):
///   1. PROPOSED  -> Governance registers root (7-day timelock for deactivation/expiry)
///   2. ACTIVE    -> Root is valid for proving (isActive=true, not expired)
///   3. SUNSET    -> Grace period (30 days) before expiry
///   4. EXPIRED   -> Root no longer accepted (block.timestamp > expiresAt)
///
/// Multiple roots can be ACTIVE simultaneously to support:
///   - Batch registration (new users added)
///   - Grace periods during transitions
///
/// SECURITY:
///   - All lifecycle operations have 7-day timelocks
///   - Governance-controlled (initially founder, later multisig)
///   - Append-only registration (roots cannot be modified after creation)
///   - All changes emit events for community audit
contract UserRootRegistry is TimelockGovernance {
    /// @notice User root metadata structure
    struct UserRootMetadata {
        bytes3 country;         // ISO 3166-1 alpha-3 country code
        uint8 depth;            // Merkle tree depth (20-24)
        bool isActive;          // Governance toggle (default true on registration)
        uint32 registeredAt;    // Registration timestamp (packed for gas efficiency)
        uint64 expiresAt;       // Auto-sunset timestamp (0 = never expires)
    }

    /// @notice Maps user Merkle root to metadata
    mapping(bytes32 => UserRootMetadata) public userRoots;

    /// @notice Pending root operation type
    /// @dev 1 = deactivate, 2 = set expiry, 3 = reactivate
    struct PendingRootOperation {
        uint8 operationType;    // 1=deactivate, 2=expire, 3=reactivate
        uint64 executeTime;     // When operation can be executed
        uint64 newExpiresAt;    // Only used for expire operations (type 2)
    }

    /// @notice Maps user root to pending lifecycle operation
    mapping(bytes32 => PendingRootOperation) public pendingRootOperations;

    /// @notice Grace period for sunset state (30 days)
    /// @dev Users have 30 days after expiry is set to transition to a new root
    uint256 public constant SUNSET_GRACE_PERIOD = 30 days;

    // ============ Events ============

    /// @notice Emitted when a new user root is registered
    event UserRootRegistered(
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

    /// @notice Emitted when root expiry is set
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

    /// @notice Register a new user identity tree root
    /// @param root User identity Merkle root
    /// @param country ISO 3166-1 alpha-3 country code
    /// @param depth Merkle tree depth (18, 20, 22, or 24)
    /// @dev Only callable by governance. Append-only (cannot modify existing).
    ///      New roots are ACTIVE immediately (no timelock for registration).
    ///      Deactivation/expiry require 7-day timelock for safety.
    function registerUserRoot(bytes32 root, bytes3 country, uint8 depth)
        external
        onlyGovernance
    {
        if (country == bytes3(0)) revert InvalidCountryCode();
        if (depth < 18 || depth > 24 || depth % 2 != 0) revert InvalidDepth();
        if (userRoots[root].registeredAt != 0) revert RootAlreadyRegistered();

        userRoots[root] = UserRootMetadata({
            country: country,
            depth: depth,
            isActive: true,
            registeredAt: uint32(block.timestamp),
            expiresAt: 0
        });

        emit UserRootRegistered(root, country, depth, block.timestamp);
    }

    // ============ Root Lifecycle Management ============

    /// @notice Check if a user root is currently valid for proving
    /// @param root User identity Merkle root
    /// @return True if registered, active, and not expired
    function isValidUserRoot(bytes32 root) public view returns (bool) {
        UserRootMetadata memory meta = userRoots[root];
        if (meta.registeredAt == 0) return false;       // Not registered
        if (!meta.isActive) return false;                // Deactivated
        if (meta.expiresAt != 0 && block.timestamp > meta.expiresAt) return false; // Expired
        return true;
    }

    /// @notice Get full metadata for a user root
    /// @param root User identity Merkle root
    /// @return metadata Full root metadata struct
    function getUserRootMetadata(bytes32 root)
        external
        view
        returns (UserRootMetadata memory metadata)
    {
        return userRoots[root];
    }

    /// @notice Initiate root deactivation (starts 7-day timelock)
    /// @param root User identity Merkle root to deactivate
    /// @dev Only callable by governance.
    ///      Use cases: compromised tree data, forced re-registration
    ///      Timelock gives users 7-day warning before root becomes invalid
    function initiateRootDeactivation(bytes32 root)
        external
        onlyGovernance
    {
        UserRootMetadata memory meta = userRoots[root];
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
    /// @param root User identity Merkle root to deactivate
    /// @dev Anyone can execute after timelock expires
    function executeRootDeactivation(bytes32 root) external {
        PendingRootOperation memory op = pendingRootOperations[root];
        if (op.executeTime == 0 || op.operationType != 1) revert NoOperationPending();
        if (block.timestamp < op.executeTime) revert TimelockNotExpired();

        userRoots[root].isActive = false;
        delete pendingRootOperations[root];

        emit RootDeactivated(root);
    }

    /// @notice Initiate root expiry setting (starts 7-day timelock)
    /// @param root User identity Merkle root
    /// @param expiresAt Timestamp when root expires (must be future, 0 = never)
    /// @dev Only callable by governance.
    ///      Sets the SUNSET state: root remains valid until expiresAt.
    ///      Recommended: set expiresAt = now + SUNSET_GRACE_PERIOD (30 days)
    function initiateRootExpiry(bytes32 root, uint64 expiresAt)
        external
        onlyGovernance
    {
        UserRootMetadata memory meta = userRoots[root];
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
    /// @param root User identity Merkle root
    /// @dev Anyone can execute after timelock expires
    function executeRootExpiry(bytes32 root) external {
        PendingRootOperation memory op = pendingRootOperations[root];
        if (op.executeTime == 0 || op.operationType != 2) revert NoOperationPending();
        if (block.timestamp < op.executeTime) revert TimelockNotExpired();

        userRoots[root].expiresAt = op.newExpiresAt;
        delete pendingRootOperations[root];

        emit RootExpirySet(root, op.newExpiresAt);
    }

    /// @notice Initiate root reactivation (starts 7-day timelock)
    /// @param root User identity Merkle root to reactivate
    /// @dev Only callable by governance.
    ///      Use cases: reversing accidental deactivation
    function initiateRootReactivation(bytes32 root)
        external
        onlyGovernance
    {
        UserRootMetadata memory meta = userRoots[root];
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
    /// @param root User identity Merkle root to reactivate
    /// @dev Anyone can execute after timelock expires
    function executeRootReactivation(bytes32 root) external {
        PendingRootOperation memory op = pendingRootOperations[root];
        if (op.executeTime == 0 || op.operationType != 3) revert NoOperationPending();
        if (block.timestamp < op.executeTime) revert TimelockNotExpired();

        userRoots[root].isActive = true;
        delete pendingRootOperations[root];

        emit RootReactivated(root);
    }

    /// @notice Cancel pending root operation
    /// @param root User identity Merkle root
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

    /// @notice Set user root expiry with default 30-day grace period
    /// @param root User identity Merkle root
    /// @dev Convenience: initiates expiry at now + 30 days (after 7-day timelock)
    function setUserRootExpiry(bytes32 root, uint64 expiresAt)
        external
        onlyGovernance
    {
        UserRootMetadata memory meta = userRoots[root];
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

    /// @notice Get country and depth for a root in single call
    /// @param root User identity Merkle root
    /// @return country ISO 3166-1 alpha-3 code
    /// @return depth Merkle tree depth
    function getCountryAndDepth(bytes32 root)
        external
        view
        returns (bytes3 country, uint8 depth)
    {
        UserRootMetadata memory meta = userRoots[root];
        return (meta.country, meta.depth);
    }
}
