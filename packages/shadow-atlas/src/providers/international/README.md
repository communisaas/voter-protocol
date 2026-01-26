# Shadow Atlas International Providers

Type-safe, extensible boundary provider architecture for scaling Shadow Atlas to 190+ countries.

## Overview

Shadow Atlas achieves **100% accuracy** for US boundaries (50 states, 435 congressional districts, 7,383 state legislative districts). This directory implements the provider architecture enabling **global expansion** to support VOTER Protocol's international civic participation infrastructure.

**Current Coverage (Phase 1)**:
- ✅ **United Kingdom**: 650 parliamentary constituencies (ONS ArcGIS REST)
- ✅ **Canada**: 338 federal electoral districts (Represent API)
- ✅ **Australia**: 151 federal electoral divisions (AEC ArcGIS REST)
- ⏳ **New Zealand**: 79 electorates (pending implementation)

**Planned Expansion**:
- **Phase 2 (Months 7-12)**: 27 EU countries (~6,000 electoral districts)
- **Phase 3 (Months 13-24)**: G20 + major democracies (~10,000 districts)
- **Phase 4 (Months 25-36)**: Global coverage (190+ countries)

## Architecture

### Core Design Principles

1. **Type Safety**: Strict TypeScript with discriminated unions, readonly types, strict generics
2. **Expected Count Validation**: Prevent data corruption via official electoral seat counts
3. **Health Monitoring**: Provider availability, latency, data freshness tracking
4. **Incremental Updates**: Support event-driven (redistricting) and periodic schedules
5. **Minimal Human Intervention**: 80-90% autonomous extraction with automated validation

### Base Provider Interface

All international providers implement `InternationalBoundaryProvider<TLayerType, TBoundary>`:

```typescript
interface InternationalBoundaryProvider<TLayerType, TBoundary> {
  // Identification
  readonly country: string;           // ISO 3166-1 alpha-2
  readonly countryName: string;
  readonly dataSource: string;
  readonly apiType: DataSourceType;
  readonly license: string;

  // Configuration
  readonly layers: ReadonlyMap<TLayerType, LayerConfig>;

  // Extraction
  extractAll(): Promise<InternationalExtractionResult>;
  extractLayer(layerType: TLayerType): Promise<LayerExtractionResult>;

  // Change Detection
  hasChangedSince(lastExtraction: Date): Promise<boolean>;

  // Health Monitoring
  healthCheck(): Promise<ProviderHealth>;
  getExpectedCounts(): Promise<ReadonlyMap<TLayerType, number>>;
}
```

### File Structure

```
international/
├── base-provider.ts              # Abstract base class, interfaces, types
├── uk-provider.ts                # United Kingdom (650 constituencies)
├── uk-provider.test.ts           # UK provider unit tests
├── canada-provider.ts            # Canada (338 federal districts)
├── canada-provider.test.ts       # Canada provider unit tests
├── australia-provider.ts         # Australia (151 divisions)
├── australia-provider.test.ts    # Australia provider unit tests
├── eu-template-provider.ts       # EU template + data source registry
├── GLOBAL_SCALING_SPEC.md        # Complete expansion roadmap
├── README.md                     # This file
└── index.ts                      # Unified exports
```

## Quick Start

### Using Existing Providers

```typescript
import { UKBoundaryProvider, CanadaBoundaryProvider, AustraliaBoundaryProvider } from './providers/international';

// Extract UK parliamentary constituencies
const ukProvider = new UKBoundaryProvider();
const ukResult = await ukProvider.extractAll();
console.log(`Extracted ${ukResult.totalBoundaries} UK constituencies`);

// Extract Canada federal electoral districts
const canadaProvider = new CanadaBoundaryProvider();
const canadaResult = await canadaProvider.extractAll();

// Extract Australia federal electoral divisions
const australiaProvider = new AustraliaBoundaryProvider();
const australiaResult = await australiaProvider.extractAll();

// Health check all providers
const ukHealth = await ukProvider.healthCheck();
const canadaHealth = await canadaProvider.healthCheck();
const australiaHealth = await australiaProvider.healthCheck();
```

### Using Provider Registry

```typescript
import {
  getProviderForCountry,
  extractMultipleCountries,
  checkAllProvidersHealth
} from '../registry/international-providers';

// Get specific provider
const ukProvider = getProviderForCountry('GB');
const result = await ukProvider?.extractAll();

// Batch extraction
const results = await extractMultipleCountries(['GB', 'CA', 'AU'], {
  concurrency: 3,
  continueOnError: true,
  onProgress: (p) => console.log(`${p.completed}/${p.total} complete`)
});

// Health check all
const health = await checkAllProvidersHealth();
for (const [country, status] of health) {
  console.log(`${country}: ${status.available ? 'UP' : 'DOWN'}`);
}
```

## Creating a New Provider

### Step-by-Step Guide

**1. Research Data Source**
- Identify official electoral commission / national statistics agency
- Find boundary data API or download endpoint
- Determine API type (ArcGIS REST, WFS, custom API, static file)
- Verify data license (must be open/public domain)
- Document expected boundary counts from official sources

**2. Create Provider File**
```bash
# Create new provider file
touch packages/crypto/services/shadow-atlas/providers/international/germany-provider.ts
touch packages/crypto/services/shadow-atlas/providers/international/germany-provider.test.ts
```

**3. Implement Provider Class**

```typescript
import { BaseInternationalProvider, type InternationalExtractionResult } from './base-provider.js';
import type { Polygon, MultiPolygon } from 'geojson';

export type GermanyLayerType = 'bundestag';

export interface GermanyConstituency {
  readonly id: string;
  readonly name: string;
  readonly type: 'bundestag';
  readonly geometry: Polygon | MultiPolygon;
  readonly source: {
    readonly country: 'DE';
    readonly dataSource: 'Bundeswahlleiter';
    readonly endpoint: string;
    readonly authority: 'electoral-commission';
    readonly vintage: number;
    readonly retrievedAt: string;
  };
  readonly properties: Record<string, unknown>;
}

export class GermanyBoundaryProvider extends BaseInternationalProvider<
  GermanyLayerType,
  GermanyConstituency
> {
  readonly country = 'DE';
  readonly countryName = 'Germany';
  readonly dataSource = 'Bundeswahlleiter';
  readonly apiType = 'static-file';
  readonly license = 'public-domain';

  readonly layers = new Map([
    ['bundestag', {
      type: 'bundestag',
      name: 'Bundestag Constituencies 2023',
      endpoint: 'https://www.bundeswahlleiter.de/...',
      expectedCount: 299,  // CRITICAL: Verify from official sources
      updateSchedule: 'event-driven',
      authority: 'electoral-commission',
      vintage: 2023,
      lastVerified: '2024-01-01',
    }],
  ]);

  async extractAll(): Promise<InternationalExtractionResult<GermanyLayerType, GermanyConstituency>> {
    // Implementation details
  }

  async extractLayer(layerType: GermanyLayerType) {
    // Implementation details
  }
}
```

**4. Add Unit Tests**

```typescript
import { describe, it, expect } from 'vitest';
import { GermanyBoundaryProvider } from './germany-provider.js';

describe('GermanyBoundaryProvider', () => {
  it('should have correct configuration', () => {
    const provider = new GermanyBoundaryProvider();
    expect(provider.country).toBe('DE');
    expect(provider.countryName).toBe('Germany');
  });

  it('should extract constituencies', async () => {
    const provider = new GermanyBoundaryProvider();
    const result = await provider.extractAll();
    expect(result.totalBoundaries).toBeGreaterThan(0);
  });

  it('should validate expected counts', async () => {
    const provider = new GermanyBoundaryProvider();
    const result = await provider.extractLayer('bundestag');
    expect(result.matched).toBe(true);
    expect(result.actualCount).toBe(299);
  });

  it('should pass health check', async () => {
    const provider = new GermanyBoundaryProvider();
    const health = await provider.healthCheck();
    expect(health.available).toBe(true);
  });
});
```

**5. Register Provider**

```typescript
// packages/crypto/services/shadow-atlas/registry/international-providers.ts

import { GermanyBoundaryProvider } from '../providers/international/germany-provider.js';

export const INTERNATIONAL_PROVIDERS = new Map([
  // ... existing providers
  ['DE', new GermanyBoundaryProvider()],
]);
```

**6. Update Documentation**

- Add entry to `GLOBAL_SCALING_SPEC.md` with data source details
- Update this README with new provider in coverage list
- Document electoral system type and boundary counts

## Validation Requirements

### Expected Count Validation

Every extraction MUST validate against official expected counts:

```typescript
interface LayerExtractionResult {
  readonly expectedCount: number;  // Official seat count
  readonly actualCount: number;    // Extracted feature count
  readonly matched: boolean;       // actualCount === expectedCount
  readonly confidence: number;     // 0-100 validation score
}
```

**Confidence Scoring**:
- **Count match (50 points)**: Actual === expected
- **Data freshness (25 points)**: Vintage within 2 years = 25, 2-5 years = 20
- **Source authority (25 points)**: Constitutional = 25, electoral-commission = 22

**Example Validation**:
```typescript
{
  layer: 'parliamentary',
  expectedCount: 650,      // Official UK Boundary Commissions count
  actualCount: 650,        // Extracted from ONS
  matched: true,           // ✓ Validation passed
  confidence: 97,          // High confidence
}
```

### Failure Handling

- If `actualCount !== expectedCount`: Log warning, flag for manual review
- If `confidence < 70`: Reject extraction, require manual verification
- If `error` present: Retry with exponential backoff, escalate after 3 failures

## Data Source Types

```typescript
type DataSourceType =
  | 'arcgis-rest'      // ArcGIS REST API (UK, Australia)
  | 'wfs'              // OGC Web Feature Service (EU common)
  | 'rest-api'         // Custom REST API (Canada)
  | 'static-file'      // Shapefile/GeoJSON download (Germany)
  | 'census-api'       // National census APIs
  | 'electoral-api';   // Electoral commission APIs
```

## Authority Levels

```typescript
type AuthorityLevel =
  | 'constitutional'      // Constitutional mandate (US Census Bureau)
  | 'electoral-commission'// Official electoral body (UK Boundary Commissions)
  | 'national-statistics' // National stats agency (Canada StatCan)
  | 'state-agency'        // State/provincial agency
  | 'municipal-agency'    // Municipal GIS
  | 'commercial'          // Private aggregators
  | 'community';          // OpenStreetMap, volunteer
```

Higher authority = more trustworthy. Used for conflict resolution when multiple sources exist.

## Testing

### Unit Tests

```bash
# Run all international provider tests
npm run test -- providers/international

# Run specific provider tests
npm run test -- uk-provider.test.ts
npm run test -- canada-provider.test.ts
npm run test -- australia-provider.test.ts
```

### Integration Tests (Live APIs)

```bash
# Run integration tests against live APIs (slower)
RUN_INTEGRATION_TESTS=1 npm run test:integration -- providers/international
```

**Note**: Integration tests make real API calls and may be slow. Only run when validating against live data sources.

## Health Monitoring

### Provider Health Checks

Health checks run hourly in production to detect availability issues:

```typescript
interface ProviderHealth {
  readonly available: boolean;     // Can we reach the API?
  readonly latencyMs: number;      // Response time
  readonly lastChecked: Date;
  readonly issues: string[];       // Detected problems
}
```

**Failure Thresholds**:
- Latency > 10s: Warning (log slow response)
- Latency > 30s: Critical (mark degraded)
- Unavailable for 1 hour: Alert on-call
- Unavailable for 24 hours: Escalate

### Monitoring Example

```typescript
import { checkAllProvidersHealth } from '../registry/international-providers';

// Check all providers
const health = await checkAllProvidersHealth();

for (const [country, status] of health) {
  if (!status.available) {
    console.error(`${country} provider DOWN: ${status.issues.join(', ')}`);
  } else if (status.latencyMs > 5000) {
    console.warn(`${country} provider SLOW: ${status.latencyMs}ms`);
  }
}
```

## Phase-by-Phase Expansion

### Phase 1: Anglosphere (Months 1-6) - **4 Countries**

**Status**: ✅ 75% Complete (3/4 countries)

- ✅ United Kingdom (650 parliamentary constituencies)
- ✅ Canada (338 federal electoral districts)
- ✅ Australia (151 federal electoral divisions)
- ⏳ New Zealand (79 electorates) - **Pending**

**Coverage**: 1,218 electoral districts across 4 countries

### Phase 2: European Union (Months 7-12) - **27 Countries**

**Status**: 🎯 Planning

**Priority 1** (Months 7-8):
- Germany (299 Bundestag constituencies)
- France (577 National Assembly constituencies)
- Italy (400 Chamber of Deputies seats)
- Spain (350 Congress seats)
- Poland (460 Sejm seats)

**Priority 2** (Months 9-10):
- Netherlands (150 seats, national list)
- Belgium, Greece, Portugal, Czech Republic

**Priority 3** (Months 11-12):
- Remaining 17 EU countries

**Coverage**: ~6,000 electoral districts/seats across 27 countries

### Phase 3: G20 + Major Democracies (Months 13-24) - **50 Countries**

**Status**: 🎯 Planning

- **Asia-Pacific**: Japan, South Korea, India, Indonesia, Taiwan
- **Americas**: Brazil, Mexico, Argentina, Chile, Colombia
- **Other**: Israel, Turkey, South Africa, Norway, Switzerland

**Coverage**: ~10,000 electoral districts

### Phase 4: Global Coverage (Months 25-36) - **190+ Countries**

**Status**: 🎯 Planning

All UN member states + autonomous regions.

**Coverage**: ~50,000 electoral districts globally

## Performance Benchmarks

### Target Metrics

**Phase 1** (Current):
- ✅ <2s average extraction latency per country
- ✅ 100% count validation match
- ✅ Zero manual intervention for data extraction
- ✅ <100ms health check latency

**Phase 2** (EU):
- 🎯 <5s average extraction latency
- 🎯 >95% count validation match
- 🎯 <10% manual intervention

**Phase 3** (G20):
- 🎯 <10s average extraction latency
- 🎯 >90% count validation match
- 🎯 <20% manual intervention

**Phase 4** (Global):
- 🎯 <15s average extraction latency
- 🎯 >85% count validation match
- 🎯 <30% manual intervention

## Contributing

### Adding a New Country Provider

1. Research official data source (electoral commission, national statistics)
2. Create provider file: `{country-code}-provider.ts`
3. Implement `BaseInternationalProvider` interface
4. Add comprehensive unit tests
5. Register provider in `international-providers.ts`
6. Update `GLOBAL_SCALING_SPEC.md` and this README
7. Submit PR with integration test results

### Code Quality Standards

**CRITICAL TYPE SAFETY**: These types define the contract for event-sourced boundary data. Type errors can brick the entire discovery pipeline.

- ✅ `readonly` everywhere (immutable types)
- ✅ Strict generics (no `any`, `unknown` requires narrowing)
- ✅ Discriminated unions for variant types
- ✅ Explicit types for all function parameters and returns
- ✅ Comprehensive interfaces for all data structures
- ✅ Type guards for runtime validation

## Resources

- **[GLOBAL_SCALING_SPEC.md](./GLOBAL_SCALING_SPEC.md)**: Complete expansion roadmap with data sources
- **[base-provider.ts](./base-provider.ts)**: Abstract base class and interfaces
- **[international-providers.ts](../registry/international-providers.ts)**: Provider registry

## Contact

For questions about international provider architecture:
- See `GLOBAL_SCALING_SPEC.md` for expansion roadmap
- Review existing providers (UK, Canada, Australia) for implementation patterns

---

**Making democracy engaging globally through extensible, type-safe boundary provider architecture.**
