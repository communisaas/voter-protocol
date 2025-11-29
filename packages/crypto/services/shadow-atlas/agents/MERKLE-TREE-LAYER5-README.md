# Shadow Atlas Layer 5: Merkle Tree Construction

**Status**: ✅ **COMPLETE** - Ready for IPFS publishing and on-chain commitment

This page now subsumes the old Layer5 completion summary; all run steps and validation notes live here.

**Purpose**: Build canonical cryptographic commitment tree from deduplicated governance districts for ZK residency proofs.

---

## Executive Summary

Layer 5 produces the final cryptographic artifact for Shadow Atlas: a Merkle tree root that commits to all governance districts in the dataset. This root enables privacy-preserving ZK proofs where users prove "I live in District X" without revealing their address.

### Key Results (2025-Q1)

```
Input: 31,316 total districts (from Layers 1-4)
Filtered: 4,175 governance districts (GOLD/SILVER/BRONZE tiers)
Tree Depth: 13 levels
Merkle Root: 0x4f566ff8f88cb4b858057faae9b8a81935df66078cc2acf6ba87c09b9de4ab74
Proof Validation: 4,175/4,175 verified (100%)
Execution Time: 0.37 seconds
Status: ✅ READY FOR ON-CHAIN COMMITMENT
```

---

## Architecture Overview

### Input (Layers 1-4 Output)

**File**: `comprehensive_classified_layers.jsonl`

- **Layer 1**: Discovery-time validation (31,316 polygon layers)
- **Layer 2**: Classification validation (4,175 governance districts)
- **Layer 3**: Geometric validation (HIGH/MEDIUM quality)
- **Layer 4**: Cross-source deduplication (unique districts)

### Process (Layer 5)

1. **Load & Filter**: Read classified layers, filter to governance tiers (GOLD/SILVER/BRONZE)
2. **Create Leaves**: Hash each district's metadata and geometry
3. **Deterministic Sort**: Sort districts by `district_id` (layer_url) for canonical ordering
4. **Build Tree**: Construct binary Merkle tree with keccak256 hashing
5. **Generate Proofs**: Create Merkle proof for every district
6. **Validate**: Verify all proofs reconstruct root (100% pass required)

### Output (IPFS Publishing)

**Files**:
- `merkle_tree.json` - Tree structure (root, depth, leaf count)
- `merkle_proofs.json` - All district proofs (5.8 MB)
- `merkle_leaves.json` - Leaf data (2.0 MB)
- `merkle_tree_report.txt` - Human-readable validation summary
- `merkle_tree_report.json` - Machine-readable report

---

## Implementation Details

### Merkle Leaf Structure

Each governance district becomes a Merkle leaf:

```typescript
interface MerkleLeaf {
  index: number;           // Leaf position (0-based)
  district_id: string;     // Unique ID (layer_url)
  district_type: string;   // city_council, school_board, etc.
  name: string;            // Layer name
  geometry_hash: string;   // Keccak256(GeoJSON geometry)
  metadata_hash: string;   // Keccak256(metadata JSON)
  leaf_hash: string;       // Keccak256(district_id || geometry_hash || metadata_hash)
}
```

**Deterministic Ordering**: Leaves sorted lexicographically by `district_id` to ensure canonical tree structure (same input → same root).

### Binary Merkle Tree

**Algorithm**: Standard binary Merkle tree with keccak256 hashing (matches Ethereum)

```
Level 0 (Leaves):  [H0, H1, H2, H3, ...]    // 4,175 leaf hashes
Level 1:           [H(H0,H1), H(H2,H3), ...]  // 2,088 parent hashes
Level 2:           [H(parent0, parent1), ...]  // 1,044 parent hashes
...
Level 13 (Root):   [H(...)]                    // 1 root hash
```

**Odd Number Handling**: If level has odd number of nodes, duplicate last node to complete pair.

### Merkle Proof Structure

```typescript
interface MerkleProof {
  district_id: string;        // District identifier
  leaf_hash: string;          // Leaf hash
  proof: string[];            // Sibling hashes (13 elements for depth 13)
  indices: number[];          // Path bits: 0 = left, 1 = right
  root: string;               // Merkle root (for verification)
}
```

**Proof Size**: 13 sibling hashes × 32 bytes = 416 bytes per district

**Verification**: Reconstruct root by iteratively hashing leaf with siblings:
```
computedHash = leaf_hash
for i in 0..12:
  sibling = proof[i]
  if indices[i] == 0:  # Left child
    computedHash = keccak256(computedHash, sibling)
  else:                 # Right child
    computedHash = keccak256(sibling, computedHash)

assert computedHash == root
```

---

## Execution Guide

### Run Merkle Tree Builder

```bash
cd /Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas/agents

# Build Merkle tree from classified layers
npx tsx merkle-tree-builder.ts
```

**Expected Output**:
```
Shadow Atlas Merkle Tree Builder (Layer 5)
==========================================

Reading input: .../data/comprehensive_classified_layers.jsonl

Loaded 31316 total districts
Filtered to 4175 governance districts (GOLD/SILVER/BRONZE)

Creating Merkle leaves...
Created 4175 leaves (deterministically sorted)

Building Merkle tree...
Tree constructed:
  Root: 0x4f566ff8f88cb4b858057faae9b8a81935df66078cc2acf6ba87c09b9de4ab74
  Depth: 13 levels
  Leaves: 4175

Generating Merkle proofs...
  Generated 1000/4175 proofs
  Generated 2000/4175 proofs
  Generated 3000/4175 proofs
  Generated 4000/4175 proofs
Generated 4175 proofs

Validating proofs...
  Verified: 4175/4175
  Failed: 0/4175

Writing outputs...
  ✓ merkle_tree.json
  ✓ merkle_proofs.json
  ✓ merkle_leaves.json
  ✓ merkle_tree_report.txt
  ✓ merkle_tree_report.json

Status: ✅ READY FOR ON-CHAIN COMMITMENT
```

### Run Tests

```bash
cd /Users/noot/Documents/voter-protocol/packages/crypto

# Run Merkle tree builder test suite
npx vitest run services/shadow-atlas/agents/merkle-tree-builder.test.ts
```

**Test Coverage**:
- ✅ Keccak256 hashing (determinism, unicode, edge cases)
- ✅ District ID creation (uniqueness, determinism)
- ✅ Merkle leaf creation (hash structure, determinism)
- ✅ Tree construction (single leaf, power-of-2, odd counts)
- ✅ Proof generation (all depths, edge cases)
- ✅ Proof verification (valid proofs, tampered proofs)
- ✅ Production scale (4,000 districts, performance benchmarks)

**Results**: 36/36 tests passed in 43ms

---

## Output Files

### `merkle_tree.json` (187 bytes)

```json
{
  "root": "0x4f566ff8f88cb4b858057faae9b8a81935df66078cc2acf6ba87c09b9de4ab74",
  "depth": 13,
  "leaf_count": 4175,
  "version": "2025-Q1",
  "created_at": "2025-11-25T14:49:08.901Z"
}
```

**Usage**: Primary reference for on-chain smart contract commitment.

### `merkle_proofs.json` (5.8 MB)

Array of 4,175 proofs, one per district:

```json
[
  {
    "district_id": "https://example.com/FeatureServer/1",
    "leaf_hash": "0xabc123...",
    "proof": [
      "0xdef456...",  // Sibling at level 0
      "0x789abc...",  // Sibling at level 1
      ...             // 13 siblings total
    ],
    "indices": [0, 1, 0, 1, ...],  // 13 path bits
    "root": "0x4f566ff8f88cb4b858057faae9b8a81935df66078cc2acf6ba87c09b9de4ab74"
  },
  ...
]
```

**Usage**: Browser client downloads user's district proof, generates ZK proof of residency.

### `merkle_leaves.json` (2.0 MB)

Array of 4,175 leaves with district metadata:

```json
[
  {
    "index": 0,
    "district_id": "https://example.com/FeatureServer/1",
    "district_type": "city_council",
    "name": "San Francisco District 1",
    "geometry_hash": "0x123abc...",
    "metadata_hash": "0x456def...",
    "leaf_hash": "0x789ghi..."
  },
  ...
]
```

**Usage**: Debugging, audit trail, deterministic verification.

### `merkle_tree_report.txt` (996 bytes)

Human-readable validation summary (see [example above](#run-merkle-tree-builder)).

**Usage**: Manual verification, documentation, audit logs.

---

## Next Steps (IPFS Publishing)

### 1. Upload to IPFS

**Recommended Provider**: Pinata or Filebase (global pinning)

```bash
# Using Pinata CLI
pinata upload merkle_tree.json
pinata upload merkle_proofs.json
pinata upload merkle_leaves.json

# Or using Filebase Web UI:
# https://console.filebase.com/
```

**Expected Output**:
```
merkle_tree.json → bafybeiglobal123...
merkle_proofs.json → bafybeiproofs456...
merkle_leaves.json → bafybeileaves789...
```

### 2. Create Global Index

```json
{
  "version": "2025-Q1",
  "global_root": "0x4f566ff8f88cb4b858057faae9b8a81935df66078cc2acf6ba87c09b9de4ab74",
  "countries": [
    {
      "code": "USA",
      "root": "0x4f566ff8f88cb4b858057faae9b8a81935df66078cc2acf6ba87c09b9de4ab74",
      "ipfs_cid": "bafybeiproofs456...",
      "district_count": 4175
    }
  ],
  "created_at": "2025-11-25T14:49:08.901Z"
}
```

Upload global index:
```bash
pinata upload shadow-atlas-global-index.json
# → bafybeiglobalindex123...
```

### 3. Smart Contract Commitment

**Contract Event** (Solidity):

```solidity
event ShadowAtlasUpdated(
    bytes32 indexed globalRoot,
    string ipfsHash,
    uint256 districtCount,
    uint256 timestamp,
    string version
);

emit ShadowAtlasUpdated(
    0x4f566ff8f88cb4b858057faae9b8a81935df66078cc2acf6ba87c09b9de4ab74,
    "bafybeiglobalindex123...",
    4175,
    block.timestamp,
    "2025-Q1"
);
```

**Gas Cost** (Scroll L2): ~$0.002 per event emission

### 4. Client Integration

Browser client workflow:

```typescript
// 1. Fetch global index from IPFS
const indexCID = "bafybeiglobalindex123...";
const index = await fetchFromIPFS(indexCID);

// 2. Download USA data
const usaCID = index.countries.find(c => c.code === "USA").ipfs_cid;
const usaData = await fetchFromIPFS(usaCID);

// 3. Find user's district (point-in-polygon)
const userDistrict = findContainingDistrict(usaData.districts, userAddress);

// 4. Get Merkle proof for district
const proof = usaData.proofs.find(p => p.district_id === userDistrict.layer_url);

// 5. Generate ZK proof (browser WASM)
const zkProof = await wasmProver.prove({
  address: userAddress,
  merkleProof: proof.proof,
  merkleRoot: index.global_root,
});

// 6. Submit ZK proof on-chain
await contract.verifyResidency(zkProof);
```

---

## Validation Checklist

Before publishing to IPFS and committing on-chain:

- [x] **Tree Construction**: 4,175 districts → 13-level tree
- [x] **Determinism**: Same input produces same root (tested)
- [x] **Proof Generation**: All 4,175 proofs generated
- [x] **Proof Verification**: 100% proofs verified (4,175/4,175)
- [x] **Test Suite**: 36/36 tests passed
- [x] **Output Files**: All files generated (merkle_tree.json, proofs, leaves, reports)
- [ ] **IPFS Upload**: Upload files to Pinata/Filebase (PENDING)
- [ ] **Global Index**: Create and upload global index (PENDING)
- [ ] **Smart Contract**: Emit ShadowAtlasUpdated event on Scroll L2 (PENDING)
- [ ] **Client Integration**: Browser client can fetch and verify proofs (PENDING)

---

## Performance Benchmarks

### Construction (Server-Side)

- **Input Size**: 4,175 districts
- **Tree Depth**: 13 levels
- **Leaf Creation**: ~0.05 seconds
- **Tree Construction**: ~0.10 seconds
- **Proof Generation**: ~0.15 seconds (all 4,175 proofs)
- **Proof Validation**: ~0.07 seconds (all 4,175 proofs)
- **Total Execution**: 0.37 seconds

**Scalability**: Linear in district count. 50,000 districts (Phase 2 target) would take ~4 seconds.

### Proof Verification (Client-Side)

- **Proof Size**: 416 bytes (13 siblings × 32 bytes)
- **Verification Time**: ~1ms per proof (JavaScript)
- **Memory**: Negligible (<1 KB per proof)

---

## Global Scaling (Phase 2+)

### Country Sharding Strategy

For global deployment (190+ countries, 500k-2M districts):

**Problem**: 2M districts = 21-level tree = 672-byte proofs

**Solution**: Country-level sharding

1. Build Merkle tree **per country** (USA tree, France tree, etc.)
2. Build **global index tree** of country roots
3. Users download **only their country's data** (~2GB vs 80GB global)

**Proof Structure** (2-level):
```typescript
interface GlobalProof {
  // Level 1: District → Country tree
  districtProof: string[];      // 16 siblings (USA: 50k districts)
  districtIndices: number[];

  // Level 2: Country → Global index
  countryProof: string[];       // 8 siblings (190 countries)
  countryIndices: number[];

  // Roots
  countryRoot: string;          // USA tree root
  globalRoot: string;           // Global index root
}
```

**Impact**: +1 proof level (21 → 22), +32 bytes per proof (negligible)

**Benefit**: Users download 2GB (country) instead of 80GB (global)

---

## Security Considerations

### Cryptographic Guarantees

- ✅ **Collision Resistance**: Keccak256 (SHA-3) provides 256-bit security
- ✅ **Preimage Resistance**: Cannot reverse hash to find original data
- ✅ **Determinism**: Same input always produces same root (reproducible audits)

### Attack Vectors

**1. Root Tampering** (Mitigated by on-chain commitment)
- Attacker publishes fake root on IPFS
- **Defense**: Users verify root matches on-chain smart contract event

**2. Proof Forgery** (Mitigated by hash security)
- Attacker creates fake proof for district they don't live in
- **Defense**: Keccak256 collision resistance (computationally infeasible)

**3. Data Availability** (Mitigated by IPFS pinning)
- IPFS gateway goes offline, users can't download data
- **Defense**: Multiple pinning services (Pinata, Filebase) + S3 fallback

**4. Smart Contract Compromise** (Mitigated by multi-sig governance)
- Attacker gains control of contract, updates root maliciously
- **Defense**: Multi-sig ownership, governance timelock, emergency pause

### Audit Trail

- **Git History**: All data transformations tracked in version control
- **Deterministic Builds**: Script produces same output given same input
- **Test Coverage**: 36 tests validate construction and verification
- **Human-Readable Reports**: `merkle_tree_report.txt` provides audit summary

---

## Engineering Distinction

### What Makes This Production-Grade

1. **Deterministic Ordering**: Lexicographic sort by `district_id` ensures canonical tree
2. **100% Proof Validation**: All proofs verified before publishing (integrity check)
3. **Comprehensive Tests**: 36 tests cover edge cases, adversarial inputs, performance
4. **Keccak256 Hashing**: Ethereum-compatible hashing (not experimental crypto)
5. **Audit Trail**: Human-readable reports + machine-readable JSON for automation
6. **Error Handling**: Fails fast on validation errors (no silent corruption)
7. **Performance**: 0.37 seconds for 4,175 districts (scalable to 50k+)

### What This Enables (ZK Proofs)

Users can prove: **"I live in San Francisco District 1"**

Without revealing:
- ❌ Street address
- ❌ Latitude/longitude
- ❌ Name
- ❌ Any PII

While verifying:
- ✅ District membership (cryptographically sound)
- ✅ District is in Shadow Atlas (Merkle proof)
- ✅ Shadow Atlas root is committed on-chain (smart contract event)

**This is the foundation for privacy-preserving civic participation at scale.**

---

## Appendix: File Structure

```
agents/
├── merkle-tree-builder.ts           # Layer 5 implementation
├── merkle-tree-builder.test.ts      # Test suite (36 tests)
├── data/
│   ├── comprehensive_classified_layers.jsonl  # Input (31,316 districts)
│   ├── merkle_tree.json              # Output: Tree structure (187 bytes)
│   ├── merkle_proofs.json            # Output: All proofs (5.8 MB)
│   ├── merkle_leaves.json            # Output: Leaf data (2.0 MB)
│   ├── merkle_tree_report.txt        # Output: Human-readable report (996 bytes)
│   └── merkle_tree_report.json       # Output: Machine-readable report (431 bytes)
└── MERKLE-TREE-LAYER5-README.md      # This file
```

---

## References

- **DATA-VALIDATION-STRATEGY.md**: Layer 5 specification (lines 296-374)
- **GLOBAL-SCALING-ARCHITECTURE.md**: IPFS publishing (Section 6), ZK circuits (Section 8)
- **merkle-tree.test.ts**: Existing Merkle tree tests (Poseidon hashing, WASM integration)
- **governance-district.ts**: TypeScript schema for district data

---

**Status**: ✅ Layer 5 complete. Ready for IPFS publishing and on-chain commitment.

**Next**: Deploy to Scroll L2, integrate with browser client ZK prover.

**Quality discourse pays. Bad faith costs. Cryptographic integrity is non-negotiable.**
