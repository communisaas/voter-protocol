# Census TIGER/Line County Boundaries

**Dataset**: Census TIGER/Line 2023 County Boundaries
**Source**: U.S. Census Bureau
**Last Updated**: 2023-11-11 (Census release date)
**Integration Date**: 2025-11-18

## File Information

- **Filename**: `census-tiger-2023-counties.geojson`
- **Size**: 213 MB (224 MB on disk)
- **Format**: GeoJSON (converted from Shapefile)
- **Features**: 3,235 US counties + county equivalents
- **Coverage**: All 50 states + DC + US territories

## Data Source

**Original Shapefile**:
- URL: https://www2.census.gov/geo/tiger/TIGER2023/COUNTY/tl_2023_us_county.zip
- Format: ESRI Shapefile (SHP, SHX, DBF, PRJ)
- Size: 80 MB (zipped), 125 MB (shapefile)

**Conversion**:
```bash
# Download Census data
curl -O https://www2.census.gov/geo/tiger/TIGER2023/COUNTY/tl_2023_us_county.zip
unzip tl_2023_us_county.zip

# Convert to GeoJSON using GDAL
ogr2ogr -f GeoJSON census-tiger-2023-counties.geojson tl_2023_us_county.shp

# Verify
jq '.features | length' census-tiger-2023-counties.geojson  # Should be 3,235
```

## Feature Properties

Each county feature includes:

- `GEOID`: 5-digit FIPS code (e.g., "29095" for Jackson County, MO)
- `NAME`: County name (e.g., "Jackson")
- `NAMELSAD`: Full name with legal/statistical area description (e.g., "Jackson County")
- `STATEFP`: 2-digit state FIPS code (e.g., "29" for Missouri)
- `COUNTYFP`: 3-digit county FIPS code (e.g., "095")
- `ALAND`: Land area in square meters
- `AWATER`: Water area in square meters
- `INTPTLAT`: Internal point latitude (geographic center)
- `INTPTLON`: Internal point longitude (geographic center)

## Geometry Types

- **Polygon**: Most counties (contiguous land area)
- **MultiPolygon**: Counties with islands or non-contiguous areas (e.g., Boulder County, CO)

## Usage

This file is loaded by `CountyGeometryService` to provide authoritative county boundaries for multi-county city validation in the Shadow Atlas system.

```typescript
// Example usage
const service = new CountyGeometryService();
const union = await service.getCountyUnion('2938000'); // Kansas City, MO

// Returns union of 4 counties: Jackson, Clay, Platte, Cass
// Uses real Census geometries from this file
```

## Update Frequency

Census releases new TIGER/Line county boundaries annually (typically April/May). County boundaries change rarely (1-2 counties per year nationwide).

**Update Process**:
1. Download new TIGER/Line shapefile from Census
2. Convert to GeoJSON using `ogr2ogr`
3. Replace this file
4. Run tests: `npm test services/shadow-atlas/services/county-geometry.test.ts`
5. Commit updated file

## Verification

**Feature Count**:
```bash
jq '.features | length' census-tiger-2023-counties.geojson
# Expected: 3,235
```

**Sample County Lookup**:
```bash
jq '.features[] | select(.properties.GEOID == "29095") | .properties.NAME' census-tiger-2023-counties.geojson
# Expected: "Jackson"
```

**File Integrity**:
```bash
# Check file size
du -h census-tiger-2023-counties.geojson
# Expected: ~213-225 MB

# Validate JSON
jq empty census-tiger-2023-counties.geojson && echo "Valid JSON"
```

## References

- **Census TIGER/Line Home**: https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html
- **TIGER/Line 2023 County Files**: https://www2.census.gov/geo/tiger/TIGER2023/COUNTY/
- **FIPS Codes**: https://www.census.gov/library/reference/code-lists/ansi.html
- **GeoJSON Specification**: https://tools.ietf.org/html/rfc7946

## Integration Details

See parent directory documentation:
- `../TIGER-LINE-INTEGRATION.md`: Complete integration details
- `../REAL-VS-MOCK-COMPARISON.md`: Before/after analysis
- `/CENSUS-TIGER-INTEGRATION-SUMMARY.md`: Executive summary
