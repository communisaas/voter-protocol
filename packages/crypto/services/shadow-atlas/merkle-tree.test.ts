/**
 * Shadow Atlas Merkle Tree Tests
 *
 * Validates implementation against SHADOW-ATLAS-SPEC.md Section 3
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createShadowAtlasMerkleTree, type MerkleProof } from './merkle-tree';
import init from '../../circuits/pkg/voter_district_circuit.js';

// ES module path handling
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('ShadowAtlasMerkleTree', () => {
  // Initialize WASM module before running tests
  beforeAll(async () => {
    const wasmPath = join(__dirname, '../../circuits/pkg/voter_district_circuit_bg.wasm');
    const wasmBuffer = readFileSync(wasmPath);
    await init({ module_or_path: wasmBuffer });
  });
  describe('Construction', () => {
    it('should construct tree with single address', () => {
      const addresses = ['123 Main St, Anytown, USA'];
      const tree = createShadowAtlasMerkleTree(addresses);

      expect(tree.getRoot()).toBeDefined();
      expect(typeof tree.getRoot()).toBe('bigint');
    });

    it('should construct tree with multiple addresses', () => {
      const addresses = [
        '100 First St, City A',
        '200 Second St, City B',
        '300 Third St, City C'
      ];
      const tree = createShadowAtlasMerkleTree(addresses);

      expect(tree.getRoot()).toBeDefined();
    });

    it('should pad to full capacity (4,096 leaves)', () => {
      const addresses = ['Single address'];
      const tree = createShadowAtlasMerkleTree(addresses);

      const leaves = tree.getLeaves();
      expect(leaves.length).toBe(4096);
    });

    it('should reject if capacity exceeded', () => {
      const addresses = Array(4097).fill('Address');

      expect(() => {
        createShadowAtlasMerkleTree(addresses);
      }).toThrow('District capacity exceeded');
    });

    it('should produce 12 levels plus leaf layer (13 total)', () => {
      const addresses = ['Test address'];
      const tree = createShadowAtlasMerkleTree(addresses);

      // Check leaf layer (4,096 elements)
      expect(tree.getLayer(0).length).toBe(4096);

      // Check intermediate layers
      expect(tree.getLayer(1).length).toBe(2048);
      expect(tree.getLayer(6).length).toBe(64);
      expect(tree.getLayer(11).length).toBe(2);

      // Check root layer (1 element)
      expect(tree.getLayer(12).length).toBe(1);
      expect(tree.getLayer(12)[0]).toBe(tree.getRoot());
    });
  });

  describe('Proof Generation', () => {
    it('should generate valid proof for existing address', () => {
      const addresses = [
        '123 Main St',
        '456 Oak Ave',
        '789 Elm St'
      ];
      const tree = createShadowAtlasMerkleTree(addresses);

      const proof = tree.generateProof('456 Oak Ave');

      expect(proof.root).toBe(tree.getRoot());
      expect(proof.siblings.length).toBe(12); // 12 levels
      expect(proof.pathIndices.length).toBe(12);
    });

    it('should throw if address not in tree', () => {
      const addresses = ['123 Main St'];
      const tree = createShadowAtlasMerkleTree(addresses);

      expect(() => {
        tree.generateProof('999 Fake St');
      }).toThrow('Address not in tree');
    });

    it('should have path indices of 0 (left) or 1 (right)', () => {
      const addresses = ['Test address'];
      const tree = createShadowAtlasMerkleTree(addresses);

      const proof = tree.generateProof('Test address');

      for (const idx of proof.pathIndices) {
        expect([0, 1]).toContain(idx);
      }
    });

    it('should generate different proofs for different addresses', () => {
      const addresses = [
        '100 First St',
        '200 Second St',
        '300 Third St'
      ];
      const tree = createShadowAtlasMerkleTree(addresses);

      const proof1 = tree.generateProof('100 First St');
      const proof2 = tree.generateProof('200 Second St');

      // Same root
      expect(proof1.root).toBe(proof2.root);

      // Different leaves
      expect(proof1.leaf).not.toBe(proof2.leaf);

      // Different paths (at least one sibling differs)
      const siblings1 = proof1.siblings.map(s => s.toString());
      const siblings2 = proof2.siblings.map(s => s.toString());
      expect(siblings1).not.toEqual(siblings2);
    });
  });

  describe('Proof Verification', () => {
    it('should verify valid proof', () => {
      const addresses = ['123 Main St', '456 Oak Ave'];
      const tree = createShadowAtlasMerkleTree(addresses);

      const proof = tree.generateProof('123 Main St');
      const isValid = tree.verifyProof(proof, '123 Main St');

      expect(isValid).toBe(true);
    });

    it('should reject proof with wrong address', () => {
      const addresses = ['123 Main St', '456 Oak Ave'];
      const tree = createShadowAtlasMerkleTree(addresses);

      const proof = tree.generateProof('123 Main St');
      const isValid = tree.verifyProof(proof, '456 Oak Ave');

      expect(isValid).toBe(false);
    });

    it('should verify all addresses in tree', () => {
      const addresses = [
        '100 First St',
        '200 Second St',
        '300 Third St',
        '400 Fourth St'
      ];
      const tree = createShadowAtlasMerkleTree(addresses);

      for (const address of addresses) {
        const proof = tree.generateProof(address);
        const isValid = tree.verifyProof(proof, address);
        expect(isValid).toBe(true);
      }
    });

    it('should reject tampered proof (modified sibling)', () => {
      const addresses = ['Test address'];
      const tree = createShadowAtlasMerkleTree(addresses);

      const proof = tree.generateProof('Test address');

      // Tamper with proof by modifying first sibling
      const tamperedProof: MerkleProof = {
        ...proof,
        siblings: [BigInt(12345), ...proof.siblings.slice(1)]
      };

      const isValid = tree.verifyProof(tamperedProof, 'Test address');
      expect(isValid).toBe(false);
    });

    it('should reject tampered proof (flipped path index)', () => {
      const addresses = ['Test address'];
      const tree = createShadowAtlasMerkleTree(addresses);

      const proof = tree.generateProof('Test address');

      // Tamper with proof by flipping first path index
      const tamperedProof: MerkleProof = {
        ...proof,
        pathIndices: [
          proof.pathIndices[0] === 0 ? 1 : 0,
          ...proof.pathIndices.slice(1)
        ]
      };

      const isValid = tree.verifyProof(tamperedProof, 'Test address');
      expect(isValid).toBe(false);
    });
  });

  describe('Deterministic Behavior', () => {
    it('should produce same root for same input addresses', () => {
      const addresses = ['123 Main St', '456 Oak Ave'];

      const tree1 = createShadowAtlasMerkleTree(addresses);
      const tree2 = createShadowAtlasMerkleTree(addresses);

      expect(tree1.getRoot()).toBe(tree2.getRoot());
    });

    it('should produce different roots for different addresses', () => {
      const addresses1 = ['123 Main St'];
      const addresses2 = ['456 Oak Ave'];

      const tree1 = createShadowAtlasMerkleTree(addresses1);
      const tree2 = createShadowAtlasMerkleTree(addresses2);

      expect(tree1.getRoot()).not.toBe(tree2.getRoot());
    });

    it('should produce different roots if address order changes', () => {
      const addresses1 = ['A', 'B', 'C'];
      const addresses2 = ['C', 'B', 'A'];

      const tree1 = createShadowAtlasMerkleTree(addresses1);
      const tree2 = createShadowAtlasMerkleTree(addresses2);

      // Different order = different leaf layout = different root
      expect(tree1.getRoot()).not.toBe(tree2.getRoot());
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string address', () => {
      const addresses = [''];
      const tree = createShadowAtlasMerkleTree(addresses);

      const proof = tree.generateProof('');
      expect(tree.verifyProof(proof, '')).toBe(true);
    });

    it('should handle unicode addresses', () => {
      const addresses = ['北京市朝阳区', 'Москва, Россия', 'São Paulo, Brasil'];
      const tree = createShadowAtlasMerkleTree(addresses);

      for (const address of addresses) {
        const proof = tree.generateProof(address);
        expect(tree.verifyProof(proof, address)).toBe(true);
      }
    });

    it('should handle very long address strings', () => {
      const longAddress = 'A'.repeat(500); // 500 characters
      const addresses = [longAddress];
      const tree = createShadowAtlasMerkleTree(addresses);

      const proof = tree.generateProof(longAddress);
      expect(tree.verifyProof(proof, longAddress)).toBe(true);
    });

    it('should reject duplicate addresses', () => {
      const addresses = ['123 Main St', '123 Main St', '456 Oak Ave'];

      // SECURITY: Duplicates must be rejected to prevent unprovable addresses
      // (indexOf() only returns first occurrence, making subsequent duplicates unprovable)
      expect(() => {
        createShadowAtlasMerkleTree(addresses);
      }).toThrow('Duplicate addresses detected: 123 Main St');
    });

    it('should handle max capacity (4,096 addresses)', () => {
      const addresses = Array(4096)
        .fill(null)
        .map((_, i) => `Address ${i}`);

      const tree = createShadowAtlasMerkleTree(addresses);

      // Verify first and last addresses
      const proof0 = tree.generateProof('Address 0');
      expect(tree.verifyProof(proof0, 'Address 0')).toBe(true);

      const proof4095 = tree.generateProof('Address 4095');
      expect(tree.verifyProof(proof4095, 'Address 4095')).toBe(true);
    });
  });
});
