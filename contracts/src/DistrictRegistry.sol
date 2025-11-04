// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/// @title DistrictRegistry
/// @notice Immutable on-chain registry mapping district Merkle roots to country identifiers
/// @dev This contract replaces the second tier of ZK verification with cheap on-chain lookups
///
/// ARCHITECTURE DECISION:
/// Instead of proving district→country relationship in a complex two-tier ZK circuit (K=14),
/// we split the verification:
///   1. ZK proof: "I am a member of district X" (K=12, ~15KB verifier, 2-8s mobile proving)
///   2. On-chain lookup: "District X belongs to country Y" (single SLOAD, ~2.1k gas)
///
/// SECURITY:
/// - District→country mappings are PUBLIC information (congressional districts are not secrets)
/// - Registry is append-only (districts can be added, never removed or modified)
/// - Multi-sig governance controls additions
/// - All changes emit events for community audit
/// - This is NOT a "governance shortcut" - it's the correct security model for public data
///
/// BENEFITS:
/// - Mobile-friendly: K=12 circuit works on mid-range Android (2-8s vs 30+s with K=14)
/// - Deployable: 15KB verifier fits EIP-170 24KB limit (vs 26KB monolithic verifier)
/// - Gas-efficient: Single SLOAD (~2.1k gas) vs complex Tier-2 verification (~200k+ gas)
/// - Flexible: Add new districts without redeploying ZK verifier
/// - Auditable: All mappings on-chain, governance changes visible in events
///
/// COMPARISON TO ALTERNATIVES:
/// - Monolithic K=14 circuit: 26KB verifier (can't deploy), 30+s mobile proving (unusable)
/// - Diamond Proxy: Complex upgrade surface, still slow on mobile
/// - Groth16: Trusted setup ceremony (not realistic for timeline)
/// - This solution: Simple, secure, performant
contract DistrictRegistry {
    /// @notice Maps district Merkle root to country identifier
    /// @dev Key: keccak256(district_merkle_root), Value: ISO 3166-1 alpha-3 country code
    mapping(bytes32 => bytes3) public districtToCountry;

    /// @notice Multi-sig governance address (controls district additions)
    address public governance;

    /// @notice Timelock period for governance transfers (7 days)
    uint256 public constant GOVERNANCE_TIMELOCK = 7 days;

    /// @notice Pending governance transfer target → execution timestamp
    mapping(address => uint256) public pendingGovernance;

    /// @notice Emitted when a new district is registered
    /// @param districtRoot District Merkle root (from Shadow Atlas)
    /// @param country ISO 3166-1 alpha-3 country code (e.g., "USA", "GBR", "JPN")
    /// @param timestamp Registration time
    event DistrictRegistered(
        bytes32 indexed districtRoot,
        bytes3 indexed country,
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
    /// @dev Only callable by governance multi-sig
    ///      Reverts if district already registered (prevents accidental overwrites)
    function registerDistrict(bytes32 districtRoot, bytes3 country)
        external
        onlyGovernance
    {
        // Validate inputs
        if (country == bytes3(0)) revert InvalidCountryCode();
        if (districtToCountry[districtRoot] != bytes3(0)) {
            revert DistrictAlreadyRegistered();
        }

        // Append-only: register new district
        districtToCountry[districtRoot] = country;

        emit DistrictRegistered(districtRoot, country, block.timestamp);
    }

    /// @notice Batch register multiple districts (gas-optimized)
    /// @param districtRoots Array of district Merkle roots
    /// @param countries Array of ISO 3166-1 alpha-3 country codes
    /// @dev Arrays must be same length, only callable by governance
    function registerDistrictsBatch(
        bytes32[] calldata districtRoots,
        bytes3[] calldata countries
    ) external onlyGovernance {
        uint256 length = districtRoots.length;
        require(length == countries.length, "Length mismatch");

        for (uint256 i = 0; i < length; ) {
            bytes32 root = districtRoots[i];
            bytes3 country = countries[i];

            if (country == bytes3(0)) revert InvalidCountryCode();
            if (districtToCountry[root] != bytes3(0)) {
                revert DistrictAlreadyRegistered();
            }

            districtToCountry[root] = country;
            emit DistrictRegistered(root, country, block.timestamp);

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
