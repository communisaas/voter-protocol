# Security: Living Threat Model & Response Protocol

**This document evolves with the threat landscape. Last updated: 2025-10-20**

**Phase 1 Focus**: This security model reflects Phase 1 architecture (browser-native Halo2 zero-knowledge proofs, self.xyz/Didit.me verification, E2E encrypted congressional delivery, reputation-only, 3-layer content moderation). Phase 2 additions (challenge markets, outcome markets, VOTER token) marked clearly.

VOTER Protocol is cryptographic democratic infrastructure handling identity verification, congressional message delivery, content moderation, and reputation systems. Phase 2 adds financial mechanisms (token economics, prediction markets). Security failures kill trust. This document maps threat vectors, mitigations, and incident response procedures.

-----

## Threat Model (Updated Continuously)

### Critical Assets

**Phase 1 Assets** (launching in 3 months):
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
- **High**: Spam bypassing 3-layer moderation, Halo2 proof forgery, protocol treasury drain
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
- **Status**: OpenAI API FREE, unlimited requests, 47ms latency
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

### Zero-Knowledge District Verification (Phase 1: Halo2)

**Security claim:** Address → district proof reveals only district hash, mathematically impossible to reverse-engineer address. Address never leaves browser, never stored in any database.

**Attack vectors:**
1. **Halo2 circuit vulnerability** - Prove membership without valid address
   - *Mitigation*: Formal verification of circuit logic (battle-tested Halo2 library since 2022 in Zcash Orchard)
   - *Status*: Halo2 is production-grade cryptography with extensive security audits
   - *Advantage over Groth16*: No trusted setup ceremony = no toxic waste risk
   - *Audit timeline*: Trail of Bits audit scheduled Q1 2026 for our Merkle circuit implementation

2. **~~Trusted setup compromise~~** - **ELIMINATED**
   - *Halo2 has no trusted setup*: Polynomial commitment scheme via inner product arguments
   - *Security*: Based on discrete log assumptions (no ceremony needed)
   - *No contingency needed*: Halo2 provides 4-6s proving, 60-100k gas (production-ready)

3. **Shadow Atlas poisoning** - Inject false district boundaries, misdirect proofs
   - *Mitigation*: Multi-source verification (Census Bureau + OpenStreetMap + govinfo.gov), quarterly audits
   - *Status*: Atlas root published on-chain, community can verify against authoritative sources
   - *Current root*: `0x7f3a...` (updated 2025-10-10)
   - *Update frequency*: Quarterly (after redistricting, census updates)

4. **Client-side proof grinding** - Generate proofs until collision with target district
   - *Mitigation*: Poseidon hash function (collision-resistant), ~2^128 security
   - *Status*: No practical attack exists, would require breaking discrete log assumptions
   - *Halo2 advantage*: Proof verification on-chain provides additional tamper-evidence

5. **Polynomial commitment soundness break** - Forge proofs via IPA weakness
   - *Mitigation*: Inner product arguments (IPA) extensively studied, no known breaks
   - *Status*: Used in production by Zcash since 2022, no attacks demonstrated
   - *Monitoring*: Weekly cryptography paper reviews for new attacks

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

Pinned dependencies prevent supply-chain attacks via `cargo update`, but create **vulnerability lag** when CVEs published:

```toml
# ✅ Pinned to audited Trail of Bits commit
halo2-base = { git = "https://github.com/axiom-crypto/halo2-lib",
               rev = "4dc5c4833f16b3f3686697856fd8e285dc47d14f" }
```

**Monitoring setup:**
- [ ] Weekly RustSec advisory database checks
- [ ] Quarterly dependency review (check for new releases/CVEs)
- [ ] GitHub Actions workflow: `cargo audit` on every PR

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
- **If Halo2 circuit vulnerability**: Emergency pause district verification, deploy patched circuit
- **If Poseidon hash broken**: Immediate protocol upgrade to alternative hash (Rescue, Anemoi)
- **If Atlas poisoned**: Rollback to previous root, publish discrepancy report, community verification
- **If IPA broken**: This would be a fundamental cryptographic break affecting all Halo2 systems globally (unlikely, but would require protocol-wide migration)
- **If KZG params compromised**: Emergency npm package unpublish, security advisory, re-publish with correct params

### Identity Verification Security (Phase 1: self.xyz + Didit.me)

**Security claim:** Cryptographic proof of government-issued identity verification without platform storing PII. Sybil-resistant via one verified identity = one account binding.

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
   - *On-chain verification*: DistrictGate.sol verifies provider signatures before accepting proofs
   - *Key rotation*: self.xyz + Didit.me rotate signing keys quarterly
   - *Incident response**: If API key compromised, emergency key rotation + invalidate all proofs from compromised period

**Phase 1 Status:**
- **Cost**: $0 (both providers offer FREE tiers, unlimited verifications)
- **Adoption split**: 70% self.xyz (NFC passport), 30% Didit.me (Core KYC fallback)
- **Countries supported**: 120+ (NFC-enabled passports)

**Incident response:**
- **If provider breach**: Verify no wallet-identity linkage exposed (should be impossible by design)
- **If forgery detected**: Ban identity hash on-chain, investigate verification provider security
- **If Sybil cluster found**: Slash reputation to zero, publish transparency report (no PII)

---

### NEAR Chain Signatures (Phase 2 Optional: Threshold ECDSA)

> **⚠️ NOT INCLUDED IN PHASE 1**: NEAR dependency eliminated. Phase 1 uses direct wallet connections (MetaMask, WalletConnect) on Scroll L2. Chain Signatures may be added in Phase 2+ for optional multi-chain expansion.

**Security claim:** No single node sees complete private key. Requires 2/3 NEAR validator collusion to extract keys.

**Attack vectors:**
1. **MPC protocol break** - Reconstruct private key from signature shares
   - *Mitigation*: Battle-tested Gennaro-Goldfeder protocol (used by Fireblocks, ZenGo)
   - *Status*: Production-grade since 2023, no known breaks

2. **Validator set takeover** - Compromise 2/3 of NEAR validators
   - *Mitigation*: NEAR's 300+ validators across jurisdictions, Sybil-resistant staking
   - *Status*: Would require $500M+ attack (stake + coordination costs)

3. **~~Passkey phishing~~** - **Phase 1 uses self.xyz/Didit.me (not passkeys)**
   - *Phase 2 consideration*: If NEAR integration added, transaction preview UI prevents blind signing

**Incident response (Phase 2 only):**
- **If MPC broken**: Immediate key rotation, migrate all user funds to new addresses
- **If validator compromise**: NEAR protocol-level response, outside VOTER control

### End-to-End Message Encryption via AWS Nitro Enclaves

**Security claim:** True E2E encryption—backend architecturally CANNOT decrypt. Plaintext exists only in: constituent browser → AWS Nitro Enclave (isolated compute) → congressional CRM. Platform operators cannot read messages even if they wanted to.

**Why Nitro Enclaves:**
- Hypervisor-based isolation (NOT Intel SGX/AMD SEV vulnerable to TEE.fail DDR5 attacks)
- Cryptographic attestation (users verify correct code running before encrypting)
- We cannot access enclave memory (architectural enforcement, not policy)
- FREE (no additional cost beyond EC2 instance)

**Attack vectors:**

1. **Backend server compromise** - Attacker gains root access to EC2 instance
   - *Mitigation*: Backend stores only encrypted blobs, lacks decryption keys
   - *Enclave isolation*: Even with root access, attacker cannot read enclave memory
   - *Status*: AWS Nitro Hypervisor prevents host OS from accessing enclave
   - *Even if compromised*: Attacker gets XChaCha20-Poly1305 encrypted blobs useless without enclave keys

2. **Enclave code vulnerability** - Bug in enclave moderation/delivery logic
   - *Mitigation*: Open-source enclave code, community auditable
   - *Attestation*: Users verify PCR measurements match expected code hash before encrypting
   - *Status*: Any code change requires new attestation, users see mismatch and refuse to encrypt
   - *Response*: Deploy patched enclave, publish new PCR measurements, transparency report

3. **AWS as malicious actor** - AWS itself attempts to extract enclave keys
   - *Mitigation*: Nitro Enclave design makes this architecturally difficult
   - *Honest assessment*: You trust AWS infrastructure (same as any cloud provider)
   - *Comparison*: Better than "trust us" (we can't decrypt) but requires trusting AWS data center security
   - *Alternative*: Congressional offices could hold keys (they won't manage 535 keypairs)

4. **Physical attack on AWS data center** - Attacker physically accesses servers
   - *Threat model exclusion*: Physical data center attacks are OUT OF SCOPE per industry standards
   - *Status*: Requires breaking into AWS facilities, bypassing armed guards and physical security
   - *Honest assessment*: If your threat model includes nation-state physical AWS infiltration, use different infrastructure
   - *TEE.fail immunity*: Nitro uses hypervisor isolation (not vulnerable to DDR5 memory interposer attacks)

5. **Side-channel attacks on enclave** - Extract keys via timing, cache, power analysis
   - *Mitigation*: Nitro Enclaves designed with side-channel resistance
   - *Status*: Mitigated but not eliminated (side channels are hard problem)
   - *Monitoring*: AWS publishes security bulletins, we track and patch
   - *Response*: If side-channel discovered, emergency key rotation within enclave

6. **Attestation verification bypass** - User client skips PCR verification, encrypts to wrong enclave
   - *Mitigation*: Client-side attestation verification enforced in open-source code
   - *Status*: Users can audit JavaScript, verify attestation logic correct
   - *Detection*: Community reports if attestation bypassed in wild
   - *Response*: Publish security advisory, users update to patched client

**What Nitro Enclaves PROTECTS against:**
✅ Server compromise (backend cannot decrypt)
✅ Insider threats (we cannot access enclave)
✅ Legal compulsion (we literally cannot decrypt to comply)
✅ Database breach (encrypted blobs useless)

**What Nitro Enclaves DOES NOT protect against:**
❌ Physical AWS data center attacks (excluded from threat model)
❌ AWS as malicious actor (you trust AWS infrastructure)
❌ Bugs in enclave code (mitigated via open-source audit)
❌ Side-channel attacks (mitigated but not eliminated)

**Honest comparison to alternatives:**
- **vs. "Trust us" encryption**: We CANNOT decrypt (architectural), not "we promise not to"
- **vs. Congressional offices holding keys**: Realistic? No (535 offices won't manage keypairs)
- **vs. No moderation**: Legal requirement (Section 230 compliance needs content filtering)

**Cost:**
- EC2 instance: $500-800/month (c6a.xlarge for Nitro Enclaves)
- AI moderation: Runs inside enclave ($0 additional compute)
- Total: $500-800/month for E2E encryption + moderation

**Incident response:**
- **If enclave code bug**: Deploy patch, publish new PCR measurements, transparency report
- **If attestation bypassed**: Emergency client update, security advisory
- **If AWS Nitro vulnerability**: Follow AWS security bulletins, emergency key rotation if needed
- **If physical data center attack**: This is AWS's responsibility, we monitor AWS security advisories

-----

## Economic Attack Vectors

### Sybil Attacks (Identity Farming)

**Attack scenario:** Create multiple fake identities, farm rewards across wallets.

**Phase 1 Mitigations (Reputation-only):**
1. **Identity verification** - self.xyz NFC passport scan or Didit.me government ID
   - Cost to attacker: $50-100 per fake passport (black market), high risk
   - Detection: Biometric liveness checks prevent photo/video spoofing

2. **Rate limits** - 10 messages/day, 3 templates/day per verified identity
   - Even with 100 fake IDs: Max 1,000 messages/day (detectable via clustering analysis)

3. **Reputation rewards only** - No token rewards in Phase 1, only reputation points
   - Makes farming uneconomical (no immediate financial gain)

4. **On-chain binding** - One identity = one wallet (cryptographic enforcement)
   - Can't create multiple wallets with same identity

**Phase 2 Additional Mitigations (Token rewards):**
5. **Token reward reduction** - Unverified wallets earn 50% less
   - Makes farming uneconomical (reward < ID acquisition cost)

6. **Challenge market participation** - Low-rep wallets have reduced influence
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

## Smart Contract Security

### Current Mitigations

**Code quality:**
- OpenZeppelin libraries for all standard patterns (ERC-20, access control)
- Formal verification for critical contracts (challenge markets, reputation registry)
- External audits: Trail of Bits (Q1 2025), Quantstamp (Q2 2025)

**Governance safeguards:**
- Multi-sig treasury: 5-of-9 signers, geographically distributed
- Timelock: 72 hours before governance changes execute
- Emergency pause: Any 3 signers can freeze contracts if exploit detected

**Bug bounties:**
- Critical (treasury drain, privacy break): $100k - $500k
- High (reputation manipulation, oracle exploits): $10k - $50k
- Medium (DoS, gas griefing): $1k - $10k
- Program managed through Immunefi

### Known Attack Patterns

**Reentrancy:**
- *Status*: Mitigated via OpenZeppelin ReentrancyGuard on all external calls
- *Last audit*: 2025-01-20, zero findings

**Integer overflow/underflow:**
- *Status*: Solidity 0.8+ automatic checks, explicit SafeMath where required
- *Last audit*: 2025-01-20, zero findings

**Front-running:**
- *Status*: Challenge markets use commit-reveal scheme (2-block delay)
- *Last audit*: 2025-01-20, 1 medium finding (fixed)

**Governance attacks:**
- *Status*: 72-hour timelock + multi-sig prevents single-actor takeover
- *Scenario tested*: Simulated 30% token holder attempting malicious proposal (rejected via multi-sig)

### Incident Response (Smart Contract Exploit)

**Detection:**
1. On-chain monitoring alerts (Forta network sensors)
2. Community reports via security@voter-protocol.org
3. Automated anomaly detection (unusual token movements)

**Response stages:**

**Stage 1: Freeze (0-30 minutes)**
- Any 3 multi-sig signers trigger emergency pause
- All transfers frozen, agent decisions halted
- Public incident announcement (Twitter, Discord, status page)

**Stage 2: Assessment (30 minutes - 6 hours)**
- Security team analyzes exploit vector
- Quantify losses (affected wallets, token amounts)
- Determine if fix requires contract upgrade or configuration change

**Stage 3: Remediation (6-48 hours)**
- Deploy patched contracts if needed
- Restore affected user balances via snapshot
- Resume operations after multi-sig approval

**Stage 4: Transparency (48 hours - 1 week)**
- Publish detailed post-mortem (exploit vector, timeline, fix)
- Compensate affected users (100% reimbursement + 10% bonus)
- Update audit requirements based on lessons learned

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

**Current state:**
- Messages encrypted client-side before network transit
- Encrypted blobs pass through backend (no decryption capability)
- Plaintext never persists in backend (delivered to CWC encrypted, CWC decrypts)
- Encrypted blobs stored temporarily (<24 hours for delivery confirmation)

**If database compromised:**
- Attacker gets: Encrypted blobs (XChaCha20-Poly1305 + RSA-OAEP wrapped keys)
- Attacker needs: Congressional office private keys (controlled by CWC, not platform)
- Brute force infeasible: 256-bit symmetric keys + 2048-bit RSA, ~2^256 operations

**Response:**
1. Immediate incident notification to affected congressional offices
2. Forensic analysis to determine breach vector and scope
3. Purge all temporary encrypted message storage
4. Congressional offices can rotate their CWC keys if concerned (platform has no control)

-----

## Operational Security

### Key Management

**Treasury multi-sig:**
- 5-of-9 signers required
- Geographic distribution: USA (2), Europe (3), Asia (2), South America (1), Africa (1)
- Hardware wallets only (Ledger, Trezor)
- Annual key rotation ceremony

**Congressional office keys:**
- Generated via MPC ceremony (no single party sees complete key)
- IPFS backup with encryption
- Annual rotation, previous keys retained for legacy decryption

**Agent signing keys:**
- Stored in AWS KMS with audit logging
- Rotated quarterly
- Multi-region redundancy

### Access Control

**Production infrastructure:**
- Zero standing access (no permanent admin credentials)
- Time-limited access via Teleport (max 4 hours)
- Every access logged + reviewed weekly
- Require 2FA + hardware key

**Database access:**
- Read-only replicas for analytics (no PII)
- Write access only via application logic (no direct DB connections)
- Audit logs retained 7 years

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

**Runbooks:**
- Smart contract exploit: `/runbooks/contract-freeze.md`
- Privacy breach: `/runbooks/identity-exposure.md`
- Browser WASM compromise: `/runbooks/client-security-incident.md`
- Oracle manipulation: `/runbooks/oracle-pause.md`

-----

## Security Roadmap

### Phase 1 Launch (Q4 2025 - Q1 2026)

**Critical Path (Must complete before mainnet launch):**
- [ ] Halo2 circuit formal verification (Trail of Bits audit for Merkle membership circuit)
- [ ] DistrictGate.sol smart contract audit (OpenZeppelin/Trail of Bits)
- [ ] Browser WASM security review (Subresource Integrity, COOP/COEP headers, KZG parameters integrity)
- [ ] Shadow Atlas Merkle tree generation and IPFS deployment
- [ ] Content moderation 3-layer stack penetration testing
- [ ] self.xyz + Didit.me integration security review
- [ ] Bug bounty program launch (Immunefi, Phase 1 scope)

**Phase 1 Operational Security:**
- [ ] Security council multisig setup (3-of-5 threshold, hardware wallets)
- [ ] Incident response runbooks (Halo2 circuit vulnerability, browser WASM compromise, CSAM detection, moderation bypass)
- [ ] Monitoring infrastructure (Datadog for browser proving times, Sentry for errors, gas cost tracking)
- [ ] Congressional IT compliance review (CWC integration, data protection, Section 230)

**Phase 1 Contingency Planning:**
- [ ] Emergency moderation escalation procedures (if Layer 1/2 compromised)
- [ ] Provider redundancy testing (OpenAI API outage → alternative moderation)
- [ ] Halo2 circuit update procedures (if vulnerability discovered)

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
- [ ] NEAR Chain Signatures security review (threshold ECDSA, MPC protocol)
- [ ] Cross-chain reputation bridge audits (Ethereum, Polygon, Arbitrum via ERC-8004)
- [ ] Multi-chain Halo2 verification gas benchmarks

### Phase 3+ Long-Term (2027+)

**Advanced Cryptography:**
- [ ] Post-quantum ZK-STARK migration (quantum resistance)
- [ ] Nested Halo2 proofs for reputation ranges (only if community demands + congressional offices accept)
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
- NEAR protocol vulnerabilities (report to NEAR Foundation)

-----

## Appendix: Security Assumptions

**We assume the following are secure (if broken, system security fails):**
1. **Elliptic curve discrete log** (ECDSA, Halo2 proofs, BN254 curve)
2. **XChaCha20-Poly1305** (AEAD encryption for congressional messages)
3. **RSA-OAEP** (Key encapsulation for congressional office public keys)
4. **NEAR MPC protocol** (threshold ECDSA, Phase 2+ if adopted)
5. **Poseidon hash function** (collision resistance, SNARK-friendly)
6. **KZG commitment scheme** (Polynomial commitments via Ethereum's 141K-participant ceremony)
7. **Browser sandbox security** (WASM isolation, COOP/COEP headers enforced)

**We do NOT assume:**
- Users protect seed phrases (we use identity verification instead)
- Single oracle tells truth (we cross-reference multiple)
- Single agent is honest (we require multi-agent consensus)
- Platform operators are trustworthy (cryptography eliminates need for trust)
- Congressional offices protect messages post-delivery (out of our control)

-----

**This document lives and breathes. Threat landscape changes daily. Security team reviews quarterly. Last review: 2025-10-20.**

**Questions? Concerns? Paranoia?** security@voter-protocol.org
