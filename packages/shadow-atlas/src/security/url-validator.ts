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

  // R77-P7: European and open-data platform domains used in discovery pipeline.
  // These were present in source configs but missing from the allowlist,
  // causing silent fetch failures in multi-country discovery runs.
  {
    type: 'exact',
    domain: 'datos.gob.es',
    description: 'Spanish Government open data portal',
    organization: 'Government of Spain',
  },
  {
    type: 'exact',
    domain: 'dati.gov.it',
    description: 'Italian Government open data portal',
    organization: 'Government of Italy',
  },
  {
    type: 'suffix',
    domain: '.opendatasoft.com',
    description: 'OpenDataSoft platform instances',
    organization: 'Opendatasoft',
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
 * Canonical private/internal address check.
 *
 * SECURITY: Single source of truth for SSRF prevention.
 * Handles all IPv4 encodings (dotted, decimal, octal, hex),
 * all IPv6 forms (full, abbreviated, mapped, compatible),
 * zone IDs, and bracket stripping.
 *
 * Unified implementation.
 */
export function isPrivateAddress(hostname: string): boolean {
  // Step 1: Strip IPv6 brackets
  let h = hostname;
  if (h.startsWith('[') && h.endsWith(']')) {
    h = h.slice(1, -1);
  }

  // Step 2: Strip zone ID (%25... or %...)
  const zoneIdx = h.indexOf('%');
  if (zoneIdx !== -1) {
    h = h.slice(0, zoneIdx);
  }

  // Step 3: Hostname literals
  if (h === 'localhost' || h === 'localhost.') return true;

  // Step 4: Try parsing as IPv4 (handles dotted, decimal, octal, hex)
  const ipv4 = parseIPv4(h);
  if (ipv4 !== null) {
    return isPrivateIPv4(ipv4);
  }

  // Step 5: Try parsing as IPv6
  const ipv6 = parseIPv6(h);
  if (ipv6 !== null) {
    // Check for IPv4-mapped (::ffff:x.x.x.x) and IPv4-compatible (::x.x.x.x)
    const mapped = extractMappedIPv4(ipv6);
    if (mapped !== null) {
      return isPrivateIPv4(mapped);
    }
    return isPrivateIPv6(ipv6);
  }

  // Step 6: Not an IP — could be a hostname. Not private by IP check.
  return false;
}

/**
 * @deprecated Use isPrivateAddress() instead. Kept for backwards compatibility.
 */
export function isPrivateHostname(hostname: string): boolean {
  return isPrivateAddress(hostname);
}

// ============================================================================
// Private IP parsing helpers (not exported)
// ============================================================================

/**
 * Parse an IPv4 address string into a 32-bit unsigned integer.
 * Handles dotted decimal, single decimal, octal (0-prefix), hex (0x-prefix).
 * Returns null if not a valid IPv4 address.
 */
function parseIPv4(addr: string): number | null {
  // Single integer form: 2130706433 → 127.0.0.1
  if (/^\d+$/.test(addr)) {
    const n = Number(addr);
    if (n >= 0 && n <= 0xFFFFFFFF && Number.isInteger(n)) {
      return n >>> 0;
    }
    return null;
  }

  // Hex form: 0x7f000001
  if (/^0x[0-9a-fA-F]+$/i.test(addr)) {
    const n = parseInt(addr, 16);
    if (n >= 0 && n <= 0xFFFFFFFF) {
      return n >>> 0;
    }
    return null;
  }

  // Dotted form: each octet can be decimal, octal (0-prefix), or hex (0x-prefix)
  const parts = addr.split('.');
  if (parts.length !== 4) return null;

  let result = 0;
  for (const part of parts) {
    let octet: number;
    if (part.startsWith('0x') || part.startsWith('0X')) {
      octet = parseInt(part, 16);
    } else if (part.startsWith('0') && part.length > 1) {
      // Octal
      octet = parseInt(part, 8);
    } else {
      octet = parseInt(part, 10);
    }
    if (isNaN(octet) || octet < 0 || octet > 255) return null;
    result = (result << 8) | octet;
  }
  return result >>> 0;
}

/**
 * Check if a 32-bit IPv4 address is in a private/reserved range.
 */
function isPrivateIPv4(ip: number): boolean {
  const b0 = (ip >>> 24) & 0xFF;
  const b1 = (ip >>> 16) & 0xFF;

  // 127.0.0.0/8 — loopback
  if (b0 === 127) return true;
  // 10.0.0.0/8
  if (b0 === 10) return true;
  // 172.16.0.0/12
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
  // 192.168.0.0/16
  if (b0 === 192 && b1 === 168) return true;
  // 169.254.0.0/16 — link-local
  if (b0 === 169 && b1 === 254) return true;
  // 0.0.0.0/8 — this network
  if (b0 === 0) return true;
  // 100.64.0.0/10 — CGNAT/shared (RFC 6598)
  if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;
  // 198.18.0.0/15 — benchmarking
  if (b0 === 198 && (b1 === 18 || b1 === 19)) return true;

  return false;
}

/**
 * Parse an IPv6 address into a 16-byte Uint8Array.
 * Handles :: shorthand, mixed IPv4 suffix (::ffff:1.2.3.4).
 * Returns null if not valid IPv6.
 */
function parseIPv6(addr: string): Uint8Array | null {
  const lower = addr.toLowerCase();

  // Must contain at least one colon to be IPv6
  if (!lower.includes(':')) return null;

  // Handle mixed IPv4 suffix (e.g., ::ffff:192.168.1.1)
  let ipv6Part = lower;
  let ipv4Suffix: number | null = null;
  const lastColon = lower.lastIndexOf(':');
  const possibleIPv4 = lower.slice(lastColon + 1);
  if (possibleIPv4.includes('.')) {
    ipv4Suffix = parseIPv4(possibleIPv4);
    if (ipv4Suffix === null) return null;
    ipv6Part = lower.slice(0, lastColon + 1) + '0:0';  // placeholder
  }

  // Split on ::
  const doubleSplit = ipv6Part.split('::');
  if (doubleSplit.length > 2) return null;  // multiple :: not allowed

  let groups: number[];
  if (doubleSplit.length === 2) {
    const left = doubleSplit[0] ? doubleSplit[0].split(':') : [];
    const right = doubleSplit[1] ? doubleSplit[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    if (missing < 0) return null;
    groups = [
      ...left.map(g => parseInt(g || '0', 16)),
      ...Array(missing).fill(0) as number[],
      ...right.map(g => parseInt(g || '0', 16)),
    ];
  } else {
    groups = ipv6Part.split(':').map(g => parseInt(g, 16));
  }

  if (groups.length !== 8) return null;
  if (groups.some(g => isNaN(g) || g < 0 || g > 0xFFFF)) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    bytes[i * 2] = (groups[i] >>> 8) & 0xFF;
    bytes[i * 2 + 1] = groups[i] & 0xFF;
  }

  // Replace last 4 bytes with actual IPv4 if mixed notation
  if (ipv4Suffix !== null) {
    bytes[12] = (ipv4Suffix >>> 24) & 0xFF;
    bytes[13] = (ipv4Suffix >>> 16) & 0xFF;
    bytes[14] = (ipv4Suffix >>> 8) & 0xFF;
    bytes[15] = ipv4Suffix & 0xFF;
  }

  return bytes;
}

/**
 * Extract IPv4 from IPv4-mapped (::ffff:x.x.x.x) or IPv4-compatible (::x.x.x.x) IPv6.
 * Returns the 32-bit IPv4 or null.
 */
function extractMappedIPv4(ipv6: Uint8Array): number | null {
  // ::ffff:x.x.x.x — bytes 0-9 are 0, bytes 10-11 are 0xFF
  const isMapped = ipv6.slice(0, 10).every(b => b === 0) &&
                   ipv6[10] === 0xFF && ipv6[11] === 0xFF;
  // ::x.x.x.x — all first 12 bytes are 0 (IPv4-compatible, deprecated but still seen)
  const isCompatible = ipv6.slice(0, 12).every(b => b === 0) &&
                       (ipv6[12] !== 0 || ipv6[13] !== 0 || ipv6[14] !== 0 || ipv6[15] !== 0);

  if (isMapped || isCompatible) {
    return ((ipv6[12] << 24) | (ipv6[13] << 16) | (ipv6[14] << 8) | ipv6[15]) >>> 0;
  }
  return null;
}

/**
 * Check if a 16-byte IPv6 address is private/reserved.
 */
function isPrivateIPv6(ipv6: Uint8Array): boolean {
  // ::1 — loopback
  if (ipv6.slice(0, 15).every(b => b === 0) && ipv6[15] === 1) return true;
  // :: (all zeros) — unspecified
  if (ipv6.every(b => b === 0)) return true;
  // fc00::/7 — unique local (ULA)
  if ((ipv6[0] & 0xFE) === 0xFC) return true;
  // fe80::/10 — link-local
  if (ipv6[0] === 0xFE && (ipv6[1] & 0xC0) === 0x80) return true;
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
 * const response = await fetch(result.url);
 * } else {
 * logger.warn('URL blocked', { error: result.error });
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
  if (isPrivateAddress(parsed.hostname)) {
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
    if (isPrivateAddress(parsed.hostname)) {
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
