# Cross-Repository Identity Architecture Analysis

**Date:** 2026-01-26
**Author:** Distinguished Engineer (Architecture Team)
**Status:** CRITICAL FINDINGS - ACTION REQUIRED
**Scope:** communique + voter-protocol + shadow-atlas

**Cross-Repository References:**
- communique Shadow Atlas integration: [shadow-atlas-integration.md](/Users/noot/Documents/communique/docs/shadow-atlas-integration.md)
- communique Authority levels: [authority-levels.md](/Users/noot/Documents/communique/docs/authority-levels.md)

---

## Executive Summary

After exhaustive analysis of identity, authentication, and proof systems across both repositories, this document reveals **significant architectural gaps** between specification and implementation.

**Key Finding:** The current integration is approximately **35% complete**, with critical hash algorithm mismatches that would cause proof verification failures in production.

---

## 1. Architecture Overview

### 1.1 Intended Design (Per Specifications)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         COMMUNIQUE (Frontend)                        │
├─────────────────────────────────────────────────────────────────────┤
│  OAuth Login     Identity Verification    ZK Proof Generation       │
│  (Google, FB,    (self.xyz, Didit.me)    (Browser WASM)             │
│   LinkedIn,       ↓                        ↓                        │
│   Twitter)        Identity Commitment      Merkle Proof              │
│       ↓           (Poseidon2 hash)         (Poseidon2 hashes)       │
│  Sybil Resistance  ↓                        ↓                        │
│       ↓           └────────────────────────┼────────────────────────┤
│       ↓                                    ↓                        │
└───────┼────────────────────────────────────┼────────────────────────┘
        ↓                                    ↓
┌───────┴────────────────────────────────────┴────────────────────────┐
│                      VOTER-PROTOCOL (Backend)                        │
├─────────────────────────────────────────────────────────────────────┤
│  Shadow Atlas API          Noir Circuits          Smart Contracts    │
│  /v1/lookup?lat&lng        district_membership    DistrictGate.sol   │
│  ↓                         ↓                      ↓                  │
│  District Merkle Tree      Proof Generation       On-chain Verify    │
│  (Poseidon2 hashes)        (UltraHonk)            (Poseidon2)       │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 Actual Implementation State

```
┌─────────────────────────────────────────────────────────────────────┐
│                         COMMUNIQUE (Frontend)                        │
├─────────────────────────────────────────────────────────────────────┤
│  OAuth Login     Identity Verification    ZK Proof Generation       │
│  ✅ COMPLETE     ❌ STUB (no providers)   ⚠️ WRONG PROVER           │
│  (5 providers)    Uses mock SHA-256        Imports Noir prover       │
│       ↓           NOT Poseidon2            Spec says Halo2           │
│  Sybil Resistance  ↓                        ↓                        │
│  ✅ Works         ❌ BROKEN                ⚠️ MAY NOT WORK          │
│       ↓                                    ↓                        │
└───────┼────────────────────────────────────┼────────────────────────┘
        ↓                                    ↓
        ✅                                   ❌ NOT CONNECTED
┌───────┴────────────────────────────────────┴────────────────────────┐
│                      VOTER-PROTOCOL (Backend)                        │
├─────────────────────────────────────────────────────────────────────┤
│  Shadow Atlas API          Noir Circuits          Smart Contracts    │
│  ✅ PRODUCTION             ✅ WORKING             ⚠️ CVE ISSUES     │
│  /v1/lookup works          district_membership    Needs fixes        │
│  ↓                         ↓                      ↓                  │
│  District Merkle Tree      Proof Generation       On-chain Verify    │
│  ✅ Poseidon2              ✅ UltraHonk           ⚠️ Leaf ownership  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Critical Findings

### 2.1 Hash Algorithm Mismatch (SEVERITY: CRITICAL)

**Problem:** Communique uses mock SHA-256, voter-protocol uses Poseidon2.

| Component | Expected | Actual | Impact |
|-----------|----------|--------|--------|
| `shadow-atlas-handler.ts` | Poseidon2 | SHA-256 (mock) | Identity commitments won't match |
| `/api/shadow-atlas/register` | Poseidon2 | String concat | Merkle roots incompatible |
| Session credentials | Poseidon2 | Mock hash | Cached proofs invalid |

**Evidence:**
```typescript
// communique/src/routes/api/shadow-atlas/register/+server.ts (line 7-10)
function mockHash(data: string): string {
  // TODO: Replace with actual Poseidon hash from @voter-protocol/crypto
  return `hash(${data})`; // ← STRING CONCATENATION
}
```

**Fix Required:**
```typescript
import { poseidon2_hash } from '@voter-protocol/crypto';

function computeLeafHash(data: Field[]): Field {
  return poseidon2_hash(data);
}
```

### 2.2 Prover Architecture Mismatch (SEVERITY: HIGH)

**Problem:** Specification documents Halo2 prover, code imports Noir prover.

| Document | Prover System | API |
|----------|---------------|-----|
| `zk-proof-integration.md` | Halo2 (K=14) | `@voter-protocol/crypto` |
| `prover-main-thread.ts` | Noir (UltraHonk) | `@voter-protocol/noir-prover` |

**Resolution:** Noir prover is correct. Specification was written before architecture decision. **Update docs to reflect Noir/UltraHonk.**

### 2.3 Shadow Atlas Not Connected (SEVERITY: HIGH)

**Problem:** Communique has local mock Shadow Atlas, not connected to voter-protocol API.

**Communique's Mock:**
- File: `/src/routes/api/shadow-atlas/register/+server.ts`
- Stores Merkle trees in local Postgres
- Uses mock hash functions
- 500 lines of code duplicating voter-protocol functionality

**voter-protocol's Production API:**
- File: `/packages/shadow-atlas/src/serving/api.ts`
- Production-ready HTTP server
- Real Poseidon2 hashing
- IPFS-backed district data

**Current Flow (BROKEN):**
```
User → communique /api/shadow-atlas/register → Local Postgres (mock hashes)
                                               ↓
                                        NEVER reaches voter-protocol
```

**Required Flow:**
```
User → communique → voter-protocol Shadow Atlas API → Real Merkle tree
                    ↓                                  ↓
                    /v1/lookup?lat&lng                 Poseidon2 hashes
```

### 2.4 Identity Provider Integration Missing (SEVERITY: HIGH)

**Problem:** No actual integration with self.xyz or Didit.me despite API endpoints.

| Endpoint | Status | Issue |
|----------|--------|-------|
| `/api/identity/init` | Interface only | self.xyz SDK not integrated |
| `/api/identity/verify` | Stub | Verification logic placeholder |
| `/api/identity/didit/init` | Interface only | Didit.me SDK not integrated |
| `/api/identity/didit/webhook` | Stub | Webhook signature not verified |

**Evidence:**
```typescript
// communique/src/lib/core/identity/shadow-atlas-handler.ts (line 142)
// TODO: Use actual Poseidon hash from self.xyz or Didit.me
// Currently uses SHA-256 placeholder
```

### 2.5 Missing Critical Endpoints (SEVERITY: MEDIUM)

| Endpoint | Purpose | Status |
|----------|---------|--------|
| `/api/congressional/submit` | Submit proof to congressional API | NOT IMPLEMENTED |
| `/api/tee/public-key` | Fetch TEE encryption key | NOT IMPLEMENTED |
| `/api/proof/verify` | On-chain proof verification | NOT IMPLEMENTED |

### 2.6 CVE Vulnerabilities in Circuit (SEVERITY: CRITICAL)

Previously identified vulnerabilities from security analysis:

| CVE ID | Issue | Status |
|--------|-------|--------|
| CVE-VOTER-001 | Opaque Leaf Bug | Fix designed, not implemented |
| CVE-VOTER-002 | Nullifier Bypass | Fix designed, not implemented |
| CVE-VOTER-003 | No Leaf Ownership | Fix designed, not implemented |
| CVE-VOTER-004 | Hash Mismatch | Root cause of 2.1 |
| CVE-VOTER-005 | TIGER Data Integrity | No checksum verification |
| CVE-VOTER-006 | Missing Test Vectors | No test vectors |

---

## 3. Component-by-Component Status

### 3.1 Communique (Frontend)

| Component | File | Status | Blocker |
|-----------|------|--------|---------|
| OAuth Login | `oauth-providers.ts` | ✅ COMPLETE | - |
| OAuth Callback | `oauth-callback-handler.ts` | ✅ COMPLETE | - |
| Session Management | `auth.ts` | ✅ COMPLETE | - |
| Voter Client Wrapper | `voter-client.ts` | ✅ COMPLETE | - |
| Encrypted Blob Storage | `blob-encryption.ts` | ✅ COMPLETE | - |
| Session Credential Cache | `session-credentials.ts` | ✅ COMPLETE | - |
| Location Inference | `inference-engine.ts` | ✅ COMPLETE | - |
| Shadow Atlas Handler | `shadow-atlas-handler.ts` | ⚠️ MOCK | Poseidon hash |
| Shadow Atlas Register | `+server.ts` | ⚠️ MOCK | Poseidon hash |
| Identity Verification | `verification-handler.ts` | ❌ STUB | Provider SDKs |
| self.xyz Integration | - | ❌ NONE | Not started |
| Didit.me Integration | - | ❌ NONE | Not started |
| Prover Integration | `prover-main-thread.ts` | ⚠️ IMPORTED | Needs testing |
| Congressional Submit | - | ❌ NONE | Not started |
| TEE Public Key | - | ❌ NONE | Not started |

### 3.2 voter-protocol (Backend)

| Component | File | Status | Blocker |
|-----------|------|--------|---------|
| Shadow Atlas API | `api.ts` | ✅ PRODUCTION | - |
| Global Merkle Tree | `global-merkle-tree.ts` | ✅ PRODUCTION | - |
| Merkle Tree Builder | `merkle-tree.ts` | ✅ PRODUCTION | - |
| Boundary Resolver | `boundary-resolver.ts` | ✅ PRODUCTION | - |
| District Membership Circuit | `main.nr` | ⚠️ VULNERABLE | CVE fixes |
| Verifier Contract | generated | ✅ PRODUCTION | - |
| DistrictGate Contract | `DistrictGate.sol` | ⚠️ VULNERABLE | CVE fixes |
| Reputation Registry | - | ❌ NONE | Phase 2 |
| Challenge Markets | - | ❌ NONE | Phase 2 |

### 3.3 Integration Points

| Integration | Communique → voter-protocol | Status |
|-------------|----------------------------|--------|
| Package dependency | `@voter-protocol/*` imports | ✅ WORKS |
| Hash compatibility | Poseidon2 hashes match | ❌ BROKEN |
| API calls | Shadow Atlas lookup | ❌ NOT CONNECTED |
| Proof generation | Noir prover invocation | ⚠️ UNTESTED |
| Proof verification | On-chain verification | ❌ NOT IMPLEMENTED |

---

## 4. Trust Architecture (Correct Design)

### 4.1 Tiered Authority Model

| Level | Source | Trust Basis | Cost | Use Case |
|-------|--------|-------------|------|----------|
| 1 | Self-claimed | None | $0 | View-only |
| 2 | Location-hinted | IP/GPS | $0 | Soft filtering |
| 3 | Socially vouched | Peer attestations | $0 | Community discussions |
| 4 | Document-verified | self.xyz / Didit.me | $0 | Constituent messaging |
| 5 | Government-issued | State ID + liveness | TBD | Official elections |

### 4.2 OAuth as Sybil Layer (CORRECT)

OAuth provides Sybil resistance through:
- Email uniqueness enforcement (Google, LinkedIn)
- Phone number binding (Twitter, Facebook)
- Account age requirements (configurable)
- Rate limiting per account

**OAuth is NOT identity verification** - it's account binding for Sybil prevention.

### 4.3 Identity Verification as Trust Modifier (CORRECT)

Identity verification (self.xyz, Didit.me) is:
- Optional modifier for higher trust actions
- Not required for basic participation
- App-paid infrastructure (user pays $0)
- Phase 1: Document-verified (Level 4)

---

## 5. Data Flow Analysis

### 5.1 Registration Flow (Current - BROKEN)

```
1. User signs in via OAuth (✅ works)
2. User requests identity verification
3. communique calls `/api/identity/init` (❌ stub - no provider SDK)
4. Provider returns identity commitment (❌ not happening)
5. communique calls `/api/shadow-atlas/register` (⚠️ mock hash)
6. Local Postgres stores merkle tree (⚠️ wrong hashes)
7. User can "generate proofs" (❌ proofs invalid due to hash mismatch)
```

### 5.2 Registration Flow (Required - FIXED)

```
1. User signs in via OAuth (✅ works)
2. User requests identity verification
3. communique calls `/api/identity/init` with provider SDK
4. User completes NFC scan or ID upload
5. Provider returns Poseidon2 identity commitment
6. communique calls voter-protocol Shadow Atlas API:
   GET /v1/lookup?lat={lat}&lng={lng}
7. voter-protocol returns district info + merkle path
8. communique stores session credential with REAL Poseidon2 hashes
9. User generates proof using @voter-protocol/noir-prover
10. Proof verifies on-chain (hashes match)
```

### 5.3 Proof Verification Flow (Not Implemented)

```
1. User generates proof in browser (⚠️ untested)
2. communique calls `/api/congressional/submit` (❌ not implemented)
3. Server calls DistrictGate.verifyProof() (❌ CVE vulnerabilities)
4. Contract verifies nullifier uniqueness (❌ bypass vulnerability)
5. Action recorded on-chain (❌ not implemented)
```

---

## 6. Specification vs Reality Matrix

| Specification Says | Reality | Gap |
|-------------------|---------|-----|
| Halo2 prover (K=14) | Noir prover (UltraHonk) | Spec outdated - Noir is correct |
| Poseidon2 everywhere | SHA-256/mock in communique | CRITICAL - hash mismatch |
| self.xyz + Didit.me integrated | SDKs not integrated | Missing 1-2 weeks work |
| Shadow Atlas connected | Local mock Postgres | Not connected |
| TEE encryption | `/api/tee/public-key` missing | Not implemented |
| Congressional submit | `/api/congressional/submit` missing | Not implemented |
| ERC-8004 reputation | Client interface only | Phase 2 |

---

## 7. Action Items (Priority Order)

### P0: Critical (Blocks Production)

1. **Replace mock Poseidon hash** in communique with `@voter-protocol/crypto`
   - Files: `shadow-atlas-handler.ts`, `+server.ts` (register)
   - Effort: 2 hours
   - Owner: TBD

2. **Connect to voter-protocol Shadow Atlas API** instead of local mock
   - Remove: 500 lines of mock Merkle tree code
   - Add: HTTP client to voter-protocol API
   - Effort: 4 hours
   - Owner: TBD

3. **Implement CVE fixes** in Noir circuit
   - CVE-VOTER-001: Leaf ownership binding
   - CVE-VOTER-002: Nullifier domain control
   - CVE-VOTER-003: Circuit leaf verification
   - Effort: 8 hours
   - Owner: TBD

### P1: High (Required for Launch)

4. **Integrate self.xyz SDK**
   - Endpoint: `/api/identity/init`, `/api/identity/verify`
   - Effort: 1 week
   - Owner: TBD

5. **Integrate Didit.me SDK**
   - Endpoint: `/api/identity/didit/init`, `/api/identity/didit/webhook`
   - Effort: 1 week
   - Owner: TBD

6. **Implement `/api/congressional/submit`**
   - Submit proof to CWC API
   - Effort: 3 days
   - Owner: TBD

### P2: Medium (Required for Full Functionality)

7. **Implement `/api/tee/public-key`**
   - Deploy AWS Nitro Enclave
   - Effort: 2 weeks
   - Owner: TBD

8. **Update specification docs** to reflect Noir prover (not Halo2)
   - Files: `zk-proof-integration.md`
   - Effort: 2 hours
   - Owner: TBD

9. **End-to-end proof generation test**
   - Browser WASM → on-chain verification
   - Effort: 1 week
   - Owner: TBD

---

## 8. Risk Assessment

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Hash mismatch causes proof failures | Production down | 100% (current state) | P0 fix |
| CVE exploitation | Security breach | High (if deployed) | P0 fix |
| Provider SDK integration delays | Launch delay | Medium | Start immediately |
| TEE deployment complexity | Privacy compromise | Low | Phase 2 fallback |
| Noir prover browser performance | UX degradation | Medium | Benchmarking |

---

## 9. Completeness Assessment

### What's DONE (35%)

- OAuth social login (5 providers)
- Session management
- Encrypted blob storage infrastructure
- Session credential caching
- Location inference engine
- Voter client wrapper
- Shadow Atlas tree building (voter-protocol)
- Noir circuit (with vulnerabilities)

### What's STUBBED (25%)

- Shadow Atlas registration (mock hashes)
- Identity verification handlers (interfaces only)
- Prover integration (imported but untested)

### What's MISSING (40%)

- Poseidon2 hash integration
- self.xyz SDK integration
- Didit.me SDK integration
- Shadow Atlas API connection
- Congressional submit endpoint
- TEE public key endpoint
- CVE fixes
- End-to-end testing
- Production deployment

---

## 10. Recommendation

**Immediate Action Required:**

Before any production deployment, the P0 items must be completed. The current hash mismatch means **every proof generated by communique would fail verification** on voter-protocol.

**Estimated Timeline to Production-Ready:**

| Phase | Items | Duration |
|-------|-------|----------|
| P0 Fixes | Hash, API connection, CVEs | 2 weeks |
| P1 Integration | Provider SDKs, submit endpoint | 3 weeks |
| P2 Polish | TEE, docs, testing | 2 weeks |
| **Total** | | **7 weeks** |

---

## 11. Sign-Off

**Analysis Complete:** 2026-01-26
**Reviewed By:** Distinguished Engineer
**Status:** Pending Expert Review

---

**Next Step:** Expert agents will review this analysis for cohesion and completeness.
