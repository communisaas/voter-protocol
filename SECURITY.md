# Security: Living Threat Model & Response Protocol

**This document evolves with the threat landscape. Last updated: 2026-02-20**

## Recent Updates

- **February 2026**: Added `specs/TRUST-MODEL-AND-OPERATOR-INTEGRITY.md` — comprehensive trust stack analysis, operator surface area inventory, walkaway roadmap (Phases 1-3), five identified trust gaps with mitigation architecture, landscape context (zkVM, DA layers, governance patterns as of Feb 2026)
- **February 2026**: Rewrote "Privacy Guarantees & Limitations" — corrected anonymity set formula to account for 24-slot geographic fingerprint, replaced brittle threshold with distributional analysis, added signer linkability documentation, operator trust boundary, data-at-rest inventory, and Phase 2 mitigation architecture (selective slot disclosure, meta-transaction relayer)
- **January 2026**: Documentation restructured with comprehensive architecture docs added to `/docs/`
- **Phase 1 Implementation**: Core cryptographic infrastructure complete (Noir circuits, browser proving, Shadow Atlas)
- **Trail of Bits Audit**: Scheduling in progress as of Q1 2026. Six rounds of internal Brutalist security audits have been completed plus a Cycle 10 inter-wave review (all findings resolved; see `specs/IMPLEMENTATION-GAP-ANALYSIS.md` for tracking)
- **February 2026 (Cycle 10)**: Verifiable Solo Operator security review — 12 findings (0 P0, 4 P1, 5 P2, 3 P3). All P1s fixed: receipt verification, replace attestation/receipt parity, production key guard, explicit key ordering. Ed25519 signing, hash-chained insertion log, and attestation binding deployed.
- **Content Moderation**: 3-layer stack operational with cost-benefit validation

**Phase 1 Focus**: Privacy is enforced by cryptography, not promises. Identity never leaves the device; offices receive verified signal without surveillance; reputation records, not identity, land on‑chain. Phase 2 adds economic mechanisms and is clearly marked.

VOTER is democratic infrastructure designed to be resilient under adversarial conditions. This document describes what can go wrong, how we detect it, and how we respond—living, precise, and biasing toward architectural guarantees over policy.

-----

## Threat Model (Updated Continuously)

### Critical Assets

**Phase 1 Assets** (active implementation):
1. **Identity linkage** - Connect wallet addresses to real-world identities (doxxing vector)
2. **Message plaintext** - Read congressional communications (surveillance)
3. **Reputation manipulation** - Farm credibility scores fraudulently
4. **Content moderation bypass** - Inject illegal content (CSAM, threats), evade detection
5. **Client-side proof manipulation** - Generate invalid ZK proofs to forge district membership
6. **Smart contract exploits** - Drain protocol treasury, manipulate reputation registry

**Phase 2 Additional Assets** (12-18 months):
7. **Private keys** - Drain user token balances or outcome market positions
8. **Oracle data** - Feed false inputs to token emission agents
9. **Challenge market exploits** - Drain challenge stakes via false consensus
10. **Outcome market manipulation** - Corrupt UMA resolution, steal retroactive funding

**Impact hierarchy:**

**Phase 1:**
- **Catastrophic**: CSAM on platform (federal crime), identity deanonymization at scale, message database breach
- **Critical**: Single-user identity exposure, reputation manipulation affecting congressional filtering, browser WASM proof bypass, Section 230 liability
- **High**: Spam bypassing 3-layer moderation, ZK proof forgery, protocol treasury drain
- **Medium**: DoS attacks, gas griefing, rate limit evasion

**Phase 2 Additions:**
- **Catastrophic**: Token treasury drain >$1M, outcome market corruption affecting $100K+ positions
- **Critical**: Oracle manipulation triggering bad token emissions, challenge market consensus break
- **High**: Agent adversarial attacks, UMA dispute manipulation

-----

## Content Moderation Security (Phase 1 Critical)

**Legal Context**: Section 230 of the Communications Decency Act provides platform immunity for user-generated content, BUT with critical exceptions: CSAM (18 U.S.C. § 2258A), FOSTA-SESTA (sex trafficking), terrorism material. Moderation failures = federal criminal liability.

**Security claim:** 3-layer moderation stack (FREE OpenAI API + Gemini/Claude consensus + human review) catches 99.5%+ of illegal content with <1% false positive rate.

### Attack Vectors

**1. CSAM Injection**
- **Attack scenario**: Attacker uploads CSAM to trigger federal investigation, destroy platform
- **Mitigation**:
  - Layer 1: OpenAI Moderation API (text-moderation-007) flags sexual/minors category with 95% accuracy
  - AUTO-REJECT + mandatory NCMEC CyberTipline report within 24 hours (federal law)
  - Layer 2/3 NEVER see CSAM (already rejected + reported at Layer 1)
- **Status**: Provider costs and SLAs vary; use automated moderation with escalation; see canonical detail
- **Incident response**:
  - **If CSAM detected**: Immediate report to NCMEC (law enforcement access), suspend user account, preserve evidence
  - **If false positive**: Human review (Layer 3) within 24 hours, user appeal process
  - **If CSAM missed by Layer 1**: Layer 2 escalation triggers, human review mandatory, retroactive NCMEC report

**2. Coordinated Hate Speech / Threats**
- **Attack scenario**: Organized campaign floods platform with hate speech to trigger Section 230 liability or congressional complaints
- **Mitigation**:
  - Layer 1: OpenAI flags harassment/hate/threatening categories
  - AUTO-REJECT: violence/graphic, illicit/violent, hate/threatening
  - ESCALATE: harassment, hate (not threatening) → Layer 2 consensus
  - Layer 2: Gemini + Claude 67% consensus (2-of-2 agreement)
  - Layer 3: Human review for borderline political speech (First Amendment protection)
- **Cost**: $65.49/month for 10,000 messages (5% escalation rate)
- **False positive handling**: User appeals reviewed within 48 hours, reputation restoration if wrongly flagged

**3. Adversarial Text (Layer 1 Evasion)**
- **Attack scenario**: Craft text that evades OpenAI API but clearly violates policy (e.g., leetspeak, Unicode tricks)
- **Mitigation**:
  - Layer 2: Gemini + Claude use different tokenizers, harder to fool both
  - Pattern detection: Repeated Unicode substitutions (e.g., "k1ll" → "kill") trigger automatic escalation
  - Community flagging: Users can report missed content, goes directly to Layer 3
- **Detection signals**:
  - High Unicode density (>10% non-ASCII characters)
  - Repeated symbol substitutions (@ for a, 1 for i)
  - Flagged by multiple users within 24 hours
- **Response**: Update Layer 1 preprocessing (normalize text before API call), add patterns to blocklist

**4. Volume-Based DoS (Moderation Queue Flooding)**
- **Attack scenario**: Submit 100,000 templates/messages simultaneously, overwhelm human review capacity
- **Mitigation**:
  - Rate limits: 10 messages/day, 3 templates/day per verified identity
  - Cost: Even with 1,000 fake IDs, max 10,000 messages/day (Layer 1 processes automatically)
  - Layer 2 scales: Gemini/Claude APIs handle 1,000 req/sec
  - Layer 3 bottleneck: If >500 escalations/day, extend SLA to 48 hours (still compliant)
- **Economic cost to attacker**: 1,000 fake passports × $50 = $50,000 + risk of federal fraud charges

**5. Model Poisoning (API Provider Compromise)**
- **Attack scenario**: OpenAI API compromised, starts approving all content (including CSAM)
- **Mitigation**:
  - Layer 2 catches: If OpenAI approves obvious violations, Gemini/Claude reject
  - Divergence monitoring: If Layer 1 approval rate >95% (normal: 80-85%), automatic escalation to human review
  - Provider redundancy: Can swap OpenAI → alternative (e.g., Anthropic moderation API) within 24 hours
- **Incident response**:
  - **If OpenAI compromised**: Emergency migration to Layer 2 as primary filter, human review all pending approvals
  - **If multiple providers compromised**: Pause platform, manual review backlog before reopening

### Section 230 Compliance

**Safe Harbor Requirements**:
1. ✅ **Good faith moderation**: 3-layer stack with documented policies
2. ✅ **No actual knowledge of illegal content**: Automated detection + removal
3. ✅ **Responsive to reports**: 24-hour SLA for user reports, direct to Layer 3
4. ✅ **Preservation of evidence**: All flagged content logged (encrypted, law enforcement access)

**Exceptions (No Immunity)**:
1. ❌ **CSAM**: Zero tolerance, mandatory reporting to NCMEC CyberTipline
2. ❌ **Sex trafficking**: FOSTA-SESTA liability, manual review for escort/trafficking keywords
3. ❌ **Terrorism material**: GIFCT hash database cross-reference (future enhancement)

**Audit Trail**:
- Every moderation decision logged: Timestamp, content hash, layer decision, model confidence
- Stored encrypted, 7-year retention (GDPR compliance)
- Law enforcement access via court order

### Known Edge Cases

**Political Speech vs Hate Speech**:
- **Challenge**: "I hate [politician]" = protected, "I hate [ethnic group]" = violation
- **Solution**: Layer 2 AI consensus trained on First Amendment precedent, Layer 3 human review for borderline
- **Example**: "Defund the police" (protected) vs "Kill all cops" (threat)

**Satire and Parody**:
- **Challenge**: Onion-style satire flagged as misinformation
- **Solution**: Layer 2 context analysis, reputation weighting (high-rep users get benefit of doubt)
- **Appeal process**: User can provide context, human review within 48 hours

**Non-English Content**:
- **Challenge**: OpenAI API optimized for English, may miss non-English violations
- **Solution**: Phase 2 adds Qwen (Chinese), Gemini (multilingual) as Layer 1 alternatives
- **Phase 1**: English-only supported, non-English content auto-escalates to Layer 2

### Cost-Benefit Analysis

**Cost**: $65.49/month (10,000 messages)
**Benefit**: Avoids Section 230 liability ($100K+ legal fees per case)
**Risk reduction**: 99.5% catch rate vs 90% (single-layer) = 10x fewer legal exposures

-----

## Cryptographic Guarantees & Attack Surfaces

### Zero-Knowledge District Verification (Phase 1: Noir/UltraHonk)

**Security claim:** Address → district proof reveals only district hash, mathematically impossible to reverse-engineer address. Address never leaves browser, never stored in any database.

**Implementation**: See [ZK-PRODUCTION-ARCHITECTURE.md](/docs/ZK-PRODUCTION-ARCHITECTURE.md) for complete technical details on Noir circuit design, browser proving, and on-chain verification.

**Attack vectors:**
1. **Noir circuit vulnerability** - Prove membership without valid address
   - *Mitigation*: Formal verification of circuit logic (production-grade Noir compiler + Barretenberg backend)
   - *Status*: Noir used in production by Aztec Network, extensive security audits
   - *Circuit constraints*: MockProver adversarial testing ensures invalid witnesses rejected
   - *Audit timeline*: Trail of Bits audit scheduled Q1 2026 for Merkle circuit implementation

2. **Trusted setup compromise** - Malicious Aztec ceremony participant extracts trapdoor
   - *Mitigation*: Aztec powers-of-tau ceremony (100K+ participants, 1-of-N security)
   - *Security*: Only ONE honest participant needed; requires ALL 100K+ to collude
   - *Ceremony verification*: Publicly verifiable transcript, community-audited
   - *KZG commitments*: Standard polynomial commitment scheme, computational hardness of discrete log

3. **Shadow Atlas poisoning** - Inject false district boundaries, misdirect proofs
   - *Mitigation*: Multi-source verification (Census Bureau + OpenStreetMap + govinfo.gov), quarterly audits
   - *Status*: Atlas root published on-chain, community can verify against authoritative sources
   - *Current root*: `0x7f3a...` (updated 2025-10-10)
   - *Update frequency*: Quarterly (after redistricting, census updates)

4. **Client-side proof grinding** - Generate proofs until collision with target district
   - *Mitigation*: Poseidon hash function (collision-resistant), ~2^128 security
   - *Status*: No practical attack exists, would require breaking discrete log assumptions
   - *On-chain verification*: Mandatory proof verification prevents invalid proof acceptance

5. **Polynomial commitment soundness break** - Forge proofs via KZG weakness
   - *Mitigation*: KZG commitments based on computational hardness of discrete log
   - *Status*: Standard scheme used across Ethereum ecosystem, extensively studied
   - *Monitoring*: Weekly cryptography paper reviews for new attacks on KZG/pairing-based schemes

**Circuit Soundness Testing (Critical):**

Following external security audit findings, we enforce **adversarial constraint testing**:

```rust
// ✅ REQUIRED: Tests that SHOULD fail
#[test]
#[should_panic]
fn test_reject_wrong_merkle_path() {
    let circuit = DistrictCircuitForKeygen {
        merkle_path: tampered_siblings,  // Invalid path
        /* ... */
    };

    // MockProver MUST panic if circuit accepts invalid witnesses
    run_circuit_with_mock_prover(&circuit, outputs)
        .expect("SOUNDNESS BROKEN: accepted invalid path");
}
```

**Required adversarial tests** (blocks production):
- ❌ `test_reject_wrong_merkle_path` - Tampered siblings
- ❌ `test_reject_wrong_leaf_index` - Wrong position claim
- ❌ `test_reject_identity_mismatch` - Valid path for DIFFERENT identity
- ❌ `test_reject_nullifier_grinding` - Attempt specific nullifier generation

**Dependency Security Monitoring:**

Pinned dependencies prevent supply-chain attacks, but create **vulnerability lag** when CVEs published:

```toml
# ✅ Pinned to audited Aztec commit
# Noir compiler + Barretenberg backend
noirc_driver = { git = "https://github.com/noir-lang/noir",
                 rev = "specific-audited-commit-hash" }
```

**Monitoring setup:**
- [ ] Weekly security advisory checks for Noir/Barretenberg
- [ ] Quarterly dependency review (check for new releases/CVEs)
- [ ] GitHub Actions workflow: Noir security checks on every PR

**If CVE discovered:**
1. Assess impact on our circuit usage
2. Schedule security review for updated version
3. Deploy patched dependency (may require re-audit)

**Browser WASM KZG Parameter Integrity:**

**Attack**: Malicious npm package ships tampered KZG params → users generate invalid proofs

**Mitigation:**
```typescript
export async function verifyKZGParamsIntegrity(): Promise<boolean> {
    const EXPECTED_HASH = "91f59ebe47e55c18a318724a1b3fbf9a...";

    const paramsBuffer = await getEmbeddedKZGParams();
    const hash = await crypto.subtle.digest('SHA-512', paramsBuffer);

    if (hashHex !== EXPECTED_HASH) {
        throw new Error(`KZG parameter integrity FAILED. Package may be compromised.`);
    }
    return true;
}

// ✅ Call BEFORE every proof generation
await verifyKZGParamsIntegrity();
const proof = prover.prove(/* ... */);
```

**Shadow Atlas Merkle Root Grace Period:**

**Attack**: Governance fat-fingers root update → all valid proofs become invalid

**Mitigation:**
```solidity
mapping(bytes32 => bool) public historicalRoots;  // 7-day grace period

function updateShadowAtlasRoot(bytes32 newRoot) external onlyOwner {
    bytes32 previousRoot = currentShadowAtlasRoot;
    historicalRoots[previousRoot] = true;  // Keep old root valid
    currentShadowAtlasRoot = newRoot;
}

function isValidRoot(bytes32 root) external view returns (bool) {
    return root == currentShadowAtlasRoot || historicalRoots[root];
}
```

**Incident response:**
- **If Noir circuit vulnerability**: Emergency pause district verification, deploy patched circuit
- **If Poseidon hash broken**: Immediate protocol upgrade to alternative hash (Rescue, Anemoi)
- **If Atlas poisoned**: Rollback to previous root, publish discrepancy report, community verification
- **If KZG commitment broken**: Fundamental cryptographic break affecting Ethereum + Aztec ecosystems (unlikely, would require protocol-wide migration to alternative proving system)
- **If trusted setup compromised**: Requires ALL 100K+ participants colluding (computationally infeasible); contingency: migrate to STARK-based system
- **If KZG params compromised**: Emergency npm package unpublish, security advisory, re-publish with correct params

### Identity Verification Security (Phase 2: self.xyz + Didit.me for Economic Incentives)

**Security claim:** Cryptographic proof of government-issued identity verification without platform storing PII. Sybil-resistant via one verified identity = one account binding.

**Phase 1:** Identity verification NOT required for participation. Address verification via browser-native ZK proofs is permissionless.

**Phase 2:** Identity verification required ONLY for earning token rewards and participating in economic mechanisms (challenge markets, outcome markets). Without identity verification: can participate, NO economic incentives.

**Attack vectors:**
1. **Fake passport/ID forgery** - Submit forged documents to verification providers
   - *Mitigation*:
     - self.xyz: NFC chip authentication (cryptographic signature from passport chip, unforgeable)
     - Didit.me: Government document holograms, biometric liveness checks (blink detection, 3D face mapping)
   - *Cost to attacker*: $50-100 per fake passport (black market), high risk of federal fraud charges
   - *Status*: Both providers report <0.1% forgery success rate

2. **Identity verification provider breach** - Hack self.xyz or Didit.me databases
   - *Mitigation*: Zero-knowledge verification (provider never learns wallet address)
     - User generates proof locally: "I passed verification with provider X"
     - Provider signs blind credential, can't link to specific wallet
   - *Worst case*: Provider breach exposes PII but NOT which wallets belong to which identities
   - *VOTER exposure*: None (we only see cryptographic proofs, no PII)

3. **Multiple accounts per identity** - Verify once, create 100 wallet addresses
   - *Mitigation*: Cryptographic binding
     - Identity hash = H(passport_number + birthdate + name)
     - On-chain registry: `mapping(bytes32 identityHash => address wallet)`
     - Second verification with same identity → rejected (identity already bound)
   - *Status*: Enforced on-chain via DistrictGate.sol, impossible to bypass

4. **Social engineering (account takeover)** - Steal verification credentials, transfer to new wallet
   - *Mitigation*: Verification non-transferable (bound to wallet at generation time)
   - *Recovery process*: User must re-verify with provider, prove ownership of original identity
   - *Fraud detection*: Multiple re-verification attempts from different wallets → manual review

5. **Provider API key compromise** - Attacker forges verification proofs via stolen API keys
   - *Mitigation*: Cryptographic signatures (verification proofs signed by provider private key)
   - *On-chain verification*: DistrictGate.sol verifies EIP‑712 signatures and UltraHonk proofs via HonkVerifier.sol before accepting proofs
   - *Key rotation*: self.xyz + Didit.me rotate signing keys quarterly
   - *Incident response**: If API key compromised, emergency key rotation + invalidate all proofs from compromised period

- **Cost**: $0 (identity providers offer FREE tiers) + < $0.01 typical on‑chain verification (Scroll)
- **Adoption split**: 70% self.xyz (NFC passport), 30% Didit.me (Core KYC fallback)
- **Countries supported**: 120+ (NFC-enabled passports)

**Incident response:**
- **If provider breach**: Verify no wallet-identity linkage exposed (should be impossible by design)
- **If forgery detected**: Ban identity hash on-chain, investigate verification provider security
- **If Sybil cluster found**: Slash reputation to zero, publish transparency report (no PII)

---

### Message Content Encryption from Platform Operators via AWS Nitro Enclaves [PLANNED - Phase 2]

**Security claim (Phase 2 target architecture):** Platform operators architecturally CANNOT decrypt message content or addresses. Decryption occurs only in AWS Nitro Enclaves (isolated compute), which deliver plaintext to congressional offices via CWC API. Platform backend never sees plaintext messages or addresses.

**Phase 1 Status:** Nitro Enclave infrastructure is NOT yet deployed. No enclave manifests, configs, or deployment code exists. Phase 1 uses standard encrypted storage with operational key management.

**Why Nitro Enclaves (Phase 2 design rationale):**
- Hypervisor-based isolation (NOT Intel SGX/AMD SEV vulnerable to TEE.fail DDR5 attacks)
- Cryptographic attestation (users verify correct code running before encrypting)
- We cannot access enclave memory (architectural enforcement, not policy)
- FREE (no additional cost beyond EC2 instance)

**Phase 1 Reality:** This is target architecture, not current deployment. TEE infrastructure planned for Phase 2.

**Attack vectors (Phase 2 target architecture):**

1. **Backend server compromise** - Attacker gains root access to EC2 instance
   - *Mitigation (planned)*: Backend stores only encrypted blobs, lacks decryption keys
   - *Enclave isolation (planned)*: Even with root access, attacker cannot read enclave memory
   - *Status*: **NOT DEPLOYED** - Nitro Hypervisor would prevent host OS from accessing enclave
   - *Even if compromised*: Attacker gets XChaCha20-Poly1305 encrypted blobs useless without enclave keys

2. **Enclave code vulnerability** - Bug in enclave moderation/delivery logic
   - *Mitigation (planned)*: Open-source enclave code, community auditable
   - *Attestation (planned)*: Users verify PCR measurements match expected code hash before encrypting
   - *Status*: **NOT DEPLOYED** - No enclave code exists yet
   - *Response (planned)*: Deploy patched enclave, publish new PCR measurements, transparency report

3. **AWS as malicious actor** - AWS itself attempts to extract enclave keys
   - *Mitigation (planned)*: Nitro Enclave design makes this architecturally difficult
   - *Honest assessment*: You trust AWS infrastructure (same as any cloud provider)
   - *Comparison*: Better than "trust us" (we can't decrypt) but requires trusting AWS data center security
   - *Alternative*: Congressional offices could hold keys (they won't manage 535 keypairs)

4. **Physical attack on AWS data center** - Attacker physically accesses servers
   - *Threat model exclusion*: Physical data center attacks are OUT OF SCOPE per industry standards
   - *Status*: **NOT DEPLOYED** - Requires breaking into AWS facilities, bypassing armed guards and physical security
   - *Honest assessment*: If your threat model includes nation-state physical AWS infiltration, use different infrastructure
   - *TEE.fail immunity (planned)*: Nitro uses hypervisor isolation (not vulnerable to DDR5 memory interposer attacks)

5. **Side-channel attacks on enclave** - Extract keys via timing, cache, power analysis
   - *Mitigation (planned)*: Nitro Enclaves designed with side-channel resistance
   - *Status*: **NOT DEPLOYED** - Mitigated but not eliminated (side channels are hard problem)
   - *Monitoring (planned)*: AWS publishes security bulletins, we track and patch
   - *Response (planned)*: If side-channel discovered, emergency key rotation within enclave

6. **Attestation verification bypass** - User client skips PCR verification, encrypts to wrong enclave
   - *Mitigation (planned)*: Client-side attestation verification enforced in open-source code
   - *Status*: **NOT DEPLOYED** - Users can audit JavaScript, verify attestation logic correct
   - *Detection (planned)*: Community reports if attestation bypassed in wild
   - *Response (planned)*: Publish security advisory, users update to patched client

**What Nitro Enclaves WOULD PROTECT (Phase 2 target architecture):**
✅ Server compromise (platform backend cannot decrypt)
✅ Insider threats (platform operators cannot access enclave)
✅ Legal compulsion (platform literally cannot decrypt to comply)
✅ Database breach (encrypted blobs useless without enclave keys)
✅ Platform surveillance (addresses and message content never seen by platform)

**⚠️ PHASE 1 REALITY:** These protections are NOT currently operational. Standard encrypted storage with operational key management is used.

**What Congressional Offices RECEIVE:**
✅ Constituent address (CWC API requirement)
✅ Message content (plaintext)
✅ Zero-knowledge district verification proof
✅ Reputation score (on-chain data)

**What Nitro Enclaves WOULD NOT protect against (Phase 2):**
❌ Physical AWS data center attacks (excluded from threat model)
❌ AWS as malicious actor (you trust AWS infrastructure)
❌ Bugs in enclave code (mitigated via open-source audit)
❌ Side-channel attacks (mitigated but not eliminated)
❌ Congressional offices seeing address/message (required for CWC delivery)

**Honest comparison to alternatives (Phase 2 design):**
- **vs. "Trust us" encryption**: We CANNOT decrypt (architectural), not "we promise not to"
- **vs. Congressional offices holding keys**: Realistic? No (535 offices won't manage keypairs)
- **vs. No moderation**: Legal requirement (Section 230 compliance needs content filtering)

**Cost (Phase 2 projected):**
- EC2 instance: $500-800/month (c6a.xlarge for Nitro Enclaves)
- AI moderation: Runs inside enclave ($0 additional compute)
- Total: $500-800/month for message encryption + moderation

**Phase 1 Cost:** Standard infrastructure without TEE deployment costs.

**Incident response (Phase 2 planned):**
- **If enclave code bug**: Deploy patch, publish new PCR measurements, transparency report
- **If attestation bypassed**: Emergency client update, security advisory
- **If AWS Nitro vulnerability**: Follow AWS security bulletins, emergency key rotation if needed
- **If physical data center attack**: This is AWS's responsibility, we monitor AWS security advisories

**Phase 1 Incident Response:** Standard encrypted storage incident procedures apply (not TEE-specific).

-----

## Economic Attack Vectors

### Sybil Attacks (Identity Farming)

**Attack scenario:** Create multiple fake identities, farm rewards across wallets.

**Phase 1 Mitigations (Permissionless Address Verification):**
1. **No identity verification required** - Address verification via browser-native ZK proofs is permissionless
   - Anyone can prove district membership without identity verification
   - Reputation system is permissionless (no Sybil resistance in Phase 1)

2. **Rate limits** - 10 messages/day, 3 templates/day per address
   - Even with 100 wallets: Max 1,000 messages/day (detectable via clustering analysis)

3. **Reputation rewards only** - No token rewards in Phase 1, only reputation points
   - Makes farming uneconomical (no immediate financial gain)

4. **No economic attack surface** - Phase 1 has no tokens, no financial incentives
   - Sybil attacks don't matter without economic rewards to farm

**Phase 2 Additional Mitigations (Token rewards require identity verification):**
5. **Identity verification required for rewards** - self.xyz NFC passport scan or Didit.me government ID
   - Cost to attacker: $50-100 per fake passport (black market), high risk
   - Detection: Biometric liveness checks prevent photo/video spoofing
   - One identity = one verified account (cryptographic enforcement)

6. **Token reward reduction** - Unverified wallets earn 50% less
   - Makes farming uneconomical (reward < ID acquisition cost)

7. **Challenge market participation** - Low-rep wallets have reduced influence
   - New wallets can't immediately manipulate markets

**Detection signals:**
- Identical template text across multiple wallets
- Coordinated sending times (within same block)
- Geographic clustering (multiple IDs from same IP)
- Behavioral patterns (identical interaction sequences)

**Response protocol:**
1. Flag suspicious wallets (automated clustering analysis)
2. Manual review by security team (5 reviewers, 3-of-5 consensus)
3. If confirmed Sybil: Slash reputation to zero, freeze rewards
4. Publish transparency report (wallet addresses, evidence, no PII)

### Challenge Market Manipulation — PHASE 2 ONLY

> **⚠️ NOT INCLUDED IN PHASE 1**: Challenge markets require VOTER token for economic stakes. Phase 1 uses 3-layer moderation (FREE OpenAI API + Gemini/Claude consensus + human review) instead.

**Attack scenario:** Coordinate false challenges to drain stakes from accurate templates.

**Mitigations (Phase 2):**
1. **Quadratic staking** - 100 people staking $10 each outweigh 1 whale staking $1000
   - Makes coordination expensive (need 100+ colluding actors)

2. **Multi-model consensus** - 20 AI models (GPT-5, Claude Opus, Gemini Pro, Grok, Mistral, Qwen, DeepSeek, Llama)
   - Architecturally different models, hard to fool all simultaneously
   - Requires 67% threshold (13+ of 20 models must agree)

3. **Reputation at stake** - Lose challenges → reputation slashed → future influence reduced
   - Economic cost compounds over time (can't repeatedly attack)

4. **Evidence transparency** - All challenge evidence published on IPFS
   - Community can audit and identify coordinated attacks

**Detection signals:**
- Multiple challenges from wallets created same day
- Identical evidence text across challenges
- Challenges targeting specific political viewpoints (censorship attempt)
- Low-reputation wallets staking disproportionately

**Response protocol:**
1. Flag coordinated challenges (graph analysis of wallet relationships)
2. Escalate to human arbitration DAO (beyond AI consensus)
3. If confirmed attack: Slash all attacker reputations, return stakes to challenged party
4. Update challenge staking requirements (raise minimum for low-rep wallets)

**Phase 1 Alternative**: Content moderation via 3-layer stack catches 99.5%+ of policy violations without requiring economic stakes.

### Oracle Manipulation — PHASE 2 ONLY

> **⚠️ NOT INCLUDED IN PHASE 1**: Oracle systems primarily serve token emission agents (SupplyAgent, MarketAgent) which don't exist in Phase 1. ImpactAgent uses Congress.gov API directly (no oracle middleware).

**Attack scenario:** Feed false data to agents (e.g., fake token price, fake bill text).

**Mitigations:**
1. **Multiple independent oracles** - Chainlink, Band Protocol, custom congress.gov scrapers
   - Cross-reference data, reject outliers

2. **Outlier detection** - If 1 oracle shows 50% price change, others show 2%, ignore outlier
   - Prevents single oracle compromise from triggering bad decisions

3. **On-chain proof** - Every oracle data point includes cryptographic signature
   - Can trace bad data to specific oracle provider

4. **Time-weighted averaging** - Don't react to single data point, use moving averages
   - Prevents flash-loan style price manipulation

**Detection signals:**
- Single oracle deviates >20% from consensus
- Sudden data spikes inconsistent with external sources
- Oracle signatures from unexpected keys

**Response protocol:**
1. Automatic outlier rejection (already implemented)
2. If oracle repeatedly compromised: Remove from approved list
3. Emergency pause agent decisions if >50% oracles unreliable
4. Manual governance vote to approve new oracle providers

-----

## Agent Security

### Multi-Agent Consensus Vulnerabilities

**Attack scenario:** Craft adversarial inputs that trick agents into bad decisions.

**Mitigations:**
1. **Bounded outputs** - Rewards capped at 5000 VOTER, can't mint unlimited tokens
2. **Multi-agent agreement** - Requires 3+ agents agreeing (60% weighted consensus)
3. **Human override** - Governance can veto suspicious decisions within 24 hours
4. **Deterministic logic** - Agents execute fixed algorithms on observable data, not LLM "vibes"

**Known adversarial examples:**
- *Input*: Fake "bill introduction" with manipulated timestamp
  - *Defense*: ImpactAgent cross-references congress.gov API, rejects if not in official database

- *Input*: Coordinated template spam (1000 sends in 1 block)
  - *Defense*: SupplyAgent detects participation spike, reduces per-action rewards proportionally

- *Input*: False challenge evidence (AI-generated fake voting records)
  - *Defense*: Challenge markets require verifiable sources (congress.gov, government PDFs), IPFS hashes compared

**Monitoring:**
- All agent decisions logged on-chain (IPFS hash of full context)
- Community can replay inputs, verify outputs match expected behavior
- Discrepancies flagged → agent reputation decay → consensus weight reduction

**Incident response:**
- **If single agent compromised**: Reduce consensus weight to 0%, deploy patched version
- **If multiple agents colluding**: Emergency governance vote, manual decisions until fix deployed
- **If logic exploit found**: Immediate patch, retroactive correction of affected rewards

-----

## Privacy Guarantees & Limitations

### What ZK Proofs Reveal

VOTER Protocol ZK proofs are **pseudonymous, not anonymous**. Each proof reveals public inputs that enable verification while narrowing the anonymity set.

**Three-tree path (production): 31 public inputs.** The three-tree circuit is the canonical verification path. It extends the two-tree path with engagement reputation.

**Two-tree path (legacy): 29 public inputs.** Key privacy-relevant fields:

| Public Input | Index | Purpose | Privacy Impact |
|-------------|-------|---------|----------------|
| `user_root` | 0 | User tree membership | Links proof to specific user tree snapshot |
| `cell_map_root` | 1 | Cell map tree membership | Links proof to geographic cell assignment |
| `districts[0..23]` | 2-25 | 24-slot district commitments | Reveals district membership for active slots |
| `nullifier` | 26 | Double-participation prevention | Unique per user+action_domain (not linkable across different actions) |
| `action_domain` | 27 | Action type binding | Binds proof to specific action context |
| `authority_level` | 28 | Authority level/tier verification | Narrows anonymity set by authority level |

**Three-tree additional public inputs (indices 29-30):**

| Public Input | Index | Purpose | Privacy Impact |
|-------------|-------|---------|----------------|
| `engagement_root` | 29 | Engagement tree membership | Links proof to specific engagement tree snapshot |
| `engagement_tier` | 30 | Engagement level (0-4) | 5-bucket coarse output — further narrows anonymity set |

> For the complete public input field list and ordering, see `specs/PUBLIC-INPUT-FIELD-REFERENCE.md`.

**What remains hidden:**
- Exact address (only Merkle membership proven)
- Leaf position in tree (Merkle path reveals nothing about index)
- User secret (never leaves client)
- Which specific leaf commitment is yours

### Anonymity Set Calculation

Your effective anonymity set is determined by the intersection of **all** public outputs — not any single district slot in isolation:

```
anonymity_set = |registered users sharing your exact 24-slot district combination|
                × proportion_at_your_authority_level
                × proportion_in_your_user_root_cohort
```

The critical factor is the **24-district fingerprint**. Each proof reveals all 24 district slots simultaneously. Your unique combination of congressional district + state senate + county + city + school board + water district + ... creates a geographic fingerprint whose resolution depends on how governance boundaries overlay your location.

**Why this matters more than single-district analysis:**

A single congressional district contains ~750K people. But the intersection of congressional district + state senate + county + municipality + school district rapidly narrows. In practice, the 24-slot intersection approaches **census-tract resolution (~4,000 people in the general population)**. Among *registered protocol users*, the effective set is smaller still.

**The distribution is heteroscedastic** — variance is not constant across geography:

| Geography | Why | Effective Fingerprint Resolution |
|-----------|-----|----------------------------------|
| **Dense urban core** | Governance boundaries nest cleanly — school, city, county, congressional districts all align | Large anonymity sets (thousands+ share the same combination) |
| **Inner suburb** | Some boundary cross-cutting — school districts may span municipalities | Moderate sets (hundreds sharing) |
| **Outer suburb / exurb** | Heavy cross-cutting — water districts, school districts, townships cross municipal and county lines | Small sets (tens of users, potentially unique) |
| **Rural** | Sparse registration + unique governance combinations (township + water district + school district intersection) | May approach singleton among registered users |

There is no fixed threshold that captures this. A college town of 30K with a single unified school district has better anonymity properties than a suburb of 200K where 6 school districts cross-cut 3 municipalities across 2 counties. **Privacy depends on how communities fold over the land**, not on population density alone.

### Geographic Fingerprint Warning

**Your 24-district fingerprint is determined by your governance geography, not by a protocol-wide constant.** In areas where governance boundaries cross-cut heavily, you may be narrowed to a small group or — among registered protocol users — potentially unique.

**Contributing factors (cumulative narrowing):**
- **24-slot intersection**: Each populated slot further narrows the set
- **Authority level**: Subdivides within the geographic fingerprint
- **User root cohort**: Users registered in the same tree batch form an identifiable cohort
- **Engagement tier**: Further narrows by engagement reputation level (5 buckets)
- **Registration density**: Early adopters in any geography face smaller sets

**Recommendations:**

1. **Assess your governance geography** — Consider how many distinct boundaries cross your location. More cross-cutting = smaller anonymity set.
2. **Use batch timing** — Submit proofs during high-activity periods when more users are participating in the same tree snapshot.
3. **Client-side anonymity estimation** (planned) — Before proof submission, the client will compute how many registered users share your exact slot combination and display the result. No guessing, no thresholds — your actual number.

### Signer Linkability (Phase 1 Known Limitation)

Every `verifyTwoTreeProof()` and `verifyThreeTreeProof()` call emits an on-chain event containing the `signer` address — the wallet that signed the EIP-712 message. This creates **cross-action wallet linkability**:

- All actions from the same wallet are linked on-chain
- An observer can correlate: "wallet 0xABC proved membership in action-domain-X, then action-domain-Y"
- The nullifier changes per action domain (unlinkable by nullifier), but the signer is constant
- Combined with the 24-district fingerprint, the signer address becomes a persistent pseudonym with geographic binding

**This is distinct from nullifier linkability** (which the protocol correctly prevents). Nullifiers are action-scoped: `H2(identity_commitment, action_domain)`. Different action domains produce different nullifiers. But the `signer` field is the same wallet across all actions.

**Phase 2 mitigation: meta-transaction relayer.** Users sign proofs locally and submit to a relayer service. The relayer submits on-chain — the `signer` field becomes the relayer's address, not the user's wallet. Nullifiers still prevent double-action. Wallet linkability disappears. The relayer learns the user's IP (mitigated by Tor/VPN) but not their identity commitment (the EIP-712 signature binds the proof, not the user's ZK identity).

### Operator Trust Boundary

The protocol's trust model is documented in detail in `specs/TRUST-MODEL-AND-OPERATOR-INTEGRITY.md`. The following summarizes what the operator (Communique PBC, running the communique application and Shadow Atlas infrastructure) can observe in Phase 1.

**What the operator can see:**

| Data | Where | Who | Mitigation |
|------|-------|-----|------------|
| `cell_id` + `identityCommitment` | Shadow Atlas registration | Operator | Operator knows which geographic cell each identity registered from. Phase 2: DA-layer publication removes operator as sole witness |
| OAuth email → session → wallet | Communique Supabase DB | Operator with DB access | Login email linked to session, session linked to proof submission. Phase 2: passkey-based auth eliminates email linkage |
| `signerAddress` ↔ `identityCommitment` | On-chain engagement registration events | Public (on-chain) | Links wallet to ZK identity permanently. Phase 2: relayer severs this link |
| IPFS insertion log timestamps | Public (IPFS) | Anyone | Registration timing reveals when users joined. Mitigated by batch insertions |
| Full identity chain (email→session→wallet→IC→proofs) | Operator combining DB + chain data | Operator | Complete deanonymization possible for the operator in Phase 1. This is the MACI-equivalent trust assumption (see trust model spec) |

**What the operator cannot do:**
- Forge ZK proofs (cryptographic — requires user's secret)
- Reuse nullifiers (on-chain enforcement — NullifierRegistry)
- Modify registered roots without 7-day community detection window (on-chain timelocks)
- Read message plaintext after encryption (XChaCha20-Poly1305, client-side)

**The honest framing:** In Phase 1, the operator holds a position structurally identical to the MACI coordinator. The operator can observe identity linkages but cannot forge proofs or corrupt verification. The walkaway roadmap in `specs/TRUST-MODEL-AND-OPERATOR-INTEGRITY.md` specifies the engineering path to eliminating each trust assumption.

### Data-at-Rest Inventory

| Store | Contents | Retention | Access | Phase 2 Change |
|-------|----------|-----------|--------|----------------|
| **Supabase (communique)** | User sessions, OAuth tokens, template data, wallet addresses | Session lifetime + 90 days | Operator (DB credentials) | Passkey auth eliminates OAuth email linkage |
| **Shadow Atlas (voter-protocol)** | Identity commitments, cell IDs, Merkle paths, insertion log | Indefinite (append-only) | Operator (server access), public (IPFS for insertion log) | DA-layer publication, community-run atlas instances |
| **Scroll L2 (on-chain)** | Nullifiers, roots, signer addresses, district commitments, engagement tiers, participation counts | Permanent (blockchain) | Public | Relayer removes signer linkability |
| **IPFS** | Shadow Atlas insertion log (Ed25519-signed entries) | Permanent (content-addressed) | Public | No change needed |
| **Browser (client)** | User secret, Merkle paths, session credentials | Until user clears | User only | No change needed |

### Mitigation Architecture (Phase 2 Planned)

**1. Selective Slot Disclosure (circuit change)**
- Reveal only the district slots required by a given action domain — zero out the rest
- Transforms the 24-slot fingerprint from a fixed geographic property to a per-action choice
- If your action only needs congressional district verification, the other 23 slots are hidden
- Trade-off: Requires per-action-domain circuit configuration; increases circuit complexity
- **This is the primary architectural mitigation for the geographic fingerprint problem**

**2. Meta-Transaction Relayer**
- Users sign proofs locally, submit to relayer, relayer submits on-chain
- Severs `signer` ↔ wallet linkability across actions
- Nullifiers still prevent double-action (no gaming)
- Relayer learns IP (mitigate with Tor/VPN) but not identity commitment

**3. Client-Side Anonymity Estimation**
- Before proof submission, compute how many registered users share your exact populated-slot combination
- Display the actual number — no thresholds, no false precision
- Let users make informed decisions based on their specific governance geography

**4. Authority Level Bucketing**
- Combine authority levels into broader tiers to reduce granularity
- Increases anonymity set within each geographic fingerprint
- Trade-off: Reduced precision in tier-based access control

**5. Temporal Batching**
- Aggregate proof submissions across time windows
- Prevents timing correlation between Shadow Atlas registration and on-chain proof submission
- Trade-off: Increased latency

### Three-Tree Privacy Analysis

The three-tree circuit adds two public outputs that affect privacy:

**`engagement_tier` (index 30) — 5-bucket public output:**
- Tiers: 0 (New), 1 (Active), 2 (Established), 3 (Veteran), 4 (Pillar)
- Each tier further subdivides the anonymity set within a geographic fingerprint
- At steady state, tier distribution concentrates in tiers 1-2 (largest anonymity sets)
- Tier 4 (Pillar) has the smallest population — users at this tier should be aware of reduced anonymity

**Private engagement metrics (never revealed on-chain):**
- `action_count` — total nullifier consumption events (private witness input)
- `diversity_score` — Shannon diversity index H, encoded as `floor(H * 1000)` (private witness input)
- These cannot be reverse-engineered from the public `engagement_tier` output

**Cross-tree identity binding security:**
- The same `identity_commitment` feeds both the nullifier derivation (`H2(identity_commitment, action_domain)`) and the engagement leaf (`H2(identity_commitment, engagement_data_commitment)`)
- The circuit enforces this binding — an attacker cannot substitute a different identity's engagement credentials
- This prevents "engagement borrowing" where a low-engagement user presents another user's tier

**Anonymity set impact:**
```
three_tree_anonymity_set = two_tree_anonymity_set
                          × proportion_at_your_engagement_tier
```

With 5 engagement tiers, the worst-case additional narrowing factor is 5x (uniform distribution). In practice, concentration in tiers 1-2 means moderate-engagement users experience less narrowing than extreme tiers.

### Technical Implementation Notes

The anonymity set limitations stem from the circuit's public input design. The three-tree circuit exposes 31 public inputs (the two-tree legacy path exposes 29). See [PUBLIC-INPUT-FIELD-REFERENCE.md](/specs/PUBLIC-INPUT-FIELD-REFERENCE.md):

```
Public inputs (31): user_root, cell_map_root, districts[24], nullifier, action_domain,
                    authority_level, engagement_root, engagement_tier
```

- `user_root` and `cell_map_root` identify the tree snapshots, effectively revealing which registration cohort the user belongs to
- `districts[0..23]` reveal district commitments for each registered slot (zero-padded for unused slots)
- `authority_level` encodes the user's authority level for tier-based access control
- `engagement_root` identifies the engagement tree snapshot
- `engagement_tier` reveals the user's coarse engagement level (5 buckets)
- These are necessary for the protocol's verification guarantees

**Why not hide these values?**
- `user_root`/`cell_map_root`: Required to verify proof against correct on-chain tree roots
- `districts`: Required for callers to check if the prover belongs to a specific governance boundary
- `authority_level`: Required for campaigns that enforce minimum authority levels
- Hiding these would require recursive proofs (significant performance cost) or eliminate tier-based features

### Honest Assessment

**We are transparent about this limitation:**

| Claim | Status |
|-------|--------|
| "Anonymous voting" | ❌ **False** — Proofs are pseudonymous with geography-dependent anonymity sets |
| "District membership hidden" | ❌ **False** — All 24 district slots revealed as public inputs |
| "Authority level hidden" | ❌ **False** — Authority level is a public input |
| "Engagement tier hidden" | ❌ **False** — Engagement tier (0-4) is a public input in three-tree proofs |
| "Engagement details hidden" | ✅ **True** — action_count and diversity_score are private witness inputs |
| "Actions unlinkable by nullifier" | ✅ **True** — Different nullifiers per action domain (Poseidon2 preimage security) |
| "Actions unlinkable by wallet" | ❌ **False (Phase 1)** — `signer` address links all actions from same wallet |
| "Address never revealed" | ✅ **True** — Only Merkle membership proven, address never leaves browser |
| "Exact leaf position hidden" | ✅ **True** — Merkle path reveals no position info |
| "Operator cannot forge proofs" | ✅ **True** — Requires user's secret (cryptographic guarantee) |
| "Operator can observe identity linkages" | ✅ **True (Phase 1)** — MACI-equivalent trust assumption, see trust model spec |

Users should understand these trade-offs before participating. Privacy is a function of your specific governance geography, not a protocol-wide constant. If your threat model requires stronger anonymity guarantees than your location provides, assess whether participation is appropriate for your situation, and consider waiting for Phase 2 selective slot disclosure.

-----

## Privacy Breach Scenarios

### Identity Deanonymization

**Worst-case scenario:** Attacker links wallet addresses to real-world identities.

**Attack vectors:**
1. **Blockchain analysis** - Analyze on-chain transactions, correlate with external data
   - *Mitigation*: Users control wallet funding methods, can use mixers/privacy tools
   - *Platform responsibility*: We don't collect wallet funding sources

2. **IP address correlation** - Log IP addresses during proof generation, map to locations
   - *Mitigation*: No IP logging on proof generation endpoints, encourage VPN/Tor usage
   - *Status*: Server logs retain only timestamp + district hash (no IPs)

3. **Metadata leakage** - Congressional delivery timing correlates with public events
   - *Mitigation*: Batch deliveries (hourly windows), can't correlate specific sends
   - *Status*: Messages queued, delivered in randomized order

4. **Identity verification provider breach** - self.xyz or Didit.me hacked
   - *Mitigation*: Zero-knowledge proofs of identity verification (provider never learns wallet address)
   - *Status*: Verification happens via blind signatures, provider can't link ID to wallet

**If breach occurs:**
1. Immediate notification to affected users (if determinable)
2. Offer wallet migration assistance (new addresses, reputation transfer)
3. Forensic analysis to determine breach vector
4. Public transparency report within 72 hours

### Message Database Compromise

**Scenario:** Attacker gains access to encrypted message database.

**Phase 2 target architecture:**
- Messages encrypted client-side (XChaCha20-Poly1305) to TEE public key before network transit
- Encrypted blobs stored in backend database (platform cannot decrypt)
- Decryption occurs only in AWS Nitro Enclaves (isolated from platform)
- Enclave decrypts message + address, sends as plaintext to congressional offices via CWC API
- Addresses and message content never persist in platform-accessible storage

**Phase 1 current state:**
- **Nitro Enclaves NOT deployed** - TEE infrastructure is planned for Phase 2
- Messages use standard encrypted storage with operational key management
- Database compromise mitigations follow industry-standard practices

**If database compromised (Phase 2 with TEE):**
- Attacker gets: Encrypted blobs (XChaCha20-Poly1305 encrypted to TEE public key)
- Attacker needs: TEE private keys (exist only in AWS Nitro Enclave memory, inaccessible)
- Brute force infeasible: 256-bit symmetric keys, ~2^256 operations
- Platform operators cannot decrypt even if they wanted to (architectural enforcement)

**Response (Phase 2 planned):**
1. Immediate incident notification to affected congressional offices
2. Forensic analysis to determine breach vector and scope
3. Purge all temporary encrypted message storage
4. Encrypted blobs are useless without TEE keys (which remain secure in enclaves)

**Phase 1 Response:** Standard incident response procedures for encrypted data breaches apply.

-----

## Operational Security

### Key Management

**Treasury multi-sig:**
- Phase 1: Single deployer key. Multi-sig planned for mainnet launch.
- Target: 3-of-5 signers with hardware wallets (pre-mainnet requirement)

**Congressional office keys:**
- Phase 1: Standard encrypted storage with operational key management
- Phase 2: AWS Nitro Enclave key isolation (see Nitro Enclaves section above)

**Agent signing keys:**
- Phase 1: Not applicable (no autonomous agents in Phase 1)
- Phase 2: AWS KMS with audit logging planned

**Shadow Atlas operator signing key (Phase 1):**
- Ed25519 keypair for insertion log signatures and registration receipts
- Private key stored at `SIGNING_KEY_PATH` (PEM/PKCS#8 format, mode 0o600)
- **Production guardrail:** Server refuses to start if `SIGNING_KEY_PATH` is not set in production (fail-closed)
- Public key exposed via `GET /v1/signing-key` for independent verification
- Key rotation: manual (replace file, restart; note historical entries remain verifiable only with old key)
- See `docs/architecture/VERIFIABLE-SOLO-OPERATOR.md` for complete trust model

### Access Control

**Production infrastructure:**
- Phase 1: Cloudflare Pages (serverless, no standing server access)
- Database: Supabase PostgreSQL with connection pooling, no direct DB access
- Secrets: Cloudflare Pages environment variables (encrypted at rest)

**Third-party integrations:**
- API keys rotated monthly
- Scoped to minimum required permissions
- Automated revocation if unused >30 days

### Incident Response Team

**On-call rotation:**
- 24/7 coverage, 15-minute SLA for critical alerts
- Escalation path: On-call engineer → Security lead → CTO → Multi-sig signers

**Communication channels:**
- Internal: PagerDuty + Signal encrypted group
- External: security@voter-protocol.org (PGP key: `0x7F3A...`)
- Public: Twitter @VOTERProtocol + status.voter-protocol.org

**Runbooks** (planned for Phase 1 launch):
- Smart contract exploit: `/runbooks/contract-freeze.md`
- Privacy breach: `/runbooks/identity-exposure.md`
- Browser WASM compromise: `/runbooks/client-security-incident.md`
- Oracle manipulation: `/runbooks/oracle-pause.md`

-----

## Security Roadmap

### Phase 1 Launch (Active - February 2026)

**Critical Path (Must complete before mainnet launch):**
- [ ] Noir circuit formal verification (Trail of Bits audit for Merkle membership circuit)
- [ ] DistrictGate.sol smart contract audit (OpenZeppelin/Trail of Bits)
- [ ] Browser WASM security review (Subresource Integrity, COOP/COEP headers, KZG parameters integrity)
- [ ] Shadow Atlas Merkle tree generation and IPFS deployment
- [ ] Content moderation 3-layer stack penetration testing
- [ ] Bug bounty program launch (Immunefi, Phase 1 scope)

**Phase 1 Operational Security:**
- [ ] Security council multisig setup (3-of-5 threshold, hardware wallets)
- [ ] Incident response runbooks (Noir circuit vulnerability, browser WASM compromise, CSAM detection, moderation bypass)
- [ ] Monitoring infrastructure (Datadog for browser proving times, Sentry for errors, gas cost tracking)
- [ ] Congressional IT compliance review (CWC integration, data protection, Section 230)

**Phase 1 Contingency Planning:**
- [ ] Emergency moderation escalation procedures (if Layer 1/2 compromised)
- [ ] Provider redundancy testing (OpenAI API outage → alternative moderation)
- [ ] Noir circuit update procedures (if vulnerability discovered)

### Phase 2 Preparation (Q2-Q3 2026)

**Token Economics Security:**
- [ ] VOTER token smart contract audit (ERC-20, emission logic)
- [ ] SupplyAgent + MarketAgent security review (Oracle manipulation, adversarial inputs)
- [ ] Challenge market penetration testing (Sybil attacks, consensus gaming)
- [ ] Outcome market integration audit (UMA/Gnosis CTF security review)

**Privacy Enhancements:**
- [ ] Privacy pools implementation (Buterin 2023/2025, Tornado Cash-style unlinkability)
- [ ] Fully homomorphic encryption research (encrypt computational inputs, Phase 3+)
- [ ] Nested ZK proofs for reputation ranges (only if congressional offices accept weaker signals)

**Cross-Chain Expansion:**
- [ ] Multi-chain UltraHonk verification gas benchmarks

### Phase 3+ Long-Term (2027+)

**Advanced Cryptography:**
- [ ] Post-quantum ZK-STARK migration (quantum resistance)
- [ ] Nested UltraHonk proofs for reputation ranges (only if community demands + congressional offices accept)
- [ ] Zero-knowledge machine learning (private reputation scoring)

**Decentralization:**
- [ ] DAO governance transition security review
- [ ] Decentralized oracle network (reduce Chainlink/Band reliance)
- [ ] Community-run Shadow Atlas verification tools
- [ ] Distributed WASM proving verification (community-run IPFS nodes for KZG parameters)

**Compliance & Audits:**
- [ ] Annual penetration testing (red team exercises)
- [ ] Compliance audits (GDPR, CCPA, congressional IT requirements)
- [ ] Mobile app security audit (React Native, if mobile launch)
- [ ] Chaos engineering for agent consensus (Byzantine fault tolerance)

-----

## Reporting Security Issues

**DO NOT report security vulnerabilities via public GitHub issues.**

**Responsible disclosure:**
1. Email: security@voter-protocol.org (PGP: `0x7F3A...`)
2. Include: Detailed description, reproduction steps, proof-of-concept (if safe)
3. We respond within 24 hours acknowledging receipt
4. We provide timeline estimate within 72 hours
5. You receive credit in public disclosure (if desired)

**Bug bounty eligibility:**
- Critical: $100k - $500k (private key extraction, treasury drain, identity deanonymization)
- High: $10k - $50k (reputation manipulation, oracle exploits, challenge market gaming)
- Medium: $1k - $10k (DoS, gas griefing, spam bypassing)

**Out of scope:**
- Social engineering attacks against users
- Physical attacks against user devices
- Congressional office system vulnerabilities (report to them directly)

-----

## Appendix: Security Assumptions

**We assume the following are secure (if broken, system security fails):**
1. **Elliptic curve discrete log** (ECDSA, UltraHonk proofs, BN254 curve)
2. **XChaCha20-Poly1305** (AEAD encryption for congressional messages)
3. **RSA-OAEP** (Key encapsulation for congressional office public keys)
4. **Poseidon hash function** (collision resistance, SNARK-friendly)
5. **KZG commitment scheme** (Polynomial commitments via Aztec's powers-of-tau ceremony, 100K+ participants)
6. **Browser sandbox security** (WASM isolation, COOP/COEP headers enforced)

**We do NOT assume:**
- Users protect seed phrases (we use identity verification instead)
- Single oracle tells truth (we cross-reference multiple)
- Single agent is honest (we require multi-agent consensus)
- Platform operators are trustworthy (cryptography eliminates need for trust)
- Congressional offices protect messages post-delivery (out of our control)

-----

**This document lives and breathes. Threat landscape changes daily. Security team reviews quarterly. Last review: 2026-02-20.**

**Questions? Concerns? Paranoia?** security@voter-protocol.org
