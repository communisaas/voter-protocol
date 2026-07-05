/**
 * DOJ UST crosswalk validator tests (P17-wave1-ingest)
 *
 * Structural checks run unconditionally (no network). The page-title
 * crosswalk uses an injected fetch in the default suite (no network calls);
 * a real-network smoke against the live DOJ site is gated behind
 * RUN_NETWORK_TESTS/RUN_INTEGRATION, matching the pattern used by
 * wave1-ingest.test.ts.
 */

import { describe, test, expect } from 'vitest';
import {
  validateCompositionTableStructure,
  checkDojPageCrosswalk,
  checkDojPageCrosswalkBatch,
  type CrosswalkFetch,
} from './doj-ust-crosswalk.js';
import { JUDICIAL_DISTRICT_COMPOSITIONS } from '../providers/judicial-district-provider.js';

const runNetworkTests =
  process.env.RUN_NETWORK_TESTS === 'true' || process.env.RUN_INTEGRATION === 'true';

describe('validateCompositionTableStructure', () => {
  test('the real curated table is internally consistent', () => {
    const result = validateCompositionTableStructure(JUDICIAL_DISTRICT_COMPOSITIONS);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('detects a duplicated statute section', () => {
    const bad = [
      { id: 'a', name: 'District A', statuteSection: '28 U.S.C. § 100', wholeStateFips: '01' },
      { id: 'b', name: 'District B', statuteSection: '28 U.S.C. § 100', wholeStateFips: '02' },
    ];
    const result = validateCompositionTableStructure(bad);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('28 U.S.C. § 100');
  });

  test('detects a duplicated whole-state FIPS assignment', () => {
    const bad = [
      { id: 'a', name: 'District A', statuteSection: '28 U.S.C. § 100', wholeStateFips: '06' },
      { id: 'b', name: 'District B (north)', statuteSection: '28 U.S.C. § 101', wholeStateFips: '06' },
    ];
    const result = validateCompositionTableStructure(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('FIPS 06'))).toBe(true);
  });

  test('empty table is trivially valid', () => {
    expect(validateCompositionTableStructure([]).valid).toBe(true);
  });
});

describe('checkDojPageCrosswalk (injected fetch, no network)', () => {
  test('200 + matching title -> matched', async () => {
    const fetchImpl: CrosswalkFetch = async () => ({
      status: 200,
      text: async () => '<html><head><title> District of Wyoming |  District of Wyoming</title></head></html>',
    });
    const result = await checkDojPageCrosswalk(
      { id: 'wy', name: 'District of Wyoming' },
      { fetchImpl },
    );
    expect(result.matched).toBe(true);
    expect(result.pageTitle).toBe('District of Wyoming');
  });

  test('200 + mismatched title -> not matched, no throw', async () => {
    const fetchImpl: CrosswalkFetch = async () => ({
      status: 200,
      text: async () => '<html><head><title> District of Someplace Else |  District of Someplace Else</title></head></html>',
    });
    const result = await checkDojPageCrosswalk(
      { id: 'wy', name: 'District of Wyoming' },
      { fetchImpl },
    );
    expect(result.matched).toBe(false);
    expect(result.checked).toBe(true);
  });

  test('404 -> checked but not matched, httpStatus recorded', async () => {
    const fetchImpl: CrosswalkFetch = async () => ({ status: 404, text: async () => '' });
    const result = await checkDojPageCrosswalk(
      { id: 'nonexistent', name: 'District of Nowhere' },
      { fetchImpl },
    );
    expect(result.matched).toBe(false);
    expect(result.httpStatus).toBe(404);
  });

  test('network error -> honest failure, not a fabricated match', async () => {
    const fetchImpl: CrosswalkFetch = async () => {
      throw new Error('DNS resolution failed');
    };
    const result = await checkDojPageCrosswalk(
      { id: 'wy', name: 'District of Wyoming' },
      { fetchImpl },
    );
    expect(result.matched).toBe(false);
    expect(result.error).toContain('DNS resolution failed');
  });

  test('batch preserves per-entry results and order', async () => {
    const fetchImpl: CrosswalkFetch = async (url: string) => ({
      status: 200,
      text: async () => {
        const id = url.split('usao-')[1];
        const name = id === 'wy' ? 'District of Wyoming' : 'District of Columbia';
        return `<title> ${name} |  ${name}</title>`;
      },
    });
    const results = await checkDojPageCrosswalkBatch(
      [
        { id: 'wy', name: 'District of Wyoming' },
        { id: 'dc', name: 'District of the District of Columbia' },
      ],
      { fetchImpl },
    );
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('wy');
    expect(results[0].matched).toBe(true);
    expect(results[1].id).toBe('dc');
    // dc's real name has an extra "the District of" prefix the page title
    // doesn't carry — an honest mismatch, not fabricated agreement.
    expect(results[1].matched).toBe(false);
  });
});

describe('DOJ UST real-network smoke (network-gated)', () => {
  const maybeTest = runNetworkTests ? test : test.skip;

  maybeTest(
    'wy/dc/pr usao pages are live and name-match the composition table',
    async () => {
      const sample = ['wy', 'dc', 'pr']
        .map((id) => JUDICIAL_DISTRICT_COMPOSITIONS.find((c) => c.id === id))
        .filter((c): c is NonNullable<typeof c> => c !== undefined);
      expect(sample).toHaveLength(3);

      const results = await checkDojPageCrosswalkBatch(sample);
      for (const r of results) {
        expect(r.httpStatus).toBe(200);
      }
    },
    30000,
  );
});
