/**
 * URL Validator for Discovery Pipeline
 *
 * SA-009: Enforces URL allowlist to prevent SSRF attacks in the discovery pipeline.
 *
 * The discovery pipeline fetches URLs from:
 * - ArcGIS Hub/Portal API search results
 * - Socrata Discovery API results
 * - Dynamically generated municipal GIS URLs
 * - State GIS clearinghouse endpoints
 *
 * Without validation, malicious URLs could trigger requests to:
 * - Internal services (localhost, 127.0.0.1, 10.x.x.x, 192.168.x.x)
 * - Cloud metadata endpoints (169.254.169.254)
 * - Private network resources
 *
 * SECURITY PRINCIPLE: Default deny. Only explicitly allowlisted patterns permitted.
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import { logger } from '../core/utils/logger.js';

// ============================================================================
// URL Allowlist Patterns
// ============================================================================

/**
 * Allowlisted URL patterns for the discovery pipeline
 *
 * SECURITY: These patterns define the ONLY domains that can be fetched.
 * Adding new patterns requires security review.
 *
 * Pattern types:
 * - exact: Exact domain match (e.g., 'tigerweb.geo.census.gov')
 * - suffix: Domain suffix match (e.g., '*.census.gov' matches 'www2.census.gov')
 */
export interface URLPattern {
  /** Pattern type */
  readonly type: 'exact' | 'suffix';
  /** Domain or suffix to match */
  readonly domain: string;
  /** Description for documentation */
  readonly description: string;
  /** Organization responsible for domain */
  readonly organization: string;
}

/**
 * Authoritative allowlist of URL patterns for discovery pipeline
 *
 * ADDING NEW PATTERNS:
 * 1. Verify the domain is an official government or trusted data source
 * 2. Ensure HTTPS is enforced on the domain
 * 3. Add with description and organization
 * 4. Add unit tests for the new pattern
 * 5. Document in SECURITY.md
 */
export const URL_ALLOWLIST_PATTERNS: readonly URLPattern[] = Object.freeze([
  // US Census Bureau
  {
    type: 'exact',
    domain: 'tigerweb.geo.census.gov',
    description: 'TIGER/Line geodata web services',
    organization: 'US Census Bureau',
  },
  {
    type: 'suffix',
    domain: '.census.gov',
    description: 'Census Bureau domains',
    organization: 'US Census Bureau',
  },

  // Esri ArcGIS Platform
  {
    type: 'suffix',
    domain: '.arcgis.com',
    description: 'ArcGIS Online and Hub services',
    organization: 'Esri',
  },

  // Socrata Open Data Platform
  {
    type: 'suffix',
    domain: '.socrata.com',
    description: 'Socrata Discovery API',
    organization: 'Tyler Technologies',
  },

  // Socrata-powered government portals (common patterns)
  {
    type: 'suffix',
    domain: '.data.gov',
    description: 'Federal open data portal',
    organization: 'US Government',
  },

  // Major city Socrata portals
  {
    type: 'exact',
    domain: 'data.cityofchicago.org',
    description: 'Chicago open data portal',
    organization: 'City of Chicago',
  },
  {
    type: 'exact',
    domain: 'data.seattle.gov',
    description: 'Seattle open data portal',
    organization: 'City of Seattle',
  },
  {
    type: 'exact',
    domain: 'data.sfgov.org',
    description: 'San Francisco open data portal',
    organization: 'City of San Francisco',
  },
  {
    type: 'exact',
    domain: 'data.cityofnewyork.us',
    description: 'New York City open data portal',
    organization: 'City of New York',
  },
  {
    type: 'exact',
    domain: 'data.lacity.org',
    description: 'Los Angeles open data portal',
    organization: 'City of Los Angeles',
  },
  {
    type: 'exact',
    domain: 'data.baltimorecity.gov',
    description: 'Baltimore open data portal',
    organization: 'City of Baltimore',
  },
  {
    type: 'exact',
    domain: 'data.austintexas.gov',
    description: 'Austin open data portal',
    organization: 'City of Austin',
  },
  {
    type: 'exact',
    domain: 'data.boston.gov',
    description: 'Boston open data portal',
    organization: 'City of Boston',
  },
  {
    type: 'exact',
    domain: 'data.sandiego.gov',
    description: 'San Diego open data portal',
    organization: 'City of San Diego',
  },
  {
    type: 'exact',
    domain: 'opendata.denvergov.org',
    description: 'Denver open data portal',
    organization: 'City of Denver',
  },
  {
    type: 'exact',
    domain: 'data.kcmo.org',
    description: 'Kansas City open data portal',
    organization: 'City of Kansas City',
  },
  {
    type: 'exact',
    domain: 'opendataphilly.org',
    description: 'Philadelphia open data portal',
    organization: 'City of Philadelphia',
  },

  // State GIS portals
  {
    type: 'exact',
    domain: 'geodata.hawaii.gov',
    description: 'Hawaii Statewide GIS Program',
    organization: 'State of Hawaii',
  },
  {
    type: 'exact',
    domain: 'gis.legis.wisconsin.gov',
    description: 'Wisconsin Legislative Technology Services Bureau',
    organization: 'State of Wisconsin',
  },
  {
    type: 'exact',
    domain: 'gis.nc.gov',
    description: 'North Carolina OneMap',
    organization: 'State of North Carolina',
  },
  {
    type: 'exact',
    domain: 'gis.texas.gov',
    description: 'Texas Natural Resources Information System',
    organization: 'State of Texas',
  },
  {
    type: 'exact',
    domain: 'pasda.psu.edu',
    description: 'Pennsylvania Spatial Data Access',
    organization: 'Penn State / State of Pennsylvania',
  },

  // Federal data sources
  {
    type: 'exact',
    domain: 'catalog.data.gov',
    description: 'Federal open data catalog',
    organization: 'US Government',
  },
  {
    type: 'exact',
    domain: 'redistrictingdatahub.org',
    description: 'Redistricting Data Hub',
    organization: 'Redistricting Data Hub',
  },

  // International sources
  {
    type: 'exact',
    domain: 'geoportal.statistics.gov.uk',
    description: 'UK Office for National Statistics',
    organization: 'UK ONS',
  },
  {
    type: 'exact',
    domain: 'represent.opennorth.ca',
    description: 'Canada Open North',
    organization: 'Open North',
  },
  {
    type: 'exact',
    domain: 'data.gov.uk',
    description: 'UK Government open data',
    organization: 'UK Government',
  },
  {
    type: 'exact',
    domain: 'data.gov.au',
    description: 'Australian Government open data',
    organization: 'Australian Government',
  },
  {
    type: 'exact',
    domain: 'open.canada.ca',
    description: 'Canadian Government open data',
    organization: 'Government of Canada',
  },
]);

// ============================================================================
// Validation Result Types
// ============================================================================

/**
 * Result of URL validation
 */
export interface URLValidationResult {
  /** Whether the URL is allowed */
  readonly allowed: boolean;
  /** The validated/normalized URL (only if allowed) */
  readonly url?: string;
  /** Error message (only if not allowed) */
  readonly error?: string;
  /** Matched pattern (only if allowed) */
  readonly matchedPattern?: URLPattern;
}

/**
 * Security event for blocked URL
 */
export interface URLBlockedEvent {
  readonly timestamp: string;
  readonly url: string;
  readonly hostname: string;
  readonly reason: string;
  readonly source: string;
}

// ============================================================================
// URL Validation Functions
// ============================================================================

/**
 * Check if a hostname matches the allowlist patterns
 *
 * @param hostname - Hostname to check
 * @returns Matched pattern or null
 */
export function matchAllowlistPattern(hostname: string): URLPattern | null {
  const normalizedHostname = hostname.toLowerCase();

  for (const pattern of URL_ALLOWLIST_PATTERNS) {
    if (pattern.type === 'exact') {
      if (normalizedHostname === pattern.domain.toLowerCase()) {
        return pattern;
      }
    } else if (pattern.type === 'suffix') {
      // Suffix match: hostname ends with the pattern domain
      const suffix = pattern.domain.toLowerCase();
      if (normalizedHostname === suffix.slice(1) || normalizedHostname.endsWith(suffix)) {
        return pattern;
      }
    }
  }

  return null;
}

/**
 * Check if URL points to private/internal network
 *
 * SECURITY: Blocks SSRF attacks targeting internal infrastructure
 *
 * @param hostname - Hostname to check
 * @returns true if hostname is private/internal
 */
export function isPrivateHostname(hostname: string): boolean {
  // Localhost
  if (hostname === 'localhost' || hostname === '::1') {
    return true;
  }

  // Private IPv4 ranges (RFC 1918)
  const privateIPv4Regex = /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.)/;
  if (privateIPv4Regex.test(hostname)) {
    return true;
  }

  // Link-local addresses (AWS metadata, etc.)
  if (hostname.startsWith('169.254.')) {
    return true;
  }

  // IPv6 private ranges
  if (hostname === '::1' || hostname.startsWith('fe80:') || hostname.startsWith('fc') || hostname.startsWith('fd')) {
    return true;
  }

  return false;
}

/**
 * Validate a URL against the allowlist
 *
 * SECURITY: This is the primary entry point for URL validation in the discovery pipeline.
 * All fetches to external URLs MUST pass through this function.
 *
 * @param url - URL to validate
 * @param source - Source of the URL (for logging)
 * @returns Validation result
 *
 * @example
 * const result = validateDiscoveryURL('https://hub.arcgis.com/api/v3/datasets', 'arcgis-scanner');
 * if (result.allowed) {
 *   const response = await fetch(result.url);
 * } else {
 *   logger.warn('URL blocked', { error: result.error });
 * }
 */
export function validateDiscoveryURL(url: string, source: string = 'unknown'): URLValidationResult {
  // Step 1: Parse URL
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    logBlockedURL(url, 'unknown', 'Invalid URL format', source);
    return {
      allowed: false,
      error: 'Invalid URL format',
    };
  }

  // Step 2: Enforce HTTPS
  if (parsed.protocol !== 'https:') {
    logBlockedURL(url, parsed.hostname, 'URL must use HTTPS protocol', source);
    return {
      allowed: false,
      error: 'URL must use HTTPS protocol',
    };
  }

  // Step 3: Block private/internal hostnames
  if (isPrivateHostname(parsed.hostname)) {
    logBlockedURL(url, parsed.hostname, 'URL points to private/internal network', source);
    return {
      allowed: false,
      error: 'URL must not point to private IP or localhost',
    };
  }

  // Step 4: Check allowlist
  const matchedPattern = matchAllowlistPattern(parsed.hostname);
  if (!matchedPattern) {
    logBlockedURL(url, parsed.hostname, 'Domain not in allowlist', source);
    return {
      allowed: false,
      error: `Domain not in allowlist: ${parsed.hostname}`,
    };
  }

  // URL is allowed
  return {
    allowed: true,
    url: parsed.toString(),
    matchedPattern,
  };
}

/**
 * Check if a URL is safe for fetching with allowlist bypass
 *
 * SECURITY: Use this ONLY for operator-configured custom data sources.
 * The URL must still pass private IP validation.
 *
 * @param url - URL to check
 * @returns true if URL is safe (HTTPS, public IP)
 */
export function isURLSafeForBypass(url: string): boolean {
  try {
    const parsed = new URL(url);

    // Must use HTTPS
    if (parsed.protocol !== 'https:') {
      return false;
    }

    // Must not be private/internal
    if (isPrivateHostname(parsed.hostname)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Batch validate URLs from discovery results
 *
 * Use this to filter discovered URLs before attempting to fetch them.
 *
 * @param urls - Array of discovered URLs
 * @param source - Source of the URLs (for logging)
 * @returns Object with allowed and blocked URLs
 */
export function batchValidateDiscoveryURLs(
  urls: readonly string[],
  source: string = 'batch'
): { allowed: string[]; blocked: Array<{ url: string; error: string }> } {
  const allowed: string[] = [];
  const blocked: Array<{ url: string; error: string }> = [];

  for (const url of urls) {
    const result = validateDiscoveryURL(url, source);
    if (result.allowed && result.url) {
      allowed.push(result.url);
    } else {
      blocked.push({ url, error: result.error ?? 'Unknown error' });
    }
  }

  return { allowed, blocked };
}

// ============================================================================
// Security Logging
// ============================================================================

/**
 * Log a blocked URL for security monitoring
 *
 * SECURITY: All blocked URLs are logged for:
 * - Incident detection (SSRF attempts)
 * - Audit trail
 * - Pattern analysis (identifying attack patterns)
 */
function logBlockedURL(url: string, hostname: string, reason: string, source: string): void {
  const event: URLBlockedEvent = {
    timestamp: new Date().toISOString(),
    url: sanitizeURLForLog(url),
    hostname,
    reason,
    source,
  };

  logger.warn('Discovery URL blocked', {
    ...event,
    securityEvent: 'url_blocked',
  });
}

/**
 * Sanitize URL for logging (remove sensitive query parameters)
 */
function sanitizeURLForLog(url: string): string {
  try {
    const parsed = new URL(url);
    const sensitiveParams = ['key', 'token', 'password', 'secret', 'api_key', 'apikey', 'auth'];
    for (const param of sensitiveParams) {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, '[REDACTED]');
      }
    }
    // Truncate long URLs
    const result = parsed.toString();
    return result.length > 500 ? result.substring(0, 500) + '...' : result;
  } catch {
    // If URL is invalid, return truncated version
    return url.length > 100 ? url.substring(0, 100) + '...' : url;
  }
}

// ============================================================================
// Allowlist Management
// ============================================================================

/**
 * Get all allowlisted patterns (for documentation/debugging)
 */
export function getAllowlistPatterns(): readonly URLPattern[] {
  return URL_ALLOWLIST_PATTERNS;
}

/**
 * Check if a domain would be allowed (for pre-validation)
 *
 * @param hostname - Hostname to check
 * @returns true if domain is in allowlist
 */
export function isDomainAllowed(hostname: string): boolean {
  return matchAllowlistPattern(hostname) !== null;
}

/**
 * Get the pattern that matches a hostname (for debugging)
 *
 * @param hostname - Hostname to check
 * @returns Matched pattern description or null
 */
export function getMatchingPatternDescription(hostname: string): string | null {
  const pattern = matchAllowlistPattern(hostname);
  if (!pattern) {
    return null;
  }
  return `${pattern.description} (${pattern.organization})`;
}
