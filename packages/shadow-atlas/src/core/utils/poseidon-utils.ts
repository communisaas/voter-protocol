/**
 * Shared Poseidon hash utilities for Shadow Atlas
 *
 * CONSOLIDATION: Hash pair logic was duplicated across:
 * - global-merkle-tree.ts (hashPair method)
 * - multi-layer-builder.ts (hashPair method)
 *
 * Now centralized here for single source of truth.
 */

import { hash_pair } from '@voter-protocol/crypto/circuits';
import type { CircuitDepth } from '../constants.js';

/**
 * Hash two bigint values using Poseidon2
 *
 * SECURITY: Non-commutative (hashPair(a, b) !== hashPair(b, a))
 * This prevents sibling swap attacks in Merkle tree verification.
 *
 * @param left - Left child hash
 * @param right - Right child hash
 * @returns Poseidon2 hash of the pair
 */
export async function hashPair(left: bigint, right: bigint): Promise<bigint> {
  const leftHex = '0x' + left.toString(16).padStart(64, '0');
  const rightHex = '0x' + right.toString(16).padStart(64, '0');
  const hashHex = await hash_pair(leftHex, rightHex);
  return BigInt(hashHex);
}

/**
 * Select optimal circuit depth for address count
 *
 * Maps address count to the smallest circuit depth that can accommodate it.
 * Larger depths have higher proving costs, so we minimize depth.
 *
 * Capacity by depth:
 * - 18: 2^18 = 262,144 addresses
 * - 20: 2^20 = 1,048,576 addresses
 * - 22: 2^22 = 4,194,304 addresses
 * - 24: 2^24 = 16,777,216 addresses
 *
 * @param addressCount - Number of addresses in the tree
 * @returns Optimal circuit depth
 */
export function selectDepthForSize(addressCount: number): CircuitDepth {
  if (addressCount <= 262_144) return 18;   // 2^18
  if (addressCount <= 1_048_576) return 20; // 2^20
  if (addressCount <= 4_194_304) return 22; // 2^22
  return 24;                                 // 2^24
}
