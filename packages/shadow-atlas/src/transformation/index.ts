/**
 * Shadow Atlas Transformation Pipeline
 *
 * Layer 2: Transform raw scraped data → validated, normalized, indexed, committed
 *
 * Exports:
 * - TransformationPipeline: Main orchestrator
 * - TransformationValidator: Semantic + geographic + geometry validation
 * - TransformationNormalizer: Geometry simplification + metadata standardization
 * - RTreeBuilder: SQLite R-tree spatial index
 * - MerkleTreeBuilder: Deterministic Merkle tree construction
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

// Main pipeline orchestrator
export { TransformationPipeline, type PipelineConfig } from './pipeline.js';

// Validation
export { TransformationValidator } from './validator.js';

// Normalization
export {
  TransformationNormalizer,
  type NormalizationOptions,
} from './normalizer.js';

// R-tree indexing
export { RTreeBuilder } from './rtree-builder.js';

// Merkle tree commitment
export { MerkleTreeBuilder } from './merkle-builder.js';

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
