# Florida Aggregators: Expected vs. Actual Verification

**Discovery Wave:** wave-p-florida-aggregators
**Date:** 2026-01-23

---

## Executive Summary

This document compares the 4 Florida city portals listed in `regional-aggregators.ts` with the actual verification results from querying their endpoints.

**Key Findings:**
- ✅ 3/4 portals are working and verified
- ❌ 1/4 portals now blocked (Fort Lauderdale - requires authentication)
- ⚠️ 1 URL discrepancy found (Hollywood)
- ⚡ 1 better URL discovered (Cape Coral - official city IMS portal)

---

## Portal-by-Portal Comparison

### 1. Fort Lauderdale (FIPS: 1224000)

#### Listed in regional-aggregators.ts
```typescript
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
  notes: 'City of Fort Lauderdale GIS. 4 commission districts. Official FeatureServer.',
  confidence: 98,
  status: 'active',
}
```

#### Verification Result
```json
{
  "status": "BLOCKED - Authentication Required",
  "error": "HTTP 499 Token Required",
  "endpointUrl": "https://gis.fortlauderdale.gov/server/rest/services/CityCommissionDistricts/FeatureServer/0",
  "metadataAccessible": false,
  "queryAccessible": false,
  "actualFeatureCount": null,
  "verificationDate": "2026-01-23"
}
```

**Discrepancy:** Portal status in regional-aggregators.ts is `'active'` but portal now returns HTTP 499 "Token Required" error.

**Recommendation:**
- Update `status: 'active'` → `status: 'deprecated'` or create new status `'blocked'`
- Add note: "BLOCKED as of 2026-01-23: Portal requires authentication token. Not publicly accessible."
- Update `confidence: 98` → `confidence: 0`

**Registry Note:** The portal is already marked in `known-portals.ndjson` (line 501) with `lastVerified: "2026-01-23"` which suggests it was working recently. This is a **new block** that occurred very recently.

---

### 2. Hollywood (FIPS: 1232000)

#### Listed in regional-aggregators.ts
```typescript
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
  notes: 'City of Hollywood GIS. 6 commission districts + mayor at-large. MapServer layer 35.',
  confidence: 90,
  status: 'active',
}
```

#### Verification Result
```json
{
  "status": "URL INCORRECT - Portal Working but Different Endpoint",
  "error": "HTTP 404 Service InformationTechnology/Commission_Districts/MapServer not found",
  "listedEndpointUrl": "https://maps.hollywoodfl.org/arcgis/rest/services/InformationTechnology/Commission_Districts/MapServer/35",
  "actualWorkingUrl": "https://services1.arcgis.com/lfAczuQbfdRGdFQE/ArcGIS/rest/services/Commission_Districts/FeatureServer/17",
  "actualFeatureCount": 6,
  "layerName": "Commission Districts",
  "verificationDate": "2026-01-23"
}
```

**Discrepancy:** The URL in regional-aggregators.ts points to `maps.hollywoodfl.org` (city MapServer) but the actual working portal is on ArcGIS Online (`services1.arcgis.com`).

**Findings:**
- City GIS server exists at `maps.hollywoodfl.org` but does NOT have Commission_Districts service
- The InformationTechnology folder only contains `ParcelsTax` MapServer
- Hollywood uses ArcGIS Online for commission districts, not self-hosted infrastructure
- The registry has the CORRECT URL (verified as working)

**Recommendation:**
- Update regional-aggregators.ts `endpointUrl` to match the working registry URL:
  ```typescript
  endpointUrl: 'https://services1.arcgis.com/lfAczuQbfdRGdFQE/ArcGIS/rest/services/Commission_Districts/FeatureServer/17',
  ```
- Update `cityField: 'NAME'` → `cityField: 'Commissioner'` (based on actual fields)
- Update `districtField: 'DISTRICT'` → `districtField: 'DISTRICT'` ✅ (correct)
- Add note: "Hosted on ArcGIS Online, not city MapServer. Redistricted 12/7/2021."

**Actual Fields Available:**
- OBJECTID
- DISTRICT
- Commissioner
- Website
- CURRENT_TERM
- EMAIL
- FIRSTELECTED
- GlobalID
- created_user
- created_date

---

### 3. Cape Coral (FIPS: 1210275)

#### Listed in regional-aggregators.ts
```typescript
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
  notes: 'City of Cape Coral GIS. 7 council districts. Fields: DISTRICT, POPULATION, COUNCIL_NAME, District_Page.',
  confidence: 95,
  status: 'active',
}
```

#### Verification Result
```json
{
  "status": "VERIFIED - URL MATCHES",
  "endpointUrl": "https://capeims.capecoral.gov/arcgis/rest/services/IMS/City_of_Cape_Coral_IMS_AGOL/FeatureServer/25",
  "actualFeatureCount": 7,
  "layerName": "Council Districts",
  "verificationDate": "2026-01-23",
  "lastEditedDate": "2024-11-22",
  "sampleData": {
    "district": "1",
    "councilName": "William E. Steinke",
    "population": 27706,
    "districtPage": "http://www.capecoral.net/government/city_government/city_council/district_1.php"
  }
}
```

**Status:** ✅ PERFECT MATCH - regional-aggregators.ts URL is correct and verified working.

**Registry Comparison:**
- **Registry URL (outdated):** `https://services.arcgis.com/ZbVPNfkTF89LEyGa/arcgis/rest/services/City_of_Cape_Coral_Wayfinding_Survey_Map_WFL1/FeatureServer/9`
- **regional-aggregators.ts URL (correct):** `https://capeims.capecoral.gov/arcgis/rest/services/IMS/City_of_Cape_Coral_IMS_AGOL/FeatureServer/25`

**Finding:** regional-aggregators.ts has the BETTER, more authoritative URL. The registry needs to be updated to match regional-aggregators.ts.

**Recommendation:**
- ✅ NO CHANGES needed to regional-aggregators.ts (already correct)
- ⚠️ Update registry (known-portals.ndjson line 155) to use the official city IMS URL

---

### 4. Orange County / Orlando (FIPS: 1253000 city / 12095 county)

#### Listed in regional-aggregators.ts
```typescript
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
  notes: 'Orange County Public_Dynamic MapServer layer 151. 6 county commission districts. Orlando city has 6 commissioner districts.',
  confidence: 90,
  status: 'active',
}
```

#### Verification Result
```json
{
  "status": "VERIFIED WORKING",
  "endpointUrl": "https://ocgis4.ocfl.net/arcgis/rest/services/Public_Dynamic/MapServer/151",
  "actualFeatureCount": 6,
  "layerName": "Orlando Commission Districts",
  "verificationDate": "2026-01-23",
  "sampleData": {
    "districtId": "6",
    "commissionerName": "Samuel B. Ings"
  },
  "fields": ["OBJECTID", "COMMISSIONERDISTRICTID", "COMMISSIONERNAME", "SHAPE_Length", "SHAPE_Area"]
}
```

**Status:** ✅ VERIFIED - URL matches, feature count matches, portal working.

**Minor Field Clarification:**
- `cityField: 'COMMISSIONERNAME'` - This field contains commissioner names, not city names
- Since this is Orlando-specific (not multi-city), the cityField is not critical
- `districtField: 'COMMISSIONERDISTRICTID'` ✅ Correct

**Recommendation:**
- ✅ NO CHANGES needed - working correctly
- Consider: Update note to clarify this is "Orlando Commission Districts" (layer name) not "Orange County Commission Districts" (though hosted by county)

---

## Summary Table

| City | regional-aggregators.ts Status | Actual Status | URL Match? | Feature Count Match? | Action Needed |
|------|-------------------------------|---------------|------------|---------------------|---------------|
| **Fort Lauderdale** | `active` (conf: 98) | BLOCKED (HTTP 499) | ✅ URL correct | ❌ Cannot verify | DEPRECATE - auth required |
| **Hollywood** | `active` (conf: 90) | WORKING | ❌ URL incorrect (404) | ✅ 6 features | UPDATE URL to ArcGIS Online |
| **Cape Coral** | `active` (conf: 95) | WORKING | ✅ URL correct | ✅ 7 features | ✅ NO CHANGE NEEDED |
| **Orange County** | `active` (conf: 90) | WORKING | ✅ URL correct | ✅ 6 features | ✅ NO CHANGE NEEDED |

---

## Required Updates to regional-aggregators.ts

### 1. Fort Lauderdale - Mark as Blocked
```typescript
'fort-lauderdale-fl': {
  // ... existing fields ...
  endpointUrl: 'https://gis.fortlauderdale.gov/server/rest/services/CityCommissionDistricts/FeatureServer/0',
  expectedFeatureCount: 4,
  lastVerified: '2026-01-23',
  notes: 'BLOCKED as of 2026-01-23: Portal requires authentication token (HTTP 499). Was working during wave-k-fl-specialist verification. 4 commission districts. Contact Fort Lauderdale GIS for public access.',
  confidence: 0,  // WAS: 98
  status: 'deprecated',  // WAS: 'active'
}
```

### 2. Hollywood - Fix URL
```typescript
'hollywood-fl': {
  id: 'hollywood-fl',
  name: 'City of Hollywood Commission Districts',
  coverage: 'City of Hollywood, Florida',
  states: ['FL'],
  priority: 'P1',
  estimatedCities: 1,
  endpointUrl: 'https://services1.arcgis.com/lfAczuQbfdRGdFQE/ArcGIS/rest/services/Commission_Districts/FeatureServer/17',  // UPDATED
  layerType: 'council_districts',
  cityField: 'DISTRICT',  // UPDATED (was 'NAME')
  districtField: 'DISTRICT',
  expectedFeatureCount: 6,
  lastVerified: '2026-01-23',
  notes: 'City of Hollywood ArcGIS Online portal. 6 commission districts + mayor at-large. Redistricted 12/7/2021 after 2020 census. Hosted on ArcGIS Online (services1.arcgis.com), not city MapServer. Contains Commissioner, Website, EMAIL, CURRENT_TERM fields.',  // UPDATED
  confidence: 95,  // UPDATED (was 90)
  status: 'active',
}
```

### 3. Cape Coral - No Changes
✅ Already correct in regional-aggregators.ts

### 4. Orange County - Optional Note Update
```typescript
'orange-county-fl': {
  // ... existing fields unchanged ...
  notes: 'Orange County Public_Dynamic MapServer layer 151 (named "Orlando Commission Districts"). 6 county commission districts covering Orlando city area. Contains COMMISSIONERDISTRICTID, COMMISSIONERNAME fields. Hub: ocgis-datahub-ocfl.hub.arcgis.com.',  // CLARIFIED
  // ... rest unchanged ...
}
```

---

## Cross-Reference: Registry vs. Aggregators

### Registry Needs Updates (Based on Aggregator Verification)

**Cape Coral (known-portals.ndjson line 155):**
```diff
- "downloadUrl": "https://services.arcgis.com/ZbVPNfkTF89LEyGa/arcgis/rest/services/City_of_Cape_Coral_Wayfinding_Survey_Map_WFL1/FeatureServer/9/query?where=1%3D1&outFields=*&f=geojson",
+ "downloadUrl": "https://capeims.capecoral.gov/arcgis/rest/services/IMS/City_of_Cape_Coral_IMS_AGOL/FeatureServer/25/query?where=1%3D1&outFields=*&f=geojson",
- "portalType": "arcgis",
+ "portalType": "municipal-gis",
- "confidence": 63,
+ "confidence": 95,
- "discoveredBy": "automated",
+ "discoveredBy": "wave-p-florida",
- "notes": "Cape Coral FL - 7 districts, bulk ingested from \"Council_Districts\""
+ "notes": "Cape Coral FL - 7 council districts. Official city IMS FeatureServer. Contains DISTRICT, COUNCIL_NAME, POPULATION, District_Page. Last edited 2024-11-22. Upgraded from wayfinding survey to official city portal."
```

**Fort Lauderdale (known-portals.ndjson line 501):**
```diff
- "confidence": 95,
+ "confidence": 0,
+ "quarantined": true,
+ "quarantineReason": "Authentication required - HTTP 499 Token Required as of 2026-01-23",
```
(Or move to quarantined-portals.generated.ts)

---

## Lessons Learned

1. **URL Volatility:** Fort Lauderdale portal became restricted between wave-k verification and wave-p verification (both dated 2026-01-23), suggesting very recent policy change

2. **Hosting Patterns:** Hollywood uses ArcGIS Online instead of self-hosted infrastructure, contrary to regional-aggregators.ts listing

3. **Data Authority:** Cape Coral has TWO working URLs:
   - Old: ArcGIS Online wayfinding survey (lower authority)
   - New: Official city IMS portal (higher authority, richer data)
   - regional-aggregators.ts correctly uses the better URL

4. **Field Name Accuracy:** Hollywood's `cityField` should be `DISTRICT` (the actual district number field), not `NAME`

5. **Registry Lag:** Registry can fall behind regional-aggregators.ts when aggregators are manually curated with more recent research

---

## Conclusion

**regional-aggregators.ts Accuracy:** 75% (3/4 working, 1 blocked)
- 2 portals: Perfect match (Cape Coral, Orange County)
- 1 portal: URL incorrect but portal exists (Hollywood - fixable)
- 1 portal: Recently blocked (Fort Lauderdale - needs deprecation)

**Recommendation:** Update regional-aggregators.ts with the 2 corrections above, and use the verified aggregators.ts URLs to UPDATE the registry (reverse flow from typical verification).

**Files Generated:**
- ✅ aggregator-florida-results.json
- ✅ aggregator-florida-portals.ndjson (empty - no new cities)
- ✅ aggregator-florida-action-plan.md
- ✅ aggregator-florida-verification-commands.sh
- ✅ aggregator-florida-comparison.md (this file)
