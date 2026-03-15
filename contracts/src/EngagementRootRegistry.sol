// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./AbstractRootLifecycle.sol";

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
/// IMPORTANT: Engagement roots change more frequently than user/cell-map roots
/// because new actions continuously update the engagement tree. The operator
/// publishes new roots after each batch of nullifier consumption events.
///
/// SECURITY:
///   - All lifecycle operations have 7-day timelocks
///   - Governance-controlled (initially founder, later multisig)
///   - Append-only registration (roots cannot be modified after creation)
///   - All changes emit events for community audit
///
/// See: specs/REPUTATION-ARCHITECTURE-SPEC.md Section 6
contract EngagementRootRegistry is AbstractRootLifecycle {
    /// @notice Engagement root metadata structure
    struct EngagementRootMetadata {
        uint8 depth;            // Merkle tree depth (18, 20, 22, or 24)
        bool isActive;          // Governance toggle (default true on registration)
        uint32 registeredAt;    // Registration timestamp (packed for gas efficiency)
        uint64 expiresAt;       // Auto-sunset timestamp (0 = never expires)
    }

    /// @notice Maps engagement Merkle root to metadata
    mapping(bytes32 => EngagementRootMetadata) public engagementRoots;

    /// @notice Grace period for sunset state (7 days)
    /// @dev Shorter than UserRootRegistry (30 days) because engagement roots
    ///      change more frequently and clients auto-update
    uint256 public constant SUNSET_GRACE_PERIOD = 7 days;

    /// @notice Maximum lifetime for engagement roots (180 days)
    /// @dev SM-4: Prevents indefinite root validity (engagement cherry-picking).
    ///      Old roots with expiresAt == 0 would remain valid forever, allowing
    ///      users to prove stale higher engagement tiers. This constant enforces
    ///      a maximum validity window.
    uint256 public constant MAX_ENGAGEMENT_ROOT_LIFETIME = 180 days;

    // ============ Events ============

    /// @notice Emitted when a new engagement root is registered
    event EngagementRootRegistered(
        bytes32 indexed root,
        uint8 depth,
        uint256 timestamp
    );

    // ============ Errors ============

    error RootAlreadyRegistered();
    error InvalidDepth();

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
    ///      New roots are ACTIVE immediately with auto-expiry at MAX_ENGAGEMENT_ROOT_LIFETIME.
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

    // ============ AbstractRootLifecycle Hooks ============

    function _rootExists(bytes32 root) internal view override returns (bool) {
        return engagementRoots[root].registeredAt != 0;
    }

    function _getRootIsActive(bytes32 root) internal view override returns (bool) {
        return engagementRoots[root].isActive;
    }

    function _setRootActive(bytes32 root, bool active) internal override {
        engagementRoots[root].isActive = active;
    }

    function _setRootExpiresAt(bytes32 root, uint64 expiresAt) internal override {
        engagementRoots[root].expiresAt = expiresAt;
    }
}
