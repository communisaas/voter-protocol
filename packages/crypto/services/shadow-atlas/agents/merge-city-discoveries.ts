/**
 * Merge City Discoveries into Master Dataset
 *
 * Validates, classifies (via Python), deduplicates, and merges newly
 * discovered city governance districts into comprehensive_classified_layers.jsonl
 *
 * Generates statistics on coverage improvement and discovery yield.
 */

import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';

// ============================================================================
// TYPES
// ============================================================================

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
  district_type?: string;
  tier?: string;
  governance_level?: string;
  elected?: boolean;
  confidence?: number;
  score?: number;
  classification_reasons?: string[];
}

interface DiscoveredServer {
  city: string;
  state: string;
  population: number;
  rank: number;
}

interface MergeStats {
  existingLayers: number;
  newDiscoveries: number;
  duplicatesRemoved: number;
  totalLayersAfterMerge: number;
  cityCouncilBefore: number;
  cityCouncilAfter: number;
  cityCouncilAdded: number;
  topCitiesCovered: number;
  coverageImprovement: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DATA_DIR = path.join(__dirname, 'data');
const CITY_DISCOVERIES_PATH = path.join(DATA_DIR, 'city_discovered_districts.jsonl');
const EXISTING_LAYERS_PATH = path.join(DATA_DIR, 'comprehensive_classified_layers.jsonl');
const CLASSIFIED_DISCOVERIES_PATH = path.join(DATA_DIR, 'city_discovered_districts_classified.jsonl');
const MERGED_OUTPUT_PATH = path.join(DATA_DIR, 'comprehensive_classified_layers_v2.jsonl');
const CITY_SERVERS_PATH = path.join(DATA_DIR, 'city_arcgis_servers.json');
const CITY_LIST_PATH = path.join(__dirname, '../data/us-cities-top-1000.json');

const PYTHON_CLASSIFIER = path.join(__dirname, 'comprehensive-district-classifier.py');

// ============================================================================
// CLASSIFICATION INTEGRATION
// ============================================================================

/**
 * Run Python classifier on discovered layers
 * Reuses existing comprehensive-district-classifier.py
 */
async function classifyDiscoveries(): Promise<void> {
  console.log('Running Python classifier on discovered layers...');

  try {
    // Check if discoveries file exists
    await fs.access(CITY_DISCOVERIES_PATH);

    // Run Python classifier
    const command = `python3 "${PYTHON_CLASSIFIER}" "${CITY_DISCOVERIES_PATH}" "${CLASSIFIED_DISCOVERIES_PATH}"`;

    execSync(command, {
      stdio: 'inherit',
      maxBuffer: 100 * 1024 * 1024 // 100MB buffer for large outputs
    });

    console.log('✓ Classification complete\n');
  } catch (error) {
    console.error('✗ Classification failed:', error);
    throw error;
  }
}

// ============================================================================
// DEDUPLICATION & MERGING
// ============================================================================

/**
 * Load layers from JSONL file
 */
async function loadLayersFromJSONL(filePath: string): Promise<LayerMetadata[]> {
  const layers: LayerMetadata[] = [];

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());

    for (const line of lines) {
      try {
        const layer = JSON.parse(line);
        layers.push(layer);
      } catch {
        // Skip malformed lines
      }
    }
  } catch (error) {
    console.warn(`Could not load ${filePath}:`, error);
    return [];
  }

  return layers;
}

/**
 * Deduplicate layers by URL (keep first occurrence)
 */
function deduplicateLayers(layers: LayerMetadata[]): LayerMetadata[] {
  const seen = new Set<string>();
  const unique: LayerMetadata[] = [];

  for (const layer of layers) {
    if (!seen.has(layer.layer_url)) {
      seen.add(layer.layer_url);
      unique.push(layer);
    }
  }

  return unique;
}

/**
 * Filter layers by minimum quality criteria
 */
function filterHighQualityLayers(layers: LayerMetadata[]): LayerMetadata[] {
  return layers.filter(layer => {
    // Must be classified as governance district
    if (!layer.district_type || layer.district_type === 'non_polygon' || layer.district_type === 'non_governance') {
      return false;
    }

    // Must have minimum quality tier (BRONZE or higher)
    if (!layer.tier || layer.tier === 'REJECT') {
      return false;
    }

    // Must have reasonable feature count
    if (layer.feature_count === 0) {
      return false;
    }

    return true;
  });
}

/**
 * Merge new discoveries into existing dataset
 */
async function mergeLayers(
  existingLayers: LayerMetadata[],
  newDiscoveries: LayerMetadata[]
): Promise<LayerMetadata[]> {
  console.log('Merging layers...');

  // Combine all layers
  const combined = [...existingLayers, ...newDiscoveries];

  // Deduplicate (existing layers win on duplicates)
  const deduplicated = deduplicateLayers(combined);

  console.log(`✓ Merged ${existingLayers.length} existing + ${newDiscoveries.length} new = ${deduplicated.length} total`);
  console.log(`✓ Removed ${combined.length - deduplicated.length} duplicates\n`);

  return deduplicated;
}

// ============================================================================
// COVERAGE ANALYSIS
// ============================================================================

/**
 * Calculate city coverage from discovered servers
 */
async function calculateCityCoverage(
  mergedLayers: LayerMetadata[]
): Promise<{ topCitiesCovered: number; coverageImprovement: number }> {
  // Load city list
  const cityListData = await fs.readFile(CITY_LIST_PATH, 'utf-8');
  const cities = JSON.parse(cityListData);

  // Load discovered servers
  let discoveredServers: DiscoveredServer[] = [];
  try {
    const serversData = await fs.readFile(CITY_SERVERS_PATH, 'utf-8');
    discoveredServers = JSON.parse(serversData);
  } catch {
    // No servers file yet
  }

  const citiesWithServers = new Set(
    discoveredServers.map(s => `${s.city}|${s.state}`)
  );

  const topCitiesCovered = Array.from(citiesWithServers).length;
  const coverageImprovement = (topCitiesCovered / cities.length) * 100;

  return {
    topCitiesCovered,
    coverageImprovement
  };
}

/**
 * Count layers by district type
 */
function countByDistrictType(layers: LayerMetadata[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const layer of layers) {
    const type = layer.district_type || 'unknown';
    counts[type] = (counts[type] || 0) + 1;
  }

  return counts;
}

// ============================================================================
// STATISTICS & REPORTING
// ============================================================================

async function calculateMergeStats(
  existingLayers: LayerMetadata[],
  newDiscoveries: LayerMetadata[],
  mergedLayers: LayerMetadata[]
): Promise<MergeStats> {
  const existingCounts = countByDistrictType(existingLayers);
  const mergedCounts = countByDistrictType(mergedLayers);

  const cityCouncilBefore = existingCounts['city_council'] || 0;
  const cityCouncilAfter = mergedCounts['city_council'] || 0;

  const coverage = await calculateCityCoverage(mergedLayers);

  return {
    existingLayers: existingLayers.length,
    newDiscoveries: newDiscoveries.length,
    duplicatesRemoved: existingLayers.length + newDiscoveries.length - mergedLayers.length,
    totalLayersAfterMerge: mergedLayers.length,
    cityCouncilBefore,
    cityCouncilAfter,
    cityCouncilAdded: cityCouncilAfter - cityCouncilBefore,
    topCitiesCovered: coverage.topCitiesCovered,
    coverageImprovement: coverage.coverageImprovement
  };
}

function printMergeStats(stats: MergeStats): void {
  console.log('\n' + '='.repeat(80));
  console.log('MERGE STATISTICS');
  console.log('='.repeat(80));
  console.log(`Existing layers: ${stats.existingLayers.toLocaleString()}`);
  console.log(`New discoveries: ${stats.newDiscoveries.toLocaleString()}`);
  console.log(`Duplicates removed: ${stats.duplicatesRemoved.toLocaleString()}`);
  console.log(`Total layers after merge: ${stats.totalLayersAfterMerge.toLocaleString()}`);
  console.log();
  console.log('City Council Districts:');
  console.log(`  Before: ${stats.cityCouncilBefore.toLocaleString()}`);
  console.log(`  After:  ${stats.cityCouncilAfter.toLocaleString()}`);
  console.log(`  Added:  ${stats.cityCouncilAdded.toLocaleString()} (+${((stats.cityCouncilAdded / stats.cityCouncilBefore) * 100).toFixed(1)}%)`);
  console.log();
  console.log('City Coverage:');
  console.log(`  Top cities with GIS servers: ${stats.topCitiesCovered}`);
  console.log(`  Coverage of top 1000: ${stats.coverageImprovement.toFixed(1)}%`);
  console.log('='.repeat(80) + '\n');
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('City Discovery Merge & Validation');
  console.log('Integrating newly discovered layers into master dataset\n');

  // Step 1: Classify discovered layers
  await classifyDiscoveries();

  // Step 2: Load existing and classified discoveries
  console.log('Loading datasets...');
  const existingLayers = await loadLayersFromJSONL(EXISTING_LAYERS_PATH);
  const rawDiscoveries = await loadLayersFromJSONL(CLASSIFIED_DISCOVERIES_PATH);

  console.log(`✓ Loaded ${existingLayers.length} existing layers`);
  console.log(`✓ Loaded ${rawDiscoveries.length} classified discoveries\n`);

  // Step 3: Filter high-quality discoveries
  console.log('Filtering high-quality governance districts...');
  const qualityDiscoveries = filterHighQualityLayers(rawDiscoveries);
  console.log(`✓ ${qualityDiscoveries.length} high-quality layers (rejected ${rawDiscoveries.length - qualityDiscoveries.length} low-quality)\n`);

  // Step 4: Merge and deduplicate
  const mergedLayers = await mergeLayers(existingLayers, qualityDiscoveries);

  // Step 5: Calculate statistics
  const stats = await calculateMergeStats(existingLayers, qualityDiscoveries, mergedLayers);
  printMergeStats(stats);

  // Step 6: Save merged dataset
  console.log('Saving merged dataset...');
  const outputLines = mergedLayers.map(layer => JSON.stringify(layer)).join('\n');
  await fs.writeFile(MERGED_OUTPUT_PATH, outputLines, 'utf-8');

  console.log(`✓ Merged dataset saved to: ${MERGED_OUTPUT_PATH}`);
  console.log(`\nReplace existing file: mv ${MERGED_OUTPUT_PATH} ${EXISTING_LAYERS_PATH}\n`);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { mergeLayers, filterHighQualityLayers, calculateMergeStats };
