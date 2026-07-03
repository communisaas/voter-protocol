#!/usr/bin/env tsx
/**
 * Extract a committed unit-test fixture from a REAL TIGER ADDRFEAT county
 * file. The address-index unit tests are driven by this extract — never by
 * hand-typed rows — so the shapes they assert (descending ranges, parity
 * enums, ZIP mixes, real street-name spellings) are the shapes the real
 * pipeline sees. Re-running this script against the same county file is
 * deterministic: selection is by fixed predicates + document order.
 *
 * The SMALL extract is committed (fixtures/…json, ~100 KB); the county zip
 * itself is not (cache dir is gitignored).
 *
 * Usage:
 *   tsx scripts/extract-addrfeat-fixture.ts \
 *     [--county 10001] [--vintage TIGER2025] \
 *     [--cache-dir ./data/addrfeat-cache] \
 *     [--output src/__tests__/unit/address-index/fixtures/addrfeat-extract.json]
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { transformShapefileToGeoJSON } from '../src/transformation/shapefile-to-geojson.js';
import { resolveTigerVintage } from '../src/distribution/snapshots/tiger-vintage.js';

interface Args {
  county: string;
  vintage: string;
  cacheDir: string;
  output: string;
}

function parseArgs(argv: string[]): Args {
  let county = '10001'; // Kent County, DE — small (~1.4 MB) real county file
  let vintage = 'TIGER2025';
  let cacheDir = './data/addrfeat-cache';
  let output = 'src/__tests__/unit/address-index/fixtures/addrfeat-extract.json';
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--county':
        county = argv[++i];
        break;
      case '--vintage':
        vintage = argv[++i];
        break;
      case '--cache-dir':
        cacheDir = argv[++i];
        break;
      case '--output':
        output = argv[++i];
        break;
      default:
        console.error(`Unknown argument: ${argv[i]}`);
        process.exit(1);
    }
  }
  if (!/^\d{5}$/.test(county)) {
    console.error(`--county must be a 5-digit county FIPS, got: ${county}`);
    process.exit(1);
  }
  return { county, vintage: resolveTigerVintage(vintage, { dryRun: false }), cacheDir, output };
}

interface SideView {
  fromHn: string;
  toHn: string;
  parity: string;
}

function sideViews(props: Record<string, unknown>): SideView[] {
  const s = (k: string) => String(props[k] ?? '').trim();
  return [
    { fromHn: s('LFROMHN'), toHn: s('LTOHN'), parity: s('PARITYL') },
    { fromHn: s('RFROMHN'), toHn: s('RTOHN'), parity: s('PARITYR') },
  ].filter((v) => v.fromHn.length > 0 || v.toHn.length > 0);
}

function leadingInt(raw: string): number | null {
  const m = raw.match(/^(\d+)/);
  return m ? Number.parseInt(m[1], 10) : null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const year = args.vintage.replace(/^TIGER/, '');
  const name = `tl_${year}_${args.county}_addrfeat.zip`;
  const url = `https://www2.census.gov/geo/tiger/TIGER${year}/ADDRFEAT/${name}`;
  const cached = join(args.cacheDir, name);

  let buf: Buffer;
  if (existsSync(cached) && statSync(cached).size > 4) {
    console.log(`Reusing cached ${cached}`);
    buf = readFileSync(cached);
  } else {
    console.log(`Downloading ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    buf = Buffer.from(await response.arrayBuffer());
    mkdirSync(args.cacheDir, { recursive: true });
    writeFileSync(cached, buf);
  }
  const sourceSha256 = createHash('sha256').update(buf).digest('hex');

  const fc = await transformShapefileToGeoJSON(buf);
  console.log(`Parsed ${fc.features.length.toLocaleString()} ADDRFEAT edges`);

  // Deterministic selection: document order, fixed predicates, fixed caps.
  const CAPS = {
    base: 120, // leading usable features regardless of shape
    descending: 25, // fromHn > toHn on at least one side (swap+flip path)
    parityB: 15,
    parityO: 15,
    parityE: 15,
    singleHn: 10, // fromHn === toHn (t = 0.5 interpolation path)
    nonNumericHn: 10, // hyphenated/suffixed house numbers
  };
  const picked = new Map<number, string>(); // feature idx → why
  const counts: Record<string, number> = {};
  const take = (idx: number, why: keyof typeof CAPS): void => {
    if ((counts[why] ?? 0) >= CAPS[why]) return;
    if (!picked.has(idx)) {
      picked.set(idx, why);
      counts[why] = (counts[why] ?? 0) + 1;
    }
  };

  fc.features.forEach((feature, idx) => {
    const props = (feature.properties ?? {}) as Record<string, unknown>;
    const views = sideViews(props);
    if (views.length === 0) return;
    take(idx, 'base');
    for (const v of views) {
      const from = leadingInt(v.fromHn);
      const to = leadingInt(v.toHn);
      if (from !== null && to !== null && from > to) take(idx, 'descending');
      if (from !== null && to !== null && from === to) take(idx, 'singleHn');
      if (v.parity.toUpperCase() === 'B') take(idx, 'parityB');
      if (v.parity.toUpperCase() === 'O') take(idx, 'parityO');
      if (v.parity.toUpperCase() === 'E') take(idx, 'parityE');
      if (/\d[-/]\d|[A-Za-z]/.test(v.fromHn + v.toHn)) take(idx, 'nonNumericHn');
    }
  });

  const KEEP_PROPS = [
    'TLID', 'FULLNAME',
    'LFROMHN', 'LTOHN', 'RFROMHN', 'RTOHN',
    'ZIPL', 'ZIPR', 'PARITYL', 'PARITYR',
  ];
  const features = [...picked.keys()]
    .sort((a, b) => a - b)
    .map((idx) => {
      const f = fc.features[idx];
      const props = (f.properties ?? {}) as Record<string, unknown>;
      const kept: Record<string, unknown> = {};
      for (const k of KEEP_PROPS) kept[k] = props[k] ?? null;
      return {
        type: 'Feature' as const,
        properties: kept,
        geometry: f.geometry,
        selectedBecause: picked.get(idx),
      };
    });

  const fixture = {
    provenance: {
      description:
        'Deterministic extract from a REAL TIGER ADDRFEAT county file, produced by scripts/extract-addrfeat-fixture.ts. Do not hand-edit — re-run the script.',
      sourceUrl: url,
      sourceSha256,
      sourceBytes: buf.length,
      countyFips: args.county,
      vintage: args.vintage,
      totalFeaturesInSource: fc.features.length,
      selectionCounts: counts,
      extractedFeatures: features.length,
    },
    type: 'FeatureCollection' as const,
    features,
  };

  mkdirSync(dirname(args.output), { recursive: true });
  writeFileSync(args.output, JSON.stringify(fixture, null, 1));
  const outBytes = statSync(args.output).size;
  console.log(
    `Fixture: ${args.output} (${features.length} features, ${(outBytes / 1024).toFixed(1)} KB)`
  );
  console.log(`Selection: ${JSON.stringify(counts)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
