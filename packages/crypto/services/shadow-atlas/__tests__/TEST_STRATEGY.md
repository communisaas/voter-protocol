# Shadow Atlas Test Strategy

Comprehensive testing approach for production-grade global deployment.

## Philosophy

**Test what matters. Test it well. Test it fast.**

Shadow Atlas processes geographic data for 190+ countries with zero tolerance for errors. Our test strategy reflects this reality:

- **Type safety prevents runtime errors** - Nuclear-level TypeScript strictness catches bugs at compile time
- **Tests validate logic, not types** - TypeScript handles type errors; tests validate business logic
- **Fast feedback loop** - Unit tests run in < 5 seconds; integration tests in < 30 seconds
- **Comprehensive coverage** - 90% overall, 100% for security-critical paths

## Test Pyramid

```
           /\
          /  \  E2E (5%)
         /____\  Full workflows, nightly only
        /      \
       / INTEG  \ Integration (15%)
      /  (30s)   \ Real APIs, conditional execution
     /____________\
    /              \
   /  UNIT (80%)    \ Unit Tests
  /  Fast, Mocked   \ < 1s per test, always run
 /__________________\
```

### Test Distribution

**Unit Tests (80%)**: Fast, deterministic, mocked external dependencies
- **Target**: < 1 second per test
- **Coverage**: > 90% line coverage
- **Run**: Every commit, PR checks, pre-push hooks

**Integration Tests (15%)**: Medium speed, conditional real APIs
- **Target**: < 30 seconds per test
- **Coverage**: Critical paths, API contracts
- **Run**: PR checks, main branch, nightly

**E2E Tests (5%)**: Slow, real APIs, complete workflows
- **Target**: < 60 seconds per test
- **Coverage**: Representative workflows
- **Run**: Nightly, pre-release

## Coverage Requirements

### Overall Coverage Targets

- **Minimum**: 90% line coverage
- **Services**: 95% line coverage
- **Security-critical**: 100% line coverage (no exceptions)
- **Utilities**: 85% line coverage

### Security-Critical Code (100% Coverage Required)

**Zero tolerance for gaps in security-critical code:**

- Merkle tree construction (`agents/merkle-tree-builder.ts`)
- Cryptographic operations (`merkle-tree.ts`, `merkle-tree-security.test.ts`)
- Input validation (`validators/**`)
- Authentication/authorization logic
- Data integrity checks (`provenance/**`)

### Excluded from Coverage

- Script files (`scripts/**`)
- Type definitions (`*.types.ts`)
- Configuration files
- Test utilities (`__tests__/utils/**`)

## Test Tiers

### Tier 1: Unit Tests

**Philosophy**: Fast, deterministic, zero network calls.

**Structure**:
```
__tests__/unit/
├── validators/
├── services/
├── providers/
├── utils/
└── core/
```

**Characteristics**:
- All external APIs mocked
- Deterministic (same input = same output)
- < 1 second per test
- Run on every commit

**Example**:
```typescript
import { describe, it, expect } from 'vitest';
import { validateGeoidFormat } from '../validators/geoid-validator.js';

describe('GEOID Validator', () => {
  it('validates correct GEOID format', () => {
    expect(validateGeoidFormat('5501', '55')).toBe(true);
  });

  it('rejects invalid GEOID format', () => {
    expect(validateGeoidFormat('ABC', '55')).toBe(false);
  });
});
```

### Tier 2: Integration Tests

**Philosophy**: Test integration between components with conditional real APIs.

**Structure**:
```
__tests__/integration/
├── tiger-api-contract.test.ts
├── tigerweb-shapefile-validation.test.ts
├── arcgis-hub-ground-truth.test.ts
└── state-batch-extractor.test.ts
```

**Characteristics**:
- Real API calls (can be mocked in CI)
- Tests API contracts and data pipelines
- < 30 seconds per test
- Conditional execution via `RUN_INTEGRATION=true`

**Example**:
```typescript
import { describe, it, expect } from 'vitest';
import { isCI, runIntegration } from '../setup.js';

const skipInCI = isCI && !runIntegration;

describe.skipIf(skipInCI)('TIGERweb Integration', () => {
  it('fetches Wisconsin congressional districts', async () => {
    const data = await fetchTIGERwebData('55', 'congressional');
    expect(data.features.length).toBe(8);
  }, 30_000);
});
```

### Tier 3: E2E Tests

**Philosophy**: Test complete workflows end-to-end with real data.

**Structure**:
```
__tests__/e2e/
├── multi-state-validation.test.ts
├── full-extraction-pipeline.test.ts
└── tiger-pipeline.test.ts
```

**Characteristics**:
- Real API calls to production endpoints
- Complete workflows (extract → validate → build → publish)
- < 60 seconds per test
- Run nightly only

**Example**:
```typescript
import { describe, it, expect } from 'vitest';
import { isCI, runE2E } from '../setup.js';

const skipInCI = isCI && !runE2E;

describe.skipIf(skipInCI)('Multi-State Validation E2E', () => {
  it('validates California districts', async () => {
    const result = await validateState('CA');
    expect(result.match).toBe(true);
  }, 60_000);
});
```

## Test Utilities

### Fixtures (`__tests__/utils/fixtures.ts`)

**Purpose**: Reusable test data factories.

**Key Exports**:
- `createBoundary()` - Create mock extracted boundary
- `createBoundaries()` - Create multiple boundaries for state
- `createLayerResult()` - Create layer extraction result
- `createStateResult()` - Create state extraction result
- `createBatchResult()` - Create batch extraction result
- `createTIGERwebResponse()` - Create mock TIGERweb API response

**Example**:
```typescript
import { createBoundary, createLayerResult } from '../utils/fixtures.js';

const boundary = createBoundary({
  id: '5501',
  name: 'District 1',
  state: 'WI',
  geoid: '5501',
});

const layerResult = createLayerResult({
  state: 'WI',
  layerType: 'congressional',
  expectedCount: 8,
  actualCount: 8,
});
```

### Mocks (`__tests__/utils/mocks.ts`)

**Purpose**: Type-safe service mocks.

**Key Exports**:
- `createMockFetch()` - Mock fetch with predefined responses
- `createRateLimitedFetch()` - Simulate rate limiting
- `createServerErrorFetch()` - Simulate server errors
- `createTIGERwebFetch()` - Mock TIGERweb API
- `createMockDatabase()` - Mock SQLite database

**Example**:
```typescript
import { createMockFetch } from '../utils/mocks.js';

const mockFetch = createMockFetch(new Map([
  ['https://api.example.com/data', { features: [...] }],
]));
global.fetch = mockFetch as any;
```

### Assertions (`__tests__/utils/assertions.ts`)

**Purpose**: Domain-specific assertions for geographic data.

**Key Exports**:
- `assertValidCoordinates()` - Validate lat/lon bounds
- `assertValidPolygon()` - Validate polygon geometry
- `assertValidGeoid()` - Validate GEOID format
- `assertBoundaryCount()` - Assert boundary count matches
- `assertUniformAuthority()` - Assert all boundaries have same authority
- `assertUniqueIds()` - Assert all boundary IDs are unique

**Example**:
```typescript
import { assertValidBoundaryGeometry, assertValidGeoid } from '../utils/assertions.js';

assertValidBoundaryGeometry(boundary);
assertValidGeoid('5501', '55');
```

## CI/CD Integration

### Pull Request Checks

**Fast feedback for developers:**

```bash
# Run unit tests only (< 5 seconds)
npm run test:atlas:unit
```

**What runs**:
- All unit tests
- Type checking
- Linting

**Pass criteria**:
- All tests pass
- No type errors
- No linting errors

### Main Branch

**Comprehensive validation:**

```bash
# Run unit + integration tests
npm run test:atlas
```

**What runs**:
- All unit tests
- Integration tests (with mocked APIs in CI)
- Coverage report

**Pass criteria**:
- All tests pass
- Coverage > 90%
- No critical issues

### Nightly Schedule

**Full validation with real APIs:**

```bash
# Run complete suite including E2E
npm run test:atlas:nightly
```

**What runs**:
- All unit tests
- All integration tests (with real APIs)
- All E2E tests
- Performance benchmarks
- Coverage report

**Pass criteria**:
- All tests pass
- Coverage > 90%
- Performance within budgets
- No regressions

## Flaky Test Handling

### Detection

**Flaky test indicators**:
- Intermittent failures (passes on retry)
- Environment-dependent failures
- Timing-dependent failures
- Network-dependent failures

### Mitigation

**Unit tests**:
- ✅ All external dependencies mocked
- ✅ Deterministic inputs
- ✅ No timing dependencies

**Integration tests**:
- ✅ Retry logic with exponential backoff
- ✅ Rate limiting to avoid 429 errors
- ✅ Generous timeouts (30 seconds)
- ✅ Conditional execution (skip in unstable environments)

**E2E tests**:
- ✅ Run nightly only
- ✅ Real API calls with retries
- ✅ Generous timeouts (60 seconds)
- ✅ Fail gracefully with clear error messages

### Quarantine Process

**When a test becomes flaky**:

1. **Identify**: Mark test with `.skip` and add comment
   ```typescript
   it.skip('flaky test - investigating', () => {
     // TODO: Fix timing issue
   });
   ```

2. **Track**: Create GitHub issue with:
   - Test name
   - Failure rate
   - Error messages
   - Environment details

3. **Fix**: Root cause analysis and fix:
   - Add retries
   - Increase timeouts
   - Mock unstable dependencies
   - Add deterministic delays

4. **Validate**: Run test 100 times locally:
   ```bash
   for i in {1..100}; do npm run test:atlas:unit; done
   ```

5. **Re-enable**: Remove `.skip` and monitor in CI

## Test Data Management

### Fixtures

**Location**: `__tests__/fixtures/`

**Categories**:
- `boundaries/` - Reference boundary datasets
- `api-responses/` - Frozen API responses
- `golden-vectors/` - Expected outputs

**Guidelines**:
- Fixtures are **frozen snapshots** (never auto-update)
- Include provenance (source, date, authority)
- Use minimal data (simplify for clarity)
- Version control all fixtures

### Golden Vectors

**Purpose**: Regression testing against known-good outputs.

**Example**:
```typescript
import { EXPECTED_MERKLE_ROOT } from '../fixtures/golden-vectors/merkle-trees.js';

const result = await buildMerkleTree(boundaries);
expect(result.root).toBe(EXPECTED_MERKLE_ROOT);
```

**When to update**:
- Algorithm changes (with explicit approval)
- Data format changes
- Never auto-update (manual review required)

## Performance Testing

### Benchmarks

**Target metrics** (`__tests__/performance/`):

- Single state extraction: < 30 seconds
- Batch extraction (10 states): < 5 minutes
- Merkle tree build (50 states): < 60 seconds
- Point-in-polygon lookup: < 100ms (cold), < 10ms (warm)
- Database write (1000 boundaries): < 5 seconds

### Memory Constraints

**Peak memory limits**:

- Full US extraction: < 2GB
- Merkle tree build (all states): < 500MB
- Per-state extraction: < 100MB

### Load Testing

**Concurrent operations**:

- 10 concurrent state extractions
- 100 concurrent PIP lookups
- 1000 concurrent database writes

### Performance Regression Detection

**Thresholds**:
- > 10% slower: Warning
- > 25% slower: Failure
- Memory growth > 20%: Failure

## Mutation Testing

### Purpose

Validate test quality by introducing mutations and verifying tests fail.

### Process

```bash
# Run mutation testing (nightly)
npm run test:atlas:mutation
```

**Mutations tested**:
- Operator changes (`>` → `<`)
- Constant changes (`8` → `9`)
- Boolean inversions (`true` → `false`)
- Return value changes

**Target**: > 80% mutation kill rate

### Critical Paths

**100% mutation coverage required**:
- GEOID validation
- Geometry validation
- Merkle tree construction
- Data integrity checks

## Security Testing

### Adversarial Tests

**Purpose**: Validate security-critical code against adversarial inputs.

**Location**: `validation-adversarial.test.ts`

**Test categories**:
1. **Input tampering** - Modified coordinates, invalid GEOIDs
2. **Boundary attacks** - Extreme lat/lon values, overlapping geometries
3. **Injection attacks** - SQL injection, XSS in properties
4. **Denial of service** - Extremely large polygons, infinite loops

**Example**:
```typescript
it('rejects longitude out of range', () => {
  const boundary = createBoundary({ lon: 200, lat: 45 });
  expect(() => validateBoundary(boundary)).toThrow('Invalid longitude');
});
```

### Fuzzing

**Random input generation**:

```typescript
import { fc } from 'fast-check';

it('handles arbitrary coordinates', () => {
  fc.assert(
    fc.property(
      fc.double(-180, 180), // lon
      fc.double(-90, 90),   // lat
      (lon, lat) => {
        const result = validateCoordinates(lon, lat);
        expect(result.valid).toBe(true);
      }
    )
  );
});
```

## Continuous Improvement

### Test Maintenance

**Weekly review**:
- Identify slow tests
- Remove redundant tests
- Update outdated fixtures
- Refactor test utilities

**Monthly audit**:
- Coverage analysis
- Performance trends
- Flaky test review
- Mutation testing results

### Test Metrics Dashboard

**Track over time**:
- Test count (unit/integration/E2E)
- Coverage percentage
- Test execution time
- Flaky test rate
- Performance benchmarks

## Running Tests

### Local Development

```bash
# Run all Shadow Atlas tests (unit + integration, skip E2E)
npm run test:atlas

# Run only unit tests (fast, no network)
npm run test:atlas:unit

# Run only integration tests (with real APIs)
npm run test:atlas:integration

# Run only E2E tests (slow, real APIs, nightly)
npm run test:atlas:e2e

# Run complete nightly suite (all tiers)
npm run test:atlas:nightly

# Watch mode (unit + integration)
npm run test:atlas:watch

# Run specific test file
npm run test:atlas -- data-validator.test.ts

# Run tests matching pattern
npm run test:atlas -- --grep="GEOID"

# Run with coverage
npm run test:atlas -- --coverage
```

### CI/CD Commands

```bash
# Pull request checks (unit tests only)
CI=true npm run test:atlas:unit

# Main branch (unit + integration with mocked APIs)
CI=true npm run test:atlas

# Nightly (complete suite with real APIs)
CI=true RUN_E2E=true RUN_INTEGRATION=true npm run test:atlas:nightly
```

## Environment Variables

```bash
# CI detection (automatically set by GitHub Actions)
CI=true

# Enable E2E tests (default: false)
RUN_E2E=true

# Enable integration tests (default: true)
RUN_INTEGRATION=true

# Skip flaky tests (emergency use only)
SKIP_FLAKY=true
```

## Best Practices

### 1. Type Safety

**ALWAYS use strict types. NEVER use `any`.**

```typescript
// ✅ CORRECT
interface ValidationResult {
  readonly match: boolean;
  readonly errors: readonly string[];
}

function validate(data: StateData): ValidationResult {
  // ...
}

// ❌ WRONG
function validate(data: any): any {
  // ...
}
```

### 2. Test Isolation

**Each test should be independent and idempotent.**

```typescript
// ✅ CORRECT
describe('Validator', () => {
  it('validates format A', () => {
    const input = createMockInput();
    const result = validate(input);
    expect(result.valid).toBe(true);
  });
});

// ❌ WRONG (shared state)
let sharedState: any;

describe('Validator', () => {
  it('test 1', () => {
    sharedState = { foo: 'bar' };
  });

  it('test 2', () => {
    expect(sharedState.foo).toBe('bar'); // Depends on test 1
  });
});
```

### 3. Descriptive Test Names

**Test names should describe WHAT is tested, not HOW.**

```typescript
// ✅ CORRECT
it('returns 8 congressional districts for Wisconsin', () => {
  // ...
});

// ❌ WRONG
it('test_1', () => {
  // ...
});
```

### 4. Rate Limiting

**Always rate limit real API calls in integration/E2E tests.**

```typescript
import { delay, API_RATE_LIMIT_MS } from '../setup.js';

it('fetches multiple states', async () => {
  const result1 = await fetchState('WI');
  await delay(API_RATE_LIMIT_MS); // Rate limit

  const result2 = await fetchState('CA');
  await delay(API_RATE_LIMIT_MS); // Rate limit
});
```

### 5. Error Handling

**Test both success and failure cases.**

```typescript
describe('Data Fetcher', () => {
  it('fetches valid data successfully', async () => {
    const result = await fetch('valid-url');
    expect(result.success).toBe(true);
  });

  it('handles 404 errors gracefully', async () => {
    await expect(fetch('invalid-url')).rejects.toThrow('404');
  });

  it('retries on rate limiting', async () => {
    const result = await retryWithBackoff(() => fetch('rate-limited-url'));
    expect(result.success).toBe(true);
  });
});
```

## Questions?

See existing test files for examples:
- **Unit**: `services/data-validator.test.ts`
- **Integration**: `__tests__/integration/tiger-api-contract.test.ts`
- **E2E**: `__tests__/e2e/multi-state-validation.test.ts`
- **Performance**: `__tests__/performance/README.md`
- **Utilities**: `__tests__/utils/index.ts`

**This is a living document. Update as test strategy evolves.**
