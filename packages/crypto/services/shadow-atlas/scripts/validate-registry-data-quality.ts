/**
 * Registry Data Quality Validation Script
 *
 * PURPOSE: Validate ALL URLs in known-portals registry against validation pipeline
 *
 * CHECKS:
 * - Validity: Does URL return 200? Valid GeoJSON?
 * - Precision: Does feature count match registry?
 * - Accuracy: Does bounding box match city location?
 * - Freshness: Is lastVerified > 90 days old?
 *
 * USAGE:
 *   npx tsx services/shadow-atlas/scripts/validate-registry-data-quality.ts
 *
 * OUTPUT:
 *   JSON report with per-city validation results + summary statistics
 */

import { KNOWN_PORTALS, isStale } from '../registry/known-portals.js';
import { EXPECTED_DISTRICT_COUNTS } from '../registry/district-count-registry.js';
import { PostDownloadValidator } from '../acquisition/post-download-validator.js';
import type { KnownPortal } from '../registry/known-portals.js';
import type { FeatureCollection } from 'geojson';

interface CityValidationResult {
  readonly cityFips: string;
  readonly cityName: string;
  readonly state: string;
  readonly status: 'valid' | 'invalid' | 'stale' | 'feature-mismatch' | 'confidence-degradation';
  readonly registry: {
    readonly url: string;
    readonly expectedFeatures: number;
    readonly expectedConfidence: number;
    readonly lastVerified: string;
  };
  readonly validation: {
    readonly httpStatus: number | null;
    readonly actualFeatures: number | null;
    readonly actualConfidence: number | null;
    readonly boundingBox: readonly [number, number, number, number] | null;
    readonly issues: readonly string[];
    readonly warnings: readonly string[];
  };
  readonly staleDays?: number;
  readonly featureDiff?: number;
  readonly confidenceDiff?: number;
}

interface QualityReport {
  readonly timestamp: string;
  readonly totalCities: number;
  readonly valid: number;
  readonly invalid: number;
  readonly stale: number;
  readonly featureCountMismatches: number;
  readonly confidenceDegradation: number;
  readonly results: readonly CityValidationResult[];
  readonly summary: {
    readonly byStatus: Record<string, number>;
    readonly byPortalType: Record<string, { valid: number; total: number }>;
    readonly avgConfidenceDiff: number;
    readonly criticalFailures: readonly string[];
  };
}

/**
 * Download GeoJSON from URL with timeout
 */
async function downloadGeoJSON(url: string, timeoutMs: number = 30000): Promise<FeatureCollection | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'VOTER-Protocol-Shadow-Atlas/1.0 (Data Quality Validation)',
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`[${url}] HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();

    // Type guard
    if (
      typeof data === 'object' &&
      data !== null &&
      'type' in data &&
      data.type === 'FeatureCollection' &&
      'features' in data &&
      Array.isArray(data.features)
    ) {
      return data as FeatureCollection;
    }

    console.error(`[${url}] Not a valid FeatureCollection`);
    return null;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        console.error(`[${url}] Timeout after ${timeoutMs}ms`);
      } else {
        console.error(`[${url}] Error: ${error.message}`);
      }
    }
    return null;
  }
}

/**
 * Validate a single city portal entry
 */
async function validateCity(portal: KnownPortal): Promise<CityValidationResult> {
  console.log(`\n[${portal.cityName}, ${portal.state}] Validating...`);

  // Check staleness
  const lastVerified = new Date(portal.lastVerified);
  const now = new Date();
  const staleDays = (now.getTime() - lastVerified.getTime()) / (1000 * 60 * 60 * 24);
  const staleThreshold = 90;

  if (staleDays > staleThreshold) {
    console.log(`  STALE: ${Math.floor(staleDays)} days since last verification`);
  }

  // Download GeoJSON
  const geojson = await downloadGeoJSON(portal.downloadUrl);

  if (!geojson) {
    return {
      cityFips: portal.cityFips,
      cityName: portal.cityName,
      state: portal.state,
      status: 'invalid',
      registry: {
        url: portal.downloadUrl,
        expectedFeatures: portal.featureCount,
        expectedConfidence: portal.confidence,
        lastVerified: portal.lastVerified,
      },
      validation: {
        httpStatus: null,
        actualFeatures: null,
        actualConfidence: null,
        boundingBox: null,
        issues: ['Failed to download or parse GeoJSON'],
        warnings: [],
      },
      staleDays: staleDays > staleThreshold ? Math.floor(staleDays) : undefined,
    };
  }

  // Run through PostDownloadValidator
  const validator = new PostDownloadValidator({
    minFeatures: 1,
    maxFeatures: 100,
    requirePolygons: true,
    strictBounds: true,
  });

  const validationResult = validator.validate(geojson, {
    source: portal.downloadUrl,
    city: portal.cityName,
  });

  console.log(`  Features: ${validationResult.metadata.featureCount} (expected: ${portal.featureCount})`);
  console.log(`  Confidence: ${validationResult.confidence}% (expected: ${portal.confidence}%)`);
  console.log(`  Valid: ${validationResult.valid}`);

  if (validationResult.issues.length > 0) {
    console.log(`  Issues: ${validationResult.issues.join('; ')}`);
  }

  if (validationResult.warnings.length > 0) {
    console.log(`  Warnings: ${validationResult.warnings.join('; ')}`);
  }

  // Compute diffs
  const featureDiff = validationResult.metadata.featureCount - portal.featureCount;
  const confidenceDiff = validationResult.confidence - portal.confidence;

  // Determine status
  let status: CityValidationResult['status'] = 'valid';

  if (!validationResult.valid || validationResult.confidence < 50) {
    status = 'invalid';
  } else if (Math.abs(featureDiff) > 0) {
    status = 'feature-mismatch';
  } else if (confidenceDiff < -10) {
    status = 'confidence-degradation';
  } else if (staleDays > staleThreshold) {
    status = 'stale';
  }

  return {
    cityFips: portal.cityFips,
    cityName: portal.cityName,
    state: portal.state,
    status,
    registry: {
      url: portal.downloadUrl,
      expectedFeatures: portal.featureCount,
      expectedConfidence: portal.confidence,
      lastVerified: portal.lastVerified,
    },
    validation: {
      httpStatus: 200,
      actualFeatures: validationResult.metadata.featureCount,
      actualConfidence: validationResult.confidence,
      boundingBox: validationResult.metadata.boundingBox,
      issues: validationResult.issues,
      warnings: validationResult.warnings,
    },
    staleDays: staleDays > staleThreshold ? Math.floor(staleDays) : undefined,
    featureDiff: featureDiff !== 0 ? featureDiff : undefined,
    confidenceDiff: confidenceDiff < -10 ? confidenceDiff : undefined,
  };
}

/**
 * Validate all cities in known-portals registry
 */
async function validateRegistry(): Promise<QualityReport> {
  const portals = Object.values(KNOWN_PORTALS);
  const results: CityValidationResult[] = [];

  console.log(`\n=== REGISTRY DATA QUALITY VALIDATION ===`);
  console.log(`Total cities: ${portals.length}\n`);

  // Validate each city sequentially (to avoid overwhelming servers)
  for (const portal of portals) {
    const result = await validateCity(portal);
    results.push(result);

    // Rate limiting: 1 request per second
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // Compute summary statistics
  const byStatus: Record<string, number> = {};
  const byPortalType: Record<string, { valid: number; total: number }> = {};

  for (const result of results) {
    byStatus[result.status] = (byStatus[result.status] || 0) + 1;

    const portal = KNOWN_PORTALS[result.cityFips];
    if (!byPortalType[portal.portalType]) {
      byPortalType[portal.portalType] = { valid: 0, total: 0 };
    }
    byPortalType[portal.portalType].total++;
    if (result.status === 'valid') {
      byPortalType[portal.portalType].valid++;
    }
  }

  const confidenceDiffs = results
    .filter((r) => r.confidenceDiff !== undefined)
    .map((r) => r.confidenceDiff as number);

  const avgConfidenceDiff =
    confidenceDiffs.length > 0 ? confidenceDiffs.reduce((sum, d) => sum + d, 0) / confidenceDiffs.length : 0;

  const criticalFailures = results
    .filter((r) => r.status === 'invalid')
    .map((r) => `${r.cityName}, ${r.state} (${r.cityFips})`);

  return {
    timestamp: new Date().toISOString(),
    totalCities: results.length,
    valid: byStatus['valid'] || 0,
    invalid: byStatus['invalid'] || 0,
    stale: byStatus['stale'] || 0,
    featureCountMismatches: byStatus['feature-mismatch'] || 0,
    confidenceDegradation: byStatus['confidence-degradation'] || 0,
    results,
    summary: {
      byStatus,
      byPortalType,
      avgConfidenceDiff,
      criticalFailures,
    },
  };
}

/**
 * Main entry point
 */
async function main() {
  const report = await validateRegistry();

  console.log(`\n\n=== VALIDATION SUMMARY ===`);
  console.log(`Total cities: ${report.totalCities}`);
  console.log(`Valid: ${report.valid}`);
  console.log(`Invalid: ${report.invalid}`);
  console.log(`Stale (>90 days): ${report.stale}`);
  console.log(`Feature count mismatches: ${report.featureCountMismatches}`);
  console.log(`Confidence degradation: ${report.confidenceDegradation}`);
  console.log(`\nAverage confidence diff: ${report.summary.avgConfidenceDiff.toFixed(1)}%`);

  console.log(`\n=== BY STATUS ===`);
  for (const [status, count] of Object.entries(report.summary.byStatus)) {
    console.log(`  ${status}: ${count}`);
  }

  console.log(`\n=== BY PORTAL TYPE ===`);
  for (const [portalType, stats] of Object.entries(report.summary.byPortalType)) {
    const successRate = ((stats.valid / stats.total) * 100).toFixed(1);
    console.log(`  ${portalType}: ${stats.valid}/${stats.total} (${successRate}%)`);
  }

  if (report.summary.criticalFailures.length > 0) {
    console.log(`\n=== CRITICAL FAILURES ===`);
    for (const city of report.summary.criticalFailures) {
      console.log(`  - ${city}`);
    }
  }

  // Find feature mismatches
  const featureMismatches = report.results.filter((r) => r.featureDiff !== undefined);
  if (featureMismatches.length > 0) {
    console.log(`\n=== FEATURE COUNT MISMATCHES ===`);
    for (const result of featureMismatches) {
      console.log(
        `  ${result.cityName}, ${result.state}: expected ${result.registry.expectedFeatures}, got ${result.validation.actualFeatures} (diff: ${result.featureDiff})`
      );
    }
  }

  // Find confidence degradations
  const confidenceDegradations = report.results.filter((r) => r.confidenceDiff !== undefined);
  if (confidenceDegradations.length > 0) {
    console.log(`\n=== CONFIDENCE DEGRADATIONS ===`);
    for (const result of confidenceDegradations) {
      console.log(
        `  ${result.cityName}, ${result.state}: expected ${result.registry.expectedConfidence}%, got ${result.validation.actualConfidence}% (diff: ${result.confidenceDiff}%)`
      );
    }
  }

  // Write report to file
  const reportPath = `registry-quality-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const reportJson = JSON.stringify(report, null, 2);

  const fs = await import('fs/promises');
  await fs.writeFile(reportPath, reportJson, 'utf-8');
  console.log(`\n=== REPORT SAVED ===`);
  console.log(`File: ${reportPath}`);
  console.log(`Size: ${(reportJson.length / 1024).toFixed(1)} KB`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
