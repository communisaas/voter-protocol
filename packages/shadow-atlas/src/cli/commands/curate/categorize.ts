/**
 * Curate Categorize Command
 *
 * Categorize unresolved layers into recovery categories:
 * - INTERNATIONAL: Non-US jurisdictions (should be rejected)
 * - RECOVERABLE_US: US jurisdictions identifiable via pattern matching
 * - GENERIC_TEMPLATE: Template layers without geographic context
 * - UNKNOWN: Layers requiring manual review
 *
 * Usage:
 *   shadow-atlas curate categorize <input-file> [options]
 *
 * Options:
 *   --output <file>                        Output file path (default: <input>-categorized.json)
 *   --international-action <action>        reject|quarantine|flag (default: flag)
 *   --recoverable-action <action>          auto|queue|review (default: queue)
 *   --confidence <n>                       Confidence threshold for auto-recovery (default: 80)
 *   --dry-run                              Show what would be categorized without writing
 *   --json                                 Output as JSON
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type { Command } from 'commander';
import { readFile, writeFile } from 'fs/promises';
import { resolve, dirname, basename } from 'path';
import { existsSync } from 'fs';
import { getGlobalContext } from '../../../../bin/shadow-atlas.js';

/**
 * Unresolved layer from input file
 */
interface UnresolvedLayer {
  readonly url: string;
  readonly name: string;
  readonly features: number;
  readonly confidence: number;
  readonly warnings: readonly string[];
}

/**
 * Recoverable layer with suggested resolution
 */
interface RecoverableLayer extends UnresolvedLayer {
  readonly suggestedFips: string;
  readonly suggestedName: string;
  readonly suggestedState: string;
  readonly recoveryMethod: string;
}

/**
 * Categorization result
 */
interface CategorizationResult {
  readonly category: 'INTERNATIONAL' | 'RECOVERABLE_US' | 'GENERIC_TEMPLATE' | 'UNKNOWN';
  readonly details?: string;
  readonly recovery?: RecoverableLayer;
}

/**
 * International pattern definition
 */
interface InternationalPattern {
  readonly pattern: RegExp;
  readonly country: string;
}

/**
 * US recovery pattern definition
 */
interface USRecoveryPattern {
  readonly pattern: RegExp;
  readonly fips: string;
  readonly name: string;
  readonly state: string;
}

/**
 * Command options
 */
interface CategorizeOptions {
  readonly output?: string;
  readonly internationalAction: 'reject' | 'quarantine' | 'flag';
  readonly recoverableAction: 'auto' | 'queue' | 'review';
  readonly confidence: string;
  readonly dryRun?: boolean;
}

/**
 * Categorization output structure
 */
interface CategorizationOutput {
  readonly summary: {
    readonly total: number;
    readonly international: number;
    readonly recoverable: number;
    readonly genericTemplate: number;
    readonly unknown: number;
  };
  readonly byCountry: Record<string, number>;
  readonly byCityRecoverable: Record<string, number>;
  readonly recoverable: readonly RecoverableLayer[];
  readonly international: readonly Array<UnresolvedLayer & { country: string }>;
  readonly genericTemplate: readonly Array<{ layer: UnresolvedLayer; details: string }>;
  readonly unknown: readonly UnresolvedLayer[];
  readonly metadata: {
    readonly inputFile: string;
    readonly categorizedAt: string;
    readonly options: {
      readonly internationalAction: string;
      readonly recoverableAction: string;
      readonly confidenceThreshold: number;
    };
  };
}

// International patterns (should be rejected)
const INTERNATIONAL_PATTERNS: readonly InternationalPattern[] = [
  // New Zealand
  { pattern: /hurunui|hutt.*city.*council/i, country: 'New Zealand' },
  // Canada
  { pattern: /ottawa|oshawa|windsor.*ward|calgary|FED_CENSUS.*WARD|toronto|TDSB|COTGEO|EPSB.*Political/i, country: 'Canada' },
  // Hong Kong
  { pattern: /hong.*kong|hotels.*district.*council/i, country: 'Hong Kong' },
  // Australia
  { pattern: /blacktown|lake.*macquarie|logan.*city.*council|parramatta|brisbane.*city|penrith.*city/i, country: 'Australia' },
  // UK
  { pattern: /coventry.*city.*council|parish.*ward|aberdeen.*city.*council|edinburgh.*council|dundee.*city|glasgow.*city|leeds.*city|salford.*city.*council|renfrewshire|JLP_HELAA|services-eu1\.arcgis/i, country: 'UK' },
  // South Africa
  { pattern: /merafong.*city/i, country: 'South Africa' },
  // French/Quebec
  { pattern: /quartier|carte_electoral/i, country: 'French/Quebec' },
  // Thailand/Myanmar
  { pattern: /kham/i, country: 'Thailand/Myanmar' },
  // India/Bangladesh
  { pattern: /bengaluru|bangalore|india.*ward|thana.*ward|dodoa.*city/i, country: 'India/Bangladesh' },
] as const;

// Recoverable US patterns with FIPS codes
const RECOVERABLE_US_PATTERNS: readonly USRecoveryPattern[] = [
  // Cities identifiable from URL/name
  { pattern: /city.*of.*jenks|jenks.*master/i, fips: '4038350', name: 'Jenks', state: 'OK' },
  { pattern: /glendale.*?az|glendaleaz/i, fips: '0430000', name: 'Glendale', state: 'AZ' },
  { pattern: /amite.*city/i, fips: '2201720', name: 'Amite City', state: 'LA' },
  { pattern: /ponchatoula/i, fips: '2261115', name: 'Ponchatoula', state: 'LA' },
  { pattern: /zionsville/i, fips: '1885506', name: 'Zionsville', state: 'IN' },
  { pattern: /chino.*hills/i, fips: '0613214', name: 'Chino Hills', state: 'CA' },
  { pattern: /lex_council|lexington.*council/i, fips: '2146027', name: 'Lexington', state: 'KY' },
  { pattern: /la_council.*district|la.*council.*boundary/i, fips: '0644000', name: 'Los Angeles', state: 'CA' },
  { pattern: /maui.*county/i, fips: '15009', name: 'Maui County', state: 'HI' },
  { pattern: /commerce.*city/i, fips: '0816495', name: 'Commerce City', state: 'CO' },
  { pattern: /COH_CITY.*COUNCIL|city.*of.*houston/i, fips: '4835000', name: 'Houston', state: 'TX' },
  { pattern: /johns.*island/i, fips: '4513330', name: 'Charleston', state: 'SC' },
  { pattern: /morrisville.*town/i, fips: '3746060', name: 'Morrisville', state: 'NC' },
  // Louisiana parishes
  { pattern: /tangipahoa.*parish|parish.*council.*districts.*(?:2023|2024|new)/i, fips: '22105', name: 'Tangipahoa Parish', state: 'LA' },
  // County-level
  { pattern: /san.*diego.*supervisorial|county.*of.*san.*diego/i, fips: '06073', name: 'San Diego County', state: 'CA' },
  // Org ID patterns
  { pattern: /r24cv1JRnR3HZXVQ/i, fips: '1235000', name: 'Jacksonville', state: 'FL' },
  { pattern: /vdNDkVykv9vEWFX4/i, fips: '4259040', name: 'Penn Hills', state: 'PA' },
  { pattern: /NYRP/i, fips: '3651000', name: 'New York', state: 'NY' },
  { pattern: /SLC_City|salt.*lake.*city/i, fips: '4967000', name: 'Salt Lake City', state: 'UT' },
  { pattern: /MD.*Legislative|HbzrdBZjOwNHp70P/i, fips: '24031', name: 'Montgomery County', state: 'MD' },
  { pattern: /GFjf8leC8Mas9DyE/i, fips: '22105', name: 'Tangipahoa Parish', state: 'LA' },
  { pattern: /Murphy.*Drill.*Site/i, fips: '0650398', name: 'Murphy', state: 'CA' },
  { pattern: /gis\.louisvilleco\.gov/i, fips: '0845970', name: 'Louisville', state: 'CO' },
  { pattern: /mfldmaps\.ci\.marshfield\.wi/i, fips: '5550425', name: 'Marshfield', state: 'WI' },
] as const;

/**
 * Register the categorize command
 */
export function registerCategorizeCommand(parent: Command): void {
  parent
    .command('categorize <input-file>')
    .description('Categorize unresolved layers into recovery categories')
    .option('-o, --output <file>', 'Output file path')
    .option(
      '--international-action <action>',
      'Action for international layers: reject|quarantine|flag',
      'flag'
    )
    .option(
      '--recoverable-action <action>',
      'Action for recoverable layers: auto|queue|review',
      'queue'
    )
    .option(
      '--confidence <n>',
      'Confidence threshold for auto-recovery',
      '80'
    )
    .option('--dry-run', 'Show what would be categorized without writing')
    .action(async (inputFile: string, options: CategorizeOptions) => {
      await executeCategorize(inputFile, options);
    });
}

/**
 * Categorize a single layer
 */
function categorizeLayer(layer: UnresolvedLayer): CategorizationResult {
  const searchText = `${layer.url} ${layer.name}`;

  // Check for international
  for (const intl of INTERNATIONAL_PATTERNS) {
    if (intl.pattern.test(searchText)) {
      return { category: 'INTERNATIONAL', details: intl.country };
    }
  }

  // Check for recoverable US patterns
  for (const us of RECOVERABLE_US_PATTERNS) {
    if (us.pattern.test(searchText)) {
      return {
        category: 'RECOVERABLE_US',
        recovery: {
          ...layer,
          suggestedFips: us.fips,
          suggestedName: us.name,
          suggestedState: us.state,
          recoveryMethod: 'NAME_PATTERN',
        },
      };
    }
  }

  // Check for generic template layers (ElectoralDistricts pattern)
  if (/ElectoralDistricts/i.test(layer.url)) {
    return { category: 'GENERIC_TEMPLATE', details: 'ElectoralDistricts template' };
  }

  // Generic ward/council layers without city context
  if (/^(ward|city\s*council|county\s*commissioners?)$/i.test(layer.name.trim())) {
    return { category: 'GENERIC_TEMPLATE', details: 'Generic layer name' };
  }

  return { category: 'UNKNOWN' };
}

/**
 * Execute the categorize command
 */
async function executeCategorize(
  inputFile: string,
  options: CategorizeOptions
): Promise<void> {
  const { config } = getGlobalContext();
  const jsonOutput = config.json;
  const dryRun = config.dryRun || options.dryRun;

  const inputPath = resolve(inputFile);
  const confidenceThreshold = parseInt(options.confidence, 10);

  // Validate input file exists
  if (!existsSync(inputPath)) {
    console.error(`Error: Input file not found: ${inputPath}`);
    process.exit(1);
  }

  // Determine output path
  const outputPath = options.output
    ? resolve(options.output)
    : resolve(
        dirname(inputPath),
        `${basename(inputPath, '.json')}-categorized.json`
      );

  if (!jsonOutput) {
    console.log('='.repeat(80));
    console.log('SHADOW ATLAS - LAYER CATEGORIZATION');
    console.log('='.repeat(80));
    console.log(`Input:  ${inputPath}`);
    console.log(`Output: ${outputPath}`);
    console.log(`Confidence threshold: ${confidenceThreshold}`);
    console.log(`International action: ${options.internationalAction}`);
    console.log(`Recoverable action:   ${options.recoverableAction}`);
    if (dryRun) {
      console.log('Mode:   DRY RUN (no files will be written)');
    }
    console.log('');
  }

  try {
    // Load input file
    const content = await readFile(inputPath, 'utf-8');
    const data = JSON.parse(content);
    const unresolved: UnresolvedLayer[] = data.unresolved;

    if (!jsonOutput) {
      console.log(`Total unresolved layers: ${unresolved.length}\n`);
      console.log('Categorizing...\n');
    }

    // Categorize layers
    const categories = {
      INTERNATIONAL: [] as Array<{ layer: UnresolvedLayer; country: string }>,
      RECOVERABLE_US: [] as RecoverableLayer[],
      GENERIC_TEMPLATE: [] as Array<{ layer: UnresolvedLayer; details: string }>,
      UNKNOWN: [] as UnresolvedLayer[],
    };

    for (const layer of unresolved) {
      const result = categorizeLayer(layer);

      switch (result.category) {
        case 'INTERNATIONAL':
          categories.INTERNATIONAL.push({ layer, country: result.details! });
          break;
        case 'RECOVERABLE_US':
          categories.RECOVERABLE_US.push(result.recovery!);
          break;
        case 'GENERIC_TEMPLATE':
          categories.GENERIC_TEMPLATE.push({ layer, details: result.details! });
          break;
        default:
          categories.UNKNOWN.push(layer);
      }
    }

    // Calculate statistics
    const byCountry: Record<string, number> = {};
    for (const item of categories.INTERNATIONAL) {
      byCountry[item.country] = (byCountry[item.country] || 0) + 1;
    }

    const byCityRecoverable: Record<string, number> = {};
    for (const item of categories.RECOVERABLE_US) {
      const key = `${item.suggestedName}, ${item.suggestedState}`;
      byCityRecoverable[key] = (byCityRecoverable[key] || 0) + 1;
    }

    // Create output
    const output: CategorizationOutput = {
      summary: {
        total: unresolved.length,
        international: categories.INTERNATIONAL.length,
        recoverable: categories.RECOVERABLE_US.length,
        genericTemplate: categories.GENERIC_TEMPLATE.length,
        unknown: categories.UNKNOWN.length,
      },
      byCountry,
      byCityRecoverable,
      recoverable: categories.RECOVERABLE_US,
      international: categories.INTERNATIONAL.map((i) => ({
        ...i.layer,
        country: i.country,
      })),
      genericTemplate: categories.GENERIC_TEMPLATE,
      unknown: categories.UNKNOWN,
      metadata: {
        inputFile: inputPath,
        categorizedAt: new Date().toISOString(),
        options: {
          internationalAction: options.internationalAction,
          recoverableAction: options.recoverableAction,
          confidenceThreshold,
        },
      },
    };

    // Output results
    if (jsonOutput) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      printCategorizationReport(output, options);
    }

    // Write output file
    if (!dryRun) {
      await writeFile(outputPath, JSON.stringify(output, null, 2));
      if (!jsonOutput) {
        console.log(`\nResults written to: ${outputPath}`);
      }
    }
  } catch (error) {
    if (jsonOutput) {
      console.log(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        })
      );
    } else {
      console.error(
        `\nError: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    process.exit(1);
  }
}

/**
 * Print categorization report
 */
function printCategorizationReport(
  output: CategorizationOutput,
  options: CategorizeOptions
): void {
  const { summary } = output;

  console.log('CATEGORY BREAKDOWN:');
  console.log('-'.repeat(60));
  console.log(
    `  INTERNATIONAL (${options.internationalAction}):     ${summary.international} (${((summary.international / summary.total) * 100).toFixed(1)}%)`
  );
  console.log(
    `  RECOVERABLE_US (${options.recoverableAction}):      ${summary.recoverable} (${((summary.recoverable / summary.total) * 100).toFixed(1)}%)`
  );
  console.log(
    `  GENERIC_TEMPLATE:           ${summary.genericTemplate} (${((summary.genericTemplate / summary.total) * 100).toFixed(1)}%)`
  );
  console.log(
    `  UNKNOWN:                    ${summary.unknown} (${((summary.unknown / summary.total) * 100).toFixed(1)}%)`
  );

  // International breakdown
  if (summary.international > 0) {
    console.log('\n' + '-'.repeat(60));
    console.log('INTERNATIONAL LAYERS (non-US jurisdictions):');
    console.log('-'.repeat(60));
    for (const [country, count] of Object.entries(output.byCountry).sort(
      (a, b) => b[1] - a[1]
    )) {
      console.log(`  ${country.padEnd(25)} ${count}`);
    }
  }

  // Recoverable US layers
  if (summary.recoverable > 0) {
    console.log('\n' + '-'.repeat(60));
    console.log('RECOVERABLE US LAYERS:');
    console.log('-'.repeat(60));
    for (const [city, count] of Object.entries(output.byCityRecoverable).sort(
      (a, b) => b[1] - a[1]
    )) {
      console.log(`  ${city.padEnd(35)} ${count}`);
    }
  }

  // Sample unknown layers
  if (summary.unknown > 0) {
    console.log('\n' + '-'.repeat(60));
    console.log('SAMPLE UNKNOWN LAYERS (may need manual review):');
    console.log('-'.repeat(60));
    for (const layer of output.unknown.slice(0, 10)) {
      console.log(`  ${layer.name}`);
      const urlPreview =
        layer.url.length > 70 ? layer.url.slice(0, 70) + '...' : layer.url;
      console.log(`    URL: ${urlPreview}`);
    }
    if (output.unknown.length > 10) {
      console.log(`  ... and ${output.unknown.length - 10} more`);
    }
  }

  // Actionable summary
  console.log('\n' + '='.repeat(80));
  console.log('ACTIONABLE SUMMARY');
  console.log('='.repeat(80));
  console.log(`
  ✓ International layers (${options.internationalAction}): ${summary.international}
  ✓ US layers recoverable via patterns: ${summary.recoverable}
  ✓ Generic templates (geocode failed): ${summary.genericTemplate}
  ✗ Unknown (need manual review): ${summary.unknown}

  RECOMMENDED ACTIONS:
  1. Use 'shadow-atlas curate promote' to add ${summary.recoverable} recoverable layers
  2. Mark ${summary.international} international layers for ${options.internationalAction}
  3. Review ${summary.unknown} unknown layers for manual classification
  4. Generic templates (${summary.genericTemplate}) may need direct API queries
  `);
}
