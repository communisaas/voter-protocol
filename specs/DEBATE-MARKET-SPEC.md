# Debate Market

> **Spec ID:** DBM-001
> **Version:** 0.1.0
> **Status:** DESIGN (not live — see Implementation Status below)
> **Date:** 2026-02-24
> **Companion Documents:** REPUTATION-ARCHITECTURE-SPEC.md, COMMUNIQUE-INTEGRATION-SPEC.md, CHALLENGE-MARKET-ARCHITECTURE.md, COORDINATION-INTEGRITY-SPEC.md
> **Prerequisite:** Three-tree architecture operational (31 public inputs) — verified in `DebateMarket.sol:1035-1040` (`uint256[31] calldata publicInputs`).

## Implementation Status (as of 2026-04-23)

- **Feature flag:** `FEATURES.DEBATE = false` in `commons/src/lib/config/features.ts:21`. The debate market is **not live** in production.
- **Infrastructure present:** three-tree proof verification path, `DebateMarket.sol` scaffolding, `debate_weight` + `position_note` Noir circuits, LMSR math library.
- **Deferred to Phase 2:** private settlement with token payout (currently attestation only per `DebateMarket.sol:1369-1370`), AI evaluation integration (external service, off-chain), unlinkable-relayer pattern.

The rest of this document describes the full design. Where it uses present-tense phrasing for a Phase 2 or external component, a "Status" line flags the delta from implementation.

---

## 1. Core Insight

Templates on Communique accumulate sends. Sends are civic actions — each one consumes a nullifier, carries an engagement tier, and delivers a real message to a real institution. A template with 847 sends is 847 verified constituents who put their anonymous identity behind a position.

But sends alone are an incomplete signal. A template can gain traction while being factually wrong, poorly reasoned, or counterproductive to its own stated goals. The send count tells you popularity. It does not tell you validity.

The debate market is **adversarial quality assurance on civic actions in flight.** When a template gains traction, anyone can open a market on it. Arguments compete — support it, oppose it, amend it — with continuous price discovery that surfaces a real-time validity signal alongside the template's send count.

The user on Communique sees two numbers: **847 people sent this** and **the leading counter-argument (AMEND) holds 62% market share.** That changes the calculus for user 848.

This is not prediction. Nobody is betting on whether the template will be sent — it already is being sent. This is stress-testing: the community puts economic skin in the game to challenge, defend, or improve templates that are actively shaping institutional discourse. The market price is a quality signal, not a probability.

---

## 2. Architecture

### 2.1 Two-Layer Model

```
┌─────────────────────────────────────────────────────────────┐
│  DELIVERY LAYER (existing)                                  │
│                                                             │
│  Template gains sends over time                             │
│  Each send = ZK proof + nullifier + encrypted witness       │
│  Message delivered to institution                           │
│  Accumulating weighted send count = popularity signal       │
└────────────────────┬────────────────────────────────────────┘
                     │ template reaches traction threshold
                     │ OR anyone opens a debate
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  CONTESTATION LAYER (new)                                   │
│                                                             │
│  Market opens on the template (template = proposition)      │
│  Arguments submitted: SUPPORT / OPPOSE / AMEND              │
│  Continuous trading on argument positions                   │
│  Batch LMSR pricing → real-time validity signal             │
│  Resolution via AI evaluation + community weight            │
│  Winning argument modifies template trajectory              │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 The Template Card Signal

On Communique, a template with an active market displays:

```
┌──────────────────────────────────────────────┐
│  Stop the Rent Hike on Mission Street         │
│                                               │
│  847 verified sends                           │
│  ┌──────────────────────────────────────────┐ │
│  │  ⚡ Active debate                  │ │
│  │  AMEND 62%  ·  SUPPORT 31%  ·  OPPOSE 7%│ │
│  │  "Add displacement data from 2024 census"│ │
│  │  14 participants · 3 days remaining      │ │
│  └──────────────────────────────────────────┘ │
│                                               │
│  [ Send Message ]  [ View Debate ]      │
└──────────────────────────────────────────────┘
```

The 62% AMEND signal tells user 848: "the community's most engaged members think this template needs revision." User 848 can still send the original, view the amendment, or enter the debate.

---

## 3. Market Mechanics

### 3.1 Lifecycle

```
OPEN → TRADE → RESOLVE → SETTLE
```

**OPEN** — Any verified member opens a market on an existing template by staking a proposer bond. The template becomes the proposition. The market inherits the template's jurisdiction scope.

**TRADE** — Participants buy and sell positions on arguments. Each argument is an outcome in an LMSR (Logarithmic Market Scoring Rule) automated market maker. New arguments can be submitted until `deadline − ARGUMENT_COOLDOWN` (1 hour before the trade window closes per `DebateMarket.sol:187`). New arguments enter with `q_i = 0`; LMSR quantities for existing arguments are not dynamically rebalanced. Existing positions can be increased or exited.

**RESOLVE** — After the trade window closes, a two-stage resolution determines the winning argument:
- Stage 1: AI evaluation panel scores argument quality (reasoning, evidence, accuracy)
- Stage 2: Tier-weighted community signal (existing `sqrt(stake) × 2^tier` formula) serves as a second input
- Combined score determines winner (see §6)

**SETTLE** — Holders of winning-argument positions receive payouts. Losing positions are forfeited. The proposer bond is returned if minimum participation is met.

### 3.2 Batch LMSR

The market uses Hanson's Logarithmic Market Scoring Rule, executed in batches rather than per-transaction. This is the critical design choice that enables privacy while preserving price discovery.

**LMSR cost function:**

```
C(q) = b × ln(Σ exp(q_i / b))
```

where `q_i` is the number of weighted shares of argument `i` and `b` is the liquidity parameter (subsidized by the proposer bond).

**Price of argument `i`:**

```
p_i = exp(q_i / b) / Σ exp(q_j / b)
```

Prices always sum to 1. A price of 0.62 for AMEND means the market assigns 62% weight to the AMEND argument being the accepted resolution.

**Batch execution:** Trades are not applied individually. They accumulate during an **epoch** (one Scroll block, ~3 seconds) and execute as a batch:

1. Traders submit **commitments** during the epoch: `H(argument_index, direction, weighted_amount, nonce)`
2. At epoch close, traders **reveal** preimages
3. All valid reveals in the epoch are applied to the LMSR state simultaneously
4. New prices are published

All valid reveals in the epoch are applied to the LMSR state in a single `executeEpoch()` call (`DebateMarket.sol:1191-1204`), producing one market price published after execution. No intra-epoch ordering, no front-running, no MEV.

### 3.3 Anti-Plutocratic Weighting in the LMSR

The LMSR operates on **weighted shares**, not raw tokens. When a trader buys argument positions, the LMSR state update uses:

```
weighted_amount = sqrt(stake_amount) × 2^engagement_tier
```

This is computed inside the ZK proof. The trader proves their tier; the contract enforces the weighting. The effect:

| Trader | Stake | Tier | LMSR Impact (weighted shares) |
|---|---|---|---|
| Newcomer, big stake | $100 | 1 | √100 × 2 = **20.0** |
| Pillar, small stake | $2 | 4 | √2 × 16 = **22.6** |
| Veteran, moderate | $10 | 3 | √10 × 8 = **25.3** |

The Pillar at $2 moves the price more than the newcomer at $100.

**Financial settlement** remains proportional to raw tokens staked (you get back what you risked plus winnings). But **price impact** is tier-weighted. This creates a market where:
- The price signal reflects conviction weighted by engagement (the information the community needs)
- The financial payoff is proportional to capital at risk (the incentive participants need)
- Credibility is the heavy lever, capital is the light one

### 3.4 Dynamic Argument Submission

Unlike prediction markets with fixed outcomes, arguments can be submitted during the trade window. A new argument creates a new outcome in the LMSR:

1. Trader submits argument (stance, body_hash, amendment_hash) with initial stake
2. Contract adds a new outcome to the LMSR state vector
3. Existing prices rebalance (all prices must sum to 1)
4. Other traders can now buy positions on the new argument

The market is not just "which of these 3 arguments wins" — it is "which argument, including ones not yet written, will be accepted." Late-breaking arguments can enter and attract positions. The market rewards high-quality inputs, and high-quality inputs can arrive at any time.

**Gas bound:** Maximum 500 arguments per market (inherited from existing `MAX_ARGUMENTS` constant). In practice, markets will consolidate around 3-7 distinct positions.

---

## 4. Privacy Architecture

### 4.1 Threat Model

An observer should not be able to determine:
- Which real person holds which argument position
- The size of any individual's position
- Whether two positions in different markets belong to the same person

An observer CAN see:
- Aggregate prices per argument (this IS the information signal)
- Total volume per epoch
- Number of unique participants (nullifier count)

### 4.2 Privacy Mechanisms

**Layer 1: ZK Membership + Tier (existing)**

Every market action requires a three-tree ZK proof. The proof reveals: `engagement_tier`, `action_domain`, `nullifier`, and 24 jurisdiction slots. It hides: real identity, specific actions taken, participation history.

**Layer 2: Relayer Submission**

Traders never submit transactions from their own wallet. A relayer network (same pattern as the existing on-chain submission relayer) submits on their behalf:

1. Trader generates ZK proof and trade commitment client-side
2. Trader encrypts the bundle and sends to a relayer via the Waku P2P network (or direct HTTPS to the protocol's relayer)
3. Relayer submits the transaction on-chain, paying gas
4. On-chain, the transaction originates from the relayer's address, not the trader's

This breaks the link between wallet address and market position. Combined with the ZK proof (which breaks the link between wallet address and real identity), there are two layers of unlinkability.

**Layer 3: Commit-Reveal Batch Execution**

Individual trade parameters are hidden until the epoch closes:

1. **Commit phase** (duration of epoch): Trader submits `commitment = H(argument_index, direction, weighted_amount, nonce)` on-chain
2. **Reveal phase** (next epoch): Trader submits preimage. Contract verifies `H(preimage) == commitment`
3. **Execute phase** (same block as reveals): All valid reveals are batch-applied to LMSR state

During the commit phase, no observer can see what anyone is trading. During the reveal phase, individual trade parameters become visible — but they are associated with the relayer's address, not the trader's, and the trader's ZK proof hides their identity.

**Net privacy:** Individual trade amounts are revealed at execution (necessary for LMSR state updates), but they cannot be linked to any real identity. The relayer sees the encrypted bundle but cannot decrypt it (it is encrypted to the contract's verification key). The chain sees the trade parameters but not who submitted them.

### 4.3 Epoch-Scoped Nullifiers

Each market epoch has its own nullifier scope, derived from:

```
epoch_action_domain = deriveDomain(market_action_domain, epoch_number)
```

This means:
- A participant can trade once per epoch (one nullifier per epoch per identity)
- Trades across epochs are **unlinkable** — different nullifiers, cannot determine if the same person traded in epoch 1 and epoch 5
- Within an epoch, double-trading is prevented by the nullifier

The existing `NullifierRegistry` handles this without modification — epoch domains are derived deterministically from the market's base domain.

### 4.4 Phase 2: Shielded Position Pool

The commit-reveal model reveals trade amounts at execution. Phase 2 adds a note-commitment scheme for full position privacy:

- Positions are represented as **encrypted notes**: `note = Poseidon(argument_index, amount, tier, randomness)`
- Notes are inserted into a **position Merkle tree** (on-chain root, off-chain leaves)
- To exit a position, the trader provides a ZK proof of note ownership + nullifier
- Trade amounts are never revealed; only the aggregate LMSR state changes are visible

This uses the same Poseidon hashing, Merkle tree infrastructure, and nullifier scheme already built for Trees 1-3. The Noir circuit extension is ~100-200 constraints. See §11 (Phased Deployment) for timeline.

---

## 5. Debate Triggers

### 5.1 Who Can Open a Market

Any verified member with `engagement_tier >= 1` can open a debate market on any published template. Requirements:

- Three-tree ZK proof (membership + tier verification)
- Proposer bond: `MIN_PROPOSER_BOND` ($1 in stablecoins, same as existing DebateMarket)
- The template must have `status = 'approved'` and `verified_sends >= 1`

There is no minimum send threshold for debate. A template with 1 send can be contested. The proposer bond prevents spam; the market's participation depth tells the community how seriously to take the result.

### 5.2 Automatic Debate Signals

Communique surfaces prompts to open debate when:

- A template's send velocity exceeds 2σ above mean for its jurisdiction (viral template)
- A template's `quality_score` drops below 0.6 after initial approval (AI re-evaluation on schedule)
- A new intelligence item (`Intelligence` model) contradicts a template's factual claims
- An existing template in the same jurisdiction and topic cluster takes an opposing position

These are UI prompts, not automatic market creation. A human must still open the market and stake the bond.

### 5.3 Market Duration

- Minimum: 72 hours (inherited from existing `MIN_DURATION`)
- Maximum: 30 days (inherited from existing `MAX_DURATION`)
- Default: 7 days (new; most civic debates resolve within a week)
- Proposer sets duration at market creation

---

## 6. Resolution: AI Evaluation + Community Signal

### 6.1 Two-Stage Resolution

When the trade window closes, resolution proceeds in two stages:

**Stage 1: AI Evaluation (TEE-Attested)**

Open-weight AI models evaluate each argument inside a hardware-attested Trusted Execution Environment (AWS Nitro Enclave). The enclave runs on Graviton ARM processors with pre-baked model weights (Llama 8B Q4, Mistral 7B Q4). Nobody — not even the operator — can observe or manipulate intermediate computation.

Each argument is scored on:

| Dimension | Weight | What It Measures |
|---|---|---|
| Reasoning quality | 0.25 | Logical coherence, absence of fallacies |
| Factual accuracy | 0.25 | Verifiable claims supported by evidence |
| Evidence strength | 0.20 | Quality and relevance of citations |
| Constructiveness | 0.15 | Does the argument advance the discourse? |
| Feasibility | 0.15 | If AMEND: is the proposed change actionable? |

Multiple models produce score vectors per argument. The evaluation score is the median across models (robust to any single model being compromised).

```
ai_score(argument_i) = median(model_1_score_i, ..., model_N_score_i)
```

The enclave produces a **Nitro attestation document** — cryptographic proof binding the evaluation code, model weights (by hash), inputs, and outputs. The attestation hash is posted on-chain alongside the scores.

AI evaluation happens off-chain inside the enclave. The attestation is submitted to the contract as proof of honest computation. If model agreement falls below threshold (models disagree beyond 20% on median), the market extends by 48 hours for human governance review.

**Source grounding:** Before scoring, the enclave extracts verifiable claims from each argument and retrieves external sources (via Exa neural search). Scores for accuracy and evidence dimensions are grounded in actual source material, not model training data alone. Per-claim verdicts and source citations are included in the evaluation transparency data.

**Cost (projected, external service):** ~$0.12 per debate evaluation on an on-demand Graviton Nitro Enclave, with ~$0.06/debate for source retrieval. These numbers are design targets — the evaluation pipeline is external to this repo and is not invoked by any on-chain code. `IAIEvaluationRegistry` and `submitAIEvaluation()` currently accept pre-computed scores via EIP-712 signatures without invoking a TEE.

**Stage 2: Tier-Weighted Community Signal**

The existing formula, computed from on-chain state:

```
community_score(argument_i) = Σ sqrt(stake_j) × 2^tier_j
                               for all positions on argument_i
```

This is already computed incrementally in the LMSR state.

**Combined Resolution:**

```
final_score(argument_i) = α × ai_score(argument_i) + (1 - α) × normalize(community_score(argument_i))
```

where `α` is a governance parameter. Initial value: `α = 0.4` (AI is 40% of resolution, community is 60%).

The argument with the highest `final_score` wins. Ties go to the earlier-submitted argument.

### 6.2 Why Not Pure AI or Pure Community

**Pure AI resolution** makes the market a bet on AI preferences, not on argument quality. Participants optimize for the rubric rather than genuine reasoning. The challenge market architecture (§9: AI Consensus Gaming) documents this failure mode.

**Pure community resolution** (the existing DebateMarket design) is a weighted popularity contest. A well-funded group can coordinate to outweigh better reasoning from a smaller group.

The hybrid ensures that neither AI evaluation nor financial weight alone determines the outcome. A factually wrong argument cannot win just because many Tier 1 users staked on it — the AI panel will score it low. A niche but well-reasoned argument cannot win against overwhelming community conviction — the community signal will dominate.

### 6.3 Evaluation Security

The TEE-attested evaluation introduces a hardware trust assumption instead of a provider diversity assumption. Attack vectors:

**Prompt injection via argument text:** Arguments are user-submitted text evaluated by AI models. A malicious argument could contain prompt injection attempting to manipulate its own score.

*Mitigation:* Models evaluate arguments in a sandboxed context with explicit instructions to ignore meta-directives in argument text. Arguments are passed as data, not as instructions. The median-of-N-models approach means a single manipulated model cannot determine the outcome.

**Enclave compromise (side-channel attacks on Nitro):** If the TEE is compromised, the operator could observe or manipulate evaluation.

*Mitigation:* AWS Nitro Enclaves have no persistent storage, no external networking (except through the vsock proxy), and no operator access — even root on the parent instance cannot inspect enclave memory. The attestation document's PCR measurements are verified on-chain. A compromised enclave would produce a different PCR hash, detectable by any auditor. Additionally, Nitro Enclaves have been extensively audited and no practical side-channel attacks have been demonstrated on the platform.

**Model weight tampering:** The operator could load different model weights than claimed.

*Mitigation:* The EIF (Enclave Image File) includes model weights. The image hash is part of the attestation PCR measurements. Any change to weights produces a different attestation. The expected PCR values are published and verifiable by anyone.

**Stale evaluation:** AI models evaluate at a point in time. Arguments submitted late in the window may reference information the models haven't seen.

*Mitigation:* AI evaluation runs after the trade window closes, evaluating all arguments with current knowledge. Source grounding via Exa retrieval ensures claims are checked against live web sources, not just model training data. The evaluation window is 24 hours after trade close.

**API dependency (source retrieval):** The Exa search API is an external dependency that could manipulate retrieved sources.

*Mitigation:* Source retrieval is supplementary — it improves accuracy and evidence scores but is not required. If Exa is unavailable, evaluation proceeds ungrounded (same as a human evaluator without references). The per-claim verdicts are included in the transparency data so users can verify source quality.

### 6.4 Governance Override

If the AI panel cannot reach M-of-N consensus (models disagree significantly), the market enters **extended resolution**:

1. Trade window extends 48 hours (no new arguments, but existing positions can be adjusted)
2. A governance-appointed reviewer (TimelockGovernance, initially founder) reviews the arguments
3. Reviewer submits resolution with a public justification
4. 7-day appeal window: any participant can challenge the review by staking 2× the proposer bond, which escalates to full community vote (Kleros/UMA integration in Phase 3+)

This is the same escalation pattern from the challenge market architecture (§5: Three-Stage Resolution).

---

## 7. Settlement

> **Implementation status.** `settlePrivatePosition()` in `DebateMarket.sol:1331-1374` currently performs **attestation only** — it verifies the position-note ZK proof, records the nullifier, and stores `claimedWeight`, but does **not** transfer tokens. The comment at `DebateMarket.sol:1369-1370` marks token payout as Phase 4 (Flow Encryption). The math below describes the full design; Phase 2 ships only the attestation half.

### 7.1 Payout Math

After resolution, the winning argument is determined. Settlement follows:

**Winners** (hold positions on the winning argument):

```
payout_i = stake_i + (losing_pool × stake_i / winning_argument_total_stake)
```

Where `losing_pool = total_market_stake - winning_argument_total_stake`.

Winners receive their original stake plus a proportional share of all losing positions.

**Losers** (hold positions on any non-winning argument):

Forfeit their entire stake. Engagement tier is unaffected — losing a market position does not reduce reputation.

**Proposer bond:**

Returned if `unique_participants >= BOND_RETURN_THRESHOLD` (5 unique nullifiers). Forfeited to governance treasury otherwise.

### 7.2 Settlement Privacy

In Phase 1, settlement claims require revealing the nullifier and proving ownership of the stake record (existing pattern from `DebateMarket.claimSettlement()`). The claimant must be the original `submitter` address — which is the relayer's address.

This means the relayer must cooperate in settlement. The relayer holds no funds (the contract does), but the relayer's address is recorded as the submitter. The claim transaction must come from the same relayer.

*Mitigation:* The protocol operates its own relayer (same as the existing on-chain submission relayer). Users can also specify a designated claim address at trade time, encrypted in the ZK proof's witness data, which the contract accepts as an alternative claimant. This is a minor circuit extension.

In Phase 2 (shielded position pool), settlement is fully private — the trader proves note ownership via ZK proof and receives payout to a fresh address.

---

## 8. Integration with Communique

### 8.1 Data Model Extensions

**Convex schema additions** (`commons/convex/schema.ts`):

```typescript
debates: defineTable({
  // ... existing fields ...

  // Debate market fields
  marketStatus: v.string(), // 'inactive' | 'open' | 'trading' | 'resolving' | 'resolved'
  marketLiquidity: v.int64(), // LMSR b parameter (in staking token units)
  tradeDeadline: v.optional(v.number()),
  resolutionDeadline: v.optional(v.number()),

  // AI evaluation results (populated during resolution)
  aiScores: v.optional(v.any()), // { argumentIndex: { reasoning: 0.8, accuracy: 0.7, ... } }
  aiPanelConsensus: v.optional(v.number()), // M-of-N agreement ratio
  resolutionMethod: v.optional(v.string()), // 'ai_community' | 'governance_override' | 'community_appeal'
}).index("by_marketStatus", ["marketStatus"]),

debateArguments: defineTable({
  // ... existing fields ...

  // Market pricing (updated by event indexer each epoch)
  currentPrice: v.number(), // LMSR price [0, 1]
  priceHistory: v.optional(v.any()), // [{ epoch, price, volume }]
  positionCount: v.number(), // Unique position holders
}).index("by_debateId", ["debateId"]),
```

### 8.2 Template Card Integration

The `Template` type already has `hasActiveDebate?: boolean`. Extend with:

```typescript
interface Template {
  // ... existing fields ...

  // Debate signal (populated when hasActiveDebate is true)
  debate?: {
    debateId: string;
    leadingStance: 'SUPPORT' | 'OPPOSE' | 'AMEND';
    leadingPrice: number;        // 0.0 - 1.0
    leadingBodyPreview: string;  // First 140 chars of leading argument
    participantCount: number;
    deadline: Date;
    isResolved: boolean;
  };
}
```

### 8.3 Real-Time Updates

The debate signal updates every epoch (~3 seconds). Communique subscribes to events via:

1. **Event indexer** (existing The Graph subgraph) indexes `EpochSettled` events
2. **WebSocket push** from shadow-atlas to Communique frontend
3. **Optimistic UI** updates prices client-side between confirmed epochs

The template card polls the debate state every 30 seconds in the background. When a user opens the debate view, it switches to real-time WebSocket updates.

### 8.4 Debate View

The debate view is a full-page UI accessible from the template card. It shows:

1. **The proposition** (the template's `message_body`, read-only)
2. **Arguments** sorted by current price, with:
   - Stance badge (SUPPORT / OPPOSE / AMEND)
   - Current price (e.g., "62%")
   - Sparkline price history (last 24h)
   - Argument body (full text, expandable)
   - Amendment text (if AMEND)
   - Participant count and total stake
3. **Trade interface**: Buy/sell positions on any argument
4. **Submit argument**: Create a new argument (stance + body + optional amendment)
5. **Participation depth**: `unique_participants / jurisdiction_size_hint`

---

## 9. Contract Architecture

### 9.1 DebateMarket.sol

The existing `DebateMarket.sol` is extended with LMSR pricing and epoch-based batch execution. New contract surface:

```solidity
DebateMarket is Pausable, ReentrancyGuard, TimelockGovernance {

    // === Inherited from DebateMarket ===
    // districtGate, stakingToken, debates, arguments, stakeRecords
    // proposeDebate, submitArgument, claimSettlement, claimProposerBond
    // emergencyWithdraw, sqrt, tierMultiplier, deriveDomain

    // === LMSR State ===

    /// @notice LMSR quantities per argument: debateId => argumentIndex => q_i
    mapping(bytes32 => mapping(uint256 => int256)) public lmsrQuantities;

    /// @notice LMSR liquidity parameter per debate
    mapping(bytes32 => uint256) public lmsrLiquidity;

    /// @notice Current epoch per debate
    mapping(bytes32 => uint256) public currentEpoch;

    /// @notice Commitments per epoch: debateId => epoch => commitment[]
    mapping(bytes32 => mapping(uint256 => bytes32[])) public epochCommitments;

    /// @notice Epoch duration in seconds (default: one Scroll block)
    uint256 public constant EPOCH_DURATION = 3;

    // === Commit-Reveal Trading ===

    /// @notice Submit a trade commitment for the current epoch
    /// @param debateId Market to trade in
    /// @param commitment H(argument_index, direction, weighted_amount, nonce)
    /// @param signer, proof, publicInputs, verifierDepth, deadline, signature
    ///        — same three-tree proof parameters as submitArgument
    function commitTrade(
        bytes32 debateId,
        bytes32 commitment,
        address signer,
        bytes calldata proof,
        uint256[31] calldata publicInputs,
        uint8 verifierDepth,
        uint256 deadline,
        bytes calldata signature
    ) external;

    /// @notice Reveal a trade commitment from the previous epoch
    /// @param debateId Market to trade in
    /// @param argumentIndex Which argument to trade
    /// @param direction 0 = buy, 1 = sell
    /// @param weightedAmount sqrt(stake) * 2^tier (verified against ZK proof)
    /// @param nonce Random nonce used in commitment
    /// @param stakeAmount Raw stake amount (for financial settlement)
    function revealTrade(
        bytes32 debateId,
        uint256 argumentIndex,
        uint8 direction,
        uint256 weightedAmount,
        bytes32 nonce,
        uint256 stakeAmount
    ) external;

    /// @notice Execute all revealed trades for a completed epoch
    /// @dev Applies batch LMSR update, publishes new prices
    /// @param debateId Market to settle
    /// @param epoch Epoch number to execute
    function executeEpoch(bytes32 debateId, uint256 epoch) external;

    // === LMSR Views ===

    /// @notice Get current LMSR price for an argument
    function getPrice(bytes32 debateId, uint256 argumentIndex)
        external view returns (uint256 price); // 18-decimal fixed point, 0 to 1e18

    /// @notice Get all argument prices for a debate
    function getPrices(bytes32 debateId)
        external view returns (uint256[] memory prices);

    // === Resolution ===

    /// @notice Submit AI evaluation panel results (M-of-N signed attestation)
    /// @param debateId Market to resolve
    /// @param argumentScores Array of AI scores per argument (18-decimal fixed point)
    /// @param signatures M-of-N signatures from registered evaluation models
    function submitAIEvaluation(
        bytes32 debateId,
        uint256[] calldata argumentScores,
        bytes[] calldata signatures
    ) external;

    /// @notice Finalize resolution after AI evaluation + community signal
    /// @param debateId Market to resolve
    function resolveMarket(bytes32 debateId) external;

    // === Events ===

    event TradeCommitted(bytes32 indexed debateId, uint256 indexed epoch, bytes32 commitment);
    event TradeRevealed(bytes32 indexed debateId, uint256 indexed epoch, uint256 argumentIndex, uint8 direction, uint256 weightedAmount);
    event EpochExecuted(bytes32 indexed debateId, uint256 indexed epoch, uint256[] newPrices);
    event AIEvaluationSubmitted(bytes32 indexed debateId, uint256[] argumentScores, uint256 consensusRatio);
    event MarketResolved(bytes32 indexed debateId, uint256 winningArgumentIndex, uint256 aiScore, uint256 communityScore, uint256 finalScore);
}
```

### 9.2 TEE Evaluation Registry

A separate contract manages the TEE-attested evaluation pipeline:

```solidity
TEEEvaluationRegistry is TimelockGovernance {

    /// @notice Expected PCR0 (enclave image hash) for valid evaluations
    bytes32 public expectedPCR0;

    /// @notice Expected PCR1 (kernel hash) for valid evaluations
    bytes32 public expectedPCR1;

    /// @notice Expected PCR2 (application hash) for valid evaluations
    bytes32 public expectedPCR2;

    /// @notice Authorized evaluation submitter (enclave's ephemeral signer)
    mapping(address => bool) public authorizedSubmitters;

    /// @notice Resolution weight for AI vs community (18-decimal, 0 to 1e18)
    uint256 public aiWeight; // default 0.4e18

    /// @notice Verify a Nitro attestation document's PCR measurements
    function verifyAttestation(bytes calldata attestationDoc) external view returns (bool);

    /// @notice Submit evaluation with attestation proof
    function submitEvaluation(
        bytes32 debateId,
        uint256[] calldata argumentScores,
        bytes32 attestationHash     // keccak256(attestationDoc)
    ) external;

    // All mutations via 7-day timelock (inherited from TimelockGovernance)
    function proposePCRUpdate(bytes32 pcr0, bytes32 pcr1, bytes32 pcr2) external onlyGovernance;
    function executePCRUpdate() external;
    function proposeWeightChange(uint256 newAiWeight) external onlyGovernance;
    function executeWeightChange() external;
}
```

The registry stores expected PCR measurements (hashes of the enclave image, kernel, and application). When the enclave submits evaluation results, the attestation hash is recorded on-chain. Anyone can fetch the full attestation document from the evaluation API and verify the PCR measurements match the registry — proving the evaluation was computed by the expected code with the expected model weights.

### 9.3 Interaction with Existing Contracts

| Contract | Change | Notes |
|---|---|---|
| DistrictGate | None | `verifyThreeTreeProof()` called for every trade commitment |
| NullifierRegistry | None | Epoch-scoped nullifiers use derived action domains |
| DistrictRegistry | None | Jurisdiction verification unchanged |
| VerifierRegistry | None | Depth-based verifier selection unchanged |
| CampaignRegistry | None | Debate participation recorded via existing `recordParticipation()` |
| DebateMarket | **Extended** | `DebateMarket.sol` gains LMSR pricing, commit-reveal epochs, AI resolution |

---

## 10. Epoch Mechanics

### 10.1 Epoch Lifecycle

```
Epoch N                          Epoch N+1
├─ commit phase ──────────┤├─ reveal for N ─┤├─ execute N ─┤├─ commit phase ─── ...
│                          │                  │              │
│  traders submit          │  traders reveal   │  LMSR batch  │  next round
│  H(trade, nonce)         │  preimages        │  update      │
│                          │  verified against │  new prices  │
│                          │  commitments      │  published   │
```

**Epoch duration:** Configurable per market. Default is one Scroll block (~3 seconds). For lower-frequency markets, governance can set longer epochs (e.g., 1 minute, 5 minutes) to reduce gas costs.

**Reveal window:** Traders have one full epoch to reveal. Unrevealed commitments expire — the commitment fee (gas only, no stake lost) is the only cost of non-reveal.

**Execute:** Anyone can call `executeEpoch()` after the reveal window closes. This is a gas-paid public good (similar to Chainlink keeper patterns). The protocol's relayer calls it by default.

### 10.2 Gas Optimization

LMSR state updates require exponentiation (`exp(q_i / b)`), which is expensive on-chain. Optimizations:

1. **Fixed-point math:** All LMSR calculations use 18-decimal fixed-point arithmetic via PRB-Math `SD59x18` (`LMSRMath.sol`). No floating point.
2. **Incremental updates (current):** `executeEpoch()` updates only the `q_i` values that changed during the epoch and recomputes prices in the same call.
3. **Off-chain computation with on-chain verification (Phase 2, proposed):** A relayer could compute new prices off-chain and submit them with a proof of correctness, reducing on-chain work to a hash check. Not implemented — current `DebateMarket.executeEpoch()` recomputes prices on-chain every epoch.
4. **Scroll L2 gas:** SSTORE on Scroll is ~200 gas (vs ~20,000 on L1). Epoch execution with 10 trades and 5 arguments: estimated ~50,000 gas on Scroll (~$0.01 at current gas prices).

---

## 11. Phased Deployment

### Phase 1: Commit-Reveal Batch LMSR (deployable now)

**What ships:**
- `DebateMarket.sol` with commit-reveal trading and batch LMSR
- Relayer-submitted trades: traders reach the contract via the protocol relayer, so the `msg.sender` recorded in `commitTrade()`/`revealTrade()` is the relayer, not the trader's wallet. Trader-to-relayer linkability remains a property of the off-chain submission path, not an on-chain guarantee.
- ZK membership + tier proof for every trade (identity private)
- Template card debate signal on Communique
- Debate view with real-time prices

**Privacy properties:**
- Identity: private (ZK proof)
- Wallet address: private (relayer submission)
- Trade intent: private during commit phase
- Trade amount: **revealed at execution** (necessary for LMSR state update)
- Position: **derivable from trade history** (observable trades → reconstructible positions)

**New infrastructure:** None. Uses existing Scroll contracts, relayer, three-tree circuit, The Graph subgraph.

### Phase 2: Shielded Position Pool (2-4 weeks after Phase 1)

**What ships:**
- Position notes: `Poseidon(argument_index, amount, tier, randomness)` committed to a position Merkle tree
- Noir circuit extension (~100-200 constraints) proving note ownership
- Private settlement: claim payout via ZK proof of winning note, no trade history needed

**Privacy properties (upgrade from Phase 1):**
- Trade amount: **private** (positions are note commitments, not visible amounts)
- Position: **private** (note ownership proven in ZK, never revealed)

**New infrastructure:** Position Merkle tree (same pattern as Trees 1-3). Noir circuit extension.

### Phase 3: Flow-Encrypted Batches (1-3 months after Phase 2)

**What ships:**
- ElGamal-encrypted trade intents (individual amounts hidden even during execution)
- Homomorphic aggregation of encrypted trades per epoch
- Threshold decryption of batch aggregates only
- Committee: TimelockGovernance guardians serve as threshold decryption participants

**Privacy properties (upgrade from Phase 2):**
- Trade amount: **private** (encrypted, never individually decrypted)
- Aggregate flow: **visible** (threshold-decrypted batch total, necessary for LMSR update)

**New infrastructure:** Threshold key management, ElGamal over BN254, DKG ceremony.

---

## 12. Failure Modes

### 12.1 Thin Markets

A debate market with 2 participants produces a valid resolution but a weak signal. The `participation_depth` metric surfaces this: `2 / 700,000 = 0.000003`. Communique displays: "2 participants in this debate" — the institution and the community decide how much weight to give it.

*Not a bug.* The protocol does not claim thin markets are authoritative. It surfaces the signal with full context.

### 12.2 Evaluation Integrity Failure

If the TEE evaluation is compromised (enclave side-channel, model weights tampered), the `α = 0.4` weight means the community signal (60%) can override. A completely wrong evaluation flips the outcome only if the community signal is close to 50/50. If the community signal is decisive (e.g., 80/20), the AI cannot override it.

The attestation hash on-chain enables post-hoc auditing. Anyone can fetch the full Nitro attestation document and verify the PCR measurements against the expected values in the TEEEvaluationRegistry. A mismatched PCR hash is grounds for appeal.

Governance can reduce `α` to 0 in an emergency, falling back to pure community resolution (the existing DebateMarket behavior).

### 12.3 Wealthy Attackers

A well-funded attacker buys massive positions to manipulate prices. The `sqrt(stake)` weighting limits this: $10,000 stake gets √10000 = 100 weighted shares. A Tier 4 Pillar's $2 stake gets √2 × 16 = 22.6 weighted shares. The attacker needs $10,000 to match the price impact of ~20 Pillars staking $2 each.

Combined with the AI evaluation (which scores argument quality independent of stake), a wealthy attacker can move the price but cannot win resolution unless their argument is actually good.

### 12.4 Frivolous Debate

Someone opens markets on every template to create noise. The proposer bond ($1 minimum) is the anti-spam mechanism. At $1, opening 100 frivolous markets costs $100. If none attract 5 participants, all bonds are forfeited to governance.

If this is insufficient, governance can increase `MIN_PROPOSER_BOND` via timelock. The cost scales with spam volume; the revenue goes to the protocol treasury.

### 12.5 Debate as Censorship

A political faction systematically contests every template from the opposing side, creating "disputed" signals that suppress sending.

*Mitigation:* The debate signal on the template card shows the *leading argument*, not just "disputed." If every debate's leading argument is SUPPORT at 90%+, the signal is "this template was challenged and the challenge failed" — which is actually a credibility boost. Frivolous debate backfires.

Additionally, the challenge market architecture's Section 6 solutions apply: blind review (depoliticized arguments), challenger cooldowns, and asymmetric cost scaling for repeated debates.

---

## 13. What's New vs What Exists

| Component | Status | Work |
|---|---|---|
| Three-tree proof verification | EXISTS | No changes |
| Nullifier double-action prevention | EXISTS | Epoch-scoped domain derivation (pure function, no contract change) |
| Engagement tier derivation | EXISTS | Add "debate" + "trade" to action categories in Shannon diversity |
| 24-slot jurisdiction scoping | EXISTS | No changes |
| Poseidon2 commitments | EXISTS | No changes |
| Relayer for on-chain submission | EXISTS | Extend for trade commitment submission |
| The Graph subgraph | EXISTS | Add `EpochExecuted`, `MarketResolved` event handlers |
| `Template.hasActiveDebate` | EXISTS | Populate from market state |
| `debates` + `debateArguments` Convex tables | EXISTS | Add market pricing fields (§8.1) |
| `DebateMarket.sol` | EXISTS → EXTENDED | Add LMSR pricing, commit-reveal epochs, AI resolution |
| `TEEEvaluationRegistry.sol` | NEW | TEE attestation verification + resolution weight governance |
| Commit-reveal batch trading | NEW | Epoch-based trade commitment and reveal |
| LMSR pricing engine | NEW | Logarithmic market scoring rule (on-chain, fixed-point) |
| TEE evaluation pipeline | NEW | Nitro Enclave multi-model scoring, on-chain attestation hash |
| Debate signal UI | NEW | Template card integration, debate view, price sparklines |
| Position note circuit (Phase 2) | NEW | Noir circuit for shielded position pool |
| Flow encryption (Phase 3) | NEW | ElGamal + threshold decryption infrastructure |

---

## 14. Verification

1. Deploy `DebateMarket.sol` to local Anvil fork alongside existing DistrictGate, NullifierRegistry, mock ERC-20
2. Open a market on a template — verify bond transfer, LMSR initialization, epoch counter
3. Submit 3 arguments — verify LMSR state expansion, initial prices sum to 1
4. Commit trades from 5 identities across 2 epochs — verify commitments stored, nullifiers enforced per epoch
5. Reveal trades — verify preimage matches commitment, stake transferred
6. Execute epochs — verify LMSR prices update correctly, batch averaging works
7. Verify anti-plutocracy: Tier 4 at $2 moves price more than Tier 1 at $100
8. Submit AI evaluation — verify M-of-N signature threshold, scores stored
9. Resolve market — verify combined score (`α × ai + (1-α) × community`), winner determined
10. Claim settlement — verify proportional payout from losing pool
11. Proposer bond: ≥ 5 participants → returned, < 5 → forfeited
12. Double-trade within epoch: same nullifier → rejected
13. Cross-epoch trades: different nullifiers → accepted, positions unlinkable
14. Dynamic argument: submit argument during trade window → LMSR rebalances, prices still sum to 1
15. AI panel disagreement: models diverge → market enters extended resolution
16. Governance override: AI consensus fails → reviewer submits resolution with justification
17. Emergency withdrawal: 30 days post-deadline, unresolved → original stake returned
18. Relayer submission: verify trade originates from relayer address, not trader
19. Debate signal: verify Communique template card displays leading argument + price
20. Amendment flow: winning argument with AMEND stance → template pipeline receives amendment text
