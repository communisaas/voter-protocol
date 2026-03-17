// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Test.sol";
import "../src/AIEvaluationRegistry.sol";
import "../src/TimelockGovernance.sol";

/// @title AIEvaluationRegistry Tests
/// @notice Tests for SC-1 (two-phase model timelock) and SM-7 (providerCount optimization)
contract AIEvaluationRegistryTest is Test {
	AIEvaluationRegistry public registry;

	address public governance = address(0x1);
	address public user = address(0x2);
	address public attacker = address(0x3);

	address public signer1 = address(0x10);
	address public signer2 = address(0x20);
	address public signer3 = address(0x30);
	address public signer4 = address(0x40);
	address public signer5 = address(0x50);
	address public signer6 = address(0x60);

	uint256 public constant MODEL_TIMELOCK = 7 days;
	uint256 public constant GOV_TIMELOCK = 7 days;

	// Events
	event ModelRegistered(address indexed signer, uint8 providerSlot);
	event ModelRemoved(address indexed signer);
	event ModelRegistrationInitiated(address indexed signer, uint8 providerSlot, uint256 executeTime);
	event ModelRemovalInitiated(address indexed signer, uint256 executeTime);
	event ModelOperationCancelled(address indexed signer);

	function setUp() public {
		registry = new AIEvaluationRegistry(governance, GOV_TIMELOCK, MODEL_TIMELOCK);

		// Register 5 models from 5 providers via two-phase
		vm.startPrank(governance);
		registry.initiateModelRegistration(signer1, 0); // OpenAI
		registry.initiateModelRegistration(signer2, 1); // Google
		registry.initiateModelRegistration(signer3, 2); // DeepSeek
		registry.initiateModelRegistration(signer4, 3); // Mistral
		registry.initiateModelRegistration(signer5, 4); // Anthropic
		vm.stopPrank();

		vm.warp(block.timestamp + MODEL_TIMELOCK);

		registry.executeModelRegistration(signer1);
		registry.executeModelRegistration(signer2);
		registry.executeModelRegistration(signer3);
		registry.executeModelRegistration(signer4);
		registry.executeModelRegistration(signer5);
	}

	// ============================================================================
	// Constructor
	// ============================================================================

	function test_constructor_setsModelTimelock() public view {
		assertEq(registry.MODEL_TIMELOCK(), MODEL_TIMELOCK);
	}

	function test_constructor_revertsIfModelTimelockTooShort() public {
		vm.expectRevert(TimelockGovernance.TimelockTooShort.selector);
		new AIEvaluationRegistry(governance, GOV_TIMELOCK, 5 minutes);
	}

	function test_constructor_acceptsMinimumModelTimelock() public {
		AIEvaluationRegistry r = new AIEvaluationRegistry(governance, GOV_TIMELOCK, 10 minutes);
		assertEq(r.MODEL_TIMELOCK(), 10 minutes);
	}

	// ============================================================================
	// SC-1: Two-Phase Registration — Happy Path
	// ============================================================================

	function test_twoPhaseRegistration_happyPath() public {
		address newSigner = address(0x99);

		vm.prank(governance);
		vm.expectEmit(true, false, false, true);
		emit ModelRegistrationInitiated(newSigner, 0, block.timestamp + MODEL_TIMELOCK);
		registry.initiateModelRegistration(newSigner, 0);

		// Verify pending state
		(uint8 pendingSlot, uint256 pendingTime) = registry.pendingRegistrations(newSigner);
		assertEq(pendingSlot, 0);
		assertEq(pendingTime, block.timestamp + MODEL_TIMELOCK);

		// Not yet registered
		assertFalse(registry.isRegistered(newSigner));

		// Warp past timelock
		vm.warp(block.timestamp + MODEL_TIMELOCK);

		vm.expectEmit(true, false, false, true);
		emit ModelRegistered(newSigner, 0);
		registry.executeModelRegistration(newSigner);

		assertTrue(registry.isRegistered(newSigner));
		assertEq(registry.modelCount(), 6);

		// Pending state cleared
		(, uint256 clearedTime) = registry.pendingRegistrations(newSigner);
		assertEq(clearedTime, 0);
	}

	// ============================================================================
	// SC-1: Registration Reverts Before Timelock
	// ============================================================================

	function test_executeRegistration_revertsBeforeTimelock() public {
		address newSigner = address(0x99);

		vm.prank(governance);
		registry.initiateModelRegistration(newSigner, 0);

		// Try to execute immediately (same block)
		vm.expectRevert(TimelockGovernance.TimelockNotExpired.selector);
		registry.executeModelRegistration(newSigner);

		// Try 1 second before timelock expires
		vm.warp(block.timestamp + MODEL_TIMELOCK - 1);
		vm.expectRevert(TimelockGovernance.TimelockNotExpired.selector);
		registry.executeModelRegistration(newSigner);
	}

	// ============================================================================
	// SC-1: Registration Callable by Non-Governance After Timelock
	// ============================================================================

	function test_executeRegistration_callableByAnyone() public {
		address newSigner = address(0x99);

		vm.prank(governance);
		registry.initiateModelRegistration(newSigner, 0);

		vm.warp(block.timestamp + MODEL_TIMELOCK);

		// Execute as random user (not governance)
		vm.prank(user);
		registry.executeModelRegistration(newSigner);

		assertTrue(registry.isRegistered(newSigner));
	}

	// ============================================================================
	// SC-1: Two-Phase Removal — Happy Path
	// ============================================================================

	function test_twoPhaseRemoval_happyPath() public {
		vm.prank(governance);
		vm.expectEmit(true, false, false, true);
		emit ModelRemovalInitiated(signer5, block.timestamp + MODEL_TIMELOCK);
		registry.initiateModelRemoval(signer5);

		// Verify pending state
		assertEq(registry.pendingRemovals(signer5), block.timestamp + MODEL_TIMELOCK);

		// Still registered during timelock
		assertTrue(registry.isRegistered(signer5));
		assertEq(registry.modelCount(), 5);

		vm.warp(block.timestamp + MODEL_TIMELOCK);

		vm.expectEmit(true, false, false, false);
		emit ModelRemoved(signer5);
		registry.executeModelRemoval(signer5);

		assertFalse(registry.isRegistered(signer5));
		assertEq(registry.modelCount(), 4);

		// Pending state cleared
		assertEq(registry.pendingRemovals(signer5), 0);
	}

	// ============================================================================
	// SC-1: Removal Re-Validates Minimums at Execute Time
	// ============================================================================

	function test_executeRemoval_revalidatesMinimums() public {
		// Initiate removal of both signer4 and signer5
		vm.startPrank(governance);
		registry.initiateModelRemoval(signer5);
		registry.initiateModelRemoval(signer4);
		vm.stopPrank();

		vm.warp(block.timestamp + MODEL_TIMELOCK);

		// Execute signer5 removal — succeeds (5→4 models)
		registry.executeModelRemoval(signer5);

		// Execute signer4 removal — also succeeds (4→3 models)
		registry.executeModelRemoval(signer4);

		assertEq(registry.modelCount(), 3);

		// Now initiate removal of signer3 — should revert (would go below 3)
		vm.prank(governance);
		vm.expectRevert(AIEvaluationRegistry.BelowMinModels.selector);
		registry.initiateModelRemoval(signer3);
	}

	function test_executeRemoval_revalidatesProviderDiversity() public {
		// Register extra model on slot 0
		vm.prank(governance);
		registry.initiateModelRegistration(signer6, 0);
		(, uint256 regExecTime) = registry.pendingRegistrations(signer6);
		vm.warp(regExecTime);
		registry.executeModelRegistration(signer6);
		// 6 models, 5 providers

		// Initiate removal of model2 (Google, slot 1) and model3 (DeepSeek, slot 2)
		// Both pass pre-check individually
		vm.startPrank(governance);
		registry.initiateModelRemoval(signer2);
		registry.initiateModelRemoval(signer3);
		vm.stopPrank();

		uint256 removalExecTime = registry.pendingRemovals(signer2);
		vm.warp(removalExecTime);
		registry.executeModelRemoval(signer2); // 5 models, 4 providers — OK
		registry.executeModelRemoval(signer3); // 4 models, 3 providers — OK

		// Now try to remove model4 (Mistral, slot 3) — would drop to 2 providers
		vm.prank(governance);
		vm.expectRevert(AIEvaluationRegistry.BelowMinProviders.selector);
		registry.initiateModelRemoval(signer4);
	}

	// ============================================================================
	// SC-1: Cancel Registration and Removal
	// ============================================================================

	function test_cancelRegistration() public {
		address newSigner = address(0x99);

		vm.prank(governance);
		registry.initiateModelRegistration(newSigner, 0);

		vm.prank(governance);
		vm.expectEmit(true, false, false, false);
		emit ModelOperationCancelled(newSigner);
		registry.cancelModelRegistration(newSigner);

		// Pending state cleared
		(, uint256 clearedTime) = registry.pendingRegistrations(newSigner);
		assertEq(clearedTime, 0);

		// Cannot execute after cancel
		vm.warp(block.timestamp + MODEL_TIMELOCK);
		vm.expectRevert(AIEvaluationRegistry.OperationNotPending.selector);
		registry.executeModelRegistration(newSigner);
	}

	function test_cancelRemoval() public {
		vm.prank(governance);
		registry.initiateModelRemoval(signer5);

		vm.prank(governance);
		vm.expectEmit(true, false, false, false);
		emit ModelOperationCancelled(signer5);
		registry.cancelModelRemoval(signer5);

		assertEq(registry.pendingRemovals(signer5), 0);

		// Cannot execute after cancel
		vm.warp(block.timestamp + MODEL_TIMELOCK);
		vm.expectRevert(AIEvaluationRegistry.OperationNotPending.selector);
		registry.executeModelRemoval(signer5);
	}

	function test_cancelRegistration_onlyGovernance() public {
		address newSigner = address(0x99);
		vm.prank(governance);
		registry.initiateModelRegistration(newSigner, 0);

		vm.prank(user);
		vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
		registry.cancelModelRegistration(newSigner);
	}

	function test_cancelRemoval_onlyGovernance() public {
		vm.prank(governance);
		registry.initiateModelRemoval(signer5);

		vm.prank(user);
		vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
		registry.cancelModelRemoval(signer5);
	}

	function test_cancelRegistration_revertsIfNoPending() public {
		vm.prank(governance);
		vm.expectRevert(AIEvaluationRegistry.OperationNotPending.selector);
		registry.cancelModelRegistration(address(0x99));
	}

	function test_cancelRemoval_revertsIfNoPending() public {
		vm.prank(governance);
		vm.expectRevert(AIEvaluationRegistry.OperationNotPending.selector);
		registry.cancelModelRemoval(signer5);
	}

	// ============================================================================
	// SC-1: Cannot Initiate Duplicate Pending Operations
	// ============================================================================

	function test_duplicatePendingRegistration_reverts() public {
		address newSigner = address(0x99);

		vm.prank(governance);
		registry.initiateModelRegistration(newSigner, 0);

		vm.prank(governance);
		vm.expectRevert(AIEvaluationRegistry.OperationAlreadyPending.selector);
		registry.initiateModelRegistration(newSigner, 1);
	}

	function test_duplicatePendingRemoval_reverts() public {
		vm.prank(governance);
		registry.initiateModelRemoval(signer5);

		vm.prank(governance);
		vm.expectRevert(AIEvaluationRegistry.OperationAlreadyPending.selector);
		registry.initiateModelRemoval(signer5);
	}

	// ============================================================================
	// SC-1: One-Block Attack Impossible
	// ============================================================================

	function test_oneBlockAttack_impossible() public {
		// Attacker scenario: compromised governance tries to replace models in one block
		// Step 1: Initiate removal of a model
		vm.prank(governance);
		registry.initiateModelRemoval(signer5);

		// Step 2: Try to execute immediately — must fail
		vm.expectRevert(TimelockGovernance.TimelockNotExpired.selector);
		registry.executeModelRemoval(signer5);

		// Step 3: Initiate registration of attacker model
		vm.prank(governance);
		registry.initiateModelRegistration(attacker, 4);

		// Step 4: Try to execute immediately — must fail
		vm.expectRevert(TimelockGovernance.TimelockNotExpired.selector);
		registry.executeModelRegistration(attacker);

		// Models unchanged
		assertTrue(registry.isRegistered(signer5));
		assertFalse(registry.isRegistered(attacker));
		assertEq(registry.modelCount(), 5);
	}

	// ============================================================================
	// SC-1: Access Control
	// ============================================================================

	function test_initiateRegistration_onlyGovernance() public {
		vm.prank(user);
		vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
		registry.initiateModelRegistration(address(0x99), 0);
	}

	function test_initiateRemoval_onlyGovernance() public {
		vm.prank(user);
		vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
		registry.initiateModelRemoval(signer5);
	}

	function test_initiateRegistration_zeroAddress_reverts() public {
		vm.prank(governance);
		vm.expectRevert(TimelockGovernance.ZeroAddress.selector);
		registry.initiateModelRegistration(address(0), 0);
	}

	function test_initiateRegistration_alreadyActive_reverts() public {
		vm.prank(governance);
		vm.expectRevert(AIEvaluationRegistry.ModelAlreadyRegistered.selector);
		registry.initiateModelRegistration(signer1, 0);
	}

	function test_initiateRemoval_notRegistered_reverts() public {
		vm.prank(governance);
		vm.expectRevert(AIEvaluationRegistry.ModelNotRegistered.selector);
		registry.initiateModelRemoval(address(0x99));
	}

	function test_executeRegistration_notPending_reverts() public {
		vm.expectRevert(AIEvaluationRegistry.OperationNotPending.selector);
		registry.executeModelRegistration(address(0x99));
	}

	function test_executeRemoval_notPending_reverts() public {
		vm.expectRevert(AIEvaluationRegistry.OperationNotPending.selector);
		registry.executeModelRemoval(signer5);
	}

	// ============================================================================
	// SM-7: Provider Count State Variable
	// ============================================================================

	function test_providerCount_initialState() public view {
		// 5 models from 5 different providers
		assertEq(registry.providerCount(), 5);
	}

	function test_providerCount_incrementsOnNewProvider() public {
		// Register model on new provider slot 5
		vm.prank(governance);
		registry.initiateModelRegistration(signer6, 5);
		vm.warp(block.timestamp + MODEL_TIMELOCK);
		registry.executeModelRegistration(signer6);

		assertEq(registry.providerCount(), 6);
	}

	function test_providerCount_noIncrementOnExistingProvider() public {
		// Register second model on existing provider slot 0
		vm.prank(governance);
		registry.initiateModelRegistration(signer6, 0);
		vm.warp(block.timestamp + MODEL_TIMELOCK);
		registry.executeModelRegistration(signer6);

		// Still 5 providers (just 2 models on slot 0)
		assertEq(registry.providerCount(), 5);
		assertEq(registry.modelCount(), 6);
	}

	function test_providerCount_decrementsOnLastModelRemoved() public {
		// signer5 is sole model on slot 4 (Anthropic)
		vm.prank(governance);
		registry.initiateModelRemoval(signer5);
		vm.warp(block.timestamp + MODEL_TIMELOCK);
		registry.executeModelRemoval(signer5);

		assertEq(registry.providerCount(), 4);
	}

	function test_providerCount_noDecrementIfProviderHasOtherModels() public {
		// Register extra model on slot 4
		vm.prank(governance);
		registry.initiateModelRegistration(signer6, 4);
		(, uint256 regExecTime) = registry.pendingRegistrations(signer6);
		vm.warp(regExecTime);
		registry.executeModelRegistration(signer6);
		assertEq(registry.providerCount(), 5);

		// Remove signer5 (slot 4) — signer6 still on slot 4
		vm.prank(governance);
		registry.initiateModelRemoval(signer5);
		uint256 removalExecTime = registry.pendingRemovals(signer5);
		vm.warp(removalExecTime);
		registry.executeModelRemoval(signer5);

		// Provider count unchanged
		assertEq(registry.providerCount(), 5);
		assertEq(registry.modelCount(), 5);
	}

	function test_providerCount_tracksAcrossMultipleOperations() public {
		// Start: 5 providers, 5 models
		assertEq(registry.providerCount(), 5);

		// Add 2nd model on slot 0 → still 5 providers
		vm.prank(governance);
		registry.initiateModelRegistration(signer6, 0);
		(, uint256 execTime) = registry.pendingRegistrations(signer6);
		vm.warp(execTime);
		registry.executeModelRegistration(signer6);
		assertEq(registry.providerCount(), 5);
		assertEq(registry.modelCount(), 6);

		// Remove signer5 (sole model on slot 4) → 4 providers
		vm.prank(governance);
		registry.initiateModelRemoval(signer5);
		execTime = registry.pendingRemovals(signer5);
		vm.warp(execTime);
		registry.executeModelRemoval(signer5);
		assertEq(registry.providerCount(), 4);

		// Remove signer4 (sole model on slot 3) → 3 providers
		vm.prank(governance);
		registry.initiateModelRemoval(signer4);
		execTime = registry.pendingRemovals(signer4);
		vm.warp(execTime);
		registry.executeModelRemoval(signer4);
		assertEq(registry.providerCount(), 3);
		assertEq(registry.modelCount(), 4);
	}

	// ============================================================================
	// View Functions (unchanged behavior)
	// ============================================================================

	function test_isRegistered() public view {
		assertTrue(registry.isRegistered(signer1));
		assertTrue(registry.isRegistered(signer2));
		assertTrue(registry.isRegistered(signer3));
		assertTrue(registry.isRegistered(signer4));
		assertTrue(registry.isRegistered(signer5));
		assertFalse(registry.isRegistered(address(0x99)));
	}

	function test_modelCount() public view {
		assertEq(registry.modelCount(), 5);
	}

	function test_quorum() public view {
		// 5 models → ceil(10/3) = 4
		assertEq(registry.quorum(), 4);
	}

	function test_getActiveModels() public view {
		address[] memory active = registry.getActiveModels();
		assertEq(active.length, 5);
	}

	function test_setAIWeight() public {
		vm.prank(governance);
		registry.setAIWeight(5000);
		assertEq(registry.aiWeight(), 5000);
	}

	function test_setMinProviders() public {
		vm.prank(governance);
		registry.setMinProviders(2);
		assertEq(registry.minProviders(), 2);
	}

	function test_setMinProviders_revertsIfBelowCurrent() public {
		// Only 5 active providers — setting min to 6 should revert
		vm.prank(governance);
		vm.expectRevert(AIEvaluationRegistry.BelowMinProviders.selector);
		registry.setMinProviders(6);
	}

	// ============================================================================
	// Edge Cases
	// ============================================================================

	function test_executeRemoval_modelDeactivatedDuringTimelock() public {
		// Register extra model so removal of signer5 + signer4 stays above minimums
		vm.prank(governance);
		registry.initiateModelRegistration(signer6, 4); // same slot as signer5
		(, uint256 regExecTime) = registry.pendingRegistrations(signer6);
		vm.warp(regExecTime);
		registry.executeModelRegistration(signer6);

		// Initiate removal of both signer5 and signer4
		vm.startPrank(governance);
		registry.initiateModelRemoval(signer5);
		registry.initiateModelRemoval(signer4);
		vm.stopPrank();

		uint256 removalExecTime = registry.pendingRemovals(signer5);
		vm.warp(removalExecTime);

		// Execute signer5 removal first
		registry.executeModelRemoval(signer5);
		assertFalse(registry.isRegistered(signer5));

		// signer4 removal should also work (still 4 models, 4 providers)
		registry.executeModelRemoval(signer4);
		assertFalse(registry.isRegistered(signer4));
		assertEq(registry.modelCount(), 4);
	}

	function test_reinitiateAfterCancel() public {
		address newSigner = address(0x99);

		// Initiate, then cancel
		vm.prank(governance);
		registry.initiateModelRegistration(newSigner, 0);
		vm.prank(governance);
		registry.cancelModelRegistration(newSigner);

		// Can re-initiate with different slot
		vm.prank(governance);
		registry.initiateModelRegistration(newSigner, 2);

		(uint8 slot, uint256 executeTime) = registry.pendingRegistrations(newSigner);
		assertEq(slot, 2);
		assertTrue(executeTime > 0);
	}

	function test_executeRemoval_permissionlessAfterTimelock() public {
		vm.prank(governance);
		registry.initiateModelRemoval(signer5);

		vm.warp(block.timestamp + MODEL_TIMELOCK);

		// Anyone can execute
		vm.prank(attacker);
		registry.executeModelRemoval(signer5);

		assertFalse(registry.isRegistered(signer5));
	}

	// ============================================================================
	// FP-2: Re-registration must not duplicate modelList entry
	// ============================================================================

	function test_reRegistration_noModelListDuplicate() public {
		// Remove signer5 (provider 4)
		vm.prank(governance);
		registry.initiateModelRemoval(signer5);
		skip(MODEL_TIMELOCK);
		registry.executeModelRemoval(signer5);
		assertFalse(registry.isRegistered(signer5));
		assertEq(registry.modelCount(), 4);

		// Re-register signer5 on same provider slot
		vm.prank(governance);
		registry.initiateModelRegistration(signer5, 4);
		skip(MODEL_TIMELOCK);
		registry.executeModelRegistration(signer5);

		assertTrue(registry.isRegistered(signer5));
		assertEq(registry.modelCount(), 5);

		// getActiveModels() must not revert (OOB) and must return exactly 5
		address[] memory active = registry.getActiveModels();
		assertEq(active.length, 5);

		// Verify no duplicates in the returned array
		for (uint256 i = 0; i < active.length; i++) {
			for (uint256 j = i + 1; j < active.length; j++) {
				assertTrue(active[i] != active[j], "duplicate in getActiveModels");
			}
		}
	}
}
