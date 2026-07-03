#!/usr/bin/env tsx
/**
 * Fetch REAL National Address Database rows for one state and write them as
 * a NAD-text-release-format CSV, suitable for `build-address-index.ts --nad`.
 *
 * Source: the US DOT NAD published as an ArcGIS feature service
 * (Esri_US_Federal_Data view `Address_Points_from_National_Address_Database`,
 * release-synced with the quarterly text file — the layer's national row
 * count matches the release's published record count exactly). Used for
 * bounded acquisitions (per-state sample builds) where streaming the ~7.6 GB
 * national TXT.zip is disproportionate; the quarterly CI path streams the
 * full text release instead (see shadow-atlas-quarterly.yml).
 *
 * The output is a COLUMN-SUBSET of the release schema: the 16 columns the
 * index consumes, under their exact NAD release header names. The stream
 * parser resolves columns by header name, so subset files parse through the
 * identical code path as the full release.
 *
 * These are PUBLIC address points — no user data is involved at any point.
 *
 * Usage:
 *   tsx scripts/fetch-nad-state.ts --state DC \
 *     [--output data/nad-cache/NAD_DC.txt] [--page-size 2000]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const SERVICE_URL =
  'https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/Address_Points_from_National_Address_Database_view/FeatureServer/0/query';

/**
 * Conservative WGS84 bounding boxes per state (attribute-only WHERE clauses
 * 400 on this view; spatial envelope queries are index-backed). Rows are
 * filtered to the exact `State` attribute client-side, so a generous box is
 * safe — fringe rows from neighboring states are dropped.
 */
const STATE_BBOX: Record<string, [number, number, number, number]> = {
  DC: [-77.13, 38.79, -76.9, 39.01],
  DE: [-75.8, 38.44, -74.98, 39.85],
  RI: [-71.91, 41.09, -71.08, 42.02],
};

/** NAD release header names for the columns the address index consumes. */
const COLUMNS = [
  'AddNum_Pre',
  'Add_Number',
  'AddNum_Suf',
  'AddNo_Full',
  'St_PreMod',
  'St_PreDir',
  'St_PreTyp',
  'St_PreSep',
  'St_Name',
  'St_PosTyp',
  'St_PosDir',
  'St_PosMod',
  'State',
  'Zip_Code',
  'Longitude',
  'Latitude',
] as const;

interface Args {
  state: string;
  output: string;
  pageSize: number;
}

function parseArgs(argv: string[]): Args {
  let state = '';
  let output = '';
  let pageSize = 2000;
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--state':
        state = (argv[++i] ?? '').toUpperCase();
        break;
      case '--output':
        output = argv[++i];
        break;
      case '--page-size':
        pageSize = Number.parseInt(argv[++i], 10);
        break;
      default:
        console.error(`Unknown argument: ${argv[i]}`);
        process.exit(1);
    }
  }
  if (!(state in STATE_BBOX)) {
    console.error(
      `--state must be one of ${Object.keys(STATE_BBOX).join(', ')} (add a bbox to STATE_BBOX for other states)`
    );
    process.exit(1);
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 2000) {
    console.error('--page-size must be an integer in [1, 2000]');
    process.exit(1);
  }
  return { state, output: output || `data/nad-cache/NAD_${state}.txt`, pageSize };
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function fetchPage(
  bbox: [number, number, number, number],
  offset: number,
  pageSize: number,
  maxRetries = 5
): Promise<Array<Record<string, unknown>>> {
  const params = new URLSearchParams({
    where: '1=1',
    geometry: bbox.join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: ['OBJECTID', ...COLUMNS].join(','),
    returnGeometry: 'false',
    orderByFields: 'OBJECTID',
    resultOffset: String(offset),
    resultRecordCount: String(pageSize),
    f: 'json',
  });
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(`${SERVICE_URL}?${params}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as {
        error?: { code: number; message: string };
        features?: Array<{ attributes: Record<string, unknown> }>;
      };
      if (body.error) throw new Error(`ArcGIS error ${body.error.code}: ${body.error.message}`);
      return (body.features ?? []).map((f) => f.attributes);
    } catch (error) {
      lastError = error as Error;
      console.warn(`  page offset=${offset} attempt ${attempt}/${maxRetries}: ${lastError.message}`);
      await new Promise((r) => setTimeout(r, 2_000 * attempt));
    }
  }
  throw new Error(`page fetch failed at offset ${offset}: ${lastError?.message}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const bbox = STATE_BBOX[args.state];
  console.log(`Fetching NAD rows for ${args.state} (bbox ${bbox.join(',')})…`);

  const seen = new Set<number>();
  const lines: string[] = [COLUMNS.join(',')];
  let kept = 0;
  let offset = 0;
  const CONCURRENCY = 4;

  for (;;) {
    const offsets = Array.from({ length: CONCURRENCY }, (_, i) => offset + i * args.pageSize);
    const pages = await Promise.all(
      offsets.map((o) => fetchPage(bbox, o, args.pageSize))
    );
    let done = false;
    for (const rows of pages) {
      if (rows.length < args.pageSize) done = true;
      for (const row of rows) {
        const oid = Number(row['OBJECTID']);
        if (seen.has(oid)) continue;
        seen.add(oid);
        if (String(row['State'] ?? '').toUpperCase() !== args.state) continue;
        lines.push(COLUMNS.map((c) => csvEscape(row[c])).join(','));
        kept++;
      }
    }
    offset += CONCURRENCY * args.pageSize;
    if (offset % (CONCURRENCY * args.pageSize * 5) === 0 || done) {
      console.log(`  scanned ~${offset.toLocaleString()} rows, kept ${kept.toLocaleString()} ${args.state} rows`);
    }
    if (done) break;
  }

  mkdirSync(dirname(args.output), { recursive: true });
  writeFileSync(args.output, lines.join('\n') + '\n');
  console.log(`Wrote ${kept.toLocaleString()} real NAD rows → ${args.output}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
