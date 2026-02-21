// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "forge-std/Test.sol";
import "../src/DistrictGate.sol";
import "../src/DistrictRegistry.sol";
import "../src/NullifierRegistry.sol";
import "../src/VerifierRegistry.sol";
import "../src/UserRootRegistry.sol";
import "../src/CellMapRegistry.sol";
import "../src/EngagementRootRegistry.sol";

/// @title DistrictGate Three-Tree Proof Integration Tests
/// @notice Tests for verifyThreeTreeProof: user identity + cell-district map + engagement tree
/// @dev Tests cover:
///      1. Happy path - full three-tree proof verification
///      2. Engagement registry configuration - genesis + propose/execute/cancel
///      3. Root validation - user root, cell map root, engagement root checks
///      4. Engagement tier validation - range [0, 4]
///      5. Country cross-check between Tree 1 and Tree 2
///      6. Verifier routing - three-tree verifier lookup
///      7. Nullifier management - recording and replay protection
///      8. Pause controls - whenNotPaused modifier
///      9. Backwards compatibility - two-tree flow still works
contract DistrictGateThreeTreeTest is Test {
    DistrictGate public gate;
    DistrictRegistry public districtRegistry;
    NullifierRegistry public nullifierRegistry;
    VerifierRegistry public verifierRegistry;
    UserRootRegistry public userRootRegistry;
    CellMapRegistry public cellMapRegistry;
    EngagementRootRegistry public engagementRootRegistry;

    // Mock verifiers
    MockThreeTreeVerifier public passingVerifier;
    MockThreeTreeVerifier public failingVerifier;
    MockThreeTreeVerifier public twoTreePassingVerifier;

    address public governance = address(0x1);
    address public attacker = address(0x3);

    // Test constants: Tree 1 (user identity) roots
    bytes32 public constant USER_ROOT_1 = bytes32(uint256(0xAAAA1111));
    bytes32 public constant USER_ROOT_INVALID = bytes32(uint256(0xAAAADEAD));

    // Test constants: Tree 2 (cell-district mapping) roots
    bytes32 public constant CELL_MAP_ROOT_1 = bytes32(uint256(0xBBBB1111));
    bytes32 public constant CELL_MAP_ROOT_INVALID = bytes32(uint256(0xBBBBDEAD));

    // Test constants: Tree 3 (engagement) roots
    bytes32 public constant ENGAGEMENT_ROOT_1 = bytes32(uint256(0xCCCC1111));
    bytes32 public constant ENGAGEMENT_ROOT_2 = bytes32(uint256(0xCCCC2222));
    bytes32 public constant ENGAGEMENT_ROOT_INVALID = bytes32(uint256(0xCCCCDEAD));

    // Test constants: nullifiers and action domains
    bytes32 public constant NULLIFIER_1 = bytes32(uint256(0x456));
    bytes32 public constant NULLIFIER_2 = bytes32(uint256(0x789));
    bytes32 public constant ACTION_DOMAIN_1 = keccak256("election-2024");
    bytes32 public constant ACTION_DOMAIN_NOT_WHITELISTED = keccak256("not-whitelisted");
    bytes32 public constant AUTHORITY_LEVEL = bytes32(uint256(3));

    bytes3 public constant USA = "USA";
    bytes3 public constant CAN = "CAN";

    uint8 public constant VERIFIER_DEPTH = 20;

    // Events from DistrictGate
    event ThreeTreeProofVerified(
        address indexed signer,
        address indexed submitter,
        bytes32 indexed userRoot,
        bytes32 cellMapRoot,
        bytes32 engagementRoot,
        bytes32 nullifier,
        bytes32 actionDomain,
        bytes32 authorityLevel,
        uint8 engagementTier,
        uint8 verifierDepth
    );

    event TwoTreeProofVerified(
        address indexed signer,
        address indexed submitter,
        bytes32 indexed userRoot,
        bytes32 cellMapRoot,
        bytes32 nullifier,
        bytes32 actionDomain,
        bytes32 authorityLevel,
        uint8 verifierDepth
    );

    event EngagementRegistrySetGenesis(address indexed engagementRootRegistry);
    event EngagementRegistryProposed(address indexed proposed, uint256 executeTime);
    event EngagementRegistrySet(address indexed previousRegistry, address indexed newRegistry);
    event EngagementRegistryCancelled(address indexed proposed);

    function setUp() public {
        // Deploy mock verifiers
        passingVerifier = new MockThreeTreeVerifier(true);
        failingVerifier = new MockThreeTreeVerifier(false);
        twoTreePassingVerifier = new MockThreeTreeVerifier(true);

        // Deploy registries
        districtRegistry = new DistrictRegistry(governance);
        nullifierRegistry = new NullifierRegistry(governance);
        verifierRegistry = new VerifierRegistry(governance);
        userRootRegistry = new UserRootRegistry(governance);
        cellMapRegistry = new CellMapRegistry(governance);
        engagementRootRegistry = new EngagementRootRegistry(governance);

        // Deploy DistrictGate
        gate = new DistrictGate(
            address(verifierRegistry),
            address(districtRegistry),
            address(nullifierRegistry),
            governance
        );

        // Register verifiers (genesis) - both two-tree and three-tree
        vm.startPrank(governance);
        verifierRegistry.registerVerifier(VERIFIER_DEPTH, address(twoTreePassingVerifier));
        verifierRegistry.registerThreeTreeVerifier(VERIFIER_DEPTH, address(passingVerifier));
        verifierRegistry.sealGenesis();
        vm.stopPrank();

        // Authorize gate as caller on NullifierRegistry (7-day timelock)
        vm.prank(governance);
        nullifierRegistry.proposeCallerAuthorization(address(gate));
        vm.warp(block.timestamp + 7 days);
        nullifierRegistry.executeCallerAuthorization(address(gate));

        // Register user roots
        vm.startPrank(governance);
        userRootRegistry.registerUserRoot(USER_ROOT_1, USA, 20);

        // Register cell map roots
        cellMapRegistry.registerCellMapRoot(CELL_MAP_ROOT_1, USA, 20);

        // Register engagement roots
        engagementRootRegistry.registerEngagementRoot(ENGAGEMENT_ROOT_1, 20);
        engagementRootRegistry.registerEngagementRoot(ENGAGEMENT_ROOT_2, 20);
        vm.stopPrank();

        // Configure registries on DistrictGate via genesis (before sealing)
        vm.startPrank(governance);
        gate.setTwoTreeRegistriesGenesis(address(userRootRegistry), address(cellMapRegistry));
        gate.setEngagementRegistryGenesis(address(engagementRootRegistry));
        gate.registerActionDomainGenesis(ACTION_DOMAIN_1);
        gate.sealGenesis();
        vm.stopPrank();
    }

    // ============================================================================
    // 1. HAPPY PATH
    // ============================================================================

    /// @notice Full three-tree proof verification succeeds with valid inputs
    function test_VerifyThreeTreeProof_HappyPath() public {
        bytes memory proof = hex"deadbeef";
        uint256[31] memory publicInputs = _buildThreeTreePublicInputs(
            USER_ROOT_1,
            CELL_MAP_ROOT_1,
            NULLIFIER_1,
            ACTION_DOMAIN_1,
            AUTHORITY_LEVEL,
            ENGAGEMENT_ROOT_1,
            2 // engagement_tier = Established
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateThreeTreeSignature(
            proof,
            publicInputs,
            VERIFIER_DEPTH
        );

        vm.expectEmit(true, true, true, true);
        emit ThreeTreeProofVerified(
            signer,
            address(this),
            USER_ROOT_1,
            CELL_MAP_ROOT_1,
            ENGAGEMENT_ROOT_1,
            NULLIFIER_1,
            ACTION_DOMAIN_1,
            AUTHORITY_LEVEL,
            2,
            VERIFIER_DEPTH
        );

        gate.verifyThreeTreeProof(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);

        // Verify nullifier was recorded
        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, NULLIFIER_1));
        assertEq(gate.getParticipantCount(ACTION_DOMAIN_1), 1);
    }

    /// @notice Three-tree proof with tier 0 (new user) succeeds
    function test_VerifyThreeTreeProof_Tier0() public {
        bytes memory proof = hex"deadbeef";
        uint256[31] memory publicInputs = _buildThreeTreePublicInputs(
            USER_ROOT_1, CELL_MAP_ROOT_1, NULLIFIER_1, ACTION_DOMAIN_1,
            AUTHORITY_LEVEL, ENGAGEMENT_ROOT_1, 0
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateThreeTreeSignature(
            proof, publicInputs, VERIFIER_DEPTH
        );

        gate.verifyThreeTreeProof(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);
        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, NULLIFIER_1));
    }

    /// @notice Three-tree proof with tier 4 (pillar) succeeds
    function test_VerifyThreeTreeProof_Tier4() public {
        bytes memory proof = hex"deadbeef";
        uint256[31] memory publicInputs = _buildThreeTreePublicInputs(
            USER_ROOT_1, CELL_MAP_ROOT_1, NULLIFIER_1, ACTION_DOMAIN_1,
            AUTHORITY_LEVEL, ENGAGEMENT_ROOT_1, 4
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateThreeTreeSignature(
            proof, publicInputs, VERIFIER_DEPTH
        );

        gate.verifyThreeTreeProof(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);
        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, NULLIFIER_1));
    }

    // ============================================================================
    // 2. ENGAGEMENT REGISTRY CONFIGURATION
    // ============================================================================

    /// @notice Genesis: setEngagementRegistryGenesis works before seal
    function test_EngagementRegistry_GenesisSet() public {
        // Deploy a fresh gate
        DistrictGate freshGate = new DistrictGate(
            address(verifierRegistry),
            address(districtRegistry),
            address(nullifierRegistry),
            governance
        );

        EngagementRootRegistry newRegistry = new EngagementRootRegistry(governance);

        vm.prank(governance);
        vm.expectEmit(true, false, false, false);
        emit EngagementRegistrySetGenesis(address(newRegistry));
        freshGate.setEngagementRegistryGenesis(address(newRegistry));

        assertEq(address(freshGate.engagementRootRegistry()), address(newRegistry));
    }

    /// @notice Genesis: revert after seal
    function test_EngagementRegistry_RevertWhen_GenesisAfterSeal() public {
        DistrictGate freshGate = new DistrictGate(
            address(verifierRegistry),
            address(districtRegistry),
            address(nullifierRegistry),
            governance
        );

        vm.startPrank(governance);
        freshGate.sealGenesis();

        vm.expectRevert(DistrictGate.GenesisAlreadySealed.selector);
        freshGate.setEngagementRegistryGenesis(address(engagementRootRegistry));
        vm.stopPrank();
    }

    /// @notice Genesis: revert on zero address
    function test_EngagementRegistry_RevertWhen_GenesisZeroAddress() public {
        DistrictGate freshGate = new DistrictGate(
            address(verifierRegistry),
            address(districtRegistry),
            address(nullifierRegistry),
            governance
        );

        vm.prank(governance);
        vm.expectRevert(TimelockGovernance.ZeroAddress.selector);
        freshGate.setEngagementRegistryGenesis(address(0));
    }

    /// @notice Post-genesis: propose, execute, cancel engagement registry
    function test_EngagementRegistry_ProposeExecuteCancel() public {
        EngagementRootRegistry newRegistry = new EngagementRootRegistry(governance);

        // Propose
        uint256 expectedExecuteTime = block.timestamp + 7 days;
        vm.prank(governance);
        vm.expectEmit(true, false, false, true);
        emit EngagementRegistryProposed(address(newRegistry), expectedExecuteTime);
        gate.proposeEngagementRegistry(address(newRegistry));

        assertEq(gate.pendingEngagementRegistry(), address(newRegistry));
        assertEq(gate.pendingEngagementRegistryExecuteTime(), expectedExecuteTime);

        // Cancel
        vm.prank(governance);
        vm.expectEmit(true, false, false, false);
        emit EngagementRegistryCancelled(address(newRegistry));
        gate.cancelEngagementRegistry();

        assertEq(gate.pendingEngagementRegistry(), address(0));
        assertEq(gate.pendingEngagementRegistryExecuteTime(), 0);

        // Propose again and execute
        vm.prank(governance);
        gate.proposeEngagementRegistry(address(newRegistry));

        vm.warp(block.timestamp + 7 days);

        vm.expectEmit(true, true, false, false);
        emit EngagementRegistrySet(address(engagementRootRegistry), address(newRegistry));
        gate.executeEngagementRegistry();

        assertEq(address(gate.engagementRootRegistry()), address(newRegistry));
        assertEq(gate.pendingEngagementRegistry(), address(0));
        assertEq(gate.pendingEngagementRegistryExecuteTime(), 0);
    }

    /// @notice Post-genesis: revert when unauthorized
    function test_EngagementRegistry_RevertWhen_Unauthorized() public {
        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        gate.proposeEngagementRegistry(address(engagementRootRegistry));
    }

    /// @notice Post-genesis: revert when timelock not expired
    function test_EngagementRegistry_RevertWhen_TimelockNotExpired() public {
        EngagementRootRegistry newRegistry = new EngagementRootRegistry(governance);

        vm.prank(governance);
        gate.proposeEngagementRegistry(address(newRegistry));

        vm.expectRevert(DistrictGate.EngagementRegistryTimelockNotExpired.selector);
        gate.executeEngagementRegistry();
    }

    /// @notice Post-genesis: revert execute when nothing proposed
    function test_EngagementRegistry_RevertWhen_NotProposed() public {
        vm.expectRevert(DistrictGate.EngagementRegistryNotProposed.selector);
        gate.executeEngagementRegistry();
    }

    /// @notice Post-genesis: revert when already pending
    function test_EngagementRegistry_RevertWhen_AlreadyPending() public {
        EngagementRootRegistry reg1 = new EngagementRootRegistry(governance);
        EngagementRootRegistry reg2 = new EngagementRootRegistry(governance);

        vm.prank(governance);
        gate.proposeEngagementRegistry(address(reg1));

        vm.prank(governance);
        vm.expectRevert(DistrictGate.OperationAlreadyPending.selector);
        gate.proposeEngagementRegistry(address(reg2));
    }

    // ============================================================================
    // 3. ROOT VALIDATION TESTS
    // ============================================================================

    /// @notice Revert when engagement registry is not configured
    function test_VerifyThreeTreeProof_RevertWhen_EngagementRegistryNotConfigured() public {
        // Deploy a fresh gate without engagement registry
        DistrictGate freshGate = new DistrictGate(
            address(verifierRegistry),
            address(districtRegistry),
            address(nullifierRegistry),
            governance
        );

        vm.startPrank(governance);
        freshGate.setTwoTreeRegistriesGenesis(address(userRootRegistry), address(cellMapRegistry));
        freshGate.registerActionDomainGenesis(ACTION_DOMAIN_1);
        freshGate.sealGenesis();
        vm.stopPrank();

        // Authorize fresh gate
        vm.prank(governance);
        nullifierRegistry.proposeCallerAuthorization(address(freshGate));
        vm.warp(block.timestamp + 7 days);
        nullifierRegistry.executeCallerAuthorization(address(freshGate));

        bytes memory proof = hex"deadbeef";
        uint256[31] memory publicInputs = _buildThreeTreePublicInputs(
            USER_ROOT_1, CELL_MAP_ROOT_1, NULLIFIER_1, ACTION_DOMAIN_1,
            AUTHORITY_LEVEL, ENGAGEMENT_ROOT_1, 2
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateThreeTreeSignatureForGate(
            freshGate, proof, publicInputs, VERIFIER_DEPTH
        );

        vm.expectRevert(DistrictGate.InvalidEngagementRoot.selector);
        freshGate.verifyThreeTreeProof(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);
    }

    /// @notice Revert when user root is invalid
    function test_VerifyThreeTreeProof_RevertWhen_InvalidUserRoot() public {
        bytes memory proof = hex"deadbeef";
        uint256[31] memory publicInputs = _buildThreeTreePublicInputs(
            USER_ROOT_INVALID, CELL_MAP_ROOT_1, NULLIFIER_1, ACTION_DOMAIN_1,
            AUTHORITY_LEVEL, ENGAGEMENT_ROOT_1, 2
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateThreeTreeSignature(
            proof, publicInputs, VERIFIER_DEPTH
        );

        vm.expectRevert(DistrictGate.InvalidUserRoot.selector);
        gate.verifyThreeTreeProof(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);
    }

    /// @notice Revert when cell map root is invalid
    function test_VerifyThreeTreeProof_RevertWhen_InvalidCellMapRoot() public {
        bytes memory proof = hex"deadbeef";
        uint256[31] memory publicInputs = _buildThreeTreePublicInputs(
            USER_ROOT_1, CELL_MAP_ROOT_INVALID, NULLIFIER_1, ACTION_DOMAIN_1,
            AUTHORITY_LEVEL, ENGAGEMENT_ROOT_1, 2
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateThreeTreeSignature(
            proof, publicInputs, VERIFIER_DEPTH
        );

        vm.expectRevert(DistrictGate.InvalidCellMapRoot.selector);
        gate.verifyThreeTreeProof(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);
    }

    /// @notice Revert when engagement root is not registered
    function test_VerifyThreeTreeProof_RevertWhen_InvalidEngagementRoot() public {
        bytes memory proof = hex"deadbeef";
        uint256[31] memory publicInputs = _buildThreeTreePublicInputs(
            USER_ROOT_1, CELL_MAP_ROOT_1, NULLIFIER_1, ACTION_DOMAIN_1,
            AUTHORITY_LEVEL, ENGAGEMENT_ROOT_INVALID, 2
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateThreeTreeSignature(
            proof, publicInputs, VERIFIER_DEPTH
        );

        vm.expectRevert(DistrictGate.InvalidEngagementRoot.selector);
        gate.verifyThreeTreeProof(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);
    }

    // ============================================================================
    // 4. ENGAGEMENT TIER VALIDATION
    // ============================================================================

    /// @notice Revert when engagement tier is 5 (out of range)
    function test_VerifyThreeTreeProof_RevertWhen_EngagementTier5() public {
        bytes memory proof = hex"deadbeef";
        uint256[31] memory publicInputs = _buildThreeTreePublicInputs(
            USER_ROOT_1, CELL_MAP_ROOT_1, NULLIFIER_1, ACTION_DOMAIN_1,
            AUTHORITY_LEVEL, ENGAGEMENT_ROOT_1, 5
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateThreeTreeSignature(
            proof, publicInputs, VERIFIER_DEPTH
        );

        vm.expectRevert(DistrictGate.InvalidEngagementTier.selector);
        gate.verifyThreeTreeProof(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);
    }

    /// @notice Revert when engagement tier is 255 (max uint8)
    function test_VerifyThreeTreeProof_RevertWhen_EngagementTier255() public {
        bytes memory proof = hex"deadbeef";
        uint256[31] memory publicInputs = _buildThreeTreePublicInputs(
            USER_ROOT_1, CELL_MAP_ROOT_1, NULLIFIER_1, ACTION_DOMAIN_1,
            AUTHORITY_LEVEL, ENGAGEMENT_ROOT_1, 255
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateThreeTreeSignature(
            proof, publicInputs, VERIFIER_DEPTH
        );

        vm.expectRevert(DistrictGate.InvalidEngagementTier.selector);
        gate.verifyThreeTreeProof(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);
    }

    /// @notice All valid tiers (0-4) succeed
    function test_VerifyThreeTreeProof_AllValidTiers() public {
        for (uint256 tier = 0; tier <= 4; tier++) {
            bytes memory proof = hex"deadbeef";
            bytes32 nullifier = bytes32(uint256(0x1000 + tier));
            uint256[31] memory publicInputs = _buildThreeTreePublicInputs(
                USER_ROOT_1, CELL_MAP_ROOT_1, nullifier, ACTION_DOMAIN_1,
                AUTHORITY_LEVEL, ENGAGEMENT_ROOT_1, tier
            );

            (address signer, bytes memory signature, uint256 deadline) = _generateThreeTreeSignature(
                proof, publicInputs, VERIFIER_DEPTH
            );

            gate.verifyThreeTreeProof(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);
            assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, nullifier));

            // Advance time past rate limit
            vm.warp(block.timestamp + 61 seconds);
        }
    }

    // ============================================================================
    // 5. COUNTRY CROSS-CHECK
    // ============================================================================

    /// @notice Revert when user root and cell map root have different countries
    function test_VerifyThreeTreeProof_RevertWhen_CountryMismatch() public {
        // Register a Canadian cell map root
        bytes32 cellMapRootCanada = bytes32(uint256(0xBBBBCADA));
        vm.prank(governance);
        cellMapRegistry.registerCellMapRoot(cellMapRootCanada, CAN, 20);

        bytes memory proof = hex"deadbeef";
        uint256[31] memory publicInputs = _buildThreeTreePublicInputs(
            USER_ROOT_1, cellMapRootCanada, NULLIFIER_1, ACTION_DOMAIN_1,
            AUTHORITY_LEVEL, ENGAGEMENT_ROOT_1, 2
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateThreeTreeSignature(
            proof, publicInputs, VERIFIER_DEPTH
        );

        vm.expectRevert(DistrictGate.CountryMismatch.selector);
        gate.verifyThreeTreeProof(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);
    }

    // ============================================================================
    // 6. DEPTH MISMATCH
    // ============================================================================

    /// @notice Revert when verifierDepth does not match user root depth
    function test_VerifyThreeTreeProof_RevertWhen_DepthMismatch() public {
        // Register depth-22 roots
        bytes32 userRootD22 = bytes32(uint256(0xAAAAD22D22));
        bytes32 cellMapRootD22 = bytes32(uint256(0xBBBBD22D22));

        vm.startPrank(governance);
        userRootRegistry.registerUserRoot(userRootD22, USA, 22);
        cellMapRegistry.registerCellMapRoot(cellMapRootD22, USA, 22);
        vm.stopPrank();

        bytes memory proof = hex"deadbeef";
        uint256[31] memory publicInputs = _buildThreeTreePublicInputs(
            userRootD22, cellMapRootD22, NULLIFIER_1, ACTION_DOMAIN_1,
            AUTHORITY_LEVEL, ENGAGEMENT_ROOT_1, 2
        );

        // Sign with wrong depth (20 instead of 22)
        (address signer, bytes memory signature, uint256 deadline) = _generateThreeTreeSignature(
            proof, publicInputs, 20
        );

        vm.expectRevert(DistrictGate.DepthMismatch.selector);
        gate.verifyThreeTreeProof(signer, proof, publicInputs, 20, deadline, signature);
    }

    /// @notice Revert when engagement root depth does not match user root depth
    function test_VerifyThreeTreeProof_RevertWhen_EngagementDepthMismatch() public {
        // Register an engagement root at depth 22 (user root is depth 20)
        bytes32 engagementRootD22 = bytes32(uint256(0xCCCCD22D22));
        vm.prank(governance);
        engagementRootRegistry.registerEngagementRoot(engagementRootD22, 22);

        bytes memory proof = hex"deadbeef";
        uint256[31] memory publicInputs = _buildThreeTreePublicInputs(
            USER_ROOT_1, CELL_MAP_ROOT_1, NULLIFIER_1, ACTION_DOMAIN_1,
            AUTHORITY_LEVEL, engagementRootD22, 2
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateThreeTreeSignature(
            proof, publicInputs, VERIFIER_DEPTH
        );

        vm.expectRevert(DistrictGate.DepthMismatch.selector);
        gate.verifyThreeTreeProof(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);
    }

    // ============================================================================
    // 7. ACTION DOMAIN WHITELIST
    // ============================================================================

    /// @notice Revert when action domain is not whitelisted
    function test_VerifyThreeTreeProof_RevertWhen_ActionDomainNotWhitelisted() public {
        bytes memory proof = hex"deadbeef";
        uint256[31] memory publicInputs = _buildThreeTreePublicInputs(
            USER_ROOT_1, CELL_MAP_ROOT_1, NULLIFIER_1, ACTION_DOMAIN_NOT_WHITELISTED,
            AUTHORITY_LEVEL, ENGAGEMENT_ROOT_1, 2
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateThreeTreeSignature(
            proof, publicInputs, VERIFIER_DEPTH
        );

        vm.expectRevert(DistrictGate.ActionDomainNotAllowed.selector);
        gate.verifyThreeTreeProof(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);
    }

    // ============================================================================
    // 8. AUTHORITY LEVEL
    // ============================================================================

    /// @notice Revert when authority level is 0 (out of range)
    function test_VerifyThreeTreeProof_RevertWhen_AuthorityLevel0() public {
        bytes memory proof = hex"deadbeef";
        uint256[31] memory publicInputs = _buildThreeTreePublicInputs(
            USER_ROOT_1, CELL_MAP_ROOT_1, NULLIFIER_1, ACTION_DOMAIN_1,
            bytes32(uint256(0)), // authority = 0
            ENGAGEMENT_ROOT_1, 2
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateThreeTreeSignature(
            proof, publicInputs, VERIFIER_DEPTH
        );

        vm.expectRevert("Authority level out of range");
        gate.verifyThreeTreeProof(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);
    }

    /// @notice Revert when authority level is 6 (out of range)
    function test_VerifyThreeTreeProof_RevertWhen_AuthorityLevel6() public {
        bytes memory proof = hex"deadbeef";
        uint256[31] memory publicInputs = _buildThreeTreePublicInputs(
            USER_ROOT_1, CELL_MAP_ROOT_1, NULLIFIER_1, ACTION_DOMAIN_1,
            bytes32(uint256(6)), // authority = 6
            ENGAGEMENT_ROOT_1, 2
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateThreeTreeSignature(
            proof, publicInputs, VERIFIER_DEPTH
        );

        vm.expectRevert("Authority level out of range");
        gate.verifyThreeTreeProof(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);
    }

    // ============================================================================
    // 9. VERIFIER ROUTING
    // ============================================================================

    /// @notice Revert when three-tree verifier not registered for depth
    function test_VerifyThreeTreeProof_RevertWhen_ThreeTreeVerifierNotFound() public {
        // Register depth-22 roots but no three-tree verifier at depth 22
        bytes32 userRootD22 = bytes32(uint256(0xAAAA22FF));
        bytes32 cellMapRootD22 = bytes32(uint256(0xBBBB22FF));
        bytes32 engagementRootD22 = bytes32(uint256(0xCCCC22FF));

        vm.startPrank(governance);
        userRootRegistry.registerUserRoot(userRootD22, USA, 22);
        cellMapRegistry.registerCellMapRoot(cellMapRootD22, USA, 22);
        engagementRootRegistry.registerEngagementRoot(engagementRootD22, 22);
        vm.stopPrank();

        bytes memory proof = hex"deadbeef";
        uint256[31] memory publicInputs = _buildThreeTreePublicInputs(
            userRootD22, cellMapRootD22, NULLIFIER_1, ACTION_DOMAIN_1,
            AUTHORITY_LEVEL, engagementRootD22, 2
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateThreeTreeSignature(
            proof, publicInputs, 22
        );

        vm.expectRevert(DistrictGate.ThreeTreeVerifierNotFound.selector);
        gate.verifyThreeTreeProof(signer, proof, publicInputs, 22, deadline, signature);
    }

    /// @notice Revert when verifier returns false
    function test_VerifyThreeTreeProof_RevertWhen_VerificationFails() public {
        // Deploy new registry with failing three-tree verifier
        VerifierRegistry newVerifierRegistry = new VerifierRegistry(governance);
        vm.startPrank(governance);
        newVerifierRegistry.registerVerifier(VERIFIER_DEPTH, address(twoTreePassingVerifier));
        newVerifierRegistry.registerThreeTreeVerifier(VERIFIER_DEPTH, address(failingVerifier));
        newVerifierRegistry.sealGenesis();
        vm.stopPrank();

        // Deploy new gate with failing verifier
        DistrictGate newGate = new DistrictGate(
            address(newVerifierRegistry),
            address(districtRegistry),
            address(nullifierRegistry),
            governance
        );

        // Configure
        vm.prank(governance);
        nullifierRegistry.proposeCallerAuthorization(address(newGate));
        uint256 t1 = block.timestamp + 7 days;
        vm.warp(t1);
        nullifierRegistry.executeCallerAuthorization(address(newGate));

        vm.startPrank(governance);
        newGate.setTwoTreeRegistriesGenesis(address(userRootRegistry), address(cellMapRegistry));
        newGate.setEngagementRegistryGenesis(address(engagementRootRegistry));
        newGate.registerActionDomainGenesis(ACTION_DOMAIN_1);
        newGate.sealGenesis();
        vm.stopPrank();

        bytes memory proof = hex"deadbeef";
        uint256[31] memory publicInputs = _buildThreeTreePublicInputs(
            USER_ROOT_1, CELL_MAP_ROOT_1, NULLIFIER_1, ACTION_DOMAIN_1,
            AUTHORITY_LEVEL, ENGAGEMENT_ROOT_1, 2
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateThreeTreeSignatureForGate(
            newGate, proof, publicInputs, VERIFIER_DEPTH
        );

        vm.expectRevert(DistrictGate.ThreeTreeVerificationFailed.selector);
        newGate.verifyThreeTreeProof(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);
    }

    // ============================================================================
    // 10. NULLIFIER MANAGEMENT
    // ============================================================================

    /// @notice Nullifier is recorded after successful three-tree verification
    function test_VerifyThreeTreeProof_NullifierRecorded() public {
        assertFalse(gate.isNullifierUsed(ACTION_DOMAIN_1, NULLIFIER_1));
        assertEq(gate.getParticipantCount(ACTION_DOMAIN_1), 0);

        bytes memory proof = hex"deadbeef";
        uint256[31] memory publicInputs = _buildThreeTreePublicInputs(
            USER_ROOT_1, CELL_MAP_ROOT_1, NULLIFIER_1, ACTION_DOMAIN_1,
            AUTHORITY_LEVEL, ENGAGEMENT_ROOT_1, 2
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateThreeTreeSignature(
            proof, publicInputs, VERIFIER_DEPTH
        );

        gate.verifyThreeTreeProof(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);

        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, NULLIFIER_1));
        assertEq(gate.getParticipantCount(ACTION_DOMAIN_1), 1);
    }

    /// @notice Revert when same nullifier+actionDomain is reused
    function test_VerifyThreeTreeProof_RevertWhen_NullifierReused() public {
        bytes memory proof = hex"deadbeef";
        uint256[31] memory publicInputs = _buildThreeTreePublicInputs(
            USER_ROOT_1, CELL_MAP_ROOT_1, NULLIFIER_1, ACTION_DOMAIN_1,
            AUTHORITY_LEVEL, ENGAGEMENT_ROOT_1, 2
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateThreeTreeSignature(
            proof, publicInputs, VERIFIER_DEPTH
        );

        gate.verifyThreeTreeProof(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);

        vm.warp(block.timestamp + 61 seconds);

        (address signer2, bytes memory signature2, uint256 deadline2) = _generateThreeTreeSignature(
            proof, publicInputs, VERIFIER_DEPTH
        );

        vm.expectRevert(NullifierRegistry.NullifierAlreadyUsed.selector);
        gate.verifyThreeTreeProof(signer2, proof, publicInputs, VERIFIER_DEPTH, deadline2, signature2);
    }

    // ============================================================================
    // 11. PAUSE CONTROLS
    // ============================================================================

    /// @notice Revert when contract is paused
    function test_VerifyThreeTreeProof_Paused() public {
        vm.prank(governance);
        gate.pause();

        bytes memory proof = hex"deadbeef";
        uint256[31] memory publicInputs = _buildThreeTreePublicInputs(
            USER_ROOT_1, CELL_MAP_ROOT_1, NULLIFIER_1, ACTION_DOMAIN_1,
            AUTHORITY_LEVEL, ENGAGEMENT_ROOT_1, 2
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateThreeTreeSignature(
            proof, publicInputs, VERIFIER_DEPTH
        );

        vm.expectRevert("Pausable: paused");
        gate.verifyThreeTreeProof(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);
    }

    // ============================================================================
    // 12. BACKWARDS COMPATIBILITY
    // ============================================================================

    /// @notice Two-tree verifyTwoTreeProof still works after three-tree setup
    function test_TwoTreeProof_StillWorks() public {
        bytes memory proof = hex"deadbeef";
        uint256[29] memory publicInputs;
        publicInputs[0] = uint256(USER_ROOT_1);
        publicInputs[1] = uint256(CELL_MAP_ROOT_1);
        publicInputs[26] = uint256(NULLIFIER_2);
        publicInputs[27] = uint256(ACTION_DOMAIN_1);
        publicInputs[28] = uint256(AUTHORITY_LEVEL);

        (address signer, bytes memory signature, uint256 deadline) = _generateTwoTreeSignature(
            proof, publicInputs, VERIFIER_DEPTH
        );

        vm.expectEmit(true, true, true, true);
        emit TwoTreeProofVerified(
            signer,
            address(this),
            USER_ROOT_1,
            CELL_MAP_ROOT_1,
            NULLIFIER_2,
            ACTION_DOMAIN_1,
            AUTHORITY_LEVEL,
            VERIFIER_DEPTH
        );

        gate.verifyTwoTreeProof(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);
        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, NULLIFIER_2));
    }

    // ============================================================================
    // 13. EIP-712 SIGNATURE
    // ============================================================================

    /// @notice Revert when signature is expired
    function test_VerifyThreeTreeProof_RevertWhen_SignatureExpired() public {
        bytes memory proof = hex"deadbeef";
        uint256[31] memory publicInputs = _buildThreeTreePublicInputs(
            USER_ROOT_1, CELL_MAP_ROOT_1, NULLIFIER_1, ACTION_DOMAIN_1,
            AUTHORITY_LEVEL, ENGAGEMENT_ROOT_1, 2
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateThreeTreeSignature(
            proof, publicInputs, VERIFIER_DEPTH
        );

        // Advance past deadline
        vm.warp(deadline + 1);

        vm.expectRevert(DistrictGate.SignatureExpired.selector);
        gate.verifyThreeTreeProof(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);
    }

    /// @notice Revert when signer is zero address
    function test_VerifyThreeTreeProof_RevertWhen_ZeroSigner() public {
        bytes memory proof = hex"deadbeef";
        uint256[31] memory publicInputs = _buildThreeTreePublicInputs(
            USER_ROOT_1, CELL_MAP_ROOT_1, NULLIFIER_1, ACTION_DOMAIN_1,
            AUTHORITY_LEVEL, ENGAGEMENT_ROOT_1, 2
        );

        vm.expectRevert(TimelockGovernance.ZeroAddress.selector);
        gate.verifyThreeTreeProof(
            address(0), proof, publicInputs, VERIFIER_DEPTH,
            block.timestamp + 1 hours, hex"00"
        );
    }

    // ============================================================================
    // 14. CONSTANTS
    // ============================================================================

    /// @notice Three-tree public input count is 31
    function test_ThreeTreePublicInputCount() public view {
        assertEq(gate.THREE_TREE_PUBLIC_INPUT_COUNT(), 31);
    }

    /// @notice Two-tree and three-tree typehashes are different
    function test_TypehashesAreDifferent() public view {
        assertTrue(gate.SUBMIT_TWO_TREE_PROOF_TYPEHASH() != gate.SUBMIT_THREE_TREE_PROOF_TYPEHASH());
    }

    // ============================================================================
    // HELPER FUNCTIONS
    // ============================================================================

    /// @notice Build a 31-element public inputs array for three-tree proofs
    function _buildThreeTreePublicInputs(
        bytes32 userRoot,
        bytes32 cellMapRoot,
        bytes32 nullifier,
        bytes32 actionDomain,
        bytes32 authorityLevel,
        bytes32 engagementRoot,
        uint256 engagementTier
    ) internal pure returns (uint256[31] memory inputs) {
        inputs[0] = uint256(userRoot);
        inputs[1] = uint256(cellMapRoot);
        // inputs[2-25] default to 0 (empty district slots)
        inputs[26] = uint256(nullifier);
        inputs[27] = uint256(actionDomain);
        inputs[28] = uint256(authorityLevel);
        inputs[29] = uint256(engagementRoot);
        inputs[30] = engagementTier;
    }

    /// @notice Helper to generate EIP-712 signature for three-tree proof submission
    function _generateThreeTreeSignature(
        bytes memory proof,
        uint256[31] memory publicInputs,
        uint8 verifierDepth
    ) internal view returns (address signer, bytes memory signature, uint256 deadline) {
        return _generateThreeTreeSignatureForGate(gate, proof, publicInputs, verifierDepth);
    }

    /// @notice Helper to generate EIP-712 signature for a specific gate
    function _generateThreeTreeSignatureForGate(
        DistrictGate _gate,
        bytes memory proof,
        uint256[31] memory publicInputs,
        uint8 verifierDepth
    ) internal view returns (address signer, bytes memory signature, uint256 deadline) {
        uint256 privateKey = 0xB0B;
        signer = vm.addr(privateKey);
        deadline = block.timestamp + 1 hours;
        uint256 nonce = _gate.nonces(signer);

        bytes32 proofHash = keccak256(proof);
        bytes32 publicInputsHash = keccak256(abi.encodePacked(publicInputs));

        bytes32 structHash = keccak256(
            abi.encode(
                _gate.SUBMIT_THREE_TREE_PROOF_TYPEHASH(),
                proofHash,
                publicInputsHash,
                verifierDepth,
                nonce,
                deadline
            )
        );

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", _gate.DOMAIN_SEPARATOR(), structHash)
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        signature = abi.encodePacked(r, s, v);
    }

    /// @notice Helper to generate EIP-712 signature for two-tree proof submission
    function _generateTwoTreeSignature(
        bytes memory proof,
        uint256[29] memory publicInputs,
        uint8 verifierDepth
    ) internal view returns (address signer, bytes memory signature, uint256 deadline) {
        uint256 privateKey = 0xA11CE;
        signer = vm.addr(privateKey);
        deadline = block.timestamp + 1 hours;
        uint256 nonce = gate.nonces(signer);

        bytes32 proofHash = keccak256(proof);
        bytes32 publicInputsHash = keccak256(abi.encodePacked(publicInputs));

        bytes32 structHash = keccak256(
            abi.encode(
                gate.SUBMIT_TWO_TREE_PROOF_TYPEHASH(),
                proofHash,
                publicInputsHash,
                verifierDepth,
                nonce,
                deadline
            )
        );

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", gate.DOMAIN_SEPARATOR(), structHash)
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        signature = abi.encodePacked(r, s, v);
    }
}

// ============================================================================
// MOCK CONTRACTS
// ============================================================================

/// @notice Mock three-tree verifier with configurable pass/fail
contract MockThreeTreeVerifier {
    bool public shouldPass;

    constructor(bool _shouldPass) {
        shouldPass = _shouldPass;
    }

    function verify(bytes calldata, bytes32[] calldata) external view returns (bool) {
        return shouldPass;
    }
}
