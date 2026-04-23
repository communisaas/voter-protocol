# voter-protocol Specifications

Navigation guide for the specification documents. Files are organized by authority level.

## Canonical (Start Here)

| Document | Description | Authority |
|----------|-------------|-----------|
| [CRYPTOGRAPHY-SPEC.md](CRYPTOGRAPHY-SPEC.md) | **Canonical cryptographic protocol spec** — circuits, Poseidon2, domain separation, nullifier scheme, trusted setup, threat model | All ZK and hash primitives |
| [REPUTATION-ARCHITECTURE-SPEC.md](REPUTATION-ARCHITECTURE-SPEC.md) | Three-tree engagement semantics — tier derivation, Shannon diversity, composite score | Engagement layer |
| [SHADOW-ATLAS-SPEC.md](SHADOW-ATLAS-SPEC.md) | Geographic data acquisition, district registry, TIGER pipeline | Geographic / data layer |
| [TRUST-MODEL-AND-OPERATOR-INTEGRITY.md](TRUST-MODEL-AND-OPERATOR-INTEGRITY.md) | Trust stack, operator surface area, walkaway roadmap, MACI parallel | Threat model |
| [DEBATE-MARKET-SPEC.md](DEBATE-MARKET-SPEC.md) | Market mechanics, LMSR pricing, resolution logic | Debate market |
| [COMMUNIQUE-INTEGRATION-SPEC.md](COMMUNIQUE-INTEGRATION-SPEC.md) | Commons-side integration contract | Frontend bridge |

## Foundational Specs (Architecture-Agnostic)

| Document | Description |
|----------|-------------|
| [DISTRICT-TAXONOMY.md](DISTRICT-TAXONOMY.md) | 24-slot district type hierarchy and FIPS/TIGER codes |
| [PUBLIC-INPUT-FIELD-REFERENCE.md](PUBLIC-INPUT-FIELD-REFERENCE.md) | Canonical naming for public inputs across circuits |
| [STRING-ENCODING-SPEC.md](STRING-ENCODING-SPEC.md) | Field element string encoding (31-byte chunks, Poseidon2) |
| [DATA-INTEGRITY-SPEC.md](DATA-INTEGRITY-SPEC.md) | Data freshness and provenance requirements |
| [DEPTH-PARAMETERIZATION-PLAN.md](DEPTH-PARAMETERIZATION-PLAN.md) | Multi-depth circuit compilation (depths 18/20/22/24) |
| [ADVERSARIAL-ATTACK-DOMAINS.md](ADVERSARIAL-ATTACK-DOMAINS.md) | Attack surface taxonomy |

## Security Tracking

| Document | Description |
|----------|-------------|
| [IMPLEMENTATION-GAP-ANALYSIS.md](IMPLEMENTATION-GAP-ANALYSIS.md) | Master tracker — audit findings, remediation status |
| [REMEDIATION-WAVE-PLAN.md](REMEDIATION-WAVE-PLAN.md) | Wave-based remediation execution plan |
| [audits/](audits/) | Individual audit reports (see index) |

## Design Proposals (Approved, Not Implemented)

| Document | Phase | Description |
|----------|-------|-------------|
| [DESIGN-001-CROSS-PROVIDER-DEDUP.md](DESIGN-001-CROSS-PROVIDER-DEDUP.md) | 2+ | Phone-based cross-provider deduplication |
| [DESIGN-003-REDISTRICTING-PROTOCOL.md](DESIGN-003-REDISTRICTING-PROTOCOL.md) | 2+ | Emergency redistricting response protocol |
| [DESIGN-004-COALITION-COORDINATION.md](DESIGN-004-COALITION-COORDINATION.md) | 1.5 | Shared templates, multi-org endorsement |
| [EVIDENCE-PROVENANCE-SPEC.md](EVIDENCE-PROVENANCE-SPEC.md) | 1.5 | Structured evidence attachment, verification levels |
| [SHADOW-ATLAS-CLI-SPEC.md](SHADOW-ATLAS-CLI-SPEC.md) | — | Unified CLI to replace ad-hoc scripts |
| [GLOBAL-SCALING-ARCHITECTURE.md](GLOBAL-SCALING-ARCHITECTURE.md) | 3+ | International expansion (190+ countries) |
| [GOVERNANCE-VERIFICATION-SYSTEM-SPEC.md](GOVERNANCE-VERIFICATION-SYSTEM-SPEC.md) | 3+ | Representative database and verification swarms |

## Superseded (Redirect Stubs)

These paths exist only as redirect stubs. Full historical content is in [`archive/`](archive/).

| Document | Replacement |
|----------|-------------|
| [TWO-TREE-ARCHITECTURE-SPEC.md](TWO-TREE-ARCHITECTURE-SPEC.md) | CRYPTOGRAPHY-SPEC + REPUTATION-ARCHITECTURE-SPEC |
| [DISTRICT-MEMBERSHIP-CIRCUIT-SPEC.md](DISTRICT-MEMBERSHIP-CIRCUIT-SPEC.md) | CRYPTOGRAPHY-SPEC (§5.1 canonical, §11.1 retirement notes) |
| [REDISTRICTING-CELL-COMMITMENT-ANALYSIS.md](REDISTRICTING-CELL-COMMITMENT-ANALYSIS.md) | CRYPTOGRAPHY-SPEC (§4.2 Tree 2 SMT) |
| [archive/](archive/) | Various |

## Reading Order for New Developers

1. **This README** (5 min) — Orientation
2. **[CRYPTOGRAPHY-SPEC.md](CRYPTOGRAPHY-SPEC.md)** (30 min) — Canonical cryptographic architecture
3. **[REPUTATION-ARCHITECTURE-SPEC.md](REPUTATION-ARCHITECTURE-SPEC.md)** (20 min) — Engagement semantics
4. **[SHADOW-ATLAS-SPEC.md](SHADOW-ATLAS-SPEC.md)** Sections 1–6 (15 min) — Geographic data
5. **[DISTRICT-TAXONOMY.md](DISTRICT-TAXONOMY.md)** Section 2 (10 min) — District slot allocation
6. **[TRUST-MODEL-AND-OPERATOR-INTEGRITY.md](TRUST-MODEL-AND-OPERATOR-INTEGRITY.md)** (20 min) — What the protocol trusts and why
7. **[IMPLEMENTATION-GAP-ANALYSIS.md](IMPLEMENTATION-GAP-ANALYSIS.md)** Executive Summary (5 min) — Security posture
