# Primary Source Comparator (WP-FRESHNESS-3)

**Status:** Complete
**Cost:** $0/year (HTTP HEAD requests only)
**Latency:** <5 seconds per check

## Overview

The Primary Source Comparator detects when Census TIGER boundary data is stale by comparing it against authoritative state redistricting commissions. During redistricting cycles (2021-2022, 2031-2032), TIGER lags 6-18 months behind state primaries.

**Core Principle:** `freshest_primary > freshest_aggregator`

## The Problem

Census TIGER is an **aggregator**, not an authority. During redistricting:

```
Timeline: California Redistricting 2021-2022
─────────────────────────────────────────────────────────────

Dec 2021:  CA Citizens Redistricting Commission finalizes maps
           → State publishes on wedrawthelinesca.org
           → AUTHORITATIVE data available
           → TIGER still shows OLD districts

Jan 2022:  New districts take LEGAL EFFECT
           → TIGER still shows OLD districts
           → Using TIGER serves WRONG boundaries

Jul 2022:  Census releases TIGER 2022
           → Finally includes new CA districts
           → 7 months of stale federal data

─────────────────────────────────────────────────────────────

IMPACT: Using "highest institutional tier" serves stale data
        for 7 months during redistricting.
```

## Architecture

### HTTP HEAD Requests Only

```typescript
// Zero bandwidth cost - only downloads HTTP headers
const response = await fetch(url, {
  method: 'HEAD',
  headers: { 'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0' }
});

const lastModified = response.headers.get('last-modified');
const etag = response.headers.get('etag');
```

### Comparison Logic

```
1. Get TIGER URL for boundary type
2. Get primary source URL for jurisdiction
3. Check both with HTTP HEAD (in parallel)
4. Compare Last-Modified dates
5. Return recommendation
```

### Decision Flow

```
if (no_primary_source_available):
    return { tigerIsFresh: true, recommendation: 'use-tiger' }

if (primary_not_machine_readable):
    return { tigerIsFresh: true, recommendation: 'use-tiger', warning: '...' }

if (primary.lastModified > tiger.lastModified):
    return { tigerIsFresh: false, recommendation: 'use-primary', lagDays: X }

else:
    return { tigerIsFresh: true, recommendation: 'use-tiger' }
```

## API Reference

### PrimarySourceComparator

```typescript
class PrimarySourceComparator {
  /**
   * Compare TIGER freshness against primary source
   */
  async compareTigerFreshness(
    boundaryType: BoundaryType,
    jurisdiction: string
  ): Promise<TigerComparison>;

  /**
   * Check freshness via HTTP HEAD
   */
  async checkSourceFreshness(url: string): Promise<SourceFreshness>;

  /**
   * Batch compare all states
   */
  async compareAllStates(
    boundaryType: BoundaryType
  ): Promise<Map<string, TigerComparison>>;
}
```

### Types

```typescript
type BoundaryType =
  | 'congressional'
  | 'state_senate'
  | 'state_house'
  | 'county'
  | 'place'
  | 'city_council'
  | 'school_unified'
  | 'voting_precinct'
  | 'special_district';

interface TigerComparison {
  readonly jurisdiction: string;
  readonly boundaryType: BoundaryType;
  readonly tigerIsFresh: boolean;
  readonly reason: string;
  readonly recommendation: 'use-tiger' | 'use-primary' | 'manual-review';
  readonly tigerLastModified: Date | null;
  readonly primaryLastModified: Date | null;
  readonly primarySource?: {
    readonly name: string;
    readonly url: string;
    readonly machineReadable: boolean;
  };
  readonly lagDays?: number;
  readonly warning?: string;
}

interface SourceFreshness {
  readonly url: string;
  readonly available: boolean;
  readonly lastModified: Date | null;
  readonly etag: string | null;
  readonly contentLength: number | null;
  readonly checkedAt: Date;
  readonly error?: string;
}
```

## Primary Source Registry

### Coverage

**10 states** covering diverse redistricting models:

#### Independent Commissions (Non-partisan)
- **California** - CA Citizens Redistricting Commission
- **Arizona** - AZ Independent Redistricting Commission
- **Colorado** - CO Independent Redistricting Commissions
- **Michigan** - MI Independent Citizens Redistricting Commission
- **Washington** - WA Redistricting Commission

#### Legislature-Controlled (Partisan)
- **Texas** - TX Legislative Council
- **Florida** - FL Legislature
- **New York** - NY Independent Redistricting Commission
- **Pennsylvania** - PA Legislative Reapportionment Commission
- **Ohio** - OH Redistricting Commission

### Registry Structure

```typescript
const PRIMARY_SOURCES: Map<string, PrimarySourceInfo> = new Map([
  ['CA', {
    name: 'CA Citizens Redistricting Commission',
    url: 'https://www.wedrawthelinesca.org/data',
    machineReadable: true,
    boundaryTypes: ['congressional', 'state_senate', 'state_house'],
    notes: 'Shapefiles available for download',
  }],
  // ... 9 more states
]);
```

### Static Methods

```typescript
// Get all primary sources
const sources = PrimarySourceComparator.getPrimarySources();

// Get states with congressional primaries
const states = PrimarySourceComparator.getStatesWithPrimarySources('congressional');
```

## Usage Examples

### Example 1: Single State Check

```typescript
import { primaryComparator } from './primary-comparator.js';

const comparison = await primaryComparator.compareTigerFreshness(
  'congressional',
  'CA'
);

if (!comparison.tigerIsFresh) {
  console.warn(`TIGER is stale by ${comparison.lagDays} days`);
  console.log(`Use ${comparison.primarySource?.url} instead`);
}
```

### Example 2: Batch Audit

```typescript
const results = await primaryComparator.compareAllStates('congressional');

const staleStates = Array.from(results.entries())
  .filter(([_, comp]) => !comp.tigerIsFresh);

console.log(`${staleStates.length} states have fresher primary sources`);

for (const [state, comparison] of staleStates) {
  console.log(`${state}: ${comparison.lagDays} days behind`);
}
```

### Example 3: Quarterly Freshness Audit

```typescript
const boundaryTypes = ['congressional', 'state_senate', 'state_house'];

for (const boundaryType of boundaryTypes) {
  const results = await primaryComparator.compareAllStates(boundaryType);
  const stale = Array.from(results.values()).filter(c => !c.tigerIsFresh);

  console.log(`${boundaryType}: ${stale.length}/${results.size} stale`);
}
```

## Integration with Change Detector

The Primary Source Comparator extends the existing `ChangeDetector` with freshness verification:

```typescript
import { ChangeDetector } from '../acquisition/change-detector.js';
import { primaryComparator } from './primary-comparator.js';

class EnhancedChangeDetector extends ChangeDetector {
  async checkForChangeWithFreshness(source: CanonicalSource) {
    // 1. Basic file change detection
    const baseChange = await this.checkForChange(source);

    // 2. Check if TIGER is stale during redistricting
    const comparison = await primaryComparator.compareTigerFreshness(
      source.boundaryType,
      source.jurisdiction
    );

    // 3. Return recommendation
    if (!comparison.tigerIsFresh) {
      return {
        ...baseChange,
        recommendation: 'use-primary',
        reason: comparison.reason,
        lagDays: comparison.lagDays,
      };
    }

    return baseChange;
  }
}
```

## Error Handling

### Network Errors

```typescript
const freshness = await comparator.checkSourceFreshness(url);

if (!freshness.available) {
  console.error(`Source unavailable: ${freshness.error}`);
  // Fall back to TIGER
}
```

### Missing Headers

```typescript
if (!freshness.lastModified) {
  console.warn('No Last-Modified header - cannot verify freshness');
  // Require manual review
}
```

### Timeout

```typescript
// 5 second timeout with 3 retries
const freshness = await comparator.checkSourceFreshness(url);
// Automatically retries with exponential backoff
```

## Performance

### Latency

- **Single check:** <5 seconds
- **Batch check (10 states):** <30 seconds (parallel)
- **Timeout:** 5 seconds per request
- **Retries:** 3 attempts with exponential backoff

### Bandwidth

- **HEAD request:** ~500 bytes per check
- **No downloads:** Zero file transfer
- **Cost:** $0/year (free)

## Testing

### Unit Tests

```bash
cd packages/crypto
npm test -- primary-comparator.test.ts
```

### Integration Tests

```bash
# Test with real URLs (requires network)
npm test -- primary-comparator.test.ts --run --testNamePattern="network test"
```

### Example Script

```bash
# Run usage examples
npx tsx services/shadow-atlas/provenance/primary-comparator-example.ts
```

## Roadmap

### Current Coverage (WP-FRESHNESS-3)

- ✅ 10 states with primary sources
- ✅ HTTP HEAD request logic
- ✅ Comparison algorithm
- ✅ Batch operations
- ✅ Error handling
- ✅ Unit tests

### Future Enhancements

- [ ] **Expand to 50 states** - Add remaining 40 state redistricting authorities
- [ ] **Caching layer** - Cache HTTP HEAD responses for 1 hour
- [ ] **Metrics tracking** - Log staleness metrics to database
- [ ] **Alerting** - Notify when TIGER is >30 days stale
- [ ] **RSS integration** - Subscribe to state redistricting feeds
- [ ] **API versioning** - Track TIGER release versions

## Related Work Packages

- **WP-FRESHNESS-1:** Authority Registry Implementation
- **WP-FRESHNESS-2:** Validity Window System
- **WP-FRESHNESS-3:** Primary Source Comparator (this package)
- **WP-FRESHNESS-4:** Event Subscription Service
- **WP-FRESHNESS-5:** Redistricting Gap Detector
- **WP-FRESHNESS-6:** Enhanced Change Detector Integration

## References

- **Spec:** `/specs/DATA-FRESHNESS-SPEC.md` Section 4.3
- **Change Detector:** `/packages/crypto/services/shadow-atlas/acquisition/change-detector.ts`
- **Provenance System:** `/packages/crypto/services/shadow-atlas/provenance/`

## Authors

Claude Code
Date: 2025-12-13
License: MIT
