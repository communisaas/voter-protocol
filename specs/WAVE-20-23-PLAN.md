# Wave 20-23 Implementation Plan

> **Date:** 2026-02-10
> **Scope:** P1 + P2 remaining work items
> **Methodology:** implement → 3-agent expert review → manual engineering review → doc updates
> **Predecessor:** Waves 17-19 (registration, proof orchestration, auth, security hardening)

---

## Wave 20: Critical Test Coverage — COMPLETE

**Goal:** Validate all Wave 17-19 code with integration tests. The CRIT-001 `prove→generateProof` bug (hidden by type-only imports) proves that untested cross-boundary code is a runtime crash risk.

### 20a: Poseidon hash function tests (communique) — 22/22 PASS
- `tests/unit/crypto/poseidon.test.ts`
- Test: `poseidon2Hash2`, `poseidon2Hash3`, `computeNullifier`, `computeMerkleRoot`, `hexToFr`
- Cover: Domain separation, BN254 modulus rejection, empty hex (M-05), **cross-language golden vectors** from voter-protocol

### 20b: Proof input mapper tests (communique) — 27/27 PASS
- `tests/unit/identity/proof-input-mapper.test.ts`
- Test: `mapCredentialToProofInputs` field mapping (merkleRoot→userRoot, etc.)
- Cover: Two-tree credential validation, single-tree rejection, authority level fallback (level 3 conservative), missing field errors

### 20c: Registration endpoint tests (voter-protocol) — 20/20 PASS
- `packages/shadow-atlas/src/__tests__/unit/serving/registration-endpoint.test.ts`
- Test: POST /v1/register (auth, rate limiting, duplicate leaf, tree full, BN254 bounds)
- Test: GET /v1/cell-proof (valid cell, 404 not found, response format)
- Cover: CR-004 auth enforcement, CR-006 anti-oracle, Zod validation, rate limiting 429

### 20R: 3-agent review — 1 CRITICAL + 12 HIGH + 19 MEDIUM + 10 LOW
- ZK crypto: No golden vectors (CRITICAL, **FIXED**), stale nullifier comment (**FIXED**)
- Integration: Cache-Control overwrite (**FIXED**), already-registered missing pathIndices (**FIXED**)
- Security: CR-006 error message oracle (**FIXED**), rate limit untested (**FIXED**)

### 20M: Manual review + fixes — 7 fixes applied
1. Cache-Control: no-store overwrite in sendSuccessResponse → respect pre-set header
2. CR-006 oracle leak: unified error messages for duplicate/invalid/BN254 failures
3. Already-registered path: derive pathIndices from leafIndex bit decomposition
4. Stale nullifier comment in golden-vectors.test.ts (hash4→hash2 CVE-002)
5. Golden vector tests added (hash2(1,2) and hash2(0,0) cross-checked with Noir)
6. BN254 boundary tests at HTTP level (p, 2^256-1, zero)
7. Auth edge cases (empty bearer, wrong scheme), rate limit trigger test

---

## Wave 21: CI/CD Pipeline + Automated npm Publish

**Goal:** Sync voter-protocol to GitHub CI with structured commits and tractable deltas. Enable automated npm publish on tagged releases.

### 21a: GH Actions CI workflow
- `.github/workflows/ci.yml` — lint + typecheck + test on push/PR
- Matrix: packages/crypto, packages/shadow-atlas, packages/noir-prover, packages/client
- Cache: node_modules, Noir circuit artifacts
- Re-enable shadow-atlas CI (disabled since Feb 4)

### 21b: Automated npm publish workflow
- `.github/workflows/publish.yml` — publish on version tag (`v*`)
- Scoped packages: `@voter-protocol/crypto`, `@voter-protocol/noir-prover`, `@voter-protocol/shadow-atlas`, `@voter-protocol/client`
- `NPM_TOKEN` secret in GH repo settings
- Provenance: `--provenance` flag for supply-chain attestation

### 21c: Structured commit convention
- Conventional Commits enforced via commitlint
- Changesets or standard-version for version bumping
- `CHANGELOG.md` auto-generation per package

### 21R: 3-agent review (CI/CD security)
### 21M: Manual review + fixes

---

## Wave 22: Security Hardening (CR-005 + CR-010)

**Goal:** Persistent rate limiting and salt rotation enforcement.

### 22a: CR-005 — Redis-backed rate limiting
- Add `ioredis` dependency
- `src/security/redis-rate-limiter.ts` — Redis token bucket adapter
- Atomic operations via Redis EVAL script (prevents race conditions)
- Fallback to in-memory if Redis unavailable (with warning log)
- Config: `REDIS_URL` env var, key prefix `shadowatlas:ratelimit`
- Docker Compose: add Redis service

### 22b: CR-010 — Salt rotation enforcement (soft)
- Registration-service: add entropy validation (reject zero/max/sequential leaves)
- Add `registeredAt` timestamp to registration response
- Communique: store `registeredAt` in SessionCredential
- Communique: UI warning when credential > 6 months old
- Per-user rate limiting (1 registration per OAuth user per 24h) — prevents grinding

### 22R: 3-agent review (security)
### 22M: Manual review + fixes

---

## Wave 23: INT-003 Documentation + Privacy Clarity

**Goal:** Since mvpAddress can't be removed until TEE (Phase 2), document the Phase 1 privacy boundary clearly.

### 23a: Privacy boundary documentation
- `PRIVACY-BOUNDARY.md` — Phase 1 vs Phase 2 privacy guarantees
- Document what data the server sees (address for CWC delivery) vs what stays client-side (userSecret, registrationSalt, cellId)
- Document TEE removal path (Phase 2 prerequisite list)

### 23b: INT-003 code audit trail
- Add inline comments at mvpAddress code paths marking them as INT-003
- Add `@deprecated` annotations with removal target
- Log warning when mvpAddress path is used: "Phase 1 cleartext delivery — INT-003"

### 23c: Update all tracking docs
- IMPLEMENTATION-GAP-ANALYSIS.md — Rev 14 with Wave 20-23 status
- COMMUNIQUE-INTEGRATION-SPEC.md — updated status table
- MEMORY.md — updated remaining work items

### 23R: 3-agent review (docs + privacy)
### 23M: Manual review + fixes

---

## Dependency Graph

```
Wave 20 (tests) ──────────────────── independent
Wave 21 (CI/CD) ──────────────────── independent (can parallel with 20)
Wave 22 (security) ──── depends on Wave 21 (CI validates changes)
Wave 23 (docs) ──────── depends on Waves 20-22 (documents final state)
```

## Completion Criteria

After Wave 23:
- All P1 items either RESOLVED or DOCUMENTED with clear Phase 2 path
- All P2 items RESOLVED
- CI/CD pipeline running on every push
- npm packages publishable via `git tag v0.3.0 && git push --tags`
- Zero untested cross-boundary code paths in proof generation pipeline
- Integration maturity: 98% (only TEE + IPFS remain as Phase 2)

## Remaining After Wave 23 (Phase 2 / Future)
- TEE (Nitro Enclave) deployment → enables INT-003 mvpAddress removal
- IPFS/IPNS sync (SA-008) → real CID publishing
- Scroll Sepolia deployment → Wave 11 integration gate
- self.xyz SDK full integration
