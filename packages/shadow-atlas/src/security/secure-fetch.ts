/**
 * Secure Fetch Utility
 *
 * SECURITY: Wraps fetch() with URL allowlist validation to prevent SSRF attacks.
 *
 * The discovery pipeline fetches URLs from search results, user input, and dynamically
 * generated patterns. Without validation, malicious URLs could trigger requests to:
 * - Internal services (localhost, 127.0.0.1, 10.x.x.x, 192.168.x.x)
 * - Cloud metadata endpoints (169.254.169.254)
 * - Private network resources
 *
 * This module provides validated fetch functions that:
 * 1. Validate URLs against the domain allowlist
 * 2. Reject private/internal IP addresses
 * 3. Enforce HTTPS protocol
 * 4. Log security events for audit purposes
 * 5. Support explicit bypass for operator-configured sources
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import { validateURL, validateURLWithOptions, isPublicURL } from './input-validator.js';
import { logger } from '../core/utils/logger.js';

/**
 * Secure fetch options
 */
export interface SecureFetchOptions extends Omit<RequestInit, 'signal'> {
  /**
   * Request timeout in milliseconds
   * @default 30000
   */
  readonly timeout?: number;

  /**
   * Bypass URL allowlist validation
   *
   * SECURITY: Only use when operators explicitly configure custom data sources.
   * The URL must still pass public IP validation.
   *
   * @default false
   */
  readonly bypassAllowlist?: boolean;

  /**
   * Reason for bypassing allowlist (required when bypassAllowlist is true)
   * This is logged for security audit purposes.
   */
  readonly bypassReason?: string;
}

/**
 * Secure fetch result
 */
export interface SecureFetchResult {
  /** Whether the URL passed validation */
  readonly validated: boolean;

  /** Whether allowlist was bypassed */
  readonly bypassed: boolean;

  /** The validated URL */
  readonly url: string;

  /** HTTP response (only present if fetch succeeded) */
  readonly response?: Response;

  /** Error message (only present if validation or fetch failed) */
  readonly error?: string;
}

/**
 * Fetch a URL with security validation
 *
 * SECURITY: This function validates URLs against the allowlist before fetching.
 * Use this for ALL external requests in the discovery pipeline.
 *
 * @param url - URL to fetch
 * @param options - Fetch options
 * @returns Secure fetch result
 *
 * @example
 * // Standard usage (allowlist enforced)
 * const result = await secureFetch('https://hub.arcgis.com/api/v3/datasets');
 * if (result.response?.ok) {
 *   const data = await result.response.json();
 * }
 *
 * @example
 * // Bypass for operator-configured source (audit logged)
 * const result = await secureFetch(operatorConfiguredUrl, {
 *   bypassAllowlist: true,
 *   bypassReason: 'Operator-configured municipal GIS endpoint',
 * });
 */
export async function secureFetch(
  url: string,
  options: SecureFetchOptions = {}
): Promise<SecureFetchResult> {
  const {
    timeout = 30000,
    bypassAllowlist = false,
    bypassReason,
    ...fetchOptions
  } = options;

  // Validate URL
  const validation = validateURLWithOptions(url, {
    bypassAllowlist,
    reason: bypassReason,
  });

  if (!validation.success) {
    const errorMessage = 'error' in validation ? validation.error : 'Validation failed';
    logger.warn('Secure fetch URL validation failed', {
      url: sanitizeUrlForLog(url),
      error: errorMessage,
    });
    return {
      validated: false,
      bypassed: false,
      url,
      error: errorMessage,
    };
  }

  // Log bypassed URLs for security audit
  if (validation.bypassed) {
    logger.info('Secure fetch allowlist bypassed', {
      url: sanitizeUrlForLog(url),
      reason: bypassReason ?? 'No reason provided',
    });
  }

  // Perform fetch with timeout
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(validation.data, {
      ...fetchOptions,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    return {
      validated: true,
      bypassed: validation.bypassed,
      url: validation.data,
      response,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Don't log timeout as warning (expected for unreachable servers)
    if (errorMessage.includes('abort')) {
      logger.debug('Secure fetch timeout', {
        url: sanitizeUrlForLog(url),
        timeout,
      });
    } else {
      logger.warn('Secure fetch failed', {
        url: sanitizeUrlForLog(url),
        error: errorMessage,
      });
    }

    return {
      validated: true,
      bypassed: validation.bypassed,
      url: validation.data,
      error: errorMessage,
    };
  }
}

/**
 * Fetch a URL that is expected to be on the allowlist
 *
 * SECURITY: This function throws if the URL is not on the allowlist.
 * Use this when you know the URL should be allowlisted and want to
 * fail fast if it's not.
 *
 * @param url - URL to fetch (must be allowlisted)
 * @param options - Standard fetch options
 * @returns HTTP Response
 * @throws Error if URL validation fails or fetch fails
 *
 * @example
 * const response = await secureFetchAllowlisted(
 *   'https://hub.arcgis.com/api/v3/datasets',
 *   { headers: { Accept: 'application/json' } }
 * );
 */
export async function secureFetchAllowlisted(
  url: string,
  options: Omit<SecureFetchOptions, 'bypassAllowlist' | 'bypassReason'> = {}
): Promise<Response> {
  const result = await secureFetch(url, {
    ...options,
    bypassAllowlist: false,
  });

  if (!result.validated) {
    throw new Error(`URL not in allowlist: ${result.error}`);
  }

  if (!result.response) {
    throw new Error(`Fetch failed: ${result.error}`);
  }

  return result.response;
}

/**
 * Validate a URL without fetching
 *
 * Use this to check if a discovered URL would be allowed before
 * attempting to fetch it.
 *
 * @param url - URL to validate
 * @returns true if URL passes validation
 */
export function isURLAllowed(url: string): boolean {
  const validation = validateURL(url);
  return validation.success;
}

/**
 * Validate that a URL is safe (public, HTTPS) even if not allowlisted
 *
 * Use this for URLs that will be fetched with bypassAllowlist option.
 *
 * @param url - URL to validate
 * @returns true if URL is safe (public, HTTPS)
 */
export function isURLSafe(url: string): boolean {
  return isPublicURL(url);
}

/**
 * Sanitize URL for logging (remove sensitive query parameters)
 */
function sanitizeUrlForLog(url: string): string {
  try {
    const parsed = new URL(url);
    // Redact potentially sensitive query parameters
    const sensitiveParams = ['key', 'token', 'password', 'secret', 'api_key', 'apikey'];
    for (const param of sensitiveParams) {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, '[REDACTED]');
      }
    }
    return parsed.toString();
  } catch {
    // If URL is invalid, truncate it for safety
    return url.length > 100 ? url.substring(0, 100) + '...' : url;
  }
}

/**
 * Batch validate URLs from discovery results
 *
 * Use this to filter discovered URLs before attempting to fetch them.
 *
 * @param urls - Array of discovered URLs
 * @returns Object with allowed and rejected URLs
 *
 * @example
 * const discovered = candidates.map(c => c.downloadUrl);
 * const { allowed, rejected } = batchValidateURLs(discovered);
 *
 * logger.warn('Rejected URLs not in allowlist', { count: rejected.length });
 *
 * for (const url of allowed) {
 *   const response = await secureFetchAllowlisted(url);
 *   // process response
 * }
 */
export function batchValidateURLs(
  urls: readonly string[]
): { allowed: string[]; rejected: Array<{ url: string; error: string }> } {
  const allowed: string[] = [];
  const rejected: Array<{ url: string; error: string }> = [];

  for (const url of urls) {
    const validation = validateURL(url);
    if (validation.success) {
      allowed.push(validation.data);
    } else {
      const errorMessage = 'error' in validation ? validation.error : 'Validation failed';
      rejected.push({ url, error: errorMessage });
    }
  }

  return { allowed, rejected };
}
