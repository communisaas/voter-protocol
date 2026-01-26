# Oregon Endpoint Curl Verification Commands

**Date:** 2026-01-23
**Operator:** GIS Extraction Specialist

This document contains the exact curl commands used to verify each Oregon endpoint and their results.

---

## 1. Portland City Council Districts

### Get Metadata
```bash
curl -s "https://www.portlandmaps.com/arcgis/rest/services/Public/Auditor_ElectionsMap/MapServer/12?f=json" | head -100
```

**Result:**
- Layer Name: "Portland City Council Districts Boundaries"
- Geometry Type: "esriGeometryPolygon"
- Display Field: "DISTRICT"
- Max Record Count: 2000

### Get Feature Count
```bash
curl -s "https://www.portlandmaps.com/arcgis/rest/services/Public/Auditor_ElectionsMap/MapServer/12/query?where=1%3D1&returnCountOnly=true&f=json"
```

**Result:**
```json
{"count":4}
```

### Get District Values
```bash
curl -s "https://www.portlandmaps.com/arcgis/rest/services/Public/Auditor_ElectionsMap/MapServer/12/query?where=1%3D1&outFields=DISTRICT&returnGeometry=false&f=json"
```

**Result:**
```json
{
  "features": [
    {"attributes": {"DISTRICT": "1"}},
    {"attributes": {"DISTRICT": "2"}},
    {"attributes": {"DISTRICT": "3"}},
    {"attributes": {"DISTRICT": "4"}}
  ]
}
```

### Download URL (GeoJSON)
```bash
https://www.portlandmaps.com/arcgis/rest/services/Public/Auditor_ElectionsMap/MapServer/12/query?where=1%3D1&outFields=*&f=geojson
```

**Fields Available:**
- DISTRICT (string)
- pop_total (integer)
- Ideal_pop (double)
- Diff_Ideal (integer)
- DDeviation (double)
- ODeviation (double)

---

## 2. Eugene City Council Wards

### Get Metadata
```bash
curl -s "https://gis.eugene-or.gov/arcgis/rest/services/PWE/Boundaries/MapServer/1?f=json" | head -100
```

**Result:**
- Layer Name: "Wards"
- Geometry Type: "esriGeometryPolygon"
- Display Field: "ward"
- Max Record Count: 1000
- Spatial Reference: WKID 2914 (NAD 1983 HARN StatePlane Oregon North)

### Get Feature Count
```bash
curl -s "https://gis.eugene-or.gov/arcgis/rest/services/PWE/Boundaries/MapServer/1/query?where=1%3D1&returnCountOnly=true&f=json"
```

**Result:**
```json
{"count":8}
```

### Get Ward Values
```bash
curl -s "https://gis.eugene-or.gov/arcgis/rest/services/PWE/Boundaries/MapServer/1/query?where=1%3D1&outFields=ward,ward_number,wardcity&returnGeometry=false&f=json"
```

**Result:**
```json
{
  "features": [
    {"attributes": {"ward": "E1", "ward_number": 1, "wardcity": "EUG"}},
    {"attributes": {"ward": "E2", "ward_number": 2, "wardcity": "EUG"}},
    {"attributes": {"ward": "E3", "ward_number": 3, "wardcity": "EUG"}},
    {"attributes": {"ward": "E4", "ward_number": 4, "wardcity": "EUG"}},
    {"attributes": {"ward": "E5", "ward_number": 5, "wardcity": "EUG"}},
    {"attributes": {"ward": "E6", "ward_number": 6, "wardcity": "EUG"}},
    {"attributes": {"ward": "E7", "ward_number": 7, "wardcity": "EUG"}},
    {"attributes": {"ward": "E8", "ward_number": 8, "wardcity": "EUG"}}
  ]
}
```

### Download URL (GeoJSON)
```bash
https://gis.eugene-or.gov/arcgis/rest/services/PWE/Boundaries/MapServer/1/query?where=1%3D1&outFields=*&f=geojson
```

**Fields Available:**
- ward (string: "E1"-"E8")
- ward_number (smallint: 1-8)
- wardcity (string: "EUG")
- councilor (string)

---

## 3. Hillsboro City Council Wards

### Get Metadata
```bash
curl -s "https://gis.hillsboro-oregon.gov/public/rest/services/public/Council_Wards/MapServer/0?f=json" | head -100
```

**Result:**
- Layer Name: "Council_Wards"
- Geometry Type: "esriGeometryPolygon"
- Display Field: "NAME_1"
- Max Record Count: 1000
- Spatial Reference: WKID 4326 (WGS 1984)
- Description: "City of Hillsboro Council Wards. Contains ward boundaries and council members."

### Get Feature Count
```bash
curl -s "https://gis.hillsboro-oregon.gov/public/rest/services/public/Council_Wards/MapServer/0/query?where=1%3D1&returnCountOnly=true&f=json"
```

**Result:**
```json
{"count":3}
```

### Get Ward Values
```bash
curl -s "https://gis.hillsboro-oregon.gov/public/rest/services/public/Council_Wards/MapServer/0/query?where=1%3D1&outFields=WARD,NAME_1,NAME_2&returnGeometry=false&f=json"
```

**Result:**
```json
{
  "features": [
    {"attributes": {"WARD": "2", "NAME_1": "KIPPERLYN SINCLAIR", "NAME_2": "ELIZABETH CASE"}},
    {"attributes": {"WARD": "1", "NAME_1": "CRISTIAN SALGADO", "NAME_2": "SABA ANVERY"}},
    {"attributes": {"WARD": "3", "NAME_1": "OLIVIA ALCAIRE", "NAME_2": "ROB HARRIS"}}
  ]
}
```

### Download URL (GeoJSON)
```bash
https://gis.hillsboro-oregon.gov/public/rest/services/public/Council_Wards/MapServer/0/query?where=1%3D1&outFields=*&f=geojson
```

**Fields Available:**
- WARD (string: "1", "2", "3")
- NAME_1 (string: first council member)
- NAME_2 (string: second council member)
- IN_OUT (string)

**Domain Info:**
- WARD uses coded value domain "D_LU_CouncilWard"
- Allowed values: "1", "2", "3"

---

## 4. Oregon Metro Council Districts

### Get Metadata
```bash
curl -s "https://gis.oregonmetro.gov/arcgis/rest/services/OpenData/BoundaryDataWebMerc/MapServer/2?f=json" | head -100
```

**Result:**
- Layer Name: "Metro Council District Boundaries"
- Geometry Type: "esriGeometryPolygon"
- Display Field: "NAME"
- Max Record Count: 1000
- Spatial Reference: WKID 102100 (Web Mercator)
- Description: "Six districts representing individual Metro council districts and constituency areas. Metro councilors are elected by their respective district every four years in nonpartisan races."

### Get Feature Count
```bash
curl -s "https://gis.oregonmetro.gov/arcgis/rest/services/OpenData/BoundaryDataWebMerc/MapServer/2/query?where=1%3D1&returnCountOnly=true&f=json"
```

**Result:**
```json
{"count":6}
```

### Get District Values
```bash
curl -s "https://gis.oregonmetro.gov/arcgis/rest/services/OpenData/BoundaryDataWebMerc/MapServer/2/query?where=1%3D1&outFields=DISTRICT,NAME,EMAIL&returnGeometry=false&f=json"
```

**Result:**
```json
{
  "features": [
    {"attributes": {"DISTRICT": 3, "NAME": "Gerritt Rosenthal", "EMAIL": "gerritt.rosenthal@oregonmetro.gov"}},
    {"attributes": {"DISTRICT": 4, "NAME": "Juan Carlos Gonzalez", "EMAIL": "juancarlos.gonzalez@oregonmetro.gov"}},
    {"attributes": {"DISTRICT": 1, "NAME": "Ashton Simpson", "EMAIL": "ashton.simpson@oregonmetro.gov"}},
    {"attributes": {"DISTRICT": 2, "NAME": "Christine Lewis", "EMAIL": "christine.lewis@oregonmetro.gov"}},
    {"attributes": {"DISTRICT": 5, "NAME": "Mary Nolan", "EMAIL": "mary.nolan@oregonmetro.gov"}},
    {"attributes": {"DISTRICT": 6, "NAME": "Duncan Hwang", "EMAIL": "duncan.hwang@oregonmetro.gov"}}
  ]
}
```

### Download URL (GeoJSON)
```bash
https://gis.oregonmetro.gov/arcgis/rest/services/OpenData/BoundaryDataWebMerc/MapServer/2/query?where=1%3D1&outFields=*&f=geojson
```

**Fields Available:**
- DISTRICT (smallint: 1-6)
- NAME (string: councilor name)
- EMAIL (string: councilor email)

**Important Note:**
⚠️ This is a REGIONAL GOVERNMENT entity, NOT city council districts. Should NOT be added to city portal registry.

---

## Cross-Reference with Known Portals Registry

### Check Existing Oregon Cities
```bash
grep '"state":"OR"' /Users/noot/Documents/voter-protocol/packages/shadow-atlas/data/registries/known-portals.ndjson
```

**Result:** 8 Oregon cities already in registry
1. Albany (4101000) - 3 districts
2. Corvallis (4115800) - 9 districts
3. Eugene (4123850) - 8 districts
4. Grants Pass (4130550) - 4 districts
5. Hillsboro (4134100) - 3 districts
6. Lebanon (4141650) - 3 districts
7. Newberg (4152100) - 6 districts
8. Portland (4159000) - 4 districts

---

## Verification Summary

| Endpoint | Feature Count | District Field | Values | Registry Status |
|----------|---------------|----------------|--------|-----------------|
| Portland | 4 | DISTRICT | "1"-"4" | ✅ EXISTS (update endpoint) |
| Eugene | 8 | ward_number | 1-8 | ✅ EXISTS (update endpoint) |
| Hillsboro | 3 | WARD | "1"-"3" | ✅ EXISTS (same endpoint) |
| Oregon Metro | 6 | DISTRICT | 1-6 | ⚠️ REGIONAL (not city) |

**Conclusion:** All 4 endpoints verified successfully. No new cities to add.

---

## Field Name Analysis

### Portland
- **Primary:** `DISTRICT` (string)
- **Type:** esriFieldTypeString
- **Format:** Simple numeric strings ("1", "2", "3", "4")
- **Quality:** ✅ Clean, consistent

### Eugene
- **Primary:** `ward_number` (smallint)
- **Alternate:** `ward` (string with "E" prefix)
- **Type:** esriFieldTypeSmallInteger / esriFieldTypeString
- **Format:** Numeric (1-8) or labeled ("E1"-"E8")
- **Quality:** ✅ Dual format available, very flexible

### Hillsboro
- **Primary:** `WARD` (string)
- **Type:** esriFieldTypeString
- **Format:** Simple numeric strings ("1", "2", "3")
- **Domain:** Coded value domain enforces valid values
- **Quality:** ✅ Domain-enforced, clean

### Oregon Metro
- **Primary:** `DISTRICT` (smallint)
- **Type:** esriFieldTypeSmallInteger
- **Format:** Numeric (1-6)
- **Quality:** ✅ Clean, includes contact info

---

## Download URL Format

All endpoints support standard ArcGIS REST API query format:

```
{baseUrl}/query?where=1%3D1&outFields=*&f=geojson
```

Parameters:
- `where=1%3D1` - Select all features (URL-encoded "1=1")
- `outFields=*` - Return all fields
- `f=geojson` - Return as GeoJSON format

All endpoints tested and confirmed working on 2026-01-23.
