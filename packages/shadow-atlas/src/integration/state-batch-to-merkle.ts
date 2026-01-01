/**
 * ⚠️ **REMOVED - BREAKING CHANGE** ⚠️
 *
 * This module has been REMOVED because it used the legacy MerkleTreeBuilder with SHA256.
 * SHA256 hashes are NOT verifiable by ZK circuits.
 *
 * **MIGRATION**:
 * - Old: import { integrateStateExtractionResult } from './integration/state-batch-to-merkle'
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
 * @throws Error All exported functions throw to prevent accidental usage
 */

import type { Polygon, MultiPolygon } from 'geojson';
import type { StateExtractionResult, LegislativeLayerType } from '../providers/state-batch-extractor.js';
import type { NormalizedDistrict, MerkleTree } from '../transformation/types.js';

// ============================================================================
// Re-exported Types (these are still valid)
// ============================================================================

/**
 * Integration configuration (type still valid for migration)
 */
export interface IntegrationConfig {
  readonly applyAuthorityResolution?: boolean;
  readonly resolutionDate?: Date;
  readonly includeSourceMetadata?: boolean;
}

/**
 * Integration result with audit trail (type still valid for migration)
 */
export interface IntegrationResult {
  readonly merkleTree: MerkleTree;
  readonly stats: {
    readonly totalBoundaries: number;
    readonly includedBoundaries: number;
    readonly deduplicatedBoundaries: number;
    readonly authorityConflicts: number;
  };
  readonly authorityDecisions: ReadonlyMap<string, unknown>;
  readonly metadata: {
    readonly processedAt: Date;
    readonly durationMs: number;
    readonly config: IntegrationConfig;
  };
}

/**
 * Modified district details (type still valid)
 */
export interface ModifiedDistrict {
  readonly id: string;
  readonly changes: readonly string[];
  readonly areaDelta?: number;
}

/**
 * Update detection result (type still valid)
 */
export interface UpdateDetection {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly modified: readonly ModifiedDistrict[];
}

/**
 * Incremental update result (type still valid)
 */
export interface IncrementalUpdateResult {
  readonly merkleTree: MerkleTree;
  readonly stats: {
    readonly previousBoundaries: number;
    readonly newBoundaries: number;
    readonly updatedBoundaries: number;
    readonly totalBoundaries: number;
  };
  readonly updates: UpdateDetection;
  readonly rootChanged: boolean;
  readonly previousRoot: string;
}

// ============================================================================
// Deprecation Error
// ============================================================================

const DEPRECATION_ERROR = `
╔══════════════════════════════════════════════════════════════════════════════╗
║              ⛔ DEPRECATED: state-batch-to-merkle.ts ⛔                      ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  This module has been REMOVED because it used SHA256 (NOT ZK-compatible).   ║
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
║    });                                                                        ║
║                                                                              ║
║  The buildAtlas() method uses MultiLayerMerkleTreeBuilder internally.        ║
╚══════════════════════════════════════════════════════════════════════════════╝
`;

// ============================================================================
// Throwing Stub Functions
// ============================================================================

/**
 * @deprecated REMOVED - Use ShadowAtlasService.buildAtlas() instead
 * @throws Error Always throws to prevent usage of SHA256-based integration
 */
export function integrateStateExtractionResult(
  _stateResult: StateExtractionResult,
  _config?: IntegrationConfig
): never {
  throw new Error(DEPRECATION_ERROR);
}

/**
 * @deprecated REMOVED - Use ShadowAtlasService.buildAtlas() instead
 * @throws Error Always throws to prevent usage of SHA256-based integration
 */
export function integrateMultipleStates(
  _stateResults: ReadonlyArray<StateExtractionResult>,
  _config?: IntegrationConfig
): never {
  throw new Error(DEPRECATION_ERROR);
}

/**
 * @deprecated REMOVED - Use ShadowAtlasService.buildAtlas() for full rebuild
 * @throws Error Always throws to prevent usage of SHA256-based integration
 */
export function incrementalUpdate(
  _existingTree: MerkleTree,
  _newBoundaries: ReadonlyArray<unknown>,
  _config?: IntegrationConfig
): never {
  throw new Error(DEPRECATION_ERROR);
}

/**
 * @deprecated REMOVED - Use ShadowAtlasService.buildAtlas() instead
 * @throws Error Always throws
 */
export function quickIntegrateState(_stateResult: StateExtractionResult): never {
  throw new Error(DEPRECATION_ERROR);
}

/**
 * @deprecated REMOVED - Use ShadowAtlasService.buildAtlas() instead
 * @throws Error Always throws
 */
export function quickIntegrateMultipleStates(
  _stateResults: ReadonlyArray<StateExtractionResult>
): never {
  throw new Error(DEPRECATION_ERROR);
}

/**
 * @deprecated REMOVED - Use MultiLayerMerkleTreeBuilder.build() instead
 * @throws Error Always throws
 */
export function extractedBoundaryToNormalizedDistrict(_boundary: unknown): never {
  throw new Error(DEPRECATION_ERROR);
}
