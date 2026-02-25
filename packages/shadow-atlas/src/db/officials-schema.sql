-- Officials Tables: Federal + State Legislators
-- Version: 1.0.0
-- Purpose: Pre-ingested representative data, eliminating runtime Congress.gov API dependency.
-- Data sources:
--   Federal: unitedstates/congress-legislators (CC0, GitHub YAML)
--   State: Open States (CC0, nightly CSV) — future phase
--
-- DESIGN: SQLite tables co-located with the existing shadow-atlas municipal boundaries DB.
-- Officials are refreshed via cron ingestion scripts, not runtime API calls.

-- Federal Congress members (541: 435 House + 100 Senate + 6 delegates/commissioners)
CREATE TABLE IF NOT EXISTS federal_members (
  bioguide_id TEXT PRIMARY KEY,          -- e.g., "P000197" (Pelosi)
  name TEXT NOT NULL,                    -- "Nancy Pelosi"
  first_name TEXT NOT NULL,              -- "Nancy"
  last_name TEXT NOT NULL,               -- "Pelosi"
  party TEXT NOT NULL,                   -- "Democrat" | "Republican" | "Independent"
  chamber TEXT NOT NULL CHECK (chamber IN ('house', 'senate')),
  state TEXT NOT NULL,                   -- "CA" (2-letter USPS code)
  district TEXT,                         -- "12" for House, NULL for Senate
  senate_class INTEGER,                  -- 1, 2, or 3 for senators, NULL for House
  phone TEXT,                            -- DC office phone
  office_address TEXT,                   -- DC office address
  contact_form_url TEXT,                 -- URL for web contact form
  website_url TEXT,                      -- Official website
  cwc_code TEXT,                         -- CWC office code: "HCA12" (House) or bioguide-derived (Senate)
  is_voting INTEGER NOT NULL DEFAULT 1,  -- 0 for DC/territory delegates
  delegate_type TEXT,                    -- 'delegate' | 'resident_commissioner' | NULL
  state_fips TEXT,                       -- 2-digit FIPS code: "06" for CA
  cd_geoid TEXT,                         -- 4-digit CD GEOID: "0612" for CA-12
  start_date TEXT,                       -- Term start date
  end_date TEXT,                         -- Term end date
  ingested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_fm_state ON federal_members(state);
CREATE INDEX IF NOT EXISTS idx_fm_chamber ON federal_members(chamber);
CREATE INDEX IF NOT EXISTS idx_fm_state_district ON federal_members(state, district);
CREATE INDEX IF NOT EXISTS idx_fm_state_fips ON federal_members(state_fips);
CREATE INDEX IF NOT EXISTS idx_fm_cd_geoid ON federal_members(cd_geoid);

-- State legislators — future phase (Open States ingestion)
-- Schema placeholder for Phase B2+
CREATE TABLE IF NOT EXISTS state_legislators (
  openstates_id TEXT PRIMARY KEY,        -- Open States person ID
  name TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  party TEXT,
  chamber TEXT NOT NULL CHECK (chamber IN ('upper', 'lower')),
  state TEXT NOT NULL,                   -- "CA"
  district TEXT NOT NULL,                -- District identifier
  phone TEXT,
  email TEXT,
  office_address TEXT,
  photo_url TEXT,
  state_fips TEXT,
  sldu_geoid TEXT,                       -- State Senate GEOID (for upper)
  sldl_geoid TEXT,                       -- State House GEOID (for lower)
  ingested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_sl_state ON state_legislators(state);
CREATE INDEX IF NOT EXISTS idx_sl_state_chamber ON state_legislators(state, chamber);
CREATE INDEX IF NOT EXISTS idx_sl_sldu_geoid ON state_legislators(sldu_geoid);
CREATE INDEX IF NOT EXISTS idx_sl_sldl_geoid ON state_legislators(sldl_geoid);

-- Ingestion metadata: track when data sources were last refreshed
CREATE TABLE IF NOT EXISTS ingestion_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,                  -- 'congress-legislators' | 'openstates'
  status TEXT NOT NULL CHECK (status IN ('success', 'failure')),
  records_upserted INTEGER NOT NULL DEFAULT 0,
  records_deleted INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  error TEXT,
  run_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_ingest_source ON ingestion_log(source);
CREATE INDEX IF NOT EXISTS idx_ingest_run ON ingestion_log(run_at DESC);
