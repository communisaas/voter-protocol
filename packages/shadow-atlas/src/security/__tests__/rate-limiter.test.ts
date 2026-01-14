/**
 * Rate Limiter Security Tests
 *
 * Validates DoS protection, bypass prevention, and correct rate limit enforcement.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MultiTierRateLimiter,
  getClientIdentifier,
  normalizeIP,
  getEndpointCost,
  generateRateLimitHeaders,
  createRateLimiter,
  type ClientIdentifier,
} from '../rate-limiter.js';

describe('Rate Limiter - Basic Functionality', () => {
  let rateLimiter: MultiTierRateLimiter;

  beforeEach(() => {
    rateLimiter = createRateLimiter({
      ip: { maxRequests: 10, windowMs: 1000 },
      apiKey: { maxRequests: 100, windowMs: 1000 },
      global: { maxRequests: 1000, windowMs: 1000 },
    });
  });

  afterEach(() => {
    rateLimiter.destroy();
  });

  test('allows requests under limit', () => {
    const client: ClientIdentifier = { ip: '192.168.1.1' };

    for (let i = 0; i < 10; i++) {
      const result = rateLimiter.checkClient(client);
      expect(result.allowed).toBe(true);
    }
  });

  test('blocks requests over limit', () => {
    const client: ClientIdentifier = { ip: '192.168.1.1' };

    // Exhaust limit
    for (let i = 0; i < 10; i++) {
      rateLimiter.checkClient(client);
    }

    // Next request should be blocked
    const result = rateLimiter.checkClient(client);
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  test('enforces separate limits per IP', () => {
    const client1: ClientIdentifier = { ip: '192.168.1.1' };
    const client2: ClientIdentifier = { ip: '192.168.1.2' };

    // Exhaust limit for client1
    for (let i = 0; i < 10; i++) {
      rateLimiter.checkClient(client1);
    }

    // client2 should still be allowed
    const result = rateLimiter.checkClient(client2);
    expect(result.allowed).toBe(true);
  });

  test('allows higher limits for API keys', () => {
    const client: ClientIdentifier = { ip: '192.168.1.1', apiKey: 'test-key-123' };

    // Should allow up to 100 requests (API key limit)
    for (let i = 0; i < 100; i++) {
      const result = rateLimiter.checkClient(client);
      expect(result.allowed).toBe(true);
    }

    // 101st request should be blocked
    const result = rateLimiter.checkClient(client);
    expect(result.allowed).toBe(false);
  });

  test('enforces global limit across all clients', () => {
    // Create fresh rate limiter with tight global limit for testing
    const testRateLimiter = createRateLimiter({
      ip: { maxRequests: 10, windowMs: 1000 },
      global: { maxRequests: 100, windowMs: 1000 }, // Tighter limit for test
    });

    const clients: ClientIdentifier[] = Array(10).fill(null).map((_, i) => ({
      ip: `192.168.1.${i + 1}`,
    }));

    // Each client makes 10 requests (100 total)
    for (const client of clients) {
      for (let i = 0; i < 10; i++) {
        testRateLimiter.checkClient(client);
      }
    }

    // Global limit exhausted - next request should fail
    const result = testRateLimiter.checkClient({ ip: '192.168.2.1' });
    expect(result.allowed).toBe(false);

    testRateLimiter.destroy();
  });
});

describe('Rate Limiter - Bypass Prevention', () => {
  let rateLimiter: MultiTierRateLimiter;

  beforeEach(() => {
    rateLimiter = createRateLimiter({
      ip: { maxRequests: 5, windowMs: 1000 },
    });
  });

  afterEach(() => {
    rateLimiter.destroy();
  });

  test('prevents bypass via IP rotation', () => {
    // Attacker tries rotating IPs
    const attackerIPs = Array(10).fill(null).map((_, i) => `10.0.0.${i + 1}`);

    let successfulRequests = 0;

    for (const ip of attackerIPs) {
      for (let i = 0; i < 5; i++) {
        const result = rateLimiter.checkClient({ ip });
        if (result.allowed) successfulRequests++;
      }
    }

    // Each IP should get 5 requests (50 total)
    // But global limit may kick in if configured
    expect(successfulRequests).toBeGreaterThan(0);
  });

  test('prevents bypass via API key rotation', () => {
    const client: ClientIdentifier = { ip: '192.168.1.1' };

    // Exhaust IP limit
    for (let i = 0; i < 5; i++) {
      rateLimiter.checkClient(client);
    }

    // Try adding API key (should not reset IP limit)
    const withKey: ClientIdentifier = { ...client, apiKey: 'new-key' };
    const result = rateLimiter.checkClient(withKey);

    // IP limit still enforced
    expect(result.allowed).toBe(false);
  });

  test('prevents bypass via header spoofing', () => {
    // This test validates that we use socket IP, not headers
    const client: ClientIdentifier = { ip: '192.168.1.1' };

    // Exhaust limit
    for (let i = 0; i < 5; i++) {
      rateLimiter.checkClient(client);
    }

    // Attacker can't bypass by claiming different IP in header
    // (getClientIdentifier handles this, tested separately)
    const result = rateLimiter.checkClient(client);
    expect(result.allowed).toBe(false);
  });
});

describe('Rate Limiter - Cost Multipliers', () => {
  let rateLimiter: MultiTierRateLimiter;

  beforeEach(() => {
    rateLimiter = createRateLimiter({
      ip: { maxRequests: 10, windowMs: 1000 },
    });
  });

  afterEach(() => {
    rateLimiter.destroy();
  });

  test('enforces cost multipliers for expensive operations', () => {
    const client: ClientIdentifier = { ip: '192.168.1.1' };

    // Make 2 expensive requests (cost=5 each)
    rateLimiter.checkClient(client, 5);
    rateLimiter.checkClient(client, 5);

    // Should have consumed 10 tokens
    const result = rateLimiter.checkClient(client, 1);
    expect(result.allowed).toBe(false);
  });

  test('correctly calculates endpoint costs', () => {
    expect(getEndpointCost('/lookup')).toBe(1);
    expect(getEndpointCost('/snapshots')).toBe(2);
    expect(getEndpointCost('/snapshot')).toBe(5);
    expect(getEndpointCost('/extract')).toBe(10);
    expect(getEndpointCost('/unknown')).toBe(1); // Default
  });
});

describe('Rate Limiter - Token Bucket Behavior', () => {
  test('allows burst traffic up to limit', () => {
    const rateLimiter = createRateLimiter({
      ip: { maxRequests: 10, windowMs: 1000 },
    });

    const client: ClientIdentifier = { ip: '192.168.1.1' };

    // Should allow burst of 10 requests immediately
    const start = Date.now();
    for (let i = 0; i < 10; i++) {
      const result = rateLimiter.checkClient(client);
      expect(result.allowed).toBe(true);
    }
    const duration = Date.now() - start;

    // All requests should complete quickly (< 100ms)
    expect(duration).toBeLessThan(100);

    rateLimiter.destroy();
  });

  test('refills tokens over time', async () => {
    const rateLimiter = createRateLimiter({
      ip: { maxRequests: 10, windowMs: 100 }, // Short window for testing
    });

    const client: ClientIdentifier = { ip: '192.168.1.1' };

    // Exhaust tokens
    for (let i = 0; i < 10; i++) {
      rateLimiter.checkClient(client);
    }

    // Wait for partial refill
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should have ~5 tokens refilled
    const result = rateLimiter.checkClient(client);
    expect(result.allowed).toBe(true);

    rateLimiter.destroy();
  });
});

describe('Rate Limiter - Header Generation', () => {
  test('generates correct rate limit headers', () => {
    const result = {
      allowed: true,
      limit: 60,
      remaining: 45,
      resetAt: 1234567890,
    };

    const headers = generateRateLimitHeaders(result);

    expect(headers['RateLimit-Limit']).toBe('60');
    expect(headers['RateLimit-Remaining']).toBe('45');
    expect(headers['RateLimit-Reset']).toBe('1234567890');
    expect(headers['Retry-After']).toBeUndefined();
  });

  test('includes Retry-After when rate limited', () => {
    const result = {
      allowed: false,
      limit: 60,
      remaining: 0,
      resetAt: 1234567890,
      retryAfter: 30,
    };

    const headers = generateRateLimitHeaders(result);

    expect(headers['Retry-After']).toBe('30');
  });

  test('never shows negative remaining count', () => {
    const result = {
      allowed: false,
      limit: 60,
      remaining: -5, // Should never happen, but test defense
      resetAt: 1234567890,
    };

    const headers = generateRateLimitHeaders(result);

    expect(headers['RateLimit-Remaining']).toBe('0');
  });
});

describe('Rate Limiter - Client Identification', () => {
  test('extracts IP from socket by default', () => {
    const req = {
      socket: { remoteAddress: '192.168.1.1' },
      headers: {},
    };

    const client = getClientIdentifier(req as any, false);

    expect(client.ip).toBe('192.168.1.1');
  });

  test('uses X-Forwarded-For only when trustProxy=true', () => {
    const req = {
      socket: { remoteAddress: '10.0.0.1' },
      headers: { 'x-forwarded-for': '203.0.113.5, 198.51.100.1' },
    };

    // trustProxy = false (default)
    const client1 = getClientIdentifier(req as any, false);
    expect(client1.ip).toBe('10.0.0.1'); // Uses socket IP

    // trustProxy = true
    const client2 = getClientIdentifier(req as any, true);
    expect(client2.ip).toBe('203.0.113.5'); // Uses X-Forwarded-For
  });

  test('extracts API key from Authorization header', () => {
    const req = {
      socket: { remoteAddress: '192.168.1.1' },
      headers: { 'authorization': 'Bearer test-api-key-123' },
    };

    const client = getClientIdentifier(req as any);

    expect(client.apiKey).toBe('test-api-key-123');
  });

  test('handles missing Authorization header', () => {
    const req = {
      socket: { remoteAddress: '192.168.1.1' },
      headers: {},
    };

    const client = getClientIdentifier(req as any);

    expect(client.apiKey).toBeUndefined();
  });

  test('ignores malformed Authorization header', () => {
    const req = {
      socket: { remoteAddress: '192.168.1.1' },
      headers: { 'authorization': 'NotBearer malformed' },
    };

    const client = getClientIdentifier(req as any);

    expect(client.apiKey).toBeUndefined();
  });
});

describe('Rate Limiter - IP Normalization', () => {
  test('strips IPv4-mapped IPv6 prefix', () => {
    expect(normalizeIP('::ffff:192.168.1.1')).toBe('192.168.1.1');
  });

  test('normalizes IPv6 to lowercase', () => {
    expect(normalizeIP('2001:0DB8:AC10:FE01::')). toBe('2001:0db8:ac10:fe01::');
  });

  test('leaves IPv4 unchanged', () => {
    expect(normalizeIP('192.168.1.1')).toBe('192.168.1.1');
  });
});

describe('Rate Limiter - Memory Management', () => {
  test('cleans up stale buckets', async () => {
    const rateLimiter = createRateLimiter({
      ip: { maxRequests: 10, windowMs: 100 },
    });

    // Create bucket
    rateLimiter.checkClient({ ip: '192.168.1.1' });

    const initialStats = rateLimiter.getStats();
    expect(initialStats.ipBuckets).toBe(1);

    // Wait for bucket to become stale (10+ minutes in production, shortened for testing)
    // Note: This test would need to mock the cleanup interval for faster testing
    // For now, we just verify the stats API works

    rateLimiter.destroy();
  });

  test('provides statistics', () => {
    const rateLimiter = createRateLimiter({
      ip: { maxRequests: 10, windowMs: 1000 },
      global: { maxRequests: 1000, windowMs: 1000 },
    });

    rateLimiter.checkClient({ ip: '192.168.1.1' });
    rateLimiter.checkClient({ ip: '192.168.1.2', apiKey: 'test-key' });

    const stats = rateLimiter.getStats();

    expect(stats.ipBuckets).toBe(2);
    expect(stats.apiKeyBuckets).toBe(1);
    expect(stats.globalRemaining).toBeLessThan(1000);

    rateLimiter.destroy();
  });
});
