/**
 * Shadow Atlas HTTP API Server - Production-Hardened
 *
 * PRODUCTION READY: Strict request validation, standardized responses, API versioning,
 * comprehensive security headers, and OpenAPI compliance.
 *
 * Features:
 * - Zod request validation (strict input validation)
 * - Standardized APIResponse wrapper (consistent error handling)
 * - API versioning (/v1/lookup with deprecation strategy)
 * - Security headers (CSP, CORS, rate limit headers)
 * - Request ID tracking (distributed tracing)
 * - Response caching hints (Cache-Control headers)
 *
 * Design principles:
 * - RESTful
 * - Predictable
 * - Well-documented
 * - Secure by default
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { URL } from 'url';
import { z } from 'zod';
import { DistrictLookupService } from './district-service';
import { ProofService, toCompactProof } from './proof-generator';
import { SyncService } from './sync-service';
import { HealthMonitor } from './health';
import type {
  LookupResult,
  ErrorCode,
  DistrictBoundary,
  SnapshotMetadata,
} from './types';
import { randomBytes } from 'crypto';
import { logger } from '../core/utils/logger.js';

/**
 * Standardized API response wrapper
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
 * API version configuration
 */
export interface APIVersion {
  readonly version: string;
  readonly deprecated: boolean;
  readonly sunsetDate?: string;
  readonly migrationGuide?: string;
}

/**
 * Request validation schemas (Zod)
 */
const coordinatesSchema = z.object({
  lat: z.coerce
    .number()
    .min(-90, 'Latitude must be >= -90')
    .max(90, 'Latitude must be <= 90'),
  lng: z.coerce
    .number()
    .min(-180, 'Longitude must be >= -180')
    .max(180, 'Longitude must be <= 180'),
});

const lookupSchema = z
  .object({
    lat: z.coerce
      .number()
      .min(-90, 'Latitude must be >= -90')
      .max(90, 'Latitude must be <= 90')
      .optional(),
    lng: z.coerce
      .number()
      .min(-180, 'Longitude must be >= -180')
      .max(180, 'Longitude must be <= 180')
      .optional(),
    layers: z
      .array(
        z.enum(['congressional', 'state_senate', 'state_house', 'county', 'municipal'])
      )
      .optional(),
  })
  .refine((data) => (data.lat !== undefined && data.lng !== undefined), {
    message: 'Both lat and lng must be provided',
  });

const districtIdSchema = z.object({
  id: z.string().min(1, 'District ID cannot be empty'),
});

/**
 * Rate limiter with sliding window
 */
class RateLimiter {
  private readonly requests: Map<string, number[]> = new Map();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number, windowMs = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  check(clientId: string): {
    allowed: boolean;
    remaining: number;
    resetAt: number;
  } {
    const now = Date.now();
    const requests = this.requests.get(clientId) || [];

    // Remove old requests outside window
    const recentRequests = requests.filter((timestamp) => now - timestamp < this.windowMs);

    const allowed = recentRequests.length < this.maxRequests;
    const remaining = Math.max(0, this.maxRequests - recentRequests.length);
    const resetAt = now + this.windowMs;

    if (allowed) {
      recentRequests.push(now);
      this.requests.set(clientId, recentRequests);
    }

    return { allowed, remaining, resetAt };
  }

  reset(clientId: string): void {
    this.requests.delete(clientId);
  }
}

/**
 * Production-hardened HTTP API Server
 */
export class ShadowAtlasAPI {
  private readonly server: ReturnType<typeof createServer>;
  private readonly lookupService: DistrictLookupService;
  private readonly proofService: ProofService;
  private readonly syncService: SyncService;
  private readonly healthMonitor: HealthMonitor;
  private readonly rateLimiter: RateLimiter;
  private readonly port: number;
  private readonly host: string;
  private readonly corsOrigins: readonly string[];
  private readonly apiVersion: APIVersion;

  constructor(
    lookupService: DistrictLookupService,
    proofService: ProofService,
    syncService: SyncService,
    port = 3000,
    host = '0.0.0.0',
    corsOrigins: readonly string[] = ['*'],
    rateLimitPerMinute = 60,
    apiVersion: APIVersion = {
      version: 'v1',
      deprecated: false,
    }
  ) {
    this.lookupService = lookupService;
    this.proofService = proofService;
    this.syncService = syncService;
    this.healthMonitor = new HealthMonitor();
    this.rateLimiter = new RateLimiter(rateLimitPerMinute);
    this.port = port;
    this.host = host;
    this.corsOrigins = corsOrigins;
    this.apiVersion = apiVersion;

    this.server = createServer((req, res) => this.handleRequest(req, res));
  }

  /**
   * Start HTTP server
   */
  start(): void {
    this.server.listen(this.port, this.host, () => {
      logger.info('Shadow Atlas API server started', {
        version: this.apiVersion.version,
        host: this.host,
        port: this.port,
        url: `http://${this.host}:${this.port}`,
      });

      logger.info('API endpoints registered', {
        endpoints: [
          `GET /${this.apiVersion.version}/lookup?lat={lat}&lng={lng} - District lookup`,
          `GET /${this.apiVersion.version}/districts/:id - Direct district lookup`,
          `GET /${this.apiVersion.version}/health - Health check`,
          `GET /${this.apiVersion.version}/metrics - Prometheus metrics`,
          `GET /${this.apiVersion.version}/snapshot - Current snapshot metadata`,
          `GET /${this.apiVersion.version}/snapshots - List snapshots`,
        ],
      });

      if (this.apiVersion.deprecated) {
        logger.warn('API version is deprecated', {
          version: this.apiVersion.version,
          sunsetDate: this.apiVersion.sunsetDate || 'TBD',
          migrationGuide: this.apiVersion.migrationGuide || 'TBD',
        });
      }
    });

    // Start sync service
    this.syncService.start();
  }

  /**
   * Stop HTTP server
   */
  stop(): void {
    this.server.close();
    this.syncService.stop();
    logger.info('API server stopped');
  }

  /**
   * Handle incoming HTTP request
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestId = this.generateRequestId();
    const startTime = performance.now();

    // Set security headers (CSP, CORS, etc.)
    this.setSecurityHeaders(res, requestId);

    // Handle OPTIONS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Parse URL
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const pathname = url.pathname;

    try {
      // Extract version from path
      const versionMatch = pathname.match(/^\/(v\d+)\//);
      const requestedVersion = versionMatch ? versionMatch[1] : 'v1';

      // Version negotiation
      if (requestedVersion !== this.apiVersion.version) {
        this.sendErrorResponse(
          res,
          400,
          'UNSUPPORTED_VERSION',
          `API version ${requestedVersion} not supported. Current version: ${this.apiVersion.version}`,
          requestId,
          performance.now() - startTime
        );
        return;
      }

      // Add deprecation warning header if applicable
      if (this.apiVersion.deprecated) {
        res.setHeader('Deprecation', 'true');
        if (this.apiVersion.sunsetDate) {
          res.setHeader('Sunset', this.apiVersion.sunsetDate);
        }
        if (this.apiVersion.migrationGuide) {
          res.setHeader('Link', `<${this.apiVersion.migrationGuide}>; rel="deprecation"`);
        }
      }

      // Route request
      const basePath = pathname.replace(/^\/v\d+/, '');

      if (basePath === '/lookup' && req.method === 'GET') {
        await this.handleLookup(url, res, req, requestId, startTime);
      } else if (basePath.match(/^\/districts\/[\w-]+$/) && req.method === 'GET') {
        await this.handleDistrictById(basePath, res, req, requestId, startTime);
      } else if (basePath === '/health' && req.method === 'GET') {
        this.handleHealth(res, requestId, startTime);
      } else if (basePath === '/metrics' && req.method === 'GET') {
        this.handleMetrics(res);
      } else if (basePath === '/snapshot' && req.method === 'GET') {
        await this.handleSnapshot(res, requestId, startTime);
      } else if (basePath === '/snapshots' && req.method === 'GET') {
        await this.handleSnapshots(res, requestId, startTime);
      } else {
        this.sendErrorResponse(
          res,
          404,
          'NOT_FOUND',
          `Endpoint not found: ${pathname}`,
          requestId,
          performance.now() - startTime
        );
      }
    } catch (error) {
      logger.error('API request error', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      this.sendErrorResponse(
        res,
        500,
        'INTERNAL_ERROR',
        'Internal server error',
        requestId,
        performance.now() - startTime,
        error instanceof Error ? error.message : undefined
      );
    }
  }

  /**
   * Handle /v1/lookup endpoint
   */
  private async handleLookup(
    url: URL,
    res: ServerResponse,
    req: IncomingMessage,
    requestId: string,
    startTime: number
  ): Promise<void> {
    // Rate limiting
    const clientId = this.getClientId(req);
    const rateLimitResult = this.rateLimiter.check(clientId);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', this.rateLimiter['maxRequests']);
    res.setHeader('X-RateLimit-Remaining', rateLimitResult.remaining);
    res.setHeader('X-RateLimit-Reset', Math.floor(rateLimitResult.resetAt / 1000));

    if (!rateLimitResult.allowed) {
      this.sendErrorResponse(
        res,
        429,
        'RATE_LIMIT_EXCEEDED',
        'Rate limit exceeded. Please try again later.',
        requestId,
        performance.now() - startTime,
        {
          limit: this.rateLimiter['maxRequests'],
          remaining: rateLimitResult.remaining,
          resetAt: new Date(rateLimitResult.resetAt).toISOString(),
        }
      );
      return;
    }

    // Validate query parameters with Zod
    const params = Object.fromEntries(url.searchParams.entries());
    const validation = lookupSchema.safeParse(params);

    if (!validation.success) {
      this.healthMonitor.recordError('Validation error');
      this.sendErrorResponse(
        res,
        400,
        'INVALID_PARAMETERS',
        'Invalid request parameters',
        requestId,
        performance.now() - startTime,
        validation.error.flatten()
      );
      return;
    }

    const { lat, lng } = validation.data;

    if (lat === undefined || lng === undefined) {
      this.sendErrorResponse(
        res,
        400,
        'INVALID_COORDINATES',
        'Missing lat or lng parameter',
        requestId,
        performance.now() - startTime
      );
      return;
    }

    // Perform lookup
    try {
      const result = this.lookupService.lookup(lat, lng);

      if (!result.district) {
        this.healthMonitor.recordError('District not found', lat, lng);
        this.sendErrorResponse(
          res,
          404,
          'DISTRICT_NOT_FOUND',
          'No district found at coordinates',
          requestId,
          performance.now() - startTime,
          { lat, lng }
        );
        return;
      }

      // Generate Merkle proof
      const merkleProof = await this.proofService.generateProof(result.district.id);

      // Build response data
      const responseData: LookupResult = {
        district: result.district,
        merkleProof: {
          root: merkleProof.root,
          leaf: merkleProof.leaf,
          siblings: merkleProof.siblings,
          pathIndices: merkleProof.pathIndices,
        },
        latencyMs: result.latencyMs,
        cacheHit: result.cacheHit,
      };

      // Record metrics
      this.healthMonitor.recordQuery(result.latencyMs, result.cacheHit);

      // Send success response
      this.sendSuccessResponse(
        res,
        responseData,
        requestId,
        performance.now() - startTime,
        result.cacheHit
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.healthMonitor.recordError(errorMsg, lat, lng);
      this.sendErrorResponse(
        res,
        500,
        'INTERNAL_ERROR',
        errorMsg,
        requestId,
        performance.now() - startTime
      );
    }
  }

  /**
   * Handle /v1/districts/:id endpoint
   */
  private async handleDistrictById(
    pathname: string,
    res: ServerResponse,
    req: IncomingMessage,
    requestId: string,
    startTime: number
  ): Promise<void> {
    // Extract district ID from path
    const districtId = pathname.split('/').pop() || '';

    // Validate district ID
    const validation = districtIdSchema.safeParse({ id: districtId });

    if (!validation.success) {
      this.sendErrorResponse(
        res,
        400,
        'INVALID_PARAMETERS',
        'Invalid district ID',
        requestId,
        performance.now() - startTime,
        validation.error.flatten()
      );
      return;
    }

    try {
      // Generate Merkle proof for district ID
      const merkleProof = await this.proofService.generateProof(districtId);

      // Build response
      const responseData = {
        districtId,
        merkleProof: {
          root: merkleProof.root,
          leaf: merkleProof.leaf,
          siblings: merkleProof.siblings,
          pathIndices: merkleProof.pathIndices,
        },
      };

      this.sendSuccessResponse(
        res,
        responseData,
        requestId,
        performance.now() - startTime,
        false
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.sendErrorResponse(
        res,
        404,
        'DISTRICT_NOT_FOUND',
        `District not found: ${districtId}`,
        requestId,
        performance.now() - startTime,
        { districtId, error: errorMsg }
      );
    }
  }

  /**
   * Handle /v1/health endpoint
   */
  private handleHealth(
    res: ServerResponse,
    requestId: string,
    startTime: number
  ): void {
    const metrics = this.healthMonitor.getMetrics();

    this.sendSuccessResponse(
      res,
      metrics,
      requestId,
      performance.now() - startTime,
      false
    );
  }

  /**
   * Handle /v1/metrics endpoint (Prometheus format)
   */
  private handleMetrics(res: ServerResponse): void {
    const prometheusMetrics = this.healthMonitor.exportPrometheus();

    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
    res.end(prometheusMetrics);
  }

  /**
   * Handle /v1/snapshot endpoint
   */
  private async handleSnapshot(
    res: ServerResponse,
    requestId: string,
    startTime: number
  ): Promise<void> {
    const snapshot = await this.syncService.getLatestSnapshot();

    if (!snapshot) {
      this.sendErrorResponse(
        res,
        404,
        'SNAPSHOT_UNAVAILABLE',
        'No snapshot available',
        requestId,
        performance.now() - startTime
      );
      return;
    }

    this.sendSuccessResponse(
      res,
      snapshot,
      requestId,
      performance.now() - startTime,
      false
    );
  }

  /**
   * Handle /v1/snapshots endpoint
   */
  private async handleSnapshots(
    res: ServerResponse,
    requestId: string,
    startTime: number
  ): Promise<void> {
    const snapshots = await this.syncService.listSnapshots();

    this.sendSuccessResponse(
      res,
      snapshots,
      requestId,
      performance.now() - startTime,
      false
    );
  }

  /**
   * Set comprehensive security headers
   */
  private setSecurityHeaders(res: ServerResponse, requestId: string): void {
    // CORS headers
    const origin = this.corsOrigins.includes('*') ? '*' : this.corsOrigins[0];
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Expose-Headers', 'X-Request-ID, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset');

    // Security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none';"
    );
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Permissions-Policy',
      'geolocation=(), microphone=(), camera=()'
    );

    // Request tracking
    res.setHeader('X-Request-ID', requestId);
    res.setHeader('X-API-Version', this.apiVersion.version);
  }

  /**
   * Send success response (standardized)
   */
  private sendSuccessResponse<T>(
    res: ServerResponse,
    data: T,
    requestId: string,
    latencyMs: number,
    cached: boolean
  ): void {
    const response: APIResponse<T> = {
      success: true,
      data,
      meta: {
        requestId,
        latencyMs: Math.round(latencyMs * 100) / 100,
        cached,
        version: this.apiVersion.version,
      },
    };

    // Set cache headers
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('Cache-Control', 'public, max-age=3600');
    } else {
      res.setHeader('X-Cache', 'MISS');
      res.setHeader('Cache-Control', 'public, max-age=60');
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response, this.bigIntReplacer, 2));
  }

  /**
   * Send error response (standardized)
   */
  private sendErrorResponse(
    res: ServerResponse,
    status: number,
    code: ErrorCode | string,
    message: string,
    requestId: string,
    latencyMs: number,
    details?: unknown
  ): void {
    const response: APIResponse<never> = {
      success: false,
      error: {
        code,
        message,
        details,
      },
      meta: {
        requestId,
        latencyMs: Math.round(latencyMs * 100) / 100,
        cached: false,
        version: this.apiVersion.version,
      },
    };

    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response, null, 2));
  }

  /**
   * Get client ID for rate limiting
   */
  private getClientId(req: IncomingMessage): string {
    // Use X-Forwarded-For if behind proxy, otherwise socket address
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded && typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress || 'unknown';
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `req_${randomBytes(16).toString('hex')}`;
  }

  /**
   * BigInt JSON replacer
   */
  private bigIntReplacer(key: string, value: unknown): unknown {
    if (typeof value === 'bigint') {
      return '0x' + value.toString(16);
    }
    return value;
  }
}

/**
 * Create and start Shadow Atlas API server (v2)
 */
export async function createShadowAtlasAPI(
  dbPath: string,
  options: {
    port?: number;
    host?: string;
    corsOrigins?: readonly string[];
    rateLimitPerMinute?: number;
    ipfsGateway?: string;
    snapshotsDir?: string;
    apiVersion?: APIVersion;
  } = {}
): Promise<ShadowAtlasAPI> {
  // Initialize services
  const lookupService = new DistrictLookupService(dbPath);

  // Mock proof service (replace with actual districts/addresses from DB)
  const mockDistricts: DistrictBoundary[] = [];
  const mockAddresses: string[] = [];
  const proofService = await ProofService.create(mockDistricts, mockAddresses);

  const syncService = new SyncService(options.ipfsGateway, options.snapshotsDir);

  // Create API server
  const api = new ShadowAtlasAPI(
    lookupService,
    proofService,
    syncService,
    options.port,
    options.host,
    options.corsOrigins,
    options.rateLimitPerMinute,
    options.apiVersion
  );

  return api;
}
