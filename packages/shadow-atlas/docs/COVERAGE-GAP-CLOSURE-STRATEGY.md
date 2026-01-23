# Coverage Gap Closure Strategy

**Status**: Active
**Created**: 2026-01-22
**Author**: Distinguished Engineer (Agentic Systems)

## Executive Summary

The shadow-atlas registry requires comprehensive coverage of US municipal council district boundaries. Serial agent waves targeting individual cities via web search are too slow due to rate limits. This document outlines a three-pronged parallel attack strategy to close the coverage gap efficiently.

---

## Current State Analysis

### Registry Metrics (as of 2026-01-22)
- **Known Portals**: 519 entries (cities with verified GIS endpoints)
- **At-Large Cities**: 70 entries (cities with at-large elections, no districts)
- **Quarantined**: 9 entries (pending remediation)
- **Total Covered**: ~598 cities

### Target Universe
- US incorporated places: ~19,500
- Cities with population > 25,000: ~1,800
- Cities with population > 10,000: ~4,500
- **Current coverage of cities >25k**: ~33%

### Bottleneck Analysis
Previous wave-based approaches (Wave-K, Wave-L, Wave-M) suffered from:
1. **Web search rate limits**: Agents hit API limits after 40-60 searches
2. **Serial discovery**: One city at a time is too slow
3. **Redundant research**: Multiple agents searching for same regional data
4. **Incomplete follow-through**: Hub IDs found but FeatureServer URLs not extracted

---

## Three-Pronged Parallel Attack Strategy

### Prong 1: Bulk Aggregator Extraction

**Principle**: Many regional/state GIS portals host data for dozens of cities. One successful extraction yields 10-50x the results of individual city searches.

#### Priority Aggregators

| Aggregator | URL Pattern | Coverage | Est. Cities | Priority |
|------------|-------------|----------|-------------|----------|
| **Maricopa County (AZ)** | `services.arcgis.com/ykpntM6e3tHvzKRJ` | All Maricopa cities | 25+ | P0 |
| **SCAG (CA)** | Southern California Association of Governments | LA, Orange, Riverside, San Bernardino, Ventura, Imperial counties | 190+ | P0 |
| **SANDAG (CA)** | San Diego Association of Governments | San Diego County | 18 | P1 |
| **Florida FGDL** | Florida Geographic Data Library | Statewide | 50+ | P0 |
| **Texas TNRIS** | Texas Natural Resources Information System | Statewide | 40+ | P1 |
| **HGAC (TX)** | Houston-Galveston Area Council | Houston metro | 30+ | P1 |
| **NCTCOG (TX)** | North Central Texas COG | Dallas-Fort Worth metro | 40+ | P1 |
| **MassGIS (MA)** | Massachusetts GIS | Statewide | 50+ | P1 |
| **NJGIN (NJ)** | New Jersey GIS Network | Statewide | 40+ | P1 |
| **PennDOT/PASDA (PA)** | Pennsylvania Spatial Data Access | Statewide | 50+ | P1 |
| **Ohio OGRIP** | Ohio Geographically Referenced Info Program | Statewide | 40+ | P2 |
| **Illinois ISGS** | Illinois State Geological Survey | Statewide | 30+ | P2 |

#### Extraction Pattern
```
1. Query aggregator's ArcGIS REST services directory
2. Identify layers containing "council", "ward", "district", "aldermanic"
3. For each layer, extract:
   - Service URL
   - Feature count
   - Attribute schema (to identify city name field)
4. If multi-city layer, enumerate unique city values
5. Generate individual city portal entries with filtered queries
```

#### Example: Maricopa County Multi-City Layer
```
Base URL: https://services.arcgis.com/ykpntM6e3tHvzKRJ/arcgis/rest/services/Maricopa_County_City_Council_Districts/FeatureServer/0

Per-city query pattern:
?where=Juris%3D'{CITY_NAME}'&outFields=*&f=geojson

Known cities in layer: Buckeye, Surprise, Goodyear, Avondale, El Mirage, Litchfield Park, etc.
```

---

### Prong 2: Programmatic Hub Discovery

**Principle**: The ArcGIS Hub API allows programmatic search across all public datasets. One API call can return hundreds of "council district" datasets without hitting web search rate limits.

#### Hub Search API
```
Endpoint: https://hub.arcgis.com/api/v3/datasets
Parameters:
  - q: "council districts" OR "city council" OR "ward boundaries"
  - filter[type]: Feature Service
  - page[size]: 100
  - sort: -modified
```

#### Implementation Script
```typescript
// scripts/hub-discovery.ts
interface HubDataset {
  id: string;
  attributes: {
    name: string;
    url: string;
    owner: string;
    orgId: string;
    extent: { coordinates: number[][] };
    recordCount: number;
  };
}

async function discoverCouncilDistrictDatasets(): Promise<HubDataset[]> {
  const searchTerms = [
    'council districts',
    'city council districts',
    'ward boundaries',
    'aldermanic districts',
    'councilmanic districts',
    'commission districts'
  ];

  const results: HubDataset[] = [];

  for (const term of searchTerms) {
    const response = await fetch(
      `https://hub.arcgis.com/api/v3/datasets?` +
      `q=${encodeURIComponent(term)}&` +
      `filter[type]=Feature%20Service&` +
      `page[size]=100`
    );
    const data = await response.json();
    results.push(...data.data);
  }

  // Deduplicate by dataset ID
  return [...new Map(results.map(d => [d.id, d])).values()];
}
```

#### Processing Pipeline
```
1. Execute Hub API search for all relevant terms
2. Filter results to US-only (by extent or org location)
3. Cross-reference against existing registry (by service URL)
4. For new datasets:
   a. Query FeatureServer for metadata (feature count, fields)
   b. Identify city name from org name, dataset name, or attributes
   c. Look up FIPS code from city/state
   d. Generate portal entry
5. Batch insert new entries
```

---

### Prong 3: Census Gap Analysis

**Principle**: Instead of discovering randomly, generate the exact list of missing cities by population tier, then dispatch targeted resolution.

#### Data Sources
- **Census Bureau**: City population estimates (annual)
- **Census TIGER**: FIPS codes for all incorporated places
- **Existing Registry**: Cross-reference to identify gaps

#### Gap Analysis Query
```sql
-- Pseudocode for gap identification
SELECT
  place_fips,
  place_name,
  state_abbr,
  population_2020
FROM census_places
WHERE population_2020 > 25000
  AND place_fips NOT IN (
    SELECT _fips FROM known_portals
    UNION
    SELECT _fips FROM at_large_cities
    UNION
    SELECT _fips FROM quarantined_portals
  )
ORDER BY population_2020 DESC;
```

#### Population Tiers for Prioritization
| Tier | Population | Est. Count | Priority |
|------|------------|------------|----------|
| Tier 1 | > 100,000 | ~300 | P0 - Must have |
| Tier 2 | 50,000 - 100,000 | ~400 | P0 - Must have |
| Tier 3 | 25,000 - 50,000 | ~1,100 | P1 - Should have |
| Tier 4 | 10,000 - 25,000 | ~2,700 | P2 - Nice to have |

#### Agent Dispatch Pattern
```
For each gap city:
  1. Check if city is in a known aggregator region → delegate to Prong 1
  2. Search for "{city} {state} open data portal arcgis"
  3. Search for "{county} {state} GIS council districts"
  4. If no GIS found, research election structure:
     - At-large → add to at-large-cities.ndjson
     - District-based but no GIS → add to review-needed list
     - Hybrid → document structure, add districts if available
```

---

## Execution Plan

### Phase 1: Infrastructure (1 hour)
1. Create `scripts/hub-discovery.ts` for programmatic Hub search
2. Create `scripts/gap-analysis.ts` to identify missing cities
3. Create `data/census/places-25k.json` with target city list

### Phase 2: Parallel Execution (concurrent)

#### Agent Swarm Configuration
```typescript
const PRONG_1_AGENTS = [
  { id: 'agg-maricopa', target: 'Maricopa County AZ', est_cities: 25 },
  { id: 'agg-scag', target: 'SCAG Southern California', est_cities: 50 },
  { id: 'agg-florida', target: 'Florida FGDL', est_cities: 50 },
  { id: 'agg-texas-hgac', target: 'HGAC Houston', est_cities: 30 },
  { id: 'agg-texas-nctcog', target: 'NCTCOG Dallas', est_cities: 40 },
  { id: 'agg-mass', target: 'MassGIS', est_cities: 50 },
  { id: 'agg-nj', target: 'NJGIN', est_cities: 40 },
  { id: 'agg-pa', target: 'PASDA', est_cities: 50 },
  { id: 'agg-ohio', target: 'Ohio OGRIP', est_cities: 40 },
  { id: 'agg-illinois', target: 'Illinois ISGS', est_cities: 30 },
];

const PRONG_2_AGENTS = [
  { id: 'hub-discovery', target: 'ArcGIS Hub API search' },
];

const PRONG_3_AGENTS = [
  { id: 'gap-tier1', target: 'Cities > 100k missing', est_cities: 50 },
  { id: 'gap-tier2', target: 'Cities 50-100k missing', est_cities: 100 },
];
```

### Phase 3: Consolidation
1. Collect all agent results
2. Deduplicate by FIPS code
3. Validate URLs (batch ping test)
4. Bulk insert to registry
5. Regenerate TypeScript
6. Commit with comprehensive changelog

---

## Agent Prompt Templates

### Prong 1: Bulk Aggregator Agent
```
You are a GIS data extraction specialist. Your target is {AGGREGATOR_NAME}.

OBJECTIVE: Extract ALL city council district data from this regional aggregator.

STEPS:
1. Navigate to the ArcGIS REST services directory
2. Identify services containing council/ward/district data
3. For multi-city layers, enumerate all cities and their district counts
4. Generate download URLs for each city

OUTPUT FORMAT (one JSON object per city):
{
  "fips": "XXYYYYY",
  "cityName": "City Name",
  "state": "ST",
  "portalType": "regional-gis",
  "downloadUrl": "https://...",
  "featureCount": N,
  "confidence": 85,
  "notes": "Extracted from {AGGREGATOR_NAME}"
}

IMPORTANT: Do NOT use web search. Query the ArcGIS REST endpoints directly.
```

### Prong 2: Hub Discovery Agent
```
You are running programmatic discovery against ArcGIS Hub API.

OBJECTIVE: Find all public council district datasets not in our registry.

EXISTING REGISTRY FIPS (do not duplicate): {FIPS_LIST}

STEPS:
1. Query Hub API for council/ward/district datasets
2. Filter to US municipal data only
3. Extract FeatureServer URLs
4. Cross-reference against existing FIPS
5. For new cities, look up FIPS codes

OUTPUT: Same JSON format as Prong 1 agents
```

### Prong 3: Gap Resolution Agent
```
You are resolving coverage gaps for specific cities.

TARGET CITIES (by priority):
{CITY_LIST_WITH_FIPS}

For each city:
1. Search for official open data portal
2. Search for county/regional GIS that includes the city
3. If no GIS found, determine election structure:
   - At-large: Output at-large entry
   - District-based: Document as review-needed
   - Hybrid: Extract what's available

OUTPUT: JSON entries for portals OR at-large cities
```

---

## Success Metrics

| Metric | Current | Target | Stretch |
|--------|---------|--------|---------|
| Known Portals | 519 | 800 | 1,000 |
| At-Large Cities | 70 | 150 | 200 |
| Coverage (>25k pop) | 33% | 60% | 75% |
| Coverage (>100k pop) | ~50% | 90% | 95% |

---

## Risk Mitigation

### Rate Limiting
- Prong 1 & 2 avoid web search entirely
- Prong 3 agents should batch searches, pause between queries
- Use multiple agent instances to distribute load

### Data Quality
- All entries require feature count validation
- URLs must be tested before commit
- Suspicious counts (1, >50) flagged for review

### Deduplication
- Check FIPS before adding any entry
- Check URL patterns for known services
- Merge strategy: higher confidence wins

---

## Appendix: FIPS Code Lookup

For cities without known FIPS:
1. Census Gazetteer: https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html
2. Format: SS (state) + PPPPP (place) = 7 digits
3. State codes: https://www.census.gov/library/reference/code-lists/ansi/ansi-codes-for-states.html

Example: Phoenix, AZ = 04 (AZ) + 55000 (Phoenix) = 0455000

---

## Revision History

| Date | Author | Changes |
|------|--------|---------|
| 2026-01-22 | DE/Agentic | Initial strategy document |
