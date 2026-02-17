// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "forge-std/Test.sol";
import "../src/DistrictGate.sol";
import "../src/DistrictRegistry.sol";
import "../src/NullifierRegistry.sol";
import "../src/VerifierRegistry.sol";
import "../src/UserRootRegistry.sol";
import "../src/CellMapRegistry.sol";

/// @title DistrictGate Two-Tree Proof Integration Tests
/// @notice Tests for verifyTwoTreeProof flow: user identity tree + cell-district mapping tree
/// @dev Tests cover:
///      1. Happy path - full two-tree proof verification
///      2. Registry configuration - propose/execute/cancel timelock flow
///      3. Root validation - user root and cell map root checks
///      4. Action domain whitelist - SA-001 enforcement
///      5. Verifier routing - depth lookup and verification
///      6. Nullifier management - recording and replay protection
///      7. Pause controls - whenNotPaused modifier
///      8. Backwards compatibility - single-tree flow still works
contract DistrictGateTwoTreeTest is Test {
    DistrictGate public gate;
    DistrictRegistry public districtRegistry;
    NullifierRegistry public nullifierRegistry;
    VerifierRegistry public verifierRegistry;
    UserRootRegistry public userRootRegistry;
    CellMapRegistry public cellMapRegistry;

    // Mock verifiers
    MockTwoTreeVerifier public passingVerifier;
    MockTwoTreeVerifier public failingVerifier;
    MockVerifierSingleTree public singleTreeVerifier;

    address public governance = address(0x1);
    address public attacker = address(0x3);

    // Test constants: Tree 1 (user identity) roots
    bytes32 public constant USER_ROOT_1 = bytes32(uint256(0xAAAA1111));
    bytes32 public constant USER_ROOT_2 = bytes32(uint256(0xAAAA2222));
    bytes32 public constant USER_ROOT_INVALID = bytes32(uint256(0xAAAADEAD));

    // Test constants: Tree 2 (cell-district mapping) roots
    bytes32 public constant CELL_MAP_ROOT_1 = bytes32(uint256(0xBBBB1111));
    bytes32 public constant CELL_MAP_ROOT_2 = bytes32(uint256(0xBBBB2222));
    bytes32 public constant CELL_MAP_ROOT_INVALID = bytes32(uint256(0xBBBBDEAD));

    // Test constants: single-tree district root (for backwards compatibility)
    bytes32 public constant DISTRICT_ROOT_18 = bytes32(uint256(0x1818));

    // Test constants: nullifiers and action domains
    bytes32 public constant NULLIFIER_1 = bytes32(uint256(0x456));
    bytes32 public constant NULLIFIER_2 = bytes32(uint256(0x789));
    bytes32 public constant ACTION_DOMAIN_1 = keccak256("election-2024");
    bytes32 public constant ACTION_DOMAIN_2 = keccak256("petition-123");
    bytes32 public constant ACTION_DOMAIN_NOT_WHITELISTED = keccak256("not-whitelisted");
    bytes32 public constant AUTHORITY_LEVEL = bytes32(uint256(3));
    bytes32 public constant DISTRICT_ID = keccak256("CA-SD-01");

    bytes3 public constant USA = "USA";
    bytes3 public constant CAN = "CAN"; // Canada for country mismatch tests

    uint8 public constant VERIFIER_DEPTH = 20;

    // Events from DistrictGate
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

    event TwoTreeRegistriesProposed(address userRootRegistry, address cellMapRegistry, uint256 executeTime);
    event TwoTreeRegistriesSet(address userRootRegistry, address cellMapRegistry);
    event TwoTreeRegistriesCancelled();

    event ActionVerified(
        address indexed user,
        address indexed submitter,
        bytes32 indexed districtRoot,
        bytes3 country,
        uint8 depth,
        bytes32 nullifier,
        bytes32 authorityLevel,
        bytes32 actionDomain,
        bytes32 districtId
    );

    function setUp() public {
        // Deploy mock verifiers
        passingVerifier = new MockTwoTreeVerifier(true);
        failingVerifier = new MockTwoTreeVerifier(false);
        singleTreeVerifier = new MockVerifierSingleTree();

        // Deploy registries
        districtRegistry = new DistrictRegistry(governance);
        nullifierRegistry = new NullifierRegistry(governance);
        verifierRegistry = new VerifierRegistry(governance);
        userRootRegistry = new UserRootRegistry(governance);
        cellMapRegistry = new CellMapRegistry(governance);

        // Deploy DistrictGate
        gate = new DistrictGate(
            address(verifierRegistry),
            address(districtRegistry),
            address(nullifierRegistry),
            governance
        );

        // Register verifiers (genesis registration)
        vm.startPrank(governance);
        verifierRegistry.registerVerifier(VERIFIER_DEPTH, address(passingVerifier));
        verifierRegistry.registerVerifier(18, address(singleTreeVerifier));
        verifierRegistry.sealGenesis();
        vm.stopPrank();

        // Register a district for single-tree backwards compatibility test
        vm.prank(governance);
        districtRegistry.registerDistrict(DISTRICT_ROOT_18, USA, 18);

        // Authorize gate as caller on NullifierRegistry (7-day timelock)
        vm.prank(governance);
        nullifierRegistry.proposeCallerAuthorization(address(gate));
        vm.warp(block.timestamp + 7 days);
        nullifierRegistry.executeCallerAuthorization(address(gate));

        // Register user roots in UserRootRegistry
        vm.startPrank(governance);
        userRootRegistry.registerUserRoot(USER_ROOT_1, USA, 20);
        userRootRegistry.registerUserRoot(USER_ROOT_2, USA, 20);

        // Register cell map roots in CellMapRegistry
        cellMapRegistry.registerCellMapRoot(CELL_MAP_ROOT_1, USA, 20);
        cellMapRegistry.registerCellMapRoot(CELL_MAP_ROOT_2, USA, 20);
        vm.stopPrank();

        // Configure two-tree registries on DistrictGate via timelock
        vm.prank(governance);
        gate.proposeTwoTreeRegistries(address(userRootRegistry), address(cellMapRegistry));

        // Batch all remaining proposals before warping
        vm.startPrank(governance);
        gate.proposeActionDomain(ACTION_DOMAIN_1);
        gate.proposeActionDomain(ACTION_DOMAIN_2);
        vm.stopPrank();

        // Single warp to cover both 7-day timelocks (registries + action domains)
        vm.warp(block.timestamp + 14 days + 1);
        gate.executeTwoTreeRegistries();
        gate.executeActionDomain(ACTION_DOMAIN_1);
        gate.executeActionDomain(ACTION_DOMAIN_2);
    }

    // ============================================================================
    // 1. HAPPY PATH
    // ============================================================================

    /// @notice Full two-tree proof verification succeeds with valid inputs
    function test_VerifyTwoTreeProof_HappyPath() public {
        bytes memory proof = hex"deadbeef";
        uint256[29] memory publicInputs = _buildPublicInputs(
            USER_ROOT_1,
            CELL_MAP_ROOT_1,
            NULLIFIER_1,
            ACTION_DOMAIN_1,
            AUTHORITY_LEVEL
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateTwoTreeSignature(
            proof,
            publicInputs,
            VERIFIER_DEPTH
        );

        // Expect TwoTreeProofVerified event
        vm.expectEmit(true, true, true, true);
        emit TwoTreeProofVerified(
            signer,
            address(this),
            USER_ROOT_1,
            CELL_MAP_ROOT_1,
            NULLIFIER_1,
            ACTION_DOMAIN_1,
            AUTHORITY_LEVEL,
            VERIFIER_DEPTH
        );

        gate.verifyTwoTreeProof(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);

        // Verify nullifier was recorded
        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, NULLIFIER_1));
        assertEq(gate.getParticipantCount(ACTION_DOMAIN_1), 1);
    }

    // ============================================================================
    // 2. REGISTRY CONFIGURATION TESTS
    // ============================================================================

    /// @notice Revert when two-tree registries are not configured (call before proposal)
    function test_VerifyTwoTreeProof_RevertWhen_RegistriesNotConfigured() public {
        // Deploy a fresh gate without two-tree registries configured
        DistrictGate freshGate = new DistrictGate(
            address(verifierRegistry),
            address(districtRegistry),
            address(nullifierRegistry),
            governance
        );

        // Whitelist action domain on fresh gate
        vm.prank(governance);
        freshGate.proposeActionDomain(ACTION_DOMAIN_1);
        vm.warp(block.timestamp + 7 days + 1);
        freshGate.executeActionDomain(ACTION_DOMAIN_1);

        bytes memory proof = hex"deadbeef";
        uint256[29] memory publicInputs = _buildPublicInputs(
            USER_ROOT_1,
            CELL_MAP_ROOT_1,
            NULLIFIER_1,
            ACTION_DOMAIN_1,
            AUTHORITY_LEVEL
        );

        // Generate signature for freshGate (has different nonce state)
        uint256 privateKey = 0xA11CE;
        address signer = vm.addr(privateKey);
        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = freshGate.nonces(signer);

        bytes32 proofHash = keccak256(proof);
        bytes32 publicInputsHash = keccak256(abi.encodePacked(publicInputs));

        bytes32 structHash = keccak256(
            abi.encode(
                freshGate.SUBMIT_TWO_TREE_PROOF_TYPEHASH(),
                proofHash,
                publicInputsHash,
                VERIFIER_DEPTH,
                nonce,
                deadline
            )
        );

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", freshGate.DOMAIN_SEPARATOR(), structHash)
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Should revert because userRootRegistry is address(0)
        vm.expectRevert(DistrictGate.InvalidUserRoot.selector);
        freshGate.verifyTwoTreeProof(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);
    }

    /// @notice Propose, execute, and cancel two-tree registry configuration
    function test_TwoTreeRegistries_ProposeExecuteCancel() public {
        // Deploy new registries for this test
        UserRootRegistry newUserRootRegistry = new UserRootRegistry(governance);
        CellMapRegistry newCellMapRegistry = new CellMapRegistry(governance);

        // Test propose
        uint256 expectedExecuteTime = block.timestamp + 7 days;
        vm.prank(governance);
        vm.expectEmit(false, false, false, true);
        emit TwoTreeRegistriesProposed(address(newUserRootRegistry), address(newCellMapRegistry), expectedExecuteTime);
        gate.proposeTwoTreeRegistries(address(newUserRootRegistry), address(newCellMapRegistry));

        // Verify pending state
        assertEq(gate.pendingUserRootRegistry(), address(newUserRootRegistry));
        assertEq(gate.pendingCellMapRegistry(), address(newCellMapRegistry));
        assertEq(gate.pendingTwoTreeRegistriesExecuteTime(), expectedExecuteTime);

        // Test cancel
        vm.prank(governance);
        vm.expectEmit(false, false, false, false);
        emit TwoTreeRegistriesCancelled();
        gate.cancelTwoTreeRegistries();

        // Verify cleared state
        assertEq(gate.pendingUserRootRegistry(), address(0));
        assertEq(gate.pendingCellMapRegistry(), address(0));
        assertEq(gate.pendingTwoTreeRegistriesExecuteTime(), 0);

        // Test propose again and execute
        vm.prank(governance);
        gate.proposeTwoTreeRegistries(address(newUserRootRegistry), address(newCellMapRegistry));

        vm.warp(block.timestamp + 7 days);

        vm.expectEmit(false, false, false, true);
        emit TwoTreeRegistriesSet(address(newUserRootRegistry), address(newCellMapRegistry));
        gate.executeTwoTreeRegistries();

        // Verify execution
        assertEq(address(gate.userRootRegistry()), address(newUserRootRegistry));
        assertEq(address(gate.cellMapRegistry()), address(newCellMapRegistry));

        // Verify pending cleared
        assertEq(gate.pendingUserRootRegistry(), address(0));
        assertEq(gate.pendingCellMapRegistry(), address(0));
        assertEq(gate.pendingTwoTreeRegistriesExecuteTime(), 0);
    }

    /// @notice Non-governance cannot propose two-tree registries
    function test_TwoTreeRegistries_RevertWhen_Unauthorized() public {
        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        gate.proposeTwoTreeRegistries(address(userRootRegistry), address(cellMapRegistry));
    }

    /// @notice Revert when proposing zero addresses for two-tree registries
    function test_TwoTreeRegistries_RevertWhen_ZeroAddress() public {
        // Zero address for UserRootRegistry
        vm.prank(governance);
        vm.expectRevert(TimelockGovernance.ZeroAddress.selector);
        gate.proposeTwoTreeRegistries(address(0), address(cellMapRegistry));

        // Zero address for CellMapRegistry
        vm.prank(governance);
        vm.expectRevert(TimelockGovernance.ZeroAddress.selector);
        gate.proposeTwoTreeRegistries(address(userRootRegistry), address(0));

        // Both zero
        vm.prank(governance);
        vm.expectRevert(TimelockGovernance.ZeroAddress.selector);
        gate.proposeTwoTreeRegistries(address(0), address(0));
    }

    /// @notice Revert execute before timelock expires
    function test_TwoTreeRegistries_RevertWhen_TimelockNotExpired() public {
        UserRootRegistry newURR = new UserRootRegistry(governance);
        CellMapRegistry newCMR = new CellMapRegistry(governance);

        vm.prank(governance);
        gate.proposeTwoTreeRegistries(address(newURR), address(newCMR));

        // Try to execute immediately
        vm.expectRevert(DistrictGate.TwoTreeRegistriesTimelockNotExpired.selector);
        gate.executeTwoTreeRegistries();

        // Try at timelock - 1
        vm.warp(block.timestamp + 7 days - 1);
        vm.expectRevert(DistrictGate.TwoTreeRegistriesTimelockNotExpired.selector);
        gate.executeTwoTreeRegistries();
    }

    /// @notice Revert execute when nothing proposed
    function test_TwoTreeRegistries_RevertWhen_NotProposed() public {
        // Deploy a fresh gate to ensure no proposal is pending
        DistrictGate freshGate = new DistrictGate(
            address(verifierRegistry),
            address(districtRegistry),
            address(nullifierRegistry),
            governance
        );

        vm.expectRevert(DistrictGate.TwoTreeRegistriesNotProposed.selector);
        freshGate.executeTwoTreeRegistries();
    }

    /// @notice Revert cancel when nothing proposed
    function test_TwoTreeRegistries_RevertWhen_CancelNotProposed() public {
        // Deploy a fresh gate to ensure no proposal is pending
        DistrictGate freshGate = new DistrictGate(
            address(verifierRegistry),
            address(districtRegistry),
            address(nullifierRegistry),
            governance
        );

        vm.prank(governance);
        vm.expectRevert(DistrictGate.TwoTreeRegistriesNotProposed.selector);
        freshGate.cancelTwoTreeRegistries();
    }

    /// @notice Non-governance cannot cancel two-tree registries
    function test_TwoTreeRegistries_RevertWhen_CancelUnauthorized() public {
        UserRootRegistry newURR = new UserRootRegistry(governance);
        CellMapRegistry newCMR = new CellMapRegistry(governance);

        vm.prank(governance);
        gate.proposeTwoTreeRegistries(address(newURR), address(newCMR));

        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        gate.cancelTwoTreeRegistries();
    }

    // ============================================================================
    // BR3-007: PENDING OPERATION GUARDS FOR TWO-TREE REGISTRIES
    // ============================================================================

    /// @notice BR3-007: Propose when already pending should revert (prevents timelock reset)
    function test_RevertWhen_ProposeTwoTreeRegistries_WhenAlreadyPending() public {
        UserRootRegistry newURR1 = new UserRootRegistry(governance);
        CellMapRegistry newCMR1 = new CellMapRegistry(governance);
        UserRootRegistry newURR2 = new UserRootRegistry(governance);
        CellMapRegistry newCMR2 = new CellMapRegistry(governance);

        // First proposal
        vm.prank(governance);
        gate.proposeTwoTreeRegistries(address(newURR1), address(newCMR1));

        // Advance time a bit
        vm.warp(block.timestamp + 1 days);

        // Second proposal should revert (prevents timelock reset attack)
        vm.prank(governance);
        vm.expectRevert(DistrictGate.OperationAlreadyPending.selector);
        gate.proposeTwoTreeRegistries(address(newURR2), address(newCMR2));
    }

    /// @notice BR3-007: After cancel, can re-propose two-tree registries
    function test_ProposeTwoTreeRegistries_AfterCancel_Succeeds() public {
        UserRootRegistry newURR1 = new UserRootRegistry(governance);
        CellMapRegistry newCMR1 = new CellMapRegistry(governance);
        UserRootRegistry newURR2 = new UserRootRegistry(governance);
        CellMapRegistry newCMR2 = new CellMapRegistry(governance);

        // First proposal
        vm.prank(governance);
        gate.proposeTwoTreeRegistries(address(newURR1), address(newCMR1));

        // Cancel
        vm.prank(governance);
        gate.cancelTwoTreeRegistries();

        // Now can propose again with different registries
        vm.prank(governance);
        gate.proposeTwoTreeRegistries(address(newURR2), address(newCMR2));

        // Verify: New pending state
        assertEq(gate.pendingUserRootRegistry(), address(newURR2));
        assertEq(gate.pendingCellMapRegistry(), address(newCMR2));
    }

    /// @notice BR3-007: After execute, can re-propose two-tree registries
    function test_ProposeTwoTreeRegistries_AfterExecute_Succeeds() public {
        UserRootRegistry newURR1 = new UserRootRegistry(governance);
        CellMapRegistry newCMR1 = new CellMapRegistry(governance);
        UserRootRegistry newURR2 = new UserRootRegistry(governance);
        CellMapRegistry newCMR2 = new CellMapRegistry(governance);

        // First proposal
        vm.prank(governance);
        gate.proposeTwoTreeRegistries(address(newURR1), address(newCMR1));

        // Execute
        vm.warp(block.timestamp + 7 days);
        gate.executeTwoTreeRegistries();

        // Now can propose again (pending was cleared after execute)
        vm.prank(governance);
        gate.proposeTwoTreeRegistries(address(newURR2), address(newCMR2));

        // Verify: New pending state
        assertEq(gate.pendingUserRootRegistry(), address(newURR2));
        assertEq(gate.pendingCellMapRegistry(), address(newCMR2));
    }

    // ============================================================================
    // 3. ROOT VALIDATION TESTS
    // ============================================================================

    /// @notice Revert when user root is not registered in UserRootRegistry
    function test_VerifyTwoTreeProof_RevertWhen_InvalidUserRoot() public {
        bytes memory proof = hex"deadbeef";
        uint256[29] memory publicInputs = _buildPublicInputs(
            USER_ROOT_INVALID, // Not registered
            CELL_MAP_ROOT_1,
            NULLIFIER_1,
            ACTION_DOMAIN_1,
            AUTHORITY_LEVEL
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateTwoTreeSignature(
            proof,
            publicInputs,
            VERIFIER_DEPTH
        );

        vm.expectRevert(DistrictGate.InvalidUserRoot.selector);
        gate.verifyTwoTreeProof(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);
    }

    /// @notice Revert when cell map root is not registered in CellMapRegistry
    function test_VerifyTwoTreeProof_RevertWhen_InvalidCellMapRoot() public {
        bytes memory proof = hex"deadbeef";
        uint256[29] memory publicInputs = _buildPublicInputs(
            USER_ROOT_1,
            CELL_MAP_ROOT_INVALID, // Not registered
            NULLIFIER_1,
            ACTION_DOMAIN_1,
            AUTHORITY_LEVEL
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateTwoTreeSignature(
            proof,
            publicInputs,
            VERIFIER_DEPTH
        );

        vm.expectRevert(DistrictGate.InvalidCellMapRoot.selector);
        gate.verifyTwoTreeProof(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);
    }

    /// @notice BR3-004: Revert when user root and cell map root have different countries
    function test_VerifyTwoTreeProof_RevertWhen_CountryMismatch() public {
        // Register a Canadian cell map root (country = CAN)
        bytes32 cellMapRootCanada = bytes32(uint256(0xBBBBCADA));
        vm.prank(governance);
        cellMapRegistry.registerCellMapRoot(cellMapRootCanada, CAN, 20);

        bytes memory proof = hex"deadbeef";
        uint256[29] memory publicInputs = _buildPublicInputs(
            USER_ROOT_1,        // USA user root
            cellMapRootCanada,  // CAN cell map root (mismatch)
            NULLIFIER_1,
            ACTION_DOMAIN_1,
            AUTHORITY_LEVEL
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateTwoTreeSignature(
            proof,
            publicInputs,
            VERIFIER_DEPTH
        );

        vm.expectRevert(DistrictGate.CountryMismatch.selector);
        gate.verifyTwoTreeProof(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);
    }

    /// @notice BR3-004: Success when user root and cell map root have matching countries
    function test_VerifyTwoTreeProof_SuccessWhen_CountryMatches() public {
        bytes memory proof = hex"deadbeef";
        uint256[29] memory publicInputs = _buildPublicInputs(
            USER_ROOT_1,      // USA user root
            CELL_MAP_ROOT_1,  // USA cell map root (match)
            NULLIFIER_1,
            ACTION_DOMAIN_1,
            AUTHORITY_LEVEL
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateTwoTreeSignature(
            proof,
            publicInputs,
            VERIFIER_DEPTH
        );

        // Should succeed (country check passes)
        gate.verifyTwoTreeProof(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);

        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, NULLIFIER_1));
    }

    /// @notice BR3-009: Revert when verifierDepth does not match the user root's depth
    function test_VerifyTwoTreeProof_RevertWhen_DepthMismatch() public {
        // Register a depth-22 user root with unique values
        bytes32 userRootDepth22 = bytes32(uint256(0xAAAAD22D22));
        vm.prank(governance);
        userRootRegistry.registerUserRoot(userRootDepth22, USA, 22);

        // Register a depth-22 cell map root to match
        bytes32 cellMapRootDepth22 = bytes32(uint256(0xBBBBD22D22));
        vm.prank(governance);
        cellMapRegistry.registerCellMapRoot(cellMapRootDepth22, USA, 22);

        bytes memory proof = hex"deadbeef";
        uint256[29] memory publicInputs = _buildPublicInputs(
            userRootDepth22,      // depth 22 user root
            cellMapRootDepth22,   // depth 22 cell map root
            NULLIFIER_1,
            ACTION_DOMAIN_1,
            AUTHORITY_LEVEL
        );

        // Try to verify with wrong depth (20 instead of 22)
        (address signer, bytes memory signature, uint256 deadline) = _generateTwoTreeSignature(
            proof,
            publicInputs,
            20  // Wrong depth - should be 22
        );

        vm.expectRevert(DistrictGate.DepthMismatch.selector);
        gate.verifyTwoTreeProof(signer, proof, publicInputs, 20, deadline, signature);
    }

    /// @notice BR3-009: Success when verifierDepth matches the user root's depth
    function test_VerifyTwoTreeProof_SuccessWhen_DepthMatches() public {
        // Register a depth-22 user root with unique values
        bytes32 userRootDepth22 = bytes32(uint256(0xAAAAD22D22));
        vm.prank(governance);
        userRootRegistry.registerUserRoot(userRootDepth22, USA, 22);

        // Register a depth-22 cell map root to match
        bytes32 cellMapRootDepth22 = bytes32(uint256(0xBBBBD22D22));
        vm.prank(governance);
        cellMapRegistry.registerCellMapRoot(cellMapRootDepth22, USA, 22);

        // Register a verifier for depth 22
        vm.prank(governance);
        verifierRegistry.proposeVerifier(22, address(passingVerifier));
        vm.warp(block.timestamp + 14 days);
        verifierRegistry.executeVerifier(22);

        bytes memory proof = hex"deadbeef";
        uint256[29] memory publicInputs = _buildPublicInputs(
            userRootDepth22,      // depth 22 user root
            cellMapRootDepth22,   // depth 22 cell map root
            NULLIFIER_1,
            ACTION_DOMAIN_1,
            AUTHORITY_LEVEL
        );

        // Verify with correct depth (22)
        (address signer, bytes memory signature, uint256 deadline) = _generateTwoTreeSignature(
            proof,
            publicInputs,
            22  // Correct depth
        );

        // Should succeed (depth check passes)
        gate.verifyTwoTreeProof(signer, proof, publicInputs, 22, deadline, signature);

        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, NULLIFIER_1));
    }

    // ============================================================================
    // 4. ACTION DOMAIN WHITELIST TESTS
    // ============================================================================

    /// @notice Revert when action domain is not whitelisted
    function test_VerifyTwoTreeProof_RevertWhen_ActionDomainNotWhitelisted() public {
        bytes memory proof = hex"deadbeef";
        uint256[29] memory publicInputs = _buildPublicInputs(
            USER_ROOT_1,
            CELL_MAP_ROOT_1,
            NULLIFIER_1,
            ACTION_DOMAIN_NOT_WHITELISTED, // Not on whitelist
            AUTHORITY_LEVEL
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateTwoTreeSignature(
            proof,
            publicInputs,
            VERIFIER_DEPTH
        );

        vm.expectRevert(DistrictGate.ActionDomainNotAllowed.selector);
        gate.verifyTwoTreeProof(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);
    }

    // ============================================================================
    // 5. VERIFIER ROUTING TESTS
    // ============================================================================

    /// @notice Revert when verifier depth is not registered in VerifierRegistry
    function test_VerifyTwoTreeProof_RevertWhen_VerifierNotFound() public {
        // Register depth-22 roots (but no verifier for depth 22)
        bytes32 userRootDepth22 = bytes32(uint256(0xAAAA2222FF));
        bytes32 cellMapRootDepth22 = bytes32(uint256(0xBBBB2222FF));

        vm.startPrank(governance);
        userRootRegistry.registerUserRoot(userRootDepth22, USA, 22);
        cellMapRegistry.registerCellMapRoot(cellMapRootDepth22, USA, 22);
        vm.stopPrank();

        bytes memory proof = hex"deadbeef";
        uint256[29] memory publicInputs = _buildPublicInputs(
            userRootDepth22,
            cellMapRootDepth22,
            NULLIFIER_1,
            ACTION_DOMAIN_1,
            AUTHORITY_LEVEL
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateTwoTreeSignature(
            proof,
            publicInputs,
            22
        );

        // Depth 22 has no verifier registered
        vm.expectRevert(DistrictGate.VerifierNotFound.selector);
        gate.verifyTwoTreeProof(signer, proof, publicInputs, 22, deadline, signature);
    }

    /// @notice Revert when verifier returns false (proof rejected)
    function test_VerifyTwoTreeProof_RevertWhen_VerificationFails() public {
        // Register depth-24 roots
        bytes32 userRootDepth24 = bytes32(uint256(0xAAAA2424FF));
        bytes32 cellMapRootDepth24 = bytes32(uint256(0xBBBB2424FF));

        vm.startPrank(governance);
        userRootRegistry.registerUserRoot(userRootDepth24, USA, 24);
        cellMapRegistry.registerCellMapRoot(cellMapRootDepth24, USA, 24);
        vm.stopPrank();

        // Register the failing verifier at depth 24 (using new registry)
        VerifierRegistry newVerifierRegistry = new VerifierRegistry(governance);
        vm.startPrank(governance);
        newVerifierRegistry.registerVerifier(VERIFIER_DEPTH, address(passingVerifier));
        newVerifierRegistry.registerVerifier(18, address(singleTreeVerifier));
        newVerifierRegistry.registerVerifier(22, address(passingVerifier));
        newVerifierRegistry.registerVerifier(24, address(failingVerifier));
        newVerifierRegistry.sealGenesis();
        vm.stopPrank();

        // Deploy new gate with new verifier registry
        DistrictGate newGate = new DistrictGate(
            address(newVerifierRegistry),
            address(districtRegistry),
            address(nullifierRegistry),
            governance
        );

        // Authorize new gate
        vm.prank(governance);
        nullifierRegistry.proposeCallerAuthorization(address(newGate));
        uint256 t1 = block.timestamp + 7 days;
        vm.warp(t1);
        nullifierRegistry.executeCallerAuthorization(address(newGate));

        // Configure two-tree registries on new gate
        vm.prank(governance);
        newGate.proposeTwoTreeRegistries(address(userRootRegistry), address(cellMapRegistry));
        uint256 t2 = t1 + 7 days;
        vm.warp(t2);
        newGate.executeTwoTreeRegistries();

        // Whitelist action domain on new gate
        vm.prank(governance);
        newGate.proposeActionDomain(ACTION_DOMAIN_1);
        vm.warp(t2 + 7 days + 1);
        newGate.executeActionDomain(ACTION_DOMAIN_1);

        // Use new gate for test
        gate = newGate;

        bytes memory proof = hex"deadbeef";
        uint256[29] memory publicInputs = _buildPublicInputs(
            userRootDepth24,
            cellMapRootDepth24,
            NULLIFIER_1,
            ACTION_DOMAIN_1,
            AUTHORITY_LEVEL
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateTwoTreeSignature(
            proof,
            publicInputs,
            24
        );

        vm.expectRevert(DistrictGate.TwoTreeVerificationFailed.selector);
        gate.verifyTwoTreeProof(signer, proof, publicInputs, 24, deadline, signature);
    }

    // ============================================================================
    // 6. NULLIFIER MANAGEMENT TESTS
    // ============================================================================

    /// @notice Nullifier is recorded after successful two-tree verification
    function test_VerifyTwoTreeProof_NullifierRecorded() public {
        // Before: nullifier not used
        assertFalse(gate.isNullifierUsed(ACTION_DOMAIN_1, NULLIFIER_1));
        assertEq(gate.getParticipantCount(ACTION_DOMAIN_1), 0);

        bytes memory proof = hex"deadbeef";
        uint256[29] memory publicInputs = _buildPublicInputs(
            USER_ROOT_1,
            CELL_MAP_ROOT_1,
            NULLIFIER_1,
            ACTION_DOMAIN_1,
            AUTHORITY_LEVEL
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateTwoTreeSignature(
            proof,
            publicInputs,
            VERIFIER_DEPTH
        );

        gate.verifyTwoTreeProof(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);

        // After: nullifier is used
        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, NULLIFIER_1));
        assertEq(gate.getParticipantCount(ACTION_DOMAIN_1), 1);
    }

    /// @notice Revert when same nullifier+actionDomain is reused (double-voting prevention)
    function test_VerifyTwoTreeProof_RevertWhen_NullifierReused() public {
        bytes memory proof = hex"deadbeef";
        uint256[29] memory publicInputs = _buildPublicInputs(
            USER_ROOT_1,
            CELL_MAP_ROOT_1,
            NULLIFIER_1,
            ACTION_DOMAIN_1,
            AUTHORITY_LEVEL
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateTwoTreeSignature(
            proof,
            publicInputs,
            VERIFIER_DEPTH
        );

        // First submission succeeds
        gate.verifyTwoTreeProof(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);

        // Advance time past rate limit
        vm.warp(block.timestamp + 61 seconds);

        // Generate new signature with increased nonce
        (address signer2, bytes memory signature2, uint256 deadline2) = _generateTwoTreeSignature(
            proof,
            publicInputs,
            VERIFIER_DEPTH
        );

        // Second submission with same nullifier+actionDomain should fail
        vm.expectRevert(NullifierRegistry.NullifierAlreadyUsed.selector);
        gate.verifyTwoTreeProof(signer2, proof, publicInputs, VERIFIER_DEPTH, deadline2, signature2);
    }

    /// @notice Same nullifier works with different action domains (domain separation)
    function test_VerifyTwoTreeProof_SameNullifierDifferentDomains() public {
        bytes memory proof = hex"deadbeef";

        // Submit with ACTION_DOMAIN_1
        uint256[29] memory publicInputs1 = _buildPublicInputs(
            USER_ROOT_1,
            CELL_MAP_ROOT_1,
            NULLIFIER_1,
            ACTION_DOMAIN_1,
            AUTHORITY_LEVEL
        );
        (address signer1, bytes memory signature1, uint256 deadline1) = _generateTwoTreeSignature(
            proof,
            publicInputs1,
            VERIFIER_DEPTH
        );
        gate.verifyTwoTreeProof(signer1, proof, publicInputs1, VERIFIER_DEPTH, deadline1, signature1);

        // Advance time past rate limit
        vm.warp(block.timestamp + 61 seconds);

        // Submit same nullifier with ACTION_DOMAIN_2 - should succeed
        uint256[29] memory publicInputs2 = _buildPublicInputs(
            USER_ROOT_1,
            CELL_MAP_ROOT_1,
            NULLIFIER_1,
            ACTION_DOMAIN_2,
            AUTHORITY_LEVEL
        );
        (address signer2, bytes memory signature2, uint256 deadline2) = _generateTwoTreeSignature(
            proof,
            publicInputs2,
            VERIFIER_DEPTH
        );
        gate.verifyTwoTreeProof(signer2, proof, publicInputs2, VERIFIER_DEPTH, deadline2, signature2);

        // Both recorded independently
        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, NULLIFIER_1));
        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_2, NULLIFIER_1));
        assertEq(gate.getParticipantCount(ACTION_DOMAIN_1), 1);
        assertEq(gate.getParticipantCount(ACTION_DOMAIN_2), 1);
    }

    // ============================================================================
    // 7. PAUSE CONTROLS TESTS
    // ============================================================================

    /// @notice Revert when contract is paused
    function test_VerifyTwoTreeProof_Paused() public {
        vm.prank(governance);
        gate.pause();

        bytes memory proof = hex"deadbeef";
        uint256[29] memory publicInputs = _buildPublicInputs(
            USER_ROOT_1,
            CELL_MAP_ROOT_1,
            NULLIFIER_1,
            ACTION_DOMAIN_1,
            AUTHORITY_LEVEL
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateTwoTreeSignature(
            proof,
            publicInputs,
            VERIFIER_DEPTH
        );

        vm.expectRevert("Pausable: paused");
        gate.verifyTwoTreeProof(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);
    }

    // ============================================================================
    // 8. BACKWARDS COMPATIBILITY TESTS
    // ============================================================================

    /// @notice Single-tree verifyAndAuthorizeWithSignature still works after two-tree setup
    function test_VerifyTwoTreeProof_BackwardsCompatibility() public {
        bytes memory proof = hex"cafebabe";
        uint256 userPrivateKey = 0x1234;
        address signer = vm.addr(userPrivateKey);

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT_18,
            NULLIFIER_2,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA
        );

        // Expect single-tree event
        vm.expectEmit(true, true, true, true);
        emit ActionVerified(
            signer,
            address(this),
            DISTRICT_ROOT_18,
            USA,
            18,
            NULLIFIER_2,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID
        );

        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT_18,
            NULLIFIER_2,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );

        // Single-tree nullifier was recorded
        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, NULLIFIER_2));
    }

    // ============================================================================
    // HELPER FUNCTIONS
    // ============================================================================

    /// @notice Build a 29-element public inputs array for two-tree proofs
    /// @dev Layout:
    ///      [0]     user_root
    ///      [1]     cell_map_root
    ///      [2-25]  districts[24] (filled with zero for tests)
    ///      [26]    nullifier
    ///      [27]    action_domain
    ///      [28]    authority_level
    function _buildPublicInputs(
        bytes32 userRoot,
        bytes32 cellMapRoot,
        bytes32 nullifier,
        bytes32 actionDomain,
        bytes32 authorityLevel
    ) internal pure returns (uint256[29] memory inputs) {
        inputs[0] = uint256(userRoot);
        inputs[1] = uint256(cellMapRoot);
        // inputs[2-25] default to 0 (empty district slots)
        inputs[26] = uint256(nullifier);
        inputs[27] = uint256(actionDomain);
        inputs[28] = uint256(authorityLevel);
    }

    /// @notice Helper to whitelist an action domain (propose + warp + execute)
    function _whitelistActionDomain(bytes32 actionDomain) internal {
        vm.prank(governance);
        gate.proposeActionDomain(actionDomain);
        vm.warp(block.timestamp + 7 days + 1);
        gate.executeActionDomain(actionDomain);
    }

    /// @notice Helper to whitelist an action domain for a specific gate
    function _whitelistActionDomainForGate(DistrictGate _gate, bytes32 actionDomain) internal {
        vm.prank(governance);
        _gate.proposeActionDomain(actionDomain);
        vm.warp(block.timestamp + 7 days + 1);
        _gate.executeActionDomain(actionDomain);
    }

    /// @notice Helper to generate EIP-712 signature for single-tree proof submission
    function _generateSignature(
        uint256 privateKey,
        address signer,
        bytes memory proof,
        bytes32 districtRoot,
        bytes32 nullifier,
        bytes32 authorityLevel,
        bytes32 actionDomain,
        bytes32 districtId,
        bytes3 country
    ) internal view returns (bytes memory signature, uint256 deadline) {
        deadline = block.timestamp + 1 hours;
        uint256 nonce = gate.nonces(signer);

        bytes32 structHash = keccak256(
            abi.encode(
                gate.SUBMIT_PROOF_TYPEHASH(),
                keccak256(proof),
                districtRoot,
                nullifier,
                authorityLevel,
                actionDomain,
                districtId,
                country,
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

    /// @notice Helper to generate EIP-712 signature for two-tree proof submission
    /// @dev Uses a test private key (0xA11CE) for all two-tree test signatures
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

/// @notice Mock two-tree verifier with configurable pass/fail
contract MockTwoTreeVerifier {
    bool public shouldPass;

    constructor(bool _shouldPass) {
        shouldPass = _shouldPass;
    }

    function verify(bytes calldata, bytes32[] calldata) external view returns (bool) {
        return shouldPass;
    }
}

/// @notice Mock single-tree verifier (for backwards compatibility test)
contract MockVerifierSingleTree {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        return true;
    }
}
