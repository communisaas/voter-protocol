#!/usr/bin/env python3
"""
Validation test for deduplicator IoU implementation.
Verifies async geometry fetching without hitting live servers.
"""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch
from pathlib import Path
import sys

# Add agents directory to path
sys.path.insert(0, str(Path(__file__).parent))

from deduplicator import LayerDeduplicator

# Mock GeoJSON response (typical ArcGIS REST API format)
MOCK_GEOJSON_RESPONSE = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [-122.419, 37.775],
                    [-122.419, 37.779],
                    [-122.413, 37.779],
                    [-122.413, 37.775],
                    [-122.419, 37.775]
                ]]
            },
            "properties": {"name": "District 1"}
        }
    ]
}

MOCK_GEOJSON_RESPONSE_2 = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [-122.418, 37.776],  # Slightly overlapping
                    [-122.418, 37.780],
                    [-122.412, 37.780],
                    [-122.412, 37.776],
                    [-122.418, 37.776]
                ]]
            },
            "properties": {"name": "District 1 (Alternate)"}
        }
    ]
}


async def test_geometry_fetch():
    """Test 1: Verify geometry fetching with mock HTTP client"""
    print("\n" + "="*80)
    print("TEST 1: Geometry Fetching")
    print("="*80)

    deduplicator = LayerDeduplicator(use_spatial_index=False, fetch_geometries=True)

    # Mock aiohttp response
    mock_response = AsyncMock()
    mock_response.status = 200
    mock_response.json = AsyncMock(return_value=MOCK_GEOJSON_RESPONSE)

    mock_session = MagicMock()
    mock_session.get = MagicMock(return_value=mock_response)
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock()

    with patch('aiohttp.ClientSession', return_value=mock_session):
        geometry = await deduplicator.fetch_geometry(
            "https://example.com/arcgis/rest/services/Districts/FeatureServer/0"
        )

    # Validate result
    assert geometry is not None, "❌ FAIL: Geometry is None"
    assert hasattr(geometry, 'area'), "❌ FAIL: Not a Shapely geometry"
    assert geometry.area > 0, "❌ FAIL: Geometry has zero area"

    print(f"✅ PASS: Fetched geometry with area {geometry.area:.6f}")
    print(f"✅ Stats: {deduplicator.stats['geometry_fetch_attempts']} attempts, "
          f"{deduplicator.stats['geometry_fetch_successes']} successes")

    return deduplicator


async def test_geometry_cache():
    """Test 2: Verify caching prevents redundant HTTP calls"""
    print("\n" + "="*80)
    print("TEST 2: Geometry Caching")
    print("="*80)

    deduplicator = LayerDeduplicator(use_spatial_index=False, fetch_geometries=True)

    # Mock aiohttp response
    mock_response = AsyncMock()
    mock_response.status = 200
    mock_response.json = AsyncMock(return_value=MOCK_GEOJSON_RESPONSE)

    mock_session = MagicMock()
    mock_session.get = MagicMock(return_value=mock_response)
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock()

    layer_url = "https://example.com/arcgis/rest/services/Districts/FeatureServer/0"

    with patch('aiohttp.ClientSession', return_value=mock_session):
        # First fetch (HTTP call)
        geometry1 = await deduplicator.fetch_geometry(layer_url)

        # Second fetch (cache hit)
        geometry2 = await deduplicator.fetch_geometry(layer_url)

    # Validate
    assert geometry1 is not None, "❌ FAIL: First fetch returned None"
    assert geometry2 is not None, "❌ FAIL: Second fetch returned None"
    assert geometry1 is geometry2, "❌ FAIL: Cache not working (different objects)"
    assert deduplicator.stats['geometry_fetch_attempts'] == 1, "❌ FAIL: Made 2 HTTP calls instead of 1"

    print(f"✅ PASS: Cache hit on second fetch (attempts: {deduplicator.stats['geometry_fetch_attempts']})")
    print(f"✅ Cache size: {len(deduplicator._geometry_cache)} entries")

    return deduplicator


async def test_iou_calculation():
    """Test 3: Verify IoU calculation with overlapping geometries"""
    print("\n" + "="*80)
    print("TEST 3: IoU Calculation")
    print("="*80)

    deduplicator = LayerDeduplicator(use_spatial_index=False, fetch_geometries=True)

    # Mock HTTP responses for two layers
    def mock_response_factory(data):
        mock_resp = AsyncMock()
        mock_resp.status = 200
        mock_resp.json = AsyncMock(return_value=data)
        return mock_resp

    mock_session = MagicMock()

    # Queue responses
    responses = [
        mock_response_factory(MOCK_GEOJSON_RESPONSE),
        mock_response_factory(MOCK_GEOJSON_RESPONSE_2)
    ]
    response_iter = iter(responses)

    def get_next_response(*args, **kwargs):
        return next(response_iter)

    mock_session.get = MagicMock(side_effect=get_next_response)
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock()

    layer1_url = "https://example.com/arcgis/rest/services/Districts/FeatureServer/0"
    layer2_url = "https://example.com/arcgis/rest/services/Districts/FeatureServer/1"

    with patch('aiohttp.ClientSession', return_value=mock_session):
        geom1 = await deduplicator.fetch_geometry(layer1_url)
        geom2 = await deduplicator.fetch_geometry(layer2_url)

    # Calculate IoU
    iou = deduplicator.calculate_iou(geom1, geom2)

    # Validate
    assert geom1 is not None, "❌ FAIL: Layer 1 geometry is None"
    assert geom2 is not None, "❌ FAIL: Layer 2 geometry is None"
    assert 0.0 <= iou <= 1.0, f"❌ FAIL: IoU out of range: {iou}"
    assert iou > 0.0, "❌ FAIL: IoU is zero (geometries should overlap)"

    print(f"✅ PASS: IoU calculated: {iou:.4f}")
    print(f"✅ Layer 1 area: {geom1.area:.6f}")
    print(f"✅ Layer 2 area: {geom2.area:.6f}")
    print(f"✅ Intersection area: {geom1.intersection(geom2).area:.6f}")

    return deduplicator


async def test_http_error_handling():
    """Test 4: Verify graceful handling of HTTP errors"""
    print("\n" + "="*80)
    print("TEST 4: HTTP Error Handling")
    print("="*80)

    deduplicator = LayerDeduplicator(use_spatial_index=False, fetch_geometries=True)

    # Mock 404 response
    mock_response = AsyncMock()
    mock_response.status = 404

    mock_session = MagicMock()
    mock_session.get = MagicMock(return_value=mock_response)
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock()

    with patch('aiohttp.ClientSession', return_value=mock_session):
        geometry = await deduplicator.fetch_geometry(
            "https://example.com/arcgis/rest/services/NonExistent/FeatureServer/0"
        )

    # Validate
    assert geometry is None, "❌ FAIL: Should return None on 404"
    assert deduplicator.stats['geometry_fetch_failures'] == 1, "❌ FAIL: Failure not tracked"

    print(f"✅ PASS: Gracefully handled HTTP 404")
    print(f"✅ Stats: {deduplicator.stats['geometry_fetch_failures']} failures tracked")

    return deduplicator


async def test_duplicate_detection():
    """Test 5: End-to-end duplicate detection with IoU"""
    print("\n" + "="*80)
    print("TEST 5: End-to-End Duplicate Detection")
    print("="*80)

    deduplicator = LayerDeduplicator(use_spatial_index=False, fetch_geometries=True)

    # Mock HTTP responses
    def mock_response_factory(data):
        mock_resp = AsyncMock()
        mock_resp.status = 200
        mock_resp.json = AsyncMock(return_value=data)
        return mock_resp

    # Same geometry = duplicate
    responses = [
        mock_response_factory(MOCK_GEOJSON_RESPONSE),
        mock_response_factory(MOCK_GEOJSON_RESPONSE)
    ]
    response_iter = iter(responses)

    def get_next_response(*args, **kwargs):
        return next(response_iter)

    mock_session = MagicMock()
    mock_session.get = MagicMock(side_effect=get_next_response)
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock()

    layer1 = {
        'layer_url': 'https://data.sfgov.org/arcgis/rest/services/Districts/FeatureServer/0',
        'layer_name': 'San Francisco Supervisorial District 1',
        'district_type': 'city_council'
    }

    layer2 = {
        'layer_url': 'https://arcgis.com/arcgis/rest/services/Districts/FeatureServer/0',
        'layer_name': 'SF Supervisor District 1',
        'district_type': 'city_council'
    }

    with patch('aiohttp.ClientSession', return_value=mock_session):
        match = await deduplicator.detect_duplicate(layer1, layer2)

    # Validate
    assert match is not None, "❌ FAIL: No match returned"
    assert match.iou_score > 0.9, f"❌ FAIL: IoU too low: {match.iou_score}"
    assert match.name_similarity > 0.5, f"❌ FAIL: Name similarity too low: {match.name_similarity}"
    assert match.is_duplicate or match.is_near_duplicate, "❌ FAIL: Not detected as duplicate"
    assert match.winner_url == layer1['layer_url'], "❌ FAIL: Wrong winner (should prefer data.sfgov.org)"

    print(f"✅ PASS: Duplicate detected")
    print(f"✅ IoU: {match.iou_score:.4f}")
    print(f"✅ Name similarity: {match.name_similarity:.4f}")
    print(f"✅ Winner: {match.winner_url[:50]}... (priority: {match.layer1_priority})")

    return deduplicator


async def main():
    """Run all validation tests"""
    print("\n" + "="*80)
    print("DEDUPLICATOR IoU IMPLEMENTATION VALIDATION")
    print("="*80)
    print("Testing async geometry fetching, caching, and IoU calculation")
    print("Using mocked HTTP responses (no live server calls)")

    try:
        # Run tests
        await test_geometry_fetch()
        await test_geometry_cache()
        await test_iou_calculation()
        await test_http_error_handling()
        await test_duplicate_detection()

        # Summary
        print("\n" + "="*80)
        print("VALIDATION COMPLETE - ALL TESTS PASSED ✅")
        print("="*80)
        print("\nKey Capabilities Verified:")
        print("  ✅ Async HTTP client with ArcGIS REST API")
        print("  ✅ GeoJSON to Shapely geometry conversion")
        print("  ✅ Geometry caching (prevents redundant calls)")
        print("  ✅ IoU calculation (intersection over union)")
        print("  ✅ HTTP error handling (graceful degradation)")
        print("  ✅ End-to-end duplicate detection")
        print("\nReady for production deployment!")

        return 0

    except AssertionError as e:
        print(f"\n❌ TEST FAILED: {e}")
        return 1
    except Exception as e:
        print(f"\n❌ UNEXPECTED ERROR: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
