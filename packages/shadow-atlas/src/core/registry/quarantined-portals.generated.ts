/**
 * Quarantined Portal Entries
 *
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 * !! THIS FILE IS AUTO-GENERATED - DO NOT EDIT MANUALLY !!
 * !! Source: data/registries/quarantined-portals.ndjson
 * !! Generated: 2026-01-24T06:47:59.469Z
 * !! To modify: Edit the NDJSON file, then run: npm run registry:generate
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 *
 * PURPOSE: Entries removed from known-portals due to data quality issues
 * Quarantined entries: 9
 * Description: Entries removed due to data quality issues, pending review
 */

import type { PortalType, DiscoveredBy } from './known-portals.generated.js';

export interface QuarantinedPortal {
  readonly cityFips: string;
  readonly cityName: string;
  readonly state: string;
  readonly portalType: PortalType;
  readonly downloadUrl: string;
  readonly featureCount: number;
  readonly lastVerified: string;
  readonly confidence: number;
  readonly discoveredBy: DiscoveredBy;
  readonly notes?: string;
  readonly quarantineReason: string;
  readonly matchedPattern: string;
  readonly quarantinedAt: string;
}

export const QUARANTINED_PORTALS: Record<string, QuarantinedPortal> = {
  '0174976': {
      "cityFips": "0174976",
      "cityName": "Tarrant",
      "state": "AL",
      "portalType": "arcgis",
      "downloadUrl": "https://quarantined.invalid/county-data",
      "featureCount": 9,
      "lastVerified": "2026-01-16T00:00:00.000Z",
      "confidence": 0,
      "discoveredBy": "automated",
      "notes": "WS-3 remediation: Birmingham/Jefferson County districts (9 features), separate city from Birmingham.",
      "quarantineReason": "CONTAINMENT FAILURE: URL contains Birmingham/Jefferson County district data instead of Tarrant city council districts. 100% overflow - districts completely outside city boundary.",
      "matchedPattern": "containment_failure",
      "quarantinedAt": "2026-01-19T00:00:00.000Z"
  },
  '0614218': {
      "cityFips": "0614218",
      "cityName": "Clovis",
      "state": "CA",
      "portalType": "arcgis",
      "downloadUrl": "https://services3.arcgis.com/ibgDyuD2DLBge82s/arcgis/rest/services/City_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
      "featureCount": 42,
      "lastVerified": "2026-01-15T00:00:00.000Z",
      "confidence": 0,
      "discoveredBy": "automated",
      "notes": "Clovis CA - 5 council districts (Map 502, March 2025 CVRA transition). Quarantined URL contains Fresno County regional data (42 features), NOT Clovis city. NEEDS_CONTACT: No public GIS endpoint for new districts.",
      "quarantineReason": "CVRA TRANSITION: City has 5 districts (Map 502, March 2025) but no public ArcGIS REST endpoint found. Current URL is Fresno County City_Council_Districts service with 42 features covering multiple cities. Contact city planning for Map 502 GIS data.",
      "matchedPattern": "cvra_gis_unavailable",
      "quarantinedAt": "2026-01-16T23:30:00.000Z"
  },
  '1861092': {
      "cityFips": "1861092",
      "cityName": "Portage",
      "state": "IN",
      "portalType": "arcgis",
      "downloadUrl": "https://services5.arcgis.com/Qp5vz8Fz7vawwcWD/arcgis/rest/services/Council_Reps/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
      "featureCount": 37,
      "lastVerified": "2026-01-15T00:00:00.000Z",
      "confidence": 0,
      "discoveredBy": "automated",
      "notes": "Portage IN - HYBRID (5 district + 2 at-large). Quarantined URL contains VOTING PRECINCTS (37 features), NOT council districts. BLOCKED: No public GIS endpoint for actual district polygons.",
      "quarantineReason": "HYBRID SYSTEM: 5 geographic districts exist but current URL is voting precinct data (37 precincts assigned to council reps). Ordinance 21-2012 boundaries not published as REST service. PDF map available but no machine-readable boundary data.",
      "matchedPattern": "hybrid_gis_unavailable",
      "quarantinedAt": "2026-01-16T23:45:00.000Z"
  },
  '2220575': {
      "cityFips": "2220575",
      "cityName": "DeQuincy",
      "state": "LA",
      "portalType": "arcgis",
      "downloadUrl": "https://services.arcgis.com/T7YR8Q3OOFw14uBe/arcgis/rest/services/City_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
      "featureCount": 22,
      "lastVerified": "2026-01-15T00:00:00.000Z",
      "confidence": 0,
      "discoveredBy": "automated",
      "notes": "DeQuincy LA - HYBRID (4 district + 1 at-large, Lawrason Act). Quarantined URL contains Calcasieu Parish regional data (22 features), NOT DeQuincy city council. BLOCKED: No city-specific GIS endpoint available.",
      "quarantineReason": "HYBRID SYSTEM: 4 geographic districts exist but no public city-specific ArcGIS REST endpoint found. Current URL is Calcasieu Parish GIS with 22 features (parish voting precincts or multi-city composite). Service may serve Lake Charles, Sulphur, Westlake, DeQuincy, etc.",
      "matchedPattern": "hybrid_gis_unavailable",
      "quarantinedAt": "2026-01-16T23:00:00.000Z"
  },
  '2252040': {
      "cityFips": "2252040",
      "cityName": "Morgan City",
      "state": "LA",
      "portalType": "arcgis",
      "downloadUrl": "https://quarantined.invalid/parish-data",
      "featureCount": 8,
      "lastVerified": "2026-01-16T00:00:00.000Z",
      "confidence": 0,
      "discoveredBy": "automated",
      "notes": "WS-3 remediation: St. Mary Parish districts (8 features), not city council districts.",
      "quarantineReason": "CONTAINMENT FAILURE: URL contains St. Mary Parish district data instead of Morgan City council districts. 100% overflow - districts completely outside city boundary.",
      "matchedPattern": "containment_failure",
      "quarantinedAt": "2026-01-19T00:00:00.000Z"
  },
  '2910240': {
      "cityFips": "2910240",
      "cityName": "Byrnes Mill",
      "state": "MO",
      "portalType": "arcgis",
      "downloadUrl": "https://quarantined.invalid/county-data",
      "featureCount": 7,
      "lastVerified": "2026-01-22T00:00:00.000Z",
      "confidence": 0,
      "discoveredBy": "automated",
      "notes": "Byrnes Mill MO - WARD-BASED: 2 wards (Mayor + 4 aldermen, 2 per ward). Population ~2,900. Fourth-class city in Jefferson County. No public GIS endpoint - rural community without dedicated GIS infrastructure.",
      "quarantineReason": "WARD GIS UNAVAILABLE: City has 2 wards but no public ArcGIS REST endpoint. Small fourth-class city without dedicated GIS. Original URL was Jefferson County district data (7 features). Ward boundaries defined in city ordinances but not digitized.",
      "matchedPattern": "ward_gis_unavailable",
      "quarantinedAt": "2026-01-19T00:00:00.000Z"
  },
  '2916228': {
      "cityFips": "2916228",
      "cityName": "Cool Valley",
      "state": "MO",
      "portalType": "arcgis",
      "downloadUrl": "https://quarantined.invalid/county-data",
      "featureCount": 7,
      "lastVerified": "2026-01-22T00:00:00.000Z",
      "confidence": 0,
      "discoveredBy": "automated",
      "notes": "Cool Valley MO - WARD-BASED: 4 wards (elections every 2 years, staggered terms). Population ~1,100. Fourth-class city under Revised Statutes of Missouri. No public GIS endpoint - small city operates via paper records and county GIS.",
      "quarantineReason": "WARD GIS UNAVAILABLE: City has 4 wards but no public ArcGIS REST endpoint. Small fourth-class city without dedicated GIS infrastructure. Original URL was St. Louis County district data (7 features). Ward boundaries defined in city charter but not digitized.",
      "matchedPattern": "ward_gis_unavailable",
      "quarantinedAt": "2026-01-19T00:00:00.000Z"
  },
  '2917218': {
      "cityFips": "2917218",
      "cityName": "Crestwood",
      "state": "MO",
      "portalType": "arcgis",
      "downloadUrl": "https://quarantined.invalid/county-data",
      "featureCount": 4,
      "lastVerified": "2026-01-22T00:00:00.000Z",
      "confidence": 0,
      "discoveredBy": "automated",
      "notes": "Crestwood MO - WARD-BASED: 4 wards (2-year staggered terms). Population ~11,800. Fourth-class city. No public GIS endpoint - city uses St. Louis County GIS infrastructure but doesn't publish ward boundaries separately.",
      "quarantineReason": "WARD GIS UNAVAILABLE: City has 4 wards but no public ArcGIS REST endpoint. Uses St. Louis County GIS infrastructure without dedicated ward layer. Original URL was county district data (4 features). Ward boundaries exist in municipal code but not published as GIS service.",
      "matchedPattern": "ward_gis_unavailable",
      "quarantinedAt": "2026-01-19T00:00:00.000Z"
  },
  '3904878': {
      "cityFips": "3904878",
      "cityName": "Bedford",
      "state": "OH",
      "portalType": "arcgis",
      "downloadUrl": "https://quarantined.invalid/county-data",
      "featureCount": 11,
      "lastVerified": "2026-01-16T00:00:00.000Z",
      "confidence": 0,
      "discoveredBy": "automated",
      "notes": "WS-3 remediation: Cuyahoga County council districts (11 features), separate city.",
      "quarantineReason": "CONTAINMENT FAILURE: URL contains Cuyahoga County council district data instead of Bedford city council districts. 100% overflow - districts completely outside city boundary.",
      "matchedPattern": "containment_failure",
      "quarantinedAt": "2026-01-19T00:00:00.000Z"
  },
};

export const QUARANTINE_COUNT = 9;
