// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "forge-std/Test.sol";
import "../src/DistrictGate.sol";
import "../src/DistrictRegistry.sol";
import "../src/NullifierRegistry.sol";
import "../src/GuardianShield.sol";

/// @title Guardian Shield and Verifier Upgrade Tests
/// @notice Tests the nation-state resistance mechanisms
contract GuardianShieldTest is Test {
    DistrictGate gate;
    DistrictRegistry registry;
    NullifierRegistry nullifierRegistry;
    address verifier;

    address governance = address(0x1);
    address guardian1 = address(0x100);
    address guardian2 = address(0x101);
    address attacker = address(0xBAD);
    address newGovernance = address(0x2);
    address newVerifier = address(0x300);

    function setUp() public {
        verifier = address(new MockVerifier());
        registry = new DistrictRegistry(governance);
        nullifierRegistry = new NullifierRegistry(governance);

        address[] memory guardians = new address[](2);
        guardians[0] = guardian1;
        guardians[1] = guardian2;

        gate = new DistrictGate(
            verifier,
            address(registry),
            address(nullifierRegistry),
            governance,
            guardians
        );

        vm.prank(governance);
        nullifierRegistry.authorizeCaller(address(gate));
    }

    // ============ Guardian Initialization Tests ============

    function test_GuardiansInitializedCorrectly() public view {
        assertTrue(gate.guardians(guardian1));
        assertTrue(gate.guardians(guardian2));
        assertEq(gate.guardianCount(), 2);
    }

    function test_RevertWhen_InsufficientGuardians() public {
        address[] memory singleGuardian = new address[](1);
        singleGuardian[0] = guardian1;

        vm.expectRevert(GuardianShield.InsufficientGuardians.selector);
        new DistrictGate(
            verifier,
            address(registry),
            address(nullifierRegistry),
            governance,
            singleGuardian
        );
    }

    // ============ Guardian Veto Tests ============

    function test_GuardianCanVetoGovernanceTransfer() public {
        // Initiate governance transfer
        vm.prank(governance);
        gate.initiateGovernanceTransfer(newGovernance);

        // Guardian vetoes
        vm.prank(guardian1);
        gate.veto(newGovernance);

        assertTrue(gate.isVetoed(newGovernance));
        assertEq(gate.vetoedBy(newGovernance), guardian1);
    }

    function test_RevertWhen_NonGuardianVetoes() public {
        vm.prank(governance);
        gate.initiateGovernanceTransfer(newGovernance);

        vm.prank(attacker);
        vm.expectRevert(GuardianShield.NotGuardian.selector);
        gate.veto(newGovernance);
    }

    function test_RevertWhen_ExecuteVetoedGovernanceTransfer() public {
        // Initiate transfer
        vm.prank(governance);
        gate.initiateGovernanceTransfer(newGovernance);

        // Guardian vetoes
        vm.prank(guardian1);
        gate.veto(newGovernance);

        // Fast forward past timelock
        vm.warp(block.timestamp + 7 days);

        // Execution should fail due to veto
        vm.expectRevert(GuardianShield.TransferVetoed.selector);
        gate.executeGovernanceTransfer(newGovernance);
    }

    function test_CancelGovernanceTransferClearsVeto() public {
        // Initiate and veto
        vm.prank(governance);
        gate.initiateGovernanceTransfer(newGovernance);

        vm.prank(guardian1);
        gate.veto(newGovernance);

        assertTrue(gate.isVetoed(newGovernance));

        // Cancel transfer clears veto
        vm.prank(governance);
        gate.cancelGovernanceTransfer(newGovernance);

        assertFalse(gate.isVetoed(newGovernance));
    }

    // ============ Verifier Upgrade Tests ============

    function test_InitiateVerifierUpgrade() public {
        vm.prank(governance);
        gate.initiateVerifierUpgrade(newVerifier);

        assertEq(gate.pendingVerifier(), newVerifier);
        assertEq(gate.verifierUpgradeTime(), block.timestamp + 14 days);
    }

    function test_ExecuteVerifierUpgradeAfterTimelock() public {
        vm.prank(governance);
        gate.initiateVerifierUpgrade(newVerifier);

        // Fast forward 14 days
        vm.warp(block.timestamp + 14 days);

        gate.executeVerifierUpgrade();

        assertEq(gate.verifier(), newVerifier);
        assertEq(gate.pendingVerifier(), address(0));
    }

    function test_RevertWhen_ExecuteVerifierUpgradeBeforeTimelock() public {
        vm.prank(governance);
        gate.initiateVerifierUpgrade(newVerifier);

        // Only 7 days
        vm.warp(block.timestamp + 7 days);

        vm.expectRevert(DistrictGate.TimelockNotExpired.selector);
        gate.executeVerifierUpgrade();
    }

    function test_GuardianCanVetoVerifierUpgrade() public {
        vm.prank(governance);
        gate.initiateVerifierUpgrade(newVerifier);

        // Guardian vetoes
        vm.prank(guardian2);
        gate.veto(newVerifier);

        // Fast forward
        vm.warp(block.timestamp + 14 days);

        // Execution fails
        vm.expectRevert(GuardianShield.TransferVetoed.selector);
        gate.executeVerifierUpgrade();
    }

    function test_CancelVerifierUpgrade() public {
        vm.prank(governance);
        gate.initiateVerifierUpgrade(newVerifier);

        vm.prank(governance);
        gate.cancelVerifierUpgrade();

        assertEq(gate.pendingVerifier(), address(0));
    }

    // ============ Guardian Management Tests ============

    function test_GovernanceCanAddGuardian() public {
        address newGuardian = address(0x102);

        vm.prank(governance);
        gate.addGuardian(newGuardian);

        assertTrue(gate.guardians(newGuardian));
        assertEq(gate.guardianCount(), 3);
    }

    function test_GovernanceCanRemoveGuardian() public {
        // First add a third guardian
        address newGuardian = address(0x102);
        vm.prank(governance);
        gate.addGuardian(newGuardian);
        assertEq(gate.guardianCount(), 3);

        // Now remove one (still have 2)
        vm.prank(governance);
        gate.removeGuardian(guardian1);

        assertFalse(gate.guardians(guardian1));
        assertEq(gate.guardianCount(), 2);
    }

    function test_RevertWhen_RemoveLastGuardian() public {
        // Try to remove when only 2 guardians
        vm.prank(governance);
        vm.expectRevert(GuardianShield.CannotRemoveLastGuardian.selector);
        gate.removeGuardian(guardian1);
    }

    function test_RevertWhen_NonGovernanceAddsGuardian() public {
        vm.prank(attacker);
        vm.expectRevert(DistrictGate.UnauthorizedCaller.selector);
        gate.addGuardian(address(0x999));
    }

    // ============ Nation-State Attack Scenario ============

    function test_NationStateCannotCoerceAllGuardians() public {
        // Scenario: Nation-state coerces governance to transfer to attacker
        // But guardians in other jurisdictions see the pending transfer and veto

        // 1. Governance (under coercion) initiates malicious transfer
        vm.prank(governance);
        gate.initiateGovernanceTransfer(attacker);

        // 2. Guardian in different jurisdiction (e.g., EU) detects and vetoes
        vm.prank(guardian1); // EFF Europe
        gate.veto(attacker);

        // 3. Even after 7 days, attack is blocked
        vm.warp(block.timestamp + 7 days);

        vm.expectRevert(GuardianShield.TransferVetoed.selector);
        gate.executeGovernanceTransfer(attacker);

        // 4. Governance remains unchanged
        assertEq(gate.governance(), governance);
    }
}

/// @notice Mock verifier that always returns true
contract MockVerifier {
    function verifyProof(bytes calldata, uint256[3] calldata) external pure returns (bool) {
        return true;
    }
}
