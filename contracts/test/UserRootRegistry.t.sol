// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "forge-std/Test.sol";
import "../src/UserRootRegistry.sol";
import "../src/TimelockGovernance.sol";

/// @title UserRootRegistry Tests
/// @notice Comprehensive tests for Tree 1 (User Identity) root lifecycle management
contract UserRootRegistryTest is Test {
    UserRootRegistry public registry;

    address public governance = address(0x1);
    address public newGovernance = address(0x2);
    address public attacker = address(0x3);
    address public user = address(0x4);

    bytes32 public constant ROOT_1 = keccak256("USER_ROOT_1");
    bytes32 public constant ROOT_2 = keccak256("USER_ROOT_2");
    bytes32 public constant UNREGISTERED_ROOT = keccak256("UNREGISTERED");
    bytes3 public constant USA = "USA";
    bytes3 public constant GBR = "GBR";
    uint8 public constant DEPTH_20 = 20;

    event UserRootRegistered(bytes32 indexed root, bytes3 indexed country, uint8 depth, uint256 timestamp);
    event RootOperationInitiated(bytes32 indexed root, uint8 operationType, uint256 executeTime);
    event RootDeactivated(bytes32 indexed root);
    event RootExpirySet(bytes32 indexed root, uint64 expiresAt);
    event RootReactivated(bytes32 indexed root);
    event RootOperationCancelled(bytes32 indexed root);
    event GovernanceTransferInitiated(address indexed newGovernance, uint256 executeTime);
    event GovernanceTransferred(address indexed previousGovernance, address indexed newGovernance);

    function setUp() public {
        registry = new UserRootRegistry(governance);
    }

    // ============ Constructor Tests ============

    function test_Constructor() public view {
        assertEq(registry.governance(), governance);
        assertEq(registry.GOVERNANCE_TIMELOCK(), 7 days);
        assertEq(registry.SUNSET_GRACE_PERIOD(), 30 days);
    }

    function test_RevertWhen_ConstructorZeroAddress() public {
        vm.expectRevert(TimelockGovernance.ZeroAddress.selector);
        new UserRootRegistry(address(0));
    }

    // ============ Root Registration Tests ============

    function test_RegisterUserRoot() public {
        vm.prank(governance);
        vm.expectEmit(true, true, false, true);
        emit UserRootRegistered(ROOT_1, USA, DEPTH_20, block.timestamp);

        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);

        UserRootRegistry.UserRootMetadata memory meta = registry.getUserRootMetadata(ROOT_1);
        assertEq(meta.country, USA);
        assertEq(meta.depth, DEPTH_20);
        assertTrue(meta.isActive);
        assertEq(meta.registeredAt, uint32(block.timestamp));
        assertEq(meta.expiresAt, 0);
    }

    function test_RegisterUserRoot_MultipleSupportedDepths() public {
        bytes32 root18 = keccak256("ROOT_18");
        bytes32 root20 = keccak256("ROOT_20");
        bytes32 root22 = keccak256("ROOT_22");
        bytes32 root24 = keccak256("ROOT_24");

        vm.startPrank(governance);
        registry.registerUserRoot(root18, USA, 18);
        registry.registerUserRoot(root20, USA, 20);
        registry.registerUserRoot(root22, USA, 22);
        registry.registerUserRoot(root24, USA, 24);
        vm.stopPrank();

        assertEq(registry.getUserRootMetadata(root18).depth, 18);
        assertEq(registry.getUserRootMetadata(root20).depth, 20);
        assertEq(registry.getUserRootMetadata(root22).depth, 22);
        assertEq(registry.getUserRootMetadata(root24).depth, 24);
    }

    function test_RevertWhen_RegisterUserRootUnauthorized() public {
        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);
    }

    function test_RevertWhen_RegisterUserRootDuplicate() public {
        vm.startPrank(governance);
        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);
        vm.expectRevert(UserRootRegistry.RootAlreadyRegistered.selector);
        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);
        vm.stopPrank();
    }

    function test_RevertWhen_RegisterUserRootInvalidCountry() public {
        vm.prank(governance);
        vm.expectRevert(UserRootRegistry.InvalidCountryCode.selector);
        registry.registerUserRoot(ROOT_1, bytes3(0), DEPTH_20);
    }

    function test_RevertWhen_RegisterUserRootInvalidDepth_TooLow() public {
        vm.prank(governance);
        vm.expectRevert(UserRootRegistry.InvalidDepth.selector);
        registry.registerUserRoot(ROOT_1, USA, 16);
    }

    function test_RevertWhen_RegisterUserRootInvalidDepth_TooHigh() public {
        vm.prank(governance);
        vm.expectRevert(UserRootRegistry.InvalidDepth.selector);
        registry.registerUserRoot(ROOT_1, USA, 26);
    }

    function test_RevertWhen_RegisterUserRootInvalidDepth_Odd() public {
        vm.prank(governance);
        vm.expectRevert(UserRootRegistry.InvalidDepth.selector);
        registry.registerUserRoot(ROOT_1, USA, 19);
    }

    // ============ isValidUserRoot Tests ============

    function test_isValidUserRoot_Active() public {
        vm.prank(governance);
        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);
        assertTrue(registry.isValidUserRoot(ROOT_1));
    }

    function test_isValidUserRoot_Unregistered() public view {
        assertFalse(registry.isValidUserRoot(UNREGISTERED_ROOT));
    }

    function test_isValidUserRoot_Deactivated() public {
        vm.prank(governance);
        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);
        vm.warp(block.timestamp + 7 days);
        registry.executeRootDeactivation(ROOT_1);

        assertFalse(registry.isValidUserRoot(ROOT_1));
    }

    function test_isValidUserRoot_Expired() public {
        vm.prank(governance);
        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);

        uint64 expiry = uint64(block.timestamp + 30 days);
        vm.prank(governance);
        registry.initiateRootExpiry(ROOT_1, expiry);
        vm.warp(block.timestamp + 7 days);
        registry.executeRootExpiry(ROOT_1);

        // Before expiry
        assertTrue(registry.isValidUserRoot(ROOT_1));

        // After expiry
        vm.warp(expiry + 1);
        assertFalse(registry.isValidUserRoot(ROOT_1));
    }

    function test_isValidUserRoot_AtExactExpiryTime() public {
        vm.prank(governance);
        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);

        uint64 expiry = uint64(block.timestamp + 30 days);
        vm.prank(governance);
        registry.initiateRootExpiry(ROOT_1, expiry);
        vm.warp(block.timestamp + 7 days);
        registry.executeRootExpiry(ROOT_1);

        // At exact expiry time - still valid (uses > not >=)
        vm.warp(expiry);
        assertTrue(registry.isValidUserRoot(ROOT_1));

        // One second after - invalid
        vm.warp(expiry + 1);
        assertFalse(registry.isValidUserRoot(ROOT_1));
    }

    // ============ Root Deactivation Tests ============

    function test_InitiateRootDeactivation() public {
        vm.prank(governance);
        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);

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
        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);

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

        UserRootRegistry.UserRootMetadata memory meta = registry.getUserRootMetadata(ROOT_1);
        assertFalse(meta.isActive);
    }

    function test_AnyoneCanExecuteDeactivation() public {
        vm.prank(governance);
        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);

        vm.warp(block.timestamp + 7 days);

        vm.prank(user);
        registry.executeRootDeactivation(ROOT_1);

        assertFalse(registry.isValidUserRoot(ROOT_1));
    }

    function test_RevertWhen_InitiateDeactivation_Unauthorized() public {
        vm.prank(governance);
        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);

        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.initiateRootDeactivation(ROOT_1);
    }

    function test_RevertWhen_InitiateDeactivation_NotRegistered() public {
        vm.prank(governance);
        vm.expectRevert(UserRootRegistry.RootNotRegistered.selector);
        registry.initiateRootDeactivation(UNREGISTERED_ROOT);
    }

    function test_RevertWhen_InitiateDeactivation_AlreadyInactive() public {
        vm.prank(governance);
        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);
        vm.warp(block.timestamp + 7 days);
        registry.executeRootDeactivation(ROOT_1);

        vm.prank(governance);
        vm.expectRevert(UserRootRegistry.RootAlreadyInactive.selector);
        registry.initiateRootDeactivation(ROOT_1);
    }

    function test_RevertWhen_InitiateDeactivation_OperationPending() public {
        vm.prank(governance);
        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);

        vm.prank(governance);
        vm.expectRevert(UserRootRegistry.OperationAlreadyPending.selector);
        registry.initiateRootDeactivation(ROOT_1);
    }

    function test_RevertWhen_ExecuteDeactivation_NoOperation() public {
        vm.prank(governance);
        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);

        vm.expectRevert(UserRootRegistry.NoOperationPending.selector);
        registry.executeRootDeactivation(ROOT_1);
    }

    // ============ Root Expiry Tests ============

    function test_InitiateAndExecuteRootExpiry() public {
        vm.prank(governance);
        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);

        uint64 expiryTimestamp = uint64(block.timestamp + 30 days);

        vm.prank(governance);
        registry.initiateRootExpiry(ROOT_1, expiryTimestamp);

        (uint8 opType, uint64 executeTime, uint64 newExpiresAt) = registry.pendingRootOperations(ROOT_1);
        assertEq(opType, 2);
        assertEq(newExpiresAt, expiryTimestamp);

        vm.warp(block.timestamp + 7 days);

        vm.expectEmit(true, false, false, true);
        emit RootExpirySet(ROOT_1, expiryTimestamp);
        registry.executeRootExpiry(ROOT_1);

        UserRootRegistry.UserRootMetadata memory meta = registry.getUserRootMetadata(ROOT_1);
        assertEq(meta.expiresAt, expiryTimestamp);
    }

    function test_ExpiresAt0MeansNeverExpires() public {
        vm.prank(governance);
        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootExpiry(ROOT_1, 0);
        uint256 t1 = block.timestamp + 7 days;
        vm.warp(t1);
        registry.executeRootExpiry(ROOT_1);

        // Fast forward 100 years
        vm.warp(t1 + 100 * 365 days);
        assertTrue(registry.isValidUserRoot(ROOT_1));
    }

    function test_RevertWhen_InitiateExpiry_PastTimestamp() public {
        vm.warp(30 days);

        vm.prank(governance);
        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);

        uint64 pastTimestamp = uint64(block.timestamp - 1 days);

        vm.prank(governance);
        vm.expectRevert(UserRootRegistry.InvalidExpiry.selector);
        registry.initiateRootExpiry(ROOT_1, pastTimestamp);
    }

    function test_RevertWhen_InitiateExpiry_CurrentTimestamp() public {
        vm.prank(governance);
        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);

        uint64 currentTimestamp = uint64(block.timestamp);

        vm.prank(governance);
        vm.expectRevert(UserRootRegistry.InvalidExpiry.selector);
        registry.initiateRootExpiry(ROOT_1, currentTimestamp);
    }

    function test_RevertWhen_ExecuteExpiry_WrongOperationType() public {
        vm.prank(governance);
        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);

        vm.warp(block.timestamp + 7 days);
        vm.expectRevert(UserRootRegistry.NoOperationPending.selector);
        registry.executeRootExpiry(ROOT_1);
    }

    // ============ Root Reactivation Tests ============

    function test_CanReactivateDeactivatedRoot() public {
        uint256 startTime = 100 days;
        vm.warp(startTime);

        vm.prank(governance);
        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);

        // Deactivate
        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);

        uint256 afterDeactivationTimelock = startTime + 7 days;
        vm.warp(afterDeactivationTimelock);
        registry.executeRootDeactivation(ROOT_1);
        assertFalse(registry.isValidUserRoot(ROOT_1));

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

        assertTrue(registry.isValidUserRoot(ROOT_1));
    }

    function test_RevertWhen_Reactivation_AlreadyActive() public {
        vm.prank(governance);
        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);

        vm.prank(governance);
        vm.expectRevert(UserRootRegistry.RootAlreadyActive.selector);
        registry.initiateRootReactivation(ROOT_1);
    }

    function test_RevertWhen_Reactivation_NotRegistered() public {
        vm.prank(governance);
        vm.expectRevert(UserRootRegistry.RootNotRegistered.selector);
        registry.initiateRootReactivation(UNREGISTERED_ROOT);
    }

    // ============ Operation Cancellation Tests ============

    function test_CancelRootOperation_Deactivation() public {
        vm.prank(governance);
        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);

        vm.prank(governance);
        vm.expectEmit(true, false, false, false);
        emit RootOperationCancelled(ROOT_1);
        registry.cancelRootOperation(ROOT_1);

        (uint8 opType, uint64 executeTime, ) = registry.pendingRootOperations(ROOT_1);
        assertEq(opType, 0);
        assertEq(executeTime, 0);
        assertTrue(registry.isValidUserRoot(ROOT_1));
    }

    function test_RevertWhen_CancelOperation_Unauthorized() public {
        vm.prank(governance);
        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);

        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.cancelRootOperation(ROOT_1);
    }

    function test_RevertWhen_CancelOperation_NoPending() public {
        vm.prank(governance);
        vm.expectRevert(UserRootRegistry.NoOperationPending.selector);
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
        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);
        assertTrue(registry.isValidUserRoot(ROOT_1));

        // Old governance cannot
        vm.prank(governance);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.registerUserRoot(ROOT_2, GBR, DEPTH_20);
    }

    // ============ setUserRootExpiry Tests ============

    function test_setUserRootExpiry() public {
        vm.prank(governance);
        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);

        uint64 expiresAt = uint64(block.timestamp + 30 days);
        vm.prank(governance);
        registry.setUserRootExpiry(ROOT_1, expiresAt);

        (uint8 opType, , uint64 newExpiresAt) = registry.pendingRootOperations(ROOT_1);
        assertEq(opType, 2);
        assertEq(newExpiresAt, expiresAt);
    }

    // ============ View Function Tests ============

    function test_GetCountryAndDepth() public {
        vm.prank(governance);
        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);

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

    function test_Scenario_SunsetGracePeriod() public {
        // Register a root
        vm.prank(governance);
        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);

        // Set expiry with 30-day grace period (SUNSET state)
        uint64 sunsetExpiry = uint64(block.timestamp + 30 days);
        vm.prank(governance);
        registry.initiateRootExpiry(ROOT_1, sunsetExpiry);

        // Wait for timelock
        vm.warp(block.timestamp + 7 days);
        registry.executeRootExpiry(ROOT_1);

        // Root is in SUNSET state - still valid for proving
        assertTrue(registry.isValidUserRoot(ROOT_1));

        // Register replacement root
        vm.prank(governance);
        registry.registerUserRoot(ROOT_2, USA, DEPTH_20);
        assertTrue(registry.isValidUserRoot(ROOT_2));

        // Both roots valid during grace period
        vm.warp(sunsetExpiry - 1 days);
        assertTrue(registry.isValidUserRoot(ROOT_1));
        assertTrue(registry.isValidUserRoot(ROOT_2));

        // Old root expires
        vm.warp(sunsetExpiry + 1);
        assertFalse(registry.isValidUserRoot(ROOT_1));
        assertTrue(registry.isValidUserRoot(ROOT_2));
    }

    function test_Scenario_MultipleRootsIndependentLifecycles() public {
        vm.startPrank(governance);
        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);
        registry.registerUserRoot(ROOT_2, GBR, DEPTH_20);
        vm.stopPrank();

        // Deactivate root1
        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);
        vm.warp(block.timestamp + 7 days);
        registry.executeRootDeactivation(ROOT_1);

        assertFalse(registry.isValidUserRoot(ROOT_1));
        assertTrue(registry.isValidUserRoot(ROOT_2));
    }

    // ============ Fuzz Tests ============

    function testFuzz_RegisterUserRoot(bytes32 root, bytes3 country) public {
        vm.assume(country != bytes3(0));

        vm.prank(governance);
        registry.registerUserRoot(root, country, DEPTH_20);

        assertTrue(registry.isValidUserRoot(root));
    }

    function testFuzz_TimelockEnforcement(uint256 timeElapsed) public {
        vm.assume(timeElapsed < 7 days);

        vm.prank(governance);
        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);

        vm.warp(block.timestamp + timeElapsed);

        vm.expectRevert(TimelockGovernance.TimelockNotExpired.selector);
        registry.executeRootDeactivation(ROOT_1);
    }

    function testFuzz_TimelockSuccess(uint256 timeElapsed) public {
        vm.assume(timeElapsed >= 7 days && timeElapsed < 365 days);

        vm.prank(governance);
        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);

        vm.warp(block.timestamp + timeElapsed);

        registry.executeRootDeactivation(ROOT_1);
        assertFalse(registry.isValidUserRoot(ROOT_1));
    }

    function testFuzz_ExpiryTimestamp(uint64 futureTimestamp) public {
        vm.assume(futureTimestamp > block.timestamp);
        vm.assume(futureTimestamp < block.timestamp + 100 * 365 days);

        vm.prank(governance);
        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootExpiry(ROOT_1, futureTimestamp);
        vm.warp(block.timestamp + 7 days);
        registry.executeRootExpiry(ROOT_1);

        vm.warp(futureTimestamp - 1);
        assertTrue(registry.isValidUserRoot(ROOT_1));

        vm.warp(futureTimestamp + 1);
        assertFalse(registry.isValidUserRoot(ROOT_1));
    }

    // ============ Edge Case Tests ============

    function test_EdgeCase_CannotInitiateMultipleOperationsSimultaneously() public {
        vm.prank(governance);
        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);

        vm.prank(governance);
        registry.initiateRootDeactivation(ROOT_1);

        vm.prank(governance);
        vm.expectRevert(UserRootRegistry.OperationAlreadyPending.selector);
        registry.initiateRootExpiry(ROOT_1, uint64(block.timestamp + 30 days));
    }

    function test_EdgeCase_CanInitiateNewOperationAfterPreviousCompletes() public {
        vm.prank(governance);
        registry.registerUserRoot(ROOT_1, USA, DEPTH_20);

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
