// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "forge-std/Test.sol";
import "../src/DebateMarket.sol";
import "../src/IDebateWeightVerifier.sol";
import "../src/IPositionNoteVerifier.sol";
import "../src/TimelockGovernance.sol";
import "../src/NullifierRegistry.sol";
import "../src/IAIEvaluationRegistry.sol";

/// @title DebateMarket Foundry Tests
/// @notice Comprehensive tests for the staked debate protocol with ERC-20 USDC staking and protocol fee
contract DebateMarketTest is Test {
    DebateMarket public market;
    MockDistrictGate public mockGate;
    NullifierRegistry public nullifierRegistry;
    MockERC20 public token;

    address public governance = address(0x1);
    address public proposer = address(0x10);
    address public arguer1 = address(0x20);
    address public arguer2 = address(0x30);
    address public arguer3 = address(0x40);
    address public cosigner1 = address(0x50);
    address public cosigner2 = address(0x60);

    bytes32 public constant ACTION_DOMAIN = keccak256("debate-housing-2026");
    bytes32 public constant PROPOSITION_HASH = keccak256("Should we increase housing density?");

    bytes32 public constant NULLIFIER_PROPOSER = bytes32(uint256(0x1000));
    bytes32 public constant NULLIFIER_1 = bytes32(uint256(0x2000));
    bytes32 public constant NULLIFIER_2 = bytes32(uint256(0x3000));
    bytes32 public constant NULLIFIER_3 = bytes32(uint256(0x4000));
    bytes32 public constant NULLIFIER_4 = bytes32(uint256(0x5000));
    bytes32 public constant NULLIFIER_5 = bytes32(uint256(0x6000));
    bytes32 public constant NULLIFIER_6 = bytes32(uint256(0x7000));
    bytes32 public constant NULLIFIER_7 = bytes32(uint256(0x8000));

    uint256 public constant STANDARD_DURATION = 4 days;
    uint256 public constant TEST_RESOLUTION_EXTENSION = 1 days;  // minimum allowed
    uint256 public constant STANDARD_BOND = 5e6;
    uint256 public constant STANDARD_STAKE = 2e6;
    uint256 public constant JURISDICTION_SIZE = 700_000;

    bytes public constant DUMMY_PROOF = hex"deadbeef";
    uint8 public constant VERIFIER_DEPTH = 20;

    event DebateProposed(
        bytes32 indexed debateId,
        bytes32 indexed actionDomain,
        bytes32 propositionHash,
        uint256 deadline,
        bytes32 baseDomain
    );

    event ArgumentSubmitted(
        bytes32 indexed debateId,
        uint256 indexed argumentIndex,
        DebateMarket.Stance stance,
        bytes32 bodyHash,
        uint8 engagementTier,
        uint256 weight,
        bytes32 nullifier
    );

    event CoSignSubmitted(
        bytes32 indexed debateId,
        uint256 indexed argumentIndex,
        uint8 engagementTier,
        uint256 weight
    );

    event DebateResolved(
        bytes32 indexed debateId,
        uint256 winningArgumentIndex,
        DebateMarket.Stance winningStance,
        uint256 winningScore,
        uint256 uniqueParticipants,
        uint256 jurisdictionSizeHint
    );

    event SettlementClaimed(bytes32 indexed debateId, bytes32 nullifier, uint256 payout, address indexed recipient);
    event EmergencyWithdrawn(bytes32 indexed debateId, bytes32 nullifier, uint256 amount, address indexed recipient);
    event ProposerBondReturned(bytes32 indexed debateId, uint256 bondAmount);
    event ProposerBondForfeited(bytes32 indexed debateId, uint256 bondAmount);
    event AppealBondForfeited(bytes32 indexed debateId, address indexed appealer, uint256 bond);

    function setUp() public {
        nullifierRegistry = new NullifierRegistry(governance, 7 days, 7 days);
        mockGate = new MockDistrictGate(address(nullifierRegistry));

        vm.prank(governance);
        nullifierRegistry.proposeCallerAuthorization(address(mockGate));
        vm.warp(block.timestamp + 7 days);
        nullifierRegistry.executeCallerAuthorization(address(mockGate));

        mockGate.setActionDomainAllowed(ACTION_DOMAIN, true);

        MockDebateWeightVerifier dwVerifier = new MockDebateWeightVerifier();
        MockPositionNoteVerifier pnVerifier = new MockPositionNoteVerifier();
        MockAIEvaluationRegistry aiRegistry = new MockAIEvaluationRegistry();

        token = new MockERC20("Test USD", "TUSD", 6);

        market = new DebateMarket(
            address(mockGate),
            address(dwVerifier),
            address(pnVerifier),
            address(aiRegistry),
            governance,
            address(token),
            200
        );

        mockGate.setDeriverAuthorized(address(market), true);

        address[6] memory users = [proposer, arguer1, arguer2, arguer3, cosigner1, cosigner2];
        for (uint256 i = 0; i < users.length; i++) {
            token.mint(users[i], 10_000e6);
            vm.prank(users[i]);
            token.approve(address(market), type(uint256).max);
        }

        // Set resolution extension to minimum for test efficiency (R2-F01 grace period)
        vm.prank(governance);
        market.setResolutionExtension(TEST_RESOLUTION_EXTENSION);

        // Set minParticipants to 1 so existing tests (1-2 arguers) still resolve
        vm.prank(governance);
        market.setMinParticipants(1);
    }

    /// @dev Warp past both debate deadline and AI resolution grace period, then resolve
    function _warpAndResolve(bytes32 debateId) internal {
        (,uint256 deadline,,,) = market.getDebateState(debateId);
        vm.warp(deadline + TEST_RESOLUTION_EXTENSION + 1);
        market.resolveDebate(debateId);
    }

    // ============================================================================
    // 1. LIFECYCLE — HAPPY PATH
    // ============================================================================

    function test_ProposeDebate_Success() public {
        vm.prank(proposer);
        bytes32 debateId = market.proposeDebate(
            PROPOSITION_HASH, STANDARD_DURATION, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND
        );

        (
            DebateMarket.DebateStatus status,
            uint256 deadline,
            uint256 argumentCount,
            uint256 totalStake,
            uint256 uniqueParticipants
        ) = market.getDebateState(debateId);

        assertEq(uint8(status), uint8(DebateMarket.DebateStatus.ACTIVE));
        assertEq(deadline, block.timestamp + STANDARD_DURATION);
        assertEq(argumentCount, 0);
        assertEq(totalStake, 0);
        assertEq(uniqueParticipants, 0);

        assertEq(token.balanceOf(address(market)), STANDARD_BOND);
        assertEq(token.balanceOf(proposer), 10_000e6 - STANDARD_BOND);
    }

    function test_FullLifecycle_ProposeArgueResolveSettle() public {
        vm.prank(proposer);
        bytes32 debateId = market.proposeDebate(
            PROPOSITION_HASH, STANDARD_DURATION, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND
        );

        uint256 stake0 = 10e6;
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("Support argument"), bytes32(0),
            stake0, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        uint256 stake1 = 5e6;
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("Oppose argument"), bytes32(0),
            stake1, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, expectedDebateDomain(), 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        uint256 stake2 = 20e6;
        vm.warp(block.timestamp + 61);
        vm.prank(arguer3);
        market.submitArgument(
            debateId, DebateMarket.Stance.AMEND, keccak256("Amend argument"), keccak256("Amendment text"),
            stake2, arguer3, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_3, expectedDebateDomain(), 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        (,, uint256 argumentCount,,) = market.getDebateState(debateId);
        assertEq(argumentCount, 3);

        _warpAndResolve(debateId);

        (DebateMarket.DebateStatus status,,,,) = market.getDebateState(debateId);
        assertEq(uint8(status), uint8(DebateMarket.DebateStatus.RESOLVED));
    }

    // ============================================================================
    // 2. PROPOSE VALIDATION
    // ============================================================================

    function test_RevertWhen_DurationTooShort() public {
        vm.prank(proposer);
        vm.expectRevert(DebateMarket.InvalidDuration.selector);
        market.proposeDebate(PROPOSITION_HASH, 71 hours, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND);
    }

    function test_RevertWhen_DurationTooLong() public {
        vm.prank(proposer);
        vm.expectRevert(DebateMarket.InvalidDuration.selector);
        market.proposeDebate(PROPOSITION_HASH, 31 days, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND);
    }

    function test_RevertWhen_InsufficientBond() public {
        vm.prank(proposer);
        vm.expectRevert(DebateMarket.InsufficientBond.selector);
        market.proposeDebate(PROPOSITION_HASH, STANDARD_DURATION, JURISDICTION_SIZE, ACTION_DOMAIN, 0.5e6);
    }

    function test_RevertWhen_BaseDomainNotAllowed() public {
        bytes32 badDomain = keccak256("not-whitelisted-domain");
        vm.prank(proposer);
        vm.expectRevert(bytes("MockDistrictGate: base domain not allowed"));
        market.proposeDebate(PROPOSITION_HASH, STANDARD_DURATION, JURISDICTION_SIZE, badDomain, STANDARD_BOND);
    }

    function test_ProposeDebate_ExactMinDuration() public {
        vm.prank(proposer);
        bytes32 debateId = market.proposeDebate(PROPOSITION_HASH, 72 hours, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND);
        (DebateMarket.DebateStatus status,,,,) = market.getDebateState(debateId);
        assertEq(uint8(status), uint8(DebateMarket.DebateStatus.ACTIVE));
    }

    function test_ProposeDebate_ExactMaxDuration() public {
        vm.prank(proposer);
        bytes32 debateId = market.proposeDebate(PROPOSITION_HASH, 30 days, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND);
        (DebateMarket.DebateStatus status,,,,) = market.getDebateState(debateId);
        assertEq(uint8(status), uint8(DebateMarket.DebateStatus.ACTIVE));
    }

    // ============================================================================
    // 3. ARGUMENT SUBMISSION
    // ============================================================================

    function test_SubmitArgument_Success() public {
        bytes32 debateId = _proposeStandardDebate();
        bytes32 bodyHash = keccak256("My argument");

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, bodyHash, bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        (,, uint256 argumentCount,,) = market.getDebateState(debateId);
        assertEq(argumentCount, 1);

        uint256 score = market.getArgumentScore(debateId, 0);
        assertGt(score, 0);
    }

    function test_SubmitArgument_SqrtWeightedScoring() public {
        bytes32 debateId = _proposeStandardDebate();

        // Tier 2, gross 4e6: net=3_920_000, sqrt(3_920_000)=1979, *4=7916
        uint256 stake = 4e6;
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            stake, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        uint256 score = market.getArgumentScore(debateId, 0);
        assertEq(score, 7916);
    }

    function test_RevertWhen_DebateExpired() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.warp(block.timestamp + STANDARD_DURATION);

        vm.prank(arguer1);
        vm.expectRevert(DebateMarket.ArgumentWindowClosed.selector);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("late arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );
    }

    function test_RevertWhen_InsufficientStake() public {
        bytes32 debateId = _proposeStandardDebate();

        vm.prank(arguer1);
        vm.expectRevert(DebateMarket.InsufficientStake.selector);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("cheap arg"), bytes32(0),
            0.5e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );
    }

    function test_RevertWhen_Tier0Submits() public {
        bytes32 debateId = _proposeStandardDebate();

        vm.prank(arguer1);
        vm.expectRevert(DebateMarket.InvalidEngagementTier.selector);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("tier0 arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 0),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );
    }

    // ============================================================================
    // 4. CO-SIGN
    // ============================================================================

    function test_CoSign_AddsToArgumentScore() public {
        bytes32 debateId = _proposeStandardDebate();

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        uint256 scoreBefore = market.getArgumentScore(debateId, 0);

        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.coSignArgument(
            debateId, 0, STANDARD_STAKE, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, expectedDebateDomain(), 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        uint256 scoreAfter = market.getArgumentScore(debateId, 0);
        assertGt(scoreAfter, scoreBefore);
    }

    function test_CoSign_DifferentTiersWeightedCorrectly() public {
        bytes32 debateId = _proposeStandardDebate();

        // Initial argument: gross 1e6, net 980_000, tier 2: sqrt(980000)*4=989*4=3956
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            1e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        uint256 scoreAfterArg = market.getArgumentScore(debateId, 0);
        assertEq(scoreAfterArg, 3956);

        // Co-sign: gross 1e6, net 980_000, tier 4: sqrt(980000)*16=989*16=15824
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.coSignArgument(
            debateId, 0, 1e6, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, expectedDebateDomain(), 4),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        uint256 scoreAfterCoSign = market.getArgumentScore(debateId, 0);
        // 3956 + 15824 = 19780
        assertEq(scoreAfterCoSign, 19780);
    }

    // ============================================================================
    // 5. RESOLUTION
    // ============================================================================

    function test_ResolveDebate_HighestScoreWins() public {
        bytes32 debateId = _proposeStandardDebate();

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("weaker"), bytes32(0),
            5e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("stronger"), bytes32(0),
            10e6, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, expectedDebateDomain(), 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        uint256 score0 = market.getArgumentScore(debateId, 0);
        uint256 score1 = market.getArgumentScore(debateId, 1);
        assertGt(score1, score0);

        _warpAndResolve(debateId);

        (,,,,,,,,, bytes32 winningBodyHash,,,,,,,,,,, ) = market.debates(debateId);
        assertEq(winningBodyHash, keccak256("stronger"));
    }

    function test_ResolveDebate_TiesGoToEarlierArgument() public {
        bytes32 debateId = _proposeStandardDebate();

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("first"), bytes32(0),
            4e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("second"), bytes32(0),
            4e6, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        uint256 score0 = market.getArgumentScore(debateId, 0);
        uint256 score1 = market.getArgumentScore(debateId, 1);
        assertEq(score0, score1);

        _warpAndResolve(debateId);

        (,,,,,,,,, bytes32 winningBodyHash,,,,,,,,,,, ) = market.debates(debateId);
        assertEq(winningBodyHash, keccak256("first"));
    }

    function test_RevertWhen_ResolveBeforeDeadline() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.expectRevert(DebateMarket.DebateStillActive.selector);
        market.resolveDebate(debateId);
    }

    function test_ResolveDebate_AmendmentStoresWinningAmendment() public {
        bytes32 debateId = _proposeStandardDebate();
        bytes32 amendmentHash = keccak256("proposed amendment text");

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.AMEND, keccak256("amend body"), amendmentHash,
            10e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 4),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        _warpAndResolve(debateId);

        (,,,,,,,,,, bytes32 storedAmendment,,,,,,,,,, ) = market.debates(debateId);
        assertEq(storedAmendment, amendmentHash);
    }

    // ============================================================================
    // 6. SETTLEMENT
    // ============================================================================

    function test_ClaimSettlement_WinningSideGetsPayout() public {
        (bytes32 debateId,) = _setupResolvedDebateWithTwoArguments();

        uint256 balanceBefore = token.balanceOf(arguer2);
        vm.prank(arguer2);
        market.claimSettlement(debateId, NULLIFIER_2);
        uint256 balanceAfter = token.balanceOf(arguer2);

        assertGt(balanceAfter, balanceBefore);
    }

    function test_RevertWhen_ClaimLosingSide() public {
        (bytes32 debateId,) = _setupResolvedDebateWithTwoArguments();

        vm.prank(arguer1);
        vm.expectRevert(DebateMarket.NotWinningSide.selector);
        market.claimSettlement(debateId, NULLIFIER_1);
    }

    function test_RevertWhen_DoubleClaim() public {
        (bytes32 debateId,) = _setupResolvedDebateWithTwoArguments();

        vm.prank(arguer2);
        market.claimSettlement(debateId, NULLIFIER_2);

        vm.prank(arguer2);
        vm.expectRevert(DebateMarket.AlreadyClaimed.selector);
        market.claimSettlement(debateId, NULLIFIER_2);
    }

    function test_RevertWhen_DebateNotResolved() public {
        bytes32 debateId = _proposeStandardDebate();

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.prank(arguer1);
        vm.expectRevert(DebateMarket.DebateNotResolved.selector);
        market.claimSettlement(debateId, NULLIFIER_1);
    }

    // ============================================================================
    // 7. PROPOSER BOND
    // ============================================================================

    function test_ClaimProposerBond_ReturnedAboveThreshold() public {
        bytes32 debateId = _proposeStandardDebate();

        _submitArgumentWithNullifier(debateId, arguer1, NULLIFIER_1, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, arguer2, NULLIFIER_2, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, arguer3, NULLIFIER_3, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, cosigner1, NULLIFIER_4, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, cosigner2, NULLIFIER_5, 2);

        _warpAndResolve(debateId);

        uint256 balanceBefore = token.balanceOf(proposer);
        vm.prank(proposer);
        market.claimProposerBond(debateId);
        uint256 balanceAfter = token.balanceOf(proposer);

        assertEq(balanceAfter - balanceBefore, STANDARD_BOND);
    }

    function test_RevertWhen_ClaimProposerBond_BelowThreshold() public {
        bytes32 debateId = _proposeStandardDebate();

        _submitArgumentWithNullifier(debateId, arguer1, NULLIFIER_1, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, arguer2, NULLIFIER_2, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, arguer3, NULLIFIER_3, 2);

        _warpAndResolve(debateId);

        vm.prank(proposer);
        vm.expectRevert(DebateMarket.InsufficientParticipation.selector);
        market.claimProposerBond(debateId);
    }

    function test_RevertWhen_NotProposer() public {
        bytes32 debateId = _proposeStandardDebate();

        _submitArgumentWithNullifier(debateId, arguer1, NULLIFIER_1, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, arguer2, NULLIFIER_2, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, arguer3, NULLIFIER_3, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, cosigner1, NULLIFIER_4, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, cosigner2, NULLIFIER_5, 2);

        _warpAndResolve(debateId);

        vm.prank(arguer1);
        vm.expectRevert(DebateMarket.NotProposer.selector);
        market.claimProposerBond(debateId);
    }

    // ============================================================================
    // 8. NULLIFIER / DOUBLE-STAKE PREVENTION
    // ============================================================================

    function test_RevertWhen_DoubleStakeSameNullifier() public {
        bytes32 debateId = _proposeStandardDebate();

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg1"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        vm.expectRevert(NullifierRegistry.NullifierAlreadyUsed.selector);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("arg2"), bytes32(0),
            STANDARD_STAKE, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );
    }

    // ============================================================================
    // 9. PARTICIPATION DEPTH
    // ============================================================================

    function test_ParticipationDepth_TracksUniqueParticipants() public {
        bytes32 debateId = _proposeStandardDebate();

        _submitArgumentWithNullifier(debateId, arguer1, NULLIFIER_1, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, arguer2, NULLIFIER_2, 3);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, arguer3, NULLIFIER_3, 1);

        (uint256 participants, uint256 jurisdictionSize) = market.getParticipationDepth(debateId);
        assertEq(participants, 3);
        assertEq(jurisdictionSize, JURISDICTION_SIZE);
    }

    function test_SignalStrength_LowParticipation_BondForfeited() public {
        bytes32 debateId = _proposeStandardDebate();

        _submitArgumentWithNullifier(debateId, arguer1, NULLIFIER_1, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, arguer2, NULLIFIER_2, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, arguer3, NULLIFIER_3, 2);

        (uint256 participants,) = market.getParticipationDepth(debateId);
        assertEq(participants, 3);
        assertTrue(participants < market.BOND_RETURN_THRESHOLD());

        _warpAndResolve(debateId);

        vm.prank(proposer);
        vm.expectRevert(DebateMarket.InsufficientParticipation.selector);
        market.claimProposerBond(debateId);
    }

    // ============================================================================
    // 10. SQRT MATH
    // ============================================================================

    function test_Sqrt_KnownValues() public {
        bytes32 debateId = _proposeStandardDebate();

        // gross 4e6, net 3_920_000: sqrt(3920000)=1979, *2=3958
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("a"), bytes32(0),
            4e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );
        assertEq(market.getArgumentScore(debateId, 0), 3958);

        // gross 1e6, net 980_000: sqrt(980000)=989, *2=1978
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("b"), bytes32(0),
            1e6, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, expectedDebateDomain(), 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );
        assertEq(market.getArgumentScore(debateId, 1), 1978);

        // gross 100e6, net 98_000_000: sqrt(98000000)=9899, *2=19798
        vm.warp(block.timestamp + 61);
        vm.prank(arguer3);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("c"), bytes32(0),
            100e6, arguer3, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_3, expectedDebateDomain(), 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );
        assertEq(market.getArgumentScore(debateId, 2), 19798);
    }

    // ============================================================================
    // 11. SCORING TABLE VERIFICATION
    // ============================================================================

    function test_ScoringTable_NewcomerBigStake() public {
        bytes32 debateId = _proposeStandardDebate();

        // gross 100e6, net 98_000_000: sqrt=9899, tier1: *2=19798
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("newcomer big"), bytes32(0),
            100e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        assertEq(market.getArgumentScore(debateId, 0), 19798);
    }

    function test_ScoringTable_PillarMinimalStake() public {
        bytes32 debateId = _proposeStandardDebate();

        // gross 2e6, net 1_960_000: sqrt=1400, tier4: *16=22400
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("pillar min"), bytes32(0),
            2e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 4),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        uint256 score = market.getArgumentScore(debateId, 0);
        assertEq(score, 22400);
    }

    function test_ScoringTable_VeteranModerateStake() public {
        bytes32 debateId = _proposeStandardDebate();

        // gross 10e6, net 9_800_000: sqrt=3130, tier3: *8=25040
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("veteran mod"), bytes32(0),
            10e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        uint256 score = market.getArgumentScore(debateId, 0);
        assertEq(score, 25040);
    }

    function test_ScoringTable_PillarOutscoresNewcomer() public {
        bytes32 debateId = _proposeStandardDebate();

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("newcomer"), bytes32(0),
            100e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("pillar"), bytes32(0),
            2e6, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, expectedDebateDomain(), 4),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        uint256 newcomerScore = market.getArgumentScore(debateId, 0);
        uint256 pillarScore = market.getArgumentScore(debateId, 1);

        assertGt(pillarScore, newcomerScore, "Pillar at $2 should outscore newcomer at $100");
    }

    function test_ScoringTable_VeteranOutscoresNewcomer() public {
        bytes32 debateId = _proposeStandardDebate();

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("newcomer"), bytes32(0),
            100e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("veteran"), bytes32(0),
            10e6, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, expectedDebateDomain(), 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        uint256 newcomerScore = market.getArgumentScore(debateId, 0);
        uint256 veteranScore = market.getArgumentScore(debateId, 1);

        assertGt(veteranScore, newcomerScore, "Veteran at $10 should outscore newcomer at $100");
    }

    // ============================================================================
    // 12. CONSTANTS VERIFICATION
    // ============================================================================

    function test_Constants_MinDuration() public view {
        assertEq(market.MIN_DURATION(), 72 hours);
    }

    function test_Constants_MaxDuration() public view {
        assertEq(market.MAX_DURATION(), 30 days);
    }

    function test_Constants_BondReturnThreshold() public view {
        assertEq(market.BOND_RETURN_THRESHOLD(), 5);
    }

    function test_TierMultipliers_ViaScoring() public {
        bytes32 debateId = _proposeStandardDebate();

        // gross 1e6, net 980_000: sqrt=989
        // Tier 1: 989*2=1978
        vm.prank(arguer1);
        market.submitArgument(debateId, DebateMarket.Stance.SUPPORT, keccak256("t1"), bytes32(0), 1e6, arguer1, DUMMY_PROOF, _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0));
        assertEq(market.getArgumentScore(debateId, 0), 1978);

        // Tier 2: 989*4=3956
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(debateId, DebateMarket.Stance.SUPPORT, keccak256("t2"), bytes32(0), 1e6, arguer2, DUMMY_PROOF, _makePublicInputs(NULLIFIER_2, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0));
        assertEq(market.getArgumentScore(debateId, 1), 3956);

        // Tier 3: 989*8=7912
        vm.warp(block.timestamp + 61);
        vm.prank(arguer3);
        market.submitArgument(debateId, DebateMarket.Stance.SUPPORT, keccak256("t3"), bytes32(0), 1e6, arguer3, DUMMY_PROOF, _makePublicInputs(NULLIFIER_3, expectedDebateDomain(), 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0));
        assertEq(market.getArgumentScore(debateId, 2), 7912);

        // Tier 4: 989*16=15824
        vm.warp(block.timestamp + 61);
        vm.prank(cosigner1);
        market.submitArgument(debateId, DebateMarket.Stance.SUPPORT, keccak256("t4"), bytes32(0), 1e6, cosigner1, DUMMY_PROOF, _makePublicInputs(NULLIFIER_4, expectedDebateDomain(), 4),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0));
        assertEq(market.getArgumentScore(debateId, 3), 15824);
    }

    // ============================================================================
    // 13. PAUSE CONTROLS
    // ============================================================================

    function test_RevertWhen_Paused_Propose() public {
        vm.prank(governance);
        market.pause();

        vm.prank(proposer);
        vm.expectRevert("Pausable: paused");
        market.proposeDebate(PROPOSITION_HASH, STANDARD_DURATION, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND);
    }

    function test_RevertWhen_NonGovernancePauses() public {
        vm.prank(arguer1);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        market.pause();
    }

    // ============================================================================
    // 14. VIEW FUNCTIONS
    // ============================================================================

    function test_GetDebateState() public {
        bytes32 debateId = _proposeStandardDebate();
        _submitArgumentWithNullifier(debateId, arguer1, NULLIFIER_1, 2);

        (
            DebateMarket.DebateStatus status,
            uint256 deadline,
            uint256 argumentCount,
            uint256 totalStake,
            uint256 uniqueParticipants
        ) = market.getDebateState(debateId);

        assertEq(uint8(status), uint8(DebateMarket.DebateStatus.ACTIVE));
        assertGt(deadline, block.timestamp);
        assertEq(argumentCount, 1);
        // net stake: 2e6 * 9800 / 10000 = 1_960_000
        assertEq(totalStake, 1_960_000);
        assertEq(uniqueParticipants, 1);
    }

    function test_GetParticipationDepth() public {
        bytes32 debateId = _proposeStandardDebate();

        _submitArgumentWithNullifier(debateId, arguer1, NULLIFIER_1, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, arguer2, NULLIFIER_2, 3);

        (uint256 participants, uint256 jurisdictionSize) = market.getParticipationDepth(debateId);

        assertEq(participants, 2);
        assertEq(jurisdictionSize, JURISDICTION_SIZE);
    }

    // ============================================================================
    // 15. ACTION DOMAIN CROSS-VALIDATION
    // ============================================================================

    function test_RevertWhen_ActionDomainMismatch() public {
        bytes32 debateId = _proposeStandardDebate();
        bytes32 wrongDomain = keccak256("different-domain");
        mockGate.setActionDomainAllowed(wrongDomain, true);

        vm.prank(arguer1);
        vm.expectRevert(DebateMarket.ActionDomainMismatch.selector);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, wrongDomain, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );
    }

    function test_RevertWhen_CoSignActionDomainMismatch() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        bytes32 wrongDomain = keccak256("different-domain");
        mockGate.setActionDomainAllowed(wrongDomain, true);

        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        vm.expectRevert(DebateMarket.ActionDomainMismatch.selector);
        market.coSignArgument(
            debateId, 0, STANDARD_STAKE, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, wrongDomain, 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );
    }

    // ============================================================================
    // 16. ZERO-ARGUMENT RESOLUTION GUARD
    // ============================================================================

    function test_RevertWhen_ResolveZeroArguments() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.warp(block.timestamp + STANDARD_DURATION + TEST_RESOLUTION_EXTENSION + 1);
        vm.expectRevert(DebateMarket.NoArgumentsSubmitted.selector);
        market.resolveDebate(debateId);
    }

    // ============================================================================
    // 17. SETTLEMENT CLAIM AUTHORIZATION
    // ============================================================================

    function test_RevertWhen_UnauthorizedClaimer() public {
        (bytes32 debateId,) = _setupResolvedDebateWithTwoArguments();
        vm.prank(arguer3);
        vm.expectRevert(DebateMarket.UnauthorizedClaimer.selector);
        market.claimSettlement(debateId, NULLIFIER_2);
    }

    // ============================================================================
    // 18. DEBATE ID COLLISION GUARD
    // ============================================================================

    function test_RevertWhen_DebateIdCollision() public {
        vm.prank(proposer);
        market.proposeDebate(PROPOSITION_HASH, STANDARD_DURATION, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND);
        vm.prank(proposer);
        vm.expectRevert(bytes("MockDistrictGate: derived already registered"));
        market.proposeDebate(PROPOSITION_HASH, STANDARD_DURATION, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND);
    }

    // ============================================================================
    // 19. SWEEP FORFEITED BOND
    // ============================================================================

    function test_SweepForfeitedBond_Success() public {
        bytes32 debateId = _proposeStandardDebate();
        _submitArgumentWithNullifier(debateId, arguer1, NULLIFIER_1, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, arguer2, NULLIFIER_2, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, arguer3, NULLIFIER_3, 2);
        _warpAndResolve(debateId);

        uint256 govBalBefore = token.balanceOf(governance);
        vm.prank(governance);
        market.sweepForfeitedBond(debateId);
        assertEq(token.balanceOf(governance) - govBalBefore, STANDARD_BOND);
    }

    function test_RevertWhen_SweepBond_SufficientParticipation() public {
        bytes32 debateId = _proposeStandardDebate();
        _submitArgumentWithNullifier(debateId, arguer1, NULLIFIER_1, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, arguer2, NULLIFIER_2, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, arguer3, NULLIFIER_3, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, cosigner1, NULLIFIER_4, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, cosigner2, NULLIFIER_5, 2);
        _warpAndResolve(debateId);

        vm.prank(governance);
        vm.expectRevert(DebateMarket.InsufficientParticipation.selector);
        market.sweepForfeitedBond(debateId);
    }

    function test_RevertWhen_SweepBond_NotGovernance() public {
        bytes32 debateId = _proposeStandardDebate();
        _submitArgumentWithNullifier(debateId, arguer1, NULLIFIER_1, 2);
        _warpAndResolve(debateId);

        vm.prank(arguer1);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        market.sweepForfeitedBond(debateId);
    }

    // ============================================================================
    // 20. EMERGENCY WITHDRAWAL
    // ============================================================================

    function test_EmergencyWithdraw_Success() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );
        vm.warp(block.timestamp + STANDARD_DURATION + 30 days);
        uint256 balBefore = token.balanceOf(arguer1);
        vm.prank(arguer1);
        market.emergencyWithdraw(debateId, NULLIFIER_1);
        // Emergency returns net stake (fee already deducted)
        assertEq(token.balanceOf(arguer1) - balBefore, 1_960_000);
    }

    function test_RevertWhen_EmergencyWithdraw_TooEarly() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );
        vm.warp(block.timestamp + STANDARD_DURATION + 15 days);
        vm.prank(arguer1);
        vm.expectRevert(DebateMarket.DebateStillActive.selector);
        market.emergencyWithdraw(debateId, NULLIFIER_1);
    }

    // ============================================================================
    // 21. MAX_ARGUMENTS CONSTANT
    // ============================================================================

    function test_Constants_MaxArguments() public view {
        assertEq(market.MAX_ARGUMENTS(), 500);
    }

    // ============================================================================
    // 22. CO-SIGN AFTER DEADLINE
    // ============================================================================

    function test_RevertWhen_CoSignAfterDeadline() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );
        vm.warp(block.timestamp + STANDARD_DURATION);
        vm.prank(arguer2);
        vm.expectRevert(DebateMarket.ArgumentWindowClosed.selector);
        market.coSignArgument(
            debateId, 0, STANDARD_STAKE, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, expectedDebateDomain(), 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );
    }

    // ============================================================================
    // 23. ENGAGEMENT TIER OUT OF RANGE
    // ============================================================================

    function test_RevertWhen_EngagementTierOutOfRange() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.prank(arguer1);
        vm.expectRevert(DebateMarket.InvalidEngagementTier.selector);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 5),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );
    }

    // ============================================================================
    // 24. EMERGENCY WITHDRAWAL AFTER RESOLUTION
    // ============================================================================

    function test_RevertWhen_EmergencyWithdraw_AfterResolution() public {
        (bytes32 debateId, ) = _setupResolvedDebateWithTwoArguments();
        vm.warp(block.timestamp + 30 days);
        vm.prank(arguer1);
        vm.expectRevert(DebateMarket.DebateNotActive.selector);
        market.emergencyWithdraw(debateId, NULLIFIER_1);
    }

    function test_RevertWhen_EmergencyWithdraw_WinnerAfterResolution() public {
        (bytes32 debateId, ) = _setupResolvedDebateWithTwoArguments();
        vm.warp(block.timestamp + 30 days);
        vm.prank(arguer2);
        vm.expectRevert(DebateMarket.DebateNotActive.selector);
        market.emergencyWithdraw(debateId, NULLIFIER_2);
    }

    // ============================================================================
    // 25. ZERO-ARGUMENT ABANDONED DEBATE SWEEP
    // ============================================================================

    function test_SweepAbandonedDebate_ZeroArguments() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.warp(block.timestamp + STANDARD_DURATION);
        uint256 govBalBefore = token.balanceOf(governance);
        vm.prank(governance);
        market.sweepForfeitedBond(debateId);
        assertEq(token.balanceOf(governance) - govBalBefore, STANDARD_BOND);
    }

    function test_RevertWhen_SweepAbandoned_BeforeDeadline() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.prank(governance);
        vm.expectRevert(DebateMarket.DebateNotResolved.selector);
        market.sweepForfeitedBond(debateId);
    }

    function test_RevertWhen_SweepAbandoned_HasArguments() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );
        vm.warp(block.timestamp + STANDARD_DURATION);
        vm.prank(governance);
        vm.expectRevert(DebateMarket.DebateNotResolved.selector);
        market.sweepForfeitedBond(debateId);
    }

    // ============================================================================
    // 26. EMERGENCY WITHDRAWAL BY NON-SUBMITTER
    // ============================================================================

    function test_RevertWhen_EmergencyWithdraw_NonSubmitter() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );
        vm.warp(block.timestamp + STANDARD_DURATION + 30 days);
        vm.prank(arguer2);
        vm.expectRevert(DebateMarket.UnauthorizedClaimer.selector);
        market.emergencyWithdraw(debateId, NULLIFIER_1);
    }

    // ============================================================================
    // 27. DOUBLE-SWEEP FORFEITED BOND
    // ============================================================================

    function test_RevertWhen_DoubleSweepForfeitedBond() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );
        _warpAndResolve(debateId);
        vm.prank(governance);
        market.sweepForfeitedBond(debateId);
        vm.prank(governance);
        vm.expectRevert(DebateMarket.BondAlreadyClaimed.selector);
        market.sweepForfeitedBond(debateId);
    }

    // ============================================================================
    // 28. EMERGENCY WITHDRAW -> SETTLEMENT CROSS-PATH BLOCKING
    // ============================================================================

    function test_EmergencyWithdraw_BlocksSettlementClaim() public {
        bytes32 debateId = _proposeStandardDebate();

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("loser"), bytes32(0),
            5e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("winner"), bytes32(0),
            10e6, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, expectedDebateDomain(), 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.warp(block.timestamp + STANDARD_DURATION + 30 days);

        vm.prank(arguer2);
        market.emergencyWithdraw(debateId, NULLIFIER_2);

        vm.prank(arguer2);
        vm.expectRevert(DebateMarket.AlreadyClaimed.selector);
        market.emergencyWithdraw(debateId, NULLIFIER_2);
    }

    // ============================================================================
    // 29. SETTLEMENT ACCOUNTING INTEGRITY
    // ============================================================================

    function test_SettlementAccounting_TotalPayoutWithinTotalStake() public {
        bytes32 debateId = _proposeStandardDebate();

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("win1"), bytes32(0),
            3e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("lose"), bytes32(0),
            10e6, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, expectedDebateDomain(), 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.warp(block.timestamp + 61);
        vm.prank(cosigner1);
        market.coSignArgument(
            debateId, 0, 5e6, cosigner1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_3, expectedDebateDomain(), 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        _warpAndResolve(debateId);

        (,,,,,, uint256 totalStake,,,,,,,,,,,,,,) = market.debates(debateId);

        uint256 contractBalBefore = token.balanceOf(address(market));

        vm.prank(arguer1);
        market.claimSettlement(debateId, NULLIFIER_1);
        vm.prank(cosigner1);
        market.claimSettlement(debateId, NULLIFIER_3);

        uint256 totalPaidOut = contractBalBefore - token.balanceOf(address(market));

        assertLe(totalPaidOut, totalStake, "Settlement payouts exceeded totalStake");
    }

    // ============================================================================
    // 30. EMERGENCY WITHDRAWAL ACCOUNTING
    // ============================================================================

    function test_EmergencyWithdraw_LoserThenResolve_WinnerGetsCorrectPayout() public {
        bytes32 debateId = _proposeStandardDebate();

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("winner"), bytes32(0),
            10e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("loser"), bytes32(0),
            100e6, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, expectedDebateDomain(), 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.warp(block.timestamp + STANDARD_DURATION + 30 days);
        vm.prank(arguer2);
        market.emergencyWithdraw(debateId, NULLIFIER_2);

        market.resolveDebate(debateId);

        uint256 balBefore = token.balanceOf(arguer1);
        vm.prank(arguer1);
        market.claimSettlement(debateId, NULLIFIER_1);
        uint256 payout = token.balanceOf(arguer1) - balBefore;

        // net(10e6)=9_800_000
        assertEq(payout, 9_800_000, "Winner should get original stake when all losers emergency withdrew");
    }

    function test_EmergencyWithdraw_AllLosers_WinnerGetsOriginalStake() public {
        bytes32 debateId = _proposeStandardDebate();

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("winner"), bytes32(0),
            5e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 4),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("loser1"), bytes32(0),
            50e6, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, expectedDebateDomain(), 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.warp(block.timestamp + 61);
        vm.prank(arguer3);
        market.coSignArgument(
            debateId, 1, 50e6, arguer3, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_3, expectedDebateDomain(), 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.warp(block.timestamp + STANDARD_DURATION + 30 days);

        vm.prank(arguer2);
        market.emergencyWithdraw(debateId, NULLIFIER_2);
        vm.prank(arguer3);
        market.emergencyWithdraw(debateId, NULLIFIER_3);

        market.resolveDebate(debateId);

        uint256 balBefore = token.balanceOf(arguer1);
        vm.prank(arguer1);
        market.claimSettlement(debateId, NULLIFIER_1);
        uint256 payout = token.balanceOf(arguer1) - balBefore;

        assertEq(payout, 4_900_000, "Winner gets original stake only when all losers withdrew");
    }

    function test_EmergencyWithdraw_WinnerAndLoser_RemainingWinnerCorrect() public {
        bytes32 debateId = _proposeStandardDebate();

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("winA"), bytes32(0),
            10e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.warp(block.timestamp + 61);
        vm.prank(cosigner1);
        market.coSignArgument(
            debateId, 0, 10e6, cosigner1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_4, expectedDebateDomain(), 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("lose"), bytes32(0),
            20e6, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, expectedDebateDomain(), 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.warp(block.timestamp + STANDARD_DURATION + 30 days);

        vm.prank(cosigner1);
        market.emergencyWithdraw(debateId, NULLIFIER_4);
        vm.prank(arguer2);
        market.emergencyWithdraw(debateId, NULLIFIER_2);

        market.resolveDebate(debateId);

        uint256 balBefore = token.balanceOf(arguer1);
        vm.prank(arguer1);
        market.claimSettlement(debateId, NULLIFIER_1);
        uint256 payout = token.balanceOf(arguer1) - balBefore;

        assertEq(payout, 9_800_000, "Remaining winner gets original stake when all counterparties withdrew");
    }

    function test_EmergencyWithdraw_SolvencyInvariant() public {
        bytes32 debateId = _proposeStandardDebate();

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("win"), bytes32(0),
            10e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("lose1"), bytes32(0),
            30e6, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, expectedDebateDomain(), 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );
        vm.warp(block.timestamp + 61);
        vm.prank(arguer3);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("lose2"), bytes32(0),
            60e6, arguer3, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_3, expectedDebateDomain(), 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        uint256 contractBalAfterStakes = token.balanceOf(address(market));

        vm.warp(block.timestamp + STANDARD_DURATION + 30 days);
        vm.prank(arguer2);
        market.emergencyWithdraw(debateId, NULLIFIER_2);
        market.resolveDebate(debateId);
        vm.prank(arguer1);
        market.claimSettlement(debateId, NULLIFIER_1);

        uint256 contractBalAfterAll = token.balanceOf(address(market));
        uint256 totalPaidOut = contractBalAfterStakes - contractBalAfterAll;

        // net stakes: 9_800_000 + 29_400_000 + 58_800_000 = 98_000_000
        assertLe(totalPaidOut, 98_000_000, "Solvency violated");
        assertGe(contractBalAfterAll, STANDARD_BOND, "Contract should still hold proposer bond");
    }

    // ============================================================================
    // 31. EXACT SETTLEMENT MATH
    // ============================================================================

    function test_Settlement_ExactPayout_SingleWinnerSingleLoser() public {
        bytes32 debateId = _proposeStandardDebate();

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("win"), bytes32(0),
            10e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("lose"), bytes32(0),
            5e6, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, expectedDebateDomain(), 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        _warpAndResolve(debateId);

        // net(10e6)=9_800_000, net(5e6)=4_900_000, total=14_700_000
        uint256 balBefore = token.balanceOf(arguer1);
        vm.prank(arguer1);
        market.claimSettlement(debateId, NULLIFIER_1);
        uint256 payout = token.balanceOf(arguer1) - balBefore;

        assertEq(payout, 14_700_000, "Winner takes entire pool: stake + full losing pool");
    }

    function test_Settlement_ExactPayout_TwoWinnersSplitPool() public {
        bytes32 debateId = _proposeStandardDebate();

        // Winner A: gross 6e6, net 5_880_000
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("winA"), bytes32(0),
            6e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        // Winner B (co-sign): gross 4e6, net 3_920_000
        vm.warp(block.timestamp + 61);
        vm.prank(cosigner1);
        market.coSignArgument(
            debateId, 0, 4e6, cosigner1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_3, expectedDebateDomain(), 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        // Loser: gross 10e6, net 9_800_000
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("lose"), bytes32(0),
            10e6, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, expectedDebateDomain(), 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        _warpAndResolve(debateId);

        // winArgStake=9_800_000, losingPool=9_800_000
        // A: 5_880_000 + (9_800_000*5_880_000)/9_800_000 = 11_760_000
        // B: 3_920_000 + (9_800_000*3_920_000)/9_800_000 = 7_840_000
        uint256 balA_before = token.balanceOf(arguer1);
        vm.prank(arguer1);
        market.claimSettlement(debateId, NULLIFIER_1);
        uint256 payoutA = token.balanceOf(arguer1) - balA_before;

        uint256 balB_before = token.balanceOf(cosigner1);
        vm.prank(cosigner1);
        market.claimSettlement(debateId, NULLIFIER_3);
        uint256 payoutB = token.balanceOf(cosigner1) - balB_before;

        assertEq(payoutA, 11_760_000, "Winner A: 5880000 + (9800000*5880000/9800000) = 11760000");
        assertEq(payoutB, 7_840_000, "Winner B: 3920000 + (9800000*3920000/9800000) = 7840000");
        assertEq(payoutA + payoutB, 19_600_000, "Total payouts equal total net stakes");
    }

    // ============================================================================
    // 32. ZERO-LOSING-POOL SETTLEMENT
    // ============================================================================

    function test_Settlement_ZeroLosingPool_PayoutEqualsStake() public {
        bytes32 debateId = _proposeStandardDebate();

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("only"), bytes32(0),
            7e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        _warpAndResolve(debateId);

        // net(7e6) = 6_860_000
        uint256 balBefore = token.balanceOf(arguer1);
        vm.prank(arguer1);
        market.claimSettlement(debateId, NULLIFIER_1);
        uint256 payout = token.balanceOf(arguer1) - balBefore;

        assertEq(payout, 6_860_000, "Solo winner gets net stake back, no profit");
    }

    // ============================================================================
    // 33. MAX_ARGUMENTS BOUNDARY
    // ============================================================================

    function test_RevertWhen_MaxArgumentsExceeded() public {
        bytes32 debateId = _proposeStandardDebate();

        for (uint256 i = 0; i < 500; i++) {
            address caller = address(uint160(0x100000 + i));
            bytes32 nullifier = bytes32(uint256(0xAA0000 + i));
            token.mint(caller, 10e6);
            vm.prank(caller);
            token.approve(address(market), type(uint256).max);
            vm.warp(block.timestamp + 61);
            vm.prank(caller);
            market.submitArgument(
                debateId, DebateMarket.Stance.SUPPORT,
                keccak256(abi.encodePacked("arg-", i)), bytes32(0),
                1e6, caller, DUMMY_PROOF,
                _makePublicInputs(nullifier, expectedDebateDomain(), 1),
                VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
            );
        }

        (,, uint256 argumentCount,,) = market.getDebateState(debateId);
        assertEq(argumentCount, 500);

        address caller501 = address(uint160(0x100000 + 500));
        bytes32 nullifier501 = bytes32(uint256(0xAA0000 + 500));
        token.mint(caller501, 10e6);
        vm.prank(caller501);
        token.approve(address(market), type(uint256).max);
        vm.warp(block.timestamp + 61);
        vm.prank(caller501);
        vm.expectRevert(DebateMarket.TooManyArguments.selector);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT,
            keccak256("arg-501"), bytes32(0),
            1e6, caller501, DUMMY_PROOF,
            _makePublicInputs(nullifier501, expectedDebateDomain(), 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );
    }

    // ============================================================================
    // 34. FUZZ TESTING
    // ============================================================================

    function testFuzz_SettlementPayoutNeverExceedsTotalStake(
        uint256 stake1,
        uint256 stake2
    ) public {
        stake1 = bound(stake1, 1e6, 10_000e6);
        stake2 = bound(stake2, 1e6, 10_000e6);

        token.mint(arguer1, stake1);
        token.mint(arguer2, stake2);

        bytes32 debateId = _proposeStandardDebate();

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("fuzz-a"), bytes32(0),
            stake1, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("fuzz-b"), bytes32(0),
            stake2, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        _warpAndResolve(debateId);

        (,,,,,,, uint256 winningIdx,,,,,,,,,,,,,) = market.debates(debateId);

        uint256 netStake1 = stake1 - (stake1 * 200 / 10_000);
        uint256 netStake2 = stake2 - (stake2 * 200 / 10_000);
        uint256 totalNetStake = netStake1 + netStake2;

        if (winningIdx == 0) {
            uint256 balBefore = token.balanceOf(arguer1);
            vm.prank(arguer1);
            market.claimSettlement(debateId, NULLIFIER_1);
            uint256 payout = token.balanceOf(arguer1) - balBefore;
            assertLe(payout, totalNetStake, "Payout must not exceed total net stake");
            assertGe(payout, netStake1, "Payout must be at least original net stake");
        } else {
            uint256 balBefore = token.balanceOf(arguer2);
            vm.prank(arguer2);
            market.claimSettlement(debateId, NULLIFIER_2);
            uint256 payout = token.balanceOf(arguer2) - balBefore;
            assertLe(payout, totalNetStake, "Payout must not exceed total net stake");
            assertGe(payout, netStake2, "Payout must be at least original net stake");
        }
    }

    // ============================================================================
    // 35. MISSING REVERT PATH COVERAGE
    // ============================================================================

    function test_RevertWhen_DebateNotFound_AllPaths() public {
        bytes32 bogus = keccak256("nonexistent");

        vm.expectRevert(DebateMarket.DebateNotFound.selector);
        market.resolveDebate(bogus);

        vm.expectRevert(DebateMarket.DebateNotFound.selector);
        market.claimSettlement(bogus, NULLIFIER_1);

        vm.expectRevert(DebateMarket.DebateNotFound.selector);
        market.claimProposerBond(bogus);

        vm.prank(governance);
        vm.expectRevert(DebateMarket.DebateNotFound.selector);
        market.sweepForfeitedBond(bogus);

        vm.expectRevert(DebateMarket.DebateNotFound.selector);
        market.emergencyWithdraw(bogus, NULLIFIER_1);
    }

    function test_RevertWhen_CoSign_ArgumentNotFound() public {
        bytes32 debateId = _proposeStandardDebate();
        _submitArgumentWithNullifier(debateId, arguer1, NULLIFIER_1, 2);

        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        vm.expectRevert(DebateMarket.ArgumentNotFound.selector);
        market.coSignArgument(
            debateId, 1, STANDARD_STAKE, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );
    }

    function test_RevertWhen_DoubleClaimProposerBond() public {
        bytes32 debateId = _proposeStandardDebate();
        _submitArgumentWithNullifier(debateId, arguer1, NULLIFIER_1, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, arguer2, NULLIFIER_2, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, arguer3, NULLIFIER_3, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, cosigner1, NULLIFIER_4, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, cosigner2, NULLIFIER_5, 2);
        _warpAndResolve(debateId);

        vm.prank(proposer);
        market.claimProposerBond(debateId);

        vm.prank(proposer);
        vm.expectRevert(DebateMarket.BondAlreadyClaimed.selector);
        market.claimProposerBond(debateId);
    }

    function test_PauseUnpause_Lifecycle() public {
        vm.prank(governance);
        market.pause();

        vm.prank(proposer);
        vm.expectRevert("Pausable: paused");
        market.proposeDebate(PROPOSITION_HASH, STANDARD_DURATION, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND);

        vm.prank(governance);
        market.unpause();

        vm.prank(proposer);
        bytes32 debateId = market.proposeDebate(PROPOSITION_HASH, STANDARD_DURATION, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND);
        (DebateMarket.DebateStatus status,,,,) = market.getDebateState(debateId);
        assertEq(uint8(status), uint8(DebateMarket.DebateStatus.ACTIVE));
    }

    function test_RevertWhen_Paused_SubmitResolveClaim() public {
        bytes32 debateId = _proposeStandardDebate();
        _submitArgumentWithNullifier(debateId, arguer1, NULLIFIER_1, 2);

        vm.prank(governance);
        market.pause();

        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        vm.expectRevert("Pausable: paused");
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.warp(block.timestamp + STANDARD_DURATION + TEST_RESOLUTION_EXTENSION + 1);
        vm.expectRevert("Pausable: paused");
        market.resolveDebate(debateId);

        vm.expectRevert("Pausable: paused");
        market.claimSettlement(debateId, NULLIFIER_1);
    }

    function test_RevertWhen_DoubleStake_SpecificError() public {
        bytes32 debateId = _proposeStandardDebate();

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg1"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        vm.expectRevert(NullifierRegistry.NullifierAlreadyUsed.selector);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("arg2"), bytes32(0),
            STANDARD_STAKE, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );
    }

    // ============================================================================
    // 36. ALL-SAME-STANCE RESOLUTION
    // ============================================================================

    function test_Resolution_AllSameStance_HighestScoreWins() public {
        bytes32 debateId = _proposeStandardDebate();

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("s1"), bytes32(0),
            5e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("s2"), bytes32(0),
            3e6, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, expectedDebateDomain(), 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.warp(block.timestamp + 61);
        vm.prank(arguer3);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("s3"), bytes32(0),
            2e6, arguer3, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_3, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        _warpAndResolve(debateId);

        (,,,,,,,,, bytes32 winningBody,,,,,,,,,,, ) = market.debates(debateId);
        assertEq(winningBody, keccak256("s2"), "Highest-scoring SUPPORT argument wins");

        vm.prank(arguer1);
        vm.expectRevert(DebateMarket.NotWinningSide.selector);
        market.claimSettlement(debateId, NULLIFIER_1);

        vm.prank(arguer3);
        vm.expectRevert(DebateMarket.NotWinningSide.selector);
        market.claimSettlement(debateId, NULLIFIER_3);

        // totalNetStake=9_800_000, winArgStake=2_940_000, losingPool=6_860_000
        // payout = 2_940_000 + 6_860_000 = 9_800_000
        uint256 balBefore = token.balanceOf(arguer2);
        vm.prank(arguer2);
        market.claimSettlement(debateId, NULLIFIER_2);
        uint256 payout = token.balanceOf(arguer2) - balBefore;
        assertEq(payout, 9_800_000, "Winner takes entire pool in all-same-stance debate");
    }

    // ============================================================================
    // 37. MULTIPLE CO-SIGNS ON SAME ARGUMENT
    // ============================================================================

    function test_MultipleCoSigns_CumulativeScoreAndSettlement() public {
        bytes32 debateId = _proposeStandardDebate();

        // Arg 0: gross 4e6, net 3_920_000, tier 2: sqrt(3920000)*4=1979*4=7916
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("main"), bytes32(0),
            4e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        // Co-sign 1: gross 1e6, net 980_000, tier 1: sqrt(980000)*2=989*2=1978
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.coSignArgument(
            debateId, 0, 1e6, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, expectedDebateDomain(), 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        // Co-sign 2: gross 1e6, net 980_000, tier 3: sqrt(980000)*8=989*8=7912
        vm.warp(block.timestamp + 61);
        vm.prank(arguer3);
        market.coSignArgument(
            debateId, 0, 1e6, arguer3, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_3, expectedDebateDomain(), 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        // Co-sign 3: gross 2e6, net 1_960_000, tier 4: sqrt(1960000)*16=1400*16=22400
        vm.warp(block.timestamp + 61);
        vm.prank(cosigner1);
        market.coSignArgument(
            debateId, 0, 2e6, cosigner1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_4, expectedDebateDomain(), 4),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        uint256 score = market.getArgumentScore(debateId, 0);
        assertEq(score, 7916 + 1978 + 7912 + 22400, "Cumulative weighted score");

        // argTotalStake = 3_920_000 + 980_000 + 980_000 + 1_960_000 = 7_840_000
        uint256 argTotalStake = market.argumentTotalStakes(debateId, 0);
        assertEq(argTotalStake, 7_840_000, "Cumulative net stake: 3920000+980000+980000+1960000");

        // Loser: gross 8e6, net 7_840_000
        vm.warp(block.timestamp + 61);
        vm.prank(cosigner2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("loser"), bytes32(0),
            8e6, cosigner2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_5, expectedDebateDomain(), 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        _warpAndResolve(debateId);

        // totalStake=15_680_000, winArgStake=7_840_000, losingPool=7_840_000
        uint256 bal1 = token.balanceOf(arguer1);
        vm.prank(arguer1);
        market.claimSettlement(debateId, NULLIFIER_1);
        assertEq(token.balanceOf(arguer1) - bal1, 7_840_000, "arguer1 payout");

        uint256 bal2 = token.balanceOf(arguer2);
        vm.prank(arguer2);
        market.claimSettlement(debateId, NULLIFIER_2);
        assertEq(token.balanceOf(arguer2) - bal2, 1_960_000, "arguer2 payout");

        uint256 bal3 = token.balanceOf(arguer3);
        vm.prank(arguer3);
        market.claimSettlement(debateId, NULLIFIER_3);
        assertEq(token.balanceOf(arguer3) - bal3, 1_960_000, "arguer3 payout");

        uint256 bal4 = token.balanceOf(cosigner1);
        vm.prank(cosigner1);
        market.claimSettlement(debateId, NULLIFIER_4);
        assertEq(token.balanceOf(cosigner1) - bal4, 3_920_000, "cosigner1 payout");
    }

    // ============================================================================
    // 38. EVENT EMISSION ASSERTIONS
    // ============================================================================

    function test_Event_DebateProposed() public {
        bytes32 derivedDomain = expectedDebateDomain();
        vm.expectEmit(true, true, false, true);
        emit DebateProposed(
            keccak256(abi.encodePacked(PROPOSITION_HASH, derivedDomain, block.timestamp, proposer)),
            derivedDomain, PROPOSITION_HASH, block.timestamp + STANDARD_DURATION, ACTION_DOMAIN
        );
        vm.prank(proposer);
        market.proposeDebate(PROPOSITION_HASH, STANDARD_DURATION, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND);
    }

    function test_Event_DebateResolved() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.warp(block.timestamp + STANDARD_DURATION + TEST_RESOLUTION_EXTENSION + 1);
        // net(2e6)=1_960_000: sqrt=1400, tier2: *4=5600
        vm.expectEmit(true, false, false, true);
        emit DebateResolved(debateId, 0, DebateMarket.Stance.SUPPORT, 5600, 1, JURISDICTION_SIZE);
        market.resolveDebate(debateId);
    }

    function test_Event_EmergencyWithdrawn() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.warp(block.timestamp + STANDARD_DURATION + 30 days);
        vm.expectEmit(true, true, false, true);
        emit EmergencyWithdrawn(debateId, NULLIFIER_1, 1_960_000, arguer1);
        vm.prank(arguer1);
        market.emergencyWithdraw(debateId, NULLIFIER_1);
    }

    function test_Event_SettlementClaimed() public {
        (bytes32 debateId,) = _setupResolvedDebateWithTwoArguments();

        // net(10e6)=9_800_000 + net(5e6)=4_900_000 = 14_700_000
        vm.expectEmit(true, true, false, true);
        emit SettlementClaimed(debateId, NULLIFIER_2, 14_700_000, arguer2);
        vm.prank(arguer2);
        market.claimSettlement(debateId, NULLIFIER_2);
    }

    // ============================================================================
    // 39. GOVERNANCE TRANSFER
    // ============================================================================

    function test_GovernanceTransfer_FullCycle() public {
        address newGov = address(0x999);
        vm.prank(governance);
        market.initiateGovernanceTransfer(newGov);

        vm.expectRevert(TimelockGovernance.TimelockNotExpired.selector);
        market.executeGovernanceTransfer(newGov);

        vm.warp(block.timestamp + 7 days);
        market.executeGovernanceTransfer(newGov);
        assertEq(market.governance(), newGov);

        vm.prank(newGov);
        market.pause();

        vm.prank(governance);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        market.unpause();
    }

    function test_GovernanceTransfer_Cancel() public {
        address newGov = address(0x999);
        vm.prank(governance);
        market.initiateGovernanceTransfer(newGov);
        vm.prank(governance);
        market.cancelGovernanceTransfer(newGov);

        vm.warp(block.timestamp + 7 days);
        vm.expectRevert(TimelockGovernance.TransferNotInitiated.selector);
        market.executeGovernanceTransfer(newGov);
    }

    // ============================================================================
    // 40. FUZZ: EMERGENCY-WITHDRAW-THEN-SETTLE
    // ============================================================================

    function testFuzz_EmergencyWithdrawThenSettle_Solvency(
        uint256 stake1,
        uint256 stake2
    ) public {
        stake1 = bound(stake1, 1e6, 10_000e6);
        stake2 = bound(stake2, 1e6, 10_000e6);

        token.mint(arguer1, stake1);
        token.mint(arguer2, stake2);

        bytes32 debateId = _proposeStandardDebate();

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("fuzz-a"), bytes32(0),
            stake1, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("fuzz-b"), bytes32(0),
            stake2, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        uint256 contractBalAfterStakes = token.balanceOf(address(market));

        vm.warp(block.timestamp + STANDARD_DURATION + 30 days);
        vm.prank(arguer2);
        market.emergencyWithdraw(debateId, NULLIFIER_2);

        market.resolveDebate(debateId);

        (,,,,,,, uint256 winningIdx,,,,,,,,,,,,,) = market.debates(debateId);

        if (winningIdx == 0) {
            vm.prank(arguer1);
            market.claimSettlement(debateId, NULLIFIER_1);
        } else {
            vm.prank(arguer2);
            vm.expectRevert(DebateMarket.AlreadyClaimed.selector);
            market.claimSettlement(debateId, NULLIFIER_2);
        }

        uint256 contractBalFinal = token.balanceOf(address(market));
        assertGe(contractBalFinal, STANDARD_BOND, "Contract must retain at least the proposer bond");
        assertLe(
            contractBalAfterStakes - contractBalFinal,
            stake1 + stake2,
            "Total outflows must not exceed total gross stakes"
        );
    }

    function testFuzz_PartialEmergencyWithdraw_SettlementMath(
        uint256 stake1,
        uint256 stake2,
        uint256 stake3
    ) public {
        stake1 = bound(stake1, 1e6, 5_000e6);
        stake2 = bound(stake2, 1e6, 5_000e6);
        stake3 = bound(stake3, 1e6, 5_000e6);

        token.mint(arguer1, stake1);
        token.mint(arguer2, stake2);
        token.mint(arguer3, stake3);

        bytes32 debateId = _proposeStandardDebate();

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("fa"), bytes32(0),
            stake1, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("fb"), bytes32(0),
            stake2, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.warp(block.timestamp + 61);
        vm.prank(arguer3);
        market.coSignArgument(
            debateId, 1, stake3, arguer3, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_3, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.warp(block.timestamp + STANDARD_DURATION + 30 days);
        vm.prank(arguer2);
        market.emergencyWithdraw(debateId, NULLIFIER_2);

        market.resolveDebate(debateId);

        (,,,,,,, uint256 winIdx,,,,,,,,,,,,,) = market.debates(debateId);

        if (winIdx == 0) {
            vm.prank(arguer1);
            market.claimSettlement(debateId, NULLIFIER_1);
        } else {
            vm.prank(arguer3);
            market.claimSettlement(debateId, NULLIFIER_3);
        }

        uint256 contractFinal = token.balanceOf(address(market));
        assertGe(contractFinal, STANDARD_BOND, "Solvency: bond retained after all outflows");
    }

    // ============================================================================
    // 41. SETTLEMENT DUST INVARIANT
    // ============================================================================

    function testFuzz_SettlementDust_FavorsSolvency(
        uint256 winner1Stake,
        uint256 winner2Stake,
        uint256 loserStake
    ) public {
        winner1Stake = bound(winner1Stake, 1e6, 5_000e6);
        winner2Stake = bound(winner2Stake, 1e6, 5_000e6);
        loserStake = bound(loserStake, 1e6, 5_000e6);

        if (loserStake > winner1Stake) {
            loserStake = winner1Stake;
        }

        token.mint(arguer1, winner1Stake);
        token.mint(cosigner1, winner2Stake);
        token.mint(arguer2, loserStake);

        bytes32 debateId = _proposeStandardDebate();

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("dw1"), bytes32(0),
            winner1Stake, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.warp(block.timestamp + 61);
        vm.prank(cosigner1);
        market.coSignArgument(
            debateId, 0, winner2Stake, cosigner1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_3, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("dl"), bytes32(0),
            loserStake, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        _warpAndResolve(debateId);

        (,,,,,,, uint256 winIdx,,,,,,,,,,,,,) = market.debates(debateId);
        assertEq(winIdx, 0, "Co-signed argument must win");

        uint256 contractBalBefore = token.balanceOf(address(market));

        vm.prank(arguer1);
        market.claimSettlement(debateId, NULLIFIER_1);
        vm.prank(cosigner1);
        market.claimSettlement(debateId, NULLIFIER_3);

        uint256 totalPaidOut = contractBalBefore - token.balanceOf(address(market));

        uint256 netW1 = winner1Stake - (winner1Stake * 200 / 10_000);
        uint256 netW2 = winner2Stake - (winner2Stake * 200 / 10_000);
        uint256 netL = loserStake - (loserStake * 200 / 10_000);
        uint256 totalNetStake = netW1 + netW2 + netL;

        assertLe(totalPaidOut, totalNetStake, "Integer division dust must favor solvency");
        assertGe(token.balanceOf(address(market)), STANDARD_BOND, "Bond retained");
    }

    // ============================================================================
    // 42. RESOLVE GAS AT MAX ARGUMENTS
    // ============================================================================

    function test_ResolveGas_500Arguments() public {
        bytes32 debateId = _proposeStandardDebate();

        for (uint256 i = 0; i < 500; i++) {
            address caller = address(uint160(0x200000 + i));
            bytes32 nullifier = bytes32(uint256(0xBB0000 + i));
            token.mint(caller, 10e6);
            vm.prank(caller);
            token.approve(address(market), type(uint256).max);
            vm.warp(block.timestamp + 61);
            vm.prank(caller);
            market.submitArgument(
                debateId, DebateMarket.Stance.SUPPORT,
                keccak256(abi.encodePacked("gas-", i)), bytes32(0),
                1e6, caller, DUMMY_PROOF,
                _makePublicInputs(nullifier, expectedDebateDomain(), 1),
                VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
            );
        }

        vm.warp(block.timestamp + STANDARD_DURATION + TEST_RESOLUTION_EXTENSION + 1);

        uint256 gasBefore = gasleft();
        market.resolveDebate(debateId);
        uint256 gasUsed = gasBefore - gasleft();

        assertLt(gasUsed, 3_000_000, "resolveDebate at 500 args must be under 3M gas");
        emit log_named_uint("resolveDebate gas at 500 arguments", gasUsed);
    }

    // ============================================================================
    // 43. Derived Domain Integration
    // ============================================================================

    function test_DerivedDomain_DifferentPropositionsProduceDifferentDomains() public {
        bytes32 propHash1 = keccak256("Proposition A");
        bytes32 propHash2 = keccak256("Proposition B");

        bytes32 derived1 = market.deriveDomain(ACTION_DOMAIN, propHash1);
        bytes32 derived2 = market.deriveDomain(ACTION_DOMAIN, propHash2);

        assertTrue(derived1 != derived2, "Different propositions must produce different derived domains");

        uint256 BN254_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
        assertLt(uint256(derived1), BN254_MODULUS, "Derived domain 1 must be < BN254_MODULUS");
        assertLt(uint256(derived2), BN254_MODULUS, "Derived domain 2 must be < BN254_MODULUS");
    }

    function test_DerivedDomain_DuplicateDebateReverts() public {
        vm.prank(proposer);
        market.proposeDebate(PROPOSITION_HASH, STANDARD_DURATION, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND);

        vm.prank(proposer);
        vm.expectRevert(bytes("MockDistrictGate: derived already registered"));
        market.proposeDebate(PROPOSITION_HASH, STANDARD_DURATION, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND);
    }

    function test_DerivedDomain_StoredCorrectly() public {
        bytes32 derivedDomain = expectedDebateDomain();

        vm.prank(proposer);
        bytes32 debateId = market.proposeDebate(
            PROPOSITION_HASH, STANDARD_DURATION, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND
        );

        (, bytes32 storedActionDomain,,,,,,,,,,,,,,,,,,,) = market.debates(debateId);

        assertEq(storedActionDomain, derivedDomain, "Stored actionDomain must equal derived domain");
        assertTrue(storedActionDomain != ACTION_DOMAIN, "Stored actionDomain must differ from base domain");
    }

    function test_DerivedDomain_ArgumentUsesCorrectDomain() public {
        bytes32 debateId = _proposeStandardDebate();
        bytes32 derivedDomain = expectedDebateDomain();

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("correct-domain"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, derivedDomain, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        (,, uint256 argumentCount,,) = market.getDebateState(debateId);
        assertEq(argumentCount, 1);

        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        vm.expectRevert(DebateMarket.ActionDomainMismatch.selector);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("wrong-domain"), bytes32(0),
            STANDARD_STAKE, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );
    }

    // ============================================================================
    // 44. REVIEW GAP CLOSURES
    // ============================================================================

    function test_EmergencyWithdraw_SucceedsWhilePaused() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.prank(governance);
        market.pause();

        vm.warp(block.timestamp + STANDARD_DURATION + 30 days);

        uint256 balBefore = token.balanceOf(arguer1);
        vm.prank(arguer1);
        market.emergencyWithdraw(debateId, NULLIFIER_1);
        assertEq(token.balanceOf(arguer1) - balBefore, 1_960_000, "Emergency withdraw must work while paused");
    }

    function test_RevertWhen_DeriverNotAuthorized() public {
        MockDebateWeightVerifier dwV = new MockDebateWeightVerifier();
        MockPositionNoteVerifier pnV = new MockPositionNoteVerifier();
        MockAIEvaluationRegistry aiR = new MockAIEvaluationRegistry();
        DebateMarket unauthorizedMarket = new DebateMarket(
            address(mockGate), address(dwV), address(pnV), address(aiR),
            governance, address(token), 200
        );

        token.mint(proposer, 100e6);
        vm.prank(proposer);
        token.approve(address(unauthorizedMarket), type(uint256).max);

        vm.prank(proposer);
        vm.expectRevert(bytes("MockDistrictGate: not authorized deriver"));
        unauthorizedMarket.proposeDebate(PROPOSITION_HASH, STANDARD_DURATION, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND);
    }

    function test_RevertWhen_DebateNotFound_SubmitAndCoSign() public {
        bytes32 bogusId = keccak256("nonexistent");

        vm.prank(arguer1);
        vm.expectRevert(DebateMarket.DebateNotFound.selector);
        market.submitArgument(
            bogusId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.prank(arguer2);
        vm.expectRevert(DebateMarket.DebateNotFound.selector);
        market.coSignArgument(
            bogusId, 0, STANDARD_STAKE, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );
    }

    function test_RevertWhen_Paused_CoSign() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.prank(governance);
        market.pause();

        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        vm.expectRevert("Pausable: paused");
        market.coSignArgument(
            debateId, 0, STANDARD_STAKE, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );
    }

    function test_Event_ArgumentSubmitted() public {
        bytes32 debateId = _proposeStandardDebate();
        // net(2e6)=1_960_000: sqrt=1400, tier2: *4=5600
        uint256 expectedWeight = 5600;

        vm.expectEmit(true, true, false, true);
        emit ArgumentSubmitted(
            debateId, 0, DebateMarket.Stance.SUPPORT, keccak256("arg"), 2, expectedWeight, NULLIFIER_1
        );

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );
    }

    function test_Event_CoSignSubmitted() public {
        bytes32 debateId = _proposeStandardDebate();

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        // net(2e6)=1_960_000: sqrt=1400, tier3: *8=11200
        uint256 expectedWeight = 11200;
        vm.warp(block.timestamp + 61);
        vm.expectEmit(true, true, false, true);
        emit CoSignSubmitted(debateId, 0, 3, expectedWeight);

        vm.prank(arguer2);
        market.coSignArgument(
            debateId, 0, STANDARD_STAKE, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, expectedDebateDomain(), 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );
    }

    function test_RevertWhen_StakeRecordNotFound() public {
        (bytes32 debateId,) = _setupResolvedDebateWithTwoArguments();
        bytes32 unknownNullifier = bytes32(uint256(0xDEAD));

        vm.prank(arguer1);
        vm.expectRevert(DebateMarket.StakeRecordNotFound.selector);
        market.claimSettlement(debateId, unknownNullifier);
    }

    function test_RevertWhen_EmergencyWithdraw_StakeRecordNotFound() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.warp(block.timestamp + STANDARD_DURATION + 30 days);
        bytes32 unknownNullifier = bytes32(uint256(0xDEAD));
        vm.prank(arguer1);
        vm.expectRevert(DebateMarket.StakeRecordNotFound.selector);
        market.emergencyWithdraw(debateId, unknownNullifier);
    }

    function test_ResolveDebate_ExactDeadlineBoundary() public {
        bytes32 debateId = _proposeStandardDebate();

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        _warpAndResolve(debateId);

        (DebateMarket.DebateStatus status,,,,) = market.getDebateState(debateId);
        assertEq(uint8(status), uint8(DebateMarket.DebateStatus.RESOLVED));
    }

    function test_EmergencyWithdraw_ExactDelayBoundary() public {
        bytes32 debateId = _proposeStandardDebate();
        uint256 startTime = block.timestamp;

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        uint256 deadline = startTime + STANDARD_DURATION;
        uint256 exactEmergencyTime = deadline + 30 days;

        vm.warp(exactEmergencyTime - 1);
        vm.prank(arguer1);
        vm.expectRevert(DebateMarket.DebateStillActive.selector);
        market.emergencyWithdraw(debateId, NULLIFIER_1);

        vm.warp(exactEmergencyTime);
        vm.prank(arguer1);
        market.emergencyWithdraw(debateId, NULLIFIER_1);
        // Original: 10_000e6, spent 2e6, got back net(2e6)=1_960_000. Lost fee of 40_000.
        assertEq(token.balanceOf(arguer1), 10_000e6 - 40_000, "Should recover balance minus fee");
    }

    function test_SweepForfeitedBond_StaleDebate() public {
        bytes32 debateId = _proposeStandardDebate();

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg1"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("arg2"), bytes32(0),
            STANDARD_STAKE, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        vm.warp(block.timestamp + STANDARD_DURATION + 30 days);
        vm.prank(arguer1);
        market.emergencyWithdraw(debateId, NULLIFIER_1);
        vm.prank(arguer2);
        market.emergencyWithdraw(debateId, NULLIFIER_2);

        (,,, uint256 totalStake,) = market.getDebateState(debateId);
        assertEq(totalStake, 0, "All stakes withdrawn");

        uint256 govBal = token.balanceOf(governance);
        vm.prank(governance);
        market.sweepForfeitedBond(debateId);
        assertEq(token.balanceOf(governance) - govBal, STANDARD_BOND, "Governance receives forfeited bond");
    }

    // ============================================================================
    // 45. BENEFICIARY ROUTING
    // ============================================================================

    function test_Beneficiary_SettlementGoesToBeneficiary() public {
        address relayer = address(0x501);
        address user = address(0x502);

        token.mint(relayer, STANDARD_STAKE);
        vm.prank(relayer);
        token.approve(address(market), type(uint256).max);

        bytes32 debateId = _proposeStandardDebate();
        bytes32 derivedDomain = expectedDebateDomain();

        vm.prank(relayer);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, relayer, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, derivedDomain, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", user
        );

        _warpAndResolve(debateId);

        uint256 userBalBefore = token.balanceOf(user);
        uint256 relayerBalBefore = token.balanceOf(relayer);
        vm.prank(user);
        market.claimSettlement(debateId, NULLIFIER_1);

        assertEq(token.balanceOf(user) - userBalBefore, 1_960_000, "User must receive payout");
        assertEq(token.balanceOf(relayer), relayerBalBefore, "Relayer must NOT receive payout");
    }

    function test_Beneficiary_RelayerCanTriggerClaimButFundsGoToUser() public {
        address relayer = address(0x503);
        address user = address(0x504);

        token.mint(relayer, STANDARD_STAKE);
        vm.prank(relayer);
        token.approve(address(market), type(uint256).max);

        bytes32 debateId = _proposeStandardDebate();
        bytes32 derivedDomain = expectedDebateDomain();

        vm.prank(relayer);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, relayer, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, derivedDomain, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", user
        );

        _warpAndResolve(debateId);

        uint256 userBalBefore = token.balanceOf(user);
        uint256 relayerBalBefore = token.balanceOf(relayer);

        vm.prank(relayer);
        market.claimSettlement(debateId, NULLIFIER_1);

        assertEq(token.balanceOf(user) - userBalBefore, 1_960_000, "User must receive payout");
        assertEq(token.balanceOf(relayer), relayerBalBefore, "Relayer balance unchanged despite triggering claim");
    }

    function test_Beneficiary_ThirdPartyCannotClaim() public {
        address relayer = address(0x505);
        address user = address(0x506);
        address thirdParty = address(0x507);

        token.mint(relayer, STANDARD_STAKE);
        vm.prank(relayer);
        token.approve(address(market), type(uint256).max);

        bytes32 debateId = _proposeStandardDebate();
        bytes32 derivedDomain = expectedDebateDomain();

        vm.prank(relayer);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, relayer, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, derivedDomain, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", user
        );

        _warpAndResolve(debateId);

        vm.prank(thirdParty);
        vm.expectRevert(DebateMarket.UnauthorizedClaimer.selector);
        market.claimSettlement(debateId, NULLIFIER_1);
    }

    function test_Beneficiary_EmergencyWithdrawGoesToBeneficiary() public {
        address relayer = address(0x508);
        address user = address(0x509);

        token.mint(relayer, STANDARD_STAKE);
        vm.prank(relayer);
        token.approve(address(market), type(uint256).max);

        bytes32 debateId = _proposeStandardDebate();
        bytes32 derivedDomain = expectedDebateDomain();

        vm.prank(relayer);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, relayer, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, derivedDomain, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", user
        );

        vm.warp(block.timestamp + STANDARD_DURATION + 30 days);

        uint256 userBalBefore = token.balanceOf(user);
        uint256 relayerBalBefore = token.balanceOf(relayer);

        vm.prank(user);
        market.emergencyWithdraw(debateId, NULLIFIER_1);

        assertEq(token.balanceOf(user) - userBalBefore, 1_960_000, "User must receive refund");
        assertEq(token.balanceOf(relayer), relayerBalBefore, "Relayer balance unchanged");
    }

    // ============================================================================
    // 46. SWEEP APPEAL BOND
    // ============================================================================

    function test_SweepAppealBond_Success() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );
        vm.warp(block.timestamp + STANDARD_DURATION + 1);

        vm.prank(governance);
        market.escalateToGovernance(debateId);
        vm.prank(governance);
        market.submitGovernanceResolution(debateId, 0, keccak256("reason"));

        uint256 requiredBond = STANDARD_BOND * 2;
        token.mint(arguer1, requiredBond);
        vm.prank(arguer1);
        market.appealResolution(debateId);

        vm.warp(block.timestamp + 7 days + 1);
        market.finalizeAppeal(debateId);

        assertTrue(market.appealFinalized(debateId), "Appeal must be finalized");
        assertEq(market.appealBonds(debateId, arguer1), requiredBond, "Bond must be recorded");

        uint256 govBalBefore = token.balanceOf(governance);
        vm.prank(governance);
        vm.expectEmit(true, true, false, true);
        emit AppealBondForfeited(debateId, arguer1, requiredBond);
        market.sweepAppealBond(debateId, arguer1);

        assertEq(token.balanceOf(governance) - govBalBefore, requiredBond, "Governance must receive forfeited bond");
        assertEq(market.appealBonds(debateId, arguer1), 0, "Bond mapping must be zeroed");
    }

    function test_SweepAppealBond_RevertWhen_AppealNotFinalized() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );
        vm.warp(block.timestamp + STANDARD_DURATION + 1);

        vm.prank(governance);
        market.escalateToGovernance(debateId);
        vm.prank(governance);
        market.submitGovernanceResolution(debateId, 0, keccak256("reason"));

        uint256 requiredBond = STANDARD_BOND * 2;
        token.mint(arguer1, requiredBond);
        vm.prank(arguer1);
        market.appealResolution(debateId);

        vm.prank(governance);
        vm.expectRevert(DebateMarket.AppealNotFinalized.selector);
        market.sweepAppealBond(debateId, arguer1);
    }

    function test_SweepAppealBond_RevertWhen_AlreadySwept() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );
        vm.warp(block.timestamp + STANDARD_DURATION + 1);

        vm.prank(governance);
        market.escalateToGovernance(debateId);
        vm.prank(governance);
        market.submitGovernanceResolution(debateId, 0, keccak256("reason"));

        uint256 requiredBond = STANDARD_BOND * 2;
        token.mint(arguer1, requiredBond);
        vm.prank(arguer1);
        market.appealResolution(debateId);

        vm.warp(block.timestamp + 7 days + 1);
        market.finalizeAppeal(debateId);

        vm.prank(governance);
        market.sweepAppealBond(debateId, arguer1);

        vm.prank(governance);
        vm.expectRevert(DebateMarket.AppealBondAlreadySwept.selector);
        market.sweepAppealBond(debateId, arguer1);
    }

    function test_SweepAppealBond_RevertWhen_NotGovernance() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.warp(block.timestamp + STANDARD_DURATION + 1);
        vm.prank(arguer1);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        market.sweepAppealBond(debateId, arguer1);
    }

    // ============================================================================
    // 47. PROTOCOL FEE TESTS
    // ============================================================================

    function test_feeDeductedOnSubmitArgument() public {
        bytes32 debateId = _proposeStandardDebate();

        assertEq(market.accumulatedFees(), 0);

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        // 2% of 2e6 = 40_000
        assertEq(market.accumulatedFees(), 40_000);
    }

    function test_feeDeductedOnCoSign() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        uint256 feesBefore = market.accumulatedFees();

        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.coSignArgument(
            debateId, 0, STANDARD_STAKE, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, expectedDebateDomain(), 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        assertEq(market.accumulatedFees() - feesBefore, 40_000);
    }

    function test_noFeeOnProposerBond() public {
        assertEq(market.accumulatedFees(), 0);
        _proposeStandardDebate();
        assertEq(market.accumulatedFees(), 0);
    }

    function test_noFeeOnAppealBond() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );
        vm.warp(block.timestamp + STANDARD_DURATION + 1);
        vm.prank(governance);
        market.escalateToGovernance(debateId);
        vm.prank(governance);
        market.submitGovernanceResolution(debateId, 0, keccak256("reason"));

        uint256 feesBefore = market.accumulatedFees();

        uint256 requiredBond = STANDARD_BOND * 2;
        token.mint(arguer1, requiredBond);
        vm.prank(arguer1);
        market.appealResolution(debateId);

        assertEq(market.accumulatedFees(), feesBefore, "Appeal bond must not incur fee");
    }

    function test_sweepFees() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            10e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        uint256 fees = market.accumulatedFees();
        assertEq(fees, 200_000);

        address feeRecipient = address(0xFEE);
        uint256 balBefore = token.balanceOf(feeRecipient);
        vm.prank(governance);
        market.sweepFees(feeRecipient);
        assertEq(token.balanceOf(feeRecipient) - balBefore, 200_000);
        assertEq(market.accumulatedFees(), 0);
    }

    function test_sweepFeesRevertsWhenEmpty() public {
        vm.prank(governance);
        vm.expectRevert(DebateMarket.NoFeesToSweep.selector);
        market.sweepFees(address(0xFEE));
    }

    function test_setProtocolFee() public {
        assertEq(market.protocolFeeBps(), 200);
        vm.prank(governance);
        market.setProtocolFee(500);
        assertEq(market.protocolFeeBps(), 500);
    }

    function test_setProtocolFeeRevertsAboveCap() public {
        vm.prank(governance);
        vm.expectRevert(DebateMarket.FeeExceedsCap.selector);
        market.setProtocolFee(1001);
    }

    function test_settlementUsesNetStake() public {
        bytes32 debateId = _proposeStandardDebate();

        // Winner: gross 10e6, net 9_800_000
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("win"), bytes32(0),
            10e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        // Loser: gross 10e6, net 9_800_000
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("lose"), bytes32(0),
            10e6, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, expectedDebateDomain(), 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        _warpAndResolve(debateId);

        uint256 balBefore = token.balanceOf(arguer1);
        vm.prank(arguer1);
        market.claimSettlement(debateId, NULLIFIER_1);
        uint256 payout = token.balanceOf(arguer1) - balBefore;

        // totalNetStake = 19_600_000, payout = 19_600_000
        assertEq(payout, 19_600_000, "Settlement must use net stakes (after fee)");
        // Total fees: 2 * 200_000 = 400_000
        assertEq(market.accumulatedFees(), 400_000, "Fees accumulated from both stakes");
    }

    function test_zeroFeePassthrough() public {
        // Set fee to 0
        vm.prank(governance);
        market.setProtocolFee(0);

        bytes32 debateId = _proposeStandardDebate();

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, expectedDebateDomain(), 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        assertEq(market.accumulatedFees(), 0, "No fee when rate is 0");

        // totalStake should be full gross amount
        (,,, uint256 totalStake,) = market.getDebateState(debateId);
        assertEq(totalStake, STANDARD_STAKE, "Full amount enters stake at 0% fee");
    }

    // ============================================================================
    // HELPER FUNCTIONS
    // ============================================================================

    function expectedDebateDomain() internal pure returns (bytes32) {
        uint256 BN254_MOD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
        uint256 raw = uint256(keccak256(abi.encodePacked(ACTION_DOMAIN, "debate", PROPOSITION_HASH)));
        return bytes32(raw % BN254_MOD);
    }

    function _makePublicInputs(
        bytes32 nullifier,
        bytes32 actionDomain,
        uint256 engagementTier
    ) internal pure returns (uint256[31] memory inputs) {
        inputs[0] = uint256(bytes32(uint256(0xAAAA1111)));
        inputs[1] = uint256(bytes32(uint256(0xBBBB1111)));
        inputs[26] = uint256(nullifier);
        inputs[27] = uint256(actionDomain);
        inputs[28] = uint256(3);
        inputs[29] = uint256(bytes32(uint256(0xCCCC1111)));
        inputs[30] = engagementTier;
    }

    function _proposeStandardDebate() internal returns (bytes32) {
        vm.prank(proposer);
        return market.proposeDebate(
            PROPOSITION_HASH, STANDARD_DURATION, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND
        );
    }

    function _submitArgumentWithNullifier(
        bytes32 debateId,
        address caller,
        bytes32 nullifier,
        uint8 tier
    ) internal {
        vm.prank(caller);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT,
            keccak256(abi.encodePacked("arg-", nullifier)), bytes32(0),
            STANDARD_STAKE, caller, DUMMY_PROOF,
            _makePublicInputs(nullifier, expectedDebateDomain(), tier),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );
    }

    function _setupResolvedDebateWithTwoArguments()
        internal
        returns (bytes32 debateId, uint256 winningIndex)
    {
        debateId = _proposeStandardDebate();
        bytes32 derivedDomain = expectedDebateDomain();

        // Argument 0: Tier 1, gross $5 (loser)
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("loser"), bytes32(0),
            5e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, derivedDomain, 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        // Argument 1: Tier 3, gross $10 (winner)
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("winner"), bytes32(0),
            10e6, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, derivedDomain, 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00", address(0)
        );

        _warpAndResolve(debateId);

        winningIndex = 1;
    }
}

// ============================================================================
// MOCK CONTRACTS
// ============================================================================

contract MockDistrictGate {
    NullifierRegistry public nullifierRegistry;
    mapping(bytes32 => bool) public allowedActionDomains;
    mapping(address => bool) public authorizedDerivers;
    mapping(bytes32 => bytes32) public derivedDomainBase;

    constructor(address _nullifierRegistry) {
        nullifierRegistry = NullifierRegistry(_nullifierRegistry);
    }

    function setActionDomainAllowed(bytes32 domain, bool allowed) external {
        allowedActionDomains[domain] = allowed;
    }

    function setDeriverAuthorized(address deriver, bool authorized) external {
        authorizedDerivers[deriver] = authorized;
    }

    function registerDerivedDomain(bytes32 baseDomain, bytes32 derivedDomain) external {
        require(authorizedDerivers[msg.sender], "MockDistrictGate: not authorized deriver");
        require(allowedActionDomains[baseDomain], "MockDistrictGate: base domain not allowed");
        require(!allowedActionDomains[derivedDomain], "MockDistrictGate: derived already registered");

        allowedActionDomains[derivedDomain] = true;
        derivedDomainBase[derivedDomain] = baseDomain;
    }

    function verifyThreeTreeProof(
        address,
        bytes calldata,
        uint256[31] calldata publicInputs,
        uint8,
        uint256,
        bytes calldata
    ) external {
        bytes32 nullifier = bytes32(publicInputs[26]);
        bytes32 actionDomain = bytes32(publicInputs[27]);
        bytes32 userRoot = bytes32(publicInputs[0]);
        nullifierRegistry.recordNullifier(actionDomain, nullifier, userRoot);
    }
}

contract MockDebateWeightVerifier is IDebateWeightVerifier {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        return true;
    }
}

contract MockPositionNoteVerifier is IPositionNoteVerifier {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        return true;
    }
}

contract RejectingDebateWeightVerifier is IDebateWeightVerifier {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        return false;
    }
}

contract RejectingPositionNoteVerifier is IPositionNoteVerifier {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        return false;
    }
}

contract MockAIEvaluationRegistry is IAIEvaluationRegistry {
    function isRegistered(address) external pure returns (bool) { return true; }
    function quorum() external pure returns (uint256) { return 3; }
    function modelCount() external pure returns (uint256) { return 5; }
    function aiWeight() external pure returns (uint256) { return 4000; }
    function minProviders() external pure returns (uint256) { return 3; }
    function providerCount() external pure returns (uint256) { return 5; }
}

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "ERC20: insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "ERC20: insufficient balance");
        if (allowance[from][msg.sender] != type(uint256).max) {
            require(allowance[from][msg.sender] >= amount, "ERC20: insufficient allowance");
            allowance[from][msg.sender] -= amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
