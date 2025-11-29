#!/usr/bin/env python3
"""
Shadow Atlas Layer 3: Geometric Validation

PURPOSE: Validate geometry quality for district boundaries before Merkle tree construction.

VALIDATION CHECKS:
1. Self-intersection detection (shapely.is_valid)
2. Area bounds (realistic district sizes: 0.01 km² to 1,000,000 km²)
3. Coordinate validity (lat: -90 to 90, lon: -180 to 180)
4. Degenerate geometry detection (empty, zero-area, <3 points)
5. Closed rings (first point = last point)

QUALITY TIERS:
- HIGH_QUALITY: Valid geometry, reasonable area, all checks pass
- MEDIUM_QUALITY: Valid geometry, unusual area (flags for review)
- LOW_QUALITY: Invalid geometry but repairable
- REJECTED: Cannot be used (unrepairable, invalid coordinates)

INPUT: comprehensive_classified_layers.jsonl (31,316 layers)
OUTPUT: geometric_validated_layers.jsonl (augmented with validation results)

ARCHITECTURE DECISION:
- Fetch sample features (1-5) from ArcGIS REST API to validate geometry
- Do NOT fetch all features (performance: some layers have 50k+ features)
- Sample validation represents layer quality (if samples fail, layer likely has issues)
"""

import asyncio
import json
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass, asdict
import aiohttp
from tqdm.asyncio import tqdm
from shapely import geometry, validation, ops
from shapely.geometry import shape, mapping
from pyproj import Transformer, CRS
import math

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@dataclass
class CoordinateBounds:
    """Geographic coordinate bounds."""
    min_lat: float
    max_lat: float
    min_lon: float
    max_lon: float


@dataclass
class ValidationChecks:
    """Individual validation check results."""
    self_intersection: str  # PASS, FAIL, REPAIRED
    area_bounds: str  # PASS, WARNING (unusual), FAIL
    coordinate_validity: str  # PASS, FAIL
    degeneracy: str  # PASS, FAIL
    closed_rings: str  # PASS, FAIL


@dataclass
class ValidationResult:
    """Geometric validation result."""
    quality: str  # HIGH_QUALITY, MEDIUM_QUALITY, LOW_QUALITY, REJECTED
    is_valid: bool
    area_km2: Optional[float]
    coordinate_bounds: Optional[CoordinateBounds]
    checks: ValidationChecks
    issues: List[str]
    repair_attempted: bool = False
    sample_size: int = 0


class GeometricValidator:
    """
    Validates geometry quality for district boundaries.

    Fetches sample features from ArcGIS REST API to validate geometry
    without loading entire datasets into memory.
    """

    # Area bounds (km²) based on district type context
    AREA_BOUNDS = {
        'city_council': (0.01, 10000),  # City districts: 0.01 km² to 10,000 km²
        'county': (10, 50000),  # County districts: 10 km² to 50,000 km²
        'state_house': (10, 100000),  # State legislative: 10 km² to 100,000 km²
        'state_senate': (10, 200000),  # State senate: larger than house
        'congressional': (100, 200000),  # Congressional: 100 km² to 200,000 km²
        'default': (0.01, 1000000),  # Default: 0.01 km² to 1M km²
    }

    def __init__(self, sample_size: int = 3, max_concurrent: int = 10):
        """
        Initialize validator.

        Args:
            sample_size: Number of features to sample per layer (1-5)
            max_concurrent: Maximum concurrent HTTP requests
        """
        self.sample_size = sample_size
        self.semaphore = asyncio.Semaphore(max_concurrent)

        # Initialize coordinate transformer (WGS84 to Albers Equal Area for USA)
        # Use Albers Equal Area Conic projection for accurate area calculation
        self.transformer = Transformer.from_crs(
            "EPSG:4326",  # WGS84 (input)
            "ESRI:102003",  # USA Contiguous Albers Equal Area Conic
            always_xy=True
        )

    def get_area_bounds(self, district_type: str) -> Tuple[float, float]:
        """Get realistic area bounds for district type."""
        return self.AREA_BOUNDS.get(district_type, self.AREA_BOUNDS['default'])

    async def fetch_sample_features(
        self,
        session: aiohttp.ClientSession,
        layer_url: str,
        sample_size: int
    ) -> Optional[List[Dict[str, Any]]]:
        """
        Fetch sample features from ArcGIS REST API.

        Args:
            session: Shared aiohttp session (reused across requests)
            layer_url: Full layer URL (e.g., .../FeatureServer/2)
            sample_size: Number of features to fetch

        Returns:
            List of GeoJSON features or None if fetch fails
        """
        query_url = (
            f"{layer_url}/query?"
            f"where=1=1&"
            f"outFields=*&"
            f"returnGeometry=true&"
            f"outSR=4326&"  # WGS84
            f"resultRecordCount={sample_size}&"
            f"f=geojson"
        )

        try:
            async with self.semaphore:
                async with session.get(query_url, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                    if resp.status != 200:
                        logger.warning(f"HTTP {resp.status} for {layer_url}")
                        return None

                    data = await resp.json()
                    features = data.get('features', [])

                    if not features:
                        logger.warning(f"No features returned for {layer_url}")
                        return None

                    return features

        except asyncio.TimeoutError:
            logger.warning(f"Timeout fetching {layer_url}")
            return None
        except Exception as e:
            logger.warning(f"Error fetching {layer_url}: {e}")
            return None

    def check_coordinate_validity(self, geom: geometry.base.BaseGeometry) -> Tuple[bool, List[str]]:
        """
        Check if coordinates are valid (lat: -90 to 90, lon: -180 to 180).

        Returns:
            (is_valid, issues)
        """
        issues = []
        bounds = geom.bounds  # (minx, miny, maxx, maxy)

        if bounds[0] < -180 or bounds[2] > 180:
            issues.append(f'Invalid longitude: {bounds[0]} to {bounds[2]} (must be -180 to 180)')

        if bounds[1] < -90 or bounds[3] > 90:
            issues.append(f'Invalid latitude: {bounds[1]} to {bounds[3]} (must be -90 to 90)')

        # Check for NaN or infinite coordinates
        # Extract coordinates based on geometry type
        coords = []
        if isinstance(geom, geometry.Point):
            coords = [geom.coords[0]]
        elif isinstance(geom, geometry.LineString):
            coords = list(geom.coords)
        elif isinstance(geom, geometry.Polygon):
            coords = list(geom.exterior.coords)
        elif isinstance(geom, geometry.MultiPolygon):
            # Check first polygon only for performance
            if len(geom.geoms) > 0:
                coords = list(geom.geoms[0].exterior.coords)

        for coord in coords[:10]:  # Check first 10 points
            # Handle both 2D (x, y) and 3D (x, y, z) coordinates
            x, y = coord[0], coord[1]
            if math.isnan(x) or math.isnan(y):
                issues.append('NaN coordinates detected')
                break
            if math.isinf(x) or math.isinf(y):
                issues.append('Infinite coordinates detected')
                break

        return len(issues) == 0, issues

    def check_degeneracy(self, geom: geometry.base.BaseGeometry) -> Tuple[bool, List[str]]:
        """
        Check for degenerate geometries.

        Returns:
            (is_valid, issues)
        """
        issues = []

        if geom.is_empty:
            issues.append('Empty geometry')
            return False, issues

        if geom.area == 0:
            issues.append('Zero-area geometry (sliver polygon)')
            return False, issues

        if isinstance(geom, geometry.Polygon):
            # Check exterior ring has at least 3 unique points (4 with closing point)
            coords = list(geom.exterior.coords)
            if len(coords) < 4:
                issues.append(f'Polygon has only {len(coords)} points (need 4+ with closing)')
                return False, issues

        elif isinstance(geom, geometry.MultiPolygon):
            if len(geom.geoms) == 0:
                issues.append('MultiPolygon with 0 members')
                return False, issues

        return True, []

    def check_closed_rings(self, geom: geometry.base.BaseGeometry) -> Tuple[bool, List[str]]:
        """
        Check if polygon rings are closed (first point = last point).

        Shapely automatically closes rings, but this verifies the input was valid.
        """
        issues = []

        if isinstance(geom, geometry.Polygon):
            exterior = list(geom.exterior.coords)
            if exterior[0] != exterior[-1]:
                issues.append('Exterior ring not closed')

            for i, interior in enumerate(geom.interiors):
                coords = list(interior.coords)
                if coords[0] != coords[-1]:
                    issues.append(f'Interior ring {i} not closed')

        elif isinstance(geom, geometry.MultiPolygon):
            for j, poly in enumerate(geom.geoms):
                exterior = list(poly.exterior.coords)
                if exterior[0] != exterior[-1]:
                    issues.append(f'MultiPolygon[{j}] exterior ring not closed')

        return len(issues) == 0, issues

    def calculate_area(
        self,
        geom: geometry.base.BaseGeometry
    ) -> Optional[float]:
        """
        Calculate area in km² using equal-area projection.

        Args:
            geom: Shapely geometry (WGS84)

        Returns:
            Area in km² or None if calculation fails
        """
        try:
            # Transform to equal-area projection
            projected_geom = ops.transform(self.transformer.transform, geom)

            # Calculate area in m², convert to km²
            area_m2 = projected_geom.area
            area_km2 = area_m2 / 1_000_000

            return area_km2

        except Exception as e:
            logger.warning(f"Area calculation failed: {e}")
            return None

    def check_area_bounds(
        self,
        area_km2: float,
        district_type: str
    ) -> Tuple[str, List[str]]:
        """
        Check if area is within reasonable bounds for district type.

        Returns:
            (status, issues) where status is PASS, WARNING, or FAIL
        """
        min_area, max_area = self.get_area_bounds(district_type)
        issues = []

        if area_km2 < min_area:
            issues.append(f'Area too small: {area_km2:.6f} km² (min: {min_area} km²)')
            # Very small areas are likely data errors
            if area_km2 < 0.001:
                return 'FAIL', issues
            return 'WARNING', issues

        if area_km2 > max_area:
            issues.append(f'Area too large: {area_km2:.1f} km² (max: {max_area} km²)')
            # Extremely large areas might indicate wrong data (e.g., state boundary in ZIP layer)
            if area_km2 > max_area * 2:
                return 'FAIL', issues
            return 'WARNING', issues

        return 'PASS', []

    def repair_geometry(self, geom: geometry.base.BaseGeometry) -> Optional[geometry.base.BaseGeometry]:
        """
        Attempt to repair invalid geometry.

        Strategies:
        1. buffer(0) - removes self-intersections
        2. make_valid() - more aggressive repair (Shapely 2.0+)

        Returns:
            Repaired geometry or None if repair failed
        """
        try:
            # Strategy 1: buffer(0) is the classic fix for self-intersections
            repaired = geom.buffer(0)
            if repaired.is_valid and not repaired.is_empty:
                return repaired

            # Strategy 2: make_valid() for more complex issues (Shapely 2.0+)
            if hasattr(geometry, 'make_valid'):
                repaired = geometry.make_valid(geom)
                if repaired.is_valid and not repaired.is_empty:
                    return repaired

            return None

        except Exception as e:
            logger.warning(f"Geometry repair failed: {e}")
            return None

    def validate_geometry(
        self,
        geom_dict: Dict[str, Any],
        district_type: str
    ) -> ValidationResult:
        """
        Validate a single geometry.

        Args:
            geom_dict: GeoJSON geometry dict
            district_type: District type for context-aware area validation

        Returns:
            ValidationResult with quality tier and detailed checks
        """
        issues = []
        repair_attempted = False

        try:
            # Parse GeoJSON to Shapely geometry
            geom = shape(geom_dict)
        except Exception as e:
            return ValidationResult(
                quality='REJECTED',
                is_valid=False,
                area_km2=None,
                coordinate_bounds=None,
                checks=ValidationChecks(
                    self_intersection='FAIL',
                    area_bounds='FAIL',
                    coordinate_validity='FAIL',
                    degeneracy='FAIL',
                    closed_rings='FAIL'
                ),
                issues=[f'Failed to parse geometry: {e}'],
                repair_attempted=False
            )

        # Check 1: Coordinate validity (must pass, no repair possible)
        coord_valid, coord_issues = self.check_coordinate_validity(geom)
        coord_check = 'PASS' if coord_valid else 'FAIL'
        issues.extend(coord_issues)

        if not coord_valid:
            # Invalid coordinates = immediate rejection
            return ValidationResult(
                quality='REJECTED',
                is_valid=False,
                area_km2=None,
                coordinate_bounds=None,
                checks=ValidationChecks(
                    self_intersection='UNKNOWN',
                    area_bounds='UNKNOWN',
                    coordinate_validity='FAIL',
                    degeneracy='UNKNOWN',
                    closed_rings='UNKNOWN'
                ),
                issues=issues,
                repair_attempted=False
            )

        # Check 2: Degeneracy (empty, zero-area, <3 points)
        degen_valid, degen_issues = self.check_degeneracy(geom)
        degen_check = 'PASS' if degen_valid else 'FAIL'
        issues.extend(degen_issues)

        if not degen_valid:
            return ValidationResult(
                quality='REJECTED',
                is_valid=False,
                area_km2=None,
                coordinate_bounds=None,
                checks=ValidationChecks(
                    self_intersection='UNKNOWN',
                    area_bounds='UNKNOWN',
                    coordinate_validity=coord_check,
                    degeneracy='FAIL',
                    closed_rings='UNKNOWN'
                ),
                issues=issues,
                repair_attempted=False
            )

        # Check 3: Closed rings
        closed_valid, closed_issues = self.check_closed_rings(geom)
        closed_check = 'PASS' if closed_valid else 'FAIL'
        issues.extend(closed_issues)

        # Check 4: Self-intersection
        self_int_check = 'PASS'
        if not geom.is_valid:
            explain = validation.explain_validity(geom)
            issues.append(f'Invalid geometry: {explain}')

            # Attempt repair
            repair_attempted = True
            repaired = self.repair_geometry(geom)

            if repaired:
                geom = repaired
                self_int_check = 'REPAIRED'
                issues.append('Geometry repaired successfully')
            else:
                self_int_check = 'FAIL'
                return ValidationResult(
                    quality='REJECTED',
                    is_valid=False,
                    area_km2=None,
                    coordinate_bounds=None,
                    checks=ValidationChecks(
                        self_intersection='FAIL',
                        area_bounds='UNKNOWN',
                        coordinate_validity=coord_check,
                        degeneracy=degen_check,
                        closed_rings=closed_check
                    ),
                    issues=issues,
                    repair_attempted=True
                )

        # Check 5: Area bounds
        area_km2 = self.calculate_area(geom)

        if area_km2 is None:
            return ValidationResult(
                quality='LOW_QUALITY',
                is_valid=True,
                area_km2=None,
                coordinate_bounds=None,
                checks=ValidationChecks(
                    self_intersection=self_int_check,
                    area_bounds='FAIL',
                    coordinate_validity=coord_check,
                    degeneracy=degen_check,
                    closed_rings=closed_check
                ),
                issues=issues + ['Area calculation failed'],
                repair_attempted=repair_attempted
            )

        area_check, area_issues = self.check_area_bounds(area_km2, district_type)
        issues.extend(area_issues)

        # Extract coordinate bounds
        bounds = geom.bounds
        coord_bounds = CoordinateBounds(
            min_lat=bounds[1],
            max_lat=bounds[3],
            min_lon=bounds[0],
            max_lon=bounds[2]
        )

        # Determine quality tier
        checks = ValidationChecks(
            self_intersection=self_int_check,
            area_bounds=area_check,
            coordinate_validity=coord_check,
            degeneracy=degen_check,
            closed_rings=closed_check
        )

        # Quality logic:
        # - HIGH: All checks PASS
        # - MEDIUM: Minor issues (area WARNING, geometry REPAIRED)
        # - LOW: Multiple warnings or repair + warning
        # - REJECTED: Any FAIL

        if area_check == 'FAIL':
            quality = 'REJECTED'
            is_valid = False
        elif self_int_check == 'PASS' and area_check == 'PASS' and closed_check == 'PASS':
            quality = 'HIGH_QUALITY'
            is_valid = True
        elif self_int_check == 'REPAIRED' or area_check == 'WARNING':
            # Geometry works but has minor issues
            if self_int_check == 'REPAIRED' and area_check == 'WARNING':
                quality = 'LOW_QUALITY'  # Multiple issues
            else:
                quality = 'MEDIUM_QUALITY'
            is_valid = True
        else:
            quality = 'LOW_QUALITY'
            is_valid = True

        return ValidationResult(
            quality=quality,
            is_valid=is_valid,
            area_km2=area_km2,
            coordinate_bounds=coord_bounds,
            checks=checks,
            issues=issues,
            repair_attempted=repair_attempted
        )

    async def validate_layer(
        self,
        session: aiohttp.ClientSession,
        layer: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Validate a single layer by sampling features.

        Args:
            session: Shared aiohttp session (reused across requests)
            layer: Layer metadata from comprehensive_classified_layers.jsonl

        Returns:
            Layer augmented with validation results
        """
        layer_url = layer.get('layer_url')
        layer_name = layer.get('layer_name', 'Unknown')
        district_type = layer.get('district_type', 'default')
        geometry_type = layer.get('geometry_type')

        # Skip non-polygon layers (already filtered in Layer 1)
        if geometry_type != 'esriGeometryPolygon':
            return {
                **layer,
                'validation': {
                    'quality': 'REJECTED',
                    'is_valid': False,
                    'reason': 'Not polygon geometry',
                    'sample_size': 0
                }
            }

        # Fetch sample features
        features = await self.fetch_sample_features(session, layer_url, self.sample_size)

        if not features:
            return {
                **layer,
                'validation': {
                    'quality': 'LOW_QUALITY',
                    'is_valid': False,
                    'reason': 'Failed to fetch sample features',
                    'sample_size': 0
                }
            }

        # Validate each sample feature
        validation_results = []
        for feature in features:
            geom_dict = feature.get('geometry')
            if not geom_dict:
                continue

            result = self.validate_geometry(geom_dict, district_type)
            validation_results.append(result)

        if not validation_results:
            return {
                **layer,
                'validation': {
                    'quality': 'REJECTED',
                    'is_valid': False,
                    'reason': 'No valid geometries in sample',
                    'sample_size': 0
                }
            }

        # Aggregate validation results
        # If ANY sample is REJECTED, mark layer as REJECTED
        # Otherwise, use the worst quality tier from samples
        quality_tiers = [r.quality for r in validation_results]

        if 'REJECTED' in quality_tiers:
            overall_quality = 'REJECTED'
        elif 'LOW_QUALITY' in quality_tiers:
            overall_quality = 'LOW_QUALITY'
        elif 'MEDIUM_QUALITY' in quality_tiers:
            overall_quality = 'MEDIUM_QUALITY'
        else:
            overall_quality = 'HIGH_QUALITY'

        # Aggregate issues
        all_issues = []
        for r in validation_results:
            all_issues.extend(r.issues)

        # Calculate average area (if available)
        areas = [r.area_km2 for r in validation_results if r.area_km2 is not None]
        avg_area = sum(areas) / len(areas) if areas else None

        # Use first valid coordinate bounds as representative
        coord_bounds = None
        for r in validation_results:
            if r.coordinate_bounds:
                coord_bounds = asdict(r.coordinate_bounds)
                break

        # Aggregate check results (use worst status for each check)
        check_aggregation = {
            'self_intersection': 'PASS',
            'area_bounds': 'PASS',
            'coordinate_validity': 'PASS',
            'degeneracy': 'PASS',
            'closed_rings': 'PASS'
        }

        for r in validation_results:
            checks_dict = asdict(r.checks)
            for key, value in checks_dict.items():
                if value == 'FAIL':
                    check_aggregation[key] = 'FAIL'
                elif value in ['WARNING', 'REPAIRED'] and check_aggregation[key] == 'PASS':
                    check_aggregation[key] = value

        return {
            **layer,
            'validation': {
                'quality': overall_quality,
                'is_valid': overall_quality != 'REJECTED',
                'area_km2': avg_area,
                'coordinate_bounds': coord_bounds,
                'checks': check_aggregation,
                'issues': list(set(all_issues)),  # Deduplicate
                'sample_size': len(features)
            }
        }

    async def validate_dataset(
        self,
        input_path: Path,
        output_path: Path
    ) -> Dict[str, Any]:
        """
        Validate entire dataset with streaming output to avoid memory exhaustion.

        MEMORY OPTIMIZATION:
        - Process in chunks of 100 layers to keep memory bounded
        - Stream results to disk immediately after each chunk completes
        - Only accumulate statistics, not full validation results

        Args:
            input_path: Path to comprehensive_classified_layers.jsonl
            output_path: Path to write geometric_validated_layers.jsonl

        Returns:
            Validation statistics
        """
        logger.info(f"Loading layers from {input_path}")

        # Load all layers (metadata only, <100MB even for 31k layers)
        layers = []
        with open(input_path) as f:
            for line in f:
                if line.strip():
                    layers.append(json.loads(line))

        logger.info(f"Loaded {len(layers)} layers")

        # Separate polygon and non-polygon layers
        polygon_layers = [
            layer for layer in layers
            if layer.get('geometry_type') == 'esriGeometryPolygon'
        ]
        non_polygon_layers = [
            layer for layer in layers
            if layer.get('geometry_type') != 'esriGeometryPolygon'
        ]

        logger.info(f"Validating {len(polygon_layers)} polygon layers")

        # Initialize statistics
        stats = {
            'total_layers': len(layers),
            'polygon_layers': len(polygon_layers),
            'non_polygon_layers': len(non_polygon_layers),
            'quality_distribution': {
                'HIGH_QUALITY': 0,
                'MEDIUM_QUALITY': 0,
                'LOW_QUALITY': 0,
                'REJECTED': 0
            },
            'check_failures': {
                'self_intersection': 0,
                'area_bounds': 0,
                'coordinate_validity': 0,
                'degeneracy': 0,
                'closed_rings': 0
            },
            'repairs_attempted': 0,
            'repairs_successful': 0
        }

        # Open output file for streaming writes
        # Use shared aiohttp session across all requests (connection pooling)
        connector = aiohttp.TCPConnector(limit=self.semaphore._value, limit_per_host=5)
        timeout = aiohttp.ClientTimeout(total=30)

        async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
            with open(output_path, 'w') as outfile:
                # Process polygon layers in chunks of 100 to bound memory
                CHUNK_SIZE = 100
                total_chunks = (len(polygon_layers) + CHUNK_SIZE - 1) // CHUNK_SIZE

                for chunk_idx in range(total_chunks):
                    start_idx = chunk_idx * CHUNK_SIZE
                    end_idx = min(start_idx + CHUNK_SIZE, len(polygon_layers))
                    chunk = polygon_layers[start_idx:end_idx]

                    # Validate chunk concurrently (semaphore controls parallelism)
                    tasks = [self.validate_layer(session, layer) for layer in chunk]

                    # Use tqdm only for first chunk to show progress, then simple gather
                    if chunk_idx == 0:
                        validated_chunk = await tqdm.gather(
                            *tasks,
                            desc=f"Validating chunk {chunk_idx+1}/{total_chunks}",
                            total=len(tasks)
                        )
                    else:
                        validated_chunk = await asyncio.gather(*tasks)
                        logger.info(f"Completed chunk {chunk_idx+1}/{total_chunks} ({end_idx}/{len(polygon_layers)} layers)")

                    # Stream results to disk immediately
                    for validated in validated_chunk:
                        outfile.write(json.dumps(validated) + '\n')

                        # Update statistics (only accumulate counts, not full objects)
                        validation = validated.get('validation', {})
                        quality = validation.get('quality', 'UNKNOWN')

                        if quality in stats['quality_distribution']:
                            stats['quality_distribution'][quality] += 1

                        checks = validation.get('checks', {})
                        for check, status in checks.items():
                            if status in ['FAIL', 'WARNING', 'REPAIRED']:
                                if check in stats['check_failures']:
                                    stats['check_failures'][check] += 1

                        # Count repairs
                        issues = validation.get('issues', [])
                        if any('repair' in issue.lower() for issue in issues):
                            stats['repairs_attempted'] += 1
                            if any('successfully' in issue.lower() for issue in issues):
                                stats['repairs_successful'] += 1

                    # Free chunk memory immediately after processing
                    del validated_chunk
                    del tasks

                # Append non-polygon layers (already marked as REJECTED)
                for layer in non_polygon_layers:
                    rejected = {
                        **layer,
                        'validation': {
                            'quality': 'REJECTED',
                            'is_valid': False,
                            'reason': 'Not polygon geometry',
                            'sample_size': 0
                        }
                    }
                    outfile.write(json.dumps(rejected) + '\n')
                    stats['quality_distribution']['REJECTED'] += 1

        logger.info(f"Validated {len(layers)} layers total")
        return stats


async def main():
    """Main validation workflow."""
    import argparse

    parser = argparse.ArgumentParser(description='Shadow Atlas Layer 3: Geometric Validation')
    parser.add_argument(
        '--input',
        type=str,
        default='data/comprehensive_classified_layers.jsonl',
        help='Input JSONL file (classified layers)'
    )
    parser.add_argument(
        '--output',
        type=str,
        default='data/geometric_validated_layers.jsonl',
        help='Output JSONL file (validated layers)'
    )
    parser.add_argument(
        '--report',
        type=str,
        default='data/geometric_validation_report.json',
        help='Output JSON report'
    )
    parser.add_argument(
        '--sample-size',
        type=int,
        default=3,
        help='Number of features to sample per layer (1-5)'
    )
    parser.add_argument(
        '--max-concurrent',
        type=int,
        default=10,
        help='Maximum concurrent HTTP requests'
    )

    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)
    report_path = Path(args.report)

    if not input_path.exists():
        logger.error(f"Input file not found: {input_path}")
        return

    # Initialize validator
    validator = GeometricValidator(
        sample_size=args.sample_size,
        max_concurrent=args.max_concurrent
    )

    # Run validation
    logger.info("Starting geometric validation")
    stats = await validator.validate_dataset(input_path, output_path)

    # Generate report
    logger.info("Generating validation report")

    report = {
        'input_file': str(input_path),
        'output_file': str(output_path),
        'sample_size': args.sample_size,
        'statistics': stats,
        'summary': {
            'total_validated': stats['total_layers'],
            'high_quality_pct': round(stats['quality_distribution']['HIGH_QUALITY'] / stats['total_layers'] * 100, 1),
            'medium_quality_pct': round(stats['quality_distribution']['MEDIUM_QUALITY'] / stats['total_layers'] * 100, 1),
            'low_quality_pct': round(stats['quality_distribution']['LOW_QUALITY'] / stats['total_layers'] * 100, 1),
            'rejected_pct': round(stats['quality_distribution']['REJECTED'] / stats['total_layers'] * 100, 1)
        }
    }

    with open(report_path, 'w') as f:
        json.dump(report, f, indent=2)

    # Print summary
    print("\n" + "="*60)
    print("GEOMETRIC VALIDATION SUMMARY")
    print("="*60)
    print(f"Total layers: {stats['total_layers']}")
    print(f"Polygon layers: {stats['polygon_layers']}")
    print(f"\nQuality Distribution:")
    for quality, count in stats['quality_distribution'].items():
        pct = count / stats['total_layers'] * 100
        print(f"  {quality:15s}: {count:6d} ({pct:5.1f}%)")

    print(f"\nCheck Failures:")
    for check, count in stats['check_failures'].items():
        print(f"  {check:20s}: {count:6d}")

    print(f"\nGeometry Repairs:")
    print(f"  Attempted: {stats['repairs_attempted']}")
    print(f"  Successful: {stats['repairs_successful']}")

    print(f"\nOutput written to: {output_path}")
    print(f"Report written to: {report_path}")
    print("="*60)


if __name__ == '__main__':
    asyncio.run(main())
