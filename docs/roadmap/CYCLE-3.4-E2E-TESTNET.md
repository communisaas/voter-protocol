# Cycle 3.4 — E2E Testnet Wiring

> **Date:** 2026-02-25
> **Depends on:** Cycle 3.1 (contracts), 3.2 (ai-evaluator), 3.3 (frontend)
> **Target:** Demo-ready on Scroll Sepolia, production-ready architecture

---

## Overview

Wire the complete AI resolution pipeline end-to-end: communique server triggers
ai-evaluator, scores are signed and submitted on-chain, chain scanner picks up
events, SSE pushes state transitions to the frontend, and the resolution UI renders
the final result.

**Current state:** MockAIEvaluationRegistry on Sepolia v5 accepts any signer (no
real registry needed for testnet). All contract functions, client bindings, Convex
schema (`commons/convex/schema.ts`), and frontend components are in place. What's
missing is the plumbing that connects them.

---

## Implementation Tasks

### 3.4.1 — Chain scanner: AI resolution event topics

**Files:**
- `packages/shadow-atlas/src/serving/debate-types.ts`
- `packages/shadow-atlas/src/serving/chain-scanner.ts`

**Work:**
1. Add event interfaces to `debate-types.ts`:
   ```typescript
   export interface AIEvaluationSubmittedEvent extends DebateMarketEvent {
     type: 'AIEvaluationSubmitted';
     signatureCount: number;
     nonce: bigint;
   }

   export interface DebateResolvedWithAIEvent extends DebateMarketEvent {
     type: 'DebateResolvedWithAI';
     winningArgumentIndex: number;
     aiScore: bigint;
     communityScore: bigint;
     finalScore: bigint;
     resolutionMethod: number;
   }

   export interface GovernanceResolutionSubmittedEvent extends DebateMarketEvent {
     type: 'GovernanceResolutionSubmitted';
     winningIndex: number;
     justification: string;
   }

   export interface ResolutionAppealedEvent extends DebateMarketEvent {
     type: 'ResolutionAppealed';
     appealer: string;
     bond: bigint;
   }

   export interface AppealFinalizedEvent extends DebateMarketEvent {
     type: 'AppealFinalized';
     upheld: boolean;
   }
   ```
2. Widen `DebateMarketEvent.type` union to include 5 new events.
3. Widen `AnyDebateEvent` union.
4. Add 5 topic constants in `chain-scanner.ts` using `eventTopic()`:
   - `AIEvaluationSubmitted(bytes32,uint256,uint256)`
   - `DebateResolvedWithAI(bytes32,uint256,uint256,uint256,uint256,uint8)`
   - `GovernanceResolutionSubmitted(bytes32,uint256,bytes32)`
   - `ResolutionAppealed(bytes32,address,uint256)`
   - `AppealFinalized(bytes32,bool)`
5. Add topics to the filter array in `pollDebateEvents()`.
6. Add decode branches in `mapDebateLog()` for each event.

**Tests:** Extend `chain-scanner.test.ts` with mock logs for each new event type.

**Estimate:** ~120 lines changed, ~60 lines test.

---

### 3.4.2 — SSE stream: local AI resolution events

**Files:**
- `communique/src/routes/api/debates/[debateId]/stream/+server.ts`

**Work:**
The current handler is a pure upstream proxy (68 lines). Extend it to also emit
local events when AI resolution state changes occur. Two approaches — pick one:

**Option A — Poll-and-push (simpler, sufficient for testnet):**
After connecting the upstream proxy, also start a polling loop that calls a Convex
query (e.g. `api.debates.getByOnchainId({ debateIdOnchain: debateId })`) every 5s.
When `status` or `aiSignatureCount` changes from the last seen value, emit:
- `evaluating` — status changed to `resolving` (AI scores being submitted)
- `ai_scores_submitted` — `aiSignatureCount` went from null to N
- `resolved_with_ai` — status changed to `resolved` + `resolutionMethod = 'ai_community'`
- `governance_override` — status changed to `awaiting_governance`
- `appeal_started` — status changed to `under_appeal`
- `appeal_finalized` — status changed to `resolved` from `under_appeal`

(Even better: subscribe to the Convex query via `ctx.subscribe()` instead of polling.)

**Option B — Event bus (production-grade, more complex):**
Create a lightweight in-process event bus (`$lib/server/debate-events.ts`). The
`/evaluate` POST handler publishes events after each state transition. The SSE
handler subscribes. This avoids polling but requires shared state.

**Recommendation:** Option A for Cycle 3.4 (demo-ready). Option B in Cycle 3.5
if needed for production latency requirements.

**Tests:** Manual — verify SSE events arrive in browser devtools.

**Estimate:** ~40 lines added to stream handler.

---

### 3.4.3 — Generate testnet signer wallets

**Files:**
- `contracts/script/generate-ai-signers.sh` (new)

**Work:**
1. Script that generates 5 Ethereum keypairs using `cast wallet new`.
2. Outputs them in `.env` format:
   ```
   MODEL_SIGNER_KEY_OPENAI=0x...
   MODEL_SIGNER_KEY_GOOGLE=0x...
   MODEL_SIGNER_KEY_DEEPSEEK=0x...
   MODEL_SIGNER_KEY_MISTRAL=0x...
   MODEL_SIGNER_KEY_ANTHROPIC=0x...
   ```
3. These wallets don't need funding (they only sign, never send tx).
4. With MockAIEvaluationRegistry, any signer is accepted — no registration needed.

**Estimate:** ~20 lines.

---

### 3.4.4 — Convex schema deploy

**Work:**
1. Run `npx convex dev` against the dev deployment to apply the schema.
2. Verify: 6 new fields on the `debates` table, 4 new fields on the `debateArguments` table, with indexes declared for every query path.
3. Verify `npx convex deploy --env-file .env.production` succeeds when promoting to prod.

**Prerequisite:** Docker running (PostgreSQL).

**Estimate:** One command, ~2 min.

---

### 3.4.5 — Smoke test script

**Files:**
- `communique/scripts/smoke-test-ai-resolution.ts` (new)

**Work:**
End-to-end testnet script that:
1. Creates a debate via `POST /api/debates/create` (or directly via debate-market-client).
2. Submits 3 arguments (SUPPORT, OPPOSE, AMEND) with mock ZK proofs.
3. Fast-forwards past deadline (or uses a short deadline, e.g. 60s).
4. Calls `POST /api/debates/:id/evaluate` with CRON_SECRET auth.
5. Polls `GET /api/debates/:id/ai-resolution` until resolution data appears.
6. Asserts:
   - `status === 'resolved'`
   - `resolution_method === 'ai_community'`
   - `ai_signature_count >= 3` (quorum)
   - `winning_argument_index` is set
   - Per-argument `ai_scores` contain all 5 dimensions
   - `final_score` is in range [0, 10000]
7. Prints summary with gas costs and timing.

**Dependencies:** Testnet API keys for at least 3 of the 5 model providers (to
meet quorum). Alternatively, mock the providers for a fully local test.

**Estimate:** ~150 lines.

---

## Review Checklist

After implementation, verify each item:

### Automated Review

| # | Check | Command | Pass Criteria |
|---|-------|---------|---------------|
| R-01 | ai-evaluator tests | `cd packages/ai-evaluator && npx vitest run` | 59/59 passing |
| R-02 | shadow-atlas tests | `cd packages/shadow-atlas && npx vitest run` | All passing (including new chain-scanner tests) |
| R-03 | communique typecheck | `cd communique && npx svelte-check` | No new errors (baseline: 50) |
| R-04 | Convex dev deploy | `cd commons && npx convex dev --once` | Clean output, schema applied |
| R-05 | Contract tests | `cd contracts && forge test` | 889+ passing (unchanged — no contract modifications this cycle) |
| R-06 | Env var alignment | Diff `.env.example` vars against `ai-evaluator/src/config.ts` env names | Exact match: `OPENAI_API_KEY`, `GOOGLE_AI_API_KEY`, `DEEPSEEK_API_KEY`, `MISTRAL_API_KEY`, `ANTHROPIC_API_KEY`, `MODEL_SIGNER_KEY_{OPENAI,GOOGLE,DEEPSEEK,MISTRAL,ANTHROPIC}`, `DEBATE_MARKET_ADDRESS`, `CHAIN_ID` |
| R-07 | ABI alignment | Diff `debate-market-client.ts` ABI strings against `DebateMarket.sol` function signatures | Exact match for all 6 AI resolution functions |
| R-08 | Score packing parity | Compare `ai-evaluator/signer.ts` packScores bit layout against `DebateMarket.sol` _packScores | [79:64]=reasoning, [63:48]=accuracy, [47:32]=evidence, [31:16]=constructiveness, [15:0]=feasibility |
| R-09 | EIP-712 parity | Compare `ai-evaluator/eip712.ts` domain + typehash against `DebateMarket.sol` AI_EVALUATION_TYPEHASH + AI_EVAL_DOMAIN_SEPARATOR | Exact match: name="DebateMarket", version="3", typehash includes `uint256[]` |

### Code Review (read-through)

| # | File | What to verify |
|---|------|----------------|
| CR-01 | `evaluate/+server.ts` | Auth check is not bypassable; dynamic import fallback is clean; Convex mutation writes match the schema; no secret leakage in JSON response |
| CR-02 | `ai-resolution/+server.ts` | No N+1 queries; argument scores are joined correctly; null handling for pre-resolution state |
| CR-03 | `debate-market-client.ts` | New functions follow existing error handling pattern (circuit breaker, RPC error classification, revert extraction); `SubmitGovernanceResolutionParams` has correct `justification` type (bytes32) |
| CR-04 | `chain-scanner.ts` | New event topics match Solidity event signatures exactly (parameter types, indexed vs non-indexed); decode logic handles edge cases (zero values, max values) |
| CR-05 | `stream/+server.ts` | Polling interval is reasonable (5s); cleanup on disconnect; no memory leaks from setInterval |
| CR-06 | `commons/convex/schema.ts` | New fields are `v.optional(...)` (existing rows won't break); table/index names match queries; indexes declared for every query-hot path |

---

## Manual Review (Demo Walkthrough)

### Pre-conditions
- [ ] Convex dev deployment reachable (`npx convex dev` running or schema already deployed)
- [ ] `.env` populated with testnet keys (at least 3 model API keys + all 5 signer keys) and `CONVEX_DEPLOY_KEY`
- [ ] commons dev server running (`npm run dev`)

### Happy Path — AI Resolution

| Step | Action | Expected |
|------|--------|----------|
| M-01 | Open a debate page that has been proposed + has 2+ arguments | PropositionDisplay shows "Open for deliberation" with amber pulse. DebateMetrics shows argument count, participant count, staked amount, countdown timer. |
| M-02 | Wait for deadline to pass (or use short-deadline test debate) | DebateMetrics shows "Ended" or "Deadline passed". No automatic resolution yet. |
| M-03 | Trigger evaluation: `curl -X POST /api/debates/:id/evaluate -H "Authorization: Bearer $CRON_SECRET"` | Returns 200 with JSON: `{ status: "resolved", resolutionMethod: "ai_community", winningArgumentIndex, panelConsensus, submitTxHash, resolveTxHash, gasUsed }` |
| M-04 | Refresh debate page | **ResolutionPanel** appears: violet-tinged clarity atmosphere. ResolutionPhaseIndicator shows "Resolved" with check icon. |
| M-05 | Inspect winner card | Winner card has amber ring + "Winner" badge. Final score shown as percentage. Model agreement dots visible (filled = agreeing, empty = outlier). |
| M-06 | Expand argument breakdown | Each argument shows AIScoreBreakdown (5 horizontal bars: reasoning=violet, accuracy=blue, evidence=cyan, constructiveness=teal, feasibility=slate). Bars animate via springs. Weighted total at bottom. |
| M-07 | Inspect AlphaBlendBar | Two-color bar (violet=AI, indigo=Community). Labels show "AI 40%" and "Community 60%" (or whatever α is). Final score matches. |
| M-08 | Check SSE stream in Network tab | Open debate page before triggering evaluation. After curl, SSE events arrive: `ai_scores_submitted`, `resolved_with_ai`. UI updates without refresh. |
| M-09 | Check `GET /api/debates/:id/ai-resolution` | Returns full resolution data: per-argument scores, model agreement, resolution method, signature count. |

### Governance Escalation Path

| Step | Action | Expected |
|------|--------|----------|
| M-10 | Create a debate where AI consensus will fail (e.g., configure only 1 model API key, below quorum) | Evaluation returns `{ status: "awaiting_governance" }`. |
| M-11 | Refresh debate page | ResolutionPhaseIndicator shows "Awaiting Governance" with gavel icon. AppealBanner shows governance waiting state. |

### Edge Cases

| Step | Action | Expected |
|------|--------|----------|
| M-12 | Call evaluate on a debate that's still active (deadline not passed) | 400: "Debate deadline has not passed yet" |
| M-13 | Call evaluate on an already-resolved debate | 400: "Debate is not active (status: resolved)" |
| M-14 | Call evaluate without CRON_SECRET | 403: "Operator access required" |
| M-15 | Call evaluate with no model API keys configured | 503: "AI evaluator configuration error: Missing environment variable: ..." |
| M-16 | Open debate page with no AI resolution data | No ResolutionPanel shown. Original simple resolution banner appears if community-only resolved. |

### Perceptual Validation (Dwelling Test)

| # | What to check | Quality |
|---|---------------|---------|
| P-01 | Spend 30 seconds on a resolved debate page doing nothing. Does the space feel settled? | The violet-tinged resolution panel should feel like clarity arriving after deliberation — not clinical, not celebratory, but quietly authoritative. |
| P-02 | Scan the argument list without reading. Can you tell which argument won at peripheral bandwidth? | Winner card's amber ring + "Winner" badge should pop at 2 bits/sec. AI score percentages should be glanceable. |
| P-03 | Hover over dimension bars. Does the focal detail (exact %) feel like a natural deepening of what you already perceived? | Peripheral: bar length = "high/low". Focal: exact percentage on hover. Transition should feel seamless. |
| P-04 | Look at the AlphaBlendBar. Without reading labels, can you tell the AI/Community split? | Two colors (violet/indigo) with proportional widths. The ratio should be immediately graspable. |
| P-05 | Check model agreement dots across multiple arguments. Does the pattern tell a story at a glance? | All green = strong consensus. Mix of green/empty = partial agreement. All red = divergence. The color should encode trust peripherally. |

---

## Execution Order

```
3.4.1  Chain scanner event topics        [voter-protocol]  ~2h
3.4.2  SSE stream local events           [commons]         ~1h
3.4.3  Generate testnet signer wallets   [contracts]       ~15min
3.4.4  Convex schema deploy              [commons]         ~10min
       ──── Automated Review (R-01 → R-09) ────
3.4.5  Smoke test script                 [communique]      ~2h
       ──── Manual Review (M-01 → M-16) ────
       ──── Perceptual Validation (P-01 → P-05) ────
```

3.4.1 and 3.4.2 are independent and can be parallelized.
3.4.3 and 3.4.4 are prerequisites for 3.4.5.
Manual review requires all prior steps complete.

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Model API rate limits on testnet | Evaluation fails for some models, quorum not met | MockAIEvaluationRegistry quorum=3 allows 2 failures; use cheapest models (GPT-5 Nano, DeepSeek V3.2) for initial smoke test |
| SSE polling misses fast state transitions | UI doesn't update until next poll | 5s interval is acceptable for demo; Option B (event bus) for production |
| Convex schema push fails due to validator mismatch | Schema deploy blocks | `npx convex dev` reports the conflicting field; make it `v.optional(...)` or backfill via a Convex mutation before tightening. Dev deployment has no production data at risk. |
| ai-evaluator `process.env` doesn't work in SvelteKit server context | loadModelConfigs throws | SvelteKit server-side code has access to process.env; if issues, adapt to use `$env/dynamic/private` |
| Chain scanner polls miss events during long gaps | State gets stale | Chain scanner already handles replay from last block; AI events use same mechanism |
