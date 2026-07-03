#!/usr/bin/env tsx
/**
 * Address-Assertion Verifier — SEAM-CONTRACT v1 §6 (producer side)
 *
 * Re-derives every entry of the committed assertion corpus
 * (`src/__tests__/fixtures/address-index-assertions.json`) against a built
 * address-index sample tree, using an INDEPENDENT re-implementation of the
 * §3 normalization algorithm and the §2 match ladder — no imports from
 * `src/distribution/addresses/*` (the producer emit path) and no coupling to
 * the commons consumer geocoder. This is the re-implementation the corpus's
 * `verification` field claims: the expected coordinates are re-derivable and
 * falsifiable on any machine that has the sample tree.
 *
 * What it checks (ALL must pass; any failure exits 1):
 *   1. Corpus shape: version 1, schema `atlas-address-index-assertions`,
 *      normVersion 1, ≥25 assertions, ≥1 MUST-MISS.
 *   2. Sample integrity prechecks: `US/manifest.json` has an addressIndex
 *      section (schemaVersion 1, normVersion matching the corpus);
 *      `normalization.json` byte-length + sha256 match the manifest pin.
 *   3. Published-copy sync: when `<sample>/assertions.json` exists it must be
 *      deep-equal to the committed corpus (the published gate input may never
 *      drift from the committed canon).
 *   4. Every assertion: run the ladder over the sample chunks; matchClass
 *      must match, coordinates must be within `tolDeg`; MUST-MISS entries
 *      must produce NO result (a miss is never converted to a coordinate).
 *
 * Regenerating expected values: `--print-derived` prints the ladder's derived
 * outcome for every input. When a source-vintage rebuild legitimately moves
 * coordinates, hand-re-verify the moved entries, update the COMMITTED corpus
 * first, then copy it into the sample tree (see sample/address-index/README.md).
 *
 * Usage:
 *   npx tsx scripts/verify-address-assertions.ts <sampleRoot> [options]
 *   npx tsx scripts/verify-address-assertions.ts --sample sample/address-index/v1
 *
 * Options:
 *   --sample <dir>       Sample root (the directory containing `US/`)
 *   --assertions <path>  Corpus path (default: the committed fixture)
 *   --print-derived      Print the derived outcome for every assertion
 *   --json               Machine-readable output
 *
 * Exit codes: 0 all pass; 1 any failure; 2 usage error.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================================
// Types (schema mirrors of the published artifacts — deliberately local)
// ============================================================================

interface AssertionEntry {
  label: string;
  covers: string[];
  input: { street: string; city: string; state: string; postalcode: string };
  expect: { matchClass: string; lat?: number; lng?: number; tolDeg?: number };
}

interface AssertionsDoc {
  version: number;
  schema: string;
  normVersion: number;
  states: string[];
  assertions: AssertionEntry[];
}

interface NormalizationJson {
  normVersion: number;
  directionals: Record<string, string>;
  suffixes: Record<string, string>;
  units: string[];
  unitsWithoutValue: string[];
}

/** §2 chunk records: p = { hnKey: [lat, lng, src] }, r = [fromHn, toHn, parity, fromLat, fromLng, toLat, toLng][] */
interface StreetRecord {
  p?: Record<string, [number, number, number]>;
  r?: [number, number, string, number, number, number, number][];
}

interface AddressChunk {
  version: number;
  schema: string;
  country: string;
  zip: string;
  state: string;
  zipCentroid: [number, number];
  streets: Record<string, StreetRecord>;
}

interface ManifestAddressIndex {
  schemaVersion: number;
  normVersion: number;
  normTable: { path: string; sha256: string; bytes: number };
  totalChunks: number;
  chunkIndex: { path: string; sha256: string; bytes: number };
}

interface DerivedOutcome {
  matchClass: 'point' | 'range' | 'zip' | 'miss';
  lat?: number;
  lng?: number;
}

interface AssertionResult {
  label: string;
  pass: boolean;
  expected: AssertionEntry['expect'];
  derived: DerivedOutcome;
  detail?: string;
}

// ============================================================================
// §3 street-line normalization — independent re-implementation.
// The ALGORITHM is normative contract text; the TABLES come from the sample's
// shipped `normalization.json` (never vendored here).
// ============================================================================

/** House-number token: digits, hyphenated (112-10), or fractional (1/2). */
const HOUSE_NUMBER_TOKEN = /^\d+(-\d+)?$|^\d+\/\d+$/;

/** Secondary-unit VALUE token (`5`, `200B`, `#4`, `B`) — never a street word. */
const UNIT_VALUE_TOKEN = /^#?\d[\dA-Z/-]*$|^[A-Z]$/;

function normalizeStreet(input: string, table: NormalizationJson): string {
  const units = new Set(table.units);
  const unitsWithoutValue = new Set(table.unitsWithoutValue);

  // 1. NFD → strip combining marks → ASCII uppercase.
  let s = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

  // 2. Strip `.` `,` `'`; collapse whitespace; trim.
  s = s.replace(/[.,']/g, '').replace(/\s+/g, ' ').trim();

  // 3. Tokenize; trim token-edge hyphens; strip leading house-number token(s).
  let tokens = s
    .split(' ')
    .map((t) => t.replace(/^-+|-+$/g, ''))
    .filter((t) => t.length > 0);

  while (tokens.length > 1 && HOUSE_NUMBER_TOKEN.test(tokens[0])) {
    tokens = tokens.slice(1);
  }

  // 4. Strip trailing secondary-unit designator + value, plus trailing bare
  //    value-less designators.
  let stripped = true;
  while (stripped && tokens.length > 1) {
    stripped = false;
    const last = tokens[tokens.length - 1];
    const prev = tokens.length >= 2 ? tokens[tokens.length - 2] : undefined;
    if (last.startsWith('#') && last.length > 1) {
      tokens = tokens.slice(0, -1);
      stripped = true;
    } else if (
      prev !== undefined &&
      tokens.length > 2 &&
      units.has(prev) &&
      UNIT_VALUE_TOKEN.test(last)
    ) {
      tokens = tokens.slice(0, -2);
      stripped = true;
    } else if (unitsWithoutValue.has(last)) {
      tokens = tokens.slice(0, -1);
      stripped = true;
    }
  }

  // 5. Directionals in leading and trailing position.
  if (tokens.length > 1) {
    const lead = table.directionals[tokens[0]];
    if (lead !== undefined) tokens[0] = lead;
  }
  if (tokens.length > 1) {
    const trail = table.directionals[tokens[tokens.length - 1]];
    if (trail !== undefined) tokens[tokens.length - 1] = trail;
  }

  // 6. Suffix table on the final token — or second-to-last when the final
  //    token is a mapped trailing directional (Pub 28 keeps directionals last).
  if (tokens.length > 1) {
    const lastIdx = tokens.length - 1;
    const isTrailingDirectional = table.directionals[tokens[lastIdx]] !== undefined;
    const suffixIdx = isTrailingDirectional && tokens.length > 2 ? lastIdx - 1 : lastIdx;
    if (suffixIdx > 0) {
      const mapped = table.suffixes[tokens[suffixIdx]];
      if (mapped !== undefined) tokens[suffixIdx] = mapped;
    }
  }

  // 7. Join with single spaces.
  return tokens.join(' ');
}

/**
 * House-number key (§2): leading house-number token(s) of the raw street
 * line, leading zeros stripped from the leading integer segment only;
 * hyphenated and fractional forms kept literally. Null when absent.
 */
function houseNumberKeyOf(rawStreet: string): string | null {
  const tokens = rawStreet
    .toUpperCase()
    .replace(/[.,']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ');

  const parts: string[] = [];
  for (const token of tokens) {
    if (HOUSE_NUMBER_TOKEN.test(token)) parts.push(token);
    else break;
  }
  if (parts.length === 0) return null;
  return parts.join(' ').replace(/^0+(?=\d)/, '');
}

/** Leading-integer parse for range comparison (§2). */
function parseLeadingInteger(houseNumberKey: string): number | null {
  const m = houseNumberKey.match(/^(\d+)/);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isSafeInteger(n) ? n : null;
}

// ============================================================================
// §2 match ladder — independent re-implementation
// ============================================================================

/** Round to the contract's pinned 5 decimal places (~1.1 m). */
function round5(v: number): number {
  return Math.round(v * 1e5) / 1e5;
}

function runMatchLadder(
  chunk: AddressChunk,
  normalizedStreet: string,
  houseNumberKey: string | null,
): DerivedOutcome {
  const record = chunk.streets[normalizedStreet];

  if (record && houseNumberKey !== null) {
    // Rung 1: exact point key.
    const point = record.p?.[houseNumberKey];
    if (point) {
      return { matchClass: 'point', lat: point[0], lng: point[1] };
    }

    // Rung 2: parity-matched range interpolation. Eligibility: `E`/`O` per
    // house-number parity, `B` always. Multiple hits → smallest span
    // (toHn − fromHn), tie → lowest fromHn.
    const hn = parseLeadingInteger(houseNumberKey);
    if (hn !== null && record.r) {
      const parityOfHn = hn % 2 === 0 ? 'E' : 'O';
      const hits = record.r.filter(
        ([fromHn, toHn, parity]) =>
          hn >= fromHn && hn <= toHn && (parity === 'B' || parity === parityOfHn),
      );
      if (hits.length > 0) {
        hits.sort((a, b) => (a[1] - a[0]) - (b[1] - b[0]) || a[0] - b[0]);
        const [fromHn, toHn, , fromLat, fromLng, toLat, toLng] = hits[0];
        // Pinned interpolation: t = (hn − fromHn)/(toHn − fromHn); 0.5 when
        // the range is a single number; round to 5 dp.
        const t = toHn === fromHn ? 0.5 : (hn - fromHn) / (toHn - fromHn);
        return {
          matchClass: 'range',
          lat: round5(fromLat + t * (toLat - fromLat)),
          lng: round5(fromLng + t * (toLng - fromLng)),
        };
      }
    }
  }

  // Rung 3: ZIP centroid — honest locality-grade fallback.
  return { matchClass: 'zip', lat: chunk.zipCentroid[0], lng: chunk.zipCentroid[1] };
}

/**
 * Resolve one assertion input against the sample tree. A miss is structural:
 * no ZIP5 derivable, or no chunk file for the ZIP. A chunk that exists but
 * fails to parse is a corrupt sample — thrown, never counted as a miss.
 */
function deriveOutcome(
  sampleRoot: string,
  input: AssertionEntry['input'],
  normTable: NormalizationJson,
): DerivedOutcome {
  const zip5 = input.postalcode.trim().match(/^(\d{5})/)?.[1] ?? null;
  if (zip5 === null) return { matchClass: 'miss' };

  const chunkPath = join(sampleRoot, 'US', 'addresses', `${zip5}.json`);
  if (!existsSync(chunkPath)) return { matchClass: 'miss' };

  const chunk = JSON.parse(readFileSync(chunkPath, 'utf-8')) as AddressChunk;
  if (chunk.version !== 1 || chunk.schema !== 'atlas-address-index' || chunk.zip !== zip5) {
    throw new Error(`Corrupt chunk ${zip5}.json: version/schema/zip mismatch`);
  }
  if (!Array.isArray(chunk.zipCentroid) || chunk.zipCentroid.length !== 2) {
    throw new Error(`Corrupt chunk ${zip5}.json: bad zipCentroid`);
  }

  const normalizedStreet =
    input.street.trim() === '' ? '' : normalizeStreet(input.street, normTable);
  if (normalizedStreet === '') {
    return { matchClass: 'zip', lat: chunk.zipCentroid[0], lng: chunk.zipCentroid[1] };
  }

  return runMatchLadder(chunk, normalizedStreet, houseNumberKeyOf(input.street));
}

// ============================================================================
// Integrity prechecks
// ============================================================================

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Deep JSON equality (order-insensitive for objects, sensitive for arrays). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a !== null && b !== null && typeof a === 'object') {
    const ka = Object.keys(a as object).sort();
    const kb = Object.keys(b as object).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    return ka.every((k) =>
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}

// ============================================================================
// Main
// ============================================================================

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ASSERTIONS = join(
  SCRIPT_DIR,
  '..',
  'src',
  '__tests__',
  'fixtures',
  'address-index-assertions.json',
);

function usage(error: string): never {
  console.error(`Error: ${error}\n`);
  console.error(
    'Usage: tsx scripts/verify-address-assertions.ts <sampleRoot> [--assertions <path>] [--print-derived] [--json]',
  );
  process.exit(2);
}

function main(): void {
  const args = process.argv.slice(2);
  let sampleRoot = '';
  let assertionsPath = DEFAULT_ASSERTIONS;
  let printDerived = false;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--sample') {
      const v = args[++i];
      if (!v) usage('--sample requires a value');
      sampleRoot = v;
    } else if (arg === '--assertions') {
      const v = args[++i];
      if (!v) usage('--assertions requires a value');
      assertionsPath = v;
    } else if (arg === '--print-derived') {
      printDerived = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg.startsWith('-')) {
      usage(`Unknown flag: ${arg}`);
    } else if (!sampleRoot) {
      sampleRoot = arg;
    } else {
      usage(`Unexpected argument: ${arg}`);
    }
  }

  if (!sampleRoot) usage('Missing required argument: sampleRoot');
  sampleRoot = resolve(sampleRoot);
  if (!existsSync(join(sampleRoot, 'US', 'manifest.json'))) {
    usage(`Not a sample root (no US/manifest.json): ${sampleRoot}`);
  }
  if (!existsSync(assertionsPath)) {
    usage(`Assertions corpus not found: ${assertionsPath}`);
  }

  const integrityFailures: string[] = [];

  // ---- 1. Corpus shape ----
  const corpus = JSON.parse(readFileSync(assertionsPath, 'utf-8')) as AssertionsDoc;
  if (corpus.version !== 1) integrityFailures.push(`corpus version=${corpus.version}, expected 1`);
  if (corpus.schema !== 'atlas-address-index-assertions') {
    integrityFailures.push(`corpus schema="${corpus.schema}", expected atlas-address-index-assertions`);
  }
  if (corpus.normVersion !== 1) {
    integrityFailures.push(`corpus normVersion=${corpus.normVersion}, expected 1`);
  }
  if (!Array.isArray(corpus.assertions) || corpus.assertions.length < 25) {
    integrityFailures.push(`corpus has ${corpus.assertions?.length ?? 0} assertions, §6 requires ≥25`);
  }
  const missCount = (corpus.assertions ?? []).filter((a) => a.expect.matchClass === 'miss').length;
  if (missCount < 1) integrityFailures.push('corpus has no MUST-MISS assertion, §6 requires ≥1');

  // ---- 2. Sample integrity prechecks ----
  const manifest = JSON.parse(readFileSync(join(sampleRoot, 'US', 'manifest.json'), 'utf-8')) as {
    addressIndex?: ManifestAddressIndex;
  };
  const ai = manifest.addressIndex;
  if (!ai) {
    integrityFailures.push('US/manifest.json has no addressIndex section');
  } else {
    if (ai.schemaVersion !== 1) {
      integrityFailures.push(`manifest addressIndex.schemaVersion=${ai.schemaVersion}, expected 1`);
    }
    if (ai.normVersion !== corpus.normVersion) {
      integrityFailures.push(
        `normVersion skew: manifest=${ai.normVersion}, corpus=${corpus.normVersion}`,
      );
    }
    const normPath = join(sampleRoot, 'US', ai.normTable.path);
    if (!existsSync(normPath)) {
      integrityFailures.push(`normalization table missing: ${ai.normTable.path}`);
    } else {
      const buf = readFileSync(normPath);
      if (buf.length !== ai.normTable.bytes) {
        integrityFailures.push(
          `normalization.json bytes=${buf.length}, manifest pins ${ai.normTable.bytes}`,
        );
      }
      const hash = sha256Hex(buf);
      if (hash !== ai.normTable.sha256) {
        integrityFailures.push(
          `normalization.json sha256 mismatch: ${hash} != pinned ${ai.normTable.sha256}`,
        );
      }
    }
  }

  // ---- 3. Published-copy sync ----
  const publishedPath = join(sampleRoot, 'assertions.json');
  if (existsSync(publishedPath)) {
    const published = JSON.parse(readFileSync(publishedPath, 'utf-8'));
    if (!deepEqual(published, corpus)) {
      integrityFailures.push(
        `published ${publishedPath} differs from the committed corpus — ` +
          'copy the committed canon over it (the gate input must never drift)',
      );
    }
  }

  if (integrityFailures.length > 0) {
    if (json) {
      console.log(JSON.stringify({ passed: false, integrityFailures }, null, 2));
    } else {
      console.error('\nINTEGRITY PRECHECKS FAILED:');
      for (const f of integrityFailures) console.error(`  - ${f}`);
    }
    process.exit(1);
  }

  // ---- 4. Re-derive every assertion ----
  const normTablePath = join(sampleRoot, 'US', ai!.normTable.path);
  const normTable = JSON.parse(readFileSync(normTablePath, 'utf-8')) as NormalizationJson;

  const results: AssertionResult[] = [];
  for (const assertion of corpus.assertions) {
    const derived = deriveOutcome(sampleRoot, assertion.input, normTable);
    const exp = assertion.expect;
    let pass: boolean;
    let detail: string | undefined;

    if (exp.matchClass === 'miss') {
      pass = derived.matchClass === 'miss';
      if (!pass) {
        detail = `expected MISS, ladder produced ${derived.matchClass} (${derived.lat}, ${derived.lng})`;
      }
    } else if (derived.matchClass !== exp.matchClass) {
      pass = false;
      detail = `matchClass: expected ${exp.matchClass}, derived ${derived.matchClass}`;
    } else {
      const tol = exp.tolDeg ?? 0;
      const dLat = Math.abs((derived.lat ?? Number.NaN) - (exp.lat ?? Number.NaN));
      const dLng = Math.abs((derived.lng ?? Number.NaN) - (exp.lng ?? Number.NaN));
      pass = dLat <= tol && dLng <= tol;
      if (!pass) {
        detail = `coords off: derived (${derived.lat}, ${derived.lng}) vs expected (${exp.lat}, ${exp.lng}) tol ${tol}`;
      }
    }
    results.push({ label: assertion.label, pass, expected: exp, derived, detail });
  }

  const passed = results.filter((r) => r.pass).length;
  const allPassed = passed === results.length;

  if (json) {
    console.log(
      JSON.stringify(
        { passed: allPassed, total: results.length, verified: passed, results },
        null,
        2,
      ),
    );
  } else {
    console.log(`\nAssertion corpus: ${assertionsPath}`);
    console.log(`Sample tree:      ${sampleRoot}\n`);
    for (const r of results) {
      const mark = r.pass ? 'PASS' : 'FAIL';
      console.log(`  [${mark}] ${r.label}`);
      if (printDerived || !r.pass) {
        const d = r.derived;
        console.log(
          `         derived: ${d.matchClass}${d.lat !== undefined ? ` (${d.lat}, ${d.lng})` : ''}${r.detail ? ` — ${r.detail}` : ''}`,
        );
      }
    }
    console.log(`\n${passed}/${results.length} assertions verified${allPassed ? '' : ' — CORPUS NOT SATISFIED'}\n`);
  }

  process.exit(allPassed ? 0 : 1);
}

main();
