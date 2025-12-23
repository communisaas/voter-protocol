/**
 * Batch Orchestrator - Unified State Extraction Orchestration
 *
 * Consolidates scattered extraction scripts into production-grade orchestration:
 * - Job state persistence (resume on failure)
 * - Controlled concurrency
 * - Progress tracking
 * - Comprehensive error handling
 *
 * REPLACES:
 * - scripts/extract-all-states.ts
 * - scripts/extract-statewide-wards.ts
 * - scripts/audit-top-100-cities.ts
 *
 * ARCHITECTURE:
 * - StateBatchExtractor: Core extraction logic
 * - JobStateStore: Persistent job state
 * - Controlled concurrency: Manual queue implementation
 * - Progress callbacks: Real-time updates
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type { LegislativeLayerType } from '../registry/state-gis-portals.js';
import { StateBatchExtractor } from '../providers/state-batch-extractor.js';
import { STATE_GIS_PORTALS, getStatesWithLegislativeData, getLegislativeEndpoint } from '../registry/state-gis-portals.js';
import { JobStateStore } from './job-state-store.js';
import type {
  OrchestrationOptions,
  OrchestrationResult,
  OrchestrationStatistics,
  JobState,
  JobStatus,
  JobSummary,
  ExtractionTask,
  TaskExecutionResult,
  CompletedExtraction,
  ExtractionFailure,
  NotConfiguredTask,
  ProgressUpdate,
  DEFAULT_ORCHESTRATION_OPTIONS,
  StatewideWardState,
  StatewideWardExtractionOptions,
  StatewideWardExtractionResult,
  StatewideWardProgress,
  CityWardData,
} from './batch-orchestrator.types.js';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { FeatureCollection, Feature, Polygon, MultiPolygon } from 'geojson';
import { CensusPlaceListLoader } from '../registry/census-place-list.js';
import type { KnownPortal } from '../registry/known-portals.js';
import * as https from 'https';
import * as http from 'http';
import { createWriteStream } from 'fs';

const execAsync = promisify(exec);

// ============================================================================
// Validation Report Types
// ============================================================================

/**
 * State validation result (compatible with extract-all-states.ts)
 */
interface StateValidationResult {
  readonly state: string;
  readonly stateName: string;
  readonly status: 'match' | 'mismatch' | 'error' | 'not_configured';
  readonly expected: number;
  readonly actual: number;
  readonly endpoint: string;
  readonly error?: string;
  readonly durationMs: number;
}

/**
 * Validation report (compatible with extract-all-states.ts)
 */
interface ValidationReport {
  readonly timestamp: string;
  readonly totalStates: number;
  readonly results: readonly StateValidationResult[];
  readonly summary: {
    readonly matched: number;
    readonly mismatched: number;
    readonly errors: number;
    readonly notConfigured: number;
    readonly totalExpected: number;
    readonly totalActual: number;
    readonly coveragePercent: number;
  };
}

// ============================================================================
// Statewide Ward Extraction Configuration
// ============================================================================

/**
 * State extraction configuration
 */
interface StateExtractionConfig {
  readonly state: string;
  readonly stateName: string;
  readonly portalUrl: string;
  readonly downloadUrl: string;
  readonly layerName: string;
  readonly cityIdentifierField: string;
  readonly wardIdentifierField: string;
  readonly expectedCityCount: number;
  readonly dataFormat: 'shapefile' | 'geojson';
  readonly source: string;
  readonly confidence: number;
}

/**
 * Statewide extraction configurations
 */
const STATEWIDE_WARD_CONFIGS: Record<StatewideWardState, StateExtractionConfig> = {
  WI: {
    state: 'WI',
    stateName: 'Wisconsin',
    portalUrl: 'https://geodata.wisc.edu/catalog/D4FBBF16-F3D3-4BF8-9E1F-4EDC23C3BDF1',
    downloadUrl: 'https://web.s3.wisc.edu/rml-gisdata/WI_MunicipalWards_Spring_2023.zip',
    layerName: 'WI_MunicipalWards_Spring_2023',
    cityIdentifierField: 'MCD_NAME', // Municipal Civil Division name
    wardIdentifierField: 'WARD', // Ward identifier
    expectedCityCount: 50,
    dataFormat: 'shapefile',
    source: 'Wisconsin Legislative Technology Services Bureau (LTSB) - Spring 2023 Municipal Wards',
    confidence: 100, // Authoritative state source
  },
  MA: {
    state: 'MA',
    stateName: 'Massachusetts',
    portalUrl: 'https://www.mass.gov/info-details/massgis-data-2022-wards-and-precincts',
    downloadUrl: 'https://s3.us-east-1.amazonaws.com/download.massgis.digital.mass.gov/shapefiles/state/wardsprecincts_shp.zip',
    layerName: 'WARDSPRECINCTS_POLY',
    cityIdentifierField: 'TOWN', // City/town name
    wardIdentifierField: 'WARD', // Ward number (cities only - towns use PRECINCT)
    expectedCityCount: 40,
    dataFormat: 'shapefile',
    source: 'MassGIS 2022 Wards and Precincts - Secretary of Commonwealth Election Division',
    confidence: 100, // Authoritative state source
  },
};

// ============================================================================
// Batch Orchestrator
// ============================================================================

/**
 * Batch Orchestrator
 *
 * Unified orchestration for Shadow Atlas state extractions.
 * Provides job state management, failure recovery, and progress tracking.
 */
export class BatchOrchestrator {
  private readonly extractor: StateBatchExtractor;
  private readonly stateStore: JobStateStore;

  constructor(options?: {
    extractorOptions?: { retryAttempts?: number; retryDelayMs?: number };
    storageDir?: string;
  }) {
    this.extractor = new StateBatchExtractor(options?.extractorOptions);
    this.stateStore = new JobStateStore(options?.storageDir);
  }

  /**
   * Extract all configured US states
   *
   * Discovers states from registry and orchestrates extraction.
   *
   * @param options - Orchestration options
   * @returns Orchestration result with statistics
   *
   * @example
   * ```typescript
   * const orchestrator = new BatchOrchestrator();
   * const result = await orchestrator.orchestrateAllStates({
   *   concurrency: 3,
   *   continueOnError: true,
   *   onProgress: (update) => {
   *     console.log(`${update.task}: ${update.status}`);
   *   },
   * });
   *
   * console.log(`Completed ${result.statistics.successfulTasks} tasks`);
   * ```
   */
  async orchestrateAllStates(
    options?: OrchestrationOptions
  ): Promise<OrchestrationResult> {
    // Get all states with legislative data from registry
    const statesWithData = getStatesWithLegislativeData();
    const states = statesWithData.map(portal => portal.state);

    // All legislative layers
    const layers: LegislativeLayerType[] = [
      'congressional',
      'state_senate',
      'state_house',
    ];

    return this.orchestrateStates(states, layers, options);
  }

  /**
   * Extract specific states and layers
   *
   * Provides fine-grained control over what to extract.
   *
   * @param states - State codes (e.g., ['WI', 'TX', 'CA'])
   * @param layers - Legislative layers to extract
   * @param options - Orchestration options
   * @returns Orchestration result with statistics
   *
   * @example
   * ```typescript
   * const orchestrator = new BatchOrchestrator();
   * const result = await orchestrator.orchestrateStates(
   *   ['WI', 'MN', 'IL'],
   *   ['congressional', 'state_senate'],
   *   { concurrency: 2 }
   * );
   * ```
   */
  async orchestrateStates(
    states: readonly string[],
    layers: readonly LegislativeLayerType[],
    options?: OrchestrationOptions
  ): Promise<OrchestrationResult> {
    const startTime = Date.now();

    // Merge with defaults
    const opts = this.mergeOptions(options);

    // Create job
    const jobId = await this.stateStore.createJob(
      { states: [...states], layers: [...layers] },
      opts
    );

    try {
      // Update status to running
      await this.stateStore.updateStatus(jobId, 'running');

      // Pre-flight validation: identify not configured tasks
      const notConfiguredTasks = this.validateTasksAgainstRegistry(states, layers);
      for (const task of notConfiguredTasks) {
        await this.stateStore.recordNotConfigured(jobId, task);
      }

      // Build task queue (only configured tasks)
      const tasks = this.buildTaskQueue(states, layers);
      const validTasks = tasks.filter(task =>
        !notConfiguredTasks.some(
          nc => nc.state === task.state && nc.layer === task.layer
        )
      );

      // Execute tasks with controlled concurrency
      await this.executeTasks(jobId, validTasks, opts);

      // Get final state
      const finalState = await this.stateStore.getJob(jobId);
      if (!finalState) {
        throw new Error(`Job ${jobId} not found after execution`);
      }

      // Update final status
      const finalStatus = this.determineJobStatus(finalState);
      await this.stateStore.updateStatus(jobId, finalStatus);

      // Build result
      const durationMs = Date.now() - startTime;
      return this.buildResult(jobId, finalState, finalStatus, durationMs);
    } catch (error) {
      await this.stateStore.updateStatus(jobId, 'failed');
      throw error;
    }
  }

  /**
   * Resume a failed or partial job
   *
   * Resumes extraction from where it left off.
   * Only retries failed tasks, skips completed ones.
   *
   * @param jobId - Job ID to resume
   * @returns Orchestration result with statistics
   *
   * @example
   * ```typescript
   * const orchestrator = new BatchOrchestrator();
   *
   * // Initial run fails partway
   * const result1 = await orchestrator.orchestrateAllStates();
   *
   * // Resume from failure
   * const result2 = await orchestrator.resumeJob(result1.jobId);
   * console.log(`Resumed: ${result2.statistics.successfulTasks} more tasks`);
   * ```
   */
  async resumeJob(jobId: string): Promise<OrchestrationResult> {
    const startTime = Date.now();

    // Get existing job state
    const job = await this.stateStore.getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    // Verify job is resumable
    if (job.status !== 'partial' && job.status !== 'failed') {
      throw new Error(`Job ${jobId} is not resumable (status: ${job.status})`);
    }

    // Update status to running
    await this.stateStore.updateStatus(jobId, 'running');

    try {
      // Build full task list
      const allTasks = this.buildTaskQueue(job.scope.states, job.scope.layers);

      // Filter out completed tasks
      const completedTaskIds = new Set(
        job.completedExtractions.map(
          e => this.getTaskId(e.state, e.layer)
        )
      );

      const pendingTasks = allTasks.filter(
        task => !completedTaskIds.has(task.taskId)
      );

      console.log(
        `Resuming job ${jobId}: ${pendingTasks.length} pending tasks (${completedTaskIds.size} already completed)`
      );

      // Execute pending tasks (merge options to ensure all required fields)
      const mergedOptions = this.mergeOptions(job.options);
      await this.executeTasks(jobId, pendingTasks, mergedOptions);

      // Get final state
      const finalState = await this.stateStore.getJob(jobId);
      if (!finalState) {
        throw new Error(`Job ${jobId} not found after resume`);
      }

      // Update final status
      const finalStatus = this.determineJobStatus(finalState);
      await this.stateStore.updateStatus(jobId, finalStatus);

      // Build result
      const durationMs = Date.now() - startTime;
      return this.buildResult(jobId, finalState, finalStatus, durationMs);
    } catch (error) {
      await this.stateStore.updateStatus(jobId, 'failed');
      throw error;
    }
  }

  /**
   * Get job status
   *
   * @param jobId - Job ID
   * @returns Job state or null if not found
   */
  async getJobStatus(jobId: string): Promise<JobState | null> {
    return this.stateStore.getJob(jobId);
  }

  /**
   * List recent jobs
   *
   * @param limit - Maximum number of jobs to return (default: 10)
   * @returns Job summaries sorted by creation date (newest first)
   */
  async listJobs(limit?: number): Promise<readonly JobSummary[]> {
    return this.stateStore.listJobs(limit);
  }

  /**
   * Cancel a running job
   *
   * NOTE: Cancellation is cooperative. Currently running tasks will complete,
   * but no new tasks will start.
   *
   * @param jobId - Job ID
   */
  async cancelJob(jobId: string): Promise<void> {
    const job = await this.stateStore.getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (job.status !== 'running') {
      throw new Error(`Job ${jobId} is not running (status: ${job.status})`);
    }

    await this.stateStore.updateStatus(jobId, 'cancelled');
  }

  /**
   * Extract statewide city ward/district boundaries
   *
   * Downloads statewide ward datasets from Wisconsin or Massachusetts state portals,
   * splits by municipality, normalizes ward numbering, and generates individual
   * city GeoJSON files with registry entries.
   *
   * **Coverage:**
   * - Wisconsin: 50+ cities with ward-based governance
   * - Massachusetts: 40+ cities (only cities have wards in MA)
   *
   * **Data Sources:**
   * - WI: Legislative Technology Services Bureau (LTSB)
   * - MA: MassGIS (Secretary of Commonwealth Election Division)
   *
   * @param state - State to extract ('WI' | 'MA')
   * @param options - Extraction options
   * @returns Extraction result with city ward data
   *
   * @example
   * ```typescript
   * const orchestrator = new BatchOrchestrator();
   *
   * // Extract Wisconsin wards
   * const result = await orchestrator.extractStatewideWards('WI', {
   *   onProgress: (progress) => {
   *     console.log(`${progress.step}: ${progress.message}`);
   *   },
   * });
   *
   * console.log(`Extracted ${result.citiesExtracted} cities`);
   * ```
   */
  async extractStatewideWards(
    state: StatewideWardState,
    options?: StatewideWardExtractionOptions
  ): Promise<StatewideWardExtractionResult> {
    const config = STATEWIDE_WARD_CONFIGS[state];
    const outputDir = options?.outputDir ?? join(process.cwd(), '.shadow-atlas', 'statewide-wards');
    const stateDir = join(outputDir, state);

    // Dry run - show plan without executing
    if (options?.dryRun) {
      return this.buildDryRunResult(config, stateDir);
    }

    // Ensure directories exist
    await mkdir(stateDir, { recursive: true });
    await mkdir(join(stateDir, 'cities'), { recursive: true });
    await mkdir(join(stateDir, 'extracted'), { recursive: true });

    const downloadPath = join(stateDir, `statewide-${state}.zip`);
    const extractDir = join(stateDir, 'extracted');
    const geojsonPath = join(stateDir, `statewide-${state}.geojson`);

    // Step 1: Download statewide data
    if (!options?.skipDownload) {
      await this.notifyStatewideProgress(state, 'downloading', 'Downloading statewide dataset...', options?.onProgress);

      try {
        await this.downloadFile(config.downloadUrl, downloadPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Download failed: ${message}`);
      }

      // Step 2: Extract shapefile
      await this.notifyStatewideProgress(state, 'extracting', 'Extracting shapefile...', options?.onProgress);

      try {
        await this.unzipShapefile(downloadPath, extractDir);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Extraction failed: ${message}`);
      }

      // Step 3: Convert to GeoJSON
      await this.notifyStatewideProgress(state, 'converting', 'Converting to GeoJSON...', options?.onProgress);

      try {
        const shpPath = await this.findShapefilePath(extractDir);
        await this.shapefileToGeoJSON(shpPath, geojsonPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Conversion failed: ${message}`);
      }
    }

    // Step 4: Load and split by city
    await this.notifyStatewideProgress(state, 'splitting', 'Splitting by municipality...', options?.onProgress);

    const stateData = await this.loadGeoJSON(geojsonPath);
    const cityFeatures = this.splitByCity(stateData, config);

    // Step 5: Process each city
    await this.notifyStatewideProgress(
      state,
      'processing',
      `Processing ${cityFeatures.size} cities...`,
      options?.onProgress
    );

    const results: CityWardData[] = [];
    const censusLoader = new CensusPlaceListLoader();

    let processed = 0;
    // Convert to array to avoid iterator type issues
    const cityEntries = Array.from(cityFeatures.entries());
    for (const [cityName, features] of cityEntries) {
      processed++;

      // Get FIPS code
      const fips = await this.getCityFips(cityName, state, censusLoader);

      if (!fips) {
        console.warn(`[${state}] ${cityName}: No FIPS code found - skipping`);
        continue;
      }

      // Normalize ward numbering
      const normalizedFeatures = this.normalizeWardNumbering(features, config);

      // Create GeoJSON
      const cityGeoJSON: FeatureCollection<Polygon | MultiPolygon> = {
        type: 'FeatureCollection',
        features: normalizedFeatures,
      };

      // Write individual city file
      const cityOutputPath = join(stateDir, 'cities', `${fips}.geojson`);
      await writeFile(cityOutputPath, JSON.stringify(cityGeoJSON, null, 2), 'utf-8');

      results.push({
        fips,
        name: cityName,
        state,
        wardCount: features.length,
        outputPath: cityOutputPath,
        source: config.source,
        confidence: config.confidence,
      });

      // Progress update
      await this.notifyStatewideProgress(
        state,
        'processing',
        `Processed ${cityName} (${processed}/${cityFeatures.size})`,
        options?.onProgress,
        processed,
        cityFeatures.size
      );
    }

    // Generate registry entries
    const registryEntries = this.generateRegistryEntries(results);
    const registryEntriesPath = join(stateDir, 'registry-entries.json');
    await writeFile(registryEntriesPath, JSON.stringify(registryEntries, null, 2), 'utf-8');

    // Generate extraction summary
    const summary = {
      state: config.state,
      stateName: config.stateName,
      extractedAt: new Date().toISOString(),
      citiesFound: results.length,
      expectedCities: config.expectedCityCount,
      source: config.source,
      cities: results.map(r => ({
        fips: r.fips,
        name: r.name,
        wardCount: r.wardCount,
      })),
    };

    const summaryPath = join(stateDir, 'extraction-summary.json');
    await writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');

    // Final notification
    await this.notifyStatewideProgress(state, 'completed', 'Extraction complete', options?.onProgress);

    return {
      state,
      stateName: config.stateName,
      extractedAt: summary.extractedAt,
      citiesExtracted: results.length,
      expectedCities: config.expectedCityCount,
      cities: results,
      registryEntriesPath,
      summaryPath,
    };
  }

  /**
   * Export validation report for a completed job
   *
   * Generates a report compatible with extract-all-states.ts output schema.
   * Includes match/mismatch/error/not_configured status for each state-layer pair.
   *
   * @param jobId - Job ID to export
   * @param outputPath - Path to write JSON report
   *
   * @example
   * ```typescript
   * const orchestrator = new BatchOrchestrator();
   * const result = await orchestrator.orchestrateAllStates();
   * await orchestrator.exportValidationReport(
   *   result.jobId,
   *   './validation-report.json'
   * );
   * ```
   */
  async exportValidationReport(
    jobId: string,
    outputPath: string
  ): Promise<void> {
    const job = await this.stateStore.getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    // Build validation results from job state
    const results: StateValidationResult[] = [];

    // Add not configured tasks
    for (const task of job.notConfiguredTasks) {
      const portal = STATE_GIS_PORTALS[task.state];
      results.push({
        state: task.state,
        stateName: portal?.stateName ?? task.state,
        status: 'not_configured',
        expected: 0,
        actual: 0,
        endpoint: '',
        error: task.reason === 'state_not_in_registry'
          ? 'State not found in STATE_GIS_PORTALS registry'
          : `${task.layer} layer not configured`,
        durationMs: 0,
      });
    }

    // Add successful extractions
    for (const extraction of job.completedExtractions) {
      const portal = STATE_GIS_PORTALS[extraction.state];
      const layer = getLegislativeEndpoint(extraction.state, extraction.layer);

      results.push({
        state: extraction.state,
        stateName: portal?.stateName ?? extraction.state,
        status: extraction.validationPassed ? 'match' : 'mismatch',
        expected: layer?.expectedCount ?? extraction.boundaryCount,
        actual: extraction.boundaryCount,
        endpoint: layer?.endpoint ?? '',
        durationMs: 0, // Not tracked per-task in current implementation
      });
    }

    // Add failures
    for (const failure of job.failures) {
      const portal = STATE_GIS_PORTALS[failure.state];
      const layer = getLegislativeEndpoint(failure.state, failure.layer);

      results.push({
        state: failure.state,
        stateName: portal?.stateName ?? failure.state,
        status: 'error',
        expected: layer?.expectedCount ?? 0,
        actual: 0,
        endpoint: layer?.endpoint ?? '',
        error: failure.error,
        durationMs: 0,
      });
    }

    // Calculate summary statistics
    const matched = results.filter(r => r.status === 'match').length;
    const mismatched = results.filter(r => r.status === 'mismatch').length;
    const errors = results.filter(r => r.status === 'error').length;
    const notConfigured = results.filter(r => r.status === 'not_configured').length;

    const totalExpected = results
      .filter(r => r.status !== 'not_configured')
      .reduce((sum, r) => sum + r.expected, 0);

    const totalActual = results
      .filter(r => r.status === 'match' || r.status === 'mismatch')
      .reduce((sum, r) => sum + r.actual, 0);

    const configuredStates = results.filter(r => r.status !== 'not_configured').length;
    const coveragePercent = configuredStates > 0
      ? Math.round((matched / configuredStates) * 100)
      : 0;

    // Build report
    const report: ValidationReport = {
      timestamp: new Date().toISOString(),
      totalStates: job.scope.states.length,
      results,
      summary: {
        matched,
        mismatched,
        errors,
        notConfigured,
        totalExpected,
        totalActual,
        coveragePercent,
      },
    };

    // Write report to file
    await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf-8');
  }

  // ============================================================================
  // Private Methods - Statewide Ward Extraction
  // ============================================================================

  /**
   * Download file from URL (with redirect support)
   */
  private async downloadFile(url: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;

      client.get(url, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (!redirectUrl) {
            reject(new Error('Redirect without location header'));
            return;
          }
          this.downloadFile(redirectUrl, outputPath).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        const fileStream = createWriteStream(outputPath);
        response.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close();
          resolve();
        });

        fileStream.on('error', (error) => {
          reject(error);
        });
      }).on('error', reject);
    });
  }

  /**
   * Unzip shapefile archive
   */
  private async unzipShapefile(zipPath: string, outputDir: string): Promise<void> {
    await execAsync(`unzip -o "${zipPath}" -d "${outputDir}"`);
  }

  /**
   * Find shapefile path in extracted directory
   */
  private async findShapefilePath(extractDir: string): Promise<string> {
    const { stdout } = await execAsync(`find "${extractDir}" -name "*.shp" -type f`);
    const shpFiles = stdout.trim().split('\n').filter(Boolean);

    if (shpFiles.length === 0) {
      throw new Error('No .shp file found in extracted data');
    }

    return shpFiles[0]!;
  }

  /**
   * Convert shapefile to GeoJSON using ogr2ogr
   */
  private async shapefileToGeoJSON(shpPath: string, outputPath: string): Promise<void> {
    await execAsync(`ogr2ogr -f GeoJSON -t_srs EPSG:4326 "${outputPath}" "${shpPath}"`);
  }

  /**
   * Load GeoJSON file
   */
  private async loadGeoJSON(filePath: string): Promise<FeatureCollection<Polygon | MultiPolygon>> {
    const content = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);

    // Type guard
    if (!this.isFeatureCollection(parsed)) {
      throw new Error('Invalid GeoJSON: not a FeatureCollection');
    }

    return parsed;
  }

  /**
   * Type guard for FeatureCollection
   */
  private isFeatureCollection(value: unknown): value is FeatureCollection<Polygon | MultiPolygon> {
    return (
      typeof value === 'object' &&
      value !== null &&
      'type' in value &&
      value.type === 'FeatureCollection' &&
      'features' in value &&
      Array.isArray(value.features)
    );
  }

  /**
   * Split statewide data by city
   */
  private splitByCity(
    stateData: FeatureCollection<Polygon | MultiPolygon>,
    config: StateExtractionConfig
  ): Map<string, Array<Feature<Polygon | MultiPolygon>>> {
    const cityFeatures = new Map<string, Array<Feature<Polygon | MultiPolygon>>>();

    for (const feature of stateData.features) {
      const cityName = feature.properties?.[config.cityIdentifierField];
      const wardId = feature.properties?.[config.wardIdentifierField];

      // Skip features without city name or ward ID
      if (!cityName || !wardId) {
        continue;
      }

      // Skip precincts (Massachusetts only - cities have wards, towns have precincts)
      if (config.state === 'MA' && !feature.properties?.WARD) {
        continue; // Town precinct, not city ward
      }

      if (!cityFeatures.has(String(cityName))) {
        cityFeatures.set(String(cityName), []);
      }

      cityFeatures.get(String(cityName))!.push(feature);
    }

    return cityFeatures;
  }

  /**
   * Get city FIPS code from Census data
   */
  private async getCityFips(
    cityName: string,
    state: string,
    censusLoader: CensusPlaceListLoader
  ): Promise<string | null> {
    const stateFips = state === 'WI' ? '55' : state === 'MA' ? '25' : null;

    if (!stateFips) {
      return null;
    }

    const places = await censusLoader.loadPlacesByState(stateFips);

    // Normalize city names for matching
    const normalizedTarget = cityName.toLowerCase().trim();

    for (const place of places) {
      const normalizedPlace = place.name.toLowerCase().trim();

      if (normalizedPlace === normalizedTarget) {
        return place.geoid;
      }

      // Handle common variations
      if (normalizedPlace.replace(' city', '') === normalizedTarget) {
        return place.geoid;
      }
      if (normalizedPlace === normalizedTarget.replace(' city', '')) {
        return place.geoid;
      }
    }

    return null;
  }

  /**
   * Normalize ward numbering (ensure sequential 1, 2, 3...)
   */
  private normalizeWardNumbering(
    features: Array<Feature<Polygon | MultiPolygon>>,
    config: StateExtractionConfig
  ): Array<Feature<Polygon | MultiPolygon>> {
    // Extract ward numbers and sort
    const wardNumbers = features
      .map(f => {
        const wardId = f.properties?.[config.wardIdentifierField];
        if (typeof wardId === 'number') return wardId;
        if (typeof wardId === 'string') {
          // Handle "Ward 1", "1", "I", etc.
          const match = wardId.match(/\d+/);
          return match ? parseInt(match[0], 10) : null;
        }
        return null;
      })
      .filter((n): n is number => n !== null)
      .sort((a, b) => a - b);

    // Create normalized features
    return features.map((feature, index) => ({
      ...feature,
      properties: {
        ...feature.properties,
        WARD_NORMALIZED: wardNumbers[index] ?? index + 1,
      },
    }));
  }

  /**
   * Generate registry entries from city ward data
   */
  private generateRegistryEntries(cityData: readonly CityWardData[]): readonly KnownPortal[] {
    return cityData.map(city => ({
      cityFips: city.fips,
      cityName: city.name,
      state: city.state,
      portalType: 'state-gis' as const,
      downloadUrl: `statewide-extraction/${city.state}/${city.fips}.geojson`,
      featureCount: city.wardCount,
      lastVerified: new Date().toISOString(),
      confidence: city.confidence,
      discoveredBy: 'automated' as const,
      notes: city.source,
    }));
  }

  /**
   * Build dry run result
   */
  private buildDryRunResult(
    config: StateExtractionConfig,
    stateDir: string
  ): StatewideWardExtractionResult {
    return {
      state: config.state as StatewideWardState,
      stateName: config.stateName,
      extractedAt: new Date().toISOString(),
      citiesExtracted: 0,
      expectedCities: config.expectedCityCount,
      cities: [],
      registryEntriesPath: join(stateDir, 'registry-entries.json'),
      summaryPath: join(stateDir, 'extraction-summary.json'),
    };
  }

  /**
   * Notify statewide progress
   */
  private async notifyStatewideProgress(
    state: StatewideWardState,
    step: StatewideWardProgress['step'],
    message: string,
    callback?: (progress: StatewideWardProgress) => void,
    current?: number,
    total?: number
  ): Promise<void> {
    if (!callback) return;

    callback({
      state,
      step,
      message,
      current,
      total,
    });
  }

  // ============================================================================
  // Private Methods - Task Execution
  // ============================================================================

  /**
   * Execute tasks with controlled concurrency
   *
   * Manual concurrency control without external dependencies.
   */
  private async executeTasks(
    jobId: string,
    tasks: readonly ExtractionTask[],
    options: Required<Omit<OrchestrationOptions, 'onProgress'>> & {
      onProgress?: (progress: ProgressUpdate) => void;
    }
  ): Promise<void> {
    const concurrency = options.concurrency;
    const rateLimitMs = options.rateLimitMs;

    let currentIndex = 0;
    const runningTasks: Array<Promise<void>> = [];

    // Worker function
    const worker = async (): Promise<void> => {
      while (currentIndex < tasks.length) {
        // Check if job was cancelled
        const job = await this.stateStore.getJob(jobId);
        if (job?.status === 'cancelled') {
          console.log(`Job ${jobId} cancelled, stopping worker`);
          return;
        }

        // Get next task
        const taskIndex = currentIndex++;
        const task = tasks[taskIndex];
        if (!task) break;

        // Execute task
        await this.executeTask(jobId, task, options);

        // Rate limiting
        if (rateLimitMs > 0) {
          await this.delay(rateLimitMs);
        }
      }
    };

    // Start workers
    for (let i = 0; i < concurrency; i++) {
      runningTasks.push(worker());
    }

    // Wait for all workers to complete
    await Promise.all(runningTasks);
  }

  /**
   * Execute a single extraction task
   */
  private async executeTask(
    jobId: string,
    task: ExtractionTask,
    options: Required<Omit<OrchestrationOptions, 'onProgress'>> & {
      onProgress?: (progress: ProgressUpdate) => void;
    }
  ): Promise<void> {
    const { state, layer } = task;
    let lastError: Error | null = null;

    // Notify start
    await this.notifyProgress(jobId, task.taskId, 'started', options.onProgress);

    // Update current task
    await this.stateStore.updateProgress(jobId, {
      currentTask: task.taskId,
    });

    // Retry loop
    for (let attempt = 1; attempt <= options.maxRetries; attempt++) {
      try {
        console.log(`[${state}] [${layer}] Extracting (attempt ${attempt}/${options.maxRetries})...`);

        // Extract layer
        const result = await this.extractor.extractLayer(state, layer);

        if (!result.success) {
          throw new Error(result.error ?? 'Extraction failed');
        }

        // Validation (optional)
        let validationPassed = true;
        if (options.validateAfterExtraction) {
          validationPassed = result.featureCount === result.expectedCount;
          if (!validationPassed) {
            console.warn(
              `[${state}] [${layer}] Validation warning: Expected ${result.expectedCount}, got ${result.featureCount}`
            );
          }
        }

        // Record success
        const completion: CompletedExtraction = {
          state,
          layer,
          completedAt: new Date(),
          boundaryCount: result.featureCount,
          validationPassed,
        };

        await this.stateStore.recordCompletion(jobId, completion);

        // Notify completion
        await this.notifyProgress(jobId, task.taskId, 'completed', options.onProgress);

        console.log(`[${state}] [${layer}] ✓ Completed (${result.featureCount} boundaries)`);

        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`[${state}] [${layer}] Attempt ${attempt} failed: ${lastError.message}`);

        // Retry delay
        if (attempt < options.maxRetries) {
          await this.delay(options.retryDelayMs);
        }
      }
    }

    // All retries exhausted
    const failure: ExtractionFailure = {
      state,
      layer,
      failedAt: new Date(),
      error: lastError?.message ?? 'Unknown error',
      attemptCount: options.maxRetries,
      retryable: true,
    };

    await this.stateStore.recordFailure(jobId, failure);

    // Notify failure
    await this.notifyProgress(
      jobId,
      task.taskId,
      'failed',
      options.onProgress,
      lastError?.message
    );

    console.log(`[${state}] [${layer}] ✗ Failed after ${options.maxRetries} attempts`);

    // Fail fast if continueOnError is false
    if (!options.continueOnError) {
      throw lastError;
    }
  }

  /**
   * Notify progress callback
   */
  private async notifyProgress(
    jobId: string,
    task: string,
    status: 'started' | 'completed' | 'failed',
    callback?: (progress: ProgressUpdate) => void,
    error?: string
  ): Promise<void> {
    if (!callback) return;

    const job = await this.stateStore.getJob(jobId);
    if (!job) return;

    const update: ProgressUpdate = {
      jobId,
      task,
      status,
      progress: job.progress,
      error,
    };

    callback(update);
  }

  // ============================================================================
  // Private Methods - Validation
  // ============================================================================

  /**
   * Validate tasks against registry
   *
   * Identifies state-layer pairs that are not configured in STATE_GIS_PORTALS.
   * This enables pre-flight validation and accurate coverage calculation.
   */
  private validateTasksAgainstRegistry(
    states: readonly string[],
    layers: readonly LegislativeLayerType[]
  ): NotConfiguredTask[] {
    const notConfigured: NotConfiguredTask[] = [];
    const now = new Date();

    for (const state of states) {
      // Check if state exists in registry
      const portal = STATE_GIS_PORTALS[state];
      if (!portal) {
        // State not in registry - mark all layers as not configured
        for (const layer of layers) {
          notConfigured.push({
            state,
            layer,
            reason: 'state_not_in_registry',
            checkedAt: now,
          });
        }
        continue;
      }

      // State exists - check each layer
      for (const layer of layers) {
        const layerConfig = getLegislativeEndpoint(state, layer);
        if (!layerConfig) {
          notConfigured.push({
            state,
            layer,
            reason: 'layer_not_configured',
            checkedAt: now,
          });
        }
      }
    }

    return notConfigured;
  }

  // ============================================================================
  // Private Methods - Task Management
  // ============================================================================

  /**
   * Build task queue from states and layers
   */
  private buildTaskQueue(
    states: readonly string[],
    layers: readonly LegislativeLayerType[]
  ): ExtractionTask[] {
    const tasks: ExtractionTask[] = [];

    for (const state of states) {
      for (const layer of layers) {
        tasks.push({
          state,
          layer,
          taskId: this.getTaskId(state, layer),
        });
      }
    }

    return tasks;
  }

  /**
   * Get task ID from state and layer
   */
  private getTaskId(state: string, layer: LegislativeLayerType): string {
    return `${state}-${layer}`;
  }

  // ============================================================================
  // Private Methods - Job Status
  // ============================================================================

  /**
   * Determine final job status from job state
   */
  private determineJobStatus(job: JobState): JobStatus {
    if (job.status === 'cancelled') {
      return 'cancelled';
    }

    const { totalTasks, completedTasks, failedTasks } = job.progress;

    if (completedTasks === totalTasks) {
      return 'completed';
    }

    if (failedTasks > 0 && completedTasks + failedTasks === totalTasks) {
      return 'partial';
    }

    if (failedTasks === totalTasks) {
      return 'failed';
    }

    return 'running';
  }

  /**
   * Build orchestration result from job state
   */
  private buildResult(
    jobId: string,
    job: JobState,
    finalStatus: JobStatus,
    durationMs: number
  ): OrchestrationResult {
    // Calculate expected boundaries from configured layers
    const expectedBoundaries = job.completedExtractions.reduce((sum, extraction) => {
      const layer = getLegislativeEndpoint(extraction.state, extraction.layer);
      return sum + (layer?.expectedCount ?? 0);
    }, 0);

    // Calculate coverage percentage
    const configurableTasks = job.progress.totalTasks - job.notConfiguredTasks.length;
    const coveragePercent = configurableTasks > 0
      ? Math.round((job.completedExtractions.length / configurableTasks) * 100)
      : 0;

    const statistics: OrchestrationStatistics = {
      totalTasks: job.progress.totalTasks,
      successfulTasks: job.completedExtractions.length,
      failedTasks: job.failures.length,
      notConfiguredTasks: job.notConfiguredTasks.length,
      expectedBoundaries,
      totalBoundaries: job.completedExtractions.reduce(
        (sum, e) => sum + e.boundaryCount,
        0
      ),
      validationsPassed: job.completedExtractions.filter(e => e.validationPassed).length,
      validationsFailed: job.completedExtractions.filter(e => !e.validationPassed).length,
      coveragePercent,
    };

    return {
      jobId,
      status: finalStatus,
      completedExtractions: job.completedExtractions,
      failures: job.failures,
      statistics,
      durationMs,
    };
  }

  // ============================================================================
  // Private Methods - Options
  // ============================================================================

  /**
   * Merge user options with defaults
   */
  private mergeOptions(
    options?: OrchestrationOptions
  ): Required<Omit<OrchestrationOptions, 'onProgress'>> & {
    onProgress?: (progress: ProgressUpdate) => void;
  } {
    return {
      concurrency: options?.concurrency ?? 5,
      continueOnError: options?.continueOnError ?? true,
      maxRetries: options?.maxRetries ?? 3,
      retryDelayMs: options?.retryDelayMs ?? 2000,
      validateAfterExtraction: options?.validateAfterExtraction ?? true,
      rateLimitMs: options?.rateLimitMs ?? 500,
      onProgress: options?.onProgress,
    };
  }

  // ============================================================================
  // Private Methods - Utilities
  // ============================================================================

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Quick orchestration for all states
 *
 * @param options - Orchestration options
 * @returns Orchestration result
 */
export async function orchestrateAllStates(
  options?: OrchestrationOptions
): Promise<OrchestrationResult> {
  const orchestrator = new BatchOrchestrator();
  return orchestrator.orchestrateAllStates(options);
}

/**
 * Quick orchestration for specific states
 *
 * @param states - State codes
 * @param layers - Legislative layers
 * @param options - Orchestration options
 * @returns Orchestration result
 */
export async function orchestrateStates(
  states: readonly string[],
  layers: readonly LegislativeLayerType[],
  options?: OrchestrationOptions
): Promise<OrchestrationResult> {
  const orchestrator = new BatchOrchestrator();
  return orchestrator.orchestrateStates(states, layers, options);
}
