/**
 * Geographic Constants - Single Source of Truth
 *
 * This file consolidates commonly duplicated geographic reference data:
 * - STATE_BOUNDS: Bounding boxes for quick coordinate validation
 * - STATE_ABBR_TO_FIPS: Two-letter abbreviation to FIPS code mapping
 * - STATE_FIPS_TO_ABBR: FIPS code to abbreviation mapping
 *
 * USAGE: Import from this file instead of defining locally.
 * This eliminates 4+ duplicate STATE_BOUNDS definitions and 10+ STATE_FIPS duplicates.
 *
 * NOTE: For STATE_FIPS_TO_NAME (full state names), use core/types.ts which is canonical.
 */

/**
 * State bounding boxes for quick coordinate validation
 *
 * Format: [minLon, minLat, maxLon, maxLat] (WGS84)
 *
 * USE CASES:
 * - Quick geographic filtering of portal search results
 * - Rejecting obviously wrong-state data before expensive validation
 * - Centroid-based state detection
 *
 * LIMITATIONS:
 * - Bounding boxes overlap at state borders
 * - For canonical boundaries, use county geometry lookups
 */
export const STATE_BOUNDS: Readonly<Record<string, readonly [number, number, number, number]>> = {
    AL: [-88.5, 30.2, -84.9, 35.0],
    AK: [-180, 51, -129, 71.5],
    AZ: [-114.8, 31.3, -109.0, 37.0],
    AR: [-94.6, 33.0, -89.6, 36.5],
    CA: [-124.5, 32.5, -114.1, 42.0],
    CO: [-109.1, 37.0, -102.0, 41.0],
    CT: [-73.7, 40.9, -71.8, 42.1],
    DE: [-75.8, 38.4, -75.0, 39.8],
    FL: [-87.6, 24.5, -80.0, 31.0],
    GA: [-85.6, 30.4, -80.8, 35.0],
    HI: [-160, 18.9, -154.8, 22.2],
    ID: [-117.2, 42.0, -111.0, 49.0],
    IL: [-91.5, 37.0, -87.5, 42.5],
    IN: [-88.1, 37.8, -84.8, 41.8],
    IA: [-96.6, 40.4, -90.1, 43.5],
    KS: [-102.1, 37.0, -94.6, 40.0],
    KY: [-89.6, 36.5, -81.9, 39.1],
    LA: [-94.0, 29.0, -88.8, 33.0],
    ME: [-71.1, 43.0, -66.9, 47.5],
    MD: [-79.5, 37.9, -75.0, 39.7],
    MA: [-73.5, 41.2, -69.9, 42.9],
    MI: [-90.4, 41.7, -82.4, 48.3],
    MN: [-97.2, 43.5, -89.5, 49.4],
    MS: [-91.7, 30.2, -88.1, 35.0],
    MO: [-95.8, 36.0, -89.1, 40.6],
    MT: [-116.1, 44.4, -104.0, 49.0],
    NE: [-104.1, 40.0, -95.3, 43.0],
    NV: [-120.0, 35.0, -114.0, 42.0],
    NH: [-72.6, 42.7, -70.6, 45.3],
    NJ: [-75.6, 38.9, -73.9, 41.4],
    NM: [-109.1, 31.3, -103.0, 37.0],
    NY: [-79.8, 40.5, -71.9, 45.0],
    NC: [-84.3, 33.8, -75.5, 36.6],
    ND: [-104.1, 45.9, -96.6, 49.0],
    OH: [-84.8, 38.4, -80.5, 42.3],
    OK: [-103.0, 33.6, -94.4, 37.0],
    OR: [-124.6, 42.0, -116.5, 46.3],
    PA: [-80.5, 39.7, -74.7, 42.3],
    RI: [-71.9, 41.1, -71.1, 42.0],
    SC: [-83.4, 32.0, -78.5, 35.2],
    SD: [-104.1, 42.5, -96.4, 45.9],
    TN: [-90.3, 35.0, -81.6, 36.7],
    TX: [-106.7, 25.8, -93.5, 36.5],
    UT: [-114.1, 37.0, -109.0, 42.0],
    VT: [-73.4, 42.7, -71.5, 45.0],
    VA: [-83.7, 36.5, -75.2, 39.5],
    WA: [-124.8, 45.5, -116.9, 49.0],
    WV: [-82.6, 37.2, -77.7, 40.6],
    WI: [-92.9, 42.5, -86.2, 47.1],
    WY: [-111.1, 41.0, -104.0, 45.0],
    DC: [-77.1, 38.8, -76.9, 39.0],
} as const;

/**
 * State abbreviation to FIPS code mapping
 *
 * USE CASES:
 * - Converting user input (state abbreviation) to Census FIPS code
 * - Building TIGER URLs and API queries
 * - GEOID construction
 */
export const STATE_ABBR_TO_FIPS: Readonly<Record<string, string>> = {
    AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06',
    CO: '08', CT: '09', DE: '10', DC: '11', FL: '12',
    GA: '13', HI: '15', ID: '16', IL: '17', IN: '18',
    IA: '19', KS: '20', KY: '21', LA: '22', ME: '23',
    MD: '24', MA: '25', MI: '26', MN: '27', MS: '28',
    MO: '29', MT: '30', NE: '31', NV: '32', NH: '33',
    NJ: '34', NM: '35', NY: '36', NC: '37', ND: '38',
    OH: '39', OK: '40', OR: '41', PA: '42', RI: '44',
    SC: '45', SD: '46', TN: '47', TX: '48', UT: '49',
    VT: '50', VA: '51', WA: '53', WV: '54', WI: '55',
    WY: '56', AS: '60', GU: '66', MP: '69', PR: '72', VI: '78',
} as const;

/**
 * FIPS code to state abbreviation mapping (inverse of STATE_ABBR_TO_FIPS)
 */
export const STATE_FIPS_TO_ABBR: Readonly<Record<string, string>> = Object.fromEntries(
    Object.entries(STATE_ABBR_TO_FIPS).map(([abbr, fips]) => [fips, abbr])
) as Record<string, string>;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get state abbreviation from FIPS code
 * @param fips - 2-digit state FIPS code
 * @returns State abbreviation or null if not found
 */
export function getStateAbbrFromFips(fips: string): string | null {
    return STATE_FIPS_TO_ABBR[fips] ?? null;
}

/**
 * Get FIPS code from state abbreviation
 * @param abbr - 2-letter state abbreviation (case insensitive)
 * @returns FIPS code or null if not found
 */
export function getFipsFromStateAbbr(abbr: string): string | null {
    return STATE_ABBR_TO_FIPS[abbr.toUpperCase()] ?? null;
}

/**
 * Get bounding box for a state
 * @param stateAbbr - 2-letter state abbreviation (case insensitive)
 * @returns [minLon, minLat, maxLon, maxLat] or null if not found
 */
export function getStateBounds(stateAbbr: string): readonly [number, number, number, number] | null {
    return STATE_BOUNDS[stateAbbr.toUpperCase()] ?? null;
}

/**
 * Check if coordinates are within a state's bounding box
 * @param lat - Latitude (WGS84)
 * @param lon - Longitude (WGS84)
 * @param stateAbbr - 2-letter state abbreviation
 * @param tolerance - Degrees of tolerance for border cases (default 0.5)
 * @returns true if within bounds (with tolerance)
 */
export function isWithinStateBounds(
    lat: number,
    lon: number,
    stateAbbr: string,
    tolerance: number = 0.5
): boolean {
    const bounds = getStateBounds(stateAbbr);
    if (!bounds) return false;

    const [minLon, minLat, maxLon, maxLat] = bounds;
    return (
        lon >= minLon - tolerance &&
        lon <= maxLon + tolerance &&
        lat >= minLat - tolerance &&
        lat <= maxLat + tolerance
    );
}

/**
 * Detect state from coordinates using bounding boxes
 *
 * LIMITATION: May return multiple matches for border areas.
 * Returns first match only (use for quick validation, not canonical lookups).
 *
 * @param lat - Latitude (WGS84)
 * @param lon - Longitude (WGS84)
 * @returns State abbreviation or null if outside all known bounds
 */
export function detectStateFromCoordinates(lat: number, lon: number): string | null {
    for (const [state, bounds] of Object.entries(STATE_BOUNDS)) {
        const [minLon, minLat, maxLon, maxLat] = bounds;
        if (lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon) {
            return state;
        }
    }
    return null;
}
