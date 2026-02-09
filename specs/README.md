# voter-protocol Specifications

Navigation guide for the specification documents. Files are organized by maturity level.

## Current Architecture (Implemented)

| Document | Description | Lines |
|----------|-------------|-------|
| [TWO-TREE-ARCHITECTURE-SPEC.md](TWO-TREE-ARCHITECTURE-SPEC.md) | **Canonical** cryptographic architecture (v0.3.0) | 1610 |
| [SHADOW-ATLAS-SPEC.md](SHADOW-ATLAS-SPEC.md) | Geographic data acquisition and district registry | 1803 |
| [TWO-TREE-AGENT-REVIEW-SUMMARY.md](TWO-TREE-AGENT-REVIEW-SUMMARY.md) | Implementation progress tracker (Phase 1-4 complete) | 312 |
| [COMMUNIQUE-INTEGRATION-SPEC.md](COMMUNIQUE-INTEGRATION-SPEC.md) | Frontend integration spec (Phase 5 in progress) | 389 |

## Foundational Specs (Architecture-Agnostic)

| Document | Description | Lines |
|----------|-------------|-------|
| [DISTRICT-TAXONOMY.md](DISTRICT-TAXONOMY.md) | 24-slot district type hierarchy and FIPS/TIGER codes | 971 |
| [PUBLIC-INPUT-FIELD-REFERENCE.md](PUBLIC-INPUT-FIELD-REFERENCE.md) | Canonical naming for 29 public inputs across all components | 66 |
| [STRING-ENCODING-SPEC.md](STRING-ENCODING-SPEC.md) | Field element string encoding (31-byte chunks, Poseidon2) | 323 |
| [DATA-INTEGRITY-SPEC.md](DATA-INTEGRITY-SPEC.md) | Data freshness and provenance requirements | 647 |
| [DEPTH-PARAMETERIZATION-PLAN.md](DEPTH-PARAMETERIZATION-PLAN.md) | Multi-depth circuit compilation (depth-20 active) | 547 |
| [ADVERSARIAL-ATTACK-DOMAINS.md](ADVERSARIAL-ATTACK-DOMAINS.md) | Attack surface taxonomy (12 domains) | 755 |
| [TRUST-MODEL-AND-OPERATOR-INTEGRITY.md](TRUST-MODEL-AND-OPERATOR-INTEGRITY.md) | Trust stack, operator surface area, walkaway roadmap | 680 |

## Security Tracking

| Document | Description | Lines |
|----------|-------------|-------|
| [IMPLEMENTATION-GAP-ANALYSIS.md](IMPLEMENTATION-GAP-ANALYSIS.md) | **Master tracker** — 3 audit rounds, 51 findings (Rev 8) | 2920 |
| [REMEDIATION-WAVE-PLAN.md](REMEDIATION-WAVE-PLAN.md) | Wave-based remediation execution plan | 1402 |
| [audits/](audits/) | Individual audit reports ([see index](audits/README.md)) | — |

## Design Proposals (Approved, Not Implemented)

| Document | Phase | Description | Lines |
|----------|-------|-------------|-------|
| [DESIGN-001-CROSS-PROVIDER-DEDUP.md](DESIGN-001-CROSS-PROVIDER-DEDUP.md) | 2+ | Phone-based cross-provider deduplication | 873 |
| [DESIGN-003-REDISTRICTING-PROTOCOL.md](DESIGN-003-REDISTRICTING-PROTOCOL.md) | 2+ | Emergency redistricting response protocol | 1350 |
| [SHADOW-ATLAS-CLI-SPEC.md](SHADOW-ATLAS-CLI-SPEC.md) | — | Unified CLI to replace 87 ad-hoc scripts | 1369 |
| [GLOBAL-SCALING-ARCHITECTURE.md](GLOBAL-SCALING-ARCHITECTURE.md) | 3+ | International expansion (190+ countries) | 1620 |
| [GOVERNANCE-VERIFICATION-SYSTEM-SPEC.md](GOVERNANCE-VERIFICATION-SYSTEM-SPEC.md) | 3+ | Representative database and verification swarms | 2657 |

## Historical (Superseded)

| Document | Superseded By | Description |
|----------|---------------|-------------|
| [DISTRICT-MEMBERSHIP-CIRCUIT-SPEC.md](DISTRICT-MEMBERSHIP-CIRCUIT-SPEC.md) | TWO-TREE-ARCHITECTURE-SPEC | Single-tree circuit (5 public outputs) |
| [REDISTRICTING-CELL-COMMITMENT-ANALYSIS.md](REDISTRICTING-CELL-COMMITMENT-ANALYSIS.md) | TWO-TREE-ARCHITECTURE-SPEC | Alternative cell-commitment model analysis |
| [archive/](archive/) | Various | Fully superseded documents |

## Reading Order for New Developers

1. **This README** (5 min) — Orientation
2. **TWO-TREE-ARCHITECTURE-SPEC.md** (30 min) — Core cryptographic architecture
3. **SHADOW-ATLAS-SPEC.md** Sections 1-6 (15 min) — How geographic data is acquired
4. **DISTRICT-TAXONOMY.md** Section 2 (10 min) — District slot allocation
5. **TRUST-MODEL-AND-OPERATOR-INTEGRITY.md** (20 min) — What the protocol trusts and why
6. **IMPLEMENTATION-GAP-ANALYSIS.md** Executive Summary (5 min) — Security posture
