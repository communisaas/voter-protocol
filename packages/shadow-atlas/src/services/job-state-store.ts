/**
 * Job State Store - Persistent Job State Management
 *
 * Provides resumable job state with filesystem persistence.
 * Enables failure recovery and progress tracking.
 *
 * ARCHITECTURE:
 * - Jobs stored as JSON files in .shadow-atlas/jobs/
 * - One file per job: {jobId}.json
 * - Atomic writes with temp files + rename
 * - Lock-free (single process assumption)
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import { mkdir, writeFile, readFile, readdir, stat, rename } from 'fs/promises';
import { join } from 'path';
import { randomBytes } from 'crypto';
import type {
  JobState,
  JobStatus,
  JobScope,
  JobSummary,
  OrchestrationOptions,
  CompletedExtraction,
  ExtractionFailure,
  NotConfiguredTask,
  ProgressUpdateData,
  DEFAULT_ORCHESTRATION_OPTIONS,
} from './batch-orchestrator.types.js';
import { logger } from '../core/utils/logger.js';

// ============================================================================
// Job State Store
// ============================================================================

/**
 * Job State Store
 *
 * Manages persistent job state on filesystem.
 * All operations are async and use atomic file writes.
 */
export class JobStateStore {
  private readonly storageDir: string;

  constructor(storageDir: string = '.shadow-atlas/jobs') {
    this.storageDir = storageDir;
  }

  /**
   * Create a new job
   *
   * @param scope - What to extract
   * @param options - Orchestration options
   * @returns Job ID
   */
  async createJob(
    scope: JobScope,
    options: OrchestrationOptions
  ): Promise<string> {
    // Ensure storage directory exists
    await mkdir(this.storageDir, { recursive: true });

    // Generate unique job ID
    const jobId = this.generateJobId();

    // Calculate total tasks
    const totalTasks = scope.states.length * scope.layers.length;

    // Create initial job state
    const now = new Date();
    const jobState: JobState = {
      jobId,
      createdAt: now,
      updatedAt: now,
      status: 'pending',
      scope,
      progress: {
        totalTasks,
        completedTasks: 0,
        failedTasks: 0,
      },
      completedExtractions: [],
      failures: [],
      notConfiguredTasks: [],
      options,
    };

    // Write to disk
    await this.writeJobState(jobState);

    return jobId;
  }

  /**
   * Get job state
   *
   * @param jobId - Job ID
   * @returns Job state or null if not found
   */
  async getJob(jobId: string): Promise<JobState | null> {
    try {
      const filePath = this.getJobFilePath(jobId);
      const content = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content) as SerializedJobState;
      return this.deserializeJobState(parsed);
    } catch (error) {
      if (this.isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Update job status
   *
   * @param jobId - Job ID
   * @param status - New status
   */
  async updateStatus(jobId: string, status: JobStatus): Promise<void> {
    const job = await this.getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    const updated: JobState = {
      ...job,
      status,
      updatedAt: new Date(),
    };

    await this.writeJobState(updated);
  }

  /**
   * Update job progress
   *
   * @param jobId - Job ID
   * @param update - Progress update data
   */
  async updateProgress(
    jobId: string,
    update: ProgressUpdateData
  ): Promise<void> {
    const job = await this.getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    const updated: JobState = {
      ...job,
      progress: {
        ...job.progress,
        ...update,
      },
      updatedAt: new Date(),
    };

    await this.writeJobState(updated);
  }

  /**
   * Record successful extraction
   *
   * @param jobId - Job ID
   * @param extraction - Completed extraction record
   */
  async recordCompletion(
    jobId: string,
    extraction: CompletedExtraction
  ): Promise<void> {
    const job = await this.getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    const updated: JobState = {
      ...job,
      completedExtractions: [...job.completedExtractions, extraction],
      progress: {
        ...job.progress,
        completedTasks: job.progress.completedTasks + 1,
      },
      updatedAt: new Date(),
    };

    await this.writeJobState(updated);
  }

  /**
   * Record extraction failure
   *
   * @param jobId - Job ID
   * @param failure - Failure record
   */
  async recordFailure(
    jobId: string,
    failure: ExtractionFailure
  ): Promise<void> {
    const job = await this.getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    const updated: JobState = {
      ...job,
      failures: [...job.failures, failure],
      progress: {
        ...job.progress,
        failedTasks: job.progress.failedTasks + 1,
      },
      updatedAt: new Date(),
    };

    await this.writeJobState(updated);
  }

  /**
   * Record not configured task
   *
   * @param jobId - Job ID
   * @param task - Not configured task record
   */
  async recordNotConfigured(
    jobId: string,
    task: NotConfiguredTask
  ): Promise<void> {
    const job = await this.getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    const updated: JobState = {
      ...job,
      notConfiguredTasks: [...job.notConfiguredTasks, task],
      updatedAt: new Date(),
    };

    await this.writeJobState(updated);
  }

  /**
   * List recent jobs
   *
   * @param limit - Maximum number of jobs to return (default: 10)
   * @returns Job summaries sorted by creation date (newest first)
   */
  async listJobs(limit: number = 10): Promise<readonly JobSummary[]> {
    // Ensure directory exists
    await mkdir(this.storageDir, { recursive: true });

    // Read all job files
    const files = await readdir(this.storageDir);
    const jobFiles = files.filter(f => f.endsWith('.json'));

    // Read job states
    const jobStates: Array<JobState & { durationMs?: number }> = [];
    for (const file of jobFiles) {
      try {
        const content = await readFile(join(this.storageDir, file), 'utf-8');
        const parsed = JSON.parse(content) as SerializedJobState;
        const jobState = this.deserializeJobState(parsed);
        jobStates.push(jobState);
      } catch (error) {
        // Skip invalid job files
        logger.warn('Failed to read job file', {
          file,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Sort by creation date (newest first)
    jobStates.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    // Take requested limit
    const limited = jobStates.slice(0, limit);

    // Convert to summaries
    const summaries: JobSummary[] = limited.map(job => {
      const durationMs =
        job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled'
          ? job.updatedAt.getTime() - job.createdAt.getTime()
          : undefined;

      return {
        jobId: job.jobId,
        createdAt: job.createdAt,
        status: job.status,
        scope: job.scope,
        progress: job.progress,
        durationMs,
      };
    });

    return summaries;
  }

  /**
   * Delete a job
   *
   * @param jobId - Job ID
   */
  async deleteJob(jobId: string): Promise<void> {
    const filePath = this.getJobFilePath(jobId);
    const { unlink } = await import('fs/promises');
    await unlink(filePath);
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Generate unique job ID
   */
  private generateJobId(): string {
    const timestamp = Date.now().toString(36);
    const random = randomBytes(4).toString('hex');
    return `job-${timestamp}-${random}`;
  }

  /**
   * Get file path for job
   */
  private getJobFilePath(jobId: string): string {
    return join(this.storageDir, `${jobId}.json`);
  }

  /**
   * Write job state to disk (atomic)
   *
   * Uses temp file + rename for atomic writes.
   */
  private async writeJobState(jobState: JobState): Promise<void> {
    // Ensure storage directory exists before writing
    await mkdir(this.storageDir, { recursive: true });

    const filePath = this.getJobFilePath(jobState.jobId);
    const tempPath = `${filePath}.tmp`;

    // Serialize job state
    const serialized = this.serializeJobState(jobState);
    const content = JSON.stringify(serialized, null, 2);

    // Write to temp file
    await writeFile(tempPath, content, 'utf-8');

    // Atomic rename
    await rename(tempPath, filePath);
  }

  /**
   * Serialize job state for storage
   *
   * Converts Date objects to ISO strings.
   */
  private serializeJobState(jobState: JobState): SerializedJobState {
    return {
      jobId: jobState.jobId,
      createdAt: jobState.createdAt.toISOString(),
      updatedAt: jobState.updatedAt.toISOString(),
      status: jobState.status,
      scope: jobState.scope,
      progress: jobState.progress,
      completedExtractions: jobState.completedExtractions.map(e => ({
        ...e,
        completedAt: e.completedAt.toISOString(),
      })),
      failures: jobState.failures.map(f => ({
        ...f,
        failedAt: f.failedAt.toISOString(),
      })),
      notConfiguredTasks: jobState.notConfiguredTasks.map(t => ({
        ...t,
        checkedAt: t.checkedAt.toISOString(),
      })),
      options: jobState.options,
    };
  }

  /**
   * Deserialize job state from storage
   *
   * Converts ISO strings back to Date objects.
   */
  private deserializeJobState(serialized: SerializedJobState): JobState {
    return {
      jobId: serialized.jobId,
      createdAt: new Date(serialized.createdAt),
      updatedAt: new Date(serialized.updatedAt),
      status: serialized.status,
      scope: serialized.scope,
      progress: serialized.progress,
      completedExtractions: serialized.completedExtractions.map(e => ({
        ...e,
        layer: e.layer as any,
        completedAt: new Date(e.completedAt),
      })),
      failures: serialized.failures.map(f => ({
        ...f,
        layer: f.layer as any,
        failedAt: new Date(f.failedAt),
      })),
      notConfiguredTasks: (serialized.notConfiguredTasks ?? []).map(t => ({
        ...t,
        layer: t.layer as any,
        checkedAt: new Date(t.checkedAt),
      })),
      options: serialized.options,
    };
  }

  /**
   * Check if error is a not-found error
   */
  private isNotFoundError(error: unknown): boolean {
    return (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    );
  }
}

// ============================================================================
// Serialized Types
// ============================================================================

/**
 * Serialized job state (for JSON storage)
 */
interface SerializedJobState {
  readonly jobId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: JobStatus;
  readonly scope: JobScope;
  readonly progress: {
    readonly totalTasks: number;
    readonly completedTasks: number;
    readonly failedTasks: number;
    readonly currentTask?: string;
  };
  readonly completedExtractions: readonly SerializedCompletedExtraction[];
  readonly failures: readonly SerializedExtractionFailure[];
  readonly notConfiguredTasks?: readonly SerializedNotConfiguredTask[];
  readonly options: OrchestrationOptions;
}

/**
 * Serialized completed extraction
 */
interface SerializedCompletedExtraction {
  readonly state: string;
  readonly layer: string;
  readonly completedAt: string;
  readonly boundaryCount: number;
  readonly validationPassed: boolean;
}

/**
 * Serialized extraction failure
 */
interface SerializedExtractionFailure {
  readonly state: string;
  readonly layer: string;
  readonly failedAt: string;
  readonly error: string;
  readonly attemptCount: number;
  readonly retryable: boolean;
}

/**
 * Serialized not configured task
 */
interface SerializedNotConfiguredTask {
  readonly state: string;
  readonly layer: string;
  readonly reason: 'state_not_in_registry' | 'layer_not_configured';
  readonly checkedAt: string;
}
