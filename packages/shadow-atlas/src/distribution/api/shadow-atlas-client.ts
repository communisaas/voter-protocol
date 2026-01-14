/**
 * Shadow Atlas TypeScript SDK
 *
 * Type-safe client library for Shadow Atlas API with:
 * - Automatic retry handling
 * - Response caching
 * - Request validation
 * - Merkle proof verification
 * - Rate limit tracking
 *
 * Usage:
 *
 * ```typescript
 * import { ShadowAtlasClient } from '@voter-protocol/shadow-atlas-client';
 *
 * const client = new ShadowAtlasClient({
 *   baseUrl: 'https://api.shadow-atlas.org/v1',
 *   apiKey: 'YOUR_API_KEY', // Optional (premium tier)
 * });
 *
 * const result = await client.lookup(39.7392, -104.9903);
 * console.log('District:', result.district.name);
 *
 * const isValid = client.verifyProof(result.district.id, result.merkleProof);
 * console.log('Proof Valid:', isValid);
 * ```
 */

import { poseidon } from 'circomlibjs';
import { logger } from '../../core/utils/logger.js';

/**
 * API Response wrapper
 */
export interface APIResponse<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
  };
  readonly meta: {
    readonly requestId: string;
    readonly latencyMs: number;
    readonly cached: boolean;
    readonly version: string;
  };
}

/**
 * District boundary
 */
export interface District {
  readonly id: string;
  readonly name: string;
  readonly jurisdiction: string;
  readonly districtType: 'congressional' | 'state_senate' | 'state_house' | 'county' | 'municipal' | 'council' | 'ward';
  readonly geometry: {
    readonly type: 'Polygon' | 'MultiPolygon';
    readonly coordinates: readonly number[][][] | readonly number[][][][];
  };
}

/**
 * Merkle proof
 */
export interface MerkleProof {
  readonly root: string;
  readonly leaf: string;
  readonly siblings: readonly string[];
  readonly pathIndices: readonly number[];
}

/**
 * Lookup result
 */
export interface LookupResult {
  readonly district: District;
  readonly merkleProof: MerkleProof;
  readonly latencyMs: number;
  readonly cacheHit: boolean;
}

/**
 * Snapshot metadata
 */
export interface SnapshotMetadata {
  readonly snapshotId: string;
  readonly ipfsCID: string;
  readonly merkleRoot: string;
  readonly timestamp: string;
  readonly districtCount: number;
  readonly version: string;
  readonly coverage: {
    readonly countries: readonly string[];
    readonly states: readonly string[];
  };
}

/**
 * Health metrics
 */
export interface HealthMetrics {
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  readonly uptime: number;
  readonly queries: {
    readonly total: number;
    readonly successful: number;
    readonly failed: number;
    readonly latencyP50: number;
    readonly latencyP95: number;
    readonly latencyP99: number;
    readonly throughput: number;
  };
  readonly cache: {
    readonly size: number;
    readonly hits: number;
    readonly misses: number;
    readonly hitRate: number;
    readonly evictions: number;
  };
  readonly snapshot: {
    readonly currentCid: string;
    readonly merkleRoot: string;
    readonly districtCount: number;
    readonly ageSeconds: number;
    readonly nextCheckSeconds: number;
  };
  readonly errors: {
    readonly last5m: number;
    readonly last1h: number;
    readonly last24h: number;
    readonly recentErrors: ReadonlyArray<{
      readonly timestamp: number;
      readonly error: string;
      readonly lat?: number;
      readonly lon?: number;
    }>;
  };
  readonly timestamp: number;
}

/**
 * Client configuration
 */
export interface ClientConfig {
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly timeout?: number;
  readonly retryAttempts?: number;
  readonly retryDelay?: number;
  readonly cacheEnabled?: boolean;
  readonly cacheTTL?: number;
}

/**
 * API error
 */
export class ShadowAtlasError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
    public readonly requestId?: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ShadowAtlasError';
  }
}

/**
 * Cache entry
 */
interface CacheEntry<T> {
  readonly data: T;
  readonly timestamp: number;
}

/**
 * Shadow Atlas API Client
 */
export class ShadowAtlasClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeout: number;
  private readonly retryAttempts: number;
  private readonly retryDelay: number;
  private readonly cacheEnabled: boolean;
  private readonly cacheTTL: number;
  private readonly cache: Map<string, CacheEntry<unknown>>;

  // Rate limit tracking
  private rateLimitRemaining?: number;
  private rateLimitReset?: number;

  constructor(config: ClientConfig = {}) {
    this.baseUrl = config.baseUrl || 'https://api.shadow-atlas.org/v1';
    this.apiKey = config.apiKey;
    this.timeout = config.timeout || 10000;
    this.retryAttempts = config.retryAttempts || 3;
    this.retryDelay = config.retryDelay || 1000;
    this.cacheEnabled = config.cacheEnabled !== false;
    this.cacheTTL = config.cacheTTL || 3600000; // 1 hour default
    this.cache = new Map();
  }

  /**
   * Lookup district by coordinates
   */
  async lookup(lat: number, lng: number): Promise<LookupResult> {
    // Validate coordinates
    if (lat < -90 || lat > 90) {
      throw new Error('Latitude must be between -90 and 90');
    }
    if (lng < -180 || lng > 180) {
      throw new Error('Longitude must be between -180 and 180');
    }

    // Check cache
    const cacheKey = `lookup:${lat}:${lng}`;
    if (this.cacheEnabled) {
      const cached = this.getFromCache<LookupResult>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // Make request
    const response = await this.request<LookupResult>(
      `/lookup?lat=${lat}&lng=${lng}`
    );

    // Cache result
    if (this.cacheEnabled && response.data) {
      this.setCache(cacheKey, response.data);
    }

    if (!response.data) {
      throw new ShadowAtlasError(
        response.error?.message || 'Lookup failed',
        response.error?.code || 'UNKNOWN_ERROR',
        404,
        response.meta.requestId,
        response.error?.details
      );
    }

    return response.data;
  }

  /**
   * Get district by ID
   */
  async getDistrictById(id: string): Promise<{ districtId: string; merkleProof: MerkleProof }> {
    if (!id || id.length === 0) {
      throw new Error('District ID cannot be empty');
    }

    // Check cache
    const cacheKey = `district:${id}`;
    if (this.cacheEnabled) {
      const cached = this.getFromCache<{ districtId: string; merkleProof: MerkleProof }>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // Make request
    const response = await this.request<{ districtId: string; merkleProof: MerkleProof }>(
      `/districts/${encodeURIComponent(id)}`
    );

    // Cache result
    if (this.cacheEnabled && response.data) {
      this.setCache(cacheKey, response.data);
    }

    if (!response.data) {
      throw new ShadowAtlasError(
        response.error?.message || 'District not found',
        response.error?.code || 'DISTRICT_NOT_FOUND',
        404,
        response.meta.requestId,
        response.error?.details
      );
    }

    return response.data;
  }

  /**
   * Get current snapshot metadata
   */
  async getSnapshot(): Promise<SnapshotMetadata> {
    // Check cache
    const cacheKey = 'snapshot:current';
    if (this.cacheEnabled) {
      const cached = this.getFromCache<SnapshotMetadata>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // Make request
    const response = await this.request<SnapshotMetadata>('/snapshot');

    // Cache result
    if (this.cacheEnabled && response.data) {
      this.setCache(cacheKey, response.data);
    }

    if (!response.data) {
      throw new ShadowAtlasError(
        response.error?.message || 'Snapshot unavailable',
        response.error?.code || 'SNAPSHOT_UNAVAILABLE',
        404,
        response.meta.requestId,
        response.error?.details
      );
    }

    return response.data;
  }

  /**
   * List all snapshots
   */
  async listSnapshots(): Promise<SnapshotMetadata[]> {
    // Check cache
    const cacheKey = 'snapshots:list';
    if (this.cacheEnabled) {
      const cached = this.getFromCache<SnapshotMetadata[]>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // Make request
    const response = await this.request<SnapshotMetadata[]>('/snapshots');

    // Cache result
    if (this.cacheEnabled && response.data) {
      this.setCache(cacheKey, response.data);
    }

    if (!response.data) {
      throw new ShadowAtlasError(
        response.error?.message || 'Snapshots unavailable',
        response.error?.code || 'SNAPSHOT_UNAVAILABLE',
        404,
        response.meta.requestId,
        response.error?.details
      );
    }

    return response.data;
  }

  /**
   * Health check
   */
  async health(): Promise<HealthMetrics> {
    const response = await this.request<HealthMetrics>('/health');

    if (!response.data) {
      throw new ShadowAtlasError(
        response.error?.message || 'Health check failed',
        response.error?.code || 'INTERNAL_ERROR',
        500,
        response.meta.requestId,
        response.error?.details
      );
    }

    return response.data;
  }

  /**
   * Verify Merkle proof
   */
  verifyProof(districtId: string, proof: MerkleProof): boolean {
    try {
      // Compute leaf hash
      const leafHash = this.hashDistrictId(districtId);

      // Walk Merkle proof
      let currentHash = leafHash;
      for (let i = 0; i < proof.siblings.length; i++) {
        const sibling = BigInt(proof.siblings[i]);
        const isLeftChild = proof.pathIndices[i] === 0;

        if (isLeftChild) {
          currentHash = this.hashPair(currentHash, sibling);
        } else {
          currentHash = this.hashPair(sibling, currentHash);
        }
      }

      // Compare computed root to expected root
      const expectedRoot = BigInt(proof.root);
      return currentHash === expectedRoot;
    } catch (error) {
      logger.error('Proof verification failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Get rate limit information
   */
  getRateLimitInfo(): { remaining?: number; resetAt?: Date } {
    return {
      remaining: this.rateLimitRemaining,
      resetAt: this.rateLimitReset ? new Date(this.rateLimitReset * 1000) : undefined,
    };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Make HTTP request with retry logic
   */
  private async request<T>(path: string): Promise<APIResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.retryAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url, {
          method: 'GET',
          headers,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Update rate limit tracking
        const rateLimitRemaining = response.headers.get('X-RateLimit-Remaining');
        const rateLimitReset = response.headers.get('X-RateLimit-Reset');

        if (rateLimitRemaining) {
          this.rateLimitRemaining = parseInt(rateLimitRemaining, 10);
        }
        if (rateLimitReset) {
          this.rateLimitReset = parseInt(rateLimitReset, 10);
        }

        // Parse response
        const data: APIResponse<T> = await response.json();

        // Handle non-200 responses
        if (!response.ok) {
          // Rate limit exceeded - wait and retry
          if (response.status === 429 && attempt < this.retryAttempts - 1) {
            const resetAt = this.rateLimitReset ? this.rateLimitReset * 1000 : Date.now() + 60000;
            const waitMs = Math.max(0, resetAt - Date.now());
            await this.sleep(waitMs);
            continue;
          }

          throw new ShadowAtlasError(
            data.error?.message || 'Request failed',
            data.error?.code || 'UNKNOWN_ERROR',
            response.status,
            data.meta.requestId,
            data.error?.details
          );
        }

        return data;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on client errors (4xx)
        if (error instanceof ShadowAtlasError && error.statusCode >= 400 && error.statusCode < 500) {
          throw error;
        }

        // Wait before retry
        if (attempt < this.retryAttempts - 1) {
          await this.sleep(this.retryDelay * Math.pow(2, attempt));
        }
      }
    }

    throw lastError || new Error('Request failed after all retry attempts');
  }

  /**
   * Get from cache
   */
  private getFromCache<T>(key: string): T | undefined {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) {
      return undefined;
    }

    // Check if expired
    if (Date.now() - entry.timestamp > this.cacheTTL) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.data;
  }

  /**
   * Set cache
   */
  private setCache<T>(key: string, data: T): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Hash district ID (Poseidon)
   */
  private hashDistrictId(districtId: string): bigint {
    // Convert district ID to bytes
    const encoder = new TextEncoder();
    const bytes = encoder.encode(districtId);

    // Pad to 32 bytes
    const padded = new Uint8Array(32);
    padded.set(bytes.slice(0, 32));

    // Convert to bigint
    const value = BigInt('0x' + Buffer.from(padded).toString('hex'));

    // Hash with Poseidon
    return poseidon([value]);
  }

  /**
   * Hash pair (Poseidon)
   */
  private hashPair(left: bigint, right: bigint): bigint {
    return poseidon([left, right]);
  }
}

/**
 * Create Shadow Atlas client
 */
export function createClient(config?: ClientConfig): ShadowAtlasClient {
  return new ShadowAtlasClient(config);
}
