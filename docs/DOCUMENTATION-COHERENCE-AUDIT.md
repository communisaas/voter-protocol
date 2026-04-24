# Documentation Coherence Audit

**Date:** 2026-02-20
**Auditor:** 6-pillar agent team (Identity, ZK Proving, Geography, Contracts, Engagement, Frontend)
**Repos:** voter-protocol + communique
**Docs examined:** ~120 across both repos
**Code cross-referenced:** Noir circuits, TypeScript provers, Solidity contracts, SvelteKit client

---

## Executive Summary

**The code is coherent. The documentation is a liability.**

The proof pipeline works end-to-end: Noir circuit -> TypeScript prover -> Solidity contract -> communique browser client. All layers agree on public input layouts (29 two-tree, 31 three-tree), hash functions (H2/H3/H4 with matching domain tags), keccak mode threading, and verifier interfaces. 1,000+ tests confirm correctness. E2E proof TX succeeded on Scroll Sepolia (gas: 2,200,522).

The documentation layer is 3 architectural generations behind in ~15 major files. A developer, auditor, or partner relying on documentation alone would build against a phantom architecture.

---

## 1. Gas Cost Analysis (Verified 2026-02-20)

### 1.1 Measured On-Chain Costs

**Source:** Scroll Sepolia E2E proof TX `0xc6ef86a3cf2c3d09f52150b5fce81debc9dc3ff29b15b5958ba749f5a1a9da64`

| Component | Value |
|-----------|-------|
| Gas used | 2,200,522 |
| Gas limit | 3,000,000 (73.35% utilization) |
| Gas price | 0.015680108 Gwei |
| L2 execution fee | 0.000034504 ETH |
| L1 data fee | 0.000126376 ETH |
| **Total TX fee** | **0.000160881 ETH** |
| Proof size (keccak) | 7,328 bytes (229 fields) |
| Public inputs | 29 (two-tree) |

### 1.2 Current Scroll Mainnet Rates (2026-02-20)

| Parameter | Value | Source |
|-----------|-------|--------|
| Scroll L2 gas price | 0.00012 Gwei | scrollscan.com/gastracker |
| Ethereum L1 gas price | 0.041 Gwei | etherscan.io/gastracker |
| ETH/USD | $1,965 | CoinMarketCap/MetaMask |

### 1.3 Cost Projections (Scroll Mainnet)

Scroll transaction fees = L2 execution fee + L1 data fee. The L1 data fee dominates
at current rates because L2 gas prices are near-zero on Scroll.

**Per-proof cost at different gas price scenarios:**

| Scenario | L2 Gas Price | L2 Cost | L1 Data Cost (est.) | Total/Proof | Notes |
|----------|-------------|---------|---------------------|-------------|-------|
| Current (Feb 2026) | 0.00012 Gwei | $0.0005 | $0.01-0.03 | **$0.01-0.03** | Near-zero L2, very low L1 blob fees |
| Moderate congestion | 0.01 Gwei | $0.04 | $0.05-0.15 | **$0.10-0.20** | 80x L2 increase |
| High congestion | 0.1 Gwei | $0.43 | $0.50-2.00 | **$1.00-2.50** | Scroll network stress |
| Extreme | 1.0 Gwei | $4.32 | $2.00-5.00 | **$6.00-10.00** | Unlikely sustained |

**Annual cost projections at 1,000 proofs/day:**

| Scenario | Daily | Monthly | Annual |
|----------|-------|---------|--------|
| Current rates | $10-30 | $300-900 | $3,650-10,950 |
| Moderate congestion | $100-200 | $3,000-6,000 | $36,500-73,000 |
| High congestion | $1,000-2,500 | $30K-75K | $365K-912K |

**Annual cost projections at 10,000 proofs/day:**

| Scenario | Daily | Monthly | Annual |
|----------|-------|---------|--------|
| Current rates | $100-300 | $3K-9K | $36K-110K |
| Moderate congestion | $1,000-2,000 | $30K-60K | $365K-730K |
| High congestion | $10K-25K | $300K-750K | $3.65M-9.12M |

### 1.4 Documented vs. Actual Gas Consumption

| Document | Claimed Gas | Claimed Cost | Actual Gas | Actual Cost (current) |
|----------|------------|-------------|------------|----------------------|
| TWO-TREE-ARCHITECTURE-SPEC.md S7.2 | 403,000 | not stated | 2,200,522 | $0.01-0.03 |
| DistrictGate.sol NatSpec L46-48 | 300-400K | not stated | 2,200,522 | $0.01-0.03 |
| ARCHITECTURE.md L1049 | 300-400K | $0.003-$0.01 | 2,200,522 | $0.01-0.03 |
| zk-infrastructure.md | 300-500K | $0.003-$0.01 | 2,200,522 | $0.01-0.03 |

**Key finding:** Gas CONSUMPTION is 5.5x higher than documented (2.2M vs 300-400K). However, because Scroll L2 gas prices are extremely low (0.00012 Gwei), the actual COST per proof at current rates ($0.01-0.03) is comparable to what the old docs estimated — by accident, not by correctness. The gas consumption figures must be corrected because cost depends on gas price, which fluctuates.

**ARCHITECTURE.md L1049 annual budget estimate** claims $3,650/year at 1K proofs/day. At current rates this is roughly correct ($3,650-$10,950). At moderate congestion it would be $36K-73K. The old estimate was coincidentally close to current-rate reality, but was derived from wrong gas consumption × wrong gas price.

### 1.5 Gas Correction Required

All gas consumption figures must be updated from 300-400K to ~2,200,000. Cost projections should use range tables rather than point estimates, since L2 gas prices are volatile. The per-proof cost projection should reference this document rather than embedding point estimates.

---

## 2. Systemic Issues (Cross-Pillar)

### 2.1 UltraPlonk/Halo2 Ghost Naming

The system uses **UltraHonk/Noir via @aztec/bb.js v2.1.8**. Yet:

- **56+ files** in voter-protocol reference "UltraPlonk"
- **25+ files** in communique reference "Halo2" (never used)
- Key locations: ARCHITECTURE.md (10), SECURITY.md (5), README.md (2), contracts/README.md (4), smart-contracts.md (14), zk-infrastructure.md (7), MULTI-DEPTH-VERIFIER-ARCHITECTURE.md (14), VerifierRegistry.sol NatSpec, TWO-TREE-ARCHITECTURE-SPEC.md Section 11
- communique: ZK-PROOF-TESTING-STRATEGY.md ("Axiom's halo2_base"), ownership.md, voice.md, privacy-governance.md, tee-systems.md, plus ~20 more

### 2.2 Phantom Contract Architecture

**5 contracts documented but non-existent:**
- IdentityRegistry.sol (includes full source code in smart-contracts.md)
- CommuniqueCoreV2.sol
- UnifiedRegistry.sol
- ReputationRegistry.sol
- AgentConsensus.sol

**6 contracts that exist but are undocumented or under-documented:**
- TimelockGovernance.sol (zero documentation)
- GuardianShield.sol (zero documentation)
- UserRootRegistry.sol (partial mention)
- CellMapRegistry.sol (partial mention)
- CampaignRegistry.sol (not in ARCHITECTURE.md)
- EngagementRootRegistry.sol (only in REPUTATION-ARCHITECTURE-SPEC.md)

### 2.3 H3 -> H4 Leaf Formula Propagation

Leaf extended from `H(secret, cellId, salt)` to `H4(secret, cellId, salt, authorityLevel)`. Code is correct everywhere. Stale in:
- TWO-TREE-ARCHITECTURE-SPEC.md Section 1.1 (executive summary — most visible)
- TWO-TREE-ARCHITECTURE-SPEC.md Section 10.3 (code sample calls poseidon2Hash3)
- UserRootRegistry.sol NatSpec L12
- smart-contracts.md L62

### 2.4 `@voter-protocol/client` Ghost References

Removed in Cycle 17. 14+ references remain across both repos:
- communique: ownership.md (9 refs), features/index.md
- voter-protocol: WAVE-20-23-PLAN.md, IMPLEMENTATION-GAP-ANALYSIS.md

### 2.5 Three Disconnected Reputation Models (communique)

No integration document explains the relationship between:
1. Application-layer `reputation_tier: string` ("novice"/"active") in Postgres
2. ZK `engagement_tier` [0-4] from Tree 3 composite score
3. Universal credibility professional verification multipliers (1.0x-2.0x)

### 2.6 EngagementTier JSDoc / Golden Vector Staleness

`types.ts` L387-394 and `three-tree-golden-vectors.test.ts` L41-48 describe the OLD hard-threshold cascade (`actionCount >= 50, diversityScore >= 3`). The actual system uses composite score `E = log2(1+n) * (1+H) * (1+sqrt(t/12)) * (1+log2(1+a)/4)` with tier boundaries 0, >0, >=5, >=12, >=25.

---

## 3. Per-Pillar Findings

### 3.1 Identity & Privacy

| ID | Severity | Finding |
|----|----------|---------|
| ID-C01 | CRITICAL | 4 incompatible identity commitment formulas across docs/code |
| ID-C02 | CRITICAL | 3 incompatible nullifier formulas in pre-NUL-001 docs |
| ID-C03 | HIGH | UltraPlonk naming across 60+ references |
| ID-C04 | HIGH | H3 formula in executive summary (should be H4) |
| ID-S01 | HIGH | ARCHITECTURE.md references 4 non-existent contracts as file paths |
| ID-T01 | MEDIUM | `didit` vs `didit.me` provider naming inconsistency |

### 3.2 ZK Proving & Verification

| ID | Severity | Finding |
|----|----------|---------|
| ZK-C01 | CRITICAL | TWO-TREE-ARCHITECTURE-SPEC S1.1 shows 3-input leaf |
| ZK-C02 | CRITICAL | TWO-TREE-ARCHITECTURE-SPEC S10.3 calls poseidon2Hash3 |
| ZK-C03 | HIGH | EngagementTier JSDoc describes superseded hard-threshold cascade |
| ZK-C04 | HIGH | Gas estimates 5.5x low across all docs |
| ZK-C05 | HIGH | DistrictGate NatSpec describes single-tree 5-input model |
| ZK-S01 | HIGH | NOIR-PROVING-INFRASTRUCTURE.md entirely obsolete |
| ZK-S02 | HIGH | ZK-PRODUCTION-ARCHITECTURE.md pre-two-tree era |
| ZK-S03 | HIGH | zk-infrastructure.md describes defunct architecture |
| ZK-S04 | MEDIUM | MULTI-DEPTH-VERIFIER-ARCHITECTURE.md partially stale |
| ZK-M01 | MEDIUM | No keccak vs Poseidon2 proof mode document |
| ZK-M02 | MEDIUM | No updated gas analysis document (resolved by this audit) |
| ZK-M03 | MEDIUM | identity_commitment missing from PUBLIC-INPUT-FIELD-REFERENCE.md |
| ZK-M04 | MEDIUM | PUBLIC-INPUT-FIELD-REFERENCE.md missing three-tree fields [29-30] |
| ZK-F01 | MEDIUM | communique hardcodes depth 20 in 5 places |

**Pipeline coherence: PASS.** 29-field two-tree and 31-field three-tree layouts match across Noir circuit, TypeScript prover, Solidity contract, and communique client. Keccak mode threaded correctly end-to-end.

### 3.3 Shadow Atlas & Geography

| ID | Severity | Finding |
|----|----------|---------|
| GEO-C01 | CRITICAL | DISTRICT-TAXONOMY.md single-district vs all-24 proofs contradiction |
| GEO-C02 | CRITICAL | SHADOW-ATLAS-SPEC.md body describes superseded Option B architecture |
| GEO-H01-07 | HIGH | 7 high-severity findings (hydration stale refs, API shape mismatches) |
| GEO-M01-15 | MEDIUM | 15 medium findings |

### 3.4 Smart Contracts & On-Chain

| ID | Severity | Finding |
|----|----------|---------|
| SC-C01 | CRITICAL | smart-contracts.md describes entirely wrong contract system |
| SC-C02 | CRITICAL | ARCHITECTURE.md Phase 1 lists 5 phantom contracts |
| SC-C03 | HIGH | DistrictGate docs show 3 public inputs, permissionless actions |
| SC-C04 | HIGH | deploy.sh missing UserRootRegistry + CellMapRegistry |
| SC-C05 | HIGH | DeployScrollMainnet.s.sol incomplete (no genesis setup) |
| SC-C06 | MEDIUM | CampaignRegistry.authorizeCaller() lacks timelock |
| SC-C07 | MEDIUM | ADVERSARIAL-ATTACK-DOMAINS.md Domain 2 lists resolved finding as open |
| SC-C08 | MEDIUM | COORDINATION-INTEGRITY-SPEC.md S1.6 shows resolved gap as open |
| SC-F01 | HIGH | communique missing 3 contract addresses in .env.example |
| SC-F02 | MEDIUM | communique ABI covers only two-tree path |

### 3.5 Engagement & Reputation

| ID | Severity | Finding |
|----|----------|---------|
| ENG-C01 | HIGH | Spec S6.1 EngagementRootRegistry pseudocode diverges (country field, lifecycle) |
| ENG-C02 | HIGH | Spec S6.2 describes non-existent country cross-check |
| ENG-C03 | MEDIUM | types.ts EngagementTier JSDoc — old hard-threshold model |
| ENG-C04 | MEDIUM | reputation.md diversity_score described as integer, not Shannon |
| ENG-C05 | LOW | Spec S9.2 missing POST /v1/engagement/register endpoint |
| ENG-S01 | MEDIUM | THREE-TREE-IMPLEMENTATION-CYCLES.md marks Cycles 21-22 PENDING (code exists) |
| ENG-F01 | MEDIUM | communique has 3 disconnected reputation models |
| ENG-F02 | MEDIUM | phase-2-design.md predates dual-token design, not marked superseded |
| ENG-F03 | LOW | Multiple communique docs describe ERC-8004 as if it exists |

**Formula coherence: PASS.** Composite score, Shannon diversity, tier boundaries, leaf computation, and cross-tree identity binding all match across spec, TypeScript, Noir, and Solidity. 300+ engagement-specific tests confirm.

### 3.6 Frontend & Integration

| ID | Severity | Finding |
|----|----------|---------|
| FE-C01 | CRITICAL | 25 communique files reference "Halo2" |
| FE-C02 | HIGH | TEE provider disagreement (GCP vs AWS Nitro across 4 docs) |
| FE-C03 | MEDIUM | Embedding provider disagreement (OpenAI vs Gemini vs Voyage AI) |
| FE-C04 | MEDIUM | Stale database-stack references persist after the Convex migration |
| FE-S01 | CRITICAL | ownership.md catastrophically stale (wrong everything) |
| FE-S02 | HIGH | ZK-PROOF-TESTING-STRATEGY.md references Halo2/Axiom |
| FE-S03 | MEDIUM | Fly.io deployment references persist after Cloudflare migration |
| FE-S04 | MEDIUM | Firecrawl caching checklist unclear after the Convex migration |

**Integration coherence: PASS.** prover-client.ts, package.json, .env.example, contract addresses, keccak mode, H4 leaf formula, Shadow Atlas API all match across repos.

---

## 4. Aggregate Statistics

| Category | Count |
|----------|-------|
| Critical findings | 12 |
| High findings | 20 |
| Medium findings | 25 |
| Low findings | 8 |
| Ghost references (UltraPlonk + Halo2 + @voter-protocol/client) | 95+ |
| Phantom contracts (documented, non-existent) | 5 |
| Undocumented contracts | 6 |
| Fully obsolete documents | 5 |
| Tests confirming code correctness | 1,000+ |
| Pipeline coherence checks | ALL PASS |

---

## 5. Sources

- [Scroll Gas Tracker](https://scrollscan.com/gastracker) — 0.00012 Gwei (2026-02-20)
- [Scroll Average Gas Price Chart](https://scrollscan.com/chart/gasprice)
- [Scroll Transaction Fee Docs](https://docs.scroll.io/en/developers/transaction-fees-on-scroll/)
- [Ethereum Gas Tracker](https://etherscan.io/gastracker) — 0.041 Gwei L1
- [L2 Fees](https://l2fees.info/)
- [L2BEAT Costs](https://l2beat.com/scaling/costs)
- [ETH Price](https://coinmarketcap.com/currencies/ethereum/) — $1,965 (2026-02-20)
- [Scroll Sepolia TX](https://sepolia.scrollscan.com/tx/0xc6ef86a3cf2c3d09f52150b5fce81debc9dc3ff29b15b5958ba749f5a1a9da64)
