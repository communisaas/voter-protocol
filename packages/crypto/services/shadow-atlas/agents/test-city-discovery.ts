#!/usr/bin/env npx tsx
/**
 * Test Direct City Discovery with sample cities
 *
 * Tests URL pattern generation and discovery logic on 10 sample cities
 * before running full 1,000-city discovery.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

interface CensusPlace {
  readonly fips: string;
  readonly name: string;
  readonly state: string;
  readonly population: number;
  readonly rank: number;
  readonly city_slug: string;
  readonly state_abbr: string;
}

/**
 * Generate GIS server URL patterns for a city
 */
function generateGISServerURLs(place: CensusPlace): string[] {
  const city = place.city_slug;
  const state = place.state_abbr;

  return [
    `https://gis.${city}.${state}.us/arcgis/rest/services`,
    `https://maps.${city}.${state}.us/arcgis/rest/services`,
    `https://gis.${city}.gov/arcgis/rest/services`,
    `https://maps.${city}.gov/arcgis/rest/services`,
    `https://gis.cityof${city}.org/arcgis/rest/services`,
    `https://maps.cityof${city}.org/arcgis/rest/services`,
    `https://${city}gis.org/arcgis/rest/services`,
    `https://${city}maps.org/arcgis/rest/services`,
  ];
}

/**
 * Test URL patterns for a sample city
 */
async function testCityURLs(place: CensusPlace): Promise<void> {
  console.log('\n' + '='.repeat(70));
  console.log(`${place.name}, ${place.state} (pop: ${place.population.toLocaleString()})`);
  console.log('='.repeat(70));

  const urls = generateGISServerURLs(place);

  for (const url of urls) {
    try {
      const response = await fetch(`${url}?f=json`, {
        signal: AbortSignal.timeout(5000),
        headers: { 'User-Agent': 'ShadowAtlas/1.0 (Test)' },
      });

      if (response.ok) {
        const data = await response.json() as Record<string, unknown>;
        const services = Array.isArray(data.services) ? data.services : [];
        const folders = Array.isArray(data.folders) ? data.folders : [];

        console.log(`✓ FOUND: ${url}`);
        console.log(`  Services: ${services.length}`);
        console.log(`  Folders: ${folders.length}`);

        // Check for governance-related services
        const governanceServices = services.filter((s: unknown) =>
          String((s as Record<string, unknown>).name ?? '').toLowerCase().match(/(council|district|ward|boundary)/i)
        );

        if (governanceServices.length > 0) {
          console.log(`  Governance services: ${governanceServices.length}`);
          for (const service of governanceServices.slice(0, 3)) {
            console.log(`    - ${(service as Record<string, unknown>).name}`);
          }
        }

        return; // Found working URL, stop testing
      } else {
        console.log(`✗ ${response.status}: ${url}`);
      }
    } catch (error) {
      console.log(`✗ Timeout/Error: ${url}`);
    }
  }

  console.log('⚠️  No GIS server found for this city');
}

async function main(): Promise<void> {
  const dataDir = join(__dirname, 'data');
  const censusFile = join(dataDir, 'census_top1000_cities_enriched.json');

  const places = JSON.parse(readFileSync(censusFile, 'utf-8')) as CensusPlace[];

  console.log('='.repeat(70));
  console.log('TESTING URL PATTERN GENERATION');
  console.log('='.repeat(70));
  console.log(`Sample size: 10 cities (ranks 1-10, 50-60)`);
  console.log('');

  // Test top 10 cities
  console.log('\nTOP 10 CITIES:');
  for (const place of places.slice(0, 10)) {
    await testCityURLs(place);
  }

  // Test mid-tier cities (ranks 50-60)
  console.log('\n\nMID-TIER CITIES (ranks 50-60):');
  for (const place of places.slice(49, 59)) {
    await testCityURLs(place);
  }

  console.log('\n' + '='.repeat(70));
  console.log('TEST COMPLETE');
  console.log('='.repeat(70));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
