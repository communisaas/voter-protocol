#!/usr/bin/env python3
"""
ArcGIS Hub Crawler - Infrastructure-First Discovery

PURPOSE: Crawl ArcGIS Hub/Online to discover ALL published council district datasets.
This inverts the discovery model: instead of probing 19,500 cities hoping to find portals,
we crawl the aggregation layer once to find what's published.

ARCHITECTURE:
1. Search ArcGIS Hub for council/ward/district datasets
2. Filter by feature count (3-50 = typical council size)
3. Extract geographic extent for spatial indexing
4. Match datasets to cities via extent/centroid overlap
5. Build spatial index for O(log n) query-time resolution

COST:
- Hub search: ~100-200 API calls (paginated results)
- One-time crawl discovers ~1,000-2,000 council district datasets
- vs. current approach: 702,000 HTTP probes

RUN:
    cd agents/langgraph
    source .venv/bin/activate
    python hub_crawler.py --output ../data/hub-council-districts.json
"""

import asyncio
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, asdict
import aiohttp

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s'
)
logger = logging.getLogger(__name__)


@dataclass
class DiscoveredDataset:
    """A council district dataset discovered from ArcGIS Hub."""
    id: str  # ArcGIS item ID
    title: str
    owner: str  # Publisher organization
    url: str  # Feature service URL
    feature_count: Optional[int]

    # Geographic extent (bounding box)
    extent_xmin: Optional[float]
    extent_ymin: Optional[float]
    extent_xmax: Optional[float]
    extent_ymax: Optional[float]

    # Inferred location
    city_guess: Optional[str]  # Extracted from title
    state_guess: Optional[str]  # Extracted from title/tags

    # Metadata
    created: Optional[str]
    modified: Optional[str]
    tags: List[str]
    description: Optional[str]

    # Discovery metadata
    search_query: str
    crawled_at: str


class HubCrawler:
    """Crawler for ArcGIS Hub/Online to discover council district datasets."""

    # Search queries to find council district data
    # Using title: prefix for high precision (Hub search supports Lucene syntax)
    SEARCH_QUERIES = [
        # High precision title matches
        'title:"council district"',
        'title:"city council"',
        'title:"city ward"',
        'title:"aldermanic"',
        'title:"ward boundaries"',

        # County aggregators (critical for coverage)
        'title:"county city council"',
        'title:"council districts" county',

        # Broader searches (may have noise)
        '"council district" boundaries',
        '"ward" boundaries city',
    ]

    # State name to abbreviation mapping for extraction
    STATE_ABBREVS = {
        "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
        "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
        "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID",
        "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
        "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
        "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
        "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
        "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
        "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK",
        "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
        "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT",
        "vermont": "VT", "virginia": "VA", "washington": "WA", "west virginia": "WV",
        "wisconsin": "WI", "wyoming": "WY", "district of columbia": "DC",
    }

    def __init__(self):
        self.discovered: Dict[str, DiscoveredDataset] = {}  # id -> dataset
        self.crawl_timestamp = datetime.utcnow().isoformat() + "Z"

    def extract_city_from_title(self, title: str) -> Optional[str]:
        """
        Extract city name from dataset title.

        Examples:
        - "City of Austin Council Districts" -> "Austin"
        - "Phoenix City Council Districts" -> "Phoenix"
        - "Mesa AZ Council Districts" -> "Mesa"
        """
        title_lower = title.lower()

        # Remove common suffixes
        for suffix in ["council district", "council districts", "city council",
                       "ward", "wards", "boundaries", "boundary", "districts"]:
            title_lower = title_lower.replace(suffix, "")

        # Remove "city of" prefix
        if "city of " in title_lower:
            title_lower = title_lower.replace("city of ", "")

        # Remove state abbreviations
        for state in list(self.STATE_ABBREVS.values()) + list(self.STATE_ABBREVS.keys()):
            title_lower = title_lower.replace(f" {state.lower()} ", " ")
            title_lower = title_lower.replace(f" {state.lower()}", "")

        # Clean up and return
        city = title_lower.strip().strip("-_,.")
        if city and len(city) > 2:
            # Title case
            return " ".join(word.capitalize() for word in city.split())
        return None

    def extract_state_from_title(self, title: str, tags: List[str]) -> Optional[str]:
        """Extract state from title or tags."""
        text = f"{title} {' '.join(tags)}".lower()

        # Check for state abbreviations
        for full, abbrev in self.STATE_ABBREVS.items():
            if f" {abbrev.lower()} " in f" {text} " or f" {full} " in f" {text} ":
                return abbrev

        return None

    async def search_hub(
        self,
        query: str,
        start: int = 1,
        num: int = 100
    ) -> Dict[str, Any]:
        """
        Search ArcGIS Hub/Online for datasets.

        Uses the ArcGIS REST API search endpoint.
        """
        search_url = "https://www.arcgis.com/sharing/rest/search"

        params = {
            "q": f'{query} type:"Feature Service"',
            "f": "json",
            "start": start,
            "num": num,
            "sortField": "numViews",
            "sortOrder": "desc",
        }

        async with aiohttp.ClientSession() as session:
            async with session.get(search_url, params=params, timeout=30) as resp:
                if resp.status != 200:
                    logger.warning(f"Search failed: HTTP {resp.status}")
                    return {"results": [], "total": 0, "nextStart": -1}
                return await resp.json()

    async def get_service_info(self, url: str) -> Optional[Dict[str, Any]]:
        """
        Get feature count and extent from a Feature Service.
        """
        # Normalize URL
        if not url.endswith("/0"):
            url = f"{url}/0"

        count_url = f"{url}/query?where=1%3D1&returnCountOnly=true&f=json"

        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(count_url, timeout=15) as resp:
                    if resp.status != 200:
                        return None
                    data = await resp.json()
                    return {"count": data.get("count", 0)}
        except Exception:
            return None

    async def crawl_query(self, query: str) -> List[DiscoveredDataset]:
        """Crawl all results for a single search query."""
        discovered = []
        start = 1
        total = None

        while True:
            logger.info(f"  Searching '{query}' (start={start})")
            result = await self.search_hub(query, start=start, num=100)

            if total is None:
                total = result.get("total", 0)
                logger.info(f"  Total results: {total}")

            for item in result.get("results", []):
                item_id = item.get("id")
                if not item_id or item_id in self.discovered:
                    continue  # Skip duplicates

                # Filter: must be Feature Service
                if "Feature" not in item.get("type", ""):
                    continue

                url = item.get("url", "")
                if not url:
                    continue

                # Get extent
                extent = item.get("extent", [[None, None], [None, None]])
                xmin, ymin = extent[0] if extent and len(extent) > 0 else (None, None)
                xmax, ymax = extent[1] if extent and len(extent) > 1 else (None, None)

                # Get feature count (quick probe)
                svc_info = await self.get_service_info(url)
                feature_count = svc_info.get("count") if svc_info else None

                # Filter: council districts typically have 3-50 features
                if feature_count is not None and (feature_count < 3 or feature_count > 50):
                    continue

                title = item.get("title", "")
                tags = item.get("tags", []) or []

                dataset = DiscoveredDataset(
                    id=item_id,
                    title=title,
                    owner=item.get("owner", ""),
                    url=url,
                    feature_count=feature_count,
                    extent_xmin=xmin,
                    extent_ymin=ymin,
                    extent_xmax=xmax,
                    extent_ymax=ymax,
                    city_guess=self.extract_city_from_title(title),
                    state_guess=self.extract_state_from_title(title, tags),
                    created=item.get("created"),
                    modified=item.get("modified"),
                    tags=tags,
                    description=item.get("description", "")[:500] if item.get("description") else None,
                    search_query=query,
                    crawled_at=self.crawl_timestamp,
                )

                self.discovered[item_id] = dataset
                discovered.append(dataset)

            # Pagination
            next_start = result.get("nextStart", -1)
            if next_start == -1 or next_start > total:
                break
            start = next_start

            # Rate limiting
            await asyncio.sleep(0.5)

        return discovered

    async def crawl(self) -> List[DiscoveredDataset]:
        """
        Full crawl of ArcGIS Hub for council district datasets.

        Returns deduplicated list of discovered datasets.
        """
        logger.info("Starting ArcGIS Hub crawl for council district datasets")
        logger.info(f"Search queries: {len(self.SEARCH_QUERIES)}")

        for query in self.SEARCH_QUERIES:
            try:
                await self.crawl_query(query)
                logger.info(f"  Discovered so far: {len(self.discovered)}")
            except Exception as e:
                logger.error(f"Error crawling '{query}': {e}")

            # Rate limiting between queries
            await asyncio.sleep(1)

        logger.info(f"Crawl complete. Total discovered: {len(self.discovered)}")
        return list(self.discovered.values())

    def export(self, output_path: Path):
        """Export discovered datasets to JSON."""
        output_path.parent.mkdir(parents=True, exist_ok=True)

        data = {
            "crawl_timestamp": self.crawl_timestamp,
            "total_datasets": len(self.discovered),
            "datasets": [asdict(d) for d in self.discovered.values()],
        }

        with open(output_path, "w") as f:
            json.dump(data, f, indent=2)

        logger.info(f"Exported {len(self.discovered)} datasets to {output_path}")

        # Also generate state summary
        by_state: Dict[str, int] = {}
        for d in self.discovered.values():
            state = d.state_guess or "Unknown"
            by_state[state] = by_state.get(state, 0) + 1

        logger.info("Datasets by state:")
        for state, count in sorted(by_state.items(), key=lambda x: -x[1])[:20]:
            logger.info(f"  {state}: {count}")


async def main():
    import argparse

    parser = argparse.ArgumentParser(description="ArcGIS Hub Crawler")
    parser.add_argument(
        "--output",
        type=str,
        default="../data/hub-council-districts.json",
        help="Output JSON file path"
    )

    args = parser.parse_args()

    crawler = HubCrawler()
    await crawler.crawl()
    crawler.export(Path(args.output))


if __name__ == "__main__":
    asyncio.run(main())
