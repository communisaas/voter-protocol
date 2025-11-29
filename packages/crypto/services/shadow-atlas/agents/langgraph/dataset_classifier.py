#!/usr/bin/env python3
"""
Agent-Curated Dataset Classifier

PURPOSE: Convert 7,651 raw hub-crawled datasets into a curated index of
~500-1,000 verified council district datasets.

ARCHITECTURE:
1. Deterministic pre-filter (zero LLM): field names, feature counts
2. LLM classification (batched): title + description + schema → is_council_district
3. Build curated index with city→dataset mapping

This runs ONCE at build time. Query-time resolution uses the curated index.

COST MODEL (5 API keys, 10 RPM each = 50 RPM capacity):
- 7,651 datasets
- ~40% pass deterministic filter = ~3,000 need LLM classification
- 3,000 classifications / 50 RPM = 60 minutes
- Cost: 3,000 × $0.0001 (flash) = $0.30
"""

import asyncio
import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, asdict, field
import aiohttp

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

from key_pool import KeyPool, AllKeysExhaustedError

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s'
)
logger = logging.getLogger(__name__)


@dataclass
class DatasetClassification:
    """Classification result for a dataset."""
    id: str
    title: str
    url: str

    # Classification
    is_council_district: bool
    confidence: int  # 0-100

    # Extracted metadata
    city: Optional[str]
    state: Optional[str]
    governance_type: str  # "ward", "district", "at_large", "unknown"

    # Quality signals
    feature_count: Optional[int]
    has_district_fields: bool
    freshness_score: int  # 0-100 based on modified date

    # Concerns
    concerns: List[str]
    reasoning: str

    # Classification method
    method: str  # "deterministic", "llm", "skipped"


@dataclass
class CuratedIndex:
    """Production-ready curated index."""
    build_timestamp: str
    total_raw: int
    total_curated: int

    # City → Dataset mapping for direct lookup
    city_index: Dict[str, Dict]  # "{city}, {state}" → dataset info

    # State → Cities for coverage tracking
    state_coverage: Dict[str, List[str]]  # "CA" → ["Los Angeles", "San Francisco", ...]

    # Datasets by quality tier
    tier1: List[str]  # High confidence (>80), official source
    tier2: List[str]  # Medium confidence (60-80)
    tier3: List[str]  # Low confidence (<60), needs review


class DatasetClassifier:
    """
    Classify datasets at build time using deterministic + LLM approach.

    The key insight: most datasets can be classified deterministically.
    LLM is only needed for ambiguous cases.
    """

    # Field names that strongly indicate council districts
    POSITIVE_FIELDS = {
        "district", "ward", "council", "alderman", "aldermanic",
        "councilmember", "representative", "seat", "precinct"
    }

    # Field names that indicate wrong data type
    NEGATIVE_FIELDS = {
        "school", "fire", "police", "water", "sewer", "transit",
        "census", "tract", "block", "zip", "county", "state",
        "supervisor", "commissioner", "planning", "zoning"
    }

    def __init__(self, key_pool: Optional[KeyPool] = None):
        self.key_pool = key_pool or KeyPool.from_env()
        self.classifications: Dict[str, DatasetClassification] = {}
        self.llm_calls = 0
        self.cache_path = Path(__file__).parent / "../data/classification_cache.json"

    async def load_cache(self):
        """Load cached classifications to avoid re-classifying."""
        if self.cache_path.exists():
            with open(self.cache_path) as f:
                data = json.load(f)
                for item in data.get("classifications", []):
                    self.classifications[item["id"]] = DatasetClassification(**item)
            logger.info(f"Loaded {len(self.classifications)} cached classifications")

    async def save_cache(self):
        """Save classifications to cache."""
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "classifications": [asdict(c) for c in self.classifications.values()]
        }
        with open(self.cache_path, "w") as f:
            json.dump(data, f, indent=2)
        logger.info(f"Saved {len(self.classifications)} classifications to cache")

    async def get_service_metadata(self, url: str) -> Optional[Dict]:
        """
        Fetch service metadata including field names.

        This is the key to deterministic classification - field names
        reveal what type of data the service contains.
        """
        base_url = url.rstrip("/")

        # Normalize to layer 0 if no layer specified
        if not re.search(r'/\d+$', base_url):
            base_url = f"{base_url}/0"

        try:
            async with aiohttp.ClientSession() as session:
                # Get layer metadata
                async with session.get(f"{base_url}?f=json", timeout=15) as resp:
                    if resp.status != 200:
                        return None
                    data = await resp.json()

                fields = [f.get("name", "").lower() for f in data.get("fields", [])]

                # Get feature count
                async with session.get(
                    f"{base_url}/query?where=1%3D1&returnCountOnly=true&f=json",
                    timeout=15
                ) as resp:
                    if resp.status == 200:
                        count_data = await resp.json()
                        count = count_data.get("count")
                    else:
                        count = None

                return {
                    "fields": fields,
                    "feature_count": count,
                    "description": data.get("description", ""),
                    "name": data.get("name", ""),
                }
        except Exception as e:
            logger.debug(f"Failed to get metadata for {url}: {e}")
            return None

    def classify_deterministic(
        self,
        title: str,
        fields: List[str],
        feature_count: Optional[int],
        description: str = ""
    ) -> Optional[DatasetClassification]:
        """
        Deterministic classification based on field names and feature count.

        Returns classification if confident, None if LLM needed.
        """
        title_lower = title.lower()
        desc_lower = (description or "").lower()
        text = f"{title_lower} {desc_lower} {' '.join(fields)}"

        # Strong negative signals - definitely not council districts
        strong_negatives = [
            "school district", "fire district", "water district",
            "census tract", "census block", "zip code", "postal",
            "county supervisor", "state senate", "state house",
            "congressional", "legislative", "assembly district",
            "parking", "transit", "bus stop", "route",
        ]
        for neg in strong_negatives:
            if neg in text:
                return DatasetClassification(
                    id="", title=title, url="",
                    is_council_district=False, confidence=95,
                    city=None, state=None, governance_type="unknown",
                    feature_count=feature_count, has_district_fields=False,
                    freshness_score=0, concerns=[f"Strong negative: {neg}"],
                    reasoning=f"Contains '{neg}' - not council district",
                    method="deterministic"
                )

        # Feature count filter (council districts are typically 3-50)
        if feature_count is not None:
            if feature_count < 3:
                return DatasetClassification(
                    id="", title=title, url="",
                    is_council_district=False, confidence=90,
                    city=None, state=None, governance_type="unknown",
                    feature_count=feature_count, has_district_fields=False,
                    freshness_score=0, concerns=[f"Too few features: {feature_count}"],
                    reasoning=f"Only {feature_count} features - councils have 3+",
                    method="deterministic"
                )
            if feature_count > 100:
                return DatasetClassification(
                    id="", title=title, url="",
                    is_council_district=False, confidence=85,
                    city=None, state=None, governance_type="unknown",
                    feature_count=feature_count, has_district_fields=False,
                    freshness_score=0, concerns=[f"Too many features: {feature_count}"],
                    reasoning=f"{feature_count} features - councils have <100",
                    method="deterministic"
                )

        # Check for positive field indicators
        positive_field_matches = [f for f in fields if any(
            pos in f for pos in self.POSITIVE_FIELDS
        )]
        negative_field_matches = [f for f in fields if any(
            neg in f for neg in self.NEGATIVE_FIELDS
        )]

        # Strong positive: explicit council/ward/district fields + good count
        if positive_field_matches and not negative_field_matches:
            if feature_count and 3 <= feature_count <= 50:
                # High confidence - this is likely a council district dataset
                governance = "ward" if "ward" in text else "district"
                return DatasetClassification(
                    id="", title=title, url="",
                    is_council_district=True, confidence=85,
                    city=None, state=None, governance_type=governance,
                    feature_count=feature_count,
                    has_district_fields=True,
                    freshness_score=50,
                    concerns=[],
                    reasoning=f"Fields {positive_field_matches}, count {feature_count}",
                    method="deterministic"
                )

        # Strong negative: only negative fields
        if negative_field_matches and not positive_field_matches:
            return DatasetClassification(
                id="", title=title, url="",
                is_council_district=False, confidence=80,
                city=None, state=None, governance_type="unknown",
                feature_count=feature_count, has_district_fields=False,
                freshness_score=0,
                concerns=[f"Negative fields: {negative_field_matches}"],
                reasoning=f"Fields suggest wrong data type: {negative_field_matches}",
                method="deterministic"
            )

        # Ambiguous - need LLM
        return None

    async def classify_with_llm(
        self,
        dataset_id: str,
        title: str,
        url: str,
        fields: List[str],
        feature_count: Optional[int],
        description: str = ""
    ) -> DatasetClassification:
        """
        Use Gemini Flash to classify ambiguous datasets.

        This is called only when deterministic classification fails.
        """
        self.llm_calls += 1

        prompt = f"""Classify this GIS dataset. Is it city council district boundaries?

Title: {title}
Description: {description[:500] if description else "None"}
Fields: {', '.join(fields[:20])}
Feature count: {feature_count if feature_count else "Unknown"}

Respond in JSON only:
{{
    "is_council_district": true/false,
    "confidence": 0-100,
    "city": "city name or null",
    "state": "XX or null",
    "governance_type": "ward" | "district" | "at_large" | "unknown",
    "concerns": ["list of concerns"],
    "reasoning": "brief explanation"
}}

Council districts are geographic boundaries for city council representation.
NOT: school districts, county supervisors, state legislature, planning zones, census tracts."""

        try:
            key_context = await self.key_pool.acquire()
            async with key_context as key_info:
                from google import genai

                client = genai.Client(api_key=key_info.key)
                response = client.models.generate_content(
                    model='gemini-2.0-flash',
                    contents=prompt,
                )

                text = response.text.strip()

                # Parse JSON from response
                json_match = re.search(r'\{[^{}]*\}', text, re.DOTALL)
                if json_match:
                    result = json.loads(json_match.group())
                    return DatasetClassification(
                        id=dataset_id,
                        title=title,
                        url=url,
                        is_council_district=result.get("is_council_district", False),
                        confidence=result.get("confidence", 50),
                        city=result.get("city"),
                        state=result.get("state"),
                        governance_type=result.get("governance_type", "unknown"),
                        feature_count=feature_count,
                        has_district_fields=bool([f for f in fields if any(
                            pos in f.lower() for pos in self.POSITIVE_FIELDS
                        )]),
                        freshness_score=50,
                        concerns=result.get("concerns", []),
                        reasoning=result.get("reasoning", "LLM classification"),
                        method="llm"
                    )

        except AllKeysExhaustedError as e:
            logger.warning(f"All keys exhausted, waiting {e.soonest_retry_ms/1000:.1f}s")
            await asyncio.sleep(e.soonest_retry_ms / 1000)
            return await self.classify_with_llm(
                dataset_id, title, url, fields, feature_count, description
            )
        except Exception as e:
            logger.error(f"LLM classification failed for {title}: {e}")

        # Fallback: low confidence, needs review
        return DatasetClassification(
            id=dataset_id,
            title=title,
            url=url,
            is_council_district=False,
            confidence=30,
            city=None,
            state=None,
            governance_type="unknown",
            feature_count=feature_count,
            has_district_fields=False,
            freshness_score=0,
            concerns=["LLM classification failed"],
            reasoning="Fallback - needs manual review",
            method="llm_failed"
        )

    async def classify_dataset(self, dataset: Dict) -> DatasetClassification:
        """
        Classify a single dataset using deterministic + LLM pipeline.
        """
        dataset_id = dataset["id"]
        title = dataset["title"]
        url = dataset["url"]

        # Check cache
        if dataset_id in self.classifications:
            return self.classifications[dataset_id]

        # Get service metadata (fields, feature count)
        metadata = await self.get_service_metadata(url)

        fields = metadata.get("fields", []) if metadata else []
        feature_count = metadata.get("feature_count") if metadata else dataset.get("feature_count")
        description = metadata.get("description", "") if metadata else dataset.get("description", "")

        # Try deterministic classification first
        result = self.classify_deterministic(title, fields, feature_count, description)

        if result:
            result.id = dataset_id
            result.url = url
            # Extract city/state from title if not set
            if not result.city:
                result.city = dataset.get("city_guess")
            if not result.state:
                result.state = dataset.get("state_guess")
            self.classifications[dataset_id] = result
            return result

        # Need LLM for ambiguous case
        result = await self.classify_with_llm(
            dataset_id, title, url, fields, feature_count, description
        )
        self.classifications[dataset_id] = result
        return result

    async def classify_batch(
        self,
        datasets: List[Dict],
        concurrency: int = 10
    ) -> List[DatasetClassification]:
        """
        Classify datasets in parallel batches.
        """
        semaphore = asyncio.Semaphore(concurrency)

        async def classify_with_semaphore(dataset: Dict) -> DatasetClassification:
            async with semaphore:
                return await self.classify_dataset(dataset)

        logger.info(f"Classifying {len(datasets)} datasets with concurrency={concurrency}")

        tasks = [classify_with_semaphore(d) for d in datasets]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Filter out exceptions
        classifications = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"Classification failed for {datasets[i]['id']}: {result}")
            else:
                classifications.append(result)

        return classifications

    def build_curated_index(self) -> CuratedIndex:
        """
        Build production-ready curated index from classifications.
        """
        city_index = {}
        state_coverage = {}
        tier1, tier2, tier3 = [], [], []

        for c in self.classifications.values():
            if not c.is_council_district:
                continue

            # Build city key
            if c.city and c.state:
                city_key = f"{c.city}, {c.state}"
                city_index[city_key] = {
                    "id": c.id,
                    "url": c.url,
                    "title": c.title,
                    "confidence": c.confidence,
                    "feature_count": c.feature_count,
                    "governance_type": c.governance_type,
                }

                # Track state coverage
                if c.state not in state_coverage:
                    state_coverage[c.state] = []
                state_coverage[c.state].append(c.city)

            # Tier by confidence
            if c.confidence >= 80:
                tier1.append(c.id)
            elif c.confidence >= 60:
                tier2.append(c.id)
            else:
                tier3.append(c.id)

        return CuratedIndex(
            build_timestamp=datetime.now(timezone.utc).isoformat(),
            total_raw=len(self.classifications),
            total_curated=len(city_index),
            city_index=city_index,
            state_coverage=state_coverage,
            tier1=tier1,
            tier2=tier2,
            tier3=tier3,
        )


async def main():
    """Run classification on hub-crawled datasets."""
    import argparse

    parser = argparse.ArgumentParser(description="Dataset Classifier")
    parser.add_argument(
        "--input",
        default="../data/hub-council-districts.json",
        help="Input JSON from hub crawler"
    )
    parser.add_argument(
        "--output",
        default="../data/curated-index.json",
        help="Output curated index"
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Limit number of datasets to process (for testing)"
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=10,
        help="Parallel classification concurrency"
    )

    args = parser.parse_args()

    # Load raw datasets
    input_path = Path(__file__).parent / args.input
    if not input_path.exists():
        logger.error(f"Input file not found: {input_path}")
        return

    with open(input_path) as f:
        data = json.load(f)

    datasets = data.get("datasets", [])
    if args.limit:
        datasets = datasets[:args.limit]

    logger.info(f"Loaded {len(datasets)} datasets from {input_path}")

    # Initialize classifier
    classifier = DatasetClassifier()
    await classifier.load_cache()

    # Classify
    try:
        results = await classifier.classify_batch(datasets, concurrency=args.concurrency)
    finally:
        await classifier.save_cache()

    # Build curated index
    index = classifier.build_curated_index()

    # Save
    output_path = Path(__file__).parent / args.output
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, "w") as f:
        json.dump({
            "build_timestamp": index.build_timestamp,
            "total_raw": index.total_raw,
            "total_curated": index.total_curated,
            "city_index": index.city_index,
            "state_coverage": index.state_coverage,
            "tiers": {
                "tier1": len(index.tier1),
                "tier2": len(index.tier2),
                "tier3": len(index.tier3),
            }
        }, f, indent=2)

    # Report
    print("\n" + "=" * 60)
    print("CLASSIFICATION REPORT")
    print("=" * 60)
    print(f"Total datasets: {len(datasets)}")
    print(f"LLM calls: {classifier.llm_calls}")
    print(f"Curated (council districts): {index.total_curated}")
    print(f"  Tier 1 (high confidence): {len(index.tier1)}")
    print(f"  Tier 2 (medium): {len(index.tier2)}")
    print(f"  Tier 3 (needs review): {len(index.tier3)}")
    print(f"\nStates covered: {len(index.state_coverage)}")
    print(f"Cities indexed: {len(index.city_index)}")
    print(f"\nOutput: {output_path}")


if __name__ == "__main__":
    asyncio.run(main())
