/**
 * ArcGIS API Response Schemas
 *
 * SA-014: Zod schemas for validating ArcGIS REST API and Hub API responses.
 *
 * PURPOSE:
 * - Prevent JSON deserialization attacks via malformed responses
 * - Catch schema changes in upstream APIs early
 * - Type-safe access to response data
 *
 * APIS COVERED:
 * - ArcGIS Hub API v3 (/api/v3/datasets, /api/v3/search)
 * - ArcGIS Portal REST API (/sharing/rest/search)
 * - ArcGIS Feature Server REST API (/FeatureServer, /MapServer)
 *
 * TYPE SAFETY: Nuclear-level strictness. All external data validated before use.
 */

import { z } from 'zod';

// ============================================================================
// ArcGIS Hub API Schemas (hub.arcgis.com/api/v3)
// ============================================================================

/**
 * Hub dataset attributes schema
 *
 * Validates the attributes object in Hub API dataset responses.
 * Uses .passthrough() to allow additional fields we don't care about.
 */
export const HubDatasetAttributesSchema = z.object({
  name: z.string().min(1).max(500),
  description: z.string().max(10000).nullable().optional(),
  url: z.string().url().optional(),
  serviceUrl: z.string().url().optional(),
  itemType: z.string().max(100).optional(),
  geometryType: z.string().max(50).optional(),
  recordCount: z.number().int().min(0).max(10000000).optional(),
  // Allow additional fields
}).passthrough();

export type ValidatedHubDatasetAttributes = z.infer<typeof HubDatasetAttributesSchema>;

/**
 * Hub dataset schema
 *
 * Single dataset object from Hub API.
 */
export const HubDatasetSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.string().max(50),
  attributes: HubDatasetAttributesSchema,
});

export type ValidatedHubDataset = z.infer<typeof HubDatasetSchema>;

/**
 * Hub API datasets response schema
 *
 * Response from: GET https://hub.arcgis.com/api/v3/datasets
 */
export const HubDatasetsResponseSchema = z.object({
  data: z.array(HubDatasetSchema).max(1000),
  meta: z.object({
    count: z.number().int().min(0).optional(),
    next: z.string().url().nullable().optional(),
  }).passthrough().optional(),
});

export type ValidatedHubDatasetsResponse = z.infer<typeof HubDatasetsResponseSchema>;

/**
 * Hub single dataset response schema
 *
 * Response from: GET https://hub.arcgis.com/api/v3/datasets/{id}
 */
export const HubSingleDatasetResponseSchema = z.object({
  data: z.object({
    id: z.string().min(1).max(100),
    type: z.string().max(50),
    attributes: z.object({
      name: z.string().min(1).max(500).optional(),
      description: z.string().max(10000).nullable().optional(),
      url: z.string().url().optional(),
      serviceUrl: z.string().url().optional(),
    }).passthrough(),
  }),
});

export type ValidatedHubSingleDatasetResponse = z.infer<typeof HubSingleDatasetResponseSchema>;

// ============================================================================
// ArcGIS Portal REST API Schemas (www.arcgis.com/sharing/rest)
// ============================================================================

/**
 * Portal search result item schema
 *
 * Single item from Portal search results.
 */
export const PortalSearchResultItemSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().min(1).max(500),
  description: z.string().max(10000).nullable().optional(),
  url: z.string().url().optional(),
  type: z.string().max(100),
  numViews: z.number().int().min(0).optional(),
  owner: z.string().max(200).optional(),
  created: z.number().int().optional(),
  modified: z.number().int().optional(),
}).passthrough();

export type ValidatedPortalSearchResultItem = z.infer<typeof PortalSearchResultItemSchema>;

/**
 * Portal search response schema
 *
 * Response from: GET https://www.arcgis.com/sharing/rest/search
 */
export const PortalSearchResponseSchema = z.object({
  results: z.array(PortalSearchResultItemSchema).max(1000),
  total: z.number().int().min(0).optional(),
  start: z.number().int().min(0).optional(),
  num: z.number().int().min(0).optional(),
  nextStart: z.number().int().min(-1).optional(),
});

export type ValidatedPortalSearchResponse = z.infer<typeof PortalSearchResponseSchema>;

// ============================================================================
// ArcGIS Feature/Map Server REST API Schemas
// ============================================================================

/**
 * Layer info schema
 *
 * Layer metadata from service info endpoint.
 */
export const ArcGISLayerInfoSchema = z.object({
  id: z.number().int().min(0),
  name: z.string().min(1).max(500),
  type: z.string().max(100).optional(),
  geometryType: z.string().max(50).optional(),
  description: z.string().max(10000).optional(),
  minScale: z.number().optional(),
  maxScale: z.number().optional(),
}).passthrough();

export type ValidatedArcGISLayerInfo = z.infer<typeof ArcGISLayerInfoSchema>;

/**
 * Service info response schema
 *
 * Response from: GET {serviceUrl}?f=json
 * Works for both MapServer and FeatureServer.
 */
export const ArcGISServiceInfoSchema = z.object({
  currentVersion: z.number().optional(),
  serviceDescription: z.string().max(10000).optional(),
  mapName: z.string().max(500).optional(),
  name: z.string().max(500).optional(),
  description: z.string().max(10000).optional(),
  layers: z.array(ArcGISLayerInfoSchema).max(1000).optional(),
  tables: z.array(z.object({
    id: z.number().int().min(0),
    name: z.string().max(500),
  }).passthrough()).max(100).optional(),
}).passthrough();

export type ValidatedArcGISServiceInfo = z.infer<typeof ArcGISServiceInfoSchema>;

/**
 * Layer detail response schema
 *
 * Response from: GET {serviceUrl}/{layerId}?f=json
 */
export const ArcGISLayerDetailSchema = z.object({
  id: z.number().int().min(0),
  name: z.string().min(1).max(500),
  type: z.string().max(100).optional(),
  geometryType: z.string().max(50).optional(),
  description: z.string().max(10000).optional(),
  fields: z.array(z.object({
    name: z.string().max(100),
    type: z.string().max(50),
    alias: z.string().max(200).optional(),
  }).passthrough()).max(500).optional(),
  editingInfo: z.object({
    lastEditDate: z.number().optional(),
  }).optional(),
}).passthrough();

export type ValidatedArcGISLayerDetail = z.infer<typeof ArcGISLayerDetailSchema>;

/**
 * Folder listing response schema
 *
 * Response from: GET {baseUrl}/rest/services?f=json
 * or: GET {baseUrl}/rest/services/{folder}?f=json
 */
export const ArcGISFolderListingSchema = z.object({
  currentVersion: z.number().optional(),
  folders: z.array(z.string().max(200)).max(500).optional(),
  services: z.array(z.object({
    name: z.string().max(500),
    type: z.string().max(50),
  })).max(1000).optional(),
}).passthrough();

export type ValidatedArcGISFolderListing = z.infer<typeof ArcGISFolderListingSchema>;

// ============================================================================
// ArcGIS GeoJSON Response Schemas
// ============================================================================

/**
 * GeoJSON position (coordinate pair)
 * Reject Infinity/NaN — invalid coordinates should not pass validation.
 */
const GeoJSONPositionSchema = z.tuple([
  z.number().finite(), // longitude
  z.number().finite(), // latitude
]).rest(z.number().finite()); // optional altitude

/**
 * GeoJSON linear ring (for polygons)
 */
const GeoJSONLinearRingSchema = z.array(GeoJSONPositionSchema).min(4);

/**
 * GeoJSON Polygon geometry
 */
export const GeoJSONPolygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(GeoJSONLinearRingSchema).min(1).max(100),
});

/**
 * GeoJSON MultiPolygon geometry
 */
export const GeoJSONMultiPolygonSchema = z.object({
  type: z.literal('MultiPolygon'),
  coordinates: z.array(z.array(GeoJSONLinearRingSchema).min(1).max(100)).min(1).max(1000),
});

/**
 * GeoJSON geometry (Polygon or MultiPolygon)
 */
export const GeoJSONGeometrySchema = z.union([
  GeoJSONPolygonSchema,
  GeoJSONMultiPolygonSchema,
]);

/**
 * GeoJSON Feature schema
 */
export const GeoJSONFeatureSchema = z.object({
  type: z.literal('Feature'),
  id: z.union([z.string(), z.number()]).optional(),
  geometry: GeoJSONGeometrySchema.nullable(),
  properties: z.record(z.unknown()).nullable(),
});

export type ValidatedGeoJSONFeature = z.infer<typeof GeoJSONFeatureSchema>;

/**
 * GeoJSON FeatureCollection schema
 *
 * Response from: GET {layerUrl}/query?f=geojson
 */
export const ArcGISGeoJSONResponseSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(GeoJSONFeatureSchema).max(100000),
  // Add .finite() to bbox (propagation).
  bbox: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]).optional(),
});

export type ValidatedArcGISGeoJSONResponse = z.infer<typeof ArcGISGeoJSONResponseSchema>;

// ============================================================================
// Validation Helper Functions
// ============================================================================

/**
 * Parse and validate Hub datasets response
 *
 * @param data - Raw JSON data
 * @returns Validated response
 * @throws ZodError if validation fails
 */
export function parseHubDatasetsResponse(data: unknown): ValidatedHubDatasetsResponse {
  return HubDatasetsResponseSchema.parse(data);
}

/**
 * Parse and validate Hub single dataset response
 *
 * @param data - Raw JSON data
 * @returns Validated response
 * @throws ZodError if validation fails
 */
export function parseHubSingleDatasetResponse(data: unknown): ValidatedHubSingleDatasetResponse {
  return HubSingleDatasetResponseSchema.parse(data);
}

/**
 * Parse and validate Portal search response
 *
 * @param data - Raw JSON data
 * @returns Validated response
 * @throws ZodError if validation fails
 */
export function parsePortalSearchResponse(data: unknown): ValidatedPortalSearchResponse {
  return PortalSearchResponseSchema.parse(data);
}

/**
 * Parse and validate ArcGIS service info response
 *
 * @param data - Raw JSON data
 * @returns Validated response
 * @throws ZodError if validation fails
 */
export function parseArcGISServiceInfo(data: unknown): ValidatedArcGISServiceInfo {
  return ArcGISServiceInfoSchema.parse(data);
}

/**
 * Parse and validate ArcGIS layer detail response
 *
 * @param data - Raw JSON data
 * @returns Validated response
 * @throws ZodError if validation fails
 */
export function parseArcGISLayerDetail(data: unknown): ValidatedArcGISLayerDetail {
  return ArcGISLayerDetailSchema.parse(data);
}

/**
 * Parse and validate ArcGIS folder listing response
 *
 * @param data - Raw JSON data
 * @returns Validated response
 * @throws ZodError if validation fails
 */
export function parseArcGISFolderListing(data: unknown): ValidatedArcGISFolderListing {
  return ArcGISFolderListingSchema.parse(data);
}

/**
 * Parse and validate ArcGIS GeoJSON response
 *
 * @param data - Raw JSON data
 * @returns Validated response
 * @throws ZodError if validation fails
 */
export function parseArcGISGeoJSONResponse(data: unknown): ValidatedArcGISGeoJSONResponse {
  return ArcGISGeoJSONResponseSchema.parse(data);
}

/**
 * Safe parse with result type
 *
 * @param data - Raw JSON data
 * @param schema - Zod schema to validate against
 * @returns Validation result
 */
export function safeParseArcGISResponse<T>(
  data: unknown,
  schema: z.ZodType<T>
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errorMsg = result.error.errors[0]?.message ?? 'Schema validation failed';
  return { success: false, error: errorMsg };
}
