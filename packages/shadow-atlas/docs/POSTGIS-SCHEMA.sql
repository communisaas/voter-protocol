-- ============================================================================
-- Shadow Atlas PostGIS Schema
-- ============================================================================
--
-- PURPOSE: Production-grade political district boundary database
-- - 520 US cities + global expansion to 190+ countries
-- - Compete with Cicero API ($5-10k/month) with free public API
-- - Complete provenance tracking from discovery → validation → production
--
-- ARCHITECTURE PRINCIPLES:
-- 1. Spatial-first: PostGIS geometry columns with GIST indexes
-- 2. Immutable provenance: Append-only audit logs, never delete
-- 3. Quarantine workflow: Failed validations go to quarantine, not production
-- 4. Global scale: Partition by country for 190+ country coverage
-- 5. Hierarchical jurisdictions: Cities → Counties → States → Countries
--
-- SRID STANDARD: 4326 (WGS84) for global compatibility
-- - Client APIs expect lat/lng in WGS84
-- - PostGIS can project on-demand for area calculations (use ST_Area(geography))
-- - Storage in 4326, compute in appropriate UTM zone when needed
--
-- MIGRATION PATH FROM TYPESCRIPT:
-- - Current: 520 portal objects in known-portals.ts
-- - Phase 1: Bulk import known-portals.ts → portals table
-- - Phase 2: Download geometries, populate districts table
-- - Phase 3: Run tessellation validation, populate validation_runs
-- - Phase 4: Serve free public API (PostgREST or custom API)
--
-- PERFORMANCE TARGETS:
-- - Point-in-polygon query: <50ms (with spatial index)
-- - Portal lookup by FIPS: <5ms (with btree index)
-- - Global discovery scan: <500ms (with partitioning)
-- - Validation run: <2s per city (parallel processing)
-- ============================================================================

-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- Enable UUIDs for globally unique identifiers
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- ENUMS: Type-safe constants for status tracking
-- ============================================================================

-- Portal types (matches TypeScript PortalType)
CREATE TYPE portal_type AS ENUM (
    'arcgis',
    'arcgis-hub',
    'arcgis-online',
    'municipal-gis',
    'regional-gis',
    'state-gis',
    'socrata',
    'ckan',
    'geojson',
    'shapefile',
    'kml',
    'webmap-embedded',
    'curated-data',
    'census-tiger',
    'custom-api'
);

-- Administrative hierarchy levels (global)
CREATE TYPE admin_level AS ENUM (
    'country',
    'state',
    'province',
    'region',
    'department',
    'prefecture',
    'canton',
    'county',
    'district',
    'arrondissement',
    'city',
    'municipality',
    'commune',
    'ward',
    'council-district',
    'congressional',
    'state-legislative-upper',
    'state-legislative-lower',
    'county-commission',
    'school-district'
);

-- Discovery status
CREATE TYPE discovery_status AS ENUM (
    'pending',
    'found',
    'not-found',
    'error',
    'manual-review',
    'quarantined',
    'production'
);

-- Governance structures
CREATE TYPE governance_structure AS ENUM (
    'district-based',
    'at-large',
    'mixed',
    'proportional',
    'unknown'
);

-- Validation result status
CREATE TYPE validation_status AS ENUM (
    'passed',
    'failed',
    'skipped',
    'pending'
);

-- Tessellation axiom failures
CREATE TYPE tessellation_axiom AS ENUM (
    'exclusivity',
    'exhaustivity',
    'containment',
    'cardinality'
);

-- Quarantine reasons
CREATE TYPE quarantine_reason AS ENUM (
    'single-feature',
    'wrong-granularity',
    'tessellation-failure',
    'stale-data',
    'duplicate-source',
    'manual-review',
    'low-confidence',
    'missing-attributes'
);

-- ============================================================================
-- CORE TABLES: Jurisdictions & Portals
-- ============================================================================

-- ----------------------------------------------------------------------------
-- jurisdictions: Hierarchical administrative units (global)
-- ----------------------------------------------------------------------------
-- DESIGN: Recursive hierarchy supporting 190+ countries
-- - Self-referencing parent_id for arbitrary depth
-- - Spatial index on boundary_geom for containment checks
-- - Partitioned by country for global scale
-- ----------------------------------------------------------------------------
CREATE TABLE jurisdictions (
    -- Identity
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Geographic codes (nullable for flexibility across countries)
    fips_code VARCHAR(10),           -- US Census FIPS (7-digit for cities, 5-digit for counties)
    iso_code VARCHAR(20),            -- ISO 3166-2 subdivision code (e.g., "US-CA", "GB-LND")
    nuts_code VARCHAR(10),           -- NUTS code for EU countries
    custom_code VARCHAR(50),         -- Country-specific identifier

    -- Hierarchy
    parent_id UUID REFERENCES jurisdictions(id), -- NULL for country-level
    country_code CHAR(2) NOT NULL,   -- ISO 3166-1 alpha-2 (e.g., "US", "GB", "CA")
    admin_level admin_level NOT NULL,

    -- Metadata
    name VARCHAR(255) NOT NULL,
    name_local VARCHAR(255),         -- Local language name
    population INTEGER,
    area_sq_km NUMERIC(12, 2),

    -- Governance
    governance_structure governance_structure DEFAULT 'unknown',
    council_size INTEGER,            -- Total council seats
    district_seats INTEGER,          -- District-based seats (for mixed systems)
    at_large_seats INTEGER,          -- At-large seats

    -- Geometry (WGS84)
    boundary_geom GEOMETRY(MultiPolygon, 4326), -- Municipal/jurisdiction boundary
    centroid_geom GEOMETRY(Point, 4326),

    -- Provenance
    boundary_source VARCHAR(500),    -- URL to authoritative boundary source
    boundary_vintage DATE,           -- When boundaries were last updated
    verified_date DATE,              -- Last manual verification
    verified_by VARCHAR(100),

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    UNIQUE(fips_code),
    UNIQUE(iso_code),
    CHECK (country_code = UPPER(country_code)),
    CHECK (population IS NULL OR population >= 0),
    CHECK (council_size IS NULL OR council_size > 0)
) PARTITION BY LIST (country_code);

-- Indexes
CREATE INDEX idx_jurisdictions_parent ON jurisdictions(parent_id);
CREATE INDEX idx_jurisdictions_admin_level ON jurisdictions(admin_level);
CREATE INDEX idx_jurisdictions_fips ON jurisdictions(fips_code) WHERE fips_code IS NOT NULL;
CREATE INDEX idx_jurisdictions_iso ON jurisdictions(iso_code) WHERE iso_code IS NOT NULL;
CREATE INDEX idx_jurisdictions_boundary_gist ON jurisdictions USING GIST(boundary_geom);
CREATE INDEX idx_jurisdictions_centroid_gist ON jurisdictions USING GIST(centroid_geom);
CREATE INDEX idx_jurisdictions_population ON jurisdictions(population) WHERE population IS NOT NULL;

-- Auto-update timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER jurisdictions_updated_at
    BEFORE UPDATE ON jurisdictions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Partitions for major countries (add more as needed)
CREATE TABLE jurisdictions_us PARTITION OF jurisdictions FOR VALUES IN ('US');
CREATE TABLE jurisdictions_ca PARTITION OF jurisdictions FOR VALUES IN ('CA');
CREATE TABLE jurisdictions_gb PARTITION OF jurisdictions FOR VALUES IN ('GB');
CREATE TABLE jurisdictions_au PARTITION OF jurisdictions FOR VALUES IN ('AU');
CREATE TABLE jurisdictions_de PARTITION OF jurisdictions FOR VALUES IN ('DE');
CREATE TABLE jurisdictions_fr PARTITION OF jurisdictions FOR VALUES IN ('FR');
CREATE TABLE jurisdictions_default PARTITION OF jurisdictions DEFAULT;

COMMENT ON TABLE jurisdictions IS 'Hierarchical administrative units supporting 190+ countries';
COMMENT ON COLUMN jurisdictions.boundary_geom IS 'Municipal/jurisdiction boundary in WGS84';
COMMENT ON COLUMN jurisdictions.governance_structure IS 'How council members are elected';
COMMENT ON COLUMN jurisdictions.boundary_vintage IS 'When these boundaries became legally effective';

-- ----------------------------------------------------------------------------
-- portals: GIS data sources for boundary downloads
-- ----------------------------------------------------------------------------
-- DESIGN: Registry of ArcGIS/Socrata/CKAN endpoints
-- - One portal can serve multiple jurisdictions (e.g., state-level GIS)
-- - Many-to-one with jurisdictions (multiple portals may exist per city)
-- - Confidence scoring for automated source selection
-- ----------------------------------------------------------------------------
CREATE TABLE portals (
    -- Identity
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Jurisdiction linkage
    jurisdiction_id UUID REFERENCES jurisdictions(id) ON DELETE CASCADE,
    country_code CHAR(2) NOT NULL,

    -- Portal metadata
    portal_type portal_type NOT NULL,
    download_url TEXT NOT NULL,      -- Direct GeoJSON/shapefile URL
    api_base_url TEXT,               -- Base URL for API portals (ArcGIS, Socrata)
    layer_id VARCHAR(100),           -- Layer identifier (ArcGIS layer ID, Socrata dataset)

    -- For webmap-embedded portals
    webmap_layer_name VARCHAR(255),
    authoritative_source TEXT,       -- Original source URL (for curated data)

    -- Validation
    feature_count INTEGER,           -- Number of features/districts at this portal
    expected_feature_count INTEGER,  -- Expected count (for validation)
    confidence_score INTEGER CHECK (confidence_score BETWEEN 0 AND 100),

    -- Discovery metadata
    discovered_by VARCHAR(50) NOT NULL DEFAULT 'manual', -- 'manual', 'automated', 'authoritative'
    discovery_method VARCHAR(100),   -- 'arcgis-portal-scraper', 'manual-verification', etc.
    discovery_date TIMESTAMPTZ DEFAULT NOW(),

    -- Status tracking
    status discovery_status DEFAULT 'found',
    last_verified TIMESTAMPTZ,
    last_download_attempt TIMESTAMPTZ,
    last_successful_download TIMESTAMPTZ,
    download_error TEXT,

    -- Update monitoring
    portal_modified_date TIMESTAMPTZ, -- Last-Modified header from portal
    rss_feeds TEXT[],                 -- RSS feed URLs for update monitoring
    check_frequency_days INTEGER DEFAULT 90, -- How often to check for updates

    -- Provenance notes
    notes TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    UNIQUE(jurisdiction_id, download_url), -- Prevent duplicate portal entries
    CHECK (feature_count IS NULL OR feature_count > 0),
    CHECK (expected_feature_count IS NULL OR expected_feature_count > 0)
) PARTITION BY LIST (country_code);

-- Indexes
CREATE INDEX idx_portals_jurisdiction ON portals(jurisdiction_id);
CREATE INDEX idx_portals_status ON portals(status);
CREATE INDEX idx_portals_confidence ON portals(confidence_score DESC);
CREATE INDEX idx_portals_last_verified ON portals(last_verified);
CREATE INDEX idx_portals_stale ON portals(last_verified) WHERE last_verified < NOW() - INTERVAL '90 days';
CREATE INDEX idx_portals_download_url_hash ON portals(MD5(download_url)); -- Fast duplicate detection

CREATE TRIGGER portals_updated_at
    BEFORE UPDATE ON portals
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Partitions
CREATE TABLE portals_us PARTITION OF portals FOR VALUES IN ('US');
CREATE TABLE portals_ca PARTITION OF portals FOR VALUES IN ('CA');
CREATE TABLE portals_gb PARTITION OF portals FOR VALUES IN ('GB');
CREATE TABLE portals_au PARTITION OF portals FOR VALUES IN ('AU');
CREATE TABLE portals_de PARTITION OF portals FOR VALUES IN ('DE');
CREATE TABLE portals_fr PARTITION OF portals FOR VALUES IN ('FR');
CREATE TABLE portals_default PARTITION OF portals DEFAULT;

COMMENT ON TABLE portals IS 'GIS data sources for downloading district boundaries';
COMMENT ON COLUMN portals.confidence_score IS 'Validation confidence: 0-100, higher = more authoritative';
COMMENT ON COLUMN portals.feature_count IS 'Actual feature count from portal';
COMMENT ON COLUMN portals.expected_feature_count IS 'Expected count from official sources (for validation)';

-- ----------------------------------------------------------------------------
-- districts: Actual boundary geometries for council/legislative districts
-- ----------------------------------------------------------------------------
-- DESIGN: One row per district polygon
-- - Primary table for point-in-polygon queries
-- - GIST index on geom for <50ms query performance
-- - Linked to portal for provenance tracking
-- ----------------------------------------------------------------------------
CREATE TABLE districts (
    -- Identity
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Linkage
    jurisdiction_id UUID NOT NULL REFERENCES jurisdictions(id) ON DELETE CASCADE,
    portal_id UUID REFERENCES portals(id) ON DELETE SET NULL, -- NULL if manually curated
    country_code CHAR(2) NOT NULL,

    -- District identification
    district_number VARCHAR(10),     -- District number/identifier (e.g., "1", "A", "Ward 3")
    district_name VARCHAR(255),      -- Human-readable name

    -- Geometry (WGS84)
    geom GEOMETRY(MultiPolygon, 4326) NOT NULL,
    centroid GEOMETRY(Point, 4326),

    -- Geometric properties (cached for performance)
    area_sq_meters NUMERIC(15, 2),   -- Calculated using ST_Area(geom::geography)
    perimeter_meters NUMERIC(12, 2),

    -- Attributes from source data (JSONB for flexibility)
    source_attributes JSONB,         -- Raw attributes from GeoJSON/Shapefile

    -- Validation
    is_valid BOOLEAN DEFAULT TRUE,   -- ST_IsValid(geom)
    validation_errors TEXT[],        -- Geometry validation errors

    -- Provenance
    source_url TEXT,                 -- Direct URL where this geometry was downloaded
    download_date TIMESTAMPTZ,
    data_vintage DATE,               -- When district boundaries became effective

    -- Status
    status discovery_status DEFAULT 'production',

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    UNIQUE(jurisdiction_id, district_number),
    CHECK (area_sq_meters IS NULL OR area_sq_meters > 0)
) PARTITION BY LIST (country_code);

-- Spatial indexes (CRITICAL for performance)
CREATE INDEX idx_districts_geom_gist ON districts USING GIST(geom);
CREATE INDEX idx_districts_centroid_gist ON districts USING GIST(centroid);

-- Non-spatial indexes
CREATE INDEX idx_districts_jurisdiction ON districts(jurisdiction_id);
CREATE INDEX idx_districts_portal ON districts(portal_id);
CREATE INDEX idx_districts_status ON districts(status);
CREATE INDEX idx_districts_source_attrs ON districts USING GIN(source_attributes);

-- Auto-calculate centroid and area on insert/update
CREATE OR REPLACE FUNCTION calculate_district_geometry()
RETURNS TRIGGER AS $$
BEGIN
    -- Calculate centroid
    NEW.centroid = ST_Centroid(NEW.geom);

    -- Calculate area in square meters (using geography cast for accuracy)
    NEW.area_sq_meters = ST_Area(NEW.geom::geography);

    -- Calculate perimeter in meters
    NEW.perimeter_meters = ST_Perimeter(NEW.geom::geography);

    -- Validate geometry
    NEW.is_valid = ST_IsValid(NEW.geom);
    IF NOT NEW.is_valid THEN
        NEW.validation_errors = ARRAY[ST_IsValidReason(NEW.geom)];
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER districts_geometry_calculations
    BEFORE INSERT OR UPDATE OF geom ON districts
    FOR EACH ROW
    EXECUTE FUNCTION calculate_district_geometry();

CREATE TRIGGER districts_updated_at
    BEFORE UPDATE ON districts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Partitions
CREATE TABLE districts_us PARTITION OF districts FOR VALUES IN ('US');
CREATE TABLE districts_ca PARTITION OF districts FOR VALUES IN ('CA');
CREATE TABLE districts_gb PARTITION OF districts FOR VALUES IN ('GB');
CREATE TABLE districts_au PARTITION OF districts FOR VALUES IN ('AU');
CREATE TABLE districts_de PARTITION OF districts FOR VALUES IN ('DE');
CREATE TABLE districts_fr PARTITION OF districts FOR VALUES IN ('FR');
CREATE TABLE districts_default PARTITION OF districts DEFAULT;

COMMENT ON TABLE districts IS 'Actual district boundary geometries for point-in-polygon queries';
COMMENT ON COLUMN districts.geom IS 'District boundary polygon in WGS84 (SRID 4326)';
COMMENT ON COLUMN districts.area_sq_meters IS 'Area in square meters (calculated using geography cast)';
COMMENT ON COLUMN districts.source_attributes IS 'Raw GeoJSON/Shapefile attributes as JSONB';

-- ============================================================================
-- PROVENANCE TABLES: Complete audit trail
-- ============================================================================

-- ----------------------------------------------------------------------------
-- discovery_events: When/how portals were discovered
-- ----------------------------------------------------------------------------
-- DESIGN: Append-only log of all discovery attempts
-- - Includes failed discoveries (not-found, errors)
-- - Enables learning from discovery strategies
-- ----------------------------------------------------------------------------
CREATE TABLE discovery_events (
    -- Identity
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- What was discovered
    jurisdiction_id UUID REFERENCES jurisdictions(id) ON DELETE CASCADE,
    portal_id UUID REFERENCES portals(id) ON DELETE SET NULL, -- NULL if discovery failed

    -- Discovery context
    discovery_strategy VARCHAR(100) NOT NULL, -- 'arcgis-portal-scraper', 'manual-search', etc.
    attempted_by VARCHAR(100),                -- 'automated', 'user:email', 'github:username'

    -- Result
    status discovery_status NOT NULL,
    error_message TEXT,

    -- Candidates (for LLM selection audits)
    candidates JSONB,                -- Array of portal candidates before selection
    selected_candidate JSONB,        -- Which candidate was chosen and why
    selection_method VARCHAR(50),    -- 'deterministic', 'llm', 'human'

    -- Performance metrics
    execution_time_ms INTEGER,
    http_requests_made INTEGER,

    -- Timestamp
    discovered_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    CHECK (execution_time_ms IS NULL OR execution_time_ms >= 0)
);

-- Indexes
CREATE INDEX idx_discovery_events_jurisdiction ON discovery_events(jurisdiction_id);
CREATE INDEX idx_discovery_events_status ON discovery_events(status);
CREATE INDEX idx_discovery_events_strategy ON discovery_events(discovery_strategy);
CREATE INDEX idx_discovery_events_timestamp ON discovery_events(discovered_at DESC);

COMMENT ON TABLE discovery_events IS 'Append-only log of all portal discovery attempts';
COMMENT ON COLUMN discovery_events.candidates IS 'Portal candidates before selection (for auditing LLM choices)';

-- ----------------------------------------------------------------------------
-- validation_runs: Tessellation validation results
-- ----------------------------------------------------------------------------
-- DESIGN: One row per validation run per jurisdiction
-- - Stores complete tessellation proof diagnostics
-- - Enables temporal analysis (coverage improving over time?)
-- ----------------------------------------------------------------------------
CREATE TABLE validation_runs (
    -- Identity
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- What was validated
    jurisdiction_id UUID NOT NULL REFERENCES jurisdictions(id) ON DELETE CASCADE,
    portal_id UUID REFERENCES portals(id) ON DELETE SET NULL,

    -- Validation type
    validation_type VARCHAR(50) DEFAULT 'tessellation', -- 'tessellation', 'attribute', 'geometry'

    -- Result
    status validation_status NOT NULL,
    failed_axiom tessellation_axiom,  -- NULL if passed
    failure_reason TEXT,

    -- Tessellation diagnostics (from TessellationProof interface)
    district_count INTEGER,
    expected_count INTEGER,
    total_overlap_area_sq_m NUMERIC(15, 2),
    uncovered_area_sq_m NUMERIC(15, 2),
    outside_boundary_area_sq_m NUMERIC(15, 2),
    municipal_area_sq_m NUMERIC(15, 2),
    district_union_area_sq_m NUMERIC(15, 2),
    coverage_ratio NUMERIC(5, 4), -- 0.0000 to 9.9999

    -- Problematic districts (for debugging)
    problematic_districts TEXT[], -- Array of district_ids

    -- Execution context
    validator_version VARCHAR(20),
    tolerances JSONB,             -- Geometry tolerances used (GEOMETRY_TOLERANCE config)

    -- Performance
    validation_time_ms INTEGER,

    -- Timestamp
    validated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    CHECK (district_count IS NULL OR district_count >= 0),
    CHECK (expected_count IS NULL OR expected_count >= 0),
    CHECK (coverage_ratio IS NULL OR coverage_ratio >= 0)
);

-- Indexes
CREATE INDEX idx_validation_runs_jurisdiction ON validation_runs(jurisdiction_id);
CREATE INDEX idx_validation_runs_status ON validation_runs(status);
CREATE INDEX idx_validation_runs_failed_axiom ON validation_runs(failed_axiom) WHERE failed_axiom IS NOT NULL;
CREATE INDEX idx_validation_runs_timestamp ON validation_runs(validated_at DESC);

-- View: Latest validation per jurisdiction
CREATE VIEW latest_validations AS
SELECT DISTINCT ON (jurisdiction_id)
    *
FROM validation_runs
ORDER BY jurisdiction_id, validated_at DESC;

COMMENT ON TABLE validation_runs IS 'Tessellation validation results with complete diagnostic data';
COMMENT ON COLUMN validation_runs.coverage_ratio IS 'district_union_area / municipal_area (0.85-1.15 is passing)';
COMMENT ON VIEW latest_validations IS 'Most recent validation result per jurisdiction';

-- ----------------------------------------------------------------------------
-- quarantine_registry: Failed validations pending review
-- ----------------------------------------------------------------------------
-- DESIGN: Quarantine workflow for data quality issues
-- - Portals/districts moved here instead of deleted
-- - Human review can restore or permanently reject
-- - Complete audit trail of why data was quarantined
-- ----------------------------------------------------------------------------
CREATE TABLE quarantine_registry (
    -- Identity
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- What was quarantined (one of these will be set)
    portal_id UUID REFERENCES portals(id) ON DELETE CASCADE,
    district_id UUID REFERENCES districts(id) ON DELETE CASCADE,
    jurisdiction_id UUID REFERENCES jurisdictions(id) ON DELETE CASCADE,

    -- Quarantine metadata
    reason quarantine_reason NOT NULL,
    detailed_reason TEXT,

    -- Validation failure that triggered quarantine
    validation_run_id UUID REFERENCES validation_runs(id),

    -- Snapshot of quarantined data (for restoration)
    snapshot JSONB NOT NULL,          -- Complete portal/district record

    -- Review workflow
    review_status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'fixed'
    reviewed_by VARCHAR(100),
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,

    -- Restoration tracking
    restored BOOLEAN DEFAULT FALSE,
    restored_at TIMESTAMPTZ,

    -- Timestamps
    quarantined_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    CHECK (
        (portal_id IS NOT NULL AND district_id IS NULL AND jurisdiction_id IS NULL) OR
        (portal_id IS NULL AND district_id IS NOT NULL AND jurisdiction_id IS NULL) OR
        (portal_id IS NULL AND district_id IS NULL AND jurisdiction_id IS NOT NULL)
    ),
    CHECK (review_status IN ('pending', 'approved', 'rejected', 'fixed'))
);

-- Indexes
CREATE INDEX idx_quarantine_portal ON quarantine_registry(portal_id);
CREATE INDEX idx_quarantine_district ON quarantine_registry(district_id);
CREATE INDEX idx_quarantine_jurisdiction ON quarantine_registry(jurisdiction_id);
CREATE INDEX idx_quarantine_reason ON quarantine_registry(reason);
CREATE INDEX idx_quarantine_review_status ON quarantine_registry(review_status);
CREATE INDEX idx_quarantine_timestamp ON quarantine_registry(quarantined_at DESC);

COMMENT ON TABLE quarantine_registry IS 'Quarantined portals/districts pending human review';
COMMENT ON COLUMN quarantine_registry.snapshot IS 'Complete record snapshot for potential restoration';

-- ----------------------------------------------------------------------------
-- remediation_history: Track fixes applied to data quality issues
-- ----------------------------------------------------------------------------
-- DESIGN: Documents all manual interventions
-- - Links to quarantine entries that were fixed
-- - Enables learning (common patterns → automated fixes)
-- ----------------------------------------------------------------------------
CREATE TABLE remediation_history (
    -- Identity
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- What was remediated
    quarantine_id UUID REFERENCES quarantine_registry(id),
    jurisdiction_id UUID NOT NULL REFERENCES jurisdictions(id) ON DELETE CASCADE,

    -- Remediation details
    issue_type quarantine_reason NOT NULL,
    issue_description TEXT NOT NULL,
    fix_applied TEXT NOT NULL,         -- Description of fix
    fix_method VARCHAR(50) NOT NULL,   -- 'manual-edit', 'script', 'new-source', 'configuration'

    -- Script tracking (for automated fixes)
    script_name VARCHAR(255),          -- e.g., 'remediate-ca-containment-failures.ts'
    script_git_commit CHAR(40),        -- Git SHA of script used

    -- Before/after snapshots
    before_snapshot JSONB,
    after_snapshot JSONB,

    -- Workflow
    applied_by VARCHAR(100) NOT NULL,  -- 'user:email', 'script:name'
    verified_by VARCHAR(100),          -- Human who verified fix

    -- Timestamps
    applied_at TIMESTAMPTZ DEFAULT NOW(),
    verified_at TIMESTAMPTZ,

    -- Constraints
    CHECK (fix_method IN ('manual-edit', 'script', 'new-source', 'configuration', 'other'))
);

-- Indexes
CREATE INDEX idx_remediation_quarantine ON remediation_history(quarantine_id);
CREATE INDEX idx_remediation_jurisdiction ON remediation_history(jurisdiction_id);
CREATE INDEX idx_remediation_issue_type ON remediation_history(issue_type);
CREATE INDEX idx_remediation_script ON remediation_history(script_name);
CREATE INDEX idx_remediation_timestamp ON remediation_history(applied_at DESC);

COMMENT ON TABLE remediation_history IS 'Complete audit trail of all data quality fixes';
COMMENT ON COLUMN remediation_history.script_git_commit IS 'Git SHA for reproducible automated fixes';

-- ============================================================================
-- AT-LARGE CITIES: Special handling
-- ============================================================================

-- ----------------------------------------------------------------------------
-- at_large_cities: Cities with no geographic districts
-- ----------------------------------------------------------------------------
-- DESIGN: Prevent tessellation validation on cities without districts
-- - at-large cities have citywide elections (no geographic boundaries)
-- - Attempting tessellation would fail 100% (no districts to tessellate)
-- ----------------------------------------------------------------------------
CREATE TABLE at_large_cities (
    -- Identity
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    jurisdiction_id UUID NOT NULL UNIQUE REFERENCES jurisdictions(id) ON DELETE CASCADE,

    -- Election method
    election_method VARCHAR(50) DEFAULT 'at-large', -- 'at-large', 'proportional', 'ranked-choice'

    -- Seats
    total_seats INTEGER NOT NULL,

    -- Authoritative source
    source_url TEXT NOT NULL,         -- Link to city charter or official documentation
    verified_date DATE NOT NULL,

    -- Notes
    notes TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    CHECK (total_seats > 0)
);

CREATE INDEX idx_at_large_jurisdiction ON at_large_cities(jurisdiction_id);

CREATE TRIGGER at_large_cities_updated_at
    BEFORE UPDATE ON at_large_cities
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE at_large_cities IS 'Cities with at-large elections (no geographic districts)';
COMMENT ON COLUMN at_large_cities.election_method IS 'How council members are elected citywide';

-- ============================================================================
-- MATERIALIZED VIEWS: Performance optimization
-- ============================================================================

-- ----------------------------------------------------------------------------
-- mv_stale_portals: Portals needing re-validation
-- ----------------------------------------------------------------------------
-- DESIGN: Pre-computed list of portals to check for updates
-- - Refresh daily via cron job
-- - Drives automated update monitoring
-- ----------------------------------------------------------------------------
CREATE MATERIALIZED VIEW mv_stale_portals AS
SELECT
    p.id,
    p.jurisdiction_id,
    j.name AS jurisdiction_name,
    j.country_code,
    p.portal_type,
    p.download_url,
    p.last_verified,
    CURRENT_DATE - p.last_verified::date AS days_since_verified,
    p.check_frequency_days,
    p.confidence_score
FROM portals p
JOIN jurisdictions j ON p.jurisdiction_id = j.id
WHERE
    p.status = 'production'
    AND (
        p.last_verified IS NULL OR
        p.last_verified < NOW() - (p.check_frequency_days || ' days')::INTERVAL
    )
ORDER BY days_since_verified DESC NULLS FIRST;

CREATE UNIQUE INDEX ON mv_stale_portals(id);

COMMENT ON MATERIALIZED VIEW mv_stale_portals IS 'Portals needing re-validation (refresh daily)';

-- Refresh schedule (run via cron or pg_cron extension)
-- SELECT cron.schedule('refresh-stale-portals', '0 2 * * *', 'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_stale_portals');

-- ----------------------------------------------------------------------------
-- mv_coverage_stats: Global coverage statistics
-- ----------------------------------------------------------------------------
-- DESIGN: Dashboard metrics for API status page
-- - Shows coverage by country/state/city
-- - Updated after bulk imports
-- ----------------------------------------------------------------------------
CREATE MATERIALIZED VIEW mv_coverage_stats AS
SELECT
    country_code,
    admin_level,
    COUNT(*) AS total_jurisdictions,
    COUNT(DISTINCT CASE WHEN p.id IS NOT NULL THEN j.id END) AS jurisdictions_with_portals,
    COUNT(DISTINCT CASE WHEN d.id IS NOT NULL THEN j.id END) AS jurisdictions_with_districts,
    ROUND(
        100.0 * COUNT(DISTINCT CASE WHEN d.id IS NOT NULL THEN j.id END) / NULLIF(COUNT(*), 0),
        2
    ) AS coverage_percent
FROM jurisdictions j
LEFT JOIN portals p ON j.id = p.jurisdiction_id AND p.status = 'production'
LEFT JOIN districts d ON j.id = d.jurisdiction_id AND d.status = 'production'
GROUP BY country_code, admin_level
ORDER BY country_code, admin_level;

COMMENT ON MATERIALIZED VIEW mv_coverage_stats IS 'Global coverage statistics by country/admin level';

-- ============================================================================
-- HELPER FUNCTIONS: Common queries
-- ============================================================================

-- ----------------------------------------------------------------------------
-- find_district: Point-in-polygon query (PRIMARY API FUNCTION)
-- ----------------------------------------------------------------------------
-- USAGE: SELECT * FROM find_district(-73.935242, 40.730610); -- NYC
-- PERFORMANCE: <50ms with GIST index
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION find_district(
    lng NUMERIC,
    lat NUMERIC,
    jurisdiction_filter UUID DEFAULT NULL
)
RETURNS TABLE (
    district_id UUID,
    district_number VARCHAR,
    district_name VARCHAR,
    jurisdiction_id UUID,
    jurisdiction_name VARCHAR,
    country_code CHAR(2)
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        d.id,
        d.district_number,
        d.district_name,
        d.jurisdiction_id,
        j.name,
        j.country_code
    FROM districts d
    JOIN jurisdictions j ON d.jurisdiction_id = j.id
    WHERE
        d.status = 'production'
        AND ST_Contains(d.geom, ST_SetSRID(ST_MakePoint(lng, lat), 4326))
        AND (jurisdiction_filter IS NULL OR d.jurisdiction_id = jurisdiction_filter)
    LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION find_district IS 'Find district containing a lat/lng point (main API function)';

-- ----------------------------------------------------------------------------
-- check_tessellation: Run tessellation validation for a jurisdiction
-- ----------------------------------------------------------------------------
-- USAGE: SELECT * FROM check_tessellation('uuid-of-jurisdiction');
-- RETURNS: Complete tessellation proof with diagnostics
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_tessellation(
    p_jurisdiction_id UUID
)
RETURNS validation_runs AS $$
DECLARE
    v_result validation_runs%ROWTYPE;
    v_municipal_boundary GEOMETRY;
    v_district_union GEOMETRY;
    v_district_count INTEGER;
    v_expected_count INTEGER;
    v_overlap_area NUMERIC;
    v_coverage_ratio NUMERIC;
BEGIN
    -- Get municipal boundary
    SELECT boundary_geom, council_size
    INTO v_municipal_boundary, v_expected_count
    FROM jurisdictions
    WHERE id = p_jurisdiction_id;

    -- Count districts
    SELECT COUNT(*) INTO v_district_count
    FROM districts
    WHERE jurisdiction_id = p_jurisdiction_id AND status = 'production';

    -- Calculate union of all districts
    SELECT ST_Union(geom) INTO v_district_union
    FROM districts
    WHERE jurisdiction_id = p_jurisdiction_id AND status = 'production';

    -- Calculate diagnostics
    v_overlap_area := ST_Area((ST_Union(geom))::geography) - ST_Area(ST_Union(ST_Buffer(geom, 0))::geography)
    FROM districts WHERE jurisdiction_id = p_jurisdiction_id AND status = 'production';

    v_coverage_ratio := ST_Area(v_district_union::geography) / NULLIF(ST_Area(v_municipal_boundary::geography), 0);

    -- Populate result record
    v_result.id := uuid_generate_v4();
    v_result.jurisdiction_id := p_jurisdiction_id;
    v_result.validation_type := 'tessellation';
    v_result.district_count := v_district_count;
    v_result.expected_count := v_expected_count;
    v_result.coverage_ratio := v_coverage_ratio;
    v_result.validated_at := NOW();

    -- Simple validation logic (real implementation needs full tessellation checks)
    IF v_district_count != v_expected_count THEN
        v_result.status := 'failed';
        v_result.failed_axiom := 'cardinality';
        v_result.failure_reason := format('Expected %s districts, found %s', v_expected_count, v_district_count);
    ELSIF v_coverage_ratio < 0.85 THEN
        v_result.status := 'failed';
        v_result.failed_axiom := 'exhaustivity';
        v_result.failure_reason := format('Coverage ratio %.2f%% below threshold', v_coverage_ratio * 100);
    ELSIF v_coverage_ratio > 1.15 THEN
        v_result.status := 'failed';
        v_result.failed_axiom := 'containment';
        v_result.failure_reason := format('Coverage ratio %.2f%% exceeds boundary', v_coverage_ratio * 100);
    ELSE
        v_result.status := 'passed';
        v_result.failed_axiom := NULL;
        v_result.failure_reason := NULL;
    END IF;

    -- Insert validation result
    INSERT INTO validation_runs VALUES (v_result.*);

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_tessellation IS 'Run tessellation validation for a jurisdiction';

-- ============================================================================
-- MIGRATION HELPER: Import from TypeScript known-portals.ts
-- ============================================================================

-- Expected JSON structure:
-- {
--   "cityFips": "0644000",
--   "cityName": "Los Angeles",
--   "state": "CA",
--   "portalType": "arcgis",
--   "downloadUrl": "https://...",
--   "featureCount": 15,
--   "lastVerified": "2026-01-15T00:00:00.000Z",
--   "confidence": 95,
--   "discoveredBy": "automated",
--   "notes": "Official LACITY GIS portal"
-- }

CREATE OR REPLACE FUNCTION import_known_portal(
    portal_data JSONB
)
RETURNS UUID AS $$
DECLARE
    v_jurisdiction_id UUID;
    v_portal_id UUID;
    v_country_code CHAR(2);
BEGIN
    -- Determine country from FIPS (US-specific in current implementation)
    v_country_code := 'US';

    -- Find or create jurisdiction
    SELECT id INTO v_jurisdiction_id
    FROM jurisdictions
    WHERE fips_code = portal_data->>'cityFips';

    IF v_jurisdiction_id IS NULL THEN
        INSERT INTO jurisdictions (
            fips_code,
            country_code,
            admin_level,
            name,
            governance_structure
        ) VALUES (
            portal_data->>'cityFips',
            v_country_code,
            'city',
            portal_data->>'cityName',
            'district-based'
        )
        RETURNING id INTO v_jurisdiction_id;
    END IF;

    -- Insert portal
    INSERT INTO portals (
        jurisdiction_id,
        country_code,
        portal_type,
        download_url,
        feature_count,
        expected_feature_count,
        confidence_score,
        discovered_by,
        last_verified,
        status,
        notes
    ) VALUES (
        v_jurisdiction_id,
        v_country_code,
        (portal_data->>'portalType')::portal_type,
        portal_data->>'downloadUrl',
        (portal_data->>'featureCount')::INTEGER,
        (portal_data->>'featureCount')::INTEGER, -- Use same value for now
        (portal_data->>'confidence')::INTEGER,
        portal_data->>'discoveredBy',
        (portal_data->>'lastVerified')::TIMESTAMPTZ,
        'production',
        portal_data->>'notes'
    )
    RETURNING id INTO v_portal_id;

    RETURN v_portal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION import_known_portal IS 'Import portal from TypeScript known-portals.ts (pass as JSONB)';

-- Bulk import example:
-- SELECT import_known_portal(jsonb_build_object(
--     'cityFips', '0644000',
--     'cityName', 'Los Angeles',
--     'state', 'CA',
--     'portalType', 'arcgis',
--     'downloadUrl', 'https://...',
--     'featureCount', 15,
--     'lastVerified', '2026-01-15T00:00:00.000Z',
--     'confidence', 95,
--     'discoveredBy', 'automated'
-- ));

-- ============================================================================
-- PERFORMANCE BENCHMARKS
-- ============================================================================

-- Test point-in-polygon performance
-- EXPLAIN ANALYZE SELECT * FROM find_district(-73.935242, 40.730610);
-- Expected: <50ms with GIST index, <5ms cache hit

-- Test portal lookup by FIPS
-- EXPLAIN ANALYZE SELECT * FROM portals p JOIN jurisdictions j ON p.jurisdiction_id = j.id WHERE j.fips_code = '0644000';
-- Expected: <5ms with btree index

-- Test stale portal query
-- EXPLAIN ANALYZE SELECT * FROM mv_stale_portals WHERE country_code = 'US';
-- Expected: <100ms (materialized view)

-- ============================================================================
-- GRANTS: API access (PostgREST)
-- ============================================================================

-- Create read-only API user
-- CREATE ROLE shadow_atlas_api_user LOGIN PASSWORD 'secure_password';
-- GRANT USAGE ON SCHEMA public TO shadow_atlas_api_user;
-- GRANT SELECT ON ALL TABLES IN SCHEMA public TO shadow_atlas_api_user;
-- GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO shadow_atlas_api_user;
-- GRANT EXECUTE ON FUNCTION find_district TO shadow_atlas_api_user;

-- ============================================================================
-- END OF SCHEMA
-- ============================================================================
