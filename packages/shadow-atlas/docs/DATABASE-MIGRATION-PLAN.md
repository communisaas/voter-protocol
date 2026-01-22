# Shadow Atlas Database Migration Plan

**Status**: Design Phase
**Target**: PostgreSQL 16+ with PostGIS 3.4+
**Timeline**: Phased migration over 4-6 weeks

---

## Executive Summary

Migrate shadow-atlas from TypeScript registry files to production PostgreSQL + PostGIS database. Enables free public API competing with Cicero ($5-10k/month), scales to 190+ countries, maintains complete provenance tracking.

### Migration Benefits

**Performance**
- Point-in-polygon queries: 50ms → <5ms (GIST spatial indexes)
- Concurrent access: Single-threaded TS → Multi-user PostgreSQL
- Global scale: 520 cities → 190+ countries without memory constraints

**Data Quality**
- Immutable audit trail (append-only provenance logs)
- Quarantine workflow (failed validations → review → restore/reject)
- Temporal analysis (track coverage improvements over time)

**API Capabilities**
- REST API via PostgREST (auto-generated from schema)
- GraphQL via PostGraphile (optional)
- Direct SQL access for institutional partners

---

## Current State Analysis

### TypeScript Registry Structure

```typescript
// 520 portal objects across multiple files
KNOWN_PORTALS: Record<string, KnownPortal> = {
  '0644000': {
    cityFips: '0644000',
    cityName: 'Los Angeles',
    state: 'CA',
    portalType: 'arcgis',
    downloadUrl: 'https://...',
    featureCount: 15,
    lastVerified: '2026-01-15T00:00:00.000Z',
    confidence: 95,
    discoveredBy: 'automated',
    notes: 'Official LACITY GIS portal'
  }
}

// Additional registries
AT_LARGE_CITIES: Record<string, AtLargeCity>
QUARANTINED_PORTALS: Record<string, QuarantinedPortal>
DISTRICT_COUNT_REGISTRY: Record<string, DistrictCountRecord>
GOVERNANCE_REGISTRY: Record<string, GovernanceRecord>
```

### Files to Migrate

| File | Records | Target Table |
|------|---------|--------------|
| `known-portals.ts` | 484 cities | `portals` + `jurisdictions` |
| `county-portals.ts` | 95 counties | `portals` + `jurisdictions` |
| `at-large-cities.ts` | ~50 cities | `at_large_cities` + `jurisdictions` |
| `quarantined-portals.ts` | ~30 entries | `quarantine_registry` |
| `district-count-registry.ts` | 520 records | `jurisdictions.council_size` |
| `governance-structures.ts` | ~200 records | `jurisdictions.governance_structure` |
| `provenance/*.ndjson.gz` | Event logs | `discovery_events` |

---

## Phase 1: Schema Deployment (Week 1)

### Setup PostgreSQL + PostGIS

```bash
# Install PostgreSQL 16 (via Homebrew/apt/Docker)
brew install postgresql@16 postgis

# Initialize database
createdb shadow_atlas
psql shadow_atlas -c "CREATE EXTENSION postgis;"
psql shadow_atlas -c "CREATE EXTENSION postgis_topology;"
psql shadow_atlas -c 'CREATE EXTENSION "uuid-ossp";'

# Deploy schema
psql shadow_atlas -f docs/POSTGIS-SCHEMA.sql

# Verify installation
psql shadow_atlas -c "SELECT PostGIS_Full_Version();"
```

### Environment Configuration

```bash
# .env
DATABASE_URL="postgresql://user:pass@localhost:5432/shadow_atlas"
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10
```

### Database Client Setup

```bash
npm install pg @types/pg
npm install prisma @prisma/client  # Optional: type-safe query builder
```

**Prisma Schema** (optional):

```prisma
// prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

// Auto-generated from introspection
// npx prisma db pull
```

---

## Phase 2: Data Migration (Week 2-3)

### Migration Script Architecture

```typescript
// scripts/migrate-to-postgres.ts

import { Pool } from 'pg';
import { KNOWN_PORTALS } from '../src/core/registry/known-portals.js';
import { AT_LARGE_CITIES } from '../src/core/registry/at-large-cities.js';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

async function migratePortals() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let migrated = 0;
    let errors = 0;

    for (const [fips, portal] of Object.entries(KNOWN_PORTALS)) {
      try {
        // Call import_known_portal() function
        const result = await client.query(
          'SELECT import_known_portal($1) AS portal_id',
          [JSON.stringify(portal)]
        );

        console.log(`✓ Migrated ${portal.cityName}, ${portal.state} (${fips})`);
        migrated++;
      } catch (err) {
        console.error(`✗ Failed ${portal.cityName}: ${err.message}`);
        errors++;
      }
    }

    await client.query('COMMIT');

    console.log(`\nMigration complete: ${migrated} migrated, ${errors} errors`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

### Migration Steps

**Step 1: Jurisdictions**

```typescript
// Create jurisdictions from known portals
async function createJurisdictions() {
  const jurisdictions = new Map<string, JurisdictionData>();

  // Aggregate from all sources
  for (const portal of Object.values(KNOWN_PORTALS)) {
    if (!jurisdictions.has(portal.cityFips)) {
      jurisdictions.set(portal.cityFips, {
        fips_code: portal.cityFips,
        name: portal.cityName,
        country_code: 'US',
        admin_level: 'city',
        governance_structure: getGovernanceStructure(portal.cityFips),
        council_size: getExpectedDistrictCount(portal.cityFips),
      });
    }
  }

  // Bulk insert
  await db.query(`
    INSERT INTO jurisdictions (fips_code, country_code, admin_level, name, governance_structure, council_size)
    SELECT * FROM json_populate_recordset(NULL::jurisdictions, $1)
    ON CONFLICT (fips_code) DO NOTHING
  `, [JSON.stringify(Array.from(jurisdictions.values()))]);
}
```

**Step 2: Portals**

```typescript
async function migratePortals() {
  const portals = Object.entries(KNOWN_PORTALS).map(([fips, portal]) => ({
    jurisdiction_fips: fips,
    country_code: 'US',
    portal_type: portal.portalType,
    download_url: portal.downloadUrl,
    feature_count: portal.featureCount,
    expected_feature_count: portal.featureCount,
    confidence_score: portal.confidence,
    discovered_by: portal.discoveredBy,
    last_verified: portal.lastVerified,
    status: 'production',
    notes: portal.notes,
  }));

  // Bulk insert with junction to jurisdictions
  await db.query(`
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
    )
    SELECT
      j.id,
      p.country_code,
      p.portal_type::portal_type,
      p.download_url,
      p.feature_count,
      p.expected_feature_count,
      p.confidence_score,
      p.discovered_by,
      p.last_verified::timestamptz,
      p.status::discovery_status,
      p.notes
    FROM json_populate_recordset(NULL::tmp_portal_import, $1) p
    JOIN jurisdictions j ON j.fips_code = p.jurisdiction_fips
  `, [JSON.stringify(portals)]);
}
```

**Step 3: At-Large Cities**

```typescript
async function migrateAtLargeCities() {
  for (const [fips, city] of Object.entries(AT_LARGE_CITIES)) {
    await db.query(`
      INSERT INTO at_large_cities (
        jurisdiction_id,
        election_method,
        total_seats,
        source_url,
        verified_date,
        notes
      )
      SELECT
        j.id,
        $2,
        $3,
        $4,
        $5,
        $6
      FROM jurisdictions j
      WHERE j.fips_code = $1
    `, [
      fips,
      city.electionMethod || 'at-large',
      city.councilSize,
      city.source,
      city.lastVerified,
      city.notes,
    ]);
  }
}
```

**Step 4: Quarantined Portals**

```typescript
async function migrateQuarantinedPortals() {
  for (const portal of Object.values(QUARANTINED_PORTALS)) {
    // Find portal_id if it exists in portals table
    const { rows } = await db.query(`
      SELECT p.id FROM portals p
      JOIN jurisdictions j ON p.jurisdiction_id = j.id
      WHERE j.fips_code = $1 AND p.download_url = $2
    `, [portal.cityFips, portal.downloadUrl]);

    await db.query(`
      INSERT INTO quarantine_registry (
        portal_id,
        reason,
        detailed_reason,
        snapshot,
        review_status
      ) VALUES ($1, $2, $3, $4, 'pending')
    `, [
      rows[0]?.id || null,
      mapQuarantineReason(portal.quarantineReason),
      portal.quarantineReason,
      JSON.stringify(portal),
    ]);
  }
}
```

**Step 5: Discovery Events**

```typescript
async function migrateProvenanceLogs() {
  const logFiles = await glob('provenance/2026-01/*.ndjson.gz');

  for (const file of logFiles) {
    const events = await readGzippedNDJSON(file);

    for (const event of events) {
      await db.query(`
        INSERT INTO discovery_events (
          jurisdiction_id,
          discovery_strategy,
          status,
          candidates,
          execution_time_ms,
          discovered_at
        )
        SELECT
          j.id,
          $2,
          $3::discovery_status,
          $4::jsonb,
          $5,
          $6::timestamptz
        FROM jurisdictions j
        WHERE j.fips_code = $1
      `, [
        event.f,  // FIPS from log
        event.src || 'legacy-migration',
        mapDiscoveryStatus(event),
        JSON.stringify(event.why || []),
        null,  // execution time not tracked in old logs
        event.ts,
      ]);
    }
  }
}
```

### Validation Queries

```sql
-- Verify migration counts
SELECT
  (SELECT COUNT(*) FROM jurisdictions) AS jurisdictions,
  (SELECT COUNT(*) FROM portals) AS portals,
  (SELECT COUNT(*) FROM at_large_cities) AS at_large,
  (SELECT COUNT(*) FROM quarantine_registry) AS quarantined;

-- Expected:
-- jurisdictions: 520+ (cities + counties)
-- portals: 520+ (may have multiple per jurisdiction)
-- at_large: ~50
-- quarantined: ~30

-- Check for orphaned portals
SELECT p.* FROM portals p
LEFT JOIN jurisdictions j ON p.jurisdiction_id = j.id
WHERE j.id IS NULL;
-- Expected: 0 rows

-- Verify FIPS uniqueness
SELECT fips_code, COUNT(*)
FROM jurisdictions
WHERE fips_code IS NOT NULL
GROUP BY fips_code
HAVING COUNT(*) > 1;
-- Expected: 0 rows
```

---

## Phase 3: Geometry Download & Ingestion (Week 3-4)

### Download Districts from Portals

```typescript
// scripts/download-district-geometries.ts

import type { FeatureCollection } from 'geojson';

async function downloadAndIngestDistricts() {
  // Get all production portals
  const { rows: portals } = await db.query(`
    SELECT
      p.id AS portal_id,
      p.download_url,
      p.jurisdiction_id,
      j.fips_code,
      j.name AS jurisdiction_name,
      j.country_code
    FROM portals p
    JOIN jurisdictions j ON p.jurisdiction_id = j.id
    WHERE p.status = 'production'
    ORDER BY p.confidence_score DESC
  `);

  for (const portal of portals) {
    try {
      console.log(`Downloading ${portal.jurisdiction_name}...`);

      // Download GeoJSON
      const response = await fetch(portal.download_url);
      const geojson: FeatureCollection = await response.json();

      // Insert districts
      for (const feature of geojson.features) {
        await db.query(`
          INSERT INTO districts (
            jurisdiction_id,
            portal_id,
            country_code,
            district_number,
            district_name,
            geom,
            source_attributes,
            source_url,
            download_date,
            status
          ) VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            ST_SetSRID(ST_GeomFromGeoJSON($6), 4326),
            $7,
            $8,
            NOW(),
            'production'
          )
        `, [
          portal.jurisdiction_id,
          portal.portal_id,
          portal.country_code,
          extractDistrictNumber(feature.properties),
          extractDistrictName(feature.properties),
          JSON.stringify(feature.geometry),
          JSON.stringify(feature.properties),
          portal.download_url,
        ]);
      }

      console.log(`✓ Ingested ${geojson.features.length} districts`);

      // Update portal metadata
      await db.query(`
        UPDATE portals
        SET
          last_successful_download = NOW(),
          feature_count = $2
        WHERE id = $1
      `, [portal.portal_id, geojson.features.length]);

    } catch (err) {
      console.error(`✗ Failed ${portal.jurisdiction_name}: ${err.message}`);

      await db.query(`
        UPDATE portals
        SET
          last_download_attempt = NOW(),
          download_error = $2
        WHERE id = $1
      `, [portal.portal_id, err.message]);
    }
  }
}
```

### Download Municipal Boundaries

```typescript
async function downloadMunicipalBoundaries() {
  // Use Census TIGER for US municipal boundaries
  const { rows: jurisdictions } = await db.query(`
    SELECT id, fips_code, name, country_code
    FROM jurisdictions
    WHERE country_code = 'US'
      AND admin_level = 'city'
      AND boundary_geom IS NULL
  `);

  for (const jurisdiction of jurisdictions) {
    const placeFips = jurisdiction.fips_code;
    const stateFips = placeFips.substring(0, 2);

    // Census TIGER URL pattern
    const tigerUrl = `https://www2.census.gov/geo/tiger/TIGER2023/PLACE/tl_2023_${stateFips}_place.zip`;

    // Download, unzip, filter by FIPS, convert to GeoJSON
    const boundary = await fetchCensusBoundary(tigerUrl, placeFips);

    await db.query(`
      UPDATE jurisdictions
      SET
        boundary_geom = ST_SetSRID(ST_GeomFromGeoJSON($2), 4326),
        boundary_source = $3,
        boundary_vintage = '2023-01-01'
      WHERE id = $1
    `, [
      jurisdiction.id,
      JSON.stringify(boundary.geometry),
      tigerUrl,
    ]);
  }
}
```

---

## Phase 4: Validation & Quality Assurance (Week 4-5)

### Run Tessellation Validation

```typescript
async function runTessellationValidation() {
  const { rows: jurisdictions } = await db.query(`
    SELECT j.id, j.name, j.country_code
    FROM jurisdictions j
    WHERE
      j.boundary_geom IS NOT NULL
      AND j.id NOT IN (SELECT jurisdiction_id FROM at_large_cities)
      AND EXISTS (
        SELECT 1 FROM districts d
        WHERE d.jurisdiction_id = j.id AND d.status = 'production'
      )
  `);

  for (const jurisdiction of jurisdictions) {
    console.log(`Validating ${jurisdiction.name}...`);

    const { rows } = await db.query(`
      SELECT * FROM check_tessellation($1)
    `, [jurisdiction.id]);

    const result = rows[0];

    if (result.status === 'failed') {
      console.error(`✗ ${jurisdiction.name}: ${result.failure_reason}`);

      // Quarantine if critical failure
      if (result.failed_axiom === 'cardinality' || result.coverage_ratio < 0.5) {
        await quarantineJurisdiction(jurisdiction.id, result);
      }
    } else {
      console.log(`✓ ${jurisdiction.name}: PASSED`);
    }
  }
}
```

### Quality Checks

```sql
-- Missing geometries
SELECT j.name, j.fips_code
FROM jurisdictions j
LEFT JOIN districts d ON j.id = d.jurisdiction_id
WHERE
  j.admin_level = 'city'
  AND j.id NOT IN (SELECT jurisdiction_id FROM at_large_cities)
  AND d.id IS NULL;

-- Invalid geometries
SELECT
  d.id,
  j.name,
  d.district_number,
  d.validation_errors
FROM districts d
JOIN jurisdictions j ON d.jurisdiction_id = j.id
WHERE d.is_valid = FALSE;

-- Coverage outliers (may indicate wrong data)
SELECT
  j.name,
  v.coverage_ratio,
  v.failed_axiom,
  v.failure_reason
FROM latest_validations v
JOIN jurisdictions j ON v.jurisdiction_id = j.id
WHERE
  v.coverage_ratio < 0.5 OR
  v.coverage_ratio > 2.0
ORDER BY v.coverage_ratio;
```

---

## Phase 5: API Deployment (Week 5-6)

### PostgREST Setup

```bash
# Install PostgREST
brew install postgrest

# Configure postgrest.conf
db-uri = "postgresql://shadow_atlas_api_user:password@localhost:5432/shadow_atlas"
db-schemas = "public"
db-anon-role = "shadow_atlas_api_user"
server-port = 3000
```

```bash
# Start PostgREST
postgrest postgrest.conf

# Test API
curl http://localhost:3000/jurisdictions?fips_code=eq.0644000
curl "http://localhost:3000/rpc/find_district?lng=-118.2437&lat=34.0522"
```

### Custom API Layer (Optional)

```typescript
// api/server.ts
import express from 'express';
import { Pool } from 'pg';

const app = express();
const db = new Pool({ connectionString: process.env.DATABASE_URL });

// Point-in-polygon lookup
app.get('/api/v1/district', async (req, res) => {
  const { lat, lng } = req.query;

  const { rows } = await db.query(
    'SELECT * FROM find_district($1, $2)',
    [lng, lat]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: 'No district found' });
  }

  res.json(rows[0]);
});

// Coverage statistics
app.get('/api/v1/stats', async (req, res) => {
  const { rows } = await db.query('SELECT * FROM mv_coverage_stats');
  res.json(rows);
});

app.listen(3000, () => console.log('API listening on :3000'));
```

### API Documentation

```markdown
# Shadow Atlas API

Free political district boundary API - compete with Cicero.

## Endpoints

**Find District by Coordinates**
```
GET /api/v1/district?lat=40.7128&lng=-74.0060
```

Response:
```json
{
  "district_id": "uuid",
  "district_number": "1",
  "district_name": "District 1",
  "jurisdiction_id": "uuid",
  "jurisdiction_name": "New York",
  "country_code": "US"
}
```

**Coverage Statistics**
```
GET /api/v1/stats?country_code=US
```

**Stale Portals (for monitoring)**
```
GET /api/v1/stale-portals?days_since_verified=gt.90
```
```

---

## Rollback Plan

### Database Snapshots

```bash
# Before migration
pg_dump shadow_atlas > shadow_atlas_pre_migration.sql

# After each phase
pg_dump shadow_atlas > shadow_atlas_phase${N}_complete.sql
```

### Keep TypeScript Files During Transition

```typescript
// Dual-mode operation during migration
const USE_POSTGRES = process.env.USE_POSTGRES === 'true';

export async function getPortalByFIPS(fips: string): Promise<KnownPortal | null> {
  if (USE_POSTGRES) {
    const { rows } = await db.query(`
      SELECT * FROM portals p
      JOIN jurisdictions j ON p.jurisdiction_id = j.id
      WHERE j.fips_code = $1
    `, [fips]);

    return rows[0] ? mapPortalFromDB(rows[0]) : null;
  } else {
    return KNOWN_PORTALS[fips] || null;
  }
}
```

### Rollback Procedure

1. Set `USE_POSTGRES=false` in environment
2. Restore TypeScript registry files from git
3. Drop database: `dropdb shadow_atlas` (if needed)
4. Restore from snapshot: `psql shadow_atlas < snapshot.sql`

---

## Performance Benchmarks

### Target Metrics

| Query | TypeScript | PostgreSQL Target | Actual |
|-------|-----------|-------------------|--------|
| Portal by FIPS | 1-2ms | <5ms | TBD |
| Point-in-polygon | 50-100ms | <10ms | TBD |
| Coverage stats | 500ms+ | <100ms | TBD |
| Stale portal scan | N/A | <200ms | TBD |

### Benchmark Script

```typescript
async function runBenchmarks() {
  const trials = 1000;

  // Point-in-polygon benchmark
  console.time('point-in-polygon');
  for (let i = 0; i < trials; i++) {
    await db.query(
      'SELECT * FROM find_district($1, $2)',
      [-118.2437, 34.0522]  // Los Angeles
    );
  }
  console.timeEnd('point-in-polygon');

  // Portal lookup benchmark
  console.time('portal-lookup');
  for (let i = 0; i < trials; i++) {
    await db.query(`
      SELECT * FROM portals p
      JOIN jurisdictions j ON p.jurisdiction_id = j.id
      WHERE j.fips_code = '0644000'
    `);
  }
  console.timeEnd('portal-lookup');
}
```

---

## Monitoring & Maintenance

### Daily Tasks (Automated)

```bash
# Refresh materialized views (cron: 2 AM daily)
psql shadow_atlas -c "REFRESH MATERIALIZED VIEW CONCURRENTLY mv_stale_portals;"
psql shadow_atlas -c "REFRESH MATERIALIZED VIEW CONCURRENTLY mv_coverage_stats;"

# Check for stale portals (cron: 3 AM daily)
psql shadow_atlas -c "
  SELECT j.name, p.last_verified, p.download_url
  FROM mv_stale_portals mv
  JOIN portals p ON mv.id = p.id
  JOIN jurisdictions j ON p.jurisdiction_id = j.id
  WHERE mv.days_since_verified > 120
  ORDER BY mv.days_since_verified DESC;
"
```

### Weekly Tasks

```sql
-- Analyze query performance
SELECT
  query,
  calls,
  mean_exec_time,
  max_exec_time
FROM pg_stat_statements
WHERE query LIKE '%districts%'
ORDER BY mean_exec_time DESC
LIMIT 10;

-- Check index usage
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan ASC;
```

### Backup Strategy

```bash
# Daily automated backups (pg_dump)
pg_dump -Fc shadow_atlas > backups/shadow_atlas_$(date +%Y%m%d).dump

# Retention: 7 daily, 4 weekly, 12 monthly
find backups/ -name "*.dump" -mtime +7 -delete  # Keep 7 days
```

---

## Success Criteria

Migration complete when:

- ✅ All 520+ portals migrated with correct metadata
- ✅ At-large cities properly flagged (skip tessellation)
- ✅ Quarantine workflow functional (review → restore/reject)
- ✅ Point-in-polygon queries <10ms (with spatial index)
- ✅ API deployed and accessible (PostgREST or custom)
- ✅ Validation passes for 90%+ of jurisdictions
- ✅ Provenance logs migrated (discovery events tracked)
- ✅ TypeScript registry files removed (or archived)

**Timeline**: 4-6 weeks from schema deployment to production API

---

## Next Steps

1. Review schema with team (address feedback)
2. Set up PostgreSQL instance (local dev → staging → production)
3. Run Phase 1 migration (jurisdictions + portals)
4. Validate Phase 1 results (quality checks)
5. Proceed with Phase 2 (geometry downloads)
6. Deploy API (PostgREST quickest path to production)

**Questions? See**: `docs/POSTGIS-SCHEMA.sql` for complete schema definitions
