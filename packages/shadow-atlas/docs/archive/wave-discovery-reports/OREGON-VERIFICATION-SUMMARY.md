# Oregon GIS Aggregator Verification Summary

**Extraction Date:** 2026-01-23
**Operator:** GIS Extraction Specialist
**State:** Oregon
**Mission:** Verify Oregon city council/ward portals from regional-aggregators.ts

---

## Executive Summary

✅ **All 4 Oregon endpoints VERIFIED**
📊 **Total features verified:** 21 (4 + 8 + 3 + 6)
🏙️ **New cities discovered:** 0 (all already in registry)
🔄 **Endpoint updates recommended:** 2 (Portland, Eugene)
🌐 **Regional entities:** 1 (Oregon Metro - not city council)

---

## Verified Endpoints

### 1. Portland City Council Districts ✅

**Endpoint:** `https://www.portlandmaps.com/arcgis/rest/services/Public/Auditor_ElectionsMap/MapServer/12`

- **Layer Name:** Portland City Council Districts Boundaries
- **Feature Count:** 4 districts
- **District Field:** `DISTRICT` (values: "1", "2", "3", "4")
- **Additional Fields:** pop_total, Ideal_pop, Diff_Ideal, DDeviation, ODeviation
- **FIPS:** 4159000
- **Confidence:** 95%

**Registry Status:** ✅ ALREADY EXISTS
**Current Registry Endpoint:** `https://www.portlandmaps.com/od/rest/services/COP_OpenData_Boundary/MapServer/1413`

**⚠️ RECOMMENDATION:** Update registry to use **Auditor_ElectionsMap** endpoint (official source)

**Download URL:**
```
https://www.portlandmaps.com/arcgis/rest/services/Public/Auditor_ElectionsMap/MapServer/12/query?where=1%3D1&outFields=*&f=geojson
```

**Notes:**
- Portland 2024 charter reform
- 4 geographic districts with 3 councilors each (12 total)
- Includes population balancing fields for redistricting analysis
- Spatial reference: Web Mercator (WKID 102100)

---

### 2. Eugene City Council Wards ✅

**Endpoint:** `https://gis.eugene-or.gov/arcgis/rest/services/PWE/Boundaries/MapServer/1`

- **Layer Name:** Wards
- **Feature Count:** 8 wards
- **District Field:** `ward_number` (values: 1-8)
- **Alternate Field:** `ward` (values: "E1"-"E8")
- **City Field:** `wardcity` (value: "EUG")
- **Additional Fields:** councilor
- **FIPS:** 4123850
- **Confidence:** 95%

**Registry Status:** ✅ ALREADY EXISTS
**Current Registry Endpoint:** `https://services3.arcgis.com/F7NiRLGNbA2hh7gE/arcgis/rest/services/EugWards/FeatureServer/0`

**⚠️ RECOMMENDATION:** Update registry to use **PWE/Boundaries** endpoint (authoritative source)

**Download URL:**
```
https://gis.eugene-or.gov/arcgis/rest/services/PWE/Boundaries/MapServer/1/query?where=1%3D1&outFields=*&f=geojson
```

**Notes:**
- Eugene wards E1-E8 with councilor names included
- Ward-based election system (one councilor per ward)
- Spatial reference: NAD 1983 HARN StatePlane Oregon North (WKID 2914)
- ~19,500 population per ward

---

### 3. Hillsboro City Council Wards ✅

**Endpoint:** `https://gis.hillsboro-oregon.gov/public/rest/services/public/Council_Wards/MapServer/0`

- **Layer Name:** Council_Wards
- **Feature Count:** 3 wards
- **District Field:** `WARD` (values: "1", "2", "3")
- **District Domain:** D_LU_CouncilWard (coded value domain)
- **Additional Fields:** NAME_1, NAME_2, IN_OUT
- **FIPS:** 4134100
- **Confidence:** 95%

**Registry Status:** ✅ ALREADY EXISTS (same endpoint)
**Current Registry Endpoint:** Same as verified endpoint

**✅ NO ACTION NEEDED** - Registry already uses correct endpoint

**Download URL:**
```
https://gis.hillsboro-oregon.gov/public/rest/services/public/Council_Wards/MapServer/0/query?where=1%3D1&outFields=*&f=geojson
```

**Notes:**
- Hillsboro 3 wards with dual council members (NAME_1 and NAME_2)
- Boundaries adopted January 3, 2023 (Ordinance 6433)
- Post-2020 Census redistricting
- Feature class in Landbase Topology
- Spatial reference: WGS 1984 (WKID 4326)

---

### 4. Oregon Metro Council Districts ⚠️ REGIONAL ONLY

**Endpoint:** `https://gis.oregonmetro.gov/arcgis/rest/services/OpenData/BoundaryDataWebMerc/MapServer/2`

- **Layer Name:** Metro Council District Boundaries
- **Feature Count:** 6 districts
- **District Field:** `DISTRICT` (values: 1-6)
- **Additional Fields:** NAME (councilor), EMAIL
- **Entity Type:** Regional Government (NOT city council)
- **Coverage:** Portland metro region (Clackamas, Multnomah, Washington counties)
- **Confidence:** 95%

**Registry Status:** 🚫 REGIONAL ONLY - NOT A CITY

**⚠️ DO NOT ADD TO CITY COUNCIL REGISTRY**

**Download URL:**
```
https://gis.oregonmetro.gov/arcgis/rest/services/OpenData/BoundaryDataWebMerc/MapServer/2/query?where=1%3D1&outFields=*&f=geojson
```

**Current Metro Councilors (verified 2026-01-23):**
1. District 1: Ashton Simpson (ashton.simpson@oregonmetro.gov)
2. District 2: Christine Lewis (christine.lewis@oregonmetro.gov)
3. District 3: Gerritt Rosenthal (gerritt.rosenthal@oregonmetro.gov)
4. District 4: Juan Carlos Gonzalez (juancarlos.gonzalez@oregonmetro.gov)
5. District 5: Mary Nolan (mary.nolan@oregonmetro.gov)
6. District 6: Duncan Hwang (duncan.hwang@oregonmetro.gov)

**Notes:**
- Oregon Metro is a regional government entity, NOT a city
- These are Metro Council districts (regional governance)
- Covers Portland metropolitan area
- Adopted December 2021
- May be useful for regional governance research but NOT city council data

---

## Cross-Reference Analysis

### Existing Oregon Cities in Registry (8 total)

| FIPS | City Name | Districts | Source | Endpoint Status |
|------|-----------|-----------|--------|-----------------|
| 4101000 | Albany | 3 | Wave automated | ✅ OK |
| 4115800 | Corvallis | 9 | Wave automated | ✅ OK |
| 4123850 | Eugene | 8 | Wave-E PNW | ⚠️ Update endpoint |
| 4130550 | Grants Pass | 4 | Wave automated | ✅ OK |
| 4134100 | Hillsboro | 3 | Wave-E PNW | ✅ OK (verified) |
| 4141650 | Lebanon | 3 | Wave automated | ✅ OK |
| 4152100 | Newberg | 6 | Wave automated | ✅ OK |
| 4159000 | Portland | 4 | Manual entry | ⚠️ Update endpoint |

### New Cities Discovered

**NONE** - All verified Oregon endpoints already exist in registry.

---

## Oregon State Analysis

### Statewide Aggregator

❌ **Oregon does NOT have a statewide council district aggregator**

Individual cities maintain their own GIS portals. Must query city-by-city.

### Coverage Assessment

✅ **Good coverage for major OR cities with council districts**

Cities verified in registry:
- Albany (3 districts)
- Corvallis (9 districts)
- Eugene (8 wards)
- Grants Pass (4 districts)
- Hillsboro (3 wards)
- Lebanon (3 districts)
- Newberg (6 districts)
- Portland (4 districts)

### Known At-Large Cities (no geographic districts)

These cities do NOT need GIS portals (elected at-large):
- **Gresham** (pop 114,247) - At-large with 7 numbered positions
- **Beaverton** (pop 97,494) - At-large with 6 councilors
- **Bend** - Likely at-large (needs confirmation)

### Investigation Targets

🔍 **Salem** - 8 wards mentioned in regional-aggregators.ts
- Endpoint needs verification via data.cityofsalem.net
- ArcGIS Hub item: 0f6dd26ba1ae49f5bedec30dcba0b1e8
- Should be investigated in future wave

---

## Recommendations

### 1. Update Existing Registry Entries (2 cities)

#### Portland (FIPS 4159000)
- **Current:** `https://www.portlandmaps.com/od/rest/services/COP_OpenData_Boundary/MapServer/1413`
- **Recommended:** `https://www.portlandmaps.com/arcgis/rest/services/Public/Auditor_ElectionsMap/MapServer/12`
- **Reason:** Auditor_ElectionsMap is official source with better metadata and population balancing fields

#### Eugene (FIPS 4123850)
- **Current:** `https://services3.arcgis.com/F7NiRLGNbA2hh7gE/arcgis/rest/services/EugWards/FeatureServer/0`
- **Recommended:** `https://gis.eugene-or.gov/arcgis/rest/services/PWE/Boundaries/MapServer/1`
- **Reason:** PWE/Boundaries is authoritative city GIS source with councilor information

### 2. No New Cities to Add

All verified Oregon endpoints already exist in registry. No NDJSON portal entries created.

### 3. Future Investigation

- **Salem OR** - Verify 8 wards endpoint via data.cityofsalem.net
- Check for any smaller OR cities with newly adopted district systems

---

## Data Quality Assessment

### Endpoint Reliability

✅ **All 4 endpoints verified with 95% confidence**

- Portland: High quality, official source
- Eugene: High quality, authoritative city GIS
- Hillsboro: High quality, in production topology
- Oregon Metro: High quality, regional government source

### Field Naming Quality

✅ **All endpoints have proper field naming and metadata**

- Portland: `DISTRICT` (string)
- Eugene: `ward_number` (int), `ward` (string)
- Hillsboro: `WARD` (string, coded domain)
- Oregon Metro: `DISTRICT` (int), `NAME`, `EMAIL`

### Feature Count Verification

✅ **All feature counts match expected values**

| Endpoint | Expected | Actual | Status |
|----------|----------|--------|--------|
| Portland | 4 | 4 | ✅ |
| Eugene | 8 | 8 | ✅ |
| Hillsboro | 3 | 3 | ✅ |
| Oregon Metro | 6 | 6 | ✅ |

---

## Output Files

### 1. JSON Results
**File:** `aggregator-oregon-results.json`
- Comprehensive endpoint verification data
- Field analysis and metadata
- Cross-reference analysis
- Recommendations

### 2. NDJSON Portals
**File:** `aggregator-oregon-portals.ndjson`
- Schema header only (no new cities)
- Notes on endpoint update recommendations

### 3. Summary Report
**File:** `OREGON-VERIFICATION-SUMMARY.md` (this file)
- Human-readable verification summary
- Detailed endpoint analysis
- Recommendations and action items

---

## Conclusion

**Mission Status:** ✅ **COMPLETE**

All 4 Oregon endpoints from regional-aggregators.ts have been verified:
- ✅ Portland - 4 districts (update endpoint recommended)
- ✅ Eugene - 8 wards (update endpoint recommended)
- ✅ Hillsboro - 3 wards (endpoint OK)
- ⚠️ Oregon Metro - 6 districts (regional government, not city council)

**No new cities discovered** - all verified endpoints already exist in registry.

**Action Items:**
1. Update Portland registry entry to use Auditor_ElectionsMap endpoint
2. Update Eugene registry entry to use PWE/Boundaries endpoint
3. Consider investigating Salem (8 wards) in future wave

**Oregon State Status:**
- No statewide aggregator exists
- Good coverage of major cities with council districts
- Individual city portals must be queried separately
