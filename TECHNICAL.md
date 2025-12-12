# Technical Architecture: Cryptographic Democracy Infrastructure

**For blockchain developers, cryptography engineers, protocol designers.**

This document covers implementation details the README abstracts away. Assumes familiarity with zero-knowledge proofs, threshold cryptography, and confidential computing.

-----

## Phase Architecture Overview

VOTER Protocol ships in two phases. Phase 1 establishes cryptographic foundations and reputation infrastructure with **full privacy from day one** (browser-native ZK proofs, selective disclosure). Phase 2 adds token economics and financial mechanisms.

### Phase 1 (Current - Launch-Ready, 3 months)

**Cryptographic Infrastructure:**
- **Noir/Barretenberg zero-knowledge district proofs** (browser-native WASM proving, UltraPlonk + KZG commitment, production-grade since 2024)
- **Message content encryption from platform operators** (XChaCha20-Poly1305, delivered as plaintext to congressional offices via CWC API)
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

-----

## Core Cryptographic Primitives

**VOTER Protocol has THREE separate systems with different privacy architectures:**

1. **Address Verification (ZK Proofs)** - 100% client-side + on-chain, zero AWS dependency
2. **Identity Verification (Phase 2 Only)** - For economic incentives and Sybil resistance
3. **Message Delivery (Nitro Enclaves)** - For congressional SOAP API delivery requirements

**Each system has distinct privacy properties and dependencies. This section covers all three.**

---

### 1. Zero-Knowledge Address Verification (Browser-Native Noir/Barretenberg)

**Problem:** Prove congressional district membership without revealing address. Address never exposed to platform operators or stored in databases.

**Why Noir/Barretenberg:** Production-grade UltraPlonk with KZG commitments. Leverages Aztec's 100K+ participant ceremony (no custom trusted setup). Browser-native WASM proving via `@aztec/bb.js`. Merkle tree membership proofs are standard use case.

**Architecture:** Browser-native proving (zero cloud dependency)

**Implementation:**
- **Circuit:** Noir circuit for Merkle tree membership (`packages/crypto/noir/district_membership/`)
  - **UltraPlonk proving system** with KZG commitments (Aztec ceremony, 100K+ participants)
  - Shadow Atlas single-tier Merkle tree (14 levels per district, ~16K addresses)
  - On-chain DistrictRegistry mapping district roots → country codes (public data, governance-controlled)
  - BN254 curve (Ethereum-compatible)
  - **Poseidon2 hash** (T=4, optimized for UltraPlonk constraints)
- **Shadow Atlas:** Global electoral district mapping (Congressional districts, Parliamentary constituencies, city councils for 190+ countries)
  - Single-tier structure: One balanced tree per district (14 levels, ~16K addresses)
  - District→country mapping: On-chain registry (DistrictRegistry.sol, multi-sig governed)
  - Quarterly IPFS updates with new district roots published on-chain
  - **Progressive loading:** District trees downloaded on-demand, cached in IndexedDB
  - Poseidon2 hash function for Merkle tree (SNARK-friendly, T=4 configuration)
  - **Parallel witness generation:** Web Workers distribute Poseidon2 hashing
- **Proving Flow (Browser-Native WASM via @aztec/bb.js):**
  1. **Shadow Atlas loading:** Browser downloads user's district tree from IPFS (50MB, cached in IndexedDB after first use)
     - Progressive loading: Streaming download with early start to witness generation
     - Compression: Zstd reduces IPFS transfer to ~15MB
     - Cache hit: <10ms IndexedDB retrieval (subsequent proofs instant)
  2. **Witness generation:** `@noir-lang/noir_js` computes witness from circuit inputs
     - Poseidon2 hashing for 14-level Merkle path
     - Total time: 200-400ms on modern devices, 800ms-1.5s on mid-range mobile
  3. **WASM proof generation:** Barretenberg proving in browser via `@voter-protocol/bb.js`
     - UltraPlonk with KZG commitments (~4,000 constraints)
     - WASM with SharedArrayBuffer (COOP/COEP headers required)
     - Multi-threaded proving when `crossOriginIsolated === true`
     - **Proving time:** 8-15s on mid-range Android (Snapdragon 7 series)
     - Memory: ~400-600MB peak (mobile-optimized)
  4. **Proof submission:** Generated proof submitted directly to Scroll L2 (no server intermediary)

  **Total end-to-end UX: 8-15s on mobile (after first district tree download), works on 95%+ of devices**

- **Verification:** On-chain smart contract verifies UltraPlonk proof against current Shadow Atlas root
  - Gas cost: 300-400k gas on Scroll L2
  - Typical verification on Scroll: < $0.01; defer specifics to the canonical costs section
- **Privacy guarantee (CURRENT, Phase 1):**
  - **Address NEVER leaves browser** (zero server transmission, true privacy from day one)
  - Shadow Atlas district tree is public data (IPFS, no privacy concerns)
  - Witness generation happens client-side in Web Workers (isolated JavaScript execution)
  - **Proof reveals only district hash, never address** (selective disclosure of location without revealing exact address)
  - **Zero AWS dependency for on-chain identity** (browser-native ZK proofs, Scroll L2, IPFS)
  - **This is peak privacy for district verification** - address stays local, only membership proof goes on-chain
  - **AWS Nitro dependency** applies ONLY to message delivery (separate system, see below)

**Smart Contract Implementation (Two-Step Verification):**

```solidity
// Step 1: On-chain registry maps district roots to countries
contract DistrictRegistry {
    mapping(bytes32 => bytes3) public districtToCountry; // district_root → ISO country code
    address public governance; // Multi-sig address

    function registerDistrict(bytes32 districtRoot, bytes3 country) external onlyGovernance {
        require(districtToCountry[districtRoot] == bytes3(0), "Already registered");
        districtToCountry[districtRoot] = country;
        emit DistrictRegistered(districtRoot, country, block.timestamp);
    }

    function getCountry(bytes32 districtRoot) external view returns (bytes3) {
        bytes3 country = districtToCountry[districtRoot];
        require(country != bytes3(0), "District not registered");
        return country;
    }
}

// Step 2: Master verification contract orchestrates ZK proof + registry lookup
contract DistrictGate {
    address public immutable verifier;  // UltraPlonk verifier (Noir/Barretenberg)
    DistrictRegistry public immutable registry;
    mapping(bytes32 => bool) public nullifierUsed;

    /// @notice Two-step verification: ZK proof + registry lookup
    /// @dev Step 1: Verify cryptographic proof of district membership
    ///      Step 2: Verify district is registered for expected country
    function verifyAndAuthorize(
        bytes calldata proof,
        bytes32 districtRoot,   // ← Per-district root (not global)
        bytes32 nullifier,      // ← Prevents double-voting
        bytes32 actionId,       // ← Action identifier
        bytes3 expectedCountry  // ← ISO 3166-1 alpha-3 code
    ) external {
        // Step 1: Verify ZK proof
        uint256[3] memory publicInputs = [uint256(districtRoot), uint256(nullifier), uint256(actionId)];
        (bool success, bytes memory result) = verifier.call(
            abi.encodeWithSignature("verifyProof(bytes,uint256[3])", proof, publicInputs)
        );
        require(success && abi.decode(result, (bool)), "ZK proof verification failed");

        // Step 2: Check district→country mapping (on-chain governance)
        bytes3 actualCountry = registry.getCountry(districtRoot);
        require(actualCountry == expectedCountry, "Unauthorized district");

        // Prevent double-voting
        require(!nullifierUsed[nullifier], "Nullifier already used");
        nullifierUsed[nullifier] = true;

        emit ActionVerified(msg.sender, districtRoot, actualCountry, nullifier, actionId);
    }
}
```

**Why Two-Step Verification:**

**Step 1 (Cryptographic)**: ZK proof prevents identity spoofing
- User cannot fake membership in a district
- Merkle proof enforced by circuit constraints
- Nullifier prevents double-voting (computed in-circuit, cannot be manipulated)

**Step 2 (On-Chain Registry)**: Registry lookup prevents fake districts
- DistrictRegistry maps district_root → country code
- Multi-sig governance controls registry updates
- All changes auditable via on-chain events
- District→country is PUBLIC data (congressional districts are known)

**Security Model:**
- Attack requires compromising BOTH cryptography AND governance
- Correct tool for the job: cryptography for secrets, governance for public data

**See:** `packages/crypto/circuits/ARCHITECTURE_EVOLUTION.md` for complete architectural rationale

**Browser-Native Implementation (TypeScript + WASM):**

**Client-Side: Shadow Atlas Loading and Caching**
```typescript
// Download district tree from IPFS, cache in IndexedDB
async function loadDistrictTree(district: string): Promise<DistrictTree> {
  // 1. Check IndexedDB cache first
  const cached = await indexedDB.get(`district_tree_${district}`);
  if (cached && !isStale(cached)) {
    return cached; // Cache hit: <10ms
  }

  // 2. Download from IPFS (first time only)
  const ipfsHash = await getShadowAtlasIPFSHash(district);
  const compressed = await fetch(`https://ipfs.io/ipfs/${ipfsHash}`);

  // 3. Decompress (Zstd: 50MB → 15MB transfer)
  const treeData = await decompressZstd(await compressed.arrayBuffer());

  // 4. Cache in IndexedDB for future use
  await indexedDB.put(`district_tree_${district}`, {
    data: treeData,
    timestamp: Date.now(),
    district
  });

  return parseDistrictTree(treeData);
}

// Witness generation with Web Workers (parallel Poseidon hashing)
async function generateWitness(
  address: string,
  districtTree: DistrictTree
): Promise<MerkleWitness> {
  // 1. Find address in district tree (binary search: ~log2(4K) = 12 lookups)
  const leafIndex = districtTree.findAddress(address);
  if (leafIndex === -1) throw new Error("Address not found in district");

  // 2. Compute Merkle path (12 levels: single-tier district tree)
  const merklePath = districtTree.computePath(leafIndex);

  // 3. Distribute Poseidon hashing across 4 Web Workers
  const workers = createWorkerPool(4);
  const pathHashes = await Promise.all(
    merklePath.map((node, i) =>
      workers[i % 4].computePoseidonHash(node.left, node.right)
    )
  );

  return {
    identityCommitment: address,  // Private witness
    leafIndex,                     // Position in district tree (0-4095)
    merklePath: pathHashes,        // 12 sibling hashes
    districtRoot: districtTree.root, // District tree root (verified against registry)
    actionId: hash("contact_rep")    // Action identifier
  };
}
```

**Browser WASM Proving (Noir/Barretenberg):**
```typescript
import { Barretenberg } from '@voter-protocol/bb.js';
import { Noir } from '@noir-lang/noir_js';
import circuitJson from './district_membership.json';

// NoirProver - Browser-native ZK proving with Barretenberg
// Runs in browser WASM with SharedArrayBuffer + multi-threading
class NoirProver {
    private api: Barretenberg | null = null;
    private noir: Noir | null = null;
    private bytecode: Uint8Array | null = null;
    private provingKey: Uint8Array | null = null;

    // Initialize Barretenberg backend + Noir witness generator
    async init(): Promise<void> {
        this.api = await Barretenberg.new();
        this.noir = new Noir(circuitJson);
        // Decompress circuit bytecode for proving
        const bytecodeBuffer = Uint8Array.from(atob(circuitJson.bytecode), c => c.charCodeAt(0));
        this.bytecode = inflate(bytecodeBuffer);
    }

    // Pre-warm prover by generating proving key (call on app load)
    async warmup(): Promise<void> {
        await this.init();
        const result = await this.api!.acirGetProvingKey({
            circuit: { name: 'district_membership', bytecode: this.bytecode! },
            settings: { ipaAccumulation: false, oracleHashType: 'poseidon', disableZk: false }
        });
        this.provingKey = result.provingKey;
    }

    // Generate ZK proof for district membership
    async prove(inputs: CircuitInputs): Promise<ProofResult> {
        await this.warmup();

        // 1. Use Noir to generate witness from circuit inputs
        const noirInputs = {
            merkle_root: inputs.merkleRoot,
            nullifier: inputs.nullifier,
            authority_hash: inputs.authorityHash,
            epoch_id: inputs.epochId,
            campaign_id: inputs.campaignId,
            leaf: inputs.leaf,
            merkle_path: inputs.merklePath,  // 14 sibling hashes
            leaf_index: inputs.leafIndex,
            user_secret: inputs.userSecret,
        };
        let { witness } = await this.noir!.execute(noirInputs);

        // 2. Generate UltraPlonk proof with Barretenberg
        // Uses multi-threading when crossOriginIsolated === true
        const result = await this.api!.acirProveWithPk({
            circuit: { name: 'district_membership', bytecode: this.bytecode! },
            witness,
            provingKey: this.provingKey!,
            settings: { ipaAccumulation: false, oracleHashType: 'poseidon', disableZk: false }
        });

        // 3. Return proof (~400-500 bytes, address never included)
        return { proof: result.proof, publicInputs: { ... } };
    }
}
```

**TypeScript Integration:**
```typescript
// Main proving flow (called from user-facing UI)
async function generateDistrictProof(address: string, district: string): Promise<ProofResult> {
  // 1. Load district tree (IPFS + IndexedDB cache)
  const districtTree = await loadDistrictTree(district); // 50MB first time, <10ms cached

  // 2. Generate witness with Web Workers (200-400ms modern, 800ms-1.5s mobile)
  const witness = await generateWitness(address, districtTree);

  // 3. Prove in WASM (8-15s on mid-range mobile, ~4K constraints)
  const prover = new NoirProver();
  const proof = await prover.prove(witness);

  return {
    proof,
    districtRoot: witness.districtRoot,  // Per-district root (verified against registry)
    nullifier: witness.nullifier,         // Prevents double-voting
    actionId: witness.actionId            // Action identifier
  };
}
```

**Why Browser-Native Noir/Barretenberg Wins:**

**Performance Benchmarks (Browser-Native UltraPlonk + KZG):**

**Production Performance (~4,000 constraints):**

**NOTE:** These are production specifications for the deployed Noir circuit.
- **Browser WASM proving time:**
  - Modern mobile (2021+, Snapdragon 7 series): 8-15 seconds (production-ready)
  - Circuit: ~4,000 constraints (Noir/UltraPlonk)
  - Verifier bytecode: 20,142 bytes (fits EIP-170 24KB limit with 18% margin)
  - Memory: ~400-600MB peak (mobile-optimized)
  - Cost: $0 (client-side computation, no server)

- **End-to-end user experience (first time):**
  - Shadow Atlas download: 15MB compressed IPFS transfer (~3-5s on good connection)
  - Witness generation (Web Workers): 200-400ms (modern), 800ms-1.5s (mobile)
  - WASM proof generation: 8-15s (mobile, ~4K constraints)
  - Submit to Scroll L2: 2-5s (block confirmation)
  - **Total first time: 11-24s** (mobile + good network)

- **End-to-end user experience (subsequent proofs):**
  - IndexedDB cache hit: <10ms
  - Witness generation: 200ms-1.5s
  - WASM proof generation: 8-15s (mobile)
  - Submit to Scroll L2: 2-5s
  - **Total cached: 10-22s** (district tree already downloaded)

- **Device compatibility:** 95%+ (requires SharedArrayBuffer support, COOP/COEP headers)
  - Works on modern browsers (Chrome 92+, Safari 15.2+, Firefox 101+)
  - Mobile: Android Chrome 92+, iOS Safari 15.2+
  - Progressive enhancement: Older browsers see "upgrade browser" message

- **Verification gas:** 300-400k gas on Scroll L2 (UltraPlonk verification)
  - Typical verification on Scroll: < $0.01; defer specifics to the canonical costs section
  - Platform subsidizes all gas costs (users pay nothing)

- **Proof size:** 384-512 bytes (same as before, KZG commitment slightly larger)

**Why Browser-Native Noir/Barretenberg Wins:**

**vs. Groth16 (trusted setup alternative):**
- ✅ UltraPlonk uses Aztec's 100K+ participant KZG ceremony (no custom trusted setup)
- ✅ No custom ceremony coordination overhead
- ✅ Production-grade since 2024 in Aztec Protocol
- ⚖️ Slightly higher gas (300-500k vs 150-250k for Groth16) — acceptable tradeoff for universal setup

**Decision:** Noir/Barretenberg provides optimal balance:
- **Security:** UltraPlonk with KZG commitment (Aztec ceremony, 100K+ participants)
- **Performance:** 8-15s mobile proving (production-ready, stable)
- **Privacy:** Address never leaves browser, zero server trust
- **Cost:** $0 infrastructure (browser-native, no servers)
- **Deployability:** Verifier fits EIP-170 limit
- **Cypherpunk values:** Peer-reviewed mathematics, zero AWS dependency for identity

---

## Architecture Evolution: Why Single-Tier + Registry

### The Problem We Solved

**Initial Architecture (Two-Tier Circuit)**:
- Proved district→country relationship cryptographically inside ZK proof
- K=14 circuit (16,384 rows), ~189,780 advice cells
- Generated 26KB verifier bytecode (exceeds EIP-170 24KB limit)
- 30+ second proving on mid-range Android (unusable for mobile deployment)

**Blocking Issues**:
1. **EIP-170 violation**: Cannot deploy 26KB verifier to Ethereum or Scroll (protocol-level enforcement)
2. **Mobile unusable**: 30+s proving drains battery, crashes apps, fails on 50%+ of devices
3. **No easy fix**: Solidity optimizer fails with "Stack too deep", Via-IR compilation eliminates verification logic

### The Solution

**Single-Tier Circuit + On-Chain Registry**:
- K=14 circuit (16,384 rows), 117,473 advice cells, 8 columns
- Generates 20,142 byte verifier bytecode (fits EIP-170 limit with 18% margin)
- 8-15 second proving on mid-range Android (production-ready, stable)
- DistrictRegistry.sol maps district roots → country codes (on-chain, governance-controlled)

**Two-Step Verification**:
1. **ZK Proof**: "I am member of district X" (cryptographic security)
2. **Registry Lookup**: "District X is in country Y" (on-chain governance, ~2.1k gas)

### Why This Is NOT a Security Downgrade

**Key Insight**: District→country mappings are **PUBLIC data** (congressional districts are known to everyone).

**Security Comparison**:

| Security Property | Two-Tier Circuit | Single-Tier + Registry |
|-------------------|------------------|------------------------|
| Prevent identity spoofing | ✅ ZK proof | ✅ ZK proof |
| Prevent double-voting | ✅ Nullifier | ✅ Nullifier |
| Prevent address fabrication | ✅ Merkle proof | ✅ Merkle proof |
| Verify district→country | ✅ ZK proof (Tier 2) | ✅ On-chain registry |
| Attack surface | Crypto only | Crypto + multi-sig |
| Auditability | Opaque (inside ZK) | Transparent (on-chain events) |

**Attack Scenarios**:
- **User fakes identity**: ZK proof prevents (Merkle verification fails)
- **User claims unauthorized district**: Registry prevents (transaction reverts, district not registered)
- **Compromised governance adds fake district**: Multi-sig threshold (5-of-9) + community monitoring via on-chain events
- **Collusion (crypto + governance)**: Requires breaking BOTH cryptography AND multi-sig (equivalent to two-tier + compromised verifier deployment)

**The Right Tool for the Job**:
- **Cryptography for secrets**: Identity, address, membership proof (NEVER reveal these)
- **Governance for public data**: District→country mappings (everyone already knows congressional districts)

**Analogy**: ENS (Ethereum Name Service)
- ENS proves name ownership **cryptographically** (ECDSA signatures)
- ENS maps names→addresses via **smart contracts** (governance + transparency)
- Nobody says ENS is "insecure" because name→address mapping isn't in a ZK proof

### Performance Gains

**Circuit Complexity**:
- Rows: 16,384 (K=14 two-tier) → 16,384 (K=14 single-tier) - same
- Advice cells: ~189,780 (two-tier) → 117,473 (single-tier) - 38% fewer
- Advice columns: 12 (two-tier) → 8 (single-tier) - 33% fewer
- Merkle levels: ~20 (two-tier) → 12 (single-tier) - 40% reduction
- Hash operations: ~40 (two-tier) → ~14 (single-tier) - 65% fewer

**On-Chain Costs**:
- Verifier bytecode: 26KB (two-tier) → 20,142 bytes (single-tier) - 18% under EIP-170 limit
- EIP-170 compliance: ❌ (6.6% over limit) → ✅ (18% under limit)
- Verification gas: ~300-500k → ~300-400k (similar)
- Registry lookup: N/A → ~2.1k (negligible addition)

**Mobile Experience**:
- Proving time: 30+ seconds (two-tier) → 8-15 seconds (single-tier) - 2-4x faster
- WASM memory: 1GB+ (two-tier) → 400-600MB (single-tier) - 40-60% less
- Battery impact: Severe (hot phone, drain) → Moderate (normal usage)
- Crash rate: High (OS kills app) → Low (stable, reliable)
- User experience: Unusable → Production-ready

### See Also

**Complete Technical Analysis**: `packages/crypto/circuits/ARCHITECTURE_EVOLUTION.md`
- Brutalist AI critique that identified "ZK-maximalism" antipattern
- Full security analysis with detailed attack scenarios
- Migration path and implementation details
- Lessons learned: When to use cryptography vs governance for different data types

---

---

### 2. Identity Verification (Phase 2 Only - For Economic Incentives)

**Problem:** Prevent Sybil attacks when token rewards launch. One person = one verified account.

**Phase 1:** Identity verification NOT required. Address verification (above) is permissionless.

**Phase 2:** Identity verification required ONLY for:
- Earning VOTER token rewards
- Participating in challenge markets (staking on claims)
- Participating in outcome markets (legislative prediction markets)

**Without identity verification (Phase 2):**
- Can still participate (send messages, build reputation)
- NO economic incentives (zero token rewards)
- Reduced challenge market influence

**Implementation:**
- **self.xyz** (primary): NFC passport scan, instant verification, FREE
- **Didit.me** (fallback): Government ID upload for users without passports, FREE Core KYC tier

**Output:** Verifiable Credential (VC) proving identity without revealing PII
- Provider never learns wallet address (zero-knowledge credential issuance)
- On-chain registry records identity commitment (Poseidon hash, no PII)
- One identity = one verified account (cryptographic enforcement)

**Key Distinction:** Identity verification is SEPARATE from address verification. Address proofs are permissionless (no identity required). Identity verification adds Sybil resistance for Phase 2 economic layer.

---

### 3. Message Delivery (Nitro Enclaves - Separate System)

**Problem:** Congressional SOAP API requires:
1. Plaintext address + message content (offices must read messages)
2. Delivery from whitelisted static IP (congressional security requirement)
3. AI moderation for legal compliance (Section 230)

**This is SEPARATE from ZK proof verification** (which happens 100% on-chain via smart contracts).

**Message delivery flow:**
1. User provides delivery address explicitly for congressional office
2. Browser encrypts address + message to Nitro Enclave public key
3. Platform backend stores encrypted blob (cannot decrypt, lacks keys)
4. AWS Nitro Enclave decrypts for AI moderation + congressional delivery
5. Enclave delivers plaintext to congressional CRM via CWC API
6. Platform operators never see plaintext (architectural enforcement)

**Why Nitro Enclaves:** Congressional API constraint requires centralized delivery. Nitro protects platform operators from accessing content while enabling required delivery.

**See TECHNICAL.md "Message Content Encryption" section for implementation details.**

---

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

### Message Content Encryption from Platform Operators

**Problem:** Deliver messages to congressional offices requiring:
1. Content moderation (legal requirement, Section 230 compliance)
2. SOAP XML delivery from whitelisted static IP (congressional API constraint)
3. Platform operators cannot decrypt message content (architectural enforcement)

**Solution: AWS Nitro Enclaves**

**Why Nitro Enclaves:**
- Hypervisor-based isolation (NOT Intel SGX/AMD SEV vulnerable to TEE.fail DDR5 attacks)
- Cryptographic attestation (proves correct code running in enclave)
- FREE (no additional cost beyond EC2 instance)
- We architecturally CANNOT decrypt (keys live in enclave, not accessible to us)

**Architecture:**
```
User Browser → Encrypt to Enclave Pubkey → Backend Stores Encrypted Blob →
AWS Nitro Enclave Decrypts → AI Moderation (in enclave) →
SOAP XML Construction → CWC Delivery → Congressional CRM
```

**Implementation:**

**Step 1: Browser encrypts to enclave public key**
```typescript
// Client-side encryption (happens in browser before any network transmission)
async function encryptForNitroEnclave(
  message: string,
  districtId: string
): Promise<EncryptedMessage> {
  // 1. Fetch enclave public key with attestation
  const { publicKey, attestation } = await verifyEnclaveAttestation(districtId);

  // 2. Verify attestation proves correct code running
  const attestationValid = await verifyNitroAttestation(attestation);
  if (!attestationValid) throw new Error('Enclave attestation failed');

  // 3. Encrypt message to enclave public key (XChaCha20-Poly1305)
  const nonce = crypto.getRandomValues(new Uint8Array(24));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'XChaCha20-Poly1305', nonce },
    publicKey,
    new TextEncoder().encode(message)
  );

  return {
    ciphertext,
    nonce,
    recipientOffice: districtId,
    attestation  // Proof of enclave identity
  };
}
```

**Step 2: Backend stores encrypted blob (CANNOT decrypt)**
```typescript
// Backend server receives encrypted blob, stores without decryption
async function storeEncryptedMessage(
  encryptedMessage: EncryptedMessage,
  proof: DistrictProof
): Promise<MessageId> {
  // Verify ZK proof that sender is constituent in target district
  const proofValid = await scrollContract.verifyDistrictMembership(proof);
  if (!proofValid) throw new Error('Invalid district proof');

  // Store encrypted blob (backend CANNOT decrypt, lacks enclave private key)
  const messageId = await db.messages.create({
    ciphertext: encryptedMessage.ciphertext,
    nonce: encryptedMessage.nonce,
    districtId: encryptedMessage.recipientOffice,
    createdAt: Date.now()
  });

  // Queue for enclave processing
  await enclaveQueue.push({ messageId });

  return messageId;
}
```

**Step 3: Enclave processes (ONLY place with decryption keys)**
```rust
// THIS CODE RUNS INSIDE AWS NITRO ENCLAVE
// Backend cannot access this environment
use aws_nitro_enclaves_sdk::*;

async fn process_message_in_enclave(message_id: String) -> Result<DeliveryReceipt> {
    // 1. Fetch encrypted blob from backend
    let encrypted_blob = fetch_encrypted_message(message_id).await?;

    // 2. Decrypt with enclave private key (NEVER leaves enclave)
    let plaintext = decrypt_xchacha20_poly1305(
        &encrypted_blob.ciphertext,
        &encrypted_blob.nonce,
        &ENCLAVE_PRIVATE_KEY  // Stored in enclave memory only
    )?;

    // 3. AI moderation (runs INSIDE enclave, backend cannot see)
    let moderation_result = moderate_content_in_enclave(&plaintext).await?;
    if !moderation_result.approved {
        return Err("Content policy violation");
    }

    // 4. Fetch user address (encrypted at rest, decrypt in enclave)
    // CWC API requires address for congressional delivery
    let user_address = decrypt_address_in_enclave(encrypted_blob.user_id).await?;

    // 5. Construct SOAP XML for congressional delivery
    // Congressional offices receive: address + message content (plaintext)
    let soap_xml = build_cwc_request(user_address, plaintext);

    // 6. Send from enclave to CWC (whitelisted static IP)
    let receipt = send_to_cwc_from_enclave(soap_xml).await?;

    // 7. Zero all secrets before returning
    zero_memory(&plaintext);
    zero_memory(&user_address);

    Ok(receipt)
}
```

**Step 4: Attestation verification**
```typescript
// Users verify enclave code BEFORE encrypting
async function verifyNitroAttestation(attestation: AttestationDocument): Promise<boolean> {
  // 1. Verify AWS Nitro signature on attestation
  const signatureValid = await verifyAWSSignature(attestation);

  // 2. Verify PCR measurements match expected enclave code
  const expectedPCRs = {
    PCR0: "expected_hash_of_enclave_code",  // Open-source, community can audit
    PCR1: "expected_hash_of_kernel",
    PCR2: "expected_hash_of_application"
  };

  const pcrsMatch = Object.entries(expectedPCRs).every(
    ([pcr, expectedHash]) => attestation.pcrs[pcr] === expectedHash
  );

  if (!pcrsMatch) {
    throw new Error('Enclave code mismatch - not running expected code!');
  }

  return signatureValid && pcrsMatch;
}
```

**Privacy Guarantees:**

✅ **What Nitro Enclaves PROTECTS (platform operators):**
- Server compromise: Attacker gets root on EC2 → cannot read enclave memory
- Insider threat: Rogue employee → cannot access enclave
- Legal compulsion: Subpoena → we literally cannot decrypt (keys in enclave)
- Database breach: Encrypted blobs stolen → useless without enclave keys
- **Platform operators never see address or message content** (architectural enforcement)

✅ **What Congressional Offices RECEIVE:**
- Constituent address (CWC API requirement)
- Message content (plaintext)
- Zero-knowledge district verification proof (cryptographic, no PII beyond address)
- Reputation score (on-chain data)

❌ **What Nitro Enclaves DOES NOT protect against:**
- Physical attacks on AWS data centers (requires breaking into AWS facilities)
- AWS as malicious actor (you trust AWS infrastructure)
- Bugs in enclave code itself (open-source for audit)
- Side-channel attacks on enclaves (mitigated, not eliminated)
- **Congressional offices seeing address/message** (required for CWC delivery, can't be encrypted)

**Honest Comparison:**

**vs. "Trust us" encryption:**
- ❌ "We pinky promise not to read": Backend has keys, can decrypt anytime
- ✅ Nitro Enclaves: We CANNOT decrypt, architectural enforcement

**vs. Congressional office holding keys:**
- Realistic? No (535 offices won't manage keypairs)
- Nitro alternative: Enclave holds keys, offices still get plaintext delivery

**AWS Dependency:**
- **On-chain identity**: ZERO AWS (browser-native ZK proofs, Scroll L2, IPFS)
- **Message delivery**: AWS Nitro REQUIRED (congressional SOAP API constraint)
- **Clear boundary**: Identity privacy vs message delivery privacy

**Cost:**
- EC2 instance: $500-800/month (c6a.xlarge for Nitro Enclaves)
- AI moderation: Runs inside enclave ($0 additional compute)
- Batch logging: $450/month (hourly merkle roots)
- Total: ~$1.5k/month infrastructure (vs $20k+ without batch logging)

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

**ZK reputation proofs (SELECTIVE DISCLOSURE - CURRENT Phase 1 capability):**
```rust
// Prove "my healthcare reputation > 5000" without revealing exact score
// THIS IS ALREADY IMPLEMENTED - selective disclosure via ZK range proofs
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

**Selective disclosure in action:**
- Congressional staff see: "Healthcare reputation > 5000" (verified via ZK proof)
- They don't see exact score (could be 5001 or 50000)
- User privacy preserved while signaling credibility
- **This works NOW with Phase 1 infrastructure** - browser-native ZK proofs enable selective disclosure without revealing underlying data
- District membership proof = selective disclosure (prove "I'm in TX-18" without revealing exact address)
- Reputation range proof = selective disclosure (prove "score > threshold" without revealing exact score)

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
  - ZK proofs of district membership (Noir/Barretenberg browser-native proofs)
  - Identity verification status (self.xyz/Didit.me confirmation)
  - Delivery receipts from congressional systems (CWC API confirmations)
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

**Zero-Knowledge Proof Infrastructure:**
- **Cost:** $0 (browser-native proving, no server required)
- **Implementation:** Noir/Barretenberg WASM + UltraPlonk
- **User's device does all computation:** Web Workers + SharedArrayBuffer
- **Note:** No TEE infrastructure needed with browser-native architecture

**Database & Hosting:**
- **Cost:** $0 (free tiers)
- **Supabase:** Free tier (500MB database, 2GB bandwidth, sufficient for Phase 1)
- **Vercel/Netlify:** Free tier (frontend hosting)
- **Note:** Scales to $25/mo paid tier at ~3K users

**Total Fixed:** $0/month

### Variable Costs (Per-User Onboarding)

**Identity Verification:**
- **self.xyz:** $0 (FREE NFC passport scanning)
- **Didit.me:** $0 (FREE Core KYC tier for non-passport users)
- **Mix:** 70% self.xyz (FREE) + 30% Didit.me (FREE) = $0 average

**ZK Proof Generation:**
- **Cost:** $0 (browser-native WASM proving, user's CPU)
- **Gas cost:** ~$0.02 per proof verification on Scroll L2 (300-400k gas, platform pays)
- **Onboarding total:** 1,000 users × $0.02 = $20

**Total Variable (Onboarding):** $20/month

### Variable Costs (Content Moderation)

**Layer 1: OpenAI Moderation API**
- **Cost:** Low; provider SLAs vary. Use automated moderation with escalation; see canonical detail
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
- **District verification:** 1,000 users × $0.02 = $20
- **Reputation updates:** Defer costs to the canonical section
- **Message delivery receipts:** Defer costs to the canonical section

**Total Blockchain:** $125/month

**Note:** Platform pays all gas fees. Users see zero transaction costs.

### Monthly Total (1,000 users / 10,000 messages)

```
Fixed Costs:
  ZK Proof Infrastructure:       $  0.00
  Database/Hosting:              $  0.00
                                 --------
  Subtotal Fixed:                $  0.00

Variable Costs:
  Identity verification:         $ 20.00
  Content moderation:            $ 51.00
  Blockchain transactions:       $125.00
                                 --------
  Subtotal Variable:             $196.00

TOTAL MONTHLY:                   $196.00
```

**Per-User Cost:** $0.20/user/month
**Per-Message Cost:** $0.02/message

### Scaling Economics

**At 10,000 users / 100,000 messages:**
- Fixed: $0 (browser-native proving scales with users' devices)
- Variable: $1,960 (linear scaling)
- Total: $1,960/month ($0.20/user, $0.02/message)

**At 100,000 users / 1,000,000 messages:**
- Fixed: $0 (zero infrastructure, peer computation)
- Variable: $19,600
- Total: $19,600/month ($0.20/user, $0.02/message)

**Cost advantage:** Browser-native architecture eliminates fixed infrastructure costs entirely. Per-user cost remains constant at $0.20/user regardless of scale (no economies of scale needed—already at optimal cost).

### What This Buys

**Phase 1 delivers:**
- Zero-knowledge district proofs (Noir/Barretenberg browser-native, UltraPlonk + KZG commitment, production-grade)
- Message content encrypted from platform operators (XChaCha20-Poly1305, delivered as plaintext to congressional offices via CWC API)
- 3-layer content moderation (Section 230 compliant)
- Cross-chain reputation (ERC-8004 portable)
- FREE identity verification (self.xyz + Didit.me)
- Zero gas fees for users (platform subsidizes)
- Zero infrastructure costs (browser-native proving eliminates server dependency)

**What Phase 1 does NOT include:**
- VOTER token (Phase 2)
- Challenge markets (Phase 2)
- Outcome markets (Phase 2)
- Token rewards (Phase 2)
- Multi-agent treasury (Phase 2)

**Budget runway (assuming $50K initial funding):**
- Month 1: 1,000 users → $196 spend → 255 months runway (21 years!)
- Month 3: 3,000 users → $588 spend → 85 months runway (7 years)
- Month 6: 10,000 users → $1,960 spend → 25 months runway (2+ years)
- Month 12: 50,000 users → $9,800 spend → 5 months runway (fundraise or revenue)

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

**Client-Side Proof Generation Manipulation**
- **Threat:** User modifies browser WASM to generate invalid proofs or skip verification
- **Mitigation:**
  - Proofs verified on-chain (invalid proofs rejected by smart contract, user pays gas for failed attempt)
  - Open-source WASM circuit (community can audit, verify deterministic compilation)
  - Subresource Integrity (SRI) hashes for WASM modules prevent tampering
  - Even if user bypasses client-side checks: on-chain verification catches all fraud
  - No economic incentive: invalid proofs waste user's gas, don't benefit attacker

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

**Browser-Native Proof Generation (Noir/Barretenberg WASM + UltraPlonk):**
- **Shadow Atlas loading:** (first time only)
  - IPFS download: 15MB compressed (Zstd, 50MB uncompressed)
  - IndexedDB caching: 3-5s download, <10ms subsequent retrieval
  - Progressive loading: Start witness generation before full download completes
- **Witness generation:** (every proof)
  - Web Workers: 4 parallel workers for Poseidon hashing
  - Merkle path computation: 200-400ms (modern devices), 800ms-1.5s (mobile)
  - Memory: <100MB (JavaScript computation)
- **WASM proving time:** (device-dependent)
  - Modern mobile (2021+, Snapdragon 7 series): 8-15 seconds (production-ready)
  - Memory: ~400-600MB peak (mobile-optimized)
  - Circuit: ~4,000 constraints (Noir/UltraPlonk)

**End-to-End User Experience:**
- **First time (Shadow Atlas download):**
  1. Shadow Atlas download: 3-5s (15MB IPFS, cached afterward)
  2. Witness generation: 200ms-1.5s (Web Workers, device-dependent)
  3. WASM proof generation: 8-15s (mobile)
  4. Submit to Scroll L2: 2-5s (block confirmation)
  - **Total: 11-24s** (mobile + good network)

- **Subsequent proofs (cached):**
  1. IndexedDB cache hit: <10ms (Shadow Atlas already downloaded)
  2. Witness generation: 200ms-1.5s
  3. WASM proof generation: 8-15s (mobile)
  4. Submit to Scroll L2: 2-5s
  - **Total: 10-22s** (district tree cached, only proving overhead)

**Device Compatibility:**
- **Supported:** 95%+ of devices (requires SharedArrayBuffer support)
  - Modern browsers: Chrome 92+, Safari 15.2+, Firefox 101+
  - Mobile: Android Chrome 92+, iOS Safari 15.2+
  - Requires COOP/COEP headers for SharedArrayBuffer (multi-threading)
- **Unsupported:** Older browsers (2020 and earlier)
  - Progressive enhancement: "Upgrade browser" message for incompatible devices

**On-Chain Verification (Scroll L2):**
- **Gas cost:** 300-400k gas (UltraPlonk verification)
  - Typical verification on Scroll: < $0.01; defer specifics to the canonical costs section
  - Platform pays all gas (users see zero transaction costs)
- **Latency:** Block confirmation ~2 seconds (Scroll L2)

**Message Delivery (E2E Encryption, No TEE):**
- **Encryption:** XChaCha20-Poly1305 (browser WebCrypto), <50ms
- **Backend passthrough:** <200ms (encrypted blob forwarding, no decryption)
- **CWC delivery:** 1-3 seconds (congressional API)
- **Total end-to-end:** ~1-4 seconds (after proof verification)

**Reputation Calculation (Phase 1):**
- **Off-chain computation:** Template adoption tracking, domain-specific scoring
- **Latency:** 1-2 seconds (no multi-agent consensus in Phase 1)
- **On-chain update:** Single transaction writes reputation delta
- **User sees:** "Updating reputation..." for ~2 seconds, then score updates
- **Phase 2 addition:** Multi-agent consensus for token rewards (2-5s latency)

**Scalability:**
- **Phase 1 target:** 10k daily active users (~1000 proofs/day, $0 infrastructure cost)
- **Phase 2 target:** 100k daily active users (~10K proofs/day, $0 infrastructure cost)
- **Long-term target:** 1M daily active users (~100K proofs/day, $0 infrastructure cost)
- **Proving scales with users:** Browser-native architecture distributes proving across user devices
  - Zero server cost regardless of user count
  - Proving capacity = number of users × device capability
  - No infrastructure bottleneck: users provide their own compute
- **On-chain bottleneck:** Scroll L2 throughput (4000 TPS theoretical)
- **Mitigation:** Batch proof verifications (single transaction verifies multiple proofs)
  - Gas savings: 100 individual txs at 500k gas = 50M gas
  - Batched: 1 tx at ~8M gas (~84% reduction via aggregation)
  - Recursive composition enables efficient batching
  - Enables scaling to 1M+ users without L2 congestion
  - Gas cost advantage: $0 infrastructure + batching = lowest per-user cost possible

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

## Operational Procedures

### Verifier Generation (Circuit Changes)

**When to regenerate** (ANY of these changes require new verifier):
- Circuit structure modifications
- Public input configuration changes
- Constraint changes

**Procedure:**
```bash
cd packages/crypto/noir/district_membership

# Compile Noir circuit
nargo compile

# Generate verification key
bb write_vk -b target/district_membership.json -o vk

# Generate Solidity verifier (optional, for on-chain deployment)
bb write_solidity_verifier -k vk -o Verifier.sol
```

**Outputs:**
- `target/district_membership.json` (ACIR bytecode)
- `vk` (verification key)
- `Verifier.sol` (on-chain verifier contract)

**Verification:**
```bash
cd contracts
forge test --match-contract Integration --match-test testProof
```

**Expected**: `[PASS] testProof() (gas: ~294k-300k)`

**Critical**: Stale verifier = silent verification failures. Always regenerate after circuit changes.

**See**: `docs/NOIR-PROVING-INFRASTRUCTURE.md` for detailed procedures.

-----
