# High Latency Troubleshooting Runbook

**Severity**: P1-P2
**Symptoms**: API response times >5s, slow query performance, timeout errors
**Impact**: User experience degraded, proof generation delayed

---

## Detection

**Automated alerts**:
```sql
-- Alert threshold: p95 latency >5s for 10 minutes
SELECT
  type,
  AVG(value) as avg_latency_ms,
  MAX(value) as max_latency_ms,
  COUNT(*) as request_count
FROM metrics
WHERE type LIKE '%latency%'
  AND recorded_at >= datetime('now', '-10 minutes')
GROUP BY type
HAVING avg_latency_ms > 5000;
```

**Manual check**:
```bash
# Check recent operation latencies
sqlite3 .shadow-atlas/metrics.db "
SELECT
  type,
  value as latency_ms,
  recorded_at
FROM metrics
WHERE type IN ('extraction_duration', 'validation_duration', 'merkle_build_duration')
ORDER BY recorded_at DESC
LIMIT 20;
"
```

---

## Severity Assessment

| Latency | Operations Affected | Severity | Action |
|---------|-------------------|----------|--------|
| >30s | All operations | P1 | Immediate mitigation |
| 10-30s | All operations | P1 | Investigate within 1h |
| 5-10s | All operations | P2 | Investigate within 4h |
| >5s | Single operation type | P2 | Monitor, optimize |

---

## Diagnostic Steps

### Step 1: Identify Slow Component (5 minutes)

```bash
# Check which operations are slow
sqlite3 .shadow-atlas/metrics.db "
SELECT
  json_extract(labels_json, '$.operation') as operation,
  json_extract(labels_json, '$.state') as state,
  AVG(value) as avg_duration_ms,
  MAX(value) as max_duration_ms,
  COUNT(*) as count
FROM metrics
WHERE type = 'operation_duration'
  AND recorded_at >= datetime('now', '-1 hour')
GROUP BY operation, state
HAVING avg_duration_ms > 5000
ORDER BY avg_duration_ms DESC;
"
```

**Possible culprits**:
- **extraction_duration**: Provider API slow or network issues
- **validation_duration**: Geometry validation slow (complex polygons)
- **merkle_build_duration**: Tree too large or CPU-bound
- **database_query**: Database lock contention or missing indexes

### Step 2: Check System Resources (2 minutes)

```bash
# CPU usage
top -l 1 | grep "CPU usage"

# Memory usage
vm_stat | head -5

# Disk I/O
iostat -d 1 5

# Database size
ls -lh .shadow-atlas/*.db

# Check for large tables
sqlite3 .shadow-atlas/persistence.db "
SELECT name, (pgsize * pgcount) / 1024 / 1024 as size_mb
FROM dbstat
WHERE aggregate = TRUE
ORDER BY size_mb DESC
LIMIT 10;
"
```

**Red flags**:
- CPU >80% sustained
- Memory pressure (free pages <10%)
- Disk I/O wait >20%
- Database >5GB (consider archiving)

### Step 3: Check External Dependencies (3 minutes)

```bash
# Test provider response times
time curl -s "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer" > /dev/null

# Check DNS resolution
time nslookup tigerweb.geo.census.gov

# Check network latency
ping -c 5 tigerweb.geo.census.gov

# Provider error rates
sqlite3 .shadow-atlas/metrics.db "
SELECT
  json_extract(labels_json, '$.provider') as provider,
  COUNT(*) as error_count
FROM metrics
WHERE type = 'provider_error'
  AND recorded_at >= datetime('now', '-1 hour')
GROUP BY provider;
"
```

**Common issues**:
- Provider API degraded (>2s response time)
- DNS resolution slow (>500ms)
- Network packet loss (>1%)
- High error rates from specific provider

---

## Resolution Procedures

### Case A: Slow Provider API

**Symptoms**: High extraction_duration, provider timeout errors

**Quick mitigation**:
```bash
# Switch to fallback provider
# Edit orchestration options temporarily
npx tsx -e "
import { BatchOrchestrator } from './services/batch-orchestrator.js';
const orch = new BatchOrchestrator({
  providerTimeoutMs: 30000, // Increase timeout
  maxRetries: 5,             // More retries
  preferStatePortals: true,  // Use state portals over ArcGIS Hub
});
// Resume affected jobs
const result = await orch.resumeJob('${JOB_ID}');
console.log('Resumed with fallback config:', result.status);
"
```

**Long-term fix**:
1. Identify affected provider
2. Check provider status page
3. Add fallback providers to registry
4. Implement automatic provider health checks

### Case B: Database Lock Contention

**Symptoms**: High database_query duration, "database is locked" errors

**Quick mitigation**:
```bash
# Enable WAL mode (if not already enabled)
sqlite3 .shadow-atlas/persistence.db "PRAGMA journal_mode=WAL;"

# Check for long-running transactions
sqlite3 .shadow-atlas/persistence.db "
SELECT * FROM sqlite_master WHERE type='table';
"

# Kill stuck processes (last resort)
ps aux | grep "batch-orchestrator\|extract-all-states"
# If necessary: pkill -f "batch-orchestrator.*stuck-job-id"
```

**Investigation**:
```bash
# Check for missing indexes
sqlite3 .shadow-atlas/persistence.db "
EXPLAIN QUERY PLAN
SELECT * FROM extractions WHERE state_code = 'CA' AND layer_type = 'congressional';
"

# If "SCAN TABLE" appears, add index:
sqlite3 .shadow-atlas/persistence.db "
CREATE INDEX IF NOT EXISTS idx_extractions_state_layer
ON extractions(state_code, layer_type);
"
```

**Long-term fix**:
1. Add indexes for common queries
2. Implement connection pooling
3. Consider PostgreSQL migration for high concurrency

### Case C: Large Merkle Tree Build

**Symptoms**: High merkle_build_duration (>60s)

**Quick mitigation**:
```bash
# Check tree size
sqlite3 .shadow-atlas/persistence.db "
SELECT
  COUNT(*) as total_boundaries,
  COUNT(DISTINCT state_code) as states_count
FROM extractions
WHERE job_id = (SELECT id FROM jobs ORDER BY created_at DESC LIMIT 1);
"

# If >500k boundaries, consider incremental build
# (Not implemented in v1, future optimization)
```

**Long-term optimization**:
1. Implement incremental Merkle tree updates
2. Cache intermediate tree nodes
3. Parallelize tree construction
4. Profile tree building code for bottlenecks

### Case D: Complex Geometry Validation

**Symptoms**: High validation_duration for specific states

**Investigation**:
```bash
# Find slow validations
sqlite3 .shadow-atlas/persistence.db "
SELECT
  state_code,
  layer_type,
  validator_type,
  COUNT(*) as validations,
  AVG(validation_time_ms) as avg_duration_ms
FROM validation_results
WHERE validated_at >= datetime('now', '-24 hours')
GROUP BY state_code, layer_type, validator_type
HAVING avg_duration_ms > 5000
ORDER BY avg_duration_ms DESC;
"
```

**Quick mitigation**:
```bash
# Skip geometry validation for known-good states
# (Manual override, use sparingly)
npx tsx -e "
import { DataValidator } from './services/data-validator.js';
const validator = new DataValidator({
  skipGeometryValidation: true, // Temporary workaround
  validateCountsOnly: true,
});
"
```

**Long-term fix**:
1. Optimize geometry validation algorithms
2. Cache validation results
3. Parallelize validation across states
4. Simplify complex geometries (if appropriate)

---

## Performance Optimization Checklist

### Database Optimizations

```bash
# Analyze database statistics
sqlite3 .shadow-atlas/persistence.db "ANALYZE;"

# Vacuum to reclaim space (do during maintenance window)
sqlite3 .shadow-atlas/persistence.db "VACUUM;"

# Check index usage
sqlite3 .shadow-atlas/persistence.db "
SELECT * FROM sqlite_stat1;
"
```

### Query Optimizations

```sql
-- Add indexes for common queries
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_extractions_job ON extractions(job_id);
CREATE INDEX IF NOT EXISTS idx_failures_job ON failures(job_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_deprecated ON snapshots(deprecated_at);
CREATE INDEX IF NOT EXISTS idx_metrics_type_time ON metrics(type, recorded_at);
```

### Application Optimizations

```typescript
// Batch database inserts
// Before (slow):
for (const extraction of extractions) {
  await repo.insertExtraction(extraction);
}

// After (fast):
await repo.insertExtractions(extractions); // Single transaction
```

---

## Monitoring & Prevention

### Set Latency Alerts

```typescript
// observability/alerts.ts
const latencyAlert: AlertRule = {
  name: 'high_latency',
  condition: (metrics) => {
    const avgLatency = metrics
      .filter(m => m.type === 'operation_duration')
      .reduce((sum, m) => sum + m.value, 0) / metrics.length;
    return avgLatency > 5000; // 5s threshold
  },
  severity: 'warning',
  notificationChannels: ['slack'],
};
```

### Continuous Profiling

```bash
# Add to daily cron
# ops/scripts/performance-report.sh
#!/bin/bash
sqlite3 .shadow-atlas/metrics.db "
SELECT
  type,
  AVG(value) as avg_duration_ms,
  MIN(value) as min_duration_ms,
  MAX(value) as max_duration_ms,
  COUNT(*) as count
FROM metrics
WHERE type LIKE '%duration%'
  AND recorded_at >= datetime('now', '-24 hours')
GROUP BY type
ORDER BY avg_duration_ms DESC;
" > daily-performance-$(date +%Y%m%d).txt
```

### Capacity Planning

Track growth trends:
```sql
-- Weekly capacity metrics
SELECT
  date(recorded_at) as date,
  COUNT(*) as operations,
  AVG(value) as avg_duration_ms
FROM metrics
WHERE type = 'operation_duration'
GROUP BY date
ORDER BY date DESC
LIMIT 30;
```

---

## Escalation Criteria

**Escalate to Tech Lead if**:
- Latency >30s and no obvious cause found
- Mitigation attempts unsuccessful after 2 hours
- Affecting production proof generation
- Requires architectural changes (PostgreSQL migration, etc.)

**Escalation template**:
```markdown
@tech-lead - Latency issue escalation

**Latency**: [Avg/Max values]
**Duration**: [How long issue persists]
**Operations Affected**: [List]
**Impact**: [User-facing impact]

**Investigation**:
- ✅ System resources: [Normal/Degraded]
- ✅ Provider APIs: [Response times]
- ✅ Database: [Lock contention / index issues]
- ❌ Root cause: [Unknown/Partial]

**Mitigation Attempts**:
1. [Action 1 - Result]
2. [Action 2 - Result]

**Need**: [Architecture review / Database expertise / etc.]
```

---

## Success Criteria

- [ ] Latency <5s for p95 of operations
- [ ] No timeout errors in last hour
- [ ] System resources within normal ranges
- [ ] Provider response times <2s
- [ ] Database queries <1s

---

**Related Runbooks**:
- [Error Rate Investigation](error-rate.md)
- [Database Corruption](data-corruption.md)
- [Upstream Provider Failure](upstream-failure.md)

**Last Updated**: 2025-12-18
