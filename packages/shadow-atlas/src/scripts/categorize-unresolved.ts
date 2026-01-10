#!/usr/bin/env npx tsx
/**
 * Categorize unresolved layers to identify recovery opportunities
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface UnresolvedLayer {
  url: string;
  name: string;
  features: number;
  confidence: number;
  warnings: string[];
}

interface RecoverableLayer extends UnresolvedLayer {
  suggestedFips: string;
  suggestedName: string;
  suggestedState: string;
  recoveryMethod: string;
}

// International patterns (should be rejected)
const INTERNATIONAL_PATTERNS = [
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
  // Other
  { pattern: /quartier|carte_electoral/i, country: 'French/Quebec' },
  { pattern: /kham/i, country: 'Thailand/Myanmar' },
  { pattern: /bengaluru|bangalore|india.*ward|thana.*ward|dodoa.*city/i, country: 'India/Bangladesh' },
];

// Recoverable US patterns with FIPS codes
const RECOVERABLE_US_PATTERNS: Array<{
  pattern: RegExp;
  fips: string;
  name: string;
  state: string;
}> = [
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
  // Louisiana parishes (org ID GFjf8leC8Mas9DyE)
  { pattern: /tangipahoa.*parish|parish.*council.*districts.*(?:2023|2024|new)/i, fips: '22105', name: 'Tangipahoa Parish', state: 'LA' },
  // County-level
  { pattern: /san.*diego.*supervisorial|county.*of.*san.*diego/i, fips: '06073', name: 'San Diego County', state: 'CA' },
  // Org ID patterns (match org ID in URL)
  { pattern: /r24cv1JRnR3HZXVQ/i, fips: '1235000', name: 'Jacksonville', state: 'FL' }, // Jacksonville org
  { pattern: /vdNDkVykv9vEWFX4/i, fips: '4259040', name: 'Penn Hills', state: 'PA' }, // Penn Hills org
  // Additional cities
  { pattern: /NYRP/i, fips: '3651000', name: 'New York', state: 'NY' }, // NY Restoration Project
  { pattern: /SLC_City|salt.*lake.*city/i, fips: '4967000', name: 'Salt Lake City', state: 'UT' },
  { pattern: /MD.*Legislative|HbzrdBZjOwNHp70P/i, fips: '24031', name: 'Montgomery County', state: 'MD' }, // MD org
  { pattern: /GFjf8leC8Mas9DyE/i, fips: '22105', name: 'Tangipahoa Parish', state: 'LA' }, // Louisiana parishes org
  { pattern: /Murphy.*Drill.*Site/i, fips: '0650398', name: 'Murphy', state: 'CA' }, // Murphy, CA
  { pattern: /gis\.louisvilleco\.gov/i, fips: '0845970', name: 'Louisville', state: 'CO' }, // Louisville, CO
  { pattern: /mfldmaps\.ci\.marshfield\.wi/i, fips: '5550425', name: 'Marshfield', state: 'WI' }, // Marshfield, WI
];

function categorizeLayer(layer: UnresolvedLayer): {
  category: 'INTERNATIONAL' | 'RECOVERABLE_US' | 'GENERIC_TEMPLATE' | 'UNKNOWN';
  details?: string;
  recovery?: RecoverableLayer;
} {
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

async function main(): Promise<void> {
  const dataPath = path.join(__dirname, '../agents/data/attributed-council-districts.json');
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const unresolved: UnresolvedLayer[] = data.unresolved;

  console.log('='.repeat(80));
  console.log('UNRESOLVED LAYER CATEGORIZATION');
  console.log('='.repeat(80));
  console.log(`\nTotal unresolved: ${unresolved.length}\n`);

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

  // Summary
  console.log('CATEGORY BREAKDOWN:');
  console.log('-'.repeat(60));
  console.log(`  INTERNATIONAL (reject):     ${categories.INTERNATIONAL.length} (${((categories.INTERNATIONAL.length / unresolved.length) * 100).toFixed(1)}%)`);
  console.log(`  RECOVERABLE_US:             ${categories.RECOVERABLE_US.length} (${((categories.RECOVERABLE_US.length / unresolved.length) * 100).toFixed(1)}%)`);
  console.log(`  GENERIC_TEMPLATE:           ${categories.GENERIC_TEMPLATE.length} (${((categories.GENERIC_TEMPLATE.length / unresolved.length) * 100).toFixed(1)}%)`);
  console.log(`  UNKNOWN:                    ${categories.UNKNOWN.length} (${((categories.UNKNOWN.length / unresolved.length) * 100).toFixed(1)}%)`);

  // International breakdown
  console.log('\n' + '-'.repeat(60));
  console.log('INTERNATIONAL LAYERS (should be rejected):');
  console.log('-'.repeat(60));
  const byCountry: Record<string, number> = {};
  for (const item of categories.INTERNATIONAL) {
    byCountry[item.country] = (byCountry[item.country] || 0) + 1;
  }
  for (const [country, count] of Object.entries(byCountry).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${country.padEnd(25)} ${count}`);
  }

  // Recoverable US layers
  console.log('\n' + '-'.repeat(60));
  console.log('RECOVERABLE US LAYERS:');
  console.log('-'.repeat(60));
  const byCityRecoverable: Record<string, number> = {};
  for (const item of categories.RECOVERABLE_US) {
    const key = `${item.suggestedName}, ${item.suggestedState}`;
    byCityRecoverable[key] = (byCityRecoverable[key] || 0) + 1;
  }
  for (const [city, count] of Object.entries(byCityRecoverable).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${city.padEnd(30)} ${count}`);
  }

  // Sample unknown layers
  console.log('\n' + '-'.repeat(60));
  console.log('SAMPLE UNKNOWN LAYERS (may need manual review):');
  console.log('-'.repeat(60));
  for (const layer of categories.UNKNOWN.slice(0, 15)) {
    console.log(`  ${layer.name}`);
    console.log(`    URL: ${layer.url.slice(0, 80)}...`);
  }

  // Write categorization results
  const outputPath = path.join(__dirname, '../agents/data/unresolved-categorization.json');
  fs.writeFileSync(outputPath, JSON.stringify({
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
    international: categories.INTERNATIONAL.map(i => ({ ...i.layer, country: i.country })),
  }, null, 2));

  console.log(`\n${'='.repeat(80)}`);
  console.log('ACTIONABLE SUMMARY');
  console.log('='.repeat(80));
  console.log(`
  ✓ International layers to reject: ${categories.INTERNATIONAL.length}
  ✓ US layers recoverable via patterns: ${categories.RECOVERABLE_US.length}
  ✓ Generic templates (geocode failed): ${categories.GENERIC_TEMPLATE.length}
  ✗ Unknown (need manual review): ${categories.UNKNOWN.length}

  RECOMMENDED ACTIONS:
  1. Add ${categories.RECOVERABLE_US.length} recoverable layers to resolved set
  2. Mark ${categories.INTERNATIONAL.length} international layers as REJECT
  3. Generic templates may need direct API queries for extent geocoding

  Results written to: ${outputPath}
  `);
}

main().catch(console.error);
