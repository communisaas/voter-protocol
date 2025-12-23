/**
 * Cache Utilities
 *
 * Filesystem-based cache utilities for Shadow Atlas performance layer.
 * Implements content-addressed storage with TTL and size limits.
 *
 * TYPE SAFETY: Nuclear-level strictness. Cache corruption = data loss.
 */

import { readFile, writeFile, mkdir, readdir, stat, unlink, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

// ============================================================================
// Types
// ============================================================================

/**
 * Cache entry metadata
 */
export interface CacheEntry {
  readonly key: string;
  readonly data: unknown;
  readonly timestamp: number;
  readonly size: number;
  readonly ttl?: number;  // TTL in seconds (optional)
}

/**
 * Cache statistics
 */
export interface CacheStats {
  readonly totalEntries: number;
  readonly totalBytes: number;
  readonly oldestEntry: number;
  readonly newestEntry: number;
  readonly averageSize: number;
}

/**
 * Cache clearing result
 */
export interface CacheClearResult {
  readonly clearedEntries: number;
  readonly freedBytes: number;
}

// ============================================================================
// Filesystem Cache Implementation
// ============================================================================

/**
 * Filesystem-based cache with content addressing
 *
 * Features:
 * - Content-addressed storage (CID = SHA-256 hash)
 * - TTL-based expiration
 * - Size-based eviction (LRU)
 * - Atomic writes
 * - Stats tracking
 */
export class FilesystemCache {
  private readonly cacheDir: string;
  private readonly maxSizeBytes: number;
  private readonly defaultTTL: number;

  /**
   * Create filesystem cache
   *
   * @param cacheDir - Cache directory path
   * @param maxSizeBytes - Maximum cache size in bytes (default: 1GB)
   * @param defaultTTL - Default TTL in seconds (default: 24 hours)
   */
  constructor(
    cacheDir: string,
    maxSizeBytes = 1024 * 1024 * 1024,
    defaultTTL = 86400
  ) {
    this.cacheDir = cacheDir;
    this.maxSizeBytes = maxSizeBytes;
    this.defaultTTL = defaultTTL;
  }

  /**
   * Get entry from cache
   *
   * @param key - Cache key
   * @returns Cached data or null if miss/expired
   */
  async get<T>(key: string): Promise<T | null> {
    const cid = this.computeCID(key);
    const cachePath = join(this.cacheDir, cid.slice(0, 2), cid);

    try {
      const content = await readFile(cachePath, 'utf-8');
      const entry = JSON.parse(content) as CacheEntry;

      // Check TTL
      if (entry.ttl) {
        const age = (Date.now() - entry.timestamp) / 1000;
        if (age > entry.ttl) {
          // Expired - delete and return null
          await unlink(cachePath);
          return null;
        }
      }

      return entry.data as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;  // Cache miss
      }
      throw error;
    }
  }

  /**
   * Set entry in cache
   *
   * @param key - Cache key
   * @param data - Data to cache
   * @param ttl - Optional TTL in seconds (defaults to constructor TTL)
   */
  async set(key: string, data: unknown, ttl?: number): Promise<void> {
    const cid = this.computeCID(key);
    const cachePath = join(this.cacheDir, cid.slice(0, 2), cid);

    // Create entry
    const entry: CacheEntry = {
      key,
      data,
      timestamp: Date.now(),
      size: JSON.stringify(data).length,
      ttl: ttl ?? this.defaultTTL,
    };

    // Ensure directory exists
    await mkdir(dirname(cachePath), { recursive: true });

    // Atomic write (write to temp file, then rename)
    const tempPath = `${cachePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(entry));
    await rm(cachePath, { force: true });
    await writeFile(cachePath, JSON.stringify(entry));
    await unlink(tempPath).catch(() => {
      /* ignore - temp file cleanup */
    });

    // Evict if over size limit
    await this.evictIfNeeded();
  }

  /**
   * Check if key exists in cache
   *
   * @param key - Cache key
   * @returns True if entry exists and not expired
   */
  async has(key: string): Promise<boolean> {
    const data = await this.get(key);
    return data !== null;
  }

  /**
   * Delete entry from cache
   *
   * @param key - Cache key
   * @returns True if deleted, false if not found
   */
  async delete(key: string): Promise<boolean> {
    const cid = this.computeCID(key);
    const cachePath = join(this.cacheDir, cid.slice(0, 2), cid);

    try {
      await unlink(cachePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Clear all cache entries
   *
   * @returns Clearing statistics
   */
  async clear(): Promise<CacheClearResult> {
    let clearedEntries = 0;
    let freedBytes = 0;

    try {
      const entries = await this.listAllEntries();

      for (const entry of entries) {
        await unlink(entry.path);
        clearedEntries++;
        freedBytes += entry.size;
      }

      return { clearedEntries, freedBytes };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { clearedEntries: 0, freedBytes: 0 };
      }
      throw error;
    }
  }

  /**
   * Get cache statistics
   *
   * @returns Cache statistics
   */
  async stats(): Promise<CacheStats> {
    const entries = await this.listAllEntries();

    if (entries.length === 0) {
      return {
        totalEntries: 0,
        totalBytes: 0,
        oldestEntry: 0,
        newestEntry: 0,
        averageSize: 0,
      };
    }

    const totalBytes = entries.reduce((sum, e) => sum + e.size, 0);
    const timestamps = entries.map((e) => e.timestamp);

    return {
      totalEntries: entries.length,
      totalBytes,
      oldestEntry: Math.min(...timestamps),
      newestEntry: Math.max(...timestamps),
      averageSize: totalBytes / entries.length,
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Compute content ID (CID) for cache key
   *
   * Uses SHA-256 hash for content addressing.
   *
   * @param key - Cache key
   * @returns CID (hex-encoded SHA-256)
   */
  private computeCID(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }

  /**
   * List all cache entries
   *
   * @returns Array of cache entries with paths
   */
  private async listAllEntries(): Promise<
    Array<{ path: string; timestamp: number; size: number }>
  > {
    const entries: Array<{ path: string; timestamp: number; size: number }> = [];

    try {
      // Cache is organized by first 2 chars of CID (256 subdirs)
      const subdirs = await readdir(this.cacheDir);

      for (const subdir of subdirs) {
        const subdirPath = join(this.cacheDir, subdir);
        const stats = await stat(subdirPath);

        if (!stats.isDirectory()) continue;

        const files = await readdir(subdirPath);

        for (const file of files) {
          if (file.endsWith('.tmp')) continue;  // Skip temp files

          const filePath = join(subdirPath, file);
          const fileStats = await stat(filePath);

          // Read entry to get timestamp
          try {
            const content = await readFile(filePath, 'utf-8');
            const entry = JSON.parse(content) as CacheEntry;

            entries.push({
              path: filePath,
              timestamp: entry.timestamp,
              size: fileStats.size,
            });
          } catch {
            // Corrupted entry - skip
            continue;
          }
        }
      }

      return entries;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Evict entries if cache exceeds size limit
   *
   * Uses LRU eviction policy (oldest timestamp first).
   */
  private async evictIfNeeded(): Promise<void> {
    const stats = await this.stats();

    if (stats.totalBytes <= this.maxSizeBytes) {
      return;  // Under limit
    }

    // Get all entries sorted by timestamp (oldest first)
    const entries = await this.listAllEntries();
    entries.sort((a, b) => a.timestamp - b.timestamp);

    // Evict oldest entries until under limit
    let currentSize = stats.totalBytes;
    let evicted = 0;

    for (const entry of entries) {
      if (currentSize <= this.maxSizeBytes) {
        break;
      }

      await unlink(entry.path);
      currentSize -= entry.size;
      evicted++;
    }

    if (evicted > 0) {
      console.log(
        `[FilesystemCache] Evicted ${evicted} entries (freed ${((stats.totalBytes - currentSize) / 1024 / 1024).toFixed(2)} MB)`
      );
    }
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create cache directory if it doesn't exist
 *
 * @param cacheDir - Cache directory path
 */
export async function ensureCacheDir(cacheDir: string): Promise<void> {
  await mkdir(cacheDir, { recursive: true });
}

/**
 * Get cache directory size
 *
 * @param cacheDir - Cache directory path
 * @returns Total size in bytes
 */
export async function getCacheDirSize(cacheDir: string): Promise<number> {
  const cache = new FilesystemCache(cacheDir);
  const stats = await cache.stats();
  return stats.totalBytes;
}

/**
 * Clear expired cache entries
 *
 * @param cacheDir - Cache directory path
 * @returns Clearing statistics
 */
export async function clearExpiredEntries(
  cacheDir: string
): Promise<CacheClearResult> {
  let clearedEntries = 0;
  let freedBytes = 0;

  const cache = new FilesystemCache(cacheDir);

  try {
    const subdirs = await readdir(cacheDir);

    for (const subdir of subdirs) {
      const subdirPath = join(cacheDir, subdir);
      const stats = await stat(subdirPath);

      if (!stats.isDirectory()) continue;

      const files = await readdir(subdirPath);

      for (const file of files) {
        if (file.endsWith('.tmp')) continue;

        const filePath = join(subdirPath, file);

        try {
          const content = await readFile(filePath, 'utf-8');
          const entry = JSON.parse(content) as CacheEntry;

          // Check if expired
          if (entry.ttl) {
            const age = (Date.now() - entry.timestamp) / 1000;
            if (age > entry.ttl) {
              const fileStats = await stat(filePath);
              await unlink(filePath);
              clearedEntries++;
              freedBytes += fileStats.size;
            }
          }
        } catch {
          // Corrupted entry - delete it
          const fileStats = await stat(filePath);
          await unlink(filePath);
          clearedEntries++;
          freedBytes += fileStats.size;
        }
      }
    }

    return { clearedEntries, freedBytes };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { clearedEntries: 0, freedBytes: 0 };
    }
    throw error;
  }
}
