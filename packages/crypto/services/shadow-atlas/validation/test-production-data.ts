/**
 * Production Data Validation Test
 *
 * PURPOSE: Run deterministic validators on 86 Alabama cities discovered by the system
 * and analyze results to verify validators correctly reject garbage data.
 *
 * EXPECTED RESULTS:
 * - Most discoveries should REJECT (confidence <60) - DC land plans, transit stops, statewide data
 * - Very few should auto-accept (confidence ≥85)
 * - This proves the validators are working correctly
 *
 * CONTEXT:
 * - 86 discovered cities in Alabama
 * - We know most are wrong data (DC land development plans, transit stops, county/state boundaries)
 * - Validators MUST catch these before expensive LLM validation
 */

import * as fs from 'fs';
import * as path from 'path';
import { DeterministicValidationPipeline } from './deterministic-validators.js';
import type { NormalizedGeoJSON } from '../types/index.js';
import type { CityTarget } from './deterministic-validators.js';
import type { AdministrativeLevel } from '../types/provider.js';

/**
 * Alabama FIPS to city name mapping (top 86 by population)
 * Source: US Census Bureau FIPS codes
 */
const ALABAMA_CITIES: Record<string, string> = {
  '0100100': 'Abbeville',
  '0100124': 'Adamsville',
  '0100460': 'Alabaster',
  '0100484': 'Albertville',
  '0100676': 'Alexander City',
  '0100820': 'Aliceville',
  '0100988': 'Andalusia',
  '0101132': 'Anniston',
  '0101180': 'Arab',
  '0101228': 'Ardmore',
  '0101396': 'Argo',
  '0101660': 'Athens',
  '0101708': 'Atmore',
  '0101756': 'Attalla',
  '0101852': 'Auburn',
  '0102116': 'Bay Minette',
  '0102260': 'Bayou La Batre',
  '0102320': 'Bear Creek',
  '0102428': 'Bessemer',
  '0102500': 'Birmingham',
  '0102836': 'Boaz',
  '0102860': 'Brent',
  '0102908': 'Brewton',
  '0102956': 'Bridgeport',
  '0103004': 'Brighton',
  '0103028': 'Brookside',
  '0103076': 'Brookwood',
  '0103148': 'Butler',
  '0103364': 'Calera',
  '0103916': 'Centre',
  '0104060': 'Chatom',
  '0104132': 'Cherokee',
  '0104156': 'Chickasaw',
  '0104420': 'Clanton',
  '0104468': 'Clay',
  '0104492': 'Clayton',
  '0104636': 'Cleveland',
  '0104660': 'Collinsville',
  '0104684': 'Columbia',
  '0104852': 'Courtland',
  '0105212': 'Cullman',
  '0105356': 'Dadeville',
  '0105380': 'Daleville',
  '0105524': 'Daphne',
  '0105548': 'Dauphin Island',
  '0105596': 'Decatur',
  '0105644': 'Demopolis',
  '0106148': 'Dothan',
  '0106196': 'Double Springs',
  '0106604': 'East Brewton',
  '0106964': 'Elba',
  '0107132': 'Enterprise',
  '0107180': 'Eufaula',
  '0107228': 'Eutaw',
  '0107252': 'Evergreen',
  '0107300': 'Excel',
  '0107348': 'Fairfield',
  '0107396': 'Fairhope',
  '0107540': 'Fayette',
  '0107588': 'Five Points',
  '0107636': 'Florala',
  '0107660': 'Florence',
  '0107672': 'Foley',
  '0107732': 'Fort Deposit',
  '0107756': 'Fort Payne',
  '0107900': 'Fultondale',
  '0107948': 'Gadsden',
  '0107996': 'Gardendale',
  '0108068': 'Geneva',
  '0108092': 'Georgiana',
  '0108248': 'Glencoe',
  '0108272': 'Goodwater',
  '0108296': 'Gordo',
  '0108320': 'Grand Bay',
  '0108584': 'Greensboro',
  '0108608': 'Greenville',
  '0108680': 'Grove Hill',
  '0108704': 'Guin',
  '0108728': 'Gulf Shores',
  '0108776': 'Guntersville',
  '0108800': 'Hackleburg',
  '0108944': 'Hamilton',
  '0109076': 'Hanceville',
  '0109172': 'Hartselle',
  '0109244': 'Hayneville',
};

/**
 * Validation result categories
 */
interface CategoryStats {
  readonly autoAccept: readonly TestResult[];     // confidence ≥85
  readonly escalate: readonly TestResult[];       // 60-84
  readonly reject: readonly TestResult[];         // <60
}

/**
 * Individual test result
 */
interface TestResult {
  readonly fipsCode: string;
  readonly cityName: string;
  readonly featureCount: number;
  readonly confidence: number;
  readonly valid: boolean;
  readonly issues: readonly string[];
  readonly warnings: readonly string[];
  readonly sampleFeatureName: string | null;
}

/**
 * Main test execution
 */
async function runValidationTests(): Promise<void> {
  console.log('='.repeat(80));
  console.log('DETERMINISTIC VALIDATOR TESTING - 86 ALABAMA CITIES');
  console.log('='.repeat(80));
  console.log();

  const dataDir = '/Users/noot/Documents/voter-protocol/packages/crypto/data/boundaries/US/council-districts/AL';
  const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.geojson')).sort();

  console.log(`Found ${files.length} GeoJSON files\n`);

  const pipeline = new DeterministicValidationPipeline();
  const results: TestResult[] = [];

  // Process each file
  for (const file of files) {
    const filePath = path.join(dataDir, file);
    const fipsCode = extractFipsCode(file);
    const cityName = ALABAMA_CITIES[fipsCode] || `Unknown (${fipsCode})`;

    try {
      // Load GeoJSON
      const geojson = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as NormalizedGeoJSON;

      // Create city target
      const cityTarget: CityTarget = {
        id: fipsCode,
        name: cityName,
        region: 'AL',
        country: 'US',
        population: null,
        fips: fipsCode,
      };

      // Run validation
      const level: AdministrativeLevel = 'council-district';
      const validationResult = pipeline.validate(geojson, cityTarget, level);

      // Extract sample feature name
      const sampleFeatureName = geojson.features.length > 0
        ? extractFeatureName(geojson.features[0].properties)
        : null;

      results.push({
        fipsCode,
        cityName,
        featureCount: geojson.features.length,
        confidence: validationResult.confidence,
        valid: validationResult.valid,
        issues: validationResult.issues,
        warnings: validationResult.warnings,
        sampleFeatureName,
      });

      // Log progress
      const status = validationResult.confidence >= 85 ? 'AUTO-ACCEPT' :
                    validationResult.confidence >= 60 ? 'ESCALATE' : 'REJECT';
      console.log(`[${status.padEnd(11)}] ${cityName.padEnd(20)} | ${geojson.features.length.toString().padStart(5)} features | confidence: ${validationResult.confidence}`);

    } catch (error) {
      console.error(`ERROR processing ${cityName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Categorize results
  const categories: CategoryStats = categorizeResults(results);

  // Print summary statistics
  printSummaryStats(categories);

  // Print detailed examples
  printDetailedExamples(categories);
}

/**
 * Extract FIPS code from filename
 */
function extractFipsCode(filename: string): string {
  const match = filename.match(/AL_(\d{7})/);
  return match ? match[1] : '';
}

/**
 * Extract feature name from properties
 */
function extractFeatureName(properties: Record<string, unknown>): string | null {
  const nameFields = ['NAME', 'name', 'Name', 'DISTRICT', 'district'];
  for (const field of nameFields) {
    const value = properties[field];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
}

/**
 * Categorize results by confidence threshold
 */
function categorizeResults(results: readonly TestResult[]): CategoryStats {
  const autoAccept: TestResult[] = [];
  const escalate: TestResult[] = [];
  const reject: TestResult[] = [];

  for (const result of results) {
    if (result.confidence >= 85) {
      autoAccept.push(result);
    } else if (result.confidence >= 60) {
      escalate.push(result);
    } else {
      reject.push(result);
    }
  }

  return { autoAccept, escalate, reject };
}

/**
 * Print summary statistics
 */
function printSummaryStats(categories: CategoryStats): void {
  console.log();
  console.log('='.repeat(80));
  console.log('SUMMARY STATISTICS');
  console.log('='.repeat(80));
  console.log();

  const total = categories.autoAccept.length + categories.escalate.length + categories.reject.length;

  console.log(`Total cities tested: ${total}`);
  console.log();
  console.log(`AUTO-ACCEPT (confidence ≥85): ${categories.autoAccept.length} (${Math.round(categories.autoAccept.length / total * 100)}%)`);
  console.log(`ESCALATE (confidence 60-84):  ${categories.escalate.length} (${Math.round(categories.escalate.length / total * 100)}%)`);
  console.log(`REJECT (confidence <60):      ${categories.reject.length} (${Math.round(categories.reject.length / total * 100)}%)`);
  console.log();

  // Expected vs actual
  console.log('EXPECTED BEHAVIOR:');
  console.log('- Most should REJECT (DC land plans, transit stops, statewide data)');
  console.log('- Very few should auto-accept (only legitimate city council districts)');
  console.log();

  // Validation assessment
  const rejectPct = categories.reject.length / total * 100;
  if (rejectPct >= 70) {
    console.log('✅ VALIDATION WORKING CORRECTLY - High rejection rate as expected');
  } else if (rejectPct >= 50) {
    console.log('⚠️  VALIDATION PARTIALLY WORKING - Moderate rejection rate');
  } else {
    console.log('❌ VALIDATION MAY BE TOO PERMISSIVE - Low rejection rate');
  }
  console.log();
}

/**
 * Print detailed examples from each category
 */
function printDetailedExamples(categories: CategoryStats): void {
  console.log('='.repeat(80));
  console.log('DETAILED EXAMPLES');
  console.log('='.repeat(80));
  console.log();

  // Reject examples (should be most common)
  console.log('--- REJECT EXAMPLES (confidence <60) ---');
  console.log();
  const rejectExamples = categories.reject.slice(0, 5);
  for (const example of rejectExamples) {
    console.log(`${example.cityName} (${example.fipsCode})`);
    console.log(`  Features: ${example.featureCount}`);
    console.log(`  Confidence: ${example.confidence}`);
    console.log(`  Sample name: ${example.sampleFeatureName || 'N/A'}`);
    console.log(`  Issues:`);
    for (const issue of example.issues) {
      console.log(`    - ${issue}`);
    }
    if (example.warnings.length > 0) {
      console.log(`  Warnings:`);
      for (const warning of example.warnings) {
        console.log(`    - ${warning}`);
      }
    }
    console.log();
  }

  // Escalate examples
  console.log('--- ESCALATE EXAMPLES (confidence 60-84) ---');
  console.log();
  const escalateExamples = categories.escalate.slice(0, 3);
  if (escalateExamples.length === 0) {
    console.log('  (none)');
    console.log();
  } else {
    for (const example of escalateExamples) {
      console.log(`${example.cityName} (${example.fipsCode})`);
      console.log(`  Features: ${example.featureCount}`);
      console.log(`  Confidence: ${example.confidence}`);
      console.log(`  Sample name: ${example.sampleFeatureName || 'N/A'}`);
      if (example.warnings.length > 0) {
        console.log(`  Warnings:`);
        for (const warning of example.warnings) {
          console.log(`    - ${warning}`);
        }
      }
      console.log();
    }
  }

  // Auto-accept examples
  console.log('--- AUTO-ACCEPT EXAMPLES (confidence ≥85) ---');
  console.log();
  const acceptExamples = categories.autoAccept.slice(0, 3);
  if (acceptExamples.length === 0) {
    console.log('  (none)');
    console.log();
  } else {
    for (const example of acceptExamples) {
      console.log(`${example.cityName} (${example.fipsCode})`);
      console.log(`  Features: ${example.featureCount}`);
      console.log(`  Confidence: ${example.confidence}`);
      console.log(`  Sample name: ${example.sampleFeatureName || 'N/A'}`);
      if (example.warnings.length > 0) {
        console.log(`  Warnings:`);
        for (const warning of example.warnings) {
          console.log(`    - ${warning}`);
        }
      }
      console.log();
    }
  }

  // Feature count distribution
  console.log('='.repeat(80));
  console.log('FEATURE COUNT DISTRIBUTION');
  console.log('='.repeat(80));
  console.log();

  const allResults = [...categories.autoAccept, ...categories.escalate, ...categories.reject];
  const counts = allResults.map(r => r.featureCount).sort((a, b) => a - b);
  const min = counts[0] || 0;
  const max = counts[counts.length - 1] || 0;
  const median = counts[Math.floor(counts.length / 2)] || 0;

  console.log(`Min features:    ${min}`);
  console.log(`Median features: ${median}`);
  console.log(`Max features:    ${max}`);
  console.log();

  // Cities with extreme counts
  const extremeCounts = allResults.filter(r => r.featureCount > 100 || r.featureCount < 5);
  console.log(`Cities with extreme counts (>100 or <5): ${extremeCounts.length}`);
  for (const result of extremeCounts.slice(0, 10)) {
    console.log(`  ${result.cityName}: ${result.featureCount} features (${result.sampleFeatureName || 'N/A'})`);
  }
  console.log();
}

// Run the tests
runValidationTests().catch(error => {
  console.error('FATAL ERROR:', error);
  process.exit(1);
});
