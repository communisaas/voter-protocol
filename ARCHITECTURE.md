# VOTER Protocol: Technical Architecture

**Status**: Active development - Phase 1 implementation (Noir/Barretenberg UltraHonk, reputation-only)
**Last Updated**: February 2026
**Implementation**: Smart contracts in this repo, frontend in Communique repo (external)
**Core Decisions**: Scroll settlement, Noir/Barretenberg zero-knowledge proofs, Scroll identity registry (on-chain Sybil resistance), no database PII storage, no NEAR dependency

---

## Executive Summary

Democratic infrastructure should not ask for permission to protect its citizens. Phase 1 enforces privacy by construction: proofs replace identities, signals replace surveillance, and reputation records—not people—touch the chain. Institutions get verifiable civic signal; citizens keep sovereignty.

**Settlement**: Scroll zkEVM (Ethereum L2)
**Identity**: mDL via Digital Credentials API (browser-native, ISO 18013-5)
**Privacy**: Browser‑native Noir/Barretenberg proofs; addresses never leave the device
**Storage**: Minimal metadata only; encrypted where needed
**Delivery**: CWC API with enclave‑protected processing
**Moderation**: 3‑layer stack (automation + consensus + human)
**Phasing**: Phase 1 reputation; Phase 2 economics

---

## Table of Contents

- [Executive Summary](#executive-summary)
- [Phase Architecture Overview](#phase-architecture-overview)
- [System Architecture Overview](#system-architecture-overview)
- [System Architecture Layers](#system-architecture-layers)
- [ZK Privacy Infrastructure](#zk-privacy-infrastructure)
- [Identity Verification Infrastructure (Phase 1)](#identity-verification-infrastructure-phase-1)
- [Content Moderation Architecture (Phase 1)](#content-moderation-architecture-phase-1)
- [Template Storage System](#template-storage-system)
- [Settlement Layer](#settlement-layer)
- [Phase 2 Features (Deferred)](#phase-2-features-deferred)
- [Engagement Pipeline](#engagement-pipeline)
- [Graduated Trust Discovery Model](#graduated-trust-discovery-model)
- [Complete Civic Action Flow](#complete-civic-action-flow)
- [Browser-Native Congressional Delivery](#browser-native-congressional-delivery)
- [Complete User Flow](#complete-user-flow)
- [Privacy Guarantees & Attack Surface](#privacy-guarantees--attack-surface)
- [Implementation Roadmap](#implementation-roadmap)
- [Cost Breakdown](#cost-breakdown)
- [Agent System Architecture](#agent-system-architecture)
- [Phase 1 Infrastructure Costs](#phase-1-infrastructure-costs)
- [Critical Integration Points](#critical-integration-points)
- [Documentation Status](#documentation-status)

---

## Phase Architecture Overview

VOTER Protocol launches in phases. Phase 1 establishes cryptographic foundations and proves civic utility **with full privacy from day one** (browser-native Noir/Barretenberg proofs, selective disclosure). Phase 2 adds token economics. Phase 3+ (speculative, only if community demands) would explore **enhanced** privacy through nested ZK proofs.

### Phase 1: Cryptographic Infrastructure (Current - 3 Months to Launch)

**What Ships:**
- Noir/Barretenberg zero-knowledge district proofs (browser-native WASM, UltraHonk + keccak mode, ~2.2M gas on Scroll; production-grade since 2024)
- Addresses never leave browser, never stored in any database
- Message content encryption from platform operators (XChaCha20-Poly1305, delivered as plaintext to congressional offices via CWC API)
- Browser-native proving (zero cloud dependency, $0/month infrastructure cost)
- Cross-chain account abstraction (NEAR Chain Signatures, explored but not in current implementation)
- On-chain reputation (ERC-8004 portable credibility, no token rewards)
- 3-layer content moderation (Section 230 compliant)
- FREE identity verification (mDL via W3C Digital Credentials API, browser-native, $0/user)

**Budget:** $3,500/month for 1,000 users / 10,000 messages (AWS Nitro Enclaves message encryption + moderation)

**What's NOT in Phase 1:**
- VOTER token (Phase 2)
- Staked debates / challenge markets (Phase 2 — contract implemented, frontend integrated off-chain, on-chain settlement pending deployment)
- Outcome markets (Phase 2)
- Token rewards (Phase 2)
- Multi-agent treasury (Phase 2)

### Phase 2: Token Economics (12-18 Months Post-Launch)

**Additions:**
- VOTER token launch (utility + governance)
- Staked debates (DebateMarket.sol — 721 lines, 107 tests, contract ready for deployment; Communiqué frontend integrated off-chain with 9 Svelte 5 components, 6 API routes, debate-scoped ZK proofs)
- Outcome markets (retroactive funding for legislative impact)
- Multi-agent treasury (SupplyAgent + MarketAgent for token economics)
- Privacy pools (optional shielded transactions with association proofs)
- **VOTER token economics** (see below)

**Why Delayed:** Token launches require legal compliance (CLARITY Act framework), liquidity infrastructure, economic security audits. Phase 1 proves civic utility before adding financial layer.

> **📋 See [Phase 2 Design Document](docs/roadmap/phase-2-design.md) for complete specifications, implementation roadmap, smart contracts, and cost analysis.**

#### Three-Tree ZK Architecture (Production)

> **Status:** IMPLEMENTED (circuit, prover, contracts, engagement pipeline) — See [specs/REPUTATION-ARCHITECTURE-SPEC.md](specs/REPUTATION-ARCHITECTURE-SPEC.md) for engagement scoring and [specs/TWO-TREE-ARCHITECTURE-SPEC.md](specs/TWO-TREE-ARCHITECTURE-SPEC.md) for legacy two-tree reference. Token design (§7) is Phase 2.

The production ZK circuit uses a **three-tree architecture** with 31 public inputs. Trees 1 and 2 handle user identity and cell-district mapping (unchanged from the legacy two-tree path). Tree 3 adds cryptographically verifiable engagement data, producing `engagement_root` and `engagement_tier` as public outputs.

**Three-Tree Architecture:**
- **Tree 1** (User Identity): Unchanged — H4(user_secret, cell_id, registration_salt, authority_level)
- **Tree 2** (Cell Mapping): Unchanged — H2(cell_id, district_commitment)
- **Tree 3** (Engagement): NEW — H2(identity_commitment, engagement_data_commitment)

**Anti-Pay-to-Win Guarantees:**

| Dimension | Source | Purchasable |
|-----------|--------|-------------|
| authority_level (1-5) | Identity verification (passport/ID/mDL) | No |
| engagement_tier (0-4) | On-chain nullifier consumption events | No |
| VOTER token balance | Market/earning | Yes (cannot boost authority or engagement) |

**Privacy:** Only the coarse `engagement_tier` (5 buckets) is a public output. The underlying `action_count` and `diversity_score` are private inputs — no behavioral fingerprint leaks.

**Dual Token Model:** VOTER (ERC-20, transferable) for civic labor compensation + soulbound engagement credential (ERC-8004, non-transferable) mirroring on-chain engagement tier.

### Phase 3+: Enhanced Privacy (Speculative - 2+ Years, Only If Community Demands)

**Context:** Phase 1 already provides **full privacy** through browser-native Noir/Barretenberg proofs that never transmit addresses. Users have selective disclosure from day one (prove district membership without revealing address, prove reputation range without exact score). Phase 3+ would explore **optional, stronger privacy** features that come with architectural tradeoffs.

**Only if community demands AND congressional offices accept:**
- Nested ZK proofs (prove "reputation > 5000" without revealing exact score, vs current exact scoring visible to congressional offices)
- Shielded message metadata (hide send timestamps, template IDs from on-chain records)

**Tradeoff:** Congressional offices receive weaker aggregate signals (ranges instead of exact scores, hidden timestamps). This reduces the signal quality offices use to gauge constituent intensity and coordination. Phase 3+ only ships if offices explicitly accept this reduction in data granularity.

---

## System Architecture Overview

> **NOTE**: This diagram shows the complete Phase 1 + Phase 2 architecture. Phase 1 excludes: VOTER tokens (reputation-only), Filecoin archival (deferred). NEAR Chain Signatures are optional for simplified UX. Addresses never stored in any database (full zero-knowledge). See "Phase Architecture Overview" section for detailed breakdown.

```mermaid
%%{init: {'theme':'dark', 'themeVariables': { 'primaryTextColor':'#fff', 'secondaryTextColor':'#fff', 'tertiaryTextColor':'#fff'}}}%%
flowchart TB
    User[User Entry]

    subgraph Entry["User Types"]
        ETH[ETH-Native Has Metamask]
        New[New to Web3 No wallet]
    end

    subgraph NEAR["NEAR Control Layer (Optional)"]
        Account[Implicit Account FREE instant]
        ChainSig[Chain Signatures Multi-chain Control]
    end

    subgraph Privacy["ZK Privacy Layer"]
        Atlas[Shadow Atlas District Merkle Tree]
        Circuit[Noir Circuit Browser-based]
        Proof[ZK Proof 4-6 sec generation]
    end

    subgraph Storage["Template Storage"]
        PG[(PostgreSQL Fast Queries)]
        FC[Filecoin Archival]
    end

    subgraph Settlement["Settlement Layer"]
        Scroll[Scroll zkEVM Stage 1 Decentralized < $0.01 typical]
    end

    subgraph Verify["Verification"]
        CWC[Congressional CWC API]
        Agents[Multi-Agent Consensus]
    end

    User --> Entry
    ETH --> Account
    New --> Account

    Account --> ChainSig
    ChainSig --> Circuit
    Atlas --> Circuit
    Circuit --> Proof

    Proof --> Scroll

    PG --> Scroll
    PG -.Archive.-> FC

    Scroll --> Agents
    CWC --> Agents

    Agents --> Rewards[VOTER Tokens + Reputation]

    style NEAR fill:#4A90E2,stroke:#fff,color:#fff
    style Privacy fill:#7B68EE,stroke:#fff,color:#fff
    style Settlement fill:#50C878,stroke:#fff,color:#fff
    style Storage fill:#FFB347,stroke:#fff,color:#fff
```

## System Architecture Layers

### Layer 1: NEAR Account Creation (Universal Entry Point)

> **Status Note (February 2026):** NEAR Chain Signatures were explored as a cross-chain account abstraction path but are **not in the current implementation**. Phase 1 uses direct Scroll wallet interaction. This section is preserved as architectural context for potential future integration.

**Implicit Account Architecture** - Optional for cross-chain account abstraction:
- **Account Type**: Implicit accounts (64-character hex addresses)
- **Creation Time**: Instant (no on-chain transaction required)
- **Creation Cost**: FREE (account exists automatically when funded)
- **Storage**: 0.05-0.1 NEAR sponsored for storage deposit (one-time)
- **Reference**: [NEAR Implicit Accounts](https://docs.near.org/concepts/protocol/account-id)

**Why Optional?** ETH-native users can use MetaMask directly on Scroll. NEAR Chain Signatures provides multi-chain convenience for new users.

---

### Layer 2: Identity Verification

**NOTE:** Identity verification is Phase 2 only (for economic incentives). Phase 1 uses permissionless address verification via browser-native ZK proofs.

**Primary: mDL via W3C Digital Credentials API (Browser-Native)**
- Mobile driver's license (mDL) presentation via `navigator.identity.get()` (ISO 18013-5)
- Browser-native selective disclosure: only requested fields (age, address, name) are revealed
- No third-party SDK or API keys required ($0/user)
- User's browser generates ZK proof separately (address stays in browser)
- Cost: $0 per verification (browser-native, no intermediary)
- Privacy: Selective disclosure per ISO 18013-5; only district-relevant fields requested

> **Legacy note**: Existing users verified via self.xyz (`verification_method='self.xyz'`) or Didit.me (`verification_method='didit'`) retain their verified status. These providers have been removed from the Communique codebase as of Cycle 15 (February 2026). The protocol architecture supports extensible identity providers for future implementations.

**Privacy**: No third-party provider stores PII. Identity commitments (Poseidon hash of passport#, nationality, birthYear) registered on Scroll L2 for Sybil resistance via UserRootRegistry. PII never stored anywhere.

---

### Layer 3: Identity Registry (Scroll L2 Smart Contract)

> **IMPORTANT**: Phase 1 uses on-chain identity commitments for Sybil resistance. NO PII is stored anywhere (not on-chain, not in database, not on NEAR). This is the ONLY identity storage in the system.

**Contract**: Identity commitments via on-chain registries (Solidity/Scroll L2)

**Purpose**: On-chain Sybil resistance via Poseidon hash commitments. Identity commitment logic is embedded in the UserRootRegistry and DistrictGate flows rather than a standalone IdentityRegistry contract.

**Storage Model**:
- **Identity commitment** → registered status (mapping)
- **Identity commitment** → registration timestamp
- **User address** → identity commitment (reverse lookup)

**Client-Side Commitment Generation** (browser-only, zero storage):

```typescript
// IMPORTANT: This runs server-side after mDL presentation, NOT in browser
// PII is extracted from selective disclosure response, hashed, and discarded immediately
import { poseidon2 } from '@noble/curves/abstract/poseidon';

function generateIdentityCommitment(
    passportNumber: string,
    nationality: string,
    birthYear: number
): string {
    // Normalize inputs (same identity = same hash)
    const normalizedPassport = passportNumber.toUpperCase().replace(/[\s-]/g, '');
    const normalizedNationality = nationality.toUpperCase();

    // Convert to field elements for Poseidon hash
    const passportField = stringToFieldElement(normalizedPassport);
    const nationalityField = stringToFieldElement(normalizedNationality);
    const birthYearField = BigInt(birthYear);

    // Poseidon hash (ZK-friendly, compatible with Noir circuits)
    const hash = poseidon2([passportField, nationalityField, birthYearField]);

    return '0x' + hash.toString(16).padStart(64, '0');
}

// Register on Scroll L2 (platform wallet pays gas)
const tx = await identityRegistry.registerIdentity(commitment);
await tx.wait();

// PII DISCARDED IMMEDIATELY (never stored anywhere)
```

**Gas Costs** (October 2025 pricing - post-Dencun upgrade):
- **Identity registration**: ~$0.0015 per user (one-time)
- **Identity check**: FREE (view function)

**Scale Economics**:
- 100 users = **$0.15** (one-time)
- 1,000 users = **$1.50** (one-time)
- 10,000 users = **$15** (one-time)
- 100,000 users = **$150** (one-time)
- **NO recurring costs** (vs $30,000/year for database)

**Privacy Guarantees**:
- ✅ Zero PII stored on-chain (only Poseidon hash)
- ✅ Sybil resistance without revealing identity
- ✅ Same passport/nationality/birthYear = same commitment (duplicate detection)
- ✅ Pre-image resistant (cannot reverse-engineer passport number from hash)
- ✅ Collision resistant (128-bit security, equivalent to SHA-256)

**Implementation**: Identity commitments are handled via UserRootRegistry (Tree 1 roots) and the H4 leaf construction in the Noir circuit.

---

### Layer 4: Universal Account Access

> [!NOTE]
> NEAR Chain Signatures were explored as a cross-chain account abstraction path but are **not in the current implementation**. Phase 1 uses direct Scroll wallet interaction (MetaMask/WalletConnect). This section is preserved as architectural context. See SECURITY.md Section "Phase 1 Reality."

**Problem**: Users come from different chains. Some have ETH wallets, some hold Bitcoin, some use Solana, many have no wallet at all.

**Solution**: NEAR Chain Signatures provides optional account abstraction while protocol settles on Scroll (Ethereum L2).

**User Paths**:
- **ETH-native users** → Use MetaMask/WalletConnect directly on Scroll (standard Ethereum UX)
- **New users** → Create implicit NEAR account (FREE, instant), derive Scroll address
- **Bitcoin holders** → NEAR derives both Bitcoin + Scroll addresses from same implicit account
- **Solana users** → NEAR derives both Solana + Scroll addresses from same implicit account
- **Multi-chain users** → One NEAR implicit account controls addresses on ALL ECDSA/Ed25519 chains

**Settlement Layer**: All civic actions, reputation, and rewards settle on Scroll regardless of account type. NEAR Chain Signatures is purely for account management—smart contracts live on Ethereum.

**Performance**:
- Signature generation: ~2-3 seconds
- MPC network: 8+ nodes (threshold signature)
- Security: NEAR staking + Eigenlayer ETH restakers

---

## ZK Privacy Infrastructure

**Browser-native zero-knowledge proof system for privacy-preserving district verification.**

The protocol uses Noir/Barretenberg UltraHonk proofs to verify district membership and engagement reputation without revealing addresses. The production three-tree circuit (31 public inputs) proves user identity, cell-district mapping, and engagement tier in a single proof. Proofs are generated entirely in-browser using WASM (8-15 seconds on mobile), with no cloud infrastructure required. A legacy two-tree verification path (29 public inputs) is maintained for backward compatibility. The two-layer security model combines cryptographic proofs (ZK) with governance-controlled on-chain registry, avoiding "ZK-maximalism" while maintaining strong privacy guarantees.

**Key Features**:
- **Shadow Atlas**: Global Merkle tree registry of electoral districts (IPFS + on-chain roots)
- **Multi-depth circuits**: Depths 18/20/22/24 supported via VerifierRegistry routing
- **Dual-Layer Security**: ZK proof + on-chain district registry prevents both cryptographic and governance attacks
- **Browser-Native**: Zero server-side proving, addresses never leave client
- **Performance**: 2-5s desktop, 8-15s mobile, ~7,328 byte keccak-mode proofs, ~2.2M gas verification
- **Public inputs**: Three-tree circuit: 31 public inputs (production); legacy two-tree circuit: 29 public inputs

**Complete technical specifications:**
- **[specs/CRYPTOGRAPHY-SPEC.md](specs/CRYPTOGRAPHY-SPEC.md)** — **Canonical cryptographic protocol specification** (circuits, Poseidon2, domain separation, nullifier scheme, trusted setup, threat model)
- **[specs/REPUTATION-ARCHITECTURE-SPEC.md](specs/REPUTATION-ARCHITECTURE-SPEC.md)** — Three-tree engagement semantics (tier derivation, Shannon diversity)
- **[specs/SHADOW-ATLAS-SPEC.md](specs/SHADOW-ATLAS-SPEC.md)** — Geographic data acquisition and district registry
- **[specs/TRUST-MODEL-AND-OPERATOR-INTEGRITY.md](specs/TRUST-MODEL-AND-OPERATOR-INTEGRITY.md)** — Operator surface area, walkaway roadmap
- **Archive**: pre-three-tree docs preserved under `docs/archive/` for historical reference only.

### High-Level Overview

The ZK infrastructure consists of two main components:

1. **Shadow Atlas**: A Merkle tree registry of all electoral districts worldwide, stored on IPFS with roots anchored on-chain
2. **District Membership Proof**: A Noir/Barretenberg circuit that proves membership in a district without revealing the user's address

**Architecture Decision**: Instead of proving district→country relationship in a complex two-tier ZK circuit (K=14), we split the verification:
1. **ZK proof**: "I am a member of district X" (K=12, ~15KB verifier, 2-8s mobile proving)
2. **On-chain lookup**: "District X belongs to country Y" (single SLOAD, ~2.1k gas)

**Security**: District→country mappings are PUBLIC information (congressional districts are not secrets), so we use governance + transparency (on-chain registry) instead of cryptography for this layer. This avoids "ZK-maximalism"—forcing everything into cryptographic proofs when simpler solutions exist.

---

## Identity Verification Infrastructure (Phase 1)

**Updated February 2026 (Cycle 15):** FREE identity verification via mDL (mobile driver's license) using the W3C Digital Credentials API. Browser-native, no third-party SDK.

### mDL Verification (Browser-Native)

**Method: mDL via W3C Digital Credentials API (ISO 18013-5)**

Browser-native, no API keys required. $0/user. Supports selective disclosure of identity attributes directly from the mobile driver's license stored on the user's device.

**Flow:**
1. User taps "Verify Identity" in app
2. Browser calls `navigator.identity.get()` with requested attributes
3. Device presents mDL credential with selective disclosure (only requested fields)
4. Address extraction from disclosed attributes
5. District lookup via Shadow Atlas
6. User generates UltraHonk proof (8-15 seconds, K=14 single-tier)
7. Proof verified on-chain via DistrictGate.sol (Scroll L2)
8. Verified status recorded (one mDL = one account)

**Privacy:**
- Full address never stored on servers
- Only district hash revealed in ZK proof
- Selective disclosure: only district-relevant fields requested (no SSN, no photo unless needed)
- Congressional offices see: "Verified constituent in TX-18" (no address)

**Cost:** $0 (browser-native, no intermediary, no API keys)

> **Legacy providers (superseded):** self.xyz and Didit.me were previously used as primary and fallback identity providers. Their code has been removed from the Communique codebase as of Cycle 15. Existing users with `verification_method='self.xyz'` or `verification_method='didit'` retain their verified status. The protocol architecture remains extensible for future identity providers.

### Sybil Resistance

**One Verified Identity = One Account**

Cryptographic binding stored in Scroll on-chain registries (Poseidon hash commitments in UserRootRegistry).

**Attack Vectors & Mitigations:**
- **Stolen IDs:** mDL presentation requires device biometric unlock (Face ID / fingerprint)
- **Fake IDs:** mDL credentials are cryptographically signed by issuing authority (state DMV)
- **Multiple IDs:** Rare across states; rate limits reduce impact
- **Borrowed devices:** Device biometric required for mDL presentation

### Rate Limiting (Per Verified Identity)

Prevents spam even with verified accounts:
- **10 templates sent per day** (prevents message spam)
- **3 templates created per day** (prevents low-quality template flooding)
- **5 reputation updates per day** (prevents gaming through rapid actions)

Enforcement via on-chain nullifier tracking in NullifierRegistry.sol.

**Full implementation**: See `/Users/noot/Documents/voter-protocol/contracts/src/NullifierRegistry.sol`

---

## Content Moderation Architecture (Phase 1)

**Updated October 2025:** 3-layer moderation stack for Section 230 compliance.

### Legal Framework: Section 230 CDA

**What Section 230 PROTECTS platforms from:**
- ✅ Defamation lawsuits for user posts (even if false)
- ✅ Copyright infringement (if DMCA compliant)
- ✅ Most torts from user content (negligence, emotional distress)
- ✅ State-level content laws (federal preemption)

**What Section 230 DOES NOT protect from:**
- ❌ CSAM (child sexual abuse material) - Federal crime, mandatory reporting
- ❌ FOSTA-SESTA violations (sex trafficking)
- ❌ Terrorism content (material support prohibition)
- ❌ Obscenity (federally illegal)
- ❌ Federal criminal law violations

**Our Strategy:** Proactive moderation for illegal content (CSAM, terrorism, threats), reactive for everything else (political speech protected).

### Layer 1: OpenAI Moderation API (FREE Pre-Filter)

**Cost:** $0 (FREE for all OpenAI API users, unlimited requests)

**Model:** text-moderation-007 (GPT-4o multimodal, Oct 2024)
- 95% accuracy across 13 categories
- 47ms average latency
- 40 languages supported
- Multimodal (text + images)

**Result:** 95% of illegal content caught at $0 cost. Only 5% escalate to paid Layer 2.

### Layer 2: Multi-Model Consensus (Gemini + Claude)

**Cost:** $15.49/month for 500 messages (5% escalation rate from 10K messages)

**Consensus Logic:** OpenAI + (Gemini OR Claude) = PASS (2 of 3 providers)

**Latency:** 200-500ms per model (parallel execution)

### Layer 3: Human Review Queue

**Escalation Criteria:** Split decisions (2+ models disagree)
**SLA:** 24-hour review
**Reviewers:** 2+ independent moderators per case
**Volume:** ~2% of all messages (~200 reviews/month for 10K messages)
**Cost:** $50/month ($0.25/review)

### Cost Breakdown (10,000 messages/month)

- **Layer 1 (OpenAI):** $0 (100% of messages, FREE)
- **Layer 2 (Gemini + Claude):** $15.49 (5% of messages = 500 messages)
- **Layer 3 (Human):** $50 (2% of messages = 200 reviews)
- **Total:** $65.49/month

Scales linearly: 1K messages = $6.55/month, 100K messages = $654.90/month

### Section 230 Protection Strategy

1. **Good faith moderation:** 3-layer system demonstrates (Section 230(c)(2))
2. **No editorial control:** Viewpoint-neutral, accuracy-based (not political bias)
3. **User-generated content:** Platform provides infrastructure only
4. **DMCA compliance:** Registered agent, takedown process, repeat infringer policy
5. **Terms of Service:** Explicit prohibition of illegal content

**Phase 1 Limitation:** No challenge markets (would enable crowdsourced fact-checking). Without token economics, fact-checking verifiable claims becomes editorial judgment (loses Section 230 protection).

**Phase 2 Solution:** Challenge markets with economic stakes = user-driven fact-checking, not platform editorial control.

---

## Template Storage System

### PostgreSQL (pgvector/Prisma) - Primary Storage

**Schema**: Templates, template_usage, challenges tables with full-text search, tag filtering, and GIN indexes.

**Query Performance**:
- Full-text search: 10-50ms
- Tag filtering: <10ms (GIN index)
- District lookup: <10ms (B-tree index)
- Sorting by popularity/impact: <5ms (indexed)

**Full schema**: See `/Users/noot/Documents/voter-protocol/backend/schema.sql`

---

### Filecoin Archival (Planned)

**Trigger**: Template challenged OR verified high-impact

**Cost**: ~$0.01/GB on Filecoin

**Use Cases**:
- Challenged templates (permanent audit trail)
- Legislative citations (proof of origin)
- High-impact templates (historical record)

---

## Settlement Layer

### Scroll zkEVM - Stage 1 Decentralization

**Contracts Deployed**:

**Phase 1 Contracts** (10-contract stack, deployed on Scroll Sepolia):
- `DistrictGate.sol` - Proof verification orchestrator (three-tree 31 inputs primary, legacy two-tree 29 inputs)
- `VerifierRegistry.sol` - Depth→HonkVerifier routing, genesis+seal model
- `DistrictRegistry.sol` - District root→country mapping with lifecycle
- `NullifierRegistry.sol` - Action-scoped nullifier tracking, 60s rate limit
- `CampaignRegistry.sol` - Civic campaign coordination and participation
- `UserRootRegistry.sol` - Tree 1 (user identity) Merkle roots
- `CellMapRegistry.sol` - Tree 2 (cell-district SMT) roots
- `EngagementRootRegistry.sol` - Tree 3 (engagement) Merkle roots
- `TimelockGovernance.sol` - Abstract base: 7-day governance transfers
- `GuardianShield.sol` - Abstract base: multi-jurisdiction veto (Phase 2)

**Three-Tree Deployment Note:** The three-tree `DistrictGate.verifyThreeTreeProof()` entry point emits a `ThreeTreeProofVerified` event with the signature `ThreeTreeProofVerified(address indexed signer, address indexed submitter, bytes32 indexed userRoot, bytes32 cellMapRoot, bytes32 engagementRoot, bytes32 nullifier, bytes32 actionDomain, bytes32 authorityLevel, uint8 engagementTier, uint8 verifierDepth)`. A `uint8 actionCategory` field is **planned for a future deployment** to enable trustless category observation from chain events, replacing the server-side `ActionCategoryRegistry` JSON file for diversity score computation. Until then, category resolution remains server-side.

**Phase 2 Contracts** (12-18 months):
- `DebateMarket.sol` - Staked anonymous deliberation (721 lines, 107 tests, **implemented** — deployment pending)
- `VOTERToken.sol` - ERC-20 token for economic incentives
- `ChallengeMarket.sol` - Multi-AI dispute resolution with stakes
- `ImpactRegistry.sol` - Legislative outcome tracking and attestations
- `RetroFundingDistributor.sol` - Retroactive public goods funding
- `OutcomeMarket.sol` - Gnosis CTF integration for legislative predictions
- `SupplyAgent.sol` - Token emission management
- `MarketAgent.sol` - Circuit breakers and volatility response

**Complete contract specifications, deployment strategy, gas costs, and integration points:**
- **[/docs/architecture/smart-contracts.md](/docs/architecture/smart-contracts.md)** - Complete smart contract architecture

**Cost per Action** (Scroll — measured February 2026):
- Proof verification gas: ~2,200,000 (measured on Scroll Sepolia TX `0xc6ef86a3cf2c3d09f52150b5fce81debc9dc3ff29b15b5958ba749f5a1a9da64`)
- L1 data fee dominates: ~$0.008 vs L2 execution ~$0.002
- **Total cost per proof: $0.01-0.03** at current rates
- Scale: 1,000 proofs/day = $10-30/day ($3,650-11,000/year)

**Who Pays Transaction Costs**:
- **Initially**: Protocol treasury may sponsor ZK verification costs
- **Future**: Sponsor pool may subsidize costs for strategic campaigns
- **User Experience**: Zero-fee civic participation removes economic barriers

**Performance**:
- Current TPS: ~500 TPS
- 2025 target: 10,000 TPS
- Finality: ~5 seconds
- Stage 1 decentralization: ✓ (April 2025)

---

## Phase 2 Features (Deferred)

> **⚠️ NOT INCLUDED IN PHASE 1 LAUNCH**
>
> **Timeline**: 12-18 months after Phase 1 launch
>
> **Phase 1 Foundation**: Phase 1 builds the reputation infrastructure and quality signal system that makes Phase 2 features viable. Template creators earn reputation (not tokens) for adoption and impact. This data becomes the attribution layer for Phase 2 retroactive funding.

### Outcome Markets (Political Prediction → Retroactive Funding)

Binary prediction markets on legislative outcomes fund civic infrastructure retroactively. Users stake VOTER tokens on legislative predictions (e.g., "Will H.R. 3337 pass House committee?"). When outcomes resolve, 20% of prize pool goes to retroactive funding for contributors who influenced the outcome—template creators, message senders, and organizers.

**Architecture**: Gnosis Conditional Token Framework + UMA Optimistic Oracle + Custom Attribution

**Key Features**:
- Binary YES/NO markets on legislative outcomes
- Quadratic scaling prevents whale dominance
- Multi-AI consensus for outcome resolution
- Retroactive funding rewards proven impact
- Congressional delivery receipts prevent self-attribution

> **📋 See [Phase 2 Design Document](docs/roadmap/phase-2-design.md#outcome-markets-political-prediction--retroactive-funding) for complete specifications, smart contracts, attribution logic, gaming resistance, and cost analysis.

---

### Debate Market (Continuous Template Contestation)

> **Status:** Design phase. Contract foundation (`DebateMarket.sol`, 721 lines, 107 tests) implemented for one-shot staking; being extended with batch LMSR continuous trading and AI-augmented resolution. Frontend has 9 Svelte 5 components for debate interaction. Spec: [`specs/DEBATE-MARKET-SPEC.md`](specs/DEBATE-MARKET-SPEC.md).

When a template gains traction, anyone can open a **debate market** on it — adversarial quality assurance where arguments (SUPPORT / OPPOSE / AMEND) compete via an LMSR automated market maker with epoch-based batch execution. The market produces a real-time validity signal that surfaces alongside the template's send count.

**Scoring formula:** `weighted_shares = sqrt(stake) × 2^engagement_tier` (anti-plutocratic: a Tier 4 Pillar at $2 moves the price more than a Tier 1 newcomer at $100).

**Market mechanics:** Batch LMSR with commit-reveal epochs. Traders commit `H(trade, nonce)` during an epoch, reveal next epoch, all trades execute as a batch at the same average price. No intra-epoch ordering, no front-running, no MEV.

**Resolution:** Hybrid AI evaluation (40%) + tier-weighted community signal (60%). An M-of-N AI panel scores argument quality (reasoning, accuracy, evidence); the community signal is the existing `sqrt(stake) × 2^tier` formula. Neither AI nor money alone determines the outcome.

**Privacy:** Three-tree ZK proof for every trade (identity private). Relayer submission (wallet address unlinkable). Commit-reveal (trade intent hidden until execution). Phase 2 adds shielded position pool via note commitments. Phase 3 adds flow-encrypted batches via threshold decryption.

**Template card signal:** Users see "847 verified sends" alongside "AMEND 62% · SUPPORT 31% · OPPOSE 7%" — the debate signal changes the calculus for user 848.

**Implementation path:**
- **Phase 1 (now):** Commit-reveal batch LMSR + relayer. Identity private, trade amounts revealed at execution.
- **Phase 2 (weeks):** Shielded position pool. Positions fully private via Noir circuit extension.
- **Phase 3 (months):** Flow-encrypted batches. Only aggregate price changes visible.

> **📋 See [`specs/DEBATE-MARKET-SPEC.md`](specs/DEBATE-MARKET-SPEC.md) for complete specification including LMSR mechanics, AI evaluation panel, privacy architecture, and phased deployment.**

**Key Features**:
- Quadratic scaling: `sqrt(stake_amount)` prevents whale dominance
- Reputation weighting amplifies domain expertise
- Model diversity prevents provider capture
- Auto-resolution >80% consensus; UMA escalation 60-80%; human arbitration <60%
- Cost: $5.15 per challenge (Chainlink Functions + on-chain aggregation)

> **📋 See [Phase 2 Design Document](docs/roadmap/phase-2-design.md#challenge-markets-multi-ai-information-quality-infrastructure) for complete specifications, smart contracts, Chainlink Functions implementation, gaming resistance, and cost analysis.

---

### Template Impact Correlation & Retroactive Funding

**Impact Correlation**: ImpactAgent continuously monitors congressional records, floor speeches, committee reports, and voting patterns to identify when template language appears in legislative activity.

**Retroactive Funding**: Quadratic allocation of retroactive funding pools to contributors (template creators, adopters, validators, organizers) based on verified impact.

**10x Multiplier Trigger**: Verified legislative citation with >80% confidence score

> **📋 See [Phase 2 Design Document](docs/roadmap/phase-2-design.md) for complete impact scoring model, smart contract implementation, allocation logic, and cost analysis.

---

## Engagement Pipeline

> **Status:** IMPLEMENTED — Chain scanner, engagement tree builder, and engagement service are operational in Shadow Atlas. Auto-registration wired in communique submission flow.
>
> **Spec Reference:** [specs/REPUTATION-ARCHITECTURE-SPEC.md](specs/REPUTATION-ARCHITECTURE-SPEC.md) Sections 3, 4, 9

The engagement pipeline derives Tree 3 (engagement) state from on-chain proof verification events. It is fully automated: once a user registers for engagement tracking, their metrics update without operator intervention.

### Data Flow

```
┌──────────────┐     ┌──────────────┐     ┌───────────────────┐     ┌──────────────────┐
│  DistrictGate│     │ Chain Scanner│     │ EngagementTree    │     │ Engagement       │
│  (on-chain)  │────>│ (eth_getLogs)│────>│ Builder           │────>│ Service (Tree 3) │
└──────────────┘     └──────────────┘     └───────────────────┘     └──────────────────┘
      │                    │                       │                         │
      │ ThreeTreeProof     │ NullifierEvent[]      │ EngagementEntry[]       │ Update leaf
      │ Verified (event)   │ (signer, nullifier,   │ (IC, tier, counts)      │ in-place
      │ (primary)          │  actionDomain, block)  │                         │ (UPSERT)
      │                    │                       │                         │
      │ TwoTreeProof       │ Cursor persisted      │ Dedup by nullifier      │ WAL before
      │ Verified (legacy)  │ (JSON file)           │ Group by signer         │ tree mutation
      │                    │                       │ Resolve categories      │
```

### Chain Scanner

Service: `packages/shadow-atlas/src/serving/chain-scanner.ts`

The chain scanner bridges on-chain state to the engagement pipeline. It polls DistrictGate contract events via raw `eth_getLogs` JSON-RPC calls -- no viem or ethers dependency.

**Design properties:**
- **Cursor persistence**: Last processed block stored as a JSON file. Survives restarts without reprocessing.
- **Chunked backfill**: Processes blocks in configurable ranges (default 2000) to avoid RPC timeouts on initial sync.
- **Reorg handling**: Skips `removed: true` log entries, preventing reverted transactions from polluting engagement state.
- **Deduplication**: Tracks `txHash:logIndex` pairs in a bounded set (100K entries, LRU eviction) to prevent double-counting.
- **Lifecycle**: Optional service, enabled only when `CHAIN_RPC_URL` + `DISTRICT_GATE_ADDRESS` environment variables are set. Integrates with the serve command's graceful shutdown (cursor persisted on SIGTERM).

**Threat model:**
- RPC endpoint lies about events: Mitigated by using an L2 with finality guarantees. Chain scanner trusts the RPC provider -- same trust assumption as any indexer. Cross-referencing multiple RPCs is a Phase 2 hardening.
- RPC endpoint goes offline: Scanner retries on next poll interval. No data loss because cursor only advances after successful processing.
- Large reorg: Events with `removed: true` are skipped. Stale engagement metrics self-correct on next successful poll cycle because metrics are recomputed from all non-removed events.

### Engagement Tree Builder

Service: `packages/shadow-atlas/src/engagement-tree-builder.ts`

Stateless transformation: takes `NullifierEvent[]` from the chain scanner and produces `EngagementEntry[]` for the engagement service. Per-signer metrics:

| Metric | Derivation | Privacy |
|--------|------------|---------|
| `actionCount` | Distinct nullifiers per signer (deduped) | Private input in circuit |
| `diversityScore` | Shannon diversity index H, encoded as `floor(H × 1000)`, range [0, 1609] | Private input in circuit |
| `tenureMonths` | `floor((refTime - firstEvent) / 30 days)` | Private input in circuit |
| `tier` | `deriveTier(actionCount, diversityScore, tenureMonths)` via composite score E | Public output (0-4) |

**Category resolution:** Action domains are keccak256 hashes with no structured prefix byte. Categories are resolved via an `ActionCategoryRegistry` -- a server-side JSON map from action domain hash to category (1-5), loaded at startup from `ACTION_CATEGORY_REGISTRY` env var. Without it, `diversityScore` falls to 0 for all signers (safe degradation, not failure).

### Auto-Registration

After proof submission in communique, a fire-and-forget `POST /v1/engagement/register` call registers the user for engagement tracking using their existing `wallet_address` and `identity_commitment` from the User model.

**Properties:**
- **Idempotent**: Handles `400 IDENTITY_ALREADY_REGISTERED` gracefully -- no error surfaced to user.
- **Privacy-safe**: No new information enters or exits the system. Both `wallet_address` and `identity_commitment` are already known to the communique server from the original registration.
- **Fire-and-forget**: Failure does not block proof submission. Registration can be retried on next action.

### Configuration

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `CHAIN_RPC_URL` | For scanner | -- | JSON-RPC endpoint (e.g., `https://sepolia-rpc.scroll.io`) |
| `DISTRICT_GATE_ADDRESS` | For scanner | -- | DistrictGate contract address |
| `CHAIN_START_BLOCK` | No | `0` | Block to begin backfill from |
| `CHAIN_POLL_INTERVAL_MS` | No | `30000` | Polling interval (ms) |
| `ACTION_CATEGORY_REGISTRY` | No | -- | JSON file: `{"0xhash": 1, ...}` |

---

## Graduated Trust Discovery Model

The protocol is present at every level of civic action. Discovery, message crafting, and delivery operate across three trust tiers — from anonymous visitors to fully ZK-verified participants. The GAP between trust levels is itself a coordination signal: when thousands care enough to act anonymously but hundreds go through verification, that ratio tells congressional offices something no petition count ever could.

### Level 1: Unverified (No Authentication)

Available to any visitor. Uses public data sources with negligible compute cost. **The protocol tracks anonymous event counts** — not identities, but the fact that an action occurred against a specific action domain.

```
User Input                    Level 1 Pipeline                       Output
──────────                    ────────────────                       ──────
"I care about               ┌─────────────────┐
 housing policy"  ──────>   │ Subject Line     │
                            │ Generation       │
                            │ (template LLM)   │
                            └────────┬────────┘
                                     │
                            ┌────────v────────┐
                            │ Core Message     │
                            │ Construction     │
                            └────────┬────────┘
                                     │
                  ┌─────────────────┐│┌──────────────────┐
                  │ Anonymous Event ││││ mailto: links    │
                  │ Counter         │←┘│ + decision-maker │
                  │ (server-side,   │  │  contact info    │
                  │  no identity)   │  └──────────────────┘
                  └────────┬────────┘
                           │
                  ┌────────v────────┐
                  │ Coordination    │
                  │ Signal Layer    │
                  │ (aggregate only)│
                  └─────────────────┘
```

**What's tracked**: Action domain hash → anonymous counter. No IP, no session, no fingerprint. The counter increments when a user clicks "send" on a mailto: link. This is not behavioral surveillance — it's the minimum viable signal that civic intention exists.

**Data sources**: Census geocoding API (public), congressional directory (public), state legislature directories (public). All lookups are deterministic and cacheable.

**Privacy**: No account required. No PII stored. Geocoding is ephemeral. Anonymous counters are keyed by action domain (which encodes jurisdiction + template + session), not by user.

**Why track at Level 1**: A platform where free-tier actions are invisible to the protocol cannot distinguish signal from noise. If 10,000 people generate mailto: links for a housing bill but only 200 verify, that 50:1 ratio IS the coordination signal — it tells decision-makers the sentiment is broad, not manufactured. Zero protocol involvement at the free tier discards this information.

### Level 2: Wallet-Bound (Authentication Required)

Unlocked after wallet connection. Actions are linked to a pseudonymous wallet address via signed attestation, but not yet ZK-verified. This tier gates expensive compute (agent inference, personalized messaging) behind authentication.

```
Level 2 Pipeline
─────────────────

┌─────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ Deep Discovery   │────>│ Agent-Crafted    │────>│ Signed Action    │
│ Network          │     │ Messages          │     │ Attestation      │
│ (multi-agent     │     │ (personalized,   │     │ (wallet-bound,   │
│  inference)      │     │  context-aware)   │     │  not yet on-chain│
└─────────────────┘     └──────────────────┘     └────────┬─────────┘
                                                           │
                                                  ┌────────v─────────┐
                                                  │ Engagement       │
                                                  │ Pre-registration │
                                                  │ (identity map)   │
                                                  └──────────────────┘
```

**What's tracked**: Wallet address → action attestation (signed, timestamped). The wallet is pseudonymous — it reveals nothing about the person behind it. Attestations feed the identity map that later enables ZK engagement tracking.

**Cost boundary aligns with compute boundary**: Public data lookups are cheap (Level 1). Agent inference, personalized message crafting, and cross-jurisdiction coalition detection are expensive (Level 2). Authentication gates the expensive operations, not the basic ones.

### Level 3: ZK-Verified (Identity Verification + On-Chain Proof)

Unlocked after identity verification (mDL via Digital Credentials API). This is where the protocol's full privacy infrastructure activates — browser-native proof generation, on-chain verification, nullifier-based Sybil resistance.

```
Level 3 Pipeline
─────────────────

┌─────────────────┐     ┌──────────────────┐     ┌────────────────────┐
│ Deep Discovery   │────>│ Agent-Crafted    │────>│ ZK Proof           │
│ Network          │     │ Messages          │     │ Generation         │
│ (multi-agent     │     │ (personalized,   │     │ (browser WASM)     │
│  inference)      │     │  context-aware)   │     │                    │
└─────────────────┘     └──────────────────┘     └─────────┬──────────┘
                                                            │
┌─────────────────┐     ┌──────────────────┐     ┌─────────v──────────┐
│ Cross-Jurisdiction│<──│ Coalition         │<──│ Shadow Atlas        │
│ Impact Tracking   │   │ Detection         │   │ Registration        │
│ (reputation)      │   │ (shared targets)  │   │ + Engagement Track  │
└─────────────────┘     └──────────────────┘     └────────────────────┘
```

**What's tracked**: On-chain nullifier consumption events → engagement metrics → tier derivation. Full ZK privacy: address never leaves browser, proof generation client-side, nullifier prevents double-action per domain.

**Privacy boundary**: Level 1 reveals nothing beyond what a user types into a text box. Level 2 links actions to a pseudonymous wallet (no real-world identity). Level 3 operates under full ZK privacy guarantees — proof generation in browser, address never transmitted, nullifier-based Sybil resistance.

### The Coordination Signal

The graduated trust model produces a signal that no single tier can generate alone:

```
                    Level 1          Level 2          Level 3
                    (Unverified)     (Wallet-Bound)   (ZK-Verified)
                    ─────────────    ──────────────   ─────────────
Housing Bill HR-42  12,847 clicks    1,203 attested   847 proofs
Climate Act S-15    3,201 clicks     892 attested     601 proofs
Education HB-7      45,000 clicks   127 attested      23 proofs
```

Congressional offices receiving these signals can distinguish:
- **Broad organic sentiment** (HR-42): High ratio across all levels. Real people, graduating through trust.
- **Deep conviction** (S-15): Moderate volume but high conversion to ZK-verified. Committed constituency.
- **Astroturf signature** (HB-7): Massive Level 1 volume with near-zero conversion. Anonymous clicks are cheap; maintaining verified identities for months is not.

The ratio `Level3 / Level1` is the **coordination authenticity index** — a metric that improves with every user who graduates through the trust levels. This is what makes the graduated model strictly superior to a binary authenticated/unauthenticated split.

---

## Complete Civic Action Flow

### Browser-Native ZK Proving & Encrypted Delivery

**Client-Side Architecture:**
- Zero-knowledge proofs generated entirely in browser (WASM, no cloud dependency)
- Backend server whitelisted by House/Senate CWC APIs (static IP for Congressional access)
- E2E encryption: browser → encrypted transit → CWC decryption
- Congressional office public keys retrieved from CWC API (not stored platform-side)

**Security Advantages:**
- Zero cloud proving infrastructure ($0/month browser-native, no server costs)
- Address never leaves browser (true client-side privacy, not just encrypted)
- No trusted execution environments required (browser sandbox + on-chain verification)
- Cypherpunk-aligned (peer-reviewed mathematics, zero cloud proving dependency)

**Complete flow diagram**: See [`specs/CRYPTOGRAPHY-SPEC.md`](specs/CRYPTOGRAPHY-SPEC.md) §5 (circuits) and §8 (on-chain integration).

---

## Browser-Native Congressional Delivery

### Client-Side Encryption & Privacy Model

All zero-knowledge proof generation and message encryption happens entirely in the browser using WASM and Web Crypto API. User addresses never leave their devices—Shadow Atlas Merkle trees are downloaded from IPFS and cached in IndexedDB, witness generation occurs in Web Workers, and Noir/Barretenberg proving runs in browser WASM with no server dependency.

Browser-native proving eliminates cloud infrastructure costs ($0/month vs $150/month for server-side TEEs) while providing stronger privacy guarantees. Addresses literally cannot be uploaded because the proving code runs locally with no network access during witness generation.

Congressional message delivery requires backend servers because CWC APIs whitelist static IP addresses—browsers cannot connect directly. AWS Nitro Enclaves provide the whitelisted static IP while maintaining E2E encryption through architectural enforcement. Backend cannot decrypt—only the isolated Nitro Enclave can.

### Static IP Configuration & Congressional Whitelist

Congressional CWC APIs require whitelisted IP addresses for spam prevention and security compliance. Browsers cannot submit directly—Senate and House IT departments maintain strict IP whitelists for organizations authorized to use their constituent communication APIs.

Communiqué backend servers are deployed with static Elastic IP addresses in us-east-1 and us-west-2 for redundancy. Congressional IT receives whitelist requests with organization details, static IP addresses, and technical justification emphasizing cryptographic privacy protections (ZK proofs, E2E encryption, open-source verification).

### Browser-Native ZK Proof Generation

> **See also**: [`specs/CRYPTOGRAPHY-SPEC.md`](specs/CRYPTOGRAPHY-SPEC.md) for the canonical ZK specification (circuit topology, Poseidon2, domain separation, nullifier scheme, trusted setup, threat model).

**Complete implementation code for:**
- Shadow Atlas loading from IPFS
- Web Worker witness generation
- WASM Noir/Barretenberg proving
- Client-side proof generation flow

See [`specs/CRYPTOGRAPHY-SPEC.md`](specs/CRYPTOGRAPHY-SPEC.md) §12 (reference implementation, entry points).

> [!WARNING]
> **Phase 1 Status:** Nitro Enclave infrastructure is NOT yet deployed. Phase 1 uses standard encrypted storage with operational key management. The architecture described below is the Phase 2 target. See SECURITY.md for the current privacy posture.

### AWS Nitro Enclaves Processing

**AWS Dependency Boundary:**
- **On-chain identity** (NO AWS): UltraHonk proofs generated 100% in browser, addresses never leave device
- **Message delivery** (AWS Nitro REQUIRED): E2E encryption maintained, moderation inside isolated enclave

**Plaintext Message Content Visible Only In:**
- ✅ **Browser** (user's device, user controls during composition)
- ✅ **AWS Nitro Enclave** (isolated compute, platform operators cannot access)
- ✅ **Congressional CWC API** (receives from enclave for delivery to congressional CRM)
- ✅ **Congressional CRM** (final destination per existing congressional infrastructure)

**Plaintext Message Content NEVER Visible To:**
- ❌ Communiqué backend (receives only encrypted blobs, architecturally cannot decrypt)
- ❌ Network transit (XChaCha20-Poly1305 AEAD + TLS 1.3)
- ❌ Load balancers, logs, database, blockchain, IPFS/CDN

**Privacy Guarantee:** Address never leaves browser (ZK proof only). Message content never accessible to platform operators (architectural enforcement via Nitro). We literally cannot decrypt—only the isolated enclave can.

---

## Complete User Flow

### Onboarding (4 minutes total)

1. **Account creation** (30 seconds)
   - OAuth login or existing Web3 wallet
   - Optional: NEAR implicit account (FREE, instant)

2. **Identity verification** (30 seconds - 3 minutes)
   - mDL presentation via Digital Credentials API (30-60 seconds, browser-native)

3. **ZK proof generation** (One-time, 8-15 seconds)
   - Browser downloads Shadow Atlas from IPFS (cached)
   - Generate district membership proof
   - Verify proof on-chain via DistrictGate.sol

4. **Ready to participate** (Instant)
   - Browse templates
   - Send messages to congressional offices
   - Earn reputation for impact

### Taking Civic Action (3-8 seconds)

1. **Template selection** (Browse and search)
2. **Personal story addition** (Optional)
3. **ZK proof generation** (2-8 seconds, browser-native)
4. **Congressional delivery** (Encrypted via Nitro Enclave)
5. **On-chain recording** (Proof + receipt hashes)
6. **Reputation update** (Multi-agent consensus)

### Reward Distribution (Instant)

**Phase 1**: Reputation points (ERC-8004 attestations)
**Phase 2**: VOTER tokens + reputation multipliers

---

## Privacy Guarantees & Attack Surface

### What's Private

- ✅ **Home address**: Never leaves browser, never stored anywhere
- ✅ **Message content**: Encrypted browser → Nitro Enclave → CWC
- ✅ **Identity details**: Only Poseidon hash stored on-chain
- ✅ **District membership**: Proven via ZK, specific address not revealed
- ✅ **Template adoption**: Congressional offices know district, not specific constituent

### What's Public

- ✅ **District hash**: Visible on-chain (reveals congressional district, not address)
- ✅ **Action count**: Number of actions per district (aggregate)
- ✅ **Reputation score**: On-chain credibility via ERC-8004
- ✅ **Template impact**: Adoption rates and legislative correlation

### Attack Vectors & Mitigations

**Sybil Attacks**:
- ✅ On-chain identity commitments (one passport = one account)
- ✅ Liveness detection prevents stolen/borrowed documents
- ✅ Rate limiting prevents spam

**Address Deanonymization**:
- ✅ Browser-native proving (address never transmitted)
- ✅ District-level granularity only (no exact location)
- ✅ Homomorphic properties of Poseidon hashing

**Congressional Office Tracking**:
- ✅ Offices receive district membership only (not address)
- ✅ E2E encryption prevents platform surveillance
- ✅ Nitro Enclave architectural enforcement

**Platform Compromise**:
- ✅ Backend cannot decrypt messages (Nitro Enclave only)
- ✅ Database breach reveals encrypted blobs (useless without keys)
- ✅ Legal compulsion: we literally cannot decrypt to comply

---

## Implementation Roadmap

### Month 1: NEAR Core (Optional)

- [ ] NEAR implicit accounts (optional cross-chain abstraction)
- [ ] Chain Signatures integration (multi-chain control)
- [ ] Derived address generation (Bitcoin, Ethereum, Solana)

### Month 2: ZK Infrastructure

- [ ] Shadow Atlas compiler (district trees, 12 levels each)
- [ ] Noir/Barretenberg circuit (depths 18/20/22/24, UltraHonk keccak mode)
- [ ] KZG parameters via Aztec Ignition ceremony (BN254 SRS, no custom trusted setup)
- [ ] Browser WASM prover (2-8 seconds mobile proving)
- [ ] Client-side proof generation library

### Month 3: Multi-Chain Settlement

- [ ] Deploy contracts to Scroll testnet
- [ ] DistrictGate.sol deployment (two-step verification)
- [ ] DistrictRegistry.sol deployment (multi-sig governed mapping)
- [ ] HonkVerifier deployment (depths 18/20/22/24 via VerifierRegistry)
- [ ] NullifierRegistry.sol deployment (action-scoped nullifiers, 60s rate limit)
- [ ] UserRootRegistry.sol + CellMapRegistry.sol + EngagementRootRegistry.sol
- [ ] CampaignRegistry.sol (civic campaign coordination)
- [ ] VerifierRegistry.sol (genesis+seal, depth routing)

### Month 4: Information Quality Infrastructure

- [ ] 3-layer moderation stack (OpenAI + Gemini/Claude + human review)
- [ ] PostgreSQL schema (template storage + encrypted PII)
- [ ] AWS Nitro Enclaves integration (E2E encryption + moderation)
- [ ] Congressional CWC API delivery (from enclave whitelisted IP)

### Month 5: Treasury & Funding Infrastructure — ALL PHASE 2 ONLY

> **⚠️ DEFERRED TO PHASE 2** (12-18 months post-launch)

See [Phase 2 Design Document](docs/roadmap/phase-2-design.md#implementation-roadmap) for:
- Outcome Markets (Gnosis CTF + UMA)
- Retroactive Funding (RetroFundingDistributor.sol)
- Challenge Markets (Chainlink Functions + OpenRouter)
- Template Impact Correlation (ChromaDB + GPT-5)

### Month 6: Frontend & UX

- [ ] Template browser & search (PostgreSQL full-text)
- [ ] Reputation dashboard (ERC-8004 attestations)
- [ ] mDL via Digital Credentials API integration (FREE browser-native verification)
- [ ] Noir/Barretenberg WASM proof generation UI (2-8s mobile)
- [ ] Congressional district lookup (Shadow Atlas)
- [ ] Message encryption UI (XChaCha20-Poly1305)

### Month 7: Security & Audit

- [ ] Smart contract audit (DistrictGate, VerifierRegistry, NullifierRegistry, root registries)
- [ ] Noir circuit audit (three-tree 31 inputs primary, legacy two-tree 29 inputs, HonkVerifier)
- [ ] Browser WASM security review (Subresource Integrity, COOP/COEP headers, KZG parameters integrity)
- [ ] Content moderation audit (3-layer stack compliance)
- [ ] AWS Nitro Enclave security review (attestation verification, enclave code audit)

---

## Cost Breakdown

### Per User (One-Time)

**Identity Verification**:
- mDL via Digital Credentials API: $0 (browser-native, no API keys)
- **User acquisition: $0/user**

**Noir/Barretenberg Proof Generation:**
- Browser-side proving: $0 (client-side computation)
- On-chain verification: $0.01-0.03 (Scroll L2 gas, ~2.2M gas)
- Nullifier storage: included in verification TX
- **Total: $0.01-0.03/user one-time**

### Per Civic Action

**UltraHonk Proof Verification** (measured on Scroll Sepolia, February 2026):
- Proof verification: ~2,200,000 gas (measured TX `0xc6ef86a3...`)
- L1 data fee: ~$0.008 (dominates total cost)
- L2 execution fee: ~$0.002
- **Total: $0.01-0.03/action** at current rates

**Congressional Delivery**:
- CWC API: $0 (federal government API)
- Nitro Enclave processing: Included in infrastructure
- Action registry update: < $0.01

### Per Information Quality Operation — ALL PHASE 2

> **⚠️ DEFERRED TO PHASE 2** (12-18 months post-launch)

See [Phase 2 Design Document](docs/roadmap/phase-2-design.md#cost-analysis) for:
- Challenge Market costs ($5.15/challenge)
- Template Impact Tracking ($2.25/template)
- Outcome Market creation ($0.20)
- Retroactive Funding rounds ($71/quarter)

### Annual Infrastructure (100K Users)

**Phase 1 Infrastructure**:
- AWS Nitro Enclaves: $36,600/year (E2E encryption + moderation)
- Scroll L2 batch logging: $5,400/year (hourly merkle roots)
- PostgreSQL (pgvector/Prisma): $300/year
- Shadow Atlas IPFS pinning: $60/year
- Domain + SSL: $240/year
- Monitoring: $600/year
- **Total Phase 1: ~$43,200/year**

**Phase 2 Additions** (deferred):
- Chainlink Functions DON: $2,000/year
- OpenRouter 20-model consensus: $5,000/year
- UMA dispute bonds: $50,000 (locked)
- ChromaDB vector database: $1,200/year
- GPT-5 impact correlation: $10,000/year
- Filecoin archival: $500/year
- **Total Phase 2 Infrastructure: ~$68,700/year additional**

### Development Costs

**Phase 1 Development (3 months): $300,000**
- 2 senior Solidity developers: $120,000
- 1 ZK cryptography specialist: $45,000
- 1 backend developer: $50,000
- 1 frontend developer: $45,000
- Smart contract audit: $30,000
- Browser WASM security review: $10,000

**Phase 2 Development (12-18 months): $175,000 additional**
- Chainlink Functions integration: $30,000
- UMA/Gnosis integration: $40,000
- Economic security modeling: $25,000
- Additional security audits: $80,000

**Total Combined: $475,000**

---

## Agent System Architecture

> **PHASED DEPLOYMENT**
>
> **Phase 1 Agents (Launching in 3 months)**:
> - **VerificationAgent**: Validates civic actions, UltraHonk proofs, identity verification
> - **ReputationAgent**: Multi-dimensional credibility scoring (reputation-only, no tokens)
> - **ImpactAgent**: Tracks template adoption and legislative correlation (reputation rewards)
>
> **Phase 2 Agents (12-18 months)**:
> - **SupplyAgent**: Token emission management (requires VOTER token)
> - **MarketAgent**: Circuit breakers and volatility response (requires liquid token markets)

### Overview

Five specialized agents optimize protocol parameters within cryptographically-enforced bounds. Architecture prevents Terra/Luna-style death spirals through bounded optimization while maintaining adaptability.

**Phase 1 Reality**: Only VerificationAgent, ReputationAgent, and ImpactAgent deploy initially. They manage reputation scoring, content quality, and impact tracking without token economics. SupplyAgent and MarketAgent activate in Phase 2 when VOTER token launches.

**Key Design Principles**:
1. **Deterministic where possible** - LangGraph state machines, not raw LLM inference
2. **Bounded always** - Smart contract floors/ceilings enforced on-chain
3. **Verifiable decisions** - On-chain proofs of agent computation
4. **Upgradeability with timelock** - DAO governance for agent logic updates
5. **Multi-model consensus** - Architecturally diverse models prevent single-point manipulation

### Technical Stack

**Agent Orchestration**: [LangGraph](https://langchain-ai.github.io/langgraph/) (production-grade)
**Model Diversity**: Ensemble methods with architecturally diverse providers
**Oracle Infrastructure**: Multi-source consensus (Chainlink, RedStone, Uniswap V3 TWAPs)
**ERC-8004 Integration**: Three-registry system (Identity, Reputation, Validation)

### Agent Architecture

#### VerificationAgent — PHASE 1 INCLUDED

**Purpose**: Validate civic actions before consensus

**Validation Checks**:
1. ZK proof validity (UltraHonk district membership)
2. Identity verification status (mDL via Digital Credentials API; legacy: self.xyz/Didit.me)
3. CWC delivery receipt confirmation
4. Duplicate detection
5. Content moderation (3-layer stack)

**Multi-Model Consensus**: 3 models must agree (2-of-3 threshold)

#### ReputationAgent — PHASE 1 INCLUDED

**Purpose**: Multi-dimensional credibility scoring

**Reputation Dimensions**:
1. Challenge accuracy (Phase 2)
2. Template quality (adoption + outcomes)
3. Civic consistency (regular participation)
4. Domain expertise (segmented by topic)

**ERC-8004 Integration**: On-chain reputation registry

#### ImpactAgent — PHASE 1 INCLUDED

**Purpose**: Track which templates change legislative outcomes

**Verification Method**:
- Template sent to Rep X on date D
- Rep X introduces/co-sponsors related bill within 30 days
- Confidence score based on: topic similarity, timing correlation, language overlap

**10x Multiplier Trigger**: Verified outcome with >80% confidence

#### SupplyAgent & MarketAgent — PHASE 2 ONLY

> **⚠️ NOT INCLUDED IN PHASE 1**: Requires VOTER token launch and liquid markets.

See [Phase 2 Design Document](docs/roadmap/phase-2-design.md#multi-agent-treasury-management) for:
- SupplyAgent (token emission management)
- MarketAgent (circuit breakers + volatility response)
- LangGraph workflows
- Bounded constraints
- Trust model & governance

### Agent Consensus Mechanism

**Weighted Voting** (Phase 2):
```python
consensus_weights = {
    "SupplyAgent": 0.30,
    "MarketAgent": 0.30,
    "ImpactAgent": 0.20,
    "ReputationAgent": 0.20
}
```

**Deadlock Resolution**:
1. Agents have 60 seconds to submit decisions
2. If <3 agents respond → Use last consensus state
3. If agents disagree by >50% → Escalate to DAO vote
4. Default: Protocol continues with frozen parameters until resolved

### Production Deployment

**Infrastructure**:
- LangGraph Cloud for agent orchestration
- AWS Lambda or ECS for stateless agent execution
- PostgreSQL for agent state persistence

**Cost Estimates**:
- LangGraph Cloud: ~$500/month (10K decisions/day)
- LLM API calls: ~$2000/month (ensemble of 3-5 models)
- Infrastructure: ~$500/month
- **Total**: ~$3000/month agent operations

---

## Phase 1 Infrastructure Costs

> **THIS IS THE REAL PHASE 1 BUDGET**
>
> Phase 1 launches with $3,600/month recurring costs + $300K one-time development. AWS Nitro Enclaves enable true E2E encryption with moderation capability. No NEAR, no challenge markets, no outcome markets, no token infrastructure.

### Monthly Recurring Costs ($3,600/month)

**E2E Encryption Infrastructure (AWS Nitro Enclaves)**:
- AWS Nitro Enclaves (2× t3.medium): $3,050/month
  - Isolated compute for message decryption + moderation
  - Architectural enforcement: platform operators cannot decrypt
  - 24/7 availability for congressional delivery
- Scroll L2 Batch Logging: $450/month
  - Hourly merkle root of delivery receipts
  - 99% cost reduction from batch aggregation

**Infrastructure**:
- PostgreSQL (pgvector/Prisma): $25/month
- Browser-Native ZK Proving: $0/month
- Shadow Atlas IPFS Pinning: $5/month
- Domain + SSL: $20/month
- Monitoring: $50/month

**Total Recurring**: $3,600/month = **$43,200/year**

### Per-User Costs (Marginal)

**Identity Verification**: $0/user (mDL via Digital Credentials API, browser-native)
**Proof Generation**: $0.01-0.03/user one-time
**Civic Actions**: $0.01-0.03/action
**Reputation Updates**: < $0.01/update

### Annual Costs at Scale

**At 1,000 users**: ~$43,920 = **~$43.92/user/year**
**At 10,000 users**: ~$68,700 = **~$6.87/user/year**
**At 100,000 users**: ~$301,400 = **~$3.01/user/year**

**Cost Per User Decreases With Scale:**
- 1,000 users: $43.92/user/year
- 10,000 users: $6.87/user/year (84% reduction)
- 100,000 users: $3.01/user/year (93% reduction)

### One-Time Development Costs ($300K)

**Engineering (3 months)**:
- 2 senior Solidity developers: $120,000
- 1 ZK cryptography specialist: $45,000
- 1 backend developer: $50,000
- 1 frontend developer: $45,000

**Security & Audits**:
- Smart contract audit: $30,000
- Browser WASM security review: $10,000

**Total Development**: **$300,000**

### Why Phase 1 Costs Are Higher (But Honest)

**AWS Nitro Enclaves ($3,050/month)**: True E2E encryption with moderation capability. Platform operators literally cannot decrypt messages—architectural enforcement, not policy promises.

**Batch On-Chain Logging ($450/month)**: Hourly merkle roots save 99% on gas costs. Without batching, Scroll gas would be ~$45,000/month.

**What We Saved:**
- No NEAR CipherVault: $11,000/year eliminated
- FREE identity verification: mDL via Digital Credentials API (browser-native, no third-party partnerships needed)
- Browser-native proving: $0/month vs $150/month TEE
- No token infrastructure: Phase 2 deferred
- No challenge markets: $57,000/year deferred
- No outcome markets: $40,000 integration deferred

**Fundable Budget**: $43,200/year recurring + $300K one-time = $343K total Year 1 cost. Seed-fundable or angel-backed.

---

## Critical Integration Points

**Phase 1 Integration Points** (launching in 3 months):
1. **UltraHonk + keccak mode (Browser-Native WASM)** → Zero-knowledge district verification
2. **mDL via W3C Digital Credentials API** → FREE browser-native identity verification (ISO 18013-5)
3. **AWS Nitro Enclaves** → E2E encryption with moderation
4. **PostgreSQL (pgvector/Prisma)** → Template storage, encrypted PII
5. **Scroll L2** → zkEVM settlement ($0.01-0.03/proof, ~2.2M gas)
6. **Congressional CWC API** → Federal delivery from Nitro Enclave

**Phase 2 Integration Points** (12-18 months):
1. **Gnosis CTF** → Outcome markets
2. **UMA Optimistic Oracle** → Dispute resolution
3. **Chainlink Functions DON** → Multi-model AI consensus
4. **Filecoin** → Permanent audit trail
5. **NEAR Chain Signatures** → Optional cross-chain expansion

---

## Documentation Status

### October 2025: Production Architecture

**Current Status**: K=14 single-tier circuit + on-chain registry is production-ready.

**Key Design Insight**:
- District→country mappings are PUBLIC data (congressional districts are not secrets)
- Use governance + transparency (on-chain registry) instead of all-cryptographic proofs
- Avoids "ZK-maximalism"—forcing everything into ZK when simpler solutions exist

**Production Architecture**:
- Single-tier Merkle circuit (12 district levels, K=14, 20KB verifier, 8-15s proving)
- On-chain DistrictRegistry.sol for district→country mapping
- Two-step verification: ZK proof (cryptographic) + registry lookup (governance)

### January 2026: Phase 1 Architecture Alignment

**Major Update**: Aligned entire ARCHITECTURE.md with Phase 1 reality (3-month launch, $3,600/month budget, reputation-only). Preserved Phase 2 vision (12-18 months, token economics) with clear labeling throughout.

**Changes Made**:
- Executive summary updated with Phase 1/2/3 timeline
- Phase Architecture Overview section added
- Privacy layer revised to Noir/Barretenberg + on-chain registry
- New sections: Identity Verification, Content Moderation, Phase 1 Infrastructure Costs
- Phase 2 features clearly labeled throughout
- Implementation roadmap separated by phase
- Cost breakdown revised with accurate Phase 1 numbers

**Result**: ARCHITECTURE.md now accurately reflects Phase 1 launch plan while preserving complete Phase 2 vision.

### February 2026: Engagement Pipeline + Discovery Model

**Changes Made**:
- Added Engagement Pipeline section: chain scanner, engagement tree builder, auto-registration, configuration
- Replaced Two-Tier Discovery Model with Graduated Trust Discovery Model: three trust levels (unverified → wallet-bound → ZK-verified) where the protocol is present at every level. Anonymous event counters at Level 1, signed attestations at Level 2, full ZK proofs at Level 3. The ratio between levels produces the coordination authenticity index.
- Added three-tree deployment note with actual event signature; actionCategory marked as planned future addition
- Updated cross-references to REPUTATION-ARCHITECTURE-SPEC.md

### February 2026: Staked Debates Documentation

**Changes Made**:
- Added Staked Debates section under Phase 2 Features with implementation status: `DebateMarket.sol` (721 lines, 107 tests), Communiqué frontend (9 components, 6 API routes, off-chain state store), debate-scoped action domains via `buildDebateActionDomain()`
- Updated Phase 2 contract list to include `DebateMarket.sol` with implementation status
- Distinguished staked debates (structured deliberation, implemented) from challenge markets (multi-AI fact-checking, design phase)
- Cross-referenced `specs/DEBATE-MARKET-SPEC.md` and Communiqué `docs/features/debates.md`
- Documented known gaps: browse-view discovery, co-sign UI, auto-resolution, settlement wiring, event indexer

---

### Costs & Gas (Canonical — February 2026)

- Proof verification gas: ~2,200,000 (measured on Scroll Sepolia TX `0xc6ef86a3...`)
- L1 data fee dominates: ~$0.008 vs L2 execution ~$0.002
- Total cost per proof: $0.01-0.03 at current rates
- Scale: 1,000 proofs/day = $10-30/day ($3,650-11,000/year)

---

*This is a living document. Update as architecture evolves.*

**Last Updated**: February 2026
**Status**: Production architecture reference — three-tree (31 inputs) is the canonical verification path
**Next Review**: After mainnet deployment
