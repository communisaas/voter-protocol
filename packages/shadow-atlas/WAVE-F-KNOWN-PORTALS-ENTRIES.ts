/**
 * Wave F Extraction - Known Portal Entries
 * Successfully extracted FeatureServer URLs for 5 cities
 * Generated: 2026-01-18
 *
 * Add these entries to src/core/registry/known-portals.ts
 */

// 1. OCALA FL (1250750)
'1250750': {
  cityFips: '1250750',
  cityName: 'Ocala',
  state: 'FL',
  portalType: 'municipal-gis',
  downloadUrl: 'https://gis.ocalafl.org/arcgis/rest/services/Public/Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
  featureCount: 5,
  lastVerified: '2026-01-18T00:00:00.000Z',
  confidence: 90,
  discoveredBy: 'wave-f-extraction',
  notes: 'City of Ocala Districts FeatureServer. Contains 6 records but only 5 unique districts (District 3 has duplicate entry with OBJECTID 441 and 449). Layer explicitly described as "City, village or township elected representative districts". Districts 1-5 with representative names, contact info, and population data. At-Large council member (Barry Mansfield) assigned to District 1.',
},

// 2. ELK GROVE CA (0622020)
'0622020': {
  cityFips: '0622020',
  cityName: 'Elk Grove',
  state: 'CA',
  portalType: 'county-gis',
  downloadUrl: 'https://mapservices.gis.saccounty.net/arcgis/rest/services/ELK_GROVE/MapServer/8/query?where=1%3D1&outFields=*&f=geojson',
  featureCount: 4,
  lastVerified: '2026-01-18T00:00:00.000Z',
  confidence: 95,
  discoveredBy: 'wave-f-extraction',
  notes: 'Sacramento County GIS hosting Elk Grove City Council Districts. Layer id_ElkGroveCityCouncil in ELK_GROVE MapServer. Fields: DIST_NUM, MEMBER (council member name), DIST_ID, HTECODE. 4 verified districts with current member names: Rod Brewer (D2), Darren Suen (D1), Sergio Robles (D4), Kevin Spease (D3). Source: https://gisdata.elkgrove.gov/',
},

// 3. GLENDALE AZ (0427820)
'0427820': {
  cityFips: '0427820',
  cityName: 'Glendale',
  state: 'AZ',
  portalType: 'arcgis',
  downloadUrl: 'https://services1.arcgis.com/9fVTQQSiODPjLUTa/arcgis/rest/services/Glendale_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
  featureCount: 6,
  lastVerified: '2026-01-18T00:00:00.000Z',
  confidence: 95,
  discoveredBy: 'wave-f-extraction',
  notes: 'City of Glendale ArcGIS Online Feature Service. Created and maintained by Glendale Mapping and Records Department. Districts named after desert plants: OCOTILLO (Leandro Baldenegro), CACTUS (Ian Hugh), BARREL (Bart Turner), SAHUARO (Ray Malnar), CHOLLA (Lauren Tolmachoff), YUCCA (Joyce Clark). Contains 7 features total (6 named districts + 1 "NONE" for unincorporated/non-district areas). Source: https://opendata.glendaleaz.com/',
},

// 4. BUCKEYE AZ (0407940)
'0407940': {
  cityFips: '0407940',
  cityName: 'Buckeye',
  state: 'AZ',
  portalType: 'county-gis',
  downloadUrl: 'https://services.arcgis.com/ykpntM6e3tHvzKRJ/arcgis/rest/services/Maricopa_County_City_Council_Districts/FeatureServer/0/query?where=Juris%3D%27Buckeye%27&outFields=*&f=geojson',
  featureCount: 6,
  lastVerified: '2026-01-18T00:00:00.000Z',
  confidence: 90,
  discoveredBy: 'wave-f-extraction',
  notes: 'Maricopa County Elections GIS multi-city layer. Contains council districts for Phoenix, Surprise, Buckeye, Peoria, Glendale, and Mesa. MUST filter by Juris=\'Buckeye\' to extract only Buckeye districts. Returns 12 records but only 6 unique districts (BUCKEYE DIST 1-6, each district appears twice in dataset). Key fields: Juris (jurisdiction), BdName (board name/district), Ward, LglLabel. Source: Maricopa County Elections Department.',
},

// 5. FERNLEY NV (3224900)
'3224900': {
  cityFips: '3224900',
  cityName: 'Fernley',
  state: 'NV',
  portalType: 'arcgis',
  downloadUrl: 'https://services8.arcgis.com/dzKn4YTRsauu7Rfk/arcgis/rest/services/Fernley_City_Council_Wards/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
  featureCount: 5,
  lastVerified: '2026-01-18T00:00:00.000Z',
  confidence: 95,
  discoveredBy: 'wave-f-extraction',
  notes: 'City of Fernley ArcGIS Online Feature Service. Clean ward structure with 5 city council wards (Ward 1-5). Polygon geometries with perimeter and area calculations. Council_Me field present but unpopulated. Source: https://webgis-city-of-fernley.hub.arcgis.com/ (contact: gis@dowl.com for Fernley GIS Department).',
},

/**
 * IMPLEMENTATION NOTES:
 *
 * 1. Data Quality Issues:
 *    - Ocala: Contains duplicate for District 3 (may need deduplication)
 *    - Buckeye: County source has duplicates (requires WHERE clause filter)
 *
 * 2. Query Patterns:
 *    - Most use standard: WHERE 1=1
 *    - Buckeye requires: WHERE Juris='Buckeye'
 *
 * 3. Still Needed (Manual Extraction Required):
 *    - Sherman TX (4867496): https://sherman-open-data-cityofsherman.hub.arcgis.com/
 *    - Taylor TX (4871948): https://city-of-taylor-open-data-mallard.hub.arcgis.com/
 *    - Carson CA (0611530): https://gis.carson.ca.us/ (portal 404, may need authentication)
 *
 * 4. Integration Steps:
 *    - Add these entries to known-portals.ts registry
 *    - Test downloads with bulk-ingest script
 *    - Run tessellation validation
 *    - Verify feature counts match expected district counts
 *    - Check for containment/exclusivity issues
 *
 * 5. Alternative Sources Found:
 *    - Glendale also has legacy MapServer: https://gismaps.glendaleaz.com/gisserver/rest/services/Glendale_Services/CityLimits/MapServer/3
 *      (116k views vs 10k views for newer FeatureServer - may be more stable but older data)
 */
