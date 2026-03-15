# Cell Map Implementation Research: Australia, Canada, New Zealand
**Date:** 2026-03-13
**Researcher:** intl-cellmap-research team
**Task:** Tree 2 (Cell-District Mapping) implementations for AU, CA, NZ statistical geography units

---

## Overview

This research document provides concrete implementation plans for building Tree 2 (Cell-District Mapping) in three Commonwealth countries. The tree builder (`buildCellMapTree()` in `/packages/shadow-atlas/src/tree-builder.ts`) is jurisdiction-agnostic and accepts `CellDistrictMapping[]` as input. Each country must implement a `buildCellMap()` method in its provider that transforms statistical geography units → electoral boundary mappings.

**Key Constants:**
- **24 district slots** (protocol constant, non-negotiable)
- **Tree interface**: `interface CellDistrictMapping { cellId: bigint; districts: bigint[] }`
- **Cell ID encoding**: Country-specific (defined in `jurisdiction.ts`)
- **Unused slots**: MUST be `0n`

---

## Australia: SA1 → Commonwealth Electoral Division

### Statistical Unit
**SA1 (Statistical Area Level 1)**
- ~62,000 geographic units nationwide
- 2021 ASGS edition (current, valid through June 2026)
- Finest granularity in Australian Bureau of Statistics hierarchy
- Designed for population-based analysis (avg. 200 people per SA1)

### Data Source Strategy

**Primary source:** ABS Correspondence Files (CC-BY-4.0)

The ABS publishes correspondence tables between geographic hierarchies. However, **SA1 → CED correspondence is NOT directly published**. Instead, the correspondence chain is:

1. **2021 SA1 code** → (via MB allocation) → **2021 Meshblock**
2. **2021 Meshblock** → (via MB-to-CED mapping) → **2024 CED** (latest available)

**Direct URLs:**
- Correspondences index: https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs-edition-3/jul2021-jun2026/access-and-downloads/correspondences
- Allocation files (SA1 to higher geographies): https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs-edition-3/jul2021-jun2026/access-and-downloads/allocation-files
- All correspondence files available in **CSV format**, machine-readable

**Expected file names:**
- `SA1_2021_AUST.xlsx` — SA1 allocation file (or `SA1_2021_<STATE>.xlsx` per state)
- `MB_2021_AUST.csv` — Meshblock allocation file
- `MB_2021_to_CED_2024.csv` — Meshblock to CED 2024 correspondence

### Coverage

| State | CED Count | Notes |
|-------|-----------|-------|
| NSW | ~48 divisions | First digit of CED code = 1 |
| VIC | ~37 divisions | 2xx |
| QLD | ~30 divisions | 3xx |
| SA | ~10 divisions | 4xx |
| WA | ~15 divisions | 5xx |
| TAS | ~5 divisions | 6xx |
| NT | ~2 divisions | 7xx |
| ACT | ~2 divisions | 8xx |
| **TOTAL** | **~151 divisions** | (2024 redistribution) |

**Filtering:** ABS CED data includes codes ≥900 (e.g., "No usual address", "Migratory") — these must be excluded.

### Cell ID Encoding

**Australian provider already configured in `jurisdiction.ts`:**

```typescript
readonly statisticalUnit: StatisticalUnitType = 'sa1';
```

Encoding should be:
- **SA1 code format**: "SSSSSLLL" (state digit + 6-char local code)
- **Encoding**: `BigInt(parseInt(sa1Code))` — numeric, direct conversion
- **Safe**: All SA1 codes are 8-digit numeric strings, well within BN254 bounds

Example: `"12345678"` → `12345678n`

### District Slot Mapping (AU)

Use same pattern as UK/US — map electoral hierarchy to slots:

| Slot | District Type | Source |
|------|---------------|--------|
| 0 | Federal Division (CED) | ABS/AEC |
| 1 | State/Territory | ABS ASGS (SA1 attrib) |
| 2-23 | UNUSED | Leave as 0n |

**Estimated coverage:**
- Slot 0 (Federal): 151 CEDs
- Slot 1 (State): 8 states/territories

### Implementation Steps

1. **Fetch SA1 allocation file** → extract state code, SA1 code
2. **Build SA1 → MB mapping** (intermediate, via allocation file)
3. **Fetch MB → CED 2024 correspondence** → map meshblocks to electoral divisions
4. **Join SA1 → MB → CED** for each SA1
5. **Aggregate CEDs per SA1** (handle split SAs via weighting or plurality logic)
6. **Populate slots**:
   - Slot 0: CED code (integer)
   - Slot 1: State code (1-8)
   - Slots 2-23: 0n
7. **Cache to `data/country-cache/au/`** (CSVs: SA1, CED mapping, stats)
8. **Build cell map tree** via `buildCellMapTree()`

### Edge Cases

- **Split SA1s**: Some SA1s may span multiple CEDs. Strategy:
  - Use **population weighting** if available in ABS data
  - Otherwise, **assign plurality** (largest overlapping CED)
  - Document in log

- **Census year**: SA1 2021 boundaries may not align exactly with CED 2024 (redistribution). Expect ~95-98% coverage.

- **ACT/NT**: Fewer divisions (2 each). Ensure all CEDs present in final output.

### Tree Depth Estimate

- **62,000 SA1s** → recommend `depth: 18` (capacity 2^18 = 262K)
- Matches `AU_JURISDICTION.recommendedDepth` if defined, or default 20

---

## Canada: DA → Federal Electoral District (2023 Representation Order)

### Statistical Unit
**Dissemination Area (DA)**
- ~56,000 geographic units nationally
- DA Unique IDentifier (DAUID): "PR" + "CD" + "DA" (5 digits total)
- Based on 2021 Census, updated with **2023 Representation Order** (343 ridings)
- Designed for census-level aggregation

### Data Source Strategy

**Primary source:** Statistics Canada geographic concordance files

Statistics Canada **automatically respects FED boundaries** when creating dissemination blocks and DAs. Per the Census of Population documentation (2021 Census), dissemination block boundaries were required to respect federal electoral districts (FEDs), census subdivisions, and census tracts.

**Direct URLs:**
- Federal Electoral Districts (2023 RO): https://open.canada.ca/data/en/dataset/18bf3ea7-1940-46ec-af52-9ba3f77ed708
- Statistics Canada Census Profile (2023 RO): https://www150.statcan.gc.ca/n1/en/catalogue/98-401-X2021029
- Federal Electoral District Boundary Files: https://www150.statcan.gc.ca/n1/en/catalogue/92-171-X

**Expected sources:**
- Census Profile data by FED (2023 RO) — includes DA-to-FED mapping via census geographies
- Geographic Conversion Files (if available as direct download)
- Geospatial FeatureServer endpoints (ArcGIS-based, StatCan geo services)

**Search via Statistics Canada portal:**
- https://www12.statcan.gc.ca/datasets/Index-eng.cfm
- Query: "Dissemination Area" + "2023 Representation Order" or "Federal Electoral District"

### Coverage

| Province/Territory | FED Count | DA Count (estimated) |
|-------------------|-----------|---------------------|
| ON | ~121 ridings | ~15,000 DAs |
| QC | ~78 ridings | ~11,000 DAs |
| BC | ~43 ridings | ~6,000 DAs |
| AB | ~34 ridings | ~4,500 DAs |
| MB | ~14 ridings | ~1,500 DAs |
| SK | ~14 ridings | ~1,200 DAs |
| NS | ~11 ridings | ~800 DAs |
| NB | ~10 ridings | ~650 DAs |
| NL | ~7 ridings | ~450 DAs |
| PE | ~4 ridings | ~250 DAs |
| NT, NU, YT | ~4 ridings | ~600 DAs (sparse) |
| **TOTAL** | **343 ridings** | **~56,000 DAs** |

### Cell ID Encoding

**Canadian provider in `jurisdiction.ts`:**

```typescript
function encodeCanadaCellId(unitId: string): bigint {
  const numeric = unitId.replace(/\D/g, '');
  return BigInt(numeric);
}
```

**DA DAUID format:** "2021A00XXXXX" (vintage + type + numeric code)
- After removing non-digits: numeric string (~14 digits)
- Direct `BigInt()` conversion safe

Example: `"2021A0013001"` → `20210013001n`

### District Slot Mapping (CA)

Based on `CA_JURISDICTION` in `jurisdiction.ts`:

| Slot | District Type | Source |
|------|---------------|--------|
| 0 | Federal Electoral District (Riding) | StatCan/Elections Canada |
| 1 | Province/Territory | StatCan (DA attributes) |
| 2-23 | UNUSED (Phase B2+ reserved) | 0n |

**Estimated coverage:**
- Slot 0 (Ridings): 343 FEDs
- Slot 1 (Province): 13 provinces/territories

### Implementation Steps

1. **Fetch FED 2023 boundary dataset** (from open.canada.ca or StatCan)
2. **Build FED → code mapping** (FEDUID or riding code)
3. **Access Census Profile or concordance file** → DA-to-FED mapping
   - If direct concordance unavailable, use Census geographies (DA is subunit of CSD/CT, CSD maps to FED)
4. **For each DA:**
   - Extract DAUID, calculate numeric cell ID
   - Resolve FED code from concordance
   - Extract province from DA code (PR digit = first 2 chars of DAUID)
5. **Handle split DAs** (rare):
   - If DA spans multiple FEDs, assign to **largest FED by population**
   - Document in validation log
6. **Populate slots**:
   - Slot 0: FED code (integer)
   - Slot 1: Province code (10-48 from StatCan)
   - Slots 2-23: 0n
7. **Cache to `data/country-cache/ca/`**
8. **Build cell map tree**

### Edge Cases

- **Split DAs**: Some DAs may be fragmented across FEDs (StatCan aligns boundaries, but imperfect).
  - Strategy: **Population-weighted assignment** or **plurality**
  - Flag in validation report

- **2023 RO timing**: 2023 RO boundaries are newer than 2021 Census. Expect ~98-99% DA coverage.

- **Territory sparse data**: NT/NU/YT have very few DAs per FED (wide geographic area, low population). Verify coverage is complete.

### Tree Depth Estimate

- **56,000 DAs** → recommend `depth: 18` (capacity 2^18 = 262K)
- Matches `CA_JURISDICTION.recommendedDepth = 18`

---

## New Zealand: Meshblock → Electorate (2025 Boundaries)

### Statistical Units
**Meshblock (MB)**
- ~57,500 geographic units nationwide (2023 meshblock edition)
- Smallest geographic unit in Stats NZ hierarchy
- Used as building blocks for all other geographies (electoral, census, statistical)

**Dual electoral coverage:**
- **General Electorates**: 64 (2025 boundary review, finalized August 2024)
- **Māori Electorates**: 7 (same meshblock boundaries)
- Meshblocks can be assigned to BOTH general AND Māori electorates

### Data Source Strategy

**Primary source:** Stats NZ Datafinder (CC-BY-4.0)

**Direct URLs:**
- 2025 Meshblock Higher Geographies: https://datafinder.stats.govt.nz/document/25678-2023-census-electoral-population-at-meshblock-level-2025-meshblock-lookup-table/
- Electorate data: https://datafinder.stats.govt.nz/data/category/electorates/?s=n
- Geographic hierarchies: Meshblock Higher Geographies 2025 — includes meshblock → electorate mappings

**Expected file names:**
- `mb2023_lookup_2025.csv` — Meshblock 2023 with 2025 electorate assignments
- `nz-gned-2025.csv` or similar — General electorate 2025 boundaries
- `nz-maori-2025.csv` — Māori electorate 2025 boundaries

**Key note:** Meshblock boundaries are maintained by Stats NZ and **coincide exactly with electoral boundaries**. The CSV file includes both general and Māori electorate codes per meshblock.

### Coverage

| Electorate Type | Count | Meshblock Count |
|-----------------|-------|-----------------|
| General Electorates | 64 | ~57,000 (majority) |
| Māori Electorates | 7 | ~3,000-5,000 (overlap) |
| List MPs (no electorate) | ~51 | N/A (excluded from cell map) |
| **TOTAL** | 72 MPs | ~57,500 MBs |

**Dual coverage:** A single meshblock can be assigned to:
- Its general electorate (e.g., "Wairarapa") AND
- Its Māori electorate (e.g., "Te Tai Tonga")

For the cell map, use **plurality logic** or create **two mappings** (one per elector type) if the protocol allows.

### Cell ID Encoding

**NZ provider in `jurisdiction.ts`** (to be defined):

Suggested encoding:
```typescript
function encodeNZCellId(mbCode: string): bigint {
  // Meshblock format: "XXXXXXX" (7 numeric digits)
  if (/^\d+$/.test(mbCode)) {
    return BigInt(mbCode);
  }
  // Fallback: UTF-8 byte packing
  const bytes = Buffer.from(mbCode, 'utf-8');
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
}
```

**Meshblock code format:** "XXXXXXX" (7 digits) or with region prefix (e.g., "mb-XXXXXXX")
- Safe: Direct numeric conversion
- Range: 0-9,999,999 well within BN254 bounds

### District Slot Mapping (NZ)

Suggested mapping (to be confirmed):

| Slot | District Type | Source |
|------|---------------|--------|
| 0 | General Electorate | Stats NZ 2025 |
| 1 | Māori Electorate (if assigned) | Stats NZ 2025 |
| 2 | Regional Council | Stats NZ (future) |
| 3 | Territorial Authority | Stats NZ |
| 4-23 | UNUSED | 0n |

**Estimated coverage:**
- Slot 0 (General): 64 electorates
- Slot 1 (Māori): 7 electorates (sparse, ~50% of MBs)
- Slot 3 (TA): 67 territorial authorities

### Implementation Steps

1. **Fetch 2025 Meshblock Higher Geographies lookup** from Stats NZ Datafinder
2. **Parse CSV** → extract meshblock code, general electorate code, Māori electorate code (if present)
3. **For each meshblock:**
   - Calculate cell ID via `encodeNZCellId(mbCode)`
   - Resolve general electorate code
   - Resolve Māori electorate code (if present, else use 0n)
   - (Optional) Resolve TA code for slot 3
4. **Handle dual coverage:**
   - If meshblock has both general & Māori, populate slots 0 & 1
   - If general only, populate slot 0, leave slot 1 as 0n
   - For List MPs (no electorate assigned), skip entirely
5. **Populate slots**:
   - Slot 0: General electorate code
   - Slot 1: Māori electorate code (or 0n)
   - Slot 2: 0n (reserved)
   - Slot 3: TA code
   - Slots 4-23: 0n
6. **Cache to `data/country-cache/nz/`**
7. **Build cell map tree**

### Edge Cases

- **Dual electorate assignment**: Meshblocks on boundaries between Māori electorates are assigned to the one with largest population share.
  - Verify via Stats NZ documentation which meshblock gets which assignment
  - Slot 1 is sparse: ~50% of meshblocks have non-zero Māori code

- **2025 redistribution timing**: General electorates were finalized in August 2024, with boundary names and codes effective from December 2024 onward.
  - Meshblock lookup file (2025 edition) should reflect this
  - Expect ~100% coverage (all MBs assigned to both general & Māori, or general only)

- **List MPs**: ~51 MPs have no specific electorate (allocated by proportional representation). These should **NOT** appear in the cell map (no geographic unit).
  - Filter them out during hydration

### Tree Depth Estimate

- **~57,500 meshblocks** → recommend `depth: 18` (capacity 2^18 = 262K, leaves room for growth)
- New jurisdiction config needed

---

## Cross-Country Implementation Pattern

### Shared Architecture

All three countries follow the same pattern:

```typescript
// In country-provider.ts
async buildCellMap(boundaries: Boundary[]): Promise<CellMapResult> {
  // 1. Fetch statistical geography data from authoritative source
  const statsData = await this.fetchStatisticalGeographies();

  // 2. Fetch electoral boundaries
  const electoralBoundaries = await this.fetchElectoralBoundaries();

  // 3. Build cell → electoral mapping (jurisdiction-specific)
  const cellMappings = await this.buildCellDistrictMappings(
    statsData,
    electoralBoundaries,
    boundaries  // For validation
  );

  // 4. Populate all 24 slots (jurisdiction-defined semantics)
  for (const mapping of cellMappings) {
    // Ensure exactly 24 slots, unused = 0n
    mapping.districts.length === 24 || throw Error(...);
  }

  // 5. Cache to disk
  await this.cacheCellMappings(cellMappings);

  // 6. Build and return tree
  const treeResult = await buildCellMapTree(cellMappings, depth);
  return {
    mappings: cellMappings,
    tree: treeResult,
    stats: { cellCount: cellMappings.length, ... }
  };
}
```

### Data Loading Strategy

All three countries should:

1. **Check local cache first** (`data/country-cache/{ISO}/`)
2. **If cache miss**, fetch from source
3. **Parse and validate** (row counts, required columns)
4. **Transform to CellDistrictMapping[]**
5. **Write cache** for next run
6. **Build tree**

### Validation Checklist

For each country implementation:

- [ ] Source URLs confirmed and accessible
- [ ] CSV format verified (column names, delimiters)
- [ ] Row count matches expected geographic unit count (±1-2% tolerance)
- [ ] Cell ID encoding produces valid bigints (< BN254 modulus)
- [ ] All 24 slots present (even if 23 are 0n)
- [ ] No duplicate cell IDs
- [ ] No orphaned electoral boundaries (all used by at least one cell)
- [ ] Cache write/read cycle works
- [ ] Tree depth recommendation appropriate for unit count
- [ ] Smoke test: `buildCellMapTree()` completes without error

---

## Implementation Priority & Dependencies

### Phase 1 (Immediate)
1. **Australia**: SA1 concordance complexity is medium; good starting point
   - Search for pre-computed SA1→CED correspondence (may exist on data.gov.au)
   - If not, implement SA1→MB→CED chain

2. **Canada**: Simplest correspondence structure
   - FED boundaries already canonical and stable (2023 RO)
   - DA-FED mapping likely already published via StatCan

3. **New Zealand**: Straightforward (MB lookup table is canonical)
   - Single CSV file, dual-coverage handled
   - Māori electorate population weighting documented

### Phase 2 (Deferred to Wave 3B)
- UK cell maps (188K output areas) — separate research task #5
- Provincial/territorial layers for CA/AU (future phases)
- Advanced district types (school boards, etc.)

---

## Key Questions for Implementation

1. **Statistical unit versioning**: Use 2021 (AU/CA) or 2023/2025 (NZ) edition? Recommended to use **latest available** aligned with electoral boundaries.

2. **Dual electorate handling (NZ)**: Should we create **two CellDistrictMapping entries** per Māori-assigned MB (one for general, one for Māori)? Or populate both slots 0 & 1?
   - **Recommendation**: Populate both slots (0 & 1) to preserve single cell ID.

3. **Split geographic units**: When a statistical unit (SA1, DA, MB) spans multiple electoral boundaries:
   - **Plurality** (assign to largest): Simpler, faster
   - **Population-weighted**: More accurate, requires additional data
   - **Recommendation**: Start with **plurality**, document in validation

4. **Cache format**: Store as CSV (easy inspection) or binary (faster load)?
   - **Recommendation**: CSV for initial implementations, migrate to binary if performance needed

5. **Tree depth**: Use formula `2 ** depth >= cellCount * 2` (to avoid saturating tree)?
   - **Recommendation**: Use jurisdiction-recommended depth + 1 if cellCount approaches 80% capacity

---

## Reference URLs

### Australia
- ABS ASGS Correspondences: https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs-edition-3/jul2021-jun2026/access-and-downloads/correspondences
- ABS Allocation Files: https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs-edition-3/jul2021-jun2026/access-and-downloads/allocation-files
- AEC Electoral Commission: https://www.aec.gov.au/electorates/maps.htm

### Canada
- Open Canada FED 2023: https://open.canada.ca/data/en/dataset/18bf3ea7-1940-46ec-af52-9ba3f77ed708
- Statistics Canada Census Profile 2023 RO: https://www150.statcan.gc.ca/n1/en/catalogue/98-401-X2021029
- StatCan FED Boundary Files: https://www150.statcan.gc.ca/n1/en/catalogue/92-171-X

### New Zealand
- Stats NZ Datafinder Electorates: https://datafinder.stats.govt.nz/data/category/electorates/?s=n
- 2025 Meshblock Lookup: https://datafinder.stats.govt.nz/document/25678-2023-census-electoral-population-at-meshblock-level-2025-meshblock-lookup-table/
- Meshblock Higher Geographies 2025: (via Datafinder search)

---

## Notes & Assumptions

1. **No published concordances exist** for AU (SA1→CED). Intermediate mapping via meshblocks is standard practice in ABS workflows.

2. **Canada's StatCan** automatically enforces FED boundaries in DA creation. This means **DA-to-FED mapping is inherent** in DA code structure or via census geography files.

3. **New Zealand's meshblock system** is the most mature. Stats NZ publishes a single authoritative lookup table that includes all electoral assignments.

4. **All data is public and CC-licensed** (CC-BY-4.0, OGL-CA, etc.), suitable for protocol use.

5. **Tree depth recommendations** are conservative. Jurisdictions can use smaller depths if performance is critical (e.g., depth=16 for NZ).

6. **No protocol recompilation needed** — 24 slots are fixed. Each country uses a subset, leaving others as 0n.
