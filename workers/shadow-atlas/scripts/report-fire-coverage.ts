import { promises as fs } from 'fs';
import path from 'path';

interface RegistrySource {
  readonly name?: string;
  readonly categories?: string[];
  readonly status?: string;
}

interface RegistryState {
  readonly state: string;
  readonly sources?: RegistrySource[];
}

interface RegistryFile {
  readonly states: RegistryState[];
}

interface IngestorEntry {
  readonly state: string;
  readonly dataset: string;
  readonly ingestor: string;
}

interface FireCoverageRow {
  readonly state: string;
  readonly status: 'authority_live' | 'ingestor_configured' | 'baseline_only';
  readonly notes?: string;
}

async function loadRegistry(): Promise<RegistryFile> {
  const contents = await fs.readFile(path.resolve('data', 'special-districts', 'registry.json'), 'utf8');
  return JSON.parse(contents) as RegistryFile;
}

async function loadIngestors(): Promise<IngestorEntry[]> {
  const contents = await fs.readFile(path.resolve('data', 'special-districts', 'ingestors.json'), 'utf8');
  const parsed = JSON.parse(contents) as { entries: IngestorEntry[] };
  return parsed.entries;
}

function hasAuthorityFire(stateEntry: RegistryState | undefined): boolean {
  if (!stateEntry?.sources?.length) {
    return false;
  }
  return stateEntry.sources.some((source) => {
    if (!source.categories?.includes('fire')) {
      return false;
    }
    if (source.status !== 'live') {
      return false;
    }
    if (source.name?.toLowerCase().includes('nifc')) {
      return false;
    }
    return source.status === 'live' || source.status === 'in_progress';
  });
}

async function buildCoverageReport(): Promise<FireCoverageRow[]> {
  const [registry, ingestors] = await Promise.all([loadRegistry(), loadIngestors()]);
  const ingestorStates = new Set(
    ingestors.filter((entry) => entry.dataset === 'fire').map((entry) => entry.state.toUpperCase())
  );

  const rows: FireCoverageRow[] = [];

  for (const stateEntry of registry.states) {
    const stateCode = stateEntry.state.toUpperCase();
    const authorityLive = hasAuthorityFire(stateEntry);
    const ingestorConfigured = ingestorStates.has(stateCode);

    if (authorityLive) {
      rows.push({ state: stateCode, status: 'authority_live' });
      continue;
    }

    if (ingestorConfigured) {
      rows.push({
        state: stateCode,
        status: 'ingestor_configured',
        notes: 'adapter ready; waiting on data source/env vars'
      });
      continue;
    }

    rows.push({ state: stateCode, status: 'baseline_only', notes: 'NIFC fallback only' });
  }

  return rows.sort((a, b) => a.state.localeCompare(b.state));
}

function summarize(rows: FireCoverageRow[]): void {
  const counts = rows.reduce<Record<FireCoverageRow['status'], number>>(
    (acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    },
    {
      authority_live: 0,
      ingestor_configured: 0,
      baseline_only: 0
    }
  );

  console.log('\nFire Coverage Summary');
  console.log('---------------------');
  console.table(counts);

  const blockers = rows.filter((row) => row.status !== 'authority_live');
  if (blockers.length) {
    console.log('\nStates needing attention:');
    for (const row of blockers) {
      console.log(
        ` - ${row.state}: ${row.status}${row.notes ? ` (${row.notes})` : ''}`
      );
    }
  }
}

async function main() {
  const rows = await buildCoverageReport();
  console.table(
    rows.map((row) => ({
      State: row.state,
      Status: row.status,
      Notes: row.notes ?? ''
    }))
  );
  summarize(rows);
  const unmet = rows.filter((row) => row.status !== 'authority_live');
  if (unmet.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[fire-report] Failed:', error);
  process.exit(1);
});
