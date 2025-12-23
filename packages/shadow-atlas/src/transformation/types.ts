/**
 * Transformation Pipeline Type Definitions
 *
 * Layer 2: Transform raw scraped data → validated, normalized, indexed, committed
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 * This is the cryptographic integrity layer - type errors = invalid proofs.
 */

import type { FeatureCollection, Feature, Polygon, MultiPolygon } from 'geojson';

// ============================================================================
// Re-export Provenance Types from Core (Single Source of Truth)
// ============================================================================

import type { ProvenanceMetadata } from '../core/types.js';
export type { ProvenanceMetadata };
// Canonical ValidationResult imported from core/city-target.ts
import type { ValidationResult } from '../core/city-target.js';
export type { ValidationResult };

/**
 * Raw dataset from acquisition layer
 */
export interface RawDataset {
  readonly geojson: FeatureCollection;
  readonly provenance: ProvenanceMetadata;
}

/**
 * Validation context for district count checks
 */
export interface ValidationContext {
  readonly jurisdiction: string;
  readonly expectedDistrictCount?: number;
  readonly districtType: 'council' | 'ward' | 'municipal';
}

/**
 * Normalized district (output of validation + normalization)
 */
export interface NormalizedDistrict {
  readonly id: string;              // Globally unique: "{country}-{state}-{city}-{district}"
  readonly name: string;            // Human-readable
  readonly jurisdiction: string;    // "USA/Hawaii/Honolulu"
  readonly districtType: 'council' | 'ward' | 'municipal';
  readonly geometry: Polygon | MultiPolygon;
  readonly provenance: ProvenanceMetadata;
  readonly bbox: readonly [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
}

/**
 * Bounding box
 */
export interface BoundingBox {
  readonly minLon: number;
  readonly maxLon: number;
  readonly minLat: number;
  readonly maxLat: number;
}

/**
 * Merkle proof for client verification
 */
export interface MerkleProof {
  readonly root: string;           // Hex string
  readonly leaf: string;           // Hex string
  readonly siblings: readonly string[];  // Hex strings
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

/**
 * SQLite database schema types
 */
export interface DistrictRecord {
  readonly id: string;
  readonly name: string;
  readonly jurisdiction: string;
  readonly district_type: string;
  readonly geometry: string;       // JSON-serialized GeoJSON
  readonly provenance: string;     // JSON-serialized ProvenanceMetadata
  readonly min_lon: number;
  readonly min_lat: number;
  readonly max_lon: number;
  readonly max_lat: number;
}

/**
 * Transformation result (output of entire pipeline)
 */
export interface TransformationResult {
  readonly merkleRoot: string;
  readonly ipfsCID: string;
  readonly databasePath: string;
  readonly districtCount: number;
  readonly timestamp: number;
  readonly snapshotId: string;
}

/**
 * Transformation metadata (audit trail)
 */
export interface TransformationMetadata {
  readonly snapshotId: string;
  readonly inputPath: string;
  readonly outputPath: string;
  readonly rawDatasetCount: number;
  readonly validatedCount: number;
  readonly normalizedCount: number;
  readonly rejectionReasons: Record<string, number>;
  readonly rejectionSamples: readonly RejectionSample[];
  readonly merkleRoot: string;
  readonly ipfsCID: string;
  readonly transformationDuration: number; // milliseconds
  readonly transformationCommit: string;   // Git commit hash
  readonly timestamp: number;
}

/**
 * Pipeline stage result
 */
export interface StageResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
  readonly duration: number; // milliseconds
}

/**
 * Rejection sample for debugging
 */
export interface RejectionSample {
  readonly id: string;
  readonly reason: string;
  readonly details: string;
}

/**
 * Rejection statistics with samples
 */
export interface RejectionStats {
  readonly total: number;
  readonly byReason: Record<string, number>;
  readonly samples: readonly RejectionSample[];
}

/**
 * Validation statistics
 */
export interface ValidationStats {
  readonly total: number;
  readonly passed: number;
  readonly rejected: number;
  readonly warnings: number;
  readonly rejectionReasons: Record<string, number>;
}

/**
 * Normalization statistics
 */
export interface NormalizationStats {
  readonly total: number;
  readonly normalized: number;
  readonly avgVertexCountBefore: number;
  readonly avgVertexCountAfter: number;
  readonly simplificationRatio: number;
}

/**
 * IPFS publication result
 */
export interface IPFSPublication {
  readonly cid: string;
  readonly ipns?: string;
  readonly timestamp: number;
  readonly size: number; // bytes
  readonly pinned: boolean;
}
