# Florida Aggregator Verification - Action Plan

**Discovery Wave:** wave-p-florida-aggregators
**Date:** 2026-01-23
**Status:** Verification Complete - Updates Required

---

## Executive Summary

Verified 4 Florida city portals from regional-aggregators.ts. All 4 cities were already in the registry. **3 portals are working**, **1 is now blocked**, and **1 needs URL update**.

**Key Finding:** Cape Coral has a more authoritative official city portal that should replace the current ArcGIS Online wayfinding service URL.

**Critical Issue:** Fort Lauderdale portal now requires authentication and should be quarantined.

---

## Verification Results

### ✅ Working Portals (3)

#### 1. Hollywood, FL (FIPS: 1232000)
- **Status:** ✅ VERIFIED WORKING
- **URL:** https://services1.arcgis.com/lfAczuQbfdRGdFQE/ArcGIS/rest/services/Commission_Districts/FeatureServer/17
- **Feature Count:** 6 (verified)
- **Last Verified:** 2026-01-23
- **Action:** None required - portal is working correctly

**Data Quality:**
- Commissioner names: Yes
- Commissioner emails: Yes
- Website links: Yes
- Redistricting date: 2021-12-07 (post-2020 census)

---

#### 2. Orlando/Orange County, FL (FIPS: 1253000 city / 12095 county)
- **Status:** ✅ VERIFIED WORKING
- **URL:** https://ocgis4.ocfl.net/arcgis/rest/services/Public_Dynamic/MapServer/151
- **Feature Count:** 6 (verified)
- **Last Verified:** 2026-01-23
- **Action:** None required - portal is working correctly

**Data Quality:**
- Commissioner names: Yes (e.g., "Samuel B. Ings" for District 6)
- District IDs: Yes (COMMISSIONERDISTRICTID field)
- Geometry: Yes (esriGeometryPolygon)

---

#### 3. Cape Coral, FL (FIPS: 1210275)
- **Status:** ⚠️ WORKING BUT NEEDS URL UPDATE
- **Current Registry URL:** https://services.arcgis.com/ZbVPNfkTF89LEyGa/arcgis/rest/services/City_of_Cape_Coral_Wayfinding_Survey_Map_WFL1/FeatureServer/9
- **Better Official URL:** https://capeims.capecoral.gov/arcgis/rest/services/IMS/City_of_Cape_Coral_IMS_AGOL/FeatureServer/25
- **Feature Count:** 7 (verified on both URLs)
- **Last Verified:** 2026-01-23
- **Action Required:** UPDATE registry with official city portal URL

**Why Update?**
- Official city IMS server (capeims.capecoral.gov) is more authoritative
- Current URL is ArcGIS Online "wayfinding survey" service (less official)
- Official portal has richer data: population, council names, district pages
- Last edited: 2024-11-22 (recent data)
- Confidence level should increase from 63 → 95

**Data Quality (Official Portal):**
- Council member names: Yes (e.g., "William E. Steinke" for District 1)
- Population by district: Yes (e.g., District 1: 27,706)
- District pages: Yes (http://www.capecoral.net/government/city_government/city_council/district_1.php)
- Last edited: November 22, 2024

---

### ❌ Blocked Portals (1)

#### 4. Fort Lauderdale, FL (FIPS: 1224000)
- **Status:** ❌ BLOCKED - REQUIRES QUARANTINE
- **Registry URL:** https://gis.fortlauderdale.gov/server/rest/services/CityCommissionDistricts/FeatureServer/0
- **Expected Feature Count:** 4
- **Error:** HTTP 499 "Token Required"
- **Last Successful Verification:** 2026-01-23 (per registry)
- **Action Required:** QUARANTINE portal in registry

**Issue Details:**
- Portal now requires authentication token for all endpoints
- Both metadata endpoint (?f=json) and query endpoint return error 499
- Not publicly accessible
- Service root (/rest/services) is accessible but specific services require auth

**Quarantine Process:**
1. Move entry to quarantined-portals.generated.ts
2. Document reason: "Authentication required - error 499"
3. Add note: "Portal was working as of wave-k-fl-specialist but now blocked as of 2026-01-23"
4. Consider: Contact Fort Lauderdale GIS team for public access or alternative portal

---

## Required Actions

### Priority 1: Quarantine Fort Lauderdale
```bash
# Move from known-portals.ndjson to quarantined list
# Reason: Authentication required (HTTP 499)
# FIPS: 1224000
```

**Impact:** Low - portal was already in registry, just needs status update to reflect it's no longer accessible

---

### Priority 2: Update Cape Coral URL
**Current Entry (known-portals.ndjson line 155):**
```json
{
  "_fips": "1210275",
  "cityFips": "1210275",
  "cityName": "Cape Coral",
  "state": "FL",
  "portalType": "arcgis",
  "downloadUrl": "https://services.arcgis.com/ZbVPNfkTF89LEyGa/arcgis/rest/services/City_of_Cape_Coral_Wayfinding_Survey_Map_WFL1/FeatureServer/9/query?where=1%3D1&outFields=*&f=geojson",
  "featureCount": 7,
  "lastVerified": "2026-01-15T00:00:00.000Z",
  "confidence": 63,
  "discoveredBy": "automated",
  "notes": "Cape Coral FL - 7 districts, bulk ingested from \"Council_Districts\""
}
```

**Updated Entry:**
```json
{
  "_fips": "1210275",
  "cityFips": "1210275",
  "cityName": "Cape Coral",
  "state": "FL",
  "portalType": "municipal-gis",
  "downloadUrl": "https://capeims.capecoral.gov/arcgis/rest/services/IMS/City_of_Cape_Coral_IMS_AGOL/FeatureServer/25/query?where=1%3D1&outFields=*&f=geojson",
  "featureCount": 7,
  "lastVerified": "2026-01-23T00:00:00.000Z",
  "confidence": 95,
  "discoveredBy": "wave-p-florida",
  "notes": "Cape Coral FL - 7 council districts. Official city IMS FeatureServer. Contains DISTRICT, COUNCIL_NAME, POPULATION, District_Page. Last edited 2024-11-22. Upgraded from wayfinding survey to official city portal."
}
```

**Changes:**
- `portalType`: "arcgis" → "municipal-gis" (more specific)
- `downloadUrl`: Updated to official city portal
- `lastVerified`: Updated to 2026-01-23
- `confidence`: 63 → 95 (official city source)
- `discoveredBy`: "automated" → "wave-p-florida"
- `notes`: Enhanced with data quality details

**Impact:** Medium - improves data quality and portal authority

---

## New Portals Discovered

**Count:** 0

All 4 verified Florida portals were already in the registry (discovered by wave-k-fl-specialist, wave-l-fl-specialist, and automated processes).

**Empty NDJSON file created:**
`/Users/noot/Documents/voter-protocol/packages/shadow-atlas/.shadow-atlas/wave-discovery/aggregator-florida-portals.ndjson`

---

## Regional Aggregators URL Discrepancies

The regional-aggregators.ts file had one incorrect URL:

**Hollywood FL:**
- **Listed in aggregators:** https://maps.hollywoodfl.org/arcgis/rest/services/InformationTechnology/Commission_Districts/MapServer/35
- **Error:** HTTP 404 "Service InformationTechnology/Commission_Districts/MapServer not found"
- **Correct URL (in registry):** https://services1.arcgis.com/lfAczuQbfdRGdFQE/ArcGIS/rest/services/Commission_Districts/FeatureServer/17
- **Action:** Update regional-aggregators.ts with correct URL

**Note:** The Hollywood city GIS server (maps.hollywoodfl.org) exists but the Commission_Districts service is hosted on ArcGIS Online, not the municipal server.

---

## Data Quality Assessment

### High Quality (2 portals)
- **Cape Coral:** Population, council names, district pages, recent edits (Nov 2024)
- **Hollywood:** Commissioner names, emails, websites, post-2020 redistricting

### Medium Quality (1 portal)
- **Orlando:** Commissioner names, district IDs, geometry (minimal attributes)

### Unknown Quality (1 portal)
- **Fort Lauderdale:** Blocked - cannot assess

---

## Technical Notes

1. **Authentication Trends:** Fort Lauderdale requiring tokens suggests some municipalities are restricting GIS access
2. **Hosting Patterns:** Hollywood uses ArcGIS Online instead of self-hosted infrastructure
3. **Data Freshness:** Cape Coral data edited as recently as November 2024
4. **Service Types:** Mix of FeatureServer (Cape Coral, Hollywood) and MapServer (Orlando)
5. **Field Consistency:** All use district ID fields, most include representative names

---

## Follow-Up Actions

### Immediate
1. ✅ Create verification results JSON (COMPLETE)
2. ✅ Create empty portals NDJSON (COMPLETE - no new portals)
3. ✅ Document action plan (COMPLETE)
4. ⏳ Update Cape Coral registry entry
5. ⏳ Quarantine Fort Lauderdale portal

### Future
1. Monitor Fort Lauderdale portal for public access restoration
2. Contact Fort Lauderdale GIS team about public data access
3. Update regional-aggregators.ts with corrected Hollywood URL
4. Consider periodic verification of all Florida portals
5. Extract and archive Cape Coral data before URL migration

---

## Files Generated

1. `/Users/noot/Documents/voter-protocol/packages/shadow-atlas/.shadow-atlas/wave-discovery/aggregator-florida-results.json`
   - Comprehensive verification results with technical details

2. `/Users/noot/Documents/voter-protocol/packages/shadow-atlas/.shadow-atlas/wave-discovery/aggregator-florida-portals.ndjson`
   - Empty file (no new portals discovered)

3. `/Users/noot/Documents/voter-protocol/packages/shadow-atlas/.shadow-atlas/wave-discovery/aggregator-florida-action-plan.md`
   - This document

---

## Conclusion

**Success Metrics:**
- ✅ 4/4 portals verified
- ✅ 3/4 portals working (75% success rate)
- ✅ 1 portal identified for upgrade (Cape Coral)
- ⚠️ 1 portal blocked (Fort Lauderdale - requires remediation)

**Net Result:** Registry is mostly accurate. One upgrade available (Cape Coral), one quarantine needed (Fort Lauderdale).

**Recommendation:** Proceed with Cape Coral URL update and Fort Lauderdale quarantine. Monitor blocked portal for future public access restoration.
