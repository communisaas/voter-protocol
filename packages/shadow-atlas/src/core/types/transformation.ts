/**
 * Transformation Pipeline Types
 *
 * Types for the multi-stage transformation pipeline that converts
 * raw boundary data into validated, normalized districts.
 */

import type { Polygon, MultiPolygon, FeatureCollection } from 'geojson';
import type { ProvenanceMetadata } from './provenance.js';

/**
 * Raw dataset from acquisition layer
 */
export interface RawDataset {
  readonly geojson: FeatureCollection;
  readonly provenance: ProvenanceMetadata;
}

/**
 * Transformation validation result
 * For validating processed district data (distinct from provider validation)
 */
export interface TransformationValidationResult {
  readonly valid: boolean;
  readonly confidence: number;  // 0-100
  readonly issues: readonly string[];
  readonly warnings: readonly string[];
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
 * Bounding Box (extended version from transformation pipeline)
 */
export interface BoundingBox {
  readonly minLon: number;
  readonly maxLon: number;
  readonly minLat: number;
  readonly maxLat: number;
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
