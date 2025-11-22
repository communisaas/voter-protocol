# Shadow Atlas Scripts

CLI utilities for working with Shadow Atlas provenance logs, validation, and GIS data.

## Validation Testing

### Run Validation Tests

```bash
# Complete validation test suite (37 tests)
cd /Users/noot/Documents/voter-protocol/packages/crypto
npm test -- validation/deterministic-validators.test.ts
```

**Test Coverage**:
- Name pattern validation (district/ward/council keywords)
- District count validation (53 known cities)
- Geographic bounds validation (state coordinate checks)

### Review Flagged Datasets

Datasets with 60-84% confidence require manual review:

```bash
# Check review queue
ls packages/crypto/services/shadow-atlas/data/staging/review/

# Inspect flagged dataset
cat packages/crypto/services/shadow-atlas/data/staging/review/city-name.geojson

# Move to validated if acceptable
mv packages/crypto/services/shadow-atlas/data/staging/review/city-name.geojson \
   packages/crypto/services/shadow-atlas/data/staging/validated/
```

### Update Validation Rules

**Known District Counts** (`validation/deterministic-validators.test.ts`):
```typescript
const KNOWN_DISTRICT_COUNTS: Record<string, number> = {
  '5363000': 9,   // Seattle, WA
  '3651000': 51,  // New York, NY
  // Add new cities here
};
```

**State Bounding Boxes** (`validators/enhanced-geographic-validator.ts`):
```typescript
const STATE_BOUNDS: Record<string, readonly [number, number, number, number]> = {
  AL: [-88.5, 30.2, -84.9, 35.0],  // [minLon, minLat, maxLon, maxLat]
  // Add new states here
};
```

**Negative Keywords** (`validators/semantic-layer-validator.ts`):
```typescript
const NEGATIVE_KEYWORDS = [
  'precinct', 'voting', 'election', 'polling',
  'canopy', 'tree', 'forest', 'vegetation',
  'zoning', 'parcel', 'lot', 'property',
  // Add new keywords here
];
```

## Query Provenance (`query-provenance.sh`)

Comprehensive jq-based query tool for analyzing discovery logs in compact NDJSON format.

### Usage

```bash
./scripts/query-provenance.sh [COMMAND] [OPTIONS]
```

### Commands

- `tiers` - Show distribution across granularity tiers (0-4)
- `blockers` - Analyze blocker codes preventing higher tiers
- `state <STATE>` - Show cities discovered for specific state
- `authority` - Breakdown by authority level (0-5)
- `confidence` - Histogram of confidence scores
- `failures` - Show last 20 blocked discovery attempts with reasoning
- `search <QUERY>` - Search by FIPS code or city name
- `quality` - Analyze quality metrics (topology, validation)
- `recent [N]` - Show N most recent discoveries
- `stats` - Overall statistics summary

### Options

- `--month YYYY-MM` - Query specific month (default: current month)
- `--all-months` - Query all available months
- `--no-color` - Disable colored output
- `--json` - Output raw JSON (no formatting)

### Examples

```bash
# Show tier distribution
./scripts/query-provenance.sh tiers

# Analyze blockers from specific month
./scripts/query-provenance.sh blockers --month 2025-10

# Find all California cities
./scripts/query-provenance.sh state CA

# Search for city
./scripts/query-provenance.sh search "Austin"

# Get JSON output for programmatic use
./scripts/query-provenance.sh stats --json
```

## Other Scripts

- `merge-urls.sh` - Merge validated URLs from multiple sources
- `merge-validated-urls.ts` - TypeScript implementation of URL merging logic

## Data Format

Provenance logs are stored as compressed NDJSON:
```
discovery-attempts/YYYY-MM/discovery-log.ndjson.gz
```

See `PROVENANCE-SPEC.md` for complete schema documentation.
