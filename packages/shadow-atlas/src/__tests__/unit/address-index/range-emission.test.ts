import { describe, it, expect } from 'vitest';
import {
  emitSideRange,
  edgeEndsOf,
  resolveParity,
  round5,
  ZIP5_PATTERN,
} from '../../../distribution/addresses/chunk-emit.js';
import {
  normalizeStreet,
  parseLeadingInteger,
} from '../../../distribution/addresses/normalize.js';
import { loadFixture, sidesOf } from './fixture.js';

/**
 * SEAM-CONTRACT v1 §2 range emission, driven by the real-county ADDRFEAT
 * extract: `[fromHn, toHn, parity, fromLat, fromLng, toLat, toLng]` with
 * fromHn ≤ toHn (descending source ranges swapped AND coordinate ends
 * flipped), parity E/O/B, exactly-5-dp coordinates.
 */
describe('range emission (§2)', () => {
  const fixture = loadFixture();

  function emitAll() {
    const emissions: Array<{
      side: ReturnType<typeof sidesOf>[number];
      ends: NonNullable<ReturnType<typeof edgeEndsOf>>;
      emitted: NonNullable<ReturnType<typeof emitSideRange>>;
    }> = [];
    for (const f of fixture.features) {
      const ends = edgeEndsOf(f.geometry);
      if (!ends) continue;
      for (const side of sidesOf(f)) {
        const emitted = emitSideRange(side, ends, parseLeadingInteger, normalizeStreet);
        if (emitted) emissions.push({ side, ends, emitted });
      }
    }
    return emissions;
  }

  it('emits a substantial number of ranges from the real extract', () => {
    expect(emitAll().length).toBeGreaterThan(150);
  });

  it('every emitted range satisfies fromHn ≤ toHn with parity in {E,O,B}', () => {
    for (const { emitted } of emitAll()) {
      const [fromHn, toHn, parity] = emitted.record;
      expect(Number.isInteger(fromHn)).toBe(true);
      expect(Number.isInteger(toHn)).toBe(true);
      expect(fromHn).toBeLessThanOrEqual(toHn);
      expect(['E', 'O', 'B']).toContain(parity);
      expect(ZIP5_PATTERN.test(emitted.zip)).toBe(true);
      expect(emitted.street.length).toBeGreaterThan(0);
    }
  });

  it('coordinates are rounded to exactly 5 decimal places', () => {
    for (const { emitted } of emitAll()) {
      for (const coord of emitted.record.slice(3) as number[]) {
        expect(coord).toBe(round5(coord));
        // No more than 5 decimals survive serialization.
        const decimals = (String(coord).split('.')[1] ?? '').length;
        expect(decimals).toBeLessThanOrEqual(5);
      }
    }
  });

  it('descending source ranges are swapped AND their coordinate ends flipped', () => {
    const descending = emitAll().filter(({ side }) => {
      const from = parseLeadingInteger(side.fromHn);
      const to = parseLeadingInteger(side.toHn);
      return from !== null && to !== null && from > to;
    });
    // The extraction script guarantees descending rows from the real county.
    expect(descending.length).toBeGreaterThan(0);

    for (const { side, ends, emitted } of descending) {
      const from = parseLeadingInteger(side.fromHn)!;
      const to = parseLeadingInteger(side.toHn)!;
      const [fromHn, toHn, , fromLat, fromLng, toLat, toLng] = emitted.record;
      // House numbers swapped into ascending order…
      expect(fromHn).toBe(to);
      expect(toHn).toBe(from);
      // …and the coordinate ends flipped WITH them: the emitted from-end is
      // the geometry's LAST vertex, the emitted to-end its FIRST.
      expect(fromLat).toBe(round5(ends.toLat));
      expect(fromLng).toBe(round5(ends.toLng));
      expect(toLat).toBe(round5(ends.fromLat));
      expect(toLng).toBe(round5(ends.fromLng));
    }
  });

  it('ascending ranges keep their coordinate ends unflipped', () => {
    const ascending = emitAll().filter(({ side }) => {
      const from = parseLeadingInteger(side.fromHn);
      const to = parseLeadingInteger(side.toHn);
      return from !== null && to !== null && from < to;
    });
    expect(ascending.length).toBeGreaterThan(0);
    for (const { ends, emitted } of ascending) {
      const [, , , fromLat, fromLng, toLat, toLng] = emitted.record;
      expect(fromLat).toBe(round5(ends.fromLat));
      expect(fromLng).toBe(round5(ends.fromLng));
      expect(toLat).toBe(round5(ends.toLat));
      expect(toLng).toBe(round5(ends.toLng));
    }
  });

  it('single-house-number ranges (toHn === fromHn) survive as ranges (t = 0.5 case)', () => {
    const single = emitAll().filter(({ emitted }) => emitted.record[0] === emitted.record[1]);
    // The extraction script selects fromHn === toHn rows from the real county.
    expect(single.length).toBeGreaterThan(0);
  });

  it('the real extract exercises all three parities, including B', () => {
    const parities = new Set(emitAll().map(({ emitted }) => emitted.record[2]));
    expect(parities.has('E')).toBe(true);
    expect(parities.has('O')).toBe(true);
    expect(parities.has('B')).toBe(true);
  });

  it('derives parity from endpoints when the source enum is blank', () => {
    expect(resolveParity('', 2, 8)).toBe('E');
    expect(resolveParity('', 1, 9)).toBe('O');
    expect(resolveParity('', 1, 8)).toBe('B');
    expect(resolveParity('O', 2, 8)).toBe('O'); // source enum wins when present
  });

  it('sides with blank ZIP or non-numeric house numbers emit nothing (never fabricated)', () => {
    for (const f of fixture.features) {
      const ends = edgeEndsOf(f.geometry);
      if (!ends) continue;
      for (const side of sidesOf(f)) {
        const from = parseLeadingInteger(side.fromHn);
        const to = parseLeadingInteger(side.toHn);
        const zipOk = ZIP5_PATTERN.test(side.zip);
        const emitted = emitSideRange(side, ends, parseLeadingInteger, normalizeStreet);
        if (!zipOk || from === null || to === null) {
          expect(emitted).toBeNull();
        }
      }
    }
  });
});
