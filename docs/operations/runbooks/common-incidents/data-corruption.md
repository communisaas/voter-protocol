# Data Corruption Runbook

**Severity**: P0 (Critical)
**Symptoms**: Database errors, invalid Merkle tree, proof validation failures
**Impact**: Complete service outage, data loss risk

---

## IMMEDIATE ACTIONS (First 5 Minutes)

```bash
# STOP ALL RUNNING JOBS IMMEDIATELY
pkill -f "batch-orchestrator"
pkill -f "extract-all-states"

# DO NOT write to database until corruption assessed
# DO NOT restart services

# Create emergency backup NOW
cp .shadow-atlas/persistence.db .shadow-atlas/persistence.db.EMERGENCY.$(date +%s)
cp .shadow-atlas/metrics.db .shadow-atlas/metrics.db.EMERGENCY.$(date +%s)

# Post alert
echo "🚨 P0: Data corruption suspected - all jobs stopped, investigating"
```

**DO NOT PROCEED until backups created.**

---

## Detection & Assessment

### Automated Detection

```bash
# Daily integrity check (should be in cron)
sqlite3 .shadow-atlas/persistence.db "PRAGMA integrity_check;"

# Expected: "ok"
# Corruption: "*** in database main ***" or specific error
```

### Manual Symptoms

- [ ] "database disk image is malformed"
- [ ] "SQLITE_CORRUPT" or "SQLITE_NOTADB" errors
- [ ] Queries return wrong data
- [ ] Table missing or unreadable
- [ ] Merkle tree validation fails >50%
- [ ] Proof generation fails consistently

### Corruption Scope Assessment

```bash
# Test each critical table
for table in jobs extractions failures snapshots validation_results; do
  echo "Testing $table..."
  if sqlite3 .shadow-atlas/persistence.db "SELECT COUNT(*) FROM $table;" 2>/dev/null; then
    echo "✓ $table readable"
  else
    echo "✗ $table CORRUPTED"
  fi
done

# Test specific queries
sqlite3 .shadow-atlas/persistence.db "
SELECT id, status, created_at FROM jobs ORDER BY created_at DESC LIMIT 5;
" && echo "✓ Jobs table functional" || echo "✗ Jobs table corrupted"
```

**Corruption matrix**:

| Scope | Tables Affected | Recovery Path | Downtime |
|-------|----------------|---------------|----------|
| None | Integrity check passes | False alarm, resume | 0 min |
| Single table | 1 table unreadable | Restore table from backup | 15-30 min |
| Multiple tables | 2-3 tables | Restore full database | 30-60 min |
| Complete | All queries fail | Restore from backup or IPFS | 1-4 hours |
| Unrecoverable | Backups also corrupt | Rebuild from IPFS | 4-24 hours |

---

## Recovery Procedures

### Path A: False Alarm (Schema Changes)

**Symptoms**: "table X already exists" or schema version mismatch

```bash
# Check schema version
sqlite3 .shadow-atlas/persistence.db "
SELECT * FROM sqlite_master WHERE type='table' AND name='schema_version';
"

# If migration pending
npx tsx -e "
import { ShadowAtlasRepository } from './persistence/repository.js';
import { SQLiteAdapter } from './persistence/adapters/sqlite.js';
const adapter = new SQLiteAdapter('.shadow-atlas/persistence.db');
// Run migrations if needed
"

# Verify integrity after migration
sqlite3 .shadow-atlas/persistence.db "PRAGMA integrity_check;"
```

**If integrity check passes**: Resume operations, false alarm.

---

### Path B: Partial Corruption (1-2 Tables)

**Symptoms**: Specific tables corrupted, others readable

**Step 1: Identify corrupted tables**

```bash
# Find which tables fail
for table in jobs extractions failures snapshots validation_results not_configured; do
  if ! sqlite3 .shadow-atlas/persistence.db "SELECT COUNT(*) FROM $table;" 2>/dev/null; then
    echo "CORRUPTED: $table"
  fi
done
```

**Step 2: Attempt SQLite recovery**

```bash
# SQLite has built-in recovery
sqlite3 .shadow-atlas/persistence.db ".recover" | sqlite3 .shadow-atlas/persistence.db.recovered

# Verify recovered database
sqlite3 .shadow-atlas/persistence.db.recovered "PRAGMA integrity_check;"

# If successful
if [ $? -eq 0 ]; then
  mv .shadow-atlas/persistence.db .shadow-atlas/persistence.db.corrupted.$(date +%s)
  mv .shadow-atlas/persistence.db.recovered .shadow-atlas/persistence.db
  echo "✓ Recovery successful"
else
  echo "✗ Recovery failed, proceeding to full restore"
fi
```

**Step 3: Selective table restore from backup**

```bash
# Export good tables from corrupted DB
for table in jobs extractions; do # Only export uncorrupted tables
  sqlite3 .shadow-atlas/persistence.db ".mode insert $table" ".output $table.sql" "SELECT * FROM $table;"
done

# Import from backup for corrupted tables
BACKUP_FILE=".shadow-atlas/backups/persistence-$(date -v-1d +%Y%m%d).db"

for table in failures snapshots; do # Import corrupted tables
  sqlite3 "$BACKUP_FILE" ".mode insert $table" ".output $table.sql" "SELECT * FROM $table;"
done

# Rebuild database
sqlite3 .shadow-atlas/persistence.db.new < schema.sql
cat *.sql | sqlite3 .shadow-atlas/persistence.db.new

# Verify
sqlite3 .shadow-atlas/persistence.db.new "PRAGMA integrity_check;"

# Replace if successful
mv .shadow-atlas/persistence.db .shadow-atlas/persistence.db.corrupted.$(date +%s)
mv .shadow-atlas/persistence.db.new .shadow-atlas/persistence.db
```

**Data loss**: Up to 24 hours (last backup)

---

### Path C: Complete Database Corruption

**Symptoms**: All queries fail, database unreadable

**Step 1: Identify latest valid backup**

```bash
# List available backups
ls -lt .shadow-atlas/backups/persistence-*.db | head -10

# Test each backup until we find a valid one
for backup in .shadow-atlas/backups/persistence-*.db; do
  echo "Testing $backup..."
  if sqlite3 "$backup" "PRAGMA integrity_check;" | grep -q "ok"; then
    echo "✓ Valid backup: $backup"
    LATEST_VALID_BACKUP="$backup"
    break
  else
    echo "✗ Corrupted: $backup"
  fi
done

if [ -z "$LATEST_VALID_BACKUP" ]; then
  echo "🚨 NO VALID BACKUPS FOUND - Escalate to Path D"
  exit 1
fi
```

**Step 2: Restore from backup**

```bash
# Verify backup integrity one more time
sqlite3 "$LATEST_VALID_BACKUP" "PRAGMA integrity_check;"
sqlite3 "$LATEST_VALID_BACKUP" "SELECT COUNT(*) FROM jobs;"
sqlite3 "$LATEST_VALID_BACKUP" "SELECT COUNT(*) FROM extractions;"

# Restore
mv .shadow-atlas/persistence.db .shadow-atlas/persistence.db.corrupted.$(date +%s)
cp "$LATEST_VALID_BACKUP" .shadow-atlas/persistence.db

# Verify restoration
sqlite3 .shadow-atlas/persistence.db "PRAGMA integrity_check;"
sqlite3 .shadow-atlas/persistence.db "
SELECT
  'jobs' as table, COUNT(*) as rows FROM jobs
  UNION SELECT 'extractions', COUNT(*) FROM extractions
  UNION SELECT 'snapshots', COUNT(*) FROM snapshots;
"
```

**Step 3: Assess data loss**

```bash
# Compare backup date to current
BACKUP_DATE=$(echo "$LATEST_VALID_BACKUP" | grep -oE '[0-9]{8}')
echo "Backup from: $BACKUP_DATE"
echo "Current date: $(date +%Y%m%d)"

# Check which jobs are missing
sqlite3 .shadow-atlas/persistence.db "
SELECT id, status, created_at
FROM jobs
WHERE created_at > '${BACKUP_DATE}'
ORDER BY created_at DESC;
"
```

**Data loss**: Depends on backup age (typically 24 hours)

**Post-restoration**:
1. Document data loss window
2. Notify affected users if applicable
3. Resume operations
4. Investigate root cause

---

### Path D: Unrecoverable (Rebuild from IPFS)

**Symptoms**: All backups corrupted, must rebuild from source of truth

**Step 1: Identify latest IPFS snapshot**

```bash
# If any backup readable, get snapshot CID
for backup in .shadow-atlas/backups/persistence-*.db; do
  if CID=$(sqlite3 "$backup" "SELECT ipfs_cid FROM snapshots WHERE deprecated_at IS NULL ORDER BY created_at DESC LIMIT 1;" 2>/dev/null); then
    echo "Latest snapshot CID: $CID"
    LATEST_CID="$CID"
    break
  fi
done

# If no backups readable, check IPFS pinning service
# (Manual lookup in Storacha dashboard)
```

**Step 2: Download snapshot from IPFS**

```bash
# Using Storacha
npx tsx -e "
import { StorachaClient } from '@storacha/client';
const client = new StorachaClient({
  principal: process.env.STORACHA_DID,
  proof: process.env.STORACHA_PROOF,
});

const cid = '${LATEST_CID}';
const data = await client.get(cid);
console.log('Downloaded snapshot:', data);
"
```

**Step 3: Rebuild database from snapshot**

```bash
# Re-initialize empty database
rm .shadow-atlas/persistence.db
npx tsx -e "
import { ShadowAtlasRepository } from './persistence/repository.js';
import { SQLiteAdapter } from './persistence/adapters/sqlite.js';

// Create fresh database with schema
const adapter = new SQLiteAdapter('.shadow-atlas/persistence.db');
// Schema auto-created on first access
"

# Import snapshot data
# (Implementation depends on snapshot format)
# TODO: Implement snapshot import function

# Create rebuild job record
sqlite3 .shadow-atlas/persistence.db "
INSERT INTO jobs (id, scope_states, scope_layers, status, created_at, updated_at)
VALUES (
  'job_rebuild_$(date +%s)',
  '[]',
  '[]',
  'completed',
  datetime('now'),
  datetime('now')
);
"
```

**Step 4: Validate rebuilt database**

```bash
# Integrity check
sqlite3 .shadow-atlas/persistence.db "PRAGMA integrity_check;"

# Data completeness
sqlite3 .shadow-atlas/persistence.db "
SELECT
  COUNT(DISTINCT state_code) as states,
  COUNT(DISTINCT layer_type) as layers,
  COUNT(*) as total_boundaries
FROM extractions;
"

# Compare to expected counts
# (See registry/official-district-counts.ts)
```

**Data loss**: Only data newer than last IPFS snapshot (typically quarterly)

**Recovery time**: 4-24 hours (depends on snapshot size and network)

---

## Root Cause Investigation

### Common Causes

1. **Unclean shutdown**
   - Process killed during write transaction
   - Power loss
   - OOM killer

2. **Filesystem corruption**
   - Disk failure
   - Filesystem bugs
   - Storage driver issues

3. **SQLite bugs** (rare)
   - Concurrent writes without WAL mode
   - File locking issues on network filesystems

4. **Application bugs**
   - Transaction management errors
   - Schema migrations gone wrong

### Investigation Steps

```bash
# Check system logs
dmesg | grep -i error | tail -50
tail -100 /var/log/system.log | grep -i sqlite

# Check disk health
diskutil info /dev/disk0 | grep SMART

# Check filesystem
diskutil verifyVolume /

# Check recent crashes
ls -lt ~/Library/Logs/DiagnosticReports/ | head -10

# Check Node.js/process crashes
ls -lt crash-*.log 2>/dev/null
```

### Prevention Analysis

**Questions to answer**:
- Was shutdown graceful?
- Were there active transactions?
- Is WAL mode enabled?
- Is filesystem healthy?
- Were there concurrent writers?
- Is database on network filesystem? (Don't do this!)

---

## Prevention Measures

### Immediate (Implement Today)

```bash
# Enable WAL mode (CRITICAL)
sqlite3 .shadow-atlas/persistence.db "PRAGMA journal_mode=WAL;"
sqlite3 .shadow-atlas/metrics.db "PRAGMA journal_mode=WAL;"

# Verify
sqlite3 .shadow-atlas/persistence.db "PRAGMA journal_mode;"
# Should output: wal
```

### Short-term (This Week)

**Graceful shutdown handler**:
```typescript
// services/batch-orchestrator.ts
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, graceful shutdown initiated');
  await orchestrator.shutdown(); // Wait for active jobs
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, graceful shutdown initiated');
  await orchestrator.shutdown();
  process.exit(0);
});
```

**Daily backup verification**:
```bash
# Add to cron
#!/bin/bash
# ops/scripts/verify-backups.sh
BACKUP_FILE=".shadow-atlas/backups/persistence-$(date +%Y%m%d).db"
if sqlite3 "$BACKUP_FILE" "PRAGMA integrity_check;" | grep -q "ok"; then
  echo "✓ Backup valid: $BACKUP_FILE"
else
  echo "✗ Backup corrupted: $BACKUP_FILE"
  # Alert ops team
fi
```

### Long-term (This Month)

1. **Automated pre-deployment checks**:
   ```bash
   # In CI/CD pipeline
   sqlite3 .shadow-atlas/persistence.db "PRAGMA integrity_check;"
   ```

2. **PostgreSQL migration evaluation**:
   - Better concurrency handling
   - Better corruption resistance
   - More mature tooling

3. **Replication**:
   - Streaming replication to standby
   - Point-in-time recovery capability

4. **Monitoring**:
   - Database size monitoring
   - Transaction duration monitoring
   - Lock contention alerts

---

## Testing Recovery Procedures

**Practice corruption recovery quarterly**:

```bash
# Corruption drill (TEST ENVIRONMENT ONLY)
# Step 1: Corrupt test database
dd if=/dev/random of=.shadow-atlas/persistence.db bs=1024 count=1 seek=100 conv=notrunc

# Step 2: Detect corruption
sqlite3 .shadow-atlas/persistence.db "PRAGMA integrity_check;"
# Should fail

# Step 3: Execute recovery procedure
# Follow Path C above

# Step 4: Verify recovery
# Confirm database operational

# Step 5: Time the exercise
# Goal: <30 minutes for Path C
```

---

## Escalation

**Escalate immediately if**:
- All backups corrupted (Path D)
- Recovery taking >2 hours
- Data loss >24 hours
- Unsure which recovery path to take

**Escalation checklist**:
- [ ] Emergency backups created
- [ ] Corruption scope assessed
- [ ] Latest valid backup identified
- [ ] Data loss window estimated
- [ ] Recovery path selected

**Escalation template**:
```markdown
🚨 @tech-lead - Database corruption P0 escalation

**Corruption Scope**: [Single table / Multiple tables / Complete]
**Tables Affected**: [List]
**Latest Valid Backup**: [Date/time]
**Data Loss Window**: [Duration]

**Recovery Status**:
- ✅ Emergency backups created
- ✅ Corruption assessed
- ⏳ Recovery in progress: [Path A/B/C/D]
- ⏳ ETA: [Time estimate]

**Blockers**: [If any]
**Need**: [Database expertise / Decision on data loss tolerance / etc.]
```

---

## Success Criteria

- [ ] `PRAGMA integrity_check` returns "ok"
- [ ] All critical tables queryable
- [ ] Row counts match expectations
- [ ] Latest snapshot retrievable
- [ ] No data loss beyond acceptable RPO (24h)
- [ ] Service operational
- [ ] Root cause identified
- [ ] Prevention measures implemented

---

## Post-Recovery Checklist

### Immediate (Within 1 hour)
- [ ] Service restored and operational
- [ ] Integrity verified
- [ ] Users notified of service restoration
- [ ] Data loss window documented

### Short-term (Within 24 hours)
- [ ] Root cause identified
- [ ] Incident report drafted
- [ ] Prevention tasks created
- [ ] Team notified

### Long-term (Within 1 week)
- [ ] Post-incident review completed
- [ ] Runbook updated with lessons learned
- [ ] Prevention measures implemented
- [ ] Backup/recovery procedures tested

---

**Related Runbooks**:
- [Incident Response](../incident-response.md)
- Backup & Restore (TBD)
- Merkle Tree Rebuild (TBD)

**Last Updated**: 2025-12-18
