# Webmap Extractor: Quick Start Guide

**For**: Engineers implementing the webmap feature extractor
**Time to implement**: 4-6 hours (including tests)
**Unblocks**: Claremont CA (5 districts) + Martinez CA (4 districts)

---

## TL;DR

```typescript
// 1. Fetch webmap JSON
const webmap = await fetch(
  'https://www.arcgis.com/sharing/rest/content/items/{webmapId}/data?f=json'
).then(r => r.json());

// 2. Extract embedded features
const features = webmap.operationalLayers
  .find(layer => layer.title === targetLayerTitle)
  .featureCollection.layers[0].featureSet.features;

// 3. Convert Web Mercator → WGS84
import proj4 from 'proj4';
const geoJson = features.map(f => ({
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: f.geometry.rings.map(ring =>
      ring.map(coord => proj4('EPSG:3857', 'EPSG:4326', coord))
    )
  },
  properties: f.attributes
}));

// 4. Validate and return
return { type: 'FeatureCollection', features: geoJson };
```

---

## The Two Cities You're Unblocking

### Claremont, CA
```typescript
{
  webmapId: 'f9f59d55e7e2433b8d9a1af9f079ec82',
  targetLayerTitle: 'Adopted 2022-2030 Council Districts',
  expectedDistrictCount: 5
}
```

### Martinez, CA
```typescript
{
  webmapId: '5eb9a43de95845d48c8d56773d023609',
  targetLayerTitle: 'Adopted Districts',
  expectedDistrictCount: 4
}
```

---

## Step-by-Step Implementation

### 1. Install Dependencies
```bash
npm install proj4
npm install --save-dev @types/proj4
```

### 2. Copy Code Examples
File: `/packages/shadow-atlas/WEBMAP-EXTRACTOR-CODE-EXAMPLES.ts`

Functions you need:
- `fetchWebmap(webmapId: string)`
- `extractFeaturesFromWebmap(webmap, options)`
- `esriToGeoJSON(esriFeature, spatialRef)`
- `validateGeoJSONFeatures(features, options)`
- `extractCouncilDistrictsFromWebmap(config)` ← Main entry point

### 3. Add to Portal Registry
File: `/packages/shadow-atlas/src/core/registry/known-portals.ts`

```typescript
// Add these entries
{
  placeId: '0613756',
  placeName: 'Claremont, CA',
  stateAbbr: 'CA',
  sourceType: 'webmap',  // NEW TYPE
  webmapId: 'f9f59d55e7e2433b8d9a1af9f079ec82',
  targetLayerTitle: 'Adopted 2022-2030 Council Districts',
  expectedDistrictCount: 5,
  districtFieldName: 'DISTRICT',
  dataQuality: 'verified',
  lastVerified: '2026-01-17'
},
{
  placeId: '0646114',
  placeName: 'Martinez, CA',
  stateAbbr: 'CA',
  sourceType: 'webmap',
  webmapId: '5eb9a43de95845d48c8d56773d023609',
  targetLayerTitle: 'Adopted Districts',
  expectedDistrictCount: 4,
  districtFieldName: 'DISTRICT',
  dataQuality: 'verified',
  lastVerified: '2026-01-17'
}
```

### 4. Update Portal Processing Logic
```typescript
async function processPortalEntry(entry: PortalEntry) {
  switch (entry.sourceType) {
    case 'featureServer':
    case 'mapServer':
      return await extractFromArcGISService(entry);

    case 'webmap':  // NEW CASE
      return await extractCouncilDistrictsFromWebmap({
        placeId: entry.placeId,
        placeName: entry.placeName,
        webmapId: entry.webmapId!,
        targetLayerTitle: entry.targetLayerTitle!,
        expectedDistrictCount: entry.expectedDistrictCount,
        districtFieldName: entry.districtFieldName
      });

    case 'manual':
      throw new Error(`Manual data request required: ${entry.notes}`);
  }
}
```

### 5. Write Tests
```typescript
describe('Webmap Extraction', () => {
  it('should extract Claremont districts', async () => {
    const result = await extractCouncilDistrictsFromWebmap({
      placeId: '0613756',
      placeName: 'Claremont, CA',
      webmapId: 'f9f59d55e7e2433b8d9a1af9f079ec82',
      targetLayerTitle: 'Adopted 2022-2030 Council Districts',
      expectedDistrictCount: 5,
      districtFieldName: 'DISTRICT'
    });

    expect(result.features).toHaveLength(5);

    // Check WGS84 coordinates
    const coords = result.features[0].geometry.coordinates[0][0];
    expect(coords[0]).toBeGreaterThan(-180);
    expect(coords[0]).toBeLessThan(180);
  });
});
```

### 6. Run and Validate
```bash
npm run typecheck
npm run test
npm run extract -- --city claremont
npm run extract -- --city martinez
```

---

## Common Pitfalls

### ❌ DON'T: Use Math for Coordinate Conversion
```typescript
// WRONG - corrupts geometry
const lat = (y / 20037508.34) * 180;
const lng = (x / 20037508.34) * 180;
```

### ✅ DO: Use proj4
```typescript
// CORRECT - accurate projection
import proj4 from 'proj4';
const [lng, lat] = proj4('EPSG:3857', 'EPSG:4326', [x, y]);
```

### ❌ DON'T: Skip Validation
```typescript
// WRONG - silently accepts corrupted data
return { type: 'FeatureCollection', features };
```

### ✅ DO: Validate Before Returning
```typescript
// CORRECT - catches errors early
validateGeoJSONFeatures(features, {
  expectedCount: 5,
  requireDistrictField: 'DISTRICT'
});
return { type: 'FeatureCollection', features };
```

---

## Expected Output

### Claremont Example
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [-117.7234, 34.1023],
            [-117.7156, 34.1045],
            // ... more coordinates
            [-117.7234, 34.1023]
          ]
        ]
      },
      "properties": {
        "DISTRICT": 1,
        "CVAP_TOTAL": 5234,
        "IVBM_TTL": 3567,
        // ... 150+ fields
      }
    }
    // ... 4 more districts
  ]
}
```

---

## Testing Checklist

- [ ] Webmap fetch succeeds for Claremont
- [ ] Webmap fetch succeeds for Martinez
- [ ] Layer extraction finds correct layer by title
- [ ] Features array has expected count (5 for Claremont, 4 for Martinez)
- [ ] Coordinates are in WGS84 range (-180 to 180, -90 to 90)
- [ ] Polygons are closed (first point === last point)
- [ ] District field exists in properties
- [ ] District numbers are sequential (1-5 for Claremont, 1-4 for Martinez)
- [ ] GeoJSON validates against spec
- [ ] No TypeScript errors
- [ ] Unit tests pass
- [ ] Integration tests pass

---

## Performance Notes

**Webmap Size**:
- Claremont: ~1.2 MB
- Martinez: ~800 KB

**Expected Latency**:
- Fetch: 500-1000ms (network)
- Parse: <50ms
- Convert: <100ms
- Validate: <50ms
- **Total**: ~1-2 seconds per city

**Optimization**: Add caching (webmaps rarely change)
```typescript
const cache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
```

---

## Debugging Tips

### Issue: "Layer not found"
**Check**: Layer title exact match (case-sensitive)
```typescript
// Debug available layers
console.log(webmap.operationalLayers.map(l => l.title));
```

### Issue: "Invalid WGS84 coordinates"
**Check**: Spatial reference conversion
```typescript
// Debug source projection
console.log(spatialRef.wkid); // Should be 102100 or 3857
```

### Issue: "Polygon not closed"
**Check**: Last coordinate === first coordinate
```typescript
const ring = polygon.coordinates[0];
console.log('First:', ring[0]);
console.log('Last:', ring[ring.length - 1]);
```

---

## Success Criteria

- ✅ Claremont extracts 5 valid districts
- ✅ Martinez extracts 4 valid districts
- ✅ All geometries in WGS84 (EPSG:4326)
- ✅ All polygons closed
- ✅ All district fields present
- ✅ Tests pass
- ✅ TypeScript compiles
- ✅ Ready for Shadow Atlas ingestion

---

## Resources

- **Full Investigation**: `BLOCKED-CA-CITIES-INVESTIGATION.md`
- **Implementation Spec**: `WEBMAP-EXTRACTOR-SPEC.md`
- **Code Examples**: `WEBMAP-EXTRACTOR-CODE-EXAMPLES.ts`
- **Executive Summary**: `BLOCKED-CA-CITIES-SUMMARY.md`

---

## Questions?

Check the investigation report first. If still blocked:
1. Review code examples (copy-paste-ready)
2. Check test cases for expected behavior
3. Debug with console.log at each pipeline step

---

**Estimated Time**: 4-6 hours (2 hours coding + 2 hours testing + buffer)

**Go build.** 🚀
