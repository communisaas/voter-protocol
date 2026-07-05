-- Municipal Boundaries: Event-Sourced, Content-Addressed Database Schema
-- Version: 1.1.0
-- Philosophy: Zero git bloat, event sourcing, content-addressed storage
-- Changelog: v1.1.0 - Added CASCADE/RESTRICT constraints, confidence bounds, source_id index

-- CRITICAL: Enable foreign key enforcement (SQLite default is OFF)
PRAGMA foreign_keys = ON;

-- municipalities: finite universe (19k US incorporated places)
CREATE TABLE IF NOT EXISTS municipalities (
  id TEXT PRIMARY KEY,              -- "ca-los_angeles"
  name TEXT NOT NULL,               -- "Los Angeles, CA"
  state TEXT NOT NULL,              -- "CA"
  fips_place TEXT,                  -- Census FIPS code
  population INTEGER,
  county_fips TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_muni_state ON municipalities(state);
CREATE INDEX IF NOT EXISTS idx_muni_pop ON municipalities(population DESC);

-- sources: discovered portal endpoints per municipality
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  muni_id TEXT NOT NULL REFERENCES municipalities(id) ON DELETE CASCADE,  -- CASCADE: source is meaningless without its municipality
  kind TEXT NOT NULL CHECK (kind IN ('arcgis','socrata','ckan','geojson')),
  url TEXT NOT NULL,
  layer_hint TEXT,                  -- layer index or name
  title TEXT,
  description TEXT,
  discovered_at TEXT NOT NULL,
  score REAL,                       -- ranking score from heuristics
  UNIQUE (muni_id, kind, url)
);

CREATE INDEX IF NOT EXISTS idx_sources_muni ON sources(muni_id);

-- selections: chosen source per municipality (LLM or heuristic decision)
CREATE TABLE IF NOT EXISTS selections (
  muni_id TEXT PRIMARY KEY REFERENCES municipalities(id) ON DELETE CASCADE,  -- CASCADE: selection is meaningless without its municipality
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,  -- CASCADE: if source is deleted, selection must be re-evaluated
  district_field TEXT,              -- e.g., "DISTRICT", "WARD"
  member_field TEXT,                -- e.g., "COUNCILMEM", "MEMBER"
  at_large INTEGER NOT NULL DEFAULT 0,  -- 0/1 boolean
  confidence REAL CHECK (confidence >= 0 AND confidence <= 100),  -- BOUNDED: confidence scores must be 0-100
  decided_by TEXT NOT NULL,         -- 'heuristic' | 'llm' | 'manual'
  decided_at TEXT NOT NULL,
  model TEXT                        -- e.g., "gemini-2.5-flash" if llm
);

CREATE INDEX IF NOT EXISTS idx_selections_confidence ON selections(confidence);
CREATE INDEX IF NOT EXISTS idx_selections_decided_by ON selections(decided_by);
CREATE INDEX IF NOT EXISTS idx_selections_source_id ON selections(source_id);  -- PERFORMANCE: fast lookup of which selections use a given source

-- artifacts: normalized GeoJSON blobs (content-addressed)
CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  muni_id TEXT NOT NULL REFERENCES municipalities(id) ON DELETE CASCADE,  -- CASCADE: artifact is meaningless without its municipality
  content_sha256 TEXT NOT NULL,     -- key into R2/S3
  record_count INTEGER NOT NULL,
  bbox TEXT,                        -- JSON array [minLon, minLat, maxLon, maxLat]
  etag TEXT,
  last_modified TEXT,
  last_edit_date INTEGER,           -- ArcGIS editingInfo.lastEditDate (epoch ms)
  created_at TEXT NOT NULL,
  UNIQUE (content_sha256)           -- deduplication
);

CREATE INDEX IF NOT EXISTS idx_artifacts_muni ON artifacts(muni_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_sha ON artifacts(content_sha256);

-- heads: pointers to current artifact per municipality
CREATE TABLE IF NOT EXISTS heads (
  muni_id TEXT PRIMARY KEY REFERENCES municipalities(id) ON DELETE CASCADE,  -- CASCADE: head pointer is meaningless without its municipality
  artifact_id INTEGER NOT NULL REFERENCES artifacts(id) ON DELETE RESTRICT,  -- RESTRICT: cannot delete an artifact that is the current head (delete head first)
  updated_at TEXT NOT NULL
);

-- events: append-only provenance log
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  run_id TEXT NOT NULL,             -- batch/cron run identifier
  muni_id TEXT,
  kind TEXT NOT NULL,               -- 'DISCOVER','SELECT','FETCH','UPDATE','ERROR','SKIP'
  payload JSON NOT NULL,            -- small JSON blob with details
  model TEXT,                       -- if LLM involved
  duration_ms INTEGER,              -- operation timing
  error TEXT                        -- error message if kind='ERROR'
);

CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_muni ON events(muni_id);
CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);
CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id);

-- source_health: per-source freshness/reachability ledger (self-healing
-- data ops, docs/design/SELF-HEALING-DATA-OPS.md #Health ledger). One row
-- per SourceHealthConfig.id; vintage sources additionally get a derived
-- "<id>@next-vintage" row (same table, no schema change) for the
-- window-gated next-vintage probe. Populated by BOTH the fetch lane
-- (change-detector.ts, via check-changes.ts) and the probe lane
-- (source-prober.ts) — never both for the same source_id in one run.
--
-- probe_consecutive_failures / last_probe_at are a SEPARATE reachability
-- clock: fetch-lane rows (muni sources + the 2 congressional seeds) are
-- content-checked only when due (annual triggers), but MAY additionally get
-- a daily reachability probe. That probe writes ONLY these two columns —
-- never consecutive_failures/last_success_at/last_error, which the content
-- clock alone owns. A probe 200 can never mask (and a probe failure can
-- never fabricate) a content-fetch outcome.
--
-- registered_at stamps the first time this module ever recorded ANY
-- attempt (success, failure, or probe) for source_id, so the never-
-- succeeded staleness grace period (evaluateSourceHealth's opts.registeredAt)
-- has a real, persisted anchor instead of re-deriving "now" every run.
CREATE TABLE IF NOT EXISTS source_health (
  source_id            TEXT PRIMARY KEY,      -- matches SourceHealthConfig.id
  last_attempt_at      TEXT,
  last_success_at      TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error           TEXT,                  -- 'HTTP 404 …' / 'timeout' / 'parse: …'
  breach_state         TEXT NOT NULL DEFAULT 'ok',
                       -- ok | breached | remediating | escalated | manual
  breach_opened_at     TEXT,
  remediation_ref      TEXT,                  -- breach-issue / fix-PR URL
  probe_consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_probe_at         TEXT,
  registered_at         TEXT                  -- first attempt of any kind, ever
);
