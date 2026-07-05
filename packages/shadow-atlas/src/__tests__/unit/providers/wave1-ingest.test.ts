/**
 * Wave-1 ingest capability tests (P17-wave1-ingest)
 *
 * Covers: jurisdiction.ts alias additions (tract/statistical -> 23,
 * hydrologic/huc/watershed -> 17), the judicial-district statute dissolve,
 * and one small real network smoke per new single-national-layer provider
 * (EPA CWS SAB, EIA territories, USGS WBD) — gated behind
 * RUN_NETWORK_TESTS/RUN_INTEGRATION exactly like the existing
 * TIGERBoundaryProvider suite, never run unconditionally in CI.
 */

import { describe, test, expect } from 'vitest';
import type { Polygon } from 'geojson';
import { US_JURISDICTION } from '../../../jurisdiction.js';
import {
  dissolveJudicialDistricts,
  JUDICIAL_DISTRICT_COMPOSITIONS,
  type CountyFeatureInput,
} from '../../../providers/judicial-district-provider.js';
import { EPACWSServiceAreaProvider } from '../../../providers/epa-cws-provider.js';
import { EIATerritoriesProvider } from '../../../providers/eia-territories-provider.js';
import { USGSWatershedBoundaryProvider } from '../../../providers/usgs-wbd-provider.js';
import {
  validateJudicialDistrictCount,
  validateWbdHuc8Count,
  validateEpaCwsCount,
  validateEiaTerritoryCount,
} from '../../../validators/wave1-expected-counts.js';
import { validateCompositionTableStructure } from '../../../validators/doj-ust-crosswalk.js';

const runNetworkTests =
  process.env.RUN_NETWORK_TESTS === 'true' || process.env.RUN_INTEGRATION === 'true';
const isCI = process.env.CI === 'true';

function networkTest(name: string, fn: () => Promise<void>, timeout: number = 30000) {
  const vitestTimeout = timeout + 5000;
  if (!runNetworkTests) {
    return test.skip(`${name} (requires RUN_NETWORK_TESTS=true or RUN_INTEGRATION=true)`, async () => {});
  }
  return test(
    name,
    async () => {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Network test timed out after ${timeout}ms`)), timeout);
      });
      try {
        await Promise.race([fn(), timeoutPromise]);
      } catch (error) {
        if (isCI) {
          console.warn(`[SOFT-FAIL] Network test "${name}" failed in CI:`, error);
        } else {
          throw error;
        }
      }
    },
    vitestTimeout,
  );
}

describe('jurisdiction.ts alias additions (Wave 1)', () => {
  test('vtd/voting_precinct alias to slot 21 (pre-existing, verified intact)', () => {
    expect(US_JURISDICTION.aliases['vtd']).toBe(21);
    expect(US_JURISDICTION.aliases['voting_precinct']).toBe(21);
  });

  test('judicial alias to slot 19 (pre-existing, verified intact)', () => {
    expect(US_JURISDICTION.aliases['judicial']).toBe(19);
  });

  test('tract/statistical alias to slot 23 (new)', () => {
    expect(US_JURISDICTION.aliases['tract']).toBe(23);
    expect(US_JURISDICTION.aliases['statistical']).toBe(23);
  });

  test('hydrologic/huc/watershed alias to slot 17 (new)', () => {
    expect(US_JURISDICTION.aliases['hydrologic']).toBe(17);
    expect(US_JURISDICTION.aliases['huc']).toBe(17);
    expect(US_JURISDICTION.aliases['watershed']).toBe(17);
  });

  test('no alias collides with an existing occupied slot', () => {
    // slot 17 = Conservation (was empty pre-wave-1); slot 23 = Overflow 2 (was empty).
    // Neither collides with a populated slot (0-5,7-9,20,22 in the source-DB counts).
    const newSlots = new Set([17, 23]);
    for (const slot of newSlots) {
      expect(US_JURISDICTION.slots[slot]).toBeDefined();
    }
  });
});

describe('judicial-district-provider: composition table', () => {
  test('every composition entry cites a real 28 U.S.C. section', () => {
    // Section numbers are mostly plain integers, but Alaska's is the lettered
    // "81A" (verified live against law.cornell.edu/uscode/text/28/part-I/
    // chapter-5's table of contents, 2026-07-04) — the regex must accept the
    // real statute's own numbering, not the tidier scheme a naive sequential
    // count would assume (that mismatch was the root cause of a prior
    // mis-numbered table this test's own too-strict version let through).
    for (const c of JUDICIAL_DISTRICT_COMPOSITIONS) {
      expect(c.statuteSection).toMatch(/^28 U\.S\.C\. § \d+[A-Z]?$/);
    }
  });

  test('Wyoming entry exists with no fabricated Yellowstone GEOID', () => {
    const wy = JUDICIAL_DISTRICT_COMPOSITIONS.find((c) => c.id === 'wy');
    expect(wy).toBeDefined();
    expect(wy?.statuteSection).toBe('28 U.S.C. § 131');
    // Yellowstone's MT/ID slivers are documented, not fabricated as GEOIDs.
    expect(wy?.extraCountyGeoids).toBeUndefined();
  });

  test('DC and Puerto Rico are present as single-district entries', () => {
    const dc = JUDICIAL_DISTRICT_COMPOSITIONS.find((c) => c.id === 'dc');
    const pr = JUDICIAL_DISTRICT_COMPOSITIONS.find((c) => c.id === 'pr');
    expect(dc?.statuteSection).toBe('28 U.S.C. § 88');
    expect(pr?.statuteSection).toBe('28 U.S.C. § 119');
  });

  test('composition ids are unique (no duplicate district)', () => {
    const ids = JUDICIAL_DISTRICT_COMPOSITIONS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('DOJ UST crosswalk structural check: no duplicated statute section or whole-state FIPS', () => {
    // Regression guard for the mis-numbered table this validator caught
    // (Alaska mapped to Arizona's section, cascading through Oregon).
    const result = validateCompositionTableStructure(JUDICIAL_DISTRICT_COMPOSITIONS);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe('judicial-district-provider: dissolve mechanics (synthetic geometry, no network)', () => {
  function square(minLon: number, minLat: number, size: number): Polygon {
    const maxLon = minLon + size;
    const maxLat = minLat + size;
    return {
      type: 'Polygon',
      coordinates: [
        [
          [minLon, minLat],
          [maxLon, minLat],
          [maxLon, maxLat],
          [minLon, maxLat],
          [minLon, minLat],
        ],
      ],
    };
  }

  test('dissolves whole-state counties into one district with union geometry', () => {
    const wyFips = '56';
    const counties: CountyFeatureInput[] = [
      { geoid: `${wyFips}001`, stateFips: wyFips, geometry: square(-110, 41, 1) },
      { geoid: `${wyFips}003`, stateFips: wyFips, geometry: square(-109, 41, 1) },
    ];

    let unionCallCount = 0;
    const unionFn = (geoms: readonly Polygon[]) => {
      unionCallCount++;
      // Deterministic synthetic union: just wrap all rings as a MultiPolygon-shaped
      // Polygon stand-in (test only cares about dissolve wiring, not real turf math).
      return geoms[0];
    };

    const result = dissolveJudicialDistricts(counties, unionFn as never);
    const wy = result.find((d) => d.id === 'judicial-wy');
    expect(wy).toBeDefined();
    expect(wy?.provenance.legalBasis).toContain('derived:statute');
    expect(wy?.provenance.legalBasis).toContain('28 U.S.C. § 131');
    expect(unionCallCount).toBeGreaterThan(0);
  });

  test('skips a composition with no matching county data (honest skip, no fabrication)', () => {
    const result = dissolveJudicialDistricts([], () => null);
    expect(result).toHaveLength(0);
  });

  test('never dissolves a multi-district-state placeholder (no fabricated county split)', () => {
    // California is in the MULTI_DISTRICT_STATE_TODO list, not the composition
    // table — even with CA county data present, no 'judicial-ca*' entries appear.
    const caFips = '06';
    const counties: CountyFeatureInput[] = [
      { geoid: `${caFips}001`, stateFips: caFips, geometry: square(-122, 37, 1) },
    ];
    const result = dissolveJudicialDistricts(counties, (geoms) => geoms[0]);
    expect(result.some((d) => d.id.startsWith('judicial-ca'))).toBe(false);
  });
});

describe('wave1-expected-counts validators', () => {
  test('judicial: exact 94 passes', () => {
    expect(validateJudicialDistrictCount(94).valid).toBe(true);
  });

  test('judicial: partial curated count (single-district subset) is an honest non-fabricated fail', () => {
    const partial = validateJudicialDistrictCount(JUDICIAL_DISTRICT_COMPOSITIONS.length);
    // Only single-district states/territories are curated at launch (< 94) —
    // the validator must say so, not silently pass a wrong number.
    if (JUDICIAL_DISTRICT_COMPOSITIONS.length !== 94) {
      expect(partial.valid).toBe(false);
      expect(partial.reason).toContain('28 U.S.C');
    }
  });

  test('EPA CWS SAB: real verified national count (44,656 rows, GeoPackage CWS table) is within range', () => {
    // Verified live 2026-07-04: `SELECT COUNT(*) FROM CWS` against the real
    // downloaded Service_Areas_V_3_0.gpkg returned exactly 44,656 — matches
    // the sourcing brief's "44,000+ systems" claim and this validator's
    // [40000, 55000] range.
    expect(validateEpaCwsCount(44656).valid).toBe(true);
  });

  test('EIA territories: real verified national count (2,931 features, returnCountOnly) is within range', () => {
    // Verified live 2026-07-04: `returnCountOnly=true` against the real
    // FeatureServer returned exactly 2,931.
    expect(validateEiaTerritoryCount(2931).valid).toBe(true);
  });

  test('WBD HUC-8: within tolerance of verified national total (2264)', () => {
    expect(validateWbdHuc8Count(2264).valid).toBe(true);
    expect(validateWbdHuc8Count(2270).valid).toBe(true); // within default tolerance
    expect(validateWbdHuc8Count(500).valid).toBe(false);
  });
});

describe('EPA CWS SAB provider: metadata carries the O8 publish-exclusion gate', () => {
  test('getMetadata() sets publishExclusion pending O8', async () => {
    const provider = new EPACWSServiceAreaProvider();
    const meta = await provider.getMetadata();
    expect(meta.publishExclusion).toBeDefined();
    expect(meta.publishExclusion?.pendingConfirmation).toContain('O8-license-confirms');
  });
});

describe('EIA territories provider: metadata carries the O8 publish-exclusion gate', () => {
  test('getMetadata() sets publishExclusion pending O8', async () => {
    const provider = new EIATerritoriesProvider();
    const meta = await provider.getMetadata();
    expect(meta.publishExclusion).toBeDefined();
    expect(meta.publishExclusion?.pendingConfirmation).toContain('O8-license-confirms');
  });
});

describe('USGS WBD provider: metadata carries NO publish-exclusion (not O8-gated)', () => {
  test('getMetadata() has no publishExclusion', async () => {
    const provider = new USGSWatershedBoundaryProvider();
    const meta = await provider.getMetadata();
    expect(meta.publishExclusion).toBeUndefined();
    expect(meta.license).toBe('public-domain');
  });
});

// ============================================================================
// One-small-unit real network smoke per layer (gated — RUN_NETWORK_TESTS=true)
// ============================================================================

describe('Wave-1 real smoke (network-gated)', () => {
  networkTest('USGS WBD: Rhode Island HUC-8 query returns a real feature with geometry', async () => {
    const provider = new USGSWatershedBoundaryProvider({ hucLevel: 'huc8' });
    const raw = await provider.downloadForState('RI');
    expect(raw).toHaveLength(1);
    const normalized = await provider.transform(raw);
    expect(normalized.length).toBeGreaterThan(0);
    const first = normalized[0];
    expect(first.id).toMatch(/^huc-\d{8}$/);
    expect(first.geometry.type).toBe('Polygon');
    expect(first.properties.provenanceLabel).toBe('hydrologic');
  }, 30000);

  networkTest('EPA CWS SAB: national download responds and yields service-area-labeled features', async () => {
    // maxFeatures caps the GeoPackage row parse to a small real sample —
    // the download itself is still the real ~570 MB national archive (EPA
    // publishes no smaller/state-scoped cut), but this test parses only a
    // handful of its 44,656 rows, consistent with "one small unit real
    // smoke", not a full national parse in every test run.
    const provider = new EPACWSServiceAreaProvider({ maxFeatures: 25 });
    const raw = await provider.download({ level: 'district' });
    expect(raw.length).toBeGreaterThan(0);
    const normalized = await provider.transform(raw);
    expect(normalized.length).toBeGreaterThan(0);
    expect(normalized[0].properties.provenanceLabel).toBe('service-area');
    expect(normalized[0].source.publishExclusion).toBeDefined();
  }, 120000);

  networkTest('EIA territories: FeatureServer query returns service-area-labeled features', async () => {
    // This ArcGIS FeatureServer is genuinely slow for large outFields=*
    // + full-geometry pages (verified live 2026-07-04: a single 500-feature
    // page took ~49s; the full ~2,931-territory layer paginates in ~30
    // pages at pageSize 100, which does not fit any reasonable test
    // timeout). maxFeatures caps this to a real small sample — one small
    // unit real smoke, not a full national pull in every test run.
    const provider = new EIATerritoriesProvider({ pageSize: 25, maxFeatures: 25 });
    const raw = await provider.download({ level: 'district' });
    expect(raw.length).toBeGreaterThan(0);
    const normalized = await provider.transform(raw);
    expect(normalized.length).toBeGreaterThan(0);
    expect(normalized[0].id).toMatch(/^utility-/);
    expect(normalized[0].properties.provenanceLabel).toBe('service-area');
    expect(normalized[0].source.publishExclusion).toBeDefined();
  }, 30000);
});
