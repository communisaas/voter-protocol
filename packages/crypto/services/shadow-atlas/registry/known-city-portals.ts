/**
 * Known City Portals Registry
 *
 * Manually curated official city data portals with verified council district datasets.
 * These are highest-priority sources - direct from city government.
 *
 * KEY: FIPS code (7 digits, e.g., '5363000' = Seattle, WA)
 * VALUE: Portal configuration
 *
 * ADD NEW CITIES:
 * 1. Verify the FIPS code using Census data
 * 2. Find official city data portal (data.{city}.gov)
 * 3. Locate council district dataset and note the platform (Socrata/ArcGIS)
 * 4. Add entry with verified dataset ID if available
 */

/**
 * Known city portal entry
 */
export interface KnownCityPortal {
    /** Socrata domain (e.g., 'data.seattle.gov') */
    readonly socrata?: string;

    /** ArcGIS Hub domain (e.g., 'data-seattlecitygis.opendata.arcgis.com') */
    readonly arcgis?: string;

    /** Known dataset ID for direct download */
    readonly datasetId?: string;

    /** Human-readable city name (for logging) */
    readonly cityName?: string;
}

/**
 * Known city portals registry
 * Key: 7-digit FIPS code
 */
export const KNOWN_CITY_PORTALS: Readonly<Record<string, KnownCityPortal>> = {
    '5363000': {  // Seattle, WA
        cityName: 'Seattle',
        socrata: 'data.seattle.gov',
        arcgis: 'data-seattlecitygis.opendata.arcgis.com',
        datasetId: 'd814188c70264f4a8359d9b28944eb33_1',
    },
    '3651000': {  // New York, NY
        cityName: 'New York',
        socrata: 'data.cityofnewyork.us',
        arcgis: 'data.cityofnewyork.us',
    },
    '1714000': {  // Chicago, IL
        cityName: 'Chicago',
        socrata: 'data.cityofchicago.org',
    },
    '4805000': {  // Austin, TX
        cityName: 'Austin',
        socrata: 'data.austintexas.gov',
        arcgis: 'data.austintexas.gov',
    },
    '0667000': {  // San Francisco, CA
        cityName: 'San Francisco',
        socrata: 'data.sfgov.org',
    },
    '0644000': {  // Los Angeles, CA
        cityName: 'Los Angeles',
        arcgis: 'geohub.lacity.org',
    },
} as const;

/**
 * Get known portal for a city by FIPS code
 */
export function getKnownCityPortal(fips: string): KnownCityPortal | undefined {
    return KNOWN_CITY_PORTALS[fips];
}

/**
 * Check if city has a known portal
 */
export function hasKnownCityPortal(fips: string): boolean {
    return fips in KNOWN_CITY_PORTALS;
}

/**
 * Get all known city FIPS codes
 */
export function getKnownCityFipsCodes(): readonly string[] {
    return Object.keys(KNOWN_CITY_PORTALS);
}
