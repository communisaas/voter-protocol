// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./AbstractRootLifecycle.sol";

/// @title UserRootRegistry
/// @notice On-chain registry for Tree 1 (User Identity) Merkle roots
/// @dev Manages user identity tree roots with lifecycle states:
///      PROPOSED -> ACTIVE -> SUNSET -> EXPIRED
///
/// ARCHITECTURE (Two-Tree Design):
/// Tree 1 stores user identity commitments: leaf = H4(user_secret, cell_id, registration_salt, authority_level)
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
contract UserRootRegistry is AbstractRootLifecycle {
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

    // ============ Errors ============

    error RootAlreadyRegistered();
    error InvalidCountryCode();
    error InvalidDepth();

    // ============ Constructor ============

    /// @notice Deploy registry with governance address
    /// @param _governance Multi-sig or founder address that controls root management
    /// @param _governanceTimelock Timelock for governance operations (minimum 10 minutes)
    constructor(address _governance, uint256 _governanceTimelock) TimelockGovernance(_governanceTimelock) {
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

    // ============ Convenience Functions ============

    /// @notice Set user root expiry (convenience wrapper for initiateRootExpiry)
    /// @param root User identity Merkle root
    /// @param expiresAt Timestamp when root expires (must be future, 0 = never)
    function setUserRootExpiry(bytes32 root, uint64 expiresAt)
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

    // ============ AbstractRootLifecycle Hooks ============

    function _rootExists(bytes32 root) internal view override returns (bool) {
        return userRoots[root].registeredAt != 0;
    }

    function _getRootIsActive(bytes32 root) internal view override returns (bool) {
        return userRoots[root].isActive;
    }

    function _setRootActive(bytes32 root, bool active) internal override {
        userRoots[root].isActive = active;
    }

    function _setRootExpiresAt(bytes32 root, uint64 expiresAt) internal override {
        userRoots[root].expiresAt = expiresAt;
    }
}
