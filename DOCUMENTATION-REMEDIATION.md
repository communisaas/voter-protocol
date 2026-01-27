# Documentation Remediation Plan

**Author:** Distinguished Engineer
**Date:** 2026-01-26
**Status:** IN PROGRESS

---

## Executive Summary

Following comprehensive security remediation (6 CVEs, 7 expert-identified issues - all verified in code), an audit revealed significant documentation drift. This document tracks the systematic cleanup of documentation across voter-protocol and communique repositories.

**Key Finding:** The code is production-ready. The documentation lags behind, with critical misalignments that could mislead integrators.

---

## CRITICAL: Cross-Repository Misalignment

### Issue CR-001: Prover Technology References (CRITICAL)

**Problem:** Communique documentation references **Halo2** prover throughout, but the actual implementation uses **Noir/UltraHonk**.

**Affected Files:**
| File | Line(s) | Current | Should Be |
|------|---------|---------|-----------|
| `/communique/docs/specs/zk-proof-integration.md` | 3-4 | "Halo2 circuits PRODUCTION-READY" | "Noir/UltraHonk circuits" |
| `/communique/docs/specs/zk-proof-integration.md` | 53-58 | `@voter-protocol/crypto` | `@voter-protocol/noir-prover` |
| `/communique/docs/specs/zk-proof-integration.md` | 221-224 | "Verify Halo2 proof" | "Verify UltraHonk proof" |
| `/communique/docs/architecture.md` | 66-67 | `@voter-protocol/crypto` | `@voter-protocol/noir-prover` |
| `/communique/docs/frontend.md` | 701-718 | "WASM Halo2 prover" | "Noir/UltraHonk prover" |

**Status:** [x] COMPLETE (2026-01-26) - All Halo2 refs replaced with Noir/UltraHonk

---

### Issue CR-002: Circuit Input Interface (CRITICAL)

**Problem:** Communique docs show OLD circuit interface. The secure circuit (post-CVE fix) has different inputs.

**OLD Interface (documented):**
```typescript
{
  identity_commitment: string;
  action_id: string;
  leaf_index: number;
  merkle_path: string[];
}
```

**NEW Interface (actual):**
```typescript
{
  merkleRoot: string;        // PUBLIC: contract-controlled
  actionDomain: string;      // PUBLIC: replaces epochId + campaignId
  userSecret: string;        // PRIVATE: user identity
  districtId: string;        // PRIVATE: district membership
  authorityLevel: 1|2|3|4|5; // PRIVATE: trust tier
  registrationSalt: string;  // PRIVATE: anti-rainbow salt
  merklePath: string[];      // PRIVATE: Merkle proof
  leafIndex: number;         // PRIVATE: tree position
}
```

**Key Change:** Leaf is now COMPUTED inside circuit from user inputs (CVE-001/003 fix).

**Affected Files:**
- `/communique/docs/specs/zk-proof-integration.md` - entire circuit section
- `/communique/src/lib/core/proof/prover-core.ts` - `WitnessData` interface (transitional)

**Status:** [x] COMPLETE (2026-01-26) - Updated to new CircuitInputs interface

---

### Issue CR-003: Nullifier Formula Mismatch

**Problem:** Different nullifier formulas documented.

| Location | Formula |
|----------|---------|
| communique docs | `nullifier = Poseidon(identity_commitment, action_id)` |
| voter-protocol (actual) | `nullifier = hash(userSecret, actionDomain)` |

**Status:** [x] COMPLETE (2026-01-26) - Updated to hash(userSecret, actionDomain)

---

## VOTER-PROTOCOL: Documentation Consolidation

### Issue VP-001: Misleading Spec Name

**Problem:** `/specs/GEOGRAPHIC-CELL-CIRCUIT-SPEC.md` has "cell" in name but describes district-based implementation.

**Action:** Rename to `DISTRICT-MEMBERSHIP-CIRCUIT-SPEC.md`

**Status:** [x] COMPLETE (renamed 2026-01-26)

---

### Issue VP-002: Rejected Architecture in Active Docs

**Problem:** `/docs/roadmap/phase-2/cell-trees.md` describes the REJECTED cell-based architecture.

**Action:** Move to `/docs/archive/rejected-designs/cell-trees.md`

**Status:** [x] COMPLETE (2026-01-26) - Archived with deprecation header

---

### Issue VP-003: Duplicate Gap Analyses

**Problem:** Two gap analysis documents exist:
- `/GAP_ANALYSIS.md` (root) - December 2025, high-level
- `/specs/IMPLEMENTATION-GAP-ANALYSIS.md` - January 2026, includes CVE analysis

**Action:** Merge root GAP_ANALYSIS.md content into specs/IMPLEMENTATION-GAP-ANALYSIS.md, archive original.

**Status:** [x] COMPLETE (2026-01-26) - Merged as Appendix D, original deleted

---

### Issue VP-004: Remediation Plan Separation

**Problem:** `/specs/SYSTEMATIC-REMEDIATION-PLAN.md` is implementation detail for gap analysis.

**Action:** Merge as "Remediation Approaches" section in IMPLEMENTATION-GAP-ANALYSIS.md.

**Status:** [x] COMPLETE (2026-01-26) - Merged into gap analysis, original deleted

---

### Issue VP-005: Data Spec Fragmentation

**Problem:** Two related specs that should be one:
- `/specs/DATA-FRESHNESS-SPEC.md`
- `/specs/DATA-PROVENANCE-SPEC.md`

**Action:** Merge into `/specs/DATA-INTEGRITY-SPEC.md` covering freshness, provenance, and validation.

**Status:** [x] COMPLETE (2026-01-26) - Merged into DATA-INTEGRITY-SPEC.md, originals deleted via git rm

---

### Issue VP-006: Misplaced Architecture Doc

**Problem:** `/docs/GEOCODING-ARCHITECTURE.md` is Shadow Atlas implementation detail.

**Action:** Move to `/packages/shadow-atlas/docs/GEOCODING-ARCHITECTURE.md`

**Status:** [x] COMPLETE (2026-01-26) - Moved via git mv

---

## COMMUNIQUE: Missing Documentation

### Issue CM-001: Authority Level System Undocumented

**Problem:** The 5-tier authority system is not documented in communique.

**Required Documentation:**
```
Tier 1: Self-claimed (no KYC, Sybil-vulnerable)
Tier 2: Location-hinted (IP/GPS correlation)
Tier 3: Socially vouched (peer attestations)
Tier 4: Document-verified (self.xyz/Didit.me)
Tier 5: Government-issued (state ID + liveness)
```

**Status:** [x] COMPLETE (2026-01-26) - Created `/communique/docs/authority-levels.md`

---

### Issue CM-002: Shadow Atlas API Integration

**Problem:** No documentation on connecting to voter-protocol's Shadow Atlas API.

**Required Documentation:**
- `GET /v1/lookup?lat={lat}&lng={lng}` - district lookup
- `GET /v1/proof?district={id}` - Merkle proof retrieval
- Response formats and error handling

**Status:** [x] COMPLETE (2026-01-26) - Created `/communique/docs/shadow-atlas-integration.md`

---

### Issue CM-003: Poseidon2 Hash Requirement

**Problem:** No clear documentation that all hashes MUST use Poseidon2 to match circuit.

**Status:** [x] COMPLETE (2026-01-26) - Created `/communique/docs/cryptography.md`

---

## Completion Tracking

| Wave | Issues | Agent | Status |
|------|--------|-------|--------|
| 1 | CR-001, CR-002, CR-003 | Prover docs specialist | [x] COMPLETE |
| 2 | VP-001, VP-002, VP-003, VP-004 | Docs consolidation | [x] COMPLETE |
| 3 | VP-005, VP-006 | Spec merger | [x] COMPLETE |
| 4 | CM-001, CM-002, CM-003 | Integration docs | [x] COMPLETE |

---

## Post-Remediation Checklist

- [x] All "Halo2" references replaced with "Noir/UltraHonk"
- [x] Circuit interface documentation matches actual types.ts
- [x] No cell-based architecture references in active docs
- [x] Single canonical gap analysis document
- [x] DATA-INTEGRITY-SPEC.md created and comprehensive
- [x] Authority tier system documented in communique
- [x] Shadow Atlas API documented in communique
- [x] Poseidon2 hash requirement documented in communique
- [x] Cross-references between repos verified

---

**Document Version:** 1.1
**Last Updated:** 2026-01-26 (Cross-references verified and completed)
