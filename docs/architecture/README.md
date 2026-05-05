# Architecture Documentation Index

**Last Updated:** 2026-04-21

Navigation hub for VOTER Protocol architecture documentation, organized from strategic overview to implementation specifics.

---

## Canonical Documents

### Strategic Overview

**File:** [`/ARCHITECTURE.md`](../../ARCHITECTURE.md)
**Audience:** Product managers, external contributors, investors, governance participants
**Scope:** Executive summary, phase architecture, core technology decisions, deployment phases.

---

### Cryptographic Protocol Specification (Canonical)

**File:** [`/specs/CRYPTOGRAPHY-SPEC.md`](../../specs/CRYPTOGRAPHY-SPEC.md)
**Audience:** Cryptography engineers, security auditors, independent reviewers
**Scope:** Full ZK circuit topology (three-tree, position-note, debate-weight, bubble), Poseidon2 construction, domain separation registry, nullifier scheme (NUL-001), Aztec trusted-setup provenance, threat model, known limitations.

**When to read:** Implementing, auditing, or reviewing the cryptographic protocol. This is the single authoritative source.

---

### Companion Specifications

Each companion spec retains authority over its specific domain. Entry points:

| Spec | Authority |
|---|---|
| [`/specs/REPUTATION-ARCHITECTURE-SPEC.md`](../../specs/REPUTATION-ARCHITECTURE-SPEC.md) | Engagement tree semantics, tier derivation, Shannon diversity |
| [`/specs/SHADOW-ATLAS-SPEC.md`](../../specs/SHADOW-ATLAS-SPEC.md) | Geographic data acquisition, district registry, TIGER pipeline |
| [`/specs/TRUST-MODEL-AND-OPERATOR-INTEGRITY.md`](../../specs/TRUST-MODEL-AND-OPERATOR-INTEGRITY.md) | Operator surface area, walkaway roadmap, MACI parallel |
| [`/specs/DEBATE-MARKET-SPEC.md`](../../specs/DEBATE-MARKET-SPEC.md) | Market mechanics, LMSR pricing, resolution logic |
| [`/specs/STRING-ENCODING-SPEC.md`](../../specs/STRING-ENCODING-SPEC.md) | UTF-8 → BN254 chunking |

---

### Verifiable Solo Operator (Phase 1 Trust Model)

**File:** [`/docs/architecture/VERIFIABLE-SOLO-OPERATOR.md`](VERIFIABLE-SOLO-OPERATOR.md)
**Audience:** Security auditors, operators, integration developers
**Scope:** Hash-chained insertion log with Ed25519 signatures, registration receipts, public key auditability, residual trust vs. TEE/MPC (Phase 2+).

---

### Shadow Atlas Implementation

**File:** [`/packages/shadow-atlas/docs/ARCHITECTURE.md`](../../packages/shadow-atlas/docs/ARCHITECTURE.md)
**Audience:** Shadow Atlas maintainers, data pipeline engineers
**Scope:** Module hierarchy, service-oriented architecture, CI/CD, observability, deployment.

---

### Global Scaling

**File:** [`/specs/GLOBAL-SCALING-ARCHITECTURE.md`](../../specs/GLOBAL-SCALING-ARCHITECTURE.md)
**Audience:** International expansion team, provider integration engineers
**Scope:** Scaling to 190+ countries, provider-agnostic architecture, international boundary resolution patterns.

---

## Quick Reference by Role

| Task | Start with |
|---|---|
| New to the project | `/ARCHITECTURE.md` |
| Reviewing the cryptography | `/specs/CRYPTOGRAPHY-SPEC.md` |
| Building ZK infrastructure | `/specs/CRYPTOGRAPHY-SPEC.md` + `/specs/REPUTATION-ARCHITECTURE-SPEC.md` |
| Working on Shadow Atlas | `/packages/shadow-atlas/docs/ARCHITECTURE.md` + `/specs/SHADOW-ATLAS-SPEC.md` |
| Implementing smart contracts | `/ARCHITECTURE.md` + `/specs/CRYPTOGRAPHY-SPEC.md` §8 |
| International expansion | `/specs/GLOBAL-SCALING-ARCHITECTURE.md` |
| Deploying Shadow Atlas | `/docs/architecture/VERIFIABLE-SOLO-OPERATOR.md` |
| Security audit | `/specs/CRYPTOGRAPHY-SPEC.md` + `/specs/TRUST-MODEL-AND-OPERATOR-INTEGRITY.md` |

---

## Archived (Historical)

Pre-three-tree documents are preserved in `/docs/archive/` for historical reference only. They describe the single-tree and two-tree architectures, both superseded:

- `/docs/archive/ZK-PRODUCTION-ARCHITECTURE.md` — pre-two-tree production details
- `/docs/archive/NOIR-PROVING-INFRASTRUCTURE.md` — pre-two-tree Noir infrastructure
- `/docs/archive/zk-infrastructure.md` — pre-two-tree infrastructure overview

Do not rely on archived docs for current implementation guidance.

---

## Document Maintenance

When adding new architecture documentation:
1. Place strategic overviews in the root directory.
2. Place subsystem specs under `/specs/`.
3. Place operational and architecture docs under `/docs/architecture/`.
4. Update this index with clear audience, scope, and "when to read" guidance.
5. Avoid duplication — link instead of repeating.
