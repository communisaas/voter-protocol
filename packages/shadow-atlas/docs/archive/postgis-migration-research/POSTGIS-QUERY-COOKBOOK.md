# PostGIS Query Cookbook

Common queries for shadow-atlas PostgreSQL database.

---

## Point-in-Polygon Queries

### Find District by Coordinates

```sql
-- Using helper function (recommended)
SELECT * FROM find_district(-118.2437, 34.0522);
-- Returns: district_id, district_number, district_name, jurisdiction_name, country_code

-- Raw query (if you need more control)
SELECT
    d.id,
    d.district_number,
    d.district_name,
    j.name AS city_name,
    j.country_code
FROM districts d
JOIN jurisdictions j ON d.jurisdiction_id = j.id
WHERE
    d.status = 'production'
    AND ST_Contains(d.geom, ST_SetSRID(ST_MakePoint(-118.2437, 34.0522), 4326))
    AND j.country_code = 'US'  -- Optional: filter by country for performance
LIMIT 1;
```

### Batch Geocoding (Multiple Points)

```sql
-- Find districts for multiple addresses
WITH points AS (
    SELECT
        'Home' AS label,
        ST_SetSRID(ST_MakePoint(-118.2437, 34.0522), 4326) AS point
    UNION ALL
    SELECT
        'Work',
        ST_SetSRID(ST_MakePoint(-118.2500, 34.0550), 4326)
)
SELECT
    p.label,
    d.district_number,
    d.district_name,
    j.name AS jurisdiction_name
FROM points p
LEFT JOIN districts d ON ST_Contains(d.geom, p.point) AND d.status = 'production'
LEFT JOIN jurisdictions j ON d.jurisdiction_id = j.id;
```

---

## Portal Queries

### Get Portal by City FIPS

```sql
SELECT
    p.id,
    p.portal_type,
    p.download_url,
    p.feature_count,
    p.confidence_score,
    p.last_verified,
    j.name AS city_name,
    j.fips_code
FROM portals p
JOIN jurisdictions j ON p.jurisdiction_id = j.id
WHERE j.fips_code = '0644000'  -- Los Angeles
  AND p.status = 'production';
```

### Find Stale Portals (Need Re-Validation)

```sql
-- Using materialized view (fastest)
SELECT * FROM mv_stale_portals
WHERE country_code = 'US'
ORDER BY days_since_verified DESC
LIMIT 20;

-- Raw query (if you need real-time data)
SELECT
    j.name,
    j.fips_code,
    p.portal_type,
    p.last_verified,
    CURRENT_DATE - p.last_verified::date AS days_stale,
    p.download_url
FROM portals p
JOIN jurisdictions j ON p.jurisdiction_id = j.id
WHERE
    p.status = 'production'
    AND (
        p.last_verified IS NULL OR
        p.last_verified < NOW() - INTERVAL '90 days'
    )
ORDER BY p.last_verified ASC NULLS FIRST;
```

### Count Portals by Type

```sql
SELECT
    portal_type,
    COUNT(*) AS count,
    ROUND(AVG(confidence_score), 2) AS avg_confidence,
    COUNT(*) FILTER (WHERE last_verified > NOW() - INTERVAL '90 days') AS verified_recently
FROM portals
WHERE status = 'production'
GROUP BY portal_type
ORDER BY count DESC;
```

---

## Jurisdiction Queries

### Get All Cities in a State

```sql
SELECT
    j.fips_code,
    j.name,
    j.population,
    j.governance_structure,
    j.council_size,
    COUNT(d.id) AS district_count
FROM jurisdictions j
LEFT JOIN districts d ON j.id = d.jurisdiction_id AND d.status = 'production'
WHERE
    j.country_code = 'US'
    AND j.admin_level = 'city'
    AND j.fips_code LIKE '06%'  -- California (FIPS starts with 06)
GROUP BY j.id
ORDER BY j.population DESC NULLS LAST;
```

### Find At-Large Cities

```sql
SELECT
    j.name,
    j.fips_code,
    a.total_seats,
    a.election_method,
    a.source_url,
    a.verified_date
FROM at_large_cities a
JOIN jurisdictions j ON a.jurisdiction_id = j.id
WHERE j.country_code = 'US'
ORDER BY j.name;
```

### Cities Missing Boundary Data

```sql
SELECT
    j.fips_code,
    j.name,
    j.population,
    CASE
        WHEN j.boundary_geom IS NULL THEN 'No boundary'
        WHEN NOT EXISTS (SELECT 1 FROM districts d WHERE d.jurisdiction_id = j.id) THEN 'No districts'
        ELSE 'Complete'
    END AS status
FROM jurisdictions j
WHERE
    j.admin_level = 'city'
    AND j.country_code = 'US'
    AND (
        j.boundary_geom IS NULL OR
        NOT EXISTS (SELECT 1 FROM districts d WHERE d.jurisdiction_id = j.id AND d.status = 'production')
    )
    AND j.id NOT IN (SELECT jurisdiction_id FROM at_large_cities)
ORDER BY j.population DESC NULLS LAST;
```

---

## Validation Queries

### Latest Validation Results

```sql
-- Using materialized view
SELECT
    j.name,
    j.fips_code,
    v.status,
    v.failed_axiom,
    v.coverage_ratio,
    v.district_count,
    v.expected_count,
    v.validated_at
FROM latest_validations v
JOIN jurisdictions j ON v.jurisdiction_id = j.id
WHERE j.country_code = 'US'
ORDER BY v.validated_at DESC;

-- Filter failures only
SELECT
    j.name,
    v.failed_axiom,
    v.failure_reason,
    v.coverage_ratio,
    v.district_count,
    v.expected_count
FROM latest_validations v
JOIN jurisdictions j ON v.jurisdiction_id = j.id
WHERE
    v.status = 'failed'
    AND j.country_code = 'US'
ORDER BY v.validated_at DESC;
```

### Run Validation for Specific City

```sql
-- Execute tessellation validation
SELECT * FROM check_tessellation(
    (SELECT id FROM jurisdictions WHERE fips_code = '0644000')  -- Los Angeles
);
```

### Validation Statistics by State

```sql
SELECT
    SUBSTRING(j.fips_code, 1, 2) AS state_fips,
    COUNT(*) AS total_cities,
    COUNT(*) FILTER (WHERE v.status = 'passed') AS passed,
    COUNT(*) FILTER (WHERE v.status = 'failed') AS failed,
    ROUND(100.0 * COUNT(*) FILTER (WHERE v.status = 'passed') / COUNT(*), 2) AS pass_rate
FROM jurisdictions j
LEFT JOIN latest_validations v ON j.id = v.jurisdiction_id
WHERE
    j.admin_level = 'city'
    AND j.country_code = 'US'
GROUP BY SUBSTRING(j.fips_code, 1, 2)
ORDER BY state_fips;
```

---

## Spatial Analysis Queries

### Calculate District Area

```sql
-- Area in square meters (accurate, uses geography)
SELECT
    district_number,
    district_name,
    ROUND(ST_Area(geom::geography) / 1000000, 2) AS area_sq_km,
    ROUND(ST_Area(geom::geography) / 2589988.11, 2) AS area_sq_miles
FROM districts
WHERE jurisdiction_id = (SELECT id FROM jurisdictions WHERE fips_code = '0644000')
ORDER BY area_sq_km DESC;
```

### Find Nearest District Centroid

```sql
-- Find 5 nearest district centroids to a point
SELECT
    d.district_number,
    d.district_name,
    j.name AS jurisdiction_name,
    ROUND(ST_Distance(
        d.centroid::geography,
        ST_SetSRID(ST_MakePoint(-118.2437, 34.0522), 4326)::geography
    )) AS distance_meters
FROM districts d
JOIN jurisdictions j ON d.jurisdiction_id = j.id
WHERE
    d.status = 'production'
    AND j.country_code = 'US'
ORDER BY d.centroid <-> ST_SetSRID(ST_MakePoint(-118.2437, 34.0522), 4326)
LIMIT 5;
```

### Detect Overlapping Districts (Data Quality Check)

```sql
-- Find districts that overlap each other (should be ZERO for valid tessellation)
WITH overlaps AS (
    SELECT
        d1.id AS district1_id,
        d1.district_number AS district1_num,
        d2.id AS district2_id,
        d2.district_number AS district2_num,
        j.name AS jurisdiction_name,
        ST_Area(ST_Intersection(d1.geom, d2.geom)::geography) AS overlap_area_sq_m
    FROM districts d1
    JOIN districts d2 ON
        d1.jurisdiction_id = d2.jurisdiction_id
        AND d1.id < d2.id  -- Avoid duplicate pairs
        AND ST_Overlaps(d1.geom, d2.geom)
    JOIN jurisdictions j ON d1.jurisdiction_id = j.id
    WHERE d1.status = 'production' AND d2.status = 'production'
)
SELECT * FROM overlaps
WHERE overlap_area_sq_m > 150000  -- Ignore tiny overlaps (tolerance threshold)
ORDER BY overlap_area_sq_m DESC;
```

### Coverage Analysis (District Union vs Municipal Boundary)

```sql
SELECT
    j.name,
    j.fips_code,
    ROUND(ST_Area(j.boundary_geom::geography) / 1000000, 2) AS municipal_area_sq_km,
    ROUND(ST_Area(ST_Union(d.geom)::geography) / 1000000, 2) AS district_union_area_sq_km,
    ROUND(
        ST_Area(ST_Union(d.geom)::geography) / ST_Area(j.boundary_geom::geography),
        4
    ) AS coverage_ratio,
    COUNT(d.id) AS district_count,
    j.council_size AS expected_count
FROM jurisdictions j
LEFT JOIN districts d ON j.id = d.jurisdiction_id AND d.status = 'production'
WHERE
    j.admin_level = 'city'
    AND j.boundary_geom IS NOT NULL
    AND j.country_code = 'US'
GROUP BY j.id
HAVING COUNT(d.id) > 0
ORDER BY coverage_ratio DESC;
```

---

## Quarantine & Remediation Queries

### Quarantined Portals Pending Review

```sql
SELECT
    q.id,
    q.reason,
    q.detailed_reason,
    q.review_status,
    q.quarantined_at,
    q.snapshot->>'cityName' AS city_name,
    q.snapshot->>'state' AS state,
    q.snapshot->>'downloadUrl' AS portal_url
FROM quarantine_registry q
WHERE
    q.portal_id IS NOT NULL
    AND q.review_status = 'pending'
ORDER BY q.quarantined_at DESC;
```

### Remediation History

```sql
SELECT
    r.applied_at,
    r.issue_type,
    r.fix_method,
    r.script_name,
    r.applied_by,
    j.name AS jurisdiction_name,
    j.fips_code,
    LEFT(r.issue_description, 100) AS issue_summary
FROM remediation_history r
JOIN jurisdictions j ON r.jurisdiction_id = j.id
WHERE j.country_code = 'US'
ORDER BY r.applied_at DESC
LIMIT 20;
```

### Restore Quarantined Portal

```sql
-- 1. Review quarantine entry
SELECT * FROM quarantine_registry WHERE id = 'uuid-of-quarantine-entry';

-- 2. Mark as approved
UPDATE quarantine_registry
SET
    review_status = 'approved',
    reviewed_by = 'user@example.com',
    reviewed_at = NOW(),
    review_notes = 'False positive - tessellation failure due to vintage mismatch'
WHERE id = 'uuid-of-quarantine-entry';

-- 3. Restore portal (manual INSERT from snapshot)
INSERT INTO portals (jurisdiction_id, country_code, portal_type, download_url, ...)
SELECT
    j.id,
    'US',
    (snapshot->>'portalType')::portal_type,
    snapshot->>'downloadUrl',
    ...
FROM quarantine_registry q
JOIN jurisdictions j ON j.fips_code = q.snapshot->>'cityFips'
WHERE q.id = 'uuid-of-quarantine-entry';

-- 4. Mark as restored
UPDATE quarantine_registry
SET restored = TRUE, restored_at = NOW()
WHERE id = 'uuid-of-quarantine-entry';
```

---

## Coverage Statistics

### Global Coverage Dashboard

```sql
-- Using materialized view
SELECT * FROM mv_coverage_stats
ORDER BY country_code, admin_level;

-- Real-time version
SELECT
    country_code,
    admin_level,
    COUNT(*) AS total,
    COUNT(DISTINCT CASE WHEN p.id IS NOT NULL THEN j.id END) AS with_portals,
    COUNT(DISTINCT CASE WHEN d.id IS NOT NULL THEN j.id END) AS with_districts,
    ROUND(
        100.0 * COUNT(DISTINCT CASE WHEN d.id IS NOT NULL THEN j.id END) / COUNT(*),
        2
    ) AS coverage_pct
FROM jurisdictions j
LEFT JOIN portals p ON j.id = p.jurisdiction_id AND p.status = 'production'
LEFT JOIN districts d ON j.id = d.jurisdiction_id AND d.status = 'production'
GROUP BY country_code, admin_level
ORDER BY country_code, admin_level;
```

### Top 50 US Cities Coverage

```sql
-- Check coverage of largest US cities
WITH top50 AS (
    SELECT id, fips_code, name, population
    FROM jurisdictions
    WHERE country_code = 'US' AND admin_level = 'city'
    ORDER BY population DESC NULLS LAST
    LIMIT 50
)
SELECT
    t.name,
    t.fips_code,
    t.population,
    CASE
        WHEN p.id IS NOT NULL THEN 'Portal found'
        ELSE 'No portal'
    END AS portal_status,
    CASE
        WHEN d.id IS NOT NULL THEN 'Districts loaded'
        WHEN p.id IS NOT NULL THEN 'Portal only'
        ELSE 'Missing'
    END AS district_status,
    v.status AS validation_status
FROM top50 t
LEFT JOIN portals p ON t.id = p.jurisdiction_id AND p.status = 'production'
LEFT JOIN districts d ON t.id = d.jurisdiction_id AND d.status = 'production'
LEFT JOIN latest_validations v ON t.id = v.jurisdiction_id
ORDER BY t.population DESC;
```

---

## Discovery Event Analysis

### Discovery Success Rate

```sql
SELECT
    discovery_strategy,
    COUNT(*) AS total_attempts,
    COUNT(*) FILTER (WHERE status = 'found') AS found,
    COUNT(*) FILTER (WHERE status = 'not-found') AS not_found,
    COUNT(*) FILTER (WHERE status = 'error') AS errors,
    ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'found') / COUNT(*), 2) AS success_rate
FROM discovery_events
GROUP BY discovery_strategy
ORDER BY total_attempts DESC;
```

### Recent Discovery Activity

```sql
SELECT
    d.discovered_at,
    d.discovery_strategy,
    d.status,
    j.name AS jurisdiction_name,
    j.fips_code,
    p.portal_type,
    p.confidence_score
FROM discovery_events d
JOIN jurisdictions j ON d.jurisdiction_id = j.id
LEFT JOIN portals p ON d.portal_id = p.id
WHERE d.discovered_at > NOW() - INTERVAL '7 days'
ORDER BY d.discovered_at DESC;
```

---

## Performance Queries

### Index Usage Statistics

```sql
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan AS scans,
    idx_tup_read AS tuples_read,
    idx_tup_fetch AS tuples_fetched,
    pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;
```

### Slow Query Detection

```sql
-- Requires pg_stat_statements extension
SELECT
    LEFT(query, 100) AS query_preview,
    calls,
    ROUND(mean_exec_time::numeric, 2) AS avg_ms,
    ROUND(max_exec_time::numeric, 2) AS max_ms,
    ROUND(total_exec_time::numeric, 2) AS total_ms
FROM pg_stat_statements
WHERE query LIKE '%districts%' OR query LIKE '%jurisdictions%'
ORDER BY mean_exec_time DESC
LIMIT 10;
```

### Table Sizes

```sql
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size,
    pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) AS table_size,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) AS indexes_size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

---

## Maintenance Queries

### Refresh Materialized Views

```sql
-- Stale portals view (run daily)
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_stale_portals;

-- Coverage stats (run after bulk imports)
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_coverage_stats;
```

### Vacuum & Analyze

```sql
-- Vacuum analyze specific tables after bulk imports
VACUUM ANALYZE jurisdictions;
VACUUM ANALYZE portals;
VACUUM ANALYZE districts;

-- Full vacuum (reclaim disk space) - requires lock
VACUUM FULL districts;
```

### Reindex (if query performance degrades)

```sql
-- Reindex specific tables
REINDEX TABLE districts;
REINDEX TABLE jurisdictions;

-- Reindex spatial indexes
REINDEX INDEX idx_districts_geom_gist;
REINDEX INDEX idx_jurisdictions_boundary_gist;
```

---

## Migration Helper Queries

### Import Known Portal from TypeScript

```sql
-- Single portal import
SELECT import_known_portal(jsonb_build_object(
    'cityFips', '0644000',
    'cityName', 'Los Angeles',
    'state', 'CA',
    'portalType', 'arcgis',
    'downloadUrl', 'https://geohub.lacity.org/datasets/...',
    'featureCount', 15,
    'lastVerified', '2026-01-15T00:00:00.000Z',
    'confidence', 95,
    'discoveredBy', 'automated',
    'notes', 'Official LACITY GIS portal'
));
```

### Verify Migration Integrity

```sql
-- Check for missing foreign keys
SELECT 'portals missing jurisdiction' AS issue, COUNT(*)
FROM portals p
LEFT JOIN jurisdictions j ON p.jurisdiction_id = j.id
WHERE j.id IS NULL

UNION ALL

SELECT 'districts missing jurisdiction', COUNT(*)
FROM districts d
LEFT JOIN jurisdictions j ON d.jurisdiction_id = j.id
WHERE j.id IS NULL

UNION ALL

SELECT 'districts missing portal', COUNT(*)
FROM districts d
LEFT JOIN portals p ON d.portal_id = p.id
WHERE d.portal_id IS NOT NULL AND p.id IS NULL;
```

---

**Pro Tip**: Use `EXPLAIN ANALYZE` to profile query performance:

```sql
EXPLAIN ANALYZE
SELECT * FROM find_district(-118.2437, 34.0522);
```

Look for:
- **Index Scan** (good) vs **Seq Scan** (bad for large tables)
- **Actual time** < 10ms for point-in-polygon queries
- **Rows** should match expected cardinality (avoid scanning entire table)
