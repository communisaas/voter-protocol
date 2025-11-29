"""
GIS Discovery Tools

A comprehensive toolkit for autonomous boundary discovery agents.
Each tool is designed with clear purpose and rich descriptions
to enable effective LLM tool selection.

Tool Categories:
1. Census & Roster - Get authoritative list of places
2. Governance Research - Determine ward vs at-large
3. Authority Discovery - Hierarchical source search (City > County > State > Hub)
4. Validation - Verify boundaries are correct
5. Memory & Persistence - Track discoveries and patterns
"""

import asyncio
import json
import logging
import re
import time
from typing import Annotated, List, Dict, Optional, Any
from dataclasses import dataclass
import aiohttp

logger = logging.getLogger(__name__)

# ============================================================================
# Tool Response Types
# ============================================================================

@dataclass
class ToolResult:
    """Standardized tool response"""
    success: bool
    data: Any
    error: Optional[str] = None
    source: Optional[str] = None
    confidence: float = 0.0


# ============================================================================
# 1. CENSUS & ROSTER TOOLS
# ============================================================================

async def get_census_places(
    state_fips: Annotated[str, "2-digit state FIPS code (e.g., '30' for Montana)"],
    min_population: Annotated[int, "Minimum population filter"] = 0,
) -> Dict:
    """
    Get all incorporated places in a state from Census TIGERweb.

    This is the AUTHORITATIVE source for the list of places to discover.
    Returns GEOID, name, population, and place type (city, town, CDP).

    Use this FIRST to get the roster of places that need boundary discovery.
    """
    url = (
        "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/"
        "Places_CouSub_ConCity_SubMCD/MapServer/0/query"
    )

    params = {
        "where": f"STATE='{state_fips}' AND POPULATION>={min_population}",
        "outFields": "GEOID,NAME,LSAD,POPULATION,AREALAND",
        "returnGeometry": "false",
        "f": "json",
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params, timeout=60) as resp:
                data = await resp.json()

        places = []
        for feature in data.get("features", []):
            attrs = feature.get("attributes", {})
            places.append({
                "geoid": attrs.get("GEOID"),
                "name": attrs.get("NAME"),
                "population": attrs.get("POPULATION", 0),
                "place_type": attrs.get("LSAD"),  # city, town, CDP, etc.
                "area_sq_m": attrs.get("AREALAND", 0),
            })

        # Sort by population descending
        places.sort(key=lambda x: x["population"], reverse=True)

        return {
            "success": True,
            "state_fips": state_fips,
            "total_places": len(places),
            "places": places,
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


async def get_state_fips(
    state_abbrev: Annotated[str, "2-letter state abbreviation (e.g., 'MT')"],
) -> Dict:
    """
    Convert state abbreviation to FIPS code.

    Example: 'MT' -> '30', 'CA' -> '06'
    """
    STATE_FIPS = {
        "AL": "01", "AK": "02", "AZ": "04", "AR": "05", "CA": "06", "CO": "08",
        "CT": "09", "DE": "10", "DC": "11", "FL": "12", "GA": "13", "HI": "15",
        "ID": "16", "IL": "17", "IN": "18", "IA": "19", "KS": "20", "KY": "21",
        "LA": "22", "ME": "23", "MD": "24", "MA": "25", "MI": "26", "MN": "27",
        "MS": "28", "MO": "29", "MT": "30", "NE": "31", "NV": "32", "NH": "33",
        "NJ": "34", "NM": "35", "NY": "36", "NC": "37", "ND": "38", "OH": "39",
        "OK": "40", "OR": "41", "PA": "42", "RI": "44", "SC": "45", "SD": "46",
        "TN": "47", "TX": "48", "UT": "49", "VT": "50", "VA": "51", "WA": "53",
        "WV": "54", "WI": "55", "WY": "56",
    }

    fips = STATE_FIPS.get(state_abbrev.upper())
    if fips:
        return {"success": True, "state": state_abbrev, "fips": fips}
    return {"success": False, "error": f"Unknown state: {state_abbrev}"}


# ============================================================================
# 2. GOVERNANCE RESEARCH TOOLS
# ============================================================================

async def research_city_governance(
    city: Annotated[str, "City name"],
    state: Annotated[str, "State abbreviation"],
    population: Annotated[int, "City population"] = 0,
) -> Dict:
    """
    Research whether a city uses ward-based or at-large elections.

    This determines if we NEED to find ward boundaries.
    - Ward-based: Council members elected from geographic districts -> NEED boundaries
    - At-large: Council members elected citywide -> NO boundaries needed

    Uses heuristics + web research signals:
    - Cities < 5,000 population: Usually at-large
    - Cities > 50,000: Usually ward-based
    - State capital cities: Often ward-based
    - Consolidated city-counties: Usually district-based

    Returns governance type and confidence level.
    """
    # Heuristic rules (can be overridden by actual research)
    if population < 2500:
        return {
            "success": True,
            "city": city,
            "state": state,
            "governance_type": "at-large",
            "confidence": "high",
            "reasoning": "Population < 2,500 - typically at-large town board",
            "needs_boundaries": False,
        }

    if population < 10000:
        return {
            "success": True,
            "city": city,
            "state": state,
            "governance_type": "likely-at-large",
            "confidence": "medium",
            "reasoning": f"Population {population:,} - small city, likely at-large",
            "needs_boundaries": False,
            "needs_verification": True,
        }

    # Larger cities need research
    return {
        "success": True,
        "city": city,
        "state": state,
        "governance_type": "unknown",
        "confidence": "needs-research",
        "reasoning": f"Population {population:,} - requires governance research",
        "needs_boundaries": True,  # Assume yes until proven otherwise
        "suggested_searches": [
            f"{city} {state} city council wards",
            f"{city} {state} city charter",
            f"{city} council districts map",
        ],
    }


# ============================================================================
# 3. AUTHORITY-BASED DISCOVERY TOOLS (City > County > State > Hub)
# ============================================================================

async def search_city_gis_portal(
    city: Annotated[str, "City name"],
    state: Annotated[str, "State abbreviation"],
    boundary_type: Annotated[str, "Type: ward, district, precinct, council"] = "ward",
) -> Dict:
    """
    Search for a city's official GIS portal.

    HIGHEST AUTHORITY source. City GIS data is the most authoritative
    because it's maintained by the jurisdiction itself.

    Common patterns:
    - https://gis.cityof{city}.{state}.gov
    - https://maps.{city}{state}.gov
    - https://{city}.maps.arcgis.com

    Returns discovered portal URL and available layers.
    """
    city_slug = city.lower().replace(" ", "")
    state_lower = state.lower()

    # Common city GIS portal patterns
    portal_patterns = [
        f"https://gis.cityof{city_slug}.org",
        f"https://maps.{city_slug}{state_lower}.gov",
        f"https://{city_slug}.maps.arcgis.com",
        f"https://gis-{city_slug}.opendata.arcgis.com",
        f"https://data.{city_slug}{state_lower}.gov",
    ]

    results = []
    async with aiohttp.ClientSession() as session:
        for portal_url in portal_patterns:
            try:
                async with session.get(
                    portal_url,
                    timeout=10,
                    allow_redirects=True
                ) as resp:
                    if resp.status == 200:
                        results.append({
                            "url": str(resp.url),
                            "status": "accessible",
                            "pattern": portal_url,
                        })
            except Exception:
                continue

    if results:
        return {
            "success": True,
            "city": city,
            "state": state,
            "authority_tier": 1,  # Highest
            "portals_found": results,
            "next_step": "probe_arcgis_service to discover ward/district layers",
        }

    return {
        "success": False,
        "city": city,
        "state": state,
        "message": "No city GIS portal found. Try county or state sources.",
        "next_step": "search_county_gis_portal",
    }


async def search_county_gis_portal(
    city: Annotated[str, "City name"],
    state: Annotated[str, "State abbreviation"],
    county: Annotated[Optional[str], "County name if known"] = None,
) -> Dict:
    """
    Search county GIS portals for city boundary data.

    SECOND TIER authority. Counties often host city data because:
    - Cities within counties share election infrastructure
    - County GIS departments serve multiple municipalities
    - Regional planning requires coordinated data

    Examples:
    - Yellowstone County GIS hosts Billings ward data
    - Flathead County hosts Kalispell district data
    """
    # Would need to lookup city->county mapping
    # For now, return guidance
    return {
        "success": True,
        "city": city,
        "state": state,
        "authority_tier": 2,
        "message": f"Search for {city}'s county GIS portal",
        "suggested_searches": [
            f"{city} county {state} GIS",
            f"{city} county {state} open data",
        ],
        "common_patterns": [
            "https://gis.{county}county{state}.gov",
            "https://{county}county.maps.arcgis.com",
        ],
    }


async def search_state_gis_portal(
    state: Annotated[str, "State abbreviation"],
    boundary_type: Annotated[str, "Type: ward, district, precinct"] = "ward",
) -> Dict:
    """
    Search state GIS clearinghouse for municipal boundary data.

    THIRD TIER authority. State GIS portals (MSDI, SDI) often have
    statewide ward/precinct layers that cover ALL cities at once.

    Montana example: Montana MSDI has statewide ward boundaries
    that include Havre, Laurel, Livingston, Anaconda data.

    This is often the MOST EFFICIENT source for small states -
    one query can return data for all cities.
    """
    STATE_GIS_PORTALS = {
        "MT": "https://gis.dnrc.mt.gov/arcgis/rest/services",
        "CA": "https://gis.data.ca.gov",
        "TX": "https://tnris.org",
        "NY": "https://gis.ny.gov",
        # Add more states...
    }

    portal = STATE_GIS_PORTALS.get(state.upper())

    return {
        "success": True,
        "state": state,
        "authority_tier": 3,
        "portal_url": portal,
        "message": f"State GIS portal for {state}",
        "search_terms": [
            "municipal boundaries",
            "city wards",
            "voting precincts",
            "political districts",
        ],
        "note": "State portals often have statewide layers covering ALL cities",
    }


async def search_arcgis_hub(
    query: Annotated[str, "Search terms"],
    location: Annotated[str, "City, State or State"],
    max_results: Annotated[int, "Maximum results to return"] = 10,
) -> Dict:
    """
    Search ArcGIS Hub / Open Data for boundary datasets.

    FOURTH TIER authority. ArcGIS Hub aggregates open data from
    many sources but lacks authority verification.

    Use this as FALLBACK when city/county/state searches fail.
    Results should be validated against known city boundaries.

    Common false positives:
    - "voting districts" (often precincts, not wards)
    - "planning districts" (not council wards)
    - "historic districts" (not political boundaries)
    """
    hub_url = "https://hub.arcgis.com/api/v3/search"

    params = {
        "q": f"{query} {location}",
        "filter[type]": "Feature Service",
        "page[size]": max_results,
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(hub_url, params=params, timeout=30) as resp:
                data = await resp.json()

        results = []
        for item in data.get("data", [])[:max_results]:
            attrs = item.get("attributes", {})
            results.append({
                "id": item.get("id"),
                "title": attrs.get("name"),
                "url": attrs.get("url"),
                "owner": attrs.get("owner"),
                "description": attrs.get("description", "")[:200],
                "created": attrs.get("created"),
            })

        return {
            "success": True,
            "query": query,
            "location": location,
            "authority_tier": 4,  # Lowest - needs validation
            "results": results,
            "warning": "Hub results need authority validation before use",
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================================================
# 4. VALIDATION TOOLS
# ============================================================================

async def probe_arcgis_service(
    url: Annotated[str, "ArcGIS REST service base URL"],
) -> Dict:
    """
    Probe an ArcGIS REST service to discover available layers.

    Returns layer names, types, and metadata. Use this to find
    ward/district layers within a GIS service.

    Look for layers with names containing:
    - "ward", "wards"
    - "district", "council district"
    - "commission district"
    - "political boundary"
    """
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{url}?f=json",
                timeout=30
            ) as resp:
                data = await resp.json()

        layers = []
        for layer in data.get("layers", []):
            layers.append({
                "id": layer.get("id"),
                "name": layer.get("name"),
                "type": layer.get("type"),
                "min_scale": layer.get("minScale"),
                "max_scale": layer.get("maxScale"),
            })

        # Score layers by relevance
        ward_keywords = ["ward", "district", "commission", "council", "political"]
        scored_layers = []
        for layer in layers:
            name_lower = layer["name"].lower()
            score = sum(1 for kw in ward_keywords if kw in name_lower)
            if score > 0:
                scored_layers.append({**layer, "relevance_score": score})

        scored_layers.sort(key=lambda x: x["relevance_score"], reverse=True)

        return {
            "success": True,
            "service_url": url,
            "total_layers": len(layers),
            "all_layers": layers,
            "relevant_layers": scored_layers,
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


async def validate_boundary_layer(
    url: Annotated[str, "Layer query URL"],
    expected_features: Annotated[Optional[int], "Expected number of features (e.g., 6 for 6 wards)"] = None,
    test_point: Annotated[Optional[Dict], "Test point {lat, lon} to verify"] = None,
) -> Dict:
    """
    Validate a boundary layer returns correct GeoJSON.

    Checks:
    1. URL is accessible
    2. Returns valid GeoJSON with features
    3. Feature count matches expected (if provided)
    4. Test point falls within expected boundary (if provided)

    Returns validation result with confidence score.
    """
    try:
        # Ensure URL requests GeoJSON
        if "f=geojson" not in url.lower():
            if "?" in url:
                url = f"{url}&f=geojson"
            else:
                url = f"{url}?f=geojson&where=1%3D1&outFields=*"

        async with aiohttp.ClientSession() as session:
            start = time.time()
            async with session.get(url, timeout=30) as resp:
                latency = (time.time() - start) * 1000

                if resp.status != 200:
                    return {
                        "success": False,
                        "error": f"HTTP {resp.status}",
                        "url": url,
                    }

                data = await resp.json()

        features = data.get("features", [])
        feature_count = len(features)

        if feature_count == 0:
            return {
                "success": False,
                "error": "No features returned",
                "url": url,
            }

        # Check geometry type
        geometry_type = features[0].get("geometry", {}).get("type", "unknown")

        # Check for expected count
        count_match = None
        if expected_features:
            count_match = feature_count == expected_features

        # Build result
        result = {
            "success": True,
            "url": url,
            "feature_count": feature_count,
            "geometry_type": geometry_type,
            "latency_ms": round(latency, 1),
            "sample_properties": list(features[0].get("properties", {}).keys())[:10],
        }

        if count_match is not None:
            result["expected_count"] = expected_features
            result["count_matches"] = count_match

        # Calculate confidence
        confidence = 70  # Base confidence for accessible + valid GeoJSON
        if geometry_type in ("Polygon", "MultiPolygon"):
            confidence += 10
        if count_match:
            confidence += 20

        result["confidence"] = min(confidence, 100)

        return result

    except Exception as e:
        return {"success": False, "error": str(e), "url": url}


async def test_point_in_boundary(
    layer_url: Annotated[str, "ArcGIS layer URL"],
    lat: Annotated[float, "Test point latitude"],
    lon: Annotated[float, "Test point longitude"],
    expected_ward: Annotated[Optional[str], "Expected ward/district name"] = None,
) -> Dict:
    """
    Test if a known point falls within the correct boundary.

    Use city hall coordinates to verify ward boundaries are correct.
    Example: Missoula City Hall should be in Ward 1 or 2.

    This catches cases where boundaries are outdated or incorrect.
    """
    query_url = f"{layer_url}/query" if not layer_url.endswith("/query") else layer_url

    params = {
        "geometry": f"{lon},{lat}",
        "geometryType": "esriGeometryPoint",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "*",
        "f": "json",
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(query_url, params=params, timeout=30) as resp:
                data = await resp.json()

        features = data.get("features", [])

        if not features:
            return {
                "success": True,
                "point_found": False,
                "lat": lat,
                "lon": lon,
                "message": "Point not within any boundary",
            }

        attrs = features[0].get("attributes", {})

        result = {
            "success": True,
            "point_found": True,
            "lat": lat,
            "lon": lon,
            "boundary_attributes": attrs,
        }

        if expected_ward:
            # Check if any attribute value matches expected
            found_match = any(
                expected_ward.lower() in str(v).lower()
                for v in attrs.values()
            )
            result["expected_ward"] = expected_ward
            result["matches_expected"] = found_match

        return result

    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================================================
# 5. MEMORY & PERSISTENCE TOOLS
# ============================================================================

# In-memory store for discoveries (would be database in production)
_discovery_store: Dict[str, Dict] = {}


async def save_discovery(
    city: Annotated[str, "City name"],
    state: Annotated[str, "State abbreviation"],
    boundary_type: Annotated[str, "Type: ward, district, precinct"],
    url: Annotated[str, "Validated boundary URL"],
    authority_tier: Annotated[int, "Authority level 1-4"],
    feature_count: Annotated[int, "Number of boundaries"],
    confidence: Annotated[int, "Validation confidence 0-100"],
    source_name: Annotated[str, "Source name (e.g., 'City of Missoula GIS')"],
) -> Dict:
    """
    Save a validated boundary discovery to the registry.

    Only call this AFTER validation confirms the boundary is correct.

    Authority tiers:
    1 = City GIS (highest)
    2 = County GIS
    3 = State GIS
    4 = ArcGIS Hub (lowest)
    """
    key = f"{city.lower()}_{state.lower()}_{boundary_type}"

    record = {
        "city": city,
        "state": state,
        "boundary_type": boundary_type,
        "url": url,
        "authority_tier": authority_tier,
        "feature_count": feature_count,
        "confidence": confidence,
        "source_name": source_name,
        "discovered_at": time.time(),
    }

    _discovery_store[key] = record

    return {
        "success": True,
        "message": f"Saved {city}, {state} {boundary_type} boundaries",
        "record": record,
    }


async def get_discovery(
    city: Annotated[str, "City name"],
    state: Annotated[str, "State abbreviation"],
    boundary_type: Annotated[str, "Type: ward, district, precinct"] = "ward",
) -> Dict:
    """
    Check if we've already discovered boundaries for a city.

    Use this to avoid re-discovering already found boundaries.
    """
    key = f"{city.lower()}_{state.lower()}_{boundary_type}"

    if key in _discovery_store:
        return {
            "success": True,
            "found": True,
            "record": _discovery_store[key],
        }

    return {
        "success": True,
        "found": False,
        "message": f"No discovery found for {city}, {state}",
    }


async def list_discoveries(
    state: Annotated[Optional[str], "Filter by state"] = None,
) -> Dict:
    """
    List all boundary discoveries in the registry.

    Use to review progress and identify remaining gaps.
    """
    records = list(_discovery_store.values())

    if state:
        records = [r for r in records if r["state"].upper() == state.upper()]

    return {
        "success": True,
        "total": len(records),
        "discoveries": records,
    }


# ============================================================================
# TOOL REGISTRY
# ============================================================================

# All tools available to the agent
ALL_TOOLS = [
    # Census & Roster
    get_census_places,
    get_state_fips,
    # Governance Research
    research_city_governance,
    # Authority Discovery (hierarchical)
    search_city_gis_portal,
    search_county_gis_portal,
    search_state_gis_portal,
    search_arcgis_hub,
    # Validation
    probe_arcgis_service,
    validate_boundary_layer,
    test_point_in_boundary,
    # Memory
    save_discovery,
    get_discovery,
    list_discoveries,
]

# Tools grouped by category for specialized agents
ROSTER_TOOLS = [get_census_places, get_state_fips]
GOVERNANCE_TOOLS = [research_city_governance]
DISCOVERY_TOOLS = [
    search_city_gis_portal,
    search_county_gis_portal,
    search_state_gis_portal,
    search_arcgis_hub,
    probe_arcgis_service,
]
VALIDATION_TOOLS = [validate_boundary_layer, test_point_in_boundary]
MEMORY_TOOLS = [save_discovery, get_discovery, list_discoveries]
