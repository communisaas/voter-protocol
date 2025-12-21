/**
 * Shadow Atlas Security Module
 *
 * Production-grade security infrastructure for geographic boundary data.
 * Defense-in-depth approach with input validation, rate limiting, integrity checks, and audit logging.
 *
 * SECURITY ARCHITECTURE:
 * - Layer 1: Input Validation (reject malformed/malicious inputs)
 * - Layer 2: Rate Limiting (prevent DoS attacks)
 * - Layer 3: Integrity Verification (detect data tampering)
 * - Layer 4: Audit Logging (security event monitoring)
 *
 * TYPE SAFETY: Nuclear-level strictness. Zero tolerance for loose typing.
 */

// ============================================================================
// Input Validation
// ============================================================================

export {
  // Validation functions
  validateCoordinates,
  validateStateCode,
  validateStateFips,
  validateURL,
  validateJobID,
  validateSnapshotID,
  validateGeoJSON,
  validatePagination,
  validateContentType,
  validateResponseSize,

  // Schemas
  CoordinateSchema,
  StateCodeSchema,
  StateFipsSchema,
  URLSchema,
  JobIDSchema,
  SnapshotIDSchema,
  GeoJSONFeatureCollectionSchema,
  PaginationSchema,

  // Utility functions
  sanitizeErrorMessage,
  sanitizeLogData,

  // Constants
  MAX_RESPONSE_SIZES,

  // Types
  type ValidatedCoordinates,
  type ValidatedStateCode,
  type ValidatedStateFips,
  type ValidatedURL,
  type ValidatedJobID,
  type ValidatedSnapshotID,
  type ValidatedGeoJSONFeatureCollection,
  type ValidatedPagination,
} from './input-validator.js';

// ============================================================================
// Rate Limiting
// ============================================================================

export {
  // Rate limiter classes
  MultiTierRateLimiter,

  // Utility functions
  getClientIdentifier,
  normalizeIP,
  getEndpointCost,
  generateRateLimitHeaders,
  rateLimitMiddleware,
  createRateLimiter,

  // Default instance
  defaultRateLimiter,

  // Constants
  ENDPOINT_COSTS,

  // Types
  type RateLimitConfig,
  type RateLimitTier,
  type RateLimitResult,
  type ClientIdentifier,
  type RateLimitHeaders,
} from './rate-limiter.js';

// ============================================================================
// Integrity Verification
// ============================================================================

export {
  // Merkle proof verification
  verifyMerkleProof,

  // Geometry verification
  verifyGeometryIntegrity,

  // Boundary count verification
  verifyBoundaryCount,
  EXPECTED_BOUNDARY_COUNTS,

  // Cross-source validation
  compareBoundarySources,

  // Hash verification
  computeContentHash,
  verifyContentHash,

  // Snapshot verification
  verifySnapshotIntegrity,

  // Types
  type MerkleProof,
  type IntegrityCheckResult,
  type BoundaryIntegrityCheck,
  type BoundaryDiscrepancy,
} from './integrity-checker.js';

// ============================================================================
// Audit Logging
// ============================================================================

export {
  // Logger class
  SecurityAuditLogger,

  // Default instance
  defaultSecurityLogger,

  // Utility functions
  generateCorrelationId,
  hashAPIKey,
  extractClientInfo,
  extractRequestInfo,
  queryAuditLogs,
  verifyAuditLogIntegrity,

  // Types
  type SecuritySeverity,
  type SecurityEventCategory,
  type SecurityEvent,
  type AuditLogConfig,
} from './audit-logger.js';

// ============================================================================
// Convenience Exports
// ============================================================================

import { validateCoordinates } from './input-validator.js';
import { MultiTierRateLimiter, defaultRateLimiter } from './rate-limiter.js';
import { verifyMerkleProof } from './integrity-checker.js';
import { SecurityAuditLogger, defaultSecurityLogger } from './audit-logger.js';

/**
 * Security middleware bundle
 *
 * Use this to apply all security layers at once.
 */
export interface SecurityMiddleware {
  readonly validateInput: typeof validateCoordinates;
  readonly checkRateLimit: MultiTierRateLimiter['check'];
  readonly verifyIntegrity: typeof verifyMerkleProof;
  readonly logEvent: SecurityAuditLogger['log'];
}

/**
 * Create security middleware instance
 *
 * @param config - Optional configuration overrides
 * @returns Configured middleware
 */
export function createSecurityMiddleware(config?: {
  rateLimiter?: MultiTierRateLimiter;
  auditLogger?: SecurityAuditLogger;
}): SecurityMiddleware {
  const rateLimiter = config?.rateLimiter ?? defaultRateLimiter;
  const auditLogger = config?.auditLogger ?? defaultSecurityLogger;

  return {
    validateInput: validateCoordinates,
    checkRateLimit: rateLimiter.check.bind(rateLimiter),
    verifyIntegrity: verifyMerkleProof,
    logEvent: auditLogger.log.bind(auditLogger),
  };
}
