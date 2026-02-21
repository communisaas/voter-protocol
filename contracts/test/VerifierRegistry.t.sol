// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "forge-std/Test.sol";
import "../src/VerifierRegistry.sol";
import "../src/TimelockGovernance.sol";

/// @title VerifierRegistry Tests
/// @notice Tests for VerifierRegistry with genesis + timelock model
/// @dev Tests cover:
///      1. Genesis Registration (direct, no timelock)
///      2. Genesis Seal (irreversible)
///      3. Post-Genesis Registration Timelock (HIGH-001 FIX)
///      4. Verifier Upgrade Timelock
///      5. Access Control
///      6. Edge Cases and Security
///      7. View Functions
///      8. Attack Scenario (HIGH-001)
contract VerifierRegistryTest is Test {
    VerifierRegistry public registry;

    address public governance = address(0x1);
    address public user = address(0x2);
    address public attacker = address(0x3);

    address public verifier18 = address(0x1818);
    address public verifier20 = address(0x2020);
    address public verifier22 = address(0x2222);
    address public verifier24 = address(0x2424);
    address public newVerifier = address(0x9999);
    address public maliciousVerifier = address(0xBAD);

    uint8 public constant DEPTH_18 = 18;
    uint8 public constant DEPTH_20 = 20;
    uint8 public constant DEPTH_22 = 22;
    uint8 public constant DEPTH_24 = 24;

    uint256 public constant FOURTEEN_DAYS = 14 days;

    // Two-tree events
    event VerifierProposed(uint8 indexed depth, address indexed verifier, uint256 executeTime, bool isUpgrade);
    event VerifierRegistered(uint8 indexed depth, address indexed verifier);
    event VerifierUpgraded(uint8 indexed depth, address indexed previousVerifier, address indexed newVerifier);
    event VerifierProposalCancelled(uint8 indexed depth, address indexed target);
    event GenesisSealed();

    // Three-tree events
    event ThreeTreeVerifierRegistered(uint8 indexed depth, address indexed verifier);
    event ThreeTreeVerifierProposed(uint8 indexed depth, address indexed verifier, uint256 executeTime, bool isUpgrade);
    event ThreeTreeVerifierUpgraded(uint8 indexed depth, address indexed previousVerifier, address indexed newVerifier);
    event ThreeTreeVerifierProposalCancelled(uint8 indexed depth, address indexed target);

    function setUp() public {
        registry = new VerifierRegistry(governance);
    }

    // ============================================================================
    // 1. GENESIS REGISTRATION TESTS
    // ============================================================================

    /// @notice Genesis: registerVerifier works before seal
    function test_RegisterVerifier_GenesisDirectRegistration() public {
        vm.prank(governance);
        vm.expectEmit(true, true, false, false);
        emit VerifierRegistered(DEPTH_18, verifier18);
        registry.registerVerifier(DEPTH_18, verifier18);

        // Verifier is IMMEDIATELY active
        assertEq(registry.verifierByDepth(DEPTH_18), verifier18);
        assertTrue(registry.isVerifierRegistered(DEPTH_18));
    }

    /// @notice Genesis: can register all 4 depths directly
    function test_RegisterVerifier_AllDepths() public {
        vm.startPrank(governance);
        registry.registerVerifier(DEPTH_18, verifier18);
        registry.registerVerifier(DEPTH_20, verifier20);
        registry.registerVerifier(DEPTH_22, verifier22);
        registry.registerVerifier(DEPTH_24, verifier24);
        vm.stopPrank();

        assertEq(registry.verifierByDepth(DEPTH_18), verifier18);
        assertEq(registry.verifierByDepth(DEPTH_20), verifier20);
        assertEq(registry.verifierByDepth(DEPTH_22), verifier22);
        assertEq(registry.verifierByDepth(DEPTH_24), verifier24);
    }

    /// @notice Genesis: cannot register same depth twice
    function test_RevertWhen_GenesisDoubleRegister() public {
        vm.startPrank(governance);
        registry.registerVerifier(DEPTH_18, verifier18);

        vm.expectRevert(VerifierRegistry.VerifierAlreadyRegistered.selector);
        registry.registerVerifier(DEPTH_18, newVerifier);
        vm.stopPrank();
    }

    /// @notice Genesis: cannot register zero address
    function test_RevertWhen_GenesisZeroAddress() public {
        vm.prank(governance);
        vm.expectRevert(TimelockGovernance.ZeroAddress.selector);
        registry.registerVerifier(DEPTH_18, address(0));
    }

    /// @notice Genesis: cannot register invalid depth
    function test_RevertWhen_GenesisInvalidDepth() public {
        vm.startPrank(governance);

        vm.expectRevert(VerifierRegistry.InvalidDepth.selector);
        registry.registerVerifier(16, verifier18);

        vm.expectRevert(VerifierRegistry.InvalidDepth.selector);
        registry.registerVerifier(26, verifier18);

        vm.expectRevert(VerifierRegistry.InvalidDepth.selector);
        registry.registerVerifier(19, verifier18);

        vm.stopPrank();
    }

    /// @notice Genesis: only governance can register
    function test_RevertWhen_NonGovernanceGenesisRegister() public {
        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.registerVerifier(DEPTH_18, verifier18);
    }

    /// @notice Genesis: registerVerifier fails after seal
    function test_RevertWhen_RegisterAfterSeal() public {
        vm.startPrank(governance);
        registry.sealGenesis();

        vm.expectRevert(VerifierRegistry.GenesisAlreadySealed.selector);
        registry.registerVerifier(DEPTH_18, verifier18);
        vm.stopPrank();
    }

    // ============================================================================
    // 2. GENESIS SEAL TESTS
    // ============================================================================

    /// @notice sealGenesis is irreversible
    function test_SealGenesis() public {
        vm.prank(governance);
        vm.expectEmit(false, false, false, false);
        emit GenesisSealed();
        registry.sealGenesis();

        assertTrue(registry.genesisSealed());
    }

    /// @notice Cannot seal twice
    function test_RevertWhen_DoubleSeal() public {
        vm.startPrank(governance);
        registry.sealGenesis();

        vm.expectRevert(VerifierRegistry.GenesisAlreadySealed.selector);
        registry.sealGenesis();
        vm.stopPrank();
    }

    /// @notice Only governance can seal
    function test_RevertWhen_NonGovernanceSeal() public {
        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.sealGenesis();
    }

    /// @notice Genesis starts unsealed
    function test_GenesisStartsUnsealed() public view {
        assertFalse(registry.genesisSealed());
    }

    // ============================================================================
    // 3. POST-GENESIS REGISTRATION TIMELOCK TESTS (HIGH-001 FIX)
    // ============================================================================

    /// @notice Post-genesis: proposeVerifier requires seal
    function test_RevertWhen_ProposeBeforeSeal() public {
        vm.prank(governance);
        vm.expectRevert("Seal genesis first");
        registry.proposeVerifier(DEPTH_18, verifier18);
    }

    /// @notice Post-genesis: proposeVerifier starts 14-day timelock
    function test_ProposeVerifier_StartsTimelock() public {
        _sealGenesis();

        uint256 expectedExecuteTime = block.timestamp + FOURTEEN_DAYS;

        vm.prank(governance);
        vm.expectEmit(true, true, false, true);
        emit VerifierProposed(DEPTH_18, verifier18, expectedExecuteTime, false);
        registry.proposeVerifier(DEPTH_18, verifier18);

        // Pending state set
        assertEq(registry.pendingVerifiers(DEPTH_18), verifier18);
        assertEq(registry.verifierExecutionTime(DEPTH_18), expectedExecuteTime);

        // NOT yet registered
        assertEq(registry.verifierByDepth(DEPTH_18), address(0));
    }

    /// @notice Post-genesis: executeVerifier fails before timelock
    function test_RevertWhen_ExecuteVerifierBeforeTimelock() public {
        _sealGenesis();

        vm.prank(governance);
        registry.proposeVerifier(DEPTH_18, verifier18);

        vm.expectRevert(TimelockGovernance.TimelockNotExpired.selector);
        registry.executeVerifier(DEPTH_18);

        vm.warp(block.timestamp + FOURTEEN_DAYS - 1);
        vm.expectRevert(TimelockGovernance.TimelockNotExpired.selector);
        registry.executeVerifier(DEPTH_18);
    }

    /// @notice Post-genesis: executeVerifier succeeds after timelock
    function test_ExecuteVerifier_SucceedsAfterTimelock() public {
        _sealGenesis();

        vm.prank(governance);
        registry.proposeVerifier(DEPTH_18, verifier18);

        vm.warp(block.timestamp + FOURTEEN_DAYS);

        vm.expectEmit(true, true, false, false);
        emit VerifierRegistered(DEPTH_18, verifier18);
        registry.executeVerifier(DEPTH_18);

        assertEq(registry.verifierByDepth(DEPTH_18), verifier18);
        assertTrue(registry.isVerifierRegistered(DEPTH_18));

        // Pending state cleared
        assertEq(registry.pendingVerifiers(DEPTH_18), address(0));
        assertEq(registry.verifierExecutionTime(DEPTH_18), 0);
    }

    /// @notice Post-genesis: cancelVerifier clears pending
    function test_CancelVerifier_ClearsPendingProposal() public {
        _sealGenesis();

        vm.prank(governance);
        registry.proposeVerifier(DEPTH_18, verifier18);

        vm.prank(governance);
        vm.expectEmit(true, true, false, false);
        emit VerifierProposalCancelled(DEPTH_18, verifier18);
        registry.cancelVerifier(DEPTH_18);

        assertEq(registry.pendingVerifiers(DEPTH_18), address(0));
        assertEq(registry.verifierExecutionTime(DEPTH_18), 0);
    }

    /// @notice Post-genesis: anyone can execute after timelock
    function test_AnyoneCanExecuteVerifier_AfterTimelock() public {
        _sealGenesis();

        vm.prank(governance);
        registry.proposeVerifier(DEPTH_18, verifier18);

        vm.warp(block.timestamp + FOURTEEN_DAYS);

        vm.prank(attacker);
        registry.executeVerifier(DEPTH_18);

        assertEq(registry.verifierByDepth(DEPTH_18), verifier18);
    }

    /// @notice Post-genesis: cannot propose when proposal already pending
    function test_RevertWhen_ProposalAlreadyPending() public {
        _sealGenesis();

        vm.prank(governance);
        registry.proposeVerifier(DEPTH_18, verifier18);

        vm.prank(governance);
        vm.expectRevert(VerifierRegistry.ProposalAlreadyPending.selector);
        registry.proposeVerifier(DEPTH_18, newVerifier);
    }

    /// @notice Post-genesis: cannot propose for depth with existing verifier
    function test_RevertWhen_VerifierAlreadyRegistered() public {
        _registerAndSeal(DEPTH_18, verifier18);

        vm.prank(governance);
        vm.expectRevert(VerifierRegistry.VerifierAlreadyRegistered.selector);
        registry.proposeVerifier(DEPTH_18, newVerifier);
    }

    // ============================================================================
    // 4. VERIFIER UPGRADE TIMELOCK TESTS
    // ============================================================================

    /// @notice proposeVerifierUpgrade starts 14-day timelock
    function test_ProposeVerifierUpgrade_StartsTimelock() public {
        _registerAndSeal(DEPTH_18, verifier18);

        uint256 expectedExecuteTime = block.timestamp + FOURTEEN_DAYS;

        vm.prank(governance);
        vm.expectEmit(true, true, false, true);
        emit VerifierProposed(DEPTH_18, newVerifier, expectedExecuteTime, true);
        registry.proposeVerifierUpgrade(DEPTH_18, newVerifier);

        assertEq(registry.pendingVerifiers(DEPTH_18), newVerifier);
        assertEq(registry.verifierByDepth(DEPTH_18), verifier18); // Original still active
    }

    /// @notice executeVerifierUpgrade fails before timelock
    function test_RevertWhen_ExecuteVerifierUpgradeBeforeTimelock() public {
        _registerAndSeal(DEPTH_18, verifier18);

        vm.prank(governance);
        registry.proposeVerifierUpgrade(DEPTH_18, newVerifier);

        vm.expectRevert(TimelockGovernance.TimelockNotExpired.selector);
        registry.executeVerifierUpgrade(DEPTH_18);

        vm.warp(block.timestamp + FOURTEEN_DAYS - 1);
        vm.expectRevert(TimelockGovernance.TimelockNotExpired.selector);
        registry.executeVerifierUpgrade(DEPTH_18);
    }

    /// @notice executeVerifierUpgrade succeeds after timelock
    function test_ExecuteVerifierUpgrade_SucceedsAfterTimelock() public {
        _registerAndSeal(DEPTH_18, verifier18);

        vm.prank(governance);
        registry.proposeVerifierUpgrade(DEPTH_18, newVerifier);

        vm.warp(block.timestamp + FOURTEEN_DAYS);

        vm.expectEmit(true, true, true, false);
        emit VerifierUpgraded(DEPTH_18, verifier18, newVerifier);
        registry.executeVerifierUpgrade(DEPTH_18);

        assertEq(registry.verifierByDepth(DEPTH_18), newVerifier);
        assertEq(registry.pendingVerifiers(DEPTH_18), address(0));
    }

    /// @notice cancelVerifierUpgrade clears pending
    function test_CancelVerifierUpgrade_ClearsPendingUpgrade() public {
        _registerAndSeal(DEPTH_18, verifier18);

        vm.prank(governance);
        registry.proposeVerifierUpgrade(DEPTH_18, newVerifier);

        vm.prank(governance);
        vm.expectEmit(true, true, false, false);
        emit VerifierProposalCancelled(DEPTH_18, newVerifier);
        registry.cancelVerifierUpgrade(DEPTH_18);

        assertEq(registry.verifierByDepth(DEPTH_18), verifier18);
        assertEq(registry.pendingVerifiers(DEPTH_18), address(0));
    }

    /// @notice Cannot upgrade when no verifier registered
    function test_RevertWhen_UpgradeWithoutExistingVerifier() public {
        vm.prank(governance);
        vm.expectRevert(VerifierRegistry.VerifierNotRegistered.selector);
        registry.proposeVerifierUpgrade(DEPTH_18, newVerifier);
    }

    /// @notice Cannot upgrade to same verifier
    function test_RevertWhen_UpgradeToSameVerifier() public {
        _registerAndSeal(DEPTH_18, verifier18);

        vm.prank(governance);
        vm.expectRevert(TimelockGovernance.SameAddress.selector);
        registry.proposeVerifierUpgrade(DEPTH_18, verifier18);
    }

    // ============================================================================
    // 5. ACCESS CONTROL TESTS
    // ============================================================================

    /// @notice Only governance can propose verifier
    function test_RevertWhen_NonGovernanceProposeVerifier() public {
        _sealGenesis();

        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.proposeVerifier(DEPTH_18, verifier18);
    }

    /// @notice Only governance can cancel verifier
    function test_RevertWhen_NonGovernanceCancelVerifier() public {
        _sealGenesis();

        vm.prank(governance);
        registry.proposeVerifier(DEPTH_18, verifier18);

        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.cancelVerifier(DEPTH_18);
    }

    /// @notice Only governance can propose upgrade
    function test_RevertWhen_NonGovernanceProposeUpgrade() public {
        _registerAndSeal(DEPTH_18, verifier18);

        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.proposeVerifierUpgrade(DEPTH_18, newVerifier);
    }

    /// @notice Only governance can cancel upgrade
    function test_RevertWhen_NonGovernanceCancelUpgrade() public {
        _registerAndSeal(DEPTH_18, verifier18);

        vm.prank(governance);
        registry.proposeVerifierUpgrade(DEPTH_18, newVerifier);

        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.cancelVerifierUpgrade(DEPTH_18);
    }

    // ============================================================================
    // 6. EDGE CASES AND SECURITY
    // ============================================================================

    /// @notice Cannot propose zero address verifier
    function test_RevertWhen_ProposeZeroAddress() public {
        _sealGenesis();

        vm.prank(governance);
        vm.expectRevert(TimelockGovernance.ZeroAddress.selector);
        registry.proposeVerifier(DEPTH_18, address(0));
    }

    /// @notice Cannot upgrade to zero address
    function test_RevertWhen_UpgradeToZeroAddress() public {
        _registerAndSeal(DEPTH_18, verifier18);

        vm.prank(governance);
        vm.expectRevert(TimelockGovernance.ZeroAddress.selector);
        registry.proposeVerifierUpgrade(DEPTH_18, address(0));
    }

    /// @notice Cannot propose invalid depth
    function test_RevertWhen_ProposeInvalidDepth() public {
        _sealGenesis();

        vm.startPrank(governance);

        vm.expectRevert(VerifierRegistry.InvalidDepth.selector);
        registry.proposeVerifier(16, verifier18);

        vm.expectRevert(VerifierRegistry.InvalidDepth.selector);
        registry.proposeVerifier(26, verifier18);

        vm.expectRevert(VerifierRegistry.InvalidDepth.selector);
        registry.proposeVerifier(19, verifier18);

        vm.stopPrank();
    }

    /// @notice Cancel non-existent proposal fails
    function test_RevertWhen_CancelNonExistentProposal() public {
        vm.prank(governance);
        vm.expectRevert(VerifierRegistry.ProposalNotInitiated.selector);
        registry.cancelVerifier(DEPTH_18);
    }

    /// @notice Execute non-existent proposal fails
    function test_RevertWhen_ExecuteNonExistentProposal() public {
        vm.expectRevert(VerifierRegistry.ProposalNotInitiated.selector);
        registry.executeVerifier(DEPTH_18);
    }

    /// @notice Double execute fails
    function test_RevertWhen_DoubleExecute() public {
        _sealGenesis();

        vm.prank(governance);
        registry.proposeVerifier(DEPTH_18, verifier18);
        vm.warp(block.timestamp + FOURTEEN_DAYS);

        registry.executeVerifier(DEPTH_18);

        vm.expectRevert(VerifierRegistry.ProposalNotInitiated.selector);
        registry.executeVerifier(DEPTH_18);
    }

    /// @notice Execute after cancel fails
    function test_RevertWhen_ExecuteAfterCancel() public {
        _sealGenesis();

        vm.prank(governance);
        registry.proposeVerifier(DEPTH_18, verifier18);

        vm.prank(governance);
        registry.cancelVerifier(DEPTH_18);

        vm.warp(block.timestamp + FOURTEEN_DAYS);

        vm.expectRevert(VerifierRegistry.ProposalNotInitiated.selector);
        registry.executeVerifier(DEPTH_18);
    }

    /// @notice Multiple depths can have pending proposals simultaneously
    function test_MultiplePendingProposals() public {
        _sealGenesis();

        vm.startPrank(governance);
        registry.proposeVerifier(DEPTH_18, verifier18);
        registry.proposeVerifier(DEPTH_20, verifier20);
        registry.proposeVerifier(DEPTH_22, verifier22);
        registry.proposeVerifier(DEPTH_24, verifier24);
        vm.stopPrank();

        assertEq(registry.pendingVerifiers(DEPTH_18), verifier18);
        assertEq(registry.pendingVerifiers(DEPTH_20), verifier20);
        assertEq(registry.pendingVerifiers(DEPTH_22), verifier22);
        assertEq(registry.pendingVerifiers(DEPTH_24), verifier24);

        vm.warp(block.timestamp + FOURTEEN_DAYS);

        registry.executeVerifier(DEPTH_18);
        registry.executeVerifier(DEPTH_20);
        registry.executeVerifier(DEPTH_22);
        registry.executeVerifier(DEPTH_24);

        assertEq(registry.verifierByDepth(DEPTH_18), verifier18);
        assertEq(registry.verifierByDepth(DEPTH_20), verifier20);
        assertEq(registry.verifierByDepth(DEPTH_22), verifier22);
        assertEq(registry.verifierByDepth(DEPTH_24), verifier24);
    }

    /// @notice Timelock constant is 14 days
    function test_TimelockConstant() public view {
        assertEq(registry.VERIFIER_TIMELOCK(), 14 days);
    }

    /// @notice executeVerifier after manual genesis registration fails
    function test_RevertWhen_ExecuteVerifierAfterManualRegistration() public {
        // Register via genesis
        vm.prank(governance);
        registry.registerVerifier(DEPTH_18, verifier18);
        _sealGenesis();

        // Try to propose for same depth — should fail
        vm.prank(governance);
        vm.expectRevert(VerifierRegistry.VerifierAlreadyRegistered.selector);
        registry.proposeVerifier(DEPTH_18, newVerifier);
    }

    // ============================================================================
    // 7. VIEW FUNCTION TESTS
    // ============================================================================

    /// @notice getVerifier returns correct address
    function test_GetVerifier_ReturnsCorrectAddress() public {
        _registerAndSeal(DEPTH_18, verifier18);

        assertEq(registry.getVerifier(DEPTH_18), verifier18);
        assertEq(registry.getVerifier(DEPTH_20), address(0));
    }

    /// @notice isVerifierRegistered returns correct value
    function test_IsVerifierRegistered_ReturnsCorrectValue() public {
        assertFalse(registry.isVerifierRegistered(DEPTH_18));

        _registerAndSeal(DEPTH_18, verifier18);

        assertTrue(registry.isVerifierRegistered(DEPTH_18));
        assertFalse(registry.isVerifierRegistered(DEPTH_20));
    }

    /// @notice getProposalDelay returns correct values
    function test_GetProposalDelay_ReturnsCorrectValues() public {
        _sealGenesis();

        uint256 startTime = block.timestamp;

        // No proposal
        assertEq(registry.getProposalDelay(DEPTH_18), 0);

        vm.prank(governance);
        registry.proposeVerifier(DEPTH_18, verifier18);

        assertEq(registry.getProposalDelay(DEPTH_18), FOURTEEN_DAYS);

        vm.warp(startTime + 7 days);
        assertEq(registry.getProposalDelay(DEPTH_18), 7 days);

        vm.warp(startTime + FOURTEEN_DAYS);
        assertEq(registry.getProposalDelay(DEPTH_18), 0);
    }

    /// @notice hasPendingProposal returns correct value
    function test_HasPendingProposal_ReturnsCorrectValue() public {
        _sealGenesis();

        assertFalse(registry.hasPendingProposal(DEPTH_18));

        vm.prank(governance);
        registry.proposeVerifier(DEPTH_18, verifier18);

        assertTrue(registry.hasPendingProposal(DEPTH_18));

        vm.warp(block.timestamp + FOURTEEN_DAYS);
        registry.executeVerifier(DEPTH_18);

        assertFalse(registry.hasPendingProposal(DEPTH_18));
    }

    /// @notice getPendingProposal returns correct values
    function test_GetPendingProposal_ReturnsCorrectValues() public {
        // No proposal
        (address verifier, uint256 executeTime, bool isUpgrade) = registry.getPendingProposal(DEPTH_18);
        assertEq(verifier, address(0));
        assertEq(executeTime, 0);
        assertFalse(isUpgrade);

        // Register via genesis, seal, then propose upgrade
        _registerAndSeal(DEPTH_18, verifier18);

        vm.prank(governance);
        registry.proposeVerifierUpgrade(DEPTH_18, newVerifier);

        (verifier, executeTime, isUpgrade) = registry.getPendingProposal(DEPTH_18);
        assertEq(verifier, newVerifier);
        assertTrue(isUpgrade);
    }

    /// @notice getRegisteredDepths returns correct array
    function test_GetRegisteredDepths_ReturnsCorrectArray() public {
        // Initially empty
        uint8[] memory depths = registry.getRegisteredDepths();
        assertEq(depths.length, 0);

        // Register some via genesis
        vm.startPrank(governance);
        registry.registerVerifier(DEPTH_18, verifier18);
        registry.registerVerifier(DEPTH_22, verifier22);
        vm.stopPrank();

        depths = registry.getRegisteredDepths();
        assertEq(depths.length, 2);
        assertEq(depths[0], DEPTH_18);
        assertEq(depths[1], DEPTH_22);

        // Register all
        vm.startPrank(governance);
        registry.registerVerifier(DEPTH_20, verifier20);
        registry.registerVerifier(DEPTH_24, verifier24);
        vm.stopPrank();

        depths = registry.getRegisteredDepths();
        assertEq(depths.length, 4);
        assertEq(depths[0], DEPTH_18);
        assertEq(depths[1], DEPTH_20);
        assertEq(depths[2], DEPTH_22);
        assertEq(depths[3], DEPTH_24);
    }

    // ============================================================================
    // 8. ATTACK SCENARIO TESTS (HIGH-001)
    // ============================================================================

    /// @notice HIGH-001: Post-genesis front-running attack is prevented
    function test_HIGH001_FrontRunningAttackPrevented() public {
        // Register initial verifier and seal genesis
        _registerAndSeal(DEPTH_18, verifier18);

        // Attacker compromises governance key and tries to register a new depth
        vm.prank(governance);
        registry.proposeVerifier(DEPTH_20, maliciousVerifier);

        // Cannot execute immediately
        vm.expectRevert(TimelockGovernance.TimelockNotExpired.selector);
        registry.executeVerifier(DEPTH_20);

        // 13 days later — still blocked
        vm.warp(block.timestamp + 13 days);
        vm.expectRevert(TimelockGovernance.TimelockNotExpired.selector);
        registry.executeVerifier(DEPTH_20);

        // Legitimate governance cancels
        vm.prank(governance);
        registry.cancelVerifier(DEPTH_20);

        assertEq(registry.verifierByDepth(DEPTH_20), address(0));
    }

    /// @notice HIGH-001: Genesis registration cannot be exploited post-seal
    function test_HIGH001_GenesisCannotBeExploitedPostSeal() public {
        vm.startPrank(governance);
        registry.registerVerifier(DEPTH_18, verifier18);
        registry.sealGenesis();

        // Genesis path is closed — even governance cannot bypass timelock
        vm.expectRevert(VerifierRegistry.GenesisAlreadySealed.selector);
        registry.registerVerifier(DEPTH_20, maliciousVerifier);
        vm.stopPrank();
    }

    /// @notice HIGH-001: Community has 14 days to respond post-genesis
    function test_HIGH001_CommunityResponseWindow() public {
        _sealGenesis();
        uint256 startTime = block.timestamp;

        vm.prank(governance);
        registry.proposeVerifier(DEPTH_18, verifier18);

        uint256 executeTime = registry.verifierExecutionTime(DEPTH_18);
        assertEq(executeTime, startTime + FOURTEEN_DAYS);
        assertEq(registry.getProposalDelay(DEPTH_18), FOURTEEN_DAYS);
    }

    // ============================================================================
    // 9. THREE-TREE VERIFIER GENESIS TESTS
    // ============================================================================

    /// @notice Three-tree genesis: direct registration works
    function test_ThreeTree_GenesisRegistration() public {
        vm.prank(governance);
        vm.expectEmit(true, true, false, false);
        emit ThreeTreeVerifierRegistered(DEPTH_20, verifier20);
        registry.registerThreeTreeVerifier(DEPTH_20, verifier20);

        assertEq(registry.threeTreeVerifierByDepth(DEPTH_20), verifier20);
        assertTrue(registry.isThreeTreeVerifierRegistered(DEPTH_20));
    }

    /// @notice Three-tree genesis: all 4 depths can be registered
    function test_ThreeTree_GenesisAllDepths() public {
        vm.startPrank(governance);
        registry.registerThreeTreeVerifier(DEPTH_18, verifier18);
        registry.registerThreeTreeVerifier(DEPTH_20, verifier20);
        registry.registerThreeTreeVerifier(DEPTH_22, verifier22);
        registry.registerThreeTreeVerifier(DEPTH_24, verifier24);
        vm.stopPrank();

        assertEq(registry.threeTreeVerifierByDepth(DEPTH_18), verifier18);
        assertEq(registry.threeTreeVerifierByDepth(DEPTH_20), verifier20);
        assertEq(registry.threeTreeVerifierByDepth(DEPTH_22), verifier22);
        assertEq(registry.threeTreeVerifierByDepth(DEPTH_24), verifier24);
    }

    /// @notice Three-tree genesis: cannot register same depth twice
    function test_RevertWhen_ThreeTreeGenesisDoubleRegister() public {
        vm.startPrank(governance);
        registry.registerThreeTreeVerifier(DEPTH_18, verifier18);
        vm.expectRevert(VerifierRegistry.VerifierAlreadyRegistered.selector);
        registry.registerThreeTreeVerifier(DEPTH_18, newVerifier);
        vm.stopPrank();
    }

    /// @notice Three-tree genesis: cannot register zero address
    function test_RevertWhen_ThreeTreeGenesisZeroAddress() public {
        vm.prank(governance);
        vm.expectRevert(TimelockGovernance.ZeroAddress.selector);
        registry.registerThreeTreeVerifier(DEPTH_18, address(0));
    }

    /// @notice Three-tree genesis: cannot register invalid depth
    function test_RevertWhen_ThreeTreeGenesisInvalidDepth() public {
        vm.startPrank(governance);
        vm.expectRevert(VerifierRegistry.InvalidDepth.selector);
        registry.registerThreeTreeVerifier(16, verifier18);
        vm.expectRevert(VerifierRegistry.InvalidDepth.selector);
        registry.registerThreeTreeVerifier(19, verifier18);
        vm.stopPrank();
    }

    /// @notice Three-tree genesis: only governance can register
    function test_RevertWhen_ThreeTreeGenesisNonGovernance() public {
        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.registerThreeTreeVerifier(DEPTH_18, verifier18);
    }

    /// @notice Three-tree genesis: fails after seal
    function test_RevertWhen_ThreeTreeRegisterAfterSeal() public {
        vm.startPrank(governance);
        registry.sealGenesis();
        vm.expectRevert(VerifierRegistry.GenesisAlreadySealed.selector);
        registry.registerThreeTreeVerifier(DEPTH_18, verifier18);
        vm.stopPrank();
    }

    /// @notice Two-tree and three-tree registrations are independent
    function test_ThreeTree_IndependentFromTwoTree() public {
        vm.startPrank(governance);
        registry.registerVerifier(DEPTH_20, verifier20);
        registry.registerThreeTreeVerifier(DEPTH_20, verifier22); // Different address, same depth
        vm.stopPrank();

        assertEq(registry.verifierByDepth(DEPTH_20), verifier20);
        assertEq(registry.threeTreeVerifierByDepth(DEPTH_20), verifier22);
        assertFalse(registry.verifierByDepth(DEPTH_20) == registry.threeTreeVerifierByDepth(DEPTH_20));
    }

    // ============================================================================
    // 10. THREE-TREE POST-GENESIS REGISTRATION TESTS
    // ============================================================================

    /// @notice Three-tree post-genesis: propose starts 14-day timelock
    function test_ThreeTree_ProposeStartsTimelock() public {
        _sealGenesis();
        uint256 expectedExecuteTime = block.timestamp + FOURTEEN_DAYS;

        vm.prank(governance);
        vm.expectEmit(true, true, false, true);
        emit ThreeTreeVerifierProposed(DEPTH_18, verifier18, expectedExecuteTime, false);
        registry.proposeThreeTreeVerifier(DEPTH_18, verifier18);

        assertEq(registry.pendingThreeTreeVerifiers(DEPTH_18), verifier18);
        assertEq(registry.threeTreeVerifierExecutionTime(DEPTH_18), expectedExecuteTime);
        assertEq(registry.threeTreeVerifierByDepth(DEPTH_18), address(0)); // NOT yet active
    }

    /// @notice Three-tree post-genesis: execute fails before timelock
    function test_RevertWhen_ThreeTreeExecuteBeforeTimelock() public {
        _sealGenesis();

        vm.prank(governance);
        registry.proposeThreeTreeVerifier(DEPTH_18, verifier18);

        vm.expectRevert(TimelockGovernance.TimelockNotExpired.selector);
        registry.executeThreeTreeVerifier(DEPTH_18);

        vm.warp(block.timestamp + FOURTEEN_DAYS - 1);
        vm.expectRevert(TimelockGovernance.TimelockNotExpired.selector);
        registry.executeThreeTreeVerifier(DEPTH_18);
    }

    /// @notice Three-tree post-genesis: execute succeeds after timelock
    function test_ThreeTree_ExecuteSucceedsAfterTimelock() public {
        _sealGenesis();

        vm.prank(governance);
        registry.proposeThreeTreeVerifier(DEPTH_18, verifier18);

        vm.warp(block.timestamp + FOURTEEN_DAYS);

        vm.expectEmit(true, true, false, false);
        emit ThreeTreeVerifierRegistered(DEPTH_18, verifier18);
        registry.executeThreeTreeVerifier(DEPTH_18);

        assertEq(registry.threeTreeVerifierByDepth(DEPTH_18), verifier18);
        assertTrue(registry.isThreeTreeVerifierRegistered(DEPTH_18));
        assertEq(registry.pendingThreeTreeVerifiers(DEPTH_18), address(0));
        assertEq(registry.threeTreeVerifierExecutionTime(DEPTH_18), 0);
    }

    /// @notice Three-tree post-genesis: anyone can execute after timelock
    function test_ThreeTree_AnyoneCanExecuteAfterTimelock() public {
        _sealGenesis();

        vm.prank(governance);
        registry.proposeThreeTreeVerifier(DEPTH_18, verifier18);

        vm.warp(block.timestamp + FOURTEEN_DAYS);

        vm.prank(attacker);
        registry.executeThreeTreeVerifier(DEPTH_18);

        assertEq(registry.threeTreeVerifierByDepth(DEPTH_18), verifier18);
    }

    /// @notice Three-tree post-genesis: cancel clears pending
    function test_ThreeTree_CancelClearsPending() public {
        _sealGenesis();

        vm.prank(governance);
        registry.proposeThreeTreeVerifier(DEPTH_18, verifier18);

        vm.prank(governance);
        vm.expectEmit(true, true, false, false);
        emit ThreeTreeVerifierProposalCancelled(DEPTH_18, verifier18);
        registry.cancelThreeTreeVerifier(DEPTH_18);

        assertEq(registry.pendingThreeTreeVerifiers(DEPTH_18), address(0));
        assertEq(registry.threeTreeVerifierExecutionTime(DEPTH_18), 0);
    }

    /// @notice Three-tree post-genesis: cannot propose when already pending
    function test_RevertWhen_ThreeTreeProposalAlreadyPending() public {
        _sealGenesis();

        vm.prank(governance);
        registry.proposeThreeTreeVerifier(DEPTH_18, verifier18);

        vm.prank(governance);
        vm.expectRevert(VerifierRegistry.ProposalAlreadyPending.selector);
        registry.proposeThreeTreeVerifier(DEPTH_18, newVerifier);
    }

    /// @notice Three-tree post-genesis: only governance can propose
    function test_RevertWhen_ThreeTreeNonGovernancePropose() public {
        _sealGenesis();

        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.proposeThreeTreeVerifier(DEPTH_18, verifier18);
    }

    /// @notice Three-tree post-genesis: only governance can cancel
    function test_RevertWhen_ThreeTreeNonGovernanceCancel() public {
        _sealGenesis();

        vm.prank(governance);
        registry.proposeThreeTreeVerifier(DEPTH_18, verifier18);

        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.cancelThreeTreeVerifier(DEPTH_18);
    }

    // ============================================================================
    // 11. THREE-TREE VERIFIER UPGRADE TESTS
    // ============================================================================

    /// @notice Three-tree upgrade: propose starts timelock
    function test_ThreeTree_ProposeUpgradeStartsTimelock() public {
        _registerThreeTreeAndSeal(DEPTH_18, verifier18);
        uint256 expectedExecuteTime = block.timestamp + FOURTEEN_DAYS;

        vm.prank(governance);
        vm.expectEmit(true, true, false, true);
        emit ThreeTreeVerifierProposed(DEPTH_18, newVerifier, expectedExecuteTime, true);
        registry.proposeThreeTreeVerifierUpgrade(DEPTH_18, newVerifier);

        assertEq(registry.pendingThreeTreeVerifiers(DEPTH_18), newVerifier);
        assertEq(registry.threeTreeVerifierByDepth(DEPTH_18), verifier18); // Original still active
    }

    /// @notice Three-tree upgrade: execute succeeds after timelock
    function test_ThreeTree_ExecuteUpgradeSucceeds() public {
        _registerThreeTreeAndSeal(DEPTH_18, verifier18);

        vm.prank(governance);
        registry.proposeThreeTreeVerifierUpgrade(DEPTH_18, newVerifier);

        vm.warp(block.timestamp + FOURTEEN_DAYS);

        vm.expectEmit(true, true, true, false);
        emit ThreeTreeVerifierUpgraded(DEPTH_18, verifier18, newVerifier);
        registry.executeThreeTreeVerifierUpgrade(DEPTH_18);

        assertEq(registry.threeTreeVerifierByDepth(DEPTH_18), newVerifier);
        assertEq(registry.pendingThreeTreeVerifiers(DEPTH_18), address(0));
    }

    /// @notice Three-tree upgrade: execute fails before timelock
    function test_RevertWhen_ThreeTreeUpgradeBeforeTimelock() public {
        _registerThreeTreeAndSeal(DEPTH_18, verifier18);

        vm.prank(governance);
        registry.proposeThreeTreeVerifierUpgrade(DEPTH_18, newVerifier);

        vm.expectRevert(TimelockGovernance.TimelockNotExpired.selector);
        registry.executeThreeTreeVerifierUpgrade(DEPTH_18);
    }

    /// @notice Three-tree upgrade: cancel clears pending
    function test_ThreeTree_CancelUpgradeClearsPending() public {
        _registerThreeTreeAndSeal(DEPTH_18, verifier18);

        vm.prank(governance);
        registry.proposeThreeTreeVerifierUpgrade(DEPTH_18, newVerifier);

        vm.prank(governance);
        vm.expectEmit(true, true, false, false);
        emit ThreeTreeVerifierProposalCancelled(DEPTH_18, newVerifier);
        registry.cancelThreeTreeVerifierUpgrade(DEPTH_18);

        assertEq(registry.threeTreeVerifierByDepth(DEPTH_18), verifier18);
        assertEq(registry.pendingThreeTreeVerifiers(DEPTH_18), address(0));
    }

    /// @notice Three-tree upgrade: cannot upgrade without existing verifier
    function test_RevertWhen_ThreeTreeUpgradeNoExisting() public {
        vm.prank(governance);
        vm.expectRevert(VerifierRegistry.VerifierNotRegistered.selector);
        registry.proposeThreeTreeVerifierUpgrade(DEPTH_18, newVerifier);
    }

    /// @notice Three-tree upgrade: cannot upgrade to same verifier
    function test_RevertWhen_ThreeTreeUpgradeToSame() public {
        _registerThreeTreeAndSeal(DEPTH_18, verifier18);

        vm.prank(governance);
        vm.expectRevert(TimelockGovernance.SameAddress.selector);
        registry.proposeThreeTreeVerifierUpgrade(DEPTH_18, verifier18);
    }

    // ============================================================================
    // 12. THREE-TREE VIEW FUNCTION TESTS
    // ============================================================================

    /// @notice Three-tree views: getThreeTreeVerifier returns correct address
    function test_ThreeTree_GetVerifier() public {
        vm.prank(governance);
        registry.registerThreeTreeVerifier(DEPTH_18, verifier18);

        assertEq(registry.getThreeTreeVerifier(DEPTH_18), verifier18);
        assertEq(registry.getThreeTreeVerifier(DEPTH_20), address(0));
    }

    /// @notice Three-tree views: isThreeTreeVerifierRegistered
    function test_ThreeTree_IsRegistered() public {
        assertFalse(registry.isThreeTreeVerifierRegistered(DEPTH_18));

        vm.prank(governance);
        registry.registerThreeTreeVerifier(DEPTH_18, verifier18);

        assertTrue(registry.isThreeTreeVerifierRegistered(DEPTH_18));
        assertFalse(registry.isThreeTreeVerifierRegistered(DEPTH_20));
    }

    /// @notice Three-tree views: getRegisteredThreeTreeDepths
    function test_ThreeTree_GetRegisteredDepths() public {
        uint8[] memory depths = registry.getRegisteredThreeTreeDepths();
        assertEq(depths.length, 0);

        vm.startPrank(governance);
        registry.registerThreeTreeVerifier(DEPTH_20, verifier20);
        registry.registerThreeTreeVerifier(DEPTH_24, verifier24);
        vm.stopPrank();

        depths = registry.getRegisteredThreeTreeDepths();
        assertEq(depths.length, 2);
        assertEq(depths[0], DEPTH_20);
        assertEq(depths[1], DEPTH_24);
    }

    /// @notice Two-tree and three-tree proposals are fully independent
    function test_ThreeTree_ProposalsIndependentFromTwoTree() public {
        _sealGenesis();

        // Propose two-tree depth 18
        vm.prank(governance);
        registry.proposeVerifier(DEPTH_18, verifier18);

        // Propose three-tree depth 18 — same depth, different mapping
        vm.prank(governance);
        registry.proposeThreeTreeVerifier(DEPTH_18, verifier20);

        assertEq(registry.pendingVerifiers(DEPTH_18), verifier18);
        assertEq(registry.pendingThreeTreeVerifiers(DEPTH_18), verifier20);

        vm.warp(block.timestamp + FOURTEEN_DAYS);

        registry.executeVerifier(DEPTH_18);
        registry.executeThreeTreeVerifier(DEPTH_18);

        assertEq(registry.verifierByDepth(DEPTH_18), verifier18);
        assertEq(registry.threeTreeVerifierByDepth(DEPTH_18), verifier20);
    }

    // ============================================================================
    // HELPER FUNCTIONS
    // ============================================================================

    /// @notice Helper: seal genesis without registering verifiers
    function _sealGenesis() internal {
        vm.prank(governance);
        registry.sealGenesis();
    }

    /// @notice Helper: register two-tree verifier via genesis and seal
    function _registerAndSeal(uint8 depth, address verifier) internal {
        vm.startPrank(governance);
        registry.registerVerifier(depth, verifier);
        registry.sealGenesis();
        vm.stopPrank();
    }

    /// @notice Helper: register three-tree verifier via genesis and seal
    function _registerThreeTreeAndSeal(uint8 depth, address verifier) internal {
        vm.startPrank(governance);
        registry.registerThreeTreeVerifier(depth, verifier);
        registry.sealGenesis();
        vm.stopPrank();
    }
}
