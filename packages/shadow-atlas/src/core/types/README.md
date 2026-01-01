# Shadow Atlas Core Types - Module Structure

This directory contains the modularized type definitions for Shadow Atlas, organized by domain for improved maintainability and clarity.

## Architecture

The monolithic `core/types.ts` (~1,900 lines) has been refactored into focused modules, each under 350 lines. The main `core/types.ts` file now serves as a thin re-export layer for backward compatibility.

## Module Organization

### `database.ts` (285 lines)
Database operations, storage adapters, and event-sourced municipal data.

**Key Types:**
- `Municipality`, `Source`, `Selection`, `Artifact`, `Head`, `Event`
- `DatabaseAdapter`, `StorageAdapter`
- LLM batch processing types
- Status and coverage views

### `discovery.ts` (279 lines)
Automated boundary discovery across administrative levels.

**Key Types:**
- `DiscoveryState`, `DiscoveryResult`, `DiscoveryBatchResult`
- `AdministrativeLevel`, `PortalType`, `AuthorityLevel`
- `DiscoveryStatus`, `DiscoveryQuery`

### `provider.ts` (334 lines)
Country-specific boundary data providers.

**Key Types:**
- `BoundaryProvider`, `NormalizedBoundary`
- `ProviderSourceMetadata`, `UpdateMetadata`
- Provider validation and transformation types

### `provenance.ts` (55 lines)
Data lineage, authority, and quality tracking.

**Key Types:**
- `BaseProvenanceMetadata`, `ProvenanceMetadata`
- `AcquisitionProvenanceMetadata`, `ServingProvenanceMetadata`

### `transformation.ts` (125 lines)
Multi-stage transformation pipeline types.

**Key Types:**
- `RawDataset`, `NormalizedDistrict`
- `TransformationValidationResult`, `TransformationResult`
- Pipeline stage and statistics types

### `merkle.ts` (20 lines)
Cryptographic Merkle tree structures.

**Key Types:**
- `MerkleProof`, `MerkleTree`

### `atlas.ts` (238 lines)
Atlas build configuration and TIGER validation.

**Key Types:**
- `TIGERLayerType`, `LegislativeLayerType`
- `TIGERValidationResult`, `AtlasBuildResult`
- Completeness, topology, and coordinate validation results

### `service.ts` (148 lines)
ShadowAtlasService facade orchestration types.

**Key Types:**
- `ExtractionScope`, `PipelineResult`
- `IncrementalResult`, `ChangeDetectionResult`
- Job state and snapshot metadata

### `rate-limiter.ts` (62 lines)
Unified rate limiter interface.

**Key Types:**
- `UnifiedRateLimiter`, `UnifiedRateLimiterConfig`
- `UnifiedRateLimitResult`

### `fips.ts` (138 lines)
US state FIPS code mappings and utilities.

**Exports:**
- `STATE_FIPS_TO_NAME`, `STATE_ABBR_TO_FIPS`
- `getStateNameFromFips()`, `getFipsFromStateAbbr()`

### `index.ts` (180 lines)
Barrel export for all core types.

## Import Patterns

### Backward Compatible (Existing Code)
```typescript
import type { Municipality, Source } from '../core/types.js';
```

### Direct Module Import (Recommended for New Code)
```typescript
import type { Municipality, Source } from '../core/types/database.js';
import type { DiscoveryState } from '../core/types/discovery.js';
```

### Barrel Import (Convenience)
```typescript
import type { Municipality, DiscoveryState } from '../core/types/index.js';
```

## Design Principles

1. **Single Responsibility**: Each module covers one domain area
2. **Zero Breaking Changes**: All existing imports continue to work
3. **Type Safety**: Strict TypeScript with no `any` types
4. **Cross-Module Dependencies**: Minimal, explicit imports between modules
5. **Module Size**: Target ~200 lines, max ~350 lines per module

## Benefits

- **Improved Navigation**: Find types by domain instead of scrolling through 1,900 lines
- **Easier Maintenance**: Changes isolated to specific domains
- **Better Code Review**: Module-level diffs easier to understand
- **Reduced Merge Conflicts**: Smaller files mean fewer concurrent edits
- **Clear Boundaries**: Explicit module dependencies make architecture visible

## File Size Comparison

| File | Lines | Description |
|------|-------|-------------|
| **Before** | | |
| `core/types.ts` | 1,881 | Monolithic type file |
| **After** | | |
| `core/types.ts` | 19 | Thin re-export layer |
| `types/database.ts` | 285 | Database types |
| `types/discovery.ts` | 279 | Discovery types |
| `types/provider.ts` | 334 | Provider types |
| `types/provenance.ts` | 55 | Provenance types |
| `types/transformation.ts` | 125 | Transformation types |
| `types/merkle.ts` | 20 | Merkle tree types |
| `types/atlas.ts` | 238 | Atlas build types |
| `types/service.ts` | 148 | Service facade types |
| `types/rate-limiter.ts` | 62 | Rate limiter types |
| `types/fips.ts` | 138 | FIPS mappings |
| `types/index.ts` | 180 | Barrel export |
| **Total** | 1,883 | ~Same total, better organized |

## Migration Guide

No migration required! All existing imports continue to work. However, for new code, prefer direct module imports for better IDE navigation and clearer dependencies.
