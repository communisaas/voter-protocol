/**
 * Tests for fetchWithSizeLimit and fetchBufferWithSizeLimit.
 *
 * Uses mock fetch to simulate oversized responses, content-length headers,
 * and normal responses without hitting real endpoints.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchWithSizeLimit,
  fetchBufferWithSizeLimit,
  DEFAULT_MAX_BYTES,
} from '../../../hydration/fetch-with-size-limit.js';

// ============================================================================
// Helpers
// ============================================================================

/** Create a ReadableStream from a string, yielding in chunks */
function stringToStream(data: string, chunkSize = 1024): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(data);
  let offset = 0;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const chunk = bytes.slice(offset, offset + chunkSize);
      offset += chunkSize;
      controller.enqueue(chunk);
    },
  });
}

/** Create a ReadableStream from a Buffer, yielding in chunks */
function bufferToStream(data: Buffer, chunkSize = 1024): ReadableStream<Uint8Array> {
  let offset = 0;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= data.length) {
        controller.close();
        return;
      }
      const chunk = new Uint8Array(data.buffer, data.byteOffset + offset, Math.min(chunkSize, data.length - offset));
      offset += chunkSize;
      controller.enqueue(chunk);
    },
  });
}

function mockFetchResponse(
  body: ReadableStream<Uint8Array>,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers(headers),
    body,
  } as unknown as Response;
}

// ============================================================================
// Tests
// ============================================================================

describe('fetchWithSizeLimit', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns text for normal responses within limit', async () => {
    const content = 'Hello, world!';
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockFetchResponse(stringToStream(content), 200),
    );

    const result = await fetchWithSizeLimit('https://example.com/data.csv', 1024);
    expect(result).toBe(content);
  });

  it('rejects responses exceeding maxBytes during streaming', async () => {
    // Create a response that's 200 bytes but set limit to 100
    const content = 'A'.repeat(200);
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockFetchResponse(stringToStream(content, 50), 200),
    );

    await expect(
      fetchWithSizeLimit('https://example.com/big.csv', 100),
    ).rejects.toThrow('exceeds size limit');
  });

  it('rejects responses when content-length header exceeds limit', async () => {
    const cancelFn = vi.fn();
    const body = stringToStream('small');
    // Wrap body.cancel so we can verify it was called
    const mockBody = {
      ...body,
      cancel: cancelFn,
    };
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockFetchResponse(mockBody as unknown as ReadableStream<Uint8Array>, 200, {
        'content-length': '999999999',
      }),
    );

    await expect(
      fetchWithSizeLimit('https://example.com/huge.csv', 1024),
    ).rejects.toThrow('exceeds size limit');
  });

  it('throws on HTTP errors', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockFetchResponse(stringToStream(''), 500),
    );

    await expect(
      fetchWithSizeLimit('https://example.com/fail'),
    ).rejects.toThrow('500');
  });

  it('uses DEFAULT_MAX_BYTES when no limit specified', () => {
    expect(DEFAULT_MAX_BYTES).toBe(104_857_600);
  });

  it('returns empty string for null body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      body: null,
    });

    const result = await fetchWithSizeLimit('https://example.com/empty');
    expect(result).toBe('');
  });
});

describe('fetchBufferWithSizeLimit', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns Buffer for normal responses within limit', async () => {
    const data = Buffer.from('binary data here');
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockFetchResponse(bufferToStream(data), 200),
    );

    const result = await fetchBufferWithSizeLimit('https://example.com/data.zip', 1024);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.toString()).toBe('binary data here');
  });

  it('rejects responses exceeding maxBytes during streaming', async () => {
    const data = Buffer.alloc(200, 0x42);
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockFetchResponse(bufferToStream(data, 50), 200),
    );

    await expect(
      fetchBufferWithSizeLimit('https://example.com/big.zip', 100),
    ).rejects.toThrow('exceeds size limit');
  });

  it('returns empty Buffer for null body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      body: null,
    });

    const result = await fetchBufferWithSizeLimit('https://example.com/empty');
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBe(0);
  });
});
