// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "forge-std/Test.sol";
import "../src/NullifierRegistry.sol";
import "../src/TimelockGovernance.sol";

/// @title NullifierRegistry Governance Tests
/// @notice Comprehensive tests for NullifierRegistry governance and timelock functionality
/// @dev Tests cover:
///      1. Governance Transfer Timelock (7-day)
///      2. Caller Authorization Timelock (7-day)
///      3. Caller Revocation Timelock (7-day)
///      4. Pause Controls (immediate)
///      5. Access Control (governance-only functions)
///      6. Edge Cases (double execute, cancelled proposals, etc.)
///
/// CRITICAL-001 FIX VERIFICATION:
/// These tests verify that the instant governance transfer vulnerability has been fixed.
/// All governance operations now require 7-day timelocks.
contract NullifierRegistryGovernanceTest is Test {
    NullifierRegistry public registry;

    address public governance = address(0x1);
    address public newGovernance = address(0x2);
    address public districtGate = address(0x3);
    address public maliciousCaller = address(0x4);
    address public user = address(0x5);
    address public attacker = address(0x6);

    bytes32 public actionId1 = keccak256("action-1");
    bytes32 public nullifier1 = keccak256("nullifier-1");
    bytes32 public merkleRoot = keccak256("merkle-root");

    uint256 public constant SEVEN_DAYS = 7 days;

    // Governance Transfer Events (from TimelockGovernance)
    event GovernanceTransferInitiated(address indexed newGovernance, uint256 executeTime);
    event GovernanceTransferred(address indexed previousGovernance, address indexed newGovernance);
    event GovernanceTransferCancelled(address indexed target);

    // Caller Authorization Events
    event CallerAuthorizationProposed(address indexed caller, uint256 executeTime);
    event CallerAuthorized(address indexed caller);
    event CallerAuthorizationCancelled(address indexed caller);

    // Caller Revocation Events
    event CallerRevocationProposed(address indexed caller, uint256 executeTime);
    event CallerRevoked(address indexed caller);
    event CallerRevocationCancelled(address indexed caller);

    function setUp() public {
        vm.prank(governance);
        registry = new NullifierRegistry(governance);
    }

    // ============================================================================
    // 1. GOVERNANCE TRANSFER TIMELOCK TESTS (CRITICAL-001 FIX)
    // ============================================================================

    /// @notice Verify governance transfer now requires 7-day timelock (not instant)
    function test_GovernanceTransfer_RequiresTimelock() public {
        uint256 expectedExecuteTime = block.timestamp + SEVEN_DAYS;

        vm.prank(governance);
        vm.expectEmit(true, false, false, true);
        emit GovernanceTransferInitiated(newGovernance, expectedExecuteTime);
        registry.initiateGovernanceTransfer(newGovernance);

        // Verify: Governance has NOT changed yet
        assertEq(registry.governance(), governance);

        // Verify: Pending state is set
        assertEq(registry.pendingGovernance(newGovernance), expectedExecuteTime);
    }

    /// @notice Verify governance transfer fails before timelock expires
    function test_RevertWhen_ExecuteGovernanceTransferBeforeTimelock() public {
        vm.prank(governance);
        registry.initiateGovernanceTransfer(newGovernance);

        // Try to execute immediately
        vm.expectRevert(TimelockGovernance.TimelockNotExpired.selector);
        registry.executeGovernanceTransfer(newGovernance);

        // Try to execute just before timelock expires
        vm.warp(block.timestamp + SEVEN_DAYS - 1);
        vm.expectRevert(TimelockGovernance.TimelockNotExpired.selector);
        registry.executeGovernanceTransfer(newGovernance);
    }

    /// @notice Verify governance transfer succeeds after timelock expires
    function test_ExecuteGovernanceTransfer_SucceedsAfterTimelock() public {
        vm.prank(governance);
        registry.initiateGovernanceTransfer(newGovernance);

        // Warp past timelock
        vm.warp(block.timestamp + SEVEN_DAYS);

        // Execute
        vm.expectEmit(true, true, false, false);
        emit GovernanceTransferred(governance, newGovernance);
        registry.executeGovernanceTransfer(newGovernance);

        // Verify: Governance is transferred
        assertEq(registry.governance(), newGovernance);

        // Verify: New governance is authorized caller
        assertTrue(registry.isAuthorized(newGovernance));

        // Verify: Old governance is no longer authorized
        assertFalse(registry.isAuthorized(governance));

        // Verify: Pending state is cleared
        assertEq(registry.pendingGovernance(newGovernance), 0);
    }

    /// @notice Verify anyone can execute governance transfer after timelock
    function test_AnyoneCanExecuteGovernanceTransfer_AfterTimelock() public {
        vm.prank(governance);
        registry.initiateGovernanceTransfer(newGovernance);

        vm.warp(block.timestamp + SEVEN_DAYS);

        // Execute as random user (not governance)
        vm.prank(attacker);
        registry.executeGovernanceTransfer(newGovernance);

        assertEq(registry.governance(), newGovernance);
    }

    /// @notice Verify governance transfer can be cancelled
    function test_CancelGovernanceTransfer() public {
        vm.prank(governance);
        registry.initiateGovernanceTransfer(newGovernance);

        vm.prank(governance);
        vm.expectEmit(true, false, false, false);
        emit GovernanceTransferCancelled(newGovernance);
        registry.cancelGovernanceTransfer(newGovernance);

        // Verify: Pending state is cleared
        assertEq(registry.pendingGovernance(newGovernance), 0);

        // Verify: Governance unchanged
        assertEq(registry.governance(), governance);
    }

    /// @notice Verify only governance can initiate transfer
    function test_RevertWhen_NonGovernanceInitiatesTransfer() public {
        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.initiateGovernanceTransfer(newGovernance);
    }

    /// @notice Verify only governance can cancel transfer
    function test_RevertWhen_NonGovernanceCancelsTransfer() public {
        vm.prank(governance);
        registry.initiateGovernanceTransfer(newGovernance);

        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.cancelGovernanceTransfer(newGovernance);
    }

    /// @notice Verify transfer to zero address fails
    function test_RevertWhen_TransferToZeroAddress() public {
        vm.prank(governance);
        vm.expectRevert(TimelockGovernance.ZeroAddress.selector);
        registry.initiateGovernanceTransfer(address(0));
    }

    /// @notice Verify transfer to same address fails
    function test_RevertWhen_TransferToSameAddress() public {
        vm.prank(governance);
        vm.expectRevert(TimelockGovernance.SameAddress.selector);
        registry.initiateGovernanceTransfer(governance);
    }

    /// @notice Verify getGovernanceTransferDelay works correctly
    function test_GetGovernanceTransferDelay() public {
        // Before initiation
        assertEq(registry.getGovernanceTransferDelay(newGovernance), 0);

        vm.prank(governance);
        registry.initiateGovernanceTransfer(newGovernance);

        // Immediately after initiation
        assertEq(registry.getGovernanceTransferDelay(newGovernance), SEVEN_DAYS);

        // After 3 days
        uint256 t1 = block.timestamp + 3 days;
        vm.warp(t1);
        assertEq(registry.getGovernanceTransferDelay(newGovernance), 4 days);

        // After timelock expires
        vm.warp(t1 + 5 days);
        assertEq(registry.getGovernanceTransferDelay(newGovernance), 0);
    }

    // ============================================================================
    // 2. CALLER AUTHORIZATION TIMELOCK TESTS
    // ============================================================================

    /// @notice Verify caller authorization requires 7-day timelock
    function test_CallerAuthorization_RequiresTimelock() public {
        uint256 expectedExecuteTime = block.timestamp + SEVEN_DAYS;

        vm.prank(governance);
        vm.expectEmit(true, false, false, true);
        emit CallerAuthorizationProposed(districtGate, expectedExecuteTime);
        registry.proposeCallerAuthorization(districtGate);

        // Verify: Caller is NOT authorized yet
        assertFalse(registry.isAuthorized(districtGate));

        // Verify: Pending state is set
        assertEq(registry.pendingCallerAuthorization(districtGate), expectedExecuteTime);
    }

    /// @notice Verify caller authorization fails before timelock expires
    function test_RevertWhen_ExecuteCallerAuthorizationBeforeTimelock() public {
        vm.prank(governance);
        registry.proposeCallerAuthorization(districtGate);

        // Try to execute immediately
        vm.expectRevert(NullifierRegistry.CallerAuthorizationTimelockNotExpired.selector);
        registry.executeCallerAuthorization(districtGate);

        // Try to execute just before timelock expires
        vm.warp(block.timestamp + SEVEN_DAYS - 1);
        vm.expectRevert(NullifierRegistry.CallerAuthorizationTimelockNotExpired.selector);
        registry.executeCallerAuthorization(districtGate);
    }

    /// @notice Verify caller authorization succeeds after timelock expires
    function test_ExecuteCallerAuthorization_SucceedsAfterTimelock() public {
        vm.prank(governance);
        registry.proposeCallerAuthorization(districtGate);

        vm.warp(block.timestamp + SEVEN_DAYS);

        vm.expectEmit(true, false, false, false);
        emit CallerAuthorized(districtGate);
        registry.executeCallerAuthorization(districtGate);

        // Verify: Caller is now authorized
        assertTrue(registry.isAuthorized(districtGate));

        // Verify: Pending state is cleared
        assertEq(registry.pendingCallerAuthorization(districtGate), 0);
    }

    /// @notice Verify anyone can execute caller authorization after timelock
    function test_AnyoneCanExecuteCallerAuthorization_AfterTimelock() public {
        vm.prank(governance);
        registry.proposeCallerAuthorization(districtGate);

        vm.warp(block.timestamp + SEVEN_DAYS);

        vm.prank(attacker);
        registry.executeCallerAuthorization(districtGate);

        assertTrue(registry.isAuthorized(districtGate));
    }

    /// @notice Verify caller authorization can be cancelled
    function test_CancelCallerAuthorization() public {
        vm.prank(governance);
        registry.proposeCallerAuthorization(districtGate);

        vm.prank(governance);
        vm.expectEmit(true, false, false, false);
        emit CallerAuthorizationCancelled(districtGate);
        registry.cancelCallerAuthorization(districtGate);

        // Verify: Pending state is cleared
        assertEq(registry.pendingCallerAuthorization(districtGate), 0);

        // Verify: Caller still not authorized
        assertFalse(registry.isAuthorized(districtGate));
    }

    /// @notice Verify only governance can propose caller authorization
    function test_RevertWhen_NonGovernanceProposesCallerAuthorization() public {
        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.proposeCallerAuthorization(districtGate);
    }

    /// @notice Verify only governance can cancel caller authorization
    function test_RevertWhen_NonGovernanceCancelsCallerAuthorization() public {
        vm.prank(governance);
        registry.proposeCallerAuthorization(districtGate);

        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.cancelCallerAuthorization(districtGate);
    }

    /// @notice Verify authorization of zero address fails
    function test_RevertWhen_AuthorizeZeroAddress() public {
        vm.prank(governance);
        vm.expectRevert(TimelockGovernance.ZeroAddress.selector);
        registry.proposeCallerAuthorization(address(0));
    }

    /// @notice Verify authorization of already authorized caller fails
    function test_RevertWhen_AuthorizeAlreadyAuthorizedCaller() public {
        // Governance is already authorized
        vm.prank(governance);
        vm.expectRevert(NullifierRegistry.CallerAlreadyAuthorized.selector);
        registry.proposeCallerAuthorization(governance);
    }

    /// @notice Verify getCallerAuthorizationDelay works correctly
    function test_GetCallerAuthorizationDelay() public {
        // Before proposal
        assertEq(registry.getCallerAuthorizationDelay(districtGate), 0);

        vm.prank(governance);
        registry.proposeCallerAuthorization(districtGate);

        // Immediately after proposal
        assertEq(registry.getCallerAuthorizationDelay(districtGate), SEVEN_DAYS);

        // After 3 days
        uint256 t1 = block.timestamp + 3 days;
        vm.warp(t1);
        assertEq(registry.getCallerAuthorizationDelay(districtGate), 4 days);

        // After timelock expires
        vm.warp(t1 + 5 days);
        assertEq(registry.getCallerAuthorizationDelay(districtGate), 0);
    }

    // ============================================================================
    // 3. CALLER REVOCATION TIMELOCK TESTS
    // ============================================================================

    /// @notice Verify caller revocation requires 7-day timelock
    function test_CallerRevocation_RequiresTimelock() public {
        // First authorize a caller
        _authorizeCallerWithTimelock(districtGate);

        uint256 expectedExecuteTime = block.timestamp + SEVEN_DAYS;

        vm.prank(governance);
        vm.expectEmit(true, false, false, true);
        emit CallerRevocationProposed(districtGate, expectedExecuteTime);
        registry.proposeCallerRevocation(districtGate);

        // Verify: Caller is still authorized
        assertTrue(registry.isAuthorized(districtGate));

        // Verify: Pending state is set
        assertEq(registry.pendingCallerRevocation(districtGate), expectedExecuteTime);
    }

    /// @notice Verify caller revocation fails before timelock expires
    function test_RevertWhen_ExecuteCallerRevocationBeforeTimelock() public {
        _authorizeCallerWithTimelock(districtGate);

        vm.prank(governance);
        registry.proposeCallerRevocation(districtGate);

        // Try to execute immediately
        vm.expectRevert(NullifierRegistry.CallerRevocationTimelockNotExpired.selector);
        registry.executeCallerRevocation(districtGate);

        // Try to execute just before timelock expires
        vm.warp(_lastWarpTime + SEVEN_DAYS - 1);
        vm.expectRevert(NullifierRegistry.CallerRevocationTimelockNotExpired.selector);
        registry.executeCallerRevocation(districtGate);
    }

    /// @notice Verify caller revocation succeeds after timelock expires
    function test_ExecuteCallerRevocation_SucceedsAfterTimelock() public {
        _authorizeCallerWithTimelock(districtGate);

        vm.prank(governance);
        registry.proposeCallerRevocation(districtGate);

        vm.warp(block.timestamp + SEVEN_DAYS);

        vm.expectEmit(true, false, false, false);
        emit CallerRevoked(districtGate);
        registry.executeCallerRevocation(districtGate);

        // Verify: Caller is no longer authorized
        assertFalse(registry.isAuthorized(districtGate));

        // Verify: Pending state is cleared
        assertEq(registry.pendingCallerRevocation(districtGate), 0);
    }

    /// @notice Verify anyone can execute caller revocation after timelock
    function test_AnyoneCanExecuteCallerRevocation_AfterTimelock() public {
        _authorizeCallerWithTimelock(districtGate);

        vm.prank(governance);
        registry.proposeCallerRevocation(districtGate);

        vm.warp(block.timestamp + SEVEN_DAYS);

        vm.prank(attacker);
        registry.executeCallerRevocation(districtGate);

        assertFalse(registry.isAuthorized(districtGate));
    }

    /// @notice Verify caller revocation can be cancelled
    function test_CancelCallerRevocation() public {
        _authorizeCallerWithTimelock(districtGate);

        vm.prank(governance);
        registry.proposeCallerRevocation(districtGate);

        vm.prank(governance);
        vm.expectEmit(true, false, false, false);
        emit CallerRevocationCancelled(districtGate);
        registry.cancelCallerRevocation(districtGate);

        // Verify: Pending state is cleared
        assertEq(registry.pendingCallerRevocation(districtGate), 0);

        // Verify: Caller still authorized
        assertTrue(registry.isAuthorized(districtGate));
    }

    /// @notice Verify only governance can propose caller revocation
    function test_RevertWhen_NonGovernanceProposesCallerRevocation() public {
        _authorizeCallerWithTimelock(districtGate);

        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.proposeCallerRevocation(districtGate);
    }

    /// @notice Verify only governance can cancel caller revocation
    function test_RevertWhen_NonGovernanceCancelsCallerRevocation() public {
        _authorizeCallerWithTimelock(districtGate);

        vm.prank(governance);
        registry.proposeCallerRevocation(districtGate);

        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.cancelCallerRevocation(districtGate);
    }

    /// @notice Verify revocation of non-authorized caller fails
    function test_RevertWhen_RevokeNonAuthorizedCaller() public {
        vm.prank(governance);
        vm.expectRevert(NullifierRegistry.CallerNotAuthorized.selector);
        registry.proposeCallerRevocation(districtGate);
    }

    /// @notice Verify getCallerRevocationDelay works correctly
    function test_GetCallerRevocationDelay() public {
        _authorizeCallerWithTimelock(districtGate);

        // Before proposal
        assertEq(registry.getCallerRevocationDelay(districtGate), 0);

        vm.prank(governance);
        registry.proposeCallerRevocation(districtGate);

        // Immediately after proposal
        assertEq(registry.getCallerRevocationDelay(districtGate), SEVEN_DAYS);

        // After 3 days
        uint256 t1 = _lastWarpTime + 3 days;
        vm.warp(t1);
        assertEq(registry.getCallerRevocationDelay(districtGate), 4 days);

        // After timelock expires
        vm.warp(t1 + 5 days);
        assertEq(registry.getCallerRevocationDelay(districtGate), 0);
    }

    // ============================================================================
    // 4. PAUSE CONTROLS TESTS (immediate - no timelock)
    // ============================================================================

    /// @notice Verify pause is immediate (no timelock)
    function test_Pause_IsImmediate() public {
        vm.prank(governance);
        registry.pause();

        assertTrue(registry.paused());
    }

    /// @notice Verify unpause is immediate (no timelock)
    function test_Unpause_IsImmediate() public {
        vm.prank(governance);
        registry.pause();

        vm.prank(governance);
        registry.unpause();

        assertFalse(registry.paused());
    }

    /// @notice Verify only governance can pause
    function test_RevertWhen_NonGovernancePauses() public {
        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.pause();
    }

    /// @notice Verify only governance can unpause
    function test_RevertWhen_NonGovernanceUnpauses() public {
        vm.prank(governance);
        registry.pause();

        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.unpause();
    }

    /// @notice Verify recordNullifier reverts when paused
    function test_RevertWhen_RecordNullifierWhenPaused() public {
        _authorizeCallerWithTimelock(districtGate);

        vm.prank(governance);
        registry.pause();

        vm.prank(districtGate);
        vm.expectRevert("Pausable: paused");
        registry.recordNullifier(actionId1, nullifier1, merkleRoot);
    }

    /// @notice Verify pausing twice reverts
    function test_RevertWhen_PauseTwice() public {
        vm.prank(governance);
        registry.pause();

        vm.prank(governance);
        vm.expectRevert("Pausable: paused");
        registry.pause();
    }

    /// @notice Verify unpausing when not paused reverts
    function test_RevertWhen_UnpauseWhenNotPaused() public {
        vm.prank(governance);
        vm.expectRevert("Pausable: not paused");
        registry.unpause();
    }

    // ============================================================================
    // 5. ACCESS CONTROL TESTS
    // ============================================================================

    /// @notice Verify governance is authorized at deployment
    function test_GovernanceIsAuthorizedAtDeployment() public view {
        assertTrue(registry.isAuthorized(governance));
    }

    /// @notice Verify non-governance cannot call governance-only functions
    function test_AccessControl_NonGovernanceCannotCallGovernanceFunctions() public {
        // Test proposeCallerAuthorization
        vm.prank(user);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.proposeCallerAuthorization(districtGate);

        // Test cancelCallerAuthorization (need pending first)
        vm.prank(governance);
        registry.proposeCallerAuthorization(districtGate);
        vm.prank(user);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.cancelCallerAuthorization(districtGate);
        vm.prank(governance);
        registry.cancelCallerAuthorization(districtGate);

        // Test proposeCallerRevocation
        vm.prank(user);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.proposeCallerRevocation(governance);

        // Test pause
        vm.prank(user);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.pause();

        // Test initiateGovernanceTransfer
        vm.prank(user);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.initiateGovernanceTransfer(newGovernance);
    }

    /// @notice Verify unauthorized caller cannot record nullifiers
    function test_RevertWhen_UnauthorizedCallerRecordsNullifier() public {
        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.recordNullifier(actionId1, nullifier1, merkleRoot);
    }

    // ============================================================================
    // 6. EDGE CASES
    // ============================================================================

    /// @notice Execute non-existent governance transfer fails
    function test_RevertWhen_ExecuteNonExistentGovernanceTransfer() public {
        vm.expectRevert(TimelockGovernance.TransferNotInitiated.selector);
        registry.executeGovernanceTransfer(newGovernance);
    }

    /// @notice Cancel non-existent governance transfer fails
    function test_RevertWhen_CancelNonExistentGovernanceTransfer() public {
        vm.prank(governance);
        vm.expectRevert(TimelockGovernance.TransferNotInitiated.selector);
        registry.cancelGovernanceTransfer(newGovernance);
    }

    /// @notice Double execute governance transfer fails
    function test_RevertWhen_DoubleExecuteGovernanceTransfer() public {
        vm.prank(governance);
        registry.initiateGovernanceTransfer(newGovernance);
        vm.warp(block.timestamp + SEVEN_DAYS);

        registry.executeGovernanceTransfer(newGovernance);

        vm.expectRevert(TimelockGovernance.TransferNotInitiated.selector);
        registry.executeGovernanceTransfer(newGovernance);
    }

    /// @notice Execute after cancelled governance transfer fails
    function test_RevertWhen_ExecuteAfterCancelledGovernanceTransfer() public {
        vm.prank(governance);
        registry.initiateGovernanceTransfer(newGovernance);

        vm.prank(governance);
        registry.cancelGovernanceTransfer(newGovernance);

        vm.warp(block.timestamp + SEVEN_DAYS);

        vm.expectRevert(TimelockGovernance.TransferNotInitiated.selector);
        registry.executeGovernanceTransfer(newGovernance);
    }

    /// @notice Execute non-existent caller authorization fails
    function test_RevertWhen_ExecuteNonExistentCallerAuthorization() public {
        vm.expectRevert(NullifierRegistry.CallerAuthorizationNotPending.selector);
        registry.executeCallerAuthorization(districtGate);
    }

    /// @notice Cancel non-existent caller authorization fails
    function test_RevertWhen_CancelNonExistentCallerAuthorization() public {
        vm.prank(governance);
        vm.expectRevert(NullifierRegistry.CallerAuthorizationNotPending.selector);
        registry.cancelCallerAuthorization(districtGate);
    }

    /// @notice Double execute caller authorization fails
    function test_RevertWhen_DoubleExecuteCallerAuthorization() public {
        vm.prank(governance);
        registry.proposeCallerAuthorization(districtGate);
        vm.warp(block.timestamp + SEVEN_DAYS);

        registry.executeCallerAuthorization(districtGate);

        vm.expectRevert(NullifierRegistry.CallerAuthorizationNotPending.selector);
        registry.executeCallerAuthorization(districtGate);
    }

    /// @notice Execute non-existent caller revocation fails
    function test_RevertWhen_ExecuteNonExistentCallerRevocation() public {
        vm.expectRevert(NullifierRegistry.CallerRevocationNotPending.selector);
        registry.executeCallerRevocation(districtGate);
    }

    /// @notice Cancel non-existent caller revocation fails
    function test_RevertWhen_CancelNonExistentCallerRevocation() public {
        vm.prank(governance);
        vm.expectRevert(NullifierRegistry.CallerRevocationNotPending.selector);
        registry.cancelCallerRevocation(districtGate);
    }

    /// @notice Multiple callers can have pending authorizations simultaneously
    function test_MultipleCallersCanHavePendingAuthorizationsSimultaneously() public {
        address caller1 = address(0x100);
        address caller2 = address(0x200);

        vm.startPrank(governance);
        registry.proposeCallerAuthorization(caller1);
        registry.proposeCallerAuthorization(caller2);
        vm.stopPrank();

        // Verify: Both are pending
        assertGt(registry.pendingCallerAuthorization(caller1), 0);
        assertGt(registry.pendingCallerAuthorization(caller2), 0);

        vm.warp(block.timestamp + SEVEN_DAYS);

        // Execute both
        registry.executeCallerAuthorization(caller1);
        registry.executeCallerAuthorization(caller2);

        // Verify: Both are authorized
        assertTrue(registry.isAuthorized(caller1));
        assertTrue(registry.isAuthorized(caller2));
    }

    /// @notice Authorized caller can record nullifiers
    function test_AuthorizedCallerCanRecordNullifiers() public {
        _authorizeCallerWithTimelock(districtGate);

        vm.prank(districtGate);
        registry.recordNullifier(actionId1, nullifier1, merkleRoot);

        assertTrue(registry.isNullifierUsed(actionId1, nullifier1));
    }

    /// @notice New governance can use all governance functions after transfer
    function test_NewGovernanceHasFullAuthority() public {
        vm.prank(governance);
        registry.initiateGovernanceTransfer(newGovernance);
        vm.warp(block.timestamp + SEVEN_DAYS);
        registry.executeGovernanceTransfer(newGovernance);

        // New governance can propose caller authorization
        vm.prank(newGovernance);
        registry.proposeCallerAuthorization(districtGate);

        assertGt(registry.pendingCallerAuthorization(districtGate), 0);

        // New governance can pause
        vm.prank(newGovernance);
        registry.pause();

        assertTrue(registry.paused());
    }

    /// @notice Old governance loses all authority after transfer
    function test_OldGovernanceLosesAuthority() public {
        vm.prank(governance);
        registry.initiateGovernanceTransfer(newGovernance);
        vm.warp(block.timestamp + SEVEN_DAYS);
        registry.executeGovernanceTransfer(newGovernance);

        // Old governance cannot propose caller authorization
        vm.prank(governance);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.proposeCallerAuthorization(districtGate);

        // Old governance cannot pause
        vm.prank(governance);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.pause();

        // Old governance cannot record nullifiers (no longer authorized caller)
        vm.prank(governance);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.recordNullifier(actionId1, nullifier1, merkleRoot);
    }

    /// @notice Timelock constants are 7 days
    function test_TimelockConstants_Are7Days() public view {
        assertEq(registry.GOVERNANCE_TIMELOCK(), 7 days);
        assertEq(registry.CALLER_AUTHORIZATION_TIMELOCK(), 7 days);
    }

    /// @notice Replacing pending authorization resets timelock
    function test_ReplacingPendingAuthorizationResetsTimelock() public {
        vm.prank(governance);
        registry.proposeCallerAuthorization(districtGate);

        uint256 firstExecuteTime = registry.pendingCallerAuthorization(districtGate);

        // Cancel and re-propose after 3 days
        vm.warp(block.timestamp + 3 days);

        vm.prank(governance);
        registry.cancelCallerAuthorization(districtGate);

        vm.prank(governance);
        registry.proposeCallerAuthorization(districtGate);

        // New execute time should be 7 days from now, not 4 days
        assertGt(registry.pendingCallerAuthorization(districtGate), firstExecuteTime);
    }

    // ============================================================================
    // 7. ATTACK SCENARIO TESTS (CRITICAL-001 Prevention)
    // ============================================================================

    /// @notice Verify attack scenario from CRITICAL-001 is now blocked
    /// @dev Original attack:
    ///      1. Attacker compromises governance key
    ///      2. Calls transferGovernance(attackerAddress) - INSTANT
    ///      3. Calls authorizeCaller(maliciousContract) - INSTANT
    ///      4. Malicious contract pre-registers nullifiers
    ///      5. Election compromised with ZERO response time
    function test_CriticalAttackScenarioBlocked() public {
        // Simulate attacker compromising governance key
        address attackerGovernance = address(0xBAD);

        // Step 1: Attacker tries to transfer governance instantly - BLOCKED
        vm.prank(governance);
        registry.initiateGovernanceTransfer(attackerGovernance);

        // Attacker cannot execute for 7 days
        vm.prank(attackerGovernance);
        vm.expectRevert(TimelockGovernance.TimelockNotExpired.selector);
        registry.executeGovernanceTransfer(attackerGovernance);

        // Even if they wait 3 days, still blocked
        vm.warp(block.timestamp + 3 days);
        vm.expectRevert(TimelockGovernance.TimelockNotExpired.selector);
        registry.executeGovernanceTransfer(attackerGovernance);

        // Community has 7 days to detect and cancel the malicious transfer!
    }

    /// @notice Verify malicious caller authorization is blocked
    function test_MaliciousCallerAuthorizationBlocked() public {
        // Attacker gains control of governance and tries to authorize malicious contract
        vm.prank(governance);
        registry.proposeCallerAuthorization(maliciousCaller);

        // Malicious caller cannot record nullifiers yet
        vm.prank(maliciousCaller);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.recordNullifier(actionId1, nullifier1, merkleRoot);

        // Even after 6 days, still blocked
        vm.warp(block.timestamp + 6 days);
        vm.prank(maliciousCaller);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.recordNullifier(actionId1, nullifier1, merkleRoot);

        // Community has 7 days to cancel the malicious authorization!
    }

    /// @notice HIGH-001 FIX: Verify proposal overwrite attack is blocked
    /// @dev Attacker with temporary governance cannot reset timelock by re-proposing
    function test_ProposalOverwriteAttackBlocked() public {
        // Legitimate governance proposes authorizing districtGate
        vm.prank(governance);
        registry.proposeCallerAuthorization(districtGate);

        uint256 originalExecuteTime = registry.pendingCallerAuthorization(districtGate);

        // Fast forward 6 days - almost at execution time
        vm.warp(block.timestamp + 6 days);

        // Attacker who gained temporary governance access tries to reset the timelock
        // by calling proposeCallerAuthorization again
        vm.prank(governance);
        vm.expectRevert(NullifierRegistry.CallerAuthorizationAlreadyPending.selector);
        registry.proposeCallerAuthorization(districtGate);

        // Execute time should remain unchanged
        assertEq(registry.pendingCallerAuthorization(districtGate), originalExecuteTime);
    }

    /// @notice HIGH-001 FIX: Verify revocation proposal overwrite is blocked
    function test_RevocationOverwriteAttackBlocked() public {
        // First authorize districtGate through timelock
        _authorizeCallerWithTimelock(districtGate);

        // Legitimate governance proposes revoking districtGate
        vm.prank(governance);
        registry.proposeCallerRevocation(districtGate);

        uint256 originalExecuteTime = registry.pendingCallerRevocation(districtGate);

        // Fast forward 6 days
        vm.warp(_lastWarpTime + 6 days);

        // Attacker tries to reset the revocation timelock
        vm.prank(governance);
        vm.expectRevert(NullifierRegistry.CallerRevocationAlreadyPending.selector);
        registry.proposeCallerRevocation(districtGate);

        // Execute time should remain unchanged
        assertEq(registry.pendingCallerRevocation(districtGate), originalExecuteTime);
    }

    // ============================================================================
    // Helper Functions
    // ============================================================================

    uint256 internal _lastWarpTime;

    /// @notice Helper to authorize a caller through the full timelock process
    function _authorizeCallerWithTimelock(address caller) internal {
        vm.prank(governance);
        registry.proposeCallerAuthorization(caller);
        _lastWarpTime = block.timestamp + SEVEN_DAYS;
        vm.warp(_lastWarpTime);
        registry.executeCallerAuthorization(caller);
    }
}
