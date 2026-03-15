// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./AbstractRootLifecycle.sol";

/// @title DistrictRegistry
/// @notice Immutable on-chain registry mapping district Merkle roots to country identifiers and tree depths
/// @dev This contract replaces the second tier of ZK verification with cheap on-chain lookups.
///      Now inherits AbstractRootLifecycle (via TimelockGovernance) for shared root lifecycle
///      management — SA-1 fix eliminates governance reimplementation and tooling drift.
///
/// MULTI-DEPTH SUPPORT (International Coverage):
/// - Depth 18: 262K addresses (small countries)
/// - Depth 20: 1M addresses (medium countries, UK constituencies)
/// - Depth 22: 4M addresses (large countries, US congressional districts)
/// - Depth 24: 16M addresses (very large countries, future expansion)
///
/// SECURITY:
/// - District→country→depth mappings are PUBLIC information
/// - Registry is append-only (districts can be added, never removed or modified)
/// - All lifecycle operations have governance timelocks
/// - All changes emit events for community audit
contract DistrictRegistry is AbstractRootLifecycle {
    /// @notice Maximum district types a user can be registered in (20 defined + 4 overflow)
    uint8 public constant MAX_DISTRICT_SLOTS = 24;

    /// @notice District metadata structure
    struct DistrictMetadata {
        bytes3 country;      // ISO 3166-1 alpha-3 country code
        uint8 depth;         // Merkle tree depth (18, 20, 22, or 24)
        uint32 registeredAt; // Registration timestamp (packed for gas efficiency)
        bool isActive;       // Governance toggle (default true on registration)
        uint64 expiresAt;    // Auto-sunset timestamp (0 = never expires)
    }

    /// @notice Maps district Merkle root to metadata
    mapping(bytes32 => DistrictMetadata) public districts;

    /// @notice Legacy mapping for backwards compatibility
    /// @dev Kept for existing contracts that only need country lookup
    mapping(bytes32 => bytes3) public districtToCountry;

    /// @notice Fast depth lookup (avoids struct unpacking)
    mapping(bytes32 => uint8) public districtDepth;

    // ============ Events ============

    /// @notice Emitted when a new district is registered
    event DistrictRegistered(
        bytes32 indexed districtRoot,
        bytes3 indexed country,
        uint8 depth,
        uint256 timestamp
    );

    // ============ Errors ============

    error DistrictAlreadyRegistered();
    error InvalidCountryCode();
    error InvalidDepth();

    // ============ Constructor ============

    /// @notice Deploy registry with multi-sig governance
    /// @param _governance Multi-sig address that controls district additions
    /// @param _governanceTimelock Timelock duration for governance operations (minimum 10 minutes)
    constructor(address _governance, uint256 _governanceTimelock) TimelockGovernance(_governanceTimelock) {
        _initializeGovernance(_governance);
    }

    // ============ District Registration ============

    /// @notice Register a new district (append-only, cannot modify existing)
    /// @param districtRoot District Merkle root from Shadow Atlas
    /// @param country ISO 3166-1 alpha-3 country code
    /// @param depth Merkle tree depth (18, 20, 22, or 24)
    /// @dev Only callable by governance multi-sig
    function registerDistrict(bytes32 districtRoot, bytes3 country, uint8 depth)
        external
        onlyGovernance
    {
        if (country == bytes3(0)) revert InvalidCountryCode();
        if (depth < 18 || depth > 24 || depth % 2 != 0) revert InvalidDepth();
        if (districtToCountry[districtRoot] != bytes3(0)) {
            revert DistrictAlreadyRegistered();
        }

        districts[districtRoot] = DistrictMetadata({
            country: country,
            depth: depth,
            registeredAt: uint32(block.timestamp),
            isActive: true,
            expiresAt: 0
        });

        districtToCountry[districtRoot] = country;
        districtDepth[districtRoot] = depth;

        emit DistrictRegistered(districtRoot, country, depth, block.timestamp);
    }

    /// @notice Batch register multiple districts (gas-optimized)
    /// @param districtRoots Array of district Merkle roots
    /// @param countries Array of ISO 3166-1 alpha-3 country codes
    /// @param depths Array of Merkle tree depths
    function registerDistrictsBatch(
        bytes32[] calldata districtRoots,
        bytes3[] calldata countries,
        uint8[] calldata depths
    ) external onlyGovernance {
        uint256 length = districtRoots.length;
        require(length == countries.length && length == depths.length, "Length mismatch");

        for (uint256 i = 0; i < length; ) {
            bytes32 root = districtRoots[i];
            bytes3 country = countries[i];
            uint8 depth = depths[i];

            if (country == bytes3(0)) revert InvalidCountryCode();
            if (depth < 18 || depth > 24 || depth % 2 != 0) revert InvalidDepth();
            if (districtToCountry[root] != bytes3(0)) {
                revert DistrictAlreadyRegistered();
            }

            districts[root] = DistrictMetadata({
                country: country,
                depth: depth,
                registeredAt: uint32(block.timestamp),
                isActive: true,
                expiresAt: 0
            });

            districtToCountry[root] = country;
            districtDepth[root] = depth;

            emit DistrictRegistered(root, country, depth, block.timestamp);

            unchecked {
                ++i;
            }
        }
    }

    // ============ Root Lifecycle Management ============

    /// @notice Check if a root is currently valid
    /// @param districtRoot District Merkle root
    /// @return True if registered, active, and not expired
    function isValidRoot(bytes32 districtRoot) public view returns (bool) {
        DistrictMetadata memory meta = districts[districtRoot];
        if (meta.registeredAt == 0) return false;
        if (!meta.isActive) return false;
        if (meta.expiresAt != 0 && block.timestamp > meta.expiresAt) return false;
        return true;
    }

    // ============ View Functions ============

    /// @notice Check if a district is registered for a specific country
    function isDistrictInCountry(bytes32 districtRoot, bytes3 expectedCountry)
        external
        view
        returns (bool)
    {
        return districtToCountry[districtRoot] == expectedCountry;
    }

    /// @notice Get country for a registered district
    function getCountry(bytes32 districtRoot) external view returns (bytes3) {
        return districtToCountry[districtRoot];
    }

    /// @notice Get depth for a registered district
    function getDepth(bytes32 districtRoot) external view returns (uint8) {
        return districtDepth[districtRoot];
    }

    /// @notice Get full metadata for a registered district
    function getDistrictMetadata(bytes32 districtRoot)
        external
        view
        returns (DistrictMetadata memory metadata)
    {
        return districts[districtRoot];
    }

    /// @notice Get country and depth in single call (gas-optimized)
    function getCountryAndDepth(bytes32 districtRoot)
        external
        view
        returns (bytes3 country, uint8 depth)
    {
        DistrictMetadata memory metadata = districts[districtRoot];
        return (metadata.country, metadata.depth);
    }

    // ============ AbstractRootLifecycle Hooks ============

    function _rootExists(bytes32 root) internal view override returns (bool) {
        return districts[root].registeredAt != 0;
    }

    function _getRootIsActive(bytes32 root) internal view override returns (bool) {
        return districts[root].isActive;
    }

    function _setRootActive(bytes32 root, bool active) internal override {
        districts[root].isActive = active;
    }

    function _setRootExpiresAt(bytes32 root, uint64 expiresAt) internal override {
        districts[root].expiresAt = expiresAt;
    }
}
