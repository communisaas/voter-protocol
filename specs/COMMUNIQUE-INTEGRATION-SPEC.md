# Communique Integration Spec: Two-Tree Architecture + Message Delivery

**Version:** 0.1.0
**Date:** 2026-02-02
**Status:** DRAFT - Pending Engineering Review
**Depends on:** TWO-TREE-ARCHITECTURE-SPEC.md v0.2.0

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
- `user_secret`, `cell_id`, `salt`, merkle paths for both trees

### 2.2 Path 2: mailto: (No Proof)

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
| Nullifier | `H(user_secret, action_domain)` |
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
2. **Address re-entry UX**: Session storage (24h) vs IndexedDB (6 months) for returning users?
3. **Template+Rep vs Template-only nullifier**: Per-template allows one submission total; per-template-per-rep allows one per representative. Which aligns with user expectations?
4. **OAuth token storage**: Separate DB table or extend existing `Account` model?
5. **Selective district disclosure**: Should Phase 2 allow proving membership in N-of-24 districts instead of revealing all 24?
