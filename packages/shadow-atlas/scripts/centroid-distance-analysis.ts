#!/usr/bin/env tsx
/**
 * Centroid Distance Analysis for Containment Failures
 *
 * MISSION: Quantitatively detect wrong data sources using centroid distance analysis.
 *
 * INSIGHT: Legitimate district data has centroids near the city center.
 *          Wrong data (county/metro) has centroids far away.
 *
 * THRESHOLDS:
 * - < 10km: Likely correct data (or valid edge case)
 * - 10-50km: Possible annexation or boundary vintage mismatch
 * - > 50km: Almost certainly wrong data source
 *
 * USAGE:
 *   tsx scripts/centroid-distance-analysis.ts --sample  # Run on sample cities
 *   tsx scripts/centroid-distance-analysis.ts --fips 0654386,0666000  # Specific cities
 *   tsx scripts/centroid-distance-analysis.ts --all     # Full dataset analysis
 */

import * as turf from '@turf/turf';
import type { Feature, FeatureCollection, Polygon, MultiPolygon, Point } from 'geojson';
import { MunicipalBoundaryResolver } from '../src/validators/council/municipal-boundary.js';
import finalCouncilDistricts from '../src/agents/data/final-council-districts.json' with { type: 'json' };
import fs from 'node:fs/promises';
import path from 'node:path';

// =============================================================================
// Types
// =============================================================================

interface CentroidAnalysisResult {
  fips: string;
  city: string;
  state: string;
  portalUrl: string;
  districtCentroid: [number, number] | null;  // [lon, lat]
  cityCentroid: [number, number] | null;       // [lon, lat]
  distanceKm: number | null;
  classification: 'LIKELY_VALID' | 'EDGE_CASE' | 'WRONG_SOURCE' | 'ERROR';
  error: string | null;
  districtCount: number;
}

interface AnalysisSummary {
  total: number;
  likelyValid: number;
  edgeCase: number;
  wrongSource: number;
  error: number;
  thresholds: {
    valid: number;
    edgeCase: number;
  };
}

interface FullOutput {
  generatedAt: string;
  results: CentroidAnalysisResult[];
  summary: AnalysisSummary;
}

// =============================================================================
// Constants
// =============================================================================

const THRESHOLD_VALID_KM = 10;
const THRESHOLD_EDGE_CASE_KM = 50;
const OUTPUT_DIR = 'analysis-output';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'centroid-distance-results.json');

// Sample cities with known containment issues (diverse geographic distribution)
const SAMPLE_CITIES = [
  '0654386', // Poway, CA
  '0666000', // San Diego, CA
  '4835000', // Houston, TX
  '2622000', // Detroit, MI
  '4159000', // Portland, OR
  '0644000', // Los Angeles, CA
  '3651000', // New York, NY
  '4805000', // Austin, TX
];

// =============================================================================
// District Data Fetcher
// =============================================================================

async function fetchDistrictData(portalUrl: string): Promise<FeatureCollection<Polygon | MultiPolygon> | null> {
  try {
    // Convert FeatureServer URL to query URL if needed
    const queryUrl = portalUrl.includes('/query?')
      ? portalUrl
      : `${portalUrl}/query?where=1%3D1&outFields=*&f=geojson`;

    const response = await fetch(queryUrl, {
      headers: {
        'User-Agent': 'VOTER-Protocol/1.0 (Centroid-Distance-Analysis)',
        Accept: 'application/geo+json, application/json',
      },
    });

    if (!response.ok) {
      console.error(`HTTP ${response.status} for ${queryUrl}`);
      return null;
    }

    const data = await response.json();

    // Validate response structure
    if (!data.features || !Array.isArray(data.features)) {
      console.error(`Invalid GeoJSON response from ${queryUrl}`);
      return null;
    }

    return data as FeatureCollection<Polygon | MultiPolygon>;
  } catch (error) {
    console.error(`Fetch error for ${portalUrl}:`, error instanceof Error ? error.message : String(error));
    return null;
  }
}

// =============================================================================
// Centroid Computation
// =============================================================================

function computeDistrictCentroid(districts: FeatureCollection<Polygon | MultiPolygon>): Point | null {
  try {
    // Compute centroid of each district, then average
    // This avoids expensive union operations and topology errors
    const centroids: Point[] = districts.features.map((feature) => {
      const centroid = turf.centroid(feature);
      return centroid.geometry;
    });

    if (centroids.length === 0) {
      return null;
    }

    // Average centroid positions
    const avgLon = centroids.reduce((sum, pt) => sum + pt.coordinates[0], 0) / centroids.length;
    const avgLat = centroids.reduce((sum, pt) => sum + pt.coordinates[1], 0) / centroids.length;

    return turf.point([avgLon, avgLat]).geometry;
  } catch (error) {
    console.error('Error computing district centroid:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

// =============================================================================
// Single City Analysis
// =============================================================================

async function analyzeSingleCity(
  fips: string,
  portalUrl: string,
  cityName: string,
  state: string,
  resolver: MunicipalBoundaryResolver
): Promise<CentroidAnalysisResult> {
  console.log(`\nAnalyzing ${cityName}, ${state} (FIPS: ${fips})...`);

  // Fetch municipal boundary
  console.log('  → Fetching city boundary from TIGER...');
  const boundaryResult = await resolver.resolve(fips);

  if (!boundaryResult.success || !boundaryResult.boundary) {
    return {
      fips,
      city: cityName,
      state,
      portalUrl,
      districtCentroid: null,
      cityCentroid: null,
      distanceKm: null,
      classification: 'ERROR',
      error: `Failed to resolve boundary: ${boundaryResult.error}`,
      districtCount: 0,
    };
  }

  // Fetch district data
  console.log('  → Fetching district data from portal...');
  const districts = await fetchDistrictData(portalUrl);

  if (!districts) {
    return {
      fips,
      city: cityName,
      state,
      portalUrl,
      districtCentroid: null,
      cityCentroid: null,
      distanceKm: null,
      classification: 'ERROR',
      error: 'Failed to fetch district data',
      districtCount: 0,
    };
  }

  if (districts.features.length === 0) {
    return {
      fips,
      city: cityName,
      state,
      portalUrl,
      districtCentroid: null,
      cityCentroid: null,
      distanceKm: null,
      classification: 'ERROR',
      error: 'Empty district data',
      districtCount: 0,
    };
  }

  // Compute centroids
  console.log('  → Computing centroids...');
  const districtCentroid = computeDistrictCentroid(districts);
  const cityCentroid = turf.centroid(boundaryResult.boundary.geometry).geometry;

  if (!districtCentroid) {
    return {
      fips,
      city: cityName,
      state,
      portalUrl,
      districtCentroid: null,
      cityCentroid: [cityCentroid.coordinates[0], cityCentroid.coordinates[1]],
      distanceKm: null,
      classification: 'ERROR',
      error: 'Failed to compute district centroid',
      districtCount: districts.features.length,
    };
  }

  // Compute distance
  const distanceKm = turf.distance(
    turf.point(districtCentroid.coordinates),
    turf.point(cityCentroid.coordinates),
    { units: 'kilometers' }
  );

  console.log(`  → Distance: ${distanceKm.toFixed(2)}km`);

  // Classify result
  let classification: 'LIKELY_VALID' | 'EDGE_CASE' | 'WRONG_SOURCE';
  if (distanceKm < THRESHOLD_VALID_KM) {
    classification = 'LIKELY_VALID';
    console.log(`  ✓ LIKELY_VALID (< ${THRESHOLD_VALID_KM}km)`);
  } else if (distanceKm < THRESHOLD_EDGE_CASE_KM) {
    classification = 'EDGE_CASE';
    console.log(`  ⚠ EDGE_CASE (${THRESHOLD_VALID_KM}-${THRESHOLD_EDGE_CASE_KM}km)`);
  } else {
    classification = 'WRONG_SOURCE';
    console.log(`  ✗ WRONG_SOURCE (> ${THRESHOLD_EDGE_CASE_KM}km)`);
  }

  return {
    fips,
    city: cityName,
    state,
    portalUrl,
    districtCentroid: [districtCentroid.coordinates[0], districtCentroid.coordinates[1]],
    cityCentroid: [cityCentroid.coordinates[0], cityCentroid.coordinates[1]],
    distanceKm,
    classification,
    error: null,
    districtCount: districts.features.length,
  };
}

// =============================================================================
// Batch Analysis
// =============================================================================

async function runBatchAnalysis(fipsList: string[]): Promise<FullOutput> {
  console.log(`\n=== Centroid Distance Analysis ===`);
  console.log(`Analyzing ${fipsList.length} cities...`);
  console.log(`Thresholds: Valid < ${THRESHOLD_VALID_KM}km, Edge Case < ${THRESHOLD_EDGE_CASE_KM}km\n`);

  const resolver = new MunicipalBoundaryResolver();
  const results: CentroidAnalysisResult[] = [];

  // Load layer data from final-council-districts.json
  const layerData = finalCouncilDistricts as {
    layers: Array<{
      url: string;
      resolution?: {
        fips: string;
        name: string;
        state: string;
      };
    }>;
  };

  // Build FIPS → URL mapping
  const fipsToLayer = new Map<string, { url: string; name: string; state: string }>();
  for (const layer of layerData.layers) {
    if (layer.resolution?.fips) {
      fipsToLayer.set(layer.resolution.fips, {
        url: layer.url,
        name: layer.resolution.name,
        state: layer.resolution.state,
      });
    }
  }

  // Process each city
  for (const fips of fipsList) {
    const layerInfo = fipsToLayer.get(fips);

    if (!layerInfo) {
      console.log(`\n⚠ Skipping ${fips}: No portal data found`);
      results.push({
        fips,
        city: 'Unknown',
        state: 'Unknown',
        portalUrl: '',
        districtCentroid: null,
        cityCentroid: null,
        distanceKm: null,
        classification: 'ERROR',
        error: 'No portal data found in final-council-districts.json',
        districtCount: 0,
      });
      continue;
    }

    const result = await analyzeSingleCity(
      fips,
      layerInfo.url,
      layerInfo.name,
      layerInfo.state,
      resolver
    );

    results.push(result);

    // Rate limiting
    await new Promise((r) => setTimeout(r, 300));
  }

  // Compute summary
  const summary: AnalysisSummary = {
    total: results.length,
    likelyValid: results.filter((r) => r.classification === 'LIKELY_VALID').length,
    edgeCase: results.filter((r) => r.classification === 'EDGE_CASE').length,
    wrongSource: results.filter((r) => r.classification === 'WRONG_SOURCE').length,
    error: results.filter((r) => r.classification === 'ERROR').length,
    thresholds: {
      valid: THRESHOLD_VALID_KM,
      edgeCase: THRESHOLD_EDGE_CASE_KM,
    },
  };

  console.log(`\n=== Summary ===`);
  console.log(`Total: ${summary.total}`);
  console.log(`Likely Valid: ${summary.likelyValid} (< ${THRESHOLD_VALID_KM}km)`);
  console.log(`Edge Case: ${summary.edgeCase} (${THRESHOLD_VALID_KM}-${THRESHOLD_EDGE_CASE_KM}km)`);
  console.log(`Wrong Source: ${summary.wrongSource} (> ${THRESHOLD_EDGE_CASE_KM}km)`);
  console.log(`Error: ${summary.error}`);

  return {
    generatedAt: new Date().toISOString(),
    results,
    summary,
  };
}

// =============================================================================
// CLI Interface
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  let fipsList: string[];

  if (args.includes('--sample')) {
    console.log('Running on sample cities...');
    fipsList = SAMPLE_CITIES;
  } else if (args.includes('--fips')) {
    const fipsArg = args[args.indexOf('--fips') + 1];
    if (!fipsArg) {
      console.error('Error: --fips requires comma-separated FIPS codes');
      process.exit(1);
    }
    fipsList = fipsArg.split(',').map((f) => f.trim());
  } else if (args.includes('--all')) {
    // Extract all unique FIPS from final-council-districts.json
    const layerData = finalCouncilDistricts as {
      layers: Array<{
        resolution?: {
          fips: string;
        };
      }>;
    };
    const uniqueFips = new Set<string>();
    for (const layer of layerData.layers) {
      if (layer.resolution?.fips) {
        uniqueFips.add(layer.resolution.fips);
      }
    }
    fipsList = Array.from(uniqueFips);
    console.log(`Running on all ${fipsList.length} unique cities from dataset...`);
  } else {
    console.log('Centroid Distance Analysis for Containment Failures\n');
    console.log('Usage:');
    console.log('  tsx scripts/centroid-distance-analysis.ts --sample                      # Sample cities');
    console.log('  tsx scripts/centroid-distance-analysis.ts --fips 0654386,0666000       # Specific cities');
    console.log('  tsx scripts/centroid-distance-analysis.ts --all                         # Full dataset');
    process.exit(0);
  }

  // Run analysis
  const output = await runBatchAnalysis(fipsList);

  // Ensure output directory exists
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  // Write output
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\n✓ Results written to ${OUTPUT_FILE}`);

  // Print standout findings
  const wrongSources = output.results.filter((r) => r.classification === 'WRONG_SOURCE');
  if (wrongSources.length > 0) {
    console.log(`\n=== Wrong Source Detections (> ${THRESHOLD_EDGE_CASE_KM}km) ===`);
    for (const result of wrongSources) {
      console.log(`  ${result.city}, ${result.state} (${result.fips}): ${result.distanceKm?.toFixed(1)}km`);
    }
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
