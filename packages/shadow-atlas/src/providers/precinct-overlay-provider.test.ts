/**
 * Precinct overlay provider tests (Tranche A deep adapters + Tranche B
 * shared smoke), all fixture-backed -- zero live network calls. Each
 * PrecinctOverlayProvider is constructed with an injected `fetchImpl` that
 * returns a small synthetic ArcGIS-shaped (or plain-array, for s3-listing/
 * ckan-api rows) feature response, matching the pattern already used by
 * USGSWatershedBoundaryProvider/EPACWSServiceAreaProvider's fixture tests.
 */

import { describe, test, expect } from 'vitest';
import {
  PrecinctOverlayProvider,
  PRECINCT_OVERLAY_CONFIGS,
  PRECINCT_OVERLAY_STATE_CODES,
  type FetchImpl,
} from './precinct-overlay-provider.js';
import { US_JURISDICTION } from '../jurisdiction.js';
import { filterPublishExclusions } from './publish-exclusion-filter.js';

/** Build a minimal synthetic ArcGIS query-response fetch, no network. */
function fakeArcGISFetch(featureCount = 2): FetchImpl {
  const features = Array.from({ length: featureCount }, (_, i) => ({
    attributes: { GEOID: `TEST-${i}`, NAME: `Test Precinct ${i}` },
    geometry: {
      rings: [
        [
          [-90, 40],
          [-89, 40],
          [-89, 41],
          [-90, 40],
        ],
      ],
    },
  }));
  const body = JSON.stringify({ features });
  return (async () =>
    new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as FetchImpl;
}

function failingFetch(status = 500): FetchImpl {
  return (async () => new Response('error', { status })) as unknown as FetchImpl;
}

const TRANCHE_A_STATES = [
  'TX', 'NY', 'NC', 'MI', 'WA', 'MA', 'IN', 'WI', 'UT', 'AR', 'HI', 'RI', 'MT', 'DC',
];

const TRANCHE_B_STATES = ['CA', 'MD', 'SC', 'IA', 'NM', 'ID', 'NH', 'VT', 'ND'];

describe('Tranche + roster accounting', () => {
  test('Tranche A (14) + Tranche B (9) = 23, matching PRECINCT_OVERLAY_STATE_CODES exactly', () => {
    expect(TRANCHE_A_STATES).toHaveLength(14);
    expect(TRANCHE_B_STATES).toHaveLength(9);
    const combined = [...TRANCHE_A_STATES, ...TRANCHE_B_STATES].sort();
    expect(combined).toEqual([...PRECINCT_OVERLAY_STATE_CODES].sort());
  });

  test('no state appears in both tranches', () => {
    const overlap = TRANCHE_A_STATES.filter((s) => TRANCHE_B_STATES.includes(s));
    expect(overlap).toEqual([]);
  });
});

describe('slot-21 aliasing (jurisdiction.ts)', () => {
  test('vtd and voting_precinct both resolve to slot 21', () => {
    expect(US_JURISDICTION.aliases['vtd']).toBe(21);
    expect(US_JURISDICTION.aliases['voting_precinct']).toBe(21);
  });
});

describe.each(TRANCHE_A_STATES)('PrecinctOverlayProvider[%s] (Tranche A deep adapter)', (state) => {
  test('config URL matches the lane-doc-verified URL string', () => {
    const config = PRECINCT_OVERLAY_CONFIGS[state];
    expect(config.url).toMatch(/^https:\/\//);
    // Every Tranche-A config row must carry a laneDocAnchor pointing back to §2.1.
    expect(config.laneDocAnchor).toContain(state);
  });

  test('transform() tags boundaries with current-precinct-overlay provenance + overlay properties', async () => {
    const provider = new PrecinctOverlayProvider(state, { fetchImpl: fakeArcGISFetch(3) });
    const raw = await provider.download({ level: 'district' });
    const boundaries = await provider.transform(raw);

    expect(boundaries.length).toBeGreaterThan(0);
    for (const boundary of boundaries) {
      expect(boundary.properties.provenanceLabel).toBe('current-precinct-overlay');
      expect(boundary.properties.overlayState).toBe(state);
      expect(boundary.properties.overlayVintage).toBe(PRECINCT_OVERLAY_CONFIGS[state].overlayVintage);
      expect(boundary.properties.overlayCadence).toBe(PRECINCT_OVERLAY_CONFIGS[state].cadence);
      expect(boundary.properties.layer).toBe('voting_precinct');
      expect(boundary.level).toBe('district');
      expect(boundary.geometry.type === 'Polygon' || boundary.geometry.type === 'MultiPolygon').toBe(true);
    }
  });

  test('slot-21 resolution: boundary layer alias resolves via US_JURISDICTION.aliases.voting_precinct', () => {
    const boundary = { properties: { layer: 'voting_precinct' } };
    const slot = US_JURISDICTION.aliases[boundary.properties.layer as keyof typeof US_JURISDICTION.aliases];
    expect(slot).toBe(21);
  });

  test('license-review states carry publishExclusion; license-clear states do not', async () => {
    const provider = new PrecinctOverlayProvider(state, { fetchImpl: fakeArcGISFetch(1) });
    const raw = await provider.download({ level: 'district' });
    const boundaries = await provider.transform(raw);
    const config = PRECINCT_OVERLAY_CONFIGS[state];

    if (config.licenseGate === 'review') {
      for (const b of boundaries) {
        expect(b.source.publishExclusion).toBeDefined();
        expect(b.source.publishExclusion?.pendingConfirmation).toContain('O8-precinct-license-confirms');
      }
    } else {
      for (const b of boundaries) {
        expect(b.source.publishExclusion).toBeUndefined();
      }
    }
  });

  test('getMetadata() reflects the same licenseGate-derived publishExclusion posture', async () => {
    const provider = new PrecinctOverlayProvider(state, { fetchImpl: fakeArcGISFetch(1) });
    const metadata = await provider.getMetadata();
    const config = PRECINCT_OVERLAY_CONFIGS[state];
    if (config.licenseGate === 'review') {
      expect(metadata.publishExclusion).toBeDefined();
    } else {
      expect(metadata.publishExclusion).toBeUndefined();
    }
  });
});

describe('Tranche B (9 states) -- config-presence + licenseGate shared smoke', () => {
  test.each(TRANCHE_B_STATES)('config row exists for %s with verbatim §2.1/§4 fields', (state) => {
    const config = PRECINCT_OVERLAY_CONFIGS[state];
    expect(config).toBeDefined();
    expect(config.state).toBe(state);
    expect(config.url).toMatch(/^https:\/\//);
    expect(config.cadence.length).toBeGreaterThan(0);
    expect(config.overlayVintage.length).toBeGreaterThan(0);
    expect(config.population2020).toBeGreaterThan(0);
  });

  test.each(TRANCHE_B_STATES)('%s licenseGate matches the review-state roster exactly', (state) => {
    const config = PRECINCT_OVERLAY_CONFIGS[state];
    const expectedReview = new Set(['CA', 'MD', 'SC', 'IA', 'ND']);
    if (expectedReview.has(state)) {
      expect(config.licenseGate).toBe('review');
    } else {
      expect(config.licenseGate).toBe('clear');
    }
  });

  test.each(TRANCHE_B_STATES)(
    '%s: review-gated states set publishExclusion with an O8-precinct-pattern pendingConfirmation naming the state',
    async (state) => {
      const config = PRECINCT_OVERLAY_CONFIGS[state];
      if (config.licenseGate !== 'review') return;

      const provider = new PrecinctOverlayProvider(state, { fetchImpl: fakeArcGISFetch(1) });
      const raw = await provider.download({ level: 'district' });
      const boundaries = await provider.transform(raw);

      expect(boundaries.length).toBeGreaterThan(0);
      for (const boundary of boundaries) {
        expect(boundary.source.publishExclusion).toBeDefined();
        expect(boundary.source.publishExclusion?.pendingConfirmation).toContain(`"${state} license: CONFIRMED`);
      }

      // filterPublishExclusions must exclude every one of these from a
      // signed-publish set, with zero new logic beyond the existing filter.
      const result = filterPublishExclusions(boundaries);
      expect(result.included).toHaveLength(0);
      expect(result.excluded).toHaveLength(boundaries.length);
    },
  );
});

describe('Constructor gate', () => {
  test('throws for a PLAUSIBLE/barred state (never silently constructs)', () => {
    expect(() => new PrecinctOverlayProvider('AK')).toThrow(/not a CONFIRMED state/);
    expect(() => new PrecinctOverlayProvider('MN')).toThrow(/not a CONFIRMED state/);
  });

  test('throws for a NONE-verdict state', () => {
    expect(() => new PrecinctOverlayProvider('OH')).toThrow(/not a CONFIRMED state/);
  });

  test('accepts lowercase state codes', () => {
    expect(() => new PrecinctOverlayProvider('wi')).not.toThrow();
  });
});

describe('download() error handling', () => {
  test('non-ok HTTP response throws rather than silently returning empty', async () => {
    const provider = new PrecinctOverlayProvider('WI', { fetchImpl: failingFetch(503) });
    await expect(provider.download({ level: 'district' })).rejects.toThrow(/HTTP 503/);
  });
});

describe('checkForUpdates()', () => {
  test('reports available when HEAD succeeds', async () => {
    const provider = new PrecinctOverlayProvider('MT', { fetchImpl: fakeArcGISFetch(0) });
    const result = await provider.checkForUpdates();
    expect(result.available).toBe(true);
    expect(result.latestVersion).toBe(PRECINCT_OVERLAY_CONFIGS.MT.overlayVintage);
  });

  test('reports unavailable when fetch throws', async () => {
    const throwingFetch: FetchImpl = (async () => {
      throw new Error('network down');
    }) as unknown as FetchImpl;
    const provider = new PrecinctOverlayProvider('MT', { fetchImpl: throwingFetch });
    const result = await provider.checkForUpdates();
    expect(result.available).toBe(false);
  });
});

describe('2020 VTD baseline non-displacement (documentation-level guard)', () => {
  test('every overlay boundary property set is additive-labeled, never claims to BE the baseline', async () => {
    const provider = new PrecinctOverlayProvider('TX', { fetchImpl: fakeArcGISFetch(2) });
    const raw = await provider.download({ level: 'district' });
    const boundaries = await provider.transform(raw);
    for (const b of boundaries) {
      expect(b.properties.provenanceLabel).not.toBe('2020-vintage VTD');
      expect(b.properties.provenanceLabel).toBe('current-precinct-overlay');
    }
  });
});
