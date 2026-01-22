# Shadow Atlas Architecture Comparison

**TypeScript Registry vs PostgreSQL + PostGIS**

---

## System Architecture Diagrams

### Current: TypeScript Registry

```
┌─────────────────────────────────────────────────────────┐
│                    Client Application                   │
│                  (VOTER Protocol API)                   │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│              TypeScript Registry (In-Memory)            │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ known-       │  │ at-large-    │  │ quarantined- │ │
│  │ portals.ts   │  │ cities.ts    │  │ portals.ts   │ │
│  │ (520 cities) │  │ (50 cities)  │  │ (30 entries) │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
│                                                         │
│  Linear scan: O(n) lookup, 50-100ms per query         │
└─────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│        Remote GeoJSON Portals (520+ endpoints)         │
│                                                         │
│  ArcGIS  │  Socrata  │  CKAN  │  Direct Downloads     │
│                                                         │
│  Network latency: 100-500ms per portal                 │
│  Cache required or 7-15 second queries                 │
└─────────────────────────────────────────────────────────┘

BOTTLENECKS:
❌ No spatial indexing (linear scan all polygons)
❌ Network calls required for geometries (unless cached)
❌ Single-threaded (file I/O blocks concurrent access)
❌ Memory-bound (all GeoJSON in RAM = 8-16 GB at 10k cities)
```

### Proposed: PostgreSQL + PostGIS

```
┌─────────────────────────────────────────────────────────┐
│                    Client Application                   │
│                  (VOTER Protocol API)                   │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│              PostgREST (Auto-Generated API)             │
│              OR Custom Express.js API                   │
│                                                         │
│  GET /rpc/find_district?lat=34.05&lng=-118.24         │
│  → <5ms response (GIST index + partition pruning)      │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│         PostgreSQL 16 + PostGIS 3.4 (Managed)          │
│                                                         │
│  ┌────────────────────────────────────────────────────┐│
│  │ Core Tables (Country Partitioned)                  ││
│  │                                                     ││
│  │  jurisdictions  (cities, counties, states)         ││
│  │  ├─ jurisdictions_us     (50% of data)            ││
│  │  ├─ jurisdictions_ca                              ││
│  │  └─ jurisdictions_default (long tail)             ││
│  │                                                     ││
│  │  portals        (GIS endpoints, 520+)              ││
│  │  districts      (boundary geometries, 7800+)       ││
│  │  └─ GIST spatial index (5ms point-in-polygon)     ││
│  └────────────────────────────────────────────────────┘│
│                                                         │
│  ┌────────────────────────────────────────────────────┐│
│  │ Provenance Tables (Append-Only)                    ││
│  │                                                     ││
│  │  discovery_events    (when/how portals found)      ││
│  │  validation_runs     (tessellation results)        ││
│  │  quarantine_registry (failed validations)          ││
│  │  remediation_history (fixes applied)               ││
│  └────────────────────────────────────────────────────┘│
│                                                         │
│  ┌────────────────────────────────────────────────────┐│
│  │ Materialized Views (Performance)                   ││
│  │                                                     ││
│  │  mv_stale_portals   (need re-validation)          ││
│  │  mv_coverage_stats  (global coverage metrics)     ││
│  └────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘

OPTIMIZATIONS:
✅ Spatial indexing (O(log n) GIST index)
✅ Geometries stored locally (no network calls)
✅ Multi-user (100+ concurrent queries via connection pool)
✅ Disk-bound (query cache only, 100 MB vs 8-16 GB RAM)
```

---

## Performance Comparison

### Point-in-Polygon Query

**TypeScript** (without cache):
```
1. Load known-portals.ts              →    5ms (file read)
2. Iterate 520 portals                →   10ms (linear scan)
3. Fetch GeoJSON (520 HTTP requests)  → 5000ms (network I/O)
4. Turf.js point-in-polygon (7800×)   → 7800ms (CPU-bound)
────────────────────────────────────────────────────────
Total: ~12 seconds per query (UNACCEPTABLE)
```

**TypeScript** (with aggressive cache):
```
1. Load cached GeoJSON                →   20ms (memory lookup)
2. Turf.js point-in-polygon (7800×)   →   50ms (CPU-bound)
────────────────────────────────────────────────────────
Total: ~70ms per query (MARGINAL)

Cache invalidation: Manual, error-prone
Memory usage: 8-16 GB (all geometries in RAM)
```

**PostgreSQL + PostGIS**:
```
1. Partition pruning (country_code)   →  0.5ms (WHERE clause)
2. GIST index scan                    →  2.0ms (log₂(7800) ≈ 13 levels)
3. ST_Contains refinement (5-10×)    →  2.0ms (exact geometry check)
────────────────────────────────────────────────────────
Total: ~5ms per query (EXCELLENT)

Cache invalidation: Automatic (PostgreSQL buffer pool)
Memory usage: 100 MB (query cache only)
```

### Scalability

| Metric | TypeScript (10k cities) | PostgreSQL (10M cities) |
|--------|-------------------------|-------------------------|
| **Query Time** | 30-60 seconds | 5-10ms |
| **Memory** | 16-32 GB (all GeoJSON) | 100-200 MB (cache) |
| **Concurrent Users** | 1 (file I/O blocks) | 100+ (connection pool) |
| **Disk Usage** | 0 (remote GeoJSON) | 50-100 GB (local geometries) |

---

## Data Flow Comparison

### Current: TypeScript Registry

```
User Request (lat/lng)
  │
  ▼
Load Registry File (5ms)
  │
  ▼
Linear Scan Portals (10ms)
  │
  ▼
Fetch GeoJSON from 520 URLs? ──────► Network Latency (5-10 seconds)
  │                                      │
  ▼                                      │
Check Cache ◄──────────────────────────┘
  │
  ▼
Turf.js Point-in-Polygon (50-100ms)
  │
  ▼
Return District

PROBLEMS:
- Network dependency (remote GeoJSON)
- Cache invalidation complexity
- Single-threaded (blocks concurrent requests)
- No spatial indexing (scans all 7800 polygons)
```

### Proposed: PostgreSQL + PostGIS

```
User Request (lat/lng)
  │
  ▼
API Layer (PostgREST or Express)
  │
  ▼
PostgreSQL Query:
  SELECT * FROM find_district(lng, lat)
  │
  ├─► Partition Pruning (0.5ms)
  │   WHERE country_code = 'US'
  │   → Scan only US partition (skip 189 countries)
  │
  ├─► GIST Index Scan (2ms)
  │   ON districts USING GIST(geom)
  │   → 13 tree levels (log₂(7800))
  │   → Returns 5-10 candidates (bounding box overlap)
  │
  └─► ST_Contains Refinement (2ms)
      → Exact geometry intersection
      → Returns 1 matching district
  │
  ▼
Return District (5ms total)

BENEFITS:
✅ No network calls (geometries stored locally)
✅ No cache invalidation (PostgreSQL handles it)
✅ Multi-threaded (100+ concurrent queries)
✅ Spatial indexing (logarithmic lookup)
```

---

## Cost Comparison (1M Queries/Month)

### TypeScript Architecture

**Infrastructure**:
- Node.js (4 cores, 8GB RAM for cache): $200/month
- CDN (GeoJSON bandwidth): $100/month
- **Subtotal**: $300/month

**Engineering**:
- Custom caching layer: 2-3 weeks
- Staleness detection: 1 week
- Concurrent access: 2-3 weeks
- **Subtotal**: 6-10 weeks ($12k-20k one-time)

**Operations** (manual monitoring):
- Staleness checks: 4 hours/week
- Cache invalidation: 2 hours/week
- **Subtotal**: $1200-2400/month

**First Year**: $18k-30k (eng) + $3.6k (infra) + $14k-29k (ops) = **$35k-62k**

### PostgreSQL Architecture

**Infrastructure**:
- PostgreSQL managed (2 cores, 4GB RAM): $100/month
- Node.js API (2 cores, 2GB RAM): $50/month
- **Subtotal**: $150/month

**Engineering**:
- Schema deployment: 1 week
- Data migration: 2-3 weeks
- API setup: 1 week
- **Subtotal**: 5-6 weeks ($10k-15k one-time)

**Operations** (automated):
- Materialized view refresh: 0 hours (cron)
- Database backups: 1 hour/week (automated)
- **Subtotal**: $200-400/month

**First Year**: $10k-15k (eng) + $1.8k (infra) + $2.4k-4.8k (ops) = **$14k-22k**

### ROI Analysis

**PostgreSQL saves $19k-40k in first year**
- 50% lower infrastructure costs
- 83% lower operational overhead
- Break-even: Immediate (migration < custom development)

---

## Feature Matrix

| Feature | TypeScript | PostgreSQL | Winner |
|---------|-----------|------------|--------|
| **Setup Time** | 0 (already working) | 2-3 weeks | TypeScript |
| **Query Performance** | 50-100ms (cached) | <5ms | PostgreSQL |
| **Concurrent Users** | 1 (file I/O blocks) | 100+ (pooled) | PostgreSQL |
| **Spatial Queries** | Turf.js (slow) | PostGIS (native) | PostgreSQL |
| **Update Detection** | Manual (RSS checks) | Automated (materialized views) | PostgreSQL |
| **API Generation** | Custom Express routes | PostgREST (auto-gen) | PostgreSQL |
| **Provenance Tracking** | Git commits | Append-only audit tables | PostgreSQL |
| **Global Scale** | 1k-10k cities | Millions of cities | PostgreSQL |
| **Team Learning Curve** | TypeScript (existing) | SQL + PostGIS (new) | TypeScript |
| **Infrastructure Complexity** | Simple (Node.js only) | Moderate (+PostgreSQL) | TypeScript |

**Recommendation**: TypeScript for MVP (<6 months to launch), PostgreSQL for production API (Phase 2)

---

## Migration Strategy

### Option 1: Full Migration (6 weeks, higher risk)

```
Week 1  ━━━━━━━━━━━━━━━━━━━━  Schema Design & PostgreSQL Setup
Week 2  ━━━━━━━━━━━━━━━━━━━━  Data Migration (TS → PostgreSQL)
Week 3  ━━━━━━━━━━━━━━━━━━━━  Geometry Downloads
Week 4  ━━━━━━━━━━━━━━━━━━━━  Validation & Quarantine
Week 5  ━━━━━━━━━━━━━━━━━━━━  API Deployment
Week 6  ━━━━━━━━━━━━━━━━━━━━  Cutover & Monitoring

RISK: 6-week feature freeze, no fallback if migration fails
```

### Option 2: Phased Migration (8-10 weeks, lower risk) ✅ Recommended

```
Week 1-2   ━━━━━━━━━━━━━━━━  PostgreSQL Setup + Schema
Week 3-4   ━━━━━━━━━━━━━━━━  Dual-Mode Operation (TS + PG)
Week 5-6   ━━━━━━━━━━━━━━━━  Geometry Downloads (background)
Week 7-8   ━━━━━━━━━━━━━━━━  API Deployment + A/B Testing
Week 9-10  ━━━━━━━━━━━━━━━━  Deprecate TypeScript

BENEFIT: Continuous delivery, fallback to TypeScript if needed
```

### Option 3: Defer Migration (stay TypeScript)

```
Now        ━━━━━━━━━━━━━━━━  Optimize TypeScript (caching, pagination)
+6 months  ━━━━━━━━━━━━━━━━  Re-evaluate if API demand justifies PostgreSQL
+12 months ━━━━━━━━━━━━━━━━  Forced migration at 1000+ cities (harder at scale)

BENEFIT: Focus on core VOTER protocol features
RISK: Technical debt accumulates, migration painful at scale
```

---

## Decision Framework

```
┌──────────────────────────────────────────────────────────┐
│ Will you launch a FREE PUBLIC API in the next 12 months?│
│                                                          │
│  YES → Migrate to PostgreSQL                           │
│        (PostgREST auto-generates REST API)              │
│                                                          │
│  NO  → Do you need <10ms point-in-polygon queries?     │
│                                                          │
│        YES → Migrate to PostgreSQL                     │
│              (TypeScript can't achieve this)            │
│                                                          │
│        NO  → Do you need 10+ concurrent users?         │
│                                                          │
│              YES → Migrate to PostgreSQL               │
│                    (TypeScript blocks on file I/O)      │
│                                                          │
│              NO  → Stay with TypeScript                │
│                    (Sufficient for internal MVP)        │
└──────────────────────────────────────────────────────────┘
```

---

## Recommended Path for VOTER Protocol

### Phase 1 (Pre-Launch): TypeScript
- Focus on core protocol (ZK proofs, smart contracts, token economics)
- TypeScript registry sufficient for internal validation
- Optimize with caching layer (in-memory LRU cache)
- Defer database complexity until Phase 2

### Phase 2 (Post-Launch): PostgreSQL Migration
- After VOTER protocol MVP launch (<6 months)
- Before offering free public API (competing with Cicero)
- Use phased migration (8-10 weeks, dual-mode operation)
- Deploy with Supabase (PostgreSQL + PostgREST + real-time)

**Key Insight**: Don't let database migration block core protocol development. TypeScript → PostgreSQL is a Phase 2 optimization, not a Phase 1 requirement.

---

## Next Steps

1. **Week 1**: Review documentation with team
2. **Decision Point**: Migrate now vs defer to Phase 2?
3. **If Migrate**: Follow `DATABASE-MIGRATION-PLAN.md`
4. **If Defer**: Optimize TypeScript (caching, pagination), revisit in 6 months

**Questions?** See `POSTGIS-MIGRATION-README.md` for complete guide.
