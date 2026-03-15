// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "forge-std/Test.sol";
import "../src/DebateMarket.sol";
import "../src/IDebateWeightVerifier.sol";
import "../src/IPositionNoteVerifier.sol";
import "../src/TimelockGovernance.sol";
import "../src/NullifierRegistry.sol";
import "../src/IAIEvaluationRegistry.sol";
import { SD59x18, sd } from "prb-math/SD59x18.sol";

/// @title DebateMarket Position Privacy Tests (Cycle 2.2B)
/// @notice Tests for Phase 2 position privacy features:
///         - revealTrade with debate_weight ZK proofs
///         - updatePositionRoot (governance)
///         - settlePrivatePosition (attestation via position_note proof)
///
/// TEST CASES:
///   1. revealTrade with valid debate_weight proof — weightedAmount extracted, PositionCommitted emitted
///   2. revealTrade with invalid proof — revert InvalidDebateWeightProof
///   3. Full lifecycle: propose → argue → commit → reveal (with proof) → execute → resolve →
///      updatePositionRoot → settlePrivatePosition
///   4. Position nullifier double-spend — settle once OK, second reverts PositionNullifierSpent
///   5. Wrong winning argument — settlePrivatePosition with wrong argIndex reverts NotWinningSide
///   6. Position root not set — settlePrivatePosition before updatePositionRoot reverts PositionRootNotSet
///   7. Position root mismatch — settlePrivatePosition with stale root reverts InvalidPositionRoot
///   8. Debate ID mismatch — settlePrivatePosition with wrong debateId reverts ActionDomainMismatch
///   9. LMSR weight tracking — lmsrArgumentWeights and lmsrTotalWeight accumulate correctly
///  10. updatePositionRoot access control — non-governance reverts
///  11. updatePositionRoot on non-existent debate reverts DebateNotFound
///  12. settlePrivatePosition on unresolved debate reverts DebateNotResolved
///
/// MOCK VERIFIERS:
///   - MockDebateWeightVerifier: always returns true
///   - MockPositionNoteVerifier: always returns true
///   - RejectingDebateWeightVerifier: always returns false
///   - RejectingPositionNoteVerifier: always returns false
contract DebateMarketPositionPrivacyTest is Test {
    DebateMarket public market;
    MockDistrictGate public mockGate;
    NullifierRegistry public nullifierRegistry;
    MockERC20 public token;

    MockDebateWeightVerifier public dwVerifier;
    MockPositionNoteVerifier public pnVerifier;

    address public governance = address(0x1);
    address public proposer   = address(0x10);
    address public arguer1    = address(0x20);
    address public arguer2    = address(0x30);
    address public trader1    = address(0x40);
    address public trader2    = address(0x50);

    bytes32 public constant ACTION_DOMAIN     = keccak256("debate-housing-2026");
    bytes32 public constant PROPOSITION_HASH  = keccak256("Should we increase housing density?");

    bytes32 public constant NULLIFIER_1        = bytes32(uint256(0x2000));
    bytes32 public constant NULLIFIER_2        = bytes32(uint256(0x3000));
    bytes32 public constant NULLIFIER_COMMIT_1 = bytes32(uint256(0xA000));
    bytes32 public constant NULLIFIER_COMMIT_2 = bytes32(uint256(0xB000));

    uint256 public constant STANDARD_DURATION  = 4 days;
    uint256 public constant STANDARD_BOND      = 5e6;
    uint256 public constant STANDARD_STAKE     = 2e6;
    uint256 public constant JURISDICTION_SIZE  = 700_000;

    bytes public constant DUMMY_PROOF = hex"deadbeef";
    uint8 public constant VERIFIER_DEPTH = 20;

    // Events from DebateMarket (Phase 2)
    event PositionCommitted(
        bytes32 indexed debateId,
        uint256 indexed epoch,
        uint256 argumentIndex,
        uint256 weightedAmount,
        bytes32 noteCommitment
    );
    event PositionRootUpdated(bytes32 indexed debateId, bytes32 newRoot, uint256 leafCount);
    event PrivateSettlementClaimed(bytes32 indexed debateId, bytes32 nullifier, uint256 claimedWeight);
    event TradeRevealed(
        bytes32 indexed debateId,
        uint256 indexed epoch,
        uint256 argumentIndex,
        DebateMarket.TradeDirection direction,
        uint256 weightedAmount
    );

    function setUp() public {
        // Deploy real NullifierRegistry
        nullifierRegistry = new NullifierRegistry(governance, 7 days, 7 days);

        // Deploy MockDistrictGate with real NullifierRegistry
        mockGate = new MockDistrictGate(address(nullifierRegistry));

        // Authorize MockDistrictGate as caller on NullifierRegistry
        vm.prank(governance);
        nullifierRegistry.proposeCallerAuthorization(address(mockGate));
        vm.warp(block.timestamp + 7 days);
        nullifierRegistry.executeCallerAuthorization(address(mockGate));

        // Configure action domain
        mockGate.setActionDomainAllowed(ACTION_DOMAIN, true);

        token = new MockERC20("Test USD", "TUSD", 6);

        // Deploy mocks and market
        dwVerifier = new MockDebateWeightVerifier();
        pnVerifier = new MockPositionNoteVerifier();
        MockAIEvaluationRegistry aiRegistry = new MockAIEvaluationRegistry();

        market = new DebateMarket(
            address(mockGate),
            address(dwVerifier),
            address(pnVerifier),
            address(aiRegistry),
            governance,
            7 days,
            address(token),
            200
        );

        mockGate.setDeriverAuthorized(address(market), true);

        address[5] memory accounts = [proposer, arguer1, arguer2, trader1, trader2];
        for (uint256 i = 0; i < accounts.length; i++) {
            token.mint(accounts[i], 10_000e6);
            vm.prank(accounts[i]);
            token.approve(address(market), type(uint256).max);
        }

        // Set resolution extension to minimum for test efficiency (R2-F01 grace period)
        vm.prank(governance);
        market.setResolutionExtension(1 days);
        vm.prank(governance);
        market.setMinParticipants(1);
    }

    // ============================================================================
    // 1. revealTrade with valid debate_weight proof
    // ============================================================================

    /// @notice revealTrade verifies proof, extracts weightedAmount, emits PositionCommitted
    function test_RevealTrade_ValidDebateWeightProof_EmitsPositionCommitted() public {
        // Commit parameters — must match exactly what the test uses during reveal
        uint256 weightedAmount = 8000;
        bytes32 noteCommitment = keccak256("default-nc"); // matches _setupDebateAndCommit
        bytes32 nonce = _computeNonce(0, weightedAmount, noteCommitment);

        bytes32 debateId = _setupDebateAndCommit();

        // Advance to reveal phase
        vm.warp(block.timestamp + 151);

        bytes32[2] memory dwInputs = [bytes32(uint256(weightedAmount)), noteCommitment];

        // Expect PositionCommitted to be emitted with the correct values
        vm.expectEmit(true, true, false, true);
        emit PositionCommitted(debateId, 0, 0, weightedAmount, noteCommitment);

        // Also expect TradeRevealed
        vm.expectEmit(true, true, false, true);
        emit TradeRevealed(debateId, 0, 0, DebateMarket.TradeDirection.BUY, weightedAmount);

        vm.prank(trader1);
        market.revealTrade(
            debateId, 0, 0, 0, DebateMarket.TradeDirection.BUY,
            nonce, DUMMY_PROOF, dwInputs
        );

        // Verify reveal was stored
        assertEq(market.getEpochRevealCount(debateId, 0), 1, "Should have 1 reveal");
    }

    /// @notice weightedAmount from proof is correctly accumulated in lmsrArgumentWeights
    function test_RevealTrade_WeightedAmount_AccumulatesInLmsrTracking() public {
        // Use the same commit parameters as _setupDebateAndCommit so the hash matches
        uint256 weightedAmount = 8000;
        bytes32 noteCommitment = keccak256("default-nc");
        bytes32 nonce = _computeNonce(0, weightedAmount, noteCommitment);

        bytes32 debateId = _setupDebateAndCommit();

        vm.warp(block.timestamp + 151);

        bytes32[2] memory dwInputs = [bytes32(uint256(weightedAmount)), noteCommitment];

        vm.prank(trader1);
        market.revealTrade(
            debateId, 0, 0, 0, DebateMarket.TradeDirection.BUY,
            nonce, DUMMY_PROOF, dwInputs
        );

        // Verify LMSR weight tracking
        assertEq(
            market.lmsrArgumentWeights(debateId, 0),
            weightedAmount,
            "lmsrArgumentWeights should equal weightedAmount"
        );
        assertEq(
            market.lmsrTotalWeight(debateId),
            weightedAmount,
            "lmsrTotalWeight should equal weightedAmount"
        );
    }

    // ============================================================================
    // 2. revealTrade with invalid proof — revert InvalidDebateWeightProof
    // ============================================================================

    /// @notice revealTrade reverts when debate_weight proof verification fails
    function test_RevealTrade_InvalidProof_Reverts() public {
        // Deploy market with rejecting verifier
        RejectingDebateWeightVerifier rejectVerifier = new RejectingDebateWeightVerifier();
        MockPositionNoteVerifier pnV = new MockPositionNoteVerifier();
        MockAIEvaluationRegistry aiR = new MockAIEvaluationRegistry();
        DebateMarket rejectMarket = new DebateMarket(
            address(mockGate),
            address(rejectVerifier), address(pnV),
            address(aiR), governance, 7 days, address(token), 200
        );
        mockGate.setDeriverAuthorized(address(rejectMarket), true);
        vm.prank(governance);
        rejectMarket.setResolutionExtension(1 days);
        vm.prank(governance);
        rejectMarket.setMinParticipants(1);

        address[3] memory users = [proposer, arguer1, trader1];
        for (uint256 i = 0; i < users.length; i++) {
            vm.prank(users[i]);
            token.approve(address(rejectMarket), type(uint256).max);
        }

        bytes32 debateId = _setupDebateAndCommitFor(rejectMarket);

        vm.warp(block.timestamp + 151);

        uint256 weightedAmount = 8000;
        bytes32 noteCommitment = keccak256("reject-nc"); // matches _setupDebateAndCommitFor
        bytes32[2] memory dwInputs = [bytes32(uint256(weightedAmount)), noteCommitment];

        vm.prank(trader1);
        vm.expectRevert(DebateMarket.InvalidDebateWeightProof.selector);
        rejectMarket.revealTrade(
            debateId, 0, 0, 0, DebateMarket.TradeDirection.BUY,
            _computeNonce(0, weightedAmount, noteCommitment),
            DUMMY_PROOF,
            dwInputs
        );
    }

    // ============================================================================
    // 3. Full lifecycle
    // ============================================================================

    /// @notice Full Phase 2 lifecycle: propose→argue→commit→reveal→execute→resolve→
    ///         updatePositionRoot→settlePrivatePosition
    function test_FullLifecycle_PositionPrivacy() public {
        // PROPOSE
        vm.prank(proposer);
        bytes32 debateId = market.proposeDebate(
            PROPOSITION_HASH, STANDARD_DURATION, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND
        );

        bytes32 derivedDomain = _expectedDebateDomain();

        // ARGUE — arguer1 wins (Tier 3 + stake = sqrt(10e6)*8 weighted)
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("win-arg"), bytes32(0),
            10e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, derivedDomain, 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00",
        address(0)
);

        // arguer2 loses (Tier 1 + stake = sqrt(100e6)*2 weighted)
        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("lose-arg"), bytes32(0),
            100e6, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, derivedDomain, 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00",
        address(0)
);

        // COMMIT — trader1 commits a trade on argument 0 (winning side)
        uint256 weightedAmount = 16000; // represents Tier 4 trade
        bytes32 noteCommitment = keccak256("full-lifecycle-note");
        bytes32 nonce = _computeNonce(0, weightedAmount, noteCommitment);
        bytes32 commitHash = keccak256(
            abi.encodePacked(uint256(0), DebateMarket.TradeDirection.BUY, weightedAmount, noteCommitment, uint256(0), nonce)
        );

        vm.prank(trader1);
        market.commitTrade(
            debateId, commitHash, trader1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_COMMIT_1, derivedDomain, 4),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
);

        // REVEAL — advance to reveal phase
        vm.warp(block.timestamp + 151);

        bytes32[2] memory dwInputs = [bytes32(uint256(weightedAmount)), noteCommitment];
        vm.prank(trader1);
        market.revealTrade(
            debateId, 0, 0, 0, DebateMarket.TradeDirection.BUY,
            nonce, DUMMY_PROOF, dwInputs
        );

        // EXECUTE epoch
        vm.warp(block.timestamp + 200);
        market.executeEpoch(debateId, 0);

        // RESOLVE
        vm.warp(block.timestamp + STANDARD_DURATION + 1 days + 1);
        market.resolveDebate(debateId);

        // Verify arguer1 won (score 25296 > 20000)
        (,,,,,,, uint256 winningArgIndex,,,,,,,,,,,,, ) = market.debates(debateId);
        assertEq(winningArgIndex, 0, "Argument 0 (arguer1) should have won");

        // UPDATE POSITION ROOT — governance sets the root after shadow-atlas builds the tree
        bytes32 newRoot = keccak256("position-tree-root-v1");
        vm.expectEmit(true, false, false, true);
        emit PositionRootUpdated(debateId, newRoot, 1);
        vm.prank(governance);
        market.updatePositionRoot(debateId, newRoot, 1);

        assertEq(market.positionRoot(debateId), newRoot, "Position root should be stored");

        // SETTLE PRIVATE POSITION — trader1 proves they had a winning position
        bytes32 posNullifier = keccak256("position-nullifier-1");

        bytes32[5] memory posInputs = [
            newRoot,           // [0] position_root
            posNullifier,      // [1] nullifier
            debateId,          // [2] debate_id
            bytes32(uint256(0)),  // [3] winning_argument_index = 0
            bytes32(uint256(weightedAmount)) // [4] claimed_weighted_amount
        ];

        vm.expectEmit(true, false, false, true);
        emit PrivateSettlementClaimed(debateId, posNullifier, weightedAmount);

        market.settlePrivatePosition(debateId, DUMMY_PROOF, posInputs);

        // Nullifier should be marked as spent
        assertTrue(
            market.positionNullifiers(debateId, posNullifier),
            "Nullifier should be spent after settlement"
        );
    }

    // ============================================================================
    // 4. Position nullifier double-spend
    // ============================================================================

    /// @notice Second settle with same nullifier reverts PositionNullifierSpent
    function test_SettlePrivatePosition_NullifierDoubleSpend_Reverts() public {
        (bytes32 debateId, bytes32 posRoot) = _setupResolvedDebateWithPositionRoot();

        bytes32 posNullifier = keccak256("test-nullifier-4");
        bytes32[5] memory posInputs = [
            posRoot,
            posNullifier,
            debateId,
            bytes32(uint256(0)), // winning arg index
            bytes32(uint256(8000))
        ];

        // First settle succeeds
        market.settlePrivatePosition(debateId, DUMMY_PROOF, posInputs);
        assertTrue(market.positionNullifiers(debateId, posNullifier), "Nullifier should be spent");

        // Second settle with same nullifier reverts
        vm.expectRevert(DebateMarket.PositionNullifierSpent.selector);
        market.settlePrivatePosition(debateId, DUMMY_PROOF, posInputs);
    }

    // ============================================================================
    // 5. Wrong winning argument
    // ============================================================================

    /// @notice settlePrivatePosition with wrong winningArgumentIndex reverts NotWinningSide
    function test_SettlePrivatePosition_WrongWinningArgument_Reverts() public {
        (bytes32 debateId, bytes32 posRoot) = _setupResolvedDebateWithPositionRoot();

        bytes32 posNullifier = keccak256("test-nullifier-5");
        bytes32[5] memory posInputs = [
            posRoot,
            posNullifier,
            debateId,
            bytes32(uint256(1)), // wrong: winning arg is 0, not 1
            bytes32(uint256(8000))
        ];

        vm.expectRevert(DebateMarket.NotWinningSide.selector);
        market.settlePrivatePosition(debateId, DUMMY_PROOF, posInputs);
    }

    // ============================================================================
    // 6. Position root not set
    // ============================================================================

    /// @notice settlePrivatePosition before updatePositionRoot reverts PositionRootNotSet
    function test_SettlePrivatePosition_RootNotSet_Reverts() public {
        // Set up a resolved debate WITHOUT calling updatePositionRoot
        vm.prank(proposer);
        bytes32 debateId = market.proposeDebate(
            PROPOSITION_HASH, STANDARD_DURATION, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND
        );

        bytes32 derivedDomain = _expectedDebateDomain();

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("only-arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, derivedDomain, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00",
        address(0)
);

        vm.warp(block.timestamp + STANDARD_DURATION + 1 days + 1);
        market.resolveDebate(debateId);

        // Root is zero — no updatePositionRoot called
        assertEq(market.positionRoot(debateId), bytes32(0), "Root should not be set yet");

        bytes32 posNullifier = keccak256("test-nullifier-6");
        bytes32[5] memory posInputs = [
            keccak256("any-root"),
            posNullifier,
            debateId,
            bytes32(uint256(0)),
            bytes32(uint256(8000))
        ];

        vm.expectRevert(DebateMarket.PositionRootNotSet.selector);
        market.settlePrivatePosition(debateId, DUMMY_PROOF, posInputs);
    }

    // ============================================================================
    // 7. Position root mismatch
    // ============================================================================

    /// @notice settlePrivatePosition with stale/wrong root reverts InvalidPositionRoot
    function test_SettlePrivatePosition_WrongRoot_Reverts() public {
        (bytes32 debateId,) = _setupResolvedDebateWithPositionRoot();

        bytes32 posNullifier = keccak256("test-nullifier-7");
        bytes32 wrongRoot = keccak256("wrong-stale-root");
        bytes32[5] memory posInputs = [
            wrongRoot,           // wrong root
            posNullifier,
            debateId,
            bytes32(uint256(0)),
            bytes32(uint256(8000))
        ];

        vm.expectRevert(DebateMarket.InvalidPositionRoot.selector);
        market.settlePrivatePosition(debateId, DUMMY_PROOF, posInputs);
    }

    // ============================================================================
    // 8. Debate ID mismatch
    // ============================================================================

    /// @notice settlePrivatePosition with wrong debate_id in public inputs reverts ActionDomainMismatch
    function test_SettlePrivatePosition_WrongDebateId_Reverts() public {
        (bytes32 debateId, bytes32 posRoot) = _setupResolvedDebateWithPositionRoot();

        bytes32 posNullifier = keccak256("test-nullifier-8");
        bytes32 wrongDebateId = keccak256("some-other-debate");
        bytes32[5] memory posInputs = [
            posRoot,
            posNullifier,
            wrongDebateId, // wrong debate_id
            bytes32(uint256(0)),
            bytes32(uint256(8000))
        ];

        vm.expectRevert(DebateMarket.ActionDomainMismatch.selector);
        market.settlePrivatePosition(debateId, DUMMY_PROOF, posInputs);
    }

    // ============================================================================
    // 9. LMSR weight tracking across multiple reveals
    // ============================================================================

    /// @notice lmsrArgumentWeights and lmsrTotalWeight accumulate across multiple reveals
    function test_LmsrWeightTracking_MultipleReveals() public {
        bytes32 debateId = _setupDebateWithTwoArguments();
        bytes32 derivedDomain = _expectedDebateDomain();

        // Commit two trades in the same epoch (different committers)
        uint256 wa1 = 8000;
        bytes32 nc1 = keccak256("nc1");
        bytes32 nonce1 = _computeNonce(0, wa1, nc1);

        uint256 wa2 = 16000;
        bytes32 nc2 = keccak256("nc2");
        bytes32 nonce2 = _computeNonce(1, wa2, nc2);

        bytes32 ch1 = keccak256(abi.encodePacked(uint256(0), DebateMarket.TradeDirection.BUY, wa1, nc1, uint256(0), nonce1));
        bytes32 ch2 = keccak256(abi.encodePacked(uint256(1), DebateMarket.TradeDirection.BUY, wa2, nc2, uint256(0), nonce2));

        vm.prank(trader1);
        market.commitTrade(debateId, ch1, trader1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_COMMIT_1, derivedDomain, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
);
        vm.prank(trader2);
        market.commitTrade(debateId, ch2, trader2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_COMMIT_2, derivedDomain, 4),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
);

        // Reveal phase
        vm.warp(block.timestamp + 151);

        bytes32[2] memory dwI1 = [bytes32(uint256(wa1)), nc1];
        bytes32[2] memory dwI2 = [bytes32(uint256(wa2)), nc2];

        vm.prank(trader1);
        market.revealTrade(debateId, 0, 0, 0, DebateMarket.TradeDirection.BUY, nonce1, DUMMY_PROOF, dwI1);
        vm.prank(trader2);
        market.revealTrade(debateId, 0, 1, 1, DebateMarket.TradeDirection.BUY, nonce2, DUMMY_PROOF, dwI2);

        // Verify tracking
        assertEq(market.lmsrArgumentWeights(debateId, 0), wa1, "Arg 0 weight should be wa1");
        assertEq(market.lmsrArgumentWeights(debateId, 1), wa2, "Arg 1 weight should be wa2");
        assertEq(market.lmsrTotalWeight(debateId), wa1 + wa2, "Total weight should be wa1 + wa2");
    }

    // ============================================================================
    // 10. updatePositionRoot access control
    // ============================================================================

    /// @notice Non-governance cannot call updatePositionRoot
    function test_UpdatePositionRoot_OnlyGovernance() public {
        vm.prank(proposer);
        bytes32 debateId = market.proposeDebate(
            PROPOSITION_HASH, STANDARD_DURATION, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND
        );

        bytes32 root = keccak256("root");
        vm.prank(arguer1); // not governance
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        market.updatePositionRoot(debateId, root, 1);
    }

    // ============================================================================
    // 11. updatePositionRoot on non-existent debate
    // ============================================================================

    /// @notice updatePositionRoot on unknown debateId reverts DebateNotFound
    function test_UpdatePositionRoot_UnknownDebate_Reverts() public {
        bytes32 unknownId = keccak256("not-a-debate");
        vm.prank(governance);
        vm.expectRevert(DebateMarket.DebateNotFound.selector);
        market.updatePositionRoot(unknownId, keccak256("root"), 0);
    }

    // ============================================================================
    // 12. settlePrivatePosition on unresolved debate
    // ============================================================================

    /// @notice settlePrivatePosition reverts when debate is still ACTIVE
    function test_SettlePrivatePosition_DebateNotResolved_Reverts() public {
        vm.prank(proposer);
        bytes32 debateId = market.proposeDebate(
            PROPOSITION_HASH, STANDARD_DURATION, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND
        );

        bytes32 derivedDomain = _expectedDebateDomain();
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, derivedDomain, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00",
        address(0)
);

        // Set a fake position root so it doesn't revert on that check
        // But debate is ACTIVE, so DebateNotResolved fires first
        bytes32 posNullifier = keccak256("test-nullifier-12");
        bytes32[5] memory posInputs = [
            keccak256("root"),
            posNullifier,
            debateId,
            bytes32(uint256(0)),
            bytes32(uint256(8000))
        ];

        vm.expectRevert(DebateMarket.DebateNotResolved.selector);
        market.settlePrivatePosition(debateId, DUMMY_PROOF, posInputs);
    }

    // ============================================================================
    // 13. InvalidPositionNoteProof — proof verification fails
    // ============================================================================

    /// @notice settlePrivatePosition reverts when position_note proof verification fails
    function test_SettlePrivatePosition_InvalidPositionNoteProof_Reverts() public {
        // Deploy market with rejecting position note verifier
        MockDebateWeightVerifier dwV = new MockDebateWeightVerifier();
        RejectingPositionNoteVerifier rejectPnV = new RejectingPositionNoteVerifier();
        MockAIEvaluationRegistry aiR2 = new MockAIEvaluationRegistry();
        DebateMarket rejectMarket = new DebateMarket(
            address(mockGate),
            address(dwV), address(rejectPnV),
            address(aiR2), governance, 7 days, address(token), 200
        );
        mockGate.setDeriverAuthorized(address(rejectMarket), true);
        vm.prank(governance);
        rejectMarket.setResolutionExtension(1 days);
        vm.prank(governance);
        rejectMarket.setMinParticipants(1);

        address[2] memory users2 = [proposer, arguer1];
        for (uint256 i = 0; i < users2.length; i++) {
            vm.prank(users2[i]);
            token.approve(address(rejectMarket), type(uint256).max);
        }

        // Propose and resolve
        vm.prank(proposer);
        bytes32 debateId = rejectMarket.proposeDebate(
            PROPOSITION_HASH, STANDARD_DURATION, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND
        );

        bytes32 derivedDomain = _expectedDebateDomain();
        vm.prank(arguer1);
        rejectMarket.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, derivedDomain, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00",
        address(0)
);

        vm.warp(block.timestamp + STANDARD_DURATION + 1 days + 1);
        rejectMarket.resolveDebate(debateId);

        // Set position root
        bytes32 root = keccak256("root");
        vm.prank(governance);
        rejectMarket.updatePositionRoot(debateId, root, 1);

        bytes32 posNullifier = keccak256("test-nullifier-13");
        bytes32[5] memory posInputs = [
            root,
            posNullifier,
            debateId,
            bytes32(uint256(0)),
            bytes32(uint256(8000))
        ];

        // The rejecting verifier should cause InvalidPositionNoteProof
        vm.expectRevert(DebateMarket.InvalidPositionNoteProof.selector);
        rejectMarket.settlePrivatePosition(debateId, DUMMY_PROOF, posInputs);
    }

    // ============================================================================
    // 14. Commit hash format verification — Phase 2 includes noteCommitment
    // ============================================================================

    /// @notice Commit with old Phase 1 hash format fails CommitHashMismatch at reveal
    function test_CommitHashFormat_Phase2_IncludesNoteCommitment() public {
        bytes32 debateId = _setupDebateWithOneArgument();
        bytes32 derivedDomain = _expectedDebateDomain();

        // Commit using Phase 1 format (no noteCommitment) — should fail at reveal
        uint256 weightedAmount = 8000;
        bytes32 nonce = bytes32("nonce");
        // Old format: keccak256(argumentIndex, direction, weightedAmount, nonce)
        bytes32 oldFormatCommitHash = keccak256(
            abi.encodePacked(uint256(0), DebateMarket.TradeDirection.BUY, weightedAmount, nonce)
        );

        vm.prank(trader1);
        market.commitTrade(
            debateId, oldFormatCommitHash, trader1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_COMMIT_1, derivedDomain, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
);

        vm.warp(block.timestamp + 151);

        // Reveal with Phase 2 inputs — commit hash won't match (missing noteCommitment in commit)
        bytes32 noteCommitment = keccak256("some-note");
        bytes32[2] memory dwInputs = [bytes32(uint256(weightedAmount)), noteCommitment];

        vm.prank(trader1);
        vm.expectRevert(DebateMarket.CommitHashMismatch.selector);
        market.revealTrade(
            debateId, 0, 0, 0, DebateMarket.TradeDirection.BUY,
            nonce, DUMMY_PROOF, dwInputs
        );
    }

    // ============================================================================
    // HELPERS
    // ============================================================================

    function _expectedDebateDomain() internal pure returns (bytes32) {
        uint256 BN254_MOD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
        uint256 raw = uint256(keccak256(abi.encodePacked(ACTION_DOMAIN, "debate", PROPOSITION_HASH)));
        return bytes32(raw % BN254_MOD);
    }

    function _makePublicInputs(
        bytes32 nullifier,
        bytes32 actionDomain,
        uint256 engagementTier
    ) internal pure returns (uint256[31] memory inputs) {
        inputs[0]  = uint256(bytes32(uint256(0xAAAA1111)));
        inputs[26] = uint256(nullifier);
        inputs[27] = uint256(actionDomain);
        inputs[28] = uint256(3);
        inputs[30] = engagementTier;
    }

    /// @notice Compute the Phase 2 nonce that was used to create the commitment.
    ///         Deterministic: same inputs always produce the same nonce.
    function _computeNonce(
        uint256 argumentIndex,
        uint256 weightedAmount,
        bytes32 noteCommitment
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("test-nonce", argumentIndex, weightedAmount, noteCommitment));
    }

    /// @notice Set up a debate and make trader1 commit a trade (returns debateId)
    function _setupDebateAndCommit() internal returns (bytes32 debateId) {
        debateId = _setupDebateWithOneArgument();
        bytes32 derivedDomain = _expectedDebateDomain();

        uint256 weightedAmount = 8000;
        bytes32 noteCommitment = keccak256("default-nc");
        bytes32 nonce = _computeNonce(0, weightedAmount, noteCommitment);
        bytes32 commitHash = keccak256(
            abi.encodePacked(uint256(0), DebateMarket.TradeDirection.BUY, weightedAmount, noteCommitment, uint256(0), nonce)
        );

        vm.prank(trader1);
        market.commitTrade(
            debateId, commitHash, trader1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_COMMIT_1, derivedDomain, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
);
    }

    /// @notice Like _setupDebateAndCommit but for a specific DebateMarket instance
    function _setupDebateAndCommitFor(DebateMarket targetMarket) internal returns (bytes32 debateId) {
        vm.prank(proposer);
        debateId = targetMarket.proposeDebate(
            PROPOSITION_HASH, STANDARD_DURATION, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND
        );

        bytes32 derivedDomain = _expectedDebateDomain();

        vm.prank(arguer1);
        targetMarket.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, derivedDomain, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00",
        address(0)
);

        uint256 weightedAmount = 8000;
        bytes32 noteCommitment = keccak256("reject-nc");
        bytes32 nonce = _computeNonce(0, weightedAmount, noteCommitment);
        bytes32 commitHash = keccak256(
            abi.encodePacked(uint256(0), DebateMarket.TradeDirection.BUY, weightedAmount, noteCommitment, uint256(0), nonce)
        );

        vm.prank(trader1);
        targetMarket.commitTrade(
            debateId, commitHash, trader1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_COMMIT_1, derivedDomain, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
        );
    }

    /// @notice Setup a debate with one argument from arguer1
    function _setupDebateWithOneArgument() internal returns (bytes32 debateId) {
        vm.prank(proposer);
        debateId = market.proposeDebate(
            PROPOSITION_HASH, STANDARD_DURATION, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND
        );

        bytes32 derivedDomain = _expectedDebateDomain();
        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, derivedDomain, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00",
        address(0)
);
    }

    /// @notice Setup a debate with two arguments from arguer1 and arguer2
    function _setupDebateWithTwoArguments() internal returns (bytes32 debateId) {
        vm.prank(proposer);
        debateId = market.proposeDebate(
            PROPOSITION_HASH, STANDARD_DURATION, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND
        );

        bytes32 derivedDomain = _expectedDebateDomain();

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("arg1"), bytes32(0),
            STANDARD_STAKE, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, derivedDomain, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00",
        address(0)
);

        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("arg2"), bytes32(0),
            STANDARD_STAKE, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, derivedDomain, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00",
        address(0)
);
    }

    /// @notice Setup a resolved debate (arguer1 wins arg0) and set position root.
    ///         Returns (debateId, positionRoot).
    function _setupResolvedDebateWithPositionRoot() internal returns (bytes32 debateId, bytes32 posRoot) {
        // arguer1 wins with Tier 3: score = sqrt(10e6)*8 weighted
        // arguer2 loses with Tier 1: score = sqrt(100e6)*2 weighted
        vm.prank(proposer);
        debateId = market.proposeDebate(
            PROPOSITION_HASH, STANDARD_DURATION, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND
        );

        bytes32 derivedDomain = _expectedDebateDomain();

        vm.prank(arguer1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("win"), bytes32(0),
            10e6, arguer1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_1, derivedDomain, 3),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00",
        address(0)
);

        vm.warp(block.timestamp + 61);
        vm.prank(arguer2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("lose"), bytes32(0),
            100e6, arguer2, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_2, derivedDomain, 1),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00",
        address(0)
);

        vm.warp(block.timestamp + STANDARD_DURATION + 1 days + 1);
        market.resolveDebate(debateId);

        // Set position root
        posRoot = keccak256("test-position-root");
        vm.prank(governance);
        market.updatePositionRoot(debateId, posRoot, 5);
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
        bytes32 nullifier   = bytes32(publicInputs[26]);
        bytes32 actionDomain = bytes32(publicInputs[27]);
        bytes32 userRoot    = bytes32(publicInputs[0]);
        nullifierRegistry.recordNullifier(actionDomain, nullifier, userRoot);
    }
}

/// @notice Mock debate_weight verifier — always returns true (testing only)
contract MockDebateWeightVerifier is IDebateWeightVerifier {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        return true;
    }
}

/// @notice Mock position_note verifier — always returns true (testing only)
contract MockPositionNoteVerifier is IPositionNoteVerifier {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        return true;
    }
}

/// @notice Rejecting debate_weight verifier — always returns false (for negative tests)
contract RejectingDebateWeightVerifier is IDebateWeightVerifier {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        return false;
    }
}

/// @notice Rejecting position_note verifier — always returns false (for negative tests)
contract RejectingPositionNoteVerifier is IPositionNoteVerifier {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        return false;
    }
}

/// @notice Mock AI evaluation registry — always registered, sensible defaults (testing only)
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
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

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
        require(balanceOf[msg.sender] >= amount, "insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient balance");
        require(allowance[from][msg.sender] >= amount, "insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
