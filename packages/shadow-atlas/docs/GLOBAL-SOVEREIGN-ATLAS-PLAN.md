# Global Sovereign Atlas — Implementation Plan

**Status: PROPOSED**
**Created: 2026-02-26**
**Prerequisite: SOVEREIGN-RESOLUTION-PLAN.md Cycles 1–4 (all COMPLETE)**

## Thesis

Shadow Atlas becomes a **planetary-scale, zero-runtime-dependency civic resolution engine**.
Every boundary, official, and proof is pre-ingested from authoritative open data, stored in
content-addressed Merkle trees, and committed on-chain. No government API is called at
request time. No commercial service is required. The entire system runs on sovereign
infrastructure with $0 licensing cost.

```
Address (any Five Eyes + EU country)
    |
    v
Shadow Atlas /v1/resolve-address
    |
    +-> Geocode (self-hosted Nominatim, TIGER + OSM data)
    +-> PIP district lookup (R-tree spatial index, official boundaries)
    +-> Officials (SQLite, pre-ingested open government data)
    +-> Merkle proof (SMT, on-chain root per vintage)
    |
    v
{ geocode, district, officials[], proof, cell_id, vintage }
```

**Design principles:**
- **Zero external runtime calls** — all data pre-ingested
- **Authoritative sources only** — government statistical agencies, not crowd-sourced
- **One ingestion pattern** — every country follows the same pipeline abstraction
- **Temporal versioning** — vintage-tagged trees survive redistricting
- **$0 licensing** — CC0, CC BY, OGL, public domain only
- **Progressive disclosure** — Five Eyes first, then EU, then world

---

## What Exists (Working)

| Component | Status | Coverage |
|-----------|--------|----------|
| Officials DB (US Congress) | OPERATIONAL | 538 members, 119th Congress |
| Officials DB (Canada MPs) | BROKEN | 1 of 343 inserted (regex bug) |
| R-tree spatial index code | OPERATIONAL | DistrictLookupService ready |
| R-tree spatial index DATA | EMPTY | No district DB built yet |
| Geocode service code | OPERATIONAL | GeocodeService class written |
| Geocode service DATA | NOT DEPLOYED | Nominatim not yet running |
| TIGER boundary provider | OPERATIONAL | Download + transform pipeline |
| Canada boundary provider | OPERATIONAL | 338 ridings via Represent API |
| UK/AU/NZ providers | STUBBED | Test files only |
| Acquisition orchestrator | OPERATIONAL | ArcGIS + State GIS + OSM scrapers |
| Batch job persistence | OPERATIONAL | Schema: jobs, extractions, snapshots |
| Chain scanner | NOT CONFIGURED | Needs RPC_URL + contract address |
| Multi-vintage serving | OPERATIONAL | ?vintage= query param, registry |

## What Remains

### Tier 0: Critical Fixes (unblock existing functionality)
1. **Canadian MP regex bug** — 342 of 343 MPs silently dropped
2. **District DB build** — R-tree index has no data (fresh Docker = empty)

### Tier 1: Data Population (make the existing pipeline produce real output)
3. **TIGER boundary extraction** — run full US pipeline, build district DB
4. **Nominatim deployment** — spin up geocoder with TIGER + OSM data
5. **Chain scanner config** — connect to Scroll Sepolia for root updates

### Tier 2: Global Expansion (Five Eyes)
6. **UK boundaries + officials** — ONS Open Geography Portal (best API available)
7. **Australia boundaries + officials** — ABS ASGS + AEC
8. **New Zealand boundaries + officials** — Stats NZ Datafinder

### Tier 3: EU Statistical Coverage
9. **Eurostat NUTS + LAU** — 100K+ municipal boundaries across 27 member states

### Tier 4: Automation
10. **Quarterly batch refresh** — cron-triggered re-ingestion
11. **Freshness monitoring** — staleness alerts, provenance diff

---

## Phase 1: Critical Fixes + Data Bootstrap

### 1A. Fix Canadian MP ingestion (30 min)

**Bug:** `extractRidingCode()` regex doesn't match actual Represent API boundary URLs.

```
Expected:  /boundaries/federal-electoral-districts/35075/
Actual:    /boundaries/federal-electoral-districts-2023-representation-order/59028/
```

**File:** `src/scripts/ingest-canadian-mps.ts:127`

**Fix:**
```typescript
// Before (broken):
const match = boundaryUrl.match(/federal-electoral-districts\/(\d+)\/?$/);

// After (handles versioned boundary set names):
const match = boundaryUrl.match(/\/boundaries\/[^\/]+\/(\d+)\/?$/);
```

**Verify:** Re-run ingestion, expect 343 MPs inserted (not 1).

### 1B. Build US district database (2-4 hours, mostly download)

**Goal:** Populate the R-tree spatial index so `DistrictLookupService` returns real results.

**Pipeline (already implemented):**
1. `TIGERBoundaryProvider` downloads shapefiles from Census FTP
2. `transformShapefileToGeoJSON()` converts to GeoJSON FeatureCollection
3. `RTreeBuilder.build()` inserts into SQLite with R-tree virtual table
4. Copy `shadow-atlas.db` into Docker volume

**Script to run:**
```bash
# From packages/shadow-atlas/
npx tsx src/scripts/build-district-db.ts \
  --layers cd,sldu,sldl,county \
  --output ./data/shadow-atlas.db \
  --year 2024
```

**If no build script exists yet:** Create a minimal one that:
1. Downloads CD (congressional districts) shapefiles — 435 boundaries
2. Downloads SLDU (state senate) — ~2,000 boundaries
3. Downloads SLDL (state house) — ~5,400 boundaries
4. Downloads COUNTY — ~3,200 boundaries
5. Transforms each to GeoJSON
6. Normalizes district IDs (FIPS-based)
7. Feeds to RTreeBuilder
8. Total: ~11,000 boundaries → <500ms R-tree queries

**Success criteria:**
- `shadow-atlas.db` exists with `districts` + `rtree_index` tables populated
- `DistrictLookupService.lookup(37.78, -122.42)` returns CA-11
- `/v1/lookup?lat=37.78&lng=-122.42` returns district + Merkle proof

### 1C. Nominatim deployment (4-6 hours, mostly import)

**Already configured** in `docker-compose.yml`. Just needs to run:

```bash
docker compose up nominatim
# First run: imports north-america-latest.osm.pbf (~15GB)
# + TIGER address data (~6GB)
# Total disk: ~80GB
# Import time: 4-6 hours
```

**Verify:**
```bash
curl "http://localhost:8088/search?street=1600+Pennsylvania+Ave&city=Washington&state=DC&postalcode=20500&format=json"
# Expect: lat ≈ 38.8977, lon ≈ -77.0365
```

### 1D. Chain scanner configuration

**Required env vars:**
```bash
CHAIN_RPC_URL=https://sepolia-rpc.scroll.io
DISTRICT_GATE_ADDRESS=0xC5efdBE8A11d3EA1dD326360f43F159D9dfF684f
```

**Already deployed** on Scroll Sepolia. Scanner watches for `MerkleRootUpdated` events and syncs on-chain roots with local tree state.

---

## Phase 2: Global Jurisdiction Abstraction

### Design: Universal Jurisdiction Provider

Every country follows one interface. No special-casing per country in serving code.

```typescript
interface JurisdictionProvider {
  readonly country: ISO3166Alpha3;          // 'USA', 'GBR', 'AUS', 'NZL', 'CAN'
  readonly config: JurisdictionConfig;       // 24-slot mapping

  /** Download + transform boundaries into normalized districts */
  ingestBoundaries(options: IngestOptions): AsyncGenerator<NormalizedDistrict>;

  /** Download + transform officials into unified schema */
  ingestOfficials(db: Database): Promise<IngestResult>;

  /** Encode a geographic unit ID as a BN254 field element */
  encodeCellId(unitId: string): bigint;

  /** Map a district code to the correct jurisdiction slot */
  classifyDistrict(code: string): { slot: number; geoid: bigint };
}

interface IngestOptions {
  layers: string[];            // Country-specific layer codes
  year?: number;               // Vintage year
  outputDir: string;           // Where to write GeoJSON intermediates
  onProgress?: (msg: string) => void;
}

interface IngestResult {
  country: string;
  recordsInserted: number;
  recordsUpdated: number;
  source: string;
  license: string;
  vintage: string;
}
```

**Existing implementations:**
- `USJurisdictionProvider` — wraps TIGER + congress-legislators
- `CAJurisdictionProvider` — wraps StatCan + Represent API

**New implementations needed:**
- `GBJurisdictionProvider` — ONS Open Geography Portal + TheyWorkForYou
- `AUJurisdictionProvider` — ABS ASGS + APH
- `NZJurisdictionProvider` — Stats NZ Datafinder + Parliament NZ

### 2A. UK Provider — ONS Open Geography Portal

**Data sources (all OGL v3.0, free):**

| Dataset | Source | Records | API |
|---------|--------|---------|-----|
| Westminster constituencies | ONS ArcGIS REST | 650 | YES — GeoJSON query endpoint |
| Electoral wards | ONS ArcGIS REST | ~8,800 | YES |
| Local authority districts | ONS ArcGIS REST | ~380 | YES |
| MPs | TheyWorkForYou API or Parliament UK API | 650 | YES — JSON REST |

**ArcGIS REST query pattern (same as existing ArcGIS scraper):**
```
https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/
  Westminster_Parliamentary_Constituencies_July_2024_Boundaries_UK_BFC/
  FeatureServer/0/query?where=1%3D1&outSR=4326&f=geojson&resultOffset=0&resultRecordCount=100
```

**Jurisdiction config:**
```typescript
const GB_JURISDICTION: JurisdictionConfig = {
  country: 'GBR',
  slots: {
    0: { name: 'Westminster Constituency', required: true },
    1: { name: 'Country (England/Scotland/Wales/NI)', required: true },
    2: { name: 'Electoral Ward', required: false },
    3: { name: 'Local Authority District', required: false },
    // Scottish Parliament, Welsh Senedd in slots 4-5 if needed
  },
  recommendedDepth: 20,  // 650 + 8,800 wards → 2^20 = 1M
  encodeCellId: encodeUKCellId,  // ONS GSS codes (E14000XXX format)
};
```

**Officials source:** UK Parliament Members API
- `https://members-api.parliament.uk/api/Members/Search?IsCurrentMember=true&House=1`
- Returns JSON with name, party, constituency, contact details
- License: Open Parliament Licence (OPL)

### 2B. Australia Provider — ABS ASGS

**Data sources (all CC BY 4.0):**

| Dataset | Source | Records | API |
|---------|--------|---------|-----|
| Commonwealth electoral divisions | ABS ArcGIS REST | 151 | YES |
| State electoral divisions | ABS ArcGIS REST | ~550 | YES |
| Local government areas | ABS ArcGIS REST | ~550 | YES |
| Federal MPs + Senators | APH (aph.gov.au) | 227 | YES — XML/JSON |

**Jurisdiction config:**
```typescript
const AU_JURISDICTION: JurisdictionConfig = {
  country: 'AUS',
  slots: {
    0: { name: 'Commonwealth Electoral Division', required: true },
    1: { name: 'State/Territory', required: true },
    2: { name: 'State Electoral Division', required: false },
    3: { name: 'Local Government Area', required: false },
  },
  recommendedDepth: 18,  // 151 CED + 550 SED → 2^18 = 262K
  encodeCellId: encodeAUCellId,  // ABS SA1 codes or mesh block codes
};
```

### 2C. New Zealand Provider — Stats NZ Datafinder

**Data sources (all CC BY 4.0 NZ):**

| Dataset | Source | Records | API |
|---------|--------|---------|-----|
| General electorates | Stats NZ WFS | 65 | YES — WFS + ArcGIS |
| Maori electorates | Stats NZ WFS | 7 | YES |
| Territorial authorities | Stats NZ WFS | 67 | YES |
| MPs | NZ Parliament API | 120 | YES — JSON |

**Jurisdiction config:**
```typescript
const NZ_JURISDICTION: JurisdictionConfig = {
  country: 'NZL',
  slots: {
    0: { name: 'General/Maori Electorate', required: true },
    1: { name: 'Regional Council', required: true },
    2: { name: 'Territorial Authority', required: false },
  },
  recommendedDepth: 18,  // 72 electorates + 67 TAs → small tree
  encodeCellId: encodeNZCellId,  // Stats NZ area codes
};
```

---

## Phase 3: EU Statistical Coverage

### Eurostat GISCO + Nuts2json

**NOT electoral boundaries** — NUTS regions are statistical, not constituency-based.
But NUTS 3 + LAU provides municipal-level coverage (99K+ municipalities) which is
the building block for electoral districts in most EU countries.

**Data source:**
- Nuts2json (GitHub, CC BY 4.0): pre-built GeoJSON/TopoJSON files
- `https://raw.githubusercontent.com/eurostat/Nuts2json/master/pub/v2/2024/4326/20M/nutsrg_3.json`
- LAU municipalities: Eurostat download (CSV + shapefile)

**Jurisdiction config (generic EU template):**
```typescript
const EU_JURISDICTION: JurisdictionConfig = {
  country: 'EU',  // Special: multi-country container
  slots: {
    0: { name: 'NUTS 3 Region', required: true },
    1: { name: 'NUTS 2 Region', required: true },
    2: { name: 'NUTS 1 Region', required: false },
    3: { name: 'LAU Municipality', required: false },
  },
  recommendedDepth: 22,  // 99K+ LAU municipalities → 2^22 = 4M
  encodeCellId: encodeLAUCellId,  // LAU codes are alphanumeric
};
```

**Pragmatic note:** EU electoral coverage is per-country. Only Germany (299 Wahlkreise),
France (577 circonscriptions), and Spain (52 circumscriptions) have bulk GIS downloads.
For Phase 3, ingest NUTS/LAU as the spatial index and leave per-country electoral
refinement for Phase 4+.

---

## Phase 4: Automation + Freshness

### 4A. Quarterly batch refresh

**Trigger:** GitHub Actions cron (already has `shadow-atlas-quarterly` workflow placeholder)

**Pipeline:**
1. Download latest TIGER shapefiles (US) — January release
2. Download latest StatCan boundaries (CA) — per-Census
3. Download latest ONS boundaries (UK) — biannual
4. Download latest ABS boundaries (AU) — annual vintage
5. Download latest Stats NZ boundaries (NZ) — annual
6. Download latest Eurostat NUTS/LAU (EU) — annual
7. Transform all → NormalizedDistrict[]
8. Build R-tree index
9. Build Merkle tree (Tree 2)
10. Compare root with previous — if changed, commit on-chain
11. Tag snapshot with vintage label

### 4B. Freshness monitoring

**Per-country staleness thresholds:**
| Country | Max age | Refresh trigger |
|---------|---------|-----------------|
| USA | 365 days | After redistricting or new Congress |
| Canada | 365 days | After general election |
| UK | 180 days | After boundary review |
| Australia | 365 days | After redistribution |
| NZ | 365 days | After boundary review |
| EU | 365 days | After NUTS reclassification |

**Alerting:** Log warning when any country's data exceeds threshold.
`/v1/health` includes `data_freshness` object with per-country last-ingested timestamps.

---

## Implementation Order

```
Phase 1 (immediate, unblocks everything):
  1A. Fix Canadian MP regex           ~30 min code
  1B. Build US district DB            ~4 hours (download + transform)
  1C. Deploy Nominatim                ~6 hours (import)
  1D. Configure chain scanner         ~15 min config

Phase 2 (Five Eyes expansion):
  2A. UK provider                     ~1 day (best API, model for others)
  2B. Australia provider              ~1 day (same ArcGIS pattern as UK)
  2C. New Zealand provider            ~0.5 day (smallest dataset)

Phase 3 (EU):
  3A. Eurostat NUTS + LAU ingest      ~1 day

Phase 4 (automation):
  4A. Quarterly batch workflow         ~0.5 day
  4B. Freshness monitoring            ~0.5 day
```

**Total new code:** ~2,000 lines across 8-10 files (providers + scripts + tests)
**Total new data:** ~5 GB compressed (boundaries for Five Eyes + EU)
**Runtime cost:** $0 (all open government data, self-hosted Nominatim)

---

## Data Source Registry

| Country | Boundaries Source | License | Officials Source | License | API? |
|---------|------------------|---------|-----------------|---------|------|
| USA | Census TIGER/Line | Public domain | congress-legislators (GitHub) | CC0 | FTP bulk |
| Canada | StatCan Boundary Files | OGL-Canada | Represent API (Open North) | OGL-Canada | REST |
| UK | ONS Open Geography Portal | OGL v3.0 | UK Parliament Members API | OPL | ArcGIS REST |
| Australia | ABS ASGS | CC BY 4.0 | APH (aph.gov.au) | CC BY 4.0 | ArcGIS REST |
| New Zealand | Stats NZ Datafinder | CC BY 4.0 NZ | NZ Parliament | CC BY 4.0 NZ | WFS + REST |
| EU | Eurostat GISCO/Nuts2json | CC BY 4.0 | N/A (per-country) | Varies | File download |

**All licenses are free for non-commercial AND commercial use. Zero cost.**

---

## Architecture: One Pattern, Every Country

```
                    ┌─────────────────────────────┐
                    │    JurisdictionProvider      │
                    │  (interface — per country)   │
                    ├─────────────────────────────┤
                    │  ingestBoundaries()          │ → NormalizedDistrict[]
                    │  ingestOfficials()           │ → SQLite upsert
                    │  encodeCellId()              │ → bigint
                    │  classifyDistrict()          │ → { slot, geoid }
                    └──────────┬──────────────────┘
                               │
              ┌────────────────┼────────────────────┐
              │                │                     │
    ┌─────────▼──────┐  ┌─────▼──────┐  ┌──────────▼───────┐
    │ US Provider     │  │ UK Provider│  │ AU Provider      │
    │ (TIGER + CC0)   │  │ (ONS+Parl) │  │ (ABS + APH)      │
    └─────────┬──────┘  └─────┬──────┘  └──────────┬───────┘
              │                │                     │
              └────────────────┼────────────────────┘
                               │
                               ▼
                    ┌─────────────────────────────┐
                    │     Shared Pipeline          │
                    ├─────────────────────────────┤
                    │  RTreeBuilder.build()        │ → shadow-atlas.db
                    │  buildCellMapTree()          │ → Tree 2 SMT
                    │  DistrictLookupService       │ → /v1/lookup
                    │  OfficialsService            │ → /v1/officials
                    │  GeocodeService              │ → /v1/resolve-address
                    └─────────────────────────────┘
```

No country-specific code in the serving layer. All differentiation is in providers.
