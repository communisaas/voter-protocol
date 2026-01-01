# Shadow Atlas: Comprehensive District Coverage Implementation Plan

> **Distinguished Engineering Principle**: Complete coverage through systematic gap closure, not aspirational feature expansion. Every district type defined in `TIGERLayerType` must have validation, expected counts, and edge case handling.

## Executive Summary

Shadow Atlas currently validates **11 district types** with per-state expected counts. This plan addresses **14 remaining gaps** across three categories:

| Category | Gaps | Priority | Effort |
|----------|------|----------|--------|
| Per-State Expected Counts | 5 layers missing state breakdown | P0 | 2-3 days |
| Geographic Validation Guards | 4 edge cases unhandled | P0 | 1-2 days |
| Redistricting & Freshness | 2 integrations unwired | P1 | 1 day |
| Special Districts & DC | 3 non-TIGER sources | P2 | 3-5 days |

**Philosophy**: Depend on existing abstractions. The provider pattern, validation pipeline, and expected counts system are production-ready. We extend, not rebuild.

---

## Current State: What Works

### Fully Implemented (11 district types)
```
TIGER Layer    Per-State Counts    Validation    Edge Cases
─────────────────────────────────────────────────────────────
cd             ✅ 435 total        ✅            ✅ At-large identified
sldu           ✅ 1,972 total      ✅            ✅ Nebraska unicameral
sldl           ✅ 5,411 total      ✅            ✅ Nebraska/DC = 0
county         ✅ 3,143 total      ✅            ✅ VA independent cities
vtd            ✅ 187,540 total    ✅            ✅ 2020 vintage tracking
place          ✅ 19,666 total     ✅            ─
cdp            ✅ 12,019 total     ✅            ✅ DC = 0
unsd           ✅ 12,920 total     ✅            ✅ Hawaii single district
elsd           ✅ 1,095 total      ✅            ✅ 13 states only
scsd           ✅ 488 total        ✅            ✅ 3 states only
school overlap ─                   ✅            ✅ 9 dual-system states
```

### Infrastructure Ready (reuse these patterns)
- **Expected counts**: `tiger-expected-counts.ts` pattern for per-state maps
- **Validation guards**: `validateCompleteness()` in `tiger-validator.ts`
- **Topology rules**: `LAYER_TOPOLOGY_RULES` in `topology-rules.ts`
- **Gap detection**: `RedistrictingGapDetector` in `gap-detector.ts`
- **Provider pattern**: `BoundaryProvider` interface in `types/provider.ts`

---

## Gap Analysis: What's Missing

### Category 1: Per-State Expected Counts (P0)

| Layer | National Total | Per-State Map | Status |
|-------|---------------|---------------|--------|
| cousub | ~34,000 | ❌ Missing | Need `EXPECTED_COUSUB_BY_STATE` |
| concity | ~40 | ❌ Missing | Need `EXPECTED_CONCITY_BY_STATE` |
| submcd | ~200 | ❌ Missing | Need `EXPECTED_SUBMCD_BY_STATE` |
| aiannh | 700 | ❌ Missing | Need `EXPECTED_AIANNH_BY_STATE` |
| tbg/ttract | Variable | ❌ Missing | Need tribal per-state breakdown |

**Implementation Pattern** (from existing code):
```typescript
// File: src/validators/tiger-expected-counts.ts
// Pattern: Follow EXPECTED_COUNTIES_BY_STATE structure

export const EXPECTED_COUSUB_BY_STATE: Record<string, number> = {
  '01': 967,   // Alabama
  '02': 29,    // Alaska (boroughs, not townships)
  // ... all 56 jurisdictions
};

// Then add to getExpectedCount() switch statement
// Then add to NATIONAL_TOTALS computed property
```

### Category 2: Geographic Validation Guards (P0)

| Constraint | Layer | Allowed States | Current Status |
|------------|-------|----------------|----------------|
| NECTA restriction | necta, cnecta, nectadiv | CT, ME, MA, NH, NJ, NY, RI, VT | ❌ No guard |
| Estate USVI-only | estate | 78 (USVI) | ❌ No guard |
| At-large ZZZ filter | cd | AK, DE, ND, SD, VT, WY | ❌ No filter |
| Tribal cross-state | aiannh | All (but spans states) | ❌ No handling |

**Implementation Pattern** (extend existing validation):
```typescript
// File: src/validators/tiger-validator.ts
// Location: validateCompleteness() method, after line 358

// Add geographic restriction check before count validation
const geoRestriction = this.checkGeographicRestriction(layer, stateFips);
if (!geoRestriction.valid) {
  return {
    valid: false,
    expected: 0,
    actual: 0,
    percentage: 0,
    missingGEOIDs: [],
    extraGEOIDs: [],
    summary: geoRestriction.reason,
  };
}
```

### Category 3: Redistricting Gap Enforcement (P1)

| Component | Status | Integration Point |
|-----------|--------|-------------------|
| Gap detector | ✅ Implemented | `gap-detector.ts` |
| Authority rules | ✅ Implemented | `tiger-authority-rules.ts` |
| Provider integration | ❌ Not wired | `tiger-boundary-provider.ts` |
| Validator integration | ❌ Not wired | `tiger-validator.ts` |

**Implementation Pattern** (wire existing detector):
```typescript
// File: src/validators/tiger-validator.ts
// Add to validate() method after line 822

import { RedistrictingGapDetector } from '../provenance/gap-detector.js';

// Check redistricting gap for legislative layers
if (['cd', 'sldu', 'sldl'].includes(layer)) {
  const gapDetector = new RedistrictingGapDetector();
  const gapStatus = gapDetector.checkBoundaryGap(
    layer === 'cd' ? 'congressional' : layer === 'sldu' ? 'state_senate' : 'state_house',
    stateFips || '',
    new Date()
  );

  if (gapStatus.inGap) {
    // Add warning to result, don't fail validation
    result.warnings.push(`⚠️ In redistricting gap: ${gapStatus.reasoning}`);
  }
}
```

### Category 4: Non-TIGER Sources (P2)

| District Type | Source | Architecture |
|---------------|--------|--------------|
| DC Wards (8) | DC Open Data | New provider extending `BoundaryProvider` |
| Special Districts | State GIS portals | Provider registry pattern |
| City Council | Municipal GIS | 4-path discovery (exists) |

**Implementation Pattern** (extend provider system):
```typescript
// File: src/providers/dc-wards-provider.ts (new)
// Extends: BoundaryProvider interface

export class DCWardsProvider implements BoundaryProvider {
  readonly countryCode = 'US';
  readonly name = 'DC Ward Boundaries';
  readonly source = 'DC Open Data';

  async download(): Promise<RawBoundaryFile[]> {
    // Query: https://opendata.dc.gov/datasets/ward-from-2022
  }

  async transform(raw: RawBoundaryFile[]): Promise<NormalizedBoundary[]> {
    // Normalize to 8 wards with standard schema
  }
}
```

---

## Implementation Waves

### Wave 1: Per-State Expected Counts (P0)
**Objective**: Add per-state breakdown for 5 layer types
**Files**: `src/validators/tiger-expected-counts.ts`
**Pattern**: Follow `EXPECTED_COUNTIES_BY_STATE` structure

| Work Package | Layer | Data Source | Effort |
|--------------|-------|-------------|--------|
| WP-COUNTS-1 | cousub | Census TIGER 2024 | 2 hours |
| WP-COUNTS-2 | concity | Census TIGER 2024 | 1 hour |
| WP-COUNTS-3 | submcd | Census TIGER 2024 | 1 hour |
| WP-COUNTS-4 | aiannh | Census TIGER 2024 | 2 hours |
| WP-COUNTS-5 | tbg/ttract | Census TIGER 2024 | 2 hours |

**Deliverable**: 5 new `EXPECTED_*_BY_STATE` constants, updated `getExpectedCount()`, updated `NATIONAL_TOTALS`

### Wave 2: Geographic Validation Guards (P0)
**Objective**: Prevent invalid layer/state combinations
**Files**: `src/validators/tiger-validator.ts`, `src/validators/topology-rules.ts`
**Pattern**: Extend `validateCompleteness()` with geographic checks

| Work Package | Constraint | Allowed States |
|--------------|------------|----------------|
| WP-GEO-1 | NECTA New England only | 09, 23, 25, 33, 34, 36, 44, 50 |
| WP-GEO-2 | Estate USVI only | 78 |
| WP-GEO-3 | At-large CD filter | 02, 10, 38, 46, 50, 56 |
| WP-GEO-4 | Tribal cross-state | Document behavior, no block |

**Deliverable**: `checkGeographicRestriction()` method, `allowedStateFips` in topology rules

### Wave 3: Redistricting Gap Integration (P1)
**Objective**: Wire gap-detector into validation pipeline
**Files**: `src/validators/tiger-validator.ts`, `src/providers/tiger-boundary-provider.ts`
**Pattern**: Import and call existing `RedistrictingGapDetector`

| Work Package | Integration Point |
|--------------|-------------------|
| WP-GAP-1 | Add gap check to `validate()` method |
| WP-GAP-2 | Add freshness warning to provider download |

**Deliverable**: Legislative layer validation includes redistricting gap warnings

### Wave 4: Non-TIGER Sources (P2)
**Objective**: Scaffold providers for DC wards and special districts
**Files**: New providers in `src/providers/`
**Pattern**: Extend `BoundaryProvider` interface

| Work Package | Source | Expected Count |
|--------------|--------|----------------|
| WP-NONTIGER-1 | DC Wards | 8 |
| WP-NONTIGER-2 | Special District Provider Scaffold | Template only |

**Deliverable**: `DCWardsProvider` implementation, special district provider template

---

## File Modification Map

### Must Modify (existing files)
```
src/validators/tiger-expected-counts.ts
├── Add EXPECTED_COUSUB_BY_STATE
├── Add EXPECTED_CONCITY_BY_STATE
├── Add EXPECTED_SUBMCD_BY_STATE
├── Add EXPECTED_AIANNH_BY_STATE
├── Update getExpectedCount() switch
└── Update NATIONAL_TOTALS

src/validators/tiger-validator.ts
├── Add checkGeographicRestriction() method
├── Add NECTA/Estate/At-large guards
├── Wire RedistrictingGapDetector
└── Add gap warnings to ValidationResult

src/validators/topology-rules.ts
├── Add allowedStateFips to LayerTopologyRules interface
├── Add restrictions for necta, estate layers
└── Document at-large CD behavior
```

### Must Create (new files)
```
src/providers/dc-wards-provider.ts
├── Implements BoundaryProvider
├── Downloads from DC Open Data
└── Transforms to 8 NormalizedBoundary

src/providers/special-district-provider.ts (template)
├── Abstract base for state-specific providers
├── LAFCo integration pattern
└── Update monitoring hooks
```

### Must Test (new test files)
```
src/__tests__/unit/validators/geographic-restrictions.test.ts
├── NECTA New England only
├── Estate USVI only
├── At-large CD handling
└── Tribal cross-state documentation

src/__tests__/unit/validators/redistricting-gap.test.ts
├── Gap detection in validate()
├── Warning inclusion in result
└── Provider freshness check

src/__tests__/unit/providers/dc-wards-provider.test.ts
├── Download from DC Open Data
├── Transform to 8 wards
└── Validation of ward names
```

---

## Success Criteria

### Wave 1 Complete When:
- [ ] All 5 `EXPECTED_*_BY_STATE` constants added
- [ ] `getExpectedCount()` handles all 5 layers
- [ ] `NATIONAL_TOTALS` includes computed sums
- [ ] Unit tests verify state-level lookups

### Wave 2 Complete When:
- [ ] NECTA queries for non-New England states return error
- [ ] Estate queries for non-USVI states return error
- [ ] At-large CD states don't create phantom districts
- [ ] `allowedStateFips` in `LayerTopologyRules` interface

### Wave 3 Complete When:
- [ ] `validate()` calls `RedistrictingGapDetector` for cd/sldu/sldl
- [ ] Redistricting gap produces warning, not failure
- [ ] Warning appears in `ValidationResult.summary`

### Wave 4 Complete When:
- [ ] `DCWardsProvider` downloads and transforms 8 wards
- [ ] Special district provider template exists
- [ ] Provider registry pattern documented

---

## Execution Timeline

```
Day 1: Wave 1 (Per-State Counts)
├── WP-COUNTS-1: cousub (2 hours)
├── WP-COUNTS-2: concity (1 hour)
├── WP-COUNTS-3: submcd (1 hour)
├── WP-COUNTS-4: aiannh (2 hours)
└── WP-COUNTS-5: tbg/ttract (2 hours)

Day 2: Wave 2 (Geographic Guards)
├── WP-GEO-1: NECTA restriction (1 hour)
├── WP-GEO-2: Estate restriction (1 hour)
├── WP-GEO-3: At-large filter (2 hours)
└── WP-GEO-4: Tribal documentation (1 hour)

Day 3: Wave 3 + Wave 4 Start
├── WP-GAP-1: Validator integration (2 hours)
├── WP-GAP-2: Provider freshness (1 hour)
└── WP-NONTIGER-1: DC Wards provider (3 hours)

Day 4: Wave 4 Complete + Tests
├── WP-NONTIGER-2: Special district template (2 hours)
├── All unit tests (3 hours)
└── Integration validation (1 hour)
```

---

## Anti-Patterns to Avoid

1. **Don't rebuild validation pipeline** - Extend `validateCompleteness()`, don't create parallel validation
2. **Don't duplicate expected counts** - Single source of truth in `tiger-expected-counts.ts`
3. **Don't create new provider base class** - Use existing `BoundaryProvider` interface
4. **Don't add `any` types** - Nuclear-level TypeScript strictness per CLAUDE.md
5. **Don't skip tests** - Every work package includes unit tests

---

## References

- TIGER Layer Config: `src/providers/tiger-boundary-provider.ts:42-583`
- Expected Counts Pattern: `src/validators/tiger-expected-counts.ts:229-479`
- Validation Pipeline: `src/validators/tiger-validator.ts:358-854`
- Gap Detector: `src/provenance/gap-detector.ts:1-598`
- Provider Interface: `src/core/types/provider.ts:1-336`
- Topology Rules: `src/validators/topology-rules.ts:1-500`

---

*Quality discourse pays. Bad faith costs.*
