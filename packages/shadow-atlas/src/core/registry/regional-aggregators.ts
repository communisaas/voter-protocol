/**
 * Regional GIS Aggregator Registry
 *
 * PHILOSOPHY: Regional aggregators (COGs, counties, state agencies) often host
 * council district data for dozens of cities in a single layer. One successful
 * extraction yields 10-50x the results of individual city searches.
 *
 * PRIORITY RANKING (by expected yield):
 * - P0: 25+ cities expected (Maricopa, TX Major Cities)
 * - P1: 15-25 cities expected (SANDAG, HGAC, MassGIS, NJGIN)
 * - P2: 5-15 cities expected (smaller COGs, county portals, individual city portals)
 *
 * NOTE: Some states (e.g., Florida) have NO statewide council district aggregators.
 * Council districts must be obtained from individual city/county GIS portals.
 *
 * INTEGRATION:
 * Used by BulkDistrictDiscovery.extractFromAggregator() to:
 * 1. Query the aggregator endpoint
 * 2. Enumerate unique municipalities in the layer
 * 3. Generate per-city download URLs with WHERE clause filters
 * 4. Cross-reference with existing registry to avoid duplicates
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

/**
 * Aggregator priority tier
 *
 * Determines extraction order for parallel agent dispatch.
 */
export type AggregatorPriority = 'P0' | 'P1' | 'P2';

/**
 * Aggregator layer type
 *
 * Identifies what kind of boundaries the aggregator provides.
 */
export type AggregatorLayerType =
  | 'council_districts'  // Municipal council/ward districts
  | 'wards'              // Same as council districts (different naming)
  | 'precincts'          // Voting precincts (can derive wards in some states)
  | 'mixed';             // Contains multiple boundary types

/**
 * Regional GIS Aggregator configuration
 *
 * Defines how to extract multi-city data from a regional source.
 */
export interface RegionalAggregator {
  /** Unique identifier for this aggregator */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /** Geographic coverage description */
  readonly coverage: string;

  /** State(s) covered */
  readonly states: readonly string[];

  /** Extraction priority */
  readonly priority: AggregatorPriority;

  /** Estimated number of cities in this aggregator */
  readonly estimatedCities: number;

  /** Base ArcGIS REST endpoint URL */
  readonly endpointUrl: string;

  /** Layer type */
  readonly layerType: AggregatorLayerType;

  /** Field containing city/municipality name */
  readonly cityField: string;

  /** Alternative city field names to try (in order) */
  readonly cityFieldAliases?: readonly string[];

  /** Field containing district/ward identifier */
  readonly districtField: string;

  /** Alternative district field names to try */
  readonly districtFieldAliases?: readonly string[];

  /** Expected total feature count (for validation) */
  readonly expectedFeatureCount?: number;

  /** Last verified date (ISO 8601) */
  readonly lastVerified: string;

  /** Data source/authority notes */
  readonly notes: string;

  /** Confidence score (0-100) for extracted data */
  readonly confidence: number;

  /** Whether extraction is currently working */
  readonly status: 'active' | 'deprecated' | 'needs-verification';
}

/**
 * Multi-city extraction result from an aggregator
 */
export interface AggregatorExtractionResult {
  /** Aggregator ID */
  readonly aggregatorId: string;

  /** Cities successfully extracted */
  readonly cities: readonly ExtractedCity[];

  /** Cities that failed extraction */
  readonly failures: readonly ExtractionFailure[];

  /** Total features in source layer */
  readonly totalFeatures: number;

  /** Extraction timestamp */
  readonly extractedAt: string;
}

/**
 * Single city extracted from aggregator
 */
export interface ExtractedCity {
  /** City name as found in aggregator */
  readonly cityName: string;

  /** State abbreviation */
  readonly state: string;

  /** FIPS code (if resolved) */
  readonly fips: string | null;

  /** Number of districts/wards */
  readonly districtCount: number;

  /** Download URL with WHERE clause filter */
  readonly downloadUrl: string;

  /** Confidence score */
  readonly confidence: number;
}

/**
 * Extraction failure record
 */
export interface ExtractionFailure {
  readonly cityName: string;
  readonly reason: string;
}

// ============================================================================
// Regional Aggregator Registry
// ============================================================================

/**
 * Regional GIS Aggregators
 *
 * Ordered by priority (P0 first), then by estimated yield.
 */
export const REGIONAL_AGGREGATORS: Record<string, RegionalAggregator> = {
  // =========================================================================
  // P0: High-yield aggregators (25+ cities)
  // =========================================================================

  'maricopa-county-az': {
    id: 'maricopa-county-az',
    name: 'Maricopa County GIS',
    coverage: 'All incorporated cities in Maricopa County, Arizona',
    states: ['AZ'],
    priority: 'P0',
    estimatedCities: 25,
    endpointUrl: 'https://services.arcgis.com/ykpntM6e3tHvzKRJ/arcgis/rest/services/Maricopa_County_City_Council_Districts/FeatureServer/0',
    layerType: 'council_districts',
    cityField: 'Juris',
    districtField: 'Ward',
    lastVerified: '2026-01-23',
    notes: 'Maricopa County regional GIS - covers Phoenix metro including Scottsdale, Mesa, Tempe, Gilbert, Chandler, Glendale, Peoria, Surprise, Goodyear, Avondale, Buckeye, etc.',
    confidence: 90,
    status: 'active',
  },

  'scag-ca': {
    id: 'scag-ca',
    name: 'Southern California Association of Governments (SCAG)',
    coverage: 'LA, Orange, Riverside, San Bernardino, Ventura, Imperial counties',
    states: ['CA'],
    priority: 'P2',
    estimatedCities: 0,
    endpointUrl: 'https://maps.scag.ca.gov/scaggis/rest/services/OpenData/City_Boundaries/MapServer/0',
    layerType: 'mixed',
    cityField: 'CITY',
    cityFieldAliases: ['City', 'CITYNAME', 'CityName'],
    districtField: 'DISTRICT',
    districtFieldAliases: ['District', 'DIST', 'CD'],
    lastVerified: '2026-01-24',
    notes: 'VERIFIED 2026-01-24: SCAG does NOT have city council districts layer. Only has: (1) City_Boundaries - 191 cities, no council districts; (2) State legislative districts (Assembly/Senate/Congress); (3) County supervisorial districts. City council districts must be obtained from individual city GIS portals. SCAG REST services: https://maps.scag.ca.gov/scaggis/rest/services/OpenData',
    confidence: 0,
    status: 'deprecated',
  },

  'florida-fgdl': {
    id: 'florida-fgdl',
    name: 'Florida Geographic Data Library (FGDL)',
    coverage: 'Statewide Florida - NO council districts available',
    states: ['FL'],
    priority: 'P2',
    estimatedCities: 0,
    endpointUrl: 'https://ca.dep.state.fl.us/arcgis/rest/services',
    layerType: 'mixed',
    cityField: 'NAME',
    districtField: 'DISTRICT',
    lastVerified: '2026-01-23',
    notes: 'DEPRECATED - Florida has NO statewide council district aggregator. FGDL/DEP only has environmental data. FDOT Admin_Boundaries (gis.fdot.gov) has city boundaries (layer 7) but NOT council districts. Council districts are maintained by individual cities. Use florida-city-portals entries below.',
    confidence: 0,
    status: 'deprecated',
  },

  // =========================================================================
  // P1: Medium-yield aggregators (15-25 cities)
  // =========================================================================

  'sandag-ca': {
    id: 'sandag-ca',
    name: 'San Diego Association of Governments (SANDAG)',
    coverage: 'San Diego County municipalities with district-based councils',
    states: ['CA'],
    priority: 'P1',
    estimatedCities: 14,
    endpointUrl: 'https://geo.sandag.org/server/rest/services/Hosted/Council_Districts/FeatureServer/0',
    layerType: 'council_districts',
    cityField: 'jur_name',
    cityFieldAliases: ['JUR_NAME'],
    districtField: 'district',
    districtFieldAliases: ['DISTRICT'],
    expectedFeatureCount: 61,
    lastVerified: '2026-01-23',
    notes: 'SANDAG/SanGIS consolidated council districts. 14 cities with districts: San Diego (9), Chula Vista (4), Escondido (4), Oceanside (4), Carlsbad (4), El Cajon (4), Vista (4), San Marcos (4), Encinitas (4), National City (4), Santee (4), Poway (4), Imperial Beach (4), Solana Beach (4). AT-LARGE cities NOT in layer: La Mesa, Del Mar, Lemon Grove, Coronado.',
    confidence: 95,
    status: 'active',
  },

  'hgac-tx': {
    id: 'hgac-tx',
    name: 'Houston-Galveston Area Council (HGAC)',
    coverage: 'Houston metropolitan area (13 counties)',
    states: ['TX'],
    priority: 'P1',
    estimatedCities: 20,
    endpointUrl: 'https://gis.h-gac.com/arcgis/rest/services/Open_Data/Boundaries/MapServer/15',
    layerType: 'council_districts',
    cityField: 'CITY',
    districtField: 'DISTRICT',
    expectedFeatureCount: 97,
    lastVerified: '2026-01-23',
    notes: 'H-GAC Open Data Boundaries layer 15 (HGAC_City_Council_District_Boundaries). 20 cities verified: Alvin (5), Baytown (6), Clute (5), El Campo (4), Freeport (4), Fulshear (5), Galveston (6), Hitchcock (4), Houston (11), Huntsville (4), Iowa Colony (3), Katy (2), La Marque (4), La Porte (6), Missouri City (4), Pasadena (8), Rosenberg (4), Sugar Land (4), Texas City (4), Wharton (4).',
    confidence: 95,
    status: 'active',
  },

  'nctcog-tx': {
    id: 'nctcog-tx',
    name: 'North Central Texas Council of Governments (NCTCOG)',
    coverage: 'Dallas-Fort Worth metropolitan area (16 counties)',
    states: ['TX'],
    priority: 'P2',
    estimatedCities: 0,
    endpointUrl: 'https://geospatial.nctcog.org/map/rest/services/Boundaries/Boundaries/MapServer',
    layerType: 'mixed',
    cityField: 'NAME',
    districtField: 'DISTRICT',
    lastVerified: '2026-01-23',
    notes: 'NCTCOG Boundaries layer has city boundaries (layer 6) but NO council districts. Only has congressional, state senate, state house, and school districts. Individual cities must be queried directly.',
    confidence: 50,
    status: 'deprecated',
  },

  'tx-major-cities': {
    id: 'tx-major-cities',
    name: 'Texas Major City Council Districts',
    coverage: 'Dallas, Fort Worth, Austin, Houston, San Antonio',
    states: ['TX'],
    priority: 'P0',
    estimatedCities: 5,
    endpointUrl: 'https://services7.arcgis.com/ZodPOMBKsdAsTqF4/arcgis/rest/services/TX_Major_City_Council_Districts_25/FeatureServer/11',
    layerType: 'council_districts',
    cityField: 'City',
    districtField: 'District',
    districtFieldAliases: ['DistrictID'],
    expectedFeatureCount: 55,
    lastVerified: '2026-01-23',
    notes: 'ArcGIS Online aggregated layer with 5 major TX cities: Austin (10), Dallas (14), Fort Worth (10), Houston (11), San Antonio (10). Maintained by InSite EFS. Includes representative contact info.',
    confidence: 90,
    status: 'active',
  },

  'dallas-tx': {
    id: 'dallas-tx',
    name: 'City of Dallas Council Districts',
    coverage: 'City of Dallas, Texas',
    states: ['TX'],
    priority: 'P2',
    estimatedCities: 1,
    endpointUrl: 'https://gis.dallascityhall.com/arcgis/rest/services/Basemap/CouncilAreas/MapServer/0',
    layerType: 'council_districts',
    cityField: 'DISTRICT',
    districtField: 'COUNCIL',
    districtFieldAliases: ['DISTRICT'],
    expectedFeatureCount: 14,
    lastVerified: '2026-01-23',
    notes: 'Official City of Dallas GIS. 14 council districts. Redistricted 2022, effective May 2023. Fields: COUNCIL (integer 1-14), DISTRICT (string), COUNCILPER (council member name).',
    confidence: 98,
    status: 'active',
  },

  'fort-worth-tx': {
    id: 'fort-worth-tx',
    name: 'City of Fort Worth Council Districts',
    coverage: 'City of Fort Worth, Texas',
    states: ['TX'],
    priority: 'P2',
    estimatedCities: 1,
    endpointUrl: 'https://mapit.fortworthtexas.gov/ags/rest/services/CIVIC/OpenData_Boundaries/MapServer/2',
    layerType: 'council_districts',
    cityField: 'NAME',
    districtField: 'DISTRICT',
    expectedFeatureCount: 10,
    lastVerified: '2026-01-23',
    notes: 'Official City of Fort Worth Open Data. 10 council districts (numbered 2-11, Mayor is district 1 but city-wide). Redistricted 2022. Fields: NAME, DISTRICT, DATESTAMP.',
    confidence: 98,
    status: 'active',
  },

  'massgis-ma': {
    id: 'massgis-ma',
    name: 'MassGIS (Massachusetts)',
    coverage: 'Statewide Massachusetts wards and precincts',
    states: ['MA'],
    priority: 'P1',
    estimatedCities: 50,
    endpointUrl: 'https://services6.arcgis.com/hNDcO07QfnsUMldG/arcgis/rest/services/WARDSPRECINCTS2022_POLY/FeatureServer/0',
    layerType: 'wards',
    cityField: 'TOWN',
    districtField: 'WARD',
    districtFieldAliases: ['PRECINCT'],
    expectedFeatureCount: 2200,
    lastVerified: '2026-01-22',
    notes: 'MassGIS 2022 Wards and Precincts - authoritative state source. Cities have wards, towns have precincts. Filter on WARD IS NOT NULL for ward-based cities only.',
    confidence: 95,
    status: 'active',
  },

  'njgin-nj': {
    id: 'njgin-nj',
    name: 'NJGIN (New Jersey)',
    coverage: 'Statewide New Jersey ward boundaries',
    states: ['NJ'],
    priority: 'P1',
    estimatedCities: 40,
    endpointUrl: 'https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/ArcGIS/rest/services/Ward_Boundaries_for_New_Jersey/FeatureServer/0',
    layerType: 'wards',
    cityField: 'MUN_NAME',
    cityFieldAliases: ['MUN_LABEL', 'NAME', 'MUNICIPALITY'],
    districtField: 'WARD_CODE',
    districtFieldAliases: ['WARD'],
    expectedFeatureCount: 829,
    lastVerified: '2026-01-24',
    notes: 'NJGIN Ward Boundaries - statewide layer. Municipalities with WARD_CODE="00" are at-large. Filter on WARD_CODE != "00" for district-based only.',
    confidence: 95,
    status: 'active',
  },

  // =========================================================================
  // Pennsylvania - No statewide ward endpoint exists. Data distributed across
  // county/city MapServer layers hosted on PASDA (mapservices.pasda.psu.edu).
  //
  // VERIFIED 2026-01-23:
  // - Philadelphia: 10 council districts (layer 29), 66 wards (layer 19)
  // - Pittsburgh: 9 council districts (layer 10), 35 wards (layer 35)
  // - Allegheny County: 13 county council districts (layer 14)
  // - Lehigh County: 33 wards across 5 municipalities (layer 6)
  // - Berks County: Reading (20 wards) via precincts layer (layer 3)
  // - York County: 8 municipalities with wards via voting districts (layer 26)
  //
  // NOT YET AVAILABLE ON PASDA:
  // - Erie: No PASDA MapServer found; city portal needs investigation
  // - Scranton/Lackawanna County: Returns 404; needs alternative source
  // - Lancaster: No ward/council layer in LancasterCounty MapServer
  // - Harrisburg/Dauphin County: Only parcels and streets, no wards
  // =========================================================================

  'philadelphia-pa': {
    id: 'philadelphia-pa',
    name: 'Philadelphia City Council Districts (PASDA)',
    coverage: 'City of Philadelphia, Pennsylvania',
    states: ['PA'],
    priority: 'P1',
    estimatedCities: 1,
    endpointUrl: 'https://mapservices.pasda.psu.edu/server/rest/services/pasda/CityPhilly/MapServer/29',
    layerType: 'council_districts',
    cityField: 'DISTRICT',
    districtField: 'DISTRICT',
    expectedFeatureCount: 10,
    lastVerified: '2026-01-23',
    notes: 'Philadelphia Planning Council Districts 2024. 10 council districts. Also has 66 wards in layer 19 (WARD_NUM field) for precinct-level data.',
    confidence: 95,
    status: 'active',
  },

  'pittsburgh-pa': {
    id: 'pittsburgh-pa',
    name: 'Pittsburgh City Council Districts (PASDA)',
    coverage: 'City of Pittsburgh, Pennsylvania',
    states: ['PA'],
    priority: 'P1',
    estimatedCities: 1,
    endpointUrl: 'https://mapservices.pasda.psu.edu/server/rest/services/pasda/PittsburghCity/MapServer/10',
    layerType: 'council_districts',
    cityField: 'council',
    districtField: 'council',
    districtFieldAliases: ['council_di'],
    expectedFeatureCount: 9,
    lastVerified: '2026-01-23',
    notes: 'Pittsburgh City Council Districts. 9 council districts (1-9). Also has 35 wards in layer 35.',
    confidence: 95,
    status: 'active',
  },

  'allegheny-county-pa': {
    id: 'allegheny-county-pa',
    name: 'Allegheny County Council Districts (PASDA)',
    coverage: 'Allegheny County, Pennsylvania (includes Pittsburgh suburbs)',
    states: ['PA'],
    priority: 'P2',
    estimatedCities: 1,
    endpointUrl: 'https://mapservices.pasda.psu.edu/server/rest/services/pasda/AlleghenyCounty/MapServer/14',
    layerType: 'council_districts',
    cityField: 'LABEL',
    districtField: 'District',
    expectedFeatureCount: 13,
    lastVerified: '2026-01-23',
    notes: 'Allegheny County Council Districts 2012. 13 county council districts. Does NOT include city-level council districts for municipalities within the county.',
    confidence: 90,
    status: 'active',
  },

  'lehigh-county-pa': {
    id: 'lehigh-county-pa',
    name: 'Lehigh County Wards (PASDA)',
    coverage: 'Lehigh County municipalities with wards (Allentown, Bethlehem portion, Fountain Hill, Salisbury, Slatington)',
    states: ['PA'],
    priority: 'P2',
    estimatedCities: 5,
    endpointUrl: 'https://mapservices.pasda.psu.edu/server/rest/services/pasda/LehighCounty/MapServer/6',
    layerType: 'wards',
    cityField: 'MUNI_WARD',
    districtField: 'FIRST_WARD',
    expectedFeatureCount: 33,
    lastVerified: '2026-01-23',
    notes: 'Lehigh County Wards 2021. Covers: Allentown (19 wards, prefix 02), Bethlehem-Lehigh portion (4 wards, prefix 03), Fountain Hill (2 wards, prefix 08), Salisbury (5 wards, prefix 17), Slatington (3 wards, prefix 18). Use municipal boundary layer (4) to decode MUNI_WARD prefixes.',
    confidence: 90,
    status: 'active',
  },

  'berks-county-pa': {
    id: 'berks-county-pa',
    name: 'Berks County Precincts/Wards (PASDA)',
    coverage: 'Reading and Berks County municipalities with wards',
    states: ['PA'],
    priority: 'P2',
    estimatedCities: 1,
    endpointUrl: 'https://mapservices.pasda.psu.edu/server/rest/services/pasda/BerksCounty/MapServer/3',
    layerType: 'wards',
    cityField: 'MUNI_NAME',
    districtField: 'WARD_NO',
    lastVerified: '2026-01-23',
    notes: 'Berks County Precincts 2024. Reading has 20 wards (WARD_NO field). Filter: MUNI_NAME=READING. Also includes PA House/Senate/US Congressional district IDs.',
    confidence: 90,
    status: 'active',
  },

  'york-county-pa': {
    id: 'york-county-pa',
    name: 'York County Voting Districts (PASDA)',
    coverage: 'York County municipalities with wards (York City, Hanover, West York, etc.)',
    states: ['PA'],
    priority: 'P2',
    estimatedCities: 8,
    endpointUrl: 'https://mapservices.pasda.psu.edu/server/rest/services/pasda/YorkCounty/MapServer/26',
    layerType: 'wards',
    cityField: 'MUNI_NAME',
    districtField: 'WARD',
    lastVerified: '2026-01-23',
    notes: 'York County Voting Districts 2022. Cities with wards: York City (11 wards), Dallastown, Hanover, Red Lion, Spring Garden Twp, West York, Wrightsville, York Twp. Filter on WARD > 0 for ward-based only.',
    confidence: 90,
    status: 'active',
  },

  // =========================================================================
  // Oregon State - Individual City Portals
  // =========================================================================
  // INVESTIGATION COMPLETE (2026-01-23):
  // Oregon does NOT have a statewide council district aggregator.
  // Individual cities maintain their own portals. Metro (regional government)
  // has Metro Council Districts (regional, not city council).
  //
  // VERIFIED CITY PORTALS:
  // - Portland: 4 districts - portlandmaps.com/arcgis/rest/services/Public/Auditor_ElectionsMap/MapServer/12
  //   Field: DISTRICT (new charter, 12 councilors across 4 districts, 3 per district)
  // - Eugene: 8 wards - gis.eugene-or.gov/arcgis/rest/services/PWE/Boundaries/MapServer/1
  //   Fields: ward, ward_number, councilor
  // - Salem: 8 wards - ArcGIS Hub (item 0f6dd26ba1ae49f5bedec30dcba0b1e8)
  //   Service endpoint needs confirmation via data.cityofsalem.net
  // - Hillsboro: 3 wards - gis.hillsboro-oregon.gov/public/rest/services/public/Council_Wards/MapServer/0
  //   Field: WARD (values: "1", "2", "3")
  //
  // REGIONAL (NOT CITY COUNCIL):
  // - Metro Council: 6 districts - gis.oregonmetro.gov/arcgis/rest/services/OpenData/BoundaryDataWebMerc/MapServer/2
  //   Regional government covering Portland metro area, NOT city-level
  //
  // AT-LARGE (NO DISTRICT BOUNDARIES):
  // - Gresham (114,247 pop): At-large with 7 numbered positions, no geographic districts
  // - Beaverton (97,494 pop): At-large with 6 councilors, no geographic districts
  // - Bend: Investigating - likely at-large based on website structure
  // =========================================================================

  'portland-or': {
    id: 'portland-or',
    name: 'Portland City Council Districts',
    coverage: 'City of Portland, Oregon',
    states: ['OR'],
    priority: 'P1',
    estimatedCities: 1,
    endpointUrl: 'https://www.portlandmaps.com/arcgis/rest/services/Public/Auditor_ElectionsMap/MapServer/12',
    layerType: 'council_districts',
    cityField: 'DISTRICT',
    districtField: 'DISTRICT',
    expectedFeatureCount: 4,
    lastVerified: '2026-01-23',
    notes: 'Portland City Council Districts (new 2024 charter). 4 geographic districts, each electing 3 councilors (12 total). Field: DISTRICT (string: "1", "2", "3", "4"). Also includes population balancing fields (pop_total, Ideal_pop, Diff_Ideal).',
    confidence: 95,
    status: 'active',
  },

  'eugene-or': {
    id: 'eugene-or',
    name: 'Eugene City Council Wards',
    coverage: 'City of Eugene, Oregon',
    states: ['OR'],
    priority: 'P1',
    estimatedCities: 1,
    endpointUrl: 'https://gis.eugene-or.gov/arcgis/rest/services/PWE/Boundaries/MapServer/1',
    layerType: 'wards',
    cityField: 'wardcity',
    districtField: 'ward_number',
    districtFieldAliases: ['ward'],
    expectedFeatureCount: 8,
    lastVerified: '2026-01-23',
    notes: 'Eugene City Council Wards. 8 wards (E1-E8). Fields: ward (designation like E1), ward_number (numeric), councilor (name). Population ~19,500 per ward.',
    confidence: 95,
    status: 'active',
  },

  'hillsboro-or': {
    id: 'hillsboro-or',
    name: 'Hillsboro City Council Wards',
    coverage: 'City of Hillsboro, Oregon',
    states: ['OR'],
    priority: 'P2',
    estimatedCities: 1,
    endpointUrl: 'https://gis.hillsboro-oregon.gov/public/rest/services/public/Council_Wards/MapServer/0',
    layerType: 'wards',
    cityField: 'NAME_1',
    districtField: 'WARD',
    expectedFeatureCount: 3,
    lastVerified: '2026-01-23',
    notes: 'Hillsboro City Council Wards. 3 wards. Field WARD contains values "1", "2", "3". Boundary adopted January 2023 per Ordinance 6433.',
    confidence: 90,
    status: 'active',
  },

  'oregon-metro': {
    id: 'oregon-metro',
    name: 'Oregon Metro Council Districts',
    coverage: 'Portland metropolitan region (Clackamas, Multnomah, Washington counties)',
    states: ['OR'],
    priority: 'P2',
    estimatedCities: 1,
    endpointUrl: 'https://gis.oregonmetro.gov/arcgis/rest/services/OpenData/BoundaryDataWebMerc/MapServer/2',
    layerType: 'council_districts',
    cityField: 'NAME',
    districtField: 'DISTRICT',
    expectedFeatureCount: 6,
    lastVerified: '2026-01-23',
    notes: 'Oregon Metro Council Districts. 6 districts (regional government, NOT city-level). Fields: DISTRICT (number), NAME (councilor name), EMAIL. Adopted December 2021. Also available: City Limits (layer 0), Voter Precincts (layer 7).',
    confidence: 95,
    status: 'active',
  },

  // =========================================================================
  // P2: Lower-yield aggregators (5-15 cities)
  // =========================================================================

  // =========================================================================
  // Ohio Individual City Portals
  // =========================================================================
  // INVESTIGATION COMPLETE (2026-01-23):
  // Ohio OGRIP (gis.ogrip.oit.ohio.gov) does NOT host council district/ward data.
  // Original URL not resolving. State-level portals (ogrip-geohio.opendata.arcgis.com)
  // provide imagery, parcels, and address points only - no municipal wards/councils.
  // Council districts must be obtained from individual city portals.
  //
  // AT-LARGE CITIES (no ward boundaries needed):
  // - Cincinnati: City council elected at-large (Community Councils are neighborhood orgs, not government)
  // - Dayton: City Commission form of government (at-large)
  //
  // NEEDS FURTHER INVESTIGATION:
  // - Akron: Enterprise GIS portal at agis.akronohio.gov (requires auth exploration)
  // - Youngstown: Web app only, FeatureServer not publicly documented

  'columbus-oh': {
    id: 'columbus-oh',
    name: 'Columbus, Ohio City Council Districts',
    coverage: 'Columbus city council districts',
    states: ['OH'],
    priority: 'P2',
    estimatedCities: 1,
    endpointUrl: 'https://services1.arcgis.com/vdNDkVykv9vEWFX4/arcgis/rest/services/Council_Districts/FeatureServer/0',
    layerType: 'council_districts',
    cityField: 'LABEL',
    districtField: 'District',
    districtFieldAliases: ['LABEL'],
    expectedFeatureCount: 13,
    lastVerified: '2026-01-23',
    notes: 'Columbus City Council - 13 districts. Fields include CouncilRepFirst, CouncilRepLast, Rep_Type. Hosted on ArcGIS Online. Spatial ref: NAD83 Ohio State Plane South (WKID 102729).',
    confidence: 95,
    status: 'active',
  },

  'cleveland-oh': {
    id: 'cleveland-oh',
    name: 'Cleveland, Ohio City Wards (2026)',
    coverage: 'Cleveland city ward boundaries',
    states: ['OH'],
    priority: 'P2',
    estimatedCities: 1,
    endpointUrl: 'https://services3.arcgis.com/dty2kHktVXHrqO8i/arcgis/rest/services/Cleveland_Wards_1_2_25_Topocleaned_pop20/FeatureServer/0',
    layerType: 'wards',
    cityField: 'NAME',
    districtField: 'Ward',
    districtFieldAliases: ['Ward_txt'],
    expectedFeatureCount: 15,
    lastVerified: '2026-01-23',
    notes: 'Cleveland Wards 2026 - 15 wards (reduced from 17 per city charter due to population decline). Approved by Ord. 1-2025, passed Jan 6 2025, effective when council terms start 2026. Fields: CouncilMember, Email, Phone. Legacy 2014 layer also available.',
    confidence: 95,
    status: 'active',
  },

  'toledo-oh': {
    id: 'toledo-oh',
    name: 'Toledo, Ohio Council Districts',
    coverage: 'Toledo city council districts',
    states: ['OH'],
    priority: 'P2',
    estimatedCities: 1,
    endpointUrl: 'https://gis.toledo.oh.gov/arcgis/rest/services/DistrictsZipsTEI_MapService/MapServer/1',
    layerType: 'council_districts',
    cityField: 'Name',
    districtField: 'District',
    expectedFeatureCount: 6,
    lastVerified: '2026-01-23',
    notes: 'Toledo Council Districts 2020 - 6 districts. MapServer layer (not FeatureServer) but supports query operations. Fields: District, Name, Email. Spatial ref: NAD83 Ohio State Plane North (FIPS 3401).',
    confidence: 90,
    status: 'active',
  },

  'cook-county-il': {
    id: 'cook-county-il',
    name: 'Cook County GIS',
    coverage: 'Cook County, Illinois municipalities',
    states: ['IL'],
    priority: 'P2',
    estimatedCities: 30,
    endpointUrl: 'https://gis.cookcountyil.gov/traditional/rest/services/politicalBoundary/MapServer/22',
    layerType: 'wards',
    cityField: 'MUNICIPALITY',
    cityFieldAliases: ['CITY', 'MUN_NAME', 'NAME'],
    districtField: 'NUMBER',
    districtFieldAliases: ['WARD'],
    lastVerified: '2026-01-24',
    notes: 'Cook County GIS Portal - covers Chicago suburbs. Chicago wards handled separately via city portal.',
    confidence: 85,
    status: 'active',
  },

  // =========================================================================
  // Washington State - Individual City Portals
  // =========================================================================
  // INVESTIGATION COMPLETE (2026-01-23):
  // King County GIS (gis.kingcounty.gov) does NOT host aggregated council district data.
  // Original URL not resolving. Individual cities maintain their own portals.
  //
  // VERIFIED CITY PORTALS:
  // - Seattle: 7 districts - services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/Seattle_City_Council_Districts/FeatureServer/0
  //   Field: C_DISTRICT
  // - Tacoma: 5 districts - services3.arcgis.com/SCwJH1pD8WSn5T5y/arcgis/rest/services/City_Council_Districts/FeatureServer/0
  //   Field: dist_id
  // - Spokane: 3 districts - data-spokane.opendata.arcgis.com (FeatureServer URL needs confirmation)
  // - Everett: 5 districts + 1 at-large (6 total) - gismaps.everettwa.gov/manarcgis/rest/services/Boundaries/Boundaries/MapServer/7
  //   Field: DISTRICT
  //
  // AT-LARGE (NO DISTRICT BOUNDARIES):
  // - Bellevue (97,494 pop): At-large council, no geographic districts
  // - Kent (136,588 pop): At-large with 7 numbered positions, no geographic districts
  // - Renton: Investigating - may be at-large
  // - Federal Way (102,000 pop): At-large with 7 positions, no districts
  // =========================================================================

  'seattle-wa': {
    id: 'seattle-wa',
    name: 'Seattle City Council Districts',
    coverage: 'City of Seattle, Washington',
    states: ['WA'],
    priority: 'P1',
    estimatedCities: 1,
    endpointUrl: 'https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/Seattle_City_Council_Districts/FeatureServer/0',
    layerType: 'council_districts',
    cityField: 'DISPLAY_NAME',
    districtField: 'C_DISTRICT',
    expectedFeatureCount: 7,
    lastVerified: '2026-01-23',
    notes: 'Seattle City Council 2024 districts. 7 districts, population ~94k per district. Field C_DISTRICT contains district number (1-7).',
    confidence: 95,
    status: 'active',
  },

  'tacoma-wa': {
    id: 'tacoma-wa',
    name: 'Tacoma City Council Districts',
    coverage: 'City of Tacoma, Washington',
    states: ['WA'],
    priority: 'P2',
    estimatedCities: 1,
    endpointUrl: 'https://services3.arcgis.com/SCwJH1pD8WSn5T5y/arcgis/rest/services/City_Council_Districts/FeatureServer/0',
    layerType: 'council_districts',
    cityField: 'district_text',
    districtField: 'dist_id',
    expectedFeatureCount: 5,
    lastVerified: '2026-01-23',
    notes: 'Tacoma City Council Districts. 5 districts. Fields: dist_id (int), district_text (string), councilmember, councilmember_email.',
    confidence: 95,
    status: 'active',
  },

  'everett-wa': {
    id: 'everett-wa',
    name: 'Everett City Council Districts',
    coverage: 'City of Everett, Washington',
    states: ['WA'],
    priority: 'P2',
    estimatedCities: 1,
    endpointUrl: 'https://gismaps.everettwa.gov/manarcgis/rest/services/Boundaries/Boundaries/MapServer/7',
    layerType: 'council_districts',
    cityField: 'NAME',
    districtField: 'DISTRICT',
    expectedFeatureCount: 6,
    lastVerified: '2026-01-23',
    notes: 'Everett City Council Districts (MapServer layer 7). 5 geographic districts plus possible at-large position. Fields: DISTRICT (string), MEMBERS, NAME, POPULATION.',
    confidence: 90,
    status: 'active',
  },

  'harris-county-tx': {
    id: 'harris-county-tx',
    name: 'Harris County GIS',
    coverage: 'Harris County, Texas municipalities',
    states: ['TX'],
    priority: 'P2',
    estimatedCities: 0,
    endpointUrl: 'https://gis.h-gac.com/arcgis/rest/services/Open_Data/Boundaries/MapServer/15',
    layerType: 'council_districts',
    cityField: 'CITY',
    districtField: 'DISTRICT',
    lastVerified: '2026-01-23',
    notes: 'DEPRECATED - Use hgac-tx instead. Harris County council districts are included in HGAC regional layer which covers the full 13-county Houston metro area.',
    confidence: 0,
    status: 'deprecated',
  },

  'maricopa-assoc-gov': {
    id: 'maricopa-assoc-gov',
    name: 'Maricopa Association of Governments (MAG)',
    coverage: 'Maricopa County regional planning data',
    states: ['AZ'],
    priority: 'P2',
    estimatedCities: 20,
    endpointUrl: 'https://geo.azmag.gov/arcgis/rest/services',
    layerType: 'council_districts',
    cityField: 'CITY',
    districtField: 'DISTRICT',
    lastVerified: '2026-01-23',
    notes: 'MAG Open Data - may have different data than Maricopa County GIS. Worth verifying for completeness.',
    confidence: 70,
    status: 'needs-verification',
  },

  // =========================================================================
  // Florida City-Level Council Districts
  // =========================================================================
  // INVESTIGATION COMPLETE (2026-01-23):
  // Florida has NO statewide council district aggregator. The state GIS portals
  // (FGDL at UF, Florida DEP, FDOT) only provide environmental data, city
  // boundaries, and state/federal legislative districts - NOT municipal council
  // districts. Each Florida city maintains their own GIS portal.
  //
  // TARGET CITIES INVESTIGATED:
  // - Jacksonville, Miami, Tampa, Orlando, St. Petersburg, Hialeah, Tallahassee,
  //   Fort Lauderdale, Port St. Lucie, Cape Coral, Pembroke Pines, Hollywood,
  //   Gainesville, Coral Springs
  //
  // AT-LARGE CITIES (no council district boundaries):
  // - Hialeah: At-large voting with numbered "groups" (not geographic districts)
  // - Coral Springs: Commission-manager government, at-large
  //
  // STATEWIDE RESOURCES (not council districts):
  // - FDOT Admin_Boundaries: https://gis.fdot.gov/arcgis/rest/services/Admin_Boundaries/FeatureServer
  //   - Layer 7: Florida Cities Bndy (city limits only)
  //   - Layers 9-11: State/Federal legislative districts

  'tampa-fl': {
    id: 'tampa-fl',
    name: 'City of Tampa Council Districts',
    coverage: 'City of Tampa, Florida',
    states: ['FL'],
    priority: 'P1',
    estimatedCities: 1,
    endpointUrl: 'https://city-tampa.opendata.arcgis.com/datasets/city-council-district',
    layerType: 'council_districts',
    cityField: 'NAME',
    districtField: 'DISTRICT',
    expectedFeatureCount: 7,
    lastVerified: '2026-01-23',
    notes: 'City of Tampa GeoHub. 7 council districts. Open Data portal with GeoJSON/Shapefile downloads. GIS contact: (813) 274-8211. Hub: city-tampa.opendata.arcgis.com.',
    confidence: 95,
    status: 'active',
  },

  'st-petersburg-fl': {
    id: 'st-petersburg-fl',
    name: 'City of St. Petersburg Council Districts',
    coverage: 'City of St. Petersburg, Florida',
    states: ['FL'],
    priority: 'P1',
    estimatedCities: 1,
    endpointUrl: 'https://geohub-csp.opendata.arcgis.com/datasets/eb615e8a2ad24ef7970bddc11007ea74_10',
    layerType: 'council_districts',
    cityField: 'NAME',
    districtField: 'DISTRICT',
    expectedFeatureCount: 8,
    lastVerified: '2026-01-23',
    notes: 'St. Petersburg GeoHub. 8 council districts. ArcGIS Hub with REST API. Interactive map: egis.stpete.org. Hub: geohub-csp.opendata.arcgis.com.',
    confidence: 95,
    status: 'active',
  },

  'fort-lauderdale-fl': {
    id: 'fort-lauderdale-fl',
    name: 'City of Fort Lauderdale Commission Districts',
    coverage: 'City of Fort Lauderdale, Florida',
    states: ['FL'],
    priority: 'P1',
    estimatedCities: 1,
    endpointUrl: 'https://gis.fortlauderdale.gov/server/rest/services/CityCommissionDistricts/FeatureServer/0',
    layerType: 'council_districts',
    cityField: 'NAME',
    districtField: 'DISTRICT',
    expectedFeatureCount: 4,
    lastVerified: '2026-01-23',
    notes: 'City of Fort Lauderdale GIS. 4 commission districts. Official FeatureServer. Also in Gridics/Layers MapServer (layer 7). Hub: ftlgeo-fortlauderdale.hub.arcgis.com.',
    confidence: 98,
    status: 'active',
  },

  'hollywood-fl': {
    id: 'hollywood-fl',
    name: 'City of Hollywood Commission Districts',
    coverage: 'City of Hollywood, Florida',
    states: ['FL'],
    priority: 'P1',
    estimatedCities: 1,
    endpointUrl: 'https://maps.hollywoodfl.org/arcgis/rest/services/InformationTechnology/Commission_Districts/MapServer/35',
    layerType: 'council_districts',
    cityField: 'NAME',
    districtField: 'DISTRICT',
    expectedFeatureCount: 6,
    lastVerified: '2026-01-23',
    notes: 'City of Hollywood GIS. 6 commission districts + mayor at-large. MapServer layer 35. NAD_1983_HARN_StatePlane_Florida_East. Single-member geographic districts per city charter.',
    confidence: 90,
    status: 'active',
  },

  'cape-coral-fl': {
    id: 'cape-coral-fl',
    name: 'City of Cape Coral Council Districts',
    coverage: 'City of Cape Coral, Florida',
    states: ['FL'],
    priority: 'P1',
    estimatedCities: 1,
    endpointUrl: 'https://capeims.capecoral.gov/arcgis/rest/services/IMS/City_of_Cape_Coral_IMS_AGOL/FeatureServer/25',
    layerType: 'council_districts',
    cityField: 'DISTRICT',
    districtField: 'DISTRICT',
    districtFieldAliases: ['COUNCIL_NAME'],
    expectedFeatureCount: 7,
    lastVerified: '2026-01-23',
    notes: 'City of Cape Coral GIS. 7 council districts. Fields: DISTRICT, POPULATION, COUNCIL_NAME, District_Page. Hub: capecoral-capegis.opendata.arcgis.com.',
    confidence: 95,
    status: 'active',
  },

  'orange-county-fl': {
    id: 'orange-county-fl',
    name: 'Orange County Commission Districts (Orlando metro)',
    coverage: 'Orange County, Florida (includes Orlando area)',
    states: ['FL'],
    priority: 'P1',
    estimatedCities: 1,
    endpointUrl: 'https://ocgis4.ocfl.net/arcgis/rest/services/Public_Dynamic/MapServer/151',
    layerType: 'council_districts',
    cityField: 'COMMISSIONERNAME',
    districtField: 'COMMISSIONERDISTRICTID',
    expectedFeatureCount: 6,
    lastVerified: '2026-01-23',
    notes: 'Orange County Public_Dynamic MapServer layer 151. 6 county commission districts. Orlando city has 6 commissioner districts via orlando.gov or data.cityoforlando.net. Hub: ocgis-datahub-ocfl.hub.arcgis.com.',
    confidence: 90,
    status: 'active',
  },

  'miami-dade-fl': {
    id: 'miami-dade-fl',
    name: 'Miami-Dade County Commission Districts',
    coverage: 'Miami-Dade County, Florida',
    states: ['FL'],
    priority: 'P1',
    estimatedCities: 2,
    endpointUrl: 'https://gis-mdc.opendata.arcgis.com/datasets/21f56c05380e477ea3008fd527ddafe4_0',
    layerType: 'council_districts',
    cityField: 'NAME',
    districtField: 'DISTRICT',
    expectedFeatureCount: 13,
    lastVerified: '2026-01-23',
    notes: 'Miami-Dade Open Data Hub. County has 13 commission districts. City of Miami has 5 commission districts via datahub-miamigis.opendata.arcgis.com. 650+ GIS datasets. Contact: gis@miamidade.gov.',
    confidence: 90,
    status: 'active',
  },

  'gainesville-fl': {
    id: 'gainesville-fl',
    name: 'City of Gainesville Commission Districts',
    coverage: 'City of Gainesville, Florida',
    states: ['FL'],
    priority: 'P2',
    estimatedCities: 1,
    endpointUrl: 'https://www.arcgis.com/apps/webappviewer/index.html?id=0ce2a53e99ce4e948b7f046227c4ae97',
    layerType: 'council_districts',
    cityField: 'NAME',
    districtField: 'DISTRICT',
    expectedFeatureCount: 4,
    lastVerified: '2026-01-23',
    notes: 'City of Gainesville ArcGIS. 4 commission districts per city charter (Section 2.02). Also via ACPA (Alachua County Property Appraiser) at maps.acpafl.org. Hub: gainesvillefl.maps.arcgis.com.',
    confidence: 85,
    status: 'active',
  },

  'port-st-lucie-fl': {
    id: 'port-st-lucie-fl',
    name: 'City of Port St. Lucie Council Districts',
    coverage: 'City of Port St. Lucie, Florida',
    states: ['FL'],
    priority: 'P2',
    estimatedCities: 1,
    endpointUrl: 'https://data-pslgis.opendata.arcgis.com/',
    layerType: 'council_districts',
    cityField: 'NAME',
    districtField: 'DISTRICT',
    expectedFeatureCount: 5,
    lastVerified: '2026-01-23',
    notes: 'City of Port St. Lucie Open Data. 5 council members (Mayor + 4 districts). Council-Manager form. Finder app: pslgis.maps.arcgis.com. PDF map available at cityofpsl.com.',
    confidence: 85,
    status: 'active',
  },

  'pembroke-pines-fl': {
    id: 'pembroke-pines-fl',
    name: 'City of Pembroke Pines Commission Districts',
    coverage: 'City of Pembroke Pines, Florida',
    states: ['FL'],
    priority: 'P2',
    estimatedCities: 1,
    endpointUrl: 'https://www.ppines.com/1747/GIS-Maps',
    layerType: 'council_districts',
    cityField: 'NAME',
    districtField: 'DISTRICT',
    expectedFeatureCount: 4,
    lastVerified: '2026-01-23',
    notes: 'City of Pembroke Pines GIS Hub. 4 commission districts + mayor at-large. PDF map: ppines.com/ImageRepository/Document?documentID=10. FeatureServer endpoint needs verification.',
    confidence: 80,
    status: 'needs-verification',
  },

  'tallahassee-leon-fl': {
    id: 'tallahassee-leon-fl',
    name: 'Tallahassee-Leon County Commission Districts',
    coverage: 'City of Tallahassee and Leon County, Florida',
    states: ['FL'],
    priority: 'P2',
    estimatedCities: 1,
    endpointUrl: 'https://geodata-tlcgis.opendata.arcgis.com/',
    layerType: 'council_districts',
    cityField: 'NAME',
    districtField: 'DISTRICT',
    lastVerified: '2026-01-23',
    notes: 'TLCGIS GeoData Hub. Joint inter-local agency (Leon County + City of Tallahassee + Property Appraiser). Leon County has commission districts. Contact: webgis@leoncountyfl.gov.',
    confidence: 80,
    status: 'needs-verification',
  },

  'jacksonville-fl': {
    id: 'jacksonville-fl',
    name: 'City of Jacksonville Council Districts',
    coverage: 'City of Jacksonville (Duval County), Florida',
    states: ['FL'],
    priority: 'P1',
    estimatedCities: 1,
    endpointUrl: 'https://maps.coj.net/jaxgis',
    layerType: 'council_districts',
    cityField: 'NAME',
    districtField: 'DISTRICT',
    expectedFeatureCount: 14,
    lastVerified: '2026-01-23',
    notes: 'Jacksonville consolidated city-county (Duval). JaxGIS My Neighborhood app. 14 geographic council districts + 5 at-large. Council District Search via maps.coj.net. FeatureServer endpoint needs discovery.',
    confidence: 85,
    status: 'needs-verification',
  },
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get aggregators by priority
 */
export function getAggregatorsByPriority(
  priority: AggregatorPriority
): readonly RegionalAggregator[] {
  return Object.values(REGIONAL_AGGREGATORS).filter(
    (agg) => agg.priority === priority
  );
}

/**
 * Get aggregators for a specific state
 */
export function getAggregatorsForState(state: string): readonly RegionalAggregator[] {
  return Object.values(REGIONAL_AGGREGATORS).filter(
    (agg) => agg.states.includes(state)
  );
}

/**
 * Get active aggregators only
 */
export function getActiveAggregators(): readonly RegionalAggregator[] {
  return Object.values(REGIONAL_AGGREGATORS).filter(
    (agg) => agg.status === 'active'
  );
}

/**
 * Get all aggregators sorted by priority and yield
 */
export function getAllAggregatorsSorted(): readonly RegionalAggregator[] {
  const priorityOrder: Record<AggregatorPriority, number> = {
    P0: 0,
    P1: 1,
    P2: 2,
  };

  return Object.values(REGIONAL_AGGREGATORS).sort((a, b) => {
    // Sort by priority first
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priorityDiff !== 0) return priorityDiff;

    // Then by estimated yield (higher first)
    return b.estimatedCities - a.estimatedCities;
  });
}

/**
 * Build download URL with WHERE clause for a specific city
 *
 * @param aggregator - Aggregator config
 * @param cityName - City name to filter
 * @returns Download URL with WHERE clause
 */
export function buildCityDownloadUrl(
  aggregator: RegionalAggregator,
  cityName: string
): string {
  const encodedCity = encodeURIComponent(cityName);
  const baseUrl = aggregator.endpointUrl.replace(/\/+$/, '');

  // Build WHERE clause
  const whereClause = `${aggregator.cityField}='${encodedCity}'`;

  return `${baseUrl}/query?where=${encodeURIComponent(whereClause)}&outFields=*&f=geojson`;
}

/**
 * Get total estimated cities across all aggregators
 */
export function getTotalEstimatedCities(): number {
  return Object.values(REGIONAL_AGGREGATORS).reduce(
    (sum, agg) => sum + agg.estimatedCities,
    0
  );
}

/**
 * Get aggregator by ID
 */
export function getAggregatorById(id: string): RegionalAggregator | null {
  return REGIONAL_AGGREGATORS[id] ?? null;
}
