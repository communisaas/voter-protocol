# TIGER Extraction Service

**Single entry point for all Census TIGER data operations.**

Consolidates fragmented TIGER access into production-grade service with caching, validation, and progress reporting.

---

## Overview

The `TIGERExtractionService` unifies three previously scattered approaches to TIGER data:

1. **CensusTigerLoader** - TIGERweb REST API for point queries
2. **TIGERBoundaryProvider** - Census FTP for bulk downloads
3. **load-census-tiger-places.ts** - Script for loading places

Now: **One service. One API. Full coverage.**

---

## Features

### Unified Operations
- **Point queries** - Find all boundaries containing a coordinate
- **State extraction** - Download complete boundary sets for a state
- **National extraction** - Download nationwide datasets for a layer
- **Validation** - Automatic verification against official counts

### Engineering Excellence
- **Aggressive caching** - Persistent disk cache with checksum verification
- **Rate limiting** - Configurable delays between requests
- **Retry logic** - Exponential backoff for network resilience
- **Progress reporting** - Real-time events for long-running operations
- **Type safety** - Zero `any` types, readonly interfaces throughout

### Supported Layers

| Layer Type | Count | Authority |
|-----------|-------|-----------|
| `congressional` | 435 | Census TIGER (federal mandate) |
| `state_senate` | 1,972 | Census TIGER (state boundaries) |
| `state_house` | 5,411 | Census TIGER (state boundaries) |
| `county` | 3,143 | Census TIGER (universal fallback) |
| `place` | 19,495 | Census PLACE (incorporated cities) |
| `cdp` | ~9,000 | Census PLACE (unincorporated) |
| `school_unified` | ~13,000 | Census SCHOOL (unified districts) |
| `school_elementary` | ~10,000 | Census SCHOOL (elementary) |
| `school_secondary` | ~500 | Census SCHOOL (secondary) |

---

## Usage

### Quick Start

```typescript
import { TIGERExtractionService } from './services/tiger-extraction-service.js';

const service = new TIGERExtractionService({
  cacheDir: '.shadow-atlas/tiger-cache',
  year: 2024,
  rateLimitMs: 100,
});

// Query point
const results = await service.queryPoint(37.7749, -122.4194);
console.log(`Found ${results.length} layers`);

// Extract state
const caResults = await service.extractState('06', ['congressional', 'state_senate']);
console.log(`California: ${caResults[0].features.length} congressional districts`);

// Extract national
const national = await service.extractNational('congressional');
console.log(`National: ${national.features.length} total districts`);
```

### Progress Reporting

```typescript
service.setProgressCallback((event) => {
  console.log(`[${event.operation}] ${event.currentItem}`);
  console.log(`Progress: ${event.percentage.toFixed(1)}% (${event.completed}/${event.total})`);
});

const results = await service.extractState('48', ['congressional', 'state_senate']);
```

Output:
```
[download] Texas - congressional
Progress: 0.0% (0/2)
[convert] Texas - congressional
Progress: 25.0% (0/2)
[validate] Texas - congressional
Progress: 50.0% (1/2)
[download] Texas - state_senate
Progress: 50.0% (1/2)
...
```

### Validation

```typescript
const result = await service.extractState('06', ['congressional']);
const validation = await service.validate(result[0]);

if (!validation.valid) {
  console.error(`Validation failed: ${validation.summary}`);
  console.error(`Expected: ${validation.expected}, Actual: ${validation.actual}`);
  console.error(`Difference: ${validation.countValidation.difference}`);
  console.error(`Confidence: ${validation.countValidation.confidence}`);
}
```

### Statistics Tracking

```typescript
// Extract multiple states
await service.extractState('06', ['congressional']);
await service.extractState('48', ['congressional']);
await service.extractState('36', ['congressional']);

// Get statistics
const stats = service.getStats();
console.log(`Total requests: ${stats.totalRequests}`);
console.log(`Cache hits: ${stats.cacheHits}`);
console.log(`Cache misses: ${stats.cacheMisses}`);
console.log(`Failed requests: ${stats.failedRequests}`);
console.log(`Total time: ${(stats.totalTimeMs / 1000).toFixed(2)}s`);
console.log(`Bytes downloaded: ${(stats.bytesDownloaded / 1024 / 1024).toFixed(2)} MB`);
```

---

## API Reference

### Constructor

```typescript
new TIGERExtractionService(options?: TIGERExtractionOptions)
```

**Options:**
- `cacheDir?: string` - Cache directory (default: `.shadow-atlas/tiger-cache`)
- `year?: number` - TIGER year (default: `2024`)
- `rateLimitMs?: number` - Milliseconds between requests (default: `100`)
- `maxRetries?: number` - Maximum retry attempts (default: `3`)
- `forceRefresh?: boolean` - Bypass cache (default: `false`)

### Methods

#### queryPoint

```typescript
async queryPoint(lat: number, lng: number): Promise<TIGERLayerResult[]>
```

Query all TIGER layers for a point. Returns boundaries sorted by precision (finest first).

**Parameters:**
- `lat` - Latitude (WGS84)
- `lng` - Longitude (WGS84)

**Returns:** Array of layer results containing the point

**Example:**
```typescript
// San Francisco City Hall
const results = await service.queryPoint(37.7794, -122.4193);

for (const result of results) {
  console.log(`${result.layer}:`);
  for (const feature of result.features) {
    console.log(`  - ${feature.name} (${feature.id})`);
  }
}
```

---

#### extractState

```typescript
async extractState(
  stateFips: string,
  layers?: readonly TIGERLayerType[]
): Promise<TIGERLayerResult[]>
```

Extract complete boundary sets for a state. Results validated against official counts.

**Parameters:**
- `stateFips` - State FIPS code (2 digits, e.g., `"06"` for California)
- `layers` - Layers to extract (default: `['congressional', 'state_senate', 'state_house', 'county']`)

**Returns:** Array of layer results, one per requested layer

**Example:**
```typescript
// Extract all California legislative boundaries
const results = await service.extractState('06');

for (const result of results) {
  const { layer, features, metadata } = result;
  console.log(`\n${layer.toUpperCase()}`);
  console.log(`Features: ${features.length}`);
  console.log(`Expected: ${metadata.expectedCount}`);
  console.log(`Valid: ${metadata.isComplete ? '✅' : '❌'}`);
  console.log(`Confidence: ${(metadata.validation.confidence * 100).toFixed(0)}%`);
}
```

---

#### extractNational

```typescript
async extractNational(layer: TIGERLayerType): Promise<TIGERLayerResult>
```

Extract nationwide boundaries for a single layer. Validates against total expected count.

**Parameters:**
- `layer` - Layer to extract

**Returns:** Layer result with all national features

**Example:**
```typescript
// Extract all 435 congressional districts
const result = await service.extractNational('congressional');

console.log(`Total districts: ${result.features.length}`);
console.log(`Expected: ${result.metadata.expectedCount}`);
console.log(`Complete: ${result.metadata.isComplete}`);

// Group by state
const byState = new Map<string, number>();
for (const feature of result.features) {
  const state = feature.properties.stateFips as string;
  byState.set(state, (byState.get(state) || 0) + 1);
}

console.log('\nDistricts per state:');
for (const [state, count] of byState.entries()) {
  console.log(`  ${state}: ${count}`);
}
```

---

#### validate

```typescript
async validate(result: TIGERLayerResult): Promise<ValidationResult>
```

Validate extraction against official counts.

**Parameters:**
- `result` - Layer result to validate

**Returns:** Validation result with detailed diagnostics

**Example:**
```typescript
const extraction = await service.extractState('48', ['state_senate']);
const validation = await service.validate(extraction[0]);

if (!validation.valid) {
  console.error('VALIDATION FAILED');
  console.error(`Expected: ${validation.expected}`);
  console.error(`Actual: ${validation.actual}`);
  console.error(`Difference: ${validation.countValidation.difference}`);
  console.error(`Missing GEOIDs: ${validation.missingGEOIDs.join(', ')}`);
  console.error(`Extra GEOIDs: ${validation.extraGEOIDs.join(', ')}`);
}
```

---

#### getStats

```typescript
getStats(): TIGERExtractionStats
```

Get cumulative statistics for all operations.

**Returns:** Statistics object

---

#### setProgressCallback

```typescript
setProgressCallback(callback: (event: TIGERProgressEvent) => void): void
```

Set progress callback for long-running operations.

**Parameters:**
- `callback` - Function called with progress events

---

#### clearCache

```typescript
async clearCache(): Promise<void>
```

Remove all cached extraction results.

---

## Cache Structure

```
.shadow-atlas/tiger-cache/
├── 2024/                        # TIGER year
│   ├── CD/                      # Congressional districts
│   │   ├── national.geojson     # Cached national data
│   │   ├── tl_2024_us_cd.zip    # Raw shapefile
│   │   └── 06.geojson           # Cached state data
│   ├── SLDU/                    # State legislative upper
│   ├── SLDL/                    # State legislative lower
│   └── COUNTY/                  # Counties
└── results/                     # Cached extraction results
    ├── state_06_congressional_2024.json
    ├── state_48_state_senate_2024.json
    └── national_congressional_2024.json
```

---

## Validation Against Official Counts

The service validates all extractions against authoritative counts from `/registry/official-district-counts.ts`:

### Congressional Districts (435 total)
- Source: 2020 Census Apportionment
- Fixed by Public Law 62-5 (1911)
- Updated every 10 years after census

### State Legislative Districts
- Source: Census TIGER/Line shapefiles
- Upper chamber: 1,972 total districts
- Lower chamber: 5,411 total districts
- Nebraska: Unicameral (49 senators, no house)

### Counties (3,143 total)
- Source: Census TIGER/Line 2024
- Includes county equivalents (parishes, boroughs, etc.)

### Validation Confidence Scoring

| Difference | Confidence | Interpretation |
|-----------|-----------|----------------|
| 0 | 100% | Perfect match |
| ±1 | 70% | Minor discrepancy (possible boundary change) |
| ±2+ | 0% | Major discrepancy (data integrity issue) |

**Example:**
```typescript
const result = await service.extractState('06', ['congressional']);
const validation = result[0].metadata.validation;

console.log(`California congressional districts:`);
console.log(`Expected: ${validation.expected}`);  // 52
console.log(`Actual: ${validation.actual}`);      // 52
console.log(`Valid: ${validation.isValid}`);      // true
console.log(`Confidence: ${validation.confidence * 100}%`); // 100%
```

---

## Error Handling

The service implements exponential backoff retry for network resilience:

```typescript
// Failed requests are retried with exponential backoff
const service = new TIGERExtractionService({
  maxRetries: 3,  // Maximum retry attempts
});

try {
  const result = await service.extractState('06', ['congressional']);
} catch (error) {
  console.error('Extraction failed after retries:', error);

  const stats = service.getStats();
  console.error(`Failed requests: ${stats.failedRequests}`);
}
```

**Retry behavior:**
- Attempt 1: Immediate
- Attempt 2: +1 second delay
- Attempt 3: +2 second delay
- Attempt 4: +4 second delay

---

## Performance Considerations

### Rate Limiting

TIGERweb REST API has undocumented rate limits. The service defaults to 100ms between requests:

```typescript
const service = new TIGERExtractionService({
  rateLimitMs: 100,  // Conservative default
});
```

For batch operations, increase delay:
```typescript
const service = new TIGERExtractionService({
  rateLimitMs: 500,  // Safe for large batch jobs
});
```

### Caching Strategy

The service aggressively caches to minimize API load:

1. **Result cache** - Parsed, validated results (`.shadow-atlas/tiger-cache/results/`)
2. **Raw data cache** - Downloaded shapefiles (`.shadow-atlas/tiger-cache/2024/`)
3. **In-memory cache** - CensusTigerLoader internal cache

**Cache invalidation:**
- Manual: `service.clearCache()`
- Automatic: Change `year` option (e.g., `2024` → `2025`)

### Download Sizes

Approximate compressed shapefile sizes:

| Layer | National | Per State |
|-------|----------|-----------|
| Congressional | 180 MB | 3-8 MB |
| State Senate | 350 MB | 5-15 MB |
| State House | 450 MB | 7-20 MB |
| Counties | 95 MB | 1-4 MB |

**Recommendation:** Extract state-by-state rather than national for faster downloads.

---

## Integration Examples

### CLI Usage

```typescript
#!/usr/bin/env tsx
import { TIGERExtractionService } from './services/tiger-extraction-service.js';

const service = new TIGERExtractionService();

service.setProgressCallback((event) => {
  console.log(`[${event.percentage.toFixed(0)}%] ${event.currentItem}`);
});

const stateFips = process.argv[2];
const results = await service.extractState(stateFips);

for (const result of results) {
  console.log(`\n${result.layer}: ${result.metadata.isComplete ? '✅' : '❌'}`);
  console.log(`  Features: ${result.features.length}/${result.metadata.expectedCount}`);
}
```

Run:
```bash
npx tsx extract-state.ts 06
```

---

### Batch State Extraction

```typescript
import { TIGERExtractionService } from './services/tiger-extraction-service.js';

const service = new TIGERExtractionService({
  rateLimitMs: 500,  // Conservative for batch
});

const states = ['06', '48', '36', '12', '17']; // CA, TX, NY, FL, IL

for (const state of states) {
  console.log(`\nExtracting ${state}...`);

  const results = await service.extractState(state, ['congressional']);
  const result = results[0];

  console.log(`${result.features.length} districts`);
  console.log(`Valid: ${result.metadata.isComplete ? '✅' : '❌'}`);
}

const stats = service.getStats();
console.log(`\nTotal time: ${(stats.totalTimeMs / 1000).toFixed(2)}s`);
console.log(`Cache hits: ${stats.cacheHits}`);
console.log(`Cache misses: ${stats.cacheMisses}`);
```

---

### Shadow Atlas Integration

```typescript
import { TIGERExtractionService } from './services/tiger-extraction-service.js';
import { ShadowAtlasService } from './core/shadow-atlas-service.js';

const tigerService = new TIGERExtractionService();
const atlasService = new ShadowAtlasService();

// Extract all states
const allStates = ['06', '48', '36', ...]; // All 50 states + DC + PR

for (const state of allStates) {
  const results = await tigerService.extractState(state, [
    'congressional',
    'state_senate',
    'state_house',
  ]);

  for (const result of results) {
    // Validate
    const validation = await tigerService.validate(result);

    if (!validation.valid) {
      console.warn(`⚠️  ${state} ${result.layer} validation failed`);
      continue;
    }

    // Add to Shadow Atlas
    await atlasService.addBoundaries(result.features);
  }
}

// Commit to Merkle tree
const merkleRoot = await atlasService.commit();
console.log(`Merkle root: ${merkleRoot}`);
```

---

## Testing

The service includes comprehensive tests:

```bash
# Unit tests (mocked, fast)
npm test tiger-extraction-service.test.ts

# Integration tests (real API, rate-limited, skipped by default)
npm test tiger-extraction-service.test.ts -- --run
```

Test categories:
- **Unit tests** - Mocked responses, validation logic, cache behavior
- **Integration tests** - Real API calls (rate-limited, skipped in CI)
- **Performance tests** - Timing, statistics accuracy
- **Error handling** - Invalid inputs, network failures, retries

---

## Troubleshooting

### "Download failed after X attempts"

**Cause:** Network timeout or Census FTP unavailable

**Solution:**
1. Increase `maxRetries`:
   ```typescript
   const service = new TIGERExtractionService({ maxRetries: 5 });
   ```
2. Check Census status: https://www.census.gov/programs-surveys/geography/technical-documentation/complete-technical-documentation/tiger-geo-line.html

---

### "Validation failed: Expected X, got Y"

**Cause:** Count mismatch with official registry

**Solution:**
1. Check if redistricting occurred:
   ```typescript
   import { OFFICIAL_DISTRICT_COUNTS } from './registry/official-district-counts.js';
   console.log(OFFICIAL_DISTRICT_COUNTS['CA']);
   ```
2. Update registry if boundaries changed
3. Re-extract with `forceRefresh: true`:
   ```typescript
   const service = new TIGERExtractionService({ forceRefresh: true });
   ```

---

### "Layer X not supported"

**Cause:** Requesting unsupported layer (e.g., `school_unified`)

**Solution:**
Check supported layers in `/providers/tiger-boundary-provider.ts`:
```typescript
import { TIGER_LAYERS } from './providers/tiger-boundary-provider.js';
console.log(Object.keys(TIGER_LAYERS)); // ['cd', 'sldu', 'sldl', 'county']
```

School district layers require separate implementation (future work).

---

## Roadmap

### Phase 2: School District Support

Add support for Census TIGER school district boundaries:

- `school_unified` - Unified school districts (~13,000)
- `school_elementary` - Elementary districts (~10,000)
- `school_secondary` - Secondary districts (~500)

**Implementation:**
1. Extend `TIGER_LAYERS` in `/providers/tiger-boundary-provider.ts`
2. Add expected counts to `/registry/official-district-counts.ts`
3. Map to administrative levels in `TIGERExtractionService`

---

### Phase 3: Historical Boundaries

Support historical TIGER vintages for temporal analysis:

```typescript
const service = new TIGERExtractionService({ year: 2010 });
const pre2020 = await service.extractNational('congressional');

const service2024 = new TIGERExtractionService({ year: 2024 });
const post2020 = await service2024.extractNational('congressional');

// Compare pre/post reapportionment
const changes = compareDistricts(pre2020, post2020);
```

---

## References

- **Census TIGER/Line**: https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html
- **TIGERweb REST API**: https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer
- **Official District Counts**: `/registry/official-district-counts.ts`
- **2020 Census Apportionment**: https://www.census.gov/data/tables/2020/dec/2020-apportionment-data.html

---

## License

Public Domain (US Government Work)
