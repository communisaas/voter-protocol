// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "./TimelockGovernance.sol";

/// @title VerifierRegistry
/// @notice Registry of ZK verifiers for different Merkle tree depths
/// @dev Maps depth → verifier address for international district support
///
/// DEPTH VARIANTS (international coverage):
/// - Depth 18: 262K addresses (small countries, city-states)
/// - Depth 20: 1M addresses (medium countries, UK constituencies)
/// - Depth 22: 4M addresses (large countries, US congressional districts)
/// - Depth 24: 16M addresses (very large countries, future expansion)
///
/// HYBRID 24-SLOT DISTRICT APPROACH:
/// All verifiers support proofs with up to 24 district slots:
/// - Slots 0-19: 20 defined district types (federal, state, county, city, school, etc.)
/// - Slots 20-21: Reserved for future defined district types
/// - Slots 22-23: Overflow slots for rare/regional districts (water districts, etc.)
/// The circuit handles empty slots (bytes32(0)) gracefully.
///
/// UPGRADE PATH:
/// - Each verifier has 14-day timelock (matches DistrictGate)
/// - Community can audit new verifier bytecode during timelock
/// - Verifiers are circuit-specific (different depths = different circuits)
///
/// VERIFIER LIFECYCLE:
/// 1. Noir circuit compiled with DEPTH constant (e.g., DEPTH=20)
/// 2. Generates UltraPlonkVerifier_Depth{N}.sol with embedded VK
/// 3. Deployed to Scroll, address registered here
/// 4. DistrictGate looks up verifier by depth during verification
contract VerifierRegistry is TimelockGovernance {
    /// @notice Maximum district slots supported per proof (hybrid: 20 defined + 4 overflow)
    /// @dev Slots 0-19: Defined types, Slots 20-21: Reserved, Slots 22-23: Overflow
    uint8 public constant MAX_DISTRICT_SLOTS = 24;

    /// @notice Mapping: depth → verifier contract address
    /// @dev Only even depths supported (18, 20, 22, 24)
    mapping(uint8 => address) public verifierByDepth;

    /// @notice Pending verifier upgrades per depth
    mapping(uint8 => address) public pendingVerifiers;

    /// @notice Execution timestamps for verifier upgrades
    mapping(uint8 => uint256) public upgradeExecutionTime;

    /// @notice Verifier upgrade timelock (14 days - matches DistrictGate)
    uint256 public constant VERIFIER_UPGRADE_TIMELOCK = 14 days;

    /// @notice Minimum supported depth
    uint8 public constant MIN_DEPTH = 18;

    /// @notice Maximum supported depth
    uint8 public constant MAX_DEPTH = 24;

    // Events
    event VerifierRegistered(uint8 indexed depth, address indexed verifier);
    event VerifierUpgradeInitiated(uint8 indexed depth, address indexed newVerifier, uint256 executeTime);
    event VerifierUpgraded(uint8 indexed depth, address indexed previousVerifier, address indexed newVerifier);
    event VerifierUpgradeCancelled(uint8 indexed depth, address indexed target);

    // Errors
    error InvalidDepth();
    error VerifierNotRegistered();
    error VerifierAlreadyRegistered();
    error UpgradeNotInitiated();

    constructor(address _governance) {
        _initializeGovernance(_governance);
    }

    // ============================================================================
    // Verifier Registration (Initial Setup)
    // ============================================================================

    /// @notice Register initial verifier for a depth (no timelock)
    /// @param depth Merkle tree depth (18, 20, 22, or 24)
    /// @param verifier Address of deployed verifier contract
    /// @dev Only callable if depth has no verifier registered
    ///      Subsequent changes require timelock via initiateVerifierUpgrade()
    function registerVerifier(uint8 depth, address verifier) external onlyGovernance {
        _validateDepth(depth);
        if (verifier == address(0)) revert ZeroAddress();
        if (verifierByDepth[depth] != address(0)) revert VerifierAlreadyRegistered();

        verifierByDepth[depth] = verifier;
        emit VerifierRegistered(depth, verifier);
    }

    // ============================================================================
    // Verifier Upgrades (14-day timelock)
    // ============================================================================

    /// @notice Initiate verifier upgrade (starts 14-day timelock)
    /// @param depth Merkle tree depth
    /// @param newVerifier New verifier contract address
    /// @dev Monitor VerifierUpgradeInitiated events - community has 14 days to respond
    function initiateVerifierUpgrade(uint8 depth, address newVerifier) external onlyGovernance {
        _validateDepth(depth);
        if (newVerifier == address(0)) revert ZeroAddress();
        if (verifierByDepth[depth] == address(0)) revert VerifierNotRegistered();
        if (newVerifier == verifierByDepth[depth]) revert SameAddress();

        pendingVerifiers[depth] = newVerifier;
        upgradeExecutionTime[depth] = block.timestamp + VERIFIER_UPGRADE_TIMELOCK;

        emit VerifierUpgradeInitiated(depth, newVerifier, upgradeExecutionTime[depth]);
    }

    /// @notice Execute verifier upgrade (after 14-day timelock)
    /// @param depth Merkle tree depth
    /// @dev Can be called by anyone after timelock expires
    function executeVerifierUpgrade(uint8 depth) external {
        if (pendingVerifiers[depth] == address(0)) revert UpgradeNotInitiated();
        if (block.timestamp < upgradeExecutionTime[depth]) revert TimelockNotExpired();

        address previousVerifier = verifierByDepth[depth];
        verifierByDepth[depth] = pendingVerifiers[depth];

        delete pendingVerifiers[depth];
        delete upgradeExecutionTime[depth];

        emit VerifierUpgraded(depth, previousVerifier, verifierByDepth[depth]);
    }

    /// @notice Cancel pending verifier upgrade
    /// @param depth Merkle tree depth
    function cancelVerifierUpgrade(uint8 depth) external onlyGovernance {
        if (pendingVerifiers[depth] == address(0)) revert UpgradeNotInitiated();

        address target = pendingVerifiers[depth];
        delete pendingVerifiers[depth];
        delete upgradeExecutionTime[depth];

        emit VerifierUpgradeCancelled(depth, target);
    }

    // ============================================================================
    // View Functions
    // ============================================================================

    /// @notice Get verifier address for a depth
    /// @param depth Merkle tree depth
    /// @return Verifier contract address (address(0) if not registered)
    function getVerifier(uint8 depth) external view returns (address) {
        _validateDepth(depth);
        return verifierByDepth[depth];
    }

    /// @notice Check if verifier is registered for depth
    /// @param depth Merkle tree depth
    /// @return True if verifier registered
    function isVerifierRegistered(uint8 depth) external view returns (bool) {
        _validateDepth(depth);
        return verifierByDepth[depth] != address(0);
    }

    /// @notice Get time remaining until verifier upgrade can execute
    /// @param depth Merkle tree depth
    /// @return secondsRemaining Time in seconds (0 if ready or not initiated)
    function getUpgradeDelay(uint8 depth) external view returns (uint256 secondsRemaining) {
        if (pendingVerifiers[depth] == address(0) || block.timestamp >= upgradeExecutionTime[depth]) {
            return 0;
        }
        return upgradeExecutionTime[depth] - block.timestamp;
    }

    /// @notice Get all registered depths
    /// @return Array of depths with registered verifiers
    function getRegisteredDepths() external view returns (uint8[] memory) {
        uint8[] memory depths = new uint8[](4); // Max 4 depths (18, 20, 22, 24)
        uint8 count = 0;

        for (uint8 d = MIN_DEPTH; d <= MAX_DEPTH; d += 2) {
            if (verifierByDepth[d] != address(0)) {
                depths[count] = d;
                count++;
            }
        }

        // Trim array to actual count
        uint8[] memory result = new uint8[](count);
        for (uint8 i = 0; i < count; i++) {
            result[i] = depths[i];
        }
        return result;
    }

    // ============================================================================
    // Internal Helpers
    // ============================================================================

    /// @notice Validate depth is supported and even
    /// @param depth Merkle tree depth to validate
    function _validateDepth(uint8 depth) internal pure {
        if (depth < MIN_DEPTH || depth > MAX_DEPTH || depth % 2 != 0) {
            revert InvalidDepth();
        }
    }
}
