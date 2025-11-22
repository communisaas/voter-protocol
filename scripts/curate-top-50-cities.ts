#!/usr/bin/env tsx
/**
 * Manual Curation Script - Top 50 US Cities Council Districts
 *
 * PURPOSE: Systematically validate pre-researched council district sources
 *
 * WORKFLOW:
 * 1. Pre-research URLs for each city (ArcGIS, Socrata, municipal GIS)
 * 2. Validate GeoJSON structure and feature count
 * 3. Calculate confidence score
 * 4. Generate registry entries
 *
 * USAGE:
 *   tsx scripts/curate-top-50-cities.ts
 */

import type { FeatureCollection, Geometry } from 'geojson';

interface CitySource {
  readonly fips: string;
  readonly name: string;
  readonly state: string;
  readonly url: string;
  readonly portalType: 'arcgis' | 'socrata' | 'ckan' | 'municipal-gis';
  readonly notes?: string;
}

/**
 * Pre-researched council district sources for top 50 US cities
 *
 * Research methodology:
 * 1. Search "{City} council districts GIS data"
 * 2. Check city open data portal (data.{city}.gov)
 * 3. Search ArcGIS Hub
 * 4. Check state GIS clearinghouse
 * 5. Direct GIS server exploration
 */
const CURATED_SOURCES: CitySource[] = [
  // TIER 1 - Top 20 cities

  // New York, NY - 51 council districts
  {
    fips: '3651000',
    name: 'New York',
    state: 'NY',
    url: 'https://data.cityofnewyork.us/api/geospatial/yusd-j4xi?method=export&format=GeoJSON',
    portalType: 'socrata',
    notes: 'NYC City Council Districts - 51 districts, Socrata API',
  },

  // Los Angeles, CA - 15 council districts
  {
    fips: '0644000',
    name: 'Los Angeles',
    state: 'CA',
    url: 'https://opendata.arcgis.com/datasets/76104f230e384f38871eb3c4782f903d_13.geojson',
    portalType: 'arcgis',
    notes: 'LA City Council Districts - 15 districts, ArcGIS Open Data',
  },

  // Chicago, IL - 50 wards
  {
    fips: '1714000',
    name: 'Chicago',
    state: 'IL',
    url: 'https://data.cityofchicago.org/api/geospatial/sp34-6z76?method=export&format=GeoJSON',
    portalType: 'socrata',
    notes: 'Chicago City Council Wards - 50 wards, Socrata API',
  },

  // Houston, TX - 11 council districts
  {
    fips: '4835000',
    name: 'Houston',
    state: 'TX',
    url: 'https://cohgis-mycity.opendata.arcgis.com/datasets/coh-city-council-districts.geojson',
    portalType: 'arcgis',
    notes: 'Houston City Council Districts - 11 districts, ArcGIS Hub',
  },

  // Phoenix, AZ - 8 council districts
  {
    fips: '0455000',
    name: 'Phoenix',
    state: 'AZ',
    url: 'https://www.phoenixopendata.com/api/geospatial/yv32-fnde?method=export&format=GeoJSON',
    portalType: 'socrata',
    notes: 'Phoenix City Council Districts - 8 districts, Socrata API',
  },

  // Philadelphia, PA - 10 council districts
  {
    fips: '4260000',
    name: 'Philadelphia',
    state: 'PA',
    url: 'https://opendata.arcgis.com/datasets/9298c2f3fa3241fbb176ff1e84d33360_0.geojson',
    portalType: 'arcgis',
    notes: 'Philadelphia City Council Districts - 10 districts, ArcGIS Open Data',
  },

  // San Antonio, TX - 10 council districts
  {
    fips: '4865000',
    name: 'San Antonio',
    state: 'TX',
    url: 'https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/CouncilDistricts/FeatureServer/0/query?where=1=1&outFields=*&f=geojson',
    portalType: 'arcgis',
    notes: 'San Antonio City Council Districts - 10 districts, ArcGIS FeatureServer',
  },

  // San Diego, CA - 9 council districts
  {
    fips: '0666000',
    name: 'San Diego',
    state: 'CA',
    url: 'https://seshat.datasd.org/sde/council_districts_datasd/council_districts_datasd.geojson',
    portalType: 'municipal-gis',
    notes: 'San Diego City Council Districts - 9 districts, City data portal',
  },

  // Dallas, TX - 14 council districts
  {
    fips: '4819000',
    name: 'Dallas',
    state: 'TX',
    url: 'https://services.arcgis.com/JqF1vWXi8fZ8w2Df/arcgis/rest/services/Council_Districts/FeatureServer/0/query?where=1=1&outFields=*&f=geojson',
    portalType: 'arcgis',
    notes: 'Dallas City Council Districts - 14 districts, ArcGIS FeatureServer',
  },

  // San Jose, CA - 10 council districts
  {
    fips: '0668000',
    name: 'San Jose',
    state: 'CA',
    url: 'https://services2.arcgis.com/ZOTjmjTI5x3fDhgu/arcgis/rest/services/Council_District/FeatureServer/0/query?where=1=1&outFields=*&f=geojson',
    portalType: 'arcgis',
    notes: 'San Jose City Council Districts - 10 districts, ArcGIS FeatureServer',
  },

  // Jacksonville, FL - 5 at-large + 14 district seats (19 total, but 14 districts)
  {
    fips: '1235000',
    name: 'Jacksonville',
    state: 'FL',
    url: 'https://services1.arcgis.com/BZIHPcurx7WYzGO9/arcgis/rest/services/City_Council_Districts/FeatureServer/0/query?where=1=1&outFields=*&f=geojson',
    portalType: 'arcgis',
    notes: 'Jacksonville City Council Districts - 14 districts, ArcGIS FeatureServer',
  },

  // Fort Worth, TX - 9 council districts
  {
    fips: '4827000',
    name: 'Fort Worth',
    state: 'TX',
    url: 'https://services.arcgis.com/rXQ5DsS3x6vPGLbH/arcgis/rest/services/City_Council_Districts/FeatureServer/0/query?where=1=1&outFields=*&f=geojson',
    portalType: 'arcgis',
    notes: 'Fort Worth City Council Districts - 9 districts, ArcGIS FeatureServer',
  },

  // Columbus, OH - 4 council districts (at-large city, small districts)
  {
    fips: '3918000',
    name: 'Columbus',
    state: 'OH',
    url: 'https://opendata.columbus.gov/api/geospatial/jvzr-aix5?method=export&format=GeoJSON',
    portalType: 'socrata',
    notes: 'Columbus City Council Districts - 4 districts, Socrata API',
  },

  // Indianapolis, IN - 25 council districts (consolidated city-county)
  {
    fips: '1836003',
    name: 'Indianapolis',
    state: 'IN',
    url: 'https://data.indy.gov/api/geospatial/jega-weah?method=export&format=GeoJSON',
    portalType: 'socrata',
    notes: 'Indianapolis City-County Council Districts - 25 districts, Socrata API',
  },

  // Charlotte, NC - 7 council districts
  {
    fips: '3712000',
    name: 'Charlotte',
    state: 'NC',
    url: 'https://services11.arcgis.com/l17mST0f8rzZbPSN/arcgis/rest/services/City_Council_Districts/FeatureServer/0/query?where=1=1&outFields=*&f=geojson',
    portalType: 'arcgis',
    notes: 'Charlotte City Council Districts - 7 districts, ArcGIS FeatureServer',
  },

  // San Francisco, CA - 11 supervisorial districts
  {
    fips: '0667000',
    name: 'San Francisco',
    state: 'CA',
    url: 'https://data.sfgov.org/api/geospatial/8br2-hhp3?method=export&format=GeoJSON',
    portalType: 'socrata',
    notes: 'SF Supervisorial Districts - 11 districts, Socrata API',
  },

  // Denver, CO - 11 council districts
  {
    fips: '0820000',
    name: 'Denver',
    state: 'CO',
    url: 'https://www.denvergov.org/media/gis/DataCatalog/city_council_districts/shape/city_council_districts.geojson',
    portalType: 'municipal-gis',
    notes: 'Denver City Council Districts - 11 districts, City GIS portal',
  },

  // Washington, DC - 8 wards
  {
    fips: '1150000',
    name: 'Washington',
    state: 'DC',
    url: 'https://opendata.dc.gov/api/geospatial/qdky-dkuu?method=export&format=GeoJSON',
    portalType: 'socrata',
    notes: 'DC Wards - 8 wards, Socrata API',
  },

  // Boston, MA - 9 council districts
  {
    fips: '2507000',
    name: 'Boston',
    state: 'MA',
    url: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston-city-council-districts.geojson',
    portalType: 'arcgis',
    notes: 'Boston City Council Districts - 9 districts, ArcGIS Hub',
  },

  // Nashville, TN - 35 council districts (consolidated metro)
  {
    fips: '4752006',
    name: 'Nashville',
    state: 'TN',
    url: 'https://data.nashville.gov/api/geospatial/33vb-9k5x?method=export&format=GeoJSON',
    portalType: 'socrata',
    notes: 'Nashville Metro Council Districts - 35 districts, Socrata API',
  },

  // TIER 2 - Cities 21-35

  // El Paso, TX - 8 council districts
  {
    fips: '4824000',
    name: 'El Paso',
    state: 'TX',
    url: 'https://gis.elpasotexas.gov/arcgis/rest/services/Public/ElPasoCouncilDistricts/MapServer/0/query?where=1=1&outFields=*&f=geojson',
    portalType: 'arcgis',
    notes: 'El Paso City Council Districts - 8 districts, City GIS server',
  },

  // Detroit, MI - 7 council districts
  {
    fips: '2622000',
    name: 'Detroit',
    state: 'MI',
    url: 'https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/City_Council_Districts/FeatureServer/0/query?where=1=1&outFields=*&f=geojson',
    portalType: 'arcgis',
    notes: 'Detroit City Council Districts - 7 districts, ArcGIS FeatureServer',
  },

  // Memphis, TN - 7 council districts (super districts)
  {
    fips: '4748000',
    name: 'Memphis',
    state: 'TN',
    url: 'https://gisservices.memphisgis.com/arcgis/rest/services/OpenData/Council_Districts/MapServer/0/query?where=1=1&outFields=*&f=geojson',
    portalType: 'arcgis',
    notes: 'Memphis City Council Super Districts - 7 districts, City GIS',
  },

  // Louisville, KY - 26 metro council districts
  {
    fips: '2148006',
    name: 'Louisville',
    state: 'KY',
    url: 'https://data.louisvilleky.gov/api/geospatial/d7mp-qqv7?method=export&format=GeoJSON',
    portalType: 'socrata',
    notes: 'Louisville Metro Council Districts - 26 districts, Socrata API',
  },

  // Baltimore, MD - 14 council districts
  {
    fips: '2404000',
    name: 'Baltimore',
    state: 'MD',
    url: 'https://services1.arcgis.com/UWYHeuuJISiGmgXx/arcgis/rest/services/Council_Districts/FeatureServer/0/query?where=1=1&outFields=*&f=geojson',
    portalType: 'arcgis',
    notes: 'Baltimore City Council Districts - 14 districts, ArcGIS FeatureServer',
  },

  // Milwaukee, WI - 15 aldermanic districts
  {
    fips: '5553000',
    name: 'Milwaukee',
    state: 'WI',
    url: 'https://data.milwaukee.gov/api/geospatial/iiyb-gt46?method=export&format=GeoJSON',
    portalType: 'socrata',
    notes: 'Milwaukee Aldermanic Districts - 15 districts, Socrata API',
  },

  // Albuquerque, NM - 9 council districts
  {
    fips: '3502000',
    name: 'Albuquerque',
    state: 'NM',
    url: 'https://cabq.gov/gis/rest/services/public/CouncilDistricts/MapServer/0/query?where=1=1&outFields=*&f=geojson',
    portalType: 'arcgis',
    notes: 'Albuquerque City Council Districts - 9 districts, City GIS',
  },

  // Tucson, AZ - 6 council wards
  {
    fips: '0477000',
    name: 'Tucson',
    state: 'AZ',
    url: 'https://gis.tucsonaz.gov/arcgis/rest/services/CityServices/MapServer/9/query?where=1=1&outFields=*&f=geojson',
    portalType: 'arcgis',
    notes: 'Tucson City Council Wards - 6 wards, City GIS server',
  },

  // Fresno, CA - 7 council districts
  {
    fips: '0627000',
    name: 'Fresno',
    state: 'CA',
    url: 'https://gisdata.cityoffresno.org/server/rest/services/OpenData/Boundaries/MapServer/0/query?where=1=1&outFields=*&f=geojson',
    portalType: 'arcgis',
    notes: 'Fresno City Council Districts - 7 districts, City GIS',
  },

  // Sacramento, CA - 8 council districts
  {
    fips: '0664000',
    name: 'Sacramento',
    state: 'CA',
    url: 'https://services5.arcgis.com/54falWtcownV47fY/arcgis/rest/services/Council_Districts/FeatureServer/0/query?where=1=1&outFields=*&f=geojson',
    portalType: 'arcgis',
    notes: 'Sacramento City Council Districts - 8 districts, ArcGIS FeatureServer',
  },

  // Mesa, AZ - 6 council districts
  {
    fips: '0446000',
    name: 'Mesa',
    state: 'AZ',
    url: 'https://gismesa.mesaaz.gov/arcgis/rest/services/CityCouncilDistricts/MapServer/0/query?where=1=1&outFields=*&f=geojson',
    portalType: 'arcgis',
    notes: 'Mesa City Council Districts - 6 districts, City GIS',
  },

  // Atlanta, GA - 12 council districts
  {
    fips: '1304000',
    name: 'Atlanta',
    state: 'GA',
    url: 'https://services3.arcgis.com/b0yKxa3u9jKjbBvd/arcgis/rest/services/City_Council_Districts/FeatureServer/0/query?where=1=1&outFields=*&f=geojson',
    portalType: 'arcgis',
    notes: 'Atlanta City Council Districts - 12 districts, ArcGIS FeatureServer',
  },

  // Omaha, NE - 7 council districts
  {
    fips: '3137000',
    name: 'Omaha',
    state: 'NE',
    url: 'https://gis.dogis.org/arcgis/rest/services/OpenData/Omaha_City_Council_Districts/MapServer/0/query?where=1=1&outFields=*&f=geojson',
    portalType: 'arcgis',
    notes: 'Omaha City Council Districts - 7 districts, County GIS',
  },

  // Colorado Springs, CO - 6 council districts (at-large mayor)
  {
    fips: '0816000',
    name: 'Colorado Springs',
    state: 'CO',
    url: 'https://services1.arcgis.com/u6hEGkHc28KiX8Oy/arcgis/rest/services/City_Council_Districts/FeatureServer/0/query?where=1=1&outFields=*&f=geojson',
    portalType: 'arcgis',
    notes: 'Colorado Springs City Council Districts - 6 districts, ArcGIS FeatureServer',
  },

  // TIER 3 - Cities 36-50

  // Miami, FL - 5 commission districts
  {
    fips: '1245000',
    name: 'Miami',
    state: 'FL',
    url: 'https://services.arcgis.com/8Pc9XBTAsYuxx47A/arcgis/rest/services/City_Commission_Districts/FeatureServer/0/query?where=1=1&outFields=*&f=geojson',
    portalType: 'arcgis',
    notes: 'Miami City Commission Districts - 5 districts, ArcGIS FeatureServer',
  },

  // Oakland, CA - 7 council districts
  {
    fips: '0653000',
    name: 'Oakland',
    state: 'CA',
    url: 'https://data.oaklandca.gov/api/geospatial/fqyc-6bm8?method=export&format=GeoJSON',
    portalType: 'socrata',
    notes: 'Oakland City Council Districts - 7 districts, Socrata API',
  },

  // Minneapolis, MN - 13 wards
  {
    fips: '2743000',
    name: 'Minneapolis',
    state: 'MN',
    url: 'http://opendata.minneapolismn.gov/datasets/city-council-wards.geojson',
    portalType: 'arcgis',
    notes: 'Minneapolis City Council Wards - 13 wards, ArcGIS Hub',
  },

  // Tulsa, OK - 9 council districts
  {
    fips: '4075000',
    name: 'Tulsa',
    state: 'OK',
    url: 'https://maps.cityoftulsa.org/arcgis/rest/services/OpenDataPortal/PublicSafety/MapServer/0/query?where=1=1&outFields=*&f=geojson',
    portalType: 'arcgis',
    notes: 'Tulsa City Council Districts - 9 districts, City GIS',
  },

  // Arlington, TX - 5 council districts
  {
    fips: '4803000',
    name: 'Arlington',
    state: 'TX',
    url: 'https://gis.arlingtontx.gov/arcgis/rest/services/OpenData/MapServer/35/query?where=1=1&outFields=*&f=geojson',
    portalType: 'arcgis',
    notes: 'Arlington City Council Districts - 5 districts, City GIS',
  },

  // Tampa, FL - 7 council districts
  {
    fips: '1271000',
    name: 'Tampa',
    state: 'FL',
    url: 'https://services2.arcgis.com/ApTQd8QLScspkK8t/arcgis/rest/services/City_Council_Districts/FeatureServer/0/query?where=1=1&outFields=*&f=geojson',
    portalType: 'arcgis',
    notes: 'Tampa City Council Districts - 7 districts, ArcGIS FeatureServer',
  },

  // New Orleans, LA - 5 council districts
  {
    fips: '2255000',
    name: 'New Orleans',
    state: 'LA',
    url: 'https://data.nola.gov/api/geospatial/58m8-p79g?method=export&format=GeoJSON',
    portalType: 'socrata',
    notes: 'New Orleans City Council Districts - 5 districts, Socrata API',
  },

  // Wichita, KS - 6 council districts
  {
    fips: '2079000',
    name: 'Wichita',
    state: 'KS',
    url: 'https://maps.wichita.gov/arcgis/rest/services/OpenData/Boundaries/MapServer/7/query?where=1=1&outFields=*&f=geojson',
    portalType: 'arcgis',
    notes: 'Wichita City Council Districts - 6 districts, City GIS',
  },

  // Cleveland, OH - 17 wards
  {
    fips: '3916000',
    name: 'Cleveland',
    state: 'OH',
    url: 'http://opendata.cleveland-oh.gov/datasets/council-wards.geojson',
    portalType: 'arcgis',
    notes: 'Cleveland City Council Wards - 17 wards, ArcGIS Hub',
  },
];

/**
 * Calculate confidence score
 */
function calculateConfidence(data: {
  featureCount: number;
  fields: string[];
  layerName?: string;
}): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // Feature count in range (3-25)
  if (data.featureCount >= 3 && data.featureCount <= 25) {
    score += 30;
    reasons.push(`Valid feature count (${data.featureCount})`);
  } else if (data.featureCount > 25 && data.featureCount <= 55) {
    // Some large cities have 50+ wards (Chicago, NYC)
    score += 20;
    reasons.push(`Large city with ${data.featureCount} districts`);
  }

  // Field schema analysis
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

  if (relevantFields.length >= 3) {
    score += 30;
    reasons.push(`Strong field schema (${relevantFields.length} relevant fields)`);
  } else if (relevantFields.length >= 1) {
    score += 20;
    reasons.push(`Medium field schema (${relevantFields.length} relevant fields)`);
  }

  // Polygon geometry (assumed for GeoJSON)
  score += 20;
  reasons.push('Polygon geometry');

  // Name pattern (if provided)
  if (data.layerName) {
    const lower = data.layerName.toLowerCase();
    if (lower.includes('council') && (lower.includes('district') || lower.includes('ward'))) {
      score += 20;
      reasons.push('Strong layer name match');
    }
  }

  return { score, reasons };
}

/**
 * Validate a single source
 */
async function validateSource(source: CitySource): Promise<{
  success: boolean;
  featureCount?: number;
  confidence?: number;
  fields?: string[];
  reasons?: string[];
  error?: string;
}> {
  try {
    console.log(`   Fetching GeoJSON...`);
    const response = await fetch(source.url);

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
    console.log(`   Feature count: ${featureCount}`);

    // Extract fields
    const fields = geojson.features[0]?.properties
      ? Object.keys(geojson.features[0].properties)
      : [];

    console.log(`   Fields: ${fields.slice(0, 5).join(', ')}${fields.length > 5 ? '...' : ''}`);

    // Calculate confidence
    const { score, reasons } = calculateConfidence({
      featureCount,
      fields,
    });

    console.log(`   Confidence: ${score} (${reasons.join(', ')})`);

    if (score < 70) {
      return {
        success: false,
        error: `Confidence score ${score} below minimum (70)`,
        featureCount,
        confidence: score,
        fields,
        reasons,
      };
    }

    return {
      success: true,
      featureCount,
      confidence: score,
      fields,
      reasons,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Generate registry entry
 */
function generateRegistryEntry(
  source: CitySource,
  validation: { featureCount: number; confidence: number; reasons: string[] }
): string {
  const now = new Date().toISOString();

  return `  '${source.fips}': {
    cityFips: '${source.fips}',
    cityName: '${source.name}',
    state: '${source.state}',
    portalType: '${source.portalType}',
    downloadUrl: '${source.url}',
    featureCount: ${validation.featureCount},
    lastVerified: '${now}',
    confidence: ${validation.confidence},
    discoveredBy: 'manual',
    notes: '${source.notes || `${source.name} City Council Districts`}',
  },`;
}

/**
 * Main curation workflow
 */
async function main() {
  console.log('='.repeat(80));
  console.log('MANUAL CURATION - TOP 50 US CITIES COUNCIL DISTRICTS');
  console.log('='.repeat(80));

  const results: Array<{
    source: CitySource;
    validation: Awaited<ReturnType<typeof validateSource>>;
  }> = [];

  for (const source of CURATED_SOURCES) {
    console.log(`\n=== ${source.name}, ${source.state} (FIPS: ${source.fips}) ===`);
    console.log(`   Portal: ${source.portalType}`);

    const validation = await validateSource(source);
    results.push({ source, validation });

    if (validation.success) {
      console.log(`   ✅ VALIDATED`);
    } else {
      console.log(`   ❌ FAILED: ${validation.error}`);
    }

    // Rate limiting (1 request per second)
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('VALIDATION SUMMARY');
  console.log('='.repeat(80));

  const successful = results.filter(r => r.validation.success);
  const failed = results.filter(r => !r.validation.success);

  console.log(`\n✅ Successful: ${successful.length}/${results.length}`);
  console.log(`❌ Failed: ${failed.length}/${results.length}`);

  if (successful.length > 0) {
    console.log('\n' + '='.repeat(80));
    console.log('REGISTRY ENTRIES (ready to add to known-portals.ts)');
    console.log('='.repeat(80));
    console.log('\n');

    for (const result of successful) {
      if (result.validation.success && result.validation.featureCount && result.validation.confidence && result.validation.reasons) {
        console.log(
          generateRegistryEntry(result.source, {
            featureCount: result.validation.featureCount,
            confidence: result.validation.confidence,
            reasons: result.validation.reasons,
          })
        );
      }
    }
  }

  if (failed.length > 0) {
    console.log('\n' + '='.repeat(80));
    console.log('FAILED VALIDATIONS (require URL fixes)');
    console.log('='.repeat(80));
    console.log('\n');

    for (const result of failed) {
      console.log(`// ${result.source.fips}: ${result.source.name}, ${result.source.state}`);
      console.log(`//   Error: ${result.validation.error}`);
      console.log(`//   URL: ${result.source.url}\n`);
    }
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
