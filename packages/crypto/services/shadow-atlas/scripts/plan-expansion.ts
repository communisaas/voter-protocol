/**
 * Expansion Planning Tool - CLI Interface
 *
 * PURPOSE: Generate intelligent expansion plans for city coverage
 * USAGE: npm run atlas:plan-expansion [limit]
 *
 * FEATURES:
 * - Multi-factor prioritization (population, tier upgrade, success rate, clustering)
 * - Impact estimation (people reached, tier upgrades, new coverage)
 * - State-level grouping for batch discovery
 * - JSON export for automation
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createExpansionPlan } from '../services/expansion-planner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load city database
 */
async function loadCityDatabase(): Promise<
  Array<{ fips: string; name: string; state: string; population: number; rank: number }>
> {
  // Load top 1000 cities
  const dataPath = path.join(__dirname, '../data/us-cities-top-1000.json');

  try {
    const raw = await fs.readFile(dataPath, 'utf-8');
    const cities = JSON.parse(raw) as Array<{
      fips: string;
      name: string;
      state: string;
      population: number;
      rank: number;
    }>;

    return cities;
  } catch (error) {
    console.error(`Failed to load city database: ${dataPath}`);
    throw error;
  }
}

/**
 * Main entry point
 */
async function main() {
  const limit = Number(process.argv[2]) || 100;

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║       SHADOW ATLAS EXPANSION PLANNER                ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  console.log('Loading city database...');
  const cities = await loadCityDatabase();
  console.log(`Loaded ${cities.length.toLocaleString()} cities\n`);

  console.log('Analyzing provenance and calculating priorities...');
  const baseDir = path.join(__dirname, '../discovery-attempts');
  const plan = await createExpansionPlan(cities, limit, baseDir);

  console.log(`\n═══ EXPANSION PLAN (Next ${limit} Cities) ===\n`);
  console.log(`Total Candidates: ${plan.totalCandidates.toLocaleString()}`);
  console.log(`Recommended:      ${plan.recommended.length}`);

  console.log(`\n═══ ESTIMATED IMPACT ===\n`);
  console.log(`People Reached:   ${plan.estimatedImpact.peopleReached.toLocaleString()}`);
  console.log(`New Coverage:     ${plan.estimatedImpact.newCoverage} cities`);
  console.log(`Tier Upgrades:    ${plan.estimatedImpact.tierUpgrades} cities`);

  console.log(`\n═══ TOP 20 PRIORITIES ===\n`);
  for (const target of plan.recommended.slice(0, 20)) {
    const tier = target.currentTier === null ? 'NONE' : `TIER ${target.currentTier}`;
    console.log(
      `${target.cityName.padEnd(25)} ${target.state.padEnd(2)} ` +
        `${String(target.priority.toFixed(1)).padStart(5)} pts ` +
        `${tier.padEnd(8)} ` +
        `pop: ${(target.population / 1000).toFixed(0).padStart(5)}K`
    );
  }

  console.log(`\n═══ BY STATE (Top 10) ===\n`);
  const stateSorted = Object.entries(plan.byState)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10);

  for (const [state, stateCities] of stateSorted) {
    const totalPop = stateCities.reduce((sum, c) => sum + c.population, 0);
    const avgPriority =
      stateCities.reduce((sum, c) => sum + c.priority, 0) / stateCities.length;
    console.log(
      `${state.padEnd(15)} ${String(stateCities.length).padStart(3)} cities ` +
        `(${(totalPop / 1000000).toFixed(1)}M people) ` +
        `avg: ${avgPriority.toFixed(1)} pts`
    );
  }

  console.log(`\n═══ BY CURRENT TIER ===\n`);
  const tierSorted = Object.entries(plan.byTier).sort((a, b) => {
    if (a[0] === 'null') return -1;
    if (b[0] === 'null') return 1;
    return Number(a[0]) - Number(b[0]);
  });

  for (const [tier, tierCities] of tierSorted) {
    const tierLabel = tier === 'null' ? 'NEW' : `TIER ${tier}`;
    const totalPop = tierCities.reduce((sum, c) => sum + c.population, 0);
    console.log(
      `${tierLabel.padEnd(15)} ${String(tierCities.length).padStart(3)} cities ` +
        `(${(totalPop / 1000000).toFixed(1)}M people)`
    );
  }

  // Write full plan to file
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const outputPath = path.join(
    __dirname,
    `../expansion-plan-${limit}-${timestamp}.json`
  );
  await fs.writeFile(outputPath, JSON.stringify(plan, null, 2));
  console.log(`\n✅ Full plan written to: ${path.basename(outputPath)}\n`);

  // Show example reasoning for top 3
  console.log(`\n═══ EXAMPLE REASONING (Top 3) ===\n`);
  for (const target of plan.recommended.slice(0, 3)) {
    console.log(`${target.cityName}, ${target.state} (Priority: ${target.priority.toFixed(1)})`);
    for (const reason of target.reasoning) {
      console.log(`  • ${reason}`);
    }
    console.log('');
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
