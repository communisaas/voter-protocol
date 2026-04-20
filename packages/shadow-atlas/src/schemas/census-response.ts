/**
 * Census API Response Schemas
 *
 * SA-014: Zod schemas for validating US Census Bureau API responses.
 *
 * PURPOSE:
 * - Prevent JSON deserialization attacks via malformed responses
 * - Catch schema changes in upstream APIs early
 * - Type-safe access to response data
 *
 * APIS COVERED:
 * - TIGERweb REST Services (tigerweb.geo.census.gov)
 * - Census Data API (api.census.gov)
 * - Census FTP boundary files (www2.census.gov)
 *
 * TYPE SAFETY: Nuclear-level strictness. All external data validated before use.
 */

import { z } from 'zod';

// ============================================================================
// TIGERweb REST API Schemas (tigerweb.geo.census.gov)
// ============================================================================

/**
 * TIGERweb layer info schema
 *
 * Layer metadata from TIGERweb MapServer service.
 */
export const TIGERWebLayerInfoSchema = z.object({
  id: z.number().int().min(0),
  name: z.string().min(1).max(500),
  type: z.string().max(100).optional(),
  geometryType: z.string().max(50).optional(),
  description: z.string().max(10000).optional(),
  minScale: z.number().optional(),
  maxScale: z.number().optional(),
  defaultVisibility: z.boolean().optional(),
}).passthrough();

export type ValidatedTIGERWebLayerInfo = z.infer<typeof TIGERWebLayerInfoSchema>;

/**
 * TIGERweb service info response schema
 *
 * Response from: GET https://tigerweb.geo.census.gov/arcgis/rest/services/{service}/MapServer?f=json
 */
export const TIGERWebServiceInfoSchema = z.object({
  currentVersion: z.number().optional(),
  serviceDescription: z.string().max(10000).optional(),
  mapName: z.string().max(500).optional(),
  description: z.string().max(10000).optional(),
  copyrightText: z.string().max(2000).optional(),
  layers: z.array(TIGERWebLayerInfoSchema).max(500).optional(),
  tables: z.array(z.object({
    id: z.number().int().min(0),
    name: z.string().max(500),
  }).passthrough()).max(100).optional(),
  spatialReference: z.object({
    wkid: z.number().int().optional(),
    latestWkid: z.number().int().optional(),
  }).optional(),
  initialExtent: z.object({
    xmin: z.number(),
    ymin: z.number(),
    xmax: z.number(),
    ymax: z.number(),
    spatialReference: z.object({
      wkid: z.number().int().optional(),
    }).optional(),
  }).optional(),
  fullExtent: z.object({
    xmin: z.number(),
    ymin: z.number(),
    xmax: z.number(),
    ymax: z.number(),
    spatialReference: z.object({
      wkid: z.number().int().optional(),
    }).optional(),
  }).optional(),
}).passthrough();

export type ValidatedTIGERWebServiceInfo = z.infer<typeof TIGERWebServiceInfoSchema>;

/**
 * TIGERweb layer detail schema
 *
 * Response from: GET https://tigerweb.geo.census.gov/arcgis/rest/services/{service}/MapServer/{layer}?f=json
 */
export const TIGERWebLayerDetailSchema = z.object({
  id: z.number().int().min(0),
  name: z.string().min(1).max(500),
  type: z.string().max(100).optional(),
  geometryType: z.string().max(50).optional(),
  description: z.string().max(10000).optional(),
  displayField: z.string().max(100).optional(),
  fields: z.array(z.object({
    name: z.string().max(100),
    type: z.string().max(50),
    alias: z.string().max(200).optional(),
    length: z.number().int().optional(),
    domain: z.unknown().nullable().optional(),
  }).passthrough()).max(500).optional(),
  extent: z.object({
    xmin: z.number(),
    ymin: z.number(),
    xmax: z.number(),
    ymax: z.number(),
    spatialReference: z.object({
      wkid: z.number().int().optional(),
      latestWkid: z.number().int().optional(),
    }).optional(),
  }).optional(),
}).passthrough();

export type ValidatedTIGERWebLayerDetail = z.infer<typeof TIGERWebLayerDetailSchema>;

/**
 * TIGERweb query result feature schema
 */
export const TIGERWebFeatureSchema = z.object({
  attributes: z.record(z.unknown()),
  geometry: z.object({
    // Validate coordinate finiteness on ArcGIS native format (propagation).
    rings: z.array(z.array(z.tuple([z.number().finite(), z.number().finite()]))).optional(),
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    spatialReference: z.object({
      wkid: z.number().int().optional(),
    }).optional(),
  }).passthrough().optional(),
});

export type ValidatedTIGERWebFeature = z.infer<typeof TIGERWebFeatureSchema>;

/**
 * TIGERweb query response schema
 *
 * Response from: GET {layerUrl}/query?where=...&f=json
 */
export const TIGERWebQueryResponseSchema = z.object({
  objectIdFieldName: z.string().max(100).optional(),
  globalIdFieldName: z.string().max(100).optional(),
  geometryType: z.string().max(50).optional(),
  spatialReference: z.object({
    wkid: z.number().int().optional(),
    latestWkid: z.number().int().optional(),
  }).optional(),
  fields: z.array(z.object({
    name: z.string().max(100),
    type: z.string().max(50),
    alias: z.string().max(200).optional(),
  }).passthrough()).max(500).optional(),
  features: z.array(TIGERWebFeatureSchema).max(100000),
  exceededTransferLimit: z.boolean().optional(),
});

export type ValidatedTIGERWebQueryResponse = z.infer<typeof TIGERWebQueryResponseSchema>;

/**
 * TIGERweb GeoJSON query response schema
 *
 * Response from: GET {layerUrl}/query?where=...&f=geojson
 */
export const TIGERWebGeoJSONResponseSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(z.object({
    type: z.literal('Feature'),
    id: z.union([z.string(), z.number()]).optional(),
    geometry: z.object({
      type: z.union([z.literal('Polygon'), z.literal('MultiPolygon')]),
      // Validate coordinate finiteness (propagation — Census path was missed).
      coordinates: z.array(z.unknown()).refine(
        (arr) => { const chk = (v: unknown): boolean => { if (typeof v === 'number') return Number.isFinite(v); if (Array.isArray(v)) return v.every(chk); return true; }; return chk(arr); },
        'Coordinates must contain only finite numbers',
      ),
    }).nullable(),
    properties: z.record(z.unknown()).nullable(),
  })).max(100000),
  crs: z.object({
    type: z.string().optional(),
    properties: z.record(z.unknown()).optional(),
  }).optional(),
  // Add .finite() to bbox (propagation).
  bbox: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]).optional(),
});

export type ValidatedTIGERWebGeoJSONResponse = z.infer<typeof TIGERWebGeoJSONResponseSchema>;

// ============================================================================
// Census Data API Schemas (api.census.gov)
// ============================================================================

/**
 * Census Data API response schema
 *
 * Census Data API returns data as a 2D array where:
 * - First row is column headers
 * - Subsequent rows are data values
 *
 * Response from: GET https://api.census.gov/data/{year}/{dataset}?get=...
 */
export const CensusDataAPIResponseSchema = z.array(
  z.array(z.union([z.string(), z.number(), z.null()]))
).min(1).max(100000);

export type ValidatedCensusDataAPIResponse = z.infer<typeof CensusDataAPIResponseSchema>;

/**
 * Census Data API geography variables
 */
export const CensusGeographySchema = z.object({
  state: z.string().regex(/^\d{2}$/).optional(),
  county: z.string().regex(/^\d{3}$/).optional(),
  place: z.string().regex(/^\d{5}$/).optional(),
  tract: z.string().regex(/^\d{6}$/).optional(),
  'block group': z.string().regex(/^\d{1}$/).optional(),
});

export type ValidatedCensusGeography = z.infer<typeof CensusGeographySchema>;

// ============================================================================
// Census TIGER/Line Boundary Schemas
// ============================================================================

/**
 * TIGER/Line shapefile attribute schema
 *
 * Common attributes in TIGER/Line boundary files.
 */
export const TIGERLineAttributeSchema = z.object({
  // State FIPS code
  STATEFP: z.string().regex(/^\d{2}$/).optional(),
  // County FIPS code
  COUNTYFP: z.string().regex(/^\d{3}$/).optional(),
  // Place FIPS code
  PLACEFP: z.string().regex(/^\d{5}$/).optional(),
  // Congressional district
  CD116FP: z.string().optional(),
  CD118FP: z.string().optional(),
  // State legislative districts
  SLDUST: z.string().optional(),
  SLDLST: z.string().optional(),
  // Voting district
  VTDST: z.string().optional(),
  // Full GEOID
  GEOID: z.string().max(50).optional(),
  GEOID10: z.string().max(50).optional(),
  GEOID20: z.string().max(50).optional(),
  // Name
  NAME: z.string().max(200).optional(),
  NAMELSAD: z.string().max(200).optional(),
  // Area
  ALAND: z.number().optional(),
  AWATER: z.number().optional(),
  // Coordinates
  INTPTLAT: z.string().optional(),
  INTPTLON: z.string().optional(),
}).passthrough();

export type ValidatedTIGERLineAttribute = z.infer<typeof TIGERLineAttributeSchema>;

/**
 * TIGER/Line GeoJSON Feature schema
 */
export const TIGERLineFeatureSchema = z.object({
  type: z.literal('Feature'),
  properties: TIGERLineAttributeSchema.nullable(),
  geometry: z.object({
    type: z.union([z.literal('Polygon'), z.literal('MultiPolygon')]),
    // Validate coordinate finiteness (propagation — TIGER/Line path).
    coordinates: z.array(z.unknown()).refine(
      (arr) => { const chk = (v: unknown): boolean => { if (typeof v === 'number') return Number.isFinite(v); if (Array.isArray(v)) return v.every(chk); return true; }; return chk(arr); },
      'Coordinates must contain only finite numbers',
    ),
  }).nullable(),
});

export type ValidatedTIGERLineFeature = z.infer<typeof TIGERLineFeatureSchema>;

/**
 * TIGER/Line FeatureCollection schema
 *
 * Converted from shapefile to GeoJSON.
 */
export const TIGERLineFeatureCollectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(TIGERLineFeatureSchema).max(500000),
  // Add .finite() to bbox.
  bbox: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]).optional(),
});

export type ValidatedTIGERLineFeatureCollection = z.infer<typeof TIGERLineFeatureCollectionSchema>;

// ============================================================================
// Census Error Response Schemas
// ============================================================================

/**
 * ArcGIS REST API error response schema
 *
 * Error responses from Census/TIGER ArcGIS services.
 */
export const ArcGISErrorResponseSchema = z.object({
  error: z.object({
    code: z.number().int(),
    message: z.string().max(2000),
    details: z.array(z.string()).optional(),
  }),
});

export type ValidatedArcGISErrorResponse = z.infer<typeof ArcGISErrorResponseSchema>;

/**
 * Check if response is an ArcGIS error
 *
 * Use lightweight type guards instead of safeParse.
 * safeParse matches any object with { error: { code: number, message: string } },
 * which false-positives on valid GeoJSON FeatureCollections that happen to carry
 * an "error" property (same class as for Socrata).
 */
export function isArcGISError(data: unknown): data is ValidatedArcGISErrorResponse {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const obj = data as Record<string, unknown>;
  // ArcGIS errors have { error: { code: <number>, message: <string> } }.
  // Reject if the outer object looks like a FeatureCollection — that's valid GeoJSON, not an error.
  if (obj.type === 'FeatureCollection') {
    return false;
  }
  if (typeof obj.error === 'object' && obj.error !== null) {
    const err = obj.error as Record<string, unknown>;
    return typeof err.code === 'number' && typeof err.message === 'string';
  }
  return false;
}

// ============================================================================
// Validation Helper Functions
// ============================================================================

/**
 * Parse and validate TIGERweb service info response
 *
 * @param data - Raw JSON data
 * @returns Validated response
 * @throws ZodError if validation fails
 */
export function parseTIGERWebServiceInfo(data: unknown): ValidatedTIGERWebServiceInfo {
  return TIGERWebServiceInfoSchema.parse(data);
}

/**
 * Parse and validate TIGERweb layer detail response
 *
 * @param data - Raw JSON data
 * @returns Validated response
 * @throws ZodError if validation fails
 */
export function parseTIGERWebLayerDetail(data: unknown): ValidatedTIGERWebLayerDetail {
  return TIGERWebLayerDetailSchema.parse(data);
}

/**
 * Parse and validate TIGERweb query response
 *
 * @param data - Raw JSON data
 * @returns Validated response
 * @throws ZodError if validation fails
 */
export function parseTIGERWebQueryResponse(data: unknown): ValidatedTIGERWebQueryResponse {
  return TIGERWebQueryResponseSchema.parse(data);
}

/**
 * Parse and validate TIGERweb GeoJSON response
 *
 * @param data - Raw JSON data
 * @returns Validated response
 * @throws ZodError if validation fails
 */
export function parseTIGERWebGeoJSONResponse(data: unknown): ValidatedTIGERWebGeoJSONResponse {
  return TIGERWebGeoJSONResponseSchema.parse(data);
}

/**
 * Parse and validate Census Data API response
 *
 * @param data - Raw JSON data
 * @returns Validated response
 * @throws ZodError if validation fails
 */
export function parseCensusDataAPIResponse(data: unknown): ValidatedCensusDataAPIResponse {
  return CensusDataAPIResponseSchema.parse(data);
}

/**
 * Parse and validate TIGER/Line FeatureCollection
 *
 * @param data - Raw JSON data
 * @returns Validated response
 * @throws ZodError if validation fails
 */
export function parseTIGERLineFeatureCollection(data: unknown): ValidatedTIGERLineFeatureCollection {
  return TIGERLineFeatureCollectionSchema.parse(data);
}

/**
 * Safe parse with result type
 *
 * @param data - Raw JSON data
 * @param schema - Zod schema to validate against
 * @returns Validation result
 */
export function safeParseCensusResponse<T>(
  data: unknown,
  schema: z.ZodType<T>
): { success: true; data: T } | { success: false; error: string } {
  // Check for ArcGIS error first
  if (isArcGISError(data)) {
    return { success: false, error: `ArcGIS Error ${data.error.code}: ${data.error.message}` };
  }

  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errorMsg = result.error.errors[0]?.message ?? 'Schema validation failed';
  return { success: false, error: errorMsg };
}
