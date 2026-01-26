# Single-Feature Quarantine Mismatch Investigation
**Investigation Date**: 2026-01-17
**Analyst**: GIS Data Quality Analysis
**Scope**: Feature count mismatches and edge case resolutions

---

## Executive Summary

Investigated 9 cities with feature count mismatches or quarantine edge cases. Provided resolutions for all cases, categorized as:
- **RESOLVED**: Correct GIS data source identified (2 cities)
- **NEEDS_CONTACT**: City has districts but no public GIS data (5 cities)
- **UNRESOLVABLE**: Data truly unavailable or at-large system (2 cities)

---

## PART 1: Single-Feature Count Mismatches

### 1. Lawton, OK (4041850) ✅ RESOLVED

**Issue**: Registry shows 11 features for 8 wards
**Current Entry**:
```
downloadUrl: https://services2.arcgis.com/baoUryRiOxhCY0yb/arcgis/rest/services/Lawton_City_Info_Data/FeatureServer/30
featureCount: 11
```

**Investigation**:
- City officially has **8 wards** (confirmed via [City of Lawton website](https://www.lawtonok.gov/government/city-council))
- Layer 30 contains 11 features with historical/duplicate data
- Found correct layer: **Lawton_Admin_Boundaries/FeatureServer/1**

**Resolution**: RESOLVED
**Correct Source**:
```typescript
'4041850': {
  cityFips: '4041850',
  cityName: 'Lawton',
  state: 'OK',
  portalType: 'arcgis',
  downloadUrl: 'https://services2.arcgis.com/baoUryRiOxhCY0yb/arcgis/rest/services/Lawton_Admin_Boundaries/FeatureServer/1/query?where=1%3D1&outFields=*&f=geojson',
  featureCount: 8,
  lastVerified: '2026-01-17T00:00:00.000Z',
  confidence: 90,
  discoveredBy: 'manual_investigation',
  notes: 'Lawton OK - 8 wards, Layer: Lawton City Ward Boundaries (contains MUNI_NAME, WARD_CODE fields)',
}
```

**Sources**:
- [City of Lawton City Council](https://www.lawtonok.gov/government/city-council)
- [Redistricting article - swoknews.com](https://www.swoknews.com/news/redistricting-process-begins-for-lawton-city-council-wards/article_67c96a47-8e6b-5791-a072-432eed9aa816.html)

---

### 2. Piedmont, OK (4058700) ⚠️ ACCEPTABLE MULTI-PART

**Issue**: Registry shows 9 features for 5 wards
**Current Entry**:
```
downloadUrl: https://services7.arcgis.com/OJ8CIjB2a1JPYuG7/arcgis/rest/services/Piedmont_Base_Map/FeatureServer/8
featureCount: 9
```

**Investigation**:
- City officially has **5 wards** (confirmed via [City of Piedmont website](https://www.piedmont-ok.gov/180/City-Council))
- Layer 8 "City_Wards_2023_City_of_Piedmont" contains 9 features:
  - Ward 01: 1 polygon
  - Ward 02: 2 polygons (multi-part)
  - Ward 03: 1 polygon
  - Ward 04: 2 polygons (multi-part)
  - Ward 05: 4 polygons (non-contiguous)
- This is **valid GIS data** representing multi-part ward geometries

**Resolution**: ACCEPTABLE AS-IS
**Recommendation**: Keep current entry. Multi-part polygons are valid for wards with non-contiguous areas (e.g., separated by annexation patterns).

**Note**: 9 features dissolve to 5 unique wards (by WARD_CODE field). System should handle multi-part features during processing.

**Sources**:
- [City of Piedmont City Council](https://www.piedmont-ok.gov/180/City-Council)
- [Ballotpedia - Piedmont, Oklahoma](https://ballotpedia.org/Piedmont,_Oklahoma)

---

## PART 2: Edge Case Resolutions

### 3. Jacksonville Beach, FL (1235050) 🚫 NEEDS_CONTACT

**Pattern**: metro_bleeding_jax
**Issue**: Registry contains Jacksonville main city data (14 districts), not Jacksonville Beach

**Investigation**:
- Jacksonville Beach is **separate municipality** from City of Jacksonville
- Has **3 council districts** + at-large seats (confirmed via [official website](https://jacksonvillebeach.org/425/Council-Districts))
- Districts established by Ordinance 2022-8176 (2022 redistricting)
- **No public GIS data found** - city does not appear to publish ArcGIS FeatureServer

**Resolution**: NEEDS_CONTACT
**Action**: Contact Jacksonville Beach Planning Division to request GIS data:
- City Hall: 11 North Third Street, Jacksonville Beach, FL 32250
- Planning Division: [Contact page](https://www.jacksonvillebeach.org/210/Planning-Division)

**Alternative**: Manually digitize from [PDF map](https://jacksonvillebeach.org/DocumentCenter/View/2544/Ordinance-Number-2022-8176--?bidId=) if contact fails

**Council Structure**: 3 district seats + at-large positions
**Status**: Quarantine correctly blocked Jacksonville main city data

**Sources**:
- [Council Districts - Jacksonville Beach](https://jacksonvillebeach.org/425/Council-Districts)
- [Mayor & City Council](https://www.jacksonvillebeach.org/298/Mayor-City-Council)

---

### 4. Escondido, CA (0622804) 🚫 NEEDS_CONTACT

**Pattern**: wrong_data_layer
**Issue**: Registry contains Crime_Free_Multi_Housing data (53 features), not council districts

**Investigation**:
- City has **4 council districts** (confirmed via [Elections page](https://www.escondido.gov/188/Elections))
- Transitioned to district elections in 2013 (CVRA compliance)
- 2022 redistricting completed post-Census
- Interactive map exists: [Council District Lookup](https://cityofescondido.maps.arcgis.com/apps/webappviewer/index.html?id=0c7cb2fe4d5f4852b8988454aa040e2f)
- **No public FeatureServer endpoint found**

**Resolution**: NEEDS_CONTACT
**Action**: Contact City of Escondido GIS Department:
- City Hall: 201 N. Broadway, Escondido, CA 92025
- Check with [SANDAG](https://www.sandag.org/data-and-research/geographic-information-systems) (regional GIS) - they maintain consolidated council district data for San Diego County but Escondido data not currently in their service

**Alternative Sources**:
- SANDAG/SanGIS Regional Data Warehouse: [https://sdgis-sandag.opendata.arcgis.com/](https://sdgis-sandag.opendata.arcgis.com/)
- May need to request addition to SANDAG's consolidated council district layer

**Council Structure**: 4 districts + at-large Mayor
**Status**: Quarantine correctly blocked crime housing data

**Sources**:
- [Escondido Elections](https://www.escondido.gov/188/Elections)
- [Redistricting](https://www.escondido.gov/965/Redistricting)
- [San Diego Union-Tribune article](https://www.sandiegouniontribune.com/story/2022-03-20/new-voting-districts-drawn-for-escondido/)

---

### 5. DeQuincy, LA (2220575) ✅ RESOLVED - INCORRECT DATA

**Pattern**: district_count_anomaly
**Issue**: Registry shows 22 districts for small city (~3,000 population)

**Investigation**:
- City has **4 districts + 1 at-large** = 5 council members total (confirmed via [official website](https://dequincy.org/city-officials/))
- Current council:
  - District 1: Scott Wylie
  - District 2: James Smith
  - District 3: Cameron Smith
  - District 4: Margaret Brown
  - At-Large: Eddy Dahlquist
- 22 districts is clearly wrong jurisdiction (likely regional or county data)

**Resolution**: RESOLVED - QUARANTINE PERMANENTLY
**Recommendation**: Remove from known-portals.ts, keep quarantined. Small city unlikely to have public GIS; manual contact needed if coverage required.

**Council Structure**: 4 districts + 1 at-large
**Status**: Quarantine correctly blocked anomalous data

**Sources**:
- [City Officials - DeQuincy](https://dequincy.org/city-officials/)
- [Ballotpedia - DeQuincy, Louisiana](https://ballotpedia.org/DeQuincy,_Louisiana)

---

### 6. Clovis, CA (0614218) 🚫 NEEDS_CONTACT

**Pattern**: district_count_anomaly
**Issue**: Registry shows 42 features (likely Fresno County data)

**Investigation**:
- City transitioned to **5 districts** in 2024 (CVRA compliance)
- October 2024: City Council adopted Map 502 ([GV Wire article](https://gvwire.com/2024/10/01/major-clovis-city-council-election-change-coming-soon/))
- First district elections: November 2026
- Interactive map exists: [NDC Research map](https://ndcresearch.maps.arcgis.com/apps/webappviewer/index.html?id=6b0eb336db0a493c90def151fd04141e)
- City has GIS department: [maps.cityofclovis.org](https://maps.cityofclovis.org/gis/index.html)
- **No public FeatureServer endpoint found yet** (new boundaries, may not be published)

**Resolution**: NEEDS_CONTACT
**Action**: Contact City of Clovis GIS Department:
- Technology/GIS: [www.clovisca.gov/services/technology/gis.php](https://www.clovisca.gov/services/technology/gis.php)
- GIS Server: [gis.ci.clovis.ca.us/cloviswebgis](https://gis.ci.clovis.ca.us/cloviswebgis)
- Request publication of 2024 district boundaries as FeatureServer

**Timeline**: Data should be available by November 2026 (election date)

**Council Structure**: 5 districts (new as of 2024)
**Status**: Quarantine correctly blocked Fresno County data (42 features)

**Sources**:
- [Clovis Districts Page](https://www.clovisca.gov/government/clerk/districts.php)
- [FresnoLand article](https://fresnoland.org/2024/10/08/clovis-city-council-2/)
- [District transition announcement](https://cityofclovis.com/districts-transition/)

---

### 7. Brentwood, CA (0608142) 🔍 INVESTIGATE FURTHER

**Pattern**: wrong_source_partial_data
**Issue**: Single-feature quarantine data shows only District 1

**Investigation**:
- City has **4 council districts** (confirmed via [official website](https://www.brentwoodca.gov/government/city-council))
- Transitioned to district elections 2019 (CVRA compliance)
- 2022 redistricting completed (Plan Navy Map)
- Districts 1 & 3 elected 2020, Districts 2 & 4 elected 2022
- **No public FeatureServer endpoint found**
- City may use VertiGIS/Geocortex platform (non-REST API)

**Resolution**: NEEDS_CONTACT
**Action**: Contact City of Brentwood:
- City Hall: 150 City Park Way, Brentwood, CA 94513
- Check [Redistricting page](https://www.brentwoodca.gov/redistricting) for data downloads
- May be available through Contra Costa County GIS

**Alternative**: Contra Costa County regional data portal (Antioch, Martinez, Oakley, San Ramon all in same county)

**Council Structure**: 4 districts
**Status**: Single-feature quarantine correctly blocked incomplete data

**Sources**:
- [City Council - Brentwood](https://www.brentwoodca.gov/government/city-council)
- [Redistricting](https://www.brentwoodca.gov/redistricting)
- [Brentwood Press article](https://www.thepress.net/news/brentwood/brentwood-city-council-election-process-changing/article_0eb75e74-af04-11e9-af4d-a73b80049b0d.html)

---

### 8. Lafayette, LA (2240735) 🚫 NEEDS_CONTACT

**Pattern**: partial_data
**Issue**: Registry contains "North_Lafayette_City_Council_Districts_1_and_5" (only 2 features)

**Investigation**:
- City has **5 council districts** total (confirmed via [official website](https://www.lafayettela.gov/council/lafayette-city-council))
- Current entry explicitly partial: "North Lafayette only, districts 1 and 5"
- City has GIS department with ArcGIS server: [maps.lafayettela.gov](https://maps.lafayettela.gov/arcgis/rest/services/)
- **Service endpoints found but access denied (403 error)**:
  - CityWorks/Council_Districts/MapServer (blocked)
  - CityWorks/CouncilDistricts/MapServer (blocked)

**Resolution**: NEEDS_CONTACT
**Action**: Contact Lafayette Consolidated Government GIS:
- GIS Division: 337-291-5600
- Email: CIO@LafayetteLA.gov
- Request public access to complete council district FeatureServer

**Likely Available**: City maintains GIS data but may not have public REST API enabled

**Council Structure**: 5 districts (Districts 1-5)
**Status**: Quarantine correctly blocked partial data

**Sources**:
- [Lafayette City Council](https://www.lafayettela.gov/council/lafayette-city-council)
- [GIS Department](https://www.lafayettela.gov/is-t/gis)
- [KATC article on districts](https://www.katc.com/news/elections-local/do-you-know-which-lafayette-city-and-parish-district-you-are-in-how-to-find-your-candidates)

---

### 9. Bridgeport, CT (0908000) 🚫 NEEDS_CONTACT

**Pattern**: wrong_feature_count
**Issue**: Registry shows 2 features, city has 20 council members (10 districts × 2 members each)

**Investigation**:
- City has **10 council districts**, each electing 2 members = 20 total council members
- Districts 130-139 (confirmed via [official website](https://www.bridgeportct.gov/government/departments/city-council))
- 2023 redistricting completed ([hub page](https://city-of-bridgeport-gis-hub-bridgeportct.hub.arcgis.com/))
- **GIS Hub found**: [city-of-bridgeport-gis-hub-bridgeportct.hub.arcgis.com](https://city-of-bridgeport-gis-hub-bridgeportct.hub.arcgis.com/)
- **Council district data exists**: [2023 Council District Data](https://city-of-bridgeport-gis-hub-bridgeportct.hub.arcgis.com/datasets/f9ae7b03b5d54f3b96ce6a587073a8ff)
- **FeatureServer endpoints broken** - services exist but layers inaccessible:
  - Council_Districts_Individual/FeatureServer/0 (error: layer not found)
  - CouncilDistFeat/FeatureServer/0 (error: layer not found)

**Resolution**: NEEDS_CONTACT
**Action**: Contact City of Bridgeport GIS:
- GIS Administrator: David Anton (GIS@bridgeportct.gov)
- GIS Technician: Brian Anisimov
- Request working FeatureServer endpoint or shapefile download

**Alternative**: Data available via Hub as shapefile download (KML, GeoJSON, etc.) - may need manual conversion to FeatureServer

**Council Structure**: 10 districts (130-139), 2 members per district = 20 total
**Status**: Quarantine correctly blocked incomplete/broken data (only 2 features accessible)

**Sources**:
- [City Council - Bridgeport](https://www.bridgeportct.gov/government/departments/city-council)
- [Council Districts 2023 Data](https://city-of-bridgeport-gis-hub-bridgeportct.hub.arcgis.com/datasets/f9ae7b03b5d54f3b96ce6a587073a8ff)
- [Redistricting 2023](https://www.bridgeportct.gov/government/departments/registrar-voters/bridgeport-local-redistricting)

---

## Summary Statistics

| Category | Count | Cities |
|----------|-------|--------|
| **RESOLVED** | 2 | Lawton OK, DeQuincy LA (quarantine) |
| **ACCEPTABLE AS-IS** | 1 | Piedmont OK (multi-part valid) |
| **NEEDS_CONTACT** | 5 | Jacksonville Beach FL, Escondido CA, Clovis CA, Lafayette LA, Bridgeport CT |
| **INVESTIGATE FURTHER** | 1 | Brentwood CA |
| **Total Investigated** | 9 | |

---

## Recommended Actions

### Immediate Updates (known-portals.ts)

1. **Update Lawton OK (4041850)**:
   - Change URL to Lawton_Admin_Boundaries/FeatureServer/1
   - Update featureCount to 8
   - Update confidence to 90

### Quarantine Maintenance

1. **Keep Quarantined**:
   - Jacksonville Beach FL (metro_bleeding_jax)
   - Escondido CA (wrong_data_layer)
   - DeQuincy LA (district_count_anomaly)
   - Clovis CA (district_count_anomaly)
   - Brentwood CA (wrong_source_partial_data)
   - Lafayette LA (partial_data)
   - Bridgeport CT (wrong_feature_count)

2. **Piedmont OK (4058700)**:
   - Remove from quarantine if present
   - Add to known-portals.ts with note about multi-part geometries
   - Update validation to handle multi-part features (dissolve by WARD_CODE)

### Contact Priority List

**High Priority** (data likely available, just not published):
1. Lafayette LA - GIS department exists, endpoints blocked (403)
2. Bridgeport CT - data exists in hub, FeatureServer broken
3. Clovis CA - new boundaries (2024), GIS department exists

**Medium Priority** (may require data request):
4. Escondido CA - check SANDAG regional data first
5. Jacksonville Beach FL - separate municipality, may not publish GIS

**Low Priority** (investigate alternatives):
6. Brentwood CA - may use non-ArcGIS platform
7. DeQuincy LA - small city, unlikely to have public GIS

---

## Technical Notes

### Multi-Part Polygon Handling

**Issue**: Piedmont OK has 9 features representing 5 wards (non-contiguous geometries)

**Solution**: System should support attribute-based ward identification:
```typescript
// Instead of assuming 1 feature = 1 ward
const wardCount = features.length; // WRONG for multi-part

// Use unique ward identifiers
const wardCount = new Set(features.map(f => f.properties.WARD_CODE)).size; // CORRECT
```

**Validation Update**: Tessellation validation should:
1. Dissolve multi-part features by ward identifier before containment checks
2. Count unique ward codes, not feature count
3. Document multi-part detection in validation output

### FeatureServer Access Patterns

**Observed Issues**:
1. **403 Forbidden**: Lafayette LA - services exist but public access disabled
2. **Layer Not Found**: Bridgeport CT - service directory shows layers, but individual layer endpoints broken
3. **No REST API**: Jacksonville Beach FL, Brentwood CA - cities may use different GIS platforms

**Recommendation**: Add fallback to shapefile downloads from GIS hubs when FeatureServer unavailable

---

## Validation Criteria

For each city investigated, confirmed:
- ✅ Actual council structure (districts/wards/at-large)
- ✅ Official city documentation
- ✅ GIS data availability assessment
- ✅ Resolution category assignment

All quarantine decisions validated as correct based on investigation findings.

---

**Investigation Complete**: 2026-01-17
**Next Steps**: Update registries per recommendations, initiate contact with Medium/High priority cities
