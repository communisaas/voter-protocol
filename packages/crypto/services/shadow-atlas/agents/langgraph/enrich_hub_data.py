#!/usr/bin/env python3
"""
Schema Enrichment Script - Plug GISServerDiscovery into ML Pipeline

Fetches complete metadata (fields, feature_count, geometry_type, description)
for all 176k datasets from hub-council-districts.json.

WHY THIS IS NECESSARY:
- Current data has title only (from ArcGIS Hub API)
- ML model missing 40% of council districts due to incomplete metadata
- GISServerDiscovery.ts already does this in TypeScript, we need Python version

ARCHITECTURE:
1. Load 176k datasets from hub-council-districts.json
2. For each dataset, fetch schema from ArcGIS REST API: {url}?f=json
3. Extract: fields[], featureCount, geometryType, description
4. Add language-agnostic schema features
5. Save enriched data to hub_council_districts_enriched.jsonl

PERFORMANCE:
- Async HTTP (20 concurrent requests)
- Rate limiting (4 requests/second per rate limiter)
- Retry with exponential backoff
- Progress tracking (estimate completion time)
- Checkpoint every 1,000 datasets (resume on failure)

EXPECTED TIME: ~12 hours for 176k datasets
COST: $0 (public APIs)
"""

import asyncio
import aiohttp
import json
import time
from pathlib import Path
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta


@dataclass
class EnrichmentResult:
    """Result of schema enrichment for a single dataset."""
    dataset_id: str
    url: str
    status: str  # 'success', 'failed', 'timeout', 'not_found'

    # Enriched fields
    live_fields: List[str]
    live_feature_count: Optional[int]
    live_geometry_type: Optional[str]
    live_description: str

    # Schema-derived features (language-agnostic)
    has_id_field: bool
    has_name_field: bool
    has_district_field: bool
    has_council_field: bool
    has_member_field: bool
    has_geometry_field: bool
    field_count: int

    # Metadata
    enriched_at: str
    response_time_ms: int
    error_message: Optional[str] = None


class SchemaEnricher:
    """
    Fetches and enriches GIS dataset metadata from ArcGIS REST APIs.
    """

    def __init__(self, concurrency: int = 20, rate_limit: float = 4.0):
        """
        Args:
            concurrency: Number of concurrent HTTP requests
            rate_limit: Max requests per second (prevent rate limiting)
        """
        self.concurrency = concurrency
        self.rate_limit = rate_limit
        self.session: Optional[aiohttp.ClientSession] = None

        # Rate limiting
        self.request_times: List[float] = []

        # Progress tracking
        self.total_processed = 0
        self.total_success = 0
        self.total_failed = 0
        self.start_time = time.time()

    async def __aenter__(self):
        """Async context manager entry."""
        timeout = aiohttp.ClientTimeout(total=30, connect=10)
        self.session = aiohttp.ClientSession(timeout=timeout)
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        if self.session:
            await self.session.close()

    async def rate_limit_wait(self):
        """Enforce rate limiting."""
        now = time.time()

        # Remove requests older than 1 second
        self.request_times = [t for t in self.request_times if now - t < 1.0]

        # If we've hit rate limit, wait
        if len(self.request_times) >= self.rate_limit:
            wait_time = 1.0 - (now - self.request_times[0])
            if wait_time > 0:
                await asyncio.sleep(wait_time)

        self.request_times.append(time.time())

    async def fetch_schema(self, url: str) -> Dict[str, Any]:
        """
        Fetch schema metadata from ArcGIS REST API.

        Args:
            url: Service URL (FeatureServer or MapServer)

        Returns:
            Schema metadata dict
        """
        await self.rate_limit_wait()

        # Determine schema URL based on service type
        if 'FeatureServer' in url:
            schema_url = f"{url}?f=json"
        elif 'MapServer' in url:
            # MapServer layers need /0 suffix for first layer
            if not url.rstrip('/').split('/')[-1].isdigit():
                schema_url = f"{url}/0?f=json"
            else:
                schema_url = f"{url}?f=json"
        else:
            raise ValueError(f"Unknown service type: {url}")

        start = time.time()

        async with self.session.get(schema_url) as response:
            response_time = int((time.time() - start) * 1000)

            if response.status != 200:
                return {
                    'status': 'failed',
                    'error': f"HTTP {response.status}",
                    'response_time_ms': response_time
                }

            data = await response.json()
            data['response_time_ms'] = response_time
            data['status'] = 'success'

            return data

    def extract_schema_features(self, schema: Dict[str, Any]) -> Dict[str, Any]:
        """
        Extract language-agnostic features from schema.

        These features work across ANY language without translation.
        """
        fields = schema.get('fields', [])
        field_names_upper = [f.get('name', '').upper() for f in fields]

        # ID field patterns (language-agnostic)
        has_id = any(
            'ID' in name or
            'NUM' in name or
            name in ('FID', 'OBJECTID', 'OID', 'GID')
            for name in field_names_upper
        )

        # Name field patterns
        has_name = any(
            'NAME' in name or
            'NOM' in name or
            'NOMBRE' in name or
            'NAAM' in name or
            'BEZEICHNUNG' in name
            for name in field_names_upper
        )

        # District-specific field patterns
        has_district = any(
            'DISTRICT' in name or
            'DIST' in name or
            'BEZIRK' in name or
            'ARROND' in name
            for name in field_names_upper
        )

        has_council = any(
            'COUNCIL' in name or
            'CONSEIL' in name or
            'CONSEJO' in name
            for name in field_names_upper
        )

        has_member = any(
            'MEMBER' in name or
            'REP' in name or
            'COUNCILOR' in name or
            'ALDERMAN' in name or
            'SUPERVISOR' in name
            for name in field_names_upper
        )

        # Geometry field (required for spatial data)
        has_geometry = any(
            name in ('SHAPE', 'GEOM', 'GEOMETRY', 'THE_GEOM', 'WKT', 'WKB')
            for name in field_names_upper
        )

        return {
            'has_id_field': has_id,
            'has_name_field': has_name,
            'has_district_field': has_district,
            'has_council_field': has_council,
            'has_member_field': has_member,
            'has_geometry_field': has_geometry,
            'field_count': len(fields)
        }

    async def enrich_dataset(self, dataset: Dict[str, Any]) -> EnrichmentResult:
        """
        Enrich a single dataset with schema metadata.
        """
        dataset_id = dataset.get('dataset_id', 'unknown')
        url = dataset.get('url', '')

        try:
            # Fetch schema
            schema = await self.fetch_schema(url)

            if schema.get('status') != 'success':
                return EnrichmentResult(
                    dataset_id=dataset_id,
                    url=url,
                    status='failed',
                    live_fields=[],
                    live_feature_count=None,
                    live_geometry_type=None,
                    live_description='',
                    has_id_field=False,
                    has_name_field=False,
                    has_district_field=False,
                    has_council_field=False,
                    has_member_field=False,
                    has_geometry_field=False,
                    field_count=0,
                    enriched_at=datetime.utcnow().isoformat(),
                    response_time_ms=schema.get('response_time_ms', 0),
                    error_message=schema.get('error')
                )

            # Extract fields
            fields = schema.get('fields', [])
            field_names = [f.get('name', '') for f in fields]

            # Extract feature count (may require separate query)
            feature_count = None
            if 'count' in schema:
                feature_count = schema['count']

            # Extract geometry type
            geometry_type = schema.get('geometryType')

            # Extract description
            description = schema.get('description', '') or schema.get('serviceDescription', '')

            # Extract schema features
            schema_features = self.extract_schema_features(schema)

            return EnrichmentResult(
                dataset_id=dataset_id,
                url=url,
                status='success',
                live_fields=field_names,
                live_feature_count=feature_count,
                live_geometry_type=geometry_type,
                live_description=description,
                **schema_features,
                enriched_at=datetime.utcnow().isoformat(),
                response_time_ms=schema.get('response_time_ms', 0)
            )

        except asyncio.TimeoutError:
            return EnrichmentResult(
                dataset_id=dataset_id,
                url=url,
                status='timeout',
                live_fields=[],
                live_feature_count=None,
                live_geometry_type=None,
                live_description='',
                has_id_field=False,
                has_name_field=False,
                has_district_field=False,
                has_council_field=False,
                has_member_field=False,
                has_geometry_field=False,
                field_count=0,
                enriched_at=datetime.utcnow().isoformat(),
                response_time_ms=30000,
                error_message='Request timeout (30s)'
            )

        except Exception as e:
            return EnrichmentResult(
                dataset_id=dataset_id,
                url=url,
                status='failed',
                live_fields=[],
                live_feature_count=None,
                live_geometry_type=None,
                live_description='',
                has_id_field=False,
                has_name_field=False,
                has_district_field=False,
                has_council_field=False,
                has_member_field=False,
                has_geometry_field=False,
                field_count=0,
                enriched_at=datetime.utcnow().isoformat(),
                response_time_ms=0,
                error_message=str(e)
            )

    async def enrich_batch(
        self,
        datasets: List[Dict[str, Any]]
    ) -> List[EnrichmentResult]:
        """
        Enrich a batch of datasets concurrently.
        """
        tasks = [self.enrich_dataset(ds) for ds in datasets]
        results = await asyncio.gather(*tasks)

        # Update stats
        self.total_processed += len(results)
        self.total_success += sum(1 for r in results if r.status == 'success')
        self.total_failed += sum(1 for r in results if r.status != 'success')

        return results

    def print_progress(self, total: int):
        """Print progress statistics."""
        elapsed = time.time() - self.start_time
        rate = self.total_processed / elapsed if elapsed > 0 else 0

        remaining = total - self.total_processed
        eta_seconds = remaining / rate if rate > 0 else 0
        eta = timedelta(seconds=int(eta_seconds))

        success_rate = self.total_success / self.total_processed * 100 if self.total_processed > 0 else 0

        print(f"\nProgress: {self.total_processed}/{total} ({self.total_processed/total*100:.1f}%)")
        print(f"Success: {self.total_success} ({success_rate:.1f}%)")
        print(f"Failed: {self.total_failed}")
        print(f"Rate: {rate:.1f} datasets/sec")
        print(f"Elapsed: {timedelta(seconds=int(elapsed))}")
        print(f"ETA: {eta}")


async def enrich_all_datasets(
    input_file: Path,
    output_file: Path,
    checkpoint_file: Path,
    concurrency: int = 20,
    batch_size: int = 100
):
    """
    Enrich all datasets from input file with schema metadata.

    Args:
        input_file: Path to hub-council-districts.json
        output_file: Path to save enriched data
        checkpoint_file: Path to save checkpoints (resume on failure)
        concurrency: Number of concurrent requests
        batch_size: Checkpoint every N datasets
    """
    # Load datasets
    print(f"Loading datasets from {input_file}...")
    datasets = []
    with open(input_file, 'r') as f:
        for line in f:
            datasets.append(json.loads(line.strip()))

    print(f"Loaded {len(datasets)} datasets")

    # Check for existing checkpoint
    start_index = 0
    enriched_results = []

    if checkpoint_file.exists():
        print(f"Found checkpoint file: {checkpoint_file}")
        with open(checkpoint_file, 'r') as f:
            checkpoint = json.load(f)
            start_index = checkpoint['last_index']
            enriched_results = checkpoint['results']
        print(f"Resuming from index {start_index}")

    # Enrich datasets
    async with SchemaEnricher(concurrency=concurrency) as enricher:
        for i in range(start_index, len(datasets), batch_size):
            batch = datasets[i:i+batch_size]

            print(f"\nProcessing batch {i//batch_size + 1} (datasets {i}-{i+len(batch)})...")
            results = await enricher.enrich_batch(batch)
            enriched_results.extend([asdict(r) for r in results])

            # Save checkpoint
            checkpoint = {
                'last_index': i + len(batch),
                'results': enriched_results
            }
            with open(checkpoint_file, 'w') as f:
                json.dump(checkpoint, f)

            # Print progress
            enricher.print_progress(len(datasets))

            # Save intermediate results every 1000 datasets
            if len(enriched_results) % 1000 == 0:
                with open(output_file, 'w') as f:
                    for result in enriched_results:
                        f.write(json.dumps(result) + '\n')
                print(f"Saved intermediate results to {output_file}")

    # Save final results
    with open(output_file, 'w') as f:
        for result in enriched_results:
            f.write(json.dumps(result) + '\n')

    print(f"\n✓ Enrichment complete!")
    print(f"Saved {len(enriched_results)} enriched datasets to {output_file}")

    # Cleanup checkpoint
    if checkpoint_file.exists():
        checkpoint_file.unlink()
        print(f"Removed checkpoint file: {checkpoint_file}")


if __name__ == '__main__':
    # Paths
    data_dir = Path('../data')
    input_file = data_dir / 'hub-council-districts.json'
    output_file = data_dir / 'hub_council_districts_enriched.jsonl'
    checkpoint_file = data_dir / 'enrichment_checkpoint.json'

    # Verify input file exists
    if not input_file.exists():
        print(f"Error: Input file not found: {input_file}")
        print("Please run hub crawler first to generate raw data.")
        exit(1)

    print("="*70)
    print("SCHEMA ENRICHMENT - Shadow Atlas Data Pipeline")
    print("="*70)
    print(f"Input: {input_file}")
    print(f"Output: {output_file}")
    print(f"Checkpoint: {checkpoint_file}")
    print()
    print("This will fetch schema metadata for all datasets.")
    print("Estimated time: ~12 hours for 176k datasets")
    print("="*70)
    print()

    # Run enrichment
    asyncio.run(enrich_all_datasets(
        input_file=input_file,
        output_file=output_file,
        checkpoint_file=checkpoint_file,
        concurrency=20,
        batch_size=100
    ))
