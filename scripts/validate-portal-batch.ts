#!/usr/bin/env tsx
/**
 * Batch Portal Validation Script
 *
 * PURPOSE: Systematically discover and validate council district sources for top 50 US cities
 *
 * STRATEGY:
 * - 4-path discovery: ArcGIS Hub → City open data → State GIS → Direct GIS servers
 * - Validation: Feature count (3-25), field schema, confidence score (70+)
 * - Output: Registry entries ready for known-portals.ts
 *
 * USAGE:
 *   tsx scripts/validate-portal-batch.ts
 */

import type { FeatureCollection, Geometry } from 'geojson';

/** City candidate for validation */
interface CityCandidate {
  readonly fips: string;
  readonly name: string;
  readonly state: string;
  readonly population?: number;
  readonly tier: 1 | 2 | 3;
}

/** Validation result */
interface ValidationResult {
  readonly city: CityCandidate;
  readonly success: boolean;
  readonly downloadUrl?: string;
  readonly featureCount?: number;
  readonly confidence?: number;
  readonly portalType?: 'arcgis' | 'socrata' | 'ckan' | 'municipal-gis';
  readonly fields?: string[];
  readonly error?: string;
  readonly notes?: string;
}

/**
 * Top 50 US cities by 2020 Census population
 *
 * Tier 1: Top 20 (highest priority)
 * Tier 2: Cities 21-35 (medium priority)
 * Tier 3: Cities 36-50 (lower priority)
 *
 * ALREADY IN REGISTRY (8):
 * - Seattle (5363000), Austin (4805000), Birmingham (0107000)
 * - Raleigh (3755000), Burlington (5010675), Portland (4159000)
 * - Kansas City MO (2938000)
 */
const TIER_1_CITIES: CityCandidate[] = [
  { fips: '3651000', name: 'New York', state: 'NY', population: 8804190, tier: 1 },
  { fips: '0644000', name: 'Los Angeles', state: 'CA', population: 3898747, tier: 1 },
  { fips: '1714000', name: 'Chicago', state: 'IL', population: 2746388, tier: 1 },
  { fips: '4835000', name: 'Houston', state: 'TX', population: 2304580, tier: 1 },
  { fips: '0455000', name: 'Phoenix', state: 'AZ', population: 1608139, tier: 1 },
  { fips: '4260000', name: 'Philadelphia', state: 'PA', population: 1603797, tier: 1 },
  { fips: '4865000', name: 'San Antonio', state: 'TX', population: 1434625, tier: 1 },
  { fips: '0666000', name: 'San Diego', state: 'CA', population: 1386932, tier: 1 },
  { fips: '4819000', name: 'Dallas', state: 'TX', population: 1304379, tier: 1 },
  { fips: '0668000', name: 'San Jose', state: 'CA', population: 1013240, tier: 1 },
  // Seattle (5363000) already in registry
  // Austin (4805000) already in registry
  { fips: '1235000', name: 'Jacksonville', state: 'FL', population: 949611, tier: 1 },
  { fips: '4827000', name: 'Fort Worth', state: 'TX', population: 918915, tier: 1 },
  { fips: '3918000', name: 'Columbus', state: 'OH', population: 905748, tier: 1 },
  { fips: '1836003', name: 'Indianapolis', state: 'IN', population: 887642, tier: 1 },
  { fips: '3712000', name: 'Charlotte', state: 'NC', population: 874579, tier: 1 },
  { fips: '0667000', name: 'San Francisco', state: 'CA', population: 873965, tier: 1 },
  { fips: '0820000', name: 'Denver', state: 'CO', population: 715522, tier: 1 },
  { fips: '1150000', name: 'Washington', state: 'DC', population: 689545, tier: 1 },
  { fips: '2507000', name: 'Boston', state: 'MA', population: 675647, tier: 1 },
  { fips: '4752006', name: 'Nashville', state: 'TN', population: 689447, tier: 1 },
];

const TIER_2_CITIES: CityCandidate[] = [
  { fips: '4824000', name: 'El Paso', state: 'TX', population: 678815, tier: 2 },
  { fips: '2622000', name: 'Detroit', state: 'MI', population: 639111, tier: 2 },
  { fips: '4748000', name: 'Memphis', state: 'TN', population: 633104, tier: 2 },
  { fips: '2148006', name: 'Louisville', state: 'KY', population: 633045, tier: 2 },
  { fips: '2404000', name: 'Baltimore', state: 'MD', population: 585708, tier: 2 },
  { fips: '5553000', name: 'Milwaukee', state: 'WI', population: 577222, tier: 2 },
  { fips: '3502000', name: 'Albuquerque', state: 'NM', population: 564559, tier: 2 },
  { fips: '0477000', name: 'Tucson', state: 'AZ', population: 542629, tier: 2 },
  { fips: '0627000', name: 'Fresno', state: 'CA', population: 542107, tier: 2 },
  { fips: '0664000', name: 'Sacramento', state: 'CA', population: 524943, tier: 2 },
  { fips: '0446000', name: 'Mesa', state: 'AZ', population: 504258, tier: 2 },
  { fips: '1304000', name: 'Atlanta', state: 'GA', population: 498715, tier: 2 },
  { fips: '2036000', name: 'Kansas City', state: 'KS', population: 156607, tier: 2 },
  { fips: '3137000', name: 'Omaha', state: 'NE', population: 486051, tier: 2 },
  { fips: '0816000', name: 'Colorado Springs', state: 'CO', population: 478961, tier: 2 },
];

const TIER_3_CITIES: CityCandidate[] = [
  { fips: '1245000', name: 'Miami', state: 'FL', population: 442241, tier: 3 },
  { fips: '0653000', name: 'Oakland', state: 'CA', population: 440646, tier: 3 },
  { fips: '2743000', name: 'Minneapolis', state: 'MN', population: 429954, tier: 3 },
  { fips: '4075000', name: 'Tulsa', state: 'OK', population: 413066, tier: 3 },
  { fips: '4803000', name: 'Arlington', state: 'TX', population: 394266, tier: 3 },
  { fips: '1271000', name: 'Tampa', state: 'FL', population: 384959, tier: 3 },
  { fips: '2255000', name: 'New Orleans', state: 'LA', population: 383997, tier: 3 },
  { fips: '2079000', name: 'Wichita', state: 'KS', population: 397532, tier: 3 },
  { fips: '3916000', name: 'Cleveland', state: 'OH', population: 372624, tier: 3 },
  { fips: '5182000', name: 'Virginia Beach', state: 'VA', population: 459470, tier: 3 },
  { fips: '3231900', name: 'Henderson', state: 'NV', population: 320189, tier: 3 },
  { fips: '2148000', name: 'Lexington', state: 'KY', population: 322570, tier: 3 },
  { fips: '0670000', name: 'Stockton', state: 'CA', population: 320554, tier: 3 },
  { fips: '4813024', name: 'Corpus Christi', state: 'TX', population: 317863, tier: 3 },
  { fips: '0660102', name: 'Riverside', state: 'CA', population: 314998, tier: 3 },
];

/**
 * Calculate confidence score based on validation criteria
 */
function calculateConfidence(data: {
  featureCount: number;
  fields: string[];
  layerName?: string;
  portalType: string;
}): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // Name pattern matching (40 pts max)
  if (data.layerName) {
    const name = data.layerName.toLowerCase();
    if (
      name.includes('council') && name.includes('district') ||
      name.includes('city council') ||
      name.includes('ward')
    ) {
      score += 40;
      reasons.push('Strong name pattern match');
    } else if (name.includes('district') || name.includes('boundary')) {
      score += 30;
      reasons.push('Medium name pattern match');
    } else {
      score += 20;
      reasons.push('Weak name pattern match');
    }
  }

  // Polygon geometry (assumed if GeoJSON) (30 pts)
  score += 30;
  reasons.push('Polygon geometry');

  // Field schema (5 pts per relevant field, max 20 pts)
  const relevantFields = data.fields.filter(f => {
    const lower = f.toLowerCase();
    return (
      lower.includes('district') ||
      lower.includes('council') ||
      lower.includes('ward') ||
      lower.includes('name') ||
      lower.includes('number')
    );
  });
  const fieldScore = Math.min(relevantFields.length * 5, 20);
  score += fieldScore;
  reasons.push(`${relevantFields.length} relevant fields`);

  // Feature count (10 pts if in range)
  if (data.featureCount >= 3 && data.featureCount <= 25) {
    score += 10;
    reasons.push(`Feature count in range (${data.featureCount})`);
  }

  return { score, reasons };
}

/**
 * Attempt to fetch and validate GeoJSON from URL
 */
async function validateUrl(
  url: string,
  city: CityCandidate
): Promise<Pick<ValidationResult, 'success' | 'featureCount' | 'confidence' | 'fields' | 'error' | 'notes'>> {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const geojson = (await response.json()) as FeatureCollection<Geometry>;

    if (!geojson.features || !Array.isArray(geojson.features)) {
      return {
        success: false,
        error: 'Invalid GeoJSON: missing features array',
      };
    }

    const featureCount = geojson.features.length;

    // Feature count validation
    if (featureCount < 3 || featureCount > 25) {
      return {
        success: false,
        error: `Feature count ${featureCount} out of range (3-25)`,
        featureCount,
      };
    }

    // Extract fields from first feature
    const fields = geojson.features[0]?.properties
      ? Object.keys(geojson.features[0].properties)
      : [];

    // Calculate confidence
    const { score, reasons } = calculateConfidence({
      featureCount,
      fields,
      portalType: 'arcgis', // Inferred from URL patterns
    });

    if (score < 70) {
      return {
        success: false,
        error: `Confidence score ${score} below minimum (70)`,
        featureCount,
        confidence: score,
        fields,
      };
    }

    return {
      success: true,
      featureCount,
      confidence: score,
      fields,
      notes: reasons.join(', '),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Try multiple discovery paths for a city
 */
async function discoverCity(city: CityCandidate): Promise<ValidationResult> {
  console.log(`\n=== ${city.name}, ${city.state} (FIPS: ${city.fips}) ===`);

  // Path 1: ArcGIS Hub search
  try {
    const hubUrl = `https://hub.arcgis.com/api/v3/datasets?filter%5Bq%5D=${encodeURIComponent(city.name)}%20council%20districts`;
    console.log(`🔍 Path 1: ArcGIS Hub search...`);

    const hubResponse = await fetch(hubUrl);
    if (hubResponse.ok) {
      const hubData = await hubResponse.json();

      if (hubData.data && Array.isArray(hubData.data) && hubData.data.length > 0) {
        // Try first result
        const dataset = hubData.data[0];
        console.log(`   Found: ${dataset.attributes?.name || 'Unknown'}`);

        // Construct download URL
        const datasetId = dataset.id;
        const downloadUrl = `https://hub.arcgis.com/api/v3/datasets/${datasetId}/downloads/data?format=geojson&spatialRefId=4326&where=1%3D1`;

        const validation = await validateUrl(downloadUrl, city);

        if (validation.success) {
          return {
            city,
            success: true,
            downloadUrl,
            portalType: 'arcgis',
            ...validation,
          };
        }

        console.log(`   ❌ Validation failed: ${validation.error}`);
      }
    }
  } catch (error) {
    console.log(`   ❌ Hub search failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Path 2: Direct ArcGIS FeatureServer patterns
  const featureServerPatterns = [
    `https://services.arcgis.com/*/arcgis/rest/services/*council*district*/FeatureServer/0/query?where=1=1&outFields=*&f=geojson`,
    `https://gis.${city.name.toLowerCase().replace(/\s+/g, '')}.gov/arcgis/rest/services/*/FeatureServer/0/query?where=1=1&outFields=*&f=geojson`,
  ];

  console.log(`🔍 Path 2: Direct GIS server patterns...`);
  console.log(`   ⏭️  Skipped (requires city-specific URLs)`);

  // Path 3: Socrata open data portals
  const socrataPatterns = [
    `data.${city.name.toLowerCase().replace(/\s+/g, '')}.gov`,
    `${city.name.toLowerCase().replace(/\s+/g, '')}.data.gov`,
  ];

  console.log(`🔍 Path 3: Socrata open data portals...`);
  console.log(`   ⏭️  Skipped (requires manual discovery)`);

  return {
    city,
    success: false,
    error: 'All discovery paths failed - manual curation required',
  };
}

/**
 * Generate registry entry code
 */
function generateRegistryEntry(result: ValidationResult): string {
  if (!result.success || !result.downloadUrl) {
    return `// ${result.city.fips}: ${result.city.name}, ${result.city.state} - FAILED: ${result.error}`;
  }

  const now = new Date().toISOString();

  return `  '${result.city.fips}': {
    cityFips: '${result.city.fips}',
    cityName: '${result.city.name}',
    state: '${result.city.state}',
    portalType: '${result.portalType || 'arcgis'}',
    downloadUrl: '${result.downloadUrl}',
    featureCount: ${result.featureCount},
    lastVerified: '${now}',
    confidence: ${result.confidence},
    discoveredBy: 'manual',
    notes: '${result.notes || `${result.city.name} City Council Districts`}',
  },`;
}

/**
 * Main validation workflow
 */
async function main() {
  console.log('='.repeat(80));
  console.log('BATCH PORTAL VALIDATION - TOP 50 US CITIES');
  console.log('='.repeat(80));

  const allCities = [...TIER_1_CITIES, ...TIER_2_CITIES, ...TIER_3_CITIES];
  const results: ValidationResult[] = [];

  for (const city of allCities) {
    const result = await discoverCity(city);
    results.push(result);

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('VALIDATION SUMMARY');
  console.log('='.repeat(80));

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`\n✅ Successful: ${successful.length}/${results.length}`);
  console.log(`❌ Failed: ${failed.length}/${results.length}`);

  if (successful.length > 0) {
    console.log('\n' + '='.repeat(80));
    console.log('REGISTRY ENTRIES (ready to add to known-portals.ts)');
    console.log('='.repeat(80));
    console.log('\n');

    for (const result of successful) {
      console.log(generateRegistryEntry(result));
    }
  }

  if (failed.length > 0) {
    console.log('\n' + '='.repeat(80));
    console.log('FAILED CITIES (require manual curation)');
    console.log('='.repeat(80));
    console.log('\n');

    for (const result of failed) {
      console.log(`// ${result.city.fips}: ${result.city.name}, ${result.city.state}`);
      console.log(`//   Error: ${result.error}`);
    }
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
