# Shadow Atlas Spatial Database Migration (Archive)

**Complete database architecture for political district boundaries at global scale**

> This archive captures research into moving shadow-atlas off the TypeScript
> registry and onto an indexed spatial database. It is durable-store-agnostic
> — any spatial DB with R-tree / GIST-equivalent indexing satisfies the
> requirements.

---

## Documents Overview

This directory contains research into a spatial-database migration plan for shadow-atlas.

### Quick Navigation

| Document | Purpose | Read This If... |
|----------|---------|-----------------|
| **[POSTGIS-SCHEMA.sql](POSTGIS-SCHEMA.sql)** | Complete database schema | You want to see the actual CREATE TABLE statements |
| **[DATABASE-MIGRATION-PLAN.md](DATABASE-MIGRATION-PLAN.md)** | Phased migration guide | You're ready to migrate TypeScript → spatial DB |
| **[DATABASE-ARCHITECTURE-DECISIONS.md](DATABASE-ARCHITECTURE-DECISIONS.md)** | Design rationale | You want to understand WHY each decision was made |
| **[POSTGIS-QUERY-COOKBOOK.md](POSTGIS-QUERY-COOKBOOK.md)** | Common SQL queries | You need example queries for daily operations |
| **[MIGRATION-DECISION-MATRIX.md](MIGRATION-DECISION-MATRIX.md)** | Should you migrate? | You're deciding between TypeScript vs spatial DB |

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
- Spatial indexes (R-tree / GIST-equivalent) for <5ms queries
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

### 3. Spatial Indexes (R-tree / GIST-equivalent)

**Why**: 5ms point-in-polygon (vs 500ms sequential scan)
**Trade-off**: 30% storage overhead, but essential for API performance

### 4. Append-Only Provenance

**Why**: Immutable audit trail, regulatory compliance, temporal analysis
**Implementation**: No UPDATE/DELETE on discovery_events, validation_runs

### 5. JSONB Source Attributes

**Why**: 520 portals with 520 unique schemas (unmaintainable to normalize)
**Benefit**: Nested-attribute indexes enable querying arbitrary fields

---

## Performance Targets

| Query Type | Target | Implementation |
|------------|--------|----------------|
| Point-in-polygon | <10ms | Spatial index + partition pruning |
| Portal by FIPS | <5ms | Btree index on fips_code |
| Coverage stats | <100ms | Materialized view (daily refresh) |
| Stale portal scan | <200ms | Materialized view + index |
| Validation run | <2s per city | Parallel processing |

---

## Migration Timeline

### Phase 1: Schema Deployment (Week 1)
- Provision managed spatial DB with R-tree / GIST-equivalent indexing
- Deploy schema
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
- Run geometry validation

### Phase 4: Validation (Week 4-5)
- Run tessellation validation (all jurisdictions)
- Quarantine failures
- Generate remediation reports

### Phase 5: API Deployment (Week 5-6)
- Deploy REST API (auto-generated or custom)
- Set up query monitoring
- Configure daily materialized view refresh

---

## Cost Estimate

**Infrastructure** (1M API queries/month):
- Managed spatial DB: $100/month
- Node.js API server: $50/month
- **Total**: $150/month

**Engineering Time**:
- Migration development: 5-6 weeks
- Spatial DB training: 2 days
- **Total**: ~$12k-15k (one-time)

**Operational Overhead**:
- Automated monitoring: 0 hours (materialized views)
- Database backups: 1 hour/week (automated)
- **Total**: ~$200-400/month

**First Year Total**: $16k-22k (vs $35k-62k for custom TypeScript architecture)

---

## When to Migrate

### Migrate NOW if:
- Planning free public API
- Need to scale beyond 1000 cities
- Have >5 concurrent users
- Want automated staleness detection
- Need <10ms point-in-polygon queries

### Stay TypeScript if:
- <6 months from VOTER protocol launch
- Current 520-city coverage sufficient for MVP
- <5 concurrent users (internal use only)
- Team has zero database experience
- Want to minimize infrastructure dependencies

**Recommendation**: Defer migration until Phase 2 (post-launch) if launch <6 months. Focus on core VOTER protocol first.

---

## Getting Started

### 1. Review Documentation

Read the schema, decision rationale, and migration plan linked in Quick
Navigation above.

### 2. Provision a Spatial DB

Any managed DB with R-tree / GIST-equivalent spatial indexing works. The
schema is portable across providers.

### 3. Run Test Migration (Sample Data)

```bash
# Create migration script
npm run migrate:test

# Import 10 sample portals into the target DB
# Verify counts against the TypeScript registry
```

### 4. Benchmark Performance

```bash
# Run benchmark script
npm run benchmark:spatial

# Expected results:
# - Point-in-polygon: <10ms
# - Portal lookup: <5ms
# - Coverage stats: <100ms
```

---

## API Examples

### Point-in-Polygon

```bash
# Find district containing lat/lng
curl "https://<api>/district?lat=34.0522&lng=-118.2437"

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
curl "https://<api>/coverage-stats?country_code=US"

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
curl "https://<api>/stale-portals?days_since_verified=90&limit=10"

# Response: List of portals not verified in 90+ days
```

---

## Maintenance Tasks

### Daily (automated)
- Refresh materialized views for stale portals + coverage stats
- Check for stale portals

### Weekly (automated)
- Table maintenance (vacuum/analyze equivalent)
- Check index usage
- Slow query report

### Monthly (automated)
- Full snapshot / logical backup
- Archive old discovery events (retain 12 months)

---

## Rollback Plan

### If Migration Fails

```bash
# 1. Set environment to use TypeScript registry
export USE_SPATIAL_DB=false

# 2. Restore TypeScript registry files from git
git checkout main -- src/core/registry/

# 3. Tear down the migrated DB (if needed)
# 4. Restore from pre-migration snapshot
```

### Dual-Mode Operation (During Migration)

```typescript
// Support both TypeScript and spatial DB during transition
const USE_SPATIAL_DB = process.env.USE_SPATIAL_DB === 'true';

export async function getPortalByFIPS(fips: string): Promise<KnownPortal | null> {
  if (USE_SPATIAL_DB) {
    return await getPortalFromDB(fips);
  } else {
    return KNOWN_PORTALS[fips] || null;
  }
}
```

---

## Success Criteria

Migration complete when:

- All 520+ portals migrated with correct metadata
- Point-in-polygon queries <10ms (95th percentile)
- API deployed and accessible (auto-generated or custom)
- Validation passes for 90%+ of jurisdictions
- Automated staleness monitoring operational
- Quarantine workflow functional (review → restore/reject)
- Daily materialized view refresh (cron jobs)
- Database backups automated (daily snapshot)

---

## Support Resources

### Learning spatial indexing

- Vendor docs for the chosen spatial DB
- Any introductory "spatial indexing for developers" workshop

### Managed spatial DBs

Any provider offering R-tree / GIST-equivalent spatial indexing is a
candidate. Choose based on operational fit with the rest of the
infrastructure.

### Consulting (If Team Lacks Spatial Expertise)

- Estimated cost: $5k-10k for initial setup + training

---

## Questions?

**Schema questions**: See `POSTGIS-SCHEMA.sql` (complete DDL with comments)
**Migration questions**: See `DATABASE-MIGRATION-PLAN.md` (phased approach)
**Design questions**: See `DATABASE-ARCHITECTURE-DECISIONS.md` (rationale)
**Query questions**: See `POSTGIS-QUERY-COOKBOOK.md` (common patterns)
**Decision questions**: See `MIGRATION-DECISION-MATRIX.md` (TypeScript vs spatial DB)

---

## Next Steps

1. **Week 1**: Review all documentation with team
2. **Week 2**: Provision spatial DB (local + staging)
3. **Week 3-4**: Run Phase 1 migration (jurisdictions + portals)
4. **Week 5-6**: Run Phase 2 migration (geometries + validation)
5. **Week 7**: Deploy API
6. **Week 8**: Monitor performance, tune indexes

**Total Timeline**: 6-8 weeks from start to production API

---

**Architecture designed for**: 190+ countries, 10M+ districts, 100+ concurrent users, <10ms queries

**Built with**: Managed spatial DB, industry best practices, production-grade provenance tracking
