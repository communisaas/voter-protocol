# VTD (Voting Tabulation District) GEOID Data

**This directory is unused.** The per-state JSON layout described below was
never populated (only `.gitkeep` was ever committed here). The live,
production canonical VTD GEOID dataset lives at
`src/data/canonical/vtd-geoids.json`, loaded via
`src/data/loaders/vtd-geoids-loader.ts` and
`src/validators/utils/vtd-loader.ts`. See `docs/VTD_CANONICAL_GEOIDS.md` for
the current architecture.

## Historical note

This directory previously documented a manual-download workflow against a
third-party aggregator (Redistricting Data Hub, re-hosting VEST precinct
shapefiles). That path was removed: its license was verified as
noncommercial/no-resale with a viral no-redistribution clause, incompatible
with a signed, commercially-metered atlas, and its precinct inputs stall at
the 2020-2022 era regardless of license. VTD sourcing is now TIGER 2020 PL
VTD direct (US Census Bureau, CC0/public domain,
`https://www2.census.gov/geo/tiger/TIGER2020PL/`) - no manual download or
account signup required.

## GEOID Format

VTD GEOIDs are 11 digits: `SSCCCVVVVVV`
- State FIPS (2 digits)
- County FIPS (3 digits)
- VTD Code (6 digits)

Example: `06037000001` = Los Angeles County VTD 000001, California

## Usage in Code

```typescript
import { loadVTDGEOIDs, hasVTDData, getVTDCount } from '../validators/utils/vtd-loader.js';

// Check if state has VTD data
if (hasVTDData('06')) {
  const geoids = loadVTDGEOIDs('06');
  console.log(`California has ${geoids.length} VTDs`);
}

// Get count without loading full list
const count = getVTDCount('48');
console.log(`Texas has ${count} VTDs`);
```
