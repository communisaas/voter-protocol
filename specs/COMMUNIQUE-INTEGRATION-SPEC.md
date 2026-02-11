# Communique Integration Spec: Two-Tree Architecture + Message Delivery

> [!NOTE]
> **Implementation Status (2026-02-10)**
>
> | Phase | Component | Status |
> |-------|-----------|--------|
> | 1 | Noir two-tree circuit | Complete |
> | 2 | Smart contracts (DistrictGate, UserRootRegistry, CellMapRegistry) | Complete |
> | 3 | Shadow-atlas two-tree support | Complete |
> | 4 | noir-prover WASM integration | Complete |
> | 5 | Communique registration UI integration | Complete (Wave 17c) |
> | 5b | Communique two-tree proof generation | Complete (Wave 19a) |
> | 5c | Registration auth (CR-004) | Complete (Wave 19b) |
> | 5d | Identity verification (self.xyz/didit) mandatory for CWC | Required (Wave 24) |
> | 6 | On-chain verification via DistrictGate client | Complete (Wave 15a) |
> | 7 | Coordination metrics indexer (The Graph) | Complete (Wave 15c/15d) |
> | 8 | Anti-astroturf hardening (Waves 13-15) | Complete — all 11 gaps closed |
>
> **INT-002 RESOLVED (Wave 17b):** `POST /v1/register` endpoint implemented in shadow-atlas.
> `GET /v1/cell-proof` endpoint implemented for Tree 2 proofs.
> **CR-004 RESOLVED (Wave 19b):** Bearer token auth on `POST /v1/register` with HMAC constant-time comparison.
> **BR5-011 DESIGNED (2026-02-10):** Leaf replacement credential recovery protocol. No re-verification — identityCommitment stable across sessions. Implementation blocked on Wave 24 (NUL-001). See TWO-TREE-ARCHITECTURE-SPEC.md §8.4-8.8.
> See `specs/TWO-TREE-AGENT-REVIEW-SUMMARY.md` for detailed progress.

---

**Version:** 0.2.0
**Date:** 2026-02-10
**Status:** ACTIVE — Recovery protocol designed (BR5-011), Open Question #2 resolved
**Depends on:** TWO-TREE-ARCHITECTURE-SPEC.md v0.4.0

---

## 1. Executive Summary

This spec defines how the Two-Tree ZK Architecture integrates with Communique's two message delivery paths:

1. **Legislature API (CWC)** - Server-side delivery with ZK proof authorization
2. **mailto:** - Client-side email with optional OAuth outbox confirmation

The ZK proof provides **authorization and sybil resistance**, not address privacy for CWC messages. Address privacy is handled by a separate encrypted witness + TEE layer.

### The CWC Paradox

Congressional Web Contact XML requires full PII (name, address). The ZK proof cannot replace this requirement. Instead:

- **ZK proof** = cryptographic gate (proves constituency without revealing identity on-chain)
- **Encrypted witness** = address envelope (TEE-only decryption for CWC XML construction)
- **Nullifier** = anti-spam (one submission per user per template per session)

---

## 2. Delivery Architecture

### 2.1 Path 1: Legislature API (ZK Proof Required)

```
Client                           Server                    On-Chain               TEE (Nitro)
  |                                |                          |                      |
  |-- 1. Generate ZK proof ------->|                          |                      |
  |   (14-25s mobile)              |                          |                      |
  |                                |                          |                      |
  |-- 2. POST /submit-with-proof ->|                          |                      |
  |   { proof, publicOutputs,      |                          |                      |
  |     encryptedWitness }         |                          |                      |
  |                                |-- 3. verifyTwoTreeProof->|                      |
  |                                |   (~387K gas, Scroll L2) |                      |
  |                                |                          |-- recordNullifier -->|
  |                                |                          |                      |
  |                                |-- 4. Queue for TEE ----->|                      |
  |                                |                          |   5. Decrypt witness |
  |                                |                          |   6. Build CWC XML   |
  |                                |                          |   7. POST to CWC API |
  |                                |                          |   8. Zero memory     |
  |                                |<------------- delivery confirmation ------------|
  |<-- 9. Delivery status ---------|                          |                      |
```

**Public inputs (29 fields):**
- `user_root` (1), `cell_map_root` (1), `districts[24]` (24), `nullifier` (1), `action_domain` (1), `authority_level` (1)

**Private inputs (in proof, never revealed):**
- `user_secret`, `cell_id`, `salt`, `identity_commitment`, merkle paths for both trees

### 2.2 Registration Privacy Architecture (Wave 17)

The registration flow preserves user privacy through client-side leaf computation:

```
Browser                          Communique Server              Shadow Atlas
  │                                    │                              │
  ├─ Enter address ───────────────────►│                              │
  │                                    ├─ Census Geocoding API ──►    │
  │                                    │◄── cell_id (GEOID) ─────    │
  │◄── cell_id ────────────────────────┤                              │
  │                                    │                              │
  │  Generate user_secret (random)     │                              │
  │  Generate registration_salt        │                              │
  │  Verify identity via self.xyz/didit │                              │
  │  → identityCommitment              │                              │
  │  → authorityLevel (from attestation)│                              │
  │  Compute leaf = H4(secret,         │                              │
  │    cell_id, salt, authority_level)  │                              │
  │    IN BROWSER                      │                              │
  │                                    │                              │
  ├─ POST /register { leaf } ──────────┤                              │
  │                                    ├─ POST /v1/register ────────►│
  │                                    │                  Insert leaf │
  │                                    │                  into Tree 1 │
  │                                    │◄── { leafIndex, userPath, ──│
  │                                    │      userRoot }              │
  │◄── { leafIndex, userPath, ─────────┤                              │
  │      userRoot, pathIndices }       │                              │
  │                                    │                              │
  ├─ GET /cell-proof?cell_id=X ────────┤                              │
  │                                    ├─ GET /v1/cell-proof ───────►│
  │                                    │◄── { cellMapRoot, path, ────│
  │                                    │      districts[24] }         │
  │◄── { cellMapRoot, cellMapPath, ────┤                              │
  │      districts[24] }               │                              │
  │                                    │                              │
  │  Store in IndexedDB (encrypted):   │                              │
  │    user_secret, cell_id,           │                              │
  │    registration_salt, leafIndex,   │                              │
  │    userPath, userRoot,             │                              │
  │    cellMapRoot, cellMapPath,       │                              │
  │    cellMapPathBits, districts[24]  │                              │
```

**What the Communique server sees:** `{ leaf: "0x7a3f..." }` — a 256-bit hash. Nothing else.

**What the Shadow Atlas operator sees:** Same leaf hash + the cell_id (neighborhood-level, ~600-3000 people) for the Tree 2 proof request. The Shadow Atlas also receives the self.xyz/didit attestation signature to verify authority_level. It learns the authority tier for each leaf but NOT the user's identity.

**Why this is safe:**
- The ZK circuit validates leaf correctness from private inputs at proof time
- Garbage leaves (wrong cell_id) fail Tree 2 membership check
- The operator is an append-only log, not a validator
- cell_id disclosure is a known Phase 1 tradeoff (see Deferred Items in WAVE-17-19-IMPLEMENTATION-PLAN.md)

**Credential recovery:** Browser clear or device loss triggers the **leaf replacement protocol** (TWO-TREE-ARCHITECTURE-SPEC.md Section 8.4-8.8). The user re-authenticates via OAuth, re-enters their address (~15 seconds), and the system generates fresh random `user_secret` + `registration_salt`, zeros the old Tree 1 leaf, and inserts a new one. No re-verification required — the `identityCommitment` (stable across sessions, derived from OAuth credential) is already stored from first registration.

**Sybil safety:** The post-Wave-24 nullifier formula `H2(identityCommitment, actionDomain)` produces the same nullifier regardless of `user_secret` changes, so leaf replacement cannot be exploited for double-voting. Already-used nullifiers remain on-chain; old proofs are invalidated by the root transition.

**Prerequisite:** Wave 24 (NUL-001) identity-bound nullifier circuit rework. Without it, a new `user_secret` would produce a new nullifier and break Sybil resistance.

**Implementation scope (voter-protocol):**
- `RegistrationService.replaceLeaf(oldLeafIndex, newLeaf)` — zero old position, insert at next, recompute root, return proof
- `POST /v1/register/replace` endpoint — authenticated, accepts `{ newLeaf, oldLeafIndex }`
- InsertionLog gains `"replace"` entry type for audit trail

**Implementation scope (communique):**
- Register endpoint gains `replace: true` mode — finds existing registration, extracts `oldLeafIndex`, calls Shadow Atlas replace
- `shadow-atlas-handler.ts` detects missing IndexedDB credential + existing Postgres registration → triggers recovery flow
- Postgres stores `cell_id_hash = H(cell_id)` for "still same address?" consistency check
- "Welcome back" UX: 1 user action (address re-entry), ~15 seconds wall-clock

### 2.3 Tree Root Distribution

Phase 1: Shadow Atlas operator submits root updates to on-chain registries:
- `UserRootRegistry.sol` — Tree 1 root updated after each registration batch
- `CellMapRegistry.sol` — Tree 2 root updated after Census data ingestion

Phase 2: TEE-attested root updates (operator cannot manipulate roots).

### 2.4 Path 2: mailto: (No Proof)

```
Client                           Server                    Email Provider
  |                                |                          |
  |-- 1. Build mailto: URL ------->|                          |
  |   (client-side only)           |                          |
  |                                |                          |
  |-- 2. Open email client ------->|                          |
  |   (window.location.href)       |                          |
  |                                |                          |
  |   User sends email ----------->|                          |
  |                                |                          |
  |-- 3. Self-report "I sent it" ->|                          |
  |                                |                          |
  |   OR (if OAuth linked):        |                          |
  |-- 4. Poll outbox ------------->|-- 5. Check sent folder ->|
  |                                |<-- 6. Match result ------|
  |<-- 7. Confirmed/unconfirmed ---|                          |
```

**No ZK proof.** No address collection. No on-chain transaction.

---

## 3. Action Domain & Nullifier Scheme

### 3.1 Schema: Hybrid Layered (Option F)

```
action_domain = keccak256(
    abi.encodePacked(
        bytes32("communique.v1"),        // Protocol prefix
        bytes3(country_code),             // "USA", "GBR", etc.
        bytes8(legislature_id),           // "congress", "parliamt"
        bytes32(template_id),             // Template identifier
        bytes16(session_id)               // "119th" (2025-2027)
    )
)
```

### 3.2 Scope: One Proof Per Template

Client generates **1 proof per template**. Server fans out to N representatives after single on-chain verification.

| Aspect | Value |
|--------|-------|
| Proof count | 1 per template submission |
| Gas cost | ~387K on Scroll L2 (~$0.0016) |
| Nullifier | `H(identity_commitment, action_domain)` |
| Reuse within session | Blocked (same nullifier) |
| Reuse across sessions | Allowed (new `session_id` = new `action_domain`) |

### 3.3 Session Scoping for Redistricting

Congressional sessions (2 years) naturally bound nullifier validity:

- **119th Congress** (2025-2027): `session_id = "119th"`
- **120th Congress** (2027-2029): New `session_id` = new nullifiers

Users can re-send the same template after redistricting without any protocol changes.

### 3.4 Emergency Override

Governance can register emergency action domains with 7-day timelock:

```
emergency_domain = keccak256("communique.v1.emergency.{reason}" + ...)
```

30-day TTL after activation.

---

## 4. Address Lifecycle

### 4.1 Decision: Client-Side Storage + Ephemeral Server Processing (Option D)

| Stage | Address State | Location | Duration |
|-------|---------------|----------|----------|
| Entry | Plaintext in browser | RAM | Seconds |
| Geocoding | Sent to Census API | JSONP request | Ephemeral |
| Post-geocoding | **DISCARDED from memory** | - | - |
| Storage | Encrypted in IndexedDB | Client device | 6 months |
| CWC send | Sent to server | Server RAM | Seconds |
| TEE processing | Decrypted in enclave | Nitro RAM | Seconds |
| Post-delivery | **ZEROED** | - | - |

**Server NEVER writes address to database.** Address only exists:
1. On user's device (IndexedDB, encrypted with Web Crypto AES-256-GCM)
2. In server memory during CWC XML construction (ephemeral)
3. In TEE enclave during delivery (ephemeral)

### 4.2 IndexedDB Schema Update

```typescript
interface SessionCredential {
    userId: string;
    identityCommitment: string;
    leafIndex: number;
    merklePath: string[];
    merkleRoot: string;
    congressionalDistrict: string;
    verificationMethod: 'self.xyz' | 'didit';
    createdAt: Date;
    expiresAt: Date;  // 6 months

    // NEW: Client-side address for CWC delivery
    address?: {
        street: string;
        city: string;
        state: string;
        zip: string;
    };
}
```

### 4.3 What Must Be Removed

- `mvpAddress` field from `/api/submissions/create` (cleartext bypass)
- `encryptedDeliveryData` Postgres table (server-side address storage)
- `blob-encryption.ts` address handling code

**MVP address bypass removed.** CWC delivery requires TEE (Phase 2). The mailto: path is available without TEE but is labeled 'unverified' and does not claim ZK-backed constituency proof.

---

## 5. Privacy Audit Findings

### 5.1 Critical (P0)

| # | Finding | Current State | Required Fix |
|---|---------|---------------|--------------|
| P0-1 | `Submission.user_id` links proofs to real identity | `user_id` in Submission table | Replace with `identity_commitment` (pseudonymous) |
| P0-2 | `mvpAddress` sends cleartext address to server | Bypasses encrypted witness | Remove field; force TEE-only path |
| P0-3 | `cwc_submission_id` correlatable with Congressional records | Stored in plaintext | Encrypt before storage; store hash for lookups |

### 5.2 High (P1)

| # | Finding | Fix |
|---|---------|-----|
| P1-1 | No TEE deployment for CWC delivery | Deploy AWS Nitro Enclave with CWC adapter |
| P1-2 | Action domain schema not implemented | Deploy Option F with session scoping |
| P1-3 | Audit logs may capture PII | Add log sanitization rules; redact addresses |

### 5.3 Medium (P2)

| # | Finding | Fix |
|---|---------|-----|
| P2-1 | No OAuth outbox confirmation | Implement Gmail `gmail.metadata` Phase 1 |
| P2-2 | No privacy explainer UI | Add in-app disclosure for CWC path |
| P2-3 | `EncryptedDeliveryData` has no TTL | Add 90-day expiry (before table removal) |

---

## 6. OAuth Outbox Confirmation

### 6.1 Scope

Optional feature for mailto: path. User links email account; server checks sent folder for matching message.

### 6.2 OAuth Scopes

| Provider | Scope | Access |
|----------|-------|--------|
| Gmail | `gmail.metadata` | Headers only (To, Subject, Date). No body access. |
| Outlook | `Mail.ReadBasic` | Headers only. No body access. |

### 6.3 Matching Algorithm

```
match = (
    recipient ∈ expectedRecipients AND
    subject contains expectedSubject AND
    sentTime within ±5min of mailto: open
)
```

**Confidence levels:** `exact` (all match), `partial` (subject edited), `none` (no match after timeout).

### 6.4 Incentives

- "Confirmed Sender" badge (visual credibility)
- +10 reputation per confirmed send
- Template discovery ranking boost
- Delivery analytics dashboard

### 6.5 Privacy Grade: B+

Server sees email headers (recipient, subject, time) during verification. This is equivalent to what the server already knows for CWC path. NOT zero-knowledge. Phase 4 research into client-side MPC could achieve ZK outbox verification.

---

## 7. Multi-Legislature Support

### 7.1 Adapter Pattern

| Country | Legislature | API | Address Required? | ZK Integration |
|---------|-------------|-----|-------------------|----------------|
| US | Congress | CWC XML | YES | Encrypted witness + TEE |
| UK | Parliament | WriteToThem | NO (postcode only) | Direct API (postcode from districts[24]) |
| Canada | Parliament | Email | Optional | mailto: (client-side) |
| Germany | Bundestag | Email/Form | Optional | mailto: (client-side) |

### 7.2 UK Advantage

UK Parliament API only needs postcode district, which is already PUBLIC in `districts[24]`. No address, no TEE, no encrypted witness. Direct ZK-to-API delivery.

---

## 8. Spam Prevention: 5-Layer Defense

| Layer | Mechanism | Prevents |
|-------|-----------|----------|
| 1. Nullifier (on-chain) | One nullifier per user per template per session | Same template resubmission |
| 2. Rate limiting (app) | 3 req/hour per user; 5 templates/topic/day | Burst attacks |
| 3. Template verification | AI + community review; duplicate detection | Template spam |
| 4. Sybil resistance | Identity verification (Didit); reputation tiers | Multi-account abuse |
| 5. On-chain monitoring | Event analysis; coordinated attack detection | Network-level attacks |

---

## 9. Gas Scaling

| Scale | Verifications/day | Cost (Scroll L2) |
|-------|-------------------|-------------------|
| Beta (100 users) | 100 | ~$0.16 |
| Growth (10K) | 10,000 | ~$16 |
| Scale (100K) | 100,000 | ~$160 |

**Phase 2 optimization:** Batch verification (30-40% savings) or ZK-rollup of verification batches (99.96% savings).

---

## 10. Anonymity Set Analysis

The 24-district disclosure narrows the anonymity set:

- Single district (e.g., CA-12): ~750K people
- Intersection of 24 districts: ~500-2,000 people
- Census Tract (cell_id, PRIVATE): ~4,000 people

**Accepted trade-off:** Congressional offices need district verification. The 500-2K anonymity set from district intersection is sufficient. `cell_id` remains private (would narrow to ~100 households).

---

## 11. The Honest Privacy Story

### For CWC (Congressional) Messages:

> Communique uses zero-knowledge proofs to verify you're a constituent without revealing your identity to the blockchain or public. However, because Congressional Web Contact protocols require your full name and address, we process this information temporarily to construct the required XML format. Your address is stored encrypted on YOUR device, sent ephemerally to our secure server for delivery, and never written to our database. Congressional office staff see your full constituent information per CWC verification requirements.

### For mailto: Messages:

> Your email is sent directly from your email client. Communique does not see the message content. Optionally link your email account to earn "Confirmed Sender" status.

### What the ZK Proof Provides:

- **Authorization**: Only real constituents can send
- **Sybil resistance**: One message per person per template per session
- **Pseudonymous reputation**: On-chain civic score via `identity_commitment`
- **No persistent server storage**: Address deleted after delivery

### What the ZK Proof Does NOT Provide:

- Address privacy from Communique server (ephemeral transit)
- Address privacy from Congress (CWC requires it)
- Complete anonymity (24-district intersection narrows to ~500-2K people)

---

## 12. Implementation Priority

### P0: Must-Have for Mainnet

1. Remove `mvpAddress` cleartext bypass from `/api/submissions/create`
2. Decouple `Submission.user_id` - replace with `identity_commitment`
3. Encrypt `cwc_submission_id` before database storage
4. Move address from server Postgres to client IndexedDB (Option D)

### P1: Required for Launch

5. Deploy TEE-based CWC delivery (AWS Nitro Enclave)
6. Implement action domain schema (Option F, session-scoped)
7. Deploy new verifier contract for two-tree circuit (29 public inputs)
8. Add audit log sanitization (redact PII from server logs)

### P2: Launch Enhancement

9. OAuth outbox confirmation (Gmail Phase 1)
10. Privacy explainer UI component
11. "Confirmed Sender" badge system
12. Delivery analytics dashboard

### P3: Post-Launch Optimization

13. Batch verification for gas savings
14. UK Parliament adapter (no TEE needed)
15. Client-side MPC for ZK outbox verification (research)
16. Advocate for CWC v3 to accept ZK proofs instead of plaintext

---

## 13. Contract Changes Required

### New Contracts

| Contract | Purpose |
|----------|---------|
| `UserRootRegistry.sol` | Manages Tree 1 (user identity) roots |
| `CellMapRegistry.sol` | Manages Tree 2 (cell-district mapping) roots, 90-day grace |
| `TwoTreeVerifier.sol` | UltraHonk verifier for two-tree circuit |
| `ActionDomainGenerator.sol` | Pure helper for domain hash generation |

### Modified Contracts

| Contract | Change |
|----------|--------|
| `DistrictGate.sol` | Add `verifyTwoTreeProof()` with 29 public inputs |
| `NullifierRegistry.sol` | No change (already supports action_domain scoping) |
| `VerifierRegistry.sol` | Register new two-tree verifier |

---

## 14. Open Questions

1. **TEE provider**: AWS Nitro vs multi-party (2-of-3 AWS/Google/Azure)?
2. ~~**Address re-entry UX**: Session storage (24h) vs IndexedDB (6 months) for returning users?~~ **RESOLVED (2026-02-10):** IndexedDB with 6-month TTL for active credentials. On browser clear / device loss, leaf replacement recovery re-derives cell_id from address re-entry (~15s). "Still same address?" fast path with stored `cell_id_hash`. See TWO-TREE-ARCHITECTURE-SPEC.md Section 8.4-8.8.
3. ~~**Template+Rep vs Template-only nullifier**: Per-template allows one submission total; per-template-per-rep allows one per representative. Which aligns with user expectations?~~ **RESOLVED (2026-02-08):** Per-template-per-chamber. See Section 15.
4. **OAuth token storage**: Separate DB table or extend existing `Account` model?
5. **Selective district disclosure**: Should Phase 2 allow proving membership in N-of-24 districts instead of revealing all 24?

---

## 15. Coordination Integrity Findings (2026-02-08)

> **Cross-reference:** COORDINATION-INTEGRITY-SPEC.md (foundational spec)

### 15.1 Open Question #3 Resolution: Nullifier Scoping

**Decision:** Add `recipient_chamber` to the action domain schema (communique.v2):

```
action_domain = keccak256(
    abi.encodePacked(
        bytes32("communique.v2"),         // Updated protocol prefix
        bytes3(country_code),
        bytes8(jurisdiction_type),        // Renamed from legislature_id
        bytes32(template_id),
        bytes16(session_id),
        bytes8(recipient_subdivision)     // NEW: "senate", "house", "council", etc.
    )
)
```

**Rationale:** Template-only scoping pushes users to the mailto: path (which bypasses all ZK protections) when they want to send to House today and Senate next week. Per-chamber scoping allows 2-3 proof submissions per template while maintaining sybil resistance within each chamber.

**Impact:** Governance must register 2-3 action domains per template (one per target chamber). Batch registration via helper contract mitigates overhead.

### 15.2 Proof-Message Binding

**Finding:** The ZK proof and the delivered message are cryptographically independent. The EIP-712 signature (`SUBMIT_TWO_TREE_PROOF_TYPEHASH`) covers `proofHash` and `publicInputsHash` but not message content, template ID, or recipient.

**Resolution:** Action domain binding is sufficient. The `action_domain` encodes `template_id`, creating an immutable on-chain record linking the user's proof to the template identity. Content commitment on-chain (e.g., `contentHash` in events) was evaluated and rejected due to the template fingerprinting attack — see COORDINATION-INTEGRITY-SPEC Section 2.

**Residual gap:** Backend could modify personalized content within a template. Addressed by TEE deployment (Phase 2).

### 15.3 Delivery Path Security

**Finding:** The mailto: path has no proof, no nullifier, and no on-chain record. Coordinated campaigns using mailto: bypass all anti-astroturf mechanisms.

**Resolution:** Fence, don't merge:
- Phase 1: Label mailto: sends as "unverified" in all metrics. Exclude from `CampaignRegistry` counts.
- Phase 2: Require off-chain proof generation before displaying mailto: link.

### 15.4 Moderation Gap

**Finding:** User-provided `[Personal Connection]` text is never moderated. It passes directly to CWC XML construction, bypassing the three-layer moderation pipeline.

**Resolution:** Add Layer 0 (Llama Prompt Guard, <200ms) moderation on the combined template + personalization at send-time. Block only S1 (threats) and S4 (CSAM), matching ADR-006 permissive policy.

### 15.5 Content Commitment On-Chain: Evaluated and Rejected

**Evaluation:** Putting `contentHash = keccak256(messageBody)` on-chain was considered for measuring content diversity across campaigns.

**Rejection reasons:**
1. **Template fingerprinting attack.** Templates are public. Precomputed hashes match on-chain events to specific templates, revealing each pseudonymous user's political positions. Combined with 24-district intersection, anonymity sets degrade to potentially dozens.
2. **Three-form problem.** Messages exist as raw template, resolved template (with PII), and final personalized. No hash target is both meaningful and privacy-safe.
3. **AI duplication.** Independent users requesting AI-generated templates on the same topic receive identical outputs, creating false coordination signals.

**Alternative:** Structural signals (geographic diversity, temporal entropy, authority distribution, template count) provide anti-astroturf observability without privacy regression. See COORDINATION-INTEGRITY-SPEC Section 4.

### 15.6 Blockchain Submission Gap — RESOLVED (Wave 15a, 2026-02-08)

**Original finding:** `district-gate-client.ts` in Communique returned a mock transaction hash.

**Resolution:** Mock replaced with real ethers.js v6 client in Wave 15a (Cycle 3 anti-astroturf hardening):
- Real `verifyTwoTreeProof()` calls via Scroll RPC
- EIP-712 signing with server-side relayer wallet (NonceManager for nonce safety)
- 3-state circuit breaker (closed/open/half_open) with single-flight half-open semantics
- Database-backed retry queue with exponential backoff (30s→240s, max 4 retries)
- Balance monitoring with fail-closed on RPC errors
- Nullifier idempotency check before retry (on-chain `isNullifierUsed()`)

**Wave 15R hardening:** 12 review findings addressed (race conditions, error detection, admin sanitization, rate limiting).

### 15.7 Decision-Maker Generalization

The action domain schema and delivery architecture must support any decision-maker context, not only US Congress via CWC. The `legislature_id` field is renamed to `jurisdiction_type` in the v2 schema to reflect this. Delivery adapters for non-CWC channels (state portals, regulatory APIs, municipal email, corporate governance) are Phase 2+ work. See COORDINATION-INTEGRITY-SPEC Section 12.
