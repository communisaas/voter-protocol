/**
 * Tests for Shadow Atlas Merkle Tree v2 - Parallel Implementation
 *
 * Tests cover:
 * - Poseidon2Hasher singleton initialization and operations
 * - Parallel Merkle tree construction
 * - Proof generation and verification
 * - Edge cases and error handling
 * - Performance characteristics
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  ShadowAtlasMerkleTreeV2,
  createShadowAtlasMerkleTree,
  computeLeafHash,
  computeLeafHashesBatch,
  AUTHORITY_LEVELS,
  type MerkleLeafInput,
} from './merkle-tree-v2.js';
import { Poseidon2Hasher, getHasher } from './crypto/poseidon2-hasher.js';

describe('Poseidon2Hasher', () => {
  let hasher: Poseidon2Hasher;

  beforeAll(async () => {
    hasher = await getHasher();
  }, 30000); // Allow time for WASM initialization

  afterAll(() => {
    Poseidon2Hasher.resetInstance();
  });

  describe('Singleton Pattern', () => {
    it('should return same instance on multiple calls', async () => {
      const instance1 = await getHasher();
      const instance2 = await getHasher();
      expect(instance1).toBe(instance2);
    });

    it('should handle concurrent initialization', async () => {
      Poseidon2Hasher.resetInstance();

      // Request multiple instances concurrently
      const [i1, i2, i3] = await Promise.all([
        getHasher(),
        getHasher(),
        getHasher(),
      ]);

      expect(i1).toBe(i2);
      expect(i2).toBe(i3);
    });
  });

  describe('Hash Operations', () => {
    it('should hash pair of values', async () => {
      const hash = await hasher.hashPair(1n, 2n);
      expect(typeof hash).toBe('bigint');
      expect(hash).toBeGreaterThan(0n);
    });

    it('should produce deterministic results', async () => {
      const hash1 = await hasher.hashPair(12345n, 67890n);
      const hash2 = await hasher.hashPair(12345n, 67890n);
      expect(hash1).toBe(hash2);
    });

    it('should be non-commutative: hash(a,b) ≠ hash(b,a)', async () => {
      const hash_ab = await hasher.hashPair(111n, 222n);
      const hash_ba = await hasher.hashPair(222n, 111n);
      expect(hash_ab).not.toBe(hash_ba);
    });

    it('should hash single value', async () => {
      const hash = await hasher.hashSingle(42n);
      expect(typeof hash).toBe('bigint');
      expect(hash).toBeGreaterThan(0n);
    });

    it('should hash 4 values', async () => {
      const hash = await hasher.hash4(1n, 2n, 3n, 4n);
      expect(typeof hash).toBe('bigint');
      expect(hash).toBeGreaterThan(0n);
    });

    it('should hash strings', async () => {
      const hash = await hasher.hashString('hello world');
      expect(typeof hash).toBe('bigint');
      expect(hash).toBeGreaterThan(0n);
    });

    it('should handle empty string', async () => {
      const hash = await hasher.hashString('');
      expect(typeof hash).toBe('bigint');
    });

    it('should handle long strings (> 31 bytes)', async () => {
      const longString = 'a'.repeat(100);
      const hash = await hasher.hashString(longString);
      expect(typeof hash).toBe('bigint');
      expect(hash).toBeGreaterThan(0n);
    });
  });

  describe('Batch Operations', () => {
    it('should hash pairs in batch', async () => {
      const pairs: Array<readonly [bigint, bigint]> = [
        [1n, 2n],
        [3n, 4n],
        [5n, 6n],
        [7n, 8n],
      ];

      const results = await hasher.hashPairsBatch(pairs);

      expect(results).toHaveLength(4);
      results.forEach((hash) => {
        expect(typeof hash).toBe('bigint');
        expect(hash).toBeGreaterThan(0n);
      });

      // Verify determinism
      const results2 = await hasher.hashPairsBatch(pairs);
      expect(results).toEqual(results2);
    });

    it('should hash strings in batch', async () => {
      const strings = ['apple', 'banana', 'cherry', 'date'];
      const results = await hasher.hashStringsBatch(strings);

      expect(results).toHaveLength(4);
      results.forEach((hash) => {
        expect(typeof hash).toBe('bigint');
      });
    });

    it('should respect batch size', async () => {
      const pairs: Array<readonly [bigint, bigint]> = Array(100)
        .fill(null)
        .map((_, i) => [BigInt(i), BigInt(i + 1)] as const);

      // Small batch size should still work correctly
      const results = await hasher.hashPairsBatch(pairs, 10);
      expect(results).toHaveLength(100);
    });
  });
});

describe('ShadowAtlasMerkleTreeV2', () => {
  describe('Tree Construction', () => {
    it('should create tree from addresses', async () => {
      const addresses = ['addr1', 'addr2', 'addr3', 'addr4'];
      const tree = await createShadowAtlasMerkleTree(addresses);

      expect(tree.getRoot()).toBeDefined();
      expect(typeof tree.getRoot()).toBe('bigint');
      expect(tree.getAddressCount()).toBe(4);
    }, 30000);

    it('should have correct depth and capacity', async () => {
      const addresses = ['a', 'b', 'c'];
      const tree = await createShadowAtlasMerkleTree(addresses);

      expect(tree.getDepth()).toBe(12);
      expect(tree.getCapacity()).toBe(4096);
    });

    it('should produce deterministic root', async () => {
      const addresses = ['x', 'y', 'z'];

      const tree1 = await createShadowAtlasMerkleTree(addresses);
      const tree2 = await createShadowAtlasMerkleTree(addresses);

      expect(tree1.getRoot()).toBe(tree2.getRoot());
    });

    it('should reject duplicate addresses', async () => {
      const addresses = ['same', 'same', 'different'];

      await expect(createShadowAtlasMerkleTree(addresses)).rejects.toThrow(
        /Duplicate addresses detected/
      );
    });

    it('should reject when exceeding capacity', async () => {
      const addresses = Array(4097)
        .fill(null)
        .map((_, i) => `addr${i}`);

      await expect(createShadowAtlasMerkleTree(addresses)).rejects.toThrow(
        /capacity exceeded/
      );
    });

    it('should support custom depth', async () => {
      const addresses = ['a', 'b'];
      const tree = await createShadowAtlasMerkleTree(addresses, { depth: 4 });

      expect(tree.getDepth()).toBe(4);
      expect(tree.getCapacity()).toBe(16);
    });

    it('should handle empty address list', async () => {
      const tree = await createShadowAtlasMerkleTree([]);

      expect(tree.getRoot()).toBeDefined();
      expect(tree.getAddressCount()).toBe(0);
    });
  });

  describe('Proof Generation', () => {
    let tree: ShadowAtlasMerkleTreeV2;
    const addresses = ['alice', 'bob', 'charlie', 'dave'];

    beforeAll(async () => {
      tree = await createShadowAtlasMerkleTree(addresses);
    }, 30000);

    it('should generate valid proof for existing address', async () => {
      const proof = await tree.generateProof('alice');

      expect(proof.root).toBe(tree.getRoot());
      expect(proof.leaf).toBeDefined();
      expect(proof.siblings).toHaveLength(12); // tree depth
      expect(proof.pathIndices).toHaveLength(12);
    });

    it('should throw for non-existent address', async () => {
      await expect(tree.generateProof('unknown')).rejects.toThrow(
        /Address not in tree/
      );
    });

    it('should generate different proofs for different addresses', async () => {
      const proofAlice = await tree.generateProof('alice');
      const proofBob = await tree.generateProof('bob');

      expect(proofAlice.leaf).not.toBe(proofBob.leaf);
    });
  });

  describe('Proof Verification', () => {
    let tree: ShadowAtlasMerkleTreeV2;
    const addresses = ['alpha', 'beta', 'gamma'];

    beforeAll(async () => {
      tree = await createShadowAtlasMerkleTree(addresses);
    }, 30000);

    it('should verify valid proof', async () => {
      const proof = await tree.generateProof('alpha');
      const isValid = await tree.verifyProof(proof, 'alpha');
      expect(isValid).toBe(true);
    });

    it('should reject proof with wrong address', async () => {
      const proof = await tree.generateProof('alpha');
      const isValid = await tree.verifyProof(proof, 'beta');
      expect(isValid).toBe(false);
    });

    it('should verify proofs for all addresses', async () => {
      for (const addr of addresses) {
        const proof = await tree.generateProof(addr);
        const isValid = await tree.verifyProof(proof, addr);
        expect(isValid).toBe(true);
      }
    });
  });

  describe('hasAddress', () => {
    it('should return true for existing addresses', async () => {
      const addresses = ['one', 'two', 'three'];
      const tree = await createShadowAtlasMerkleTree(addresses);

      expect(tree.hasAddress('one')).toBe(true);
      expect(tree.hasAddress('two')).toBe(true);
      expect(tree.hasAddress('three')).toBe(true);
    });

    it('should return false for non-existing addresses', async () => {
      const addresses = ['one', 'two', 'three'];
      const tree = await createShadowAtlasMerkleTree(addresses);

      expect(tree.hasAddress('four')).toBe(false);
      expect(tree.hasAddress('PADDING')).toBe(false);
    });
  });
});

describe('Multi-Layer Leaf Hashing', () => {
  it('should compute leaf hash with all components', async () => {
    const input: MerkleLeafInput = {
      id: 'CD-01',
      boundaryType: 'congressional-district',
      geometryHash: 12345n,
      authority: AUTHORITY_LEVELS.FEDERAL_MANDATE,
    };

    const hash = await computeLeafHash(input);
    expect(typeof hash).toBe('bigint');
    expect(hash).toBeGreaterThan(0n);
  }, 30000);

  it('should produce different hashes for different boundary types', async () => {
    const cdInput: MerkleLeafInput = {
      id: '01',
      boundaryType: 'congressional-district',
      geometryHash: 100n,
      authority: AUTHORITY_LEVELS.FEDERAL_MANDATE,
    };

    const slduInput: MerkleLeafInput = {
      id: '01',
      boundaryType: 'state-legislative-upper',
      geometryHash: 100n,
      authority: AUTHORITY_LEVELS.FEDERAL_MANDATE,
    };

    const hashCD = await computeLeafHash(cdInput);
    const hashSLDU = await computeLeafHash(slduInput);

    expect(hashCD).not.toBe(hashSLDU);
  });

  it('should batch compute leaf hashes', async () => {
    const inputs: MerkleLeafInput[] = [
      {
        id: 'CD-01',
        boundaryType: 'congressional-district',
        geometryHash: 1n,
        authority: 5,
      },
      {
        id: 'CD-02',
        boundaryType: 'congressional-district',
        geometryHash: 2n,
        authority: 5,
      },
      {
        id: 'SLDU-01',
        boundaryType: 'state-legislative-upper',
        geometryHash: 3n,
        authority: 5,
      },
    ];

    const hashes = await computeLeafHashesBatch(inputs);
    expect(hashes).toHaveLength(3);
    hashes.forEach((hash) => {
      expect(typeof hash).toBe('bigint');
    });
  });
});

describe('Performance', () => {
  it('should build tree with 1000 addresses efficiently', async () => {
    const addresses = Array(1000)
      .fill(null)
      .map((_, i) => `address_${i.toString().padStart(6, '0')}`);

    const start = Date.now();
    const tree = await createShadowAtlasMerkleTree(addresses);
    const elapsed = Date.now() - start;

    console.log(`Built tree with 1000 addresses in ${elapsed}ms`);

    expect(tree.getAddressCount()).toBe(1000);
    expect(tree.getRoot()).toBeDefined();

    // Should complete in reasonable time (adjust threshold as needed)
    // Note: First run may be slower due to WASM initialization
    expect(elapsed).toBeLessThan(60000); // 60 seconds max
  }, 120000);

  it('should generate proofs quickly', async () => {
    const addresses = Array(100)
      .fill(null)
      .map((_, i) => `user_${i}`);

    const tree = await createShadowAtlasMerkleTree(addresses);

    const start = Date.now();
    for (let i = 0; i < 10; i++) {
      await tree.generateProof(`user_${i}`);
    }
    const elapsed = Date.now() - start;

    console.log(`Generated 10 proofs in ${elapsed}ms`);
    expect(elapsed).toBeLessThan(5000); // 5 seconds max
  }, 60000);
});
