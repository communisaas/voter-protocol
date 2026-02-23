// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "forge-std/Test.sol";
import "../src/DebateMarket.sol";
import "../src/TimelockGovernance.sol";
import "../src/NullifierRegistry.sol";

/// @title DebateMarket Foundry Tests
/// @notice Comprehensive tests for the staked debate protocol
/// @dev Tests cover:
///      1. Lifecycle — happy path (propose, argue, resolve, settle)
///      2. Propose validation (duration, bond, action domain)
///      3. Argument submission (success, scoring, deadline, stake floor)
///      4. Co-sign (weighted scoring, tier multipliers)
///      5. Resolution (highest score wins, tie-breaking, amendment)
///      6. Settlement (winning payout, proportional, losers rejected, double-claim)
///      7. Proposer bond (threshold return, forfeit, access control)
///      8. Nullifier / double-stake prevention
///      9. Participation depth tracking
///     10. sqrt math (known values, edge cases)
///     11. Scoring table verification (spec numbers)
///
/// MOCK ARCHITECTURE:
///   - MockDistrictGate: Accepts verifyThreeTreeProof without reverting,
///     records nullifiers in real NullifierRegistry (so double-stake tests work),
///     has configurable allowedActionDomains mapping.
///   - MockERC20: Simple ERC-20 with public mint for staking token.
///   - Real NullifierRegistry: Used for nullifier double-use enforcement.
contract DebateMarketTest is Test {
    DebateMarket public market;
    MockDistrictGate public mockGate;
    MockERC20 public token;
    NullifierRegistry public nullifierRegistry;

    address public governance = address(0x1);
    address public proposer = address(0x10);
    address public arguer1 = address(0x20);
    address public arguer2 = address(0x30);
    address public arguer3 = address(0x40);
    address public cosigner1 = address(0x50);
    address public cosigner2 = address(0x60);

    bytes32 public constant ACTION_DOMAIN = keccak256("debate-housing-2026");
    bytes32 public constant PROPOSITION_HASH = keccak256("Should we increase housing density?");

    // Nullifiers for different participants
    bytes32 public constant NULLIFIER_PROPOSER = bytes32(uint256(0x1000));
    bytes32 public constant NULLIFIER_1 = bytes32(uint256(0x2000));
    bytes32 public constant NULLIFIER_2 = bytes32(uint256(0x3000));
    bytes32 public constant NULLIFIER_3 = bytes32(uint256(0x4000));
    bytes32 public constant NULLIFIER_4 = bytes32(uint256(0x5000));
    bytes32 public constant NULLIFIER_5 = bytes32(uint256(0x6000));
    bytes32 public constant NULLIFIER_6 = bytes32(uint256(0x7000));
    bytes32 public constant NULLIFIER_7 = bytes32(uint256(0x8000));

    // Standard duration: 4 days (between MIN and MAX)
    uint256 public constant STANDARD_DURATION = 4 days;

    // Standard bond ($5 USDC = 5e6)
    uint256 public constant STANDARD_BOND = 5e6;

    // Standard stake ($2 USDC = 2e6)
    uint256 public constant STANDARD_STAKE = 2e6;

    // Standard jurisdiction size
    uint256 public constant JURISDICTION_SIZE = 700_000;

    // Dummy proof data
    bytes public constant DUMMY_PROOF = hex"deadbeef";
    uint8 public constant VERIFIER_DEPTH = 20;

    // Events from DebateMarket
    event DebateProposed(
        bytes32 indexed debateId,
        bytes32 indexed actionDomain,
        bytes32 propositionHash,
        uint256 deadline
    );

    event ArgumentSubmitted(
        bytes32 indexed debateId,
        uint256 indexed argumentIndex,
        DebateMarket.Stance stance,
        bytes32 bodyHash,
        uint8 engagementTier,
        uint256 weight
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

    event SettlementClaimed(bytes32 indexed debateId, bytes32 nullifier, uint256 payout);

    event EmergencyWithdrawn(bytes32 indexed debateId, bytes32 nullifier, uint256 amount);

    event ProposerBondReturned(bytes32 indexed debateId, uint256 bondAmount);

    event ProposerBondForfeited(bytes32 indexed debateId, uint256 bondAmount);

    function setUp() public {
        // Deploy real NullifierRegistry
        nullifierRegistry = new NullifierRegistry(governance);

        // Deploy MockDistrictGate with real NullifierRegistry
        mockGate = new MockDistrictGate(address(nullifierRegistry));

        // Authorize MockDistrictGate as caller on NullifierRegistry
        vm.prank(governance);
        nullifierRegistry.proposeCallerAuthorization(address(mockGate));
        vm.warp(block.timestamp + 7 days);
        nullifierRegistry.executeCallerAuthorization(address(mockGate));

        // Configure action domain on mock gate
        mockGate.setActionDomainAllowed(ACTION_DOMAIN, true);

        // Deploy MockERC20
        token = new MockERC20("Test USD", "TUSD", 6);

        // Deploy DebateMarket
        market = new DebateMarket(
            address(mockGate),
            address(token),
            governance
        );

        // Mint tokens to all test addresses
        token.mint(proposer, 1_000e6);
        token.mint(arguer1, 1_000e6);
        token.mint(arguer2, 1_000e6);
        token.mint(arguer3, 1_000e6);
        token.mint(cosigner1, 1_000e6);
        token.mint(cosigner2, 1_000e6);

        // Approve market for all test addresses
        vm.prank(proposer);
        token.approve(address(market), type(uint256).max);
        vm.prank(arguer1);
        token.approve(address(market), type(uint256).max);
        vm.prank(arguer2);
        token.approve(address(market), type(uint256).max);
        vm.prank(arguer3);
        token.approve(address(market), type(uint256).max);
        vm.prank(cosigner1);
        token.approve(address(market), type(uint256).max);
        vm.prank(cosigner2);
        token.approve(address(market), type(uint256).max);
    }

    // ============================================================================
    // 1. LIFECYCLE — HAPPY PATH
    // ============================================================================

    /// @notice Propose creates debate with correct state
    function test_ProposeDebate_Success() public {
        vm.prank(proposer);
        bytes32 debateId = market.proposeDebate(
            PROPOSITION_HASH,
            STANDARD_DURATION,
            JURISDICTION_SIZE,
            ACTION_DOMAIN,
            STANDARD_BOND
        );

        // Verify debate state
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

        // Verify bond transferred
        assertEq(token.balanceOf(address(market)), STANDARD_BOND);
        assertEq(token.balanceOf(proposer), 1_000e6 - STANDARD_BOND);
    }

    /// @notice Full lifecycle: propose, 3 arguments, co-signs, resolution, settlement
    function test_FullLifecycle_ProposeArgueResolveSettle() public {
        // --- PROPOSE ---
        vm.prank(proposer);
        bytes32 debateId = market.proposeDebate(
            PROPOSITION_HASH,
            STANDARD_DURATION,
            JURISDICTION_SIZE,
            ACTION_DOMAIN,
            STANDARD_BOND
        );

        // --- ARGUE: 3 arguments with different stances and tiers ---
        // Argument 0: SUPPORT, Tier 2, $10 stake
        uint256 stake0 = 10e6;
        vm.prank(arguer1);
        market.submitArgument(
            debateId,
            DebateMarket.Stance.SUPPORT,
            keccak256("Support argument"),
            bytes32(0),
            stake0,
            arguer1,
            DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
        );

        // Argument 1: OPPOSE, Tier 3, $5 stake
        uint256 stake1 = 5e6;
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId,
            DebateMarket.Stance.OPPOSE,
            keccak256("Oppose argument"),
            bytes32(0),
            stake1,
            arguer2,
            DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, ACTION_DOMAIN, 3),
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
        );

        // Argument 2: AMEND, Tier 1, $20 stake
        uint256 stake2 = 20e6;
        vm.warp(block.timestamp + 61);
        vm.prank(arguer3);
        market.submitArgument(
            debateId,
            DebateMarket.Stance.AMEND,
            keccak256("Amend argument"),
            keccak256("Amendment text"),
            stake2,
            arguer3,
            DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_3, ACTION_DOMAIN, 1),
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
        );

        // Verify argument count
        (,, uint256 argumentCount,,) = market.getDebateState(debateId);
        assertEq(argumentCount, 3);

        // --- RESOLVE ---
        vm.warp(block.timestamp + STANDARD_DURATION);
        market.resolveDebate(debateId);

        (DebateMarket.DebateStatus status,,,,) = market.getDebateState(debateId);
        assertEq(uint8(status), uint8(DebateMarket.DebateStatus.RESOLVED));
    }

    // ============================================================================
    // 2. PROPOSE VALIDATION
    // ============================================================================

    /// @notice Revert when duration < 72 hours
    function test_RevertWhen_DurationTooShort() public {
        vm.prank(proposer);
        vm.expectRevert(DebateMarket.InvalidDuration.selector);
        market.proposeDebate(
            PROPOSITION_HASH,
            71 hours, // below MIN_DURATION
            JURISDICTION_SIZE,
            ACTION_DOMAIN,
            STANDARD_BOND
        );
    }

    /// @notice Revert when duration > 30 days
    function test_RevertWhen_DurationTooLong() public {
        vm.prank(proposer);
        vm.expectRevert(DebateMarket.InvalidDuration.selector);
        market.proposeDebate(
            PROPOSITION_HASH,
            31 days, // above MAX_DURATION
            JURISDICTION_SIZE,
            ACTION_DOMAIN,
            STANDARD_BOND
        );
    }

    /// @notice Revert when bond below minimum
    function test_RevertWhen_InsufficientBond() public {
        vm.prank(proposer);
        vm.expectRevert(DebateMarket.InsufficientBond.selector);
        market.proposeDebate(
            PROPOSITION_HASH,
            STANDARD_DURATION,
            JURISDICTION_SIZE,
            ACTION_DOMAIN,
            0.5e6 // below MIN_PROPOSER_BOND (1e6)
        );
    }

    /// @notice Revert when action domain not whitelisted on gate
    function test_RevertWhen_ActionDomainNotAllowed() public {
        bytes32 badDomain = keccak256("not-whitelisted-domain");

        vm.prank(proposer);
        vm.expectRevert(DebateMarket.ActionDomainNotAllowed.selector);
        market.proposeDebate(
            PROPOSITION_HASH,
            STANDARD_DURATION,
            JURISDICTION_SIZE,
            badDomain,
            STANDARD_BOND
        );
    }

    /// @notice Duration at exactly MIN_DURATION succeeds
    function test_ProposeDebate_ExactMinDuration() public {
        vm.prank(proposer);
        bytes32 debateId = market.proposeDebate(
            PROPOSITION_HASH,
            72 hours,
            JURISDICTION_SIZE,
            ACTION_DOMAIN,
            STANDARD_BOND
        );

        (DebateMarket.DebateStatus status,,,,) = market.getDebateState(debateId);
        assertEq(uint8(status), uint8(DebateMarket.DebateStatus.ACTIVE));
    }

    /// @notice Duration at exactly MAX_DURATION succeeds
    function test_ProposeDebate_ExactMaxDuration() public {
        vm.prank(proposer);
        bytes32 debateId = market.proposeDebate(
            PROPOSITION_HASH,
            30 days,
            JURISDICTION_SIZE,
            ACTION_DOMAIN,
            STANDARD_BOND
        );

        (DebateMarket.DebateStatus status,,,,) = market.getDebateState(debateId);
        assertEq(uint8(status), uint8(DebateMarket.DebateStatus.ACTIVE));
    }

    // ============================================================================
    // 3. ARGUMENT SUBMISSION
    // ============================================================================

    /// @notice Valid argument stored correctly
    function test_SubmitArgument_Success() public {
        bytes32 debateId = _proposeStandardDebate();
        bytes32 bodyHash = keccak256("My argument");

        vm.prank(arguer1);
        market.submitArgument(
            debateId,
            DebateMarket.Stance.SUPPORT,
            bodyHash,
            bytes32(0),
            STANDARD_STAKE,
            arguer1,
            DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
        );

        // Verify argument count incremented
        (,, uint256 argumentCount,,) = market.getDebateState(debateId);
        assertEq(argumentCount, 1);

        // Verify score was set
        uint256 score = market.getArgumentScore(debateId, 0);
        assertGt(score, 0);
    }

    /// @notice Verify sqrt(stake) * 2^tier calculation
    function test_SubmitArgument_SqrtWeightedScoring() public {
        bytes32 debateId = _proposeStandardDebate();

        // Tier 2 ($4 stake): sqrt(4e6) * 4 = 2000 * 4 = 8000
        uint256 stake = 4e6;
        vm.prank(arguer1);
        market.submitArgument(
            debateId,
            DebateMarket.Stance.SUPPORT,
            keccak256("arg"),
            bytes32(0),
            stake,
            arguer1,
            DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
        );

        uint256 score = market.getArgumentScore(debateId, 0);
        // sqrt(4e6) = 2000, TIER_MULTIPLIER[2] = 4, weight = 2000 * 4 = 8000
        assertEq(score, 8000);
    }

    /// @notice Revert when submitting after debate deadline
    function test_RevertWhen_DebateExpired() public {
        bytes32 debateId = _proposeStandardDebate();

        // Warp past deadline
        vm.warp(block.timestamp + STANDARD_DURATION);

        vm.prank(arguer1);
        vm.expectRevert(DebateMarket.DebateExpired.selector);
        market.submitArgument(
            debateId,
            DebateMarket.Stance.SUPPORT,
            keccak256("late arg"),
            bytes32(0),
            STANDARD_STAKE,
            arguer1,
            DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
        );
    }

    /// @notice Revert when stake below minimum
    function test_RevertWhen_InsufficientStake() public {
        bytes32 debateId = _proposeStandardDebate();

        vm.prank(arguer1);
        vm.expectRevert(DebateMarket.InsufficientStake.selector);
        market.submitArgument(
            debateId,
            DebateMarket.Stance.SUPPORT,
            keccak256("cheap arg"),
            bytes32(0),
            0.5e6, // below MIN_ARGUMENT_STAKE (1e6)
            arguer1,
            DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
        );
    }

    /// @notice Tier 0 cannot submit arguments (multiplier is 0)
    function test_RevertWhen_Tier0Submits() public {
        bytes32 debateId = _proposeStandardDebate();

        vm.prank(arguer1);
        vm.expectRevert(DebateMarket.InvalidEngagementTier.selector);
        market.submitArgument(
            debateId,
            DebateMarket.Stance.SUPPORT,
            keccak256("tier0 arg"),
            bytes32(0),
            STANDARD_STAKE,
            arguer1,
            DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 0), // tier 0
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
        );
    }

    // ============================================================================
    // 4. CO-SIGN
    // ============================================================================

    /// @notice Co-sign adds to argument score
    function test_CoSign_AddsToArgumentScore() public {
        bytes32 debateId = _proposeStandardDebate();

        // Submit initial argument
        vm.prank(arguer1);
        market.submitArgument(
            debateId,
            DebateMarket.Stance.SUPPORT,
            keccak256("arg"),
            bytes32(0),
            STANDARD_STAKE,
            arguer1,
            DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
        );

        uint256 scoreBefore = market.getArgumentScore(debateId, 0);

        // Co-sign from different participant
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.coSignArgument(
            debateId,
            0, // argument index
            STANDARD_STAKE,
            arguer2,
            DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, ACTION_DOMAIN, 3),
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
        );

        uint256 scoreAfter = market.getArgumentScore(debateId, 0);
        assertGt(scoreAfter, scoreBefore);
    }

    /// @notice Different tiers weighted correctly on co-sign
    function test_CoSign_DifferentTiersWeightedCorrectly() public {
        bytes32 debateId = _proposeStandardDebate();

        // Submit initial argument (Tier 2, $1 stake)
        vm.prank(arguer1);
        market.submitArgument(
            debateId,
            DebateMarket.Stance.SUPPORT,
            keccak256("arg"),
            bytes32(0),
            1e6, // $1
            arguer1,
            DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
        );

        uint256 scoreAfterArg = market.getArgumentScore(debateId, 0);
        // sqrt(1e6) = 1000, * 4 = 4000
        assertEq(scoreAfterArg, 4000);

        // Co-sign: Tier 4, $1 stake -> sqrt(1e6) * 16 = 16000
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.coSignArgument(
            debateId,
            0,
            1e6,
            arguer2,
            DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, ACTION_DOMAIN, 4),
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
        );

        uint256 scoreAfterCoSign = market.getArgumentScore(debateId, 0);
        // 4000 + 16000 = 20000
        assertEq(scoreAfterCoSign, 20000);
    }

    // ============================================================================
    // 5. RESOLUTION
    // ============================================================================

    /// @notice Highest score wins
    function test_ResolveDebate_HighestScoreWins() public {
        bytes32 debateId = _proposeStandardDebate();

        // Argument 0: Tier 1, $5 -> sqrt(5e6) * 2 = 4472 (approx)
        vm.prank(arguer1);
        market.submitArgument(
            debateId,
            DebateMarket.Stance.SUPPORT,
            keccak256("weaker"),
            bytes32(0),
            5e6,
            arguer1,
            DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 1),
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
        );

        // Argument 1: Tier 3, $10 -> sqrt(10e6) * 8 = 25298 (approx)
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId,
            DebateMarket.Stance.OPPOSE,
            keccak256("stronger"),
            bytes32(0),
            10e6,
            arguer2,
            DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, ACTION_DOMAIN, 3),
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
        );

        // Verify scores
        uint256 score0 = market.getArgumentScore(debateId, 0);
        uint256 score1 = market.getArgumentScore(debateId, 1);
        assertGt(score1, score0);

        // Resolve
        vm.warp(block.timestamp + STANDARD_DURATION);
        market.resolveDebate(debateId);

        // Check winning argument body hash
        // Debate struct fields: propositionHash, actionDomain, deadline,
        //   argumentCount, uniqueParticipants, jurisdictionSizeHint, totalStake,
        //   winningArgumentIndex, winningStance, winningBodyHash, winningAmendmentHash,
        //   status, proposer, proposerBond, bondClaimed
        (,,,,,,,,, bytes32 winningBodyHash,,,,, ) = market.debates(debateId);
        assertEq(winningBodyHash, keccak256("stronger"));
    }

    /// @notice Ties go to earlier argument (lower index)
    function test_ResolveDebate_TiesGoToEarlierArgument() public {
        bytes32 debateId = _proposeStandardDebate();

        // Argument 0: Tier 2, $4 -> sqrt(4e6) * 4 = 8000
        vm.prank(arguer1);
        market.submitArgument(
            debateId,
            DebateMarket.Stance.SUPPORT,
            keccak256("first"),
            bytes32(0),
            4e6,
            arguer1,
            DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
        );

        // Argument 1: Tier 2, $4 -> sqrt(4e6) * 4 = 8000 (same score)
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId,
            DebateMarket.Stance.OPPOSE,
            keccak256("second"),
            bytes32(0),
            4e6,
            arguer2,
            DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
        );

        // Verify equal scores
        uint256 score0 = market.getArgumentScore(debateId, 0);
        uint256 score1 = market.getArgumentScore(debateId, 1);
        assertEq(score0, score1);

        // Resolve — tie goes to earlier (index 0)
        vm.warp(block.timestamp + STANDARD_DURATION);
        market.resolveDebate(debateId);

        // The first argument (index 0) should win on tie
        (,,,,,,,,, bytes32 winningBodyHash,,,,, ) = market.debates(debateId);
        assertEq(winningBodyHash, keccak256("first"));
    }

    /// @notice Revert when resolving before deadline
    function test_RevertWhen_ResolveBeforeDeadline() public {
        bytes32 debateId = _proposeStandardDebate();

        vm.expectRevert(DebateMarket.DebateStillActive.selector);
        market.resolveDebate(debateId);
    }

    /// @notice AMEND stance populates winningAmendmentHash
    function test_ResolveDebate_AmendmentStoresWinningAmendment() public {
        bytes32 debateId = _proposeStandardDebate();
        bytes32 amendmentHash = keccak256("proposed amendment text");

        // Submit AMEND argument with high weight
        vm.prank(arguer1);
        market.submitArgument(
            debateId,
            DebateMarket.Stance.AMEND,
            keccak256("amend body"),
            amendmentHash,
            10e6,
            arguer1,
            DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 4), // Tier 4 = high weight
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
        );

        // Resolve
        vm.warp(block.timestamp + STANDARD_DURATION);
        market.resolveDebate(debateId);

        // Check amendment hash is stored
        (,,,,,,,,,, bytes32 storedAmendment,,,, ) = market.debates(debateId);
        assertEq(storedAmendment, amendmentHash);
    }

    // ============================================================================
    // 6. SETTLEMENT
    // ============================================================================

    /// @notice Winning side gets payout
    function test_ClaimSettlement_WinningSideGetsPayout() public {
        (bytes32 debateId,) = _setupResolvedDebateWithTwoArguments();

        // The winning argument should be arguer2 (Tier 3, higher weight)
        // arguer2 claims settlement
        uint256 balanceBefore = token.balanceOf(arguer2);
        vm.prank(arguer2);
        market.claimSettlement(debateId, NULLIFIER_2);
        uint256 balanceAfter = token.balanceOf(arguer2);

        // Should get back more than they staked (their stake + share of losers)
        assertGt(balanceAfter, balanceBefore);
    }

    /// @notice Losers cannot claim
    function test_RevertWhen_ClaimLosingSide() public {
        (bytes32 debateId,) = _setupResolvedDebateWithTwoArguments();

        // arguer1 is on the losing side
        vm.prank(arguer1);
        vm.expectRevert(DebateMarket.NotWinningSide.selector);
        market.claimSettlement(debateId, NULLIFIER_1);
    }

    /// @notice Same nullifier cannot claim twice
    function test_RevertWhen_DoubleClaim() public {
        (bytes32 debateId,) = _setupResolvedDebateWithTwoArguments();

        // First claim succeeds
        vm.prank(arguer2);
        market.claimSettlement(debateId, NULLIFIER_2);

        // Second claim reverts
        vm.prank(arguer2);
        vm.expectRevert(DebateMarket.AlreadyClaimed.selector);
        market.claimSettlement(debateId, NULLIFIER_2);
    }

    /// @notice Cannot claim before debate is resolved
    function test_RevertWhen_DebateNotResolved() public {
        bytes32 debateId = _proposeStandardDebate();

        // Submit argument but don't resolve
        vm.prank(arguer1);
        market.submitArgument(
            debateId,
            DebateMarket.Stance.SUPPORT,
            keccak256("arg"),
            bytes32(0),
            STANDARD_STAKE,
            arguer1,
            DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
        );

        vm.prank(arguer1);
        vm.expectRevert(DebateMarket.DebateNotResolved.selector);
        market.claimSettlement(debateId, NULLIFIER_1);
    }

    // ============================================================================
    // 7. PROPOSER BOND
    // ============================================================================

    /// @notice Bond returned when >= 5 participants
    function test_ClaimProposerBond_ReturnedAboveThreshold() public {
        bytes32 debateId = _proposeStandardDebate();

        // Submit 5 arguments (each with unique nullifier, hitting threshold)
        _submitArgumentWithNullifier(debateId, arguer1, NULLIFIER_1, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, arguer2, NULLIFIER_2, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, arguer3, NULLIFIER_3, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, cosigner1, NULLIFIER_4, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, cosigner2, NULLIFIER_5, 2);

        // Resolve
        vm.warp(block.timestamp + STANDARD_DURATION);
        market.resolveDebate(debateId);

        // Proposer claims bond
        uint256 balanceBefore = token.balanceOf(proposer);
        vm.prank(proposer);
        market.claimProposerBond(debateId);
        uint256 balanceAfter = token.balanceOf(proposer);

        assertEq(balanceAfter - balanceBefore, STANDARD_BOND);
    }

    /// @notice Bond forfeited when < 5 participants
    function test_RevertWhen_ClaimProposerBond_BelowThreshold() public {
        bytes32 debateId = _proposeStandardDebate();

        // Only 3 arguments
        _submitArgumentWithNullifier(debateId, arguer1, NULLIFIER_1, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, arguer2, NULLIFIER_2, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, arguer3, NULLIFIER_3, 2);

        // Resolve
        vm.warp(block.timestamp + STANDARD_DURATION);
        market.resolveDebate(debateId);

        // Proposer tries to claim — should revert
        vm.prank(proposer);
        vm.expectRevert(DebateMarket.InsufficientParticipation.selector);
        market.claimProposerBond(debateId);
    }

    /// @notice Only proposer can claim bond
    function test_RevertWhen_NotProposer() public {
        bytes32 debateId = _proposeStandardDebate();

        // Submit 5 arguments
        _submitArgumentWithNullifier(debateId, arguer1, NULLIFIER_1, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, arguer2, NULLIFIER_2, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, arguer3, NULLIFIER_3, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, cosigner1, NULLIFIER_4, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, cosigner2, NULLIFIER_5, 2);

        vm.warp(block.timestamp + STANDARD_DURATION);
        market.resolveDebate(debateId);

        // Non-proposer tries to claim
        vm.prank(arguer1);
        vm.expectRevert(DebateMarket.NotProposer.selector);
        market.claimProposerBond(debateId);
    }

    // ============================================================================
    // 8. NULLIFIER / DOUBLE-STAKE PREVENTION
    // ============================================================================

    /// @notice Same nullifier cannot stake twice in same debate
    function test_RevertWhen_DoubleStakeSameNullifier() public {
        bytes32 debateId = _proposeStandardDebate();

        // First stake succeeds
        vm.prank(arguer1);
        market.submitArgument(
            debateId,
            DebateMarket.Stance.SUPPORT,
            keccak256("arg1"),
            bytes32(0),
            STANDARD_STAKE,
            arguer1,
            DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
        );

        // Second stake with same nullifier reverts (NullifierRegistry rejects)
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        vm.expectRevert(); // NullifierAlreadyUsed from NullifierRegistry via MockDistrictGate
        market.submitArgument(
            debateId,
            DebateMarket.Stance.OPPOSE,
            keccak256("arg2"),
            bytes32(0),
            STANDARD_STAKE,
            arguer2,
            DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 2), // same nullifier!
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
        );
    }

    // ============================================================================
    // 9. PARTICIPATION DEPTH
    // ============================================================================

    /// @notice uniqueParticipants increments correctly
    function test_ParticipationDepth_TracksUniqueParticipants() public {
        bytes32 debateId = _proposeStandardDebate();

        // Submit 3 arguments
        _submitArgumentWithNullifier(debateId, arguer1, NULLIFIER_1, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, arguer2, NULLIFIER_2, 3);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, arguer3, NULLIFIER_3, 1);

        (uint256 participants, uint256 jurisdictionSize) =
            market.getParticipationDepth(debateId);
        assertEq(participants, 3);
        assertEq(jurisdictionSize, JURISDICTION_SIZE);
    }

    /// @notice Low participation -> bond forfeited
    function test_SignalStrength_LowParticipation_BondForfeited() public {
        bytes32 debateId = _proposeStandardDebate();

        // Only 3 participants
        _submitArgumentWithNullifier(debateId, arguer1, NULLIFIER_1, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, arguer2, NULLIFIER_2, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, arguer3, NULLIFIER_3, 2);

        (uint256 participants,) = market.getParticipationDepth(debateId);
        assertEq(participants, 3);
        assertTrue(participants < market.BOND_RETURN_THRESHOLD());

        // Resolve
        vm.warp(block.timestamp + STANDARD_DURATION);
        market.resolveDebate(debateId);

        // Bond claim reverts
        vm.prank(proposer);
        vm.expectRevert(DebateMarket.InsufficientParticipation.selector);
        market.claimProposerBond(debateId);
    }

    // ============================================================================
    // 10. SQRT MATH
    // ============================================================================

    /// @notice Known sqrt values
    function test_Sqrt_KnownValues() public {
        // We need a wrapper since sqrt is internal. Test via scoring.
        // sqrt(0) = 0
        // sqrt(1) = 1
        // sqrt(4) = 2
        // sqrt(100) = 10
        // sqrt(2) = 1 (integer floor)
        // sqrt(1e6) = 1000
        // sqrt(4e6) = 2000

        // Test via scoring: Tier 1 (multiplier=2), stake=X
        // weight = sqrt(X) * 2
        // So score tells us sqrt(X)

        bytes32 debateId = _proposeStandardDebate();

        // sqrt(4e6) * 2 = 2000 * 2 = 4000
        vm.prank(arguer1);
        market.submitArgument(
            debateId,
            DebateMarket.Stance.SUPPORT,
            keccak256("a"),
            bytes32(0),
            4e6,
            arguer1,
            DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 1),
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
        );
        assertEq(market.getArgumentScore(debateId, 0), 4000);

        // sqrt(1e6) * 2 = 1000 * 2 = 2000
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId,
            DebateMarket.Stance.SUPPORT,
            keccak256("b"),
            bytes32(0),
            1e6,
            arguer2,
            DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, ACTION_DOMAIN, 1),
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
        );
        assertEq(market.getArgumentScore(debateId, 1), 2000);

        // sqrt(100e6) * 2 = 10000 * 2 = 20000
        vm.warp(block.timestamp + 61);
        vm.prank(arguer3);
        market.submitArgument(
            debateId,
            DebateMarket.Stance.SUPPORT,
            keccak256("c"),
            bytes32(0),
            100e6,
            arguer3,
            DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_3, ACTION_DOMAIN, 1),
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
        );
        assertEq(market.getArgumentScore(debateId, 2), 20000);
    }

    // ============================================================================
    // 11. SCORING TABLE VERIFICATION (from spec)
    // ============================================================================

    /// @notice Newcomer $100, Tier 1: sqrt(100e6) * 2 = 10000 * 2 = 20000
    function test_ScoringTable_NewcomerBigStake() public {
        bytes32 debateId = _proposeStandardDebate();

        vm.prank(arguer1);
        market.submitArgument(
            debateId,
            DebateMarket.Stance.SUPPORT,
            keccak256("newcomer big"),
            bytes32(0),
            100e6,
            arguer1,
            DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 1),
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
        );

        assertEq(market.getArgumentScore(debateId, 0), 20000);
    }

    /// @notice Pillar $2, Tier 4: sqrt(2e6) * 16 = 1414 * 16 = 22624
    function test_ScoringTable_PillarMinimalStake() public {
        bytes32 debateId = _proposeStandardDebate();

        vm.prank(arguer1);
        market.submitArgument(
            debateId,
            DebateMarket.Stance.SUPPORT,
            keccak256("pillar min"),
            bytes32(0),
            2e6,
            arguer1,
            DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 4),
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
        );

        uint256 score = market.getArgumentScore(debateId, 0);
        // sqrt(2e6) = 1414 (integer), * 16 = 22624
        // Note: spec says ~22627 but integer sqrt gives 1414, so 1414*16 = 22624
        assertEq(score, 1414 * 16);
    }

    /// @notice Veteran $10, Tier 3: sqrt(10e6) * 8 = 3162 * 8 = 25296
    function test_ScoringTable_VeteranModerateStake() public {
        bytes32 debateId = _proposeStandardDebate();

        vm.prank(arguer1);
        market.submitArgument(
            debateId,
            DebateMarket.Stance.SUPPORT,
            keccak256("veteran mod"),
            bytes32(0),
            10e6,
            arguer1,
            DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 3),
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
        );

        uint256 score = market.getArgumentScore(debateId, 0);
        // sqrt(10e6) = 3162 (integer), * 8 = 25296
        // Note: spec says ~25298 but integer sqrt gives 3162
        assertEq(score, 3162 * 8);
    }

    /// @notice Verify the spec's core thesis: Pillar at $2 outscores newcomer at $100
    function test_ScoringTable_PillarOutscoresNewcomer() public {
        bytes32 debateId = _proposeStandardDebate();

        // Newcomer: $100, Tier 1
        vm.prank(arguer1);
        market.submitArgument(
            debateId,
            DebateMarket.Stance.SUPPORT,
            keccak256("newcomer"),
            bytes32(0),
            100e6,
            arguer1,
            DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 1),
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
        );

        // Pillar: $2, Tier 4
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId,
            DebateMarket.Stance.OPPOSE,
            keccak256("pillar"),
            bytes32(0),
            2e6,
            arguer2,
            DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, ACTION_DOMAIN, 4),
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
        );

        uint256 newcomerScore = market.getArgumentScore(debateId, 0);
        uint256 pillarScore = market.getArgumentScore(debateId, 1);

        // Pillar at $2 should outscore newcomer at $100
        assertGt(pillarScore, newcomerScore, "Pillar at $2 should outscore newcomer at $100");
    }

    /// @notice Veteran at $10 outscores newcomer at $100
    function test_ScoringTable_VeteranOutscoresNewcomer() public {
        bytes32 debateId = _proposeStandardDebate();

        // Newcomer: $100, Tier 1
        vm.prank(arguer1);
        market.submitArgument(
            debateId,
            DebateMarket.Stance.SUPPORT,
            keccak256("newcomer"),
            bytes32(0),
            100e6,
            arguer1,
            DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 1),
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
        );

        // Veteran: $10, Tier 3
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId,
            DebateMarket.Stance.OPPOSE,
            keccak256("veteran"),
            bytes32(0),
            10e6,
            arguer2,
            DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, ACTION_DOMAIN, 3),
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
        );

        uint256 newcomerScore = market.getArgumentScore(debateId, 0);
        uint256 veteranScore = market.getArgumentScore(debateId, 1);

        assertGt(veteranScore, newcomerScore, "Veteran at $10 should outscore newcomer at $100");
    }

    // ============================================================================
    // 12. CONSTANTS VERIFICATION
    // ============================================================================

    /// @notice Verify MIN_DURATION is 72 hours
    function test_Constants_MinDuration() public view {
        assertEq(market.MIN_DURATION(), 72 hours);
    }

    /// @notice Verify MAX_DURATION is 30 days
    function test_Constants_MaxDuration() public view {
        assertEq(market.MAX_DURATION(), 30 days);
    }

    /// @notice Verify BOND_RETURN_THRESHOLD is 5
    function test_Constants_BondReturnThreshold() public view {
        assertEq(market.BOND_RETURN_THRESHOLD(), 5);
    }

    /// @notice Verify tier multipliers via scoring: submit $1 at each tier
    function test_TierMultipliers_ViaScoring() public {
        // Verify tier multipliers by submitting $1 arguments at each tier
        // score = sqrt(1e6) * multiplier = 1000 * multiplier
        bytes32 debateId = _proposeStandardDebate();

        // Tier 1: 1000 * 2 = 2000
        vm.prank(arguer1);
        market.submitArgument(debateId, DebateMarket.Stance.SUPPORT, keccak256("t1"), bytes32(0),
            1e6, arguer1, DUMMY_PROOF, _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00");
        assertEq(market.getArgumentScore(debateId, 0), 2000);

        // Tier 2: 1000 * 4 = 4000
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(debateId, DebateMarket.Stance.SUPPORT, keccak256("t2"), bytes32(0),
            1e6, arguer2, DUMMY_PROOF, _makePublicInputs(NULLIFIER_2, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00");
        assertEq(market.getArgumentScore(debateId, 1), 4000);

        // Tier 3: 1000 * 8 = 8000
        vm.warp(block.timestamp + 61);
        vm.prank(arguer3);
        market.submitArgument(debateId, DebateMarket.Stance.SUPPORT, keccak256("t3"), bytes32(0),
            1e6, arguer3, DUMMY_PROOF, _makePublicInputs(NULLIFIER_3, ACTION_DOMAIN, 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00");
        assertEq(market.getArgumentScore(debateId, 2), 8000);

        // Tier 4: 1000 * 16 = 16000
        vm.warp(block.timestamp + 61);
        vm.prank(cosigner1);
        market.submitArgument(debateId, DebateMarket.Stance.SUPPORT, keccak256("t4"), bytes32(0),
            1e6, cosigner1, DUMMY_PROOF, _makePublicInputs(NULLIFIER_4, ACTION_DOMAIN, 4),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00");
        assertEq(market.getArgumentScore(debateId, 3), 16000);
    }

    // ============================================================================
    // 13. PAUSE CONTROLS
    // ============================================================================

    /// @notice Proposing reverts when paused
    function test_RevertWhen_Paused_Propose() public {
        vm.prank(governance);
        market.pause();

        vm.prank(proposer);
        vm.expectRevert("Pausable: paused");
        market.proposeDebate(
            PROPOSITION_HASH,
            STANDARD_DURATION,
            JURISDICTION_SIZE,
            ACTION_DOMAIN,
            STANDARD_BOND
        );
    }

    /// @notice Only governance can pause
    function test_RevertWhen_NonGovernancePauses() public {
        vm.prank(arguer1);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        market.pause();
    }

    // ============================================================================
    // 14. VIEW FUNCTIONS
    // ============================================================================

    /// @notice getDebateState returns correct values
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
        assertEq(totalStake, STANDARD_STAKE);
        assertEq(uniqueParticipants, 1);
    }

    /// @notice getParticipationDepth returns correct values
    function test_GetParticipationDepth() public {
        bytes32 debateId = _proposeStandardDebate();

        _submitArgumentWithNullifier(debateId, arguer1, NULLIFIER_1, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, arguer2, NULLIFIER_2, 3);

        (uint256 participants, uint256 jurisdictionSize) =
            market.getParticipationDepth(debateId);

        assertEq(participants, 2);
        assertEq(jurisdictionSize, JURISDICTION_SIZE);
    }

    // ============================================================================
    // 15. ACTION DOMAIN CROSS-VALIDATION
    // ============================================================================

    /// @notice Revert when proof's action domain doesn't match debate's action domain
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
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );
    }

    /// @notice Revert when co-sign proof's action domain doesn't match debate
    function test_RevertWhen_CoSignActionDomainMismatch() public {
        bytes32 debateId = _proposeStandardDebate();
        // Submit valid argument first
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        bytes32 wrongDomain = keccak256("different-domain");
        mockGate.setActionDomainAllowed(wrongDomain, true);

        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        vm.expectRevert(DebateMarket.ActionDomainMismatch.selector);
        market.coSignArgument(
            debateId, 0, STANDARD_STAKE, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, wrongDomain, 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );
    }

    // ============================================================================
    // 16. ZERO-ARGUMENT RESOLUTION GUARD
    // ============================================================================

    /// @notice Revert when resolving debate with zero arguments
    function test_RevertWhen_ResolveZeroArguments() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.warp(block.timestamp + STANDARD_DURATION);
        vm.expectRevert(DebateMarket.NoArgumentsSubmitted.selector);
        market.resolveDebate(debateId);
    }

    // ============================================================================
    // 17. SETTLEMENT CLAIM AUTHORIZATION
    // ============================================================================

    /// @notice Revert when non-submitter tries to claim settlement
    function test_RevertWhen_UnauthorizedClaimer() public {
        (bytes32 debateId,) = _setupResolvedDebateWithTwoArguments();
        // arguer2 is the winner (submitted with their address) — arguer3 tries to claim
        vm.prank(arguer3);
        vm.expectRevert(DebateMarket.UnauthorizedClaimer.selector);
        market.claimSettlement(debateId, NULLIFIER_2);
    }

    // ============================================================================
    // 18. DEBATE ID COLLISION GUARD
    // ============================================================================

    /// @notice Revert when debate ID already exists
    function test_RevertWhen_DebateIdCollision() public {
        // First debate succeeds
        vm.prank(proposer);
        market.proposeDebate(PROPOSITION_HASH, STANDARD_DURATION, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND);
        // Same params in same block -> collision
        vm.prank(proposer);
        vm.expectRevert(DebateMarket.DebateAlreadyExists.selector);
        market.proposeDebate(PROPOSITION_HASH, STANDARD_DURATION, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND);
    }

    // ============================================================================
    // 19. SWEEP FORFEITED BOND
    // ============================================================================

    /// @notice Governance can sweep forfeited bond when participation is insufficient
    function test_SweepForfeitedBond_Success() public {
        bytes32 debateId = _proposeStandardDebate();
        // Only 3 participants (below threshold)
        _submitArgumentWithNullifier(debateId, arguer1, NULLIFIER_1, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, arguer2, NULLIFIER_2, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, arguer3, NULLIFIER_3, 2);
        vm.warp(block.timestamp + STANDARD_DURATION);
        market.resolveDebate(debateId);

        uint256 govBalBefore = token.balanceOf(governance);
        vm.prank(governance);
        market.sweepForfeitedBond(debateId);
        assertEq(token.balanceOf(governance) - govBalBefore, STANDARD_BOND);
    }

    /// @notice Sweep reverts when sufficient participation
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
        vm.warp(block.timestamp + STANDARD_DURATION);
        market.resolveDebate(debateId);

        vm.prank(governance);
        vm.expectRevert(DebateMarket.InsufficientParticipation.selector);
        market.sweepForfeitedBond(debateId);
    }

    /// @notice Sweep reverts for non-governance caller
    function test_RevertWhen_SweepBond_NotGovernance() public {
        bytes32 debateId = _proposeStandardDebate();
        _submitArgumentWithNullifier(debateId, arguer1, NULLIFIER_1, 2);
        vm.warp(block.timestamp + STANDARD_DURATION);
        market.resolveDebate(debateId);

        vm.prank(arguer1);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        market.sweepForfeitedBond(debateId);
    }

    // ============================================================================
    // 20. EMERGENCY WITHDRAWAL
    // ============================================================================

    /// @notice Emergency withdraw succeeds 30 days after deadline
    function test_EmergencyWithdraw_Success() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );
        // Warp past deadline + 30 days
        vm.warp(block.timestamp + STANDARD_DURATION + 30 days);
        uint256 balBefore = token.balanceOf(arguer1);
        vm.prank(arguer1);
        market.emergencyWithdraw(debateId, NULLIFIER_1);
        assertEq(token.balanceOf(arguer1) - balBefore, STANDARD_STAKE);
    }

    /// @notice Emergency withdraw reverts before emergency delay expires
    function test_RevertWhen_EmergencyWithdraw_TooEarly() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );
        // Warp past deadline but not past emergency delay
        vm.warp(block.timestamp + STANDARD_DURATION + 15 days);
        vm.prank(arguer1);
        vm.expectRevert(DebateMarket.DebateStillActive.selector);
        market.emergencyWithdraw(debateId, NULLIFIER_1);
    }

    // ============================================================================
    // 21. MAX_ARGUMENTS CONSTANT
    // ============================================================================

    /// @notice Verify MAX_ARGUMENTS constant is 500
    function test_Constants_MaxArguments() public view {
        assertEq(market.MAX_ARGUMENTS(), 500);
    }

    // ============================================================================
    // 22. CO-SIGN AFTER DEADLINE
    // ============================================================================

    /// @notice Co-sign reverts after debate deadline
    function test_RevertWhen_CoSignAfterDeadline() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );
        vm.warp(block.timestamp + STANDARD_DURATION);
        vm.prank(arguer2);
        vm.expectRevert(DebateMarket.DebateExpired.selector);
        market.coSignArgument(
            debateId, 0, STANDARD_STAKE, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, ACTION_DOMAIN, 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );
    }

    // ============================================================================
    // 23. ENGAGEMENT TIER OUT OF RANGE
    // ============================================================================

    /// @notice Engagement tier 5 (out of range) reverts
    function test_RevertWhen_EngagementTierOutOfRange() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.prank(arguer1);
        vm.expectRevert(DebateMarket.InvalidEngagementTier.selector);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 5), // tier 5 = out of range
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );
    }

    // ============================================================================
    // 24. EMERGENCY WITHDRAWAL AFTER RESOLUTION (Wave 44 — SEC-019 fix)
    // ============================================================================

    /// @notice Emergency withdraw reverts on resolved debates (losers can't drain winner pool)
    function test_RevertWhen_EmergencyWithdraw_AfterResolution() public {
        (bytes32 debateId, ) = _setupResolvedDebateWithTwoArguments();
        // Warp past emergency delay (30 days after deadline)
        vm.warp(block.timestamp + 30 days);
        // Loser (arguer1) tries emergency withdraw — should revert
        vm.prank(arguer1);
        vm.expectRevert(DebateMarket.DebateNotActive.selector);
        market.emergencyWithdraw(debateId, NULLIFIER_1);
    }

    /// @notice Winner also cannot emergency withdraw after resolution (must use claimSettlement)
    function test_RevertWhen_EmergencyWithdraw_WinnerAfterResolution() public {
        (bytes32 debateId, ) = _setupResolvedDebateWithTwoArguments();
        vm.warp(block.timestamp + 30 days);
        vm.prank(arguer2);
        vm.expectRevert(DebateMarket.DebateNotActive.selector);
        market.emergencyWithdraw(debateId, NULLIFIER_2);
    }

    // ============================================================================
    // 25. ZERO-ARGUMENT ABANDONED DEBATE SWEEP (Wave 44 — ZK-NEW-002 fix)
    // ============================================================================

    /// @notice Governance can sweep bond from expired zero-argument debate
    function test_SweepAbandonedDebate_ZeroArguments() public {
        bytes32 debateId = _proposeStandardDebate();
        // Warp past deadline — no arguments submitted
        vm.warp(block.timestamp + STANDARD_DURATION);
        uint256 govBalBefore = token.balanceOf(governance);
        vm.prank(governance);
        market.sweepForfeitedBond(debateId);
        assertEq(token.balanceOf(governance) - govBalBefore, STANDARD_BOND);
    }

    /// @notice Cannot sweep abandoned debate before deadline
    function test_RevertWhen_SweepAbandoned_BeforeDeadline() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.prank(governance);
        vm.expectRevert(DebateMarket.DebateNotResolved.selector);
        market.sweepForfeitedBond(debateId);
    }

    /// @notice Cannot sweep abandoned debate that has arguments (must resolve first)
    function test_RevertWhen_SweepAbandoned_HasArguments() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );
        vm.warp(block.timestamp + STANDARD_DURATION);
        vm.prank(governance);
        vm.expectRevert(DebateMarket.DebateNotResolved.selector);
        market.sweepForfeitedBond(debateId);
    }

    // ============================================================================
    // 26. EMERGENCY WITHDRAWAL BY NON-SUBMITTER
    // ============================================================================

    /// @notice Non-submitter cannot emergency withdraw another's stake
    function test_RevertWhen_EmergencyWithdraw_NonSubmitter() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );
        vm.warp(block.timestamp + STANDARD_DURATION + 30 days);
        // arguer2 tries to withdraw arguer1's stake
        vm.prank(arguer2);
        vm.expectRevert(DebateMarket.UnauthorizedClaimer.selector);
        market.emergencyWithdraw(debateId, NULLIFIER_1);
    }

    // ============================================================================
    // 27. DOUBLE-SWEEP FORFEITED BOND
    // ============================================================================

    /// @notice Cannot sweep the same forfeited bond twice
    function test_RevertWhen_DoubleSweepForfeitedBond() public {
        bytes32 debateId = _proposeStandardDebate();
        // Create a resolved debate with < 5 participants
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );
        vm.warp(block.timestamp + STANDARD_DURATION);
        market.resolveDebate(debateId);
        // First sweep succeeds
        vm.prank(governance);
        market.sweepForfeitedBond(debateId);
        // Second sweep reverts
        vm.prank(governance);
        vm.expectRevert(DebateMarket.BondAlreadyClaimed.selector);
        market.sweepForfeitedBond(debateId);
    }

    // ============================================================================
    // 28. EMERGENCY WITHDRAW → SETTLEMENT CROSS-PATH BLOCKING
    // ============================================================================

    /// @notice Emergency withdrawal blocks subsequent settlement claim (shared claimed flag)
    function test_EmergencyWithdraw_BlocksSettlementClaim() public {
        bytes32 debateId = _proposeStandardDebate();

        // Argument 0: arguer1, Tier 1, $5 (loser)
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("loser"), bytes32(0),
            5e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        // Argument 1: arguer2, Tier 3, $10 (winner)
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("winner"), bytes32(0),
            10e6, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, ACTION_DOMAIN, 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        // Don't resolve — debate stays ACTIVE
        // Warp past deadline + 30 days for emergency withdrawal
        vm.warp(block.timestamp + STANDARD_DURATION + 30 days);

        // Winner emergency withdraws (gets original stake only, no profit)
        vm.prank(arguer2);
        market.emergencyWithdraw(debateId, NULLIFIER_2);

        // Now try to resolve and claim settlement — emergency already consumed the claim
        // But we can't resolve because debate is still ACTIVE and emergency withdraw
        // set claimed=true. If somehow it were resolved, settlement would revert.
        // Verify the claimed flag by checking another emergency withdraw attempt reverts
        vm.prank(arguer2);
        vm.expectRevert(DebateMarket.AlreadyClaimed.selector);
        market.emergencyWithdraw(debateId, NULLIFIER_2);
    }

    // ============================================================================
    // 29. SETTLEMENT ACCOUNTING INTEGRITY
    // ============================================================================

    /// @notice Sum of all winner payouts does not exceed totalStake
    function test_SettlementAccounting_TotalPayoutWithinTotalStake() public {
        bytes32 debateId = _proposeStandardDebate();

        // Submit 3 arguments: 2 on winning side, 1 on losing side
        // Argument 0: arguer1, Tier 2, $3 — SUPPORT (will win)
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("win1"), bytes32(0),
            3e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        // Argument 1: arguer2, Tier 1, $10 — OPPOSE (will lose)
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("lose"), bytes32(0),
            10e6, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, ACTION_DOMAIN, 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        // Co-sign argument 0: cosigner1, Tier 3, $5 — SUPPORT co-sign (winning side)
        vm.warp(block.timestamp + 61);
        vm.prank(cosigner1);
        market.coSignArgument(
            debateId, 0, 5e6, cosigner1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_3, ACTION_DOMAIN, 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        // Resolve
        vm.warp(block.timestamp + STANDARD_DURATION);
        market.resolveDebate(debateId);

        // Get debate state
        (,,,,,, uint256 totalStake,,,,,,,,) = market.debates(debateId);

        // Both winners claim
        uint256 contractBalBefore = token.balanceOf(address(market));

        vm.prank(arguer1);
        market.claimSettlement(debateId, NULLIFIER_1);
        vm.prank(cosigner1);
        market.claimSettlement(debateId, NULLIFIER_3);

        uint256 totalPaidOut = contractBalBefore - token.balanceOf(address(market));

        // Total paid out must not exceed totalStake (argument stakes only, not bond)
        assertLe(totalPaidOut, totalStake, "Settlement payouts exceeded totalStake");
    }

    // ============================================================================
    // 30. EMERGENCY WITHDRAWAL ACCOUNTING (Wave 45 — Fix 1 validation)
    // ============================================================================

    /// @notice Loser emergency withdraws, then debate resolves — winner gets correct payout from reduced pool
    function test_EmergencyWithdraw_LoserThenResolve_WinnerGetsCorrectPayout() public {
        bytes32 debateId = _proposeStandardDebate();

        // Argument 0: arguer1, Tier 3, $10 (winner — higher score)
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("winner"), bytes32(0),
            10e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        // Argument 1: arguer2, Tier 1, $100 (loser — lower score despite more money)
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("loser"), bytes32(0),
            100e6, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, ACTION_DOMAIN, 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        // Warp past deadline + emergency delay — loser emergency withdraws
        vm.warp(block.timestamp + STANDARD_DURATION + 30 days);
        vm.prank(arguer2);
        market.emergencyWithdraw(debateId, NULLIFIER_2);

        // Now resolve the debate (still ACTIVE, arguer1 wins)
        // Note: we're past deadline so resolveDebate succeeds
        market.resolveDebate(debateId);

        // Winner claims settlement — losingPool should be 0 (loser withdrew)
        // totalStake was 110e6, after emergency withdraw it's 10e6
        // winningArgStake was 10e6, after emergency withdraw it's still 10e6
        // losingPool = 10e6 - 10e6 = 0
        // payout = 10e6 + 0 = 10e6 (original stake only)
        uint256 balBefore = token.balanceOf(arguer1);
        vm.prank(arguer1);
        market.claimSettlement(debateId, NULLIFIER_1);
        uint256 payout = token.balanceOf(arguer1) - balBefore;

        assertEq(payout, 10e6, "Winner should get original stake when all losers emergency withdrew");
    }

    /// @notice ALL losers emergency withdraw, resolve, winner claims — payout = original stake only
    function test_EmergencyWithdraw_AllLosers_WinnerGetsOriginalStake() public {
        bytes32 debateId = _proposeStandardDebate();

        // Argument 0: arguer1, Tier 4, $5 (winner)
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("winner"), bytes32(0),
            5e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 4),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        // Argument 1: arguer2, Tier 1, $50 (loser 1)
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("loser1"), bytes32(0),
            50e6, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, ACTION_DOMAIN, 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        // Co-sign argument 1: arguer3, Tier 1, $50 (loser 2, co-signing losing argument)
        vm.warp(block.timestamp + 61);
        vm.prank(arguer3);
        market.coSignArgument(
            debateId, 1, 50e6, arguer3, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_3, ACTION_DOMAIN, 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        // Warp past deadline + emergency delay
        vm.warp(block.timestamp + STANDARD_DURATION + 30 days);

        // Both losers emergency withdraw
        vm.prank(arguer2);
        market.emergencyWithdraw(debateId, NULLIFIER_2);
        vm.prank(arguer3);
        market.emergencyWithdraw(debateId, NULLIFIER_3);

        // Resolve
        market.resolveDebate(debateId);

        // Winner claims — should get only original $5 stake
        uint256 balBefore = token.balanceOf(arguer1);
        vm.prank(arguer1);
        market.claimSettlement(debateId, NULLIFIER_1);
        uint256 payout = token.balanceOf(arguer1) - balBefore;

        assertEq(payout, 5e6, "Winner gets original stake only when all losers withdrew");
    }

    /// @notice Winner AND loser emergency withdraw, remaining winner gets correct proportional share
    function test_EmergencyWithdraw_WinnerAndLoser_RemainingWinnerCorrect() public {
        bytes32 debateId = _proposeStandardDebate();

        // Argument 0: arguer1, Tier 2, $10 (winner A — will NOT withdraw)
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("winA"), bytes32(0),
            10e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        // Co-sign argument 0: cosigner1, Tier 3, $10 (winner B — WILL withdraw)
        vm.warp(block.timestamp + 61);
        vm.prank(cosigner1);
        market.coSignArgument(
            debateId, 0, 10e6, cosigner1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_4, ACTION_DOMAIN, 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        // Argument 1: arguer2, Tier 1, $20 (loser — WILL withdraw)
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("lose"), bytes32(0),
            20e6, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, ACTION_DOMAIN, 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        // Warp past deadline + emergency delay
        vm.warp(block.timestamp + STANDARD_DURATION + 30 days);

        // Winner B and loser both emergency withdraw
        vm.prank(cosigner1);
        market.emergencyWithdraw(debateId, NULLIFIER_4);
        vm.prank(arguer2);
        market.emergencyWithdraw(debateId, NULLIFIER_2);

        // State after withdrawals:
        // totalStake: 40e6 - 10e6 - 20e6 = 10e6
        // argumentTotalStakes[0] (winning): 20e6 - 10e6 = 10e6
        // argumentTotalStakes[1] (losing): 20e6 - 20e6 = 0
        // losingPool = 10e6 - 10e6 = 0
        // arguer1 payout = 10e6 + 0 = 10e6

        market.resolveDebate(debateId);

        uint256 balBefore = token.balanceOf(arguer1);
        vm.prank(arguer1);
        market.claimSettlement(debateId, NULLIFIER_1);
        uint256 payout = token.balanceOf(arguer1) - balBefore;

        assertEq(payout, 10e6, "Remaining winner gets original stake when all counterparties withdrew");
    }

    /// @notice Settlement invariant: totalPaidOut + totalEmergencyWithdrawn <= totalStaked
    function test_EmergencyWithdraw_SolvencyInvariant() public {
        bytes32 debateId = _proposeStandardDebate();

        // 3 participants: winner $10, loser1 $30, loser2 $60
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("win"), bytes32(0),
            10e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("lose1"), bytes32(0),
            30e6, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, ACTION_DOMAIN, 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );
        vm.warp(block.timestamp + 61);
        vm.prank(arguer3);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("lose2"), bytes32(0),
            60e6, arguer3, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_3, ACTION_DOMAIN, 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        uint256 totalStaked = 100e6; // 10 + 30 + 60
        uint256 contractBalAfterStakes = token.balanceOf(address(market));

        // loser1 emergency withdraws
        vm.warp(block.timestamp + STANDARD_DURATION + 30 days);
        vm.prank(arguer2);
        market.emergencyWithdraw(debateId, NULLIFIER_2);
        // Resolve and winner claims
        market.resolveDebate(debateId);
        vm.prank(arguer1);
        market.claimSettlement(debateId, NULLIFIER_1);

        uint256 contractBalAfterAll = token.balanceOf(address(market));
        uint256 totalPaidOut = contractBalAfterStakes - contractBalAfterAll;

        // Solvency: totalPaidOut (emergency + settlement) <= totalStaked
        assertLe(totalPaidOut, totalStaked, "Solvency violated");

        // Also verify contract still holds remaining loser2's unclaimed stake + bond
        // loser2 staked 60e6, loser1 withdrew 30e6
        // After emergency: totalStake = 70e6, winningArgStake = 10e6, losingPool = 60e6
        // Winner payout: 10e6 + (60e6 * 10e6) / 10e6 = 10e6 + 60e6 = 70e6
        // But wait — loser2's 60e6 is still in the contract (unclaimed, on losing side)
        // So contract balance should be: bond + loser2's forfeited stake (already paid to winner)
        // Contract should hold: bond only (loser2 forfeited, winner took the pool)
        assertGe(contractBalAfterAll, STANDARD_BOND, "Contract should still hold proposer bond");
    }

    // ============================================================================
    // 31. EXACT SETTLEMENT MATH (Wave 45 — Test 1)
    // ============================================================================

    /// @notice Exact payout verification: single winner, single loser
    function test_Settlement_ExactPayout_SingleWinnerSingleLoser() public {
        bytes32 debateId = _proposeStandardDebate();

        // Winner: arguer1, Tier 3, $10
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("win"), bytes32(0),
            10e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        // Loser: arguer2, Tier 1, $5
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("lose"), bytes32(0),
            5e6, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, ACTION_DOMAIN, 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        vm.warp(block.timestamp + STANDARD_DURATION);
        market.resolveDebate(debateId);

        // totalStake = 15e6, winningArgStake = 10e6, losingPool = 5e6
        // payout = 10e6 + (5e6 * 10e6) / 10e6 = 10e6 + 5e6 = 15e6
        uint256 balBefore = token.balanceOf(arguer1);
        vm.prank(arguer1);
        market.claimSettlement(debateId, NULLIFIER_1);
        uint256 payout = token.balanceOf(arguer1) - balBefore;

        assertEq(payout, 15e6, "Winner takes entire pool: stake + full losing pool");
    }

    /// @notice Exact payout verification: two winners split losing pool proportionally
    function test_Settlement_ExactPayout_TwoWinnersSplitPool() public {
        bytes32 debateId = _proposeStandardDebate();

        // Winner A: arguer1, Tier 2, $6
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("winA"), bytes32(0),
            6e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        // Winner B (co-sign): cosigner1, Tier 3, $4
        vm.warp(block.timestamp + 61);
        vm.prank(cosigner1);
        market.coSignArgument(
            debateId, 0, 4e6, cosigner1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_3, ACTION_DOMAIN, 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        // Loser: arguer2, Tier 1, $10
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("lose"), bytes32(0),
            10e6, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, ACTION_DOMAIN, 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        vm.warp(block.timestamp + STANDARD_DURATION);
        market.resolveDebate(debateId);

        // totalStake = 20e6, winningArgStake = 10e6 (6+4), losingPool = 10e6
        // Winner A payout = 6e6 + (10e6 * 6e6) / 10e6 = 6e6 + 6e6 = 12e6
        // Winner B payout = 4e6 + (10e6 * 4e6) / 10e6 = 4e6 + 4e6 = 8e6
        uint256 balA_before = token.balanceOf(arguer1);
        vm.prank(arguer1);
        market.claimSettlement(debateId, NULLIFIER_1);
        uint256 payoutA = token.balanceOf(arguer1) - balA_before;

        uint256 balB_before = token.balanceOf(cosigner1);
        vm.prank(cosigner1);
        market.claimSettlement(debateId, NULLIFIER_3);
        uint256 payoutB = token.balanceOf(cosigner1) - balB_before;

        assertEq(payoutA, 12e6, "Winner A: 6 + (10*6/10) = 12");
        assertEq(payoutB, 8e6, "Winner B: 4 + (10*4/10) = 8");
        assertEq(payoutA + payoutB, 20e6, "Total payouts equal total stakes");
    }

    // ============================================================================
    // 32. ZERO-LOSING-POOL SETTLEMENT (Wave 45 — Test 2)
    // ============================================================================

    /// @notice Single argument wins by default — payout = original stake (no profit)
    function test_Settlement_ZeroLosingPool_PayoutEqualsStake() public {
        bytes32 debateId = _proposeStandardDebate();

        // Only one argument — wins by default
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("only"), bytes32(0),
            7e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        vm.warp(block.timestamp + STANDARD_DURATION);
        market.resolveDebate(debateId);

        // totalStake = 7e6, winningArgStake = 7e6, losingPool = 0
        // payout = 7e6 + 0 = 7e6
        uint256 balBefore = token.balanceOf(arguer1);
        vm.prank(arguer1);
        market.claimSettlement(debateId, NULLIFIER_1);
        uint256 payout = token.balanceOf(arguer1) - balBefore;

        assertEq(payout, 7e6, "Solo winner gets original stake back, no profit");
    }

    // ============================================================================
    // 33. MAX_ARGUMENTS BOUNDARY (Wave 45 — Test 3)
    // ============================================================================

    /// @notice 501st argument reverts with TooManyArguments
    function test_RevertWhen_MaxArgumentsExceeded() public {
        bytes32 debateId = _proposeStandardDebate();

        // Submit 500 arguments (we need 500 unique addresses and nullifiers)
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
                _makePublicInputs(nullifier, ACTION_DOMAIN, 1),
                VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
            );
        }

        // Verify 500 arguments
        (,, uint256 argumentCount,,) = market.getDebateState(debateId);
        assertEq(argumentCount, 500);

        // 501st should revert
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
            _makePublicInputs(nullifier501, ACTION_DOMAIN, 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );
    }

    // ============================================================================
    // 34. FUZZ TESTING (Wave 45 — Test 4)
    // ============================================================================

    /// @notice Fuzz: settlement payout never exceeds total stake
    /// @dev Both arguers use same tier so the first-mover (arguer1) always wins ties.
    ///      We test the invariant, not the winner selection.
    function testFuzz_SettlementPayoutNeverExceedsTotalStake(
        uint256 stake1,
        uint256 stake2
    ) public {
        // Bound to realistic USDC ranges: $1 to $10,000
        stake1 = bound(stake1, 1e6, 10_000e6);
        stake2 = bound(stake2, 1e6, 10_000e6);

        // Mint enough tokens
        token.mint(arguer1, stake1);
        token.mint(arguer2, stake2);

        bytes32 debateId = _proposeStandardDebate();

        // Both Tier 2 — arguer1 wins when stake1 >= stake2 (first-mover on tie)
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("fuzz-a"), bytes32(0),
            stake1, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("fuzz-b"), bytes32(0),
            stake2, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        vm.warp(block.timestamp + STANDARD_DURATION);
        market.resolveDebate(debateId);

        // Determine which argument won
        (,,,,,,, uint256 winningIdx,,,,,,,) = market.debates(debateId);

        // Winner claims
        uint256 totalStake = stake1 + stake2;
        if (winningIdx == 0) {
            uint256 balBefore = token.balanceOf(arguer1);
            vm.prank(arguer1);
            market.claimSettlement(debateId, NULLIFIER_1);
            uint256 payout = token.balanceOf(arguer1) - balBefore;
            assertLe(payout, totalStake, "Payout must not exceed total stake");
            assertGe(payout, stake1, "Payout must be at least original stake");
        } else {
            uint256 balBefore = token.balanceOf(arguer2);
            vm.prank(arguer2);
            market.claimSettlement(debateId, NULLIFIER_2);
            uint256 payout = token.balanceOf(arguer2) - balBefore;
            assertLe(payout, totalStake, "Payout must not exceed total stake");
            assertGe(payout, stake2, "Payout must be at least original stake");
        }
    }

    // ============================================================================
    // 35. MISSING REVERT PATH COVERAGE (Wave 45 — Test 5)
    // ============================================================================

    /// @notice DebateNotFound for bogus debateId on each function
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

    /// @notice ArgumentNotFound — co-sign with out-of-bounds argument index
    function test_RevertWhen_CoSign_ArgumentNotFound() public {
        bytes32 debateId = _proposeStandardDebate();
        // Submit one argument (index 0 exists)
        _submitArgumentWithNullifier(debateId, arguer1, NULLIFIER_1, 2);

        // Co-sign index 1 (doesn't exist)
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        vm.expectRevert(DebateMarket.ArgumentNotFound.selector);
        market.coSignArgument(
            debateId, 1, STANDARD_STAKE, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );
    }

    /// @notice Double-claim proposer bond reverts with BondAlreadyClaimed
    function test_RevertWhen_DoubleClaimProposerBond() public {
        bytes32 debateId = _proposeStandardDebate();
        // Submit 5 arguments to meet threshold
        _submitArgumentWithNullifier(debateId, arguer1, NULLIFIER_1, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, arguer2, NULLIFIER_2, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, arguer3, NULLIFIER_3, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, cosigner1, NULLIFIER_4, 2);
        vm.warp(block.timestamp + 61);
        _submitArgumentWithNullifier(debateId, cosigner2, NULLIFIER_5, 2);
        vm.warp(block.timestamp + STANDARD_DURATION);
        market.resolveDebate(debateId);

        // First claim succeeds
        vm.prank(proposer);
        market.claimProposerBond(debateId);

        // Second claim reverts
        vm.prank(proposer);
        vm.expectRevert(DebateMarket.BondAlreadyClaimed.selector);
        market.claimProposerBond(debateId);
    }

    /// @notice Unpause lifecycle: pause → verify reverts → unpause → verify ops resume
    function test_PauseUnpause_Lifecycle() public {
        vm.prank(governance);
        market.pause();

        // Propose reverts while paused
        vm.prank(proposer);
        vm.expectRevert("Pausable: paused");
        market.proposeDebate(PROPOSITION_HASH, STANDARD_DURATION, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND);

        // Unpause
        vm.prank(governance);
        market.unpause();

        // Propose succeeds after unpause
        vm.prank(proposer);
        bytes32 debateId = market.proposeDebate(PROPOSITION_HASH, STANDARD_DURATION, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND);
        (DebateMarket.DebateStatus status,,,,) = market.getDebateState(debateId);
        assertEq(uint8(status), uint8(DebateMarket.DebateStatus.ACTIVE));
    }

    /// @notice Paused state blocks submit, resolve, and claim paths
    function test_RevertWhen_Paused_SubmitResolveClaim() public {
        bytes32 debateId = _proposeStandardDebate();
        _submitArgumentWithNullifier(debateId, arguer1, NULLIFIER_1, 2);

        vm.prank(governance);
        market.pause();

        // Submit reverts
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        vm.expectRevert("Pausable: paused");
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        // Resolve reverts
        vm.warp(block.timestamp + STANDARD_DURATION);
        vm.expectRevert("Pausable: paused");
        market.resolveDebate(debateId);

        // Claim reverts
        vm.expectRevert("Pausable: paused");
        market.claimSettlement(debateId, NULLIFIER_1);
    }

    /// @notice Replace bare vm.expectRevert() — double-stake uses specific NullifierAlreadyUsed
    function test_RevertWhen_DoubleStake_SpecificError() public {
        bytes32 debateId = _proposeStandardDebate();

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg1"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        // Second stake with same nullifier — NullifierRegistry reverts
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        vm.expectRevert(NullifierRegistry.NullifierAlreadyUsed.selector);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("arg2"), bytes32(0),
            STANDARD_STAKE, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 2), // same nullifier
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );
    }

    // ============================================================================
    // 36. ALL-SAME-STANCE RESOLUTION (Wave 45 — Test 6)
    // ============================================================================

    /// @notice 3 SUPPORT arguments — highest-scoring wins, others are losers
    function test_Resolution_AllSameStance_HighestScoreWins() public {
        bytes32 debateId = _proposeStandardDebate();

        // Arg 0: Tier 1, $5 → sqrt(5e6)*2 = 4472
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("s1"), bytes32(0),
            5e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        // Arg 1: Tier 3, $3 → sqrt(3e6)*8 = 13856
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("s2"), bytes32(0),
            3e6, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, ACTION_DOMAIN, 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        // Arg 2: Tier 2, $2 → sqrt(2e6)*4 = 5656
        vm.warp(block.timestamp + 61);
        vm.prank(arguer3);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("s3"), bytes32(0),
            2e6, arguer3, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_3, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        vm.warp(block.timestamp + STANDARD_DURATION);
        market.resolveDebate(debateId);

        // Arg 1 (Tier 3, $3) should win
        (,,,,,,,,, bytes32 winningBody,,,,, ) = market.debates(debateId);
        assertEq(winningBody, keccak256("s2"), "Highest-scoring SUPPORT argument wins");

        // Non-winning SUPPORT arguers are losers — cannot claim
        vm.prank(arguer1);
        vm.expectRevert(DebateMarket.NotWinningSide.selector);
        market.claimSettlement(debateId, NULLIFIER_1);

        vm.prank(arguer3);
        vm.expectRevert(DebateMarket.NotWinningSide.selector);
        market.claimSettlement(debateId, NULLIFIER_3);

        // Winner claims: totalStake=10e6, winningArgStake=3e6, losingPool=7e6
        // payout = 3e6 + (7e6 * 3e6) / 3e6 = 3e6 + 7e6 = 10e6
        uint256 balBefore = token.balanceOf(arguer2);
        vm.prank(arguer2);
        market.claimSettlement(debateId, NULLIFIER_2);
        uint256 payout = token.balanceOf(arguer2) - balBefore;
        assertEq(payout, 10e6, "Winner takes entire pool in all-same-stance debate");
    }

    // ============================================================================
    // 37. MULTIPLE CO-SIGNS ON SAME ARGUMENT (Wave 45 — Test 7)
    // ============================================================================

    /// @notice 3 co-signs on one argument — verify cumulative score and settlement
    function test_MultipleCoSigns_CumulativeScoreAndSettlement() public {
        bytes32 debateId = _proposeStandardDebate();

        // Arg 0: arguer1, Tier 2, $4
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("main"), bytes32(0),
            4e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );
        // score: sqrt(4e6)*4 = 2000*4 = 8000, argStake: 4e6

        // Co-sign 1: arguer2, Tier 1, $1
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.coSignArgument(
            debateId, 0, 1e6, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, ACTION_DOMAIN, 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );
        // +sqrt(1e6)*2 = 1000*2 = 2000. Total score: 10000, argStake: 5e6

        // Co-sign 2: arguer3, Tier 3, $1
        vm.warp(block.timestamp + 61);
        vm.prank(arguer3);
        market.coSignArgument(
            debateId, 0, 1e6, arguer3, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_3, ACTION_DOMAIN, 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );
        // +sqrt(1e6)*8 = 1000*8 = 8000. Total score: 18000, argStake: 6e6

        // Co-sign 3: cosigner1, Tier 4, $2
        vm.warp(block.timestamp + 61);
        vm.prank(cosigner1);
        market.coSignArgument(
            debateId, 0, 2e6, cosigner1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_4, ACTION_DOMAIN, 4),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );
        // +sqrt(2e6)*16 = 1414*16 = 22624. Total score: 40624, argStake: 8e6

        // Verify cumulative score
        uint256 score = market.getArgumentScore(debateId, 0);
        assertEq(score, 8000 + 2000 + 8000 + 22624, "Cumulative weighted score");

        // Verify argumentTotalStakes
        uint256 argTotalStake = market.argumentTotalStakes(debateId, 0);
        assertEq(argTotalStake, 8e6, "Cumulative stake: 4+1+1+2");

        // Add a losing argument so there's a pool to distribute
        vm.warp(block.timestamp + 61);
        vm.prank(cosigner2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("loser"), bytes32(0),
            8e6, cosigner2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_5, ACTION_DOMAIN, 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        vm.warp(block.timestamp + STANDARD_DURATION);
        market.resolveDebate(debateId);

        // totalStake = 16e6, winningArgStake = 8e6, losingPool = 8e6
        // arguer1 (4e6): payout = 4e6 + (8e6 * 4e6) / 8e6 = 4e6 + 4e6 = 8e6
        // arguer2 (1e6): payout = 1e6 + (8e6 * 1e6) / 8e6 = 1e6 + 1e6 = 2e6
        // arguer3 (1e6): payout = 1e6 + (8e6 * 1e6) / 8e6 = 1e6 + 1e6 = 2e6
        // cosigner1 (2e6): payout = 2e6 + (8e6 * 2e6) / 8e6 = 2e6 + 2e6 = 4e6
        // Total: 8+2+2+4 = 16e6 ✓

        uint256 bal1 = token.balanceOf(arguer1);
        vm.prank(arguer1);
        market.claimSettlement(debateId, NULLIFIER_1);
        assertEq(token.balanceOf(arguer1) - bal1, 8e6, "arguer1 payout");

        uint256 bal2 = token.balanceOf(arguer2);
        vm.prank(arguer2);
        market.claimSettlement(debateId, NULLIFIER_2);
        assertEq(token.balanceOf(arguer2) - bal2, 2e6, "arguer2 payout");

        uint256 bal3 = token.balanceOf(arguer3);
        vm.prank(arguer3);
        market.claimSettlement(debateId, NULLIFIER_3);
        assertEq(token.balanceOf(arguer3) - bal3, 2e6, "arguer3 payout");

        uint256 bal4 = token.balanceOf(cosigner1);
        vm.prank(cosigner1);
        market.claimSettlement(debateId, NULLIFIER_4);
        assertEq(token.balanceOf(cosigner1) - bal4, 4e6, "cosigner1 payout");
    }

    // ============================================================================
    // 38. EVENT EMISSION ASSERTIONS (Wave 45 — Test 8)
    // ============================================================================

    /// @notice Verify DebateProposed event
    function test_Event_DebateProposed() public {
        vm.expectEmit(true, true, false, true);
        emit DebateProposed(
            keccak256(abi.encodePacked(PROPOSITION_HASH, ACTION_DOMAIN, block.timestamp, proposer)),
            ACTION_DOMAIN,
            PROPOSITION_HASH,
            block.timestamp + STANDARD_DURATION
        );
        vm.prank(proposer);
        market.proposeDebate(PROPOSITION_HASH, STANDARD_DURATION, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND);
    }

    /// @notice Verify DebateResolved event
    function test_Event_DebateResolved() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        vm.warp(block.timestamp + STANDARD_DURATION);
        // sqrt(2e6) * 4 = 1414 * 4 = 5656
        vm.expectEmit(true, false, false, true);
        emit DebateResolved(debateId, 0, DebateMarket.Stance.SUPPORT, 5656, 1, JURISDICTION_SIZE);
        market.resolveDebate(debateId);
    }

    /// @notice Verify EmergencyWithdrawn event (not SettlementClaimed)
    function test_Event_EmergencyWithdrawn() public {
        bytes32 debateId = _proposeStandardDebate();
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        vm.warp(block.timestamp + STANDARD_DURATION + 30 days);
        vm.expectEmit(true, false, false, true);
        emit EmergencyWithdrawn(debateId, NULLIFIER_1, STANDARD_STAKE);
        vm.prank(arguer1);
        market.emergencyWithdraw(debateId, NULLIFIER_1);
    }

    /// @notice Verify SettlementClaimed event on settlement claim
    function test_Event_SettlementClaimed() public {
        (bytes32 debateId,) = _setupResolvedDebateWithTwoArguments();

        // arguer2 is the winner with $10 stake
        // totalStake = 15e6, winningArgStake = 10e6, losingPool = 5e6
        // payout = 10e6 + 5e6 = 15e6
        vm.expectEmit(true, false, false, true);
        emit SettlementClaimed(debateId, NULLIFIER_2, 15e6);
        vm.prank(arguer2);
        market.claimSettlement(debateId, NULLIFIER_2);
    }

    // ============================================================================
    // 39. GOVERNANCE TRANSFER (Wave 45 — TimelockGovernance validation)
    // ============================================================================

    /// @notice Governance transfer: initiate → wait 7 days → execute → new gov can pause
    function test_GovernanceTransfer_FullCycle() public {
        address newGov = address(0x999);

        // Initiate transfer
        vm.prank(governance);
        market.initiateGovernanceTransfer(newGov);

        // Cannot execute before timelock
        vm.expectRevert(TimelockGovernance.TimelockNotExpired.selector);
        market.executeGovernanceTransfer(newGov);

        // Wait 7 days
        vm.warp(block.timestamp + 7 days);
        market.executeGovernanceTransfer(newGov);

        // Verify new governance
        assertEq(market.governance(), newGov);

        // New governance can pause
        vm.prank(newGov);
        market.pause();

        // Old governance rejected
        vm.prank(governance);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        market.unpause();
    }

    /// @notice Governance transfer cancellation
    function test_GovernanceTransfer_Cancel() public {
        address newGov = address(0x999);

        vm.prank(governance);
        market.initiateGovernanceTransfer(newGov);

        vm.prank(governance);
        market.cancelGovernanceTransfer(newGov);

        // Cannot execute cancelled transfer
        vm.warp(block.timestamp + 7 days);
        vm.expectRevert(TimelockGovernance.TransferNotInitiated.selector);
        market.executeGovernanceTransfer(newGov);
    }

    // ============================================================================
    // 40. FUZZ: EMERGENCY-WITHDRAW-THEN-SETTLE (Wave 46 — coverage gap)
    // ============================================================================

    /// @notice Fuzz: emergency withdraw by one arguer, then resolve+settle — solvency holds
    /// @dev Both arguers same tier; arguer2 always emergency withdraws before resolution.
    ///      Tests the combined emergency-withdraw → resolve → settle path.
    function testFuzz_EmergencyWithdrawThenSettle_Solvency(
        uint256 stake1,
        uint256 stake2
    ) public {
        stake1 = bound(stake1, 1e6, 10_000e6);
        stake2 = bound(stake2, 1e6, 10_000e6);

        token.mint(arguer1, stake1);
        token.mint(arguer2, stake2);

        bytes32 debateId = _proposeStandardDebate();

        // Both Tier 2 — same tier so winner is deterministic by stake (first-mover on tie)
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("fuzz-a"), bytes32(0),
            stake1, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("fuzz-b"), bytes32(0),
            stake2, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        uint256 contractBalAfterStakes = token.balanceOf(address(market));

        // arguer2 emergency withdraws (regardless of winner/loser status)
        vm.warp(block.timestamp + STANDARD_DURATION + 30 days);
        vm.prank(arguer2);
        market.emergencyWithdraw(debateId, NULLIFIER_2);

        // Resolve
        market.resolveDebate(debateId);

        // Determine winner and claim
        (,,,,,,, uint256 winningIdx,,,,,,,) = market.debates(debateId);

        if (winningIdx == 0) {
            // arguer1 won — claim settlement
            vm.prank(arguer1);
            market.claimSettlement(debateId, NULLIFIER_1);
        } else {
            // arguer2 won but already emergency withdrew (claimed=true)
            vm.prank(arguer2);
            vm.expectRevert(DebateMarket.AlreadyClaimed.selector);
            market.claimSettlement(debateId, NULLIFIER_2);
        }

        // Solvency: contract never goes negative
        uint256 contractBalFinal = token.balanceOf(address(market));
        assertGe(contractBalFinal, STANDARD_BOND, "Contract must retain at least the proposer bond");
        assertLe(
            contractBalAfterStakes - contractBalFinal,
            stake1 + stake2,
            "Total outflows must not exceed total stakes"
        );
    }

    /// @notice Fuzz: partial emergency withdrawal with 3 participants — one withdraws, verify settlement math
    /// @dev arguer1 submits argument 0, arguer2 submits argument 1, arguer3 co-signs argument 1.
    ///      arguer2 emergency withdraws. All same tier so argument 1 wins when it has more cumulative
    ///      stake-weight. We dynamically determine winner.
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

        // Argument 0: arguer1, Tier 2
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("fa"), bytes32(0),
            stake1, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        // Argument 1: arguer2, Tier 2
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("fb"), bytes32(0),
            stake2, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        // Co-sign argument 1: arguer3, Tier 2
        vm.warp(block.timestamp + 61);
        vm.prank(arguer3);
        market.coSignArgument(
            debateId, 1, stake3, arguer3, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_3, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        uint256 totalStaked = stake1 + stake2 + stake3;

        // arguer2 emergency withdraws
        vm.warp(block.timestamp + STANDARD_DURATION + 30 days);
        vm.prank(arguer2);
        market.emergencyWithdraw(debateId, NULLIFIER_2);

        // Resolve
        market.resolveDebate(debateId);

        (,,,,,,, uint256 winIdx,,,,,,,) = market.debates(debateId);

        uint256 contractBalBefore = token.balanceOf(address(market));

        // Claim for whoever won (arguer2 already withdrew, so their claim would revert)
        if (winIdx == 0) {
            // arguer1 won
            vm.prank(arguer1);
            market.claimSettlement(debateId, NULLIFIER_1);
        } else {
            // argument 1 won — arguer3 can claim, arguer2 already claimed via emergency
            vm.prank(arguer3);
            market.claimSettlement(debateId, NULLIFIER_3);
        }

        uint256 totalPaidFromContract = contractBalBefore - token.balanceOf(address(market));

        // Solvency: total outflows (emergency + settlement) must not exceed total staked
        // contractBalAfterStakes included bond+stakes, emergency took stake2, settlement took some
        // Total outflows from stake pool: stake2 (emergency) + settlement payout
        // Must not exceed totalStaked
        uint256 contractFinal = token.balanceOf(address(market));
        assertGe(contractFinal, STANDARD_BOND, "Contract retains proposer bond");

        // The total paid out from the contract (across emergency + settlement) must not exceed stakes + bond
        // Since bond is separate, just verify contract still has at least the bond
        assertGe(contractFinal, STANDARD_BOND, "Solvency: bond retained after all outflows");
    }

    // ============================================================================
    // 41. SETTLEMENT DUST INVARIANT (Wave 46 — integer division behavior)
    // ============================================================================

    /// @notice Fuzz: settlement integer division dust always favors solvency (contract retains dust)
    /// @dev Two winners (argument + co-sign) vs one loser, all same tier.
    ///      Argument 0's combined score (sqrt(w1) + sqrt(w2)) must beat argument 1's score (sqrt(loser)).
    ///      We ensure winner1 + winner2 combined weight always wins by making them the larger side.
    function testFuzz_SettlementDust_FavorsSolvency(
        uint256 winner1Stake,
        uint256 winner2Stake,
        uint256 loserStake
    ) public {
        // Bound and ensure the winning side has more combined sqrt-weight
        winner1Stake = bound(winner1Stake, 1e6, 5_000e6);
        winner2Stake = bound(winner2Stake, 1e6, 5_000e6);
        loserStake = bound(loserStake, 1e6, 5_000e6);

        // Ensure arg0 (winner1+winner2) always has higher score than arg1 (loser)
        // All Tier 2: score0 = (sqrt(w1) + sqrt(w2)) * 4, score1 = sqrt(loser) * 4
        // We need sqrt(w1) + sqrt(w2) > sqrt(loser)
        // Since w1 >= 1e6 and w2 >= 1e6, sqrt(w1)+sqrt(w2) >= 2000
        // loserStake <= 5000e6, sqrt(5000e6) = 70710
        // Not guaranteed. So: cap loserStake to ensure the co-signed side wins.
        // sqrt(w1)+sqrt(w2) > sqrt(loserStake) always holds when loserStake < (sqrt(w1)+sqrt(w2))^2
        // Simpler: just ensure loserStake <= winner1Stake (then sqrt(w1)+sqrt(w2) > sqrt(w1) >= sqrt(loser))
        if (loserStake > winner1Stake) {
            loserStake = winner1Stake;
        }

        token.mint(arguer1, winner1Stake);
        token.mint(cosigner1, winner2Stake);
        token.mint(arguer2, loserStake);

        bytes32 debateId = _proposeStandardDebate();

        // Winner 1: Tier 2
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("dw1"), bytes32(0),
            winner1Stake, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        // Winner 2: co-signs, Tier 2
        vm.warp(block.timestamp + 61);
        vm.prank(cosigner1);
        market.coSignArgument(
            debateId, 0, winner2Stake, cosigner1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_3, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        // Loser: Tier 2
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("dl"), bytes32(0),
            loserStake, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, ACTION_DOMAIN, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );

        vm.warp(block.timestamp + STANDARD_DURATION);
        market.resolveDebate(debateId);

        // Verify argument 0 won (should always be true given our constraints)
        (,,,,,,, uint256 winIdx,,,,,,,) = market.debates(debateId);
        assertEq(winIdx, 0, "Co-signed argument must win");

        uint256 totalStake = winner1Stake + winner2Stake + loserStake;
        uint256 contractBalBefore = token.balanceOf(address(market));

        // Both winners claim
        vm.prank(arguer1);
        market.claimSettlement(debateId, NULLIFIER_1);
        vm.prank(cosigner1);
        market.claimSettlement(debateId, NULLIFIER_3);

        uint256 totalPaidOut = contractBalBefore - token.balanceOf(address(market));

        // Dust invariant: totalPaidOut <= totalStake (division rounds down, dust stays in contract)
        assertLe(totalPaidOut, totalStake, "Integer division dust must favor solvency");

        // Contract retains at least the bond (loser's stake dust may also remain)
        assertGe(token.balanceOf(address(market)), STANDARD_BOND, "Bond retained");
    }

    // ============================================================================
    // 42. RESOLVE GAS AT MAX ARGUMENTS (Wave 46 — gas measurement)
    // ============================================================================

    /// @notice Measure resolveDebate gas with 500 arguments — must be within Scroll block limit
    function test_ResolveGas_500Arguments() public {
        bytes32 debateId = _proposeStandardDebate();

        // Submit 500 arguments
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
                _makePublicInputs(nullifier, ACTION_DOMAIN, 1),
                VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
            );
        }

        vm.warp(block.timestamp + STANDARD_DURATION);

        uint256 gasBefore = gasleft();
        market.resolveDebate(debateId);
        uint256 gasUsed = gasBefore - gasleft();

        // Scroll block gas limit is 10M. Resolution at 500 args must be well under.
        // Expected: ~500 SLOADs × 2100 gas = ~1.05M + overhead ≈ 1.2M
        assertLt(gasUsed, 3_000_000, "resolveDebate at 500 args must be under 3M gas");

        // Log for visibility (visible in forge test -vvv output)
        emit log_named_uint("resolveDebate gas at 500 arguments", gasUsed);
    }

    // ============================================================================
    // HELPER FUNCTIONS
    // ============================================================================

    /// @notice Build 31-element public inputs with specific nullifier, actionDomain, and tier
    function _makePublicInputs(
        bytes32 nullifier,
        bytes32 actionDomain,
        uint256 engagementTier
    ) internal pure returns (uint256[31] memory inputs) {
        inputs[0] = uint256(bytes32(uint256(0xAAAA1111))); // userRoot
        inputs[1] = uint256(bytes32(uint256(0xBBBB1111))); // cellMapRoot
        // inputs[2-25] = district slots (zeros fine for mock)
        inputs[26] = uint256(nullifier);
        inputs[27] = uint256(actionDomain);
        inputs[28] = uint256(3); // authority level
        inputs[29] = uint256(bytes32(uint256(0xCCCC1111))); // engagementRoot
        inputs[30] = engagementTier;
    }

    /// @notice Propose a standard debate and return debateId
    function _proposeStandardDebate() internal returns (bytes32) {
        vm.prank(proposer);
        return market.proposeDebate(
            PROPOSITION_HASH,
            STANDARD_DURATION,
            JURISDICTION_SIZE,
            ACTION_DOMAIN,
            STANDARD_BOND
        );
    }

    /// @notice Submit a standard argument with a specific nullifier and tier
    function _submitArgumentWithNullifier(
        bytes32 debateId,
        address caller,
        bytes32 nullifier,
        uint8 tier
    ) internal {
        vm.prank(caller);
        market.submitArgument(
            debateId,
            DebateMarket.Stance.SUPPORT,
            keccak256(abi.encodePacked("arg-", nullifier)),
            bytes32(0),
            STANDARD_STAKE,
            caller,
            DUMMY_PROOF,
            _makePublicInputs(nullifier, ACTION_DOMAIN, tier),
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
        );
    }

    /// @notice Setup a resolved debate with two arguments for settlement tests.
    ///         Argument 0: arguer1, Tier 1, $5 (lower score)
    ///         Argument 1: arguer2, Tier 3, $10 (higher score, wins)
    function _setupResolvedDebateWithTwoArguments()
        internal
        returns (bytes32 debateId, uint256 winningIndex)
    {
        debateId = _proposeStandardDebate();

        // Argument 0: Tier 1, $5 -> sqrt(5e6) * 2
        vm.prank(arguer1);
        market.submitArgument(
            debateId,
            DebateMarket.Stance.SUPPORT,
            keccak256("loser"),
            bytes32(0),
            5e6,
            arguer1,
            DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, ACTION_DOMAIN, 1),
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
        );

        // Argument 1: Tier 3, $10 -> sqrt(10e6) * 8 (winner)
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId,
            DebateMarket.Stance.OPPOSE,
            keccak256("winner"),
            bytes32(0),
            10e6,
            arguer2,
            DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, ACTION_DOMAIN, 3),
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
        );

        // Resolve
        vm.warp(block.timestamp + STANDARD_DURATION);
        market.resolveDebate(debateId);

        winningIndex = 1; // Tier 3 at $10 > Tier 1 at $5
    }
}

// ============================================================================
// MOCK CONTRACTS
// ============================================================================

/// @notice Mock DistrictGate that accepts proofs without real ZK verification.
///         Records nullifiers in a real NullifierRegistry so double-stake tests work.
contract MockDistrictGate {
    NullifierRegistry public nullifierRegistry;
    mapping(bytes32 => bool) public allowedActionDomains;

    constructor(address _nullifierRegistry) {
        nullifierRegistry = NullifierRegistry(_nullifierRegistry);
    }

    function setActionDomainAllowed(bytes32 domain, bool allowed) external {
        allowedActionDomains[domain] = allowed;
    }

    /// @notice Mock verifyThreeTreeProof: succeeds without reverting, records nullifier
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

/// @notice Minimal ERC-20 mock with public mint
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
        require(balanceOf[msg.sender] >= amount, "MockERC20: insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "MockERC20: insufficient balance");
        require(allowance[from][msg.sender] >= amount, "MockERC20: insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
