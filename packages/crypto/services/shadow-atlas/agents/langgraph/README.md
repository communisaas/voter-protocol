# Distinguished Agentic Boundary Discovery

A **true agentic system** for autonomous ward/district boundary discovery across all US states.

## What Makes This "Agentic"?

Unlike simple sequential pipelines, this system uses **ReAct (Reasoning + Acting)** pattern where agents:

1. **Reason** about which tools to use based on context
2. **Act** by calling tools autonomously
3. **Observe** results and adapt strategy
4. **Iterate** until goal is achieved

The agents have **full context** about:
- Authority hierarchy (City > County > State > Hub)
- Known state GIS portals and patterns
- Previous discoveries and failures
- Semantic layer validation rules

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       LEAD DISCOVERY AGENT                               │
│  Context:                                                               │
│  - State/region to discover                                             │
│  - Census roster of all incorporated places                             │
│  - Known GIS portal patterns                                            │
│  - Authority hierarchy knowledge                                        │
│                                                                         │
│  Strategy:                                                              │
│  1. Get Census roster (authoritative place list)                        │
│  2. Classify governance (ward vs at-large)                              │
│  3. Search using authority hierarchy                                    │
│  4. Validate and save discoveries                                       │
└─────────────────────────────────────────────────────────────────────────┘
                              │
           ┌──────────────────┼──────────────────┐
           ▼                  ▼                  ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│   ROSTER AGENT   │ │ GOVERNANCE AGENT │ │  DISCOVERY AGENT │
│                  │ │                  │ │                  │
│  Tools:          │ │  Tools:          │ │  Tools:          │
│  - Census API    │ │  - Governance    │ │  - City portal   │
│  - State FIPS    │ │    research      │ │  - County portal │
│                  │ │  - Population    │ │  - State MSDI    │
│                  │ │    heuristics    │ │  - ArcGIS Hub    │
│                  │ │                  │ │  - Layer probe   │
│  Context:        │ │  Context:        │ │  Context:        │
│  - 19,495 US     │ │  - Pop < 5K =    │ │  - Authority     │
│    places        │ │    at-large      │ │    tiers 1-4     │
│  - GEOID, pop,   │ │  - Pop > 50K =   │ │  - Known portal  │
│    place type    │ │    likely wards  │ │    patterns      │
└──────────────────┘ └──────────────────┘ └──────────────────┘
                              │
                              ▼
                  ┌──────────────────────┐
                  │  VALIDATION AGENT    │
                  │                      │
                  │  Tools:              │
                  │  - Schema validation │
                  │  - Point-in-polygon  │
                  │  - Save discovery    │
                  │                      │
                  │  Context:            │
                  │  - Expected feature  │
                  │    counts            │
                  │  - Geometry type     │
                  │    requirements      │
                  │  - Confidence        │
                  │    scoring           │
                  └──────────────────────┘
```

## Agent Tools

### 1. Census & Roster Tools
```python
get_census_places(state_fips, min_population)
# Returns all incorporated places from Census TIGERweb
# This is the AUTHORITATIVE source for place roster

get_state_fips(state_abbrev)
# Converts "MT" → "30"
```

### 2. Governance Research Tools
```python
research_city_governance(city, state, population)
# Determines ward-based vs at-large elections
# Uses population heuristics + web research signals
#
# Heuristics:
# - Pop < 2,500: Usually at-large town board
# - Pop < 10,000: Likely at-large, needs verification
# - Pop > 50,000: Usually ward-based
# - State capitals: Often ward-based
```

### 3. Authority-Based Discovery Tools
```python
# TIER 1: City GIS (highest authority)
search_city_gis_portal(city, state, boundary_type)
# Searches common patterns:
# - gis.cityof{city}.org
# - maps.{city}{state}.gov
# - {city}.maps.arcgis.com

# TIER 2: County GIS
search_county_gis_portal(city, state, county)
# Counties often host city data

# TIER 3: State GIS (often most efficient!)
search_state_gis_portal(state, boundary_type)
# State MSDI/SDI often has statewide ward layers
# One query can cover ALL cities

# TIER 4: ArcGIS Hub (fallback)
search_arcgis_hub(query, location, max_results)
# Needs validation - not authoritative
```

### 4. Validation Tools
```python
probe_arcgis_service(url)
# Discovers available layers in a GIS service
# Scores layers by relevance keywords

validate_boundary_layer(url, expected_features, test_point)
# Validates:
# - URL returns 200 OK
# - Valid GeoJSON with features
# - Polygon/MultiPolygon geometry
# - Feature count matches expected
# Returns confidence score 0-100

test_point_in_boundary(layer_url, lat, lon, expected_ward)
# Verifies known coordinates fall in correct boundary
# Catches outdated or incorrect data
```

### 5. Memory & Persistence Tools
```python
save_discovery(city, state, boundary_type, url, authority_tier, ...)
# Saves validated discovery to registry

get_discovery(city, state, boundary_type)
# Checks if we've already discovered this city

list_discoveries(state)
# Lists all discoveries for progress tracking
```

## Authority Hierarchy

The **key innovation** is respecting authority hierarchy:

| Tier | Source | Authority | Example |
|------|--------|-----------|---------|
| 1 | City GIS | Highest | gis.cityofmissoula.com |
| 2 | County GIS | High | yellowstonecounty.maps.arcgis.com |
| 3 | State GIS | Medium | Montana MSDI |
| 4 | ArcGIS Hub | Lowest | hub.arcgis.com results |

**Why this matters:**
- City GIS data is maintained by the jurisdiction itself
- Lower authority sources may be outdated or incorrect
- Automated validators can reject good data from lower tiers
- Authority-based overrides are sometimes necessary

## State GIS Registry

We maintain a pre-compiled registry of 50 state GIS portals:

```python
from state_gis_registry import get_state_portal, get_statewide_source

# Get Montana's state portal
portal = get_state_portal("MT")
# → StateGISPortal(name="Montana State Library MSDI",
#                  url="https://geoinfo.msl.mt.gov/",
#                  has_ward_data=True)

# Check for statewide source
source = get_statewide_source("MT")
# → KnownBoundarySource(coverage="statewide", ...)
```

**States with known statewide ward data:**
- Montana (MSDI)
- Wisconsin (LTSB)
- Massachusetts (MassGIS)
- DC (Open Data)

## Quick Start

```bash
cd packages/crypto/services/shadow-atlas/agents/langgraph

# Create virtual environment (Python 3.13)
python3.13 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Set up API keys in .env file
echo 'GEMINI_KEYS=proj1:key1:free,proj2:key2:free' > .env

# Start Phoenix observability dashboard (optional but recommended)
python -m phoenix.server.main serve &
# Dashboard: http://localhost:6006

# Discover boundaries for Montana
python agent.py --state MT

# Limit to 10 cities (for testing)
python agent.py --state MT --max-cities 10

# Or use the launcher script (starts Phoenix automatically)
./run.sh --state MT --max-cities 10
```

## Observability with Phoenix

**Phoenix by Arize AI** provides 100% free, unlimited, fully local tracing:

- **Dashboard**: http://localhost:6006 (after starting server)
- **Features**: Full OpenTelemetry traces, latency analysis, token usage, tool calls
- **Zero cost**: No cloud account required, unlimited traces, runs entirely locally

All LangGraph agent calls are automatically instrumented. View:
- Agent reasoning steps (ReAct loop)
- Tool calls with inputs/outputs
- LLM invocations with token counts
- Error traces and retry attempts
- Latency breakdown per operation

To disable tracing:
```bash
export PHOENIX_ENABLED=false
```

## How Montana Achieved 100% Coverage

The Montana discovery succeeded because:

1. **Census roster** identified exactly 127 incorporated places
2. **Governance classification** narrowed to 8 ward-based cities
3. **State GIS portal** (Montana MSDI) had statewide data for Havre, Laurel, Anaconda
4. **City/County portals** covered Missoula, Billings, Great Falls, Kalispell
5. **Authority override** approved Belgrade's "Voting_Wards_view" (city authority)

**Automated discovery peaked at 50-70%** because:
- Belgrade's layer name triggered false negative
- State portal wasn't searched early enough
- No authority hierarchy in naive search

**Authority-based discovery achieved 100%** by:
- Searching state portal FIRST (got 3 cities in one query)
- Respecting city authority over keyword patterns
- Human judgment for edge cases

## Replicating for All 50 States

The same infrastructure exists nationwide:

```python
# For each state:
# 1. Get Census roster
places = await get_census_places(state_fips, min_population=2500)

# 2. Check state GIS first (most efficient!)
state_portal = get_state_portal(state_abbrev)
if state_portal.has_ward_data:
    # One query might cover entire state!
    probe_state_portal(state_portal.arcgis_rest_url)

# 3. Search city/county for remaining
for city in ward_cities:
    await hierarchical_search(city, state)

# 4. Validate all discoveries
for discovery in discoveries:
    await validate_boundary_layer(discovery.url)
```

## Expected Coverage by State Size

| State Size | Examples | Est. Ward Cities | Est. Coverage |
|------------|----------|------------------|---------------|
| Small | MT, WY, VT | 5-15 | 90-100% |
| Medium | OH, NC, WA | 30-60 | 80-90% |
| Large | CA, TX, NY | 100-200 | 70-85% |

**Bottleneck for large states**: Manual verification of governance types

## Files

```
langgraph/
├── README.md               # This file
├── requirements.txt        # Python dependencies
├── .env.example            # Configuration template
├── key_pool.py             # Multi-project API key rotation
├── state.py                # Workflow state schema
├── tools.py                # 15 specialized GIS discovery tools
├── agent.py                # True ReAct agentic system
├── state_gis_registry.py   # 50 state GIS portal registry
└── workflow.py             # Simple sequential workflow (deprecated)
```

## Comparison: Pipeline vs Agent

| Aspect | Simple Pipeline | True Agent |
|--------|-----------------|------------|
| Tool selection | Hardcoded sequence | LLM decides |
| Error recovery | Retry same approach | Try alternative |
| Context | None | Full authority knowledge |
| Adaptation | None | Learns from failures |
| Edge cases | Fails | Human-like reasoning |
| Montana coverage | 50-70% | 100% |

The agent achieves distinguished results because it **reasons** about the problem, not just executes steps.
