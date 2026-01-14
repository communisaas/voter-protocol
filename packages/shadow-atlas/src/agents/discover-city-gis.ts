#!/usr/bin/env npx tsx
/**
 * Direct City GIS Discovery
 *
 * Phase 2 P2: Systematically discover GIS services for top 1,000 US cities
 * that may not be indexed in ArcGIS Hub.
 *
 * Strategy:
 * 1. Load top 1,000 cities from Census data
 * 2. Generate GIS server URL patterns for each city
 * 3. Test URLs for service availability
 * 4. Enumerate layers from discovered services
 * 5. Filter for council district layers
 * 6. Deduplicate against existing 31,315 classified layers
 *
 * Expected yield: 2,000-3,000 new council districts
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../core/utils/logger.js';

interface CensusPlace {
  readonly fips: string;
  readonly name: string;
  readonly state: string;
  readonly population: number;
  readonly rank: number;
  readonly city_slug: string;
  readonly state_abbr: string;
}

interface LayerInfo {
  readonly service_url: string;
  readonly layer_number: number;
  readonly layer_url: string;
  readonly layer_name: string;
  readonly geometry_type: string | null;
  readonly feature_count: number | null;
  readonly fields: readonly string[];
}

interface DiscoveryResult {
  readonly city: string;
  readonly state: string;
  readonly population: number;
  readonly rank: number;
  readonly gis_server_url: string | null;
  readonly services_found: number;
  readonly layers_found: number;
  readonly council_district_layers: LayerInfo[];
  readonly discovery_timestamp: string;
}

/**
 * Generate GIS server URL patterns for a city
 *
 * Patterns based on analysis of existing 7,194 ArcGIS services:
 * - City subdomain (most common): gis.{city}.{state}.us
 * - Maps subdomain: maps.{city}.{state}.us
 * - City TLD: gis.{city}.gov
 * - CityOf prefix: gis.cityof{city}.org
 */
function generateGISServerURLs(place: CensusPlace): string[] {
  const city = place.city_slug;
  const state = place.state_abbr;

  return [
    // City-hosted with state TLD (most common for mid-tier cities)
    `https://gis.${city}.${state}.us/arcgis/rest/services`,
    `https://maps.${city}.${state}.us/arcgis/rest/services`,

    // City-hosted with .gov TLD (common for larger cities)
    `https://gis.${city}.gov/arcgis/rest/services`,
    `https://maps.${city}.gov/arcgis/rest/services`,

    // CityOf prefix (common naming convention)
    `https://gis.cityof${city}.org/arcgis/rest/services`,
    `https://maps.cityof${city}.org/arcgis/rest/services`,

    // State-agnostic .org TLD
    `https://${city}gis.org/arcgis/rest/services`,
    `https://${city}maps.org/arcgis/rest/services`,

    // Subdomain on city domain
    `https://gis.${city}.us/arcgis/rest/services`,
    `https://maps.${city}.us/arcgis/rest/services`,
  ];
}

/**
 * Check if layer is likely a council district layer
 *
 * Uses structural classification (name + fields) to identify governance layers
 */
function isCouncilDistrictLayer(layer: LayerInfo): boolean {
  const name = layer.layer_name.toLowerCase();
  const fields = layer.fields.map(f => f.toLowerCase());

  // Name-based signals
  const hasCouncilInName = name.includes('council') || name.includes('ward');
  const hasDistrictInName = name.includes('district');

  // Field-based signals
  const hasDistrictField = fields.some(f =>
    f.includes('district') || f.includes('ward') || f.includes('council')
  );
  const hasNameField = fields.some(f =>
    f.includes('name') || f.includes('member') || f.includes('representative')
  );

  // Must be polygon geometry (administrative boundaries)
  const isPolygon = layer.geometry_type === 'esriGeometryPolygon';

  // Positive signals
  if (hasCouncilInName && isPolygon) return true;
  if (hasDistrictInName && hasDistrictField && isPolygon) return true;

  // Negative signals (too generic or wrong type)
  if (name.includes('congressional') || name.includes('state senate')) return false;
  if (!isPolygon) return false;

  return false;
}

/**
 * Fetch service layers from a GIS server
 */
async function fetchServiceLayers(serviceUrl: string): Promise<LayerInfo[]> {
  try {
    const response = await fetch(`${serviceUrl}?f=json`, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'ShadowAtlas/1.0 (Direct City Discovery)' },
    });

    if (!response.ok) return [];

    const data = await response.json() as Record<string, unknown>;

    // Extract layers array
    const layers = Array.isArray(data.layers) ? data.layers as Array<Record<string, unknown>> : [];

    if (layers.length === 0) return [];

    // Fetch all layer details in parallel
    const layerUrls = layers
      .map(layer => {
        const layerNumber = typeof layer.id === 'number' ? layer.id : null;
        return layerNumber !== null ? `${serviceUrl}/${layerNumber}` : null;
      })
      .filter((url): url is string => url !== null);

    const layerInfos = await Promise.all(
      layerUrls.map(url => fetchLayerDetails(url))
    );

    return layerInfos.filter((info): info is LayerInfo => info !== null);

  } catch (error) {
    return [];
  }
}

/**
 * Fetch layer details from a specific layer URL
 */
async function fetchLayerDetails(layerUrl: string): Promise<LayerInfo | null> {
  try {
    const response = await fetch(`${layerUrl}?f=json`, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'ShadowAtlas/1.0' },
    });

    if (!response.ok) return null;

    const data = await response.json() as Record<string, unknown>;

    const match = layerUrl.match(/\/(\d+)$/);
    const layerNumber = match ? parseInt(match[1], 10) : 0;

    // Extract feature count (prefer metadata count over querying)
    const featureCount = typeof data.count === 'number' ? data.count : null;

    return {
      service_url: layerUrl.replace(/\/\d+$/, ''),
      layer_number: layerNumber,
      layer_url: layerUrl,
      layer_name: String(data.name ?? 'Unknown'),
      geometry_type: data.geometryType ? String(data.geometryType) : null,
      feature_count: featureCount,
      fields: Array.isArray(data.fields) ?
        (data.fields as Array<Record<string, unknown>>).map(f => String(f.name ?? '')) : [],
    };
  } catch (error) {
    return null;
  }
}

/**
 * Enumerate folders in a service directory
 */
async function enumerateFolders(baseUrl: string, folders: unknown[]): Promise<Array<{ name: string; type: string }>> {
  const services: Array<{ name: string; type: string }> = [];

  for (const folder of folders) {
    if (typeof folder !== 'string') continue;

    try {
      const folderUrl = `${baseUrl}/${folder}`;
      const response = await fetch(`${folderUrl}?f=json`, {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'ShadowAtlas/1.0' },
      });

      if (!response.ok) continue;

      const data = await response.json() as Record<string, unknown>;

      if (Array.isArray(data.services)) {
        for (const service of data.services as Array<Record<string, unknown>>) {
          services.push({
            name: String(service.name ?? ''),
            type: String(service.type ?? ''),
          });
        }
      }
    } catch (error) {
      // Folder doesn't exist or timed out
      continue;
    }
  }

  return services;
}

/**
 * Discover GIS server for a single city
 */
async function discoverCityGIS(place: CensusPlace): Promise<DiscoveryResult> {
  const urlPatterns = generateGISServerURLs(place);

  // Test each URL pattern
  for (const baseUrl of urlPatterns) {
    try {
      // Check if services directory exists
      const response = await fetch(`${baseUrl}?f=json`, {
        signal: AbortSignal.timeout(5000),
        headers: { 'User-Agent': 'ShadowAtlas/1.0 (Direct City Discovery)' },
      });

      if (!response.ok) continue;

      const data = await response.json() as Record<string, unknown>;

      // Extract services
      const services = [
        ...(Array.isArray(data.services) ? data.services as Array<Record<string, unknown>> : []),
        ...(Array.isArray(data.folders) ? await enumerateFolders(baseUrl, data.folders) : []),
      ];

      if (services.length === 0) continue;

      // Filter for governance-related services (optimization: only enumerate relevant services)
      const governanceServices = services.filter(s =>
        String(s.name ?? '').toLowerCase().match(/(council|district|ward|boundary|governance|election)/i)
      );

      if (governanceServices.length === 0) {
        // No governance services, but server exists - record this for statistics
        return {
          city: place.name,
          state: place.state,
          population: place.population,
          rank: place.rank,
          gis_server_url: baseUrl,
          services_found: services.length,
          layers_found: 0,
          council_district_layers: [],
          discovery_timestamp: new Date().toISOString(),
        };
      }

      // Enumerate layers in governance services
      const layers: LayerInfo[] = [];
      for (const service of governanceServices) {
        const serviceUrl = `${baseUrl}/${service.name}/${service.type}`;
        const serviceLayers = await fetchServiceLayers(serviceUrl);
        layers.push(...serviceLayers);
      }

      // Filter for council district layers
      const councilDistricts = layers.filter(isCouncilDistrictLayer);

      return {
        city: place.name,
        state: place.state,
        population: place.population,
        rank: place.rank,
        gis_server_url: baseUrl,
        services_found: services.length,
        layers_found: layers.length,
        council_district_layers: councilDistricts,
        discovery_timestamp: new Date().toISOString(),
      };

    } catch (error) {
      // URL pattern doesn't exist or timed out, try next one
      continue;
    }
  }

  // No GIS server found for this city
  return {
    city: place.name,
    state: place.state,
    population: place.population,
    rank: place.rank,
    gis_server_url: null,
    services_found: 0,
    layers_found: 0,
    council_district_layers: [],
    discovery_timestamp: new Date().toISOString(),
  };
}

/**
 * Discover GIS servers for all cities with batch processing
 */
async function discoverAllCities(
  places: CensusPlace[],
  batchSize: number = 50
): Promise<DiscoveryResult[]> {
  logger.info('='.repeat(70));
  logger.info('DIRECT CITY GIS DISCOVERY');
  logger.info('='.repeat(70));
  logger.info(`Total cities: ${places.length}`);
  logger.info(`Batch size: ${batchSize}`);
  logger.info('='.repeat(70));
  logger.info('');

  const results: DiscoveryResult[] = [];
  const startTime = Date.now();

  for (let i = 0; i < places.length; i += batchSize) {
    const batch = places.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(places.length / batchSize);

    logger.info(`\nProcessing batch ${batchNum}/${totalBatches} (cities ${i + 1}-${i + batch.length})...`);

    // Process batch in parallel
    const batchResults = await Promise.all(
      batch.map(place => discoverCityGIS(place))
    );

    results.push(...batchResults);

    // Statistics
    const discovered = results.filter(r => r.gis_server_url !== null).length;
    const withCouncilDistricts = results.filter(r => r.council_district_layers.length > 0).length;
    const totalDistricts = results.reduce((sum, r) => sum + r.council_district_layers.length, 0);
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = results.length / elapsed;
    const remaining = places.length - results.length;
    const etaSeconds = remaining / rate;

    logger.info(`Progress: ${results.length}/${places.length} cities (${((results.length / places.length) * 100).toFixed(1)}%)`);
    logger.info(`GIS servers discovered: ${discovered} (${((discovered / results.length) * 100).toFixed(1)}%)`);
    logger.info(`Cities with council districts: ${withCouncilDistricts}`);
    logger.info(`Total council districts found: ${totalDistricts}`);
    logger.info(`Rate: ${rate.toFixed(2)} cities/sec`);
    logger.info(`Elapsed: ${Math.floor(elapsed / 60)}m ${Math.floor(elapsed % 60)}s`);
    logger.info(`ETA: ${Math.floor(etaSeconds / 3600)}h ${Math.floor((etaSeconds % 3600) / 60)}m`);

    // Small delay between batches to be respectful
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return results;
}

/**
 * Deduplicate discovered layers against existing classified layers
 */
function deduplicateDiscoveries(
  existingLayersFile: string,
  discoveries: DiscoveryResult[]
): { unique: LayerInfo[]; duplicates: number } {
  logger.info('\n' + '='.repeat(70));
  logger.info('DEDUPLICATION');
  logger.info('='.repeat(70));

  // Load existing layers
  const content = readFileSync(existingLayersFile, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  const existingLayers = lines.map(line => JSON.parse(line) as Record<string, unknown>);
  const existingUrls = new Set(existingLayers.map(l => String(l.layer_url ?? '')));

  logger.info(`Existing classified layers: ${existingLayers.length}`);

  // Extract all discovered layers
  const allDiscoveredLayers = discoveries.flatMap(d => d.council_district_layers);

  logger.info(`Newly discovered layers: ${allDiscoveredLayers.length}`);

  // Filter for unique layers
  const uniqueLayers = allDiscoveredLayers.filter(layer =>
    !existingUrls.has(layer.layer_url)
  );

  const duplicates = allDiscoveredLayers.length - uniqueLayers.length;

  logger.info(`Unique new layers: ${uniqueLayers.length}`);
  logger.info(`Duplicates removed: ${duplicates}`);
  logger.info('='.repeat(70));

  return { unique: uniqueLayers, duplicates };
}

// Main execution
async function main(): Promise<void> {
  const dataDir = join(__dirname, 'data');

  // Input files
  const censusFile = join(dataDir, 'census_top1000_cities_enriched.json');
  const existingLayersFile = join(dataDir, 'comprehensive_classified_layers.jsonl');

  // Output files
  const discoveryResultsFile = join(dataDir, 'direct_city_discovery_results.jsonl');
  const uniqueLayersFile = join(dataDir, 'unique_new_districts.jsonl');
  const statisticsFile = join(dataDir, 'discovery_statistics.json');

  // Load Census places
  const places = JSON.parse(readFileSync(censusFile, 'utf-8')) as CensusPlace[];

  // Discover GIS servers
  const discoveries = await discoverAllCities(places, 50);

  // Save raw discovery results
  writeFileSync(
    discoveryResultsFile,
    discoveries.map(d => JSON.stringify(d)).join('\n')
  );

  logger.info('\n✓ Discovery results saved');
  logger.info(`Output: ${discoveryResultsFile}`);

  // Deduplicate against existing layers
  const { unique, duplicates } = deduplicateDiscoveries(existingLayersFile, discoveries);

  // Save unique layers
  writeFileSync(
    uniqueLayersFile,
    unique.map(l => JSON.stringify(l)).join('\n')
  );

  logger.info('\n✓ Unique layers saved');
  logger.info(`Output: ${uniqueLayersFile}`);

  // Generate statistics
  const statistics = {
    total_cities_tested: places.length,
    gis_servers_discovered: discoveries.filter(d => d.gis_server_url !== null).length,
    discovery_rate: discoveries.filter(d => d.gis_server_url !== null).length / places.length,
    cities_with_council_districts: discoveries.filter(d => d.council_district_layers.length > 0).length,
    total_layers_discovered: discoveries.reduce((sum, d) => sum + d.council_district_layers.length, 0),
    unique_new_layers: unique.length,
    duplicates_removed: duplicates,
    coverage_improvement: {
      before: existingLayersFile,
      after: unique.length,
      percentage_increase: (unique.length / 31315) * 100,
    },
    timestamp: new Date().toISOString(),
  };

  writeFileSync(statisticsFile, JSON.stringify(statistics, null, 2));

  logger.info('\n✓ Statistics saved');
  logger.info(`Output: ${statisticsFile}`);

  // Final summary
  logger.info('\n' + '='.repeat(70));
  logger.info('DISCOVERY COMPLETE');
  logger.info('='.repeat(70));
  logger.info(`GIS servers discovered: ${statistics.gis_servers_discovered}/${statistics.total_cities_tested} (${(statistics.discovery_rate * 100).toFixed(1)}%)`);
  logger.info(`Cities with council districts: ${statistics.cities_with_council_districts}`);
  logger.info(`Total layers discovered: ${statistics.total_layers_discovered}`);
  logger.info(`Unique new layers: ${statistics.unique_new_layers}`);
  logger.info(`Duplicates removed: ${statistics.duplicates_removed}`);
  logger.info(`Coverage increase: +${statistics.unique_new_layers} layers (+${statistics.coverage_improvement.percentage_increase.toFixed(1)}%)`);
  logger.info('='.repeat(70));
}

// Run
main()
  .then(() => {
    logger.info('\n✓ Direct city discovery complete!');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('\n✗ Fatal error:', error);
    process.exit(1);
  });
