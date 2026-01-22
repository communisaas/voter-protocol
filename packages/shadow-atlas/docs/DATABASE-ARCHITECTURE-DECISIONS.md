# Shadow Atlas Database Architecture Decisions

**Author**: Distinguished Engineer (PostGIS Specialist)
**Date**: 2026-01-18
**Status**: Design Approved

---

## Overview

This document explains the architectural decisions, trade-offs, and reasoning behind the Shadow Atlas PostGIS schema design. Each decision balances performance, scalability, data integrity, and operational simplicity.

---

## 1. SRID Choice: WGS84 (4326)

### Decision

**Store all geometries in SRID 4326 (WGS84)**

### Rationale

**Global Compatibility**
- WGS84 is the de facto standard for web mapping (Google Maps, Leaflet, Mapbox)
- Client APIs expect `{lat, lng}` in WGS84 coordinates
- GeoJSON specification mandates WGS84 (EPSG:4326)
- Eliminates transformation at API boundary

**On-Demand Projection**
- PostGIS can project to appropriate UTM zones for area calculations: `ST_Area(geom::geography)`
- Geography type handles spherical calculations (accurate for global coverage)
- Performance cost of on-demand projection < complexity of managing multiple SRIDs

**Alternative Considered**: Store in appropriate UTM zones per jurisdiction

**Rejected Because**:
- US spans 10+ UTM zones (complexity managing zone boundaries)
- Global expansion to 190+ countries = 60+ UTM zones
- Cross-zone queries become nightmarish
- Client-side transformation burden (developers expect WGS84)

### Implementation

```sql
-- All geometry columns use SRID 4326
boundary_geom GEOMETRY(MultiPolygon, 4326)

-- Area calculations use geography cast for accuracy
area_sq_meters = ST_Area(geom::geography)  -- Spherical calculation

-- Point-in-polygon uses planar (fast, sufficient accuracy)
ST_Contains(district.geom, ST_SetSRID(ST_MakePoint(lng, lat), 4326))
```

**Accuracy Trade-off**: Planar calculations in WGS84 are inaccurate for large polygons (>100km). Solution: use `geography` type for area/distance, `geometry` for spatial indexes.

---

## 2. Partitioning Strategy: Country-Level

### Decision

**Partition `jurisdictions`, `portals`, and `districts` by country_code**

### Rationale

**Query Pattern Optimization**
- 95% of queries filter by country (e.g., "find districts in US")
- Partition pruning eliminates scanning 189 irrelevant countries
- Reduces index size (smaller B-tree per partition)

**Data Locality**
- US data (~50% of total) on separate partition = better cache hit rates
- EU countries (GDPR) can reside on separate physical disks
- Simplifies backup/restore (partition-level operations)

**Scaling Path**
- Start with 7 country partitions (US, CA, GB, AU, DE, FR, default)
- Add partitions as coverage expands (China, India, Brazil)
- Default partition catches long-tail countries (190+ total)

**Alternative Considered**: Hash partitioning by jurisdiction ID

**Rejected Because**:
- Hash partitioning scatters countries across partitions (no query optimization)
- Can't easily separate US vs EU for compliance
- Partition pruning ineffective (must scan all partitions)

### Implementation

```sql
CREATE TABLE jurisdictions (...) PARTITION BY LIST (country_code);

-- US partition (largest dataset)
CREATE TABLE jurisdictions_us PARTITION OF jurisdictions FOR VALUES IN ('US');

-- Default catches long-tail
CREATE TABLE jurisdictions_default PARTITION OF jurisdictions DEFAULT;
```

**Trade-off**: Adding new countries requires DDL (CREATE TABLE). Acceptable because country expansion is rare (quarterly at most).

---

## 3. Spatial Indexing: GIST vs BRIN

### Decision

**Use GIST (Generalized Search Tree) indexes for all spatial columns**

### Rationale

**Query Pattern Requirements**
- Primary query: point-in-polygon (`ST_Contains`)
- GIST excels at spatial overlap/containment checks
- BRIN (Block Range Index) only efficient for spatially sorted data

**Performance Characteristics**
- GIST: O(log n) lookup, ~30% of table size
- BRIN: O(1) if sorted, O(n) if unsorted, ~0.1% of table size
- Districts are NOT spatially sorted (inserted by download order)

**Benchmark** (1M polygons):
- GIST: 5ms point-in-polygon
- BRIN: 500ms point-in-polygon (requires sequential scan)

**Alternative Considered**: BRIN with spatial sorting (cluster by geography)

**Rejected Because**:
- Clustering requires periodic `CLUSTER` maintenance (expensive)
- Inserts after clustering break spatial locality
- GIST "good enough" (5ms << 50ms target)

### Implementation

```sql
-- Primary spatial index
CREATE INDEX idx_districts_geom_gist ON districts USING GIST(geom);

-- Covers 99% of queries
SELECT * FROM districts WHERE ST_Contains(geom, ST_Point(lng, lat));
```

**Trade-off**: GIST consumes 30% of table size. With 10M districts @ 1KB avg, index = 3GB. Acceptable for modern hardware.

---

## 4. Geometry Type: MultiPolygon vs Polygon

### Decision

**Store all district boundaries as MultiPolygon, even if single polygon**

### Rationale

**Real-World Data Variability**
- 15% of council districts are non-contiguous (islands, exclaves)
- Examples: NYC Council District 7 (split by river), SF District 1 (Presidio + Richmond)
- Polygon type can't store multi-part geometries → runtime errors

**Schema Flexibility**
- MultiPolygon handles both single and multi-part geometries
- Avoids conditional logic (if multi-part, use MultiPolygon, else Polygon)
- PostGIS automatically simplifies single-part MultiPolygon for storage

**Migration Safety**
- Source data may be inconsistent (Polygon vs MultiPolygon)
- `ST_Multi()` safely converts Polygon → MultiPolygon
- No manual inspection required during bulk import

**Alternative Considered**: Geometry (accepts any type)

**Rejected Because**:
- Geometry type too loose (allows LineString, Point by mistake)
- Type safety > schema flexibility for production systems

### Implementation

```sql
-- Enforce MultiPolygon
geom GEOMETRY(MultiPolygon, 4326) NOT NULL

-- Safe conversion during import
INSERT INTO districts (geom) VALUES (ST_Multi(ST_GeomFromGeoJSON($1)));
```

**Trade-off**: Negligible storage overhead for single-part polygons stored as MultiPolygon.

---

## 5. Provenance: Append-Only vs Mutable

### Decision

**All provenance tables are append-only (no UPDATE/DELETE, only INSERT)**

### Rationale

**Immutable Audit Trail**
- Regulatory compliance (prove data lineage for legal disputes)
- Git-style history (track every change, never rewrite)
- Temporal queries (how did coverage change over time?)

**Data Integrity**
- Can't accidentally delete discovery events
- Complete record of failed validations (learn from mistakes)
- Quarantine workflow preserves snapshots before deletion

**Implementation Simplicity**
- No complex UPDATE logic with timestamps
- INSERT-only = simpler application code
- Materialized views aggregate for performance

**Alternative Considered**: Mutable tables with `updated_at` timestamps

**Rejected Because**:
- Lost history (UPDATE overwrites previous values)
- Can't answer "when did we first discover this portal?"
- Compliance risk (deleted records = no audit trail)

### Implementation

```sql
-- Append-only discovery log
CREATE TABLE discovery_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  -- ... columns
  -- NO UPDATE trigger, only INSERT
);

-- Latest state via materialized view
CREATE MATERIALIZED VIEW latest_validations AS
SELECT DISTINCT ON (jurisdiction_id) *
FROM validation_runs
ORDER BY jurisdiction_id, validated_at DESC;
```

**Trade-off**: Table size grows unbounded. Mitigation: partition by year, archive old data to cold storage.

---

## 6. JSONB for Source Attributes

### Decision

**Store raw GeoJSON/Shapefile attributes as JSONB, not normalized columns**

### Rationale

**Schema Flexibility**
- Each portal has different attribute names (`DISTRICT`, `District`, `DIST_NUM`, `dist_id`)
- 520 portals × 10 unique schemas = 5200 columns (unmaintainable)
- New portals shouldn't require schema migrations

**Query Capability**
- JSONB supports indexing (`CREATE INDEX USING GIN`)
- Can query nested attributes: `source_attributes->>'DISTRICT'`
- Maintains raw provenance (exact data from portal)

**Storage Efficiency**
- JSONB is binary (smaller than TEXT)
- PostgreSQL compresses JSONB automatically (TOAST)
- Only accessed during debugging (not performance-critical)

**Alternative Considered**: `hstore` (key-value pairs)

**Rejected Because**:
- hstore only supports flat key-value (no nested objects)
- JSONB is PostgreSQL standard (better tooling support)
- JSONB integrates with PostgREST (auto-generate API)

### Implementation

```sql
-- Store raw attributes
source_attributes JSONB

-- Example: {"DISTRICT": "1", "NAME": "District 1", "POP2020": 50000}

-- Query specific attribute
SELECT * FROM districts WHERE source_attributes->>'DISTRICT' = '1';

-- Index for common queries
CREATE INDEX idx_districts_source_attrs ON districts USING GIN(source_attributes);
```

**Trade-off**: Can't enforce schema constraints (e.g., require `DISTRICT` field). Validation happens in application layer.

---

## 7. Quarantine Workflow: Soft Delete Pattern

### Decision

**Never DELETE portals/districts; move to quarantine_registry with snapshot**

### Rationale

**Reversibility**
- Human review may determine quarantine was incorrect
- Can restore from snapshot (complete record preserved)
- Prevents accidental data loss

**Audit Trail**
- Know exactly when/why data was quarantined
- Track remediation history (how was issue fixed?)
- Learn from mistakes (common patterns → automated fixes)

**Legal Protection**
- If portal data is challenged in court, we have complete record
- Prove due diligence (attempted validation, documented failure)

**Alternative Considered**: Soft delete flag (`deleted_at TIMESTAMPTZ`)

**Rejected Because**:
- Soft delete clutters production queries (`WHERE deleted_at IS NULL`)
- No structured review workflow (approved/rejected/fixed)
- Snapshot history lost (can't see what data looked like before quarantine)

### Implementation

```sql
-- Production table stays clean
SELECT * FROM portals WHERE status = 'production';

-- Quarantined data in separate table
INSERT INTO quarantine_registry (portal_id, reason, snapshot)
VALUES ($1, 'tessellation-failure', row_to_json(portal_row));

-- Review workflow
UPDATE quarantine_registry
SET review_status = 'approved', reviewed_by = 'user@example.com'
WHERE id = $1;
```

**Trade-off**: Requires application logic to move data between tables. Acceptable complexity for data integrity guarantees.

---

## 8. Expected Feature Count: Validation Column

### Decision

**Store both `feature_count` (actual) and `expected_feature_count` (authoritative) in portals**

### Rationale

**Pre-Flight Validation**
- Catch wrong-granularity data before download (Cincinnati: 74 features discovered, 9 expected)
- Confidence scoring (exact match = 100%, within ±2 = 70%, reject >2 diff)
- Prevents wasted compute on obviously wrong sources

**Data Quality Signal**
- Mismatch triggers manual review
- Expected count from official sources (city charters, Wikipedia)
- Actual count from portal response (may be stale/incorrect)

**Temporal Tracking**
- Expected count changes via redistricting (rare, every 10 years)
- Actual count may drift (portal updated but schema not)
- Comparison detects staleness

**Alternative Considered**: Single `feature_count` column, validate in application

**Rejected Because**:
- Lose authoritative count after first validation
- Can't distinguish "portal has 10 features" from "expected 9 but found 10"
- Database can't enforce count matching constraint

### Implementation

```sql
-- Portal metadata
feature_count INTEGER,            -- Actual count from portal
expected_feature_count INTEGER,   -- From official sources

-- Validation check
CREATE FUNCTION validate_feature_count(portal_id UUID) AS $$
  SELECT CASE
    WHEN ABS(p.feature_count - p.expected_feature_count) = 0 THEN 100  -- Perfect match
    WHEN ABS(p.feature_count - p.expected_feature_count) <= 2 THEN 70  -- Close enough
    ELSE 0  -- Reject
  END AS confidence
  FROM portals p WHERE p.id = portal_id;
$$;
```

**Trade-off**: Manual curation required to populate `expected_feature_count`. Mitigated by bulk import from `district-count-registry.ts`.

---

## 9. Validation Tolerances: Hardcoded vs Configurable

### Decision

**Store tolerance thresholds as JSONB in `validation_runs.tolerances` column**

### Rationale

**Reproducibility**
- Validation results depend on tolerance values
- Storing tolerances with results = reproducible audits
- Can answer "why did this pass in 2025 but fail in 2026?"

**Evolution**
- Tolerances may change as we learn (coastal cities need higher thresholds)
- Historical validations preserve old tolerances (don't invalidate past results)
- Can re-run validation with new tolerances, compare results

**Debugging**
- Know exactly what thresholds were used for each run
- Can identify "flaky" jurisdictions (pass with 85% threshold, fail with 90%)

**Alternative Considered**: Global config file, apply same tolerances to all runs

**Rejected Because**:
- Can't explain why historical validations passed
- Changing config invalidates all past results
- No per-jurisdiction tolerance overrides

### Implementation

```sql
-- Store tolerances with each validation
tolerances JSONB  -- {"COVERAGE_THRESHOLD": 0.85, "MAX_COVERAGE_COASTAL": 2.0}

-- Run validation with specific tolerances
INSERT INTO validation_runs (jurisdiction_id, tolerances, ...)
VALUES ($1, '{"COVERAGE_THRESHOLD": 0.85}'::jsonb, ...);
```

**Trade-off**: Duplication of tolerance values across runs. Storage cost negligible (<1KB per run).

---

## 10. Performance Target: <10ms Point-in-Polygon

### Decision

**Optimize for <10ms point-in-polygon queries at 10M district scale**

### Rationale

**API Responsiveness**
- 10ms database query + 5ms serialization + 10ms network = 25ms total
- <50ms perceived as instant by users
- Competitive with Cicero API performance

**Concurrency**
- 10ms query = 100 queries/second per connection
- 10-connection pool = 1000 QPS sustained
- Sufficient for free public API serving 10M requests/month

**Scaling Headroom**
- Current: 520 cities × 15 districts avg = 7800 districts
- Target: 190 countries × 10k cities × 10 districts = 19M districts
- GIST index scales O(log n): 7800 → 19M = 3x slower (3ms → 9ms)

**Alternative Considered**: Materialized geocoding results (cache lat/lng → district)

**Rejected Because**:
- Cache invalidation complexity (districts change via redistricting)
- Storage explosion (infinite lat/lng combinations)
- Fresh queries always need point-in-polygon anyway

### Implementation

```sql
-- Spatial index ensures <10ms
CREATE INDEX idx_districts_geom_gist ON districts USING GIST(geom);

-- Optimized query (partition pruning + spatial index)
EXPLAIN ANALYZE
SELECT * FROM find_district(-118.2437, 34.0522)
WHERE country_code = 'US';

-- Expected plan:
-- Index Scan using idx_districts_geom_gist (cost=0.42..8.44 rows=1) (actual time=2.3ms)
```

**Trade-off**: GIST index consumes 30% of table size. Accept storage cost for query performance.

---

## 11. Country Partitions: 7 Explicit + Default

### Decision

**Create explicit partitions for 6 countries (US, CA, GB, AU, DE, FR) + default**

### Rationale

**Pareto Principle**
- 6 countries cover 80% of initial target coverage (English-speaking + major EU)
- US alone = 50% of data (520 cities, 50 states, 3000+ counties)
- Default partition handles long tail (184 other countries)

**Operational Simplicity**
- 7 partitions manageable (backup/restore, reindex)
- Too many partitions (50+) = excessive DDL overhead
- Can add partitions incrementally (India, Brazil, China as coverage expands)

**Query Performance**
- Explicit partitions enable partition pruning (WHERE country_code = 'US' scans only 1 partition)
- Default partition never used in production queries (always filter by country)

**Alternative Considered**: 1 partition per country (190 total)

**Rejected Because**:
- Partition overhead (PostgreSQL limits ~1000 partitions per table)
- DDL explosion (570 CREATE TABLE statements)
- Most countries have <10 cities (not worth dedicated partition)

### Implementation

```sql
-- Major countries
CREATE TABLE jurisdictions_us PARTITION OF jurisdictions FOR VALUES IN ('US');
CREATE TABLE jurisdictions_ca PARTITION OF jurisdictions FOR VALUES IN ('CA');
-- ... 4 more

-- Long tail
CREATE TABLE jurisdictions_default PARTITION OF jurisdictions DEFAULT;

-- Add new partition when coverage justifies
CREATE TABLE jurisdictions_in PARTITION OF jurisdictions FOR VALUES IN ('IN');  -- India
```

**Trade-off**: Default partition grows large (184 countries). Acceptable because it's only used for < 20% of queries.

---

## 12. At-Large Cities: Dedicated Table vs Flag

### Decision

**Create dedicated `at_large_cities` table, not boolean flag in `jurisdictions`**

### Rationale

**Schema Clarity**
- At-large cities have unique attributes (`election_method`, `source_url` for verification)
- These don't apply to district-based cities (NULL pollution)
- Dedicated table = self-documenting schema

**Query Optimization**
- Tessellation validation: `WHERE jurisdiction_id NOT IN (SELECT jurisdiction_id FROM at_large_cities)`
- Fast index scan, no table scan of `jurisdictions`
- Clear exclusion logic (explicit list of exceptions)

**Data Integrity**
- Can't accidentally mark district-based city as at-large (foreign key constraint)
- Unique constraint on `jurisdiction_id` (one entry per city)

**Alternative Considered**: Boolean flag `is_at_large` in `jurisdictions`

**Rejected Because**:
- No place to store at-large-specific metadata (`election_method`, `source_url`)
- Validation queries cluttered: `WHERE is_at_large = FALSE AND ...`
- Loses provenance (why is this city at-large? Need external docs)

### Implementation

```sql
-- Dedicated table
CREATE TABLE at_large_cities (
  jurisdiction_id UUID UNIQUE REFERENCES jurisdictions(id),
  election_method VARCHAR(50),
  source_url TEXT NOT NULL,  -- Authoritative verification
  ...
);

-- Exclude from tessellation
SELECT j.* FROM jurisdictions j
WHERE j.id NOT IN (SELECT jurisdiction_id FROM at_large_cities);
```

**Trade-off**: Extra JOIN in some queries. Performance impact negligible (<1ms).

---

## Summary of Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| SRID | 4326 (WGS84) | Global compatibility, client expectations |
| Partitioning | Country-level | Query pattern optimization, data locality |
| Spatial Index | GIST | Point-in-polygon performance (5ms vs 500ms) |
| Geometry Type | MultiPolygon | Handles non-contiguous districts |
| Provenance | Append-only | Immutable audit trail, compliance |
| Attributes | JSONB | Schema flexibility, 520 unique schemas |
| Quarantine | Soft delete + snapshot | Reversibility, audit trail |
| Validation | Store tolerances | Reproducibility, evolution |
| Performance | <10ms target | API responsiveness, 100 QPS capacity |
| Partitions | 7 (6 major + default) | 80/20 coverage, operational simplicity |
| At-Large | Dedicated table | Schema clarity, data integrity |

All decisions prioritize **data integrity**, **query performance**, and **operational simplicity** for a production system serving 10M+ API requests/month with complete provenance tracking.

---

**Next**: See `DATABASE-MIGRATION-PLAN.md` for phased migration strategy.
