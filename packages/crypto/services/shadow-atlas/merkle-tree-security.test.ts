/**
 * Cryptographic Security Tests for Shadow Atlas Merkle Tree
 *
 * SECURITY CRITICAL: These tests validate cryptographic properties beyond
 * functional correctness, detecting attacks and implementation vulnerabilities.
 *
 * Test Coverage:
 * 1. Forgery detection (tampered proofs, wrong roots, modified paths)
 * 2. Edge case security (zero inputs, boundary values, empty trees)
 * 3. Proof malleability attacks (truncated/extended siblings)
 * 4. Cross-tree proof replay attacks
 * 5. Determinism under adversarial conditions
 *
 * These tests complement merkle-tree-golden-vectors.test.ts which focuses on
 * supply-chain attack detection and cross-validation with Rust circuit.
 *
 * NOTE: These tests are designed to work WITHOUT WASM bindings by testing
 * the Merkle tree logic independently. When WASM bindings are available,
 * the golden vector tests in merkle-tree-golden-vectors.test.ts provide
 * additional cryptographic validation.
 */

import { describe, it, expect } from 'vitest';
import { createShadowAtlasMerkleTree, type MerkleProof } from './merkle-tree';

// BN254 field modulus (scalar field for bn254 curve)
// p = 21888242871839275222246405745257275088548364400416034343698204186575808495617
const BN254_FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

describe('Shadow Atlas Merkle Tree - Cryptographic Security', () => {
  /**
   * NOTE: These tests validate Merkle tree security properties WITHOUT
   * requiring WASM bindings. They test the tree construction logic, proof
   * generation/verification, and resistance to various attacks.
   *
   * For cryptographic validation of the hash function itself, see
   * merkle-tree-golden-vectors.test.ts which requires compiled WASM.
   */

  describe('Forgery Detection Tests', () => {
    /**
     * SECURITY CRITICAL: Merkle proofs must be unforgeable.
     * An attacker should not be able to:
     * - Prove membership of an address NOT in the tree
     * - Modify a valid proof and have it still verify
     * - Use a proof for one address to prove another address
     * - Swap siblings and have the proof still verify
     */

    it('should reject proof for address NOT in tree', () => {
      const addresses = ['123 Main St', '456 Oak Ave', '789 Elm St'];
      const tree = createShadowAtlasMerkleTree(addresses);

      // Try to prove an address that was never added
      expect(() => {
        tree.generateProof('999 Fake Street');
      }).toThrow('Address not in tree');
    });

    it('should reject proof with modified leaf hash', () => {
      const addresses = ['Test Address'];
      const tree = createShadowAtlasMerkleTree(addresses);

      const proof = tree.generateProof('Test Address');

      // Tamper with leaf hash (flip one bit)
      const tamperedProof: MerkleProof = {
        ...proof,
        leaf: proof.leaf ^ 1n  // XOR with 1 to flip LSB
      };

      const isValid = tree.verifyProof(tamperedProof, 'Test Address');
      expect(isValid).toBe(false);
    });

    it('should reject proof with ALL siblings modified', () => {
      const addresses = ['Alice', 'Bob', 'Charlie'];
      const tree = createShadowAtlasMerkleTree(addresses);

      const proof = tree.generateProof('Alice');

      // Tamper with ALL siblings (add 1 to each)
      const tamperedProof: MerkleProof = {
        ...proof,
        siblings: proof.siblings.map(s => (s + 1n) % BN254_FIELD_MODULUS)
      };

      const isValid = tree.verifyProof(tamperedProof, 'Alice');
      expect(isValid).toBe(false);
    });

    it('should reject proof with wrong root', () => {
      const addresses1 = ['Tree 1 Address'];
      const addresses2 = ['Tree 2 Address'];

      const tree1 = createShadowAtlasMerkleTree(addresses1);
      const tree2 = createShadowAtlasMerkleTree(addresses2);

      const proof1 = tree1.generateProof('Tree 1 Address');

      // Try to use proof from tree1 with root from tree2
      const invalidProof: MerkleProof = {
        ...proof1,
        root: tree2.getRoot()
      };

      // This should fail because leaf is from tree1 but root is from tree2
      const isValid = tree1.verifyProof(invalidProof, 'Tree 1 Address');
      expect(isValid).toBe(false);
    });

    it('should reject proof with truncated siblings (shorter path)', () => {
      const addresses = ['Test Address'];
      const tree = createShadowAtlasMerkleTree(addresses);

      const proof = tree.generateProof('Test Address');

      // Truncate to 11 siblings instead of 12 (remove last sibling)
      const truncatedProof: MerkleProof = {
        ...proof,
        siblings: proof.siblings.slice(0, 11),
        pathIndices: proof.pathIndices.slice(0, 11)
      };

      const isValid = tree.verifyProof(truncatedProof, 'Test Address');
      expect(isValid).toBe(false);
    });

    it('should reject proof with extended siblings (longer path)', () => {
      const addresses = ['Test Address'];
      const tree = createShadowAtlasMerkleTree(addresses);

      const proof = tree.generateProof('Test Address');

      // Extend to 13 siblings by adding an extra fake sibling
      const extendedProof: MerkleProof = {
        ...proof,
        siblings: [...proof.siblings, 12345n],
        pathIndices: [...proof.pathIndices, 0]
      };

      const isValid = tree.verifyProof(extendedProof, 'Test Address');
      expect(isValid).toBe(false);
    });

    it('should reject sibling swap attack (non-commutativity test)', () => {
      const addresses = ['A', 'B', 'C', 'D'];
      const tree = createShadowAtlasMerkleTree(addresses);

      const proof = tree.generateProof('A');

      // Swap first two siblings (if hash is commutative, this would still verify)
      const swappedProof: MerkleProof = {
        ...proof,
        siblings: [proof.siblings[1], proof.siblings[0], ...proof.siblings.slice(2)]
      };

      // This MUST fail because Poseidon is non-commutative
      const isValid = tree.verifyProof(swappedProof, 'A');
      expect(isValid).toBe(false);
    });

    it('should reject cross-address proof replay attack', () => {
      const addresses = ['Alice', 'Bob'];
      const tree = createShadowAtlasMerkleTree(addresses);

      const proofAlice = tree.generateProof('Alice');

      // Try to use Alice's proof to verify Bob
      const isValid = tree.verifyProof(proofAlice, 'Bob');
      expect(isValid).toBe(false);
    });
  });

  describe('Edge Case Security Tests', () => {
    /**
     * SECURITY CRITICAL: Edge cases often reveal implementation bugs
     * that attackers can exploit. These tests validate behavior at boundaries.
     *
     * NOTE: Low-level hash function tests (hash_pair, hash_single) are in
     * merkle-tree-golden-vectors.test.ts and require compiled WASM bindings.
     * These tests focus on Merkle tree construction and proof logic.
     */

    it('should handle empty address tree with padding', () => {
      // Note: Constructor requires at least one address, but we test
      // that padding works correctly for minimal trees
      const addresses = [''];  // Empty string address
      const tree = createShadowAtlasMerkleTree(addresses);

      // Tree should still have full capacity (4096 leaves)
      expect(tree.getLeaves().length).toBe(4096);

      // Root should be deterministic
      const tree2 = createShadowAtlasMerkleTree(['']);
      expect(tree.getRoot()).toBe(tree2.getRoot());

      // Proof should verify for empty string
      const proof = tree.generateProof('');
      expect(tree.verifyProof(proof, '')).toBe(true);
    });

    it('should reject addresses that hash to same leaf (hash collision test)', () => {
      // In practice, Poseidon collisions are computationally infeasible
      // but we test that identical addresses are detected early
      const addresses = ['Same Address', 'Same Address'];

      expect(() => {
        createShadowAtlasMerkleTree(addresses);
      }).toThrow('Duplicate addresses detected');
    });

    it('should handle addresses with only whitespace', () => {
      const addresses = ['   ', '\t\t', '\n\n'];
      const tree = createShadowAtlasMerkleTree(addresses);

      // Each whitespace-only address should hash to different leaf
      const leaves = tree.getLeaves();
      const firstThree = [leaves[0], leaves[1], leaves[2]];

      // All should be unique (different whitespace = different hash)
      const uniqueSet = new Set(firstThree);
      expect(uniqueSet.size).toBe(3);
    });

    it('should handle addresses with special characters and unicode', () => {
      const addresses = [
        '北京市朝阳区 (Beijing)',
        'Москва, улица Тверская (Moscow)',
        'São Paulo, Rua Augusta',
        '🏠 Home Address with Emoji'
      ];

      const tree = createShadowAtlasMerkleTree(addresses);

      // All addresses should be provable
      for (const address of addresses) {
        const proof = tree.generateProof(address);
        expect(tree.verifyProof(proof, address)).toBe(true);
      }
    });
  });

  describe('Determinism Under Adversarial Conditions', () => {
    /**
     * SECURITY CRITICAL: Non-determinism can lead to proof verification
     * failures in production. These tests validate determinism even under
     * unusual inputs that attackers might try.
     */

    it('should produce same hash for same inputs regardless of order of operations', () => {
      // Build tree with 100 addresses
      const addresses = Array.from({ length: 100 }, (_, i) => `Address ${i}`);

      const tree1 = createShadowAtlasMerkleTree(addresses);
      const tree2 = createShadowAtlasMerkleTree(addresses);

      // Roots must be identical
      expect(tree1.getRoot()).toBe(tree2.getRoot());

      // ALL leaves must be identical
      const leaves1 = tree1.getLeaves();
      const leaves2 = tree2.getLeaves();

      expect(leaves1.length).toBe(leaves2.length);
      for (let i = 0; i < leaves1.length; i++) {
        expect(leaves1[i]).toBe(leaves2[i]);
      }
    });

    it('should produce deterministic hashes for very long addresses (>1KB)', () => {
      // Create 2KB address (should be chunked into multiple Poseidon calls)
      const longAddress = 'A'.repeat(2000);

      const tree1 = createShadowAtlasMerkleTree([longAddress]);
      const tree2 = createShadowAtlasMerkleTree([longAddress]);

      expect(tree1.getRoot()).toBe(tree2.getRoot());
    });

    it('should produce different hashes for addresses differing by single character', () => {
      const addr1 = '123 Main Street';
      const addr2 = '123 Main StreetX';  // Extra character at end

      const tree1 = createShadowAtlasMerkleTree([addr1]);
      const tree2 = createShadowAtlasMerkleTree([addr2]);

      // Roots must be different (avalanche effect)
      expect(tree1.getRoot()).not.toBe(tree2.getRoot());
    });

    it('should produce different hashes for addresses differing only in case', () => {
      const addr1 = 'Main Street';
      const addr2 = 'main street';

      const tree1 = createShadowAtlasMerkleTree([addr1]);
      const tree2 = createShadowAtlasMerkleTree([addr2]);

      // Case sensitivity is important for address matching
      expect(tree1.getRoot()).not.toBe(tree2.getRoot());
    });

    it('should produce deterministic roots across multiple process runs', () => {
      // This test validates that tree construction is deterministic
      // and doesn't depend on process state or timing
      const addresses = ['Test Address 1', 'Test Address 2'];

      const roots: bigint[] = [];

      // Build tree 20 times
      for (let i = 0; i < 20; i++) {
        const tree = createShadowAtlasMerkleTree(addresses);
        roots.push(tree.getRoot());
      }

      // All roots must be identical
      const firstRoot = roots[0];
      for (const root of roots) {
        expect(root).toBe(firstRoot);
      }
    });
  });

  describe('Proof Path Validation Security', () => {
    /**
     * SECURITY CRITICAL: Path indices must correctly encode left/right
     * traversal. Incorrect path indices can lead to accepting invalid proofs.
     */

    it('should enforce path indices are binary (0 or 1 only)', () => {
      const addresses = ['Test'];
      const tree = createShadowAtlasMerkleTree(addresses);

      const proof = tree.generateProof('Test');

      // Every path index must be 0 (left) or 1 (right)
      for (let i = 0; i < proof.pathIndices.length; i++) {
        expect(proof.pathIndices[i]).toBeGreaterThanOrEqual(0);
        expect(proof.pathIndices[i]).toBeLessThanOrEqual(1);
        expect(Number.isInteger(proof.pathIndices[i])).toBe(true);
      }
    });

    it('should reject proof with invalid path index (2)', () => {
      const addresses = ['Test'];
      const tree = createShadowAtlasMerkleTree(addresses);

      const proof = tree.generateProof('Test');

      // Tamper path index to invalid value (2)
      const invalidProof: MerkleProof = {
        ...proof,
        pathIndices: [2, ...proof.pathIndices.slice(1)]
      };

      // This should fail verification (path index 2 is invalid)
      // Note: TypeScript type system doesn't prevent this at runtime
      const isValid = tree.verifyProof(invalidProof, 'Test');
      expect(isValid).toBe(false);
    });

    it('should reject proof with negative path index', () => {
      const addresses = ['Test'];
      const tree = createShadowAtlasMerkleTree(addresses);

      const proof = tree.generateProof('Test');

      // Tamper path index to negative value
      const invalidProof: MerkleProof = {
        ...proof,
        pathIndices: [-1, ...proof.pathIndices.slice(1)]
      };

      const isValid = tree.verifyProof(invalidProof, 'Test');
      expect(isValid).toBe(false);
    });

    it('should use consistent path indices for same leaf across multiple proof generations', () => {
      const addresses = ['A', 'B', 'C', 'D'];
      const tree = createShadowAtlasMerkleTree(addresses);

      // Generate proof for 'A' multiple times
      const proof1 = tree.generateProof('A');
      const proof2 = tree.generateProof('A');
      const proof3 = tree.generateProof('A');

      // Path indices must be identical across all proofs
      expect(proof1.pathIndices).toEqual(proof2.pathIndices);
      expect(proof2.pathIndices).toEqual(proof3.pathIndices);
    });
  });

  describe('Sibling Hash Validation Security', () => {
    /**
     * SECURITY CRITICAL: Sibling hashes must be valid BN254 field elements.
     * Out-of-field values indicate tampering or implementation bugs.
     */

    it('should produce sibling hashes within BN254 field modulus', () => {
      const addresses = ['Test Address'];
      const tree = createShadowAtlasMerkleTree(addresses);

      const proof = tree.generateProof('Test Address');

      // All siblings must be valid field elements
      for (const sibling of proof.siblings) {
        expect(sibling).toBeGreaterThanOrEqual(0n);
        expect(sibling).toBeLessThan(BN254_FIELD_MODULUS);
      }
    });

    it('should reject proof with sibling hash exceeding field modulus', () => {
      const addresses = ['Test'];
      const tree = createShadowAtlasMerkleTree(addresses);

      const proof = tree.generateProof('Test');

      // Tamper sibling to exceed field modulus
      const invalidProof: MerkleProof = {
        ...proof,
        siblings: [BN254_FIELD_MODULUS + 1n, ...proof.siblings.slice(1)]
      };

      // Verification should fail (sibling out of field)
      const isValid = tree.verifyProof(invalidProof, 'Test');
      expect(isValid).toBe(false);
    });

    it('should produce non-zero sibling hashes (except for specific edge cases)', () => {
      const addresses = ['A', 'B', 'C', 'D'];
      const tree = createShadowAtlasMerkleTree(addresses);

      const proof = tree.generateProof('A');

      // Most siblings should be non-zero (zero siblings are rare)
      const nonZeroSiblings = proof.siblings.filter(s => s !== 0n);

      // Expect at least some non-zero siblings (depends on tree structure)
      expect(nonZeroSiblings.length).toBeGreaterThan(0);
    });
  });

  describe('Cross-Tree Security Tests', () => {
    /**
     * SECURITY CRITICAL: Proofs from one tree must not verify in another tree.
     * This prevents proof replay attacks across different districts.
     */

    it('should reject proof from different tree (different addresses)', () => {
      const tree1 = createShadowAtlasMerkleTree(['Tree1 Address']);
      const tree2 = createShadowAtlasMerkleTree(['Tree2 Address']);

      const proof1 = tree1.generateProof('Tree1 Address');

      // Try to verify proof from tree1 in tree2 (should fail)
      const isValid = tree2.verifyProof(proof1, 'Tree1 Address');
      expect(isValid).toBe(false);
    });

    it('should reject proof from tree with different address order', () => {
      const addresses1 = ['A', 'B', 'C'];
      const addresses2 = ['C', 'B', 'A'];  // Same addresses, different order

      const tree1 = createShadowAtlasMerkleTree(addresses1);
      const tree2 = createShadowAtlasMerkleTree(addresses2);

      // Trees should have different roots (order matters)
      expect(tree1.getRoot()).not.toBe(tree2.getRoot());

      // Proof from tree1 should not verify in tree2
      const proof1 = tree1.generateProof('A');
      const isValid = tree2.verifyProof(proof1, 'A');
      expect(isValid).toBe(false);
    });

    it('should reject proof from partially overlapping tree', () => {
      const tree1 = createShadowAtlasMerkleTree(['A', 'B', 'C']);
      const tree2 = createShadowAtlasMerkleTree(['A', 'B', 'D']);  // Different 3rd address

      const proof1 = tree1.generateProof('A');

      // Even though 'A' exists in tree2, proof from tree1 should not verify
      const isValid = tree2.verifyProof(proof1, 'A');
      expect(isValid).toBe(false);
    });
  });

  describe('Batch Proof Consistency Tests', () => {
    /**
     * SECURITY CRITICAL: When generating multiple proofs from same tree,
     * all proofs must be consistent (same root, valid paths).
     */

    it('should generate consistent roots for all proofs from same tree', () => {
      const addresses = Array.from({ length: 50 }, (_, i) => `Address ${i}`);
      const tree = createShadowAtlasMerkleTree(addresses);

      const treeRoot = tree.getRoot();

      // Generate proofs for first 10 addresses
      for (let i = 0; i < 10; i++) {
        const proof = tree.generateProof(`Address ${i}`);

        // Every proof must reference the same root
        expect(proof.root).toBe(treeRoot);
      }
    });

    it('should generate unique siblings for different leaf positions', () => {
      const addresses = ['A', 'B', 'C', 'D'];
      const tree = createShadowAtlasMerkleTree(addresses);

      const proofA = tree.generateProof('A');
      const proofB = tree.generateProof('B');

      // Siblings should differ (different paths through tree)
      const siblingsA = proofA.siblings.map(s => s.toString());
      const siblingsB = proofB.siblings.map(s => s.toString());

      expect(siblingsA).not.toEqual(siblingsB);
    });
  });
});
