# Debate Market: Implementation Plan

> **Date:** 2026-02-24
> **Spec:** [`specs/DEBATE-MARKET-SPEC.md`](../../specs/DEBATE-MARKET-SPEC.md)
> **Status:** Planning — no implementation started
> **Execution Model:** Implementation→Review cycles with agent teams. Each cycle produces code, then manual review resolves gaps.

---

## 1. What Exists

### Contract Layer

| Component | File | Status |
|-----------|------|--------|
| `DebateMarket.sol` | `contracts/src/DebateMarket.sol` (733 lines, with interface) | One-shot staking: propose, argue, co-sign, resolve, settle. 107 tests. |
| `sqrt()` | Line 691 | Babylonian method, integer-only, ~500 gas. Tested. |
| `tierMultiplier()` | Line 706 | Tiers 1-4 return 2^tier. Tier 0 rejected. |
| `deriveDomain()` | Line 676 | `keccak256(baseDomain, "debate", propositionHash) % BN254_MODULUS`. Composable with epoch numbers. |
| Settlement | Line 487 | `payout = stake + (losingPool * stake / winnerTotal)`. Solvency proven. |
| `DistrictGate.sol` | `contracts/src/DistrictGate.sol` | Three-tree ZK proof verification (31 public inputs). No changes needed. |
| `NullifierRegistry.sol` | `contracts/src/NullifierRegistry.sol` | Epoch-scoped nullifiers via derived domains. No changes needed. |

**Existing contract function signatures** (extend, not replace):
```
proposeDebate(bytes32, uint256, uint256, bytes32, uint256) → bytes32
submitArgument(bytes32, Stance, bytes32, bytes32, uint256, address, bytes, uint256[31], uint8, uint256, bytes)
coSignArgument(bytes32, uint256, uint256, address, bytes, uint256[31], uint8, uint256, bytes)
resolveDebate(bytes32)
claimSettlement(bytes32, bytes32)
claimProposerBond(bytes32)
sweepForfeitedBond(bytes32)
emergencyWithdraw(bytes32, bytes32)
getDebateState(bytes32) → (DebateStatus, uint256, uint256, uint256, uint256)
getArgumentScore(bytes32, uint256) → uint256
getParticipationDepth(bytes32) → (uint256, uint256)
```

**Existing structs:**
```
Debate { propositionHash, actionDomain, deadline, argumentCount, uniqueParticipants, jurisdictionSizeHint, totalStake, winningArgumentIndex, winningStance, winningBodyHash, winningAmendmentHash, status, proposer, proposerBond, bondClaimed }
Argument { stance, bodyHash, amendmentHash, stakeAmount, engagementTier, weightedScore }
StakeRecord { argumentIndex, stakeAmount, engagementTier, claimed, submitter }
```

**Existing events:**
```
DebateProposed(debateId, actionDomain, propositionHash, deadline, baseDomain)
ArgumentSubmitted(debateId, argumentIndex, stance, bodyHash, engagementTier, weight)
CoSignSubmitted(debateId, argumentIndex, engagementTier, weight)
DebateResolved(debateId, winningArgumentIndex, winningStance, winningScore, uniqueParticipants, jurisdictionSizeHint)
SettlementClaimed(debateId, nullifier, payout)
ProposerBondReturned(debateId, bondAmount)
ProposerBondForfeited(debateId, bondAmount)
EmergencyWithdrawn(debateId, nullifier, amount)
ContractPaused(caller), ContractUnpaused(caller)
```

**Existing constants:** `MIN_DURATION=72h`, `MAX_DURATION=30d`, `BOND_RETURN_THRESHOLD=5`, `MIN_PROPOSER_BOND=1e6`, `MIN_ARGUMENT_STAKE=1e6`, `MAX_ARGUMENTS=500`, `EMERGENCY_WITHDRAW_DELAY=30d`, `BN254_MODULUS`

**Existing imports:** `Pausable`, `ReentrancyGuard`, `IERC20`, `SafeERC20`, `TimelockGovernance`

**Foundry config:** Solidity 0.8.28, EVM paris, optimizer 200 runs, via_ir=true, `skip = ["HonkVerifier"]`

### Frontend Layer (Communique)

| Component | File | Status |
|-----------|------|--------|
| DebateSurface | `src/lib/components/debate/DebateSurface.svelte` | Built |
| ActiveDebatePanel | `src/lib/components/debate/ActiveDebatePanel.svelte` | Built |
| DebateMetrics | `src/lib/components/debate/DebateMetrics.svelte` | Built |
| DebateProofGenerator | `src/lib/components/debate/DebateProofGenerator.svelte` | Built |
| DebateModal | `src/lib/components/debate/DebateModal.svelte` | Built |
| Debate store | `src/lib/stores/debateState.svelte.ts` | Svelte 5 runes: `DebateData`, `ArgumentData`, `Stance` types. `createDebateState()` factory. |
| SSE utility | `src/lib/server/sse-stream.ts` | `createSSEStream()` + `SSE_HEADERS`. Uses `ReadableStream`. |
| API: create | `src/routes/api/debates/create/+server.ts` | POST |
| API: by-template | `src/routes/api/debates/by-template/[templateId]/+server.ts` | GET |
| API: arguments | `src/routes/api/debates/[debateId]/arguments/+server.ts` | GET, POST |
| API: cosign | `src/routes/api/debates/[debateId]/cosign/+server.ts` | POST |
| API: resolve | `src/routes/api/debates/[debateId]/resolve/+server.ts` | POST |
| API: claim | `src/routes/api/debates/[debateId]/claim/+server.ts` | POST |
| Prisma: Debate | `prisma/schema.prisma` lines 892-935 | Fields: `debate_id_onchain`, `action_domain`, `proposition_hash/text`, `deadline`, `jurisdiction_size`, `status`, `argument_count`, `unique_participants`, `total_stake`, `winning_*`, `proposer_address`, `proposer_bond` |
| Prisma: DebateArgument | `prisma/schema.prisma` lines 937-966 | Fields: `argument_index`, `stance`, `body`, `body_hash`, `amendment_*`, `stake_amount`, `engagement_tier`, `weighted_score`, `total_stake`, `co_sign_count` |

**Missing from Prisma:** `market_liquidity`, `current_prices` (JSON), `current_epoch`, `trade_deadline`, `resolution_deadline`, `market_status` (on Debate). `current_price`, `price_history` (JSON), `position_count` (on DebateArgument).

**Missing from store:** LMSR price state, epoch phase tracking, trade flow state (commit/reveal), SSE subscription lifecycle.

### ZK Circuits

| Component | Status |
|-----------|--------|
| Three-tree circuit | 785 lines Noir, 31 public inputs. Production-ready. |
| Epoch-scoped nullifiers | **Zero circuit changes needed.** Client-side `deriveDomain(marketDomain, epochNumber)` only. |
| `sqrt(stake) * 2^tier` proving | Not in circuit. Phase 1: off-chain computation, contract enforcement. Phase 2: ~200-constraint debate_weight circuit. |

**Noir/Barretenberg versions in use:**
- `@noir-lang/noir_js`: 1.0.0-beta.16 (`packages/noir-prover/package.json`)
- `@aztec/bb.js`: 2.1.8 (`packages/noir-prover/package.json`)
- Noir compiler: 1.0.0-beta.19 (latest as of Feb 2026)
- Barretenberg: v0.87.0 (latest)
- UltraHonk backend (production-grade)

### Infrastructure

| Component | Status |
|-----------|--------|
| Shadow-atlas serving API | Operational (tree serving, proofs, registration, engagement). No debate endpoints. |
| Chain scanner | Monitors `ThreeTreeProofVerified` events. Needs debate market events. |
| The Graph subgraph | Indexes proofs, campaigns, nullifiers. Needs debate entities + event handlers. |
| Relayer | Exists for proof submission. Needs extension for trade commitments. |

---

## 2. Critical Gaps

### Gap 1: LMSR Pricing Engine (Contract)

**What:** `DebateMarket.sol` has no LMSR. Needs `exp()`, price computation, state tracking.

**Decision: On-chain via PRBMath.**
- Gas is effectively free on Scroll (~$0.003 per `executeEpoch` at current prices)
- PRBMath `exp()`: ~1,800 gas/call, 18-decimal fixed-point, audited
- Off-chain computation saves ~$0.004/epoch — not worth the trust assumptions

**New state:**
```solidity
mapping(bytes32 => mapping(uint256 => int256)) public lmsrQuantities;  // q_i per argument
mapping(bytes32 => uint256) public lmsrLiquidity;                      // b parameter
mapping(bytes32 => uint256) public currentEpoch;
mapping(bytes32 => mapping(uint256 => bytes32[])) public epochCommitments;
```

**New functions:** `commitTrade()`, `revealTrade()`, `executeEpoch()`, `getPrice()`, `getPrices()`

**Overflow guard:** If `q_i / b > 100`, saturate (argument price approaches 1.0). PRBMath handles this natively.

### Gap 2: Commit-Reveal Epoch Trading (Contract)

**What:** No commit-reveal pattern exists. Trades are currently immediate.

**New flow:**
1. Commit: `H(argument_index, direction, weighted_amount, nonce)` — stored on-chain
2. Reveal: Preimage submitted next epoch, verified against commitment
3. Execute: Batch-apply all valid reveals, update LMSR state, emit `EpochExecuted`

**Privacy properties:** Trade intent hidden during commit. Trade amounts revealed at execution (Phase 1). Position privacy via shielded notes (Phase 2).

### Gap 3: AI Evaluation Pipeline (New Service)

**What:** Nothing exists. Spec requires M-of-N multi-model scoring.

**Decision: Defer to Phase 3 (after position privacy).** Privacy ships first. Launch with governance-triggered resolution (existing `resolveDebate()` pattern). AI panel is additive — governance resolution is adequate for Phase 1 civic debates.

**When built:**
- `AIEvaluationRegistry.sol` — model signer registry, quorum logic
- Evaluation service — Claude + GPT-4 + Gemini scoring with dimension weights
- `submitAIEvaluation()` on DebateMarket — signed attestation of scores
- Combined resolution: `final = 0.4 * ai + 0.6 * community`

### Gap 4: Real-Time Price Feeds (Infrastructure)

**What:** No WebSocket or SSE for live prices. Template card has no price signal.

**Build:** Shadow-atlas SSE endpoint → Communique subscribes per debate via `EventSource`. Existing `sse-stream.ts` utility reused. HTTP polling (30s) on template card browse view. SSE activates only on debate detail view.

### Gap 5: Epoch Executor / Keeper (Infrastructure)

**What:** Nobody calls `executeEpoch()`. Needs automated execution.

**Decision: Relayer double-duty.** Existing relayer polls active markets every epoch, calls `executeEpoch()` when reveal window closes. Cost at 5-minute epochs over a 7-day market: ~$0.014 total. Permissionless — anyone can call `executeEpoch()` if relayer is down.

### Gap 6: Frontend Trading UI (Communique)

**What:** 9 debate components exist but none handle trading (buy/sell positions, price display, epochs).

**New components:**
- `MarketPriceBar` — horizontal SUPPORT/OPPOSE/AMEND percentages
- `TradePanel` — stake input, price impact preview, commit flow
- `EpochPhaseIndicator` — commit vs reveal countdown
- `DebateContestationCard` — for template card (leading stance + price)

**Schema additions to Prisma:** `market_status`, `market_liquidity`, `current_prices`, `current_epoch`, `trade_deadline`, `resolution_deadline`, `ai_scores`

### Gap 7: Subgraph Event Handlers (Indexer)

**What:** No debate market entities or event handlers.

**New entities:** `Debate`, `DebateArgument` (with prices), `Epoch`, `AIEvaluation`
**New handlers:** `handleEpochExecuted`, `handleMarketResolved`, `handleTradeCommitted`, `handleTradeRevealed`

---

## 3. Decision Boundaries

### Decided

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | LMSR computation | On-chain (PRBMath) | Gas is ~$0.003/epoch on Scroll. Off-chain saves fractions of a penny. Not worth trust assumptions. |
| 2 | Contract architecture | Extend `DebateMarket.sol` | Not a new contract. Same contract gains LMSR, epochs, AI resolution. |
| 3 | Epoch nullifiers | Client-side derivation only | `deriveDomain(market, epoch)` in TypeScript. Zero contract/circuit changes. |
| 4 | Phase 1 resolution | Governance-triggered | Existing `resolveDebate()` picks highest weighted_score. AI panel deferred to Phase 3. |
| 5 | Epoch executor | Relayer double-duty | No separate keeper service. Relayer already submits proofs; extend to execute epochs. |
| 6 | Position privacy (Phase 1) | Commit-reveal + relayer | Identity private (ZK). Wallet unlinkable (relayer). Trade amounts revealed at execution. Acceptable for Phase 1. |
| 7 | Epoch duration | **5 minutes**, governance-tunable | Safest for client-side ZK proof generation (5-30s browser). Full 5min window for: prove → encrypt → relay → commit. Reveal window equally comfortable. Keeper cost negligible (~$0.002/day). Can tighten to 60s via governance when infra proves stable. Never needs 3s — civic debates are not DeFi arbitrage. |
| 8 | Liquidity parameter `b` | **Jurisdiction-scaled** at creation: `b = verified_members × base_per_member` | Principled: matches VOTER's jurisdiction-aware, engagement-weighted design. Large district (700K members) → deep liquidity, need broad consensus to move prices. Small rural district (200 members) → responsive liquidity, each participant's conviction matters. Set once at market creation from the 24-slot district array. No mid-market repricing. Proposer bond remains as anti-spam floor, independent of `b`. |
| 9 | Phase ordering | **Core market → Position privacy → AI resolution** | Privacy is a first-class concern in VOTER Protocol. Shielded positions ship before AI evaluation. Governance-triggered resolution is the interim — adequate for Phase 1 civic debates. AI panel is additive, not blocking. |
| 10 | Weighted amount proving | **Phased trustless**: contract verification (Phase 1) → in-circuit (Phase 2) | Phase 1: contract recomputes `sqrt(stakeAmount) * tierMultiplier(tier)` from visible inputs. Both `tier` (from ZK public inputs) and `stakeAmount` (from token transfer) are trustlessly available to the contract. No trust regression. Phase 2 (shielded positions): stake amount hidden inside note commitment. Contract can no longer verify. `debate_weight` Noir circuit (~200 constraints) proves weighted amount in ZK. In-circuit proving becomes mandatory exactly when position privacy demands it. |
| 11 | Frontend price updates | **SSE** for debate view, **HTTP polling** (30s) for browse | SSE is one-directional (server → client) — exactly the debate price use case. Communique already has `sse-stream.ts` utility. No need for bidirectional WebSocket complexity. HTTP polling on template card browse view (30s interval) avoids unnecessary connections. SSE activates only when user opens debate detail. |

---

## 4. Gas Reality (February 2026)

| Metric | Value |
|--------|-------|
| ETH price | ~$1,860 |
| Ethereum L1 | 0.04 gwei |
| Scroll L2 execution | ~0.01 gwei |
| Cost per gas unit on Scroll | $0.0000000186 |

| Operation | Gas (est.) | Cost |
|-----------|-----------|------|
| proposeDebate | 45,000 | $0.004 |
| submitArgument | 85,000 | $0.005 |
| commitTrade | 25,000 | $0.002 |
| revealTrade | 45,000 | $0.003 |
| executeEpoch (5 args, 10 trades) | 90,000 | $0.007 |
| resolveMarket | 35,000 | $0.003 |
| claimSettlement | 65,000 | $0.004 |
| **Full market lifecycle** | **~1.4M** | **$0.08-0.13** |

L1 data fees (blob-based) add ~$0.001-0.005 per transaction. Total lifecycle including L1 fees: **under $0.20**.

The proposer bond ($1 minimum) is 5-10x the entire gas cost of the market.

---

## 5. Landscape Research (February 2026)

Research conducted across 4 parallel agent teams. Findings recorded here to inform implementation cycles.

### 5.1 PRBMath + Scroll Compatibility

| Finding | Detail | Status |
|---------|--------|--------|
| PRBMath version | **v4.1.0** (latest stable). Install: `forge install PaulRBerg/prb-math@release-v4` | Ready |
| Type system | Use **SD59x18** (signed), not UD60x18. LMSR intermediates go negative (`q_i` can be negative after opposing trades). Import: `import { SD59x18, sd, intoInt256, exp, ln } from "prb-math/SD59x18.sol"` | Decision recorded |
| `exp()` gas | ~2,263 gas avg (benchmarked). `exp(sd(1e18))` ≈ 2.718e18. | Verified |
| `ln()` gas | ~4,724 gas avg (benchmarked). `ln(sd(2.718e18))` ≈ 1e18. | Verified |
| `exp()` overflow | Reverts if input > ~133.08e18 (≈ `exp(133)` exceeds int256 range). For LMSR: `q_i / b > 133` causes revert. Saturation needed. | Guard needed |
| Scroll compatibility | No issues. PRBMath is pure Solidity math. Scroll (Type 2 zkEVM) is bytecode equivalent. EVM paris supported. Cancun opcodes available. | Confirmed |
| Existing LMSR implementations | **None in modern Solidity.** Gnosis's is Solidity 0.5 with raw fixed-point. PRBMath LMSR would be novel. | Novel work |
| Alternative: Solady FixedPointMathLib | 10-20% cheaper gas, no type safety. PRBMath chosen for safety + readability in a financial contract. | Decision: PRBMath |
| Foundry compatibility | PRBMath v4 works with forge, Solidity 0.8.28, optimizer 200 runs, via_ir. No known issues. | Confirmed |

**LMSR cost function implementation pattern:**
```solidity
import { SD59x18, sd, exp, ln, intoInt256 } from "prb-math/SD59x18.sol";

// C(q) = b * ln(Σ exp(q_i / b))
// Price: p_i = exp(q_i / b) / Σ exp(q_j / b)
// Guard: if q_i / b > 100, saturate to avoid approaching exp overflow at 133
```

### 5.2 Noir / Barretenberg Toolchain

| Finding | Detail | Status |
|---------|--------|--------|
| Noir version | **1.0.0-beta.19** (latest). Breaking changes from 0.30.x used in initial dev. | Migration notes below |
| Barretenberg | **v0.87.0**. UltraHonk still recommended backend. | Current |
| VOTER's bb.js | @aztec/bb.js@**2.1.8**, @noir-lang/noir_js@**1.0.0-beta.16** | Pinned in package.json |
| bb.js alignment | Some beta.19 docs show bb.js@3.0.0-nightly. VOTER's 2.1.8 works with beta.16. Phase 2 circuits may need version bump. | Watch for Phase 2 |
| Breaking: artifacts | beta.17+ uses **msgpack-compact** format. `.json` circuit artifacts → binary msgpack. Circuit compilation pipeline needs update if recompiling. | Phase 2 concern |
| Breaking: unconstrained | `unsafe {}` blocks now required around unconstrained function calls. Existing circuits need update at recompile. | Phase 2 concern |
| Breaking: Nargo.toml | `compiler_version` field now **mandatory**. Must match installed noirup version. | Phase 2 concern |
| sqrt in Noir | **No stdlib function.** Pattern: unconstrained compute → constrain. `unsafe { let root = unconstrained_sqrt(x); } assert(root * root == x);` ≈ **1 constraint**. Efficient. | Phase 2 pattern ready |
| Mobile OOM risk | iPhone Safari may OOM on circuits >15K constraints. Phase 2 `position_note` circuit at ~11.1K is within budget but close. Need testing. | Phase 2 risk |

**Phase 2 Noir sqrt pattern (for `debate_weight` circuit):**
```noir
unconstrained fn unconstrained_sqrt(x: Field) -> Field { /* Newton's method off-circuit */ }

fn main(stake: Field, tier: u8) -> pub Field {
    let root = unsafe { unconstrained_sqrt(stake) };
    assert(root * root == stake); // 1 constraint
    let multiplier = 1 << tier;   // 2^tier
    root * multiplier             // weighted_amount
}
```

### 5.3 The Graph + SSE on Scroll

| Finding | Detail | Status |
|---------|--------|--------|
| The Graph on Scroll | Supported. **No issuance rewards** — indexer reliability risk. | Confirmed |
| Alternatives | **Envio HyperIndex** (Rust, fast sync, free tier). **Goldsky** (managed, Mirror pipelines). Both support Scroll. | Backup options |
| Recommendation | Start with The Graph (existing subgraph infrastructure). Switch to Envio if indexer reliability issues. | Decision recorded |
| SvelteKit SSE | Works natively via `ReadableStream` in `+server.ts` handlers. | Ready |
| Cloudflare Pages SSE | Needs **`TransformStream`** instead of `ReadableStream` (Cloudflare Workers runtime constraint). Must add `X-Accel-Buffering: no` and `cf-no-buffer: 1` headers. Prefer POST over GET (avoids proxy buffering). | Workaround documented |
| Communique SSE utility | `src/lib/server/sse-stream.ts` currently uses `ReadableStream`. **Needs TransformStream refactor** for Cloudflare Pages production deployment. Dev server (Vite) works with ReadableStream. | Fix in Cycle 1.3 |
| sveltekit-sse library | Available but unnecessary — `createSSEStream` utility already exists, just needs the TransformStream fix. | Not needed |

**SSE TransformStream fix for Cloudflare Pages:**
```typescript
// Current (works in dev, not Cloudflare Pages):
const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });

// Required (works everywhere):
const { readable, writable } = new TransformStream();
const writer = writable.getWriter();
// + headers: { 'X-Accel-Buffering': 'no', 'cf-no-buffer': '1' }
```

### 5.4 Codebase Inventory (Exact Locations)

**Contract test patterns** (`contracts/test/DebateMarket.t.sol`):
- `MockDistrictGate` — stub that accepts all proofs, records nullifiers
- `MockERC20` — mint/approve pattern for test stakes
- `setUp()` — deploys DebateMarket with mocks, mints tokens, approves
- Public input array: `publicInputs[26] = nullifier`, `publicInputs[27] = actionDomain`, `publicInputs[30] = engagementTier`

**Deploy script pattern** (`contracts/script/DeployScrollMainnet.s.sol`):
- 8-contract deployment sequence with deterministic ordering
- `vm.startBroadcast()` / `vm.stopBroadcast()` pattern
- Constructor args passed from environment variables

**Communique debate store types** (`src/lib/stores/debateState.svelte.ts`):
```typescript
type Stance = 'SUPPORT' | 'OPPOSE' | 'AMEND';
interface ArgumentData { id, argumentIndex, stance, body, amendmentText?, stakeAmount, engagementTier, weightedScore, totalStake, coSignCount, createdAt }
interface DebateData { id, debateIdOnchain, templateId, propositionText, propositionHash, actionDomain, deadline, jurisdictionSize, status, argumentCount, uniqueParticipants, totalStake, arguments, winningArgumentIndex?, winningStance?, resolvedAt? }
```

---

## 6. Implementation Phases & Execution Cycles

Each phase is divided into implementation cycles. Each cycle has:
1. **Agent Team** — parallel agents with tailored context implementing code
2. **Manual Review** — resolves cross-cutting concerns agents may miss
3. **Verification** — tests pass, types check, contracts compile

### Phase 1: Core Market Mechanics

**Goal:** `DebateMarket.sol` gains LMSR pricing and commit-reveal trading. Markets produce real-time price signals on Communique. Resolution is governance-triggered.

---

#### Cycle 1.1: LMSR Pricing Engine (Contract)

**Agent Team: Solidity LMSR**

Context to provide:
- Read `contracts/src/DebateMarket.sol` (full file — 733 lines)
- Read `contracts/foundry.toml` (Solidity 0.8.28, via_ir, optimizer 200 runs)
- Read `contracts/test/DebateMarket.t.sol` (test patterns: MockDistrictGate, MockERC20, setUp)
- Spec: `specs/DEBATE-MARKET-SPEC.md` §Batch LMSR, §Epoch Mechanics

Tasks:
- [ ] Install PRBMath: `forge install PaulRBerg/prb-math@release-v4`
- [ ] Add import: `import { SD59x18, sd, exp, ln, intoInt256 } from "prb-math/SD59x18.sol";`
- [ ] Add LMSR state mappings to `DebateMarket.sol`:
  ```solidity
  mapping(bytes32 => mapping(uint256 => SD59x18)) public lmsrQuantities;  // q_i per argument
  mapping(bytes32 => SD59x18) public lmsrLiquidity;                       // b parameter
  mapping(bytes32 => uint256) public currentEpoch;                        // epoch counter
  ```
- [ ] Implement jurisdiction-scaled `b` in `proposeDebate()`: `b = sd(int256(jurisdictionSizeHint * BASE_PER_MEMBER))` — set once at creation, governance-tunable `BASE_PER_MEMBER`
- [ ] Implement `getPrice(bytes32 debateId, uint256 argumentIndex) → SD59x18`:
  ```
  p_i = exp(q_i / b) / Σ exp(q_j / b)
  ```
  with saturation guard: if `q_i / b > sd(100e18)`, cap at `sd(100e18)` before calling `exp()`
- [ ] Implement `getPrices(bytes32 debateId) → SD59x18[]` — all argument prices in one call
- [ ] Implement internal `_computeLMSRCost(debateId, newQuantities) → SD59x18`:
  ```
  C(q) = b × ln(Σ exp(q_i / b))
  ```
- [ ] Add events: `EpochExecuted(bytes32 indexed debateId, uint256 epoch, uint256 tradesApplied)`
- [ ] Initialize LMSR state when first argument is submitted: all `q_i = 0`, prices = `1/n`
- [ ] Dynamic rebalancing: when new argument added, `q_new = 0`, prices auto-rebalance by formula (sum stays 1.0)

**Tests (same agent):**
- [ ] Price sum invariant: `Σ getPrices() == 1.0` (within 1e-15 tolerance) for 2, 3, 5, 10 arguments
- [ ] Saturation: force `q/b > 100` via direct state manipulation, verify no revert, dominant price ≈ 1.0
- [ ] Dynamic rebalancing: add argument to existing market, verify all prices still sum to 1.0
- [ ] Jurisdiction scaling: small district (200 members) vs large district (700K), verify `b` values and price responsiveness

**Completion criteria:** `forge test --match-contract DebateMarketLMSR` passes. Gas report for `getPrice()` and `getPrices()`.

---

#### Cycle 1.2: Commit-Reveal Epoch Trading (Contract)

**Agent Team: Solidity Epoch**

Context to provide:
- Read `contracts/src/DebateMarket.sol` (as modified by Cycle 1.1)
- Existing `deriveDomain()` at line 676 — reuse for epoch-scoped nullifiers
- Public inputs layout: `publicInputs[26]=nullifier`, `publicInputs[27]=actionDomain`, `publicInputs[30]=engagementTier`
- Existing `sqrt()` at line 691, `tierMultiplier()` at line 706
- Decision #7: `EPOCH_DURATION = 300` (5 min), governance-tunable

Tasks:
- [ ] Add epoch state:
  ```solidity
  struct TradeCommitment { bytes32 commitHash; address committer; uint256 epoch; bool revealed; }
  mapping(bytes32 => mapping(uint256 => TradeCommitment[])) public epochCommitments; // debateId => epoch => commitments
  uint256 public constant EPOCH_DURATION = 300; // 5 minutes, TODO: governance-tunable
  ```
- [ ] Implement `commitTrade(bytes32 debateId, bytes32 commitHash, address signer, bytes proof, uint256[31] publicInputs, uint8 verifierDepth, uint256 deadline, bytes signature)`:
  - Verify three-tree proof via `districtGate.verifyThreeTreeProof()`
  - Verify `publicInputs[27] == debate.actionDomain` (epoch-scoped via client-side deriveDomain)
  - Extract engagement tier from `publicInputs[30]`, validate > 0
  - Store commitment in current epoch's array
  - Emit `TradeCommitted(debateId, epoch, commitHash)`
  - **No token transfer at commit** — stake transfers at reveal
- [ ] Implement `revealTrade(bytes32 debateId, uint256 epoch, uint256 commitIndex, uint256 argumentIndex, uint8 direction, uint256 stakeAmount, bytes32 nonce)`:
  - Verify: `keccak256(abi.encodePacked(argumentIndex, direction, stakeAmount, nonce)) == commitHash`
  - Verify: caller == original committer
  - Verify: epoch is in reveal window (epoch + 1 is current, or epoch execution hasn't happened)
  - Transfer stake from caller: `stakingToken.safeTransferFrom(msg.sender, address(this), stakeAmount)`
  - Mark revealed, store reveal data for batch execution
  - Emit `TradeRevealed(debateId, epoch, argumentIndex, direction, stakeAmount)`
- [ ] Implement `executeEpoch(bytes32 debateId)`:
  - Verify: current epoch's reveal window has closed
  - For each revealed trade: compute `weightedAmount = sqrt(stakeAmount) * tierMultiplier(tier)`
  - Apply to LMSR: direction BUY adds `weightedAmount / b` to `q_i`; SELL subtracts
  - Update `lmsrQuantities`, increment `currentEpoch`
  - Compute cost delta: `ΔC = C(q_new) - C(q_old)`. Verify token balance covers delta.
  - Emit `EpochExecuted(debateId, epoch, tradesApplied)` with new prices
  - Permissionless — anyone can call
- [ ] Add `getEpochPhase(bytes32 debateId) → (uint256 epoch, string phase, uint256 secondsRemaining)` view
- [ ] Integrate with existing settlement: `resolveDebate()` uses LMSR-weighted scores, not just raw `weightedScore`

**Tests (same agent):**
- [ ] Commit-reveal lifecycle: commit in epoch N, reveal in N+1, execute, verify LMSR update
- [ ] Late reveal rejection: reveal after execution window → revert
- [ ] Duplicate commit prevention: same nullifier in same epoch → revert
- [ ] Batch execution: 10 trades in one epoch, verify all applied atomically, gas report
- [ ] Permissionless execution: non-participant calls `executeEpoch()` → succeeds
- [ ] Settlement integration: resolve after epochs, verify payouts use LMSR-based scoring

**Completion criteria:** `forge test --match-contract DebateMarketEpoch` passes. Full commit→reveal→execute→resolve→claim lifecycle test.

---

#### Cycle 1.3: SSE Price Feeds + Debate API (Infrastructure + Frontend)

**Agent Team: Infrastructure SSE** (shadow-atlas + Communique)

Context to provide:
- Read `packages/shadow-atlas/src/serving/api.ts` (existing API structure)
- Read `packages/shadow-atlas/src/serving/types.ts` (existing types)
- Read `communique/src/lib/server/sse-stream.ts` (existing SSE utility — needs TransformStream fix)
- Read `communique/src/lib/stores/debateState.svelte.ts` (existing store)
- Read `communique/src/routes/api/debates/by-template/[templateId]/+server.ts` (existing route pattern)
- SSE TransformStream fix documented in §5.3 above
- Cloudflare Pages constraint: must use TransformStream + anti-buffering headers

Tasks (shadow-atlas):
- [ ] New endpoint: `GET /v1/debate/:debateId` → market state + prices (JSON)
- [ ] New endpoint: `GET /v1/debate/:debateId/stream` → SSE price stream
  - Emit `price_update` event on each `EpochExecuted` (chain scanner trigger)
  - Emit `trade_committed` event on `TradeCommitted` (shows pending activity)
  - Emit `epoch_phase` event every 30s with current phase + countdown
  - Connection keepalive: `:keepalive\n\n` every 15s
- [ ] Extend chain scanner: subscribe to `TradeCommitted`, `TradeRevealed`, `EpochExecuted`, `MarketResolved` events from DebateMarket contract

Tasks (Communique):
- [ ] Fix `sse-stream.ts` for Cloudflare Pages: replace `ReadableStream` with `TransformStream`, add `X-Accel-Buffering: no` and `cf-no-buffer: 1` headers
- [ ] Prisma migration: add to Debate model: `market_liquidity BigInt?`, `current_prices Json?`, `current_epoch Int @default(0)`, `trade_deadline DateTime?`, `resolution_deadline DateTime?`, `market_status String @default("pre_market")`
- [ ] Prisma migration: add to DebateArgument: `current_price String?`, `price_history Json?`, `position_count Int @default(0)`
- [ ] Extend `debateState.svelte.ts`: add `lmsrPrices: Record<number, number>`, `epochPhase: 'commit' | 'reveal' | 'executing'`, `epochSecondsRemaining: number`, `sseConnection: EventSource | null`
- [ ] New API route: `GET /api/debates/[debateId]/stream` → proxy SSE from shadow-atlas (or direct Communique SSE if shadow-atlas unavailable)
- [ ] New API route: `POST /api/debates/[debateId]/commit` → accept trade commitment, relay to contract
- [ ] New API route: `POST /api/debates/[debateId]/reveal` → accept trade reveal

**Completion criteria:** SSE connection established in browser, price updates flow on epoch execution. Prisma migration applies cleanly. API routes respond correctly.

---

#### Cycle 1.4: Trading UI Components (Frontend)

**Agent Team: Svelte Trading UI**

Context to provide:
- Read all existing debate components in `communique/src/lib/components/debate/`
- Read `communique/src/lib/stores/debateState.svelte.ts` (as modified by Cycle 1.3)
- Read existing component patterns for styling consistency
- Svelte 5 runes patterns: `$state`, `$derived`, `$effect`
- LMSR prices are 0-1 floats per argument, sum to 1.0

Tasks:
- [ ] `MarketPriceBar.svelte` — horizontal bar showing SUPPORT/OPPOSE/AMEND as colored percentage segments. Animate on price update. Show price as percentage (e.g., "SUPPORT 62%"). Accept `prices: Record<Stance, number>` prop.
- [ ] `TradePanel.svelte` — stake input (USDC amount), argument selector, BUY/SELL direction, weighted amount preview (`sqrt(stake) × 2^tier` shown), price impact estimate, "Commit Trade" button. Disabled during reveal/execution phase.
- [ ] `EpochPhaseIndicator.svelte` — shows "COMMIT" or "REVEAL" with countdown timer. Pulses during phase transitions. Epoch number displayed.
- [ ] `DebateMarketCard.svelte` — compact card for template browse view: leading stance, price, participant count, market age. Uses HTTP polling (30s), not SSE.
- [ ] Integrate `MarketPriceBar` into `ActiveDebatePanel.svelte`
- [ ] Integrate `EpochPhaseIndicator` into `DebateSurface.svelte`
- [ ] Wire SSE subscription: open on debate detail view mount, close on unmount

**Completion criteria:** Components render with mock data. SSE integration updates prices in real-time. Template card shows debate signal.

---

#### Cycle 1.5: Relayer + Keeper Extension (Infrastructure)

**Agent Team: Relayer Extension**

Context to provide:
- Read existing relayer code (proof submission patterns)
- DebateMarket ABI (new functions from Cycles 1.1-1.2)
- `executeEpoch()` is permissionless — anyone can call
- Cost: ~$0.002/day at 5-min epochs for a 7-day market

Tasks:
- [ ] Extend relayer: accept encrypted trade commitments, submit `commitTrade()` on behalf of users (wallet unlinkability)
- [ ] Epoch keeper loop: poll active markets every 5 minutes, call `executeEpoch()` when reveal window closes
- [ ] Health monitoring: log epoch execution gas, alert on missed epochs
- [ ] Graceful degradation: if relayer is down, users can call `commitTrade()` directly (loses wallet unlinkability but preserves ZK identity privacy)

**Completion criteria:** Relayer submits commitments and executes epochs on testnet. Missed epoch recovery works.

---

#### Phase 1 Manual Review Checkpoint

After all Cycle 1.x agents complete, manual review covers:
- [ ] Cross-cutting: LMSR settlement solvency proof across epoch boundaries (agents test within-epoch only)
- [ ] Cross-cutting: Prisma schema + store types + API routes align with contract event structure
- [ ] Cross-cutting: SSE message format matches frontend expectations
- [ ] Security: commit hash doesn't leak trade direction via gas patterns (all commits same gas)
- [ ] Security: epoch execution can't be frontrun (batch execution is atomic, same-price guarantee)
- [ ] Security: PRBMath overflow guards tested at boundary (q/b = 99, 100, 101, 133)
- [ ] Integration: full lifecycle test — propose → argue → commit → reveal → execute → resolve → claim

---

### Phase 2: Position Privacy

**Goal:** Trade amounts and positions fully private. Trustless weighted amount proving via ZK.

**Prerequisites:** Phase 1 complete. Noir toolchain version alignment checked.

#### Cycle 2.1: debate_weight Noir Circuit

**Agent Team: Noir Circuit**

Context to provide:
- Read `packages/noir-prover/src/index.ts` (existing prover patterns)
- Read `packages/noir-prover/src/types.ts` (existing types)
- Read `packages/noir-prover/src/two-tree-prover.ts` (prover class pattern)
- Read `packages/crypto/package.json` (Noir/BB versions: bb.js@2.1.8, noir_js@1.0.0-beta.16)
- Noir v1.0.0-beta.19 breaking changes: `unsafe {}`, msgpack-compact, `compiler_version` mandatory
- sqrt pattern from §5.2: unconstrained compute + assert(root * root == x)

Tasks:
- [ ] Create `circuits/debate_weight/src/main.nr`:
  - Private inputs: `stake: Field`, `tier: u8`, `randomness: Field`
  - Public inputs: `weighted_amount: Field`, `note_commitment: Field`
  - Constraints: `unsafe { root = unconstrained_sqrt(stake); } assert(root * root == stake);`
  - `multiplier = 1 << tier; weighted = root * multiplier;`
  - `assert(weighted == weighted_amount);`
  - `note = poseidon2([stake, tier as Field, randomness]);`
  - `assert(note == note_commitment);`
  - ~200 constraints estimated
- [ ] Create `circuits/debate_weight/Nargo.toml` with `compiler_version` set to installed version
- [ ] Compile for UltraHonk backend
- [ ] Create `DebateWeightNoirProver` TypeScript class following `TwoTreeNoirProver` pattern
- [ ] Golden vector tests: TypeScript Poseidon2 output matches circuit `note_commitment`

**Completion criteria:** Circuit compiles, prover generates valid proof, verifier accepts. Golden vectors pass. Constraint count documented.

#### Cycle 2.2: Position Note Circuit + Contract

**Agent Team: Position Notes**

Context to provide:
- debate_weight circuit from Cycle 2.1
- Existing Merkle tree patterns (Trees 1-3 in shadow-atlas)
- Contract patterns for root tracking (from DistrictRegistry)

Tasks:
- [ ] `position_note` Noir circuit (~11.1K constraints): proves note ownership via Merkle proof + nullifier, without revealing stake amount or argument index
- [ ] Position Merkle tree builder (same pattern as Trees 1-3)
- [ ] Contract: position note root tracking, private settlement via ZK proof
- [ ] Remove contract-side `sqrt()` verification (replaced by in-circuit proof)
- [ ] Mobile browser testing: verify < 15K constraints works on iPhone Safari WASM

#### Cycle 2.3: Frontend Privacy Flow

Tasks:
- [ ] Two-proof submission: three-tree proof + position note proof in sequence
- [ ] UI indicator: "Your position is private"
- [ ] Proof generation timing budget: both proofs must complete within 5-min commit window

#### Phase 2 Manual Review Checkpoint
- [ ] Privacy guarantee: can observer correlate commits across epochs to deanonymize?
- [ ] Noir toolchain version alignment with existing circuits (avoid two compiler versions)
- [ ] Mobile OOM testing with ~11K constraint circuit
- [ ] Settlement solvency with private positions (can't enumerate losing pool on-chain — need ZK proof of total)

---

### Phase 3: AI-Augmented Resolution

**Goal:** Multi-model AI panel scores argument quality. Combined AI + community resolution.

#### Cycle 3.1: AI Evaluation Service

Tasks:
- [ ] Evaluation service: Claude + GPT-4 + Gemini scoring with dimension weights (reasoning 0.30, accuracy 0.25, evidence 0.20, constructiveness 0.15, feasibility 0.10)
- [ ] Prompt injection sandboxing: arguments as data, not instructions
- [ ] M-of-N signature generation + on-chain attestation

#### Cycle 3.2: Contract Integration

Tasks:
- [ ] `AIEvaluationRegistry.sol` — model signer registry, quorum logic, diversity enforcement
- [ ] `submitAIEvaluation()` + combined resolution: `final = α × ai + (1-α) × community`
- [ ] Governance override: failed consensus → 48h extension → reviewer → 7-day appeal

#### Cycle 3.3: Resolution UI

Tasks:
- [ ] Resolution panel: AI dimension scores + community signal + combined result
- [ ] Appeal flow: stake 2× proposer bond

---

### Phase 4: Flow Encryption

**Goal:** Individual trade amounts never revealed, even at execution. Only aggregate price changes visible.

- [ ] ElGamal encryption over BN254 for trade intents
- [ ] Homomorphic aggregation of encrypted trades per epoch
- [ ] Threshold decryption of batch aggregates only
- [ ] DKG ceremony for threshold key committee
- [ ] TimelockGovernance guardians as decryption participants

---

## 7. What's Surprisingly Ready

- **Epoch nullifiers:** Zero changes anywhere. `deriveDomain(market, epoch)` is a pure function.
- **Dynamic argument rebalancing:** LMSR handles this automatically. New argument gets `q_m = 0`, prices rebalance by formula, sum stays 1. No special logic.
- **Settlement solvency:** Proven: `Σ payouts = total_stake` for all edge cases.
- **Anti-plutocratic weighting:** `sqrt()` + `tierMultiplier()` tested. Tier 4 at $2 outweighs Tier 1 at $100.
- **Frontend architecture:** 5 debate components + 6 routes + Prisma models. Just needs market pricing layer on top.
- **Gas costs:** Entire market lifecycle under $0.20 on Scroll. Gas is not a constraint.
- **SSE utility:** Already exists in Communique. Needs TransformStream fix for Cloudflare Pages (documented in §5.3).
- **PRBMath:** v4.1.0 confirmed compatible. SD59x18 type system prevents sign errors in LMSR math.
- **Contract test infrastructure:** MockDistrictGate + MockERC20 + setUp pattern ready. New tests follow same pattern.

---

## 8. Risk Register

| Risk | Severity | Mitigation |
|------|----------|-----------|
| PRBMath `exp()` overflow at `q/b > 133` | Medium | Saturate at `q/b > 100` (30% margin). Argument price → 1.0. Market becomes illiquid for that argument. |
| Thin markets (2 participants) produce weak signal | Low | Display participation depth. Protocol makes no authority claims for thin markets. |
| AI panel prompt injection via argument text | High (Phase 3) | Sandboxed evaluation context. Arguments as data, not instructions. Median-of-N robust to single model compromise. |
| Wealthy attacker manipulates prices | Medium | `sqrt(stake)` limits impact. $10K stake = 100 weighted shares. 20 Pillars at $2 = equivalent. AI resolution independent of stake. |
| Frivolous contestation spam | Low | Proposer bond ($1 min). 100 frivolous markets = $100 forfeited. Governance can increase bond. |
| Contestation as censorship | Medium | Signal shows leading argument, not just "disputed." SUPPORT at 90% = credibility boost. Frivolous contestation backfires. |
| Relayer liveness (epoch execution) | Medium | If relayer goes down, epochs queue up. Anyone can call `executeEpoch()` permissionlessly. No funds at risk. |
| Noir toolchain version drift | Medium (Phase 2) | VOTER pins bb.js@2.1.8 + noir_js@beta.16. Phase 2 circuits may need version bump to beta.19. Test compatibility before committing. |
| Mobile OOM on position_note circuit | Medium (Phase 2) | ~11.1K constraints is within budget but close to iPhone limit (~15K). Test on real devices. Reduce depth variants if needed. |
| The Graph indexer reliability on Scroll | Low | No issuance rewards → indexers less incentivized. Envio HyperIndex as fallback. |
| Cloudflare SSE buffering | Low | TransformStream + anti-buffering headers documented. Fix in Cycle 1.3. |

---

## 9. Cross-References

| Document | Relationship |
|----------|-------------|
| `specs/DEBATE-MARKET-SPEC.md` | Canonical spec. This plan implements it. |
| `ARCHITECTURE.md` §Debate Market | Summary section. Points here and to spec. |
| `docs/CHALLENGE-MARKET-ARCHITECTURE.md` | Economic sequence (E0-E3), AI consensus gaming analysis, escalation patterns. |
| `specs/REPUTATION-ARCHITECTURE-SPEC.md` | Engagement tier derivation. Debate trades should contribute to Shannon diversity. |
| `contracts/src/DebateMarket.sol` | Existing contract being extended. |
| `docs/roadmap/phase-2-design.md` | Broader Phase 2 context (token economics, outcome markets). |
