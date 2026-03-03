/**
 * Golden Test Vectors for Poseidon2 Hash Verification (CVE-VOTER-006)
 *
 * PURPOSE:
 * This test file contains hardcoded expected hash values generated from
 * the actual Noir circuit (via @noir-lang/noir_js). These vectors serve
 * as a cross-language verification mechanism to detect any divergence
 * between TypeScript and Noir Poseidon2 implementations.
 *
 * WHY THIS MATTERS:
 * Hash algorithm divergence is a silent killer in ZK systems. If TypeScript
 * computes a different Merkle root than Noir, proofs will fail verification
 * with no obvious error message. These tests catch such divergence at CI time.
 *
 * VECTOR GENERATION:
 * All expected values were generated using the Noir stdlib poseidon2_permutation
 * function via the fixtures circuit (noir/fixtures/src/main.nr). The vectors
 * are deterministic - any change in the underlying hash function will cause
 * these tests to fail.
 *
 * CIRCUIT SPECIFICATION:
 * - Function: poseidon2_permutation([a, b, c, d], 4)[0]
 * - Field: BN254 scalar field (21888242871839275222246405745257275088548364400416034343698204186575808495617)
 * - Implementation: Noir stdlib (noir-lang/noir_js v1.0.0-beta.16)
 *
 * MAINTENANCE:
 * If you need to update these vectors (e.g., after a Noir version upgrade):
 * 1. Run: npx tsx scripts/generate-golden-vectors.ts
 * 2. Update the constants below with new values
 * 3. Document the reason for the change in git commit
 *
 * @see https://github.com/noir-lang/noir/blob/master/noir_stdlib/src/hash/poseidon2.nr
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  Poseidon2Hasher,
  DOMAIN_HASH1,
  DOMAIN_HASH2,
  DOMAIN_HASH3,
  DOMAIN_HASH4,
  DOMAIN_SPONGE_24,
} from '../poseidon2';

// ============================================================================
// BN254 FIELD CONSTANTS
// ============================================================================

/**
 * BN254 scalar field modulus (also known as Fr or the scalar field order)
 * This is the maximum value + 1 that can be represented in the field.
 * All field elements must be strictly less than this value.
 */
const BN254_FIELD_MODULUS = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
);

/**
 * Maximum valid field element (modulus - 1)
 * Used for boundary testing to ensure edge cases are handled correctly.
 */
const BN254_MAX_FIELD_ELEMENT = BN254_FIELD_MODULUS - 1n;

// ============================================================================
// GOLDEN TEST VECTORS
// These values are deterministic outputs from the Noir poseidon2_permutation.
// DO NOT MODIFY unless you have verified the new values with the Noir circuit.
// ============================================================================

/**
 * Vector 1: Hash of (1, 2) - Basic small values
 * Input: poseidon2_permutation([1, 2, DOMAIN_HASH2, 0], 4)[0]  // BA-003: Domain separation
 * Purpose: Verify basic hashing works with small integers
 */
const HASH_1_2 = 5700113488374071721540629675635551041370719088032104434910951352719804357924n;

/**
 * Vector 2: Hash of (0, 0) - Zero case
 * Input: poseidon2_permutation([0, 0, DOMAIN_HASH2, 0], 4)[0]  // BA-003: Domain separation
 * Purpose: Verify zero-input handling (critical for empty leaves in Merkle trees)
 */
const HASH_0_0 = 7920904892182681660068699473082554335979114182301659186550863530220333250830n;

/**
 * Vector 3: Hash of (BN254_PRIME - 1, 0) - Maximum field element
 * Input: poseidon2_permutation([21888242871839275222246405745257275088548364400416034343698204186575808495616, 0, DOMAIN_HASH2, 0], 4)[0]  // BA-003
 * Purpose: Boundary test - ensures max field values don't cause overflow/underflow
 */
const HASH_MAX_0 = 13491091896790744474024807694963177586438429502397837496652506738509530300397n;

/**
 * Vector 4: Hash of (2^248, 2^248) - Large values near field boundary
 * Input: poseidon2_permutation([2^248, 2^248, DOMAIN_HASH2, 0], 4)[0]  // BA-003: Domain separation
 * Purpose: Test large values that are valid but close to field overflow
 * Note: 2^248 < BN254_PRIME, so this is a valid field element
 */
const HASH_LARGE = 17154262625000596133902546958768945485998814610377059489508778071206375074806n;

/**
 * Vector 5: Hash of single value (42)
 * Input: poseidon2_permutation([42, DOMAIN_HASH1, 0, 0], 4)[0]  // SA-007: Domain separation
 * Purpose: Verify single-value hashing (used for leaf hashing)
 */
const HASH_SINGLE_42 = 9322738841787553356062428716916748272222544603393244296941047884290559321234n;

/**
 * Vector 6: Hash of single value (0)
 * Input: poseidon2_permutation([0, DOMAIN_HASH1, 0, 0], 4)[0]  // SA-007: Domain separation
 * Purpose: Verify single zero value (NO LONGER matches HASH_0_0 due to domain separation)
 */
const HASH_SINGLE_0 = 19918955537188974640275502270345037015548280862301442546474376571040241611505n;

/**
 * Vector 7: Hash of 4 values (1, 2, 3, 4)
 * Input: 2-round sponge with DOMAIN_HASH4 (BR5-001)
 *   Round 1: permute([DOMAIN_HASH4, 1, 2, 3])
 *   Round 2: state[1] += 4, permute(state), return state[0]
 * Purpose: Verify authority-bound 4-value hashing (used for user leaf)
 */
const HASH_4_VALUES = 870161254014206826379233303393501691020716205279828027714627622785779138559n;

/**
 * Vector 8: Hash of string "hello"
 * Input: UTF-8 bytes of "hello" -> single chunk -> hashSingle  // SA-007: Includes DOMAIN_HASH1
 * Purpose: Verify string hashing for human-readable identifiers
 */
const HASH_HELLO = 20477477904946483159185841972227506861491996374656427994511915245453687913558n;

/**
 * Vector 9: Hash of empty string ""
 * Input: Empty string -> hashSingle(0)  // SA-007: Includes DOMAIN_HASH1
 * Purpose: Verify empty string handling (should match HASH_SINGLE_0)
 */
const HASH_EMPTY = 19918955537188974640275502270345037015548280862301442546474376571040241611505n;

/**
 * Vector 10: Hash of 4 zeros
 * Input: 2-round sponge with DOMAIN_HASH4 (BR5-001)
 *   Round 1: permute([DOMAIN_HASH4, 0, 0, 0])
 *   Round 2: state[1] += 0, permute(state), return state[0]
 * Purpose: Verify hash4 with all zeros (domain-separated, differs from HASH_0_0)
 */
const HASH_4_ZEROS = 7465331315837042829558636858758355884443749401755522171552460478666633968261n;

/**
 * Vector 11: Hash of string "voter-protocol-cve-006"
 * Input: UTF-8 bytes -> single chunk -> hashSingle  // SA-007: Includes DOMAIN_HASH1
 * Purpose: Domain-specific test string for protocol identification
 */
const HASH_LONG_STRING = 11353653129648389514150722603806975136779426700304574859638383521217385389221n;

/**
 * Vector 12: Hash of hex string input (0x...001)
 * Input: hashSingle('0x0000000000000000000000000000000000000000000000000000000000000001')  // SA-007
 * Purpose: Verify hex string parsing produces same result as bigint 1n
 */
const HASH_HEX_INPUT = 15264162045021955310114759652942767540044018132338228656490281371800599823631n;

// ============================================================================
// TEST SUITE
// ============================================================================

describe('Poseidon2 Golden Test Vectors (CVE-VOTER-006)', () => {
  let hasher: Poseidon2Hasher;

  beforeAll(async () => {
    // Initialize the Poseidon2Hasher singleton (loads Noir WASM circuit)
    hasher = await Poseidon2Hasher.getInstance();
  });

  describe('Pair Hashing (hashPair)', () => {
    it('should match golden vector for hash(1, 2)', async () => {
      // CRITICAL: This is the most basic hash operation
      // If this fails, all Merkle tree operations will be broken
      const result = await hasher.hashPair(1n, 2n);
      expect(result).toBe(HASH_1_2);
    });

    it('should match golden vector for hash(0, 0)', async () => {
      // CRITICAL: Zero hashing is used for empty Merkle tree nodes
      // Divergence here breaks sparse Merkle tree implementations
      const result = await hasher.hashPair(0n, 0n);
      expect(result).toBe(HASH_0_0);
    });

    it('should match golden vector for hash(BN254_MAX, 0)', async () => {
      // BOUNDARY TEST: Maximum field element
      // Verifies no overflow in field arithmetic
      const result = await hasher.hashPair(BN254_MAX_FIELD_ELEMENT, 0n);
      expect(result).toBe(HASH_MAX_0);
    });

    it('should match golden vector for hash(2^248, 2^248)', async () => {
      // LARGE VALUE TEST: Values close to but below field modulus
      // Catches issues with bigint handling in TypeScript
      const largeValue = 2n ** 248n;
      const result = await hasher.hashPair(largeValue, largeValue);
      expect(result).toBe(HASH_LARGE);
    });
  });

  describe('Single Value Hashing (hashSingle)', () => {
    it('should match golden vector for hashSingle(42)', async () => {
      // LEAF HASH TEST: Single values are used for leaf node hashing
      const result = await hasher.hashSingle(42n);
      expect(result).toBe(HASH_SINGLE_42);
    });

    it('should match golden vector for hashSingle(0)', async () => {
      // ZERO SINGLE TEST: SA-007 - Now uses DOMAIN_HASH1, so NO LONGER equals hash(0, 0)
      const result = await hasher.hashSingle(0n);
      expect(result).toBe(HASH_SINGLE_0);
    });

    it('hashSingle(0) should NOT equal hashPair(0, 0) due to domain separation', async () => {
      // SA-007: Domain separation ensures these differ
      // hashSingle(0) = poseidon2([0, DOMAIN_HASH1, 0, 0])
      // hashPair(0, 0) = poseidon2([0, 0, DOMAIN_HASH2, 0])
      //                                ^^^^^^^^^^^^^^^^^^^^ different!
      const single = await hasher.hashSingle(0n);
      const pair = await hasher.hashPair(0n, 0n);

      // SA-007: These must NOT be equal to prevent cross-arity attacks
      expect(single).not.toBe(pair);

      // Verify each matches its own golden vector
      expect(single).toBe(HASH_SINGLE_0);
      expect(pair).toBe(HASH_0_0);
    });
  });

  describe('Four-Value Hashing (hash4)', () => {
    it('should match golden vector for hash4(1, 2, 3, 4)', async () => {
      // Golden vector for hash4. Note: nullifier now uses hash2 (CVE-002 fix):
      // nullifier = poseidon2_hash2(user_secret, action_domain)
      const result = await hasher.hash4(1n, 2n, 3n, 4n);
      expect(result).toBe(HASH_4_VALUES);
    });

    it('should match golden vector for hash4(0, 0, 0, 0)', async () => {
      // ZERO HASH4 TEST: All zeros should still produce valid output
      const result = await hasher.hash4(0n, 0n, 0n, 0n);
      expect(result).toBe(HASH_4_ZEROS);
    });

    it('hash4(0, 0, 0, 0) should NOT equal hashSingle(0) due to domain separation', async () => {
      // SA-007: Domain separation now prevents this collision
      // hashSingle(0) = poseidon2([0, DOMAIN_HASH1, 0, 0])
      // hash4(0,0,0,0) = poseidon2([0, 0, 0, 0])
      const hash4Result = await hasher.hash4(0n, 0n, 0n, 0n);
      const singleResult = await hasher.hashSingle(0n);
      expect(hash4Result).not.toBe(singleResult);
    });
  });

  describe('String Hashing (hashString)', () => {
    it('should match golden vector for hashString("hello")', async () => {
      // STRING TEST: Common use case for human-readable identifiers
      const result = await hasher.hashString('hello');
      expect(result).toBe(HASH_HELLO);
    });

    it('should match golden vector for hashString("")', async () => {
      // EMPTY STRING TEST: Edge case for empty input
      // Empty string -> chunks = [] -> hashSingle(0)
      const result = await hasher.hashString('');
      expect(result).toBe(HASH_EMPTY);
    });

    it('hashString("") should equal hashSingle(0)', async () => {
      // CONSISTENCY TEST: Empty string handled as zero
      const stringResult = await hasher.hashString('');
      const singleResult = await hasher.hashSingle(0n);
      expect(stringResult).toBe(singleResult);
    });

    it('should match golden vector for hashString("voter-protocol-cve-006")', async () => {
      // LONGER STRING TEST: Verifies UTF-8 encoding and chunking
      const result = await hasher.hashString('voter-protocol-cve-006');
      expect(result).toBe(HASH_LONG_STRING);
    });
  });

  describe('Hex String Input Parsing', () => {
    it('should match golden vector for hashSingle with hex string', async () => {
      // HEX INPUT TEST: Verifies hex string parsing
      const result = await hasher.hashSingle(
        '0x0000000000000000000000000000000000000000000000000000000000000001'
      );
      expect(result).toBe(HASH_HEX_INPUT);
    });

    it('hashSingle(1n) should equal hashSingle("0x...01")', async () => {
      // EQUIVALENCE TEST: bigint and hex string should produce same result
      const bigintResult = await hasher.hashSingle(1n);
      const hexResult = await hasher.hashSingle(
        '0x0000000000000000000000000000000000000000000000000000000000000001'
      );
      expect(bigintResult).toBe(hexResult);
    });
  });

  describe('Determinism Verification', () => {
    it('should produce identical results for repeated hashPair calls', async () => {
      // DETERMINISM TEST: Same inputs must always produce same output
      // This catches any accidental randomness or state leakage
      const results = await Promise.all([
        hasher.hashPair(1n, 2n),
        hasher.hashPair(1n, 2n),
        hasher.hashPair(1n, 2n),
      ]);

      expect(results[0]).toBe(HASH_1_2);
      expect(results[1]).toBe(HASH_1_2);
      expect(results[2]).toBe(HASH_1_2);
    });

    it('should produce identical results for repeated hashSingle calls', async () => {
      const results = await Promise.all([
        hasher.hashSingle(42n),
        hasher.hashSingle(42n),
        hasher.hashSingle(42n),
      ]);

      expect(results[0]).toBe(HASH_SINGLE_42);
      expect(results[1]).toBe(HASH_SINGLE_42);
      expect(results[2]).toBe(HASH_SINGLE_42);
    });

    it('should produce identical results for repeated hash4 calls', async () => {
      const results = await Promise.all([
        hasher.hash4(1n, 2n, 3n, 4n),
        hasher.hash4(1n, 2n, 3n, 4n),
        hasher.hash4(1n, 2n, 3n, 4n),
      ]);

      expect(results[0]).toBe(HASH_4_VALUES);
      expect(results[1]).toBe(HASH_4_VALUES);
      expect(results[2]).toBe(HASH_4_VALUES);
    });
  });

  describe('Output Type Validation', () => {
    it('hashPair should return bigint', async () => {
      const result = await hasher.hashPair(1n, 2n);
      expect(typeof result).toBe('bigint');
    });

    it('hashSingle should return bigint', async () => {
      const result = await hasher.hashSingle(42n);
      expect(typeof result).toBe('bigint');
    });

    it('hash4 should return bigint', async () => {
      const result = await hasher.hash4(1n, 2n, 3n, 4n);
      expect(typeof result).toBe('bigint');
    });

    it('hashString should return bigint', async () => {
      const result = await hasher.hashString('hello');
      expect(typeof result).toBe('bigint');
    });

    it('all hash outputs should be valid BN254 field elements', async () => {
      // FIELD BOUNDS TEST: All outputs must be < field modulus
      const outputs = [
        await hasher.hashPair(1n, 2n),
        await hasher.hashSingle(42n),
        await hasher.hash4(1n, 2n, 3n, 4n),
        await hasher.hashString('hello'),
      ];

      for (const output of outputs) {
        expect(output).toBeGreaterThanOrEqual(0n);
        expect(output).toBeLessThan(BN254_FIELD_MODULUS);
      }
    });
  });

  describe('Batch Operations Consistency', () => {
    it('hashPairsBatch should produce same results as individual hashPair calls', async () => {
      // BATCH CONSISTENCY TEST: Batch operations must match individual calls
      const pairs: readonly (readonly [bigint, bigint])[] = [
        [1n, 2n],
        [0n, 0n],
        [42n, 100n],
      ];

      const batchResults = await hasher.hashPairsBatch(pairs);
      const individualResults = await Promise.all(
        pairs.map(([left, right]) => hasher.hashPair(left, right))
      );

      expect(batchResults).toHaveLength(3);
      expect(batchResults[0]).toBe(individualResults[0]);
      expect(batchResults[1]).toBe(individualResults[1]);
      expect(batchResults[2]).toBe(individualResults[2]);

      // Verify against golden vectors
      expect(batchResults[0]).toBe(HASH_1_2);
      expect(batchResults[1]).toBe(HASH_0_0);
    });

    it('hashSinglesBatch should produce same results as individual hashSingle calls', async () => {
      const values: readonly bigint[] = [0n, 42n, 100n];

      const batchResults = await hasher.hashSinglesBatch(values);
      const individualResults = await Promise.all(
        values.map((v) => hasher.hashSingle(v))
      );

      expect(batchResults).toHaveLength(3);
      expect(batchResults[0]).toBe(individualResults[0]);
      expect(batchResults[1]).toBe(individualResults[1]);
      expect(batchResults[2]).toBe(individualResults[2]);

      // Verify against golden vectors
      expect(batchResults[0]).toBe(HASH_SINGLE_0);
      expect(batchResults[1]).toBe(HASH_SINGLE_42);
    });

    it('hashStringsBatch should produce same results as individual hashString calls', async () => {
      const strings: readonly string[] = ['', 'hello', 'voter-protocol-cve-006'];

      const batchResults = await hasher.hashStringsBatch(strings);
      const individualResults = await Promise.all(
        strings.map((s) => hasher.hashString(s))
      );

      expect(batchResults).toHaveLength(3);
      expect(batchResults[0]).toBe(individualResults[0]);
      expect(batchResults[1]).toBe(individualResults[1]);
      expect(batchResults[2]).toBe(individualResults[2]);

      // Verify against golden vectors
      expect(batchResults[0]).toBe(HASH_EMPTY);
      expect(batchResults[1]).toBe(HASH_HELLO);
      expect(batchResults[2]).toBe(HASH_LONG_STRING);
    });
  });

  describe('Cross-Function Consistency', () => {
    it('hashPair(x, 0) should NOT equal hashSingle(x) due to domain separation', async () => {
      // SA-007 + BA-003: Both hash functions use domain separation
      //
      // hashSingle(42) = poseidon2([42, DOMAIN_HASH1, 0, 0])
      // hashPair(42, 0) = poseidon2([42, 0, DOMAIN_HASH2, 0])
      //                                ^^^^^^^^^^^^^^^^^^^^^ different!
      //
      // These MUST NOT be equal to prevent security vulnerabilities where an attacker
      // could substitute a hash2 result for a hash1 result (or vice versa).
      const pairResult = await hasher.hashPair(42n, 0n);
      const singleResult = await hasher.hashSingle(42n);

      // SA-007 + BA-003: Domain separation ensures these are different values
      expect(pairResult).not.toBe(singleResult);

      // Verify hashSingle(42) still produces the expected golden vector
      expect(singleResult).toBe(HASH_SINGLE_42);
    });

    it('hash4(a, b, 0, 0) should NOT equal hashPair(a, b) due to domain separation', async () => {
      // BA-003: hashPair includes DOMAIN_HASH2 in slot 2, but hash4 uses slot 2 for actual data
      //
      // hashPair(1, 2) = poseidon2([1, 2, DOMAIN_HASH2, 0])
      // hash4(1, 2, 0, 0) = poseidon2([1, 2, 0, 0])
      //                                    ^^^^^^^^^ different!
      //
      // This domain separation prevents cross-arity attacks where different hash
      // arities could produce colliding outputs.
      const hash4Result = await hasher.hash4(1n, 2n, 0n, 0n);
      const pairResult = await hasher.hashPair(1n, 2n);

      // BA-003: Domain separation ensures these are different values
      expect(hash4Result).not.toBe(pairResult);

      // Verify hashPair(1, 2) still produces the expected golden vector
      expect(pairResult).toBe(HASH_1_2);
    });
  });
});

// ============================================================================
// REGRESSION GUARD
// ============================================================================

describe('Poseidon2 Regression Guard', () => {
  /**
   * This test serves as a final safeguard against hash divergence.
   * It hashes a known "canary" value and compares against a hardcoded expected result.
   * If this test fails, it indicates a fundamental change in the hash function.
   *
   * CANARY VALUE SELECTION:
   * We use the protocol name as a memorable, unique identifier that's unlikely
   * to collide with other test data.
   */
  it('CANARY: Protocol identifier hash must remain stable', async () => {
    const hasher = await Poseidon2Hasher.getInstance();
    const canaryHash = await hasher.hashString('voter-protocol-v1');

    // This value was computed on 2026-02-01 using noir-lang/noir_js v1.0.0-beta.16
    // with BA-003 (hashPair) and SA-007 (hashSingle) domain separation
    // If this value changes, investigate IMMEDIATELY - all existing proofs may be invalid
    const EXPECTED_CANARY = 8366566449439678633454373218705606361669530872810064846617848987382134091229n;

    expect(canaryHash).toBe(EXPECTED_CANARY);
  });
});

// ============================================================================
// DOMAIN HASH CONSTANT PARITY
// Verifies exported constants match the exact values used in Noir circuits.
// If any of these fail, TypeScript and Noir will compute different hashes.
// ============================================================================

describe('Domain Hash Constant Parity', () => {
  it('DOMAIN_HASH1 = 0x48314d ("H1M")', () => {
    expect(BigInt(DOMAIN_HASH1)).toBe(0x48314dn);
  });

  it('DOMAIN_HASH2 = 0x48324d ("H2M")', () => {
    expect(BigInt(DOMAIN_HASH2)).toBe(0x48324dn);
  });

  it('DOMAIN_HASH3 = 0x48334d ("H3M")', () => {
    expect(BigInt(DOMAIN_HASH3)).toBe(0x48334dn);
  });

  it('DOMAIN_HASH4 = 0x48344d ("H4M")', () => {
    expect(BigInt(DOMAIN_HASH4)).toBe(0x48344dn);
  });

  it('DOMAIN_SPONGE_24 = 0x534f4e47455f24 ("SONGE_24")', () => {
    expect(BigInt(DOMAIN_SPONGE_24)).toBe(0x534f4e47455f24n);
  });

  it('all domain hashes are valid BN254 field elements', () => {
    const BN254_MOD = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
    for (const tag of [DOMAIN_HASH1, DOMAIN_HASH2, DOMAIN_HASH3, DOMAIN_HASH4, DOMAIN_SPONGE_24]) {
      const val = BigInt(tag);
      expect(val).toBeGreaterThan(0n);
      expect(val).toBeLessThan(BN254_MOD);
    }
  });

  it('domain hashes are all distinct (no collision)', () => {
    const values = [DOMAIN_HASH1, DOMAIN_HASH2, DOMAIN_HASH3, DOMAIN_HASH4, DOMAIN_SPONGE_24].map(h => BigInt(h));
    const unique = new Set(values.map(v => v.toString()));
    expect(unique.size).toBe(5);
  });
});
