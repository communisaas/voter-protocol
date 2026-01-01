/**
 * ⚠️ **REMOVED - BREAKING CHANGE** ⚠️
 *
 * This module has been REMOVED because it used SHA256 instead of Poseidon2.
 * SHA256 hashes are NOT verifiable by ZK circuits.
 *
 * **MIGRATION**:
 * - Old: import { MerkleTreeBuilder } from './transformation/merkle-builder'
 * - New: import { MultiLayerMerkleTreeBuilder } from './core/multi-layer-builder'
 *
 * The new builder uses Poseidon2 and is ZK-compatible.
 *
 * **SECURITY ISSUE**:
 * - SHA256 hashes create HASH MISMATCH between off-chain tree and on-chain verification
 * - Noir/Barretenberg circuits ONLY support Poseidon2 hash family
 * - Any proofs generated with SHA256 will FAIL circuit verification
 *
 * @deprecated REMOVED - Use MultiLayerMerkleTreeBuilder from src/core/multi-layer-builder.ts
 * @throws Error Always throws to prevent accidental usage
 */

import type { Polygon, MultiPolygon } from 'geojson';

// Re-export types for backward compatibility (types are still valid)
export type { MerkleTree, MerkleProof, NormalizedDistrict } from './types.js';

const DEPRECATION_ERROR = `
╔══════════════════════════════════════════════════════════════════════════════╗
║                    ⛔ DEPRECATED: MerkleTreeBuilder ⛔                       ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  This class has been REMOVED because it used SHA256 (NOT ZK-compatible).    ║
║                                                                              ║
║  SHA256 hashes CANNOT be verified by Noir/Barretenberg ZK circuits.         ║
║  The new MultiLayerMerkleTreeBuilder uses Poseidon2 (ZK-compatible).        ║
║                                                                              ║
║  MIGRATION:                                                                  ║
║  - Old: import { MerkleTreeBuilder } from './transformation/merkle-builder' ║
║  - New: import { MultiLayerMerkleTreeBuilder }                               ║
║         from './core/multi-layer-builder'                                    ║
║                                                                              ║
║  For production usage, use ShadowAtlasService.buildAtlas() which uses       ║
║  MultiLayerMerkleTreeBuilder internally.                                     ║
╚══════════════════════════════════════════════════════════════════════════════╝
`;

/**
 * @deprecated REMOVED - Use MultiLayerMerkleTreeBuilder instead
 * @throws Error Always throws to prevent usage of SHA256-based tree builder
 */
export class MerkleTreeBuilder {
  constructor() {
    throw new Error(DEPRECATION_ERROR);
  }

  /**
   * @deprecated REMOVED - Use MultiLayerMerkleTreeBuilder.build() instead
   * @throws Error Always throws
   */
  build(_districts: readonly unknown[]): never {
    throw new Error(DEPRECATION_ERROR);
  }

  /**
   * @deprecated REMOVED - Use MultiLayerMerkleTreeBuilder.generateProof() instead
   * @throws Error Always throws
   */
  generateProof(_tree: unknown, _districtId: string): never {
    throw new Error(DEPRECATION_ERROR);
  }

  /**
   * @deprecated REMOVED - Use MultiLayerMerkleTreeBuilder.verifyProof() instead
   * @throws Error Always throws
   */
  verifyProof(_proof: unknown): never {
    throw new Error(DEPRECATION_ERROR);
  }

  /**
   * @deprecated REMOVED
   * @throws Error Always throws
   */
  exportTree(_tree: unknown, _outputPath: string): never {
    throw new Error(DEPRECATION_ERROR);
  }

  /**
   * @deprecated REMOVED
   * @throws Error Always throws
   */
  generateAllProofs(_tree: unknown): never {
    throw new Error(DEPRECATION_ERROR);
  }

  /**
   * @deprecated REMOVED
   * @throws Error Always throws
   */
  verifyAllProofs(_proofs: readonly unknown[]): never {
    throw new Error(DEPRECATION_ERROR);
  }
}
