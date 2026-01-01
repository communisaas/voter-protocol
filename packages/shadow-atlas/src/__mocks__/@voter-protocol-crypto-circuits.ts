/**
 * Mock implementation of @voter-protocol/crypto/circuits for testing
 *
 * CONTEXT: Shadow-atlas tests import hash_pair/hash_single from '@voter-protocol/crypto/circuits'.
 * This mock wraps the real Poseidon2Hasher to ensure consistent hashing between tree building
 * (which uses hasher.hashPairsBatch) and verification (which uses hash_pair).
 *
 * SECURITY: Uses real Poseidon2 from Noir fixtures circuit for ZK compatibility.
 *
 * TYPE SAFETY: Nuclear-level strictness - explicit types, no any, proper validation.
 */

import { Poseidon2Hasher } from '@voter-protocol/crypto/poseidon2';

/**
 * Hash two field elements using Poseidon2
 *
 * Wraps Poseidon2Hasher to match the circuits API.
 *
 * @param left - Left input as hex string (0x-prefixed)
 * @param right - Right input as hex string (0x-prefixed)
 * @returns Promise<Hash as hex string (0x-prefixed)>
 */
export async function hash_pair(left: string, right: string): Promise<string> {
  validateHexString(left, 'left');
  validateHexString(right, 'right');

  const hasher = await Poseidon2Hasher.getInstance();
  const result = await hasher.hashPair(BigInt(left), BigInt(right));

  return '0x' + result.toString(16).padStart(64, '0');
}

/**
 * Hash a single field element using Poseidon2
 *
 * Wraps Poseidon2Hasher to match the circuits API.
 *
 * @param value - Input as hex string (0x-prefixed)
 * @returns Promise<Hash as hex string (0x-prefixed)>
 */
export async function hash_single(value: string): Promise<string> {
  validateHexString(value, 'value');

  const hasher = await Poseidon2Hasher.getInstance();
  const result = await hasher.hashSingle(BigInt(value));

  return '0x' + result.toString(16).padStart(64, '0');
}

/**
 * Hash four field elements using Poseidon2
 *
 * Wraps Poseidon2Hasher to match the circuits API.
 *
 * @param a - First input as hex string
 * @param b - Second input as hex string
 * @param c - Third input as hex string
 * @param d - Fourth input as hex string
 * @returns Promise<Hash as hex string (0x-prefixed)>
 */
export async function hash_4(
  a: string,
  b: string,
  c: string,
  d: string
): Promise<string> {
  validateHexString(a, 'a');
  validateHexString(b, 'b');
  validateHexString(c, 'c');
  validateHexString(d, 'd');

  const hasher = await Poseidon2Hasher.getInstance();
  const result = await hasher.hash4(BigInt(a), BigInt(b), BigInt(c), BigInt(d));

  return '0x' + result.toString(16).padStart(64, '0');
}

/**
 * Batch hash pairs for efficient Merkle tree construction
 *
 * @param pairs - Array of [left, right] hex string pairs
 * @returns Array of hash hex strings
 */
export async function hash_pairs_batch(
  pairs: ReadonlyArray<readonly [string, string]>
): Promise<string[]> {
  const hasher = await Poseidon2Hasher.getInstance();

  const bigintPairs: Array<readonly [bigint, bigint]> = pairs.map(
    ([left, right]) => {
      validateHexString(left, 'left');
      validateHexString(right, 'right');
      return [BigInt(left), BigInt(right)] as const;
    }
  );

  const results = await hasher.hashPairsBatch(bigintPairs);

  return results.map((r) => '0x' + r.toString(16).padStart(64, '0'));
}

/**
 * Pre-warm the hasher singleton (optional, for faster first hash)
 */
export async function warmup(): Promise<void> {
  await Poseidon2Hasher.getInstance();
}

/**
 * Validate hex string format
 *
 * @param value - Hex string to validate
 * @param paramName - Parameter name for error messages
 * @throws Error if invalid hex string
 */
function validateHexString(value: string, paramName: string): void {
  if (typeof value !== 'string') {
    throw new Error(`${paramName} must be a string, got ${typeof value}`);
  }

  if (!value.startsWith('0x')) {
    throw new Error(`${paramName} must be 0x-prefixed hex string, got ${value.slice(0, 10)}...`);
  }

  const hexPart = value.slice(2);
  if (hexPart.length === 0) {
    throw new Error(`${paramName} cannot be empty (0x only)`);
  }

  if (!/^[0-9a-fA-F]+$/.test(hexPart)) {
    throw new Error(`${paramName} contains invalid hex characters: ${value.slice(0, 10)}...`);
  }
}
