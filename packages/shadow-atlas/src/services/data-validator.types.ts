/**
 * DataValidator Type Definitions
 *
 * Comprehensive type system for Shadow Atlas validation infrastructure.
 * Consolidates validation logic from scripts into reusable, type-safe interfaces.
 *
 * TYPE SAFETY: Nuclear-level strictness. Zero `any`, zero `@ts-ignore`.
 * Every validation result must be comprehensively typed for audit trail.
 */

import type { LegislativeLayerType } from '../core/registry/state-gis-portals.js';
import type { TIGERBoundaryType } from '../provenance/tiger-authority-rules.js';
import type { ExtractedBoundary, BatchExtractionResult } from '../providers/state-batch-extractor.js';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Validation options for data validator
 */
export interface ValidationOptions {
  /** Include geometry validation (gaps, overlaps, coordinate systems) */
  readonly includeGeometry?: boolean;

  /** Include GEOID format validation */
  readonly includeGEOIDValidation?: boolean;

  /** Include cross-validation against TIGERweb API */
  readonly includeTIGERCrossValidation?: boolean;

  /** Date to use for authority resolution freshness scoring */
  readonly authorityAsOf?: Date;

  /** Rate limit delay between API calls (ms) */
  readonly rateLimitMs?: number;

  /** Number of retry attempts for failed API calls */
  readonly retryAttempts?: number;
}

/**
 * Cross-validation options
 */
export interface CrossValidationOptions {
  /** TIGERweb API timeout (ms) */
  readonly timeoutMs?: number;

  /** Rate limit delay between requests (ms) */
  readonly rateLimitMs?: number;

  /** Include geometry comparison (computationally expensive) */
  readonly includeGeometryComparison?: boolean;

  /** GEOID tolerance (for minor format variations) */
  readonly geoidTolerance?: boolean;
}

// ============================================================================
// Validation Result Types
// ============================================================================

/**
 * Registry validation result
 *
 * Compares extracted boundary counts against expected counts from registry.
 */
export interface RegistryValidationResult {
  /** Overall validation status */
  readonly passed: boolean;

  /** Total states validated */
  readonly totalStates: number;

  /** States with exact count matches */
  readonly matchedStates: number;

  /** States with count mismatches */
  readonly mismatchedStates: number;

  /** Detailed mismatches */
  readonly mismatches: readonly CountMismatch[];

  /** Validation timestamp */
  readonly validatedAt: Date;

  /** Confidence score (0.0-1.0) */
  readonly confidence: number;
}

/**
 * Count mismatch between expected and actual
 */
export interface CountMismatch {
  /** State code (e.g., "WI") */
  readonly state: string;

  /** Layer type */
  readonly layer: LegislativeLayerType;

  /** Expected count from registry */
  readonly expected: number;

  /** Actual count from extraction */
  readonly actual: number;

  /** Absolute difference */
  readonly discrepancy: number;

  /** Possible causes for discrepancy */
  readonly possibleCauses: readonly string[];

  /** Severity level */
  readonly severity: 'critical' | 'warning' | 'info';
}

/**
 * Cross-validation result
 *
 * Compares state portal data against TIGERweb API ground truth.
 */
export interface CrossValidationResult {
  /** Overall validation status */
  readonly passed: boolean;

  /** State code */
  readonly state: string;

  /** Layer type */
  readonly layer: LegislativeLayerType;

  /** Source description (state portal) */
  readonly stateSource: string;

  /** Source description (TIGERweb) */
  readonly tigerSource: string;

  /** Total boundaries in state source */
  readonly stateBoundaryCount: number;

  /** Total boundaries in TIGER source */
  readonly tigerBoundaryCount: number;

  /** Number of matching boundaries */
  readonly matches: number;

  /** Number of discrepancies */
  readonly discrepancyCount: number;

  /** Detailed discrepancies */
  readonly discrepancies: readonly CrossValidationDiscrepancy[];

  /** Confidence score (0.0-1.0) */
  readonly confidence: number;

  /** Validation timestamp */
  readonly validatedAt: Date;

  /** Duration (ms) */
  readonly durationMs: number;
}

/**
 * Cross-validation discrepancy
 */
export interface CrossValidationDiscrepancy {
  /** Boundary identifier */
  readonly boundaryId: string;

  /** Discrepancy type */
  readonly type: 'count' | 'geometry' | 'geoid' | 'name' | 'missing';

  /** Value from TIGER source */
  readonly tigerValue: unknown;

  /** Value from state source */
  readonly stateValue: unknown;

  /** Severity level */
  readonly severity: 'critical' | 'warning' | 'info';

  /** Explanation of discrepancy */
  readonly explanation: string;
}

/**
 * Geometry validation result
 */
export interface GeometryValidationResult {
  /** Overall validation status */
  readonly passed: boolean;

  /** Total boundaries validated */
  readonly totalBoundaries: number;

  /** Boundaries with valid geometry */
  readonly validGeometry: number;

  /** Boundaries with gaps detected */
  readonly gapsDetected: number;

  /** Boundaries with overlaps detected */
  readonly overlapsDetected: number;

  /** Boundaries with invalid coordinates */
  readonly invalidCoordinates: number;

  /** Coordinate system issues */
  readonly coordinateSystemIssues: readonly string[];

  /** Detailed issues */
  readonly issues: readonly GeometryIssue[];

  /** Confidence score (0.0-1.0) */
  readonly confidence: number;
}

/**
 * Geometry issue
 */
export interface GeometryIssue {
  /** Boundary identifier */
  readonly boundaryId: string;

  /** Issue type */
  readonly type: 'gap' | 'overlap' | 'invalid-coordinates' | 'self-intersection' | 'coordinate-system' | 'unclosed-ring' | 'hole-overlap' | 'bowtie';

  /** Severity level */
  readonly severity: 'critical' | 'warning' | 'info';

  /** Description */
  readonly description: string;

  /** Suggested fix (if known) */
  readonly suggestedFix?: string;

  /** Location of the issue (if applicable) */
  readonly location?: {
    readonly lat: number;
    readonly lon: number;
  };
}

/**
 * Mismatch diagnostic result
 *
 * Investigates causes of count mismatches (ZZ districts, multi-member systems).
 */
export interface MismatchDiagnostic {
  /** State code */
  readonly state: string;

  /** State name */
  readonly stateName: string;

  /** Layer type */
  readonly layer: LegislativeLayerType;

  /** Expected count */
  readonly expectedCount: number;

  /** Actual count */
  readonly actualCount: number;

  /** Discrepancy */
  readonly discrepancy: number;

  /** Diagnosis type */
  readonly diagnosis: DiagnosisType;

  /** Detailed analysis */
  readonly details: {
    /** Extra features found (not in expected set) */
    readonly extraFeatures: readonly ExtraFeatureInfo[];

    /** Missing features (in expected set, not found) */
    readonly missingFeatures: readonly string[];

    /** ZZ districts (water/unpopulated areas) */
    readonly zzDistricts: readonly ZZDistrictInfo[];

    /** Multi-member districts */
    readonly multiMemberDistricts: readonly MultiMemberDistrictInfo[];

    /** Redistricting status */
    readonly redistrictingInProgress: boolean;
  };

  /** Recommendation for resolution */
  readonly recommendation: string;

  /** Confidence in diagnosis (0.0-1.0) */
  readonly confidence: number;
}

/**
 * Diagnosis type classification
 */
export type DiagnosisType =
  | 'zz_water_districts'
  | 'multi_member_districts'
  | 'redistricting_in_progress'
  | 'stale_data'
  | 'data_quality_issue'
  | 'unknown';

/**
 * Extra feature information
 */
export interface ExtraFeatureInfo {
  /** Feature identifier */
  readonly id: string;

  /** Feature name */
  readonly name: string;

  /** Why this is considered "extra" */
  readonly reason: string;

  /** Whether this is expected (e.g., ZZ district) */
  readonly isExpected: boolean;
}

/**
 * ZZ district information
 *
 * ZZ districts are special codes for water bodies or unpopulated areas
 * that don't elect representatives but appear in boundary datasets.
 */
export interface ZZDistrictInfo {
  /** District identifier */
  readonly id: string;

  /** District name */
  readonly name: string;

  /** GEOID */
  readonly geoid: string;

  /** Type (water, uninhabited, etc.) */
  readonly type: 'water' | 'uninhabited' | 'unknown';
}

/**
 * Multi-member district information
 *
 * Some states (e.g., West Virginia) have multi-member districts where
 * a single district elects multiple representatives.
 */
export interface MultiMemberDistrictInfo {
  /** District identifier */
  readonly id: string;

  /** District name */
  readonly name: string;

  /** Number of members elected from this district */
  readonly memberCount: number;

  /** GEOIDs for each member seat */
  readonly memberGeoids: readonly string[];
}

// ============================================================================
// Stored Results Types
// ============================================================================

/**
 * Complete validation results for storage
 */
export interface ValidationResults {
  /** Job identifier */
  readonly jobId: string;

  /** Registry validation results */
  readonly registryValidation?: RegistryValidationResult;

  /** Cross-validation results */
  readonly crossValidation?: readonly CrossValidationResult[];

  /** Geometry validation results */
  readonly geometryValidation?: GeometryValidationResult;

  /** Mismatch diagnostics */
  readonly mismatchDiagnostics?: readonly MismatchDiagnostic[];

  /** Overall summary */
  readonly summary: {
    readonly totalValidations: number;
    readonly passedValidations: number;
    readonly failedValidations: number;
    readonly overallConfidence: number;
  };

  /** Validation timestamp */
  readonly validatedAt: Date;

  /** Total duration (ms) */
  readonly totalDurationMs: number;
}

/**
 * Stored validation results (includes metadata)
 */
export interface StoredValidationResults extends ValidationResults {
  /** Storage metadata */
  readonly metadata: {
    readonly storedAt: Date;
    readonly storageVersion: string;
    readonly schemaVersion: number;
  };
}

// ============================================================================
// Multi-State Validation Types
// ============================================================================

/**
 * Multi-state validation options
 */
export interface MultiStateValidationOptions {
  /** Rate limit delay between API calls (ms) */
  readonly rateLimitMs?: number;

  /** Number of retry attempts for failed API calls */
  readonly retryAttempts?: number;

  /** Timeout for each API request (ms) */
  readonly timeoutMs?: number;

  /** Layers to validate (defaults to all 3 layers) */
  readonly layers?: readonly LegislativeLayerType[];
}

/**
 * State configuration for multi-state validation
 */
export interface StateConfig {
  readonly state: string;
  readonly stateName: string;
  readonly stateFips: string;
  readonly layers: {
    readonly congressional: number;
    readonly state_senate: number;
    readonly state_house: number;
    readonly county?: number;
  };
}

/**
 * Single state layer validation result
 */
export interface StateLayerValidationResult {
  readonly state: string;
  readonly stateName: string;
  readonly layer: LegislativeLayerType;
  readonly expected: number;
  readonly actual: number;
  readonly match: boolean;
  readonly geoidValid: boolean;
  readonly geometryValid: boolean;
  readonly error?: string;
  readonly duration: number;
  readonly details: {
    readonly geoids: readonly string[];
    readonly invalidGeoids: readonly string[];
  };
}

/**
 * Multi-state validation result
 */
export interface MultiStateValidationResult {
  readonly states: readonly StateLayerValidationResult[];
  readonly summary: {
    readonly totalValidations: number;
    readonly passed: number;
    readonly failed: number;
    readonly successRate: number;
  };
  readonly validatedAt: Date;
  readonly totalDurationMs: number;
}

// ============================================================================
// GEOID Validation Types
// ============================================================================

/**
 * GEOID validation result for a single GEOID
 */
export interface GeoidValidationResult {
  readonly geoid: string;
  readonly valid: boolean;
  readonly expectedPattern: string;
  readonly error?: string;
}

/**
 * Batch GEOID validation result
 */
export interface BatchGeoidValidationResult {
  readonly totalGeoids: number;
  readonly validGeoids: number;
  readonly invalidGeoids: number;
  readonly invalidRecords: readonly GeoidValidationResult[];
  readonly passed: boolean;
}

// ============================================================================
// Coverage Validation Types
// ============================================================================

/**
 * Coverage validation result
 */
export interface CoverageValidationResult {
  readonly totalArea: number;
  readonly averageDistrictArea: number;
  readonly boundaryCount: number;
  readonly passed: boolean;
  readonly error?: string;
}

// ============================================================================
// Internal Types
// ============================================================================

/**
 * TIGERweb API response (simplified)
 */
export interface TIGERwebFeature {
  readonly attributes: Record<string, unknown>;
  readonly geometry?: unknown;
}

/**
 * TIGERweb API response
 */
export interface TIGERwebResponse {
  readonly features: readonly TIGERwebFeature[];
  readonly exceededTransferLimit?: boolean;
}

/**
 * Validation job metadata
 */
export interface ValidationJobMetadata {
  readonly jobId: string;
  readonly startedAt: Date;
  readonly completedAt?: Date;
  readonly status: 'pending' | 'in-progress' | 'completed' | 'failed';
  readonly error?: string;
}

// ============================================================================
// Multi-State Report Types
// ============================================================================

/**
 * Report output format
 */
export type ReportFormat = 'json' | 'markdown' | 'csv';

/**
 * Multi-state validation report
 *
 * Human-readable QA audit trail for multi-state validation runs.
 * Includes summary statistics, per-state details, and recommendations.
 */
export interface MultiStateReport {
  /** Report generation timestamp */
  readonly generatedAt: Date;

  /** Report schema version */
  readonly reportVersion: string;

  /** Executive summary */
  readonly summary: ReportSummary;

  /** Per-state validation details */
  readonly states: readonly StateReport[];

  /** Actionable recommendations based on results */
  readonly recommendations: readonly string[];
}

/**
 * Report summary statistics
 */
export interface ReportSummary {
  /** Total states validated */
  readonly totalStates: number;

  /** States that passed all validations */
  readonly passedStates: number;

  /** States with validation failures */
  readonly failedStates: number;

  /** Success rate (0.0-1.0) */
  readonly successRate: number;

  /** Total legislative layers validated */
  readonly totalLayers: number;

  /** Number of critical issues found */
  readonly criticalIssues: number;

  /** Number of warnings found */
  readonly warnings: number;
}

/**
 * Per-state validation report
 */
export interface StateReport {
  /** State code (e.g., "WI") */
  readonly state: string;

  /** Full state name */
  readonly stateName: string;

  /** Overall pass/fail status for state */
  readonly passed: boolean;

  /** Per-layer validation results */
  readonly layers: readonly LayerReport[];

  /** Issues found for this state */
  readonly issues: readonly string[];
}

/**
 * Per-layer validation report
 */
export interface LayerReport {
  /** Legislative layer type */
  readonly layer: LegislativeLayerType;

  /** Expected boundary count from registry */
  readonly expected: number;

  /** Actual boundary count from TIGERweb */
  readonly actual: number;

  /** Whether counts match */
  readonly match: boolean;

  /** Whether GEOIDs are valid */
  readonly geoidValid: boolean;

  /** Whether geometry is valid */
  readonly geometryValid: boolean;

  /** Validation duration (ms) */
  readonly duration: number;
}
