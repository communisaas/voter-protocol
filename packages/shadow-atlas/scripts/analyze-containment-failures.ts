#!/usr/bin/env npx tsx
/**
 * Containment Failure Analysis Script (WS-3)
 *
 * PURPOSE: Identify and categorize cities where council districts extend beyond
 * the municipal boundary (containment axiom failures).
 *
 * ROOT CAUSES (hypotheses to investigate):
 * 1. Boundary vintage mismatch (2024 districts vs 2020 Census boundary)
 * 2. Annexation (city grew but TIGER doesn't reflect it)
 * 3. Water boundaries (districts include water, TIGER excludes it)
 * 4. Coordinate precision issues
 *
 * OUTPUT:
 * - Categorizes failures by severity: MINOR (<5%), MODERATE (5-15%), SEVERE (>15%)
 * - Calculates overflow direction (N/S/E/W) for each failure
 * - Samples 10 failures across categories for detailed analysis
 */

import * as turf from '@turf/turf';
import type { Feature, Polygon, MultiPolygon, FeatureCollection } from 'geojson';
import { KNOWN_PORTALS, type KnownPortal } from '../src/core/registry/known-portals.js';
import { TessellationProofValidator, type TessellationProof } from '../src/validators/council/tessellation-proof.js';
import { MunicipalBoundaryResolver, type MunicipalBoundary } from '../src/validators/council/municipal-boundary.js';
import { EXPECTED_DISTRICT_COUNTS } from '../src/core/registry/district-count-registry.js';

// =============================================================================
// Types
// =============================================================================

interface ContainmentFailure {
  readonly fips: string;
  readonly cityName: string;
  readonly state: string;
  readonly severity: 'MINOR' | 'MODERATE' | 'SEVERE';
  readonly outsideAreaSqM: number;
  readonly districtAreaSqM: number;
  readonly outsidePercent: number;
  readonly overflowDirection: OverflowDirection;
  readonly isCoastal: boolean;
  readonly waterPercent: number;
  readonly districtCount: number;
  readonly perDistrictOverflow: DistrictOverflow[];
  readonly hypothesizedCause: string;
}

interface DistrictOverflow {
  readonly districtId: string;
  readonly outsideAreaSqM: number;
  readonly totalAreaSqM: number;
  readonly outsidePercent: number;
  readonly direction: OverflowDirection;
}

interface OverflowDirection {
  readonly north: boolean;
  readonly south: boolean;
  readonly east: boolean;
  readonly west: boolean;
  readonly centroid: { lng: number; lat: number } | null;
}

// Tolerance constant from tessellation-proof.ts
const OUTSIDE_RATIO_THRESHOLD = 0.15; // 15%

// Severity thresholds
const SEVERITY_THRESHOLDS = {
  MINOR: 0.05,    // <5% - coordinate precision or small boundary update
  MODERATE: 0.15, // 5-15% - possible annexation or water body
  // SEVERE: >15% - likely data error or major boundary mismatch
};

// Coastal detection threshold
const COASTAL_WATER_RATIO = 0.15; // 15% water = coastal city

// =============================================================================
// Helpers
// =============================================================================

async function fetchDistricts(url: string): Promise<FeatureCollection<Polygon | MultiPolygon> | null> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'VOTER-Protocol/1.0 (Containment-Analysis)', Accept: 'application/geo+json' },
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.features || !Array.isArray(data.features)) return null;
    return data as FeatureCollection<Polygon | MultiPolygon>;
  } catch {
    return null;
  }
}

function getDistrictId(feature: Feature<Polygon | MultiPolygon>): string {
  const props = feature.properties || {};
  const idFields = [
    'districtId', 'DISTRICT', 'District', 'district', 'DIST',
    'WARD', 'Ward', 'ward', 'NAME', 'Name', 'name', 'ID', 'id',
    'OBJECTID', 'FID', 'DISTRICT_N'
  ];
  for (const field of idFields) {
    if (props[field] !== undefined && props[field] !== null) {
      return String(props[field]);
    }
  }
  return 'unknown';
}

function computeOverflowDirection(
  overflow: Feature<Polygon | MultiPolygon> | null,
  boundaryCenter: Feature<turf.helpers.Point>
): OverflowDirection {
  if (!overflow) {
    return { north: false, south: false, east: false, west: false, centroid: null };
  }

  try {
    const overflowCenter = turf.centroid(overflow);
    const [lngB, latB] = boundaryCenter.geometry.coordinates;
    const [lngO, latO] = overflowCenter.geometry.coordinates;

    return {
      north: latO > latB,
      south: latO < latB,
      east: lngO > lngB,
      west: lngO < lngB,
      centroid: { lng: lngO, lat: latO },
    };
  } catch {
    return { north: false, south: false, east: false, west: false, centroid: null };
  }
}

function directionToString(dir: OverflowDirection): string {
  const dirs: string[] = [];
  if (dir.north) dirs.push('N');
  if (dir.south) dirs.push('S');
  if (dir.east) dirs.push('E');
  if (dir.west) dirs.push('W');
  return dirs.length > 0 ? dirs.join('') : 'NONE';
}

function classifySeverity(outsidePercent: number): 'MINOR' | 'MODERATE' | 'SEVERE' {
  if (outsidePercent < SEVERITY_THRESHOLDS.MINOR * 100) return 'MINOR';
  if (outsidePercent < SEVERITY_THRESHOLDS.MODERATE * 100) return 'MODERATE';
  return 'SEVERE';
}

function hypothesizeCause(failure: Omit<ContainmentFailure, 'hypothesizedCause'>): string {
  const hypotheses: string[] = [];

  // Water hypothesis: coastal cities with moderate overflow
  if (failure.isCoastal && failure.waterPercent > 10) {
    hypotheses.push('WATER - districts include jurisdictional waters (harbor/bay)');
  }

  // Direction-based hypotheses
  const dir = failure.overflowDirection;
  if ((dir.north || dir.south) && !(dir.east && dir.west)) {
    hypotheses.push('ANNEXATION - linear expansion along major corridor');
  }

  // Severity-based hypotheses
  if (failure.severity === 'MINOR') {
    hypotheses.push('PRECISION - coordinate/projection differences');
  } else if (failure.severity === 'SEVERE') {
    hypotheses.push('DATA_ERROR - likely wrong boundary source or vintage mismatch');
  }

  // Per-district analysis
  const districtsWithOverflow = failure.perDistrictOverflow.filter(d => d.outsidePercent > 1);
  if (districtsWithOverflow.length === 1) {
    hypotheses.push(`SINGLE_DISTRICT - only District ${districtsWithOverflow[0].districtId} extends beyond boundary`);
  } else if (districtsWithOverflow.length === failure.districtCount) {
    hypotheses.push('SYSTEMATIC - all districts exceed boundary (vintage mismatch likely)');
  }

  return hypotheses.length > 0 ? hypotheses.join('; ') : 'UNKNOWN';
}

// =============================================================================
// Main Analysis
// =============================================================================

async function analyzeContainmentFailures(): Promise<void> {
  console.log('=== CONTAINMENT FAILURE ANALYSIS (WS-3) ===\n');

  // Filter to 7-digit FIPS only (cities)
  const allPortals = Object.values(KNOWN_PORTALS);
  const cities = allPortals.filter(p => /^\d{7}$/.test(p.cityFips));

  console.log(`Total registry: ${allPortals.length} entries`);
  console.log(`Cities (7-digit FIPS): ${cities.length}`);
  console.log(`Containment threshold: ${OUTSIDE_RATIO_THRESHOLD * 100}%\n`);

  const boundaryResolver = new MunicipalBoundaryResolver();
  const tessellationValidator = new TessellationProofValidator();

  const failures: ContainmentFailure[] = [];
  const passedCities: string[] = [];
  const errors: { city: string; error: string }[] = [];

  let processed = 0;

  for (const portal of cities) {
    processed++;
    process.stdout.write(`\r[${processed}/${cities.length}] Analyzing ${portal.cityName}, ${portal.state}...                    `);

    // Fetch districts
    const districts = await fetchDistricts(portal.downloadUrl);
    if (!districts) {
      errors.push({ city: `${portal.cityName}, ${portal.state}`, error: 'fetch failed' });
      continue;
    }

    // Resolve boundary
    const boundaryResult = await boundaryResolver.resolve(portal.cityFips);
    if (!boundaryResult.success || !boundaryResult.boundary) {
      errors.push({ city: `${portal.cityName}, ${portal.state}`, error: `boundary: ${boundaryResult.error}` });
      continue;
    }

    const boundary = boundaryResult.boundary;

    // Compute district union
    let districtUnion: Feature<Polygon | MultiPolygon>;
    let districtUnionArea: number;
    try {
      const validFeatures = districts.features
        .filter(f => f && f.geometry && f.geometry.coordinates)
        .map(f => turf.rewind(f, { reverse: false }) as Feature<Polygon | MultiPolygon>);

      if (validFeatures.length === 0) {
        errors.push({ city: `${portal.cityName}, ${portal.state}`, error: 'no valid geometries' });
        continue;
      }

      districtUnion = validFeatures[0];
      for (let i = 1; i < validFeatures.length; i++) {
        try {
          const union = turf.union(turf.featureCollection([districtUnion, validFeatures[i]]));
          if (union) {
            districtUnion = union as Feature<Polygon | MultiPolygon>;
          }
        } catch { /* continue with partial union */ }
      }
      districtUnionArea = turf.area(districtUnion);
    } catch (e) {
      errors.push({ city: `${portal.cityName}, ${portal.state}`, error: `geometry: ${e}` });
      continue;
    }

    // Compute overflow (districts minus boundary)
    let overflow: Feature<Polygon | MultiPolygon> | null = null;
    let outsideArea = 0;
    try {
      overflow = turf.difference(turf.featureCollection([districtUnion, boundary.geometry]));
      if (overflow) {
        outsideArea = turf.area(overflow);
      }
    } catch {
      // If difference fails, no overflow detected
    }

    const outsideRatio = districtUnionArea > 0 ? outsideArea / districtUnionArea : 0;
    const outsidePercent = outsideRatio * 100;

    // Check if this is a containment failure
    if (outsideRatio <= OUTSIDE_RATIO_THRESHOLD) {
      passedCities.push(`${portal.cityName}, ${portal.state}`);
      await new Promise(r => setTimeout(r, 50)); // Rate limit
      continue;
    }

    // This is a containment failure - analyze in detail
    const boundaryCenter = turf.centroid(boundary.geometry);
    const overflowDirection = computeOverflowDirection(overflow, boundaryCenter);

    // Check if coastal
    const totalArea = boundary.landAreaSqM + boundary.waterAreaSqM;
    const waterPercent = totalArea > 0 ? (boundary.waterAreaSqM / totalArea) * 100 : 0;
    const isCoastal = waterPercent > COASTAL_WATER_RATIO * 100;

    // Per-district overflow analysis
    const perDistrictOverflow: DistrictOverflow[] = [];
    for (const feature of districts.features) {
      try {
        const rewound = turf.rewind(feature, { reverse: false }) as Feature<Polygon | MultiPolygon>;
        const districtArea = turf.area(rewound);
        const districtOverflow = turf.difference(turf.featureCollection([rewound, boundary.geometry]));

        if (districtOverflow) {
          const districtOutsideArea = turf.area(districtOverflow);
          const districtOutsidePercent = districtArea > 0 ? (districtOutsideArea / districtArea) * 100 : 0;
          const districtDirection = computeOverflowDirection(districtOverflow, boundaryCenter);

          perDistrictOverflow.push({
            districtId: getDistrictId(feature),
            outsideAreaSqM: districtOutsideArea,
            totalAreaSqM: districtArea,
            outsidePercent: districtOutsidePercent,
            direction: districtDirection,
          });
        }
      } catch {
        // Skip invalid district geometries
      }
    }

    const severity = classifySeverity(outsidePercent);

    const failureData: Omit<ContainmentFailure, 'hypothesizedCause'> = {
      fips: portal.cityFips,
      cityName: portal.cityName,
      state: portal.state,
      severity,
      outsideAreaSqM: outsideArea,
      districtAreaSqM: districtUnionArea,
      outsidePercent,
      overflowDirection,
      isCoastal,
      waterPercent,
      districtCount: districts.features.length,
      perDistrictOverflow,
    };

    failures.push({
      ...failureData,
      hypothesizedCause: hypothesizeCause(failureData),
    });

    await new Promise(r => setTimeout(r, 100)); // Rate limit
  }

  console.log('\n\n');

  // ==========================================================================
  // Summary Statistics
  // ==========================================================================

  console.log('=== SUMMARY ===\n');
  console.log(`Processed: ${processed} cities`);
  console.log(`Passed containment: ${passedCities.length} (${((passedCities.length / processed) * 100).toFixed(1)}%)`);
  console.log(`Failed containment: ${failures.length} (${((failures.length / processed) * 100).toFixed(1)}%)`);
  console.log(`Errors: ${errors.length}\n`);

  // Severity distribution
  const minorCount = failures.filter(f => f.severity === 'MINOR').length;
  const moderateCount = failures.filter(f => f.severity === 'MODERATE').length;
  const severeCount = failures.filter(f => f.severity === 'SEVERE').length;

  console.log('=== SEVERITY DISTRIBUTION ===\n');
  console.log(`MINOR (<5%):      ${minorCount} cities`);
  console.log(`MODERATE (5-15%): ${moderateCount} cities`);
  console.log(`SEVERE (>15%):    ${severeCount} cities\n`);

  // Coastal analysis
  const coastalFailures = failures.filter(f => f.isCoastal);
  const inlandFailures = failures.filter(f => !f.isCoastal);

  console.log('=== COASTAL vs INLAND ===\n');
  console.log(`Coastal cities with failures: ${coastalFailures.length}`);
  console.log(`Inland cities with failures: ${inlandFailures.length}`);
  if (coastalFailures.length > 0) {
    const avgCoastalOverflow = coastalFailures.reduce((sum, f) => sum + f.outsidePercent, 0) / coastalFailures.length;
    console.log(`Avg coastal overflow: ${avgCoastalOverflow.toFixed(1)}%`);
  }
  if (inlandFailures.length > 0) {
    const avgInlandOverflow = inlandFailures.reduce((sum, f) => sum + f.outsidePercent, 0) / inlandFailures.length;
    console.log(`Avg inland overflow: ${avgInlandOverflow.toFixed(1)}%\n`);
  }

  // State distribution
  const byState = new Map<string, number>();
  for (const f of failures) {
    byState.set(f.state, (byState.get(f.state) || 0) + 1);
  }
  const sortedStates = [...byState.entries()].sort((a, b) => b[1] - a[1]);

  console.log('=== STATE DISTRIBUTION (top 10) ===\n');
  for (const [state, count] of sortedStates.slice(0, 10)) {
    console.log(`  ${state}: ${count} failures`);
  }

  // ==========================================================================
  // Detailed Failure List
  // ==========================================================================

  console.log('\n=== ALL CONTAINMENT FAILURES ===\n');

  // Sort by severity then by overflow percent
  const sortedFailures = [...failures].sort((a, b) => {
    const severityOrder = { SEVERE: 0, MODERATE: 1, MINOR: 2 };
    if (severityOrder[a.severity] !== severityOrder[b.severity]) {
      return severityOrder[a.severity] - severityOrder[b.severity];
    }
    return b.outsidePercent - a.outsidePercent;
  });

  for (const f of sortedFailures) {
    const dir = directionToString(f.overflowDirection);
    const coastal = f.isCoastal ? ' [COASTAL]' : '';
    console.log(`[${f.severity}] ${f.cityName}, ${f.state} (${f.fips})${coastal}`);
    console.log(`  Overflow: ${f.outsidePercent.toFixed(1)}% (${(f.outsideAreaSqM / 1e6).toFixed(2)} sq km)`);
    console.log(`  Direction: ${dir}`);
    console.log(`  Districts: ${f.districtCount}, Water: ${f.waterPercent.toFixed(1)}%`);
    console.log(`  Hypothesis: ${f.hypothesizedCause}`);

    // Show top overflow districts
    const topOverflow = f.perDistrictOverflow
      .filter(d => d.outsidePercent > 1)
      .sort((a, b) => b.outsidePercent - a.outsidePercent)
      .slice(0, 3);
    if (topOverflow.length > 0) {
      console.log(`  Top overflow districts:`);
      for (const d of topOverflow) {
        console.log(`    - District ${d.districtId}: ${d.outsidePercent.toFixed(1)}% outside (${directionToString(d.direction)})`);
      }
    }
    console.log('');
  }

  // ==========================================================================
  // Sample 10 Failures for Detailed Analysis
  // ==========================================================================

  console.log('=== SAMPLED FAILURES FOR DETAILED ANALYSIS ===\n');

  // Sample across severity categories
  const severeSample = sortedFailures.filter(f => f.severity === 'SEVERE').slice(0, 4);
  const moderateSample = sortedFailures.filter(f => f.severity === 'MODERATE').slice(0, 3);
  const minorSample = sortedFailures.filter(f => f.severity === 'MINOR').slice(0, 3);
  const sample = [...severeSample, ...moderateSample, ...minorSample];

  for (let i = 0; i < sample.length; i++) {
    const f = sample[i];
    console.log(`--- Sample ${i + 1}: ${f.cityName}, ${f.state} ---`);
    console.log(`FIPS: ${f.fips}`);
    console.log(`Severity: ${f.severity}`);
    console.log(`Outside boundary: ${f.outsidePercent.toFixed(2)}% (${(f.outsideAreaSqM / 1e6).toFixed(3)} sq km of ${(f.districtAreaSqM / 1e6).toFixed(1)} sq km)`);
    console.log(`Overflow direction: ${directionToString(f.overflowDirection)}`);
    console.log(`Coastal: ${f.isCoastal} (${f.waterPercent.toFixed(1)}% water)`);
    console.log(`District count: ${f.districtCount}`);
    console.log(`Hypothesized cause: ${f.hypothesizedCause}`);
    console.log(`\nPer-district overflow:`);
    for (const d of f.perDistrictOverflow.filter(x => x.outsidePercent > 0.1).sort((a, b) => b.outsidePercent - a.outsidePercent)) {
      console.log(`  District ${d.districtId}: ${d.outsidePercent.toFixed(2)}% outside (${(d.outsideAreaSqM / 1e6).toFixed(4)} sq km) - ${directionToString(d.direction)}`);
    }
    console.log('\n');
  }

  // ==========================================================================
  // Errors
  // ==========================================================================

  if (errors.length > 0) {
    console.log('=== ERRORS ===\n');
    for (const e of errors.slice(0, 20)) {
      console.log(`  ${e.city}: ${e.error}`);
    }
    if (errors.length > 20) {
      console.log(`  ... and ${errors.length - 20} more errors`);
    }
  }

  // ==========================================================================
  // JSON output for documentation
  // ==========================================================================

  console.log('\n=== JSON SUMMARY (for documentation) ===\n');
  const summary = {
    timestamp: new Date().toISOString(),
    threshold: OUTSIDE_RATIO_THRESHOLD,
    processed: processed,
    passed: passedCities.length,
    failed: failures.length,
    errors: errors.length,
    severityDistribution: {
      minor: minorCount,
      moderate: moderateCount,
      severe: severeCount,
    },
    coastalAnalysis: {
      coastalFailures: coastalFailures.length,
      inlandFailures: inlandFailures.length,
    },
    stateDistribution: Object.fromEntries(sortedStates),
    sampledFailures: sample.map(f => ({
      fips: f.fips,
      city: `${f.cityName}, ${f.state}`,
      severity: f.severity,
      outsidePercent: f.outsidePercent,
      isCoastal: f.isCoastal,
      hypothesis: f.hypothesizedCause,
    })),
  };
  console.log(JSON.stringify(summary, null, 2));
}

// Run analysis
analyzeContainmentFailures().catch(console.error);
