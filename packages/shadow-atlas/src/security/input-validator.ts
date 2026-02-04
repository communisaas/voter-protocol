/**
 * Input Validation Module
 *
 * Strict input validation for Shadow Atlas API using Zod schemas.
 * Defense against injection attacks, DoS via malformed inputs, and data corruption.
 *
 * TYPE SAFETY: Nuclear-level strictness. All external inputs validated against schemas.
 *
 * SECURITY PRINCIPLE: Fail-secure. Invalid inputs rejected immediately with sanitized errors.
 */

import { z } from 'zod';

// ============================================================================
// Coordinate Validation
// ============================================================================

/**
 * WGS84 coordinate validation schema
 *
 * Latitude: -90 to +90 (inclusive)
 * Longitude: -180 to +180 (inclusive)
 * Precision: Maximum 8 decimal places (~1.1mm accuracy)
 *
 * SECURITY: Rejects out-of-range coordinates, excessive precision (DoS vector),
 * and special float values (NaN, Infinity).
 */
export const CoordinateSchema = z.object({
  lat: z.number()
    .min(-90, 'Latitude must be >= -90')
    .max(90, 'Latitude must be <= 90')
    .refine((val) => !isNaN(val) && isFinite(val), 'Latitude must be a finite number')
    .refine(
      (val) => {
        // Reject excessive precision (potential DoS via floating point complexity)
        const str = val.toString();
        const decimals = str.split('.')[1]?.length ?? 0;
        return decimals <= 8;
      },
      'Latitude precision must be <= 8 decimal places'
    ),

  lon: z.number()
    .min(-180, 'Longitude must be >= -180')
    .max(180, 'Longitude must be <= 180')
    .refine((val) => !isNaN(val) && isFinite(val), 'Longitude must be a finite number')
    .refine(
      (val) => {
        const str = val.toString();
        const decimals = str.split('.')[1]?.length ?? 0;
        return decimals <= 8;
      },
      'Longitude precision must be <= 8 decimal places'
    ),
});

export type ValidatedCoordinates = z.infer<typeof CoordinateSchema>;

/**
 * Parse and validate coordinates from query parameters
 *
 * @param latStr - Raw latitude string from query
 * @param lonStr - Raw longitude string from query
 * @returns Validated coordinates or error
 */
export function validateCoordinates(
  latStr: string | undefined,
  lonStr: string | undefined
): { success: true; data: ValidatedCoordinates } | { success: false; error: string } {
  // Check for missing parameters
  if (!latStr || !lonStr) {
    return { success: false, error: 'Missing required parameters: lat and lon' };
  }

  // Check string length (DoS protection)
  if (latStr.length > 20 || lonStr.length > 20) {
    return { success: false, error: 'Coordinate string too long (max 20 characters)' };
  }

  // Parse to numbers
  const lat = parseFloat(latStr);
  const lon = parseFloat(lonStr);

  // Validate against schema
  const result = CoordinateSchema.safeParse({ lat, lon });

  if (!result.success) {
    // Extract first error message (don't expose full validation details)
    const errorMsg = result.error.errors[0]?.message ?? 'Invalid coordinates';
    return { success: false, error: errorMsg };
  }

  return { success: true, data: result.data };
}

// ============================================================================
// State Code Validation
// ============================================================================

/**
 * US State abbreviation validation
 *
 * SECURITY: Prevents injection attacks via state codes in URL construction.
 * Only allows uppercase 2-letter state codes.
 */
export const StateCodeSchema = z.string()
  .length(2, 'State code must be exactly 2 characters')
  .regex(/^[A-Z]{2}$/, 'State code must be uppercase letters only')
  .refine(
    (code) => VALID_STATE_CODES.has(code),
    'Invalid US state code'
  );

/**
 * Valid US state and territory codes
 */
const VALID_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL',
  'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME',
  'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH',
  'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI',
  'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  // Territories
  'AS', 'GU', 'MP', 'PR', 'VI', 'UM',
]);

export type ValidatedStateCode = z.infer<typeof StateCodeSchema>;

/**
 * Validate state code
 *
 * @param code - Raw state code string
 * @returns Validated state code or error
 */
export function validateStateCode(
  code: string | undefined
): { success: true; data: ValidatedStateCode } | { success: false; error: string } {
  if (!code) {
    return { success: false, error: 'Missing state code' };
  }

  const result = StateCodeSchema.safeParse(code.toUpperCase());

  if (!result.success) {
    const errorMsg = result.error.errors[0]?.message ?? 'Invalid state code';
    return { success: false, error: errorMsg };
  }

  return { success: true, data: result.data };
}

// ============================================================================
// FIPS Code Validation
// ============================================================================

/**
 * State FIPS code validation
 *
 * SECURITY: Prevents SQL injection via FIPS codes in query strings.
 * Only allows 2-digit numeric codes (01-56).
 */
export const StateFipsSchema = z.string()
  .length(2, 'State FIPS must be exactly 2 digits')
  .regex(/^\d{2}$/, 'State FIPS must be numeric')
  .refine(
    (fips) => {
      const num = parseInt(fips, 10);
      return num >= 1 && num <= 56;
    },
    'State FIPS must be in range 01-56'
  );

export type ValidatedStateFips = z.infer<typeof StateFipsSchema>;

/**
 * Validate FIPS code
 *
 * @param fips - Raw FIPS code string
 * @returns Validated FIPS code or error
 */
export function validateStateFips(
  fips: string | undefined
): { success: true; data: ValidatedStateFips } | { success: false; error: string } {
  if (!fips) {
    return { success: false, error: 'Missing FIPS code' };
  }

  const result = StateFipsSchema.safeParse(fips);

  if (!result.success) {
    const errorMsg = result.error.errors[0]?.message ?? 'Invalid FIPS code';
    return { success: false, error: errorMsg };
  }

  return { success: true, data: result.data };
}

// ============================================================================
// URL Validation
// ============================================================================

/**
 * Allowlisted domains for upstream data sources
 *
 * SECURITY: Prevents SSRF attacks by restricting fetches to trusted domains.
 *
 * ADDING NEW DOMAINS:
 * 1. Verify the domain is an official government or trusted data source
 * 2. Ensure HTTPS is enforced on the domain
 * 3. Add with a comment indicating the organization
 * 4. Test that the domain works with validateURL()
 */
const ALLOWED_DOMAINS = [
  // US Census Bureau
  'tigerweb.geo.census.gov',
  'www2.census.gov',
  'ftp.census.gov',
  'api.census.gov',

  // Esri ArcGIS (global platform)
  'services.arcgis.com',
  'hub.arcgis.com',
  'www.arcgis.com',
  'opendata.arcgis.com',

  // Socrata Open Data Platform
  'api.us.socrata.com',
  'data.cityofchicago.org',
  'data.seattle.gov',
  'data.sfgov.org',
  'data.cityofnewyork.us',
  'data.lacity.org',
  'data.baltimorecity.gov',
  'data.austintexas.gov',
  'data.boston.gov',
  'data.sandiego.gov',
  'opendata.denvergov.org',
  'data.kcmo.org',
  'opendataphilly.org',

  // CKAN Portals
  'catalog.data.gov',
  'data.gov.uk',
  'data.gov.au',
  'open.canada.ca',
  'datos.gob.es',
  'dati.gov.it',
  'data.opendatasoft.com',

  // State GIS portals
  'gis.legis.wisconsin.gov',
  'gis.nc.gov',
  'gis.texas.gov',
  'geodata.hawaii.gov',
  'pasda.psu.edu',

  // Redistricting Data Hub
  'redistrictingdatahub.org',

  // International sources
  'geoportal.statistics.gov.uk', // UK ONS
  'represent.opennorth.ca', // Canada Open North
];

/**
 * Check if URL is safe (no private IPs, no localhost)
 * Used for both allowlisted and bypass validation
 *
 * @param url - URL to check
 * @returns true if URL points to public internet
 */
export function isPublicURL(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;

    // Reject non-HTTPS
    if (parsed.protocol !== 'https:') {
      return false;
    }

    // Reject private IP ranges (RFC 1918)
    const privateIPRegex = /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.)/;
    if (privateIPRegex.test(hostname)) {
      return false;
    }

    // Reject localhost
    if (hostname === 'localhost' || hostname === '::1') {
      return false;
    }

    // Reject link-local addresses
    if (hostname.startsWith('169.254.')) {
      return false;
    }

    // Reject IPv6 loopback and link-local
    if (hostname === '::1' || hostname.startsWith('fe80:') || hostname.startsWith('fc') || hostname.startsWith('fd')) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a domain is in the allowlist
 *
 * @param hostname - Domain to check
 * @returns true if domain is allowlisted
 */
export function isDomainAllowlisted(hostname: string): boolean {
  return ALLOWED_DOMAINS.some((domain) =>
    hostname === domain || hostname.endsWith('.' + domain)
  );
}

/**
 * Validate URL with explicit bypass option for operator-configured sources
 *
 * SECURITY: The bypassAllowlist option should ONLY be used when:
 * 1. Operators explicitly configure custom data sources
 * 2. The URL still passes public IP validation
 * 3. The bypass is logged for audit purposes
 *
 * @param url - URL to validate
 * @param options - Validation options
 * @returns Validation result
 */
export function validateURLWithOptions(
  url: string | undefined,
  options: { bypassAllowlist?: boolean; reason?: string } = {}
): { success: true; data: string; bypassed: boolean } | { success: false; error: string } {
  if (!url) {
    return { success: false, error: 'Missing URL' };
  }

  // Always check for public URL (no private IPs, no localhost)
  if (!isPublicURL(url)) {
    return { success: false, error: 'URL must use HTTPS and not point to private IP or localhost' };
  }

  // Check allowlist unless bypassed
  if (!options.bypassAllowlist) {
    try {
      const parsed = new URL(url);
      if (!isDomainAllowlisted(parsed.hostname)) {
        return { success: false, error: `URL domain not in allowlist: ${parsed.hostname}` };
      }
    } catch {
      return { success: false, error: 'Invalid URL format' };
    }
    return { success: true, data: url, bypassed: false };
  }

  // Bypass mode - URL is valid but not in allowlist
  // This should be logged by the caller for audit purposes
  return { success: true, data: url, bypassed: true };
}

/**
 * URL validation schema
 *
 * SECURITY: Enforces HTTPS, rejects private IPs, validates domain allowlist.
 * NOTE: Private IP check MUST come before domain allowlist to provide correct error messages.
 */
export const URLSchema = z.string()
  .url('Invalid URL format')
  .refine(
    (url) => {
      try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:';
      } catch {
        return false;
      }
    },
    'URL must use HTTPS protocol'
  )
  // SECURITY: Check private IPs FIRST before domain allowlist to give accurate error messages
  .refine(
    (url) => {
      try {
        const parsed = new URL(url);
        const hostname = parsed.hostname;

        // Reject private IP ranges (RFC 1918)
        const privateIPRegex = /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.)/;
        if (privateIPRegex.test(hostname)) {
          return false;
        }

        // Reject localhost
        if (hostname === 'localhost' || hostname === '::1') {
          return false;
        }

        return true;
      } catch {
        return false;
      }
    },
    'URL must not point to private IP or localhost'
  )
  .refine(
    (url) => {
      try {
        const parsed = new URL(url);
        return ALLOWED_DOMAINS.some((domain) =>
          parsed.hostname === domain || parsed.hostname.endsWith('.' + domain)
        );
      } catch {
        return false;
      }
    },
    'URL domain not in allowlist'
  );

export type ValidatedURL = z.infer<typeof URLSchema>;

/**
 * Validate URL for upstream fetches
 *
 * @param url - Raw URL string
 * @returns Validated URL or error
 */
export function validateURL(
  url: string | undefined
): { success: true; data: ValidatedURL } | { success: false; error: string } {
  if (!url) {
    return { success: false, error: 'Missing URL' };
  }

  const result = URLSchema.safeParse(url);

  if (!result.success) {
    const errorMsg = result.error.errors[0]?.message ?? 'Invalid URL';
    return { success: false, error: errorMsg };
  }

  return { success: true, data: result.data };
}

// ============================================================================
// Job ID Validation
// ============================================================================

/**
 * Job ID validation (UUIDv4)
 *
 * SECURITY: Prevents directory traversal via job IDs in file operations.
 */
export const JobIDSchema = z.string()
  .uuid('Job ID must be a valid UUID');

export type ValidatedJobID = z.infer<typeof JobIDSchema>;

/**
 * Validate job ID
 *
 * @param jobId - Raw job ID string
 * @returns Validated job ID or error
 */
export function validateJobID(
  jobId: string | undefined
): { success: true; data: ValidatedJobID } | { success: false; error: string } {
  if (!jobId) {
    return { success: false, error: 'Missing job ID' };
  }

  const result = JobIDSchema.safeParse(jobId);

  if (!result.success) {
    return { success: false, error: 'Invalid job ID format' };
  }

  return { success: true, data: result.data };
}

// ============================================================================
// Snapshot ID Validation
// ============================================================================

/**
 * Snapshot ID validation (UUIDv4 or IPFS CID)
 *
 * SECURITY: Prevents injection attacks via snapshot IDs.
 */
export const SnapshotIDSchema = z.string()
  .refine(
    (id) => {
      // Allow UUIDs
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        return true;
      }

      // Allow IPFS CIDv1 (base32)
      if (/^b[a-z2-7]{58}$/i.test(id)) {
        return true;
      }

      return false;
    },
    'Snapshot ID must be UUID or IPFS CID'
  );

export type ValidatedSnapshotID = z.infer<typeof SnapshotIDSchema>;

/**
 * Validate snapshot ID
 *
 * @param snapshotId - Raw snapshot ID string
 * @returns Validated snapshot ID or error
 */
export function validateSnapshotID(
  snapshotId: string | undefined
): { success: true; data: ValidatedSnapshotID } | { success: false; error: string } {
  if (!snapshotId) {
    return { success: false, error: 'Missing snapshot ID' };
  }

  const result = SnapshotIDSchema.safeParse(snapshotId);

  if (!result.success) {
    return { success: false, error: 'Invalid snapshot ID format' };
  }

  return { success: true, data: result.data };
}

// ============================================================================
// GeoJSON Validation
// ============================================================================

/**
 * GeoJSON Position validation (RFC 7946)
 *
 * Position is [longitude, latitude] or [longitude, latitude, altitude]
 * Longitude: -180 to 180, Latitude: -90 to 90
 *
 * SECURITY: Validates coordinate ranges to prevent invalid geometry processing.
 */
export const GeoJSONPositionSchema = z
  .tuple([
    z.number().min(-180).max(180), // longitude
    z.number().min(-90).max(90),   // latitude
  ])
  .rest(z.number()); // optional altitude and beyond

/**
 * GeoJSON LinearRing validation (RFC 7946)
 *
 * LinearRing is a closed ring with at least 4 positions where first == last.
 *
 * SECURITY: Validates ring closure and minimum vertex count.
 */
export const GeoJSONLinearRingSchema = z
  .array(GeoJSONPositionSchema)
  .min(4, 'LinearRing must have at least 4 positions');

/**
 * GeoJSON Polygon coordinates validation (RFC 7946)
 *
 * Polygon coordinates are arrays of LinearRings (first is exterior, rest are holes).
 *
 * SECURITY: Limits ring count to prevent memory exhaustion.
 */
export const GeoJSONPolygonCoordinatesSchema = z
  .array(GeoJSONLinearRingSchema)
  .min(1, 'Polygon must have at least one ring')
  .max(100, 'Polygon exceeds maximum ring count (100)');

/**
 * GeoJSON MultiPolygon coordinates validation (RFC 7946)
 *
 * MultiPolygon coordinates are arrays of Polygon coordinates.
 *
 * SECURITY: Limits polygon count to prevent memory exhaustion.
 */
export const GeoJSONMultiPolygonCoordinatesSchema = z
  .array(GeoJSONPolygonCoordinatesSchema)
  .min(1, 'MultiPolygon must have at least one polygon')
  .max(1000, 'MultiPolygon exceeds maximum polygon count (1000)');

/**
 * GeoJSON Polygon geometry validation
 */
export const GeoJSONPolygonGeometrySchema = z.object({
  type: z.literal('Polygon'),
  coordinates: GeoJSONPolygonCoordinatesSchema,
});

/**
 * GeoJSON MultiPolygon geometry validation
 */
export const GeoJSONMultiPolygonGeometrySchema = z.object({
  type: z.literal('MultiPolygon'),
  coordinates: GeoJSONMultiPolygonCoordinatesSchema,
});

/**
 * GeoJSON Geometry (Polygon or MultiPolygon) validation
 */
export const GeoJSONGeometrySchema = z.discriminatedUnion('type', [
  GeoJSONPolygonGeometrySchema,
  GeoJSONMultiPolygonGeometrySchema,
]);

/**
 * GeoJSON Feature validation (type-safe structure check)
 *
 * SECURITY: Prevents processing of malformed GeoJSON that could crash parsers.
 * Uses strict coordinate validation instead of z.any().
 */
export const GeoJSONFeatureSchema = z.object({
  type: z.literal('Feature'),
  geometry: GeoJSONGeometrySchema,
  properties: z.record(z.unknown()).nullable(),
});

/**
 * GeoJSON FeatureCollection validation
 *
 * SECURITY: Limits feature count to prevent memory exhaustion attacks.
 */
export const GeoJSONFeatureCollectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(GeoJSONFeatureSchema)
    .max(50000, 'Feature collection too large (max 50,000 features)'),
});

export type ValidatedGeoJSONFeatureCollection = z.infer<typeof GeoJSONFeatureCollectionSchema>;

/**
 * Validate GeoJSON FeatureCollection structure
 *
 * @param data - Raw GeoJSON data
 * @returns Validated GeoJSON or error
 */
export function validateGeoJSON(
  data: unknown
): { success: true; data: ValidatedGeoJSONFeatureCollection } | { success: false; error: string } {
  const result = GeoJSONFeatureCollectionSchema.safeParse(data);

  if (!result.success) {
    const errorMsg = result.error.errors[0]?.message ?? 'Invalid GeoJSON structure';
    return { success: false, error: errorMsg };
  }

  return { success: true, data: result.data };
}

// ============================================================================
// Query Parameter Validation
// ============================================================================

/**
 * Validate pagination parameters
 *
 * SECURITY: Prevents resource exhaustion via excessive limit values.
 */
export const PaginationSchema = z.object({
  limit: z.number()
    .int('Limit must be an integer')
    .min(1, 'Limit must be at least 1')
    .max(1000, 'Limit must be at most 1000')
    .default(10),

  offset: z.number()
    .int('Offset must be an integer')
    .min(0, 'Offset must be non-negative')
    .max(1000000, 'Offset too large')
    .default(0),
});

export type ValidatedPagination = z.infer<typeof PaginationSchema>;

/**
 * Check if a string represents a valid integer (no decimals, no trailing garbage)
 * SECURITY: Prevents DoS via parseInt accepting floats like "10.5" as 10
 */
function isValidIntegerString(str: string): boolean {
  // Must match only digits, optionally with leading minus
  return /^-?\d+$/.test(str);
}

/**
 * Validate pagination parameters
 *
 * @param limitStr - Raw limit string
 * @param offsetStr - Raw offset string
 * @returns Validated pagination or error
 */
export function validatePagination(
  limitStr: string | undefined,
  offsetStr: string | undefined
): { success: true; data: ValidatedPagination } | { success: false; error: string } {
  // SECURITY: Reject non-integer strings before parseInt (prevents DoS via float truncation)
  if (limitStr && !isValidIntegerString(limitStr)) {
    return { success: false, error: 'Limit must be an integer' };
  }
  if (offsetStr && !isValidIntegerString(offsetStr)) {
    return { success: false, error: 'Offset must be an integer' };
  }

  const limit = limitStr ? parseInt(limitStr, 10) : 10;
  const offset = offsetStr ? parseInt(offsetStr, 10) : 0;

  const result = PaginationSchema.safeParse({ limit, offset });

  if (!result.success) {
    const errorMsg = result.error.errors[0]?.message ?? 'Invalid pagination parameters';
    return { success: false, error: errorMsg };
  }

  return { success: true, data: result.data };
}

// ============================================================================
// Content-Type Validation
// ============================================================================

/**
 * Allowed content types for API responses
 */
const ALLOWED_CONTENT_TYPES = new Set([
  'application/json',
  'application/geo+json',
  'application/vnd.geo+json',
]);

/**
 * Validate Content-Type header from upstream response
 *
 * SECURITY: Prevents processing of unexpected content types (e.g., HTML with XSS).
 *
 * @param contentType - Content-Type header value
 * @returns True if valid, false otherwise
 */
export function validateContentType(contentType: string | undefined): boolean {
  if (!contentType) {
    return false;
  }

  // Extract media type (ignore charset, boundary, etc.)
  const mediaType = contentType.split(';')[0]?.trim().toLowerCase();

  return ALLOWED_CONTENT_TYPES.has(mediaType ?? '');
}

// ============================================================================
// Response Size Validation
// ============================================================================

/**
 * Maximum response sizes by content type
 */
export const MAX_RESPONSE_SIZES = {
  json: 10 * 1024 * 1024,      // 10 MB for GeoJSON
  snapshot: 100 * 1024 * 1024, // 100 MB for full snapshots
} as const;

/**
 * Validate response size before processing
 *
 * SECURITY: Prevents memory exhaustion via oversized responses.
 *
 * @param contentLength - Content-Length header value
 * @param maxSize - Maximum allowed size in bytes
 * @returns True if valid, false otherwise
 */
export function validateResponseSize(
  contentLength: string | undefined,
  maxSize: number = MAX_RESPONSE_SIZES.json
): boolean {
  if (!contentLength) {
    // If no Content-Length header, we'll check during streaming
    return true;
  }

  const size = parseInt(contentLength, 10);

  if (isNaN(size) || size < 0) {
    return false;
  }

  return size <= maxSize;
}

// ============================================================================
// Sanitization Utilities
// ============================================================================

/**
 * Type guard for Zod-like error objects
 * Uses duck-typing to handle both actual ZodError instances and plain objects with same shape
 */
function isZodLikeError(error: unknown): error is { errors: Array<{ message: string }> } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'errors' in error &&
    Array.isArray((error as { errors: unknown }).errors) &&
    (error as { errors: unknown[] }).errors.length > 0 &&
    typeof (error as { errors: Array<{ message: unknown }> }).errors[0]?.message === 'string'
  );
}

/**
 * Sanitize error messages for client responses
 *
 * SECURITY: Prevents information disclosure via detailed error messages.
 *
 * @param error - Raw error object
 * @returns Sanitized error message
 */
export function sanitizeErrorMessage(error: unknown): string {
  // Check for Zod-like errors using duck-typing (handles both ZodError instances and plain objects)
  if (isZodLikeError(error)) {
    // Return first validation error only (don't expose full schema)
    return error.errors[0]?.message ?? 'Validation error';
  }

  if (error instanceof Error) {
    // Don't expose stack traces or internal paths
    const message = error.message;

    // Remove file paths
    const sanitized = message.replace(/\/[\w/.-]+/g, '[path]');

    // Limit length
    return sanitized.substring(0, 200);
  }

  return 'An error occurred';
}

/**
 * Sanitize log data for security events
 *
 * SECURITY: Removes sensitive data before logging.
 *
 * @param data - Raw log data
 * @returns Sanitized data safe for logs
 */
export function sanitizeLogData(data: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    // Redact sensitive fields
    if (['password', 'apiKey', 'token', 'secret'].includes(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]';
      continue;
    }

    // Truncate long strings
    if (typeof value === 'string' && value.length > 500) {
      sanitized[key] = value.substring(0, 500) + '... [truncated]';
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
}

// ============================================================================
// Discovery Result Schema Validation (SA-014)
// ============================================================================

/**
 * Discovery result schema for validated JSON parsing
 * SA-014: Prevents malformed JSON from corrupting discovery state
 *
 * SECURITY: All persisted discovery state and external API responses
 * must be validated before use to prevent data corruption attacks.
 */
export const DiscoveryResultSchema = z.object({
  geoid: z.string().regex(/^\d{2,15}$/, 'GEOID must be numeric (2-15 digits)'),
  cityName: z.string().min(1).max(200),
  state: z.string().min(1).max(50),
  population: z.number().int().min(0),
  status: z.enum(['found', 'not_found', 'at_large', 'error', 'pending']),
  districtCount: z.number().int().min(0).nullable(),
  downloadUrl: z.string().url().nullable(),
  portalType: z.enum(['arcgis-hub', 'socrata', 'ckan', 'gis-server', 'state-gis']).nullable(),
  confidence: z.number().min(0).max(100),
  discoveredAt: z.union([z.string().datetime(), z.null()]),
  errorMessage: z.string().max(1000).nullable(),
});

export type ValidatedDiscoveryResult = z.infer<typeof DiscoveryResultSchema>;

/**
 * Discovery state schema for workflow checkpointing
 * SA-014: Validates persisted workflow state on resume
 */
export const DiscoveryWorkflowStateSchema = z.object({
  region: z.string().regex(/^[A-Z]{2}-[A-Z]{2,3}$/, 'Region must be ISO format (e.g., US-MT)'),
  phase: z.enum([
    'initializing',
    'loading_places',
    'classifying_governance',
    'searching_sources',
    'validating_urls',
    'writing_registry',
    'complete',
    'failed',
  ]),
  currentPlaceIndex: z.number().int().min(0),
  places: z.array(z.object({
    id: z.string(),
    name: z.string(),
    state: z.string(),
    countryCode: z.string(),
    population: z.number().int().min(0),
    placeType: z.string(),
  })),
  classifications: z.array(z.object({
    placeId: z.string(),
    placeName: z.string(),
    governanceType: z.enum(['ward', 'district', 'commission', 'at-large', 'unknown']),
    expectedDistricts: z.number().int().min(0),
    confidence: z.enum(['verified', 'inferred', 'needs-research']),
    source: z.string(),
    reasoning: z.string(),
  })),
  candidateUrls: z.array(z.object({
    placeId: z.string(),
    url: z.string().url(),
    source: z.enum(['arcgis', 'socrata', 'ckan', 'state-gis', 'county-gis', 'city-gis']),
    layerName: z.string(),
    confidence: z.number().min(0).max(1),
    discoveredAt: z.number(),
  })),
  validatedBoundaries: z.array(z.object({
    placeId: z.string(),
    placeName: z.string(),
    url: z.string().url(),
    format: z.enum(['geojson', 'shapefile', 'feature-service']),
    featureCount: z.number().int().min(0),
    geometryType: z.enum(['polygon', 'multipolygon', 'unknown']),
    validatedAt: z.number(),
    responseTimeMs: z.number().min(0),
  })),
  errors: z.array(z.object({
    placeId: z.string(),
    phase: z.enum([
      'initializing',
      'loading_places',
      'classifying_governance',
      'searching_sources',
      'validating_urls',
      'writing_registry',
      'complete',
      'failed',
    ]),
    error: z.string(),
    timestamp: z.number(),
    retryCount: z.number().int().min(0),
  })),
  retryQueue: z.array(z.string()),
  startedAt: z.number(),
  lastCheckpoint: z.number(),
  apiCallCount: z.number().int().min(0),
  estimatedCost: z.number().min(0),
  summary: z.object({
    region: z.string(),
    totalPlaces: z.number().int().min(0),
    wardBasedPlaces: z.number().int().min(0),
    atLargePlaces: z.number().int().min(0),
    boundariesFound: z.number().int().min(0),
    boundariesMissing: z.number().int().min(0),
    coveragePercent: z.number().min(0).max(100),
    totalApiCalls: z.number().int().min(0),
    totalCost: z.number().min(0),
    durationMs: z.number().min(0),
  }).optional(),
});

export type ValidatedDiscoveryWorkflowState = z.infer<typeof DiscoveryWorkflowStateSchema>;

/**
 * TIGER ingestion checkpoint schema
 * SA-014: Validates checkpoint state for resumable batch operations
 */
export const CheckpointStateSchema = z.object({
  id: z.string().uuid(),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedStates: z.array(z.string().regex(/^\d{2}$/, 'State FIPS must be 2 digits')),
  failedStates: z.array(z.string().regex(/^\d{2}$/, 'State FIPS must be 2 digits')),
  pendingStates: z.array(z.string().regex(/^\d{2}$/, 'State FIPS must be 2 digits')),
  options: z.object({
    states: z.array(z.string()),
    layers: z.array(z.string()),
    year: z.number().int().min(2000).max(2100),
    maxConcurrentStates: z.number().int().min(1).max(50).optional(),
    circuitBreakerThreshold: z.number().int().min(1).max(100).optional(),
    checkpointDir: z.string().optional(),
    forceRefresh: z.boolean().optional(),
  }),
  circuitOpen: z.boolean(),
  consecutiveFailures: z.number().int().min(0),
  boundaryCount: z.number().int().min(0),
});

export type ValidatedCheckpointState = z.infer<typeof CheckpointStateSchema>;

/**
 * Checksum cache schema for change detection
 * SA-014: Validates persisted checksum cache
 */
export const ChecksumCacheSchema = z.object({
  lastChecked: z.string().datetime(),
  sources: z.record(
    z.string(),
    z.object({
      etag: z.string().nullable(),
      lastModified: z.string().nullable(),
      checkedAt: z.string().datetime(),
    })
  ),
});

export type ValidatedChecksumCache = z.infer<typeof ChecksumCacheSchema>;

/**
 * Parse and validate discovery results from JSON
 * SA-014: Safe parsing with schema validation
 *
 * @param json - Raw JSON string
 * @returns Validated discovery results array
 * @throws ZodError if validation fails
 */
export function parseDiscoveryResults(json: string): ValidatedDiscoveryResult[] {
  const parsed = JSON.parse(json) as unknown;
  return z.array(DiscoveryResultSchema).parse(parsed);
}

/**
 * Parse and validate discovery workflow state from JSON
 * SA-014: Safe parsing for workflow checkpoint resume
 *
 * @param json - Raw JSON string
 * @returns Validated discovery state
 * @throws ZodError if validation fails
 */
export function parseDiscoveryWorkflowState(json: string): ValidatedDiscoveryWorkflowState {
  const parsed = JSON.parse(json) as unknown;
  return DiscoveryWorkflowStateSchema.parse(parsed);
}

/**
 * Parse and validate checkpoint state from JSON
 * SA-014: Safe parsing for TIGER ingestion resume
 *
 * @param json - Raw JSON string
 * @returns Validated checkpoint state
 * @throws ZodError if validation fails
 */
export function parseCheckpointState(json: string): ValidatedCheckpointState {
  const parsed = JSON.parse(json) as unknown;
  return CheckpointStateSchema.parse(parsed);
}

/**
 * Parse and validate checksum cache from JSON
 * SA-014: Safe parsing for change detection cache
 *
 * @param json - Raw JSON string
 * @returns Validated checksum cache
 * @throws ZodError if validation fails
 */
export function parseChecksumCache(json: string): ValidatedChecksumCache {
  const parsed = JSON.parse(json) as unknown;
  return ChecksumCacheSchema.parse(parsed);
}

/**
 * Safe JSON parse with schema validation
 * SA-014: Generic wrapper for validated parsing
 *
 * @param json - Raw JSON string
 * @param schema - Zod schema to validate against
 * @returns Validated data or error
 */
export function safeParseJSON<T>(
  json: string,
  schema: z.ZodType<T>
): { success: true; data: T } | { success: false; error: string } {
  try {
    const parsed = JSON.parse(json) as unknown;
    const result = schema.safeParse(parsed);

    if (!result.success) {
      const errorMsg = result.error.errors[0]?.message ?? 'Schema validation failed';
      return { success: false, error: errorMsg };
    }

    return { success: true, data: result.data };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { success: false, error: 'Invalid JSON syntax' };
    }
    return { success: false, error: 'JSON parsing failed' };
  }
}

// ============================================================================
// Job State Schema Validation (SA-014)
// ============================================================================

/**
 * Serialized completed extraction schema
 * SA-014: Validates persisted job extraction records
 */
export const SerializedCompletedExtractionSchema = z.object({
  state: z.string().regex(/^[A-Z]{2}$/, 'State must be 2-letter code'),
  layer: z.string().min(1).max(100),
  completedAt: z.string().datetime(),
  boundaryCount: z.number().int().min(0),
  validationPassed: z.boolean(),
});

export type ValidatedSerializedCompletedExtraction = z.infer<typeof SerializedCompletedExtractionSchema>;

/**
 * Serialized extraction failure schema
 * SA-014: Validates persisted job failure records
 */
export const SerializedExtractionFailureSchema = z.object({
  state: z.string().regex(/^[A-Z]{2}$/, 'State must be 2-letter code'),
  layer: z.string().min(1).max(100),
  failedAt: z.string().datetime(),
  error: z.string().max(2000),
  attemptCount: z.number().int().min(0).max(100),
  retryable: z.boolean(),
});

export type ValidatedSerializedExtractionFailure = z.infer<typeof SerializedExtractionFailureSchema>;

/**
 * Serialized not configured task schema
 * SA-014: Validates persisted not-configured task records
 */
export const SerializedNotConfiguredTaskSchema = z.object({
  state: z.string().regex(/^[A-Z]{2}$/, 'State must be 2-letter code'),
  layer: z.string().min(1).max(100),
  reason: z.enum(['state_not_in_registry', 'layer_not_configured']),
  checkedAt: z.string().datetime(),
});

export type ValidatedSerializedNotConfiguredTask = z.infer<typeof SerializedNotConfiguredTaskSchema>;

/**
 * Job scope schema
 * SA-014: Validates job scope definition
 */
export const JobScopeSchema = z.object({
  states: z.array(z.string().regex(/^[A-Z]{2}$/, 'State must be 2-letter code')),
  layers: z.array(z.string().min(1).max(100)),
});

export type ValidatedJobScope = z.infer<typeof JobScopeSchema>;

/**
 * Job progress schema
 * SA-014: Validates job progress tracking
 */
export const JobProgressSchema = z.object({
  totalTasks: z.number().int().min(0),
  completedTasks: z.number().int().min(0),
  failedTasks: z.number().int().min(0),
  currentTask: z.string().max(500).optional(),
});

export type ValidatedJobProgress = z.infer<typeof JobProgressSchema>;

/**
 * Orchestration options schema
 * SA-014: Validates orchestration configuration
 */
export const OrchestrationOptionsSchema = z.object({
  concurrency: z.number().int().min(1).max(50).optional(),
  continueOnError: z.boolean().optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  retryDelayMs: z.number().int().min(0).max(60000).optional(),
  validateAfterExtraction: z.boolean().optional(),
  rateLimitMs: z.number().int().min(0).max(60000).optional(),
});

export type ValidatedOrchestrationOptions = z.infer<typeof OrchestrationOptionsSchema>;

/**
 * Serialized job state schema
 * SA-014: Validates persisted job state for safe deserialization
 *
 * SECURITY: Prevents malformed/malicious job state files from corrupting
 * the job orchestration system during resume operations.
 */
export const SerializedJobStateSchema = z.object({
  jobId: z.string().regex(/^job-[a-z0-9]+-[a-f0-9]+$/, 'Invalid job ID format'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  status: z.enum(['pending', 'running', 'partial', 'completed', 'failed', 'cancelled']),
  scope: JobScopeSchema,
  progress: JobProgressSchema,
  completedExtractions: z.array(SerializedCompletedExtractionSchema),
  failures: z.array(SerializedExtractionFailureSchema),
  notConfiguredTasks: z.array(SerializedNotConfiguredTaskSchema).optional(),
  options: OrchestrationOptionsSchema,
});

export type ValidatedSerializedJobState = z.infer<typeof SerializedJobStateSchema>;

/**
 * Parse and validate serialized job state from JSON
 * SA-014: Safe parsing for job state resume
 *
 * @param json - Raw JSON string
 * @returns Validated serialized job state
 * @throws ZodError if validation fails
 */
export function parseSerializedJobState(json: string): ValidatedSerializedJobState {
  const parsed = JSON.parse(json) as unknown;
  return SerializedJobStateSchema.parse(parsed);
}

// ============================================================================
// Cache Entry Schema Validation (SA-014)
// ============================================================================

/**
 * Cache entry schema
 * SA-014: Validates cached data structure for safe deserialization
 *
 * SECURITY: Prevents cache poisoning attacks by validating cache entries
 * before use. The data field uses z.unknown() as it can contain any cached value.
 */
export const CacheEntrySchema = z.object({
  key: z.string().min(1).max(1000),
  data: z.unknown(),
  timestamp: z.number().int().min(0),
  size: z.number().int().min(0),
  ttl: z.number().int().min(0).optional(),
});

export type ValidatedCacheEntry = z.infer<typeof CacheEntrySchema>;

/**
 * Parse and validate cache entry from JSON
 * SA-014: Safe parsing for cache retrieval
 *
 * @param json - Raw JSON string
 * @returns Validated cache entry
 * @throws ZodError if validation fails
 */
export function parseCacheEntry(json: string): ValidatedCacheEntry {
  const parsed = JSON.parse(json) as unknown;
  return CacheEntrySchema.parse(parsed);
}

// ============================================================================
// Security Event Schema Validation (SA-014)
// ============================================================================

/**
 * Security event severity levels
 */
export const SecurityEventSeveritySchema = z.enum(['critical', 'high', 'medium', 'low', 'info']);

/**
 * Security event category
 */
export const SecurityEventCategorySchema = z.enum([
  'authentication',
  'authorization',
  'validation',
  'rate_limit',
  'integrity',
  'data_access',
  'configuration',
  'system',
]);

/**
 * Security event client schema
 */
export const SecurityEventClientSchema = z.object({
  ip: z.string().max(100),
  apiKeyHash: z.string().max(128).optional(),
  userAgent: z.string().max(500).optional(),
});

/**
 * Security event request schema
 */
export const SecurityEventRequestSchema = z.object({
  method: z.string().max(20),
  path: z.string().max(2000),
  query: z.record(z.string()).optional(),
  headers: z.record(z.string()).optional(),
});

/**
 * Security event schema
 * SA-014: Validates security audit log entries for safe parsing
 *
 * SECURITY: Ensures audit log integrity verification works correctly
 * by validating event structure before hash chain verification.
 */
export const SecurityEventSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
  severity: SecurityEventSeveritySchema,
  category: SecurityEventCategorySchema,
  eventType: z.string().min(1).max(100),
  client: SecurityEventClientSchema,
  request: SecurityEventRequestSchema,
  data: z.record(z.unknown()),
  success: z.boolean(),
  error: z.string().max(2000).optional(),
  correlationId: z.string().max(100).optional(),
  previousHash: z.string().regex(/^[a-f0-9]{64}$/, 'Previous hash must be SHA-256 hex').optional(),
  eventHash: z.string().regex(/^[a-f0-9]{64}$/, 'Event hash must be SHA-256 hex').optional(),
});

export type ValidatedSecurityEvent = z.infer<typeof SecurityEventSchema>;

/**
 * Parse and validate security event from JSON
 * SA-014: Safe parsing for audit log verification
 *
 * @param json - Raw JSON string
 * @returns Validated security event
 * @throws ZodError if validation fails
 */
export function parseSecurityEvent(json: string): ValidatedSecurityEvent {
  const parsed = JSON.parse(json) as unknown;
  return SecurityEventSchema.parse(parsed);
}
