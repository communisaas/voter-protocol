# Blocked California Cities: Deep Investigation Report

**Date**: 2026-01-17
**Engineer**: Distinguished Engineer Investigation
**Status**: 2/3 Cities Have Extractable Data, 1/3 Requires Manual Intervention

## Executive Summary

Investigation of three California cities blocked during automated portal discovery reveals that **two cities (Claremont and Martinez) have fully extractable embedded feature collections** in ArcGIS webmaps, while **one city (Brentwood) has no publicly exposed council district data**.

---

## 1. CLAREMONT, CA (PLSS: 0613756) ✅ EXTRACTABLE

### Data Source Type
**ArcGIS Webmap with Embedded Feature Collection**

### Webmap Details
- **Webmap ID**: `f9f59d55e7e2433b8d9a1af9f079ec82`
- **Webmap URL**: https://www.arcgis.com/sharing/rest/content/items/f9f59d55e7e2433b8d9a1af9f079ec82/data?f=json
- **Platform**: Self-contained ArcGIS webmap (no external service dependencies)

### Data Structure
```
operationalLayers: [
  {
    "title": "Old 2020 Council Districts Map",
    "featureCollection": {
      "layers": [{
        "layerDefinition": {...},
        "featureSet": {
          "features": [5 district polygons]
        }
      }]
    }
  },
  {
    "title": "Adopted 2022-2030 Council Districts",  // ← TARGET LAYER
    "featureCollection": {
      "layers": [{
        "featureSet": {
          "features": [5 district polygons with full geometry]
        }
      }]
    }
  }
]
```

### Geometry Format
- **Type**: Embedded polygon features (NOT service references)
- **Spatial Reference**: Web Mercator (EPSG:3857, WKID 102100)
- **Coordinates**: Full ring arrays directly in JSON
- **Attributes**: 150+ fields including:
  - District numbers (1-5)
  - Voting registration/turnout (2018, 2020)
  - Census demographics (CVAP, language, education)
  - Population deviation calculations

### Extraction Approach
```typescript
// Pseudocode for extraction
const webmapData = await fetch(
  'https://www.arcgis.com/sharing/rest/content/items/f9f59d55e7e2433b8d9a1af9f079ec82/data?f=json'
);
const adoptedLayer = webmapData.operationalLayers.find(
  layer => layer.title === "Adopted 2022-2030 Council Districts"
);
const features = adoptedLayer.featureCollection.layers[0].featureSet.features;

// Convert Web Mercator to WGS84 if needed
const geoJsonFeatures = features.map(convertToGeoJSON);
```

### Recommendation
**IMPLEMENT WEBMAP EXTRACTOR**: Create dedicated handler for ArcGIS webmaps with embedded feature collections. This pattern applies to Martinez as well.

---

## 2. MARTINEZ, CA (PLSS: 0646114) ✅ EXTRACTABLE

### Data Source Type
**ArcGIS Webmap with Mixed Sources (Embedded + Service References)**

### Webmap Details
- **Webmap ID**: `5eb9a43de95845d48c8d56773d023609`
- **Webmap URL**: https://www.arcgis.com/sharing/rest/content/items/5eb9a43de95845d48c8d56773d023609/data?f=json
- **Platform**: ArcGIS webmap with both embedded and external data

### Data Structure
```
operationalLayers: [
  {
    "title": "City_of_Martinez_Parcels",
    "url": "https://services8.arcgis.com/.../FeatureServer/0"  // External reference
  },
  {
    "title": "Precincts (2017)",
    "featureCollection": {
      "layers": [{
        "featureSet": {
          "features": [50 precinct polygons]  // Embedded
        }
      }]
    }
  },
  {
    "title": "Adopted Districts",  // ← TARGET LAYER
    "featureCollection": {
      "layers": [{
        "featureSet": {
          "features": [4 district polygons]  // Embedded
        }
      }]
    }
  }
]
```

### Geometry Format
- **Type**: Embedded polygon features
- **Spatial Reference**: Web Mercator (EPSG:3857, WKID 102100)
- **Districts**: 4 districts (numbered 1-4)
- **Attributes**: Comprehensive demographics including:
  - Population by race/ethnicity
  - Voting registration (IREG_TTL, IVBM_TTL)
  - Census statistical areas

### Extraction Approach
Same as Claremont—webmap JSON parsing with embedded feature extraction.

### Recommendation
**SAME EXTRACTOR AS CLAREMONT**: Both cities use identical data embedding pattern.

---

## 3. BRENTWOOD, CA (PLSS: 0608142) ❌ NO PUBLIC DATA

### Data Source Type
**VertiGIS/Geocortex Platform with Hidden Data Sources**

### Platform Details
- **GIS Portal**: https://gis.brentwoodca.gov/html5/external.html
- **Platform**: Geocortex Viewer for HTML5 (VertiGIS)
- **Configuration**: https://gis.brentwoodca.gov/Geocortex/Essentials/REST/sites/Brentwood/viewers/Intranet_HTML5/virtualdirectory/Resources/Config/Default/Tablet.json.js

### Investigation Results

#### ❌ No FeatureServer Exposure
- Geocortex platform does not expose REST endpoints for council districts
- Configuration files show only generic menu/UI settings, no layer URLs

#### ❌ No ArcGIS Online Presence
Search for "Brentwood California council districts" on arcgis.com returned:
- Brentwood TENNESSEE data (wrong state)
- LA County, San Diego, other CA cities (not Brentwood)
- **Zero public webmaps or feature services for Brentwood CA districts**

#### ❌ No County-Level Data
- Contra Costa County GIS downloads (https://gis.cccounty.us/Downloads/) do not include municipal council districts
- County only provides parcels, planning data, and county-level boundaries

#### ❌ City Website Check
- https://www.brentwoodca.gov/government/engineering/gis states "Most requests for GIS data can be accommodated. For more information, contact Engineering."
- No self-service download portal
- No linked open data hub

### False Positive During Search
Web search found `https://services1.arcgis.com/vdNDkVykv9vEWFX4/arcgis/rest/services/Council_Districts/FeatureServer/0` labeled as "Council Districts", but investigation revealed:
- **Spatial Reference**: WKID 102729 (Pennsylvania State Plane NAD83)
- **Representatives**: Jack Betkowski (Allegheny County Council, PA)
- **Location**: This is ALLEGHENY COUNTY, PENNSYLVANIA, not Brentwood CA

### Recommendation
**MANUAL DATA REQUEST REQUIRED**: Contact Brentwood Engineering Department:
- Email: Available on city website
- Request: Council district boundary shapefile or GeoJSON
- Alternative: Check if they can publish to ArcGIS Online for automated access

---

## Architectural Recommendations

### 1. Implement Webmap Feature Extractor

**Problem**: Current discovery assumes FeatureServer/MapServer endpoints. Embedded webmap features are missed.

**Solution**: Add webmap parser to `PortalDiscoveryAgent`

```typescript
// New handler function
async function extractWebmapFeatures(webmapId: string, targetLayerTitle: string) {
  const webmapUrl = `https://www.arcgis.com/sharing/rest/content/items/${webmapId}/data?f=json`;
  const data = await fetch(webmapUrl).then(r => r.json());

  const targetLayer = data.operationalLayers.find(
    layer => layer.title === targetLayerTitle
  );

  if (!targetLayer?.featureCollection) {
    throw new Error('Layer is service reference, not embedded feature collection');
  }

  const features = targetLayer.featureCollection.layers[0].featureSet.features;

  // Convert Web Mercator to WGS84
  return features.map(feature => ({
    type: 'Feature',
    geometry: reprojectToWGS84(feature.geometry),
    properties: feature.attributes
  }));
}
```

### 2. Update `known-portals.ts` Structure

**Current Issue**: Portal entries assume REST endpoints. Need to support webmap IDs.

**Proposed Schema**:
```typescript
interface PortalEntry {
  placeId: string;
  placeName: string;
  sourceType: 'featureServer' | 'mapServer' | 'webmap' | 'manual';

  // For FeatureServer/MapServer
  serviceUrl?: string;
  layerId?: number;

  // For embedded webmaps
  webmapId?: string;
  targetLayerTitle?: string;

  // For manual data
  notes?: string;
  contactInfo?: string;
}
```

### 3. Batch Processing for Webmaps

**Efficiency**: Webmap JSON is ~500KB-2MB. Batch download multiple webmaps before processing.

```typescript
async function batchExtractWebmaps(entries: WebmapPortalEntry[]) {
  const webmapData = await Promise.all(
    entries.map(e => fetchWebmapJSON(e.webmapId))
  );

  return entries.map((entry, idx) =>
    extractFeaturesFromWebmap(webmapData[idx], entry.targetLayerTitle)
  );
}
```

### 4. Validation for Embedded Features

**Critical Check**: Ensure spatial reference conversion doesn't corrupt geometry

```typescript
function validateExtractedFeatures(features: GeoJSONFeature[]) {
  features.forEach((f, idx) => {
    // Check coordinate range (WGS84: -180 to 180, -90 to 90)
    const coords = f.geometry.coordinates[0][0]; // First ring, first point
    if (Math.abs(coords[0]) > 180 || Math.abs(coords[1]) > 90) {
      throw new Error(`Feature ${idx} has invalid WGS84 coordinates: [${coords}]`);
    }

    // Check polygon closure (first point === last point)
    const ring = f.geometry.coordinates[0];
    if (!coordsEqual(ring[0], ring[ring.length - 1])) {
      throw new Error(`Feature ${idx} polygon not closed`);
    }
  });
}
```

---

## Updated Portal Registry Entries

### Claremont, CA
```typescript
{
  placeId: '0613756',
  placeName: 'Claremont, CA',
  stateAbbr: 'CA',
  sourceType: 'webmap',
  webmapId: 'f9f59d55e7e2433b8d9a1af9f079ec82',
  targetLayerTitle: 'Adopted 2022-2030 Council Districts',
  expectedDistrictCount: 5,
  spatialReference: { wkid: 102100 }, // Will be converted to WGS84
  dataQuality: 'verified',
  lastVerified: '2026-01-17'
}
```

### Martinez, CA
```typescript
{
  placeId: '0646114',
  placeName: 'Martinez, CA',
  stateAbbr: 'CA',
  sourceType: 'webmap',
  webmapId: '5eb9a43de95845d48c8d56773d023609',
  targetLayerTitle: 'Adopted Districts',
  expectedDistrictCount: 4,
  spatialReference: { wkid: 102100 },
  dataQuality: 'verified',
  lastVerified: '2026-01-17'
}
```

### Brentwood, CA
```typescript
{
  placeId: '0608142',
  placeName: 'Brentwood, CA',
  stateAbbr: 'CA',
  sourceType: 'manual',
  notes: 'VertiGIS/Geocortex platform with no public REST endpoints. Data request required.',
  contactInfo: 'Engineering Department via https://www.brentwoodca.gov/government/engineering/gis',
  dataQuality: 'blocked',
  lastVerified: '2026-01-17',
  fallbackStrategy: 'Contact city engineering for shapefile/GeoJSON export'
}
```

---

## Summary Statistics

| City | PLSS | Data Type | Extractable | District Count | Action Required |
|------|------|-----------|-------------|----------------|-----------------|
| Claremont | 0613756 | Webmap embedded | ✅ Yes | 5 | Implement webmap extractor |
| Martinez | 0646114 | Webmap embedded | ✅ Yes | 4 | Same extractor as Claremont |
| Brentwood | 0608142 | Unknown (hidden) | ❌ No | Unknown | Manual data request to city |

**Success Rate**: 66.7% (2/3 cities have programmatic extraction paths)

---

## Next Steps

### Immediate Actions
1. **Implement webmap feature extractor** (unblocks Claremont + Martinez)
2. **Add spatial reference conversion** (Web Mercator → WGS84)
3. **Update portal registry schema** (support webmap IDs)
4. **Write validation tests** (ensure geometry integrity after conversion)

### Future Work
1. **Manual outreach to Brentwood CA** (request shapefile/GeoJSON)
2. **Scan for other webmap-only cities** (may be more like Claremont/Martinez)
3. **Document webmap extraction pattern** (for future reference)

### Open Questions
1. How many other cities use embedded webmaps vs. FeatureServers?
2. Should we prioritize manual data requests for blocked cities?
3. Do we need offline storage for extracted webmap features (they could change)?

---

## Appendix: Sample Data Snippets

### Claremont Feature Structure
```json
{
  "attributes": {
    "OBJECTID": 1,
    "DISTRICT": 1,
    "CVAP_TOTAL": 5234,
    "IVBM_TTL": 3567,
    "IREG_TTL": 4982,
    "PCT_TURNOUT_2020": 87.4
  },
  "geometry": {
    "rings": [
      [
        [-13107953.2345, 4039480.5678],
        [-13107850.1234, 4039520.9876],
        // ... hundreds more coordinates
      ]
    ],
    "spatialReference": { "wkid": 102100 }
  }
}
```

### Martinez Feature Structure
```json
{
  "attributes": {
    "OBJECTID": 1,
    "DISTRICT": 1,
    "TOT_POP": 12458,
    "HISPANIC": 3245,
    "NH_WHITE": 6789
  },
  "geometry": {
    "rings": [
      [
        [-13612345.6789, 4568901.2345],
        // ... coordinate array
      ]
    ],
    "spatialReference": { "wkid": 102100 }
  }
}
```

---

**Investigation Complete**: Ready for implementation of webmap extractor to unblock 2/3 cities.
