/**
 * Enumerate Governance District Layers from City Servers
 *
 * Discovers all layers from city-specific ArcGIS servers found by
 * discover-city-arcgis-servers.ts, filters for governance districts,
 * and deduplicates against existing 31,315 layers.
 *
 * Expected yield: 2,000-3,000 new governance district layers
 * Runtime: ~30 minutes for 500 servers
 */

import fs from 'fs/promises';
import path from 'path';

// ============================================================================
// TYPES
// ============================================================================

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

interface ArcGISService {
  name: string;
  type: string;
}

interface ArcGISLayer {
  id: number;
  name: string;
  type?: string;
  geometryType?: string;
}

interface LayerMetadata {
  service_url: string;
  layer_number: number;
  layer_url: string;
  layer_name: string;
  geometry_type: string;
  feature_count: number;
  fields: string[];
  city?: string;
  state?: string;
  population?: number;
}

interface EnumerationStats {
  totalServers: number;
  servicesEnumerated: number;
  layersEnumerated: number;
  governanceLayersFound: number;
  newDiscoveries: number;
  duplicatesSkipped: number;
  avgLayersPerServer: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DATA_DIR = path.join(__dirname, 'data');
const SERVERS_PATH = path.join(DATA_DIR, 'city_arcgis_servers.json');
const EXISTING_LAYERS_PATH = path.join(DATA_DIR, 'comprehensive_classified_layers.jsonl');
const OUTPUT_PATH = path.join(DATA_DIR, 'city_discovered_districts.jsonl');

const CONCURRENT_REQUESTS = 50;
const REQUEST_TIMEOUT = 30000; // 30 seconds for layer enumeration
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 2000;

// COMPREHENSIVE governance district keywords (municipal + special districts)
// Aligned with comprehensive-district-classifier.py (20+ district types)
const GOVERNANCE_KEYWORDS = [
  // Municipal governance
  'council', 'ward', 'alderman', 'supervisor', 'commissioner',

  // Electoral representation
  'district', 'representative', 'precinct',

  // Special districts (elected boards)
  'school', 'fire', 'library', 'hospital', 'health',
  'park', 'recreation', 'transit', 'water', 'sewer',

  // Legislative
  'senate', 'house', 'assembly', 'legislative',
  'congressional', 'congress',

  // Board/trustee governance
  'board', 'trustee', 'commission'
];

// ============================================================================
// DEDUPLICATION INDEX
// ============================================================================

/**
 * Build O(1) lookup set from existing 31,315 layers
 */
async function buildExistingLayerIndex(): Promise<Set<string>> {
  const existingUrls = new Set<string>();

  try {
    const content = await fs.readFile(EXISTING_LAYERS_PATH, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());

    for (const line of lines) {
      try {
        const layer = JSON.parse(line);
        if (layer.layer_url) {
          existingUrls.add(layer.layer_url);
        }
      } catch {
        // Skip malformed lines
      }
    }

    console.log(`Loaded ${existingUrls.size} existing layer URLs for deduplication`);
  } catch (error) {
    console.warn('No existing layers file found, skipping deduplication');
  }

  return existingUrls;
}

// ============================================================================
// ARCGIS REST API INTERACTION
// ============================================================================

/**
 * Fetch with retry logic and timeout
 */
async function fetchWithRetry(
  url: string,
  attempts: number = MAX_RETRY_ATTEMPTS
): Promise<Response | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'VOTER-ShadowAtlas-Discovery/1.0'
        },
        // @ts-expect-error - Node.js fetch extension for SSL tolerance
        rejectUnauthorized: false
      });

      clearTimeout(timeoutId);

      if (response.ok) return response;

      // Rate limited or server error - retry after delay
      if (response.status === 429 || response.status >= 500) {
        if (i < attempts - 1) {
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1)));
          continue;
        }
      }

      return null;
    } catch (error) {
      if (i < attempts - 1) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      }
    }
  }

  return null;
}

/**
 * Enumerate all services from an ArcGIS REST endpoint
 */
async function enumerateServices(serverUrl: string): Promise<ArcGISService[]> {
  const response = await fetchWithRetry(`${serverUrl}?f=json`);
  if (!response) return [];

  try {
    const data = await response.json();
    return data.services || [];
  } catch {
    return [];
  }
}

/**
 * Enumerate layers from a specific service
 */
async function enumerateLayers(serviceUrl: string): Promise<ArcGISLayer[]> {
  const response = await fetchWithRetry(`${serviceUrl}?f=json`);
  if (!response) return [];

  try {
    const data = await response.json();
    return data.layers || [];
  } catch {
    return [];
  }
}

/**
 * Fetch detailed metadata for a specific layer
 */
async function fetchLayerMetadata(
  serviceUrl: string,
  layerId: number
): Promise<LayerMetadata | null> {
  const layerUrl = `${serviceUrl}/${layerId}`;
  const response = await fetchWithRetry(`${layerUrl}?f=json`);

  if (!response) return null;

  try {
    const data = await response.json();

    // Must be polygon geometry for districts
    if (data.geometryType !== 'esriGeometryPolygon') {
      return null;
    }

    return {
      service_url: serviceUrl,
      layer_number: layerId,
      layer_url: layerUrl,
      layer_name: data.name || 'Unnamed',
      geometry_type: data.geometryType,
      feature_count: data.count || 0,
      fields: (data.fields || []).map((f: { name: string }) => f.name)
    };
  } catch {
    return null;
  }
}

// ============================================================================
// GOVERNANCE LAYER FILTERING
// ============================================================================

/**
 * Check if layer name suggests a governance district
 */
function isGovernanceLayer(layerName: string): boolean {
  const normalized = layerName.toLowerCase();

  return GOVERNANCE_KEYWORDS.some(keyword => normalized.includes(keyword));
}

// ============================================================================
// LAYER DISCOVERY PIPELINE
// ============================================================================

/**
 * Discover all governance layers from a single city server
 */
async function discoverLayersFromServer(
  server: DiscoveredServer,
  existingUrls: Set<string>
): Promise<LayerMetadata[]> {
  console.log(`[${server.city}, ${server.state}] Enumerating layers from ${server.serverUrl}`);

  const discoveredLayers: LayerMetadata[] = [];

  try {
    // Step 1: Enumerate all services
    const services = await enumerateServices(server.serverUrl);

    if (services.length === 0) {
      console.log(`  ✗ No services found`);
      return [];
    }

    console.log(`  Found ${services.length} services`);

    // Step 2: For each service, enumerate layers
    for (const service of services) {
      const serviceUrl = `${server.serverUrl}/${service.name}/${service.type}`;

      // Skip if not FeatureServer or MapServer
      if (!service.type.includes('Server')) continue;

      const layers = await enumerateLayers(serviceUrl);

      for (const layer of layers) {
        // Filter: Only governance-related layers
        if (!isGovernanceLayer(layer.name)) continue;

        // Fetch detailed metadata
        const metadata = await fetchLayerMetadata(serviceUrl, layer.id);
        if (!metadata) continue;

        // Deduplicate against existing layers
        if (existingUrls.has(metadata.layer_url)) {
          console.log(`  ⊗ Duplicate: ${metadata.layer_name}`);
          continue;
        }

        // Add city context
        metadata.city = server.city;
        metadata.state = server.state;
        metadata.population = server.population;

        discoveredLayers.push(metadata);
        console.log(`  ✓ New discovery: ${metadata.layer_name} (${metadata.feature_count} features)`);
      }
    }
  } catch (error) {
    console.error(`  ✗ Error enumerating server: ${error}`);
  }

  return discoveredLayers;
}

/**
 * Process all servers in parallel batches
 */
async function discoverLayersParallel(
  servers: DiscoveredServer[],
  existingUrls: Set<string>,
  concurrency: number
): Promise<LayerMetadata[]> {
  const allLayers: LayerMetadata[] = [];

  for (let i = 0; i < servers.length; i += concurrency) {
    const batch = servers.slice(i, i + concurrency);

    console.log(`\n[Batch ${Math.floor(i / concurrency) + 1}/${Math.ceil(servers.length / concurrency)}] Processing ${batch.length} servers...`);

    const batchResults = await Promise.all(
      batch.map(server => discoverLayersFromServer(server, existingUrls))
    );

    const flatResults = batchResults.flat();
    allLayers.push(...flatResults);

    console.log(`Batch complete: ${flatResults.length} new layers discovered`);

    // Brief pause between batches
    if (i + concurrency < servers.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return allLayers;
}

// ============================================================================
// STATISTICS & REPORTING
// ============================================================================

function calculateStats(
  servers: DiscoveredServer[],
  layers: LayerMetadata[],
  existingCount: number
): EnumerationStats {
  return {
    totalServers: servers.length,
    servicesEnumerated: servers.length, // Each server has at least one service
    layersEnumerated: layers.length + existingCount,
    governanceLayersFound: layers.length,
    newDiscoveries: layers.length,
    duplicatesSkipped: 0, // Calculated during processing
    avgLayersPerServer: layers.length / servers.length
  };
}

function printStats(stats: EnumerationStats): void {
  console.log('\n' + '='.repeat(80));
  console.log('ENUMERATION STATISTICS');
  console.log('='.repeat(80));
  console.log(`Total servers processed: ${stats.totalServers}`);
  console.log(`Governance layers found: ${stats.governanceLayersFound}`);
  console.log(`New discoveries: ${stats.newDiscoveries}`);
  console.log(`Avg layers per server: ${stats.avgLayersPerServer.toFixed(2)}`);
  console.log('='.repeat(80) + '\n');
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('City Governance District Layer Enumeration');
  console.log('Discovering layers from city-specific ArcGIS servers\n');

  // Load discovered servers
  const serversData = await fs.readFile(SERVERS_PATH, 'utf-8');
  const servers: DiscoveredServer[] = JSON.parse(serversData);

  console.log(`Loaded ${servers.length} city servers`);
  console.log(`Concurrency: ${CONCURRENT_REQUESTS} parallel requests`);
  console.log(`Timeout: ${REQUEST_TIMEOUT}ms per request\n`);

  // Build deduplication index
  const existingUrls = await buildExistingLayerIndex();

  // Discover layers
  const startTime = Date.now();
  const layers = await discoverLayersParallel(servers, existingUrls, CONCURRENT_REQUESTS);
  const elapsedTime = (Date.now() - startTime) / 1000 / 60; // minutes

  // Calculate statistics
  const stats = calculateStats(servers, layers, existingUrls.size);
  printStats(stats);

  console.log(`Total runtime: ${elapsedTime.toFixed(1)} minutes\n`);

  // Save results (JSONL format for compatibility with classification pipeline)
  await fs.mkdir(DATA_DIR, { recursive: true });

  const outputLines = layers.map(layer => JSON.stringify(layer)).join('\n');
  await fs.writeFile(OUTPUT_PATH, outputLines, 'utf-8');

  console.log(`Results saved to: ${OUTPUT_PATH}`);
  console.log(`Next step: Run Python classifier to classify discovered layers\n`);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { discoverLayersFromServer, isGovernanceLayer, buildExistingLayerIndex };
