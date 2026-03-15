// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "forge-std/Test.sol";
import "../src/CellMapRegistry.sol";
import "../src/TimelockGovernance.sol";

/// @title CellMapRegistry Tests
/// @notice Comprehensive tests for Tree 2 (Cell-District Mapping) root lifecycle management
/// @dev Key difference from UserRootRegistry: 90-day grace period for redistricting transitions
contract CellMapRegistryTest is Test {
    CellMapRegistry public registry;

    address public governance = address(0x1);
    address public newGovernance = address(0x2);
    address public attacker = address(0x3);
    address public user = address(0x4);

    bytes32 public constant ROOT_1 = keccak256("CELL_MAP_ROOT_1");
    bytes32 public constant ROOT_2 = keccak256("CELL_MAP_ROOT_2");
    bytes32 public constant UNREGISTERED_ROOT = keccak256("UNREGISTERED");
    bytes3 public constant USA = "USA";
    bytes3 public constant GBR = "GBR";
    uint8 public constant DEPTH_20 = 20;

    event CellMapRootRegistered(bytes32 indexed root, bytes3 indexed country, uint8 depth, uint256 timestamp);
    event RootOperationInitiated(bytes32 indexed root, uint8 operationType, uint256 executeTime);
    event RootDeactivated(bytes32 indexed root);
    event RootExpirySet(bytes32 indexed root, uint64 expiresAt);
    event RootReactivated(bytes32 indexed root);
    event RootOperationCancelled(bytes32 indexed root);
    event GovernanceTransferInitiated(address indexed newGovernance, uint256 executeTime);
    event GovernanceTransferred(address indexed previousGovernance, address indexed newGovernance);

    function setUp() public {
        registry = new CellMapRegistry(governance, 7 days);
    }

    // ============ Constructor Tests ============

    function test_Constructor() public view {
        assertEq(registry.governance(), governance);
        assertEq(registry.GOVERNANCE_TIMELOCK(), 7 days);
        assertEq(registry.DEPRECATION_GRACE_PERIOD(), 90 days);
    }

    function test_RevertWhen_ConstructorZeroAddress() public {
        vm.expectRevert(TimelockGovernance.ZeroAddress.selector);
        new CellMapRegistry(address(0), 7 days);
    }

    // ============ Root Registration Tests ============

    function test_RegisterCellMapRoot() public {
        vm.prank(governance);
        vm.expectEmit(true, true, false, true);
        emit CellMapRootRegistered(ROOT_1, USA, DEPTH_20, block.timestamp);

        registry.registerCellMapRoot(ROOT_1, USA, DEPTH_20);

        CellMapRegistry.CellMapRootMetadata memory meta = registry.getCellMapRootMetadata(ROOT_1);
        assertEq(meta.country, USA);
        assertEq(meta.depth, DEPTH_20);
        assertTrue(meta.isActive);
        assertEq(meta.registeredAt, uint32(block.timestamp));
        assertEq(meta.expiresAt, 0);
    }

    function test_RegisterCellMapRoot_MultipleSupportedDepths() public {
        bytes32 root18 = keccak256("ROOT_18");
        bytes32 root20 = keccak256("ROOT_20");
        bytes32 root22 = keccak256("ROOT_22");
        bytes32 root24 = keccak256("ROOT_24");

        vm.startPrank(governance);
        registry.registerCellMapRoot(root18, USA, 18);
        registry.registerCellMapRoot(root20, USA, 20);
        registry.registerCellMapRoot(root22, USA, 22);
        registry.registerCellMapRoot(root24, USA, 24);
        vm.stopPrank();

        assertEq(registry.getCellMapRootMetadata(root18).depth, 18);
        assertEq(registry.getCellMapRootMetadata(root20).depth, 20);
        assertEq(registry.getCellMapRootMetadata(root22).depth, 22);
        assertEq(registry.getCellMapRootMetadata(root24).depth, 24);
    }

    function test_RevertWhen_RegisterCellMapRootUnauthorized() public {
        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.registerCellMapRoot(ROOT_1, USA, DEPTH_20);
    }

    function test_RevertWhen_RegisterCellMapRootDuplicate() public {
        vm.startPrank(governance);
        registry.registerCellMapRoot(ROOT_1, USA, DEPTH_20);
        vm.expectRevert(CellMapRegistry.RootAlreadyRegistered.selector);
        registry.registerCellMapRoot(ROOT_1, USA, DEPTH_20);
        vm.stopPrank();
    }

    function test_RevertWhen_RegisterCellMapRootInvalidCountry() public {
        vm.prank(governance);
        vm.expectRevert(CellMapRegistry.InvalidCountryCode.selector);
        registry.registerCellMapRoot(ROOT_1, bytes3(0), DEPTH_20);
    }

    function test_RevertWhen_RegisterCellMapRootInvalidDepth_TooLow() public {
        vm.prank(governance);
        vm.expectRevert(CellMapRegistry.InvalidDepth.selector);
        registry.registerCellMapRoot(ROOT_1, USA, 16);
    }

    function test_RevertWhen_RegisterCellMapRootInvalidDepth_TooHigh() public {
        vm.prank(governance);
        vm.expectRevert(CellMapRegistry.InvalidDepth.selector);
        registry.registerCellMapRoot(ROOT_1, USA, 26);
    }

    function test_RevertWhen_RegisterCellMapRootInvalidDepth_Odd() public {
        vm.prank(governance);
        vm.expectRevert(CellMapRegistry.InvalidDepth.selector);
        registry.registerCellMapRoot(ROOT_1, USA, 19);
    }

    // ============ isValidCellMapRoot Tests ============

    function test_isValidCellMapRoot_Active() public {
        vm.prank(governance);
        registry.registerCellMapRoot(ROOT_1, USA, DEPTH_20);
        assertTrue(registry.isValidCellMapRoot(ROOT_1));
    }

    function test_isValidCellMapRoot_Unregistered() public view {
        assertFalse(registry.isValidCellMapRoot(UNREGISTERED_ROOT));
    }

    function test_isValidCellMapRoot_Deactivated() public {
        vm.prank(governance);
        registry.registerCellMapRoot(ROOT_1, USA, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);
        vm.warp(block.timestamp + 7 days);
        registry.executeRootDeactivation(ROOT_1);

        assertFalse(registry.isValidCellMapRoot(ROOT_1));
    }

    function test_isValidCellMapRoot_Expired() public {
        vm.prank(governance);
        registry.registerCellMapRoot(ROOT_1, USA, DEPTH_20);

        uint64 expiry = uint64(block.timestamp + 90 days);
        vm.prank(governance);
        registry.initiateRootExpiry(ROOT_1, expiry);
        vm.warp(block.timestamp + 7 days);
        registry.executeRootExpiry(ROOT_1);

        // Before expiry
        assertTrue(registry.isValidCellMapRoot(ROOT_1));

        // After expiry
        vm.warp(expiry + 1);
        assertFalse(registry.isValidCellMapRoot(ROOT_1));
    }

    // ============ 90-Day Grace Period Tests ============

    function test_90DayGracePeriod_DeprecateCellMapRoot() public {
        vm.prank(governance);
        registry.registerCellMapRoot(ROOT_1, USA, DEPTH_20);

        // Use convenience function that sets 90-day expiry
        vm.prank(governance);
        registry.deprecateCellMapRoot(ROOT_1);

        // Wait for 7-day timelock
        vm.warp(block.timestamp + 7 days);
        registry.executeRootExpiry(ROOT_1);

        CellMapRegistry.CellMapRootMetadata memory meta = registry.getCellMapRootMetadata(ROOT_1);
        // The expiry should be approximately 90 days from the deprecation initiation
        // (it was set as block.timestamp + 90 days at initiation time, before 7-day warp)
        assertTrue(meta.expiresAt > 0);

        // Root should still be valid during grace period
        assertTrue(registry.isValidCellMapRoot(ROOT_1));
    }

    function test_90DayGracePeriod_OldRootValidDuringTransition() public {
        vm.prank(governance);
        registry.registerCellMapRoot(ROOT_1, USA, DEPTH_20);

        // Redistricting: register new root and deprecate old
        vm.startPrank(governance);
        registry.registerCellMapRoot(ROOT_2, USA, DEPTH_20);
        registry.deprecateCellMapRoot(ROOT_1);
        vm.stopPrank();

        // Wait for timelock
        uint256 t1 = block.timestamp + 7 days;
        vm.warp(t1);
        registry.executeRootExpiry(ROOT_1);

        // Both roots valid during 90-day grace
        vm.warp(t1 + 45 days); // 45 days into grace period
        assertTrue(registry.isValidCellMapRoot(ROOT_1), "Old root should be valid during grace period");
        assertTrue(registry.isValidCellMapRoot(ROOT_2), "New root should be valid");
    }

    function test_90DayGracePeriod_OldRootExpiresAfterGrace() public {
        uint256 startTime = block.timestamp;

        vm.prank(governance);
        registry.registerCellMapRoot(ROOT_1, USA, DEPTH_20);

        vm.startPrank(governance);
        registry.registerCellMapRoot(ROOT_2, USA, DEPTH_20);
        registry.deprecateCellMapRoot(ROOT_1);
        vm.stopPrank();

        // The deprecateCellMapRoot sets expiresAt = block.timestamp + 90 days (at initiation)
        // After 7-day timelock + grace period, old root expires
        uint256 t1 = block.timestamp + 7 days;
        vm.warp(t1);
        registry.executeRootExpiry(ROOT_1);

        // Go past the 90-day grace (from start time)
        vm.warp(startTime + 91 days);
        assertFalse(registry.isValidCellMapRoot(ROOT_1), "Old root should be expired after 90-day grace");
        assertTrue(registry.isValidCellMapRoot(ROOT_2), "New root should remain valid");
    }

    function test_90DayVs30Day_GracePeriodConstant() public view {
        // Verify the grace period is 90 days (not 30 like UserRootRegistry)
        assertEq(registry.DEPRECATION_GRACE_PERIOD(), 90 days);
    }

    // ============ Root Deactivation Tests ============

    function test_InitiateRootDeactivation() public {
        vm.prank(governance);
        registry.registerCellMapRoot(ROOT_1, USA, DEPTH_20);

        uint256 expectedExecuteTime = block.timestamp + 7 days;

        vm.prank(governance);
        vm.expectEmit(true, false, false, true);
        emit RootOperationInitiated(ROOT_1, 1, expectedExecuteTime);
        registry.initiateRootDeactivation(ROOT_1);

        (uint8 opType, uint64 executeTime, ) = registry.pendingRootOperations(ROOT_1);
        assertEq(opType, 1);
        assertEq(executeTime, expectedExecuteTime);
    }

    function test_DeactivationRequires7DayTimelock() public {
        vm.prank(governance);
        registry.registerCellMapRoot(ROOT_1, USA, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);

        // Cannot execute immediately
        vm.expectRevert(TimelockGovernance.TimelockNotExpired.selector);
        registry.executeRootDeactivation(ROOT_1);

        // Cannot execute after 6 days
        uint256 t1 = block.timestamp + 6 days;
        vm.warp(t1);
        vm.expectRevert(TimelockGovernance.TimelockNotExpired.selector);
        registry.executeRootDeactivation(ROOT_1);

        // Can execute after 7 days
        vm.warp(t1 + 1 days);
        vm.expectEmit(true, false, false, false);
        emit RootDeactivated(ROOT_1);
        registry.executeRootDeactivation(ROOT_1);

        CellMapRegistry.CellMapRootMetadata memory meta = registry.getCellMapRootMetadata(ROOT_1);
        assertFalse(meta.isActive);
    }

    function test_AnyoneCanExecuteDeactivation() public {
        vm.prank(governance);
        registry.registerCellMapRoot(ROOT_1, USA, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);

        vm.warp(block.timestamp + 7 days);

        vm.prank(user);
        registry.executeRootDeactivation(ROOT_1);

        assertFalse(registry.isValidCellMapRoot(ROOT_1));
    }

    function test_RevertWhen_InitiateDeactivation_Unauthorized() public {
        vm.prank(governance);
        registry.registerCellMapRoot(ROOT_1, USA, DEPTH_20);

        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.initiateRootDeactivation(ROOT_1);
    }

    function test_RevertWhen_InitiateDeactivation_NotRegistered() public {
        vm.prank(governance);
        vm.expectRevert(CellMapRegistry.RootNotRegistered.selector);
        registry.initiateRootDeactivation(UNREGISTERED_ROOT);
    }

    function test_RevertWhen_InitiateDeactivation_AlreadyInactive() public {
        vm.prank(governance);
        registry.registerCellMapRoot(ROOT_1, USA, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);
        vm.warp(block.timestamp + 7 days);
        registry.executeRootDeactivation(ROOT_1);

        vm.prank(governance);
        vm.expectRevert(CellMapRegistry.RootAlreadyInactive.selector);
        registry.initiateRootDeactivation(ROOT_1);
    }

    function test_RevertWhen_InitiateDeactivation_OperationPending() public {
        vm.prank(governance);
        registry.registerCellMapRoot(ROOT_1, USA, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);

        vm.prank(governance);
        vm.expectRevert(CellMapRegistry.OperationAlreadyPending.selector);
        registry.initiateRootDeactivation(ROOT_1);
    }

    // ============ Root Expiry Tests ============

    function test_InitiateAndExecuteRootExpiry() public {
        vm.prank(governance);
        registry.registerCellMapRoot(ROOT_1, USA, DEPTH_20);

        uint64 expiryTimestamp = uint64(block.timestamp + 90 days);

        vm.prank(governance);
        registry.initiateRootExpiry(ROOT_1, expiryTimestamp);

        vm.warp(block.timestamp + 7 days);

        vm.expectEmit(true, false, false, true);
        emit RootExpirySet(ROOT_1, expiryTimestamp);
        registry.executeRootExpiry(ROOT_1);

        CellMapRegistry.CellMapRootMetadata memory meta = registry.getCellMapRootMetadata(ROOT_1);
        assertEq(meta.expiresAt, expiryTimestamp);
    }

    function test_isValidCellMapRoot_AtExactExpiryTime() public {
        vm.prank(governance);
        registry.registerCellMapRoot(ROOT_1, USA, DEPTH_20);

        uint64 expiry = uint64(block.timestamp + 90 days);
        vm.prank(governance);
        registry.initiateRootExpiry(ROOT_1, expiry);
        vm.warp(block.timestamp + 7 days);
        registry.executeRootExpiry(ROOT_1);

        // At exact expiry time - still valid (uses > not >=)
        vm.warp(expiry);
        assertTrue(registry.isValidCellMapRoot(ROOT_1));

        // One second after - invalid
        vm.warp(expiry + 1);
        assertFalse(registry.isValidCellMapRoot(ROOT_1));
    }

    function test_ExpiresAt0MeansNeverExpires() public {
        vm.prank(governance);
        registry.registerCellMapRoot(ROOT_1, USA, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootExpiry(ROOT_1, 0);
        uint256 t1 = block.timestamp + 7 days;
        vm.warp(t1);
        registry.executeRootExpiry(ROOT_1);

        vm.warp(t1 + 100 * 365 days);
        assertTrue(registry.isValidCellMapRoot(ROOT_1));
    }

    function test_RevertWhen_InitiateExpiry_PastTimestamp() public {
        vm.warp(90 days);

        vm.prank(governance);
        registry.registerCellMapRoot(ROOT_1, USA, DEPTH_20);

        uint64 pastTimestamp = uint64(block.timestamp - 1 days);
        vm.prank(governance);
        vm.expectRevert(CellMapRegistry.InvalidExpiry.selector);
        registry.initiateRootExpiry(ROOT_1, pastTimestamp);
    }

    // ============ Root Reactivation Tests ============

    function test_CanReactivateDeactivatedRoot() public {
        uint256 startTime = 100 days;
        vm.warp(startTime);

        vm.prank(governance);
        registry.registerCellMapRoot(ROOT_1, USA, DEPTH_20);

        // Deactivate
        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);

        uint256 afterDeactivationTimelock = startTime + 7 days;
        vm.warp(afterDeactivationTimelock);
        registry.executeRootDeactivation(ROOT_1);
        assertFalse(registry.isValidCellMapRoot(ROOT_1));

        // Reactivate
        uint256 reactivationStart = afterDeactivationTimelock + 1 days;
        vm.warp(reactivationStart);
        vm.prank(governance);
        registry.initiateRootReactivation(ROOT_1);

        uint256 afterReactivationTimelock = reactivationStart + 7 days;
        vm.warp(afterReactivationTimelock);

        vm.expectEmit(true, false, false, false);
        emit RootReactivated(ROOT_1);
        registry.executeRootReactivation(ROOT_1);

        assertTrue(registry.isValidCellMapRoot(ROOT_1));
    }

    function test_RevertWhen_Reactivation_AlreadyActive() public {
        vm.prank(governance);
        registry.registerCellMapRoot(ROOT_1, USA, DEPTH_20);

        vm.prank(governance);
        vm.expectRevert(CellMapRegistry.RootAlreadyActive.selector);
        registry.initiateRootReactivation(ROOT_1);
    }

    // ============ Operation Cancellation Tests ============

    function test_CancelRootOperation() public {
        vm.prank(governance);
        registry.registerCellMapRoot(ROOT_1, USA, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);

        vm.prank(governance);
        vm.expectEmit(true, false, false, false);
        emit RootOperationCancelled(ROOT_1);
        registry.cancelRootOperation(ROOT_1);

        (uint8 opType, uint64 executeTime, ) = registry.pendingRootOperations(ROOT_1);
        assertEq(opType, 0);
        assertEq(executeTime, 0);
        assertTrue(registry.isValidCellMapRoot(ROOT_1));
    }

    function test_RevertWhen_CancelOperation_Unauthorized() public {
        vm.prank(governance);
        registry.registerCellMapRoot(ROOT_1, USA, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);

        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.cancelRootOperation(ROOT_1);
    }

    function test_RevertWhen_CancelOperation_NoPending() public {
        vm.prank(governance);
        vm.expectRevert(CellMapRegistry.NoOperationPending.selector);
        registry.cancelRootOperation(ROOT_1);
    }

    // ============ Governance Transfer Tests ============

    function test_GovernanceTransfer() public {
        vm.prank(governance);
        registry.initiateGovernanceTransfer(newGovernance);

        vm.warp(block.timestamp + 7 days);
        registry.executeGovernanceTransfer(newGovernance);

        assertEq(registry.governance(), newGovernance);

        vm.prank(newGovernance);
        registry.registerCellMapRoot(ROOT_1, USA, DEPTH_20);
        assertTrue(registry.isValidCellMapRoot(ROOT_1));

        vm.prank(governance);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.registerCellMapRoot(ROOT_2, GBR, DEPTH_20);
    }

    // ============ View Function Tests ============

    function test_GetCountryAndDepth() public {
        vm.prank(governance);
        registry.registerCellMapRoot(ROOT_1, USA, DEPTH_20);

        (bytes3 country, uint8 depth) = registry.getCountryAndDepth(ROOT_1);
        assertEq(country, USA);
        assertEq(depth, DEPTH_20);
    }

    function test_GetCountryAndDepth_Unregistered() public view {
        (bytes3 country, uint8 depth) = registry.getCountryAndDepth(UNREGISTERED_ROOT);
        assertEq(country, bytes3(0));
        assertEq(depth, 0);
    }

    // ============ Scenario Tests ============

    function test_Scenario_Redistricting() public {
        // Scenario: Congressional redistricting occurs
        // Old cell map root must transition to new one with 90-day grace

        vm.prank(governance);
        registry.registerCellMapRoot(ROOT_1, USA, DEPTH_20);

        // New redistricting data ready
        vm.startPrank(governance);
        registry.registerCellMapRoot(ROOT_2, USA, DEPTH_20);
        registry.deprecateCellMapRoot(ROOT_1);
        vm.stopPrank();

        // Wait for timelock
        uint256 t1 = block.timestamp + 7 days;
        vm.warp(t1);
        registry.executeRootExpiry(ROOT_1);

        // During grace period: both roots valid
        // Users with cached old data still work
        uint256 t2 = t1 + 60 days; // 60 days into grace
        vm.warp(t2);
        assertTrue(registry.isValidCellMapRoot(ROOT_1), "Old root valid during grace");
        assertTrue(registry.isValidCellMapRoot(ROOT_2), "New root valid");

        // After grace: only new root valid
        vm.warp(t2 + 90 days); // well past grace
        assertFalse(registry.isValidCellMapRoot(ROOT_1), "Old root expired");
        assertTrue(registry.isValidCellMapRoot(ROOT_2), "New root still valid");
    }

    function test_Scenario_MultipleCountries() public {
        bytes32 usaRoot = keccak256("USA_CELL_MAP");
        bytes32 gbrRoot = keccak256("GBR_CELL_MAP");

        vm.startPrank(governance);
        registry.registerCellMapRoot(usaRoot, USA, DEPTH_20);
        registry.registerCellMapRoot(gbrRoot, GBR, DEPTH_20);
        vm.stopPrank();

        assertTrue(registry.isValidCellMapRoot(usaRoot));
        assertTrue(registry.isValidCellMapRoot(gbrRoot));

        // Different countries have independent lifecycles
        vm.prank(governance);
        registry.initiateRootDeactivation(usaRoot);
        vm.warp(block.timestamp + 7 days);
        registry.executeRootDeactivation(usaRoot);

        assertFalse(registry.isValidCellMapRoot(usaRoot));
        assertTrue(registry.isValidCellMapRoot(gbrRoot));
    }

    // ============ Fuzz Tests ============

    function testFuzz_RegisterCellMapRoot(bytes32 root, bytes3 country) public {
        vm.assume(country != bytes3(0));

        vm.prank(governance);
        registry.registerCellMapRoot(root, country, DEPTH_20);

        assertTrue(registry.isValidCellMapRoot(root));
    }

    function testFuzz_TimelockEnforcement(uint256 timeElapsed) public {
        vm.assume(timeElapsed < 7 days);

        vm.prank(governance);
        registry.registerCellMapRoot(ROOT_1, USA, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);

        vm.warp(block.timestamp + timeElapsed);

        vm.expectRevert(TimelockGovernance.TimelockNotExpired.selector);
        registry.executeRootDeactivation(ROOT_1);
    }

    function testFuzz_TimelockSuccess(uint256 timeElapsed) public {
        vm.assume(timeElapsed >= 7 days && timeElapsed < 365 days);

        vm.prank(governance);
        registry.registerCellMapRoot(ROOT_1, USA, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);

        vm.warp(block.timestamp + timeElapsed);

        registry.executeRootDeactivation(ROOT_1);
        assertFalse(registry.isValidCellMapRoot(ROOT_1));
    }

    function testFuzz_ExpiryTimestamp(uint64 futureTimestamp) public {
        vm.assume(futureTimestamp > block.timestamp);
        vm.assume(futureTimestamp < block.timestamp + 100 * 365 days);

        vm.prank(governance);
        registry.registerCellMapRoot(ROOT_1, USA, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootExpiry(ROOT_1, futureTimestamp);
        vm.warp(block.timestamp + 7 days);
        registry.executeRootExpiry(ROOT_1);

        vm.warp(futureTimestamp - 1);
        assertTrue(registry.isValidCellMapRoot(ROOT_1));

        vm.warp(futureTimestamp + 1);
        assertFalse(registry.isValidCellMapRoot(ROOT_1));
    }

    // ============ Edge Case Tests ============

    function test_EdgeCase_CannotInitiateMultipleOperationsSimultaneously() public {
        vm.prank(governance);
        registry.registerCellMapRoot(ROOT_1, USA, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);

        vm.prank(governance);
        vm.expectRevert(CellMapRegistry.OperationAlreadyPending.selector);
        registry.initiateRootExpiry(ROOT_1, uint64(block.timestamp + 90 days));
    }

    function test_EdgeCase_DeprecateRevertWhenOperationPending() public {
        vm.prank(governance);
        registry.registerCellMapRoot(ROOT_1, USA, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);

        vm.prank(governance);
        vm.expectRevert(CellMapRegistry.OperationAlreadyPending.selector);
        registry.deprecateCellMapRoot(ROOT_1);
    }

    function test_EdgeCase_CanInitiateNewOperationAfterPreviousCompletes() public {
        vm.prank(governance);
        registry.registerCellMapRoot(ROOT_1, USA, DEPTH_20);

        // Deactivate
        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);
        uint256 t1 = block.timestamp + 7 days;
        vm.warp(t1);
        registry.executeRootDeactivation(ROOT_1);

        // Now can initiate reactivation
        vm.warp(t1 + 1 days);
        vm.prank(governance);
        registry.initiateRootReactivation(ROOT_1);

        (uint8 opType, , ) = registry.pendingRootOperations(ROOT_1);
        assertEq(opType, 3);
    }
}
