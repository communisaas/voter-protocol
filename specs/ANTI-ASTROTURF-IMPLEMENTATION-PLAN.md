# Anti-Astroturf Implementation Plan

> **Version:** 2.0
> **Date:** 2026-02-08
> **Status:** COMPLETE — All 11 gaps closed (Waves 13-15 + review waves 13R/14R/15R)
> **Methodology:** Agentic Wave Orchestration (see AGENTIC-WAVE-METHODOLOGY.md)
> **Companion:** COORDINATION-INTEGRITY-SPEC.md, IMPLEMENTATION-GAP-ANALYSIS.md
> **Scope:** Both repos — voter-protocol + communique

---

## Executive Summary

Four expert analysis waves mapped the full anti-astroturfing gap surface. **All 11 gaps are now closed** across 3 implementation waves (13-15), 3 review waves (13R, 14R, 15R), and 3 manual checkpoints:

- **G-01** (P0): On-chain relayer operational with circuit breaker, retry queue, balance monitoring
- **G-02** (P0): Cross-provider Sybil closed via `identity_commitment` + `encrypted_entropy`
- **G-03** (P1): Authority level enforced on-chain with bounds validation + 24h timelock for increases
- **G-04** (P1): The Graph subgraph indexes 3 contracts; coordination metrics API serves GDS/ALD/entropy/velocity
- **G-05–G-07, G-10–G-11** (P1/P2): Fail-closed moderation, rate limiting, pseudonymization, verification gating
- **G-08** (P2): Per-chamber nullifier scoping via `recipientSubdivision` in action domain
- **G-09** (P2): HMAC delivery confirmation tokens with 7-day expiry and timingSafeEqual

Review waves identified and remediated 12 additional findings including circuit breaker race conditions, entity ID collisions, timing side channels, and admin endpoint information leakage.

---

## Gap Inventory

| # | Gap | Severity | Category | Wave |
|---|-----|----------|----------|------|
| G-01 | ~~On-chain submission path non-operational~~ | P0 CRITICAL | Infrastructure | 15a **DONE** |
| G-02 | ~~Cross-provider Sybil (ISSUE-001)~~ | P0 CRITICAL | Identity | 14a **DONE** |
| G-03 | ~~Authority level enforcement missing on-chain~~ | P1 HIGH | Contract | 14c/14d **DONE** |
| G-04 | ~~Coordination metrics indexer missing~~ | P1 HIGH | Infrastructure | 15c/15d **DONE** |
| G-05 | ~~Moderation fail-open on service outage~~ | P1 HIGH | Security | 13a **DONE** |
| G-06 | ~~Rate limiting absent on template creation~~ | P1 HIGH | Security | 13b **DONE** |
| G-07 | ~~`user_id` stored in Submission (deanonymization)~~ | P1 HIGH | Privacy | 13c **DONE** |
| G-08 | ~~Per-chamber nullifier scoping not deployed~~ | P2 MEDIUM | Schema | 14e **DONE** |
| G-09 | ~~Delivery confirmation loop missing for mailto~~ | P2 MEDIUM | Delivery | 15e **DONE** |
| G-10 | ~~Template creation ungated for unverified users~~ | P2 MEDIUM | Security | 13d **DONE** |
| G-11 | ~~BA-014 rate limiting on sensitive endpoints~~ | P2 MEDIUM | Security | 13e **DONE** |

---

## Wave Architecture

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  WAVE 13: Pipeline Hardening & Privacy (G-05, G-06, G-07, G-10, G-11)        │
│  ├── 13a: Fail-closed moderation with circuit breaker                        │
│  ├── 13b: Rate limiting on template creation + moderation endpoint           │
│  ├── 13c: Anonymize Submission model (remove user_id, add pseudonymous_id)   │
│  ├── 13d: Gate template creation behind identity verification                │
│  └── 13e: Wire BA-014 rate limits on 8 sensitive endpoints                   │
│                                                                               │
│  [REVIEW WAVE 13R: Implementation quality, fragmentation, redundancy]        │
│  [MANUAL CHECKPOINT: Opus review of privacy model changes]                   │
├───────────────────────────────────────────────────────────────────────────────┤
│  WAVE 14: Identity & Contract Hardening (G-02, G-03, G-08)                   │
│  ├── 14a: Cross-provider Sybil closure (bindIdentityCommitment integration)  │
│  ├── 14b: user_secret derivation from identity_commitment                    │
│  ├── 14c: Authority level derivation + storage                               │
│  ├── 14d: actionDomainMinAuthority contract change + tests                   │
│  └── 14e: Per-chamber nullifier scoping (action domain schema revision)      │
│                                                                               │
│  [REVIEW WAVE 14R: Contract security, identity flow correctness]             │
│  [MANUAL CHECKPOINT: Opus review of contract + identity changes]             │
├───────────────────────────────────────────────────────────────────────────────┤
│  WAVE 15: On-Chain Infrastructure & Indexing (G-01, G-04, G-09)              │
│  ├── 15a: Relayer hardening (circuit breaker, retry queue, balance alerts)   │
│  ├── 15b: Environment variable setup + deployment checklist                  │
│  ├── 15c: The Graph subgraph for coordination metrics                        │
│  ├── 15d: Metrics computation API (GDS, ALD, temporal entropy, velocity)     │
│  └── 15e: Mailto delivery confirmation (tracking link approach)              │
│                                                                               │
│  [REVIEW WAVE 15R: Infrastructure resilience, metrics correctness]           │
│  [MANUAL CHECKPOINT: Opus review of indexer + infra changes]                 │
├───────────────────────────────────────────────────────────────────────────────┤
│  WAVE 16: Documentation Sync & Closure                                        │
│  ├── Update IMPLEMENTATION-GAP-ANALYSIS.md (G-01 through G-11 status)        │
│  ├── Update REMEDIATION-WAVE-PLAN.md (Cycle 3 completion)                    │
│  ├── Update COORDINATION-INTEGRITY-SPEC.md (implementation status section)   │
│  └── Final gap analysis: are there remaining unaddressed attack vectors?     │
│                                                                               │
│  [FINAL REVIEW: Complete anti-astroturf posture assessment]                  │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## Wave 13: Pipeline Hardening & Privacy

**Objective:** Close the 5 application-layer gaps that require no contract changes or external infrastructure.
**Repo:** communique
**Dependencies:** None (all changes are self-contained)

### 13a: Fail-Closed Moderation with Circuit Breaker

**Gap:** G-05 — `ActionBar.svelte:53-56` catches moderation errors and proceeds anyway. If the moderation service is DDoS'd or unreachable, toxic/CSAM content flows through to congressional offices.

**Current Code (ActionBar.svelte:53-56):**
```typescript
} catch {
  // Moderation service unavailable — allow send (fail-open for UX)
  console.warn('[ActionBar] Moderation service unavailable, proceeding');
}
```

**Implementation:**

1. Add circuit breaker state to ActionBar:
   - Track consecutive moderation failures (max 3)
   - First 3 failures: fail-CLOSED, show user "Content verification unavailable, please try again"
   - After 3 consecutive failures within 60 seconds: fail-OPEN (assume service outage, allow send)
   - Log every bypass for retroactive audit

2. On the server side, add `/api/moderation/health` endpoint that returns service status:
   - Prompt Guard reachable? Llama Guard reachable?
   - If neither is reachable, return `{ healthy: false }`
   - Client can check health before attempting moderation

**Files:**
- `communique/src/lib/components/template-browser/parts/ActionBar.svelte` — circuit breaker logic
- `communique/src/routes/api/moderation/health/+server.ts` — NEW: health check endpoint

**Pitfalls:**
- **Pitfall:** Circuit breaker that never resets leaves moderation permanently disabled after an outage.
  **Mitigation:** Reset failure counter after 60 seconds of no attempts, or on first successful moderation call.
- **Pitfall:** User sees "try again" on every send attempt during a real outage.
  **Mitigation:** After 3 failures, show a clear message: "Content verification is temporarily unavailable. Your message will be sent without content verification and flagged for retroactive review."

**Test Cases:**
- [ ] Moderation service down → first send blocked with retry message
- [ ] 3 consecutive failures → circuit breaker opens, send allowed with audit log
- [ ] Service recovers → circuit breaker resets, moderation resumes
- [ ] Health endpoint reflects actual service status

---

### 13b: Rate Limiting on Template Creation + Moderation API

**Gap:** G-06 — Template creation has zero rate limiting. Anyone can create unlimited templates, enabling astroturf campaign spam. Additionally, the moderation API has no rate limit, exposing GROQ/Gemini API costs to abuse.

**Implementation:**

1. Add to `ROUTE_RATE_LIMITS` in rate limiter configuration:
   ```
   /api/templates (POST): 10 requests/day per user
   /api/moderation/personalization: 30 requests/min per IP
   /api/moderation/check: 10 requests/min per IP
   ```

2. These limits should use the existing sliding-window rate limiter already implemented at `hooks.server.ts:207-297`.

**Files:**
- `communique/src/hooks.server.ts` — add rate limit rules
- `communique/src/lib/core/security/rate-limiter.ts` — if new patterns needed

**Pitfalls:**
- **Pitfall:** Rate limit too aggressive on templates blocks legitimate power users creating campaign templates.
  **Mitigation:** 10/day is generous. If a user needs more, they're likely running an organization — add verified-creator exemption later.
- **Pitfall:** Rate limiting moderation endpoint blocks legitimate concurrent users on shared IP (corporate office, university).
  **Mitigation:** Use user-based limits for authenticated requests, IP-based only for unauthenticated.

**Test Cases:**
- [ ] 11th template creation in a day returns 429 with Retry-After header
- [ ] Rate limit resets after 24 hours
- [ ] Moderation endpoint returns 429 after 30 requests/min
- [ ] Rate limit headers (X-RateLimit-Remaining) are correct

---

### 13c: Anonymize Submission Model

**Gap:** G-07 — `Submission.user_id` creates a direct link between on-chain pseudonymous proofs and authenticated user accounts. A database breach or government subpoena deanonymizes every proof submission. This contradicts the cypherpunk architecture where `Message` model has no `user_id`.

**Implementation:**

1. Add `pseudonymous_id` field to Submission model (Prisma migration):
   ```prisma
   model Submission {
     // REMOVE: user_id String
     pseudonymous_id String  // SHA-256(user_id + per-deployment-salt)
     // ... rest unchanged
   }
   ```

2. Compute `pseudonymous_id` at submission time:
   ```typescript
   const ANONYMIZATION_SALT = env.SUBMISSION_ANONYMIZATION_SALT; // env var, not in code
   const pseudonymousId = sha256(userId + ANONYMIZATION_SALT);
   ```

3. For reputation updates, use a one-time binding token:
   - Generate token at submission time, store in separate `ReputationBinding` table
   - Token expires after 24 hours
   - After reputation update, delete token

4. Migration: backfill existing submissions with pseudonymous_id, then drop user_id column.

**Files:**
- `communique/prisma/schema.prisma` — modify Submission model
- `communique/src/lib/core/congressional/submission-handler.ts` — compute pseudonymous_id
- `communique/prisma/migrations/` — NEW migration
- `.env.example` — add SUBMISSION_ANONYMIZATION_SALT

**Pitfalls:**
- **Pitfall:** Salt leaked = all pseudonymous IDs are reversible.
  **Mitigation:** Store salt in secrets manager (Vault, AWS Secrets Manager), not .env. Rotate salt periodically (new submissions get new salt, old ones remain with old salt).
- **Pitfall:** Debugging/support becomes harder without user_id.
  **Mitigation:** Maintain audit log in separate, access-controlled table. Require 2-person authorization to query.
- **Pitfall:** Existing queries that JOIN on user_id break.
  **Mitigation:** Audit all queries before migration. Replace with pseudonymous_id where possible, add explicit audit-log queries for admin functions.

**Test Cases:**
- [ ] Submission created without user_id field
- [ ] pseudonymous_id is deterministic (same user + salt = same hash)
- [ ] Different users produce different pseudonymous_ids
- [ ] Reputation binding token works for trust_score updates
- [ ] Migration backfills existing records correctly

---

### 13d: Gate Template Creation Behind Verification

**Gap:** G-10 — Unverified OAuth accounts can create templates. A Sybil attacker with 100 throwaway accounts can create 100 astroturf campaign templates.

**Implementation:**

1. In `/api/templates/+server.ts` POST handler, add verification check:
   ```typescript
   if (!user.identity_commitment && user.trust_score < 100) {
     return json({
       error: 'VERIFICATION_REQUIRED',
       message: 'Verify your identity to create templates'
     }, { status: 403 });
   }
   ```

2. Allow verified users (identity_commitment set) OR high-trust users (trust_score >= 100, meaning verified email) to create templates.

**Files:**
- `communique/src/routes/api/templates/+server.ts` — add gate

**Pitfalls:**
- **Pitfall:** Gate too strict blocks legitimate new users who want to create their first template.
  **Mitigation:** `trust_score >= 100` (verified email) is the minimum bar. Users who verified email during OAuth get this automatically. Only phone-only Twitter accounts (trust_score 50) are blocked.
- **Pitfall:** Existing templates from unverified users need retroactive handling.
  **Mitigation:** Don't retroactively remove templates. Gate only applies to new creation.

**Test Cases:**
- [ ] Unverified user (trust_score < 100) gets 403
- [ ] Verified email user (trust_score >= 100) can create
- [ ] Identity-committed user can create regardless of trust_score
- [ ] Existing templates from unverified users remain accessible

---

### 13e: Wire BA-014 Rate Limits

**Gap:** G-11 — Rate limiting code exists in `hooks.server.ts` but the 8 identified sensitive endpoints need the limits enforced.

**Implementation:**

Wire the existing rate limiter to all 8 endpoints identified in the BA-014 TODO:

| Endpoint | Limit | Key Strategy |
|----------|-------|-------------|
| `/api/identity/*` | 10 req/min | IP |
| `/api/shadow-atlas/register` | 5 req/min | User |
| `/api/congressional/submit` | 3 req/hour | User |
| `/api/address/*` | 5 req/min | IP |
| `/api/submissions/*` | 5 req/min | IP |
| `/api/templates` (POST) | 10 req/day | User |
| `/api/moderation/*` | 30 req/min | IP |
| `/api/email/*` | 10 req/min | User |

**Files:**
- `communique/src/hooks.server.ts` — wire rate limiter to handle function

**Pitfalls:**
- **Pitfall:** Redis not configured in dev environment.
  **Mitigation:** Rate limiter already has in-memory fallback for dev. Only use Redis in production.

**Test Cases:**
- [ ] Each endpoint returns 429 after exceeding limit
- [ ] Rate limit headers present in all responses
- [ ] In-memory fallback works without Redis

---

### Wave 13 Gate Checklist

- [ ] `svelte-check` passes with zero errors in modified files
- [ ] All test cases pass
- [ ] No new `user_id` references added to Submission model
- [ ] Rate limits enforced on all 8 endpoints
- [ ] Moderation circuit breaker tested with simulated outage
- [ ] Privacy model documented (which fields are pseudonymous, which are direct)

---

## Wave 14: Identity & Contract Hardening

**Objective:** Close the cross-provider Sybil gap and add on-chain authority enforcement.
**Repos:** communique + voter-protocol
**Dependencies:** Wave 13 complete (privacy model settled before identity changes)

### 14a: Cross-Provider Sybil Closure

**Gap:** G-02 — A user with 5 OAuth accounts from 5 providers gets 5 independent identities, 5 independent `user_secret` values, and can submit 5 independent proofs per action domain.

**Root Cause:** `findOrCreateUser()` in `oauth-callback-handler.ts` checks for existing accounts by `(provider, provider_account_id)` — each provider is isolated. The `identity_commitment` field exists on the User model and `bindIdentityCommitment()` exists in `identity-binding.ts`, but neither is called during OAuth or identity verification flows.

**Implementation:**

1. **Modify OAuth callback** (`oauth-callback-handler.ts:241-310`):
   After finding/creating user, check if the email matches a user with `identity_commitment`:
   ```typescript
   // If email matches a verified user, link account instead of creating new user
   const verifiedUser = await db.user.findFirst({
     where: {
       email: userData.email,
       identity_commitment: { not: null }
     }
   });
   if (verifiedUser) {
     await db.account.create({
       data: { user_id: verifiedUser.id, provider, provider_account_id: userData.id, ... }
     });
     return verifiedUser; // Link to existing, don't create new
   }
   ```

2. **Hook Didit webhook** (`routes/api/identity/didit/webhook/+server.ts`):
   After successful verification, call `bindIdentityCommitment()`:
   ```typescript
   const commitment = computeIdentityCommitment(docNumber, nationality, birthYear, docType);
   const result = await bindIdentityCommitment(userId, commitment);
   // result.linkedToExisting tells us if accounts were merged
   ```

3. **Create verification-complete handler** (`src/lib/core/identity/verification-complete-handler.ts` — NEW):
   Orchestrates post-verification flow: bind commitment → generate user_secret → register in Shadow Atlas.

**Files:**
- `communique/src/lib/core/auth/oauth-callback-handler.ts` — add identity linking
- `communique/src/routes/api/identity/didit/webhook/+server.ts` — hook bindIdentityCommitment
- `communique/src/lib/core/identity/verification-complete-handler.ts` — NEW orchestrator
- `communique/src/lib/core/identity/identity-binding.ts` — verify mergeAccounts works correctly

**Pitfalls:**
- **Pitfall:** Account merge loses data (submissions, templates, reputation) from the absorbed account.
  **Mitigation:** `mergeAccounts()` in `identity-binding.ts` should transfer all owned records. Audit the merge function to ensure it covers submissions, templates, messages, reputation scores.
- **Pitfall:** Email matching is case-sensitive or fails on aliases (user+tag@gmail.com).
  **Mitigation:** Normalize email before comparison: lowercase, strip `+tag` from Gmail addresses.
- **Pitfall:** User verifies identity on device A, logs in on device B with different provider — device B has no `user_secret`.
  **Mitigation:** `user_secret` must be re-derivable from `identity_commitment` + stored `user_entropy`. Store `user_entropy` server-side (encrypted) so it can be recovered on new devices.

**Test Cases:**
- [ ] User with Google account verifies identity → commitment set
- [ ] Same user logs in with Twitter → linked to existing account (not new)
- [ ] Same user logs in with Facebook → linked to same account
- [ ] All 3 OAuth accounts share same user_id
- [ ] Merged accounts retain all submissions and templates
- [ ] Unverified user gets new account (no linking)

---

### 14b: user_secret Derivation

**Gap:** Part of G-02 — `user_secret` is currently hardcoded or user-provided. It should be derived from `identity_commitment` so that all OAuth accounts for the same verified person produce the same nullifiers.

**Implementation:**

1. Create `src/lib/core/identity/user-secret-derivation.ts`:
   ```typescript
   export async function deriveUserSecret(
     identityCommitment: string,
     userEntropy: string
   ): Promise<string> {
     return poseidon2Hash2(identityCommitment, userEntropy);
   }
   ```

2. Generate `userEntropy` once during identity verification, store encrypted in both:
   - Server: `User.encrypted_entropy` (AES-256-GCM, key from env)
   - Client: IndexedDB via existing `credential-encryption.ts`

3. At proof generation time, derive `user_secret` from stored values.

**Files:**
- `communique/src/lib/core/identity/user-secret-derivation.ts` — NEW
- `communique/src/lib/core/identity/verification-complete-handler.ts` — generate entropy
- `communique/src/lib/core/zkp/witness-builder.ts` — use derived user_secret
- `communique/prisma/schema.prisma` — add `encrypted_entropy` to User model

**Pitfalls:**
- **Pitfall:** Poseidon2 not available in communique's TypeScript.
  **Mitigation:** Import from `@voter-protocol/crypto`. Already a dependency.
- **Pitfall:** Entropy lost = user_secret lost = user can never prove again.
  **Mitigation:** Store entropy both client-side (IndexedDB) and server-side (encrypted). Recovery possible from either.

---

### 14c: Authority Level Derivation & Storage

**Gap:** G-03 (partial) — Authority level is hardcoded to 1 in proof generation. Should be derived from verification method and stored.

**Implementation:**

1. Create `src/lib/core/identity/authority-level.ts`:
   ```typescript
   export function deriveAuthorityLevel(user: {
     identity_commitment?: string | null;
     trust_score: number;
     verification_method?: string | null;
   }): 1 | 2 | 3 | 4 | 5 {
     if (user.identity_commitment && user.verification_method === 'passport') return 4;
     if (user.identity_commitment) return 3; // ID card / drivers license
     if (user.trust_score >= 100) return 2;  // Verified email
     return 1; // OAuth only
   }
   ```

2. Add `authority_level` to `ShadowAtlasRegistration` model.

3. Update `witness-builder.ts` to fetch and use derived authority level.

**Files:**
- `communique/src/lib/core/identity/authority-level.ts` — NEW
- `communique/prisma/schema.prisma` — add authority_level field
- `communique/src/lib/core/zkp/witness-builder.ts` — use derived value
- `communique/src/lib/components/template/ProofGenerator.svelte` — remove hardcoded value

**Pitfalls:**
- **Pitfall:** User's authority level changes after proof generation (e.g., they verify identity after sending a Level 1 proof).
  **Mitigation:** Authority level is locked at proof generation time. New proofs use new level. Old proofs remain valid at old level.

---

### 14d: actionDomainMinAuthority Contract Change

**Gap:** G-03 (on-chain) — DistrictGate.sol receives authority level but doesn't enforce minimums.

**Implementation:**

1. Add to `DistrictGate.sol`:
   ```solidity
   mapping(bytes32 => uint8) public actionDomainMinAuthority;

   function setActionDomainMinAuthority(bytes32 actionDomain, uint8 minLevel) external {
     // Timelocked governance function
     require(allowedActionDomains[actionDomain], "Domain not registered");
     require(minLevel >= 1 && minLevel <= 5, "Invalid authority level");
     actionDomainMinAuthority[actionDomain] = minLevel;
   }
   ```

2. Add enforcement in `verifyTwoTreeProof()`:
   ```solidity
   uint8 submitted = uint8(uint256(publicInputs[28]));
   uint8 required = actionDomainMinAuthority[actionDomain];
   if (required > 0 && submitted < required) revert InsufficientAuthority(submitted, required);
   ```

3. Write Foundry tests covering all authority levels and edge cases.

**Files:**
- `voter-protocol/contracts/src/DistrictGate.sol` — add mapping, setter, enforcement
- `voter-protocol/contracts/test/DistrictGate.AuthorityLevel.t.sol` — NEW test file

**Pitfalls:**
- **Pitfall:** Setting minimum too high locks out legitimate low-tier users.
  **Mitigation:** Default is 0 (no enforcement). Set per-domain. Start with Level 1 for all, raise selectively.
- **Pitfall:** Existing proofs become invalid if authority minimum is raised after generation.
  **Mitigation:** Apply to new submissions only. Add grace period: `if (submission.timestamp < minAuthorityEffectiveAt) skip check`.

**Test Cases:**
- [ ] Level 1 user submits to Level 2 domain → revert InsufficientAuthority
- [ ] Level 2 user submits to Level 2 domain → success
- [ ] Level 4 user submits to Level 2 domain → success
- [ ] Domain with minAuthority 0 → no enforcement (any level passes)
- [ ] Only governance can set minAuthority
- [ ] Cannot set minAuthority on unregistered domain

---

### 14e: Per-Chamber Nullifier Scoping

**Gap:** G-08 — Action domain builder supports `recipientSubdivision` but on-chain schema doesn't use it yet. Users sending to both House and Senate collide on the same nullifier.

**Implementation:**

1. Update action domain schema from:
   ```
   keccak256(protocol || country || jurisdictionType || recipientSubdivision || templateId || sessionId)
   ```
   to ensure `recipientSubdivision` is actually populated with chamber-specific values in the submission flow.

2. Update communique's submission flow to compute separate action domains per chamber:
   - Template targeting House + Senate generates 2 action domains
   - Each domain registered separately on-chain
   - User generates 2 proofs (one per chamber), each with its own nullifier

3. Update `submission-handler.ts` to accept multiple proof submissions per template.

**Files:**
- `communique/src/lib/core/zkp/action-domain-builder.ts` — ensure chamber values are correct
- `communique/src/lib/core/congressional/submission-handler.ts` — multi-proof support
- `communique/src/routes/api/congressional/submit/+server.ts` — accept array of proofs

**Pitfalls:**
- **Pitfall:** More action domains = more governance overhead (7-day timelock each).
  **Mitigation:** Batch registration via helper contract or script. Register all chambers for a template in one proposal.
- **Pitfall:** UX complexity: user must generate 2 proofs instead of 1.
  **Mitigation:** Auto-generate both proofs in sequence in ProofGenerator.svelte. User sees one "Send" button, proof generation happens for all chambers automatically.

---

### Wave 14 Gate Checklist

- [ ] Cross-provider Sybil test: same person, 3 providers → same user_id
- [ ] user_secret derivation produces consistent values
- [ ] Authority level derived correctly from verification method
- [ ] Contract: InsufficientAuthority revert works
- [ ] Contract: forge test passes for authority level enforcement
- [ ] Per-chamber nullifier scoping tested (House and Senate get different nullifiers)
- [ ] `svelte-check` passes with zero errors

---

## Wave 15: On-Chain Infrastructure & Indexing

**Objective:** Make the on-chain submission path operational and build the coordination metrics indexer.
**Repos:** voter-protocol + communique + NEW: indexer repo or package
**Dependencies:** Wave 14 complete (contract changes deployed before indexing)

### 15a: Relayer Hardening

**Gap:** G-01 (partial) — `district-gate-client.ts` has no circuit breaker, no retry queue, no balance monitoring, no nonce management.

**Implementation:**

1. Add circuit breaker:
   - Track RPC failures. After 3 failures in 60 seconds, fail fast (don't attempt RPC) for 30 seconds.
   - On circuit breaker open: queue submission for retry instead of marking failed.

2. Add retry queue:
   - Failed blockchain submissions go to a retry queue (database-backed, not Redis — simpler).
   - Retry with exponential backoff: 30s, 60s, 120s, 240s, then give up.
   - Background cron job processes retry queue every 30 seconds.

3. Add balance monitoring:
   - On every submission, check relayer balance.
   - If below 0.05 ETH, log warning. If below 0.01 ETH, refuse new submissions.
   - Add `/api/admin/relayer-health` endpoint (authenticated) returning balance, pending txs, failure rate.

4. Add nonce management:
   - Use `NonceManager` from ethers.js v6 for automatic nonce tracking.
   - On nonce collision, reset and retry once.

**Files:**
- `communique/src/lib/core/blockchain/district-gate-client.ts` — circuit breaker, NonceManager
- `communique/src/lib/core/blockchain/submission-retry-queue.ts` — NEW retry queue
- `communique/src/routes/api/admin/relayer-health/+server.ts` — NEW health endpoint
- `communique/src/lib/core/blockchain/balance-monitor.ts` — NEW balance checker

**Pitfalls:**
- **Pitfall:** Retry queue processes same submission twice after nonce collision.
  **Mitigation:** Idempotency key on nullifier. If nullifier already recorded on-chain, skip retry.
- **Pitfall:** Balance monitoring adds RPC call on every submission (latency).
  **Mitigation:** Cache balance for 5 minutes. Only make fresh RPC call if cache expired.

---

### 15b: Environment & Deployment Checklist

**Gap:** G-01 (config) — Missing env vars, no deployment documentation, timelocks not initiated.

**Implementation:**

1. Add to `.env.example`:
   ```bash
   # Blockchain Infrastructure (Scroll L2)
   SCROLL_RPC_URL=https://sepolia-rpc.scroll.io
   DISTRICT_GATE_ADDRESS=0x6eD37CC3D42c788d09657Af3D81e35A69e295930
   SCROLL_PRIVATE_KEY=  # Server relayer wallet (pays gas)

   # Privacy
   SUBMISSION_ANONYMIZATION_SALT=  # Random 64-char hex for pseudonymous IDs
   ```

2. Create `contracts/MAINNET-DEPLOYMENT-CHECKLIST.md` with the exact 22-day deployment sequence:
   - Day 1-2: Create wallet, fund, configure RPC
   - Day 3: Deploy two-tree registries
   - Day 4-10: Wait for 7-day timelock
   - Day 11: Execute registries, register roots, propose action domains
   - Day 12-18: Wait for 7-day timelock
   - Day 19: Execute action domains
   - Day 20-22: E2E testing, monitoring setup

**Files:**
- `communique/.env.example` — add missing vars
- `voter-protocol/contracts/MAINNET-DEPLOYMENT-CHECKLIST.md` — update with full sequence

**Pitfalls:**
- **Pitfall:** 14+ day minimum deployment timeline blocks rapid iteration.
  **Mitigation:** On testnet, governance can bypass timelocks for testing. Mainnet timelocks are non-negotiable (this is a feature, not a bug).

---

### 15c: The Graph Subgraph for Coordination Metrics

**Gap:** G-04 — Zero on-chain event data is indexed. All coordination integrity metrics are theoretical.

**Implementation:**

1. Create subgraph package at `voter-protocol/packages/indexer/` (or standalone repo):
   - `subgraph.yaml` mapping 3 core contracts (DistrictGate, CampaignRegistry, NullifierRegistry)
   - `schema.graphql` with 6 entities: Action, Submission, Campaign, Participation, District, ActionDomain
   - AssemblyScript event handlers for all 11 events cataloged by expert agents

2. Deploy to The Graph hosted service (Scroll Sepolia supported).

3. GraphQL API provides:
   ```graphql
   query CampaignHealth($campaignId: Bytes!) {
     campaign(id: $campaignId) {
       participantCount
       districtCount
       templateCount
       participations { newDistrict, timestamp }
     }
   }
   ```

**Files:**
- `voter-protocol/packages/indexer/subgraph.yaml` — NEW
- `voter-protocol/packages/indexer/schema.graphql` — NEW
- `voter-protocol/packages/indexer/src/mappings/` — NEW event handlers
- `voter-protocol/packages/indexer/package.json` — NEW

**Pitfalls:**
- **Pitfall:** The Graph hosted service has rate limits and may sunset.
  **Mitigation:** Use Goldsky (managed subgraph hosting) as backup. Schema is portable.
- **Pitfall:** Subgraph resyncs from genesis on schema changes.
  **Mitigation:** Design schema carefully upfront. Use `@derivedFrom` for relationships to avoid storage bloat.

---

### 15d: Metrics Computation API

**Gap:** G-04 (derived metrics) — Raw events are necessary but not sufficient. GDS, ALD, temporal entropy, and velocity curves require computation.

**Implementation:**

1. Add metrics computation service (can be a SvelteKit API route or standalone):
   - Queries The Graph subgraph for raw data
   - Computes derived metrics:
     - **GDS** = districtCount / participantCount
     - **ALD** = weighted average of authority levels
     - **Temporal entropy** = Shannon entropy over hourly bins
     - **Velocity** = d(participantCount)/dt
   - Caches results (5-minute TTL)

2. API endpoints:
   ```
   GET /api/metrics/campaign/:campaignId  → { gds, ald, temporalEntropy, velocity }
   GET /api/metrics/action/:actionDomain  → { participantCount, districtCount, authorityDistribution }
   GET /api/metrics/global                → { totalSubmissions, activeCampaigns, averageGds }
   ```

**Files:**
- `communique/src/routes/api/metrics/campaign/[id]/+server.ts` — NEW
- `communique/src/routes/api/metrics/action/[domain]/+server.ts` — NEW
- `communique/src/routes/api/metrics/global/+server.ts` — NEW
- `communique/src/lib/core/metrics/coordination-metrics.ts` — NEW computation logic

**Pitfalls:**
- **Pitfall:** Metrics API is slow if subgraph query is slow.
  **Mitigation:** Cache aggressively. Coordination metrics don't need real-time updates — 5-minute staleness is fine.
- **Pitfall:** Temporal entropy requires full history, which grows unbounded.
  **Mitigation:** Compute over rolling 30-day windows. Archive older data.

---

### 15e: Mailto Delivery Confirmation

**Gap:** G-09 — Mailto sends are fire-and-forget. No confirmation that the user actually sent the email from their client.

**Implementation:**

1. Include unique confirmation link in mailto body footer:
   ```
   ---
   Confirm delivery: https://communi.email/api/email/confirm/[trackingId]
   ```

2. User clicks link after sending email → updates `Submission.delivery_status` to `'user_confirmed'`.

3. This is NOT a delivery guarantee (user could click without sending). It's a UX signal: "I sent this."

**Files:**
- `communique/src/lib/services/emailService.ts` — append confirmation link to mailto body
- `communique/src/routes/api/email/confirm/[id]/+server.ts` — NEW confirmation endpoint

**Pitfalls:**
- **Pitfall:** Confirmation link leaks submission ID in email body → privacy concern.
  **Mitigation:** Use opaque token (HMAC of submission ID + secret), not raw ID. Token is single-use.
- **Pitfall:** User forgets to click confirmation link.
  **Mitigation:** Show reminder in UI after mailto opens: "Did you send it? Click here to confirm."

---

### Wave 15 Gate Checklist

- [ ] Relayer circuit breaker tested with simulated RPC outage
- [ ] Retry queue processes failed submissions correctly
- [ ] Balance monitoring alerts at threshold
- [ ] Subgraph deployed and syncing events on Scroll Sepolia
- [ ] GraphQL queries return correct data for all 6 entities
- [ ] Metrics API returns valid GDS, ALD, temporal entropy
- [ ] Mailto confirmation link works end-to-end
- [ ] `.env.example` contains all required blockchain vars

---

## Wave 16: Documentation Sync & Closure

**Objective:** Update all tracking documents. Final gap assessment.
**Dependencies:** Waves 13-15 complete.

### Implementation:

1. **IMPLEMENTATION-GAP-ANALYSIS.md:**
   - Mark G-01 through G-11 with final status
   - Update combined open issues count
   - Update revision number

2. **REMEDIATION-WAVE-PLAN.md:**
   - Append Cycle 3 (Waves 13-16) with completion status
   - Update TODO checkboxes
   - Update footer version

3. **COORDINATION-INTEGRITY-SPEC.md:**
   - Add "Implementation Status" section mapping each spec section to code
   - Update residual gap descriptions (Section 1.1, 1.3, 1.6, etc.)

4. **Final gap assessment:**
   - Are there remaining unaddressed attack vectors?
   - Is the slow-drip astroturf limitation documented?
   - Are all pitfalls from this plan tracked?

---

## Review Wave Protocol

After EACH implementation wave, launch a review wave:

### Review Wave Composition

**3 sonnet agents per review wave:**

1. **Security Reviewer** — Background: application security, smart contract auditing
   - Check for new vulnerabilities introduced by changes
   - Verify rate limits are actually enforced (not just defined)
   - Verify moderation circuit breaker is correct
   - Check for regression in existing security fixes

2. **Integration Reviewer** — Background: full-stack engineering, cross-repo consistency
   - Check for code fragmentation (same logic in multiple places)
   - Check for redundancy (duplicate rate limiters, duplicate validation)
   - Verify imports and exports are consistent
   - Check that schema changes are reflected in all consuming code

3. **Privacy Reviewer** — Background: data protection, pseudonymity, cypherpunk architecture
   - Verify `user_id` is not re-introduced in any new code
   - Check that pseudonymous_id is used consistently
   - Verify encrypted fields are actually encrypted
   - Check for PII leaks in logs, error messages, or analytics

### Review Wave Output

Each reviewer produces:
- List of issues found (severity: CRITICAL, HIGH, MEDIUM, LOW)
- List of files modified unnecessarily or with redundant changes
- Confirmation that gate checklist items are met
- Recommendations for the manual checkpoint

### Manual Checkpoint

After each review wave, the opus coordinator (you) manually examines:
- Review wave findings and whether they're valid
- Code diff for the implementation wave
- Gate checklist completion
- Whether to proceed to next wave or remediate first

---

## Dependency Graph

```
Wave 13 (Pipeline Hardening)
    │
    ├── 13a (moderation) ─── no deps
    ├── 13b (rate limits) ─── no deps
    ├── 13c (privacy) ────── no deps
    ├── 13d (template gate) ─ no deps
    └── 13e (BA-014) ─────── no deps
    │
    ▼
Wave 13R (Review) → Manual Checkpoint
    │
    ▼
Wave 14 (Identity & Contract)
    │
    ├── 14a (sybil closure) ──── depends on 13c (privacy model)
    ├── 14b (user_secret) ────── depends on 14a (identity linking)
    ├── 14c (authority level) ── depends on 14a (verification flow)
    ├── 14d (contract change) ── no deps (voter-protocol only)
    └── 14e (chamber scoping) ── depends on 14a (action domain schema)
    │
    ▼
Wave 14R (Review) → Manual Checkpoint
    │
    ▼
Wave 15 (Infrastructure & Indexing)
    │
    ├── 15a (relayer hardening) ── no deps
    ├── 15b (env setup) ──────── no deps
    ├── 15c (subgraph) ────────── depends on 14d (contract changes deployed)
    ├── 15d (metrics API) ─────── depends on 15c (subgraph)
    └── 15e (mailto confirm) ──── no deps
    │
    ▼
Wave 15R (Review) → Manual Checkpoint
    │
    ▼
Wave 16 (Documentation Sync)
```

---

## Effort Estimates

| Wave | Scope | Estimated Implementation | Review |
|------|-------|-------------------------|--------|
| 13 | 5 tasks, communique only | 1 session | 1 review wave |
| 14 | 5 tasks, both repos | 2 sessions | 1 review wave |
| 15 | 5 tasks, both repos + indexer | 2 sessions | 1 review wave |
| 16 | Documentation only | 1 session | Final review |

**Total:** ~6 implementation sessions + 3 review waves + 3 manual checkpoints

---

## Success Criteria

After all waves complete, the anti-astroturfing posture should satisfy:

1. **Sybil Flood:** Same person with 5 OAuth accounts → same user_secret → same nullifiers → one proof per action domain
2. **Coordinated Single-Voting:** Visible via campaign health metrics (GDS, ALD, temporal entropy) — not prevented, but observable
3. **Template Farming:** Gated by verification requirement + rate limits. Metrics expose template diversity.
4. **Burst Injection:** Detected by temporal entropy < 2 bits. Rate limits slow individual users.
5. **Geographic Concentration:** Detected by GDS < 0.05. On-chain district count per campaign.
6. **Authority Laundering:** Blocked by `actionDomainMinAuthority` enforcement on-chain.

**Residual accepted risk:** Slow-drip astroturf with organic-looking patterns across weeks/months. This is the fundamental limit of any privacy-preserving anti-astroturf system. Documented in COORDINATION-INTEGRITY-SPEC Section 4.4.

---

## Tracking

Completion tracked in:
- `specs/IMPLEMENTATION-GAP-ANALYSIS.md` — individual gap status (G-01 through G-11)
- `specs/REMEDIATION-WAVE-PLAN.md` — wave completion (Cycle 3, Waves 13-16)
- `specs/ANTI-ASTROTURF-IMPLEMENTATION-PLAN.md` — this document (gate checklists)

---

> **Version:** 2.0 | **Author:** Opus Coordinator | **Status:** COMPLETE — All 11 gaps closed across Waves 13-15 with 3 review waves and 3 manual checkpoints
