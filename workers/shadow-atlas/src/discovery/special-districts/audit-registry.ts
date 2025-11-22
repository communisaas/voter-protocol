import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  SPECIAL_DISTRICT_REGISTRY,
  PROJECT_ROOT,
  type SpecialDistrictSourceEntry,
  type SpecialDistrictStateEntry
} from './registry';

interface AuditOptions {
  readonly state?: string;
}

function parseArgs(): AuditOptions {
  const stateArg = process.argv.find(arg => arg.startsWith('--state='));
  return stateArg ? { state: stateArg.split('=')[1].toUpperCase() } : {};
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

async function verifyLocalSource(entry: SpecialDistrictSourceEntry): Promise<string | null> {
  if (entry.datasetType !== 'geojson_local' || !entry.path) {
    return null;
  }

  const absolutePath = path.resolve(PROJECT_ROOT, entry.path);
  try {
    await fs.access(absolutePath);
    return null;
  } catch {
    return `Missing file: ${entry.path}`;
  }
}

function summarizeState(entry: SpecialDistrictStateEntry) {
  const total = entry.sources.length;
  const live = entry.sources.filter(source => source.status === 'live').length;
  const planned = entry.sources.filter(source => source.status === 'planned').length;
  const unverified = entry.sources.filter(source => source.status === 'unverified').length;

  return {
    total,
    live,
    planned,
    unverified
  };
}

async function run() {
  const options = parseArgs();
  const states = options.state
    ? SPECIAL_DISTRICT_REGISTRY.states.filter(entry => entry.state === options.state)
    : SPECIAL_DISTRICT_REGISTRY.states;

  if (states.length === 0) {
    console.error(`No states found matching ${options.state}`);
    process.exit(1);
  }

  console.log('='.repeat(80));
  console.log('Special District Authority Registry Audit');
  console.log(`Registry version: ${SPECIAL_DISTRICT_REGISTRY.version}`);
  console.log(`Generated: ${SPECIAL_DISTRICT_REGISTRY.generated}`);
  console.log('='.repeat(80));

  const problems: string[] = [];
  let totalPopulation = 0;
  let livePopulation = 0;

  for (const state of states) {
    totalPopulation += state.populationShare;
    const stateSummary = summarizeState(state);
    if (stateSummary.live > 0) {
      livePopulation += state.populationShare;
    }

    console.log(`\n${state.state} — ${state.authority}`);
    console.log(`  Coverage: ${state.coverage} | Status: ${state.status}`);
    console.log(
      `  Sources: ${stateSummary.live} live / ${stateSummary.planned} planned / ${stateSummary.unverified} unverified (total ${stateSummary.total})`
    );
    console.log(`  Population coverage (state weight): ${formatPercent(state.populationShare)}`);

    for (const source of state.sources) {
      if (source.datasetType === 'geojson_local' && source.path) {
        const maybeProblem = await verifyLocalSource(source);
        if (maybeProblem) {
          problems.push(`${state.state} - ${source.name}: ${maybeProblem}`);
        }
      }

      if (source.status === 'unverified') {
        problems.push(`${state.state} - ${source.name}: status still unverified`);
      }
    }
  }

  console.log('\n='.repeat(80));
  console.log('Population Coverage Summary');
  console.log(`  States reviewed: ${states.length}`);
  console.log(`  Total population weight: ${formatPercent(totalPopulation)}`);
  console.log(`  Authority-backed weight: ${formatPercent(livePopulation)}`);
  console.log('='.repeat(80));

  if (problems.length > 0) {
    console.log('\nIssues detected:');
    for (const issue of problems) {
      console.log(`  - ${issue}`);
    }
    process.exitCode = 1;
  } else {
    console.log('\nNo blocking issues detected.');
  }
}

run().catch((error) => {
  console.error('Audit failed with error:');
  console.error(error);
  process.exit(1);
});
