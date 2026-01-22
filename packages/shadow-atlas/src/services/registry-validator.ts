/**
 * Registry Validator - Automated URL Health Checking
 *
 * PURPOSE: Daily validation of known-portals registry
 * STRATEGY: HTTP health checks + GeoJSON validation
 * SCALE: 1000+ registry entries (future)
 */

import type { KnownPortal } from '../core/registry/known-portals.generated.js';
import { logger } from '../core/utils/logger.js';

/**
 * Health check result for a registry entry
 */
export interface HealthCheckResult {
  readonly fips: string;
  readonly cityName: string;
  readonly state: string;
  readonly url: string;
  readonly status: 'healthy' | 'warning' | 'error';
  readonly httpStatus: number;
  readonly responseTime: number; // ms
  readonly featureCount: number | null;
  readonly expectedFeatures: number;
  readonly featureCountMatch: boolean;
  readonly schemaValid: boolean;
  readonly dataFresh: boolean;
  readonly issues: readonly string[];
  readonly checkedAt: string; // ISO timestamp
}

/**
 * Health check summary
 */
export interface HealthCheckSummary {
  readonly totalEntries: number;
  readonly healthy: number;
  readonly warnings: number;
  readonly errors: number;
  readonly averageResponseTime: number;
  readonly results: readonly HealthCheckResult[];
}

/**
 * Check if URL uses stable API pattern (FeatureServer/MapServer, not Hub download)
 *
 * Hub download URLs redirect to temporary Azure blobs that expire.
 * FeatureServer/MapServer URLs are stable and always return current data.
 */
function isStableUrlPattern(url: string): { stable: boolean; warning?: string } {
  // UNSTABLE: hub.arcgis.com/api/download URLs redirect to temp Azure blobs
  if (url.includes('hub.arcgis.com/api/download')) {
    return {
      stable: false,
      warning: 'URL uses hub.arcgis.com download API which redirects to temporary Azure blobs. Use direct FeatureServer/MapServer query instead.',
    };
  }

  // STABLE: Direct FeatureServer or MapServer queries
  if (url.includes('/FeatureServer/') || url.includes('/MapServer/')) {
    return { stable: true };
  }

  // STABLE: Socrata and other direct APIs
  if (url.includes('api/geospatial') || url.includes('data.') || url.includes('/resource/')) {
    return { stable: true };
  }

  // STABLE: hub.arcgis.com/api/v3 (newer stable API)
  if (url.includes('hub.arcgis.com/api/v3')) {
    return { stable: true };
  }

  // UNKNOWN: Not recognized, but don't fail
  return {
    stable: true,
    warning: 'URL pattern not recognized. Verify this is a stable, non-expiring endpoint.',
  };
}

/**
 * Validate a single registry entry
 *
 * @param fips - City FIPS code
 * @param portal - Portal configuration
 * @returns Health check result
 */
export async function validatePortal(
  fips: string,
  portal: KnownPortal
): Promise<HealthCheckResult> {
  const issues: string[] = [];
  let httpStatus = 0;
  let featureCount: number | null = null;
  let schemaValid = false;
  let dataFresh = false;

  const startTime = Date.now();

  // Check URL pattern BEFORE making HTTP request
  const urlCheck = isStableUrlPattern(portal.downloadUrl);
  if (!urlCheck.stable) {
    issues.push(urlCheck.warning || 'Unstable URL pattern detected');
  } else if (urlCheck.warning) {
    issues.push(urlCheck.warning);
  }

  try {
    // Always use GET to fetch actual data (HEAD isn't reliable across portals)
    const response = await fetch(portal.downloadUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });

    httpStatus = response.status;

    if (httpStatus !== 200) {
      issues.push(`HTTP ${httpStatus}: ${response.statusText}`);
    }

    // Parse GeoJSON if we got 200 OK
    if (httpStatus === 200) {
      const data = await response.json() as {
        type?: string;
        features?: unknown[];
        metadata?: {
          lastUpdated?: string;
        };
      };

      // Validate GeoJSON structure
      if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
        schemaValid = true;
        featureCount = data.features.length;

        // Check feature count
        if (featureCount !== portal.featureCount) {
          const diff = Math.abs(featureCount - portal.featureCount);
          if (diff > 2) {
            issues.push(
              `Feature count mismatch: expected ${portal.featureCount}, got ${featureCount}`
            );
          }
        }

        // Check for required fields
        if (data.features.length > 0) {
          const firstFeature = data.features[0] as {
            geometry?: unknown;
            properties?: unknown;
          };
          if (!firstFeature.geometry || !firstFeature.properties) {
            issues.push('Invalid GeoJSON: missing geometry or properties');
            schemaValid = false;
          }
        }

        // Check data freshness (if metadata available)
        if (data.metadata?.lastUpdated) {
          const lastUpdated = new Date(data.metadata.lastUpdated);
          const ageInDays = (Date.now() - lastUpdated.getTime()) / (24 * 60 * 60 * 1000);
          dataFresh = ageInDays <= 90;

          if (!dataFresh) {
            issues.push(`Stale data: last updated ${Math.floor(ageInDays)} days ago`);
          }
        } else {
          // If no metadata, assume fresh (many portals don't include this)
          dataFresh = true;
        }
      } else {
        issues.push('Invalid GeoJSON structure');
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError' || error.name === 'TimeoutError') {
        issues.push('Request timeout (>30s)');
      } else {
        issues.push(`Error: ${error.message}`);
      }
    } else {
      issues.push('Unknown error occurred');
    }
  }

  const responseTime = Date.now() - startTime;

  // Determine status
  let status: 'healthy' | 'warning' | 'error' = 'healthy';
  if (issues.length > 0) {
    status = httpStatus === 200 ? 'warning' : 'error';
  }

  return {
    fips,
    cityName: portal.cityName,
    state: portal.state,
    url: portal.downloadUrl,
    status,
    httpStatus,
    responseTime,
    featureCount,
    expectedFeatures: portal.featureCount,
    featureCountMatch: featureCount === portal.featureCount,
    schemaValid,
    dataFresh,
    issues,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Validate entire known-portals registry
 *
 * @param registry - Known portals registry
 * @param concurrency - Number of parallel checks
 * @returns Health check summary
 */
export async function validateRegistry(
  registry: Record<string, KnownPortal>,
  concurrency: number = 5
): Promise<HealthCheckSummary> {
  const entries = Object.entries(registry);
  const results: HealthCheckResult[] = [];

  logger.info('Starting registry validation', {
    totalEntries: entries.length,
    concurrency,
  });

  // Process in batches
  for (let i = 0; i < entries.length; i += concurrency) {
    const batch = entries.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map(([fips, portal]) => validatePortal(fips, portal))
    );

    results.push(...batchResults);

    // Progress update
    const progress = ((results.length / entries.length) * 100).toFixed(1);
    logger.info('Validation progress', {
      completed: results.length,
      total: entries.length,
      progressPercent: progress,
    });
  }

  // Calculate summary
  const healthy = results.filter((r) => r.status === 'healthy').length;
  const warnings = results.filter((r) => r.status === 'warning').length;
  const errors = results.filter((r) => r.status === 'error').length;
  const avgResponseTime =
    results.reduce((sum, r) => sum + r.responseTime, 0) / results.length;

  return {
    totalEntries: results.length,
    healthy,
    warnings,
    errors,
    averageResponseTime: avgResponseTime,
    results,
  };
}
