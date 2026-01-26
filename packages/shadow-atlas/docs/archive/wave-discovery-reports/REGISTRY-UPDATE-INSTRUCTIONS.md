# Registry Update Instructions - Ohio Cities

**Date:** 2026-01-23
**Mission:** Wave P - Ohio Portal Verification
**File to Update:** `packages/shadow-atlas/src/core/registry/known-portals.generated.ts`

---

## Summary

Update three existing Ohio city entries with verified endpoints from `regional-aggregators.ts`.

**IMPORTANT:** These are updates to existing entries, NOT new additions.

---

## Updates Required

### 1. Columbus, OH (FIPS: 3918000)

**Location in file:** Line ~6185

**Current entry:**
```typescript
'3918000': {
    "cityFips": "3918000",
    "cityName": "Columbus",
    "state": "OH",
    "portalType": "municipal-gis",
    "downloadUrl": "https://gis.columbus.gov/arcgis/rest/services/Applications/CSIR_Public/MapServer/37/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 9,
    "lastVerified": "2024-11-15T09:00:00.000Z",
    "confidence": 90,
    "discoveredBy": "wave-d",
    "notes": "Columbus OH - 9 council districts. City GIS."
},
```

**Updated entry:**
```typescript
'3918000': {
    "cityFips": "3918000",
    "cityName": "Columbus",
    "state": "OH",
    "portalType": "municipal-gis",
    "downloadUrl": "https://services1.arcgis.com/vdNDkVykv9vEWFX4/arcgis/rest/services/Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 13,
    "lastVerified": "2026-01-23T00:00:00.000Z",
    "confidence": 95,
    "discoveredBy": "wave-d",
    "notes": "Columbus OH - 13 council districts. ArcGIS Online FeatureServer. Endpoint updated wave-p (2026-01-23) - previous endpoint only had 9/13 districts."
},
```

**Changes:**
- ✅ Updated `downloadUrl` (old endpoint incomplete)
- ✅ Updated `featureCount` (9 → 13)
- ✅ Updated `lastVerified` (2026-01-23)
- ✅ Updated `confidence` (90 → 95)
- ✅ Updated `notes` (explain endpoint change)

---

### 2. Cleveland, OH (FIPS: 3916000)

**Location in file:** Line ~6173

**Current entry:**
```typescript
'3916000': {
    "cityFips": "3916000",
    "cityName": "Cleveland",
    "state": "OH",
    "portalType": "municipal-gis",
    "downloadUrl": "https://gis.cleveland-oh.gov/arcgis/rest/services/PublicWorks/Wards/MapServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 17,
    "lastVerified": "2024-11-15T09:00:00.000Z",
    "confidence": 90,
    "discoveredBy": "wave-d",
    "notes": "Cleveland OH - 17 wards. City GIS with 2026 redistricting boundaries."
},
```

**Updated entry:**
```typescript
'3916000': {
    "cityFips": "3916000",
    "cityName": "Cleveland",
    "state": "OH",
    "portalType": "municipal-gis",
    "downloadUrl": "https://services3.arcgis.com/dty2kHktVXHrqO8i/arcgis/rest/services/Cleveland_Wards_1_2_25_Topocleaned_pop20/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 15,
    "lastVerified": "2026-01-23T00:00:00.000Z",
    "confidence": 95,
    "discoveredBy": "wave-d",
    "notes": "Cleveland OH - 15 wards (2026 redistricting). Reduced from 17 per Ordinance 1-2025, effective January 2026. ArcGIS Online FeatureServer with current boundaries."
},
```

**Changes:**
- ✅ Updated `downloadUrl` (2026 redistricting boundaries)
- ✅ Updated `featureCount` (17 → 15)
- ✅ Updated `lastVerified` (2026-01-23)
- ✅ Updated `confidence` (90 → 95)
- ✅ Updated `notes` (explain 2026 redistricting)

---

### 3. Toledo, OH (FIPS: 3977000)

**Location in file:** Line ~6341

**Current entry:**
```typescript
'3977000': {
    "cityFips": "3977000",
    "cityName": "Toledo",
    "state": "OH",
    "portalType": "municipal-gis",
    "downloadUrl": "https://gis.toledo.oh.gov/portal/sharing/rest/content/items/toledo-council-districts/data?f=geojson",
    "featureCount": 6,
    "lastVerified": "2024-11-15T09:00:00.000Z",
    "confidence": 85,
    "discoveredBy": "wave-d",
    "notes": "Toledo OH - 6 council districts. City GIS portal."
},
```

**Updated entry:**
```typescript
'3977000': {
    "cityFips": "3977000",
    "cityName": "Toledo",
    "state": "OH",
    "portalType": "municipal-gis",
    "downloadUrl": "https://gis.toledo.oh.gov/arcgis/rest/services/DistrictsZipsTEI_MapService/MapServer/1/query?where=1%3D1&outFields=*&f=geojson",
    "featureCount": 6,
    "lastVerified": "2026-01-23T00:00:00.000Z",
    "confidence": 90,
    "discoveredBy": "wave-d",
    "notes": "Toledo OH - 6 council districts. Official MapServer layer. Endpoint updated wave-p (2026-01-23) - MapServer more reliable than portal API."
},
```

**Changes:**
- ✅ Updated `downloadUrl` (more reliable MapServer)
- ⏸️ Same `featureCount` (6 unchanged)
- ✅ Updated `lastVerified` (2026-01-23)
- ✅ Updated `confidence` (85 → 90)
- ✅ Updated `notes` (explain endpoint change)

---

## Verification Commands

After making the updates, verify the endpoints are accessible:

```bash
# Columbus (should return 13)
curl -s "https://services1.arcgis.com/vdNDkVykv9vEWFX4/arcgis/rest/services/Council_Districts/FeatureServer/0/query?where=1%3D1&returnCountOnly=true&f=json"

# Cleveland (should return 15)
curl -s "https://services3.arcgis.com/dty2kHktVXHrqO8i/arcgis/rest/services/Cleveland_Wards_1_2_25_Topocleaned_pop20/FeatureServer/0/query?where=1%3D1&returnCountOnly=true&f=json"

# Toledo (should return 6)
curl -s "https://gis.toledo.oh.gov/arcgis/rest/services/DistrictsZipsTEI_MapService/MapServer/1/query?where=1%3D1&returnCountOnly=true&f=json"
```

---

## Rationale

### Why Update Existing Entries?

1. **Columbus:** Previous endpoint only provided 9 out of 13 districts (69% complete). New endpoint provides all 13 districts.

2. **Cleveland:** Previous endpoint had outdated boundaries (17 wards pre-2026). New endpoint has current 2026 redistricting with 15 wards per Ordinance 1-2025.

3. **Toledo:** Previous endpoint used portal sharing API which may not be stable. New endpoint uses official MapServer which is more reliable for programmatic access.

### Source of New Endpoints

All three endpoints are documented in `regional-aggregators.ts` and were verified during Wave P (Ohio portal verification mission, 2026-01-23).

---

## Checklist

- [ ] Update Columbus entry (line ~6185)
- [ ] Update Cleveland entry (line ~6173)
- [ ] Update Toledo entry (line ~6341)
- [ ] Run verification commands to confirm endpoints work
- [ ] Build/compile to ensure no TypeScript errors
- [ ] Consider running extraction test to verify geometry quality

---

## Notes

- All three cities already existed in the registry
- These are quality improvements, not new discoveries
- The `discoveredBy` field remains `"wave-d"` since that was the original discovery wave
- The notes field documents the endpoint update via wave-p

---

**End of Registry Update Instructions**
