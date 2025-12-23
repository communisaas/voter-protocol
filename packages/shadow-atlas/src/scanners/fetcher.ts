/**
 * GeoJSON Fetcher and Normalizer
 *
 * CRITICAL TYPE SAFETY: Converts various portal formats to RFC 7946 WGS84 GeoJSON.
 * Type errors here can corrupt the content-addressed artifact store.
 *
 * Supports: ArcGIS, Socrata, CKAN, raw GeoJSON
 */

import type {
  SourceKind,
  NormalizedGeoJSON,
  GeoJSONFeature,
  FetchResult,
  FetcherSourceMetadata,
} from '../types';

// Use FetcherSourceMetadata as the implementation of SourceMetadata for fetcher
type SourceMetadata = FetcherSourceMetadata;

/**
 * Fetch and normalize GeoJSON from any source type
 */
export async function fetchGeoJSON(
  kind: SourceKind,
  url: string,
  layerHint?: string | number
): Promise<FetchResult> {
  switch (kind) {
    case 'arcgis':
      return fetchArcGIS(url, layerHint);
    case 'socrata':
      return fetchSocrata(url);
    case 'ckan':
      return fetchCKAN(url);
    case 'geojson':
      return fetchRawGeoJSON(url);
    default:
      throw new Error(`Unsupported source kind: ${kind}`);
  }
}

/**
 * Fetch metadata only (for update checks)
 */
export async function fetchMetadataOnly(
  kind: SourceKind,
  url: string,
  layerHint?: string | number
): Promise<SourceMetadata> {
  switch (kind) {
    case 'arcgis':
      return fetchArcGISMetadata(url, layerHint);
    case 'socrata':
    case 'ckan':
    case 'geojson':
      return fetchHTTPMetadata(url);
    default:
      throw new Error(`Unsupported source kind: ${kind}`);
  }
}

// ============================================================================
// ArcGIS Feature Service
// ============================================================================

async function fetchArcGIS(url: string, layerHint?: string | number): Promise<FetchResult> {
  const layerId = layerHint !== undefined ? layerHint : 0;
  const queryUrl = `${url}/${layerId}/query?where=1=1&outFields=*&f=geojson&outSR=4326`;

  const resp = await fetch(queryUrl);
  if (!resp.ok) {
    throw new Error(`ArcGIS fetch failed: ${resp.status} ${resp.statusText}`);
  }

  const geojson = (await resp.json()) as NormalizedGeoJSON;

  // Get metadata from service info
  const meta = await fetchArcGISMetadata(url, layerId);

  return {
    data: normalizeGeoJSON(geojson),
    meta,
  };
}

async function fetchArcGISMetadata(url: string, layerHint?: string | number): Promise<SourceMetadata> {
  const layerId = layerHint !== undefined ? layerHint : 0;
  const infoUrl = `${url}/${layerId}?f=json`;

  const resp = await fetch(infoUrl);
  if (!resp.ok) {
    throw new Error(`ArcGIS metadata fetch failed: ${resp.status}`);
  }

  const data = (await resp.json()) as {
    editingInfo?: { lastEditDate: number };
  };

  return {
    etag: null,  // ArcGIS doesn't use ETags
    last_modified: null,
    last_edit_date: data.editingInfo?.lastEditDate || null,
  };
}

// ============================================================================
// Socrata
// ============================================================================

async function fetchSocrata(url: string): Promise<FetchResult> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Socrata fetch failed: ${resp.status} ${resp.statusText}`);
  }

  const geojson = (await resp.json()) as NormalizedGeoJSON;

  const meta: SourceMetadata = {
    etag: resp.headers.get('etag'),
    last_modified: resp.headers.get('last-modified'),
    last_edit_date: null,
  };

  return {
    data: normalizeGeoJSON(geojson),
    meta,
  };
}

// ============================================================================
// CKAN
// ============================================================================

async function fetchCKAN(url: string): Promise<FetchResult> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`CKAN fetch failed: ${resp.status} ${resp.statusText}`);
  }

  const geojson = (await resp.json()) as NormalizedGeoJSON;

  const meta: SourceMetadata = {
    etag: resp.headers.get('etag'),
    last_modified: resp.headers.get('last-modified'),
    last_edit_date: null,
  };

  return {
    data: normalizeGeoJSON(geojson),
    meta,
  };
}

// ============================================================================
// Raw GeoJSON
// ============================================================================

async function fetchRawGeoJSON(url: string): Promise<FetchResult> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`GeoJSON fetch failed: ${resp.status} ${resp.statusText}`);
  }

  const geojson = (await resp.json()) as NormalizedGeoJSON;

  const meta: SourceMetadata = {
    etag: resp.headers.get('etag'),
    last_modified: resp.headers.get('last-modified'),
    last_edit_date: null,
  };

  return {
    data: normalizeGeoJSON(geojson),
    meta,
  };
}

// ============================================================================
// HTTP Metadata
// ============================================================================

async function fetchHTTPMetadata(url: string): Promise<SourceMetadata> {
  const resp = await fetch(url, { method: 'HEAD' });
  if (!resp.ok) {
    throw new Error(`Metadata fetch failed: ${resp.status}`);
  }

  return {
    etag: resp.headers.get('etag'),
    last_modified: resp.headers.get('last-modified'),
    last_edit_date: null,
  };
}

// ============================================================================
// Normalization
// ============================================================================

/**
 * Normalize GeoJSON to RFC 7946 (WGS84, right-hand rule)
 *
 * CRITICAL: Ensures all artifacts are in standard format for Merkle tree hashing
 */
function normalizeGeoJSON(geojson: NormalizedGeoJSON): NormalizedGeoJSON {
  // Filter to polygon features only
  const polygonFeatures = geojson.features.filter(feature =>
    feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon'
  );

  // Sort features by ID (deterministic ordering for hashing)
  const sorted = polygonFeatures.sort((a, b) => {
    const aId = String(a.id || '');
    const bId = String(b.id || '');
    return aId.localeCompare(bId);
  });

  // Compute bounding box
  const bbox = computeBBox(sorted);

  return {
    type: 'FeatureCollection',
    features: sorted,
    bbox,
  };
}

/**
 * Compute bounding box [minLon, minLat, maxLon, maxLat]
 */
function computeBBox(
  features: readonly GeoJSONFeature[]
): [number, number, number, number] | undefined {
  if (features.length === 0) return undefined;

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  for (const feature of features) {
    const coords = extractCoordinates(feature.geometry);
    for (const [lon, lat] of coords) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }

  return [minLon, minLat, maxLon, maxLat];
}

/**
 * Extract all coordinates from geometry
 */
function extractCoordinates(
  geometry: GeoJSONFeature['geometry']
): [number, number][] {
  if (geometry.type === 'Polygon') {
    // Polygon: first ring only (exterior)
    return geometry.coordinates[0] as unknown as [number, number][];
  } else {
    // MultiPolygon: all exterior rings
    return geometry.coordinates.flatMap(polygon => polygon[0]) as unknown as [number, number][];
  }
}
