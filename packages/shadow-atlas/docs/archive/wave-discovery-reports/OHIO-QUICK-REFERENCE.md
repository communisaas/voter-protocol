# Ohio City Portals - Quick Reference Card

**Last Verified:** 2026-01-23
**Source:** Wave P verification mission
**Status:** All endpoints verified and working

---

## Columbus, OH

**FIPS:** `3918000`
**Districts:** 13 council districts
**Confidence:** 95%

### GeoJSON Download
```
https://services1.arcgis.com/vdNDkVykv9vEWFX4/arcgis/rest/services/Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson
```

### Metadata
```
https://services1.arcgis.com/vdNDkVykv9vEWFX4/arcgis/rest/services/Council_Districts/FeatureServer/0?f=json
```

### Feature Count
```bash
curl "https://services1.arcgis.com/vdNDkVykv9vEWFX4/arcgis/rest/services/Council_Districts/FeatureServer/0/query?where=1%3D1&returnCountOnly=true&f=json"
# Returns: {"count":13}
```

### Key Fields
- `District` - District number (1-13)
- `LABEL` - Display label ("District 1", "District 2", etc.)
- `CouncilRepFirst` - Representative first name
- `CouncilRepLast` - Representative last name

---

## Cleveland, OH

**FIPS:** `3916000`
**Wards:** 15 wards (2026 redistricting)
**Confidence:** 95%

### GeoJSON Download
```
https://services3.arcgis.com/dty2kHktVXHrqO8i/arcgis/rest/services/Cleveland_Wards_1_2_25_Topocleaned_pop20/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson
```

### Metadata
```
https://services3.arcgis.com/dty2kHktVXHrqO8i/arcgis/rest/services/Cleveland_Wards_1_2_25_Topocleaned_pop20/FeatureServer/0?f=json
```

### Feature Count
```bash
curl "https://services3.arcgis.com/dty2kHktVXHrqO8i/arcgis/rest/services/Cleveland_Wards_1_2_25_Topocleaned_pop20/FeatureServer/0/query?where=1%3D1&returnCountOnly=true&f=json"
# Returns: {"count":15}
```

### Key Fields
- `Ward` - Ward number (1-15)
- `Ward_txt` - Ward number as text
- `NAME` - Ward name ("Ward 1", "Ward 2", etc.)
- `CouncilMember` - Council member name
- `Email` - Contact email
- `Phone` - Contact phone

### Redistricting Note
Reduced from 17 to 15 wards per Ordinance 1-2025, effective January 2026

---

## Toledo, OH

**FIPS:** `3977000`
**Districts:** 6 council districts
**Confidence:** 90%

### GeoJSON Download
```
https://gis.toledo.oh.gov/arcgis/rest/services/DistrictsZipsTEI_MapService/MapServer/1/query?where=1%3D1&outFields=*&f=geojson
```

### Metadata
```
https://gis.toledo.oh.gov/arcgis/rest/services/DistrictsZipsTEI_MapService/MapServer/1?f=json
```

### Feature Count
```bash
curl "https://gis.toledo.oh.gov/arcgis/rest/services/DistrictsZipsTEI_MapService/MapServer/1/query?where=1%3D1&returnCountOnly=true&f=json"
# Returns: {"count":6}
```

### Key Fields
- `District` - District number as string ("1"-"6")
- `Name` - Council member name
- `Email` - Contact email (HTML formatted)

### Note
MapServer layer (not FeatureServer) but query operations work correctly

---

## Bulk Verification

```bash
# Verify all three at once
echo "Columbus:" && curl -s "https://services1.arcgis.com/vdNDkVykv9vEWFX4/arcgis/rest/services/Council_Districts/FeatureServer/0/query?where=1%3D1&returnCountOnly=true&f=json" | jq .count
echo "Cleveland:" && curl -s "https://services3.arcgis.com/dty2kHktVXHrqO8i/arcgis/rest/services/Cleveland_Wards_1_2_25_Topocleaned_pop20/FeatureServer/0/query?where=1%3D1&returnCountOnly=true&f=json" | jq .count
echo "Toledo:" && curl -s "https://gis.toledo.oh.gov/arcgis/rest/services/DistrictsZipsTEI_MapService/MapServer/1/query?where=1%3D1&returnCountOnly=true&f=json" | jq .count

# Expected output:
# Columbus: 13
# Cleveland: 15
# Toledo: 6
```

---

## Download All GeoJSON

```bash
# Columbus
curl "https://services1.arcgis.com/vdNDkVykv9vEWFX4/arcgis/rest/services/Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson" > columbus-oh-districts.geojson

# Cleveland
curl "https://services3.arcgis.com/dty2kHktVXHrqO8i/arcgis/rest/services/Cleveland_Wards_1_2_25_Topocleaned_pop20/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson" > cleveland-oh-wards.geojson

# Toledo
curl "https://gis.toledo.oh.gov/arcgis/rest/services/DistrictsZipsTEI_MapService/MapServer/1/query?where=1%3D1&outFields=*&f=geojson" > toledo-oh-districts.geojson
```

---

## Coordinate Systems

| City | WKID | System | Units |
|------|------|--------|-------|
| Columbus | 102729 | NAD83 Ohio State Plane South | US Feet |
| Cleveland | 102100 | Web Mercator | Meters |
| Toledo | 102722 | NAD83 Ohio State Plane North | US Feet |

---

## Total Coverage

- **3 cities**
- **34 total districts/wards** (13 + 15 + 6)
- **100% success rate**
- **All endpoints verified 2026-01-23**
