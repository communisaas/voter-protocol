#!/usr/bin/env python3
"""
Simple manual test for geometric validator.

Tests basic validation logic without async complexity.
"""

import sys
import json
from pathlib import Path

# Import the validator module
sys.path.insert(0, str(Path(__file__).parent))

from shapely import geometry
from shapely.geometry import shape


def test_coordinate_validity():
    """Test coordinate validation."""
    from geometric_validator import GeometricValidator

    validator = GeometricValidator()

    # Valid coordinates
    geom = geometry.Point(0, 0).buffer(1)
    valid, issues = validator.check_coordinate_validity(geom)
    assert valid, f"Valid coordinates failed: {issues}"
    print("✓ Valid coordinates PASS")

    # Invalid latitude (>90°)
    geom_dict = {
        'type': 'Polygon',
        'coordinates': [[
            [0, 0], [1, 0], [1, 95], [0, 95], [0, 0]
        ]]
    }
    geom = shape(geom_dict)
    valid, issues = validator.check_coordinate_validity(geom)
    assert not valid, "Invalid latitude should fail"
    assert any('latitude' in issue.lower() for issue in issues)
    print("✓ Invalid latitude REJECTED")

    # Invalid longitude (>180°)
    geom_dict = {
        'type': 'Polygon',
        'coordinates': [[
            [0, 0], [190, 0], [190, 1], [0, 1], [0, 0]
        ]]
    }
    geom = shape(geom_dict)
    valid, issues = validator.check_coordinate_validity(geom)
    assert not valid, "Invalid longitude should fail"
    assert any('longitude' in issue.lower() for issue in issues)
    print("✓ Invalid longitude REJECTED")


def test_degeneracy():
    """Test degeneracy checks."""
    from geometric_validator import GeometricValidator

    validator = GeometricValidator()

    # Empty polygon
    geom = geometry.Polygon()
    valid, issues = validator.check_degeneracy(geom)
    assert not valid, "Empty polygon should fail"
    assert any('empty' in issue.lower() for issue in issues)
    print("✓ Empty polygon REJECTED")

    # Valid polygon
    geom = geometry.box(0, 0, 1, 1)
    valid, issues = validator.check_degeneracy(geom)
    assert valid, f"Valid polygon failed: {issues}"
    print("✓ Valid polygon PASS")


def test_area_calculation():
    """Test area calculation."""
    from geometric_validator import GeometricValidator

    validator = GeometricValidator()

    # Create a ~1 degree square (roughly 100km x 100km at equator)
    geom_dict = {
        'type': 'Polygon',
        'coordinates': [[
            [0, 0], [1, 0], [1, 1], [0, 1], [0, 0]
        ]]
    }
    geom = shape(geom_dict)
    area = validator.calculate_area(geom)

    assert area is not None, "Area calculation failed"
    assert area > 1000, f"Area too small: {area} km² (expected ~10,000 km²)"
    assert area < 50000, f"Area too large: {area} km² (expected ~10,000 km²)"
    print(f"✓ Area calculation: {area:.1f} km² (expected ~10,000 km²)")


def test_self_intersection():
    """Test self-intersection detection and repair."""
    from geometric_validator import GeometricValidator

    validator = GeometricValidator()

    # Self-intersecting bowtie
    geom_dict = {
        'type': 'Polygon',
        'coordinates': [[
            [0, 0], [1, 1], [1, 0], [0, 1], [0, 0]
        ]]
    }
    geom = shape(geom_dict)

    assert not geom.is_valid, "Bowtie should be invalid"
    print("✓ Self-intersection detected")

    # Attempt repair
    repaired = validator.repair_geometry(geom)
    if repaired:
        assert repaired.is_valid, "Repaired geometry should be valid"
        print("✓ Self-intersection REPAIRED")
    else:
        print("✓ Self-intersection CANNOT REPAIR (expected for some cases)")


def test_full_validation():
    """Test complete validation workflow."""
    from geometric_validator import GeometricValidator

    validator = GeometricValidator()

    # Test 1: Valid square
    geom_dict = {
        'type': 'Polygon',
        'coordinates': [[
            [0, 0], [1, 0], [1, 1], [0, 1], [0, 0]
        ]]
    }

    result = validator.validate_geometry(geom_dict, 'city_council')
    assert result.quality in ['HIGH_QUALITY', 'MEDIUM_QUALITY'], f"Valid square failed: {result.quality}"
    assert result.is_valid
    print(f"✓ Valid square: {result.quality}")

    # Test 2: Invalid coordinates
    geom_dict = {
        'type': 'Polygon',
        'coordinates': [[
            [0, 0], [1, 0], [1, 95], [0, 95], [0, 0]
        ]]
    }

    result = validator.validate_geometry(geom_dict, 'city_council')
    assert result.quality == 'REJECTED', f"Invalid coordinates should be REJECTED: {result.quality}"
    assert not result.is_valid
    print(f"✓ Invalid coordinates: {result.quality}")

    # Test 3: Empty geometry
    geom = geometry.Polygon()
    geom_dict = geometry.mapping(geom)

    result = validator.validate_geometry(geom_dict, 'city_council')
    assert result.quality == 'REJECTED', f"Empty geometry should be REJECTED: {result.quality}"
    assert not result.is_valid
    print(f"✓ Empty geometry: {result.quality}")


def test_area_bounds_context():
    """Test context-aware area validation."""
    from geometric_validator import GeometricValidator

    validator = GeometricValidator()

    # ~100 km² polygon
    geom_dict = {
        'type': 'Polygon',
        'coordinates': [[
            [0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1], [0, 0]
        ]]
    }

    # Should pass for city_council
    result = validator.validate_geometry(geom_dict, 'city_council')
    assert result.checks.area_bounds == 'PASS', f"City council area check failed: {result.checks.area_bounds}"
    print(f"✓ City council area: {result.area_km2:.1f} km² (PASS)")

    # Should pass for county
    result = validator.validate_geometry(geom_dict, 'county')
    assert result.checks.area_bounds == 'PASS', f"County area check failed: {result.checks.area_bounds}"
    print(f"✓ County area: {result.area_km2:.1f} km² (PASS)")


def main():
    """Run all tests."""
    print("\n" + "="*60)
    print("GEOMETRIC VALIDATOR - MANUAL TESTS")
    print("="*60)

    tests = [
        ("Coordinate Validity", test_coordinate_validity),
        ("Degeneracy Checks", test_degeneracy),
        ("Area Calculation", test_area_calculation),
        ("Self-Intersection", test_self_intersection),
        ("Full Validation", test_full_validation),
        ("Context-Aware Area", test_area_bounds_context),
    ]

    passed = 0
    failed = 0

    for name, test_func in tests:
        print(f"\n--- {name} ---")
        try:
            test_func()
            passed += 1
            print(f"✓ {name} PASSED")
        except AssertionError as e:
            failed += 1
            print(f"✗ {name} FAILED: {e}")
        except Exception as e:
            failed += 1
            print(f"✗ {name} ERROR: {e}")

    print("\n" + "="*60)
    print(f"RESULTS: {passed} passed, {failed} failed")
    print("="*60 + "\n")

    return 0 if failed == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
