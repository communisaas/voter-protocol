# Shadow Atlas Test Framework

3-tier test architecture with clear boundaries for unit, integration, and E2E tests.

## Directory Structure

```
__tests__/
├── unit/                    # Fast, mocked tests (< 1s each)
│   ├── validators/          # Validation logic tests
│   ├── services/            # Service layer tests
│   └── providers/           # Provider tests with mocked APIs
├── integration/             # Medium, conditional real APIs (< 30s each)
│   ├── tiger-api-contract.test.ts
│   └── cross-validation.test.ts
├── e2e/                     # Slow, real APIs, nightly only (< 60s each)
│   ├── multi-state-validation.test.ts
│   └── tiger-pipeline.test.ts
├── fixtures/                # Shared test data
│   ├── boundaries/          # Reference boundary datasets
│   ├── api-responses/       # Frozen API responses
│   └── golden-vectors/      # Expected outputs
├── setup.ts                 # Global test configuration
└── README.md                # This file
```

## Test Tiers

### Unit Tests (`__tests__/unit/`)

**Characteristics:**
- Fast (< 1 second per test)
- No network calls (all external APIs mocked)
- Deterministic (same input = same output)
- Run on every commit

**When to write:**
- Testing pure functions
- Validating business logic
- Testing data transformations
- Verifying error handling

**Example:**
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

### Integration Tests (`__tests__/integration/`)

**Characteristics:**
- Medium speed (< 30 seconds per test)
- Conditional real API calls (can be mocked in CI)
- Tests integration between components
- Run on PR checks + nightly

**When to write:**
- Testing API contracts
- Validating data pipeline integration
- Testing cross-validation logic
- Verifying external service integration

**Example:**
```typescript
import { describe, it, expect } from 'vitest';
import { fetchTIGERwebData } from '../providers/tigerweb.js';
import { isCI, runIntegration } from '../setup.js';

const skipInCI = isCI && !runIntegration;

describe.skipIf(skipInCI)('TIGERweb Integration', () => {
  it('fetches Wisconsin congressional districts', async () => {
    const data = await fetchTIGERwebData('55', 'congressional');
    expect(data.features.length).toBe(8);
  }, 30_000);
});
```

### E2E Tests (`__tests__/e2e/`)

**Characteristics:**
- Slow (< 60 seconds per test)
- Real API calls to production endpoints
- Tests complete workflows end-to-end
- Run nightly only (not on every commit)

**When to write:**
- Validating complete data pipelines
- Testing multi-state workflows
- Verifying production readiness
- Regression testing against real data

**Example:**
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
```

### CI/CD

**Pull Request Checks:**
```bash
# Runs unit tests only (fast feedback)
npm run test:atlas:unit
```

**Main Branch:**
```bash
# Runs unit + integration tests
npm run test:atlas
```

**Nightly Schedule:**
```bash
# Runs complete suite including E2E
npm run test:atlas:nightly
```

## Environment Variables

```bash
# CI detection (automatically set by GitHub Actions)
CI=true

# Enable E2E tests (default: false)
RUN_E2E=true

# Enable integration tests (default: true)
RUN_INTEGRATION=true
```

## Fixtures

### Boundary Fixtures (`fixtures/boundaries/`)

Frozen boundary datasets for deterministic testing:

```typescript
import { WISCONSIN_CONGRESSIONAL_FIXTURE } from '../fixtures/boundaries/wisconsin.js';

// Use in tests
expect(result.boundaries).toEqual(WISCONSIN_CONGRESSIONAL_FIXTURE);
```

### API Response Fixtures (`fixtures/api-responses/`)

Frozen API responses for unit tests:

```typescript
import { TIGERWEB_WISCONSIN_CONGRESSIONAL_RESPONSE } from '../fixtures/api-responses/tigerweb.js';

// Mock fetch in unit tests
const mockFetch = createMockFetch(new Map([
  ['https://tigerweb.geo.census.gov/...', TIGERWEB_WISCONSIN_CONGRESSIONAL_RESPONSE],
]));
```

### Golden Vectors (`fixtures/golden-vectors/`)

Expected outputs for regression testing:

```typescript
import { EXPECTED_MERKLE_ROOT } from '../fixtures/golden-vectors/merkle-trees.js';

// Verify against golden vector
expect(result.merkleRoot).toBe(EXPECTED_MERKLE_ROOT);
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

  it('validates format B', () => {
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
    // ...
  });

  it('test 2', () => {
    // Depends on test 1 state
    expect(sharedState.foo).toBe('bar');
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

## Test Coverage Goals

- **Unit tests**: > 90% coverage
- **Integration tests**: Critical paths covered
- **E2E tests**: Representative states validated

## Continuous Improvement

This test framework is a living system. When you encounter bugs:

1. Write a failing test that reproduces the bug
2. Fix the code
3. Verify the test passes
4. Add regression test to prevent future occurrences

## Questions?

See existing test files for examples:
- **Unit**: `services/shadow-atlas/validators/tiger-validator.test.ts`
- **Integration**: `__tests__/integration/tiger-api-contract.test.ts`
- **E2E**: `__tests__/e2e/multi-state-validation.test.ts`
