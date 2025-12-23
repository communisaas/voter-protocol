/**
 * Batch Orchestrator Type Definitions
 *
 * Nuclear-level type safety for production job orchestration.
 * No `any`, no loose casts, no exceptions.
 */

import type { LegislativeLayerType } from '../registry/state-gis-portals.js';

// ============================================================================
// Job State Types
// ============================================================================

/**
 * Job status lifecycle
 */
export type JobStatus =
  | 'pending'       // Job created, not started
  | 'running'       // Currently executing
  | 'partial'       // Some tasks failed, continue possible
  | 'completed'     // All tasks succeeded
  | 'failed'        // Unrecoverable failure
  | 'cancelled';    // User cancelled

/**
 * Job scope - what to extract
 */
export interface JobScope {
  readonly states: readonly string[];
  readonly layers: readonly LegislativeLayerType[];
}

/**
 * Completed extraction record
 */
export interface CompletedExtraction {
  readonly state: string;
  readonly layer: LegislativeLayerType;
  readonly completedAt: Date;
  readonly boundaryCount: number;
  readonly validationPassed: boolean;
}

/**
 * Extraction failure record
 */
export interface ExtractionFailure {
  readonly state: string;
  readonly layer: LegislativeLayerType;
  readonly failedAt: Date;
  readonly error: string;
  readonly attemptCount: number;
  readonly retryable: boolean;
}

/**
 * Not configured task record
 *
 * Tracks states/layers that were requested but are not configured in the registry.
 * Enables pre-flight validation and accurate coverage calculation.
 */
export interface NotConfiguredTask {
  readonly state: string;
  readonly layer: LegislativeLayerType;
  readonly reason: 'state_not_in_registry' | 'layer_not_configured';
  readonly checkedAt: Date;
}

/**
 * Job progress tracking
 */
export interface JobProgress {
  readonly totalTasks: number;
  readonly completedTasks: number;
  readonly failedTasks: number;
  readonly currentTask?: string;
}

/**
 * Complete job state
 */
export interface JobState {
  readonly jobId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly status: JobStatus;
  readonly scope: JobScope;
  readonly progress: JobProgress;
  readonly completedExtractions: readonly CompletedExtraction[];
  readonly failures: readonly ExtractionFailure[];
  readonly notConfiguredTasks: readonly NotConfiguredTask[];
  readonly options: OrchestrationOptions;
}

/**
 * Job summary for listing
 */
export interface JobSummary {
  readonly jobId: string;
  readonly createdAt: Date;
  readonly status: JobStatus;
  readonly scope: JobScope;
  readonly progress: JobProgress;
  readonly durationMs?: number;
}

// ============================================================================
// Orchestration Configuration
// ============================================================================

/**
 * Orchestration options
 */
export interface OrchestrationOptions {
  /** Maximum concurrent extractions (default: 5) */
  readonly concurrency?: number;

  /** Continue on partial failure vs fail-fast (default: true) */
  readonly continueOnError?: boolean;

  /** Maximum retry attempts per state (default: 3) */
  readonly maxRetries?: number;

  /** Delay between retries in ms (default: 2000) */
  readonly retryDelayMs?: number;

  /** Run validation after extraction (default: true) */
  readonly validateAfterExtraction?: boolean;

  /** Rate limit delay between tasks in ms (default: 500) */
  readonly rateLimitMs?: number;

  /** Callback for progress updates */
  readonly onProgress?: (progress: ProgressUpdate) => void;
}

/**
 * Default orchestration options
 */
export const DEFAULT_ORCHESTRATION_OPTIONS: Required<
  Omit<OrchestrationOptions, 'onProgress'>
> = {
  concurrency: 5,
  continueOnError: true,
  maxRetries: 3,
  retryDelayMs: 2000,
  validateAfterExtraction: true,
  rateLimitMs: 500,
};

/**
 * Progress update event
 */
export interface ProgressUpdate {
  readonly jobId: string;
  readonly task: string;
  readonly status: 'started' | 'completed' | 'failed';
  readonly progress: JobProgress;
  readonly error?: string;
}

// ============================================================================
// Orchestration Results
// ============================================================================

/**
 * Orchestration result
 */
export interface OrchestrationResult {
  readonly jobId: string;
  readonly status: JobStatus;
  readonly completedExtractions: readonly CompletedExtraction[];
  readonly failures: readonly ExtractionFailure[];
  readonly statistics: OrchestrationStatistics;
  readonly durationMs: number;
}

/**
 * Orchestration statistics
 */
export interface OrchestrationStatistics {
  readonly totalTasks: number;
  readonly successfulTasks: number;
  readonly failedTasks: number;
  readonly notConfiguredTasks: number;
  readonly expectedBoundaries: number;
  readonly totalBoundaries: number;
  readonly validationsPassed: number;
  readonly validationsFailed: number;
  readonly coveragePercent: number;
}

// ============================================================================
// Internal Task Types
// ============================================================================

/**
 * Extraction task
 */
export interface ExtractionTask {
  readonly state: string;
  readonly layer: LegislativeLayerType;
  readonly taskId: string;
}

/**
 * Task execution result
 */
export interface TaskExecutionResult {
  readonly task: ExtractionTask;
  readonly success: boolean;
  readonly boundaryCount?: number;
  readonly validationPassed?: boolean;
  readonly error?: string;
  readonly attemptCount: number;
}

// ============================================================================
// Job State Updates
// ============================================================================

/**
 * Progress update data
 */
export interface ProgressUpdateData {
  readonly currentTask?: string;
  readonly completedTasks?: number;
  readonly failedTasks?: number;
}

/**
 * Job state update
 */
export interface JobStateUpdate {
  readonly status?: JobStatus;
  readonly progress?: ProgressUpdateData;
}

// ============================================================================
// Statewide Ward Extraction Types
// ============================================================================

/**
 * Supported states for statewide ward extraction
 */
export type StatewideWardState = 'WI' | 'MA';

/**
 * Statewide ward extraction options
 */
export interface StatewideWardExtractionOptions {
  /** Output directory (default: .shadow-atlas/statewide-wards) */
  readonly outputDir?: string;

  /** Skip download if shapefile already exists (default: false) */
  readonly skipDownload?: boolean;

  /** Dry run - show extraction plan without downloading (default: false) */
  readonly dryRun?: boolean;

  /** Progress callback */
  readonly onProgress?: (progress: StatewideWardProgress) => void;
}

/**
 * Progress update for statewide ward extraction
 */
export interface StatewideWardProgress {
  readonly state: StatewideWardState;
  readonly step: 'downloading' | 'extracting' | 'converting' | 'splitting' | 'processing' | 'completed';
  readonly message: string;
  readonly current?: number;
  readonly total?: number;
}

/**
 * Extracted city ward data
 */
export interface CityWardData {
  readonly fips: string;
  readonly name: string;
  readonly state: string;
  readonly wardCount: number;
  readonly outputPath: string;
  readonly source: string;
  readonly confidence: number;
}

/**
 * Statewide ward extraction result
 */
export interface StatewideWardExtractionResult {
  readonly state: StatewideWardState;
  readonly stateName: string;
  readonly extractedAt: string;
  readonly citiesExtracted: number;
  readonly expectedCities: number;
  readonly cities: readonly CityWardData[];
  readonly registryEntriesPath: string;
  readonly summaryPath: string;
}
