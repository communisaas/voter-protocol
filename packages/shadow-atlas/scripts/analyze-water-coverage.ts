#!/usr/bin/env npx tsx
/**
 * Water Area Coverage Analysis (WS-5)
 *
 * Analyzes how water area affects council district tessellation validation.
 * Many coastal and waterfront cities have districts that extend into water
 * bodies (bays, rivers, lakes). The TIGER Census API provides both ALAND
 * and AWATER. Districts often include jurisdictional waters.
 *
 * KEY INSIGHT:
 * - San Francisco has ~47 sq mi of land but ~185 sq mi of jurisdictional water
 * - Districts drawn to include water show >100% coverage against land-only area
 * - We need to understand the correlation between water % and validation failures
 *
 * USAGE:
 *   npx tsx scripts/analyze-water-coverage.ts [--limit N] [--threshold N] [--verbose]
 *
 * OPTIONS:
 *   --limit N       Process only first N cities (default: all)
 *   --threshold N   Minimum water % to consider "water-heavy" (default: 10)
 *   --verbose       Show detailed diagnostics for each city
 *   --coastal-only  Only analyze cities above water threshold
 */

import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import * as turf from '@turf/turf';
import { KNOWN_PORTALS, type KnownPortal } from '../src/core/registry/known-portals.js';
import { TessellationProofValidator, type TessellationProof } from '../src/validators/council/tessellation-proof.js';
import { MunicipalBoundaryResolver, type MunicipalBoundary } from '../src/validators/council/municipal-boundary.js';
import { EXPECTED_DISTRICT_COUNTS } from '../src/core/registry/district-count-registry.js';

// =============================================================================
// Configuration
// =============================================================================

interface Config {
  limit: number | null;
  waterThreshold: number;
  verbose: boolean;
  coastalOnly: boolean;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  const config: Config = {
    limit: null,
    waterThreshold: 10, // 10% water by default
    verbose: false,
    coastalOnly: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--limit':
        config.limit = parseInt(args[++i], 10);
        break;
      case '--threshold':
        config.waterThreshold = parseInt(args[++i], 10);
        break;
      case '--verbose':
        config.verbose = true;
        break;
      case '--coastal-only':
        config.coastalOnly = true;
        break;
    }
  }

  return config;
}

// =============================================================================
// Types
// =============================================================================

interface WaterAnalysisResult {
  fips: string;
  cityName: string;
  state: string;

  // Area data from TIGER
  landAreaSqM: number;
  waterAreaSqM: number;
  totalAreaSqM: number;
  waterPercentage: number;
  isCoastal: boolean;  // water > threshold

  // Coverage calculations
  districtUnionAreaSqM: number;
  landOnlyCoverageRatio: number;    // district_area / land_area
  totalCoverageRatio: number;        // district_area / (land + water)
  coverageDifference: number;        // difference between the two

  // Validation status
  validationPassed: boolean;
  failedAxiom: string | null;
  failureReason: string | null;

  // Diagnostic flags
  fetchFailed: boolean;
  boundaryFailed: boolean;
}

// =============================================================================
// District Fetching
// =============================================================================

async function fetchDistricts(url: string): Promise<FeatureCollection<Polygon | MultiPolygon> | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'VOTER-Protocol/1.0 (Water-Coverage-Analysis)',
        Accept: 'application/geo+json, application/json',
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (!data.features || !Array.isArray(data.features)) {
      return null;
    }

    return data as FeatureCollection<Polygon | MultiPolygon>;
  } catch {
    return null;
  }
}

// =============================================================================
// Area Calculation
// =============================================================================

/**
 * Compute union area of district features
 * Uses turf.rewind to normalize winding order (critical for correct area)
 */
function computeDistrictUnionArea(districts: FeatureCollection<Polygon | MultiPolygon>): number {
  const features = districts.features
    .filter((f) => f && f.geometry && f.geometry.type && f.geometry.coordinates)
    .map((f) => turf.rewind(f, { reverse: false }) as turf.Feature<Polygon | MultiPolygon>);

  if (features.length === 0) {
    return 0;
  }

  let unionResult = features[0];
  for (let i = 1; i < features.length; i++) {
    try {
      const union = turf.union(turf.featureCollection([unionResult, features[i]]));
      if (union) {
        unionResult = union as turf.Feature<Polygon | MultiPolygon>;
      }
    } catch {
      // Continue with partial union
    }
  }

  return turf.area(unionResult);
}

// =============================================================================
// Analysis Pipeline
// =============================================================================

async function analyzeCity(
  portal: KnownPortal,
  boundaryResolver: MunicipalBoundaryResolver,
  tessellationValidator: TessellationProofValidator,
  waterThreshold: number
): Promise<WaterAnalysisResult> {
  const result: WaterAnalysisResult = {
    fips: portal.cityFips,
    cityName: portal.cityName,
    state: portal.state,
    landAreaSqM: 0,
    waterAreaSqM: 0,
    totalAreaSqM: 0,
    waterPercentage: 0,
    isCoastal: false,
    districtUnionAreaSqM: 0,
    landOnlyCoverageRatio: 0,
    totalCoverageRatio: 0,
    coverageDifference: 0,
    validationPassed: false,
    failedAxiom: null,
    failureReason: null,
    fetchFailed: false,
    boundaryFailed: false,
  };

  // Fetch boundary first to get water/land areas
  const boundaryResult = await boundaryResolver.resolve(portal.cityFips);

  if (!boundaryResult.success || !boundaryResult.boundary) {
    result.boundaryFailed = true;
    return result;
  }

  const boundary = boundaryResult.boundary;
  result.landAreaSqM = boundary.landAreaSqM;
  result.waterAreaSqM = boundary.waterAreaSqM;
  result.totalAreaSqM = boundary.landAreaSqM + boundary.waterAreaSqM;
  result.waterPercentage = result.totalAreaSqM > 0
    ? (boundary.waterAreaSqM / result.totalAreaSqM) * 100
    : 0;
  result.isCoastal = result.waterPercentage >= waterThreshold;

  // Fetch districts
  const districts = await fetchDistricts(portal.downloadUrl);

  if (!districts || districts.features.length === 0) {
    result.fetchFailed = true;
    return result;
  }

  // Compute district union area
  result.districtUnionAreaSqM = computeDistrictUnionArea(districts);

  // Calculate coverage ratios
  if (result.landAreaSqM > 0) {
    result.landOnlyCoverageRatio = result.districtUnionAreaSqM / result.landAreaSqM;
  }
  if (result.totalAreaSqM > 0) {
    result.totalCoverageRatio = result.districtUnionAreaSqM / result.totalAreaSqM;
  }
  result.coverageDifference = result.landOnlyCoverageRatio - result.totalCoverageRatio;

  // Run tessellation validation
  const registryEntry = EXPECTED_DISTRICT_COUNTS[portal.cityFips];
  const expectedCount = registryEntry?.expectedDistrictCount ?? districts.features.length;

  const proof = tessellationValidator.prove(
    districts,
    boundary.geometry,
    expectedCount,
    boundary.landAreaSqM,
    undefined,  // No authoritative area
    boundary.waterAreaSqM,
    portal.cityFips
  );

  result.validationPassed = proof.valid;
  result.failedAxiom = proof.failedAxiom;
  result.failureReason = proof.reason;

  return result;
}

// =============================================================================
// Statistics
// =============================================================================

interface WaterAnalysisStats {
  totalCities: number;
  coastalCities: number;
  inlandCities: number;

  coastalPassed: number;
  coastalFailed: number;
  inlandPassed: number;
  inlandFailed: number;

  coastalPassRate: number;
  inlandPassRate: number;

  avgWaterPercentCoastal: number;
  avgWaterPercentInland: number;

  avgCoverageDifferenceCoastal: number;
  avgCoverageDifferenceInland: number;

  // Failure correlation
  failedByAxiom: Record<string, { coastal: number; inland: number }>;
}

function computeStats(results: WaterAnalysisResult[]): WaterAnalysisStats {
  const validResults = results.filter(r => !r.fetchFailed && !r.boundaryFailed);
  const coastal = validResults.filter(r => r.isCoastal);
  const inland = validResults.filter(r => !r.isCoastal);

  const coastalPassed = coastal.filter(r => r.validationPassed).length;
  const inlandPassed = inland.filter(r => r.validationPassed).length;

  // Failure breakdown by axiom
  const failedByAxiom: Record<string, { coastal: number; inland: number }> = {};
  for (const result of validResults) {
    if (!result.validationPassed && result.failedAxiom) {
      if (!failedByAxiom[result.failedAxiom]) {
        failedByAxiom[result.failedAxiom] = { coastal: 0, inland: 0 };
      }
      if (result.isCoastal) {
        failedByAxiom[result.failedAxiom].coastal++;
      } else {
        failedByAxiom[result.failedAxiom].inland++;
      }
    }
  }

  return {
    totalCities: validResults.length,
    coastalCities: coastal.length,
    inlandCities: inland.length,
    coastalPassed,
    coastalFailed: coastal.length - coastalPassed,
    inlandPassed,
    inlandFailed: inland.length - inlandPassed,
    coastalPassRate: coastal.length > 0 ? (coastalPassed / coastal.length) * 100 : 0,
    inlandPassRate: inland.length > 0 ? (inlandPassed / inland.length) * 100 : 0,
    avgWaterPercentCoastal: coastal.length > 0
      ? coastal.reduce((sum, r) => sum + r.waterPercentage, 0) / coastal.length
      : 0,
    avgWaterPercentInland: inland.length > 0
      ? inland.reduce((sum, r) => sum + r.waterPercentage, 0) / inland.length
      : 0,
    avgCoverageDifferenceCoastal: coastal.length > 0
      ? coastal.reduce((sum, r) => sum + r.coverageDifference, 0) / coastal.length
      : 0,
    avgCoverageDifferenceInland: inland.length > 0
      ? inland.reduce((sum, r) => sum + r.coverageDifference, 0) / inland.length
      : 0,
    failedByAxiom,
  };
}

// =============================================================================
// Formatting Helpers
// =============================================================================

function formatArea(sqM: number): string {
  const sqMi = sqM / 2_589_988; // sq meters to sq miles
  return `${sqMi.toFixed(2)} sq mi`;
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const config = parseArgs();

  console.log('================================================================');
  console.log('            WATER AREA COVERAGE ANALYSIS (WS-5)');
  console.log('   Correlation between water % and validation failures');
  console.log('================================================================\n');

  console.log(`Water threshold: ${config.waterThreshold}% (cities above this = "coastal")\n`);

  // Get cities to analyze
  let portals = Object.values(KNOWN_PORTALS);

  if (config.limit) {
    portals = portals.slice(0, config.limit);
  }

  console.log(`Processing ${portals.length} cities from known-portals registry...\n`);

  // Initialize resolvers
  const boundaryResolver = new MunicipalBoundaryResolver();
  const tessellationValidator = new TessellationProofValidator();

  // Process all cities
  const results: WaterAnalysisResult[] = [];

  for (let i = 0; i < portals.length; i++) {
    const portal = portals[i];
    const progress = `[${i + 1}/${portals.length}]`;

    process.stdout.write(`${progress} ${portal.cityName}, ${portal.state}... `);

    const result = await analyzeCity(portal, boundaryResolver, tessellationValidator, config.waterThreshold);
    results.push(result);

    if (result.fetchFailed || result.boundaryFailed) {
      console.log('SKIP (data unavailable)');
    } else if (config.verbose) {
      const status = result.validationPassed ? 'PASS' : `FAIL (${result.failedAxiom})`;
      console.log(`${status} | water: ${result.waterPercentage.toFixed(1)}% | land-coverage: ${formatPercent(result.landOnlyCoverageRatio)} | total-coverage: ${formatPercent(result.totalCoverageRatio)}`);
    } else {
      console.log(result.validationPassed ? 'PASS' : 'FAIL');
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, 50));
  }

  // Filter to coastal only if requested
  const analysisResults = config.coastalOnly
    ? results.filter(r => r.isCoastal && !r.fetchFailed && !r.boundaryFailed)
    : results.filter(r => !r.fetchFailed && !r.boundaryFailed);

  // Compute statistics
  const stats = computeStats(results);

  // Print summary
  console.log('\n================================================================');
  console.log('                        SUMMARY');
  console.log('================================================================\n');

  console.log('CITY DISTRIBUTION:');
  console.log(`  Total analyzed:     ${stats.totalCities}`);
  console.log(`  Coastal (>${config.waterThreshold}% water): ${stats.coastalCities}`);
  console.log(`  Inland  (<${config.waterThreshold}% water): ${stats.inlandCities}`);

  console.log('\nVALIDATION PASS RATES:');
  console.log(`  Coastal: ${stats.coastalPassed}/${stats.coastalCities} (${stats.coastalPassRate.toFixed(1)}%)`);
  console.log(`  Inland:  ${stats.inlandPassed}/${stats.inlandCities} (${stats.inlandPassRate.toFixed(1)}%)`);

  console.log('\nAVERAGE WATER PERCENTAGE:');
  console.log(`  Coastal: ${stats.avgWaterPercentCoastal.toFixed(1)}%`);
  console.log(`  Inland:  ${stats.avgWaterPercentInland.toFixed(1)}%`);

  console.log('\nAVERAGE COVERAGE DIFFERENCE (land-only vs total):');
  console.log(`  Coastal: ${(stats.avgCoverageDifferenceCoastal * 100).toFixed(2)} percentage points`);
  console.log(`  Inland:  ${(stats.avgCoverageDifferenceInland * 100).toFixed(2)} percentage points`);

  console.log('\nFAILURE BREAKDOWN BY AXIOM:');
  for (const [axiom, counts] of Object.entries(stats.failedByAxiom)) {
    console.log(`  ${axiom}:`);
    console.log(`    Coastal: ${counts.coastal}`);
    console.log(`    Inland:  ${counts.inland}`);
  }

  // List high-water cities
  const highWaterCities = analysisResults
    .filter(r => r.waterPercentage >= config.waterThreshold)
    .sort((a, b) => b.waterPercentage - a.waterPercentage);

  if (highWaterCities.length > 0) {
    console.log('\n================================================================');
    console.log('           HIGH-WATER CITIES (sorted by water %)');
    console.log('================================================================\n');

    console.log('FIPS       City                 State  Water%   Land-Cov  Total-Cov  Diff      Status');
    console.log('-'.repeat(100));

    for (const city of highWaterCities.slice(0, 50)) {
      const status = city.validationPassed ? 'PASS' : `FAIL:${city.failedAxiom}`;
      console.log(
        `${city.fips.padEnd(10)} ` +
        `${city.cityName.slice(0, 20).padEnd(20)} ` +
        `${city.state.padEnd(6)} ` +
        `${city.waterPercentage.toFixed(1).padStart(5)}%   ` +
        `${formatPercent(city.landOnlyCoverageRatio).padStart(7)}   ` +
        `${formatPercent(city.totalCoverageRatio).padStart(7)}    ` +
        `${(city.coverageDifference * 100).toFixed(1).padStart(5)}pp   ` +
        `${status}`
      );
    }

    if (highWaterCities.length > 50) {
      console.log(`... and ${highWaterCities.length - 50} more`);
    }
  }

  // List failed coastal cities (highest priority for investigation)
  const failedCoastal = analysisResults
    .filter(r => r.isCoastal && !r.validationPassed)
    .sort((a, b) => b.waterPercentage - a.waterPercentage);

  if (failedCoastal.length > 0) {
    console.log('\n================================================================');
    console.log('        FAILED COASTAL CITIES (investigation priority)');
    console.log('================================================================\n');

    for (const city of failedCoastal.slice(0, 20)) {
      console.log(`${city.cityName}, ${city.state} (${city.fips})`);
      console.log(`  Water: ${city.waterPercentage.toFixed(1)}%`);
      console.log(`  Land area: ${formatArea(city.landAreaSqM)}`);
      console.log(`  Water area: ${formatArea(city.waterAreaSqM)}`);
      console.log(`  District area: ${formatArea(city.districtUnionAreaSqM)}`);
      console.log(`  Land-only coverage: ${formatPercent(city.landOnlyCoverageRatio)}`);
      console.log(`  Total coverage: ${formatPercent(city.totalCoverageRatio)}`);
      console.log(`  Failed axiom: ${city.failedAxiom}`);
      console.log(`  Reason: ${city.failureReason}`);
      console.log('');
    }
  }

  // Correlation analysis
  console.log('\n================================================================');
  console.log('               CORRELATION ANALYSIS');
  console.log('================================================================\n');

  // Group by water percentage buckets
  const buckets = [
    { min: 0, max: 5, label: '0-5%' },
    { min: 5, max: 10, label: '5-10%' },
    { min: 10, max: 20, label: '10-20%' },
    { min: 20, max: 30, label: '20-30%' },
    { min: 30, max: 50, label: '30-50%' },
    { min: 50, max: 100, label: '50%+' },
  ];

  console.log('Pass rate by water percentage bucket:');
  console.log('');

  for (const bucket of buckets) {
    const citiesInBucket = analysisResults.filter(
      r => r.waterPercentage >= bucket.min && r.waterPercentage < bucket.max
    );
    const passed = citiesInBucket.filter(r => r.validationPassed).length;
    const passRate = citiesInBucket.length > 0
      ? (passed / citiesInBucket.length) * 100
      : 0;

    const bar = '='.repeat(Math.round(passRate / 2));
    console.log(`  ${bucket.label.padEnd(8)} | ${citiesInBucket.length.toString().padStart(4)} cities | ${passed.toString().padStart(4)} passed | ${passRate.toFixed(1).padStart(5)}% |${bar}`);
  }

  // Output JSON for further analysis
  const outputPath = './analysis-output/water-coverage-analysis.json';
  const outputDir = './analysis-output';

  try {
    const { mkdirSync, writeFileSync } = await import('fs');
    mkdirSync(outputDir, { recursive: true });

    const output = {
      timestamp: new Date().toISOString(),
      config: {
        waterThreshold: config.waterThreshold,
        limit: config.limit,
      },
      stats,
      highWaterCities: highWaterCities.map(c => ({
        fips: c.fips,
        cityName: c.cityName,
        state: c.state,
        waterPercentage: c.waterPercentage,
        landOnlyCoverageRatio: c.landOnlyCoverageRatio,
        totalCoverageRatio: c.totalCoverageRatio,
        validationPassed: c.validationPassed,
        failedAxiom: c.failedAxiom,
      })),
      failedCoastal: failedCoastal.map(c => ({
        fips: c.fips,
        cityName: c.cityName,
        state: c.state,
        waterPercentage: c.waterPercentage,
        landAreaSqMi: c.landAreaSqM / 2_589_988,
        waterAreaSqMi: c.waterAreaSqM / 2_589_988,
        districtAreaSqMi: c.districtUnionAreaSqM / 2_589_988,
        failedAxiom: c.failedAxiom,
        failureReason: c.failureReason,
      })),
    };

    writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`\nDetailed analysis written to: ${outputPath}`);
  } catch (err) {
    console.log('\nNote: Could not write output file (run from package root)');
  }

  console.log('\n================================================================');
  console.log('                     RECOMMENDATIONS');
  console.log('================================================================\n');

  const passRateDiff = stats.inlandPassRate - stats.coastalPassRate;

  if (passRateDiff > 10) {
    console.log('FINDING: Coastal cities have significantly lower pass rate than inland.');
    console.log(`         Difference: ${passRateDiff.toFixed(1)} percentage points`);
    console.log('');
    console.log('RECOMMENDATION: Consider water-aware coverage calculation:');
    console.log('  1. For cities with >10% water, use (land + water) as denominator');
    console.log('  2. This normalizes coverage ratios for water-inclusive districts');
    console.log('  3. Current coastal threshold (200%) may be too permissive');
  } else if (passRateDiff > 5) {
    console.log('FINDING: Mild correlation between water % and validation failures.');
    console.log('');
    console.log('RECOMMENDATION: Current thresholds appear adequate.');
    console.log('  Monitor edge cases and add to KNOWN_MAX_COVERAGE_EXCEPTIONS as needed.');
  } else {
    console.log('FINDING: No significant correlation between water % and failures.');
    console.log('');
    console.log('RECOMMENDATION: Current water handling is adequate.');
    console.log('  The COASTAL_WATER_RATIO threshold of 15% with 200% max coverage works.');
  }
}

main().catch(console.error);
