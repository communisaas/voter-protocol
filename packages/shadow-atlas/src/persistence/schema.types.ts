/**
 * Shadow Atlas Persistence Schema Types
 *
 * Nuclear-level type safety for database operations.
 * All types match schema.sql exactly - no loose casts, no `any`.
 *
 * Design principles:
 *   1. Branded types for IDs prevent mixing different entity references
 *   2. ISO8601 timestamp strings (not Date objects - DB format)
 *   3. Readonly properties for immutable database rows
 *   4. Separate Insert/Update types from Row types
 *   5. Explicit null handling (not undefined)
 */

// ============================================================================
// Branded ID Types - Prevent mixing entity references
// ============================================================================

declare const JobIdBrand: unique symbol;
declare const ExtractionIdBrand: unique symbol;
declare const FailureIdBrand: unique symbol;
declare const NotConfiguredIdBrand: unique symbol;
declare const SnapshotIdBrand: unique symbol;
declare const ValidationResultIdBrand: unique symbol;

export type JobId = string & { readonly [JobIdBrand]: typeof JobIdBrand };
export type ExtractionId = string & { readonly [ExtractionIdBrand]: typeof ExtractionIdBrand };
export type FailureId = string & { readonly [FailureIdBrand]: typeof FailureIdBrand };
export type NotConfiguredId = string & { readonly [NotConfiguredIdBrand]: typeof NotConfiguredIdBrand };
export type SnapshotId = string & { readonly [SnapshotIdBrand]: typeof SnapshotIdBrand };
export type ValidationResultId = string & { readonly [ValidationResultIdBrand]: typeof ValidationResultIdBrand };

// ============================================================================
// Enum Types - Match CHECK constraints in schema
// ============================================================================

export type JobStatus =
  | 'pending'
  | 'running'
  | 'partial'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type LegislativeLayerType =
  | 'congressional'
  | 'state_senate'
  | 'state_house'
  | 'county'
  | 'city';

export type NotConfiguredReason =
  | 'state_not_in_registry'
  | 'layer_not_configured';

export type ValidatorType =
  | 'tiger_census'
  | 'official_district_count'
  | 'cross_portal'
  | 'geometric_integrity';

export type SourceType =
  | 'arcgis'
  | 'wfs'
  | 'geojson';

// ============================================================================
// ISO8601 Timestamp Type - Database format
// ============================================================================

/**
 * ISO8601 timestamp string in UTC.
 * Example: "2025-12-17T10:30:00.000Z"
 *
 * Use `toISOString()` when inserting Date objects.
 * Use `new Date(timestamp)` when consuming.
 */
export type ISO8601Timestamp = string;

// ============================================================================
// Table Row Types - Immutable database records
// ============================================================================

export interface JobRow {
  readonly id: JobId;
  readonly scope_states: string; // JSON array of state codes
  readonly scope_layers: string; // JSON array of LegislativeLayerType
  readonly status: JobStatus;
  readonly created_at: ISO8601Timestamp;
  readonly started_at: ISO8601Timestamp | null;
  readonly updated_at: ISO8601Timestamp;
  readonly completed_at: ISO8601Timestamp | null;
  readonly archived_at: ISO8601Timestamp | null;
  readonly total_tasks: number;
  readonly completed_tasks: number;
  readonly failed_tasks: number;
  readonly skipped_tasks: number;
  readonly error_summary: string | null;
}

export interface ExtractionRow {
  readonly id: ExtractionId;
  readonly job_id: JobId;
  readonly state_code: string;
  readonly layer_type: LegislativeLayerType;
  readonly boundary_count: number;
  readonly validation_passed: boolean;
  readonly source_url: string | null;
  readonly source_type: SourceType | null;
  readonly completed_at: ISO8601Timestamp;
  readonly archived_at: ISO8601Timestamp | null;
}

export interface FailureRow {
  readonly id: FailureId;
  readonly job_id: JobId;
  readonly state_code: string;
  readonly layer_type: LegislativeLayerType;
  readonly error_message: string;
  readonly error_stack: string | null;
  readonly attempt_count: number;
  readonly retryable: boolean;
  readonly source_url: string | null;
  readonly source_type: SourceType | null;
  readonly failed_at: ISO8601Timestamp;
  readonly retry_after: ISO8601Timestamp | null;
  readonly retried_at: ISO8601Timestamp | null;
  readonly retry_succeeded: boolean | null;
  readonly archived_at: ISO8601Timestamp | null;
}

export interface NotConfiguredRow {
  readonly id: NotConfiguredId;
  readonly job_id: JobId;
  readonly state_code: string;
  readonly layer_type: LegislativeLayerType;
  readonly reason: NotConfiguredReason;
  readonly checked_at: ISO8601Timestamp;
  readonly resolved_at: ISO8601Timestamp | null;
  readonly resolved_by_job_id: JobId | null;
  readonly archived_at: ISO8601Timestamp | null;
}

export interface SnapshotRow {
  readonly id: SnapshotId;
  readonly job_id: JobId;
  readonly merkle_root: string;
  readonly ipfs_cid: string;
  readonly boundary_count: number;
  readonly regions: string; // JSON array of state codes
  readonly created_at: ISO8601Timestamp;
  readonly published_at: ISO8601Timestamp | null;
  readonly deprecated_at: ISO8601Timestamp | null;
  readonly archived_at: ISO8601Timestamp | null;
}

export interface SnapshotRegionRow {
  readonly snapshot_id: SnapshotId;
  readonly state_code: string;
}

export interface ValidationResultRow {
  readonly id: ValidationResultId;
  readonly extraction_id: ExtractionId;
  readonly validator_type: ValidatorType;
  readonly passed: boolean;
  readonly expected_count: number | null;
  readonly actual_count: number | null;
  readonly discrepancies: string | null; // JSON array of issues
  readonly authority_source: string | null;
  readonly authority_version: string | null;
  readonly validated_at: ISO8601Timestamp;
  readonly archived_at: ISO8601Timestamp | null;
}

// ============================================================================
// Insert Types - Data required for new records
// ============================================================================

export interface JobInsert {
  readonly id: JobId;
  readonly scope_states: string;
  readonly scope_layers: string;
  readonly status: JobStatus;
  readonly created_at: ISO8601Timestamp;
  readonly started_at?: ISO8601Timestamp | null;
  readonly updated_at: ISO8601Timestamp;
  readonly completed_at?: ISO8601Timestamp | null;
  readonly total_tasks?: number;
  readonly completed_tasks?: number;
  readonly failed_tasks?: number;
  readonly skipped_tasks?: number;
  readonly error_summary?: string | null;
}

export interface ExtractionInsert {
  readonly id: ExtractionId;
  readonly job_id: JobId;
  readonly state_code: string;
  readonly layer_type: LegislativeLayerType;
  readonly boundary_count: number;
  readonly validation_passed: boolean;
  readonly source_url?: string | null;
  readonly source_type?: SourceType | null;
  readonly completed_at: ISO8601Timestamp;
}

export interface FailureInsert {
  readonly id: FailureId;
  readonly job_id: JobId;
  readonly state_code: string;
  readonly layer_type: LegislativeLayerType;
  readonly error_message: string;
  readonly error_stack?: string | null;
  readonly attempt_count?: number;
  readonly retryable: boolean;
  readonly source_url?: string | null;
  readonly source_type?: SourceType | null;
  readonly failed_at: ISO8601Timestamp;
  readonly retry_after?: ISO8601Timestamp | null;
}

export interface NotConfiguredInsert {
  readonly id: NotConfiguredId;
  readonly job_id: JobId;
  readonly state_code: string;
  readonly layer_type: LegislativeLayerType;
  readonly reason: NotConfiguredReason;
  readonly checked_at: ISO8601Timestamp;
}

export interface SnapshotInsert {
  readonly id: SnapshotId;
  readonly job_id: JobId;
  readonly merkle_root: string;
  readonly ipfs_cid: string;
  readonly boundary_count: number;
  readonly regions: string;
  readonly created_at: ISO8601Timestamp;
}

export interface SnapshotRegionInsert {
  readonly snapshot_id: SnapshotId;
  readonly state_code: string;
}

export interface ValidationResultInsert {
  readonly id: ValidationResultId;
  readonly extraction_id: ExtractionId;
  readonly validator_type: ValidatorType;
  readonly passed: boolean;
  readonly expected_count?: number | null;
  readonly actual_count?: number | null;
  readonly discrepancies?: string | null;
  readonly authority_source?: string | null;
  readonly authority_version?: string | null;
  readonly validated_at: ISO8601Timestamp;
}

// ============================================================================
// Update Types - Mutable fields for existing records
// ============================================================================

export interface JobUpdate {
  readonly status?: JobStatus;
  readonly started_at?: ISO8601Timestamp | null;
  readonly updated_at: ISO8601Timestamp; // Always required
  readonly completed_at?: ISO8601Timestamp | null;
  readonly total_tasks?: number;
  readonly completed_tasks?: number;
  readonly failed_tasks?: number;
  readonly skipped_tasks?: number;
  readonly error_summary?: string | null;
  readonly archived_at?: ISO8601Timestamp | null;
}

export interface ExtractionUpdate {
  readonly archived_at?: ISO8601Timestamp | null;
}

export interface FailureUpdate {
  readonly retried_at?: ISO8601Timestamp | null;
  readonly retry_succeeded?: boolean | null;
  readonly archived_at?: ISO8601Timestamp | null;
}

export interface NotConfiguredUpdate {
  readonly resolved_at?: ISO8601Timestamp | null;
  readonly resolved_by_job_id?: JobId | null;
  readonly archived_at?: ISO8601Timestamp | null;
}

export interface SnapshotUpdate {
  readonly published_at?: ISO8601Timestamp | null;
  readonly deprecated_at?: ISO8601Timestamp | null;
  readonly archived_at?: ISO8601Timestamp | null;
}

export interface ValidationResultUpdate {
  readonly archived_at?: ISO8601Timestamp | null;
}

// ============================================================================
// View Types - Aggregated query results
// ============================================================================

export interface JobSummaryView {
  readonly id: JobId;
  readonly status: JobStatus;
  readonly created_at: ISO8601Timestamp;
  readonly started_at: ISO8601Timestamp | null;
  readonly completed_at: ISO8601Timestamp | null;
  readonly total_tasks: number;
  readonly completed_tasks: number;
  readonly failed_tasks: number;
  readonly skipped_tasks: number;
  readonly progress_ratio: number | null;
  readonly successful_extractions: number;
  readonly failed_attempts: number;
  readonly not_configured_count: number;
  readonly snapshots_created: number;
}

export interface ExtractionCoverageView {
  readonly state_code: string;
  readonly layer_type: LegislativeLayerType;
  readonly total_extractions: number;
  readonly validated_extractions: number;
  readonly latest_extraction: ISO8601Timestamp;
  readonly total_boundaries: number;
}

export interface RegistryGapView {
  readonly state_code: string;
  readonly layer_type: LegislativeLayerType;
  readonly reason: NotConfiguredReason;
  readonly occurrence_count: number;
  readonly latest_check: ISO8601Timestamp;
  readonly first_detected: ISO8601Timestamp;
}

export interface ValidationPatternView {
  readonly validator_type: ValidatorType;
  readonly state_code: string;
  readonly layer_type: LegislativeLayerType;
  readonly failure_count: number;
  readonly avg_discrepancy: number | null;
  readonly latest_failure: ISO8601Timestamp;
}

export interface ActiveSnapshotView {
  readonly id: SnapshotId;
  readonly merkle_root: string;
  readonly ipfs_cid: string;
  readonly boundary_count: number;
  readonly created_at: ISO8601Timestamp;
  readonly published_at: ISO8601Timestamp | null;
  readonly region_count: number;
  readonly covered_states: string; // Comma-separated state codes
}

// ============================================================================
// Parsed JSON Field Types - Strongly-typed parsed content
// ============================================================================

/**
 * Parsed scope from JobRow.scope_states
 */
export interface JobScope {
  readonly states: ReadonlyArray<string>;
  readonly layers: ReadonlyArray<LegislativeLayerType>;
}

/**
 * Parsed discrepancy from ValidationResultRow.discrepancies
 */
export interface ValidationDiscrepancy {
  readonly field: string;
  readonly expected: string | number;
  readonly actual: string | number;
  readonly severity: 'critical' | 'warning' | 'info';
}

/**
 * Parsed regions from SnapshotRow.regions
 */
export type SnapshotRegions = ReadonlyArray<string>;

// ============================================================================
// Type Guards - Runtime validation for branded types
// ============================================================================

export function isJobId(value: string): value is JobId {
  return typeof value === 'string' && value.length > 0;
}

export function isExtractionId(value: string): value is ExtractionId {
  return typeof value === 'string' && value.length > 0;
}

export function isFailureId(value: string): value is FailureId {
  return typeof value === 'string' && value.length > 0;
}

export function isNotConfiguredId(value: string): value is NotConfiguredId {
  return typeof value === 'string' && value.length > 0;
}

export function isSnapshotId(value: string): value is SnapshotId {
  return typeof value === 'string' && value.length > 0;
}

export function isValidationResultId(value: string): value is ValidationResultId {
  return typeof value === 'string' && value.length > 0;
}

export function isJobStatus(value: string): value is JobStatus {
  return [
    'pending',
    'running',
    'partial',
    'completed',
    'failed',
    'cancelled',
  ].includes(value);
}

export function isLegislativeLayerType(value: string): value is LegislativeLayerType {
  return [
    'congressional',
    'state_senate',
    'state_house',
    'county',
    'city',
  ].includes(value);
}

export function isNotConfiguredReason(value: string): value is NotConfiguredReason {
  return [
    'state_not_in_registry',
    'layer_not_configured',
  ].includes(value);
}

export function isValidatorType(value: string): value is ValidatorType {
  return [
    'tiger_census',
    'official_district_count',
    'cross_portal',
    'geometric_integrity',
  ].includes(value);
}

export function isSourceType(value: string): value is SourceType {
  return ['arcgis', 'wfs', 'geojson'].includes(value);
}

// ============================================================================
// Helper Functions - Safe type conversions
// ============================================================================

/**
 * Safely parse JSON scope from database string.
 * Throws on invalid format.
 */
export function parseJobScope(row: JobRow): JobScope {
  const states = JSON.parse(row.scope_states) as unknown;
  const layers = JSON.parse(row.scope_layers) as unknown;

  if (!Array.isArray(states) || !states.every((s): s is string => typeof s === 'string')) {
    throw new TypeError('Invalid scope_states format');
  }

  if (!Array.isArray(layers) || !layers.every(isLegislativeLayerType)) {
    throw new TypeError('Invalid scope_layers format');
  }

  return { states, layers };
}

/**
 * Safely parse validation discrepancies from database string.
 * Returns empty array if null or invalid.
 */
export function parseValidationDiscrepancies(
  row: ValidationResultRow
): ReadonlyArray<ValidationDiscrepancy> {
  if (row.discrepancies === null) {
    return [];
  }

  try {
    const parsed = JSON.parse(row.discrepancies) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is ValidationDiscrepancy => {
      return (
        typeof item === 'object' &&
        item !== null &&
        'field' in item &&
        'expected' in item &&
        'actual' in item &&
        'severity' in item &&
        typeof item.field === 'string' &&
        (typeof item.expected === 'string' || typeof item.expected === 'number') &&
        (typeof item.actual === 'string' || typeof item.actual === 'number') &&
        ['critical', 'warning', 'info'].includes(item.severity as string)
      );
    });
  } catch {
    return [];
  }
}

/**
 * Safely parse snapshot regions from database string.
 * Throws on invalid format.
 */
export function parseSnapshotRegions(row: SnapshotRow): SnapshotRegions {
  const parsed = JSON.parse(row.regions) as unknown;

  if (!Array.isArray(parsed) || !parsed.every((r): r is string => typeof r === 'string')) {
    throw new TypeError('Invalid regions format');
  }

  return parsed;
}

/**
 * Convert Date to ISO8601 timestamp string.
 */
export function toISO8601(date: Date): ISO8601Timestamp {
  return date.toISOString();
}

/**
 * Convert ISO8601 timestamp string to Date.
 */
export function fromISO8601(timestamp: ISO8601Timestamp): Date {
  return new Date(timestamp);
}

/**
 * Get current timestamp in ISO8601 format.
 */
export function nowISO8601(): ISO8601Timestamp {
  return new Date().toISOString();
}
// ============================================================================
// ID Generation - Crypto-safe UUIDs
// ============================================================================

import { randomUUID } from 'node:crypto';

export function generateJobId(): JobId {
  return randomUUID() as JobId;
}

export function generateExtractionId(): ExtractionId {
  return randomUUID() as ExtractionId;
}

export function generateFailureId(): FailureId {
  return randomUUID() as FailureId;
}

export function generateNotConfiguredId(): NotConfiguredId {
  return randomUUID() as NotConfiguredId;
}

export function generateSnapshotId(): SnapshotId {
  return randomUUID() as SnapshotId;
}

export function generateValidationResultId(): ValidationResultId {
  return randomUUID() as ValidationResultId;
}
