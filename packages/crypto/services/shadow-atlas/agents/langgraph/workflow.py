"""
LangGraph Discovery Workflow

Autonomous boundary discovery using fan-out/fan-in parallelism
with multi-project key rotation for free tier scaling.

Usage:
    python workflow.py --region US-MT
    python workflow.py --region US-MT --webhook https://hooks.slack.com/...
"""

import asyncio
import logging
import os
import json
import time
from typing import TypedDict, Annotated, Literal
from operator import add

from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver
from langchain_google_genai import ChatGoogleGenerativeAI

from key_pool import KeyPool, AllKeysExhaustedError
from state import (
    DiscoveryPhase, GovernanceType, Confidence, SourceType,
    Place, GovernanceClassification, CandidateUrl, ValidatedBoundary,
    DiscoveryError, create_initial_state, calculate_summary
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# US State FIPS codes
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


class DiscoveryState(TypedDict):
    """TypedDict for LangGraph state with reducers"""
    region: str
    phase: DiscoveryPhase
    current_place_index: int
    places: Annotated[list, add]
    classifications: Annotated[list, add]
    candidate_urls: Annotated[list, add]
    validated_boundaries: Annotated[list, add]
    errors: Annotated[list, add]
    retry_queue: list
    started_at: float
    last_checkpoint: float
    api_call_count: int
    estimated_cost: float
    summary: dict | None
    progress_message: str
    progress_percent: float


class NotificationManager:
    """Send notifications via webhook"""

    def __init__(self, webhook_url: str | None = None):
        self.webhook_url = webhook_url or os.environ.get("DISCOVERY_WEBHOOK")

    async def send(self, message: str, data: dict | None = None):
        """Send notification to configured webhook"""
        if not self.webhook_url:
            logger.info(f"[Notification] {message}")
            return

        import aiohttp

        payload = {
            "text": message,
            "timestamp": time.time(),
        }
        if data:
            payload["data"] = data

        try:
            async with aiohttp.ClientSession() as session:
                # Support both Slack and Discord webhook formats
                if "discord" in self.webhook_url:
                    payload = {"content": message, "embeds": [{"fields": [
                        {"name": k, "value": str(v), "inline": True}
                        for k, v in (data or {}).items()
                    ]}]}
                async with session.post(self.webhook_url, json=payload) as resp:
                    if resp.status >= 400:
                        logger.warning(f"Webhook failed: {resp.status}")
        except Exception as e:
            logger.warning(f"Webhook error: {e}")


class GeminiProvider:
    """Gemini API wrapper with key rotation"""

    def __init__(self, key_pool: KeyPool):
        self.key_pool = key_pool
        self.total_cost = 0.0
        self.total_calls = 0

    async def generate(
        self,
        prompt: str,
        system_prompt: str | None = None,
        model: str = "gemini-2.5-flash",
        max_retries: int = 5
    ) -> str:
        """Generate text with automatic key rotation and retry"""
        last_error = None

        for attempt in range(max_retries):
            try:
                async with self.key_pool.acquire() as key_info:
                    llm = ChatGoogleGenerativeAI(
                        model=model,
                        google_api_key=key_info.key,
                        temperature=0.3,
                    )

                    messages = []
                    if system_prompt:
                        messages.append(("system", system_prompt))
                    messages.append(("human", prompt))

                    response = await llm.ainvoke(messages)
                    self.total_calls += 1

                    # Estimate cost (Flash: $0.30/1M input, $2.50/1M output)
                    input_tokens = len(prompt) / 4
                    output_tokens = len(response.content) / 4
                    self.total_cost += (input_tokens * 0.30 + output_tokens * 2.50) / 1_000_000

                    return response.content

            except AllKeysExhaustedError as e:
                logger.warning(f"All keys exhausted, waiting {e.soonest_retry_ms/1000:.1f}s")
                await asyncio.sleep(e.soonest_retry_ms / 1000)
                last_error = e

            except Exception as e:
                last_error = e
                if "429" in str(e) or "quota" in str(e).lower():
                    # Rate limited - key pool handles marking
                    wait = min(2 ** attempt * 2, 60)
                    logger.warning(f"Rate limited, retry {attempt+1}/{max_retries} in {wait}s")
                    await asyncio.sleep(wait)
                else:
                    raise

        raise last_error or Exception("Max retries exceeded")


# =============================================================================
# Workflow Nodes
# =============================================================================

async def load_places(state: DiscoveryState) -> dict:
    """Load places from Census TIGERweb API"""
    import aiohttp

    region = state["region"]
    parts = region.split("-")
    if len(parts) != 2:
        raise ValueError(f"Invalid region format: {region}")

    country, subdivision = parts

    if country != "US":
        raise ValueError(f"Country {country} not yet supported")

    fips = STATE_FIPS.get(subdivision)
    if not fips:
        raise ValueError(f"Unknown US state: {subdivision}")

    url = (
        "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/0/query"
        f"?where=STATE='{fips}'&outFields=GEOID,NAME,LSAD,POPULATION&f=json"
    )

    async with aiohttp.ClientSession() as session:
        async with session.get(url, timeout=60) as resp:
            data = await resp.json()

    places = []
    for feature in data.get("features", []):
        attrs = feature.get("attributes", {})
        places.append({
            "id": attrs.get("GEOID", ""),
            "name": attrs.get("NAME", ""),
            "state": subdivision,
            "country_code": country,
            "population": attrs.get("POPULATION", 0),
            "place_type": attrs.get("LSAD", ""),
        })

    logger.info(f"Loaded {len(places)} places for {region}")

    return {
        "places": places,
        "phase": DiscoveryPhase.LOADING_PLACES,
        "progress_message": f"Loaded {len(places)} places",
        "progress_percent": 10.0,
    }


async def classify_governance_batch(state: DiscoveryState, gemini: GeminiProvider, notifier: NotificationManager) -> dict:
    """
    Classify governance types for places using parallel fan-out.

    Uses semaphore to limit concurrency per free tier limits.
    """
    places = state["places"]
    existing_ids = {c["place_id"] for c in state.get("classifications", [])}
    to_classify = [p for p in places if p["id"] not in existing_ids]

    if not to_classify:
        return {"phase": DiscoveryPhase.CLASSIFYING_GOVERNANCE}

    # Semaphore limits concurrent requests to avoid rate limits
    # Free tier: 10 RPM per project, so with 3 projects = 30 RPM effective
    key_count = len(gemini.key_pool._keys) if hasattr(gemini.key_pool, '_keys') else 1
    semaphore = asyncio.Semaphore(min(key_count * 8, 30))  # Stay under RPM limit

    system_prompt = """You are an expert on US municipal governance structures.

Given a city name and state, determine its governance type:
- "ward": City council members elected from geographic wards/districts
- "district": Same as ward but called districts (common in consolidated city-counties)
- "commission": City commission form with commissioners elected from districts
- "at-large": All council members elected at-large (citywide, no geographic districts)

For small cities (<5000 population), assume "at-large" unless you have specific knowledge.

Respond in JSON format ONLY:
{"governanceType": "ward"|"district"|"commission"|"at-large", "expectedDistricts": <number>, "confidence": "verified"|"inferred", "reasoning": "<brief>"}"""

    async def classify_one(place: dict) -> dict:
        async with semaphore:
            try:
                prompt = f"City: {place['name']}, {place['state']}\nPopulation: {place.get('population', 'unknown')}"
                response = await gemini.generate(prompt, system_prompt, model="gemini-2.5-flash")

                # Parse JSON from response
                import re
                match = re.search(r'\{.*\}', response, re.DOTALL)
                if match:
                    parsed = json.loads(match.group())
                    return {
                        "place_id": place["id"],
                        "place_name": place["name"],
                        "governance_type": parsed.get("governanceType", "unknown"),
                        "expected_districts": parsed.get("expectedDistricts", 0),
                        "confidence": parsed.get("confidence", "inferred"),
                        "source": "gemini-classification",
                        "reasoning": parsed.get("reasoning", ""),
                    }
            except Exception as e:
                logger.warning(f"Classification error for {place['name']}: {e}")

            # Fallback for small places
            return {
                "place_id": place["id"],
                "place_name": place["name"],
                "governance_type": "at-large" if place.get("population", 0) < 5000 else "unknown",
                "expected_districts": 0,
                "confidence": "inferred",
                "source": "population-heuristic",
                "reasoning": f"Population {place.get('population', 'unknown')}",
            }

    # Fan-out: classify all places in parallel
    classifications = await asyncio.gather(*[classify_one(p) for p in to_classify])

    await notifier.send(f"Classified {len(classifications)} places", {
        "region": state["region"],
        "ward_based": sum(1 for c in classifications if c["governance_type"] not in ("at-large", "unknown")),
    })

    return {
        "classifications": list(classifications),
        "phase": DiscoveryPhase.CLASSIFYING_GOVERNANCE,
        "api_call_count": state.get("api_call_count", 0) + len(classifications),
        "estimated_cost": gemini.total_cost,
        "progress_message": f"Classified {len(classifications)} places",
        "progress_percent": 40.0,
    }


async def search_sources_batch(state: DiscoveryState, notifier: NotificationManager) -> dict:
    """
    Search for boundary sources in parallel across multiple providers.

    Fan-out pattern: search ArcGIS Hub, State GIS, etc. concurrently.
    """
    import aiohttp

    classifications = state.get("classifications", [])
    ward_based = [
        c for c in classifications
        if c["governance_type"] not in ("at-large", "unknown")
    ]

    if not ward_based:
        return {"phase": DiscoveryPhase.SEARCHING_SOURCES}

    existing_urls = {u["place_id"] for u in state.get("candidate_urls", [])}
    to_search = [c for c in ward_based if c["place_id"] not in existing_urls]

    semaphore = asyncio.Semaphore(20)  # Limit concurrent HTTP requests

    async def search_arcgis(place: dict) -> list[dict]:
        """Search ArcGIS Hub for boundary data"""
        async with semaphore:
            try:
                search_url = (
                    "https://hub.arcgis.com/api/v3/datasets"
                    f"?q={place['place_name']}+ward+district+boundary"
                    "&filter[type]=Feature+Service"
                    "&page[size]=5"
                )

                async with aiohttp.ClientSession() as session:
                    async with session.get(search_url, timeout=30) as resp:
                        if resp.status != 200:
                            return []
                        data = await resp.json()

                candidates = []
                for item in data.get("data", []):
                    attrs = item.get("attributes", {})
                    url = attrs.get("url", "")
                    if url:
                        candidates.append({
                            "place_id": place["place_id"],
                            "url": f"{url}/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson",
                            "source": "arcgis",
                            "layer_name": attrs.get("name", "Unknown"),
                            "confidence": 0.7,
                            "discovered_at": time.time(),
                        })
                return candidates

            except Exception as e:
                logger.debug(f"ArcGIS search error for {place['place_name']}: {e}")
                return []

    # Fan-out: search all places in parallel
    all_results = await asyncio.gather(*[search_arcgis(p) for p in to_search])

    # Flatten results
    candidate_urls = [url for results in all_results for url in results]

    await notifier.send(f"Found {len(candidate_urls)} candidate URLs", {
        "region": state["region"],
        "places_searched": len(to_search),
    })

    return {
        "candidate_urls": candidate_urls,
        "phase": DiscoveryPhase.SEARCHING_SOURCES,
        "progress_message": f"Found {len(candidate_urls)} candidates",
        "progress_percent": 60.0,
    }


async def validate_urls_batch(state: DiscoveryState, notifier: NotificationManager) -> dict:
    """
    Validate discovered URLs return valid GeoJSON.

    Fan-out: validate all URLs in parallel with concurrency limit.
    """
    import aiohttp

    candidates = state.get("candidate_urls", [])
    existing = {b["url"] for b in state.get("validated_boundaries", [])}
    to_validate = [c for c in candidates if c["url"] not in existing]

    if not to_validate:
        return {"phase": DiscoveryPhase.VALIDATING_URLS}

    semaphore = asyncio.Semaphore(10)  # Limit concurrent validations

    async def validate_one(candidate: dict) -> dict | None:
        async with semaphore:
            try:
                start = time.time()
                async with aiohttp.ClientSession() as session:
                    async with session.get(
                        candidate["url"],
                        timeout=30,
                        headers={"Accept": "application/json"}
                    ) as resp:
                        if resp.status != 200:
                            return None
                        data = await resp.json()

                features = data.get("features", [])
                if not features:
                    return None

                # Find place name from classifications
                place_name = candidate.get("layer_name", candidate["place_id"])
                for c in state.get("classifications", []):
                    if c["place_id"] == candidate["place_id"]:
                        place_name = c["place_name"]
                        break

                return {
                    "place_id": candidate["place_id"],
                    "place_name": place_name,
                    "url": candidate["url"],
                    "format": "geojson",
                    "feature_count": len(features),
                    "geometry_type": features[0].get("geometry", {}).get("type", "unknown"),
                    "validated_at": time.time(),
                    "response_time_ms": (time.time() - start) * 1000,
                }

            except Exception as e:
                logger.debug(f"Validation error for {candidate['url']}: {e}")
                return None

    # Fan-out: validate all URLs in parallel
    results = await asyncio.gather(*[validate_one(c) for c in to_validate])

    # Filter None results
    validated = [r for r in results if r is not None]

    await notifier.send(f"Validated {len(validated)} boundaries", {
        "region": state["region"],
        "urls_tested": len(to_validate),
        "valid": len(validated),
    })

    return {
        "validated_boundaries": validated,
        "phase": DiscoveryPhase.VALIDATING_URLS,
        "progress_message": f"Validated {len(validated)}/{len(to_validate)} URLs",
        "progress_percent": 80.0,
    }


async def finalize(state: DiscoveryState, notifier: NotificationManager) -> dict:
    """Calculate summary and send final notification"""
    summary = calculate_summary(state)

    await notifier.send(
        f"Discovery complete for {state['region']}",
        {
            "total_places": summary.total_places,
            "ward_based": summary.ward_based_places,
            "boundaries_found": summary.boundaries_found,
            "coverage": f"{summary.coverage_percent}%",
            "api_calls": summary.total_api_calls,
            "cost": f"${summary.total_cost:.4f}",
            "duration": f"{summary.duration_ms/1000:.1f}s",
        }
    )

    return {
        "phase": DiscoveryPhase.COMPLETE,
        "summary": {
            "region": summary.region,
            "total_places": summary.total_places,
            "ward_based_places": summary.ward_based_places,
            "at_large_places": summary.at_large_places,
            "boundaries_found": summary.boundaries_found,
            "boundaries_missing": summary.boundaries_missing,
            "coverage_percent": summary.coverage_percent,
            "total_api_calls": summary.total_api_calls,
            "total_cost": summary.total_cost,
            "duration_ms": summary.duration_ms,
        },
        "progress_message": "Discovery complete!",
        "progress_percent": 100.0,
    }


# =============================================================================
# Build Workflow Graph
# =============================================================================

def build_workflow(
    key_pool: KeyPool,
    webhook_url: str | None = None
) -> StateGraph:
    """
    Build the LangGraph discovery workflow.

    Returns a compiled graph with checkpointing.
    """
    gemini = GeminiProvider(key_pool)
    notifier = NotificationManager(webhook_url)

    # Create node wrappers that inject dependencies
    async def load_places_node(state):
        return await load_places(state)

    async def classify_node(state):
        return await classify_governance_batch(state, gemini, notifier)

    async def search_node(state):
        return await search_sources_batch(state, notifier)

    async def validate_node(state):
        return await validate_urls_batch(state, notifier)

    async def finalize_node(state):
        return await finalize(state, notifier)

    # Build graph
    builder = StateGraph(DiscoveryState)

    # Add nodes
    builder.add_node("load_places", load_places_node)
    builder.add_node("classify_governance", classify_node)
    builder.add_node("search_sources", search_node)
    builder.add_node("validate_urls", validate_node)
    builder.add_node("finalize", finalize_node)

    # Add edges (sequential workflow)
    builder.add_edge(START, "load_places")
    builder.add_edge("load_places", "classify_governance")
    builder.add_edge("classify_governance", "search_sources")
    builder.add_edge("search_sources", "validate_urls")
    builder.add_edge("validate_urls", "finalize")
    builder.add_edge("finalize", END)

    # Compile with checkpointing
    checkpointer = MemorySaver()
    return builder.compile(checkpointer=checkpointer)


# =============================================================================
# Main Entry Point
# =============================================================================

async def run_discovery(
    region: str,
    webhook_url: str | None = None,
    resume_thread_id: str | None = None,
) -> dict:
    """
    Run discovery workflow for a region.

    Args:
        region: Region code (e.g., "US-MT")
        webhook_url: Optional webhook for progress notifications
        resume_thread_id: Optional thread ID to resume from checkpoint

    Returns:
        Final state with summary
    """
    # Initialize key pool from environment
    key_pool = KeyPool.from_env()

    # Build workflow
    graph = build_workflow(key_pool, webhook_url)

    # Configure run
    config = {"configurable": {"thread_id": resume_thread_id or f"discovery-{region}"}}

    # Initialize or resume state
    if resume_thread_id:
        # Resume from checkpoint - LangGraph handles this automatically
        state = None
    else:
        state = create_initial_state(region)

    # Run workflow
    logger.info(f"Starting discovery for {region}")

    final_state = None
    async for event in graph.astream(state, config, stream_mode="values"):
        final_state = event
        phase = event.get("phase", "unknown")
        progress = event.get("progress_percent", 0)
        message = event.get("progress_message", "")
        logger.info(f"[{progress:.0f}%] {phase}: {message}")

    return final_state


def main():
    """CLI entry point"""
    import argparse

    parser = argparse.ArgumentParser(description="Boundary Discovery Workflow")
    parser.add_argument("--region", required=True, help="Region code (e.g., US-MT)")
    parser.add_argument("--webhook", help="Webhook URL for notifications")
    parser.add_argument("--resume", help="Thread ID to resume from")
    parser.add_argument("--dry-run", action="store_true", help="Don't make API calls")

    args = parser.parse_args()

    if args.dry_run:
        os.environ["GEMINI_KEYS"] = "dummy-project:dummy-key:free"

    final_state = asyncio.run(run_discovery(
        region=args.region,
        webhook_url=args.webhook,
        resume_thread_id=args.resume,
    ))

    # Print summary
    if final_state and final_state.get("summary"):
        summary = final_state["summary"]
        print("\n" + "=" * 70)
        print("  DISCOVERY COMPLETE")
        print("=" * 70)
        print(f"Region: {summary['region']}")
        print(f"Total places: {summary['total_places']}")
        print(f"Ward-based places: {summary['ward_based_places']}")
        print(f"At-large places: {summary['at_large_places']}")
        print(f"Boundaries found: {summary['boundaries_found']}")
        print(f"Boundaries missing: {summary['boundaries_missing']}")
        print(f"Coverage: {summary['coverage_percent']}%")
        print(f"API calls: {summary['total_api_calls']}")
        print(f"Estimated cost: ${summary['total_cost']:.4f}")
        print(f"Duration: {summary['duration_ms']/1000:.1f}s")


if __name__ == "__main__":
    main()
