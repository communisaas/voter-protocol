# Upstream Provider Failure Runbook

**Severity**: P1 (High) - P2 (Medium)
**Symptoms**: HTTP errors, timeouts, rate limiting, stale data
**Impact**: Extraction failures, partial job completion

---

## Quick Reference: Provider Impact Matrix

| Provider | States Affected | Layers | Fallback | Severity |
|----------|----------------|--------|----------|----------|
| Census TIGER | All 50 | Congressional | None (canonical) | P1 |
| ArcGIS Hub | ~35 | All | State portals | P1 |
| State GIS Portal | Single | All | Hub, TIGER | P2 |
| Direct MapServer | Single | Specific | Manual investigation | P2 |

---

## Detection

### Automated Alerts

```sql
-- Provider availability <95% over 1 hour
SELECT
  json_extract(labels_json, '$.provider') as provider,
  COUNT(*) as checks,
  AVG(value) as availability_pct,
  MAX(recorded_at) as last_check
FROM metrics
WHERE type = 'health_check'
  AND recorded_at >= datetime('now', '-1 hour')
GROUP BY provider
HAVING availability_pct < 0.95;
```

### Manual Health Check

```bash
# Test each critical provider
providers=(
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer"
  "https://hub.arcgis.com"
  "https://gis.colorado.gov/arcgis/rest/services"
)

for url in "${providers[@]}"; do
  echo "Testing $url"
  time curl -sf "$url" > /dev/null
  if [ $? -eq 0 ]; then
    echo "✓ Provider responsive"
  else
    echo "✗ Provider FAILED"
  fi
done
```

---

## Diagnostic Decision Tree

```
Provider HTTP error detected
  │
  ├─> HTTP 503 (Service Unavailable)
  │     └─> Transient outage → Wait & Retry
  │
  ├─> Timeout (no response)
  │     └─> Network issue → Check connectivity
  │
  ├─> HTTP 429 (Rate Limited)
  │     └─> Slow down → Implement backoff
  │
  ├─> HTTP 404 (Not Found)
  │     └─> URL changed → Update registry
  │
  ├─> HTTP 401/403 (Auth error)
  │     └─> Credentials issue → Check API keys
  │
  └─> SSL/TLS error
        └─> Certificate issue → Contact provider
```

---

## Recovery Procedures

### Case A: Census TIGER Outage (P1 - CRITICAL)

**Impact**: All congressional district data unavailable, no fallback

**Step 1: Confirm outage scope**

```bash
# Test TIGER endpoints
TIGER_BASE="https://tigerweb.geo.census.gov/arcgis/rest/services"

# Congressional districts
curl -sf "$TIGER_BASE/TIGERweb/tigerWMS_Current/MapServer/17" || echo "✗ Congressional FAILED"

# Check Census status page
curl -sf "https://www.census.gov/about/policies/privacy/data_stewardship/operational_environment.html"
```

**Step 2: Assess duration**

| Error | Typical Duration | Action |
|-------|-----------------|--------|
| HTTP 503 | 1-4 hours | Wait, scheduled maintenance |
| Timeout | 15-60 minutes | Network issue, retry |
| Complete outage | 4-24 hours | Major incident, halt jobs |

**Step 3: Pause affected jobs**

```bash
# List running jobs that will fail
npx tsx -e "
import { BatchOrchestrator } from './services/batch-orchestrator.js';
const orch = new BatchOrchestrator();
const jobs = await orch.listJobs(50);

const runningJobs = jobs.filter(j =>
  j.status === 'running' &&
  j.scopeLayers.includes('congressional')
);

console.log('Jobs to pause:', runningJobs.length);
console.table(runningJobs);
"

# Cancel jobs (they can be resumed later)
for job_id in job_abc123 job_def456; do
  npx tsx -e "
  import { BatchOrchestrator } from './services/batch-orchestrator.js';
  await new BatchOrchestrator().cancelJob('$job_id');
  "
done
```

**Step 4: Monitor for recovery**

```bash
# Auto-retry script
while true; do
  if curl -sf "$TIGER_BASE/TIGERweb/tigerWMS_Current/MapServer/17" > /dev/null; then
    echo "✓ TIGER recovered at $(date)"
    # Send notification
    break
  fi
  echo "TIGER still down, next check in 5 minutes..."
  sleep 300
done
```

**Step 5: Resume jobs after recovery**

```bash
# Resume paused jobs
for job_id in job_abc123 job_def456; do
  npx tsx -e "
  import { BatchOrchestrator } from './services/batch-orchestrator.js';
  const result = await new BatchOrchestrator().resumeJob('$job_id');
  console.log('Resumed $job_id:', result.status);
  "
done
```

**Escalation**: If TIGER down >4 hours, escalate to Tech Lead (may need quarterly snapshot delay)

---

### Case B: ArcGIS Hub Outage (P1)

**Impact**: State/local layers unavailable for ~35 states

**Step 1: Confirm Hub vs individual server outage**

```bash
# Test Hub API
curl -sf "https://hub.arcgis.com/api/v3/datasets?filter[query]=council%20districts" || echo "✗ Hub API FAILED"

# Test direct ArcGIS Online
curl -sf "https://www.arcgis.com/sharing/rest/info?f=json" || echo "✗ ArcGIS Online FAILED"

# Check Esri status
open "https://status.arcgis.com/"
```

**Step 2: Switch to fallback providers**

```bash
# Use state-specific portals instead of Hub
npx tsx -e "
import { StateBatchExtractor } from './providers/state-batch-extractor.js';

const extractor = new StateBatchExtractor({
  preferStatePortals: true,  // Bypass Hub
  useDirectMapServers: true, // Use state GIS directly
});

// Re-run failed extractions
const states = ['WI', 'MN', 'CO'];
for (const state of states) {
  const result = await extractor.extractLayer(state, 'state_senate');
  console.log(\`\${state}: \${result.success ? '✓' : '✗'}\`);
}
"
```

**Step 3: Update job configuration**

```bash
# Resume job with fallback config
npx tsx -e "
import { BatchOrchestrator } from './services/batch-orchestrator.js';
const orch = new BatchOrchestrator({
  preferStatePortals: true,
  skipHubDiscovery: true,
  maxRetries: 5,
});

const result = await orch.resumeJob('${JOB_ID}');
console.log('Resumed with fallback:', result.status);
"
```

**Expected**: 70-80% of states have direct portal fallbacks

**Manual fallback**: For states without portals, extract manually and add to registry

---

### Case C: State GIS Portal Outage (P2)

**Impact**: Single state affected

**Step 1: Verify outage scope**

```bash
# Example: Colorado GIS portal down
curl -sf "https://gis.colorado.gov/arcgis/rest/services" || echo "✗ CO Portal FAILED"

# Check if it's just one service or entire portal
curl -sf "https://gis.colorado.gov/arcgis/rest/services/DOLA/DistrictBoundaries/MapServer"
```

**Step 2: Try alternative sources for that state**

```typescript
// Check registry for alternative sources
import { STATE_GIS_PORTALS } from './registry/state-gis-portals.js';

const colorado = STATE_GIS_PORTALS['CO'];
console.log('CO alternative sources:', colorado.fallbackUrls);

// Try each fallback
for (const url of colorado.fallbackUrls || []) {
  const response = await fetch(url);
  if (response.ok) {
    console.log('✓ Fallback available:', url);
  }
}
```

**Step 3: Document and defer**

```bash
# If no fallback available, mark for manual investigation
sqlite3 .shadow-atlas/persistence.db "
INSERT INTO not_configured (id, job_id, state_code, layer_type, reason, checked_at)
VALUES (
  'nc_provider_outage_$(date +%s)',
  '${JOB_ID}',
  'CO',
  'state_senate',
  'provider_temporarily_unavailable',
  datetime('now')
);
"

# Create follow-up task
gh issue create \
  --title "CO state portal outage - retry extraction" \
  --body "Colorado GIS portal unavailable. Retry after recovery." \
  --label "provider-outage,ops"
```

---

### Case D: Rate Limiting (HTTP 429)

**Symptoms**: Intermittent failures, "rate limit exceeded" errors

**Step 1: Identify rate-limited provider**

```bash
# Check error patterns
sqlite3 .shadow-atlas/metrics.db "
SELECT
  json_extract(labels_json, '$.provider') as provider,
  json_extract(labels_json, '$.error') as error,
  COUNT(*) as occurrences,
  MIN(recorded_at) as first_seen,
  MAX(recorded_at) as last_seen
FROM metrics
WHERE type = 'provider_error'
  AND recorded_at >= datetime('now', '-1 hour')
  AND json_extract(labels_json, '$.error') LIKE '%429%'
GROUP BY provider, error;
"
```

**Step 2: Implement exponential backoff**

```typescript
// Temporary rate limiting workaround
import { BatchOrchestrator } from './services/batch-orchestrator.js';

const orch = new BatchOrchestrator({
  concurrency: 1,           // Reduce to 1 at a time
  delayBetweenTasks: 5000,  // 5s delay between requests
  maxRetries: 10,           // More retries
  retryBackoff: 'exponential', // Exponential backoff
});

await orch.resumeJob(process.env.JOB_ID);
```

**Step 3: Long-term fix**

```typescript
// Add rate limiter to provider client
import pLimit from 'p-limit';

class ProviderClient {
  private rateLimiter = pLimit(3); // Max 3 concurrent requests

  async fetch(url: string) {
    return this.rateLimiter(async () => {
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1s delay
      return fetch(url);
    });
  }
}
```

---

### Case E: URL Changed (HTTP 404)

**Symptoms**: Persistent 404 errors, data previously available

**Step 1: Investigate new URL**

```bash
# Common patterns for URL changes:
# Old: /arcgis/rest/services/OpenData/MapServer/5
# New: /arcgis/rest/services/OpenData_v2/MapServer/5

# Try common variations
BASE="https://gis.colorado.gov/arcgis/rest/services"
for suffix in "OpenData" "OpenData_v2" "GovData" "PublicData"; do
  curl -sf "$BASE/$suffix/MapServer/5" && echo "✓ Found at $suffix"
done
```

**Step 2: Update registry**

```typescript
// registry/state-gis-portals.ts
export const STATE_GIS_PORTALS: StateGISRegistry = {
  'CO': {
    stateName: 'Colorado',
    mainPortal: 'https://gis.colorado.gov',
    layers: {
      congressional: {
        url: 'https://gis.colorado.gov/arcgis/rest/services/GovData/MapServer/5', // UPDATED
        featureCount: 8,
        lastValidated: '2025-12-18',
      },
    },
  },
};
```

**Step 3: Verify and re-extract**

```bash
# Test new URL
npx tsx -e "
import { StateBatchExtractor } from './providers/state-batch-extractor.js';
const result = await new StateBatchExtractor().extractLayer('CO', 'congressional');
console.log('Extraction with new URL:', result.success ? '✓' : '✗');
"
```

---

## Provider-Specific Contact Information

### Census TIGER
- **Status Page**: https://www.census.gov/about/policies/privacy/data_stewardship/operational_environment.html
- **Support**: https://www.census.gov/about/contact-us.html
- **Expected Maintenance**: Quarterly (aligned with data releases)

### Esri ArcGIS
- **Status Page**: https://status.arcgis.com/
- **Support**: https://support.esri.com/
- **Expected Maintenance**: Monthly (typically weekends)

### State GIS Portals
- **Colorado**: https://gis.colorado.gov, support@gis.colorado.gov
- **Wisconsin**: https://geodata.wisc.edu
- **Minnesota**: https://gisdata.mn.gov
- (Add more as needed)

---

## Monitoring & Prevention

### Provider Health Checks

```bash
# Add to daily cron
# ops/scripts/provider-health-check.sh
#!/bin/bash

PROVIDERS=(
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer"
  "https://hub.arcgis.com/api/v3/datasets"
  "https://gis.colorado.gov/arcgis/rest/services"
)

for url in "${PROVIDERS[@]}"; do
  if curl -sf -m 10 "$url" > /dev/null; then
    echo "✓ $(date +%H:%M) - $url"
  else
    echo "✗ $(date +%H:%M) - $url FAILED"
    # Send alert
  fi
done
```

### Fallback Registry Maintenance

```bash
# Quarterly: Verify all fallback URLs work
npx tsx -e "
import { STATE_GIS_PORTALS } from './registry/state-gis-portals.js';

for (const [stateCode, config] of Object.entries(STATE_GIS_PORTALS)) {
  if (config.fallbackUrls) {
    for (const url of config.fallbackUrls) {
      const response = await fetch(url, { method: 'HEAD' });
      console.log(\`\${stateCode} fallback \${url}: \${response.ok ? '✓' : '✗'}\`);
    }
  }
}
"
```

### Circuit Breaker Pattern

```typescript
// Implement circuit breaker for failing providers
class ProviderCircuitBreaker {
  private failures = new Map<string, number>();
  private readonly threshold = 5;

  async call(provider: string, fn: () => Promise<any>) {
    if (this.failures.get(provider) >= this.threshold) {
      throw new Error(`Circuit breaker open for ${provider}`);
    }

    try {
      const result = await fn();
      this.failures.set(provider, 0); // Reset on success
      return result;
    } catch (error) {
      const count = (this.failures.get(provider) || 0) + 1;
      this.failures.set(provider, count);
      throw error;
    }
  }
}
```

---

## Escalation Criteria

**Escalate to Tech Lead if**:
- Census TIGER down >4 hours (quarterly snapshot at risk)
- Multiple providers down simultaneously
- No fallback available for critical state
- Provider outage during quarterly extraction window

**Escalation template**:
```markdown
@tech-lead - Provider outage escalation

**Provider**: [Census TIGER / ArcGIS Hub / State portal]
**Duration**: [Hours down]
**Impact**: [States/layers affected]

**Fallback Status**:
- Alternative sources available: [Yes/No]
- Jobs paused: [Count]
- Data loss risk: [Yes/No]

**Provider Status**:
- Status page: [Link]
- Estimated recovery: [Time or "Unknown"]

**Recommendation**: [Wait / Use fallback / Delay quarterly snapshot]
```

---

## Success Criteria

- [ ] Provider responsive (HTTP 200, <2s response time)
- [ ] No 429 rate limit errors in last hour
- [ ] Failed jobs resumed successfully
- [ ] No data loss
- [ ] Registry updated if URLs changed
- [ ] Fallback sources verified

---

**Related Runbooks**:
- [High Latency](high-latency.md)
- [Error Rate Investigation](error-rate.md)
- [Quarterly Update](../maintenance/quarterly-update.md)

**Last Updated**: 2025-12-18
