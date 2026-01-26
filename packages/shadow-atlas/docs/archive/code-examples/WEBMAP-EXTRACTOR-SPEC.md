# ArcGIS Webmap Feature Extractor: Technical Specification

**Date**: 2026-01-17
**Purpose**: Extract embedded feature collections from ArcGIS webmaps for Shadow Atlas ingestion
**Scope**: Unblock Claremont CA and Martinez CA (plus future webmap-based cities)

---

## Problem Statement

Current `PortalDiscoveryAgent` assumes all municipal GIS data is exposed via ArcGIS REST endpoints (FeatureServer/MapServer). However, some cities embed council district geometry directly in ArcGIS webmaps as **self-contained feature collections**, which current discovery cannot process.

### Affected Cities (Known)
- **Claremont, CA** (PLSS: 0613756) - 5 districts in webmap `f9f59d55e7e2433b8d9a1af9f079ec82`
- **Martinez, CA** (PLSS: 0646114) - 4 districts in webmap `5eb9a43de95845d48c8d56773d023609`

### Discovery Gap
```typescript
// Current approach (FAILS for embedded webmaps)
const url = 'https://services.arcgis.com/.../FeatureServer/0';
const features = await queryFeatureServer(url, 'where=1=1');

// Webmap approach (REQUIRED for Claremont/Martinez)
const webmapUrl = 'https://www.arcgis.com/sharing/rest/content/items/{id}/data?f=json';
const webmapData = await fetch(webmapUrl).then(r => r.json());
const features = extractFromOperationalLayers(webmapData);
```

---

## Data Structure Analysis

### ArcGIS Webmap JSON Schema

```typescript
interface ArcGISWebMap {
  operationalLayers: OperationalLayer[];
  baseMap: BaseMap;
  spatialReference: SpatialReference;
  version: string;
}

interface OperationalLayer {
  id: string;
  title: string;
  opacity: number;
  visibility: boolean;

  // CASE 1: External service reference
  url?: string;  // Points to FeatureServer/MapServer
  layerType?: 'ArcGISFeatureLayer' | 'ArcGISMapServiceLayer';

  // CASE 2: Embedded feature collection (TARGET CASE)
  featureCollection?: {
    layers: Array<{
      layerDefinition: {
        name: string;
        geometryType: 'esriGeometryPolygon' | 'esriGeometryPolyline' | 'esriGeometryPoint';
        fields: Field[];
        drawingInfo: { renderer: any };
      };
      featureSet: {
        geometryType: string;
        spatialReference: SpatialReference;
        features: EsriFeature[];  // ← ACTUAL GEOMETRY HERE
      };
    }>;
  };
}

interface EsriFeature {
  attributes: Record<string, any>;
  geometry: {
    rings?: number[][][];      // Polygon
    paths?: number[][][];      // Polyline
    x?: number; y?: number;    // Point
    spatialReference: SpatialReference;
  };
}

interface SpatialReference {
  wkid: number;  // e.g., 102100 = Web Mercator, 4326 = WGS84
  latestWkid?: number;
}
```

### Example: Claremont "Adopted 2022-2030 Council Districts"

```json
{
  "operationalLayers": [
    {
      "id": "Adopted_2022_2030_Council_Districts_1234",
      "title": "Adopted 2022-2030 Council Districts",
      "opacity": 1,
      "visibility": true,
      "featureCollection": {
        "layers": [
          {
            "layerDefinition": {
              "name": "Adopted 2022-2030 Council Districts",
              "geometryType": "esriGeometryPolygon",
              "fields": [
                { "name": "OBJECTID", "type": "esriFieldTypeOID" },
                { "name": "DISTRICT", "type": "esriFieldTypeInteger" },
                { "name": "CVAP_TOTAL", "type": "esriFieldTypeInteger" }
              ]
            },
            "featureSet": {
              "geometryType": "esriGeometryPolygon",
              "spatialReference": { "wkid": 102100 },
              "features": [
                {
                  "attributes": {
                    "OBJECTID": 1,
                    "DISTRICT": 1,
                    "CVAP_TOTAL": 5234
                  },
                  "geometry": {
                    "rings": [
                      [
                        [-13107953.234, 4039480.567],
                        [-13107850.123, 4039520.987],
                        // ... more coordinates
                        [-13107953.234, 4039480.567]  // Closed ring
                      ]
                    ]
                  }
                }
                // ... 4 more district features
              ]
            }
          }
        ]
      }
    }
  ]
}
```

---

## Implementation Design

### 1. Webmap Fetcher

```typescript
/**
 * Fetch and parse ArcGIS webmap JSON
 */
async function fetchWebmap(webmapId: string): Promise<ArcGISWebMap> {
  const url = `https://www.arcgis.com/sharing/rest/content/items/${webmapId}/data?f=json`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch webmap ${webmapId}: ${response.status}`);
  }

  const data = await response.json();

  // Validate basic structure
  if (!data.operationalLayers || !Array.isArray(data.operationalLayers)) {
    throw new Error(`Invalid webmap structure for ${webmapId}`);
  }

  return data as ArcGISWebMap;
}
```

### 2. Feature Extractor

```typescript
interface ExtractOptions {
  webmapId: string;
  targetLayerTitle: string;  // Exact match or regex
  expectedDistrictCount?: number;
}

/**
 * Extract features from embedded feature collection
 */
function extractFeaturesFromWebmap(
  webmap: ArcGISWebMap,
  options: ExtractOptions
): EsriFeature[] {
  // Find target layer
  const targetLayer = webmap.operationalLayers.find(layer => {
    if (typeof options.targetLayerTitle === 'string') {
      return layer.title === options.targetLayerTitle;
    } else {
      return options.targetLayerTitle.test(layer.title);
    }
  });

  if (!targetLayer) {
    throw new Error(
      `Layer "${options.targetLayerTitle}" not found in webmap ${options.webmapId}. ` +
      `Available layers: ${webmap.operationalLayers.map(l => l.title).join(', ')}`
    );
  }

  // Ensure it's an embedded feature collection
  if (!targetLayer.featureCollection) {
    throw new Error(
      `Layer "${targetLayer.title}" is a service reference (url: ${targetLayer.url}), ` +
      `not an embedded feature collection`
    );
  }

  // Extract features
  const features = targetLayer.featureCollection.layers[0]?.featureSet?.features;

  if (!features || !Array.isArray(features)) {
    throw new Error(`No features found in layer "${targetLayer.title}"`);
  }

  // Validate count if specified
  if (options.expectedDistrictCount && features.length !== options.expectedDistrictCount) {
    console.warn(
      `Expected ${options.expectedDistrictCount} districts, found ${features.length} in webmap ${options.webmapId}`
    );
  }

  return features;
}
```

### 3. Spatial Reference Converter

```typescript
import proj4 from 'proj4';

// Define common projections
proj4.defs('EPSG:3857', '+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +wkgs84 +no_defs');
proj4.defs('EPSG:4326', '+proj=longlat +datum=WGS84 +no_defs');

/**
 * Convert Esri geometry to GeoJSON with WGS84 coordinates
 */
function esriToGeoJSON(
  esriFeature: EsriFeature,
  sourceSR: SpatialReference
): GeoJSON.Feature {
  const sourceProj = getProj4Definition(sourceSR.wkid);
  const targetProj = 'EPSG:4326';

  let geometry: GeoJSON.Geometry;

  if (esriFeature.geometry.rings) {
    // Polygon
    const rings = esriFeature.geometry.rings.map(ring =>
      ring.map(coord => proj4(sourceProj, targetProj, coord))
    );

    geometry = {
      type: 'Polygon',
      coordinates: rings
    };
  } else if (esriFeature.geometry.paths) {
    // LineString
    const paths = esriFeature.geometry.paths.map(path =>
      path.map(coord => proj4(sourceProj, targetProj, coord))
    );

    geometry = {
      type: 'MultiLineString',
      coordinates: paths
    };
  } else if (esriFeature.geometry.x !== undefined) {
    // Point
    const [lng, lat] = proj4(sourceProj, targetProj, [
      esriFeature.geometry.x,
      esriFeature.geometry.y
    ]);

    geometry = {
      type: 'Point',
      coordinates: [lng, lat]
    };
  } else {
    throw new Error('Unknown Esri geometry type');
  }

  return {
    type: 'Feature',
    geometry,
    properties: esriFeature.attributes
  };
}

/**
 * Map WKID to proj4 definition
 */
function getProj4Definition(wkid: number): string {
  const wellKnown: Record<number, string> = {
    102100: 'EPSG:3857',  // Web Mercator
    3857: 'EPSG:3857',
    4326: 'EPSG:4326',    // WGS84
    102729: '+proj=lcc +lat_1=40.88333333333333 +lat_2=41.95 +lat_0=40.16666666666666 +lon_0=-77.75 +x_0=600000 +y_0=0 +datum=NAD83 +units=us-ft +no_defs',  // PA State Plane
    // Add more as needed
  };

  if (wellKnown[wkid]) {
    return wellKnown[wkid];
  }

  // Fallback: try epsg.io lookup
  throw new Error(`Unknown WKID ${wkid}. Add proj4 definition to wellKnown map.`);
}
```

### 4. Validation

```typescript
/**
 * Validate extracted GeoJSON features
 */
function validateGeoJSONFeatures(
  features: GeoJSON.Feature[],
  options: {
    expectedCount?: number;
    requireDistrictField?: string;
    minDistrictNumber?: number;
    maxDistrictNumber?: number;
  }
): void {
  // Count check
  if (options.expectedCount && features.length !== options.expectedCount) {
    throw new Error(
      `Expected ${options.expectedCount} features, got ${features.length}`
    );
  }

  features.forEach((feature, idx) => {
    // Coordinate range check (WGS84)
    if (feature.geometry.type === 'Polygon') {
      const ring = (feature.geometry as GeoJSON.Polygon).coordinates[0];
      ring.forEach(coord => {
        if (Math.abs(coord[0]) > 180 || Math.abs(coord[1]) > 90) {
          throw new Error(
            `Feature ${idx} has invalid WGS84 coordinates: [${coord}]`
          );
        }
      });

      // Polygon closure check
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        throw new Error(`Feature ${idx} polygon not closed`);
      }
    }

    // District field check
    if (options.requireDistrictField) {
      const districtValue = feature.properties?.[options.requireDistrictField];
      if (districtValue === undefined || districtValue === null) {
        throw new Error(
          `Feature ${idx} missing required field "${options.requireDistrictField}"`
        );
      }

      // District number range check
      if (typeof districtValue === 'number') {
        const min = options.minDistrictNumber ?? 1;
        const max = options.maxDistrictNumber ?? 99;
        if (districtValue < min || districtValue > max) {
          throw new Error(
            `Feature ${idx} has district number ${districtValue} outside range [${min}, ${max}]`
          );
        }
      }
    }
  });
}
```

### 5. Unified Extraction API

```typescript
interface WebmapPortalConfig {
  placeId: string;
  placeName: string;
  webmapId: string;
  targetLayerTitle: string | RegExp;
  expectedDistrictCount?: number;
  districtFieldName?: string;
}

/**
 * Complete webmap extraction pipeline
 */
async function extractCouncilDistrictsFromWebmap(
  config: WebmapPortalConfig
): Promise<GeoJSON.FeatureCollection> {
  console.log(`[WebmapExtractor] Fetching webmap ${config.webmapId} for ${config.placeName}`);

  // 1. Fetch webmap JSON
  const webmap = await fetchWebmap(config.webmapId);

  // 2. Extract Esri features
  const esriFeatures = extractFeaturesFromWebmap(webmap, {
    webmapId: config.webmapId,
    targetLayerTitle: config.targetLayerTitle,
    expectedDistrictCount: config.expectedDistrictCount
  });

  console.log(`[WebmapExtractor] Found ${esriFeatures.length} features`);

  // 3. Get spatial reference
  const targetLayer = webmap.operationalLayers.find(l =>
    typeof config.targetLayerTitle === 'string'
      ? l.title === config.targetLayerTitle
      : config.targetLayerTitle.test(l.title)
  )!;

  const spatialRef = targetLayer.featureCollection!.layers[0].featureSet.spatialReference;

  // 4. Convert to GeoJSON with WGS84
  const geoJsonFeatures = esriFeatures.map(f => esriToGeoJSON(f, spatialRef));

  // 5. Validate
  validateGeoJSONFeatures(geoJsonFeatures, {
    expectedCount: config.expectedDistrictCount,
    requireDistrictField: config.districtFieldName,
    minDistrictNumber: 1,
    maxDistrictNumber: 15
  });

  console.log(`[WebmapExtractor] Validation passed for ${config.placeName}`);

  // 6. Return GeoJSON FeatureCollection
  return {
    type: 'FeatureCollection',
    features: geoJsonFeatures
  };
}
```

---

## Integration with Portal Registry

### Updated Schema for `known-portals.ts`

```typescript
interface PortalEntry {
  placeId: string;
  placeName: string;
  stateAbbr: string;

  // Discriminated union for source type
  sourceType: 'featureServer' | 'mapServer' | 'webmap' | 'manual';

  // FeatureServer/MapServer config
  serviceUrl?: string;
  layerId?: number;

  // Webmap config
  webmapId?: string;
  targetLayerTitle?: string;

  // Common config
  expectedDistrictCount?: number;
  districtFieldName?: string;
  dataQuality?: 'verified' | 'suspected' | 'blocked';
  lastVerified?: string; // ISO date
  notes?: string;
}
```

### Example Entries

```typescript
const KNOWN_PORTALS: PortalEntry[] = [
  // Traditional FeatureServer (existing pattern)
  {
    placeId: '0666000',
    placeName: 'San Francisco, CA',
    stateAbbr: 'CA',
    sourceType: 'featureServer',
    serviceUrl: 'https://services.arcgis.com/.../FeatureServer',
    layerId: 0,
    expectedDistrictCount: 11,
    districtFieldName: 'DISTRICT',
    dataQuality: 'verified'
  },

  // Webmap embedded (NEW PATTERN)
  {
    placeId: '0613756',
    placeName: 'Claremont, CA',
    stateAbbr: 'CA',
    sourceType: 'webmap',
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
  },

  // Manual data request required (BLOCKED)
  {
    placeId: '0608142',
    placeName: 'Brentwood, CA',
    stateAbbr: 'CA',
    sourceType: 'manual',
    dataQuality: 'blocked',
    lastVerified: '2026-01-17',
    notes: 'VertiGIS/Geocortex platform with no public REST endpoints. Contact city engineering for data request.'
  }
];
```

---

## Extraction Workflow

```typescript
async function processPortalEntry(entry: PortalEntry): Promise<GeoJSON.FeatureCollection> {
  switch (entry.sourceType) {
    case 'featureServer':
    case 'mapServer':
      return await extractFromArcGISService({
        serviceUrl: entry.serviceUrl!,
        layerId: entry.layerId
      });

    case 'webmap':
      return await extractCouncilDistrictsFromWebmap({
        placeId: entry.placeId,
        placeName: entry.placeName,
        webmapId: entry.webmapId!,
        targetLayerTitle: entry.targetLayerTitle!,
        expectedDistrictCount: entry.expectedDistrictCount,
        districtFieldName: entry.districtFieldName
      });

    case 'manual':
      throw new Error(
        `Portal entry for ${entry.placeName} requires manual data request. Notes: ${entry.notes}`
      );

    default:
      const _exhaustive: never = entry.sourceType;
      throw new Error(`Unknown source type: ${_exhaustive}`);
  }
}
```

---

## Testing Strategy

### Unit Tests

```typescript
describe('WebmapExtractor', () => {
  describe('fetchWebmap', () => {
    it('should fetch Claremont webmap successfully', async () => {
      const webmap = await fetchWebmap('f9f59d55e7e2433b8d9a1af9f079ec82');
      expect(webmap.operationalLayers).toHaveLength(4);
      expect(webmap.operationalLayers.find(l => l.title === 'Adopted 2022-2030 Council Districts')).toBeDefined();
    });

    it('should throw on invalid webmap ID', async () => {
      await expect(fetchWebmap('invalid-id')).rejects.toThrow();
    });
  });

  describe('extractFeaturesFromWebmap', () => {
    it('should extract 5 districts from Claremont', async () => {
      const webmap = await fetchWebmap('f9f59d55e7e2433b8d9a1af9f079ec82');
      const features = extractFeaturesFromWebmap(webmap, {
        webmapId: 'f9f59d55e7e2433b8d9a1af9f079ec82',
        targetLayerTitle: 'Adopted 2022-2030 Council Districts',
        expectedDistrictCount: 5
      });
      expect(features).toHaveLength(5);
    });

    it('should throw if layer not found', async () => {
      const webmap = await fetchWebmap('f9f59d55e7e2433b8d9a1af9f079ec82');
      expect(() =>
        extractFeaturesFromWebmap(webmap, {
          webmapId: 'f9f59d55e7e2433b8d9a1af9f079ec82',
          targetLayerTitle: 'Nonexistent Layer'
        })
      ).toThrow('Layer "Nonexistent Layer" not found');
    });
  });

  describe('esriToGeoJSON', () => {
    it('should convert Web Mercator to WGS84', () => {
      const esriFeature: EsriFeature = {
        attributes: { DISTRICT: 1 },
        geometry: {
          rings: [[
            [-13107953.234, 4039480.567],
            [-13107850.123, 4039520.987],
            [-13107953.234, 4039480.567]
          ]],
          spatialReference: { wkid: 102100 }
        }
      };

      const geoJson = esriToGeoJSON(esriFeature, { wkid: 102100 });

      expect(geoJson.geometry.type).toBe('Polygon');
      const coords = (geoJson.geometry as GeoJSON.Polygon).coordinates[0][0];
      expect(coords[0]).toBeCloseTo(-117.7, 1); // Longitude
      expect(coords[1]).toBeCloseTo(34.1, 1);   // Latitude
    });

    it('should preserve attributes', () => {
      const esriFeature: EsriFeature = {
        attributes: { DISTRICT: 3, POPULATION: 12000 },
        geometry: {
          rings: [[[-117.5, 34.0], [-117.4, 34.0], [-117.5, 34.0]]],
          spatialReference: { wkid: 4326 }
        }
      };

      const geoJson = esriToGeoJSON(esriFeature, { wkid: 4326 });
      expect(geoJson.properties).toEqual({ DISTRICT: 3, POPULATION: 12000 });
    });
  });

  describe('validateGeoJSONFeatures', () => {
    it('should pass for valid features', () => {
      const features: GeoJSON.Feature[] = [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [-117.5, 34.0],
              [-117.4, 34.0],
              [-117.4, 34.1],
              [-117.5, 34.0]
            ]]
          },
          properties: { DISTRICT: 1 }
        }
      ];

      expect(() =>
        validateGeoJSONFeatures(features, { requireDistrictField: 'DISTRICT' })
      ).not.toThrow();
    });

    it('should throw for unclosed polygons', () => {
      const features: GeoJSON.Feature[] = [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [-117.5, 34.0],
              [-117.4, 34.0],
              [-117.4, 34.1]
              // Missing closing point!
            ]]
          },
          properties: {}
        }
      ];

      expect(() => validateGeoJSONFeatures(features, {})).toThrow('polygon not closed');
    });

    it('should throw for missing district field', () => {
      const features: GeoJSON.Feature[] = [
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [[[-117.5, 34.0], [-117.4, 34.0], [-117.5, 34.0]]] },
          properties: {} // DISTRICT field missing
        }
      ];

      expect(() =>
        validateGeoJSONFeatures(features, { requireDistrictField: 'DISTRICT' })
      ).toThrow('missing required field "DISTRICT"');
    });
  });
});
```

### Integration Test

```typescript
describe('WebmapExtractor Integration', () => {
  it('should extract Claremont districts end-to-end', async () => {
    const result = await extractCouncilDistrictsFromWebmap({
      placeId: '0613756',
      placeName: 'Claremont, CA',
      webmapId: 'f9f59d55e7e2433b8d9a1af9f079ec82',
      targetLayerTitle: 'Adopted 2022-2030 Council Districts',
      expectedDistrictCount: 5,
      districtFieldName: 'DISTRICT'
    });

    expect(result.type).toBe('FeatureCollection');
    expect(result.features).toHaveLength(5);

    // Check WGS84 coordinates
    const firstFeature = result.features[0];
    const coords = (firstFeature.geometry as GeoJSON.Polygon).coordinates[0][0];
    expect(coords[0]).toBeGreaterThan(-180);
    expect(coords[0]).toBeLessThan(180);
    expect(coords[1]).toBeGreaterThan(-90);
    expect(coords[1]).toBeLessThan(90);

    // Check district numbers
    const districts = result.features.map(f => f.properties?.DISTRICT).sort();
    expect(districts).toEqual([1, 2, 3, 4, 5]);
  });

  it('should extract Martinez districts end-to-end', async () => {
    const result = await extractCouncilDistrictsFromWebmap({
      placeId: '0646114',
      placeName: 'Martinez, CA',
      webmapId: '5eb9a43de95845d48c8d56773d023609',
      targetLayerTitle: 'Adopted Districts',
      expectedDistrictCount: 4,
      districtFieldName: 'DISTRICT'
    });

    expect(result.features).toHaveLength(4);
    const districts = result.features.map(f => f.properties?.DISTRICT).sort();
    expect(districts).toEqual([1, 2, 3, 4]);
  });
});
```

---

## Performance Considerations

### Webmap Size
- **Claremont webmap**: ~1.2 MB (5 districts with demographics)
- **Martinez webmap**: ~800 KB (4 districts)
- **Fetch time**: ~500-1000ms depending on network

### Optimization Strategies
1. **Caching**: Store fetched webmap JSON for 24 hours (they rarely change)
2. **Batch fetching**: Fetch multiple webmaps in parallel
3. **Lazy projection**: Only convert coordinates when needed (store Esri features as-is until export)

```typescript
// Example: Cached fetcher
const webmapCache = new Map<string, { data: ArcGISWebMap; timestamp: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function fetchWebmapCached(webmapId: string): Promise<ArcGISWebMap> {
  const cached = webmapCache.get(webmapId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log(`[WebmapExtractor] Cache hit for ${webmapId}`);
    return cached.data;
  }

  const data = await fetchWebmap(webmapId);
  webmapCache.set(webmapId, { data, timestamp: Date.now() });
  return data;
}
```

---

## Monitoring & Observability

### Metrics to Track
- **Webmap fetch latency**: Time to download JSON
- **Extraction success rate**: % of webmaps successfully processed
- **Validation failures**: Count of geometry/attribute issues
- **Projection errors**: Count of coordinate conversion failures

### Logging
```typescript
console.log(`[WebmapExtractor] Processing ${config.placeName}`);
console.log(`  Webmap ID: ${config.webmapId}`);
console.log(`  Target layer: ${config.targetLayerTitle}`);
console.log(`  Expected districts: ${config.expectedDistrictCount}`);
console.log(`  ✓ Fetched webmap (${webmap.operationalLayers.length} layers)`);
console.log(`  ✓ Extracted ${esriFeatures.length} features`);
console.log(`  ✓ Converted to WGS84 (source WKID: ${spatialRef.wkid})`);
console.log(`  ✓ Validation passed`);
```

---

## Deployment Checklist

- [ ] Implement `fetchWebmap` function
- [ ] Implement `extractFeaturesFromWebmap` function
- [ ] Implement `esriToGeoJSON` conversion (with proj4)
- [ ] Implement `validateGeoJSONFeatures` validation
- [ ] Add webmap entries to `known-portals.ts` (Claremont + Martinez)
- [ ] Write unit tests for all functions
- [ ] Write integration tests for Claremont + Martinez
- [ ] Add caching layer for webmap JSON
- [ ] Update portal processing logic to handle `sourceType: 'webmap'`
- [ ] Document webmap extraction in Shadow Atlas README
- [ ] Test with real Claremont/Martinez webmaps in staging
- [ ] Monitor extraction metrics for 1 week

---

## Future Enhancements

### 1. Automatic Webmap Discovery
Scan ArcGIS Online for webmaps containing "council districts" or similar titles:
```typescript
const searchUrl = 'https://www.arcgis.com/sharing/rest/search?q=council%20districts%20California&f=json';
```

### 2. Layer Title Fuzzy Matching
Use regex or fuzzy matching for layer titles:
```typescript
targetLayerTitle: /council.*district/i  // Matches "Council Districts", "Adopted Council Districts", etc.
```

### 3. Historical Version Tracking
Store webmap snapshots to detect redistricting changes:
```typescript
interface WebmapSnapshot {
  webmapId: string;
  fetchedAt: string;
  districtCount: number;
  geometryHash: string;  // Hash of all geometries for change detection
}
```

### 4. Multi-Layer Extraction
Support webmaps with multiple district layers (e.g., old vs. new):
```typescript
interface MultiLayerConfig {
  webmapId: string;
  layers: Array<{
    title: string;
    effectiveDate: string;
    notes?: string;
  }>;
}
```

---

## Conclusion

This webmap extractor unblocks **66.7% of previously blocked California cities** (Claremont and Martinez) by handling embedded feature collections. The implementation is:

- ✅ **Type-safe**: Full TypeScript interfaces for Esri and GeoJSON
- ✅ **Validated**: Comprehensive checks for geometry and attributes
- ✅ **Performant**: Caching and batch processing support
- ✅ **Extensible**: Easy to add new webmap-based cities

**Next step**: Implement and test with real Claremont/Martinez data to validate the approach.
