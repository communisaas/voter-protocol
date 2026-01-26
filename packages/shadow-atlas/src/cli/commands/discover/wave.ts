/**
 * Discover Wave Command
 *
 * Unified wave discovery and management interface. Fully subsumes wave-discovery.ts script.
 *
 * Usage:
 *   shadow-atlas discover wave <action> [options]
 *
 * Actions:
 *   list                    List all waves with counts and status
 *   create <name>           Create new wave
 *   status <wave>           Show wave details
 *   finalize <wave>         Lock wave, generate summary
 *
 *   hub                     Discover datasets from ArcGIS Hub API
 *   aggregator <id>         Extract cities from regional aggregator
 *   aggregators             List all available aggregators
 *   gaps                    Analyze coverage gaps and potential
 *
 * Options:
 *   --target <n>           Target portal count for new wave
 *   --notes <text>         Wave notes
 *   --output <file>        Output file for status/summary
 *   --limit <n>            Limit results (for hub discovery)
 *   --dry-run              Show what would be done without executing
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type { Command } from 'commander';
import { readFile, writeFile, mkdir, readdir, stat } from 'fs/promises';
import { join, basename } from 'path';
import {
  discoverFromHub,
  extractFromAggregator,
  type HubDiscoveryResult,
} from '../../../services/bulk-district-discovery.js';
import {
  getAllAggregatorsSorted,
  getAggregatorById,
  getActiveAggregators,
  type RegionalAggregator,
  type AggregatorExtractionResult,
} from '../../../core/registry/regional-aggregators.js';
import { KNOWN_PORTALS } from '../../../core/registry/known-portals.generated.js';

/**
 * Wave options from CLI
 */
interface WaveOptions {
  readonly target?: string;
  readonly notes?: string;
  readonly output?: string;
  readonly verbose?: boolean;
  readonly json?: boolean;
  readonly limit?: string;
  readonly dryRun?: boolean;
}

/**
 * Wave metadata
 */
interface WaveMetadata {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly status: 'active' | 'finalized';
  readonly target: number | null;
  readonly notes: string | null;
  readonly finalizedAt: string | null;
  readonly stats: {
    readonly portalsAdded: number;
    readonly portalsAtLarge: number;
    readonly portalsQuarantined: number;
    readonly pendingReview: number;
  };
}

/**
 * Wave directory
 */
const WAVE_DIR = '.shadow-atlas/waves';

/**
 * Register the wave command
 */
export function registerWaveCommand(parent: Command): void {
  const wave = parent
    .command('wave <action> [name]')
    .description('Unified wave discovery and management')
    .option('-t, --target <n>', 'Target portal count')
    .option('-n, --notes <text>', 'Wave notes')
    .option('-o, --output <file>', 'Output file')
    .option('-v, --verbose', 'Verbose output')
    .option('--json', 'Output as JSON')
    .option('--limit <n>', 'Limit results (for hub discovery)')
    .option('--dry-run', 'Show what would be done without executing')
    .action(async (action: string, name: string | undefined, options: WaveOptions) => {
      await executeWave(action, name, options);
    });
}

/**
 * Execute the wave command
 */
async function executeWave(
  action: string,
  name: string | undefined,
  options: WaveOptions
): Promise<void> {
  const outputJson = options.json;

  try {
    switch (action) {
      // Wave management actions
      case 'list':
        await listWaves(options, outputJson);
        break;
      case 'create':
        if (!name) {
          throw new Error('Wave name required for create action');
        }
        await createWave(name, options, outputJson);
        break;
      case 'status':
        if (!name) {
          throw new Error('Wave name required for status action');
        }
        await showWaveStatus(name, options, outputJson);
        break;
      case 'finalize':
        if (!name) {
          throw new Error('Wave name required for finalize action');
        }
        await finalizeWave(name, options, outputJson);
        break;

      // Discovery actions
      case 'hub':
        await runHubDiscovery(options, outputJson);
        break;
      case 'aggregator':
        if (!name) {
          throw new Error('Aggregator ID required. Use "wave aggregators" to list available IDs');
        }
        await runAggregatorExtraction(name, options, outputJson);
        break;
      case 'aggregators':
        await listAggregators(options, outputJson);
        break;
      case 'gaps':
        await runGapAnalysis(options, outputJson);
        break;

      default:
        throw new Error(
          `Unknown action: ${action}.\n` +
          `Wave management: list, create, status, finalize\n` +
          `Discovery: hub, aggregator <id>, aggregators, gaps`
        );
    }
  } catch (error) {
    if (outputJson) {
      console.log(JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }));
    } else {
      console.error(`\nError: ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exit(1);
  }
}

/**
 * List all waves
 */
async function listWaves(options: WaveOptions, outputJson?: boolean): Promise<void> {
  await ensureWaveDir();

  const waves = await loadAllWaves();

  if (outputJson) {
    console.log(JSON.stringify({ waves }, null, 2));
    return;
  }

  console.log('\nShadow Atlas Discovery Waves');
  console.log('='.repeat(60));

  if (waves.length === 0) {
    console.log('\nNo waves found. Create one with: shadow-atlas discover wave create <name>');
    return;
  }

  console.log('\nStatus    Name              Created      Portals  Target');
  console.log('-'.repeat(60));

  for (const wave of waves) {
    const status = wave.status === 'active' ? '[ACTIVE]' : '[DONE]  ';
    const name = wave.name.padEnd(16);
    const created = wave.createdAt.substring(0, 10);
    const portals = String(wave.stats.portalsAdded).padStart(7);
    const target = wave.target ? `/${wave.target}` : '';

    console.log(`${status}  ${name}  ${created}  ${portals}${target}`);
  }

  // Summary
  const active = waves.filter((w) => w.status === 'active').length;
  const totalPortals = waves.reduce((sum, w) => sum + w.stats.portalsAdded, 0);
  const totalAtLarge = waves.reduce((sum, w) => sum + w.stats.portalsAtLarge, 0);

  console.log('-'.repeat(60));
  console.log(`\nTotal waves: ${waves.length} (${active} active)`);
  console.log(`Total portals added: ${totalPortals}`);
  console.log(`Total at-large identified: ${totalAtLarge}`);
}

/**
 * Create a new wave
 */
async function createWave(
  name: string,
  options: WaveOptions,
  outputJson?: boolean
): Promise<void> {
  await ensureWaveDir();

  // Normalize name
  const normalizedName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const waveId = `wave-${normalizedName}`;

  // Check if exists
  const wavePath = join(WAVE_DIR, `${waveId}.json`);
  try {
    await stat(wavePath);
    throw new Error(`Wave "${name}" already exists`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  const target = options.target ? parseInt(options.target, 10) : null;

  const wave: WaveMetadata = {
    id: waveId,
    name,
    createdAt: new Date().toISOString(),
    status: 'active',
    target,
    notes: options.notes ?? null,
    finalizedAt: null,
    stats: {
      portalsAdded: 0,
      portalsAtLarge: 0,
      portalsQuarantined: 0,
      pendingReview: 0,
    },
  };

  await writeFile(wavePath, JSON.stringify(wave, null, 2));

  // Create wave directory for discoveries
  const waveDataDir = join(WAVE_DIR, waveId);
  await mkdir(waveDataDir, { recursive: true });

  if (outputJson) {
    console.log(JSON.stringify({ success: true, wave }, null, 2));
    return;
  }

  console.log('\nWave created successfully!');
  console.log(`  ID: ${waveId}`);
  console.log(`  Name: ${name}`);
  if (target) console.log(`  Target: ${target} portals`);
  if (options.notes) console.log(`  Notes: ${options.notes}`);
  console.log(`\nWave data directory: ${waveDataDir}`);
  console.log('\nNext steps:');
  console.log(`  1. Run discoveries and save to: ${waveDataDir}/`);
  console.log(`  2. Import discoveries: shadow-atlas discover import ${waveDataDir}/discoveries.json`);
  console.log(`  3. Finalize: shadow-atlas discover wave finalize ${name}`);
}

/**
 * Show wave status
 */
async function showWaveStatus(
  name: string,
  options: WaveOptions,
  outputJson?: boolean
): Promise<void> {
  const wave = await loadWave(name);

  // Calculate additional stats from wave directory
  const waveDataDir = join(WAVE_DIR, wave.id);
  let discoveryFiles: string[] = [];
  try {
    const files = await readdir(waveDataDir);
    discoveryFiles = files.filter(
      (f) => f.endsWith('.json') || f.endsWith('.ndjson')
    );
  } catch {
    // Directory may not exist yet
  }

  const status = {
    wave,
    dataDirectory: waveDataDir,
    discoveryFiles,
    progress: wave.target
      ? {
          current: wave.stats.portalsAdded,
          target: wave.target,
          percentage: Math.round((wave.stats.portalsAdded / wave.target) * 100),
        }
      : null,
  };

  if (outputJson) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  console.log('\nWave Status');
  console.log('='.repeat(50));
  console.log(`Name: ${wave.name}`);
  console.log(`ID: ${wave.id}`);
  console.log(`Status: ${wave.status}`);
  console.log(`Created: ${wave.createdAt}`);
  if (wave.finalizedAt) console.log(`Finalized: ${wave.finalizedAt}`);
  if (wave.notes) console.log(`Notes: ${wave.notes}`);

  console.log('\nStatistics:');
  console.log(`  Portals added: ${wave.stats.portalsAdded}`);
  console.log(`  At-large identified: ${wave.stats.portalsAtLarge}`);
  console.log(`  Quarantined: ${wave.stats.portalsQuarantined}`);
  console.log(`  Pending review: ${wave.stats.pendingReview}`);

  if (wave.target) {
    const percentage = Math.round((wave.stats.portalsAdded / wave.target) * 100);
    console.log(`\nProgress: ${wave.stats.portalsAdded}/${wave.target} (${percentage}%)`);
    const bar = createProgressBar(percentage);
    console.log(`  ${bar}`);
  }

  if (discoveryFiles.length > 0) {
    console.log(`\nDiscovery files in ${waveDataDir}:`);
    for (const file of discoveryFiles) {
      console.log(`  - ${file}`);
    }
  }

  if (options.output) {
    await writeFile(options.output, JSON.stringify(status, null, 2));
    console.log(`\nStatus saved to: ${options.output}`);
  }
}

/**
 * Finalize a wave
 */
async function finalizeWave(
  name: string,
  options: WaveOptions,
  outputJson?: boolean
): Promise<void> {
  const wave = await loadWave(name);

  if (wave.status === 'finalized') {
    throw new Error(`Wave "${name}" is already finalized`);
  }

  // Update wave metadata
  const finalizedWave: WaveMetadata = {
    ...wave,
    status: 'finalized',
    finalizedAt: new Date().toISOString(),
  };

  // Generate summary
  const summary = {
    wave: finalizedWave,
    summary: {
      totalAdded: finalizedWave.stats.portalsAdded,
      totalAtLarge: finalizedWave.stats.portalsAtLarge,
      totalQuarantined: finalizedWave.stats.portalsQuarantined,
      duration: calculateDuration(wave.createdAt),
      completedTarget: wave.target
        ? finalizedWave.stats.portalsAdded >= wave.target
        : null,
    },
    generatedAt: new Date().toISOString(),
  };

  // Save updated wave
  const wavePath = join(WAVE_DIR, `${wave.id}.json`);
  await writeFile(wavePath, JSON.stringify(finalizedWave, null, 2));

  // Save summary
  const summaryPath = join(WAVE_DIR, wave.id, 'summary.json');
  await mkdir(join(WAVE_DIR, wave.id), { recursive: true });
  await writeFile(summaryPath, JSON.stringify(summary, null, 2));

  if (outputJson) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log('\nWave Finalized');
  console.log('='.repeat(50));
  console.log(`Name: ${wave.name}`);
  console.log(`Duration: ${summary.summary.duration}`);
  console.log('\nFinal Statistics:');
  console.log(`  Portals added: ${summary.summary.totalAdded}`);
  console.log(`  At-large identified: ${summary.summary.totalAtLarge}`);
  console.log(`  Quarantined: ${summary.summary.totalQuarantined}`);

  if (wave.target) {
    const met = summary.summary.completedTarget ? 'Yes' : 'No';
    console.log(`\nTarget met: ${met} (${summary.summary.totalAdded}/${wave.target})`);
  }

  console.log(`\nSummary saved to: ${summaryPath}`);

  if (options.output) {
    await writeFile(options.output, JSON.stringify(summary, null, 2));
    console.log(`Summary also saved to: ${options.output}`);
  }
}

/**
 * Ensure wave directory exists
 */
async function ensureWaveDir(): Promise<void> {
  await mkdir(WAVE_DIR, { recursive: true });
}

/**
 * Load all waves
 */
async function loadAllWaves(): Promise<WaveMetadata[]> {
  try {
    const files = await readdir(WAVE_DIR);
    const waveFiles = files.filter(
      (f) => f.startsWith('wave-') && f.endsWith('.json')
    );

    const waves: WaveMetadata[] = [];
    for (const file of waveFiles) {
      const content = await readFile(join(WAVE_DIR, file), 'utf-8');
      waves.push(JSON.parse(content) as WaveMetadata);
    }

    // Sort by creation date (newest first)
    return waves.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  } catch {
    return [];
  }
}

/**
 * Load a specific wave
 */
async function loadWave(name: string): Promise<WaveMetadata> {
  const normalizedName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  // Try direct match first
  let waveId = normalizedName.startsWith('wave-')
    ? normalizedName
    : `wave-${normalizedName}`;

  let wavePath = join(WAVE_DIR, `${waveId}.json`);

  try {
    const content = await readFile(wavePath, 'utf-8');
    return JSON.parse(content) as WaveMetadata;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Try to find by name
      const waves = await loadAllWaves();
      const found = waves.find(
        (w) =>
          w.name.toLowerCase() === name.toLowerCase() ||
          w.id === waveId ||
          w.id === `wave-${name}`
      );

      if (found) {
        return found;
      }

      throw new Error(`Wave "${name}" not found`);
    }
    throw error;
  }
}

/**
 * Create ASCII progress bar
 */
function createProgressBar(percentage: number): string {
  const width = 30;
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  const bar = '#'.repeat(filled) + '-'.repeat(empty);
  return `[${bar}] ${percentage}%`;
}

/**
 * Calculate duration from start date
 */
function calculateDuration(startDate: string): string {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();

  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  if (days > 0) {
    return `${days} day${days > 1 ? 's' : ''}, ${hours} hour${hours !== 1 ? 's' : ''}`;
  }
  return `${hours} hour${hours !== 1 ? 's' : ''}`;
}

// ============================================================================
// Discovery Actions
// ============================================================================

/**
 * Run Hub API Discovery (Prong 2 Strategy)
 *
 * Searches ArcGIS Hub for council district datasets across all organizations.
 */
async function runHubDiscovery(
  options: WaveOptions,
  outputJson?: boolean
): Promise<void> {
  const outputDir = '.shadow-atlas/wave-discovery';
  await mkdir(outputDir, { recursive: true });

  if (!outputJson) {
    console.log('\nHub API Discovery');
    console.log('='.repeat(60));
  }

  // Get existing FIPS to avoid duplicates
  const existingFips = new Set(Object.keys(KNOWN_PORTALS));
  if (!outputJson) {
    console.log(`Current registry: ${existingFips.size} portals\n`);
  }

  if (options.dryRun) {
    if (outputJson) {
      console.log(JSON.stringify({
        dryRun: true,
        action: 'hub-discovery',
        searchTerms: [
          'council districts',
          'city council districts',
          'ward boundaries',
          'aldermanic districts',
          'councilmanic districts',
          'commission districts',
          'municipal wards',
        ],
      }));
    } else {
      console.log('DRY RUN: Would search Hub API with terms:');
      console.log('  - council districts');
      console.log('  - city council districts');
      console.log('  - ward boundaries');
      console.log('  - aldermanic districts');
      console.log('  - councilmanic districts');
      console.log('  - commission districts');
      console.log('  - municipal wards');
    }
    return;
  }

  const limit = options.limit ? parseInt(options.limit, 10) : 500;
  const result = await discoverFromHub(existingFips, limit);

  if (outputJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Discovery Complete`);
  console.log(`  Total datasets found: ${result.totalFound}`);
  console.log(`  Search terms used: ${result.searchTerms.length}`);

  // Save results
  const resultsPath = join(outputDir, 'hub-discovery-results.json');
  await writeFile(resultsPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`\nResults saved to: ${resultsPath}`);

  // Print top results
  console.log('\nTop 20 Datasets by Confidence:\n');
  const top20 = result.datasets.slice(0, 20);
  for (const dataset of top20) {
    console.log(`  [${dataset.confidence}%] ${dataset.name}`);
    console.log(`       Owner: ${dataset.owner}`);
    console.log(`       Records: ${dataset.recordCount ?? 'unknown'}`);
    console.log(`       URL: ${dataset.url.slice(0, 70)}...`);
    console.log('');
  }

  // Generate NDJSON for candidates >= 70% confidence
  const ndjsonPath = join(outputDir, 'hub-discovery-candidates.ndjson');
  const ndjsonLines: string[] = [];

  for (const dataset of result.datasets) {
    if (dataset.confidence >= 70) {
      ndjsonLines.push(JSON.stringify({
        _type: 'hub-candidate',
        datasetId: dataset.id,
        name: dataset.name,
        url: dataset.url,
        owner: dataset.owner,
        recordCount: dataset.recordCount,
        confidence: dataset.confidence,
        matchedTerm: dataset.matchedTerm,
        discoveredAt: result.discoveredAt,
        status: 'needs-review',
      }));
    }
  }

  await writeFile(ndjsonPath, ndjsonLines.join('\n'), 'utf-8');
  console.log(`NDJSON candidates saved to: ${ndjsonPath}`);
  console.log(`  Candidates with confidence >= 70%: ${ndjsonLines.length}`);

  if (options.output) {
    await writeFile(options.output, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`\nAlso saved to: ${options.output}`);
  }
}

/**
 * Run Aggregator Extraction (Prong 1 Strategy)
 *
 * Extracts cities from a regional GIS aggregator that hosts multi-city data.
 */
async function runAggregatorExtraction(
  aggregatorId: string,
  options: WaveOptions,
  outputJson?: boolean
): Promise<void> {
  const aggregator = getAggregatorById(aggregatorId);
  if (!aggregator) {
    const available = getAllAggregatorsSorted()
      .slice(0, 10)
      .map((a) => `  ${a.id.padEnd(25)} ${a.name}`)
      .join('\n');
    throw new Error(
      `Aggregator not found: ${aggregatorId}\n\nAvailable aggregators:\n${available}\n\nUse "wave aggregators" to see full list`
    );
  }

  const outputDir = '.shadow-atlas/wave-discovery';
  await mkdir(outputDir, { recursive: true });

  if (!outputJson) {
    console.log('\nAggregator Extraction');
    console.log('='.repeat(60));
    console.log(`Aggregator: ${aggregator.name}`);
    console.log(`Coverage: ${aggregator.coverage}`);
    console.log(`Expected cities: ${aggregator.estimatedCities}`);
    console.log(`Status: ${aggregator.status}`);
    console.log('');
  }

  if (options.dryRun) {
    if (outputJson) {
      console.log(JSON.stringify({
        dryRun: true,
        action: 'aggregator-extraction',
        aggregator: {
          id: aggregator.id,
          name: aggregator.name,
          estimatedCities: aggregator.estimatedCities,
          cityField: aggregator.cityField,
          districtField: aggregator.districtField,
        },
      }));
    } else {
      console.log('DRY RUN: Would extract from this aggregator');
      console.log(`  City field: ${aggregator.cityField}`);
      console.log(`  District field: ${aggregator.districtField}`);
      console.log(`  Endpoint: ${aggregator.endpointUrl.slice(0, 70)}...`);
    }
    return;
  }

  if (aggregator.status !== 'active') {
    console.warn(`\nWARNING: Aggregator status is "${aggregator.status}"`);
    console.warn('Extraction may fail or return incomplete data.\n');
  }

  const result = await extractFromAggregator(aggregatorId);

  if (outputJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Extraction Complete`);
  console.log(`  Total features in source: ${result.totalFeatures}`);
  console.log(`  Cities extracted: ${result.cities.length}`);
  console.log(`  Failures: ${result.failures.length}`);

  // Save results
  const resultsPath = join(outputDir, `aggregator-${aggregatorId}-results.json`);
  await writeFile(resultsPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`\nResults saved to: ${resultsPath}`);

  // Print extracted cities
  if (result.cities.length > 0) {
    console.log('\nExtracted Cities:\n');
    for (const city of result.cities) {
      console.log(`  ${city.cityName}, ${city.state}`);
      console.log(`       Districts: ${city.districtCount}`);
      console.log(`       Confidence: ${city.confidence}%`);
      console.log('');
    }
  }

  // Print failures
  if (result.failures.length > 0) {
    console.log('\nFailures:\n');
    for (const failure of result.failures) {
      console.log(`  ${failure.cityName}: ${failure.reason}`);
    }
    console.log('');
  }

  // Generate NDJSON for registry insertion
  const ndjsonPath = join(outputDir, `aggregator-${aggregatorId}-portals.ndjson`);
  const ndjsonLines: string[] = [];

  for (const city of result.cities) {
    ndjsonLines.push(JSON.stringify({
      _fips: city.fips ?? 'NEEDS_LOOKUP',
      cityFips: city.fips ?? 'NEEDS_LOOKUP',
      cityName: city.cityName,
      state: city.state,
      portalType: 'regional-gis',
      downloadUrl: city.downloadUrl,
      featureCount: city.districtCount,
      lastVerified: result.extractedAt,
      confidence: city.confidence,
      discoveredBy: `aggregator-${aggregatorId}`,
      notes: `Extracted from ${aggregator.name}`,
    }));
  }

  await writeFile(ndjsonPath, ndjsonLines.join('\n'), 'utf-8');
  console.log(`NDJSON portals saved to: ${ndjsonPath}`);
  console.log(`  Ready for registry insertion: ${ndjsonLines.length} entries`);

  if (options.output) {
    await writeFile(options.output, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`\nAlso saved to: ${options.output}`);
  }
}

/**
 * List all available regional aggregators
 *
 * Shows aggregators grouped by priority with status indicators.
 */
async function listAggregators(
  options: WaveOptions,
  outputJson?: boolean
): Promise<void> {
  const aggregators = getAllAggregatorsSorted();
  const active = getActiveAggregators();

  if (outputJson) {
    console.log(JSON.stringify({
      aggregators,
      summary: {
        total: aggregators.length,
        active: active.length,
        estimatedCitiesTotal: aggregators.reduce((sum, a) => sum + a.estimatedCities, 0),
        estimatedCitiesActive: active.reduce((sum, a) => sum + a.estimatedCities, 0),
      },
    }, null, 2));
    return;
  }

  console.log('\nRegional GIS Aggregators');
  console.log('='.repeat(60));

  let currentPriority: string | null = null;

  for (const agg of aggregators) {
    if (agg.priority !== currentPriority) {
      currentPriority = agg.priority;
      const priorityLabel =
        currentPriority === 'P0' ? 'High Yield (25+ cities)' :
        currentPriority === 'P1' ? 'Medium Yield (15-25 cities)' :
        'Lower Yield (5-15 cities)';
      console.log(`\n${currentPriority}: ${priorityLabel}`);
      console.log('-'.repeat(60));
    }

    const statusIcon =
      agg.status === 'active' ? '[OK]' :
      agg.status === 'needs-verification' ? '[??]' :
      '[X]';

    console.log(
      `  ${statusIcon} ${agg.id.padEnd(28)} ${String(agg.estimatedCities).padStart(3)} cities  ${agg.name}`
    );
  }

  const totalCities = aggregators.reduce((sum, a) => sum + a.estimatedCities, 0);
  const activeCities = active.reduce((sum, a) => sum + a.estimatedCities, 0);

  console.log('\n' + '-'.repeat(60));
  console.log(`Total aggregators: ${aggregators.length} (${active.length} active)`);
  console.log(`Estimated cities (all): ${totalCities}`);
  console.log(`Estimated cities (active): ${activeCities}`);
  console.log('');

  if (options.output) {
    const data = {
      aggregators,
      summary: {
        total: aggregators.length,
        active: active.length,
        estimatedCitiesTotal: totalCities,
        estimatedCitiesActive: activeCities,
      },
    };
    await writeFile(options.output, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`Saved to: ${options.output}`);
  }
}

/**
 * Run coverage gap analysis
 *
 * Analyzes current registry coverage vs aggregator potential.
 */
async function runGapAnalysis(
  options: WaveOptions,
  outputJson?: boolean
): Promise<void> {
  const existingFips = new Set(Object.keys(KNOWN_PORTALS));
  const aggregators = getAllAggregatorsSorted();
  const active = getActiveAggregators();

  const totalPotential = aggregators.reduce((sum, a) => sum + a.estimatedCities, 0);
  const activePotential = active.reduce((sum, a) => sum + a.estimatedCities, 0);

  if (outputJson) {
    console.log(JSON.stringify({
      currentRegistry: existingFips.size,
      aggregatorPotential: {
        total: totalPotential,
        active: activePotential,
      },
      aggregators: aggregators.map((a) => ({
        id: a.id,
        name: a.name,
        status: a.status,
        estimatedCities: a.estimatedCities,
        priority: a.priority,
      })),
      recommendations: active.slice(0, 5).map((a) => ({
        id: a.id,
        name: a.name,
        estimatedCities: a.estimatedCities,
      })),
    }, null, 2));
    return;
  }

  console.log('\nCoverage Gap Analysis');
  console.log('='.repeat(60));
  console.log(`Current registry: ${existingFips.size} portals\n`);

  console.log('Aggregator Potential:');
  console.log('-'.repeat(60));

  for (const agg of aggregators) {
    const statusIcon =
      agg.status === 'active' ? '[OK]' :
      agg.status === 'needs-verification' ? '[??]' :
      '[X]';
    console.log(`  ${statusIcon} ${agg.id.padEnd(28)} +${agg.estimatedCities} cities`);
  }

  console.log('-'.repeat(60));
  console.log(`Total aggregator potential: +${totalPotential} cities`);
  console.log(`Active aggregator potential: +${activePotential} cities\n`);

  console.log('Target Metrics:');
  console.log('-'.repeat(60));
  console.log(`  Known Portals:     ${existingFips.size} current → 800 target → 1000 stretch`);
  console.log(`  Coverage (>25k):   ~33% current → 60% target → 75% stretch\n`);

  console.log('Recommended Actions:');
  console.log('-'.repeat(60));
  console.log('  1. Extract from active aggregators first:');
  for (const agg of active.slice(0, 3)) {
    console.log(`     shadow-atlas discover wave aggregator ${agg.id}`);
  }
  console.log('  2. Run Hub discovery for additional datasets:');
  console.log('     shadow-atlas discover wave hub');
  console.log('  3. Verify and activate needs-verification aggregators');
  console.log('');

  if (options.output) {
    const data = {
      currentRegistry: existingFips.size,
      aggregatorPotential: {
        total: totalPotential,
        active: activePotential,
      },
      aggregators,
      recommendations: active.slice(0, 5),
    };
    await writeFile(options.output, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`Saved to: ${options.output}`);
  }
}
