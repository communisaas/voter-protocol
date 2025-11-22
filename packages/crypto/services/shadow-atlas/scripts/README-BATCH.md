# Batch Discovery Scripts - Quick Reference

**Purpose**: Production-grade parallel discovery for 100-1000 cities

## Files in This Directory

| File | Purpose | Usage |
|------|---------|-------|
| `batch-discover.ts` | Production batch runner | `npm run atlas:discover-batch` |
| `batch-discover.test.ts` | Test suite (9 tests) | `npm test batch-discover.test.ts` |
| `demo-batch.ts` | Interactive demo | `npx tsx scripts/demo-batch.ts` |
| `README-BATCH.md` | This file | Documentation |

## Quick Start Commands

### 1. Discover Top 100 Cities (Recommended)

```bash
npm run atlas:discover-top100
```

**What it does:**
- Discovers council district boundaries for top 100 US cities by population
- Uses 20 parallel agents for fast execution
- Writes results to `batch-results-{timestamp}.json`
- Updates discovery state database automatically
- Logs provenance for all attempts

**Expected output:**
```
╔══════════════════════════════════════════════════════╗
║       SHADOW ATLAS BATCH DISCOVERY                  ║
╚══════════════════════════════════════════════════════╝

Strategy:     population
Concurrency:  20 agents
Total Cities: 100
Staging Mode: DISABLED

Processing batch 1...
  [1/100] New York, NY
  [2/100] Los Angeles, CA
  ...

╔══════════════════════════════════════════════════════╗
║       BATCH DISCOVERY COMPLETE                       ║
╚══════════════════════════════════════════════════════╝

Total Cities:    100
Successful:      72 (72.0%)
Not Found:       23 (23.0%)
Errors:          5 (5.0%)
Execution Time:  8.5s
Avg Time/City:   85ms
Throughput:      11.76 cities/sec
```

### 2. Discover State-by-State

```bash
# California
npm run atlas:discover-state -- --state=CA

# Texas
npm run atlas:discover-state -- --state=TX

# New York
npm run atlas:discover-state -- --state=NY
```

### 3. Custom Batch

```bash
npm run atlas:discover-batch -- \
  --strategy=population \
  --limit=50 \
  --concurrency=10
```

### 4. Staging Mode (High Throughput Testing)

```bash
npm run atlas:discover-staging
```

**What it does:**
- 100 parallel agents
- 1000 cities limit
- Staging mode enabled (zero lock contention)
- Safe for testing without production impact

## Command Options

### Strategy (`--strategy=<strategy>`)

| Strategy | Description | Use Case |
|----------|-------------|----------|
| `population` | Sort by population descending | Highest impact first (default) |
| `state` | Sort by state alphabetically | Geographic sweep |
| `random` | Random shuffle | Unbiased sampling |
| `alphabetical` | Sort by city name | Deterministic batches |
| `retry` | Retry failed discoveries | Re-attempt errors/not-found |

### Other Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--limit=<N>` | number | unlimited | Maximum cities to process |
| `--state=<STATE>` | string | all | Filter by state code (CA, TX, etc.) |
| `--concurrency=<N>` | number | 10 | Parallel agents (1-100+) |
| `--staging` | flag | false | Enable staging mode (no locks) |
| `--test` | flag | false | Dry run (no file writes) |
| `--include-known` | flag | false | Include already-discovered cities |

## Examples

### Example 1: Quick Test (10 Cities)

```bash
npm run atlas:discover-batch -- --limit=10 --concurrency=5
```

**Result**: 10 cities in ~30 seconds

### Example 2: California Deep Dive

```bash
npm run atlas:discover-batch -- --strategy=population --state=CA
```

**Result**: All California cities discovered

### Example 3: Random Sampling

```bash
npm run atlas:discover-batch -- --strategy=random --limit=20 --concurrency=10
```

**Result**: 20 random cities for unbiased testing

### Example 4: Retry Failed Discoveries

```bash
npm run atlas:discover-batch -- --strategy=retry --concurrency=20
```

**Result**: Re-attempts all error/not-found cities

## Output Files

### Results JSON

**Location**: `batch-results-{timestamp}.json`

**Format**:
```json
[
  {
    "fips": "0666000",
    "cityName": "San Diego",
    "success": true,
    "tier": 1,
    "confidence": 85,
    "blockerCode": null,
    "executionTime": 2345
  }
]
```

### Boundary GeoJSON

**Location**: `data/boundaries/US/council-districts/{STATE}/US_council-districts_{STATE}_{FIPS}.geojson`

**Format**: Standard GeoJSON FeatureCollection

### Provenance Logs

**Location**: `discovery-attempts/{YEAR-MONTH}/discovery-log-{DAY}.ndjson.gz`

**Format**: Newline-delimited JSON (compressed)

### Discovery State

**Location**: `data/discovery-state/discovery-state.db` (SQLite)

**Updates**: Automatic status changes (pending → found/not-found/error)

## Monitoring Progress

### Real-Time Progress

Watch the console for real-time updates:

```
[agt-001] San Diego                  ✅ TIER 1 (5.2% complete)
[agt-002] San Jose                   ✅ TIER 1 (10.4% complete)
[agt-003] Sacramento                 ❌ TIER X (15.6% complete)
```

### Final Metrics

```
Total Cities:    100
Successful:      72 (72.0%)
Not Found:       23 (23.0%)
Errors:          5 (5.0%)
Execution Time:  8.5s
Avg Time/City:   85ms
Throughput:      11.76 cities/sec
```

### Provenance Analysis

```bash
# Check success rate
zcat discovery-attempts/2025-11/*.ndjson.gz | \
  jq -r '.blocked // "success"' | \
  sort | uniq -c

# Find top blockers
zcat discovery-attempts/2025-11/*.ndjson.gz | \
  jq -r 'select(.blocked) | .blocked' | \
  sort | uniq -c | sort -rn
```

## Troubleshooting

### High Failure Rate (>50% not-found)

**Possible causes:**
- Portal APIs down
- Rate limiting
- Network issues

**Solutions:**
1. Reduce concurrency: `--concurrency=5`
2. Enable retry: `--strategy=retry`
3. Check portal health in provenance logs

### Slow Execution (<1 city/sec)

**Possible causes:**
- Network latency
- Low concurrency
- Lock contention

**Solutions:**
1. Increase concurrency: `--concurrency=20`
2. Use staging mode: `--staging`
3. Check network connection

### Lock Contention Errors

**Symptoms**: SQLite lock errors in logs

**Solutions:**
1. Enable staging mode: `--staging`
2. Reduce concurrency: `--concurrency=10`
3. Run merge after completion: `npm run shadow-atlas:merge-once`

## Performance Guidelines

### Concurrency Recommendations

| Use Case | Concurrency | Network Load | Risk |
|----------|-------------|--------------|------|
| Testing/debugging | 1-5 | Minimal | None |
| Production default | 10-20 | Moderate | Low |
| High throughput | 20-50 | High | Medium |
| Staging only | 50-100+ | Very high | High |

### Estimated Execution Times

| Cities | Concurrency | Est. Time |
|--------|-------------|-----------|
| 10 | 5 | ~30s |
| 50 | 10 | ~15s |
| 100 | 20 | ~30s |
| 500 | 50 | ~90s |
| 1000 | 100 | ~180s |

**Note**: Times assume ~2s avg discovery time per city

## Integration with Other Systems

### Discovery State Manager

The batch system queries and updates discovery state:

```typescript
import { DiscoveryStateManager } from '../discovery/state-manager.js';

const manager = new DiscoveryStateManager();

// Query cities
const cities = await manager.query({
  status: 'pending',
  limit: 100,
});

// Update status
await manager.updateStatus(city, 'found', {
  success: true,
  portal: { ... },
});
```

### Provenance Writer

Every discovery is logged automatically:

```typescript
import { appendProvenance } from '../services/provenance-writer.js';

await appendProvenance(
  {
    f: "0666000",
    n: "San Diego",
    s: "CA",
    g: 1,  // COUNCIL_DISTRICT
    conf: 85,
    auth: 3,  // MUNICIPAL_OFFICIAL
    // ... full provenance record
  },
  './discovery-attempts',
  { staging: false, agentId: 'discovery-worker-001' }
);
```

### Portal Discovery

Uses existing portal discovery provider:

```typescript
import { USCouncilDistrictDiscoveryProvider } from '../providers/us-council-district-discovery.ts';

const provider = new USCouncilDistrictDiscoveryProvider();

// Discover portals for a city
const result = await provider.discoverCity({
  name: "San Diego",
  state: "CA",
  fips: "0666000",
  population: 1386932,
});
```

## Testing

### Run Test Suite

```bash
npm test -- batch-discover.test.ts
```

**Expected output:**
```
✓ services/shadow-atlas/scripts/batch-discover.test.ts (9 tests) 18ms

Test Files  1 passed (1)
     Tests  9 passed (9)
  Duration  40ms
```

### Run Demo

```bash
npx tsx services/shadow-atlas/scripts/demo-batch.ts
```

**Expected output:**
```
╔══════════════════════════════════════════════════════╗
║   SHADOW ATLAS BATCH DISCOVERY DEMO                 ║
╚══════════════════════════════════════════════════════╝

✅ Loaded 50 cities

DEMO 1: Top 100 Cities by Population
DEMO 2: California Cities
DEMO 3: Texas Cities
DEMO 4: Random Sample
```

## Next Steps

### Immediate Actions

1. **Expand city database** to 1000 cities (currently 50)
   - Source: US Census Bureau 2020 population estimates
   - File: `data/us-cities-top-1000.json`

2. **Run production test**:
   ```bash
   npm run atlas:discover-top100
   ```

3. **Validate results**:
   - Check `batch-results-{timestamp}.json`
   - Review provenance logs for quality
   - Verify boundary files in `data/boundaries/`

### Future Enhancements

1. **Resume support**: Checkpoint batches and resume after interruption
2. **Smart retry**: Exponential backoff for transient errors
3. **Portal health monitoring**: Track portal uptime and success rates
4. **Adaptive concurrency**: Auto-tune based on network conditions
5. **Cost tracking**: Log API call costs per city
6. **Quality scoring**: Post-discovery validation with confidence scores

## Documentation

- **Complete Guide**: [BATCH-DISCOVERY-GUIDE.md](../BATCH-DISCOVERY-GUIDE.md)
- **Implementation Summary**: [BATCH-DISCOVERY-SUMMARY.md](../BATCH-DISCOVERY-SUMMARY.md)
- **Main README**: [README.md](../README.md)

## Support

For questions or issues:
1. Check [BATCH-DISCOVERY-GUIDE.md](../BATCH-DISCOVERY-GUIDE.md) troubleshooting section
2. Review provenance logs for blocker codes
3. Run in test mode first: `--test`
4. Use staging mode for safety: `--staging`

---

**Ready to scale**: Run `npm run atlas:discover-top100` to discover top 100 US cities
