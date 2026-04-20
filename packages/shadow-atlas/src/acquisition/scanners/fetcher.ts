/**
 * GeoJSON Fetcher and Normalizer
 *
 * CRITICAL TYPE SAFETY: Converts various portal formats to RFC 7946 WGS84 GeoJSON.
 * Type errors here can corrupt the content-addressed artifact store.
 *
 * SECURITY: All URLs are validated against the allowlist before fetching.
 * See SA-009 for details on the SSRF vulnerability this addresses.
 *
 * Supports: ArcGIS, Socrata, CKAN, raw GeoJSON
 */

import type {
  SourceKind,
  NormalizedGeoJSON,
  GeoJSONFeature,
  FetchResult,
  FetcherSourceMetadata,
} from '../../core/types.js';
import { extractExteriorCoordinates } from '../../core/geo-utils.js';
import { secureFetchAllowlisted, secureFetch, type SecureFetchOptions } from '../../security/secure-fetch.js';
import { logger } from '../../core/utils/logger.js';
// SA-014: Schema validation for external API responses
import {
  ArcGISGeoJSONResponseSchema,
  ArcGISLayerDetailSchema,
  safeParseArcGISResponse,
} from '../../schemas/arcgis-response.js';
import {
  SocrataGeoJSONResponseSchema,
  safeParseSocrataResponse,
} from '../../schemas/socrata-response.js';

// Use FetcherSourceMetadata as the implementation of SourceMetadata for fetcher
type SourceMetadata = FetcherSourceMetadata;

/**
 * Options for GeoJSON fetching
 */
export interface FetchGeoJSONOptions {
  /**
   * Bypass URL allowlist validation
   *
   * SECURITY: Only use when operators explicitly configure custom data sources.
   * The URL must still pass public IP validation (no private IPs, no localhost).
   *
   * @default false
   */
  readonly bypassAllowlist?: boolean;

  /**
   * Reason for bypassing allowlist (required when bypassAllowlist is true)
   * This is logged for security audit purposes.
   */
  readonly bypassReason?: string;

  /**
   * Request timeout in milliseconds
   * @default 30000
   */
  readonly timeout?: number;
}

/**
 * Fetch and normalize GeoJSON from any source type
 *
 * SECURITY: All URLs are validated against the allowlist before fetching.
 * Use bypassAllowlist option only for operator-configured sources.
 *
 * @param kind - Source type (arcgis, socrata, ckan, geojson)
 * @param url - URL to fetch from
 * @param layerHint - Optional layer ID for ArcGIS sources
 * @param options - Fetch options including allowlist bypass
 */
export async function fetchGeoJSON(
  kind: SourceKind,
  url: string,
  layerHint?: string | number,
  options: FetchGeoJSONOptions = {}
): Promise<FetchResult> {
  switch (kind) {
    case 'arcgis':
      return fetchArcGIS(url, layerHint, options);
    case 'socrata':
      return fetchSocrata(url, options);
    case 'ckan':
      return fetchCKAN(url, options);
    case 'geojson':
      return fetchRawGeoJSON(url, options);
    default:
      throw new Error(`Unsupported source kind: ${kind}`);
  }
}

/**
 * Fetch metadata only (for update checks)
 *
 * SECURITY: URLs are validated before fetching.
 */
export async function fetchMetadataOnly(
  kind: SourceKind,
  url: string,
  layerHint?: string | number,
  options: FetchGeoJSONOptions = {}
): Promise<SourceMetadata> {
  switch (kind) {
    case 'arcgis':
      return fetchArcGISMetadata(url, layerHint, options);
    case 'socrata':
    case 'ckan':
    case 'geojson':
      return fetchHTTPMetadata(url, options);
    default:
      throw new Error(`Unsupported source kind: ${kind}`);
  }
}

// ============================================================================
// ArcGIS Feature Service
// ============================================================================

async function fetchArcGIS(
  url: string,
  layerHint?: string | number,
  options: FetchGeoJSONOptions = {}
): Promise<FetchResult> {
  const layerId = layerHint !== undefined ? layerHint : 0;
  const queryUrl = `${url}/${layerId}/query?where=1=1&outFields=*&f=geojson&outSR=4326`;

  // SECURITY: Validate URL before fetching (SA-009)
  const fetchOpts: SecureFetchOptions = {
    timeout: options.timeout ?? 30000,
    bypassAllowlist: options.bypassAllowlist,
    bypassReason: options.bypassReason,
  };

  const result = await secureFetch(queryUrl, fetchOpts);
  if (!result.validated) {
    throw new Error(`ArcGIS URL not allowed: ${result.error}`);
  }
  if (!result.response) {
    throw new Error(`ArcGIS fetch failed: ${result.error}`);
  }
  if (!result.response.ok) {
    throw new Error(`ArcGIS fetch failed: ${result.response.status} ${result.response.statusText}`);
  }

  // SA-014: Validate JSON response against schema before use
  const rawJson = await result.response.json();
  const parseResult = safeParseArcGISResponse(rawJson, ArcGISGeoJSONResponseSchema);
  if (!parseResult.success) {
    const errorMsg = 'error' in parseResult ? parseResult.error : 'Schema validation failed';
    logger.warn('ArcGIS GeoJSON response failed schema validation', {
      url: url.substring(0, 100),
      error: errorMsg,
    });
    throw new Error(`ArcGIS response validation failed: ${errorMsg}`);
  }

  // Convert validated response to internal type
  const geojson = parseResult.data as unknown as NormalizedGeoJSON;

  // Get metadata from service info
  const meta = await fetchArcGISMetadata(url, layerId, options);

  return {
    data: normalizeGeoJSON(geojson),
    meta,
  };
}

async function fetchArcGISMetadata(
  url: string,
  layerHint?: string | number,
  options: FetchGeoJSONOptions = {}
): Promise<SourceMetadata> {
  const layerId = layerHint !== undefined ? layerHint : 0;
  const infoUrl = `${url}/${layerId}?f=json`;

  // SECURITY: Validate URL before fetching (SA-009)
  const fetchOpts: SecureFetchOptions = {
    timeout: options.timeout ?? 30000,
    bypassAllowlist: options.bypassAllowlist,
    bypassReason: options.bypassReason,
  };

  const result = await secureFetch(infoUrl, fetchOpts);
  if (!result.validated) {
    throw new Error(`ArcGIS metadata URL not allowed: ${result.error}`);
  }
  if (!result.response) {
    throw new Error(`ArcGIS metadata fetch failed: ${result.error}`);
  }
  if (!result.response.ok) {
    throw new Error(`ArcGIS metadata fetch failed: ${result.response.status}`);
  }

  // SA-014: Validate JSON response against schema before use
  const rawJson = await result.response.json();
  const parseResult = safeParseArcGISResponse(rawJson, ArcGISLayerDetailSchema);
  if (!parseResult.success) {
    const errorMsg = 'error' in parseResult ? parseResult.error : 'Schema validation failed';
    logger.warn('ArcGIS metadata response failed schema validation', {
      url: infoUrl.substring(0, 100),
      error: errorMsg,
    });
    // Return empty metadata rather than throwing for metadata failures
    return {
      etag: null,
      last_modified: null,
      last_edit_date: null,
    };
  }

  return {
    etag: null,  // ArcGIS doesn't use ETags
    last_modified: null,
    last_edit_date: parseResult.data.editingInfo?.lastEditDate ?? null,
  };
}

// ============================================================================
// Socrata
// ============================================================================

async function fetchSocrata(
  url: string,
  options: FetchGeoJSONOptions = {}
): Promise<FetchResult> {
  // SECURITY: Validate URL before fetching (SA-009)
  const fetchOpts: SecureFetchOptions = {
    timeout: options.timeout ?? 30000,
    bypassAllowlist: options.bypassAllowlist,
    bypassReason: options.bypassReason,
  };

  const result = await secureFetch(url, fetchOpts);
  if (!result.validated) {
    throw new Error(`Socrata URL not allowed: ${result.error}`);
  }
  if (!result.response) {
    throw new Error(`Socrata fetch failed: ${result.error}`);
  }
  if (!result.response.ok) {
    throw new Error(`Socrata fetch failed: ${result.response.status} ${result.response.statusText}`);
  }

  // SA-014: Validate JSON response against schema before use
  const rawJson = await result.response.json();
  const parseResult = safeParseSocrataResponse(rawJson, SocrataGeoJSONResponseSchema);
  if (!parseResult.success) {
    const errorMsg = 'error' in parseResult ? parseResult.error : 'Schema validation failed';
    logger.warn('Socrata GeoJSON response failed schema validation', {
      url: url.substring(0, 100),
      error: errorMsg,
    });
    throw new Error(`Socrata response validation failed: ${errorMsg}`);
  }

  // Convert validated response to internal type
  const geojson = parseResult.data as unknown as NormalizedGeoJSON;

  const meta: SourceMetadata = {
    etag: result.response.headers.get('etag'),
    last_modified: result.response.headers.get('last-modified'),
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

async function fetchCKAN(
  url: string,
  options: FetchGeoJSONOptions = {}
): Promise<FetchResult> {
  // SECURITY: Validate URL before fetching (SA-009)
  const fetchOpts: SecureFetchOptions = {
    timeout: options.timeout ?? 30000,
    bypassAllowlist: options.bypassAllowlist,
    bypassReason: options.bypassReason,
  };

  const result = await secureFetch(url, fetchOpts);
  if (!result.validated) {
    throw new Error(`CKAN URL not allowed: ${result.error}`);
  }
  if (!result.response) {
    throw new Error(`CKAN fetch failed: ${result.error}`);
  }
  if (!result.response.ok) {
    throw new Error(`CKAN fetch failed: ${result.response.status} ${result.response.statusText}`);
  }

  // SA-014: Validate JSON response against schema before use
  // CKAN returns standard GeoJSON, so we use the ArcGIS schema which validates GeoJSON structure
  const rawJson = await result.response.json();
  const parseResult = safeParseArcGISResponse(rawJson, ArcGISGeoJSONResponseSchema);
  if (!parseResult.success) {
    const errorMsg = 'error' in parseResult ? parseResult.error : 'Schema validation failed';
    logger.warn('CKAN GeoJSON response failed schema validation', {
      url: url.substring(0, 100),
      error: errorMsg,
    });
    throw new Error(`CKAN response validation failed: ${errorMsg}`);
  }

  // Convert validated response to internal type
  const geojson = parseResult.data as unknown as NormalizedGeoJSON;

  const meta: SourceMetadata = {
    etag: result.response.headers.get('etag'),
    last_modified: result.response.headers.get('last-modified'),
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

async function fetchRawGeoJSON(
  url: string,
  options: FetchGeoJSONOptions = {}
): Promise<FetchResult> {
  // SECURITY: Validate URL before fetching (SA-009)
  const fetchOpts: SecureFetchOptions = {
    timeout: options.timeout ?? 30000,
    bypassAllowlist: options.bypassAllowlist,
    bypassReason: options.bypassReason,
  };

  const result = await secureFetch(url, fetchOpts);
  if (!result.validated) {
    throw new Error(`GeoJSON URL not allowed: ${result.error}`);
  }
  if (!result.response) {
    throw new Error(`GeoJSON fetch failed: ${result.error}`);
  }
  if (!result.response.ok) {
    throw new Error(`GeoJSON fetch failed: ${result.response.status} ${result.response.statusText}`);
  }

  // SA-014: Validate JSON response against schema before use
  const rawJson = await result.response.json();
  const parseResult = safeParseArcGISResponse(rawJson, ArcGISGeoJSONResponseSchema);
  if (!parseResult.success) {
    const errorMsg = 'error' in parseResult ? parseResult.error : 'Schema validation failed';
    logger.warn('Raw GeoJSON response failed schema validation', {
      url: url.substring(0, 100),
      error: errorMsg,
    });
    throw new Error(`GeoJSON response validation failed: ${errorMsg}`);
  }

  // Convert validated response to internal type
  const geojson = parseResult.data as unknown as NormalizedGeoJSON;

  const meta: SourceMetadata = {
    etag: result.response.headers.get('etag'),
    last_modified: result.response.headers.get('last-modified'),
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

async function fetchHTTPMetadata(
  url: string,
  options: FetchGeoJSONOptions = {}
): Promise<SourceMetadata> {
  // SECURITY: Validate URL before fetching (SA-009)
  const fetchOpts: SecureFetchOptions = {
    method: 'HEAD',
    timeout: options.timeout ?? 30000,
    bypassAllowlist: options.bypassAllowlist,
    bypassReason: options.bypassReason,
  };

  const result = await secureFetch(url, fetchOpts);
  if (!result.validated) {
    throw new Error(`Metadata URL not allowed: ${result.error}`);
  }
  if (!result.response) {
    throw new Error(`Metadata fetch failed: ${result.error}`);
  }
  if (!result.response.ok) {
    throw new Error(`Metadata fetch failed: ${result.response.status}`);
  }

  return {
    etag: result.response.headers.get('etag'),
    last_modified: result.response.headers.get('last-modified'),
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
  // Guard against null geometry (valid per RFC 7946 §3.2,
  // allowed by GeoJSONFeatureSchema.nullable()). Accessing.type on null throws.
  const polygonFeatures = geojson.features.filter(feature =>
    feature.geometry != null &&
    (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon')
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
    // Type cast needed: GeoJSONGeometry uses readonly types, but extractExteriorCoordinates handles it
    const coords = extractExteriorCoordinates(feature.geometry as any);
    for (const [lon, lat] of coords) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }

  return [minLon, minLat, maxLon, maxLat];
}

// extractCoordinates removed - using extractExteriorCoordinates from geo-utils.ts
