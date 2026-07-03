import { describe, it, expect } from 'vitest';
import {
  normalizeStreet,
  normalizeHouseNumberKey,
  parseLeadingInteger,
  tablesFromJson,
  buildNormalizationJson,
} from '../../../distribution/addresses/normalize.js';
import {
  NORM_VERSION,
  UNITS_WITHOUT_VALUE,
  type NormalizationJson,
} from '../../../distribution/addresses/normalization-table.js';
import { loadFixture } from './fixture.js';

/**
 * SEAM-CONTRACT v1 §3 normalizer. Idempotence is the HARD contract property:
 * `norm(norm(x)) === norm(x)` for every input, because the consumer re-runs
 * the same algorithm over user-typed street lines and must land on the same
 * chunk keys the producer emitted.
 */
describe('address normalization (§3)', () => {
  const fixture = loadFixture();

  it('is driven by a real-county extract (provenance sanity)', () => {
    expect(fixture.provenance.sourceUrl).toMatch(
      /^https:\/\/www2\.census\.gov\/geo\/tiger\/TIGER20\d{2}\/ADDRFEAT\/tl_20\d{2}_\d{5}_addrfeat\.zip$/
    );
    expect(fixture.provenance.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(fixture.features.length).toBeGreaterThan(100);
  });

  it('norm(norm(x)) === norm(x) for every real street name in the extract', () => {
    let checked = 0;
    for (const f of fixture.features) {
      const name = f.properties.FULLNAME;
      if (!name) continue;
      const once = normalizeStreet(name);
      expect(normalizeStreet(once)).toBe(once);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('idempotence holds for targeted §3 shapes (units, directionals, suffixes, numbers)', () => {
    const inputs = [
      '123 MAIN STREET APT 5',
      '1600 Pennsylvania Avenue NW',
      'NORTH BROADWAY',
      "O'Connor Street",
      'Cañada Road',
      '112-10 Northern Blvd',
      '123 1/2 South East Street',
      'MLK Jr. Blvd',
      'AVENUE B',
      'COUNTY ROAD 12',
      'SUNSET TRAILER',
      'MAIN ST STE 200B',
      'MAIN ST # 4',
      'MAIN ST #4B',
      'ELM STREET REAR',
    ];
    for (const input of inputs) {
      const once = normalizeStreet(input);
      expect(normalizeStreet(once)).toBe(once);
    }
  });

  it('strips trailing secondary units (Pub 28 C2) so units never enter the street key', () => {
    expect(normalizeStreet('123 MAIN STREET APT 5')).toBe('MAIN ST');
    expect(normalizeStreet('MAIN STREET SUITE 200')).toBe('MAIN ST');
    expect(normalizeStreet('MAIN ST STE 200B')).toBe('MAIN ST');
    expect(normalizeStreet('MAIN ST UNIT B')).toBe('MAIN ST');
    expect(normalizeStreet('MAIN ST #4B')).toBe('MAIN ST');
    expect(normalizeStreet('MAIN ST # 4')).toBe('MAIN ST');
    expect(normalizeStreet('ELM STREET REAR')).toBe('ELM ST');
    // A street NAMED Trailer Lane is not a unit designator + value.
    expect(normalizeStreet('TRAILER LANE')).toBe('TRAILER LN');
  });

  it('maps leading and trailing directionals (Pub 28 B)', () => {
    expect(normalizeStreet('NORTH MAIN STREET')).toBe('N MAIN ST');
    expect(normalizeStreet('1600 Pennsylvania Avenue NORTHWEST')).toBe('PENNSYLVANIA AVE NW');
    expect(normalizeStreet('SOUTHWEST 8TH AVENUE')).toBe('SW 8TH AVE');
    // A bare directional street name is never collapsed away.
    expect(normalizeStreet('BROADWAY')).toBe('BROADWAY');
  });

  it('maps the final token through the suffix table (Pub 28 C1)', () => {
    expect(normalizeStreet('COMMERCE BOULEVARD')).toBe('COMMERCE BLVD');
    expect(normalizeStreet('RIVER AV')).toBe('RIVER AVE');
    expect(normalizeStreet('GARDEN CIRCLE')).toBe('GARDEN CIR');
    expect(normalizeStreet('OLD MILL CRSSNG')).toBe('OLD MILL XING');
    // Suffix ahead of a trailing directional still normalizes.
    expect(normalizeStreet('BAY AVENUE NORTH')).toBe('BAY AVE N');
  });

  it('strips punctuation and diacritics per §3 rules 1–2', () => {
    expect(normalizeStreet("O'Connor St.")).toBe('OCONNOR ST');
    expect(normalizeStreet('Cañada Road')).toBe('CANADA RD');
    expect(normalizeStreet('St. Marys   Ave,')).toBe('ST MARYS AVE');
  });

  it('strips leading house-number tokens (digits, hyphenated, fractional)', () => {
    expect(normalizeStreet('123 MAIN ST')).toBe('MAIN ST');
    expect(normalizeStreet('112-10 NORTHERN BLVD')).toBe('NORTHERN BLVD');
    expect(normalizeStreet('123 1/2 ELM ST')).toBe('ELM ST');
    // Ordinal street names are NOT house numbers.
    expect(normalizeStreet('5TH AVENUE')).toBe('5TH AVE');
  });

  it('keeps hyphenated/fractional house numbers literal as point keys (§2)', () => {
    expect(normalizeHouseNumberKey('112-10')).toBe('112-10');
    expect(normalizeHouseNumberKey('123 1/2')).toBe('123 1/2');
    expect(normalizeHouseNumberKey('007')).toBe('7');
    expect(normalizeHouseNumberKey('007-10')).toBe('7-10');
    expect(normalizeHouseNumberKey('  42  ')).toBe('42');
    expect(normalizeHouseNumberKey('')).toBeNull();
    expect(normalizeHouseNumberKey('N/A')).toBeNull();
  });

  it('parses the leading integer only for range comparison (§2)', () => {
    expect(parseLeadingInteger('112-10')).toBe(112);
    expect(parseLeadingInteger('123 1/2')).toBe(123);
    expect(parseLeadingInteger('42')).toBe(42);
    expect(parseLeadingInteger('B42')).toBeNull();
    expect(parseLeadingInteger('')).toBeNull();
  });

  it('ships unitsWithoutValue in normalization.json and the normalizer consumes the LOADED set (§3 amended step 4 — no vendored fallback)', () => {
    const shipped = buildNormalizationJson();
    expect(Array.isArray(shipped.unitsWithoutValue)).toBe(true);
    expect(new Set(shipped.unitsWithoutValue)).toEqual(UNITS_WITHOUT_VALUE);
    // Every value-less designator is also a recognized designator token.
    for (const u of shipped.unitsWithoutValue) {
      expect(shipped.units).toContain(u);
    }
    // No hidden vendored fallback: a synthetic table that does NOT ship the
    // set must change behavior — the bare designator survives unstripped.
    const gutted = JSON.parse(JSON.stringify(shipped)) as Record<string, unknown>;
    delete gutted['unitsWithoutValue'];
    const tables = tablesFromJson(gutted as unknown as NormalizationJson);
    expect(normalizeStreet('ELM STREET REAR', tables)).toBe('ELM STREET REAR');
    expect(normalizeStreet('ELM STREET REAR')).toBe('ELM ST');
  });

  it("keys 'PENNSYLVANIA AVENUE NORTHWEST' and 'PENNSYLVANIA AVE NW' identically (§3 amended step 6 — trailing directional)", () => {
    const long = normalizeStreet('PENNSYLVANIA AVENUE NORTHWEST');
    const short = normalizeStreet('PENNSYLVANIA AVE NW');
    expect(long).toBe(short);
    expect(short).toBe('PENNSYLVANIA AVE NW');
    // Idempotent fixed point on the shared key.
    expect(normalizeStreet(long)).toBe(long);
  });

  it('the shipped normalization.json round-trips into the identical normalizer (normVersion handshake)', () => {
    const shipped = buildNormalizationJson();
    expect(shipped.normVersion).toBe(NORM_VERSION);
    expect(Array.isArray(shipped.units)).toBe(true);
    const tables = tablesFromJson(JSON.parse(JSON.stringify(shipped)));
    for (const f of fixture.features) {
      const name = f.properties.FULLNAME;
      if (!name) continue;
      expect(normalizeStreet(name, tables)).toBe(normalizeStreet(name));
    }
  });
});
