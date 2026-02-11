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
import { SyncService, type SyncServiceConfig } from './sync-service';
import { HealthMonitor } from './health';
import { RegistrationService, type CellMapState, type CellProofResult } from './registration-service';
import type {
  LookupResult,
  ErrorCode,
  DistrictBoundary,
  SnapshotMetadata,
} from './types';
import { randomBytes, timingSafeEqual, createHmac } from 'crypto';
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
 * POST /v1/register request body: { leaf: "0x..." }
 * The leaf is a Poseidon2_H3(user_secret, cell_id, registration_salt) computed client-side.
 */
/** BN254 scalar field modulus for Zod-level validation (CR-011) */
const BN254_MODULUS_API = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const registerSchema = z.object({
  leaf: z.string()
    .min(3, 'Leaf hash is required')
    .regex(/^(0x)?[0-9a-fA-F]+$/, 'Leaf must be a hex-encoded field element')
    .refine((val) => {
      try {
        const n = BigInt(val.startsWith('0x') ? val : '0x' + val);
        return n > 0n && n < BN254_MODULUS_API;
      } catch { return false; }
    }, 'Leaf must be a valid BN254 field element (0 < leaf < p)'),
});

/**
 * POST /v1/register/replace request body: { newLeaf: "0x...", oldLeafIndex: N }
 * Replaces an existing leaf (zeroed) with a new one (appended).
 */
const registerReplaceSchema = z.object({
  newLeaf: z.string()
    .min(3, 'Leaf hash is required')
    .regex(/^(0x)?[0-9a-fA-F]+$/, 'newLeaf must be a hex-encoded field element')
    .refine((val) => {
      try {
        const n = BigInt(val.startsWith('0x') ? val : '0x' + val);
        return n > 0n && n < BN254_MODULUS_API;
      } catch { return false; }
    }, 'newLeaf must be a valid BN254 field element (0 < leaf < p)'),
  oldLeafIndex: z.number().int().nonnegative('oldLeafIndex must be a non-negative integer'),
});

/**
 * GET /v1/cell-proof?cell_id={cell_id}
 */
const cellProofSchema = z.object({
  cell_id: z.string()
    .min(1, 'cell_id is required')
    .regex(/^(0x)?[0-9a-fA-F]+$|^\d+$/, 'cell_id must be numeric or hex'),
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
  private readonly registrationRateLimiter: RateLimiter;
  private readonly registrationService: RegistrationService | null;
  private readonly cellMapState: CellMapState | null;
  private readonly registrationAuthToken: string | null;
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
    corsOrigins: readonly string[] = [],
    rateLimitPerMinute = 60,
    apiVersion: APIVersion = {
      version: 'v1',
      deprecated: false,
    },
    registrationService: RegistrationService | null = null,
    cellMapState: CellMapState | null = null,
    registrationAuthToken: string | null = null,
  ) {
    this.lookupService = lookupService;
    this.proofService = proofService;
    this.syncService = syncService;
    this.healthMonitor = new HealthMonitor();
    this.rateLimiter = new RateLimiter(rateLimitPerMinute);
    this.registrationRateLimiter = new RateLimiter(5, 60000); // 5 registrations/min per IP
    this.registrationService = registrationService;
    this.cellMapState = cellMapState;
    this.registrationAuthToken = registrationAuthToken;
    this.port = port;
    this.host = host;
    this.corsOrigins = corsOrigins;
    this.apiVersion = apiVersion;

    // SA-016: Reject wildcard CORS in production
    if (process.env.NODE_ENV === 'production' && this.corsOrigins.includes('*')) {
      throw new Error(
        'SA-016: CORS wildcard (*) not allowed in production. ' +
        'Set CORS_ORIGINS to specific allowed origins.'
      );
    }

    // BR5-012: Fail closed — reject registrations in production when auth is unconfigured.
    // Previously this was a warning-only log, leaving the tree open to filling attacks.
    if (this.registrationService && !this.registrationAuthToken) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'BR5-012: REGISTRATION_AUTH_TOKEN must be set in production. ' +
          'Registration without auth enables tree-filling attacks (CR-004).',
        );
      }
      logger.warn(
        'Registration auth token not configured. POST /v1/register is unauthenticated. ' +
        'Set REGISTRATION_AUTH_TOKEN in production to prevent tree-filling attacks (CR-004).',
      );
    }

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

      const v = this.apiVersion.version;
      const endpoints = [
        `GET /${v}/lookup?lat={lat}&lng={lng} - District lookup`,
        `GET /${v}/districts/:id - Direct district lookup`,
        `GET /${v}/health - Health check`,
        `GET /${v}/metrics - Prometheus metrics`,
        `GET /${v}/snapshot - Current snapshot metadata`,
        `GET /${v}/snapshots - List snapshots`,
      ];
      if (this.registrationService) {
        endpoints.push(`POST /${v}/register - User registration (Tree 1 leaf insertion)`);
        endpoints.push(`POST /${v}/register/replace - Leaf replacement (credential recovery)`);
      }
      if (this.cellMapState) {
        endpoints.push(`GET /${v}/cell-proof?cell_id={id} - Cell SMT proof (Tree 2)`);
      }
      logger.info('API endpoints registered', { endpoints });

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
    this.setSecurityHeaders(res, requestId, req);

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
      } else if (basePath === '/register' && req.method === 'POST') {
        await this.handleRegister(req, res, requestId, startTime);
      } else if (basePath === '/register/replace' && req.method === 'POST') {
        await this.handleRegisterReplace(req, res, requestId, startTime);
      } else if (basePath === '/cell-proof' && req.method === 'GET') {
        await this.handleCellProof(url, res, req, requestId, startTime);
      } else if (basePath.match(/^\/districts\/[\w-]+$/) && req.method === 'GET') {
        await this.handleDistrictById(basePath, res, req, requestId, startTime);
      } else if (basePath === '/health' && req.method === 'GET') {
        this.handleHealth(res, requestId, startTime);
      } else if (basePath === '/metrics' && req.method === 'GET') {
        this.handleMetrics(res, req);
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
        );
      }
    } catch (error) {
      logger.error('API request error', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      // BR5-014: Never leak error.message to client — log internally only
      this.sendErrorResponse(
        res,
        500,
        'INTERNAL_ERROR',
        'Internal server error',
        requestId,
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
      );
      return;
    }

    // Perform lookup
    try {
      const result = this.lookupService.lookup(lat, lng);

      if (!result.district) {
        // BR5-013: Don't pass lat/lon to error samples (exposed via /v1/health)
        this.healthMonitor.recordError('District not found');
        this.sendErrorResponse(
          res,
          404,
          'DISTRICT_NOT_FOUND',
          'No district found at coordinates',
          requestId,
        );
        return;
      }

      // Generate Merkle proof
      const merkleProof = await this.proofService.generateProof(result.district.id);

      // Build response data (BR5-005: latencyMs removed from response to prevent timing oracle)
      const responseData: LookupResult = {
        district: result.district,
        merkleProof: {
          root: merkleProof.root,
          leaf: merkleProof.leaf,
          siblings: merkleProof.siblings,
          pathIndices: merkleProof.pathIndices,
          depth: merkleProof.depth,
        },
        cacheHit: result.cacheHit,
      };

      // Record metrics (internal only — not exposed to client)
      this.healthMonitor.recordQuery(result.latencyMs, result.cacheHit);

      // Send success response
      this.sendSuccessResponse(
        res,
        responseData,
        requestId,
        result.cacheHit
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.healthMonitor.recordError(errorMsg);
      // BR5-014: Log details internally, return generic message to client
      logger.error('Lookup failed', { requestId, error: errorMsg });
      this.sendErrorResponse(
        res,
        500,
        'INTERNAL_ERROR',
        'Lookup failed',
        requestId,
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
        false
      );
    } catch (error) {
      // BR5-014: Don't leak internal error details to client
      logger.error('District lookup failed', {
        requestId,
        districtId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      this.sendErrorResponse(
        res,
        404,
        'DISTRICT_NOT_FOUND',
        'District not found',
        requestId,
      );
    }
  }

  /**
   * Handle POST /v1/register endpoint
   *
   * Accepts a precomputed leaf hash and inserts it into Tree 1.
   * Returns the leaf index and Merkle proof.
   */
  private async handleRegister(
    req: IncomingMessage,
    res: ServerResponse,
    requestId: string,
    startTime: number,
  ): Promise<void> {
    // Check service availability
    if (!this.registrationService) {
      this.sendErrorResponse(
        res, 501, 'REGISTRATION_UNAVAILABLE',
        'Registration service not configured',
        requestId,
      );
      return;
    }

    // Rate limiting (stricter than lookup: 5/min per IP)
    const clientId = this.getClientId(req);
    const rateResult = this.registrationRateLimiter.check(clientId);
    res.setHeader('X-RateLimit-Limit', 5);
    res.setHeader('X-RateLimit-Remaining', rateResult.remaining);
    res.setHeader('X-RateLimit-Reset', Math.floor(rateResult.resetAt / 1000));

    if (!rateResult.allowed) {
      this.sendErrorResponse(
        res, 429, 'RATE_LIMIT_EXCEEDED',
        'Registration rate limit exceeded. Please try again later.',
        requestId,
        { limit: 5, remaining: 0, resetAt: new Date(rateResult.resetAt).toISOString() },
      );
      return;
    }

    // CR-004: Authenticate registration requests to prevent tree-filling attacks.
    // Without auth, an attacker can fill the tree (2^20 leaves ≈ 146 days at 5/min rate limit).
    if (this.registrationAuthToken) {
      const authHeader = req.headers['authorization'];
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        // 27M-002: RFC 7235 requires WWW-Authenticate on 401 responses
        res.setHeader('WWW-Authenticate', 'Bearer');
        this.sendErrorResponse(
          res, 401, 'UNAUTHORIZED',
          'Authorization required',
          requestId,
        );
        return;
      }
      const token = authHeader.slice(7);
      // Constant-time comparison to prevent timing attacks
      if (!this.constantTimeEqual(token, this.registrationAuthToken)) {
        this.sendErrorResponse(
          res, 403, 'FORBIDDEN',
          'Invalid authorization token',
          requestId,
        );
        return;
      }
    }

    // CR-014: Validate Content-Type before reading body
    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('application/json')) {
      this.sendErrorResponse(
        res, 415, 'INVALID_BODY',
        'Content-Type must be application/json',
        requestId,
      );
      return;
    }

    // Parse request body
    const body = await this.readBody(req);
    if (body === null) {
      this.sendErrorResponse(
        res, 400, 'INVALID_BODY',
        'Request body must be valid JSON',
        requestId,
      );
      return;
    }

    // Validate with Zod (CR-007: strip Zod details from response)
    const validation = registerSchema.safeParse(body);
    if (!validation.success) {
      this.sendErrorResponse(
        res, 400, 'INVALID_PARAMETERS',
        'Invalid registration parameters',
        requestId,
      );
      return;
    }

    try {
      const result = await this.registrationService.insertLeaf(validation.data.leaf);

      // BR5-007: Notify sync service for periodic IPFS backup
      const log = this.registrationService.getInsertionLog();
      if (log) {
        this.syncService.notifyInsertion(log);
      }

      // No cache for mutations
      res.setHeader('Cache-Control', 'no-store');

      this.sendSuccessResponse(
        res, result, requestId, false,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';

      if (msg === 'DUPLICATE_LEAF') {
        // CR-006: Return 400 (not 409) so duplicate is indistinguishable
        // from other validation errors — prevents registration oracle attack.
        // S-08: Use identical message to prevent error-message oracle.
        this.sendErrorResponse(
          res, 400, 'INVALID_PARAMETERS',
          'Invalid registration parameters',
          requestId,
        );
      } else if (msg.includes('Zero leaf') || msg.includes('exceeds BN254') || msg.includes('Invalid hex')) {
        this.sendErrorResponse(
          res, 400, 'INVALID_PARAMETERS',
          'Invalid registration parameters',
          requestId,
        );
      } else if (msg.includes('capacity')) {
        this.sendErrorResponse(
          res, 503, 'TREE_FULL',
          'Registration tree is at capacity',
          requestId,
        );
      } else {
        this.healthMonitor.recordError(msg);
        this.sendErrorResponse(
          res, 500, 'INTERNAL_ERROR',
          'Registration failed',
          requestId,
        );
      }
    }
  }

  /**
   * Handle POST /v1/register/replace endpoint
   */
  private async handleRegisterReplace(
    req: IncomingMessage,
    res: ServerResponse,
    requestId: string,
    startTime: number,
  ): Promise<void> {
    // Check service availability
    if (!this.registrationService) {
      this.sendErrorResponse(
        res, 501, 'REGISTRATION_UNAVAILABLE',
        'Registration service not configured',
        requestId,
      );
      return;
    }

    // Rate limiting (same as /register: 5/min per IP)
    const clientId = this.getClientId(req);
    const rateResult = this.registrationRateLimiter.check(clientId);
    res.setHeader('X-RateLimit-Limit', 5);
    res.setHeader('X-RateLimit-Remaining', rateResult.remaining);
    res.setHeader('X-RateLimit-Reset', Math.floor(rateResult.resetAt / 1000));

    if (!rateResult.allowed) {
      this.sendErrorResponse(
        res, 429, 'RATE_LIMIT_EXCEEDED',
        'Registration rate limit exceeded. Please try again later.',
        requestId,
        { limit: 5, remaining: 0, resetAt: new Date(rateResult.resetAt).toISOString() },
      );
      return;
    }

    // CR-004: Authenticate registration requests
    if (this.registrationAuthToken) {
      const authHeader = req.headers['authorization'];
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.setHeader('WWW-Authenticate', 'Bearer');
        this.sendErrorResponse(
          res, 401, 'UNAUTHORIZED',
          'Authorization required',
          requestId,
        );
        return;
      }
      const token = authHeader.slice(7);
      if (!this.constantTimeEqual(token, this.registrationAuthToken)) {
        this.sendErrorResponse(
          res, 403, 'FORBIDDEN',
          'Invalid authorization token',
          requestId,
        );
        return;
      }
    }

    // CR-014: Validate Content-Type before reading body
    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('application/json')) {
      this.sendErrorResponse(
        res, 415, 'INVALID_BODY',
        'Content-Type must be application/json',
        requestId,
      );
      return;
    }

    // Parse request body
    const body = await this.readBody(req);
    if (body === null) {
      this.sendErrorResponse(
        res, 400, 'INVALID_BODY',
        'Request body must be valid JSON',
        requestId,
      );
      return;
    }

    // Validate with Zod
    const validation = registerReplaceSchema.safeParse(body);
    if (!validation.success) {
      this.sendErrorResponse(
        res, 400, 'INVALID_PARAMETERS',
        'Invalid replacement parameters',
        requestId,
      );
      return;
    }

    try {
      const result = await this.registrationService.replaceLeaf(
        validation.data.oldLeafIndex,
        validation.data.newLeaf,
      );

      // BR5-007: Notify sync service for periodic IPFS backup
      const log = this.registrationService.getInsertionLog();
      if (log) {
        this.syncService.notifyInsertion(log);
      }

      // No cache for mutations
      res.setHeader('Cache-Control', 'no-store');

      this.sendSuccessResponse(
        res, result, requestId, false,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';

      if (
        msg === 'DUPLICATE_LEAF' ||
        msg === 'INVALID_OLD_INDEX' ||
        msg === 'OLD_LEAF_ALREADY_EMPTY' ||
        msg === 'SAME_LEAF' ||
        msg.includes('Zero leaf') ||
        msg.includes('exceeds BN254') ||
        msg.includes('Invalid hex')
      ) {
        // Oracle-resistant: identical message for all validation failures
        this.sendErrorResponse(
          res, 400, 'INVALID_PARAMETERS',
          'Invalid replacement parameters',
          requestId,
        );
      } else if (msg.includes('capacity')) {
        this.sendErrorResponse(
          res, 503, 'TREE_FULL',
          'Registration tree is at capacity',
          requestId,
        );
      } else {
        this.healthMonitor.recordError(msg);
        this.sendErrorResponse(
          res, 500, 'INTERNAL_ERROR',
          'Replacement failed',
          requestId,
        );
      }
    }
  }

  /**
   * Handle GET /v1/cell-proof endpoint
   *
   * Returns the Tree 2 SMT proof for a cell_id, including the 24 district IDs.
   */
  private async handleCellProof(
    url: URL,
    res: ServerResponse,
    req: IncomingMessage,
    requestId: string,
    startTime: number,
  ): Promise<void> {
    if (!this.cellMapState) {
      this.sendErrorResponse(
        res, 501, 'CELL_PROOF_UNAVAILABLE',
        'Cell proof service not configured',
        requestId,
      );
      return;
    }

    // Rate limiting (same as lookup)
    const clientId = this.getClientId(req);
    const rateResult = this.rateLimiter.check(clientId);
    res.setHeader('X-RateLimit-Limit', this.rateLimiter['maxRequests']);
    res.setHeader('X-RateLimit-Remaining', rateResult.remaining);
    res.setHeader('X-RateLimit-Reset', Math.floor(rateResult.resetAt / 1000));

    if (!rateResult.allowed) {
      this.sendErrorResponse(
        res, 429, 'RATE_LIMIT_EXCEEDED',
        'Rate limit exceeded. Please try again later.',
        requestId,
      );
      return;
    }

    // Validate query params
    const params = Object.fromEntries(url.searchParams.entries());
    const validation = cellProofSchema.safeParse(params);

    if (!validation.success) {
      // CR-007: Strip Zod details from response
      this.sendErrorResponse(
        res, 400, 'INVALID_PARAMETERS',
        'Invalid cell_id parameter',
        requestId,
      );
      return;
    }

    try {
      const rawCellId = validation.data.cell_id;
      const cellId = BigInt(rawCellId);
      const cellIdStr = cellId.toString();

      // Check cell exists in Tree 2
      const districts = this.cellMapState.districtMap.get(cellIdStr);
      if (!districts) {
        this.sendErrorResponse(
          res, 404, 'CELL_NOT_FOUND',
          'Cell ID not found in district map',
          requestId,
        );
        return;
      }

      // Generate SMT proof
      const proof = await this.cellMapState.tree.getProof(cellId);

      const result: CellProofResult = {
        cellMapRoot: '0x' + this.cellMapState.root.toString(16),
        cellMapPath: proof.siblings.map((s: bigint) => '0x' + s.toString(16)),
        cellMapPathBits: [...proof.pathBits],
        districts: districts.map((d: bigint) => '0x' + d.toString(16)),
      };

      this.sendSuccessResponse(
        res, result, requestId, false,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.healthMonitor.recordError(msg);
      this.sendErrorResponse(
        res, 500, 'INTERNAL_ERROR',
        'Cell proof generation failed',
        requestId,
      );
    }
  }

  /**
   * Read and parse JSON request body (max 1KB for registration).
   */
  private readBody(req: IncomingMessage): Promise<unknown | null> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const maxSize = 1024; // 1KB max for registration body

      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxSize) {
          resolve(null);
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve(JSON.parse(raw));
        } catch {
          resolve(null);
        }
      });

      req.on('error', () => resolve(null));
    });
  }

  /**
   * Handle /v1/health endpoint
   *
   * BR5-013: Returns sanitized health data — no coordinates, no error messages.
   * Full details are only available via /v1/metrics (auth-gated).
   */
  private handleHealth(
    res: ServerResponse,
    requestId: string,
    startTime: number
  ): void {
    const metrics = this.healthMonitor.getMetrics();

    // BR5-013: Strip sensitive data from public health endpoint.
    // Only expose status, uptime, aggregate counts — not error samples or coordinates.
    const sanitized = {
      status: metrics.status,
      uptime: metrics.uptime,
      queries: {
        total: metrics.queries.total,
        successful: metrics.queries.successful,
        failed: metrics.queries.failed,
      },
      errors: {
        last5m: metrics.errors.last5m,
        last1h: metrics.errors.last1h,
        last24h: metrics.errors.last24h,
        // recentErrors intentionally omitted — contains error messages
      },
      timestamp: metrics.timestamp,
    };

    this.sendSuccessResponse(
      res,
      sanitized,
      requestId,
      false
    );
  }

  /**
   * Handle /v1/metrics endpoint (Prometheus format)
   *
   * BR5-013: Auth-gated — requires METRICS_AUTH_TOKEN or trusted proxy.
   */
  private handleMetrics(res: ServerResponse, req?: IncomingMessage): void {
    // BR5-013: Only allow metrics from trusted proxies (internal network) or with auth token
    const metricsToken = process.env.METRICS_AUTH_TOKEN;
    const socketAddr = req?.socket.remoteAddress || '';

    if (metricsToken) {
      // 27M-001: When token is configured, REQUIRE it — no trusted-proxy bypass.
      // Previous code allowed internal-network callers to skip token auth, which
      // means a compromised internal service could scrape metrics without credentials.
      const authHeader = req?.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ') ||
          !this.constantTimeEqual(authHeader.slice(7), metricsToken)) {
        res.writeHead(401, {
          'Content-Type': 'text/plain',
          'WWW-Authenticate': 'Bearer',
        });
        res.end('Unauthorized\n');
        return;
      }
    } else if (!this.isTrustedProxy(socketAddr)) {
      // No token configured: restrict to internal networks only
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden: metrics only available from internal network\n');
      return;
    }

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
      );
      return;
    }

    this.sendSuccessResponse(
      res,
      snapshot,
      requestId,
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
      false
    );
  }

  /**
   * Set comprehensive security headers
   */
  private setSecurityHeaders(res: ServerResponse, requestId: string, req?: IncomingMessage): void {
    // CORS headers - only set if origins are configured
    if (this.corsOrigins.length > 0) {
      // CR-012: Validate against actual request origin, not just first in list
      const requestOrigin = req?.headers.origin;
      let origin: string;
      if (this.corsOrigins.includes('*')) {
        origin = '*';
      } else if (requestOrigin && this.corsOrigins.includes(requestOrigin)) {
        origin = requestOrigin;
      } else {
        // H-04: Don't send CORS header if request origin doesn't match any allowed origin.
        // Sending a non-matching origin header is misleading and can mask misconfigurations.
        origin = '';
      }
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Expose-Headers', 'X-Request-ID, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset');
      }
    }

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
    cached: boolean
  ): void {
    const response: APIResponse<T> = {
      success: true,
      data,
      meta: {
        requestId,
        cached,
        version: this.apiVersion.version,
      },
    };

    // Set cache headers — only if not already set (handleRegister sets no-store)
    const existingCacheControl = res.getHeader('Cache-Control');
    if (!existingCacheControl) {
      if (cached) {
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('Cache-Control', 'public, max-age=3600');
      } else {
        res.setHeader('X-Cache', 'MISS');
        res.setHeader('Cache-Control', 'public, max-age=60');
      }
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
  /**
   * Get client ID for rate limiting.
   * CR-003: Only trust X-Forwarded-For from loopback (reverse proxy).
   * CR-002: Normalize IPv6 to /64 prefix to prevent rotation bypass.
   */
  private getClientId(req: IncomingMessage): string {
    const socketAddr = req.socket.remoteAddress || 'unknown';

    // CR-003: Only trust X-Forwarded-For when the direct connection is from
    // a trusted reverse proxy (loopback or private network)
    let clientIp = socketAddr;
    if (this.isTrustedProxy(socketAddr)) {
      const forwarded = req.headers['x-forwarded-for'];
      if (forwarded && typeof forwarded === 'string') {
        clientIp = forwarded.split(',')[0].trim();
      }
    }

    // CR-002: Normalize IPv6 to /64 prefix to prevent rotation attack
    return this.normalizeIpForRateLimit(clientIp);
  }

  /**
   * Check if the direct connection is from a trusted reverse proxy.
   * Only loopback and RFC1918 private addresses are trusted.
   */
  private isTrustedProxy(addr: string): boolean {
    // Normalize IPv6-mapped IPv4 (e.g., ::ffff:127.0.0.1 → 127.0.0.1)
    const normalized = addr.replace(/^::ffff:/, '');
    return (
      normalized === '127.0.0.1' ||
      normalized === '::1' ||
      normalized.startsWith('10.') ||
      this.isRfc1918_172(normalized) ||
      normalized.startsWith('192.168.')
    );
  }

  /**
   * Check if an IPv4 address is in the 172.16.0.0/12 RFC1918 range (172.16.0.0 – 172.31.255.255).
   * M-06: Previous prefix matching (`172.2`) incorrectly matched public IPs like 172.2.x.x.
   */
  private isRfc1918_172(ip: string): boolean {
    const match = ip.match(/^172\.(\d+)\./);
    if (!match) return false;
    const second = parseInt(match[1], 10);
    return second >= 16 && second <= 31;
  }

  /**
   * Normalize IP address for rate limiting.
   * IPv6 addresses are truncated to /64 prefix to prevent rotation bypass.
   */
  private normalizeIpForRateLimit(addr: string): string {
    // IPv6-mapped IPv4 → use the IPv4 part
    const normalized = addr.replace(/^::ffff:/, '');
    if (!normalized.includes(':')) {
      return normalized; // IPv4: use as-is
    }
    // IPv6: truncate to /64 prefix (first 4 groups)
    const full = this.expandIPv6(normalized);
    const groups = full.split(':');
    return groups.slice(0, 4).join(':') + '::/64';
  }

  /**
   * Expand abbreviated IPv6 to full 8-group form for consistent prefix extraction.
   */
  private expandIPv6(addr: string): string {
    const parts = addr.split('::');
    const left = parts[0] ? parts[0].split(':') : [];
    const right = parts.length > 1 && parts[1] ? parts[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    const middle = Array(Math.max(0, missing)).fill('0000');
    const groups = [...left, ...middle, ...right];
    return groups.map(g => g.padStart(4, '0')).slice(0, 8).join(':');
  }

  /**
   * Constant-time string comparison to prevent timing attacks on auth tokens.
   */
  private constantTimeEqual(a: string, b: string): boolean {
    // Use HMAC-based normalization to prevent length-leak timing side-channel.
    // timingSafeEqual requires equal-length buffers; padding with a hash
    // ensures we never reveal length differences via early return.
    const key = 'constant-time-compare';
    const hashA = createHmac('sha256', key).update(a).digest();
    const hashB = createHmac('sha256', key).update(b).digest();
    // HMAC outputs are always 32 bytes — safe for timingSafeEqual
    return timingSafeEqual(hashA, hashB) && a.length === b.length;
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
    dataDir?: string;
    apiVersion?: APIVersion;
    registrationService?: RegistrationService;
    cellMapState?: CellMapState;
    registrationAuthToken?: string;
    syncService?: SyncService;
  } = {}
): Promise<ShadowAtlasAPI> {
  // Initialize services
  const lookupService = new DistrictLookupService(dbPath);

  // Mock proof service (replace with actual districts/addresses from DB)
  const mockDistricts: DistrictBoundary[] = [];
  const mockAddresses: string[] = [];
  const proofService = await ProofService.create(mockDistricts, mockAddresses);

  const syncService = options.syncService ?? new SyncService({
    dataDir: options.dataDir ?? options.snapshotsDir ?? '/tmp/shadow-atlas',
  });

  // H-002: Ensure SyncService is initialized when created internally
  if (!options.syncService) {
    await syncService.init();
  }

  // Create API server
  const api = new ShadowAtlasAPI(
    lookupService,
    proofService,
    syncService,
    options.port,
    options.host,
    options.corsOrigins,
    options.rateLimitPerMinute,
    options.apiVersion,
    options.registrationService ?? null,
    options.cellMapState ?? null,
    options.registrationAuthToken ?? process.env.REGISTRATION_AUTH_TOKEN ?? null,
  );

  return api;
}
