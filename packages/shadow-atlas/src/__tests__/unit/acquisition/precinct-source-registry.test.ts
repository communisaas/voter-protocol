/**
 * Precinct overlay SOURCE_REGISTRY rows -- coverage + lane-split invariants
 *
 * Verifies the 23 `precinct-{st}` rows added to SOURCE_REGISTRY
 * (acquisition/source-health.ts) match PRECINCT-CURRENCY-LANE.md SS4
 * exactly: fetch lane = {AR, NC, UT} only, probe = the other 20,
 * expectedIntervalDays copied verbatim, class/ownerSlots consistent, and no
 * row exists for a PLAUSIBLE/barred state.
 */

import { describe, test, expect } from 'vitest';
import { SOURCE_REGISTRY } from '../../../acquisition/source-health.js';
import { PRECINCT_OVERLAY_STATE_CODES, PRECINCT_OVERLAY_BARRED_STATES } from '../../../providers/precinct-overlay-provider.js';

const precinctRows = SOURCE_REGISTRY.filter((r) => r.id.startsWith('precinct-'));

/** SS4's table, expectedIntervalDays column, copied verbatim (id -> days). */
const EXPECTED_INTERVAL_DAYS: Record<string, number> = {
  'precinct-ar': 90,
  'precinct-ca': 400,
  'precinct-hi': 780,
  'precinct-id': 780,
  'precinct-in': 400,
  'precinct-ia': 3650,
  'precinct-md': 400,
  'precinct-ma': 730,
  'precinct-mi': 780,
  'precinct-mt': 730,
  'precinct-nh': 3650,
  'precinct-nm': 730,
  'precinct-ny': 365,
  'precinct-nc': 180,
  'precinct-nd': 780,
  'precinct-ri': 730,
  'precinct-sc': 400,
  'precinct-tx': 780,
  'precinct-ut': 180,
  'precinct-vt': 3650,
  'precinct-wa': 400,
  'precinct-wi': 230,
  'precinct-dc': 730,
};

/** SS4's lane column, verbatim -- fetch reserved for AR/NC/UT only. */
const FETCH_LANE_IDS = new Set(['precinct-ar', 'precinct-nc', 'precinct-ut']);

describe('SOURCE_REGISTRY precinct-* rows', () => {
  test('exactly 23 precinct-* rows exist, one per CONFIRMED state', () => {
    expect(precinctRows).toHaveLength(23);
    expect(precinctRows).toHaveLength(PRECINCT_OVERLAY_STATE_CODES.length);
  });

  test('every precinct-* id is unique', () => {
    const ids = precinctRows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('ids match PRECINCT_OVERLAY_STATE_CODES exactly (lowercased)', () => {
    const idStates = precinctRows.map((r) => r.id.replace('precinct-', '').toUpperCase()).sort();
    expect(idStates).toEqual([...PRECINCT_OVERLAY_STATE_CODES].sort());
  });

  test('no precinct-* row exists for a barred (PLAUSIBLE) state', () => {
    for (const barred of PRECINCT_OVERLAY_BARRED_STATES) {
      const id = `precinct-${barred.toLowerCase()}`;
      expect(precinctRows.find((r) => r.id === id)).toBeUndefined();
    }
  });

  test('all rows are class boundary-geometry with ownerSlots "21"', () => {
    for (const row of precinctRows) {
      expect(row.class).toBe('boundary-geometry');
      expect(row.ownerSlots).toBe('21');
    }
  });

  test('lane split matches SS4 exactly: fetch = {AR, NC, UT}, probe = the other 20', () => {
    const fetchIds = precinctRows.filter((r) => r.lane === 'fetch').map((r) => r.id).sort();
    const probeIds = precinctRows.filter((r) => r.lane === 'probe').map((r) => r.id).sort();
    expect(fetchIds).toEqual([...FETCH_LANE_IDS].sort());
    expect(probeIds).toHaveLength(20);
    expect(fetchIds.length + probeIds.length).toBe(23);
  });

  test('probe-lane rows all carry a probe config', () => {
    for (const row of precinctRows) {
      if (row.lane === 'probe') {
        expect(row.probe).toBeDefined();
      }
    }
  });

  test('expectedIntervalDays matches PRECINCT-CURRENCY-LANE.md SS4 verbatim, per row', () => {
    for (const row of precinctRows) {
      expect(row.expectedIntervalDays).toBe(EXPECTED_INTERVAL_DAYS[row.id]);
    }
  });

  test('every row has a configSite pointing at precinct-overlay-provider.ts', () => {
    for (const row of precinctRows) {
      expect(row.configSite).toContain('precinct-overlay-provider.ts');
    }
  });

  test('retryBudget is 6 for every row (matches the module header\'s stated common field)', () => {
    for (const row of precinctRows) {
      expect(row.retryBudget).toBe(6);
    }
  });
});
