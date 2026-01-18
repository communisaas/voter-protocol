/**
 * Webmap Feature Collection Extractor
 *
 * PURPOSE: Extract GeoJSON features from ArcGIS webmap embedded feature collections.
 * Some cities embed district data directly in webmaps instead of hosting FeatureServers.
 *
 * ARCHITECTURE:
 * 1. Fetch webmap JSON from ArcGIS sharing API
 * 2. Parse operationalLayers to find target layer by name
 * 3. Extract featureCollection from layer
 * 4. Convert Web Mercator (EPSG:3857) → WGS84 (EPSG:4326)
 * 5. Return standard GeoJSON FeatureCollection
 *
 * COORDINATE CONVERSION:
 * ArcGIS webmaps typically use Web Mercator (WKID 102100/3857).
 * We convert to WGS84 for compatibility with the validation pipeline.
 */

import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface WebmapData {
  operationalLayers?: OperationalLayer[];
  baseMap?: unknown;
  version?: string;
}

interface OperationalLayer {
  id?: string;
  title?: string;
  featureCollection?: FeatureCollectionLayer;
  url?: string;
}

interface FeatureCollectionLayer {
  layers?: FeatureSetLayer[];
}

interface FeatureSetLayer {
  featureSet?: {
    features?: ArcGISFeature[];
    geometryType?: string;
  };
  layerDefinition?: {
    name?: string;
    geometryType?: string;
  };
}

interface ArcGISFeature {
  attributes?: Record<string, unknown>;
  geometry?: ArcGISGeometry;
}

interface ArcGISGeometry {
  rings?: number[][][];
  paths?: number[][][];
  points?: number[][];
  x?: number;
  y?: number;
  spatialReference?: { wkid?: number; latestWkid?: number };
}

export interface ExtractionResult {
  success: boolean;
  featureCollection?: FeatureCollection;
  featureCount?: number;
  error?: string;
  layerName?: string;
  spatialReference?: { from: number; to: number };
}

// ═══════════════════════════════════════════════════════════════════════════
// COORDINATE CONVERSION (Web Mercator → WGS84)
// ═══════════════════════════════════════════════════════════════════════════

const EARTH_RADIUS = 6378137; // meters (WGS84 semi-major axis)

/**
 * Convert Web Mercator (EPSG:3857) coordinates to WGS84 (EPSG:4326)
 */
function webMercatorToWgs84(x: number, y: number): [number, number] {
  const lng = (x / EARTH_RADIUS) * (180 / Math.PI);
  const lat = (Math.atan(Math.exp(y / EARTH_RADIUS)) * 2 - Math.PI / 2) * (180 / Math.PI);
  return [lng, lat];
}

/**
 * Convert a coordinate array, handling nested rings/paths
 */
function convertCoordinates(coords: number[] | number[][] | number[][][]): Position | Position[] | Position[][] {
  if (typeof coords[0] === 'number') {
    // Single coordinate [x, y]
    const [x, y] = coords as number[];
    return webMercatorToWgs84(x, y);
  }

  if (Array.isArray(coords[0]) && typeof (coords[0] as number[])[0] === 'number') {
    // Array of coordinates [[x,y], [x,y], ...]
    return (coords as number[][]).map(([x, y]) => webMercatorToWgs84(x, y));
  }

  // Nested array (rings/paths) [[[x,y], [x,y]], ...]
  return (coords as number[][][]).map((ring) =>
    ring.map(([x, y]) => webMercatorToWgs84(x, y))
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// GEOMETRY CONVERSION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert ArcGIS geometry to GeoJSON geometry
 */
function arcgisToGeoJSON(arcgisGeom: ArcGISGeometry, geometryType?: string): Geometry | null {
  if (arcgisGeom.rings) {
    // Polygon or MultiPolygon
    const rings = convertCoordinates(arcgisGeom.rings) as Position[][];
    if (rings.length === 1) {
      return { type: 'Polygon', coordinates: rings };
    }
    // Multiple rings - could be holes or multipolygon
    // For simplicity, treat as single polygon with holes
    return { type: 'Polygon', coordinates: rings };
  }

  if (arcgisGeom.paths) {
    // LineString or MultiLineString
    const paths = convertCoordinates(arcgisGeom.paths) as Position[][];
    if (paths.length === 1) {
      return { type: 'LineString', coordinates: paths[0] };
    }
    return { type: 'MultiLineString', coordinates: paths };
  }

  if (arcgisGeom.x !== undefined && arcgisGeom.y !== undefined) {
    // Point
    const [lng, lat] = webMercatorToWgs84(arcgisGeom.x, arcgisGeom.y);
    return { type: 'Point', coordinates: [lng, lat] };
  }

  if (arcgisGeom.points) {
    // MultiPoint
    const points = arcgisGeom.points.map(([x, y]) => webMercatorToWgs84(x, y));
    return { type: 'MultiPoint', coordinates: points };
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Find a layer in the webmap by name (case-insensitive partial match)
 */
function findLayer(
  webmap: WebmapData,
  layerNamePattern: string
): { layer: OperationalLayer; featureSet: FeatureSetLayer } | null {
  const pattern = layerNamePattern.toLowerCase();

  for (const opLayer of webmap.operationalLayers ?? []) {
    // Check layer title
    if (opLayer.title?.toLowerCase().includes(pattern)) {
      const featureSet = opLayer.featureCollection?.layers?.[0];
      if (featureSet?.featureSet?.features?.length) {
        return { layer: opLayer, featureSet };
      }
    }

    // Check nested layer definition name
    for (const fcLayer of opLayer.featureCollection?.layers ?? []) {
      if (fcLayer.layerDefinition?.name?.toLowerCase().includes(pattern)) {
        if (fcLayer.featureSet?.features?.length) {
          return { layer: opLayer, featureSet: fcLayer };
        }
      }
    }
  }

  return null;
}

/**
 * Extract council district features from an ArcGIS webmap
 *
 * @param webmapUrl - URL to webmap data JSON (e.g., arcgis.com/sharing/rest/content/items/{id}/data?f=json)
 * @param layerNamePattern - Partial name to match the target layer (e.g., "council district")
 */
export async function extractFromWebmap(
  webmapUrl: string,
  layerNamePattern: string
): Promise<ExtractionResult> {
  try {
    // Fetch webmap JSON
    const response = await fetch(webmapUrl);
    if (!response.ok) {
      return {
        success: false,
        error: `Failed to fetch webmap: HTTP ${response.status}`,
      };
    }

    const webmap: WebmapData = await response.json();

    // Find target layer
    const found = findLayer(webmap, layerNamePattern);
    if (!found) {
      // List available layers for debugging
      const available = (webmap.operationalLayers ?? [])
        .map((l) => l.title || 'untitled')
        .join(', ');
      return {
        success: false,
        error: `Layer "${layerNamePattern}" not found. Available: ${available}`,
      };
    }

    const { layer, featureSet } = found;
    const arcgisFeatures = featureSet.featureSet?.features ?? [];

    if (arcgisFeatures.length === 0) {
      return {
        success: false,
        error: `Layer "${layer.title}" has no features`,
      };
    }

    // Detect spatial reference
    const firstGeom = arcgisFeatures[0]?.geometry;
    const wkid = firstGeom?.spatialReference?.wkid ?? firstGeom?.spatialReference?.latestWkid ?? 102100;
    const needsConversion = wkid === 102100 || wkid === 3857;

    // Convert features
    const geoJsonFeatures: Feature[] = [];
    for (const arcFeature of arcgisFeatures) {
      if (!arcFeature.geometry) continue;

      let geometry: Geometry | null;
      if (needsConversion) {
        geometry = arcgisToGeoJSON(arcFeature.geometry, featureSet.featureSet?.geometryType);
      } else {
        // Assume already WGS84, just restructure
        geometry = arcgisToGeoJSON(arcFeature.geometry, featureSet.featureSet?.geometryType);
      }

      if (geometry) {
        geoJsonFeatures.push({
          type: 'Feature',
          properties: arcFeature.attributes ?? {},
          geometry,
        });
      }
    }

    const featureCollection: FeatureCollection = {
      type: 'FeatureCollection',
      features: geoJsonFeatures,
    };

    return {
      success: true,
      featureCollection,
      featureCount: geoJsonFeatures.length,
      layerName: layer.title ?? featureSet.layerDefinition?.name ?? 'unknown',
      spatialReference: needsConversion ? { from: wkid, to: 4326 } : { from: 4326, to: 4326 },
    };
  } catch (err) {
    return {
      success: false,
      error: `Extraction failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Build standard webmap data URL from item ID
 */
export function buildWebmapUrl(itemId: string): string {
  return `https://www.arcgis.com/sharing/rest/content/items/${itemId}/data?f=json`;
}
