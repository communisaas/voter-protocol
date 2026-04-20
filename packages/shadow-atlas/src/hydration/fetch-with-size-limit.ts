/**
 * Size-limited fetch utility for bulk data downloads.
 *
 * Streams the response body and aborts if the total bytes exceed
 * a configurable maximum, preventing memory exhaustion from
 * malicious or misconfigured servers.
 *
 * NOTE: DNS rebinding is a known limitation — we validate the hostname
 * string, not the resolved IP. For DNS-resolution-level SSRF prevention,
 * use the secure-fetch.ts module instead.
 *
 * @packageDocumentation
 */

import { isPrivateAddress } from '../security/url-validator.js';

/** Default maximum response size: 100 MB */
export const DEFAULT_MAX_BYTES = 104_857_600;

/**
 * Validate URL before fetch — SSRF prevention.
 * IP validation + protocol scheme check.
 *
 * @param url - URL to validate
 * @param allowPrivate - If true, skip private IP check (for dev/testing only)
 * @throws Error if URL targets private IP or uses non-http(s) scheme
 */
function validateFetchTarget(url: string, allowPrivate: boolean): void {
  const parsed = new URL(url);

  // Block non-http(s) schemes (file://, ftp://, data://, etc.)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`fetchWithSizeLimit: blocked non-HTTP scheme: ${parsed.protocol}`);
  }

  // Block private/internal IPs (SSRF prevention)
  if (!allowPrivate && isPrivateAddress(parsed.hostname)) {
    throw new Error(`fetchWithSizeLimit: blocked private address: ${parsed.hostname}`);
  }
}

/**
 * Fetch a URL and return the response as text, aborting if the response
 * body exceeds `maxBytes`.
 *
 * @param url - URL to fetch
 * @param maxBytes - Maximum allowed response size in bytes (default: 100 MB)
 * @param init - Optional fetch RequestInit (headers, signal, etc.)
 * @param options - Optional settings (e.g. allowPrivate for dev/testing)
 * @returns The response body as a string
 * @throws Error if the response body exceeds maxBytes or the request fails
 */
export async function fetchWithSizeLimit(
  url: string,
  maxBytes: number = DEFAULT_MAX_BYTES,
  init?: RequestInit,
  options?: { readonly allowPrivate?: boolean },
): Promise<string> {
  // Validate target before fetch.
  validateFetchTarget(url, options?.allowPrivate ?? false);
  // R66-C1 + R67-H1: Prevent silent redirect-following (SSRF vector).
  // Spread order: caller's init first, then redirect: 'error' — cannot be overridden.
  const mergedInit: RequestInit = { ...init, redirect: 'error' };
  const response = await fetch(url, mergedInit);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
    );
  }

  // If content-length is known and exceeds limit, fail immediately
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const declared = parseInt(contentLength, 10);
    if (!isNaN(declared) && declared > maxBytes) {
      // Consume/cancel body to avoid connection leak
      await response.body?.cancel();
      throw new Error(
        `Response from ${url} exceeds size limit: ${declared} bytes > ${maxBytes} bytes`,
      );
    }
  }

  // Stream the body and track bytes read
  const body = response.body;
  if (!body) {
    return '';
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error(
          `Response from ${url} exceeds size limit: read ${totalBytes} bytes > ${maxBytes} bytes`,
        );
      }

      chunks.push(value);
    }
  } catch (err) {
    // Re-throw size limit errors as-is; wrap others
    if (err instanceof Error && err.message.includes('exceeds size limit')) {
      throw err;
    }
    throw new Error(`Failed to read response from ${url}: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Decode chunks to string
  const decoder = new TextDecoder('utf-8');
  let result = '';
  for (let i = 0; i < chunks.length; i++) {
    result += decoder.decode(chunks[i], { stream: i < chunks.length - 1 });
  }
  return result;
}

/**
 * Fetch a URL and return the response as a Buffer, aborting if the response
 * body exceeds `maxBytes`.
 *
 * @param url - URL to fetch
 * @param maxBytes - Maximum allowed response size in bytes (default: 100 MB)
 * @param init - Optional fetch RequestInit (headers, signal, etc.)
 * @param options - Optional settings (e.g. allowPrivate for dev/testing)
 * @returns The response body as a Buffer
 * @throws Error if the response body exceeds maxBytes or the request fails
 */
export async function fetchBufferWithSizeLimit(
  url: string,
  maxBytes: number = DEFAULT_MAX_BYTES,
  init?: RequestInit,
  options?: { readonly allowPrivate?: boolean },
): Promise<Buffer> {
  // Validate target before fetch.
  validateFetchTarget(url, options?.allowPrivate ?? false);
  // R66-C1 + R67-H1: Prevent silent redirect-following (SSRF vector).
  // Spread order: caller's init first, then redirect: 'error' — cannot be overridden.
  const mergedInit: RequestInit = { ...init, redirect: 'error' };
  const response = await fetch(url, mergedInit);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
    );
  }

  // If content-length is known and exceeds limit, fail immediately
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const declared = parseInt(contentLength, 10);
    if (!isNaN(declared) && declared > maxBytes) {
      await response.body?.cancel();
      throw new Error(
        `Response from ${url} exceeds size limit: ${declared} bytes > ${maxBytes} bytes`,
      );
    }
  }

  const body = response.body;
  if (!body) {
    return Buffer.alloc(0);
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error(
          `Response from ${url} exceeds size limit: read ${totalBytes} bytes > ${maxBytes} bytes`,
        );
      }

      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('exceeds size limit')) {
      throw err;
    }
    throw new Error(`Failed to read response from ${url}: ${err instanceof Error ? err.message : String(err)}`);
  }

  return Buffer.concat(chunks);
}
