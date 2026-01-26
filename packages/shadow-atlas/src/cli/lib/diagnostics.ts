/**
 * Diagnostic Utilities for Shadow Atlas CLI
 *
 * Provides functions for analyzing containment failures, coverage metrics,
 * overlap detection, and system health checks.
 *
 * @module cli/lib/diagnostics
 */

import { readFile, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  getPackageRoot,
  getNdjsonPath,
  parseNdjsonEntries,
  REGISTRY_NAMES,
  type RegistryName,
} from './codegen.js';
import { listSnapshots } from './migration.js';

// ============================================================================
// Types
// ============================================================================

export type BoundarySource = 'tiger' | 'authoritative';

export interface ContainmentReport {
  readonly fips: string;
  readonly cityName: string;
  readonly state: string;
  readonly url: string;
  readonly boundarySource: BoundarySource;
  readonly analysis: {
    readonly totalFeatures: number;
    readonly totalDistrictArea: number;
    readonly cityBoundaryArea: number;
    readonly outsideArea: number;
    readonly outsidePercentage: number;
    readonly districtBreakdown: readonly DistrictContainment[];
  };
  readonly verdict: 'pass' | 'fail' | 'warn';
  readonly remediation: readonly string[];
}

export interface DistrictContainment {
  readonly districtId: string;
  readonly districtName?: string;
  readonly area: number;
  readonly outsideArea: number;
  readonly outsidePercentage: number;
}

export interface CoverageReport {
  readonly fips: string;
  readonly cityName: string;
  readonly state: string;
  readonly analysis: {
    readonly cityBoundaryArea: number;
    readonly totalDistrictArea: number;
    readonly coverageRatio: number;
    readonly landArea?: number;
    readonly waterArea?: number;
    readonly landCoverageRatio?: number;
    readonly uncoveredAreas: readonly UncoveredArea[];
  };
  readonly vintageComparison?: VintageComparison;
  readonly verdict: 'pass' | 'fail' | 'warn';
  readonly notes: readonly string[];
}

export interface UncoveredArea {
  readonly description: string;
  readonly approximateArea: number;
  readonly location?: { lat: number; lng: number };
}

export interface VintageComparison {
  readonly vintages: readonly string[];
  readonly areaChanges: readonly {
    readonly vintage: string;
    readonly area: number;
    readonly changeFromPrevious?: number;
  }[];
}

export interface OverlapReport {
  readonly fips: string;
  readonly cityName: string;
  readonly state: string;
  readonly analysis: {
    readonly totalDistricts: number;
    readonly overlappingPairs: readonly OverlapPair[];
    readonly overlapMatrix: readonly readonly number[][];
    readonly maxOverlapArea: number;
    readonly hasProblematicOverlaps: boolean;
  };
  readonly verdict: 'pass' | 'fail' | 'warn';
  readonly notes: readonly string[];
}

export interface OverlapPair {
  readonly district1: string;
  readonly district2: string;
  readonly overlapArea: number;
  readonly overlapPercentage: number;
}

export interface HealthReport {
  readonly timestamp: string;
  readonly overall: 'healthy' | 'degraded' | 'unhealthy';
  readonly checks: readonly HealthCheck[];
  readonly metrics: HealthMetrics;
}

export interface HealthCheck {
  readonly name: string;
  readonly status: 'pass' | 'fail' | 'warn' | 'skip';
  readonly message: string;
  readonly duration_ms: number;
  readonly details?: Record<string, unknown>;
}

export interface HealthMetrics {
  readonly registryIntegrity: {
    readonly knownPortals: number;
    readonly quarantined: number;
    readonly atLarge: number;
    readonly syncStatus: 'synced' | 'out-of-sync' | 'unknown';
  };
  readonly cacheStatus: {
    readonly tigerCacheAge?: number;
    readonly cacheSize?: number;
    readonly lastRefresh?: string;
  };
  readonly quarantineQueue: {
    readonly size: number;
    readonly oldestEntry?: string;
    readonly byPattern: Record<string, number>;
  };
  readonly snapshotCount: number;
  readonly layerAccessibility?: {
    readonly sampleSize: number;
    readonly accessibleCount: number;
    readonly inaccessibleCount: number;
    readonly timeoutCount: number;
    readonly errorCount: number;
    readonly accessibilityRate: number;
    readonly dataAvailabilityRate: number;
  };
}

// ============================================================================
// Registry Analysis Utilities
// ============================================================================

/**
 * Get entry from any registry by FIPS
 */
export async function getEntryByFips(
  fips: string,
): Promise<{ registry: RegistryName; entry: Record<string, unknown> } | null> {
  for (const registry of REGISTRY_NAMES) {
    try {
      const entries = await parseNdjsonEntries(getNdjsonPath(registry));
      const entry = entries.get(fips);
      if (entry) {
        return { registry, entry };
      }
    } catch {
      // Registry file might not exist
    }
  }
  return null;
}

/**
 * Get registry counts
 */
export async function getRegistryCounts(): Promise<
  Record<RegistryName, number>
> {
  const counts: Record<string, number> = {};

  for (const registry of REGISTRY_NAMES) {
    try {
      const entries = await parseNdjsonEntries(getNdjsonPath(registry));
      counts[registry] = entries.size;
    } catch {
      counts[registry] = 0;
    }
  }

  return counts as Record<RegistryName, number>;
}

// ============================================================================
// Containment Analysis
// ============================================================================

/**
 * Analyze containment for a city
 *
 * NOTE: This is a simplified implementation. Full implementation would require
 * actual GeoJSON fetching and geometric analysis with turf.js
 */
export async function analyzeContainment(
  fips: string,
  options: {
    url?: string;
    boundarySource?: BoundarySource;
  } = {},
): Promise<ContainmentReport> {
  const { boundarySource = 'tiger' } = options;

  const found = await getEntryByFips(fips);
  if (!found) {
    throw new Error(`Entry not found for FIPS: ${fips}`);
  }

  const { entry } = found;
  const cityName = entry.cityName as string;
  const state = entry.state as string;
  const url = options.url || (entry.downloadUrl as string);

  // In a full implementation, we would:
  // 1. Fetch GeoJSON from the URL
  // 2. Fetch city boundary from TIGER or authoritative source
  // 3. Calculate intersection/difference using turf.js
  // 4. Compute areas and percentages

  // Placeholder analysis showing the structure
  const analysis = {
    totalFeatures: (entry.featureCount as number) || 0,
    totalDistrictArea: 0, // Would be calculated
    cityBoundaryArea: 0, // Would be fetched/calculated
    outsideArea: 0, // Would be calculated
    outsidePercentage: 0, // Would be calculated
    districtBreakdown: [] as DistrictContainment[],
  };

  // Determine verdict based on thresholds
  // Max 15% outside boundary is acceptable
  const OUTSIDE_RATIO_MAX = 0.15;
  let verdict: 'pass' | 'fail' | 'warn' = 'pass';
  const remediation: string[] = [];

  if (analysis.outsidePercentage > OUTSIDE_RATIO_MAX * 100) {
    verdict = 'fail';
    remediation.push(
      `Districts have ${analysis.outsidePercentage.toFixed(1)}% area outside city boundary (max: ${OUTSIDE_RATIO_MAX * 100}%)`
    );
    remediation.push('Verify URL returns correct city-specific data');
    remediation.push('Check if authoritative boundary differs from TIGER');
  } else if (analysis.outsidePercentage > OUTSIDE_RATIO_MAX * 50) {
    verdict = 'warn';
    remediation.push(
      `Districts have ${analysis.outsidePercentage.toFixed(1)}% area outside city boundary`
    );
    remediation.push('Consider investigating boundary alignment');
  }

  return {
    fips,
    cityName,
    state,
    url,
    boundarySource,
    analysis,
    verdict,
    remediation,
  };
}

// ============================================================================
// Coverage Analysis
// ============================================================================

/**
 * Analyze coverage for a city
 *
 * NOTE: This is a simplified implementation. Full implementation would require
 * actual geometric analysis.
 */
export async function analyzeCoverage(
  fips: string,
  options: {
    includeWater?: boolean;
    vintageCompare?: boolean;
  } = {},
): Promise<CoverageReport> {
  const { includeWater = false, vintageCompare = false } = options;

  const found = await getEntryByFips(fips);
  if (!found) {
    throw new Error(`Entry not found for FIPS: ${fips}`);
  }

  const { entry } = found;
  const cityName = entry.cityName as string;
  const state = entry.state as string;

  // Placeholder analysis
  const analysis = {
    cityBoundaryArea: 0, // Would be calculated from boundary
    totalDistrictArea: 0, // Would be calculated from districts
    coverageRatio: 1.0, // Would be calculated
    landArea: includeWater ? 0 : undefined,
    waterArea: includeWater ? 0 : undefined,
    landCoverageRatio: includeWater ? 1.0 : undefined,
    uncoveredAreas: [] as UncoveredArea[],
  };

  let vintageComparison: VintageComparison | undefined;
  if (vintageCompare) {
    vintageComparison = {
      vintages: ['2024', '2023', '2022'],
      areaChanges: [
        { vintage: '2024', area: 0 },
        { vintage: '2023', area: 0, changeFromPrevious: 0 },
        { vintage: '2022', area: 0, changeFromPrevious: 0 },
      ],
    };
  }

  // Determine verdict based on coverage thresholds
  // Coverage should be between 85% and 115% (200% for coastal)
  const COVERAGE_MIN = 0.85;
  const COVERAGE_MAX_INLAND = 1.15;
  const COVERAGE_MAX_COASTAL = 2.0;

  let verdict: 'pass' | 'fail' | 'warn' = 'pass';
  const notes: string[] = [];

  if (analysis.coverageRatio < COVERAGE_MIN) {
    verdict = 'fail';
    notes.push(
      `Coverage ratio ${(analysis.coverageRatio * 100).toFixed(1)}% below minimum ${COVERAGE_MIN * 100}%`
    );
  } else if (analysis.coverageRatio > COVERAGE_MAX_INLAND) {
    verdict = 'warn';
    notes.push(
      `Coverage ratio ${(analysis.coverageRatio * 100).toFixed(1)}% above inland maximum ${COVERAGE_MAX_INLAND * 100}%`
    );
    notes.push('May be acceptable for coastal cities (up to 200%)');
  }

  if (analysis.uncoveredAreas.length > 0) {
    notes.push(`${analysis.uncoveredAreas.length} uncovered areas detected`);
  }

  return {
    fips,
    cityName,
    state,
    analysis,
    vintageComparison,
    verdict,
    notes,
  };
}

// ============================================================================
// Overlap Detection
// ============================================================================

/**
 * Detect overlapping districts
 *
 * NOTE: This is a simplified implementation. Full implementation would require
 * actual geometric intersection analysis.
 */
export async function detectOverlaps(fips: string): Promise<OverlapReport> {
  const found = await getEntryByFips(fips);
  if (!found) {
    throw new Error(`Entry not found for FIPS: ${fips}`);
  }

  const { entry } = found;
  const cityName = entry.cityName as string;
  const state = entry.state as string;
  const featureCount = (entry.featureCount as number) || 0;

  // Placeholder analysis
  // In full implementation, we would:
  // 1. Fetch GeoJSON
  // 2. Compute pairwise intersections
  // 3. Measure overlap areas

  const analysis = {
    totalDistricts: featureCount,
    overlappingPairs: [] as OverlapPair[],
    overlapMatrix: [] as number[][],
    maxOverlapArea: 0,
    hasProblematicOverlaps: false,
  };

  // Overlap threshold: 150,000 sq meters
  const OVERLAP_EPSILON_SQM = 150000;

  let verdict: 'pass' | 'fail' | 'warn' = 'pass';
  const notes: string[] = [];

  if (analysis.maxOverlapArea > OVERLAP_EPSILON_SQM) {
    verdict = 'fail';
    notes.push(
      `Maximum overlap area ${analysis.maxOverlapArea.toLocaleString()} sq m exceeds threshold ${OVERLAP_EPSILON_SQM.toLocaleString()} sq m`
    );
  } else if (analysis.overlappingPairs.length > 0) {
    verdict = 'warn';
    notes.push(
      `${analysis.overlappingPairs.length} district pairs have minor overlaps`
    );
  }

  if (analysis.totalDistricts === 0) {
    verdict = 'fail';
    notes.push('No districts found in data');
  }

  return {
    fips,
    cityName,
    state,
    analysis,
    verdict,
    notes,
  };
}

// ============================================================================
// System Health Check
// ============================================================================

/**
 * Run system health checks
 */
export async function runHealthCheck(
  options: {
    component?: string;
    quick?: boolean;
    layers?: boolean;
    sampleSize?: number;
  } = {},
): Promise<HealthReport> {
  const { component, quick = false, layers = false, sampleSize = 50 } = options;
  const startTime = Date.now();
  const checks: HealthCheck[] = [];

  // Registry integrity check
  if (!component || component === 'registry') {
    const check = await checkRegistryIntegrity();
    checks.push(check);
  }

  // Sync status check
  if (!component || component === 'sync') {
    const check = await checkSyncStatus();
    checks.push(check);
  }

  // Cache freshness check (skip in quick mode)
  if ((!component || component === 'cache') && !quick) {
    const check = await checkCacheFreshness();
    checks.push(check);
  }

  // Quarantine queue check
  if (!component || component === 'quarantine') {
    const check = await checkQuarantineQueue();
    checks.push(check);
  }

  // Snapshots check
  if (!component || component === 'snapshots') {
    const check = await checkSnapshots();
    checks.push(check);
  }

  // External connectivity check (skip in quick mode)
  if ((!component || component === 'connectivity') && !quick) {
    const check = await checkExternalConnectivity();
    checks.push(check);
  }

  // Layer accessibility check (skip in quick mode, only when explicitly enabled)
  let layerAccessibilityCheck: HealthCheck | undefined;
  if ((!component || component === 'layers') && !quick && layers) {
    layerAccessibilityCheck = await checkLayerAccessibility(sampleSize);
    checks.push(layerAccessibilityCheck);
  }

  // Calculate overall health
  const failCount = checks.filter((c) => c.status === 'fail').length;
  const warnCount = checks.filter((c) => c.status === 'warn').length;

  let overall: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
  if (failCount > 0) {
    overall = 'unhealthy';
  } else if (warnCount > 0) {
    overall = 'degraded';
  }

  // Gather metrics
  const metrics = await gatherHealthMetrics(layerAccessibilityCheck);

  return {
    timestamp: new Date().toISOString(),
    overall,
    checks,
    metrics,
  };
}

async function checkRegistryIntegrity(): Promise<HealthCheck> {
  const startTime = Date.now();
  try {
    const counts = await getRegistryCounts();
    const total =
      counts['known-portals'] +
      counts['quarantined-portals'] +
      counts['at-large-cities'];

    return {
      name: 'Registry Integrity',
      status: total > 0 ? 'pass' : 'fail',
      message: `${total} total entries across ${Object.keys(counts).length} registries`,
      duration_ms: Date.now() - startTime,
      details: counts,
    };
  } catch (error) {
    return {
      name: 'Registry Integrity',
      status: 'fail',
      message: error instanceof Error ? error.message : 'Unknown error',
      duration_ms: Date.now() - startTime,
    };
  }
}

async function checkSyncStatus(): Promise<HealthCheck> {
  const startTime = Date.now();

  try {
    // Check if NDJSON and generated TS are in sync by comparing counts
    // Full sync check would use verifyRoundTrip from codegen module
    const ndjsonPath = getNdjsonPath('known-portals');
    const generatedPath = join(
      getPackageRoot(),
      'src',
      'core',
      'registry',
      'known-portals.generated.ts'
    );

    const [ndjsonStat, generatedStat] = await Promise.all([
      stat(ndjsonPath).catch(() => null),
      stat(generatedPath).catch(() => null),
    ]);

    if (!ndjsonStat || !generatedStat) {
      return {
        name: 'NDJSON/TypeScript Sync',
        status: 'warn',
        message: 'Missing registry files',
        duration_ms: Date.now() - startTime,
      };
    }

    // Compare modification times as a quick check
    const timeDiff = Math.abs(
      ndjsonStat.mtimeMs - generatedStat.mtimeMs
    );
    const isRecent = timeDiff < 60000; // Within 1 minute

    return {
      name: 'NDJSON/TypeScript Sync',
      status: isRecent ? 'pass' : 'warn',
      message: isRecent
        ? 'Files appear synchronized'
        : 'Files may be out of sync (run codegen verify)',
      duration_ms: Date.now() - startTime,
      details: {
        ndjsonModified: ndjsonStat.mtime.toISOString(),
        generatedModified: generatedStat.mtime.toISOString(),
      },
    };
  } catch (error) {
    return {
      name: 'NDJSON/TypeScript Sync',
      status: 'fail',
      message: error instanceof Error ? error.message : 'Unknown error',
      duration_ms: Date.now() - startTime,
    };
  }
}

async function checkCacheFreshness(): Promise<HealthCheck> {
  const startTime = Date.now();

  try {
    const cacheDir = join(getPackageRoot(), 'data', 'cache');
    const tigerCacheDir = join(cacheDir, 'tiger');

    try {
      const tigerStat = await stat(tigerCacheDir);
      const ageHours =
        (Date.now() - tigerStat.mtimeMs) / (1000 * 60 * 60);

      const status =
        ageHours < 24 ? 'pass' : ageHours < 168 ? 'warn' : 'fail';

      return {
        name: 'Cache Freshness',
        status,
        message:
          status === 'pass'
            ? 'TIGER cache is fresh'
            : `TIGER cache is ${Math.round(ageHours)} hours old`,
        duration_ms: Date.now() - startTime,
        details: {
          lastModified: tigerStat.mtime.toISOString(),
          ageHours: Math.round(ageHours),
        },
      };
    } catch {
      return {
        name: 'Cache Freshness',
        status: 'warn',
        message: 'No TIGER cache found',
        duration_ms: Date.now() - startTime,
      };
    }
  } catch (error) {
    return {
      name: 'Cache Freshness',
      status: 'fail',
      message: error instanceof Error ? error.message : 'Unknown error',
      duration_ms: Date.now() - startTime,
    };
  }
}

async function checkQuarantineQueue(): Promise<HealthCheck> {
  const startTime = Date.now();

  try {
    const entries = await parseNdjsonEntries(
      getNdjsonPath('quarantined-portals')
    );
    const size = entries.size;

    // Group by pattern
    const byPattern: Record<string, number> = {};
    for (const [, entry] of entries) {
      const pattern = (entry.matchedPattern as string) || 'unknown';
      byPattern[pattern] = (byPattern[pattern] || 0) + 1;
    }

    const status = size === 0 ? 'pass' : size < 20 ? 'warn' : 'fail';

    return {
      name: 'Quarantine Queue',
      status,
      message: `${size} entries in quarantine`,
      duration_ms: Date.now() - startTime,
      details: {
        count: size,
        byPattern,
      },
    };
  } catch (error) {
    return {
      name: 'Quarantine Queue',
      status: 'warn',
      message: 'Could not read quarantine registry',
      duration_ms: Date.now() - startTime,
    };
  }
}

async function checkSnapshots(): Promise<HealthCheck> {
  const startTime = Date.now();

  try {
    const snapshots = await listSnapshots();

    return {
      name: 'Snapshots',
      status: snapshots.length > 0 ? 'pass' : 'warn',
      message: `${snapshots.length} snapshots available`,
      duration_ms: Date.now() - startTime,
      details: {
        count: snapshots.length,
        latest: snapshots[0]?.createdAt,
      },
    };
  } catch (error) {
    return {
      name: 'Snapshots',
      status: 'warn',
      message: 'Could not list snapshots',
      duration_ms: Date.now() - startTime,
    };
  }
}

async function checkExternalConnectivity(): Promise<HealthCheck> {
  const startTime = Date.now();

  // In a full implementation, we would check:
  // - TIGER Web services
  // - ArcGIS REST services
  // - Other data sources

  // Placeholder: just return a pass for now
  return {
    name: 'External Connectivity',
    status: 'skip',
    message: 'Connectivity check not implemented',
    duration_ms: Date.now() - startTime,
  };
}

/**
 * Layer accessibility result for a single layer
 */
interface LayerAccessibilityResult {
  url: string;
  cityName: string;
  status: 'ACCESSIBLE' | 'INACCESSIBLE' | 'TIMEOUT' | 'ERROR';
  hasExtent: boolean;
  hasGeometry: boolean;
  errorMessage?: string;
}

/**
 * Fetch with timeout utility
 */
async function fetchWithTimeout(
  url: string,
  timeout = 5000
): Promise<Response | null> {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch {
    return null;
  }
}

/**
 * Extract base URL from a URL that might be a query endpoint
 * e.g., "https://example.com/FeatureServer/0/query?where=1=1&f=geojson" -> "https://example.com/FeatureServer/0"
 */
function extractBaseUrl(url: string): string {
  // If URL contains /query, extract the base before it
  const queryIndex = url.indexOf('/query');
  if (queryIndex !== -1) {
    return url.substring(0, queryIndex);
  }

  // If URL has query parameters but no /query path, strip them
  const queryParamIndex = url.indexOf('?');
  if (queryParamIndex !== -1) {
    return url.substring(0, queryParamIndex);
  }

  return url;
}

/**
 * Check accessibility of a single layer
 */
async function checkSingleLayer(
  url: string,
  cityName: string
): Promise<LayerAccessibilityResult> {
  const result: LayerAccessibilityResult = {
    url,
    cityName,
    status: 'ERROR',
    hasExtent: false,
    hasGeometry: false,
  };

  try {
    // Extract base URL for metadata check
    const baseUrl = extractBaseUrl(url);

    // Check metadata endpoint
    const metaResponse = await fetchWithTimeout(`${baseUrl}?f=json`);
    if (!metaResponse) {
      result.status = 'TIMEOUT';
      return result;
    }

    const meta = await metaResponse.json();
    if (meta.error) {
      result.status = 'INACCESSIBLE';
      result.errorMessage = meta.error.message;
      return result;
    }

    result.status = 'ACCESSIBLE';

    // Check for extent
    if (meta.extent) {
      result.hasExtent = true;
    }

    // Check for geometry availability (quick query)
    // Use the original URL if it's already a query endpoint, otherwise construct one
    let geometryCheckUrl: string;
    if (url.includes('/query')) {
      // URL is already a query endpoint, just ensure it returns geometry
      geometryCheckUrl = url;
    } else {
      // Construct a query endpoint
      geometryCheckUrl = `${baseUrl}/query?where=1%3D1&returnGeometry=true&outSR=4326&resultRecordCount=1&f=json`;
    }

    const queryResponse = await fetchWithTimeout(geometryCheckUrl, 8000);
    if (queryResponse) {
      const queryData = await queryResponse.json();
      if (queryData.features?.[0]?.geometry) {
        result.hasGeometry = true;
      }
    }

    return result;
  } catch (e) {
    result.errorMessage = (e as Error).message;
    return result;
  }
}

/**
 * Check layer accessibility for a sample of known portals
 */
async function checkLayerAccessibility(
  sampleSize: number
): Promise<HealthCheck> {
  const startTime = Date.now();

  try {
    // Clamp sample size
    const clampedSize = Math.min(Math.max(1, sampleSize), 500);

    // Load known portals
    const entries = await parseNdjsonEntries(getNdjsonPath('known-portals'));
    const allEntries = Array.from(entries.values());

    // Sample randomly
    const sampledEntries = allEntries
      .sort(() => Math.random() - 0.5)
      .slice(0, clampedSize);

    // Check each layer
    const results: LayerAccessibilityResult[] = [];
    const stats = {
      accessible: 0,
      inaccessible: 0,
      timeout: 0,
      error: 0,
      hasExtent: 0,
      hasGeometry: 0,
    };

    for (const entry of sampledEntries) {
      const url = entry.downloadUrl as string;
      const cityName = entry.cityName as string;

      const result = await checkSingleLayer(url, cityName);
      results.push(result);

      // Update stats
      const statusKey = result.status.toLowerCase() as keyof typeof stats;
      if (statusKey in stats) {
        stats[statusKey]++;
      }
      if (result.hasExtent) stats.hasExtent++;
      if (result.hasGeometry) stats.hasGeometry++;
    }

    // Calculate rates
    const accessibilityRate = (stats.accessible / results.length) * 100;
    const dataAvailabilityRate =
      stats.accessible > 0
        ? (stats.hasGeometry / stats.accessible) * 100
        : 0;

    // Determine status
    let status: 'pass' | 'fail' | 'warn' = 'pass';
    let message = `Layer accessibility: ${accessibilityRate.toFixed(1)}% (${stats.accessible}/${results.length})`;

    if (accessibilityRate < 80) {
      status = 'fail';
      message = `Low accessibility rate: ${accessibilityRate.toFixed(1)}% (threshold: 80%)`;
    } else if (accessibilityRate < 95) {
      status = 'warn';
      message = `Accessibility rate: ${accessibilityRate.toFixed(1)}% (target: 95%)`;
    }

    return {
      name: 'Layer Accessibility',
      status,
      message,
      duration_ms: Date.now() - startTime,
      details: {
        sampleSize: results.length,
        accessible: stats.accessible,
        inaccessible: stats.inaccessible,
        timeout: stats.timeout,
        error: stats.error,
        accessibilityRate: parseFloat(accessibilityRate.toFixed(1)),
        dataAvailabilityRate: parseFloat(dataAvailabilityRate.toFixed(1)),
        hasExtent: stats.hasExtent,
        hasGeometry: stats.hasGeometry,
      },
    };
  } catch (error) {
    return {
      name: 'Layer Accessibility',
      status: 'fail',
      message: error instanceof Error ? error.message : 'Unknown error',
      duration_ms: Date.now() - startTime,
    };
  }
}

async function gatherHealthMetrics(layerAccessibilityCheck?: HealthCheck): Promise<HealthMetrics> {
  const counts = await getRegistryCounts();

  // Quarantine breakdown
  let byPattern: Record<string, number> = {};
  let oldestEntry: string | undefined;

  try {
    const entries = await parseNdjsonEntries(
      getNdjsonPath('quarantined-portals')
    );

    for (const [, entry] of entries) {
      const pattern = (entry.matchedPattern as string) || 'unknown';
      byPattern[pattern] = (byPattern[pattern] || 0) + 1;

      const quarantinedAt = entry.quarantinedAt as string | undefined;
      if (quarantinedAt && (!oldestEntry || quarantinedAt < oldestEntry)) {
        oldestEntry = quarantinedAt;
      }
    }
  } catch {
    // Ignore errors
  }

  const snapshots = await listSnapshots().catch(() => []);

  // Build layer accessibility metrics if the check was performed
  let layerAccessibility: HealthMetrics['layerAccessibility'];
  if (layerAccessibilityCheck && layerAccessibilityCheck.details) {
    layerAccessibility = {
      sampleSize: layerAccessibilityCheck.details.sampleSize as number,
      accessibleCount: layerAccessibilityCheck.details.accessible as number,
      inaccessibleCount: layerAccessibilityCheck.details.inaccessible as number,
      timeoutCount: layerAccessibilityCheck.details.timeout as number,
      errorCount: layerAccessibilityCheck.details.error as number,
      accessibilityRate: layerAccessibilityCheck.details.accessibilityRate as number,
      dataAvailabilityRate: layerAccessibilityCheck.details.dataAvailabilityRate as number,
    };
  }

  return {
    registryIntegrity: {
      knownPortals: counts['known-portals'],
      quarantined: counts['quarantined-portals'],
      atLarge: counts['at-large-cities'],
      syncStatus: 'unknown', // Would require full verification
    },
    cacheStatus: {
      // Would be populated from cache analysis
    },
    quarantineQueue: {
      size: counts['quarantined-portals'],
      oldestEntry,
      byPattern,
    },
    snapshotCount: snapshots.length,
    layerAccessibility,
  };
}
