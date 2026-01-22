#!/usr/bin/env npx tsx
/**
 * Exclusivity Failure Analysis Script (WS-4)
 *
 * PURPOSE: Deep analysis of council district overlaps that fail the EXCLUSIVITY axiom
 *
 * PROBLEM: 30 cities fail exclusivity - their districts overlap. This violates
 * the fundamental principle that no voter can be in two districts simultaneously.
 *
 * ANALYSIS:
 * - Identifies all overlapping district pairs
 * - Calculates overlap area for each pair
 * - Categorizes by severity (MICRO/SMALL/LARGE)
 * - Determines if overlaps are at edges (precision) or interior (data error)
 * - Computes statistics to inform OVERLAP_EPSILON adjustment
 *
 * USAGE:
 *   npx tsx scripts/analyze-exclusivity-failures.ts [--limit N] [--verbose]
 *
 * OUTPUT:
 *   - Overlap distribution by size category
 *   - Sample analysis of failures
 *   - Recommended OVERLAP_EPSILON adjustment
 *   - Edge vs interior pattern analysis
 */

import type { Feature, FeatureCollection, Polygon, MultiPolygon, Position } from 'geojson';
import * as turf from '@turf/turf';
import { KNOWN_PORTALS, type KnownPortal } from '../src/core/registry/known-portals.generated.js';
import { MunicipalBoundaryResolver } from '../src/validators/council/municipal-boundary.js';
import { EXPECTED_DISTRICT_COUNTS } from '../src/core/registry/district-count-registry.js';

// =============================================================================
// Configuration
// =============================================================================

/** Current OVERLAP_EPSILON from tessellation-proof.ts */
const CURRENT_OVERLAP_EPSILON = 150_000; // sq meters (~37 acres)

/** Overlap size categories */
const OVERLAP_CATEGORIES = {
  MICRO: { max: 1_000, label: 'MICRO (<1,000 sq m)', description: 'Edge/precision artifact' },
  SMALL: { max: 10_000, label: 'SMALL (1k-10k sq m)', description: 'Topology error' },
  MEDIUM: { max: 100_000, label: 'MEDIUM (10k-100k sq m)', description: 'Significant overlap' },
  LARGE: { max: Infinity, label: 'LARGE (>100k sq m)', description: 'Data error or duplicate geometry' },
} as const;

interface Config {
  limit: number | null;
  verbose: boolean;
  fips: string | null;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  const config: Config = {
    limit: null,
    verbose: false,
    fips: null,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--limit':
        config.limit = parseInt(args[++i], 10);
        break;
      case '--verbose':
        config.verbose = true;
        break;
      case '--fips':
        config.fips = args[++i];
        break;
    }
  }

  return config;
}

// =============================================================================
// Types
// =============================================================================

interface OverlapPair {
  /** District indices */
  districtA: number;
  districtB: number;
  /** District identifiers (names/numbers) */
  districtAId: string;
  districtBId: string;
  /** Overlap area in square meters */
  overlapArea: number;
  /** Center point of overlap [lng, lat] */
  overlapCenter: [number, number];
  /** Overlap category */
  category: keyof typeof OVERLAP_CATEGORIES;
  /** Is overlap at district edge (vs interior)? */
  isEdgeOverlap: boolean;
  /** Overlap perimeter in meters */
  overlapPerimeter: number;
  /** Ratio of overlap perimeter to sqrt(area) - high = elongated edge overlap */
  perimeterAreaRatio: number;
}

interface CityExclusivityAnalysis {
  fips: string;
  cityName: string;
  state: string;
  districtCount: number;
  totalOverlapArea: number;
  overlappingPairCount: number;
  overlaps: OverlapPair[];
  categoryCounts: Record<keyof typeof OVERLAP_CATEGORIES, number>;
  edgeOverlapCount: number;
  interiorOverlapCount: number;
  maxOverlapArea: number;
  medianOverlapArea: number;
  /** Whether this city would pass with a lower epsilon */
  wouldPassWithEpsilon: number | null;
}

interface AggregateStatistics {
  totalCitiesAnalyzed: number;
  citiesWithExclusivityFailures: number;
  totalOverlappingPairs: number;
  categoryCounts: Record<keyof typeof OVERLAP_CATEGORIES, number>;
  edgeOverlapTotal: number;
  interiorOverlapTotal: number;
  allOverlapAreas: number[];
  medianOverlapArea: number;
  p95OverlapArea: number;
  p99OverlapArea: number;
  maxOverlapArea: number;
  recommendedEpsilon: number;
  citiesPassingWithCurrentEpsilon: number;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Get district identifier from feature properties
 */
function getDistrictId(feature: Feature<Polygon | MultiPolygon>): string {
  const props = feature.properties || {};
  const idFields = [
    'districtId', 'DISTRICT', 'District', 'district',
    'DIST', 'WARD', 'Ward', 'ward',
    'NAME', 'Name', 'name', 'ID', 'id',
    'DISPLAY_NAME', 'Council_District', 'COUNCIL_DISTRICT',
  ];

  for (const field of idFields) {
    if (props[field] !== undefined && props[field] !== null) {
      return String(props[field]);
    }
  }

  return 'unknown';
}

/**
 * Calculate perimeter of a polygon
 */
function calculatePerimeter(feature: Feature<Polygon | MultiPolygon>): number {
  try {
    return turf.length(turf.polygonToLine(feature), { units: 'meters' });
  } catch {
    return 0;
  }
}

/**
 * Determine if overlap is at edge (elongated) vs interior (compact)
 *
 * Edge overlaps have high perimeter-to-sqrt(area) ratio (elongated slivers)
 * Interior overlaps have low ratio (more compact shapes)
 *
 * A perfect square has ratio = 4
 * An elongated sliver (10:1 aspect) has ratio ~ 6.3
 * A very thin line (100:1 aspect) has ratio ~ 20
 */
function isEdgeOverlap(overlap: Feature<Polygon | MultiPolygon>, area: number): boolean {
  const perimeter = calculatePerimeter(overlap);
  const idealPerimeter = 4 * Math.sqrt(area); // Perimeter of square with same area
  const ratio = perimeter / idealPerimeter;

  // Ratio > 2 suggests elongated shape (likely edge artifact)
  return ratio > 2;
}

/**
 * Get center point of a geometry
 */
function getCenter(feature: Feature<Polygon | MultiPolygon>): [number, number] {
  try {
    const centroid = turf.centroid(feature);
    return centroid.geometry.coordinates as [number, number];
  } catch {
    return [0, 0];
  }
}

/**
 * Categorize overlap by area
 */
function categorizeOverlap(area: number): keyof typeof OVERLAP_CATEGORIES {
  if (area < OVERLAP_CATEGORIES.MICRO.max) return 'MICRO';
  if (area < OVERLAP_CATEGORIES.SMALL.max) return 'SMALL';
  if (area < OVERLAP_CATEGORIES.MEDIUM.max) return 'MEDIUM';
  return 'LARGE';
}

/**
 * Calculate median of an array
 */
function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Calculate percentile of an array
 */
function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

// =============================================================================
// Analysis Functions
// =============================================================================

/**
 * Analyze exclusivity for a single city
 */
function analyzeExclusivity(
  features: Feature<Polygon | MultiPolygon>[],
  cityName: string,
  state: string,
  fips: string
): CityExclusivityAnalysis {
  const overlaps: OverlapPair[] = [];
  const categoryCounts: Record<keyof typeof OVERLAP_CATEGORIES, number> = {
    MICRO: 0,
    SMALL: 0,
    MEDIUM: 0,
    LARGE: 0,
  };
  let totalOverlapArea = 0;
  let edgeOverlapCount = 0;
  let interiorOverlapCount = 0;

  // Pairwise intersection check
  for (let i = 0; i < features.length; i++) {
    for (let j = i + 1; j < features.length; j++) {
      try {
        const intersection = turf.intersect(
          turf.featureCollection([features[i], features[j]])
        );

        if (intersection) {
          const overlapArea = turf.area(intersection);

          // Only count significant overlaps (> 1 sq m to filter noise)
          if (overlapArea > 1) {
            const category = categorizeOverlap(overlapArea);
            const isEdge = isEdgeOverlap(intersection, overlapArea);
            const perimeter = calculatePerimeter(intersection);
            const perimeterAreaRatio = perimeter / Math.sqrt(overlapArea);

            const overlap: OverlapPair = {
              districtA: i,
              districtB: j,
              districtAId: getDistrictId(features[i]),
              districtBId: getDistrictId(features[j]),
              overlapArea,
              overlapCenter: getCenter(intersection),
              category,
              isEdgeOverlap: isEdge,
              overlapPerimeter: perimeter,
              perimeterAreaRatio,
            };

            overlaps.push(overlap);
            categoryCounts[category]++;
            totalOverlapArea += overlapArea;

            if (isEdge) {
              edgeOverlapCount++;
            } else {
              interiorOverlapCount++;
            }
          }
        }
      } catch {
        // Invalid geometry - skip
      }
    }
  }

  // Calculate statistics
  const overlapAreas = overlaps.map((o) => o.overlapArea);
  const maxOverlapArea = overlapAreas.length > 0 ? Math.max(...overlapAreas) : 0;
  const medianOverlapArea = median(overlapAreas);

  // Determine minimum epsilon that would pass this city
  let wouldPassWithEpsilon: number | null = null;
  if (totalOverlapArea > 0 && totalOverlapArea < CURRENT_OVERLAP_EPSILON) {
    // Already passes
    wouldPassWithEpsilon = totalOverlapArea;
  } else if (totalOverlapArea >= CURRENT_OVERLAP_EPSILON) {
    // Would need higher epsilon
    wouldPassWithEpsilon = totalOverlapArea * 1.1; // 10% buffer
  }

  return {
    fips,
    cityName,
    state,
    districtCount: features.length,
    totalOverlapArea,
    overlappingPairCount: overlaps.length,
    overlaps,
    categoryCounts,
    edgeOverlapCount,
    interiorOverlapCount,
    maxOverlapArea,
    medianOverlapArea,
    wouldPassWithEpsilon,
  };
}

/**
 * Fetch district data from URL
 */
async function fetchDistricts(url: string): Promise<FeatureCollection<Polygon | MultiPolygon> | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'VOTER-Protocol/1.0 (Exclusivity-Analysis)',
        Accept: 'application/geo+json, application/json',
      },
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (!data.features || !Array.isArray(data.features)) return null;

    return data as FeatureCollection<Polygon | MultiPolygon>;
  } catch {
    return null;
  }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const config = parseArgs();

  console.log('====================================================================');
  console.log('     EXCLUSIVITY FAILURE ANALYSIS (WS-4)');
  console.log('     Analyzing Council District Overlaps');
  console.log('====================================================================\n');

  console.log(`Current OVERLAP_EPSILON: ${CURRENT_OVERLAP_EPSILON.toLocaleString()} sq m`);
  console.log(`                        (${(CURRENT_OVERLAP_EPSILON / 4_046.86).toFixed(1)} acres)\n`);

  // Get cities to analyze
  let portals: KnownPortal[];

  if (config.fips) {
    const portal = KNOWN_PORTALS[config.fips];
    if (!portal) {
      console.error(`City with FIPS ${config.fips} not found in registry`);
      process.exit(1);
    }
    portals = [portal];
  } else {
    // Filter to 7-digit FIPS (cities only)
    portals = Object.values(KNOWN_PORTALS).filter((p) => /^\d{7}$/.test(p.cityFips));
    if (config.limit) {
      portals = portals.slice(0, config.limit);
    }
  }

  console.log(`Analyzing ${portals.length} cities...\n`);

  // Track results
  const cityAnalyses: CityExclusivityAnalysis[] = [];
  const exclusivityFailures: CityExclusivityAnalysis[] = [];
  let fetchErrors = 0;

  // Process cities
  for (let i = 0; i < portals.length; i++) {
    const portal = portals[i];
    const progress = `[${i + 1}/${portals.length}]`;

    process.stdout.write(`${progress} ${portal.cityName}, ${portal.state}... `);

    // Fetch districts
    const districts = await fetchDistricts(portal.downloadUrl);

    if (!districts) {
      console.log('SKIP (fetch error)');
      fetchErrors++;
      continue;
    }

    // Analyze exclusivity
    const analysis = analyzeExclusivity(
      districts.features,
      portal.cityName,
      portal.state,
      portal.cityFips
    );

    cityAnalyses.push(analysis);

    if (analysis.totalOverlapArea > CURRENT_OVERLAP_EPSILON) {
      exclusivityFailures.push(analysis);
      console.log(`FAIL (overlap: ${(analysis.totalOverlapArea / 1_000_000).toFixed(2)} sq km)`);
    } else if (analysis.totalOverlapArea > 0) {
      console.log(`PASS (overlap: ${analysis.totalOverlapArea.toFixed(0)} sq m < epsilon)`);
    } else {
      console.log('PASS (no overlap)');
    }

    // Verbose output
    if (config.verbose && analysis.overlaps.length > 0) {
      console.log(`    Pairs: ${analysis.overlappingPairCount}`);
      console.log(`    Edge: ${analysis.edgeOverlapCount}, Interior: ${analysis.interiorOverlapCount}`);
      console.log(`    Categories: MICRO=${analysis.categoryCounts.MICRO}, SMALL=${analysis.categoryCounts.SMALL}, MEDIUM=${analysis.categoryCounts.MEDIUM}, LARGE=${analysis.categoryCounts.LARGE}`);
    }

    // Rate limiting
    await new Promise((r) => setTimeout(r, 100));
  }

  // ==========================================================================
  // Aggregate Statistics
  // ==========================================================================

  const allOverlapAreas: number[] = [];
  const aggregateCategoryCounts: Record<keyof typeof OVERLAP_CATEGORIES, number> = {
    MICRO: 0,
    SMALL: 0,
    MEDIUM: 0,
    LARGE: 0,
  };
  let totalEdgeOverlaps = 0;
  let totalInteriorOverlaps = 0;

  for (const analysis of cityAnalyses) {
    for (const overlap of analysis.overlaps) {
      allOverlapAreas.push(overlap.overlapArea);
      aggregateCategoryCounts[overlap.category]++;
    }
    totalEdgeOverlaps += analysis.edgeOverlapCount;
    totalInteriorOverlaps += analysis.interiorOverlapCount;
  }

  const stats: AggregateStatistics = {
    totalCitiesAnalyzed: cityAnalyses.length,
    citiesWithExclusivityFailures: exclusivityFailures.length,
    totalOverlappingPairs: allOverlapAreas.length,
    categoryCounts: aggregateCategoryCounts,
    edgeOverlapTotal: totalEdgeOverlaps,
    interiorOverlapTotal: totalInteriorOverlaps,
    allOverlapAreas,
    medianOverlapArea: median(allOverlapAreas),
    p95OverlapArea: percentile(allOverlapAreas, 95),
    p99OverlapArea: percentile(allOverlapAreas, 99),
    maxOverlapArea: allOverlapAreas.length > 0 ? Math.max(...allOverlapAreas) : 0,
    recommendedEpsilon: 0,
    citiesPassingWithCurrentEpsilon: cityAnalyses.length - exclusivityFailures.length,
  };

  // Calculate recommended epsilon (covers 95% of overlaps)
  stats.recommendedEpsilon = stats.p95OverlapArea * 1.5; // 50% buffer above p95

  // ==========================================================================
  // Output Results
  // ==========================================================================

  console.log('\n====================================================================');
  console.log('                    AGGREGATE STATISTICS');
  console.log('====================================================================\n');

  console.log(`Cities analyzed: ${stats.totalCitiesAnalyzed}`);
  console.log(`Cities with ANY overlap: ${cityAnalyses.filter((c) => c.overlaps.length > 0).length}`);
  console.log(`Cities exceeding epsilon: ${stats.citiesWithExclusivityFailures}`);
  console.log(`Fetch errors: ${fetchErrors}\n`);

  console.log('--- OVERLAP DISTRIBUTION BY CATEGORY ---');
  for (const [key, value] of Object.entries(stats.categoryCounts)) {
    const cat = OVERLAP_CATEGORIES[key as keyof typeof OVERLAP_CATEGORIES];
    const pct = stats.totalOverlappingPairs > 0
      ? ((value / stats.totalOverlappingPairs) * 100).toFixed(1)
      : '0.0';
    console.log(`  ${cat.label}: ${value} (${pct}%) - ${cat.description}`);
  }

  console.log('\n--- OVERLAP AREA STATISTICS ---');
  console.log(`  Total overlapping pairs: ${stats.totalOverlappingPairs}`);
  console.log(`  Median overlap area: ${stats.medianOverlapArea.toFixed(0)} sq m`);
  console.log(`  95th percentile: ${stats.p95OverlapArea.toFixed(0)} sq m`);
  console.log(`  99th percentile: ${stats.p99OverlapArea.toFixed(0)} sq m`);
  console.log(`  Maximum overlap: ${stats.maxOverlapArea.toFixed(0)} sq m (${(stats.maxOverlapArea / 1_000_000).toFixed(3)} sq km)`);

  console.log('\n--- EDGE VS INTERIOR PATTERN ---');
  const totalOverlaps = stats.edgeOverlapTotal + stats.interiorOverlapTotal;
  const edgePct = totalOverlaps > 0 ? ((stats.edgeOverlapTotal / totalOverlaps) * 100).toFixed(1) : '0';
  const interiorPct = totalOverlaps > 0 ? ((stats.interiorOverlapTotal / totalOverlaps) * 100).toFixed(1) : '0';
  console.log(`  Edge overlaps (elongated): ${stats.edgeOverlapTotal} (${edgePct}%)`);
  console.log(`  Interior overlaps (compact): ${stats.interiorOverlapTotal} (${interiorPct}%)`);

  console.log('\n--- EPSILON ANALYSIS ---');
  console.log(`  Current OVERLAP_EPSILON: ${CURRENT_OVERLAP_EPSILON.toLocaleString()} sq m`);
  console.log(`  Cities passing with current: ${stats.citiesPassingWithCurrentEpsilon}/${stats.totalCitiesAnalyzed}`);

  // Calculate how many would pass at different epsilons
  const testEpsilons = [10_000, 50_000, 100_000, 150_000, 200_000, 500_000];
  console.log('\n  Cities passing at different epsilons:');
  for (const epsilon of testEpsilons) {
    const passing = cityAnalyses.filter((c) => c.totalOverlapArea <= epsilon).length;
    const pct = ((passing / cityAnalyses.length) * 100).toFixed(1);
    const marker = epsilon === CURRENT_OVERLAP_EPSILON ? ' (current)' : '';
    console.log(`    ${epsilon.toLocaleString().padStart(10)} sq m: ${passing}/${cityAnalyses.length} (${pct}%)${marker}`);
  }

  // ==========================================================================
  // Exclusivity Failure Details
  // ==========================================================================

  if (exclusivityFailures.length > 0) {
    console.log('\n====================================================================');
    console.log('                 EXCLUSIVITY FAILURE DETAILS');
    console.log('====================================================================\n');

    // Sort by total overlap area (worst first)
    const sorted = [...exclusivityFailures].sort((a, b) => b.totalOverlapArea - a.totalOverlapArea);

    for (const failure of sorted.slice(0, 10)) {
      console.log(`--- ${failure.cityName}, ${failure.state} (${failure.fips}) ---`);
      console.log(`  Districts: ${failure.districtCount}`);
      console.log(`  Total overlap: ${failure.totalOverlapArea.toFixed(0)} sq m (${(failure.totalOverlapArea / 1_000_000).toFixed(3)} sq km)`);
      console.log(`  Overlapping pairs: ${failure.overlappingPairCount}`);
      console.log(`  Edge vs Interior: ${failure.edgeOverlapCount} / ${failure.interiorOverlapCount}`);
      console.log(`  Categories: MICRO=${failure.categoryCounts.MICRO}, SMALL=${failure.categoryCounts.SMALL}, MEDIUM=${failure.categoryCounts.MEDIUM}, LARGE=${failure.categoryCounts.LARGE}`);

      // Show top 3 overlapping pairs
      const topPairs = [...failure.overlaps].sort((a, b) => b.overlapArea - a.overlapArea).slice(0, 3);
      if (topPairs.length > 0) {
        console.log('  Largest overlaps:');
        for (const pair of topPairs) {
          const type = pair.isEdgeOverlap ? 'edge' : 'interior';
          console.log(`    - ${pair.districtAId} x ${pair.districtBId}: ${pair.overlapArea.toFixed(0)} sq m (${type})`);
        }
      }
      console.log('');
    }

    if (sorted.length > 10) {
      console.log(`... and ${sorted.length - 10} more cities with exclusivity failures\n`);
    }
  }

  // ==========================================================================
  // Recommendations
  // ==========================================================================

  console.log('\n====================================================================');
  console.log('                    RECOMMENDATIONS');
  console.log('====================================================================\n');

  if (stats.medianOverlapArea < 1000) {
    console.log('FINDING: Median overlap is small (<1,000 sq m), suggesting edge artifacts.');
    console.log('         Most overlaps are precision issues at shared boundaries.\n');
  }

  if (stats.edgeOverlapTotal > stats.interiorOverlapTotal) {
    console.log('FINDING: Majority of overlaps are edge-type (elongated slivers).');
    console.log('         This indicates surveying precision issues, not data errors.\n');
  }

  if (stats.citiesWithExclusivityFailures > 0 && stats.p95OverlapArea < CURRENT_OVERLAP_EPSILON) {
    console.log('FINDING: 95th percentile overlap is below current epsilon.');
    console.log('         Large overlaps in failing cities may indicate actual data problems.\n');
  }

  console.log('RECOMMENDED ACTIONS:');
  console.log('  1. For MICRO overlaps (<1,000 sq m): Accept as edge precision artifacts');
  console.log('  2. For SMALL overlaps (1-10k sq m): Investigate topology, consider buffer(0)');
  console.log('  3. For LARGE overlaps (>100k sq m): Manual review - likely data error\n');

  // Epsilon recommendation
  if (stats.citiesWithExclusivityFailures === 0) {
    console.log('EPSILON RECOMMENDATION: Current value is sufficient.');
  } else if (stats.citiesWithExclusivityFailures <= 5 && stats.maxOverlapArea < 500_000) {
    console.log(`EPSILON RECOMMENDATION: Consider increasing to ${Math.ceil(stats.maxOverlapArea * 1.2).toLocaleString()} sq m`);
    console.log('                        This would cover current failures while remaining conservative.');
  } else {
    console.log('EPSILON RECOMMENDATION: Do NOT increase epsilon blindly.');
    console.log('                        Large overlaps suggest actual data quality issues.');
    console.log('                        Fix source data for cities with LARGE/MEDIUM overlaps.');
  }

  // ==========================================================================
  // Summary Table for Documentation
  // ==========================================================================

  console.log('\n====================================================================');
  console.log('              SUMMARY TABLE (for documentation)');
  console.log('====================================================================\n');

  console.log('| Metric | Value |');
  console.log('|--------|-------|');
  console.log(`| Cities analyzed | ${stats.totalCitiesAnalyzed} |`);
  console.log(`| Cities with overlaps | ${cityAnalyses.filter((c) => c.overlaps.length > 0).length} |`);
  console.log(`| Cities failing exclusivity | ${stats.citiesWithExclusivityFailures} |`);
  console.log(`| Total overlapping pairs | ${stats.totalOverlappingPairs} |`);
  console.log(`| MICRO overlaps (<1k sq m) | ${stats.categoryCounts.MICRO} |`);
  console.log(`| SMALL overlaps (1k-10k sq m) | ${stats.categoryCounts.SMALL} |`);
  console.log(`| MEDIUM overlaps (10k-100k sq m) | ${stats.categoryCounts.MEDIUM} |`);
  console.log(`| LARGE overlaps (>100k sq m) | ${stats.categoryCounts.LARGE} |`);
  console.log(`| Edge overlaps (%) | ${edgePct}% |`);
  console.log(`| Median overlap area | ${stats.medianOverlapArea.toFixed(0)} sq m |`);
  console.log(`| 95th percentile | ${stats.p95OverlapArea.toFixed(0)} sq m |`);
  console.log(`| Maximum overlap | ${stats.maxOverlapArea.toFixed(0)} sq m |`);

  process.exit(stats.citiesWithExclusivityFailures > 0 ? 1 : 0);
}

main().catch(console.error);
