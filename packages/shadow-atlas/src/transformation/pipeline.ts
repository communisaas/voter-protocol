/**
 * ⚠️ **REMOVED - BREAKING CHANGE** ⚠️
 *
 * This module has been REMOVED because it used the legacy MerkleTreeBuilder with SHA256.
 * SHA256 hashes are NOT verifiable by ZK circuits.
 *
 * **MIGRATION**:
 * - Old: import { TransformationPipeline } from './transformation/pipeline'
 * - New: Use ShadowAtlasService.buildAtlas() which uses MultiLayerMerkleTreeBuilder
 *
 * **PRODUCTION PATH**:
 * ```typescript
 * const atlas = new ShadowAtlasService();
 * await atlas.initialize();
 *
 * // Use the ZK-compatible buildAtlas() method
 * const result = await atlas.buildAtlas({
 *   layers: ['cd', 'sldu', 'sldl', 'county'],
 *   year: 2024,
 *   outputPath: './shadow-atlas-output/atlas-2024.json'
 * });
 *
 * console.log(`Merkle root: 0x${result.merkleRoot.toString(16)}`);
 * ```
 *
 * **SECURITY ISSUE**:
 * - SHA256 hashes create HASH MISMATCH between off-chain tree and on-chain verification
 * - Noir/Barretenberg circuits ONLY support Poseidon2 hash family
 * - Any proofs generated with SHA256 will FAIL circuit verification
 *
 * @deprecated REMOVED - Use ShadowAtlasService.buildAtlas() instead
 * @throws Error Always throws to prevent accidental usage
 */

// ============================================================================
// Re-exported Types (these are still valid)
// ============================================================================

/**
 * Pipeline configuration (type still valid for reference)
 */
export interface PipelineConfig {
  readonly inputDir: string;
  readonly outputDir: string;
  readonly databaseName: string;
  readonly skipValidation: boolean;
  readonly parallelValidation: boolean;
}

// ============================================================================
// Deprecation Error
// ============================================================================

const DEPRECATION_ERROR = `
╔══════════════════════════════════════════════════════════════════════════════╗
║           ⛔ DEPRECATED: TransformationPipeline ⛔                           ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  This class has been REMOVED because it used SHA256 (NOT ZK-compatible).    ║
║                                                                              ║
║  SHA256 hashes CANNOT be verified by Noir/Barretenberg ZK circuits.         ║
║  The new MultiLayerMerkleTreeBuilder uses Poseidon2 (ZK-compatible).        ║
║                                                                              ║
║  MIGRATION:                                                                  ║
║  Use ShadowAtlasService.buildAtlas() instead:                               ║
║                                                                              ║
║    const atlas = new ShadowAtlasService();                                   ║
║    await atlas.initialize();                                                 ║
║    const result = await atlas.buildAtlas({                                   ║
║      layers: ['cd', 'sldu', 'sldl', 'county'],                               ║
║      year: 2024,                                                             ║
║      outputPath: './output/atlas.json'                                       ║
║    });                                                                        ║
║                                                                              ║
║  The buildAtlas() method uses MultiLayerMerkleTreeBuilder internally.        ║
╚══════════════════════════════════════════════════════════════════════════════╝
`;

// ============================================================================
// Throwing Stub Class
// ============================================================================

/**
 * @deprecated REMOVED - Use ShadowAtlasService.buildAtlas() instead
 * @throws Error Always throws to prevent usage of SHA256-based pipeline
 */
export class TransformationPipeline {
  constructor(_config: Partial<PipelineConfig>) {
    throw new Error(DEPRECATION_ERROR);
  }

  /**
   * @deprecated REMOVED - Use ShadowAtlasService.buildAtlas() instead
   * @throws Error Always throws
   */
  async transform(): Promise<never> {
    throw new Error(DEPRECATION_ERROR);
  }
}

/**
 * @deprecated REMOVED - Use ShadowAtlasService.buildAtlas() instead
 * @throws Error Always throws
 */
export async function main(): Promise<never> {
  throw new Error(DEPRECATION_ERROR);
}
