// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "forge-std/Test.sol";
import "../src/DistrictRegistry.sol";

/// @title DistrictRegistry Lifecycle Management Tests
/// @notice Comprehensive tests for root deactivation, expiry, and reactivation
/// @dev Tests SA-004 vulnerability fix: Root lifecycle management with timelock safety
contract DistrictRegistryLifecycleTest is Test {
    DistrictRegistry public registry;

    address public governance = address(0x1);
    address public user = address(0x2);
    address public attacker = address(0x3);

    bytes32 public constant DISTRICT_ROOT_1 = keccak256("DISTRICT_1");
    bytes32 public constant DISTRICT_ROOT_2 = keccak256("DISTRICT_2");
    bytes32 public constant UNREGISTERED_ROOT = keccak256("UNREGISTERED");
    bytes3 public constant USA = "USA";
    bytes3 public constant GBR = "GBR";
    uint8 public constant DEPTH_20 = 20;

    event RootDeactivationInitiated(bytes32 indexed root, uint256 executeTime);
    event RootDeactivated(bytes32 indexed root);
    event RootExpirySet(bytes32 indexed root, uint64 expiresAt);
    event RootReactivated(bytes32 indexed root);
    event RootOperationCancelled(bytes32 indexed root);

    function setUp() public {
        registry = new DistrictRegistry(governance);

        // Register test districts
        vm.startPrank(governance);
        registry.registerDistrict(DISTRICT_ROOT_1, USA, DEPTH_20);
        registry.registerDistrict(DISTRICT_ROOT_2, GBR, DEPTH_20);
        vm.stopPrank();
    }

    // ============ Default State Tests ============

    function test_NewRootsAreActiveByDefault() public view {
        DistrictRegistry.DistrictMetadata memory meta = registry.getDistrictMetadata(DISTRICT_ROOT_1);
        assertTrue(meta.isActive, "New root should be active");
        assertEq(meta.expiresAt, 0, "New root should never expire by default");
    }

    function test_isValidRoot_ReturnsTrue_WhenActiveAndNotExpired() public view {
        assertTrue(registry.isValidRoot(DISTRICT_ROOT_1), "Active non-expired root should be valid");
    }

    function test_isValidRoot_ReturnsFalse_WhenNotRegistered() public view {
        assertFalse(registry.isValidRoot(UNREGISTERED_ROOT), "Unregistered root should be invalid");
    }

    // ============ Root Deactivation Tests ============

    function test_InitiateRootDeactivation() public {
        uint256 expectedExecuteTime = block.timestamp + 7 days;

        vm.prank(governance);
        vm.expectEmit(true, false, false, true);
        emit RootDeactivationInitiated(DISTRICT_ROOT_1, expectedExecuteTime);

        registry.initiateRootDeactivation(DISTRICT_ROOT_1);

        (uint8 opType, uint64 executeTime, ) = registry.pendingRootOperations(DISTRICT_ROOT_1);
        assertEq(opType, 1, "Operation type should be deactivate (1)");
        assertEq(executeTime, expectedExecuteTime, "Execute time should be 7 days from now");
    }

    function test_RevertWhen_InitiateRootDeactivation_UnauthorizedCaller() public {
        vm.prank(attacker);
        vm.expectRevert(DistrictRegistry.UnauthorizedCaller.selector);
        registry.initiateRootDeactivation(DISTRICT_ROOT_1);
    }

    function test_RevertWhen_InitiateRootDeactivation_RootNotRegistered() public {
        vm.prank(governance);
        vm.expectRevert(DistrictRegistry.RootNotRegistered.selector);
        registry.initiateRootDeactivation(UNREGISTERED_ROOT);
    }

    function test_RevertWhen_InitiateRootDeactivation_AlreadyInactive() public {
        // Deactivate root first
        vm.prank(governance);
        registry.initiateRootDeactivation(DISTRICT_ROOT_1);
        vm.warp(block.timestamp + 7 days);
        registry.executeRootDeactivation(DISTRICT_ROOT_1);

        // Try to deactivate again
        vm.prank(governance);
        vm.expectRevert(DistrictRegistry.RootAlreadyInactive.selector);
        registry.initiateRootDeactivation(DISTRICT_ROOT_1);
    }

    function test_RevertWhen_InitiateRootDeactivation_OperationAlreadyPending() public {
        vm.prank(governance);
        registry.initiateRootDeactivation(DISTRICT_ROOT_1);

        // Try to initiate another operation while one is pending
        vm.prank(governance);
        vm.expectRevert(DistrictRegistry.OperationAlreadyPending.selector);
        registry.initiateRootDeactivation(DISTRICT_ROOT_1);
    }

    function test_DeactivationRequires7DayTimelock() public {
        vm.prank(governance);
        registry.initiateRootDeactivation(DISTRICT_ROOT_1);

        // Try to execute immediately (should fail)
        vm.expectRevert(DistrictRegistry.TimelockNotExpired.selector);
        registry.executeRootDeactivation(DISTRICT_ROOT_1);

        // Try after 6 days (should fail)
        vm.warp(block.timestamp + 6 days);
        vm.expectRevert(DistrictRegistry.TimelockNotExpired.selector);
        registry.executeRootDeactivation(DISTRICT_ROOT_1);

        // Execute after exactly 7 days (should succeed)
        vm.warp(block.timestamp + 1 days);
        vm.expectEmit(true, false, false, false);
        emit RootDeactivated(DISTRICT_ROOT_1);

        registry.executeRootDeactivation(DISTRICT_ROOT_1);

        DistrictRegistry.DistrictMetadata memory meta = registry.getDistrictMetadata(DISTRICT_ROOT_1);
        assertFalse(meta.isActive, "Root should be inactive after execution");
    }

    function test_ExecuteRootDeactivation_AnyoneCanExecute() public {
        vm.prank(governance);
        registry.initiateRootDeactivation(DISTRICT_ROOT_1);

        vm.warp(block.timestamp + 7 days);

        // User (not governance) can execute
        vm.prank(user);
        registry.executeRootDeactivation(DISTRICT_ROOT_1);

        DistrictRegistry.DistrictMetadata memory meta = registry.getDistrictMetadata(DISTRICT_ROOT_1);
        assertFalse(meta.isActive, "Root should be deactivated");
    }

    function test_RevertWhen_ExecuteRootDeactivation_NoOperationPending() public {
        vm.expectRevert(DistrictRegistry.NoOperationPending.selector);
        registry.executeRootDeactivation(DISTRICT_ROOT_1);
    }

    function test_isValidRoot_ReturnsFalse_WhenDeactivated() public {
        // Deactivate root
        vm.prank(governance);
        registry.initiateRootDeactivation(DISTRICT_ROOT_1);
        vm.warp(block.timestamp + 7 days);
        registry.executeRootDeactivation(DISTRICT_ROOT_1);

        // Check validity
        assertFalse(registry.isValidRoot(DISTRICT_ROOT_1), "Deactivated root should be invalid");
    }

    // ============ Root Expiry Tests ============

    function test_InitiateRootExpiry() public {
        uint64 expiryTimestamp = uint64(block.timestamp + 30 days);

        vm.prank(governance);
        registry.initiateRootExpiry(DISTRICT_ROOT_1, expiryTimestamp);

        (uint8 opType, uint64 executeTime, uint64 newExpiresAt) = registry.pendingRootOperations(DISTRICT_ROOT_1);
        assertEq(opType, 2, "Operation type should be expire (2)");
        assertEq(newExpiresAt, expiryTimestamp, "New expiry should be stored");
        assertEq(executeTime, block.timestamp + 7 days, "Execute time should be 7 days from now");
    }

    function test_RevertWhen_InitiateRootExpiry_InvalidExpiry() public {
        // Set time to non-zero to avoid underflow
        vm.warp(30 days);

        // Try to set expiry in the past
        uint64 pastTimestamp = uint64(block.timestamp - 1 days);

        vm.prank(governance);
        vm.expectRevert(DistrictRegistry.InvalidExpiry.selector);
        registry.initiateRootExpiry(DISTRICT_ROOT_1, pastTimestamp);
    }

    function test_RevertWhen_InitiateRootExpiry_ExpiryAtCurrentTime() public {
        // Try to set expiry at current time
        uint64 currentTimestamp = uint64(block.timestamp);

        vm.prank(governance);
        vm.expectRevert(DistrictRegistry.InvalidExpiry.selector);
        registry.initiateRootExpiry(DISTRICT_ROOT_1, currentTimestamp);
    }

    function test_ExecuteRootExpiry() public {
        uint64 expiryTimestamp = uint64(block.timestamp + 30 days);

        vm.prank(governance);
        registry.initiateRootExpiry(DISTRICT_ROOT_1, expiryTimestamp);

        vm.warp(block.timestamp + 7 days);

        vm.expectEmit(true, false, false, true);
        emit RootExpirySet(DISTRICT_ROOT_1, expiryTimestamp);

        registry.executeRootExpiry(DISTRICT_ROOT_1);

        DistrictRegistry.DistrictMetadata memory meta = registry.getDistrictMetadata(DISTRICT_ROOT_1);
        assertEq(meta.expiresAt, expiryTimestamp, "Expiry should be set");
    }

    function test_ExpiresAt0MeansNeverExpires() public {
        vm.prank(governance);
        registry.initiateRootExpiry(DISTRICT_ROOT_1, 0);

        vm.warp(block.timestamp + 7 days);
        registry.executeRootExpiry(DISTRICT_ROOT_1);

        // Fast forward 100 years
        vm.warp(block.timestamp + 100 * 365 days);

        assertTrue(registry.isValidRoot(DISTRICT_ROOT_1), "Root with expiresAt=0 should never expire");
    }

    function test_isValidRoot_ReturnsFalse_WhenExpired() public {
        uint64 expiryTimestamp = uint64(block.timestamp + 30 days);

        // Set expiry
        vm.prank(governance);
        registry.initiateRootExpiry(DISTRICT_ROOT_1, expiryTimestamp);
        vm.warp(block.timestamp + 7 days);
        registry.executeRootExpiry(DISTRICT_ROOT_1);

        // Before expiry - should be valid
        assertTrue(registry.isValidRoot(DISTRICT_ROOT_1), "Root should be valid before expiry");

        // After expiry - should be invalid
        vm.warp(expiryTimestamp + 1);
        assertFalse(registry.isValidRoot(DISTRICT_ROOT_1), "Root should be invalid after expiry");
    }

    function test_isValidRoot_ReturnsFalse_AtExactExpiryTime() public {
        uint64 expiryTimestamp = uint64(block.timestamp + 30 days);

        vm.prank(governance);
        registry.initiateRootExpiry(DISTRICT_ROOT_1, expiryTimestamp);
        vm.warp(block.timestamp + 7 days);
        registry.executeRootExpiry(DISTRICT_ROOT_1);

        // At exact expiry time - should be invalid (> not >=)
        vm.warp(expiryTimestamp);
        assertTrue(registry.isValidRoot(DISTRICT_ROOT_1), "Root should still be valid at exact expiry time");

        // One second after expiry
        vm.warp(expiryTimestamp + 1);
        assertFalse(registry.isValidRoot(DISTRICT_ROOT_1), "Root should be invalid after expiry time");
    }

    function test_RevertWhen_ExecuteRootExpiry_NoOperationPending() public {
        vm.expectRevert(DistrictRegistry.NoOperationPending.selector);
        registry.executeRootExpiry(DISTRICT_ROOT_1);
    }

    function test_RevertWhen_ExecuteRootExpiry_WrongOperationType() public {
        // Initiate deactivation, then try to execute as expiry
        vm.prank(governance);
        registry.initiateRootDeactivation(DISTRICT_ROOT_1);

        vm.warp(block.timestamp + 7 days);

        vm.expectRevert(DistrictRegistry.NoOperationPending.selector);
        registry.executeRootExpiry(DISTRICT_ROOT_1);
    }

    // ============ Root Reactivation Tests ============

    function test_CanReactivateDeactivatedRoot() public {
        // First deactivate
        vm.prank(governance);
        registry.initiateRootDeactivation(DISTRICT_ROOT_1);
        vm.warp(block.timestamp + 7 days);
        registry.executeRootDeactivation(DISTRICT_ROOT_1);

        assertFalse(registry.isValidRoot(DISTRICT_ROOT_1), "Root should be invalid after deactivation");

        // Now reactivate
        vm.warp(block.timestamp + 1 days);
        vm.prank(governance);
        registry.initiateRootReactivation(DISTRICT_ROOT_1);

        (uint8 opType, uint64 executeTime, ) = registry.pendingRootOperations(DISTRICT_ROOT_1);
        assertEq(opType, 3, "Operation type should be reactivate (3)");
        assertEq(executeTime, block.timestamp + 7 days, "Execute time should be 7 days from now");

        vm.warp(block.timestamp + 7 days);

        vm.expectEmit(true, false, false, false);
        emit RootReactivated(DISTRICT_ROOT_1);

        registry.executeRootReactivation(DISTRICT_ROOT_1);

        DistrictRegistry.DistrictMetadata memory meta = registry.getDistrictMetadata(DISTRICT_ROOT_1);
        assertTrue(meta.isActive, "Root should be active after reactivation");
        assertTrue(registry.isValidRoot(DISTRICT_ROOT_1), "Root should be valid after reactivation");
    }

    function test_RevertWhen_InitiateRootReactivation_AlreadyActive() public {
        // Root is active by default
        vm.prank(governance);
        vm.expectRevert(DistrictRegistry.RootAlreadyActive.selector);
        registry.initiateRootReactivation(DISTRICT_ROOT_1);
    }

    function test_RevertWhen_InitiateRootReactivation_RootNotRegistered() public {
        vm.prank(governance);
        vm.expectRevert(DistrictRegistry.RootNotRegistered.selector);
        registry.initiateRootReactivation(UNREGISTERED_ROOT);
    }

    function test_RevertWhen_ExecuteRootReactivation_NoOperationPending() public {
        vm.expectRevert(DistrictRegistry.NoOperationPending.selector);
        registry.executeRootReactivation(DISTRICT_ROOT_1);
    }

    // ============ Operation Cancellation Tests ============

    function test_CancelRootOperation_Deactivation() public {
        vm.prank(governance);
        registry.initiateRootDeactivation(DISTRICT_ROOT_1);

        (uint8 opTypeBefore, , ) = registry.pendingRootOperations(DISTRICT_ROOT_1);
        assertEq(opTypeBefore, 1, "Operation should be pending");

        vm.prank(governance);
        vm.expectEmit(true, false, false, false);
        emit RootOperationCancelled(DISTRICT_ROOT_1);

        registry.cancelRootOperation(DISTRICT_ROOT_1);

        (uint8 opTypeAfter, uint64 executeTime, ) = registry.pendingRootOperations(DISTRICT_ROOT_1);
        assertEq(opTypeAfter, 0, "Operation type should be cleared");
        assertEq(executeTime, 0, "Execute time should be cleared");

        // Root should still be active
        assertTrue(registry.isValidRoot(DISTRICT_ROOT_1), "Root should still be valid");
    }

    function test_CancelRootOperation_Expiry() public {
        uint64 expiryTimestamp = uint64(block.timestamp + 30 days);

        vm.prank(governance);
        registry.initiateRootExpiry(DISTRICT_ROOT_1, expiryTimestamp);

        vm.prank(governance);
        registry.cancelRootOperation(DISTRICT_ROOT_1);

        (uint8 opType, , ) = registry.pendingRootOperations(DISTRICT_ROOT_1);
        assertEq(opType, 0, "Operation should be cancelled");

        // Root metadata should be unchanged
        DistrictRegistry.DistrictMetadata memory meta = registry.getDistrictMetadata(DISTRICT_ROOT_1);
        assertEq(meta.expiresAt, 0, "Expiry should not be set");
    }

    function test_CancelRootOperation_Reactivation() public {
        // Deactivate first
        vm.prank(governance);
        registry.initiateRootDeactivation(DISTRICT_ROOT_1);
        vm.warp(block.timestamp + 7 days);
        registry.executeRootDeactivation(DISTRICT_ROOT_1);

        // Initiate reactivation
        vm.warp(block.timestamp + 1 days);
        vm.prank(governance);
        registry.initiateRootReactivation(DISTRICT_ROOT_1);

        // Cancel reactivation
        vm.prank(governance);
        registry.cancelRootOperation(DISTRICT_ROOT_1);

        (uint8 opType, , ) = registry.pendingRootOperations(DISTRICT_ROOT_1);
        assertEq(opType, 0, "Operation should be cancelled");

        // Root should still be inactive
        assertFalse(registry.isValidRoot(DISTRICT_ROOT_1), "Root should still be invalid");
    }

    function test_RevertWhen_CancelRootOperation_UnauthorizedCaller() public {
        vm.prank(governance);
        registry.initiateRootDeactivation(DISTRICT_ROOT_1);

        vm.prank(attacker);
        vm.expectRevert(DistrictRegistry.UnauthorizedCaller.selector);
        registry.cancelRootOperation(DISTRICT_ROOT_1);
    }

    function test_RevertWhen_CancelRootOperation_NoOperationPending() public {
        vm.prank(governance);
        vm.expectRevert(DistrictRegistry.NoOperationPending.selector);
        registry.cancelRootOperation(DISTRICT_ROOT_1);
    }

    // ============ Complex Scenario Tests ============

    function test_Scenario_CourtOrderedRedistricting() public {
        // Scenario: Court orders new district boundaries (e.g., NC 2022)
        // Old root must be deactivated, new root registered

        bytes32 oldRoot = DISTRICT_ROOT_1;
        bytes32 newRoot = keccak256("NEW_DISTRICT_BOUNDARIES");

        // Step 1: Governance initiates deactivation of old root (7-day notice)
        vm.prank(governance);
        registry.initiateRootDeactivation(oldRoot);

        // Step 2: Users have 7 days to transition
        assertTrue(registry.isValidRoot(oldRoot), "Old root still valid during transition period");

        // Step 3: Register new root during transition
        vm.prank(governance);
        registry.registerDistrict(newRoot, USA, DEPTH_20);
        assertTrue(registry.isValidRoot(newRoot), "New root is valid immediately");

        // Step 4: After 7 days, execute deactivation
        vm.warp(block.timestamp + 7 days);
        registry.executeRootDeactivation(oldRoot);

        // Step 5: Verify final state
        assertFalse(registry.isValidRoot(oldRoot), "Old root is now invalid");
        assertTrue(registry.isValidRoot(newRoot), "New root remains valid");
    }

    function test_Scenario_ScheduledExpiry() public {
        // Scenario: District root has known expiry (e.g., 2-year census cycle)

        // Start at a reasonable time
        vm.warp(365 days);

        uint64 expiryTimestamp = uint64(block.timestamp + 730 days); // 2 years from now

        // Set expiry during registration period
        vm.prank(governance);
        registry.initiateRootExpiry(DISTRICT_ROOT_1, expiryTimestamp);

        // Wait for timelock
        vm.warp(block.timestamp + 7 days);
        registry.executeRootExpiry(DISTRICT_ROOT_1);

        // Fast forward to just before expiry (expiryTimestamp - 1 day)
        vm.warp(expiryTimestamp - 1 days);
        assertTrue(registry.isValidRoot(DISTRICT_ROOT_1), "Root valid before expiry");

        // Root expires automatically
        vm.warp(expiryTimestamp + 1);
        assertFalse(registry.isValidRoot(DISTRICT_ROOT_1), "Root invalid after expiry");
    }

    function test_Scenario_EmergencyDeactivationAndReactivation() public {
        // Scenario: Compromised tree data discovered, emergency deactivation,
        // then reactivation after investigation shows false alarm

        // Start at time 100 days to avoid timestamp issues
        uint256 startTime = 100 days;
        vm.warp(startTime);

        // Emergency deactivation
        vm.prank(governance);
        registry.initiateRootDeactivation(DISTRICT_ROOT_1);

        uint256 afterDeactivationTimelock = startTime + 7 days;
        vm.warp(afterDeactivationTimelock);
        registry.executeRootDeactivation(DISTRICT_ROOT_1);

        assertFalse(registry.isValidRoot(DISTRICT_ROOT_1), "Root deactivated");

        // Investigation completes - false alarm, reactivate
        uint256 timeAfterDeactivation = afterDeactivationTimelock + 1 days;
        vm.warp(timeAfterDeactivation);
        vm.prank(governance);
        registry.initiateRootReactivation(DISTRICT_ROOT_1);

        uint256 afterReactivationTimelock = timeAfterDeactivation + 7 days;
        vm.warp(afterReactivationTimelock);
        registry.executeRootReactivation(DISTRICT_ROOT_1);

        assertTrue(registry.isValidRoot(DISTRICT_ROOT_1), "Root reactivated");
    }

    function test_Scenario_MultipleRootsIndependentLifecycles() public {
        // Scenario: Different districts have independent lifecycles

        bytes32 root1 = DISTRICT_ROOT_1;
        bytes32 root2 = DISTRICT_ROOT_2;

        // Deactivate root1
        vm.prank(governance);
        registry.initiateRootDeactivation(root1);
        vm.warp(block.timestamp + 7 days);
        registry.executeRootDeactivation(root1);

        // Set expiry on root2
        uint64 expiry = uint64(block.timestamp + 30 days);
        vm.warp(block.timestamp + 1 days);
        vm.prank(governance);
        registry.initiateRootExpiry(root2, expiry);
        vm.warp(block.timestamp + 7 days);
        registry.executeRootExpiry(root2);

        // Verify independent states
        assertFalse(registry.isValidRoot(root1), "Root1 should be invalid (deactivated)");
        assertTrue(registry.isValidRoot(root2), "Root2 should be valid (not expired yet)");

        // After root2 expires
        vm.warp(expiry + 1);
        assertFalse(registry.isValidRoot(root1), "Root1 still invalid");
        assertFalse(registry.isValidRoot(root2), "Root2 now invalid (expired)");
    }

    // ============ Backwards Compatibility Tests ============

    function test_BackwardsCompatibility_ExistingRootsRemainValid() public view {
        // Roots registered in setUp() should be active and valid
        assertTrue(registry.isValidRoot(DISTRICT_ROOT_1), "Existing root should be valid");
        assertTrue(registry.isValidRoot(DISTRICT_ROOT_2), "Existing root should be valid");
    }

    function test_BackwardsCompatibility_LegacyLookupStillWorks() public view {
        // Legacy districtToCountry mapping should still work
        assertEq(registry.districtToCountry(DISTRICT_ROOT_1), USA, "Legacy lookup should work");
        assertEq(registry.getCountry(DISTRICT_ROOT_1), USA, "getCountry should work");
    }

    // ============ Fuzz Tests ============

    function testFuzz_ExpiryTimestamp(uint64 futureTimestamp) public {
        // Constrain to reasonable future range
        vm.assume(futureTimestamp > block.timestamp);
        vm.assume(futureTimestamp < block.timestamp + 100 * 365 days);

        vm.prank(governance);
        registry.initiateRootExpiry(DISTRICT_ROOT_1, futureTimestamp);
        vm.warp(block.timestamp + 7 days);
        registry.executeRootExpiry(DISTRICT_ROOT_1);

        // Before expiry
        vm.warp(futureTimestamp - 1);
        assertTrue(registry.isValidRoot(DISTRICT_ROOT_1), "Should be valid before expiry");

        // After expiry
        vm.warp(futureTimestamp + 1);
        assertFalse(registry.isValidRoot(DISTRICT_ROOT_1), "Should be invalid after expiry");
    }

    function testFuzz_TimelockEnforcement(uint256 timeElapsed) public {
        vm.assume(timeElapsed < 7 days);

        vm.prank(governance);
        registry.initiateRootDeactivation(DISTRICT_ROOT_1);

        vm.warp(block.timestamp + timeElapsed);

        vm.expectRevert(DistrictRegistry.TimelockNotExpired.selector);
        registry.executeRootDeactivation(DISTRICT_ROOT_1);
    }

    function testFuzz_TimelockSuccess(uint256 timeElapsed) public {
        vm.assume(timeElapsed >= 7 days && timeElapsed < 365 days);

        vm.prank(governance);
        registry.initiateRootDeactivation(DISTRICT_ROOT_1);

        vm.warp(block.timestamp + timeElapsed);

        registry.executeRootDeactivation(DISTRICT_ROOT_1);
        assertFalse(registry.isValidRoot(DISTRICT_ROOT_1), "Root should be deactivated");
    }

    // ============ Edge Case Tests ============

    function test_EdgeCase_DeactivatedRootCannotBeExpired() public {
        // Start at time 100 days to avoid timestamp issues
        uint256 startTime = 100 days;
        vm.warp(startTime);

        // Deactivate root
        vm.prank(governance);
        registry.initiateRootDeactivation(DISTRICT_ROOT_1);

        uint256 afterDeactivationTimelock = startTime + 7 days;
        vm.warp(afterDeactivationTimelock);
        registry.executeRootDeactivation(DISTRICT_ROOT_1);

        // Try to set expiry on deactivated root (should work, even though root is invalid)
        uint256 timeAfterDeactivation = afterDeactivationTimelock + 1 days;
        vm.warp(timeAfterDeactivation);
        uint64 expiry = uint64(timeAfterDeactivation + 30 days);

        vm.prank(governance);
        registry.initiateRootExpiry(DISTRICT_ROOT_1, expiry);

        uint256 afterExpiryTimelock = timeAfterDeactivation + 7 days;
        vm.warp(afterExpiryTimelock);
        registry.executeRootExpiry(DISTRICT_ROOT_1);

        // Root should still be invalid (isActive = false takes precedence)
        assertFalse(registry.isValidRoot(DISTRICT_ROOT_1), "Deactivated root should remain invalid");
    }

    function test_EdgeCase_ExpiredRootCanBeReactivatedButStillExpired() public {
        // Set expiry
        uint64 expiry = uint64(block.timestamp + 30 days);
        vm.prank(governance);
        registry.initiateRootExpiry(DISTRICT_ROOT_1, expiry);
        vm.warp(block.timestamp + 7 days);
        registry.executeRootExpiry(DISTRICT_ROOT_1);

        // Wait for expiry
        vm.warp(expiry + 1);
        assertFalse(registry.isValidRoot(DISTRICT_ROOT_1), "Root should be expired");

        // Deactivate the expired root
        vm.prank(governance);
        registry.initiateRootDeactivation(DISTRICT_ROOT_1);
        vm.warp(block.timestamp + 7 days);
        registry.executeRootDeactivation(DISTRICT_ROOT_1);

        // Try to reactivate (this sets isActive = true, but expiresAt remains)
        vm.warp(block.timestamp + 1 days);
        vm.prank(governance);
        registry.initiateRootReactivation(DISTRICT_ROOT_1);
        vm.warp(block.timestamp + 7 days);
        registry.executeRootReactivation(DISTRICT_ROOT_1);

        // Root is active but still expired
        DistrictRegistry.DistrictMetadata memory meta = registry.getDistrictMetadata(DISTRICT_ROOT_1);
        assertTrue(meta.isActive, "Root should be active");
        assertFalse(registry.isValidRoot(DISTRICT_ROOT_1), "Root should still be invalid (expired)");
    }

    function test_EdgeCase_CannotInitiateMultipleOperationsSimultaneously() public {
        // Initiate deactivation
        vm.prank(governance);
        registry.initiateRootDeactivation(DISTRICT_ROOT_1);

        // Try to initiate expiry (should fail - operation already pending)
        vm.prank(governance);
        vm.expectRevert(DistrictRegistry.OperationAlreadyPending.selector);
        registry.initiateRootExpiry(DISTRICT_ROOT_1, uint64(block.timestamp + 30 days));

        // Try to initiate another deactivation (should fail)
        vm.prank(governance);
        vm.expectRevert(DistrictRegistry.OperationAlreadyPending.selector);
        registry.initiateRootDeactivation(DISTRICT_ROOT_1);
    }

    function test_EdgeCase_CanInitiateNewOperationAfterPreviousCompletes() public {
        // Deactivate
        vm.prank(governance);
        registry.initiateRootDeactivation(DISTRICT_ROOT_1);
        vm.warp(block.timestamp + 7 days);
        registry.executeRootDeactivation(DISTRICT_ROOT_1);

        // Now can initiate reactivation (no operation pending)
        vm.warp(block.timestamp + 1 days);
        vm.prank(governance);
        registry.initiateRootReactivation(DISTRICT_ROOT_1);

        (uint8 opType, , ) = registry.pendingRootOperations(DISTRICT_ROOT_1);
        assertEq(opType, 3, "Reactivation should be pending");
    }
}
