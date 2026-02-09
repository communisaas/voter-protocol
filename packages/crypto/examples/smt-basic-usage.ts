/**
 * Sparse Merkle Tree - Basic Usage Example
 *
 * This example demonstrates the core functionality of the Sparse Merkle Tree
 * implementation for the Two-Tree Architecture.
 */

import { createSparseMerkleTree, SparseMerkleTree } from '../sparse-merkle-tree';
import { Poseidon2Hasher } from '../poseidon2';

async function basicUsageExample() {
  console.log('=== Sparse Merkle Tree - Basic Usage ===\n');

  // Step 1: Create a tree
  console.log('1. Creating tree with depth 16 (capacity: 65,536)...');
  const tree = await createSparseMerkleTree({ depth: 16 });
  console.log(`   ✓ Tree created (depth: ${tree.getDepth()}, capacity: ${tree.getCapacity()})\n`);

  // Step 2: Insert some Census Tract mappings (simulated)
  console.log('2. Inserting Census Tract → District mappings...');

  const cellData = [
    { cellId: 6075061200n, districtCommitment: 0x1234567890abcdefn }, // SF Census Tract
    { cellId: 36061000100n, districtCommitment: 0xfedcba0987654321n }, // NYC Census Tract
    { cellId: 48201000200n, districtCommitment: 0xabcdef1234567890n }, // Houston Census Tract
  ];

  for (const { cellId, districtCommitment } of cellData) {
    await tree.insert(cellId, districtCommitment);
    console.log(`   ✓ Inserted cell ${cellId} → ${districtCommitment.toString(16)}`);
  }
  console.log(`   Tree size: ${tree.size()} nodes\n`);

  // Step 3: Compute root
  console.log('3. Computing tree root...');
  const root = await tree.getRoot();
  console.log(`   ✓ Root: 0x${root.toString(16).substring(0, 32)}...\n`);

  // Step 4: Generate membership proof
  console.log('4. Generating membership proof for cell 6075061200...');
  const proof = await tree.getProof(6075061200n);
  console.log(`   ✓ Proof generated:`);
  console.log(`     - Key: ${proof.key}`);
  console.log(`     - Value: 0x${proof.value.toString(16)}`);
  console.log(`     - Siblings: ${proof.siblings.length} hashes`);
  console.log(`     - Path bits: [${proof.pathBits.slice(0, 8).join(', ')}...]`);
  console.log(`     - Attempt: ${proof.attempt} (collision counter)\n`);

  // Step 5: Verify proof
  console.log('5. Verifying proof...');
  const hasher = await Poseidon2Hasher.getInstance();
  const isValid = await SparseMerkleTree.verify(proof, root, hasher);
  console.log(`   ✓ Proof valid: ${isValid}\n`);

  // Step 6: Generate non-membership proof
  console.log('6. Generating non-membership proof for missing cell 99999...');
  const nonMemberProof = await tree.getProof(99999n);
  const nonMemberValid = await SparseMerkleTree.verify(nonMemberProof, root, hasher);
  console.log(`   ✓ Non-membership proof valid: ${nonMemberValid}`);
  console.log(`     (Proves that cell 99999 is NOT in the tree)\n`);

  // Step 7: Update existing cell
  console.log('7. Updating cell 6075061200 with new district commitment...');
  const oldRoot = await tree.getRoot();
  await tree.insert(6075061200n, 0x999999999n);
  const newRoot = await tree.getRoot();
  console.log(`   ✓ Root changed: ${oldRoot !== newRoot}`);
  console.log(`     Old: 0x${oldRoot.toString(16).substring(0, 16)}...`);
  console.log(`     New: 0x${newRoot.toString(16).substring(0, 16)}...\n`);

  // Step 8: Export tree data
  console.log('8. Exporting tree entries...');
  const entries = tree.entries();
  console.log(`   ✓ Exported ${entries.length} entries`);
  for (const [key, value] of entries) {
    console.log(`     - Cell ${key} → 0x${value.toString(16)}`);
  }
  console.log();

  console.log('=== Example Complete ===\n');
}

async function collisionHandlingExample() {
  console.log('=== Collision Handling Example ===\n');

  // Create a small tree to force collisions
  console.log('1. Creating small tree (depth 8, capacity 256)...');
  const tree = await createSparseMerkleTree({ depth: 8 });
  console.log(`   ✓ Tree created\n`);

  // Insert many keys to trigger collision handling
  console.log('2. Inserting 50 keys (likely to cause collisions)...');
  let collisions = 0;

  for (let i = 0; i < 50; i++) {
    const key = BigInt(i * 1000);
    const value = BigInt(i);
    await tree.insert(key, value);

    // Check if this key had a collision (attempt > 0)
    const proof = await tree.getProof(key);
    if (proof.attempt > 0) {
      collisions++;
      console.log(`   ⚠ Collision detected for key ${key} (attempt ${proof.attempt})`);
    }
  }

  console.log(`\n   ✓ Inserted 50 keys`);
  console.log(`   Collisions handled: ${collisions}\n`);

  // Verify all keys are still retrievable
  console.log('3. Verifying all keys are retrievable...');
  const hasher = await Poseidon2Hasher.getInstance();
  const root = await tree.getRoot();

  for (let i = 0; i < 50; i++) {
    const key = BigInt(i * 1000);
    const proof = await tree.getProof(key);
    const isValid = await SparseMerkleTree.verify(proof, root, hasher);

    if (!isValid) {
      console.error(`   ✗ Key ${key} verification failed!`);
      return;
    }
  }

  console.log(`   ✓ All 50 keys verified successfully\n`);
  console.log('=== Collision Handling Example Complete ===\n');
}

async function performanceExample() {
  console.log('=== Performance Example ===\n');

  console.log('1. Building tree with 1000 entries...');
  const tree = await createSparseMerkleTree({ depth: 20 });

  const startInsert = Date.now();
  for (let i = 0; i < 1000; i++) {
    await tree.insert(BigInt(i), BigInt(i * 123456));
  }
  const insertTime = Date.now() - startInsert;

  console.log(`   ✓ Inserted 1000 entries in ${insertTime}ms`);
  console.log(`     Average: ${(insertTime / 1000).toFixed(2)}ms per insertion\n`);

  console.log('2. Computing root...');
  const startRoot = Date.now();
  const root = await tree.getRoot();
  const rootTime = Date.now() - startRoot;

  console.log(`   ✓ Root computed in ${rootTime}ms (cached for subsequent calls)\n`);

  console.log('3. Generating 10 proofs...');
  const startProofs = Date.now();
  const hasher = await Poseidon2Hasher.getInstance();

  for (let i = 0; i < 10; i++) {
    const key = BigInt(i * 100);
    const proof = await tree.getProof(key);
    await SparseMerkleTree.verify(proof, root, hasher);
  }

  const proofsTime = Date.now() - startProofs;
  console.log(`   ✓ Generated and verified 10 proofs in ${proofsTime}ms`);
  console.log(`     Average: ${(proofsTime / 10).toFixed(2)}ms per proof\n`);

  console.log('=== Performance Example Complete ===\n');
}

// Run examples
async function main() {
  try {
    await basicUsageExample();
    await collisionHandlingExample();
    await performanceExample();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Only run if executed directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { basicUsageExample, collisionHandlingExample, performanceExample };
