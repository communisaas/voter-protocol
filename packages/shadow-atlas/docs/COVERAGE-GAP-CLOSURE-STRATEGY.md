# Coverage Gap Closure Strategy

**Status**: Wave-P Complete
**Created**: 2026-01-22
**Updated**: 2026-01-24
**Author**: Distinguished Engineer (Agentic Systems)

---

## Executive Summary

The shadow-atlas registry requires comprehensive coverage of US municipal council district boundaries. Serial agent waves targeting individual cities via web search are too slow due to rate limits. This document outlines a three-pronged parallel attack strategy to close the coverage gap efficiently.

**Phase 1 Infrastructure: COMPLETE** - All discovery capabilities integrated into production codebase.
**Phase 2 Extraction: COMPLETE** - All 4 active aggregators extracted, 115 net new cities discovered.
**Wave-P Parallel Swarm: COMPLETE** - 8 regional specialists, 24 net new cities added, 715 total portals.

---

## Wave-O Results (2026-01-24)

### Extraction Summary

| Aggregator | State | Features | Cities Extracted | Net New |
|------------|-------|----------|------------------|---------|
| NJGIN | NJ | 829 | 81 | 79 |
| MassGIS | MA | 2,256 | 39 | 16 |
| Cook County | IL | 169 | 22 | 20 |
| Maricopa County | AZ | 76 | 6 | 0 (all dupes) |
| **Total** | | **3,330** | **148** | **115** |

### Hub Discovery
- Datasets found: 220
- High-confidence candidates (≥70%): 24
- Ready for manual triage: `.shadow-atlas/wave-discovery/hub-discovery-candidates.ndjson`

### Notable New Cities
- Cambridge, MA (11 districts)
- Linden City, NJ (10 districts)
- Des Plaines, IL (8 districts)
- 79 New Jersey cities with ward-based governance

### Output Files
```
.shadow-atlas/wave-discovery/
├── wave-o-net-new-portals.ndjson       # 115 deduplicated entries ready for insertion
├── wave-o-consolidated-portals.ndjson  # All 148 extracted entries
├── hub-discovery-candidates.ndjson     # 24 Hub candidates for manual review
├── aggregator-njgin-nj-portals.ndjson  # NJ extractions
├── aggregator-massgis-ma-portals.ndjson # MA extractions
├── aggregator-cook-county-il-portals.ndjson # IL extractions
└── aggregator-maricopa-county-az-portals.ndjson # AZ extractions
```

---

## Wave-P Results (2026-01-24)

### Parallel Agent Swarm Summary

Wave-P deployed 8 regional extraction specialists in parallel to verify and extract from additional aggregators.

| Agent | Aggregator/Region | Cities Found | Net New | Notes |
|-------|-------------------|--------------|---------|-------|
| SANDAG-CA | San Diego County | 14 | 2 | Imperial Beach, National City |
| HGAC-TX | Houston-Galveston | 20 | 11 | Clute, El Campo, Freeport, etc. |
| TX-Major | Texas Major Cities | 5 | 0 | Austin, Dallas already in registry |
| PASDA-PA | Pennsylvania | 11 | 11 | Reading, York, Bethlehem, etc. |
| Washington | Seattle Metro | 3 | 0 | Seattle, Tacoma, Everett dupes |
| Florida | Individual Cities | 5 | 0 | All existing (Cape Coral needs URL fix) |
| Ohio | Individual Cities | 0 | 0 | No new discoveries |
| Oregon | Individual Cities | 3 | 0 | Portland, Eugene, Hillsboro dupes |
| **Total** | | **61** | **24** | |

### Notable Wave-P Discoveries

**California** (2 new):
- Imperial Beach (0636294) - 4 districts via SANDAG
- National City (0650398) - 4 districts via SANDAG

**Texas** (11 new):
- Clute, El Campo, Freeport, Hitchcock, Huntsville
- Iowa Colony, Katy, La Marque, Rosenberg, Texas City, Wharton

**Pennsylvania** (11 new):
- Reading (19 wards), York (11 wards), Bethlehem (4 wards)
- Dallastown, Fountain Hill, Hanover, Red Lion, Salisbury
- Slatington, West York, Wrightsville

### Wave-P Output Files
```
.shadow-atlas/wave-discovery/
├── wave-p-consolidated-portals.ndjson  # 24 deduplicated entries (merged)
├── aggregator-sandag-ca-portals.ndjson # CA extractions
├── aggregator-hgac-tx-portals.ndjson   # TX Houston area
├── aggregator-tx-major-portals.ndjson  # TX Major Cities
├── aggregator-pasda-pa-portals.ndjson  # PA PASDA extractions
├── aggregator-washington-portals.ndjson # WA portals
├── aggregator-florida-portals.ndjson   # FL verification (0 new)
├── aggregator-ohio-portals.ndjson      # OH verification (0 new)
└── aggregator-oregon-portals.ndjson    # OR verification (0 new)
```

---

## Current State Analysis

### Registry Metrics (as of 2026-01-24, Post Wave-P)
- **Known Portals**: 715 entries (cities with verified GIS endpoints)
- **Wave-O Merged**: 115 entries (completed)
- **Wave-P Merged**: 24 entries (completed)
- **At-Large Cities**: 77 entries (cities with at-large elections, no districts)
- **Quarantined**: 9 entries (pending remediation)
- **Total Covered**: ~801 cities (portals + at-large)

### Target Universe
- US incorporated places: ~19,500
- Cities with population > 25,000: ~1,800
- Cities with population > 10,000: ~4,500
- **Current coverage of cities >25k**: ~37%

### Bottleneck Analysis
Previous wave-based approaches (Wave-K, Wave-L, Wave-M) suffered from:
1. **Web search rate limits**: Agents hit API limits after 40-60 searches
2. **Serial discovery**: One city at a time is too slow
3. **Redundant research**: Multiple agents searching for same regional data
4. **Incomplete follow-through**: Hub IDs found but FeatureServer URLs not extracted

**Solution**: Three-pronged infrastructure now integrated into codebase.

---

## Infrastructure (Phase 1 Complete)

### New npm Scripts

```bash
# Prong 1: Aggregator Extraction
npm run discover:aggregators              # List all available aggregators
npm run discover:aggregator <id>          # Extract from specific aggregator
npm run discover:aggregator massgis-ma    # Example: MassGIS extraction

# Prong 2: Hub Discovery
npm run discover:hub                      # Programmatic Hub API search
npm run discover:hub -- --limit=200       # Limit results

# Prong 3: Gap Analysis
npm run discover:gaps                     # Analyze coverage gaps
```

### New Source Files

| File | Purpose |
|------|---------|
| `src/core/registry/regional-aggregators.ts` | Registry of 14 regional aggregators with configs |
| `src/services/bulk-district-discovery.ts` | Extended with `discoverFromHub()` and `extractFromAggregator()` |
| `src/scripts/wave-discovery.ts` | Unified CLI for all discovery operations |

### Aggregator Registry

```
npm run discover:aggregators

📊 Available Regional Aggregators

P0 (High Yield):
  🔍 scag-ca                   190 cities  Southern California (needs verification)
  🔍 florida-fgdl               50 cities  Florida statewide (needs verification)
  ✅ maricopa-county-az         25 cities  Maricopa County AZ (active)

P1 (Medium Yield):
  ✅ massgis-ma                 50 cities  Massachusetts statewide (active)
  ✅ njgin-nj                   40 cities  New Jersey statewide (active)
  🔍 pasda-pa                   50 cities  Pennsylvania (needs verification)
  🔍 nctcog-tx                  40 cities  Dallas-Fort Worth (needs verification)
  🔍 hgac-tx                    30 cities  Houston metro (needs verification)
  🔍 sandag-ca                  18 cities  San Diego County (needs verification)

P2 (Lower Yield):
  🔍 ohio-ogrip                 40 cities  Ohio statewide (needs verification)
  ✅ cook-county-il             30 cities  Chicago suburbs (active)
  🔍 maricopa-assoc-gov         20 cities  MAG (needs verification)
  🔍 king-county-wa             15 cities  Seattle area (needs verification)
  🔍 harris-county-tx           15 cities  Harris County TX (needs verification)

Total: 14 aggregators, 613 estimated cities
Active: 4 aggregators, 145 estimated cities
```

---

## Three-Pronged Parallel Attack Strategy

### Prong 1: Bulk Aggregator Extraction

**Principle**: Many regional/state GIS portals host data for dozens of cities. One successful extraction yields 10-50x the results of individual city searches.

#### Usage

```bash
# Extract from active aggregators (ready now)
npm run discover:aggregator maricopa-county-az
npm run discover:aggregator massgis-ma
npm run discover:aggregator njgin-nj
npm run discover:aggregator cook-county-il

# Output: .shadow-atlas/wave-discovery/aggregator-{id}-portals.ndjson
```

#### How It Works

```
1. Query aggregator endpoint for all features
2. Group features by city field (e.g., TOWN, MUNICIPALITY)
3. Count unique districts per city
4. Filter cities with >1 district (skip at-large)
5. Generate per-city download URLs with WHERE clauses
6. Output NDJSON ready for registry insertion
```

#### Aggregator Configuration Schema

```typescript
interface RegionalAggregator {
  id: string;                    // Unique identifier
  name: string;                  // Human-readable name
  states: string[];              // State codes covered
  priority: 'P0' | 'P1' | 'P2';  // Extraction priority
  estimatedCities: number;       // Expected yield
  endpointUrl: string;           // ArcGIS FeatureServer URL
  cityField: string;             // Field containing city name
  districtField: string;         // Field containing district ID
  status: 'active' | 'needs-verification' | 'deprecated';
}
```

---

### Prong 2: Programmatic Hub Discovery

**Principle**: The ArcGIS Hub API allows programmatic search across all public datasets. One API call can return hundreds of "council district" datasets without hitting web search rate limits.

#### Usage

```bash
npm run discover:hub
npm run discover:hub -- --limit=200

# Output:
#   .shadow-atlas/wave-discovery/hub-discovery-results.json
#   .shadow-atlas/wave-discovery/hub-discovery-candidates.ndjson
```

#### Search Terms (built-in)

```
- council districts
- city council districts
- ward boundaries
- aldermanic districts
- councilmanic districts
- commission districts
- municipal wards
```

#### Confidence Scoring

```
Base: 60 points

Positive signals:
  +25  "council district" in name
  +20  "city council" in name
  +15  "ward" in name
  +10  "boundary/boundaries" in name

Negative signals:
  -30  "school" in name
  -25  "police" or "fire" in name
  -20  "utility" in name
  -15  "water" or "sewer" in name

Threshold: >= 70 confidence for NDJSON output
```

---

### Prong 3: Census Gap Analysis

**Principle**: Instead of discovering randomly, generate the exact list of missing cities by population tier, then dispatch targeted resolution.

#### Usage

```bash
npm run discover:gaps

# Output: Coverage analysis with recommended actions
```

#### Current Gap Analysis

```
📊 Coverage Gap Analysis

Current registry: 575 portals

Aggregator Potential:
  Total: +613 cities
  Active only: +145 cities

📈 Target Metrics:
  Known Portals:     575 current → 800 target → 1000 stretch
  Coverage (>25k):   ~37% current → 60% target → 75% stretch

🎯 Recommended Actions:
  1. Extract from active aggregators first
  2. Run Hub discovery for additional datasets
  3. Verify and activate needs-verification aggregators
```

---

## Execution Plan

### Phase 1: Infrastructure ✅ COMPLETE

| Task | Status | Output |
|------|--------|--------|
| Create regional aggregator registry | ✅ Done | `src/core/registry/regional-aggregators.ts` |
| Extend BulkDistrictDiscovery with Hub/Aggregator | ✅ Done | `src/services/bulk-district-discovery.ts` |
| Create unified CLI | ✅ Done | `src/scripts/wave-discovery.ts` |
| Add npm scripts | ✅ Done | `discover:hub`, `discover:aggregator`, etc. |
| Verify build | ✅ Done | `npm run build` passes |

### Phase 2: Parallel Execution (READY)

#### Agent Swarm Configuration

```typescript
// Active aggregators - ready for immediate extraction
const ACTIVE_AGGREGATORS = [
  { command: 'npm run discover:aggregator maricopa-county-az', est_cities: 25 },
  { command: 'npm run discover:aggregator massgis-ma', est_cities: 50 },
  { command: 'npm run discover:aggregator njgin-nj', est_cities: 40 },
  { command: 'npm run discover:aggregator cook-county-il', est_cities: 30 },
];

// Hub discovery
const HUB_DISCOVERY = [
  { command: 'npm run discover:hub', est_datasets: 200 },
];

// Aggregators needing verification first
const NEEDS_VERIFICATION = [
  'scag-ca',        // 190 cities - HIGH PRIORITY to verify
  'florida-fgdl',   // 50 cities
  'pasda-pa',       // 50 cities
  'nctcog-tx',      // 40 cities
  'ohio-ogrip',     // 40 cities
  'hgac-tx',        // 30 cities
  'sandag-ca',      // 18 cities
];
```

#### Swarm Dispatch Pattern

```bash
# Dispatch parallel agents for active aggregators
# Each agent runs one command and outputs NDJSON

Agent 1: npm run discover:aggregator maricopa-county-az
Agent 2: npm run discover:aggregator massgis-ma
Agent 3: npm run discover:aggregator njgin-nj
Agent 4: npm run discover:aggregator cook-county-il
Agent 5: npm run discover:hub

# After completion, consolidate results:
cat .shadow-atlas/wave-discovery/*-portals.ndjson >> data/registries/staging.ndjson
```

### Phase 3: Consolidation

```bash
# 1. Collect all agent results
ls .shadow-atlas/wave-discovery/*-portals.ndjson

# 2. Deduplicate by FIPS code
# (NDJSON entries have _fips field for dedup)

# 3. Resolve FIPS codes for cities marked "NEEDS_LOOKUP"
# Use Census Gazetteer or TIGERweb API

# 4. Append to registry
cat staging.ndjson >> data/registries/known-portals.ndjson

# 5. Regenerate TypeScript
npm run registry:generate

# 6. Verify build
npm run build

# 7. Commit with changelog
git add data/registries/*.ndjson src/core/registry/*.generated.ts
git commit -m "feat(shadow-atlas): Wave-O bulk extraction results"
```

---

## Agent Prompt Templates

### Prong 1: Aggregator Verification Agent

```
You are verifying a regional GIS aggregator endpoint.

AGGREGATOR: {AGGREGATOR_ID}
ENDPOINT: {ENDPOINT_URL}

OBJECTIVE: Verify the endpoint is accessible and identify the correct layer.

STEPS:
1. Query the endpoint directly (WebFetch to {ENDPOINT}?f=json)
2. Identify the layer containing council/ward/district data
3. Verify the city field and district field names
4. Update the aggregator config if needed

OUTPUT: Updated aggregator config OR "VERIFIED" if config is correct
```

### Prong 2: Hub Dataset Resolution Agent

```
You are resolving Hub discovery candidates to registry entries.

CANDIDATES: {NDJSON_PATH}

For each candidate with confidence >= 70:
1. Query the FeatureServer URL for metadata
2. Identify the city/cities covered
3. Look up FIPS codes
4. Generate portal entries

OUTPUT: NDJSON entries ready for registry insertion
```

### Prong 3: Gap Resolution Agent

```
You are resolving coverage gaps for specific cities.

TARGET CITIES (by priority):
{CITY_LIST_WITH_FIPS}

For each city:
1. Check if city is covered by a known aggregator
2. Search for official open data portal
3. Search for county/regional GIS
4. If no GIS found, determine election structure:
   - At-large: Output at-large entry
   - District-based: Document as review-needed
   - Hybrid: Extract what's available

OUTPUT: JSON entries for portals OR at-large cities
```

---

## Success Metrics

| Metric | Wave-N End | Pre-Wave-O | Post-Wave-O | Post-Wave-P | Target | Stretch |
|--------|------------|------------|-------------|-------------|--------|---------|
| Known Portals | 519 | 574 | 689 | **715** (+24) | 800 | 1,000 |
| At-Large Cities | 70 | 77 | 77 | 77 | 150 | 200 |
| Coverage (>25k pop) | ~33% | ~37% | ~43% | **~45%** | 60% | 75% |
| Coverage (>100k pop) | ~50% | ~55% | ~60% | **~62%** | 90% | 95% |

**Wave-O Impact**: +115 cities, major NJ/MA/IL coverage boost.
**Wave-P Impact**: +24 cities, PA/TX expansion, 90% toward 800 target.

**State Coverage Highlights (Post Wave-P)**:
- CA: 109 cities (highest coverage)
- NJ: 91 cities
- TX: 55 cities
- MA: 40 cities
- IL: 36 cities
- WI: 29 cities
- FL: 27 cities
- GA: 26 cities
- OH: 26 cities
- PA: 18 cities (new focus area)

---

## Risk Mitigation

### Rate Limiting
- ✅ Prong 1 & 2 avoid web search entirely (query ArcGIS REST directly)
- Prong 3 agents should batch searches, pause between queries
- Use multiple agent instances to distribute load

### Data Quality
- All entries require feature count validation
- URLs must be tested before commit
- Suspicious counts (1, >50) flagged for review
- Aggregator extraction filters out single-district cities

### Deduplication
- Check FIPS before adding any entry
- Check URL patterns for known services
- Merge strategy: higher confidence wins
- NDJSON format preserves `_fips` for dedup

---

## Appendix A: FIPS Code Lookup

For cities without known FIPS:
1. Census Gazetteer: https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html
2. Format: SS (state) + PPPPP (place) = 7 digits
3. State codes: https://www.census.gov/library/reference/code-lists/ansi/ansi-codes-for-states.html

Example: Phoenix, AZ = 04 (AZ) + 55000 (Phoenix) = 0455000

---

## Appendix B: Architecture Integration

```
┌─────────────────────────────────────────────────────────────┐
│  EXISTING INFRASTRUCTURE                                    │
├─────────────────────────────────────────────────────────────┤
│  BulkDistrictDiscovery          CoverageAnalyzer            │
│  ├── discoverCity()             ├── analyzeCoverage()       │
│  ├── searchArcGISHub()          ├── getStaleData()          │
│  └── searchSocrata()            └── getBlockerAnalysis()    │
│                                                             │
│  ExpansionPlanner               BatchOrchestrator           │
│  └── createExpansionPlan()      └── orchestrateStates()     │
├─────────────────────────────────────────────────────────────┤
│  NEW INFRASTRUCTURE (Phase 1)                               │
├─────────────────────────────────────────────────────────────┤
│  BulkDistrictDiscovery          RegionalAggregators         │
│  ├── discoverFromHub()    <───> ├── REGIONAL_AGGREGATORS    │
│  └── extractFromAggregator()    ├── getAggregatorsByPriority│
│                                 └── buildCityDownloadUrl()  │
│                                                             │
│  wave-discovery.ts (CLI)                                    │
│  ├── hub      → discoverFromHub()                          │
│  ├── aggregator → extractFromAggregator()                  │
│  ├── aggregators → list all                                │
│  └── gaps     → coverage analysis                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Revision History

| Date | Author | Changes |
|------|--------|---------|
| 2026-01-22 | DE/Agentic | Initial strategy document |
| 2026-01-23 | DE/Agentic | Phase 1 infrastructure complete: `regional-aggregators.ts`, `bulk-district-discovery.ts` extensions, `wave-discovery.ts` CLI, npm scripts. Updated metrics to 575 portals, 77 at-large. |
| 2026-01-24 | DE/Agentic | Wave-O complete: 115 net new cities from NJGIN, MassGIS, Cook County, Maricopa. |
| 2026-01-24 | DE/Agentic | Wave-P complete: 8 parallel extraction agents, +24 net new cities (CA: 2, TX: 11, PA: 11). Registry now at 715 portals, 90% toward 800 target. |
