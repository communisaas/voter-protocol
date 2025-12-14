/**
 * @deprecated Import from '../core/types.js' instead
 * This file is a backward-compatibility shim and will be removed in v2.0
 *
 * MIGRATION PATH:
 * All types consolidated into '../core/types.js'
 * - Database types (Municipality, Source, Selection, etc.)
 * - Discovery types (DiscoveryState, DiscoveryQuery, etc.)
 * - Provider types (BoundaryProvider, NormalizedBoundary, etc.)
 * - Transformation types (ProvenanceMetadata, MerkleTree, etc.)
 */

// Re-export ALL types from core/types.js
export type * from '../core/types.js';

// Specifically re-export the most commonly used types for clarity
export type {
  // Database types
  Municipality,
  Source,
  SourceKind,
  Selection,
  DecisionType,
  Artifact,
  Head,
  Event,
  EventKind,
  StatusView,
  StatusType,
  CoverageView,
  DatabaseAdapter,
  StorageAdapter,

  // GeoJSON types
  NormalizedGeoJSON,
  GeoJSONFeature,
  GeoJSONGeometry,

  // LLM types
  LLMBatchCity,
  LLMBatchCandidate,
  LLMLayerInfo,
  LLMBatchInput,
  LLMBatchCityInput,
  LLMDecision,

  // Fetcher types
  FetcherSourceMetadata,
  FetchResult,
} from '../core/types.js';
