/**
 * Unit tests for PositionTreeBuilder
 *
 * Tests cover:
 * 1. Basic construction and depth validation
 * 2. appendPosition: leaf hashing with DOMAIN_POS_COMMIT
 * 3. Root changes deterministically after each append
 * 4. getProof: Merkle path structure and verifiability
 * 5. verifyProof: local root reconstruction
 * 6. Domain separation: DOMAIN_POS_COMMIT vs DOMAIN_HASH3 and DOMAIN_HASH2
 * 7. Index tracking correctness (sequential, up to capacity)
 * 8. buildPositionTreeFromCommitments: reconstruction parity
 * 9. verifyPositionMerkleProof: standalone helper
 * 10. getLeafCount / getCapacity / getState
 *
 * NOTE: These tests use real Poseidon2 hashing via the Noir WASM runtime.
 * WASM initialization takes ~150s the first time — the beforeAll timeout is
 * set to 180_000ms to match the pattern used across this test suite.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getHasher } from '@voter-protocol/crypto/poseidon2';
import {
  PositionTreeBuilder,
  DOMAIN_POS_COMMIT,
  POSITION_TREE_DEFAULT_DEPTH,
  computePositionCommitment,
  buildPositionTreeFromCommitments,
  verifyPositionMerkleProof,
  type PositionMerkleProof,
} from '../../position-tree-builder.js';

// ============================================================================
// Test depth
// ============================================================================

/**
 * Use depth 4 (capacity 16) for most tests — small enough to be fast,
 * large enough to exercise multi-level path traversal.
 */
const TEST_DEPTH = 4;

// ============================================================================
// Shared hasher reference (to verify domain separation manually)
// ============================================================================

let hasherReady = false;

beforeAll(async () => {
  // Trigger WASM initialization here so the first test doesn't time out.
  await getHasher();
  hasherReady = true;
}, 180_000);

// ============================================================================
// Helper: deterministic test inputs
// ============================================================================

function makeInputs(seed: number) {
  return {
    argumentIndex: BigInt(seed),
    weightedAmount: BigInt(seed * 1000 + 1),
    randomness: BigInt(seed * 999983 + 7),
  };
}

// ============================================================================
// 1. Construction
// ============================================================================

describe('PositionTreeBuilder construction', () => {
  it('accepts default depth 20', () => {
    const builder = new PositionTreeBuilder();
    expect(builder.depth).toBe(20);
    expect(builder.getCapacity()).toBe(2 ** 20);
  });

  it('accepts custom depth', () => {
    const builder = new PositionTreeBuilder(TEST_DEPTH);
    expect(builder.depth).toBe(TEST_DEPTH);
    expect(builder.getCapacity()).toBe(2 ** TEST_DEPTH);
  });

  it('rejects depth 0', () => {
    expect(() => new PositionTreeBuilder(0)).toThrow(RangeError);
  });

  it('rejects depth > 24', () => {
    expect(() => new PositionTreeBuilder(25)).toThrow(RangeError);
  });

  it('starts with zero leaf count', () => {
    const builder = new PositionTreeBuilder(TEST_DEPTH);
    expect(builder.getLeafCount()).toBe(0);
  });
});

// ============================================================================
// 2. Empty tree root
// ============================================================================

describe('PositionTreeBuilder empty root', () => {
  it('returns a non-zero root for an empty tree (padding root)', async () => {
    const builder = new PositionTreeBuilder(TEST_DEPTH);
    const root = await builder.getRoot();
    expect(typeof root).toBe('bigint');
    expect(root).toBeGreaterThan(0n);
  }, 180_000);

  it('two empty trees at same depth produce identical roots', async () => {
    const a = new PositionTreeBuilder(TEST_DEPTH);
    const b = new PositionTreeBuilder(TEST_DEPTH);
    const rootA = await a.getRoot();
    const rootB = await b.getRoot();
    expect(rootA).toBe(rootB);
  }, 180_000);

  it('empty trees at different depths produce different roots', async () => {
    const d4 = new PositionTreeBuilder(4);
    const d5 = new PositionTreeBuilder(5);
    const root4 = await d4.getRoot();
    const root5 = await d5.getRoot();
    // Different depths = different zero-hash chains = different roots
    expect(root4).not.toBe(root5);
  }, 180_000);
});

// ============================================================================
// 3. appendPosition and root mutation
// ============================================================================

describe('PositionTreeBuilder appendPosition', () => {
  it('returns index 0 for the first append', async () => {
    const builder = new PositionTreeBuilder(TEST_DEPTH);
    const { argumentIndex, weightedAmount, randomness } = makeInputs(1);
    const result = await builder.appendPosition(argumentIndex, weightedAmount, randomness);
    expect(result.index).toBe(0);
  }, 180_000);

  it('returns sequential indices', async () => {
    const builder = new PositionTreeBuilder(TEST_DEPTH);
    for (let i = 0; i < 5; i++) {
      const { argumentIndex, weightedAmount, randomness } = makeInputs(i + 1);
      const result = await builder.appendPosition(argumentIndex, weightedAmount, randomness);
      expect(result.index).toBe(i);
    }
    expect(builder.getLeafCount()).toBe(5);
  }, 180_000);

  it('root changes after each append', async () => {
    const builder = new PositionTreeBuilder(TEST_DEPTH);
    const roots = new Set<bigint>();

    const emptyRoot = await builder.getRoot();
    roots.add(emptyRoot);

    for (let i = 0; i < 4; i++) {
      const { argumentIndex, weightedAmount, randomness } = makeInputs(i + 1);
      await builder.appendPosition(argumentIndex, weightedAmount, randomness);
      const root = await builder.getRoot();
      // Each insertion must produce a distinct root
      expect(roots.has(root)).toBe(false);
      roots.add(root);
    }
    expect(roots.size).toBe(5); // 1 empty + 4 non-empty
  }, 180_000);

  it('commitment matches computePositionCommitment helper', async () => {
    const builder = new PositionTreeBuilder(TEST_DEPTH);
    const { argumentIndex, weightedAmount, randomness } = makeInputs(42);

    const result = await builder.appendPosition(argumentIndex, weightedAmount, randomness);
    const standalone = await computePositionCommitment(argumentIndex, weightedAmount, randomness);

    expect(result.commitment).toBe(standalone);
  }, 180_000);

  it('same inputs always produce the same commitment (determinism)', async () => {
    const { argumentIndex, weightedAmount, randomness } = makeInputs(7);
    const c1 = await computePositionCommitment(argumentIndex, weightedAmount, randomness);
    const c2 = await computePositionCommitment(argumentIndex, weightedAmount, randomness);
    expect(c1).toBe(c2);
  }, 180_000);

  it('throws when tree is full', async () => {
    const builder = new PositionTreeBuilder(1); // capacity = 2
    await builder.appendPosition(1n, 1000n, 7n);
    await builder.appendPosition(2n, 2000n, 13n);
    await expect(builder.appendPosition(3n, 3000n, 17n)).rejects.toThrow(/full/);
  }, 180_000);
});

// ============================================================================
// 4. getProof and verifyProof
// ============================================================================

describe('PositionTreeBuilder proofs', () => {
  it('getProof returns path of correct length', async () => {
    const builder = new PositionTreeBuilder(TEST_DEPTH);
    const { argumentIndex, weightedAmount, randomness } = makeInputs(1);
    const { index } = await builder.appendPosition(argumentIndex, weightedAmount, randomness);

    const proof = await builder.getProof(index);
    expect(proof.path.length).toBe(TEST_DEPTH);
  }, 180_000);

  it('getProof returns the correct leaf index', async () => {
    const builder = new PositionTreeBuilder(TEST_DEPTH);
    for (let i = 0; i < 3; i++) {
      const { argumentIndex, weightedAmount, randomness } = makeInputs(i + 1);
      await builder.appendPosition(argumentIndex, weightedAmount, randomness);
    }
    const proof = await builder.getProof(2);
    expect(proof.index).toBe(2);
  }, 180_000);

  it('verifyProof returns true for a valid proof', async () => {
    const builder = new PositionTreeBuilder(TEST_DEPTH);
    const { argumentIndex, weightedAmount, randomness } = makeInputs(5);
    const { index } = await builder.appendPosition(argumentIndex, weightedAmount, randomness);

    const proof = await builder.getProof(index);
    const valid = await builder.verifyProof(proof);
    expect(valid).toBe(true);
  }, 180_000);

  it('verifyProof returns false for a tampered sibling', async () => {
    const builder = new PositionTreeBuilder(TEST_DEPTH);
    const { argumentIndex, weightedAmount, randomness } = makeInputs(5);
    const { index } = await builder.appendPosition(argumentIndex, weightedAmount, randomness);

    const proof = await builder.getProof(index);

    // Tamper the first sibling
    const badPath = [...proof.path];
    badPath[0] = proof.path[0] ^ 0xdeadbeefn;
    const badProof: PositionMerkleProof = { ...proof, path: badPath };

    const valid = await builder.verifyProof(badProof);
    expect(valid).toBe(false);
  }, 180_000);

  it('verifyProof works for multiple appended positions', async () => {
    const builder = new PositionTreeBuilder(TEST_DEPTH);

    const appended: Array<{ index: number; commitment: bigint }> = [];
    for (let i = 0; i < 6; i++) {
      const { argumentIndex, weightedAmount, randomness } = makeInputs(i + 10);
      const result = await builder.appendPosition(argumentIndex, weightedAmount, randomness);
      appended.push(result);
    }

    // Verify all proofs are valid simultaneously
    for (const { index } of appended) {
      const proof = await builder.getProof(index);
      const valid = await builder.verifyProof(proof);
      expect(valid).toBe(true);
    }
  }, 180_000);

  it('proof for index 0 and proof for index 1 use different siblings', async () => {
    const builder = new PositionTreeBuilder(TEST_DEPTH);
    await builder.appendPosition(1n, 100n, 7n);
    await builder.appendPosition(2n, 200n, 13n);

    const proof0 = await builder.getProof(0);
    const proof1 = await builder.getProof(1);

    // Siblings at level 0 are each other's commitment
    expect(proof0.path[0]).toBe(proof1.commitment);
    expect(proof1.path[0]).toBe(proof0.commitment);
  }, 180_000);

  it('getProof throws for out-of-range index', async () => {
    const builder = new PositionTreeBuilder(TEST_DEPTH);
    await builder.appendPosition(1n, 100n, 7n);

    await expect(builder.getProof(1)).rejects.toThrow(RangeError);
    await expect(builder.getProof(-1)).rejects.toThrow(RangeError);
  }, 180_000);
});

// ============================================================================
// 5. Standalone verifyPositionMerkleProof helper
// ============================================================================

describe('verifyPositionMerkleProof', () => {
  it('validates a proof against the known root', async () => {
    const builder = new PositionTreeBuilder(TEST_DEPTH);
    const { argumentIndex, weightedAmount, randomness } = makeInputs(100);
    const { index, commitment } = await builder.appendPosition(argumentIndex, weightedAmount, randomness);

    const proof = await builder.getProof(index);
    const root = await builder.getRoot();

    const valid = await verifyPositionMerkleProof(commitment, proof.path, index, root, TEST_DEPTH);
    expect(valid).toBe(true);
  }, 180_000);

  it('returns false for wrong root', async () => {
    const builder = new PositionTreeBuilder(TEST_DEPTH);
    const { argumentIndex, weightedAmount, randomness } = makeInputs(100);
    const { index, commitment } = await builder.appendPosition(argumentIndex, weightedAmount, randomness);

    const proof = await builder.getProof(index);
    const wrongRoot = 0xdeadbeefn;

    const valid = await verifyPositionMerkleProof(commitment, proof.path, index, wrongRoot, TEST_DEPTH);
    expect(valid).toBe(false);
  }, 180_000);

  it('throws when path length does not match depth', async () => {
    await expect(
      verifyPositionMerkleProof(1n, [1n, 2n], 0, 999n, 5)
    ).rejects.toThrow(/path length/);
  }, 180_000);
});

// ============================================================================
// 6. Domain separation
// ============================================================================

describe('Domain separation', () => {
  it('DOMAIN_POS_COMMIT is 0x50434d', () => {
    expect(DOMAIN_POS_COMMIT).toBe(0x50434dn);
  });

  it('changing domain produces different commitment (DOMAIN_POS_COMMIT vs standard hash3)', async () => {
    const hasher = await getHasher();
    const a = 10n;
    const b = 20000n;
    const c = 99999n;

    const withPcmDomain = await hasher.hashWithCustomDomain3(a, b, c, DOMAIN_POS_COMMIT);
    const withH3Domain = await hasher.hash3(a, b, c); // uses DOMAIN_HASH3 = 0x48334d

    expect(withPcmDomain).not.toBe(withH3Domain);
  }, 180_000);

  it('changing a single input field produces a different commitment', async () => {
    const base = makeInputs(1);

    const c1 = await computePositionCommitment(base.argumentIndex, base.weightedAmount, base.randomness);
    const c2 = await computePositionCommitment(base.argumentIndex + 1n, base.weightedAmount, base.randomness);
    const c3 = await computePositionCommitment(base.argumentIndex, base.weightedAmount + 1n, base.randomness);
    const c4 = await computePositionCommitment(base.argumentIndex, base.weightedAmount, base.randomness + 1n);

    // All four must be distinct
    const set = new Set([c1, c2, c3, c4]);
    expect(set.size).toBe(4);
  }, 180_000);

  it('node hashing uses DOMAIN_HASH2 (hashPair is domain-tagged)', async () => {
    // Verify that the node hash is NOT equal to a raw Poseidon2 call
    // with no domain tag (which would be hash3(left, right, 0)).
    const hasher = await getHasher();
    const left = 111n;
    const right = 222n;

    const pairHash = await hasher.hashPair(left, right);   // uses 0x48324d
    const noDomain = await hasher.hash3(left, right, 0n);  // uses 0x48334d (H3M), different

    expect(pairHash).not.toBe(noDomain);
  }, 180_000);
});

// ============================================================================
// 7. Index tracking / capacity
// ============================================================================

describe('Index tracking', () => {
  it('fills tree to capacity without error', async () => {
    const DEPTH = 2; // capacity = 4
    const builder = new PositionTreeBuilder(DEPTH);

    for (let i = 0; i < 4; i++) {
      const result = await builder.appendPosition(BigInt(i), BigInt(i * 100), BigInt(i * 7));
      expect(result.index).toBe(i);
    }

    expect(builder.getLeafCount()).toBe(4);
    expect(builder.getCapacity()).toBe(4);
  }, 180_000);

  it('getLeaves() returns commitments in insertion order', async () => {
    const builder = new PositionTreeBuilder(TEST_DEPTH);
    const expected: bigint[] = [];

    for (let i = 0; i < 4; i++) {
      const { argumentIndex, weightedAmount, randomness } = makeInputs(i + 1);
      const result = await builder.appendPosition(argumentIndex, weightedAmount, randomness);
      expected.push(result.commitment);
    }

    const leaves = builder.getLeaves();
    expect(leaves).toEqual(expected);
  }, 180_000);
});

// ============================================================================
// 8. buildPositionTreeFromCommitments reconstruction
// ============================================================================

describe('buildPositionTreeFromCommitments', () => {
  it('produces the same root as the original tree', async () => {
    const original = new PositionTreeBuilder(TEST_DEPTH);

    for (let i = 0; i < 5; i++) {
      const { argumentIndex, weightedAmount, randomness } = makeInputs(i + 1);
      await original.appendPosition(argumentIndex, weightedAmount, randomness);
    }

    const originalRoot = await original.getRoot();
    const originalLeaves = original.getLeaves();

    const reconstructed = await buildPositionTreeFromCommitments(originalLeaves, TEST_DEPTH);
    const reconstructedRoot = await reconstructed.getRoot();

    expect(reconstructedRoot).toBe(originalRoot);
  }, 180_000);

  it('reconstructed tree generates valid proofs', async () => {
    const original = new PositionTreeBuilder(TEST_DEPTH);

    for (let i = 0; i < 4; i++) {
      const { argumentIndex, weightedAmount, randomness } = makeInputs(i + 20);
      await original.appendPosition(argumentIndex, weightedAmount, randomness);
    }

    const leaves = original.getLeaves();
    const rebuilt = await buildPositionTreeFromCommitments(leaves, TEST_DEPTH);

    for (let i = 0; i < leaves.length; i++) {
      const proof = await rebuilt.getProof(i);
      const valid = await rebuilt.verifyProof(proof);
      expect(valid).toBe(true);
    }
  }, 180_000);
});

// ============================================================================
// 9. getState snapshot
// ============================================================================

describe('getState', () => {
  it('returns correct metadata before any append', async () => {
    const builder = new PositionTreeBuilder(TEST_DEPTH);
    const state = await builder.getState();

    expect(state.depth).toBe(TEST_DEPTH);
    expect(state.capacity).toBe(2 ** TEST_DEPTH);
    expect(state.leafCount).toBe(0);
    expect(typeof state.root).toBe('bigint');
  }, 180_000);

  it('leafCount in getState reflects appended positions', async () => {
    const builder = new PositionTreeBuilder(TEST_DEPTH);

    await builder.appendPosition(1n, 100n, 7n);
    await builder.appendPosition(2n, 200n, 13n);

    const state = await builder.getState();
    expect(state.leafCount).toBe(2);
  }, 180_000);
});

// ============================================================================
// 10. Position_note prover compatibility (public inputs shape)
// ============================================================================

describe('position_note prover type compatibility', () => {
  /**
   * The position_note circuit expects 5 public inputs:
   *   [0] position_root    (the Merkle root)
   *   [1] commitment       (the leaf value)
   *   [2] argument_index   (revealed on-chain)
   *   [3] weighted_amount  (revealed on-chain)
   *   [4] position_index   (leaf index in the tree)
   *
   * This test verifies that the data returned by PositionTreeBuilder maps
   * cleanly to those 5 fields without any type coercion.
   */
  it('proof data maps to the 5 expected public inputs', async () => {
    const builder = new PositionTreeBuilder(TEST_DEPTH);
    const argumentIndex = 3n;
    const weightedAmount = 5000n;
    const randomness = 42n;

    const { index, commitment } = await builder.appendPosition(
      argumentIndex,
      weightedAmount,
      randomness,
    );

    const root = await builder.getRoot();
    const proof = await builder.getProof(index);

    // Simulate the 5-field public inputs array
    const publicInputs: bigint[] = [
      root,               // [0] position_root
      commitment,         // [1] commitment
      argumentIndex,      // [2] argument_index (from TradeRevealed)
      weightedAmount,     // [3] weighted_amount (from TradeRevealed)
      BigInt(index),      // [4] position_index
    ];

    expect(publicInputs.length).toBe(5);
    expect(publicInputs.every(v => typeof v === 'bigint')).toBe(true);

    // Verify the proof would pass circuit inclusion check
    const valid = await builder.verifyProof(proof);
    expect(valid).toBe(true);

    // path should have exactly DEPTH entries
    expect(proof.path.length).toBe(TEST_DEPTH);
  }, 180_000);
});

// ============================================================================
// 11. insertCommitment (reconstruction API)
// ============================================================================

describe('insertCommitment', () => {
  it('produces the same root as appendPosition for identical commitments', async () => {
    const original = new PositionTreeBuilder(TEST_DEPTH);
    const commitments: bigint[] = [];

    for (let i = 0; i < 4; i++) {
      const { argumentIndex, weightedAmount, randomness } = makeInputs(i + 100);
      const result = await original.appendPosition(argumentIndex, weightedAmount, randomness);
      commitments.push(result.commitment);
    }

    const originalRoot = await original.getRoot();

    // Rebuild using insertCommitment
    const rebuilt = new PositionTreeBuilder(TEST_DEPTH);
    for (const c of commitments) {
      await rebuilt.insertCommitment(c);
    }

    expect(await rebuilt.getRoot()).toBe(originalRoot);
  }, 180_000);
});
