/**
 * City-Specific ArcGIS Server Discovery
 *
 * Directly targets top 1,000 US cities to discover municipal GIS servers.
 * Uses empirically-derived URL patterns from 31,315 existing layers.
 *
 * Strategy: Try 18 common URL patterns per city with parallel requests,
 * DNS caching, and SSL tolerance for municipal servers.
 *
 * Expected yield: 400-600 valid city servers (40-60% hit rate)
 * Runtime: ~50 minutes for 1,000 cities
 */

import fs from 'fs/promises';
import path from 'path';

// ============================================================================
// TYPES
// ============================================================================

interface CityTarget {
  fips: string;
  name: string;
  state: string;
  population: number;
  rank: number;
}

interface DiscoveredServer {
  city: string;
  state: string;
  population: number;
  rank: number;
  serverUrl: string;
  responseTime: number;
  pattern: string;
  timestamp: string;
}

interface DiscoveryStats {
  totalCities: number;
  validServers: number;
  failedCities: number;
  hitRate: number;
  avgResponseTime: number;
  patternDistribution: Record<string, number>;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DATA_DIR = path.join(__dirname, 'data');
const CITY_LIST_PATH = path.join(__dirname, '../data/us-cities-top-1000.json');
const OUTPUT_PATH = path.join(DATA_DIR, 'city_arcgis_servers.json');

const CONCURRENT_REQUESTS = 50;
const REQUEST_TIMEOUT = 10000; // 10 seconds per pattern
const RETRY_DELAY = 1000; // 1 second between retries

// DNS cache to skip failed lookups faster
const dnsCache = new Map<string, boolean>();

// ============================================================================
// URL PATTERN GENERATION
// ============================================================================

/**
 * Normalize city name to URL slug
 * Handles edge cases: "St. Louis" → "stlouis" and "st-louis"
 * "Washington, D.C." → "dc" and "washingtondc"
 */
function generateCitySlugs(cityName: string): string[] {
  const slugs: string[] = [];

  // Base normalization
  let base = cityName
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\s+/g, '');

  // Add base version
  slugs.push(base);

  // Add hyphenated version if multi-word
  if (cityName.includes(' ')) {
    const hyphenated = cityName
      .toLowerCase()
      .replace(/[.,]/g, '')
      .replace(/\s+/g, '-');
    slugs.push(hyphenated);
  }

  // Special cases
  if (cityName.includes('St.') || cityName.includes('St ')) {
    const saint = base.replace('st', 'saint');
    slugs.push(saint);
  }

  if (cityName.toLowerCase().includes('washington') && cityName.toLowerCase().includes('d')) {
    slugs.push('dc');
    slugs.push('washingtondc');
  }

  return [...new Set(slugs)]; // Deduplicate
}

/**
 * Generate all URL patterns for a city based on empirical data from existing layers
 *
 * Patterns derived from analysis of 31,315 layers showing:
 * - Most common: gis.{city}.gov/arcgis/rest/services
 * - Variants: /server/rest/services, /arcgisserver/rest/services, etc.
 */
function generateUrlPatterns(cityName: string, state: string): string[] {
  const patterns: string[] = [];
  const slugs = generateCitySlugs(cityName);
  const stateSlug = state.toLowerCase();

  for (const slug of slugs) {
    // Pattern 1: gis.{city}.gov with various path variants
    patterns.push(`https://gis.${slug}.gov/arcgis/rest/services`);
    patterns.push(`https://gis.${slug}.gov/server/rest/services`);
    patterns.push(`https://gis.${slug}.gov/arcgisserver/rest/services`);
    patterns.push(`https://gis.${slug}.gov/public/rest/services`);

    // Pattern 2: maps.{city}.gov
    patterns.push(`https://maps.${slug}.gov/arcgis/rest/services`);
    patterns.push(`https://maps.${slug}.gov/server/rest/services`);

    // Pattern 3: data.{city}.gov
    patterns.push(`https://data.${slug}.gov/arcgis/rest/services`);

    // Pattern 4: gis.cityof{city}.{state} (common pattern)
    patterns.push(`https://gis.cityof${slug}.org/arcgis/rest/services`);
    patterns.push(`https://gis.cityof${slug}.org/server/rest/services`);
    patterns.push(`https://gis.cityof${slug}.gov/arcgis/rest/services`);

    // Pattern 5: gis.{city}{state}.gov (state-specific domains)
    patterns.push(`https://gis.${slug}${stateSlug}.gov/arcgis/rest/services`);

    // Pattern 6: {city}.maps.arcgis.com (ArcGIS Online - often redirects but worth trying)
    patterns.push(`https://${slug}.maps.arcgis.com/sharing/rest/content`);

    // Pattern 7: Alternative TLDs (.us, .net, .org)
    patterns.push(`https://gis.${slug}.us/arcgis/rest/services`);
    patterns.push(`https://gis.${slug}.net/arcgis/rest/services`);
    patterns.push(`https://gis.${slug}.org/arcgis/rest/services`);

    // Pattern 8: gis.{city}city.us (Bakersfield pattern)
    patterns.push(`https://gis.${slug}city.us/arcgis/rest/services`);
    patterns.push(`https://gis.${slug}city.us/webmaps/rest/services`);
  }

  return [...new Set(patterns)]; // Deduplicate
}

// ============================================================================
// SERVER VALIDATION
// ============================================================================

/**
 * Check if URL is a valid ArcGIS REST services endpoint
 * Validates JSON response structure without downloading full service list
 */
async function validateArcGISServer(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const response = await fetch(url + '?f=json', {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'VOTER-ShadowAtlas-Discovery/1.0'
      },
      // Tolerate self-signed SSL certs on municipal servers
      // @ts-expect-error - Node.js fetch extension
      rejectUnauthorized: false
    });

    clearTimeout(timeoutId);

    if (!response.ok) return false;

    const data = await response.json();

    // Valid ArcGIS REST response must have these fields
    return (
      data &&
      (data.currentVersion !== undefined || data.services !== undefined || data.folders !== undefined)
    );
  } catch (error) {
    // DNS failure, timeout, or network error
    return false;
  }
}

/**
 * Discover ArcGIS server for a single city by trying all patterns
 */
async function discoverCityServer(city: CityTarget): Promise<DiscoveredServer | null> {
  const patterns = generateUrlPatterns(city.name, city.state);

  console.log(`[${city.rank}/${city.name}, ${city.state}] Trying ${patterns.length} patterns...`);

  for (const pattern of patterns) {
    // Check DNS cache first
    const domain = new URL(pattern).hostname;
    if (dnsCache.has(domain) && !dnsCache.get(domain)) {
      continue; // Skip known DNS failures
    }

    const startTime = Date.now();
    const isValid = await validateArcGISServer(pattern);
    const responseTime = Date.now() - startTime;

    if (isValid) {
      console.log(`✓ Found server: ${pattern} (${responseTime}ms)`);
      dnsCache.set(domain, true);

      return {
        city: city.name,
        state: city.state,
        population: city.population,
        rank: city.rank,
        serverUrl: pattern,
        responseTime,
        pattern: pattern.replace(`https://${domain}`, ''),
        timestamp: new Date().toISOString()
      };
    } else {
      // Cache DNS failure
      if (responseTime < 100) {
        dnsCache.set(domain, false);
      }
    }
  }

  console.log(`✗ No server found for ${city.name}, ${city.state}`);
  return null;
}

// ============================================================================
// PARALLEL DISCOVERY WITH RATE LIMITING
// ============================================================================

/**
 * Process cities in parallel batches with concurrency control
 */
async function discoverServersParallel(
  cities: CityTarget[],
  concurrency: number
): Promise<DiscoveredServer[]> {
  const results: DiscoveredServer[] = [];

  for (let i = 0; i < cities.length; i += concurrency) {
    const batch = cities.slice(i, i + concurrency);

    console.log(`\n[Batch ${Math.floor(i / concurrency) + 1}/${Math.ceil(cities.length / concurrency)}] Processing ${batch.length} cities...`);

    const batchResults = await Promise.all(
      batch.map(city => discoverCityServer(city))
    );

    const validResults = batchResults.filter((r): r is DiscoveredServer => r !== null);
    results.push(...validResults);

    // Brief pause between batches to be respectful to servers
    if (i + concurrency < cities.length) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    }
  }

  return results;
}

// ============================================================================
// STATISTICS & REPORTING
// ============================================================================

function calculateStats(
  cities: CityTarget[],
  servers: DiscoveredServer[]
): DiscoveryStats {
  const patternDistribution: Record<string, number> = {};

  for (const server of servers) {
    const pattern = server.pattern;
    patternDistribution[pattern] = (patternDistribution[pattern] || 0) + 1;
  }

  const avgResponseTime = servers.length > 0
    ? servers.reduce((sum, s) => sum + s.responseTime, 0) / servers.length
    : 0;

  return {
    totalCities: cities.length,
    validServers: servers.length,
    failedCities: cities.length - servers.length,
    hitRate: (servers.length / cities.length) * 100,
    avgResponseTime,
    patternDistribution
  };
}

function printStats(stats: DiscoveryStats): void {
  console.log('\n' + '='.repeat(80));
  console.log('DISCOVERY STATISTICS');
  console.log('='.repeat(80));
  console.log(`Total cities scanned: ${stats.totalCities}`);
  console.log(`Valid servers found: ${stats.validServers}`);
  console.log(`Failed discoveries: ${stats.failedCities}`);
  console.log(`Hit rate: ${stats.hitRate.toFixed(2)}%`);
  console.log(`Avg response time: ${stats.avgResponseTime.toFixed(0)}ms`);
  console.log('\nPattern distribution:');

  const sortedPatterns = Object.entries(stats.patternDistribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10); // Top 10 patterns

  for (const [pattern, count] of sortedPatterns) {
    console.log(`  ${count.toString().padStart(4)} - ${pattern}`);
  }

  console.log('='.repeat(80) + '\n');
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('City-Specific ArcGIS Server Discovery');
  console.log('Target: Top 1,000 US cities by population\n');

  // Load city list
  const citiesData = await fs.readFile(CITY_LIST_PATH, 'utf-8');
  const cities: CityTarget[] = JSON.parse(citiesData);

  console.log(`Loaded ${cities.length} cities`);
  console.log(`Concurrency: ${CONCURRENT_REQUESTS} parallel requests`);
  console.log(`Timeout: ${REQUEST_TIMEOUT}ms per pattern\n`);

  // Discover servers
  const startTime = Date.now();
  const servers = await discoverServersParallel(cities, CONCURRENT_REQUESTS);
  const elapsedTime = (Date.now() - startTime) / 1000 / 60; // minutes

  // Calculate statistics
  const stats = calculateStats(cities, servers);
  printStats(stats);

  console.log(`Total runtime: ${elapsedTime.toFixed(1)} minutes\n`);

  // Save results
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(
    OUTPUT_PATH,
    JSON.stringify(servers, null, 2),
    'utf-8'
  );

  console.log(`Results saved to: ${OUTPUT_PATH}`);
  console.log(`Next step: Run enumerate-city-district-layers.ts to discover governance districts\n`);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { discoverCityServer, generateUrlPatterns, generateCitySlugs };
