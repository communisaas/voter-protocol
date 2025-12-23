# Shadow Atlas Runbooks - Complete Index

**Version**: 1.0
**Last Updated**: 2025-12-18
**Purpose**: Quick reference guide to all operational runbooks and scripts

---

## 🚨 Emergency Quick Reference

**Service down? Start here**:
1. **Acknowledge alert** (PagerDuty/Slack)
2. **Run health check**: `ops/scripts/health-check.sh`
3. **Find runbook**: See [Quick Runbook Selector](#quick-runbook-selector)
4. **Escalate if needed**: See [On-Call Guide](on-call-guide.md#escalation-guidelines)

**Critical contacts**:
- Primary On-Call: PagerDuty `shadow-atlas-primary`
- Tech Lead: @tech-lead (Slack)
- Emergency: See [on-call-guide.md](on-call-guide.md#emergency-contacts)

---

## Quick Runbook Selector

### By Symptom

| What's Broken? | Runbook | Severity |
|----------------|---------|----------|
| Database errors, "corrupted" messages | [Data Corruption](runbooks/common-incidents/data-corruption.md) | P0 |
| All proofs failing, Merkle tree invalid | [Data Corruption](runbooks/common-incidents/data-corruption.md) | P0 |
| IPFS snapshot unreachable | [IPFS Unavailable](runbooks/common-incidents/ipfs-unavailable.md) | P1 |
| Provider timeout errors | [Upstream Failure](runbooks/common-incidents/upstream-failure.md) | P1 |
| Slow responses, timeouts | [High Latency](runbooks/common-incidents/high-latency.md) | P1-P2 |
| Job stuck >12 hours | [Stuck Jobs](runbooks/common-incidents/stuck-jobs.md) (TBD) | P2 |
| Disk full | [Capacity Management](runbooks/maintenance/capacity.md) (TBD) | P2 |

### By Alert Type

| Alert Name | Runbook | Action |
|------------|---------|--------|
| `database_corruption` | [Data Corruption](runbooks/common-incidents/data-corruption.md) | STOP ALL WRITES, backup immediately |
| `high_error_rate` | [Error Rate Investigation](runbooks/common-incidents/error-rate.md) (TBD) | Investigate error patterns |
| `provider_unavailable` | [Upstream Failure](runbooks/common-incidents/upstream-failure.md) | Check provider status, use fallbacks |
| `high_latency` | [High Latency](runbooks/common-incidents/high-latency.md) | Profile slow operations |
| `ipfs_pinning_failure` | [IPFS Unavailable](runbooks/common-incidents/ipfs-unavailable.md) | Retry upload, check Storacha |
| `validation_failure` | [Data Quality Issues](runbooks/common-incidents/validation-failure.md) (TBD) | Cross-check against TIGER |

---

## Documentation Structure

```
ops/
├── OPS_README.md                    # Main operations guide (START HERE)
├── on-call-guide.md                 # On-call engineer handbook
├── handoff-template.md              # Shift handoff template
├── RUNBOOK_INDEX.md                 # This file
│
├── runbooks/
│   ├── incident-response.md         # Master incident response procedure
│   │
│   ├── common-incidents/            # Incident-specific runbooks
│   │   ├── data-corruption.md       # P0: Database/Merkle tree corruption
│   │   ├── high-latency.md          # P1: Performance degradation
│   │   ├── upstream-failure.md      # P1: Provider outages
│   │   ├── ipfs-unavailable.md      # P1: IPFS/Storacha issues
│   │   ├── error-rate.md            # P2: Error rate spikes (TBD)
│   │   └── memory-exhaustion.md     # P2: OOM issues (TBD)
│   │
│   ├── maintenance/                 # Scheduled maintenance procedures
│   │   ├── quarterly-update.md      # Quarterly data refresh (12-24h)
│   │   ├── merkle-rebuild.md        # Full Merkle tree rebuild (TBD)
│   │   ├── cache-invalidation.md    # Cache flush procedures (TBD)
│   │   ├── backup-restore.md        # Backup and recovery (TBD)
│   │   └── scaling.md               # Scaling procedures (TBD)
│   │
│   └── monitoring/                  # Monitoring and observability
│       ├── dashboard-guide.md       # Grafana dashboard usage (TBD)
│       ├── alert-response.md        # Alert triage guide (TBD)
│       └── metrics-reference.md     # Metrics catalog (TBD)
│
└── scripts/                         # Operational scripts
    ├── health-check.sh              # Quick health verification
    ├── metrics-snapshot.sh          # Comprehensive diagnostics
    ├── emergency-backup.sh          # Immediate backup creation
    ├── rollback.sh                  # Snapshot rollback
    └── provider-health-check.sh     # Test all providers
```

---

## Runbook Catalog

### 📘 Core Documentation

**[OPS_README.md](OPS_README.md)**
- Service overview and architecture
- Daily/weekly/monthly operational tasks
- Common tasks quick reference
- Escalation paths
- Configuration management

**[on-call-guide.md](on-call-guide.md)**
- On-call responsibilities and SLAs
- First alert response procedures
- Common scenarios and quick fixes
- Escalation guidelines
- Self-care and burnout prevention

**[handoff-template.md](handoff-template.md)**
- Structured handoff format
- Checklist for shift transitions
- Slack copy-paste template

---

### 🚨 Incident Response

**[incident-response.md](runbooks/incident-response.md)**
- Severity classification (P0-P3)
- Initial response protocol (acknowledge, assess, mitigate)
- Communication templates
- Escalation procedures
- Post-incident review process
- War room procedures

**Status**: ✅ Complete
**Last Updated**: 2025-12-18

---

### 🔥 Common Incidents

#### [data-corruption.md](runbooks/common-incidents/data-corruption.md)
**Severity**: P0 (Critical)
**Symptoms**: Database errors, Merkle tree invalid, proof failures
**Recovery Paths**:
- Path A: SQLite recovery (partial corruption)
- Path B: Restore from backup (complete corruption)
- Path C: Rebuild from IPFS (unrecoverable)

**Status**: ✅ Complete | **Last Updated**: 2025-12-18

---

#### [high-latency.md](runbooks/common-incidents/high-latency.md)
**Severity**: P1-P2
**Symptoms**: Slow responses, timeouts, high query duration
**Resolution Paths**:
- Case A: Slow provider API → Use fallbacks
- Case B: Database lock contention → Enable WAL mode
- Case C: Large Merkle tree build → Optimize/parallelize
- Case D: Complex geometry validation → Cache results

**Status**: ✅ Complete | **Last Updated**: 2025-12-18

---

#### [upstream-failure.md](runbooks/common-incidents/upstream-failure.md)
**Severity**: P1-P2
**Symptoms**: HTTP errors, timeouts, rate limiting
**Recovery Paths**:
- Case A: Census TIGER outage → Wait and resume
- Case B: ArcGIS Hub outage → Use state portals
- Case C: State portal outage → Use alternative sources
- Case D: Rate limiting → Implement backoff
- Case E: URL changed → Update registry

**Status**: ✅ Complete | **Last Updated**: 2025-12-18

---

#### [ipfs-unavailable.md](runbooks/common-incidents/ipfs-unavailable.md)
**Severity**: P1
**Symptoms**: Pinning failures, retrieval errors, gateway timeouts
**Recovery Paths**:
- Case A: Snapshot pinning failure → Retry with backoff
- Case B: Storacha API down → Local storage until recovery
- Case C: Gateway timeout → Try alternative gateways
- Case D: CID not found → Verify and re-pin
- Case E: Quota exceeded → Clean up or upgrade

**Status**: ✅ Complete | **Last Updated**: 2025-12-18

---

#### Additional Common Incidents (TBD)

**[error-rate.md](runbooks/common-incidents/error-rate.md)** (To Be Documented)
- Error rate spike investigation
- Error pattern analysis
- Root cause identification

**[memory-exhaustion.md](runbooks/common-incidents/memory-exhaustion.md)** (To Be Documented)
- OOM troubleshooting
- Memory leak detection
- Resource optimization

**[stuck-jobs.md](runbooks/common-incidents/stuck-jobs.md)** (To Be Documented)
- Job timeout handling
- Process cleanup
- Job resume procedures

---

### 🔧 Maintenance Procedures

#### [quarterly-update.md](runbooks/maintenance/quarterly-update.md)
**Frequency**: Quarterly (aligned with Census TIGER releases)
**Duration**: 12-24 hours
**Phases**:
1. Preparation (backup, test sample states)
2. Full extraction (6-8 hours)
3. Validation (cross-check against TIGER)
4. Merkle tree build
5. IPFS publishing
6. Cutover and monitoring

**Includes**: Rollback procedure, post-update verification

**Status**: ✅ Complete | **Last Updated**: 2025-12-18

---

#### Additional Maintenance Procedures (TBD)

**[merkle-rebuild.md](runbooks/maintenance/merkle-rebuild.md)** (To Be Documented)
- When to rebuild Merkle tree
- Full rebuild procedure
- Validation steps

**[cache-invalidation.md](runbooks/maintenance/cache-invalidation.md)** (To Be Documented)
- Cache flush procedures
- Selective invalidation
- Cache warming

**[backup-restore.md](runbooks/maintenance/backup-restore.md)** (To Be Documented)
- Backup verification
- Point-in-time recovery
- Cross-region restore

**[scaling.md](runbooks/maintenance/scaling.md)** (To Be Documented)
- Horizontal scaling (multiple instances)
- Vertical scaling (resource allocation)
- Database migration (SQLite → PostgreSQL)

---

### 📊 Monitoring & Observability (TBD)

**[dashboard-guide.md](runbooks/monitoring/dashboard-guide.md)** (To Be Documented)
- Grafana dashboard walkthrough
- Key metrics interpretation
- Alert threshold configuration

**[alert-response.md](runbooks/monitoring/alert-response.md)** (To Be Documented)
- Alert triage matrix
- False positive handling
- Alert tuning procedures

**[metrics-reference.md](runbooks/monitoring/metrics-reference.md)** (To Be Documented)
- Complete metrics catalog
- SLI/SLO definitions
- Historical baseline data

---

## Operational Scripts

### Core Scripts

**[health-check.sh](scripts/health-check.sh)**
```bash
ops/scripts/health-check.sh
```
**Purpose**: Quick health verification (5 minutes)
**Checks**:
- Database integrity
- Disk space
- Recent jobs
- Snapshot status
- Backups
- Active alerts
- Provider health

**Exit codes**: 0=healthy, 1=degraded, 2=critical

---

**[metrics-snapshot.sh](scripts/metrics-snapshot.sh)**
```bash
ops/scripts/metrics-snapshot.sh [output_file]
```
**Purpose**: Comprehensive diagnostics for incident analysis
**Captures**:
- System information
- Disk/memory usage
- Process status
- Database contents
- Job statistics
- Provider errors
- Network connectivity

**Output**: Text file with full diagnostic snapshot

---

**[emergency-backup.sh](scripts/emergency-backup.sh)**
```bash
ops/scripts/emergency-backup.sh [reason]
```
**Purpose**: Immediate backup before risky operations
**Backs up**:
- persistence.db
- metrics.db
- Job state files
**Includes**: Integrity verification

---

**[rollback.sh](scripts/rollback.sh)**
```bash
ops/scripts/rollback.sh <snapshot_id>
```
**Purpose**: Rollback to previous snapshot
**Steps**:
1. Verify target snapshot
2. Create emergency backup
3. Deprecate current snapshot
4. Activate rollback snapshot
5. Test IPFS retrieval

---

**[provider-health-check.sh](scripts/provider-health-check.sh)**
```bash
ops/scripts/provider-health-check.sh
```
**Purpose**: Test all external providers
**Tests**:
- Census TIGER (base + congressional)
- ArcGIS Hub (main + API)
- Sample state portals (CO, WI, MN)
- IPFS/Storacha gateways
- Latest snapshot retrieval

**Exit codes**: 0=all healthy, 1=some degraded, 2=multiple failures

---

## Usage Patterns

### Daily Operations

```bash
# Morning sanity check (5 min)
cd /Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas
ops/scripts/health-check.sh

# If issues detected
ops/scripts/metrics-snapshot.sh
# Review output, consult runbooks
```

### Incident Response

```bash
# 1. Acknowledge alert
pd ack <incident_id>

# 2. Quick assessment
ops/scripts/health-check.sh

# 3. Detailed diagnostics
ops/scripts/metrics-snapshot.sh > /tmp/incident-$(date +%s).txt

# 4. Follow runbook
# See: Quick Runbook Selector above

# 5. If rollback needed
ops/scripts/emergency-backup.sh "pre-rollback"
ops/scripts/rollback.sh <snapshot_id>
```

### Maintenance

```bash
# Before quarterly update
ops/scripts/emergency-backup.sh "pre-quarterly-update"
# Follow: runbooks/maintenance/quarterly-update.md

# Provider health check (weekly)
ops/scripts/provider-health-check.sh
```

---

## Contributing to Runbooks

**Found gaps? Suggestions?**
```bash
gh issue create \
  --label "ops-runbook,documentation" \
  --title "Runbook: [Topic]" \
  --body "[Description of gap or improvement]"
```

**After incidents**:
- Update relevant runbook with lessons learned
- Add new section if novel scenario
- Improve clarity based on confusion points

**Quarterly review**:
- Mark stale runbooks for update
- Validate scripts still work
- Update contact information

---

## Runbook Maturity Matrix

| Runbook | Status | Coverage | Last Tested |
|---------|--------|----------|-------------|
| Incident Response | ✅ Complete | 95% | 2025-12-18 |
| Data Corruption | ✅ Complete | 90% | 2025-12-18 |
| High Latency | ✅ Complete | 85% | 2025-12-18 |
| Upstream Failure | ✅ Complete | 90% | 2025-12-18 |
| IPFS Unavailable | ✅ Complete | 85% | 2025-12-18 |
| Quarterly Update | ✅ Complete | 80% | 2025-12-18 |
| Error Rate | 📝 Draft | 0% | N/A |
| Memory Exhaustion | 📝 Draft | 0% | N/A |
| Stuck Jobs | 📝 Draft | 0% | N/A |
| Merkle Rebuild | 📝 Draft | 0% | N/A |
| Backup/Restore | 📝 Draft | 0% | N/A |
| Scaling | 📝 Draft | 0% | N/A |

**Legend**:
- ✅ Complete: Ready for production use
- 📝 Draft: Placeholder, needs content
- 🔄 In Review: Under development
- ⚠️ Stale: Needs update

---

## Training & Onboarding

**New to on-call?**

**Week 1**:
- [ ] Read [OPS_README.md](OPS_README.md)
- [ ] Read [on-call-guide.md](on-call-guide.md)
- [ ] Run all scripts in test environment
- [ ] Shadow experienced engineer

**Week 2**:
- [ ] Review all P0/P1 runbooks
- [ ] Practice incident response in dev
- [ ] Test rollback procedure
- [ ] Participate in post-incident review

**Week 3**:
- [ ] Take secondary on-call shift
- [ ] Respond to P2/P3 alerts independently
- [ ] Review quarterly update procedure

**Week 4**:
- [ ] Take primary on-call shift (with backup)
- [ ] Complete full handoff cycle

---

## Version History

- **v1.0** (2025-12-18): Initial runbook suite
  - Core incident response runbooks complete
  - Essential operational scripts created
  - On-call guide and handoff templates ready

**Next milestones**:
- **v1.1** (Q1 2026): Complete TBD runbooks after quarterly update
- **v1.2** (Q2 2026): Add monitoring/dashboard guides
- **v2.0** (Q3 2026): Global expansion runbooks

---

## Quick Links

**Most Used Runbooks**:
1. [Incident Response](runbooks/incident-response.md)
2. [Data Corruption](runbooks/common-incidents/data-corruption.md)
3. [Upstream Failure](runbooks/common-incidents/upstream-failure.md)
4. [On-Call Guide](on-call-guide.md)

**Most Used Scripts**:
1. `ops/scripts/health-check.sh`
2. `ops/scripts/metrics-snapshot.sh`
3. `ops/scripts/rollback.sh`

**External References**:
- [OPERATIONAL-RUNBOOKS.md](../docs/OPERATIONAL-RUNBOOKS.md) (detailed technical runbooks)
- [FAILURE-RESOLUTION-PLAYBOOK.md](../docs/FAILURE-RESOLUTION-PLAYBOOK.md) (failure analysis)
- [QUARTERLY-AUTOMATION.md](../docs/QUARTERLY-AUTOMATION.md) (automation guide)

---

**Questions?** → #shadow-atlas (Slack)
**Emergency?** → [On-Call Guide](on-call-guide.md)
**Feedback?** → Create GitHub issue with label `ops-runbook`

---

**Last Updated**: 2025-12-18
**Next Review**: 2025-03-18 (Quarterly)
**Maintained By**: SRE Team
