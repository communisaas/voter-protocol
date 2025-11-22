-- Shadow Atlas Database Schema
-- Cloudflare D1 (SQLite)
-- Purpose: Track municipality discovery, selection, and artifact storage

-- ============================================================================
-- MUNICIPALITIES: Bootstrap from Census TIGER/Line Places
-- ============================================================================

CREATE TABLE IF NOT EXISTS municipalities (
  id TEXT PRIMARY KEY,                -- Normalized: "ca-san-francisco"
  name TEXT NOT NULL,                 -- Official name: "San Francisco"
  state TEXT NOT NULL,                -- Two-letter code: "CA"
  geoid TEXT NOT NULL UNIQUE,         -- Census GEOID: "0667000"
  population INTEGER,                 -- 2020 Census population

  -- Geometry (for bounding box filtering)
  bbox_min_lng REAL,                  -- WGS84 longitude
  bbox_min_lat REAL,                  -- WGS84 latitude
  bbox_max_lng REAL,
  bbox_max_lat REAL,

  -- Metadata
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for state-based queries
CREATE INDEX IF NOT EXISTS idx_municipalities_state ON municipalities(state);

-- Index for population-based prioritization (target top 500 cities first)
CREATE INDEX IF NOT EXISTS idx_municipalities_population ON municipalities(population DESC);

-- Index for spatial queries (bounding box)
CREATE INDEX IF NOT EXISTS idx_municipalities_bbox ON municipalities(
  bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
);

-- ============================================================================
-- MUNICIPALITY_STATE: Current status snapshot (event-sourced + snapshot)
-- ============================================================================

CREATE TABLE IF NOT EXISTS municipality_state (
  muni_id TEXT PRIMARY KEY REFERENCES municipalities(id),

  -- Discovery status
  discovery_status TEXT NOT NULL CHECK (discovery_status IN ('pending','found','not_found','error')) DEFAULT 'pending',
  discovered_at TEXT,
  discovery_error TEXT,

  -- Selection status
  selection_status TEXT NOT NULL CHECK (selection_status IN ('pending','selected','needs_review','skipped')) DEFAULT 'pending',
  selected_at TEXT,
  selected_source_id INTEGER REFERENCES sources(id),
  selection_confidence REAL,            -- 0.0 to 1.0
  selection_method TEXT CHECK (selection_method IN ('heuristic','llm','manual')),

  -- Fetch status
  fetch_status TEXT NOT NULL CHECK (fetch_status IN ('pending','fetched','failed')) DEFAULT 'pending',
  fetched_at TEXT,
  fetch_error TEXT,

  -- Current artifact
  current_artifact_id INTEGER REFERENCES artifacts(id),
  artifact_updated_at TEXT,

  -- Metadata
  last_checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  next_check_at TEXT                   -- For quarterly refresh scheduling
);

-- Index for refresh scheduling (quarterly updates)
CREATE INDEX IF NOT EXISTS idx_municipality_state_next_check
  ON municipality_state(next_check_at)
  WHERE next_check_at IS NOT NULL;

-- Index for status queries (filter by pipeline stage)
CREATE INDEX IF NOT EXISTS idx_municipality_state_status
  ON municipality_state(discovery_status, selection_status, fetch_status);

-- ============================================================================
-- SOURCES: Discovered data sources (ArcGIS, Socrata, CKAN, etc.)
-- ============================================================================

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  muni_id TEXT NOT NULL REFERENCES municipalities(id),

  -- Source metadata
  kind TEXT NOT NULL CHECK (kind IN ('arcgis','socrata','ckan','geojson','shapefile')),
  url TEXT NOT NULL,                   -- Full URL to data source
  title TEXT,                          -- Dataset title
  description TEXT,

  -- ArcGIS-specific
  layer_hint INTEGER,                  -- Layer index in FeatureServer
  layer_name TEXT,                     -- Layer name (for validation)
  geometry_type TEXT,                  -- "esriGeometryPolygon"

  -- Field names (for heuristic scoring)
  fields TEXT,                         -- JSON array of field names

  -- Scoring
  score INTEGER,                       -- Heuristic score (0-100)
  confidence REAL,                     -- Confidence (0.0-1.0)

  -- Metadata
  discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_validated_at TEXT
);

-- Index for municipality lookup
CREATE INDEX IF NOT EXISTS idx_sources_muni ON sources(muni_id);

-- Index for selecting best source (highest score first)
CREATE INDEX IF NOT EXISTS idx_sources_score ON sources(muni_id, score DESC);

-- ============================================================================
-- ARTIFACTS: GeoJSON files stored in R2
-- ============================================================================

CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  muni_id TEXT NOT NULL REFERENCES municipalities(id),

  -- Content addressing
  content_sha256 TEXT NOT NULL UNIQUE, -- SHA256 hash (R2 key)
  content_size_bytes INTEGER,          -- Original size
  compressed_size_bytes INTEGER,       -- Brotli compressed size

  -- GeoJSON metadata
  feature_count INTEGER,               -- Number of council districts
  geometry_type TEXT,                  -- "Polygon" or "MultiPolygon"
  crs TEXT DEFAULT 'EPSG:4326',        -- Coordinate reference system

  -- Bounding box (for spatial index)
  bbox_min_lng REAL,
  bbox_min_lat REAL,
  bbox_max_lng REAL,
  bbox_max_lat REAL,

  -- Provenance
  source_id INTEGER REFERENCES sources(id),
  source_url TEXT,                     -- Original download URL

  -- Metadata
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  validated_at TEXT
);

-- Index for municipality lookup
CREATE INDEX IF NOT EXISTS idx_artifacts_muni ON artifacts(muni_id);

-- Index for content-addressed lookup
CREATE INDEX IF NOT EXISTS idx_artifacts_sha256 ON artifacts(content_sha256);

-- ============================================================================
-- DISTRICT_BBOXES: Spatial index for fast point-in-polygon filtering
-- ============================================================================

CREATE TABLE IF NOT EXISTS district_bboxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  muni_id TEXT NOT NULL REFERENCES municipalities(id),
  artifact_id INTEGER NOT NULL REFERENCES artifacts(id),
  district_id TEXT NOT NULL,           -- e.g., "District 5"

  -- Bounding box (WGS84 coordinates)
  bbox_min_lng REAL NOT NULL,
  bbox_min_lat REAL NOT NULL,
  bbox_max_lng REAL NOT NULL,
  bbox_max_lat REAL NOT NULL,

  -- Metadata
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE (muni_id, artifact_id, district_id)
);

-- Spatial index (emulated with multi-column index)
CREATE INDEX IF NOT EXISTS idx_district_bboxes_spatial ON district_bboxes(
  muni_id,
  bbox_min_lng, bbox_max_lng,
  bbox_min_lat, bbox_max_lat
);

-- ============================================================================
-- EVENTS: Event-sourced provenance log (complete audit trail)
-- ============================================================================

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  run_id TEXT NOT NULL,                -- UUID for batch operations
  muni_id TEXT NOT NULL REFERENCES municipalities(id),

  -- Event type
  kind TEXT NOT NULL CHECK (kind IN ('DISCOVER','SELECT','FETCH','VALIDATE','ERROR','RETRY','SKIP','OVERRIDE')),

  -- Event payload (JSON)
  payload TEXT NOT NULL,               -- Full context (candidates, scores, reasoning)

  -- LLM attribution (if applicable)
  model TEXT,                          -- e.g., "gemini-2.5-flash"
  temperature REAL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,

  -- Performance
  duration_ms INTEGER
);

-- Index for municipality event history
CREATE INDEX IF NOT EXISTS idx_events_muni ON events(muni_id, ts DESC);

-- Index for run-based queries (replay batch operations)
CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id, ts ASC);

-- Index for compaction (delete old intermediate events)
CREATE INDEX IF NOT EXISTS idx_events_compaction ON events(ts, kind);

-- ============================================================================
-- DISTRICT_ADDRESSES: Address assignments (for Merkle tree construction)
-- ============================================================================
-- NOTE: This table will be MASSIVE (500M rows). Consider sharding by state.

CREATE TABLE IF NOT EXISTS district_addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  muni_id TEXT NOT NULL REFERENCES municipalities(id),
  district_id TEXT NOT NULL,           -- e.g., "District 5"

  -- Address
  address TEXT NOT NULL,               -- Full address string

  -- Coordinates (for validation)
  longitude REAL,
  latitude REAL,

  -- Source
  source TEXT CHECK (source IN ('openaddresses','census','voter_roll','manual')),

  -- Metadata
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for district-based queries (Merkle tree construction)
CREATE INDEX IF NOT EXISTS idx_district_addresses_district
  ON district_addresses(muni_id, district_id);

-- Index for address uniqueness (prevent duplicates)
CREATE INDEX IF NOT EXISTS idx_district_addresses_unique
  ON district_addresses(address, muni_id);

-- ============================================================================
-- MERKLE_ROOTS: Published Merkle tree roots (snapshots)
-- ============================================================================

CREATE TABLE IF NOT EXISTS merkle_roots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL UNIQUE, -- Incremental snapshot ID

  -- Roots (hex-encoded)
  national_root TEXT NOT NULL,         -- Root of entire national tree

  -- Provenance
  ipfs_cid TEXT,                       -- IPFS CID (optional)
  r2_key TEXT,                         -- R2 storage key

  -- On-chain publication
  scroll_tx_hash TEXT,                 -- Scroll L2 transaction hash
  scroll_block_number INTEGER,

  -- Metadata
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT
);

-- Index for latest snapshot lookup
CREATE INDEX IF NOT EXISTS idx_merkle_roots_latest
  ON merkle_roots(snapshot_id DESC);

-- ============================================================================
-- BOOTSTRAP DATA: Sample municipalities for testing
-- ============================================================================
-- NOTE: In production, this will be populated by Census TIGER/Line parser

INSERT OR IGNORE INTO municipalities (id, name, state, geoid, population) VALUES
  ('ca-san-francisco', 'San Francisco', 'CA', '0667000', 873965),
  ('tx-austin', 'Austin', 'TX', '4805000', 961855),
  ('il-chicago', 'Chicago', 'IL', '1714000', 2746388),
  ('ny-new-york', 'New York', 'NY', '3651000', 8336817),
  ('ca-los-angeles', 'Los Angeles', 'CA', '0644000', 3898747);

-- Initialize state table for test municipalities
INSERT OR IGNORE INTO municipality_state (muni_id) VALUES
  ('ca-san-francisco'),
  ('tx-austin'),
  ('il-chicago'),
  ('ny-new-york'),
  ('ca-los-angeles');
