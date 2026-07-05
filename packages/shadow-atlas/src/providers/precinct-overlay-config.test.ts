/**
 * Precinct overlay config gate tests
 *
 * Enforces the "barred by absence" gate from PRECINCT-CURRENCY-LANE.md: the
 * 4 PLAUSIBLE states (AK, DE, LA, MN) must never acquire a config row until
 * a follow-up confirm lands. A future accidental addition of one of these
 * fails CI immediately rather than silently shipping an unconfirmed source.
 */

import { describe, test, expect } from 'vitest';
import {
  PRECINCT_OVERLAY_CONFIGS,
  PRECINCT_OVERLAY_STATE_CODES,
  PRECINCT_OVERLAY_BARRED_STATES,
} from './precinct-overlay-provider.js';

/** The 23 CONFIRMED two-letter state codes, per PRECINCT-CURRENCY-LANE.md §2.1's index table. */
const EXPECTED_CONFIRMED_STATES = [
  'AR', 'CA', 'HI', 'ID', 'IN', 'IA', 'MD', 'MA', 'MI', 'MT', 'NH', 'NM',
  'NY', 'NC', 'ND', 'RI', 'SC', 'TX', 'UT', 'VT', 'WA', 'WI', 'DC',
];

describe('PRECINCT_OVERLAY_CONFIGS -- CONFIRMED-only gate', () => {
  test('contains exactly the 23 CONFIRMED state codes, no more, no fewer', () => {
    const actual = Object.keys(PRECINCT_OVERLAY_CONFIGS).sort();
    expect(actual).toEqual([...EXPECTED_CONFIRMED_STATES].sort());
    expect(actual).toHaveLength(23);
  });

  test('PRECINCT_OVERLAY_STATE_CODES mirrors the config keys exactly', () => {
    expect([...PRECINCT_OVERLAY_STATE_CODES].sort()).toEqual(
      Object.keys(PRECINCT_OVERLAY_CONFIGS).sort(),
    );
  });

  test.each(['AK', 'DE', 'LA', 'MN'])(
    'PLAUSIBLE state %s is explicitly absent from PRECINCT_OVERLAY_CONFIGS',
    (state) => {
      expect(Object.keys(PRECINCT_OVERLAY_CONFIGS)).not.toContain(state);
      expect(PRECINCT_OVERLAY_CONFIGS[state]).toBeUndefined();
    },
  );

  test('PRECINCT_OVERLAY_BARRED_STATES names exactly the 4 PLAUSIBLE states', () => {
    expect([...PRECINCT_OVERLAY_BARRED_STATES].sort()).toEqual(['AK', 'DE', 'LA', 'MN']);
  });

  test('no barred state overlaps a CONFIRMED state', () => {
    for (const barred of PRECINCT_OVERLAY_BARRED_STATES) {
      expect(Object.keys(PRECINCT_OVERLAY_CONFIGS)).not.toContain(barred);
    }
  });

  test('every config row is keyed by its own two-letter state code', () => {
    for (const [key, config] of Object.entries(PRECINCT_OVERLAY_CONFIGS)) {
      expect(config.state).toBe(key);
    }
  });

  test('every config row traces to a laneDocAnchor (no fabricated/undocumented rows)', () => {
    for (const config of Object.values(PRECINCT_OVERLAY_CONFIGS)) {
      expect(config.laneDocAnchor).toMatch(/^§2\.1 #[A-Z]{2}/);
    }
  });

  test('license gate is either clear or review (the only two §3 legend values)', () => {
    for (const config of Object.values(PRECINCT_OVERLAY_CONFIGS)) {
      expect(['clear', 'review']).toContain(config.licenseGate);
    }
  });

  test('the 6 license-review states match PRECINCT-CURRENCY-LANE.md §3 exactly', () => {
    const reviewStates = Object.values(PRECINCT_OVERLAY_CONFIGS)
      .filter((c) => c.licenseGate === 'review')
      .map((c) => c.state)
      .sort();
    expect(reviewStates).toEqual(['CA', 'IA', 'MD', 'NC', 'ND', 'SC']);
  });
});

/**
 * Fetch-free endpoint-shape config-lint.
 *
 * Round-2 hardening after a live-fetch audit found 6 of 23 config rows
 * pointing at the wrong resource for their declared `format` (a Hub/product
 * HTML page tagged 'arcgis-featureserver', a checksum URL tagged
 * 's3-listing' that was actually an HTML listing-app shell, an invented
 * ArcGIS layer index). These assertions encode the resulting invariants
 * statically -- no network call -- so this defect class fails fast in CI
 * rather than requiring a live re-fetch to notice.
 */
describe('PRECINCT_OVERLAY_CONFIGS -- endpoint-shape lint (fetch-free)', () => {
  test("every 'arcgis-featureserver' config URL is a fully-qualified /FeatureServer/<layer> or /MapServer/<layer> REST endpoint, never a Hub/product/about HTML page", () => {
    for (const config of Object.values(PRECINCT_OVERLAY_CONFIGS)) {
      if (config.format !== 'arcgis-featureserver') continue;
      expect(config.url).toMatch(/\/(FeatureServer|MapServer)\/\d+$/);
    }
  });

  test("no 'arcgis-featureserver' config URL points at a Hub/opendata/about page (the class of defect that produced the MI/UT/MA/VT round-1 findings)", () => {
    for (const config of Object.values(PRECINCT_OVERLAY_CONFIGS)) {
      if (config.format !== 'arcgis-featureserver') continue;
      expect(config.url).not.toMatch(/opendata\.arcgis\.com|\/datasets\/|\/about$|\/products\//);
    }
  });

  test("every 's3-listing' config URL carries a literal list-type=2 ListObjectsV2 query param (the NC round-1 finding)", () => {
    for (const config of Object.values(PRECINCT_OVERLAY_CONFIGS)) {
      if (config.format !== 's3-listing') continue;
      expect(config.url).toMatch(/[?&]list-type=2\b/);
    }
  });

  test("no 'arcgis-featureserver', 'ckan-api', or 's3-listing' config URL ends in a bare '.html' page path (a page is never a queryable/downloadable resource for those three formats)", () => {
    // 'direct-fetch' is the one format that legitimately targets an HTML
    // index/product page when no listing API exists (e.g. CA's SWDB page,
    // which is genuinely the only source and already publish-excluded via
    // licenseGate: 'review') -- excluded from this assertion by design, not
    // by oversight.
    for (const config of Object.values(PRECINCT_OVERLAY_CONFIGS)) {
      if (config.format === 'direct-fetch') continue;
      expect(config.url).not.toMatch(/\.html?$/i);
    }
  });

  test('format is one of the four documented PrecinctOverlayFormat values', () => {
    const known = new Set(['arcgis-featureserver', 'ckan-api', 's3-listing', 'direct-fetch']);
    for (const config of Object.values(PRECINCT_OVERLAY_CONFIGS)) {
      expect(known.has(config.format)).toBe(true);
    }
  });
});
