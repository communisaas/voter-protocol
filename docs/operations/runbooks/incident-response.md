# Shadow Atlas Incident Response Runbook

**Version**: 1.0
**Last Updated**: 2025-12-18
**Owner**: SRE Team
**Review Cadence**: Quarterly

---

## Purpose

This runbook provides structured incident response procedures for Shadow Atlas production operations. Designed for on-call engineers responding to alerts at any hour.

**Philosophy**: Clear steps, no ambiguity, actionable at 3am.

---

## Table of Contents

1. [Severity Classification](#severity-classification)
2. [Initial Response Protocol](#initial-response-protocol)
3. [Communication Templates](#communication-templates)
4. [Escalation Procedures](#escalation-procedures)
5. [Post-Incident Review](#post-incident-review)
6. [War Room Procedures](#war-room-procedures)

---

## Severity Classification

### P0 - Critical (Service Down)

**Definition**: Complete service outage affecting all users OR data loss in progress

**Examples**:
- Database corruption preventing all queries
- Merkle tree validation failing >50% of proofs
- IPFS snapshots completely inaccessible
- Complete provider outage for TIGER/Census data

**Response Time**: 15 minutes
**Communication**: Immediate (PagerDuty + Phone + Slack)
**Escalation**: On-call → Tech Lead → CTO
**Update Frequency**: Every 30 minutes until resolved

**Required Actions**:
1. Acknowledge alert within 5 minutes
2. Join war room (Slack #incident-response)
3. Post initial status update within 15 minutes
4. Begin mitigation immediately
5. Loop in Tech Lead if not resolved in 30 minutes

---

### P1 - High (Degraded Service)

**Definition**: Significant functionality loss affecting many users, manual intervention required

**Examples**:
- Provider outage affecting 10+ states
- Job stuck in running state blocking new extractions
- Validation pass rate <80%
- IPFS pinning failures preventing snapshot publication
- Partial job failures affecting >20% of tasks

**Response Time**: 1 hour
**Communication**: Slack + Email
**Escalation**: On-call → Tech Lead
**Update Frequency**: Every 2 hours until resolved

**Required Actions**:
1. Acknowledge alert within 30 minutes
2. Post triage update in Slack within 1 hour
3. Begin investigation and mitigation
4. Escalate if not resolved in 4 hours

---

### P2 - Medium (Partial Degradation)

**Definition**: Limited functionality loss, workaround exists, affects subset of users

**Examples**:
- Single state extraction failures
- Partial job completion with <10% task failures
- Slow query performance (not critical path)
- Non-critical provider timeout errors
- Validation discrepancies for single layer

**Response Time**: 4 hours
**Communication**: Slack
**Escalation**: Team queue
**Update Frequency**: Daily until resolved

**Required Actions**:
1. Acknowledge alert during business hours
2. Create ticket with triage notes
3. Add to sprint planning if multi-day fix
4. Monitor for escalation to P1

---

### P3 - Low (Minor Issue)

**Definition**: Minor issue, no user impact, can be resolved during normal work hours

**Examples**:
- Single layer validation warning
- Registry staleness flag
- Non-critical metric threshold breached
- Documentation gaps
- Performance optimization opportunities

**Response Time**: Next business day
**Communication**: GitHub issue
**Escalation**: Backlog
**Update Frequency**: Weekly

**Required Actions**:
1. Create GitHub issue with "ops" label
2. Add to backlog
3. Review in next sprint planning

---

## Initial Response Protocol

### Step 1: Acknowledge (0-5 minutes)

```bash
# Acknowledge PagerDuty alert
pd ack <incident_id>

# Post in Slack
# Template:
🚨 [P0/P1/P2] Incident acknowledged
**Issue**: [Brief description]
**On-call engineer**: @your-name
**Status**: Investigating
**ETA for update**: [Time]
```

### Step 2: Assess Impact (5-15 minutes)

Run diagnostic snapshot:

```bash
cd /Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas

# Quick health check
npx tsx observability/cli.ts health-check

# Database integrity
sqlite3 .shadow-atlas/persistence.db "PRAGMA integrity_check;"

# Recent jobs
npx tsx -e "
import { BatchOrchestrator } from './services/batch-orchestrator.js';
const orch = new BatchOrchestrator();
const jobs = await orch.listJobs(10);
console.table(jobs);
"

# Active alerts
sqlite3 .shadow-atlas/metrics.db "
SELECT * FROM alerts WHERE status = 'firing' ORDER BY started_at DESC;
"

# Capture output
ops/scripts/metrics-snapshot.sh > /tmp/incident-snapshot-$(date +%s).txt
```

**Document findings**:
- What's broken?
- How many users affected?
- When did it start?
- What changed recently?

### Step 3: Determine Severity (15 minutes)

Use severity matrix:

| Impact | User-Facing? | Data Loss Risk? | Severity |
|--------|-------------|-----------------|----------|
| Total outage | Yes | Yes | P0 |
| Total outage | Yes | No | P0 |
| Partial outage | Yes | Yes | P0 |
| Partial outage | Yes | No | P1 |
| Single feature | Yes | No | P1 |
| Performance degraded | Yes | No | P2 |
| Internal only | No | No | P2/P3 |

**If unsure, escalate to higher severity.**

### Step 4: Initial Mitigation (15-60 minutes)

**P0/P1 mitigation priorities**:

1. **Stop the bleeding**: Prevent data loss
2. **Restore service**: Even degraded service better than none
3. **Investigate root cause**: Only after service restored

**Common quick wins**:

```bash
# Rollback to previous snapshot (if current corrupt)
export INVALID_SNAPSHOT_ID="snapshot_abc123"
export PREVIOUS_SNAPSHOT_ID="snapshot_def456"

sqlite3 .shadow-atlas/persistence.db "
UPDATE snapshots SET deprecated_at = datetime('now') WHERE id = '${INVALID_SNAPSHOT_ID}';
UPDATE snapshots SET deprecated_at = NULL WHERE id = '${PREVIOUS_SNAPSHOT_ID}';
"

# Cancel stuck job
npx tsx -e "
import { BatchOrchestrator } from './services/batch-orchestrator.js';
const orch = new BatchOrchestrator();
await orch.cancelJob('${JOB_ID}');
"

# Restore from backup (if database corrupt)
BACKUP_FILE=".shadow-atlas/backups/persistence-$(date -v-1d +%Y%m%d).db"
sqlite3 "$BACKUP_FILE" "PRAGMA integrity_check;" && \
  cp "$BACKUP_FILE" .shadow-atlas/persistence.db

# See common-incidents/ for detailed procedures
```

### Step 5: Communicate (Ongoing)

Post status updates per severity guidelines:

```markdown
**Incident Update** [HH:MM UTC]

**Summary**: [One sentence]

**Impact**:
- Users affected: [Number/percentage]
- Functionality impacted: [Specific features]
- Data loss: [Yes/No + details]

**Root Cause**: [Known/Under investigation]

**Mitigation**:
- [Action 1 - Status]
- [Action 2 - Status]

**Next Steps**:
- [Expected action + timeline]

**ETA**: [When will this be resolved? If unknown, say "investigating"]
**Next Update**: [Specific time]
```

---

## Communication Templates

### P0 Initial Alert (Within 15 minutes)

```markdown
🚨 **P0 INCIDENT** - Shadow Atlas Service Outage

**Detected**: 2025-12-18 03:45 UTC
**On-call engineer**: @jane-doe
**Status**: Investigating

**Impact**:
- All ZK proof validations failing
- Users cannot verify district membership
- Congressional message delivery blocked

**Immediate Actions**:
- Checking database integrity
- Reviewing recent deployments
- Examining Merkle tree validation logs

**Next Update**: 04:15 UTC (30 minutes)

**Incident Channel**: #incident-2025-12-18-merkle-failure
```

### P0/P1 Hourly Update

```markdown
**Incident Update** [04:15 UTC]

**Summary**: Database corruption detected, restoration in progress

**Impact**:
- 100% of users affected
- Proof validation completely down
- No data loss detected (backups intact)

**Root Cause**: SQLite corruption following unclean shutdown during deployment

**Mitigation Progress**:
- ✅ Backup integrity verified
- ✅ Database restored from 24h backup
- ⏳ Merkle tree validation running (ETA: 15 min)
- ⏳ IPFS snapshot verification (ETA: 10 min)

**Next Steps**:
- Complete validation tests
- Resume proof generation service
- Post-incident review scheduled for tomorrow

**ETA**: Service restoration by 04:45 UTC
**Next Update**: 04:45 UTC or when service restored
```

### Resolution Announcement

```markdown
✅ **RESOLVED** - Shadow Atlas Service Restored

**Incident Duration**: 03:45 UTC - 04:52 UTC (1h 7min)
**Final Status**: Service fully operational

**Resolution**:
- Database restored from backup (24h old)
- Merkle tree validation passed (95% success rate)
- IPFS snapshots accessible
- Proof generation service operational

**User Impact**:
- 1h 7min outage for all proof validations
- No data loss
- Some users may need to retry failed proofs

**Root Cause**: SQLite corruption from unclean shutdown

**Follow-up**:
- Post-incident review: Tomorrow 10:00 UTC
- Prevention tasks: Enable WAL mode, improve shutdown handling
- Incident report: Will be posted within 48h

Thank you for your patience.
```

---

## Escalation Procedures

### When to Escalate

**Escalate immediately if**:
- P0 incident not resolved within 30 minutes
- P1 incident not resolved within 4 hours
- Data loss confirmed or suspected
- Security breach suspected
- Unsure how to proceed

**Escalation paths**:

```
P0: On-call Engineer → Tech Lead → CTO
    (15 min)          (30 min)    (1 hour)

P1: On-call Engineer → Tech Lead
    (1 hour)          (4 hours)

P2: Team Queue → Sprint Planning
    (24 hours)

P3: Backlog → Grooming
```

### Escalation Contacts

**Tech Lead** (Primary escalation):
- Slack: @tech-lead
- Phone: [REDACTED]
- Escalation threshold: P0 >30min, P1 >4h

**CTO** (Critical escalation):
- Slack: @cto
- Phone: [REDACTED]
- Escalation threshold: P0 >1h, data loss, security

**Database Expert** (Specialist):
- Slack: @db-expert
- Phone: [REDACTED]
- Escalation threshold: Database corruption, performance issues

**Security Team** (Security incidents):
- Slack: @security-team
- Email: security@voter.protocol
- Escalation threshold: Suspected breach, data leak

### Escalation Checklist

Before escalating, prepare:

- [ ] Incident summary (1-2 sentences)
- [ ] Severity and user impact
- [ ] Actions taken so far
- [ ] Why you're escalating (stuck, unsure, time threshold)
- [ ] What you need (decision, expertise, help)

**Escalation message template**:

```markdown
@tech-lead - Escalating P0 incident

**Issue**: Merkle tree validation failing, proof generation down
**Duration**: 45 minutes (started 03:45 UTC)
**Impact**: 100% of users, proof validation completely blocked

**Actions Taken**:
- ✅ Database integrity check (passed)
- ✅ Rollback to previous snapshot (no improvement)
- ✅ IPFS connectivity verified
- ❌ Root cause still unknown

**Escalating Because**: 30min threshold reached, root cause unclear

**Need**: Help diagnosing Merkle tree validation failures
**Context**: Full diagnostic log attached
```

---

## War Room Procedures

### When to Initiate War Room

**Trigger conditions**:
- P0 incident
- P1 incident with unclear resolution path
- Multi-system impact
- Customer-visible degradation >2 hours

### War Room Setup (P0 only)

1. **Create Slack channel** (within 5 minutes):
   ```
   Channel: #incident-YYYY-MM-DD-short-description
   Example: #incident-2025-12-18-merkle-failure
   ```

2. **Pin incident doc** (Google Doc or Slack canvas):
   ```markdown
   # Incident: Merkle Tree Validation Failure

   **Start Time**: 2025-12-18 03:45 UTC
   **Incident Commander**: @jane-doe
   **Severity**: P0

   ## Timeline
   03:45 - Alert fired
   03:47 - On-call acknowledged
   03:50 - Initial assessment complete
   ...

   ## Hypotheses
   1. Database corruption (INVESTIGATING)
   2. IPFS snapshot mismatch (RULED OUT)
   3. Merkle tree algorithm bug (UNLIKELY)

   ## Actions
   - [ ] @jane: Check database integrity
   - [ ] @john: Review recent deployments
   - [ ] @sarah: Validate IPFS snapshots
   ```

3. **Assign roles**:
   - **Incident Commander**: Coordinates response, makes decisions
   - **Investigators**: Debug and fix
   - **Communications**: Status updates
   - **Scribe**: Document timeline

### War Room Etiquette

**DO**:
- Keep updates in thread (not top-level)
- Mark completed tasks with ✅
- Share findings immediately
- Ask clarifying questions
- Document decisions

**DON'T**:
- Debate architecture (fix now, discuss later)
- Work in silence (share what you're doing)
- Guess (if unsure, say so)
- Go rogue (coordinate with IC)

### War Room Close

When incident resolved:

1. **Announce resolution** in war room channel
2. **Archive timeline** from incident doc
3. **Schedule post-incident review** (within 48h)
4. **Archive channel** (keep for reference)
5. **Thank participants**

---

## Post-Incident Review

### Timeline

**Within 24 hours**:
- [ ] Create incident report draft
- [ ] Invite participants to review session
- [ ] Collect timeline data

**Within 48 hours**:
- [ ] Conduct blameless post-mortem meeting
- [ ] Finalize incident report
- [ ] Create prevention action items

**Within 1 week**:
- [ ] Publish incident report
- [ ] Update runbooks with lessons learned
- [ ] Prioritize prevention tasks

### Incident Report Template

```markdown
# Incident Report: [Title]

**Date**: YYYY-MM-DD
**Severity**: P0/P1/P2
**Duration**: [Start time] - [End time] ([Duration])
**Author**: [Name]

## Summary

[2-3 sentence summary: what happened, impact, resolution]

## Impact

**Users Affected**: [Number/percentage]
**Services Impacted**: [List]
**Data Loss**: [Yes/No + details]
**Downtime**: [Duration]

## Timeline (UTC)

| Time | Event |
|------|-------|
| 03:45 | Alert fired: Merkle tree validation failure rate >50% |
| 03:47 | On-call acknowledged, began investigation |
| 03:50 | Database corruption suspected |
| 04:00 | Backup restoration initiated |
| 04:20 | Database restored, validation restarted |
| 04:45 | Validation complete, service operational |
| 04:52 | Incident closed, monitoring continues |

## Root Cause

**Immediate Cause**: SQLite database corruption from unclean shutdown

**Contributing Factors**:
1. Deployment process killed active database connection
2. No Write-Ahead Logging (WAL) mode enabled
3. No graceful shutdown handler for long-running jobs

**Why it wasn't detected earlier**:
- No pre-deployment database integrity check
- Shutdown process didn't wait for active transactions

## Resolution

**Immediate Fix**:
- Restored database from 24h backup
- Verified Merkle tree integrity
- Resumed proof generation service

**Temporary Mitigation**:
- Added manual database integrity check to deployment checklist
- Documented rollback procedure

**Long-term Prevention**:
- Enable SQLite WAL mode (reduces corruption risk)
- Implement graceful shutdown handler
- Add pre-deployment integrity checks
- Automate backup verification

## Lessons Learned

**What Went Well**:
- Alert fired immediately when issue occurred
- On-call responded within 2 minutes
- Backup restoration process worked flawlessly
- Clear escalation to Tech Lead when needed
- Total downtime under 2 hours

**What Could Be Improved**:
- Deployment process should verify database health
- Need automated pre-deployment checks
- Shutdown handling needs improvement
- Runbook could include database recovery steps (now added)

**Surprising Findings**:
- SQLite more sensitive to unclean shutdown than expected
- Backup restoration faster than anticipated (20 min)
- Merkle tree validation robust to 24h data lag

## Action Items

**Immediate** (this week):
- [ ] Enable WAL mode on production database (@jane, P0)
- [ ] Add database integrity check to deployment script (@john, P0)
- [ ] Update runbook with database recovery procedure (@sarah, P1)

**Short-term** (this month):
- [ ] Implement graceful shutdown handler (@jane, P1)
- [ ] Add automated backup verification tests (@john, P2)
- [ ] Document WAL mode migration procedure (@sarah, P2)

**Long-term** (this quarter):
- [ ] Evaluate PostgreSQL migration (@team, P3)
- [ ] Improve deployment pipeline safety (@team, P3)

## Appendix

**Relevant Logs**: [Link to log snippets]
**Metrics Snapshot**: [Link to metrics dump]
**Related Incidents**: [Links to similar past incidents]
**Runbook Updates**: [Link to updated runbook sections]
```

### Blameless Post-Mortem Meeting Agenda

**Duration**: 60 minutes
**Attendees**: Incident participants + Team Lead

**Agenda**:

1. **Timeline review** (15 min)
   - Walk through incident timeline
   - Clarify any gaps or confusion
   - No blame, just facts

2. **Root cause analysis** (20 min)
   - What was the immediate trigger?
   - What were contributing factors?
   - Why wasn't it caught earlier?
   - Use "5 Whys" technique

3. **What went well** (10 min)
   - Celebrate wins
   - Document effective procedures

4. **What to improve** (10 min)
   - Identify gaps in runbooks, monitoring, processes
   - Be specific, actionable

5. **Action items** (5 min)
   - Assign owners and deadlines
   - Prioritize by impact/effort

**Ground Rules**:
- No blame or finger-pointing
- Focus on systems, not individuals
- "How do we prevent this?" not "Who caused this?"
- Everyone's input valued
- Action-oriented

### Prevention Task Prioritization

**Priority matrix**:

| Impact | Effort | Priority | Timeline |
|--------|--------|----------|----------|
| High | Low | P0 | This week |
| High | High | P1 | This month |
| Low | Low | P2 | This quarter |
| Low | High | P3 | Backlog |

**Prevention task template**:

```markdown
## Prevention Task: [Title]

**Incident**: [Link to incident report]
**Impact if recurs**: [High/Medium/Low]
**Effort to implement**: [High/Medium/Low]
**Priority**: [P0/P1/P2/P3]

**Objective**: [What will this prevent?]

**Approach**:
1. [Step 1]
2. [Step 2]
3. [Step 3]

**Success Criteria**:
- [ ] [Measurable outcome 1]
- [ ] [Measurable outcome 2]

**Owner**: [Name]
**Deadline**: [Date]
**Related Tasks**: [Links]
```

---

## Appendix

### Incident Severity Quick Reference

```
DATABASE CORRUPTION → P0
MERKLE TREE INVALID → P0
IPFS COMPLETE FAILURE → P0
TIGER/CENSUS DOWN → P1
PROVIDER OUTAGE (10+ STATES) → P1
JOB STUCK >12H → P1
VALIDATION <80% → P1
PARTIAL JOB FAILURE → P2
SINGLE STATE FAILURE → P2
PERFORMANCE DEGRADATION → P2
REGISTRY STALENESS → P3
DOCUMENTATION GAPS → P3
```

### Emergency Contacts

**Shadow Atlas On-Call**: [PagerDuty rotation]
**Tech Lead**: @tech-lead (Slack), [PHONE REDACTED]
**CTO**: @cto (Slack), [PHONE REDACTED]
**Database Expert**: @db-expert (Slack)
**Security Team**: security@voter.protocol

### Useful Commands Quick Reference

```bash
# Health check
npx tsx observability/cli.ts health-check

# Database integrity
sqlite3 .shadow-atlas/persistence.db "PRAGMA integrity_check;"

# Recent jobs
npx tsx -e "import {BatchOrchestrator} from './services/batch-orchestrator.js'; console.table(await new BatchOrchestrator().listJobs(10));"

# Active alerts
sqlite3 .shadow-atlas/metrics.db "SELECT * FROM alerts WHERE status='firing';"

# Full diagnostic
ops/scripts/metrics-snapshot.sh
```

### Related Runbooks

- [High Latency](common-incidents/high-latency.md)
- [Error Rate Spike](common-incidents/error-rate.md)
- [Data Corruption](common-incidents/data-corruption.md)
- [Upstream Failure](common-incidents/upstream-failure.md)
- [IPFS Unavailable](common-incidents/ipfs-unavailable.md)

---

**Document Version**: 1.0
**Last Updated**: 2025-12-18
**Next Review**: 2025-03-18 (Quarterly)
**Feedback**: Create GitHub issue with label "ops-runbook"
