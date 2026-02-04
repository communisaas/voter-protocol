/**
 * Socrata API Response Schemas
 *
 * SA-014: Zod schemas for validating Socrata Open Data API responses.
 *
 * PURPOSE:
 * - Prevent JSON deserialization attacks via malformed responses
 * - Catch schema changes in upstream APIs early
 * - Type-safe access to response data
 *
 * APIS COVERED:
 * - Socrata Discovery API (api.us.socrata.com/api/catalog/v1)
 * - Socrata Open Data API (SODA) for individual datasets
 * - City-specific Socrata portals (data.seattle.gov, data.cityofchicago.org, etc.)
 *
 * TYPE SAFETY: Nuclear-level strictness. All external data validated before use.
 */

import { z } from 'zod';

// ============================================================================
// Socrata Discovery API Schemas (api.us.socrata.com)
// ============================================================================

/**
 * Socrata resource distribution schema
 *
 * Download format information for a dataset.
 */
export const SocrataDistributionSchema = z.object({
  downloadURL: z.string().url().optional(),
  mediaType: z.string().max(100).optional(),
  format: z.string().max(50).optional(),
  description: z.string().max(1000).optional(),
}).passthrough();

export type ValidatedSocrataDistribution = z.infer<typeof SocrataDistributionSchema>;

/**
 * Socrata resource (dataset) schema
 *
 * Core dataset metadata from Discovery API.
 */
export const SocrataResourceSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(500),
  description: z.string().max(10000).nullable().optional(),
  type: z.string().max(50).optional(),
  updatedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime().optional(),
  distribution: z.array(SocrataDistributionSchema).max(20).optional(),
  // Additional metadata
  attribution: z.string().max(500).optional(),
  category: z.string().max(200).optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
  columns: z.array(z.object({
    name: z.string().max(100),
    fieldName: z.string().max(100).optional(),
    dataTypeName: z.string().max(50).optional(),
    description: z.string().max(1000).optional(),
  }).passthrough()).max(500).optional(),
}).passthrough();

export type ValidatedSocrataResource = z.infer<typeof SocrataResourceSchema>;

/**
 * Socrata classification schema
 */
export const SocrataClassificationSchema = z.object({
  domain_tags: z.array(z.string().max(100)).max(50).optional(),
  domain_metadata: z.array(z.object({
    key: z.string().max(100),
    value: z.string().max(500),
  })).max(100).optional(),
  categories: z.array(z.string().max(200)).max(20).optional(),
}).passthrough();

export type ValidatedSocrataClassification = z.infer<typeof SocrataClassificationSchema>;

/**
 * Socrata metadata schema
 */
export const SocrataMetadataSchema = z.object({
  domain: z.string().max(200).optional(),
}).passthrough();

export type ValidatedSocrataMetadata = z.infer<typeof SocrataMetadataSchema>;

/**
 * Socrata search result item schema
 *
 * Single result from Discovery API search.
 */
export const SocrataSearchResultSchema = z.object({
  resource: SocrataResourceSchema,
  classification: SocrataClassificationSchema.optional(),
  metadata: SocrataMetadataSchema.optional(),
  permalink: z.string().url().optional(),
  link: z.string().url().optional(),
});

export type ValidatedSocrataSearchResult = z.infer<typeof SocrataSearchResultSchema>;

/**
 * Socrata Discovery API response schema
 *
 * Response from: GET https://api.us.socrata.com/api/catalog/v1?q=...
 */
export const SocrataDiscoveryResponseSchema = z.object({
  results: z.array(SocrataSearchResultSchema).max(1000),
  resultSetSize: z.number().int().min(0).optional(),
  timings: z.object({
    searchMillis: z.number().optional(),
    fetchMillis: z.number().optional(),
  }).passthrough().optional(),
});

export type ValidatedSocrataDiscoveryResponse = z.infer<typeof SocrataDiscoveryResponseSchema>;

// ============================================================================
// Socrata Domain Catalog Schemas (data.{city}.gov)
// ============================================================================

/**
 * Socrata domain catalog resource schema
 *
 * Resource metadata from city-specific catalog endpoint.
 */
export const SocrataDomainResourceSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(500),
  description: z.string().max(10000).nullable().optional(),
  attribution: z.string().max(500).optional(),
  category: z.string().max(200).optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
  updatedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime().optional(),
  domain: z.string().max(200).optional(),
  distribution: z.array(SocrataDistributionSchema).max(20).optional(),
}).passthrough();

export type ValidatedSocrataDomainResource = z.infer<typeof SocrataDomainResourceSchema>;

/**
 * Socrata domain catalog search result schema
 */
export const SocrataDomainSearchResultSchema = z.object({
  resource: SocrataDomainResourceSchema,
  permalink: z.string().url().optional(),
  link: z.string().url().optional(),
});

export type ValidatedSocrataDomainSearchResult = z.infer<typeof SocrataDomainSearchResultSchema>;

/**
 * Socrata domain catalog response schema
 *
 * Response from: GET https://data.{city}.gov/api/catalog/v1?q=...
 */
export const SocrataDomainCatalogResponseSchema = z.object({
  results: z.array(SocrataDomainSearchResultSchema).max(1000),
  resultSetSize: z.number().int().min(0).optional(),
});

export type ValidatedSocrataDomainCatalogResponse = z.infer<typeof SocrataDomainCatalogResponseSchema>;

// ============================================================================
// Socrata SODA API Schemas (GeoJSON responses)
// ============================================================================

/**
 * Socrata GeoJSON Feature schema
 *
 * GeoJSON feature from SODA API.
 */
export const SocrataGeoJSONFeatureSchema = z.object({
  type: z.literal('Feature'),
  geometry: z.object({
    type: z.union([
      z.literal('Point'),
      z.literal('LineString'),
      z.literal('Polygon'),
      z.literal('MultiPoint'),
      z.literal('MultiLineString'),
      z.literal('MultiPolygon'),
    ]),
    coordinates: z.array(z.unknown()), // Complex nested structure
  }).nullable(),
  properties: z.record(z.unknown()).nullable(),
});

export type ValidatedSocrataGeoJSONFeature = z.infer<typeof SocrataGeoJSONFeatureSchema>;

/**
 * Socrata GeoJSON response schema
 *
 * Response from: GET https://data.{city}.gov/resource/{id}.geojson
 */
export const SocrataGeoJSONResponseSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(SocrataGeoJSONFeatureSchema).max(100000),
  crs: z.object({
    type: z.string().optional(),
    properties: z.record(z.unknown()).optional(),
  }).optional(),
});

export type ValidatedSocrataGeoJSONResponse = z.infer<typeof SocrataGeoJSONResponseSchema>;

// ============================================================================
// Socrata SODA API Schemas (JSON responses)
// ============================================================================

/**
 * Socrata JSON row schema
 *
 * Single row from SODA API JSON response.
 * Uses record type since columns vary by dataset.
 */
export const SocrataJSONRowSchema = z.record(z.unknown());

export type ValidatedSocrataJSONRow = z.infer<typeof SocrataJSONRowSchema>;

/**
 * Socrata JSON response schema
 *
 * Response from: GET https://data.{city}.gov/resource/{id}.json
 */
export const SocrataJSONResponseSchema = z.array(SocrataJSONRowSchema).max(100000);

export type ValidatedSocrataJSONResponse = z.infer<typeof SocrataJSONResponseSchema>;

// ============================================================================
// Socrata Dataset Metadata Schemas
// ============================================================================

/**
 * Socrata dataset metadata schema
 *
 * Full metadata for a single dataset.
 * Response from: GET https://data.{city}.gov/api/views/{id}.json
 */
export const SocrataDatasetMetadataSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(500),
  description: z.string().max(10000).nullable().optional(),
  attribution: z.string().max(500).optional(),
  category: z.string().max(200).optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
  rowsUpdatedAt: z.number().int().optional(),
  createdAt: z.number().int().optional(),
  viewType: z.string().max(50).optional(),
  displayType: z.string().max(50).optional(),
  columns: z.array(z.object({
    id: z.number().int().optional(),
    name: z.string().max(200),
    fieldName: z.string().max(100),
    dataTypeName: z.string().max(50),
    description: z.string().max(1000).optional(),
    position: z.number().int().optional(),
    renderTypeName: z.string().max(50).optional(),
  }).passthrough()).max(500).optional(),
  metadata: z.object({
    geo: z.object({
      bbox: z.tuple([
        z.string(), // west
        z.string(), // south
        z.string(), // east
        z.string(), // north
      ]).optional(),
      owsUrl: z.string().url().optional(),
    }).passthrough().optional(),
  }).passthrough().optional(),
}).passthrough();

export type ValidatedSocrataDatasetMetadata = z.infer<typeof SocrataDatasetMetadataSchema>;

// ============================================================================
// Socrata Error Response Schemas
// ============================================================================

/**
 * Socrata error response schema
 *
 * Error responses from Socrata APIs.
 */
export const SocrataErrorResponseSchema = z.object({
  error: z.boolean().optional(),
  message: z.string().max(2000).optional(),
  code: z.string().max(100).optional(),
  data: z.object({
    code: z.string().max(100).optional(),
  }).passthrough().optional(),
});

export type ValidatedSocrataErrorResponse = z.infer<typeof SocrataErrorResponseSchema>;

/**
 * Check if response is a Socrata error
 */
export function isSocrataError(data: unknown): data is ValidatedSocrataErrorResponse {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  // Socrata errors have either error:true or a message/code field
  const obj = data as Record<string, unknown>;
  return obj.error === true || (typeof obj.message === 'string' && typeof obj.code === 'string');
}

// ============================================================================
// Validation Helper Functions
// ============================================================================

/**
 * Parse and validate Socrata Discovery API response
 *
 * @param data - Raw JSON data
 * @returns Validated response
 * @throws ZodError if validation fails
 */
export function parseSocrataDiscoveryResponse(data: unknown): ValidatedSocrataDiscoveryResponse {
  return SocrataDiscoveryResponseSchema.parse(data);
}

/**
 * Parse and validate Socrata domain catalog response
 *
 * @param data - Raw JSON data
 * @returns Validated response
 * @throws ZodError if validation fails
 */
export function parseSocrataDomainCatalogResponse(data: unknown): ValidatedSocrataDomainCatalogResponse {
  return SocrataDomainCatalogResponseSchema.parse(data);
}

/**
 * Parse and validate Socrata GeoJSON response
 *
 * @param data - Raw JSON data
 * @returns Validated response
 * @throws ZodError if validation fails
 */
export function parseSocrataGeoJSONResponse(data: unknown): ValidatedSocrataGeoJSONResponse {
  return SocrataGeoJSONResponseSchema.parse(data);
}

/**
 * Parse and validate Socrata JSON response
 *
 * @param data - Raw JSON data
 * @returns Validated response
 * @throws ZodError if validation fails
 */
export function parseSocrataJSONResponse(data: unknown): ValidatedSocrataJSONResponse {
  return SocrataJSONResponseSchema.parse(data);
}

/**
 * Parse and validate Socrata dataset metadata
 *
 * @param data - Raw JSON data
 * @returns Validated response
 * @throws ZodError if validation fails
 */
export function parseSocrataDatasetMetadata(data: unknown): ValidatedSocrataDatasetMetadata {
  return SocrataDatasetMetadataSchema.parse(data);
}

/**
 * Safe parse with result type
 *
 * @param data - Raw JSON data
 * @param schema - Zod schema to validate against
 * @returns Validation result
 */
export function safeParseSocrataResponse<T>(
  data: unknown,
  schema: z.ZodType<T>
): { success: true; data: T } | { success: false; error: string } {
  // Check for Socrata error first
  if (isSocrataError(data)) {
    const errData = data as ValidatedSocrataErrorResponse;
    return { success: false, error: errData.message ?? errData.code ?? 'Socrata API error' };
  }

  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errorMsg = result.error.errors[0]?.message ?? 'Schema validation failed';
  return { success: false, error: errorMsg };
}
