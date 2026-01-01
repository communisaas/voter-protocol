/**
 * ShadowAtlasService Types
 *
 * Types for the unified facade service that orchestrates
 * extraction, validation, and commitment pipelines.
 */

import type { TransformationValidationResult } from './transformation.js';
import type { LegislativeLayerType } from './atlas.js';

/**
 * Extraction scope types
 */
export type ExtractionScope =
  | { readonly type: 'state'; readonly states: readonly string[] }
  | { readonly type: 'country'; readonly country: string }
  | { readonly type: 'region'; readonly regions: readonly RegionConfig[] }
  | { readonly type: 'global' };

export interface RegionConfig {
  readonly state: string;
  readonly layers?: readonly LegislativeLayerType[];
}

export interface IncrementalScope {
  readonly states?: readonly string[];
  readonly layers?: readonly LegislativeLayerType[];
  readonly since?: Date;
}

/**
 * Extraction options
 */
export interface ExtractionOptions {
  readonly validation?: ValidationOptions;
  readonly concurrency?: number;
  readonly continueOnError?: boolean;
  readonly minPassRate?: number;
  readonly storage?: StorageConfig;
  readonly resumeFromJob?: string;
  readonly onProgress?: (progress: ProgressEvent) => void;
}

export interface ValidationOptions {
  readonly crossValidate?: boolean;
  readonly minConfidence?: number;
  readonly storeResults?: boolean;
}

export interface StorageConfig {
  readonly storeDir: string;
  readonly persistJobState?: boolean;
}

export interface ProgressEvent {
  readonly completed: number;
  readonly total: number;
  readonly currentItem: string;
}

/**
 * Pipeline result types
 */
export interface PipelineResult {
  readonly jobId: string;
  readonly status: 'committed' | 'validation_failed' | 'extraction_failed';
  readonly duration: number;
  readonly extraction: ExtractionSummary;
  readonly validation: ValidationSummary;
  readonly commitment?: CommitmentResult;
}

export interface ExtractionSummary {
  readonly totalBoundaries: number;
  readonly successfulExtractions: number;
  readonly failedExtractions: readonly ExtractionFailure[];
}

export interface ExtractionFailure {
  readonly state: string;
  readonly layer: LegislativeLayerType;
  readonly error: string;
  readonly timestamp: string;
}

export interface ValidationSummary {
  readonly passed: number;
  readonly warned: number;
  readonly failed: number;
  readonly passRate: number;
  readonly results: ReadonlyMap<string, TransformationValidationResult>;
}

export interface CommitmentResult {
  readonly snapshotId: string;
  readonly merkleRoot: string;
  readonly ipfsCID: string;
  readonly includedBoundaries: number;
  readonly excludedBoundaries: number;
}

/**
 * Incremental update types
 */
export interface IncrementalResult {
  readonly status: 'updated' | 'unchanged' | 'no_changes';
  readonly previousRoot: string;
  readonly newRoot: string;
  readonly changes: readonly string[];
  readonly stats?: {
    readonly added: number;
    readonly updated: number;
    readonly unchanged: number;
  };
}

export interface IncrementalOptions extends ExtractionOptions {
  readonly forceRefresh?: boolean;
}

/**
 * Change detection types
 */
export interface ChangeDetectionResult {
  readonly hasChanges: boolean;
  readonly changedRegions: readonly string[];
  readonly unchangedRegions: readonly string[];
  readonly checkMethod: 'etag' | 'last-modified' | 'count' | 'hash';
  readonly confidence: number;
}

/**
 * Health check types
 */
export interface HealthCheckResult {
  readonly healthy: boolean;
  readonly providers: readonly ProviderHealth[];
  readonly checkedAt: Date;
}

export interface ProviderHealth {
  readonly name: string;
  readonly available: boolean;
  readonly latencyMs: number;
  readonly lastSuccessfulExtraction?: Date;
  readonly issues: readonly string[];
}

/**
 * Job state for resume capability
 */
export interface JobState {
  readonly jobId: string;
  readonly scope: ExtractionScope;
  readonly options: ExtractionOptions;
  readonly startedAt: Date;
  readonly completedScopes: readonly string[];
  readonly failedScopes: readonly string[];
  readonly status: 'in_progress' | 'completed' | 'failed' | 'paused';
}

/**
 * Snapshot metadata for incremental updates
 */
export interface SnapshotMetadata {
  readonly id: string;
  readonly merkleRoot: string;
  readonly ipfsCID: string;
  readonly boundaryCount: number;
  readonly createdAt: Date;
  readonly regions: readonly string[];
  readonly globalReplication?: {
    readonly totalReplicas: number;
    readonly healthyReplicas: number;
    readonly replicatedRegions: readonly string[];
  };
}
