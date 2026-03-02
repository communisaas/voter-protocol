#!/usr/bin/env tsx
/**
 * Shadow Atlas Coverage Dashboard
 *
 * Reads shadow-atlas.db and reports per-layer boundary coverage:
 * - Total boundary count per layer
 * - Per-state breakdown
 * - Gap analysis for ward data
 *
 * Usage:
 *   npm run dashboard
 *   npx tsx src/scripts/coverage-dashboard.ts
 *   npx tsx src/scripts/coverage-dashboard.ts --db ./data/shadow-atlas.db
 *   npx tsx src/scripts/coverage-dashboard.ts --json
 */

import Database from 'better-sqlite3';
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';

const { values: args } = parseArgs({
  options: {
    db: { type: 'string', default: './data/shadow-atlas.db' },
    json: { type: 'boolean', default: false },
    verbose: { type: 'boolean', default: false },
  },
  strict: false,
});

const dbPath = args.db as string;
const jsonOutput = args.json as boolean;
const verbose = args.verbose as boolean;

/** FIPS to state abbreviation */
const FIPS_TO_STATE: Record<string, string> = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA',
  '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL',
  '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN',
  '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME',
  '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS',
  '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
  '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
  '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
  '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
  '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI',
  '56': 'WY',
};

/** Extract layer prefix from district ID */
function layerPrefix(id: string): string {
  // Special case: can-fed-XXXXX → can-fed
  if (id.startsWith('can-fed-')) return 'can-fed';
  const dash = id.indexOf('-');
  return dash > 0 ? id.slice(0, dash) : 'unknown';
}

/** Extract state FIPS from district ID (first 2 digits after prefix) */
function extractStateFips(id: string): string | null {
  if (id.startsWith('can-fed-')) return null; // Canadian
  const match = id.match(/^[a-z]+-(\d{2})/);
  return match ? match[1] : null;
}

interface LayerStats {
  layer: string;
  count: number;
  states: Map<string, number>;
}

interface DashboardData {
  dbPath: string;
  totalBoundaries: number;
  layers: LayerStats[];
  wardCities: number;
  wardStates: Set<string>;
  statesWithoutWards: string[];
}

function collectStats(db: Database.Database): DashboardData {
  const rows = db.prepare('SELECT id FROM districts').all() as Array<{ id: string }>;

  const layerMap = new Map<string, LayerStats>();
  const wardCityFips = new Set<string>();

  for (const row of rows) {
    const prefix = layerPrefix(row.id);
    if (!layerMap.has(prefix)) {
      layerMap.set(prefix, { layer: prefix, count: 0, states: new Map() });
    }
    const stats = layerMap.get(prefix)!;
    stats.count++;

    const stateFips = extractStateFips(row.id);
    if (stateFips) {
      const stateAbbr = FIPS_TO_STATE[stateFips] ?? stateFips;
      stats.states.set(stateAbbr, (stats.states.get(stateAbbr) ?? 0) + 1);
    }

    // Collect ward city FIPS inline (avoids second full scan)
    if (prefix === 'ward') {
      const match = row.id.match(/^ward-(\d+)-/);
      if (match) wardCityFips.add(match[1]);
    }
  }

  // Sort layers by count descending
  const layers = [...layerMap.values()].sort((a, b) => b.count - a.count);

  // Ward gap analysis
  const wardStats = layerMap.get('ward');
  const wardStates = wardStats ? new Set(wardStats.states.keys()) : new Set<string>();
  const wardCities = wardCityFips.size;

  // States that have congressional districts but no wards
  const cdStats = layerMap.get('cd');
  const cdStates = cdStats ? new Set(cdStats.states.keys()) : new Set<string>();
  const statesWithoutWards = [...cdStates].filter(s => !wardStates.has(s)).sort();

  return {
    dbPath,
    totalBoundaries: rows.length,
    layers,
    wardCities,
    wardStates,
    statesWithoutWards,
  };
}

function printDashboard(data: DashboardData): void {
  const SEP = '═'.repeat(72);
  const THIN = '─'.repeat(72);

  console.log(SEP);
  console.log('  Shadow Atlas Coverage Dashboard');
  console.log(SEP);
  console.log(`  Database: ${data.dbPath}`);
  console.log(`  Total boundaries: ${data.totalBoundaries.toLocaleString()}`);
  console.log(SEP);
  console.log();

  // Per-layer summary
  console.log('  LAYER SUMMARY');
  console.log(THIN);
  console.log('  ' + 'Layer'.padEnd(14) + 'Count'.padStart(10) + '  States');
  console.log(THIN);

  for (const layer of data.layers) {
    const stateCount = layer.states.size;
    const stateLabel = stateCount > 0 ? `${stateCount} state${stateCount !== 1 ? 's' : ''}` : 'n/a';
    console.log(
      '  ' +
      layer.layer.padEnd(14) +
      String(layer.count).padStart(10) +
      '  ' + stateLabel
    );
  }

  console.log(THIN);
  console.log();

  // Ward coverage
  console.log('  WARD COVERAGE');
  console.log(THIN);
  console.log(`  Cities with ward data:  ${data.wardCities}`);
  console.log(`  States with ward data:  ${data.wardStates.size} (${[...data.wardStates].sort().join(', ')})`);
  console.log(`  States WITHOUT wards:   ${data.statesWithoutWards.length}`);
  if (data.statesWithoutWards.length > 0) {
    if (data.statesWithoutWards.length <= 20) {
      console.log(`    ${data.statesWithoutWards.join(', ')}`);
    } else {
      console.log(`    ${data.statesWithoutWards.slice(0, 20).join(', ')} ... (use --json for full list)`);
    }
  }
  console.log(THIN);
  console.log();

  // Per-state detail (verbose mode)
  if (verbose) {
    console.log('  PER-STATE DETAIL');
    console.log(THIN);

    // Collect all states, show layer counts
    const allStates = new Set<string>();
    for (const layer of data.layers) {
      for (const state of layer.states.keys()) {
        allStates.add(state);
      }
    }

    const layerNames = data.layers.map(l => l.layer).slice(0, 8); // Top 8 layers
    const header = '  ' + 'State'.padEnd(6) + layerNames.map(l => l.slice(0, 8).padStart(10)).join('');
    console.log(header);
    console.log(THIN);

    for (const state of [...allStates].sort()) {
      const cols = layerNames.map(l => {
        const layerStats = data.layers.find(ls => ls.layer === l);
        const count = layerStats?.states.get(state) ?? 0;
        return count > 0 ? String(count).padStart(10) : '         -';
      });
      console.log('  ' + state.padEnd(6) + cols.join(''));
    }

    console.log(THIN);
  }
}

function printJSON(data: DashboardData): void {
  const output = {
    dbPath: data.dbPath,
    totalBoundaries: data.totalBoundaries,
    layers: data.layers.map(l => ({
      layer: l.layer,
      count: l.count,
      states: Object.fromEntries(l.states),
    })),
    wardCoverage: {
      cities: data.wardCities,
      states: [...data.wardStates].sort(),
      statesWithoutWards: data.statesWithoutWards,
    },
  };
  console.log(JSON.stringify(output, null, 2));
}

// Main
if (!existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  console.error('Run the build script first: npx tsx src/scripts/build-district-db.ts');
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });
try {
  const data = collectStats(db);
  if (jsonOutput) {
    printJSON(data);
  } else {
    printDashboard(data);
  }
} finally {
  db.close();
}
