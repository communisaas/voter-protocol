# Architecture Documentation Index

**Last Updated:** January 2026

This directory serves as the navigation hub for VOTER Protocol architecture documentation. The documentation is organized hierarchically from strategic overview to implementation specifics.

---

## Documentation Hierarchy

### 1. Strategic Overview (Start Here)

**File:** [`/ARCHITECTURE.md`](../../ARCHITECTURE.md) (root directory)
**Audience:** Product managers, external contributors, investors, governance participants
**Scope:**
- Executive summary and phase architecture (Phase 1: reputation-only; Phase 2: token economics)
- System architecture overview with visual diagrams
- Core technology decisions (Scroll settlement, Noir/Barretenberg ZK proofs, self.xyz identity)
- Budget breakdown and scaling economics
- Content moderation and compliance strategy

**When to read:** First document for understanding VOTER Protocol's overall architecture, design philosophy, and deployment phases.

---

### 2. Deep Dives by Subsystem

#### 2.1 Zero-Knowledge Infrastructure

**File:** [`/docs/ZK-PRODUCTION-ARCHITECTURE.md`](../ZK-PRODUCTION-ARCHITECTURE.md)
**Audience:** Cryptography engineers, security auditors, blockchain developers
**Scope:**
- Production-grade ZK proof system deployment (nation-state threat model)
- NullifierRegistry implementation (prevents replay attacks)
- Timelocked verifier governance and emergency response
- Formal verification requirements and audit readiness

**When to read:** Implementing or auditing the zero-knowledge proof infrastructure, especially nullifier management and verifier governance.

---

**File:** [`/docs/NOIR-PROVING-INFRASTRUCTURE.md`](../NOIR-PROVING-INFRASTRUCTURE.md)
**Audience:** Frontend engineers, cryptography implementers
**Scope:**
- Browser-native Noir/Barretenberg proving system
- Circuit design (UltraPlonk/UltraHonk on BN254)
- WASM execution requirements (COOP/COEP headers, SharedArrayBuffer)
- Migration from Halo2 to bb.js

**When to read:** Building the browser-based proving interface or optimizing proof generation performance.

---

#### 2.2 Shadow Atlas (Governance Boundary Resolution)

**File:** [`/packages/shadow-atlas/docs/ARCHITECTURE.md`](../../packages/shadow-atlas/docs/ARCHITECTURE.md)
**Audience:** Shadow Atlas maintainers, data pipeline engineers
**Scope:**
- Comprehensive module hierarchy (8 tiers, 41+ modules, 330+ TypeScript files)
- Service-oriented architecture with core service facade
- CI/CD infrastructure, observability, and resilience modules
- Automated deployment and operations

**When to read:** Working on Shadow Atlas internals, adding new modules, or understanding the complete package architecture.

---

**File:** [`/specs/GLOBAL-SCALING-ARCHITECTURE.md`](../../specs/GLOBAL-SCALING-ARCHITECTURE.md)
**Audience:** International expansion team, provider integration engineers
**Scope:**
- Scaling to 190+ countries with provider-agnostic architecture
- Design philosophy (governance structures as CONFIGURATION, not CODE)
- International boundary resolution patterns (parliamentary systems, proportional representation, federal vs. unitary governments)
- Provider abstraction interface specification

**When to read:** Implementing support for new countries or designing international boundary resolution providers.

---

### 3. Technical Implementation Reference

**File:** [`/ARCHITECTURE.md`](../../ARCHITECTURE.md) (root directory)
**Audience:** Blockchain developers, protocol designers, cryptography engineers
**Scope:**
- Implementation-level details for core cryptographic primitives
- Three-system privacy architecture (address verification, identity verification, message delivery)
- Noir/Barretenberg proving flow with performance benchmarks
- Smart contract interfaces and Scroll deployment specifics

**When to read:** Deep implementation work on cryptographic systems, smart contracts, or privacy infrastructure. Complements ARCHITECTURE.md with technical depth.

---

## Quick Reference by Role

**New to the project?** → Start with `/ARCHITECTURE.md`

**Building ZK proof infrastructure?** → `/docs/ZK-PRODUCTION-ARCHITECTURE.md` + `/docs/NOIR-PROVING-INFRASTRUCTURE.md`

**Working on Shadow Atlas?** → `/packages/shadow-atlas/docs/ARCHITECTURE.md` (implementation) + `/specs/GLOBAL-SCALING-ARCHITECTURE.md` (scaling strategy)

**Implementing smart contracts?** → `/ARCHITECTURE.md` + `/docs/ZK-PRODUCTION-ARCHITECTURE.md`

**Planning international expansion?** → `/specs/GLOBAL-SCALING-ARCHITECTURE.md`

**Conducting security audit?** → `/docs/ZK-PRODUCTION-ARCHITECTURE.md` (threat model and formal verification requirements)

---

## Document Maintenance

This index is maintained manually. When adding new architecture documentation:
1. Place strategic overviews in the root directory
2. Place subsystem-specific docs in `/docs/` or package-specific directories
3. Update this index with clear audience, scope, and "when to read" guidance
4. Ensure no duplication between documents (link instead of repeating)
