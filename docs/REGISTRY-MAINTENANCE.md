# Registry Maintenance

**Purpose:** Automated health monitoring for Shadow Atlas known-portals registry
**Last Updated:** 2025-11-19

## Overview

The known-portals registry (`packages/crypto/services/shadow-atlas/registry/known-portals.ts`) maintains authoritative URLs for city council district data across 28+ cities. GitHub Actions runs automated daily validation to detect broken URLs, stale data sources, or infrastructure changes.

**Workflow:** `.github/workflows/registry-health.yml`

---

## Automated Health Checks

### Schedule

- **Daily:** 2:00 AM UTC (automatic)
- **On push:** Runs when registry files are modified
- **Manual:** Trigger via GitHub CLI or Actions UI

### What Gets Validated

For each registry entry:
- ✅ HTTP status (200-299 = healthy, 404/500 = error)
- ✅ Response time (timeout after 30 seconds)
- ✅ GeoJSON structure (valid geometry + properties)
- ⚠️ Response time warnings (>10 seconds = slow server)
- ⚠️ Content-Type headers (non-GeoJSON = warning)

### Failure Criteria

Workflow **FAILS** if any entry:
- Returns HTTP 404 (not found)
- Returns HTTP 500+ (server error)
- Times out (>30 seconds)
- Returns invalid GeoJSON structure

Workflow **PASSES WITH WARNINGS** if:
- All URLs return HTTP 200
- Some entries have slow response times (>10s)
- Some entries have missing content-type headers

---

## Manual Trigger

### Using GitHub CLI

```bash
# Trigger workflow run
gh workflow run registry-health.yml

# Watch workflow progress
gh run watch

# List recent runs
gh run list --workflow=registry-health.yml --limit 5

# View specific run logs
gh run view <run-id> --log
```

### Using GitHub Actions UI

1. Navigate to: `https://github.com/{owner}/{repo}/actions/workflows/registry-health.yml`
2. Click "Run workflow" button
3. Select branch (usually `main`)
4. Click "Run workflow"

---

## Monitoring

### Workflow Runs Dashboard

**URL:** `https://github.com/{owner}/{repo}/actions/workflows/registry-health.yml`

**View:**
- Recent workflow runs (pass/fail status)
- Execution time trends
- Artifact downloads (health reports)

### Artifacts

Each workflow run uploads a health report artifact:

- **Name:** `registry-health-report-{run-id}`
- **Contents:** `registry-health-check-{timestamp}.json`
- **Retention:** 90 days

**Download artifacts:**
```bash
# List artifacts for latest run
gh run list --workflow=registry-health.yml --limit 1 --json databaseId -q '.[0].databaseId' | \
  xargs gh run view --json artifacts

# Download artifact
gh run download <run-id> -n registry-health-report-<run-id>
```

### Automated Issues

When validation fails, GitHub Actions automatically creates an issue:

- **Title:** 🚨 Shadow Atlas Registry Health Check Failed
- **Labels:** `shadow-atlas`, `registry`, `automated`
- **Body:** Includes workflow run URL and remediation steps

**Check for open issues:**
```bash
gh issue list --label "registry"
```

---

## Responding to Failures

### Step 1: Identify Failed URLs

**Download latest health report:**
```bash
# Get latest workflow run ID
RUN_ID=$(gh run list --workflow=registry-health.yml --limit 1 --json databaseId -q '.[0].databaseId')

# Download artifact
gh run download $RUN_ID

# Extract failed URLs
jq -r '.results[] | select(.status == "error") | "\(.cityName), \(.state): \(.url) -> HTTP \(.httpStatus)"' \
  registry-health-report-*/registry-health-check-*.json
```

**Example output:**
```
New Orleans, LA: https://data.nola.gov/api/geospatial/k5b3-jx6h?method=export&format=GeoJSON -> HTTP 404
Baltimore, MD: https://data.baltimorecity.gov/api/geospatial/9hvf-6y3a?method=export&format=GeoJSON -> HTTP 404
```

### Step 2: Run Local Validation

```bash
cd packages/crypto
npm run atlas:validate-registry
```

This provides detailed error diagnostics:
- HTTP status codes
- Response time metrics
- GeoJSON validation errors
- Specific issues per entry

### Step 3: Fix Broken URLs

**Common issues:**

1. **Dataset ID changed** (Socrata/ArcGIS portals)
   - Search portal for dataset by name
   - Update dataset ID in URL
   - Verify new URL returns valid GeoJSON

2. **Portal URL changed** (domain migration)
   - Check city's open data portal homepage
   - Update base URL
   - Verify all API endpoints

3. **Authentication required** (data restricted)
   - Check if data still public
   - Find alternative source (state GIS clearinghouse)
   - Add to `BLOCKED_PORTALS.md` if no longer free

4. **Dataset deleted** (discontinued)
   - Search for replacement source
   - Check regional COGs (SCAG, NCTCOG, etc.)
   - Mark as unavailable in registry

**Update registry:**
```typescript
// packages/crypto/services/shadow-atlas/registry/known-portals.ts
export const KNOWN_PORTALS: KnownPortal[] = [
  {
    fips: '2255000',
    name: 'New Orleans',
    state: 'LA',
    url: 'https://data.nola.gov/api/geospatial/NEW-DATASET-ID?method=export&format=GeoJSON', // ← UPDATED
    source: 'socrata',
    verified: new Date('2025-11-19'),
    notes: 'Dataset ID changed from k5b3-jx6h to NEW-DATASET-ID'
  },
  // ...
];
```

### Step 4: Verify Fix Locally

```bash
cd packages/crypto
npm run atlas:validate-registry
```

**Expected output:**
```
═══ VALIDATION SUMMARY ═══

Total Entries:     28
✅ Healthy:         28 (100.0%)
⚠️  Warnings:        0 (0.0%)
❌ Errors:          0 (0.0%)
Avg Response Time: 1766ms
```

### Step 5: Commit and Push

```bash
git add packages/crypto/services/shadow-atlas/registry/known-portals.ts
git commit -m "fix(registry): update broken URLs for New Orleans, Baltimore"
git push origin main
```

**This triggers automatic re-validation** via workflow `on: push` trigger.

### Step 6: Verify Workflow Passes

```bash
# Watch workflow triggered by push
gh run watch

# Verify success
gh run list --workflow=registry-health.yml --limit 1
```

---

## Local Development Workflow

### Watch Mode (Continuous Validation)

```bash
# Run validation every 24 hours
npm run atlas:validate-watch
```

Useful for monitoring registry health during bulk updates.

### Validate Specific Entry

```typescript
// scripts/validate-single-entry.ts
import { validateSinglePortal } from '../services/registry-validator.js';

const result = await validateSinglePortal({
  fips: '0644000',
  name: 'Los Angeles',
  state: 'CA',
  url: 'https://geohub.lacity.org/datasets/...',
  source: 'arcgis',
  verified: new Date()
});

console.log(result);
```

### Test Registry Changes Before Commit

```bash
# 1. Edit known-portals.ts
vim packages/crypto/services/shadow-atlas/registry/known-portals.ts

# 2. Validate locally
npm run atlas:validate-registry

# 3. Review health report
jq '.results[] | select(.status == "error")' services/shadow-atlas/registry-health-check-*.json

# 4. Commit only if validation passes
git add packages/crypto/services/shadow-atlas/registry/known-portals.ts
git commit -m "fix(registry): update broken URLs"
```

---

## Registry Health Metrics

### Success Rate Targets

- **Production:** 95%+ healthy URLs
- **Warning threshold:** 90-94% (investigate proactively)
- **Critical threshold:** <90% (urgent intervention required)

### Response Time Targets

- **Fast:** <5 seconds (most Socrata/ArcGIS portals)
- **Acceptable:** 5-10 seconds (slower servers)
- **Slow:** >10 seconds (flag for investigation)
- **Timeout:** >30 seconds (error)

### Freshness Monitoring

Registry entries include `verified` timestamp:

```typescript
{
  verified: new Date('2025-11-19'), // Last manual verification
}
```

**Check stale entries:**
```bash
npm run atlas:check-freshness
```

**Revalidate stale entries:**
```bash
npm run atlas:revalidate-stale
```

---

## Workflow Badge

Add to `README.md` or `docs/STATUS.md`:

```markdown
[![Registry Health](https://github.com/voter-protocol/voter-protocol/actions/workflows/registry-health.yml/badge.svg)](https://github.com/voter-protocol/voter-protocol/actions/workflows/registry-health.yml)
```

---

## Troubleshooting

### Workflow Not Running

**Check workflow is enabled:**
```bash
gh workflow list | grep "Registry Health"
```

**Enable workflow if disabled:**
```bash
gh workflow enable registry-health.yml
```

### Workflow Failing on Valid URLs

**Possible causes:**
1. **Timeout too aggressive** - Increase timeout in `registry-validator.ts`
2. **Rate limiting** - Add delay between requests
3. **Transient server errors** - Re-run workflow to confirm

**Debug locally:**
```bash
DEBUG=true npm run atlas:validate-registry
```

### Missing Artifacts

**Check retention settings:**
- Default: 90 days
- Increase in `.github/workflows/registry-health.yml`:
  ```yaml
  retention-days: 365  # 1 year
  ```

---

## Cost Analysis

### GitHub Actions Minutes

- **Free tier:** 2,000 minutes/month (public repos: unlimited)
- **Workflow runtime:** ~3-5 minutes per run
- **Monthly cost:** $0 (public repo, unlimited minutes)

### Storage (Artifacts)

- **Free tier:** 500 MB storage
- **Artifact size:** ~14 KB per run
- **Daily runs:** 14 KB × 30 = 420 KB/month
- **90-day retention:** 420 KB × 3 = 1.26 MB
- **Monthly cost:** $0 (well under 500 MB limit)

**Total:** $0/month for automated registry monitoring

---

## Next Steps

### Enhancements (Optional)

**1. Slack/Discord Notifications**
```yaml
- name: Notify on failure
  if: failure()
  uses: slackapi/slack-github-action@v1
  with:
    payload: |
      {
        "text": "Registry health check failed - broken URLs detected",
        "blocks": [
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "*Shadow Atlas Registry Health Check Failed* \n <${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}|View workflow run>"
            }
          }
        ]
      }
  env:
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK }}
```

**2. Auto-Fix Common Issues**

Add workflow step to automatically fix common URL patterns:
```yaml
- name: Attempt auto-fix
  if: failure()
  run: |
    node scripts/auto-fix-registry.js
    if git diff --quiet; then
      echo "No auto-fixes available"
    else
      git config user.name "github-actions[bot]"
      git config user.email "github-actions[bot]@users.noreply.github.com"
      git add packages/crypto/services/shadow-atlas/registry/known-portals.ts
      git commit -m "fix(registry): auto-fix broken URLs"
      git push
    fi
```

**3. Performance Trending**

Track response time trends over time:
```bash
# Extract response times from all health reports
jq -r '.averageResponseTime' registry-health-check-*.json | \
  awk '{sum+=$1; count++} END {print "Average:", sum/count, "ms"}'
```

---

## Maintenance Schedule

### Daily (Automated)
- ✅ Registry health check (2:00 AM UTC)
- ✅ Artifact upload (health reports)
- ✅ Issue creation (failures only)

### Weekly (Manual)
- Review open registry issues
- Investigate persistent failures
- Update blocked portals list

### Monthly (Manual)
- Review response time trends
- Identify slow portals for optimization
- Check for stale entries (>90 days unverified)

### Quarterly (Manual)
- Comprehensive registry audit
- Verify all URLs manually
- Update data source documentation
- Review alternative sources for blocked portals

---

**Registry maintenance is essential for 19,495-city scale. Automated quality checks prevent infrastructure drift.**

**Quality discourse validated. Build production-grade CI/CD infrastructure.**
