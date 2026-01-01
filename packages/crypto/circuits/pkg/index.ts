/**
 * Circuit Hash Functions - WASM Bridge
 *
 * Exports Poseidon2 hash functions for Merkle tree construction.
 * Wraps Poseidon2Hasher singleton with the interface expected by shadow-atlas.
 *
 * ARCHITECTURE:
 * - Uses Noir's Poseidon2 implementation via @noir-lang/noir_js
 * - Singleton pattern ensures WASM circuit loads once per process
 * - Async interface (WASM execution is inherently async)
 *
 * SECURITY:
 * - Same Poseidon2 implementation as ZK circuits (Noir stdlib)
 * - Deterministic outputs guarantee TypeScript roots match circuit verification
 */

import { Poseidon2Hasher } from '../../poseidon2.js';

/**
 * Hash two field elements using Poseidon2
 *
 * @param left - Left input as hex string (0x-prefixed, 64 chars)
 * @param right - Right input as hex string (0x-prefixed, 64 chars)
 * @returns Poseidon2 hash as hex string (0x-prefixed)
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
 * @param value - Input as hex string (0x-prefixed)
 * @returns Poseidon2 hash as hex string (0x-prefixed)
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
 * @param a - First input as hex string
 * @param b - Second input as hex string
 * @param c - Third input as hex string
 * @param d - Fourth input as hex string
 * @returns Poseidon2 hash as hex string (0x-prefixed)
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
 */
function validateHexString(value: string, paramName: string): void {
  if (typeof value !== 'string') {
    throw new Error(`${paramName} must be a string, got ${typeof value}`);
  }

  if (!value.startsWith('0x')) {
    throw new Error(
      `${paramName} must be 0x-prefixed hex string, got ${value.slice(0, 10)}...`
    );
  }

  const hexPart = value.slice(2);
  if (hexPart.length === 0) {
    throw new Error(`${paramName} cannot be empty (0x only)`);
  }

  if (!/^[0-9a-fA-F]+$/.test(hexPart)) {
    throw new Error(
      `${paramName} contains invalid hex characters: ${value.slice(0, 10)}...`
    );
  }
}
