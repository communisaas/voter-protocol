// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

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
/// MULTI-DISTRICT REGISTRATION MODEL (24 District Slots):
/// Users can be registered in up to 24 district types (federal, state, county, city, etc.):
/// - Slots 0-19: 20 defined district types
/// - Slots 20-21: Reserved for future defined district types
/// - Slots 22-23: Overflow slots for rare/regional districts (water districts, etc.)
///
/// IMPORTANT: SINGLE-DISTRICT PROOFS
/// Each verifier handles proofs that prove membership in exactly ONE district.
/// The 24-slot model describes the registration taxonomy, not the circuit output.
/// Multi-district verification requires separate proof verifications per district.
///
/// SECURITY MODEL:
/// Two-phase registration with genesis bootstrapping:
///
/// GENESIS PHASE (pre-sealGenesis):
///   registerVerifier() — direct registration, no timelock.
///   At genesis there are no users to front-run and the deployer IS governance.
///   Deployment tx is publicly visible on-chain for auditability.
///
/// POST-GENESIS (after sealGenesis):
///   proposeVerifier() + 14-day timelock for NEW depths (HIGH-001 fix).
///   proposeVerifierUpgrade() + 14-day timelock for existing depths.
///   Community has 14 days to audit bytecode and respond to proposals.
///
/// ATTACK SCENARIO (PREVENTED POST-GENESIS):
/// 1. Protocol announces support for new depth (e.g., depth 26)
/// 2. Attacker compromises governance key
/// 3. Attacker attempts to front-run with proposeVerifier(26, maliciousVerifier)
/// 4. 14-day timelock gives community time to detect and respond
///
/// VERIFIER LIFECYCLE:
/// 1. Noir circuit compiled with DEPTH constant (e.g., DEPTH=20)
/// 2. Generates HonkVerifier_Depth{N}.sol via bb.js getSolidityVerifier() (keccak mode)
/// 3a. GENESIS: Deploy verifier, call registerVerifier(depth, addr)
/// 3b. POST-GENESIS: Deploy verifier, proposeVerifier(depth, addr), wait 14 days
/// 4. DistrictGate looks up verifier by depth during verification
contract VerifierRegistry is TimelockGovernance {
    /// @notice Maximum district types a user can be registered in (20 defined + 4 overflow)
    /// @dev Each proof proves ONE district. This constant defines the registration model.
    ///      Multi-district verification requires separate proofs per district.
    ///      Slots 0-19: Defined types, Slots 20-21: Reserved, Slots 22-23: Overflow
    uint8 public constant MAX_DISTRICT_SLOTS = 24;

    /// @notice Mapping: depth → verifier contract address
    /// @dev Only even depths supported (18, 20, 22, 24)
    mapping(uint8 => address) public verifierByDepth;

    /// @notice Pending verifier proposals per depth (for both initial registration and upgrades)
    mapping(uint8 => address) public pendingVerifiers;

    /// @notice Execution timestamps for verifier proposals
    mapping(uint8 => uint256) public verifierExecutionTime;

    /// @notice Three-tree verifier mapping: depth -> verifier contract address
    /// @dev Separate from two-tree verifiers (different circuits, different public input counts)
    mapping(uint8 => address) public threeTreeVerifierByDepth;

    /// @notice Pending three-tree verifier proposals per depth
    mapping(uint8 => address) public pendingThreeTreeVerifiers;

    /// @notice Execution timestamps for three-tree verifier proposals
    mapping(uint8 => uint256) public threeTreeVerifierExecutionTime;

    /// @notice Verifier upgrade timelock (14 days)
    /// @dev Upgrades to existing verifiers require 14-day timelock (HIGH-001 fix).
    ///      Initial registration uses direct registerVerifier() — at genesis there
    ///      are no users to protect, and the deployer IS the governance.
    ///      Post-genesis NEW depths use proposeVerifier() + timelock.
    uint256 public constant VERIFIER_TIMELOCK = 14 days;

    /// @notice Whether genesis registration phase is complete
    /// @dev Once sealed, all new registrations require the timelock path
    bool public genesisSealed;

    /// @notice Minimum supported depth
    uint8 public constant MIN_DEPTH = 18;

    /// @notice Maximum supported depth
    uint8 public constant MAX_DEPTH = 24;

    // Events
    event VerifierProposed(uint8 indexed depth, address indexed verifier, uint256 executeTime, bool isUpgrade);
    event VerifierRegistered(uint8 indexed depth, address indexed verifier);
    event VerifierUpgraded(uint8 indexed depth, address indexed previousVerifier, address indexed newVerifier);
    event VerifierProposalCancelled(uint8 indexed depth, address indexed target);
    event GenesisSealed();

    // Three-tree events
    event ThreeTreeVerifierRegistered(uint8 indexed depth, address indexed verifier);
    event ThreeTreeVerifierProposed(uint8 indexed depth, address indexed verifier, uint256 executeTime, bool isUpgrade);
    event ThreeTreeVerifierUpgraded(uint8 indexed depth, address indexed previousVerifier, address indexed newVerifier);
    event ThreeTreeVerifierProposalCancelled(uint8 indexed depth, address indexed target);

    // Errors
    error InvalidDepth();
    error VerifierNotRegistered();
    error VerifierAlreadyRegistered();
    error ProposalNotInitiated();
    error ProposalAlreadyPending();
    error GenesisAlreadySealed();

    constructor(address _governance) {
        _initializeGovernance(_governance);
    }

    // ============================================================================
    // Genesis Registration (no timelock — deployer IS governance)
    // ============================================================================

    /// @notice Direct verifier registration during genesis phase
    /// @param depth Merkle tree depth (18, 20, 22, or 24)
    /// @param verifier Address of deployed verifier contract
    /// @dev Only available before sealGenesis(). At genesis there are no users
    ///      to protect from front-running — the deployer IS the sole operator.
    ///      Once sealed, all future registrations require the timelock path.
    function registerVerifier(uint8 depth, address verifier) external onlyGovernance {
        if (genesisSealed) revert GenesisAlreadySealed();
        _validateDepth(depth);
        if (verifier == address(0)) revert ZeroAddress();
        if (verifierByDepth[depth] != address(0)) revert VerifierAlreadyRegistered();

        verifierByDepth[depth] = verifier;

        emit VerifierRegistered(depth, verifier);
    }

    /// @notice Direct three-tree verifier registration during genesis phase
    /// @param depth Merkle tree depth (18, 20, 22, or 24)
    /// @param verifier Address of deployed three-tree verifier contract
    /// @dev Three-tree verifiers handle 31 public inputs (vs 29 for two-tree).
    ///      Only available before sealGenesis().
    function registerThreeTreeVerifier(uint8 depth, address verifier) external onlyGovernance {
        if (genesisSealed) revert GenesisAlreadySealed();
        _validateDepth(depth);
        if (verifier == address(0)) revert ZeroAddress();
        if (threeTreeVerifierByDepth[depth] != address(0)) revert VerifierAlreadyRegistered();

        threeTreeVerifierByDepth[depth] = verifier;

        emit ThreeTreeVerifierRegistered(depth, verifier);
    }

    /// @notice Seal genesis phase — all future changes require timelocks
    /// @dev Irreversible. Call after initial verifiers are registered.
    function sealGenesis() external onlyGovernance {
        if (genesisSealed) revert GenesisAlreadySealed();
        genesisSealed = true;
        emit GenesisSealed();
    }

    // ============================================================================
    // Post-Genesis Registration (14-day timelock - HIGH-001 FIX)
    // ============================================================================

    /// @notice Propose new verifier registration (starts 14-day timelock)
    /// @param depth Merkle tree depth (18, 20, 22, or 24)
    /// @param verifier Address of deployed verifier contract
    /// @dev Only for post-genesis NEW depth registrations.
    ///      Monitor VerifierProposed events - community has 14 days to audit.
    function proposeVerifier(uint8 depth, address verifier) external onlyGovernance {
        require(genesisSealed, "Seal genesis first");
        _validateDepth(depth);
        if (verifier == address(0)) revert ZeroAddress();
        if (verifierByDepth[depth] != address(0)) revert VerifierAlreadyRegistered();
        if (pendingVerifiers[depth] != address(0)) revert ProposalAlreadyPending();

        pendingVerifiers[depth] = verifier;
        verifierExecutionTime[depth] = block.timestamp + VERIFIER_TIMELOCK;

        emit VerifierProposed(depth, verifier, verifierExecutionTime[depth], false);
    }

    /// @notice Execute verifier registration (after 14-day timelock)
    /// @param depth Merkle tree depth
    /// @dev Can be called by anyone after timelock expires
    function executeVerifier(uint8 depth) external {
        if (pendingVerifiers[depth] == address(0)) revert ProposalNotInitiated();
        if (block.timestamp < verifierExecutionTime[depth]) revert TimelockNotExpired();

        // This is initial registration (not upgrade)
        if (verifierByDepth[depth] != address(0)) revert VerifierAlreadyRegistered();

        verifierByDepth[depth] = pendingVerifiers[depth];

        delete pendingVerifiers[depth];
        delete verifierExecutionTime[depth];

        emit VerifierRegistered(depth, verifierByDepth[depth]);
    }

    /// @notice Cancel pending verifier registration
    /// @param depth Merkle tree depth
    function cancelVerifier(uint8 depth) external onlyGovernance {
        if (pendingVerifiers[depth] == address(0)) revert ProposalNotInitiated();

        address target = pendingVerifiers[depth];
        delete pendingVerifiers[depth];
        delete verifierExecutionTime[depth];

        emit VerifierProposalCancelled(depth, target);
    }

    // ============================================================================
    // Three-Tree Post-Genesis Registration (14-day timelock)
    // ============================================================================

    /// @notice Propose new three-tree verifier registration (starts 14-day timelock)
    /// @param depth Merkle tree depth (18, 20, 22, or 24)
    /// @param verifier Address of deployed three-tree verifier contract
    function proposeThreeTreeVerifier(uint8 depth, address verifier) external onlyGovernance {
        require(genesisSealed, "Seal genesis first");
        _validateDepth(depth);
        if (verifier == address(0)) revert ZeroAddress();
        if (threeTreeVerifierByDepth[depth] != address(0)) revert VerifierAlreadyRegistered();
        if (pendingThreeTreeVerifiers[depth] != address(0)) revert ProposalAlreadyPending();

        pendingThreeTreeVerifiers[depth] = verifier;
        threeTreeVerifierExecutionTime[depth] = block.timestamp + VERIFIER_TIMELOCK;

        emit ThreeTreeVerifierProposed(depth, verifier, threeTreeVerifierExecutionTime[depth], false);
    }

    /// @notice Execute three-tree verifier registration (after 14-day timelock)
    /// @param depth Merkle tree depth
    function executeThreeTreeVerifier(uint8 depth) external {
        if (pendingThreeTreeVerifiers[depth] == address(0)) revert ProposalNotInitiated();
        if (block.timestamp < threeTreeVerifierExecutionTime[depth]) revert TimelockNotExpired();
        if (threeTreeVerifierByDepth[depth] != address(0)) revert VerifierAlreadyRegistered();

        threeTreeVerifierByDepth[depth] = pendingThreeTreeVerifiers[depth];

        delete pendingThreeTreeVerifiers[depth];
        delete threeTreeVerifierExecutionTime[depth];

        emit ThreeTreeVerifierRegistered(depth, threeTreeVerifierByDepth[depth]);
    }

    /// @notice Cancel pending three-tree verifier proposal
    /// @param depth Merkle tree depth
    function cancelThreeTreeVerifier(uint8 depth) external onlyGovernance {
        if (pendingThreeTreeVerifiers[depth] == address(0)) revert ProposalNotInitiated();

        address target = pendingThreeTreeVerifiers[depth];
        delete pendingThreeTreeVerifiers[depth];
        delete threeTreeVerifierExecutionTime[depth];

        emit ThreeTreeVerifierProposalCancelled(depth, target);
    }

    // ============================================================================
    // Verifier Upgrades (14-day timelock)
    // ============================================================================

    /// @notice Initiate verifier upgrade (starts 14-day timelock)
    /// @param depth Merkle tree depth
    /// @param newVerifier New verifier contract address
    /// @dev Monitor VerifierProposed events - community has 14 days to respond
    function proposeVerifierUpgrade(uint8 depth, address newVerifier) external onlyGovernance {
        _validateDepth(depth);
        if (newVerifier == address(0)) revert ZeroAddress();
        if (verifierByDepth[depth] == address(0)) revert VerifierNotRegistered();
        if (newVerifier == verifierByDepth[depth]) revert SameAddress();
        if (pendingVerifiers[depth] != address(0)) revert ProposalAlreadyPending();

        pendingVerifiers[depth] = newVerifier;
        verifierExecutionTime[depth] = block.timestamp + VERIFIER_TIMELOCK;

        emit VerifierProposed(depth, newVerifier, verifierExecutionTime[depth], true);
    }

    /// @notice Execute verifier upgrade (after 14-day timelock)
    /// @param depth Merkle tree depth
    /// @dev Can be called by anyone after timelock expires
    function executeVerifierUpgrade(uint8 depth) external {
        if (pendingVerifiers[depth] == address(0)) revert ProposalNotInitiated();
        if (block.timestamp < verifierExecutionTime[depth]) revert TimelockNotExpired();

        // This is an upgrade (must have existing verifier)
        if (verifierByDepth[depth] == address(0)) revert VerifierNotRegistered();

        address previousVerifier = verifierByDepth[depth];
        verifierByDepth[depth] = pendingVerifiers[depth];

        delete pendingVerifiers[depth];
        delete verifierExecutionTime[depth];

        emit VerifierUpgraded(depth, previousVerifier, verifierByDepth[depth]);
    }

    /// @notice Cancel pending verifier upgrade
    /// @param depth Merkle tree depth
    function cancelVerifierUpgrade(uint8 depth) external onlyGovernance {
        if (pendingVerifiers[depth] == address(0)) revert ProposalNotInitiated();

        address target = pendingVerifiers[depth];
        delete pendingVerifiers[depth];
        delete verifierExecutionTime[depth];

        emit VerifierProposalCancelled(depth, target);
    }

    // ============================================================================
    // Three-Tree Verifier Upgrades (14-day timelock)
    // ============================================================================

    /// @notice Initiate three-tree verifier upgrade (starts 14-day timelock)
    /// @param depth Merkle tree depth
    /// @param newVerifier New three-tree verifier contract address
    function proposeThreeTreeVerifierUpgrade(uint8 depth, address newVerifier) external onlyGovernance {
        _validateDepth(depth);
        if (newVerifier == address(0)) revert ZeroAddress();
        if (threeTreeVerifierByDepth[depth] == address(0)) revert VerifierNotRegistered();
        if (newVerifier == threeTreeVerifierByDepth[depth]) revert SameAddress();
        if (pendingThreeTreeVerifiers[depth] != address(0)) revert ProposalAlreadyPending();

        pendingThreeTreeVerifiers[depth] = newVerifier;
        threeTreeVerifierExecutionTime[depth] = block.timestamp + VERIFIER_TIMELOCK;

        emit ThreeTreeVerifierProposed(depth, newVerifier, threeTreeVerifierExecutionTime[depth], true);
    }

    /// @notice Execute three-tree verifier upgrade (after 14-day timelock)
    /// @param depth Merkle tree depth
    function executeThreeTreeVerifierUpgrade(uint8 depth) external {
        if (pendingThreeTreeVerifiers[depth] == address(0)) revert ProposalNotInitiated();
        if (block.timestamp < threeTreeVerifierExecutionTime[depth]) revert TimelockNotExpired();
        if (threeTreeVerifierByDepth[depth] == address(0)) revert VerifierNotRegistered();

        address previousVerifier = threeTreeVerifierByDepth[depth];
        threeTreeVerifierByDepth[depth] = pendingThreeTreeVerifiers[depth];

        delete pendingThreeTreeVerifiers[depth];
        delete threeTreeVerifierExecutionTime[depth];

        emit ThreeTreeVerifierUpgraded(depth, previousVerifier, threeTreeVerifierByDepth[depth]);
    }

    /// @notice Cancel pending three-tree verifier upgrade
    /// @param depth Merkle tree depth
    function cancelThreeTreeVerifierUpgrade(uint8 depth) external onlyGovernance {
        if (pendingThreeTreeVerifiers[depth] == address(0)) revert ProposalNotInitiated();

        address target = pendingThreeTreeVerifiers[depth];
        delete pendingThreeTreeVerifiers[depth];
        delete threeTreeVerifierExecutionTime[depth];

        emit ThreeTreeVerifierProposalCancelled(depth, target);
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

    /// @notice Get time remaining until verifier proposal can execute
    /// @param depth Merkle tree depth
    /// @return secondsRemaining Time in seconds (0 if ready or not initiated)
    function getProposalDelay(uint8 depth) external view returns (uint256 secondsRemaining) {
        if (pendingVerifiers[depth] == address(0) || block.timestamp >= verifierExecutionTime[depth]) {
            return 0;
        }
        return verifierExecutionTime[depth] - block.timestamp;
    }

    /// @notice Check if there's a pending proposal for a depth
    /// @param depth Merkle tree depth
    /// @return True if proposal pending
    function hasPendingProposal(uint8 depth) external view returns (bool) {
        return pendingVerifiers[depth] != address(0);
    }

    /// @notice Get pending proposal details for a depth
    /// @param depth Merkle tree depth
    /// @return verifier Pending verifier address (address(0) if none)
    /// @return executeTime Timestamp when proposal can be executed (0 if none)
    /// @return isUpgrade True if this is an upgrade vs initial registration
    function getPendingProposal(uint8 depth) external view returns (
        address verifier,
        uint256 executeTime,
        bool isUpgrade
    ) {
        verifier = pendingVerifiers[depth];
        executeTime = verifierExecutionTime[depth];
        isUpgrade = verifierByDepth[depth] != address(0);
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
    // Three-Tree View Functions
    // ============================================================================

    /// @notice Get three-tree verifier address for a depth
    /// @param depth Merkle tree depth
    /// @return Verifier contract address (address(0) if not registered)
    function getThreeTreeVerifier(uint8 depth) external view returns (address) {
        _validateDepth(depth);
        return threeTreeVerifierByDepth[depth];
    }

    /// @notice Check if three-tree verifier is registered for depth
    /// @param depth Merkle tree depth
    /// @return True if three-tree verifier registered
    function isThreeTreeVerifierRegistered(uint8 depth) external view returns (bool) {
        _validateDepth(depth);
        return threeTreeVerifierByDepth[depth] != address(0);
    }

    /// @notice Get all registered three-tree depths
    /// @return Array of depths with registered three-tree verifiers
    function getRegisteredThreeTreeDepths() external view returns (uint8[] memory) {
        uint8[] memory depths = new uint8[](4);
        uint8 count = 0;

        for (uint8 d = MIN_DEPTH; d <= MAX_DEPTH; d += 2) {
            if (threeTreeVerifierByDepth[d] != address(0)) {
                depths[count] = d;
                count++;
            }
        }

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
