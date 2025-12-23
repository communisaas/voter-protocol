# Integration Tests

Network-dependent validation against real external APIs.

## Test Strategy

Integration tests validate Shadow Atlas components against external data sources:

1. **ArcGIS Hub Ground Truth** - Discovery pipeline recall and precision using Montana dataset
2. **TIGERweb Shapefile Validation** - Production API matches official Census shapefiles

## Running Integration Tests

```bash
# Run all integration tests (skipped by default in CI)
npm run test:integration

# Run in CI with integration tests enabled
RUN_INTEGRATION=true npm test

# Run specific integration test
npm test arcgis-hub-ground-truth
```

## Test Tiers

### Integration Tests (this directory)
- **Runtime**: 3-5 minutes per test file
- **Network**: Required (queries external APIs)
- **Rate Limiting**: 500ms delay between requests
- **Schedule**: Nightly CI runs
- **Skip Control**: Set `RUN_INTEGRATION=false` to skip

### E2E Tests (`__tests__/e2e/`)
- **Runtime**: 10-30 minutes
- **Network**: Required (full multi-state validation)
- **Rate Limiting**: Conservative delays to avoid 429s
- **Schedule**: Nightly only
- **Skip Control**: Requires `RUN_E2E=true` explicitly

### Unit Tests (`**/*.test.ts` outside `__tests__/`)
- **Runtime**: <1 second per file
- **Network**: None (mocked)
- **Schedule**: Every commit
- **Skip Control**: Never skipped

## Ground Truth Data

### Montana Dataset
Verified via subagent research (2025-11-22):

**Ward-based cities** (expect to find boundaries):
- Missoula (6 wards)
- Billings (5 wards)
- Kalispell (4 wards)
- Belgrade (3 wards)
- Havre (4 wards, corrected from 3)
- Laurel (4 wards, corrected from 3)

**District-based cities** (consolidated city-counties):
- Helena (7 districts)
- Butte-Silver Bow (12 districts)
- Anaconda-Deer Lodge County (5 districts)

**At-large cities** (expect NO boundaries):
- Great Falls, Bozeman, Livingston, Whitefish, Miles City

### Expected Metrics
- **Recall**: 80%+ (find ward/district cities)
- **Precision**: 80%+ (avoid at-large false positives)

## TIGERweb API Validation

Validates production API against official counts:

**Data Sources**:
- TIGERweb REST API: https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0
- Official Registry: `registry/official-district-counts.ts`
- Ground Truth: TIGER/Line 2024 shapefiles (119th Congress)

**Test States**:
- Montana (MT): 2 districts (gained 1 in 2020)
- Wisconsin (WI): 8 districts (stable)
- Texas (TX): 38 districts (gained 2 in 2020)
- California (CA): 52 districts (lost 1 in 2020)

**Validation**:
- Exact count match against official registry
- GeoJSON structure validation
- Required properties present
- Total 435 congressional seats

## Rate Limiting

All integration tests respect external API rate limits:

```typescript
import { delay, API_RATE_LIMIT_MS, retryWithBackoff } from '../setup.js';

// Delay between requests
await delay(API_RATE_LIMIT_MS); // 500ms

// Retry with exponential backoff
const data = await retryWithBackoff(() => fetchData());
```

## Type Safety

Integration tests enforce nuclear-level TypeScript strictness:

```typescript
// ✅ CORRECT - Proper typing
interface TIGERwebResponse {
  readonly type: 'FeatureCollection';
  readonly features: readonly TIGERwebFeature[];
}

const data = (await response.json()) as TIGERwebResponse;

// ❌ FORBIDDEN - No loose typing
const data: any = await response.json();
const data = await response.json() as any;
```

## Debugging Failed Tests

### ArcGIS Hub failures
Check:
1. API availability (https://hub.arcgis.com)
2. Search terms match expected format
3. Ground truth data still accurate
4. Rate limiting not triggered

### TIGERweb failures
Check:
1. API endpoint availability
2. FIPS codes correct
3. Official registry up to date
4. Reapportionment changes reflected

## Adding New Integration Tests

1. Create test file in `__tests__/integration/`
2. Use `describe.skipIf(skipInCI)` for skip control
3. Import helpers from `../setup.js`
4. Add 500ms rate limiting between API calls
5. Set 30s timeout per test
6. Document expected runtime in header
7. Use strict TypeScript types (no `any`)

## Migration from Scripts

These integration tests replace one-time validation scripts:

| Script | Migrated To | Status |
|--------|-------------|--------|
| `test-ground-truth.ts` | `arcgis-hub-ground-truth.test.ts` | ✅ Migrated |
| `tiger-ground-truth.ts` | `tigerweb-shapefile-validation.test.ts` | ✅ Migrated |
| `compare-tiger-sources.ts` | `tigerweb-shapefile-validation.test.ts` | ✅ Migrated |

Archived scripts preserved in `scripts/archived/` for reference.
