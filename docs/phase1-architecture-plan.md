# Phase 1 Architecture Plan: Privacy Infrastructure & Content Moderation

**Date:** October 20, 2025
**Status:** Approved for Implementation
**Budget:** $326/month for 1,000 users / 10,000 messages

---

## Core Architectural Decisions

### 1. GKR Protocol for District Verification (No Groth16)

**Decision:** Ship GKR from day one. No parallel Groth16 implementation.

**Rationale:**
- Vitalik published GKR analysis October 19, 2025
- Polyhedra Expander claims production-ready implementation (2M+ Poseidon hashes/sec)
- Shadow Atlas Merkle tree verification is GKR's theoretically optimal use case (layered circuits)
- **No trusted setup ceremony** (eliminates permanent security liability)
- Congressional offices see identical data regardless of proving system

**Risks Accepted:**
- Cutting-edge tech (not battle-tested at VOTER scale)
- Verification gas unknown (must benchmark on Scroll before launch)
- Fiat-Shamir transformation overhead unknown
- If benchmarks fail: delays launch, must pivot to Groth16

**Critical Benchmarks:**
- Proving time: <10s commodity hardware (UX threshold)
- Verification gas: <250k on Scroll L2 (economic viability)
- Proof size: <10KB (network transmission acceptable)

**Contingency:**
If GKR verification gas >250k OR proving time >15s:
1. Pivot to Groth16 (delays launch 2-3 months for trusted setup ceremony)
2. Accept permanent ceremony security liability
3. Total timeline: 3mo GKR attempt + 3mo Groth16 = 6mo vs shipping Groth16 immediately (3-4mo)

**Why Worth Risk:**
- Trusted setup ceremonies are permanent attack vectors (ceremony compromise = eternal forgery risk)
- Can measure GKR risks before launch (benchmark, pivot if needed)
- Can't un-do trusted setup—if we ship Groth16, we inherit liability forever
- Congressional signal unaffected (proving system is internal detail)

---

## 2. Multi-Layer Content Moderation (Section 230 Compliance)

### Layer 1: OpenAI Moderation API (FREE Pre-Filter)

**Specifications:**
- Model: text-moderation-007 (GPT-4o multimodal)
- Cost: $0 (FREE for all OpenAI API users)
- Latency: 47ms average
- Accuracy: 95% across 13 harmful content categories
- Languages: 40 languages
- Capabilities: Text + images

**Logic:**
- Every message passes through OpenAI first
- If flagged → auto-reject ($0 cost)
- If passes → proceed to Layer 2

### Layer 2: Multi-Agent Consensus (Paid, Only if Layer 1 Passes)

**Models:**
1. Gemini 2.5 Flash-Lite (Google): $0.10 input / $0.40 output per 1M tokens
2. Claude Haiku 4.5 (Anthropic): $1.00 input / $5.00 output per 1M tokens

**Consensus Logic:**
- OpenAI + (Gemini OR Claude) agree safe → pass (2 of 3 providers)
- OpenAI passes BUT Gemini AND Claude both flag → human review

**Cost (10,000 messages/month):**
- Layer 1 (OpenAI): $0 (filters ~5% at zero cost)
- Layer 2 (Gemini + Claude): $15.49 (only ~9,500 messages)
- Human review: ~$50 (estimated 2% escalation rate)
- **Total: $65.49/month**

### Layer 3: Human Review Queue

**Escalation Criteria:**
- Split decisions (OpenAI passes, both Layer 2 models flag)
- User appeals
- Low-confidence flags from any model

**SLA:** 24-hour review

**Categories:**
- CSAM: Immediate block + NCMEC report (federal law)
- Terrorism: Immediate block + law enforcement coordination
- Threats: Context-dependent (credible/specific → block)
- Spam: Rate limiting + reputation penalties (not removal)

---

## 3. Section 230 Compliance Strategy

### What Section 230 DOES Protect:
- Defamation claims from user messages
- Copyright infringement in templates
- Offensive but protected political speech
- Factual errors in policy arguments
- "Controversial" positions

### What Section 230 Does NOT Protect:
- CSAM (18 USC §2258A - must report to NCMEC)
- Sex trafficking (FOSTA-SESTA)
- Terrorism coordination (18 USC §2339A)
- Direct credible threats
- Other federal crimes

**Our Position:**
Cypherpunk values mean privacy for civic discourse, not hosting illegal content. CSAM scanning isn't censorship—it's federal law. Terrorism filtering isn't political—it's survival.

**Immunity Strengthening:**
- Proactive moderation (multi-layer defense)
- Audit trail (3 AI models vote, human review recorded)
- Documented policies and training
- Incident response procedures for law enforcement

---

## 4. Identity Verification (FREE Tiers Only)

**Primary: self.xyz**
- NFC passport scan via smartphone
- Cost: $0 (FREE)
- Speed: ~30 seconds
- Privacy: Passport data never leaves device

**Fallback: Didit.me**
- For users without NFC passports
- Core KYC tier: FREE (no document verification premium)
- Privacy: Encrypted on-chain via NEAR CipherVault

**PII Storage:**
- NEAR CipherVault (encrypted on-chain)
- Data: Address + district + verification proof (~2kb per user)
- Cost: ~$0.0004 per user (negligible)
- Privacy: User-controlled decryption keys

**Per-User Onboarding Cost:**
- Identity verification: $0 (FREE tiers)
- NEAR storage: $0.0004
- Scroll L2 registration: $0.01
- **Total: ~$0.0104 per user**

---

## 5. End-to-End Encryption (Required)

**Implementation:**
- GCP Confidential Space (AMD SEV-SNP TEE)
- Client-side: XChaCha20-Poly1305 encryption (libsodium)
- TEE: Decryption inside hardware-attested enclave
- Delivery: Plaintext from TEE → CWC API → congressional CRM

**Cost:**
- $150/month fixed (cannot avoid for E2E encryption)

**Privacy Guarantee:**
- Plaintext exists only in: user's browser, TEE enclave, congressional office
- Platform operators never see message content
- Google cloud admins prevented by AMD SEV-SNP hardware guarantees

**Tension Acknowledged:**
Using Google infrastructure contradicts pure sovereignty. AMD SEV-SNP hardware prevents Google from reading plaintext (architectural difference vs "Google promises not to look"). Self-hosted TEEs researched for Phase 2.

---

## 6. On-Chain Reputation (ERC-8004)

**Phase 1:**
- Public reputation scores (required for congressional filtering)
- Domain-specific (healthcare, climate, education, etc.)
- Time-weighted decay (inactivity → reputation decays)
- Scroll L2 settlement (low-cost transactions)

**What Phase 1 Does NOT Include:**
- Token rewards (no VOTER token)
- Challenge market accuracy bonuses
- Impact multipliers for legislative correlation

**Privacy Limitation Accepted:**
- Reputation scores public (employers/doxxers can see on-chain activity)
- Mitigation: Users advised to use fresh wallets for VOTER
- Phase 2: Privacy pools hide transaction amounts, improve anonymity

---

## Phase 1 Budget Breakdown

### Monthly Costs (1,000 users / 10,000 messages)

**Fixed:**
- GCP Confidential Space (TEE): $150
- Database/hosting: $0 (free tiers: Supabase, Vercel)

**Variable:**
- User onboarding: 1,000 × $0.0104 = $10.40
- Content moderation: $65.49
  - OpenAI: $0
  - Gemini + Claude: $15.49
  - Human review: $50
- Scroll L2 transactions: 10,000 × $0.01 = $100

**Total: $325.89/month (~$326/month)**
- Per user: $0.326/month
- Per message: $0.0326

### Scaling Costs

**10,000 users / 100,000 messages:**
- Fixed: $150
- Users: 10,000 × $0.0104 = $104
- Moderation: ~$605 (OpenAI still FREE, Layer 2 scales linearly)
- Transactions: 100,000 × $0.01 = $1,000
- **Total: ~$1,859/month**

**100,000 users / 1M messages:**
- Fixed: $150
- Users: 100,000 × $0.0104 = $1,040
- Moderation: ~$6,000
- Transactions: 1M × $0.01 = $10,000
- **Total: ~$17,190/month**

---

## What Does NOT Launch Phase 1

### Token Economics (Phase 2)
- ❌ VOTER token launch
- ❌ Reward distribution for civic actions
- ❌ Staking mechanisms
- ❌ Token treasury

### Challenge Markets (Phase 2)
- ❌ Fact-checking with economic stakes
- ❌ Quadratic staking
- ❌ Multi-model AI adjudication (beyond moderation)
- ❌ Reputation bonuses for accuracy

### Outcome Markets (Phase 2)
- ❌ Prediction markets on legislative outcomes
- ❌ Retroactive funding mechanisms
- ❌ Stake pools and payouts

### Multi-Agent Treasury (Phase 2)
- ❌ SupplyAgent (reward rate adjustment)
- ❌ MarketAgent (volatility monitoring)
- ❌ ImpactAgent (legislative correlation tracking)
- ❌ ReputationAgent (credibility scoring automation)
- ❌ VerificationAgent automation (Phase 1: manual verification)

**Why Phase 2:**
- Need to prove platform value WITHOUT financial incentives first
- Regulatory clarity evolving (CLARITY Act framework, implementation details developing)
- Economic mechanisms require real usage data for tuning
- Privacy pools (financial privacy) prerequisite for token launch

---

## Privacy Architecture Evolution

### Phase 1 (Launching)

**What's Private:**
- ✅ Address never revealed (GKR proofs prove district membership only)
- ✅ Message content E2E encrypted (TEE → congressional office only)
- ✅ Identity data encrypted on-chain (NEAR CipherVault)

**What's Public:**
- ⚠️ Wallet addresses on Scroll L2 (transaction graph public)
- ⚠️ Reputation scores (required for congressional filtering)
- ⚠️ District membership ("Wallet X verified for TX-18")
- ⚠️ Participation timestamps

**Risks Accepted:**
- Employers/doxxers can correlate on-chain activity with leaked identity
- Reputation + district + timestamps = narrowing anonymity set
- Transaction graph analysis possible

**Mitigation:**
- User advice: Fresh wallets for VOTER
- Phase 2: Privacy pools improve anonymity

### Phase 2 (12-18 months): Privacy Pools

**Implementation:**
- Vitalik Buterin's privacy pools (2023 paper, launched Ethereum 2025)
- Association sets by congressional district
- Shielded transaction amounts (zk-SNARKs)
- Proof of clean funds origin (regulatory compliance)

**Improvements:**
- ✅ Transaction amounts hidden
- ✅ Larger anonymity sets (all district members in pool)
- ✅ Can't calculate individual holdings
- ✅ Proof of "not a mixer for criminals"

**What Stays Public:**
- District association membership (required for "N constituents in TX-18" counts)
- Reputation scores (staffers filter for expertise)
- Action timestamps (temporal clustering)

**Congressional Signal Degradation: ~5%**
- Lose: Individual wallet reputation evolution tracking
- Keep: District counts, expertise scores, impact correlation

### Phase 3+ (Speculative): Nested ZK Proofs

**Only If:**
- Community demands stronger privacy than privacy pools
- Congressional offices accept reputation range proofs vs exact scores
- Computational overhead practical (<2s proving time)

**Architecture:**
- Outer proof: District credential (one-time)
- Inner proof: Actions unlinkable between uses
- Reputation: Range proofs ("expertise >5000" not exact)

**Congressional Signal Degradation: ~30%**
- Lose: Exact reputation scores, individual impact tracking
- Keep: District counts, domain expertise ranges

**Research Dependencies:**
- GKR recursive proofs (Vitalik mentioned use case)
- Nova folding schemes
- Halo 2 accumulation

**Verdict:** Monitor research. Privacy pools solve 95% of privacy concerns without degrading signal.

---

## Congressional Signal: What Staffers See

**Regardless of Proving System (GKR vs Groth16):**

**District Verification:**
- "Verified TX-18 constituent" (cryptographic proof passed)

**Message Content:**
- Full plaintext message (delivered via TEE → CWC)
- Personal story
- Policy arguments
- Contact info if provided

**Metadata:**
- Reputation score: "Healthcare expertise: 8,500"
- Impact history: "Previous templates correlated with 3 bills" (Phase 2)
- Challenge results: "Survived 2 accuracy challenges" (Phase 2)
- Timestamp: When message sent

**What They DON'T See:**
- User's address (zero-knowledge proof)
- Wallet address (on-chain, but not in congressional dashboard)
- Transaction history (blockchain data, not surfaced to staffers)

**Key Insight:**
Proving system (GKR vs Groth16) is internal implementation detail. Staffers see identical verification status and message content. Privacy pools (Phase 2) also preserve this signal—they only affect financial privacy, not message delivery.

---

## GKR Implementation Timeline

### Month 1: Circuit Design & Proving Benchmarks

**Weeks 1-2:**
- Implement GKR circuit for Shadow Atlas Merkle proofs
- Use Polyhedra Expander library
- Test with 100M address tree (realistic global scale)

**Weeks 3-4:**
- Benchmark proving time on commodity hardware
- Target: <10s (UX threshold)
- Measure: Poseidon hashes/sec, layer computation overhead

**Milestone 1 Decision:**
- If proving <10s → Continue to Month 2
- If proving >15s → STOP, pivot to Groth16
- If proving 10-15s → Optimize 2 weeks, re-evaluate

### Month 2: Fiat-Shamir & Gas Benchmarks (CRITICAL)

**Weeks 5-6:**
- Implement Fiat-Shamir transformation (non-interactive)
- Replace verifier randomness with keccak256(transcript)
- Test malicious proofs, transcript manipulation

**Weeks 7-8:**
- Deploy verifier contract to Scroll L2 testnet
- Measure verification gas (100M address tree depth)
- Target: <250k gas (economic viability)

**Milestone 2 Decision (CRITICAL):**
- If gas <200k → SHIP GKR (excellent)
- If gas 200-250k → Acceptable (tight but viable)
- If gas >250k → PIVOT to Groth16 immediately

### Month 3: Integration & Security Audit

**Weeks 9-10:**
- Integrate GKR prover into frontend (WASM)
- Shadow Atlas quarterly update simulation
- 10,000 proof end-to-end test

**Week 11:**
- External security audit (circuit, Fiat-Shamir, verifier contract)
- Focus: Zero-knowledge property, proof malleability, gas griefing

**Week 12:**
- Mainnet deployment (Scroll L2)
- Shadow Atlas root publication (100M+ addresses)
- Monitoring dashboard (proving times, gas, failures)

**Launch Readiness:**
- All benchmarks passed (proving <10s, gas <250k)
- Security audit clean
- Integration tests 100% pass
- **LAUNCH Phase 1 with GKR**

---

## Groth16 Pivot Contingency

**If GKR Fails Milestone 2 (gas >250k):**

### Immediate Actions (Week 8):
1. Freeze GKR development
2. Activate Groth16 circuit development
3. Begin trusted setup ceremony recruitment

### Trusted Setup Ceremony (2-3 months):
- Recruit 50+ independent participants
- Geographic distribution (US, EU, Asia, South America)
- Multi-round ceremony (6 rounds, increasing participants)
- Final round: 10 participants, all destroy toxic waste

### Ceremony Verification:
- IPFS-hosted transcript (permanent public record)
- Each participant signs attestation
- Community verification (anyone can re-run, verify transcript)
- **Accept:** If ALL final round participants collude, can forge proofs (permanent risk)

### Launch with Groth16:
- 2-3 month delay vs GKR timeline
- Permanent trusted setup security liability
- Total: 3mo GKR + 3mo Groth16 = 6mo vs shipping Groth16 immediately (3-4mo)

**Decision Criteria:**
- GKR gas >250k = economically non-viable ($0.10+ per verification)
- Groth16 ~150k gas proven
- Ceremony liability preferable to economic failure

---

## Success Metrics

### Technical:
- Proving time: <10s commodity hardware
- Verification gas: <250k Scroll L2
- Proof size: <10KB
- Security audit: Zero critical/high findings

### Product:
- UX: "Verifying district..." spinner <10s
- Congressional dashboard: "Verified TX-18 constituent" displays correctly
- Shadow Atlas updates: Quarterly root rotations seamless
- Failure rate: <0.1% proof generation failures

### Economic:
- Verification cost: ~$0.01 per proof
- No trusted setup ceremony cost (GKR eliminates)
- Shadow Atlas maintenance: Quarterly updates (minimal)

### Legal:
- Section 230 compliance: Proactive moderation documented
- CSAM detection: PhotoDNA + OpenAI catching violations
- Terrorism filtering: Keyword + context analysis working
- Incident response: Law enforcement coordination procedures tested

---

## The Bet

**We're betting:**
1. GKR verification gas <250k on Scroll L2 (economically viable)
2. Polyhedra Expander production-ready (not just research code)
3. 3 months sufficient for circuit, benchmark, audit, integration

**If we're wrong:**
- Pivot to Groth16 (delays 2-3 months, adds ceremony liability)
- Total timeline: 6mo vs shipping Groth16 immediately (3-4mo)
- Cost: 2-3 month delay, but we know definitively if GKR works

**If we're right:**
- Launch with no trusted setup (permanent security win)
- Theoretically optimal proving system (Merkle trees)
- Eliminate ceremony coordination overhead forever
- Set technical bar for democratic cryptographic infrastructure

**Measure risks before launch. Benchmark verification gas + proving time. If fails critical metrics: pivot to Groth16, accept ceremony liability. If passes: ship correct architecture, not familiar one.**

---

## Files to Update (Implementation Checklist)

### Documentation:
- [ ] TECHNICAL.md - Complete restructure (GKR section, Section 230, privacy, costs, Phase 2 token economics moved)
- [ ] README.md - Update blockchain developer + cypherpunk entries, "Why Now" section
- [ ] docs/research/privacy-architecture-analysis.md - GKR Phase 1 decision documented
- [ ] docs/gkr-implementation-plan.md - New file (3-month timeline, benchmarks, contingency)

### Implementation:
- [ ] GKR circuit design (Shadow Atlas Merkle proofs)
- [ ] Fiat-Shamir transformation (non-interactive)
- [ ] Verifier smart contract (Scroll L2 deployment)
- [ ] Frontend prover integration (WASM compilation)
- [ ] OpenAI Moderation API integration (Layer 1)
- [ ] Gemini + Claude consensus (Layer 2)
- [ ] Human review queue infrastructure
- [ ] NEAR CipherVault PII storage
- [ ] self.xyz + Didit.me identity verification
- [ ] GCP Confidential Space TEE setup
- [ ] Congressional dashboard (verification status display)

---

**Status:** Approved October 20, 2025
**Next Steps:** Begin GKR circuit implementation (Month 1, Weeks 1-2)
**Review Date:** Milestone 1 (4 weeks), Milestone 2 (8 weeks - CRITICAL)
