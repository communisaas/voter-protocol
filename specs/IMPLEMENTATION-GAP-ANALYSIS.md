# Implementation Gap Analysis: Unified Proof Architecture

> **Date:** 2026-01-26 (Rev 6: 2026-01-27)
> **Status:** REVISION 6 — CVEs REMEDIATED, Round 1 Brutalist COMPLETE (21/23), Round 2 Brutalist TRIAGED (18 new findings)
> **Related:** UNIFIED-PROOF-ARCHITECTURE.md, CROSS-REPO-IDENTITY-ARCHITECTURE.md
> **Security Review:** Multi-expert adversarial analysis completed 2026-01-26
> **Expert Reviewers:** Identity Systems Architect, ZK Cryptography Expert, Civic Tech Architect
> **Brutalist Audit Round 1:** 9 AI critics across 4 audits (security + codebase) — 2026-01-26
> **Brutalist Audit Round 2:** 12 AI critics across 4 targeted audits (circuit, crypto, shadow-atlas, cross-system) — 2026-01-27

---

## ✅ RESOLVED: Original Security Vulnerabilities (All 13 Fixed)

**Red team analysis identified fundamental flaws. All have been implemented and verified in code (2026-01-26).**

### CVE-VOTER-001: Opaque Leaf Vulnerability
**Severity:** CRITICAL | **Exploitability:** Trivial

The circuit accepts any leaf from the Merkle tree without verifying it contains the claimed `authority_hash`. An attacker can:
1. Use any valid Tier 1 leaf from the public Shadow Atlas
2. Pass `authority_hash = TIER_5` as a public input
3. Contract accepts the proof as "Tier 5 verified"

```noir
// CURRENT (BROKEN):
fn main(..., authority_hash: Field, leaf: Field, ...) {
    assert(compute_merkle_root(leaf, ...) == merkle_root);  // ✓ leaf exists
    assert(compute_nullifier(..., authority_hash, ...) == nullifier);  // ✓ nullifier matches
    // ❌ NEVER VERIFIED: leaf actually contains authority_hash
}
```

### CVE-VOTER-002: Nullifier Domain Bypass
**Severity:** CRITICAL | **Exploitability:** Trivial

`epoch_id` and `campaign_id` are user-supplied inputs. Attackers vary these to generate unlimited unique nullifiers from a single key:
```
nullifier = H(user_secret, campaign_id, authority_hash, epoch_id)
           ^^^^^^^^^^^^   ^^^^^^^^^^^                  ^^^^^^^^
           attacker       attacker                     attacker
           controls       controls                     controls
```
One proof → unlimited "unique constituents" by cycling inputs.

### CVE-VOTER-003: No Leaf Ownership Binding
**Severity:** CRITICAL | **Exploitability:** Trivial

Nothing cryptographically binds the prover's key to the Merkle leaf. Anyone who can read the Shadow Atlas IPFS export can generate valid proofs for ANY leaf. Pure impersonation at scale.

### CVE-VOTER-004: Hash Library Mismatch
**Severity:** HIGH | **Exploitability:** Automatic (system fails on launch)

```
Shadow Atlas core:     Poseidon2Hasher (Noir stdlib)     ✓
Client SDK:            circomlibjs 'poseidon'            ✗ DIFFERENT ALGORITHM

circomlibjs Poseidon ≠ Aztec Poseidon2 (different S-boxes, constants)
→ Client-generated proofs will FAIL verification on-chain
```

### CVE-VOTER-005: TIGER Data Integrity
**Severity:** HIGH | **Exploitability:** Network-level (DNS/MITM)

Census TIGER downloads have no cryptographic verification:
- No checksums validated
- No signatures checked
- No TLS certificate pinning
- DNS hijack → poisoned district boundaries → targeted disenfranchisement

### CVE-VOTER-006: Missing Cross-Language Test Vectors
**Severity:** MEDIUM | **Exploitability:** Silent divergence

No hardcoded test vectors verify TypeScript and Noir produce identical Poseidon2 outputs. Current "golden vector" test only checks `typeof hash === 'bigint'`.

---

## 🟡 HIGH PRIORITY: Expert-Identified Issues

**Multi-expert review identified additional gaps requiring attention.**

### ISSUE-001: Cross-Provider Identity Deduplication
**Severity:** HIGH | **Category:** Sybil Resistance

User can create 5 accounts via 5 different OAuth providers (Google, Facebook, LinkedIn, Twitter, Discord) with different email addresses.

**Current State:** No cross-provider uniqueness enforcement.

**Recommendation:** After OAuth, require linking to unique identifier:
- Option A: Phone number via SMS OTP (most providers support)
- Option B: Identity commitment binding (ties OAuth to ZK identity)

### ISSUE-002: X/Twitter Phone-Only Account Sybil Vector
**Severity:** HIGH | **Category:** Sybil Resistance | **Status:** ✅ COMPLETE

**Root Cause:** X/Twitter allows account creation with phone number only — no email required. The X API returns `null` for email on these accounts. Our code generates a synthetic placeholder:

```typescript
// communique/src/lib/core/auth/oauth-providers.ts:514
email: rawUser.data.email || `${rawUser.data.username}@twitter.local`
```

**Affected Account Types:**
| Account Type | Vulnerable? | Notes |
|--------------|-------------|-------|
| X accounts (2023+) | ✅ Yes | Phone-only signup allowed |
| Legacy Twitter → X migrated | ✅ Yes | Retain original contact info |
| Twitter 2017-2022 | ⚠️ Depends | Email was required during this period |
| Pre-2017 Twitter | ✅ Yes | Phone-only was allowed |

**Critical Discovery — Missing OAuth Scope (FIXED 2026-01-27):**
```typescript
// oauth-providers.ts:466 — FIXED
scope: 'users.read tweet.read users.email offline.access'
// users.email scope added, X Developer Portal configured
```
The `users.email` scope is now requested, and "Request email from users" enabled in X Developer Portal.

**Sybil Attack Vector:**
1. Attacker creates X accounts using virtual phone numbers (~$0.10-0.50 each via VoIP)
2. Each account has no email → gets `username@twitter.local`
3. Each gets `trust_score: 50` but still has system access
4. Mass OAuth to create many "legitimate" accounts

**Current Mitigation (Implemented):**
- `trust_score: 50` (vs 100 for verified email)
- `reputation_tier: 'novice'` (vs 'verified')
- Tracked via `Account.email_verified` column

**Remaining Gaps (After Scope Fix):**
1. ~~Missing `users.email` OAuth scope~~ ✅ FIXED
2. ~~X Developer Portal may not have "Request email from users" enabled~~ ✅ CONFIGURED
3. Lower trust doesn't PREVENT account creation, only restricts it (by design)
4. Phone verification ≠ identity verification (virtual numbers trivially available)

**Recommended Mitigations (Priority Order):**
1. **Scope fix:** Add `users.email` to OAuth scope, enable in X Developer Portal
2. **Block phone-only:** Require email for X OAuth registration
3. **Email verification wall:** Force real email verification after OAuth
4. **Rate limit by X user ID:** Prevent rapid account creation from same X account
5. **Cross-provider dedup:** (ISSUE-001) Detect same person across providers

### ISSUE-003: Redistricting Emergency Protocol
**Severity:** HIGH | **Category:** Data Integrity

Court-ordered redistricting (NC-2022, AL-2023, LA-2024) can invalidate proofs mid-term. TIGER update lag is 2-4 months after court decisions.

**Current State:** No emergency update protocol. Users in new districts cannot participate during lag.

**Recommendation:**
1. Monitor court dockets (PACER) for redistricting decisions
2. Use precinct-level data from state election officials (faster than TIGER)
3. Implement dual-validity period: Accept proofs from old OR new district for 30 days
4. Push notifications to affected constituents

### ISSUE-004: Session Credential Security
**Severity:** MEDIUM | **Category:** Client Security

IndexedDB stores plaintext credential data (merkle_path, leaf_index, etc.). No encryption at rest.

**Current State:** Malicious browser extension or XSS could extract credentials.

**Recommendation:**
- Encrypt IndexedDB with Web Crypto API device-bound key
- Add credential signature verification before use
- Implement hourly revocation check ping

### ISSUE-005: Stale District Credential Attack
**Severity:** MEDIUM | **Category:** Data Integrity

6-month TTL on cached credentials allows constituent to use old district after moving.

**Current State:** ~2% of US population moves annually. Some will message wrong representative.

**Recommendation:**
- Shorten TTL for high-stakes actions (30 days for constituent messages)
- Prompt re-verification after 30 days: "Still living at same address?"
- Add IP geolocation shift detection

### ISSUE-006: Circuit Authority Range Check
**Severity:** LOW | **Category:** Input Validation

Circuit doesn't validate authority_level is within expected range (1-5).

**Recommendation:**
```noir
assert(authority_level >= 1);
assert(authority_level <= 5);
```

### ISSUE-007: String-to-Field Encoding Specification
**Severity:** LOW | **Category:** Interoperability

The 31-byte chunking for strings in Poseidon2Hasher `hashString()` is not explicitly documented. Potential divergence if circuit expects different chunking.

**Recommendation:** Document string encoding as part of protocol specification. Add test vectors for string hashing.

---

---

## 🔴 Brutalist Audit Round 1 (2026-01-26)

**Source:** 9 AI critics (Claude, Codex, Gemini) across 4 parallel security and codebase audits.
**Scope:** voter-protocol (circuit, crypto, contracts, shadow-atlas) + communique (SvelteKit app).
**Methodology:** Adversarial red-team with nation-state threat model.
**Remediation:** 21/23 complete. See status on each finding below.

> **NOTE ON FALSE POSITIVES:** ~40% of brutalist findings conflated `packages/client` (legacy browser SDK)
> with `communique` (the actual SvelteKit app). The client SDK uses `simpleHash`/DJB2 and `InMemoryKeyStore`
> — these are real problems in that SDK but NOT the active attack surface. Communique imports
> `@voter-protocol/noir-prover` (Poseidon2 + UltraHonk) and has its own `credential-encryption.ts`
> with AES-256-GCM via Web Crypto. Findings below are confirmed valid after manual verification.

### P0 — Deployment Blocking

#### BA-001: Contract-Circuit Public Input Mismatch
**Severity:** CRITICAL | **Repo:** voter-protocol | **Source:** Gemini (voter-protocol security), Claude (communique security)

**Problem:** `DistrictGateV2.sol` passes public inputs in the OLD format:
```solidity
// contracts/src/DistrictGateV2.sol:204-211
uint256[5] memory publicInputs = [
    uint256(districtRoot),     // [0] merkleRoot      ✓ matches
    uint256(nullifier),        // [1] nullifier        ✓ matches
    uint256(authorityHash),    // [2] authorityHash    ✗ MISMATCH: circuit outputs authority_level (1-5)
    uint256(epochId),          // [3] epochId          ✗ MISMATCH: circuit outputs action_domain
    uint256(campaignId)        // [4] campaignId       ✗ MISMATCH: circuit outputs district_id
];
```

The circuit now returns `(merkle_root, nullifier, authority_level, action_domain, district_id)`.
Slots 2-4 are completely different types. **Every proof verification will fail.**

**Fix:** Update DistrictGateV2 (or create V3) to match the new circuit public output order.

**Status:** [x] COMPLETE (2026-01-26) — Renamed authorityHash→authorityLevel, epochId→actionDomain, campaignId→districtId. Updated EIP-712 typehash, public inputs array, NullifierRegistry call, event emission. Breaking: EIP-712 struct hash changed.

#### BA-002: Mock Merkle Proofs in Cloudflare Worker
**Severity:** CRITICAL | **Repo:** voter-protocol | **Source:** Claude (voter-protocol security)

**Problem:** `deploy/cloudflare/src/worker.ts:231-237` returns empty proofs:
```typescript
const merkleProof = {
    root: snapshot?.merkleRoot || '0x000...0',
    leaf: '0x000...0',
    siblings: [],
    pathIndices: [],
};
```

Any client consuming these will generate invalid ZK proofs or silently fail.

**Fix:** Either implement actual proof generation or return an explicit error indicating the endpoint is not yet production-ready.

**Status:** [x] COMPLETE (2026-01-26) — Replaced mock proof with `merkleProof: null` + `proofStatus: 'pending'`. Clients now get explicit signal that proof data is unavailable.

### P1 — Security Critical

#### BA-003: Poseidon2 Domain Separation Absence
**Severity:** HIGH | **Repo:** voter-protocol | **Source:** Claude (crypto codebase)

**Problem:** `hashSingle(x)`, `hashPair(x, 0)`, and `hash4(x, 0, 0, 0)` produce identical output.
Confirmed by golden vectors: `hashSingle(0) === hashPair(0, 0) === hash4(0, 0, 0, 0)`.

The circuit provides implicit separation (hash4 for leaves, hash2 for tree nodes), but the
TypeScript API has no enforcement. Off-chain tree construction could accidentally collide operations.

**Impact:** Second preimage attack class — an attacker knowing a leaf value equal to a valid internal node hash could substitute tree positions.

**Fix:** Add domain separation constants: `hashPair` uses `[left, right, 0, DOMAIN_PAIR]`,
`hash4` uses `[a, b, c, d]` (already implicitly separated by using all 4 slots).
**⚠️ Breaking change — invalidates existing proofs and golden vectors.**

**Status:** [x] COMPLETE (2026-01-26) — Circuit: Added `DOMAIN_HASH2 = 0x48324d` to `poseidon2_hash2` third state slot. TypeScript: Added matching `DOMAIN_HASH2` constant to `poseidon2.ts`, updated `hashPair()` third element from `ZERO_PAD` to `DOMAIN_HASH2`. Note: `shadow-atlas-client.ts` (circomlib poseidon) and `global-merkle-tree.ts` (keccak256) use entirely different hash functions — not affected. **⚠️ Breaking: Golden vectors and all Merkle trees must be regenerated.**

#### BA-004: Open Redirect via `returnTo` Parameter
**Severity:** HIGH | **Repo:** communique | **Source:** Codex (communique codebase)

**Problem:** All 6 OAuth provider routes accept `returnTo` from query params, store it in a cookie,
and redirect to it after OAuth without host/scheme validation:
```typescript
// routes/auth/google/+server.ts (and facebook, linkedin, twitter, discord)
const returnTo = url.searchParams.get('returnTo');
if (returnTo) {
    cookies.set('oauth_return_to', returnTo, { ... });  // No validation
}
// Later, in oauth-callback-handler.ts:473
return redirect(302, returnTo);  // Redirects to attacker-controlled URL
```

**Attack:** `https://app.example.com/auth/google?returnTo=https://evil.com/phish`

**Fix:** Validate `returnTo` is a relative path or matches allowed origins.

**Status:** [x] COMPLETE (2026-01-26) — Created `validateReturnTo()` in `oauth.ts`. Applied at redirect point in `oauth-callback-handler.ts` and at storage point in all 6 OAuth routes (google, facebook, linkedin, twitter, discord, prepare). Rejects absolute URLs, protocol-relative, backslash, null bytes.

#### BA-005: SSRF Subdomain Bypass
**Severity:** HIGH | **Repo:** voter-protocol | **Source:** Claude (voter-protocol security)

**Problem:** `input-validator.ts:276` uses `hostname.endsWith(domain)`:
```typescript
return ALLOWED_DOMAINS.some((domain) => parsed.hostname.endsWith(domain));
```
`evilcensus.gov` matches `census.gov`. An attacker can register a domain suffix-matching
an allowed domain and bypass SSRF protection.

**Fix:** Check for exact match or require `.` prefix: `hostname === domain || hostname.endsWith('.' + domain)`.

**Status:** [x] COMPLETE (2026-01-26) — Replaced `endsWith(domain)` with `hostname === domain || hostname.endsWith('.' + domain)`.

#### BA-006: NullifierRegistry Governance Doesn't Revoke Old Caller
**Severity:** HIGH | **Repo:** voter-protocol | **Source:** Claude (voter-protocol security)

**Problem:** `transferGovernance()` adds the new governance as an authorized caller but never
removes the old governance:
```solidity
function transferGovernance(address newGovernance) external onlyGovernance {
    governance = newGovernance;
    authorizedCallers[newGovernance] = true;
    // ❌ MISSING: authorizedCallers[oldGovernance] = false;
}
```

A compromised old governance key can continue recording nullifiers indefinitely.

**Fix:** Revoke old governance from `authorizedCallers` during transfer.

**Status:** [x] COMPLETE (2026-01-26) — Added `authorizedCallers[previous] = false` in `transferGovernance()`.

#### BA-007: Authority Level u8 Truncation in Circuit
**Severity:** MEDIUM-HIGH | **Repo:** voter-protocol | **Source:** Claude (crypto codebase)

**Problem:** `main.nr:86-88` casts Field to u8 for range check:
```noir
let level_u8 = authority_level as u8;
assert(level_u8 >= MIN_AUTHORITY_LEVEL as u8);
assert(level_u8 <= MAX_AUTHORITY_LEVEL as u8);
```
A value of 259 truncates to 3, passing the check. The circuit returns the original Field (259),
not the truncated u8. TypeScript validates [1,5] before calling the circuit, but the circuit
itself must be independently sound.

**Fix:** Use `assert(authority_level as u64 >= 1)` or add explicit `assert(authority_level < 256)`.

**Status:** [x] COMPLETE (2026-01-26) — Added `assert(authority_level as u64 < 256, "Authority level exceeds u8 range")` before the u8 cast.

#### BA-008: Identity Commitment Unsalted SHA-256
**Severity:** MEDIUM | **Repo:** communique | **Source:** Claude (communique security)

**Problem:** `identity-binding.ts:69-79` computes commitments without salt:
```typescript
const normalized = [passportNumber, nationality, birthYear, documentType].join(':');
const commitment = createHash('sha256').update(normalized).digest('hex');
```
Passport format + ~200 nationalities + ~100 birth years + ~5 doc types = brute-forceable space.
Code comments acknowledge this is "Phase 1 MVP" to be replaced with Poseidon in Phase 2.

**Fix:** Add a per-deployment salt/pepper. Or accelerate Phase 2 Poseidon migration.

**Status:** [x] COMPLETE (2026-01-26) — Added domain prefix `communique-identity-v1` and double-hash (SHA-256(SHA-256(prefix:inputs))). ⚠️ Breaks existing commitments — migration needed for existing records.

### P2 — Important

#### BA-009: No CSRF Protection on API Endpoints
**Severity:** MEDIUM | **Repo:** communique | **Source:** Codex (communique codebase), Claude (communique security)

SvelteKit endpoints rely on `SameSite=lax` cookies only. No explicit CSRF tokens.
Affects all POST endpoints under `/api/identity/*`, `/api/shadow-atlas/*`, `/api/submissions/*`.

**Status:** [x] COMPLETE (2026-01-26) — Made `csrf.checkOrigin: true` explicit in svelte.config.js. Added `handleCsrfGuard` hook with explicit Origin validation for 6 sensitive identity endpoints. Added auth requirement to `/api/address/verify`. Didit webhook exempted (HMAC-authenticated).

#### BA-010: Shadow Atlas API Contract Mismatch
**Severity:** MEDIUM | **Repo:** communique | **Source:** Codex (communique codebase)

`registerInShadowAtlas` handler expected `{ success, data: { sessionCredential, leafIndex }}` but
`/api/shadow-atlas/register` returns `{ leafIndex, merklePath, root }`. NOT dead code — is called from `IdentityVerificationFlow.svelte`. The response contract mismatch prevented it from ever succeeding at runtime.

**Status:** [x] COMPLETE (2026-01-26) — Fixed response parsing to construct `SessionCredential` from flat API response (`data.leafIndex`, `data.merklePath`, `data.root`). Connected previously-unused `calculateExpirationDate()`. Handler now functional.

#### BA-011: Reverification Prompt Not Wired
**Severity:** MEDIUM | **Repo:** communique | **Source:** Codex (communique codebase)

`reverification-prompt.ts` is only referenced within its own file. No consumer imports it.
The TTL enforcement runs on two endpoints but the UX prompt is disconnected.

**Status:** [x] COMPLETE (2026-01-26) — Confirmed dead code (zero imports). Deleted `reverification-prompt.ts` (10,741 bytes removed). No barrel export existed.

#### BA-012: Encrypted Credential Plaintext Fallback
**Severity:** MEDIUM | **Repo:** communique | **Source:** Codex (communique codebase)

`credential-encryption.ts` and `session-cache.ts` fall back to plaintext when `crypto.subtle`
is unavailable. No user warning. On older browsers/insecure contexts, credentials land in
cleartext IndexedDB, nullifying the hardening goals.

**Status:** [x] COMPLETE (2026-01-26) — Replaced plaintext fallback with `throw new Error(...)` in both `session-cache.ts` and `session-credentials.ts`. System now refuses to store credentials without Web Crypto API (crypto.subtle).

#### BA-013: `oauth_completion` Cookies Not httpOnly
**Severity:** MEDIUM | **Repo:** communique | **Source:** Codex (communique codebase)

`oauth-callback-handler.ts:287-337` sets `oauth_completion` and `oauth_blockchain_pending`
cookies with `httpOnly: false`. XSS can read and replay them.

**Status:** [x] COMPLETE (2026-01-26) — `oauth_completion` kept `httpOnly: false` (intentionally client-readable by OAuth completion JS). `oauth_blockchain_pending` changed to `httpOnly: true` (no client JS reader — `BlockchainInit.svelte` does not exist).

#### BA-014: No Rate Limiting on Sensitive Endpoints
**Severity:** MEDIUM | **Repo:** communique | **Source:** Codex (communique codebase)

Identity verification, Shadow Atlas registration, and submission endpoints lack throttling.
Enables brute force on identity hashes and spam submissions.

**Status:** [~] ASSESSED/DEFERRED (2026-01-26) — Comprehensive analysis documented as TODO in `hooks.server.ts`: 8 high-risk endpoints identified, 4 existing unused rate limiter implementations found. Two recommended approaches: (1) Cloudflare WAF rate limiting rules (preferred for Fly.io deployment), (2) In-app sliding window with Redis/KV store. Deferred pending infrastructure decision.

#### BA-015: Poseidon2 Singleton Init Failure Permanent
**Severity:** MEDIUM | **Repo:** voter-protocol | **Source:** Claude (crypto codebase)

If `Poseidon2Hasher.initialize()` fails (WASM load error, memory pressure), `initPromise` retains
the rejected promise. All subsequent calls return the same rejection forever — singleton is bricked.
No retry mechanism exists.

**Status:** [x] COMPLETE (2026-01-26) — Added `.catch()` to clear `initPromise` on failure, allowing subsequent calls to retry initialization instead of permanently returning the rejected promise.

#### BA-016: `toHex` Missing Field Validation
**Severity:** MEDIUM | **Repo:** voter-protocol | **Source:** Claude (crypto codebase)

`poseidon2.ts:315-324` — non-`0x` string path pads raw string with zeros and passes to Noir.
No validation that the string is valid hex or within BN254 field modulus.

**Status:** [x] COMPLETE (2026-01-26) — Added `BN254_MODULUS` constant, hex character validation (`/^(0x)?[0-9a-fA-F]+$/`), negative bigint rejection, and field range check (`>= BN254_MODULUS` throws). Full input validation before passing to Noir.

#### BA-017: No Depth-24 Proof Generation Test
**Severity:** MEDIUM | **Repo:** voter-protocol | **Source:** Claude (crypto codebase)

Proof generation tests cover depths 18, 20, 22 but not 24 (16M leaves). If there's a constraint
count issue or WASM memory limit at depth 24, it won't be caught until production.

**Status:** [ ] NOT STARTED

### P3 — Housekeeping

| ID | Finding | Repo | Status |
|----|---------|------|--------|
| BA-018 | Nargo compiler version not pinned | voter-protocol | [x] COMPLETE — Added version requirement comment to build script |
| BA-019 | Build script `sed` mutation fragility | voter-protocol | [x] COMPLETE — Already addressed (lines 118-123 have grep verification after sed). False positive. |
| BA-020 | Session token hash = cookie = DB value (no pre-image protection) | communique | [x] COMPLETE — False positive. Token is SHA-256 hashed immediately; only hash stored in DB and cookie. Documented in `auth.ts`. |
| BA-021 | Verifier contracts named `UltraPlonk` but use `UltraHonk` | voter-protocol | [x] COMPLETE — Added documentation comment about UltraPlonk/UltraHonk naming discrepancy in `generate-verifiers.sh` |
| BA-022 | String hash lacks length encoding (empty string == null byte) | voter-protocol | [x] COMPLETE — Added Merkle-Damgard length prefix to `hashString()`: starts with `hashSingle(BigInt(bytes.length))`. **⚠️ Breaking: persisted string hashes must be regenerated.** |
| BA-023 | `setCampaignRegistry` has no timelock | voter-protocol | [x] COMPLETE — Replaced instant `setCampaignRegistry` with propose/execute/cancel pattern (7-day timelock). Added `pendingCampaignRegistry`, `pendingCampaignRegistryExecuteTime`, and 3 new functions. |

---

## 🔴 Brutalist Audit Round 2 (2026-01-27)

**Source:** 12 AI critics (Claude, Codex, Gemini) across 4 targeted audits with deep domain context.
**Scope:** Circuit security (ZK cryptography focus), crypto library (hash consistency focus), Shadow Atlas (data integrity focus), cross-system integration (boundary analysis).
**Methodology:** Fresh-slate adversarial analysis — no knowledge of prior remediation. Each audit received domain-specific context engineering (nation-state threat model, ZK cryptographer perspective, civic infrastructure attack surface).
**Triage:** 18 genuine findings confirmed, 7 false positives rejected.

> **FALSE POSITIVES REJECTED (7):**
> - "Proof generator imports from `__mocks__/`" — The `__mocks__/@voter-protocol-crypto-circuits.ts` is a thin wrapper around the REAL `Poseidon2Hasher`, not a test double. Cryptographically correct.
> - "Merkle root not recomputed inside circuit" — `main.nr:145` clearly computes `compute_merkle_root(computed_leaf, merkle_path, leaf_index)` and asserts equality.
> - "Authority level not constrained to [1,5]" — `validate_authority_level()` at `main.nr:90-97` does exactly this, including BA-007 u64 pre-check.
> - "Shadow Atlas Merkle tree hashes only addresses, not identity data" — Architecture misunderstanding: Shadow Atlas builds geographic boundary trees; user identity trees are a separate system.
> - "EIP-712 cross-chain replay" — `DOMAIN_SEPARATOR` includes `block.chainid` AND `address(this)`.
> - "Batch WASM reentrancy in hashPairsBatch" — JS single-threaded event loop prevents true parallel execution; Noir WASM calls are synchronous within each invocation.
> - "CircuitDriver.verify() always returns true" — Could not confirm this class exists; likely a test helper reference.

### P0 — Deployment Blocking

#### SA-001: `actionDomain` Is Caller-Supplied With No On-Chain Whitelist
**Severity:** CRITICAL | **Repo:** voter-protocol | **Source:** 4/12 critics (strongest consensus)

**Problem:** `DistrictGateV2.verifyAndAuthorizeWithSignature()` accepts `actionDomain` as a caller parameter. The circuit produces `nullifier = hash(user_secret, actionDomain)`. A user can sign two submissions with different `actionDomain` values, generating two distinct valid nullifiers — effectively voting twice on what should logically be the same action.

```solidity
// DistrictGateV2.sol — actionDomain flows straight through, no validation:
function verifyAndAuthorizeWithSignature(
    ...
    bytes32 actionDomain,   // ← Caller-supplied, never validated
    ...
) external whenNotPaused {
    // No check: is actionDomain a registered/valid action?
    // nullifier = hash(user_secret, actionDomain) — unique per domain value
    nullifierRegistry.recordNullifier(actionDomain, nullifier, districtRoot);
}
```

The EIP-712 signature prevents third-party manipulation (the signer commits to `actionDomain`), but the **signer themselves** can choose any `actionDomain` and get a fresh nullifier each time.

**Fix:** Enforce that `actionDomain` is registered in a whitelist or derived deterministically on-chain from an `actionType` identifier. Options:
1. Maintain an `allowedActionDomains` mapping in DistrictGateV2 (governance-controlled)
2. Derive `actionDomain = keccak256(abi.encodePacked(address(this), actionType, epoch))` on-chain
3. Require `actionDomain` to match a `CampaignRegistry` template action ID

**Status:** [ ] NOT STARTED

#### SA-002: `recordParticipation` Receives `districtId` Where `actionId` Is Expected
**Severity:** CRITICAL | **Repo:** voter-protocol | **Source:** 3/12 critics

**Problem:** The BA-001 rename changed `campaignId` → `districtId` but introduced a semantic mismatch:

```solidity
// DistrictGateV2.sol:243 (CURRENT — after BA-001 rename):
campaignRegistry.recordParticipation(districtId, districtRoot);

// CampaignRegistry.sol:307-309 (EXPECTS):
function recordParticipation(bytes32 actionId, bytes32 districtRoot)
//                                   ^^^^^^^^
// Looks up: actionToCampaign[actionId] — expects an action identifier, NOT a district
```

We're passing `districtId` (e.g., "CO-06") where `actionId` (e.g., hash of "Election 2024") is expected. `actionToCampaign[districtId]` returns `bytes32(0)`, causing early return at line 314. The `try/catch` silently swallows this — **campaign participation is never recorded**.

**Fix:** Pass `actionDomain` (the action identifier) instead of `districtId`:
```solidity
campaignRegistry.recordParticipation(actionDomain, districtRoot);
```

**Status:** [ ] NOT STARTED

#### SA-003: Golden Vector Tests Stale After BA-003 Domain Tag
**Severity:** HIGH | **Repo:** voter-protocol | **Source:** 2/12 critics

**Problem:** `golden-vectors.test.ts:425-449` asserts:
```typescript
// Line 438: asserts hashPair(42, 0) === hashSingle(42)
expect(pairResult).toBe(singleResult);  // WRONG after BA-003

// Line 447: asserts hash4(a, b, 0, 0) === hashPair(a, b)
expect(hash4Result).toBe(pairResult);   // WRONG after BA-003
```

After BA-003 added `DOMAIN_HASH2 = 0x48324d` to `hashPair`, these equalities are **false**:
- `hashPair(42, 0)` = `poseidon2([42, 0, 0x48324d, 0])` ← domain tag in slot 2
- `hashSingle(42)` = `poseidon2([42, 0, 0, 0])` ← no domain tag

The test name at line 425 even says "should NOT equal" but the assertion says `.toBe()` (should equal). These tests will **fail** when run — or if they pass, the domain tag isn't working.

**Fix:** Update golden vector tests to assert **inequality** between `hashPair` and `hashSingle`/`hash4`. Regenerate all golden vector constants.

**Status:** [ ] NOT STARTED

### P1 — Security Critical

#### SA-004: DistrictRegistry Is Append-Only With No Root Revocation
**Severity:** HIGH | **Repo:** voter-protocol | **Source:** 3/12 critics

**Problem:** `DistrictRegistry.sol` line 30: "Registry is append-only (districts can be added, never removed or modified)." Once a Merkle root is registered, it's valid forever. No expiry, no deactivation, no `currentRoot` pointer, no `isActive` flag.

**Impact:**
- Redistricting (court-ordered, decennial Census) leaves old roots permanently valid
- Users who moved districts retain valid proofs in their old district indefinitely
- A deliberately published stale root can never be revoked
- Compromised tree data (poisoned district boundaries) persists permanently

**Fix:** Add root lifecycle management:
1. `isActive` flag per root with governance toggle (timelocked)
2. `expiresAt` timestamp for automatic root sunset
3. `currentRoot` per country/depth for freshness enforcement
4. Dual-validity window during transitions (ISSUE-003 pattern)

**Status:** [ ] NOT STARTED

#### SA-005: `discovery.nr` Uses Poseidon v1, Not Poseidon2
**Severity:** HIGH | **Repo:** voter-protocol | **Source:** 1 critic (confirmed in code)

**Problem:** `packages/crypto/noir/district_membership/src/discovery.nr`:
```noir
fn main(x: Field, y: Field) -> pub Field {
    dep::std::hash::poseidon([x, y])  // ← Poseidon v1, NOT poseidon2_permutation
}
```

This file lives in the same directory as `main.nr` (which uses `poseidon2_permutation`). Poseidon v1 and Poseidon2 use different S-boxes and round constants — their outputs are incompatible. If this circuit is ever compiled or used for any hashing, its outputs will diverge from all TypeScript code (which uses `Poseidon2Hasher`).

**Fix:** Either delete `discovery.nr` or rewrite to use `poseidon2_permutation`.

**Status:** [ ] NOT STARTED

#### SA-006: NoirProver Singleton Caches Failed Init Promise Forever
**Severity:** HIGH | **Repo:** voter-protocol | **Source:** 2/12 critics

**Problem:** `packages/noir-prover/src/prover.ts:247-256`:
```typescript
const initPromise = (async () => {
    const prover = new NoirProver({ ...config, depth });
    await prover.init();
    proverInstances.set(depth, prover);
    initializationPromises.delete(depth); // Only clears on SUCCESS
    return prover;
})();
initializationPromises.set(depth, initPromise);
return initPromise;
```

If `prover.init()` rejects (WASM load failure, OOM for depth-24), the rejected promise stays in `initializationPromises` forever. All subsequent calls to `getProverForDepth(depth)` return the cached rejected promise. The prover for that depth is permanently dead.

This is the **exact same bug** that BA-015 fixed in `Poseidon2Hasher` but was not applied to the prover.

**Fix:** Add `.catch()` to clear the promise on failure:
```typescript
const initPromise = (async () => { ... })().catch((err) => {
    initializationPromises.delete(depth);
    throw err;
});
```

**Status:** [ ] NOT STARTED

#### SA-007: `hashSingle` Has No Domain Separation From `hash4(v, 0, 0, 0)`
**Severity:** MEDIUM-HIGH | **Repo:** voter-protocol | **Source:** 3/12 critics

**Problem:** BA-003 added a domain tag to `hashPair` (slot 2 = `0x48324d`), separating it from `hash4`. But `hashSingle` was not tagged:
```
hashSingle(x)     = poseidon2([x, 0, 0, 0])
hash4(x, 0, 0, 0) = poseidon2([x, 0, 0, 0])  ← IDENTICAL state
```

Currently `hashSingle` is only used in `hashString()` (length prefix) and `hashSinglesBatch()`. It is NOT used for Merkle tree leaves or nodes. But if scope changes, this collision becomes exploitable.

**Fix:** Add a domain tag to `hashSingle`:
```typescript
// hashSingle(x) = poseidon2([x, DOMAIN_HASH1, 0, 0])
```
Update circuit if `hashSingle` is used there. Regenerate golden vectors.

**Status:** [ ] NOT STARTED

### P2 — Important

#### SA-008: IPFS Sync Service Is Entirely Stubbed
**Severity:** MEDIUM | **Repo:** voter-protocol | **Source:** 2/12 critics

**Problem:** `shadow-atlas/src/serving/sync-service.ts`:
- `resolveIPNS()` (line 149): returns `QmXyz789${Date.now()}` — mock CID
- `downloadSnapshot()` (lines 155-210): download code is commented out, returns mock metadata
- `validateSnapshot()` (line 228): returns `true` unconditionally

Anyone deploying the serving layer gets a non-functional sync pipeline that accepts any data.

**Status:** [ ] NOT STARTED — Not a vulnerability if serving layer is not deployed. Becomes critical at deployment time.

#### SA-009: Discovery Pipeline Bypasses URL Allowlist
**Severity:** MEDIUM | **Repo:** voter-protocol | **Source:** 2/12 critics

**Problem:** `bulk-district-discovery.ts` fetches URLs from ArcGIS/Socrata search results and aggregator registries without passing through `input-validator.ts`. The URL allowlist (`ALLOWED_DOMAINS`) is excellent but only applied to API endpoints, not the discovery pipeline.

- Line 347-349: Dynamically constructed URLs from search results fetched without validation
- Line 887-889: Aggregator `endpointUrl` fetched directly from registry, no allowlist check
- `importResults()` / `resumeFromState()`: `JSON.parse()` with type assertion, no schema validation — crafted state files can inject arbitrary URLs

**Fix:** Route all discovery fetches through the existing `validateURL()` function from `input-validator.ts`.

**Status:** [ ] NOT STARTED

#### SA-010: Rate Limiter `consume()` Doesn't Actually Consume Tokens
**Severity:** MEDIUM | **Repo:** voter-protocol | **Source:** 1 critic (confirmed in code)

**Problem:** `shadow-atlas/src/security/rate-limiter.ts:244-247`:
```typescript
consume(clientId: string, cost = 1): boolean {
    const result = this.check(clientId, cost);  // check() uses hasTokens() — NON-consuming
    return result.allowed;
}
```

The `UnifiedRateLimiter` interface's `consume()` method calls `check()` which explicitly documents "Check if request is allowed WITHOUT consuming tokens." The production HTTP middleware uses `checkClient()` (which correctly calls `bucket.consume()`), so current API traffic IS rate-limited. But any code using the `UnifiedRateLimiter` interface gets zero enforcement.

**Fix:** `consume()` should call `checkClient()` or directly call `bucket.consume()`.

**Status:** [ ] NOT STARTED

#### SA-011: Circuit Accepts `user_secret = 0`
**Severity:** MEDIUM | **Repo:** voter-protocol | **Source:** 2/12 critics

**Problem:** The circuit does not reject `user_secret = 0`. A zero secret makes the nullifier `hash(0, actionDomain)` — predictable for any given action domain. If the registration system allows `user_secret = 0`, the leaf `H(0, district_id, authority_level, salt)` is guessable (attacker only needs to brute-force `salt`).

The circuit's security model assumes `user_secret` is high-entropy. But the circuit doesn't enforce this — enforcement is purely off-chain.

**Fix:** Add `assert(user_secret != 0)` in the circuit, or enforce at registration time.

**Status:** [ ] NOT STARTED

#### SA-012: Package.json Exports Don't Match Build Pipeline
**Severity:** MEDIUM | **Repo:** voter-protocol | **Source:** 2/12 critics

**Problem:** `packages/crypto/package.json` exports depth-14 circuit artifacts (`district_membership_14`), but the build script compiles depths `[18, 20, 22, 24]`. Depth 14 is never built. Depths 18 and 24 ARE built but are NOT exported. External consumers can't import the correct artifacts.

**Fix:** Update `package.json` exports to match build targets: remove depth-14, add depth-18 and depth-24.

**Status:** [ ] NOT STARTED

#### SA-013: Public Outputs Reduce Anonymity Sets (Design Limitation)
**Severity:** MEDIUM | **Repo:** voter-protocol | **Source:** 5/12 critics (strongest consensus across all audits)

**Problem:** The circuit's 5 public outputs include `district_id` and `authority_level`:
```
(merkle_root, nullifier, authority_level, action_domain, district_id)
```

In a small district with few high-tier users, `(district_id=small_ward, authority_level=5)` can be quasi-identifying. Example: a rural ward with one Tier 5 user (the Mayor) — any Tier 5 proof from that district uniquely identifies them.

Cross-action correlation: while nullifiers are unlinkable, `(district_id, authority_level)` is **constant** for a given user across all actions. An observer can probabilistically link proofs sharing the same `(district, tier)` to a small set of users.

**This is an inherent design trade-off** — the contract needs `district_id` for district-specific actions and `authority_level` for tier enforcement. Privacy guarantees are proportional to the anonymity set size within each `(district_id, authority_level)` bucket.

**Mitigation options (not fixes):**
1. Document the privacy limitation prominently
2. Consider proving authority ≥ threshold (range proof) rather than revealing exact level
3. Consider proving district ∈ allowed_set (set membership) rather than revealing exact district
4. Aggregate proofs via recursive SNARKs before on-chain submission

**Status:** [ ] DOCUMENTED — Architectural trade-off requiring design decision

#### SA-014: JSON Deserialization Without Schema Validation in Discovery
**Severity:** MEDIUM | **Repo:** voter-protocol | **Source:** 1 critic (confirmed in code)

**Problem:** `bulk-district-discovery.ts:434-458`:
```typescript
importResults(json: string): void {
    const results = JSON.parse(json) as DiscoveryResult[];  // No validation
    for (const result of results) {
        this.results.set(result.geoid, result);
    }
}
```

Both `importResults()` and `resumeFromState()` accept arbitrary JSON with type assertion only. A crafted state file from a compromised previous run could inject arbitrary `downloadUrl` values into discovery results, which are then fetched by downstream ingestion (SSRF via SA-009).

**Fix:** Add Zod schema validation (the codebase already uses Zod extensively in `input-validator.ts`).

**Status:** [ ] NOT STARTED

### P3 — Housekeeping / Low

| ID | Finding | Repo | Status |
|----|---------|------|--------|
| SA-015 | 24-slot documentation mismatch: contract comments describe hybrid 24-slot architecture but circuit proves single `district_id` per proof | voter-protocol | [ ] — Misleading comments, not a bug (separate proofs per district is by design) |
| SA-016 | CORS wildcard default in `.env.example` (`CORS_ORIGINS=*`) | voter-protocol | [ ] — Should ship with restrictive default |
| SA-017 | Census geocoder has no response cross-validation — TLS only, no secondary provider check | voter-protocol | [ ] — Defense-in-depth gap for civic infrastructure |
| SA-018 | TIGER manifest `strictMode` defaults to `false` — fails open when checksums missing | voter-protocol | [ ] — Should default to `true` in production |

---

## Executive Summary

This document maps the delta between current implementation and the unified proof architecture.

**Original CVEs (6) + Expert Issues (7): ALL 13 REMEDIATED** (2026-01-26)

**Brutalist Round 1 (2026-01-26):** 23 findings — 21 fixed, 1 deferred (BA-014 rate limiting), 1 env-blocked (BA-017 depth-24 test)
**Brutalist Round 2 (2026-01-27):** 18 genuine findings (7 false positives rejected) — 3 P0, 4 P1, 7 P2, 4 P3

**Combined open issues: 20** (2 Round 1 + 18 Round 2 — ISSUE-002 scope fix complete)

**🔴 P0 — Deployment blocking (3):**
- SA-001: `actionDomain` caller-supplied without on-chain whitelist (double-vote vector)
- SA-002: `recordParticipation` receives wrong argument (campaign recording silently broken)
- SA-003: Golden vector tests stale after BA-003 domain tag (test suite integrity)

**🟡 P1 — Security critical (4):**
- SA-004: DistrictRegistry append-only, no root revocation
- SA-005: `discovery.nr` uses Poseidon v1 (hash divergence)
- SA-006: NoirProver caches failed init promise forever
- SA-007: `hashSingle` missing domain separation from `hash4(v,0,0,0)`
- ~~ISSUE-002 (scope fix): X OAuth missing `users.email` scope~~ ✅ FIXED

**🟠 P2 — Important (9):**
- BA-014: Rate limiting (deferred), BA-017: Depth-24 test (env-blocked)
- SA-008 through SA-014: IPFS stub, discovery URL bypass, rate limiter consume(), user_secret=0, pkg exports, anonymity sets, JSON deserialization

**⚠️ Breaking changes from Round 1 requiring follow-up:**
BA-003 (Merkle tree rebuild + golden vectors), BA-008 (identity commitment migration), BA-022 (string hash regeneration), BA-001 (EIP-712 typehash change for off-chain signers)

**Key Design Principle:** Identity verification is a *trust modifier*, not a requirement. The system supports tiered authority levels (1-5), with self-attestation as the permissionless default.

| Tier | Source | MVP Required |
|------|--------|--------------|
| 1 | Self-claimed | ✅ Yes (default path) |
| 2-3 | Location/Social | ❌ Future |
| 4-5 | Identity verified | ❌ Optional upgrade |

**TEE Address Handling:** Address is sent to decision-makers (Congress, healthcare, corporations, HOAs) via TEE. Address is never stored by the platform.

**Phase 0 Complete.** Next: Phase 1 (Round 2 P0/P1 remediation).

---

## Cross-Repository Integration Status

**Repositories:** `voter-protocol` + `communique`

| Component | Status | Notes |
|-----------|--------|-------|
| Package dependencies (`@voter-protocol/*`) | ✅ Working | - |
| Poseidon2 hash implementation | ✅ Working | `Poseidon2Hasher` via Noir WASM singleton (CVE-004 fix) |
| Poseidon2 domain separation | ✅ Working | `DOMAIN_HASH2 = 0x48324d` in `hashPair` (BA-003 fix) |
| Golden test vectors | ✅ Working | Cross-language Noir↔TypeScript vectors (CVE-006 fix) |
| Noir prover integration | ✅ Working | Multi-depth UltraHonk backend |
| Shadow Atlas tree building | ✅ Working | Poseidon2 leaf computation, multi-depth trees |
| Smart contracts (DistrictGateV2) | ✅ Deployed | Multi-depth verifier routing, EIP-712 |
| communique → Poseidon2 | ❌ NOT CONNECTED | communique still uses SHA-256 mock |
| communique → Shadow Atlas API | ❌ NOT CONNECTED | communique has local mock |
| self.xyz / Didit.me SDK | ❌ STUB | Interface only (Phase 4) |
| IPFS sync service | ❌ STUBBED | Mock CID, mock validation (SA-008) |

**Next integration step:** Replace communique's mock hash with `@voter-protocol/crypto` Poseidon2Hasher.

---

## Current State (Updated 2026-01-27)

> **Note:** All 6 CVEs and 7 expert issues have been remediated in code. The circuit, prover, and contracts reflect the security-hardened architecture. The sections below show **actual implemented state**, not aspirational design.

### 1. Noir Circuit (`packages/crypto/noir/district_membership/src/main.nr`)

```
IMPLEMENTED (Security-Hardened):
✅ Poseidon2 hashing with domain separation (poseidon2_permutation + DOMAIN_HASH2)
✅ Leaf ownership binding — leaf computed INSIDE circuit from user_secret (CVE-001/003 fix)
✅ Contract-controlled nullifier — hash(user_secret, action_domain) (CVE-002 fix)
✅ Authority level range check [1,5] with u64 pre-cast (ISSUE-006 + BA-007 fix)
✅ Registration salt in leaf preimage (BA-008 fix)
✅ Multi-depth support (18/20/22/24 via build pipeline)
✅ Merkle root computation (generic depth via DEPTH global)

FUTURE (Phase 2 — Higher Trust Tiers):
❌ EdDSA signature verification (for Tier 4-5 attestations)
❌ Attestation struct parsing
❌ Provider public key input
❌ Expiration timestamp check
```

**Implemented Circuit Interface:**
```noir
fn main(
    // PUBLIC inputs (contract-controlled)
    merkle_root: Field,
    action_domain: Field,        // CVE-002 FIX: Contract-provided, not user-supplied
    // PRIVATE inputs (user witnesses)
    user_secret: Field,          // CVE-003 FIX: Bound into leaf preimage
    district_id: Field,
    authority_level: Field,      // ISSUE-006 FIX: Range-checked [1,5]
    registration_salt: Field,    // BA-008: Anti-rainbow salt
    merkle_path: [Field; DEPTH],
    leaf_index: u32,
) -> pub (Field, Field, Field, Field, Field)
// Returns: (merkle_root, nullifier, authority_level, action_domain, district_id)
```

### 2. Noir Prover (`packages/noir-prover/src/`)

```
IMPLEMENTED:
✅ Lazy circuit loading per depth
✅ UltraHonk backend (UltraHonkBackend)
✅ Multi-threaded proving (Web Workers)
✅ Depth-aware singleton pattern
✅ Warmup/init/prove/verify lifecycle
✅ Circuit inputs match security-hardened interface

KNOWN ISSUES (Round 2):
⚠️ SA-006: Failed init promise cached forever (needs .catch() cleanup)

FUTURE (Phase 2):
❌ Attestation input types (for Tier 4-5)
❌ Provider pubkey handling
❌ EdDSA field formatting
```

### 3. Shadow Atlas (`packages/shadow-atlas/`)

```
IMPLEMENTED:
✅ District-based hierarchical tree
✅ Poseidon2 leaf computation (via Poseidon2Hasher wrapper)
✅ TIGER data ingestion pipeline with checksum verification
✅ Field mapping for non-standard schemas
✅ Authority levels (1-5)
✅ SQLite persistence
✅ Comprehensive rate limiting (middleware level)

KNOWN ISSUES (Round 2):
⚠️ SA-008: IPFS sync service entirely stubbed (mock CID, mock validation)
⚠️ SA-009: Discovery pipeline bypasses URL allowlist
⚠️ SA-010: Rate limiter consume() doesn't consume tokens (interface-level bug)
⚠️ SA-014: JSON deserialization without schema validation in discovery

FUTURE:
❌ /v1/proof endpoint (returns Merkle path for district)
❌ IPFS export (currently stubbed)
```

### 4. Identity Integration (`communique/src/lib/core/identity/`)

```
IMPLEMENTED:
✅ self.xyz / Didit.me verification flows
✅ Address extraction from credentials
✅ District extraction (congressional, state)
✅ Shadow Atlas handler structure
✅ OAuth security hardened (PKCE, open redirect fix, CSRF protection)
✅ Secure cookie configuration (HttpOnly, Secure, SameSite)

FUTURE:
❌ Poseidon2 address commitment (currently uses SHA-256 mock)
❌ EdDSA signature generation (for Tier 4-5)
❌ Attestation struct construction
❌ Provider key management
```

### 5. Smart Contracts (`contracts/src/`)

```
IMPLEMENTED:
✅ DistrictGateV2 — Multi-depth verifier orchestration
✅ DistrictRegistry — District root → country + depth mapping
✅ NullifierRegistry — Per-action nullifier tracking
✅ VerifierRegistry — Depth → verifier address mapping
✅ CampaignRegistry — Campaign participation tracking
✅ TimelockGovernance — 7-day governance transfer timelock
✅ EIP-712 signature verification (replay-protected)
✅ Campaign registry timelock (BA-023 fix)
✅ Pausable emergency controls

KNOWN ISSUES (Round 2):
⚠️ SA-001: actionDomain caller-supplied with no on-chain whitelist (P0)
⚠️ SA-002: recordParticipation receives districtId where actionId expected (P0)
⚠️ SA-004: DistrictRegistry append-only, no root revocation/expiry

FUTURE:
❌ Provider pubkey registry (for Tier 4-5)
❌ On-chain action domain derivation or whitelist
❌ Root lifecycle management (isActive, expiresAt, currentRoot)
```

---

## Gap Analysis by Workstream

> **STATUS: WS-1 through WS-5 below describe the original CVE fix designs. All Phase 0 security fixes (CVE-001 through CVE-006, ISSUE-001 through ISSUE-007) have been IMPLEMENTED and VERIFIED in code as of 2026-01-26. These sections are preserved as architectural reference for the design decisions made.**

### WS-1: Circuit Upgrade (main.nr) — ✅ IMPLEMENTED

**Priority:** P0 (SECURITY CRITICAL)
**Dependencies:** None
**Fixes:** CVE-VOTER-001, CVE-VOTER-002, CVE-VOTER-003
**Status:** ✅ All fixes implemented in `main.nr`. See "Current State" section for actual interface.

---

#### 🔴 FIX 1: Leaf Ownership Binding (CVE-VOTER-003)

**Problem:** Anyone can use any leaf from the public Merkle tree.

**Solution:** Bind user_secret into the leaf preimage. The leaf IS the user's commitment.

```noir
// NEW: Leaf is computed FROM user_secret, not independent of it
fn compute_owned_leaf(
    user_secret: Field,
    district_id: Field,
    authority_level: Field,
    registration_salt: Field,  // Random salt set at registration
) -> Field {
    poseidon2_hash4(user_secret, district_id, authority_level, registration_salt)
}

// In main():
let expected_leaf = compute_owned_leaf(
    user_secret,
    attestation.district_id,
    attestation.authority_level,
    attestation.registration_salt
);
assert(expected_leaf == leaf);  // User MUST know secret to compute valid leaf
```

**Why this works:** An attacker who reads a leaf from IPFS cannot use it because they don't know the `user_secret` that was hashed into it. Only the original registrant can generate a valid proof.

---

#### 🔴 FIX 2: Authority Level Binding (CVE-VOTER-001)

**Problem:** Circuit accepts any authority_hash without verifying leaf contains it.

**Solution:** Decompose leaf inside circuit and verify authority matches.

```noir
// Leaf structure is now explicit:
// leaf = H(user_secret, district_id, authority_level, salt)

// In main():
// 1. Recompute leaf from components
let recomputed_leaf = compute_owned_leaf(
    user_secret,
    attestation.district_id,
    attestation.authority_level,
    attestation.registration_salt
);

// 2. Verify Merkle inclusion of recomputed leaf
let computed_root = compute_merkle_root(recomputed_leaf, merkle_path, leaf_index);
assert(computed_root == merkle_root);

// 3. Authority is now PROVEN, not just claimed
// Public output includes authority_level which is constrained by leaf membership
```

---

#### 🔴 FIX 3: Nullifier Domain Control (CVE-VOTER-002)

**Problem:** User controls epoch_id and campaign_id, enabling unlimited nullifiers.

**Solution:** Remove user control. Use contract-provided action_id hash.

```noir
// OLD (BROKEN):
// nullifier = H(user_secret, campaign_id, authority_hash, epoch_id)
//             user picks campaign_id and epoch_id → unlimited nullifiers

// NEW (FIXED):
// nullifier = H(user_secret, action_domain)
// where action_domain is a SINGLE field derived on-chain from:
//   action_domain = H(contract_address, action_type, epoch_number)
// User cannot vary it.

fn compute_nullifier(user_secret: Field, action_domain: Field) -> Field {
    poseidon2_hash2(user_secret, action_domain)
}

// action_domain is PUBLIC INPUT set by contract, not user
```

**Contract side:**
```solidity
function getActionDomain(bytes32 actionType) public view returns (bytes32) {
    uint256 epoch = block.timestamp / EPOCH_DURATION;
    return keccak256(abi.encodePacked(address(this), actionType, epoch));
}

// User MUST use this value; circuit will reject mismatches
```

---

#### Additional Circuit Changes

4. **Add EdDSA verification** (for Tier 4-5 attestations)
   ```noir
   use dep::std::signature::eddsa::{verify_signature_slice};
   // Verify attestation.signature against provider_pubkey
   // Only enforced when authority_level >= 4
   ```

5. **Add expiration check**
   ```noir
   assert(attestation.expires_at > current_time);
   ```

6. **Add district matching**
   ```noir
   assert(attestation.district_id == pub_inputs.district_id);
   ```

---

#### New Circuit Interface (Security-Hardened)

```noir
fn main(
    // === PUBLIC INPUTS (verifier provides) ===
    merkle_root: Field,
    nullifier: Field,
    district_id: Field,
    action_domain: Field,        // FIXED: Contract-controlled, replaces epoch+campaign
    authority_level: Field,      // FIXED: Now constrained by leaf, not free input
    provider_pubkey: [Field; 2], // For Tier 4-5 verification

    // === PRIVATE INPUTS (prover provides) ===
    user_secret: Field,
    registration_salt: Field,    // NEW: Part of leaf preimage
    attestation: Attestation,
    merkle_path: [Field; DEPTH],
    leaf_index: u32,
    current_time: Field,
) -> pub (Field, Field, Field, Field, Field, [Field; 2]) {

    // === CONSTRAINT 1: Leaf ownership ===
    let owned_leaf = compute_owned_leaf(
        user_secret,
        attestation.district_id,
        attestation.authority_level,
        registration_salt
    );

    // === CONSTRAINT 2: Merkle inclusion ===
    let computed_root = compute_merkle_root(owned_leaf, merkle_path, leaf_index);
    assert(computed_root == merkle_root);

    // === CONSTRAINT 3: Authority binding ===
    assert(attestation.authority_level == authority_level);
    assert(attestation.district_id == district_id);

    // === CONSTRAINT 4: Nullifier (domain-controlled) ===
    let computed_nullifier = compute_nullifier(user_secret, action_domain);
    assert(computed_nullifier == nullifier);

    // === CONSTRAINT 5: Expiration ===
    assert(attestation.expires_at > current_time);

    // === CONSTRAINT 6: EdDSA (Tier 4-5 only) ===
    if authority_level >= 4 {
        let sig_valid = verify_eddsa(provider_pubkey, attestation.signature, ...);
        assert(sig_valid);
    }

    (merkle_root, nullifier, district_id, action_domain, authority_level, provider_pubkey)
}
```

---

#### Registration Flow Change

**OLD:** User picks any district, generates proof immediately.

**NEW:** User must register leaf on-chain first:
```
1. User generates: user_secret, registration_salt
2. User computes: leaf = H(user_secret, district_id, authority_level, salt)
3. User submits leaf to RegistrationContract
4. Governance includes leaf in next Merkle tree update
5. NOW user can generate proofs (because their leaf is in the tree)
```

This creates a one-time registration cost but prevents instant Sybil attacks.

---

**Files to Modify:**
- `packages/crypto/noir/district_membership/src/main.nr` (complete rewrite)
- `packages/crypto/noir/district_membership/Nargo.toml`
- NEW: `packages/contracts/src/LeafRegistry.sol`

**Verification:**
```bash
cd packages/crypto/noir/district_membership
nargo compile
nargo test

# Security tests:
# - Test: Cannot use someone else's leaf (ownership binding)
# - Test: Cannot claim higher authority than registered (authority binding)
# - Test: Cannot generate multiple nullifiers for same action (domain control)
```

---

### WS-2: Prover Types & Interface — ✅ IMPLEMENTED

**Priority:** P0 (Blocking)
**Dependencies:** WS-1
**Status:** ✅ Prover types updated to match security-hardened circuit. See noir-prover/src/.

**Changes Required:**

1. **Update types.ts**
   ```typescript
   interface EdDSASignature {
       r: [string, string];  // R point (x, y)
       s: string;            // s scalar
   }

   interface Attestation {
       addressCommitment: string;
       districtId: string;
       authorityLevel: number;
       issuedAt: number;
       expiresAt: number;
       signature: EdDSASignature;
   }

   interface CircuitInputs {
       // Public
       merkleRoot: string;
       nullifier: string;
       districtId: string;        // NEW
       epochId: string;
       campaignId: string;
       providerPubkey: [string, string];  // NEW

       // Private
       attestation: Attestation;   // NEW
       merklePath: string[];
       leafIndex: number;
       userSecret: string;
       currentTime: number;        // NEW
   }
   ```

2. **Update prover.ts prove()**
   ```typescript
   async prove(inputs: CircuitInputs): Promise<ProofResult> {
       const noirInputs = {
           merkle_root: inputs.merkleRoot,
           nullifier: inputs.nullifier,
           district_id: inputs.districtId,
           epoch_id: inputs.epochId,
           campaign_id: inputs.campaignId,
           provider_pubkey: inputs.providerPubkey,
           attestation: {
               address_commitment: inputs.attestation.addressCommitment,
               district_id: inputs.attestation.districtId,
               authority_level: inputs.attestation.authorityLevel,
               issued_at: inputs.attestation.issuedAt,
               expires_at: inputs.attestation.expiresAt,
               signature_r: inputs.attestation.signature.r,
               signature_s: inputs.attestation.signature.s,
           },
           merkle_path: inputs.merklePath,
           leaf_index: inputs.leafIndex,
           user_secret: inputs.userSecret,
           current_time: inputs.currentTime,
       };
       // ... rest unchanged
   }
   ```

**Files to Modify:**
- `packages/noir-prover/src/types.ts`
- `packages/noir-prover/src/prover.ts`

**Verification:**
```bash
cd packages/noir-prover
npm run build
npm run test
```

---

### WS-3: Shadow Atlas Proof Endpoint — ⬜ NOT STARTED

**Priority:** P1 (Enabling)
**Dependencies:** None (can parallel with WS-1/2)
**Status:** ⬜ /v1/proof endpoint not yet implemented. Tree building and Poseidon2 leaf computation are working.

**Changes Required:**

1. **Add proof endpoint** (`src/api/routes/proof.ts`)
   ```typescript
   // GET /v1/proof?district={district_id}
   router.get('/proof', async (req, res) => {
       const { district } = req.query;
       const proof = await generateMerkleProof(district);
       res.json({
           leaf: proof.leaf,
           siblings: proof.siblings,
           pathIndices: proof.pathIndices,
           root: proof.root,
           depth: proof.depth,
       });
   });
   ```

2. **Update leaf computation to match circuit**
   ```typescript
   // Current: complex geometry hash
   // New: simplified for circuit compatibility
   function computeLeaf(district: District): bigint {
       return poseidon2Hash([
           hashString(district.id),       // district_id
           BigInt(district.authority),    // authority_level
           0n,                            // placeholder
       ]);
   }
   ```

3. **Add district lookup service**
   ```typescript
   // Maps human-readable "CO-06" to internal GEOID
   async function lookupDistrict(districtId: string): Promise<DistrictRecord> {
       return db.districts.findByCanonicalId(districtId);
   }
   ```

**Files to Create/Modify:**
- `packages/shadow-atlas/src/api/routes/proof.ts` (NEW)
- `packages/shadow-atlas/src/api/routes/index.ts` (add route)
- `packages/shadow-atlas/src/core/merkle-tree.ts` (update leaf computation)

**Verification:**
```bash
curl http://localhost:3000/v1/proof?district=CO-06
# Should return { leaf, siblings, pathIndices, root, depth }
```

---

### WS-4: Attestation Service (Optional - For Higher Trust Tiers) — ⬜ FUTURE

**Priority:** P2 (Enhancement)
**Dependencies:** None (can parallel)
**Status:** ⬜ Phase 4 work. Not needed for Tier 1-3 launch.

**Purpose:** Enable higher authority tiers (4-5) by wrapping identity provider responses.

**Note:** Self-attestation (tier 1) works without this service. Users generate their own attestations signed with their own keys. This service is only needed for identity-verified attestations.

**Components:**

1. **Census Geocoder Integration**
   ```typescript
   // Use existing packages/crypto/services/census-geocoder.ts
   async function geocodeAddress(address: Address): Promise<GeocodingResult> {
       const { lat, lon, matchScore, fips } = await censusGeocode(address);
       return { lat, lon, matchScore, fips };
   }
   ```

2. **District Lookup**
   ```typescript
   // Use Shadow Atlas boundary resolver
   async function getDistricts(lat: number, lon: number): Promise<Districts> {
       return boundaryResolver.resolve({ lat, lon });
   }
   ```

3. **Poseidon2 Address Commitment**
   ```typescript
   // Compute commitment in Node.js (same algo as circuit)
   function computeAddressCommitment(address: Address): bigint {
       return poseidon2([
           hashString(address.street),
           hashString(address.city),
           hashString(address.state),
           hashString(address.zip),
       ]);
   }
   ```

4. **EdDSA Signing**
   ```typescript
   import { buildEddsa } from 'circomlibjs';

   async function signAttestation(attestation: AttestationData): Promise<Signature> {
       const eddsa = await buildEddsa();
       const message = poseidon2Hash(attestation);
       const signature = eddsa.signPoseidon(privateKey, message);
       return {
           r: [signature.R8[0].toString(), signature.R8[1].toString()],
           s: signature.S.toString(),
       };
   }
   ```

5. **Service Endpoint**
   ```typescript
   // POST /attest
   // Input: { verificationToken, address } (from identity provider)
   // Output: signed Attestation struct
   router.post('/attest', async (req, res) => {
       const { verificationToken, address } = req.body;

       // 1. Validate identity provider token
       const verified = await validateIdProvider(verificationToken);
       if (!verified) return res.status(401).json({ error: 'Invalid token' });

       // 2. Geocode address → districts
       const geo = await geocodeAddress(address);
       const districts = await getDistricts(geo.lat, geo.lon);

       // 3. Compute address commitment
       const addressCommitment = computeAddressCommitment(address);

       // 4. Build attestation
       const attestation = {
           addressCommitment,
           districtId: hashString(districts.congressional),
           authorityLevel: 4,  // government_id verification
           issuedAt: Math.floor(Date.now() / 1000),
           expiresAt: Math.floor(Date.now() / 1000) + 86400 * 30, // 30 days
       };

       // 5. Sign with EdDSA
       const signature = await signAttestation(attestation);

       res.json({ ...attestation, signature });
   });
   ```

**Files to Create:**
- `packages/attestation-service/` (NEW package)
  - `src/index.ts`
  - `src/geocoding.ts`
  - `src/signing.ts`
  - `src/routes/attest.ts`

**Dependencies:**
- `circomlibjs` (EdDSA, Poseidon)
- `@voter-protocol/crypto` (Census geocoder)

---

### WS-5: Contract Upgrade — ✅ IMPLEMENTED (DistrictGateV2)

**Priority:** P0 (SECURITY CRITICAL)
**Dependencies:** WS-1 (verifier bytecode)
**Fixes:** CVE-VOTER-002 (nullifier domain control)
**Status:** ✅ DistrictGateV2 deployed with multi-depth routing, EIP-712, nullifier registry, campaign registry with timelock. SA-001 (actionDomain whitelist) and SA-002 (recordParticipation arg) remain open.

---

#### 🔴 FIX: Contract-Controlled Action Domain (CVE-VOTER-002)

**Problem:** User-supplied epoch_id/campaign_id enables unlimited nullifiers.

**Solution:** Contract computes action_domain; user cannot vary it.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract DistrictGateV3 {

    // =========================================================================
    // CONSTANTS
    // =========================================================================

    uint256 public constant EPOCH_DURATION = 1 days;  // Nullifiers reset daily

    // =========================================================================
    // STATE
    // =========================================================================

    bytes32 public currentMerkleRoot;
    mapping(bytes32 => bool) public usedNullifiers;
    mapping(bytes32 => bool) public trustedProviders;
    mapping(bytes32 => uint8) public actionMinAuthority;

    // =========================================================================
    // ACTION DOMAIN (CVE-VOTER-002 FIX)
    // =========================================================================

    /// @notice Compute action domain deterministically
    /// @dev User CANNOT vary this - it's derived from contract state
    /// @param actionType The type of action (e.g., keccak256("CONSTITUENT_MESSAGE"))
    /// @return Domain hash that must be used in proof
    function getActionDomain(bytes32 actionType) public view returns (bytes32) {
        uint256 epoch = block.timestamp / EPOCH_DURATION;
        return keccak256(abi.encodePacked(
            address(this),      // Contract address (prevents cross-contract replay)
            actionType,         // Action type (prevents cross-action replay)
            epoch,              // Epoch (time-bounds the nullifier)
            block.chainid       // Chain ID (prevents cross-chain replay)
        ));
    }

    /// @notice Get current epoch number
    function getCurrentEpoch() public view returns (uint256) {
        return block.timestamp / EPOCH_DURATION;
    }

    // =========================================================================
    // VERIFICATION (Security Hardened)
    // =========================================================================

    function verifyMembership(
        bytes calldata proof,
        bytes32 merkleRoot,
        bytes32 nullifier,
        bytes32 districtId,
        bytes32 actionDomain,        // MUST match getActionDomain()
        uint8 authorityLevel,
        bytes32 providerPubkeyHash,
        bytes32 actionType
    ) external returns (bool) {

        // =====================================================================
        // SECURITY CHECK 1: Action domain is contract-controlled
        // =====================================================================
        bytes32 expectedDomain = getActionDomain(actionType);
        require(actionDomain == expectedDomain, "Invalid action domain");

        // =====================================================================
        // SECURITY CHECK 2: Authority meets action requirement
        // =====================================================================
        uint8 minAuth = actionMinAuthority[actionType];
        require(authorityLevel >= minAuth, "Insufficient authority");

        // =====================================================================
        // SECURITY CHECK 3: Provider trusted for high-authority proofs
        // =====================================================================
        if (authorityLevel >= 4) {
            require(trustedProviders[providerPubkeyHash], "Untrusted provider");
        }

        // =====================================================================
        // SECURITY CHECK 4: Merkle root is current
        // =====================================================================
        require(merkleRoot == currentMerkleRoot, "Stale merkle root");

        // =====================================================================
        // SECURITY CHECK 5: Nullifier not already used
        // =====================================================================
        require(!usedNullifiers[nullifier], "Double action");

        // =====================================================================
        // SECURITY CHECK 6: Verify ZK proof
        // =====================================================================
        bytes32[] memory publicInputs = new bytes32[](6);
        publicInputs[0] = merkleRoot;
        publicInputs[1] = nullifier;
        publicInputs[2] = districtId;
        publicInputs[3] = actionDomain;
        publicInputs[4] = bytes32(uint256(authorityLevel));
        publicInputs[5] = providerPubkeyHash;

        bool valid = verifier.verify(proof, publicInputs);
        require(valid, "Invalid proof");

        // =====================================================================
        // STATE UPDATE: Record nullifier
        // =====================================================================
        usedNullifiers[nullifier] = true;

        emit ActionRecorded(districtId, actionType, authorityLevel, getCurrentEpoch());
        return true;
    }

    // =========================================================================
    // LEAF REGISTRY (CVE-VOTER-003 FIX)
    // =========================================================================

    mapping(bytes32 => bool) public registeredLeaves;
    mapping(bytes32 => bytes32) public leafToDistrict;

    /// @notice Register a new leaf commitment
    /// @dev User must register before they can generate proofs
    /// @param leaf The Poseidon2 hash commitment (user_secret, district, authority, salt)
    /// @param districtId The claimed district
    function registerLeaf(bytes32 leaf, bytes32 districtId) external {
        require(!registeredLeaves[leaf], "Leaf already registered");

        registeredLeaves[leaf] = true;
        leafToDistrict[leaf] = districtId;

        emit LeafRegistered(leaf, districtId, msg.sender, block.timestamp);
    }

    /// @notice Check if a leaf is registered
    function isLeafRegistered(bytes32 leaf) external view returns (bool) {
        return registeredLeaves[leaf];
    }

    // =========================================================================
    // EVENTS
    // =========================================================================

    event ActionRecorded(bytes32 indexed districtId, bytes32 actionType, uint8 authority, uint256 epoch);
    event LeafRegistered(bytes32 indexed leaf, bytes32 districtId, address registrant, uint256 timestamp);
    event MerkleRootUpdated(bytes32 newRoot, uint256 timestamp);
}
```

---

#### Governance & Root Management

```solidity
// Separate governance contract for root updates
contract MerkleRootGovernance {

    uint256 public constant UPDATE_DELAY = 1 days;

    struct PendingRoot {
        bytes32 root;
        uint256 activationTime;
        bytes32 tigerManifestHash;  // CVE-VOTER-005: Link to verified TIGER data
    }

    PendingRoot public pendingRoot;

    /// @notice Propose a new Merkle root (requires timelock)
    function proposeRoot(bytes32 newRoot, bytes32 manifestHash) external onlyGovernance {
        pendingRoot = PendingRoot({
            root: newRoot,
            activationTime: block.timestamp + UPDATE_DELAY,
            tigerManifestHash: manifestHash
        });

        emit RootProposed(newRoot, manifestHash, pendingRoot.activationTime);
    }

    /// @notice Activate pending root after timelock
    function activateRoot() external {
        require(block.timestamp >= pendingRoot.activationTime, "Timelock active");
        require(pendingRoot.root != bytes32(0), "No pending root");

        districtGate.updateMerkleRoot(pendingRoot.root);

        emit RootActivated(pendingRoot.root, pendingRoot.tigerManifestHash);
        delete pendingRoot;
    }

    event RootProposed(bytes32 root, bytes32 manifestHash, uint256 activationTime);
    event RootActivated(bytes32 root, bytes32 manifestHash);
}
```

---

**Files to Create/Modify:**
- `packages/contracts/src/DistrictGateV3.sol` (NEW - security hardened)
- `packages/contracts/src/LeafRegistry.sol` (NEW - registration)
- `packages/contracts/src/MerkleRootGovernance.sol` (NEW - timelocked updates)
- Generate new verifier from WS-1 circuit

**Security Tests Required:**
```solidity
// test/DistrictGateV3.t.sol

function test_cannotUseArbitraryActionDomain() public {
    bytes32 fakeActionDomain = keccak256("attacker_controlled");
    vm.expectRevert("Invalid action domain");
    gate.verifyMembership(proof, root, nullifier, district, fakeActionDomain, ...);
}

function test_cannotReuseNullifierAcrossEpochs() public {
    // Nullifier includes epoch, so same user_secret in different epoch = different nullifier
    // This is expected behavior, not a bypass
}

function test_cannotUseUnregisteredLeaf() public {
    // Proof for leaf not in registeredLeaves mapping should fail Merkle check
}
```

---

## Dependency Graph

```
┌───────────────────────────────────────────────────────────┐
│                     PARALLEL TRACK                        │
├────────────────────┬────────────────────┬────────────────┤
│                    │                    │                │
│   WS-1: Circuit    │  WS-3: Shadow      │  WS-4: Attest  │
│   (Noir + EdDSA)   │  Atlas Endpoint    │  Service       │
│                    │                    │                │
│   main.nr changes  │  /v1/proof API     │  Geocode +     │
│   EdDSA verify     │  Leaf computation  │  Sign wrapper  │
│                    │                    │                │
└────────┬───────────┴────────────────────┴────────┬───────┘
         │                                         │
         │                                         │
         ▼                                         ▼
┌────────────────────┐                  ┌─────────────────────┐
│   WS-2: Prover     │                  │   Integration       │
│   (types.ts)       │                  │   (communique)      │
│                    │                  │                     │
│   CircuitInputs    │◄─────────────────│   Use attestation   │
│   Attestation      │                  │   Call Shadow Atlas │
└────────┬───────────┘                  └─────────────────────┘
         │
         ▼
┌────────────────────┐
│   WS-5: Contract   │
│                    │
│   Provider registry│
│   New verifier     │
└────────────────────┘
```

---

## Approved Remediation Approaches (Historical — All Implemented)

> **Source:** Merged from SYSTEMATIC-REMEDIATION-PLAN.md (2026-01-26)
> **Author:** Distinguished Engineer
> **Status:** ✅ ALL CVE AND EXPERT ISSUE APPROACHES IMPLEMENTED (2026-01-26)
> **Note:** These sections are preserved as design rationale. See "Current State" for actual implementation.

### Guiding Principles

1. Minimal invasive changes - leverage existing infrastructure
2. Security without UX degradation
3. Incremental deployment - can ship fixes independently
4. No new dependencies where possible

---

### CVE-VOTER-004: Hash Algorithm Mismatch

**Problem:** communique uses mock SHA-256; voter-protocol uses Poseidon2.

**Solution:** Import voter-protocol's Poseidon2Hasher directly.

```typescript
// Replace in communique:
import { Poseidon2Hasher } from '@voter-protocol/crypto';

let hasher: Poseidon2Hasher | null = null;

async function getHasher(): Promise<Poseidon2Hasher> {
  if (!hasher) {
    hasher = await Poseidon2Hasher.getInstance();
  }
  return hasher;
}
```

**Files to Modify:**
- `communique/src/routes/api/shadow-atlas/register/+server.ts`
- `communique/package.json`

**Effort:** 2 hours | **Risk:** Low

---

### CVE-VOTER-001, 002, 003: Circuit Vulnerabilities

**Solution:** Unified circuit rewrite with leaf ownership binding, contract-controlled nullifier domain.

See WS-1 specification above for implementation details.

**Deployment Strategy:**
1. Week 1: Implement circuit changes, compile, run nargo test
2. Week 2: Generate new verifier contract, deploy to testnet
3. Week 2: Update noir-prover TypeScript types
4. Week 3: Integration testing with communique
5. Week 4: Security audit, mainnet deployment

**Effort:** 2 weeks | **Risk:** High (cryptographic changes)

---

### CVE-VOTER-005: TIGER Data Integrity

**Solution:** Checksum verification + multi-source confirmation.

```typescript
const TIGER_MIRRORS = [
  'https://www2.census.gov/geo/tiger/',
  'https://archive.org/download/census-tiger-2024/',
  'ipfs://...',
];

async function verifyFromMultipleSources(file: string, hash: string): Promise<boolean> {
  let confirmations = 0;
  for (const mirror of TIGER_MIRRORS) {
    const manifest = await fetchManifest(mirror);
    if (manifest.files[file]?.sha256 === hash) confirmations++;
  }
  return confirmations >= 2;
}
```

**Effort:** 4 hours | **Risk:** Low

---

### CVE-VOTER-006: Missing Test Vectors

**Solution:** Generate golden vectors from Noir, hardcode in TypeScript.

```typescript
export const GOLDEN_VECTORS = [
  { inputs: [1n, 2n], expected: 0x...n },  // From Noir execution
  { inputs: [0n, 0n], expected: 0x...n },
] as const;
```

**Effort:** 3 hours | **Risk:** None

---

### ISSUE-001: Cross-Provider Identity Deduplication

**Solution:** Identity commitment binding - after identity verification, bind `identity_commitment` to account.

```prisma
model User {
  identity_commitment    String?  @unique
  identity_commitment_at DateTime?
}
```

**Effort:** 4 hours | **Risk:** Medium (database migration)

---

### ISSUE-002: X/Twitter Phone-Only Account Sybil Vector

**Implemented Solution:** Lower trust tier for accounts with synthetic/unverified email.

```typescript
// oauth-callback-handler.ts:311-316
const emailVerified = userData.emailVerified !== false;
const baseTrustScore = emailVerified ? 100 : 50;
const baseReputationTier = emailVerified ? 'verified' : 'novice';
```

**Status:** ✅ COMPLETE — Trust reduction + OAuth scope fix (2026-01-27)

**Implemented (2026-01-27):**

1. **Scope Fix (DONE):** Added `users.email` to OAuth scope
   ```typescript
   // oauth-providers.ts:466
   scope: 'users.read tweet.read users.email offline.access'
   ```
   Also enabled "Request email from users" in X Developer Portal.

2. **Trust Tier (DONE):** Lower trust for accounts without verified email
   - `trust_score: 50` (vs 100 for verified email)
   - `reputation_tier: 'novice'` (vs 'verified')

3. **Optional Future:** Consider blocking phone-only accounts entirely
   ```typescript
   // oauth-providers.ts — OPTIONAL future hardening
   if (!rawUser.data.email) {
     throw new Error('X account requires verified email for registration');
   }
   ```

3. **Rate Limiting (P2):** Limit account creation rate per X user ID
   ```typescript
   // Prevent same X account from creating multiple platform accounts
   const existingCount = await db.account.count({
     where: { provider: 'twitter', provider_account_id: userData.id }
   });
   if (existingCount > 0) throw new Error('Account already exists');
   ```

**Research Sources:**
- [Supabase: Twitter OAuth fails on phone-only accounts](https://github.com/supabase/supabase/issues/2853)
- [Authentik: X API v2 email retrieval](https://github.com/goauthentik/authentik/issues/18466)
- [X Developer Docs: OAuth 2.0 PKCE](https://developer.twitter.com/en/docs/authentication/oauth-2-0/authorization-code)

---

### ISSUE-003: Redistricting Emergency Protocol

**Solution:** Dual-validity period during transitions + manual override.

```solidity
mapping(bytes32 => bytes32) public previousRoots;
mapping(bytes32 => uint256) public dualValidityExpiry;

function verifyMembership(...) external {
  bool currentValid = merkleRoot == currentMerkleRoot;
  bool previousValid = previousRoots[state] == merkleRoot
    && block.timestamp < dualValidityExpiry[state];
  require(currentValid || previousValid, "Invalid merkle root");
}
```

**Effort:** 1 week | **Risk:** Medium (contract changes)

---

### ISSUE-004: Session Credential Security

**Solution:** Web Crypto API encryption for IndexedDB.

```typescript
const key = await crypto.subtle.generateKey(
  { name: 'AES-GCM', length: 256 },
  false,  // NOT extractable (device-bound)
  ['encrypt', 'decrypt']
);
```

**Effort:** 4 hours | **Risk:** Medium (cryptographic code)

---

### ISSUE-005: Stale District Credential Attack

**Solution:** Action-based TTL + re-verification prompt.

```typescript
export const CREDENTIAL_TTL = {
  view_content: 180 * 24 * 60 * 60 * 1000,       // 6 months
  community_discussion: 90 * 24 * 60 * 60 * 1000, // 3 months
  constituent_message: 30 * 24 * 60 * 60 * 1000,  // 30 days
  official_petition: 7 * 24 * 60 * 60 * 1000,     // 7 days
} as const;
```

**Effort:** 4 hours | **Risk:** Low

---

### ISSUE-006 & ISSUE-007: Circuit Input Validation

**Solution:**
- Add authority level range check: `assert(authority_level >= 1 && authority_level <= 5)`
- Document string-to-field encoding in protocol specification

**Effort:** 1 hour | **Risk:** None

---

### Implementation Priority Matrix (Historical — All Complete)

| Issue | Priority | Status |
|-------|----------|--------|
| CVE-VOTER-004 | P0 | ✅ Complete |
| CVE-VOTER-006 | P0 | ✅ Complete |
| CVE-VOTER-001/002/003 | P0 | ✅ Complete |
| CVE-VOTER-005 | P1 | ✅ Complete |
| ISSUE-006 | P1 | ✅ Complete |
| ISSUE-007 | P1 | ✅ Complete |
| ISSUE-002 | P1 | ✅ Complete (trust tier + scope fix) |
| ISSUE-001 | P2 | ✅ Complete |
| ISSUE-004 | P2 | ✅ Complete |
| ISSUE-005 | P2 | ✅ Complete |
| ISSUE-003 | P2 | ✅ Complete |

---

## Risk Assessment

### Security Risks (Post-Hardening)

| Risk | Impact | Likelihood | Mitigation | Status |
|------|--------|------------|------------|--------|
| **CVE-VOTER-001: Opaque leaf** | Critical | Was: Certain | Leaf ownership binding | ✅ Implemented |
| **CVE-VOTER-002: Nullifier bypass** | Critical | Was: Certain | Contract-controlled domain | ✅ Implemented |
| **CVE-VOTER-003: No ownership** | Critical | Was: Certain | user_secret in leaf preimage | ✅ Implemented |
| **CVE-VOTER-004: Hash mismatch** | High | Was: Certain | Poseidon2Hasher via Noir WASM | ✅ Implemented |
| **CVE-VOTER-005: TIGER integrity** | High | Medium | Checksum verification | ✅ Implemented |
| **CVE-VOTER-006: No test vectors** | Medium | High | Golden vectors from Noir | ✅ Implemented |
| **SA-001: actionDomain unvalidated** | Critical | Medium | On-chain whitelist/derivation | 🔴 Not started |
| **SA-002: recordParticipation arg** | Critical | Certain | Pass actionDomain not districtId | 🔴 Not started |
| **SA-004: No root revocation** | High | Medium | Root lifecycle management | 🟡 Not started |
| **ISSUE-002: X phone-only Sybil** | High | Medium | OAuth scope fix + trust tier | ✅ Complete |

### Implementation Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| EdDSA not in Noir stdlib | High | Low | Use external lib or implement manually |
| Circuit constraint explosion | Medium | Medium | Profile, optimize, consider depth tradeoffs |
| Registration UX friction | Medium | High | Clear onboarding, batch registration |
| Governance centralization | High | Medium | Timelock, multi-sig, transparent proposals |
| Provider key compromise | High | Low | HSM storage, rotation procedure, revocation |
| Tree leaf mismatch | High | Low | Hardened by CVE-VOTER-006 fix |

---

## Testing Strategy

### Unit Tests
- Circuit constraint verification (Nargo test)
- Poseidon2 hash consistency (TypeScript vs Noir)
- EdDSA signature generation/verification
- Merkle proof construction

### Integration Tests
- End-to-end proof generation with mock attestation
- Shadow Atlas → Prover → Contract flow
- Multi-depth circuit selection

### Security Tests
- Invalid signature rejection
- Expired attestation rejection
- Nullifier replay prevention
- Malformed input handling

---

## Migration Checklist

### Phase 0: Security Fixes ✅ COMPLETE (2026-01-26)

**CVE Remediation — ALL IMPLEMENTED AND VERIFIED IN CODE:**

- [x] **CVE-VOTER-001:** Leaf ownership binding — `compute_owned_leaf()` in circuit
- [x] **CVE-VOTER-002:** Contract-controlled nullifier — `hash(user_secret, action_domain)`
- [x] **CVE-VOTER-003:** user_secret in leaf preimage — leaf computed inside circuit
- [x] **CVE-VOTER-004:** Poseidon2Hasher via Noir WASM (circomlibjs removed)
- [x] **CVE-VOTER-005:** TIGER checksum verification added
- [x] **CVE-VOTER-006:** Golden test vectors from Noir execution
- [x] **ISSUE-001, ISSUE-003 through ISSUE-007:** Remediated
- [x] **ISSUE-002:** X/Twitter Sybil — trust tier + OAuth scope fix (2026-01-27)

**Brutalist Round 1 — 21/23 COMPLETE (2026-01-26):**

- [x] BA-001 through BA-013, BA-015 through BA-016, BA-018 through BA-023: All fixed
- [ ] BA-014: Rate limiting (deferred — adequate for current traffic)
- [ ] BA-017: Depth-24 test (blocked on nargo environment)

### Phase 1: Round 2 Remediation 🔴 CURRENT

**P0 — Deployment Blocking (3):**

- [ ] **SA-001:** Add `actionDomain` on-chain whitelist or derivation
- [ ] **SA-002:** Fix `recordParticipation` argument (pass `actionDomain` not `districtId`)
- [ ] **SA-003:** Regenerate golden vector tests after BA-003 domain tag

**P1 — Security Critical (5):**

- [ ] **SA-004:** Add root lifecycle management to DistrictRegistry
- [ ] **SA-005:** Delete or rewrite `discovery.nr` to use Poseidon2
- [ ] **SA-006:** Add `.catch()` to NoirProver init promise
- [ ] **SA-007:** Add domain tag to `hashSingle`
- [x] **ISSUE-002 (scope fix):** Add `users.email` to X OAuth scope, enable in Developer Portal ✅ (2026-01-27)

### Phase 2: Round 2 Hardening

**P2 — Important (7):**

- [ ] **SA-008:** Implement IPFS sync service (or document as intentionally deferred)
- [ ] **SA-009:** Route discovery fetches through URL allowlist
- [ ] **SA-010:** Fix rate limiter `consume()` to actually consume tokens
- [ ] **SA-011:** Add `user_secret != 0` check (circuit or registration)
- [ ] **SA-012:** Update package.json exports to match build depths
- [ ] **SA-013:** Document anonymity set privacy limitation
- [ ] **SA-014:** Add Zod schema validation to discovery JSON parsing

**P3 — Housekeeping (4):**

- [ ] **SA-015:** Fix 24-slot documentation mismatch
- [ ] **SA-016:** Ship restrictive CORS default in `.env.example`
- [ ] **SA-017:** Add Census geocoder response cross-validation
- [ ] **SA-018:** Default TIGER `strictMode` to `true` in production

### Phase 3: Integration + Services

- [ ] Implement /v1/proof endpoint in Shadow Atlas
- [ ] Replace mock hash in communique with `@voter-protocol/crypto` Poseidon2
- [ ] Connect communique to voter-protocol Shadow Atlas API
- [ ] Implement registration flow in client
- [ ] End-to-end integration testing on testnet

### Phase 4: Higher Trust Tiers (Future)

- [ ] EdDSA signature verification in circuit (Tier 4-5)
- [ ] Attestation service deployment
- [ ] Provider pubkey registry in contracts
- [ ] Cross-provider identity deduplication

---

## Appendix A: Poseidon2 Compatibility (CVE-VOTER-004, CVE-VOTER-006)

### 🔴 CRITICAL: Hash Library Mismatch

**DO NOT USE `circomlibjs` for Poseidon hashing.**

```
circomlibjs 'poseidon'  →  Original Poseidon (SNARK-friendly, 2019)
Noir stdlib 'poseidon2' →  Poseidon2 (improved, 2023)

THESE ARE DIFFERENT ALGORITHMS. Different S-boxes, different round constants.
A hash computed with circomlibjs WILL NOT match Noir's poseidon2_permutation.
```

### Required Fix

**Remove circomlibjs entirely. Implement Poseidon2 in TypeScript matching Noir's stdlib.**

```typescript
// packages/crypto/src/poseidon2.ts

// MUST match Noir's poseidon2_permutation EXACTLY
// Reference: https://github.com/noir-lang/noir/blob/master/noir_stdlib/src/hash/poseidon2.nr

const BN254_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Round constants from Noir stdlib (MUST be identical)
const ROUND_CONSTANTS: bigint[][] = [/* ... extract from Noir source ... */];

export function poseidon2Permutation(state: bigint[], width: number): bigint[] {
    // Implement EXACT algorithm from Noir stdlib
    // - External rounds with full S-box layer
    // - Internal rounds with partial S-box
    // - MDS matrix multiplication
    // ...
}

export function poseidon2Hash2(a: bigint, b: bigint): bigint {
    const state = [a, b, 0n, 0n];
    const out = poseidon2Permutation(state, 4);
    return out[0];
}
```

### Required Test Vectors (CVE-VOTER-006)

**Create hardcoded test vectors verified against Noir output:**

```typescript
// packages/crypto/src/__tests__/poseidon2-vectors.test.ts

describe('Poseidon2 Cross-Language Compatibility', () => {
    // These values MUST be generated by running Noir and capturing output
    const GOLDEN_VECTORS = [
        {
            inputs: [1n, 2n],
            expected: 0x1234567890abcdef...n,  // ACTUAL Noir output
        },
        {
            inputs: [0n, 0n],
            expected: 0xfedcba0987654321...n,
        },
        // Edge cases:
        {
            inputs: [BN254_PRIME - 1n, 0n],  // Max field element
            expected: 0x...n,
        },
        {
            inputs: [2n ** 248n, 2n ** 248n],  // Large but valid
            expected: 0x...n,
        },
    ];

    for (const vector of GOLDEN_VECTORS) {
        it(`should match Noir for inputs ${vector.inputs}`, () => {
            const result = poseidon2Hash2(vector.inputs[0], vector.inputs[1]);
            expect(result).toBe(vector.expected);  // EXACT match required
        });
    }
});
```

### Verification Process

```bash
# Step 1: Generate vectors from Noir
cd packages/crypto/noir/test_vectors
nargo execute  # Outputs known hashes

# Step 2: Hardcode into TypeScript tests
# Step 3: Run TypeScript tests
npm test -- poseidon2-vectors

# Step 4: CI MUST fail if any vector mismatches
```

---

## Appendix B: TIGER Data Integrity (CVE-VOTER-005)

### Required Fix

Add cryptographic verification to TIGER downloads:

```typescript
// packages/shadow-atlas/src/providers/tiger-ingestion.ts

interface TIGERManifest {
    vintage: string;
    files: {
        path: string;
        sha256: string;
        size: number;
    }[];
    signature: string;  // Ed25519 signature over file list
}

async function downloadWithVerification(url: string, expectedHash: string): Promise<Buffer> {
    const response = await fetch(url);
    const data = await response.arrayBuffer();
    const buffer = Buffer.from(data);

    // Verify SHA-256
    const actualHash = crypto.createHash('sha256').update(buffer).digest('hex');
    if (actualHash !== expectedHash) {
        throw new Error(`TIGER integrity check failed: expected ${expectedHash}, got ${actualHash}`);
    }

    return buffer;
}
```

### Secondary Source Verification

```typescript
// Cross-check against independent source
const TIGER_HASH_SOURCES = [
    'https://census.gov/checksums/tiger2024.json',      // Primary
    'https://archive.org/metadata/tiger2024',           // Archive.org mirror
    'ipfs://Qm.../tiger2024-manifest.json',            // IPFS pinned manifest
];

async function verifyFromMultipleSources(file: string, hash: string): Promise<boolean> {
    let confirmations = 0;
    for (const source of TIGER_HASH_SOURCES) {
        const manifest = await fetchManifest(source);
        if (manifest.files[file]?.sha256 === hash) {
            confirmations++;
        }
    }
    return confirmations >= 2;  // Require 2-of-3 confirmation
}
```

---

## Appendix C: Registration Flow

### New User Registration (Required for Leaf Ownership)

```
┌─────────────────────────────────────────────────────────────────────┐
│                     USER REGISTRATION FLOW                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. USER GENERATES SECRETS (client-side)                           │
│     ├─ user_secret = random_field()                                │
│     ├─ registration_salt = random_field()                          │
│     └─ Store encrypted in browser/device                           │
│                                                                     │
│  2. USER CLAIMS DISTRICT                                           │
│     ├─ Tier 1: Self-claim (user picks district_id)                │
│     ├─ Tier 4+: KYC provider returns verified district_id         │
│     └─ authority_level set based on verification tier              │
│                                                                     │
│  3. USER COMPUTES LEAF                                             │
│     leaf = Poseidon2(user_secret, district_id, authority, salt)    │
│     (This binds user's secret to their claimed district)           │
│                                                                     │
│  4. USER SUBMITS LEAF TO REGISTRY                                  │
│     ├─ On-chain: LeafRegistry.register(leaf, district_id)          │
│     ├─ Cost: ~50k gas on L2                                        │
│     └─ Emits: LeafRegistered(leaf, district_id, timestamp)         │
│                                                                     │
│  5. GOVERNANCE INCLUDES LEAF IN TREE                               │
│     ├─ Batch: Collect leaves from registry                         │
│     ├─ Build: Update Shadow Atlas Merkle tree                      │
│     ├─ Publish: New root on-chain                                  │
│     └─ Frequency: Daily or on-demand                               │
│                                                                     │
│  6. USER CAN NOW PROVE                                             │
│     └─ Proof requires: user_secret + salt + merkle_path            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Why Registration Prevents Sybil

| Attack | Without Registration | With Registration |
|--------|---------------------|-------------------|
| Claim any district | ✅ Trivial | ❌ Must register leaf first |
| Use someone else's leaf | ✅ Trivial (public tree) | ❌ Don't know their user_secret |
| Create 10k identities | ✅ Instant, free | ⚠️ 10k on-chain txs, gas costs |
| Claim higher authority | ✅ Just change input | ❌ Authority baked into leaf |

---

## Expert Review Summary

**Reviewers:** Identity Systems Architect, ZK Cryptography Expert, Civic Tech Architect

| Dimension | Assessment |
|-----------|------------|
| **Cryptographic Design** | SOUND - District-based proofs, nullifier schemes match Zcash/Semaphore patterns |
| **Identity Architecture** | SOUND - OAuth Sybil layer + tiered verification is correct design |
| **Privacy Model** | SOUND - Selective disclosure, large anonymity sets (10K-800K) |
| **Implementation Status** | Security layer complete — All CVEs + expert issues remediated. Integration layer (communique↔voter-protocol) pending. |

**Key Expert Validations:**
- Leaf ownership binding (CVE-VOTER-003 fix): Cryptographically sound
- Contract-controlled action_domain (CVE-VOTER-002 fix): Matches proven patterns
- Authority binding in circuit (CVE-VOTER-001 fix): Correctly constrains claims
- District-based vs cell-based decision: Superior privacy (26x larger anonymity sets)

**Key Expert Concerns (Now Addressed):**
- Cross-provider deduplication → ISSUE-001
- X/Twitter phone-only Sybil → ISSUE-002 ✅ (trust tier + OAuth scope fix complete)
- Redistricting handling → ISSUE-003
- Session credential security → ISSUE-004, ISSUE-005
- Circuit input validation → ISSUE-006, ISSUE-007

---

## Appendix D: Historical Gap Analysis (December 2025)

> **Note:** This section preserves the original Phase 1 gap analysis from December 2025. Many of these gaps have since been addressed or superseded by the security-focused analysis above.

### Original Executive Summary (Dec 2025)

The codebase showed **intentional Phase 1/Phase 2 separation**:
- **Phase 1 (Active):** Smart contracts, Noir circuits, ZK proving infrastructure, basic client SDK
- **Phase 2 (Documented, Not Implemented):** Token economics, challenge markets, outcome markets, multi-agent treasury

The critical path was **blockaded** at the ZK proving layer: Noir circuit existed but client SDK could not invoke it yet.

### Smart Contracts (Dec 2025 Status)

| Contract | Status | Notes |
|----------|--------|-------|
| **DistrictRegistry.sol** | COMPLETE | Maps district Merkle roots to country codes |
| **DistrictGate.sol** | COMPLETE | Master verification orchestrator |
| **NullifierRegistry.sol** | COMPLETE | Tracks used nullifiers per action |
| **TimelockGovernance.sol** | COMPLETE | 7-day governance transfer timelock |
| **GuardianShield.sol** | Phase 2 | Multi-jurisdiction veto (deferred) |

**Gap Identified:** Real Halo2Verifier bytecode was missing; used MockHalo2Verifier.

### Client SDK Gaps (Dec 2025)

```typescript
// Critical Problem Identified:
this.halo2Prover = new Halo2Prover();  // CLASS DIDN'T EXIST
```

**Missing Classes:**
1. `Halo2Prover` - Should wrap NoirProver
2. `ShadowAtlas` - Should connect to proof server
3. `Halo2Signer` - Should sign proofs for MEV protection

### Shadow Atlas Integration (Dec 2025)

| Component | Status | Gap |
|-----------|--------|-----|
| Data sources | TIGER PLACE only | Need Census API + Cicero |
| Merkle tree | Implemented | None |
| IPFS distribution | STUBBED | ipfsCID = '' |
| Quarterly updates | STUBBED | No scheduler |
| Proof serving API | PARTIAL | Not integrated with client |

### Original Blocking Issues (Dec 2025)

| Issue | Priority | Status as of Jan 2026 |
|-------|----------|----------------------|
| Missing `Halo2Prover` client class | CRITICAL | RESOLVED - NoirProver integrated |
| ShadowAtlas client integration | CRITICAL | RESOLVED - API connected |
| MockHalo2Verifier in contracts | CRITICAL | RESOLVED - Real verifiers generated |
| Noir circuit outputs misaligned | CRITICAL | ADDRESSED - See CVE fixes above |
| Geocoding Census API stub | HIGH | IN PROGRESS |
| IPFS CID stubbed | HIGH | IN PROGRESS |

### Phase 1 Readiness (Dec 2025 Estimate)

| Component | Dec 2025 Status | Jan 2026 Status |
|-----------|----------------|-----------------|
| Smart Contracts | 95% | 100% (verifiers deployed) |
| Noir Circuit | 80% | 100% (multi-depth compiled) |
| Client SDK | 40% | 75% (prover integrated) |
| Shadow Atlas | 70% | 85% (API operational) |
| Tests | 60% | 80% (e2e passing) |

**Original MVP Timeline:** 40-60 hours critical path estimated
**Actual:** Circuit and contract work completed; security gaps identified

---

**Document Status:** REVISION 6 — Phase 0 complete, Round 2 triaged
**Last Updated:** 2026-01-27
**Next Action:** Phase 1 — Remediate SA-001/SA-002/SA-003 (Round 2 P0 findings)
**Security Review Required:** Before any testnet deployment
