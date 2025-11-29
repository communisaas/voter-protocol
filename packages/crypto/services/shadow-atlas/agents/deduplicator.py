#!/usr/bin/env python3
"""
Shadow Atlas Layer 4: Cross-Source Deduplication

Detects and merges duplicate district boundaries from multiple data sources using:
- IoU (Intersection over Union) for geometric overlap
- Name similarity (Levenshtein distance) for textual matching
- Priority-based merging (authoritative sources win)
- Provenance tracking (audit trail for merge decisions)

Input: geometric_validated_layers.jsonl (from Layer 3)
Output: deduplicated_layers.jsonl (final unique layers)
"""

import json
import re
import asyncio
import aiohttp
from typing import Dict, List, Tuple, Optional, Set, Any
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from urllib.parse import urlparse
import sys
from pathlib import Path
import logging

# Optional progress bar
try:
    from tqdm import tqdm
    from tqdm.asyncio import tqdm as async_tqdm
except ImportError:
    # Fallback: simple counter
    def tqdm(iterable, desc="Progress", **kwargs):
        """Minimal tqdm fallback"""
        total = len(iterable) if hasattr(iterable, '__len__') else None
        for i, item in enumerate(iterable):
            if total:
                print(f"\r{desc}: {i+1}/{total}", end='', flush=True)
            yield item
        if total:
            print()  # Newline after progress

    # Simple async fallback
    async def async_tqdm(iterable, desc="Progress", **kwargs):
        """Minimal async tqdm fallback"""
        for item in iterable:
            yield item

# Lazy imports for performance
shapely = None
rtree = None

def lazy_import_spatial():
    """Lazy import spatial libraries (heavy dependencies)"""
    global shapely, rtree
    if shapely is None:
        try:
            import shapely.geometry
            import shapely.ops
            import shapely.validation
            globals()['shapely'] = shapely
        except ImportError:
            print("ERROR: shapely not installed. Run: pip install shapely")
            sys.exit(1)

    if rtree is None:
        try:
            from rtree import index
            globals()['rtree'] = rtree
            globals()['index'] = index
        except ImportError:
            print("WARNING: rtree not installed. Falling back to O(n²) comparison.")
            print("For better performance, run: pip install rtree")

# Authoritative domain whitelist with priority scores
AUTHORITATIVE_DOMAINS = {
    # Official city portals (highest priority)
    'data.sfgov.org': 100,
    'opendata.sf.gov': 100,
    'opendata.seattle.gov': 100,
    'data.seattle.gov': 100,
    'data.boston.gov': 100,
    'data.cityofchicago.org': 100,
    'data.cityofnewyork.us': 100,
    'data.lacity.org': 100,
    'data.austintexas.gov': 100,
    'data.cityoffortworth.com': 100,
    'opendata.dc.gov': 100,

    # State portals
    'gis.oregon.gov': 90,
    'data.texas.gov': 90,
    'gis.ny.gov': 90,
    'data.ca.gov': 90,
    'data.wa.gov': 90,
    'data.colorado.gov': 90,
    'gis.georgia.gov': 90,
    'gis.nc.gov': 90,

    # Federal sources
    'census.gov': 80,
    'gis.fema.gov': 80,
    'data.gov': 80,

    # Regional agencies
    'metro.net': 70,
    'bart.gov': 70,

    # ArcGIS Online (low trust - anyone can publish)
    'arcgis.com': 20,
    'arcgisonline.com': 20,

    # Default for unknown: 10
}

@dataclass
class DuplicateMatch:
    """Result of duplicate detection"""
    layer1_url: str
    layer2_url: str
    iou_score: float
    name_similarity: float
    is_duplicate: bool  # IoU > 0.9 + name_sim > 0.8
    is_near_duplicate: bool  # IoU > 0.7 + name_sim > 0.6
    layer1_priority: int
    layer2_priority: int
    winner_url: str  # Which layer wins (higher priority)

@dataclass
class ProvenanceRecord:
    """Provenance tracking for merged layers"""
    primary_source: Dict[str, any]
    duplicate_sources: List[Dict[str, any]] = field(default_factory=list)
    merge_decision: str = ""

class LayerDeduplicator:
    """Cross-source deduplication with IoU + name similarity"""

    def __init__(self, use_spatial_index: bool = True, fetch_geometries: bool = True):
        self.use_spatial_index = use_spatial_index
        self.fetch_geometries = fetch_geometries  # NEW: Allow disabling geometry fetching
        self.spatial_index = None
        self.layers_by_id = {}

        # Statistics
        self.stats = {
            'input_count': 0,
            'valid_layers': 0,  # NEW: Valid layers after quality filtering
            'rejected_layers': 0,  # NEW: Rejected layers (LOW_QUALITY/REJECTED)
            'filtration_rate': 0.0,  # NEW: Percentage of layers filtered out
            'duplicates_detected': 0,
            'near_duplicates_flagged': 0,
            'unique_output': 0,
            'merge_by_priority': 0,
            'geometry_fetch_attempts': 0,  # NEW
            'geometry_fetch_successes': 0,  # NEW
            'geometry_fetch_failures': 0,   # NEW
        }

        # Caches
        self._geometry_cache = {}
        self._name_norm_cache = {}

        # Async semaphore for rate limiting
        self._semaphore = asyncio.Semaphore(10)  # Max 10 concurrent requests

        # Setup logging
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s'
        )
        self.logger = logging.getLogger(__name__)

    def normalize_name(self, name: str) -> str:
        """Normalize district name for comparison

        Example:
            "San Francisco Supervisorial District 1" → "sanfranciscosupervisorial1"
            "SF District 1" → "sfdistrict1"
        """
        if name in self._name_norm_cache:
            return self._name_norm_cache[name]

        # Lowercase
        normalized = name.lower()

        # Remove common prefixes/suffixes
        normalized = re.sub(r'\b(city|town|county|district|of|the|ward|precinct)\b', '', normalized)

        # Remove non-alphanumeric
        normalized = re.sub(r'[^a-z0-9]', '', normalized)

        self._name_norm_cache[name] = normalized
        return normalized

    def calculate_name_similarity(self, name1: str, name2: str) -> float:
        """Calculate Levenshtein similarity between two names"""
        norm1 = self.normalize_name(name1)
        norm2 = self.normalize_name(name2)

        if not norm1 or not norm2:
            return 0.0

        return SequenceMatcher(None, norm1, norm2).ratio()

    def get_source_priority(self, layer_url: str) -> int:
        """Determine source priority from URL"""
        parsed = urlparse(layer_url)
        domain = parsed.netloc.lower()

        # Check known authoritative domains
        for auth_domain, priority in AUTHORITATIVE_DOMAINS.items():
            if auth_domain in domain:
                return priority

        # Default priority for unknown sources
        return 10

    async def fetch_geometry(self, layer_url: str) -> Optional[Any]:
        """Fetch geometry from ArcGIS REST API (with caching)

        Fetches all features from layer and unions them into single geometry.
        This represents the complete district boundary.

        Args:
            layer_url: Full layer URL (e.g., .../FeatureServer/2)

        Returns:
            Shapely geometry (Polygon or MultiPolygon) or None if fetch fails
        """
        # Check cache first
        if layer_url in self._geometry_cache:
            return self._geometry_cache[layer_url]

        if not self.fetch_geometries:
            return None

        self.stats['geometry_fetch_attempts'] += 1

        # Build query URL
        query_url = (
            f"{layer_url}/query?"
            f"where=1=1&"
            f"outFields=*&"
            f"returnGeometry=true&"
            f"outSR=4326&"  # WGS84
            f"f=geojson"
        )

        try:
            async with self._semaphore:
                async with aiohttp.ClientSession() as session:
                    async with session.get(query_url, timeout=30) as resp:
                        if resp.status != 200:
                            self.logger.warning(f"HTTP {resp.status} for {layer_url}")
                            self.stats['geometry_fetch_failures'] += 1
                            return None

                        data = await resp.json()
                        features = data.get('features', [])

                        if not features:
                            self.logger.warning(f"No features returned for {layer_url}")
                            self.stats['geometry_fetch_failures'] += 1
                            return None

                        # Convert GeoJSON features to Shapely geometries
                        lazy_import_spatial()  # Ensure shapely is loaded

                        geoms = []
                        for feature in features:
                            geom_dict = feature.get('geometry')
                            if geom_dict:
                                try:
                                    geom = shapely.geometry.shape(geom_dict)
                                    if geom and not geom.is_empty:
                                        geoms.append(geom)
                                except Exception as e:
                                    self.logger.debug(f"Failed to parse feature geometry: {e}")
                                    continue

                        if not geoms:
                            self.logger.warning(f"No valid geometries in {layer_url}")
                            self.stats['geometry_fetch_failures'] += 1
                            return None

                        # Union all features into single geometry (dissolve internal boundaries)
                        if len(geoms) == 1:
                            combined = geoms[0]
                        else:
                            try:
                                combined = shapely.ops.unary_union(geoms)
                            except Exception as e:
                                self.logger.warning(f"Failed to union geometries for {layer_url}: {e}")
                                self.stats['geometry_fetch_failures'] += 1
                                return None

                        # Validate result
                        if combined.is_empty:
                            self.logger.warning(f"Empty geometry after union for {layer_url}")
                            self.stats['geometry_fetch_failures'] += 1
                            return None

                        # Cache result
                        self._geometry_cache[layer_url] = combined
                        self.stats['geometry_fetch_successes'] += 1

                        return combined

        except asyncio.TimeoutError:
            self.logger.warning(f"Timeout fetching geometry for {layer_url}")
            self.stats['geometry_fetch_failures'] += 1
            return None
        except Exception as e:
            self.logger.warning(f"Error fetching geometry for {layer_url}: {e}")
            self.stats['geometry_fetch_failures'] += 1
            return None

    def calculate_iou(self, geom1: any, geom2: any) -> float:
        """Calculate Intersection over Union (IoU) for two geometries"""
        if geom1 is None or geom2 is None:
            return 0.0

        try:
            # Ensure geometries are valid
            if not geom1.is_valid:
                geom1 = geom1.buffer(0)
            if not geom2.is_valid:
                geom2 = geom2.buffer(0)

            # Calculate intersection and union
            intersection = geom1.intersection(geom2)
            union = geom1.union(geom2)

            # IoU = intersection area / union area
            if union.area == 0:
                return 0.0

            iou = intersection.area / union.area
            return iou
        except Exception as e:
            self.logger.error(f"IoU calculation failed: {e}")
            return 0.0

    def build_spatial_index(self, layers: List[Dict]) -> Optional[any]:
        """Build R-tree spatial index for fast candidate selection"""
        if not self.use_spatial_index or rtree is None:
            return None

        lazy_import_spatial()

        self.logger.info("Building spatial index...")
        idx = index.Index()

        for i, layer in enumerate(tqdm(layers, desc="Indexing")):
            # For now, use bounding box from layer metadata if available
            # In production, would fetch actual geometry
            # Placeholder: assume layers have 'extent' field
            if 'extent' in layer:
                extent = layer['extent']
                bounds = (
                    extent.get('xmin', 0),
                    extent.get('ymin', 0),
                    extent.get('xmax', 0),
                    extent.get('ymax', 0)
                )
                idx.insert(i, bounds)

            self.layers_by_id[i] = layer

        return idx

    def find_candidates(self, layer: Dict, layer_idx: int, layers: List[Dict]) -> List[int]:
        """Find candidate duplicates using spatial index or brute force"""
        candidates = []

        if self.spatial_index is not None and 'extent' in layer:
            # Use spatial index (fast)
            extent = layer['extent']
            bounds = (
                extent.get('xmin', 0),
                extent.get('ymin', 0),
                extent.get('xmax', 0),
                extent.get('ymax', 0)
            )

            # Query spatial index for overlapping layers
            candidate_ids = list(self.spatial_index.intersection(bounds))
            candidates = [i for i in candidate_ids if i != layer_idx]
        else:
            # Brute force (slow, O(n²))
            candidates = [i for i in range(len(layers)) if i != layer_idx]

        return candidates

    async def detect_duplicate(self, layer1: Dict, layer2: Dict) -> DuplicateMatch:
        """Detect if two layers are duplicates using IoU + name similarity"""

        # D1: Exact URL match (definite duplicate)
        if layer1['layer_url'] == layer2['layer_url']:
            return DuplicateMatch(
                layer1_url=layer1['layer_url'],
                layer2_url=layer2['layer_url'],
                iou_score=1.0,
                name_similarity=1.0,
                is_duplicate=True,
                is_near_duplicate=False,
                layer1_priority=self.get_source_priority(layer1['layer_url']),
                layer2_priority=self.get_source_priority(layer2['layer_url']),
                winner_url=layer1['layer_url']
            )

        # D2: Must be same district type (don't compare city_council with school_board)
        if layer1.get('district_type') != layer2.get('district_type'):
            return DuplicateMatch(
                layer1_url=layer1['layer_url'],
                layer2_url=layer2['layer_url'],
                iou_score=0.0,
                name_similarity=0.0,
                is_duplicate=False,
                is_near_duplicate=False,
                layer1_priority=self.get_source_priority(layer1['layer_url']),
                layer2_priority=self.get_source_priority(layer2['layer_url']),
                winner_url=''
            )

        # D3: Calculate name similarity
        name_sim = self.calculate_name_similarity(
            layer1.get('layer_name', ''),
            layer2.get('layer_name', '')
        )

        # Early exit if name similarity too low (skip expensive IoU)
        if name_sim < 0.5:
            return DuplicateMatch(
                layer1_url=layer1['layer_url'],
                layer2_url=layer2['layer_url'],
                iou_score=0.0,
                name_similarity=name_sim,
                is_duplicate=False,
                is_near_duplicate=False,
                layer1_priority=self.get_source_priority(layer1['layer_url']),
                layer2_priority=self.get_source_priority(layer2['layer_url']),
                winner_url=''
            )

        # D4: Calculate IoU (expensive, now async)
        geom1 = await self.fetch_geometry(layer1['layer_url'])  # ✅ NOW ASYNC
        geom2 = await self.fetch_geometry(layer2['layer_url'])  # ✅ NOW ASYNC
        iou = self.calculate_iou(geom1, geom2)

        # D5: Determine duplicate status
        is_duplicate = (iou > 0.9 and name_sim > 0.8) or iou > 0.95
        is_near_duplicate = (iou > 0.7 and name_sim > 0.6) and not is_duplicate

        # D6: Priority-based winner
        priority1 = self.get_source_priority(layer1['layer_url'])
        priority2 = self.get_source_priority(layer2['layer_url'])
        winner_url = layer1['layer_url'] if priority1 >= priority2 else layer2['layer_url']

        return DuplicateMatch(
            layer1_url=layer1['layer_url'],
            layer2_url=layer2['layer_url'],
            iou_score=iou,
            name_similarity=name_sim,
            is_duplicate=is_duplicate,
            is_near_duplicate=is_near_duplicate,
            layer1_priority=priority1,
            layer2_priority=priority2,
            winner_url=winner_url
        )

    async def deduplicate(self, layers: List[Dict]) -> Tuple[List[Dict], List[DuplicateMatch]]:
        """Main deduplication pipeline (async for geometry fetching)

        Returns:
            - unique_layers: Deduplicated layers with provenance
            - near_duplicates: Near-duplicates flagged for manual review
        """
        # Note: input_count may have been set by caller (e.g., total before filtering)
        # Only update if not set
        if self.stats.get('valid_layers', 0) == 0:
            self.stats['valid_layers'] = len(layers)

        self.logger.info(f"Starting deduplication of {len(layers)} layers")

        # Build spatial index (sync)
        if self.use_spatial_index:
            self.spatial_index = self.build_spatial_index(layers)

        # Track which layers have been merged
        merged_into = {}  # layer_url → winner_url
        duplicate_groups = {}  # winner_url → [duplicate_urls]
        near_duplicates = []

        # Compare all pairs (with optimization)
        self.logger.info("Detecting duplicates...")

        # Collect all comparison tasks
        comparison_tasks = []
        for i, layer1 in enumerate(layers):
            if layer1['layer_url'] in merged_into:
                continue

            candidates = self.find_candidates(layer1, i, layers)

            for j in candidates:
                if j <= i:
                    continue

                layer2 = layers[j]

                if layer2['layer_url'] in merged_into:
                    continue

                # Add async comparison task
                comparison_tasks.append((i, j, layer1, layer2))

        # Execute comparisons with progress tracking
        self.logger.info(f"Comparing {len(comparison_tasks)} layer pairs...")

        results = []
        # Process in batches to show progress
        batch_size = 50
        for batch_idx in range(0, len(comparison_tasks), batch_size):
            batch = comparison_tasks[batch_idx:batch_idx + batch_size]
            batch_num = batch_idx // batch_size + 1
            total_batches = (len(comparison_tasks) - 1) // batch_size + 1

            self.logger.info(f"Processing batch {batch_num}/{total_batches}...")

            # Execute batch concurrently
            tasks = [self.detect_duplicate(task[2], task[3]) for task in batch]
            batch_results = await asyncio.gather(*tasks)

            # Combine with indices
            for (i, j, _, _), match in zip(batch, batch_results):
                results.append((i, j, match))

        # Process results
        for i, j, match in results:
            if match.is_duplicate:
                # Mark as duplicate
                self.stats['duplicates_detected'] += 1

                winner_url = match.winner_url
                loser_url = match.layer1_url if winner_url == match.layer2_url else match.layer2_url

                merged_into[loser_url] = winner_url

                if winner_url not in duplicate_groups:
                    duplicate_groups[winner_url] = []
                duplicate_groups[winner_url].append({
                    'url': loser_url,
                    'iou_score': match.iou_score,
                    'name_similarity': match.name_similarity,
                    'priority': match.layer1_priority if loser_url == match.layer1_url else match.layer2_priority
                })

                self.logger.debug(f"Duplicate: {loser_url[:50]}... → {winner_url[:50]}... (IoU={match.iou_score:.2f}, name_sim={match.name_similarity:.2f})")

            elif match.is_near_duplicate:
                # Flag for manual review
                self.stats['near_duplicates_flagged'] += 1
                near_duplicates.append(match)

        # Build unique layer list with provenance
        unique_layers = []
        seen = set()

        for layer in layers:
            url = layer['layer_url']

            # Skip if merged into another layer
            if url in merged_into:
                continue

            # Skip if already added
            if url in seen:
                continue

            seen.add(url)

            # Add provenance
            layer_with_provenance = layer.copy()

            if url in duplicate_groups:
                # This layer has duplicates merged into it
                priority = self.get_source_priority(url)
                layer_with_provenance['provenance'] = {
                    'primary_source': {
                        'url': url,
                        'priority': priority,
                        'discovered_date': layer.get('discovered_date', 'unknown')
                    },
                    'duplicate_sources': duplicate_groups[url],
                    'merge_decision': f"Selected primary_source (priority {priority}), merged {len(duplicate_groups[url])} duplicates"
                }
                self.stats['merge_by_priority'] += len(duplicate_groups[url])
            else:
                # No duplicates found
                priority = self.get_source_priority(url)
                layer_with_provenance['provenance'] = {
                    'primary_source': {
                        'url': url,
                        'priority': priority,
                        'discovered_date': layer.get('discovered_date', 'unknown')
                    },
                    'duplicate_sources': [],
                    'merge_decision': 'No duplicates detected'
                }

            unique_layers.append(layer_with_provenance)

        self.stats['unique_output'] = len(unique_layers)

        return unique_layers, near_duplicates

    def generate_report(self, output_path: Path):
        """Generate deduplication report"""
        report_lines = [
            "# Shadow Atlas Deduplication Report",
            "",
            "## Summary Statistics",
            f"- Total layers input: {self.stats['input_count']:,}",
            f"- Valid layers (HIGH/MEDIUM quality): {self.stats['valid_layers']:,}",
            f"- Rejected layers (LOW/REJECTED quality): {self.stats['rejected_layers']:,}",
            f"- Filtration rate: {self.stats['filtration_rate']:.2f}%",
            "",
            "## Deduplication Results",
            f"- Duplicates detected: {self.stats['duplicates_detected']:,}",
            f"- Near-duplicates flagged: {self.stats['near_duplicates_flagged']:,}",
            f"- Final unique layers: {self.stats['unique_output']:,}",
            f"- Deduplication rate: {(self.stats['duplicates_detected'] / self.stats['valid_layers'] * 100) if self.stats['valid_layers'] > 0 else 0:.2f}%",
            "",
            "## Merge Statistics",
            f"- Layers merged by priority: {self.stats['merge_by_priority']:,}",
            "",
            "## Source Priority",
            "Priority scores used for conflict resolution:",
            ""
        ]

        # Add domain priorities
        sorted_domains = sorted(AUTHORITATIVE_DOMAINS.items(), key=lambda x: x[1], reverse=True)
        for domain, priority in sorted_domains[:10]:
            report_lines.append(f"- {domain}: {priority}")

        report_lines.append("")
        report_lines.append(f"Total authoritative domains: {len(AUTHORITATIVE_DOMAINS)}")

        # Write report
        report_path = output_path.parent / "deduplication_report.txt"
        report_path.write_text('\n'.join(report_lines))
        self.logger.info(f"Report written to {report_path}")

async def main_async():
    """Main deduplication pipeline (async)"""

    # Paths
    agents_dir = Path(__file__).parent
    data_dir = agents_dir / "data"

    # Input: Layer 3 output (geometric validation)
    # Fallback: Layer 2 output (classification)
    input_path = data_dir / "geometric_validated_layers.jsonl"
    if not input_path.exists():
        print(f"WARNING: {input_path} not found. Falling back to comprehensive_classified_layers.jsonl")
        print("NOTE: Geometric validation (Layer 3) should be run before deduplication (Layer 4)")
        input_path = data_dir / "comprehensive_classified_layers.jsonl"

    if not input_path.exists():
        print(f"ERROR: Input file not found: {input_path}")
        print("Expected: geometric_validated_layers.jsonl (from Layer 3)")
        print("Fallback: comprehensive_classified_layers.jsonl (from Layer 2)")
        sys.exit(1)

    # Output paths
    output_path = data_dir / "deduplicated_layers.jsonl"
    near_duplicates_path = data_dir / "near_duplicates_for_review.jsonl"
    rejected_path = data_dir / "rejected_layers.jsonl"  # NEW: Save rejected for audit

    # Load input
    print(f"Loading input from {input_path}...")
    layers = []
    with open(input_path, 'r') as f:
        for line in f:
            if line.strip():
                layers.append(json.loads(line))

    print(f"Loaded {len(layers):,} layers")

    # NEW: Filter by quality (respect Layer 3 validation results)
    valid_layers = []
    rejected_layers = []

    for layer in layers:
        validation = layer.get('validation')

        if validation is None:
            # No validation field = Layer 2 output only (include by default)
            valid_layers.append(layer)
        else:
            quality = validation.get('quality', 'UNKNOWN')

            if quality in ['HIGH_QUALITY', 'MEDIUM_QUALITY']:
                # Valid geometry, safe to deduplicate
                valid_layers.append(layer)
            else:
                # REJECTED or LOW_QUALITY: Skip deduplication
                rejected_layers.append(layer)

    filtration_rate = (len(rejected_layers) / len(layers) * 100) if len(layers) > 0 else 0

    print(f"\nQuality Filtering:")
    print(f"  Valid layers (HIGH/MEDIUM):     {len(valid_layers):,}")
    print(f"  Rejected layers (LOW/REJECTED): {len(rejected_layers):,}")
    print(f"  Filtration rate: {filtration_rate:.1f}%")

    if len(valid_layers) == 0:
        print("\nERROR: No valid layers to deduplicate after quality filtering")
        sys.exit(1)

    # Deduplicate valid layers only (now async)
    print(f"\nDeduplicating {len(valid_layers):,} valid layers...")
    deduplicator = LayerDeduplicator(use_spatial_index=True, fetch_geometries=True)

    # Populate stats for report
    deduplicator.stats['input_count'] = len(layers)
    deduplicator.stats['valid_layers'] = len(valid_layers)
    deduplicator.stats['rejected_layers'] = len(rejected_layers)
    deduplicator.stats['filtration_rate'] = filtration_rate

    unique_layers, near_duplicates = await deduplicator.deduplicate(valid_layers)  # ✅ AWAIT

    # Write outputs
    print(f"\nWriting {len(unique_layers):,} unique layers to {output_path}...")
    with open(output_path, 'w') as f:
        for layer in unique_layers:
            f.write(json.dumps(layer) + '\n')

    print(f"Writing {len(near_duplicates):,} near-duplicates to {near_duplicates_path}...")
    with open(near_duplicates_path, 'w') as f:
        for match in near_duplicates:
            f.write(json.dumps({
                'layer1_url': match.layer1_url,
                'layer2_url': match.layer2_url,
                'iou_score': match.iou_score,
                'name_similarity': match.name_similarity,
                'layer1_priority': match.layer1_priority,
                'layer2_priority': match.layer2_priority,
                'review_reason': 'Near-duplicate detected (IoU > 0.7, name_sim > 0.6 but below duplicate threshold)'
            }) + '\n')

    # NEW: Save rejected layers for audit trail
    if rejected_layers:
        print(f"Writing {len(rejected_layers):,} rejected layers to {rejected_path}...")
        with open(rejected_path, 'w') as f:
            for layer in rejected_layers:
                f.write(json.dumps(layer) + '\n')

    # Generate report
    deduplicator.generate_report(output_path)

    # Print summary
    print("\n" + "="*80)
    print("DEDUPLICATION COMPLETE")
    print("="*80)
    print(f"Input:  {len(layers):,} layers")
    print(f"Valid:  {len(valid_layers):,} layers (after quality filter)")
    print(f"Output: {deduplicator.stats['unique_output']:,} unique layers")
    print(f"Duplicates: {deduplicator.stats['duplicates_detected']:,} ({(deduplicator.stats['duplicates_detected'] / len(valid_layers) * 100) if len(valid_layers) > 0 else 0:.1f}%)")
    print(f"Near-duplicates: {deduplicator.stats['near_duplicates_flagged']:,}")
    print(f"Rejected: {len(rejected_layers):,}")

    # Geometry fetch statistics (if available)
    if deduplicator.stats['geometry_fetch_attempts'] > 0:
        print(f"\nGeometry Fetching:")
        print(f"  Attempts:  {deduplicator.stats['geometry_fetch_attempts']:,}")
        print(f"  Successes: {deduplicator.stats['geometry_fetch_successes']:,}")
        print(f"  Failures:  {deduplicator.stats['geometry_fetch_failures']:,}")
        success_rate = (deduplicator.stats['geometry_fetch_successes'] / deduplicator.stats['geometry_fetch_attempts'] * 100) if deduplicator.stats['geometry_fetch_attempts'] > 0 else 0
        print(f"  Success Rate: {success_rate:.1f}%")

    print("="*80)


def main():
    """Entry point"""
    asyncio.run(main_async())


if __name__ == '__main__':
    main()
