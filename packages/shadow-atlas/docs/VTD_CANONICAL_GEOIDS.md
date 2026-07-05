# VTD Canonical GEOID Infrastructure

Implementation documentation for Voting Tabulation District (VTD) GEOID extraction and storage.

## Overview

VTDs (Voting Tabulation Districts) are the finest-grained electoral boundaries used for Census enumeration and redistricting. Unlike other boundary types, VTDs are:

1. **Absent from the annual TIGER/Line release** - but present in the separate TIGER 2020 PL 94-171 redistricting data product, which carries them nationally (MT/OR partial coverage)
2. **124,179 entries nationwide** (50/50 states) - Production-ready canonical dataset
3. **Sourced from TIGER 2020 PL VTD** (US Census Bureau) - 2020-vintage, frozen until the 2030 redistricting cycle

## Historical note

Earlier revisions of this infrastructure sourced VTD GEOIDs via a third-party
aggregator (Redistricting Data Hub, re-hosting VEST 2020/2022 precinct
shapefiles). That path was removed: its license was verified as
noncommercial/no-resale with a viral no-redistribution clause, incompatible
with a signed, commercially-metered atlas, and its precinct inputs stall at
the 2020-2022 era regardless of license. VTD sourcing is re-pointed to TIGER
2020 PL VTD direct - CC0/public domain, live, and the canonical GEOID20
identifier scheme is unchanged.

## Architecture

### Storage Strategy

**Canonical JSON file** instead of in-memory constants:
- **Why**: 124K+ VTD GEOIDs would bloat source files and memory
- **Where**: `src/data/canonical/vtd-geoids.json`
- **When**: Loaded via `src/data/loaders/vtd-geoids-loader.ts`, re-exported through `src/validators/utils/vtd-loader.ts` for validator call sites

### Components

#### 1. VTD Extraction (TIGER 2020 PL direct)

VTD GEOIDs are extracted from the TIGER 2020 PL 94-171 redistricting product,
served from the Census Bureau's public FTP tree
(`https://www2.census.gov/geo/tiger/TIGER2020PL/`). No manual download or
account signup is required - the product is a direct, CC0-licensed download.

**Process**:
- Fetch state-level TIGER 2020 PL VTD shapefiles from the FTP path above
- Convert shapefiles to GeoJSON via ogr2ogr
- Validate GEOID format (11 digits: SSCCCVVVVVV)
- Generate the canonical JSON dataset consumed by the loader

#### 2. VTD Loader (`src/data/loaders/vtd-geoids-loader.ts`, `src/validators/utils/vtd-loader.ts`)

Runtime loader for VTD GEOID data.

**Exports** (via `src/validators/utils/vtd-loader.ts`, consumed by validators):

```typescript
// Load VTD GEOIDs for a state (cached after first load)
function loadVTDGEOIDs(stateFips: string): readonly string[] | null

// Check if VTD data available
function hasVTDData(stateFips: string): boolean

// Get VTD count without loading full list
function getVTDCount(stateFips: string): number

// Get metadata (source, vintage, timestamp)
function getVTDMetadata(stateFips: string): VTDMetadata | null

// Preload multiple states
function preloadVTDData(stateFips: readonly string[]): number

// Get all states with data
function getStatesWithVTDData(): readonly string[]

// Get national VTD total
function getNationalVTDTotal(): number
```

**Example Usage**:
```typescript
import { loadVTDGEOIDs, hasVTDData } from '../validators/utils/vtd-loader.js';

// Check if California has VTD data
if (hasVTDData('06')) {
  const geoids = loadVTDGEOIDs('06');
  console.log(`California: ${geoids.length} VTDs`);
}
```

#### 3. GEOID Reference Integration (`src/validators/geoid-reference.ts`)

`getCanonicalGEOIDs()` handles the VTD layer:

```typescript
case 'vtd':
  // VTD GEOIDs loaded dynamically from the canonical JSON file
  // Use loadVTDGEOIDs() from validators/utils/vtd-loader.ts instead
  return null;
```

**Design Decision**: Return `null` for VTD layer to force callers to use `loadVTDGEOIDs()` explicitly, avoiding accidental memory bloat.

#### 4. Expected Counts (`src/validators/tiger-expected-counts.ts`)

VTD expected counts live in `EXPECTED_VTD_BY_STATE`. These counts were
originally derived from VEST 2020/2022 precinct shapefiles (via the
now-removed aggregator path) and have not yet been re-verified against the
TIGER 2020 PL 94-171 product directly. Within `vtd-geoids.json` itself the
counts are internally consistent - `meta.expectedByState`, `meta.actualByState`,
and each state's `geoids[state].length` agree exactly for every state present
(e.g. California: 20,419 in all three); re-derivation from TIGER 2020 PL is
still pending to confirm these VEST-derived counts against the source product
directly, not to resolve any internal mismatch (there is none).

The one real gap: `EXPECTED_VTD_BY_STATE` and `meta.expectedByState` both
exclude Utah (FIPS 49) - documented in `tiger-expected-counts.ts` as "Uses
non-standard field names (vistapre)" - even though Utah's 2,424 GEOIDs are
present in `meta.actualByState` and the `geoids` data itself. This is a
49-vs-50-state discrepancy in the *expected*-count table, not a data gap.

**Data Vintage**: 2020 Redistricting cycle (frozen until the 2030 cycle).

**Current Coverage**: 50/50 states, 124,179 VTDs (`meta.actualByState`
covers all 50; `meta.expectedByState` covers 49, excluding Utah).

## Data Format

### JSON Structure

`src/data/canonical/vtd-geoids.json` contains:

```json
{
  "meta": {
    "source": "TIGER 2020 PL VTD (Census Bureau 94-171 redistricting product); ...",
    "generated": "2026-01-10",
    "totalCount": 124179,
    "stateCount": 50,
    "expectedByState": { "06": 20419, "...": "..." },
    "actualByState": { "06": 20419, "...": "..." }
  },
  "geoids": {
    "06": ["06001000001", "06001000002", "..."]
  }
}
```

(`expectedByState` and `actualByState` agree for every state that has an
`expectedByState` entry; `actualByState` additionally carries Utah, "49",
which `expectedByState` omits - see the Expected Counts section above.)

### GEOID Format

**11 digits**: `SSCCCVVVVVV`
- **SS**: State FIPS (2 digits)
- **CCC**: County FIPS (3 digits)
- **VVVVVV**: VTD Code (6 digits)

**Examples**:
- `06037000001` - Los Angeles County VTD 000001, California
- `36061000001` - New York County (Manhattan) VTD 000001, New York
- `48201000001` - Harris County (Houston) VTD 000001, Texas

## Authority Registry Integration

VTD authority configuration in `src/provenance/authority-registry.ts`:

```typescript
voting_precinct: {
  boundaryType: 'voting_precinct',
  displayName: 'Voting Precincts (VTDs)',
  authorityEntity: 'County Elections Office',
  legalBasis: 'State Election Code',
  primarySources: [
    {
      name: 'TIGER 2020 PL VTD',
      entity: 'US Census Bureau',
      jurisdiction: '*', // All states (MT/OR partial)
      url: 'https://www2.census.gov/geo/tiger/TIGER2020PL/',
      format: 'shapefile',
      machineReadable: true,
    },
    // State-specific sources...
  ],
  aggregatorSources: [], // TIGER 2020 PL VTD is a primary source, not an aggregator
  updateTriggers: [
    { type: 'redistricting', years: [2021, 2022, 2031, 2032] },
    { type: 'event', description: 'Post-election precinct consolidation' },
    { type: 'annual', month: 3 }, // Q1 updates after November elections
  ],
  expectedLag: {
    normal: '1-3 months post-election',
    redistricting: '6-12 months during redistricting cycles',
  },
}
```

**Key Points**:
- **Primary Source**: TIGER 2020 PL VTD (national, MT/OR partial), plus state-specific portals
- **Vintage**: 2020-vintage, frozen until the 2030 redistricting cycle - never presented as "current precincts"
- **Update frequency**: Redistricting cycles + post-election consolidations (state-specific sources only; the national TIGER 2020 PL layer itself does not update until 2030)
- **Expected lag**: 6-12 months during redistricting (state-specific sources)

## File Locations

```
shadow-atlas/
├── src/
│   ├── data/
│   │   ├── canonical/
│   │   │   └── vtd-geoids.json            # Canonical VTD GEOID dataset
│   │   └── loaders/
│   │       └── vtd-geoids-loader.ts       # JSON-backed loader
│   ├── validators/
│   │   ├── utils/
│   │   │   └── vtd-loader.ts              # Validator-facing loader (delegates to data/loaders)
│   │   └── tiger-expected-counts.ts       # VTD counts (EXPECTED_VTD_BY_STATE)
│   └── provenance/
│       └── authority-registry.ts          # VTD authority
```

## Data Freshness

### Redistricting Cycles

VTD boundaries change significantly during redistricting:

| Period | Status | Lag |
|--------|--------|-----|
| 2020 Redistricting | Current data vintage | N/A |
| 2021-2030 | Stable (minor updates via state sources) | 1-3 months |
| 2031-2032 | Next redistricting | 6-12 months |
| 2041-2042 | Future redistricting | 6-12 months |

### Update Triggers

1. **Redistricting** (every 10 years): Major boundary changes; TIGER 2020 PL VTD itself is frozen until the 2030 release
2. **Post-election** (November): Precinct consolidations (state-specific sources)
3. **Manual adjustments**: Local election office changes (state-specific sources)

## Validation

VTD GEOIDs can be validated against expected counts:

```typescript
import { loadVTDGEOIDs } from '../validators/utils/vtd-loader.js';
import { EXPECTED_VTD_BY_STATE } from '../validators/tiger-expected-counts.js';

const stateFips = '06';
const geoids = loadVTDGEOIDs(stateFips);
const expected = EXPECTED_VTD_BY_STATE[stateFips];

if (geoids && geoids.length !== expected) {
  console.warn(
    `VTD count mismatch for state ${stateFips}: ` +
    `found ${geoids.length}, expected ${expected}`
  );
}
```

## Acceptance Criteria

- [x] **VTD GEOID storage** implemented (canonical JSON + loader)
- [x] **EXPECTED_VTD_BY_STATE** exists in tiger-expected-counts.ts (VEST-derived counts, internally consistent with `vtd-geoids.json`; pending re-derivation directly from the TIGER 2020 PL product, and pending a Utah entry - see above)
- [x] **getCanonicalGEOIDs** handles VTD layer (returns null, use loader)
- [x] **Authority registry** wired to TIGER 2020 PL VTD as the national primary source
- [ ] **Re-derive EXPECTED_VTD_BY_STATE** directly from the TIGER 2020 PL 94-171 product (currently VEST-derived) and add a Utah entry so it covers all 50 states

## Future Enhancements

### P1 (Production-Critical)
- [ ] Re-derive `EXPECTED_VTD_BY_STATE` directly from TIGER 2020 PL VTD shapefiles (replace the VEST-derived source) and add the missing Utah entry
- [ ] Integration tests for VTD validation logic
- [ ] Error handling for malformed JSON files

### P2 (Nice-to-Have)
- [ ] Differential updates (track changes between redistricting cycles, via state-specific sources)
- [ ] Compression for JSON files (gzip reduces size ~70%)

### P3 (Future)
- [ ] VTD-to-CD mapping (which VTDs are in each congressional district)
- [ ] Historical VTD data (2010, 2000 redistricting cycles)
- [ ] Web service for VTD lookups (avoid shipping data with frontend)

## Conclusion

The VTD canonical GEOID infrastructure is production-ready, sourced from TIGER
2020 PL VTD (CC0/public domain, national, MT/OR partial). The vintage is
honestly labeled as 2020-frozen until the 2030 cycle - it is never presented
as "current precincts."
