/**
 * Golden Vector Tests for Shadow Atlas Merkle Tree
 *
 * SECURITY CRITICAL: These tests cross-validate TypeScript implementation
 * against Rust circuit golden vectors, detecting supply-chain attacks and
 * implementation divergence.
 *
 * Test Strategy:
 * 1. Golden vectors from Rust Poseidon tests (GOLDEN_HASH_PAIR_*, GOLDEN_HASH_SINGLE_*)
 * 2. Cross-validate TypeScript WASM calls produce identical outputs
 * 3. Validate Merkle tree construction matches circuit expectations
 *
 * Supply-Chain Attack Detection:
 * - If WASM bindings are compromised, these tests fail
 * - If Rust Poseidon constants change, these tests fail
 * - If TypeScript Merkle logic diverges, these tests fail
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import init from '../../circuits/pkg/voter_district_circuit.js';
import { createShadowAtlasMerkleTree } from './merkle-tree';
import { hash_pair, hash_single } from '../../circuits/pkg';

// ES module path handling
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Golden vectors from circuits/src/poseidon_hash.rs tests
 * Generated: 2025-10-24
 * Implementation: Axiom halo2-base v0.4.1 (commit 4dc5c4833f16b3f3686697856fd8e285dc47d14f)
 * Parameters: T=3, RATE=2, R_F=8, R_P=57 (Axiom OptimizedPoseidonSpec)
 *
 * SECURITY: These vectors are HARDCODED from audited implementation.
 * If these tests fail, it indicates:
 * 1. WASM bindings changed (requires review)
 * 2. Rust Poseidon constants tampered with (SECURITY BREACH)
 * 3. halo2-base dependency updated (requires new golden vectors)
 */

// Golden vectors: hash_pair(left, right)
const GOLDEN_HASH_PAIR_1_2 = 0x305df2f9f9f1c0b591427aa9fd8ff8b8b8ad8a16953065fca066cb6a69deff53n;
const GOLDEN_HASH_PAIR_0_0 = 0x2b2ceb8eb042a119d745d0d54ba961a45e20a1b94cf2195b11a7076780eeb04fn;
const GOLDEN_HASH_PAIR_12345_67890 = 0x1a52400b0566a6d2eb81fcf923da131e3f0db95e6e618ed4041225c78530a49an;
const GOLDEN_HASH_PAIR_111_222 = 0x17c68f6c89627ea240c19add1d71dd859cdb9e7919eef7026d68cec1a35db045n;
const GOLDEN_HASH_PAIR_222_111 = 0x22389408454ff1238e47d46a0b244e6df76543741970fd801968f59cbef6138bn;

// Golden vectors: hash_single(value)
const GOLDEN_HASH_SINGLE_0 = 0x0ac6c5f29f5187473a70dfde3329ef18f01a4d84edb01e6c21813f629a6b5f50n;
const GOLDEN_HASH_SINGLE_42 = 0x2afd87ed06c84a96cf99b91273f3afbe9ad381da034d14ec98a9735ee6adf6e4n;
const GOLDEN_HASH_SINGLE_12345 = 0x090a329435cce4d6f7bb31a1ef06995f7a8f0a001a3f07ea02dbf90e4a9b1332n;

describe('Shadow Atlas Merkle Tree - Golden Vectors', () => {
  // Initialize WASM before any tests run
  beforeAll(async () => {
    const wasmPath = join(__dirname, '../../circuits/pkg/voter_district_circuit_bg.wasm');
    const wasmBuffer = readFileSync(wasmPath);
    await init({ module_or_path: wasmBuffer });
    console.log('✅ WASM initialized for golden vector tests');
  });

  describe('Poseidon Hash Golden Vectors (Rust Circuit Cross-Validation)', () => {

    it('should match golden vector: hash_pair(1, 2)', () => {
      const left = '0x' + (1n).toString(16).padStart(64, '0');
      const right = '0x' + (2n).toString(16).padStart(64, '0');

      const hash = hash_pair(left, right);
      const hashBigInt = BigInt(hash);

      expect(hashBigInt).toBe(GOLDEN_HASH_PAIR_1_2);
    });

    it('should match golden vector: hash_pair(0, 0)', () => {
      const left = '0x' + (0n).toString(16).padStart(64, '0');
      const right = '0x' + (0n).toString(16).padStart(64, '0');

      const hash = hash_pair(left, right);
      const hashBigInt = BigInt(hash);

      expect(hashBigInt).toBe(GOLDEN_HASH_PAIR_0_0);
    });

    it('should match golden vector: hash_pair(12345, 67890)', () => {
      const left = '0x' + (12345n).toString(16).padStart(64, '0');
      const right = '0x' + (67890n).toString(16).padStart(64, '0');

      const hash = hash_pair(left, right);
      const hashBigInt = BigInt(hash);

      expect(hashBigInt).toBe(GOLDEN_HASH_PAIR_12345_67890);
    });

    it('should verify non-commutativity: hash_pair(111, 222) ≠ hash_pair(222, 111)', () => {
      const hash_ab_hex = hash_pair(
        '0x' + (111n).toString(16).padStart(64, '0'),
        '0x' + (222n).toString(16).padStart(64, '0')
      );
      const hash_ba_hex = hash_pair(
        '0x' + (222n).toString(16).padStart(64, '0'),
        '0x' + (111n).toString(16).padStart(64, '0')
      );

      const hash_ab = BigInt(hash_ab_hex);
      const hash_ba = BigInt(hash_ba_hex);

      // Verify golden vectors
      expect(hash_ab).toBe(GOLDEN_HASH_PAIR_111_222);
      expect(hash_ba).toBe(GOLDEN_HASH_PAIR_222_111);

      // Verify non-commutativity (SECURITY CRITICAL for Merkle trees)
      expect(hash_ab).not.toBe(hash_ba);
    });

    it('should match golden vector: hash_single(0)', () => {
      const value = '0x' + (0n).toString(16).padStart(64, '0');
      const hash = hash_single(value);
      const hashBigInt = BigInt(hash);

      expect(hashBigInt).toBe(GOLDEN_HASH_SINGLE_0);
    });

    it('should match golden vector: hash_single(42)', () => {
      const value = '0x' + (42n).toString(16).padStart(64, '0');
      const hash = hash_single(value);
      const hashBigInt = BigInt(hash);

      expect(hashBigInt).toBe(GOLDEN_HASH_SINGLE_42);
    });

    it('should match golden vector: hash_single(12345)', () => {
      const value = '0x' + (12345n).toString(16).padStart(64, '0');
      const hash = hash_single(value);
      const hashBigInt = BigInt(hash);

      expect(hashBigInt).toBe(GOLDEN_HASH_SINGLE_12345);
    });
  });

  describe('Merkle Tree Determinism (Circuit Compatibility)', () => {
    /**
     * SECURITY CRITICAL: Merkle tree construction must be deterministic.
     * Same inputs must produce same outputs ALWAYS, or ZK proofs will fail.
     *
     * These tests validate:
     * - Address hashing is deterministic
     * - Tree construction is deterministic
     * - Padding is deterministic
     * - Merkle roots match between runs
     */

    it('should produce deterministic roots for same addresses', () => {
      const addresses = [
        '123 Main St, Springfield, IL',
        '456 Oak Ave, Portland, OR',
        '789 Pine Rd, Austin, TX'
      ];

      const tree1 = createShadowAtlasMerkleTree(addresses);
      const tree2 = createShadowAtlasMerkleTree(addresses);

      expect(tree1.getRoot()).toBe(tree2.getRoot());
    });

    it('should produce different roots for different address orders', () => {
      const addresses1 = ['A', 'B', 'C'];
      const addresses2 = ['C', 'B', 'A'];

      const tree1 = createShadowAtlasMerkleTree(addresses1);
      const tree2 = createShadowAtlasMerkleTree(addresses2);

      // Merkle trees are order-dependent (leaf position matters)
      expect(tree1.getRoot()).not.toBe(tree2.getRoot());
    });

    it('should produce consistent roots across multiple constructions', () => {
      const addresses = ['Test Address 1', 'Test Address 2'];
      const roots: bigint[] = [];

      // Build tree 10 times
      for (let i = 0; i < 10; i++) {
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

  describe('Merkle Tree Structure Validation', () => {
    /**
     * Validate Merkle tree structure matches circuit expectations:
     * - 12 levels (depth)
     * - 4,096 leaf capacity
     * - Proper padding
     * - Correct layer sizes
     */

    it('should have exactly 13 layers (leaves + 12 internal levels + root)', () => {
      const addresses = ['Single Address'];
      const tree = createShadowAtlasMerkleTree(addresses);

      // Layer 0 = leaves (4096)
      // Layer 1 = 2048 nodes
      // Layer 2 = 1024 nodes
      // ...
      // Layer 12 = 1 node (root)
      expect(tree.getLayer(0).length).toBe(4096);
      expect(tree.getLayer(1).length).toBe(2048);
      expect(tree.getLayer(2).length).toBe(1024);
      expect(tree.getLayer(3).length).toBe(512);
      expect(tree.getLayer(4).length).toBe(256);
      expect(tree.getLayer(5).length).toBe(128);
      expect(tree.getLayer(6).length).toBe(64);
      expect(tree.getLayer(7).length).toBe(32);
      expect(tree.getLayer(8).length).toBe(16);
      expect(tree.getLayer(9).length).toBe(8);
      expect(tree.getLayer(10).length).toBe(4);
      expect(tree.getLayer(11).length).toBe(2);
      expect(tree.getLayer(12).length).toBe(1);
    });

    it('should pad to full capacity (4,096 leaves)', () => {
      const addresses = ['A', 'B', 'C']; // Only 3 addresses
      const tree = createShadowAtlasMerkleTree(addresses);

      // Should pad to 4,096 leaves
      expect(tree.getLeaves().length).toBe(4096);
    });

    it('should reject capacity overflow (>4,096 addresses)', () => {
      const addresses = Array.from({ length: 4097 }, (_, i) => `Address ${i}`);

      expect(() => createShadowAtlasMerkleTree(addresses)).toThrow(
        'District capacity exceeded'
      );
    });

    it('should accept maximum capacity (4,096 addresses)', () => {
      const addresses = Array.from({ length: 4096 }, (_, i) => `Address ${i}`);

      expect(() => createShadowAtlasMerkleTree(addresses)).not.toThrow();
    });
  });

  describe('Merkle Proof Generation (Circuit Input Validation)', () => {
    /**
     * SECURITY CRITICAL: Proofs generated by TypeScript must be verifiable
     * by Rust circuit. Proof structure must match circuit expectations exactly.
     */

    it('should generate proof with 12 siblings (depth = 12)', () => {
      const addresses = ['A', 'B', 'C'];
      const tree = createShadowAtlasMerkleTree(addresses);

      const proof = tree.generateProof('A');

      // Single-tier tree has 12 levels → 12 siblings
      expect(proof.siblings.length).toBe(12);
      expect(proof.pathIndices.length).toBe(12);
    });

    it('should generate proof with path indices in {0, 1}', () => {
      const addresses = ['Test Address'];
      const tree = createShadowAtlasMerkleTree(addresses);

      const proof = tree.generateProof('Test Address');

      // Path indices must be 0 (left) or 1 (right)
      for (const index of proof.pathIndices) {
        expect([0, 1]).toContain(index);
      }
    });

    it('should verify generated proofs (TypeScript-side)', () => {
      const addresses = ['Alice', 'Bob', 'Charlie'];
      const tree = createShadowAtlasMerkleTree(addresses);

      for (const address of addresses) {
        const proof = tree.generateProof(address);
        const isValid = tree.verifyProof(proof, address);

        expect(isValid).toBe(true);
      }
    });

    it('should reject invalid proofs (tampered siblings)', () => {
      const addresses = ['A', 'B'];
      const tree = createShadowAtlasMerkleTree(addresses);

      const proof = tree.generateProof('A');

      // Tamper with first sibling
      const tamperedProof = {
        ...proof,
        siblings: [proof.siblings[0] + 1n, ...proof.siblings.slice(1)]
      };

      const isValid = tree.verifyProof(tamperedProof, 'A');
      expect(isValid).toBe(false);
    });

    it('should reject invalid proofs (flipped path indices)', () => {
      const addresses = ['X', 'Y'];
      const tree = createShadowAtlasMerkleTree(addresses);

      const proof = tree.generateProof('X');

      // Flip first path index
      const tamperedProof = {
        ...proof,
        pathIndices: [proof.pathIndices[0] === 0 ? 1 : 0, ...proof.pathIndices.slice(1)]
      };

      const isValid = tree.verifyProof(tamperedProof, 'X');
      expect(isValid).toBe(false);
    });
  });

  describe('Supply-Chain Attack Detection', () => {
    /**
     * SECURITY CRITICAL: Detect if WASM bindings are compromised.
     *
     * Attack scenarios:
     * 1. Malicious npm package replaces WASM binary
     * 2. Rust circuit constants tampered with
     * 3. Build process compromised (inject backdoored WASM)
     *
     * Detection strategy:
     * - Golden vectors from audited Rust implementation (hardcoded)
     * - If outputs diverge → WASM bindings compromised
     * - If these tests pass → WASM matches audited circuit
     */

    it('SECURITY: hash_pair() must match Axiom halo2_base golden vectors', () => {
      // Test multiple golden vectors (not just one)
      const tests = [
        { left: 1n, right: 2n, expected: GOLDEN_HASH_PAIR_1_2 },
        { left: 0n, right: 0n, expected: GOLDEN_HASH_PAIR_0_0 },
        { left: 12345n, right: 67890n, expected: GOLDEN_HASH_PAIR_12345_67890 },
        { left: 111n, right: 222n, expected: GOLDEN_HASH_PAIR_111_222 },
        { left: 222n, right: 111n, expected: GOLDEN_HASH_PAIR_222_111 }
      ];

      for (const test of tests) {
        const leftHex = '0x' + test.left.toString(16).padStart(64, '0');
        const rightHex = '0x' + test.right.toString(16).padStart(64, '0');
        const hash = BigInt(hash_pair(leftHex, rightHex));

        if (hash !== test.expected) {
          throw new Error(
            `🚨 SUPPLY-CHAIN ATTACK DETECTED 🚨\n` +
            `hash_pair(${test.left}, ${test.right}) mismatch!\n` +
            `Expected (Axiom): ${test.expected.toString(16)}\n` +
            `Got (WASM):       ${hash.toString(16)}\n` +
            `\n` +
            `Possible causes:\n` +
            `1. WASM binary replaced with malicious version\n` +
            `2. Rust circuit constants tampered with\n` +
            `3. Build process compromised\n` +
            `\n` +
            `ACTION REQUIRED: Rebuild WASM from audited source\n` +
            `Audit commit: 4dc5c4833f16b3f3686697856fd8e285dc47d14f\n`
          );
        }
      }
    });

    it('SECURITY: hash_single() must match Axiom halo2_base golden vectors', () => {
      const tests = [
        { value: 0n, expected: GOLDEN_HASH_SINGLE_0 },
        { value: 42n, expected: GOLDEN_HASH_SINGLE_42 },
        { value: 12345n, expected: GOLDEN_HASH_SINGLE_12345 }
      ];

      for (const test of tests) {
        const valueHex = '0x' + test.value.toString(16).padStart(64, '0');
        const hash = BigInt(hash_single(valueHex));

        if (hash !== test.expected) {
          throw new Error(
            `🚨 SUPPLY-CHAIN ATTACK DETECTED 🚨\n` +
            `hash_single(${test.value}) mismatch!\n` +
            `Expected (Axiom): ${test.expected.toString(16)}\n` +
            `Got (WASM):       ${hash.toString(16)}\n` +
            `\n` +
            `ACTION REQUIRED: Rebuild WASM from audited source\n`
          );
        }
      }
    });

    it('SECURITY: Poseidon must be non-commutative (Merkle tree security)', () => {
      // If someone replaces Poseidon with a commutative hash (like XOR),
      // Merkle tree security breaks completely (can swap siblings)
      const a = 111n;
      const b = 222n;

      const hash_ab = BigInt(hash_pair(
        '0x' + a.toString(16).padStart(64, '0'),
        '0x' + b.toString(16).padStart(64, '0')
      ));

      const hash_ba = BigInt(hash_pair(
        '0x' + b.toString(16).padStart(64, '0'),
        '0x' + a.toString(16).padStart(64, '0')
      ));

      if (hash_ab === hash_ba) {
        throw new Error(
          `🚨 SECURITY FAILURE 🚨\n` +
          `Poseidon hash is COMMUTATIVE (hash(a,b) == hash(b,a))\n` +
          `This breaks Merkle tree security completely.\n` +
          `\n` +
          `Possible causes:\n` +
          `1. Hash function replaced with commutative variant (XOR, ADD, etc.)\n` +
          `2. Implementation bug in WASM bindings\n` +
          `\n` +
          `ACTION REQUIRED: Fix immediately\n`
        );
      }
    });
  });
});
