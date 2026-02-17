// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "forge-std/Test.sol";
import "../src/DistrictGate.sol";
import "../src/DistrictRegistry.sol";
import "../src/NullifierRegistry.sol";
import "../src/VerifierRegistry.sol";
import "../src/CampaignRegistry.sol";

/// @title DistrictGate Governance Tests
/// @notice Comprehensive tests for DistrictGate governance and timelock functionality
/// @dev Tests cover:
///      1. Campaign Registry Timelock (7-day timelock)
///      2. Action Domain Timelock (SA-001 fix, 7-day timelock)
///      3. Pause Controls (immediate, governance only)
///      4. Access Control (governance-only functions)
///      5. Edge Cases (non-existent proposals, double execute, etc.)
contract DistrictGateGovernanceTest is Test {
    DistrictGate public gate;
    DistrictRegistry public districtRegistry;
    NullifierRegistry public nullifierRegistry;
    VerifierRegistry public verifierRegistry;
    CampaignRegistry public campaignRegistry;
    CampaignRegistry public newCampaignRegistry;
    address public verifier;

    address public governance = address(0x1);
    address public user = address(0x2);
    address public attacker = address(0x3);

    bytes32 public constant DISTRICT_ROOT = bytes32(uint256(0x123));
    bytes32 public constant NULLIFIER_1 = bytes32(uint256(0x456));
    bytes32 public constant ACTION_DOMAIN_1 = keccak256("election-2024");
    bytes32 public constant ACTION_DOMAIN_2 = keccak256("petition-456");
    bytes32 public constant AUTHORITY_LEVEL = bytes32(uint256(3));
    bytes32 public constant DISTRICT_ID = keccak256("CA-SD-01");
    bytes3 public constant USA = "USA";
    uint8 public constant DEPTH_18 = 18;

    uint256 public constant SEVEN_DAYS = 7 days;

    // Campaign Registry Events
    event CampaignRegistrySet(address indexed previousRegistry, address indexed newRegistry);
    event CampaignRegistryChangeProposed(address indexed proposed, uint256 executeTime);
    event CampaignRegistryChangeCancelled(address indexed proposed);

    // Action Domain Events
    event ActionDomainProposed(bytes32 indexed actionDomain, uint256 executeTime);
    event ActionDomainActivated(bytes32 indexed actionDomain);
    event ActionDomainRevoked(bytes32 indexed actionDomain);

    // Pause Events
    event ContractPaused(address indexed governance);
    event ContractUnpaused(address indexed governance);

    function setUp() public {
        // Deploy mock verifier
        verifier = address(new MockVerifierGov());

        // Deploy registries
        districtRegistry = new DistrictRegistry(governance);
        nullifierRegistry = new NullifierRegistry(governance);
        verifierRegistry = new VerifierRegistry(governance);

        // Deploy DistrictGate
        gate = new DistrictGate(
            address(verifierRegistry),
            address(districtRegistry),
            address(nullifierRegistry),
            governance
        );

        // Deploy CampaignRegistries
        campaignRegistry = new CampaignRegistry(governance);
        newCampaignRegistry = new CampaignRegistry(governance);

        // Setup: Register verifier for depth 18 (genesis registration)
        vm.startPrank(governance);
        verifierRegistry.registerVerifier(DEPTH_18, verifier);
        verifierRegistry.sealGenesis();

        // Setup: Register district
        districtRegistry.registerDistrict(DISTRICT_ROOT, USA, DEPTH_18);

        // Setup: Authorize gate as caller on NullifierRegistry (with 7-day timelock)
        nullifierRegistry.proposeCallerAuthorization(address(gate));
        vm.stopPrank();
        vm.warp(block.timestamp + 7 days);
        nullifierRegistry.executeCallerAuthorization(address(gate));
    }

    // ============================================================================
    // 1. CAMPAIGN REGISTRY TIMELOCK TESTS
    // ============================================================================

    /// @notice proposeCampaignRegistry starts 7-day timelock
    function test_ProposeCampaignRegistry_StartsTimelock() public {
        uint256 expectedExecuteTime = block.timestamp + SEVEN_DAYS;

        vm.prank(governance);
        vm.expectEmit(true, false, false, true);
        emit CampaignRegistryChangeProposed(address(campaignRegistry), expectedExecuteTime);
        gate.proposeCampaignRegistry(address(campaignRegistry));

        // Verify: Pending state is set correctly
        assertEq(gate.pendingCampaignRegistry(), address(campaignRegistry));
        assertEq(gate.pendingCampaignRegistryExecuteTime(), expectedExecuteTime);
    }

    /// @notice executeCampaignRegistry fails before timelock expires
    function test_RevertWhen_ExecuteCampaignRegistryBeforeTimelock() public {
        vm.prank(governance);
        gate.proposeCampaignRegistry(address(campaignRegistry));

        // Try to execute immediately
        vm.expectRevert(DistrictGate.CampaignRegistryTimelockNotExpired.selector);
        gate.executeCampaignRegistry();

        // Try to execute just before timelock expires
        vm.warp(block.timestamp + SEVEN_DAYS - 1);
        vm.expectRevert(DistrictGate.CampaignRegistryTimelockNotExpired.selector);
        gate.executeCampaignRegistry();
    }

    /// @notice executeCampaignRegistry succeeds after timelock expires
    function test_ExecuteCampaignRegistry_SucceedsAfterTimelock() public {
        vm.prank(governance);
        gate.proposeCampaignRegistry(address(campaignRegistry));

        // Warp past timelock
        vm.warp(block.timestamp + SEVEN_DAYS);

        // Execute
        vm.expectEmit(true, true, false, false);
        emit CampaignRegistrySet(address(0), address(campaignRegistry));
        gate.executeCampaignRegistry();

        // Verify: Campaign registry is set
        assertEq(address(gate.campaignRegistry()), address(campaignRegistry));

        // Verify: Pending state is cleared
        assertEq(gate.pendingCampaignRegistry(), address(0));
        assertEq(gate.pendingCampaignRegistryExecuteTime(), 0);
    }

    /// @notice cancelCampaignRegistry clears pending proposal
    function test_CancelCampaignRegistry_ClearsPendingProposal() public {
        vm.prank(governance);
        gate.proposeCampaignRegistry(address(campaignRegistry));

        // Verify proposal exists
        assertEq(gate.pendingCampaignRegistry(), address(campaignRegistry));

        // Cancel
        vm.prank(governance);
        vm.expectEmit(true, false, false, false);
        emit CampaignRegistryChangeCancelled(address(campaignRegistry));
        gate.cancelCampaignRegistry();

        // Verify: Pending state is cleared
        assertEq(gate.pendingCampaignRegistry(), address(0));
        assertEq(gate.pendingCampaignRegistryExecuteTime(), 0);
    }

    /// @notice Only governance can propose campaign registry
    function test_RevertWhen_NonGovernanceProposeCampaignRegistry() public {
        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        gate.proposeCampaignRegistry(address(campaignRegistry));
    }

    /// @notice Only governance can cancel campaign registry
    function test_RevertWhen_NonGovernanceCancelCampaignRegistry() public {
        // First propose
        vm.prank(governance);
        gate.proposeCampaignRegistry(address(campaignRegistry));

        // Try to cancel as non-governance
        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        gate.cancelCampaignRegistry();
    }

    /// @notice Anyone can execute after timelock
    function test_AnyoneCanExecuteCampaignRegistry_AfterTimelock() public {
        vm.prank(governance);
        gate.proposeCampaignRegistry(address(campaignRegistry));

        // Warp past timelock
        vm.warp(block.timestamp + SEVEN_DAYS);

        // Execute as random user (not governance)
        vm.prank(attacker);
        gate.executeCampaignRegistry();

        // Verify: Campaign registry is set
        assertEq(address(gate.campaignRegistry()), address(campaignRegistry));
    }

    /// @notice Setting campaign registry to address(0) removes it
    function test_SetCampaignRegistryToZero_RemovesRegistry() public {
        // First set a campaign registry
        vm.prank(governance);
        gate.proposeCampaignRegistry(address(campaignRegistry));
        uint256 t1 = block.timestamp + SEVEN_DAYS + 1;
        vm.warp(t1);
        gate.executeCampaignRegistry();

        assertEq(address(gate.campaignRegistry()), address(campaignRegistry));

        // Now propose setting it to zero
        vm.prank(governance);
        gate.proposeCampaignRegistry(address(0));
        uint256 targetTime = t1 + SEVEN_DAYS + 1;
        vm.warp(targetTime);

        vm.expectEmit(true, true, false, false);
        emit CampaignRegistrySet(address(campaignRegistry), address(0));
        gate.executeCampaignRegistry();

        // Verify: Campaign registry is removed
        assertEq(address(gate.campaignRegistry()), address(0));
    }

    // ============================================================================
    // 2. ACTION DOMAIN TIMELOCK TESTS (SA-001 Fix)
    // ============================================================================

    /// @notice proposeActionDomain starts 7-day timelock
    function test_ProposeActionDomain_StartsTimelock() public {
        uint256 expectedExecuteTime = block.timestamp + SEVEN_DAYS;

        vm.prank(governance);
        vm.expectEmit(true, false, false, true);
        emit ActionDomainProposed(ACTION_DOMAIN_1, expectedExecuteTime);
        gate.proposeActionDomain(ACTION_DOMAIN_1);

        // Verify: Pending state is set correctly
        assertEq(gate.pendingActionDomains(ACTION_DOMAIN_1), expectedExecuteTime);
    }

    /// @notice executeActionDomain fails before timelock
    function test_RevertWhen_ExecuteActionDomainBeforeTimelock() public {
        vm.prank(governance);
        gate.proposeActionDomain(ACTION_DOMAIN_1);

        // Try to execute immediately
        vm.expectRevert(DistrictGate.ActionDomainTimelockNotExpired.selector);
        gate.executeActionDomain(ACTION_DOMAIN_1);

        // Try to execute just before timelock expires
        vm.warp(block.timestamp + SEVEN_DAYS - 1);
        vm.expectRevert(DistrictGate.ActionDomainTimelockNotExpired.selector);
        gate.executeActionDomain(ACTION_DOMAIN_1);
    }

    /// @notice executeActionDomain succeeds after timelock
    function test_ExecuteActionDomain_SucceedsAfterTimelock() public {
        vm.prank(governance);
        gate.proposeActionDomain(ACTION_DOMAIN_1);

        // Warp past timelock
        vm.warp(block.timestamp + SEVEN_DAYS);

        // Execute
        vm.expectEmit(true, false, false, false);
        emit ActionDomainActivated(ACTION_DOMAIN_1);
        gate.executeActionDomain(ACTION_DOMAIN_1);

        // Verify: Action domain is whitelisted
        assertTrue(gate.allowedActionDomains(ACTION_DOMAIN_1));

        // Verify: Pending state is cleared
        assertEq(gate.pendingActionDomains(ACTION_DOMAIN_1), 0);
    }

    /// @notice cancelActionDomain clears pending proposal
    function test_CancelActionDomain_ClearsPendingProposal() public {
        vm.prank(governance);
        gate.proposeActionDomain(ACTION_DOMAIN_1);

        // Verify proposal exists
        assertGt(gate.pendingActionDomains(ACTION_DOMAIN_1), 0);

        // Cancel
        vm.prank(governance);
        gate.cancelActionDomain(ACTION_DOMAIN_1);

        // Verify: Pending state is cleared
        assertEq(gate.pendingActionDomains(ACTION_DOMAIN_1), 0);
    }

    /// @notice revokeActionDomain is immediate (emergency revocation)
    function test_RevokeActionDomain_IsImmediate() public {
        // First whitelist an action domain
        vm.prank(governance);
        gate.proposeActionDomain(ACTION_DOMAIN_1);
        vm.warp(block.timestamp + SEVEN_DAYS);
        gate.executeActionDomain(ACTION_DOMAIN_1);

        assertTrue(gate.allowedActionDomains(ACTION_DOMAIN_1));

        // Revoke immediately (no timelock required)
        vm.prank(governance);
        vm.expectEmit(true, false, false, false);
        emit ActionDomainRevoked(ACTION_DOMAIN_1);
        gate.revokeActionDomain(ACTION_DOMAIN_1);

        // Verify: Action domain is revoked immediately
        assertFalse(gate.allowedActionDomains(ACTION_DOMAIN_1));
    }

    /// @notice Only governance can propose action domain
    function test_RevertWhen_NonGovernanceProposeActionDomain() public {
        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        gate.proposeActionDomain(ACTION_DOMAIN_1);
    }

    /// @notice Only governance can cancel action domain
    function test_RevertWhen_NonGovernanceCancelActionDomain() public {
        // First propose
        vm.prank(governance);
        gate.proposeActionDomain(ACTION_DOMAIN_1);

        // Try to cancel as non-governance
        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        gate.cancelActionDomain(ACTION_DOMAIN_1);
    }

    /// @notice Only governance can revoke action domain
    function test_RevertWhen_NonGovernanceRevokeActionDomain() public {
        // First whitelist
        vm.prank(governance);
        gate.proposeActionDomain(ACTION_DOMAIN_1);
        vm.warp(block.timestamp + SEVEN_DAYS);
        gate.executeActionDomain(ACTION_DOMAIN_1);

        // Try to revoke as non-governance
        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        gate.revokeActionDomain(ACTION_DOMAIN_1);
    }

    /// @notice Anyone can execute action domain after timelock
    function test_AnyoneCanExecuteActionDomain_AfterTimelock() public {
        vm.prank(governance);
        gate.proposeActionDomain(ACTION_DOMAIN_1);

        // Warp past timelock
        vm.warp(block.timestamp + SEVEN_DAYS);

        // Execute as random user (not governance)
        vm.prank(attacker);
        gate.executeActionDomain(ACTION_DOMAIN_1);

        // Verify: Action domain is whitelisted
        assertTrue(gate.allowedActionDomains(ACTION_DOMAIN_1));
    }

    /// @notice Verify ActionDomainProposed event has correct data
    function test_ActionDomainProposed_EventData() public {
        uint256 startTime = block.timestamp;
        uint256 expectedExecuteTime = startTime + SEVEN_DAYS;

        vm.prank(governance);
        vm.expectEmit(true, false, false, true);
        emit ActionDomainProposed(ACTION_DOMAIN_1, expectedExecuteTime);
        gate.proposeActionDomain(ACTION_DOMAIN_1);
    }

    /// @notice Verify ActionDomainActivated event is emitted
    function test_ActionDomainActivated_EventEmitted() public {
        vm.prank(governance);
        gate.proposeActionDomain(ACTION_DOMAIN_1);
        vm.warp(block.timestamp + SEVEN_DAYS);

        vm.expectEmit(true, false, false, false);
        emit ActionDomainActivated(ACTION_DOMAIN_1);
        gate.executeActionDomain(ACTION_DOMAIN_1);
    }

    /// @notice Verify ActionDomainRevoked event is emitted
    function test_ActionDomainRevoked_EventEmitted() public {
        // Whitelist first
        vm.prank(governance);
        gate.proposeActionDomain(ACTION_DOMAIN_1);
        vm.warp(block.timestamp + SEVEN_DAYS);
        gate.executeActionDomain(ACTION_DOMAIN_1);

        // Revoke
        vm.prank(governance);
        vm.expectEmit(true, false, false, false);
        emit ActionDomainRevoked(ACTION_DOMAIN_1);
        gate.revokeActionDomain(ACTION_DOMAIN_1);
    }

    // ============================================================================
    // 3. PAUSE CONTROLS TESTS
    // ============================================================================

    /// @notice pause() only callable by governance
    function test_Pause_OnlyGovernance() public {
        vm.prank(governance);
        vm.expectEmit(true, false, false, false);
        emit ContractPaused(governance);
        gate.pause();

        assertTrue(gate.paused());
    }

    /// @notice unpause() only callable by governance
    function test_Unpause_OnlyGovernance() public {
        // First pause
        vm.prank(governance);
        gate.pause();

        // Then unpause
        vm.prank(governance);
        vm.expectEmit(true, false, false, false);
        emit ContractUnpaused(governance);
        gate.unpause();

        assertFalse(gate.paused());
    }

    /// @notice Non-governance cannot pause
    function test_RevertWhen_NonGovernancePause() public {
        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        gate.pause();
    }

    /// @notice Non-governance cannot unpause
    function test_RevertWhen_NonGovernanceUnpause() public {
        // First pause
        vm.prank(governance);
        gate.pause();

        // Try to unpause as non-governance
        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        gate.unpause();
    }

    /// @notice verifyAndAuthorizeWithSignature reverts when paused
    function test_RevertWhen_VerifyAndAuthorize_WhenPaused() public {
        // Whitelist action domain first
        vm.prank(governance);
        gate.proposeActionDomain(ACTION_DOMAIN_1);
        vm.warp(block.timestamp + SEVEN_DAYS);
        gate.executeActionDomain(ACTION_DOMAIN_1);

        // Pause the contract
        vm.prank(governance);
        gate.pause();

        // Setup signature
        bytes memory proof = hex"deadbeef";
        uint256 userPrivateKey = 0x1234;
        address signer = vm.addr(userPrivateKey);
        uint256 deadline = block.timestamp + 1 hours;

        (bytes memory signature, ) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA,
            deadline
        );

        // Try to verify - should revert with Pausable error
        vm.expectRevert("Pausable: paused");
        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );
    }

    /// @notice Verify ContractPaused event is emitted
    function test_ContractPaused_EventEmitted() public {
        vm.prank(governance);
        vm.expectEmit(true, false, false, false);
        emit ContractPaused(governance);
        gate.pause();
    }

    /// @notice Verify ContractUnpaused event is emitted
    function test_ContractUnpaused_EventEmitted() public {
        vm.prank(governance);
        gate.pause();

        vm.prank(governance);
        vm.expectEmit(true, false, false, false);
        emit ContractUnpaused(governance);
        gate.unpause();
    }

    // ============================================================================
    // 4. ACCESS CONTROL TESTS
    // ============================================================================

    /// @notice Non-governance cannot call governance-only functions - comprehensive test
    function test_AccessControl_NonGovernanceCannotCallGovernanceOnlyFunctions() public {
        // Test proposeCampaignRegistry
        vm.prank(user);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        gate.proposeCampaignRegistry(address(campaignRegistry));

        // Test cancelCampaignRegistry (need to set up pending proposal first)
        vm.prank(governance);
        gate.proposeCampaignRegistry(address(campaignRegistry));
        vm.prank(user);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        gate.cancelCampaignRegistry();
        // Clean up
        vm.prank(governance);
        gate.cancelCampaignRegistry();

        // Test proposeActionDomain
        vm.prank(user);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        gate.proposeActionDomain(ACTION_DOMAIN_1);

        // Test cancelActionDomain (need to set up pending proposal first)
        vm.prank(governance);
        gate.proposeActionDomain(ACTION_DOMAIN_1);
        vm.prank(user);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        gate.cancelActionDomain(ACTION_DOMAIN_1);
        // Clean up
        vm.prank(governance);
        gate.cancelActionDomain(ACTION_DOMAIN_1);

        // Test revokeActionDomain
        vm.prank(user);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        gate.revokeActionDomain(ACTION_DOMAIN_1);

        // Test pause
        vm.prank(user);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        gate.pause();

        // Test unpause (need to pause first)
        vm.prank(governance);
        gate.pause();
        vm.prank(user);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        gate.unpause();
    }

    /// @notice Verify UnauthorizedCaller error selector is correct
    function test_UnauthorizedCallerErrorSelector() public {
        bytes4 expectedSelector = TimelockGovernance.UnauthorizedCaller.selector;

        vm.prank(user);
        vm.expectRevert(expectedSelector);
        gate.pause();
    }

    // ============================================================================
    // 5. EDGE CASES
    // ============================================================================

    /// @notice Cancel non-existent campaign registry proposal fails
    function test_RevertWhen_CancelNonExistentCampaignRegistryProposal() public {
        vm.prank(governance);
        vm.expectRevert(DistrictGate.CampaignRegistryChangeNotProposed.selector);
        gate.cancelCampaignRegistry();
    }

    /// @notice Execute non-existent campaign registry proposal fails
    function test_RevertWhen_ExecuteNonExistentCampaignRegistryProposal() public {
        vm.expectRevert(DistrictGate.CampaignRegistryChangeNotProposed.selector);
        gate.executeCampaignRegistry();
    }

    /// @notice Double execute campaign registry fails
    function test_RevertWhen_DoubleExecuteCampaignRegistry() public {
        vm.prank(governance);
        gate.proposeCampaignRegistry(address(campaignRegistry));
        vm.warp(block.timestamp + SEVEN_DAYS);

        // First execute - should succeed
        gate.executeCampaignRegistry();

        // Second execute - should fail (pending state was cleared)
        vm.expectRevert(DistrictGate.CampaignRegistryChangeNotProposed.selector);
        gate.executeCampaignRegistry();
    }

    /// @notice Cancel non-existent action domain proposal fails
    function test_RevertWhen_CancelNonExistentActionDomainProposal() public {
        bytes32 fakeDomain = keccak256("never-proposed");

        vm.prank(governance);
        vm.expectRevert(DistrictGate.ActionDomainNotPending.selector);
        gate.cancelActionDomain(fakeDomain);
    }

    /// @notice Execute non-existent action domain proposal fails
    function test_RevertWhen_ExecuteNonExistentActionDomainProposal() public {
        bytes32 fakeDomain = keccak256("never-proposed");

        vm.expectRevert(DistrictGate.ActionDomainNotPending.selector);
        gate.executeActionDomain(fakeDomain);
    }

    /// @notice Double execute action domain fails
    function test_RevertWhen_DoubleExecuteActionDomain() public {
        vm.prank(governance);
        gate.proposeActionDomain(ACTION_DOMAIN_1);
        vm.warp(block.timestamp + SEVEN_DAYS);

        // First execute - should succeed
        gate.executeActionDomain(ACTION_DOMAIN_1);

        // Second execute - should fail (pending state was cleared)
        vm.expectRevert(DistrictGate.ActionDomainNotPending.selector);
        gate.executeActionDomain(ACTION_DOMAIN_1);
    }

    // ============================================================================
    // BR3-007: PENDING OPERATION GUARDS
    // ============================================================================

    /// @notice BR3-007: Propose when already pending should revert (prevents timelock reset)
    function test_RevertWhen_ProposeCampaignRegistry_WhenAlreadyPending() public {
        // First proposal
        vm.prank(governance);
        gate.proposeCampaignRegistry(address(campaignRegistry));

        // Advance time a bit
        vm.warp(block.timestamp + 1 days);

        // Second proposal should revert (prevents timelock reset attack)
        vm.prank(governance);
        vm.expectRevert(DistrictGate.OperationAlreadyPending.selector);
        gate.proposeCampaignRegistry(address(newCampaignRegistry));
    }

    /// @notice BR3-007: After cancel, can re-propose
    function test_ProposeCampaignRegistry_AfterCancel_Succeeds() public {
        // First proposal
        vm.prank(governance);
        gate.proposeCampaignRegistry(address(campaignRegistry));

        // Cancel
        vm.prank(governance);
        gate.cancelCampaignRegistry();

        // Now can propose again
        vm.prank(governance);
        gate.proposeCampaignRegistry(address(newCampaignRegistry));

        // Verify: New pending state
        assertEq(gate.pendingCampaignRegistry(), address(newCampaignRegistry));
    }

    /// @notice BR3-007: Propose action domain when already pending should revert
    function test_RevertWhen_ProposeActionDomain_WhenAlreadyPending() public {
        // First proposal
        vm.prank(governance);
        gate.proposeActionDomain(ACTION_DOMAIN_1);

        // Advance time a bit
        vm.warp(block.timestamp + 1 days);

        // Second proposal for same domain should revert
        vm.prank(governance);
        vm.expectRevert(DistrictGate.OperationAlreadyPending.selector);
        gate.proposeActionDomain(ACTION_DOMAIN_1);
    }

    /// @notice BR3-007: After cancel, can re-propose action domain
    function test_ProposeActionDomain_AfterCancel_Succeeds() public {
        // First proposal
        vm.prank(governance);
        gate.proposeActionDomain(ACTION_DOMAIN_1);

        // Cancel
        vm.prank(governance);
        gate.cancelActionDomain(ACTION_DOMAIN_1);

        // Now can propose again
        vm.prank(governance);
        gate.proposeActionDomain(ACTION_DOMAIN_1);

        // Verify: New pending state
        assertGt(gate.pendingActionDomains(ACTION_DOMAIN_1), 0);
    }

    /// @notice Revoking non-whitelisted action domain does not revert (idempotent)
    function test_RevokeActionDomain_WhenNotWhitelisted_DoesNotRevert() public {
        // ACTION_DOMAIN_1 was never whitelisted
        assertFalse(gate.allowedActionDomains(ACTION_DOMAIN_1));

        // Revoke should still work (just sets it to false, which it already is)
        vm.prank(governance);
        vm.expectEmit(true, false, false, false);
        emit ActionDomainRevoked(ACTION_DOMAIN_1);
        gate.revokeActionDomain(ACTION_DOMAIN_1);

        // Still false
        assertFalse(gate.allowedActionDomains(ACTION_DOMAIN_1));
    }

    /// @notice Multiple action domains can be proposed simultaneously
    function test_MultipleActionDomains_CanBePendingSimultaneously() public {
        vm.startPrank(governance);

        // Propose multiple action domains
        gate.proposeActionDomain(ACTION_DOMAIN_1);
        gate.proposeActionDomain(ACTION_DOMAIN_2);

        // Verify: Both are pending
        assertGt(gate.pendingActionDomains(ACTION_DOMAIN_1), 0);
        assertGt(gate.pendingActionDomains(ACTION_DOMAIN_2), 0);

        vm.stopPrank();

        // Warp past timelock
        vm.warp(block.timestamp + SEVEN_DAYS);

        // Execute both
        gate.executeActionDomain(ACTION_DOMAIN_1);
        gate.executeActionDomain(ACTION_DOMAIN_2);

        // Verify: Both are whitelisted
        assertTrue(gate.allowedActionDomains(ACTION_DOMAIN_1));
        assertTrue(gate.allowedActionDomains(ACTION_DOMAIN_2));
    }

    /// @notice Execute after cancelled proposal fails
    function test_RevertWhen_ExecuteAfterCancelledCampaignRegistryProposal() public {
        vm.prank(governance);
        gate.proposeCampaignRegistry(address(campaignRegistry));

        // Cancel
        vm.prank(governance);
        gate.cancelCampaignRegistry();

        // Warp past original timelock
        vm.warp(block.timestamp + SEVEN_DAYS);

        // Try to execute - should fail
        vm.expectRevert(DistrictGate.CampaignRegistryChangeNotProposed.selector);
        gate.executeCampaignRegistry();
    }

    /// @notice Execute after cancelled action domain proposal fails
    function test_RevertWhen_ExecuteAfterCancelledActionDomainProposal() public {
        vm.prank(governance);
        gate.proposeActionDomain(ACTION_DOMAIN_1);

        // Cancel
        vm.prank(governance);
        gate.cancelActionDomain(ACTION_DOMAIN_1);

        // Warp past original timelock
        vm.warp(block.timestamp + SEVEN_DAYS);

        // Try to execute - should fail
        vm.expectRevert(DistrictGate.ActionDomainNotPending.selector);
        gate.executeActionDomain(ACTION_DOMAIN_1);
    }

    /// @notice Timelock constant is 7 days
    function test_TimelockConstants_Are7Days() public view {
        assertEq(gate.CAMPAIGN_REGISTRY_TIMELOCK(), 7 days);
        assertEq(gate.ACTION_DOMAIN_TIMELOCK(), 7 days);
    }

    /// @notice Pausing twice reverts (OpenZeppelin Pausable behavior)
    function test_RevertWhen_PauseTwice() public {
        vm.prank(governance);
        gate.pause();

        vm.prank(governance);
        vm.expectRevert("Pausable: paused");
        gate.pause();
    }

    /// @notice Unpausing when not paused reverts (OpenZeppelin Pausable behavior)
    function test_RevertWhen_UnpauseWhenNotPaused() public {
        vm.prank(governance);
        vm.expectRevert("Pausable: not paused");
        gate.unpause();
    }

    // ============================================================================
    // Helper Functions
    // ============================================================================

    /// @notice Helper to generate EIP-712 signature for proof submission
    function _generateSignature(
        uint256 privateKey,
        address signer,
        bytes memory proof,
        bytes32 districtRoot,
        bytes32 nullifier,
        bytes32 authorityLevel,
        bytes32 actionDomain,
        bytes32 districtId,
        bytes3 country,
        uint256 deadline
    ) internal view returns (bytes memory signature, uint256 returnedDeadline) {
        returnedDeadline = deadline;
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
}

/// @notice Mock verifier that always returns true
contract MockVerifierGov {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        return true;
    }
}
