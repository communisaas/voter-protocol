# Geographic Cell Membership Circuit Specification

> **Spec ID:** CIRCUIT-GEO-001
> **Version:** 2.3.0
> **Status:** Active
> **Last Updated:** 2026-01-25
> **Authors:** Voter Protocol Team

---

## Executive Summary

This specification defines the ZK circuit for proving geographic cell membership without revealing the user's exact location. The circuit proves that a user belongs to a specific Merkle tree of addresses (a "district tree") while generating a nullifier that prevents double-participation.

**Key Design Decisions (v2.3):**
- **Multi-depth support:** 18, 20, 22, 24 (compile-time variants for international constituencies)
- **24 district slots:** Hybrid allocation (20 defined + 4 overflow) for comprehensive governance coverage
- **Poseidon2 hashing:** BN254-native hash for efficient verification
- **UltraPlonk proving system:** Via Barretenberg/Noir stack

---

## 1. Circuit Overview

### 1.1 Purpose

Prove that:
1. A user's address commitment exists in a district Merkle tree
2. The nullifier is correctly derived from the user's secret
3. The proof is bound to a specific action context (campaign, epoch, authority)

### 1.2 Privacy Guarantees

| Property | Guarantee |
|----------|-----------|
| **Address privacy** | Zero knowledge of exact address |
| **District privacy** | Only Merkle root revealed (not which leaf) |
| **Temporal binding** | Proof bound to specific epoch |
| **Action binding** | Proof bound to specific authority/campaign |
| **Unlinkability** | Different nullifiers across campaigns |

### 1.3 Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CIRCUIT INPUTS                                    │
│                                                                      │
│  PUBLIC (5 fields):                                                  │
│  ┌─────────────────┬─────────────────────────────────────────────┐ │
│  │ merkle_root     │ District tree root (determines constituency) │ │
│  │ nullifier       │ Prevents double-participation                │ │
│  │ authority_hash  │ Action context (e.g., campaign authority)   │ │
│  │ epoch_id        │ Temporal binding (e.g., election year)      │ │
│  │ campaign_id     │ Campaign identifier                          │ │
│  └─────────────────┴─────────────────────────────────────────────┘ │
│                                                                      │
│  PRIVATE (witness):                                                  │
│  ┌─────────────────┬─────────────────────────────────────────────┐ │
│  │ leaf            │ Commitment to user's address data           │ │
│  │ merkle_path     │ [Field; DEPTH] sibling hashes               │ │
│  │ leaf_index      │ Position in tree (u32)                      │ │
│  │ user_secret     │ User's random secret for nullifier          │ │
│  └─────────────────┴─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    CIRCUIT CONSTRAINTS                               │
│                                                                      │
│  1. Merkle membership:                                               │
│     computed_root = MerkleVerify(leaf, merkle_path, leaf_index)     │
│     assert(computed_root == merkle_root)                             │
│                                                                      │
│  2. Nullifier derivation:                                            │
│     computed_nullifier = Poseidon2(user_secret, campaign_id,        │
│                                    authority_hash, epoch_id)         │
│     assert(computed_nullifier == nullifier)                          │
│                                                                      │
│  3. Range constraint:                                                │
│     assert(leaf_index < 2^DEPTH)                                     │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    OUTPUTS                                           │
│                                                                      │
│  Public outputs (for on-chain verification):                         │
│  (merkle_root, nullifier, authority_hash, epoch_id, campaign_id)    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Circuit Implementation

### 2.1 Noir Source

```noir
// packages/crypto/noir/district_membership/src/main.nr

use dep::std::hash::poseidon2_permutation;

// Compile-time depth constant (18, 20, 22, or 24)
// Build pipeline substitutes this value per variant
global DEPTH: u32 = 20;

/// Poseidon2 hash of 2 field elements
fn poseidon2_hash2(left: Field, right: Field) -> Field {
    let mut state: [Field; 4] = [left, right, 0, 0];
    let out = poseidon2_permutation(state, 4);
    out[0]
}

/// Poseidon2 hash of 4 field elements (for nullifier)
fn poseidon2_hash4(a: Field, b: Field, c: Field, d: Field) -> Field {
    let mut state: [Field; 4] = [a, b, c, d];
    let out = poseidon2_permutation(state, 4);
    out[0]
}

/// Verify Merkle path from leaf to root
fn compute_merkle_root(leaf: Field, merkle_path: [Field; DEPTH], leaf_index: u32) -> Field {
    assert(leaf_index < (1u32 << DEPTH)); // Range constraint

    let mut node = leaf;
    for i in 0..DEPTH {
        let bit: bool = ((leaf_index >> i) & 1u32) == 1u32;
        let sibling = merkle_path[i];
        node = if bit {
            poseidon2_hash2(sibling, node)
        } else {
            poseidon2_hash2(node, sibling)
        };
    }
    node
}

/// Derive nullifier with domain separation
fn compute_nullifier(
    user_secret: Field,
    campaign_id: Field,
    authority_hash: Field,
    epoch_id: Field
) -> Field {
    poseidon2_hash4(user_secret, campaign_id, authority_hash, epoch_id)
}

/// Main circuit entry point
fn main(
    // Public inputs (verified on-chain)
    merkle_root: Field,
    nullifier: Field,
    authority_hash: Field,
    epoch_id: Field,
    campaign_id: Field,
    // Private witnesses (hidden)
    leaf: Field,
    merkle_path: [Field; DEPTH],
    leaf_index: u32,
    user_secret: Field,
) -> pub (Field, Field, Field, Field, Field) {
    // Constraint 1: Merkle membership
    let computed_root = compute_merkle_root(leaf, merkle_path, leaf_index);
    assert(computed_root == merkle_root);

    // Constraint 2: Nullifier correctness
    let computed_nullifier = compute_nullifier(user_secret, campaign_id, authority_hash, epoch_id);
    assert(computed_nullifier == nullifier);

    // Return public outputs for on-chain verification
    (merkle_root, nullifier, authority_hash, epoch_id, campaign_id)
}
```

### 2.2 Depth Parameterization

The circuit is compiled into 4 variants at build time:

| Depth | Max Leaves | Max Voters | Target Use Case |
|-------|------------|------------|-----------------|
| 18 | 262,144 | ~260K | UK constituencies (avg 77K), small countries |
| 20 | 1,048,576 | ~1M | US Congressional (760K), medium countries |
| 22 | 4,194,304 | ~4M | India Lok Sabha (3.78M max), large countries |
| 24 | 16,777,216 | ~16M | National PR systems (Netherlands 13.4M) |

**Build Process:**
```bash
# Build all depth variants
for DEPTH in 18 20 22 24; do
    sed -i "s/global DEPTH: u32 = [0-9]*/global DEPTH: u32 = ${DEPTH}/" src/main.nr
    nargo compile
    mv target/district_membership.json target/district_membership_${DEPTH}.json
done
```

See [DEPTH-PARAMETERIZATION-PLAN.md](./DEPTH-PARAMETERIZATION-PLAN.md) for full build pipeline.

---

## 3. Constraint Analysis

### 3.1 Constraint Breakdown

| Component | Constraints | Notes |
|-----------|-------------|-------|
| **Merkle verification** | ~500 × DEPTH | Poseidon2 per level |
| **Nullifier computation** | ~500 | Single Poseidon2 4-input |
| **Leaf hash verification** | ~500 | If leaf is hashed commitment |
| **Range constraint** | ~32 | For leaf_index |

### 3.2 Total by Depth

```
DEPTH=18:  500×18 + 500 + 500 + 32 = ~10,032 constraints
DEPTH=20:  500×20 + 500 + 500 + 32 = ~11,032 constraints
DEPTH=22:  500×22 + 500 + 500 + 32 = ~12,032 constraints
DEPTH=24:  500×24 + 500 + 500 + 32 = ~13,032 constraints
```

### 3.3 Proving Time Estimates

| Depth | Mobile (Snapdragon 8) | Desktop (M2) | WebAssembly |
|-------|----------------------|--------------|-------------|
| 18 | ~12s | ~3s | ~8s |
| 20 | ~14s | ~4s | ~10s |
| 22 | ~16s | ~5s | ~12s |
| 24 | ~18s | ~6s | ~14s |

---

## 4. Leaf Commitment Structure

### 4.1 Address-to-Leaf Encoding

The leaf commitment encodes the user's location and district assignments:

```typescript
// Leaf = Poseidon2(address_hash, district_commitment)
interface LeafPreimage {
  // Geographic identity
  addressHash: Field;  // Hash of (street, city, state, zip, country)

  // District commitment (all 24 slots)
  districtCommitment: Field;  // Poseidon2 of district hashes
}

// District commitment = Poseidon2([d0, d1, ..., d23])
// Empty slots use EMPTY_HASH = Poseidon2(0)
```

### 4.2 District Slot Encoding

Each address is assigned to up to 24 district slots:

| Slot Range | Category | Description |
|------------|----------|-------------|
| 0-6 | Core Governance | Federal, state, county, municipal |
| 7-10 | Education | School districts (unified, elementary, secondary, CC) |
| 11-16 | Special-Core | Water, fire, transit, hospital, library, parks |
| 17-19 | Special-Extended | Conservation, utility, judicial |
| 20-21 | Administrative | Township, voting precinct |
| 22-23 | Overflow | Additional special districts, international |

**Empty Slot Handling:**
```noir
// EMPTY_HASH = Poseidon2(0, 0, 0, 0)[0]
// Used for unassigned slots to maintain constant array size
global EMPTY_HASH: Field = 0x...; // Computed constant
```

See [DISTRICT-TAXONOMY.md](./DISTRICT-TAXONOMY.md) for complete slot allocation.

---

## 5. On-Chain Verification

### 5.1 Verifier Interface

```solidity
// Generated by bb contract command
interface IDistrictMembershipVerifier {
    function verify(
        bytes calldata proof,
        uint256[5] calldata publicInputs
    ) external view returns (bool);
}

// Public inputs order:
// [0] merkle_root
// [1] nullifier
// [2] authority_hash
// [3] epoch_id
// [4] campaign_id
```

### 5.2 Multi-Depth Routing

```solidity
// contracts/src/DistrictGateV2.sol

contract DistrictGateV2 {
    /// @notice Maximum district slots in proof (hybrid: 20 defined + 4 overflow)
    uint8 public constant MAX_DISTRICT_SLOTS = 24;

    VerifierRegistry public immutable verifierRegistry;
    DistrictRegistry public immutable districtRegistry;

    function verifyAndAuthorizeWithSignature(
        address signer,
        bytes calldata proof,
        bytes32 districtRoot,
        bytes32 nullifier,
        bytes32 authorityHash,
        bytes32 epochId,
        bytes32 campaignId,
        bytes3 expectedCountry,
        uint256 deadline,
        bytes calldata signature
    ) external {
        // 1. Look up depth from district registry
        (bytes3 country, uint8 depth) = districtRegistry.getCountryAndDepth(districtRoot);

        // 2. Get depth-specific verifier
        address verifier = verifierRegistry.getVerifier(depth);

        // 3. Verify ZK proof
        uint256[5] memory publicInputs = [
            uint256(districtRoot),
            uint256(nullifier),
            uint256(authorityHash),
            uint256(epochId),
            uint256(campaignId)
        ];

        (bool success, bytes memory result) = verifier.call(
            abi.encodeWithSignature("verifyProof(bytes,uint256[5])", proof, publicInputs)
        );
        require(success && abi.decode(result, (bool)), "Verification failed");

        // 4. Record nullifier
        nullifierRegistry.recordNullifier(authorityHash, nullifier, districtRoot);
    }
}
```

### 5.3 Gas Costs

| Depth | Verifier Size | Verification Gas | Total Tx Gas |
|-------|--------------|------------------|--------------|
| 18 | ~22KB | ~280K | ~350K |
| 20 | ~26KB | ~320K | ~390K |
| 22 | ~30KB | ~360K | ~430K |
| 24 | ~34KB | ~400K | ~470K |

**L2 Cost Estimates (Scroll):**
- Depth 20: ~$0.003-0.005 at 10 gwei
- Depth 24: ~$0.004-0.007 at 10 gwei

---

## 6. Security Considerations

### 6.1 Soundness

- **Merkle binding:** Proof is valid only for the specific root
- **Nullifier uniqueness:** Same (secret, campaign, authority, epoch) always produces same nullifier
- **No grinding:** Nullifier derivation is deterministic

### 6.2 Privacy

- **Leaf position hidden:** Merkle path reveals nothing about index
- **User secret hidden:** Never leaves client
- **Address hidden:** Only commitment is proven

### 6.3 Attack Vectors Mitigated

| Attack | Mitigation |
|--------|------------|
| Double voting | Nullifier recorded on-chain |
| Proof replay | Epoch binding, signature deadline |
| Merkle forgery | Soundness of Poseidon2 + UltraPlonk |
| Timing attacks | Constant-time Poseidon2 in WASM |

---

## 7. Integration Points

### 7.1 Client Flow

```typescript
// packages/noir-prover/src/prover.ts

type CircuitDepth = 18 | 20 | 22 | 24;

class NoirProver {
  async prove(inputs: CircuitInputs, depth: CircuitDepth): Promise<ProofResult> {
    // 1. Load depth-specific circuit (lazy)
    const circuit = await loadCircuit(depth);

    // 2. Validate input sizes
    if (inputs.merklePath.length !== depth) {
      throw new Error(`Merkle path length mismatch`);
    }

    // 3. Generate proof
    const { witness } = await circuit.execute(inputs);
    const { proof, publicInputs } = await backend.generateProof(witness);

    return { proof, publicInputs, depth };
  }
}
```

### 7.2 Shadow Atlas Integration

```typescript
// packages/shadow-atlas/src/core/tree-builder.ts

async function buildDistrictTree(districtId: string): Promise<MerkleTree> {
  // 1. Fetch all addresses in district
  const addresses = await getDistrictAddresses(districtId);

  // 2. Determine depth based on size
  const depth = selectDepth(addresses.length);

  // 3. Build commitments
  const leaves = addresses.map(addr => computeLeafCommitment(addr));

  // 4. Pad to power of 2
  while (leaves.length < 2 ** depth) {
    leaves.push(EMPTY_LEAF);
  }

  // 5. Build tree
  return new MerkleTree(leaves, depth, poseidon2Hash);
}
```

---

## 8. Appendix

### 8.1 Constants

```noir
// Domain separators for different hash contexts
global LEAF_DOMAIN: Field = 0x01;
global MERKLE_DOMAIN: Field = 0x02;
global NULLIFIER_DOMAIN: Field = 0x03;

// Empty hash for unused slots
global EMPTY_HASH: Field = poseidon2_hash2(0, 0);
```

### 8.2 Test Vectors

```json
{
  "depth": 20,
  "leaf": "0x1234...",
  "leaf_index": 12345,
  "merkle_path": ["0xabcd...", ...],
  "user_secret": "0x5678...",
  "campaign_id": "0x9abc...",
  "authority_hash": "0xdef0...",
  "epoch_id": "0x1111...",
  "expected_root": "0x2222...",
  "expected_nullifier": "0x3333..."
}
```

### 8.3 Related Documents

- [DEPTH-PARAMETERIZATION-PLAN.md](./DEPTH-PARAMETERIZATION-PLAN.md) — Build pipeline and depth selection
- [DISTRICT-TAXONOMY.md](./DISTRICT-TAXONOMY.md) — 24-slot allocation reference
- [SHADOW-ATLAS-SPEC.md](./SHADOW-ATLAS-SPEC.md) — Geographic data pipeline
- [GOVERNANCE-VERIFICATION-SYSTEM-SPEC.md](./GOVERNANCE-VERIFICATION-SYSTEM-SPEC.md) — Full system architecture

---

**Version History:**
- v2.3.0 (2026-01-25): Expanded to 24 slots (hybrid: 20 defined + 4 overflow)
- v2.2.0: Added depth parameterization (18, 20, 22, 24)
- v2.1.0: Migrated to Noir/Barretenberg from Halo2
- v2.0.0: Multi-depth support
- v1.0.0: Initial fixed-depth implementation
