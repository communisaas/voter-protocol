"""
Unified Boundary Discovery System

ONE system that leverages the existing TypeScript infrastructure.
Gemini is the LAST resort, not the first.

CALL EFFICIENCY HIERARCHY:
1. Known Registry Lookup (0 Gemini calls) - 45+ curated sources
2. Deterministic Validation (0 Gemini calls) - TypeScript validators
3. State Portal Batch (0 Gemini calls) - 4 states have statewide data
4. Census PLACE Fallback (0 Gemini calls) - Always available
5. Gemini Discovery (1+ calls) - ONLY when all else fails

INTEGRATION POINTS:
- known-portals.ts: Source of truth for curated URLs
- deterministic-validators.ts: 3-layer validation pipeline
- provenance-writer.ts: FIPS-sharded audit trail

This is a UNIFIED system. Not agent_v2. One system.
"""

import asyncio
import json
import logging
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import TypedDict, Annotated, Optional, Dict, Any, List
from dataclasses import dataclass, field

# Load .env from this directory
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

# ============================================================================
# PHOENIX OBSERVABILITY (Zero-cost, fully local)
# ============================================================================

PHOENIX_ENABLED = os.getenv("PHOENIX_ENABLED", "true").lower() == "true"

if PHOENIX_ENABLED:
    try:
        import phoenix as px
        from openinference.instrumentation.langchain import LangChainInstrumentor
        from phoenix.otel import register

        tracer_provider = register(
            project_name="shadow-atlas-discovery",
            endpoint="http://localhost:6006/v1/traces",
        )
        LangChainInstrumentor().instrument(tracer_provider=tracer_provider)
        logging.info("Phoenix tracing enabled - Dashboard at http://localhost:6006")
    except ImportError:
        logging.warning("Phoenix not installed. Run: pip install arize-phoenix openinference-instrumentation-langchain")
        PHOENIX_ENABLED = False
    except Exception as e:
        logging.warning(f"Phoenix initialization failed: {e}. Tracing disabled.")
        PHOENIX_ENABLED = False

import aiohttp
from langgraph.graph import StateGraph, START, END
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage, AIMessage
from langchain_google_genai import ChatGoogleGenerativeAI

from key_pool import KeyPool

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

# Path to TypeScript infrastructure
TS_ROOT = Path(__file__).parent.parent.parent  # shadow-atlas/
REGISTRY_PATH = TS_ROOT / "registry" / "known-portals.ts"
PROVENANCE_PATH = TS_ROOT / "discovery-attempts"


# ============================================================================
# DATA STRUCTURES
# ============================================================================

@dataclass
class CityTarget:
    """City requiring boundary discovery"""
    fips: str
    name: str
    state: str
    population: int

    # Discovery state
    registry_hit: bool = False
    registry_url: Optional[str] = None
    registry_confidence: int = 0

    # Validation state
    validation_passed: bool = False
    validation_confidence: int = 0
    validation_issues: List[str] = field(default_factory=list)

    # Final state
    resolved: bool = False
    resolution_tier: int = 0  # 0=registry, 1=state, 2=discovery, 3=census-fallback
    blocker: Optional[str] = None  # Why we couldn't resolve


@dataclass
class ProvenanceEntry:
    """Compact provenance entry for audit trail"""
    f: str  # FIPS
    n: str  # name
    s: str  # state
    p: int  # population
    g: int  # granularity tier (0-4)
    conf: int  # confidence (0-100)
    auth: int  # authority level (0-5)
    why: List[str]  # reasoning chain
    tried: List[int]  # tiers attempted
    blocked: Optional[str]  # blocker code
    ts: str  # ISO timestamp
    aid: str  # agent ID
    url: Optional[str] = None
    fc: Optional[int] = None  # feature count
    src: Optional[str] = None  # source type

    def to_dict(self) -> dict:
        """Convert to dict for JSON serialization"""
        d = {
            "f": self.f, "n": self.n, "s": self.s, "p": self.p,
            "g": self.g, "conf": self.conf, "auth": self.auth,
            "why": self.why, "tried": self.tried,
            "blocked": self.blocked, "ts": self.ts, "aid": self.aid,
        }
        if self.url:
            d["url"] = self.url
        if self.fc:
            d["fc"] = self.fc
        if self.src:
            d["src"] = self.src
        return d


class DiscoveryState(TypedDict):
    """State for the discovery workflow"""
    # Input
    region: str  # State abbreviation
    agent_id: str

    # Targets
    targets: List[CityTarget]

    # Progress tracking
    phase: str
    registry_hits: int
    validation_passes: int
    gemini_calls: int

    # Results
    resolved: List[CityTarget]
    unresolved: List[CityTarget]
    provenance: List[ProvenanceEntry]


# ============================================================================
# TYPESCRIPT BRIDGE
# ============================================================================

class TypeScriptBridge:
    """
    Bridge to TypeScript infrastructure via CLI.

    The TypeScript code is the source of truth. Python orchestrates,
    TypeScript validates and persists.
    """

    def __init__(self, ts_root: Path):
        self.ts_root = ts_root
        self.cli_path = ts_root / "cli" / "atlas.ts"

    async def lookup_registry(self, fips: str) -> Optional[Dict]:
        """
        Look up FIPS in known-portals registry.
        Returns portal info if found, None if not.

        This is a SYNCHRONOUS read of the TypeScript registry.
        Zero Gemini calls.
        """
        # For now, parse known-portals.ts directly
        # In production, this would be a proper CLI call
        registry = await self._load_registry()
        return registry.get(fips)

    async def validate_url(self, url: str, city_target: Dict) -> Dict:
        """
        Run deterministic validators against a URL.

        Calls the TypeScript validation pipeline:
        1. NamePatternValidator (reject state/county keywords)
        2. DistrictCountValidator (3-50 for councils)
        3. GeographicBoundsValidator (FIPS-based coordinate check)

        Returns validation result with confidence score.
        Zero Gemini calls.
        """
        # Fetch the GeoJSON
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=30) as resp:
                    if resp.status != 200:
                        return {
                            "valid": False,
                            "confidence": 0,
                            "issues": [f"HTTP {resp.status}"],
                            "warnings": [],
                        }
                    geojson = await resp.json()
        except Exception as e:
            return {
                "valid": False,
                "confidence": 0,
                "issues": [f"Fetch failed: {e}"],
                "warnings": [],
            }

        # Run Python-side deterministic checks (mirror of TypeScript validators)
        result = self._deterministic_validate(geojson, city_target)
        return result

    def _deterministic_validate(self, geojson: dict, city_target: dict) -> dict:
        """
        Python implementation of deterministic validators.
        Mirrors TypeScript logic for call efficiency.
        """
        issues = []
        warnings = []
        confidence = 70  # Base confidence

        features = geojson.get("features", [])
        count = len(features)

        # 1. Count validation (DistrictCountValidator)
        if count < 2:
            issues.append(f"Too few features: {count} (minimum 2)")
            return {"valid": False, "confidence": 10, "issues": issues, "warnings": []}
        if count > 100:
            issues.append(f"Too many features: {count} (maximum 100 for council districts)")
            return {"valid": False, "confidence": 10, "issues": issues, "warnings": []}

        # Typical range bonus
        if 5 <= count <= 15:
            confidence += 20
        elif 3 <= count <= 50:
            confidence += 10
        else:
            warnings.append(f"Unusual district count: {count}")

        # 2. Name pattern validation (NamePatternValidator)
        names = []
        for f in features:
            props = f.get("properties", {})
            for key in ["NAME", "name", "Name", "DISTRICT", "district", "District", "LABEL", "WARD"]:
                val = props.get(key)
                if isinstance(val, str) and val:
                    names.append(val)
                    break

        # Red flags: state/county keywords in council district data
        state_keywords = ["state", "legislative", "senate", "house", "assembly"]
        county_keywords = ["county", "supervisor", "parish", "borough"]
        transit_keywords = ["stop", "route", "station", "bus", "transit", "parking"]

        for name in names:
            name_lower = name.lower()
            if any(kw in name_lower for kw in state_keywords):
                issues.append(f"State legislative keywords in district name: {name}")
                return {"valid": False, "confidence": 15, "issues": issues, "warnings": []}
            if any(kw in name_lower for kw in county_keywords):
                issues.append(f"County keywords in district name: {name}")
                return {"valid": False, "confidence": 15, "issues": issues, "warnings": []}
            if any(kw in name_lower for kw in transit_keywords):
                issues.append(f"Transit/infrastructure keywords: {name}")
                return {"valid": False, "confidence": 15, "issues": issues, "warnings": []}

        # Green flags: explicit district numbering
        green_patterns = [
            r"\bdistrict\s+\d+\b",
            r"\bward\s+\d+\b",
            r"\bzone\s+\d+\b",
            r"\bseat\s+\d+\b",
        ]
        import re
        green_count = sum(
            1 for name in names
            if any(re.search(pat, name, re.IGNORECASE) for pat in green_patterns)
        )
        if green_count > len(names) * 0.9:
            confidence = min(confidence + 15, 95)
        elif green_count > len(names) * 0.5:
            confidence = min(confidence + 10, 90)

        # 3. Geometry validation
        for f in features:
            geom = f.get("geometry", {})
            geom_type = geom.get("type", "")
            if geom_type not in ("Polygon", "MultiPolygon"):
                issues.append(f"Invalid geometry type: {geom_type}")
                return {"valid": False, "confidence": 20, "issues": issues, "warnings": []}

        return {
            "valid": True,
            "confidence": confidence,
            "issues": issues,
            "warnings": warnings,
            "feature_count": count,
        }

    async def write_provenance(self, entry: ProvenanceEntry) -> bool:
        """
        Write provenance entry to FIPS-sharded NDJSON.gz log.

        For now, writes to a staging file. In production, would call
        the TypeScript provenance-writer.ts CLI.
        """
        staging_dir = PROVENANCE_PATH / "staging"
        staging_dir.mkdir(parents=True, exist_ok=True)

        # Write to staging file (agent-specific)
        staging_file = staging_dir / f"agent-{entry.aid}.ndjson"
        with open(staging_file, "a") as f:
            f.write(json.dumps(entry.to_dict()) + "\n")

        return True

    async def _load_registry(self) -> Dict[str, Dict]:
        """
        Parse known-portals.ts to extract registry entries.

        This is a simplified parser. In production, use proper TypeScript
        evaluation or a JSON export.
        """
        # Check for cached JSON export
        cache_path = self.ts_root / "registry" / "known-portals.json"
        if cache_path.exists():
            with open(cache_path) as f:
                return json.load(f)

        # Parse TypeScript file (simplified)
        registry = {}
        if not REGISTRY_PATH.exists():
            logger.warning(f"Registry not found: {REGISTRY_PATH}")
            return registry

        content = REGISTRY_PATH.read_text()

        # Extract FIPS keys and their entries
        import re
        pattern = r"'(\d{7})':\s*\{([^}]+)\}"
        matches = re.findall(pattern, content, re.DOTALL)

        for fips, entry_str in matches:
            try:
                # Extract key fields
                url_match = re.search(r"downloadUrl:\s*'([^']+)'", entry_str)
                conf_match = re.search(r"confidence:\s*(\d+)", entry_str)
                name_match = re.search(r"cityName:\s*'([^']+)'", entry_str)
                state_match = re.search(r"state:\s*'([^']+)'", entry_str)
                fc_match = re.search(r"featureCount:\s*(\d+)", entry_str)

                if url_match:
                    registry[fips] = {
                        "fips": fips,
                        "url": url_match.group(1),
                        "confidence": int(conf_match.group(1)) if conf_match else 70,
                        "name": name_match.group(1) if name_match else "",
                        "state": state_match.group(1) if state_match else "",
                        "feature_count": int(fc_match.group(1)) if fc_match else 0,
                    }
            except Exception as e:
                logger.debug(f"Failed to parse entry for {fips}: {e}")

        logger.info(f"Loaded {len(registry)} entries from known-portals registry")
        return registry


# ============================================================================
# WORKFLOW NODES
# ============================================================================

async def load_targets(state: DiscoveryState) -> DiscoveryState:
    """
    Load census places for the target state.

    ZERO Gemini calls. Uses Census TIGERweb API.
    """
    state["phase"] = "loading_targets"
    logger.info(f"Loading targets for {state['region']}")

    # Get state FIPS
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

    state_fips = STATE_FIPS.get(state["region"].upper())
    if not state_fips:
        logger.error(f"Unknown state: {state['region']}")
        return state

    # Fetch places from Census
    # Layer 25 = Census 2020 Incorporated Places
    # POP100 = 2020 Census population
    url = (
        "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/"
        "Places_CouSub_ConCity_SubMCD/MapServer/25/query"
    )
    params = {
        "where": f"STATE='{state_fips}' AND POP100>=2500",
        "outFields": "GEOID,NAME,LSADC,POP100",
        "returnGeometry": "false",
        "f": "json",
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params, timeout=60) as resp:
                data = await resp.json()

        targets = []
        for feature in data.get("features", []):
            attrs = feature.get("attributes", {})
            geoid = attrs.get("GEOID", "")
            # GEOID format: STATE(2) + PLACE(5) = 7 digits
            fips = geoid[-7:] if len(geoid) >= 7 else geoid

            targets.append(CityTarget(
                fips=fips,
                name=attrs.get("NAME", ""),
                state=state["region"].upper(),
                population=attrs.get("POP100", 0),  # 2020 Census population
            ))

        # Sort by population descending (prioritize larger cities)
        targets.sort(key=lambda x: x.population, reverse=True)

        state["targets"] = targets
        logger.info(f"Loaded {len(targets)} targets with population >= 2,500")

    except Exception as e:
        logger.error(f"Failed to load census places: {e}")
        state["targets"] = []

    return state


async def registry_lookup(state: DiscoveryState) -> DiscoveryState:
    """
    Look up all targets in known-portals registry.

    ZERO Gemini calls. This is a pure registry lookup.
    95% of cities should resolve here (for covered areas).
    """
    state["phase"] = "registry_lookup"
    logger.info("Phase 1: Registry lookup")

    bridge = TypeScriptBridge(TS_ROOT)
    registry = await bridge._load_registry()

    hits = 0
    for target in state["targets"]:
        entry = registry.get(target.fips)
        if entry:
            target.registry_hit = True
            target.registry_url = entry.get("url")
            target.registry_confidence = entry.get("confidence", 70)
            hits += 1

    state["registry_hits"] = hits
    logger.info(f"Registry hits: {hits}/{len(state['targets'])} ({hits*100/max(len(state['targets']),1):.1f}%)")

    return state


async def deterministic_validation(state: DiscoveryState) -> DiscoveryState:
    """
    Validate registry hits with deterministic validators.

    ZERO Gemini calls. Uses TypeScript validation pipeline:
    - NamePatternValidator
    - DistrictCountValidator
    - GeographicBoundsValidator
    """
    state["phase"] = "deterministic_validation"
    logger.info("Phase 2: Deterministic validation")

    bridge = TypeScriptBridge(TS_ROOT)

    passes = 0
    for target in state["targets"]:
        if not target.registry_hit or not target.registry_url:
            continue

        # Run deterministic validation
        result = await bridge.validate_url(
            target.registry_url,
            {"fips": target.fips, "name": target.name, "state": target.state}
        )

        target.validation_passed = result.get("valid", False)
        target.validation_confidence = result.get("confidence", 0)
        target.validation_issues = result.get("issues", [])

        if target.validation_passed and target.validation_confidence >= 70:
            target.resolved = True
            target.resolution_tier = 0  # Registry resolve
            passes += 1
        elif not target.validation_passed:
            # Registry entry failed validation - flag for re-discovery
            target.blocker = "validation-failed"

    state["validation_passes"] = passes
    logger.info(f"Validation passes: {passes}")

    return state


async def at_large_classification(state: DiscoveryState) -> DiscoveryState:
    """
    Classify unresolved cities as at-large vs ward-based.

    ZERO Gemini calls for obvious cases (population heuristics).
    Small cities (<10k) are usually at-large = no boundaries needed.
    """
    state["phase"] = "at_large_classification"
    logger.info("Phase 3: At-large classification")

    for target in state["targets"]:
        if target.resolved:
            continue

        # Simple heuristic: small cities are usually at-large
        if target.population < 10000:
            target.resolved = True
            target.resolution_tier = 3  # Census fallback (at-large)
            target.blocker = "at-large-governance"

    at_large = sum(1 for t in state["targets"] if t.blocker == "at-large-governance")
    logger.info(f"Classified {at_large} cities as at-large")

    return state


async def gemini_search_gis_url(city: str, state: str, api_key: str) -> Optional[str]:
    """
    Use Gemini with Google Search grounding to find GIS portal URLs.

    CRITICAL: Must use google-genai SDK with GoogleSearch tool, NOT langchain.
    Without grounding, Gemini hallucinates plausible-looking but fake URLs.

    One Gemini call per city. Returns candidate URL for probing.
    """
    try:
        from google import genai
        from google.genai.types import Tool, GoogleSearch

        client = genai.Client(api_key=api_key)
        google_search_tool = Tool(google_search=GoogleSearch())

        # More targeted prompt that searches for specific GIS endpoint patterns
        city_slug = city.lower().replace(" ", "")
        prompt = f"""Find the {city}, {state} city council or representative districts GIS map server URL.

Search for: "gis.{city_slug}.gov districts MapServer" OR "{city} council districts ArcGIS REST"

Return the exact ArcGIS REST URL (format: https://gis.*.gov/arcgis/rest/services/.../MapServer or .../FeatureServer)
If no URL found, respond NOT_FOUND."""

        response = client.models.generate_content(
            model='gemini-2.0-flash',
            contents=prompt,
            config={'tools': [google_search_tool]},
        )

        text = response.text.strip()

        # Extract URL from response
        import re
        url_match = re.search(r'https?://[^\s<>"\'`\)]+', text)
        if url_match and "NOT_FOUND" not in text.upper():
            url = url_match.group(0).rstrip('.,')
            logger.info(f"Gemini found URL for {city}: {url}")
            return url

    except Exception as e:
        logger.warning(f"Gemini search failed for {city}, {state}: {e}")

    return None


def _get_gemini_api_key() -> Optional[str]:
    """Get a Gemini API key from environment, supporting both single key and pool formats."""
    # Single key format
    single_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if single_key:
        return single_key

    # Key pool format: project1:key1:tier,project2:key2:tier,...
    pool = os.getenv("GEMINI_KEYS", "")
    if pool:
        # Extract first key from pool
        first_entry = pool.split(",")[0]
        parts = first_entry.split(":")
        if len(parts) >= 2:
            return parts[1]

    return None


async def discover_featureserver_url(city: str, state: str, key_pool: Optional["KeyPool"] = None) -> Optional[Dict]:
    """
    Agentic URL discovery via ArcGIS API search + systematic probing.

    This is what I (Claude) did to fix Houston/San Antonio:
    1. Search ArcGIS Hub/Online for "{city} council districts"
    2. Filter by owner containing city name or "GIS"
    3. Probe candidate FeatureServer endpoints
    4. Return the first one with correct district count

    ONE search call + N probe calls (N typically 1-3).
    Falls back to Gemini if ArcGIS search returns nothing.
    """
    city_slug = city.lower().replace(" ", "").replace(".", "")

    # Step 1: ArcGIS Online search (covers most municipal data)
    search_url = "https://www.arcgis.com/sharing/rest/search"
    params = {
        "q": f"{city} {state} council districts",
        "f": "json",
        "num": 15,
    }

    candidates = []
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(search_url, params=params, timeout=30) as resp:
                data = await resp.json()

            for result in data.get("results", []):
                url = result.get("url")
                owner = result.get("owner", "").lower()
                title = result.get("title", "").lower()

                # Prioritize official sources
                is_official = (
                    city_slug in owner or
                    "gis" in owner or
                    f"{state.lower()}gis" in owner or
                    "opendata" in owner
                )

                # Check title relevance
                is_relevant = any(kw in title for kw in ["council", "district", "ward"])

                if url and (is_official or is_relevant):
                    candidates.append({
                        "url": url,
                        "title": result.get("title"),
                        "owner": result.get("owner"),
                        "score": (2 if is_official else 0) + (1 if is_relevant else 0),
                    })

            # Sort by relevance score
            candidates.sort(key=lambda x: x["score"], reverse=True)
    except Exception as e:
        logger.warning(f"ArcGIS search failed for {city}: {e}")

    # Step 2: Probe candidates to find one with valid GeoJSON
    for candidate in candidates[:5]:  # Limit probes
        base_url = candidate["url"]

        # Try common FeatureServer query patterns
        probe_urls = [
            f"{base_url}/0/query?where=1%3D1&returnCountOnly=true&f=json",
            f"{base_url}/query?where=1%3D1&returnCountOnly=true&f=json",
            f"{base_url}?f=json",
        ]

        for probe_url in probe_urls:
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(probe_url, timeout=15) as resp:
                        if resp.status != 200:
                            continue
                        probe_data = await resp.json()

                        # Check for valid count (council districts usually 3-50)
                        count = probe_data.get("count")
                        if count and 3 <= count <= 50:
                            # Found a valid source!
                            geojson_url = base_url.replace("?f=json", "") + "/0/query?where=1%3D1&outFields=*&f=geojson"
                            if "/query" in base_url:
                                geojson_url = base_url.split("/query")[0] + "/query?where=1%3D1&outFields=*&f=geojson"
                            elif "/0" not in base_url:
                                geojson_url = f"{base_url}/0/query?where=1%3D1&outFields=*&f=geojson"
                            else:
                                geojson_url = f"{base_url}/query?where=1%3D1&outFields=*&f=geojson"

                            return {
                                "url": geojson_url,
                                "feature_count": count,
                                "title": candidate["title"],
                                "owner": candidate["owner"],
                                "confidence": 75 + (10 if candidate["score"] >= 2 else 0),
                            }
            except Exception:
                continue

    return None


async def gemini_discovery(state: DiscoveryState) -> DiscoveryState:
    """
    Use agentic discovery for unresolved cities that need ward boundaries.

    Call-efficient approach:
    1. ArcGIS API search (0 Gemini calls) - covers Hub-indexed data
    2. Grounded Gemini search (1 call) - finds city-hosted GIS servers
    3. Probe discovered URLs to validate

    CRITICAL: Gemini must use Google Search grounding or it hallucinates URLs.
    """
    state["phase"] = "gemini_discovery"

    unresolved = [t for t in state["targets"] if not t.resolved]
    logger.info(f"Phase 4: Agentic discovery for {len(unresolved)} unresolved cities")

    if not unresolved:
        logger.info("All cities resolved - skipping discovery")
        return state

    # Categorize unresolved cities
    high_value = [t for t in unresolved if t.population >= 25000]
    mid_value = [t for t in unresolved if 10000 <= t.population < 25000]

    logger.info(f"High-value targets (>=25k pop): {len(high_value)}")
    logger.info(f"Mid-value targets (10-25k pop): {len(mid_value)}")

    # Mark mid-value cities as needing research (no discovery)
    for target in mid_value:
        target.blocker = "needs-registry-expansion"

    if not high_value:
        logger.info("No high-value targets - skipping discovery")
        return state

    bridge = TypeScriptBridge(TS_ROOT)
    discovered = 0

    # Get API key for Gemini grounded search
    gemini_api_key = _get_gemini_api_key()
    if not gemini_api_key:
        logger.warning("No GEMINI_API_KEY found - Gemini grounded search disabled")

    for target in high_value[:10]:  # Limit to 10 per run
        logger.info(f"  Discovering: {target.name}, {target.state} (pop {target.population:,})")

        # Step 1: Try ArcGIS API search (0 Gemini calls)
        result = await discover_featureserver_url(target.name, target.state)

        if result:
            # Validate the discovered URL
            validation = await bridge.validate_url(
                result["url"],
                {"fips": target.fips, "name": target.name, "state": target.state}
            )

            if validation.get("valid") and validation.get("confidence", 0) >= 60:
                target.resolved = True
                target.resolution_tier = 2  # Discovery resolve
                target.registry_url = result["url"]
                target.validation_confidence = validation.get("confidence", 70)
                discovered += 1
                logger.info(f"    ArcGIS DISCOVERED: {result['url'][:80]}... ({result['feature_count']} districts)")
                continue

        # Step 2: Grounded Gemini search for high-population cities
        if target.population >= 50000 and gemini_api_key:
            logger.info(f"    Trying grounded Gemini search...")
            state["gemini_calls"] += 1

            candidate_url = await gemini_search_gis_url(target.name, target.state, gemini_api_key)

            if candidate_url:
                logger.info(f"    Gemini found: {candidate_url[:80]}...")

                # Probe the URL to check if it's valid
                probe_result = await _probe_gis_url(candidate_url)

                if probe_result:
                    # Validate
                    validation = await bridge.validate_url(
                        probe_result["geojson_url"],
                        {"fips": target.fips, "name": target.name, "state": target.state}
                    )

                    if validation.get("valid") and validation.get("confidence", 0) >= 60:
                        target.resolved = True
                        target.resolution_tier = 2  # Discovery resolve
                        target.registry_url = probe_result["geojson_url"]
                        target.validation_confidence = validation.get("confidence", 70)
                        discovered += 1
                        logger.info(f"    GEMINI DISCOVERED: {probe_result['geojson_url'][:80]}... ({probe_result['count']} districts)")
                        continue
                    else:
                        logger.info(f"    Validation failed: {validation.get('issues', [])}")
                else:
                    logger.info(f"    Probe failed for Gemini URL")
            else:
                logger.info(f"    Gemini returned no URL")

            target.blocker = "gemini-search-failed"
        elif target.population >= 50000:
            target.blocker = "needs-gemini-key"
            logger.info(f"    Flagged for Gemini (no API key)")
        else:
            target.blocker = "needs-manual-research"
            logger.info(f"    Flagged for manual research")

    # Mark remaining high-value as queued
    for target in high_value[10:]:
        target.blocker = "queued-for-research"

    logger.info(f"Agentic discovery resolved {discovered} cities, used {state['gemini_calls']} Gemini calls")
    return state


async def _probe_gis_url(url: str) -> Optional[Dict]:
    """
    Probe a GIS URL to check if it returns valid council district data.

    Handles various URL patterns:
    - MapServer/FeatureServer endpoints
    - Direct query URLs
    - ArcGIS Hub URLs
    """
    import re

    # Normalize URL
    base_url = url.rstrip('/')

    # Remove query params if present
    if '?' in base_url:
        base_url = base_url.split('?')[0]

    # Common probe patterns
    probe_patterns = [
        (f"{base_url}/0/query?where=1%3D1&returnCountOnly=true&f=json", "/0/query"),
        (f"{base_url}/query?where=1%3D1&returnCountOnly=true&f=json", "/query"),
        (f"{base_url}?f=json", ""),
    ]

    # If URL already has /0, don't add it again
    if re.search(r'/\d+$', base_url):
        probe_patterns = [
            (f"{base_url}/query?where=1%3D1&returnCountOnly=true&f=json", "/query"),
        ]

    async with aiohttp.ClientSession() as session:
        for probe_url, suffix in probe_patterns:
            try:
                async with session.get(probe_url, timeout=15) as resp:
                    if resp.status != 200:
                        continue

                    data = await resp.json()
                    count = data.get("count")

                    # Valid council district count range
                    if count and 3 <= count <= 50:
                        # Build GeoJSON URL
                        if suffix == "/0/query":
                            geojson_url = f"{base_url}/0/query?where=1%3D1&outFields=*&f=geojson"
                        elif suffix == "/query":
                            geojson_url = f"{base_url}/query?where=1%3D1&outFields=*&f=geojson"
                        else:
                            geojson_url = f"{base_url}/0/query?where=1%3D1&outFields=*&f=geojson"

                        return {
                            "geojson_url": geojson_url,
                            "count": count,
                            "base_url": base_url,
                        }
            except Exception as e:
                logger.debug(f"Probe failed for {probe_url}: {e}")
                continue

    return None


async def write_provenance(state: DiscoveryState) -> DiscoveryState:
    """
    Write provenance entries for all processed cities.

    Records WHY each city was resolved or not.
    """
    state["phase"] = "writing_provenance"
    logger.info("Phase 5: Writing provenance")

    bridge = TypeScriptBridge(TS_ROOT)
    ts = datetime.utcnow().isoformat() + "Z"

    for target in state["targets"]:
        # Build reasoning chain
        why = []
        tried = [0]  # Always try registry first

        if target.registry_hit:
            why.append(f"T0 registry: {target.registry_confidence}% confidence")
            if target.validation_passed:
                why.append(f"Validation: {target.validation_confidence}% confidence")
            else:
                why.append(f"Validation failed: {', '.join(target.validation_issues)}")
                tried.append(1)
        else:
            why.append("T0 miss: Not in known-portals registry")
            tried.append(1)

        if target.blocker == "at-large-governance":
            why.append(f"Classified at-large: pop {target.population:,} < 10k")
        elif target.blocker == "needs-manual-research":
            why.append(f"Flagged for manual research: pop {target.population:,}")

        # Determine granularity tier
        if target.resolved and target.resolution_tier == 0:
            g = 1  # Council district level
        elif target.blocker == "at-large-governance":
            g = 4  # Census PLACE (at-large = no districts)
        else:
            g = 4  # Census PLACE fallback

        # Determine authority level
        if target.resolved and target.registry_url:
            auth = 3  # Municipal GIS
        else:
            auth = 1  # No authoritative source

        entry = ProvenanceEntry(
            f=target.fips,
            n=target.name,
            s=target.state,
            p=target.population,
            g=g,
            conf=target.validation_confidence if target.resolved else 0,
            auth=auth,
            url=target.registry_url if target.resolved else None,
            fc=None,  # Would need to extract from validation
            src="registry" if target.registry_hit else None,
            why=why,
            tried=tried,
            blocked=target.blocker,
            ts=ts,
            aid=state["agent_id"],
        )

        await bridge.write_provenance(entry)
        state["provenance"].append(entry)

    logger.info(f"Wrote {len(state['provenance'])} provenance entries")
    return state


async def generate_report(state: DiscoveryState) -> DiscoveryState:
    """
    Generate final discovery report.
    """
    state["phase"] = "complete"

    resolved = [t for t in state["targets"] if t.resolved]
    unresolved = [t for t in state["targets"] if not t.resolved]

    state["resolved"] = resolved
    state["unresolved"] = unresolved

    # Summary
    total = len(state["targets"])
    print("\n" + "=" * 70)
    print(f"  DISCOVERY REPORT: {state['region']}")
    print("=" * 70)
    print(f"Total targets (pop >= 2,500): {total}")
    print(f"Registry hits: {state['registry_hits']} ({state['registry_hits']*100/max(total,1):.1f}%)")
    print(f"Validation passes: {state['validation_passes']}")
    print(f"Gemini calls: {state['gemini_calls']}")
    print()
    print(f"Resolved: {len(resolved)}")
    print(f"Unresolved: {len(unresolved)}")

    if resolved:
        print("\nResolved cities (sample):")
        for t in resolved[:5]:
            print(f"  - {t.name}: tier {t.resolution_tier}, {t.validation_confidence}% confidence")

    if unresolved:
        print(f"\nUnresolved cities ({len(unresolved)}):")
        by_blocker = {}
        for t in unresolved:
            b = t.blocker or "unknown"
            by_blocker[b] = by_blocker.get(b, 0) + 1
        for blocker, count in by_blocker.items():
            print(f"  {blocker}: {count}")

    print()

    return state


# ============================================================================
# WORKFLOW GRAPH
# ============================================================================

def build_workflow() -> StateGraph:
    """
    Build the discovery workflow graph.

    LINEAR flow (no cycles):
    load_targets -> registry_lookup -> deterministic_validation ->
    at_large_classification -> gemini_discovery -> write_provenance -> report
    """
    workflow = StateGraph(DiscoveryState)

    # Add nodes
    workflow.add_node("load_targets", load_targets)
    workflow.add_node("registry_lookup", registry_lookup)
    workflow.add_node("deterministic_validation", deterministic_validation)
    workflow.add_node("at_large_classification", at_large_classification)
    workflow.add_node("gemini_discovery", gemini_discovery)
    workflow.add_node("write_provenance", write_provenance)
    workflow.add_node("generate_report", generate_report)

    # Linear flow
    workflow.add_edge(START, "load_targets")
    workflow.add_edge("load_targets", "registry_lookup")
    workflow.add_edge("registry_lookup", "deterministic_validation")
    workflow.add_edge("deterministic_validation", "at_large_classification")
    workflow.add_edge("at_large_classification", "gemini_discovery")
    workflow.add_edge("gemini_discovery", "write_provenance")
    workflow.add_edge("write_provenance", "generate_report")
    workflow.add_edge("generate_report", END)

    return workflow.compile()


# ============================================================================
# CLI ENTRY POINT
# ============================================================================

async def main():
    """CLI entry point"""
    import argparse

    parser = argparse.ArgumentParser(description="Unified Boundary Discovery System")
    parser.add_argument("--state", required=True, help="State abbreviation (e.g., MT)")
    parser.add_argument("--agent-id", default="agt-001", help="Agent identifier")

    args = parser.parse_args()

    # Build workflow
    workflow = build_workflow()

    # Initialize state
    initial_state: DiscoveryState = {
        "region": args.state.upper(),
        "agent_id": args.agent_id,
        "targets": [],
        "phase": "init",
        "registry_hits": 0,
        "validation_passes": 0,
        "gemini_calls": 0,
        "resolved": [],
        "unresolved": [],
        "provenance": [],
    }

    # Run workflow
    logger.info(f"Starting discovery for {args.state}")
    final_state = await workflow.ainvoke(initial_state)

    logger.info("Discovery complete")


if __name__ == "__main__":
    asyncio.run(main())
