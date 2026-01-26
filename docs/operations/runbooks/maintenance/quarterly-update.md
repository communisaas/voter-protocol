# Quarterly Shadow Atlas Update Procedure

**Frequency**: Quarterly (aligned with Census TIGER releases)
**Duration**: 12-24 hours
**Coordination**: Requires ops + engineering coordination
**Risk Level**: Medium (new data integration)

---

## Overview

Shadow Atlas must be updated quarterly to reflect:
- New district boundaries (redistricting)
- Census TIGER data updates
- Municipal boundary changes
- Registry corrections from community feedback

**Census TIGER Release Schedule**:
- **Q1**: February (Winter release)
- **Q2**: May (Spring release)
- **Q3**: August (Summer release)
- **Q4**: November (Fall release)

---

## Pre-Update Checklist (1 Week Before)

### Week Before Update

- [ ] **Check Census TIGER release notes**
  ```bash
  # Visit https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html
  # Check "What's New" for latest release
  ```

- [ ] **Verify infrastructure capacity**
  ```bash
  # Check disk space (need ~20GB free for full extraction)
  df -h .shadow-atlas/

  # Check database size
  ls -lh .shadow-atlas/persistence.db

  # Clean up if needed
  sqlite3 .shadow-atlas/persistence.db "VACUUM;"
  ```

- [ ] **Test extraction on sample states**
  ```bash
  # Test 3 states: small (WY), medium (CO), large (CA)
  npx tsx -e "
  import { BatchOrchestrator } from './services/batch-orchestrator.js';
  const orch = new BatchOrchestrator();
  const result = await orch.orchestrateStates(
    ['WY', 'CO', 'CA'],
    ['congressional', 'state_senate', 'state_house'],
    { validateAfterExtraction: true }
  );
  console.log('Test extraction:', result.status);
  console.log('Success rate:', result.statistics.successRate);
  "

  # Expected: >95% success rate
  ```

- [ ] **Review registry updates**
  ```bash
  # Check for pending registry updates from GitHub issues
  gh issue list --label "registry-update"

  # Apply approved updates to registry files
  ```

- [ ] **Backup current production snapshot**
  ```bash
  # Create safety backup
  cp .shadow-atlas/persistence.db .shadow-atlas/backups/persistence-pre-q$(date +%q)$(date +%Y).db

  # Verify backup
  sqlite3 .shadow-atlas/backups/persistence-pre-q$(date +%q)$(date +%Y).db "PRAGMA integrity_check;"
  ```

- [ ] **Schedule maintenance window**
  - Notify users via status page
  - Block calendar for 24-hour window
  - Prepare rollback plan

---

## Day of Update: Execution Steps

### Phase 1: Preparation (Hour 0-1)

**Step 1: Final backup**
```bash
# Emergency backup of current state
timestamp=$(date +%s)
cp .shadow-atlas/persistence.db .shadow-atlas/persistence.db.pre-update.$timestamp
cp .shadow-atlas/metrics.db .shadow-atlas/metrics.db.pre-update.$timestamp

# Verify backups
sqlite3 .shadow-atlas/persistence.db.pre-update.$timestamp "PRAGMA integrity_check;"
```

**Step 2: Stop non-critical services**
```bash
# Stop any running extractions
pkill -f "batch-orchestrator"

# Verify no active jobs
npx tsx -e "
import { BatchOrchestrator } from './services/batch-orchestrator.js';
const jobs = await new BatchOrchestrator().listJobs(10);
const running = jobs.filter(j => j.status === 'running');
console.log('Running jobs:', running.length);
"
```

**Step 3: Create update job record**
```bash
# Track this update as a job
npx tsx -e "
import { BatchOrchestrator } from './services/batch-orchestrator.js';
const orch = new BatchOrchestrator();

const jobId = \`job_quarterly_update_\${Date.now()}\`;
console.log('Created update job:', jobId);
process.env.UPDATE_JOB_ID = jobId;
" > /tmp/update-job-id.txt

export UPDATE_JOB_ID=$(cat /tmp/update-job-id.txt | grep "job_quarterly_update")
echo "Update Job ID: $UPDATE_JOB_ID"
```

---

### Phase 2: Full Extraction (Hour 1-8)

**Step 4: Extract all 50 states**

```bash
# Full extraction with validation
npx tsx scripts/extract-all-states.ts \
  --validate \
  --concurrency 3 \
  --job-id "$UPDATE_JOB_ID" \
  | tee extraction-log-$(date +%Y%m%d).txt

# Monitor progress
watch -n 60 "tail -20 extraction-log-$(date +%Y%m%d).txt"
```

**Expected duration**: 6-8 hours (depends on provider responsiveness)

**Monitor for**:
- Extraction success rate >90%
- No provider outages
- Validation pass rate >95%

**If issues occur**:
- Check [Upstream Provider Failure](../common-incidents/upstream-failure.md) runbook
- Consider pausing and resuming during off-peak hours

---

### Phase 3: Validation (Hour 8-10)

**Step 5: Cross-validate against TIGER**

```bash
# Run comprehensive validation
npx tsx -e "
import { TIGERValidator } from './validators/tiger-validator.js';
import { DataValidator } from './services/data-validator.js';

const validator = new DataValidator({
  validators: [new TIGERValidator()],
});

const result = await validator.validateJob('${UPDATE_JOB_ID}');
console.log('Validation results:');
console.log('  Total validations:', result.totalValidations);
console.log('  Passed:', result.passed);
console.log('  Failed:', result.failed);
console.log('  Pass rate:', (result.passed / result.totalValidations * 100).toFixed(1), '%');

// Fail if pass rate <90%
if (result.passed / result.totalValidations < 0.90) {
  throw new Error('Validation pass rate too low, aborting update');
}
"
```

**Step 6: Review validation failures**

```bash
# Identify states with validation issues
sqlite3 .shadow-atlas/persistence.db "
SELECT
  e.state_code,
  e.layer_type,
  vr.validator_type,
  vr.expected_count,
  vr.actual_count,
  vr.discrepancies
FROM validation_results vr
JOIN extractions e ON e.id = vr.extraction_id
WHERE vr.passed = 0
  AND e.job_id = '${UPDATE_JOB_ID}'
ORDER BY e.state_code, e.layer_type;
"

# Investigate and resolve failures
# See ../common-incidents/ runbooks for guidance
```

**Decision point**: If >10% validation failures, STOP and investigate.

---

### Phase 4: Merkle Tree Build (Hour 10-12)

**Step 7: Build Merkle tree**

```bash
# Build new Merkle tree from validated extractions
npx tsx -e "
import { buildMerkleTree } from './integration/state-batch-to-merkle.js';

console.log('Building Merkle tree...');
const tree = await buildMerkleTree({
  jobId: '${UPDATE_JOB_ID}',
  validateTree: true,
});

console.log('Merkle tree built:');
console.log('  Root:', tree.root);
console.log('  Leaf count:', tree.leafCount);
console.log('  Depth:', tree.depth);
" | tee merkle-build-$(date +%Y%m%d).txt
```

**Step 8: Verify Merkle tree integrity**

```bash
# Generate test proofs for random samples
npx tsx -e "
import { generateTestProofs } from './integration/test-proof-generator.js';

const samples = [
  { state: 'CA', district: '12' },
  { state: 'TX', district: '15' },
  { state: 'NY', district: '10' },
  { state: 'WY', district: '1' },
];

for (const sample of samples) {
  const proof = await generateTestProofs(sample);
  console.log(\`\${sample.state}-\${sample.district}: \${proof.valid ? '✓' : '✗'}\`);
}
"
```

**All test proofs must pass** before proceeding.

---

### Phase 5: IPFS Publishing (Hour 12-14)

**Step 9: Upload snapshot to IPFS**

```bash
# Create snapshot metadata
npx tsx -e "
import { createSnapshot } from './integration/snapshot-creator.js';

const snapshot = await createSnapshot({
  jobId: '${UPDATE_JOB_ID}',
  merkleRoot: '${MERKLE_ROOT}',
  quarter: 'Q$(date +%q)-$(date +%Y)',
});

console.log('Snapshot created:', snapshot.id);
process.env.SNAPSHOT_ID = snapshot.id;
" > /tmp/snapshot-id.txt

export SNAPSHOT_ID=$(cat /tmp/snapshot-id.txt | grep "snapshot_")
```

**Step 10: Pin to IPFS**

```bash
# Upload to Storacha
npx tsx -e "
import { uploadSnapshotToIPFS } from './integration/ipfs-uploader.js';

const cid = await uploadSnapshotToIPFS('${SNAPSHOT_ID}');
console.log('Snapshot pinned to IPFS:', cid);

// Verify retrieval
const data = await fetch(\`https://w3s.link/ipfs/\${cid}\`);
console.log('Retrieval test:', data.ok ? '✓' : '✗');
" | tee ipfs-upload-$(date +%Y%m%d).txt

export IPFS_CID=$(grep "Snapshot pinned" ipfs-upload-$(date +%Y%m%d).txt | awk '{print $NF}')
```

**Step 11: Update database with IPFS CID**

```bash
sqlite3 .shadow-atlas/persistence.db "
UPDATE snapshots
SET ipfs_cid = '${IPFS_CID}',
    updated_at = datetime('now')
WHERE id = '${SNAPSHOT_ID}';

-- Verify
SELECT id, ipfs_cid, merkle_root FROM snapshots WHERE id = '${SNAPSHOT_ID}';
"
```

---

### Phase 6: Cutover (Hour 14-15)

**Step 12: Deprecate old snapshot**

```bash
# Mark previous snapshot as deprecated
sqlite3 .shadow-atlas/persistence.db "
UPDATE snapshots
SET deprecated_at = datetime('now')
WHERE deprecated_at IS NULL
  AND id != '${SNAPSHOT_ID}';

-- Verify only new snapshot active
SELECT id, deprecated_at FROM snapshots ORDER BY created_at DESC LIMIT 5;
"
```

**Step 13: Smoke test with new snapshot**

```bash
# Generate proofs using new snapshot
npx tsx -e "
import { ShadowAtlasService } from './core/shadow-atlas-service.js';

const service = new ShadowAtlasService();

// Test proof generation for multiple addresses
const testCases = [
  { lat: 37.7749, lng: -122.4194, expectedDistrict: 'CA-12' },
  { lat: 30.2672, lng: -97.7431, expectedDistrict: 'TX-21' },
];

for (const test of testCases) {
  const proof = await service.generateProof(test.lat, test.lng);
  console.log(\`Test \${test.expectedDistrict}: \${proof ? '✓' : '✗'}\`);
}
"
```

**All smoke tests must pass.**

---

### Phase 7: Monitoring & Rollback Readiness (Hour 15-24)

**Step 14: Enable enhanced monitoring**

```bash
# Monitor proof generation success rate
sqlite3 .shadow-atlas/metrics.db "
SELECT
  COUNT(*) as total_proofs,
  SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END) as successful,
  SUM(CASE WHEN value = 0 THEN 1 ELSE 0 END) as failed,
  ROUND(100.0 * SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate_pct
FROM metrics
WHERE type = 'proof_generation'
  AND recorded_at >= datetime('now', '-1 hour');
"

# Expected: >98% success rate
```

**Step 15: Monitor for anomalies**

Watch for 24 hours:
- [ ] Proof generation success rate >95%
- [ ] IPFS retrieval success rate >98%
- [ ] No increase in error rates
- [ ] User reports normal

**If issues detected**:
- Execute rollback procedure (see below)
- Investigate before retry

---

## Rollback Procedure

**Trigger conditions**:
- Proof generation success rate <90%
- IPFS retrieval failures >5%
- Critical data corruption detected
- User-reported proof failures

**Rollback steps** (15 minutes):

```bash
# Step 1: Reactivate previous snapshot
sqlite3 .shadow-atlas/persistence.db "
-- Find previous snapshot
SELECT id, ipfs_cid FROM snapshots
WHERE deprecated_at IS NOT NULL
ORDER BY deprecated_at DESC
LIMIT 1;

-- Reactivate it
UPDATE snapshots
SET deprecated_at = NULL
WHERE id = '${PREVIOUS_SNAPSHOT_ID}';

-- Deprecate new snapshot
UPDATE snapshots
SET deprecated_at = datetime('now')
WHERE id = '${SNAPSHOT_ID}';
"

# Step 2: Verify rollback
npx tsx -e "
import { ShadowAtlasService } from './core/shadow-atlas-service.js';
const service = new ShadowAtlasService();
const snapshot = await service.getCurrentSnapshot();
console.log('Active snapshot:', snapshot.id);
console.log('IPFS CID:', snapshot.ipfsCID);
"

# Step 3: Test proof generation
npx tsx -e "
import { ShadowAtlasService } from './core/shadow-atlas-service.js';
const service = new ShadowAtlasService();
const proof = await service.generateProof(37.7749, -122.4194);
console.log('Proof generation after rollback:', proof ? '✓' : '✗');
"

# Step 4: Announce rollback
echo "🔄 Quarterly update rolled back to previous snapshot. Investigating issues."
```

**Post-rollback**:
1. Investigate root cause
2. Fix issues
3. Re-run validation
4. Retry quarterly update

---

## Post-Update Verification (24 Hours After)

### Success Metrics

```bash
# Check proof generation metrics
sqlite3 .shadow-atlas/metrics.db "
SELECT
  date(recorded_at) as date,
  COUNT(*) as proofs,
  ROUND(100.0 * SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate
FROM metrics
WHERE type = 'proof_generation'
  AND recorded_at >= datetime('now', '-7 days')
GROUP BY date
ORDER BY date DESC;
"

# Expected: Success rate >95% stable
```

### Data Quality Checks

```bash
# Verify boundary counts
sqlite3 .shadow-atlas/persistence.db "
SELECT
  COUNT(DISTINCT state_code) as states,
  COUNT(DISTINCT layer_type) as layers,
  COUNT(*) as total_boundaries
FROM extractions
WHERE job_id = '${UPDATE_JOB_ID}';
"

# Expected:
# states: 50+
# layers: 3 (congressional, state_senate, state_house)
# total_boundaries: ~10,000-15,000
```

### User Impact Assessment

```bash
# Check user-reported issues
gh issue list --label "quarterly-update,bug" --created ">=2025-12-18"

# Expected: 0 critical bugs
```

---

## Post-Update Cleanup (1 Week After)

### Deprecate Old Data

```bash
# Archive old extractions (keep job records)
sqlite3 .shadow-atlas/persistence.db "
-- Mark old extractions for archival
UPDATE extractions
SET archived_at = datetime('now')
WHERE job_id IN (
  SELECT id FROM jobs
  WHERE created_at < datetime('now', '-90 days')
);
"
```

### Update Documentation

- [ ] Update CHANGELOG with quarterly release notes
- [ ] Document any registry changes
- [ ] Update known issues list
- [ ] Post update summary in GitHub Discussions

### Generate Update Report

```bash
# Create quarterly update summary
npx tsx -e "
import { generateUpdateReport } from './ops/scripts/update-report-generator.js';

const report = await generateUpdateReport({
  jobId: '${UPDATE_JOB_ID}',
  snapshotId: '${SNAPSHOT_ID}',
  quarter: 'Q$(date +%q)-$(date +%Y)',
});

console.log(report);
" > quarterly-update-Q$(date +%q)$(date +%Y)-report.md
```

**Report contents**:
- States extracted: 50/50
- Validation pass rate: 98.2%
- New boundaries: +245
- Removed boundaries: -18
- Registry updates: 12
- Issues resolved: 8
- Known issues: 2

---

## Automation Opportunities

### Future Improvements

1. **Automated Census TIGER monitoring**
   - Poll Census API for new releases
   - Automatically trigger test extractions
   - Alert ops team when new data available

2. **Incremental updates**
   - Only re-extract changed states
   - Incremental Merkle tree updates
   - Reduce update window to 4-6 hours

3. **Canary deployments**
   - Deploy new snapshot to 5% of users
   - Monitor metrics
   - Gradual rollout if successful

4. **Automated rollback**
   - Detect anomalies automatically
   - Auto-rollback if metrics degrade
   - Alert ops team of rollback

---

## Coordination Checklist

### 1 Week Before
- [ ] Check Census TIGER release notes
- [ ] Test sample extractions
- [ ] Review pending registry updates
- [ ] Schedule maintenance window
- [ ] Notify users via status page

### Day Before
- [ ] Final backup verification
- [ ] Confirm provider availability
- [ ] Review runbook with team
- [ ] Prepare rollback plan

### Day Of
- [ ] Emergency backups created
- [ ] Full extraction completed
- [ ] Validation passed (>90%)
- [ ] Merkle tree built and tested
- [ ] IPFS snapshot uploaded
- [ ] Cutover completed
- [ ] Smoke tests passed

### 24 Hours After
- [ ] Metrics stable
- [ ] No user-reported issues
- [ ] Rollback plan ready if needed

### 1 Week After
- [ ] Data cleanup completed
- [ ] Update report published
- [ ] Documentation updated
- [ ] Lessons learned documented

---

## Lessons Learned Log

**Q1 2025**:
- Provider outage during extraction → Add provider health pre-check
- Validation failures from registry staleness → Automate registry updates
- IPFS upload slow → Implement parallel chunk uploads

**Q2 2025**:
- [To be filled after Q2 update]

---

**Related Documents**:
- [Upstream Provider Failure](../common-incidents/upstream-failure.md)
- [Data Corruption](../common-incidents/data-corruption.md)
- [IPFS Unavailable](../common-incidents/ipfs-unavailable.md)

**Last Updated**: 2025-12-18
**Next Review**: Before Q1 2026 update
