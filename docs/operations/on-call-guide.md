# Shadow Atlas On-Call Guide

**Version**: 1.0
**Last Updated**: 2025-12-18
**Purpose**: Comprehensive guide for Shadow Atlas on-call engineers

---

## Welcome to On-Call

You are the first line of defense for Shadow Atlas production operations. This service provides critical ZK proof infrastructure for VOTER Protocol, supporting democratic participation globally.

**Your responsibilities**:
- Respond to alerts within SLA timeframes
- Diagnose and mitigate production incidents
- Escalate when appropriate
- Document all actions taken
- Maintain service availability >99.9%

**You are not expected to**:
- Fix every issue yourself (escalate when needed)
- Work without sleep (escalate if incident prolonged)
- Know everything (use runbooks, ask questions)

---

## Quick Start: Your First Alert

### Step 1: Acknowledge (Within 5 minutes)

```bash
# Acknowledge PagerDuty
pd ack <incident_id>

# Check alert details
cat /tmp/shadow-atlas-alert.json  # If alert forwarded to file
```

### Step 2: Assess Severity

Use this quick matrix:

| Symptom | Severity | SLA |
|---------|----------|-----|
| All proofs failing | P0 | 15 min |
| Database corruption | P0 | 15 min |
| IPFS completely down | P0 | 15 min |
| Provider outage (TIGER) | P1 | 1 hour |
| Single state failing | P2 | 4 hours |
| Slow queries | P2 | 4 hours |

### Step 3: Run Health Check

```bash
cd /Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas

# Quick health snapshot
npx tsx observability/cli.ts health-check

# If fails, run diagnostics
ops/scripts/health-check.sh
```

### Step 4: Find the Right Runbook

**Quick runbook selector**:

```
What's broken?
  │
  ├─> Database errors → [Data Corruption](./runbooks/common-incidents/data-corruption.md)
  ├─> Slow responses → [High Latency](./runbooks/common-incidents/high-latency.md)
  ├─> Provider errors → [Upstream Failure](./runbooks/common-incidents/upstream-failure.md)
  ├─> IPFS errors → [IPFS Unavailable](./runbooks/common-incidents/ipfs-unavailable.md)
  ├─> Job stuck → Stuck Jobs (TBD)
  └─> Proof failures → [Invalid Merkle Tree](./runbooks/common-incidents/data-corruption.md)
```

### Step 5: Follow Runbook

- Execute steps exactly as written
- Document what you try
- If unsure, escalate

---

## On-Call Schedule & Handoff

### Shift Timing

**Primary On-Call**: 24x7 rotating weekly
- Week starts Monday 00:00 UTC
- Week ends Sunday 23:59 UTC
- PagerDuty rotation: `shadow-atlas-primary`

**Secondary On-Call**: Backup escalation
- Escalation after 30 minutes (P0) or 2 hours (P1)
- PagerDuty rotation: `shadow-atlas-secondary`

### Handoff Procedure

**End of shift checklist**:

```bash
# 1. Document ongoing incidents
ops/scripts/generate-handoff.sh > handoff-$(date +%Y%m%d).md

# 2. List active alerts
sqlite3 .shadow-atlas/metrics.db "
SELECT * FROM alerts WHERE status = 'firing';
"

# 3. Check recent incidents
gh issue list --label "incident,ops" --state open

# 4. Review scheduled maintenance
cat ops/maintenance-calendar.md
```

**Handoff template** (post in Slack #ops-handoff):

```markdown
## On-Call Handoff: [Your Name] → [Next Person]
**Date**: 2025-12-18 00:00 UTC

### Active Incidents
- None / [Incident description]

### Recent Alerts (Last 24h)
- 2x High latency warnings (resolved)
- 1x Provider timeout (transient)

### Ongoing Work
- Quarterly update scheduled for Dec 20
- Registry updates pending review

### Watch Items
- Provider X has been slow (not critical yet)
- Disk usage at 75% (monitor)

### Notes
- Everything normal
- Runbook X updated based on recent incident

**Status**: All clear / [Issues to watch]
```

---

## Common Scenarios & Quick Actions

### Scenario 1: High Error Rate Alert

**Alert**: "Error rate >5% over 10 minutes"

**Quick triage**:
```bash
# Check what's failing
sqlite3 .shadow-atlas/metrics.db "
SELECT
  json_extract(labels_json, '$.operation') as operation,
  json_extract(labels_json, '$.error') as error,
  COUNT(*) as count
FROM metrics
WHERE type = 'error'
  AND recorded_at >= datetime('now', '-10 minutes')
GROUP BY operation, error
ORDER BY count DESC
LIMIT 10;
"
```

**Common causes**:
- Provider timeout → [Upstream Failure](./runbooks/common-incidents/upstream-failure.md)
- Database lock → [High Latency](./runbooks/common-incidents/high-latency.md)
- IPFS timeout → [IPFS Unavailable](./runbooks/common-incidents/ipfs-unavailable.md)

---

### Scenario 2: Database Corruption Alert

**Alert**: "Database integrity check failed"

**IMMEDIATE ACTION**:
```bash
# STOP ALL WRITES
pkill -f "batch-orchestrator"

# CREATE EMERGENCY BACKUP
cp .shadow-atlas/persistence.db .shadow-atlas/persistence.db.EMERGENCY.$(date +%s)

# FOLLOW RUNBOOK
# See: runbooks/common-incidents/data-corruption.md
```

**This is P0. Escalate if not resolved in 30 minutes.**

---

### Scenario 3: IPFS Snapshot Upload Failed

**Alert**: "Snapshot created but IPFS CID missing"

**Quick fix**:
```bash
# Get snapshot ID from alert
export SNAPSHOT_ID="snapshot_abc123"

# Retry upload
npx tsx -e "
import { uploadSnapshotToIPFS } from './integration/ipfs-uploader.js';
const cid = await uploadSnapshotToIPFS('${SNAPSHOT_ID}');
console.log('Uploaded:', cid);
"

# Update database
sqlite3 .shadow-atlas/persistence.db "
UPDATE snapshots SET ipfs_cid = '${CID}' WHERE id = '${SNAPSHOT_ID}';
"
```

**If fails after 3 retries**: [IPFS Unavailable](./runbooks/common-incidents/ipfs-unavailable.md)

---

### Scenario 4: Provider Outage

**Alert**: "Provider availability <95%"

**Quick check**:
```bash
# Test Census TIGER
curl -sf -m 10 "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer" && echo "✓ TIGER OK" || echo "✗ TIGER DOWN"

# Test ArcGIS Hub
curl -sf -m 10 "https://hub.arcgis.com" && echo "✓ Hub OK" || echo "✗ Hub DOWN"
```

**Decision tree**:
- TIGER down + no maintenance window → P1, escalate after 1 hour
- ArcGIS Hub down → Use fallback providers (P1, handle yourself)
- State portal down → P2, defer to business hours

**Full runbook**: [Upstream Failure](./runbooks/common-incidents/upstream-failure.md)

---

### Scenario 5: Job Stuck for >12 Hours

**Alert**: "Job in 'running' state for 12+ hours"

**Quick fix**:
```bash
# Check if process actually running
ps aux | grep batch-orchestrator

# If not running, mark as partial
export JOB_ID="job_abc123"
sqlite3 .shadow-atlas/persistence.db "
UPDATE jobs SET status = 'partial', updated_at = datetime('now')
WHERE id = '${JOB_ID}';
"

# Resume job
npx tsx -e "
import { BatchOrchestrator } from './services/batch-orchestrator.js';
const result = await new BatchOrchestrator().resumeJob('${JOB_ID}');
console.log('Resumed:', result.status);
"
```

---

## Escalation Guidelines

### When to Escalate

**Escalate to Tech Lead if**:
- P0 incident not resolved in 30 minutes
- P1 incident not resolved in 2 hours
- Unsure how to proceed
- Root cause unclear
- Fix requires code changes

**Escalate to CTO if**:
- P0 incident not resolved in 1 hour
- Data loss confirmed
- Security breach suspected
- Multiple systems failing

### How to Escalate

**Good escalation message**:
```markdown
@tech-lead - Escalating P0 incident

**Issue**: Database corruption detected
**Duration**: 45 minutes (started 03:45 UTC)
**Impact**: All proof generation down, 100% of users affected

**Actions Taken**:
- ✅ Emergency backup created
- ✅ Tried SQLite recovery (failed)
- ✅ Tested backup integrity (backup also corrupt)
- ❌ Root cause: Unknown

**Escalating Because**:
- 30min SLA threshold reached
- Multiple recovery attempts failed
- Need guidance on rebuilding from IPFS

**Immediate Need**:
- Decision: Rebuild from IPFS vs wait for recovery?
- Database expertise for corruption diagnosis
```

**Bad escalation message**:
```markdown
@tech-lead help! database broken
```

---

## Useful Commands Reference

### Health & Diagnostics

```bash
# Overall health
npx tsx observability/cli.ts health-check

# Database integrity
sqlite3 .shadow-atlas/persistence.db "PRAGMA integrity_check;"

# Recent jobs
npx tsx -e "import {BatchOrchestrator} from './services/batch-orchestrator.js'; console.table(await new BatchOrchestrator().listJobs(10));"

# Active alerts
sqlite3 .shadow-atlas/metrics.db "SELECT * FROM alerts WHERE status='firing';"

# Disk space
df -h .shadow-atlas/

# Provider health
ops/scripts/provider-health-check.sh
```

### Common Fixes

```bash
# Restart stuck job
npx tsx -e "import {BatchOrchestrator} from './services/batch-orchestrator.js'; await new BatchOrchestrator().resumeJob('${JOB_ID}');"

# Cancel job
npx tsx -e "import {BatchOrchestrator} from './services/batch-orchestrator.js'; await new BatchOrchestrator().cancelJob('${JOB_ID}');"

# Rollback snapshot
sqlite3 .shadow-atlas/persistence.db "UPDATE snapshots SET deprecated_at=NULL WHERE id='${PREVIOUS_ID}'; UPDATE snapshots SET deprecated_at=datetime('now') WHERE id='${CURRENT_ID}';"

# Clear stuck alerts
sqlite3 .shadow-atlas/metrics.db "UPDATE alerts SET status='resolved', resolved_at=datetime('now') WHERE id='${ALERT_ID}';"
```

### Emergency Procedures

```bash
# Stop all jobs (emergency)
pkill -f batch-orchestrator

# Create emergency backup
ops/scripts/emergency-backup.sh

# Rollback to previous snapshot
ops/scripts/rollback.sh

# Full diagnostic snapshot
ops/scripts/metrics-snapshot.sh > /tmp/incident-$(date +%s).txt
```

---

## Tools & Access

### Required Access

- [ ] GitHub repository access (voter-protocol/packages/crypto)
- [ ] PagerDuty login (rotation: shadow-atlas-primary)
- [ ] Slack channels: #incident-response, #ops-handoff, #shadow-atlas
- [ ] Production server SSH (if self-hosted)
- [ ] Storacha/IPFS credentials (read from environment)
- [ ] Grafana/monitoring dashboard (if deployed)

### Development Environment

```bash
# Clone repository
git clone https://github.com/voter-protocol/voter-protocol
cd packages/crypto/services/shadow-atlas

# Install dependencies
npm install

# Test access to production data
ls -la .shadow-atlas/
```

### Key Locations

```
/Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas/
├── ops/                    # YOU ARE HERE
│   ├── runbooks/           # Incident response procedures
│   ├── scripts/            # Operational scripts
│   └── on-call-guide.md    # This file
├── .shadow-atlas/          # Production data
│   ├── persistence.db      # Main database
│   ├── metrics.db          # Metrics and alerts
│   ├── backups/            # Daily backups
│   └── jobs/               # Job state files
├── observability/          # Monitoring tools
└── docs/                   # Background documentation
```

---

## Monitoring Dashboard

### Key Metrics to Watch

**Service Health**:
- Proof generation success rate: >95% (alert <90%)
- Extraction success rate: >90% (alert <80%)
- Validation pass rate: >90% (alert <80%)
- Provider availability: >95% (alert <95%)

**Performance**:
- Job duration: <60s (alert >120s)
- Query latency: <1s p95 (alert >5s)
- IPFS retrieval: <10s (alert >30s)

**System Health**:
- Database size: <5GB (alert >10GB)
- Disk usage: <80% (alert >90%)
- Active jobs: <5 concurrent (alert >10)

### Dashboard Access

```bash
# If Grafana deployed
open "https://grafana.voter.protocol/d/shadow-atlas"

# Otherwise, query metrics directly
sqlite3 .shadow-atlas/metrics.db "
SELECT
  type,
  AVG(value) as avg,
  MIN(value) as min,
  MAX(value) as max,
  COUNT(*) as count
FROM metrics
WHERE recorded_at >= datetime('now', '-1 hour')
GROUP BY type
ORDER BY type;
"
```

---

## Incident Response Workflow

```
Alert Fires
  │
  ├─> ACKNOWLEDGE (within 5 min)
  │     └─> PagerDuty, Slack
  │
  ├─> ASSESS (within 15 min)
  │     ├─> Severity: P0/P1/P2/P3
  │     ├─> Impact: Users affected
  │     └─> Health check: ops/scripts/health-check.sh
  │
  ├─> TRIAGE (within 30 min)
  │     ├─> Find runbook
  │     ├─> Initial mitigation
  │     └─> Post status update
  │
  ├─> MITIGATE
  │     ├─> Follow runbook steps
  │     ├─> Document actions
  │     └─> Update every 30-60 min (P0) or 2-4 hours (P1)
  │
  ├─> RESOLVE
  │     ├─> Verify fix
  │     ├─> Monitor for regression
  │     └─> Post resolution update
  │
  └─> FOLLOW-UP (within 48h)
        ├─> Post-incident review
        ├─> Update runbooks
        └─> Create prevention tasks
```

---

## Communication Templates

### Initial Alert Response

```markdown
🚨 Alert acknowledged: [Brief description]

**Severity**: P0/P1/P2
**On-call**: @your-name
**Status**: Investigating

**Impact**: [User-facing impact]
**ETA for update**: [Time]
```

### Status Update

```markdown
**Incident Update** [HH:MM UTC]

**Summary**: [One sentence]

**Progress**:
- ✅ [Completed action]
- ⏳ [In progress action]
- ⏸️ [Blocked action]

**Next Steps**: [What you're doing next]
**ETA**: [When resolved or next update]
```

### Resolution

```markdown
✅ **RESOLVED**: [Brief description]

**Duration**: [Start time] - [End time] ([Duration])
**Resolution**: [What fixed it]
**Impact**: [What users experienced]

**Follow-up**: Post-incident review scheduled for [Time]
```

---

## FAQ for New On-Call Engineers

**Q: What if I don't know how to fix the issue?**
A: That's okay! Follow the runbook as far as you can, then escalate. Document what you tried.

**Q: Should I make code changes during an incident?**
A: No. Use configuration changes, rollbacks, or database updates only. Code changes require review.

**Q: What if the runbook doesn't work?**
A: Escalate immediately. Document what didn't work so we can update the runbook.

**Q: Can I roll back a deployment?**
A: Yes, if following the rollback runbook. Document the decision.

**Q: What if multiple things are failing?**
A: Escalate to create a war room. Don't try to fix everything alone.

**Q: Should I wake someone up?**
A: For P0 incidents >30 min, yes. For P1 incidents >2 hours, yes. Your sleep matters too.

**Q: What if I'm stuck and it's 3am?**
A: Escalate to secondary on-call. They're expecting it.

---

## Post-Incident Checklist

After resolving an incident:

- [ ] Post resolution message in Slack
- [ ] Resolve PagerDuty incident
- [ ] Clear any firing alerts
- [ ] Document timeline in incident doc
- [ ] Create GitHub issue for post-incident review
- [ ] Update runbook if gaps found
- [ ] Schedule debrief meeting (within 48h)

---

## Self-Care for On-Call

**You cannot pour from an empty cup.**

- Take breaks during long incidents
- Escalate if you're overwhelmed
- Sleep when not actively responding
- Hand off if incident drags >4 hours
- Debrief with team after hard incidents

**Burnout prevention**:
- Don't work more than 8 hours on a single incident without break
- Ask for relief if multiple nights interrupted
- It's okay to escalate just because you're tired

---

## Emergency Contacts

**Shadow Atlas On-Call** (YOU):
- PagerDuty: shadow-atlas-primary
- Slack: @your-name

**Tech Lead** (Primary escalation):
- Slack: @tech-lead
- Phone: [REDACTED]
- Escalate: P0 >30min, P1 >2h

**CTO** (Critical escalation):
- Slack: @cto
- Phone: [REDACTED]
- Escalate: P0 >1h, data loss, security

**Database Expert**:
- Slack: @db-expert
- Escalate: Database corruption, performance

**Security Team**:
- Email: security@voter.protocol
- Escalate: Suspected breach, data leak

---

## Additional Resources

**Documentation**:
- [Architecture](../README.md)

**Runbooks**:
- [Incident Response](./runbooks/incident-response.md)
- [High Latency](./runbooks/common-incidents/high-latency.md)
- [Data Corruption](./runbooks/common-incidents/data-corruption.md)
- [Upstream Failure](./runbooks/common-incidents/upstream-failure.md)
- [IPFS Unavailable](./runbooks/common-incidents/ipfs-unavailable.md)

**Tools**:
- [Health Check Script](scripts/health-check.sh)
- [Metrics Snapshot](scripts/metrics-snapshot.sh)
- [Emergency Backup](scripts/emergency-backup.sh)
- [Rollback Script](scripts/rollback.sh)

---

## Feedback & Improvements

This guide is living documentation. If you:
- Find errors or unclear sections
- Encounter scenarios not covered
- Have suggestions for improvements

**Create GitHub issue**:
```bash
gh issue create \
  --label "ops-runbook,documentation" \
  --title "On-call guide: [Your feedback]" \
  --body "[Detailed description]"
```

---

**Document Version**: 1.0
**Last Updated**: 2025-12-18
**Next Review**: Quarterly
**Maintained By**: SRE Team

**Good luck on your shift! You've got this. 🚀**
