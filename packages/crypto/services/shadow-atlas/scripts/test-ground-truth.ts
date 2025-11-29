#!/usr/bin/env npx tsx
/**
 * Ground Truth Validation
 *
 * Tests discovery against KNOWN ward-based cities for any region.
 * Validates the discovery pipeline produces accurate results.
 *
 * Usage:
 *   npx tsx scripts/test-ground-truth.ts --region US-MT
 *   npx tsx scripts/test-ground-truth.ts --region US-CA
 *   npx tsx scripts/test-ground-truth.ts --region CA-ON (future)
 *   npx tsx scripts/test-ground-truth.ts --region GB-ENG (future)
 */

import { ArcGISHubScanner } from '../scanners/arcgis-hub.js';
import type { CityTarget } from '../validators/enhanced-geographic-validator.js';

/**
 * Ground truth entry for validation
 */
interface GroundTruthEntry {
  readonly name: string;
  readonly region: string; // ISO 3166-2 subdivision (e.g., 'MT', 'CA', 'ENG')
  readonly country: string; // ISO 3166-1 alpha-2 (e.g., 'US', 'CA', 'GB')
  readonly expectedDistricts: number;
  readonly governanceType: 'ward' | 'district' | 'at-large';
  readonly knownSource: string;
  readonly population: number;
}

/**
 * Ground truth datasets by region
 *
 * VERIFIED via subagent research on 2025-11-22:
 * - Havre: 4 wards (corrected from 3)
 * - Laurel: 4 wards (corrected from 3)
 * - Livingston: AT-LARGE (corrected - uses City Commission, not wards)
 */
const GROUND_TRUTH: Record<string, GroundTruthEntry[]> = {
  'US-MT': [
    // Ward-based cities (verified URLs in montana-boundaries.ts)
    { name: 'Missoula', region: 'MT', country: 'US', expectedDistricts: 6, governanceType: 'ward', knownSource: 'City of Missoula GIS - PoliticalBoundaries_mso', population: 74428 },
    { name: 'Billings', region: 'MT', country: 'US', expectedDistricts: 5, governanceType: 'ward', knownSource: 'Yellowstone County GIS', population: 119533 },
    { name: 'Kalispell', region: 'MT', country: 'US', expectedDistricts: 4, governanceType: 'ward', knownSource: 'Flathead County GIS', population: 28137 },
    { name: 'Belgrade', region: 'MT', country: 'US', expectedDistricts: 3, governanceType: 'ward', knownSource: 'City of Belgrade GIS', population: 11802 },
    { name: 'Havre', region: 'MT', country: 'US', expectedDistricts: 4, governanceType: 'ward', knownSource: 'Montana State Library MSDI', population: 9846 },
    { name: 'Laurel', region: 'MT', country: 'US', expectedDistricts: 4, governanceType: 'ward', knownSource: 'Yellowstone County GIS', population: 7340 },
    // District-based cities (consolidated city-counties)
    { name: 'Helena', region: 'MT', country: 'US', expectedDistricts: 7, governanceType: 'district', knownSource: 'City of Helena GIS', population: 34370 },
    { name: 'Butte-Silver Bow', region: 'MT', country: 'US', expectedDistricts: 12, governanceType: 'district', knownSource: 'Butte-Silver Bow GIS', population: 34839 },
    { name: 'Anaconda-Deer Lodge County', region: 'MT', country: 'US', expectedDistricts: 5, governanceType: 'district', knownSource: 'Montana State Library MSDI', population: 9153 },
    // At-large cities (no ward boundaries needed)
    { name: 'Great Falls', region: 'MT', country: 'US', expectedDistricts: 0, governanceType: 'at-large', knownSource: 'City Commission form', population: 60506 },
    { name: 'Bozeman', region: 'MT', country: 'US', expectedDistricts: 0, governanceType: 'at-large', knownSource: 'City Commission form', population: 56908 },
    { name: 'Livingston', region: 'MT', country: 'US', expectedDistricts: 0, governanceType: 'at-large', knownSource: 'City Commission - CORRECTED (not wards)', population: 8131 },
    { name: 'Whitefish', region: 'MT', country: 'US', expectedDistricts: 0, governanceType: 'at-large', knownSource: 'City Council at-large', population: 8688 },
    { name: 'Miles City', region: 'MT', country: 'US', expectedDistricts: 0, governanceType: 'at-large', knownSource: 'City Commission form', population: 8410 },
  ],
  'US-CA': [
    { name: 'Los Angeles', region: 'CA', country: 'US', expectedDistricts: 15, governanceType: 'district', knownSource: 'LA City GIS Hub', population: 3898747 },
    { name: 'San Francisco', region: 'CA', country: 'US', expectedDistricts: 11, governanceType: 'district', knownSource: 'SF DataSF Portal', population: 873965 },
    { name: 'San Diego', region: 'CA', country: 'US', expectedDistricts: 9, governanceType: 'district', knownSource: 'SanGIS Portal', population: 1386932 },
    { name: 'San Jose', region: 'CA', country: 'US', expectedDistricts: 10, governanceType: 'district', knownSource: 'SJ GIS Portal', population: 1013240 },
    { name: 'Oakland', region: 'CA', country: 'US', expectedDistricts: 7, governanceType: 'district', knownSource: 'Oakland GIS', population: 433031 },
  ],
  // Future: Add more regions as we validate
  // 'CA-ON': [...], // Ontario, Canada
  // 'GB-ENG': [...], // England, UK
};

interface ValidationResult {
  city: string;
  expectedType: string;
  expectedDistricts: number;
  discoveryStatus: 'found' | 'not_found' | 'error';
  discoveredUrl: string | null;
  discoveredDistricts: number | null;
  confidence: number;
  matchesGroundTruth: boolean;
  notes: string;
}

function parseArgs(): { region: string } {
  const args = process.argv.slice(2);
  const regionIndex = args.indexOf('--region');

  if (regionIndex === -1 || !args[regionIndex + 1]) {
    console.log('Available regions:');
    for (const region of Object.keys(GROUND_TRUTH)) {
      console.log(`  --region ${region} (${GROUND_TRUTH[region].length} cities)`);
    }
    process.exit(1);
  }

  return { region: args[regionIndex + 1] };
}

async function main(): Promise<void> {
  const { region } = parseArgs();

  const groundTruth = GROUND_TRUTH[region];
  if (!groundTruth) {
    console.error(`Unknown region: ${region}`);
    console.log('Available regions:', Object.keys(GROUND_TRUTH).join(', '));
    process.exit(1);
  }

  console.log('========================================');
  console.log(`  GROUND TRUTH VALIDATION: ${region}`);
  console.log('========================================\n');

  const scanner = new ArcGISHubScanner();
  const results: ValidationResult[] = [];

  console.log(`Testing ${groundTruth.length} cities with known governance structures...\n`);

  for (const city of groundTruth) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ${city.name}, ${city.region} (pop: ${city.population.toLocaleString()})`);
    console.log(`   Expected: ${city.governanceType} (${city.expectedDistricts} districts)`);
    console.log(`   Known source: ${city.knownSource}`);
    console.log('='.repeat(60));

    try {
      const cityTarget: CityTarget = {
        name: city.name,
        state: city.region,
      };

      const candidates = await scanner.search(cityTarget);
      const scanResult = candidates.length > 0 ? candidates[0] : null;

      if (scanResult) {
        console.log(`\n   FOUND: ${scanResult.title}`);
        console.log(`      URL: ${scanResult.downloadUrl}`);
        console.log(`      Score: ${scanResult.score}`);
        console.log(`      Features: ${scanResult.featureCount ?? 'unknown'}`);

        const matchesGroundTruth = city.governanceType !== 'at-large';
        const notes = city.governanceType === 'at-large'
          ? 'POTENTIAL FALSE POSITIVE - at-large city'
          : 'Expected to find district data';

        results.push({
          city: city.name,
          expectedType: city.governanceType,
          expectedDistricts: city.expectedDistricts,
          discoveryStatus: 'found',
          discoveredUrl: scanResult.downloadUrl,
          discoveredDistricts: scanResult.featureCount ?? null,
          confidence: scanResult.score,
          matchesGroundTruth,
          notes,
        });
      } else {
        console.log(`\n   NOT FOUND`);

        const matchesGroundTruth = city.governanceType === 'at-large';
        const notes = city.governanceType === 'at-large'
          ? 'Correctly identified as at-large'
          : `MISSED - should have found ${city.expectedDistricts} districts`;

        results.push({
          city: city.name,
          expectedType: city.governanceType,
          expectedDistricts: city.expectedDistricts,
          discoveryStatus: 'not_found',
          discoveredUrl: null,
          discoveredDistricts: null,
          confidence: 0,
          matchesGroundTruth,
          notes,
        });
      }
    } catch (error) {
      console.log(`\n   ERROR: ${error instanceof Error ? error.message : String(error)}`);
      results.push({
        city: city.name,
        expectedType: city.governanceType,
        expectedDistricts: city.expectedDistricts,
        discoveryStatus: 'error',
        discoveredUrl: null,
        discoveredDistricts: null,
        confidence: 0,
        matchesGroundTruth: false,
        notes: `Error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // Summary
  console.log('\n\n========================================');
  console.log('  VALIDATION SUMMARY');
  console.log('========================================\n');

  const districtCities = results.filter((r) => r.expectedType !== 'at-large');
  const atLargeCities = results.filter((r) => r.expectedType === 'at-large');

  const districtFound = districtCities.filter((r) => r.discoveryStatus === 'found').length;
  const districtTotal = districtCities.length;
  const atLargeCorrect = atLargeCities.filter((r) => r.discoveryStatus === 'not_found').length;
  const atLargeTotal = atLargeCities.length;
  const totalCorrect = results.filter((r) => r.matchesGroundTruth).length;

  console.log('District-based cities:');
  console.log(`   Found: ${districtFound}/${districtTotal} (${districtTotal > 0 ? ((districtFound / districtTotal) * 100).toFixed(0) : 0}%)`);
  for (const r of districtCities) {
    const status = r.discoveryStatus === 'found' ? '[OK]' : '[MISS]';
    console.log(`   ${status} ${r.city}: ${r.notes}`);
  }

  if (atLargeTotal > 0) {
    console.log('\nAt-large cities:');
    console.log(`   Correctly identified: ${atLargeCorrect}/${atLargeTotal} (${((atLargeCorrect / atLargeTotal) * 100).toFixed(0)}%)`);
    for (const r of atLargeCities) {
      const status = r.matchesGroundTruth ? '[OK]' : '[FP]';
      console.log(`   ${status} ${r.city}: ${r.notes}`);
    }
  }

  console.log('\n----------------------------------------');
  console.log(`Overall accuracy: ${totalCorrect}/${results.length} (${((totalCorrect / results.length) * 100).toFixed(0)}%)`);
  console.log('----------------------------------------\n');

  // Export results
  const outputPath = `data/ground-truth-${region.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`;
  const fs = await import('fs');
  const path = await import('path');
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`Results written to: ${outputPath}`);

  // Trust assessment
  console.log('\n========================================');
  console.log('  TRUST ASSESSMENT');
  console.log('========================================\n');

  const recall = districtTotal > 0 ? districtFound / districtTotal : 1;
  const precision = atLargeTotal > 0 ? atLargeCorrect / atLargeTotal : 1;

  if (recall >= 0.8 && precision >= 0.8) {
    console.log('HIGH TRUST: 80%+ recall and precision');
  } else if (recall >= 0.5 || precision >= 0.5) {
    console.log('MEDIUM TRUST: 50-80% recall or precision');
    console.log('   Recommendation: Review search terms and filtering');
  } else {
    console.log('LOW TRUST: <50% recall or precision');
    console.log('   Recommendation: Major pipeline improvements needed');
  }
}

main().catch(console.error);
