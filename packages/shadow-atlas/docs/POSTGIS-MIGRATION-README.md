# Shadow Atlas PostgreSQL + PostGIS Migration

**Complete database architecture for political district boundaries at global scale**

---

## Documents Overview

This directory contains a complete PostgreSQL + PostGIS migration plan for shadow-atlas, designed by a Distinguished Engineer specializing in spatial databases.

### 📋 Quick Navigation

| Document | Purpose | Read This If... |
|----------|---------|-----------------|
| **[POSTGIS-SCHEMA.sql](POSTGIS-SCHEMA.sql)** | Complete database schema | You want to see the actual CREATE TABLE statements |
| **[DATABASE-MIGRATION-PLAN.md](DATABASE-MIGRATION-PLAN.md)** | Phased migration guide | You're ready to migrate TypeScript → PostgreSQL |
| **[DATABASE-ARCHITECTURE-DECISIONS.md](DATABASE-ARCHITECTURE-DECISIONS.md)** | Design rationale | You want to understand WHY each decision was made |
| **[POSTGIS-QUERY-COOKBOOK.md](POSTGIS-QUERY-COOKBOOK.md)** | Common SQL queries | You need example queries for daily operations |
| **[MIGRATION-DECISION-MATRIX.md](MIGRATION-DECISION-MATRIX.md)** | Should you migrate? | You're deciding between TypeScript vs PostgreSQL |

---

## Schema Highlights

### Core Tables

**`jurisdictions`** - Hierarchical administrative units (cities, counties, states, countries)
- Supports 190+ countries via country-level partitioning
- Stores municipal boundaries (MultiPolygon geometries)
- Tracks governance structure (district-based vs at-large)
- Self-referencing parent_id for arbitrary hierarchy depth

**`portals`** - GIS data sources for boundary downloads
- ArcGIS, Socrata, CKAN, Census TIGER endpoints
- Confidence scoring (0-100) for automated source selection
- Staleness detection (last_verified timestamps)
- Update monitoring (RSS feeds, portal modified dates)

**`districts`** - Actual district boundary geometries
- Primary table for point-in-polygon queries
- GIST spatial indexes (<5ms query performance)
- Cached geometric properties (area, perimeter, centroid)
- JSONB source attributes (flexible schema)

### Provenance Tables

**`discovery_events`** - When/how portals were discovered
- Append-only audit log (immutable history)
- Tracks LLM candidate selection (for auditing)
- Performance metrics (execution time, HTTP requests)

**`validation_runs`** - Tessellation validation results
- Complete TessellationProof diagnostics
- Failed axiom tracking (exclusivity, exhaustivity, containment, cardinality)
- Temporal analysis (coverage improving over time?)

**`quarantine_registry`** - Failed validations pending review
- Soft delete pattern (never permanently delete data)
- Snapshot preservation (can restore quarantined portals)
- Structured review workflow (pending → approved/rejected/fixed)

**`remediation_history`** - Track fixes applied to data quality issues
- Documents all manual interventions
- Links to scripts used (Git SHA tracking)
- Before/after snapshots (complete provenance)

### Special Tables

**`at_large_cities`** - Cities with no geographic districts
- Prevents tessellation validation (would fail 100%)
- Documents election method (at-large, proportional, ranked-choice)
- Authoritative source tracking (city charters)

---

## Key Design Decisions

### 1. SRID 4326 (WGS84) - Global Standard

**Why**: Client APIs expect lat/lng in WGS84, GeoJSON mandates it
**Trade-off**: Area calculations require geography cast, but acceptable for accuracy

### 2. Country-Level Partitioning

**Why**: 95% of queries filter by country (partition pruning optimization)
**Implementation**: US, CA, GB, AU, DE, FR partitions + default (long tail)

### 3. GIST Spatial Indexes

**Why**: 5ms point-in-polygon (vs 500ms sequential scan)
**Trade-off**: 30% storage overhead, but essential for API performance

### 4. Append-Only Provenance

**Why**: Immutable audit trail, regulatory compliance, temporal analysis
**Implementation**: No UPDATE/DELETE on discovery_events, validation_runs

### 5. JSONB Source Attributes

**Why**: 520 portals with 520 unique schemas (unmaintainable to normalize)
**Benefit**: GIN indexes enable querying nested attributes

---

## Performance Targets

| Query Type | Target | Implementation |
|------------|--------|----------------|
| Point-in-polygon | <10ms | GIST index + partition pruning |
| Portal by FIPS | <5ms | Btree index on fips_code |
| Coverage stats | <100ms | Materialized view (daily refresh) |
| Stale portal scan | <200ms | Materialized view + index |
| Validation run | <2s per city | Parallel processing |

---

## Migration Timeline

### Phase 1: Schema Deployment (Week 1)
- Install PostgreSQL 16 + PostGIS 3.4+
- Deploy schema from `POSTGIS-SCHEMA.sql`
- Set up connection pooling
- Create read-only API user

### Phase 2: Data Migration (Week 2-3)
- Import jurisdictions from TypeScript files
- Import portals (520+ city + county entries)
- Import at-large cities
- Import quarantined portals
- Import provenance logs

### Phase 3: Geometry Download (Week 3-4)
- Download districts from portals (parallel)
- Download municipal boundaries (Census TIGER)
- Run geometry validation (ST_IsValid)

### Phase 4: Validation (Week 4-5)
- Run tessellation validation (all jurisdictions)
- Quarantine failures
- Generate remediation reports

### Phase 5: API Deployment (Week 5-6)
- Deploy PostgREST (auto-generated REST API)
- Or custom Express API (if needed)
- Set up monitoring (pg_stat_statements)
- Configure daily materialized view refresh

---

## Cost Estimate

**Infrastructure** (1M API queries/month):
- PostgreSQL managed instance: $100/month
- Node.js API server: $50/month
- **Total**: $150/month

**Engineering Time**:
- Migration development: 5-6 weeks
- PostGIS training: 2 days
- **Total**: ~$12k-15k (one-time)

**Operational Overhead**:
- Automated monitoring: 0 hours (materialized views)
- Database backups: 1 hour/week (automated)
- **Total**: ~$200-400/month

**First Year Total**: $16k-22k (vs $35k-62k for custom TypeScript architecture)

---

## When to Migrate

### Migrate NOW if:
- ✅ Planning free public API (competing with Cicero)
- ✅ Need to scale beyond 1000 cities
- ✅ Have >5 concurrent users
- ✅ Want automated staleness detection
- ✅ Need <10ms point-in-polygon queries

### Stay TypeScript if:
- ✅ <6 months from VOTER protocol launch
- ✅ Current 520-city coverage sufficient for MVP
- ✅ <5 concurrent users (internal use only)
- ✅ Team has zero database experience
- ✅ Want to minimize infrastructure dependencies

**Recommendation**: Defer migration until Phase 2 (post-launch) if launch <6 months. Focus on core VOTER protocol first.

---

## Getting Started

### 1. Review Documentation
```bash
# Read schema
cat docs/POSTGIS-SCHEMA.sql | less

# Read decision rationale
cat docs/DATABASE-ARCHITECTURE-DECISIONS.md | less

# Review migration plan
cat docs/DATABASE-MIGRATION-PLAN.md | less
```

### 2. Set Up Local PostgreSQL
```bash
# macOS
brew install postgresql@16 postgis

# Create database
createdb shadow_atlas

# Install extensions
psql shadow_atlas -c "CREATE EXTENSION postgis;"
psql shadow_atlas -c "CREATE EXTENSION postgis_topology;"
psql shadow_atlas -c 'CREATE EXTENSION "uuid-ossp";'

# Deploy schema
psql shadow_atlas -f docs/POSTGIS-SCHEMA.sql

# Verify
psql shadow_atlas -c "SELECT PostGIS_Full_Version();"
```

### 3. Run Test Migration (Sample Data)
```bash
# Create migration script
npm run migrate:test

# Import 10 sample portals
psql shadow_atlas -c "SELECT import_known_portal(...);"

# Verify import
psql shadow_atlas -c "SELECT COUNT(*) FROM jurisdictions;"
psql shadow_atlas -c "SELECT COUNT(*) FROM portals;"
```

### 4. Benchmark Performance
```bash
# Run benchmark script
npm run benchmark:postgis

# Expected results:
# - Point-in-polygon: <10ms
# - Portal lookup: <5ms
# - Coverage stats: <100ms
```

---

## API Examples

### Point-in-Polygon (PostgREST)

```bash
# Find district containing lat/lng
curl "http://localhost:3000/rpc/find_district?lat=34.0522&lng=-118.2437"

# Response:
{
  "district_id": "uuid",
  "district_number": "1",
  "district_name": "Council District 1",
  "jurisdiction_id": "uuid",
  "jurisdiction_name": "Los Angeles",
  "country_code": "US"
}
```

### Coverage Statistics

```bash
# Get global coverage
curl "http://localhost:3000/mv_coverage_stats?country_code=eq.US"

# Response:
[
  {
    "country_code": "US",
    "admin_level": "city",
    "total_jurisdictions": 520,
    "jurisdictions_with_portals": 520,
    "jurisdictions_with_districts": 485,
    "coverage_percent": 93.27
  }
]
```

### Stale Portals (Monitoring)

```bash
# Get portals needing re-validation
curl "http://localhost:3000/mv_stale_portals?days_since_verified=gte.90&limit=10"

# Response: List of portals not verified in 90+ days
```

---

## Maintenance Tasks

### Daily (Automated via Cron)

```bash
# Refresh materialized views (2 AM)
psql shadow_atlas -c "REFRESH MATERIALIZED VIEW CONCURRENTLY mv_stale_portals;"
psql shadow_atlas -c "REFRESH MATERIALIZED VIEW CONCURRENTLY mv_coverage_stats;"

# Check for stale portals (3 AM)
psql shadow_atlas -f scripts/check-stale-portals.sql
```

### Weekly

```bash
# Vacuum analyze (Sunday 1 AM)
psql shadow_atlas -c "VACUUM ANALYZE jurisdictions, portals, districts;"

# Check index usage
psql shadow_atlas -f scripts/index-usage.sql

# Slow query report
psql shadow_atlas -f scripts/slow-queries.sql
```

### Monthly

```bash
# Full backup
pg_dump -Fc shadow_atlas > backups/shadow_atlas_$(date +%Y%m).dump

# Archive old discovery events (retain 12 months)
psql shadow_atlas -f scripts/archive-old-events.sql
```

---

## Rollback Plan

### If Migration Fails

```bash
# 1. Set environment to use TypeScript (not PostgreSQL)
export USE_POSTGRES=false

# 2. Restore TypeScript registry files from git
git checkout main -- src/core/registry/

# 3. Drop database (if needed)
dropdb shadow_atlas

# 4. Restore from pre-migration snapshot
psql shadow_atlas < backups/pre_migration.sql
```

### Dual-Mode Operation (During Migration)

```typescript
// Support both TypeScript and PostgreSQL during transition
const USE_POSTGRES = process.env.USE_POSTGRES === 'true';

export async function getPortalByFIPS(fips: string): Promise<KnownPortal | null> {
  if (USE_POSTGRES) {
    return await getPortalFromDB(fips);
  } else {
    return KNOWN_PORTALS[fips] || null;
  }
}
```

---

## Success Criteria

Migration complete when:

- ✅ All 520+ portals migrated with correct metadata
- ✅ Point-in-polygon queries <10ms (95th percentile)
- ✅ API deployed and accessible (PostgREST or custom)
- ✅ Validation passes for 90%+ of jurisdictions
- ✅ Automated staleness monitoring operational
- ✅ Quarantine workflow functional (review → restore/reject)
- ✅ Daily materialized view refresh (cron jobs)
- ✅ Database backups automated (pg_dump daily)

---

## Support Resources

### Learning PostGIS

- [PostGIS Documentation](https://postgis.net/docs/) - Official reference
- [Boundless Spatial Tutorial](https://workshops.boundlessgeo.com/postgis-intro/) - Hands-on workshop
- [PostGIS in Action](https://www.manning.com/books/postgis-in-action-third-edition) - Comprehensive book

### Managed PostgreSQL Providers

- **[Supabase](https://supabase.com/)** - PostgreSQL + PostgREST + real-time (best for public API)
- **[AWS RDS PostgreSQL](https://aws.amazon.com/rds/postgresql/)** - Enterprise-grade
- **[Heroku Postgres](https://www.heroku.com/postgres)** - Simple setup
- **[DigitalOcean](https://www.digitalocean.com/products/managed-databases)** - Budget-friendly

### Consulting (If Team Lacks PostGIS Expertise)

- [Crunchy Data](https://www.crunchydata.com/) - PostgreSQL experts
- [Boundless Spatial](https://www.boundlessgeo.com/) - PostGIS specialists
- Estimated cost: $5k-10k for initial setup + training

---

## Questions?

**Schema questions**: See `POSTGIS-SCHEMA.sql` (complete DDL with comments)
**Migration questions**: See `DATABASE-MIGRATION-PLAN.md` (phased approach)
**Design questions**: See `DATABASE-ARCHITECTURE-DECISIONS.md` (rationale)
**Query questions**: See `POSTGIS-QUERY-COOKBOOK.md` (common patterns)
**Decision questions**: See `MIGRATION-DECISION-MATRIX.md` (TypeScript vs PostgreSQL)

---

## Next Steps

1. **Week 1**: Review all documentation with team
2. **Week 2**: Set up PostgreSQL instance (local + staging)
3. **Week 3-4**: Run Phase 1 migration (jurisdictions + portals)
4. **Week 5-6**: Run Phase 2 migration (geometries + validation)
5. **Week 7**: Deploy API (PostgREST or custom)
6. **Week 8**: Monitor performance, tune indexes

**Total Timeline**: 6-8 weeks from start to production API

---

**Architecture designed for**: 190+ countries, 10M+ districts, 100+ concurrent users, <10ms queries

**Built with**: PostgreSQL 16, PostGIS 3.4, Industry best practices, Production-grade provenance tracking
