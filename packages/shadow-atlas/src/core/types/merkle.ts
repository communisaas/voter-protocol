/**
 * Merkle Tree Types
 *
 * Types for cryptographic Merkle tree structures used for
 * content-addressed boundary commitments and client verification.
 */

import type { NormalizedDistrict } from './transformation.js';

/**
 * Merkle proof for client verification
 */
export interface MerkleProof {
  readonly root: string;           // Hex string
  readonly leaf: string;           // Hex string
  readonly siblings: readonly string[];  // Hex strings
  readonly pathIndices: readonly number[];  // Path indices (0 = left child, 1 = right child)
  readonly districtId: string;
}

/**
 * Merkle tree structure
 */
export interface MerkleTree {
  readonly root: string;           // Hex string (cryptographic commitment)
  readonly leaves: readonly string[];
  readonly tree: readonly (readonly string[])[]; // Array of layers
  readonly districts: readonly NormalizedDistrict[]; // Sorted by ID
}
