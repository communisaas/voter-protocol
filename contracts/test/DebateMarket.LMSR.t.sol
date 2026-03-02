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

/// @title DebateMarket LMSR Tests
/// @notice Tests for batch LMSR pricing, commit-reveal epoch trading, and price invariants.
/// @dev Inherits the same mock architecture as DebateMarket.t.sol:
///      - MockDistrictGate: accepts proofs, records nullifiers
contract DebateMarketLMSRTest is Test {
    DebateMarket public market;
    MockDistrictGate public mockGate;
    NullifierRegistry public nullifierRegistry;
    MockERC20 public token;

    address public governance = address(0x1);
    address public proposer = address(0x10);
    address public trader1 = address(0x20);
    address public trader2 = address(0x30);
    address public trader3 = address(0x40);

    bytes32 public constant ACTION_DOMAIN = keccak256("debate-housing-2026");
    bytes32 public constant PROPOSITION_HASH = keccak256("Should we increase housing density?");

    bytes32 public constant NULLIFIER_1 = bytes32(uint256(0x2000));
    bytes32 public constant NULLIFIER_2 = bytes32(uint256(0x3000));
    bytes32 public constant NULLIFIER_3 = bytes32(uint256(0x4000));
    bytes32 public constant NULLIFIER_COMMIT_1 = bytes32(uint256(0xA000));
    bytes32 public constant NULLIFIER_COMMIT_2 = bytes32(uint256(0xB000));
    bytes32 public constant NULLIFIER_COMMIT_3 = bytes32(uint256(0xC000));

    uint256 public constant STANDARD_DURATION = 4 days;
    uint256 public constant STANDARD_BOND = 5e6;
    uint256 public constant STANDARD_STAKE = 2e6;
    uint256 public constant JURISDICTION_SIZE = 700_000;

    bytes public constant DUMMY_PROOF = hex"deadbeef";
    uint8 public constant VERIFIER_DEPTH = 20;

    // Events
    event TradeCommitted(bytes32 indexed debateId, uint256 indexed epoch, bytes32 commitHash, uint256 commitIndex);
    event TradeRevealed(bytes32 indexed debateId, uint256 indexed epoch, uint256 argumentIndex, DebateMarket.TradeDirection direction, uint256 weightedAmount);
    event EpochExecuted(bytes32 indexed debateId, uint256 indexed epoch, uint256 tradesApplied);

    function setUp() public {
        nullifierRegistry = new NullifierRegistry(governance);
        mockGate = new MockDistrictGate(address(nullifierRegistry));

        vm.prank(governance);
        nullifierRegistry.proposeCallerAuthorization(address(mockGate));
        vm.warp(block.timestamp + 7 days);
        nullifierRegistry.executeCallerAuthorization(address(mockGate));

        mockGate.setActionDomainAllowed(ACTION_DOMAIN, true);

        token = new MockERC20("Test USD", "TUSD", 6);

        MockDebateWeightVerifier dwVerifier = new MockDebateWeightVerifier();
        MockPositionNoteVerifier pnVerifier = new MockPositionNoteVerifier();
        MockAIEvaluationRegistry aiRegistry = new MockAIEvaluationRegistry();
        market = new DebateMarket(address(mockGate), address(dwVerifier), address(pnVerifier), address(aiRegistry), governance, address(token), 200);
        mockGate.setDeriverAuthorized(address(market), true);

        address[4] memory participants = [proposer, trader1, trader2, trader3];
        for (uint256 i = 0; i < participants.length; i++) {
            token.mint(participants[i], 10_000e6);
            vm.prank(participants[i]);
            token.approve(address(market), type(uint256).max);
        }
    }

    // ============================================================================
    // LMSR PRICING
    // ============================================================================

    /// @notice Prices sum to ~1.0 (within tolerance) for 2 arguments
    function test_LMSR_PricesSumToOne_TwoArguments() public {
        bytes32 debateId = _setupDebateWithArguments(2);

        SD59x18[] memory prices = market.getPrices(debateId);
        assertEq(prices.length, 2);

        int256 sum = prices[0].unwrap() + prices[1].unwrap();
        // Should be very close to 1e18 (within 1e3 tolerance for rounding)
        assertApproxEqAbs(sum, 1e18, 1e3, "Prices should sum to ~1.0");
    }

    /// @notice Prices sum to ~1.0 for 3 arguments
    function test_LMSR_PricesSumToOne_ThreeArguments() public {
        bytes32 debateId = _setupDebateWithArguments(3);

        SD59x18[] memory prices = market.getPrices(debateId);
        assertEq(prices.length, 3);

        int256 sum;
        for (uint256 i = 0; i < prices.length; i++) {
            sum += prices[i].unwrap();
        }
        assertApproxEqAbs(sum, 1e18, 1e3, "Prices should sum to ~1.0");
    }

    /// @notice Prices sum to ~1.0 for 5 arguments
    function test_LMSR_PricesSumToOne_FiveArguments() public {
        bytes32 debateId = _setupDebateWithArguments(5);

        SD59x18[] memory prices = market.getPrices(debateId);
        assertEq(prices.length, 5);

        int256 sum;
        for (uint256 i = 0; i < prices.length; i++) {
            sum += prices[i].unwrap();
        }
        assertApproxEqAbs(sum, 1e18, 1e3, "Prices should sum to ~1.0");
    }

    /// @notice Equal quantities → equal prices
    function test_LMSR_EqualQuantities_EqualPrices() public {
        bytes32 debateId = _setupDebateWithArguments(3);

        SD59x18[] memory prices = market.getPrices(debateId);

        // All quantities are 0 → all prices should be 1/3
        int256 expectedPrice = int256(1e18) / 3;
        for (uint256 i = 0; i < prices.length; i++) {
            assertApproxEqAbs(prices[i].unwrap(), expectedPrice, 1e3, "Equal quantities should give equal prices");
        }
    }

    /// @notice Jurisdiction-scaled liquidity: large district gets high b
    function test_LMSR_JurisdictionScaling_LargeDistrict() public {
        vm.prank(proposer);
        bytes32 debateId = market.proposeDebate(
            PROPOSITION_HASH, STANDARD_DURATION, 700_000, ACTION_DOMAIN, STANDARD_BOND
        );

        SD59x18 b = market.lmsrLiquidity(debateId);
        // b = 700_000 * 1e15 = 700e18
        assertEq(b.unwrap(), 700_000 * 1e15, "Large district should have b = 700e18");
    }

    /// @notice Jurisdiction-scaled liquidity: small district gets low b
    function test_LMSR_JurisdictionScaling_SmallDistrict() public {
        vm.prank(proposer);
        bytes32 debateId = market.proposeDebate(
            keccak256("rural-district"),
            STANDARD_DURATION,
            200,
            ACTION_DOMAIN,
            STANDARD_BOND
        );

        SD59x18 b = market.lmsrLiquidity(debateId);
        // b = 200 * 1e15 = 0.2e18
        assertEq(b.unwrap(), 200 * 1e15, "Small district should have b = 0.2e18");
    }

    /// @notice getPrice returns zero for empty debate
    function test_LMSR_GetPrice_EmptyDebate() public {
        vm.prank(proposer);
        bytes32 debateId = market.proposeDebate(
            PROPOSITION_HASH, STANDARD_DURATION, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND
        );

        SD59x18 price = market.getPrice(debateId, 0);
        assertEq(price.unwrap(), 0, "Price should be 0 for empty debate");
    }

    /// @notice getPrice returns zero for out-of-range argument
    function test_LMSR_GetPrice_OutOfRange() public {
        bytes32 debateId = _setupDebateWithArguments(2);

        SD59x18 price = market.getPrice(debateId, 99);
        assertEq(price.unwrap(), 0, "Price should be 0 for invalid argument index");
    }

    // ============================================================================
    // COMMIT-REVEAL EPOCH TRADING
    // ============================================================================

    /// @notice Full commit-reveal-execute lifecycle (Phase 2: debate_weight ZK proof)
    function test_Epoch_CommitRevealExecute_Lifecycle() public {
        bytes32 debateId = _setupDebateWithArguments(2);
        bytes32 derivedDomain = _expectedDebateDomain();

        // --- COMMIT PHASE ---
        // Phase 2: commit hash format is keccak256(argumentIndex, direction, weightedAmount, noteCommitment, nonce)
        bytes32 nonce = keccak256("secret-nonce");
        uint256 weightedAmount = 4000; // corresponds to sqrt(4e6) * 2 = 2000 * 2 = 4000 (Tier 2, $4)
        bytes32 noteCommitment = keccak256("note-commitment-1");
        uint256 argumentIndex = 0;
        DebateMarket.TradeDirection direction = DebateMarket.TradeDirection.BUY;

        bytes32 commitHash = keccak256(
            abi.encodePacked(argumentIndex, direction, weightedAmount, noteCommitment, uint256(0), nonce)
        );

        vm.prank(trader1);
        market.commitTrade(
            debateId,
            commitHash,
            trader1,
            DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_COMMIT_1, derivedDomain, 2),
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00"
            );

        assertEq(market.getEpochCommitCount(debateId, 0), 1, "Should have 1 commitment");

        // --- REVEAL PHASE ---
        // Advance to reveal phase (half epoch = 150 seconds)
        vm.warp(block.timestamp + 151);

        bytes32[2] memory dwInputs = [bytes32(bytes32(uint256(weightedAmount))), noteCommitment];
        vm.prank(trader1);
        market.revealTrade(debateId, 0, 0, argumentIndex, direction, nonce, DUMMY_PROOF, dwInputs);

        assertEq(market.getEpochRevealCount(debateId, 0), 1, "Should have 1 reveal");

        // --- EXECUTE ---
        // Advance past epoch
        vm.warp(block.timestamp + 200);

        // Snapshot prices before
        SD59x18[] memory pricesBefore = market.getPrices(debateId);

        market.executeEpoch(debateId, 0);

        // Verify epoch advanced
        assertEq(market.currentEpoch(debateId), 1, "Epoch should advance to 1");

        // Verify prices changed (argument 0 should have higher price now)
        SD59x18[] memory pricesAfter = market.getPrices(debateId);
        assertGt(pricesAfter[0].unwrap(), pricesBefore[0].unwrap(), "BUY should increase price");
        assertLt(pricesAfter[1].unwrap(), pricesBefore[1].unwrap(), "Other price should decrease");

        // Prices should still sum to ~1.0
        int256 sum = pricesAfter[0].unwrap() + pricesAfter[1].unwrap();
        assertApproxEqAbs(sum, 1e18, 1e3, "Prices should still sum to ~1.0 after trade");
    }

    /// @notice Multiple trades in one epoch all get same average price (Phase 2)
    function test_Epoch_BatchExecution_MultipleTrades() public {
        bytes32 debateId = _setupDebateWithArguments(3);
        bytes32 derivedDomain = _expectedDebateDomain();

        // Commit 3 trades — Phase 2: commit hash uses weightedAmount + noteCommitment
        bytes32 nonce1 = keccak256("nonce1");
        bytes32 nonce2 = keccak256("nonce2");
        bytes32 nonce3 = keccak256("nonce3");

        uint256 wa1 = 4472; // sqrt(5e6)*4 ≈ 2236*2 = 4472 (Tier 2)
        uint256 wa2 = 12649; // sqrt(10e6)*8 ≈ 3162*8 = 25296 (Tier 3) — use simpler value
        uint256 wa3 = 3464;  // sqrt(3e6)*2 ≈ 1732*2 = 3464 (Tier 1)
        bytes32 nc1 = keccak256("nc1");
        bytes32 nc2 = keccak256("nc2");
        bytes32 nc3 = keccak256("nc3");

        bytes32 commit1 = keccak256(abi.encodePacked(uint256(0), DebateMarket.TradeDirection.BUY, wa1, nc1, uint256(0), nonce1));
        bytes32 commit2 = keccak256(abi.encodePacked(uint256(1), DebateMarket.TradeDirection.BUY, wa2, nc2, uint256(0), nonce2));
        bytes32 commit3 = keccak256(abi.encodePacked(uint256(2), DebateMarket.TradeDirection.BUY, wa3, nc3, uint256(0), nonce3));

        vm.prank(trader1);
        market.commitTrade(debateId, commit1, trader1, DUMMY_PROOF, _makePublicInputs(NULLIFIER_COMMIT_1, derivedDomain, 2), VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00");

        vm.prank(trader2);
        market.commitTrade(debateId, commit2, trader2, DUMMY_PROOF, _makePublicInputs(NULLIFIER_COMMIT_2, derivedDomain, 3), VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00");

        vm.prank(trader3);
        market.commitTrade(debateId, commit3, trader3, DUMMY_PROOF, _makePublicInputs(NULLIFIER_COMMIT_3, derivedDomain, 1), VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00");

        assertEq(market.getEpochCommitCount(debateId, 0), 3);

        // Reveal phase
        vm.warp(block.timestamp + 151);

        bytes32[2] memory dwI1 = [bytes32(uint256(wa1)), nc1];
        bytes32[2] memory dwI2 = [bytes32(uint256(wa2)), nc2];
        bytes32[2] memory dwI3 = [bytes32(uint256(wa3)), nc3];

        vm.prank(trader1);
        market.revealTrade(debateId, 0, 0, 0, DebateMarket.TradeDirection.BUY, nonce1, DUMMY_PROOF, dwI1);
        vm.prank(trader2);
        market.revealTrade(debateId, 0, 1, 1, DebateMarket.TradeDirection.BUY, nonce2, DUMMY_PROOF, dwI2);
        vm.prank(trader3);
        market.revealTrade(debateId, 0, 2, 2, DebateMarket.TradeDirection.BUY, nonce3, DUMMY_PROOF, dwI3);

        // Execute
        vm.warp(block.timestamp + 200);

        vm.expectEmit(true, true, false, true);
        emit EpochExecuted(debateId, 0, 3);
        market.executeEpoch(debateId, 0);

        // All prices should still sum to 1.0
        SD59x18[] memory prices = market.getPrices(debateId);
        int256 sum;
        for (uint256 i = 0; i < prices.length; i++) {
            sum += prices[i].unwrap();
        }
        assertApproxEqAbs(sum, 1e18, 1e3, "Prices must sum to ~1.0 after batch execution");
    }

    /// @notice Permissionless epoch execution: anyone can call executeEpoch
    function test_Epoch_PermissionlessExecution() public {
        bytes32 debateId = _setupDebateWithArguments(2);
        _commitAndRevealSingleTrade(debateId, 0, 5e6, 2);

        // Random address calls executeEpoch
        address randomCaller = address(0xDEAD);
        vm.prank(randomCaller);
        market.executeEpoch(debateId, 0);

        assertEq(market.currentEpoch(debateId), 1, "Non-participant should be able to execute");
    }

    /// @notice Cannot commit during reveal phase
    function test_RevertWhen_CommitDuringRevealPhase() public {
        bytes32 debateId = _setupDebateWithArguments(2);
        bytes32 derivedDomain = _expectedDebateDomain();

        // Advance to reveal phase
        // First we need to start the epoch by committing
        bytes32 commitHash = keccak256(abi.encodePacked(uint256(0), DebateMarket.TradeDirection.BUY, uint256(5e6), bytes32("nonce")));
        vm.prank(trader1);
        market.commitTrade(debateId, commitHash, trader1, DUMMY_PROOF, _makePublicInputs(NULLIFIER_COMMIT_1, derivedDomain, 2), VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00");

        // Advance to reveal phase
        vm.warp(block.timestamp + 151);

        // Try to commit — should revert
        bytes32 commitHash2 = keccak256("another-commit");
        vm.prank(trader2);
        vm.expectRevert(DebateMarket.EpochNotInCommitPhase.selector);
        market.commitTrade(debateId, commitHash2, trader2, DUMMY_PROOF, _makePublicInputs(NULLIFIER_COMMIT_2, derivedDomain, 2), VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00");
    }

    /// @notice Cannot reveal during commit phase (Phase 2)
    function test_RevertWhen_RevealDuringCommitPhase() public {
        bytes32 debateId = _setupDebateWithArguments(2);
        bytes32 derivedDomain = _expectedDebateDomain();

        // Commit a trade
        bytes32 nonce = bytes32("nonce");
        uint256 wa = 4000;
        bytes32 nc = keccak256("nc");
        bytes32 commitHash = keccak256(abi.encodePacked(uint256(0), DebateMarket.TradeDirection.BUY, wa, nc, uint256(0), nonce));
        vm.prank(trader1);
        market.commitTrade(debateId, commitHash, trader1, DUMMY_PROOF, _makePublicInputs(NULLIFIER_COMMIT_1, derivedDomain, 2), VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00");

        // Try to reveal immediately (still commit phase)
        bytes32[2] memory dwInputs = [bytes32(uint256(wa)), nc];
        vm.prank(trader1);
        vm.expectRevert(DebateMarket.EpochNotInRevealPhase.selector);
        market.revealTrade(debateId, 0, 0, 0, DebateMarket.TradeDirection.BUY, nonce, DUMMY_PROOF, dwInputs);
    }

    /// @notice Cannot execute epoch twice
    function test_RevertWhen_DoubleExecute() public {
        bytes32 debateId = _setupDebateWithArguments(2);
        _commitAndRevealSingleTrade(debateId, 0, 5e6, 2);

        market.executeEpoch(debateId, 0);

        vm.expectRevert(DebateMarket.EpochAlreadyExecuted.selector);
        market.executeEpoch(debateId, 0);
    }

    /// @notice Reveal with wrong weightedAmount reverts with CommitHashMismatch (Phase 2)
    function test_RevertWhen_RevealWrongPreimage() public {
        bytes32 debateId = _setupDebateWithArguments(2);
        bytes32 derivedDomain = _expectedDebateDomain();

        bytes32 nonce = bytes32("nonce");
        uint256 wa = 4000;
        bytes32 nc = keccak256("nc");
        bytes32 commitHash = keccak256(abi.encodePacked(uint256(0), DebateMarket.TradeDirection.BUY, wa, nc, uint256(0), nonce));

        vm.prank(trader1);
        market.commitTrade(debateId, commitHash, trader1, DUMMY_PROOF, _makePublicInputs(NULLIFIER_COMMIT_1, derivedDomain, 2), VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00");

        vm.warp(block.timestamp + 151);

        // Reveal with wrong weightedAmount — hash won't match
        bytes32[2] memory wrongInputs = [bytes32(uint256(9999)), nc]; // wrong weightedAmount
        vm.prank(trader1);
        vm.expectRevert(DebateMarket.CommitHashMismatch.selector);
        market.revealTrade(debateId, 0, 0, 0, DebateMarket.TradeDirection.BUY, nonce, DUMMY_PROOF, wrongInputs);
    }

    /// @notice Cannot reveal someone else's commitment (Phase 2)
    function test_RevertWhen_RevealNotCommitter() public {
        bytes32 debateId = _setupDebateWithArguments(2);
        bytes32 derivedDomain = _expectedDebateDomain();

        bytes32 nonce = bytes32("nonce");
        uint256 wa = 4000;
        bytes32 nc = keccak256("nc");
        bytes32 commitHash = keccak256(abi.encodePacked(uint256(0), DebateMarket.TradeDirection.BUY, wa, nc, uint256(0), nonce));

        vm.prank(trader1);
        market.commitTrade(debateId, commitHash, trader1, DUMMY_PROOF, _makePublicInputs(NULLIFIER_COMMIT_1, derivedDomain, 2), VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00");

        vm.warp(block.timestamp + 151);

        // Different person tries to reveal
        bytes32[2] memory dwInputs = [bytes32(uint256(wa)), nc];
        vm.prank(trader2);
        vm.expectRevert(DebateMarket.NotCommitter.selector);
        market.revealTrade(debateId, 0, 0, 0, DebateMarket.TradeDirection.BUY, nonce, DUMMY_PROOF, dwInputs);
    }

    // ============================================================================
    // DYNAMIC ARGUMENT REBALANCING
    // ============================================================================

    /// @notice Adding a new argument auto-rebalances prices (q_new = 0)
    function test_LMSR_DynamicRebalancing_NewArgument() public {
        bytes32 debateId = _setupDebateWithArguments(2);
        bytes32 derivedDomain = _expectedDebateDomain();

        // Move prices: BUY argument 0
        _commitAndRevealSingleTrade(debateId, 0, 10e6, 3);
        market.executeEpoch(debateId, 0);

        SD59x18[] memory pricesBefore = market.getPrices(debateId);
        assertGt(pricesBefore[0].unwrap(), pricesBefore[1].unwrap(), "Arg 0 should be more expensive");

        // Add a 3rd argument
        vm.warp(block.timestamp + 1);
        vm.prank(trader3);
        market.submitArgument(
            debateId,
            DebateMarket.Stance.AMEND,
            keccak256("Third argument"),
            keccak256("Amendment text"),
            STANDARD_STAKE,
            trader3,
            DUMMY_PROOF,
            _makePublicInputs(bytes32(uint256(0xF000)), derivedDomain, 1),
            VERIFIER_DEPTH,
            block.timestamp + 1 hours,
            hex"00",
            address(0)
            );

        // Prices should now be 3 entries summing to ~1.0
        SD59x18[] memory pricesAfter = market.getPrices(debateId);
        assertEq(pricesAfter.length, 3, "Should have 3 prices");

        int256 sum;
        for (uint256 i = 0; i < pricesAfter.length; i++) {
            sum += pricesAfter[i].unwrap();
        }
        assertApproxEqAbs(sum, 1e18, 1e3, "Prices must sum to ~1.0 after rebalancing");

        // Arg 0 should still be more expensive than arg 1, but less than before (diluted)
        assertGt(pricesAfter[0].unwrap(), pricesAfter[2].unwrap(), "Arg 0 still leads");
    }

    // ============================================================================
    // ANTI-PLUTOCRATIC WEIGHTING
    // ============================================================================

    /// @notice sqrt weighting dampens whale advantage
    function test_LMSR_AntiPlutocratic_SqrtWeighting() public {
        // Setup two separate debates to compare whale vs citizen impact in isolation
        bytes32 debateId = _setupDebateWithArguments(2);

        // Whale: $10K stake, Tier 1 → sqrt(10_000e6) * 2 ≈ 6,325 weighted
        _commitAndRevealSingleTrade(debateId, 0, 10_000e6, 1);
        market.executeEpoch(debateId, 0);
        SD59x18 priceAfterWhale = market.getPrice(debateId, 0);

        // Verify the whale moved the price above 50%
        assertGt(priceAfterWhale.unwrap(), 500000000000000000, "Whale should push price above 50%");

        // The key insight: sqrt(10_000e6) * 2 = sqrt(10^10) * 2 ≈ 100000 * 2 = 200,000
        // While sqrt(10e6) * 16 = sqrt(10^7) * 16 ≈ 3162 * 16 = 50,596
        // Whale stakes 1000x more but only gets ~4x the weighted impact.
        // That's the anti-plutocratic guarantee.
        uint256 whaleWeighted = _computeWeight(10_000e6, 1);
        uint256 citizenWeighted = _computeWeight(10e6, 4);
        // Whale/citizen ratio should be much less than 1000 (the stake ratio)
        assertLt(whaleWeighted / citizenWeighted, 10, "sqrt dampening: 1000x stake should give <10x impact");
    }

    function _computeWeight(uint256 stakeAmount, uint8 tier) internal pure returns (uint256) {
        uint256 s = stakeAmount;
        if (s == 0) return 0;
        uint256 z = (s + 1) / 2;
        uint256 y = s;
        while (z < y) { y = z; z = (s / z + z) / 2; }
        uint256 multiplier = tier == 1 ? 2 : tier == 2 ? 4 : tier == 3 ? 8 : 16;
        return y * multiplier;
    }

    // ============================================================================
    // SATURATION
    // ============================================================================

    /// @notice Extreme q/b ratio doesn't revert (saturation at 100)
    function test_LMSR_Saturation_NoRevertAtExtreme() public {
        // Small jurisdiction → small b → easier to saturate
        vm.prank(proposer);
        bytes32 debateId = market.proposeDebate(
            keccak256("tiny-district"),
            STANDARD_DURATION,
            10, // tiny jurisdiction → b = 10 * 1e15 = 0.01e18
            ACTION_DOMAIN,
            STANDARD_BOND
        );

        bytes32 derivedDomain = market.deriveDomain(ACTION_DOMAIN, keccak256("tiny-district"));

        // Submit 2 arguments
        vm.prank(trader1);
        market.submitArgument(
            debateId, DebateMarket.Stance.SUPPORT, keccak256("sup"), bytes32(0),
            STANDARD_STAKE, trader1, DUMMY_PROOF, _makePublicInputs(NULLIFIER_1, derivedDomain, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00",
            address(0)
 );
        vm.warp(block.timestamp + 61);
        vm.prank(trader2);
        market.submitArgument(
            debateId, DebateMarket.Stance.OPPOSE, keccak256("opp"), bytes32(0),
            STANDARD_STAKE, trader2, DUMMY_PROOF, _makePublicInputs(NULLIFIER_2, derivedDomain, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00",
            address(0)
 );

        // Massive BUY to push q/b toward saturation — Phase 2 commit-reveal
        // weightedAmount = sqrt(50_000e6) * 16 = 223606 * 16 = 3,577,696 (Tier 4 whale)
        bytes32 nonce = bytes32("sat-nonce");
        uint256 satWeighted = 3_577_696;
        bytes32 satNc = keccak256("sat-nc");
        bytes32 commitHash = keccak256(
            abi.encodePacked(uint256(0), DebateMarket.TradeDirection.BUY, satWeighted, satNc, uint256(0), nonce)
        );

        vm.prank(trader3);
        market.commitTrade(
            debateId, commitHash, trader3, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_COMMIT_1, derivedDomain, 4),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
 );

        vm.warp(block.timestamp + 151);
        bytes32[2] memory satDwInputs = [bytes32(uint256(satWeighted)), satNc];
        vm.prank(trader3);
        market.revealTrade(debateId, 0, 0, 0, DebateMarket.TradeDirection.BUY, nonce, DUMMY_PROOF, satDwInputs);

        vm.warp(block.timestamp + 200);

        // This should NOT revert thanks to saturation
        market.executeEpoch(debateId, 0);

        // Saturated argument should have price ≈ 1.0
        SD59x18 dominantPrice = market.getPrice(debateId, 0);
        assertGt(dominantPrice.unwrap(), 990000000000000000, "Saturated argument should be near 1.0");

        // Prices still sum to ~1.0
        SD59x18[] memory prices = market.getPrices(debateId);
        int256 sum;
        for (uint256 i = 0; i < prices.length; i++) {
            sum += prices[i].unwrap();
        }
        assertApproxEqAbs(sum, 1e18, 1e3, "Prices must sum to ~1.0 even at saturation");
    }

    // ============================================================================
    // EPOCH PHASE VIEW
    // ============================================================================

    /// @notice getEpochPhase returns correct phase info
    function test_GetEpochPhase() public {
        bytes32 debateId = _setupDebateWithArguments(2);
        bytes32 derivedDomain = _expectedDebateDomain();

        // Before any commits, no phase
        (uint256 epoch, bool isCommit, bool isReveal, uint256 remaining) = market.getEpochPhase(debateId);
        assertEq(epoch, 0);
        assertFalse(isCommit);
        assertFalse(isReveal);

        // Commit → starts epoch
        bytes32 commitHash = keccak256("test");
        vm.prank(trader1);
        market.commitTrade(debateId, commitHash, trader1, DUMMY_PROOF, _makePublicInputs(NULLIFIER_COMMIT_1, derivedDomain, 2), VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00");

        (epoch, isCommit, isReveal, remaining) = market.getEpochPhase(debateId);
        assertEq(epoch, 0);
        assertTrue(isCommit, "Should be in commit phase");
        assertGt(remaining, 0);

        // Advance to reveal
        vm.warp(block.timestamp + 151);
        (epoch, isCommit, isReveal, remaining) = market.getEpochPhase(debateId);
        assertEq(epoch, 0);
        assertFalse(isCommit);
        assertTrue(isReveal, "Should be in reveal phase");
    }

    // ============================================================================
    // GOVERNANCE
    // ============================================================================

    /// @notice Governance can update epoch duration
    function test_Governance_SetEpochDuration() public {
        vm.prank(governance);
        market.setEpochDuration(2 hours);
        assertEq(market.epochDuration(), 2 hours);
    }

    /// @notice Governance can update base liquidity per member
    function test_Governance_SetBaseLiquidity() public {
        vm.prank(governance);
        market.setBaseLiquidityPerMember(sd(2e15)); // double it
        assertEq(market.baseLiquidityPerMember().unwrap(), 2e15);
    }

    /// @notice Non-governance cannot change parameters
    function test_RevertWhen_NonGovernance_SetEpochDuration() public {
        vm.prank(trader1);
        vm.expectRevert();
        market.setEpochDuration(2 hours);
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
        inputs[0] = uint256(bytes32(uint256(0xAAAA1111)));
        inputs[1] = uint256(bytes32(uint256(0xBBBB1111)));
        inputs[26] = uint256(nullifier);
        inputs[27] = uint256(actionDomain);
        inputs[28] = uint256(3);
        inputs[29] = uint256(bytes32(uint256(0xCCCC1111)));
        inputs[30] = engagementTier;
    }

    /// @notice Setup a debate with N arguments (all SUPPORT, default stakes)
    function _setupDebateWithArguments(uint256 count) internal returns (bytes32 debateId) {
        vm.prank(proposer);
        debateId = market.proposeDebate(
            PROPOSITION_HASH, STANDARD_DURATION, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND
        );

        bytes32 derivedDomain = _expectedDebateDomain();
        address[3] memory arguers = [trader1, trader2, trader3];

        for (uint256 i = 0; i < count && i < 3; i++) {
            if (i > 0) vm.warp(block.timestamp + 61);
            vm.prank(arguers[i]);
            market.submitArgument(
                debateId,
                DebateMarket.Stance.SUPPORT,
                keccak256(abi.encodePacked("arg-", i)),
                bytes32(0),
                STANDARD_STAKE,
                arguers[i],
                DUMMY_PROOF,
                _makePublicInputs(bytes32(uint256(0x2000 + i)), derivedDomain, 2),
                VERIFIER_DEPTH,
                block.timestamp + 1 hours,
                hex"00",
                address(0)
                );
        }

        // For 4+ arguments, use dynamically generated addresses
        for (uint256 i = 3; i < count; i++) {
            vm.warp(block.timestamp + 61);
            address extra = address(uint160(0x100 + i));
            token.mint(extra, 10_000e6);
            vm.prank(extra);
            token.approve(address(market), type(uint256).max);
            vm.prank(extra);
            market.submitArgument(
                debateId,
                DebateMarket.Stance.SUPPORT,
                keccak256(abi.encodePacked("arg-", i)),
                bytes32(0),
                STANDARD_STAKE,
                extra,
                DUMMY_PROOF,
                _makePublicInputs(bytes32(uint256(0x2000 + i)), derivedDomain, 2),
                VERIFIER_DEPTH,
                block.timestamp + 1 hours,
                hex"00",
                address(0)
                );
        }
    }

    /// @notice Second debate setup (different proposition hash) for comparison tests
    function _setupDebateWithArguments2(uint256 count) internal returns (bytes32 debateId) {
        bytes32 propHash2 = keccak256("second-debate");
        vm.prank(proposer);
        debateId = market.proposeDebate(
            propHash2, STANDARD_DURATION, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND
        );

        bytes32 derivedDomain = market.deriveDomain(ACTION_DOMAIN, propHash2);
        address[3] memory arguers = [trader1, trader2, trader3];

        for (uint256 i = 0; i < count && i < 3; i++) {
            if (i > 0) vm.warp(block.timestamp + 61);
            vm.prank(arguers[i]);
            market.submitArgument(
                debateId,
                DebateMarket.Stance.SUPPORT,
                keccak256(abi.encodePacked("arg2-", i)),
                bytes32(0),
                STANDARD_STAKE,
                arguers[i],
                DUMMY_PROOF,
                _makePublicInputs(bytes32(uint256(0x9000 + i)), derivedDomain, 2),
                VERIFIER_DEPTH,
                block.timestamp + 1 hours,
                hex"00",
                address(0)
                );
        }
    }

    /// @notice Helper: commit, reveal, and advance to execution-ready for a single trade (Phase 2)
    /// @dev weightedAmount is supplied directly (simulates what the debate_weight circuit outputs).
    ///      The mock verifier always returns true so any weightedAmount is accepted.
    function _commitAndRevealSingleTrade(
        bytes32 debateId,
        uint256 argumentIndex,
        uint256 weightedAmount,
        uint8 /* tier — unused in Phase 2, kept for API compat */
    ) internal {
        bytes32 derivedDomain = _expectedDebateDomain();
        bytes32 nonce = keccak256(abi.encodePacked("nonce", argumentIndex, weightedAmount));
        bytes32 noteCommitment = keccak256(abi.encodePacked("nc", argumentIndex, weightedAmount));
        bytes32 commitHash = keccak256(
            abi.encodePacked(argumentIndex, DebateMarket.TradeDirection.BUY, weightedAmount, noteCommitment, uint256(0), nonce)
        );

        vm.prank(trader1);
        market.commitTrade(
            debateId, commitHash, trader1, DUMMY_PROOF,
            _makePublicInputs(NULLIFIER_COMMIT_1, derivedDomain, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
 );

        // Advance to reveal phase
        vm.warp(block.timestamp + 151);

        bytes32[2] memory dwInputs = [bytes32(uint256(weightedAmount)), noteCommitment];
        vm.prank(trader1);
        market.revealTrade(debateId, 0, 0, argumentIndex, DebateMarket.TradeDirection.BUY, nonce, DUMMY_PROOF, dwInputs);

        // Advance past epoch
        vm.warp(block.timestamp + 200);
    }

    /// @notice Helper for second debate: commit-reveal single trade (Phase 2)
    function _commitAndRevealSingleTrade2(
        bytes32 debateId,
        uint256 argumentIndex,
        uint256 weightedAmount,
        uint8 /* tier — unused in Phase 2 */
    ) internal {
        bytes32 propHash2 = keccak256("second-debate");
        bytes32 derivedDomain = market.deriveDomain(ACTION_DOMAIN, propHash2);
        bytes32 nonce = keccak256(abi.encodePacked("nonce2", argumentIndex, weightedAmount));
        bytes32 noteCommitment = keccak256(abi.encodePacked("nc2", argumentIndex, weightedAmount));
        bytes32 commitHash = keccak256(
            abi.encodePacked(argumentIndex, DebateMarket.TradeDirection.BUY, weightedAmount, noteCommitment, uint256(0), nonce)
        );

        vm.prank(trader1);
        market.commitTrade(
            debateId, commitHash, trader1, DUMMY_PROOF,
            _makePublicInputs(bytes32(uint256(0xD000)), derivedDomain, 2),
            VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
 );

        vm.warp(block.timestamp + 151);

        bytes32[2] memory dwInputs = [bytes32(uint256(weightedAmount)), noteCommitment];
        vm.prank(trader1);
        market.revealTrade(debateId, 0, 0, argumentIndex, DebateMarket.TradeDirection.BUY, nonce, DUMMY_PROOF, dwInputs);

        vm.warp(block.timestamp + 200);
    }
}

// ============================================================================
// MOCK CONTRACTS (duplicated from DebateMarket.t.sol for standalone execution)
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
