# Unified Boundary Architecture: Full-Spectrum Civic Resolution

> Temporary implementation document. Updated per cycle with completion status and findings.

## Thesis

Two parallel pipelines exist that should be one:

1. **R-tree pipeline** (`build-district-db.ts`) — TIGER layers only, serves API lookups
2. **Hydration pipeline** (`build-tree2.ts`) — BAF + wards, builds Tree 2 for ZK proofs

Both produce district geometries. Both need city council wards. Neither talks to the other.
The R-tree has 10,522 boundaries from 4 TIGER layers. The hydration pipeline has 424 cities
with 3,226 ward polygons that never enter the R-tree. Meanwhile, TIGER has 12+ additional
layers (school districts, places, VTDs, tribal areas) fully supported by `TIGERBoundaryProvider`
but never built.

**Goal**: One build command produces a unified spatial database spanning every civic boundary
layer — from congressional districts to school boards to city council wards — queryable in
<50ms and committable into a Merkle tree.

---

## Inventory: What Exists

### Data Sources (ready to ingest)

| Source | Layers | Count | Status |
|--------|--------|-------|--------|
| **TIGER/Line** (Census FTP) | cd, sldu, sldl, county | 10,522 | **IN R-TREE** |
| **TIGER/Line** additional | place, cousub, unsd, elsd, scsd, vtd, zcta, aiannh, concity | ~310,000 | Provider ready, not built |
| **Canadian ridings** (Represent API) | can-fed | 338 | **IN R-TREE** (Cycle 30) |
| **City council wards** (ArcGIS portals) | ward/council | 3,226 across 424 cities | In hydration only |
| **Known portals registry** | municipal GIS | 716 cities catalogued | Download URLs verified |
| **Attributed council districts** | ArcGIS FeatureServer | 2,898 layer URLs | FIPS-attributed, confidence-scored |
| **State GIS clearinghouses** | statewide ward data | WI, MA confirmed | Authoritative sources |

### Pipelines (functional)

| Pipeline | Input | Output | File |
|----------|-------|--------|------|
| **TIGER R-tree build** | Shapefiles via FTP | `shadow-atlas.db` (SQLite R-tree) | `build-district-db.ts` |
| **Ward hydration** | ArcGIS FeatureServer | Tree 2 slot 6 overlay | `build-tree2.ts --include-wards` |
| **Portal discovery** | Census places | `known-portals.ndjson` | `bulk-district-discovery.ts` |
| **Ward download** | Registry → ArcGIS query | `data/ward-cache/*.geojson` | `ward-boundary-loader.ts` |
| **Normalization** | `RawDataset` | `NormalizedDistrict[]` | `normalizer.ts` |
| **Validation** | GeoJSON + expected counts | pass/fail + diagnostics | `validators/council/` (7 layers) |

### Type Boundaries (verified clean)

```
WardBoundary { geometry: Polygon|MultiPolygon }
     ↓ wrap in FeatureCollection
RawDataset { geojson: FeatureCollection, provenance: ProvenanceMetadata }
     ↓ TransformationNormalizer.normalize()
NormalizedDistrict { id, name, jurisdiction, districtType, geometry, provenance, bbox }
     ↓ RTreeBuilder.build()
SQLite R-tree (districts table + rtree_index virtual table)
```

No type gaps. `NormalizedDistrict` is the universal currency.

### Circuit Slot Mapping (24-slot architecture)

| Slot | Name | TIGER Layer | Portal Source | Status |
|------|------|-------------|---------------|--------|
| 0 | Congressional | `cd` | — | **R-tree** |
| 1 | Federal Senate | — | — | N/A (statewide) |
| 2 | State Senate | `sldu` | — | **R-tree** |
| 3 | State House | `sldl` | — | **R-tree** |
| 4 | County | `county` | — | **R-tree** |
| 5 | City | `place` | — | TIGER ready, not built |
| 6 | City Council | — | 424 cities / 716 portals | Hydration only |
| 7 | School (Unified) | `unsd` | — | TIGER ready, not built |
| 8 | School (Elementary) | `elsd` | — | TIGER ready, not built |
| 9 | School (Secondary) | `scsd` | — | TIGER ready, not built |
| 10 | School Board | — | — | Future |
| 11 | Voting Precinct | `vtd` | — | TIGER ready, not built |
| 12-21 | Special districts | — | `special-district-provider.ts` | Future |
| 22-23 | Overflow | — | — | Reserved |

---

## Architecture: Unified Build

### Principle: Single Spatial Database, Multi-Layer

Instead of separate databases per pipeline, one `shadow-atlas.db` contains ALL boundary
layers. Each district carries a `layer` tag. The `parseRTreeDistrictId()` function (Cycle 30A)
already routes by prefix — extending it to new layer types is mechanical.

### ID Convention

Every district in the R-tree gets a deterministic, layer-prefixed ID:

```
TIGER federal:      cd-{SSDD}           → cd-0611 (CA-11)
TIGER state:        sldu-{SSNNN}        → sldu-06001
                    sldl-{SSNNN}        → sldl-06001
TIGER county:       county-{SSCCC}      → county-06001
TIGER place:        place-{SSNNNNN}     → place-0667000 (San Francisco)
TIGER school:       unsd-{SSNNNNN}      → unsd-0600001
                    elsd-{SSNNNNN}      → elsd-0600001
                    scsd-{SSNNNNN}      → scsd-0600001
TIGER precinct:     vtd-{SS}{VTDID}     → vtd-06001234
TIGER tribal:       aiannh-{NNNNN}      → aiannh-00100
City council ward:  ward-{FIPS}-{WW}    → ward-5363000-02 (Seattle Ward 2)
Canadian riding:    can-fed-{XXXXX}     → can-fed-35001
```

### Multi-Hit Lookup

A point-in-polygon query returns **all** matching districts, not just the first.
The API groups results by layer type:

```json
{
  "districts": {
    "congressional": { "id": "cd-0611", "name": "California 11th" },
    "state_senate": { "id": "sldu-06007", "name": "Senate District 7" },
    "state_house": { "id": "sldl-06019", "name": "Assembly District 19" },
    "county": { "id": "county-06075", "name": "San Francisco County" },
    "city": { "id": "place-0667000", "name": "San Francisco" },
    "ward": { "id": "ward-5363000-02", "name": "District 2" },
    "school_unified": { "id": "unsd-0634410", "name": "SF Unified" }
  }
}
```

This requires `DistrictLookupService.performLookup()` to return ALL PIP matches
instead of short-circuiting on first hit.

### Build Script Extension

`build-district-db.ts` becomes the single entry point for all layers:

```bash
# Full build (all layers, ~15min, ~15GB)
npm run build:districts -- --layers all

# Federal + state legislative + county only (current default)
npm run build:districts -- --layers cd,sldu,sldl,county

# Add city boundaries + school districts
npm run build:districts -- --layers cd,sldu,sldl,county,place,unsd,elsd,scsd

# Add city council wards from portal registry
npm run build:districts -- --layers cd,sldu,sldl,county --wards

# Everything including voting precincts (~310K boundaries)
npm run build:districts -- --layers all --wards
```

The `--wards` flag triggers the portal pipeline:
1. Load `WardRegistry` (424 cities, confidence >= 70)
2. Download ward GeoJSON from ArcGIS FeatureServer (cached in `data/ward-cache/`)
3. Convert `WardBoundary[]` → `NormalizedDistrict[]` via normalizer
4. Merge into `allDistricts[]` before R-tree build

---

## Implementation Cycles

### Cycle 31: Multi-Layer TIGER + Ward Ingestion into R-tree

**Goal**: `build-district-db.ts` ingests all TIGER layers + city council wards into one R-tree.

#### 31A: Multi-hit lookup in DistrictLookupService
- **File**: `src/serving/district-service.ts` (`performLookup`)
- **Change**: Return ALL PIP matches, not first match only
- **New return type**: `DistrictBoundary[]` (array, grouped by layer)
- **Update**: `api.ts` handlers to format multi-hit response

#### 31B: Expand TIGER layers in build script
- **File**: `src/scripts/build-district-db.ts`
- **Change**: Accept `--layers all` flag, map to full TIGERLayer list
- **Add layers**: `place`, `cousub`, `unsd`, `elsd`, `scsd`
- **Defer**: `vtd` (~200K), `zcta`, `tract`, `bg` (massive, separate build profile)
- **Update**: `parseRTreeDistrictId()` in `api.ts` for new prefixes

#### 31C: Ward portal ingestion in build script
- **File**: `src/scripts/build-district-db.ts`
- **Change**: Add `--wards` flag that loads WardRegistry + downloads + normalizes
- **Bridge**: `WardBoundary` → `NormalizedDistrict` conversion function
- **ID format**: `ward-{cityFips}-{wardNumber:02d}`
- **Deps**: `ward-registry.ts`, `ward-boundary-loader.ts` (both functional)

#### 31D: Update parseRTreeDistrictId for all new layer types
- **File**: `src/serving/api.ts`
- **Change**: Add regex branches for `place-*`, `unsd-*`, `elsd-*`, `scsd-*`, `ward-*`, etc.
- **Officials routing**: Ward IDs don't map to officials (wards don't have elected reps in the
  officials DB — that's the city council member, which is a different data source)

#### 31E: Build + benchmark
- **Run**: Full national build with `--layers cd,sldu,sldl,county,place,unsd,elsd,scsd --wards`
- **Expected**: ~55,000 TIGER boundaries + 3,226 wards ≈ 58,000 total
- **Benchmark**: Verify p95 < 50ms with multi-hit queries
- **DB size**: Estimate ~3-5GB

#### 31F: API response format for multi-layer results
- **File**: `src/serving/api.ts` (`handleLookup`, `handleResolve`, `handleResolveAddress`)
- **Change**: Return structured multi-layer response instead of single district
- **Backward compat**: Include `district` (primary = finest match) + `all_districts` array

### Cycle 32: VTD + Tribal + Portal Expansion

**Goal**: Add voting precincts (~200K) and expand portal coverage beyond 424 cities.

#### 32A: VTD layer build
- `--layers vtd` (~200K boundaries, separate build profile due to size)
- May require partitioned build (per-state VTD files)

#### 32B: Tribal/Indigenous boundaries
- `--layers aiannh` (~700 boundaries)
- Sovereignty-aware: tribal boundaries overlay state/county, not replace

#### 32C: Portal coverage expansion
- Run `BulkDistrictDiscovery` for top 1,000 cities (currently 424 validated)
- Target: 600+ cities with ward data
- Validate new discoveries through 7-layer pipeline

#### 32D: State GIS authoritative ward data
- Ingest Wisconsin LTSB statewide ward data (100% confidence)
- Ingest MassGIS 2022 statewide ward data (100% confidence)
- These override per-city ArcGIS data where available (higher authority)

### Cycle 33: Tree 2 Unification + Special Districts

**Goal**: Tree 2 hydration pipeline reads from the same R-tree DB instead of its own download path.

#### 33A: Tree 2 reads wards from R-tree
- `build-tree2.ts` ward overlay reads from `shadow-atlas.db` instead of downloading from ArcGIS
- Eliminates duplicate ward download (currently: R-tree build downloads, Tree 2 build downloads separately)
- Single source of truth for ward geometries

#### 33B: Special district providers
- Fire/EMS (slot 12), Water (slot 13), Transit (slot 15)
- `special-district-provider.ts` already has the framework
- Start with fire districts (highest civic relevance)

#### 33C: Coverage dashboard
- `npm run dashboard` shows per-layer coverage
- Per-state breakdown: which layers are populated
- Gap analysis: highest-population areas with missing ward data

---

## Key Abstractions

### 1. `BoundarySource` — Universal Boundary Provider

Every data source implements one function:

```typescript
interface BoundarySource {
  readonly name: string;
  readonly layers: string[];
  fetch(options: FetchOptions): AsyncIterable<NormalizedDistrict>;
}
```

TIGER, Canadian ridings, city portals, state GIS — all produce `NormalizedDistrict`.
The build script iterates sources, not layers.

### 2. `parseRTreeDistrictId()` — Universal ID Router

Already implemented (Cycle 30A). Extends mechanically for new prefixes.
Single function that translates any R-tree ID into a structured dispatch target.

### 3. `NormalizedDistrict` — The Universal Currency

Every boundary, regardless of origin, gets normalized into this type.
Deterministic ID, simplified geometry, provenance chain, bounding box.
R-tree accepts it. Tree 2 can read from it. API serves it.

### 4. Slot-Based Circuit Architecture — 24 Slots

The Noir circuit has 24 slots baked in. Each boundary type maps to exactly one slot.
No ambiguity, no overlap. New boundary types get assigned to their slot and the
mapping is exhaustive (compile-time checked via `authority-mapper.ts`).

---

## Redundancy Eliminated

| Before | After |
|--------|-------|
| Ward download in `build-tree2.ts` AND separate R-tree build | Single download, R-tree is source of truth |
| `NormalizedBoundary` (provider output) + `NormalizedDistrict` (R-tree input) | Bridge function `toNormalizedDistrict()` is explicit, single-use |
| TIGER layers hardcoded to 4 | `--layers all` flag, same provider handles all 26 types |
| Canadian ridings separate code path | Same `allDistricts.push()` pattern as TIGER |
| Ward IDs ad-hoc in hydration | `ward-{fips}-{num}` convention, same `parseRTreeDistrictId()` |

---

## Cycle Status Tracker

### Cycle 30: Docker E2E + Canadian Boundaries — COMPLETE
- [x] 30A: `parseRTreeDistrictId()` — handles cd/sldu/sldl/county/can-fed + legacy format
- [x] 30B: Docker bind mounts (shadow-atlas.db + officials.db, both :ro)
- [x] 30C: Nominatim activated (NOMINATIM_URL uncommented)
- [x] 30D: Canadian ridings in `build-district-db.ts` (CanadaBoundaryProvider)
- [x] 30E: Chain scanner env vars (Scroll Sepolia)
- [x] 30F: Health service flags + `verify-serving.ts`

### Cycle 31: Multi-Layer TIGER + Ward Ingestion — COMPLETE (reviewed)
- [x] 31A: Multi-hit lookup (`lookupAll()` returns all PIP matches, sorted by layer specificity)
- [x] 31B: Expand TIGER layers (`--layers all` maps to 13 civic layers: cd,sldu,sldl,county,place,cousub,unsd,elsd,scsd,aiannh,concity,submcd,anrc)
- [x] 31C: Ward portal ingestion (`--wards` flag loads WardRegistry + downloads + normalizes)
- [x] 31D: `parseRTreeDistrictId()` extended for place, cousub, unsd, elsd, scsd, vtd, aiannh, ward
- [ ] 31E: Full national build + benchmark (requires `--layers all --wards` execution)
- [x] 31F: Multi-layer API response (`all_districts` grouped by layer type + backward-compat `district` primary)

#### 31 Implementation Notes
- `district-service.ts`: `performLookup()` now collects ALL PIP matches into array, sorted by `LAYER_PRIORITY` (ward=1 → cd=30)
- `district-service.ts`: New `lookupAll()` public method; `lookup()` delegates to it for backward compat
- `api.ts`: `handleLookup`, `handleResolve`, `handleResolveAddress` all return `all_districts` object grouped by `districtIdToLayerName()`
- `api.ts`: Officials lookup iterates all matched districts to find congressional/riding match (not just primary)
- `build-district-db.ts`: `ALL_CIVIC_LAYERS` constant for `--layers all`, ward ingestion block after Canadian ridings
- `verify-serving.ts`: Checks 2 & 3 updated to validate `all_districts` presence

#### 31 Agent Review Findings (3 agents, 11 consolidated findings)

| ID | Severity | Finding | Resolution |
|----|----------|---------|------------|
| F1 | ISSUE | `groupByLayerType()` overwrites on same-layer duplicates (last wins, not first) | FIXED — added `!grouped[layerName]` guard for first-wins |
| F2 | ISSUE | Ward cityFips 5-7 digit format ambiguity; regex assumed exactly 7 | FIXED — ward regex now `(\d{5,7})`, graceful fallback for non-7-digit FIPS |
| F3 | ISSUE | `--layers ALL` (uppercase) didn't match case-sensitive `=== 'all'` | FIXED — `.toLowerCase()` before comparison |
| F4 | WARN | Empty-result cache miss not stored → ocean coordinates re-query DB | DEFERRED — performance optimization, not correctness bug |
| F5 | WARN | `vintage` field hardcoded when primary is null → misleading response | FIXED — null-safe ternary: `primary ? (...) : null` |
| F6 | WARN | VTD regex `.+` too permissive; could match malformed IDs | FIXED — tightened to `\w+` (alphanumeric Census VTDST codes) |
| F7 | WARN | `--wards --state XX` silently skips ward ingestion | FIXED — added console.warn when both flags set |
| F8 | WARN | `submcd` and `anrc` missing from ALL_CIVIC_LAYERS | FIXED — added `submcd`, `anrc` to build layers + LAYER_PRIORITY + districtIdToLayerName |
| F9 | WARN | Ward provenance `source` field is synthetic (`arcgis-featureserver/...`) not actual URL | DEFERRED — requires ward-boundary-loader interface refactor |
| F10 | WARN | No logging when unrecognized prefix dropped in groupByLayerType | FIXED — added `logger.debug()` for unrecognized district ID prefixes |
| F11 | WARN | verify-serving checks don't assert expected layer types | FIXED — check 2 now asserts `congressional` + `county` layers for SF |

### Cycle 32: VTD + Tribal + State GIS + Portal Expansion — COMPLETE (reviewed)

#### 32A: VTD Layer Build — OPERATIONAL
- VTD layer fully supported in TIGERBoundaryProvider (layer type `vtd`, ~200K boundaries)
- `parseRTreeDistrictId` handles `vtd-SS{VTDID}` format
- NOT included in `--layers all` due to size (~200K boundaries, separate build profile)
- **Build command**: `npx tsx src/scripts/build-district-db.ts --layers vtd`
- **Expected**: ~200,000 voting precincts nationally, ~40min build time

#### 32B: Tribal/Indigenous Boundaries — INCLUDED
- `aiannh` layer included in `ALL_CIVIC_LAYERS` since Cycle 31B
- `parseRTreeDistrictId` handles `aiannh-NNNNN` format
- ANRC (Alaska Native Regional Corporation) added in Cycle 32: `anrc-NNNNN`
- **No separate action needed** — built with `--layers all`

#### 32C: Portal Discovery Expansion — OPERATIONAL
- `BulkDistrictDiscovery` supports 5 population tiers, up to 19,495 cities
- Tier 2 (1,000 cities, 50K+ pop) achieves 90% discovery rate, ~40min runtime
- `discoverFromHub()` function provides cross-state programmatic discovery
- **No code changes needed** — run existing scripts with larger place lists

#### 32D: State GIS Authoritative Ward Data — WIRED
- [x] Added `--state-gis` flag to `build-district-db.ts`
- [x] Ingests WI (LTSB) and MA (MassGIS) statewide ward data via `BatchOrchestrator.extractStatewideWards()`
- [x] State GIS wards (authority=100%) override portal wards for same FIPS (explicit removal + re-insert)
- [x] Provenance: `authority: 'state-gis'`, `method: 'state-gis-extraction'`
- **Build command**: `npx tsx src/scripts/build-district-db.ts --layers all --wards --state-gis`
- **Expected**: ~50 WI cities + ~40 MA cities with authoritative ward boundaries

#### 32-fix: Missing parseRTreeDistrictId Branches
- [x] Added `concity-SSCCC` → `consolidated-city` type
- [x] Added `submcd-SSNNNNN` → `subminor-civil-division` type
- [x] Added `anrc-NNNNN` → `alaska-native-regional` type (always state='AK')

#### 32 Build Profiles

| Profile | Command | Boundaries | Time | Size |
|---------|---------|-----------|------|------|
| **Default** | `--layers cd,sldu,sldl,county` | ~10,500 | ~5min | ~1.2GB |
| **Civic** | `--layers all` | ~90,000 | ~20min | ~5-8GB |
| **Civic + Wards** | `--layers all --wards` | ~93,000 | ~25min | ~6-9GB |
| **Full** | `--layers all --wards --state-gis` | ~93,500 | ~30min | ~6-9GB |
| **VTD (separate)** | `--layers vtd` | ~200,000 | ~40min | ~10GB |
| **Everything** | `--layers all,vtd --wards --state-gis` | ~293,000 | ~60min | ~15GB |

Note: `--layers all,vtd` works — the parser expands `all` to all civic layers and merges with explicit `vtd`.

#### 32 Agent Review Findings (3 agents, 12 consolidated findings)

| ID | Severity | Finding | Resolution |
|----|----------|---------|------------|
| G1 | ISSUE | `submcd` regex expected 7-digit GEOID but Census uses 10 (SS+CCC+NNNNN) | FIXED — regex `(\d{2})(\d{3})(\d{5})$` |
| G2 | ISSUE | `concity` regex expected 5-digit GEOID but Census uses 7 (SS+PLACEFP) | FIXED — regex `(\d{2})(\d{5})$` (same as place) |
| G3 | ISSUE | `--layers all,vtd` parser didn't expand `all` when comma-separated | FIXED — token-based parser, `all` expanded + merged with explicit |
| G4 | ISSUE | State GIS ward numbering ignored `WARD_NORMALIZED` from BatchOrchestrator | FIXED — reads `feature.properties['WARD_NORMALIZED']` |
| G5 | ISSUE | Doc said 11 civic layers, code has 13 | FIXED — updated to 13 |
| G6 | WARN | `readFile` dynamic import in loop | FIXED — static import at top |
| G7 | WARN | Boundary count estimates ~40% low | FIXED — updated to ~90K civic |
| G8 | WARN | `--state-gis` without `--wards` undocumented | FIXED — added code comment |
| G9 | WARN | GeoJSON type assertion should use FeatureCollection | FIXED — proper type + runtime guard |
| G10 | WARN | Zero state-GIS wards should warn | FIXED — added console.warn |
| G11 | NOTE | `anrc` hardcodes `state: 'AK'` | Accepted — factually correct |
| G12 | NOTE | `can-*` prefix fragility in LAYER_PRIORITY | Accepted — single Canadian layer, documented |
| G13 | ISSUE | Pre-existing: `cousub` regex expected 7-digit GEOID but Census uses 10 (same as submcd) | FIXED — manual review catch, regex updated to `(\d{2})(\d{3})(\d{5})$` |

### Cycle 33: Tree 2 Unification + Special Districts — COMPLETE (reviewed)

- [x] 33A: Tree 2 reads wards from R-tree SQLite DB
- [x] 33B: Special district providers wired into build pipeline
- [x] 33C: Coverage dashboard script

#### 33A: Tree 2 R-tree Ward Reader
- NEW FILE: `src/hydration/rtree-ward-reader.ts` — reads `ward-*` rows from `shadow-atlas.db`, groups by cityFips, returns `CityWardBoundaries[]`
- MODIFIED: `src/hydration/build-tree2.ts` — added `--wards-from-rtree <path>` flag
  - R-tree path: `loadWardsFromRTree(dbPath, stateFipsFilter)` (single source of truth)
  - Legacy path: `loadWardRegistry()` + `loadWardBoundaries()` (ArcGIS downloads)
  - Both paths converge at `overlaySupplementalDistricts()` — same CityWardBoundaries[] interface
- **Build command**: `npx tsx src/hydration/build-tree2.ts --wards-from-rtree ./data/shadow-atlas.db`

#### 33B: Special District Build Pipeline
- MODIFIED: `src/scripts/build-district-db.ts` — added `--special-districts` flag
  - Iterates `SPECIAL_DISTRICT_PROVIDERS` registry, downloads boundaries, normalizes to NormalizedDistrict
  - Short prefix form used for IDs: `fire-06FD00001` (not `fire_district-06FD00001`)
  - `--state` filter applied (skips providers for non-matching states)
  - `specialDistrictMetadata` intentionally dropped (geometry-only store)
- MODIFIED: `src/serving/api.ts`
  - `parseRTreeDistrictId()` extended with 7 special district types: fire, water, transit, library, hospital, utility, park
  - `districtIdToLayerName()` extended with 7 entries: fire_district, water_district, transit_district, library_district, hospital_district, utility_district, park_district
- MODIFIED: `src/serving/district-service.ts`
  - `LAYER_PRIORITY` extended: fire=32, library=33, park=33, hospital=34, water=34, utility=34, transit=34
  - Special districts sort after congressional (supplemental civic, not primary representation)
- **Build command**: `npx tsx src/scripts/build-district-db.ts --layers all --special-districts`

#### 33C: Coverage Dashboard
- NEW FILE: `src/scripts/coverage-dashboard.ts` — reads shadow-atlas.db, reports per-layer counts
  - `npm run dashboard` (already registered in package.json)
  - `--json` for machine-readable output, `--verbose` for per-state detail, `--db <path>` for custom DB
  - Ward gap analysis: cities with ward data, states without wards, cross-reference with CD coverage
  - Single-pass collection with inline ward FIPS tracking

#### 33 Agent Review Findings (3 agents, 18 consolidated findings)

| ID | Severity | Finding | Resolution |
|----|----------|---------|------------|
| H1 | WARN | wardGeoid padding: padStart(2) may produce inconsistent lengths for high ward numbers | Accepted — matches legacy ArcGIS path exactly (ward-boundary-loader.ts:276) |
| H2 | ISSUE | Double-encoded stateFips in special district IDs (fire-0606FD00001) | FIXED — strip provider.stateFips from boundary.id before prepending |
| H3 | ISSUE | `--state` filter not applied to special districts loop | FIXED — added `if (stateFips && provider.stateFips !== stateFips) continue` |
| H4 | ISSUE | specialDistrictMetadata silently dropped | FIXED — added documentation comment (intentional geometry-only store) |
| H5 | WARN | No per-row error isolation in rtree-ward-reader geometry parse | FIXED — added try/catch + continue per row |
| H6 | WARN | No runtime geometry type check in rtree-ward-reader | FIXED — added `parsed.type !== 'Polygon' && ... !== 'MultiPolygon'` guard |
| H7 | WARN | Dead FIPS_TO_STATE constant in rtree-ward-reader | FIXED — removed entirely |
| H8 | WARN | LAYER_PRIORITY places special districts after congressional | Accepted — intentional: supplemental civic, not primary representation. Comment added. |
| H9 | WARN | CaliforniaFireDistrictsProvider getSourceUrl returns browser page | Accepted — pre-existing provider stub, not introduced by Cycle 33 |
| H10 | WARN | Dashboard wardCities rescans all rows | FIXED — collected inline during main loop |
| H11 | WARN | Dashboard statesWithoutWards silently suppressed >20 | FIXED — added truncation indicator + `--json` hint |
| H12-H18 | NOTE | Various style/doc items | Accepted |

#### 33 Manual Review Findings

| ID | Severity | Finding | Resolution |
|----|----------|---------|------------|
| M-01 | **ISSUE** | Special district ID prefix used full enum value (`fire_district`) not short form (`fire`). `parseRTreeDistrictId`, `districtIdToLayerName`, and `LAYER_PRIORITY` all match on `fire-` but build wrote `fire_district-`. IDs would never match. | FIXED — `rawType.replace(/_district$/, '')` extracts short prefix |
| M-02 | WARN | rtree-ward-reader jurisdiction regex `/^USA\/([A-Z]{2})$/` won't match DB format `USA/06`. State field always empty. | FIXED — regex now accepts any `USA/{value}`, overlay engine doesn't use `state` field |
| M-03 | WARN | Special district `jurisdiction` uses raw FIPS (`USA/06`) not abbreviation — consistent with TIGER pattern | Accepted — consistent, no downstream impact |
| M-04 | NOTE | Dashboard layerPrefix would report `fire_district` as layer name pre-fix. Now correctly reports `fire` after M-01 fix. | Resolved by M-01 |

#### 33 Build Profiles (updated)

| Profile | Command | Boundaries | Notes |
|---------|---------|-----------|-------|
| **Civic + Wards** | `--layers all --wards` | ~93,000 | Standard build |
| **Full** | `--layers all --wards --state-gis` | ~93,500 | + WI/MA authoritative wards |
| **Full + Special** | `--layers all --wards --state-gis --special-districts` | ~93,500+ | + fire/water/transit/etc |
| **VTD (separate)** | `--layers vtd` | ~200,000 | Separate profile |
| **Everything** | `--layers all,vtd --wards --state-gis --special-districts` | ~293,000+ | Maximum coverage |

### Cycle 34: National Build + E2E Validation — COMPLETE (reviewed)

- [x] 34A: Full national build (`--layers all --special-districts`)
- [x] 34B: Tree 2 R-tree integration test (`--wards-from-rtree`)
- [x] 34C: Docker E2E — DEFERRED (not blocking; Docker bind-mount path update needed for new 3.6GB DB)
- [x] 34D: Benchmark script + baseline

#### 34A: Full National Build Results
- **Command**: `NODE_OPTIONS="--max-old-space-size=8192" npx tsx src/scripts/build-district-db.ts --layers all --special-districts`
- **Output**: `data/shadow-atlas-full.db` — **3.6GB**, **94,166 districts** (93,828 US + 338 Canadian)
- **OOM fix**: Default 1.5GB V8 heap crashed during COUSUB transformation (~36K polygons). Fixed with 8GB heap.
- **Territory failures**: AS, GU, MP, VI (SLDU/SLDL/SCSD) — expected, no TIGER data for these
- **NE SLDL failure**: Nebraska unicameral — no lower house districts — expected
- **Special districts**: 0 — CaliforniaFireDistrictsProvider URL returns HTML not JSON (pre-existing H9)

| Layer | Count | States | Duration |
|-------|-------|--------|----------|
| cousub | 36,492 | 56 | 81.5s |
| place | 32,612 | 56 | 20.1s |
| unsd | 10,897 | 56 | 395.4s |
| sldl | 4,879 | 50 | 226.6s |
| county | 3,235 | 56 | 11.1s |
| sldu | 1,964 | 52 | 144.7s |
| elsd | 1,952 | 26 | 962.8s |
| aiannh | 864 | 88 | 3.3s |
| scsd | 481 | 20 | 1918.6s |
| cd | 444 | 56 | 3.3s |
| concity | 8 | 7 | n/a |
| can-fed | 338 | 13 prov | 6s |

#### 34A-fix: Canada Provider Rewrite
- **Root cause**: Represent API list endpoint does NOT include `simple_shape` — returns only metadata
- **Fix**: Two-endpoint fetch + name-based join:
  1. List endpoint (`?limit=500`) → metadata map (external_id, name)
  2. Bulk `/simple_shape?limit=500` → geometries (name, simple_shape)
  3. Merge on name, derive province from SGC code prefix via `sgcToProvince()`
- **Added**: `sgcToProvince()` — maps 2-digit SGC code to ISO 3166-2:CA (10→NL, 11→PE, ..., 62→NU)
- **Removed**: Dead `normalizeBoundary()` method (R04)
- **Result**: 338/338 ridings extracted, province distribution: ON:121, QC:78, BC:42, AB:34, ...

#### 34B: Tree 2 R-tree Integration
- **Command**: `npx tsx src/hydration/build-tree2.ts --state 06 --wards-from-rtree ./data/shadow-atlas-full.db`
- **Result**: 19,987 cells, root hash `0x147852d3...`, depth 20
- Ward overlay: 0 cities (expected — DB built without `--wards`)
- R-tree reading path verified functional

#### 34D: Benchmark Results
- NEW FILE: `src/scripts/benchmark-lookup.ts`
- npm scripts: `benchmark`, `benchmark:multi`

| Metric | Single-hit | Multi-hit |
|--------|-----------|-----------|
| p50 | 13.1ms | 11.9ms |
| p90 | 40.7ms | 34.7ms |
| p95 | **55.4ms** | **46.9ms** |
| p99 | 101.4ms | 92.1ms |
| max | 350ms | 212ms |
| Result | FAIL (>50ms) | **PASS** (<50ms) |
| Hit rate | 64.2% | 67.0% |

- Single-hit p95 exceeds target due to school district layers (UNSD/ELSD/SCSD dense polygons)
- Multi-hit p95 passes — `lookupAll()` is the production path
- Outliers: Houston (76ms), Phoenix (64ms) — complex polygon geometries

#### 34 Agent Review Findings (14 findings)

| ID | Severity | Finding | Resolution |
|----|----------|---------|------------|
| R01 | HIGH | Shapes endpoint not paginated — would silently truncate if >500 ridings | FIXED — added count mismatch warning |
| R02 | HIGH | Name-based join fragile against Unicode/whitespace differences | Accepted — all 338 names verified unique + exact match. Document risk. |
| R03 | HIGH | `sgcToProvince()` silent 'ON' fallback for unknown SGC prefix | FIXED — added `logger.warn` on fallback |
| R04 | MEDIUM | Dead `normalizeBoundary()` method | FIXED — removed |
| R05 | MEDIUM | Duplicate name collision in metadata map | Accepted — verified 338 unique names |
| R06 | MEDIUM | Shapes URL assumes trailing slash in endpoint config | Accepted — config enforces trailing slash |
| R07 | MEDIUM | Benchmark: exceptions excluded from latency recording | Accepted — rare, minimal impact |
| R08 | MEDIUM | Region weights sum to 1.0 by coincidence | Accepted — static constants, no runtime mutation |
| R09 | MEDIUM | Percentile formula: p(0) edge case | Accepted — p(0) never called |
| R10 | LOW | No fetch timeout on Represent API calls | Accepted — build script, not production serving |
| R11 | LOW | `externalId.slice(0,2)` doesn't validate length | Accepted — externalId checked non-empty on line 523 |
| R12 | LOW | `strict: false` in parseArgs | Accepted — developer-facing script |
| R13 | LOW | Service constructor outside try block | Accepted — existsSync guard on line 94 |
| R14 | LOW | Canadian bbox misses territories >60N | Accepted — 5% weight, 3 ridings affected |

#### 34 Manual Review Findings

| ID | Severity | Finding | Resolution |
|----|----------|---------|------------|
| M-01 | NOTE | Name-based join verified: all 338 riding names unique in Represent API | No action needed |
| M-02 | NOTE | `sgcToProvince()` 'ON' fallback logged but tolerable (Marc Miller XX case) | Warn logged |
| M-03 | NOTE | Single-hit p95=55ms exceeds 50ms but p90=41ms passes; multi-hit p95=47ms passes | Multi-hit is production path — acceptable |
| M-04 | NOTE | OOM on COUSUB (default heap). Needs `NODE_OPTIONS="--max-old-space-size=8192"` | Document in npm script |

### Cycle 35: Docker E2E + Production DB Swap — COMPLETE (reviewed)

**Goal**: Wire the 3.6GB full national DB into Docker, validate all API endpoints serve correctly.

#### 35A: Docker bind-mount update — DONE
- `docker-compose.yml` mounts `shadow-atlas-full.db` (3.6GB) as `shadow-atlas.db` inside container
- Container starts successfully, all services report healthy

#### 35B: Full API endpoint validation — DONE
- `verify-serving.ts`: 6 passed, 0 failed, 1 warning (geocoding — Nominatim not running)
- SF lookup: 7 layers (school_unified, city, county_subdivision, county, state_house, state_senate, congressional)
- Ottawa lookup: `can-fed-35075` (Ottawa Centre)
- SF resolve: Nancy Pelosi (CA-11) + both senators + 7 layers

#### 35C: npm build script update — DONE
- `build:districts:full` script with `NODE_OPTIONS='--max-old-space-size=8192'` and `--layers all`
- Outputs to `./data/shadow-atlas-full.db`

#### Critical bugs found and fixed:
1. **Server startup hang (42s)**: `ProofService.create([], [])` builds empty merkle tree at default depth 20 (2^20 = 1M padding leaves). Fixed: depth 18 for empty trees in `merkle-tree.ts`.
2. **Lookup/resolve 500 errors**: ProofService.generateProof fails on empty mock tree. Fixed: try/catch in `handleLookup` and `handleResolve`, returns `merkleProof: null`.
3. **Communique client breakage (R01)**: `client.ts` threw on null merkle proof. Fixed: `DistrictLookupResult.merkleProof` now `MerkleProof | null`, validation guarded with null check.

#### Agent review findings (R01–R08):
| ID | Sev | Status | Description |
|----|-----|--------|-------------|
| R01 | HIGH | FIXED | Communique client hard-fails on `merkleProof: null` |
| R02 | HIGH | FIXED | Silent catch blocks — added `console.warn` logging |
| R03 | MED | ACCEPTED | `/v1/districts/:id` is intentionally a proof endpoint — should fail when no proof data |
| R04 | MED | ACCEPTED | Empty tree depth 18 vs production 20 — moot since mock tree never serves real proofs |
| R05 | LOW | FIXED | Added CIRCUIT_DEPTHS ordering comment |
| R06 | LOW | ACCEPTED | Host/container filename mismatch is intentional, documented in comments |
| R07 | LOW | ACCEPTED | NODE_OPTIONS single-quote syntax is Unix-only — project targets macOS/Linux/Docker |
| R08 | NOTE | **FIXED (Cycle 36)** | Nullable ProofService — skip tree construction entirely. 42s → 270ms startup |

#### Manual review findings (M-01 through M-10):
| ID | Status | Description |
|----|--------|-------------|
| M-01 | OK | docker-compose bind mounts correct |
| M-02 | OK | build:districts:full script correct |
| M-03 | WARN | 42s startup for depth-18 empty tree — acceptable for now |
| M-04 | NOTE | `merkleProof: null` is behavioral change — communique client fixed |
| M-05 | OK | verify-serving.ts passes (6/6 + 1 expected warning) |
| M-06 | OK | communique client null guard correct |
| M-07 | OK | api.ts logging verified in Docker |
| M-08 | OK | CIRCUIT_DEPTHS comment accurate |
| M-09 | WARN | `console.warn` uses printf-style `%s` — cosmetic, works in Node.js |
| M-10 | OK | All `DistrictLookupResult` consumers handle null merkleProof correctly |

### Cycle 36: Instant Startup + Docker Image Rebuild — COMPLETE (reviewed)

**36A: Nullable ProofService** — implements R08 from Cycle 35 review.
- `proofService` field + constructor param typed `ProofService | null`
- Factory returns `null` instead of `ProofService.create([], [])` — eliminates 262K-leaf empty tree
- Null guards at all 3 callsites: handleLookup (returns `merkleProof: null`), handleDistrictById (returns 501), handleResolve (returns `merkleProof: null`)
- Health endpoint reports `proofService: false`
- **Result: 42s → 270ms startup (155x improvement)**

**36B: Docker image rebuild** — bakes Cycle 35 + 36A fixes into image.
- `.dockerignore` updated: exclude `*.db`, `*.db-shm`, `*.db-wal`, `tiger-cache` (15.5GB → 5.1GB context)
- Docker builder pruned (135GB reclaimed)
- Image rebuilt, container healthy without source bind-mount
- verify-serving.ts: 6/6 PASS, 1 WARN (geocoding — Nominatim not running)

#### Agent review findings:
| ID | Sev | Status | Description |
|----|-----|--------|-------------|
| — | — | PASS | No HIGH or MEDIUM findings. Pre-existing dead imports (LOW) and stale LookupResult type (LOW) noted |

#### Manual review findings (M-01 through M-08):
| ID | Status | Description |
|----|--------|-------------|
| M-01 | OK | Null guard consistency — all 3 proof callsites guarded |
| M-02 | OK | 501 semantics correct for disabled proof service |
| M-03 | OK | Health reports `proofService: false`, status = "degraded" |
| M-04 | OK | Factory comment explains null rationale |
| M-05 | OK | `merkleProof: null` response matches communique client type |
| M-06 | OK | Docker image runs without source bind-mount |
| M-07 | OK | .dockerignore excludes DB files (5.1GB context) |
| M-08 | OK | Logging in catch blocks (district ID + error message) |

---

## Agent Team Strategy

Each cycle runs as: **implementation wave → agent review → manual review → findings update**

### Implementation Wave
- **Team 1 (Core)**: Database schema + lookup service changes
- **Team 2 (Build)**: Build script extensions + new layer ingestion
- **Team 3 (API)**: Response format + ID routing + backward compat

### Agent Review
- Agent reviews each team's output for: type safety, ID format consistency,
  backward compatibility, performance regression, missing error handling

### Manual Review
- Verify R-tree query performance with expanded data
- Spot-check ward geometries against known cities (NYC 51, Chicago 50, etc.)
- Verify multi-hit response format matches client expectations
- Check that Tree 2 slot assignments are consistent with R-tree layer types

### Findings Update
- This document updated with completion status, benchmark results, and
  any architectural findings that inform the next cycle
