import fs from 'fs/promises';
import path from 'path';

interface CityTarget { fips: string; name: string; state: string; population: number; rank: number; }
interface DiscoveredServer { city: string; state: string; population: number; rank: number; serverUrl: string; responseTime: number; pattern: string; timestamp: string; }

const DATA_DIR = path.join(__dirname, 'data');
const CITY_LIST_PATH = path.join(DATA_DIR, 'test_cities_top10.json');
const OUTPUT_PATH = path.join(DATA_DIR, 'test_city_arcgis_servers.json');
const REQUEST_TIMEOUT = 10000;

function generateUrlPatterns(cityName: string, state: string): string[] {
  const patterns: string[] = [];
  const slug = cityName.toLowerCase().replace(/[.,\s]/g, '');
  patterns.push(`https://gis.${slug}.gov/arcgis/rest/services`);
  patterns.push(`https://maps.${slug}.gov/arcgis/rest/services`);
  return patterns;
}

async function validateArcGISServer(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    const response = await fetch(url + '?f=json', { signal: controller.signal, headers: { 'Accept': 'application/json', 'User-Agent': 'VOTER-ShadowAtlas-Test/1.0' } });
    clearTimeout(timeoutId);
    if (!response.ok) return false;
    const data = await response.json();
    return data && (data.currentVersion !== undefined || data.services !== undefined);
  } catch {
    return false;
  }
}

async function discoverCityServer(city: CityTarget): Promise<DiscoveredServer | null> {
  const patterns = generateUrlPatterns(city.name, city.state);
  console.log(`[${city.rank}. ${city.name}, ${city.state}] Trying ${patterns.length} patterns...`);
  for (const pattern of patterns) {
    const startTime = Date.now();
    const isValid = await validateArcGISServer(pattern);
    const responseTime = Date.now() - startTime;
    if (isValid) {
      console.log(`✓ Found: ${pattern}`);
      const domain = new URL(pattern).hostname;
      return { city: city.name, state: city.state, population: city.population, rank: city.rank, serverUrl: pattern, responseTime, pattern: pattern.replace(`https://${domain}`, ''), timestamp: new Date().toISOString() };
    }
  }
  console.log(`✗ Not found: ${city.name}`);
  return null;
}

async function main() {
  console.log('TEST: City ArcGIS Server Discovery (Top 10)\n');
  const citiesData = await fs.readFile(CITY_LIST_PATH, 'utf-8');
  const cities: CityTarget[] = JSON.parse(citiesData);
  const servers: DiscoveredServer[] = [];
  for (const city of cities) {
    const result = await discoverCityServer(city);
    if (result) servers.push(result);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  console.log(`\n✓ Found ${servers.length}/${cities.length} servers\n`);
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(servers, null, 2), 'utf-8');
  console.log(`Saved to: ${OUTPUT_PATH}\n`);
}

main().catch(console.error);
