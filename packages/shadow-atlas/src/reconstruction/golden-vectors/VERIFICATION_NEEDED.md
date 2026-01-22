# North Kansas City Golden Vector - Verification Needed

## Status: ⚠️ APPROXIMATE DATA - NOT PRODUCTION READY

The North Kansas City golden vector has been created as a **template** with approximate boundary data. This file documents what verification steps are needed to make it production-ready.

## What We Have

✅ **Structural template** - Valid GeoJSON format, all required fields
✅ **Verified metadata** - City name, FIPS code, ward count, redistricting date
✅ **Test suite** - Comprehensive validation tests (all passing)
✅ **Documentation** - Clear warnings about approximate nature
✅ **Contact information** - How to obtain official data

## What We Need

❌ **Official ward boundaries** - Actual coordinates from city records
❌ **Legal descriptions** - Street-by-street boundary descriptions from ordinance
❌ **GIS data** - Shapefiles or authoritative geospatial data
❌ **Human verification** - Visual confirmation against official maps

## Verified Facts (from research)

| Fact | Source | Verified |
|------|--------|----------|
| City FIPS: 2951932 | Census Bureau | ✅ |
| 4 wards | City website | ✅ |
| Redistricted: Nov 16, 2021 | Official redistricting page | ✅ |
| Population: ~4,500 | Census data | ✅ |
| Ideal district pop: 1,117 | Calculated (4500/4) | ✅ |
| City center: 39.1367°N, 94.5690°W | Geographic databases | ✅ |

## Approximate Data (needs verification)

| Item | Current Status | Confidence |
|------|----------------|------------|
| Ward 1 boundaries | Assumed NW quadrant | ⚠️ LOW |
| Ward 2 boundaries | Assumed NE quadrant | ⚠️ LOW |
| Ward 3 boundaries | Assumed SW quadrant | ⚠️ LOW |
| Ward 4 boundaries | Assumed SE quadrant | ⚠️ LOW |
| Legal descriptions | Placeholder text | ⚠️ NONE |

## How to Obtain Accurate Data

### Option 1: Direct Contact (Recommended)

**North Kansas City City Hall**
- Address: 2010 Howell St, North Kansas City, MO 64116
- Phone: (816) 274-6000
- Website: https://www.nkc.org

**Request**:
1. 2021 Ward Map (PDF, high resolution)
2. GIS shapefiles for ward boundaries (if available)
3. Ordinance or resolution text adopting 2021 ward boundaries
4. Any legal descriptions (metes and bounds)

**Contact Department**: City Clerk or Planning Department

### Option 2: Online Resources

Check these city web pages:
- [2021 Redistricting](https://www.nkc.org/government/elected-officials/2021-redistricting)
- [Wards and Zoning Maps](https://www.nkc.org/government/government-resources/wards-and-zoning-maps)

**Note**: Direct download links were blocked during research (403 errors). May require:
- In-person visit to city hall
- Formal public records request
- Phone call to obtain download links

### Option 3: Regional GIS Data

**Mid-America Regional Council (MARC)**
- Website: https://www.marc.org/data-and-maps
- Coverage: Kansas City metropolitan area
- May have regional GIS datasets

### Option 4: OpenStreetMap

Search for North Kansas City ward boundaries:
- OSM Overpass API queries
- Check for administrative boundary relations
- Community-contributed ward data (verify accuracy)

## Verification Workflow

Once official data is obtained:

### 1. Extract Coordinates

**If PDF map**:
```bash
# Open in QGIS
# Georeference using known landmarks
# Manually trace ward boundaries
# Export as GeoJSON
```

**If GIS shapefile**:
```bash
ogr2ogr -f GeoJSON \
  north-kansas-city-wards.json \
  wards.shp \
  -t_srs EPSG:4326
```

### 2. Update Golden Vector

Replace approximate polygons with actual coordinates:
```json
{
  "type": "Feature",
  "properties": {
    "wardId": "1",
    "wardName": "Ward 1",
    "cityFips": "2951932"
    // Remove approximateData flag
  },
  "geometry": {
    "type": "Polygon",
    "coordinates": [
      // Insert actual coordinates from official source
    ]
  }
}
```

### 3. Add Legal Descriptions

Parse ordinance text or resolution:
```json
{
  "segments": [
    {
      "index": 0,
      "referenceType": "street_centerline",
      "featureName": "Armour Road",
      "direction": "east",
      "from": "intersection with Swift Avenue",
      "to": "intersection with Howell Street",
      "rawText": "beginning at the intersection of Armour Road and Swift Avenue, thence easterly along Armour Road to Howell Street",
      "parseConfidence": "high"
    }
  ]
}
```

### 4. Update Metadata

```json
{
  "metadata": {
    "precisionLevel": "verified",  // Change from "approximate"
    "verificationStatus": "human_verified",  // Change from "pending"
    "verificationMethodology": "Obtained official ward map PDF from North Kansas City City Clerk on YYYY-MM-DD. Georeferenced in QGIS using city boundary and major street intersections. Digitized ward boundaries manually. Verified against ordinance text.",
    "verificationDate": "YYYY-MM-DD",
    "verifiedBy": "Your Name/Organization",
    // Remove dataQualityWarning
  }
}
```

### 5. Update Tests

Remove approximate data checks:
```typescript
test('is verified and ready for production', () => {
  expect(parsed.metadata.verificationStatus).toBe('human_verified');
  expect(parsed.metadata.precisionLevel).toBe('verified');

  // Ensure no approximate data flags
  for (const polygon of goldenVector.expectedPolygons) {
    expect(polygon.properties?.approximateData).toBeUndefined();
  }
});
```

### 6. Run Validation

```bash
npm test -- north-kansas-city-mo.test.ts
```

All tests should pass with actual data.

## Production Readiness Checklist

Before using this golden vector for production validation:

- [ ] Obtained official ward map or GIS data
- [ ] Verified source is authoritative (city hall, not third-party)
- [ ] Extracted/digitized actual coordinates
- [ ] Updated all 4 ward polygons with accurate boundaries
- [ ] Added legal descriptions from ordinance text
- [ ] Removed `approximateData` flags from polygon properties
- [ ] Updated `metadata.precisionLevel` to "verified" or "ground_truth"
- [ ] Updated `metadata.verificationStatus` to "human_verified"
- [ ] Documented verification methodology in detail
- [ ] Added SHA-256 hash of source documents
- [ ] Verified all polygons form closed rings
- [ ] Verified wards tessellate (no gaps/overlaps)
- [ ] Confirmed populations roughly equal (~1,117 per ward)
- [ ] All tests pass
- [ ] Peer review completed
- [ ] Source documents archived

## Current Use Cases

**✅ Safe to use for**:
- Understanding golden vector structure
- Testing JSON parsing and validation logic
- Demonstrating verification workflow
- Template for creating other golden vectors

**❌ NOT safe to use for**:
- Production boundary validation
- Regression testing of reconstruction algorithms
- Comparing reconstruction accuracy
- Any civic or electoral purposes

## Timeline

**Estimated time to complete verification**: 2-4 hours
- 30 min: Contact city hall, request documents
- 1-2 hours: Wait for response / obtain documents
- 1-2 hours: Extract coordinates and update golden vector
- 30 min: Verification and testing

**Priority**: Medium
- Not blocking development (approximate data clearly marked)
- Needed before production deployment
- Useful for validating reconstruction pipeline

## Questions?

Contact the Shadow Atlas team or file an issue with questions about the verification process.

---

**Remember**: Golden vectors are the foundation of quality assurance. Approximate data is fine for development, but production requires human-verified boundaries from authoritative sources.
