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
import { DistrictLookupService } from './district-service.js';
import { ProofService, toCompactProof } from './proof-generator.js';
import { SyncService, type SyncServiceConfig } from './sync-service.js';
import { HealthMonitor } from './health.js';
import { RegistrationService, type CellMapState, type CellProofResult } from './registration-service.js';
import { EngagementService } from './engagement-service.js';
import type {
  LookupResult,
  ErrorCode,
  DistrictBoundary,
  SnapshotMetadata,
} from './types.js';
import { OfficialsService, toOfficialsResponse, toCanadaOfficialsResponse, toUKOfficialsResponse, toAUOfficialsResponse, toNZOfficialsResponse } from './officials-service.js';
import { FIPS_TO_STATE } from '../db/fips-codes.js';
import { GeocodeService, type GeocodeResult } from './geocode-service.js';
import type { SnapshotVintage } from '../hydration/snapshot-loader.js';
import { DebateService } from './debate-service.js';
import { BubbleService, type BubbleQueryRequest } from './bubble-service.js';
import { CommunityFieldService, CommunityFieldError, type CommunityFieldSubmission } from './community-field-service.js';
import { randomBytes, timingSafeEqual, createHmac } from 'crypto';
import { logger } from '../core/utils/logger.js';
import type { ServerSigner } from './signing.js';

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
 * POST /v1/register request body: { leaf: "0x...", attestationHash?: "0x..." }
 * The leaf is a Poseidon2_H4(user_secret, cell_id, registration_salt, authority_level) computed client-side.
 * attestationHash (optional) binds this insertion to a real identity verification event.
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
  attestationHash: process.env.NODE_ENV === 'production'
    ? z.string()
        .regex(/^(0x)?[0-9a-fA-F]{64}$/, 'attestationHash must be 32-byte hex (SHA-256)')
        .transform(s => s.startsWith('0x') ? s : '0x' + s)
    : z.string()
        .regex(/^(0x)?[0-9a-fA-F]+$/, 'attestationHash must be hex-encoded')
        .optional(),
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
  attestationHash: process.env.NODE_ENV === 'production'
    ? z.string()
        .regex(/^(0x)?[0-9a-fA-F]{64}$/, 'attestationHash must be 32-byte hex (SHA-256)')
        .transform(s => s.startsWith('0x') ? s : '0x' + s)
    : z.string()
        .regex(/^(0x)?[0-9a-fA-F]+$/, 'attestationHash must be hex-encoded')
        .optional(),
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
 * GET /v1/officials?district=CA-12
 */
const officialsSchema = z.object({
  district: z.string()
    .regex(/^[A-Z]{2}-(\d{1,2}|AL|00)$/i, 'district must be format XX-NN (e.g., CA-12)'),
});

/**
 * GET /v1/resolve?lat=X&lng=Y&include_officials=true
 * Composite endpoint: lookup + officials in one call.
 */
const resolveSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  include_officials: z.coerce.boolean().optional().default(true),
});

/**
 * POST /v1/resolve-address
 * Composite: geocode + district lookup + officials in one call.
 */
const resolveAddressSchema = z.object({
  street: z.string().min(1, 'street is required').max(200),
  city: z.string().min(1, 'city is required').max(100),
  state: z.string().min(2).max(2, 'state must be 2-letter code'),
  zip: z.string().min(3).max(10),
  country: z.enum(['US', 'CA']).optional(),
});

/**
 * POST /v1/engagement/register request body
 */
const engagementRegisterSchema = z.object({
  signerAddress: z.string()
    .regex(/^0x[0-9a-fA-F]{40}$/, 'signerAddress must be a valid Ethereum address'),
  identityCommitment: z.string()
    .min(3, 'identityCommitment is required')
    .regex(/^(0x)?[0-9a-fA-F]+$/, 'identityCommitment must be hex-encoded')
    .refine((val) => {
      try {
        const n = BigInt(val.startsWith('0x') ? val : '0x' + val);
        return n > 0n && n < BN254_MODULUS_API;
      } catch { return false; }
    }, 'identityCommitment must be a valid BN254 field element (0 < v < p)'),
});

const bubbleQuerySchema = z.object({
  center: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  radius: z.number().min(1).max(50_000), // 1m to 50km
  postal_code: z.string().max(20).optional(),
  layers: z.array(z.enum(['cd', 'sldu', 'sldl', 'county', 'can-fed'])).max(10).optional(),
});

/**
 * POST /v1/community-field/contribute request body
 * { proof: "0x...", publicInputs: ["0x...", ...], epochDate: "2026-03-01" }
 */
const communityFieldContributeSchema = z.object({
  proof: z.string().min(1).max(100_000),
  publicInputs: z.array(z.string()).length(5),
  epochDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Rate limiter with sliding window
 */
class RateLimiter {
  private readonly requests: Map<string, number[]> = new Map();
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly cleanupInterval: ReturnType<typeof setInterval>;

  constructor(maxRequests: number, windowMs = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;

    // BR7-012: Sweep stale entries every 5 minutes to prevent memory leak
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, timestamps] of this.requests) {
        const recent = timestamps.filter(t => now - t < this.windowMs);
        if (recent.length === 0) {
          this.requests.delete(key);
        } else {
          this.requests.set(key, recent);
        }
      }
    }, 5 * 60 * 1000);
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

  /** BR7-012: Clear cleanup interval to prevent dangling timers */
  destroy(): void {
    clearInterval(this.cleanupInterval);
  }
}

/**
 * Production-hardened HTTP API Server
 */
export class ShadowAtlasAPI {
  private readonly server: ReturnType<typeof createServer>;
  private readonly lookupService: DistrictLookupService | null;
  private readonly proofService: ProofService | null;
  private readonly syncService: SyncService;
  private readonly healthMonitor: HealthMonitor;
  private readonly rateLimiter: RateLimiter;
  private readonly registrationRateLimiter: RateLimiter;
  private readonly registrationService: RegistrationService | null;
  private readonly cellMapState: CellMapState | null;
  /** Map of vintage label → CellMapState for multi-vintage serving */
  private vintageMap: Map<string, CellMapState>;
  /** Label of the current (default) vintage */
  private currentVintageLabel: string | null;
  private readonly engagementService: EngagementService | null;
  private readonly officialsService: OfficialsService | null;
  private readonly geocodeService: GeocodeService | null;
  private readonly debateService: DebateService | null;
  private readonly bubbleService: BubbleService | null;
  private readonly communityFieldService: CommunityFieldService | null;
  private readonly registrationAuthToken: string | null;
  private readonly signer: ServerSigner | null;
  private readonly port: number;
  private readonly host: string;
  private readonly corsOrigins: readonly string[];
  private readonly apiVersion: APIVersion;
  private shuttingDown = false;

  /**
   * Idempotency cache for registration mutations.
   * Maps X-Idempotency-Key → { result, expiresAt }.
   * Prevents duplicate tree mutations on network retry.
   * TTL: 1 hour. Cleanup: every 5 minutes.
   */
  private readonly idempotencyCache: Map<string, { result: unknown; expiresAt: number }> = new Map();
  private readonly idempotencyCacheTTL = 60 * 60 * 1000; // 1 hour
  private readonly idempotencyCacheCleanup: ReturnType<typeof setInterval>;

  constructor(
    lookupService: DistrictLookupService | null,
    proofService: ProofService | null,
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
    signer: ServerSigner | null = null,
    engagementService: EngagementService | null = null,
    officialsService: OfficialsService | null = null,
    geocodeService: GeocodeService | null = null,
    debateService: DebateService | null = null,
    bubbleService: BubbleService | null = null,
    communityFieldService: CommunityFieldService | null = null,
  ) {
    this.lookupService = lookupService;
    this.proofService = proofService;
    this.syncService = syncService;
    this.healthMonitor = new HealthMonitor();
    this.rateLimiter = new RateLimiter(rateLimitPerMinute);
    this.registrationRateLimiter = new RateLimiter(5, 60000); // 5 registrations/min per IP
    this.registrationService = registrationService;
    this.cellMapState = cellMapState;
    this.vintageMap = new Map();
    this.currentVintageLabel = null;
    this.engagementService = engagementService;
    this.officialsService = officialsService;
    this.geocodeService = geocodeService;
    this.debateService = debateService;
    this.bubbleService = bubbleService;
    this.communityFieldService = communityFieldService;
    this.registrationAuthToken = registrationAuthToken;
    this.signer = signer;
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
    // Applies to BOTH Tree 1 (registration) and Tree 3 (engagement) registration endpoints.
    const hasRegistrationEndpoint = !!(this.registrationService || this.engagementService);
    if (hasRegistrationEndpoint && !this.registrationAuthToken) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'BR5-012: REGISTRATION_AUTH_TOKEN must be set in production. ' +
          'Registration without auth enables tree-filling attacks (CR-004).',
        );
      }
      logger.warn(
        'Registration auth token not configured. POST /v1/register and /v1/engagement/register are unauthenticated. ' +
        'Set REGISTRATION_AUTH_TOKEN in production to prevent tree-filling attacks (CR-004).',
      );
    }

    this.server = createServer((req, res) => this.handleRequest(req, res));
    // BR7-010: Server-level timeout protection against slowloris
    this.server.requestTimeout = 30_000;   // 30s total request timeout
    this.server.headersTimeout = 10_000;   // 10s for headers
    this.server.keepAliveTimeout = 5_000;  // 5s keep-alive

    // Sweep expired idempotency cache entries every 5 minutes
    this.idempotencyCacheCleanup = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.idempotencyCache) {
        if (now >= entry.expiresAt) {
          this.idempotencyCache.delete(key);
        }
      }
    }, 5 * 60 * 1000);
  }

  // ==========================================================================
  // Vintage Registry (Multi-vintage Tree 2 serving)
  // ==========================================================================

  /**
   * Register a named vintage. Can be called multiple times to load
   * multiple redistricting cycles. The first registered vintage becomes
   * the default if no currentVintageLabel is set.
   */
  registerVintage(label: string, state: CellMapState): void {
    this.vintageMap.set(label, state);
    if (!this.currentVintageLabel) {
      this.currentVintageLabel = label;
    }
    logger.info('Vintage registered', {
      label,
      root: '0x' + state.root.toString(16).slice(0, 16) + '...',
      cells: state.commitments.size,
    });
  }

  /**
   * Set the current (default) vintage label.
   */
  setCurrentVintage(label: string): void {
    if (!this.vintageMap.has(label)) {
      throw new Error(`Vintage "${label}" not registered`);
    }
    this.currentVintageLabel = label;
  }

  /**
   * Get available vintage labels.
   */
  getVintageLabels(): string[] {
    return [...this.vintageMap.keys()];
  }

  /**
   * Resolve a CellMapState from URL query parameters.
   * Checks `?vintage=<label>` — falls back to cellMapState (the default tree).
   */
  private resolveVintage(url: URL): CellMapState | null {
    const vintageParam = url.searchParams.get('vintage');
    if (vintageParam) {
      return this.vintageMap.get(vintageParam) ?? null;
    }
    // Default: the primary cellMapState (backwards compat)
    return this.cellMapState;
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
      endpoints.push(`GET /${v}/cell-map-info - Tree 2 metadata (root, depth, cellCount)`);
      if (this.cellMapState) {
        endpoints.push(`GET /${v}/cell-proof?cell_id={id} - Cell SMT proof (Tree 2)`);
      }
      if (this.signer) {
        endpoints.push(`GET /${v}/signing-key - Server Ed25519 public key (verifiable operator)`);
      }
      if (this.officialsService) {
        endpoints.push(`GET /${v}/officials?district=XX-NN - Federal officials by district code`);
      }
      endpoints.push(`GET /${v}/resolve?lat={lat}&lng={lng} - Composite lookup + officials`);
      endpoints.push(`GET /${v}/engagement-info - Tree 3 metadata (root, depth, leafCount)`);
      if (this.engagementService) {
        endpoints.push(`GET /${v}/engagement-path/:leafIndex - Engagement Merkle proof (Tree 3)`);
        endpoints.push(`GET /${v}/engagement-metrics/:identityCommitment - Engagement metrics`);
        endpoints.push(`GET /${v}/engagement-breakdown/:identityCommitment - Detailed tier breakdown`);
        endpoints.push(`POST /${v}/engagement/register - Register identity for engagement tracking`);
      }
      if (this.debateService) {
        endpoints.push(`GET /${v}/debate/:debateId - Debate market state`);
        endpoints.push(`GET /${v}/debate/:debateId/stream - SSE price stream`);
        endpoints.push(`GET /${v}/debate/:debateId/position-proof/:positionIndex - Position Merkle proof for settlement`);
      }
      if (this.bubbleService) {
        endpoints.push(`POST /${v}/bubble-query - Fences + districts within bubble extent`);
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
  /**
   * Stop HTTP server with graceful shutdown.
   * BR7-013: Closes pending connections, flushes insertion log, uploads final state.
   */
  async stop(): Promise<void> {
    // Prevent double-shutdown
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    logger.info('API server shutting down...');

    // 1. Stop accepting new connections
    this.server.close();

    // 2. Clear rate limiter intervals (BR7-012)
    this.rateLimiter.destroy();
    this.registrationRateLimiter.destroy();

    // 3. Flush insertion log and close
    if (this.registrationService) {
      await this.registrationService.close();
    }

    // 3b. Close engagement service
    if (this.engagementService) {
      await this.engagementService.close();
    }

    // 3c. Stop debate service (closes SSE connections)
    if (this.debateService) {
      this.debateService.stop();
    }

    // 4. Final IPFS upload + stop sync service
    const insertionLog = this.registrationService?.getInsertionLog() ?? null;
    await this.syncService.shutdown(insertionLog);
    this.syncService.stop();

    // 5. Clear idempotency cache cleanup timer
    clearInterval(this.idempotencyCacheCleanup);

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
      } else if (basePath.match(/^\/tree\/leaf\/\d+$/) && req.method === 'GET') {
        this.handleTreeLeaf(basePath, res, req, requestId);
      } else if (basePath === '/tree/info' && req.method === 'GET') {
        this.handleTreeInfo(res, req, requestId);
      } else if (basePath === '/cell-proof' && req.method === 'GET') {
        await this.handleCellProof(url, res, req, requestId, startTime);
      } else if (basePath === '/cell-map-info' && req.method === 'GET') {
        this.handleCellMapInfo(res, requestId);
      } else if (basePath.match(/^\/districts\/[\w-]+$/) && req.method === 'GET') {
        await this.handleDistrictById(basePath, res, req, requestId, startTime);
      } else if (basePath === '/health' && req.method === 'GET') {
        this.handleHealth(res, requestId, startTime);
      } else if (basePath === '/metrics' && req.method === 'GET') {
        this.handleMetrics(res, req);
      } else if (basePath === '/signing-key' && req.method === 'GET') {
        this.handleSigningKey(res, requestId, req);
      } else if (basePath === '/snapshot' && req.method === 'GET') {
        await this.handleSnapshot(res, requestId, startTime);
      } else if (basePath === '/snapshots' && req.method === 'GET') {
        await this.handleSnapshots(res, requestId, startTime);
      } else if (basePath === '/engagement-info' && req.method === 'GET') {
        this.handleEngagementInfo(res, req, requestId);
      } else if (basePath.match(/^\/engagement-path\/\d{1,10}$/) && req.method === 'GET') {
        this.handleEngagementPath(basePath, res, req, requestId);
      } else if (basePath.match(/^\/engagement-metrics\/(0x)?[0-9a-fA-F]{1,64}$/) && req.method === 'GET') {
        this.handleEngagementMetrics(basePath, res, req, requestId);
      } else if (basePath.match(/^\/engagement-breakdown\/(0x)?[0-9a-fA-F]{1,64}$/) && req.method === 'GET') {
        this.handleEngagementBreakdown(basePath, res, req, requestId);
      } else if (basePath === '/engagement/register' && req.method === 'POST') {
        await this.handleEngagementRegister(req, res, requestId);
      } else if (basePath === '/officials' && req.method === 'GET') {
        this.handleOfficials(url, res, req, requestId);
      } else if (basePath === '/resolve' && req.method === 'GET') {
        await this.handleResolve(url, res, req, requestId, startTime);
      } else if (basePath.match(/^\/debate\/0x[0-9a-fA-F]{64}\/stream$/) && req.method === 'GET') {
        this.handleDebateStream(basePath, res, req, requestId);
      } else if (basePath.match(/^\/debate\/0x[0-9a-fA-F]{64}\/position-proof\/\d{1,10}$/) && req.method === 'GET') {
        await this.handleDebatePositionProof(basePath, res, req, requestId);
      } else if (basePath.match(/^\/debate\/0x[0-9a-fA-F]{64}$/) && req.method === 'GET') {
        this.handleDebateState(basePath, res, req, requestId);
      } else if (basePath === '/resolve-address' && req.method === 'POST') {
        await this.handleResolveAddress(req, res, requestId);
      } else if (basePath === '/bubble-query' && req.method === 'POST') {
        await this.handleBubbleQuery(req, res, requestId);
      } else if (basePath === '/community-field/contribute' && req.method === 'POST') {
        await this.handleCommunityFieldContribute(req, res, requestId);
      } else if (basePath === '/community-field/info' && req.method === 'GET') {
        this.handleCommunityFieldInfo(res, req, requestId);
      } else if (basePath.match(/^\/community-field\/epoch\/\d{4}-\d{2}-\d{2}$/) && req.method === 'GET') {
        this.handleCommunityFieldEpoch(basePath, res, req, requestId);
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

    if (!this.lookupService) {
      this.sendErrorResponse(res, 501, 'SERVICE_UNAVAILABLE',
        'District lookup not configured. Build the district DB to enable.', requestId);
      return;
    }

    // Perform lookup
    try {
      const result = this.lookupService.lookupAll(lat, lng);

      if (result.districts.length === 0) {
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

      // Primary district = first in sorted array (finest grain)
      const primary = result.districts[0];

      // Generate Merkle proof for primary district (optional — requires populated ProofService)
      let merkleProofData: Record<string, unknown> | null = null;
      if (this.proofService) {
        try {
          const merkleProof = await this.proofService.generateProof(primary.id);
          merkleProofData = {
            root: merkleProof.root,
            leaf: merkleProof.leaf,
            siblings: merkleProof.siblings,
            pathIndices: merkleProof.pathIndices,
            depth: merkleProof.depth,
          };
        } catch (err) {
          console.warn('[lookup] Merkle proof generation failed for district %s: %s',
            primary.id, err instanceof Error ? err.message : String(err));
        }
      }

      // Group all districts by layer type for structured multi-layer response
      const allDistricts = this.groupByLayerType(result.districts);

      // Build response data (BR5-005: latencyMs removed from response to prevent timing oracle)
      const responseData = {
        district: primary,
        all_districts: allDistricts,
        merkleProof: merkleProofData,
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

    if (!this.proofService) {
      this.sendErrorResponse(
        res,
        501,
        'SERVICE_UNAVAILABLE',
        'Proof service not available — district proofs require a populated ProofService',
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
   * Handle GET /v1/officials endpoint
   *
   * Returns federal officials (House rep + Senators) for a district.
   * Data sourced from pre-ingested congress-legislators YAML (CC0).
   * Zero runtime Congress.gov API calls.
   *
   * Query params:
   *   - district: District code (e.g., "CA-12") — required
   */
  private handleOfficials(
    url: URL,
    res: ServerResponse,
    req: IncomingMessage,
    requestId: string,
  ): void {
    if (!this.officialsService) {
      this.sendErrorResponse(
        res, 501, 'OFFICIALS_UNAVAILABLE',
        'Officials service not configured. Run ingest-legislators.ts first.',
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
    const validation = officialsSchema.safeParse(params);

    if (!validation.success) {
      this.sendErrorResponse(
        res, 400, 'INVALID_PARAMETERS',
        'district parameter required (e.g., ?district=CA-12)',
        requestId,
      );
      return;
    }

    try {
      const { district } = validation.data;

      const parsed = OfficialsService.parseDistrictCode(district);
      if (!parsed) {
        this.sendErrorResponse(
          res, 400, 'INVALID_PARAMETERS',
          'Invalid district code format. Expected XX-NN (e.g., CA-12)',
          requestId,
        );
        return;
      }

      const { result, cached } = this.officialsService.getOfficials(parsed.state, parsed.district);

      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('X-Cache', cached ? 'HIT' : 'MISS');

      this.sendSuccessResponse(
        res,
        toOfficialsResponse(result, cached),
        requestId,
        false,
      );
    } catch (error) {
      logger.error('Officials lookup failed', {
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      this.sendErrorResponse(
        res, 500, 'INTERNAL_ERROR',
        'Officials lookup failed',
        requestId,
      );
    }
  }

  /**
   * Handle GET /v1/resolve endpoint
   *
   * Composite endpoint: district lookup + Merkle proof + officials in one call.
   * Saves a client round-trip vs. separate /lookup + /officials calls.
   * Officials failure is non-fatal — response still includes district + proof.
   */
  private async handleResolve(
    url: URL,
    res: ServerResponse,
    req: IncomingMessage,
    requestId: string,
    startTime: number,
  ): Promise<void> {
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

    // Validate query parameters
    const params = Object.fromEntries(url.searchParams.entries());
    const validation = resolveSchema.safeParse(params);

    if (!validation.success) {
      this.sendErrorResponse(
        res, 400, 'INVALID_PARAMETERS',
        'Invalid parameters. Required: lat, lng',
        requestId,
      );
      return;
    }

    const { lat, lng, include_officials } = validation.data;

    if (!this.lookupService) {
      this.sendErrorResponse(res, 501, 'SERVICE_UNAVAILABLE',
        'District lookup not configured. Build the district DB to enable.', requestId);
      return;
    }

    try {
      // Step 1: Multi-hit district lookup
      const result = this.lookupService.lookupAll(lat, lng);

      if (result.districts.length === 0) {
        this.healthMonitor.recordError('District not found');
        this.sendErrorResponse(
          res, 404, 'DISTRICT_NOT_FOUND',
          'No district found at coordinates',
          requestId,
        );
        return;
      }

      // Primary district = finest grain
      const primary = result.districts[0];

      // Step 2: Merkle proof for primary district (optional — requires populated ProofService)
      let merkleProofData: Record<string, unknown> | null = null;
      if (this.proofService) {
        try {
          const merkleProof = await this.proofService.generateProof(primary.id);
          merkleProofData = {
            root: merkleProof.root,
            leaf: merkleProof.leaf,
            siblings: merkleProof.siblings,
            pathIndices: merkleProof.pathIndices,
            depth: merkleProof.depth,
          };
        } catch (err) {
          console.warn('[resolve] Merkle proof generation failed for district %s: %s',
            primary.id, err instanceof Error ? err.message : String(err));
        }
      }

      // Step 3: Officials (optional, non-blocking)
      // Try officials from all matched districts — congressional + Canadian ridings
      let officials = undefined;
      if (include_officials && this.officialsService) {
        try {
          for (const d of result.districts) {
            const parsed = this.parseRTreeDistrictId(d.id);
            if (parsed?.country === 'US' && parsed.type === 'congressional') {
              const { result: officialsResult, cached } =
                this.officialsService.getOfficials(parsed.state, parsed.district);
              officials = toOfficialsResponse(officialsResult, cached);
              break; // Found congressional officials
            } else if (parsed?.country === 'CA' && this.officialsService.hasCanadaData()) {
              const { result: caResult, cached } =
                this.officialsService.getCanadianMP(parsed.ridingCode);
              officials = toCanadaOfficialsResponse(caResult, cached);
              break;
            } else if (parsed?.country === 'GB' && this.officialsService.hasUKData()) {
              const { result: gbResult, cached } =
                this.officialsService.getUKMP(parsed.constituencyCode);
              officials = toUKOfficialsResponse(gbResult, cached);
              break;
            } else if (parsed?.country === 'AU' && this.officialsService.hasAustraliaData()) {
              const { result: auResult, cached } =
                this.officialsService.getAustralianMP(parsed.divisionCode);
              officials = toAUOfficialsResponse(auResult, cached);
              break;
            } else if (parsed?.country === 'NZ' && this.officialsService.hasNZData()) {
              const { result: nzResult, cached } =
                this.officialsService.getNZMP(parsed.electorateCode);
              officials = toNZOfficialsResponse(nzResult, cached);
              break;
            } else if (parsed?.country === 'GB' || parsed?.country === 'AU' || parsed?.country === 'NZ') {
              officials = { officials: [], district_code: d.id, dataStatus: 'pending' as const, source: 'not-yet-available' as const, cached: false };
              break;
            }
          }
        } catch (err) {
          logger.warn('Officials lookup failed in resolve', {
            requestId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Group all districts by layer type
      const allDistricts = this.groupByLayerType(result.districts);

      this.healthMonitor.recordQuery(result.latencyMs, result.cacheHit);

      this.sendSuccessResponse(res, {
        district: primary,
        all_districts: allDistricts,
        merkleProof: merkleProofData,
        officials,
        cacheHit: result.cacheHit,
      }, requestId, result.cacheHit);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.healthMonitor.recordError(errorMsg);
      logger.error('Resolve failed', { requestId, error: errorMsg });
      this.sendErrorResponse(
        res, 500, 'INTERNAL_ERROR',
        'Resolve failed',
        requestId,
      );
    }
  }

  /**
   * Handle POST /v1/resolve-address endpoint
   *
   * Composite: geocode address → PIP district lookup → officials.
   * All processing is local (Nominatim + R-tree + SQLite). Zero external API calls.
   */
  private async handleResolveAddress(
    req: IncomingMessage,
    res: ServerResponse,
    requestId: string,
  ): Promise<void> {
    // Service availability
    if (!this.geocodeService) {
      this.sendErrorResponse(
        res, 501, 'SERVICE_UNAVAILABLE',
        'Geocoding service not configured. Set NOMINATIM_URL to enable.',
        requestId,
      );
      return;
    }

    // Rate limiting
    const clientId = this.getClientId(req);
    const rateResult = this.rateLimiter.check(clientId);
    res.setHeader('X-RateLimit-Limit', String(this.rateLimiter['maxRequests']));
    res.setHeader('X-RateLimit-Remaining', String(rateResult.remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.floor(rateResult.resetAt / 1000)));

    if (!rateResult.allowed) {
      this.sendErrorResponse(
        res, 429, 'RATE_LIMIT_EXCEEDED',
        'Rate limit exceeded. Please try again later.',
        requestId,
      );
      return;
    }

    // Content-Type validation
    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('application/json')) {
      this.sendErrorResponse(
        res, 415, 'INVALID_BODY',
        'Content-Type must be application/json',
        requestId,
      );
      return;
    }

    // Parse body
    const body = await this.readBody(req);
    if (!body) {
      this.sendErrorResponse(
        res, 400, 'INVALID_BODY', 'Request body is required', requestId,
      );
      return;
    }

    // Validate input
    const validation = resolveAddressSchema.safeParse(body);
    if (!validation.success) {
      this.sendErrorResponse(
        res, 400, 'INVALID_PARAMETERS',
        'Invalid address parameters',
        requestId,
        validation.error.issues.map(i => i.message),
      );
      return;
    }

    try {
      const { street, city, state, zip, country } = validation.data;

      // Step 1: Geocode address (Nominatim — local, no external calls)
      const geocodeResult = await this.geocodeService.geocode({
        street, city, state, zip, country,
      });

      if (!geocodeResult) {
        this.sendErrorResponse(
          res, 404, 'ADDRESS_NOT_FOUND',
          'Address could not be geocoded. Please check the address and try again.',
          requestId,
        );
        return;
      }

      // Step 2: Multi-hit district lookup via R-tree PIP (local)
      if (!this.lookupService) {
        this.sendErrorResponse(res, 501, 'SERVICE_UNAVAILABLE',
          'District lookup not configured. Build the district DB to enable.', requestId);
        return;
      }
      const lookupResult = this.lookupService.lookupAll(geocodeResult.lat, geocodeResult.lng);
      const primary = lookupResult.districts[0] ?? null;

      // Step 3: Officials lookup (local SQLite) — non-fatal if unavailable
      // Search through all matched districts for congressional/riding matches
      let officials = undefined;
      if (this.officialsService && lookupResult.districts.length > 0) {
        try {
          for (const d of lookupResult.districts) {
            const parsed = this.parseRTreeDistrictId(d.id);
            if (parsed?.country === 'US' && parsed.type === 'congressional') {
              const { result: officialsResult, cached } =
                this.officialsService.getOfficials(parsed.state, parsed.district);
              officials = toOfficialsResponse(officialsResult, cached);
              break;
            } else if (parsed?.country === 'CA' && this.officialsService.hasCanadaData()) {
              const { result: caResult, cached } =
                this.officialsService.getCanadianMP(parsed.ridingCode);
              officials = toCanadaOfficialsResponse(caResult, cached);
              break;
            } else if (parsed?.country === 'GB' && this.officialsService.hasUKData()) {
              const { result: gbResult, cached } =
                this.officialsService.getUKMP(parsed.constituencyCode);
              officials = toUKOfficialsResponse(gbResult, cached);
              break;
            } else if (parsed?.country === 'AU' && this.officialsService.hasAustraliaData()) {
              const { result: auResult, cached } =
                this.officialsService.getAustralianMP(parsed.divisionCode);
              officials = toAUOfficialsResponse(auResult, cached);
              break;
            } else if (parsed?.country === 'NZ' && this.officialsService.hasNZData()) {
              const { result: nzResult, cached } =
                this.officialsService.getNZMP(parsed.electorateCode);
              officials = toNZOfficialsResponse(nzResult, cached);
              break;
            } else if (parsed?.country === 'GB' || parsed?.country === 'AU' || parsed?.country === 'NZ') {
              officials = { officials: [], district_code: d.id, dataStatus: 'pending' as const, source: 'not-yet-available' as const, cached: false };
              break;
            }
          }
        } catch (err) {
          logger.warn('Officials lookup failed during resolve-address', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Group all districts by layer type
      const allDistricts = lookupResult.districts.length > 0
        ? this.groupByLayerType(lookupResult.districts)
        : {};

      // Privacy: log district only, never address
      logger.info('resolve-address', {
        requestId,
        district: primary?.id ?? 'unknown',
        matchCount: lookupResult.districts.length,
        confidence: geocodeResult.confidence,
        country: geocodeResult.country,
      });

      res.setHeader('Cache-Control', 'no-store');
      this.sendSuccessResponse(res, {
        geocode: {
          lat: geocodeResult.lat,
          lng: geocodeResult.lng,
          matched_address: geocodeResult.matched_address,
          confidence: geocodeResult.confidence,
          country: geocodeResult.country,
        },
        district: primary ? {
          id: primary.id,
          name: primary.name,
          jurisdiction: primary.jurisdiction,
          district_type: primary.districtType,
        } : null,
        all_districts: allDistricts,
        officials: officials ?? null,
        cell_id: primary ? this.extractCellId(primary.id) : null,
        vintage: primary
          ? this.resolveVintageLabel(primary.jurisdiction)
          : null,
      }, requestId, false);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.healthMonitor.recordError(msg);
      logger.error('resolve-address failed', { requestId, error: msg });
      this.sendErrorResponse(
        res, 500, 'INTERNAL_ERROR',
        'Address resolution failed',
        requestId,
      );
    }
  }

  /**
   * Parse R-tree district ID into structured format.
   *
   * R-tree IDs are layer-prefixed GEOIDs from build-district-db.ts:
   *   cd-0611       → US Congressional District (CA-11)
   *   sldu-06001    → US State Senate District
   *   sldl-06001    → US State House District
   *   county-06001  → US County
   *   can-fed-35001 → Canadian Federal Electoral District
   */
  private parseRTreeDistrictId(districtId: string):
    | { country: 'US'; state: string; district: string; type: 'congressional' | 'state-upper' | 'state-lower' | 'county' | 'place' | 'cousub' | 'school-unified' | 'school-elementary' | 'school-secondary' | 'vtd' | 'tribal' | 'ward' | 'consolidated-city' | 'subminor-civil-division' | 'alaska-native-regional' | 'fire-district' | 'water-district' | 'transit-district' | 'library-district' | 'hospital-district' | 'utility-district' | 'park-district' }
    | { country: 'CA'; province: string; ridingCode: string; type: 'federal-riding' }
    | { country: 'GB'; constituencyCode: string; type: 'parliamentary' }
    | { country: 'AU'; divisionCode: string; type: 'federal-division' }
    | { country: 'NZ'; electorateCode: string; type: 'general-electorate' | 'maori-electorate' }
    | null {
    // US Congressional: cd-SSDD (2-digit state FIPS + 2-digit district)
    const cdMatch = districtId.match(/^cd-(\d{2})(\d{2})$/);
    if (cdMatch) {
      const state = FIPS_TO_STATE[cdMatch[1]];
      if (!state) return null;
      const num = cdMatch[2] === '00' ? 'AL' : String(parseInt(cdMatch[2], 10));
      return { country: 'US', state, district: num, type: 'congressional' };
    }

    // US State Senate: sldu-SSNNN
    const slduMatch = districtId.match(/^sldu-(\d{2})(\d+)$/);
    if (slduMatch) {
      const state = FIPS_TO_STATE[slduMatch[1]];
      if (!state) return null;
      return { country: 'US', state, district: slduMatch[2], type: 'state-upper' };
    }

    // US State House: sldl-SSNNN
    const sldlMatch = districtId.match(/^sldl-(\d{2})(\d+)$/);
    if (sldlMatch) {
      const state = FIPS_TO_STATE[sldlMatch[1]];
      if (!state) return null;
      return { country: 'US', state, district: sldlMatch[2], type: 'state-lower' };
    }

    // US County: county-SSCCC
    const countyMatch = districtId.match(/^county-(\d{2})(\d{3})$/);
    if (countyMatch) {
      const state = FIPS_TO_STATE[countyMatch[1]];
      if (!state) return null;
      return { country: 'US', state, district: countyMatch[1] + countyMatch[2], type: 'county' };
    }

    // US Place (city/town): place-SSNNNNN
    const placeMatch = districtId.match(/^place-(\d{2})(\d{5})$/);
    if (placeMatch) {
      const state = FIPS_TO_STATE[placeMatch[1]];
      if (!state) return null;
      return { country: 'US', state, district: placeMatch[1] + placeMatch[2], type: 'place' };
    }

    // US County Subdivision: cousub-SSCCCNNNNN (10 digits: state(2)+county(3)+cousub(5))
    const cousubMatch = districtId.match(/^cousub-(\d{2})(\d{3})(\d{5})$/);
    if (cousubMatch) {
      const state = FIPS_TO_STATE[cousubMatch[1]];
      if (!state) return null;
      return { country: 'US', state, district: cousubMatch[1] + cousubMatch[2] + cousubMatch[3], type: 'cousub' };
    }

    // US School Districts: unsd/elsd/scsd-SSNNNNN
    const schoolMatch = districtId.match(/^(unsd|elsd|scsd)-(\d{2})(\d{5})$/);
    if (schoolMatch) {
      const state = FIPS_TO_STATE[schoolMatch[2]];
      if (!state) return null;
      const typeMap: Record<string, 'school-unified' | 'school-elementary' | 'school-secondary'> = {
        unsd: 'school-unified',
        elsd: 'school-elementary',
        scsd: 'school-secondary',
      };
      return { country: 'US', state, district: schoolMatch[2] + schoolMatch[3], type: typeMap[schoolMatch[1]] };
    }

    // US Voting Precinct: vtd-SS{VTDID} (VTDID is alphanumeric Census VTDST code)
    const vtdMatch = districtId.match(/^vtd-(\d{2})(\w+)$/);
    if (vtdMatch) {
      const state = FIPS_TO_STATE[vtdMatch[1]];
      if (!state) return null;
      return { country: 'US', state, district: vtdMatch[1] + vtdMatch[2], type: 'vtd' };
    }

    // US Tribal: aiannh-NNNNN
    const tribalMatch = districtId.match(/^aiannh-(\d{5})$/);
    if (tribalMatch) {
      return { country: 'US', state: '', district: tribalMatch[1], type: 'tribal' };
    }

    // US Alaska Native Regional Corporation: anrc-NNNNN
    const anrcMatch = districtId.match(/^anrc-(\d{5})$/);
    if (anrcMatch) {
      return { country: 'US', state: 'AK', district: anrcMatch[1], type: 'alaska-native-regional' };
    }

    // US Consolidated City: concity-SSNNNNN (7 digits: state(2)+place(5), same as place layer)
    const concityMatch = districtId.match(/^concity-(\d{2})(\d{5})$/);
    if (concityMatch) {
      const state = FIPS_TO_STATE[concityMatch[1]];
      if (!state) return null;
      return { country: 'US', state, district: concityMatch[1] + concityMatch[2], type: 'consolidated-city' };
    }

    // US Subminor Civil Division: submcd-SSCCCNNNNN (10 digits: state(2)+county(3)+submcd(5))
    const submcdMatch = districtId.match(/^submcd-(\d{2})(\d{3})(\d{5})$/);
    if (submcdMatch) {
      const state = FIPS_TO_STATE[submcdMatch[1]];
      if (!state) return null;
      return { country: 'US', state, district: submcdMatch[1] + submcdMatch[2] + submcdMatch[3], type: 'subminor-civil-division' };
    }

    // City Council Ward: ward-{cityFips}-{wardNum}
    // cityFips is 5-7 digits (typically 7 = 2-digit state FIPS + 5-digit place FIPS)
    const wardMatch = districtId.match(/^ward-(\d{5,7})-(\d+)$/);
    if (wardMatch) {
      // Try to extract 2-digit state prefix from FIPS; fall back to empty
      const fips = wardMatch[1];
      const statePrefix = fips.length >= 7 ? fips.slice(0, 2) : (fips.length === 6 ? fips.slice(0, 1) : '');
      const state = statePrefix.length === 2 ? (FIPS_TO_STATE[statePrefix] ?? '') : '';
      return { country: 'US', state, district: fips + '-' + wardMatch[2], type: 'ward' };
    }

    // Special Districts: {type}-{SSNNNNN} (fire, water, transit, library, hospital, utility, park)
    const specialMatch = districtId.match(/^(fire|water|transit|library|hospital|utility|park)-(\d{2})(\d{3,5})$/);
    if (specialMatch) {
      const typeMap: Record<string, 'fire-district' | 'water-district' | 'transit-district' | 'library-district' | 'hospital-district' | 'utility-district' | 'park-district'> = {
        fire: 'fire-district',
        water: 'water-district',
        transit: 'transit-district',
        library: 'library-district',
        hospital: 'hospital-district',
        utility: 'utility-district',
        park: 'park-district',
      };
      const state = FIPS_TO_STATE[specialMatch[2]];
      if (!state) return null;
      return { country: 'US', state, district: specialMatch[2] + specialMatch[3], type: typeMap[specialMatch[1]] };
    }

    // Canadian Federal Riding: can-fed-XXXXX
    const canMatch = districtId.match(/^can-fed-(\d{5})$/);
    if (canMatch) {
      const prefix = canMatch[1].slice(0, 2);
      const prefixToProvince: Record<string, string> = {
        '10': 'NL', '11': 'PE', '12': 'NS', '13': 'NB',
        '24': 'QC', '35': 'ON', '46': 'MB', '47': 'SK',
        '48': 'AB', '59': 'BC', '60': 'YT', '61': 'NT', '62': 'NU',
      };
      return {
        country: 'CA',
        province: prefixToProvince[prefix] ?? 'XX',
        ridingCode: canMatch[1],
        type: 'federal-riding',
      };
    }

    // UK Parliamentary Constituency: uk-parl-{ONS_CODE}
    const ukMatch = districtId.match(/^uk-parl-([A-Z]\d+)$/);
    if (ukMatch) {
      return {
        country: 'GB',
        constituencyCode: ukMatch[1],
        type: 'parliamentary',
      };
    }

    // Australian Federal Division: au-fed-{DIVISION_CODE}
    const auMatch = districtId.match(/^au-fed-([A-Za-z0-9]{2,20})$/);
    if (auMatch) {
      return {
        country: 'AU',
        divisionCode: auMatch[1],
        type: 'federal-division',
      };
    }

    // NZ General Electorate: nz-gen-{CODE}
    const nzGenMatch = districtId.match(/^nz-gen-([A-Za-z0-9]{1,20})$/);
    if (nzGenMatch) {
      return {
        country: 'NZ',
        electorateCode: nzGenMatch[1],
        type: 'general-electorate',
      };
    }

    // NZ Maori Electorate: nz-maori-{CODE}
    const nzMaoriMatch = districtId.match(/^nz-maori-([A-Za-z0-9]{1,20})$/);
    if (nzMaoriMatch) {
      return {
        country: 'NZ',
        electorateCode: nzMaoriMatch[1],
        type: 'maori-electorate',
      };
    }

    // Legacy format: usa-ca-congressional-11
    const legacyMatch = districtId.match(/^usa-([a-z]{2})-congressional-(\d+|al)$/i);
    if (legacyMatch) {
      const state = legacyMatch[1].toUpperCase();
      const num = legacyMatch[2].toUpperCase() === 'AL' ? 'AL' : legacyMatch[2];
      return { country: 'US', state, district: num, type: 'congressional' };
    }

    return null;
  }

  /**
   * Resolve vintage label from jurisdiction prefix.
   */
  private resolveVintageLabel(jurisdiction: string | undefined): string {
    if (!jurisdiction) return '119th-congress';
    if (jurisdiction.startsWith('CAN/')) return '45th-parliament';
    if (jurisdiction.startsWith('GBR/')) return '2024-boundary-review';
    if (jurisdiction.startsWith('AUS/')) return '2021-redistribution';
    if (jurisdiction.startsWith('NZL/')) return '2025-boundary-review';
    return '119th-congress';
  }

  /**
   * Extract cell_id (GEOID) from district ID.
   * For now returns the district portion as a prefix — full cell_id requires Census block data.
   */
  private extractCellId(districtId: string): string | null {
    const parsed = this.parseRTreeDistrictId(districtId);
    if (!parsed || parsed.country !== 'US') return null;
    return null; // Placeholder — real cell_id comes from Census block data
  }

  /**
   * Group district boundaries by semantic layer type.
   *
   * Returns a flat object keyed by layer name, each containing the district
   * summary (id, name). This is the multi-layer response consumers rely on.
   */
  private groupByLayerType(
    districts: DistrictBoundary[],
  ): Record<string, { id: string; name: string }> {
    const grouped: Record<string, { id: string; name: string }> = {};

    for (const d of districts) {
      const layerName = this.districtIdToLayerName(d.id);
      if (layerName) {
        // First-wins: keep the first match per layer (highest priority per LAYER_PRIORITY sort)
        if (!grouped[layerName]) {
          grouped[layerName] = { id: d.id, name: d.name };
        }
      } else {
        logger.debug('Unrecognized district ID prefix, skipping layer grouping', { districtId: d.id });
      }
    }

    return grouped;
  }

  /**
   * Map district ID prefix to human-readable layer name.
   */
  private districtIdToLayerName(districtId: string): string | null {
    if (districtId.startsWith('cd-')) return 'congressional';
    if (districtId.startsWith('sldu-')) return 'state_senate';
    if (districtId.startsWith('sldl-')) return 'state_house';
    if (districtId.startsWith('county-')) return 'county';
    if (districtId.startsWith('place-')) return 'city';
    if (districtId.startsWith('cousub-')) return 'county_subdivision';
    if (districtId.startsWith('unsd-')) return 'school_unified';
    if (districtId.startsWith('elsd-')) return 'school_elementary';
    if (districtId.startsWith('scsd-')) return 'school_secondary';
    if (districtId.startsWith('vtd-')) return 'voting_precinct';
    if (districtId.startsWith('aiannh-')) return 'tribal';
    if (districtId.startsWith('anrc-')) return 'alaska_native_regional';
    if (districtId.startsWith('submcd-')) return 'subminor_civil_division';
    if (districtId.startsWith('concity-')) return 'consolidated_city';
    if (districtId.startsWith('ward-')) return 'ward';
    if (districtId.startsWith('fire-')) return 'fire_district';
    if (districtId.startsWith('water-')) return 'water_district';
    if (districtId.startsWith('transit-')) return 'transit_district';
    if (districtId.startsWith('library-')) return 'library_district';
    if (districtId.startsWith('hospital-')) return 'hospital_district';
    if (districtId.startsWith('utility-')) return 'utility_district';
    if (districtId.startsWith('park-')) return 'park_district';
    if (districtId.startsWith('can-fed-')) return 'canadian_riding';
    if (districtId.startsWith('uk-parl-')) return 'uk_constituency';
    if (districtId.startsWith('au-fed-')) return 'australian_division';
    if (districtId.startsWith('nz-gen-')) return 'nz_general_electorate';
    if (districtId.startsWith('nz-maori-')) return 'nz_maori_electorate';
    return null;
  }

  /**
   * Handle POST /v1/bubble-query endpoint
   *
   * Returns fences + clipped district polygons within a bubble extent.
   * All processing is local: R-tree spatial queries, no external calls
   * (except optional Nominatim geocoding for postal codes).
   */
  private async handleBubbleQuery(
    req: IncomingMessage,
    res: ServerResponse,
    requestId: string,
  ): Promise<void> {
    if (!this.bubbleService) {
      this.sendErrorResponse(
        res, 501, 'SERVICE_UNAVAILABLE',
        'Bubble service not configured. District DB with fences table required.',
        requestId,
      );
      return;
    }

    // Rate limiting
    const clientId = this.getClientId(req);
    const rateResult = this.rateLimiter.check(clientId);
    res.setHeader('X-RateLimit-Limit', String(this.rateLimiter['maxRequests']));
    res.setHeader('X-RateLimit-Remaining', String(rateResult.remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.floor(rateResult.resetAt / 1000)));

    if (!rateResult.allowed) {
      this.sendErrorResponse(
        res, 429, 'RATE_LIMIT_EXCEEDED',
        'Rate limit exceeded. Please try again later.',
        requestId,
      );
      return;
    }

    // Content-Type
    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('application/json')) {
      this.sendErrorResponse(
        res, 415, 'INVALID_BODY',
        'Content-Type must be application/json',
        requestId,
      );
      return;
    }

    // Parse body
    const body = await this.readBody(req);
    if (!body) {
      this.sendErrorResponse(
        res, 400, 'INVALID_BODY', 'Request body is required', requestId,
      );
      return;
    }

    // Validate
    const validation = bubbleQuerySchema.safeParse(body);
    if (!validation.success) {
      this.sendErrorResponse(
        res, 400, 'INVALID_PARAMETERS',
        `Invalid bubble query: ${validation.error.errors.map(e => e.message).join(', ')}`,
        requestId,
      );
      return;
    }

    try {
      const result = await this.bubbleService.query(validation.data);

      res.setHeader('Cache-Control', 'private, max-age=300'); // 5 min cache
      this.sendSuccessResponse(res, result, requestId, false);
    } catch (error) {
      logger.error('bubble-query failed', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      this.sendErrorResponse(
        res, 500, 'INTERNAL_ERROR',
        'Bubble query failed',
        requestId,
      );
    }
  }

  // ========================================================================
  // Community Field Endpoints
  // ========================================================================

  /**
   * Handle POST /v1/community-field/contribute endpoint.
   *
   * Accepts a BubbleMembershipProof submission with proof, publicInputs, and epochDate.
   * Validates inputs, checks epoch nullifier uniqueness, stores the contribution.
   *
   * Body: { proof: "0x...", publicInputs: ["0x...", ...], epochDate: "YYYY-MM-DD" }
   * Public inputs: [engagementRoot, epochDomain, cellSetRoot, epochNullifier, cellCount]
   */
  private async handleCommunityFieldContribute(
    req: IncomingMessage,
    res: ServerResponse,
    requestId: string,
  ): Promise<void> {
    if (!this.communityFieldService) {
      this.sendErrorResponse(
        res, 501, 'SERVICE_UNAVAILABLE',
        'Community field service not configured',
        requestId,
      );
      return;
    }

    // Rate limiting (use registration limiter — 5/min per IP)
    const clientId = this.getClientId(req);
    const rateResult = this.registrationRateLimiter.check(clientId);
    res.setHeader('X-RateLimit-Limit', '5');
    res.setHeader('X-RateLimit-Remaining', String(rateResult.remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.floor(rateResult.resetAt / 1000)));
    if (!rateResult.allowed) {
      this.sendErrorResponse(res, 429, 'RATE_LIMIT_EXCEEDED', 'Rate limit exceeded', requestId);
      return;
    }

    // Auth check (same as registration endpoints)
    if (this.registrationAuthToken) {
      const authHeader = req.headers['authorization'];
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.setHeader('WWW-Authenticate', 'Bearer');
        this.sendErrorResponse(res, 401, 'UNAUTHORIZED', 'Authorization required', requestId);
        return;
      }
      const token = authHeader.slice(7);
      if (!this.constantTimeEqual(token, this.registrationAuthToken)) {
        this.sendErrorResponse(res, 403, 'FORBIDDEN', 'Invalid authorization token', requestId);
        return;
      }
    }

    // Content-Type validation
    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('application/json')) {
      this.sendErrorResponse(res, 415, 'INVALID_BODY', 'Content-Type must be application/json', requestId);
      return;
    }

    // Parse body
    const body = await this.readBody(req);
    if (!body) {
      this.sendErrorResponse(res, 400, 'INVALID_BODY', 'Request body is required', requestId);
      return;
    }

    const validation = communityFieldContributeSchema.safeParse(body);
    if (!validation.success) {
      this.sendErrorResponse(res, 400, 'INVALID_PARAMETERS', 'Invalid submission parameters', requestId);
      return;
    }

    try {
      const contribution = this.communityFieldService.submit(validation.data);

      res.setHeader('Cache-Control', 'no-store');
      this.sendSuccessResponse(res, {
        epochDate: contribution.epochDate,
        cellSetRoot: contribution.cellSetRoot,
        cellCount: contribution.cellCount,
        epochNullifier: contribution.epochNullifier,
      }, requestId, false);
    } catch (error) {
      if (error instanceof CommunityFieldError) {
        const status = error.code === 'DUPLICATE_NULLIFIER' ? 409
          : error.code === 'EPOCH_FULL' ? 503
          : 400;
        this.sendErrorResponse(res, status, error.code, error.message, requestId);
      } else {
        logger.error('community-field contribution failed', {
          requestId,
          error: error instanceof Error ? error.message : String(error),
        });
        this.sendErrorResponse(res, 500, 'INTERNAL_ERROR', 'Contribution failed', requestId);
      }
    }
  }

  /**
   * Handle GET /v1/community-field/info endpoint.
   * Returns summary of all active epochs.
   */
  private handleCommunityFieldInfo(
    res: ServerResponse,
    req: IncomingMessage,
    requestId: string,
  ): void {
    if (!this.communityFieldService) {
      this.sendErrorResponse(
        res, 501, 'SERVICE_UNAVAILABLE',
        'Community field service not configured',
        requestId,
      );
      return;
    }

    const info = this.communityFieldService.getInfo();
    res.setHeader('Cache-Control', 'private, max-age=60');
    this.sendSuccessResponse(res, info, requestId, true);
  }

  /**
   * Handle GET /v1/community-field/epoch/:epochDate endpoint.
   * Returns summary + contributions for a specific epoch.
   */
  private handleCommunityFieldEpoch(
    basePath: string,
    res: ServerResponse,
    req: IncomingMessage,
    requestId: string,
  ): void {
    if (!this.communityFieldService) {
      this.sendErrorResponse(
        res, 501, 'SERVICE_UNAVAILABLE',
        'Community field service not configured',
        requestId,
      );
      return;
    }

    const epochDate = basePath.replace('/community-field/epoch/', '');
    const summary = this.communityFieldService.getEpochSummary(epochDate);

    if (!summary) {
      this.sendErrorResponse(res, 404, 'NOT_FOUND', `No contributions for epoch ${epochDate}`, requestId);
      return;
    }

    const contributions = this.communityFieldService.getContributions(epochDate);
    res.setHeader('Cache-Control', 'private, max-age=60');
    this.sendSuccessResponse(res, {
      ...summary,
      contributions,
    }, requestId, true);
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

    // Idempotency key support: if present, check cache before proceeding
    const idempotencyKey = req.headers['x-idempotency-key'] as string | undefined;
    if (idempotencyKey) {
      const cached = this.idempotencyCache.get(idempotencyKey);
      if (cached && Date.now() < cached.expiresAt) {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Idempotency-Cached', 'true');
        this.sendSuccessResponse(res, cached.result, requestId, false);
        return;
      }
    }

    try {
      const result = await this.registrationService.insertLeaf(
        validation.data.leaf,
        { attestationHash: validation.data.attestationHash },
      );

      // BR5-007: Notify sync service for periodic IPFS backup
      const log = this.registrationService.getInsertionLog();
      if (log) {
        this.syncService.notifyInsertion(log);
      }

      // Wave 39d: Generate signed registration receipt (anti-censorship proof).
      // W40-001: Return both the signed data AND the signature so clients
      // can independently verify the receipt with the server's public key.
      let receipt: { data: string; sig: string } | undefined;
      if (this.signer) {
        const receiptData = JSON.stringify({
          leafIndex: result.leafIndex,
          leaf: validation.data.leaf,
          userRoot: result.userRoot,
          ts: Date.now(),
        });
        receipt = {
          data: receiptData,
          sig: this.signer.sign(receiptData),
        };
      }

      const responseData = { ...result, receipt };

      // Cache result by idempotency key
      if (idempotencyKey) {
        this.idempotencyCache.set(idempotencyKey, {
          result: responseData,
          expiresAt: Date.now() + this.idempotencyCacheTTL,
        });
      }

      // No cache for mutations
      res.setHeader('Cache-Control', 'no-store');

      this.sendSuccessResponse(
        res, responseData, requestId, false,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';

      if (msg === 'DUPLICATE_LEAF') {
        // CR-006: Return 400 indistinguishable from other validation errors
        // to prevent registration oracle attacks. Clients needing idempotency
        // should use the X-Idempotency-Key header instead.
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

    // Idempotency key support: if present, check cache before proceeding
    const idempotencyKey = req.headers['x-idempotency-key'] as string | undefined;
    if (idempotencyKey) {
      const cached = this.idempotencyCache.get(idempotencyKey);
      if (cached && Date.now() < cached.expiresAt) {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Idempotency-Cached', 'true');
        this.sendSuccessResponse(res, cached.result, requestId, false);
        return;
      }
    }

    try {
      const result = await this.registrationService.replaceLeaf(
        validation.data.oldLeafIndex,
        validation.data.newLeaf,
        { attestationHash: validation.data.attestationHash }, // W40-002: forward attestationHash
      );

      // BR5-007: Notify sync service for periodic IPFS backup
      const log = this.registrationService.getInsertionLog();
      if (log) {
        this.syncService.notifyInsertion(log);
      }

      // W40-003: Generate signed receipt for replacements (parity with /v1/register)
      let receipt: { data: string; sig: string } | undefined;
      if (this.signer) {
        const receiptData = JSON.stringify({
          leafIndex: result.leafIndex,
          leaf: validation.data.newLeaf,
          userRoot: result.userRoot,
          ts: Date.now(),
        });
        receipt = {
          data: receiptData,
          sig: this.signer.sign(receiptData),
        };
      }

      const responseData = { ...result, receipt };

      // Cache result by idempotency key
      if (idempotencyKey) {
        this.idempotencyCache.set(idempotencyKey, {
          result: responseData,
          expiresAt: Date.now() + this.idempotencyCacheTTL,
        });
      }

      // No cache for mutations
      res.setHeader('Cache-Control', 'no-store');

      this.sendSuccessResponse(
        res, responseData, requestId, false,
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
   * Handle GET /v1/tree/leaf/:index endpoint
   *
   * Returns the leaf value at a given index in Tree 1.
   * Used by communique's reconciliation job to verify Postgres ↔ atlas consistency.
   */
  private handleTreeLeaf(
    basePath: string,
    res: ServerResponse,
    req: IncomingMessage,
    requestId: string,
  ): void {
    if (!this.registrationService) {
      this.sendErrorResponse(
        res, 501, 'REGISTRATION_UNAVAILABLE',
        'Registration service not configured',
        requestId,
      );
      return;
    }

    // Authenticate (same as registration endpoints)
    if (this.registrationAuthToken) {
      const authHeader = req.headers['authorization'];
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.setHeader('WWW-Authenticate', 'Bearer');
        this.sendErrorResponse(res, 401, 'UNAUTHORIZED', 'Authorization required', requestId);
        return;
      }
      const token = authHeader.slice(7);
      if (!this.constantTimeEqual(token, this.registrationAuthToken)) {
        this.sendErrorResponse(res, 403, 'FORBIDDEN', 'Invalid authorization token', requestId);
        return;
      }
    }

    const indexStr = basePath.replace('/tree/leaf/', '');
    const index = parseInt(indexStr, 10);
    if (isNaN(index) || index < 0) {
      this.sendErrorResponse(res, 400, 'INVALID_PARAMETERS', 'Leaf index must be a non-negative integer', requestId);
      return;
    }

    const result = this.registrationService.getLeafAt(index);
    if (!result) {
      this.sendErrorResponse(res, 400, 'INVALID_PARAMETERS', 'Leaf index out of range', requestId);
      return;
    }

    this.sendSuccessResponse(res, {
      leafIndex: index,
      leaf: result.leaf,
      isEmpty: result.isEmpty,
      treeSize: this.registrationService.leafCount,
    }, requestId, false);
  }

  /**
   * Handle GET /v1/tree/info endpoint
   *
   * Returns tree metadata for bulk reconciliation.
   */
  private handleTreeInfo(
    res: ServerResponse,
    req: IncomingMessage,
    requestId: string,
  ): void {
    if (!this.registrationService) {
      this.sendErrorResponse(
        res, 501, 'REGISTRATION_UNAVAILABLE',
        'Registration service not configured',
        requestId,
      );
      return;
    }

    // Authenticate (same as registration endpoints)
    if (this.registrationAuthToken) {
      const authHeader = req.headers['authorization'];
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.setHeader('WWW-Authenticate', 'Bearer');
        this.sendErrorResponse(res, 401, 'UNAUTHORIZED', 'Authorization required', requestId);
        return;
      }
      const token = authHeader.slice(7);
      if (!this.constantTimeEqual(token, this.registrationAuthToken)) {
        this.sendErrorResponse(res, 403, 'FORBIDDEN', 'Invalid authorization token', requestId);
        return;
      }
    }

    this.sendSuccessResponse(res, {
      treeSize: this.registrationService.leafCount,
      root: this.registrationService.getRootHex(),
      depth: this.registrationService.depth,
      capacity: this.registrationService.treeCapacity,
    }, requestId, false);
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
    // Multi-vintage: resolve ?vintage= param, fall back to default tree
    const targetState = this.resolveVintage(url);
    if (!targetState) {
      const vintageParam = url.searchParams.get('vintage');
      if (vintageParam) {
        this.sendErrorResponse(
          res, 404, 'VINTAGE_NOT_FOUND',
          `Vintage "${vintageParam}" not loaded. Available: ${this.getVintageLabels().join(', ') || 'none'}`,
          requestId,
        );
      } else {
        this.sendErrorResponse(
          res, 501, 'CELL_PROOF_UNAVAILABLE',
          'Cell proof service not configured',
          requestId,
        );
      }
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
      const districts = targetState.districtMap.get(cellIdStr);
      if (!districts) {
        this.sendErrorResponse(
          res, 404, 'CELL_NOT_FOUND',
          'Cell ID not found in district map',
          requestId,
        );
        return;
      }

      // Generate SMT proof
      const proof = await targetState.tree.getProof(cellId);

      const result: CellProofResult = {
        cellMapRoot: '0x' + targetState.root.toString(16),
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
   * Handle GET /v1/cell-map-info endpoint.
   *
   * Returns Tree 2 metadata (root, depth, cellCount) so clients can
   * verify they have the correct public input for ZK proofs.
   */
  private handleCellMapInfo(
    res: ServerResponse,
    requestId: string,
  ): void {
    if (!this.cellMapState) {
      this.sendSuccessResponse(res, {
        available: false,
        vintages: this.getVintageLabels(),
      }, requestId, false);
      return;
    }

    this.sendSuccessResponse(res, {
      available: true,
      root: '0x' + this.cellMapState.root.toString(16),
      depth: this.cellMapState.depth,
      cellCount: this.cellMapState.commitments.size,
      currentVintage: this.currentVintageLabel,
      vintages: this.getVintageLabels(),
    }, requestId, false);
  }

  // ========================================================================
  // Engagement Tree (Tree 3) Endpoints
  // ========================================================================

  /**
   * Handle GET /v1/engagement-info endpoint.
   * Returns Tree 3 metadata (root, depth, leafCount).
   */
  private handleEngagementInfo(
    res: ServerResponse,
    req: IncomingMessage,
    requestId: string,
  ): void {
    // Rate limit info endpoint to prevent real-time tree-growth tracking (API ENG-009)
    const clientId = this.getClientId(req);
    const rateResult = this.rateLimiter.check(clientId);
    if (!rateResult.allowed) {
      this.sendErrorResponse(res, 429, 'RATE_LIMIT_EXCEEDED', 'Rate limit exceeded', requestId);
      return;
    }
    if (!this.engagementService) {
      this.sendSuccessResponse(res, { available: false }, requestId, false);
      return;
    }

    this.sendSuccessResponse(res, {
      available: true,
      root: this.engagementService.getRootHex(),
      depth: this.engagementService.getDepth(),
      leafCount: this.engagementService.getLeafCount(),
    }, requestId, false);
  }

  /**
   * Handle GET /v1/engagement-path/:leafIndex endpoint.
   * Returns Merkle proof for an engagement leaf.
   */
  private handleEngagementPath(
    basePath: string,
    res: ServerResponse,
    req: IncomingMessage,
    requestId: string,
  ): void {
    if (!this.engagementService) {
      this.sendErrorResponse(
        res, 501, 'ENGAGEMENT_UNAVAILABLE',
        'Engagement service not configured',
        requestId,
      );
      return;
    }

    // Rate limiting
    const clientId = this.getClientId(req);
    const rateResult = this.rateLimiter.check(clientId);
    if (!rateResult.allowed) {
      this.sendErrorResponse(res, 429, 'RATE_LIMIT_EXCEEDED', 'Rate limit exceeded', requestId);
      return;
    }

    const leafIndex = parseInt(basePath.split('/').pop()!, 10);
    if (isNaN(leafIndex) || leafIndex < 0 || leafIndex > Number.MAX_SAFE_INTEGER) {
      this.sendErrorResponse(res, 400, 'INVALID_PARAMETERS', 'Invalid leaf index', requestId);
      return;
    }

    try {
      const proof = this.engagementService.getProof(leafIndex);
      // Proofs are state-dependent — no caching (API ENG-008)
      res.setHeader('Cache-Control', 'no-store');
      this.sendSuccessResponse(res, proof, requestId, false);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      if (msg.includes('out of range')) {
        this.sendErrorResponse(res, 404, 'LEAF_NOT_FOUND', 'Leaf index out of range', requestId);
      } else {
        this.healthMonitor.recordError(msg);
        this.sendErrorResponse(res, 500, 'INTERNAL_ERROR', 'Engagement proof failed', requestId);
      }
    }
  }

  /**
   * Handle GET /v1/engagement-metrics/:identityCommitment endpoint.
   * Returns current engagement metrics for an identity.
   */
  private handleEngagementMetrics(
    basePath: string,
    res: ServerResponse,
    req: IncomingMessage,
    requestId: string,
  ): void {
    if (!this.engagementService) {
      this.sendErrorResponse(
        res, 501, 'ENGAGEMENT_UNAVAILABLE',
        'Engagement service not configured',
        requestId,
      );
      return;
    }

    // Rate limiting
    const clientId = this.getClientId(req);
    const rateResult = this.rateLimiter.check(clientId);
    if (!rateResult.allowed) {
      this.sendErrorResponse(res, 429, 'RATE_LIMIT_EXCEEDED', 'Rate limit exceeded', requestId);
      return;
    }

    const icHex = basePath.split('/').pop()!;
    try {
      const ic = BigInt(icHex.startsWith('0x') ? icHex : '0x' + icHex);
      const record = this.engagementService.getMetrics(ic);

      if (!record) {
        this.sendErrorResponse(res, 404, 'IDENTITY_NOT_FOUND', 'Identity not registered', requestId);
        return;
      }

      this.sendSuccessResponse(res, {
        identityCommitment: '0x' + record.identityCommitment.toString(16),
        tier: record.tier,
        actionCount: record.metrics.actionCount,
        diversityScore: record.metrics.diversityScore,
        tenureMonths: record.metrics.tenureMonths,
        leafIndex: record.leafIndex,
      }, requestId, false);
    } catch {
      this.sendErrorResponse(res, 400, 'INVALID_PARAMETERS', 'Invalid identityCommitment', requestId);
    }
  }

  /**
   * Handle GET /v1/engagement-breakdown/:identityCommitment endpoint.
   * Returns detailed tier breakdown with composite score factors and tier boundaries.
   */
  private handleEngagementBreakdown(
    basePath: string,
    res: ServerResponse,
    req: IncomingMessage,
    requestId: string,
  ): void {
    if (!this.engagementService) {
      this.sendErrorResponse(
        res, 501, 'ENGAGEMENT_UNAVAILABLE',
        'Engagement service not configured',
        requestId,
      );
      return;
    }

    const clientId = this.getClientId(req);
    const rateResult = this.rateLimiter.check(clientId);
    if (!rateResult.allowed) {
      this.sendErrorResponse(res, 429, 'RATE_LIMIT_EXCEEDED', 'Rate limit exceeded', requestId);
      return;
    }

    const icHex = basePath.split('/').pop()!;
    try {
      const ic = BigInt(icHex.startsWith('0x') ? icHex : '0x' + icHex);
      const breakdown = this.engagementService.getBreakdown(ic);

      if (!breakdown) {
        this.sendErrorResponse(res, 404, 'IDENTITY_NOT_FOUND', 'Identity not registered', requestId);
        return;
      }

      this.sendSuccessResponse(res, breakdown, requestId, false);
    } catch {
      this.sendErrorResponse(res, 400, 'INVALID_PARAMETERS', 'Invalid identityCommitment', requestId);
    }
  }

  /**
   * Handle POST /v1/engagement/register endpoint.
   * Registers an identity for engagement tracking (inserts tier-0 leaf).
   */
  private async handleEngagementRegister(
    req: IncomingMessage,
    res: ServerResponse,
    requestId: string,
  ): Promise<void> {
    if (!this.engagementService) {
      this.sendErrorResponse(
        res, 501, 'ENGAGEMENT_UNAVAILABLE',
        'Engagement service not configured',
        requestId,
      );
      return;
    }

    // Rate limiting BEFORE auth — prevents unlimited token probing (API ENG-002)
    const clientId = this.getClientId(req);
    const rateResult = this.registrationRateLimiter.check(clientId);
    res.setHeader('X-RateLimit-Limit', 5);
    res.setHeader('X-RateLimit-Remaining', rateResult.remaining);
    res.setHeader('X-RateLimit-Reset', Math.floor(rateResult.resetAt / 1000));
    if (!rateResult.allowed) {
      this.sendErrorResponse(res, 429, 'RATE_LIMIT_EXCEEDED', 'Rate limit exceeded', requestId);
      return;
    }

    // Auth check (same pattern as Tree 1 registration)
    if (this.registrationAuthToken) {
      const authHeader = req.headers['authorization'];
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        // RFC 7235 requires WWW-Authenticate on 401 (API ENG-003)
        res.setHeader('WWW-Authenticate', 'Bearer');
        this.sendErrorResponse(res, 401, 'UNAUTHORIZED', 'Authorization required', requestId);
        return;
      }
      const token = authHeader.slice(7);
      // Use consistent HMAC-based comparison (API ENG-010)
      if (!this.constantTimeEqual(token, this.registrationAuthToken)) {
        this.sendErrorResponse(res, 403, 'FORBIDDEN', 'Invalid authorization token', requestId);
        return;
      }
    }

    // Content-Type validation before reading body (API ENG-002)
    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('application/json')) {
      this.sendErrorResponse(res, 415, 'INVALID_BODY', 'Content-Type must be application/json', requestId);
      return;
    }

    // Parse body
    const body = await this.readBody(req);
    if (!body) {
      this.sendErrorResponse(res, 400, 'INVALID_BODY', 'Request body is required', requestId);
      return;
    }

    const validation = engagementRegisterSchema.safeParse(body);
    if (!validation.success) {
      this.sendErrorResponse(res, 400, 'INVALID_PARAMETERS', 'Invalid registration parameters', requestId);
      return;
    }

    try {
      const { signerAddress, identityCommitment: icStr } = validation.data;
      const ic = BigInt(icStr.startsWith('0x') ? icStr : '0x' + icStr);
      const leafIndex = await this.engagementService.registerIdentity(signerAddress, ic);

      // Notify sync service for IPFS backup (parity with handleRegister)
      const engLog = this.engagementService.getInsertionLog();
      if (engLog) {
        this.syncService.notifyInsertion(engLog);
      }

      res.setHeader('Cache-Control', 'no-store');
      this.sendSuccessResponse(res, {
        leafIndex,
        engagementRoot: this.engagementService.getRootHex(),
      }, requestId, false);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      if (msg === 'IDENTITY_ALREADY_REGISTERED' || msg === 'SIGNER_ALREADY_REGISTERED') {
        // W-004: Oracle-resistant — return identical HTTP status, error code, and message
        // as Tree 1 duplicate handling (CR-006/S-08) to prevent cross-tree registration oracle.
        this.sendErrorResponse(res, 400, 'INVALID_PARAMETERS', 'Invalid registration parameters', requestId);
      } else if (msg.includes('BN254')) {
        this.sendErrorResponse(res, 400, 'INVALID_PARAMETERS', 'Invalid field element', requestId);
      } else if (msg.includes('capacity')) {
        this.sendErrorResponse(res, 503, 'TREE_FULL', 'Engagement tree is full', requestId);
      } else {
        this.healthMonitor.recordError(msg);
        this.sendErrorResponse(res, 500, 'INTERNAL_ERROR', 'Registration failed', requestId);
      }
    }
  }

  // ========================================================================
  // Debate Market Endpoints
  // ========================================================================

  /**
   * Handle GET /v1/debate/:debateId endpoint.
   * Returns current market state for a debate.
   */
  private handleDebateState(
    basePath: string,
    res: ServerResponse,
    req: IncomingMessage,
    requestId: string,
  ): void {
    if (!this.debateService) {
      this.sendErrorResponse(
        res, 501, 'DEBATE_UNAVAILABLE',
        'Debate market service not configured',
        requestId,
      );
      return;
    }

    // Rate limiting
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

    // Extract debateId from path: /debate/0x... -> 0x...
    const segments = basePath.split('/');
    const debateId = segments[2];
    if (!debateId) {
      this.sendErrorResponse(res, 400, 'INVALID_PARAMETERS', 'Missing debateId', requestId);
      return;
    }

    const state = this.debateService.getMarketState(debateId);
    if (!state) {
      this.sendErrorResponse(
        res, 404, 'DEBATE_NOT_FOUND',
        'Debate not found',
        requestId,
      );
      return;
    }

    // Short cache — state changes frequently
    res.setHeader('Cache-Control', 'public, max-age=5');
    this.sendSuccessResponse(res, state, requestId, false);
  }

  /**
   * Handle GET /v1/debate/:debateId/position-proof/:positionIndex endpoint.
   *
   * Returns a Merkle inclusion proof for a position commitment leaf in the
   * per-debate position tree. The proof is consumed by the position_note
   * Noir circuit when generating a private settlement proof.
   *
   * Path format: /debate/0x{64-hex}/position-proof/{N}
   *
   * Response:
   *   {
   *     positionPath:  string[],  // sibling hashes as 0x-prefixed hex, leaf→root
   *     positionIndex: number,    // zero-based leaf index (echoed for confirmation)
   *     positionRoot:  string     // current Merkle root as 0x-prefixed hex
   *   }
   *
   * Returns 404 if the debate has no position tree yet or if the index is out of range.
   * Returns 503 if the debate service is not configured.
   */
  private async handleDebatePositionProof(
    basePath: string,
    res: ServerResponse,
    req: IncomingMessage,
    requestId: string,
  ): Promise<void> {
    if (!this.debateService) {
      this.sendErrorResponse(
        res, 501, 'DEBATE_UNAVAILABLE',
        'Debate market service not configured',
        requestId,
      );
      return;
    }

    // Rate limiting (same budget as debate state endpoint)
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

    // Extract path segments: /debate/<debateId>/position-proof/<positionIndex>
    // segments[0] = '' (leading slash), segments[1] = 'debate', segments[2] = debateId,
    // segments[3] = 'position-proof', segments[4] = positionIndex
    const segments = basePath.split('/');
    const debateId = segments[2];
    const rawIndex = segments[4];

    if (!debateId || !rawIndex) {
      this.sendErrorResponse(res, 400, 'INVALID_PARAMETERS', 'Missing debateId or positionIndex', requestId);
      return;
    }

    const positionIndex = parseInt(rawIndex, 10);
    if (!Number.isFinite(positionIndex) || positionIndex < 0) {
      this.sendErrorResponse(res, 400, 'INVALID_PARAMETERS', 'positionIndex must be a non-negative integer', requestId);
      return;
    }

    try {
      const proof = await this.debateService.getPositionProof(debateId, positionIndex);

      if (!proof) {
        this.sendErrorResponse(
          res, 404, 'POSITION_NOT_FOUND',
          'Debate has no position tree or positionIndex is out of range',
          requestId,
        );
        return;
      }

      const root = await this.debateService.getPositionRoot(debateId);

      // Serialize bigint path elements as 0x-prefixed hex — JSON cannot represent bigints
      const positionPath = proof.path.map((n: bigint) => '0x' + n.toString(16).padStart(64, '0'));
      const positionRoot = root !== null ? '0x' + root.toString(16).padStart(64, '0') : '0x' + '0'.repeat(64);

      // Position proofs are stable once the leaf is inserted; short cache is safe
      res.setHeader('Cache-Control', 'public, max-age=30');

      this.sendSuccessResponse(res, {
        positionPath,
        positionIndex: proof.index,
        positionRoot,
      }, requestId, false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logger.error('Position proof generation failed', { requestId, debateId, positionIndex, error: msg });
      this.sendErrorResponse(
        res, 500, 'INTERNAL_ERROR',
        'Position proof generation failed',
        requestId,
      );
    }
  }

  /**
   * Handle GET /v1/debate/:debateId/stream endpoint.
   * SSE endpoint for real-time debate price updates.
   *
   * Sets appropriate headers for Server-Sent Events and delegates
   * to DebateService for subscription management.
   */
  private handleDebateStream(
    basePath: string,
    res: ServerResponse,
    req: IncomingMessage,
    requestId: string,
  ): void {
    if (!this.debateService) {
      this.sendErrorResponse(
        res, 501, 'DEBATE_UNAVAILABLE',
        'Debate market service not configured',
        requestId,
      );
      return;
    }

    // Rate limiting (SSE connections are long-lived so this controls connection rate)
    const clientId = this.getClientId(req);
    const rateResult = this.rateLimiter.check(clientId);
    if (!rateResult.allowed) {
      this.sendErrorResponse(
        res, 429, 'RATE_LIMIT_EXCEEDED',
        'Rate limit exceeded. Please try again later.',
        requestId,
      );
      return;
    }

    // Extract debateId from path: /debate/0x.../stream -> 0x...
    const segments = basePath.split('/');
    const debateId = segments[2];
    if (!debateId) {
      this.sendErrorResponse(res, 400, 'INVALID_PARAMETERS', 'Missing debateId', requestId);
      return;
    }

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
      'X-Request-ID': requestId,
      'X-API-Version': this.apiVersion.version,
    });

    // Flush headers immediately
    res.flushHeaders();

    logger.info('SSE stream opened', {
      requestId,
      debateId,
    });

    // Delegate to debate service for subscription management
    this.debateService.addSSEClient(debateId, res);
  }

  /**
   * Read and parse JSON request body (max 1KB for registration).
   */
  private readBody(req: IncomingMessage): Promise<unknown | null> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const maxSize = 1024; // 1KB max for registration body
      let resolved = false;

      // BR7-010: Slowloris protection — abort if body isn't received within 10s
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          req.destroy();
          resolve(null);
        }
      }, 10_000);

      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxSize) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            resolve(null);
            req.destroy();
          }
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve(JSON.parse(raw));
        } catch {
          resolve(null);
        }
      });

      req.on('error', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(null);
        }
      });
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
      services: {
        districtLookup: !!this.lookupService,
        proofService: !!this.proofService,
        officials: !!this.officialsService,
        geocoding: !!this.geocodeService,
        engagement: !!this.engagementService,
        debates: !!this.debateService,
        signer: !!this.signer,
      },
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
   * Handle GET /v1/signing-key endpoint
   *
   * Returns the server's Ed25519 public key so anyone can independently
   * verify insertion log signatures and registration receipts.
   * This is the foundation of the "verifiable solo operator" trust model.
   */
  private handleSigningKey(res: ServerResponse, requestId: string, req?: IncomingMessage): void {
    // W40-009: Rate limit to prevent DoS
    if (req) {
      const clientId = this.getClientId(req);
      const rateResult = this.rateLimiter.check(clientId);
      if (!rateResult.allowed) {
        this.sendErrorResponse(res, 429, 'RATE_LIMIT_EXCEEDED', 'Rate limit exceeded', requestId);
        return;
      }
    }

    if (!this.signer) {
      this.sendErrorResponse(
        res, 501, 'SIGNING_UNAVAILABLE',
        'Server signing not configured',
        requestId,
      );
      return;
    }

    this.sendSuccessResponse(
      res,
      {
        publicKey: this.signer.info.publicKey,
        publicKeyHex: this.signer.getPublicKeyHex(),
        fingerprint: this.signer.info.fingerprint,
        algorithm: 'Ed25519',
      },
      requestId,
      true, // Cache-friendly — public key doesn't change
    );
  }

  /**
   * Set comprehensive security headers
   */
  private setSecurityHeaders(res: ServerResponse, requestId: string, req?: IncomingMessage): void {
    // CORS headers - only set if origins are configured
    if (this.corsOrigins.length > 0) {
      // BR7-011: Vary header for correct CDN/proxy cache behavior with dynamic CORS
      res.setHeader('Vary', 'Origin');
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
    // W-005: Length check removed — HMAC comparison is sufficient.
    // Different-length inputs produce different HMACs with overwhelming probability,
    // and the prior `&& a.length === b.length` was a non-timing-safe comparison
    // that could leak whether inputs have equal length via short-circuit evaluation.
    return timingSafeEqual(hashA, hashB);
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
    signer?: ServerSigner;
    engagementService?: EngagementService;
    officialsService?: OfficialsService;
    geocodeService?: GeocodeService;
    debateService?: DebateService;
    bubbleService?: BubbleService;
    communityFieldService?: CommunityFieldService;
  } = {}
): Promise<ShadowAtlasAPI> {
  // Initialize services — district DB may not exist in fresh Docker deployments
  let lookupService: DistrictLookupService | null = null;
  try {
    lookupService = new DistrictLookupService(dbPath);
  } catch (err) {
    logger.warn('District lookup service not available — /v1/lookup will return 501. ' +
      'Build the district DB via discover/extract scripts to enable.', {
      dbPath,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ProofService requires real districts/addresses — skip construction for serve-only mode.
  // When populated (e.g., from snapshot ingestion), pass a real ProofService to the constructor.
  const proofService: ProofService | null = null;

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
    options.signer ?? null,
    options.engagementService ?? null,
    options.officialsService ?? null,
    options.geocodeService ?? null,
    options.debateService ?? null,
    options.bubbleService ?? null,
    options.communityFieldService ?? null,
  );

  return api;
}
