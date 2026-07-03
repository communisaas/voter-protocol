import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * SEAM-CONTRACT v1 §6 — the acceptance-assertion corpus is COMMITTED at
 * `src/__tests__/fixtures/address-index-assertions.json` (canonical), copied
 * byte-for-byte into the published sample tree before upload, and re-derived
 * against any built sample by `scripts/verify-address-assertions.ts` (an
 * independent §2/§3 re-implementation — the corpus is falsifiable on any
 * machine, not just where the gitignored sample happens to live).
 *
 * This suite guards the CORPUS itself: gate-input arithmetic (≥25 entries,
 * MUST-MISS present), the §6 coverage classes, and structural well-formedness
 * — all machine-checkable without the sample tree. Coordinate truth is the
 * verifier script's job.
 */

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const CORPUS_PATH = join(TEST_DIR, '..', '..', 'fixtures', 'address-index-assertions.json');
const SAMPLE_COPY_PATH = join(
  TEST_DIR,
  '..', '..', '..', '..',
  'sample', 'address-index', 'v1', 'assertions.json',
);

interface AssertionEntry {
  label: string;
  covers: string[];
  input: { street: string; city: string; state: string; postalcode: string };
  expect: { matchClass: string; lat?: number; lng?: number; tolDeg?: number };
}

interface AssertionsDoc {
  version: number;
  schema: string;
  contract: string;
  normVersion: number;
  states: string[];
  verification: string;
  assertions: AssertionEntry[];
}

const corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf-8')) as AssertionsDoc;

describe('address-index assertion corpus (committed §6 gate input)', () => {
  it('declares the contract envelope: version 1, assertion schema, normVersion 1', () => {
    expect(corpus.version).toBe(1);
    expect(corpus.schema).toBe('atlas-address-index-assertions');
    expect(corpus.contract).toContain('§6');
    expect(corpus.normVersion).toBe(1);
    expect(corpus.states).toEqual(expect.arrayContaining(['DE', 'RI', 'DC']));
    // The re-derivability claim the verifier script makes good on.
    expect(corpus.verification).toContain('independent re-implementation');
  });

  it('satisfies the §6 gate-input arithmetic: ≥25 assertions, ≥1 MUST-MISS', () => {
    expect(corpus.assertions.length).toBeGreaterThanOrEqual(25);
    const misses = corpus.assertions.filter((a) => a.expect.matchClass === 'miss');
    expect(misses.length).toBeGreaterThanOrEqual(1);
  });

  it('covers every §6 class: point, range (all three parities), zip-centroid, must-miss, and the normalization variants', () => {
    const covered = new Set(corpus.assertions.flatMap((a) => a.covers));
    for (const cls of [
      'point',
      'range',
      'parity-E',
      'parity-O',
      'parity-B',
      'zip-centroid',
      'must-miss',
      'directional',
      'suffix',
      'unit-strip',
      'fractional-hn',
    ]) {
      expect(covered, `missing coverage class: ${cls}`).toContain(cls);
    }
  });

  it('every assertion is structurally well-formed and labeled uniquely', () => {
    const labels = new Set<string>();
    for (const a of corpus.assertions) {
      expect(a.label.length).toBeGreaterThan(0);
      expect(labels.has(a.label), `duplicate label: ${a.label}`).toBe(false);
      labels.add(a.label);

      expect(a.covers.length).toBeGreaterThan(0);
      expect(a.input.street.length).toBeGreaterThan(0);
      expect(a.input.postalcode.length).toBeGreaterThan(0);

      if (a.expect.matchClass === 'miss') {
        // A miss is a miss — it never carries a fabricated coordinate.
        expect(a.expect.lat).toBeUndefined();
        expect(a.expect.lng).toBeUndefined();
      } else {
        expect(['point', 'range', 'zip']).toContain(a.expect.matchClass);
        expect(Number.isFinite(a.expect.lat)).toBe(true);
        expect(Number.isFinite(a.expect.lng)).toBe(true);
        expect(a.expect.tolDeg).toBeGreaterThan(0);
        // Sample states only — the corpus never asserts outside DE/RI/DC.
        expect(corpus.states).toContain(a.input.state);
        // Non-miss inputs must carry a derivable ZIP5.
        expect(a.input.postalcode).toMatch(/^\d{5}/);
      }
    }
  });

  // The sample tree is gitignored (regenerable chunks + this published copy);
  // when it exists locally, the published copy must not drift from the canon.
  it.skipIf(!existsSync(SAMPLE_COPY_PATH))(
    'published sample copy is identical to the committed corpus',
    () => {
      const published = JSON.parse(readFileSync(SAMPLE_COPY_PATH, 'utf-8'));
      expect(published).toEqual(corpus);
    },
  );
});
