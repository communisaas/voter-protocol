# Change Detection System

## Overview

The Shadow Atlas change detection system monitors upstream TIGER/Line data sources for changes without downloading full datasets. It uses HTTP HEAD requests to check ETag and Last-Modified headers, enabling intelligent incremental updates.

**Cost: $0/year** (HEAD requests are free)

## Architecture

### Components

1. **ChangeDetectionAdapter** (`src/acquisition/change-detection-adapter.ts`)
   - High-level wrapper for TIGER-specific change detection
   - Generates TIGER URLs, manages checksum cache, aggregates results
   - Persists checksums to disk between runs

2. **ShadowAtlasService Integration** (`src/core/shadow-atlas-service.ts`)
   - `checkForChanges()` - Check for upstream changes before build
   - `buildAtlas()` - Automatically checks for changes when enabled
   - Updates checksums after successful builds

3. **Configuration** (`src/core/config.ts`)
   - `changeDetection.enabled` - Enable/disable change detection
   - `changeDetection.checksumCachePath` - Path to checksum cache file
   - `changeDetection.skipUnchanged` - Skip downloading unchanged layers (future optimization)

### Checksum Cache Format

```json
{
  "lastChecked": "2024-12-28T10:00:00Z",
  "sources": {
    "cd:55:2024": {
      "etag": "\"abc123\"",
      "lastModified": "2024-07-15T00:00:00Z",
      "checkedAt": "2024-12-28T10:00:00Z"
    },
    "sldu:55:2024": {
      "etag": null,
      "lastModified": "Wed, 15 Jul 2024 00:00:00 GMT",
      "checkedAt": "2024-12-28T10:00:00Z"
    }
  }
}
```

**Cache Key Format:** `{layer}:{stateFips}:{vintage}`

Examples:
- `cd:55:2024` - Wisconsin congressional districts, 2024 vintage
- `sldu:06:2024` - California state senate, 2024 vintage
- `county:all:2024` - All counties (when expanded, becomes multiple keys)

## Usage

### Basic Usage

```typescript
import { ShadowAtlasService } from './src/core/shadow-atlas-service.js';
import { createConfig } from './src/core/config.js';

// Enable change detection
const config = createConfig({
  storageDir: './atlas-data',
  changeDetection: {
    enabled: true,
    skipUnchanged: true,
  },
});

const atlas = new ShadowAtlasService(config);
await atlas.initialize();

// Check for changes before building
const changes = await atlas.checkForChanges(
  ['cd', 'sldu', 'sldl', 'county'],
  ['55'], // Wisconsin
  2024
);

if (changes.hasChanges) {
  console.log('Changes detected:', changes.changedLayers);

  // Build with automatic checksum updates
  const result = await atlas.buildAtlas({
    layers: ['cd', 'sldu', 'sldl', 'county'],
    states: ['55'],
    year: 2024,
  });
} else {
  console.log('No changes - skipping build');
}

atlas.close();
```

### Advanced: Manual Checksum Management

```typescript
import { ChangeDetectionAdapter } from './src/acquisition/change-detection-adapter.js';

// Create adapter
const adapter = new ChangeDetectionAdapter({
  sources: [
    {
      layerType: 'cd',
      vintage: 2024,
      states: ['55', '06'], // Wisconsin and California
      updateTriggers: [
        { type: 'annual', month: 7 }, // Check in July
      ],
    },
  ],
  storageDir: './atlas-data',
});

// Load existing checksums
await adapter.loadCache();

// Detect changes
const result = await adapter.detectChanges();

console.log('Changed layers:', result.changedLayers);
console.log('Changed states:', result.changedStates);
console.log('Reports:', result.reports);

// Update checksums after download
await adapter.updateChecksums(result.reports);
```

## TIGER URL Pattern

The adapter generates TIGER URLs using this pattern:

```
https://www2.census.gov/geo/tiger/TIGER{year}/{LAYER}/tl_{year}_{fips}_{layer}.zip
```

Examples:
- `https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_55_cd.zip`
- `https://www2.census.gov/geo/tiger/TIGER2024/SLDU/tl_2024_55_sldu.zip`

Supported layers:
- `cd` - Congressional districts
- `sldu` - State legislative upper (senate)
- `sldl` - State legislative lower (house)
- `county` - Counties

## Configuration Options

### ShadowAtlasConfig

```typescript
interface ShadowAtlasConfig {
  // ... other config

  changeDetection?: {
    /** Enable change detection before builds */
    enabled: boolean;

    /** Path to checksum cache file (relative to storageDir) */
    checksumCachePath?: string;

    /** Skip downloading unchanged layers during build */
    skipUnchanged?: boolean;
  };
}
```

### Default Configuration

```typescript
{
  changeDetection: {
    enabled: false,        // Disabled by default
    skipUnchanged: true,   // Would skip unchanged layers when enabled
  }
}
```

## Integration with buildAtlas

When `changeDetection.enabled = true`, the `buildAtlas()` method:

1. **Before download:** Checks all requested layers for changes via HTTP HEAD
2. **Logs results:** Reports which layers and states have changed
3. **Downloads:** Proceeds with download (future: skip unchanged layers)
4. **After success:** Updates checksum cache with new ETags/Last-Modified values

This ensures the cache stays synchronized with actual builds.

## Cost Analysis

### Traditional Approach (No Change Detection)
- **Monthly build:** Download all 4 layers × 50 states = 200 files
- **Bandwidth:** ~2-5 GB per build
- **Cost:** Egress bandwidth costs (varies by provider)

### With Change Detection
- **Monthly HEAD checks:** 200 HEAD requests = $0
- **Downloads:** Only changed files (typically 0-10 files per month)
- **Bandwidth saved:** 95-100% reduction
- **Cost:** $0 for checks, minimal for downloads

## Limitations

1. **Supported Layers:** Only `cd`, `sldu`, `sldl`, `county` (not `cdp` or other TIGER layers)
2. **State Expansion:** `states: ['all']` expands to all 50 US states + DC
3. **Cache Persistence:** Checksums stored in JSON file (not database)
4. **Skip Optimization:** `skipUnchanged` flag exists but full implementation deferred to future phase

## Future Enhancements

### Phase 1.5 Optimizations
1. **Skip Unchanged Downloads:** When `skipUnchanged=true` and no changes detected, load from cache instead of re-downloading
2. **Incremental Tree Updates:** Update only changed branches in Merkle tree
3. **Multi-Source Comparison:** Cross-validate changes across multiple mirrors

### Integration with IncrementalOrchestrator
The `ChangeDetector` (base class) and `ChangeDetectionAdapter` (TIGER-specific) are designed to integrate with the existing `IncrementalOrchestrator` for database-backed change tracking.

## Implementation Files

```
src/acquisition/
  change-detection-adapter.ts    # TIGER-specific change detection
  change-detector.ts              # Generic change detection (already exists)
  incremental-orchestrator.ts     # Database-backed orchestration (already exists)

src/core/
  shadow-atlas-service.ts         # Service integration
  config.ts                       # Configuration types

examples/
  change-detection-example.ts     # Usage example
```

## Testing

Run the example:

```bash
npx tsx examples/change-detection-example.ts
```

Expected output:
1. First run: Detects changes (no cached checksums)
2. Builds Atlas and updates checksums
3. Second check: No changes detected

## Type Safety

All change detection code follows nuclear-level TypeScript strictness:
- ✅ No `any` types
- ✅ Explicit readonly interfaces
- ✅ Exhaustive type guards
- ✅ Immutable by default (except internal cache state)

## Security Considerations

### Cache Integrity
- Checksums stored in plaintext JSON (no encryption needed - public data)
- File locking not implemented (assume single-process access)
- Corruption handled gracefully (falls back to empty cache)

### Network Requests
- 5-second timeout on HEAD requests
- User-Agent header identifies as "VOTER-Protocol-ShadowAtlas/1.0"
- No retry logic at adapter level (handled by caller)

## Provenance Integration

Change detection results are NOT automatically logged to provenance. The `buildAtlas()` method logs:
- Source checksums in provenance records
- Download timestamps
- Validation results

Provenance entries include the source checksum for audit trails, enabling verification that builds used expected upstream data.

---

**Status:** ✅ Implemented (P1-2)
**Next Phase:** P1-5 (Skip unchanged downloads optimization)
