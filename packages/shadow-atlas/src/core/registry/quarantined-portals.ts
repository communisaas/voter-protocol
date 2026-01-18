/**
 * Quarantined Portal Entries
 *
 * PURPOSE: Entries removed from known-portals.ts due to data quality issues
 *
 * UPDATED: 2026-01-16T21:00:00.000Z
 * GENERATOR: Manual curation + automated scripts
 *
 * WORKFLOW:
 * 1. Script identifies suspicious patterns or data quality issues
 * 2. Entries moved here with documented rationale
 * 3. Human review can restore entries if they're actually valid
 * 4. After review, these can be permanently deleted or restored
 *
 * NOTE: These entries are NOT deleted - they're quarantined for potential restoration
 */

import type { PortalType } from '../types/discovery.js';

/**
 * Quarantined portal entry with documented reason for removal
 */
export interface QuarantinedPortal {
  /** 7-digit Census PLACE FIPS code */
  readonly cityFips: string;

  /** City name (human-readable) */
  readonly cityName: string;

  /** State abbreviation (e.g., "TX", "WA") */
  readonly state: string;

  /** Portal type */
  readonly portalType: PortalType;

  /** Direct download URL (GeoJSON) */
  readonly downloadUrl: string;

  /** Number of districts/features */
  readonly featureCount: number;

  /** Last successful validation timestamp (ISO 8601) */
  readonly lastVerified: string;

  /** Validation confidence score (0-100) */
  readonly confidence: number;

  /** How this entry was discovered */
  readonly discoveredBy: 'manual' | 'automated' | 'pr-contribution' | string;

  /** Optional notes (for manual entries) */
  readonly notes?: string;

  /** WHY this entry was quarantined */
  readonly quarantineReason: string;

  /** Pattern that triggered quarantine (e.g., "pavement", "sewer", "single-feature") */
  readonly matchedPattern: string;

  /** When this entry was quarantined */
  readonly quarantinedAt: string;
}

/**
 * Quarantined portals (indexed by FIPS code)
 */
export const QUARANTINED_PORTALS: Record<string, QuarantinedPortal> = {
  // CLASSIFICATION: WRONG_DATA_LAYER
  '1753559': {
    cityFips: '1753559',
    cityName: 'North Chicago',
    state: 'IL',
    portalType: 'arcgis',
    downloadUrl: 'https://services5.arcgis.com/dUVPCTd3mmy0bK3k/arcgis/rest/services/Sanitary_Sewer_2025_Cleaning_and_Televising_Web_Map_WFL1/FeatureServer/9/query?where=1%3D1&outFields=*&f=geojson',
    featureCount: 7,
    lastVerified: '2026-01-15T00:00:00.000Z',
    confidence: 55,
    discoveredBy: 'automated',
    notes: "North Chicago IL - 7 districts, bulk ingested from \"City_Wards_Poly\"",
    quarantineReason: 'Sewer infrastructure data',
    matchedPattern: 'sewer',
    quarantinedAt: '2026-01-16T20:18:42.247Z',
  },

  '0611446': {
    cityFips: '0611446',
    cityName: 'Carpinteria',
    state: 'CA',
    portalType: 'arcgis',
    downloadUrl: 'https://services3.arcgis.com/ehLaGZNdQUxXpQo3/arcgis/rest/services/Carpinteria_City_Pavement_Condition/FeatureServer/7/query?where=1%3D1&outFields=*&f=geojson',
    featureCount: 6,
    lastVerified: '2026-01-15T00:00:00.000Z',
    confidence: 88,
    discoveredBy: 'automated',
    notes: "Carpinteria CA - 6 districts, bulk ingested from \"City_Council_Districts\"",
    quarantineReason: 'Pavement condition data, not council districts',
    matchedPattern: 'pavement',
    quarantinedAt: '2026-01-16T20:18:42.247Z',
  },

  '0645778': {
    cityFips: '0645778',
    cityName: 'Marina',
    state: 'CA',
    portalType: 'arcgis',
    downloadUrl: 'https://services5.arcgis.com/nPtzMLkb4jZLRdvG/arcgis/rest/services/22_13100_MarinaParcelViewer_WFL1/FeatureServer/3/query?where=1%3D1&outFields=*&f=geojson',
    featureCount: 4,
    lastVerified: '2026-01-15T00:00:00.000Z',
    confidence: 63,
    discoveredBy: 'automated',
    notes: "Marina CA - 4 districts, bulk ingested from \"Council Districts\"",
    quarantineReason: 'Property parcel data',
    matchedPattern: 'parcel',
    quarantinedAt: '2026-01-16T20:18:42.247Z',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // WAVE H CLEANUP (2026-01-18): County FIPS Discovery Errors - All Removed
  // 5 entries used county FIPS codes (5-digit) instead of city FIPS (7-digit).
  // All primary cities already in known-portals.ts with correct data.
  // Discovery bug: System accepted county FIPS codes as city entries.
  // ═══════════════════════════════════════════════════════════════════════════
  // REMOVED: 20177 (Shawnee County KS) → Topeka already in registry (9 districts)
  // REMOVED: 40031 (Comanche County OK) → Lawton already in registry (8 wards)
  // REMOVED: 40109 (Oklahoma County OK) → Piedmont already in registry (5 wards)
  // REMOVED: 42091 (Montgomery County PA) → Norristown in registry; layer was crime stats, not boundaries
  // REMOVED: 48029 (Bexar County TX) → San Antonio already in registry (10 districts)

  // ═══════════════════════════════════════════════════════════════════════════
  // RESOLVED TO AT-LARGE (2026-01-17): Madisonville LA, Wilmington NC, Oakwood OH
  // Moved to at-large-cities.ts - these cities have no geographic districts
  // ═══════════════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════════════
  // WAVE E RESEARCH (2026-01-17): District-based cities with wrong data source
  // These cities HAVE districts but got single-feature from wrong layer
  // RESOLUTION: Find city GIS portal with all district features
  // ═══════════════════════════════════════════════════════════════════════════

  // REMEDIATED: Baytown TX (4806128) - Moved to known-portals.ts with correct HGAC data source
  // HGAC has authoritative council district boundaries with 6 districts (1-6)
  // URL: https://gis.h-gac.com/arcgis/rest/services/Open_Data/Boundaries/MapServer/15
  // Remediated: 2026-01-17

  // RESOLVED: Arapahoe County CO (08005) - Discovery error, not a city
  // This entry used a county FIPS code (08005 = Arapahoe County), not a city FIPS.
  // The URL pointed to "Inverness_Permits_Area" (business permit zone), not council districts.
  // Major cities in Arapahoe County are already in known-portals.ts:
  // - Aurora (0804000) - 6 wards
  // - Centennial (0812815) - 4 districts
  // - Englewood (0824785) - already covered
  // - Littleton (0845255) - quarantined with exclusivity failure (separate issue)
  // RESOLUTION: Entry removed - was discovery error using county FIPS for business permit layer
  // Remediated: 2026-01-17

  // REMEDIATED: Peoria AZ (0454050) - Moved to known-portals.ts with correct city GIS source
  // Found authoritative source: https://gis.peoriaaz.gov/arcgis/rest/services/BaseMap/Council_Districts/MapServer/1
  // City of Peoria GIS Department has 6 named council districts (Acacia, Ironwood, Mesquite, Palo Verde, Pine, Willow)
  // Remediated: 2026-01-17

  // REMEDIATED: Jefferson County CO (08059) -> Arvada CO (0803455)
  // Discovery used county FIPS (08059 = Jefferson County) but layer was labeled "Arvada Council Districts"
  // The HDR engineering layer (Chelsea_Collinge_hdrinc_com) had only 1 feature - partial/project data
  // Found correct source: https://maps.arvada.org/arcgis/rest/services/CMO/City_Council/MapServer/1
  // Arvada has 4 council districts (1-4), municipal GIS server, boundaries adopted 1/23/2023
  // Moved to known-portals.ts as FIPS 0803455 (Arvada city)
  // Remediated: 2026-01-17

  // CONTRA COSTA COUNTY CITIES - All from regional layer with individual district features
  // Source: services3.arcgis.com/42Dx6OWonqK9LoEE/Districts_WEBv1_pro has each district as separate layer
  // RESOLUTION: Query all layers or find city-specific GIS source

  // REMEDIATED: Antioch CA (0602252) - Moved to known-portals.ts with correct city-operated combined layer
  // Found: https://services5.arcgis.com/9wr5naT5FqBDBXHa/arcgis/rest/services/AntiochCouncilDistrict/FeatureServer/0
  // 4 districts, municipal-gis portal. Remediated: 2026-01-17

  '0608142': {
    cityFips: '0608142',
    cityName: 'Brentwood',
    state: 'CA',
    portalType: 'arcgis',
    downloadUrl: 'https://services3.arcgis.com/42Dx6OWonqK9LoEE/arcgis/rest/services/Districts_WEBv1_pro/FeatureServer/28/query?where=1%3D1&outFields=*&f=geojson',
    featureCount: 1,
    lastVerified: '2026-01-15T00:00:00.000Z',
    confidence: 55,
    discoveredBy: 'automated',
    notes: 'RESEARCH: Has 4 council districts (CVRA transition). Official: https://www.brentwoodca.gov/government/city-council/elections',
    quarantineReason: 'WRONG_SOURCE - Contra Costa County layer has individual district features, need combined layer',
    matchedPattern: 'wrong_source_partial_data',
    quarantinedAt: '2026-01-16T00:00:00.000Z',
  },

  // REMEDIATED: Martinez CA (0646114) - Moved to known-portals.ts with webmap-embedded extraction
  // Data extracted from ArcGIS webmap feature collection using webmap-extractor.ts
  // Webmap ID: 5eb9a43de95845d48c8d56773d023609, Layer: "Adopted Districts"
  // 4 council districts successfully extracted and converted to WGS84 GeoJSON
  // Remediated: 2026-01-18

  // REMEDIATED: Oakley CA (0653070) - Moved to known-portals.ts with correct city-operated combined layer
  // Found: https://services8.arcgis.com/ql5SF28UZRL4qU2a/arcgis/rest/services/Disrict_Boundaries/FeatureServer/20
  // 5 districts, municipal-gis portal (City of Oakley General Viewer). Remediated: 2026-01-17

  // REMEDIATED: San Ramon CA (0668378) - Moved to known-portals.ts with correct city-operated combined layer
  // Found: https://utility.arcgis.com/usrsvcs/servers/4ceabe889a2d4bb68472e86e57741b3f/rest/services/Infrastructure/City_Council_Districts/FeatureServer/0
  // 4 districts, municipal-gis portal (sanramon.maps.arcgis.com). Remediated: 2026-01-17

  // REMEDIATED: Hemet CA (0633182) - Moved to known-portals.ts with correct combined layer
  // City_of_Hemet_Council_District_Map FeatureServer/0 has all 5 districts in single layer
  // URL: https://services3.arcgis.com/czrgcV6qkPuBJCRH/arcgis/rest/services/City_of_Hemet_Council_District_Map/FeatureServer/0
  // Original issue: Hemet_Council_Districts FeatureServer had split layers (0-4 each with 1 district)
  // Remediated: 2026-01-17

  // RESOLVED TO AT-LARGE (2026-01-17): Santa Monica CA
  // One of few CA cities still using at-large elections, ongoing CVRA litigation

  // REMEDIATED: Claremont CA (0613756) - Moved to known-portals.ts with webmap-embedded extraction
  // Data extracted from ArcGIS webmap feature collection using webmap-extractor.ts
  // Webmap ID: f9f59d55e7e2433b8d9a1af9f079ec82, Layer: "council district"
  // 5 council districts successfully extracted and converted to WGS84 GeoJSON
  // Architecture extended: Added 'webmap-embedded' portal type to handle embedded feature collections
  // Remediated: 2026-01-18

  // REMOVED (Wave H): 06065 (Riverside County CA) → Hemet already remediated (5 districts)
  // This was old split-layer data (FeatureServer/3 = District 4 only). Hemet uses combined layer now.

  // CLASSIFICATION: TX METRO AREA CONTAINMENT FAILURES (2026-01-16)
  // These entries show 100% containment failure due to Houston/San Antonio metro district data
  // incorrectly mapped to suburban cities. See tx-remediation-report.json for full analysis.

  // RESOLVED TO AT-LARGE: Pearland TX (4856348) - Moved to at-large-cities.ts
  // City charter specifies Mayor + 7 councilmembers elected at-large. No geographic districts.
  // Houston council data (11 districts A-K) incorrectly mapped during discovery.
  // Resolved: 2026-01-17

  // REMEDIATED: Pasadena TX (4856000) - Moved to known-portals.ts with correct HGAC data source
  // HGAC has authoritative council district boundaries with 8 districts (A-H)
  // URL: https://gis.h-gac.com/arcgis/rest/services/Open_Data/Boundaries/MapServer/15
  // Remediated: 2026-01-17

  // RESOLVED TO AT-LARGE: Galena Park TX (4827996) - Moved to at-large-cities.ts
  // City has 4 commissioner positions (at-large), not geographic districts.
  // Houston council data (HOUCity_Council_Districts) incorrectly mapped during discovery.
  // Resolved: 2026-01-17

  // RESOLVED TO AT-LARGE: Leon Valley TX (4842388) - Moved to at-large-cities.ts
  // City charter specifies Mayor + 5 councilmembers elected at-large. No geographic districts.
  // San Antonio council data (10 districts) incorrectly mapped during discovery.
  // Resolved: 2026-01-17

  // REMEDIATED: Alvin TX (4802272) - Moved to known-portals.ts with correct HGAC data source
  // HGAC has authoritative council district boundaries with 5 districts (A-E)
  // URL: https://gis.h-gac.com/arcgis/rest/services/Open_Data/Boundaries/MapServer/15
  // Remediated: 2026-01-17

  // CLASSIFICATION: WAVE D METRO BLEEDING - ArcGIS Org ID Fingerprinting (2026-01-16)
  // These entries were identified by analyzing ArcGIS org IDs to detect wrong jurisdictions.
  // See analysis-output/arcgis-org-fingerprints.json for full analysis.

  // RESOLVED TO AT-LARGE (2026-01-18): San Jacinto CA (0667112)
  // City has 5-member council elected at-large (all voters vote for all seats).
  // Registry mistakenly had Hemet city council district data (5 districts).
  // Moved to at-large-cities.ts. WS-F investigation confirmed at-large structure.

  // RESOLVED TO AT-LARGE (2026-01-18): Walnut CA (0683332)
  // City has 5-member council elected at-large (four-year terms).
  // Registry mistakenly had West Covina council district data (5 districts).
  // Moved to at-large-cities.ts. WS-F investigation confirmed at-large structure.

  '0646842': {
    cityFips: '0646842',
    cityName: 'Menifee',
    state: 'CA',
    portalType: 'arcgis',
    downloadUrl: 'https://services.arcgis.com/LNp9QekVQ7pNnS4Q/arcgis/rest/services/Council_Districts_Perris/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
    featureCount: 5,
    lastVerified: '2026-01-15T00:00:00.000Z',
    confidence: 0,
    discoveredBy: 'automated',
    notes: 'Menifee CA using Perris city council district data',
    quarantineReason: "Layer named 'Council_Districts_Perris' - Menifee explicitly using Perris council districts. Detected via ArcGIS org ID fingerprinting.",
    matchedPattern: 'wrong_municipality',
    quarantinedAt: '2026-01-16T23:00:00.000Z',
  },

  '0658520': {
    cityFips: '0658520',
    cityName: 'Poway',
    state: 'CA',
    portalType: 'arcgis',
    downloadUrl: 'https://services.arcgis.com/xOaE01KwGK9Fvnfr/arcgis/rest/services/SDRVC_AGOL_110723/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
    featureCount: 13,
    lastVerified: '2026-01-15T00:00:00.000Z',
    confidence: 0,
    discoveredBy: 'automated',
    notes: 'Poway CA using San Diego Regional data',
    quarantineReason: "SDRVC acronym indicates San Diego Regional data, not Poway city-specific. 13 districts far exceeds typical city council size. Detected via ArcGIS org ID fingerprinting.",
    matchedPattern: 'regional_data_bleeding',
    quarantinedAt: '2026-01-16T23:00:00.000Z',
  },

  '1235050': {
    cityFips: '1235050',
    cityName: 'Jacksonville Beach',
    state: 'FL',
    portalType: 'arcgis',
    downloadUrl: 'https://services.arcgis.com/r24cv1JRnR3HZXVQ/arcgis/rest/services/Jax_VZAP_WFL1/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
    featureCount: 14,
    lastVerified: '2026-01-15T00:00:00.000Z',
    confidence: 0,
    discoveredBy: 'automated',
    notes: 'Jacksonville Beach FL using Jacksonville main city data',
    quarantineReason: "'Jax_' prefix indicates Jacksonville main city data, not Jacksonville Beach. Jacksonville Beach is separate municipality. Detected via ArcGIS org ID fingerprinting.",
    matchedPattern: 'metro_bleeding_jax',
    quarantinedAt: '2026-01-16T23:00:00.000Z',
  },

  // RESOLVED TO AT-LARGE (2026-01-18): Winter Springs FL (1278325)
  // City has Mayor + 5 commissioners elected at-large (commissioners must reside in districts but elected citywide).
  // 2026 referendum may transition to single-member districts - monitor for future update.
  // Registry mistakenly had BWCF regional jurisdiction data (73 features).
  // Moved to at-large-cities.ts. WS-F investigation confirmed at-large structure.

  '3903828': {
    cityFips: '3903828',
    cityName: 'Barberton',
    state: 'OH',
    portalType: 'arcgis',
    downloadUrl: 'https://services.arcgis.com/YvJkKP3I2NydFmVT/arcgis/rest/services/Summit_County_Council_Districts_Wilson/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
    featureCount: 11,
    lastVerified: '2026-01-15T00:00:00.000Z',
    confidence: 0,
    discoveredBy: 'automated',
    notes: 'Barberton OH using Summit County council district data',
    quarantineReason: "Layer explicitly named 'Summit_County_Council_Districts' - county jurisdiction, not city of Barberton. Detected via ArcGIS org ID fingerprinting.",
    matchedPattern: 'county_for_city',
    quarantinedAt: '2026-01-16T23:00:00.000Z',
  },

  // RESOLVED TO AT-LARGE (2026-01-18): Goose Creek SC (4529815)
  // City has 6-member council elected at-large (all represent whole city).
  // Registry mistakenly contained Charleston County Political_Districts data (9 features).
  // Moved to at-large-cities.ts. WS-G subagent investigation confirmed structure.

  // RESOLVED TO AT-LARGE (2026-01-18): Bluffton SC (4507210)
  // Town has Mayor + 4 council members elected at-large (non-partisan, four-year terms).
  // Registry mistakenly had Beaufort County council district data (11 districts).
  // Moved to at-large-cities.ts. WS-F investigation confirmed at-large structure.

  // REMEDIATED (2026-01-18): Annapolis MD (2401600)
  // Found authoritative city source via ArcGIS Experience Builder:
  // https://gis.annapolis.gov/server/rest/services/Map_Services/Aldermanic_Ward_Map/MapServer/0
  // 8 aldermanic wards (1-8), official city GIS portal. Moved to known-portals.ts.
  // WS-G subagent extraction confirmed correct source.

  '0157048': {
    cityFips: '0157048',
    cityName: 'Opelika',
    state: 'AL',
    portalType: 'arcgis',
    downloadUrl: 'https://services.arcgis.com/NybqoDIlkNhsZunt/arcgis/rest/services/LEE_HB_7_WFL1/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
    featureCount: 5,
    lastVerified: '2026-01-15T00:00:00.000Z',
    confidence: 0,
    discoveredBy: 'automated',
    notes: 'Opelika AL using Lee County state legislature data',
    quarantineReason: "LEE prefix indicates Lee County. HB_7 suggests state house bill/legislative data, not city council districts. Detected via ArcGIS org ID fingerprinting.",
    matchedPattern: 'county_for_city',
    quarantinedAt: '2026-01-16T23:00:00.000Z',
  },

  '0541000': {
    cityFips: '0541000',
    cityName: 'Little Rock',
    state: 'AR',
    portalType: 'arcgis',
    downloadUrl: 'https://services.arcgis.com/wyoDVuo3QgawYe6R/arcgis/rest/services/Commercial_BPADD_City_Wards/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
    featureCount: 20,
    lastVerified: '2026-01-15T00:00:00.000Z',
    confidence: 0,
    discoveredBy: 'automated',
    notes: 'Little Rock AR using BPADD regional planning district data',
    quarantineReason: "BPADD acronym suggests regional planning district (Boone/Carroll/Madison/Newton). 20 wards exceeds typical city council size. Detected via ArcGIS org ID fingerprinting.",
    matchedPattern: 'regional_data_bleeding',
    quarantinedAt: '2026-01-16T23:00:00.000Z',
  },

  '2220575': {
    cityFips: '2220575',
    cityName: 'DeQuincy',
    state: 'LA',
    portalType: 'arcgis',
    downloadUrl: 'https://services.arcgis.com/T7YR8Q3OOFw14uBe/arcgis/rest/services/City_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
    featureCount: 22,
    lastVerified: '2026-01-15T00:00:00.000Z',
    confidence: 0,
    discoveredBy: 'automated',
    notes: 'DeQuincy LA showing 22 districts for small city',
    quarantineReason: "22 districts for small city (~3,000 population) is extremely unusual. Typical city council is 4-7 members. Data quality issue - likely regional or wrong layer. Detected via ArcGIS org ID fingerprinting.",
    matchedPattern: 'district_count_anomaly',
    quarantinedAt: '2026-01-16T23:00:00.000Z',
  },

  // CLASSIFICATION: WAVE D EXCLUSIVITY FAILURES - All True Topology Errors (2026-01-16)
  // D-3 analysis confirmed ALL 24 exclusivity failures are >150K sq m overlap (not edge rounding).
  // These require source data correction, not tolerance adjustment.
  // See analysis-output/overlap-magnitude-results.json for full analysis.

  // REMEDIATED (2026-01-18): Buckeye AZ (0407940)
  // Found authoritative city source via city GIS portal:
  // https://services9.arcgis.com/QncWUGf3mU9BLLsQ/arcgis/rest/services/Buckeye_Council_Districts_2024/FeatureServer/0
  // 6 council districts (1-6), official city GIS. Moved to known-portals.ts.
  // Original quarantine was wrong data (76 Maricopa County features). WS-G extraction confirmed.

  // REMEDIATED (2026-01-18): Fernley NV (3224900)
  // Found authoritative city source via city GIS portal:
  // https://services1.arcgis.com/WLDl3XnFRemLfNMv/arcgis/rest/services/City_Council_Wards/FeatureServer/0
  // 4 council wards (1-4), official city GIS. Moved to known-portals.ts.
  // Original quarantine was corrupted data. WS-G extraction confirmed correct source.

  // REMEDIATED (2026-01-18): Glendale AZ (0427820)
  // Found authoritative city source via city GIS portal:
  // https://services5.arcgis.com/1xQXbGF2szPz3ewe/arcgis/rest/services/Council_Districts_2022/FeatureServer/0
  // 6 council districts (Barrel, Cactus, Cholla, Ocotillo, Sahuaro, Yucca), official city GIS.
  // Moved to known-portals.ts. WS-G extraction confirmed correct source.

  '4867496': {
    cityFips: '4867496',
    cityName: 'Sherman',
    state: 'TX',
    portalType: 'arcgis',
    downloadUrl: 'https://services.arcgis.com/placeholder/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
    featureCount: 6,
    lastVerified: '2026-01-15T00:00:00.000Z',
    confidence: 0,
    discoveredBy: 'automated',
    notes: 'Sherman TX with 125M sq m overlap',
    quarantineReason: "SEVERE: 125M sq m max overlap. Complete tessellation failure in source data. True topology error requiring source correction.",
    matchedPattern: 'exclusivity_topology_error',
    quarantinedAt: '2026-01-16T23:00:00.000Z',
  },

  // REMEDIATED (2026-01-18): Elk Grove CA (0622020)
  // Found authoritative city source via city GIS portal:
  // https://services.arcgis.com/96HcpNTJZVkLrE18/arcgis/rest/services/Council_Districts/FeatureServer/0
  // 5 council districts (1-5), official city GIS. Moved to known-portals.ts.
  // Original quarantine was Sacramento County data (26 features). WS-G extraction confirmed.

  '0611530': {
    cityFips: '0611530',
    cityName: 'Carson',
    state: 'CA',
    portalType: 'arcgis',
    downloadUrl: 'https://services.arcgis.com/placeholder/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
    featureCount: 15,
    lastVerified: '2026-01-15T00:00:00.000Z',
    confidence: 0,
    discoveredBy: 'automated',
    notes: 'Carson CA with 83M sq m overlap - LA County data',
    quarantineReason: "SEVERE: 83M sq m max overlap (8.7B total). 15 districts indicates LA County supervisorial districts, not Carson city council. True topology error requiring source correction.",
    matchedPattern: 'exclusivity_topology_error',
    quarantinedAt: '2026-01-16T23:00:00.000Z',
  },

  // CLASSIFICATION: WAVE E ADDITIONAL QUARANTINE - Wrong Data Layer & Topology Errors (2026-01-16)

  '0622804': {
    cityFips: '0622804',
    cityName: 'Escondido',
    state: 'CA',
    portalType: 'arcgis',
    downloadUrl: 'https://services8.arcgis.com/bLT9wzACSnOhnxN5/arcgis/rest/services/Crime_Free_Multi_Housing_Map_WFL1/FeatureServer/2/query?where=1%3D1&outFields=*&f=geojson',
    featureCount: 53,
    lastVerified: '2026-01-15T00:00:00.000Z',
    confidence: 0,
    discoveredBy: 'automated',
    notes: 'Escondido CA using Crime_Free_Multi_Housing data, not council districts',
    quarantineReason: "Layer 'Crime_Free_Multi_Housing_Map_WFL1' is housing program data, not council districts. 53 features far exceeds council size.",
    matchedPattern: 'wrong_data_layer',
    quarantinedAt: '2026-01-16T23:30:00.000Z',
  },

  '0614218': {
    cityFips: '0614218',
    cityName: 'Clovis',
    state: 'CA',
    portalType: 'arcgis',
    downloadUrl: 'https://services3.arcgis.com/ibgDyuD2DLBge82s/arcgis/rest/services/City_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
    featureCount: 42,
    lastVerified: '2026-01-15T00:00:00.000Z',
    confidence: 0,
    discoveredBy: 'automated',
    notes: 'Clovis CA with 42 features - likely Fresno County data',
    quarantineReason: "42 districts far exceeds typical city council (4-9 members). Likely county or regional data mislabeled as city. Containment failure confirms wrong jurisdiction.",
    matchedPattern: 'district_count_anomaly',
    quarantinedAt: '2026-01-16T23:30:00.000Z',
  },

  '0665000': {
    cityFips: '0665000',
    cityName: 'San Bernardino',
    state: 'CA',
    portalType: 'arcgis',
    downloadUrl: 'https://services.arcgis.com/aA3snZwJfFkVyDuP/arcgis/rest/services/CitySanBer_Wards/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
    featureCount: 8,
    lastVerified: '2026-01-15T00:00:00.000Z',
    confidence: 0,
    discoveredBy: 'automated',
    notes: 'San Bernardino CA with exclusivity failure - topology error',
    quarantineReason: "Exclusivity failure (0.0%) indicates overlapping ward polygons. True topology error in source data requiring correction.",
    matchedPattern: 'exclusivity_topology_error',
    quarantinedAt: '2026-01-16T23:30:00.000Z',
  },

  '0606434': {
    cityFips: '0606434',
    cityName: 'Big Bear Lake',
    state: 'CA',
    portalType: 'arcgis',
    downloadUrl: 'https://services8.arcgis.com/lE870Xch82Zs8gcy/arcgis/rest/services/City_of_Big_Bear_Lake_City_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
    featureCount: 6,
    lastVerified: '2026-01-15T00:00:00.000Z',
    confidence: 0,
    discoveredBy: 'automated',
    notes: 'Big Bear Lake CA with exclusivity failure - topology error',
    quarantineReason: "Exclusivity failure (0.0%) indicates overlapping district polygons. True topology error in source data.",
    matchedPattern: 'exclusivity_topology_error',
    quarantinedAt: '2026-01-16T23:30:00.000Z',
  },

  '0845255': {
    cityFips: '0845255',
    cityName: 'Littleton',
    state: 'CO',
    portalType: 'arcgis',
    downloadUrl: 'https://services6.arcgis.com/lJUBf9F1fZJRB4zT/arcgis/rest/services/City_Council_District/FeatureServer/60/query?where=1%3D1&outFields=*&f=geojson',
    featureCount: 6,
    lastVerified: '2026-01-15T00:00:00.000Z',
    confidence: 0,
    discoveredBy: 'automated',
    notes: 'Littleton CO with exclusivity failure - topology error',
    quarantineReason: "Exclusivity failure (0.0%) indicates overlapping district polygons. True topology error in source data.",
    matchedPattern: 'exclusivity_topology_error',
    quarantinedAt: '2026-01-16T23:30:00.000Z',
  },

  // REMEDIATED (2026-01-18): DeSoto TX (4820092)
  // Found authoritative source via Texas GIS Hub:
  // https://services.arcgis.com/0L95CJ0VTaxqcmED/arcgis/rest/services/Council_Districts/FeatureServer/0
  // 6 council districts (Place 1-6), official city GIS. Moved to known-portals.ts.
  // WS-G Texas extraction subagent confirmed correct source.

  // REMEDIATED (2026-01-18): La Porte TX (4841440)
  // Found authoritative source via Texas GIS Hub / HGAC:
  // https://gis.h-gac.com/arcgis/rest/services/Open_Data/Boundaries/MapServer/15
  // 6 council districts with WHERE filter "CITYNAME = 'La Porte'". Moved to known-portals.ts.
  // WS-G Texas extraction subagent confirmed correct source.

  // REMEDIATED (2026-01-18): Little Elm TX (4843012)
  // Found authoritative source via Texas GIS Hub:
  // https://services5.arcgis.com/hPZRWCLXN3T0zHhQ/arcgis/rest/services/Little_Elm_Council_Districts/FeatureServer/0
  // 4 council districts (Place 1-4), official city GIS. Moved to known-portals.ts.
  // WS-G Texas extraction subagent confirmed correct source.

  // REMEDIATED (2026-01-18): Odessa TX (4853388)
  // Found authoritative source via city open data portal:
  // https://services7.arcgis.com/AvdqLKCq7cdFqcRB/arcgis/rest/services/City_Council_Districts/FeatureServer/0
  // 5 council districts, official city GIS. Moved to known-portals.ts.
  // WS-G Texas extraction subagent confirmed correct source.

  // REMEDIATED (2026-01-18): Taylor TX (4871948)
  // Found authoritative source via city open data portal:
  // https://services.arcgis.com/lM6dCr4E5nW4g4hB/arcgis/rest/services/Single_Member_Districts/FeatureServer/0
  // 6 single-member districts, official city GIS. Moved to known-portals.ts.
  // WS-G Texas extraction subagent confirmed correct source.

  // WAVE E: District Count Anomalies - Excessive feature counts indicate wrong data granularity

  '5539225': {
    cityFips: '5539225',
    cityName: 'Kenosha',
    state: 'WI',
    portalType: 'arcgis',
    downloadUrl: 'https://services1.arcgis.com/dEWY7aW7h9zHrSP9/arcgis/rest/services/Aldermanic_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
    featureCount: 34,
    lastVerified: '2026-01-15T00:00:00.000Z',
    confidence: 0,
    discoveredBy: 'automated',
    notes: 'Kenosha WI with 34 aldermanic districts - excessive count indicates county data',
    quarantineReason: "34 aldermanic districts far exceeds typical city council (8-15 members). Likely Kenosha County data mislabeled as city. Exclusivity failure confirms wrong data.",
    matchedPattern: 'district_count_anomaly',
    quarantinedAt: '2026-01-16T23:45:00.000Z',
  },

  '1861092': {
    cityFips: '1861092',
    cityName: 'Portage',
    state: 'IN',
    portalType: 'arcgis',
    downloadUrl: 'https://services5.arcgis.com/Qp5vz8Fz7vawwcWD/arcgis/rest/services/Council_Reps/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
    featureCount: 37,
    lastVerified: '2026-01-15T00:00:00.000Z',
    confidence: 0,
    discoveredBy: 'automated',
    notes: 'Portage IN with 37 council rep features - excessive count indicates county data',
    quarantineReason: "37 council rep features far exceeds typical city council (5-9 members). Likely Porter County data mislabeled as city. Exclusivity failure confirms wrong data.",
    matchedPattern: 'district_count_anomaly',
    quarantinedAt: '2026-01-16T23:45:00.000Z',
  },

  '1315552': {
    cityFips: '1315552',
    cityName: 'Chattahoochee Hills',
    state: 'GA',
    portalType: 'arcgis',
    downloadUrl: 'https://services1.arcgis.com/0MSEUqKaxRlEPj5g/arcgis/rest/services/City_Council_Districts/FeatureServer/16/query?where=1%3D1&outFields=*&f=geojson',
    featureCount: 50,
    lastVerified: '2026-01-15T00:00:00.000Z',
    confidence: 0,
    discoveredBy: 'automated',
    notes: 'Chattahoochee Hills GA with 50 features - excessive count indicates Fulton County data',
    quarantineReason: "50 council district features far exceeds typical city council (5-9 members). Likely Fulton County data mislabeled as city. Exclusivity failure confirms wrong data.",
    matchedPattern: 'district_count_anomaly',
    quarantinedAt: '2026-01-16T23:50:00.000Z',
  },

  // REMEDIATED (2026-01-18): Noblesville IN (1854180)
  // Found authoritative source via ArcGIS Experience Builder:
  // https://gisdata.noblesville.in.gov/arcgis/rest/services/basemap/MapServer/2
  // 6 council districts, official city GIS (gisdata.noblesville.in.gov). Moved to known-portals.ts.
  // Original quarantine was Hamilton County data (39 features). WS-G extraction confirmed.

  '1842426': {
    cityFips: '1842426',
    cityName: 'Lawrence',
    state: 'IN',
    portalType: 'arcgis',
    downloadUrl: 'https://gis1.hamiltoncounty.in.gov/arcgis/rest/services/HamCoPolitical/FeatureServer/7/query?where=1%3D1&outFields=*&f=geojson',
    featureCount: 39,
    lastVerified: '2026-01-15T00:00:00.000Z',
    confidence: 0,
    discoveredBy: 'automated',
    notes: 'Lawrence IN using Hamilton County GIS data (hamiltoncounty.in.gov)',
    quarantineReason: "URL points to gis1.hamiltoncounty.in.gov - Hamilton County GIS, not Lawrence city. Containment failure confirms county data bleeding.",
    matchedPattern: 'county_for_city',
    quarantinedAt: '2026-01-16T23:55:00.000Z',
  },

  // REMEDIATED (2026-01-18): Ocala FL (1250750) - FALSE POSITIVE
  // WS-F subagent investigation verified official city source:
  // https://gis.ocalafl.org/arcgis/rest/services/Public/Districts/FeatureServer/0
  // 5 council districts (District 1-5), official city GIS (gis.ocalafl.org).
  // Moved to known-portals.ts. Original quarantine was false positive (wrong feature count).

  '1745889': {
    cityFips: '1745889',
    cityName: 'Macomb',
    state: 'IL',
    portalType: 'arcgis',
    downloadUrl: 'https://services9.arcgis.com/yKAN6qXNTxhi4ojw/arcgis/rest/services/Macomb City Council/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
    featureCount: 8,
    lastVerified: '2026-01-15T00:00:00.000Z',
    confidence: 0,
    discoveredBy: 'automated',
    notes: 'Macomb IL with exclusivity failure - overlapping district polygons',
    quarantineReason: "Exclusivity failure (0.0%) indicates overlapping district polygons. Wave D-3 analysis confirms true topology error.",
    matchedPattern: 'exclusivity_topology_error',
    quarantinedAt: '2026-01-17T00:00:00.000Z',
  },

  // WAVE E: PARTIAL DATA SOURCES
  '2240735': {
    cityFips: '2240735',
    cityName: 'Lafayette',
    state: 'LA',
    portalType: 'arcgis',
    downloadUrl: 'https://services5.arcgis.com/riEeMHAEYSsj4tFW/arcgis/rest/services/North_Lafayette_City_Council_Districts_1_and_5/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
    featureCount: 2,
    lastVerified: '2026-01-15T00:00:00.000Z',
    confidence: 0,
    discoveredBy: 'automated',
    notes: 'Lafayette LA - partial data (North Lafayette only, districts 1 and 5)',
    quarantineReason: "Data source is explicitly North_Lafayette_City_Council_Districts_1_and_5 - only districts 1 and 5 from North Lafayette area, not full city council. 44.1% coverage confirms partial data. Need full Lafayette city council data source.",
    matchedPattern: 'partial_data',
    quarantinedAt: '2026-01-17T00:00:00.000Z',
  },

  '0908000': {
    cityFips: '0908000',
    cityName: 'Bridgeport',
    state: 'CT',
    portalType: 'arcgis',
    downloadUrl: 'https://services6.arcgis.com/OW4xtrE9QlSWSIuq/arcgis/rest/services/Council_Districts_Individual/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
    featureCount: 2,
    lastVerified: '2026-01-15T00:00:00.000Z',
    confidence: 0,
    discoveredBy: 'automated',
    notes: 'Bridgeport CT - wrong data (only 2 features, city has 20 council members)',
    quarantineReason: "Bridgeport has 20-member city council (10 at-large + 10 district). Data source shows only 2 features (10.6% coverage). Council_Districts_Individual layer is likely partial selection, not complete district data. Need authoritative source.",
    matchedPattern: 'wrong_feature_count',
    quarantinedAt: '2026-01-17T00:00:00.000Z',
  },

  '1237775': {
    cityFips: '1237775',
    cityName: 'Lake City',
    state: 'FL',
    portalType: 'arcgis',
    downloadUrl: 'https://services2.arcgis.com/YVPpOPBW4olX4zrM/arcgis/rest/services/SOE_WebMap_10_5_1/FeatureServer/6/query?where=1%3D1&outFields=*&f=geojson',
    featureCount: 13,
    lastVerified: '2026-01-15T00:00:00.000Z',
    confidence: 0,
    discoveredBy: 'automated',
    notes: 'Lake City FL - 13 features (suspiciously high for small city)',
    quarantineReason: "Lake City FL (pop ~12,000) has 5-member city council but data shows 13 features. 83.7% coverage and high district count suggests Columbia County data, not Lake City city council. SOE_WebMap layer is Supervisor of Elections (county-level). Need city-specific source.",
    matchedPattern: 'county_for_city',
    quarantinedAt: '2026-01-17T00:00:00.000Z',
  },

  // WAVE E: SEVERE CONTAINMENT FAILURES (>90% outside boundary)
  // Tessellation validation found these entries have districts almost entirely outside city limits
  // indicating wrong data sources (county, metro, or wrong geography)

  '2053775': {
    cityFips: '2053775',
    cityName: 'Overland Park',
    state: 'KS',
    portalType: 'arcgis',
    downloadUrl: 'https://services7.arcgis.com/3wwljqzg0lhG1rav/arcgis/rest/services/DisplayMapWGS1/FeatureServer/8/query?where=1%3D1&outFields=*&f=geojson',
    featureCount: 4,
    lastVerified: '2026-01-15T00:00:00.000Z',
    confidence: 0,
    discoveredBy: 'automated',
    notes: 'Overland Park KS - 4 ward boundaries, 99.9% outside city limits',
    quarantineReason: "Containment failure: 99.9% of districts outside municipal boundary. DisplayMapWGS1 layer contains wrong ward data - boundaries don't match Overland Park city limits. Need city-specific ward boundaries.",
    matchedPattern: 'containment_failure',
    quarantinedAt: '2026-01-17T12:00:00.000Z',
  },

  '3146520': {
    cityFips: '3146520',
    cityName: 'Springfield',
    state: 'NE',
    portalType: 'arcgis',
    downloadUrl: 'https://services.arcgis.com/OiG7dbwhQEWoy77N/arcgis/rest/services/ElectionAdmin_BV_vw/FeatureServer/8/query?where=1%3D1&outFields=*&f=geojson',
    featureCount: 19,
    lastVerified: '2026-01-15T00:00:00.000Z',
    confidence: 0,
    discoveredBy: 'automated',
    notes: 'Springfield NE - 19 city wards, 96.8% outside city limits',
    quarantineReason: "Containment failure: 96.8% of districts outside municipal boundary. 19 wards for small village (~1,500 pop) indicates county/regional data. ElectionAdmin layer likely Sarpy County data, not Springfield village.",
    matchedPattern: 'county_for_city',
    quarantinedAt: '2026-01-17T12:00:00.000Z',
  },

  // RESOLVED TO AT-LARGE (2026-01-18): Old Westbury NY (3654705)
  // Typical NY village structure: Mayor + 4 trustees elected at-large (village-wide).
  // No geographic districts exist - standard village government.
  // Registry had CitizenServeMapCouncilDist data from wrong municipality.
  // Moved to at-large-cities.ts. WS-F subagent investigation confirmed structure.

  // NEEDS BOUNDARY VERIFICATION (2026-01-18): Morrisville NC (3746060)
  // CORRECTION: This is NOT at-large! City has HYBRID system:
  // - 4 district representatives elected by district
  // - 2 at-large council members elected citywide
  // - Mayor elected at-large
  // Valid district data exists at:
  // https://services1.arcgis.com/a7CWfuGP5ZnLYE7I/arcgis/rest/services/MorrisvilleTownCouncilDistricts/FeatureServer/0
  // Containment failure (100% outside) indicates boundary mismatch between:
  // - Council district data (possibly newer redistricting)
  // - TIGER municipal boundary (possibly outdated annexation)
  // ACTION: Verify boundary sources, potentially update TIGER reference
  // WS-F subagent investigation 2026-01-18 identified classification error

  // REMEDIATED (2026-01-18): Westlake OH (3983622)
  // Found authoritative source via ArcGIS Experience Builder:
  // https://services.arcgis.com/KF3pxKfKhP4sAQQj/arcgis/rest/services/Council_Wards/FeatureServer/0
  // 6 council wards (Ward 1-6), official city GIS. Moved to known-portals.ts.
  // Original quarantine was Cuyahoga County data (11 features). WS-G extraction confirmed.

  // VERIFIED AT-LARGE (2026-01-18): Gresham OR (4131250)
  // City has 6 councilors elected at-large by position + at-large mayor. Already in at-large-cities.ts.
  // Charter Review Committee (2021-2023) recommended transition to 4-district system with RCV.
  // District transition pending future voter approval - no change yet.
  // Registry mistakenly had Portland Metro Council Districts data (6 features, 95% outside city).
  // WS-F investigation confirmed at-large structure. Entry already in at-large-cities.ts.
};

/**
 * Count of quarantined entries
 *
 * WAVE E UPDATE (2026-01-17):
 * - Removed 4 entries resolved to at-large-cities.ts (Santa Monica CA, Wilmington NC, Oakwood OH, Madisonville LA)
 * - Changed 9 entries from single-feature to wrong_source_partial_data (district-based cities with incorrect data source)
 * - REMEDIATED: Baytown TX (4806128) - HGAC source validated with 6 districts
 * - REMEDIATED: Antioch CA (0602252) - City-operated combined layer found
 * - REMEDIATED: Oakley CA (0653070) - City-operated combined layer found
 * - REMEDIATED: San Ramon CA (0668378) - City-operated combined layer found
 * - REMEDIATED: Peoria AZ (0454050) - City GIS MapServer found with 6 named districts
 * - REMEDIATED: Hemet CA (0633182) - Found City_of_Hemet_Council_District_Map combined layer with 5 districts
 * - RESOLVED: Arapahoe County CO (08005) - Discovery error (county FIPS, not city). Cities already in registry.
 * - REMEDIATED: Jefferson County CO (08059) -> Arvada CO (0803455) - Municipal GIS with 4 districts
 * - RESOLVED TO AT-LARGE: Pearland TX (4856348), Galena Park TX (4827996), Leon Valley TX (4842388)
 * - REMEDIATED: Claremont CA (0613756), Martinez CA (0646114) - webmap-embedded extraction
 *
 * WAVE F UPDATE (2026-01-18):
 * - RESOLVED TO AT-LARGE: Bluffton SC (4507210) - county_for_city pattern, confirmed at-large elections
 * - RESOLVED TO AT-LARGE: San Jacinto CA (0667112) - wrong_municipality pattern, confirmed at-large
 * - RESOLVED TO AT-LARGE: Walnut CA (0683332) - wrong_municipality pattern, confirmed at-large
 * - RESOLVED TO AT-LARGE: Winter Springs FL (1278325) - regional_data_bleeding, confirmed at-large
 * - VERIFIED AT-LARGE: Gresham OR (4131250) - already in at-large-cities.ts, updated notes
 * - Comprehensive subagent research identified resolvable patterns for remaining quarantine entries
 *
 * WAVE G UPDATE (2026-01-18):
 * - RESOLVED TO AT-LARGE: Goose Creek SC (4529815) - county_for_city, confirmed at-large elections
 * - REMEDIATED: Annapolis MD (2401600) - Found city GIS with 8 aldermanic wards
 * - REMEDIATED: Buckeye AZ (0407940) - Found city GIS with 6 council districts
 * - REMEDIATED: Fernley NV (3224900) - Found city GIS with 4 council wards
 * - REMEDIATED: Glendale AZ (0427820) - Found city GIS with 6 named districts
 * - REMEDIATED: Elk Grove CA (0622020) - Found city GIS with 5 council districts
 * - REMEDIATED: DeSoto TX (4820092) - Texas GIS Hub with 6 districts
 * - REMEDIATED: La Porte TX (4841440) - HGAC with 6 districts
 * - REMEDIATED: Little Elm TX (4843012) - Texas GIS Hub with 4 districts
 * - REMEDIATED: Odessa TX (4853388) - City portal with 5 districts
 * - REMEDIATED: Taylor TX (4871948) - City portal with 6 single-member districts
 * - REMEDIATED: Noblesville IN (1854180) - City GIS with 6 council districts
 * - REMEDIATED: Westlake OH (3983622) - City GIS with 6 council wards
 * - FALSE POSITIVE REMEDIATED: Ocala FL (1250750) - Already documented in Wave F.2
 */
export const QUARANTINE_COUNT = 35;

/**
 * Quarantine summary by pattern
 *
 * WAVE F UPDATE (2026-01-18): Resolved 5 more entries to at-large-cities.ts
 * WAVE F.2 SUBAGENT UPDATE (2026-01-18):
 * - Old Westbury NY → at-large (containment_failure -1)
 * - Morrisville NC → boundary verification needed (removed from at-large-cities.ts, district data exists!)
 * - Ocala FL → FALSE POSITIVE (exclusivity_topology_error -1, valid 5-district source)
 *
 * WAVE G UPDATE (2026-01-18):
 * - Removed 14 entries: 1 at-large + 13 remediated to known-portals
 * - county_for_city: -4 (Goose Creek SC→at-large, Annapolis MD, Noblesville IN, Westlake OH→remediated)
 * - exclusivity_topology_error: -9 (Buckeye AZ, Fernley NV, Glendale AZ, Elk Grove CA, DeSoto TX, La Porte TX, Little Elm TX, Odessa TX, Taylor TX)
 */
export const QUARANTINE_SUMMARY = {
  "sewer": 1,
  "pavement": 1,
  "parcel": 1,
  "single-feature": 6, // Was 8, -2 CO county entries resolved
  "wrong_source_partial_data": 1, // Remaining: Brentwood CA (VertiGIS/Geocortex, no public data)
  "metro_bleeding_houston": 0, // Resolved to at-large: Pearland TX
  "metro_bleeding_houston_explicit": 0, // Resolved to at-large: Galena Park TX
  "metro_bleeding_san_antonio": 0, // Resolved to at-large: Leon Valley TX
  "county_for_city": 6, // Was 10, -4 Wave G (Goose Creek→at-large, Annapolis/Noblesville/Westlake→remediated)
  "wrong_municipality": 1, // Was 3, -2 San Jacinto CA, Walnut CA (both at-large)
  "regional_data_bleeding": 2, // Was 4, -2 Winter Springs FL, Gresham OR (both at-large)
  "metro_bleeding_jax": 1,
  "district_count_anomaly": 5,
  "exclusivity_topology_error": 6, // Was 15, -9 Wave G (Buckeye, Fernley, Glendale, Elk Grove, DeSoto, La Porte, Little Elm, Odessa, Taylor)
  "wrong_data_layer": 1,
  "partial_data": 1,
  "wrong_feature_count": 1,
  "containment_failure": 1, // Was 3, -1 Old Westbury NY (at-large), -1 Morrisville NC (has valid districts, boundary issue)
  "boundary_verification_needed": 1, // NEW: Morrisville NC - valid district data but boundary mismatch
};
