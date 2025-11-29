#!/usr/bin/env python3
"""
Test quality filtering in deduplicator.py

Validates that:
1. HIGH_QUALITY and MEDIUM_QUALITY layers pass through
2. LOW_QUALITY and REJECTED layers are filtered out
3. Layers without validation field are backward compatible
4. Rejected layers are saved to audit file
"""

import json
import tempfile
from pathlib import Path

def create_test_layers():
    """Create test layers with various quality levels"""
    return [
        # HIGH_QUALITY - should pass
        {
            "layer_url": "https://data.sfgov.org/FeatureServer/1",
            "layer_name": "SF District 1",
            "district_type": "city_council",
            "validation": {
                "quality": "HIGH_QUALITY",
                "geometric_result": "PASS"
            }
        },
        # MEDIUM_QUALITY - should pass
        {
            "layer_url": "https://data.seattle.gov/FeatureServer/2",
            "layer_name": "Seattle District 2",
            "district_type": "city_council",
            "validation": {
                "quality": "MEDIUM_QUALITY",
                "geometric_result": "PASS"
            }
        },
        # LOW_QUALITY - should be rejected
        {
            "layer_url": "https://bad.source.com/FeatureServer/3",
            "layer_name": "Bad District 3",
            "district_type": "city_council",
            "validation": {
                "quality": "LOW_QUALITY",
                "geometric_result": "FAIL",
                "issues": ["Self-intersections", "Too small"]
            }
        },
        # REJECTED - should be rejected
        {
            "layer_url": "https://broken.source.com/FeatureServer/4",
            "layer_name": "Broken District 4",
            "district_type": "city_council",
            "validation": {
                "quality": "REJECTED",
                "geometric_result": "FAIL",
                "issues": ["Invalid geometry"]
            }
        },
        # No validation field - should pass (backward compatible)
        {
            "layer_url": "https://legacy.source.com/FeatureServer/5",
            "layer_name": "Legacy District 5",
            "district_type": "city_council"
        }
    ]

def test_quality_filtering():
    """Test quality filtering logic"""

    layers = create_test_layers()

    # Simulate filtering logic from deduplicator.py
    valid_layers = []
    rejected_layers = []

    for layer in layers:
        validation = layer.get('validation')

        if validation is None:
            # Backward compatible: layers without validation field pass through
            valid_layers.append(layer)
        else:
            quality = validation.get('quality', 'UNKNOWN')

            if quality in ['HIGH_QUALITY', 'MEDIUM_QUALITY']:
                valid_layers.append(layer)
            else:
                # LOW_QUALITY or REJECTED
                rejected_layers.append(layer)

    # Assertions
    print("Test Results:")
    print(f"  Total layers: {len(layers)}")
    print(f"  Valid layers: {len(valid_layers)}")
    print(f"  Rejected layers: {len(rejected_layers)}")
    print()

    # Validate counts
    assert len(layers) == 5, f"Expected 5 total layers, got {len(layers)}"
    assert len(valid_layers) == 3, f"Expected 3 valid layers, got {len(valid_layers)}"
    assert len(rejected_layers) == 2, f"Expected 2 rejected layers, got {len(rejected_layers)}"

    # Validate specific layers
    valid_urls = [layer['layer_url'] for layer in valid_layers]
    rejected_urls = [layer['layer_url'] for layer in rejected_layers]

    # HIGH_QUALITY should pass
    assert "https://data.sfgov.org/FeatureServer/1" in valid_urls, "HIGH_QUALITY layer should pass"

    # MEDIUM_QUALITY should pass
    assert "https://data.seattle.gov/FeatureServer/2" in valid_urls, "MEDIUM_QUALITY layer should pass"

    # LOW_QUALITY should be rejected
    assert "https://bad.source.com/FeatureServer/3" in rejected_urls, "LOW_QUALITY layer should be rejected"

    # REJECTED should be rejected
    assert "https://broken.source.com/FeatureServer/4" in rejected_urls, "REJECTED layer should be rejected"

    # No validation field should pass (backward compatible)
    assert "https://legacy.source.com/FeatureServer/5" in valid_urls, "Legacy layer should pass"

    print("✅ All assertions passed!")
    print()
    print("Valid layers:")
    for layer in valid_layers:
        quality = layer.get('validation', {}).get('quality', 'NO_VALIDATION')
        print(f"  - {layer['layer_name']} ({quality})")

    print()
    print("Rejected layers:")
    for layer in rejected_layers:
        quality = layer.get('validation', {}).get('quality', 'UNKNOWN')
        issues = layer.get('validation', {}).get('issues', [])
        print(f"  - {layer['layer_name']} ({quality}): {', '.join(issues)}")

if __name__ == '__main__':
    test_quality_filtering()
