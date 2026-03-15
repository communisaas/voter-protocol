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

/// @title DistrictGate MinAuthority Governance Tests
/// @notice Tests for the MinAuthority subsystem: setActionDomainMinAuthority(),
///         executeMinAuthorityIncrease(), cancelMinAuthorityIncrease(), and the
///         InsufficientAuthority enforcement in all three verification paths.
/// @dev CRITICAL COVERAGE GAP: This subsystem had ZERO test coverage prior to this file.
///
/// SYSTEM UNDER TEST:
///   - Decreases take effect immediately (only relax requirements)
///   - Increases require 24h timelock (prevent front-running user proofs)
///   - Authority checked in verifyAndAuthorizeWithSignature(), verifyTwoTreeProof(),
///     and verifyThreeTreeProof() — all three paths enforce minAuthority
///   - Only governance can call setActionDomainMinAuthority()
///
/// TIMELOCK BUG WORKAROUND (via_ir = true):
///   The Yul optimizer caches block.timestamp. All warps use explicit local variables
///   instead of `block.timestamp + X` in sequential warps.
contract DistrictGateMinAuthorityTest is Test {
    DistrictGate public gate;
    DistrictRegistry public districtRegistry;
    NullifierRegistry public nullifierRegistry;
    VerifierRegistry public verifierRegistry;
    UserRootRegistry public userRootRegistry;
    CellMapRegistry public cellMapRegistry;
    EngagementRootRegistry public engagementRootRegistry;

    // Mock verifiers
    MockMinAuthorityVerifier public twoTreeVerifier;
    MockMinAuthorityVerifier public threeTreeVerifier;

    address public governance = address(0x1);
    address public attacker = address(0x3);

    // Test constants: Tree 1 (user identity) roots
    bytes32 public constant USER_ROOT_1 = bytes32(uint256(0xAAAA1111));

    // Test constants: Tree 2 (cell-district mapping) roots
    bytes32 public constant CELL_MAP_ROOT_1 = bytes32(uint256(0xBBBB1111));

    // Test constants: Tree 3 (engagement) roots
    bytes32 public constant ENGAGEMENT_ROOT_1 = bytes32(uint256(0xCCCC1111));

    // Single-tree path constants
    bytes32 public constant DISTRICT_ROOT = bytes32(uint256(0x123));
    bytes32 public constant DISTRICT_ID = keccak256("CA-SD-01");
    bytes3 public constant USA = "USA";
    uint8 public constant DEPTH_20 = 20;

    // Shared constants
    bytes32 public constant NULLIFIER_1 = bytes32(uint256(0x456));
    bytes32 public constant NULLIFIER_2 = bytes32(uint256(0x789));
    bytes32 public constant NULLIFIER_3 = bytes32(uint256(0xABC));
    bytes32 public constant NULLIFIER_4 = bytes32(uint256(0xDEF));
    bytes32 public constant NULLIFIER_5 = bytes32(uint256(0xFED));
    bytes32 public constant ACTION_DOMAIN_1 = keccak256("petition-min-auth");

    // Events
    event ActionDomainMinAuthoritySet(bytes32 indexed actionDomain, uint8 minLevel);
    event MinAuthorityIncreaseProposed(
        bytes32 indexed actionDomain, uint8 proposedLevel, uint256 executeTime
    );

    /// @notice Track last warp time to avoid via_ir timestamp caching bugs
    uint256 internal _lastWarpTime;

    function setUp() public {
        // Deploy mock verifiers
        twoTreeVerifier = new MockMinAuthorityVerifier(true);
        threeTreeVerifier = new MockMinAuthorityVerifier(true);

        // Deploy registries
        districtRegistry = new DistrictRegistry(governance, 7 days);
        nullifierRegistry = new NullifierRegistry(governance, 7 days, 7 days);
        verifierRegistry = new VerifierRegistry(governance, 7 days, 14 days);
        userRootRegistry = new UserRootRegistry(governance, 7 days);
        cellMapRegistry = new CellMapRegistry(governance, 7 days);
        engagementRootRegistry = new EngagementRootRegistry(governance, 7 days);

        // Deploy DistrictGate
        gate = new DistrictGate(
            address(verifierRegistry),
            address(districtRegistry),
            address(nullifierRegistry),
            governance,
            7 days,
            7 days,
            7 days,
            24 hours
        );

        // Register verifiers (genesis) — both two-tree and three-tree
        vm.startPrank(governance);
        verifierRegistry.registerVerifier(DEPTH_20, address(twoTreeVerifier));
        verifierRegistry.registerThreeTreeVerifier(DEPTH_20, address(threeTreeVerifier));
        verifierRegistry.sealGenesis();
        vm.stopPrank();

        // Register district for single-tree path
        vm.prank(governance);
        districtRegistry.registerDistrict(DISTRICT_ROOT, USA, DEPTH_20);

        // Authorize gate as caller on NullifierRegistry (7-day timelock)
        vm.prank(governance);
        nullifierRegistry.proposeCallerAuthorization(address(gate));
        _lastWarpTime = block.timestamp + 7 days;
        vm.warp(_lastWarpTime);
        nullifierRegistry.executeCallerAuthorization(address(gate));

        // Register roots for two-tree and three-tree paths
        vm.startPrank(governance);
        userRootRegistry.registerUserRoot(USER_ROOT_1, USA, 20);
        cellMapRegistry.registerCellMapRoot(CELL_MAP_ROOT_1, USA, 20);
        engagementRootRegistry.registerEngagementRoot(ENGAGEMENT_ROOT_1, 20);
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
    // 1. DECREASE TAKES EFFECT IMMEDIATELY
    // ============================================================================

    /// @notice Set min authority for an action domain, then decrease it. The new
    ///         (lower) value must be active immediately — no timelock required.
    function test_SetMinAuthority_DecreaseTakesEffectImmediately() public {
        // First: set authority to 3 via timelock path (increase from 0)
        _setMinAuthority(ACTION_DOMAIN_1, 3);
        assertEq(gate.actionDomainMinAuthority(ACTION_DOMAIN_1), 3);

        // Now decrease from 3 to 1 — should be immediate
        vm.prank(governance);
        vm.expectEmit(true, false, false, true);
        emit ActionDomainMinAuthoritySet(ACTION_DOMAIN_1, 1);
        gate.setActionDomainMinAuthority(ACTION_DOMAIN_1, 1);

        // Assert new value is active immediately
        assertEq(gate.actionDomainMinAuthority(ACTION_DOMAIN_1), 1);
    }

    /// @notice Decrease to 0 (no enforcement) takes effect immediately
    function test_SetMinAuthority_DecreaseToZeroImmediate() public {
        _setMinAuthority(ACTION_DOMAIN_1, 3);
        assertEq(gate.actionDomainMinAuthority(ACTION_DOMAIN_1), 3);

        // Decrease from 3 to 0
        vm.prank(governance);
        vm.expectEmit(true, false, false, true);
        emit ActionDomainMinAuthoritySet(ACTION_DOMAIN_1, 0);
        gate.setActionDomainMinAuthority(ACTION_DOMAIN_1, 0);

        assertEq(gate.actionDomainMinAuthority(ACTION_DOMAIN_1), 0);
    }

    /// @notice Setting same level (no change) also takes immediate path
    function test_SetMinAuthority_SameLevelIsImmediate() public {
        _setMinAuthority(ACTION_DOMAIN_1, 3);

        vm.prank(governance);
        vm.expectEmit(true, false, false, true);
        emit ActionDomainMinAuthoritySet(ACTION_DOMAIN_1, 3);
        gate.setActionDomainMinAuthority(ACTION_DOMAIN_1, 3);

        assertEq(gate.actionDomainMinAuthority(ACTION_DOMAIN_1), 3);
    }

    // ============================================================================
    // 2. INCREASE REQUIRES TIMELOCK
    // ============================================================================

    /// @notice Increasing min authority must queue the change with 24h timelock,
    ///         NOT apply it immediately.
    function test_SetMinAuthority_IncreaseRequiresTimelock() public {
        // Increase from 0 to 3
        uint256 expectedExecuteTime = block.timestamp + 24 hours;

        vm.prank(governance);
        vm.expectEmit(true, false, false, true);
        emit MinAuthorityIncreaseProposed(ACTION_DOMAIN_1, 3, expectedExecuteTime);
        gate.setActionDomainMinAuthority(ACTION_DOMAIN_1, 3);

        // Value must NOT have changed yet
        assertEq(gate.actionDomainMinAuthority(ACTION_DOMAIN_1), 0);

        // Pending state must be set
        assertEq(gate.pendingMinAuthority(ACTION_DOMAIN_1), 3);
        assertEq(gate.pendingMinAuthorityExecuteTime(ACTION_DOMAIN_1), expectedExecuteTime);
    }

    /// @notice Increasing from a non-zero level also requires timelock
    function test_SetMinAuthority_IncreaseFromNonZeroRequiresTimelock() public {
        _setMinAuthority(ACTION_DOMAIN_1, 2);
        assertEq(gate.actionDomainMinAuthority(ACTION_DOMAIN_1), 2);

        // Increase from 2 to 4
        uint256 expectedExecuteTime = block.timestamp + 24 hours;

        vm.prank(governance);
        vm.expectEmit(true, false, false, true);
        emit MinAuthorityIncreaseProposed(ACTION_DOMAIN_1, 4, expectedExecuteTime);
        gate.setActionDomainMinAuthority(ACTION_DOMAIN_1, 4);

        // Current value unchanged
        assertEq(gate.actionDomainMinAuthority(ACTION_DOMAIN_1), 2);
        // Pending state set
        assertEq(gate.pendingMinAuthority(ACTION_DOMAIN_1), 4);
    }

    // ============================================================================
    // 3. EXECUTE REVERTS BEFORE TIMELOCK
    // ============================================================================

    /// @notice Executing a pending authority increase before the 24h timelock must revert
    function test_ExecuteMinAuthorityIncrease_RevertsBeforeTimelock() public {
        // Queue an increase from 0 to 3
        vm.prank(governance);
        gate.setActionDomainMinAuthority(ACTION_DOMAIN_1, 3);

        // Advance 23 hours 59 minutes — still before timelock
        uint256 almostReady = block.timestamp + 23 hours + 59 minutes;
        vm.warp(almostReady);

        vm.expectRevert("Timelock not expired");
        gate.executeMinAuthorityIncrease(ACTION_DOMAIN_1);

        // Value must still be 0
        assertEq(gate.actionDomainMinAuthority(ACTION_DOMAIN_1), 0);
    }

    /// @notice Execute reverts when nothing is pending
    function test_ExecuteMinAuthorityIncrease_RevertsWhenNoPending() public {
        vm.expectRevert("No pending increase");
        gate.executeMinAuthorityIncrease(ACTION_DOMAIN_1);
    }

    // ============================================================================
    // 4. EXECUTE SUCCEEDS AFTER TIMELOCK
    // ============================================================================

    /// @notice After the 24h timelock, execute applies the new authority level
    function test_ExecuteMinAuthorityIncrease_SucceedsAfterTimelock() public {
        // Queue increase
        vm.prank(governance);
        gate.setActionDomainMinAuthority(ACTION_DOMAIN_1, 3);

        // Warp past timelock (use explicit variable per via_ir pattern)
        uint256 pastTimelock = block.timestamp + 24 hours;
        vm.warp(pastTimelock);

        // Execute
        vm.expectEmit(true, false, false, true);
        emit ActionDomainMinAuthoritySet(ACTION_DOMAIN_1, 3);
        gate.executeMinAuthorityIncrease(ACTION_DOMAIN_1);

        // Value is now 3
        assertEq(gate.actionDomainMinAuthority(ACTION_DOMAIN_1), 3);

        // Pending state cleared
        assertEq(gate.pendingMinAuthority(ACTION_DOMAIN_1), 0);
        assertEq(gate.pendingMinAuthorityExecuteTime(ACTION_DOMAIN_1), 0);
    }

    /// @notice Anyone can execute (not just governance) once timelock expires
    function test_ExecuteMinAuthorityIncrease_AnyoneCanExecute() public {
        vm.prank(governance);
        gate.setActionDomainMinAuthority(ACTION_DOMAIN_1, 4);

        uint256 pastTimelock = block.timestamp + 24 hours;
        vm.warp(pastTimelock);

        // Execute as non-governance address
        vm.prank(attacker);
        gate.executeMinAuthorityIncrease(ACTION_DOMAIN_1);

        assertEq(gate.actionDomainMinAuthority(ACTION_DOMAIN_1), 4);
    }

    /// @notice Execute works at exactly the timelock boundary (>=)
    function test_ExecuteMinAuthorityIncrease_ExactTimelockBoundary() public {
        vm.prank(governance);
        gate.setActionDomainMinAuthority(ACTION_DOMAIN_1, 2);

        uint256 executeTime = gate.pendingMinAuthorityExecuteTime(ACTION_DOMAIN_1);
        vm.warp(executeTime); // Exactly at boundary

        gate.executeMinAuthorityIncrease(ACTION_DOMAIN_1);
        assertEq(gate.actionDomainMinAuthority(ACTION_DOMAIN_1), 2);
    }

    // ============================================================================
    // 5. CANCEL PENDING INCREASE
    // ============================================================================

    /// @notice Governance can cancel a pending increase; no pending change remains
    function test_CancelMinAuthorityIncrease() public {
        // Queue increase
        vm.prank(governance);
        gate.setActionDomainMinAuthority(ACTION_DOMAIN_1, 5);

        // Verify pending state exists
        assertEq(gate.pendingMinAuthority(ACTION_DOMAIN_1), 5);
        assertGt(gate.pendingMinAuthorityExecuteTime(ACTION_DOMAIN_1), 0);

        // Cancel
        vm.prank(governance);
        gate.cancelMinAuthorityIncrease(ACTION_DOMAIN_1);

        // Verify pending state cleared
        assertEq(gate.pendingMinAuthority(ACTION_DOMAIN_1), 0);
        assertEq(gate.pendingMinAuthorityExecuteTime(ACTION_DOMAIN_1), 0);

        // Original value unchanged
        assertEq(gate.actionDomainMinAuthority(ACTION_DOMAIN_1), 0);

        // Cannot execute after cancellation
        uint256 pastTimelock = block.timestamp + 24 hours + 1;
        vm.warp(pastTimelock);

        vm.expectRevert("No pending increase");
        gate.executeMinAuthorityIncrease(ACTION_DOMAIN_1);
    }

    /// @notice Cancel reverts when no pending increase exists
    function test_CancelMinAuthorityIncrease_RevertsWhenNoPending() public {
        vm.prank(governance);
        vm.expectRevert("No pending increase");
        gate.cancelMinAuthorityIncrease(ACTION_DOMAIN_1);
    }

    /// @notice Cancel reverts when called by non-governance
    function test_CancelMinAuthorityIncrease_RevertsWhenNonGovernance() public {
        vm.prank(governance);
        gate.setActionDomainMinAuthority(ACTION_DOMAIN_1, 3);

        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        gate.cancelMinAuthorityIncrease(ACTION_DOMAIN_1);
    }

    // ============================================================================
    // 6. TWO-TREE PROOF REVERTS WHEN AUTHORITY BELOW MINIMUM
    // ============================================================================

    /// @notice verifyTwoTreeProof reverts with InsufficientAuthority when the proof's
    ///         authority_level is below the domain's minAuthority.
    function test_VerifyTwoTreeProof_RevertsWhen_AuthorityBelowMinimum() public {
        // Set min authority to 3
        _setMinAuthority(ACTION_DOMAIN_1, 3);
        assertEq(gate.actionDomainMinAuthority(ACTION_DOMAIN_1), 3);

        // Build proof with authority=1 (below minimum of 3)
        bytes memory proof = hex"deadbeef";
        uint256[29] memory publicInputs;
        publicInputs[0] = uint256(USER_ROOT_1);
        publicInputs[1] = uint256(CELL_MAP_ROOT_1);
        publicInputs[26] = uint256(NULLIFIER_1);
        publicInputs[27] = uint256(ACTION_DOMAIN_1);
        publicInputs[28] = uint256(1); // authority_level = 1

        (address signer, bytes memory signature, uint256 deadline) =
            _generateTwoTreeSignature(proof, publicInputs, DEPTH_20);

        vm.expectRevert(abi.encodeWithSelector(DistrictGate.InsufficientAuthority.selector, 1, 3));
        gate.verifyTwoTreeProof(signer, proof, publicInputs, DEPTH_20, deadline, signature);
    }

    /// @notice verifyTwoTreeProof succeeds when authority exactly meets minimum
    function test_VerifyTwoTreeProof_SucceedsWhen_AuthorityEqualsMinimum() public {
        _setMinAuthority(ACTION_DOMAIN_1, 3);

        bytes memory proof = hex"deadbeef";
        uint256[29] memory publicInputs;
        publicInputs[0] = uint256(USER_ROOT_1);
        publicInputs[1] = uint256(CELL_MAP_ROOT_1);
        publicInputs[26] = uint256(NULLIFIER_1);
        publicInputs[27] = uint256(ACTION_DOMAIN_1);
        publicInputs[28] = uint256(3); // authority_level = 3 (exactly meets min)

        (address signer, bytes memory signature, uint256 deadline) =
            _generateTwoTreeSignature(proof, publicInputs, DEPTH_20);

        gate.verifyTwoTreeProof(signer, proof, publicInputs, DEPTH_20, deadline, signature);
        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, NULLIFIER_1));
    }

    /// @notice verifyTwoTreeProof succeeds when authority exceeds minimum
    function test_VerifyTwoTreeProof_SucceedsWhen_AuthorityAboveMinimum() public {
        _setMinAuthority(ACTION_DOMAIN_1, 2);

        bytes memory proof = hex"deadbeef";
        uint256[29] memory publicInputs;
        publicInputs[0] = uint256(USER_ROOT_1);
        publicInputs[1] = uint256(CELL_MAP_ROOT_1);
        publicInputs[26] = uint256(NULLIFIER_2);
        publicInputs[27] = uint256(ACTION_DOMAIN_1);
        publicInputs[28] = uint256(5); // authority_level = 5 (above min of 2)

        (address signer, bytes memory signature, uint256 deadline) =
            _generateTwoTreeSignature(proof, publicInputs, DEPTH_20);

        gate.verifyTwoTreeProof(signer, proof, publicInputs, DEPTH_20, deadline, signature);
        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, NULLIFIER_2));
    }

    /// @notice verifyTwoTreeProof succeeds when minAuthority is 0 (no enforcement)
    function test_VerifyTwoTreeProof_SucceedsWhen_MinAuthorityIsZero() public {
        // Default is 0 (no enforcement)
        assertEq(gate.actionDomainMinAuthority(ACTION_DOMAIN_1), 0);

        bytes memory proof = hex"deadbeef";
        uint256[29] memory publicInputs;
        publicInputs[0] = uint256(USER_ROOT_1);
        publicInputs[1] = uint256(CELL_MAP_ROOT_1);
        publicInputs[26] = uint256(NULLIFIER_3);
        publicInputs[27] = uint256(ACTION_DOMAIN_1);
        publicInputs[28] = uint256(1); // lowest valid authority

        (address signer, bytes memory signature, uint256 deadline) =
            _generateTwoTreeSignature(proof, publicInputs, DEPTH_20);

        gate.verifyTwoTreeProof(signer, proof, publicInputs, DEPTH_20, deadline, signature);
        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, NULLIFIER_3));
    }

    // ============================================================================
    // 7. THREE-TREE PROOF REVERTS WHEN AUTHORITY BELOW MINIMUM
    // ============================================================================

    /// @notice verifyThreeTreeProof reverts with InsufficientAuthority when the proof's
    ///         authority_level is below the domain's minAuthority.
    function test_VerifyThreeTreeProof_RevertsWhen_AuthorityBelowMinimum() public {
        _setMinAuthority(ACTION_DOMAIN_1, 3);
        assertEq(gate.actionDomainMinAuthority(ACTION_DOMAIN_1), 3);

        // Build proof with authority=2 (below minimum of 3)
        bytes memory proof = hex"deadbeef";
        uint256[31] memory publicInputs = _buildThreeTreePublicInputs(
            USER_ROOT_1,
            CELL_MAP_ROOT_1,
            NULLIFIER_1,
            ACTION_DOMAIN_1,
            bytes32(uint256(2)), // authority = 2
            ENGAGEMENT_ROOT_1,
            2 // engagement_tier
        );

        (address signer, bytes memory signature, uint256 deadline) =
            _generateThreeTreeSignature(proof, publicInputs, DEPTH_20);

        vm.expectRevert(abi.encodeWithSelector(DistrictGate.InsufficientAuthority.selector, 2, 3));
        gate.verifyThreeTreeProof(signer, proof, publicInputs, DEPTH_20, deadline, signature);
    }

    /// @notice verifyThreeTreeProof succeeds when authority meets minimum
    function test_VerifyThreeTreeProof_SucceedsWhen_AuthorityEqualsMinimum() public {
        _setMinAuthority(ACTION_DOMAIN_1, 4);

        bytes memory proof = hex"deadbeef";
        uint256[31] memory publicInputs = _buildThreeTreePublicInputs(
            USER_ROOT_1,
            CELL_MAP_ROOT_1,
            NULLIFIER_1,
            ACTION_DOMAIN_1,
            bytes32(uint256(4)), // authority = 4 (meets min)
            ENGAGEMENT_ROOT_1,
            2
        );

        (address signer, bytes memory signature, uint256 deadline) =
            _generateThreeTreeSignature(proof, publicInputs, DEPTH_20);

        gate.verifyThreeTreeProof(signer, proof, publicInputs, DEPTH_20, deadline, signature);
        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, NULLIFIER_1));
    }

    // ============================================================================
    // 8. SINGLE-TREE PROOF ENFORCES MIN AUTHORITY
    // ============================================================================

    /// @notice verifyAndAuthorizeWithSignature also enforces minAuthority
    function test_VerifyAndAuthorizeWithSignature_RevertsWhen_AuthorityBelowMinimum() public {
        _setMinAuthority(ACTION_DOMAIN_1, 4);

        bytes memory proof = hex"deadbeef";
        bytes32 authorityLevel = bytes32(uint256(2)); // below min of 4

        uint256 userPrivateKey = 0x1234;
        address signer = vm.addr(userPrivateKey);

        (bytes memory signature, uint256 deadline) = _generateSingleTreeSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT,
            NULLIFIER_1,
            authorityLevel,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA
        );

        vm.expectRevert(abi.encodeWithSelector(DistrictGate.InsufficientAuthority.selector, 2, 4));
        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT,
            NULLIFIER_1,
            authorityLevel,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );
    }

    /// @notice Single-tree path succeeds when authority meets minimum
    function test_VerifyAndAuthorizeWithSignature_SucceedsWhen_AuthorityMeetsMinimum() public {
        _setMinAuthority(ACTION_DOMAIN_1, 3);

        bytes memory proof = hex"deadbeef";
        bytes32 authorityLevel = bytes32(uint256(3));

        uint256 userPrivateKey = 0x1234;
        address signer = vm.addr(userPrivateKey);

        (bytes memory signature, uint256 deadline) = _generateSingleTreeSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT,
            NULLIFIER_1,
            authorityLevel,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA
        );

        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT,
            NULLIFIER_1,
            authorityLevel,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );

        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, NULLIFIER_1));
    }

    // ============================================================================
    // 9. ACCESS CONTROL
    // ============================================================================

    /// @notice setActionDomainMinAuthority reverts when called by non-governance
    function test_SetMinAuthority_RevertsWhen_CalledByNonGovernance() public {
        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        gate.setActionDomainMinAuthority(ACTION_DOMAIN_1, 3);
    }

    /// @notice setActionDomainMinAuthority reverts when domain is not registered
    function test_SetMinAuthority_RevertsWhen_DomainNotRegistered() public {
        bytes32 unregisteredDomain = keccak256("unregistered-domain");

        vm.prank(governance);
        vm.expectRevert("Domain not registered");
        gate.setActionDomainMinAuthority(unregisteredDomain, 3);
    }

    /// @notice setActionDomainMinAuthority reverts when level exceeds 5
    function test_SetMinAuthority_RevertsWhen_LevelExceeds5() public {
        vm.prank(governance);
        vm.expectRevert("Invalid authority level");
        gate.setActionDomainMinAuthority(ACTION_DOMAIN_1, 6);
    }

    /// @notice setActionDomainMinAuthority reverts when level is 255
    function test_SetMinAuthority_RevertsWhen_LevelIs255() public {
        vm.prank(governance);
        vm.expectRevert("Invalid authority level");
        gate.setActionDomainMinAuthority(ACTION_DOMAIN_1, 255);
    }

    // ============================================================================
    // 10. EDGE CASES AND SEQUENTIAL OPERATIONS
    // ============================================================================

    /// @notice Multiple decreases in sequence: each takes effect immediately
    function test_SetMinAuthority_MultipleDecreases() public {
        _setMinAuthority(ACTION_DOMAIN_1, 5);
        assertEq(gate.actionDomainMinAuthority(ACTION_DOMAIN_1), 5);

        vm.prank(governance);
        gate.setActionDomainMinAuthority(ACTION_DOMAIN_1, 4);
        assertEq(gate.actionDomainMinAuthority(ACTION_DOMAIN_1), 4);

        vm.prank(governance);
        gate.setActionDomainMinAuthority(ACTION_DOMAIN_1, 2);
        assertEq(gate.actionDomainMinAuthority(ACTION_DOMAIN_1), 2);

        vm.prank(governance);
        gate.setActionDomainMinAuthority(ACTION_DOMAIN_1, 0);
        assertEq(gate.actionDomainMinAuthority(ACTION_DOMAIN_1), 0);
    }

    /// @notice Decrease after failed increase (cancel then decrease) works correctly
    function test_SetMinAuthority_DecreaseAfterCancelledIncrease() public {
        _setMinAuthority(ACTION_DOMAIN_1, 3);

        // Queue increase to 5
        vm.prank(governance);
        gate.setActionDomainMinAuthority(ACTION_DOMAIN_1, 5);
        assertEq(gate.pendingMinAuthority(ACTION_DOMAIN_1), 5);

        // Cancel the increase
        vm.prank(governance);
        gate.cancelMinAuthorityIncrease(ACTION_DOMAIN_1);

        // Decrease to 1 — should be immediate
        vm.prank(governance);
        gate.setActionDomainMinAuthority(ACTION_DOMAIN_1, 1);
        assertEq(gate.actionDomainMinAuthority(ACTION_DOMAIN_1), 1);
    }

    /// @notice Setting minAuthority to 5 then verifying with authority=5 succeeds
    function test_SetMinAuthority_MaxLevel_ProofSucceeds() public {
        _setMinAuthority(ACTION_DOMAIN_1, 5);

        bytes memory proof = hex"deadbeef";
        uint256[29] memory publicInputs;
        publicInputs[0] = uint256(USER_ROOT_1);
        publicInputs[1] = uint256(CELL_MAP_ROOT_1);
        publicInputs[26] = uint256(NULLIFIER_4);
        publicInputs[27] = uint256(ACTION_DOMAIN_1);
        publicInputs[28] = uint256(5); // max authority

        (address signer, bytes memory signature, uint256 deadline) =
            _generateTwoTreeSignature(proof, publicInputs, DEPTH_20);

        gate.verifyTwoTreeProof(signer, proof, publicInputs, DEPTH_20, deadline, signature);
        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, NULLIFIER_4));
    }

    /// @notice Increase from 0 to 1 still requires timelock
    function test_SetMinAuthority_IncreaseFrom0To1_RequiresTimelock() public {
        assertEq(gate.actionDomainMinAuthority(ACTION_DOMAIN_1), 0);

        vm.prank(governance);
        gate.setActionDomainMinAuthority(ACTION_DOMAIN_1, 1);

        // Not applied yet
        assertEq(gate.actionDomainMinAuthority(ACTION_DOMAIN_1), 0);
        assertEq(gate.pendingMinAuthority(ACTION_DOMAIN_1), 1);
    }

    /// @notice The 24h constant is correctly set
    function test_MinAuthorityIncreaseTimelock_Is24Hours() public view {
        assertEq(gate.MIN_AUTHORITY_INCREASE_TIMELOCK(), 24 hours);
    }

    // ============================================================================
    // 11. PROOF AFTER DECREASE WORKS WITH NEW LOWER THRESHOLD
    // ============================================================================

    /// @notice After decreasing minAuthority, a proof that was previously rejected
    ///         should now succeed.
    function test_ProofSucceedsAfterDecrease() public {
        // Set min to 4
        _setMinAuthority(ACTION_DOMAIN_1, 4);

        // First: verify authority=2 fails
        {
            bytes memory proof = hex"deadbeef";
            uint256[29] memory publicInputs;
            publicInputs[0] = uint256(USER_ROOT_1);
            publicInputs[1] = uint256(CELL_MAP_ROOT_1);
            publicInputs[26] = uint256(NULLIFIER_1);
            publicInputs[27] = uint256(ACTION_DOMAIN_1);
            publicInputs[28] = uint256(2);

            (address signer, bytes memory signature, uint256 deadline) =
                _generateTwoTreeSignature(proof, publicInputs, DEPTH_20);

            vm.expectRevert(
                abi.encodeWithSelector(DistrictGate.InsufficientAuthority.selector, 2, 4)
            );
            gate.verifyTwoTreeProof(signer, proof, publicInputs, DEPTH_20, deadline, signature);
        }

        // Decrease to 2
        vm.prank(governance);
        gate.setActionDomainMinAuthority(ACTION_DOMAIN_1, 2);
        assertEq(gate.actionDomainMinAuthority(ACTION_DOMAIN_1), 2);

        // Now authority=2 succeeds
        {
            bytes memory proof = hex"deadbeef";
            uint256[29] memory publicInputs;
            publicInputs[0] = uint256(USER_ROOT_1);
            publicInputs[1] = uint256(CELL_MAP_ROOT_1);
            publicInputs[26] = uint256(NULLIFIER_1);
            publicInputs[27] = uint256(ACTION_DOMAIN_1);
            publicInputs[28] = uint256(2);

            (address signer, bytes memory signature, uint256 deadline) =
                _generateTwoTreeSignature(proof, publicInputs, DEPTH_20);

            gate.verifyTwoTreeProof(signer, proof, publicInputs, DEPTH_20, deadline, signature);
            assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, NULLIFIER_1));
        }
    }

    // ============================================================================
    // HELPER FUNCTIONS
    // ============================================================================

    /// @notice Set minAuthority via the timelock path (queue + warp + execute)
    /// @dev Uses explicit timestamp variables to avoid via_ir warp caching bug
    function _setMinAuthority(bytes32 actionDomain, uint8 level) internal {
        uint8 currentLevel = gate.actionDomainMinAuthority(actionDomain);

        if (level <= currentLevel) {
            // Decrease: immediate
            vm.prank(governance);
            gate.setActionDomainMinAuthority(actionDomain, level);
        } else {
            // Increase: queue + wait + execute
            vm.prank(governance);
            gate.setActionDomainMinAuthority(actionDomain, level);

            _lastWarpTime = block.timestamp + 24 hours;
            vm.warp(_lastWarpTime);

            gate.executeMinAuthorityIncrease(actionDomain);
        }
    }

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

    /// @notice Generate EIP-712 signature for two-tree proof submission
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

        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", gate.DOMAIN_SEPARATOR(), structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        signature = abi.encodePacked(r, s, v);
    }

    /// @notice Generate EIP-712 signature for three-tree proof submission
    function _generateThreeTreeSignature(
        bytes memory proof,
        uint256[31] memory publicInputs,
        uint8 verifierDepth
    ) internal view returns (address signer, bytes memory signature, uint256 deadline) {
        uint256 privateKey = 0xB0B;
        signer = vm.addr(privateKey);
        deadline = block.timestamp + 1 hours;
        uint256 nonce = gate.nonces(signer);

        bytes32 proofHash = keccak256(proof);
        bytes32 publicInputsHash = keccak256(abi.encodePacked(publicInputs));

        bytes32 structHash = keccak256(
            abi.encode(
                gate.SUBMIT_THREE_TREE_PROOF_TYPEHASH(),
                proofHash,
                publicInputsHash,
                verifierDepth,
                nonce,
                deadline
            )
        );

        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", gate.DOMAIN_SEPARATOR(), structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        signature = abi.encodePacked(r, s, v);
    }

    /// @notice Generate EIP-712 signature for single-tree (legacy) proof submission
    function _generateSingleTreeSignature(
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

        bytes32 proofHash = keccak256(proof);

        bytes32 structHash = keccak256(
            abi.encode(
                gate.SUBMIT_PROOF_TYPEHASH(),
                proofHash,
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

        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", gate.DOMAIN_SEPARATOR(), structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        signature = abi.encodePacked(r, s, v);
    }
}

/// @notice Mock verifier with configurable pass/fail for MinAuthority tests
contract MockMinAuthorityVerifier {
    bool public shouldPass;

    constructor(bool _shouldPass) {
        shouldPass = _shouldPass;
    }

    function verify(bytes calldata, bytes32[] calldata) external view returns (bool) {
        return shouldPass;
    }
}
