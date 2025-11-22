# Boundary Discovery Routing Architecture

**Design Philosophy:** Composable, data-driven routing with clean separation of concerns

**For Future Agents:** This document explains how to modify discovery routing logic

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Design Patterns](#design-patterns)
3. [How to Add a New Data Source](#how-to-add-a-new-data-source)
4. [How to Modify Routing Logic](#how-to-modify-routing-logic)
5. [File Structure](#file-structure)
6. [Key Concepts](#key-concepts)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│  discoverBoundary() - Single Entry Point                 │
│  (orchestrator.ts)                                       │
└─────────────────┬────────────────────────────────────────┘
                  │
                  ├─→ 1. Classify location
                  │    (What administrative structure?)
                  │
                  ├─→ 2. Build routing context
                  │    (State, boundary type, classification)
                  │
                  ├─→ 3. Compose routing strategies
                  │    ┌────────────────────────────────────┐
                  │    │ Hub API First Strategy             │
                  │    │ Classification-Aware Strategy      │
                  │    │ Freshness-Aware Strategy           │
                  │    │ TIGER/Line Fallback Strategy       │
                  │    └────────────────────────────────────┘
                  │
                  ├─→ 4. Get source chain
                  │    [HubAPISource, StatePortalSource?, TIGERSource]
                  │
                  └─→ 5. Try sources until success
                       ↓
                   BoundaryResult
```

### Data Flow

```typescript
Location + BoundaryType
    ↓
Classification (independent city? federal district? standard?)
    ↓
Routing Context (all info needed for routing decisions)
    ↓
Routing Strategies (pure functions: context → sources)
    ↓
Source Chain (ordered list of data sources to try)
    ↓
Try each source sequentially until score >= threshold
    ↓
BoundaryResult (geometry + metadata + provenance)
```

---

## Design Patterns

### 1. Strategy Pattern

**What:** Each routing decision is a pure function `(context) => Source[]`

**Why:** Strategies are composable, testable, and swappable

**Example:**
```typescript
const hubAPIFirst: RoutingStrategy = (context) => {
  return [new HubAPISource()];
};

const tigerFallback: RoutingStrategy = (context) => {
  return [new TIGERSource(context.boundaryType)];
};
```

### 2. Chain of Responsibility

**What:** Try sources in order until one succeeds

**Why:** Graceful degradation without nested if/else

**Example:**
```typescript
for (const source of sources) {
  const result = await source.fetch(request);
  if (result && result.score >= threshold) {
    return result; // First success wins
  }
}
```

### 3. Factory Pattern

**What:** Sources are constructed lazily via factories

**Why:** Avoid initializing sources we won't use

**Example:**
```typescript
type SourceFactory = () => BoundaryDataSource;

const hubFactory: SourceFactory = () => new HubAPISource();
const tigerFactory: SourceFactory = () => new TIGERSource('sldl');
```

### 4. Registry Pattern

**What:** State-specific data lives in registries, not code

**Why:** Adding new state = edit data, not code

**Example:**
```typescript
const STATE_PORTAL_REGISTRY = [
  { state: 'CO', boundaryType: 'STATE_HOUSE', url: '...' },
  { state: 'IL', boundaryType: 'STATE_HOUSE', url: '...' }
];
```

### 5. Composition over Inheritance

**What:** Build complex behavior by composing simple strategies

**Why:** Easy to understand, easy to modify, easy to test

**Example:**
```typescript
const router = composeRouting([
  hubAPIFirst,
  freshnessAware,
  tigerFallback
]);
```

---

## How to Add a New Data Source

### Step 1: Implement BoundaryDataSource Interface

Create a new file in `src/discovery/sources/`:

```typescript
// src/discovery/sources/my-new-source.ts

import type { BoundaryDataSource, BoundaryRequest, SourceResult } from './types';

export class MyNewSource implements BoundaryDataSource {
  readonly name = 'My New Source';

  async fetch(request: BoundaryRequest): Promise<SourceResult | null> {
    // 1. Fetch data from your source
    const data = await fetchFromMyAPI(request.location, request.boundaryType);

    if (!data) {
      return null; // No data found
    }

    // 2. Calculate quality score (0-100)
    const score = calculateQuality(data);

    // 3. Return standardized result
    return {
      geometry: data.geometry, // GeoJSON Feature
      score: score,
      metadata: {
        source: this.name,
        publisher: 'My Organization',
        publishedDate: data.published,
        lastModified: data.modified
      }
    };
  }
}
```

### Step 2: Create Factory

Add factory to orchestrator configuration:

```typescript
// src/discovery/orchestrator.ts

export const DEFAULT_CONFIG: OrchestratorConfig = {
  sourceFactories: {
    hubAPI: () => new HubAPISource(),
    tiger: (type) => () => new TIGERSource(type),
    statePortal: (state, type) => /* ... */,
    myNewSource: () => new MyNewSource()  // <-- Add here
  },
  // ...
};
```

### Step 3: Add to Routing Strategy

Create a strategy that uses your new source:

```typescript
// src/discovery/sources/routing-strategy.ts

export function createMyNewSourceStrategy(
  myNewSourceFactory: SourceFactory
): RoutingStrategy {
  const strategy: RoutingStrategy = (context) => {
    // Your logic: when should we use this source?
    if (context.state === 'CA') {
      return [myNewSourceFactory()];
    }
    return [];
  };

  Object.defineProperty(strategy, 'name', { value: 'myNewSource' });
  return strategy;
}
```

### Step 4: Compose into Routing

Add your strategy to the composition:

```typescript
// src/discovery/orchestrator.ts in buildRouter()

const strategies: RoutingStrategy[] = [
  createHubAPIFirstStrategy(...),
  createMyNewSourceStrategy(...),  // <-- Add here
  createFreshnessAwareStrategy(...),
  createTIGERFallbackStrategy(...)
];
```

**That's it.** Zero changes needed anywhere else.

---

## How to Modify Routing Logic

### Example 1: Change Source Priority

**Goal:** Try TIGER before state portals

**Solution:** Reorder strategies array

```typescript
// Before (state portals tried before TIGER)
const strategies = [
  hubAPIFirst,
  freshnessAware,    // State portals
  tigerFallback      // TIGER
];

// After (TIGER tried before state portals)
const strategies = [
  hubAPIFirst,
  tigerFallback,     // TIGER
  freshnessAware     // State portals
];
```

### Example 2: Add Conditional Routing

**Goal:** Only use state portals for specific states

**Solution:** Use `conditional()` combinator

```typescript
import { conditional } from './sources/routing-strategy';

const statePortalForMT = conditional(
  (ctx) => ctx.state === 'MT',
  freshnessAwareStrategy
);

const strategies = [
  hubAPIFirst,
  statePortalForMT,  // Only for Montana
  tigerFallback
];
```

### Example 3: Add Parallel Sources

**Goal:** Try multiple sources simultaneously

**Solution:** Use `parallel()` combinator

```typescript
import { parallel } from './sources/routing-strategy';

const tryBothPortals = parallel(
  statePortalStrategy,
  alternativePortalStrategy
);

const strategies = [
  hubAPIFirst,
  tryBothPortals,  // Try both portals
  tigerFallback
];
```

### Example 4: Change Freshness Threshold

**Goal:** Consider state portals fresh for 5 years instead of 3

**Solution:** Edit registry metadata

```typescript
// src/discovery/sources/state-portal-registry.ts

export function buildRedistrictingMetadata() {
  // ...
  metadata.set(key, {
    state: config.state,
    boundaryType: config.boundaryType,
    lastRedistricting: config.lastRedistricting,
    freshnessThresholdMonths: 60  // 5 years (was 36)
  });
}
```

### Example 5: Add Logging

**Goal:** Debug routing decisions

**Solution:** Use `withLogging()` wrapper

```typescript
import { withLogging } from './sources/routing-strategy';

const loggedFreshness = withLogging(
  freshnessAwareStrategy,
  (ctx, sources) => {
    console.log(`Freshness check for ${ctx.state}: ${sources.length} sources`);
  }
);

const strategies = [
  hubAPIFirst,
  loggedFreshness,  // Logs when executed
  tigerFallback
];
```

---

## File Structure

```
src/discovery/
├── orchestrator.ts               # Single entry point: discoverBoundary()
├── sources/
│   ├── types.ts                 # BoundaryDataSource interface
│   ├── routing-strategy.ts      # Composable routing strategies
│   ├── state-portal-registry.ts # State GIS portal metadata
│   ├── hub-api.ts               # Hub API source (TODO)
│   ├── tiger-line.ts            # TIGER/Line source (TODO)
│   └── state-portal.ts          # State portal source (TODO)
├── classifiers/
│   └── municipal.ts             # Municipal classification logic
└── ROUTING_ARCHITECTURE.md      # This file
```

### Responsibility Matrix

| File | Responsibility | Modify to... |
|------|---------------|--------------|
| `orchestrator.ts` | Compose strategies | Change routing order |
| `routing-strategy.ts` | Define strategies | Add new routing logic |
| `state-portal-registry.ts` | State metadata | Add new state portal |
| `sources/*.ts` | Fetch from source | Add new data source |
| `classifiers/*.ts` | Classify locations | Add new classifications |

---

## Key Concepts

### 1. Pure Functions

**Routing strategies are pure functions:**
- Input: RoutingContext
- Output: readonly BoundaryDataSource[]
- No side effects (except logging)
- Deterministic (same input → same output)

**Why:** Testable, composable, predictable

### 2. Lazy Evaluation

**Sources are constructed via factories:**
```typescript
type SourceFactory = () => BoundaryDataSource;
```

**Why:** Don't initialize sources we won't use

### 3. Data-Driven Logic

**State-specific knowledge lives in registries:**
```typescript
const STATE_PORTAL_REGISTRY = [
  { state: 'CO', url: '...', lastRedistricting: Date }
];
```

**Why:** Add new state = edit data, not code

### 4. Composability

**Complex behavior from simple strategies:**
```typescript
const router = composeRouting([
  simple,
  strategies,
  compose,
  easily
]);
```

**Why:** Easy to understand, easy to modify

### 5. Type Safety

**TypeScript enforces correctness:**
```typescript
interface BoundaryDataSource {
  readonly name: string;
  fetch(request: BoundaryRequest): Promise<SourceResult | null>;
}
```

**Why:** Catch errors at compile time, not runtime

---

## Common Patterns

### Add New State Portal

**Location:** `src/discovery/sources/state-portal-registry.ts`

**Add to `STATE_PORTAL_REGISTRY` array:**
```typescript
{
  state: 'AZ',
  boundaryType: 'STATE_HOUSE',
  authority: 'Arizona Independent Redistricting Commission',
  name: 'Arizona IRC',
  url: 'https://irc.az.gov/shapefiles',
  format: 'shapefile',
  lastRedistricting: new Date('2021-12-22')
}
```

**That's all.** Registry rebuilds automatically.

### Add New Routing Strategy

**Location:** `src/discovery/sources/routing-strategy.ts`

**Create strategy function:**
```typescript
export function createMyStrategy(...deps): RoutingStrategy {
  const strategy: RoutingStrategy = (context) => {
    // Your logic here
    return sources;
  };

  Object.defineProperty(strategy, 'name', { value: 'myStrategy' });
  return strategy;
}
```

**Compose in `orchestrator.ts` `buildRouter()`:**
```typescript
const strategies = [
  createHubAPIFirstStrategy(...),
  createMyStrategy(...),  // <-- Add here
  createTIGERFallbackStrategy(...)
];
```

### Add New Classification

**Location:** `src/discovery/classifiers/*.ts`

**Add to classification logic:**
```typescript
if (isMyNewType(location)) {
  return {
    type: 'my_new_type',
    metadata: { /* ... */ },
    routingPreference: 'county'
  };
}
```

**Create classification-aware strategy:**
```typescript
export function createMyTypeStrategy(...): RoutingStrategy {
  return (context) => {
    if (context.classification.type === 'my_new_type') {
      return [mySpecialSource()];
    }
    return [];
  };
}
```

---

## Testing Patterns

### Test Individual Strategy

```typescript
import { createHubAPIFirstStrategy } from './routing-strategy';

test('Hub API first strategy always returns Hub source', () => {
  const hubFactory = () => new HubAPISource();
  const strategy = createHubAPIFirstStrategy(hubFactory);

  const context: RoutingContext = {
    boundaryType: 'STATE_HOUSE',
    state: 'MT',
    classification: { type: 'standard', routingPreference: 'standard' },
    requestedAt: new Date()
  };

  const sources = strategy(context);

  expect(sources).toHaveLength(1);
  expect(sources[0].name).toBe('ArcGIS Hub API');
});
```

### Test Composed Router

```typescript
import { composeRouting } from './routing-strategy';

test('Composed router tries strategies in order', () => {
  const strategy1 = () => [source1];
  const strategy2 = () => [source2];

  const router = composeRouting([strategy1, strategy2]);
  const { sources } = router(context);

  expect(sources).toEqual([source1, source2]);
});
```

### Test Orchestrator End-to-End

```typescript
import { discoverBoundary } from './orchestrator';

test('discoverBoundary returns result for valid location', async () => {
  const result = await discoverBoundary({
    location: { lat: 40.7128, lng: -74.0060, state: 'NY' },
    boundaryType: 'CONGRESSIONAL'
  });

  expect(result.success).toBe(true);
  expect(result.data).toBeDefined();
  expect(result.source).toBeDefined();
});
```

---

## Migration from Old System

### Before (Spaghetti)

```typescript
// Multiple parallel implementations
searchHubForMunicipalBoundaries()
searchHubForMunicipalBoundariesEnhanced()  // wtf is "enhanced"?
searchHubForMunicipalBoundariesV2()        // version numbers!

// Caller confusion: which one do I use?
```

### After (Clean)

```typescript
// Single entry point
discoverBoundary({
  location: { name: 'Denver', state: 'CO' },
  boundaryType: 'MUNICIPAL'
});

// All complexity hidden
// All routing logic data-driven
// All strategies composable
```

---

## Principles for Future Modifications

1. **One entry point:** All discovery goes through `discoverBoundary()`
2. **Pure functions:** Strategies have no side effects
3. **Data-driven:** State knowledge in registries, not code
4. **Composable:** Build complex from simple
5. **Type-safe:** Let TypeScript catch errors
6. **Testable:** Each piece isolated and mockable
7. **Clear names:** No "enhanced", no version numbers
8. **Single responsibility:** Each file does one thing

**If you find yourself creating a parallel implementation, STOP.**
**Add a strategy instead.**

---

## Summary

**To add functionality:**
1. New source → Implement `BoundaryDataSource`, add factory
2. New routing → Create strategy function, compose in `buildRouter()`
3. New state → Add to `STATE_PORTAL_REGISTRY`
4. New classification → Add to classifier, create classification-aware strategy

**All modifications follow these patterns.**
**No exceptions.**
**No cruft.**

**This is how civic infrastructure should be built.**

---

*Last Updated: 2025-11-09*
*Status: Architecture documented, ready for implementation*
*Next: Implement TIGER/Line source, test end-to-end*
