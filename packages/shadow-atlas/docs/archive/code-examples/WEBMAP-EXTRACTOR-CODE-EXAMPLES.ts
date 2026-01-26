/**
 * ArcGIS Webmap Feature Extractor - Implementation Examples
 *
 * This file contains production-ready code snippets for extracting
 * embedded feature collections from ArcGIS webmaps.
 *
 * Use case: Claremont CA and Martinez CA embed council district
 * geometry directly in webmaps instead of hosting FeatureServers.
 *
 * @author Distinguished Engineer
 * @date 2026-01-17
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface ArcGISWebMap {
  operationalLayers: OperationalLayer[];
  baseMap: {
    baseMapLayers: Array<{ url: string }>;
  };
  spatialReference: SpatialReference;
  version: string;
}

interface OperationalLayer {
  id: string;
  title: string;
  opacity: number;
  visibility: boolean;

  // External service reference (existing pattern)
  url?: string;
  layerType?: 'ArcGISFeatureLayer' | 'ArcGISMapServiceLayer';

  // Embedded feature collection (NEW pattern for webmaps)
  featureCollection?: {
    layers: Array<{
      layerDefinition: {
        name: string;
        geometryType: 'esriGeometryPolygon' | 'esriGeometryPolyline' | 'esriGeometryPoint';
        fields: Array<{
          name: string;
          type: string;
          alias: string;
        }>;
        drawingInfo: {
          renderer: any;
        };
      };
      featureSet: {
        geometryType: string;
        spatialReference: SpatialReference;
        features: EsriFeature[];
      };
    }>;
  };
}

interface EsriFeature {
  attributes: Record<string, any>;
  geometry: {
    // Polygon (most common for council districts)
    rings?: number[][][];

    // Polyline
    paths?: number[][][];

    // Point
    x?: number;
    y?: number;

    spatialReference?: SpatialReference;
  };
}

interface SpatialReference {
  wkid: number;
  latestWkid?: number;
}

interface WebmapPortalConfig {
  placeId: string;
  placeName: string;
  webmapId: string;
  targetLayerTitle: string | RegExp;
  expectedDistrictCount?: number;
  districtFieldName?: string;
}

// ============================================================================
// EXAMPLE 1: FETCH WEBMAP JSON
// ============================================================================

/**
 * Fetch and parse ArcGIS webmap JSON from the REST API.
 *
 * @example
 * const webmap = await fetchWebmap('f9f59d55e7e2433b8d9a1af9f079ec82');
 * console.log(`Webmap has ${webmap.operationalLayers.length} layers`);
 */
async function fetchWebmap(webmapId: string): Promise<ArcGISWebMap> {
  const url = `https://www.arcgis.com/sharing/rest/content/items/${webmapId}/data?f=json`;

  console.log(`[WebmapExtractor] Fetching webmap ${webmapId}...`);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch webmap ${webmapId}: HTTP ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json();

  // Validate basic structure
  if (!data.operationalLayers || !Array.isArray(data.operationalLayers)) {
    throw new Error(
      `Invalid webmap structure for ${webmapId}: missing or invalid operationalLayers`
    );
  }

  console.log(
    `[WebmapExtractor] ✓ Fetched webmap with ${data.operationalLayers.length} layers`
  );

  return data as ArcGISWebMap;
}

// ============================================================================
// EXAMPLE 2: EXTRACT FEATURES FROM EMBEDDED COLLECTION
// ============================================================================

/**
 * Extract features from a specific layer in the webmap by title.
 *
 * @example
 * const webmap = await fetchWebmap('f9f59d55e7e2433b8d9a1af9f079ec82');
 * const features = extractFeaturesFromWebmap(webmap, {
 *   webmapId: 'f9f59d55e7e2433b8d9a1af9f079ec82',
 *   targetLayerTitle: 'Adopted 2022-2030 Council Districts',
 *   expectedDistrictCount: 5
 * });
 * console.log(`Extracted ${features.length} district features`);
 */
function extractFeaturesFromWebmap(
  webmap: ArcGISWebMap,
  options: {
    webmapId: string;
    targetLayerTitle: string | RegExp;
    expectedDistrictCount?: number;
  }
): EsriFeature[] {
  // Find the target layer
  const targetLayer = webmap.operationalLayers.find((layer) => {
    if (typeof options.targetLayerTitle === 'string') {
      return layer.title === options.targetLayerTitle;
    } else {
      return options.targetLayerTitle.test(layer.title);
    }
  });

  if (!targetLayer) {
    const availableLayers = webmap.operationalLayers
      .map((l) => `"${l.title}"`)
      .join(', ');
    throw new Error(
      `Layer "${options.targetLayerTitle}" not found in webmap ${options.webmapId}. ` +
        `Available layers: ${availableLayers}`
    );
  }

  console.log(`[WebmapExtractor] Found target layer: "${targetLayer.title}"`);

  // Ensure it's an embedded feature collection (not a service reference)
  if (!targetLayer.featureCollection) {
    if (targetLayer.url) {
      throw new Error(
        `Layer "${targetLayer.title}" is a service reference (url: ${targetLayer.url}), ` +
          `not an embedded feature collection. Use FeatureServer extraction instead.`
      );
    } else {
      throw new Error(
        `Layer "${targetLayer.title}" has no featureCollection and no url. Unknown layer type.`
      );
    }
  }

  // Extract features from the first layer in the collection
  const features =
    targetLayer.featureCollection.layers[0]?.featureSet?.features;

  if (!features || !Array.isArray(features)) {
    throw new Error(
      `No features found in layer "${targetLayer.title}". ` +
        `featureSet may be empty or malformed.`
    );
  }

  console.log(`[WebmapExtractor] ✓ Extracted ${features.length} features`);

  // Validate feature count if specified
  if (
    options.expectedDistrictCount &&
    features.length !== options.expectedDistrictCount
  ) {
    console.warn(
      `[WebmapExtractor] ⚠️  Expected ${options.expectedDistrictCount} districts, ` +
        `but found ${features.length} features in webmap ${options.webmapId}`
    );
  }

  return features;
}

// ============================================================================
// EXAMPLE 3: CONVERT ESRI GEOMETRY TO GEOJSON WITH WGS84
// ============================================================================

import proj4 from 'proj4';

// Define common projections
proj4.defs(
  'EPSG:3857',
  '+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +wkgs84 +no_defs'
);
proj4.defs('EPSG:4326', '+proj=longlat +datum=WGS84 +no_defs');

/**
 * Convert Esri feature (Web Mercator or other projection) to GeoJSON with WGS84.
 *
 * @example
 * const esriFeature = { attributes: { DISTRICT: 1 }, geometry: { rings: [...] } };
 * const spatialRef = { wkid: 102100 };
 * const geoJson = esriToGeoJSON(esriFeature, spatialRef);
 * console.log(geoJson.geometry.coordinates); // WGS84 coordinates
 */
function esriToGeoJSON(
  esriFeature: EsriFeature,
  sourceSR: SpatialReference
): GeoJSON.Feature<GeoJSON.Geometry> {
  const sourceProj = getProj4Definition(sourceSR.wkid);
  const targetProj = 'EPSG:4326'; // WGS84

  let geometry: GeoJSON.Geometry;

  if (esriFeature.geometry.rings) {
    // POLYGON
    const rings = esriFeature.geometry.rings.map((ring) =>
      ring.map((coord) => {
        const [lng, lat] = proj4(sourceProj, targetProj, coord);
        return [lng, lat];
      })
    );

    geometry = {
      type: 'Polygon',
      coordinates: rings,
    };
  } else if (esriFeature.geometry.paths) {
    // LINESTRING
    const paths = esriFeature.geometry.paths.map((path) =>
      path.map((coord) => {
        const [lng, lat] = proj4(sourceProj, targetProj, coord);
        return [lng, lat];
      })
    );

    geometry = {
      type: 'MultiLineString',
      coordinates: paths,
    };
  } else if (
    esriFeature.geometry.x !== undefined &&
    esriFeature.geometry.y !== undefined
  ) {
    // POINT
    const [lng, lat] = proj4(sourceProj, targetProj, [
      esriFeature.geometry.x,
      esriFeature.geometry.y,
    ]);

    geometry = {
      type: 'Point',
      coordinates: [lng, lat],
    };
  } else {
    throw new Error(
      `Unknown Esri geometry type. Feature: ${JSON.stringify(esriFeature.geometry)}`
    );
  }

  return {
    type: 'Feature',
    geometry,
    properties: esriFeature.attributes,
  };
}

/**
 * Map WKID (Well-Known ID) to proj4 definition string.
 *
 * Add more WKIDs as needed for other states/counties.
 */
function getProj4Definition(wkid: number): string {
  const wellKnown: Record<number, string> = {
    102100: 'EPSG:3857', // Web Mercator (most common)
    3857: 'EPSG:3857', // Web Mercator (alternative WKID)
    4326: 'EPSG:4326', // WGS84 (already target, but included for completeness)

    // Pennsylvania State Plane (for reference, not CA)
    102729:
      '+proj=lcc +lat_1=40.88333333333333 +lat_2=41.95 +lat_0=40.16666666666666 +lon_0=-77.75 +x_0=600000 +y_0=0 +datum=NAD83 +units=us-ft +no_defs',

    // Add California State Plane zones if needed:
    // 2226: NAD83 / California zone 2 (ftUS)
    // 2227: NAD83 / California zone 3 (ftUS)
    // etc.
  };

  if (wellKnown[wkid]) {
    return wellKnown[wkid];
  }

  // Fallback: throw error and ask engineer to add proj4 definition
  throw new Error(
    `Unknown WKID ${wkid}. Please add proj4 definition to getProj4Definition(). ` +
      `You can find definitions at https://epsg.io/${wkid}`
  );
}

// ============================================================================
// EXAMPLE 4: VALIDATE GEOJSON FEATURES
// ============================================================================

/**
 * Validate extracted GeoJSON features for correctness.
 *
 * Checks:
 * - Coordinate bounds (WGS84 range)
 * - Polygon closure (first point === last point)
 * - Required district field presence
 * - District number range
 *
 * @example
 * validateGeoJSONFeatures(features, {
 *   expectedCount: 5,
 *   requireDistrictField: 'DISTRICT',
 *   minDistrictNumber: 1,
 *   maxDistrictNumber: 5
 * });
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
  console.log(`[WebmapExtractor] Validating ${features.length} features...`);

  // Count check
  if (options.expectedCount && features.length !== options.expectedCount) {
    throw new Error(
      `Validation failed: Expected ${options.expectedCount} features, got ${features.length}`
    );
  }

  features.forEach((feature, idx) => {
    // Coordinate range check (WGS84: -180 to 180 longitude, -90 to 90 latitude)
    if (feature.geometry.type === 'Polygon') {
      const polygon = feature.geometry as GeoJSON.Polygon;
      const ring = polygon.coordinates[0]; // Outer ring

      ring.forEach((coord, coordIdx) => {
        const [lng, lat] = coord;

        if (Math.abs(lng) > 180) {
          throw new Error(
            `Validation failed: Feature ${idx}, coordinate ${coordIdx} has invalid longitude ${lng}. ` +
              `WGS84 longitude must be in range [-180, 180].`
          );
        }

        if (Math.abs(lat) > 90) {
          throw new Error(
            `Validation failed: Feature ${idx}, coordinate ${coordIdx} has invalid latitude ${lat}. ` +
              `WGS84 latitude must be in range [-90, 90].`
          );
        }
      });

      // Polygon closure check (first point must equal last point)
      const first = ring[0];
      const last = ring[ring.length - 1];

      if (first[0] !== last[0] || first[1] !== last[1]) {
        throw new Error(
          `Validation failed: Feature ${idx} polygon not closed. ` +
            `First point [${first}] does not match last point [${last}].`
        );
      }
    }

    // District field check
    if (options.requireDistrictField) {
      const districtValue =
        feature.properties?.[options.requireDistrictField];

      if (districtValue === undefined || districtValue === null) {
        throw new Error(
          `Validation failed: Feature ${idx} missing required field "${options.requireDistrictField}"`
        );
      }

      // District number range check
      if (typeof districtValue === 'number') {
        const min = options.minDistrictNumber ?? 1;
        const max = options.maxDistrictNumber ?? 99;

        if (districtValue < min || districtValue > max) {
          throw new Error(
            `Validation failed: Feature ${idx} has district number ${districtValue} ` +
              `outside valid range [${min}, ${max}]`
          );
        }
      }
    }
  });

  console.log(`[WebmapExtractor] ✓ Validation passed`);
}

// ============================================================================
// EXAMPLE 5: COMPLETE EXTRACTION PIPELINE
// ============================================================================

/**
 * Complete end-to-end extraction pipeline for webmap-based cities.
 *
 * @example
 * const claremont = await extractCouncilDistrictsFromWebmap({
 *   placeId: '0613756',
 *   placeName: 'Claremont, CA',
 *   webmapId: 'f9f59d55e7e2433b8d9a1af9f079ec82',
 *   targetLayerTitle: 'Adopted 2022-2030 Council Districts',
 *   expectedDistrictCount: 5,
 *   districtFieldName: 'DISTRICT'
 * });
 */
async function extractCouncilDistrictsFromWebmap(
  config: WebmapPortalConfig
): Promise<GeoJSON.FeatureCollection> {
  console.log(
    `[WebmapExtractor] Processing ${config.placeName} (${config.placeId})`
  );

  // Step 1: Fetch webmap JSON
  const webmap = await fetchWebmap(config.webmapId);

  // Step 2: Extract Esri features from target layer
  const esriFeatures = extractFeaturesFromWebmap(webmap, {
    webmapId: config.webmapId,
    targetLayerTitle: config.targetLayerTitle,
    expectedDistrictCount: config.expectedDistrictCount,
  });

  // Step 3: Get spatial reference from the feature set
  const targetLayer = webmap.operationalLayers.find((layer) => {
    if (typeof config.targetLayerTitle === 'string') {
      return layer.title === config.targetLayerTitle;
    } else {
      return config.targetLayerTitle.test(layer.title);
    }
  })!;

  const spatialRef =
    targetLayer.featureCollection!.layers[0].featureSet.spatialReference;

  console.log(
    `[WebmapExtractor] Source spatial reference: WKID ${spatialRef.wkid}`
  );

  // Step 4: Convert to GeoJSON with WGS84 coordinates
  const geoJsonFeatures = esriFeatures.map((f) =>
    esriToGeoJSON(f, spatialRef)
  );

  console.log(`[WebmapExtractor] ✓ Converted to WGS84 (EPSG:4326)`);

  // Step 5: Validate
  validateGeoJSONFeatures(geoJsonFeatures, {
    expectedCount: config.expectedDistrictCount,
    requireDistrictField: config.districtFieldName,
    minDistrictNumber: 1,
    maxDistrictNumber: 15, // Reasonable upper bound for council districts
  });

  // Step 6: Return GeoJSON FeatureCollection
  return {
    type: 'FeatureCollection',
    features: geoJsonFeatures,
  };
}

// ============================================================================
// EXAMPLE 6: USAGE WITH CLAREMONT AND MARTINEZ
// ============================================================================

/**
 * Extract Claremont CA council districts.
 */
async function extractClaremontDistricts(): Promise<GeoJSON.FeatureCollection> {
  return extractCouncilDistrictsFromWebmap({
    placeId: '0613756',
    placeName: 'Claremont, CA',
    webmapId: 'f9f59d55e7e2433b8d9a1af9f079ec82',
    targetLayerTitle: 'Adopted 2022-2030 Council Districts',
    expectedDistrictCount: 5,
    districtFieldName: 'DISTRICT',
  });
}

/**
 * Extract Martinez CA council districts.
 */
async function extractMartinezDistricts(): Promise<GeoJSON.FeatureCollection> {
  return extractCouncilDistrictsFromWebmap({
    placeId: '0646114',
    placeName: 'Martinez, CA',
    webmapId: '5eb9a43de95845d48c8d56773d023609',
    targetLayerTitle: 'Adopted Districts',
    expectedDistrictCount: 4,
    districtFieldName: 'DISTRICT',
  });
}

/**
 * Batch extract both cities.
 */
async function batchExtractCalifornia(): Promise<void> {
  console.log('=== Batch Extraction: California Webmap Cities ===\n');

  try {
    const [claremont, martinez] = await Promise.all([
      extractClaremontDistricts(),
      extractMartinezDistricts(),
    ]);

    console.log(`\n✓ Claremont: ${claremont.features.length} districts`);
    console.log(`✓ Martinez: ${martinez.features.length} districts`);
    console.log(`\n=== Extraction Complete ===`);

    // Save to files or return for further processing
    // await saveGeoJSON('./output/claremont-districts.geojson', claremont);
    // await saveGeoJSON('./output/martinez-districts.geojson', martinez);
  } catch (error) {
    console.error('Extraction failed:', error);
    throw error;
  }
}

// ============================================================================
// EXAMPLE 7: CACHING FOR PERFORMANCE
// ============================================================================

const webmapCache = new Map<
  string,
  { data: ArcGISWebMap; timestamp: number }
>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Cached version of fetchWebmap for improved performance.
 *
 * Webmaps rarely change, so caching reduces network requests.
 */
async function fetchWebmapCached(webmapId: string): Promise<ArcGISWebMap> {
  const cached = webmapCache.get(webmapId);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log(`[WebmapExtractor] Cache hit for webmap ${webmapId}`);
    return cached.data;
  }

  console.log(`[WebmapExtractor] Cache miss for webmap ${webmapId}, fetching...`);

  const data = await fetchWebmap(webmapId);
  webmapCache.set(webmapId, { data, timestamp: Date.now() });

  return data;
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  // Core functions
  fetchWebmap,
  extractFeaturesFromWebmap,
  esriToGeoJSON,
  validateGeoJSONFeatures,
  extractCouncilDistrictsFromWebmap,

  // City-specific extractors
  extractClaremontDistricts,
  extractMartinezDistricts,
  batchExtractCalifornia,

  // Utilities
  fetchWebmapCached,
  getProj4Definition,

  // Types
  type ArcGISWebMap,
  type OperationalLayer,
  type EsriFeature,
  type SpatialReference,
  type WebmapPortalConfig,
};
