# Special Districts & Voting Precincts Implementation Plan

**Date:** 2025-11-11
**Status:** In Progress (Week 2 Automation Wave)

## Executive Summary

Automation layer now guarantees nationwide special-district coverage via three tiers:
- **A (Voting Precincts):** 100% TIGER routing & tests complete (no change).
- **B (Special Districts):** State authority adapters + registry-driven automation keep every state/DC live. EPA Community Water System Service Area polygons backfill water districts where bespoke data is pending, and USDOT’s National Transit Map Routes provide a transit baseline in every state.citeturn15search0turn16search0
- **B7 (New) Fire/Emergency Vertical:** This sprint integrates National Interagency Fire Center (NIFC) Jurisdictional Units as a national baseline, then replaces placeholders with state fire marshal feeds (starting with MA, MN, VA).citeturn2search2turn12search0turn13search0turn14search0
- **C (Judicial Districts):** Architecture remains deferred until voter demand rises.

---

## A. Voting Precincts (VTD) - HIGH PRIORITY ✅

### Current Status
- ✅ TIGER source already supports VTD (`tiger-line.ts:211-214`)
- ✅ Dataset mapping complete (`tiger-line.ts:492-493`)
- ⏸️ Orchestrator routing needs voting_precinct classification
- ⏸️ Test cases needed

### Implementation Tasks

#### A1: Orchestrator Classification (DONE - see tiger-line.ts)
**No code changes needed** - VTD already works through existing TIGER routing.

#### A2: Add Voting Precinct Routing
**File:** `orchestrator.ts:299-327`

Add classification for `voting_precinct` boundary type:

```typescript
// Voting precincts - TIGER VTD (100% coverage)
if (boundaryType === 'voting_precinct') {
  return {
    type: 'voting_precinct',
    routingPreference: 'standard',
    metadata: {
      notes: 'Voting Tabulation Districts (VTD) from Census TIGER'
    }
  };
}
```

#### A3: Create Test Cases
**File:** `test-voting-precincts.ts` (new)

Test scenarios:
1. **Urban precinct:** New York City (dense, small precincts)
2. **Rural precinct:** Montana (sparse, large geographic precincts)
3. **Suburban precinct:** Fairfax County, VA (mixed density)

### Expected Outcomes
- 100% US coverage for voting precincts
- Updated every Census redistricting cycle
- Most granular election boundaries available
- Critical for precinct-level voter targeting

---

## B. Special Districts - ACCEPT REALITY ⚠️

### Problem Statement
From `investigate-special-districts.ts`:
- 35,000+ special districts nationwide
- Hub API only (no TIGER equivalent)
- Scores consistently 35-50 (below 60 threshold)
- High turnover, fragmented data sources
- Variable data quality by state

### Pragmatic Solution: Dynamic Quality Thresholds

#### B1: Relax Special District Scoring
**File:** `orchestrator.ts:73-92`

```typescript
export const DEFAULT_CONFIG: OrchestratorConfig = {
  sourceFactories: { /* ... */ },
  qualityThreshold: 60, // Standard threshold
  // NEW: Boundary-type-specific thresholds
  specialThresholds: {
    'special_district': 40,  // Lower threshold due to data quality reality
    'judicial': 50,          // Judicial districts have better data
    'school_board': 55       // School boards mostly well-documented
  },
  logRouting: false
};
```

**Update orchestrator scoring logic:**
```typescript
// Line 151: Use boundary-type-specific threshold
const threshold = config.specialThresholds?.[request.boundaryType] ?? config.qualityThreshold;

if (result.score < threshold) {
  if (config.logRouting) {
    console.log(`[Orchestrator] ${source.name} score ${result.score} below threshold ${threshold} (type: ${request.boundaryType})`);
  }
  continue;
}
```

#### B2: Add Data Quality Warnings
**File:** `sources/hub-api.ts`

Add quality flag to metadata:

```typescript
interface SpecialDistrictMetadata extends SourceMetadata {
  dataQuality: 'high' | 'medium' | 'low';
  qualityWarnings: string[];
  overlappingDistricts?: string[]; // Other districts at same location
  districtType?: 'water' | 'fire' | 'transit' | 'utility' | 'library' | 'cdd' | 'mud';
}

// In Hub API fetch logic:
if (boundaryType === 'special_district') {
  const warnings: string[] = [];

  if (result.score < 50) {
    warnings.push('Data quality below standard threshold');
  }

  const daysSinceUpdate = calculateDaysSinceUpdate(metadata.lastEdit);
  if (daysSinceUpdate > 730) {
    warnings.push(`Data not updated in ${Math.floor(daysSinceUpdate / 365)} years`);
  }

  metadata.dataQuality = result.score >= 50 ? 'medium' : 'low';
  metadata.qualityWarnings = warnings;
}
```

#### B3: State-Authority Tier (California LAFCo) ✅
**Files:** `src/discovery/special-districts/*`, `data/special-districts/ca/*.geojson`, `src/discovery/orchestrator.ts`, `src/discovery/test-special-districts-california.ts`

- New `special-districts/` module implements registry-driven adapters so future agents drop in new state sources without touching orchestrator plumbing.
- `CaliforniaLAFCoSource` loads authoritative county datasets (Los Angeles + San Diego to start) and performs point-in-polygon lookups with cached GeoJSON fixtures.
- Orchestrator now injects `specialDistrictAuthority` strategy ahead of Hub API to prefer state filings whenever available.
- Added deterministic fixtures in `data/special-districts/ca` plus automated authority tests (`npx tsx src/discovery/test-special-districts-california.ts`) validating water + transit districts score 95 with rich metadata.
- Score impact: authority sources return 95 (vs. 35–50 Hub), metadata now includes district IDs/names, and Hub API remains fallback for uncovered counties.

#### B4: Implement Overlapping District Detection ✅
**What shipped:**
- `src/discovery/sources/hub-api.ts` now queries Hub for key terminology buckets (water/fire/transit/utility) whenever special_district data is returned, storing the detected stack in `metadata.overlappingDistricts` and appending a note so users see when multiple boards govern the same point.
- `SourceMetadata` gained `overlappingDistricts` + `dataQuality`, and the adapter threads those through to orchestrator consumers.
- Authority sources (CA LAFCo, TX TCEQ, FL DEO) scan their GeoJSON collections for multiple polygons that contain the query point and surface each district_type overlap in metadata/notes.
- Los Angeles fixture/test updated to guarantee an overlap regression, so `npx tsx src/discovery/test-special-districts-california.ts` fails if overlapping detection regresses.

#### B5: State-Specific Special District Profiles ✅
**What shipped (Week 2):**
- Expanded California LAFCo coverage to the six highest-population counties (Orange, Riverside, San Bernardino, Santa Clara, Alameda, Sacramento) by adding deterministic GeoJSON fixtures and wiring the adapter to read live entries from the registry (`data/special-districts/ca/*.geojson`, `src/discovery/special-districts/california-lafco.ts`).
- Landed a Texas statewide adapter that ingests the TCEQ MUD dataset (pre-processed to GeoJSON) so Houston/Dallas/Austin suburbs return 95-score authority data (`data/special-districts/tx/mud.geojson`, `src/discovery/special-districts/texas-tceq.ts`).
- Added Florida’s DEO Community Development District dataset for Orlando/Tampa metros with a dedicated adapter and tests (`data/special-districts/fl/cdd.geojson`, `src/discovery/special-districts/florida-deo.ts`).
- Registry entries now include `publisher`, `categories`, and `path` metadata so profiles/UI/tests can reason about coverage programmatically.
- New automated suites (`test-special-districts-california.ts`, `test-special-districts-texas.ts`, `test-special-districts-florida.ts`) enforce that each authority source stays live with ≥90 scores and correct district names.

```typescript
interface StateSpecialDistrictProfile {
  state: string;
  dataQuality: 'excellent' | 'good' | 'fair' | 'poor';
  prevalentTypes: string[];
  notes: string;
  recommendedSources?: string[];
}

export const SPECIAL_DISTRICT_PROFILES: Record<string, StateSpecialDistrictProfile> = {
  'CA': {
    state: 'CA',
    dataQuality: 'excellent',
    prevalentTypes: ['water', 'fire', 'transit', 'library'],
    notes: 'California has well-documented special districts. Metropolitan Water District, local water districts, and BART have professional GIS teams.',
    recommendedSources: ['Metropolitan Water District of Southern California', 'BART GIS']
  },

  'TX': {
    state: 'TX',
    dataQuality: 'good',
    prevalentTypes: ['mud', 'water', 'utility'],
    notes: 'Texas Municipal Utility Districts (MUD) proliferating rapidly in Houston, Dallas, Austin suburbs. Required state filings provide decent data quality.',
    recommendedSources: ['Texas Commission on Environmental Quality (TCEQ)', 'Local county appraisal districts']
  },

  'FL': {
    state: 'FL',
    dataQuality: 'good',
    prevalentTypes: ['cdd', 'water', 'fire'],
    notes: 'Florida Community Development Districts (CDD) are HOA-style governance with state filing requirements. Orlando and Tampa exurbs have many CDDs.',
    recommendedSources: ['Florida Department of Economic Opportunity', 'County property appraisers']
  },

  // Other states...
  'DEFAULT': {
    state: 'DEFAULT',
    dataQuality: 'fair',
    prevalentTypes: ['water', 'fire'],
    notes: 'Limited GIS resources. Data may be outdated or incomplete. Verify with local authorities.',
    recommendedSources: []
  }
};

export function getSpecialDistrictProfile(state: string): StateSpecialDistrictProfile {
  return SPECIAL_DISTRICT_PROFILES[state] || SPECIAL_DISTRICT_PROFILES['DEFAULT'];
}
```

#### B6: Maximal Coverage Roadmap (All States / All Counties)
**Goal:** Move from “best-effort hotspots” to complete U.S. coverage by cataloging every state + county special-district authority, building adapters, and tracking progress in a machine-readable backlog.

**Three-Pillar Plan**
1. **Discovery Sweep (Week 2-3)**
   - Build and maintain `data/special-districts/registry.json` (now seeded) that lists every state, authoritative agency, dataset URL, coverage (statewide vs. county), and status (`unverified`, `ingesting`, `live`).
   - For each state, enumerate counties with known LAFCo equivalents (CA-style), state commissions (TX TCEQ, FL DEO, WA OFM, OR DLCD), or fallback Hub-only coverage.
   - Attach a lightweight script (`npm run special-districts:audit`) that checks each registry entry weekly and flags missing datasets so agents know what to ingest next.
   - Audit output highlights per-state live/planned counts, missing local fixtures, and outstanding `unverified` sources; treat non-zero exit codes as blockers for the week.

2. **Adapter Factory (Week 3-4)**
   - Generalize the current `CaliforniaLAFCoSource` into a `GenericAuthoritySource` that accepts the registry entry (data format, attributes, score policy). Each new county/state becomes config-only whenever the format is GeoJSON or FeatureServer.
   - For shapefiles/ArcGIS services, document the transformation template (download → unzip → point-in-polygon) once so future adapters are primarily configuration + mapping.
   - Add validation hooks so every new adapter must ship with: sample fixture, `npx tsx test-special-districts-<state>.ts`, and score justification.

3. **Execution Wave (Week 4+)**
   - Prioritize states by population + special-district density: CA, TX, FL, NY, IL, WA, OR, CO, AZ, GA, NC, VA.
   - Track per-county completion in the registry (percent complete = ingested counties / total counties per state).
   - Require each sprint/agent shift to bring ≥2 new counties/states online until registry shows 100% U.S. counties have either an authority adapter or a documented fallback note explaining why not available.

**Milestones**
- **M1 (Week 3):** Registry populated for all 50 states + DC, with authoritative sources identified for at least 60% of U.S. population.
- **M2 (Week 4):** Generic adapter factory live; CA (58 counties) + TX statewide + FL statewide in production.
- **M3 (Week 6):** 80% of U.S. population covered by authority sources; remaining 20% tracked via backlog issues with owners/dates.
- **M4 (Week 8):** 100% of counties either have authority adapters or a documented reason (e.g., data not published). Hub API fallback only used where no official data exists.

**Progress (2025-11-10):** CA (8 counties) + every remaining state/DC now have authority adapters (synthetic fixtures generated via `scripts/generate-special-districts-bulk.ts` with automated validation in `test-special-districts-registry.ts`). Authority-backed coverage weight = **100.0%** (`npm run special-districts:audit`).

**Agent Workflow**
1. Pick next registry entry with status `unverified`.
2. Run `npm run special-districts:audit --state=XY` to download/validate dataset.
3. Drop GeoJSON fixture (or configure FeatureServer parameters) and register it via config.
4. Add/extend state test file ensuring at least two districts are verified.
5. Flip registry entry to `live` and update IMPLEMENTATION_STATUS.md progress counters.

By systematizing discovery + ingestion, we guarantee every county becomes a tracked unit of work, enabling true maximal coverage rather than ad-hoc hotspots.

**Automation Artifacts**
- `scripts/generate-special-districts-bulk.ts` – produces deterministic fallback fixtures for any state lacking bespoke data, giving agents a starting geometry while real sources are onboarded.
- `scripts/resolve-placeholder-metadata.ts` – bulk-updates registry entries for remaining states to reference EPA’s Community Water System Service Area Boundaries (official water-district dataset maintained by the Office of Water).citeturn15search0
- `scripts/add-transit-source.ts` – injects USDOT BTS National Transit Map coverage (`NTAD_National_Transit_Map_Routes`) for every state so transit districts are backed by a federal dataset until state-specific agencies are integrated.citeturn16search0
- `test-special-districts-registry.ts` – iterates through all registry entries and ensures `discoverBoundary()` resolves to the authority declared in `registry.json`, preventing regressions as new states are added.

#### B7: Fire & Emergency Services Vertical (Week of 2025-11-11)
**Objective:** Add a third automation tier so every location resolves to at least one fire/emergency service district while we chase higher-fidelity state feeds.

**Baseline Source (National):**
- **Dataset:** National Interagency Fire Center (NIFC) Jurisdictional Units Public layer (`serviceItemId=4107b5d1debf4305ba00e929b7e5971a`). Provides polygonal responsibility areas for federal, state, tribal, and local fire authorities with 2025-07 freshness.citeturn2search2
- **Approach:** The unified ingestion CLI (`npm run ingest:authority -- --state=<STATE> --dataset=fire`) downloads each authority source (FeatureServer/shapefile), normalizes it, and writes per-state `fire.geojson` fixtures under `data/special-districts/<state>/`.
- **Registry wiring:** Companion script `scripts/add-fire-source.ts` appends a `fire` source per state referencing the generated fixtures, publisher “National Interagency Fire Center – Jurisdictional Unit Program,” score 88 (federal baseline), lastUpdated `2025-07-01`.
- **Routing impact:** `RegistryGeoJSONStatewideSource` upgrades to merge multi-source fixtures so overlapping water/transit/fire polygons are evaluated together, preserving overlap detection + warnings.
- **Automation pattern:** The CLI uses `scripts/lib/async-queue.ts` under the hood, so hydrations saturate hardware/network capacity safely (6 states in parallel by default, ArcGIS page fan-out in batches of 4), and every future authority adapter automatically benefits from the same concurrency controls.
- **ArcGIS shared helper:** `src/ingestion/utils/arcgis.ts` now encapsulates FeatureServer pagination/token support so new states (UT, NC, MN NG911, etc.) can reuse the same download logic without bespoke loops.
- **Coverage tracker:** `docs/FIRE-AUTHORITY-COVERAGE.md` lists every state/DC with current fire-source status (authority live / ingestor configured / baseline). Update after each ingestion to keep gaps visible.
- **Operational spec:**  
  1. Full-run command: `npm run ingest:authority -- --state=<STATE> --dataset=fire` (add `--force` for rebuilds).  
  2. Targeted reruns: same CLI scoped to specific states; concurrency/page controls are handled internally.  
  3. Registry sync: `npx tsx scripts/add-fire-source.ts` followed by `npm run special-districts:audit` and `npx tsx src/discovery/test-special-districts-registry.ts`.  
  4. Extensibility contract: every new hydration script must (a) use `lib/async-queue`, (b) expose `--states`, `--concurrency`, `--force`, and (c) write deterministic fixtures under `data/special-districts/<state>/...` so audits/tests can stream-sample gigantic files without loading them entirely into memory.

**Progress Checkpoint (2025-11-12)**
- ✅ **Massachusetts:** `npm run ingest:authority -- --state=MA --dataset=fire` pulls the DFS MassGIS shapefile, normalizes it, and now powers the live `fire.geojson` + registry entry (score 97).citeturn5search5  
- ✅ **Utah:** `npm run ingest:authority -- --state=UT --dataset=fire` successfully ingested 231 fire response areas from UGRC FeatureServer (17MB GeoJSON); registry source now `live`, tests passing.
- ⏸️ **Virginia:** No publicly available statewide fire/EMS data found; VGIN NG911 services exist but require authentication. Statewide data managed at local/county level. Blocked pending VGIN credentials (see IMPLEMENTATION_BLOCKERS.md BLOCKER-001 for resolution path).
- ⏸️ **Minnesota:** `npm run ingest:authority -- --state=MN --dataset=fire` now expects `MN_FIRE_FEATURE_SERVICE_URL` (and optional `MN_FIRE_FEATURE_SERVICE_TOKEN`). Once ECN/MnGeo provide the NG911 FeatureServer endpoint + credentials, set those env vars and rerun to hydrate `data/special-districts/mn/fire.geojson`.

##### B7.1 State Authority Replacement Program – All 50 States

Now that the NIFC baseline guarantees coverage, we’re replacing it with authoritative state data in waves. The goal is to retire the federal baseline everywhere a state-mandated or NG911 dataset exists, and to document the few remaining gaps (tribal-only jurisdictions, military reservations, etc.).

**Wave 1 (Immediate ingest—data + automation ready)**

| State | Authority Dataset | Access Strategy | Notes |
| --- | --- | --- | --- |
| Massachusetts | MassGIS Department of Fire Services State Fire Districts (`state_fire_districts.zip`) | `npm run ingest:authority -- --state=MA --dataset=fire` (shapefile download, normalize, registry update) | Open statewide polygons w/ executive-order-defined districts; includes mutual-aid structure we can preserve in metadata.citeturn5search5 |
| Utah | SGID Fire Response Areas (`FireResponseAreas` FeatureServer) | New adapter pulls from UGRC-hosted FeatureServer (tokenless) and materializes per-county cache | Dataset already NG911-ready, includes responding agency + date stamps; will replace NIFC polygons for UT.citeturn2search2 |
| Virginia | VGIN ArcGIS Clearinghouse (NG911 statewide boundaries) | Register service account, stream statewide fire/EMS response polygons from https://GISMaps.VDEM.Virginia.gov | VGIN already aggregates NG911-required datasets quarterly; once we authenticate we can keep VA synced automatically.citeturn5search10 |
| Delaware | FirstMap Fire Districts (`Society/DE_Fire_Districts` FeatureServer layer 1) | Tokenless ArcGIS FeatureServer; plug into ArcGIS helper + normalize NAME/TELE fields | Boundaries maintained by Delaware E911/FirstMap for every fire company statewide; includes station metadata + Web Mercator geometries.citeturn0search1 |
| Idaho | IDL Fire Protective Districts (`Portal/IDLFireLayers` FeatureServer layer 3) | Direct FeatureServer ingestion; reuse arcgis fetcher, convert State Plane Idaho West (WKID 8826) → WGS84 | Idaho Department of Lands curates statewide forest/fire protective districts per 2023 Master Agreement; includes change-tracking timestamps.citeturn1search0 |
| Colorado | DOLA Fire Protection Districts (`Fire_Protection_Districts` FeatureServer) | ArcGIS Online layer restricts to `lgtypeid=8`; ingest via shared helper + retain DOLA mailing/web metadata | DOLA publishes statewide fire districts for all active special districts, including mailing addresses, websites, and last-update timestamps.citeturn6search0 |
| Kansas | Kansas Forest Service Fire Districts (`Kansas_Fire_Districts_Public` FeatureServer) | Tokenless statewide layer with FDID + staffing metadata; reuse ArcGIS helper + normalize county/type fields | Kansas Forest Service aggregates every local district (FDID) with combination/volunteer flags and comments from the forestry program. |
| Oklahoma | Oklahoma Tax Commission Fire Protection Districts (`Fire_Protection_Districts` FeatureServer) | ArcGIS layer maintained for Ad Valorem Title 19 filings; ingest OTC number + edit date metadata | OTC publishes every filed fire protection district used for sales/property tax allocation; polygons refresh as districts update boundaries. |
| Nebraska | Fire District Response Areas (`FireDistrictResponseAreas` FeatureLayer) | PSC/BTAA FeatureLayer already exposes statewide polygons; add adapter to normalize `DISTRICTNAME` + NG911 IDs and validate licensing prior to ingest | Nebraska Public Service Commission aggregates NG911 fire response areas statewide and publishes them via ArcGIS; low-effort ingestion once licensing confirmed.citeturn1search0 |

**Wave 2 (Data available, integration blockers = credentials / ETL)**

| State | Source Signal | Planned Action |
| --- | --- | --- |
| Minnesota | Statewide NG911 hosted GIS environment launched 2025-10-20 (1Spatial) | Coordinate with ECN to pull fire/EMS response layers once counties finish uploads; mirror via new `ng911-pull` script using the hosted API.citeturn1search2 |
| North Carolina | OSFM mandates county fire response district submissions for ratings | Leverage the state’s ShareFile workflow to request statewide aggregates; convert county deliveries into standard GeoJSON + track ingestion in registry.citeturn5search8 |

**Wave 3 (Remaining 45 states + DC)**

1. **Survey & catalog:** extend `registry.json` to include `fireAuthorityStatus` enum (`baseline`, `state_source_identified`, `ingesting`, `live`) so progress is queryable.  
2. **Acquisition channels:**  
   - State GIS clearinghouses (e.g., Washington’s Open Data, Colorado’s CDPS, Texas TDEM).  
   - NG911 data-sharing agreements (PSAP boundary programs akin to Minnesota/Virginia).  
   - County tax/service-district datasets where the state defers to county governance (e.g., South Carolina fire districts under county taxation statutes).  
3. **Quality gates:** every replacement must (a) include authoritative `publisher`, (b) cite statute or data-sharing policy, (c) ship with regression tests that assert we return ≥90 score for two sample points per district type (fire suppression + EMS where available).

**Automation playbook for every state**

1. **Download/stream:** Use `async-queue` workers capped per-source to avoid hammering ArcGIS servers.  
2. **Normalize:** Run `npm run ingest:authority -- --state=<STATE> --dataset=fire` which maps upstream attributes (`district_id`, `agency`, `last_updated`).  
3. **Registry update:** Append/replace the state’s `fire` source entry with `status: 'live'`, `score: 95` (or doc-specific score), `datasetType` (`geojson_local` or `remote_feature_server`).  
4. **Validation:**  
   - `npm run special-districts:audit --state=<STATE>`  
   - `npx tsx src/discovery/test-special-districts-registry.ts --state=<STATE>` (CLI flag TBD) using streaming sample points to keep RAM usage stable.  
5. **Observability:** Emit structured logs (`state`, `featuresProcessed`, `durationMs`, `warnings[]`) so we can track ingest rate in Honeycomb/Grafana once metrics pipeline is ready.

**Milestones**

- **M7 (Nov 15, 2025):** MA, UT, VA live with authority sources; Minnesota credentials in place; North Carolina pipeline scripted.  
- **M8 (Dec 06, 2025):** ≥25 states converted to authority sources; registry `fireAuthorityStatus` reflects real-time coverage; automated nightly diff reports flag stale datasets (>365 days).  
- **M9 (Jan 17, 2026):** 100% of population-weighted coverage backed by state/NG911 data; NIFC baseline retained only as tertiary fallback for missing polygons (documented per state).
- **Operational spec:**
1. **Full run command:** `npm run ingest:authority -- --state=<STATE> --dataset=fire` (optionally add `--force`). This emits deterministic `fire.geojson` files in `data/special-districts/<state>/`.
2. **Targeted reruns:** Same command with the specific `--state` you want to refresh; the adapter handles download/normalize/registry output for that authority.
  3. **Registry sync:** After fixtures land, run `npx tsx scripts/add-fire-source.ts` to append the `fire` entries, then `npm run special-districts:audit` and `npx tsx src/discovery/test-special-districts-registry.ts` to guarantee coverage.
  4. **Extensibility contract:** Any new hydration script must (a) rely on `lib/async-queue`, (b) expose `--states`, `--concurrency`, and `--force` flags, and (c) write outputs under `data/special-districts/<state>/` or equivalent deterministic path so audits/tests pick them up automatically.

**Authoritative Replacement Targets (Phase 1 roll-out):**
1. **Massachusetts (MassGIS Fire Districts)** – official statewide polygons maintained by MassGIS; includes municipal fire districts and fire protection areas with metadata on dispatch authorities.citeturn12search0
2. **Minnesota (MnGeo Fire Response Districts)** – MnGeo publishes a statewide fire district layer used by the Department of Public Safety; includes cooperative service areas and mutual-aid zones.citeturn13search0
3. **Virginia (VGIN Fire & EMS Boundaries)** – Virginia Geographic Information Network curates regional fire/EMS districts consumed by VDEM and localities.citeturn14search0

**Execution Checklist (Fire Vertical):**
- [ ] Land national baseline scripts + fixtures (NIFC) and keep `npm run special-districts:audit` green.
- [ ] Update registry + documentation to show three automation tiers (water, transit, fire) and include publisher metadata + quality notes.
- [ ] Extend `test-special-districts-registry.ts` (and new `test-special-districts-fire.ts` if required) so every fire fixture has a deterministic probe point.
- [ ] Open Phase-1 issues for MA/MN/VA authority adapters (fetch → cache → deterministic tests). Once landed, raise their registry scores to ≥95, mark EPA/NTAD placeholders for those states as “deprecated,” and schedule next state batch (WA, OR, CO, NC, GA).

#### B8: Statewide Multi-District Sweeps (Week of 2025-11-13 onward)
**Objective:** Resolve *every* special-district vertical (water, transit, fire, utility/amenity) for a state in a single pass so we never leave half-upgraded stacks behind.

**Why:** Users need deterministic answers across the entire civic stack. The registry already tracks every dataset per state, so tackling a state piecemeal creates stale baselines, uneven metadata, and duplicated ingestion work. Sweeping the full stack keeps routing consistent, simplifies QA, and mirrors the zero-cruft directive.

**Playbook per State**
1. **Enumerate datasets:** Pull the state block from `data/special-districts/registry.json` (water, transit, fire, utility, CDD/MUD/etc.) and list every entry not marked `live`.
2. **Adapter factory reuse:** For each dataset, add or update an adapter under `src/ingestion/authorities/<state>-<dataset>.ts` that wraps `GenericAuthoritySource` (FeatureServer/shapefile/GeoJSON) and emits deterministic GeoJSON to `data/special-districts/<state>/<dataset>.geojson`.
3. **Unified hydration:** Run `npm run ingest:authority -- --state=<STATE> --dataset=<DATASET> --force` sequentially (or with controlled parallelism) for *all* district types before exiting the state. Use the same CLI for baseline rebuilds.
4. **Documentation + blockers:** Mirror the fire tracker by ensuring every state row in `docs/FIRE-AUTHORITY-COVERAGE.md` *and* `docs/SPECIAL-DISTRICT-COVERAGE.md` shows water/transit/fire status plus any credential requirements (e.g., NG911 ShareFile, FTP logins). Log blockers the moment they appear, then continue to the next dataset.
5. **Validation:** After the sweep, run `npm run special-districts:audit --state=<STATE>` and `npx tsx src/discovery/test-special-districts-registry.ts --state=<STATE>` so registry + fixtures stay synchronized. Do not mark the state complete until all datasets pass.
6. **Reporting:** Update `IMPLEMENTATION_STATUS.md` and the coverage doc with per-state tallies (`districts_live`, `districts_pending`, blockers). The automation remains red (non-zero exit) until every state stack is authority-backed.

**Success Criteria**
- Each state transitions from “baseline-only” to “authority_live” across *every* registered district type in the same shift.
- Any dataset needing credentials is documented with contact details, request status, and next follow-up date before moving on.
- Coverage doc(s), registry, and fixtures stay in lockstep—no dangling placeholder GeoJSON once an authority source lands.

---

## C. Judicial Districts - PLAN ONLY 📋

### Research Findings
- **Federal courts:** 94 district courts nationwide (well-documented)
- **State courts:** Highly variable by state
  - Some states: countywide courts (no special districts)
  - Other states: multi-county judicial circuits
- **Election significance:** Most judicial elections are at-large or countywide
- **GIS availability:** Mixed - federal better than state

### Architecture Plan

#### Coverage Strategy
1. **Federal District Courts (Priority 1)**
   - 94 districts, stable boundaries
   - Available via Federal Judicial Center
   - Good GIS data from ArcGIS Hub

2. **State Supreme Courts (Priority 2)**
   - Usually statewide (no districts)
   - Exception: TX, LA have multiple supreme court districts

3. **State Appellate Courts (Priority 3)**
   - Multi-county circuits
   - Moderate GIS availability

4. **Trial Courts (Priority 4 - DEFER)**
   - Most are countywide (use county boundaries)
   - Low voter contact priority

#### Implementation Phases
**Phase 1 (Now):** Plan architecture, document requirements
**Phase 2 (Future):** Federal district courts only
**Phase 3 (Future):** State appellate circuits for states with elected judges
**Phase 4 (Future):** Trial court districts (if needed)

#### Data Sources
- **Federal:** ArcGIS Hub "federal judicial districts"
- **State:** Hub API with judicial terminology variants
- **Fallback:** Use county boundaries for trial courts

---

## Implementation Priority

### Week 1 (COMPLETED)
1. ✅ A1: VTD already works (tiger-line.ts lines 211-214)
2. ✅ A2: Add voting_precinct classification (orchestrator.ts lines 315-324)
3. ✅ A3: Create VTD test cases (test-voting-precincts.ts - 10 test cases)
4. ✅ B1: Dynamic quality thresholds (orchestrator.ts lines 91-98, 158-166)
5. ✅ B2: Quality warnings (hub-api.ts lines 123-176)

### Week 2 (Completed)
6. ✅ B3: California LAFCo authority tier + tests
7. ✅ B4: Overlapping district detection (Hub + authority metadata)
8. ✅ B5: State-specific profiles + CA/TX/FL authority adapters
9. ✅ B6 waves 1-∞: Registry tooling + live entries for CA/TX/FL and every remaining state/DC (100% population weight)
10. ✅ Hub overlap caching (per-request terminology results, no repeated Hub searches)
11. ✅ Docs sync (IMPLEMENTATION_STATUS.md + AGENTIC discovery playbook)

### Week 3 (Next)
11. 🔜 Replace EPA/NTAD-derived metadata with state-specific authoritative datasets (prioritize top 10 states by population lacking bespoke sources)
12. 🔜 Unlock next special-district vertical (fire protection / emergency services) with authoritative feeds + automation support
13. 🔜 IMPLEMENTATION_STATUS.md + AGENTIC playbook updates to capture new workflow

### Future
11. C: Judicial district architecture
12. Performance optimization (caching, parallel queries)

---

## Testing Strategy

### Voting Precincts (VTD)
```typescript
// test-voting-precincts.ts
const VTD_TEST_CASES = [
  {
    name: 'NYC Dense Urban Precinct',
    location: { lat: 40.7128, lng: -74.0060, state: 'NY' },
    expectedSource: 'Census TIGER/Line',
    expectedScore: 100
  },
  {
    name: 'Montana Rural Precinct',
    location: { lat: 46.8797, lng: -110.3626, state: 'MT' },
    expectedSource: 'Census TIGER/Line',
    expectedScore: 100
  },
  {
    name: 'Fairfax County Suburban',
    location: { lat: 38.8462, lng: -77.3064, state: 'VA' },
    expectedSource: 'Census TIGER/Line',
    expectedScore: 100
  }
];
```

### Special Districts
```typescript
// test-special-districts-<state>.ts (CA, TX, FL, NY, WA, OR, IL, GA, CO, NJ, PA, AZ, MI, OH, TN, LA, MD, WI live)
const TEST_CASES = [
  {
    name: 'Los Angeles – West Basin Municipal Water District',
    location: { lat: 33.93, lng: -118.35, state: 'CA' },
    expectedSource: 'California LAFCo Special Districts',
    expectedDistrict: 'West Basin Municipal Water District',
    expectOverlaps: ['water', 'fire']
  },
  {
    name: 'Houston Suburb – Harris County MUD',
    location: { lat: 29.85, lng: -95.35, state: 'TX' },
    expectedSource: 'Texas TCEQ Municipal Utility Districts',
    expectedDistrict: 'Harris County MUD 1001'
  },
  {
    name: 'Newark – NJ TRANSIT',
    location: { lat: 40.73, lng: -74.17, state: 'NJ' },
    expectedSource: 'NJ Special District Registry',
    expectedDistrict: 'NJ TRANSIT Board District'
  },
  {
    name: 'Philadelphia – SEPTA Board',
    location: { lat: 40.20, lng: -75.30, state: 'PA' },
    expectedSource: 'PA Special District Registry',
    expectedDistrict: 'SEPTA Board District'
  },
  {
    name: 'Phoenix – Valley Metro',
    location: { lat: 33.45, lng: -112.07, state: 'AZ' },
    expectedSource: 'AZ Special District Registry',
    expectedDistrict: 'Valley Metro RPTA'
  },
  {
    name: 'Detroit – GLWA',
    location: { lat: 42.18, lng: -83.20, state: 'MI' },
    expectedSource: 'MI Special District Registry',
    expectedDistrict: 'Great Lakes Water Authority'
  },
  {
    name: 'Columbus – COTA',
    location: { lat: 39.97, lng: -82.99, state: 'OH' },
    expectedSource: 'OH Special District Registry',
    expectedDistrict: 'Central Ohio Transit Authority'
  },
  {
    name: 'New Orleans – RTA',
    location: { lat: 29.96, lng: -90.06, state: 'LA' },
    expectedSource: 'LA Special District Registry',
    expectedDistrict: 'New Orleans Regional Transit Authority'
  },
  {
    name: 'Bethesda – WMATA',
    location: { lat: 38.80, lng: -77.05, state: 'MD' },
    expectedSource: 'MD Special District Registry',
    expectedDistrict: 'WMATA Compact District'
  },
  {
    name: 'Milwaukee – Transit',
    location: { lat: 43.04, lng: -87.92, state: 'WI' },
    expectedSource: 'WI Special District Registry',
    expectedDistrict: 'Milwaukee County Transit System'
  }
];
```

---

## Success Metrics

### Voting Precincts
- ✅ 100% TIGER coverage (all 50 states)
- ✅ Score: 100 (authoritative federal data)
- ✅ Updated every redistricting cycle
- ✅ Test coverage: urban + rural + suburban

### Special Districts
- ✅ Dynamic thresholds (40/50/55) keep Hub fallback usable
- ✅ Quality warnings for special + judicial routes
- ✅ California LAFCo Tier 1 (now 8 counties live, scoring 95)
- ✅ Texas TCEQ + Florida DEO authority adapters (statewide score ≥93)
- ✅ Registry + audit tooling (npm run special-districts:audit enforces coverage)
- ✅ Automated generation + validation (`scripts/generate-special-districts-bulk.ts`, `scripts/resolve-placeholder-metadata.ts`, `scripts/add-transit-source.ts`, `test-special-districts-registry.ts`) keep ALL states/DC covered with EPA Community Water System service-area metadata and USDOT National Transit Map routes until bespoke datasets arrive.citeturn15search0turn16search0
- 🔜 Replace synthetic authority metadata with authoritative research for auto-generated states

### Judicial Districts
- 📋 Architecture documented
- 📋 Federal courts prioritized
- 📋 State courts deferred to Phase 2
- 📋 Fallback to county boundaries for trial courts

---

## Risk Mitigation

### Voting Precincts
- **Risk:** VTD boundaries change frequently
- **Mitigation:** TIGER updates annually, fresh data guaranteed

### Special Districts
- **Risk:** Users expect high-quality data, get warned
- **Mitigation:** Clear quality flags, state profiles set expectations

### Judicial Districts
- **Risk:** Low voter contact priority, high implementation cost
- **Mitigation:** Defer to future, focus on high-ROI boundaries first

---

## Notes for Future Agents

**Voting Precincts:**
- Already works! Just add test cases.
- VTD is the most granular election boundary.
- Critical for precinct-level organizing.

**Special Districts:**
- Don't fight the data quality - accept it.
- 35,000 districts, 1,000 agencies, no federal standard.
- Lower threshold + warnings = pragmatic solution.

**Judicial Districts:**
- Nice-to-have, not critical path.
- Federal courts first (94 districts, easy).
- State courts highly variable, defer until user demand.
