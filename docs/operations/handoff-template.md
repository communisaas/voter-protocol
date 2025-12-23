# On-Call Handoff Template

**Date**: YYYY-MM-DD HH:MM UTC
**From**: [Your Name]
**To**: [Next On-Call Name]

---

## Summary

**Overall Status**: ✅ All Clear / ⚠ Degraded / 🚨 Critical

**Key Points**:
- [One-sentence summary of the week]
- [Any ongoing issues or watch items]

---

## Active Incidents

### P0/P1 Incidents

_None / [List active critical incidents]_

**Example**:
```markdown
**Incident**: Provider outage affecting 3 states
**Started**: 2025-12-17 14:30 UTC
**Status**: Monitoring recovery
**Next Action**: Check provider status at 18:00 UTC
**Runbook**: ops/runbooks/common-incidents/upstream-failure.md
```

### P2/P3 Incidents

_None / [List lower-priority incidents]_

---

## Recent Alerts (Last 24 Hours)

**Run this query to check**:
```bash
sqlite3 .shadow-atlas/metrics.db "
SELECT
    name,
    severity,
    status,
    datetime(started_at) as started,
    datetime(resolved_at) as resolved
FROM alerts
WHERE started_at >= datetime('now', '-24 hours')
ORDER BY started_at DESC;
"
```

**Summary**:
- High latency warnings: 2 (resolved)
- Provider timeouts: 1 (transient)
- None / [List if any]

---

## Ongoing Work

### Scheduled Maintenance

- [ ] None scheduled
- [ ] Quarterly update planned for [Date]
- [ ] Registry updates pending review

### In-Progress Tasks

- [ ] None
- [ ] [Task description - who's working on it]

---

## Watch Items

**Things to monitor**:

- [ ] None
- [ ] Provider X has been slow (not critical yet, monitor latency)
- [ ] Disk usage at 75% (cleanup recommended soon)
- [ ] Job XYZ partially failed (resume if time permits)

---

## Recent Changes

**Last 7 days**:
- [Deployments, config changes, registry updates]
- None / [List changes]

**Example**:
```markdown
- 2025-12-15: Updated Colorado registry URLs
- 2025-12-16: Deployed fix for validation edge case
```

---

## Metrics Snapshot

**Quick health check**:
```bash
npx tsx observability/cli.ts health-check
```

**Results**:
- Extraction success rate: XX%
- Validation pass rate: XX%
- Provider availability: XX%
- Job duration: XXs

---

## Actions Taken During Shift

**List any interventions**:
- [ ] None (quiet shift)
- [ ] Restarted failed job [job_id]
- [ ] Resolved high latency alert (restarted stuck process)
- [ ] Created emergency backup before [reason]

---

## Useful Context

**For quick reference**:

**Latest snapshot**:
```bash
sqlite3 .shadow-atlas/persistence.db "
SELECT id, ipfs_cid, datetime(created_at) as created
FROM snapshots
WHERE deprecated_at IS NULL
ORDER BY created_at DESC
LIMIT 1;
"
```

**Recent failed jobs** (if any):
```bash
npx tsx -e "
import { BatchOrchestrator } from './services/batch-orchestrator.js';
const jobs = await new BatchOrchestrator().listJobs(10);
const failed = jobs.filter(j => j.status === 'partial' || j.status === 'failed');
console.table(failed);
"
```

---

## Recommendations

**For next shift**:
- [ ] All good, routine monitoring
- [ ] Watch [specific metric/provider]
- [ ] Consider restarting job [job_id] during low traffic
- [ ] Review registry update PR #XXX

---

## Contact Info

**If you need me after handoff**:
- Slack: @your-name
- Phone: [If comfortable sharing]
- Availability: [e.g., "Available until midnight if critical"]

---

## Notes

**Anything else worth knowing**:
- [Free-form notes]
- [Gotchas, quirks, lessons learned]

**Example**:
```markdown
- Provider X seems to timeout more frequently on Tuesdays (maintenance window?)
- Remember to check disk space daily, it's been creeping up
- If you see alert Y, it's usually just Z, quick fix is [command]
```

---

## Handoff Checklist

Before ending shift:

- [ ] Reviewed active alerts
- [ ] Checked recent jobs
- [ ] Verified latest snapshot accessible
- [ ] Documented any incidents or interventions
- [ ] No critical alerts firing
- [ ] Next on-call acknowledged handoff
- [ ] Posted this handoff in #ops-handoff (Slack)

---

**Template Version**: 1.0
**Last Updated**: 2025-12-18

---

## Quick Copy-Paste for Slack

```markdown
## On-Call Handoff: [Your Name] → [Next Name]
**Date**: [Date/Time]

**Status**: ✅ All clear / ⚠ Issues

**Active Incidents**: None / [List]
**Recent Alerts**: [Count] in last 24h (all resolved / [X] active)
**Watch Items**: None / [List]

**Actions Taken**:
- [List or "None"]

**Recommendations**:
- [Any specific guidance]

Full handoff: [Link to this document if stored in shared location]
```
