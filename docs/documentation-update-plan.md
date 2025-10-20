# Documentation Update Plan: Phase 1 Architecture Alignment

**Date:** October 20, 2025
**Context:** Following GKR protocol decision and Phase 1 architecture finalization
**Objective:** Align all documentation with Phase 1 reality (GKR from day one, reputation-only, $326/month budget)

-----

## Completed Updates

### ✅ Phase 1 - Core Architecture Documents

1. **TECHNICAL.md** - COMPLETED
   - Added Phase Architecture Overview (Phase 1/2/3 roadmap)
   - Replaced Groth16 with GKR Protocol implementation
   - Added Content Moderation & Section 230 Compliance section
   - Added Phase 1 Infrastructure Costs ($326/month budget breakdown)
   - Moved Economic Mechanisms to Phase 2 section
   - Updated Identity Verification (self.xyz + Didit.me)
   - Updated Performance Specifications for GKR

2. **docs/research/privacy-architecture-analysis.md** - COMPLETED
   - Added prominent October 2025 update section
   - Updated Phase 1 from "Groth16 SNARKs" to "GKR Protocol"
   - Removed GKR from Phase 3 research (now Phase 1 reality)
   - Updated all recommendations and bottom line
   - Documented make-or-break benchmarking criteria

3. **README.md** - COMPLETED
   - Updated Cypherpunk section with GKR mention
   - Updated Blockchain developer section with GKR + Phase architecture
   - Updated Non-technical user section (reputation now, rewards Phase 2)
   - Updated "Why Now" with GKR timing + FREE identity verification
   - Updated "What Changes" with Phase 1/2 distinction

4. **docs/phase1-architecture-plan.md** - COMPLETED (Created)
   - Comprehensive Phase 1 architecture plan
   - Budget breakdown ($326/month)
   - GKR implementation timeline
   - Content moderation architecture
   - Identity verification strategy
   - Groth16 pivot contingency

-----

## Phase 2 - Remaining Core Documents (CRITICAL - Do Now)

### 1. ARCHITECTURE.md (3,539 lines) - HIGHEST PRIORITY

**Current State:**
- References Groth16 throughout (line 15, 498, 557, 3022, 3038, 3253, 3445)
- No Phase 1/2 distinction
- Challenge markets presented as current feature (line 1093, 2213, 2494, 2530)
- Outcome markets presented as current feature
- Missing content moderation architecture
- Missing FREE identity verification details
- Missing Phase 1 budget context

**Required Updates:**

**A. Executive Summary Section (Lines 1-20)**
```markdown
**Settlement**: Scroll zkEVM (Ethereum L2, Stage 1 decentralized)
**Account Abstraction**: NEAR Chain Signatures (optional for simplified UX)
**Identity**: self.xyz NFC passport (FREE, primary) + Didit.me (FREE, fallback)
**Privacy**: GKR Protocol (no trusted setup, Fiat-Shamir transformation)
**Templates**: PostgreSQL (Supabase) → Filecoin archival
**Verification**: Congressional CWC API via GCP Confidential Space TEE
**Moderation**: 3-layer stack (FREE OpenAI + Gemini/Claude + human review)
**Phase**: Phase 1 (reputation-only, 3 months), Phase 2 (token economics, 12-18 months)
```

**B. Add Phase Architecture Section (After Executive Summary)**
- Phase 1: GKR proofs, E2E encryption, reputation, moderation, $326/month budget
- Phase 2: VOTER token, challenge markets, outcome markets, privacy pools
- Phase 3+: Nested ZK (speculative, community-dependent)

**C. Update Privacy Layer Section (Lines ~100-200)**
- Replace all "Groth16" → "GKR Protocol"
- Add Fiat-Shamir transformation explanation
- Document benchmarking gates (<10s proving, <250k gas)
- Add Groth16 contingency plan

**D. Add Content Moderation Architecture Section (NEW)**
Insert after Privacy Layer, document:
- Layer 1: OpenAI Moderation API (FREE, 13 categories, CSAM detection)
- Layer 2: Gemini 2.5 Flash-Lite + Claude Haiku 4.5 consensus
- Layer 3: Human review queue (24-hour SLA)
- Section 230 compliance strategy
- Cost breakdown: $65.49/month for 10K messages

**E. Add Identity Verification Section (NEW or Update Existing)**
Document:
- self.xyz: NFC passport scanning (FREE, 60 seconds, primary method)
- Didit.me: Photo ID + selfie (FREE Core KYC, fallback for non-passport users)
- Sybil resistance: One identity = one verified account
- Rate limits: 10 templates sent/day, 3 created/day, 5 reputation updates/day
- Unverified wallets: Phase 1 zero reputation, Phase 2 50% rewards

**F. Move Economic Mechanisms to "Phase 2 (Future)" Section**
- Challenge Markets (currently line 1093+)
- Outcome Markets
- Multi-Agent Treasury
- Add prominent header: "PHASE 2 - NOT INCLUDED IN INITIAL LAUNCH"

**G. Add Phase 1 Infrastructure Costs Section**
Document:
- Fixed: GCP Confidential Space $150/month
- Variable: Identity verification $10/month, moderation $51/month, blockchain $115/month
- Total: $326/month for 1K users / 10K messages
- Scaling economics at 10K and 100K users
- Revenue options post-congressional adoption

**H. Update All Mermaid Diagrams**
- Add "Phase 1" or "Phase 2" labels to components
- Update Privacy layer to show "GKR Protocol" not "Groth16"
- Add Content Moderation layer
- Add Identity Verification layer

**I. Update Trusted Setup Ceremony Section (Line 3038)**
```markdown
- [x] GKR Protocol eliminates trusted setup (shipped Phase 1)
- [ ] Groth16 contingency: If GKR benchmarks fail (gas >250k or proving >15s)
  - [ ] Coordinate 50+ ceremony participants
  - [ ] IPFS-hosted ceremony transcript
  - [ ] Public documentation of pivot decision
```

**J. Update Performance Specifications**
Replace Groth16 specs with:
- Client-side: 8-10s proving time (GKR + Fiat-Shamir, WASM)
- On-chain: 200-250k gas target (vs Groth16's ~150k gas)
- Proof size: 2-4KB (larger than Groth16's 256 bytes, acceptable)

**K. Search and Replace Operations**
- "Groth16" → "GKR Protocol" (with context-appropriate explanations)
- "ZK-SNARK" → "GKR zero-knowledge proof" (where referring to district proofs)
- "trusted setup" → "no trusted setup (GKR advantage)" or note Groth16 contingency

**Estimated Effort:** 3-4 hours (large file, many interconnected sections)

---

### 2. SECURITY.md (486 lines) - CRITICAL

**Current State:**
- No content moderation coverage
- No Section 230 compliance discussion
- No CSAM reporting protocol
- Missing moderation as security threat vector

**Required Updates:**

**A. Add "Content Moderation as Security Concern" Section**

Document:
- **Threat:** Platform liability for illegal content (CSAM, terrorism, obscenity)
- **Legal Framework:** Section 230 protections and exceptions
- **Attack Vectors:**
  - Malicious users posting CSAM to create liability
  - Coordinated harassment campaigns
  - Political doxxing attempts
  - Content designed to trigger false positives (speech chilling)

**B. Add "Section 230 Compliance Strategy" Section**

Document:
- What Section 230 PROTECTS from (defamation, copyright with DMCA, most torts)
- What Section 230 DOES NOT protect from (CSAM, FOSTA-SESTA, terrorism, obscenity, federal crimes)
- Good faith moderation requirements
- No editorial control policy (viewpoint-neutral)
- User-generated content distinction

**C. Add "Content Moderation Architecture" Section**

Document:
- 3-layer moderation stack architecture
- Layer 1: OpenAI Moderation API (FREE, unlimited, 95% accuracy)
  - 13 categories including CSAM detection
  - Auto-reject illegal content
  - Auto-report CSAM to NCMEC (federal law requirement)
- Layer 2: Multi-model consensus (Gemini + Claude)
  - 2 of 3 providers consensus required
  - Economic cost: $15.49/month for borderline cases
- Layer 3: Human review queue
  - 2+ independent moderators
  - 24-hour SLA
  - Trained on federal law requirements

**D. Add "CSAM Reporting Protocol" Section**

Document:
- OpenAI Moderation API auto-flags sexual/minors category
- Human review BEFORE NCMEC report (prevent false positives on art/medical content)
- Mandatory reporting within 24 hours (federal law)
- CyberTipline submission process
- Permanent ban + content preservation for law enforcement

**E. Add "Moderation Attack Mitigation" Section**

Document threat vectors:
- **Coordinated false flagging:** Rate limits on reports, reputation-weighted reporting
- **Evasion techniques:** Image-based text, encoded messages, steganography
  - Mitigation: OpenAI multimodal detection (text-moderation-007)
- **Appeal abuse:** Limited appeals (3 per 30 days), reputation cost for failed appeals
- **Political speech chilling:** Layer 2 + 3 review for political content, transparency reports

**F. Update Threat Model Matrix**

Add content moderation threats:
- CSAM posting → NCMEC reporting + permanent ban + law enforcement cooperation
- Terrorism content → Material support prohibition, immediate removal, federal reporting
- Harassment campaigns → Rate limiting + reputation penalties
- Doxxing attempts → E2E encryption prevents platform knowledge, but user reports trigger review

**G. Add Cost of Moderation Failure**

Document:
- **Legal liability:** CSAM = federal crime, platform operators personally liable
- **Regulatory scrutiny:** FOSTA-SESTA violations, state AG investigations
- **Reputation damage:** Loss of user trust, congressional office refusal to integrate
- **Operational cost:** Litigation defense ($100K-$1M+), compliance audits

**H. Update Incident Response Plan**

Add moderation incidents:
- CSAM detection → Immediate NCMEC report, law enforcement notification, content preservation
- Terrorism content → Immediate removal, federal reporting, user investigation
- Mass coordinated abuse → Rate limiting activation, pattern analysis, account suspensions

**Estimated Effort:** 2-3 hours

---

### 3. Create docs/content-moderation-architecture.md (NEW - CRITICAL)

**Rationale:** We evolved significant detail on moderation during Phase 1 planning. Deserves dedicated doc.

**Contents:**

**A. Executive Summary**
- 3-layer moderation stack (OpenAI FREE + multi-model + human)
- Section 230 compliance strategy
- $65.49/month cost for 10K messages
- Federal law compliance (CSAM, terrorism, obscenity)

**B. Legal Framework**
- Section 230 CDA: What it protects, what it doesn't
- CSAM reporting requirements (federal law)
- FOSTA-SESTA obligations
- Material support for terrorism prohibition
- State-level content laws (preempted by federal)

**C. Layer 1: OpenAI Moderation API**

Document:
- Model: text-moderation-007 (GPT-4o multimodal, October 2024)
- Cost: $0 (FREE for all OpenAI API users, unlimited)
- Latency: 47ms average
- Accuracy: 95% across 13 categories
- Categories:
  - sexual, sexual/minors (CSAM - CRITICAL)
  - hate, hate/threatening
  - harassment, harassment/threatening
  - self-harm, self-harm/intent, self-harm/instructions
  - violence, violence/graphic
  - illicit, illicit/violent
- Logic flow:
  - Every message passes through Layer 1 FIRST
  - CSAM auto-report to NCMEC + permanent reject
  - Illegal content auto-reject (violence/graphic, illicit/violent, hate/threatening)
  - Borderline cases escalate to Layer 2
- Result: 95% of illegal content caught at $0 cost

**D. Layer 2: Multi-Model Consensus**

Document:
- Models: Gemini 2.5 Flash-Lite ($0.10/$0.40 per 1M tokens) + Claude Haiku 4.5 ($1.00/$5.00 per 1M tokens)
- Volume: 5% of Layer 1 (500 messages/month for 10K messages)
- Cost: $15.49/month
- Consensus logic: OpenAI + (Gemini OR Claude) = PASS (2 of 3 providers)
- Latency: 200-500ms per model (parallel execution)
- Escalation criteria:
  - All 3 flag → Auto-reject
  - OpenAI + one other → Escalate to Layer 3
  - Only OpenAI flagged → Gemini + Claude vote

**E. Layer 3: Human Review Queue**

Document:
- Escalation criteria: Split decisions (OpenAI vs Layer 2 disagreement)
- SLA: 24-hour review
- Reviewers: 2+ independent moderators per escalation
- Volume: 2% of all messages (~200 reviews/month for 10K messages)
- Cost: ~$50/month ($0.25/review)
- Training requirements:
  - Federal law (CSAM reporting, terrorism, obscenity)
  - Section 230 compliance
  - Political speech neutrality
  - Doxxing/harassment identification
- Decision logic: 2+ moderators must agree for rejection

**F. Cost Breakdown**

For 10,000 messages/month:
- Layer 1 (OpenAI): $0 (100% of messages, FREE)
- Layer 2 (Gemini + Claude): $15.49 (5% of messages = 500 messages)
- Layer 3 (Human): $50 (2% of messages = 200 reviews)
- **Total: $65.49/month**

Scaling:
- 1K messages: $6.55/month (10% of 10K cost due to fixed human overhead)
- 10K messages: $65.49/month
- 100K messages: $654.90/month (linear scaling)

**G. Section 230 Protection Strategy**

Document:
- Good faith moderation (3-layer system demonstrates)
- No editorial control (viewpoint-neutral, accuracy-based)
- User-generated content (platform provides infrastructure only)
- DMCA compliance (registered agent, takedown process, repeat infringer policy)
- Terms of Service (explicit prohibition of illegal content)

**H. What We CANNOT Do Under Section 230**

Document:
- ❌ Fact-check political claims without token economics (becomes editorial judgment)
  - Phase 1 limitation: No challenge markets = can't crowdsource fact-checking
  - Phase 2 solution: Challenge markets = user-driven, not platform editorial
- ❌ Remove content based on political viewpoint (loses Section 230 protection)
- ❌ Ignore CSAM reports (federal crime regardless of Section 230)
- ❌ Facilitate terrorism (material support laws apply to platforms)

**I. Known Risks & Mitigations**

Document:
- **Risk 1: False CSAM flags**
  - OpenAI occasionally flags non-CSAM (medical images, art)
  - Mitigation: Human review BEFORE NCMEC report for borderline
  - Liability: Better over-report than under-report (NCMEC handles triage)
- **Risk 2: Political speech chilling**
  - Aggressive hate speech filtering catches heated political debate
  - Mitigation: Layer 2 + 3 review for political content
  - Section 230 protects removal, but user trust requires fairness
- **Risk 3: Moderation inconsistency**
  - AI models update, change behavior over time
  - Mitigation: Version-lock OpenAI model, benchmark quarterly
  - Transparency: Publish moderation stats monthly

**J. Appeal Process**

Document:
- Users can appeal moderation decisions (3 appeals per 30 days)
- Appeals trigger Layer 3 human review (different moderators)
- Failed appeals cost reputation points (prevents abuse)
- Successful appeals restore content + reputation boost
- Appeal transparency: Anonymized decisions published monthly

**K. Phase 2 Enhancement: Challenge Markets for Content Moderation**

Document:
- Users stake tokens on "this was wrongly removed"
- Multi-model consensus re-evaluates with financial stakes
- Correct challenges refund stake + reputation boost
- Incorrect challenges lose stake → funds moderator training
- Economic accountability without sacrificing Section 230 protection

**L. Transparency & Accountability**

Document:
- Monthly moderation reports:
  - Total messages moderated
  - Layer 1/2/3 breakdown
  - Category distribution
  - False positive rate (estimated from appeals)
  - NCMEC reports submitted
- Quarterly model benchmarking:
  - OpenAI model version
  - Gemini/Claude performance comparison
  - Accuracy testing against known datasets
- Annual external audit:
  - Section 230 compliance review
  - Federal law compliance (CSAM, terrorism)
  - Bias testing (political viewpoint neutrality)

**Estimated Effort:** 2-3 hours

---

## Phase 3 - User-Facing Documents (HIGH PRIORITY)

### 4. CONGRESSIONAL.md (384 lines)

**Current State:**
- Likely references challenge markets as current feature
- Likely references token rewards
- May not emphasize Phase 1 reputation-only value

**Required Updates:**

**A. Add Phase 1 Clarity Upfront**

Add early section:
```markdown
## Phase 1: Reputation Signals (Launching 3 Months)

VOTER Protocol launches with reputation-only system. No token. No financial rewards.
This proves civic utility before adding economic layer.

**What Congressional Offices Get in Phase 1:**
- Cryptographically verified constituents (GKR proofs, no PII revealed)
- Domain expertise scores (portable reputation, earned through participation)
- Sybil-resistant verification (FREE passport/ID verification eliminates bots)
- Impact correlation tracking (templates that influenced previous legislation)
- 3-layer content moderation (Section 230 compliant, CSAM detection)

**Phase 2 Additions (12-18 months):**
- Challenge markets (crowdsourced fact-checking with economic stakes)
- Outcome markets (constituent-funded advocacy competing with corporate lobbying)
- VOTER token rewards (financial incentives for quality participation)
```

**B. Update "Quality Signal" Sections**

Replace challenge market references with Phase 1 reputation signals:
- ~~"Challenge market accuracy shows this claim survived 3 disputes"~~
- "Reputation score shows consistent participation across 6 months"
- "Previous templates from this constituent correlated with 3 bill introductions"
- "Domain expertise: Healthcare policy (earned through 24 verified actions)"

**C. Emphasize FREE Identity Verification**

Add section on Sybil resistance:
- self.xyz NFC passport scanning (FREE, 60 seconds)
- Didit.me for non-passport users (FREE Core KYC)
- One verified identity = one account (cryptographically enforced)
- Bot spam eliminated at zero cost to offices

**D. Add Content Moderation Value Proposition**

Document what offices DON'T have to deal with:
- CSAM (auto-detected and reported before offices see)
- Harassment/threats (filtered via 3-layer moderation)
- Bot spam (Sybil-resistant verification)
- Duplicate messages (template adoption tracking shows unique vs copies)

**E. Update Integration Examples**

Show Phase 1 API responses:
```json
{
  "message": {
    "district_verified": true,
    "district": "TX-18",
    "reputation_score": 8500,
    "reputation_domain": "healthcare",
    "verified_method": "self.xyz_passport",
    "previous_impact": [
      "H.R. 3337 (introduced 14 days after template sent)",
      "S. 891 (co-sponsor from district)"
    ],
    "template_adoption": 847,
    "first_sent": "2025-09-15",
    "content_moderation": "passed_all_layers",
    "message_text": "[encrypted, TEE-decrypted for CWC delivery]"
  }
}
```

**F. Address "Why No Token Rewards in Phase 1?"**

Add FAQ section:
- **Q: Why reputation-only?**
  - A: Proves civic utility before adding financial complexity
  - Token launches require CLARITY Act compliance, liquidity infrastructure, economic security
  - Phase 1 builds user base and congressional adoption
  - Phase 2 adds token economics once value demonstrated

**Estimated Effort:** 1-2 hours

---

### 5. QUICKSTART.md (233 lines)

**Current State:**
- Likely promises "instant rewards"
- May reference token features not in Phase 1
- User-facing, needs accurate Phase 1 messaging

**Required Updates:**

**A. Update Opening Promise**

Replace:
```markdown
Face ID → pick template → add your story → send. 4 minutes total.
Zero blockchain knowledge required. Instant rewards.
```

With:
```markdown
Face ID → pick template → add your story → send. 4 minutes total.
Zero blockchain knowledge required. Build reputation, earn credibility.
(Phase 2 adds token rewards.)
```

**B. Add Phase 1 Expectations Section**

Early in doc:
```markdown
## What You Get in Phase 1

**Immediate:**
- Verified constituent status (congressional offices see you're real)
- Portable reputation score (builds across all your civic actions)
- Domain expertise recognition (healthcare, climate, education, etc.)
- Impact tracking (your templates that influenced legislation)
- Privacy protection (employers can't trace your advocacy)

**Phase 2 (12-18 months):**
- VOTER token rewards for quality participation
- Challenge market earnings (stake on verifiable claims)
- Outcome market positions (financially compete with corporate lobbying)
```

**C. Update Step-by-Step Flow**

Replace "Instant reward!" notifications with:
- "Reputation +50 (Healthcare domain)"
- "Verified constituent status earned"
- "Template adopted by 12 other constituents"

**D. Add "Why Reputation Matters" Section**

Document:
- Congressional offices prioritize high-reputation messages
- Portable across all civic platforms (ERC-8004 standard)
- Proves domain expertise (healthcare reputation ≠ climate reputation)
- Time-weighted decay (stop participating → reputation decreases)
- Immune to Sybil attacks (one verified identity = one reputation score)

**E. Update "What Happens Next" Section**

Replace token reward messaging:
```markdown
## What Happens After You Send

**Immediately:**
1. Message encrypted in your browser (XChaCha20-Poly1305)
2. GKR proof generated (proves you're in district, 8 seconds)
3. Proof verified on-chain (Scroll L2, platform pays gas)
4. Reputation updated (+50 points for verified template send)

**Within 24 Hours:**
5. Message delivered to congressional office via TEE (plaintext only in secure enclave)
6. Congressional dashboard shows your verified constituent signal
7. Template adoption tracked (if others use your template)
8. Impact correlation begins (if bill introduced matching your topic)

**Over Time:**
- Reputation grows with consistent participation
- Domain expertise recognized (multiple actions in same policy area)
- Impact history builds (templates correlated with legislation)
- Phase 2 launch converts reputation → token rewards
```

**F. Add "FREE Everything" Emphasis**

Document what costs $0 for users:
- Identity verification (self.xyz passport scan or Didit.me)
- All blockchain transactions (platform pays gas)
- Message encryption and delivery
- Reputation tracking
- Congressional dashboard access (for offices)

**G. Remove/Update Token-Specific Language**

Search for:
- "earn tokens"
- "VOTER rewards"
- "challenge rewards"
- "outcome market payouts"

Replace with Phase 1 equivalents or add "(Phase 2 feature)" labels.

**Estimated Effort:** 1-2 hours

---

### 6. Create docs/gkr-implementation-plan.md (NEW)

**Rationale:** Referenced in phase1-architecture-plan.md but doesn't exist. Needs dedicated technical implementation guide.

**Contents:**

**A. Executive Summary**
- 3-month implementation timeline
- Critical benchmarking gates (Month 1-2)
- Groth16 pivot contingency
- Success criteria: <10s proving, <250k gas, clean security audit

**B. Why GKR Over Groth16**

Document decision rationale:
- **Trusted setup elimination:** Permanent security win (no toxic waste vulnerability)
- **Merkle tree optimization:** Shadow Atlas district proofs are GKR's theoretically optimal use case
- **Congressional signal unchanged:** Offices receive identical data regardless of proving system
- **Cutting-edge risk acceptable:** Benchmarking determines viability before production

**C. Month 1: Circuit Design & Proving Benchmarks**

**Weeks 1-2: Circuit Implementation**
- Polyhedra Expander integration
- Shadow Atlas Merkle tree circuit
- Poseidon hash function (SNARK-friendly)
- Witness generation optimization

**Weeks 3-4: Proving Performance**
- Benchmark on commodity hardware (2020+ laptop, smartphone)
- Target: <10s proving time
- Memory profiling: <500MB peak
- Battery impact: <2% on mobile
- **Milestone 1 Gate:** If proving >15s, PIVOT to Groth16 immediately

**Deliverables:**
- Working GKR circuit (Rust, compiled to WASM)
- Performance benchmarks (CSV data: device, CPU, RAM, proving time)
- Proof size measurements (target 2-4KB)
- Decision document: Continue GKR or pivot to Groth16

**D. Month 2: Fiat-Shamir Transformation & Gas Benchmarks (CRITICAL)**

**Weeks 5-6: Non-Interactive Transformation**
- Implement Fiat-Shamir heuristic (hash-based challenge generation)
- Solidity verifier contract
- Sumcheck protocol verification
- Layer-by-layer polynomial evaluation

**Weeks 7-8: On-Chain Gas Benchmarks**
- Deploy to Scroll L2 testnet
- Measure verification gas costs
- Target: 200-250k gas
- Compare vs Groth16 baseline (~150k gas)
- Optimize hot paths (proof batching, calldata compression)
- **Milestone 2 Gate:** If gas >250k, PIVOT to Groth16 immediately

**Deliverables:**
- Solidity verifier contract
- Gas benchmark data (CSV: proof size, gas used, ETH cost at various gas prices)
- Optimization report (techniques applied, gas savings achieved)
- **CRITICAL DECISION:** Continue GKR or pivot to Groth16

**E. Month 3: Integration & Security Audit**

**Weeks 9-10: Frontend Integration**
- WASM proving module for browsers
- Witness generation from user address input
- Progress indicator (8-10s proving time UX)
- Error handling (invalid proofs, network failures)
- Mobile optimization (iOS Safari, Android Chrome)

**Week 11: External Security Audit**
- Trail of Bits or equivalent firm
- Circuit soundness verification
- Verifier contract audit
- Fiat-Shamir implementation review
- Side-channel attack analysis (timing attacks, memory leaks)

**Week 12: Mainnet Deployment**
- Deploy verifier contract to Scroll mainnet
- Shadow Atlas initial root hash publication
- IPFS upload of circuit parameters
- Frontend deployment with WASM prover
- Monitoring dashboards (proving failures, gas costs, verification failures)

**Deliverables:**
- Production-ready GKR proving system
- Security audit report (publicly hosted on IPFS)
- Mainnet contract addresses
- Monitoring infrastructure

**F. Groth16 Pivot Contingency Plan**

**If GKR Fails Benchmarks (Gas >250k OR Proving >15s):**

**Week 1: Pivot Decision & Communication**
- Document benchmarking results publicly
- Explain decision: "GKR gas costs were $X per verification. Uneconomical at scale."
- Announce Groth16 trusted setup ceremony

**Weeks 2-3: Trusted Setup Ceremony**
- Coordinate 50+ independent participants across jurisdictions
- Multi-party computation protocol (Phase 2 library or equivalent)
- Real-time ceremony progress dashboard (public transparency)
- Participant attestations (PGP-signed statements)
- IPFS upload of ceremony transcript

**Weeks 4-5: Groth16 Circuit Implementation**
- Circom circuit for Shadow Atlas Merkle proof
- Powers of Tau ceremony integration
- Proving key and verification key generation
- Solidity verifier contract (SnarkJS or equivalent)

**Week 6: Integration & Testing**
- Frontend integration (WASM prover, ~8-12s proving time)
- Gas benchmarking on Scroll testnet (~150k gas expected)
- Security review (circuit soundness, verifier correctness)

**Weeks 7-8: Mainnet Deployment**
- Deploy Groth16 verifier contract
- Shadow Atlas root hash publication
- IPFS upload of ceremony transcript + proving/verification keys
- Public documentation of pivot decision

**Total Pivot Timeline:** 2-3 months (delays Phase 1 launch to 5-6 months total)

**G. Success Criteria**

**GKR Launch Requirements (All Must Pass):**
- ✅ Proving time: <10s on commodity hardware (2020+ laptop/smartphone)
- ✅ Verification gas: <250k gas on Scroll L2 (~$0.025 at current prices)
- ✅ Proof size: <5KB (acceptable network overhead)
- ✅ Security audit: No critical vulnerabilities
- ✅ Circuit soundness: Formal verification or mathematical proof
- ✅ Fiat-Shamir implementation: No verifier randomness leakage

**If Any Fail → Pivot to Groth16**

**H. Risk Assessment**

**High Risk (Acceptable):**
- GKR published 11 days ago (October 19, 2025) - cutting-edge
- Limited production implementations (Polyhedra Expander is newest)
- Gas costs uncertain (no Scroll benchmarks exist yet)
- Fiat-Shamir transformation adds overhead (vs interactive protocol)

**Medium Risk (Manageable):**
- Circuit optimization may require Polyhedra team support
- WASM compilation may hit browser limitations (memory, stack size)
- Scroll L2 gas pricing may change (mitigation: batch verification)

**Low Risk:**
- Shadow Atlas Merkle tree structure well-understood
- Poseidon hash function proven in production (Tornado Cash, Zcash)
- Groth16 contingency is proven technology (fallback always available)

**What Makes Risk Acceptable:**
- Benchmarking happens BEFORE production launch (can pivot without user impact)
- Groth16 contingency is fully defined (known timeline and process)
- Permanent security win if GKR succeeds (no trusted setup forever)
- Community transparency (public benchmarking, documented decision rationale)

**I. Technical Specifications**

**GKR Proof Structure:**
```rust
pub struct GKRProof {
    pub layer_commitments: Vec<FieldElement>,  // One per Merkle tree layer
    pub layer_responses: Vec<FieldElement>,    // Sumcheck protocol responses
    pub district_hash: FieldElement,           // Public output (district TX-18)
    pub merkle_depth: u32,                     // Shadow Atlas tree depth
}
```

**Fiat-Shamir Challenges:**
```solidity
function computeChallenge(
    bytes32 previousChallenge,
    bytes32 commitment,
    bytes32 response
) internal pure returns (bytes32) {
    return keccak256(abi.encode(previousChallenge, commitment, response));
}
```

**Verification Contract Interface:**
```solidity
interface IDistrictVerifier {
    function verifyDistrictMembership(
        GKRProof calldata proof
    ) external view returns (bool);

    function shadowAtlasRoot() external view returns (bytes32);

    function updateShadowAtlasRoot(
        bytes32 newRoot,
        bytes calldata governanceProof
    ) external;
}
```

**J. Polyhedra Expander Integration**

Document:
- Rust crate: `expander-compiler`
- Circuit DSL: Expander's frontend language
- Compilation: Rust → WASM for browser execution
- Proving: `compiled.prove(witness)` → `GKRProof`
- Fiat-Shamir: `fiat_shamir_transform(proof)` → non-interactive proof

**Example Rust Code:**
```rust
use expander_compiler::frontend::*;

// Build Merkle membership circuit
let circuit = build_merkle_membership_circuit(MERKLE_DEPTH);
let config = CompileConfig::default();
let compiled = compile(&circuit, config)?;

// Generate witness from user input
let witness = ShadowAtlasWitness {
    address: user_address,           // Private input
    district_id: "TX-18",            // Public input
    merkle_proof: get_merkle_proof(), // Private input
};

// Generate GKR proof
let proof = compiled.prove(witness)?;

// Apply Fiat-Shamir
let non_interactive_proof = fiat_shamir_transform(proof);

// Result: 2-4KB proof, ready for on-chain verification
```

**K. Monitoring & Observability**

**Metrics to Track:**
- Proving time distribution (p50, p95, p99)
- Verification gas costs (per proof, per batch)
- Proof size distribution
- Failure rates (invalid proofs, network errors)
- Shadow Atlas root updates (quarterly)

**Dashboards:**
- Grafana: Real-time proving performance
- Etherscan: On-chain verification transactions
- IPFS: Circuit parameters availability
- Sentry: Error tracking and alerting

**Alerts:**
- Proving time >15s (investigate performance regression)
- Verification gas >250k (may indicate optimizer bypass)
- Proof failure rate >1% (circuit bug or attack attempt)
- Shadow Atlas root mismatch (data integrity issue)

**Estimated Effort:** 3-4 hours

---

## Phase 4 - Internal & Developer Documents (MEDIUM PRIORITY)

### 7. CLAUDE.md (Internal instructions)

**Required Updates:**
- Ensure Phase 1 budget constraints referenced
- Update architecture decision references (GKR not Groth16)
- Verify moderation requirements documented
- Check identity verification instructions (self.xyz, Didit.me)

**Estimated Effort:** 30 minutes (quick consistency check)

---

### 8. specs/CRYPTO-SDK-SPEC.md

**Required Updates:**
- Replace Groth16 proving functions with GKR equivalents
- Update proof structure interfaces
- Document Fiat-Shamir transformation API
- Add Polyhedra Expander integration examples
- Update gas cost estimates (150k → 200-250k)

**Estimated Effort:** 1-2 hours

---

### 9. specs/CLIENT-SDK-SPEC.md

**Required Updates:**
- Remove/mark Phase 2 token reward functions
- Update reputation-only function signatures
- Document FREE identity verification flows (self.xyz, Didit.me)
- Update cost estimates (users pay $0, platform pays gas)
- Add Phase 1/2 feature flags

**Estimated Effort:** 1-2 hours

---

### 10. specs/INTEGRATION-SPEC.md

**Required Updates:**
- Mark challenge market integrations as Phase 2
- Mark outcome market integrations as Phase 2
- Update API responses to show reputation-only Phase 1 data
- Document content moderation webhook integration
- Add congressional dashboard Phase 1 API examples

**Estimated Effort:** 1-2 hours

---

### 11. specs/DEPLOYMENT-SPEC.md

**Required Updates:**
- Add GKR verifier contract deployment steps
- Add content moderation service deployment (OpenAI API keys, Gemini/Claude)
- Add GCP Confidential Space TEE setup
- Document Phase 1 infrastructure costs ($326/month)
- Add monitoring for moderation layers

**Estimated Effort:** 1-2 hours

---

### 12. specs/CIPHERVAULT-CONTRACT-SPEC.md

**Required Updates:**
- Verify PII encryption flows align with self.xyz/Didit.me
- Update access control (congressional delivery via TEE)
- Ensure no token reward references (Phase 2)

**Estimated Effort:** 30 minutes - 1 hour

---

## Phase 5 - New Documentation (MEDIUM PRIORITY)

### 13. Create docs/identity-verification-architecture.md (NEW)

**Contents:**

**A. Executive Summary**
- Two FREE verification methods (self.xyz primary, Didit.me fallback)
- Sybil resistance: One verified identity = one account
- Privacy preservation: Verification → district proof flow
- Rate limiting: 10 templates/day sent, 3 created/day

**B. self.xyz Integration (Primary Method)**

Document:
- NFC passport scanning (FREE, 60 seconds)
- Face ID liveness check (prevents photo attacks)
- Supported passports: 120+ countries with NFC chips
- Privacy: Only district extracted, full address never stored
- Flow: Passport scan → Face ID → District extraction → ZK proof generation

**C. Didit.me Integration (Fallback Method)**

Document:
- Photo ID + selfie verification (FREE Core KYC tier)
- Liveness detection (video selfie, blink detection)
- Supported IDs: Driver's license, state ID, national ID
- Use case: Users without passports (estimated 30% of US population)
- Privacy: Same as self.xyz (only district extracted)

**D. Verification Flow**

Document step-by-step:
1. User selects verification method (self.xyz or Didit.me)
2. Identity verification completes (60-120 seconds)
3. Address extracted from verified identity
4. Congressional district lookup (Shadow Atlas Merkle tree)
5. User generates ZK proof (GKR, 8-10 seconds)
6. Proof verified on-chain (Scroll L2)
7. Verified status recorded (one identity = one account)
8. Rate limits activated (10 templates sent/day, 3 created/day)

**E. Sybil Resistance**

Document:
- Cryptographic binding: Identity hash → wallet address (NEAR CipherVault)
- One verified identity can't create multiple accounts
- Unverified wallets: Phase 1 zero reputation, Phase 2 50% rewards
- Attack vectors:
  - Stolen passports/IDs (liveness detection mitigates)
  - Fake IDs (self.xyz/Didit.me verification catches)
  - Multiple passports (rare, expensive, rate limits reduce impact)

**F. Rate Limiting**

Document per verified identity:
- 10 templates sent per day (prevents spam)
- 3 templates created per day (prevents low-quality flooding)
- 5 reputation updates per day (prevents gaming)
- Cooldown periods: 24 hours (rolling window)
- Exceeding limits: Temporary suspension (24 hours), reputation penalty

**G. Privacy Preservation**

Document zero-knowledge flow:
- Full address NEVER leaves user's device
- Only district hash revealed in ZK proof
- Congressional offices see: "Verified constituent in TX-18" (no address)
- Employers can't reverse-engineer location from on-chain proofs
- Platform operators never store full addresses

**H. Cost Analysis**

Both methods FREE:
- self.xyz: $0 (FREE tier, unlimited verifications)
- Didit.me: $0 (Core KYC tier, FREE for basic verification)
- Platform pays Scroll gas (~$0.01 per verification)
- Total per-user onboarding: ~$0.01 (just blockchain verification)

**I. Regulatory Compliance**

Document:
- Know Your Customer (KYC): Meets basic KYC for platform (not exchange-level)
- Anti-Money Laundering (AML): Identity verification prevents anonymous mass Sybil
- Privacy laws: GDPR/CCPA compliant (PII encrypted, user-controlled decryption)
- Congressional verification: Satisfies CWC API requirements (verified constituent status)

**Estimated Effort:** 2-3 hours

---

### 14. Create docs/phase2-token-economics.md (NEW)

**Rationale:** Clarifies what's NOT in Phase 1 and why, provides Phase 2 roadmap.

**Contents:**

**A. Why Phase 2 Exists (12-18 Months Post-Launch)**

Document:
- **Regulatory compliance:** CLARITY Act framework, securities law analysis
- **Liquidity infrastructure:** DEX integration, market making, treasury management
- **Economic security:** Token supply modeling, attack scenario testing
- **User base requirement:** Challenge markets need liquidity (can't arbitrate with 1K users)
- **Congressional adoption:** Outcome markets need legislative track record for impact correlation

**B. VOTER Token Design**

Document:
- Utility token (not security per CLARITY Act classification)
- Use cases: Challenge staking, outcome market positions, governance voting
- Supply model: Capped or inflationary (TBD based on Phase 1 data)
- Distribution: Retroactive airdrop to Phase 1 reputation holders + ongoing rewards
- Governance: DAO control of treasury, protocol parameters, reputation registry

**C. Challenge Markets Architecture**

Document:
- Stake on verifiable claims (voting records, bill text, policy outcomes)
- Quadratic staking (prevents plutocracy)
- Multi-model AI adjudication (GPT-5, Claude Opus, Gemini Pro, Grok, Mistral Large, Command R)
- 67% consensus required (4 of 6 models minimum)
- Economic incentives: Win → earn stake + reputation, Lose → forfeit stake + reputation penalty

**D. Outcome Markets Architecture**

Document:
- Binary prediction markets on legislative outcomes
- Retroactive funding mechanism (20% of losing pool → civic infrastructure contributors)
- ImpactAgent determines contribution weights (template adoption, geographic clustering, semantic similarity)
- Example: "Will H.R. 3337 pass House committee by Q4 2025?" resolves → contributors earn proportional rewards

**E. Multi-Agent Treasury**

Document:
- 5 specialized agents (SupplyAgent, MarketAgent, ImpactAgent, ReputationAgent, VerificationAgent)
- Deterministic workflows (not raw LLM inference)
- Weighted consensus (SupplyAgent 30%, MarketAgent 30%, ImpactAgent 20%, ReputationAgent 20%)
- On-chain audit trails (IPFS-hashed context, reproducible decisions)
- Community governance override (24-hour window for suspicious decisions)

**F. Privacy Pools Integration**

Document:
- Vitalik's 2023/2025 privacy pool architecture
- Association sets defined by congressional district
- Shielded VOTER token transfers (transaction amounts hidden)
- Proof of clean funds origin (regulatory compliance)
- Transparent reputation registry (required for congressional signal)

**G. Phase 1 → Phase 2 Migration**

Document:
- Retroactive airdrop to Phase 1 reputation holders (proportional to reputation scores)
- Reputation conversion: High reputation → token bonus multiplier
- Backwards compatibility: Phase 1 reputation remains (portable across platforms)
- Congressional dashboard: Upgraded to show token staking activity (challenge accuracy, outcome positions)

**H. Economic Security Considerations**

Document attack vectors:
- Death spiral (Terra/Luna failure mode): Multi-agent treasury adjusts reward rates dynamically
- Sybil farming: Identity verification + reputation requirements limit attack surface
- Market manipulation: Quadratic staking prevents whale dominance
- Oracle manipulation: Multiple independent oracles, outlier detection

**I. Regulatory Strategy**

Document:
- CLARITY Act compliance (utility token classification)
- Securities law analysis (Howey test: not an investment contract)
- State-level money transmission (prediction markets legal framework)
- KYC/AML for large stakes (>$10K): Exchange-level verification required

**J. Why Phase 1 Proves Viability First**

Document:
- Token economics require proven civic utility (chicken-and-egg problem)
- Congressional adoption depends on signal quality (not financial incentives)
- User base needs organic growth (financial speculation attracts wrong users initially)
- Reputation system needs calibration (can't set token rewards without participation data)

**Estimated Effort:** 3-4 hours

---

## Summary: Documentation Update Priorities

### Immediate (Do Now):
1. **ARCHITECTURE.md** (3-4 hours) - Central technical reference
2. **SECURITY.md** (2-3 hours) - Add content moderation
3. **Create docs/content-moderation-architecture.md** (2-3 hours) - Dedicated moderation doc

**Total Immediate:** 7-10 hours

### High Priority (Next):
4. **CONGRESSIONAL.md** (1-2 hours) - Target audience clarity
5. **QUICKSTART.md** (1-2 hours) - User-facing messaging
6. **Create docs/gkr-implementation-plan.md** (3-4 hours) - Technical guide

**Total High Priority:** 5-8 hours

### Medium Priority (After High):
7-12. **specs/ directory** (5-7 hours total)
13. **Create docs/identity-verification-architecture.md** (2-3 hours)
14. **Create docs/phase2-token-economics.md** (3-4 hours)

**Total Medium Priority:** 10-14 hours

### Low Priority (If Time):
- CLAUDE.md (30 minutes)
- Additional spec refinements

---

## Grand Total Estimated Effort

**Immediate + High Priority:** 12-18 hours
**All Updates (Including Medium):** 22-32 hours
**Complete Documentation Overhaul:** ~30 hours realistic estimate

---

## Success Criteria

All documentation updates complete when:
- ✅ No references to Groth16 without GKR context/contingency
- ✅ All Phase 2 features clearly labeled as "future" (12-18 months)
- ✅ Phase 1 budget ($326/month) documented across relevant docs
- ✅ Content moderation architecture fully documented (3-layer stack, Section 230)
- ✅ FREE identity verification (self.xyz, Didit.me) documented across user-facing docs
- ✅ Congressional offices understand Phase 1 value proposition (reputation signals, not token rewards)
- ✅ Developers understand GKR implementation plan (benchmarking gates, Groth16 contingency)
- ✅ Specs align with Phase 1 architecture (no token reward APIs, reputation-only)

---

**Status:** Plan complete. Ready to execute in priority order.
**Next Step:** Begin ARCHITECTURE.md updates (highest priority, most critical doc).

---

## Execution Guidelines

**Revision-First Policy:**
- **REVISE, don't remove** - Update outdated content to reflect current architecture
- **Remove only when warranted** - Delete only truly obsolete content with no revision path
- Example: Groth16 code → Revise to GKR with contingency note, don't delete
- Example: Challenge market code → Add Phase 2 label, explain relationship to Phase 1, don't delete
- Example: Outdated cost estimates → Update with current numbers, preserve structure

**Code Update Policy:**
- Replace Groth16 examples with GKR equivalents (preserve code structure, update implementation)
- Label Phase 2 code examples clearly ("Phase 2 Feature - Not in Initial Launch")
- Add Phase 1 alternatives where Phase 2 features referenced (e.g., "Phase 1: Reputation tracking, Phase 2: Token rewards")
- Keep challenge market/outcome market architecture documented (mark as "Phase 2 - 12-18 months")

**Markdown Preservation:**
- Keep all existing .md file structure intact
- Update content in-place rather than rewriting sections
- Maintain existing section organization where possible
- Add new sections clearly marked (e.g., "## Content Moderation Architecture (Phase 1)")
- Preserve historical context with update notes (e.g., "Updated Oct 2025: GKR replaces Groth16")

**Philosophy:**
- Documentation should tell the complete story (Phase 1 → Phase 2 evolution)
- Developers reading docs should understand full vision, not just Phase 1
- Revisions clarify timeline and dependencies, removal loses context
- Only remove content that is factually wrong or architecturally abandoned
