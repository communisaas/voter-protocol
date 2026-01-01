/**
 * TIGER Cache Expiration Tests
 *
 * Verifies cache TTL based on TIGER release schedule:
 * - TIGER data released September 1st annually
 * - Cache expires after grace period (default: 30 days)
 * - Example: 2024 cache expires October 1, 2025
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, utimesSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { TIGERBoundaryProvider } from '../../../providers/tiger-boundary-provider.js';

describe('TIGERBoundaryProvider - Cache Expiration', () => {
  const testCacheDir = join(process.cwd(), 'test-cache-expiration');

  beforeEach(() => {
    // Clean up test cache directory
    if (existsSync(testCacheDir)) {
      rmSync(testCacheDir, { recursive: true });
    }
    mkdirSync(testCacheDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up after tests
    if (existsSync(testCacheDir)) {
      rmSync(testCacheDir, { recursive: true });
    }
    // Restore system time
    vi.useRealTimers();
  });

  describe('isCacheStale', () => {
    it('should treat cache as fresh before expiration date', async () => {
      // Setup: Create cache file from 2024 data, check in August 2025
      const provider = new TIGERBoundaryProvider({
        cacheDir: testCacheDir,
        year: 2024,
        autoExpireCache: true,
        gracePeriodDays: 30,
      });

      const cacheFile = join(testCacheDir, '2024', 'CD', 'national.geojson');
      mkdirSync(join(testCacheDir, '2024', 'CD'), { recursive: true });
      writeFileSync(cacheFile, JSON.stringify({ type: 'FeatureCollection', features: [] }));

      // Set file timestamp to January 2025 (before Sept 1, 2025 + 30 days)
      const jan2025 = new Date('2025-01-15T00:00:00.000Z');
      utimesSync(cacheFile, jan2025, jan2025);

      // Mock current date to August 2025 (before expiration: Oct 1, 2025)
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-08-15T00:00:00.000Z'));

      // Test: Cache should be fresh (not stale)
      const isStale = (provider as never)['isCacheStale'](cacheFile);

      expect(isStale).toBe(false);
    });

    it('should treat cache as stale after expiration date', async () => {
      // Setup: Create cache file from 2024 data, check in November 2025
      const provider = new TIGERBoundaryProvider({
        cacheDir: testCacheDir,
        year: 2024,
        autoExpireCache: true,
        gracePeriodDays: 30,
      });

      const cacheFile = join(testCacheDir, '2024', 'CD', 'national.geojson');
      mkdirSync(join(testCacheDir, '2024', 'CD'), { recursive: true });
      writeFileSync(cacheFile, JSON.stringify({ type: 'FeatureCollection', features: [] }));

      // Set file timestamp to January 2025 (before Sept 1, 2025 release)
      const jan2025 = new Date('2025-01-15T00:00:00.000Z');
      utimesSync(cacheFile, jan2025, jan2025);

      // Mock current date to November 2025 (after Oct 1, 2025 expiration)
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-11-15T00:00:00.000Z'));

      // Test: Cache should be stale
      const isStale = (provider as never)['isCacheStale'](cacheFile);

      expect(isStale).toBe(true);
    });

    it('should treat cache as fresh if created after release date', async () => {
      // Setup: Create cache file AFTER Sept 1, 2025 release
      const provider = new TIGERBoundaryProvider({
        cacheDir: testCacheDir,
        year: 2024,
        autoExpireCache: true,
        gracePeriodDays: 30,
      });

      const cacheFile = join(testCacheDir, '2024', 'CD', 'national.geojson');
      mkdirSync(join(testCacheDir, '2024', 'CD'), { recursive: true });
      writeFileSync(cacheFile, JSON.stringify({ type: 'FeatureCollection', features: [] }));

      // Set file timestamp to September 15, 2025 (AFTER Sept 1 release)
      const sept2025 = new Date('2025-09-15T00:00:00.000Z');
      utimesSync(cacheFile, sept2025, sept2025);

      // Mock current date to November 2025 (after expiration date)
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-11-15T00:00:00.000Z'));

      // Test: Cache should be fresh (created after release date)
      const isStale = (provider as never)['isCacheStale'](cacheFile);

      expect(isStale).toBe(false);
    });

    it('should respect autoExpireCache=false configuration', async () => {
      // Setup: Disable auto-expire
      const provider = new TIGERBoundaryProvider({
        cacheDir: testCacheDir,
        year: 2024,
        autoExpireCache: false, // Disabled
        gracePeriodDays: 30,
      });

      const cacheFile = join(testCacheDir, '2024', 'CD', 'national.geojson');
      mkdirSync(join(testCacheDir, '2024', 'CD'), { recursive: true });
      writeFileSync(cacheFile, JSON.stringify({ type: 'FeatureCollection', features: [] }));

      // Set file timestamp to January 2025 (way before expiration)
      const jan2025 = new Date('2025-01-15T00:00:00.000Z');
      utimesSync(cacheFile, jan2025, jan2025);

      // Mock current date to December 2025 (way after expiration)
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-12-15T00:00:00.000Z'));

      // Test: Cache should NOT be stale (auto-expire disabled)
      const isStale = (provider as never)['isCacheStale'](cacheFile);

      expect(isStale).toBe(false);
    });

    it('should respect custom grace period', async () => {
      // Setup: Use 60-day grace period instead of default 30
      const provider = new TIGERBoundaryProvider({
        cacheDir: testCacheDir,
        year: 2024,
        autoExpireCache: true,
        gracePeriodDays: 60, // 60 days
      });

      const cacheFile = join(testCacheDir, '2024', 'CD', 'national.geojson');
      mkdirSync(join(testCacheDir, '2024', 'CD'), { recursive: true });
      writeFileSync(cacheFile, JSON.stringify({ type: 'FeatureCollection', features: [] }));

      // Set file timestamp to January 2025
      const jan2025 = new Date('2025-01-15T00:00:00.000Z');
      utimesSync(cacheFile, jan2025, jan2025);

      // Mock current date to October 15, 2025 (after 30-day grace, before 60-day grace)
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-10-15T00:00:00.000Z'));

      // Test: Cache should be fresh with 60-day grace (Sept 1 + 60 = Oct 31)
      const isStale = (provider as never)['isCacheStale'](cacheFile);

      expect(isStale).toBe(false);
    });

    it('should return false for missing cache files', async () => {
      const provider = new TIGERBoundaryProvider({
        cacheDir: testCacheDir,
        year: 2024,
        autoExpireCache: true,
      });

      const nonExistentFile = join(testCacheDir, '2024', 'CD', 'missing.geojson');

      // Test: Should return false (not stale) for missing files
      const isStale = (provider as never)['isCacheStale'](nonExistentFile);

      expect(isStale).toBe(false);
    });
  });

  describe('getCacheStatus', () => {
    it('should return correct cache status', async () => {
      const provider = new TIGERBoundaryProvider({
        cacheDir: testCacheDir,
        year: 2024,
        autoExpireCache: true,
        gracePeriodDays: 30,
      });

      const status = await provider.getCacheStatus();

      expect(status.tigerYear).toBe(2024);
      expect(status.autoExpireEnabled).toBe(true);
      expect(status.gracePeriodDays).toBe(30);
      expect(status.cacheDir).toBe(testCacheDir);

      // Next expiration should be October 1, 2025 (Sept 1 + 30 days)
      const expectedExpiration = new Date('2025-10-01T00:00:00.000Z');
      expect(status.nextExpiration.toISOString()).toBe(expectedExpiration.toISOString());
    });

    it('should reflect disabled auto-expire in status', async () => {
      const provider = new TIGERBoundaryProvider({
        cacheDir: testCacheDir,
        year: 2024,
        autoExpireCache: false,
        gracePeriodDays: 45,
      });

      const status = await provider.getCacheStatus();

      expect(status.autoExpireEnabled).toBe(false);
      expect(status.gracePeriodDays).toBe(45);
    });
  });

  describe('Cache Expiration Logic Examples', () => {
    it('Example: 2024 cache expires October 1, 2025 (default 30-day grace)', () => {
      // TIGER 2024 data → Released September 1, 2025 → Expires October 1, 2025
      const releaseDate = Date.UTC(2025, 8, 1); // Sept 1, 2025 (UTC)
      const expirationDate = new Date(releaseDate + 30 * 24 * 60 * 60 * 1000);

      expect(expirationDate.toISOString()).toBe('2025-10-01T00:00:00.000Z');
    });

    it('Example: 2023 cache expired October 1, 2024', () => {
      // TIGER 2023 data → Released September 1, 2024 → Expired October 1, 2024
      const releaseDate = Date.UTC(2024, 8, 1); // Sept 1, 2024 (UTC)
      const expirationDate = new Date(releaseDate + 30 * 24 * 60 * 60 * 1000);

      expect(expirationDate.toISOString()).toBe('2024-10-01T00:00:00.000Z');
    });
  });
});
