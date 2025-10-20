# Privacy Architecture Analysis: Shielded Wallets, GKR Protocol, and Signal Aggregation

**Research Date: 2025-10-20**

This document analyzes evolving privacy technologies (shielded wallets, GKR protocol) and their implications for VOTER Protocol's architecture, specifically addressing the tension between privacy and community-level signal aggregation.

-----

## 🔥 October 2025 Update: GKR Protocol Shipping Phase 1

**DECISION: Ship GKR from day one. No Groth16. No parallel implementations.**

Published October 19, 2025 by Vitalik Buterin. We're shipping cutting-edge cryptography for Phase 1 launch (3 months).

**What Changed:**
- **Phase 3 recommendation (18-24 months) → Phase 1 reality (NOW)**
- **Research project → Production implementation**
- **"If GKR proves superior" → "Ship GKR, pivot to Groth16 only if benchmarks fail"**

**Why This Decision:**
- **Trusted setup ceremonies create permanent security liabilities** (toxic waste if participants collude)
- **Merkle tree verification is GKR's theoretically optimal use case** (Shadow Atlas district proofs)
- **Congressional offices see identical data regardless of proving system** (they receive plaintext via TEE)
- **Accept cutting-edge risk over permanent ceremony dependency**

**Benchmarking Timeline (Make-or-Break):**

**Month 1-2: Circuit Design + Proving Benchmarks**
- Implement GKR circuit using Polyhedra Expander
- Target: <10s proving time on commodity hardware
- **Milestone 1:** If proving >15s, PIVOT to Groth16 immediately

**Month 2: Fiat-Shamir + Gas Benchmarks (CRITICAL)**
- Non-interactive transformation for on-chain verification
- Deploy to Scroll testnet, measure gas costs
- **Milestone 2:** If gas >250k, PIVOT to Groth16 immediately
- Target: 200-250k gas (~$0.025 per verification at current Scroll prices)

**Month 3: Integration + Security Audit**
- Frontend integration (WASM)
- External security audit
- Mainnet deployment

**Groth16 Pivot Contingency:**

If GKR fails benchmarks:
1. Accept trusted setup ceremony (2-3 week process, 50+ participants)
2. IPFS-hosted ceremony transcript with cryptographic attestations
3. Delay Phase 1 launch by 2-3 months (total 5-6mo vs 3mo GKR timeline)
4. Document decision publicly: "GKR gas costs were $X per verification. Uneconomical. Groth16 ceremony completed."

**What We Gain if GKR Succeeds:**
- No trusted setup ceremony (permanent security win)
- No coordination overhead for multi-party ceremonies
- Theoretically optimal proving system for Merkle trees (our exact use case)
- Cutting-edge cryptography reputation

**What We Lose if GKR Fails:**
- 2-3 month delay pivoting to Groth16
- Sunk engineering time on GKR implementation (~1 month)

**What We Avoid by Choosing GKR Over Groth16 Immediately:**
- Permanent dependency on ceremony security assumptions
- Coordination complexity for 50+ independent ceremony participants
- Potential ceremony vulnerabilities (toxic waste if participants collude)

**Decision:** Ship correctly once with no trusted setup, accept cutting-edge risk. If we're wrong, we know definitively and can pivot to proven technology.

**GKR Does NOT Weaken Congressional Signal:**

Congressional offices receive plaintext messages via TEE → CWC delivery. They never interact with the proving system. GKR vs Groth16 is transparent to them. The only thing that changes is:
- Proving time (GKR potentially faster, <10s target)
- Verification gas (GKR potentially higher, <250k target)
- Trusted setup (GKR eliminates it permanently)

They see: "Verified constituent in TX-18 with healthcare reputation >5000" — identical regardless of proving system.

**Phase Architecture Updated:**
- ~~Phase 3 (18-24 months): GKR research~~
- **Phase 1 (NOW): GKR production implementation with Groth16 contingency**
- **Phase 2 (12-18 months): Privacy pools for financial privacy**
- **Phase 3+ (Speculative, 2+ years): Nested ZK only if community demands + congressional offices accept weaker signals**

See [TECHNICAL.md](../../TECHNICAL.md) and [docs/phase1-architecture-plan.md](../phase1-architecture-plan.md) for complete updated architecture.

-----

## The Privacy-Signal Paradox

**Core Question:** Can we map communities at Shadow Atlas granularity (congressional districts, city councils) to sentiments, opinions, needs while using shielded wallets?

**Current Architecture:**
- Zero-knowledge proofs prove district membership without revealing address
- Platform sees: district hash + wallet address + reputation score
- Congressional offices see: "Verified constituent in TX-18" + credibility signals
- Geographic clustering enables: "203 verified constituents in Texas sent this template"

**Shielded Wallet Architecture:**
- All transaction details (sender, recipient, amount) hidden via zk-SNARKs
- Only prover and verifier know transaction contents
- No public wallet addresses, no on-chain transaction graph
- Geographic clustering becomes: ???

**The Paradox:** Geographic signal aggregation requires linking multiple actions to shared district membership. Shielded wallets break this linkage by design.

-----

## Shielded Wallets: Technical Deep Dive

### How They Work (Zcash Model)

**Transparent Pool (t-addrs):**
- Public addresses like Bitcoin/Ethereum
- All transactions visible on-chain
- No privacy guarantees
- VOTER Protocol currently operates here

**Shielded Pool (z-addrs):**
- Transactions use zk-SNARKs (specifically Groth16 or newer Halo 2)
- Sender, recipient, amount all encrypted
- Only prover generates proof of validity without revealing details
- Network verifies proof without learning transaction contents

**Key Technical Mechanism:**
```
User creates shielded transaction:
1. Generate nullifier (prevents double-spending)
2. Create commitment (hides transaction details)
3. Prove in zero-knowledge: "I own commitment C, creating valid output D"
4. Network verifies proof, updates state, learns nothing else

Result: Wallet address never appears on-chain
```

### Adoption Reality Check

**Zcash Statistics (July 2025):**
- Only ~20% of ZEC coins are shielded
- <1% of transactions are **fully shielded** (sender, receiver, amount all hidden)
- Most wallets default to transparent addresses (easier UX)
- Privacy requires both sender AND receiver use shielded addresses

**Why Low Adoption:**
1. **UX friction** - Shielded transactions slower (proof generation time)
2. **Ecosystem compatibility** - Exchanges often don't support shielded withdrawals/deposits
3. **Regulatory pressure** - Platforms delist privacy coins to avoid scrutiny
4. **Network effects** - Small shielded pool makes transactions more traceable (less anonymity set)

### Privacy Pools: The Vitalik Solution

**Problem with Tornado Cash:**
- Honest users wanting privacy can't prove funds didn't come from hacked/sanctioned sources
- Regulators: "If you use privacy tool, you're suspicious"
- No way to prove innocence while maintaining privacy

**Privacy Pools Mechanism (Buterin et al., 2023):**
```
Honest users generate proof:
"My deposit came from one of these N addresses in Association Set A,
 where A excludes all known sanctioned/hacked addresses"

Result: Privacy + proof of clean funds origin
```

**How It Works:**
1. User deposits into privacy pool
2. User generates ZK proof: "My deposit ∈ {addresses in Association Set A}"
3. Association Set A is user-selected subset of all pool deposits
4. Exchanges/regulators verify: "This withdrawal provably didn't come from bad actors"
5. Bad actors can't generate these proofs (their addresses not in honest sets)

**Status:** Launched on Ethereum 2025, Vitalik demoed with 1 ETH deposit

**Limitations:**
- Still requires users actively generate and share association proofs
- Exchanges must support verification (ecosystem coordination problem)
- "Proof of innocence" model inverts privacy assumptions (you must prove NOT criminal)

-----

## GKR Protocol: New Proving System

### What Vitalik Just Published (October 19, 2025)

**GKR = Goldwasser-Kalai-Rothblum Protocol**

Interactive proof system optimized for **layered circuits** with repeated operations.

### How It Works

**Circuit Structure:**
```
Layer 0 (inputs) → Layer 1 → Layer 2 → ... → Layer d (outputs)

Each layer applies low-degree polynomial functions to previous layer
```

**Verification Process:**
1. Prover claims output at layer d
2. Verifier challenges: "Prove this output is correct"
3. Prover responds with polynomial evaluation
4. Verifier reduces problem: "Now prove layer d-1 was correct"
5. Repeat until reaching input layer (directly verifiable)

**Key Innovation:** Verifier work is **logarithmic in circuit size**, not linear.

### Performance vs SNARKs/STARKs

**GKR Advantages:**
- **No trusted setup** (unlike Groth16 SNARKs)
- **Extremely fast for specific structures** - 2M+ Poseidon hashes/second on consumer hardware
- **Transparent** - No cryptographic ceremonies required
- **Optimal for layered computations** - Hash chains, Merkle trees, recursive verifications

**GKR Disadvantages:**
- **Interactive protocol** (requires back-and-forth between prover/verifier)
  - Fiat-Shamir heuristic can make non-interactive but adds overhead
- **Circuit structure dependent** - Only efficient if computation naturally decomposes into layers
- **Not general-purpose** - General circuits don't benefit from GKR's advantages

**When to Use GKR (per Vitalik):**
- Proving Merkle tree membership (natural layering)
- Hash function chains (Poseidon, SHA256 in rounds)
- Recursive proof verification (verify proof of proof)
- Aggregate signatures verification

**When to Use SNARKs/STARKs:**
- General computation (arbitrary logic)
- Non-interactive proof requirements (on-chain verification)
- Universal circuits (one setup for all computations)

### GKR for VOTER Protocol

**Current Use Case: District Membership Proofs**
```
User proves: "My address ∈ Shadow Atlas Merkle tree for district TX-18"

Circuit structure:
Input: address, Merkle proof (sister nodes)
Layers: Hash computations up the tree
Output: Root hash matches on-chain Shadow Atlas root
```

**Could GKR Replace Groth16 SNARKs?**

✅ **Advantages:**
- Merkle tree verification is EXACTLY the layered structure GKR optimizes for
- No trusted setup ceremony (removes attack vector)
- Faster proving for hash-heavy computations

❌ **Disadvantages:**
- Interactive protocol requires prover-verifier communication
  - On-chain: Need Fiat-Shamir transform (adds gas costs)
  - Off-chain: Requires real-time prover availability
- Current infrastructure built around Groth16 (ecosystem compatibility)
- Verification gas costs unknown (needs benchmarking vs Groth16 ~150k gas)

**Recommendation:** Research GKR for v2 Shadow Atlas proofs. Benchmark:
- Proving time (GKR likely faster)
- Verification gas cost (critical for on-chain viability)
- Non-interactive transformation overhead (Fiat-Shamir)

-----

## Shielded Wallets + VOTER Protocol: Design Space Analysis

### Option 1: Full Shielded Wallets (Maximum Privacy)

**Architecture:**
- All VOTER tokens held in shielded pool
- All transactions (rewards, staking, transfers) use zk-SNARKs
- Wallet addresses never appear on-chain
- Reputation scores attached to nullifiers (one-time identifiers), not addresses

**Pros:**
- ✅ Maximum individual privacy (employer can't trace wallet activity)
- ✅ No on-chain transaction graph (resistance to surveillance)
- ✅ Protects against future deanonymization (no addresses to link)

**Cons:**
- ❌ **Destroys geographic signal aggregation**
  - Can't prove: "203 people in Texas sent this template"
  - Can only prove: "203 shielded wallets sent this template" (no district info)
- ❌ **Breaks reputation portability**
  - Reputation attached to nullifiers (disposable identifiers), not persistent addresses
  - Can't build long-term credibility score
- ❌ **Eliminates impact correlation tracking**
  - Can't link: "This wallet sent templates before 3 successful bills"
  - No temporal clustering analysis possible
- ❌ **Makes Sybil resistance nearly impossible**
  - Can't rate-limit by wallet (wallet IDs change with each transaction)
  - Identity verification can't link to on-chain activity (no persistent identifier)
- ❌ **Congressional dashboard becomes useless**
  - Can't show: "12 verified constituents in your district sent this"
  - Only: "Some shielded wallets sent this" (zero signal value)

**Verdict:** Full shielded wallets incompatible with VOTER's core value proposition (verified constituent signals to congressional offices).

### Option 2: Shielded Transactions, Transparent Reputation (Hybrid)

**Architecture:**
- VOTER token transfers happen in shielded pool (private)
- Reputation registry remains transparent (public)
- Challenge market stakes use shielded deposits
- District proofs publicly record district hash (not wallet address)

**Example Flow:**
```
1. User earns VOTER reward → shielded transaction (private amount)
2. Reputation update: Public contract records "+500 reputation for wallet X in healthcare domain"
3. Challenge market: Shielded deposit stake, public resolution outcome
4. District proof: Public record "district TX-18 verified" (no wallet linkage)
```

**Pros:**
- ✅ Transaction amounts private (can't calculate someone's total holdings)
- ✅ Reputation remains portable and verifiable
- ✅ Geographic clustering still works (district proofs public)
- ✅ Congressional signal aggregation preserved

**Cons:**
- ❌ **Reputation leakage reveals participation patterns**
  - Public: "Wallet X earned healthcare reputation 18 times in 3 months"
  - Can infer: High civic engagement, likely employed in healthcare sector
- ❌ **District hash + reputation + timestamps = narrowing identity**
  - "Wallet in TX-18 with high climate reputation who participated during COP29"
  - Small anonymity set (how many climate activists in that district active then?)
- ❌ **Shielded pool still small** (Zcash problem)
  - If only VOTER uses shielded transactions, pool is tiny
  - Easier to correlate shielded deposits/withdrawals via timing analysis
- ❌ **Complexity** (two systems: shielded for transfers, transparent for reputation)

**Verdict:** Improves privacy for transaction amounts, but reputation + district data still leak enough for motivated deanonymization.

### Option 3: Privacy Pools + Association Proofs

**Architecture:**
- Users deposit VOTER into privacy pools
- Generate ZK proofs: "My deposit came from honest association set A"
- Association sets defined by district membership
- Congressional offices verify: "This message came from privacy pool with TX-18 association proof"

**Example:**
```
TX-18 Association Set = {all wallets that proved TX-18 district membership}

User generates proof:
"I am member of TX-18 Association Set, my funds came from honest deposits"

Congressional office verifies:
✓ Proof valid
✓ Association set = TX-18
✓ No linkage to sanctioned addresses
✓ Message content + reputation score attached to proof
```

**Pros:**
- ✅ Privacy: Individual wallet address hidden within association set
- ✅ Signal aggregation: Can count "N members of TX-18 association sent this"
- ✅ Proof of innocence: Association sets exclude sanctioned addresses
- ✅ Regulatory compliance: "Not a mixer for criminals"

**Cons:**
- ❌ **Association set size reveals district population**
  - TX-18 association has 1,200 members → ~1,200 active VOTER users in district
  - Small sets (rural districts) have tiny anonymity sets
- ❌ **Temporal correlation still possible**
  - "Member of TX-18 association active during healthcare debate"
  - If only 5 people from association active that week, anonymity set = 5
- ❌ **Requires ecosystem adoption**
  - Congressional offices must support association proof verification
  - Exchanges must recognize privacy pool deposits
  - Currently only Ethereum mainnet (Scroll L2 integration uncertain)
- ❌ **Reputation still linkable to association membership**
  - "High-reputation member of TX-18 association" narrows identity significantly

**Verdict:** Best hybrid approach, but anonymity set size remains fundamental limitation.

### Option 4: Nested Privacy (ZK Proofs of ZK Proofs)

**Architecture:**
- Outer proof: "I am member of district TX-18" (public, on-chain)
- Inner proof: "My specific actions come from shielded wallet within TX-18 set" (private)
- Congressional offices see: District membership proven, but can't link individual actions

**Example:**
```
User generates:
1. District proof: "I ∈ TX-18" → Creates TX-18 membership credential (public)
2. Action proof: "This action comes from wallet with TX-18 credential" (shielded)

Congressional office verifies:
✓ Action proof valid
✓ Credentials indicates TX-18
✓ But can't tell WHICH TX-18 member sent this
✓ Can count: "N actions from TX-18 members" (aggregation preserved)
```

**Pros:**
- ✅ Individual actions unlinkable (maximum privacy)
- ✅ Geographic aggregation preserved (count actions per district)
- ✅ Reputation can accumulate privately (ZK proofs of reputation ranges)
- ✅ Sybil resistance maintained (identity verification links to credential, not actions)

**Cons:**
- ❌ **Enormous computational overhead**
  - Proving ZK proof of ZK proof = recursive proof verification
  - GKR might help here (Vitalik mentions recursive verification as use case)
  - Still experimental, no production systems at scale
- ❌ **Lose temporal granularity**
  - Can count actions per district per time window
  - Can't track: "Same wallet sent 3 templates over 6 months" (no persistent identity)
- ❌ **Reputation becomes range proofs, not exact scores**
  - Congressional office sees: "Healthcare reputation >5000" (not exact 8,740)
  - Less precise signal for filtering quality
- ❌ **Impact correlation impossible**
  - Can't link: "This specific wallet's templates influenced 3 bills"
  - Only: "Templates from TX-18 members correlated with bills" (weaker signal)

**Verdict:** Maximizes privacy, preserves geographic aggregation, but destroys individual reputation tracking and impact correlation.

-----

## Do We Still Need Scroll?

**Current Architecture:** Scroll zkEVM (Ethereum L2) for primary settlement

**Question:** If we adopt GKR or full privacy system, does Scroll matter?

### Why We Chose Scroll

1. **ZK-native infrastructure** - Built for SNARK verification
2. **Ethereum security** - L2 inherits Ethereum finality
3. **Low cost** - $0.0047-$0.0511 per transaction
4. **EVM compatibility** - Standard Solidity contracts work
5. **Stage 1 decentralization** - No training wheels

### With GKR Protocol

**GKR doesn't change settlement layer requirements:**
- Still need on-chain verification of proofs
- Still need smart contracts for reputation, challenge markets, outcome markets
- GKR changes PROVING SYSTEM, not settlement layer

**Scroll Advantages Remain:**
- ZK-native infrastructure beneficial even if switching to GKR
- Low-cost verification critical (GKR gas costs TBD, but on-chain verification still required)
- Ethereum security guarantees still valuable

**Alternative L2s to Consider:**
- **StarkNet** - Already uses STARKs (similar properties to GKR), might have better tooling
- **zkSync** - ZK-focused, but different proof system
- **Base** - OP rollup, no ZK infrastructure (regression)

**Verdict:** Scroll still makes sense. GKR is orthogonal to settlement layer choice.

### With Shielded Wallets

**Shielded transactions change infrastructure requirements:**
- Need shielded pool support (ERC-20 shielding, Zcash-style)
- Need efficient SNARK verification for transaction privacy
- Need coordination with privacy pool standards (if using Vitalik's approach)

**Scroll Considerations:**
- Not currently specialized for shielded transactions (unlike Aztec L2)
- Would need custom privacy pool implementation
- Gas costs for shielded tx verification higher than simple transfers

**Alternative Architectures:**
- **Aztec Network** - Privacy-first L2, shielded by default
  - Pros: Built for privacy, entire ecosystem supports shielded txs
  - Cons: Smaller ecosystem, less Ethereum composability, newer/less tested
- **Zcash** - Dedicated privacy chain
  - Pros: Battle-tested shielded pool (since 2016)
  - Cons: Not EVM compatible, siloed from Ethereum DeFi
- **Mina Protocol** - Constant-size blockchain
  - Pros: Recursive SNARKs (nested proofs easier)
  - Cons: Less ecosystem, unproven at scale

**Verdict:** If adopting full shielded architecture, Scroll is NOT optimal. Aztec or dedicated privacy L2 would be better.

-----

## Recommended Architecture Evolution

### Phase 1: GKR Protocol on Scroll (Current - 3 Months to Launch)

**Updated Architecture (October 2025):**
- **District proofs via GKR protocol** (no trusted setup, Polyhedra Expander implementation)
- **Transparent wallet addresses** (unchanged from Groth16 plan)
- **Public reputation scores** (unchanged)
- **Geographic aggregation works perfectly** (unchanged)
- **Congressional signal fully functional** (unchanged)

**Changes from Original Plan:**
- ~~Groth16 SNARKs~~ → **GKR protocol with Fiat-Shamir transformation**
- ~~Trusted setup ceremony~~ → **No ceremony required (GKR advantage)**
- ~~150k gas verification~~ → **Target 200-250k gas (acceptable overhead for no trusted setup)**
- ~~8-12s proving time~~ → **Target 8-10s proving time (potentially faster with GKR)**

**Privacy Limitations (Identical to Groth16):**
- Transaction graph public (can track wallet activity)
- Reputation scores linkable to wallets
- Employers/doxxers can correlate on-chain activity with leaked identity

**GKR vs Groth16 Does Not Change Privacy:**
- Both prove district membership without revealing address (identical privacy guarantee)
- Both create public on-chain transaction records (identical transparency)
- GKR only eliminates trusted setup risk, doesn't add privacy

**Verdict:** Ship GKR for Phase 1. Accept cutting-edge risk for permanent security win (no trusted setup). Groth16 contingency if benchmarks fail.

### Phase 2: Privacy Pools for Financial Privacy (12-18 months post-launch)

**Upgrade:**
- Implement Vitalik-style privacy pools for VOTER token transfers
- Keep reputation registry transparent (public contract)
- District proofs remain public (required for signal aggregation)
- Association sets defined by district membership

**Privacy Improvements:**
- Transaction amounts private (shielded pool)
- Can't calculate individual's total holdings
- Proof of clean funds origin (regulatory compliance)

**Signal Preservation:**
- Geographic clustering: ✅ (association sets)
- Reputation tracking: ✅ (public registry)
- Impact correlation: ✅ (public action records)
- Congressional filtering: ✅ (district association proofs)

**Tradeoffs:**
- Association set size reveals district activity level (acceptable leakage)
- Temporal patterns still correlatable (mitigate with batching)

**Verdict:** Best near-term privacy upgrade without destroying core value prop.

### Phase 3+ (Speculative): Nested ZK for Maximum Privacy (2+ years)

**MOVED FROM PHASE 3:** GKR protocol now shipping Phase 1 (October 2025 decision).

**Only if:**
- Recursive proof verification becomes practical at scale
- Congressional offices willing to sacrifice exact reputation scores for ranges
- Community demands stronger privacy than privacy pools provide

**Architecture:**
- Outer proof: District membership credential (one-time generation)
- Inner proof: Actions authenticated with credential, but unlinkable
- Reputation as range proofs ("score >5000" not exact)
- Impact correlation at district level, not individual level

**Tradeoffs:**
- ✅ Maximum individual privacy (employer can't trace any activity)
- ❌ Lose individual reputation tracking (weaker congressional signal)
- ❌ Enormous computational overhead (nested proofs expensive)
- ❌ Unproven at production scale

**Verdict:** Monitor research (GKR recursive proofs, Nova folding schemes). Not ready for production.

-----

## Signal Aggregation: Can We Still Map Communities?

**Core Question Revisited:** With privacy upgrades, can we map Shadow Atlas granularity to sentiments/opinions/needs?

### What We Lose with Each Privacy Tier

**Privacy Pools:**
- ❌ Individual wallet tracking (can't follow one person's evolution)
- ✅ District-level aggregation (association sets preserve this)
- ✅ Temporal clustering (can batch by time windows)
- ✅ Topic clustering (reputation domains remain public)

**Nested ZK Proofs:**
- ❌ Individual reputation scores (range proofs only)
- ❌ Individual impact tracking (can't attribute bills to specific wallets)
- ✅ District-level counts (actions per district preserved)
- ⚠️ Topic clustering (weaker, requires ZK proofs of domain expertise)

**Full Shielded Wallets:**
- ❌ District-level aggregation (no public district data)
- ❌ Reputation tracking (nullifiers not persistent)
- ❌ All signal aggregation destroyed

### What Congressional Offices Actually Need

From [McDonald 2018 survey](http://www.samiam.info/wp-content/uploads/2019/02/ConstiuentCorrespondence_McDonald_Dec_2018.pdf):

**Staffers Want:**
- "Small surprising things like bills they may have missed"
- "More niche issues" with informed reasoning
- Ability to distinguish quality from spam

**Signal Requirements:**
1. **District verification** - "Is this actually my constituent?" (CRITICAL)
2. **Domain expertise** - "Does this person know healthcare policy?" (HIGH VALUE)
3. **Impact history** - "Have their templates influenced bills before?" (HIGH VALUE)
4. **Volume clustering** - "How many constituents care about this?" (MODERATE VALUE)
5. **Personal story** - "Why does this matter to them?" (HIGH VALUE, but per-message)

### Privacy-Signal Matrix

| Architecture | District Verified | Domain Expertise | Impact History | Volume Count | Signal Grade |
|-------------|------------------|------------------|----------------|--------------|-------------|
| Current (transparent) | ✅ | ✅ Exact scores | ✅ Individual tracking | ✅ Exact counts | A+ |
| Privacy Pools | ✅ Association sets | ✅ Exact scores | ✅ Individual tracking | ✅ Set size counts | A |
| Nested ZK | ✅ Credentials | ⚠️ Range proofs | ❌ District-level only | ✅ Action counts | B |
| Full Shielded | ❌ No district data | ❌ No reputation | ❌ No tracking | ❌ No signal | F |

**Conclusion:** Privacy pools preserve 95% of congressional signal value while massively improving individual privacy.

-----

## Final Recommendations

### Immediate (Phase 1 - Current, 3 Months to Launch)

**Ship GKR Protocol on Scroll:**
- **DECISION CHANGE:** ~~Groth16~~ → GKR protocol (October 2025)
- No trusted setup (permanent security win over Groth16)
- Geographic aggregation works perfectly (identical to Groth16)
- Congressional dashboard fully functional (identical to Groth16)
- Privacy adequate for launch (ZK district proofs prevent address exposure, identical to Groth16)
- Benchmarking gates: <10s proving, <250k gas, or PIVOT to Groth16

**Accept Current Limitations:**
- Transaction graph public (mitigate with advice: "Use fresh wallet for VOTER")
- Reputation linkable to wallets (acceptable tradeoff for signal quality)
- **Cutting-edge risk:** GKR published 11 days ago, Groth16 contingency if benchmarks fail

### Near-Term (Phase 2 - 12-18 months post-launch)

**Implement Privacy Pools for VOTER Transfers:**
- Adopt Vitalik's privacy pool architecture (2025 Ethereum mainnet launch)
- Define association sets by congressional district
- Keep reputation registry transparent (required for signal)
- Generate proofs of clean funds origin (regulatory compliance)

**Benefits:**
- Financial privacy (transaction amounts hidden)
- Regulatory compliance (proof of innocence)
- Signal preservation (95%+ of current value)
- No loss of core value proposition

**Note:** GKR research COMPLETED - shipping Phase 1 (October 2025 decision).

### Long-Term Research (v3+ - 2+ years)

**Monitor Recursive Proof Systems:**
- GKR for recursive verification (Vitalik mentioned this use case)
- Nova folding schemes (IVC/PCD research)
- Halo 2 accumulation (no trusted setup, recursive)

**Evaluate Nested ZK if:**
- Community demands stronger privacy than privacy pools
- Congressional offices accept range proofs instead of exact scores
- Computational overhead becomes practical (<2s proving time)

**DO NOT:**
- Migrate to full shielded wallets (destroys signal)
- Adopt architecture that prevents geographic clustering
- Sacrifice reputation portability for marginal privacy gains

### Settlement Layer (Scroll Question)

**Stay on Scroll for v2:**
- Privacy pools can be implemented on any EVM L2
- Scroll's ZK infrastructure beneficial even if adopting GKR
- Low gas costs critical for scaled verification
- Migration costs not justified by current alternatives

**Re-evaluate for v3 IF:**
- Aztec Network matures and offers better privacy tooling
- Nested ZK architecture requires specialized L2 features
- Ethereum mainnet gas costs drop enough to skip L2 entirely

-----

## The Bottom Line

**Privacy and signal aggregation are NOT mutually exclusive** if we use the right architecture.

**Privacy Pools (Vitalik's 2023/2025 work) solve the paradox:**
- Individual privacy: ✅ (shielded transactions, association set anonymity)
- Geographic clustering: ✅ (association sets defined by district)
- Reputation tracking: ✅ (public registry, attached to proofs not addresses)
- Impact correlation: ✅ (action records preserved)
- Regulatory compliance: ✅ (proof of innocence via association sets)
- Congressional signal: ✅ (95% of current value retained)

**GKR Protocol (Vitalik's October 2025 post) shipping Phase 1:**
- **UPDATE:** No longer research project, shipping from day one (October 2025 decision)
- Potentially faster proving for Merkle tree district proofs (<10s target)
- Removes trusted setup ceremony (permanent security win over Groth16)
- Doesn't change settlement layer requirements (Scroll still appropriate)
- Groth16 contingency if benchmarks fail (gas >250k or proving >15s)

**Full shielded wallets (Zcash-style) are incompatible:**
- Destroy geographic signal aggregation (core value prop)
- Break reputation portability (no persistent identifiers)
- Eliminate impact tracking (can't link actions over time)
- Small anonymity sets make privacy questionable anyway

**The path forward:** GKR shipping Phase 1 (October 2025 decision), privacy pools in Phase 2, nested ZK monitoring for Phase 3+. Scroll remains appropriate settlement layer unless specialized privacy L2 proves dramatically superior.

**Privacy without destroying signal is possible. Privacy pools are how. GKR eliminates trusted setup without changing privacy guarantees.**
