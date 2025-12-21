-- Shadow Atlas Persistence Schema
-- Design Principles:
--   1. PostgreSQL-compatible types (no SQLite-specific features)
--   2. UUID primary keys for distributed-friendly identity
--   3. ISO8601 timestamps for cross-database compatibility
--   4. Soft deletes preserve audit trail
--   5. Normalized structure with proper foreign keys
--   6. Indexes optimized for common query patterns

-- ============================================================================
-- JOBS: Orchestration job lifecycle tracking
-- ============================================================================
-- Tracks batch extraction jobs from initiation through completion.
-- Supports resume-from-checkpoint via status transitions.

CREATE TABLE IF NOT EXISTS jobs (
  -- Identity
  id TEXT PRIMARY KEY NOT NULL, -- ULID or UUID

  -- Scope definition
  scope_states TEXT NOT NULL, -- JSON array of state codes
  scope_layers TEXT NOT NULL, -- JSON array of legislative layer types

  -- Lifecycle tracking
  status TEXT NOT NULL CHECK (status IN (
    'pending',
    'running',
    'partial',
    'completed',
    'failed',
    'cancelled'
  )),

  -- Temporal metadata
  created_at TEXT NOT NULL, -- ISO8601: 2025-12-17T10:30:00.000Z
  started_at TEXT,           -- NULL until job begins execution
  updated_at TEXT NOT NULL,
  completed_at TEXT,         -- NULL until terminal state reached

  -- Audit trail
  archived_at TEXT,          -- Soft delete timestamp

  -- Progress tracking
  total_tasks INTEGER NOT NULL DEFAULT 0,
  completed_tasks INTEGER NOT NULL DEFAULT 0,
  failed_tasks INTEGER NOT NULL DEFAULT 0,
  skipped_tasks INTEGER NOT NULL DEFAULT 0,

  -- Error context
  error_summary TEXT         -- High-level error message for failed jobs
);

-- Query pattern: Recent jobs by status
CREATE INDEX IF NOT EXISTS idx_jobs_status_created
  ON jobs(status, created_at DESC)
  WHERE archived_at IS NULL;

-- Query pattern: Active jobs requiring monitoring
CREATE INDEX IF NOT EXISTS idx_jobs_active
  ON jobs(status, updated_at DESC)
  WHERE archived_at IS NULL
    AND status IN ('pending', 'running', 'partial');

-- Query pattern: Job completion timeline
CREATE INDEX IF NOT EXISTS idx_jobs_completion
  ON jobs(completed_at DESC)
  WHERE archived_at IS NULL
    AND completed_at IS NOT NULL;

-- ============================================================================
-- EXTRACTIONS: Successful boundary extractions
-- ============================================================================
-- Records successful extraction of electoral boundaries from GIS portals.
-- One row per (job, state, layer) combination.

CREATE TABLE IF NOT EXISTS extractions (
  -- Identity
  id TEXT PRIMARY KEY NOT NULL,

  -- Foreign keys
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,

  -- Region identification
  state_code TEXT NOT NULL,  -- US-CA, US-TX, etc.
  layer_type TEXT NOT NULL CHECK (layer_type IN (
    'congressional',
    'state_senate',
    'state_house',
    'county',
    'city'
  )),

  -- Extraction results
  boundary_count INTEGER NOT NULL CHECK (boundary_count >= 0),
  validation_passed BOOLEAN NOT NULL,

  -- Source metadata
  source_url TEXT,           -- GIS portal endpoint
  source_type TEXT,          -- 'arcgis' | 'wfs' | 'geojson'

  -- Temporal metadata
  completed_at TEXT NOT NULL,

  -- Audit trail
  archived_at TEXT,

  -- Prevent duplicate extractions within same job
  UNIQUE(job_id, state_code, layer_type)
);

-- Query pattern: Extraction history per region
CREATE INDEX IF NOT EXISTS idx_extractions_region
  ON extractions(state_code, layer_type, completed_at DESC)
  WHERE archived_at IS NULL;

-- Query pattern: Job completion status
CREATE INDEX IF NOT EXISTS idx_extractions_job
  ON extractions(job_id, validation_passed);

-- Query pattern: Failed validations requiring investigation
CREATE INDEX IF NOT EXISTS idx_extractions_validation_failures
  ON extractions(completed_at DESC)
  WHERE archived_at IS NULL
    AND validation_passed = FALSE;

-- ============================================================================
-- FAILURES: Extraction failures with retry metadata
-- ============================================================================
-- Tracks failed extraction attempts for debugging and retry logic.
-- Multiple rows per (job, state, layer) if retried.

CREATE TABLE IF NOT EXISTS failures (
  -- Identity
  id TEXT PRIMARY KEY NOT NULL,

  -- Foreign keys
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,

  -- Region identification
  state_code TEXT NOT NULL,
  layer_type TEXT NOT NULL CHECK (layer_type IN (
    'congressional',
    'state_senate',
    'state_house',
    'county',
    'city'
  )),

  -- Failure details
  error_message TEXT NOT NULL,
  error_stack TEXT,          -- Full stack trace for debugging
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  retryable BOOLEAN NOT NULL,

  -- Source context
  source_url TEXT,
  source_type TEXT,

  -- Temporal metadata
  failed_at TEXT NOT NULL,

  -- Retry tracking
  retry_after TEXT,          -- ISO8601 timestamp for next retry attempt
  retried_at TEXT,           -- When retry was actually executed
  retry_succeeded BOOLEAN,   -- NULL until retry attempted

  -- Audit trail
  archived_at TEXT
);

-- Query pattern: Retryable failures for job recovery
CREATE INDEX IF NOT EXISTS idx_failures_retryable
  ON failures(job_id, retryable, failed_at DESC)
  WHERE archived_at IS NULL
    AND retryable = TRUE
    AND retried_at IS NULL;

-- Query pattern: Failure analysis by region
CREATE INDEX IF NOT EXISTS idx_failures_region
  ON failures(state_code, layer_type, failed_at DESC)
  WHERE archived_at IS NULL;

-- Query pattern: Failure patterns for debugging
CREATE INDEX IF NOT EXISTS idx_failures_retry_analysis
  ON failures(attempt_count, retryable, failed_at DESC)
  WHERE archived_at IS NULL;

-- ============================================================================
-- NOT_CONFIGURED: Skipped tasks due to missing registry config
-- ============================================================================
-- Records tasks that couldn't execute because registry lacks portal URLs.
-- Drives registry improvement efforts.

CREATE TABLE IF NOT EXISTS not_configured (
  -- Identity
  id TEXT PRIMARY KEY NOT NULL,

  -- Foreign keys
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,

  -- Region identification
  state_code TEXT NOT NULL,
  layer_type TEXT NOT NULL CHECK (layer_type IN (
    'congressional',
    'state_senate',
    'state_house',
    'county',
    'city'
  )),

  -- Configuration gap
  reason TEXT NOT NULL CHECK (reason IN (
    'state_not_in_registry',
    'layer_not_configured'
  )),

  -- Temporal metadata
  checked_at TEXT NOT NULL,

  -- Resolution tracking
  resolved_at TEXT,          -- When registry was updated
  resolved_by_job_id TEXT REFERENCES jobs(id),

  -- Audit trail
  archived_at TEXT,

  -- Prevent duplicate records
  UNIQUE(job_id, state_code, layer_type)
);

-- Query pattern: Registry gaps requiring attention
CREATE INDEX IF NOT EXISTS idx_not_configured_gaps
  ON not_configured(state_code, layer_type, reason)
  WHERE archived_at IS NULL
    AND resolved_at IS NULL;

-- Query pattern: Recently resolved gaps
CREATE INDEX IF NOT EXISTS idx_not_configured_resolved
  ON not_configured(resolved_at DESC)
  WHERE archived_at IS NULL
    AND resolved_at IS NOT NULL;

-- ============================================================================
-- SNAPSHOTS: Committed Merkle tree snapshots
-- ============================================================================
-- Records immutable snapshots of validated boundary data.
-- Each snapshot represents a content-addressed Merkle tree committed to IPFS.

CREATE TABLE IF NOT EXISTS snapshots (
  -- Identity
  id TEXT PRIMARY KEY NOT NULL,

  -- Foreign keys
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,

  -- Cryptographic commitments
  merkle_root TEXT NOT NULL UNIQUE,  -- Hex-encoded root hash
  ipfs_cid TEXT NOT NULL UNIQUE,     -- Content identifier

  -- Snapshot metadata
  boundary_count INTEGER NOT NULL CHECK (boundary_count > 0),
  regions TEXT NOT NULL,             -- JSON array of state codes

  -- Temporal metadata
  created_at TEXT NOT NULL,

  -- Publication tracking
  published_at TEXT,                 -- When snapshot was made publicly available
  deprecated_at TEXT,                -- When newer snapshot supersedes this one

  -- Audit trail
  archived_at TEXT
);

-- Query pattern: Latest snapshot for region
CREATE INDEX IF NOT EXISTS idx_snapshots_latest
  ON snapshots(created_at DESC)
  WHERE archived_at IS NULL
    AND deprecated_at IS NULL;

-- Query pattern: Lookup by merkle root (ZK circuit verification)
CREATE INDEX IF NOT EXISTS idx_snapshots_merkle_root
  ON snapshots(merkle_root)
  WHERE archived_at IS NULL;

-- Query pattern: IPFS content retrieval
CREATE INDEX IF NOT EXISTS idx_snapshots_ipfs
  ON snapshots(ipfs_cid)
  WHERE archived_at IS NULL;

-- ============================================================================
-- SNAPSHOT_REGIONS: Many-to-many relationship for snapshot coverage
-- ============================================================================
-- Normalized region tracking for efficient querying by state.

CREATE TABLE IF NOT EXISTS snapshot_regions (
  snapshot_id TEXT NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  state_code TEXT NOT NULL,

  PRIMARY KEY (snapshot_id, state_code)
);

-- Query pattern: Find snapshots covering specific state
CREATE INDEX IF NOT EXISTS idx_snapshot_regions_state
  ON snapshot_regions(state_code, snapshot_id);

-- ============================================================================
-- VALIDATION_RESULTS: Cross-validation outcomes
-- ============================================================================
-- Records results of validating extracted boundaries against authoritative
-- sources (Census TIGER, official district counts).

CREATE TABLE IF NOT EXISTS validation_results (
  -- Identity
  id TEXT PRIMARY KEY NOT NULL,

  -- Foreign keys
  extraction_id TEXT NOT NULL REFERENCES extractions(id) ON DELETE CASCADE,

  -- Validation scope
  validator_type TEXT NOT NULL CHECK (validator_type IN (
    'tiger_census',
    'official_district_count',
    'cross_portal',
    'geometric_integrity'
  )),

  -- Validation outcome
  passed BOOLEAN NOT NULL,

  -- Detailed results
  expected_count INTEGER,    -- For count-based validators
  actual_count INTEGER,
  discrepancies TEXT,        -- JSON array of specific issues

  -- Source metadata
  authority_source TEXT,     -- URL or identifier of validation source
  authority_version TEXT,    -- TIGER year, district count publication date

  -- Temporal metadata
  validated_at TEXT NOT NULL,

  -- Audit trail
  archived_at TEXT
);

-- Query pattern: Validation failures requiring investigation
CREATE INDEX IF NOT EXISTS idx_validation_failures
  ON validation_results(validator_type, validated_at DESC)
  WHERE archived_at IS NULL
    AND passed = FALSE;

-- Query pattern: Extraction validation status
CREATE INDEX IF NOT EXISTS idx_validation_by_extraction
  ON validation_results(extraction_id, validator_type);

-- ============================================================================
-- VIEWS: Common aggregations and reporting
-- ============================================================================

-- Job status summary with progress metrics
CREATE VIEW IF NOT EXISTS v_job_summary AS
SELECT
  j.id,
  j.status,
  j.created_at,
  j.started_at,
  j.completed_at,
  j.total_tasks,
  j.completed_tasks,
  j.failed_tasks,
  j.skipped_tasks,
  CAST(j.completed_tasks AS REAL) / NULLIF(j.total_tasks, 0) AS progress_ratio,
  COUNT(DISTINCT e.id) AS successful_extractions,
  COUNT(DISTINCT f.id) AS failed_attempts,
  COUNT(DISTINCT nc.id) AS not_configured_count,
  COUNT(DISTINCT s.id) AS snapshots_created
FROM jobs j
LEFT JOIN extractions e ON e.job_id = j.id AND e.archived_at IS NULL
LEFT JOIN failures f ON f.job_id = j.id AND f.archived_at IS NULL
LEFT JOIN not_configured nc ON nc.job_id = j.id AND nc.archived_at IS NULL
LEFT JOIN snapshots s ON s.job_id = j.id AND s.archived_at IS NULL
WHERE j.archived_at IS NULL
GROUP BY j.id;

-- Extraction coverage by region
CREATE VIEW IF NOT EXISTS v_extraction_coverage AS
SELECT
  e.state_code,
  e.layer_type,
  COUNT(*) AS total_extractions,
  SUM(CASE WHEN e.validation_passed THEN 1 ELSE 0 END) AS validated_extractions,
  MAX(e.completed_at) AS latest_extraction,
  SUM(e.boundary_count) AS total_boundaries
FROM extractions e
WHERE e.archived_at IS NULL
GROUP BY e.state_code, e.layer_type;

-- Registry gaps requiring attention
CREATE VIEW IF NOT EXISTS v_registry_gaps AS
SELECT
  nc.state_code,
  nc.layer_type,
  nc.reason,
  COUNT(*) AS occurrence_count,
  MAX(nc.checked_at) AS latest_check,
  MIN(nc.checked_at) AS first_detected
FROM not_configured nc
WHERE nc.archived_at IS NULL
  AND nc.resolved_at IS NULL
GROUP BY nc.state_code, nc.layer_type, nc.reason;

-- Validation failure patterns
CREATE VIEW IF NOT EXISTS v_validation_patterns AS
SELECT
  vr.validator_type,
  e.state_code,
  e.layer_type,
  COUNT(*) AS failure_count,
  AVG(CAST(vr.expected_count AS REAL) - CAST(vr.actual_count AS REAL)) AS avg_discrepancy,
  MAX(vr.validated_at) AS latest_failure
FROM validation_results vr
JOIN extractions e ON e.id = vr.extraction_id
WHERE vr.archived_at IS NULL
  AND vr.passed = FALSE
GROUP BY vr.validator_type, e.state_code, e.layer_type;

-- Active snapshots with metadata
CREATE VIEW IF NOT EXISTS v_active_snapshots AS
SELECT
  s.id,
  s.merkle_root,
  s.ipfs_cid,
  s.boundary_count,
  s.created_at,
  s.published_at,
  COUNT(DISTINCT sr.state_code) AS region_count,
  GROUP_CONCAT(DISTINCT sr.state_code) AS covered_states
FROM snapshots s
LEFT JOIN snapshot_regions sr ON sr.snapshot_id = s.id
WHERE s.archived_at IS NULL
  AND s.deprecated_at IS NULL
GROUP BY s.id;
