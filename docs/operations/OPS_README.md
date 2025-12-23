# Shadow Atlas Operations Guide

**Version**: 1.0
**Last Updated**: 2025-12-18
**Audience**: Operations team, SRE, on-call engineers

---

## Quick Reference

**Production Environment**: `/Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas`

**Key Contacts**:
- On-Call Rotation: PagerDuty `shadow-atlas-primary`
- Tech Lead: @tech-lead (Slack)
- Team Channel: #shadow-atlas

**Critical Links**:
- [On-Call Guide](on-call-guide.md) - **START HERE if you're on-call**
- [Incident Response](runbooks/incident-response.md)
- [Runbooks Directory](runbooks/)
- [Monitoring Dashboard](#monitoring)

---

## Service Overview

**Shadow Atlas** provides cryptographically-verifiable geographic boundary data for zero-knowledge proof generation in VOTER Protocol.

**What it does**:
- Extracts electoral district boundaries from 50+ data sources
- Validates data against authoritative sources (Census TIGER)
- Builds Merkle trees for ZK proof verification
- Publishes quarterly snapshots to IPFS
- Serves boundary data for proof generation

**Why it matters**:
- **Critical path**: Proof generation completely depends on Shadow Atlas
- **User impact**: If Shadow Atlas down → Users cannot prove district membership → No congressional messaging
- **Data integrity**: Incorrect boundaries = invalid proofs = broken trust
- **Availability SLA**: 99.9% uptime target

---

## Architecture at a Glance

```
Data Sources (External)
  ├─ Census TIGER (congressional districts)
  ├─ ArcGIS Hub (~35 states)
  └─ State GIS Portals (~50 states)
        ↓
  [Shadow Atlas Extraction]
        ↓
  [Validation & Cross-checking]
        ↓
  [Merkle Tree Construction]
        ↓
  [IPFS Publishing via Storacha]
        ↓
  [ZK Proof Generation] ← Users generate proofs here
```

**Key components**:
- **Providers**: External data sources (TIGER, ArcGIS Hub, state portals)
- **Extractors**: Fetch and parse boundary data
- **Validators**: Cross-check against authoritative sources
- **Orchestrator**: Coordinate multi-state extraction jobs
- **Persistence**: SQLite database for job state and snapshots
- **IPFS**: Decentralized storage for published snapshots

---

## Service Dependencies

### External Dependencies

| Service | Purpose | Impact if Down | Mitigation |
|---------|---------|----------------|------------|
| **Census TIGER** | Congressional districts (canonical) | P1 - No congressional data | None (wait for recovery) |
| **ArcGIS Hub** | State/local districts | P1 - 35 states affected | Use state portals |
| **State GIS Portals** | State-specific data | P2 - Single state affected | Use ArcGIS Hub fallback |
| **Storacha (IPFS)** | Snapshot hosting | P1 - Proofs fail | Local cache, alternative gateways |
| **IPFS Gateways** | Snapshot retrieval | P1 - Proofs fail | Multiple gateway fallback |

### Internal Dependencies

| Component | Purpose | Impact if Corrupt |
|-----------|---------|------------------|
| **persistence.db** | Job state, extractions, snapshots | P0 - Service down |
| **metrics.db** | Metrics and alerts | P2 - Blind to issues |
| **Merkle tree** | Proof verification | P0 - All proofs fail |
| **IPFS snapshots** | Source of truth for proofs | P0 - All proofs fail |

---

## Operational Procedures

### Daily Operations

**Automated (no action required)**:
- ✅ Daily health checks (09:00 UTC via cron)
- ✅ Database integrity checks (daily)
- ✅ Provider health monitoring (every 30 min)
- ✅ Backup creation (daily at 02:00 UTC)

**Manual checks (recommended)**:
```bash
# Morning sanity check (5 minutes)
cd /Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas

# 1. Health overview
npx tsx observability/cli.ts health-check

# 2. Check for alerts
sqlite3 .shadow-atlas/metrics.db "SELECT * FROM alerts WHERE status='firing';"

# 3. Recent jobs
npx tsx -e "import {BatchOrchestrator} from './services/batch-orchestrator.js'; console.table(await new BatchOrchestrator().listJobs(5));"

# All green? You're done. Issues? See runbooks.
```

---

### Weekly Operations

**Every Monday** (15 minutes):
- [ ] Review weekly metrics report
  ```bash
  ops/scripts/weekly-report.sh
  ```
- [ ] Check disk space (should be <80%)
  ```bash
  df -h .shadow-atlas/
  ```
- [ ] Review and close resolved incidents
  ```bash
  gh issue list --label "incident,ops" --state open
  ```
- [ ] Update on-call rotation in PagerDuty if needed

---

### Monthly Operations

**First Monday of month** (1 hour):
- [ ] Review provider registry for staleness
  ```bash
  npx tsx -e "
  import { STATE_GIS_PORTALS } from './registry/state-gis-portals.js';
  // Check for entries >365 days old
  "
  ```
- [ ] Verify backup integrity
  ```bash
  ops/scripts/verify-backups.sh
  ```
- [ ] Review and close stale incidents
- [ ] Archive old metrics (>90 days)
  ```bash
  sqlite3 .shadow-atlas/metrics.db "DELETE FROM metrics WHERE recorded_at < datetime('now', '-90 days');"
  ```

---

### Quarterly Operations

**Quarterly data update** (1-2 days):
- [ ] Schedule maintenance window
- [ ] Follow [Quarterly Update Procedure](runbooks/maintenance/quarterly-update.md)
- [ ] Expected: 12-24 hours for full US extraction
- [ ] Validate new snapshot before cutover
- [ ] Monitor for 24 hours post-update

**Schedule**:
- Q1: February (Census winter release)
- Q2: May (Census spring release)
- Q3: August (Census summer release)
- Q4: November (Census fall release)

---

## Monitoring

### Key Metrics

**Service Health**:
```sql
-- Check recent health status
SELECT
  type,
  AVG(value) as avg_value,
  COUNT(*) as data_points
FROM metrics
WHERE recorded_at >= datetime('now', '-1 hour')
  AND type IN ('extraction_success', 'validation_pass', 'provider_availability')
GROUP BY type;
```

**Alert Thresholds**:
- Extraction success rate <80% → Critical
- Validation pass rate <80% → Critical
- Provider availability <95% → Warning
- Job duration >120s → Warning
- Disk usage >90% → Critical

### Monitoring Dashboard

**If Grafana deployed**:
```bash
open "https://grafana.voter.protocol/d/shadow-atlas"
```

**Otherwise (CLI monitoring)**:
```bash
# Real-time metrics
watch -n 10 "npx tsx observability/cli.ts health-check"

# Alert status
watch -n 30 "sqlite3 .shadow-atlas/metrics.db 'SELECT * FROM alerts WHERE status=\"firing\";'"
```

---

## Common Tasks

### Restart a Failed Job

```bash
# Find failed job
npx tsx -e "
import { BatchOrchestrator } from './services/batch-orchestrator.js';
const orch = new BatchOrchestrator();
const jobs = await orch.listJobs(20);
const failed = jobs.filter(j => j.status === 'partial' || j.status === 'failed');
console.table(failed);
"

# Resume job
export JOB_ID="job_abc123"
npx tsx -e "
import { BatchOrchestrator } from './services/batch-orchestrator.js';
const result = await new BatchOrchestrator().resumeJob('${JOB_ID}');
console.log('Resumed:', result.status);
"
```

### Check Provider Health

```bash
# Quick provider test
ops/scripts/provider-health-check.sh

# Or manually
curl -sf -m 10 "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer" && echo "✓ TIGER OK" || echo "✗ TIGER DOWN"
```

### Verify Latest Snapshot

```bash
# Get latest snapshot
LATEST=$(sqlite3 .shadow-atlas/persistence.db "
SELECT ipfs_cid FROM snapshots
WHERE deprecated_at IS NULL
ORDER BY created_at DESC
LIMIT 1;
")

# Test retrieval
curl -sf -m 30 "https://w3s.link/ipfs/$LATEST" && echo "✓ Snapshot accessible" || echo "✗ IPFS retrieval failed"
```

### Create Manual Backup

```bash
ops/scripts/emergency-backup.sh
```

### Rollback Snapshot

```bash
# List recent snapshots
sqlite3 .shadow-atlas/persistence.db "
SELECT id, ipfs_cid, created_at, deprecated_at
FROM snapshots
ORDER BY created_at DESC
LIMIT 5;
"

# Rollback to previous
ops/scripts/rollback.sh <snapshot_id>
```

---

## Incident Response

**When alerts fire**:

1. **Acknowledge** (within 5 min) → PagerDuty
2. **Assess** (within 15 min) → Run health check
3. **Find runbook** → See [Runbooks Directory](runbooks/)
4. **Mitigate** → Follow runbook steps
5. **Communicate** → Post status updates
6. **Document** → Record actions taken

**Severity guide**:
- **P0** (Critical): Service down, data loss → 15 min SLA
- **P1** (High): Degraded service → 1 hour SLA
- **P2** (Medium): Partial impact → 4 hour SLA
- **P3** (Low): Minor issue → Next business day

**Full guide**: [Incident Response Runbook](runbooks/incident-response.md)

---

## Runbook Index

### Incident Response
- [Main Incident Response](runbooks/incident-response.md)
- [On-Call Guide](on-call-guide.md)

### Common Incidents
- [High Latency](runbooks/common-incidents/high-latency.md)
- [Error Rate Spike](runbooks/common-incidents/error-rate.md) (TBD)
- [Data Corruption](runbooks/common-incidents/data-corruption.md)
- [Upstream Provider Failure](runbooks/common-incidents/upstream-failure.md)
- [IPFS Unavailable](runbooks/common-incidents/ipfs-unavailable.md)
- [Memory Exhaustion](runbooks/common-incidents/memory-exhaustion.md) (TBD)

### Maintenance Procedures
- [Quarterly Update](runbooks/maintenance/quarterly-update.md)
- [Merkle Tree Rebuild](runbooks/maintenance/merkle-rebuild.md) (TBD)
- [Cache Invalidation](runbooks/maintenance/cache-invalidation.md) (TBD)
- [Backup & Restore](runbooks/maintenance/backup-restore.md) (TBD)
- [Scaling Guide](runbooks/maintenance/scaling.md) (TBD)

### Monitoring
- [Dashboard Guide](runbooks/monitoring/dashboard-guide.md) (TBD)
- [Alert Response](runbooks/monitoring/alert-response.md) (TBD)
- [Metrics Reference](runbooks/monitoring/metrics-reference.md) (TBD)

---

## Scripts Reference

All operational scripts located in `ops/scripts/`:

| Script | Purpose | Usage |
|--------|---------|-------|
| `health-check.sh` | Quick health verification | `ops/scripts/health-check.sh` |
| `metrics-snapshot.sh` | Capture current metrics | `ops/scripts/metrics-snapshot.sh` |
| `emergency-backup.sh` | Create immediate backup | `ops/scripts/emergency-backup.sh` |
| `rollback.sh` | Rollback to previous snapshot | `ops/scripts/rollback.sh <snapshot_id>` |
| `provider-health-check.sh` | Test all providers | `ops/scripts/provider-health-check.sh` |
| `verify-backups.sh` | Verify backup integrity | `ops/scripts/verify-backups.sh` |
| `weekly-report.sh` | Generate weekly metrics | `ops/scripts/weekly-report.sh` |

---

## Escalation Paths

```
Level 0: Automated Alerts
    ↓
Level 1: Primary On-Call Engineer
    ↓ (if >30min for P0, >2h for P1)
Level 2: Secondary On-Call / Tech Lead
    ↓ (if >1h for P0, data loss, security)
Level 3: CTO / Engineering Leadership
```

**Contact Information**:
- **Primary On-Call**: PagerDuty rotation `shadow-atlas-primary`
- **Tech Lead**: @tech-lead (Slack), [PHONE REDACTED]
- **CTO**: @cto (Slack), [PHONE REDACTED]
- **Security**: security@voter.protocol

---

## Configuration Management

### Environment Variables

Required in production:
```bash
# IPFS/Storacha
export STORACHA_DID="did:key:..."
export STORACHA_PROOF="..."

# Optional
export LOG_LEVEL="info"
export DATABASE_PATH=".shadow-atlas/persistence.db"
```

### File Locations

```
.shadow-atlas/
├── persistence.db          # Main database (job state, extractions)
├── metrics.db             # Metrics and alerts
├── backups/               # Daily backups
│   ├── persistence-YYYYMMDD.db
│   └── metrics-YYYYMMDD.db
└── jobs/                  # Job state files (if using file-based)
    └── job_abc123.json
```

### Database Schema

**Key tables**:
- `jobs`: Extraction job records
- `extractions`: Individual state/layer extractions
- `failures`: Failed extraction attempts
- `snapshots`: Published IPFS snapshots
- `validation_results`: Validation outcomes
- `not_configured`: Known gaps in coverage

**Metrics tables**:
- `metrics`: Time-series metrics
- `alerts`: Alert state

---

## Capacity Planning

### Current Capacity (as of Q4 2024)

- **States supported**: 50 (US)
- **Layers per state**: 3 (congressional, state_senate, state_house)
- **Total boundaries**: ~10,000-15,000
- **Database size**: ~1-2 GB
- **IPFS snapshots**: ~50-100 MB each
- **Extraction time**: 6-8 hours (full 50 states)

### Scaling Considerations

**When to scale up**:
- Database >5 GB → Consider PostgreSQL migration
- Extraction time >12 hours → Increase concurrency or optimize
- Disk usage >80% → Add storage or archive old data
- Memory usage >8 GB → Optimize queries or add RAM

**Planned expansions**:
- Global: +190 countries (19,495 municipalities)
- Projected: ~100,000-500,000 boundaries
- Database size estimate: 10-50 GB
- Extraction time estimate: 2-5 days (with parallelization)

---

## Security Considerations

### Data Sensitivity

- **Public data**: Boundary geometries (no PII)
- **Credentials**: Storacha API keys (rotate quarterly)
- **Database**: No user data, only geographic boundaries

### Access Control

- Production database: Read-only for most team members
- Write access: On-call rotation only
- Storacha credentials: Environment variables (not committed)
- Backups: Encrypted at rest

### Incident Response

If security breach suspected:
1. **STOP**: Halt all operations
2. **PRESERVE**: Create forensic backups
3. **NOTIFY**: Email security@voter.protocol immediately
4. **DOCUMENT**: Record all actions
5. **ESCALATE**: Follow security incident protocol

---

## Change Management

### Deployment Process

**For operational changes** (config, registry updates):
1. Create PR with changes
2. Review by tech lead
3. Merge to main
4. Deploy during maintenance window (if impactful)

**For code changes**:
1. Follow standard development process
2. Require ops review for high-impact changes
3. Stage in test environment first
4. Deploy during low-traffic period

### Rollback Procedure

**If deployment causes issues**:
1. Assess severity (follow incident response)
2. If P0/P1: Rollback immediately
3. Document what went wrong
4. Fix and retest before retry

---

## Support & Resources

### Documentation

- **Architecture**: [Main README](../README.md)
- **Operations**: [OPERATIONAL-RUNBOOKS.md](../docs/OPERATIONAL-RUNBOOKS.md)
- **Failure Analysis**: [FAILURE-RESOLUTION-PLAYBOOK.md](../docs/FAILURE-RESOLUTION-PLAYBOOK.md)
- **Automation**: [QUARTERLY-AUTOMATION.md](../docs/QUARTERLY-AUTOMATION.md)

### Communication Channels

- **Alerts**: PagerDuty → #incident-response (Slack)
- **Daily ops**: #shadow-atlas (Slack)
- **Incidents**: Create channel `#incident-YYYY-MM-DD-description`
- **Handoffs**: #ops-handoff (Slack)

### Training Resources

**New to on-call?**
1. Read [On-Call Guide](on-call-guide.md)
2. Shadow experienced engineer for one shift
3. Review common incident runbooks
4. Test runbook procedures in dev environment

---

## Feedback & Improvements

**Found an issue with ops docs?**
```bash
gh issue create \
  --label "ops,documentation" \
  --title "Ops docs: [Issue description]" \
  --body "[Detailed description]"
```

**Suggestion for new runbook?**
```bash
gh issue create \
  --label "ops,runbook-request" \
  --title "Runbook request: [Scenario]" \
  --body "[Describe scenario and why runbook needed]"
```

---

## Version History

- **v1.0** (2025-12-18): Initial operations guide
- **Next review**: 2025-03-18 (Quarterly)

---

**Questions?** Ask in #shadow-atlas (Slack) or tag @tech-lead

**Emergency?** Follow [Incident Response](runbooks/incident-response.md)

**On-call?** Start with [On-Call Guide](on-call-guide.md)
