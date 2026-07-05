/**
 * Wave-1 Expected Counts (P17-wave1-ingest)
 *
 * Per-layer expected-count validators for the six new national/near-national
 * sources ingested in Wave 1 (docs/design/MISSING-SLOTS-SOURCING.md, commons
 * repo): judicial districts, EPA CWS SAB, EIA territories, USGS WBD.
 *
 * TIGER-native ranks 1-2 (VTD, tract) already have expected-count validators
 * in tiger-expected-counts.ts (EXPECTED_COUNTS.vtd, EXPECTED_COUNTS.tract) —
 * this module does NOT duplicate those. It covers only the genuinely new
 * layers this wave introduces: judicial (statute-derived, not TIGER-native),
 * and the three single-national-layer providers.
 *
 * Mirrors the tolerance-band pattern already used by
 * validators/pipeline/district-count.ts (exact / within-tolerance / reject),
 * kept in a small standalone module rather than perturbing the large
 * existing TigerCountLayer union in tiger-expected-counts.ts (40+ call
 * sites) for four layers that are not TIGER-native products.
 */

/**
 * Federal judicial districts: fixed by 28 U.S.C. §§ 81-131 at 94 total
 * (verified against the statute's own state-by-state district count,
 * cross-checked 2026-07-04). This does not change absent an act of Congress
 * (unlike Congressional apportionment, which recurs decennially).
 */
export const EXPECTED_JUDICIAL_DISTRICT_COUNT = 94;

/**
 * EPA Community Water System Service Area Boundaries v3: "44,000+ systems,
 * ~99% of served population" per the sourcing brief. No single fixed
 * statutory count (community water systems are created/retired
 * continuously) — expressed as a floor + rough ceiling, not an exact match.
 */
export const EXPECTED_EPA_CWS_COUNT_RANGE = { min: 40000, max: 55000 } as const;

/**
 * EIA Electric Retail Service Territories: no single canonical total is
 * published by EIA in a form independently verified in this session — the
 * layer covers all US electric retail utilities (investor-owned,
 * cooperatives, municipals, federal power marketing). Left as a soft floor
 * only (no fabricated ceiling); wide range acknowledges the honesty gap.
 */
export const EXPECTED_EIA_TERRITORY_COUNT_RANGE = { min: 1, max: 4000 } as const;

/**
 * USGS WBD HUC-8 (Subbasin) national total. USGS reports 2,264 HUC-8 units
 * covering the US, Puerto Rico, and the US Virgin Islands (the "8-digit HU
 * (Subbasin)" layer at hydro.nationalmap.gov/arcgis/rest/services/wbd/
 * MapServer/4). HUC-10/12 totals are far larger and not curated here — this
 * wave's default provider level is HUC-8 (see usgs-wbd-provider.ts).
 */
export const EXPECTED_WBD_HUC8_COUNT = 2264;

export interface CountValidation {
  readonly valid: boolean;
  readonly expected: number | { readonly min: number; readonly max: number };
  readonly discovered: number;
  readonly reason: string;
}

/**
 * Validate a discovered judicial-district count. Exact match required — 94
 * is a statutory fixed point, not an estimate.
 */
export function validateJudicialDistrictCount(discoveredCount: number): CountValidation {
  const valid = discoveredCount === EXPECTED_JUDICIAL_DISTRICT_COUNT;
  return {
    valid,
    expected: EXPECTED_JUDICIAL_DISTRICT_COUNT,
    discovered: discoveredCount,
    reason: valid
      ? 'Exact match (94 districts, 28 U.S.C. §§ 81-131)'
      : `Expected exactly ${EXPECTED_JUDICIAL_DISTRICT_COUNT} (28 U.S.C. §§ 81-131 fixed count), found ${discoveredCount}. ` +
        'A partial composition table (only single-district states/territories curated) legitimately produces FEWER than 94 until multi-district states are added — this is expected during incremental ingest, not necessarily a defect.',
  };
}

/** Validate a discovered EPA CWS SAB feature count against the floor/ceiling. */
export function validateEpaCwsCount(discoveredCount: number): CountValidation {
  const { min, max } = EXPECTED_EPA_CWS_COUNT_RANGE;
  const valid = discoveredCount >= min && discoveredCount <= max;
  return {
    valid,
    expected: EXPECTED_EPA_CWS_COUNT_RANGE,
    discovered: discoveredCount,
    reason: valid
      ? `Within expected range [${min}, ${max}]`
      : `Outside expected range [${min}, ${max}], found ${discoveredCount} — check for a partial/failed download`,
  };
}

/** Validate a discovered EIA territory feature count against the floor/ceiling. */
export function validateEiaTerritoryCount(discoveredCount: number): CountValidation {
  const { min, max } = EXPECTED_EIA_TERRITORY_COUNT_RANGE;
  const valid = discoveredCount >= min && discoveredCount <= max;
  return {
    valid,
    expected: EXPECTED_EIA_TERRITORY_COUNT_RANGE,
    discovered: discoveredCount,
    reason: valid
      ? `Within expected range [${min}, ${max}]`
      : `Outside expected range [${min}, ${max}], found ${discoveredCount} — check for a partial/failed download`,
  };
}

/** Validate a discovered USGS WBD HUC-8 feature count (national pull only). */
export function validateWbdHuc8Count(discoveredCount: number, tolerance: number = 50): CountValidation {
  const diff = Math.abs(discoveredCount - EXPECTED_WBD_HUC8_COUNT);
  const valid = diff <= tolerance;
  return {
    valid,
    expected: EXPECTED_WBD_HUC8_COUNT,
    discovered: discoveredCount,
    reason: valid
      ? `Within tolerance (±${tolerance}) of ${EXPECTED_WBD_HUC8_COUNT}`
      : `Expected ~${EXPECTED_WBD_HUC8_COUNT} HUC-8 units (±${tolerance}), found ${discoveredCount} (diff: ${diff})`,
  };
}
