/**
 * CLI Library Index
 *
 * Exports all shared CLI utilities for the shadow-atlas CLI.
 *
 * @module cli/lib
 */

// Codegen utilities
export {
  // Types
  type NdjsonHeader,
  type VerificationResult,
  type FieldMismatch,
  type GenerationResult,
  type ExtractionResult,
  type RegistryName,
  // Constants
  REGISTRY_NAMES,
  // Path utilities
  getPackageRoot,
  getNdjsonPath,
  getGeneratedPath,
  getSnapshotsDir as getCodegenSnapshotsDir,
  // NDJSON utilities
  parseNdjson,
  parseNdjsonEntries,
  // Core operations
  generateFromNdjson,
  extractToNdjson,
  verifyRoundTrip,
  // High-level operations
  generateAndWrite,
  extractAndWrite,
  checkNeedsRegeneration,
} from './codegen.js';

// Migration utilities
export {
  // Types
  type Snapshot,
  type SnapshotRegistry,
  type Migration,
  type MigrationContext,
  type NdjsonData,
  type MigrationValidation,
  type MigrationStatus,
  type AppliedMigration,
  type MigrationResult,
  type MigrationChange,
  // Path utilities
  getSnapshotsDir,
  getMigrationsDir,
  getMigrationHistoryPath,
  // NDJSON utilities
  readNdjsonFile,
  writeNdjsonFile,
  // Snapshot operations
  createSnapshot,
  restoreSnapshot,
  listSnapshots,
  getSnapshot,
  deleteSnapshot,
  // Migration operations
  loadMigration,
  applyMigration,
  rollback,
  getMigrationStatus,
} from './migration.js';

// Diagnostic utilities
export {
  // Types
  type BoundarySource,
  type ContainmentReport,
  type DistrictContainment,
  type CoverageReport,
  type UncoveredArea,
  type VintageComparison,
  type OverlapReport,
  type OverlapPair,
  type HealthReport,
  type HealthCheck,
  type HealthMetrics,
  // Registry utilities
  getEntryByFips,
  getRegistryCounts,
  // Analysis functions
  analyzeContainment,
  analyzeCoverage,
  detectOverlaps,
  runHealthCheck,
} from './diagnostics.js';
