# Topology Validation Test Fixtures

**No test theater** - these fixtures validate real geometric properties using turf.js operations.

## Design Philosophy

These fixtures test actual polygon intersections, unions, and area calculations. Zero mocking. Every test exercises the real topology validation logic with predictable geometric inputs.

### Key Principles

1. **Simple Geometries**: Rectangular polygons with integer coordinates for exact area calculations
2. **Realistic GEOIDs**: Follow Census Bureau naming conventions (e.g., `53033VTD001` for Washington State, King County, VTD 001)
3. **Tiling vs. Non-Tiling**: Clear distinction between layers that must tesselate (VTD, COUSUB) and those that can overlap (PLACE, CDP, ZCTA)
4. **Sub-0.001% Tolerance**: Precision thresholds that catch real geometric issues while allowing floating-point rounding

## Fixture Sets

### 1. Perfect Tiling (PASS)
**File**: `PERFECT_TILING_FIXTURE`
**Validates**: VTDs that perfectly tile within county boundaries

```typescript
import { PERFECT_TILING_FIXTURE } from './topology-fixtures';

// Geometry: 10×10 county with 4 perfectly-aligned 5×5 VTDs
// Expected: 0% gaps, 0% overlaps, 100% coverage → PASS
```

**Real-world analog**: Well-maintained precinct maps where every address belongs to exactly one precinct.

### 2. Gap Detected (FAIL)
**File**: `GAP_DETECTED_FIXTURE`
**Validates**: Detection of 0.5% gap (exceeds 0.001% threshold)

```typescript
import { GAP_DETECTED_FIXTURE } from './topology-fixtures';

// Geometry: One VTD is 0.1 units shorter → 0.5 square unit gap
// Expected: 0.5% gap > 0.001% threshold → FAIL
```

**Real-world analog**: Precinct boundary errors where addresses fall into "no man's land" between districts.

### 3. Overlap Detected (FAIL)
**File**: `OVERLAP_DETECTED_FIXTURE`
**Validates**: Detection of 0.25% overlap (exceeds 0.001% threshold)

```typescript
import { OVERLAP_DETECTED_FIXTURE } from './topology-fixtures';

// Geometry: Two VTDs overlap by 0.5×0.5 = 0.25 square units
// Expected: 0.25% overlap > 0.001% threshold → FAIL
```

**Real-world analog**: Conflicting precinct maps where addresses belong to multiple districts.

### 4. Valid Overlapping PLACEs (PASS)
**File**: `VALID_OVERLAP_FIXTURE`
**Validates**: Overlaps are permitted for non-tiling layers

```typescript
import { VALID_OVERLAP_FIXTURE } from './topology-fixtures';

// Geometry: Two cities with 20% overlap
// Expected: PASS for PLACE layer (non-tiling permitted)
```

**Real-world analog**: Cities like Atlanta/Sandy Springs where boundaries can overlap or cross county lines.

### 5. Perfect County Subdivisions (PASS)
**File**: `PERFECT_COUSUB_FIXTURE`
**Validates**: Towns/townships that perfectly tile within county

```typescript
import { PERFECT_COUSUB_FIXTURE } from './topology-fixtures';

// Geometry: 4 New England towns perfectly tiling Norfolk County, MA
// Expected: 0% gaps, 0% overlaps → PASS
```

**Real-world analog**: New England town boundaries that completely partition counties.

### 6. Floating Point Precision (PASS)
**File**: `PRECISION_FIXTURE`
**Validates**: Sub-threshold gaps from floating-point rounding

```typescript
import { PRECISION_FIXTURE } from './topology-fixtures';

// Geometry: 0.00001 unit gap → 0.0001% gap
// Expected: 0.0001% < 0.001% threshold → PASS
```

**Real-world analog**: GIS coordinate precision limits that create microscopic gaps invisible at typical zoom levels.

## Usage Examples

### Basic Validation Test

```typescript
import { describe, test, expect } from 'vitest';
import { PERFECT_TILING_FIXTURE } from './fixtures/topology-fixtures';
import { validateTopology } from '../services/topology-validator';

describe('Topology Validation', () => {
  test('Perfect tiling passes validation', () => {
    const [county, ...vtds] = PERFECT_TILING_FIXTURE.features;

    const result = validateTopology({
      parent: county,
      children: vtds,
      layerType: 'VTD',
      tolerance: 0.001, // 0.001% threshold
    });

    expect(result.valid).toBe(true);
    expect(result.gapPercentage).toBe(0);
    expect(result.overlapPercentage).toBe(0);
    expect(result.totalCoverage).toBeCloseTo(100, 3);
  });
});
```

### Gap Detection Test

```typescript
import { GAP_DETECTED_FIXTURE } from './fixtures/topology-fixtures';

test('Gap detection fails for tiling layers', () => {
  const [county, ...vtds] = GAP_DETECTED_FIXTURE.features;

  const result = validateTopology({
    parent: county,
    children: vtds,
    layerType: 'VTD',
    tolerance: 0.001,
  });

  expect(result.valid).toBe(false);
  expect(result.gapPercentage).toBeGreaterThan(0.001);
  expect(result.errors).toContain('Gap exceeds tolerance threshold');
});
```

### Non-Tiling Layer Test

```typescript
import { VALID_OVERLAP_FIXTURE } from './fixtures/topology-fixtures';

test('Overlaps permitted for PLACE layer', () => {
  const [county, ...places] = VALID_OVERLAP_FIXTURE.features;

  const result = validateTopology({
    parent: county,
    children: places,
    layerType: 'PLACE',
    tolerance: 0.001,
    allowOverlaps: true, // Non-tiling layer
  });

  expect(result.valid).toBe(true);
  expect(result.overlapPercentage).toBeGreaterThan(0); // Has overlaps
  expect(result.errors).toHaveLength(0); // But no errors for PLACE layer
});
```

### Iterating All Fixtures

```typescript
import { ALL_TOPOLOGY_FIXTURES } from './fixtures/topology-fixtures';

describe.each(ALL_TOPOLOGY_FIXTURES)(
  'Topology Validation: $name',
  ({ fixture, expectedOutcome, tilingExpected }) => {
    test(`should ${expectedOutcome}`, () => {
      const [parent, ...children] = fixture.features;

      const result = validateTopology({
        parent,
        children,
        layerType: 'VTD', // Or extract from fixture metadata
        tolerance: 0.001,
        allowOverlaps: !tilingExpected,
      });

      expect(result.valid).toBe(expectedOutcome === 'PASS');
    });
  }
);
```

## Helper Functions

### `createRectanglePolygon(minLon, minLat, maxLon, maxLat): Polygon`

Create rectangular polygons with exact coordinates:

```typescript
import { createRectanglePolygon } from './fixtures/topology-fixtures';

// 5×5 square centered at origin
const square = createRectanglePolygon(-2.5, -2.5, 2.5, 2.5);

// Area = (2.5 - (-2.5)) * (2.5 - (-2.5)) = 5 * 5 = 25 square units
```

### `validateFixtureAreas(fixture): { parentArea, childrenTotalArea, expectedCoverage }`

Debug area calculations:

```typescript
import { validateFixtureAreas, PERFECT_TILING_FIXTURE } from './fixtures/topology-fixtures';

const areas = validateFixtureAreas(PERFECT_TILING_FIXTURE);
console.log(areas);
// {
//   parentArea: 100,
//   childrenTotalArea: 100,
//   expectedCoverage: 100
// }
```

## Geometry Coordinate System

All fixtures use a **simple unit space** for predictable calculations:

```
         Y
         ^
         |
    5  ┌─┬─┐
       │ │ │
    0  ├─┼─┤ ← Origin (0,0)
       │ │ │
   -5  └─┴─┘
       │
  ─────┼─────> X
      -5 0 5
```

**Why simple coordinates?**
- Exact area calculations (no floating-point surprises)
- Predictable intersections (overlap regions are rectangles)
- Easy mental math for debugging (5×5 = 25, not 5.00001×4.99999 = 24.999...)

## Real-World GEOID Formats

Fixtures use realistic Census Bureau GEOID formats:

| Layer   | Example GEOID   | Format                          | Description                          |
|---------|-----------------|----------------------------------|--------------------------------------|
| COUNTY  | `53033`         | `{STATEFP}{COUNTYFP}`           | King County, Washington              |
| VTD     | `53033VTD001`   | `{STATEFP}{COUNTYFP}{VTDST}`    | King County VTD 001                  |
| COUSUB  | `2502107000`    | `{STATEFP}{COUNTYFP}{COUSUBFP}` | Brookline town, Norfolk County, MA   |
| PLACE   | `1304000`       | `{STATEFP}{PLACEFP}`            | Atlanta city, Georgia                |

**See Census Bureau TIGER/Line documentation for complete GEOID specifications.**

## Validation Thresholds

```typescript
const TOLERANCE_THRESHOLD = 0.001; // 0.001% = 1 part per 100,000

// Examples:
// - 0.0001% gap → PASS (within tolerance)
// - 0.01% gap   → FAIL (exceeds tolerance)
// - 0.25% overlap → FAIL for VTD, PASS for PLACE
```

**Why 0.001%?**
- Allows floating-point rounding errors
- Strict enough to catch real geometric issues
- Typical GIS coordinate precision: ~1cm at equator

## Integration with Real Topology Validator

These fixtures are designed to work with the actual topology validation service:

```typescript
// services/topology-validator.ts
import * as turf from '@turf/turf';

export function validateTopology(config: {
  parent: Feature<Polygon>;
  children: Feature<Polygon>[];
  layerType: 'VTD' | 'COUSUB' | 'PLACE' | 'CDP' | 'ZCTA';
  tolerance: number;
  allowOverlaps?: boolean;
}): {
  valid: boolean;
  gapPercentage: number;
  overlapPercentage: number;
  totalCoverage: number;
  errors: string[];
} {
  const parentArea = turf.area(config.parent); // REAL turf.js calculation
  const childrenUnion = turf.union(...config.children); // REAL union
  const intersections = /* ... REAL intersection checks ... */;

  // NO MOCKING - these are actual geometric operations
  // ...
}
```

## Anti-Patterns to Avoid

❌ **Mocking turf.js functions**
```typescript
vi.mock('@turf/turf', () => ({
  area: vi.fn(() => 100), // WRONG - defeats purpose of geometry tests
}));
```

❌ **Testing framework instead of logic**
```typescript
test('turf.area returns a number', () => {
  const result = turf.area(somePolygon);
  expect(typeof result).toBe('number'); // USELESS TEST
});
```

❌ **Imprecise area calculations**
```typescript
// WRONG - floating point hell
const weirdSquare = createRectanglePolygon(
  -2.333333333,
  -1.777777777,
  2.666666666,
  3.222222222
);
```

✅ **Testing real validation logic**
```typescript
test('Gap detection with real turf.js operations', () => {
  const [parent, ...children] = GAP_DETECTED_FIXTURE.features;

  // This calls REAL turf.union, turf.area, turf.intersect
  const result = validateTopology({ parent, children, /* ... */ });

  // Validates ACTUAL geometric properties
  expect(result.gapPercentage).toBeGreaterThan(0.001);
});
```

## Contributing New Fixtures

When adding new test fixtures:

1. **Use integer coordinates** for exact area calculations
2. **Document expected outcomes** in fixture metadata
3. **Validate areas manually** using `validateFixtureAreas()` helper
4. **Test both PASS and FAIL cases** for completeness
5. **Use realistic GEOIDs** following Census Bureau formats

**Example:**
```typescript
export const NEW_FIXTURE_COUNTY = createFeature(
  '12086', // Miami-Dade County, Florida
  'Miami-Dade County',
  createRectanglePolygon(-10, -10, 10, 10), // 20×20 = 400 sq units
  { STATEFP: '12', COUNTYFP: '086' }
);

// Verify areas before committing
const areas = validateFixtureAreas(NEW_FIXTURE);
console.assert(areas.parentArea === 400, 'Parent area mismatch');
```

## References

- **Census Bureau TIGER/Line Shapefiles**: https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html
- **turf.js Documentation**: https://turfjs.org/
- **GeoJSON Specification**: https://geojson.org/

---

**Remember**: These fixtures validate REAL geometric properties. If a test fails, it's because the validation logic or geometry is actually wrong—not because of test theater.
