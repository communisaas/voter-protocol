/**
 * Overlap Magnitude Analysis Script
 *
 * PURPOSE: Quantify overlap areas for exclusivity failures to determine if they're
 * tolerance-sensitive edge cases or true topology errors.
 *
 * CLASSIFICATION BY OVERLAP MAGNITUDE:
 * - < 1,000 sq m: Likely edge rounding (tolerance-fixable)
 * - 1,000 - 150,000 sq m: Ambiguous (needs review)
 * - > 150,000 sq m: True topology error (source problem)
 *
 * EXCLUSIVITY FAILURES TO ANALYZE (24 cities):
 * - Ocala FL, Chattahoochee Hills GA, Milton GA, Macomb IL
 * - Portage IN, Haysville KS, Bossier City LA, Fernley NV
 * - Goldsboro NC, DeSoto TX, La Porte TX, Little Elm TX
 * - Odessa TX, Sherman TX, Taylor TX, Kenosha WI
 * - Buckeye AZ, Littleton CO, Carson CA, Big Bear Lake CA
 * - Elk Grove CA, Menifee CA, Glendale AZ, San Bernardino CA
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as turf from '@turf/turf';
import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import { KNOWN_PORTALS } from '../src/core/registry/known-portals.generated.js';

// =============================================================================
// Types
// =============================================================================

interface OverlapPair {
  readonly district1: string;
  readonly district2: string;
  readonly overlapAreaSqM: number;
}

interface CityOverlapAnalysis {
  readonly city: string;
  readonly fips: string;
  readonly districtCount: number;
  readonly maxOverlapSqM: number;
  readonly totalOverlapSqM: number;
  readonly overlapPairs: readonly OverlapPair[];
  readonly classification: 'EDGE_ROUNDING' | 'AMBIGUOUS' | 'TOPOLOGY_ERROR';
  readonly recommendation: string;
}

interface AnalysisSummary {
  readonly results: readonly CityOverlapAnalysis[];
  readonly summary: {
    readonly edgeRounding: number;
    readonly ambiguous: number;
    readonly topologyError: number;
  };
  readonly recommendation: string;
}

// =============================================================================
// Configuration
// =============================================================================

const OVERLAP_THRESHOLDS = {
  EDGE_ROUNDING: 1000, // < 1,000 sq m likely from coordinate rounding
  TOPOLOGY_ERROR: 150000, // > 150,000 sq m is true topology error
} as const;

// Cities with exclusivity failures
const EXCLUSIVITY_FAILURE_CITIES = [
  '1250750', // Ocala FL
  '1315552', // Chattahoochee Hills GA
  '1351670', // Milton GA
  '1745889', // Macomb IL
  '1861092', // Portage IN
  '2031125', // Haysville KS
  '2208920', // Bossier City LA
  '3224900', // Fernley NV
  '3726880', // Goldsboro NC
  '4820092', // DeSoto TX
  '4841440', // La Porte TX
  '4843012', // Little Elm TX
  '4853388', // Odessa TX
  '4867496', // Sherman TX
  '4871948', // Taylor TX
  '5539225', // Kenosha WI
  '0407940', // Buckeye AZ
  '0845255', // Littleton CO
  '0611530', // Carson CA
  '0606434', // Big Bear Lake CA
  '0622020', // Elk Grove CA
  '0646842', // Menifee CA
  '0427820', // Glendale AZ
  '0665000', // San Bernardino CA
] as const;

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Fetch district data from portal URL
 */
async function fetchDistrictData(url: string): Promise<FeatureCollection<Polygon | MultiPolygon>> {
  console.log(`  Fetching: ${url.substring(0, 80)}...`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  const data = await response.json();
  return data as FeatureCollection<Polygon | MultiPolygon>;
}

/**
 * Extract district identifier from feature
 */
function getDistrictId(feature: Feature<Polygon | MultiPolygon>): string {
  const props = feature.properties || {};

  const idFields = [
    'districtId',
    'DISTRICT',
    'District',
    'district',
    'DIST',
    'WARD',
    'Ward',
    'ward',
    'NAME',
    'Name',
    'name',
    'ID',
    'id',
  ];

  for (const field of idFields) {
    if (props[field] !== undefined && props[field] !== null) {
      return String(props[field]);
    }
  }

  return 'unknown';
}

/**
 * Compute all pairwise overlaps between districts
 */
function computePairwiseOverlaps(
  features: Feature<Polygon | MultiPolygon>[]
): OverlapPair[] {
  const overlaps: OverlapPair[] = [];

  for (let i = 0; i < features.length; i++) {
    for (let j = i + 1; j < features.length; j++) {
      try {
        const intersection = turf.intersect(
          turf.featureCollection([features[i], features[j]])
        );

        if (intersection) {
          const overlapArea = turf.area(intersection);
          if (overlapArea > 0.1) { // Ignore floating point noise
            overlaps.push({
              district1: getDistrictId(features[i]),
              district2: getDistrictId(features[j]),
              overlapAreaSqM: overlapArea,
            });
          }
        }
      } catch (error) {
        console.warn(`    Warning: Failed to compute intersection between districts ${i} and ${j}`);
      }
    }
  }

  return overlaps;
}

/**
 * Classify overlap based on magnitude
 */
function classifyOverlap(maxOverlapSqM: number): 'EDGE_ROUNDING' | 'AMBIGUOUS' | 'TOPOLOGY_ERROR' {
  if (maxOverlapSqM < OVERLAP_THRESHOLDS.EDGE_ROUNDING) {
    return 'EDGE_ROUNDING';
  } else if (maxOverlapSqM < OVERLAP_THRESHOLDS.TOPOLOGY_ERROR) {
    return 'AMBIGUOUS';
  } else {
    return 'TOPOLOGY_ERROR';
  }
}

/**
 * Generate recommendation for a city
 */
function generateRecommendation(
  classification: 'EDGE_ROUNDING' | 'AMBIGUOUS' | 'TOPOLOGY_ERROR',
  maxOverlapSqM: number
): string {
  switch (classification) {
    case 'EDGE_ROUNDING':
      return 'Increase tolerance or ignore - overlap likely from coordinate rounding';
    case 'AMBIGUOUS':
      return `Review source data - ${maxOverlapSqM.toFixed(0)} sq m overlap may be fixable with tolerance adjustment`;
    case 'TOPOLOGY_ERROR':
      return `Fix source data - ${maxOverlapSqM.toFixed(0)} sq m overlap indicates wrong layer or duplicate districts`;
  }
}

/**
 * Analyze overlap magnitude for a single city
 */
async function analyzeCityOverlap(fips: string): Promise<CityOverlapAnalysis | null> {
  const portal = KNOWN_PORTALS[fips];
  if (!portal) {
    console.log(`  ⚠️  Portal not found for FIPS ${fips}`);
    return null;
  }

  console.log(`\nAnalyzing: ${portal.cityName}, ${portal.state} (FIPS ${fips})`);

  try {
    // Fetch district data
    const districts = await fetchDistrictData(portal.downloadUrl);
    const features = districts.features;

    if (features.length === 0) {
      console.log(`  ⚠️  No features found`);
      return null;
    }

    console.log(`  Districts: ${features.length}`);

    // Compute all pairwise overlaps
    const overlaps = computePairwiseOverlaps(features);

    if (overlaps.length === 0) {
      console.log(`  ✅ No overlaps detected (should not have failed exclusivity)`);
      return null;
    }

    // Calculate statistics
    const maxOverlapSqM = Math.max(...overlaps.map(o => o.overlapAreaSqM));
    const totalOverlapSqM = overlaps.reduce((sum, o) => sum + o.overlapAreaSqM, 0);
    const classification = classifyOverlap(maxOverlapSqM);
    const recommendation = generateRecommendation(classification, maxOverlapSqM);

    console.log(`  Max overlap: ${maxOverlapSqM.toFixed(2)} sq m`);
    console.log(`  Total overlap: ${totalOverlapSqM.toFixed(2)} sq m`);
    console.log(`  Classification: ${classification}`);
    console.log(`  Overlapping pairs: ${overlaps.length}`);

    return {
      city: `${portal.cityName}, ${portal.state}`,
      fips,
      districtCount: features.length,
      maxOverlapSqM,
      totalOverlapSqM,
      overlapPairs: overlaps,
      classification,
      recommendation,
    };
  } catch (error) {
    console.error(`  ❌ Error analyzing ${portal.cityName}:`, error);
    return null;
  }
}

/**
 * Generate summary statistics
 */
function generateSummary(results: CityOverlapAnalysis[]): AnalysisSummary['summary'] {
  return {
    edgeRounding: results.filter(r => r.classification === 'EDGE_ROUNDING').length,
    ambiguous: results.filter(r => r.classification === 'AMBIGUOUS').length,
    topologyError: results.filter(r => r.classification === 'TOPOLOGY_ERROR').length,
  };
}

/**
 * Generate overall recommendation
 */
function generateOverallRecommendation(summary: AnalysisSummary['summary']): string {
  const total = summary.edgeRounding + summary.ambiguous + summary.topologyError;
  const edgeRoundingPct = (summary.edgeRounding / total) * 100;
  const topologyErrorPct = (summary.topologyError / total) * 100;

  if (edgeRoundingPct > 60) {
    return `${edgeRoundingPct.toFixed(0)}% are edge rounding cases - consider increasing OVERLAP_EPSILON to ${OVERLAP_THRESHOLDS.TOPOLOGY_ERROR * 1.5} or implement edge-aware detection`;
  } else if (topologyErrorPct > 60) {
    return `${topologyErrorPct.toFixed(0)}% are true topology errors - focus on fixing source data quality`;
  } else {
    return `Mixed causes: ${summary.edgeRounding} edge rounding, ${summary.ambiguous} ambiguous, ${summary.topologyError} topology errors - requires case-by-case review`;
  }
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  console.log('='.repeat(80));
  console.log('OVERLAP MAGNITUDE ANALYSIS');
  console.log('Quantifying 24 exclusivity failures to classify by overlap magnitude');
  console.log('='.repeat(80));

  const results: CityOverlapAnalysis[] = [];

  // Analyze each city
  for (const fips of EXCLUSIVITY_FAILURE_CITIES) {
    const result = await analyzeCityOverlap(fips);
    if (result) {
      results.push(result);
    }
    // Rate limiting to avoid overwhelming servers
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Generate summary
  const summary = generateSummary(results);
  const recommendation = generateOverallRecommendation(summary);

  const analysis: AnalysisSummary = {
    results,
    summary,
    recommendation,
  };

  // Write results to file
  const outputDir = path.join(process.cwd(), 'analysis-output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, 'overlap-magnitude-results.json');
  fs.writeFileSync(outputPath, JSON.stringify(analysis, null, 2));

  // Print summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total cities analyzed: ${results.length}`);
  console.log(`Edge rounding cases: ${summary.edgeRounding} (${((summary.edgeRounding / results.length) * 100).toFixed(0)}%)`);
  console.log(`Ambiguous cases: ${summary.ambiguous} (${((summary.ambiguous / results.length) * 100).toFixed(0)}%)`);
  console.log(`Topology errors: ${summary.topologyError} (${((summary.topologyError / results.length) * 100).toFixed(0)}%)`);
  console.log('\nRECOMMENDATION:');
  console.log(recommendation);
  console.log('\n' + '='.repeat(80));
  console.log(`Results written to: ${outputPath}`);
  console.log('='.repeat(80));

  // Print detailed breakdown by category
  console.log('\nDETAILED BREAKDOWN:\n');

  console.log('EDGE ROUNDING (<1,000 sq m):');
  results
    .filter(r => r.classification === 'EDGE_ROUNDING')
    .forEach(r => {
      console.log(`  • ${r.city} - max ${r.maxOverlapSqM.toFixed(0)} sq m`);
    });

  console.log('\nAMBIGUOUS (1,000-150,000 sq m):');
  results
    .filter(r => r.classification === 'AMBIGUOUS')
    .forEach(r => {
      console.log(`  • ${r.city} - max ${r.maxOverlapSqM.toFixed(0)} sq m`);
    });

  console.log('\nTOPOLOGY ERRORS (>150,000 sq m):');
  results
    .filter(r => r.classification === 'TOPOLOGY_ERROR')
    .forEach(r => {
      console.log(`  • ${r.city} - max ${r.maxOverlapSqM.toFixed(0)} sq m`);
    });
}

// Run analysis
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
