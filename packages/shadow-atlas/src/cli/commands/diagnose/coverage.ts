#!/usr/bin/env npx tsx
/**
 * Diagnose Coverage Command
 *
 * Analyze coverage metrics for a city - check if districts adequately
 * cover the city boundary. Enhanced with deep failure analysis, pattern
 * recognition, and recovery potential assessment.
 *
 * USAGE:
 *   shadow-atlas diagnose coverage <fips> [options]
 *
 * OPTIONS:
 *   --include-water       Include water area analysis
 *   --vintage-compare     Compare across TIGER vintages
 *   --deep                Enable deep failure analysis
 *   --categorize          Categorize failure patterns
 *   --recovery-potential  Assess recovery potential for failures
 *   --layer-diagnostics   Per-layer diagnostic details
 *   --limit <n>           Limit analysis to N unresolved layers (default: 50)
 *
 * EXAMPLES:
 *   shadow-atlas diagnose coverage 0666000
 *   shadow-atlas diagnose coverage 0666000 --deep --categorize
 *   shadow-atlas diagnose coverage 0666000 --recovery-potential --limit 100
 *
 * @module cli/commands/diagnose/coverage
 */

import {
  analyzeCoverage,
  type CoverageReport,
} from '../../lib/diagnostics.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Types
// ============================================================================

export interface CoverageOptions {
  readonly fips: string;
  readonly includeWater?: boolean;
  readonly vintageCompare?: boolean;
  readonly verbose?: boolean;
  readonly json?: boolean;
  readonly deep?: boolean;
  readonly categorize?: boolean;
  readonly recoveryPotential?: boolean;
  readonly layerDiagnostics?: boolean;
  readonly limit?: number;
}

// Failure Analysis Types

export type FailureCategory =
  | 'METADATA_TIMEOUT'
  | 'METADATA_HTTP_ERROR'
  | 'METADATA_ERROR'
  | 'NO_EXTENT'
  | 'QUERY_TIMEOUT'
  | 'QUERY_HTTP_ERROR'
  | 'QUERY_ERROR'
  | 'NO_FEATURES'
  | 'NO_GEOMETRY'
  | 'GEOMETRY_PARSE_ERROR'
  | 'GEOCODE_TIMEOUT'
  | 'GEOCODE_HTTP_ERROR'
  | 'NOT_INCORPORATED_PLACE'
  | 'OUTSIDE_CONUS'
  | 'NO_CENSUS_PLACE'
  | 'UNKNOWN';

export type RecoveryPotential = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

export interface UnresolvedLayer {
  url: string;
  name: string;
  failureReason?: string;
  failureCategories?: FailureCategory[];
  metadata?: {
    name?: string;
    description?: string;
    copyrightText?: string;
    extent?: {
      spatialReference?: { wkid?: number; latestWkid?: number };
    };
  };
  centroidResult?: string;
  geocodeResult?: string;
  recoveryPotential?: RecoveryPotential;
  recoveryStrategy?: string;
  isInternational?: boolean;
  isDomestic?: boolean;
}

export interface FailurePattern {
  category: FailureCategory;
  count: number;
  percentage: number;
  examples: UnresolvedLayer[];
  isSystemic: boolean;
  remediationPath?: string;
}

export interface DeepCoverageAnalysis {
  summary: {
    totalAnalyzed: number;
    resolved: number;
    unresolved: number;
    analysisDepth: 'basic' | 'deep' | 'comprehensive';
  };
  failurePatterns?: FailurePattern[];
  recoveryAssessment?: {
    high: number;
    medium: number;
    low: number;
    none: number;
    topCandidates: UnresolvedLayer[];
  };
  layerDiagnostics?: UnresolvedLayer[];
  geographicClassification?: {
    domestic: number;
    international: number;
    unknown: number;
  };
}

export interface CoverageResult {
  readonly success: boolean;
  readonly report?: CoverageReport;
  readonly deepAnalysis?: DeepCoverageAnalysis;
  readonly error?: string;
}

// ============================================================================
// Failure Analysis Engine
// ============================================================================

/**
 * Fetch with timeout utility
 */
async function fetchWithTimeout(url: string, timeout = 10000): Promise<Response | null> {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (e) {
    return null;
  }
}

/**
 * Analyze a single layer for failures
 */
async function analyzeLayer(url: string, name: string): Promise<UnresolvedLayer> {
  const result: UnresolvedLayer = { url, name };
  const failures: string[] = [];

  // Step 1: Fetch metadata
  try {
    const metaResponse = await fetchWithTimeout(`${url}?f=json`);
    if (!metaResponse) {
      failures.push('METADATA_TIMEOUT');
    } else if (!metaResponse.ok) {
      failures.push(`METADATA_HTTP_${metaResponse.status}`);
    } else {
      const meta = await metaResponse.json();
      result.metadata = {
        name: meta.name,
        description: meta.description,
        copyrightText: meta.copyrightText,
        extent: meta.extent,
      };

      if (!meta.extent) {
        failures.push('NO_EXTENT');
      }
    }
  } catch (e) {
    failures.push(`METADATA_ERROR: ${(e as Error).message}`);
  }

  // Step 2: Query for geometry
  try {
    const queryUrl = `${url}/query?where=1=1&returnGeometry=true&outSR=4326&resultRecordCount=1&f=json`;
    const queryResponse = await fetchWithTimeout(queryUrl, 15000);

    if (!queryResponse) {
      failures.push('QUERY_TIMEOUT');
    } else if (!queryResponse.ok) {
      failures.push(`QUERY_HTTP_${queryResponse.status}`);
    } else {
      const data = await queryResponse.json();

      if (data.error) {
        failures.push(`QUERY_ERROR: ${data.error.message || data.error.code}`);
        result.centroidResult = JSON.stringify(data.error);
      } else if (!data.features || data.features.length === 0) {
        failures.push('NO_FEATURES');
        result.centroidResult = 'Empty features array';
      } else if (!data.features[0].geometry) {
        failures.push('NO_GEOMETRY');
        result.centroidResult = 'Feature has no geometry';
      } else {
        const geom = data.features[0].geometry;
        let centroid: { lat: number; lon: number } | null = null;

        if (geom.rings && geom.rings[0]) {
          const ring = geom.rings[0];
          let sumX = 0, sumY = 0;
          for (const [x, y] of ring) {
            sumX += x;
            sumY += y;
          }
          centroid = { lon: sumX / ring.length, lat: sumY / ring.length };
        } else if (typeof geom.x === 'number' && typeof geom.y === 'number') {
          centroid = { lon: geom.x, lat: geom.y };
        }

        if (centroid) {
          result.centroidResult = `${centroid.lat.toFixed(4)}, ${centroid.lon.toFixed(4)}`;

          // Classify geographic location
          result.isDomestic = centroid.lon >= -130 && centroid.lon <= -65 &&
                            centroid.lat >= 24 && centroid.lat <= 50;
          result.isInternational = !result.isDomestic;

          // Step 3: Try Census geocoder (only for domestic)
          if (result.isDomestic) {
            const geocodeUrl = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${centroid.lon}&y=${centroid.lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=28&format=json`;
            const geocodeResponse = await fetchWithTimeout(geocodeUrl);

            if (!geocodeResponse) {
              failures.push('GEOCODE_TIMEOUT');
            } else if (!geocodeResponse.ok) {
              failures.push(`GEOCODE_HTTP_${geocodeResponse.status}`);
            } else {
              const geocodeData = await geocodeResponse.json();
              const place = geocodeData.result?.geographies?.['Incorporated Places']?.[0];

              if (!place) {
                const county = geocodeData.result?.geographies?.['Counties']?.[0];
                if (county) {
                  failures.push('NOT_INCORPORATED_PLACE');
                  result.geocodeResult = `In ${county.NAME}, but not in an incorporated city`;
                } else {
                  failures.push('NO_CENSUS_PLACE');
                  result.geocodeResult = 'Geocoder returned no place';
                }
              } else {
                result.geocodeResult = `${place.NAME} (${place.GEOID})`;
              }
            }
          } else {
            failures.push('OUTSIDE_CONUS');
            result.geocodeResult = `Coordinates outside continental US: ${centroid.lat.toFixed(2)}, ${centroid.lon.toFixed(2)}`;
          }
        } else {
          failures.push('GEOMETRY_PARSE_ERROR');
        }
      }
    }
  } catch (e) {
    failures.push(`QUERY_EXCEPTION: ${(e as Error).message}`);
  }

  result.failureReason = failures.join(' | ');
  result.failureCategories = parseFailureCategories(failures);

  return result;
}

/**
 * Parse failure strings into categories
 */
function parseFailureCategories(failures: string[]): FailureCategory[] {
  const categories: FailureCategory[] = [];

  for (const failure of failures) {
    const category = failure.split(':')[0].split('_').slice(0, 2).join('_');
    if (isValidCategory(category)) {
      categories.push(category as FailureCategory);
    }
  }

  return categories.length > 0 ? categories : ['UNKNOWN'];
}

/**
 * Check if category is valid
 */
function isValidCategory(category: string): boolean {
  const validCategories = [
    'METADATA_TIMEOUT', 'METADATA_HTTP', 'METADATA_ERROR', 'NO_EXTENT',
    'QUERY_TIMEOUT', 'QUERY_HTTP', 'QUERY_ERROR', 'NO_FEATURES',
    'NO_GEOMETRY', 'GEOMETRY_PARSE', 'GEOCODE_TIMEOUT', 'GEOCODE_HTTP',
    'NOT_INCORPORATED', 'OUTSIDE_CONUS', 'NO_CENSUS'
  ];
  return validCategories.some(valid => category.startsWith(valid));
}

/**
 * Assess recovery potential for a layer
 */
function assessRecoveryPotential(layer: UnresolvedLayer): {
  potential: RecoveryPotential;
  strategy: string;
} {
  const categories = layer.failureCategories || [];

  // HIGH: Temporary issues or timeout-related
  if (categories.some(c => c.includes('TIMEOUT'))) {
    return {
      potential: 'HIGH',
      strategy: 'Retry with increased timeout and rate limiting'
    };
  }

  // HIGH: Metadata available, query issues
  if (layer.metadata && categories.some(c => c.includes('QUERY'))) {
    return {
      potential: 'HIGH',
      strategy: 'Adjust query parameters or use alternative query patterns'
    };
  }

  // MEDIUM: International or non-incorporated place
  if (layer.isInternational || categories.includes('NOT_INCORPORATED_PLACE')) {
    return {
      potential: 'MEDIUM',
      strategy: 'Use international geocoding service or county-level resolution'
    };
  }

  // MEDIUM: Has geometry but geocoding failed
  if (layer.centroidResult && !layer.centroidResult.includes('N/A')) {
    return {
      potential: 'MEDIUM',
      strategy: 'Try alternative geocoding services (Nominatim, Geocodio)'
    };
  }

  // LOW: No geometry or features
  if (categories.includes('NO_FEATURES') || categories.includes('NO_GEOMETRY')) {
    return {
      potential: 'LOW',
      strategy: 'Check if layer requires authentication or is deprecated'
    };
  }

  // LOW: HTTP errors (likely permissions or deprecation)
  if (categories.some(c => c.includes('HTTP_4') || c.includes('HTTP_5'))) {
    return {
      potential: 'LOW',
      strategy: 'Verify layer URL, check for API changes or authentication requirements'
    };
  }

  // NONE: Outside scope or fundamental issues
  if (categories.includes('OUTSIDE_CONUS') && !layer.isInternational) {
    return {
      potential: 'NONE',
      strategy: 'Layer appears to be outside project scope (territories/international)'
    };
  }

  return {
    potential: 'LOW',
    strategy: 'Manual investigation required'
  };
}

/**
 * Perform deep coverage analysis
 */
async function performDeepAnalysis(
  options: CoverageOptions
): Promise<DeepCoverageAnalysis | null> {
  // Load unresolved layers data
  const dataPath = path.join(
    __dirname,
    '../../../agents/data/attributed-council-districts.json'
  );

  if (!fs.existsSync(dataPath)) {
    console.warn('Warning: attributed-council-districts.json not found, skipping deep analysis');
    return null;
  }

  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const unresolvedInputs = data.unresolved || [];

  const limit = options.limit || 50;
  const toAnalyze = unresolvedInputs.slice(0, limit);

  if (!options.json) {
    console.log(`\nDeep Analysis: Analyzing ${toAnalyze.length} unresolved layers...`);
  }

  const analyzed: UnresolvedLayer[] = [];
  const failureCategories: Record<FailureCategory, number> = {} as Record<FailureCategory, number>;

  // Analyze layers
  for (let i = 0; i < toAnalyze.length; i++) {
    const layer = toAnalyze[i];
    const analysis = await analyzeLayer(layer.url, layer.name);

    // Assess recovery potential
    const { potential, strategy } = assessRecoveryPotential(analysis);
    analysis.recoveryPotential = potential;
    analysis.recoveryStrategy = strategy;

    analyzed.push(analysis);

    // Categorize failures
    for (const category of analysis.failureCategories || []) {
      failureCategories[category] = (failureCategories[category] || 0) + 1;
    }

    if (!options.json && (i + 1) % 10 === 0) {
      console.log(`  Progress: ${i + 1}/${toAnalyze.length}`);
    }
  }

  // Build failure patterns
  const patterns: FailurePattern[] = [];
  const totalAnalyzed = analyzed.length;

  for (const [category, count] of Object.entries(failureCategories)) {
    const percentage = (count / totalAnalyzed) * 100;
    const examples = analyzed
      .filter(a => a.failureCategories?.includes(category as FailureCategory))
      .slice(0, 3);

    const isSystemic = percentage > 20; // More than 20% = systemic issue

    patterns.push({
      category: category as FailureCategory,
      count,
      percentage,
      examples,
      isSystemic,
      remediationPath: getRemediationPath(category as FailureCategory, isSystemic)
    });
  }

  patterns.sort((a, b) => b.count - a.count);

  // Recovery assessment
  const recoveryByPotential = {
    high: analyzed.filter(a => a.recoveryPotential === 'HIGH').length,
    medium: analyzed.filter(a => a.recoveryPotential === 'MEDIUM').length,
    low: analyzed.filter(a => a.recoveryPotential === 'LOW').length,
    none: analyzed.filter(a => a.recoveryPotential === 'NONE').length,
  };

  const topCandidates = analyzed
    .filter(a => a.recoveryPotential === 'HIGH' || a.recoveryPotential === 'MEDIUM')
    .slice(0, 10);

  // Geographic classification
  const geoClassification = {
    domestic: analyzed.filter(a => a.isDomestic).length,
    international: analyzed.filter(a => a.isInternational).length,
    unknown: analyzed.filter(a => !a.isDomestic && !a.isInternational).length,
  };

  return {
    summary: {
      totalAnalyzed: analyzed.length,
      resolved: 0, // Would come from original data
      unresolved: analyzed.length,
      analysisDepth: options.categorize ? 'comprehensive' : 'deep',
    },
    failurePatterns: options.categorize ? patterns : undefined,
    recoveryAssessment: options.recoveryPotential ? {
      ...recoveryByPotential,
      topCandidates
    } : undefined,
    layerDiagnostics: options.layerDiagnostics ? analyzed : undefined,
    geographicClassification: geoClassification,
  };
}

/**
 * Get remediation path for failure category
 */
function getRemediationPath(category: FailureCategory, isSystemic: boolean): string {
  const paths: Record<FailureCategory, string> = {
    METADATA_TIMEOUT: 'Implement retry logic with exponential backoff',
    METADATA_HTTP_ERROR: 'Check API endpoint status, verify authentication',
    METADATA_ERROR: 'Validate URL format, check network connectivity',
    NO_EXTENT: 'Skip or manually configure extent for layer',
    QUERY_TIMEOUT: 'Increase timeout, reduce query complexity',
    QUERY_HTTP_ERROR: 'Verify layer permissions and API access',
    QUERY_ERROR: 'Adjust query parameters, check layer capabilities',
    NO_FEATURES: 'Verify layer has data, check query filters',
    NO_GEOMETRY: 'Check layer configuration, verify geometry field',
    GEOMETRY_PARSE_ERROR: 'Implement robust geometry parsing with fallbacks',
    GEOCODE_TIMEOUT: 'Increase timeout, implement caching',
    GEOCODE_HTTP_ERROR: 'Check Census API status, implement fallback geocoder',
    NOT_INCORPORATED_PLACE: 'Use county-level or alternative resolution strategy',
    OUTSIDE_CONUS: 'Implement international geocoding or mark as out-of-scope',
    NO_CENSUS_PLACE: 'Try alternative geocoding services',
    UNKNOWN: 'Manual investigation required',
  };

  const basePath = paths[category] || 'Manual investigation required';

  if (isSystemic) {
    return `SYSTEMIC: ${basePath} - affects >20% of layers, prioritize fix`;
  }

  return basePath;
}

// ============================================================================
// Command Implementation
// ============================================================================

/**
 * Run the coverage command
 */
export async function runCoverage(options: CoverageOptions): Promise<CoverageResult> {
  const {
    fips,
    includeWater = false,
    vintageCompare = false,
    verbose = false,
    json = false,
    deep = false,
    categorize = false,
    recoveryPotential = false,
    layerDiagnostics = false
  } = options;

  if (!json) {
    console.log(`Analyzing coverage for FIPS ${fips}...\n`);
  }

  try {
    // Basic coverage analysis
    const report = await analyzeCoverage(fips, { includeWater, vintageCompare });

    // Deep analysis if requested
    let deepAnalysis: DeepCoverageAnalysis | null = null;

    if (deep || categorize || recoveryPotential || layerDiagnostics) {
      deepAnalysis = await performDeepAnalysis(options);
    }

    // Output formatting
    if (!json) {
      printReport(report, verbose);

      if (deepAnalysis) {
        printDeepAnalysis(deepAnalysis, options);
      }
    }

    if (json) {
      console.log(JSON.stringify({
        success: true,
        report,
        deepAnalysis: deepAnalysis || undefined
      }, null, 2));
    }

    return {
      success: report.verdict !== 'fail',
      report,
      deepAnalysis: deepAnalysis || undefined
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (!json) {
      console.error(`Coverage analysis failed: ${errorMessage}`);
    }

    if (json) {
      console.log(JSON.stringify({ success: false, error: errorMessage }, null, 2));
    }

    return { success: false, error: errorMessage };
  }
}

/**
 * Print coverage report to console
 */
function printReport(report: CoverageReport, verbose: boolean): void {
  const verdictIcons = { pass: '[PASS]', fail: '[FAIL]', warn: '[WARN]' };
  const verdictIcon = verdictIcons[report.verdict];

  console.log('Coverage Analysis Report');
  console.log('========================\n');

  console.log(`City: ${report.cityName}, ${report.state}`);
  console.log(`FIPS: ${report.fips}`);
  console.log('');

  console.log('Analysis Results:');
  console.log(`  City Boundary Area: ${formatArea(report.analysis.cityBoundaryArea)}`);
  console.log(`  Total District Area: ${formatArea(report.analysis.totalDistrictArea)}`);
  console.log(`  Coverage Ratio: ${(report.analysis.coverageRatio * 100).toFixed(1)}%`);

  if (report.analysis.landArea !== undefined) {
    console.log('');
    console.log('Land/Water Breakdown:');
    console.log(`  Land Area: ${formatArea(report.analysis.landArea || 0)}`);
    console.log(`  Water Area: ${formatArea(report.analysis.waterArea || 0)}`);
    console.log(`  Land Coverage Ratio: ${((report.analysis.landCoverageRatio || 0) * 100).toFixed(1)}%`);
  }

  console.log('');

  if (report.analysis.uncoveredAreas.length > 0) {
    console.log('Uncovered Areas:');
    for (const area of report.analysis.uncoveredAreas) {
      console.log(`  - ${area.description}`);
      console.log(`    Approximate Area: ${formatArea(area.approximateArea)}`);
      if (area.location) {
        console.log(`    Location: ${area.location.lat.toFixed(4)}, ${area.location.lng.toFixed(4)}`);
      }
    }
    console.log('');
  }

  if (report.vintageComparison && verbose) {
    console.log('TIGER Vintage Comparison:');
    for (const entry of report.vintageComparison.areaChanges) {
      const change = entry.changeFromPrevious !== undefined
        ? ` (${entry.changeFromPrevious >= 0 ? '+' : ''}${entry.changeFromPrevious.toFixed(1)}%)`
        : '';
      console.log(`  ${entry.vintage}: ${formatArea(entry.area)}${change}`);
    }
    console.log('');
  }

  console.log(`Verdict: ${verdictIcon}`);
  console.log('');

  if (report.notes.length > 0) {
    console.log('Notes:');
    for (const note of report.notes) {
      console.log(`  - ${note}`);
    }
  }
}

/**
 * Print deep analysis results (Progressive Disclosure)
 */
function printDeepAnalysis(analysis: DeepCoverageAnalysis, options: CoverageOptions): void {
  console.log('\n' + '='.repeat(80));
  console.log('DEEP FAILURE ANALYSIS');
  console.log('='.repeat(80) + '\n');

  // Summary (always shown)
  console.log('Summary:');
  console.log(`  Total Analyzed: ${analysis.summary.totalAnalyzed}`);
  console.log(`  Unresolved: ${analysis.summary.unresolved}`);
  console.log(`  Analysis Depth: ${analysis.summary.analysisDepth}`);

  // Geographic Classification
  if (analysis.geographicClassification) {
    console.log('\nGeographic Distribution:');
    console.log(`  Domestic (CONUS): ${analysis.geographicClassification.domestic}`);
    console.log(`  International: ${analysis.geographicClassification.international}`);
    console.log(`  Unknown: ${analysis.geographicClassification.unknown}`);
  }

  // Failure Patterns (--categorize)
  if (options.categorize && analysis.failurePatterns) {
    console.log('\n' + '-'.repeat(80));
    console.log('FAILURE PATTERN CATEGORIZATION');
    console.log('-'.repeat(80) + '\n');

    // Systemic issues first
    const systemic = analysis.failurePatterns.filter(p => p.isSystemic);
    const oneOff = analysis.failurePatterns.filter(p => !p.isSystemic);

    if (systemic.length > 0) {
      console.log('SYSTEMIC ISSUES (>20% of failures):');
      for (const pattern of systemic) {
        console.log(`\n  ${pattern.category} - ${pattern.count} occurrences (${pattern.percentage.toFixed(1)}%)`);
        console.log(`    Remediation: ${pattern.remediationPath}`);
        console.log('    Examples:');
        for (const example of pattern.examples.slice(0, 2)) {
          console.log(`      - ${example.name}`);
          console.log(`        ${example.url}`);
        }
      }
    }

    if (oneOff.length > 0) {
      console.log('\n\nONE-OFF ISSUES (<20% of failures):');
      for (const pattern of oneOff.slice(0, 5)) {
        console.log(`  ${pattern.category.padEnd(30)} ${pattern.count.toString().padStart(4)} (${pattern.percentage.toFixed(1)}%)`);
      }
    }
  }

  // Recovery Potential (--recovery-potential)
  if (options.recoveryPotential && analysis.recoveryAssessment) {
    console.log('\n' + '-'.repeat(80));
    console.log('RECOVERY POTENTIAL ASSESSMENT');
    console.log('-'.repeat(80) + '\n');

    const { high, medium, low, none, topCandidates } = analysis.recoveryAssessment;
    const total = high + medium + low + none;

    console.log('Recovery Distribution:');
    console.log(`  HIGH:   ${high.toString().padStart(4)} (${((high / total) * 100).toFixed(1)}%) - Quick wins, retry with adjustments`);
    console.log(`  MEDIUM: ${medium.toString().padStart(4)} (${((medium / total) * 100).toFixed(1)}%) - Requires alternative strategy`);
    console.log(`  LOW:    ${low.toString().padStart(4)} (${((low / total) * 100).toFixed(1)}%) - Difficult, manual investigation`);
    console.log(`  NONE:   ${none.toString().padStart(4)} (${((none / total) * 100).toFixed(1)}%) - Out of scope`);

    if (topCandidates.length > 0) {
      console.log('\n\nTop Recovery Candidates:');
      for (let i = 0; i < Math.min(5, topCandidates.length); i++) {
        const candidate = topCandidates[i];
        console.log(`\n  ${i + 1}. ${candidate.name} [${candidate.recoveryPotential}]`);
        console.log(`     URL: ${candidate.url}`);
        console.log(`     Strategy: ${candidate.recoveryStrategy}`);
        if (candidate.centroidResult) {
          console.log(`     Location: ${candidate.centroidResult}`);
        }
      }
    }
  }

  // Layer Diagnostics (--layer-diagnostics)
  if (options.layerDiagnostics && analysis.layerDiagnostics) {
    console.log('\n' + '-'.repeat(80));
    console.log('PER-LAYER DIAGNOSTICS');
    console.log('-'.repeat(80) + '\n');

    const layers = analysis.layerDiagnostics.slice(0, 10); // Show first 10

    for (const layer of layers) {
      console.log(`\nLayer: ${layer.name}`);
      console.log(`  URL: ${layer.url}`);
      console.log(`  Failure: ${layer.failureReason || 'UNKNOWN'}`);
      console.log(`  Recovery Potential: ${layer.recoveryPotential || 'UNKNOWN'}`);
      console.log(`  Geographic: ${layer.isDomestic ? 'Domestic' : layer.isInternational ? 'International' : 'Unknown'}`);

      if (layer.metadata) {
        console.log('  Metadata:');
        if (layer.metadata.description) {
          console.log(`    Description: ${layer.metadata.description.slice(0, 60)}...`);
        }
        if (layer.metadata.copyrightText) {
          console.log(`    Copyright: ${layer.metadata.copyrightText.slice(0, 60)}...`);
        }
      }

      if (layer.centroidResult) {
        console.log(`  Centroid: ${layer.centroidResult}`);
      }

      if (layer.geocodeResult) {
        console.log(`  Geocode: ${layer.geocodeResult}`);
      }

      console.log(`  Strategy: ${layer.recoveryStrategy || 'N/A'}`);
    }

    if (analysis.layerDiagnostics.length > 10) {
      console.log(`\n  ... and ${analysis.layerDiagnostics.length - 10} more layers`);
      console.log('  (use --limit to analyze more)');
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('END DEEP ANALYSIS');
  console.log('='.repeat(80) + '\n');
}

/**
 * Format area in square meters/kilometers
 */
function formatArea(sqm: number): string {
  if (sqm === 0) return '0 sq m';
  if (sqm < 1000000) return `${sqm.toLocaleString()} sq m`;
  return `${(sqm / 1000000).toFixed(2)} sq km`;
}

// ============================================================================
// CLI Entry Point
// ============================================================================

function parseArgs(args: readonly string[]): CoverageOptions | null {
  let fips: string | undefined;
  let includeWater = false;
  let vintageCompare = false;
  let verbose = false;
  let json = false;
  let deep = false;
  let categorize = false;
  let recoveryPotential = false;
  let layerDiagnostics = false;
  let limit: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--include-water':
        includeWater = true;
        break;

      case '--vintage-compare':
        vintageCompare = true;
        break;

      case '--deep':
        deep = true;
        break;

      case '--categorize':
        categorize = true;
        deep = true; // Implies deep analysis
        break;

      case '--recovery-potential':
        recoveryPotential = true;
        deep = true; // Implies deep analysis
        break;

      case '--layer-diagnostics':
        layerDiagnostics = true;
        deep = true; // Implies deep analysis
        break;

      case '--limit':
        if (i + 1 < args.length) {
          const value = parseInt(args[i + 1], 10);
          if (isNaN(value) || value < 1) {
            console.error('Error: --limit must be a positive integer');
            process.exit(1);
          }
          limit = value;
          i++; // Skip the next argument
        } else {
          console.error('Error: --limit requires a value');
          process.exit(1);
        }
        break;

      case '--verbose':
      case '-v':
        verbose = true;
        break;

      case '--json':
        json = true;
        break;

      case '--help':
      case '-h':
        printHelp();
        process.exit(0);

      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
        // Positional argument: FIPS
        if (!fips) {
          fips = arg;
        } else {
          console.error(`Unexpected argument: ${arg}`);
          process.exit(1);
        }
    }
  }

  if (!fips) {
    console.error('Error: FIPS code is required.');
    console.error('Usage: shadow-atlas diagnose coverage <fips> [options]');
    process.exit(1);
  }

  // Validate FIPS format (7 digits)
  if (!/^\d{7}$/.test(fips)) {
    console.error('Error: FIPS must be a 7-digit Census PLACE code');
    process.exit(1);
  }

  return {
    fips,
    includeWater,
    vintageCompare,
    verbose,
    json,
    deep,
    categorize,
    recoveryPotential,
    layerDiagnostics,
    limit
  };
}

function printHelp(): void {
  console.log(`
shadow-atlas diagnose coverage - Analyze coverage metrics with deep failure analysis

USAGE:
  shadow-atlas diagnose coverage <fips> [options]

ARGUMENTS:
  fips                    7-digit Census PLACE FIPS code

BASIC OPTIONS:
  --include-water         Include water area in analysis
  --vintage-compare       Compare coverage across TIGER vintages
  --verbose, -v           Show detailed output
  --json                  Output results as JSON
  --help, -h              Show this help message

DEEP ANALYSIS OPTIONS:
  --deep                  Enable deep failure analysis (analyzes unresolved layers)
  --categorize            Categorize failure patterns (systemic vs one-off)
  --recovery-potential    Assess recovery potential for each failure
  --layer-diagnostics     Show per-layer diagnostic details
  --limit <n>             Limit deep analysis to N layers (default: 50)

COVERAGE THRESHOLDS:
  - Minimum: 85% (districts should cover at least 85% of city)
  - Maximum inland: 115% (some overlap expected)
  - Maximum coastal: 200% (water areas may be included)

FAILURE CATEGORIES:
  Systemic Issues (>20% of failures):
    - METADATA_TIMEOUT: Service timeouts, needs retry logic
    - QUERY_TIMEOUT: Query timeouts, increase timeout/reduce complexity
    - GEOCODE_TIMEOUT: Geocoding timeouts, implement caching

  One-off Issues (<20% of failures):
    - NOT_INCORPORATED_PLACE: County-level or alternative resolution
    - OUTSIDE_CONUS: International or out-of-scope
    - NO_FEATURES: Authentication or deprecated layers

RECOVERY POTENTIAL:
  - HIGH: Temporary issues, retry with adjustments
  - MEDIUM: Alternative strategy required
  - LOW: Manual investigation needed
  - NONE: Out of project scope

PROGRESSIVE DISCLOSURE:
  1. Basic: shadow-atlas diagnose coverage <fips>
     Summary metrics and verdict

  2. Deep: shadow-atlas diagnose coverage <fips> --deep
     Basic + failure analysis summary

  3. Categorized: shadow-atlas diagnose coverage <fips> --categorize
     Deep + systemic vs one-off pattern breakdown

  4. Recovery: shadow-atlas diagnose coverage <fips> --recovery-potential
     Deep + recovery candidates and strategies

  5. Comprehensive: shadow-atlas diagnose coverage <fips> --categorize --recovery-potential --layer-diagnostics
     All analysis layers with per-layer details

EXAMPLES:
  # Basic coverage check
  shadow-atlas diagnose coverage 0666000

  # Deep failure analysis with pattern categorization
  shadow-atlas diagnose coverage 0666000 --deep --categorize

  # Recovery assessment for unresolved layers
  shadow-atlas diagnose coverage 0666000 --recovery-potential --limit 100

  # Comprehensive analysis (all options)
  shadow-atlas diagnose coverage 0666000 --categorize --recovery-potential --layer-diagnostics

  # JSON output for automation
  shadow-atlas diagnose coverage 0666000 --deep --json
`);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options) {
    runCoverage(options)
      .then((result) => {
        process.exit(result.success ? 0 : 1);
      })
      .catch((error) => {
        console.error('Coverage analysis failed:', error);
        process.exit(1);
      });
  }
}
