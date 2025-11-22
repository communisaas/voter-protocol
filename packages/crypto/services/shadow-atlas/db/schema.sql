-- Municipal Boundaries: Event-Sourced, Content-Addressed Database Schema
-- Version: 1.0.0
-- Philosophy: Zero git bloat, event sourcing, content-addressed storage

-- municipalities: finite universe (19k US incorporated places)
CREATE TABLE municipalities (
  id TEXT PRIMARY KEY,              -- "ca-los_angeles"
  name TEXT NOT NULL,               -- "Los Angeles, CA"
  state TEXT NOT NULL,              -- "CA"
  fips_place TEXT,                  -- Census FIPS code
  population INTEGER,
  county_fips TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_muni_state ON municipalities(state);
CREATE INDEX idx_muni_pop ON municipalities(population DESC);

-- sources: discovered portal endpoints per municipality
CREATE TABLE sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  muni_id TEXT NOT NULL REFERENCES municipalities(id),
  kind TEXT NOT NULL CHECK (kind IN ('arcgis','socrata','ckan','geojson')),
  url TEXT NOT NULL,
  layer_hint TEXT,                  -- layer index or name
  title TEXT,
  description TEXT,
  discovered_at TEXT NOT NULL,
  score REAL,                       -- ranking score from heuristics
  UNIQUE (muni_id, kind, url)
);

CREATE INDEX idx_sources_muni ON sources(muni_id);

-- selections: chosen source per municipality (LLM or heuristic decision)
CREATE TABLE selections (
  muni_id TEXT PRIMARY KEY REFERENCES municipalities(id),
  source_id INTEGER NOT NULL REFERENCES sources(id),
  district_field TEXT,              -- e.g., "DISTRICT", "WARD"
  member_field TEXT,                -- e.g., "COUNCILMEM", "MEMBER"
  at_large INTEGER NOT NULL DEFAULT 0,  -- 0/1 boolean
  confidence REAL,                  -- 0.0-1.0
  decided_by TEXT NOT NULL,         -- 'heuristic' | 'llm' | 'manual'
  decided_at TEXT NOT NULL,
  model TEXT                        -- e.g., "gemini-2.5-flash" if llm
);

CREATE INDEX idx_selections_confidence ON selections(confidence);
CREATE INDEX idx_selections_decided_by ON selections(decided_by);

-- artifacts: normalized GeoJSON blobs (content-addressed)
CREATE TABLE artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  muni_id TEXT NOT NULL REFERENCES municipalities(id),
  content_sha256 TEXT NOT NULL,     -- key into R2/S3
  record_count INTEGER NOT NULL,
  bbox TEXT,                        -- JSON array [minLon, minLat, maxLon, maxLat]
  etag TEXT,
  last_modified TEXT,
  last_edit_date INTEGER,           -- ArcGIS editingInfo.lastEditDate (epoch ms)
  created_at TEXT NOT NULL,
  UNIQUE (content_sha256)           -- deduplication
);

CREATE INDEX idx_artifacts_muni ON artifacts(muni_id);
CREATE INDEX idx_artifacts_sha ON artifacts(content_sha256);

-- heads: pointers to current artifact per municipality
CREATE TABLE heads (
  muni_id TEXT PRIMARY KEY REFERENCES municipalities(id),
  artifact_id INTEGER NOT NULL REFERENCES artifacts(id),
  updated_at TEXT NOT NULL
);

-- events: append-only provenance log
CREATE TABLE events (
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

CREATE INDEX idx_events_ts ON events(ts DESC);
CREATE INDEX idx_events_muni ON events(muni_id);
CREATE INDEX idx_events_kind ON events(kind);
CREATE INDEX idx_events_run ON events(run_id);
