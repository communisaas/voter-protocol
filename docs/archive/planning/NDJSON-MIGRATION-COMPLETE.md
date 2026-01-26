# NDJSON Registry Migration - Complete

**Date**: 2026-01-19
**Status**: ✅ COMPLETE (Full cleanup applied)

## Summary

Successfully migrated shadow-atlas registries from manual TypeScript files to a data/code separation architecture where NDJSON files are the source of truth and TypeScript is generated.

**All legacy/deprecated code has been removed.** Zero dead code remains.

## Architecture

```
data/registries/*.ndjson     →  npm run registry:generate  →  src/core/registry/*.generated.ts
     (source of truth)                                            (generated artifacts)
           ↑                                                              ↓
     Edit here                                                    Import from here
                                                                         ↓
                                                         src/core/registry/registry-utils.ts
                                                              (helper functions)
```

## Migration Metrics

| Metric | Count |
|--------|-------|
| Files migrated to .generated.ts imports | 30+ |
| Original files **DELETED** | 3 |
| NDJSON source files created | 3 |
| TypeScript compilation errors | 0 |
| Dead code remaining | 0 |

## Files Created

| File | Purpose |
|------|---------|
| `data/registries/known-portals.ndjson` | 493 portal entries (canonical) |
| `data/registries/quarantined-portals.ndjson` | 4 quarantine entries |
| `data/registries/at-large-cities.ndjson` | 21 at-large cities |
| `src/core/registry/registry-utils.ts` | Helper functions (isStale, isAtLargeCity, etc.) |
| `scripts/extract-registries-to-ndjson.ts` | One-time extraction |
| `scripts/generate-registries-from-ndjson.ts` | TypeScript generator |
| `scripts/verify-registry-roundtrip.ts` | Integrity verification |
| `scripts/ci-check-generated-files.ts` | CI gate |

## Files Deleted (No Longer Needed)

The following deprecated wrapper files have been **permanently deleted**:

- ~~`src/core/registry/known-portals.ts`~~ → DELETED
- ~~`src/core/registry/quarantined-portals.ts`~~ → DELETED
- ~~`src/core/registry/at-large-cities.ts`~~ → DELETED

Helper functions moved to `registry-utils.ts`.

## npm Scripts

```bash
npm run registry:extract     # Extract TypeScript → NDJSON (one-time)
npm run registry:generate    # Generate TypeScript from NDJSON
npm run registry:verify      # Verify round-trip integrity
npm run registry:ci-check    # CI gate for generated file sync
npm run registry:roundtrip   # Full extract + generate cycle
```

## Workflow for Data Changes

1. Edit the NDJSON source file: `data/registries/known-portals.ndjson`
2. Run generator: `npm run registry:generate`
3. Commit both NDJSON and generated files

## Package Exports

Consumers can now import from the package root:

```typescript
import {
  // Registry data
  KNOWN_PORTALS,
  PORTAL_COUNT,
  QUARANTINED_PORTALS,
  AT_LARGE_CITIES,
  // Types
  type KnownPortal,
  type PortalType,
  type AtLargeCity,
  type QuarantinedPortal,
  // Utility functions
  isStale,
  getPortal,
  hasPortal,
  isQuarantined,
  getQuarantinedPortal,
  getQuarantineSummary,
  isAtLargeCity,
  getAtLargeCityInfo,
  getAtLargeCitiesByState,
  getAtLargeCityStats,
} from '@voter-protocol/shadow-atlas';
```

## CI Integration

Add to CI pipeline:
```yaml
- name: Verify generated files
  run: npm run registry:ci-check
```

This ensures generated files stay in sync with NDJSON sources and prevents manual edits.

## Benefits Achieved

1. **Data/Code Separation** - NDJSON is machine-parseable, git-diffable
2. **Type Safety Preserved** - Generated TypeScript maintains full types
3. **Provenance Tracking** - Each entry has `_fips` key, all fields intact
4. **CI Enforcement** - Prevents manual edits to generated files
5. **Zero Infrastructure** - No database, no API servers needed
6. **Full Test Coverage** - 245 registry tests, including utility function tests

## Post-Migration Cleanup (2026-01-19)

Additional orphaned files discovered and deleted during audit:

- ~~`src/core/registry/single-feature-quarantine-data.ts`~~ → DELETED (orphaned)
- ~~`src/core/registry/county-portals.ts`~~ → DELETED (orphaned)

Scripts fixed to use new imports:
- `scripts/validate-registry-coverage.ts` - Now uses `isStale()` from registry-utils
- `scripts/bulk-ingest-council-districts.ts` - Now imports from `.generated.js`

## Known Data Issues

4 cities exist in both `known-portals.ndjson` and `quarantined-portals.ndjson`:
- `1235050`: Jacksonville Beach, FL
- `1861092`: South Bend, IN
- `2220575`: DeQuincy, LA
- `0614218`: Carson, CA

These should be deduplicated in a future data hygiene pass.

## Future Work

- Consider NDJSON validation schema (Zod)
- Explore cron-based staleness detection
- Integrate with Communique API when ready
- Clean up overlapping registry entries
