#!/usr/bin/env python3
"""
Autonomous Batch Discovery System

PURPOSE: Cover the entire United States at highest granularity (council districts)
with proper provenance, using Gemini grounded search as the discovery engine.

ARCHITECTURE:
1. Load all cities >=25k population from Census TIGERweb
2. Check registry for existing coverage
3. Check governance structure (at-large vs district elections)
4. Discover missing cities via authority-tier hierarchy:
   a. City GIS portal probe (0 Gemini calls, tier 1 - highest authority)
   b. ArcGIS API search (0 Gemini calls, tier 4 - lowest authority)
   c. State GIS clearinghouse search (0 Gemini calls, tier 3 authority)
   d. Grounded Gemini search (1 call per city, last resort)
5. Validate discovered URLs
6. Write provenance + auto-add to registry

AUTHORITY TIERS:
- Tier 1: City's official GIS portal (gis.{cityname}.gov, maps.{cityname}.gov)
- Tier 2: County GIS portal (gis.{countyname}county.gov) [future]
- Tier 3: State GIS clearinghouse (Texas TNRIS, Montana MSDI, etc.)
- Tier 4: ArcGIS Hub/Online (lowest authority, may be third-party uploads)

CALL EFFICIENCY:
- Registry hits: 0 Gemini calls
- City portal probes: 0 Gemini calls (tier 1 - highest authority)
- ArcGIS API search: 0 Gemini calls (tier 4)
- State GIS clearinghouse: 0 Gemini calls (tier 3 authority)
- Grounded Gemini: 1 call per undiscovered city (last resort)
- Expected: ~200-500 Gemini calls (tier 1-4 resolves 40-60%)

COST ESTIMATE (Free tier):
- 15 requests/minute = 900/hour
- 1500 requests/day free
- Full US coverage in ~1-2 days

RUN:
    cd agents/langgraph
    source .venv/bin/activate
    python batch_discovery.py --state TX --parallel 5
    python batch_discovery.py --all-states --parallel 10
"""

import asyncio
import json
import logging
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, List, Any
from dataclasses import dataclass, field, asdict
import aiohttp

# Load environment
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

# Import state GIS registry
from state_gis_registry import (
    STATE_GIS_PORTALS,
    get_state_portal,
    get_known_sources,
    get_statewide_source,
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s'
)
logger = logging.getLogger(__name__)

# Paths
SCRIPT_DIR = Path(__file__).parent
TS_ROOT = SCRIPT_DIR.parent.parent  # shadow-atlas/
REGISTRY_PATH = TS_ROOT / "registry" / "known-portals.ts"
PROVENANCE_DIR = TS_ROOT / "discovery-attempts" / "batch"
DISCOVERIES_DIR = TS_ROOT / "discoveries"

# State FIPS codes
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


@dataclass
class CityTarget:
    """City target for discovery"""
    fips: str
    name: str
    state: str
    population: int

    # Discovery results
    discovered_url: Optional[str] = None
    discovery_method: Optional[str] = None  # 'registry', 'city_portal', 'arcgis_api', 'gemini_grounded'
    feature_count: Optional[int] = None
    confidence: int = 0
    authority_tier: Optional[int] = None  # 1=city portal, 2=county, 3=state, 4=arcgis_hub

    # Validation
    validated: bool = False
    validation_issues: List[str] = field(default_factory=list)

    # Triangulation - multi-source verification
    triangulated: bool = False
    secondary_source: Optional[str] = None
    secondary_feature_count: Optional[int] = None
    triangulation_match: Optional[bool] = None  # True=match, False=mismatch, None=not attempted

    # Provenance
    reasoning: List[str] = field(default_factory=list)
    timestamp: Optional[str] = None

    # Data freshness metadata (extracted from ArcGIS service)
    last_updated: Optional[str] = None  # ISO timestamp from source (editingInfo.lastEditDate)
    data_source_name: Optional[str] = None  # Human-readable source name from service
    service_description: Optional[str] = None  # Description from service metadata
    data_age_days: Optional[int] = None  # Calculated from last_updated
    copyright_text: Optional[str] = None  # Attribution info from source


@dataclass
class ProvenanceRecord:
    """Provenance record for audit trail"""
    fips: str
    name: str
    state: str
    population: int

    # Discovery
    discovery_method: str
    discovered_url: Optional[str]
    feature_count: Optional[int]
    confidence: int
    authority_tier: Optional[int]  # 1=city portal, 2=county, 3=state, 4=arcgis_hub

    # Validation
    validated: bool
    validation_issues: List[str]

    # Triangulation - multi-source verification
    triangulated: bool
    secondary_source: Optional[str]
    secondary_feature_count: Optional[int]
    triangulation_match: Optional[bool]

    # Data freshness metadata
    last_updated: Optional[str]  # ISO timestamp from source
    data_source_name: Optional[str]  # Human-readable source name
    service_description: Optional[str]  # Description from service metadata
    data_age_days: Optional[int]  # Calculated from last_updated
    copyright_text: Optional[str]  # Attribution info from source

    # Provenance metadata
    reasoning: List[str]
    timestamp: str
    batch_id: str

    def to_dict(self) -> dict:
        return asdict(self)


class BatchDiscovery:
    """Autonomous batch discovery system"""

    def __init__(self, parallel: int = 5):
        self.parallel = parallel
        self.registry = {}
        self.discoveries = []
        self.provenance = []
        self.batch_id = datetime.utcnow().strftime("%Y%m%d-%H%M%S")

        # API key pool
        self.api_keys = self._load_api_keys()
        self.key_index = 0

        # Rate limiting
        self.requests_per_minute = 15
        self.last_request_time = 0

    def _load_api_keys(self) -> List[str]:
        """Load Gemini API keys from environment"""
        keys = []

        # Single key
        single = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        if single:
            keys.append(single)

        # Key pool format: project1:key1:tier,project2:key2:tier
        pool = os.getenv("GEMINI_KEYS", "")
        if pool:
            for entry in pool.split(","):
                parts = entry.split(":")
                if len(parts) >= 2:
                    keys.append(parts[1])

        logger.info(f"Loaded {len(keys)} API keys")
        return keys

    def _get_api_key(self) -> str:
        """Get next API key (round-robin)"""
        if not self.api_keys:
            raise ValueError("No API keys available")
        key = self.api_keys[self.key_index % len(self.api_keys)]
        self.key_index += 1
        return key

    async def _rate_limit(self):
        """Enforce rate limiting"""
        import time
        now = time.time()
        min_interval = 60.0 / self.requests_per_minute
        elapsed = now - self.last_request_time
        if elapsed < min_interval:
            await asyncio.sleep(min_interval - elapsed)
        self.last_request_time = time.time()

    async def discover_via_city_portal(self, city: CityTarget) -> bool:
        """
        Tier 1 Discovery: Probe official city GIS portals.

        Authority Tier 1 sources are the most authoritative because they're
        maintained directly by the city government. This method constructs
        likely city GIS portal URLs and probes for council/district layers.

        URL patterns probed:
        - gis.{cityname}.gov
        - gis.{cityname}{state}.gov
        - maps.{cityname}.gov
        - gis.{cityname}city.gov
        - gis.cityof{cityname}.{state}.gov

        Returns True if authoritative data is found, False otherwise.
        """
        city_slug = city.name.lower().replace(" ", "").replace(".", "").replace("-", "")
        state_lower = city.state.lower()

        # Common city GIS portal domain patterns (Tier 1 - highest authority)
        portal_patterns = [
            f"https://gis.{city_slug}.gov",
            f"https://gis.{city_slug}{state_lower}.gov",
            f"https://maps.{city_slug}.gov",
            f"https://gis.{city_slug}city.gov",
            f"https://gis.cityof{city_slug}.{state_lower}.gov",
            f"https://{city_slug}.giscloud.gov",
            f"https://gis.{city_slug}city{state_lower}.gov",
            # Common alternate patterns
            f"https://data.{city_slug}{state_lower}.gov",
            f"https://opendata.{city_slug}.gov",
        ]

        # ArcGIS REST endpoint patterns to probe on each domain
        arcgis_patterns = [
            "/arcgis/rest/services",
            "/gis/rest/services",
            "/server/rest/services",
            "/rest/services",
        ]

        # Keywords indicating council district data
        district_keywords = ["council", "district", "ward", "alderman", "aldermanic"]

        city.reasoning.append(f"City Portal: Probing {len(portal_patterns)} potential domains")

        async with aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=10)
        ) as session:
            for portal_base in portal_patterns:
                for arcgis_path in arcgis_patterns:
                    services_url = f"{portal_base}{arcgis_path}"

                    try:
                        # Probe service directory
                        async with session.get(
                            f"{services_url}?f=json",
                            ssl=False  # Some gov sites have cert issues
                        ) as resp:
                            if resp.status != 200:
                                continue

                            data = await resp.json()

                        # Parse services and folders
                        services = data.get("services", [])
                        folders = data.get("folders", [])

                        # Search services for council/district layers
                        for svc in services:
                            svc_name = svc.get("name", "") if isinstance(svc, dict) else str(svc)
                            svc_type = svc.get("type", "MapServer") if isinstance(svc, dict) else "MapServer"
                            svc_name_lower = svc_name.lower()

                            if any(kw in svc_name_lower for kw in district_keywords):
                                result = await self._probe_city_portal_service(
                                    session, services_url, svc_name, svc_type, city
                                )
                                if result:
                                    city.discovered_url = result["url"]
                                    city.discovery_method = "city_portal"
                                    city.feature_count = result["count"]
                                    city.authority_tier = 1
                                    # Tier 1 gets +15 confidence boost (base 70 + 15 = 85)
                                    city.confidence = 85
                                    city.reasoning.append(
                                        f"City Portal (Tier 1): Found '{svc_name}' at {portal_base} "
                                        f"({result['count']} features)"
                                    )
                                    return True

                        # Also check folders for nested services
                        for folder in folders:
                            folder_name = folder if isinstance(folder, str) else folder.get("name", "")
                            folder_lower = folder_name.lower()

                            # Check if folder name suggests relevant data
                            if any(kw in folder_lower for kw in district_keywords + ["boundaries", "admin", "political"]):
                                folder_url = f"{services_url}/{folder_name}"
                                try:
                                    async with session.get(f"{folder_url}?f=json", ssl=False) as folder_resp:
                                        if folder_resp.status != 200:
                                            continue
                                        folder_data = await folder_resp.json()

                                    for svc in folder_data.get("services", []):
                                        svc_name = svc.get("name", "") if isinstance(svc, dict) else str(svc)
                                        svc_type = svc.get("type", "MapServer") if isinstance(svc, dict) else "MapServer"

                                        result = await self._probe_city_portal_service(
                                            session, folder_url, svc_name.split("/")[-1], svc_type, city
                                        )
                                        if result:
                                            city.discovered_url = result["url"]
                                            city.discovery_method = "city_portal"
                                            city.feature_count = result["count"]
                                            city.authority_tier = 1
                                            city.confidence = 85
                                            city.reasoning.append(
                                                f"City Portal (Tier 1): Found '{svc_name}' in folder '{folder_name}' "
                                                f"({result['count']} features)"
                                            )
                                            return True
                                except Exception:
                                    continue

                    except Exception:
                        # Domain doesn't exist or isn't accessible - expected for many patterns
                        continue

        city.reasoning.append("City Portal: No authoritative city GIS portal found")
        return False

    async def _probe_city_portal_service(
        self,
        session: aiohttp.ClientSession,
        base_url: str,
        svc_name: str,
        svc_type: str,
        city: CityTarget
    ) -> Optional[Dict]:
        """
        Probe an ArcGIS service for council district layers.

        Returns dict with 'url' and 'count' if valid council district data found,
        None otherwise.
        """
        district_keywords = ["council", "district", "ward", "alderman"]
        svc_url = f"{base_url}/{svc_name}/{svc_type}"

        try:
            # Get service metadata
            async with session.get(f"{svc_url}?f=json", ssl=False) as resp:
                if resp.status != 200:
                    return None
                svc_data = await resp.json()

            # Check each layer
            for layer in svc_data.get("layers", []):
                layer_name = layer.get("name", "").lower()
                layer_id = layer.get("id", 0)

                if any(kw in layer_name for kw in district_keywords):
                    # Probe layer for feature count
                    query_url = f"{svc_url}/{layer_id}/query?where=1%3D1&returnCountOnly=true&f=json"
                    async with session.get(query_url, ssl=False) as count_resp:
                        if count_resp.status != 200:
                            continue
                        count_data = await count_resp.json()
                        count = count_data.get("count", 0)

                        # Valid council districts typically have 3-50 features
                        if 3 <= count <= 50:
                            geojson_url = (
                                f"{svc_url}/{layer_id}/query?"
                                f"where=1%3D1&outFields=*&f=geojson"
                            )
                            return {"url": geojson_url, "count": count}

        except Exception:
            pass

        return None

    async def load_registry(self):
        """Load existing registry entries"""
        if not REGISTRY_PATH.exists():
            logger.warning(f"Registry not found: {REGISTRY_PATH}")
            return

        import re
        content = REGISTRY_PATH.read_text()

        # Parse FIPS keys
        pattern = r"'(\d{7})':\s*\{([^}]+)\}"
        matches = re.findall(pattern, content, re.DOTALL)

        for fips, entry_str in matches:
            try:
                url_match = re.search(r"downloadUrl:\s*'([^']+)'", entry_str)
                conf_match = re.search(r"confidence:\s*(\d+)", entry_str)
                name_match = re.search(r"cityName:\s*'([^']+)'", entry_str)
                state_match = re.search(r"state:\s*'([^']+)'", entry_str)
                fc_match = re.search(r"featureCount:\s*(\d+)", entry_str)

                if url_match:
                    self.registry[fips] = {
                        "fips": fips,
                        "url": url_match.group(1),
                        "confidence": int(conf_match.group(1)) if conf_match else 70,
                        "name": name_match.group(1) if name_match else "",
                        "state": state_match.group(1) if state_match else "",
                        "feature_count": int(fc_match.group(1)) if fc_match else 0,
                    }
            except Exception as e:
                logger.debug(f"Failed to parse {fips}: {e}")

        logger.info(f"Loaded {len(self.registry)} registry entries")

    async def fetch_cities(self, state: str) -> List[CityTarget]:
        """Fetch cities from Census TIGERweb API"""
        state_fips = STATE_FIPS.get(state.upper())
        if not state_fips:
            logger.error(f"Unknown state: {state}")
            return []

        url = (
            "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/"
            "Places_CouSub_ConCity_SubMCD/MapServer/25/query"
        )
        params = {
            "where": f"STATE='{state_fips}' AND POP100>=25000",
            "outFields": "GEOID,NAME,POP100",
            "returnGeometry": "false",
            "f": "json",
        }

        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, params=params, timeout=60) as resp:
                    data = await resp.json()

            cities = []
            for feature in data.get("features", []):
                attrs = feature.get("attributes", {})
                geoid = attrs.get("GEOID", "")
                fips = geoid[-7:] if len(geoid) >= 7 else geoid

                cities.append(CityTarget(
                    fips=fips,
                    name=attrs.get("NAME", "").replace(" city", "").replace(" town", ""),
                    state=state.upper(),
                    population=int(attrs.get("POP100", 0)),
                ))

            # Sort by population
            cities.sort(key=lambda x: x.population, reverse=True)
            logger.info(f"Fetched {len(cities)} cities from {state} (pop >= 25k)")
            return cities

        except Exception as e:
            logger.error(f"Failed to fetch cities for {state}: {e}")
            return []

    async def discover_via_arcgis_api(self, city: CityTarget) -> bool:
        """Try ArcGIS API search (0 Gemini calls)"""
        city_slug = city.name.lower().replace(" ", "").replace(".", "")
        city_lower = city.name.lower()
        state_lower = city.state.lower()

        search_url = "https://www.arcgis.com/sharing/rest/search"

        # Multiple search strategies
        search_queries = [
            f'"{city.name}" council district',
            f'title:"{city.name}" council',
            f'owner:*{city_slug}* district',
        ]

        try:
            async with aiohttp.ClientSession() as session:
                for query in search_queries:
                    params = {
                        "q": query,
                        "f": "json",
                        "num": 20,
                    }

                    async with session.get(search_url, params=params, timeout=30) as resp:
                        data = await resp.json()

                    for result in data.get("results", []):
                        url = result.get("url")
                        rtype = result.get("type", "")
                        title = result.get("title", "").lower()
                        owner = result.get("owner", "").lower()
                        desc = result.get("description", "").lower() if result.get("description") else ""

                        # Filter for Feature Services
                        if not url or "Feature" not in rtype:
                            continue

                        # CRITICAL: Must have council/district in title
                        if not any(kw in title for kw in ["council", "district", "ward"]):
                            continue

                        # CRITICAL: Title or owner must reference this city/state
                        # This prevents Pierce County WA from matching Corpus Christi TX
                        city_match = any(c in title or c in owner or c in desc for c in [
                            city_lower,
                            city_slug,
                            city.name.split()[0].lower(),  # First word (e.g., "corpus" from "corpus christi")
                        ])
                        state_match = state_lower in title or state_lower in owner or state_lower in desc

                        if not city_match:
                            continue

                        # Probe to verify
                        probe_url = f"{url}/0/query?where=1%3D1&returnCountOnly=true&f=json"
                        try:
                            async with session.get(probe_url, timeout=15) as probe_resp:
                                if probe_resp.status != 200:
                                    continue
                                probe_data = await probe_resp.json()
                                count = probe_data.get("count", 0)

                                if 3 <= count <= 50:
                                    geojson_url = f"{url}/0/query?where=1%3D1&outFields=*&f=geojson"
                                    city.discovered_url = geojson_url
                                    city.discovery_method = "arcgis_api"
                                    city.feature_count = count
                                    city.authority_tier = 4  # ArcGIS Hub/Online - lowest authority
                                    city.confidence = 75  # Tier 4 gets +0 confidence boost (base 75)
                                    city.reasoning.append(f"ArcGIS API (Tier 4): Found '{title}' by {owner} ({count} features)")
                                    return True
                        except Exception:
                            continue

        except Exception as e:
            city.reasoning.append(f"ArcGIS API: Failed - {e}")

        city.reasoning.append("ArcGIS API: No matching data found")
        return False

    async def discover_via_state_clearinghouse(self, city: CityTarget) -> bool:
        """
        Try state GIS clearinghouse discovery (0 Gemini calls).

        State clearinghouses are authoritative sources that often have:
        - Statewide ward/precinct boundaries
        - Multi-city datasets that need filtering
        - Higher authority than ArcGIS Hub (tier 3 vs tier 4)

        This should be tried BEFORE Gemini search as it's free and authoritative.
        """
        state_portal = get_state_portal(city.state)
        if not state_portal:
            city.reasoning.append(f"State clearinghouse: No portal registered for {city.state}")
            return False

        city.reasoning.append(f"State clearinghouse: Querying {state_portal.name}")

        # Strategy 1: Check pre-verified city-specific sources
        city_sources = get_known_sources(city.state)
        for source in city_sources:
            if source.coverage.lower() != "statewide" and source.coverage.lower() == city.name.lower():
                city.reasoning.append(f"State clearinghouse: Found pre-verified source for {city.name}")
                probe_result = await self._probe_url(source.url)
                if probe_result:
                    city.discovered_url = probe_result["url"]
                    city.discovery_method = "state_clearinghouse"
                    city.feature_count = probe_result["count"]
                    city.confidence = 85
                    city.authority_tier = source.authority_tier
                    city.reasoning.append(f"State clearinghouse: Pre-verified ({probe_result['count']} features)")
                    return True

        # Strategy 2: Check statewide source with city filtering
        statewide = get_statewide_source(city.state)
        if statewide:
            city.reasoning.append(f"State clearinghouse: Checking statewide source")
            found = await self._search_statewide_source(statewide.url, city)
            if found:
                city.discovered_url = found["url"]
                city.discovery_method = "state_clearinghouse"
                city.feature_count = found["count"]
                city.confidence = 80
                city.authority_tier = 3  # State-level authority
                city.reasoning.append(f"State clearinghouse: Statewide source ({found['count']} features)")
                return True

        # Strategy 3: Query state portal ArcGIS REST API
        if state_portal.arcgis_rest_url:
            found = await self._search_state_arcgis_rest(state_portal, city)
            if found:
                city.discovered_url = found["url"]
                city.discovery_method = "state_clearinghouse"
                city.feature_count = found["count"]
                city.confidence = 75
                city.authority_tier = 3
                city.reasoning.append(f"State clearinghouse: ArcGIS REST ({found['count']} features)")
                return True

        # Strategy 4: Try known state open data portal patterns
        found = await self._search_state_open_data(state_portal, city)
        if found:
            city.discovered_url = found["url"]
            city.discovery_method = "state_clearinghouse"
            city.feature_count = found["count"]
            city.confidence = 75
            city.authority_tier = 3
            city.reasoning.append(f"State clearinghouse: Open data search ({found['count']} features)")
            return True

        city.reasoning.append("State clearinghouse: No matching data found")
        return False

    async def _search_statewide_source(self, base_url: str, city: CityTarget) -> Optional[Dict]:
        """Search a statewide source for city-specific data."""
        query_patterns = [
            f"CITY LIKE '%{city.name}%'",
            f"MUNICIPALITY LIKE '%{city.name}%'",
            f"NAME LIKE '%{city.name}%'",
            f"JURIS LIKE '%{city.name}%'",
        ]

        try:
            async with aiohttp.ClientSession() as session:
                probe_urls = [
                    f"{base_url}/0/query?where=1%3D1&returnCountOnly=true&f=json",
                    f"{base_url}/query?where=1%3D1&returnCountOnly=true&f=json",
                ]

                for probe_url in probe_urls:
                    try:
                        async with session.get(probe_url, timeout=15) as resp:
                            if resp.status != 200:
                                continue
                            data = await resp.json()
                            if "error" in data:
                                continue

                            for query in query_patterns:
                                query_url = probe_url.replace(
                                    "where=1%3D1",
                                    f"where={query.replace(' ', '%20')}"
                                )
                                async with session.get(query_url, timeout=15) as qresp:
                                    if qresp.status != 200:
                                        continue
                                    qdata = await qresp.json()
                                    count = qdata.get("count", 0)

                                    if 3 <= count <= 20:
                                        base = probe_url.split("/query")[0]
                                        geojson_url = f"{base}/query?where={query.replace(' ', '%20')}&outFields=*&f=geojson"
                                        return {"url": geojson_url, "count": count}
                    except Exception:
                        continue
        except Exception:
            pass
        return None

    async def _search_state_arcgis_rest(self, portal, city: CityTarget) -> Optional[Dict]:
        """Search state ArcGIS REST services for city council districts."""
        if not portal.arcgis_rest_url:
            return None

        city_lower = city.name.lower()
        city_slug = city_lower.replace(" ", "").replace(".", "")

        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(f"{portal.arcgis_rest_url}?f=json", timeout=15) as resp:
                    if resp.status != 200:
                        return None
                    data = await resp.json()

                folders = data.get("folders", [])
                services = data.get("services", [])
                candidates = [
                    (portal.arcgis_rest_url, svc.get("name"), svc.get("type", "MapServer"))
                    for svc in services
                ]

                # Check boundary-related folders
                boundary_folders = ["Boundaries", "Administrative", "Political", "Elections",
                                   "Planning", "Districts", "Municipal", "Government"]
                for folder in folders:
                    if any(kw.lower() in folder.lower() for kw in boundary_folders):
                        folder_url = f"{portal.arcgis_rest_url}/{folder}"
                        try:
                            async with session.get(f"{folder_url}?f=json", timeout=10) as fresp:
                                if fresp.status == 200:
                                    fdata = await fresp.json()
                                    for svc in fdata.get("services", []):
                                        candidates.append((folder_url, svc.get("name"), svc.get("type", "MapServer")))
                        except Exception:
                            continue

                for base_url, svc_name, svc_type in candidates:
                    name_lower = svc_name.lower() if svc_name else ""
                    if not any(kw in name_lower for kw in ["council", "district", "ward", "boundary", "municipal", "city"]):
                        continue

                    svc_url = f"{base_url}/{svc_name}/{svc_type}"
                    try:
                        async with session.get(f"{svc_url}?f=json", timeout=10) as sresp:
                            if sresp.status != 200:
                                continue
                            sdata = await sresp.json()

                        for layer in sdata.get("layers", []):
                            layer_name = layer.get("name", "").lower()
                            layer_id = layer.get("id")

                            if not any(kw in layer_name for kw in ["council", "district", "ward"]):
                                continue

                            city_match = city_lower in layer_name or city_slug in layer_name
                            layer_url = f"{svc_url}/{layer_id}"
                            probe_result = await self._probe_url(layer_url)

                            if probe_result:
                                if city_match:
                                    return probe_result
                                # Verify coverage via feature properties
                                try:
                                    async with session.get(probe_result["url"], timeout=30) as gjresp:
                                        if gjresp.status == 200:
                                            geojson = await gjresp.json()
                                            for f in geojson.get("features", [])[:5]:
                                                props_str = json.dumps(f.get("properties", {})).lower()
                                                if city_lower in props_str or city_slug in props_str:
                                                    return probe_result
                                except Exception:
                                    pass
                    except Exception:
                        continue
        except Exception:
            pass
        return None

    async def _search_state_open_data(self, portal, city: CityTarget) -> Optional[Dict]:
        """Search state open data portals for city council district data."""
        portal_url = portal.url.rstrip("/")

        # ArcGIS Hub search
        if "arcgis" in portal_url or "hub" in portal_url or "opendata" in portal_url:
            return await self._search_hub_for_city(city)

        # Generic patterns
        search_patterns = [
            f"{portal_url}/datasets?q={city.name}%20council%20district",
            f"{portal_url}/api/3/action/package_search?q={city.name}%20council%20district",
        ]

        async with aiohttp.ClientSession() as session:
            for search_url in search_patterns:
                try:
                    async with session.get(search_url, timeout=15) as resp:
                        if resp.status != 200:
                            continue
                        data = await resp.json()
                        results = (
                            data.get("data", []) or
                            data.get("result", {}).get("results", []) or
                            data.get("results", [])
                        )
                        for result in results[:5]:
                            url = result.get("url") or result.get("downloadUrl") or result.get("serviceUrl")
                            if url and ("FeatureServer" in url or "MapServer" in url):
                                probe_result = await self._probe_url(url)
                                if probe_result:
                                    return probe_result
                except Exception:
                    continue
        return None

    async def _search_hub_for_city(self, city: CityTarget) -> Optional[Dict]:
        """Search ArcGIS Hub for city council districts."""
        search_url = "https://hub.arcgis.com/api/v3/datasets"
        query = f"{city.name} {city.state} council district"

        try:
            async with aiohttp.ClientSession() as session:
                params = {"q": query}
                async with session.get(search_url, params=params, timeout=15) as resp:
                    if resp.status != 200:
                        return None
                    data = await resp.json()

                for dataset in data.get("data", []):
                    attrs = dataset.get("attributes", {})
                    service_url = attrs.get("url") or attrs.get("serviceUrl")
                    if service_url:
                        probe_result = await self._probe_url(service_url)
                        if probe_result:
                            return probe_result
        except Exception:
            pass
        return None

    async def _call_gemini_with_retry(self, prompt: str, max_retries: int = 3):
        """Call Gemini with automatic key rotation on 429 errors."""
        from google import genai
        from google.genai.types import Tool, GoogleSearch

        for attempt in range(max_retries):
            api_key = self._get_api_key()
            client = genai.Client(api_key=api_key)
            google_search_tool = Tool(google_search=GoogleSearch())

            try:
                response = client.models.generate_content(
                    model='gemini-2.5-flash',
                    contents=prompt,
                    config={'tools': [google_search_tool]},
                )
                return response.text.strip()
            except Exception as e:
                error_str = str(e).lower()
                if "429" in error_str or "quota" in error_str or "rate" in error_str:
                    # Rotate to next API key
                    logger.warning(f"429 on key {self.key_index % len(self.api_keys)}, rotating...")
                    self.key_index += 1
                    await asyncio.sleep(2)  # Brief pause before retry
                    continue
                raise e

        return None  # All retries exhausted

    async def discover_via_gemini(self, city: CityTarget) -> bool:
        """Use Gemini grounded search with expert persona and multi-strategy approach."""
        await self._rate_limit()

        try:
            # EXPERT PERSONA + STRATEGY 1: Exhaustive ArcGIS Hub search
            prompt1 = f"""You are a senior GIS data analyst specializing in US municipal boundary data.
Your task is to find the EXACT city council district GIS data for {city.name}, {city.state}.

## CRITICAL REQUIREMENTS:
1. You MUST search exhaustively - this data exists if this city has district-based elections
2. Only return URLs you can VERIFY exist - never guess or fabricate URLs
3. Focus on ArcGIS Hub (hub.arcgis.com), ArcGIS Online (arcgis.com), and city open data portals
4. City council districts typically have 3-15 features representing electoral wards/districts

## SEARCH STRATEGY (execute all):
1. Search: "{city.name} city council districts" site:hub.arcgis.com
2. Search: "{city.name} TX ward boundaries" site:arcgis.com
3. Search: "{city.name}" "council district" "FeatureServer"
4. Search: {city.name.lower().replace(' ', '')} gis arcgis council

## RESPONSE FORMAT:
- If found: Return the EXACT ArcGIS Hub dataset URL or FeatureServer/MapServer URL
- If not found after exhaustive search: Respond "NOT_FOUND"
- Never fabricate URLs - only return URLs from search results

Find the {city.name}, {city.state} city council district boundaries data."""

            text1 = await self._call_gemini_with_retry(prompt1)
            if not text1:
                city.reasoning.append("Gemini: All API keys exhausted")
                return False

            import re
            # Look for ArcGIS URLs
            urls = re.findall(r'https?://[^\s<>"\'`\)]+(?:arcgis|hub\.arcgis)[^\s<>"\'`\)]*', text1)

            for candidate in urls:
                candidate = candidate.rstrip('.,')
                city.reasoning.append(f"Gemini: Testing ArcGIS candidate {candidate[:80]}")

                # Try to extract FeatureServer URL from Hub pages
                if 'hub.arcgis.com' in candidate or '/datasets/' in candidate:
                    # Get the item ID and construct FeatureServer URL
                    item_result = await self._resolve_hub_url(candidate)
                    if item_result:
                        probe_result = await self._probe_url(item_result)
                        if probe_result:
                            city.discovered_url = probe_result["url"]
                            city.discovery_method = "gemini_grounded"
                            city.feature_count = probe_result["count"]
                            city.confidence = 70
                            city.reasoning.append(f"Gemini: Hub resolved ({probe_result['count']} features)")
                            return True
                else:
                    # Direct FeatureServer/MapServer URL
                    probe_result = await self._probe_url(candidate)
                    if probe_result:
                        city.discovered_url = probe_result["url"]
                        city.discovery_method = "gemini_grounded"
                        city.feature_count = probe_result["count"]
                        city.confidence = 70
                        city.reasoning.append(f"Gemini: Direct URL ({probe_result['count']} features)")
                        return True

            # STRATEGY 2: Find official city GIS portal and probe it
            await self._rate_limit()
            prompt2 = f"""You are a senior GIS infrastructure researcher specializing in US municipal data portals.
Your task is to find the OFFICIAL GIS or Open Data portal for the City of {city.name}, {city.state}.

## CRITICAL REQUIREMENTS:
1. Search exhaustively for the city's official GIS infrastructure
2. Only return URLs for VERIFIED government portals (must be .gov or officially linked from city website)
3. City GIS portals typically use ArcGIS Server at URLs like gis.cityname.gov/arcgis/rest/services

## SEARCH STRATEGY (execute all):
1. Search: "{city.name} Texas" GIS portal site:gov
2. Search: gis.{city.name.lower().replace(' ', '')}.gov OR gis.{city.name.lower().replace(' ', '')}tx.gov
3. Search: "{city.name}" "open data" portal Texas
4. Search: "{city.name}" ArcGIS REST services site:gov

## RESPONSE FORMAT:
- Return the official city GIS portal base URL (e.g., https://gis.cityname.gov)
- If no official portal exists: Respond "NOT_FOUND"
- Never guess domain patterns - only return URLs verified from search results

Find the official GIS portal for {city.name}, {city.state}."""

            text2 = await self._call_gemini_with_retry(prompt2)
            if not text2:
                city.reasoning.append("Gemini: Strategy 2 exhausted")
                return False

            portal_urls = re.findall(r'https?://[^\s<>"\'`\)]+\.gov[^\s<>"\'`\)]*', text2)

            for portal_url in portal_urls[:3]:  # Try top 3 candidates
                portal_url = portal_url.rstrip('.,/')
                city.reasoning.append(f"Gemini: Probing portal {portal_url}")

                # Probe common ArcGIS REST endpoints on this domain
                found_url = await self._probe_city_portal(portal_url, city.name)
                if found_url:
                    probe_result = await self._probe_url(found_url)
                    if probe_result:
                        city.discovered_url = probe_result["url"]
                        city.discovery_method = "gemini_grounded"
                        city.feature_count = probe_result["count"]
                        city.confidence = 65
                        city.reasoning.append(f"Gemini: Portal discovery ({probe_result['count']} features)")
                        return True

            city.reasoning.append("Gemini: No valid data found after multi-strategy search")

        except Exception as e:
            city.reasoning.append(f"Gemini: Error - {e}")

        return False

    async def _resolve_hub_url(self, hub_url: str) -> Optional[str]:
        """Resolve ArcGIS Hub URL to FeatureServer URL"""
        import re

        # Extract item ID from various Hub URL formats
        # https://hub.arcgis.com/datasets/xxx/... or /items/xxx
        item_match = re.search(r'(?:datasets|items)/([a-f0-9]+)', hub_url)
        if not item_match:
            return None

        item_id = item_match.group(1)

        # Query ArcGIS item metadata
        try:
            async with aiohttp.ClientSession() as session:
                meta_url = f"https://www.arcgis.com/sharing/rest/content/items/{item_id}?f=json"
                async with session.get(meta_url, timeout=15) as resp:
                    if resp.status != 200:
                        return None
                    data = await resp.json()

                url = data.get("url")
                if url and ("FeatureServer" in url or "MapServer" in url):
                    return url
        except Exception:
            pass

        return None

    async def _probe_city_portal(self, portal_base: str, city_name: str) -> Optional[str]:
        """Probe common ArcGIS REST endpoint patterns on a city portal"""
        import re
        from urllib.parse import urlparse

        parsed = urlparse(portal_base)
        domain = f"{parsed.scheme}://{parsed.netloc}"

        # Common ArcGIS REST patterns
        patterns = [
            f"{domain}/arcgis/rest/services",
            f"{domain}/gis/rest/services",
            f"{domain}/server/rest/services",
        ]

        try:
            async with aiohttp.ClientSession() as session:
                for base in patterns:
                    try:
                        # Get service directory
                        async with session.get(f"{base}?f=json", timeout=10) as resp:
                            if resp.status != 200:
                                continue
                            data = await resp.json()

                        # Look for council/district services
                        services = data.get("services", []) + data.get("folders", [])

                        for svc in services:
                            name = svc.get("name", str(svc)).lower() if isinstance(svc, dict) else str(svc).lower()
                            if any(kw in name for kw in ["council", "district", "ward", "boundary", "admin"]):
                                svc_name = svc.get("name", svc) if isinstance(svc, dict) else svc
                                svc_type = svc.get("type", "MapServer") if isinstance(svc, dict) else "MapServer"

                                # Probe the service
                                svc_url = f"{base}/{svc_name}/{svc_type}"
                                async with session.get(f"{svc_url}?f=json", timeout=10) as svc_resp:
                                    if svc_resp.status != 200:
                                        continue
                                    svc_data = await svc_resp.json()

                                    # Check layers for council districts
                                    for layer in svc_data.get("layers", []):
                                        layer_name = layer.get("name", "").lower()
                                        if any(kw in layer_name for kw in ["council", "district", "ward"]):
                                            return f"{svc_url}/{layer['id']}"

                    except Exception:
                        continue

        except Exception:
            pass

        return None

    def _web_mercator_to_wgs84(self, x: float, y: float) -> tuple:
        """
        Convert Web Mercator (EPSG:3857) to WGS84 (EPSG:4326).
        Census TIGERweb returns Web Mercator, GeoJSON is typically WGS84.
        """
        import math
        # Constants
        EARTH_RADIUS = 6378137.0  # meters

        # Convert x to longitude
        lon = (x / EARTH_RADIUS) * (180.0 / math.pi)

        # Convert y to latitude
        lat = (math.atan(math.exp(y / EARTH_RADIUS)) * 2 - math.pi / 2) * (180.0 / math.pi)

        return (lon, lat)

    async def _get_city_centroid(self, city: CityTarget) -> Optional[tuple]:
        """
        Get city centroid coordinates from Census TIGERweb.
        Returns (lon, lat) tuple in WGS84 or None if not found.

        Uses the city's official geometry centroid, which is more reliable
        than geocoding "City Hall" addresses.
        """
        state_fips = STATE_FIPS.get(city.state.upper())
        if not state_fips:
            return None

        url = (
            "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/"
            "Places_CouSub_ConCity_SubMCD/MapServer/25/query"
        )
        params = {
            "where": f"GEOID LIKE '%{city.fips}'",
            "outFields": "GEOID,NAME",
            "returnGeometry": "true",
            "returnCentroid": "true",
            "f": "json",
        }

        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, params=params, timeout=30) as resp:
                    if resp.status != 200:
                        return None
                    data = await resp.json()

            features = data.get("features", [])
            if not features:
                return None

            # Get centroid from first matching feature
            feature = features[0]

            # Try centroid first (more accurate)
            centroid = feature.get("centroid")
            if centroid:
                x, y = centroid.get("x"), centroid.get("y")
                # Convert from Web Mercator to WGS84
                return self._web_mercator_to_wgs84(x, y)

            # Fall back to geometry center
            geom = feature.get("geometry", {})
            rings = geom.get("rings", [])
            if rings and rings[0]:
                # Simple centroid calculation from first ring
                coords = rings[0]
                x_avg = sum(c[0] for c in coords) / len(coords)
                y_avg = sum(c[1] for c in coords) / len(coords)
                # Convert from Web Mercator to WGS84
                return self._web_mercator_to_wgs84(x_avg, y_avg)

        except Exception:
            pass

        return None

    def _point_in_polygon(self, point: tuple, polygon: List[List[float]]) -> bool:
        """Ray casting algorithm for point-in-polygon test."""
        x, y = point
        n = len(polygon)
        inside = False

        j = n - 1
        for i in range(n):
            xi, yi = polygon[i][0], polygon[i][1]
            xj, yj = polygon[j][0], polygon[j][1]

            if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
                inside = not inside
            j = i

        return inside

    def _point_in_any_feature(self, point: tuple, features: List[Dict]) -> bool:
        """Check if point falls within any feature's geometry."""
        for feature in features:
            geom = feature.get("geometry", {})
            gtype = geom.get("type", "")
            coords = geom.get("coordinates", [])

            if gtype == "Polygon" and coords:
                # Check outer ring (first ring is exterior)
                if self._point_in_polygon(point, coords[0]):
                    return True
            elif gtype == "MultiPolygon" and coords:
                for poly in coords:
                    if poly and self._point_in_polygon(point, poly[0]):
                        return True

        return False

    def _filter_by_jurisdiction(self, features: List[Dict], city: CityTarget) -> Optional[int]:
        """
        Check if county-level data contains city-specific records.
        Returns filtered count if jurisdiction field exists, None otherwise.

        This catches false positives like "Maricopa County City Council Districts"
        being assigned to cities that aren't in that dataset.
        """
        city_lower = city.name.lower()
        city_slug = city_lower.replace(" ", "").replace(".", "")
        city_variants = [
            city_lower,
            city_slug,
            city.name.split()[0].lower() if city.name else "",
            city_lower.upper(),
        ]

        # Common jurisdiction field names
        juris_fields = ["juris", "jurisdiction", "city", "cityname", "city_name",
                       "municipality", "lgllabel", "name", "place"]

        # Check first few features for jurisdiction field
        sample = features[:5]
        juris_field = None

        for f in sample:
            props = f.get("properties", {})
            for field in juris_fields:
                for key in props.keys():
                    if key.lower() == field:
                        juris_field = key
                        break
                if juris_field:
                    break
            if juris_field:
                break

        if not juris_field:
            return None  # Can't filter - no jurisdiction field

        # Count features matching this city
        matching = 0
        for f in features:
            props = f.get("properties", {})
            val = props.get(juris_field, "")
            if isinstance(val, str):
                val_lower = val.lower()
                if any(v in val_lower or val_lower in v for v in city_variants if v):
                    matching += 1

        return matching

    async def _probe_url(self, url: str) -> Optional[Dict]:
        """Probe a GIS URL to validate"""
        import re
        base_url = url.rstrip('/').split('?')[0]

        # Probe patterns
        patterns = []
        if re.search(r'/\d+$', base_url):
            patterns = [f"{base_url}/query?where=1%3D1&returnCountOnly=true&f=json"]
        else:
            patterns = [
                f"{base_url}/0/query?where=1%3D1&returnCountOnly=true&f=json",
                f"{base_url}/query?where=1%3D1&returnCountOnly=true&f=json",
            ]

        async with aiohttp.ClientSession() as session:
            for probe_url in patterns:
                try:
                    async with session.get(probe_url, timeout=15) as resp:
                        if resp.status != 200:
                            continue
                        data = await resp.json()
                        count = data.get("count", 0)

                        if 3 <= count <= 50:
                            # Build GeoJSON URL
                            if "/0/query" in probe_url:
                                geojson_url = f"{base_url}/0/query?where=1%3D1&outFields=*&f=geojson"
                            else:
                                geojson_url = f"{base_url}/query?where=1%3D1&outFields=*&f=geojson"

                            return {"url": geojson_url, "count": count}
                except Exception:
                    continue

        return None

    async def _extract_arcgis_metadata(self, url: str, city: CityTarget) -> Dict[str, Any]:
        """
        Extract metadata from ArcGIS service endpoint for data freshness tracking.

        Queries the service metadata endpoint to extract:
        - editingInfo.lastEditDate (epoch milliseconds -> ISO timestamp)
        - name (service name)
        - description (service description)
        - copyrightText (attribution info)

        Args:
            url: The discovered GeoJSON URL (e.g., .../FeatureServer/0/query?...)
            city: CityTarget to populate with metadata

        Returns:
            Dict with extracted metadata fields
        """
        import re

        # Extract base service URL (remove /query params and layer number)
        # e.g., .../FeatureServer/0/query?... -> .../FeatureServer
        base_url = url.split('?')[0]  # Remove query params
        base_url = re.sub(r'/\d+/query.*$', '', base_url)  # Remove /0/query
        base_url = re.sub(r'/query.*$', '', base_url)  # Remove /query if no layer

        metadata = {
            "last_updated": None,
            "data_source_name": None,
            "service_description": None,
            "data_age_days": None,
            "copyright_text": None,
        }

        try:
            async with aiohttp.ClientSession() as session:
                # Query service metadata
                async with session.get(f"{base_url}?f=json", timeout=15) as resp:
                    if resp.status != 200:
                        city.reasoning.append(f"Metadata: Failed to fetch service info (HTTP {resp.status})")
                        return metadata
                    data = await resp.json()

                # Extract service name
                metadata["data_source_name"] = data.get("name")

                # Extract description (truncate if too long)
                desc = data.get("description", "")
                if desc:
                    metadata["service_description"] = desc[:500] if len(desc) > 500 else desc

                # Extract copyright/attribution
                copyright_text = data.get("copyrightText", "")
                if copyright_text:
                    metadata["copyright_text"] = copyright_text[:200] if len(copyright_text) > 200 else copyright_text

                # Extract last edit date from editingInfo
                editing_info = data.get("editingInfo", {})
                last_edit_ms = editing_info.get("lastEditDate")

                if last_edit_ms:
                    # Convert epoch milliseconds to ISO timestamp
                    from datetime import datetime, timezone
                    dt = datetime.fromtimestamp(last_edit_ms / 1000, tz=timezone.utc)
                    metadata["last_updated"] = dt.isoformat()

                    # Calculate data age in days
                    now = datetime.now(tz=timezone.utc)
                    age_delta = now - dt
                    metadata["data_age_days"] = age_delta.days

                    city.reasoning.append(f"Metadata: Data last updated {metadata['last_updated'][:10]} ({metadata['data_age_days']} days ago)")
                else:
                    # Try layer-specific metadata if service-level doesn't have editingInfo
                    # Some services only expose lastEditDate at the layer level
                    layer_url = f"{base_url}/0?f=json"
                    try:
                        async with session.get(layer_url, timeout=10) as layer_resp:
                            if layer_resp.status == 200:
                                layer_data = await layer_resp.json()
                                layer_editing = layer_data.get("editingInfo", {})
                                layer_last_edit = layer_editing.get("lastEditDate")

                                if layer_last_edit:
                                    from datetime import datetime, timezone
                                    dt = datetime.fromtimestamp(layer_last_edit / 1000, tz=timezone.utc)
                                    metadata["last_updated"] = dt.isoformat()
                                    now = datetime.now(tz=timezone.utc)
                                    age_delta = now - dt
                                    metadata["data_age_days"] = age_delta.days
                                    city.reasoning.append(f"Metadata: Layer data last updated {metadata['last_updated'][:10]} ({metadata['data_age_days']} days ago)")
                    except Exception:
                        pass

                    if not metadata["last_updated"]:
                        city.reasoning.append("Metadata: No lastEditDate available from service")

        except Exception as e:
            city.reasoning.append(f"Metadata: Error extracting - {e}")

        return metadata

    def _determine_source_tier(self, url: str, discovery_method: str) -> int:
        """
        Determine authority tier based on URL patterns and discovery method.

        Authority Tier Hierarchy:
        - Tier 1: City portal (gis.cityname.gov, maps.cityname.gov)
        - Tier 2: County portal (county patterns, supervisor districts)
        - Tier 3: State clearinghouse (state.gov patterns)
        - Tier 4: ArcGIS Hub (hub.arcgis.com, arcgis.com)

        Returns tier number (1=highest authority, 4=lowest).
        """
        url_lower = url.lower()

        # Tier 1: City portals (most authoritative)
        if discovery_method == "city_portal":
            return 1
        city_patterns = [
            r'gis\.\w+\.gov',
            r'maps\.\w+\.gov',
            r'opendata\.\w+\.gov',
            r'data\.\w+\.gov',
            r'cityof\w+',
        ]
        import re
        for pattern in city_patterns:
            if re.search(pattern, url_lower):
                return 1

        # Tier 2: County portals
        county_patterns = ['county', 'supervisor', 'parish']
        for pattern in county_patterns:
            if pattern in url_lower:
                return 2

        # Tier 3: State clearinghouse
        if discovery_method == "state_clearinghouse":
            return 3
        state_patterns = ['state.', '.state.', 'statewide']
        for pattern in state_patterns:
            if pattern in url_lower:
                return 3

        # Tier 4: ArcGIS Hub (public contributions, less authoritative)
        if 'hub.arcgis.com' in url_lower or 'arcgis.com' in url_lower:
            return 4
        if discovery_method in ["arcgis_api", "gemini_grounded"]:
            return 4

        # Default to tier 4 if unknown
        return 4

    async def _triangulate_sources(self, city: CityTarget, primary_url: str) -> Dict[str, Any]:
        """
        Multi-source triangulation: Find secondary source to verify primary discovery.

        Triangulation Logic:
        1. Determine primary source tier
        2. Search for secondary source from different tier
        3. Compare feature counts between sources
        4. Adjust confidence based on match/mismatch

        Confidence Adjustments:
        - Exact feature count match: +10 confidence
        - Match within +/-1 (redistricting tolerance): +5 confidence
        - Mismatch: -10 confidence (flag for review)

        Args:
            city: CityTarget with primary discovery
            primary_url: The primary discovered URL

        Returns:
            Dict with triangulation results:
            {
                "triangulated": bool,
                "secondary_source": Optional[str],
                "secondary_feature_count": Optional[int],
                "triangulation_match": Optional[bool],
                "confidence_adjustment": int
            }
        """
        result = {
            "triangulated": False,
            "secondary_source": None,
            "secondary_feature_count": None,
            "triangulation_match": None,
            "confidence_adjustment": 0,
        }

        # Determine primary source tier
        primary_tier = self._determine_source_tier(primary_url, city.discovery_method or "")
        city.authority_tier = primary_tier
        city.reasoning.append(f"Triangulation: Primary source is Tier {primary_tier}")

        # Strategy: If primary is from ArcGIS Hub (tier 4), look for city/state portal
        # If primary is from city portal (tier 1), verify against ArcGIS Hub
        secondary_result = None

        if primary_tier >= 3:
            # Primary is ArcGIS Hub or state - try to find city portal
            secondary_result = await self._search_city_portal_for_triangulation(city)
            if secondary_result:
                result["secondary_source"] = f"city_portal:{secondary_result['url'][:100]}"
        elif primary_tier == 1:
            # Primary is city portal - verify against ArcGIS Hub
            secondary_result = await self._search_arcgis_hub_for_triangulation(city)
            if secondary_result:
                result["secondary_source"] = f"arcgis_hub:{secondary_result['url'][:100]}"

        if not secondary_result:
            city.reasoning.append("Triangulation: No secondary source found")
            return result

        result["triangulated"] = True
        result["secondary_feature_count"] = secondary_result["count"]

        # Compare feature counts
        primary_count = city.feature_count or 0
        secondary_count = secondary_result["count"]

        if primary_count == secondary_count:
            # Exact match - high confidence
            result["triangulation_match"] = True
            result["confidence_adjustment"] = 10
            city.reasoning.append(
                f"Triangulation: MATCH - both sources report {primary_count} features (+10 confidence)"
            )
        elif abs(primary_count - secondary_count) <= 1:
            # Within +/-1 tolerance (redistricting can cause +1/-1 variance)
            result["triangulation_match"] = True
            result["confidence_adjustment"] = 5
            city.reasoning.append(
                f"Triangulation: MATCH (+/-1) - primary={primary_count}, secondary={secondary_count} (+5 confidence)"
            )
        else:
            # Mismatch - reduce confidence, flag for review
            result["triangulation_match"] = False
            result["confidence_adjustment"] = -10
            city.reasoning.append(
                f"Triangulation: MISMATCH - primary={primary_count}, secondary={secondary_count} (-10 confidence, REVIEW NEEDED)"
            )

        return result

    async def _search_city_portal_for_triangulation(self, city: CityTarget) -> Optional[Dict]:
        """
        Search city GIS portals for secondary verification.

        This method constructs likely city portal URLs and probes for council district layers,
        similar to discover_via_city_portal but optimized for triangulation (doesn't set city fields).

        Returns:
            Dict with 'url' and 'count' if found, None otherwise.
        """
        city_slug = city.name.lower().replace(" ", "").replace(".", "").replace("-", "")
        state_lower = city.state.lower()

        # Common city GIS portal domain patterns
        portal_patterns = [
            f"https://gis.{city_slug}.gov",
            f"https://gis.{city_slug}{state_lower}.gov",
            f"https://maps.{city_slug}.gov",
            f"https://gis.cityof{city_slug}.gov",
            f"https://opendata.{city_slug}.gov",
        ]

        arcgis_paths = ["/arcgis/rest/services", "/gis/rest/services", "/server/rest/services"]
        district_keywords = ["council", "district", "ward", "alderman"]

        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=8)) as session:
            for portal_base in portal_patterns:
                for arcgis_path in arcgis_paths:
                    services_url = f"{portal_base}{arcgis_path}"
                    try:
                        async with session.get(f"{services_url}?f=json", ssl=False) as resp:
                            if resp.status != 200:
                                continue
                            data = await resp.json()

                        for svc in data.get("services", []):
                            svc_name = svc.get("name", "") if isinstance(svc, dict) else str(svc)
                            svc_type = svc.get("type", "MapServer") if isinstance(svc, dict) else "MapServer"

                            if any(kw in svc_name.lower() for kw in district_keywords):
                                svc_url = f"{services_url}/{svc_name}/{svc_type}"
                                probe_result = await self._probe_url(svc_url)
                                if probe_result:
                                    return probe_result

                    except Exception:
                        continue

        return None

    async def _search_arcgis_hub_for_triangulation(self, city: CityTarget) -> Optional[Dict]:
        """
        Search ArcGIS Hub for secondary verification.

        This provides a fallback when primary source is from a city portal,
        allowing verification against the broader ArcGIS ecosystem.

        Returns:
            Dict with 'url' and 'count' if found, None otherwise.
        """
        search_url = "https://www.arcgis.com/sharing/rest/search"
        city_lower = city.name.lower()
        city_slug = city_lower.replace(" ", "").replace(".", "")

        search_queries = [
            f'"{city.name}" council district',
            f'title:"{city.name}" council',
        ]

        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as session:
                for query in search_queries:
                    params = {"q": query, "f": "json", "num": 10}

                    async with session.get(search_url, params=params) as resp:
                        if resp.status != 200:
                            continue
                        data = await resp.json()

                    for result in data.get("results", []):
                        url = result.get("url")
                        rtype = result.get("type", "")
                        title = result.get("title", "").lower()
                        owner = result.get("owner", "").lower()

                        if not url or "Feature" not in rtype:
                            continue

                        if not any(kw in title for kw in ["council", "district", "ward"]):
                            continue

                        # Verify city match
                        if city_lower not in title and city_slug not in title and city_lower not in owner:
                            continue

                        probe_result = await self._probe_url(url)
                        if probe_result:
                            return probe_result

        except Exception:
            pass

        return None

    async def validate_geojson(self, city: CityTarget) -> bool:
        """Validate discovered GeoJSON with strict false-positive rejection"""
        if not city.discovered_url:
            return False

        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(city.discovered_url, timeout=30) as resp:
                    if resp.status != 200:
                        city.validation_issues.append(f"HTTP {resp.status}")
                        return False
                    geojson = await resp.json()

            features = geojson.get("features", [])
            count = len(features)

            # Count validation - city councils typically have 3-15 districts
            if count < 2:
                city.validation_issues.append(f"Too few features: {count}")
                return False
            if count > 20:
                # Could be county-level aggregation - check for jurisdiction field
                city_filtered_count = self._filter_by_jurisdiction(features, city)
                if city_filtered_count is not None:
                    if city_filtered_count < 2:
                        city.validation_issues.append(f"City has no districts in county-level data")
                        return False
                    if city_filtered_count > 20:
                        city.validation_issues.append(f"Filtered count still too high: {city_filtered_count}")
                        return False
                    # Update count to filtered count
                    count = city_filtered_count
                    city.reasoning.append(f"Filtered county data: {city_filtered_count} features for {city.name}")
                else:
                    city.validation_issues.append(f"Too many features ({count}) - likely county/regional data")
                    return False

            # URL validation - reject if URL contains wrong state/country
            url_lower = city.discovered_url.lower()
            wrong_locations = [
                # Other US states (when not target state)
                "maryland", "mdot", "virginia", "california", "florida", "ohio", "michigan",
                "washington", "oregon", "arizona", "colorado", "georgia", "illinois",
                "pennsylvania", "jersey", "york", "massachusetts", "carolina",
                # Other countries
                "canada", "uk", "australia", "zealand", "europe", "asia",
                # Federal/state-level (not city)
                "sha_district", "state_senate", "state_house", "congressional",
            ]
            for wrong in wrong_locations:
                if wrong in url_lower and city.state.lower() not in wrong:
                    city.validation_issues.append(f"URL contains wrong location: {wrong}")
                    return False

            # Name pattern validation - reject state/federal level data
            bad_keywords = ["state", "legislative", "senate", "house", "county", "supervisor",
                           "congressional", "assembly", "sha", "mdot", "health board"]
            for f in features:
                props = f.get("properties", {})
                for key, val in props.items():
                    if isinstance(val, str):
                        val_lower = val.lower()
                        if any(kw in val_lower for kw in bad_keywords):
                            city.validation_issues.append(f"Bad keyword in {key}: {val}")
                            return False

            # Geographic bounds validation - must be in approximate US bounds
            all_coords = []
            for f in features:
                geom = f.get("geometry", {})
                gtype = geom.get("type", "")
                if gtype not in ("Polygon", "MultiPolygon"):
                    city.validation_issues.append(f"Invalid geometry: {gtype}")
                    return False

                coords = geom.get("coordinates", [])
                if gtype == "Polygon" and coords:
                    all_coords.extend(coords[0])
                elif gtype == "MultiPolygon" and coords:
                    for poly in coords:
                        if poly:
                            all_coords.extend(poly[0])

            # Check geographic bounds (continental US + Alaska + Hawaii)
            if all_coords:
                lons = [c[0] for c in all_coords if isinstance(c, list) and len(c) >= 2]
                lats = [c[1] for c in all_coords if isinstance(c, list) and len(c) >= 2]

                if lons and lats:
                    min_lon, max_lon = min(lons), max(lons)
                    min_lat, max_lat = min(lats), max(lats)

                    # US bounds: roughly -180 to -65 longitude, 18 to 72 latitude
                    # Allow some margin for projections
                    if min_lon > 0 or max_lon > 0:  # Eastern hemisphere = not US
                        city.validation_issues.append(f"Geographic bounds outside US: lon={min_lon:.1f} to {max_lon:.1f}")
                        return False
                    if min_lat < 15 or max_lat > 75:  # Too far north/south
                        city.validation_issues.append(f"Geographic bounds outside US: lat={min_lat:.1f} to {max_lat:.1f}")
                        return False

            # CRITICAL: Point-in-boundary validation
            # Verify city centroid falls within at least one district
            # This catches false positives where data is for wrong city
            city_centroid = await self._get_city_centroid(city)
            if city_centroid:
                if not self._point_in_any_feature(city_centroid, features):
                    city.validation_issues.append(
                        f"City centroid ({city_centroid[0]:.4f}, {city_centroid[1]:.4f}) "
                        f"not in any district boundary"
                    )
                    return False
                city.reasoning.append(f"Point-in-boundary: City centroid verified")
            else:
                # Could not get centroid - warn but don't fail
                city.reasoning.append("Point-in-boundary: Could not retrieve city centroid (skipped)")

            # DATA FRESHNESS: Extract metadata and validate data age
            # Redistricting happens every 10 years, but data should be relatively fresh
            metadata = await self._extract_arcgis_metadata(city.discovered_url, city)

            # Populate city metadata fields
            city.last_updated = metadata.get("last_updated")
            city.data_source_name = metadata.get("data_source_name")
            city.service_description = metadata.get("service_description")
            city.data_age_days = metadata.get("data_age_days")
            city.copyright_text = metadata.get("copyright_text")

            # Freshness validation thresholds
            # - Warn if data is older than 2 years (730 days)
            # - Flag as stale if older than 4 years (1460 days)
            WARN_AGE_DAYS = 730  # 2 years
            STALE_AGE_DAYS = 1460  # 4 years

            if city.data_age_days is not None:
                if city.data_age_days > STALE_AGE_DAYS:
                    city.validation_issues.append(
                        f"Data is stale: {city.data_age_days} days old (>{STALE_AGE_DAYS} days)"
                    )
                    city.confidence = max(city.confidence - 20, 30)  # Reduce confidence for stale data
                    city.reasoning.append(f"Freshness: STALE - data is {city.data_age_days // 365} years old")
                elif city.data_age_days > WARN_AGE_DAYS:
                    city.validation_issues.append(
                        f"Data may be outdated: {city.data_age_days} days old (>{WARN_AGE_DAYS} days)"
                    )
                    city.reasoning.append(f"Freshness: WARNING - data is {city.data_age_days // 365} years old")
                else:
                    city.reasoning.append(f"Freshness: OK - data is {city.data_age_days} days old")

            city.validated = True
            city.feature_count = count
            city.confidence = max(city.confidence, 80)
            city.reasoning.append(f"Validation: Passed ({count} features, bounds OK)")
            return True

        except Exception as e:
            city.validation_issues.append(f"Validation error: {e}")
            return False

    async def check_governance_structure(self, city: CityTarget) -> Optional[str]:
        """
        Check Ballotpedia for governance structure (at-large vs district).
        Returns 'at_large', 'district', or None if unknown.

        This is CRITICAL validation - no point searching for GIS data
        for cities that use at-large elections.
        """
        import re

        # Map state abbreviations to full names for Ballotpedia URLs
        STATE_NAMES = {
            "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
            "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
            "DC": "District_of_Columbia", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii",
            "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
            "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
            "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
            "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
            "NH": "New_Hampshire", "NJ": "New_Jersey", "NM": "New_Mexico", "NY": "New_York",
            "NC": "North_Carolina", "ND": "North_Dakota", "OH": "Ohio", "OK": "Oklahoma",
            "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode_Island", "SC": "South_Carolina",
            "SD": "South_Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
            "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West_Virginia",
            "WI": "Wisconsin", "WY": "Wyoming",
        }
        state_full = STATE_NAMES.get(city.state.upper(), city.state)
        url = f"https://ballotpedia.org/{city.name.replace(' ', '_')},_{state_full}"

        # CRITICAL: Ballotpedia requires browser-like headers to avoid 403
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
        }

        try:
            async with aiohttp.ClientSession(headers=headers) as session:
                async with session.get(url, timeout=15) as resp:
                    if resp.status != 200:
                        return None
                    html = await resp.text()

            # Look for at-large indicators
            at_large_patterns = [
                r'elected at.?large',
                r'at.?large election',
                r'all members are elected at.?large',
                r'City Council At-large',
            ]

            # Look for district indicators
            district_patterns = [
                r'elected from (\d+) districts',
                r'elected by the city\'s (\d+) districts',
                r'Council District [A-Z0-9]',
                r'City Council District \d',
                r'(\d+) are elected by district',
            ]

            html_lower = html.lower()

            # Check for at-large
            for pattern in at_large_patterns:
                if re.search(pattern, html_lower):
                    city.reasoning.append(f"Ballotpedia: At-large elections confirmed")
                    return "at_large"

            # Check for districts
            for pattern in district_patterns:
                match = re.search(pattern, html, re.IGNORECASE)
                if match:
                    city.reasoning.append(f"Ballotpedia: District-based elections confirmed")
                    return "district"

            # No clear signal
            return None

        except Exception as e:
            city.reasoning.append(f"Ballotpedia lookup failed: {e}")
            return None

    async def process_city(self, city: CityTarget) -> CityTarget:
        """Process a single city through the discovery pipeline"""
        city.timestamp = datetime.utcnow().isoformat() + "Z"

        # 1. Check registry
        if city.fips in self.registry:
            entry = self.registry[city.fips]
            city.discovered_url = entry["url"]
            city.discovery_method = "registry"
            city.feature_count = entry.get("feature_count")
            city.confidence = entry.get("confidence", 80)
            city.validated = True
            city.reasoning.append(f"Registry hit: {entry.get('name', city.name)}")
            return city

        city.reasoning.append("Registry miss")

        # 2. CRITICAL: Check governance structure BEFORE searching
        # This saves Gemini calls for cities with at-large elections
        governance = await self.check_governance_structure(city)
        if governance == "at_large":
            city.discovery_method = "at_large_confirmed"
            city.confidence = 90
            city.reasoning.append("Governance: At-large elections - no districts to map")
            return city

        # 3. Try city portal first (Tier 1 - highest authority)
        # City's own GIS portal is the most authoritative source
        if await self.discover_via_city_portal(city):
            await self.validate_geojson(city)
            # Triangulation for high-population cities (>100k) to verify against secondary source
            if city.validated and city.population >= 100000 and city.discovered_url:
                triangulation_result = await self._triangulate_sources(city, city.discovered_url)
                city.triangulated = triangulation_result["triangulated"]
                city.secondary_source = triangulation_result["secondary_source"]
                city.secondary_feature_count = triangulation_result["secondary_feature_count"]
                city.triangulation_match = triangulation_result["triangulation_match"]
                city.confidence += triangulation_result["confidence_adjustment"]
            return city

        # 4. Try ArcGIS API search (Tier 4 - lowest authority)
        if await self.discover_via_arcgis_api(city):
            await self.validate_geojson(city)
            # Triangulation for high-population cities (>100k) to verify against secondary source
            if city.validated and city.population >= 100000 and city.discovered_url:
                triangulation_result = await self._triangulate_sources(city, city.discovered_url)
                city.triangulated = triangulation_result["triangulated"]
                city.secondary_source = triangulation_result["secondary_source"]
                city.secondary_feature_count = triangulation_result["secondary_feature_count"]
                city.triangulation_match = triangulation_result["triangulation_match"]
                city.confidence += triangulation_result["confidence_adjustment"]
            return city

        # 5. Try state GIS clearinghouse (FREE and authoritative - tier 3)
        # State clearinghouses often have statewide ward/precinct data
        # This is tried BEFORE Gemini as it's free and authoritative
        if await self.discover_via_state_clearinghouse(city):
            await self.validate_geojson(city)
            # Triangulation for high-population cities (>100k) to verify against secondary source
            if city.validated and city.population >= 100000 and city.discovered_url:
                triangulation_result = await self._triangulate_sources(city, city.discovered_url)
                city.triangulated = triangulation_result["triangulated"]
                city.secondary_source = triangulation_result["secondary_source"]
                city.secondary_feature_count = triangulation_result["secondary_feature_count"]
                city.triangulation_match = triangulation_result["triangulation_match"]
                city.confidence += triangulation_result["confidence_adjustment"]
            return city

        # 6. Try Gemini grounded search (only for larger cities with confirmed/likely districts)
        if city.population >= 50000 or governance == "district":
            if await self.discover_via_gemini(city):
                await self.validate_geojson(city)
                # Triangulation for high-population cities (>100k) to verify against secondary source
                if city.validated and city.population >= 100000 and city.discovered_url:
                    triangulation_result = await self._triangulate_sources(city, city.discovered_url)
                    city.triangulated = triangulation_result["triangulated"]
                    city.secondary_source = triangulation_result["secondary_source"]
                    city.secondary_feature_count = triangulation_result["secondary_feature_count"]
                    city.triangulation_match = triangulation_result["triangulation_match"]
                    city.confidence += triangulation_result["confidence_adjustment"]
                return city
        else:
            city.reasoning.append(f"Skipped Gemini: pop {city.population:,} < 50k, governance unknown")

        # 7. Final classification based on what we know
        if city.population < 50000 and governance is None:
            city.discovery_method = "likely_at_large"
            city.confidence = 40
            city.reasoning.append(f"Population {city.population:,} < 50k: likely at-large governance")
        else:
            city.discovery_method = "no_public_data"
            city.confidence = 0
            city.reasoning.append("No public GIS data found after ArcGIS API + Gemini search")

        return city

    async def process_state(self, state: str) -> Dict[str, Any]:
        """Process all cities in a state"""
        logger.info(f"=== Processing {state} ===")

        # Fetch cities
        cities = await self.fetch_cities(state)
        if not cities:
            return {"state": state, "error": "No cities found"}

        # Process in parallel batches
        results = []
        for i in range(0, len(cities), self.parallel):
            batch = cities[i:i + self.parallel]
            batch_results = await asyncio.gather(
                *[self.process_city(city) for city in batch]
            )
            results.extend(batch_results)

            # Progress
            discovered = sum(1 for r in results if r.discovered_url)
            logger.info(f"  Progress: {len(results)}/{len(cities)} ({discovered} discovered)")

        # Generate report
        discovered = [r for r in results if r.discovered_url and r.validated]
        undiscovered = [r for r in results if not r.discovered_url]

        report = {
            "state": state,
            "total_cities": len(cities),
            "discovered": len(discovered),
            "undiscovered": len(undiscovered),
            "coverage_pct": len(discovered) / len(cities) * 100 if cities else 0,
            "by_method": {},
            "discoveries": [],
        }

        # Count by method
        for r in results:
            method = r.discovery_method or "none"
            report["by_method"][method] = report["by_method"].get(method, 0) + 1

        # Record discoveries for registry update
        for city in discovered:
            if city.discovery_method != "registry":
                self.discoveries.append(city)
                report["discoveries"].append({
                    "fips": city.fips,
                    "name": city.name,
                    "url": city.discovered_url,
                    "count": city.feature_count,
                    "method": city.discovery_method,
                })

        # Write provenance
        await self._write_provenance(results, state)

        logger.info(f"=== {state} Complete: {report['coverage_pct']:.1f}% coverage ===")
        return report

    async def _write_provenance(self, results: List[CityTarget], state: str):
        """Write provenance records"""
        PROVENANCE_DIR.mkdir(parents=True, exist_ok=True)

        provenance_file = PROVENANCE_DIR / f"{state.lower()}-{self.batch_id}.ndjson"

        with open(provenance_file, "w") as f:
            for city in results:
                record = ProvenanceRecord(
                    fips=city.fips,
                    name=city.name,
                    state=city.state,
                    population=city.population,
                    discovery_method=city.discovery_method or "none",
                    discovered_url=city.discovered_url,
                    feature_count=city.feature_count,
                    confidence=city.confidence,
                    authority_tier=city.authority_tier,
                    validated=city.validated,
                    validation_issues=city.validation_issues,
                    # Triangulation fields
                    triangulated=city.triangulated,
                    secondary_source=city.secondary_source,
                    secondary_feature_count=city.secondary_feature_count,
                    triangulation_match=city.triangulation_match,
                    # Data freshness metadata
                    last_updated=city.last_updated,
                    data_source_name=city.data_source_name,
                    service_description=city.service_description,
                    data_age_days=city.data_age_days,
                    copyright_text=city.copyright_text,
                    # Provenance metadata
                    reasoning=city.reasoning,
                    timestamp=city.timestamp or datetime.utcnow().isoformat() + "Z",
                    batch_id=self.batch_id,
                )
                f.write(json.dumps(record.to_dict()) + "\n")

        logger.info(f"Wrote provenance: {provenance_file}")

    async def export_discoveries(self):
        """Export new discoveries for registry update"""
        if not self.discoveries:
            logger.info("No new discoveries to export")
            return

        DISCOVERIES_DIR.mkdir(parents=True, exist_ok=True)
        export_file = DISCOVERIES_DIR / f"batch-{self.batch_id}.json"

        entries = []
        for city in self.discoveries:
            entries.append({
                "cityFips": city.fips,
                "cityName": city.name,
                "state": city.state,
                "portalType": "arcgis",
                "downloadUrl": city.discovered_url,
                "featureCount": city.feature_count,
                "lastVerified": city.timestamp,
                "confidence": city.confidence,
                "discoveredBy": "automated",
                "notes": f"Batch discovery via {city.discovery_method}. Reasoning: {'; '.join(city.reasoning)}",
            })

        with open(export_file, "w") as f:
            json.dump(entries, f, indent=2)

        logger.info(f"Exported {len(entries)} discoveries to {export_file}")

        # Also generate TypeScript snippet for manual merge
        ts_file = DISCOVERIES_DIR / f"batch-{self.batch_id}.ts"
        with open(ts_file, "w") as f:
            f.write("// Auto-generated registry entries\n")
            f.write("// Copy into known-portals.ts KNOWN_PORTALS object\n\n")
            for entry in entries:
                f.write(f"  '{entry['cityFips']}': {{\n")
                f.write(f"    cityFips: '{entry['cityFips']}',\n")
                f.write(f"    cityName: '{entry['cityName']}',\n")
                f.write(f"    state: '{entry['state']}',\n")
                f.write(f"    portalType: 'arcgis',\n")
                f.write(f"    downloadUrl: '{entry['downloadUrl']}',\n")
                f.write(f"    featureCount: {entry['featureCount']},\n")
                f.write(f"    lastVerified: '{entry['lastVerified']}',\n")
                f.write(f"    confidence: {entry['confidence']},\n")
                f.write(f"    discoveredBy: 'automated',\n")
                f.write(f"    notes: '{entry['notes'][:200]}',\n")
                f.write("  },\n\n")

        logger.info(f"Generated TypeScript snippet: {ts_file}")


async def main():
    import argparse

    parser = argparse.ArgumentParser(description="Autonomous Batch Discovery")
    parser.add_argument("--state", help="Single state to process (e.g., TX)")
    parser.add_argument("--all-states", action="store_true", help="Process all US states")
    parser.add_argument("--parallel", type=int, default=5, help="Parallel city processing")

    args = parser.parse_args()

    if not args.state and not args.all_states:
        parser.error("Must specify --state or --all-states")

    discovery = BatchDiscovery(parallel=args.parallel)
    await discovery.load_registry()

    if args.state:
        report = await discovery.process_state(args.state.upper())
        print(json.dumps(report, indent=2))

    elif args.all_states:
        reports = []
        for state in sorted(STATE_FIPS.keys()):
            report = await discovery.process_state(state)
            reports.append(report)

        # Summary
        total_cities = sum(r["total_cities"] for r in reports)
        total_discovered = sum(r["discovered"] for r in reports)
        print("\n" + "=" * 70)
        print("  US COVERAGE REPORT")
        print("=" * 70)
        print(f"Total cities (>=25k pop): {total_cities}")
        print(f"Discovered: {total_discovered}")
        print(f"Coverage: {total_discovered/total_cities*100:.1f}%")

    # Export discoveries
    await discovery.export_discoveries()


if __name__ == "__main__":
    asyncio.run(main())
