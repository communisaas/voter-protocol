// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./AbstractRootLifecycle.sol";

/// @title CellMapRegistry
/// @notice On-chain registry for Tree 2 (Cell-District Mapping) SMT roots
/// @dev Manages cell-district mapping tree roots with lifecycle states:
///      PROPOSED -> ACTIVE -> DEPRECATED -> EXPIRED
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
contract CellMapRegistry is AbstractRootLifecycle {
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

    // ============ Convenience Functions ============

    /// @notice Deprecate a cell map root with the standard 90-day grace period
    /// @param root Cell map SMT root to deprecate
    /// @dev Convenience: initiates expiry at now + 90 days (after 7-day timelock)
    ///      Total time until expiry: 7 days (timelock) + 90 days (grace) = 97 days
    function deprecateCellMapRoot(bytes32 root)
        external
        onlyGovernance
    {
        if (!_rootExists(root)) revert RootNotRegistered();
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

        emit RootOperationInitiated(root, 2, executeTime);
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

    // ============ AbstractRootLifecycle Hooks ============

    function _rootExists(bytes32 root) internal view override returns (bool) {
        return cellMapRoots[root].registeredAt != 0;
    }

    function _getRootIsActive(bytes32 root) internal view override returns (bool) {
        return cellMapRoots[root].isActive;
    }

    function _setRootActive(bytes32 root, bool active) internal override {
        cellMapRoots[root].isActive = active;
    }

    function _setRootExpiresAt(bytes32 root, uint64 expiresAt) internal override {
        cellMapRoots[root].expiresAt = expiresAt;
    }
}
