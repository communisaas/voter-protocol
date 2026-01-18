/**
 * County Commissioner District Portals
 *
 * SEPARATED FROM known-portals.ts on 2026-01-17
 *
 * These entries track county commissioner/supervisor districts, NOT city councils.
 * Validation should be against county boundaries (TIGER counties), not city boundaries.
 *
 * FIPS FORMAT: 5-digit county FIPS (SSCCC)
 * VALIDATION: County tessellation (different from city tessellation)
 */

import type { KnownPortal } from './known-portals.js';

export const COUNTY_PORTALS: Record<string, KnownPortal> = {
  '10003': {
    "cityFips": "10003",
    "cityName": "New Castle County",
    "state": "DE",
    "portalType": "arcgis",
    "downloadUrl": "https://services.arcgis.com/bzbOQeR8JK1LqPwf/arcgis/rest/services/LWV_Sussex_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 6,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 50,
    "discoveredBy": "automated",
    "notes": "New Castle County DE - 6 districts, bulk ingested from \"LWV_Sussex_Council_Districts_0\""
  },

  '12023': {
    "cityFips": "12023",
    "cityName": "Columbia County",
    "state": "FL",
    "portalType": "arcgis",
    "downloadUrl": "https://services1.arcgis.com/BQhCSVXisSNlAAjd/arcgis/rest/services/CouncilDistricts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 4,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Columbia County FL - 4 districts, bulk ingested from \"CouncilDistricts\""
  },

  '12081': {
    "cityFips": "12081",
    "cityName": "Manatee County",
    "state": "FL",
    "portalType": "arcgis",
    "downloadUrl": "https://services6.arcgis.com/wl0q8tN2gn8MMx1p/arcgis/rest/services/WardsCityCouncil_CoB/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 5,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 63,
    "discoveredBy": "automated",
    "notes": "Manatee County FL - 5 districts, bulk ingested from \"WardsCityCouncil_CoB_Enrich\""
  },

  '13089': {
    "cityFips": "13089",
    "cityName": "DeKalb County",
    "state": "GA",
    "portalType": "arcgis",
    "downloadUrl": "https://services5.arcgis.com/Mm1BAVEiAXrYE9vn/arcgis/rest/services/LaVista_Hills_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 6,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "DeKalb County GA - 6 districts, bulk ingested from \"LaVista_Hills_Council_Districts\""
  },

  '13117': {
    "cityFips": "13117",
    "cityName": "Forsyth County",
    "state": "GA",
    "portalType": "arcgis",
    "downloadUrl": "https://services5.arcgis.com/Mm1BAVEiAXrYE9vn/arcgis/rest/services/sharonSpringsCouncilDistrict/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 3,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Forsyth County GA - 3 districts, bulk ingested from \"Sharon Springs Council District\""
  },

  '13151': {
    "cityFips": "13151",
    "cityName": "Henry County",
    "state": "GA",
    "portalType": "arcgis",
    "downloadUrl": "https://services5.arcgis.com/Mm1BAVEiAXrYE9vn/arcgis/rest/services/EaglesLanding/FeatureServer/1/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 4,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Henry County GA - 4 districts, bulk ingested from \"Council District\""
  },

  '13175': {
    "cityFips": "13175",
    "cityName": "Laurens County",
    "state": "GA",
    "portalType": "arcgis",
    "downloadUrl": "https://services5.arcgis.com/HHvUPZ2XuLOAJxjR/arcgis/rest/services/City_of_Jesup_View/FeatureServer/7/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 7,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Laurens County GA - 7 districts, bulk ingested from \"Jesup_Council_Districts\""
  },

  '13185': {
    "cityFips": "13185",
    "cityName": "Lowndes County",
    "state": "GA",
    "portalType": "arcgis",
    "downloadUrl": "https://services3.arcgis.com/fYt1jp3hqamxgSvI/arcgis/rest/services/Valdosta_City_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 6,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 83,
    "discoveredBy": "automated",
    "notes": "Lowndes County GA - 6 districts, bulk ingested from \"Valdosta City Council Districts\""
  },

  '15001': {
    "cityFips": "15001",
    "cityName": "Hawaii County",
    "state": "HI",
    "portalType": "arcgis",
    "downloadUrl": "https://services6.arcgis.com/Y6jyX1765vdZuyQH/arcgis/rest/services/Figure_ALL_LAYERS/FeatureServer/3/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 9,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Hawaii County HI - 9 districts, bulk ingested from \"Hawaii_County_Council_Districts\""
  },

  '15003': {
    "cityFips": "15003",
    "cityName": "Honolulu County",
    "state": "HI",
    "portalType": "arcgis",
    "downloadUrl": "https://services.arcgis.com/tNJpAOha4mODLkXz/arcgis/rest/services/City_Council_2023/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 9,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 75,
    "discoveredBy": "automated",
    "notes": "Honolulu County HI - 9 districts, bulk ingested from \"Honolulu City Council Districts 2023\""
  },

  '15009': {
    "cityFips": "15009",
    "cityName": "Maui County",
    "state": "HI",
    "portalType": "arcgis",
    "downloadUrl": "https://services3.arcgis.com/fsrDo0QMPlK9CkZD/arcgis/rest/services/CouncilDistrict_view/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 9,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Maui County HI - 9 districts, bulk ingested from \"Council Districts\""
  },

  '16001': {
    "cityFips": "16001",
    "cityName": "Ada County",
    "state": "ID",
    "portalType": "arcgis",
    "downloadUrl": "https://services1.arcgis.com/WHM6qC35aMtyAAlN/arcgis/rest/services/Boise_City_Council_Districts_2021/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 6,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 75,
    "discoveredBy": "automated",
    "notes": "Ada County ID - 6 districts, bulk ingested from \"Boise City Council Districts 2021\""
  },

  '17197': {
    "cityFips": "17197",
    "cityName": "Will County",
    "state": "IL",
    "portalType": "arcgis",
    "downloadUrl": "https://services2.arcgis.com/RMSabPClYIvVQ6Si/arcgis/rest/services/VUEWorks_Basemap/FeatureServer/20/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 5,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Will County IL - 5 districts, bulk ingested from \"Council District\""
  },

  '18035': {
    "cityFips": "18035",
    "cityName": "Delaware County",
    "state": "IN",
    "portalType": "arcgis",
    "downloadUrl": "https://services.arcgis.com/VyRjdyMziYNF5Bwe/arcgis/rest/services/County_council_2012/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 4,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 50,
    "discoveredBy": "automated",
    "notes": "Delaware County IN - 4 districts, bulk ingested from \"County_Council_Districts_2022\""
  },

  '18039': {
    "cityFips": "18039",
    "cityName": "Elkhart County",
    "state": "IN",
    "portalType": "arcgis",
    "downloadUrl": "https://services.arcgis.com/tKsJAIiLjd90D5q2/arcgis/rest/services/Elkhart_Priority_Planting_Map_2024_Scene_Viewer/FeatureServer/2/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 6,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 83,
    "discoveredBy": "automated",
    "notes": "Elkhart County IN - 6 districts, bulk ingested from \"city council district\""
  },

  '18105': {
    "cityFips": "18105",
    "cityName": "Monroe County",
    "state": "IN",
    "portalType": "arcgis",
    "downloadUrl": "https://services9.arcgis.com/47GwVXZ9a8thrviM/arcgis/rest/services/City_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 6,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 83,
    "discoveredBy": "automated",
    "notes": "Monroe County IN - 6 districts, bulk ingested from \"City Council Districts\""
  },

  '18109': {
    "cityFips": "18109",
    "cityName": "Morgan County",
    "state": "IN",
    "portalType": "arcgis",
    "downloadUrl": "https://services2.arcgis.com/Y0fDSibEfxdu2Ya6/arcgis/rest/services/Morgan_Redistricting_Feature_Layers/FeatureServer/2/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 4,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 50,
    "discoveredBy": "automated",
    "notes": "Morgan County IN - 4 districts, bulk ingested from \"Council Districts Current\""
  },

  '20131': {
    "cityFips": "20131",
    "cityName": "Nemaha County",
    "state": "KS",
    "portalType": "arcgis",
    "downloadUrl": "https://services3.arcgis.com/6xqgnnfHDAKxg22k/arcgis/rest/services/NM_City_Wards/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 9,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 50,
    "discoveredBy": "automated",
    "notes": "Nemaha County KS - 9 districts, bulk ingested from \"NM_City_Wards\""
  },

  '22005': {
    "cityFips": "22005",
    "cityName": "Ascension Parish",
    "state": "LA",
    "portalType": "arcgis",
    "downloadUrl": "https://services3.arcgis.com/MPDCWPaA1jcduAb1/arcgis/rest/services/AscensionGeneralLayers/FeatureServer/1/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 11,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Ascension Parish LA - 11 districts, bulk ingested from \"Parish Council Districts\""
  },

  '22033': {
    "cityFips": "22033",
    "cityName": "East Baton Rouge Parish",
    "state": "LA",
    "portalType": "arcgis",
    "downloadUrl": "https://services.arcgis.com/KYvXadMcgf0K1EzK/arcgis/rest/services/Council_District_Hollow/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 12,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "East Baton Rouge Parish LA - 12 districts, bulk ingested from \"Council District\""
  },

  '22037': {
    "cityFips": "22037",
    "cityName": "East Feliciana Parish",
    "state": "LA",
    "portalType": "arcgis",
    "downloadUrl": "https://services6.arcgis.com/v7ybB1NRHmvpxAmd/arcgis/rest/services/ARBC_Council_Districts/FeatureServer/43/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 52,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "East Feliciana Parish LA - 52 districts, bulk ingested from \"ARBC_Council_Districts\""
  },

  '22045': {
    "cityFips": "22045",
    "cityName": "Iberia Parish",
    "state": "LA",
    "portalType": "arcgis",
    "downloadUrl": "https://services1.arcgis.com/ZPPrBdbq4892XaIK/arcgis/rest/services/IberiaLAGISFlags/FeatureServer/6/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 55,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Iberia Parish LA - 55 districts, bulk ingested from \"Council Districts\""
  },

  '22047': {
    "cityFips": "22047",
    "cityName": "Iberville Parish",
    "state": "LA",
    "portalType": "arcgis",
    "downloadUrl": "https://services7.arcgis.com/6SHSRgj15reB1LOT/arcgis/rest/services/Iberville_Council_Districts_VOTER/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 13,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Iberville Parish LA - 13 districts, bulk ingested from \"Iberville_Council_Districts\""
  },

  '22051': {
    "cityFips": "22051",
    "cityName": "Jefferson Parish",
    "state": "LA",
    "portalType": "arcgis",
    "downloadUrl": "https://services6.arcgis.com/P6Jmnmv73C1UrZBy/arcgis/rest/services/Jefferson_Parish_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 5,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Jefferson Parish LA - 5 districts, bulk ingested from \"Jefferson_Parish_Council_Districts\""
  },

  '22057': {
    "cityFips": "22057",
    "cityName": "Lafourche Parish",
    "state": "LA",
    "portalType": "arcgis",
    "downloadUrl": "https://services1.arcgis.com/hg2WR9ukwQebQrXp/arcgis/rest/services/LafourcheParishBoundaries/FeatureServer/4/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 9,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Lafourche Parish LA - 9 districts, bulk ingested from \"Lafourche Parish Council Districts\""
  },

  '22063': {
    "cityFips": "22063",
    "cityName": "Livingston Parish",
    "state": "LA",
    "portalType": "arcgis",
    "downloadUrl": "https://services7.arcgis.com/TuQ8KXxdnKZCJwrs/arcgis/rest/services/For_Livingston_Parish_Planning_Department_WFL1/FeatureServer/2/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 9,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Livingston Parish LA - 9 districts, bulk ingested from \"2024 Council Districts\""
  },

  '22069': {
    "cityFips": "22069",
    "cityName": "Natchitoches Parish",
    "state": "LA",
    "portalType": "arcgis",
    "downloadUrl": "https://services3.arcgis.com/JgNU5fJl6EIG4LAX/arcgis/rest/services/Council_Districts_view/FeatureServer/30/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 5,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Natchitoches Parish LA - 5 districts, bulk ingested from \"Council Districts\""
  },

  '22089': {
    "cityFips": "22089",
    "cityName": "St. Charles Parish",
    "state": "LA",
    "portalType": "arcgis",
    "downloadUrl": "https://services7.arcgis.com/Nj65ZtNghtksKPeG/arcgis/rest/services/View_Production_Services_GIS_Data/FeatureServer/4/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 7,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "St. Charles Parish LA - 7 districts, bulk ingested from \"Council Districts\""
  },

  '22099': {
    "cityFips": "22099",
    "cityName": "St. Martin Parish",
    "state": "LA",
    "portalType": "arcgis",
    "downloadUrl": "https://services9.arcgis.com/QClEuaPkoZwU6r3B/arcgis/rest/services/Map_WFL1/FeatureServer/4/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 9,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 50,
    "discoveredBy": "automated",
    "notes": "St. Martin Parish LA - 9 districts, bulk ingested from \"District Map Ward Boundaries\""
  },

  '22103': {
    "cityFips": "22103",
    "cityName": "St. Tammany Parish",
    "state": "LA",
    "portalType": "arcgis",
    "downloadUrl": "https://services8.arcgis.com/xqfvcYWRsxGrAkQR/arcgis/rest/services/St__Tammany_Parish_Council_Districts_WFL1/FeatureServer/1/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 14,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "St. Tammany Parish LA - 14 districts, bulk ingested from \"Council Districts\""
  },

  '22109': {
    "cityFips": "22109",
    "cityName": "Terrebonne Parish",
    "state": "LA",
    "portalType": "arcgis",
    "downloadUrl": "https://services2.arcgis.com/LJwIycC0yIuqCBxq/arcgis/rest/services/Terrebonne_Parish_Lookup_Map_WFL1/FeatureServer/1/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 9,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Terrebonne Parish LA - 9 districts, bulk ingested from \"Terrebonne Council Districts\""
  },

  '22117': {
    "cityFips": "22117",
    "cityName": "Washington Parish",
    "state": "LA",
    "portalType": "arcgis",
    "downloadUrl": "https://services7.arcgis.com/yE0LOKocwREqepjx/arcgis/rest/services/Council_Districts/FeatureServer/3/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 7,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Washington Parish LA - 7 districts, bulk ingested from \"CouncilDistricts\""
  },

  '22125': {
    "cityFips": "22125",
    "cityName": "West Feliciana Parish",
    "state": "LA",
    "portalType": "arcgis",
    "downloadUrl": "https://services5.arcgis.com/SkttgSmcq6CPonms/arcgis/rest/services/Council_Districts_WFL1/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 5,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "West Feliciana Parish LA - 5 districts, bulk ingested from \"Council Districts\""
  },

  '24003': {
    "cityFips": "24003",
    "cityName": "Anne Arundel County",
    "state": "MD",
    "portalType": "arcgis",
    "downloadUrl": "https://services9.arcgis.com/Xo7ZIJyzg1G8MFwY/arcgis/rest/services/Communities_of_the_Severn_River_2_WFL1/FeatureServer/4/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 5,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Anne Arundel County MD - 5 districts, bulk ingested from \"County Council Districts\""
  },

  '24021': {
    "cityFips": "24021",
    "cityName": "Frederick County",
    "state": "MD",
    "portalType": "arcgis",
    "downloadUrl": "https://services1.arcgis.com/qTQ6qYkHpxlu0G82/arcgis/rest/services/Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 5,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Frederick County MD - 5 districts, bulk ingested from \"Council_Districts\""
  },

  '24027': {
    "cityFips": "24027",
    "cityName": "Howard County",
    "state": "MD",
    "portalType": "arcgis",
    "downloadUrl": "https://services1.arcgis.com/ZwA0Q1mheCEc5yXS/arcgis/rest/services/Howard_County_Executive_Races_in_2014_and_2018_WFL1/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 5,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 70,
    "discoveredBy": "automated",
    "notes": "Howard County MD - 5 districts, bulk ingested from \"Howard County Council Districts\""
  },

  '24033': {
    "cityFips": "24033",
    "cityName": "Prince George's County",
    "state": "MD",
    "portalType": "arcgis",
    "downloadUrl": "https://services.arcgis.com/kSZiBgsXsUF788NB/arcgis/rest/services/PG_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 9,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Prince George's County MD - 9 districts, bulk ingested from \"PG_Council_Districts\""
  },

  '25005': {
    "cityFips": "25005",
    "cityName": "Bristol County",
    "state": "MA",
    "portalType": "arcgis",
    "downloadUrl": "https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/GovCouncil2021/FeatureServer/1/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 8,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 50,
    "discoveredBy": "automated",
    "notes": "Bristol County MA - 8 districts, bulk ingested from \"Governor's Council Districts (2021) (Pol\""
  },

  '25009': {
    "cityFips": "25009",
    "cityName": "Essex County",
    "state": "MA",
    "portalType": "arcgis",
    "downloadUrl": "https://services9.arcgis.com/nPsFhwkdebYjxn1R/arcgis/rest/services/CityWards_shp/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 7,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 50,
    "discoveredBy": "automated",
    "notes": "Essex County MA - 7 districts, bulk ingested from \"CityWards_shp\""
  },

  '25021': {
    "cityFips": "25021",
    "cityName": "Norfolk County",
    "state": "MA",
    "portalType": "arcgis",
    "downloadUrl": "https://services.arcgis.com/sFnw0xNflSi8J0uh/arcgis/rest/services/City Council redistricting working session 09_20_22/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 10,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 50,
    "discoveredBy": "automated",
    "notes": "Norfolk County MA - 10 districts, bulk ingested from \"City Council redistricting working sessi\""
  },

  '30029': {
    "cityFips": "30029",
    "cityName": "Flathead County",
    "state": "MT",
    "portalType": "arcgis",
    "downloadUrl": "https://services.arcgis.com/qnjIrwR8z5Izc0ij/arcgis/rest/services/Montana_Administrative_Boundaries_Framework/FeatureServer/43/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 28,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Flathead County MT - 28 districts, bulk ingested from \"Montana Community Council Districts\""
  },

  '31179': {
    "cityFips": "31179",
    "cityName": "Wayne County",
    "state": "NE",
    "portalType": "arcgis",
    "downloadUrl": "https://services9.arcgis.com/2mdA2CAMjjkO9umV/arcgis/rest/services/City_Council_Wards_(Read_Only)/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 4,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 75,
    "discoveredBy": "automated",
    "notes": "Wayne County NE - 4 districts, bulk ingested from \"City_Council_Wards\""
  },

  '32031': {
    "cityFips": "32031",
    "cityName": "Washoe County",
    "state": "NV",
    "portalType": "arcgis",
    "downloadUrl": "https://services1.arcgis.com/DjfAyvUwdiY6gnFC/arcgis/rest/services/Publisher/FeatureServer/1/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 5,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 50,
    "discoveredBy": "automated",
    "notes": "Washoe County NV - 5 districts, bulk ingested from \"City Wards (2021)\""
  },

  '34029': {
    "cityFips": "34029",
    "cityName": "Ocean County",
    "state": "NJ",
    "portalType": "arcgis",
    "downloadUrl": "https://services2.arcgis.com/7a7OULZOTqe87h9O/arcgis/rest/services/Election_Districts_Adopted_032012/FeatureServer/1/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 4,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 50,
    "discoveredBy": "automated",
    "notes": "Ocean County NJ - 4 districts, bulk ingested from \"Existing Ward Boundary\""
  },

  '35005': {
    "cityFips": "35005",
    "cityName": "Chaves County",
    "state": "NM",
    "portalType": "arcgis",
    "downloadUrl": "https://services6.arcgis.com/I7MpuerrA39ZTFsX/arcgis/rest/services/City_of_Roswell_Political_Boundaries/FeatureServer/3/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 5,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 63,
    "discoveredBy": "automated",
    "notes": "Chaves County NM - 5 districts, bulk ingested from \"City of Roswell Council Wards\""
  },

  '35057': {
    "cityFips": "35057",
    "cityName": "Torrance County",
    "state": "NM",
    "portalType": "arcgis",
    "downloadUrl": "https://services.arcgis.com/Iq7du96UAXAOM1at/arcgis/rest/services/ClerksBasemap_AGOL/FeatureServer/8/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 5,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 83,
    "discoveredBy": "automated",
    "notes": "Torrance County NM - 5 districts, bulk ingested from \"2022 Farmington City Council Districts\""
  },

  '37163': {
    "cityFips": "37163",
    "cityName": "Sampson County",
    "state": "NC",
    "portalType": "arcgis",
    "downloadUrl": "https://services3.arcgis.com/fM4kjZmPOS4ay2Ff/arcgis/rest/services/Sampson_County_Viewer/FeatureServer/18/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 5,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 50,
    "discoveredBy": "automated",
    "notes": "Sampson County NC - 5 districts, bulk ingested from \"2021 Commissioner Districts\""
  },

  '40079': {
    "cityFips": "40079",
    "cityName": "Le Flore County",
    "state": "OK",
    "portalType": "arcgis",
    "downloadUrl": "https://services1.arcgis.com/T10PoAuLqJahkg0K/arcgis/rest/services/Council_Districts_2020/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 12,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Le Flore County OK - 12 districts, bulk ingested from \"Council Districts\""
  },

  '40121': {
    "cityFips": "40121",
    "cityName": "Pittsburg County",
    "state": "OK",
    "portalType": "arcgis",
    "downloadUrl": "https://services3.arcgis.com/vS6jO1qrSVqdHIdf/arcgis/rest/services/OpenGov_Map_Layers/FeatureServer/508/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 6,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 50,
    "discoveredBy": "automated",
    "notes": "Pittsburg County OK - 6 districts, bulk ingested from \"McAlester_City_Wards_2022\""
  },

  '40143': {
    "cityFips": "40143",
    "cityName": "Tulsa County",
    "state": "OK",
    "portalType": "arcgis",
    "downloadUrl": "https://services6.arcgis.com/TI4WUPORw6hUtDVO/arcgis/rest/services/City_Limits_and_Ward_Boundaries_WFL1/FeatureServer/1/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 5,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 50,
    "discoveredBy": "automated",
    "notes": "Tulsa County OK - 5 districts, bulk ingested from \"City Wards (Color Shading)\""
  },

  '40147': {
    "cityFips": "40147",
    "cityName": "Washington County",
    "state": "OK",
    "portalType": "arcgis",
    "downloadUrl": "https://services.arcgis.com/3xOwF6p0r7IHIjfn/arcgis/rest/services/Cherokee_Districts_2020/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 15,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 50,
    "discoveredBy": "automated",
    "notes": "Washington County OK - 15 districts, bulk ingested from \"2025_Council_Districts_B\""
  },

  '41005': {
    "cityFips": "41005",
    "cityName": "Clackamas County",
    "state": "OR",
    "portalType": "arcgis",
    "downloadUrl": "https://services2.arcgis.com/McQ0OlIABe29rJJy/arcgis/rest/services/Metro_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 6,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Clackamas County OR - 6 districts, bulk ingested from \"Metro Council Districts\""
  },

  '41043': {
    "cityFips": "41043",
    "cityName": "Linn County",
    "state": "OR",
    "portalType": "arcgis",
    "downloadUrl": "https://services1.arcgis.com/K1vRaK7vKFsLv6fj/arcgis/rest/services/Planning/FeatureServer/6/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 3,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 50,
    "discoveredBy": "automated",
    "notes": "Linn County OR - 3 districts, bulk ingested from \"Ward\""
  },

  '41051': {
    "cityFips": "41051",
    "cityName": "Multnomah County",
    "state": "OR",
    "portalType": "arcgis",
    "downloadUrl": "https://services5.arcgis.com/x7DNZL1YqNQVNykA/arcgis/rest/services/Jurisdictional_Districts/FeatureServer/3/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 6,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Multnomah County OR - 6 districts, bulk ingested from \"Metro Council Districts\""
  },

  '41059': {
    "cityFips": "41059",
    "cityName": "Umatilla County",
    "state": "OR",
    "portalType": "arcgis",
    "downloadUrl": "https://services3.arcgis.com/J3BmIuRRInRLwKNR/arcgis/rest/services/Hermiston_Comprehensive_Plan_Map_Public/FeatureServer/1/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 4,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 75,
    "discoveredBy": "automated",
    "notes": "Umatilla County OR - 4 districts, bulk ingested from \"City_Council_Wards\""
  },

  '45003': {
    "cityFips": "45003",
    "cityName": "Aiken County",
    "state": "SC",
    "portalType": "arcgis",
    "downloadUrl": "https://services5.arcgis.com/zCCfG21ove6rRtCW/arcgis/rest/services/Keep_Aiken_County_Beautiful_Working/FeatureServer/1/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 8,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 50,
    "discoveredBy": "automated",
    "notes": "Aiken County SC - 8 districts, bulk ingested from \"Council District Scores\""
  },

  '45013': {
    "cityFips": "45013",
    "cityName": "Beaufort County",
    "state": "SC",
    "portalType": "arcgis",
    "downloadUrl": "https://services.arcgis.com/mbPLXL6SDfBjrAmS/arcgis/rest/services/County_Council_Districts_UNIT_AS_TEXT_view/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 5,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Beaufort County SC - 5 districts, bulk ingested from \"County Council Districts\""
  },

  '45019': {
    "cityFips": "45019",
    "cityName": "Charleston County",
    "state": "SC",
    "portalType": "arcgis",
    "downloadUrl": "https://services.arcgis.com/jR9eNCjAkxwH2nLe/arcgis/rest/services/Charleston_County_Council_Districts/FeatureServer/7/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 9,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Charleston County SC - 9 districts, bulk ingested from \"CURRENT COUNTY COUNCIL DISTRICTS\""
  },

  '45029': {
    "cityFips": "45029",
    "cityName": "Colleton County",
    "state": "SC",
    "portalType": "arcgis",
    "downloadUrl": "https://services1.arcgis.com/m0cnLGKdhwao8WvM/arcgis/rest/services/Voter_Registration/FeatureServer/3/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 2,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Colleton County SC - 2 districts, bulk ingested from \"County Council Districts\""
  },

  '45035': {
    "cityFips": "45035",
    "cityName": "Dorchester County",
    "state": "SC",
    "portalType": "arcgis",
    "downloadUrl": "https://services.arcgis.com/ehmkfEMN55hUsomR/arcgis/rest/services/County_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 7,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Dorchester County SC - 7 districts, bulk ingested from \"CountyCouncilDistricts\""
  },

  '45041': {
    "cityFips": "45041",
    "cityName": "Florence County",
    "state": "SC",
    "portalType": "arcgis",
    "downloadUrl": "https://services1.arcgis.com/otEVSGO5ESloTE5q/arcgis/rest/services/Florence_County_Census_Information/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 9,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Florence County SC - 9 districts, bulk ingested from \"County Council Districts\""
  },

  '45045': {
    "cityFips": "45045",
    "cityName": "Greenville County",
    "state": "SC",
    "portalType": "arcgis",
    "downloadUrl": "https://services3.arcgis.com/YQLyddqtM8cTAr6Y/arcgis/rest/services/City_Council_Ward/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 6,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 75,
    "discoveredBy": "automated",
    "notes": "Greenville County SC - 6 districts, bulk ingested from \"City Council Wards\""
  },

  '45049': {
    "cityFips": "45049",
    "cityName": "Hampton County",
    "state": "SC",
    "portalType": "arcgis",
    "downloadUrl": "https://services1.arcgis.com/m0cnLGKdhwao8WvM/arcgis/rest/services/2022_Voting_Districts/FeatureServer/2/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 2,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Hampton County SC - 2 districts, bulk ingested from \"County Council Districts\""
  },

  '45071': {
    "cityFips": "45071",
    "cityName": "Newberry County",
    "state": "SC",
    "portalType": "arcgis",
    "downloadUrl": "https://services8.arcgis.com/ljZd4m5ZNRpFdCSa/arcgis/rest/services/Newberry_County_Council_Districts/FeatureServer/4/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 7,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Newberry County SC - 7 districts, bulk ingested from \"NewberryCountyCouncilDistricts\""
  },

  '45073': {
    "cityFips": "45073",
    "cityName": "Oconee County",
    "state": "SC",
    "portalType": "arcgis",
    "downloadUrl": "https://services1.arcgis.com/UOvRn2Rvzysthh3i/arcgis/rest/services/Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 5,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Oconee County SC - 5 districts, bulk ingested from \"Council_Districts\""
  },

  '45083': {
    "cityFips": "45083",
    "cityName": "Spartanburg County",
    "state": "SC",
    "portalType": "arcgis",
    "downloadUrl": "https://services9.arcgis.com/HoRra3ATPLGmyjn6/arcgis/rest/services/City_Council_District/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 6,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 83,
    "discoveredBy": "automated",
    "notes": "Spartanburg County SC - 6 districts, bulk ingested from \"City_Council_District\""
  },

  '46041': {
    "cityFips": "46041",
    "cityName": "Dewey County",
    "state": "SD",
    "portalType": "arcgis",
    "downloadUrl": "https://services3.arcgis.com/VaWuldDb7HYFU2ja/arcgis/rest/services/DEWEY_COUNTY_LAYERS2/FeatureServer/19/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 6,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 50,
    "discoveredBy": "automated",
    "notes": "Dewey County SD - 6 districts, bulk ingested from \"COMMISSIONER_DISTRICTS\""
  },

  '48005': {
    "cityFips": "48005",
    "cityName": "Angelina County",
    "state": "TX",
    "portalType": "arcgis",
    "downloadUrl": "https://services6.arcgis.com/Cj2HGLAAprJTsy8b/arcgis/rest/services/City_Wards/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 6,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 50,
    "discoveredBy": "automated",
    "notes": "Angelina County TX - 6 districts, bulk ingested from \"City_Wards\""
  },

  '48157': {
    "cityFips": "48157",
    "cityName": "Fort Bend County",
    "state": "TX",
    "portalType": "arcgis",
    "downloadUrl": "https://services2.arcgis.com/6vRbgYSxztFGZwla/arcgis/rest/services/Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 4,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Fort Bend County TX - 4 districts, bulk ingested from \"Council_Districts\""
  },

  '48201': {
    "cityFips": "48201",
    "cityName": "Harris County",
    "state": "TX",
    "portalType": "arcgis",
    "downloadUrl": "https://services8.arcgis.com/2iaYWEMdQLPv0ZUw/arcgis/rest/services/Council_Districts/FeatureServer/7/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 6,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Harris County TX - 6 districts, bulk ingested from \"Council Districts\""
  },

  '48259': {
    "cityFips": "48259",
    "cityName": "Kendall County",
    "state": "TX",
    "portalType": "arcgis",
    "downloadUrl": "https://services1.arcgis.com/IdcmpjAKMhM2YdbF/arcgis/rest/services/Council_District_and_Regions/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 9,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 50,
    "discoveredBy": "automated",
    "notes": "Kendall County TX - 9 districts, bulk ingested from \"Council_District_and_Regions\""
  },

  '48469': {
    "cityFips": "48469",
    "cityName": "Victoria County",
    "state": "TX",
    "portalType": "arcgis",
    "downloadUrl": "https://services6.arcgis.com/z8Duli34FfmN3nn5/arcgis/rest/services/City_of_Victoria_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 4,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Victoria County TX - 4 districts, bulk ingested from \"COVGIS.DBO.Council_Districts\""
  },

  '48491': {
    "cityFips": "48491",
    "cityName": "Williamson County",
    "state": "TX",
    "portalType": "arcgis",
    "downloadUrl": "https://services.arcgis.com/04HiymDgLlsbhaV4/arcgis/rest/services/City_Limits_and_Council_Districts/FeatureServer/1/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 4,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Williamson County TX - 4 districts, bulk ingested from \"Council Districts\""
  },

  '49057': {
    "cityFips": "49057",
    "cityName": "Weber County",
    "state": "UT",
    "portalType": "arcgis",
    "downloadUrl": "https://services3.arcgis.com/EQUrCLOlClMcob9C/arcgis/rest/services/OgdenValleyCouncilDistricts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 5,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Weber County UT - 5 districts, bulk ingested from \"OgdenValleyCouncilDistricts\""
  },

  '53053': {
    "cityFips": "53053",
    "cityName": "Pierce County",
    "state": "WA",
    "portalType": "arcgis",
    "downloadUrl": "https://services8.arcgis.com/5K6vnOH0GkPyJs6A/arcgis/rest/services/P_Council/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 3,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Pierce County WA - 3 districts, bulk ingested from \"Puyallup Council Districts\""
  },

  '53061': {
    "cityFips": "53061",
    "cityName": "Snohomish County",
    "state": "WA",
    "portalType": "arcgis",
    "downloadUrl": "https://services6.arcgis.com/z6WYi9VRHfgwgtyW/arcgis/rest/services/Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 5,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Snohomish County WA - 5 districts, bulk ingested from \"Council_Districts\""
  },

  '54061': {
    "cityFips": "54061",
    "cityName": "Monongalia County",
    "state": "WV",
    "portalType": "arcgis",
    "downloadUrl": "https://services7.arcgis.com/lE5mQkgxehcTjzKf/arcgis/rest/services/Morgantown_City_Wards_2023_to_2025_Public_Layer/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 7,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 50,
    "discoveredBy": "automated",
    "notes": "Monongalia County WV - 7 districts, bulk ingested from \"Morgantown City Wards 2023-2025\""
  },

  '2146027': {
    "cityFips": "2146027",
    "cityName": "Lexington-Fayette urban county",
    "state": "KY",
    "portalType": "arcgis",
    "downloadUrl": "https://services1.arcgis.com/Mg7DLdfYcSWIaDnu/arcgis/rest/services/Council_District/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 12,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 63,
    "discoveredBy": "automated",
    "notes": "Lexington-Fayette urban county KY - 12 districts, bulk ingested from \"Council District\""
  },

  '06037': {
    "cityFips": "06037",
    "cityName": "Los Angeles County",
    "state": "CA",
    "portalType": "arcgis",
    "downloadUrl": "https://services2.arcgis.com/zNjnZafDYCAJAbN0/arcgis/rest/services/NeighAssocCommunityResources/FeatureServer/1/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 7,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 83,
    "discoveredBy": "automated",
    "notes": "Los Angeles County CA - 7 districts, bulk ingested from \"City Council District\""
  },

  '06001': {
    "cityFips": "06001",
    "cityName": "Alameda County",
    "state": "CA",
    "portalType": "arcgis",
    "downloadUrl": "https://services3.arcgis.com/VRO5V8PH7DzSE6AU/arcgis/rest/services/City_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 6,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 83,
    "discoveredBy": "automated",
    "notes": "Alameda County CA - 6 districts, bulk ingested from \"City Council Districts\""
  },

  '01073': {
    "cityFips": "01073",
    "cityName": "Jefferson County",
    "state": "AL",
    "portalType": "arcgis",
    "downloadUrl": "https://services2.arcgis.com/Z4oonA9tfgNvnlIk/arcgis/rest/services/City_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 8,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 83,
    "discoveredBy": "automated",
    "notes": "Jefferson County AL - 8 districts, bulk ingested from \"City_Council_Districts\""
  },

  '08035': {
    "cityFips": "08035",
    "cityName": "Douglas County",
    "state": "CO",
    "portalType": "arcgis",
    "downloadUrl": "https://services7.arcgis.com/M6RDkiPo9JtEo7N6/arcgis/rest/services/City_Council_Districts/FeatureServer/1/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 2,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 83,
    "discoveredBy": "automated",
    "notes": "Douglas County CO - 2 districts, bulk ingested from \"City Council Districts\""
  },

  '06047': {
    "cityFips": "06047",
    "cityName": "Merced County",
    "state": "CA",
    "portalType": "arcgis",
    "downloadUrl": "https://services1.arcgis.com/wsz3l3tjYd5awPqD/arcgis/rest/services/Asphalt_Milling_Projects/FeatureServer/1/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 6,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 83,
    "discoveredBy": "automated",
    "notes": "Merced County CA - 6 districts, bulk ingested from \"Merced City Council Districts\""
  },

  '01125': {
    "cityFips": "01125",
    "cityName": "Tuscaloosa County",
    "state": "AL",
    "portalType": "arcgis",
    "downloadUrl": "https://services5.arcgis.com/4FkF0FRfs3fLDICE/arcgis/rest/services/Northport_2012_City_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 5,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 83,
    "discoveredBy": "automated",
    "notes": "Tuscaloosa County AL - 5 districts, bulk ingested from \"Northport_2012_City_Council_Districts\""
  },

  '06077': {
    "cityFips": "06077",
    "cityName": "San Joaquin County",
    "state": "CA",
    "portalType": "arcgis",
    "downloadUrl": "https://services3.arcgis.com/waC30SNtVvCK7olj/arcgis/rest/services/City_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 22,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 75,
    "discoveredBy": "automated",
    "notes": "San Joaquin County CA - 22 districts, bulk ingested from \"GEODATA_GIS_CityCouncilDistricts_polygon\""
  },

  '06073': {
    "cityFips": "06073",
    "cityName": "San Diego County",
    "state": "CA",
    "portalType": "arcgis",
    "downloadUrl": "https://services2.arcgis.com/eJcVbjTyyZIzZ5Ye/arcgis/rest/services/CouncilDistricts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 4,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "San Diego County CA - 4 districts, bulk ingested from \"Council Districts\""
  },

  '06071': {
    "cityFips": "06071",
    "cityName": "San Bernardino County",
    "state": "CA",
    "portalType": "arcgis",
    "downloadUrl": "https://services.arcgis.com/rfpJM1nx4s5ONZ3C/arcgis/rest/services/Council_Districts_View/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 6,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "San Bernardino County CA - 6 districts, bulk ingested from \"Council Districts\""
  },

  '06067': {
    "cityFips": "06067",
    "cityName": "Sacramento County",
    "state": "CA",
    "portalType": "arcgis",
    "downloadUrl": "https://services8.arcgis.com/Z9ZYiR8PU74Y5gVt/arcgis/rest/services/Admin_Boundaries_update/FeatureServer/1/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 8,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Sacramento County CA - 8 districts, bulk ingested from \"Council_Districts\""
  },

  '01083': {
    "cityFips": "01083",
    "cityName": "Limestone County",
    "state": "AL",
    "portalType": "arcgis",
    "downloadUrl": "https://services1.arcgis.com/l30Xr6XkGqKMjkly/arcgis/rest/services/Decatur_Council_Districts/FeatureServer/1/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 5,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Limestone County AL - 5 districts, bulk ingested from \"Decatur Council Districts\""
  },

  '08101': {
    "cityFips": "08101",
    "cityName": "Pueblo County",
    "state": "CO",
    "portalType": "arcgis",
    "downloadUrl": "https://services1.arcgis.com/IL17xsvNU5Bmw3RY/arcgis/rest/services/City_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 4,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 58,
    "discoveredBy": "automated",
    "notes": "Pueblo County CO - 4 districts, bulk ingested from \"Council Districts\""
  },

  '06013': {
    "cityFips": "06013",
    "cityName": "Contra Costa County",
    "state": "CA",
    "portalType": "arcgis",
    "downloadUrl": "https://services3.arcgis.com/42Dx6OWonqK9LoEE/arcgis/rest/services/2020ProposedLocations_WEB_Test/FeatureServer/12/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 4,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 50,
    "discoveredBy": "automated",
    "notes": "Contra Costa County CA - 4 districts, bulk ingested from \"Antioch City Council\""
  },

  '06111': {
    "cityFips": "06111",
    "cityName": "Ventura County",
    "state": "CA",
    "portalType": "arcgis",
    "downloadUrl": "https://services3.arcgis.com/EKquOdzev2aNwKyB/arcgis/rest/services/CouncilDistricts_official/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 5,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 50,
    "discoveredBy": "automated",
    "notes": "Ventura County CA - 5 districts, bulk ingested from \"Council_Districts2022\""
  },

  '06085': {
    "cityFips": "06085",
    "cityName": "Santa Clara County",
    "state": "CA",
    "portalType": "arcgis",
    "downloadUrl": "https://services2.arcgis.com/qmhndvC947rDNl6t/arcgis/rest/services/Ward_Boundary_(public)/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 7,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 50,
    "discoveredBy": "automated",
    "notes": "Santa Clara County CA - 7 districts, bulk ingested from \"Ward Boundary\""
  },

  '08015': {
    "cityFips": "08015",
    "cityName": "Chaffee County",
    "state": "CO",
    "portalType": "arcgis",
    "downloadUrl": "https://services8.arcgis.com/fRzYA77NIM7odeAM/arcgis/rest/services/CD_AGOL_MASTER_gdb/FeatureServer/45/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 3,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 50,
    "discoveredBy": "automated",
    "notes": "Chaffee County CO - 3 districts, bulk ingested from \"Commissioner_Districts\""
  },

  '08001': {
    "cityFips": "08001",
    "cityName": "Adams County",
    "state": "CO",
    "portalType": "arcgis",
    "downloadUrl": "https://services.arcgis.com/iyZLRarIZZa0GHya/arcgis/rest/services/GDB_for_CIPP_Web_Layers/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 4,
    "lastVerified": "2026-01-15T00:00:00.000Z",
    "confidence": 50,
    "discoveredBy": "automated",
    "notes": "Adams County CO - 4 districts, bulk ingested"
  },
};

export const COUNTY_PORTAL_COUNT = 95;
