# Shadow Atlas Migration Decision Matrix (Archive)

**Should you migrate to an indexed spatial database now, or continue with TypeScript registry files?**

This document captures the research notes for making that choice. It is
durable-store-agnostic — any managed spatial DB with R-tree / GIST-equivalent
indexing satisfies the requirements below.

---

## TL;DR Recommendation

**Migrate to a spatial DB if**:
- You plan to offer a free public API
- You need to scale beyond 1000 cities (current: 520)
- You have concurrent access requirements (multiple users/processes)
- You want automated staleness detection and update monitoring

**Stay with TypeScript if**:
- You're <6 months from launch and need to focus on core VOTER features
- Current 520-city coverage is sufficient for MVP
- You have <5 concurrent users accessing boundary data
- Database operations are new to your team

---

## Feature Comparison

| Feature | TypeScript Registry | Indexed Spatial DB | Winner |
|---------|---------------------|---------------------|--------|
| **Point-in-Polygon Query** | 50-100ms (linear scan) | <5ms (spatial index) | Spatial DB |
| **Concurrent Access** | Single-threaded (file read) | Multi-user (connection pool) | Spatial DB |
| **Update Detection** | Manual (check RSS feeds) | Automated (materialized views) | Spatial DB |
| **Provenance Tracking** | Git commits | Append-only audit tables | Spatial DB |
| **Spatial Queries** | Requires Turf.js (slow) | Native spatial index (fast) | Spatial DB |
| **API Generation** | Custom Express routes | Auto-generated from schema | Spatial DB |
| **Global Scale** | Memory-bound (~10k cities) | Disk-bound (millions of cities) | Spatial DB |
| **Data Quality Workflow** | Manual quarantine files | Structured review process | Spatial DB |
| **Setup Time** | 0 (already working) | 2-3 weeks (migration) | TypeScript |
| **Team Learning Curve** | TypeScript (existing) | SQL + spatial (new) | TypeScript |
| **Deployment Complexity** | Simple (Node.js) | Moderate (Node.js + DB) | TypeScript |
| **Backup Strategy** | Git (automatic) | Logical backup + Git (manual) | TypeScript |

---

## Performance Analysis

### Current TypeScript Architecture

```typescript
// Linear scan through 520 portals (O(n))
export function findDistrictByCoords(lat: number, lng: number): District | null {
  for (const portal of Object.values(KNOWN_PORTALS)) {
    const geojson = fetchGeoJSON(portal.downloadUrl); // Network call!
    for (const feature of geojson.features) {
      if (turf.booleanPointInPolygon([lng, lat], feature)) {
        return feature;
      }
    }
  }
  return null;
}

// Problems:
// - 520 network requests per query (unless cached)
// - Turf.js point-in-polygon: 1-2ms per polygon × 7800 polygons = 7-15 seconds
// - No spatial indexing (every query scans all polygons)
// - Concurrent queries block (single-threaded file I/O)
```

**Best Case** (with aggressive caching): 50-100ms
**Worst Case** (cold cache): 7-15 seconds
**Concurrent Users**: 1 (blocks on file read)

### Indexed Spatial DB Architecture

```sql
-- Spatial index lookup (O(log n))
SELECT * FROM find_district(-118.2437, 34.0522);

-- Query plan:
-- 1. Partition pruning (country_code = 'US') → scan 1 of 7 partitions
-- 2. Spatial index scan → 5-10 candidates (bounding box overlap)
-- 3. Geometry containment refinement → 1 exact match

-- Performance:
-- - Index scan: 2-3ms (log₂(7800) ≈ 13 levels)
-- - Geometry refinement: 1-2ms (only 5-10 polygons tested)
-- - Total: 3-5ms per query
```

**Best Case**: 3ms (cache hit)
**Worst Case**: 10ms (cache miss)
**Concurrent Users**: 100+ (connection pool)

### Scaling Projections

| Metric | TypeScript (10k cities) | Spatial DB (10M cities) |
|--------|-------------------------|--------------------------|
| Query Time | 30-60 seconds | 5-10ms |
| Memory Usage | 8-16 GB (all GeoJSON) | 100 MB (query cache) |
| Concurrent Queries | 1 (blocked) | 100+ (pooled) |
| Update Detection | Manual (weekly) | Automated (daily) |

---

## Cost Analysis

### TypeScript Architecture Costs

**Development Time**:
- Custom caching layer: 2-3 weeks
- Staleness detection: 1 week
- API endpoints: 1 week
- Concurrent access handling: 2-3 weeks
- **Total**: 6-10 weeks of engineering time

**Infrastructure** (at 1M queries/month):
- Node.js servers: $200/month (4 cores, 8GB RAM for in-memory cache)
- CDN for GeoJSON files: $100/month (bandwidth)
- **Total**: ~$300/month

**Operational Overhead**:
- Manual staleness monitoring: 4 hours/week
- GeoJSON cache invalidation: 2 hours/week
- **Total**: ~24 hours/month = $1200-2400/month (engineer time)

**Total Cost** (first year): $18k-30k (engineering) + $3.6k (infra) + $14k-29k (ops) = **$35k-62k**

### Spatial DB Architecture Costs

**Development Time**:
- Schema deployment: 1 week
- Data migration: 2-3 weeks
- API setup: 1 week
- Validation integration: 1 week
- **Total**: 5-6 weeks of engineering time

**Infrastructure** (at 1M queries/month):
- Managed spatial DB: $100/month (2 cores, 4GB RAM, 100GB SSD)
- Node.js API server: $50/month (2 cores, 2GB RAM)
- **Total**: ~$150/month

**Operational Overhead**:
- Automated staleness monitoring: 0 hours (materialized views)
- Database backups: 1 hour/week (automated)
- **Total**: ~4 hours/month = $200-400/month (engineer time)

**Total Cost** (first year): $12k-15k (engineering) + $1.8k (infra) + $2.4k-4.8k (ops) = **$16k-22k**

### ROI Analysis

**Spatial DB saves** $19k-40k in first year
- Faster time-to-market (5-6 weeks vs 6-10 weeks)
- Lower infrastructure costs (50% reduction)
- Minimal operational overhead (83% reduction)

**Break-even**: Immediate (migration cost < custom development cost)

---

## Risk Assessment

### TypeScript Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Memory exhaustion at scale | High | Critical | Pagination + lazy loading |
| Slow queries hurt UX | High | High | Aggressive caching |
| Cache invalidation bugs | Medium | High | Cache versioning |
| Concurrent access race conditions | Medium | Medium | File locking |
| Manual staleness monitoring misses updates | Medium | Medium | Automated checks |

**Overall Risk**: **HIGH** - Multiple critical risks with complex mitigations

### Spatial DB Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Migration introduces data errors | Medium | High | Validation queries, dual-mode testing |
| Team lacks spatial DB expertise | Medium | Medium | Learning curve (1-2 weeks), external consult |
| Database downtime during migration | Low | Medium | Zero-downtime migration (dual-mode) |
| Query performance regression | Low | High | Benchmark before/after, index tuning |
| Additional infrastructure dependency | Low | Low | Managed DB provider |

**Overall Risk**: **MEDIUM** - Manageable with proper planning

---

## Team Readiness Assessment

### Skills Required for TypeScript

- TypeScript (already have)
- Turf.js spatial operations (already using)
- Caching strategies (need to learn)
- File locking (need to learn)
- Concurrent access patterns (need to learn)

**Learning Curve**: Medium (3-4 weeks for robust implementation)

### Skills Required for Spatial DB

- SQL (basic queries easy, optimization harder)
- Spatial indexing concepts (1-2 week learning curve)
- Database administration (backups, replication)
- API integration (existing Express.js knowledge transfers)

**Learning Curve**: Medium-High (2-3 weeks for proficiency)

**Recommendation**: Hire a spatial-DB consultant for initial setup ($5k-10k), then team maintains.

---

## Migration Timeline Scenarios

### Scenario 1: Full Migration (6 weeks)

```
Week 1: Schema design + DB setup
Week 2-3: Data migration (jurisdictions → portals → districts)
Week 4: Geometry downloads + validation
Week 5: API deployment + testing
Week 6: Cutover + monitoring
```

**Pros**: Clean break, no dual-mode complexity
**Cons**: High risk if migration fails, 6-week feature freeze

### Scenario 2: Phased Migration (8-10 weeks)

```
Week 1-2: DB setup + schema deployment
Week 3-4: Dual-mode operation (TypeScript + spatial DB)
Week 5-6: Geometry downloads + validation (background)
Week 7-8: API deployment + A/B testing
Week 9-10: Deprecate TypeScript, spatial DB primary
```

**Pros**: Low risk (fallback to TypeScript), continuous delivery
**Cons**: Longer timeline, dual-mode maintenance burden

### Scenario 3: Defer Migration (stay TypeScript)

```
Now: Invest in TypeScript optimization (caching, pagination)
+6 months: Re-evaluate if API demand justifies migration
+12 months: Forced migration when hitting 1000+ cities
```

**Pros**: Focus on core VOTER features, delay infrastructure work
**Cons**: Technical debt accumulates, migration harder at scale

---

## Decision Tree

```
Do you need to scale beyond 1000 cities in next 12 months?
├─ YES → Migrate now (avoid painful migration at scale)
└─ NO
    │
    ├─ Do you need <10ms point-in-polygon queries?
    │   ├─ YES → Migrate now (TypeScript can't achieve this)
    │   └─ NO
    │       │
    │       ├─ Do you need concurrent access (10+ users)?
    │       │   ├─ YES → Migrate now (TypeScript blocks on file I/O)
    │       │   └─ NO
    │       │       │
    │       │       ├─ Do you want to offer free public API?
    │       │       │   ├─ YES → Migrate now (auto-generated REST API)
    │       │       │   └─ NO → Stay TypeScript (sufficient for internal use)
```

---

## Recommended Decision

### Migrate to a spatial DB if you answer YES to 2+ of these:

1. You plan to offer a free public API within 12 months
2. You need to scale beyond 1000 cities
3. You have >5 concurrent users accessing boundary data
4. You want automated staleness detection
5. You need <10ms point-in-polygon queries
6. You're willing to invest 5-6 weeks of engineering time

### Stay with TypeScript if you answer YES to 2+ of these:

1. You're <6 months from VOTER protocol launch
2. Current 520-city coverage is sufficient for MVP
3. You have <5 concurrent users
4. Team has zero database experience
5. You want to minimize infrastructure dependencies
6. Manual staleness monitoring is acceptable

---

## Migration Preparation Checklist

If you decide to migrate, complete these before starting:

- [ ] Review the schema with the team
- [ ] Set up a spatial DB instance (local dev + staging)
- [ ] Verify the chosen DB supports R-tree / GIST-equivalent spatial indexing
- [ ] Create backup of TypeScript registry files (git tag)
- [ ] Designate a spatial-DB lead (internal or consultant)
- [ ] Schedule a short spatial-DB training for team
- [ ] Plan dual-mode operation strategy (TypeScript + spatial DB)
- [ ] Define success metrics (query time, coverage, validation pass rate)
- [ ] Set up monitoring (slow query log, index usage)
- [ ] Create rollback plan (restore from TypeScript if migration fails)

---

## External Resources

**Learning spatial indexing**:
- Vendor documentation for the chosen spatial DB
- A short "spatial indexing for developers" workshop
- Modern SQL references (for advanced query patterns)

**Managed spatial DB providers**:
Any provider offering R-tree / GIST-equivalent spatial indexing is a
candidate. Choose based on operational fit with the rest of the stack.

**Consultants** (if team lacks spatial expertise):
- Any PostGIS / spatial-DB consulting firm
- QGIS / spatial-DB consulting firms

---

## Final Recommendation

**For VOTER Protocol Phase 1 (Pre-Launch)**:
- **Stay with TypeScript** if launch <6 months (focus on core protocol)
- Optimize TypeScript architecture (caching, pagination)
- Plan spatial-DB migration for Phase 2 (post-launch)

**For VOTER Protocol Phase 2 (Public API Launch)**:
- **Migrate to an indexed spatial DB** before offering free API
- Use whichever managed provider best fits your operational stack
- Phased migration (8-10 weeks) to minimize risk

**Key Insight**: TypeScript is sufficient for internal use and MVP validation. A spatial DB becomes essential when you need public API performance and global scale.

---

**Questions?** See:
- `docs/POSTGIS-SCHEMA.sql` - Complete schema design
- `docs/DATABASE-MIGRATION-PLAN.md` - Phased migration strategy
- `docs/DATABASE-ARCHITECTURE-DECISIONS.md` - Design rationale
- `docs/POSTGIS-QUERY-COOKBOOK.md` - Common queries
