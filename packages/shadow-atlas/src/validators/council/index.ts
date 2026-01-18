/**
 * Council District Validation Suite
 *
 * Unified exports for tessellation-based verification.
 *
 * ARCHITECTURE:
 * - TessellationProofValidator: Mathematical proof of district correctness
 * - MunicipalBoundaryResolver: TIGER ground truth for city boundaries
 * - CouncilDistrictVerifier: Orchestrated 3-stage verification pipeline
 *
 * PROOF CHAIN:
 * 1. Registry Lookup → Expected count (ground truth)
 * 2. Boundary Resolution → Municipal polygon (TIGER)
 * 3. Tessellation Proof → Geometric correctness
 *
 * If all three succeed, the data is correct by construction.
 */

// Core validation primitives
export {
  TessellationProofValidator,
  proveTessellation,
  isValidTessellation,
  type TessellationProof,
} from './tessellation-proof.js';

// Municipal boundary resolution
export {
  MunicipalBoundaryResolver,
  resolveMunicipalBoundary,
  type MunicipalBoundary,
  type ResolutionResult,
} from './municipal-boundary.js';

// Unified verifier
export {
  CouncilDistrictVerifier,
  verifyCouncilDistricts,
  type VerificationResult,
} from './verifier.js';

// Pre-validation sanity checks (fast fail-fast validation)
export {
  runSanityChecks,
  passesSanityChecks,
  type SanityCheckResult,
  type SanityCheckOptions,
} from './pre-validation-sanity.js';

// Ingestion validator (unified pipeline for bulk ingestion)
export {
  IngestionValidator,
  validateForIngestion,
  validateBatchForIngestion,
  ValidationTier,
  AuthorityLevel,
  type IngestionValidationResult,
  type IngestionValidationOptions,
  type IngestionFailureStage,
  type BatchValidationSummary,
} from './ingestion-validator.js';

// Legacy exports (for backwards compatibility during migration)
export { CouncilDistrictValidator } from './validator.js';
export { resolveFips, batchResolveFips } from './fips-resolver.js';
export type { FipsResolution, FipsResolutionResult } from './fips-resolver.js';
export * from './edge-cases.js';
