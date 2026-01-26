# PASDA Pennsylvania Regional Aggregator - Wave P Extraction Report

**Extraction Date:** 2026-01-24  
**Discovery Wave:** Wave P - PASDA Pennsylvania  
**Discovered By:** wave-p-pasda-pa  
**Confidence Level:** 95%

---

## Executive Summary

Successfully extracted and verified ward/district boundary data from **6 PASDA MapServer layers** covering Pennsylvania municipalities. Discovered **11 new city portals** with ward structures suitable for Shadow Atlas integration.

### Key Metrics
- **Total Layers Queried:** 6
- **Total Cities Discovered:** 14
- **New Cities Found:** 11
- **Existing Cities Verified:** 3 (Philadelphia, Pittsburgh, Allentown)

---

## Data Sources

### PASDA (Pennsylvania Geospatial Data Clearinghouse)
Base URL: `https://mapservices.pasda.psu.edu/server/rest/services/pasda/`

| Layer | Type | Municipalities | Features | Status |
|-------|------|---------------|----------|---------|
| CityPhilly/MapServer/29 | Council Districts | Philadelphia | 10 | Existing |
| PittsburghCity/MapServer/10 | Council Districts | Pittsburgh | 9 | Existing |
| AlleghenyCounty/MapServer/14 | County Council | County-level | 13 | Skipped |
| LehighCounty/MapServer/6 | Wards | 5 municipalities | 33 | Multi-city |
| BerksCounty/MapServer/3 | Wards | Reading + 72 others | 205 | Extracted Reading |
| YorkCounty/MapServer/26 | Voting Districts | 72 municipalities | 161 | Extracted 6 cities |

---

## New Portals Discovered (11)

### Berks County
1. **Reading** (FIPS: 4263624)
   - 19 wards
   - Filter: `MUNI_NAME='READING'`
   - Source: Berks County Layer 3

### Lehigh County
2. **Bethlehem** (FIPS: 4206088)
   - 4 wards (Lehigh County portion only)
   - Filter: `MUNI_WARD LIKE '03%'`
   - Source: Lehigh County Layer 6
   - Note: City spans Lehigh and Northampton counties

3. **Fountain Hill** (FIPS: 4227008)
   - 2 wards
   - Filter: `MUNI_WARD LIKE '08%'`
   - Source: Lehigh County Layer 6

4. **Salisbury** (FIPS: 4267584)
   - 5 wards
   - Filter: `MUNI_WARD LIKE '17%'`
   - Source: Lehigh County Layer 6

5. **Slatington** (FIPS: 4271144)
   - 3 wards
   - Filter: `MUNI_WARD LIKE '18%'`
   - Source: Lehigh County Layer 6

### York County
6. **York** (FIPS: 4287048)
   - 11 wards
   - Filter: `MUNI_NAME='YORK CITY'`
   - Source: York County Layer 26

7. **Dallastown** (FIPS: 4218072)
   - 2 wards
   - Filter: `MUNI_NAME='DALLASTOWN BORO'`
   - Source: York County Layer 26

8. **Hanover** (FIPS: 4232448)
   - 5 wards
   - Filter: `MUNI_NAME='HANOVER BORO'`
   - Source: York County Layer 26

9. **Red Lion** (FIPS: 4263840)
   - 3 wards
   - Filter: `MUNI_NAME='RED LION BORO'`
   - Source: York County Layer 26

10. **West York** (FIPS: 4284288)
    - 2 wards
    - Filter: `MUNI_NAME='WEST YORK BORO'`
    - Source: York County Layer 26

11. **Wrightsville** (FIPS: 4286640)
    - 3 wards
    - Filter: `MUNI_NAME='WRIGHTSVILLE BORO'`
    - Source: York County Layer 26

---

## Existing Portals Verified (3)

| City | FIPS | Districts | Source |
|------|------|-----------|--------|
| Philadelphia | 4260000 | 10 council | Philadelphia Layer 29 |
| Pittsburgh | 4261000 | 9 council | Pittsburgh Layer 10 |
| Allentown | 4202000 | 19 wards | Lehigh County Layer 6 |

---

## Notable Findings

### Multi-Municipality Datasets
- **Berks County Layer 3** contains ward data for **73 municipalities**, but only Reading has a meaningful ward structure (19 wards). All other municipalities have ward_no=0.
- **Lehigh County Layer 6** uses a `MUNI_WARD` field with format `{muni_code}{ward_num}` to encode wards for 5 municipalities.
- **York County Layer 26** contains voting district data for **72 municipalities**, but only 6 boroughs plus York City have ward structures.

### Townships vs. Places
Two York County townships have ward structures but are **NOT** Census places:
- **Spring Garden Township**: 5 wards (no FIPS code available)
- **York Township**: 5 wards (no FIPS code available)

These are Minor Civil Divisions (MCDs) and were excluded from portal entries.

### Bethlehem City Complexity
Bethlehem spans **two counties** (Lehigh and Northampton). The Lehigh County layer contains only the **4 wards in Lehigh County**. Additional investigation needed to determine if Northampton County has ward data for the remaining Bethlehem wards.

---

## Download URL Format

All portal entries use this standardized format:
```
{base_url}/query?where={filter}&outFields=*&returnGeometry=true&f=geojson
```

### Example URLs

**Reading:**
```
https://mapservices.pasda.psu.edu/server/rest/services/pasda/BerksCounty/MapServer/3/query?where=MUNI_NAME%3D%27READING%27&outFields=*&returnGeometry=true&f=geojson
```

**York City:**
```
https://mapservices.pasda.psu.edu/server/rest/services/pasda/YorkCounty/MapServer/26/query?where=MUNI_NAME%3D%27YORK%20CITY%27&outFields=*&returnGeometry=true&f=geojson
```

**Bethlehem (Lehigh Co.):**
```
https://mapservices.pasda.psu.edu/server/rest/services/pasda/LehighCounty/MapServer/6/query?where=MUNI_WARD%20LIKE%20%2703%%27&outFields=*&returnGeometry=true&f=geojson
```

---

## Quality Verification

### Test Results
- ✅ **Reading URL Test:** Returns 44 features covering 19 distinct wards (multiple precincts per ward)
- ✅ **York City URL Test:** Returns 17 features covering 11 distinct wards
- ✅ **FIPS Verification:** All 11 city FIPS codes verified against Census 2020 Decennial PL data

### Data Quality Notes
- Berks County Layer 3 returns **multiple features per ward** (one per precinct)
- York County Layer 26 returns **multiple features per ward** (voting districts)
- Clients must aggregate by `WARD_NO` or `WARD` field to get ward boundaries

---

## Output Files

### 1. aggregator-pasda-pa-results.json
**Location:** `packages/shadow-atlas/.shadow-atlas/wave-discovery/`

Comprehensive JSON containing:
- Aggregator metadata
- Layer-by-layer breakdown
- Full portal list with all metadata
- Skip reasons for excluded portals

### 2. aggregator-pasda-pa-portals.ndjson
**Location:** `packages/shadow-atlas/.shadow-atlas/wave-discovery/`

NDJSON file with **11 portal entries** ready for integration into `known-portals.ndjson`.

Each entry includes:
- `_fips` and `cityFips`: Census place FIPS code
- `cityName`: Municipality name
- `state`: "PA"
- `portalType`: "regional-gis"
- `downloadUrl`: Full GeoJSON download URL with filters
- `featureCount`: Number of wards
- `lastVerified`: ISO 8601 timestamp
- `confidence`: 95
- `discoveredBy`: "wave-p-pasda-pa"
- `notes`: Extraction context
- `metadata`: Source layer, district type, filter clause

---

## Integration Recommendations

### Immediate Action
1. Append all 11 entries from `aggregator-pasda-pa-portals.ndjson` to `known-portals.ndjson`
2. Update `PRODUCTION_READINESS_PLAN.md` to reflect new Pennsylvania coverage

### Future Investigation
1. **Northampton County PASDA Layer**: Check if Northampton County has a similar ward layer that contains the remaining Bethlehem wards
2. **Borough Wards**: Many small Pennsylvania boroughs have ward structures. Consider systematic extraction from all 67 county PASDA services.
3. **Township MCDs**: Evaluate whether townships with ward structures should be included despite lack of Census place FIPS codes

### Data Validation
Before production integration:
1. Verify that ward boundaries from PASDA align with Census TIGER/Line wards
2. Test download URLs to ensure data freshness
3. Confirm that all ward geometries are valid and non-overlapping

---

## References

- **PASDA Homepage:** https://www.pasda.psu.edu/
- **Census 2020 Decennial PL API:** https://api.census.gov/data/2020/dec/pl
- **ArcGIS REST API Documentation:** https://developers.arcgis.com/rest/services-reference/

---

**Report Generated:** 2026-01-24  
**GIS Extraction Specialist:** Claude (Wave P: PASDA Pennsylvania)
