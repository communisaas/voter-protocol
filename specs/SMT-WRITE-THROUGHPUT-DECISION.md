# SMT Write-Throughput Design Decision

> **Spec ID:** SMT-WRITE-THROUGHPUT-001
> **Wave:** 8 / FU-2.3
> **Status:** ACCEPT-AND-MONITOR (resolved 2026-04-25)
> **Companion:** `REVOCATION-NULLIFIER-SPEC.md`

## Problem

The Poseidon2-SMT in `convex/revocations.ts` updates serially because Convex
mutations on `smtRoots` are atomic-per-row. Each insert path performs:

  1. `getRevocationSMTPath` — 64 sibling reads (parallelized via `Promise.all`)
  2. SvelteKit-side Poseidon2 walk — 64 sequential hashes
  3. `applyRevocationSMTUpdate` — 64 storage rows written sequentially
     (Convex doesn't expose a batched insert/patch API)
  4. Post-write read-back verification (FU-2.2) — 1 query + 64 hashes

Empirically: ~150ms per insert (~5–10 inserts/sec ceiling sustained). Bursts
of concurrent emits trigger optimistic-concurrency retries, further reducing
effective throughput.

## Options considered

### Option A — Batching model

Queue revocation nullifiers in a `revocationEmitQueue` table; a Convex cron
drains the queue, computing a single SMT update over N nullifiers per drain
cycle. The on-chain emit batches the corresponding entries.

**Pros**:
- Throughput becomes O(N inserts / drain interval) — easily 100+/sec.
- Single chain transaction per batch — gas amortized.
- OCC retry storm impossible (single writer).

**Cons**:
- Latency: revocations don't land on-chain immediately (operator-tunable
  drain interval, default ~30s). Stage 1 server gate already handles
  immediate denial; on-chain delay is orthogonal to user-facing UX.
- Implementation complexity: queue state, drain scheduling, partial-batch
  failure recovery.
- The witness path (`getRevocationNonMembershipPath`) must still expose
  the canonical post-batch root, which means it queries the queue's
  pending state OR waits for batch finalization. Choice affects V2
  proof correctness.
- Estimated effort: 3–5 days impl + 1 brutalist review cycle + integration
  testing against real Convex deploy.

### Option B — Accept current ceiling, document triggers

Continue with the per-emit serial model. Track the actual revocation rate
in production. Revisit when one of these triggers fires:

  1. Sustained > 1 revocation/sec for > 1h (60×/min).
  2. Burst >= 50 concurrent emits triggering OCC retry exhaustion.
  3. User-facing 503s from `/api/internal/emit-revocation` exceeding
     1% of attempts in any 1h window.

**Pros**:
- Zero implementation cost.
- Latency: revocations land on-chain ASAP.
- Simpler reasoning for incident response (one writer path).

**Cons**:
- Capacity ceiling baked in. Mass migration events (e.g., contract
  redeploy, attack-driven sybil cleanup) could exceed 5–10/sec.

## Decision

**Option B — accept-and-monitor.**

Rationale:

  1. **Launch volume**: address-change events are user-paced. The 24h
     re-verification throttle caps each user at 1 emit per 24h. Steady
     state for 100k active users ≈ 1 emit per 0.86 sec — under ceiling.
     Even at 1M users, ~10/sec sustained — at the edge. Bursts are the
     real risk; they're triggered by mass migration or attack scenarios.
  2. **Implementation cost**: 3–5 days for a closure that's dormant
     until the trigger fires. That budget is better spent on FU-3.5
     (runtime feature-flag infra) which has near-term cutover value.
  3. **Reversible**: switching to Option A later is a localized refactor
     of `convex/revocations.ts` + `/api/internal/emit-revocation`. The
     external contract (helper API + chain ABI) doesn't change.

## Operational triggers

If any of the three trigger conditions occur, file an issue referencing this
spec and re-open the design phase. Option A above is the starting point.

## Monitoring

Convex function logs already capture per-invocation timings.
`reconcileSMTRoot` cron output captures pending-revocation backlog (via
`revocationEmitQueue`-style fields if/when added).

Ops dashboard query for trigger detection (Convex Functions tab):

```
metric: revocation_emit_invocations
window: 1h sliding
trigger 1: count >= 3600     (1/sec sustained)
trigger 2: count_with_429 >= 50   (OCC exhaustion bursts)
trigger 3: count_with_503 / count_total >= 0.01
```
