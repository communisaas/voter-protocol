# State Batch Extractor + Authority Resolver Integration Guide

This guide demonstrates how the state batch extraction system integrates with the authority resolver to automatically select the most authoritative boundary source.

## Architecture Overview

```
State Batch Extraction (state-batch-extractor.ts)
    ↓
    Produces: ExtractedBoundary objects with legislativeAuthority metadata
    ↓
State Batch Integration (authority-resolver.ts)
    ↓
    Converts: ExtractedBoundary → BoundaryWithSource
    ↓
Authority Resolution (authority-resolver.ts + tiger-authority-rules.ts)
    ↓
    Selects: Most authoritative source based on hierarchy
    ↓
Result: ResolvedBoundarySource with winning provider
```

## Authority Hierarchy

The system respects a clear precedence order for legislative boundaries:

1. **state-redistricting-commission** (preference 1, authority 5)
   - Official map drawers (e.g., Wisconsin LTSB, Colorado IRC)
   - HIGHEST authority during redistricting gaps

2. **state-redistricting** (preference 2, authority 4)
   - State redistricting portals

3. **census-tiger** (preference 3, authority 5)
   - Federal aggregator (TIGERweb)
   - Authoritative but slower to update during redistricting

4. **state-gis** (preference 4, authority 4)
   - State GIS clearinghouses

## Basic Usage

### 1. Extract Boundaries from State Portal

```typescript
import { StateBatchExtractor } from './providers/state-batch-extractor.js';

const extractor = new StateBatchExtractor();

// Extract all legislative layers for Wisconsin
const wiResults = await extractor.extractState('WI');

console.log(`Extracted ${wiResults.summary.totalBoundaries} boundaries`);
console.log(`Authority: ${wiResults.authority}`); // 'state-gis'

// Access specific layer
const congressional = wiResults.layers.find(l => l.layerType === 'congressional');
console.log(`Congressional districts: ${congressional.featureCount}`);
```

### 2. Resolve Authority Conflicts

```typescript
import {
  resolveStateBatchConflict,
  convertStateBatchBoundary
} from './provenance/authority-resolver.js';

// Option A: Resolve conflicts within state sources
const resolved = resolveStateBatchConflict(congressional.boundaries);

console.log(`Using ${resolved.boundary.provider}`);
console.log(`Authority level: ${resolved.authority}`);
console.log(`Preference: ${resolved.preference}`);
console.log(`Reasoning: ${resolved.reasoning}`);

// Option B: Manual conversion and resolution
const converted = congressional.boundaries.map(convertStateBatchBoundary);
const resolved2 = resolveAuthorityConflict(converted);
```

### 3. Compare State vs TIGER

```typescript
import { resolveStateBatchVsTIGER } from './provenance/authority-resolver.js';

// Fetch TIGER data
const tigerBoundary: BoundaryWithSource = {
  boundaryType: 'congressional',
  provider: 'census-tiger',
  releaseDate: new Date('2024-07-01'),
};

// Resolve conflict
const resolved = resolveStateBatchVsTIGER(
  congressional.boundaries[0],
  tigerBoundary,
  new Date('2024-09-01')
);

// Result: State source preferred if higher precedence
console.log(`Winner: ${resolved.boundary.provider}`);
```

### 4. Batch Resolution for All Layers

```typescript
import { batchResolveStateSources } from './provenance/authority-resolver.js';

// Extract all Wisconsin boundaries
const wiResults = await extractor.extractState('WI');

// Optional: Include TIGER data for comparison
const tigerBoundaries = new Map([
  ['congressional', [tigerCongressional]],
  ['state_senate', [tigerSenate]],
  // ...
]);

// Resolve all layers
const resolved = batchResolveStateSources(wiResults, tigerBoundaries);

// Access results
const cdWinner = resolved.get('congressional');
const senateWinner = resolved.get('state_senate');
const houseWinner = resolved.get('state_house');
const countyWinner = resolved.get('county');

console.log(`Congressional: ${cdWinner?.boundary.provider}`);
console.log(`State Senate: ${senateWinner?.boundary.provider}`);
```

## Critical Scenario: Redistricting Gap (Jan-Jun 2022)

During redistricting gaps, state commissions finalize new maps before TIGER updates. The integration automatically handles this:

```typescript
// January 2022: State commission has new 2022 maps
const stateCommission: StateBatchBoundary = {
  id: '5501',
  name: 'Congressional District 1',
  layerType: 'congressional',
  geometry: { type: 'Polygon', coordinates: [] },
  source: {
    state: 'WI',
    portalName: 'Wisconsin LTSB',
    endpoint: 'https://gis-ltsb.hub.arcgis.com/...',
    authority: 'state-redistricting-commission',
    vintage: 2022,
    retrievedAt: '2022-01-15T00:00:00Z',
  },
  properties: {},
};

// TIGER still has 2021 data
const tigerStale: BoundaryWithSource = {
  boundaryType: 'congressional',
  provider: 'census-tiger',
  releaseDate: new Date('2021-07-01'),
};

// Resolve as of Feb 2022
const resolved = resolveStateBatchVsTIGER(
  stateCommission,
  tigerStale,
  new Date('2022-02-15')
);

// Result: State commission wins
// - Higher preference (1 vs 3)
// - Fresher data (2022 vs 2021)
console.log(resolved.boundary.provider); // 'state-redistricting-commission'
console.log(resolved.reasoning);
// "Selected state-redistricting-commission (authority=5, preference=1).
//  Same authority as census-tiger, but higher preference. Fresh data (30 days old)"
```

## State-Specific Examples

### Wisconsin (state-gis authority)

Wisconsin uses TIGERweb as its state GIS source, so authority is `state-gis`:

```typescript
const wiResults = await extractor.extractState('WI');
console.log(wiResults.authority); // 'state-gis'

// When resolved against TIGER:
// - Congressional: TIGER wins (pref 3 > 4)
// - State Senate: TIGER wins (pref 3 > 4)
// - State House: TIGER wins (pref 3 > 4)
// - County: TIGER wins (pref 1, TIGER always preferred for counties)
```

### Colorado (state-redistricting-commission authority)

Colorado uses independent redistricting commissions, highest authority:

```typescript
const coResults = await extractor.extractState('CO');
console.log(coResults.authority); // 'state-redistricting-commission'

// When resolved against TIGER:
// - Congressional: Commission wins (pref 1 > 3)
// - State Senate: Commission wins (pref 1 > 3)
// - State House: Commission wins (pref 1 > 3)
// - County: TIGER wins (pref 1 for counties)
```

### Texas (state-gis authority)

Texas uses TNRIS as state GIS portal:

```typescript
const txResults = await extractor.extractState('TX');
console.log(txResults.authority); // 'state-gis'

// Same behavior as Wisconsin (TIGERweb sources preferred)
```

## Understanding the Scoring System

The resolver uses a weighted scoring system:

```
Total Score = (Authority × 1000) + ((100 - Preference) × 100) + (Freshness × 10)
```

**Example 1: State Commission vs TIGER (same vintage)**
```
State Commission:
  Authority: 5 × 1000 = 5000
  Preference: (100 - 1) × 100 = 9900
  Freshness: 0.8 × 10 = 8
  TOTAL: 14908

TIGER:
  Authority: 5 × 1000 = 5000
  Preference: (100 - 3) × 100 = 9700
  Freshness: 0.8 × 10 = 8
  TOTAL: 14708

Winner: State Commission (higher preference)
```

**Example 2: State Commission vs State GIS (same vintage)**
```
State Commission:
  Authority: 5 × 1000 = 5000
  Preference: (100 - 1) × 100 = 9900
  Freshness: 0.8 × 10 = 8
  TOTAL: 14908

State GIS:
  Authority: 4 × 1000 = 4000
  Preference: (100 - 4) × 100 = 9600
  Freshness: 0.8 × 10 = 8
  TOTAL: 13608

Winner: State Commission (higher authority + preference)
```

## Integration with Shadow Atlas Pipeline

The full pipeline integrates state batch extraction with the Shadow Atlas:

```typescript
// 1. Extract from all configured states
const batchResults = await extractor.extractAllStates();

// 2. For each state, resolve authority conflicts
for (const stateResult of batchResults.states) {
  const resolved = batchResolveStateSources(stateResult);

  for (const [layerType, resolution] of resolved.entries()) {
    console.log(`${stateResult.state} ${layerType}: ${resolution.boundary.provider}`);

    // 3. Use winning source for Shadow Atlas
    await addToShadowAtlas(
      stateResult.state,
      layerType,
      resolution.boundary,
      {
        authority: resolution.authority,
        preference: resolution.preference,
        confidence: resolution.confidence,
        reasoning: resolution.reasoning,
      }
    );
  }
}
```

## Testing Authority Resolution

The integration includes comprehensive tests:

```typescript
import { describe, it, expect } from 'vitest';

describe('State Batch Integration', () => {
  it('should prefer state-redistricting-commission over TIGER during gaps', () => {
    const stateBoundary = createStateBoundary('state-redistricting-commission', 2022);
    const tigerBoundary = createTIGERBoundary(2021);

    const resolved = resolveStateBatchVsTIGER(
      stateBoundary,
      tigerBoundary,
      new Date('2022-02-01')
    );

    expect(resolved.boundary.provider).toBe('state-redistricting-commission');
    expect(resolved.preference).toBe(1);
  });
});
```

See `/provenance/state-batch-integration.test.ts` for full test suite.

## Key Design Decisions

### 1. Direct Authority Mapping

The `legislativeAuthority` field from state-gis-portals.ts maps directly to `SourceProvider`:
- `'state-redistricting-commission'` → `'state-redistricting-commission'`
- `'state-gis'` → `'state-gis'`

This ensures type safety and avoids manual mapping errors.

### 2. Conservative Release Date Estimation

State sources typically release in Jan-Jun of redistricting years. We use January 15th of the vintage year as a conservative estimate for freshness scoring. This ensures:
- State sources get appropriate freshness credit
- TIGER July releases are correctly scored as newer
- No false precision in release dates

### 3. Preference Over Freshness

The scoring system heavily weights preference (100x) over freshness (10x). This ensures:
- State commissions preferred during redistricting gaps
- Preference order maintained even with moderate staleness
- Freshness acts as tiebreaker, not primary factor

### 4. Authority Metadata Preservation

All source metadata flows through conversion:
- State name, portal name, endpoint preserved
- Original properties retained
- Retrieved timestamp maintained
- Enables full audit trail

## Error Handling

The integration includes comprehensive error handling:

```typescript
// Type mismatch detection
try {
  resolveStateBatchVsTIGER(stateBoundary, tigerBoundary);
} catch (error) {
  // "Boundary type mismatch: state=congressional, TIGER=county"
}

// Provider validation
try {
  resolveStateBatchVsTIGER(stateBoundary, arcgisBoundary);
} catch (error) {
  // "Expected TIGER boundary, got arcgis-hub"
}
```

## Performance Considerations

### Batch Operations

Use `batchResolveStateSources()` for multiple layers:
- Single pass through all layers
- Efficient TIGER comparison
- Returns structured Map for easy access

### Caching Strategy

The state batch extractor supports caching:
```typescript
const extractor = new StateBatchExtractor({
  retryAttempts: 3,
  retryDelayMs: 1000,
});

// Results can be cached at extraction level
const cached = await cacheManager.get('WI_2024');
const results = cached ?? await extractor.extractState('WI');
```

## References

- **State Batch Extractor**: `/providers/state-batch-extractor.ts`
- **Authority Resolver**: `/provenance/authority-resolver.ts`
- **TIGER Authority Rules**: `/provenance/tiger-authority-rules.ts`
- **State GIS Portals Registry**: `/registry/state-gis-portals.ts`
- **Integration Tests**: `/provenance/state-batch-integration.test.ts`

## Future Enhancements

Potential improvements to the integration:

1. **Automatic Gap Detection**: Detect redistricting years automatically
2. **Real-time Release Dates**: Query state portals for actual release dates
3. **Geometric Validation**: Verify boundary integrity during conversion
4. **Audit Logging**: Track all authority decisions for compliance
5. **Conflict Notifications**: Alert when multiple sources disagree significantly
