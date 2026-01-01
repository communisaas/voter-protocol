/**
 * Shadow Atlas Transformation Pipeline
 *
 * Layer 2: Transform raw scraped data → validated, normalized, indexed, committed
 *
 * ⛔ **BREAKING CHANGE** ⛔
 * The following exports have been REMOVED because they used SHA256 (NOT ZK-compatible):
 * - TransformationPipeline: REMOVED (throws at runtime)
 * - MerkleTreeBuilder: REMOVED (throws at runtime)
 *
 * **USE INSTEAD**:
 * - ShadowAtlasService.buildAtlas() for production Merkle trees
 * - MultiLayerMerkleTreeBuilder from src/core/multi-layer-builder.ts (ZK-compatible)
 *
 * **STILL VALID**:
 * - TransformationValidator: Semantic + geographic + geometry validation
 * - TransformationNormalizer: Geometry simplification + metadata standardization
 * - RTreeBuilder: SQLite R-tree spatial index
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

// ⛔ DEPRECATED - Throws at runtime
// These exports are kept for backward compatibility but will throw immediately
// if instantiated. Use ShadowAtlasService.buildAtlas() instead.
/**
 * @deprecated REMOVED - Throws at runtime. Use ShadowAtlasService.buildAtlas() instead.
 * @throws Error Always throws when constructor is called
 */
export { TransformationPipeline, type PipelineConfig } from './pipeline.js';

/**
 * @deprecated REMOVED - Throws at runtime. Use MultiLayerMerkleTreeBuilder instead.
 * @throws Error Always throws when constructor is called
 */
export { MerkleTreeBuilder } from './merkle-builder.js';

// ============================================================================
// VALID EXPORTS (not deprecated)
// ============================================================================

// Validation
export { TransformationValidator } from './validator.js';

// Normalization
export {
  TransformationNormalizer,
  type NormalizationOptions,
} from './normalizer.js';

// R-tree indexing
export { RTreeBuilder } from './rtree-builder.js';

// Type definitions
export type {
  // Raw data types
  RawDataset,
  ProvenanceMetadata,

  // Validation types
  ValidationResult,
  ValidationContext,
  ValidationStats,

  // Normalization types
  NormalizedDistrict,
  BoundingBox,
  NormalizationStats,

  // Database types
  DistrictRecord,

  // Merkle tree types
  MerkleTree,
  MerkleProof,

  // Pipeline types
  TransformationResult,
  TransformationMetadata,
  StageResult,

  // IPFS types
  IPFSPublication,
} from './types.js';
