#!/usr/bin/env npx tsx
/**
 * Complete Montana Coverage
 *
 * Achieves 100% coverage of every Montana community by:
 * 1. Loading ALL incorporated places from Census Bureau
 * 2. Classifying governance type (ward-based vs at-large)
 * 3. Discovering boundary data for ward-based cities
 * 4. Tracking coverage gaps for manual resolution
 *
 * Montana has ~129 incorporated places. Of these:
 * - ~10-15 have ward/district-based governance (need boundary data)
 * - ~115 have at-large governance (covered by municipal boundary)
 *
 * Usage:
 *   npx tsx scripts/complete-montana-coverage.ts
 *   npx tsx scripts/complete-montana-coverage.ts --discover-only
 *   npx tsx scripts/complete-montana-coverage.ts --classify-only
 */

import { CensusPlaceListLoader, type CensusPlace } from '../registry/census-place-list.js';
import { ArcGISHubScanner } from '../scanners/arcgis-hub.js';

/**
 * Montana governance classification
 *
 * Source: Montana Code Annotated, municipal charter research
 * Cities >5000 pop MUST be first-class cities with mayor-council or commission form
 * Most first-class cities use ward-based representation
 */
interface GovernanceClassification {
  readonly name: string;
  readonly geoid: string;
  readonly population: number;
  readonly governanceType: 'ward' | 'district' | 'at-large' | 'unknown';
  readonly expectedDistricts: number;
  readonly source: string;
  readonly confidence: 'verified' | 'inferred' | 'needs-research';
}

/**
 * Known Montana governance structures
 *
 * VERIFIED via subagent research on 2025-11-22.
 * Key corrections from original estimates:
 * - Havre: 4 wards (not 3)
 * - Laurel: 4 wards (not 3)
 * - Livingston: AT-LARGE (not ward-based, uses City Commission)
 */
const KNOWN_GOVERNANCE: Record<string, Omit<GovernanceClassification, 'name' | 'geoid' | 'population'>> = {
  // WARD-BASED CITIES (all have verified GeoJSON URLs in montana-boundaries.ts)
  'Billings': { governanceType: 'ward', expectedDistricts: 5, source: 'Yellowstone County GIS', confidence: 'verified' },
  'Missoula': { governanceType: 'ward', expectedDistricts: 6, source: 'City of Missoula GIS - PoliticalBoundaries_mso', confidence: 'verified' },
  'Kalispell': { governanceType: 'ward', expectedDistricts: 4, source: 'Flathead County GIS', confidence: 'verified' },
  'Belgrade': { governanceType: 'ward', expectedDistricts: 3, source: 'City of Belgrade GIS', confidence: 'verified' },
  'Havre': { governanceType: 'ward', expectedDistricts: 4, source: 'Montana State Library MSDI (CORRECTED: 4 not 3)', confidence: 'verified' },
  'Laurel': { governanceType: 'ward', expectedDistricts: 4, source: 'Yellowstone County GIS (CORRECTED: 4 not 3)', confidence: 'verified' },

  // DISTRICT-BASED CITIES (consolidated city-counties)
  'Helena': { governanceType: 'district', expectedDistricts: 7, source: 'City of Helena GIS - Citizens Council Districts', confidence: 'verified' },
  'Butte-Silver Bow': { governanceType: 'district', expectedDistricts: 12, source: 'Butte-Silver Bow GIS - Commissioner Districts', confidence: 'verified' },
  'Anaconda-Deer Lodge County': { governanceType: 'district', expectedDistricts: 5, source: 'Montana State Library MSDI', confidence: 'verified' },

  // AT-LARGE CITIES (no ward boundaries needed - municipal boundary only)
  'Great Falls': { governanceType: 'at-large', expectedDistricts: 0, source: 'City Commission form', confidence: 'verified' },
  'Bozeman': { governanceType: 'at-large', expectedDistricts: 0, source: 'City Commission form', confidence: 'verified' },
  'Livingston': { governanceType: 'at-large', expectedDistricts: 0, source: 'City Commission form (CORRECTED: not ward-based)', confidence: 'verified' },
  'Miles City': { governanceType: 'at-large', expectedDistricts: 0, source: 'City Commission form', confidence: 'verified' },
  'Sidney': { governanceType: 'at-large', expectedDistricts: 0, source: 'City Commission form', confidence: 'verified' },
  'Lewistown': { governanceType: 'at-large', expectedDistricts: 0, source: 'City Commission form', confidence: 'verified' },
  'Whitefish': { governanceType: 'at-large', expectedDistricts: 0, source: 'City Council at-large', confidence: 'verified' },
  'Polson': { governanceType: 'at-large', expectedDistricts: 0, source: 'City Commission form', confidence: 'verified' },
  'Columbia Falls': { governanceType: 'at-large', expectedDistricts: 0, source: 'City Council at-large', confidence: 'verified' },
  'Glendive': { governanceType: 'at-large', expectedDistricts: 0, source: 'City Commission form', confidence: 'verified' },
  'Dillon': { governanceType: 'at-large', expectedDistricts: 0, source: 'City Council at-large', confidence: 'verified' },
};

/**
 * Infer governance type for unknown cities based on Montana law
 */
function inferGovernance(place: CensusPlace): GovernanceClassification {
  const known = KNOWN_GOVERNANCE[place.name];

  if (known) {
    return {
      name: place.name,
      geoid: place.geoid,
      population: place.population,
      ...known,
    };
  }

  // Montana municipal governance rules:
  // - First-class cities (>5000): Mayor-council OR commission form
  // - Second-class cities (1000-5000): Mayor-council or commission
  // - Third-class cities (<1000): Usually trustee form, always at-large
  //
  // Without population data from TIGERweb, we mark as unknown
  // and let the discovery process determine

  return {
    name: place.name,
    geoid: place.geoid,
    population: place.population,
    governanceType: 'unknown',
    expectedDistricts: 0,
    source: 'Needs research - no population data',
    confidence: 'needs-research',
  };
}

/**
 * Discovery result for a place
 */
interface DiscoveryResult {
  readonly place: GovernanceClassification;
  readonly discoveryStatus: 'found' | 'not_found' | 'not_applicable' | 'error';
  readonly discoveredUrl: string | null;
  readonly discoveredFeatures: number | null;
  readonly notes: string;
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const discoverOnly = args.includes('--discover-only');
  const classifyOnly = args.includes('--classify-only');

  console.log('='.repeat(70));
  console.log('  COMPLETE MONTANA COVERAGE');
  console.log('  Every community. Every boundary. No exceptions.');
  console.log('='.repeat(70));
  console.log();

  // Step 1: Load ALL Montana incorporated places from Census
  console.log('Step 1: Loading Montana incorporated places from Census Bureau...');
  const loader = new CensusPlaceListLoader();
  const montanaPlaces = await loader.loadPlacesByState('30'); // MT FIPS = 30

  console.log(`   Found ${montanaPlaces.length} incorporated places in Montana`);
  console.log();

  // Step 2: Classify governance type
  console.log('Step 2: Classifying governance types...');
  const classifications = montanaPlaces.map(inferGovernance);

  const verified = classifications.filter(c => c.confidence === 'verified');
  const needsResearch = classifications.filter(c => c.confidence === 'needs-research');
  const wardBased = classifications.filter(c => c.governanceType === 'ward' || c.governanceType === 'district');
  const atLarge = classifications.filter(c => c.governanceType === 'at-large');

  console.log(`   Verified governance: ${verified.length}`);
  console.log(`   Needs research: ${needsResearch.length}`);
  console.log(`   Ward/district-based: ${wardBased.length}`);
  console.log(`   At-large: ${atLarge.length}`);
  console.log();

  if (classifyOnly) {
    // Just output classifications
    console.log('\n=== GOVERNANCE CLASSIFICATIONS ===\n');
    console.log('WARD/DISTRICT-BASED (need boundary discovery):');
    for (const c of wardBased) {
      console.log(`   ${c.name}: ${c.governanceType} (${c.expectedDistricts} districts) [${c.confidence}]`);
    }
    console.log('\nAT-LARGE (municipal boundary only):');
    for (const c of atLarge) {
      console.log(`   ${c.name}: at-large [${c.confidence}]`);
    }
    console.log('\nNEEDS RESEARCH:');
    for (const c of needsResearch.slice(0, 20)) {
      console.log(`   ${c.name}`);
    }
    if (needsResearch.length > 20) {
      console.log(`   ... and ${needsResearch.length - 20} more`);
    }
    return;
  }

  // Step 3: Discover boundary data for ward-based cities
  console.log('Step 3: Discovering boundary data for ward-based cities...');
  const scanner = new ArcGISHubScanner();
  const results: DiscoveryResult[] = [];

  for (const classification of wardBased) {
    console.log(`\n   Searching: ${classification.name}...`);

    try {
      const candidates = await scanner.search({
        name: classification.name,
        state: 'MT',
      });

      if (candidates.length > 0) {
        const best = candidates[0];
        console.log(`      FOUND: ${best.title} (score: ${best.score})`);
        results.push({
          place: classification,
          discoveryStatus: 'found',
          discoveredUrl: best.downloadUrl,
          discoveredFeatures: best.featureCount ?? null,
          notes: `Found via ArcGIS Hub: ${best.title}`,
        });
      } else {
        console.log(`      NOT FOUND - needs manual research`);
        results.push({
          place: classification,
          discoveryStatus: 'not_found',
          discoveredUrl: null,
          discoveredFeatures: null,
          notes: 'No ArcGIS Hub results - check city GIS portal or county GIS',
        });
      }
    } catch (error) {
      console.log(`      ERROR: ${error instanceof Error ? error.message : String(error)}`);
      results.push({
        place: classification,
        discoveryStatus: 'error',
        discoveredUrl: null,
        discoveredFeatures: null,
        notes: `Error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // At-large cities don't need ward boundary discovery
  for (const classification of atLarge) {
    results.push({
      place: classification,
      discoveryStatus: 'not_applicable',
      discoveredUrl: null,
      discoveredFeatures: null,
      notes: 'At-large governance - covered by municipal boundary',
    });
  }

  // Summary
  console.log('\n');
  console.log('='.repeat(70));
  console.log('  MONTANA COVERAGE SUMMARY');
  console.log('='.repeat(70));
  console.log();

  const found = results.filter(r => r.discoveryStatus === 'found');
  const notFound = results.filter(r => r.discoveryStatus === 'not_found');
  const notApplicable = results.filter(r => r.discoveryStatus === 'not_applicable');
  const errors = results.filter(r => r.discoveryStatus === 'error');

  console.log(`Total incorporated places: ${montanaPlaces.length}`);
  console.log();
  console.log('Ward/District-based cities:');
  console.log(`   Boundary data found: ${found.length}/${wardBased.length}`);
  console.log(`   Needs manual discovery: ${notFound.length}`);
  console.log(`   Errors: ${errors.length}`);
  console.log();
  console.log(`At-large cities (covered by municipal boundary): ${notApplicable.length}`);
  console.log(`Cities needing governance research: ${needsResearch.length}`);
  console.log();

  // List gaps
  if (notFound.length > 0) {
    console.log('=== MISSING BOUNDARY DATA (needs subagent research) ===');
    for (const r of notFound) {
      console.log(`   ${r.place.name}: ${r.place.expectedDistricts} expected districts`);
      console.log(`      Suggested sources: City GIS, County GIS, MT MLIA`);
    }
    console.log();
  }

  // Export results
  const outputPath = `data/montana-coverage-${new Date().toISOString().slice(0, 10)}.json`;
  const fs = await import('fs');
  const path = await import('path');
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const exportData = {
    timestamp: new Date().toISOString(),
    summary: {
      totalPlaces: montanaPlaces.length,
      wardBased: wardBased.length,
      atLarge: atLarge.length,
      needsResearch: needsResearch.length,
      boundaryDataFound: found.length,
      boundaryDataMissing: notFound.length,
    },
    classifications,
    discoveryResults: results,
    gaps: notFound.map(r => ({
      name: r.place.name,
      expectedDistricts: r.place.expectedDistricts,
      suggestedSources: [
        `${r.place.name} City GIS Portal`,
        'County GIS Portal',
        'Montana State Library MLIA',
        'Montana Association of Counties',
      ],
    })),
  };

  fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));
  console.log(`Results written to: ${outputPath}`);

  // Coverage calculation
  const wardCoverage = wardBased.length > 0 ? (found.length / wardBased.length * 100).toFixed(1) : '100.0';
  const totalCoverage = ((found.length + notApplicable.length) / montanaPlaces.length * 100).toFixed(1);

  console.log();
  console.log('=== COVERAGE METRICS ===');
  console.log(`Ward-based city coverage: ${wardCoverage}%`);
  console.log(`Total Montana coverage: ${totalCoverage}%`);
  console.log();

  if (parseFloat(totalCoverage) < 100) {
    console.log('Next steps to achieve 100% coverage:');
    console.log('1. Run subagent research for missing ward-based cities');
    console.log('2. Research governance type for unknown cities');
    console.log('3. Add any discovered sources to registry');
  } else {
    console.log('100% COVERAGE ACHIEVED');
  }
}

main().catch(console.error);
