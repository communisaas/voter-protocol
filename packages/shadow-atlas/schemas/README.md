# Shadow Atlas Data Schema

## Directory Structure

```
shadow-atlas/
├── schemas/
│   ├── portal.schema.json              # Portal entry JSON Schema
│   ├── provenance-event.schema.json    # Provenance event JSON Schema
│   ├── examples/
│   │   ├── portal-records.ndjson       # Example portal entries
│   │   └── provenance-events.ndjson    # Example provenance events
│   └── README.md                       # This file
├── data/
│   ├── portals/
│   │   ├── current.ndjson              # Active portal registry (canonical)
│   │   └── snapshots/
│   │       ├── 2026-01-18.ndjson.gz    # Daily snapshots for rollback
│   │       └── 2026-01-15.ndjson.gz
│   └── provenance/
│       ├── 2026-01/
│       │   ├── events-00.ndjson        # Current month (active append)
│       │   ├── events-01.ndjson.gz     # Previous batches (compressed)
│       │   └── events-02.ndjson.gz
│       └── 2025-12/
│           ├── events-00.ndjson.gz
│           └── events-01.ndjson.gz
├── src/
│   └── core/
│       └── registry/
│           ├── known-portals.ts        # Generated from current.ndjson
│           └── quarantined-portals.ts  # Generated (status=quarantined filter)
└── scripts/
    ├── build/
    │   ├── generate-typescript.ts      # NDJSON → TypeScript
    │   ├── validate-schemas.ts         # JSON Schema validation
    │   └── diff-registry.ts            # CI/CD diff detection
    └── migration/
        ├── extract-provenance.ts       # Parse comments → events
        ├── migrate-to-ndjson.ts        # Full migration script
        └── verify-roundtrip.ts         # Fidelity check
```

## Naming Conventions

### Portal Data Files
- **Current registry**: `data/portals/current.ndjson` (canonical source)
- **Daily snapshots**: `data/portals/snapshots/YYYY-MM-DD.ndjson.gz`
- **Retention**: Keep 30 days of daily snapshots, monthly snapshots indefinitely

### Provenance Files
- **Active append**: `data/provenance/YYYY-MM/events-NN.ndjson` (uncompressed)
- **Archived batches**: `data/provenance/YYYY-MM/events-NN.ndjson.gz`
- **Batch size**: 10,000 events per file (rotate to new NN)
- **Compression**: Gzip level 9 for archived batches

### Generated TypeScript
- **Portal registry**: `src/core/registry/known-portals.ts`
- **Quarantined**: `src/core/registry/quarantined-portals.ts`
- **At-large cities**: `src/core/registry/at-large-cities.ts`
- **Header comment**: `// AUTO-GENERATED from data/portals/current.ndjson - DO NOT EDIT`

## Git-Friendly Format

### Why NDJSON?
1. **Line-oriented diffs**: Each record is one line → Git shows exactly which entries changed
2. **Append-friendly**: New events just add lines (no JSON array reformat)
3. **Stream processing**: No need to load entire file into memory
4. **Compression-efficient**: Gzip compression reduces size by ~80% for archives

### Example Git Diff
```diff
diff --git a/data/portals/current.ndjson b/data/portals/current.ndjson
index a1b2c3d..e5f6a7b 100644
--- a/data/portals/current.ndjson
+++ b/data/portals/current.ndjson
@@ -42,1 +42,1 @@
-{"cityFips":"1753559","status":"quarantined","featureCount":1,...}
+{"cityFips":"1753559","status":"active","featureCount":7,...}
```

Clear single-line change shows remediation (quarantined → active, 1 → 7 features).

## Validation Pipeline

### Pre-Commit Hook
```bash
#!/bin/bash
# .git/hooks/pre-commit

# Validate all modified NDJSON files against schemas
npm run validate:schemas || exit 1

# Generate TypeScript from NDJSON
npm run build:registry || exit 1

# Verify TypeScript compiles
npm run typecheck || exit 1

# Stage generated files
git add src/core/registry/*.ts
```

### CI/CD Checks
```yaml
# .github/workflows/validate-data.yml
- name: Validate Schemas
  run: npm run validate:schemas

- name: Check Registry Diff
  run: |
    npm run build:registry
    git diff --exit-code src/core/registry/
    # Fails if generated code doesn't match NDJSON source
```

## Schema Versioning

### Breaking Changes
- Increment schema version in `$id` field: `v1.json` → `v2.json`
- Create migration script: `scripts/migration/v1-to-v2.ts`
- Maintain backward compatibility for 1 major version

### Non-Breaking Changes
- Add optional fields (no version bump required)
- Expand enums (add new values, keep existing)
- Relax constraints (increase maxLength, remove minimum)

## Compression Strategy

### When to Compress
- **Never compress**: Current month's active append file
- **Always compress**: Previous months, daily snapshots older than 7 days
- **Tool**: `gzip -9` (maximum compression for archival)

### Decompression
```bash
# Read compressed provenance
zcat data/provenance/2025-12/events-00.ndjson.gz | jq -r '.eventType'

# Extract snapshot for rollback
gunzip -c data/portals/snapshots/2026-01-15.ndjson.gz > /tmp/rollback.ndjson
```

## Query Examples

### Count Active Portals by State
```bash
jq -r 'select(.status=="active") | .state' data/portals/current.ndjson | sort | uniq -c
```

### Find All Remediation Events in Wave L
```bash
zcat data/provenance/2026-01/*.ndjson.gz | \
  jq -r 'select(.remediationDetails.wave=="Wave L") | .entityId'
```

### Extract Quarantined Portals for Review
```bash
jq -r 'select(.status=="quarantined") | {cityFips, cityName, state, reason: .notes}' \
  data/portals/current.ndjson > quarantine-report.json
```

## Migration Checklist

- [ ] Run `npm run migrate:to-ndjson` to extract provenance from comments
- [ ] Verify schema validation passes: `npm run validate:schemas`
- [ ] Generate TypeScript: `npm run build:registry`
- [ ] Run round-trip verification: `npm run verify:roundtrip`
- [ ] Compare old vs new TypeScript: `diff src/core/registry/known-portals.{ts,ts.backup}`
- [ ] Commit NDJSON source + generated TypeScript together
- [ ] Archive old TypeScript files to `archive/pre-ndjson-migration/`

## Rollback Capability

### Restore Previous State
```bash
# 1. Find snapshot date
ls data/portals/snapshots/

# 2. Extract snapshot
gunzip -c data/portals/snapshots/2026-01-15.ndjson.gz > data/portals/current.ndjson

# 3. Regenerate TypeScript
npm run build:registry

# 4. Verify
npm run typecheck && npm test
```

### Provenance Rollback (Emergency)
```bash
# Provenance is append-only (never roll back)
# To "undo" an event, create compensating event:
{
  "eventType": "reactivated",
  "reason": "Reverting incorrect quarantine from event c3d4e5f6-...",
  "references": {
    "revertedEventId": "c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f"
  }
}
```

## Performance Characteristics

### File Sizes (Estimated)
- **Portal registry**: ~520 entries × 400 bytes = 208 KB uncompressed
- **Portal registry gzipped**: ~40 KB (80% compression)
- **Provenance events**: 10,000 events × 600 bytes = 6 MB per batch
- **Provenance gzipped**: ~1.2 MB per batch (80% compression)

### Read Performance
- **NDJSON streaming**: 100K records/sec (single-threaded Node.js)
- **Schema validation**: ~50K records/sec (ajv library)
- **TypeScript generation**: <1 second for 520 portals

### Git Performance
- **NDJSON diffs**: Fast (line-oriented, no array reformatting)
- **Compressed archives**: Slow (binary diffs useless, but archives rarely change)
- **Strategy**: Keep current.ndjson uncompressed for fast diffs, compress archives

## Future Database Migration

When migrating to PostgreSQL/Supabase:

```sql
-- Portal table matches portal.schema.json
CREATE TABLE portals (
  city_fips CHAR(7) PRIMARY KEY,
  city_name TEXT NOT NULL,
  state CHAR(2) NOT NULL,
  portal_type TEXT NOT NULL,
  download_url TEXT NOT NULL,
  feature_count INTEGER NOT NULL,
  last_verified TIMESTAMPTZ NOT NULL,
  confidence INTEGER CHECK (confidence BETWEEN 0 AND 100),
  discovered_by TEXT NOT NULL,
  status TEXT NOT NULL,
  notes TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Provenance events table
CREATE TABLE provenance_events (
  event_id UUID PRIMARY KEY,
  event_type TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  actor JSONB NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  previous_state JSONB,
  new_state JSONB,
  reason TEXT,
  validation_results JSONB,
  remediation_details JSONB,
  references JSONB
);

-- Import from NDJSON
\COPY portals FROM 'data/portals/current.ndjson' WITH (FORMAT text);
```

NDJSON structure maps 1:1 to database schema → zero transformation required.
