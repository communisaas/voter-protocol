// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "forge-std/Test.sol";
import "../src/EngagementRootRegistry.sol";
import "../src/TimelockGovernance.sol";

/// @title EngagementRootRegistry Tests
/// @notice Comprehensive tests for Tree 3 (Engagement) root lifecycle management
contract EngagementRootRegistryTest is Test {
    EngagementRootRegistry public registry;

    address public governance = address(0x1);
    address public newGovernance = address(0x2);
    address public attacker = address(0x3);
    address public user = address(0x4);

    bytes32 public constant ROOT_1 = keccak256("ENGAGEMENT_ROOT_1");
    bytes32 public constant ROOT_2 = keccak256("ENGAGEMENT_ROOT_2");
    bytes32 public constant UNREGISTERED_ROOT = keccak256("UNREGISTERED");
    uint8 public constant DEPTH_20 = 20;

    event EngagementRootRegistered(bytes32 indexed root, uint8 depth, uint256 timestamp);
    event RootOperationInitiated(bytes32 indexed root, uint8 operationType, uint256 executeTime);
    event RootDeactivated(bytes32 indexed root);
    event RootExpirySet(bytes32 indexed root, uint64 expiresAt);
    event RootReactivated(bytes32 indexed root);
    event RootOperationCancelled(bytes32 indexed root);

    function setUp() public {
        registry = new EngagementRootRegistry(governance);
    }

    // ============ Constructor Tests ============

    function test_Constructor() public view {
        assertEq(registry.governance(), governance);
        assertEq(registry.GOVERNANCE_TIMELOCK(), 7 days);
        assertEq(registry.SUNSET_GRACE_PERIOD(), 7 days);
    }

    function test_RevertWhen_ConstructorZeroAddress() public {
        vm.expectRevert(TimelockGovernance.ZeroAddress.selector);
        new EngagementRootRegistry(address(0));
    }

    // ============ Root Registration Tests ============

    function test_RegisterEngagementRoot() public {
        vm.prank(governance);
        vm.expectEmit(true, false, false, true);
        emit EngagementRootRegistered(ROOT_1, DEPTH_20, block.timestamp);

        registry.registerEngagementRoot(ROOT_1, DEPTH_20);

        EngagementRootRegistry.EngagementRootMetadata memory meta = registry.getEngagementRootMetadata(ROOT_1);
        assertEq(meta.depth, DEPTH_20);
        assertTrue(meta.isActive);
        assertEq(meta.registeredAt, uint32(block.timestamp));
        assertEq(meta.expiresAt, 0);
    }

    function test_RegisterEngagementRoot_MultipleSupportedDepths() public {
        bytes32 root18 = keccak256("ROOT_18");
        bytes32 root20 = keccak256("ROOT_20");
        bytes32 root22 = keccak256("ROOT_22");
        bytes32 root24 = keccak256("ROOT_24");

        vm.startPrank(governance);
        registry.registerEngagementRoot(root18, 18);
        registry.registerEngagementRoot(root20, 20);
        registry.registerEngagementRoot(root22, 22);
        registry.registerEngagementRoot(root24, 24);
        vm.stopPrank();

        assertEq(registry.getEngagementRootMetadata(root18).depth, 18);
        assertEq(registry.getEngagementRootMetadata(root20).depth, 20);
        assertEq(registry.getEngagementRootMetadata(root22).depth, 22);
        assertEq(registry.getEngagementRootMetadata(root24).depth, 24);
    }

    function test_RevertWhen_RegisterEngagementRootUnauthorized() public {
        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);
    }

    function test_RevertWhen_RegisterEngagementRootDuplicate() public {
        vm.startPrank(governance);
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);
        vm.expectRevert(EngagementRootRegistry.RootAlreadyRegistered.selector);
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);
        vm.stopPrank();
    }

    function test_RevertWhen_RegisterEngagementRootInvalidDepth_TooLow() public {
        vm.prank(governance);
        vm.expectRevert(EngagementRootRegistry.InvalidDepth.selector);
        registry.registerEngagementRoot(ROOT_1, 16);
    }

    function test_RevertWhen_RegisterEngagementRootInvalidDepth_TooHigh() public {
        vm.prank(governance);
        vm.expectRevert(EngagementRootRegistry.InvalidDepth.selector);
        registry.registerEngagementRoot(ROOT_1, 26);
    }

    function test_RevertWhen_RegisterEngagementRootInvalidDepth_Odd() public {
        vm.prank(governance);
        vm.expectRevert(EngagementRootRegistry.InvalidDepth.selector);
        registry.registerEngagementRoot(ROOT_1, 19);
    }

    // ============ isValidEngagementRoot Tests ============

    function test_isValidEngagementRoot_Active() public {
        vm.prank(governance);
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);
        assertTrue(registry.isValidEngagementRoot(ROOT_1));
    }

    function test_isValidEngagementRoot_Unregistered() public view {
        assertFalse(registry.isValidEngagementRoot(UNREGISTERED_ROOT));
    }

    function test_isValidEngagementRoot_Deactivated() public {
        vm.prank(governance);
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);
        vm.warp(block.timestamp + 7 days);
        registry.executeRootDeactivation(ROOT_1);

        assertFalse(registry.isValidEngagementRoot(ROOT_1));
    }

    function test_isValidEngagementRoot_Expired() public {
        vm.prank(governance);
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);

        uint64 expiry = uint64(block.timestamp + 30 days);
        vm.prank(governance);
        registry.initiateRootExpiry(ROOT_1, expiry);
        vm.warp(block.timestamp + 7 days);
        registry.executeRootExpiry(ROOT_1);

        // Before expiry
        assertTrue(registry.isValidEngagementRoot(ROOT_1));

        // After expiry
        vm.warp(expiry + 1);
        assertFalse(registry.isValidEngagementRoot(ROOT_1));
    }

    function test_isValidEngagementRoot_AtExactExpiryTime() public {
        vm.prank(governance);
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);

        uint64 expiry = uint64(block.timestamp + 30 days);
        vm.prank(governance);
        registry.initiateRootExpiry(ROOT_1, expiry);
        vm.warp(block.timestamp + 7 days);
        registry.executeRootExpiry(ROOT_1);

        // At exact expiry time - still valid (uses > not >=)
        vm.warp(expiry);
        assertTrue(registry.isValidEngagementRoot(ROOT_1));

        // One second after - invalid
        vm.warp(expiry + 1);
        assertFalse(registry.isValidEngagementRoot(ROOT_1));
    }

    // ============ Root Deactivation Tests ============

    function test_InitiateRootDeactivation() public {
        vm.prank(governance);
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);

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
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);

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

        EngagementRootRegistry.EngagementRootMetadata memory meta = registry.getEngagementRootMetadata(ROOT_1);
        assertFalse(meta.isActive);
    }

    function test_AnyoneCanExecuteDeactivation() public {
        vm.prank(governance);
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);

        vm.warp(block.timestamp + 7 days);

        vm.prank(user);
        registry.executeRootDeactivation(ROOT_1);

        assertFalse(registry.isValidEngagementRoot(ROOT_1));
    }

    function test_RevertWhen_InitiateDeactivation_Unauthorized() public {
        vm.prank(governance);
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);

        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.initiateRootDeactivation(ROOT_1);
    }

    function test_RevertWhen_InitiateDeactivation_NotRegistered() public {
        vm.prank(governance);
        vm.expectRevert(EngagementRootRegistry.RootNotRegistered.selector);
        registry.initiateRootDeactivation(UNREGISTERED_ROOT);
    }

    function test_RevertWhen_InitiateDeactivation_AlreadyInactive() public {
        vm.prank(governance);
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);
        vm.warp(block.timestamp + 7 days);
        registry.executeRootDeactivation(ROOT_1);

        vm.prank(governance);
        vm.expectRevert(EngagementRootRegistry.RootAlreadyInactive.selector);
        registry.initiateRootDeactivation(ROOT_1);
    }

    function test_RevertWhen_InitiateDeactivation_OperationPending() public {
        vm.prank(governance);
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);

        vm.prank(governance);
        vm.expectRevert(EngagementRootRegistry.OperationAlreadyPending.selector);
        registry.initiateRootDeactivation(ROOT_1);
    }

    function test_RevertWhen_ExecuteDeactivation_NoOperation() public {
        vm.prank(governance);
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);

        vm.expectRevert(EngagementRootRegistry.NoOperationPending.selector);
        registry.executeRootDeactivation(ROOT_1);
    }

    // ============ Root Expiry Tests ============

    function test_InitiateAndExecuteRootExpiry() public {
        vm.prank(governance);
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);

        uint64 expiryTimestamp = uint64(block.timestamp + 30 days);

        vm.prank(governance);
        registry.initiateRootExpiry(ROOT_1, expiryTimestamp);

        (uint8 opType, , uint64 newExpiresAt) = registry.pendingRootOperations(ROOT_1);
        assertEq(opType, 2);
        assertEq(newExpiresAt, expiryTimestamp);

        vm.warp(block.timestamp + 7 days);

        vm.expectEmit(true, false, false, true);
        emit RootExpirySet(ROOT_1, expiryTimestamp);
        registry.executeRootExpiry(ROOT_1);

        EngagementRootRegistry.EngagementRootMetadata memory meta = registry.getEngagementRootMetadata(ROOT_1);
        assertEq(meta.expiresAt, expiryTimestamp);
    }

    function test_ExpiresAt0MeansNeverExpires() public {
        vm.prank(governance);
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootExpiry(ROOT_1, 0);
        uint256 t1 = block.timestamp + 7 days;
        vm.warp(t1);
        registry.executeRootExpiry(ROOT_1);

        // Fast forward 100 years
        vm.warp(t1 + 100 * 365 days);
        assertTrue(registry.isValidEngagementRoot(ROOT_1));
    }

    function test_RevertWhen_InitiateExpiry_PastTimestamp() public {
        vm.warp(30 days);

        vm.prank(governance);
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);

        uint64 pastTimestamp = uint64(block.timestamp - 1 days);

        vm.prank(governance);
        vm.expectRevert(EngagementRootRegistry.InvalidExpiry.selector);
        registry.initiateRootExpiry(ROOT_1, pastTimestamp);
    }

    function test_RevertWhen_InitiateExpiry_CurrentTimestamp() public {
        vm.prank(governance);
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);

        uint64 currentTimestamp = uint64(block.timestamp);

        vm.prank(governance);
        vm.expectRevert(EngagementRootRegistry.InvalidExpiry.selector);
        registry.initiateRootExpiry(ROOT_1, currentTimestamp);
    }

    function test_RevertWhen_ExecuteExpiry_WrongOperationType() public {
        vm.prank(governance);
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);

        vm.warp(block.timestamp + 7 days);
        vm.expectRevert(EngagementRootRegistry.NoOperationPending.selector);
        registry.executeRootExpiry(ROOT_1);
    }

    // ============ Root Reactivation Tests ============

    function test_CanReactivateDeactivatedRoot() public {
        uint256 startTime = 100 days;
        vm.warp(startTime);

        vm.prank(governance);
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);

        // Deactivate
        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);

        uint256 afterDeactivationTimelock = startTime + 7 days;
        vm.warp(afterDeactivationTimelock);
        registry.executeRootDeactivation(ROOT_1);
        assertFalse(registry.isValidEngagementRoot(ROOT_1));

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

        assertTrue(registry.isValidEngagementRoot(ROOT_1));
    }

    function test_RevertWhen_Reactivation_AlreadyActive() public {
        vm.prank(governance);
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);

        vm.prank(governance);
        vm.expectRevert(EngagementRootRegistry.RootAlreadyActive.selector);
        registry.initiateRootReactivation(ROOT_1);
    }

    function test_RevertWhen_Reactivation_NotRegistered() public {
        vm.prank(governance);
        vm.expectRevert(EngagementRootRegistry.RootNotRegistered.selector);
        registry.initiateRootReactivation(UNREGISTERED_ROOT);
    }

    // ============ Operation Cancellation Tests ============

    function test_CancelRootOperation_Deactivation() public {
        vm.prank(governance);
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);

        vm.prank(governance);
        vm.expectEmit(true, false, false, false);
        emit RootOperationCancelled(ROOT_1);
        registry.cancelRootOperation(ROOT_1);

        (uint8 opType, uint64 executeTime, ) = registry.pendingRootOperations(ROOT_1);
        assertEq(opType, 0);
        assertEq(executeTime, 0);
        assertTrue(registry.isValidEngagementRoot(ROOT_1));
    }

    function test_RevertWhen_CancelOperation_Unauthorized() public {
        vm.prank(governance);
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);

        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.cancelRootOperation(ROOT_1);
    }

    function test_RevertWhen_CancelOperation_NoPending() public {
        vm.prank(governance);
        vm.expectRevert(EngagementRootRegistry.NoOperationPending.selector);
        registry.cancelRootOperation(ROOT_1);
    }

    // ============ Governance Transfer Tests ============

    function test_GovernanceTransfer() public {
        vm.prank(governance);
        registry.initiateGovernanceTransfer(newGovernance);

        vm.warp(block.timestamp + 7 days);
        registry.executeGovernanceTransfer(newGovernance);

        assertEq(registry.governance(), newGovernance);

        // New governance can register roots
        vm.prank(newGovernance);
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);
        assertTrue(registry.isValidEngagementRoot(ROOT_1));

        // Old governance cannot
        vm.prank(governance);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.registerEngagementRoot(ROOT_2, DEPTH_20);
    }

    // ============ View Function Tests ============

    function test_GetDepth() public {
        vm.prank(governance);
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);

        assertEq(registry.getDepth(ROOT_1), DEPTH_20);
    }

    function test_GetDepth_Unregistered() public view {
        assertEq(registry.getDepth(UNREGISTERED_ROOT), 0);
    }

    function test_GetEngagementRootMetadata() public {
        vm.prank(governance);
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);

        EngagementRootRegistry.EngagementRootMetadata memory meta = registry.getEngagementRootMetadata(ROOT_1);
        assertEq(meta.depth, DEPTH_20);
        assertTrue(meta.isActive);
        assertGt(meta.registeredAt, 0);
        assertEq(meta.expiresAt, 0);
    }

    // ============ Scenario Tests ============

    function test_Scenario_SunsetGracePeriod() public {
        vm.prank(governance);
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);

        // Set expiry with grace period
        uint64 sunsetExpiry = uint64(block.timestamp + 7 days + 7 days + 1);
        vm.prank(governance);
        registry.initiateRootExpiry(ROOT_1, sunsetExpiry);

        // Wait for timelock
        vm.warp(block.timestamp + 7 days);
        registry.executeRootExpiry(ROOT_1);

        // Root is in SUNSET state - still valid for proving
        assertTrue(registry.isValidEngagementRoot(ROOT_1));

        // Register replacement root
        vm.prank(governance);
        registry.registerEngagementRoot(ROOT_2, DEPTH_20);
        assertTrue(registry.isValidEngagementRoot(ROOT_2));

        // Both roots valid during grace period
        vm.warp(sunsetExpiry - 1);
        assertTrue(registry.isValidEngagementRoot(ROOT_1));
        assertTrue(registry.isValidEngagementRoot(ROOT_2));

        // Old root expires
        vm.warp(sunsetExpiry + 1);
        assertFalse(registry.isValidEngagementRoot(ROOT_1));
        assertTrue(registry.isValidEngagementRoot(ROOT_2));
    }

    function test_Scenario_MultipleRootsIndependentLifecycles() public {
        vm.startPrank(governance);
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);
        registry.registerEngagementRoot(ROOT_2, 22);
        vm.stopPrank();

        // Deactivate root1
        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);
        vm.warp(block.timestamp + 7 days);
        registry.executeRootDeactivation(ROOT_1);

        assertFalse(registry.isValidEngagementRoot(ROOT_1));
        assertTrue(registry.isValidEngagementRoot(ROOT_2));
    }

    // ============ Fuzz Tests ============

    function testFuzz_RegisterEngagementRoot(bytes32 root) public {
        vm.prank(governance);
        registry.registerEngagementRoot(root, DEPTH_20);
        assertTrue(registry.isValidEngagementRoot(root));
    }

    function testFuzz_TimelockEnforcement(uint256 timeElapsed) public {
        vm.assume(timeElapsed < 7 days);

        vm.prank(governance);
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);

        vm.warp(block.timestamp + timeElapsed);

        vm.expectRevert(TimelockGovernance.TimelockNotExpired.selector);
        registry.executeRootDeactivation(ROOT_1);
    }

    function testFuzz_TimelockSuccess(uint256 timeElapsed) public {
        vm.assume(timeElapsed >= 7 days && timeElapsed < 365 days);

        vm.prank(governance);
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);

        vm.warp(block.timestamp + timeElapsed);

        registry.executeRootDeactivation(ROOT_1);
        assertFalse(registry.isValidEngagementRoot(ROOT_1));
    }

    function testFuzz_ExpiryTimestamp(uint64 futureTimestamp) public {
        vm.assume(futureTimestamp > block.timestamp);
        vm.assume(futureTimestamp < block.timestamp + 100 * 365 days);

        vm.prank(governance);
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootExpiry(ROOT_1, futureTimestamp);
        vm.warp(block.timestamp + 7 days);
        registry.executeRootExpiry(ROOT_1);

        vm.warp(futureTimestamp - 1);
        assertTrue(registry.isValidEngagementRoot(ROOT_1));

        vm.warp(futureTimestamp + 1);
        assertFalse(registry.isValidEngagementRoot(ROOT_1));
    }

    // ============ Edge Case Tests ============

    function test_EdgeCase_CannotInitiateMultipleOperationsSimultaneously() public {
        vm.prank(governance);
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);

        vm.prank(governance);
        vm.expectRevert(EngagementRootRegistry.OperationAlreadyPending.selector);
        registry.initiateRootExpiry(ROOT_1, uint64(block.timestamp + 30 days));
    }

    function test_EdgeCase_CanInitiateNewOperationAfterPreviousCompletes() public {
        vm.prank(governance);
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);

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

    function test_EdgeCase_NoCountryField() public {
        // EngagementRootRegistry has NO country field (unlike UserRootRegistry)
        // This is by design: engagement is not country-specific
        vm.prank(governance);
        registry.registerEngagementRoot(ROOT_1, DEPTH_20);

        EngagementRootRegistry.EngagementRootMetadata memory meta = registry.getEngagementRootMetadata(ROOT_1);
        assertEq(meta.depth, DEPTH_20);
        assertTrue(meta.isActive);
        // No country assertion needed - field doesn't exist
    }
}
