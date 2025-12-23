# Shadow Atlas Runbooks

> **IMPORTANT:** Operational runbooks have been consolidated in `/ops/runbooks/`.
> This directory contains only the legacy Merkle root mismatch runbook for historical reference.

---

## Production Runbooks Location

**All current operational runbooks are located in:**

📂 **[/ops/runbooks/](../ops/runbooks/)**

### Primary Documents

- **[Incident Response Guide](../ops/runbooks/incident-response.md)** - Comprehensive P0-P3 procedures, escalation paths, war room protocols
- **[Common Incidents](../ops/runbooks/common-incidents/)** - Specific incident runbooks
- **[Maintenance Procedures](../ops/runbooks/maintenance/)** - Scheduled maintenance runbooks

---

## Available Runbooks

### Critical Incidents (P0)

1. **Data Corruption** - [ops/runbooks/common-incidents/data-corruption.md](../ops/runbooks/common-incidents/data-corruption.md)
   - SQLite database integrity failures
   - Backup restoration procedures
   - Response time: <5 minutes

2. **Merkle Root Mismatch** (Legacy) - [MERKLE-ROOT-MISMATCH.md](./MERKLE-ROOT-MISMATCH.md)
   - Original runbook (historical reference)
   - See updated version in ops/runbooks/common-incidents/

### High Priority Incidents (P1)

3. **IPFS Unavailable** - [ops/runbooks/common-incidents/ipfs-unavailable.md](../ops/runbooks/common-incidents/ipfs-unavailable.md)
   - IPFS gateway failures
   - Pinning service outages
   - Response time: <15 minutes

4. **Upstream Failure** - [ops/runbooks/common-incidents/upstream-failure.md](../ops/runbooks/common-incidents/upstream-failure.md)
   - TIGER API outages
   - State GIS portal failures
   - Response time: <15 minutes

### Medium Priority Incidents (P2)

5. **High Latency** - [ops/runbooks/common-incidents/high-latency.md](../ops/runbooks/common-incidents/high-latency.md)
   - Performance degradation
   - Query optimization
   - Response time: <1 hour

### Operational Procedures

6. **Quarterly Update** - [ops/runbooks/maintenance/quarterly-update.md](../ops/runbooks/maintenance/quarterly-update.md)
   - Scheduled Shadow Atlas updates
   - TIGER data refresh
   - Duration: 2-4 hours

---

## Quick Reference

### During an Incident

1. Check severity classification in [incident-response.md](../ops/runbooks/incident-response.md)
2. Follow appropriate runbook from [common-incidents/](../ops/runbooks/common-incidents/)
3. Use communication templates from incident-response guide
4. Complete post-incident review within 24 hours

### Escalation Paths

**P0 (Critical)**: On-call → Tech Lead → CTO (15 min → 30 min → 1 hour)
**P1 (High)**: On-call → Tech Lead (1 hour → 4 hours)
**P2 (Medium)**: Team queue → Sprint planning (24 hours)

See [incident-response.md](../ops/runbooks/incident-response.md) for complete escalation procedures.

### Maintenance Schedule

**Quarterly Updates**: Jan 1, Apr 1, Jul 1, Oct 1
See [quarterly-update.md](../ops/runbooks/maintenance/quarterly-update.md) for procedures.

---

## Migration Notes

**Previous Location**: This directory previously contained planned runbooks that were never created.
**Current Location**: All operational runbooks consolidated in `/ops/runbooks/` for better organization.
**Legacy Files**: MERKLE-ROOT-MISMATCH.md retained for historical reference.

---

**Document Version:** 2.0
**Last Updated:** 2025-12-19
**Next Review:** 2025-03-19
**Owner:** Shadow Atlas Operations Team
