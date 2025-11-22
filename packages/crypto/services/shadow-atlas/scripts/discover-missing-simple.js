/**
 * Simple Discovery Script (JavaScript for easier execution)
 *
 * Discovers missing Top 50 cities using known portal patterns
 */

const MISSING_CITIES = [
  { fips: '0608000', name: 'Boston', state: 'MA', expected: 9 },
  { fips: '0820000', name: 'Denver', state: 'CO', expected: 11 },
  { fips: '1235000', name: 'Jacksonville', state: 'FL', expected: 14 },
  { fips: '4824000', name: 'El Paso', state: 'TX', expected: 8 },
  { fips: '0477000', name: 'Tucson', state: 'AZ', expected: 6 },
  { fips: '3502000', name: 'Albuquerque', state: 'NM', expected: 9 },
  { fips: '3240000', name: 'Las Vegas', state: 'NV', expected: 6 },
  { fips: '0627000', name: 'Fresno', state: 'CA', expected: 7 },
  { fips: '0643000', name: 'Long Beach', state: 'CA', expected: 9 },
  { fips: '5182000', name: 'Virginia Beach', state: 'VA', expected: 11 },
  { fips: '2534000', name: 'Milwaukee', state: 'WI', expected: 15 },
  { fips: '4075000', name: 'Tulsa', state: 'OK', expected: 9 },
  { fips: '0662000', name: 'Riverside', state: 'CA', expected: 7 },
  { fips: '3451000', name: 'Newark', state: 'NJ', expected: 5 },
  { fips: '0669000', name: 'Santa Ana', state: 'CA', expected: 6 },
  { fips: '3915000', name: 'Cincinnati', state: 'OH', expected: 9 },
  { fips: '1253000', name: 'Orlando', state: 'FL', expected: 6 },
  { fips: '3728000', name: 'Greensboro', state: 'NC', expected: 5 },
  { fips: '3436000', name: 'Jersey City', state: 'NJ', expected: 6 },
  { fips: '0636770', name: 'Irvine', state: 'CA', expected: null }, // at-large
  { fips: '3755000', name: 'Raleigh', state: 'NC', expected: 5 },
  { fips: '0446000', name: 'Mesa', state: 'AZ', expected: 6 },
];

// Common ArcGIS Hub patterns
const ARCGIS_PATTERNS = [
  (city, state) => `${city.toLowerCase().replace(/\s+/g, '-')} council districts`,
  (city, state) => `${city.toLowerCase().replace(/\s+/g, '-')} ${state} council`,
  (city, state) => `${city.toLowerCase()} ward`,
  (city, state) => `city council districts ${city}`,
];

// Common Socrata domains
const SOCRATA_DOMAINS = [
  (city) => `data.${city.toLowerCase().replace(/\s+/g, '')}.gov`,
  (city) => `${city.toLowerCase().replace(/\s+/g, '')}.data.gov`,
  (city) => `data.${city.toLowerCase().replace(/\s+/g, '-')}.gov`,
  (city) => `opendata.${city.toLowerCase().replace(/\s+/g, '')}.gov`,
];

async function tryArcGISHub(city, state) {
  console.log(`\n🔍 Trying ArcGIS Hub for ${city}, ${state}...`);

  for (const pattern of ARCGIS_PATTERNS) {
    const query = pattern(city, state);
    const url = `https://hub.arcgis.com/api/v3/datasets?q=${encodeURIComponent(query)}&limit=5`;

    try {
      const response = await fetch(url);
      if (!response.ok) continue;

      const data = await response.json();

      if (data.data && data.data.length > 0) {
        console.log(`   ✅ Found ${data.data.length} results for query: "${query}"`);

        for (const dataset of data.data.slice(0, 3)) {
          console.log(`      - ${dataset.attributes.name}`);
          console.log(`        ID: ${dataset.id}`);

          // Try to get download URL
          try {
            const detailUrl = `https://hub.arcgis.com/api/v3/datasets/${dataset.id}`;
            const detailResp = await fetch(detailUrl);
            if (detailResp.ok) {
              const detail = await detailResp.json();
              const serviceUrl = detail.data.attributes.serviceUrl || detail.data.attributes.url;
              if (serviceUrl) {
                const downloadUrl = `${serviceUrl}/0/query?where=1%3D1&outFields=*&f=geojson`;
                console.log(`        Download: ${downloadUrl}`);

                // Quick validation - try to fetch feature count
                try {
                  const testUrl = downloadUrl.replace('where=1%3D1', 'where=1%3D1&returnCountOnly=true');
                  const countResp = await fetch(testUrl);
                  if (countResp.ok) {
                    const countData = await countResp.json();
                    if (countData.count) {
                      console.log(`        Features: ${countData.count}`);
                    }
                  }
                } catch {}
              }
            }
          } catch {}
        }

        return true; // Found something
      }
    } catch (err) {
      console.log(`   ⚠️  Error: ${err.message}`);
    }
  }

  return false;
}

async function trySocrata(city, state) {
  console.log(`\n🔍 Trying Socrata for ${city}, ${state}...`);

  for (const domainFn of SOCRATA_DOMAINS) {
    const domain = domainFn(city);
    const url = `https://${domain}/api/catalog/v1?q=council districts&only=datasets&limit=5`;

    try {
      const response = await fetch(url);
      if (!response.ok) continue;

      const data = await response.json();

      if (data.results && data.results.length > 0) {
        console.log(`   ✅ Found ${data.results.length} results on ${domain}`);

        for (const result of data.results.slice(0, 3)) {
          const resource = result.resource;
          console.log(`      - ${resource.name}`);

          // Find GeoJSON distribution
          const geojsonDist = resource.distribution?.find(d =>
            d.mediaType?.includes('geo+json') || d.downloadURL?.includes('geojson')
          );

          if (geojsonDist) {
            console.log(`        Download: ${geojsonDist.downloadURL}`);
          } else {
            // Construct default Socrata GeoJSON URL
            const fallbackUrl = `https://${domain}/resource/${resource.id}.geojson`;
            console.log(`        Download (fallback): ${fallbackUrl}`);
          }
        }

        return true;
      }
    } catch (err) {
      // Silent fail - domain doesn't exist
    }
  }

  return false;
}

async function discoverCity(cityInfo) {
  if (cityInfo.expected === null) {
    console.log(`\n⏭️  Skipping ${cityInfo.name}, ${cityInfo.state} (at-large)`);
    return null;
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📍 ${cityInfo.name}, ${cityInfo.state} (FIPS ${cityInfo.fips})`);
  console.log(`   Expected: ${cityInfo.expected} districts`);

  let found = false;

  // Try ArcGIS Hub first
  found = await tryArcGISHub(cityInfo.name, cityInfo.state);

  // Try Socrata if ArcGIS failed
  if (!found) {
    found = await trySocrata(cityInfo.name, cityInfo.state);
  }

  if (!found) {
    console.log(`\n   ❌ No results found for ${cityInfo.name}, ${cityInfo.state}`);
  }

  // Small delay to avoid rate limiting
  await new Promise(resolve => setTimeout(resolve, 1500));

  return found;
}

async function main() {
  console.log('🚀 SIMPLE TOP 50 DISCOVERY');
  console.log('==========================\n');
  console.log(`Attempting to discover ${MISSING_CITIES.filter(c => c.expected !== null).length} cities...\n`);

  const results = [];

  for (const city of MISSING_CITIES) {
    const found = await discoverCity(city);
    results.push({ city, found });
  }

  console.log('\n\n📊 SUMMARY');
  console.log('==========\n');

  const successful = results.filter(r => r.found).length;
  const failed = results.filter(r => !r.found).length;
  const skipped = MISSING_CITIES.filter(c => c.expected === null).length;

  console.log(`✅ Found data: ${successful}`);
  console.log(`❌ No data: ${failed}`);
  console.log(`⏭️  Skipped (at-large): ${skipped}`);
  console.log(`\n📈 Success rate: ${Math.round((successful / (successful + failed)) * 100)}%`);
}

main().catch(console.error);
