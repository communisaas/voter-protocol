# Sparse Merkle Tree Implementation

**Purpose:** Tree 2 of the Two-Tree Architecture for Voter Protocol

This Sparse Merkle Tree (SMT) maps Census Tract cell IDs to their 24-slot district arrays, enabling efficient redistricting updates without requiring user re-registration.

## Features

- **Deterministic positioning**: Cell ID determines position via hash-based mapping
- **Collision handling**: Overflow chaining handles birthday paradox collisions
- **Efficient proofs**: Membership and non-membership proofs with sibling paths
- **Empty subtree optimization**: Precomputed hashes for unoccupied positions
- **Poseidon2 hashing**: Circuit-compatible hashing using Noir stdlib

## Installation

```bash
npm install @voter-protocol/crypto
```

## Quick Start

```typescript
import { createSparseMerkleTree, SparseMerkleTree, type Field } from '@voter-protocol/crypto';

// Create a tree with depth 20 (1M capacity)
const tree = await createSparseMerkleTree({ depth: 20 });

// Insert cell-to-district mappings
const cellId = 6075061200n; // San Francisco Census Tract
const districtCommitment = 0x123...n; // Hash of 24 districts

await tree.insert(cellId, districtCommitment);

// Get root for on-chain verification
const root = await tree.getRoot();

// Generate proof for ZK circuit
const proof = await tree.getProof(cellId);

// Verify proof
const hasher = await Poseidon2Hasher.getInstance();
const isValid = await SparseMerkleTree.verify(proof, root, hasher);
```

## API Reference

### `createSparseMerkleTree(config?)`

Creates a new Sparse Merkle Tree instance.

**Parameters:**
- `config.depth` (optional): Tree depth, default 20 (1M capacity)
- `config.hasher` (optional): Poseidon2Hasher instance

**Returns:** `Promise<SparseMerkleTree>`

### `tree.insert(key, value)`

Inserts or updates a key-value pair.

**Parameters:**
- `key`: bigint - Cell ID or other key
- `value`: bigint - District commitment or other value

**Returns:** `Promise<void>`

### `tree.get(key)`

Retrieves value for a key.

**Parameters:**
- `key`: bigint - Key to lookup

**Returns:** `Field | undefined`

### `tree.getRoot()`

Computes and returns the current root hash.

**Returns:** `Promise<Field>`

### `tree.getProof(key)`

Generates a Merkle proof for a key (membership or non-membership).

**Parameters:**
- `key`: bigint - Key to prove

**Returns:** `Promise<SMTProof>`

**Proof structure:**
```typescript
interface SMTProof {
  key: Field;           // Key being proven
  value: Field;         // Value at this key (or empty hash)
  siblings: Field[];    // Sibling hashes (length = depth)
  pathBits: number[];   // Path directions: 0=left, 1=right
  root: Field;          // Root hash
  attempt: number;      // Collision handling counter
}
```

### `SparseMerkleTree.verify(proof, root, hasher)`

Static method to verify a proof.

**Parameters:**
- `proof`: SMTProof - Proof to verify
- `root`: Field - Expected root hash
- `hasher`: Poseidon2Hasher - Hash function instance

**Returns:** `Promise<boolean>`

## Usage in Two-Tree Architecture

### Shadow Atlas (Server-side)

```typescript
import { createSparseMerkleTree } from '@voter-protocol/crypto';
import { Poseidon2Hasher } from '@voter-protocol/crypto/poseidon2';

// Build cell map tree from Census data
const cellMapTree = await createSparseMerkleTree({ depth: 20 });

// For each Census Tract, compute and insert district commitment
for (const tract of censustracts) {
  const cellId = BigInt(tract.fipsCode);

  // Get 24 districts for this cell
  const districts = await lookupDistricts(tract);

  // Compute district commitment using sponge construction
  const hasher = await Poseidon2Hasher.getInstance();
  let state = [DOMAIN_SPONGE_24, 0n, 0n, 0n];
  for (let i = 0; i < 8; i++) {
    state[1] += districts[i * 3];
    state[2] += districts[i * 3 + 1];
    state[3] += districts[i * 3 + 2];
    state = await hasher.hash4(...state);
  }
  const districtCommitment = state[0];

  // Insert into tree
  await cellMapTree.insert(cellId, districtCommitment);
}

// Publish root on-chain
const cellMapRoot = await cellMapTree.getRoot();
await publishToCellMapRegistry(cellMapRoot);

// Provide proofs to clients
app.get('/api/cell-proof/:cellId', async (req, res) => {
  const cellId = BigInt(req.params.cellId);
  const proof = await cellMapTree.getProof(cellId);
  res.json(proof);
});
```

### Client (Browser)

```typescript
import { SparseMerkleTree } from '@voter-protocol/crypto';
import { Poseidon2Hasher } from '@voter-protocol/crypto/poseidon2';

// Fetch proof from Shadow Atlas
const response = await fetch(`/api/cell-proof/${cellId}`);
const proof = await response.json();

// Verify proof locally
const hasher = await Poseidon2Hasher.getInstance();
const isValid = await SparseMerkleTree.verify(proof, proof.root, hasher);

if (isValid) {
  // Use proof in ZK circuit for voting
  await generateVotingProof({
    cellMapPath: proof.siblings,
    cellMapPathBits: proof.pathBits,
    cellMapRoot: proof.root,
    // ...other inputs
  });
}
```

## Performance

- **Tree construction**: ~1-2 seconds for 242K Census Tracts (depth 20)
- **Proof generation**: ~50-100ms per proof (20 hash operations)
- **Proof verification**: ~50-100ms (20 hash operations)
- **Memory**: ~32MB for 242K entries (32 bytes per entry)

**Optimization features:**
- Memoization for subtree hash computation
- Precomputed empty hashes for unoccupied positions
- Iterative bottom-up root computation
- Collision handling via overflow chaining

## Collision Handling

With 242K cells mapped to 2^20 (1M) positions, collisions are possible (~8% probability).

**Resolution strategy:**
```
position = hash(cell_id, attempt=0)
while occupied[position] && stored_key[position] != cell_id:
    attempt++
    position = hash(cell_id, attempt)
```

The `attempt` counter is stored in proofs so verification uses the correct position.

## Security

- **Hash function**: Poseidon2 (Noir stdlib) - identical to ZK circuit
- **Domain separation**: Empty cells use tagged hash to prevent collisions
- **Proof binding**: Root, key, value, and path all cryptographically linked
- **No information leakage**: Tree structure reveals no geographic information

## Related Specifications

- [Two-Tree Architecture Spec](../../specs/TWO-TREE-ARCHITECTURE-SPEC.md)
- [Two-Tree Agent Review](../../specs/TWO-TREE-AGENT-REVIEW-SUMMARY.md)
- [District Taxonomy](../../specs/DISTRICT-TAXONOMY.md)

## Testing

```bash
npm test -- sparse-merkle-tree.test.ts
```

**Test coverage:**
- ✅ Empty tree deterministic root
- ✅ Single insertion changes root
- ✅ Membership proof verification
- ✅ Non-membership proof verification
- ✅ Collision handling (overflow chaining)
- ✅ Large tree (100 insertions) with proof verification
- ✅ Proof serialization round-trip
- ✅ Position derivation determinism
- ✅ Empty hash precomputation
- ✅ Error handling (invalid inputs, collision overflow)

All 42 tests pass in ~14 seconds.
