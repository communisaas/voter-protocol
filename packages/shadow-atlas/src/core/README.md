# ShadowAtlasService - Unified Facade

The `ShadowAtlasService` is the single public API for all Shadow Atlas operations. It orchestrates extraction, validation, and commitment into a coherent, strongly-typed interface.

## Architecture

**Design Principle: Composition over Reimplementation**

The facade delegates to existing services:
- **StateBatchExtractor** - Extraction from state GIS portals
- **DeterministicValidationPipeline** - Multi-stage validation
- **MerkleTreeBuilder** - Cryptographic commitment
- **State batch integration** - Authority resolution and deduplication

```
┌─────────────────────────────────────────────┐
│         ShadowAtlasService (Facade)         │
│                                             │
│  extract()                                  │
│  incrementalUpdate()                        │
│  detectChanges()                            │
│  resumeExtraction()                         │
│  healthCheck()                              │
└─────────────────────────────────────────────┘
             │         │         │
             ▼         ▼         ▼
    ┌────────────┐ ┌──────────┐ ┌────────────┐
    │ Extraction │ │Validation│ │ Commitment │
    │   Engine   │ │  Engine  │ │   Engine   │
    └────────────┘ └──────────┘ └────────────┘
         │              │              │
         ▼              ▼              ▼
    StateBatch    Deterministic   MerkleTree
    Extractor     Validators      Builder
```

## Usage

### Basic Extraction

```typescript
import { createShadowAtlasService } from './core';

const atlas = createShadowAtlasService();

// Extract all legislative boundaries for Wisconsin
const result = await atlas.extract({
  type: 'state',
  states: ['WI'],
});

console.log(`Status: ${result.status}`);
console.log(`Merkle root: ${result.commitment?.merkleRoot}`);
```

### Incremental Update

```typescript
// Full extraction
const initial = await atlas.extract({
  type: 'country',
  country: 'US',
});

// Later: incremental update for specific states
const update = await atlas.incrementalUpdate(
  initial.commitment.snapshotId,
  { states: ['WI', 'MI'] }
);

if (update.status === 'updated') {
  console.log(`Root changed: ${update.previousRoot} → ${update.newRoot}`);
}
```

### Resume Failed Extraction

```typescript
try {
  const result = await atlas.extract({ type: 'country', country: 'US' });
} catch (error) {
  // Network error during extraction
  console.error('Extraction failed:', error);
}

// Later: resume from where it left off
const resumed = await atlas.resumeExtraction(result.jobId);
```

### Change Detection

```typescript
// Check for upstream changes without extracting
const changes = await atlas.detectChanges({
  type: 'state',
  states: ['WI'],
});

if (changes.hasChanges) {
  console.log('Upstream data changed, re-extraction recommended');
}
```

### Health Check

```typescript
const health = await atlas.healthCheck();

for (const provider of health.providers) {
  console.log(`${provider.name}: ${provider.available ? '✓' : '✗'}`);
  console.log(`  Latency: ${provider.latencyMs}ms`);
}
```

## Configuration

### Default Configuration

```typescript
const atlas = createShadowAtlasService({
  extraction: {
    concurrency: 5,           // 5 concurrent extractions
    retryAttempts: 3,         // 3 retry attempts
    retryDelayMs: 2000,       // 2 second retry delay
    timeoutMs: 30_000,        // 30 second timeout
  },
  validation: {
    minPassRate: 0.9,         // 90% validation pass rate
    crossValidate: true,      // Enable cross-validation
    storeResults: true,       // Persist validation results
  },
  ipfs: {
    gateway: 'https://ipfs.io/ipfs/',
  },
});
```

### Production Configuration

```typescript
import { createProductionService } from './core';

const atlas = await createProductionService();
// Higher concurrency, stricter validation, IPFS pinning
```

### Development Configuration

```typescript
import { createDevelopmentService } from './core';

const atlas = await createDevelopmentService();
// Lower concurrency, relaxed validation, local IPFS
```

> **Note:** Factory functions `createProductionService()` and `createDevelopmentService()` are **async** and must be awaited. They initialize the service including database connections and cache warming. The exception is `createTestService()`, which is synchronous for test setup convenience.

## API Reference

### `extract(scope, options?)`

Execute full extraction pipeline: extract → validate → commit.

**Parameters:**
- `scope: ExtractionScope` - What to extract
  - `{ type: 'state', states: ['WI', 'MI'] }` - Specific states
  - `{ type: 'country', country: 'US' }` - All configured states
  - `{ type: 'region', regions: [...] }` - Custom regions
  - `{ type: 'global' }` - All available data
- `options?: ExtractionOptions`
  - `concurrency?: number` - Concurrent extractions
  - `continueOnError?: boolean` - Continue on extraction errors
  - `minPassRate?: number` - Minimum validation pass rate
  - `onProgress?: (event) => void` - Progress callback

**Returns:** `Promise<PipelineResult>`

### `incrementalUpdate(snapshotId, scope, options?)`

Update existing snapshot with new/changed boundaries.

**Parameters:**
- `snapshotId: string` - Existing snapshot ID
- `scope: IncrementalScope` - What to update
- `options?: IncrementalOptions` - Update options

**Returns:** `Promise<IncrementalResult>`

### `detectChanges(scope)`

Check for upstream changes without extracting.

**Returns:** `Promise<ChangeDetectionResult>`

### `resumeExtraction(jobId)`

Resume a partial/failed extraction.

**Returns:** `Promise<PipelineResult>`

### `healthCheck()`

Health check for all data providers.

**Returns:** `Promise<HealthCheckResult>`

## Type Safety

All operations are strongly typed end-to-end:

```typescript
// ✅ CORRECT - Type-safe extraction
const result: PipelineResult = await atlas.extract({
  type: 'state',
  states: ['WI'],
});

// TypeScript knows result.commitment is optional
if (result.commitment) {
  console.log(result.commitment.merkleRoot);
}

// ❌ WRONG - TypeScript error
const bad = await atlas.extract({
  type: 'invalid',  // Type error
});
```

## Error Handling

```typescript
try {
  const result = await atlas.extract({ type: 'country', country: 'US' });

  switch (result.status) {
    case 'committed':
      console.log('Success:', result.commitment);
      break;

    case 'validation_failed':
      console.error('Validation failed:', result.validation);
      break;

    case 'extraction_failed':
      console.error('Extraction failed:', result.extraction.failedExtractions);
      break;
  }
} catch (error) {
  console.error('Unexpected error:', error);
}
```

## Testing

```typescript
import { createTestService } from './core';

// createTestService() is synchronous (no await needed)
const atlas = createTestService();
// Sequential extractions, no retries, minimal validation
```

## Files

- **`shadow-atlas-service.ts`** - Main service implementation
- **`factory.ts`** - Dependency injection factory
- **`config.ts`** - Configuration types and defaults
- **`types.ts`** - Type definitions (extended from core/types.ts)
- **`index.ts`** - Public API exports

## Examples

See `examples/full-extraction.ts` for a complete CLI example.

## Design Decisions

### Why a Facade?

The Shadow Atlas codebase has multiple extraction, validation, and commitment implementations. The facade:
- Provides a single, consistent API
- Delegates to existing implementations (composition)
- Enables incremental updates without full rebuild
- Supports resume-from-failure for long-running extractions

### Why Strong Typing?

Type errors in boundary data can brick the entire verification pipeline. Nuclear-level type safety ensures:
- No `any` types (explicit interfaces everywhere)
- Discriminated unions for scope types
- Readonly types prevent accidental mutation
- Type guards for runtime validation

### Why In-Memory State?

Job state and snapshots are currently in-memory for simplicity. Production would persist to:
- SQLite for job state (resume capability)
- IPFS for snapshots (content-addressed)
- PostgreSQL for validation results (audit trail)

## Future Enhancements

- [ ] Persistent job state (SQLite)
- [ ] IPFS publishing for snapshots
- [ ] Multi-provider support (international)
- [ ] Batch operations API
- [ ] Streaming extraction (for large datasets)
- [ ] WebSocket progress updates
