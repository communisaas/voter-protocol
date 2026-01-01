/**
 * Canonical GEOID Reference Lists
 *
 * Authoritative GEOID lists for TIGER/Line boundary validation.
 * Enables detection of specific missing boundaries (e.g., "Alabama CD-07 missing")
 * rather than just count mismatches (e.g., "6/7 districts found").
 *
 * DATA SOURCE: Census Bureau TIGER/Line 2024 shapefiles
 * GEOID FORMAT SPECIFICATIONS:
 * - Congressional Districts (CD): 4 digits SSDD (State FIPS + District number)
 * - State Legislative Upper (SLDU): 5 digits SSDDD (State FIPS + District)
 * - State Legislative Lower (SLDL): 5 digits SSDDD (State FIPS + District)
 * - County: 5 digits SSCCC (State FIPS + County FIPS)
 *
 * MAINTENANCE:
 * - Congressional Districts: Update after each decennial census redistricting
 * - State Legislative: Update when states redistrict (varies by state)
 * - Counties: Rare changes (last: Broomfield County, CO added 2001)
 *
 * Last Updated: 2025-12-31
 * Data Vintage: 2024 TIGER/Line (post-2020 Census redistricting)
 */

import type { TIGERLayerType } from '../core/types.js';
import { EXPECTED_CD_BY_STATE, EXPECTED_SLDU_BY_STATE, EXPECTED_SLDL_BY_STATE } from './tiger-expected-counts.js';

/**
 * Canonical Congressional District GEOIDs by State
 *
 * FORMAT: SSDD (State FIPS + 2-digit district number)
 * - State FIPS: 2 digits (01-56)
 * - District: 2 digits (01-52 for regular districts, 00 for at-large)
 *
 * AT-LARGE STATES (district 00):
 * - Alaska (02), Delaware (10), North Dakota (38), South Dakota (46), Vermont (50), Wyoming (56)
 * - Territories: American Samoa (60), Guam (66), N. Mariana Islands (69), Puerto Rico (72), Virgin Islands (78)
 *
 * SPECIAL CASES:
 * - DC (11): Non-voting delegate, uses district 98
 * - California (06): Largest delegation with 52 districts (0601-0652)
 * - Territories use 00 for their single delegate
 *
 * SOURCE: 118th Congress apportionment (2023-2025), based on 2020 Census
 */
export const CANONICAL_CD_GEOIDS: Record<string, readonly string[]> = {
  '01': ['0101', '0102', '0103', '0104', '0105', '0106', '0107'] as const, // Alabama (7)
  '02': ['0200'] as const, // Alaska (at-large)
  '04': ['0401', '0402', '0403', '0404', '0405', '0406', '0407', '0408', '0409'] as const, // Arizona (9)
  '05': ['0501', '0502', '0503', '0504'] as const, // Arkansas (4)
  '06': [ // California (52 - largest delegation)
    '0601', '0602', '0603', '0604', '0605', '0606', '0607', '0608', '0609', '0610',
    '0611', '0612', '0613', '0614', '0615', '0616', '0617', '0618', '0619', '0620',
    '0621', '0622', '0623', '0624', '0625', '0626', '0627', '0628', '0629', '0630',
    '0631', '0632', '0633', '0634', '0635', '0636', '0637', '0638', '0639', '0640',
    '0641', '0642', '0643', '0644', '0645', '0646', '0647', '0648', '0649', '0650',
    '0651', '0652',
  ] as const,
  '08': ['0801', '0802', '0803', '0804', '0805', '0806', '0807', '0808'] as const, // Colorado (8)
  '09': ['0901', '0902', '0903', '0904', '0905'] as const, // Connecticut (5)
  '10': ['1000'] as const, // Delaware (at-large)
  '11': ['1198'] as const, // DC (non-voting delegate, uses 98)
  '12': [ // Florida (28)
    '1201', '1202', '1203', '1204', '1205', '1206', '1207', '1208', '1209', '1210',
    '1211', '1212', '1213', '1214', '1215', '1216', '1217', '1218', '1219', '1220',
    '1221', '1222', '1223', '1224', '1225', '1226', '1227', '1228',
  ] as const,
  '13': [ // Georgia (14)
    '1301', '1302', '1303', '1304', '1305', '1306', '1307', '1308', '1309', '1310',
    '1311', '1312', '1313', '1314',
  ] as const,
  '15': ['1501', '1502'] as const, // Hawaii (2)
  '16': ['1601', '1602'] as const, // Idaho (2)
  '17': [ // Illinois (17)
    '1701', '1702', '1703', '1704', '1705', '1706', '1707', '1708', '1709', '1710',
    '1711', '1712', '1713', '1714', '1715', '1716', '1717',
  ] as const,
  '18': ['1801', '1802', '1803', '1804', '1805', '1806', '1807', '1808', '1809'] as const, // Indiana (9)
  '19': ['1901', '1902', '1903', '1904'] as const, // Iowa (4)
  '20': ['2001', '2002', '2003', '2004'] as const, // Kansas (4)
  '21': ['2101', '2102', '2103', '2104', '2105', '2106'] as const, // Kentucky (6)
  '22': ['2201', '2202', '2203', '2204', '2205', '2206'] as const, // Louisiana (6)
  '23': ['2301', '2302'] as const, // Maine (2)
  '24': ['2401', '2402', '2403', '2404', '2405', '2406', '2407', '2408'] as const, // Maryland (8)
  '25': ['2501', '2502', '2503', '2504', '2505', '2506', '2507', '2508', '2509'] as const, // Massachusetts (9)
  '26': [ // Michigan (13)
    '2601', '2602', '2603', '2604', '2605', '2606', '2607', '2608', '2609', '2610',
    '2611', '2612', '2613',
  ] as const,
  '27': ['2701', '2702', '2703', '2704', '2705', '2706', '2707', '2708'] as const, // Minnesota (8)
  '28': ['2801', '2802', '2803', '2804'] as const, // Mississippi (4)
  '29': ['2901', '2902', '2903', '2904', '2905', '2906', '2907', '2908'] as const, // Missouri (8)
  '30': ['3001', '3002'] as const, // Montana (2)
  '31': ['3101', '3102', '3103'] as const, // Nebraska (3)
  '32': ['3201', '3202', '3203', '3204'] as const, // Nevada (4)
  '33': ['3301', '3302'] as const, // New Hampshire (2)
  '34': [ // New Jersey (12)
    '3401', '3402', '3403', '3404', '3405', '3406', '3407', '3408', '3409', '3410',
    '3411', '3412',
  ] as const,
  '35': ['3501', '3502', '3503'] as const, // New Mexico (3)
  '36': [ // New York (26)
    '3601', '3602', '3603', '3604', '3605', '3606', '3607', '3608', '3609', '3610',
    '3611', '3612', '3613', '3614', '3615', '3616', '3617', '3618', '3619', '3620',
    '3621', '3622', '3623', '3624', '3625', '3626',
  ] as const,
  '37': [ // North Carolina (14)
    '3701', '3702', '3703', '3704', '3705', '3706', '3707', '3708', '3709', '3710',
    '3711', '3712', '3713', '3714',
  ] as const,
  '38': ['3800'] as const, // North Dakota (at-large)
  '39': [ // Ohio (15)
    '3901', '3902', '3903', '3904', '3905', '3906', '3907', '3908', '3909', '3910',
    '3911', '3912', '3913', '3914', '3915',
  ] as const,
  '40': ['4001', '4002', '4003', '4004', '4005'] as const, // Oklahoma (5)
  '41': ['4101', '4102', '4103', '4104', '4105', '4106'] as const, // Oregon (6)
  '42': [ // Pennsylvania (17)
    '4201', '4202', '4203', '4204', '4205', '4206', '4207', '4208', '4209', '4210',
    '4211', '4212', '4213', '4214', '4215', '4216', '4217',
  ] as const,
  '44': ['4401', '4402'] as const, // Rhode Island (2)
  '45': ['4501', '4502', '4503', '4504', '4505', '4506', '4507'] as const, // South Carolina (7)
  '46': ['4600'] as const, // South Dakota (at-large)
  '47': ['4701', '4702', '4703', '4704', '4705', '4706', '4707', '4708', '4709'] as const, // Tennessee (9)
  '48': [ // Texas (38)
    '4801', '4802', '4803', '4804', '4805', '4806', '4807', '4808', '4809', '4810',
    '4811', '4812', '4813', '4814', '4815', '4816', '4817', '4818', '4819', '4820',
    '4821', '4822', '4823', '4824', '4825', '4826', '4827', '4828', '4829', '4830',
    '4831', '4832', '4833', '4834', '4835', '4836', '4837', '4838',
  ] as const,
  '49': ['4901', '4902', '4903', '4904'] as const, // Utah (4)
  '50': ['5000'] as const, // Vermont (at-large)
  '51': [ // Virginia (11)
    '5101', '5102', '5103', '5104', '5105', '5106', '5107', '5108', '5109', '5110',
    '5111',
  ] as const,
  '53': ['5301', '5302', '5303', '5304', '5305', '5306', '5307', '5308', '5309', '5310'] as const, // Washington (10)
  '54': ['5401', '5402'] as const, // West Virginia (2)
  '55': ['5501', '5502', '5503', '5504', '5505', '5506', '5507', '5508'] as const, // Wisconsin (8)
  '56': ['5600'] as const, // Wyoming (at-large)

  // Territories (non-voting delegates)
  '60': ['6000'] as const, // American Samoa (delegate)
  '66': ['6600'] as const, // Guam (delegate)
  '69': ['6900'] as const, // Northern Mariana Islands (delegate)
  '72': ['7200'] as const, // Puerto Rico (resident commissioner)
  '78': ['7800'] as const, // US Virgin Islands (delegate)
} as const;

/**
 * Canonical State Legislative Upper (State Senate) GEOIDs by State
 *
 * FORMAT: SSDDD (State FIPS + 3-digit district number)
 * - State FIPS: 2 digits (01-56)
 * - District: 3 digits (001-999)
 *
 * SPECIAL CASES:
 * - Nebraska (31): Unicameral legislature, uses SLDU only (49 districts)
 * - DC (11): No bicameral legislature (unicameral council)
 *
 * NOTE: Placeholder implementation - requires manual enumeration of all districts
 * per state. Total expected: ~1,972 state senate districts nationally.
 *
 * TODO: Generate from TIGER/Line SLDU shapefiles for each state
 */
export const CANONICAL_SLDU_GEOIDS: Record<string, readonly string[]> = {
  // Placeholder: Alabama Senate (35 districts)
  // '01': ['01001', '01002', ..., '01035'] as const,

  // TODO: Enumerate all 50 states + DC + territories
  // This requires extracting from TIGER/Line SLDU shapefiles
  // Example command: ogr2ogr -f GeoJSON -select GEOID20 /dev/stdout tl_2024_01_sldu.shp | jq -r '.features[].properties.GEOID20'
} as const;

/**
 * Canonical State Legislative Lower (State House) GEOIDs by State
 *
 * FORMAT: SSDDD (State FIPS + 3-digit district number)
 * - State FIPS: 2 digits (01-56)
 * - District: 3 digits (001-999)
 *
 * SPECIAL CASES:
 * - Nebraska (31): Unicameral legislature, no lower house (0 districts)
 * - DC (11): No bicameral legislature
 * - New Hampshire (33): Largest state house in US (400 districts)
 *
 * NOTE: Placeholder implementation - requires manual enumeration of all districts
 * per state. Total expected: ~5,411 state house districts nationally.
 *
 * TODO: Generate from TIGER/Line SLDL shapefiles for each state
 */
export const CANONICAL_SLDL_GEOIDS: Record<string, readonly string[]> = {
  // Placeholder: Alabama House (105 districts)
  // '01': ['01001', '01002', ..., '01105'] as const,

  // TODO: Enumerate all 50 states + DC + territories
  // This requires extracting from TIGER/Line SLDL shapefiles
} as const;

/**
 * Get canonical GEOID list for a layer and state
 *
 * @param layer - TIGER layer type (cd, sldu, sldl)
 * @param stateFips - Two-digit state FIPS code
 * @returns Readonly array of canonical GEOIDs, or null if not available
 */
export function getCanonicalGEOIDs(
  layer: TIGERLayerType,
  stateFips: string
): readonly string[] | null {
  switch (layer) {
    case 'cd':
      return CANONICAL_CD_GEOIDS[stateFips] ?? null;
    case 'sldu':
      return CANONICAL_SLDU_GEOIDS[stateFips] ?? null;
    case 'sldl':
      return CANONICAL_SLDL_GEOIDS[stateFips] ?? null;
    default:
      return null; // Layer not supported yet (county, place, etc.)
  }
}

/**
 * Find missing GEOIDs (expected but not present in actual data)
 *
 * @param layer - TIGER layer type
 * @param stateFips - Two-digit state FIPS code
 * @param actualGEOIDs - Array of GEOIDs from downloaded TIGER data
 * @returns Array of missing GEOIDs (empty if none missing)
 */
export function getMissingGEOIDs(
  layer: TIGERLayerType,
  stateFips: string,
  actualGEOIDs: readonly string[]
): readonly string[] {
  const canonical = getCanonicalGEOIDs(layer, stateFips);
  if (!canonical) return [];

  const actualSet = new Set(actualGEOIDs);
  return canonical.filter(geoid => !actualSet.has(geoid));
}

/**
 * Find extra GEOIDs (present in data but not expected)
 *
 * Extra GEOIDs may indicate:
 * - Duplicate features in TIGER data
 * - Placeholder districts (ZZ, 00, 98, 99)
 * - Data corruption or processing errors
 *
 * @param layer - TIGER layer type
 * @param stateFips - Two-digit state FIPS code
 * @param actualGEOIDs - Array of GEOIDs from downloaded TIGER data
 * @returns Array of extra GEOIDs (empty if none extra)
 */
export function getExtraGEOIDs(
  layer: TIGERLayerType,
  stateFips: string,
  actualGEOIDs: readonly string[]
): readonly string[] {
  const canonical = getCanonicalGEOIDs(layer, stateFips);
  if (!canonical) return [];

  const canonicalSet = new Set(canonical);
  return actualGEOIDs.filter(geoid => !canonicalSet.has(geoid));
}

/**
 * Validate GEOID list completeness
 *
 * Checks both missing and extra GEOIDs to detect data quality issues.
 *
 * @param layer - TIGER layer type
 * @param stateFips - Two-digit state FIPS code
 * @param actualGEOIDs - Array of GEOIDs from downloaded TIGER data
 * @returns Validation result with missing/extra GEOIDs
 */
export function validateGEOIDCompleteness(
  layer: TIGERLayerType,
  stateFips: string,
  actualGEOIDs: readonly string[]
): {
  readonly valid: boolean;
  readonly missing: readonly string[];
  readonly extra: readonly string[];
  readonly expected: number;
  readonly actual: number;
} {
  const canonical = getCanonicalGEOIDs(layer, stateFips);

  if (!canonical) {
    // No canonical list available, can't validate
    return {
      valid: true,
      missing: [],
      extra: [],
      expected: 0,
      actual: actualGEOIDs.length,
    };
  }

  const missing = getMissingGEOIDs(layer, stateFips, actualGEOIDs);
  const extra = getExtraGEOIDs(layer, stateFips, actualGEOIDs);

  return {
    valid: missing.length === 0 && extra.length === 0,
    missing,
    extra,
    expected: canonical.length,
    actual: actualGEOIDs.length,
  };
}

/**
 * Self-validation: Ensure canonical GEOID counts match expected counts
 *
 * This validation runs at module load time to catch data entry errors
 * in the canonical GEOID lists.
 *
 * @returns Validation result with any discrepancies found
 */
export function validateCanonicalCounts(): {
  readonly valid: boolean;
  readonly errors: readonly string[];
} {
  const errors: string[] = [];

  // Validate Congressional Districts
  for (const [stateFips, geoids] of Object.entries(CANONICAL_CD_GEOIDS)) {
    const expectedCount = EXPECTED_CD_BY_STATE[stateFips];
    if (expectedCount === undefined) {
      errors.push(`CD: Unknown state FIPS ${stateFips} in canonical GEOIDs`);
      continue;
    }

    if (geoids.length !== expectedCount) {
      errors.push(
        `CD: State ${stateFips} has ${geoids.length} canonical GEOIDs but expected ${expectedCount}`
      );
    }
  }

  // Validate State Legislative Upper (when implemented)
  for (const [stateFips, geoids] of Object.entries(CANONICAL_SLDU_GEOIDS)) {
    const expectedCount = EXPECTED_SLDU_BY_STATE[stateFips];
    if (expectedCount === undefined) {
      errors.push(`SLDU: Unknown state FIPS ${stateFips} in canonical GEOIDs`);
      continue;
    }

    if (geoids.length !== expectedCount) {
      errors.push(
        `SLDU: State ${stateFips} has ${geoids.length} canonical GEOIDs but expected ${expectedCount}`
      );
    }
  }

  // Validate State Legislative Lower (when implemented)
  for (const [stateFips, geoids] of Object.entries(CANONICAL_SLDL_GEOIDS)) {
    const expectedCount = EXPECTED_SLDL_BY_STATE[stateFips];
    if (expectedCount === undefined) {
      errors.push(`SLDL: Unknown state FIPS ${stateFips} in canonical GEOIDs`);
      continue;
    }

    if (geoids.length !== expectedCount) {
      errors.push(
        `SLDL: State ${stateFips} has ${geoids.length} canonical GEOIDs but expected ${expectedCount}`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// Self-validate canonical counts at module load time
const validation = validateCanonicalCounts();
if (!validation.valid) {
  console.error('❌ Canonical GEOID validation failed:');
  for (const error of validation.errors) {
    console.error(`  - ${error}`);
  }
  throw new Error('Canonical GEOID counts do not match expected counts');
}
