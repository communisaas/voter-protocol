#!/usr/bin/env python3
"""
ArcGIS Hub Crawler - Fast Version (No Feature Count Check)

This version skips the per-item feature count check for speed.
Feature count filtering is done at query time by the spatial resolver.

COST:
- ~100 Hub API calls (paginated)
- Completes in ~5 minutes vs hours for full version
- May include some non-council datasets (filtered at query time)
"""

import asyncio
import json
import logging
from datetime import datetime, timezone
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
    id: str
    title: str
    owner: str
    url: str
    feature_count: Optional[int]
    extent_xmin: Optional[float]
    extent_ymin: Optional[float]
    extent_xmax: Optional[float]
    extent_ymax: Optional[float]
    city_guess: Optional[str]
    state_guess: Optional[str]
    created: Optional[str]
    modified: Optional[str]
    tags: List[str]
    description: Optional[str]
    search_query: str
    crawled_at: str


class HubCrawlerFast:
    """Fast crawler - skips feature count check."""

    SEARCH_QUERIES = [
        'title:"council district"',
        'title:"city council"',
        'title:"city ward"',
        'title:"aldermanic"',
        'title:"ward boundaries"',
        'title:"county city council"',
        'title:"council districts" county',
        '"council district" boundaries',
        '"ward" boundaries city',
    ]

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
        self.discovered: Dict[str, DiscoveredDataset] = {}
        self.crawl_timestamp = datetime.now(timezone.utc).isoformat()

    def extract_city_from_title(self, title: str) -> Optional[str]:
        """Extract city name from dataset title."""
        title_lower = title.lower()

        for suffix in ["council district", "council districts", "city council",
                       "ward", "wards", "boundaries", "boundary", "districts"]:
            title_lower = title_lower.replace(suffix, "")

        if "city of " in title_lower:
            title_lower = title_lower.replace("city of ", "")

        for state in list(self.STATE_ABBREVS.values()) + list(self.STATE_ABBREVS.keys()):
            title_lower = title_lower.replace(f" {state.lower()} ", " ")
            title_lower = title_lower.replace(f" {state.lower()}", "")

        city = title_lower.strip().strip("-_,.")
        if city and len(city) > 2:
            return " ".join(word.capitalize() for word in city.split())
        return None

    def extract_state_from_title(self, title: str, tags: List[str]) -> Optional[str]:
        """Extract state from title or tags."""
        text = f"{title} {' '.join(tags)}".lower()

        for full, abbrev in self.STATE_ABBREVS.items():
            if f" {abbrev.lower()} " in f" {text} " or f" {full} " in f" {text} ":
                return abbrev

        return None

    async def search_hub(
        self,
        session: aiohttp.ClientSession,
        query: str,
        start: int = 1,
        num: int = 100
    ) -> Dict[str, Any]:
        """Search ArcGIS Hub/Online for datasets."""
        search_url = "https://www.arcgis.com/sharing/rest/search"

        params = {
            "q": f'{query} type:"Feature Service"',
            "f": "json",
            "start": start,
            "num": num,
            "sortField": "numViews",
            "sortOrder": "desc",
        }

        try:
            async with session.get(search_url, params=params, timeout=30) as resp:
                if resp.status != 200:
                    logger.warning(f"Search failed: HTTP {resp.status}")
                    return {"results": [], "total": 0, "nextStart": -1}
                return await resp.json()
        except Exception as e:
            logger.error(f"Search error: {e}")
            return {"results": [], "total": 0, "nextStart": -1}

    async def crawl_query(self, session: aiohttp.ClientSession, query: str) -> int:
        """Crawl all results for a single search query. Returns count of new datasets."""
        start = 1
        total = None
        new_count = 0

        while True:
            logger.info(f"  Searching '{query}' (start={start})")
            result = await self.search_hub(session, query, start=start, num=100)

            if total is None:
                total = result.get("total", 0)
                logger.info(f"  Total results: {total}")

            for item in result.get("results", []):
                item_id = item.get("id")
                if not item_id or item_id in self.discovered:
                    continue

                if "Feature" not in item.get("type", ""):
                    continue

                url = item.get("url", "")
                if not url:
                    continue

                extent = item.get("extent", [[None, None], [None, None]])
                xmin, ymin = extent[0] if extent and len(extent) > 0 else (None, None)
                xmax, ymax = extent[1] if extent and len(extent) > 1 else (None, None)

                # Skip datasets without extent (can't do spatial matching)
                if xmin is None:
                    continue

                title = item.get("title", "")
                tags = item.get("tags", []) or []

                dataset = DiscoveredDataset(
                    id=item_id,
                    title=title,
                    owner=item.get("owner", ""),
                    url=url,
                    feature_count=None,  # Not checked for speed
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
                new_count += 1

            next_start = result.get("nextStart", -1)
            if next_start == -1 or next_start > total:
                break
            start = next_start

            await asyncio.sleep(0.3)  # Rate limiting

        return new_count

    async def crawl(self) -> List[DiscoveredDataset]:
        """Full crawl of ArcGIS Hub for council district datasets."""
        logger.info("Starting fast ArcGIS Hub crawl for council district datasets")
        logger.info(f"Search queries: {len(self.SEARCH_QUERIES)}")

        async with aiohttp.ClientSession() as session:
            for query in self.SEARCH_QUERIES:
                try:
                    new = await self.crawl_query(session, query)
                    logger.info(f"  Added {new} new datasets, total: {len(self.discovered)}")
                except Exception as e:
                    logger.error(f"Error crawling '{query}': {e}")

                await asyncio.sleep(0.5)

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

        # State summary
        by_state: Dict[str, int] = {}
        for d in self.discovered.values():
            state = d.state_guess or "Unknown"
            by_state[state] = by_state.get(state, 0) + 1

        logger.info("Datasets by state (top 20):")
        for state, count in sorted(by_state.items(), key=lambda x: -x[1])[:20]:
            logger.info(f"  {state}: {count}")


async def main():
    import argparse

    parser = argparse.ArgumentParser(description="Fast ArcGIS Hub Crawler")
    parser.add_argument(
        "--output",
        type=str,
        default="../data/hub-council-districts-fast.json",
        help="Output JSON file path"
    )

    args = parser.parse_args()

    crawler = HubCrawlerFast()
    await crawler.crawl()
    crawler.export(Path(args.output))


if __name__ == "__main__":
    asyncio.run(main())
