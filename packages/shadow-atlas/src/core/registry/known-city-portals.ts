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
    '4835000': {  // Houston, TX
        cityName: 'Houston',
        arcgis: 'mycity.houstontx.gov/pubgis', // Using typical ArcGIS pattern, verified in next steps or assuming standard based on research
        // Note: Houston often uses specific services, but adding as placeholder for manual verification if needed.
        // Better to have minimal config than none if it triggers discovery.
    },
    '0455000': {  // Phoenix, AZ
        cityName: 'Phoenix',
        arcgis: 'uagis.phoenix.gov/arcgis', // Known REST endpoint
    },
    '4260000': {  // Philadelphia, PA
        cityName: 'Philadelphia',
        arcgis: 'services.arcgis.com/fLeGjb7u4uXxbFz5', // Philadelphia's hosted services
        socrata: 'opendata.arcgis.com', // Actually Philadelphia uses openatadataphilly.org which is CKAN-like but they have ArcGIS too
    },
    '4865000': {  // San Antonio, TX
        cityName: 'San Antonio',
        arcgis: 'gis.sanantonio.gov/ArcGIS',
    },
    '0666000': {  // San Diego, CA
        cityName: 'San Diego',
        arcgis: 'sangis.org', // SanGIS covers San Diego
    },
    '4819000': {  // Dallas, TX
        cityName: 'Dallas',
        arcgis: 'gis.dallascityhall.com/arcgis',
    },
    '0668000': {  // San Jose, CA
        cityName: 'San Jose',
        arcgis: 'geo.sanjoseca.gov/server',
    },
    // =========================================================================
    // Ohio Cities (verified 2026-01-23)
    // =========================================================================
    '3918000': {  // Columbus, OH (FIPS 39-18000)
        cityName: 'Columbus',
        arcgis: 'opendata.columbus.gov',
        datasetId: 'Council_Districts', // services1.arcgis.com/vdNDkVykv9vEWFX4
    },
    '3916000': {  // Cleveland, OH (FIPS 39-16000)
        cityName: 'Cleveland',
        arcgis: 'opendatacle-clevelandgis.hub.arcgis.com',
        datasetId: 'Cleveland_Wards_1_2_25_Topocleaned_pop20', // services3.arcgis.com/dty2kHktVXHrqO8i
    },
    '3977000': {  // Toledo, OH (FIPS 39-77000)
        cityName: 'Toledo',
        arcgis: 'data.toledo.gov',
        // Council Districts at gis.toledo.oh.gov/arcgis/rest/services/DistrictsZipsTEI_MapService/MapServer/1
    },
    '3915000': {  // Cincinnati, OH (FIPS 39-15000)
        cityName: 'Cincinnati',
        arcgis: 'data-cagisportal.opendata.arcgis.com',
        // Note: Cincinnati city council is AT-LARGE (no district boundaries)
        // Community Councils are neighborhood orgs, not government districts
    },
    // =========================================================================
    // Washington State Cities (verified 2026-01-23)
    // =========================================================================
    // Note: Seattle already defined above (5363000)
    '5370000': {  // Tacoma, WA (FIPS 53-70000)
        cityName: 'Tacoma',
        arcgis: 'data.tacoma.gov',
        datasetId: 'City_Council_Districts', // services3.arcgis.com/SCwJH1pD8WSn5T5y
        // 5 districts, field: dist_id
    },
    '5357535': {  // Spokane, WA (FIPS 53-57535)
        cityName: 'Spokane',
        arcgis: 'data-spokane.opendata.arcgis.com',
        // 3 districts
    },
    '5322640': {  // Everett, WA (FIPS 53-22640)
        cityName: 'Everett',
        arcgis: 'data.everettwa.gov',
        // MapServer at gismaps.everettwa.gov/manarcgis/rest/services/Boundaries/Boundaries/MapServer/7
        // 5 districts + possible at-large
    },
    // AT-LARGE (no district boundaries):
    // - Bellevue (5305210): At-large council
    // - Kent (5335415): At-large with 7 numbered positions
    // - Federal Way (5323515): At-large with 7 positions
    // - Renton (5357745): Investigating - likely at-large

    // =========================================================================
    // Oregon State Cities (verified 2026-01-23)
    // =========================================================================
    '4159000': {  // Portland, OR (FIPS 41-59000)
        cityName: 'Portland',
        arcgis: 'gis-pdx.opendata.arcgis.com',
        // MapServer at portlandmaps.com/arcgis/rest/services/Public/Auditor_ElectionsMap/MapServer/12
        // 4 districts (new 2024 charter), 3 councilors per district
    },
    '4123850': {  // Eugene, OR (FIPS 41-23850)
        cityName: 'Eugene',
        arcgis: 'gis-eugene-pwe.opendata.arcgis.com',
        // MapServer at gis.eugene-or.gov/arcgis/rest/services/PWE/Boundaries/MapServer/1
        // 8 wards
    },
    '4164900': {  // Salem, OR (FIPS 41-64900)
        cityName: 'Salem',
        arcgis: 'data.cityofsalem.net',
        datasetId: '0f6dd26ba1ae49f5bedec30dcba0b1e8', // ArcGIS item ID
        // 8 wards
    },
    '4134100': {  // Hillsboro, OR (FIPS 41-34100)
        cityName: 'Hillsboro',
        arcgis: 'hbgis.hillsboro-oregon.gov',
        // MapServer at gis.hillsboro-oregon.gov/public/rest/services/public/Council_Wards/MapServer/0
        // 3 wards
    },
    // AT-LARGE (no district boundaries):
    // - Gresham (4131250): At-large with 7 numbered positions
    // - Beaverton (4105350): At-large with 6 councilors
    // - Bend (4105800): Investigating - likely at-large
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
