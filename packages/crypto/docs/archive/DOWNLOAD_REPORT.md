> **ARCHIVED [2026-02-20]:** Self-identified as historical. November 2025 attempt to download regional COG municipal boundaries. Shadow-atlas now uses Census TIGER/Line data exclusively for nationwide coverage. See the shadow-atlas data pipeline documentation for current information.

> [!NOTE]
> **HISTORICAL — November 2025 Download Attempt**
>
> This report documents an early data acquisition attempt (2025-11-15) for regional COG
> municipal boundaries. Shadow-atlas now uses Census TIGER/Line data exclusively for
> nationwide coverage. This report is retained for reference only.

---

# Regional COG Municipal Boundaries Download Report
**Date**: 2025-11-15
**Mission**: Download unified municipal boundary datasets from 5 regional COGs

## ✅ SUCCESSFUL DOWNLOADS (2/5)

### 1. ARC (Atlanta Regional Commission)
- **Status**: ✅ SUCCESS
- **File**: `arc.geojson`
- **Size**: 9.7 MB
- **Cities**: 76
- **Coverage**: Atlanta region (Georgia)
- **Source**: https://opendata.atlantaregional.com/
- **Download Method**: ArcGIS Hub API
- **URL**: `https://opendata.atlantaregional.com/api/download/v1/items/ce216973df894481b7f52a6994934783/geojson?layers=0`

### 2. MAPC (Metro Boston Planning Agency)
- **Status**: ✅ SUCCESS (Statewide dataset)
- **File**: `mapc.geojson`
- **Size**: 25 MB
- **Cities**: 351 (all Massachusetts municipalities)
- **Coverage**: Entire state of Massachusetts (includes MAPC's 101 municipalities)
- **Source**: MassGIS via ArcGIS Hub
- **Download Method**: OpenData.arcgis.com direct link
- **URL**: `https://opendata.arcgis.com/datasets/massgis::massachusetts-municipalities-feature-layer.geojson`
- **Note**: Downloaded statewide data instead of MAPC-only region (no MAPC-specific boundary file found)

## ❌ BLOCKED DOWNLOADS (3/5)

### 3. CMAP (Chicago Metropolitan Agency for Planning)
- **Status**: ❌ BLOCKED
- **Expected Cities**: 284
- **Expected Coverage**: 9M population
- **Blockers**:
  - ArcGIS REST API returns 400 Bad Request
  - Hub API returns 500 Server Error
  - Direct GeoJSON links return error responses
  - Portal: https://datahub.cmap.illinois.gov not accessible via automated download
- **Attempted URLs**:
  - `https://services.arcgis.com/rOo16HdIMeOBI4Mb/arcgis/rest/services/municipalities/FeatureServer/0/query`
  - `https://datahub-cmap-illinois.opendata.arcgis.com/datasets/cmap::municipalities.geojson`
  - `https://opendata.arcgis.com/datasets/CMAP::municipalities.geojson`
- **Alternative**: Requires manual download or Census TIGER/Line data processing

### 4. SEMCOG (Southeast Michigan Council of Governments)
- **Status**: ❌ BLOCKED
- **Expected Cities**: 147
- **Expected Coverage**: 5M population
- **Blockers**:
  - Portal URL (gisservices.semcog.org) returns DNS resolution failure
  - OpenData portal returns empty/error responses
  - No accessible GeoJSON export endpoints found
- **Attempted URLs**:
  - `https://gisservices.semcog.org/arcgis/rest/services/...` (DNS ENOTFOUND)
  - `https://gisdata-semcog.opendata.arcgis.com/datasets/semcog::community-boundaries.geojson`
  - `https://opendata.arcgis.com/datasets/semcog::community-boundaries.geojson`
- **Alternative**: Requires manual download or Census TIGER/Line data processing

### 5. NYMTC (New York Metropolitan Transportation Council)
- **Status**: ❌ BLOCKED  
- **Expected Cities**: 347
- **Expected Coverage**: 23M population (NY, NJ, CT tri-state)
- **Blockers**:
  - No public ArcGIS Hub or OpenData portal found
  - REST API endpoints return errors
  - NYMTC does not appear to publish unified municipal boundaries publicly
- **Attempted URLs**:
  - `https://services5.arcgis.com/UEUDVd1QVLH7YWJt/arcgis/rest/services/...`
  - `https://opendata.arcgis.com/datasets/nymtc::municipal-boundaries.geojson`
- **Alternative**: Would require downloading separate state datasets (NY, NJ, CT) and filtering by region

## 📊 SUMMARY

| COG | Status | Cities | File Size | Notes |
|-----|--------|--------|-----------|-------|
| ARC | ✅ | 76 | 9.7 MB | Region-specific |
| MAPC | ✅ | 351 | 25 MB | Statewide (MA) |
| CMAP | ❌ | 0 | - | Automated download blocked |
| SEMCOG | ❌ | 0 | - | DNS/portal issues |
| NYMTC | ❌ | 0 | - | No public export found |

**Total Downloaded**: 427 cities (76 ARC + 351 MA)
**Combined with Existing**: 2,378 cities total
- SCAG: 199 cities (Southern California)
- NCTCOG: 1,752 cities (North Central Texas)
- ARC: 76 cities (Atlanta)
- MAPC/MA: 351 cities (Massachusetts)

## 🔧 RECOMMENDED NEXT STEPS

### For CMAP (Chicago):
1. Manual download from https://datahub.cmap.illinois.gov
2. Search for "municipalities" dataset
3. Download as GeoJSON or Shapefile
4. Alternative: Use Census TIGER/Line data for Illinois places

### For SEMCOG (Southeast Michigan):
1. Contact SEMCOG directly for data access
2. Check if portal requires authentication
3. Alternative: Use Census TIGER/Line data for Michigan places

### For NYMTC (NY Metro):
1. Download separate state datasets:
   - New York: Use NYS GIS Clearinghouse
   - New Jersey: Use NJ Open Data
   - Connecticut: Use CT Open Data
2. Filter by NYMTC region counties
3. Merge into single dataset

### Alternative: Census TIGER/Line Data
For comprehensive coverage, consider using Census TIGER/Line shapefiles:
- **URL**: https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html
- **Format**: Shapefile (requires ogr2ogr conversion to GeoJSON)
- **Coverage**: All incorporated places nationwide
- **Advantage**: Consistent nationwide data
- **Disadvantage**: Requires shapefile processing

## 📝 TECHNICAL NOTES

**Successful Download Pattern (ARC)**:
```bash
curl -sL "https://opendata.atlantaregional.com/api/download/v1/items/{ITEM_ID}/geojson?layers=0"
```

**Failed Patterns**:
- ArcGIS REST API query endpoints (400 Bad Request)
- OpenData.arcgis.com namespace downloads (500 Server Error)
- Direct portal URLs without proper item IDs

**Key Learning**: ArcGIS Hub API download endpoints work best when you have the exact item ID from the portal's dataset page.
