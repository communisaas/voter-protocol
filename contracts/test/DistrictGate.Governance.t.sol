// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "forge-std/Test.sol";
import "../src/DistrictGate.sol";
import "../src/DistrictRegistry.sol";
import "../src/NullifierRegistry.sol";

/// @title DistrictGate Governance Tests
/// @notice Tests the governance timelock mechanism for DistrictGate
/// @dev Validates CRITICAL #1 fix from adversarial security analysis
contract DistrictGateGovernanceTest is Test {
    DistrictGate public gate;
    DistrictRegistry public registry;
    NullifierRegistry public nullifierRegistry;
    address public verifier;

    address public governance = address(0x1);
    address public newGovernance = address(0x2);
    address public attacker = address(0x3);

    event GovernanceTransferInitiated(address indexed newGovernance, uint256 executeTime);
    event GovernanceTransferred(address indexed previousGovernance, address indexed newGovernance);
    event GovernanceTransferCancelled(address indexed newGovernance);

    function setUp() public {
        // Deploy mock verifier
        verifier = address(new MockVerifier());

        // Deploy registries
        registry = new DistrictRegistry(governance);
        nullifierRegistry = new NullifierRegistry(governance);

        // Create guardian array (min 2 required)
        address[] memory guardians = new address[](2);
        guardians[0] = address(0x100);
        guardians[1] = address(0x101);

        // Deploy gate
        gate = new DistrictGate(verifier, address(registry), address(nullifierRegistry), governance, guardians);

        // Authorize gate as caller
        vm.prank(governance);
        nullifierRegistry.authorizeCaller(address(gate));
    }

    // ============ Constructor Tests ============

    function test_Constructor() public view {
        assertEq(gate.governance(), governance);
        assertEq(gate.GOVERNANCE_TIMELOCK(), 7 days);
    }

    function test_RevertWhen_ConstructorZeroGovernance() public {
        address[] memory guardians = new address[](2);
        guardians[0] = address(0x100);
        guardians[1] = address(0x101);
        vm.expectRevert(DistrictGate.ZeroAddress.selector);
        new DistrictGate(verifier, address(registry), address(nullifierRegistry), address(0), guardians);
    }

    // ============ Governance Timelock Tests ============

    function test_InitiateGovernanceTransfer() public {
        uint256 expectedExecuteTime = block.timestamp + 7 days;

        vm.prank(governance);
        vm.expectEmit(true, false, false, true);
        emit GovernanceTransferInitiated(newGovernance, expectedExecuteTime);

        gate.initiateGovernanceTransfer(newGovernance);

        assertEq(gate.pendingGovernance(newGovernance), expectedExecuteTime);
    }

    function test_RevertWhen_InitiateGovernanceTransferUnauthorized() public {
        vm.prank(attacker);
        vm.expectRevert(DistrictGate.UnauthorizedCaller.selector);
        gate.initiateGovernanceTransfer(newGovernance);
    }

    function test_RevertWhen_InitiateGovernanceTransferZeroAddress() public {
        vm.prank(governance);
        vm.expectRevert(DistrictGate.ZeroAddress.selector);
        gate.initiateGovernanceTransfer(address(0));
    }

    function test_RevertWhen_InitiateGovernanceTransferToSelf() public {
        vm.prank(governance);
        vm.expectRevert(DistrictGate.ZeroAddress.selector);
        gate.initiateGovernanceTransfer(governance);
    }

    function test_ExecuteGovernanceTransferAfterTimelock() public {
        // Initiate transfer
        vm.prank(governance);
        gate.initiateGovernanceTransfer(newGovernance);

        // Fast forward 7 days
        vm.warp(block.timestamp + 7 days);

        // Execute transfer (anyone can execute)
        vm.expectEmit(true, true, false, false);
        emit GovernanceTransferred(governance, newGovernance);

        gate.executeGovernanceTransfer(newGovernance);

        assertEq(gate.governance(), newGovernance);
        assertEq(gate.pendingGovernance(newGovernance), 0); // Should be deleted
    }

    function test_ExecuteGovernanceTransferByAnyone() public {
        // Initiate transfer
        vm.prank(governance);
        gate.initiateGovernanceTransfer(newGovernance);

        // Fast forward 7 days
        vm.warp(block.timestamp + 7 days);

        // Attacker can execute (but doesn't benefit from it)
        vm.prank(attacker);
        gate.executeGovernanceTransfer(newGovernance);

        assertEq(gate.governance(), newGovernance);
    }

    function test_RevertWhen_ExecuteGovernanceTransferNotInitiated() public {
        vm.expectRevert(DistrictGate.TransferNotInitiated.selector);
        gate.executeGovernanceTransfer(newGovernance);
    }

    function test_RevertWhen_ExecuteGovernanceTransferBeforeTimelock() public {
        // Initiate transfer
        vm.prank(governance);
        gate.initiateGovernanceTransfer(newGovernance);

        // Try to execute immediately (should fail)
        vm.expectRevert(DistrictGate.TimelockNotExpired.selector);
        gate.executeGovernanceTransfer(newGovernance);
    }

    function test_RevertWhen_ExecuteGovernanceTransferOneDayEarly() public {
        // Initiate transfer
        vm.prank(governance);
        gate.initiateGovernanceTransfer(newGovernance);

        // Fast forward 6 days (not enough)
        vm.warp(block.timestamp + 6 days);

        // Try to execute (should fail)
        vm.expectRevert(DistrictGate.TimelockNotExpired.selector);
        gate.executeGovernanceTransfer(newGovernance);
    }

    function test_CancelGovernanceTransfer() public {
        // Initiate transfer
        vm.prank(governance);
        gate.initiateGovernanceTransfer(newGovernance);

        assertEq(gate.pendingGovernance(newGovernance), block.timestamp + 7 days);

        // Cancel transfer
        vm.prank(governance);
        vm.expectEmit(true, false, false, false);
        emit GovernanceTransferCancelled(newGovernance);

        gate.cancelGovernanceTransfer(newGovernance);

        assertEq(gate.pendingGovernance(newGovernance), 0);
    }

    function test_RevertWhen_CancelGovernanceTransferUnauthorized() public {
        // Initiate transfer
        vm.prank(governance);
        gate.initiateGovernanceTransfer(newGovernance);

        // Attacker tries to cancel (should fail)
        vm.prank(attacker);
        vm.expectRevert(DistrictGate.UnauthorizedCaller.selector);
        gate.cancelGovernanceTransfer(newGovernance);
    }

    function test_RevertWhen_CancelGovernanceTransferNotInitiated() public {
        vm.prank(governance);
        vm.expectRevert(DistrictGate.TransferNotInitiated.selector);
        gate.cancelGovernanceTransfer(newGovernance);
    }

    // ============ Governance Attack Scenario Tests ============

    function test_CompromisedGovernanceCannotInstantTakeover() public {
        // CRITICAL: This test validates CRITICAL #1 fix
        // Attack scenario: Multi-sig gets compromised, attacker tries instant takeover

        // Attacker compromises governance multi-sig
        vm.prank(governance);
        gate.initiateGovernanceTransfer(attacker);
        uint256 initiateTime = block.timestamp;
        uint256 executeTime = gate.pendingGovernance(attacker);

        // Governance is still the original (transfer not executed)
        assertEq(gate.governance(), governance);

        // Community detects malicious transfer during 7-day window
        // They can fork or organize response

        // Fast forward only 1 day - still can't execute
        vm.warp(initiateTime + 1 days);
        vm.expectRevert(DistrictGate.TimelockNotExpired.selector);
        gate.executeGovernanceTransfer(attacker);

        // Even 1 second before timelock expires - still can't execute
        vm.warp(executeTime - 1);
        vm.expectRevert(DistrictGate.TimelockNotExpired.selector);
        gate.executeGovernanceTransfer(attacker);

        // Community has full 7 days to respond
        assertEq(gate.governance(), governance, "Governance should still be original");
    }

    function test_CommunityCanDetectAndRespond() public {
        // Malicious transfer initiated
        vm.prank(governance);
        gate.initiateGovernanceTransfer(attacker);

        // Community has 7 days to:
        // 1. Detect malicious transfer (GovernanceTransferInitiated event)
        // 2. Organize response (social consensus)
        // 3. Exit to fork if necessary

        // In this scenario, governance realizes mistake and cancels
        vm.prank(governance);
        gate.cancelGovernanceTransfer(attacker);

        // Governance remains unchanged
        assertEq(gate.governance(), governance);

        // Cannot execute cancelled transfer
        vm.warp(block.timestamp + 7 days);
        vm.expectRevert(DistrictGate.TransferNotInitiated.selector);
        gate.executeGovernanceTransfer(attacker);
    }

    function test_NewGovernanceCanAuthorizeActions() public {
        // Transfer governance successfully
        vm.prank(governance);
        gate.initiateGovernanceTransfer(newGovernance);

        vm.warp(block.timestamp + 7 days);
        gate.executeGovernanceTransfer(newGovernance);

        // New governance can authorize actions
        bytes32 actionId = bytes32(uint256(0x123));
        vm.prank(newGovernance);
        gate.authorizeAction(actionId);

        assertTrue(gate.isActionAuthorized(actionId));

        // Old governance cannot
        bytes32 actionId2 = bytes32(uint256(0x456));
        vm.prank(governance);
        vm.expectRevert(DistrictGate.UnauthorizedCaller.selector);
        gate.authorizeAction(actionId2);
    }

    function test_NewGovernanceInheritsAllAuthority() public {
        // Setup: Authorize an action with old governance
        bytes32 actionId = bytes32(uint256(0x789));
        vm.prank(governance);
        gate.authorizeAction(actionId);

        // Transfer governance
        vm.prank(governance);
        gate.initiateGovernanceTransfer(newGovernance);
        vm.warp(block.timestamp + 7 days);
        gate.executeGovernanceTransfer(newGovernance);

        // New governance can deauthorize old actions
        vm.prank(newGovernance);
        gate.deauthorizeAction(actionId);

        assertFalse(gate.isActionAuthorized(actionId));

        // Old governance cannot reauthorize
        vm.prank(governance);
        vm.expectRevert(DistrictGate.UnauthorizedCaller.selector);
        gate.authorizeAction(actionId);
    }

    // ============ Fuzz Tests ============

    function testFuzz_TimelockEnforcement(uint256 timeElapsed) public {
        vm.assume(timeElapsed < 7 days);

        vm.prank(governance);
        gate.initiateGovernanceTransfer(newGovernance);

        vm.warp(block.timestamp + timeElapsed);

        // Should fail if less than 7 days
        vm.expectRevert(DistrictGate.TimelockNotExpired.selector);
        gate.executeGovernanceTransfer(newGovernance);
    }

    function testFuzz_TimelockSuccess(uint256 timeElapsed) public {
        vm.assume(timeElapsed >= 7 days && timeElapsed < 365 days);

        vm.prank(governance);
        gate.initiateGovernanceTransfer(newGovernance);

        vm.warp(block.timestamp + timeElapsed);

        // Should succeed if 7+ days
        gate.executeGovernanceTransfer(newGovernance);

        assertEq(gate.governance(), newGovernance);
    }

    // ============ Edge Case Tests ============

    function test_MultipleSimultaneousPendingTransfers() public {
        address governance2 = address(0x4);
        address governance3 = address(0x5);

        // Initiate both transfers
        vm.startPrank(governance);
        gate.initiateGovernanceTransfer(governance2);
        gate.initiateGovernanceTransfer(governance3);
        vm.stopPrank();

        // Both should be pending
        uint256 executeTime2 = gate.pendingGovernance(governance2);
        uint256 executeTime3 = gate.pendingGovernance(governance3);
        assertTrue(executeTime2 > 0, "governance2 transfer should be pending");
        assertTrue(executeTime3 > 0, "governance3 transfer should be pending");

        // Execute first one after timelock
        vm.warp(executeTime2);
        gate.executeGovernanceTransfer(governance2);

        // First one succeeds
        assertEq(gate.governance(), governance2);

        // Execute second one after its timelock
        vm.warp(executeTime3);
        gate.executeGovernanceTransfer(governance3);

        // governance3 takes over (last execution wins)
        assertEq(gate.governance(), governance3);
    }

    function test_OverwritePendingTransferWithNewInitiation() public {
        // Initiate transfer
        vm.prank(governance);
        gate.initiateGovernanceTransfer(newGovernance);
        uint256 firstExecuteTime = gate.pendingGovernance(newGovernance);

        // Fast forward 3 days
        vm.warp(block.timestamp + 3 days);

        // Initiate again (overwrites)
        vm.prank(governance);
        gate.initiateGovernanceTransfer(newGovernance);
        uint256 secondExecuteTime = gate.pendingGovernance(newGovernance);

        // Second time should be later
        assertGt(secondExecuteTime, firstExecuteTime);
        assertEq(secondExecuteTime, block.timestamp + 7 days);
    }
}

/// @notice Mock verifier that always returns true
contract MockVerifier {
    function verifyProof(bytes calldata, uint256[3] calldata) external pure returns (bool) {
        return true;
    }
}
