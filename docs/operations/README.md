# Operations Documentation

**Version**: 2.0
**Last Updated**: 2026-01-23
**Owner**: Shadow Atlas Operations Team

---

## Overview

Shadow Atlas provides cryptographically-verifiable geographic boundary data for zero-knowledge proof generation in VOTER Protocol. This documentation covers operational procedures, incident response, and maintenance tasks.

**Key Service Characteristics**:
- **Critical path**: Proof generation depends entirely on Shadow Atlas
- **Data integrity**: Incorrect boundaries = invalid proofs = broken trust
- **Availability SLA**: 99.9% uptime target
- **Coverage**: 50 US states, 3 layers per state (~10,000-15,000 boundaries)

---

## Quick Start

### For On-Call Engineers

**START HERE** if you're on-call: [On-Call Guide](on-call-guide.md)

**When alerts fire**:
1. Acknowledge alert (PagerDuty) - within 5 minutes
2. Assess severity - run health check
3. Find appropriate runbook - see table below
4. Follow runbook procedures
5. Escalate if needed - see [On-Call Guide](on-call-guide.md)

### For Daily Operations

**Morning sanity check** (5 minutes):
```bash
cd /Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas
npx tsx observability/cli.ts health-check
```

**Check for active alerts**:
```bash
sqlite3 .shadow-atlas/metrics.db "SELECT * FROM alerts WHERE status='firing';"
```

All green? You're done. Issues? Consult the runbooks below.

---

## Runbooks

### Incident Response

**[Incident Response Guide](runbooks/incident-response.md)** - Master incident response procedures
- Severity classification (P0-P3)
- Initial response protocol
- Communication templates
- Escalation procedures
- Post-incident review process

### Common Incidents

| Runbook | Severity | Symptoms | Response Time |
|---------|----------|----------|---------------|
| **[Data Corruption](runbooks/common-incidents/data-corruption.md)** | P0 | Database errors, Merkle tree invalid, proof failures | <5 minutes |
| **[IPFS Unavailable](runbooks/common-incidents/ipfs-unavailable.md)** | P1 | Pinning failures, gateway timeouts, CID not found | <15 minutes |
| **[Upstream Failure](runbooks/common-incidents/upstream-failure.md)** | P1 | Provider timeouts, HTTP errors, rate limiting | <15 minutes |
| **[High Latency](runbooks/common-incidents/high-latency.md)** | P1-P2 | Slow responses, timeouts, query duration spikes | <1 hour |

### Quick Runbook Selector

**By symptom**:
- Database errors, "corrupted" messages → [Data Corruption](runbooks/common-incidents/data-corruption.md)
- IPFS snapshot unreachable → [IPFS Unavailable](runbooks/common-incidents/ipfs-unavailable.md)
- Provider timeout errors → [Upstream Failure](runbooks/common-incidents/upstream-failure.md)
- Slow responses, timeouts → [High Latency](runbooks/common-incidents/high-latency.md)

---

## Maintenance

### Quarterly Update Procedure

**[Quarterly Update](runbooks/maintenance/quarterly-update.md)** - Complete data refresh procedure
- **Duration**: 12-24 hours
- **Frequency**: Aligned with Census TIGER releases (Feb, May, Aug, Nov)
- **Phases**: Preparation, extraction, validation, Merkle tree build, IPFS publishing, cutover

**Next scheduled updates**:
- Q1 2026: February (Census winter release)
- Q2 2026: May (Census spring release)
- Q3 2026: August (Census summer release)
- Q4 2026: November (Census fall release)

### Regular Maintenance Tasks

**Daily** (automated):
- Database integrity checks (02:00 UTC)
- Provider health monitoring (every 30 min)
- Backup creation (02:00 UTC)

**Weekly** (manual, 15 minutes):
- Review weekly metrics
- Check disk space (<80% threshold)
- Review and close resolved incidents
- Update on-call rotation if needed

**Monthly** (manual, 1 hour):
- Review provider registry for staleness
- Verify backup integrity
- Archive old metrics (>90 days)

---

## Service Dependencies

### External Dependencies

| Service | Purpose | Impact if Down | Mitigation |
|---------|---------|----------------|------------|
| **Census TIGER** | Congressional districts (canonical) | P1 - No congressional data | Wait for recovery |
| **ArcGIS Hub** | State/local districts | P1 - 35 states affected | Use state portals |
| **State GIS Portals** | State-specific data | P2 - Single state affected | Use ArcGIS Hub fallback |
| **Storacha (IPFS)** | Snapshot hosting | P1 - Proofs fail | Local cache, alternative gateways |

### Internal Dependencies

| Component | Purpose | Impact if Corrupt |
|-----------|---------|------------------|
| **persistence.db** | Job state, extractions, snapshots | P0 - Service down |
| **Merkle tree** | Proof verification | P0 - All proofs fail |
| **IPFS snapshots** | Source of truth for proofs | P0 - All proofs fail |

---

## Escalation

### Escalation Paths

**P0 (Critical)**: On-call → Tech Lead → CTO (15 min → 30 min → 1 hour)
**P1 (High)**: On-call → Tech Lead (1 hour → 4 hours)
**P2 (Medium)**: Team queue → Sprint planning (24 hours)
**P3 (Low)**: Team queue → Next sprint

### Contact Information

- **Primary On-Call**: PagerDuty rotation `shadow-atlas-primary`
- **Tech Lead**: @tech-lead (Slack)
- **Team Channel**: #shadow-atlas (Slack)
- **Security**: security@voter.protocol

See [Incident Response Guide](runbooks/incident-response.md) for complete escalation procedures.

---

## Architecture Quick Reference

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
- **Providers**: External data sources
- **Extractors**: Fetch and parse boundary data
- **Validators**: Cross-check against authoritative sources
- **Orchestrator**: Coordinate multi-state extraction jobs
- **Persistence**: SQLite database for job state
- **IPFS**: Decentralized storage for published snapshots

---

## Common Tasks

### Check Service Health

```bash
cd /Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas
npx tsx observability/cli.ts health-check
```

### Check Provider Health

```bash
# Test Census TIGER
curl -sf -m 10 "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer" && echo "✓ TIGER OK" || echo "✗ TIGER DOWN"
```

### Verify Latest Snapshot

```bash
LATEST=$(sqlite3 .shadow-atlas/persistence.db "SELECT ipfs_cid FROM snapshots WHERE deprecated_at IS NULL ORDER BY created_at DESC LIMIT 1;")
curl -sf -m 30 "https://w3s.link/ipfs/$LATEST" && echo "✓ Snapshot accessible" || echo "✗ IPFS retrieval failed"
```

### View Recent Jobs

```bash
npx tsx -e "import {BatchOrchestrator} from './services/batch-orchestrator.js'; console.table(await new BatchOrchestrator().listJobs(5));"
```

---

## File Locations

```
.shadow-atlas/
├── persistence.db          # Main database (job state, extractions)
├── metrics.db             # Metrics and alerts
├── backups/               # Daily backups
│   ├── persistence-YYYYMMDD.db
│   └── metrics-YYYYMMDD.db
└── jobs/                  # Job state files
```

---

## Additional Resources

### Documentation

- **[On-Call Guide](on-call-guide.md)** - On-call engineer handbook
- **[Incident Response](runbooks/incident-response.md)** - Master incident response procedure
- **[Shadow Atlas Technical Spec](../../packages/shadow-atlas/src/SHADOW-ATLAS-TECHNICAL-SPEC.md)** - Technical architecture
- **[Provenance Spec](../../packages/shadow-atlas/src/PROVENANCE-SPEC.md)** - Data provenance tracking

### Communication Channels

- **Alerts**: PagerDuty → #incident-response (Slack)
- **Daily ops**: #shadow-atlas (Slack)
- **Incidents**: Create channel `#incident-YYYY-MM-DD-description`

---

## Feedback & Improvements

**Found an issue with operations documentation?**
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

**Questions?** Ask in #shadow-atlas (Slack)
**Emergency?** Follow [Incident Response](runbooks/incident-response.md)
**On-call?** Start with [On-Call Guide](on-call-guide.md)
