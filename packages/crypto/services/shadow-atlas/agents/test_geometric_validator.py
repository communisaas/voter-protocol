#!/usr/bin/env python3
"""
Unit tests for geometric validator.

Tests edge cases:
- Valid polygon (should pass)
- Self-intersecting polygon (should repair or fail)
- Unreasonably large area (should be MEDIUM_QUALITY or REJECTED)
- Unreasonably small area (should be MEDIUM_QUALITY or REJECTED)
- Invalid coordinates (lat = 95°, should be REJECTED)
- Degenerate geometry (empty polygon, should be REJECTED)
- Unclosed rings
- NaN coordinates
"""

import unittest
from geometric_validator import GeometricValidator, ValidationResult
from shapely import geometry
import json


class TestGeometricValidator(unittest.TestCase):
    """Test geometric validation logic."""

    def setUp(self):
        """Initialize validator for tests."""
        self.validator = GeometricValidator(sample_size=1, max_concurrent=1)

    def test_valid_square_polygon(self):
        """Test valid square polygon passes all checks."""
        geom_dict = {
            'type': 'Polygon',
            'coordinates': [[
                [0, 0], [1, 0], [1, 1], [0, 1], [0, 0]  # Valid square
            ]]
        }

        result = self.validator.validate_geometry(geom_dict, 'city_council')

        self.assertEqual(result.quality, 'HIGH_QUALITY')
        self.assertTrue(result.is_valid)
        self.assertEqual(result.checks.self_intersection, 'PASS')
        self.assertEqual(result.checks.coordinate_validity, 'PASS')
        self.assertEqual(result.checks.degeneracy, 'PASS')
        self.assertEqual(result.checks.closed_rings, 'PASS')
        self.assertIsNotNone(result.area_km2)

    def test_self_intersecting_bowtie(self):
        """Test self-intersecting bowtie polygon attempts repair."""
        geom_dict = {
            'type': 'Polygon',
            'coordinates': [[
                [0, 0], [1, 1], [1, 0], [0, 1], [0, 0]  # Self-intersecting bowtie
            ]]
        }

        result = self.validator.validate_geometry(geom_dict, 'city_council')

        # Should attempt repair
        self.assertTrue(result.repair_attempted)
        # Result depends on repair success (REPAIRED or FAIL)
        self.assertIn(result.checks.self_intersection, ['REPAIRED', 'FAIL'])

        if result.checks.self_intersection == 'REPAIRED':
            self.assertIn(result.quality, ['MEDIUM_QUALITY', 'LOW_QUALITY'])
        else:
            self.assertEqual(result.quality, 'REJECTED')

    def test_invalid_latitude(self):
        """Test polygon with invalid latitude (>90°) is rejected."""
        geom_dict = {
            'type': 'Polygon',
            'coordinates': [[
                [0, 0], [1, 0], [1, 95], [0, 95], [0, 0]  # lat = 95° (invalid)
            ]]
        }

        result = self.validator.validate_geometry(geom_dict, 'city_council')

        self.assertEqual(result.quality, 'REJECTED')
        self.assertFalse(result.is_valid)
        self.assertEqual(result.checks.coordinate_validity, 'FAIL')
        self.assertTrue(any('latitude' in issue.lower() for issue in result.issues))

    def test_invalid_longitude(self):
        """Test polygon with invalid longitude (>180°) is rejected."""
        geom_dict = {
            'type': 'Polygon',
            'coordinates': [[
                [0, 0], [190, 0], [190, 1], [0, 1], [0, 0]  # lon = 190° (invalid)
            ]]
        }

        result = self.validator.validate_geometry(geom_dict, 'city_council')

        self.assertEqual(result.quality, 'REJECTED')
        self.assertFalse(result.is_valid)
        self.assertEqual(result.checks.coordinate_validity, 'FAIL')
        self.assertTrue(any('longitude' in issue.lower() for issue in result.issues))

    def test_empty_polygon(self):
        """Test empty polygon is rejected as degenerate."""
        geom = geometry.Polygon()  # Empty polygon
        geom_dict = geometry.mapping(geom)

        result = self.validator.validate_geometry(geom_dict, 'city_council')

        self.assertEqual(result.quality, 'REJECTED')
        self.assertFalse(result.is_valid)
        self.assertEqual(result.checks.degeneracy, 'FAIL')
        self.assertTrue(any('empty' in issue.lower() for issue in result.issues))

    def test_zero_area_polygon(self):
        """Test zero-area sliver polygon is rejected."""
        geom_dict = {
            'type': 'Polygon',
            'coordinates': [[
                [0, 0], [1, 0], [1, 0], [0, 0], [0, 0]  # Zero area (line)
            ]]
        }

        result = self.validator.validate_geometry(geom_dict, 'city_council')

        self.assertEqual(result.quality, 'REJECTED')
        self.assertFalse(result.is_valid)
        self.assertEqual(result.checks.degeneracy, 'FAIL')

    def test_too_few_points(self):
        """Test polygon with <4 points (including closing) is rejected."""
        geom_dict = {
            'type': 'Polygon',
            'coordinates': [[
                [0, 0], [1, 0], [0, 0]  # Only 3 points (need 4 for closed triangle)
            ]]
        }

        result = self.validator.validate_geometry(geom_dict, 'city_council')

        self.assertEqual(result.quality, 'REJECTED')
        self.assertFalse(result.is_valid)
        self.assertEqual(result.checks.degeneracy, 'FAIL')

    def test_area_too_small(self):
        """Test very small area (<0.001 km²) is flagged."""
        # Create tiny polygon (1m x 1m at equator)
        geom_dict = {
            'type': 'Polygon',
            'coordinates': [[
                [0, 0], [0.00001, 0], [0.00001, 0.00001], [0, 0.00001], [0, 0]
            ]]
        }

        result = self.validator.validate_geometry(geom_dict, 'city_council')

        # Should be flagged as warning or fail
        self.assertIn(result.quality, ['MEDIUM_QUALITY', 'LOW_QUALITY', 'REJECTED'])
        if result.quality != 'REJECTED':
            self.assertIn(result.checks.area_bounds, ['WARNING', 'FAIL'])

    def test_area_too_large(self):
        """Test unreasonably large area is flagged."""
        # Create huge polygon (1000 km x 1000 km)
        geom_dict = {
            'type': 'Polygon',
            'coordinates': [[
                [0, 0], [10, 0], [10, 10], [0, 10], [0, 0]  # ~1000km x 1000km at equator
            ]]
        }

        result = self.validator.validate_geometry(geom_dict, 'city_council')

        # Should be flagged as warning (city council shouldn't be this large)
        self.assertIn(result.quality, ['MEDIUM_QUALITY', 'LOW_QUALITY', 'REJECTED'])
        if result.quality != 'REJECTED':
            self.assertIn(result.checks.area_bounds, ['WARNING', 'FAIL'])

    def test_multipolygon_empty(self):
        """Test MultiPolygon with 0 members is rejected."""
        geom = geometry.MultiPolygon([])  # Empty MultiPolygon
        geom_dict = geometry.mapping(geom)

        result = self.validator.validate_geometry(geom_dict, 'city_council')

        self.assertEqual(result.quality, 'REJECTED')
        self.assertFalse(result.is_valid)
        self.assertEqual(result.checks.degeneracy, 'FAIL')

    def test_multipolygon_valid(self):
        """Test valid MultiPolygon passes checks."""
        poly1 = geometry.Polygon([(0, 0), (1, 0), (1, 1), (0, 1)])
        poly2 = geometry.Polygon([(2, 2), (3, 2), (3, 3), (2, 3)])
        geom = geometry.MultiPolygon([poly1, poly2])
        geom_dict = geometry.mapping(geom)

        result = self.validator.validate_geometry(geom_dict, 'city_council')

        # Should pass most checks (area might be flagged depending on projection)
        self.assertIn(result.quality, ['HIGH_QUALITY', 'MEDIUM_QUALITY'])
        self.assertTrue(result.is_valid)
        self.assertEqual(result.checks.self_intersection, 'PASS')
        self.assertEqual(result.checks.coordinate_validity, 'PASS')
        self.assertEqual(result.checks.degeneracy, 'PASS')

    def test_realistic_congressional_district(self):
        """Test realistic congressional district passes."""
        # Approximate Rhode Island Congressional District (smallest state)
        geom_dict = {
            'type': 'Polygon',
            'coordinates': [[
                [-71.90, 41.10], [-71.90, 42.02], [-71.12, 42.02], [-71.12, 41.10], [-71.90, 41.10]
            ]]
        }

        result = self.validator.validate_geometry(geom_dict, 'congressional')

        self.assertIn(result.quality, ['HIGH_QUALITY', 'MEDIUM_QUALITY'])
        self.assertTrue(result.is_valid)
        self.assertEqual(result.checks.coordinate_validity, 'PASS')
        self.assertIsNotNone(result.area_km2)
        # Rhode Island is ~3,140 km², should be within bounds
        self.assertGreater(result.area_km2, 100)
        self.assertLess(result.area_km2, 200000)

    def test_context_aware_area_validation(self):
        """Test area bounds vary by district type."""
        # Same polygon tested as different district types
        geom_dict = {
            'type': 'Polygon',
            'coordinates': [[
                [0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1], [0, 0]  # ~100 km²
            ]]
        }

        # Should pass for city council (0.01-10,000 km²)
        result_city = self.validator.validate_geometry(geom_dict, 'city_council')
        self.assertEqual(result_city.checks.area_bounds, 'PASS')

        # Should pass for county (10-50,000 km²)
        result_county = self.validator.validate_geometry(geom_dict, 'county')
        self.assertEqual(result_county.checks.area_bounds, 'PASS')

    def test_nan_coordinates(self):
        """Test NaN coordinates are rejected."""
        geom_dict = {
            'type': 'Polygon',
            'coordinates': [[
                [0, 0], [float('nan'), 0], [1, 1], [0, 1], [0, 0]
            ]]
        }

        result = self.validator.validate_geometry(geom_dict, 'city_council')

        # Should be rejected (may fail at parse or coordinate check)
        self.assertEqual(result.quality, 'REJECTED')
        self.assertFalse(result.is_valid)

    def test_coordinate_bounds_extraction(self):
        """Test coordinate bounds are correctly extracted."""
        geom_dict = {
            'type': 'Polygon',
            'coordinates': [[
                [-122.5, 37.7], [-122.4, 37.7], [-122.4, 37.8], [-122.5, 37.8], [-122.5, 37.7]
            ]]
        }

        result = self.validator.validate_geometry(geom_dict, 'city_council')

        self.assertIsNotNone(result.coordinate_bounds)
        self.assertAlmostEqual(result.coordinate_bounds.min_lon, -122.5, places=1)
        self.assertAlmostEqual(result.coordinate_bounds.max_lon, -122.4, places=1)
        self.assertAlmostEqual(result.coordinate_bounds.min_lat, 37.7, places=1)
        self.assertAlmostEqual(result.coordinate_bounds.max_lat, 37.8, places=1)


class TestValidatorIntegration(unittest.TestCase):
    """Integration tests for full layer validation."""

    def setUp(self):
        """Initialize validator for integration tests."""
        self.validator = GeometricValidator(sample_size=1, max_concurrent=1)

    def test_validate_layer_non_polygon(self):
        """Test non-polygon layer is rejected."""
        layer = {
            'layer_url': 'https://example.com/FeatureServer/0',
            'layer_name': 'Points',
            'geometry_type': 'esriGeometryPoint',
            'district_type': 'city_council'
        }

        # This is a synchronous wrapper for the async method
        import asyncio
        result = asyncio.run(self.validator.validate_layer(layer))

        self.assertEqual(result['validation']['quality'], 'REJECTED')
        self.assertFalse(result['validation']['is_valid'])
        self.assertEqual(result['validation']['reason'], 'Not polygon geometry')


if __name__ == '__main__':
    unittest.main()
