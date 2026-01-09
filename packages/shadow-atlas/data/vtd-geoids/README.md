# VTD (Voting Tabulation District) GEOID Data

This directory contains per-state VTD GEOID JSON files extracted from Redistricting Data Hub shapefiles.

## Data Format

Each state file (`{SS}.json`) contains:

```json
{
  "stateFips": "06",
  "count": 25594,
  "geoids": [
    "06001000001",
    "06001000002",
    ...
  ],
  "timestamp": "2026-01-02T...",
  "source": "Redistricting Data Hub (Princeton Gerrymandering Project)",
  "vintage": "2020 Redistricting"
}
```

## GEOID Format

VTD GEOIDs are 11 digits: `SSCCCVVVVVV`
- State FIPS (2 digits)
- County FIPS (3 digits)
- VTD Code (6 digits)

Example: `06037000001` = Los Angeles County VTD 000001, California

## Data Source

**Redistricting Data Hub** (Princeton Gerrymandering Project)
- URL: https://redistrictingdatahub.org/data/download-data/
- Authority: Primary source for VTD boundaries
- Vintage: 2020 Redistricting cycle

**Why RDH instead of Census TIGER?**
- VTD boundaries are NOT in Census TIGER/Line data
- Census provides VTD data only in PL 94-171 redistricting files
- RDH consolidates state-reported VTDs into standardized shapefiles
- RDH is the authoritative source used by redistricting professionals

## Manual Download Required

RDH requires email signup for downloads. To populate this directory:

1. Visit https://redistrictingdatahub.org/data/download-data/
2. Select state, year (2020), and "Voting Tabulation Districts" layer
3. Download shapefile
4. Place in: `packages/crypto/data/tiger-cache/2024/VTD/tl_2024_{SS}_vtd.zip`
5. Run extraction script: `npx tsx scripts/extract-vtd-geoids.ts`

## Extraction Script

```bash
# Extract all states (processes only cached files)
npx tsx scripts/extract-vtd-geoids.ts

# Extract single state
npx tsx scripts/extract-vtd-geoids.ts --state=06

# Force reprocess cached files
npx tsx scripts/extract-vtd-geoids.ts --force
```

## Data Freshness

VTD boundaries change during redistricting cycles (2021-2022, 2031-2032):
- **Normal years**: VTDs relatively stable (minor precinct consolidations)
- **Redistricting years**: Major changes post-census
- **Expected lag**: 6-12 months during redistricting, 1-3 months post-election

## States with Data

Check this directory for `{SS}.json` files. Missing states require manual download.

## Total VTDs

Approximately **178,000 VTDs nationwide** (varies by redistricting cycle).

Largest states by VTD count:
- California: ~25,000 VTDs
- New York: ~15,000 VTDs
- Illinois: ~10,000 VTDs
- Pennsylvania: ~9,000 VTDs

## Usage in Code

```typescript
import { loadVTDGEOIDs, hasVTDData, getVTDCount } from '../validators/vtd-loader.js';

// Check if state has VTD data
if (hasVTDData('06')) {
  const geoids = loadVTDGEOIDs('06');
  console.log(`California has ${geoids.length} VTDs`);
}

// Get count without loading full list
const count = getVTDCount('48');
console.log(`Texas has ${count} VTDs`);
```

## Integration with Authority Registry

VTD authority information is tracked in `src/provenance/authority-registry.ts`:

```typescript
const authority = authorityRegistry.getAuthority('voting_precinct');
// Returns:
// - Primary sources: Redistricting Data Hub, state election offices
// - Update triggers: Redistricting cycles, post-election consolidations
// - Expected lag: 6-12 months during redistricting
```

## Notes

- VTD data is LARGE (~178K entries total) - stored per-state to avoid bloating main source files
- Loader functions provide lazy loading pattern
- VTD boundaries are the finest-grained electoral geography for privacy-preserving district verification
