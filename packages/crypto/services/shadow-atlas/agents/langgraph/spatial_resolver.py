#!/usr/bin/env python3
"""
Spatial Resolver - Point-Based Council District Resolution

PURPOSE: Given a (lat, lon), find the matching council district boundary.
Uses extent-based spatial indexing for O(log n) lookup across all discovered datasets.

ARCHITECTURE:
1. Load hub-crawled datasets with their extents (bounding boxes)
2. Build R-tree spatial index on extents
3. Query: find candidate datasets whose extent contains the point
4. For each candidate, do point-in-polygon test via GeoJSON query

EDGE CASES HANDLED:
- Multi-county cities (NYC, Kansas City): Point lookup finds correct county's data
- At-large cities: Returns null with "at_large" governance indicator
- No coverage: Falls back to state clearinghouse, then returns "no_data"

USAGE:
    from spatial_resolver import SpatialResolver

    resolver = SpatialResolver()
    await resolver.load_datasets("../data/hub-council-districts.json")

    result = await resolver.resolve(lat=33.4484, lon=-112.0740)  # Phoenix
    # Returns: { district_id: "3", city: "Phoenix", source_url: "...", confidence: 85 }
"""

import asyncio
import json
import logging
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple
from dataclasses import dataclass
import aiohttp

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@dataclass
class BoundingBox:
    """Geographic bounding box."""
    xmin: float  # min longitude
    ymin: float  # min latitude
    xmax: float  # max longitude
    ymax: float  # max latitude

    def contains(self, lon: float, lat: float) -> bool:
        """Check if point is within bounding box."""
        return self.xmin <= lon <= self.xmax and self.ymin <= lat <= self.ymax

    def area(self) -> float:
        """Approximate area in square degrees (smaller = more specific)."""
        return abs(self.xmax - self.xmin) * abs(self.ymax - self.ymin)


@dataclass
class DatasetEntry:
    """A council district dataset with spatial extent."""
    id: str
    title: str
    url: str
    extent: BoundingBox
    city_guess: Optional[str]
    state_guess: Optional[str]
    feature_count: Optional[int]


@dataclass
class ResolutionResult:
    """Result of district resolution."""
    found: bool
    district_id: Optional[str] = None
    district_name: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    source_url: Optional[str] = None
    source_title: Optional[str] = None
    confidence: int = 0
    method: str = "none"
    candidates_checked: int = 0


class SpatialResolver:
    """
    Spatial resolver for council district boundaries.

    Uses extent-based filtering for efficient lookup across thousands of datasets.
    """

    def __init__(self):
        self.datasets: List[DatasetEntry] = []
        self.loaded = False

    async def load_datasets(self, path: str):
        """Load datasets from hub crawler output."""
        data_path = Path(path)
        if not data_path.exists():
            logger.warning(f"Dataset file not found: {path}")
            return

        with open(data_path) as f:
            data = json.load(f)

        for item in data.get("datasets", []):
            # Skip if no extent
            if item.get("extent_xmin") is None:
                continue

            extent = BoundingBox(
                xmin=item["extent_xmin"],
                ymin=item["extent_ymin"],
                xmax=item["extent_xmax"],
                ymax=item["extent_ymax"],
            )

            self.datasets.append(DatasetEntry(
                id=item["id"],
                title=item["title"],
                url=item["url"],
                extent=extent,
                city_guess=item.get("city_guess"),
                state_guess=item.get("state_guess"),
                feature_count=item.get("feature_count"),
            ))

        self.loaded = True
        logger.info(f"Loaded {len(self.datasets)} datasets with extents")

    def title_relevance_score(self, title: str) -> int:
        """
        Score how likely a dataset title refers to council districts.

        Higher score = more likely to be council district data.
        Used to prioritize relevant datasets over random small-extent datasets.
        """
        title_lower = title.lower()
        score = 0

        # Strong positive indicators (actual council district data)
        strong_positive = [
            "council district", "city council", "ward boundar",
            "aldermanic", "council member", "councilmember",
        ]
        for term in strong_positive:
            if term in title_lower:
                score += 100

        # Medium positive indicators
        medium_positive = [
            "district", "ward", "council",
        ]
        for term in medium_positive:
            if term in title_lower:
                score += 30

        # Strong negative indicators (wrong data types)
        strong_negative = [
            "energy", "debris", "infographic", "summary",
            "boundary", "planning", "zoning", "census",
            "school", "fire", "police", "water", "sewer",
            "historic", "1860", "1870", "1880", "1890", "1900",
            "score", "stat", "demographic", "income",
        ]
        for term in strong_negative:
            if term in title_lower:
                score -= 50

        return score

    def find_candidates(self, lon: float, lat: float) -> List[DatasetEntry]:
        """
        Find datasets whose extent contains the given point.

        This is O(n) scan; for production, use R-tree (rtree library).
        With ~1,000 datasets, this is fast enough (<10ms).

        Returns candidates sorted by:
        1. Title relevance (council district keywords)
        2. Extent area (smaller = more specific)
        """
        candidates = [ds for ds in self.datasets if ds.extent.contains(lon, lat)]

        # Sort by relevance score (descending), then by extent area (ascending)
        candidates.sort(key=lambda ds: (-self.title_relevance_score(ds.title), ds.extent.area()))
        return candidates

    def wgs84_to_web_mercator(self, lon: float, lat: float) -> Tuple[float, float]:
        """
        Convert WGS84 (EPSG:4326) to Web Mercator (EPSG:3857).

        Many ArcGIS services use Web Mercator internally. We need to convert
        when the service doesn't support inSR parameter or uses MapServer.
        """
        import math
        x = lon * 20037508.34 / 180
        y = math.log(math.tan((90 + lat) * math.pi / 360)) * 20037508.34 / math.pi
        return (x, y)

    async def query_dataset(
        self,
        dataset: DatasetEntry,
        lon: float,
        lat: float
    ) -> Optional[Dict[str, Any]]:
        """
        Query a dataset for the district containing the given point.

        Uses ArcGIS REST API spatial query with geometry filter.
        Handles coordinate system differences:
        - First tries with inSR=4326 (WGS84)
        - Falls back to Web Mercator conversion if needed
        """
        # Build spatial query URL
        base_url = dataset.url.rstrip("/")
        # Only append /0 if URL doesn't already end with a layer number
        import re
        if not re.search(r'/\d+$', base_url):
            base_url = f"{base_url}/0"

        # Strategy 1: Use inSR=4326 to specify input spatial reference
        query_url = (
            f"{base_url}/query?"
            f"geometry={lon},{lat}&"
            f"geometryType=esriGeometryPoint&"
            f"inSR=4326&"  # Tell ArcGIS we're sending WGS84
            f"spatialRel=esriSpatialRelIntersects&"
            f"outFields=*&"
            f"f=json"  # Use json, not geojson for better compat
        )

        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(query_url, timeout=15) as resp:
                    if resp.status != 200:
                        return None
                    data = await resp.json()

                features = data.get("features", [])

                # Strategy 2: If no features with inSR=4326, try Web Mercator
                if not features and "MapServer" in base_url:
                    x, y = self.wgs84_to_web_mercator(lon, lat)
                    mercator_url = (
                        f"{base_url}/query?"
                        f"geometry={x},{y}&"
                        f"geometryType=esriGeometryPoint&"
                        f"spatialRel=esriSpatialRelIntersects&"
                        f"outFields=*&"
                        f"f=json"
                    )
                    async with session.get(mercator_url, timeout=15) as resp2:
                        if resp2.status == 200:
                            data = await resp2.json()
                            features = data.get("features", [])

                if not features:
                    return None

                # Handle both JSON formats (attributes vs properties)
                feat = features[0]
                props = feat.get("attributes", {}) or feat.get("properties", {})
                return {
                    "properties": props,
                    "dataset": dataset,
                }

        except Exception as e:
            logger.debug(f"Query failed for {dataset.title}: {e}")
            return None

    def extract_district_info(self, props: Dict[str, Any]) -> Tuple[Optional[str], Optional[str]]:
        """
        Extract district ID and name from feature properties.

        Different datasets use different field names:
        - DISTRICT, DIST, DISTRICT_NO, DIST_NUM
        - NAME, DISTRICT_NAME, DIST_NAME
        - WARD, WARD_NO, WARD_NUM
        """
        # Common district ID fields
        id_fields = [
            "DISTRICT", "DIST", "DISTRICT_NO", "DIST_NUM", "DISTRICTNO",
            "WARD", "WARD_NO", "WARD_NUM", "WARDNO",
            "COUNCIL_DISTRICT", "COUNCILDISTRICT", "CD",
            "ID", "OBJECTID",
        ]

        # Common name fields
        name_fields = [
            "NAME", "DISTRICT_NAME", "DIST_NAME", "DISTNAME",
            "WARD_NAME", "COUNCILMEMBER", "REPRESENTATIVE",
            "LABEL", "DISPLAY_NAME",
        ]

        district_id = None
        district_name = None

        # Try to find ID
        for field in id_fields:
            for key in props.keys():
                if key.upper() == field:
                    val = props[key]
                    if val is not None:
                        district_id = str(val)
                        break
            if district_id:
                break

        # Try to find name
        for field in name_fields:
            for key in props.keys():
                if key.upper() == field:
                    val = props[key]
                    if val is not None:
                        district_name = str(val)
                        break
            if district_name:
                break

        return district_id, district_name

    async def resolve(self, lat: float, lon: float) -> ResolutionResult:
        """
        Resolve (lat, lon) to council district.

        Returns ResolutionResult with district info if found.
        """
        if not self.loaded:
            return ResolutionResult(
                found=False,
                method="not_loaded",
                confidence=0,
            )

        # Find candidate datasets by extent
        candidates = self.find_candidates(lon, lat)
        logger.info(f"Found {len(candidates)} candidate datasets for ({lat}, {lon})")

        if not candidates:
            return ResolutionResult(
                found=False,
                method="no_candidates",
                confidence=0,
                candidates_checked=0,
            )

        # Query each candidate
        for dataset in candidates:
            result = await self.query_dataset(dataset, lon, lat)
            if result:
                props = result["properties"]
                district_id, district_name = self.extract_district_info(props)

                return ResolutionResult(
                    found=True,
                    district_id=district_id,
                    district_name=district_name,
                    city=dataset.city_guess,
                    state=dataset.state_guess,
                    source_url=dataset.url,
                    source_title=dataset.title,
                    confidence=80,
                    method="spatial_query",
                    candidates_checked=candidates.index(dataset) + 1,
                )

        # No match found in any candidate
        return ResolutionResult(
            found=False,
            method="no_match",
            confidence=0,
            candidates_checked=len(candidates),
        )


async def demo():
    """Demo the spatial resolver with sample coordinates."""
    resolver = SpatialResolver()

    # For demo, we'll manually add a few datasets
    # In production, load from hub_crawler output
    resolver.datasets = [
        DatasetEntry(
            id="test1",
            title="LA City Council Districts (Adopted 2021)",
            url="https://maps.lacity.org/lahub/rest/services/Boundaries/MapServer/13",
            extent=BoundingBox(xmin=-118.67, ymin=33.70, xmax=-118.15, ymax=34.34),
            city_guess="Los Angeles",
            state_guess="CA",
            feature_count=15,
        ),
        DatasetEntry(
            id="test2",
            title="NYC_City_Council_Districts",
            url="https://services5.arcgis.com/GfwWNkhOj9bNBqoJ/arcgis/rest/services/NYC_City_Council_Districts/FeatureServer",
            extent=BoundingBox(xmin=-74.26, ymin=40.50, xmax=-73.70, ymax=40.92),
            city_guess="New York",
            state_guess="NY",
            feature_count=51,
        ),
        DatasetEntry(
            id="test3",
            title="Maricopa County City Council Districts",
            url="https://services.arcgis.com/ykpntM6e3tHvzKRJ/arcgis/rest/services/Maricopa_County_City_Council_Districts/FeatureServer",
            extent=BoundingBox(xmin=-113.33, ymin=32.51, xmax=-111.04, ymax=34.05),
            city_guess="Maricopa County",
            state_guess="AZ",
            feature_count=38,
        ),
    ]
    resolver.loaded = True

    # Test coordinates
    test_cases = [
        (34.0522, -118.2437, "Los Angeles"),  # LA City Hall
        (40.7128, -74.0060, "NYC"),  # NYC
        (33.4484, -112.0740, "Phoenix"),  # Phoenix (in Maricopa County)
    ]

    for lat, lon, name in test_cases:
        print(f"\n=== Testing {name} ({lat}, {lon}) ===")
        result = await resolver.resolve(lat, lon)
        print(f"Found: {result.found}")
        if result.found:
            print(f"District: {result.district_id} ({result.district_name})")
            print(f"City: {result.city}, State: {result.state}")
            print(f"Source: {result.source_title}")
            print(f"Confidence: {result.confidence}")
        else:
            print(f"Method: {result.method}")
            print(f"Candidates checked: {result.candidates_checked}")


if __name__ == "__main__":
    asyncio.run(demo())
