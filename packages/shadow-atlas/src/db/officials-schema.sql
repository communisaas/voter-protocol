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
  congress_session TEXT DEFAULT '119th',  -- Congress session (temporal versioning)
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
CREATE INDEX IF NOT EXISTS idx_fm_congress ON federal_members(congress_session);

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

-- Canadian Members of Parliament (338 MPs, House of Commons)
-- Data source: ourcommons.ca XML feed + Represent API (OGL-CA)
-- Refreshed via cron ingestion script (ingest-canadian-mps.ts)
CREATE TABLE IF NOT EXISTS canada_mps (
  parliament_id TEXT PRIMARY KEY,          -- House of Commons member ID
  name TEXT NOT NULL,                      -- "Justin Trudeau"
  name_fr TEXT,                            -- French name if different
  first_name TEXT NOT NULL,                -- "Justin"
  last_name TEXT NOT NULL,                 -- "Trudeau"
  party TEXT NOT NULL,                     -- "Liberal" | "Conservative" | etc.
  party_fr TEXT,                           -- "Libéral" | "Conservateur" | etc.
  riding_code TEXT NOT NULL,               -- 5-digit FED code: "35075" (Papineau)
  riding_name TEXT NOT NULL,               -- "Papineau"
  riding_name_fr TEXT,                     -- French riding name
  province TEXT NOT NULL,                  -- 2-letter code: "QC", "ON", "BC", etc.
  email TEXT,                              -- Parliamentary email
  phone TEXT,                              -- Ottawa office phone
  office_address TEXT,                     -- Ottawa office address
  constituency_office TEXT,                -- Riding office address
  website_url TEXT,                        -- Official website
  photo_url TEXT,                          -- Official photo URL
  is_active INTEGER NOT NULL DEFAULT 1,    -- 0 for former MPs
  parliament_session TEXT,                 -- e.g., "45th" (temporal versioning)
  ingested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_cmp_province ON canada_mps(province);
CREATE INDEX IF NOT EXISTS idx_cmp_riding ON canada_mps(riding_code);
CREATE INDEX IF NOT EXISTS idx_cmp_party ON canada_mps(party);
CREATE INDEX IF NOT EXISTS idx_cmp_active ON canada_mps(is_active);
CREATE INDEX IF NOT EXISTS idx_cmp_riding_active ON canada_mps(riding_code, is_active);

-- UK Members of Parliament (650 MPs, House of Commons)
-- Data source: UK Parliament Members API (Open Parliament License)
-- Refreshed via cron ingestion script (ingest-uk-mps.ts)
CREATE TABLE IF NOT EXISTS uk_mps (
  parliament_id INTEGER PRIMARY KEY,         -- UK Parliament member ID
  name TEXT NOT NULL,                        -- "Ms Diane Abbott"
  first_name TEXT,                           -- "Diane"
  last_name TEXT,                            -- "Abbott"
  party TEXT NOT NULL,                       -- "Labour" | "Conservative" | etc.
  constituency_name TEXT NOT NULL,           -- "Hackney North and Stoke Newington"
  constituency_ons_code TEXT,                -- ONS code: "E14001234" — matched from boundary data
  email TEXT,                                -- Parliamentary email
  phone TEXT,                                -- Parliamentary office phone
  office_address TEXT,                       -- "House of Commons, London, SW1A 0AA"
  website_url TEXT,                          -- Official website
  photo_url TEXT,                            -- Thumbnail URL
  is_active INTEGER NOT NULL DEFAULT 1,      -- 0 for former MPs
  ingested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_ukmp_party ON uk_mps(party);
CREATE INDEX IF NOT EXISTS idx_ukmp_constituency ON uk_mps(constituency_name);
CREATE INDEX IF NOT EXISTS idx_ukmp_ons ON uk_mps(constituency_ons_code);
CREATE INDEX IF NOT EXISTS idx_ukmp_active ON uk_mps(is_active);

-- Australian Members of Parliament (151 House of Representatives)
-- Data source: APH website (Parliament of Australia)
-- Refreshed via cron ingestion script (ingest-au-mps.ts)
CREATE TABLE IF NOT EXISTS au_mps (
  aph_id TEXT PRIMARY KEY,                   -- APH parliamentarian ID (e.g., "R36")
  name TEXT NOT NULL,                        -- "Anthony Albanese"
  first_name TEXT,                           -- "Anthony"
  last_name TEXT,                            -- "Albanese"
  party TEXT NOT NULL,                       -- "Australian Labor Party" | "Liberal Party" | etc.
  division_name TEXT NOT NULL,               -- "Grayndler"
  division_code TEXT,                        -- Matches au-fed-{CODE} boundary ID
  state TEXT NOT NULL,                       -- "NSW", "VIC", "QLD", etc.
  email TEXT,                                -- Parliamentary email
  phone TEXT,                                -- Electorate office phone
  office_address TEXT,                       -- Electorate office address
  website_url TEXT,                          -- Official website
  photo_url TEXT,                            -- Official photo URL
  is_active INTEGER NOT NULL DEFAULT 1,      -- 0 for former MPs
  ingested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_aump_party ON au_mps(party);
CREATE INDEX IF NOT EXISTS idx_aump_division ON au_mps(division_name);
CREATE INDEX IF NOT EXISTS idx_aump_division_code ON au_mps(division_code);
CREATE INDEX IF NOT EXISTS idx_aump_state ON au_mps(state);
CREATE INDEX IF NOT EXISTS idx_aump_active ON au_mps(is_active);

-- New Zealand Members of Parliament (120+ MPs, House of Representatives)
-- Data source: NZ Parliament website / data.govt.nz
-- Refreshed via cron ingestion script (ingest-nz-mps.ts)
CREATE TABLE IF NOT EXISTS nz_mps (
  parliament_id TEXT PRIMARY KEY,            -- NZ Parliament member ID
  name TEXT NOT NULL,                        -- "Christopher Luxon"
  first_name TEXT,                           -- "Christopher"
  last_name TEXT,                            -- "Luxon"
  party TEXT NOT NULL,                       -- "National" | "Labour" | "Green" | etc.
  electorate_name TEXT,                      -- NULL for list MPs
  electorate_code TEXT,                      -- Matches nz-gen-{CODE} or nz-maori-{CODE}
  electorate_type TEXT,                      -- 'general', 'maori', or 'list'
  email TEXT,                                -- Parliamentary email
  phone TEXT,                                -- Parliamentary office phone
  office_address TEXT,                       -- Office address
  website_url TEXT,                          -- Official website
  photo_url TEXT,                            -- Official photo URL
  is_active INTEGER NOT NULL DEFAULT 1,      -- 0 for former MPs
  ingested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_nzmp_party ON nz_mps(party);
CREATE INDEX IF NOT EXISTS idx_nzmp_electorate ON nz_mps(electorate_name);
CREATE INDEX IF NOT EXISTS idx_nzmp_electorate_code ON nz_mps(electorate_code);
CREATE INDEX IF NOT EXISTS idx_nzmp_type ON nz_mps(electorate_type);
CREATE INDEX IF NOT EXISTS idx_nzmp_active ON nz_mps(is_active);

-- District boundary fences (shared edges between adjacent districts)
-- Built at DB build time by extracting shared boundaries between adjacent district pairs.
-- Used by bubble-query to show which boundaries the bubble crosses.
CREATE TABLE IF NOT EXISTS fences (
  id TEXT PRIMARY KEY,                 -- hash of district_a_id + district_b_id
  layer TEXT NOT NULL,                 -- "cd", "sldu", "sldl", "county", "can-fed"
  district_a_id TEXT NOT NULL,         -- first district (alphabetically by id)
  district_b_id TEXT NOT NULL,         -- second district
  district_a_name TEXT NOT NULL,       -- display name of first district
  district_b_name TEXT NOT NULL,       -- display name of second district
  geometry TEXT NOT NULL,              -- GeoJSON LineString
  landmark TEXT,                       -- reverse-geocoded boundary feature name
  landmark_source TEXT,                -- "road", "river", "railway", etc.
  min_lon REAL NOT NULL,
  max_lon REAL NOT NULL,
  min_lat REAL NOT NULL,
  max_lat REAL NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS fence_rtree USING rtree(
  id, min_lon, max_lon, min_lat, max_lat
);

CREATE INDEX IF NOT EXISTS idx_fence_layer ON fences(layer);

-- Ingestion metadata: track when data sources were last refreshed
CREATE TABLE IF NOT EXISTS ingestion_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,                  -- 'congress-legislators' | 'openstates' | 'canada-mps'
  status TEXT NOT NULL CHECK (status IN ('success', 'failure')),
  records_upserted INTEGER NOT NULL DEFAULT 0,
  records_deleted INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  error TEXT,
  run_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_ingest_source ON ingestion_log(source);
CREATE INDEX IF NOT EXISTS idx_ingest_run ON ingestion_log(run_at DESC);
