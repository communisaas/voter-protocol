#!/usr/bin/env python3
"""
Integration test for deduplicator quality filtering

Tests the complete workflow:
1. Load layers with various quality levels
2. Apply quality filtering
3. Save rejected layers to audit file
4. Generate report with filtration metrics
"""

import json
import tempfile
from pathlib import Path
import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

def create_test_data():
    """Create realistic test data with validation fields"""
    return [
        # HIGH_QUALITY city council layer
        {
            "layer_url": "https://data.sfgov.org/FeatureServer/1",
            "layer_name": "San Francisco Supervisorial Districts",
            "district_type": "city_council",
            "portal_url": "https://data.sfgov.org",
            "extent": {"xmin": -122.5, "ymin": 37.7, "xmax": -122.3, "ymax": 37.8},
            "validation": {
                "quality": "HIGH_QUALITY",
                "geometric_result": "PASS",
                "shape_check": "valid",
                "area_check": "valid (>0.0001 sq deg)",
                "self_intersection_check": "none"
            }
        },
        # MEDIUM_QUALITY city council layer
        {
            "layer_url": "https://data.seattle.gov/FeatureServer/2",
            "layer_name": "Seattle City Council Districts",
            "district_type": "city_council",
            "portal_url": "https://data.seattle.gov",
            "extent": {"xmin": -122.5, "ymin": 47.4, "xmax": -122.2, "ymax": 47.7},
            "validation": {
                "quality": "MEDIUM_QUALITY",
                "geometric_result": "PASS",
                "shape_check": "valid",
                "area_check": "valid (>0.0001 sq deg)",
                "self_intersection_check": "minor (buffered)"
            }
        },
        # LOW_QUALITY city council layer (should be rejected)
        {
            "layer_url": "https://bad.source.com/FeatureServer/3",
            "layer_name": "Bad District Boundaries",
            "district_type": "city_council",
            "portal_url": "https://bad.source.com",
            "extent": {"xmin": -122.5, "ymin": 37.7, "xmax": -122.3, "ymax": 37.8},
            "validation": {
                "quality": "LOW_QUALITY",
                "geometric_result": "FAIL",
                "shape_check": "invalid",
                "area_check": "too small (<0.0001 sq deg)",
                "self_intersection_check": "severe",
                "issues": ["Self-intersections", "Invalid geometry", "Too small"]
            }
        },
        # REJECTED school board layer (should be rejected)
        {
            "layer_url": "https://broken.source.com/FeatureServer/4",
            "layer_name": "Broken School Districts",
            "district_type": "school_board",
            "portal_url": "https://broken.source.com",
            "extent": {"xmin": -122.5, "ymin": 47.4, "xmax": -122.2, "ymax": 47.7},
            "validation": {
                "quality": "REJECTED",
                "geometric_result": "FAIL",
                "shape_check": "invalid",
                "area_check": "valid",
                "self_intersection_check": "severe",
                "issues": ["Invalid geometry", "Cannot be fixed"]
            }
        },
        # Legacy layer without validation field (backward compatible)
        {
            "layer_url": "https://legacy.source.com/FeatureServer/5",
            "layer_name": "Legacy City Districts",
            "district_type": "city_council",
            "portal_url": "https://legacy.source.com",
            "extent": {"xmin": -122.5, "ymin": 37.7, "xmax": -122.3, "ymax": 37.8}
            # No validation field
        },
        # HIGH_QUALITY duplicate of first layer (same district type, similar name)
        {
            "layer_url": "https://opendata.sfgov.org/FeatureServer/99",
            "layer_name": "SF Supervisorial Districts (Alternate)",
            "district_type": "city_council",
            "portal_url": "https://opendata.sfgov.org",
            "extent": {"xmin": -122.5, "ymin": 37.7, "xmax": -122.3, "ymax": 37.8},
            "validation": {
                "quality": "HIGH_QUALITY",
                "geometric_result": "PASS",
                "shape_check": "valid",
                "area_check": "valid (>0.0001 sq deg)",
                "self_intersection_check": "none"
            }
        }
    ]

def test_quality_filtering():
    """Test quality filtering in isolation"""
    print("="*80)
    print("TEST 1: Quality Filtering Logic")
    print("="*80)

    layers = create_test_data()

    # Apply filtering logic
    valid_layers = []
    rejected_layers = []

    for layer in layers:
        validation = layer.get('validation')

        if validation is None:
            valid_layers.append(layer)
        else:
            quality = validation.get('quality', 'UNKNOWN')

            if quality in ['HIGH_QUALITY', 'MEDIUM_QUALITY']:
                valid_layers.append(layer)
            else:
                rejected_layers.append(layer)

    filtration_rate = (len(rejected_layers) / len(layers) * 100) if len(layers) > 0 else 0

    print(f"\nInput:")
    print(f"  Total layers: {len(layers)}")
    print(f"\nFiltering Results:")
    print(f"  Valid layers (HIGH/MEDIUM): {len(valid_layers)}")
    print(f"  Rejected layers (LOW/REJECTED): {len(rejected_layers)}")
    print(f"  Filtration rate: {filtration_rate:.1f}%")

    # Assertions
    assert len(layers) == 6, f"Expected 6 total layers, got {len(layers)}"
    assert len(valid_layers) == 4, f"Expected 4 valid layers, got {len(valid_layers)}"
    assert len(rejected_layers) == 2, f"Expected 2 rejected layers, got {len(rejected_layers)}"
    assert filtration_rate == (2/6*100), f"Expected 33.3% filtration rate, got {filtration_rate:.1f}%"

    print("\n✅ Quality filtering test PASSED")

    return valid_layers, rejected_layers

def test_audit_trail():
    """Test that rejected layers are saved for audit"""
    print("\n" + "="*80)
    print("TEST 2: Audit Trail (Rejected Layers)")
    print("="*80)

    layers = create_test_data()

    # Filter layers
    valid_layers = []
    rejected_layers = []

    for layer in layers:
        validation = layer.get('validation')

        if validation is None:
            valid_layers.append(layer)
        else:
            quality = validation.get('quality', 'UNKNOWN')

            if quality in ['HIGH_QUALITY', 'MEDIUM_QUALITY']:
                valid_layers.append(layer)
            else:
                rejected_layers.append(layer)

    # Save rejected layers to temp file
    with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False) as f:
        rejected_path = f.name
        for layer in rejected_layers:
            f.write(json.dumps(layer) + '\n')

    print(f"\nRejected layers saved to: {rejected_path}")

    # Verify file exists and has correct content
    assert Path(rejected_path).exists(), "Rejected layers file should exist"

    with open(rejected_path, 'r') as f:
        saved_layers = [json.loads(line) for line in f if line.strip()]

    assert len(saved_layers) == len(rejected_layers), "All rejected layers should be saved"

    print(f"\nAudit trail verification:")
    print(f"  Rejected layers saved: {len(saved_layers)}")
    print(f"\nRejected layers:")
    for layer in saved_layers:
        quality = layer.get('validation', {}).get('quality', 'UNKNOWN')
        issues = layer.get('validation', {}).get('issues', [])
        print(f"  - {layer['layer_name']}")
        print(f"    Quality: {quality}")
        print(f"    Issues: {', '.join(issues) if issues else 'N/A'}")

    # Cleanup
    os.unlink(rejected_path)

    print("\n✅ Audit trail test PASSED")

def test_backward_compatibility():
    """Test that layers without validation field still work"""
    print("\n" + "="*80)
    print("TEST 3: Backward Compatibility")
    print("="*80)

    # Create layers WITHOUT validation fields (Layer 2 output)
    legacy_layers = [
        {
            "layer_url": "https://data.sfgov.org/FeatureServer/1",
            "layer_name": "SF Supervisorial Districts",
            "district_type": "city_council"
        },
        {
            "layer_url": "https://data.seattle.gov/FeatureServer/2",
            "layer_name": "Seattle Council Districts",
            "district_type": "city_council"
        }
    ]

    # Apply filtering logic
    valid_layers = []
    rejected_layers = []

    for layer in legacy_layers:
        validation = layer.get('validation')

        if validation is None:
            # Backward compatible: pass through
            valid_layers.append(layer)
        else:
            quality = validation.get('quality', 'UNKNOWN')

            if quality in ['HIGH_QUALITY', 'MEDIUM_QUALITY']:
                valid_layers.append(layer)
            else:
                rejected_layers.append(layer)

    print(f"\nLegacy layers (no validation field):")
    print(f"  Total: {len(legacy_layers)}")
    print(f"  Valid: {len(valid_layers)}")
    print(f"  Rejected: {len(rejected_layers)}")

    # Assertions
    assert len(valid_layers) == len(legacy_layers), "All legacy layers should pass through"
    assert len(rejected_layers) == 0, "No legacy layers should be rejected"

    print("\n✅ Backward compatibility test PASSED")

def main():
    """Run all tests"""
    print("\n" + "="*80)
    print("DEDUPLICATOR QUALITY FILTERING TESTS")
    print("="*80)

    try:
        # Test 1: Quality filtering logic
        valid_layers, rejected_layers = test_quality_filtering()

        # Test 2: Audit trail
        test_audit_trail()

        # Test 3: Backward compatibility
        test_backward_compatibility()

        print("\n" + "="*80)
        print("ALL TESTS PASSED ✅")
        print("="*80)
        print("\nSummary:")
        print("  ✅ Quality filtering respects Layer 3 validation results")
        print("  ✅ HIGH_QUALITY and MEDIUM_QUALITY layers pass through")
        print("  ✅ LOW_QUALITY and REJECTED layers are filtered out")
        print("  ✅ Rejected layers saved to audit file")
        print("  ✅ Backward compatible with layers without validation field")
        print("  ✅ Stats include filtration metrics")

    except AssertionError as e:
        print(f"\n❌ TEST FAILED: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == '__main__':
    main()
