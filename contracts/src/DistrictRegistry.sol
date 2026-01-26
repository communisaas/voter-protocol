// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/// @title DistrictRegistry
/// @notice Immutable on-chain registry mapping district Merkle roots to country identifiers and tree depths
/// @dev This contract replaces the second tier of ZK verification with cheap on-chain lookups
///
/// ARCHITECTURE DECISION:
/// Instead of proving district→country relationship in a complex two-tier ZK circuit (K=14),
/// we split the verification:
///   1. ZK proof: "I am a member of district X" (K=12+, verifier per depth, 2-15s mobile proving)
///   2. On-chain lookup: "District X belongs to country Y with depth Z" (single SLOAD, ~2.1k gas)
///
/// MULTI-DEPTH SUPPORT (International Coverage):
/// - Depth 18: 262K addresses (small countries, city-states like Singapore)
/// - Depth 20: 1M addresses (medium countries, UK constituencies)
/// - Depth 22: 4M addresses (large countries, US congressional districts)
/// - Depth 24: 16M addresses (very large countries, future expansion)
///
/// HYBRID 24-SLOT DISTRICT APPROACH:
/// Each proof can contain up to 24 district slots using a hybrid allocation:
/// - Slots 0-19: 20 defined district types (federal, state, county, city, school, etc.)
/// - Slots 20-21: Reserved for future defined district types
/// - Slots 22-23: Overflow slots for rare/regional districts (water districts, etc.)
/// This registry stores the Merkle root for each district; the slot allocation is
/// handled at the circuit level. Empty slots use bytes32(0).
///
/// SECURITY:
/// - District→country→depth mappings are PUBLIC information (electoral districts are not secrets)
/// - Registry is append-only (districts can be added, never removed or modified)
/// - Multi-sig governance controls additions
/// - All changes emit events for community audit
/// - This is NOT a "governance shortcut" - it's the correct security model for public data
///
/// BENEFITS:
/// - Mobile-friendly: Depth-appropriate circuits work on mobile (8-15s for depth 20)
/// - Deployable: Per-depth verifiers fit EIP-170 (depth 18) or use split deployment (depth 22+)
/// - Gas-efficient: Single SLOAD (~2.1k gas) vs complex verification
/// - Flexible: Add new districts/depths without redeploying ZK verifiers
/// - Auditable: All mappings on-chain, governance changes visible in events
contract DistrictRegistry {
    /// @notice Maximum district slots supported per proof (hybrid: 20 defined + 4 overflow)
    /// @dev Slots 0-19: Defined types, Slots 20-21: Reserved, Slots 22-23: Overflow for rare districts
    uint8 public constant MAX_DISTRICT_SLOTS = 24;

    /// @notice District metadata structure
    struct DistrictMetadata {
        bytes3 country;      // ISO 3166-1 alpha-3 country code
        uint8 depth;         // Merkle tree depth (18, 20, 22, or 24)
        uint32 registeredAt; // Registration timestamp (packed for gas efficiency)
    }

    /// @notice Maps district Merkle root to metadata
    mapping(bytes32 => DistrictMetadata) public districts;

    /// @notice Legacy mapping for backwards compatibility
    /// @dev Kept for existing contracts that only need country lookup
    mapping(bytes32 => bytes3) public districtToCountry;

    /// @notice Fast depth lookup (avoids struct unpacking)
    mapping(bytes32 => uint8) public districtDepth;

    /// @notice Multi-sig governance address (controls district additions)
    address public governance;

    /// @notice Timelock period for governance transfers (7 days)
    uint256 public constant GOVERNANCE_TIMELOCK = 7 days;

    /// @notice Pending governance transfer target → execution timestamp
    mapping(address => uint256) public pendingGovernance;

    /// @notice Emitted when a new district is registered
    /// @param districtRoot District Merkle root (from Shadow Atlas)
    /// @param country ISO 3166-1 alpha-3 country code (e.g., "USA", "GBR", "JPN")
    /// @param depth Merkle tree depth (18, 20, 22, or 24)
    /// @param timestamp Registration time
    event DistrictRegistered(
        bytes32 indexed districtRoot,
        bytes3 indexed country,
        uint8 depth,
        uint256 timestamp
    );

    /// @notice Emitted when governance transfer is initiated (7-day timelock starts)
    event GovernanceTransferInitiated(
        address indexed newGovernance,
        uint256 executeTime
    );

    /// @notice Emitted when governance transfer is executed (after timelock)
    event GovernanceTransferred(
        address indexed previousGovernance,
        address indexed newGovernance
    );

    /// @notice Emitted when governance transfer is cancelled
    event GovernanceTransferCancelled(address indexed newGovernance);

    error UnauthorizedCaller();
    error DistrictAlreadyRegistered();
    error InvalidCountryCode();
    error InvalidDepth();
    error ZeroAddress();
    error TransferNotInitiated();
    error TimelockNotExpired();
    error TimelockExpired();

    modifier onlyGovernance() {
        if (msg.sender != governance) revert UnauthorizedCaller();
        _;
    }

    /// @notice Deploy registry with multi-sig governance
    /// @param _governance Multi-sig address that controls district additions
    constructor(address _governance) {
        if (_governance == address(0)) revert ZeroAddress();
        governance = _governance;
    }

    /// @notice Register a new district (append-only, cannot modify existing)
    /// @param districtRoot District Merkle root from Shadow Atlas
    /// @param country ISO 3166-1 alpha-3 country code
    /// @param depth Merkle tree depth (18, 20, 22, or 24)
    /// @dev Only callable by governance multi-sig
    ///      Reverts if district already registered (prevents accidental overwrites)
    ///      Depth must be even and in range [18, 24]
    function registerDistrict(bytes32 districtRoot, bytes3 country, uint8 depth)
        external
        onlyGovernance
    {
        // Validate inputs
        if (country == bytes3(0)) revert InvalidCountryCode();
        if (depth < 18 || depth > 24 || depth % 2 != 0) revert InvalidDepth();
        if (districtToCountry[districtRoot] != bytes3(0)) {
            revert DistrictAlreadyRegistered();
        }

        // Append-only: register new district with metadata
        districts[districtRoot] = DistrictMetadata({
            country: country,
            depth: depth,
            registeredAt: uint32(block.timestamp)
        });

        // Update fast-lookup mappings
        districtToCountry[districtRoot] = country;
        districtDepth[districtRoot] = depth;

        emit DistrictRegistered(districtRoot, country, depth, block.timestamp);
    }

    /// @notice Batch register multiple districts (gas-optimized)
    /// @param districtRoots Array of district Merkle roots
    /// @param countries Array of ISO 3166-1 alpha-3 country codes
    /// @param depths Array of Merkle tree depths
    /// @dev All arrays must be same length, only callable by governance
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
                registeredAt: uint32(block.timestamp)
            });

            districtToCountry[root] = country;
            districtDepth[root] = depth;

            emit DistrictRegistered(root, country, depth, block.timestamp);

            unchecked {
                ++i;
            }
        }
    }

    /// @notice Check if a district is registered for a specific country
    /// @param districtRoot District Merkle root to check
    /// @param expectedCountry Expected country code
    /// @return True if district is registered and matches expected country
    function isDistrictInCountry(bytes32 districtRoot, bytes3 expectedCountry)
        external
        view
        returns (bool)
    {
        return districtToCountry[districtRoot] == expectedCountry;
    }

    /// @notice Get country for a registered district
    /// @param districtRoot District Merkle root
    /// @return Country code (bytes3(0) if not registered)
    function getCountry(bytes32 districtRoot) external view returns (bytes3) {
        return districtToCountry[districtRoot];
    }

    /// @notice Get depth for a registered district
    /// @param districtRoot District Merkle root
    /// @return Depth (0 if not registered)
    function getDepth(bytes32 districtRoot) external view returns (uint8) {
        return districtDepth[districtRoot];
    }

    /// @notice Get full metadata for a registered district
    /// @param districtRoot District Merkle root
    /// @return metadata District metadata struct
    function getDistrictMetadata(bytes32 districtRoot)
        external
        view
        returns (DistrictMetadata memory metadata)
    {
        return districts[districtRoot];
    }

    /// @notice Get country and depth in single call (gas-optimized)
    /// @param districtRoot District Merkle root
    /// @return country ISO 3166-1 alpha-3 code
    /// @return depth Merkle tree depth
    function getCountryAndDepth(bytes32 districtRoot)
        external
        view
        returns (bytes3 country, uint8 depth)
    {
        DistrictMetadata memory metadata = districts[districtRoot];
        return (metadata.country, metadata.depth);
    }

    /// @notice Initiate governance transfer (starts 7-day timelock)
    /// @param newGovernance New governance address
    /// @dev Only current governance can initiate
    ///      Timelock prevents instant takeover if multi-sig compromised
    ///      Community has 7 days to detect and respond to malicious transfer
    function initiateGovernanceTransfer(address newGovernance)
        external
        onlyGovernance
    {
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
    function cancelGovernanceTransfer(address newGovernance)
        external
        onlyGovernance
    {
        if (pendingGovernance[newGovernance] == 0) revert TransferNotInitiated();

        delete pendingGovernance[newGovernance];
        emit GovernanceTransferCancelled(newGovernance);
    }
}
