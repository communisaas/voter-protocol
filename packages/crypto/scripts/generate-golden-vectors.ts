#!/usr/bin/env npx tsx
/**
 * Generate Golden Test Vectors for Poseidon2 Hash Verification
 *
 * PURPOSE:
 * This script generates the expected hash values for golden-vectors.test.ts
 * by running the actual Noir circuit. Use this script when:
 * 1. Upgrading the Noir version
 * 2. Changing the Poseidon2 circuit configuration
 * 3. Adding new test vectors
 *
 * USAGE:
 *   cd packages/crypto
 *   npx tsx scripts/generate-golden-vectors.ts
 *
 * WARNING:
 * If the generated values differ from those in golden-vectors.test.ts,
 * this indicates a hash algorithm change. This is CRITICAL - all existing
 * proofs may become invalid. Investigate thoroughly before updating.
 *
 * @see /packages/crypto/test/golden-vectors.test.ts
 */

import { Poseidon2Hasher } from '../poseidon2';

// BN254 field modulus (the scalar field order of BN254)
const BN254_FIELD_MODULUS = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
);

async function main() {
  console.log('='.repeat(80));
  console.log('Poseidon2 Golden Test Vector Generator');
  console.log('='.repeat(80));
  console.log('');
  console.log('These values should match the constants in golden-vectors.test.ts');
  console.log('If they differ, a hash algorithm change has occurred!');
  console.log('');
  console.log('-'.repeat(80));

  const hasher = await Poseidon2Hasher.getInstance();

  // Vector 1: Hash of (1, 2) - basic small values
  const hash_1_2 = await hasher.hashPair(1n, 2n);
  console.log('\n// Vector 1: Hash of (1, 2) - basic small values');
  console.log(`const HASH_1_2 = ${hash_1_2}n;`);

  // Vector 2: Hash of (0, 0) - zero case
  const hash_0_0 = await hasher.hashPair(0n, 0n);
  console.log('\n// Vector 2: Hash of (0, 0) - zero case');
  console.log(`const HASH_0_0 = ${hash_0_0}n;`);

  // Vector 3: Hash of (BN254_PRIME - 1, 0) - max field element
  const maxFieldElement = BN254_FIELD_MODULUS - 1n;
  const hash_max_0 = await hasher.hashPair(maxFieldElement, 0n);
  console.log('\n// Vector 3: Hash of (BN254_PRIME - 1, 0) - max field element');
  console.log(`const HASH_MAX_0 = ${hash_max_0}n;`);

  // Vector 4: Hash of (2^248, 2^248) - large values
  const largeValue = 2n ** 248n;
  const hash_large = await hasher.hashPair(largeValue, largeValue);
  console.log('\n// Vector 4: Hash of (2^248, 2^248) - large values');
  console.log(`const HASH_LARGE = ${hash_large}n;`);

  // Vector 5: Hash of single value (42)
  const hash_single_42 = await hasher.hashSingle(42n);
  console.log('\n// Vector 5: Hash of single value (42)');
  console.log(`const HASH_SINGLE_42 = ${hash_single_42}n;`);

  // Vector 6: Hash of single value (0)
  const hash_single_0 = await hasher.hashSingle(0n);
  console.log('\n// Vector 6: Hash of single value (0)');
  console.log(`const HASH_SINGLE_0 = ${hash_single_0}n;`);

  // Vector 7: Hash of 4 values (1, 2, 3, 4)
  const hash_4_values = await hasher.hash4(1n, 2n, 3n, 4n);
  console.log('\n// Vector 7: Hash of 4 values (1, 2, 3, 4)');
  console.log(`const HASH_4_VALUES = ${hash_4_values}n;`);

  // Vector 8: Hash of string "hello"
  const hash_hello = await hasher.hashString('hello');
  console.log('\n// Vector 8: Hash of string "hello"');
  console.log(`const HASH_HELLO = ${hash_hello}n;`);

  // Vector 9: Hash of empty string ""
  const hash_empty = await hasher.hashString('');
  console.log('\n// Vector 9: Hash of empty string ""');
  console.log(`const HASH_EMPTY = ${hash_empty}n;`);

  // Vector 10: Hash of 4 zeros
  const hash_4_zeros = await hasher.hash4(0n, 0n, 0n, 0n);
  console.log('\n// Vector 10: Hash of 4 zeros');
  console.log(`const HASH_4_ZEROS = ${hash_4_zeros}n;`);

  // Vector 11: Hash of string "voter-protocol-cve-006"
  const hash_long_string = await hasher.hashString('voter-protocol-cve-006');
  console.log('\n// Vector 11: Hash of string "voter-protocol-cve-006"');
  console.log(`const HASH_LONG_STRING = ${hash_long_string}n;`);

  // Vector 12: Hash of hex string input
  const hash_hex_input = await hasher.hashSingle('0x0000000000000000000000000000000000000000000000000000000000000001');
  console.log('\n// Vector 12: Hash of hex string input (0x...001)');
  console.log(`const HASH_HEX_INPUT = ${hash_hex_input}n;`);

  // Canary value
  const canary = await hasher.hashString('voter-protocol-v1');
  console.log('\n// Regression canary');
  console.log(`const EXPECTED_CANARY = ${canary}n;`);

  console.log('\n' + '-'.repeat(80));
  console.log('Generation complete. Compare with golden-vectors.test.ts');
  console.log('='.repeat(80));
}

main().catch((err) => {
  console.error('Error generating vectors:', err);
  process.exit(1);
});
