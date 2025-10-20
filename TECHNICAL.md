# Technical Architecture: Cryptographic Democracy Infrastructure

**For blockchain developers, cryptography engineers, protocol designers.**

This document covers implementation details the README abstracts away. Assumes familiarity with zero-knowledge proofs, threshold cryptography, and confidential computing.

-----

## Phase Architecture Overview

VOTER Protocol ships in three phases. Phase 1 establishes cryptographic foundations and reputation infrastructure. Phase 2 adds token economics and financial mechanisms. Phase 3 explores advanced privacy (only if community demands + congressional offices accept tradeoffs).

### Phase 1 (Current - Launch-Ready, 3 months)

**Cryptographic Infrastructure:**
- **GKR-based district proofs** (no trusted setup, shipped from day one)
- **E2E encryption via GCP Confidential Space** (TEE with AMD SEV-SNP attestation)
- **Cross-chain account abstraction** (NEAR Chain Signatures for wallet-free participation)
- **On-chain reputation** (ERC-8004 portable credibility, no token rewards)

**Content Moderation:**
- **3-layer moderation stack** (FREE OpenAI Moderation API + Gemini 2.5 Flash-Lite + Claude Haiku 4.5 + human review)
- **Section 230 CDA compliance** (proactive moderation for illegal content, reactive for everything else)

**Identity Verification:**
- **self.xyz** (FREE NFC passport scanning, primary method)
- **Didit.me** (FREE Core KYC tier, fallback for non-passport users)

**Budget:** $326/month for 1,000 users / 10,000 messages

**No Token Economics:** Reputation-only system. No VOTER token. No challenge markets. No outcome markets. No treasury agents.

### Phase 2 (12-18 months post-launch)

**Token Economics:**
- **VOTER token launch** (utility + governance)
- **Challenge markets** (stake on verifiable claims, multi-model AI adjudication)
- **Outcome markets** (retroactive funding for legislative impact)
- **Multi-agent treasury** (5 specialized agents managing token supply)
- **Privacy pools** (Buterin 2023/2025, shielded transactions with association proofs)

**Why delayed:** Token launches require legal compliance (CLARITY Act framework), liquidity infrastructure, economic security. Phase 1 proves civic utility before adding financial layer.

### Phase 3+ (Speculative - 2+ years, community-dependent)

**Advanced Privacy (ONLY if community demands AND congressional offices accept):**
- **Nested ZK proofs** (range proofs for reputation scores instead of exact values)
- **Shielded message metadata** (hide send timestamps, template IDs)

**Tradeoff:** Congressional offices receive weaker aggregate signals. Currently they see exact adoption counts, precise timing, specific template performance. Nested ZK would show "between 500-1000 people support this" instead of "847 people sent this template on these specific dates."

**Decision criteria:** Community referendum + congressional staff feedback. If offices say "we can't use this data," we don't ship it.

-----

## Core Cryptographic Primitives

### Zero-Knowledge District Verification (GKR Protocol)

**Problem:** Prove congressional district membership without revealing address.

**Why GKR instead of Groth16:** Eliminates trusted setup ceremony (permanent security liability). Published October 19, 2025 by Vitalik Buterin. Theoretically optimal for Merkle tree verification (Shadow Atlas use case). Accept cutting-edge risk over permanent ceremony dependency.

**Implementation:**
- **Circuit:** GKR (Goldwasser-Kalai-Rothblum) interactive proof for Merkle tree membership
  - Fiat-Shamir transformation for non-interactive on-chain verification
  - Shadow Atlas Merkle tree proves address ∈ specific electoral district
- **Shadow Atlas:** Global electoral district mapping (Congressional districts, Parliamentary constituencies, city councils for 190+ countries)
  - Quarterly IPFS updates with new root hash published on-chain
  - Poseidon hash function for Merkle tree (SNARK-friendly, maintains GKR efficiency)
  - Target: <10 second client-side proving time (Polyhedra Expander implementation)
  - Proof size: ~2-4KB (larger than Groth16, acceptable tradeoff for no trusted setup)
- **Verification:** On-chain smart contract verifies GKR proof via Fiat-Shamir against current Shadow Atlas root
  - Target: <250k gas (economic viability threshold on Scroll L2)
  - If gas exceeds 250k in benchmarks: PIVOT to Groth16 (accept ceremony for viability)
- **Privacy guarantee:** Proof reveals only district hash, never address. Computational soundness (not information-theoretic, but no trusted setup risk).

**Fiat-Shamir Transformation:**
GKR is interactive (verifier sends random challenges). Fiat-Shamir makes it non-interactive by replacing verifier randomness with hash of transcript:

```
challenge_1 = Hash(commitment_1, public_input)
challenge_2 = Hash(commitment_1, challenge_1, commitment_2)
...
challenge_n = Hash(entire_transcript)
```

Prover generates all commitments + responses offline. Verifier replays computation using deterministic hash challenges.

**Smart Contract Implementation:**
```solidity
contract DistrictVerifier {
    bytes32 public shadowAtlasRoot;

    struct GKRProof {
        bytes32[] layerCommitments;
        bytes32[] layerResponses;
        bytes32 districtHash;
        uint256 merkleDepth;
    }

    function verifyDistrictMembership(
        GKRProof calldata proof
    ) public view returns (bool) {
        // Fiat-Shamir: Deterministic challenges from proof transcript
        bytes32 challenge = keccak256(
            abi.encode(proof.layerCommitments[0], shadowAtlasRoot, proof.districtHash)
        );

        // Verify each GKR layer (Merkle tree depth layers)
        for (uint i = 0; i < proof.merkleDepth; i++) {
            // Check layer polynomial evaluation
            require(
                verifyLayerPolynomial(
                    proof.layerCommitments[i],
                    proof.layerResponses[i],
                    challenge
                ),
                "GKR layer verification failed"
            );

            // Generate next challenge from transcript
            challenge = keccak256(
                abi.encode(challenge, proof.layerResponses[i])
            );
        }

        // Final check: claimed district hash matches Shadow Atlas
        require(
            verifyFinalLayer(proof.districtHash, challenge, shadowAtlasRoot),
            "District hash mismatch"
        );

        return true;
    }

    function verifyLayerPolynomial(
        bytes32 commitment,
        bytes32 response,
        bytes32 challenge
    ) internal pure returns (bool) {
        // Verify sumcheck protocol for this layer
        // (Low-degree polynomial evaluation)
        // Implementation uses Polyhedra Expander optimizations
        return true; // Placeholder for actual sumcheck verification
    }
}
```

**Client-Side Proving (Rust → WASM via Polyhedra Expander):**
```rust
use expander_compiler::frontend::*;

// User inputs address privately (never leaves browser)
let witness = ShadowAtlasWitness {
    address: user_address,
    district_id: "TX-18",
    merkle_proof: get_merkle_proof(user_address, shadow_atlas_tree),
};

// Generate GKR proof using Polyhedra Expander
let circuit = build_merkle_membership_circuit(witness.merkle_proof.depth);
let config = CompileConfig::default();
let compiled = compile(&circuit, config)?;

// Prove (target: <10 seconds on commodity hardware)
let proof = compiled.prove(witness)?;

// Apply Fiat-Shamir transformation
let non_interactive_proof = fiat_shamir_transform(proof);

// Result: Proof contains district hash only, never address
// Size: ~2-4KB (acceptable for no trusted setup)
```

**Performance Benchmarks (Critical Milestones):**

**Month 1-2 (Make-or-Break Metrics):**
- **Proving time:** Must be <10s on commodity hardware (2020+ laptop/phone)
  - Target: 8s average
  - Acceptable: 10s maximum
  - If >15s: PIVOT to Groth16 immediately
- **Verification gas:** Must be <250k gas on Scroll L2
  - Target: 200k gas
  - Acceptable: 250k gas maximum (~$0.025 at current Scroll gas prices)
  - If >250k: PIVOT to Groth16 (economic viability failure)
- **Proof size:** <5KB acceptable (not critical, network overhead negligible)

**Contingency: Groth16 Pivot Plan**

If GKR fails benchmarks in Month 1-2:
1. **Accept trusted setup ceremony** (permanent security tradeoff, but proven)
2. **Coordinate 50+ ceremony participants** across jurisdictions (2-3 week process)
3. **IPFS-hosted ceremony transcript** with cryptographic attestations
4. **Delay Phase 1 launch by 2-3 months** (total 5-6mo vs 3mo GKR timeline)
5. **Document decision publicly:** "We tried GKR. Gas costs were $X per verification. Uneconomical. Groth16 ceremony completed with Y independent participants."

**Why This Risk is Acceptable:**

**What we gain if GKR succeeds:**
- No trusted setup ceremony (permanent security win)
- No coordination overhead for multi-party ceremonies
- Theoretically optimal proving system for Merkle trees (our exact use case)
- Cutting-edge cryptography reputation

**What we lose if GKR fails:**
- 2-3 month delay pivoting to Groth16
- Sunk engineering time on GKR implementation (~1 month)

**What we avoid by choosing GKR over Groth16 immediately:**
- Permanent dependency on ceremony security assumptions
- Coordination complexity for 50+ independent ceremony participants
- Potential ceremony vulnerabilities (toxic waste if participants collude)

**Decision:** Ship correctly once with no trusted setup, accept cutting-edge risk. If we're wrong, we know definitively and can pivot to proven technology.

### Cross-Chain Account Abstraction

**Problem:** One account controlling addresses on every blockchain without bridges or wrapped tokens.

**Implementation:**
- **[NEAR Chain Signatures](https://docs.near.org/chain-abstraction/chain-signatures):** Threshold ECDSA via multi-party computation
- **Key shares:** Distributed across NEAR validator set (300+ independent nodes)
- **Signature generation:** [MPC protocol](https://eprint.iacr.org/2019/114) produces valid ECDSA signatures for Bitcoin, Ethereum, Scroll, any ECDSA chain
- **No bridges:** Signatures are cryptographically native to each chain
- **Passkey-based control:** WebAuthn credentials (Face ID/fingerprint) trigger signature requests

**Why NEAR:**
- Production-grade threshold signature network (live since 2023)
- No trusted hardware requirements for MPC nodes
- Sub-second signature latency
- Rust-based security model

**Account derivation:**
```typescript
// User's passkey public key determines all blockchain addresses
const masterPath = sha256(passkey_pubkey);
const ethAddress = deriveEthAddress(nearMPC.sign(masterPath, "eth"));
const btcAddress = deriveBtcAddress(nearMPC.sign(masterPath, "btc"));
const scrollAddress = deriveScrollAddress(nearMPC.sign(masterPath, "scroll"));
// All addresses provably controlled by same passkey, no seed phrase storage
```

**Security:**
- MPC ensures no single node sees complete private key
- Byzantine fault tolerance: 2/3 of NEAR validators must collude to extract keys
- Passkey compromise requires device physical access + biometric break

### End-to-End Message Encryption

**Problem:** Deliver messages to congressional offices without platform operators reading plaintext.

**Implementation:**
- **Client-side encryption:** [XChaCha20-Poly1305](https://doc.libsodium.org/) AEAD (libsodium)
  - User generates ephemeral key pair per message
  - Encrypts message with symmetric key
  - Encrypts symmetric key to congressional office public key
  - Deletes keys after encryption
- **[GCP Confidential Space](https://cloud.google.com/confidential-computing/confidential-space/docs/confidential-space-overview):** Hardware-attested trusted execution environment ([AMD SEV-SNP](https://www.amd.com/en/developer/sev.html))
  - Encrypted blob enters TEE
  - Decryption happens inside enclave
  - Delivery to CWC (Communicating with Congress) API from whitelisted IP
  - Attestation report proves code integrity
- **Congressional delivery:** Plaintext exists only in enclave → CWC → congressional CRM

**Attestation verification:**
```go
// Verify TEE attestation before accepting encrypted blob
func verifyAttestation(report AttestationReport) bool {
    // Check AMD SEV-SNP signature
    if !verifySEVSignature(report.Signature, report.ReportData) {
        return false
    }

    // Verify expected code measurement
    if report.Measurement != EXPECTED_ENCLAVE_HASH {
        return false
    }

    // Verify enclave instance details
    return report.InstanceID != "" && report.Timestamp.Valid()
}
```

**Known tension:** Using Google infrastructure contradicts pure sovereignty. We acknowledge this.

GCP Confidential Space enables immediate CWC integration and congressional office compliance. AMD SEV-SNP hardware guarantees prevent Google cloud admin access to enclave memory—plaintext never touches Google's ability to read it. This is architecturally different from "Google promises not to look."

Self-hosted TEEs, fully homomorphic encryption, and [privacy pools](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4563364) are researched alternatives if Google dependency becomes untenable. Current architecture prioritizes proven production infrastructure over theoretical purity.

### On-Chain Reputation (ERC-8004 Extension)

**Problem:** Portable, verifiable credibility across all democratic platforms globally.

**Implementation:**
- **Base:** ERC-8004 reputation registry (originally designed for AI agent credibility)
- **Domain-specific scoring:** Healthcare reputation doesn't transfer to climate policy
- **Time-weighted decay:** Stop participating → reputation decays (prevents "reputation squatting")
- **Composable proofs:** Generate ZK proofs of reputation ranges without revealing exact scores

**Registry contract:**
```solidity
contract VOTERReputation is IERC8004 {
    struct DomainScore {
        uint256 score;
        uint256 lastUpdate;
        uint256 decayRate;
    }

    // wallet => domain => score
    mapping(address => mapping(bytes32 => DomainScore)) public reputation;

    function updateReputation(
        address actor,
        bytes32 domain,
        int256 delta,  // positive for good actions, negative for challenges lost
        bytes calldata proof  // ImpactAgent attestation or challenge result
    ) external onlyAuthorizedAgents {
        DomainScore storage score = reputation[actor][domain];

        // Apply time decay
        uint256 elapsed = block.timestamp - score.lastUpdate;
        uint256 decayed = (score.score * score.decayRate * elapsed) / 365 days;
        score.score -= decayed;

        // Apply delta
        if (delta > 0) {
            score.score += uint256(delta);
        } else {
            score.score -= uint256(-delta);
        }

        score.lastUpdate = block.timestamp;
    }
}
```

**Reputation sources:**
- Challenge market accuracy (win challenges → +reputation, lose → -reputation)
- Template adoption (high-quality templates adopted by many → +reputation)
- Impact correlation (templates influencing legislation → +reputation)
- Consistent participation (regular civic actions → +reputation)
- Domain expertise (reputation siloed by policy area)

**ZK reputation proofs:**
```rust
// Prove "my healthcare reputation > 5000" without revealing exact score
circuit ProvReputationRange {
    private input score: u64;
    private input domain: Field;
    public input threshold: u64;
    public input commitment: Field;

    // Verify commitment matches actual score
    assert(poseidon_hash([score, domain]) == commitment);

    // Verify score exceeds threshold
    assert(score >= threshold);
}
```

Congressional staff see: "Healthcare reputation > 5000" (verified via ZK proof). They don't see exact score. User privacy preserved while signaling credibility.

### Content Moderation & Section 230 Compliance

**Problem:** Prevent illegal content without becoming liable for all user speech.

**Legal Framework - Section 230 CDA:**

**What Section 230 PROTECTS platforms from:**
- ✅ Defamation lawsuits for user posts (even if false)
- ✅ Copyright infringement (if you comply with DMCA takedowns)
- ✅ Most torts arising from user content (negligence, intentional infliction of emotional distress)
- ✅ State-level content laws (federal preemption)

**What Section 230 DOES NOT protect platforms from:**
- ❌ **CSAM (child sexual abuse material)** - Federal crime, mandatory reporting
- ❌ **FOSTA-SESTA violations** - Sex trafficking content
- ❌ **Terrorism** - Material support for terrorist organizations
- ❌ **Obscenity** - Federally illegal obscene content
- ❌ **Federal criminal law violations** - Platforms can't facilitate crimes
- ❌ **Intellectual property** (if you ignore DMCA process)
- ❌ **Communications privacy laws** (wiretapping, ECPA violations)

**Implementation Strategy:**

**Proactive moderation (legally required):**
- CSAM detection and reporting (NCMEC reports)
- Terrorism content removal (material support prohibition)
- Obscenity filtering (federal criminal code)
- Threats of violence (incitement, specific threats)

**Reactive moderation (Section 230 protected):**
- Misinformation/disinformation (not illegal, moderation optional)
- Political speech (protected, cannot moderate based on viewpoint)
- Offensive but legal content (Section 230 allows removal, not required)

**Our Approach: 3-Layer Moderation Stack**

**Layer 1: OpenAI Moderation API (FREE Pre-Filter)**
- **Cost:** $0 (FREE for all OpenAI API users, unlimited requests)
- **Model:** text-moderation-007 (GPT-4o multimodal, Oct 2024)
- **Latency:** 47ms average
- **Accuracy:** 95% across 13 categories
- **Categories detected:**
  - `sexual` - Sexual content
  - `sexual/minors` - CSAM (CRITICAL: auto-report to NCMEC)
  - `hate` - Hate speech
  - `hate/threatening` - Violent hate speech
  - `harassment` - Harassment and bullying
  - `harassment/threatening` - Threats
  - `self-harm` - Self-harm content
  - `self-harm/intent` - Intent to self-harm
  - `self-harm/instructions` - Instructions for self-harm
  - `violence` - Graphic violence
  - `violence/graphic` - Extremely graphic violence
  - `illicit` - Drug use, weapons trafficking
  - `illicit/violent` - Violent crimes

**Logic:**
```typescript
// Every message passes through Layer 1 FIRST
const openaiResult = await openai.moderations.create({
  input: messageText
});

if (openaiResult.results[0].flagged) {
  const categories = openaiResult.results[0].categories;

  // MANDATORY REPORTING (federal law)
  if (categories['sexual/minors']) {
    await reportToNCMEC(message);
    return REJECT_PERMANENTLY;
  }

  // AUTO-REJECT (proactive moderation for illegal content)
  if (categories['violence/graphic'] ||
      categories['illicit/violent'] ||
      categories['hate/threatening']) {
    return REJECT;
  }

  // ESCALATE (borderline cases)
  if (categories['harassment'] || categories['hate']) {
    await queueForLayer2(message);
  }
}

// If OpenAI passes, proceed to Layer 2 (95% of messages)
```

**Result:** Layer 1 catches 95% of illegal content at $0 cost. Only 5% of messages proceed to paid Layer 2.

**Layer 2: Multi-Model Consensus (Gemini + Claude)**
- **Cost:** $15.49/month for 9,500 messages (assuming 5% escalation from Layer 1)
- **Models:**
  - Gemini 2.5 Flash-Lite: $0.10 input / $0.40 output per 1M tokens
  - Claude Haiku 4.5: $1.00 input / $5.00 output per 1M tokens
- **Consensus Logic:** OpenAI + (Gemini OR Claude) = PASS (2 of 3 providers)
  - If all 3 flag: AUTO-REJECT
  - If OpenAI + one other flag: ESCALATE to Layer 3
  - If only OpenAI flagged (already from Layer 1): Gemini + Claude vote
- **Latency:** 200-500ms per model (parallel execution)

**Logic:**
```typescript
// Layer 2 only runs for borderline cases from Layer 1
const [geminiResult, claudeResult] = await Promise.all([
  moderateWithGemini(messageText),
  moderateWithClaude(messageText)
]);

const votes = {
  openai: true,  // Already flagged in Layer 1
  gemini: geminiResult.violation,
  claude: claudeResult.violation
};

const flagCount = Object.values(votes).filter(v => v).length;

if (flagCount >= 2) {
  // 2+ models agree: likely violation
  await queueForLayer3(message, votes);
} else {
  // Only OpenAI flagged, others passed: likely false positive
  return APPROVE;
}
```

**Layer 3: Human Review Queue**
- **Escalation criteria:** Split decisions (OpenAI passes but both Layer 2 flag, or vice versa)
- **SLA:** 24-hour review
- **Reviewers:** 2+ independent moderators per escalation
- **Cost:** ~$50/month (assumes 2% of all messages escalate, ~200 reviews/month)
- **Training:** Federal law requirements (CSAM reporting, terrorism, obscenity)

**Logic:**
```typescript
// Layer 3 only for split decisions
const review = await humanReviewQueue.create({
  message: messageText,
  layer1: openaiResult,
  layer2: { gemini: geminiResult, claude: claudeResult },
  escalationReason: 'Split AI decision',
  priority: containsCSAMKeywords(messageText) ? 'URGENT' : 'NORMAL'
});

// 2+ humans review
const humanVotes = await review.getVotes();  // Waits for 2+ moderators

if (humanVotes.reject >= 2) {
  return REJECT;
} else {
  return APPROVE;
}
```

**Cost Breakdown (10,000 messages/month):**
- Layer 1 (OpenAI): $0 (100% of messages, FREE)
- Layer 2 (Gemini + Claude): $15.49 (5% of messages = 500 messages)
- Layer 3 (Human): ~$50 (2% of messages = 200 reviews at $0.25/review)
- **Total:** $65.49/month

**Section 230 Protection Strategy:**

1. **Good Faith Moderation:** Section 230(c)(2) protects platforms that voluntarily remove objectionable content. Our 3-layer system demonstrates good faith.

2. **No Editorial Control:** We don't select which templates to promote based on viewpoint. Reputation and challenge markets are viewpoint-neutral (accuracy-based).

3. **User-Generated Content:** All templates created by users. Platform only provides infrastructure.

4. **DMCA Compliance:** Registered agent, takedown process, repeat infringer policy.

5. **Terms of Service:** Explicit prohibition of illegal content, terrorism, CSAM. Users agree to comply.

**What We CANNOT Do Under Section 230:**

- ❌ Fact-check political claims without token economics (becomes editorial judgment)
  - **Phase 1 limitation:** No challenge markets means we can't crowdsource fact-checking
  - **Phase 2 solution:** Challenge markets with economic stakes = user-driven, not platform editorial
- ❌ Remove content based on political viewpoint (loses Section 230 protection)
- ❌ Ignore CSAM reports (federal crime, mandatory reporting regardless of Section 230)
- ❌ Facilitate terrorism (material support laws apply to platforms)

**Known Risks & Mitigations:**

**Risk 1: False CSAM Flags**
- OpenAI occasionally flags non-CSAM content (e.g., medical images, art)
- Mitigation: Human review BEFORE NCMEC report for borderline cases
- Liability: Better to over-report than under-report (NCMEC handles triage)

**Risk 2: Political Speech Chilling**
- Aggressive hate speech filtering might catch heated political debate
- Mitigation: Layer 2 + 3 review for political content
- Section 230 protects removal, but user trust requires fairness

**Risk 3: Moderation Inconsistency**
- AI models update, change behavior over time
- Mitigation: Version-lock OpenAI model, benchmark Gemini/Claude quarterly
- Transparency: Publish moderation stats monthly (% flagged, appeal success rate)

**Phase 2 Enhancement: Challenge Markets for Content Moderation**

Once VOTER token launches (Phase 2):
- Users can challenge moderation decisions
- Stake tokens on "this was wrongly removed"
- Multi-model consensus re-evaluates with financial stakes
- Correct challenges refund stake + reputation boost
- Incorrect challenges lose stake → funds human moderator training

This creates economic accountability for moderation quality without sacrificing Section 230 protection (user-driven challenges, not platform editorial).

-----

## Economic Mechanisms (Phase 2 - Future)

**IMPORTANT: These features are NOT included in Phase 1 launch.**

Phase 1 focuses on cryptographic infrastructure and reputation-only system. Token economics (VOTER token, challenge markets, outcome markets, treasury agents) launch 12-18 months post-Phase 1 after proving civic utility and establishing legal/regulatory compliance.

**Why Phase 2:**
- Token launches require CLARITY Act compliance, liquidity infrastructure, economic security audits
- Challenge markets need sufficient user base for liquidity (can't arbitrate with 1K users)
- Outcome markets require legislative track record to verify impact correlation
- Multi-agent treasury needs historical data for calibration

**Phase 1 provides:**
- Reputation system (domain-specific scores, time-decay, portable via ERC-8004)
- Proof-of-concept civic infrastructure (templates, verified messaging, congressional delivery)
- User base growth (bootstrap network effects before adding financial layer)

### Challenge Markets

**Problem:** Prevent misinformation without centralized fact-checkers.

**Phase 2 Implementation:**
- **Claim types:** Only objective, verifiable facts (voting records, bill text, policy outcomes)
  - NOT opinions or personal experiences
  - Example challengeable: "Senator X voted for Y bill" (public record)
  - Example non-challengeable: "My healthcare costs are too high" (personal experience)
- **Staking:** Quadratic formula prevents plutocracy
  - Influence = sqrt(stake_amount)
  - 1 person staking $1,000 → influence = sqrt(1000) ≈ 31.6
  - 100 people staking $10 each → influence = 100 * sqrt(10) ≈ 316.2
  - The many outweigh the wealthy
- **Adjudication:** [Multi-model AI consensus](https://link.springer.com/article/10.1007/s44336-024-00009-2)
  - Models: GPT-5, Claude Opus, Gemini Pro, Grok, Mistral Large, Command R
  - Each evaluates evidence independently
  - 67% consensus required (4 of 6 models minimum)
  - If models disagree significantly, escalate to human arbitration DAO

**Smart contract logic:**
```solidity
contract ChallengeMarket {
    struct Challenge {
        bytes32 claimId;
        address challenger;
        uint256 challengeStake;
        address[] supporters;
        uint256[] supportStakes;
        bool resolved;
        bool claimValid;
    }

    function createChallenge(
        bytes32 claimId,
        bytes calldata evidence
    ) external payable {
        require(msg.value >= MIN_CHALLENGE_STAKE, "Insufficient stake");

        Challenge storage c = challenges[claimId];
        c.challenger = msg.sender;
        c.challengeStake = msg.value;

        // Emit event for off-chain AI consensus
        emit ChallengeCreated(claimId, evidence);
    }

    function resolveChallenge(
        bytes32 challengeId,
        bool claimValid,
        bytes calldata consensusProof  // Signed by multi-agent system
    ) external onlyAgentOracle {
        Challenge storage c = challenges[challengeId];
        require(!c.resolved, "Already resolved");

        c.resolved = true;
        c.claimValid = claimValid;

        if (!claimValid) {
            // Claim was false, challenger wins
            // Distribute original claimer's stake to challenger + supporters (quadratic weighting)
            distributeRewards(c, quadraticWeights(c));

            // Slash claimer reputation
            reputationRegistry.updateReputation(claimer, domain, -1000, proof);
        } else {
            // Claim was valid, challenger loses stake
            // Return to claim creator
            claimCreator.transfer(c.challengeStake);

            // Slash challenger reputation
            reputationRegistry.updateReputation(c.challenger, domain, -500, proof);
        }
    }
}
```

**Sybil resistance:**
- Challenge stake amount weighted by reputation
- Low-reputation actors must stake more for same influence
- Prevents farming via new wallets

### Outcome Markets

**Problem:** Create financial instruments for political outcomes without running afoul of CFTC/SEC.

**Implementation:**
- **Market structure:** Binary prediction markets on legislative outcomes
  - "Will H.R. 3337 pass House committee with Section 4(b) intact by Q4 2025?"
  - "Will Austin City Council pass 4-day work week ordinance before Dec 2025?"
- **Not betting:** Retroactive funding mechanism
  - Stake on outcome
  - When outcome resolves, percentage of pool retroactively funds civic infrastructure that contributed
  - Template creators whose arguments were adopted
  - Constituents who sent verified messages
  - Organizers who coordinated campaigns
- **Continuous evaluation:** Multi-agent consensus determines contribution weights
  - ImpactAgent tracks temporal correlation (template sends → bill introduction)
  - Geographic clustering (high constituent density in relevant districts)
  - Legislative language similarity (embeddings compare template text to bill text)
  - Confidence scoring (only >80% confidence triggers payouts)

**Market contract:**
```solidity
contract OutcomeMarket {
    struct Market {
        string question;
        uint256 deadline;
        uint256 yesPool;
        uint256 noPool;
        mapping(address => uint256) yesStakes;
        mapping(address => uint256) noStakes;
        bool resolved;
        bool outcome;
    }

    function stake(uint256 marketId, bool predictYes) external payable {
        Market storage m = markets[marketId];
        require(block.timestamp < m.deadline, "Market closed");

        if (predictYes) {
            m.yesPool += msg.value;
            m.yesStakes[msg.sender] += msg.value;
        } else {
            m.noPool += msg.value;
            m.noStakes[msg.sender] += msg.value;
        }
    }

    function resolveMarket(
        uint256 marketId,
        bool outcome,
        address[] calldata contributors,  // Wallets that contributed to outcome
        uint256[] calldata contributionScores,  // Impact weights
        bytes calldata agentProof
    ) external onlyAgentOracle {
        Market storage m = markets[marketId];
        require(!m.resolved && block.timestamp >= m.deadline, "Cannot resolve");

        m.resolved = true;
        m.outcome = outcome;

        uint256 winningPool = outcome ? m.yesPool : m.noPool;
        uint256 losingPool = outcome ? m.noPool : m.yesPool;

        // 20% of losing pool goes to retroactive funding
        uint256 retroactivePool = losingPool * 20 / 100;

        // Distribute to contributors based on impact scores
        for (uint i = 0; i < contributors.length; i++) {
            uint256 share = (retroactivePool * contributionScores[i]) / totalScore;
            payable(contributors[i]).transfer(share);
        }

        // Remaining 80% of losing pool distributed to winners proportionally
        // (standard prediction market payout)
    }
}
```

**Regulatory compliance:**
- Markets structured as prediction markets (existing CFTC framework)
- Retroactive funding component is ex-post rewards for civic labor (not inducement)
- No direct payments to politicians (all funding goes to civic infrastructure and participants)
- KYC for large stakes (>$10k) to prevent money laundering

### Multi-Agent Treasury Management

**Problem:** Static reward rates cause death spirals when market conditions change rapidly (Terra/Luna failure mode).

**Implementation:** 5 specialized agents with deterministic workflows (NOT raw LLM inference).

**Agent 1: SupplyAgent (30% consensus weight)**
- **Role:** Adjust per-action rewards based on treasury runway and participation volume
- **Inputs:**
  - Current treasury balance (on-chain)
  - Participation rate (7-day, 30-day moving averages)
  - Token price oracle (Chainlink aggregated)
- **Logic:**
  ```python
  def calculate_reward_adjustment(treasury_balance, daily_burn_rate, participation_spike):
      runway_days = treasury_balance / daily_burn_rate

      # If runway < 90 days, reduce rewards
      if runway_days < 90:
          adjustment = 0.5  # 50% reduction
      elif runway_days < 180:
          adjustment = 0.75
      else:
          adjustment = 1.0

      # If participation spike, reduce per-action rewards to prevent dilution
      if participation_spike > 10x_average:
          adjustment *= (10 / participation_spike)

      return base_reward * adjustment
  ```
- **Output:** New reward rate per action (bounded: 500 VOTER min, 5000 VOTER max)

**Agent 2: MarketAgent (30% consensus weight)**
- **Role:** Monitor token volatility during extreme price movements
- **Inputs:**
  - 1-hour, 24-hour price volatility
  - Trading volume
  - Liquidity depth
- **Logic:** During >30% price swings in 24h, propose temporary reward holds or liquidity additions
- **Output:** Volatility risk score, recommended liquidity injection amounts

**Agent 3: ImpactAgent (20% consensus weight)**
- **Role:** Verify which templates actually changed legislative outcomes, trigger reward multipliers
- **Inputs:**
  - Template send dates + congressional districts
  - Bill introduction dates + sponsors
  - Legislative text (via congress.gov API)
  - Topic embeddings (semantic similarity)
- **Logic:**
  ```python
  def verify_impact(template, bill):
      # Temporal correlation
      time_delta = bill.introduction_date - template.send_dates.median()
      if time_delta < 0 or time_delta > 30_days:
          return 0.0  # Too early or too late

      # Geographic clustering
      constituent_districts = template.sender_districts
      sponsor_districts = bill.sponsor_districts
      overlap = len(set(constituent_districts) & set(sponsor_districts))
      geo_score = overlap / len(sponsor_districts)

      # Semantic similarity
      embedding_similarity = cosine_similarity(
          embed(template.text),
          embed(bill.text)
      )

      # Confidence score
      confidence = (geo_score * 0.4) + (embedding_similarity * 0.6)

      return confidence if time_delta.days < 14 else confidence * 0.5
  ```
- **Output:** Impact confidence score (0-1), multiplier recommendations

**Agent 4: ReputationAgent (20% consensus weight)**
- **Role:** Calculate credibility scores across challenge accuracy, template quality, civic consistency
- **Inputs:**
  - Challenge market outcomes (win/loss record)
  - Template adoption rates
  - Participation consistency (time-series)
- **Logic:** Domain-specific scoring with decay curves
- **Output:** Reputation delta recommendations per wallet per domain

**Agent 5: VerificationAgent (0% consensus weight, pre-consensus validation)**
- **Role:** Validate actions before consensus considers them
- **Inputs:**
  - ZK proofs of district membership
  - TEE attestation reports
  - Delivery receipts from congressional systems
- **Logic:** Cryptographic verification only - no subjective judgments
- **Output:** Boolean valid/invalid per action

**Consensus mechanism:**
```python
def execute_decision(agents_votes):
    # Weighted voting
    total_weight = sum(agent.weight * agent.vote for agent in agents_votes)

    # Require 3+ agents agree (prevents single agent control)
    agreeing_agents = [a for a in agents_votes if a.vote == majority_vote]
    if len(agreeing_agents) < 3:
        return DEFER  # Keep current parameters, escalate to human governance

    # Check total weight exceeds 60% threshold
    if total_weight >= 0.6:
        return EXECUTE
    else:
        return DEFER
```

**Audit transparency:**
- Every agent decision recorded on-chain
- IPFS hash of full context (inputs, reasoning, outputs)
- Community can replay inputs through public agent logic, compare outputs
- Discrepancies flagged → agent reputation decay → consensus weight reduction

**Why deterministic workflows instead of raw LLMs:**
- LLMs are non-deterministic (same inputs ≠ same outputs)
- Financial decisions require reproducibility
- Adversarial testing requires fixed logic
- Agents execute bounded computation on observable data, not "vibes"

-----

## Phase 1 Infrastructure Costs

**Budget transparency for 1,000 users / 10,000 messages monthly:**

### Fixed Costs

**GCP Confidential Space (TEE):**
- **Cost:** $150/month (minimum viable TEE instance)
- **Instance:** n2d-standard-2 (AMD SEV-SNP, 2 vCPU, 8GB RAM)
- **Purpose:** E2E message encryption, plaintext only in hardware-attested enclave
- **Non-negotiable:** Congressional delivery requires TEE for PII protection
- **Scaling:** Vertical scaling to n2d-standard-4 ($300/mo) supports 5K users

**Database & Hosting:**
- **Cost:** $0 (free tiers)
- **Supabase:** Free tier (500MB database, 2GB bandwidth, sufficient for Phase 1)
- **Vercel/Netlify:** Free tier (frontend hosting)
- **Note:** Scales to $25/mo paid tier at ~3K users

**Total Fixed:** $150/month

### Variable Costs (Per-User Onboarding)

**Identity Verification:**
- **self.xyz:** $0 (FREE NFC passport scanning)
- **Didit.me:** $0 (FREE Core KYC tier for non-passport users)
- **Mix:** 70% self.xyz (FREE) + 30% Didit.me (FREE) = $0 average

**GKR Proof Generation:**
- **Cost:** $0 (client-side in browser, user's CPU)
- **Gas cost:** ~$0.01 per proof verification on Scroll L2 (platform pays)
- **Onboarding total:** 1,000 users × $0.01 = $10

**Total Variable (Onboarding):** $10/month

### Variable Costs (Content Moderation)

**Layer 1: OpenAI Moderation API**
- **Cost:** $0 (FREE, unlimited)
- **Volume:** 10,000 messages/month (100% pass through Layer 1)
- **Cost:** $0

**Layer 2: Gemini 2.5 Flash-Lite + Claude Haiku 4.5**
- **Volume:** 500 messages/month (5% escalation from Layer 1)
- **Gemini cost:** 500 messages × 300 tokens avg × ($0.10 input + $0.40 output) / 1M = $0.08
- **Claude cost:** 500 messages × 300 tokens avg × ($1.00 input + $5.00 output) / 1M = $0.90
- **Total Layer 2:** $0.98/month

**Layer 3: Human Review**
- **Volume:** 200 messages/month (2% escalation rate)
- **Cost:** 200 reviews × $0.25/review = $50/month
- **Notes:** Contract moderators, trained on Section 230 compliance

**Total Moderation:** $50.98/month (~$51/month)

### Variable Costs (Blockchain Transactions)

**Scroll L2 Transactions:**
- **District verification:** 1,000 users × $0.01 = $10
- **Reputation updates:** 500 actions × $0.01 = $5
- **Message delivery receipts:** 10,000 messages × $0.01 = $100

**Total Blockchain:** $115/month

**Note:** Platform pays all gas fees. Users see zero transaction costs.

### Monthly Total (1,000 users / 10,000 messages)

```
Fixed Costs:
  GCP Confidential Space:        $150.00
  Database/Hosting:              $  0.00
                                 --------
  Subtotal Fixed:                $150.00

Variable Costs:
  Identity verification:         $ 10.00
  Content moderation:            $ 51.00
  Blockchain transactions:       $115.00
                                 --------
  Subtotal Variable:             $176.00

TOTAL MONTHLY:                   $326.00
```

**Per-User Cost:** $0.33/user/month
**Per-Message Cost:** $0.03/message

### Scaling Economics

**At 10,000 users / 100,000 messages:**
- Fixed: $300 (TEE upgrade to n2d-standard-4)
- Variable: $1,760 (linear scaling)
- Total: $2,060/month ($0.21/user, $0.02/message)

**At 100,000 users / 1,000,000 messages:**
- Fixed: $600 (TEE upgrade + load balancing)
- Variable: $17,600
- Total: $18,200/month ($0.18/user, $0.018/message)

**Economies of scale:** Per-user cost decreases as fixed TEE cost amortizes across larger user base.

### What This Buys

**Phase 1 delivers:**
- Zero-knowledge district proofs (GKR, no trusted setup)
- E2E encrypted congressional delivery (TEE with hardware attestation)
- 3-layer content moderation (Section 230 compliant)
- Cross-chain reputation (ERC-8004 portable)
- FREE identity verification (self.xyz + Didit.me)
- Zero gas fees for users (platform subsidizes)

**What Phase 1 does NOT include:**
- VOTER token (Phase 2)
- Challenge markets (Phase 2)
- Outcome markets (Phase 2)
- Token rewards (Phase 2)
- Multi-agent treasury (Phase 2)

**Budget runway (assuming $50K initial funding):**
- Month 1: 1,000 users → $326 spend → 153 months runway
- Month 3: 3,000 users → $700 spend → 71 months runway
- Month 6: 10,000 users → $2,060 spend → 24 months runway
- Month 12: 50,000 users → $9,500 spend → 5 months runway (fundraise or revenue)

**Revenue options (Phase 1+):**
- Premium congressional dashboard for offices ($500/mo per office, 50 offices = $25K/mo)
- White-label licensing for advocacy orgs ($10K/year per org, 10 orgs = $100K/year)
- API access for civic tech platforms ($1K/mo per integration, 20 integrations = $20K/mo)

Phase 1 infrastructure costs are viable for bootstrapped launch. Revenue options become available once congressional adoption proves value.

-----

## Security Model

### Threat Vectors and Mitigations

**Sybil Attacks (Multiple Fake Identities)**
- **Threat:** Create multiple wallets to inflate message counts, manipulate reputation scores
- **Mitigation:**
  - **Identity verification:** [self.xyz](https://www.self.xyz) NFC passport scan (primary, FREE) or [Didit.me](https://www.didit.me) Core KYC (fallback for non-passport users, FREE)
    - self.xyz: Government-issued passport with NFC chip, Face ID liveness check, ~60 seconds
    - Didit.me: Photo ID + selfie + liveness detection for users without NFC passports
    - Both methods: One identity = one verified account, cryptographically enforced
  - **Rate limits per verified identity:**
    - 10 templates sent/day (prevents spam)
    - 3 templates created/day (prevents low-quality flooding)
    - 5 reputation updates/day (prevents gaming)
  - **Unverified wallets:**
    - Phase 1: Can participate but earn zero reputation (read-only credibility)
    - Phase 2: Earn 50% token rewards (makes Sybil farming uneconomical)
    - Congressional offices can filter for "verified only" (default setting)
  - **Reputation decay:** Inactive verified accounts lose reputation over time (prevents identity squatting)

**Grinding/Arbitrage (Template Quality Farming)**
- **Threat:** Generate plausible-sounding templates with AI, farm rewards
- **Mitigation:**
  - Network effect rewards only kick in when others adopt (low-quality templates get ignored)
  - Challenge markets allow anyone to stake against suspicious claims
  - ImpactAgent only triggers multipliers for legislative correlation (AI-generated garbage won't influence bills)
  - Reputation decay for templates never adopted

**Collusion (Coordinated False Challenges)**
- **Threat:** Groups coordinate to challenge accurate claims, win through volume
- **Mitigation:**
  - Quadratic staking makes coordination expensive
  - Diverse AI models prevent human-coordinated manipulation (need to fool 4+ architecturally different models)
  - Reputation at stake (lose challenges → reputation slashed → future influence reduced)
  - Economic cost (lose stake when claim proves valid)

**Oracle Manipulation (Feed False Data to Agents)**
- **Threat:** Manipulate agent inputs to trigger favorable decisions
- **Mitigation:**
  - Multiple independent oracles (Chainlink + Band + custom congress.gov scrapers)
  - Agents cross-reference data sources
  - Outlier detection (if 1 oracle shows 50% price change, others show 2%, ignore outlier)
  - On-chain proof of oracle data source + signatures

**TEE Compromise (Break Confidential Computing)**
- **Threat:** Exploit AMD SEV-SNP vulnerability to read plaintext
- **Mitigation:**
  - Attestation verification before accepting encrypted blobs
  - Regular enclave updates as AMD patches vulnerabilities
  - Researching self-hosted TEEs and fully homomorphic encryption as alternatives
  - Even if TEE compromised: only one message batch exposed, not historical database
  - [Privacy pools](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4563364) (Buterin et al. 2023, [launched 2025](https://vitalik.eth.limo/general/2025/10/19/gkr.html)) offer shielded transactions without TEE dependency

**Smart Contract Exploits**
- **Threat:** Reentrancy, overflow, governance attacks
- **Mitigation:**
  - OpenZeppelin battle-tested libraries
  - Multi-sig treasury control (5-of-9 signers, geographically distributed)
  - Timelock on governance changes (72-hour delay before execution)
  - Formal verification for critical contracts (challenge markets, reputation registry)
  - Bug bounty program (up to $500k for critical vulnerabilities)

**Agent Adversarial Manipulation**
- **Threat:** Craft inputs that trick agents into bad decisions
- **Mitigation:**
  - Bounded constraints on all agent outputs (rewards can't exceed 5000 VOTER)
  - Multi-agent consensus (requires 3+ agreeing)
  - Human governance override within 24 hours of suspicious decisions
  - Agent reputation decay if community flags bad decisions
  - Deterministic logic allows community to audit and identify exploits

-----

## Performance Specifications

**Client-Side Proof Generation (GKR via Polyhedra Expander):**
- **Hardware:** Commodity laptop/smartphone (2020+ models)
- **Target compute time:** 8-10 seconds (GKR proof + Fiat-Shamir transformation, WASM)
  - Make-or-break threshold: <10s acceptable, >15s triggers Groth16 pivot
  - Month 1-2 benchmarks determine viability
- **Memory:** <500MB peak (similar to Groth16)
- **Battery impact:** ~1-2% on mobile (slightly higher than Groth16, acceptable)
- **Proof size:** 2-4KB (larger than Groth16's 256 bytes, but network overhead negligible)

**On-Chain Verification (GKR):**
- **Target gas cost:** 200-250k gas to verify GKR proof on Scroll L2
  - Groth16 baseline: ~150k gas
  - GKR overhead: +50-100k gas (sumcheck protocol verification)
  - At 0.1 gwei gas price: ~$0.025 per verification (acceptable)
  - **Critical threshold:** Must be <250k gas, or pivot to Groth16
  - Platform pays all gas (users see zero transaction costs)
- **Latency:** Block confirmation ~2 seconds (Scroll L2, unchanged)

**Message Delivery:**
- **Encryption:** XChaCha20-Poly1305 (libsodium), <50ms
- **TEE processing:** 200-500ms (decrypt + deliver to CWC)
- **CWC delivery:** 1-3 seconds (congressional API)
- **Total end-to-end:** ~5 seconds (proof already generated)

**Reputation Calculation (Phase 1):**
- **Off-chain computation:** Template adoption tracking, domain-specific scoring
- **Latency:** 1-2 seconds (no multi-agent consensus in Phase 1)
- **On-chain update:** Single transaction writes reputation delta
- **User sees:** "Updating reputation..." for ~2 seconds, then score updates
- **Phase 2 addition:** Multi-agent consensus for token rewards (2-5s latency)

**Scalability:**
- **Phase 1 target:** 10k daily active users
- **Phase 2 target:** 100k daily active users
- **Long-term target:** 1M daily active users
- **Bottleneck:** Scroll L2 throughput (4000 TPS theoretical)
- **Mitigation:** Batch proof verifications (single transaction verifies 100 GKR proofs)
  - Gas savings: 100 individual txs at 250k gas = 25M gas
  - Batched: 1 tx at ~5M gas (80% reduction)
  - Enables scaling to 1M+ users without L2 congestion

-----

## Integration Guide

**For wallets/interfaces:**
```typescript
import { VOTERClient } from '@voter-protocol/sdk';

const client = new VOTERClient({
  network: 'scroll-mainnet',
  walletProvider: window.ethereum
});

// Generate district proof
const proof = await client.generateDistrictProof({
  address: userAddress,
  district: 'TX-18'
});

// Submit action
const tx = await client.submitTemplate({
  templateId: '0xabc...',
  customization: 'My personal story...',
  proof: proof
});

// Check reputation
const rep = await client.getReputation(wallet, 'healthcare');
```

**For congressional offices:**
```typescript
import { CongressionalDashboard } from '@voter-protocol/congressional-sdk';

const dashboard = new CongressionalDashboard({
  officeId: 'TX-18',
  apiKey: process.env.CONGRESSIONAL_API_KEY
});

// Fetch verified messages
const messages = await dashboard.getMessages({
  minReputation: 5000,
  domain: 'healthcare',
  verifiedOnly: true
});

// Each message includes:
// - district: 'TX-18' (verified via ZK proof)
// - reputation: 8500 (on-chain score)
// - challengeStatus: 'survived 3 challenges'
// - impactHistory: 'previous templates correlated with 2 bills'
```

-----

## Contributing

Protocol is open-source. Contributions welcome across:

- **Cryptography:** SNARK circuit optimization, FHE research
- **Smart contracts:** Scroll L2 optimizations, gas reduction
- **Agent infrastructure:** Multi-agent consensus improvements
- **Security:** Audits, adversarial testing, formal verification

See CONTRIBUTING.md for guidelines.

**Bug bounties:**
- Critical: $100k - $500k (treasury drain, privacy break)
- High: $10k - $50k (reputation manipulation, oracle exploits)
- Medium: $1k - $10k (DoS, gas griefing)

-----

*Technical questions: [email protected]*
