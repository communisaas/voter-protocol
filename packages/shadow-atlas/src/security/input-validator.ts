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
 */
const ALLOWED_DOMAINS = [
  // US Census Bureau
  'tigerweb.geo.census.gov',
  'www2.census.gov',
  'ftp.census.gov',

  // Esri ArcGIS
  'services.arcgis.com',
  'tigerweb.geo.census.gov',

  // State GIS portals (add as needed)
  'gis.legis.wisconsin.gov',
  'gis.nc.gov',
  'gis.texas.gov',
  'data.cityofchicago.org', // Socrata

  // International sources
  'geoportal.statistics.gov.uk', // UK ONS
  'represent.opennorth.ca', // Canada Open North
];

/**
 * URL validation schema
 *
 * SECURITY: Enforces HTTPS, validates domain allowlist, rejects private IPs.
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
  .refine(
    (url) => {
      try {
        const parsed = new URL(url);
        return ALLOWED_DOMAINS.some((domain) => parsed.hostname.endsWith(domain));
      } catch {
        return false;
      }
    },
    'URL domain not in allowlist'
  )
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
 * GeoJSON Feature validation (basic structure check)
 *
 * SECURITY: Prevents processing of malformed GeoJSON that could crash parsers.
 */
export const GeoJSONFeatureSchema = z.object({
  type: z.literal('Feature'),
  geometry: z.object({
    type: z.enum(['Polygon', 'MultiPolygon']),
    coordinates: z.array(z.any()), // Detailed coordinate validation done separately
  }),
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
 * Sanitize error messages for client responses
 *
 * SECURITY: Prevents information disclosure via detailed error messages.
 *
 * @param error - Raw error object
 * @returns Sanitized error message
 */
export function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
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
