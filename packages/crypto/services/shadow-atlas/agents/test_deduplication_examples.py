#!/usr/bin/env python3
"""
Practical test examples for Shadow Atlas deduplication

Demonstrates:
1. Exact duplicate detection (same district, different sources)
2. Near-duplicate detection (similar but not identical)
3. Priority-based merging (official portal beats ArcGIS Online)
4. Distinct layer preservation (no false positives)
"""

import json
from pathlib import Path
from deduplicator import LayerDeduplicator

def test_exact_duplicates():
    """Test Case 1: Exact duplicates from multiple sources"""
    print("\n" + "="*80)
    print("TEST CASE 1: Exact Duplicates")
    print("="*80)

    layers = [
        {
            'layer_url': 'https://data.sfgov.org/resource/abc123/FeatureServer/0',
            'layer_name': 'San Francisco Supervisorial District 1',
            'district_type': 'city_council',
            'feature_count': 11,
            'fields': ['OBJECTID', 'DISTRICT', 'SUPERVISOR', 'SHAPE']
        },
        {
            'layer_url': 'https://services.arcgis.com/xyz789/FeatureServer/2',
            'layer_name': 'SF District 1',
            'district_type': 'city_council',
            'feature_count': 11,
            'fields': ['FID', 'DIST_ID', 'NAME']
        },
        {
            'layer_url': 'https://gis.ca.gov/arcgis/rest/services/sf/FeatureServer/1',
            'layer_name': 'Supervisor District One',
            'district_type': 'city_council',
            'feature_count': 11,
            'fields': ['OBJECTID', 'DISTRICT_NUMBER', 'SUPERVISOR_NAME']
        }
    ]

    dedup = LayerDeduplicator(use_spatial_index=False)
    unique, near_dupes = dedup.deduplicate(layers)

    print(f"\nInput: {len(layers)} layers")
    print(f"Output: {len(unique)} unique layers")
    print(f"Duplicates detected: {dedup.stats['duplicates_detected']}")

    print("\nUnique layer:")
    for layer in unique:
        print(f"  - {layer['layer_url'][:50]}...")
        print(f"    Priority: {dedup.get_source_priority(layer['layer_url'])}")
        if layer['provenance']['duplicate_sources']:
            print(f"    Merged {len(layer['provenance']['duplicate_sources'])} duplicates:")
            for dup in layer['provenance']['duplicate_sources']:
                print(f"      - {dup['url'][:50]}... (name_sim={dup['name_similarity']:.2f})")

    print("\n✓ Expected: Official portal (data.sfgov.org) wins, other sources merged")

def test_near_duplicates():
    """Test Case 2: Near-duplicates (75% overlap, similar names)"""
    print("\n" + "="*80)
    print("TEST CASE 2: Near-Duplicates (Manual Review)")
    print("="*80)

    # These would be near-duplicates in real world (different boundaries, similar names)
    layers = [
        {
            'layer_url': 'https://data.seattle.gov/resource/council-old/FeatureServer/0',
            'layer_name': 'Seattle City Council District 1',
            'district_type': 'city_council',
            'feature_count': 7,
        },
        {
            'layer_url': 'https://data.seattle.gov/resource/council-new/FeatureServer/0',
            'layer_name': 'Seattle City Council District 1 (2021 Redistricting)',
            'district_type': 'city_council',
            'feature_count': 7,
        }
    ]

    dedup = LayerDeduplicator(use_spatial_index=False)
    unique, near_dupes = dedup.deduplicate(layers)

    print(f"\nInput: {len(layers)} layers")
    print(f"Output: {len(unique)} unique layers")
    print(f"Near-duplicates flagged: {len(near_dupes)}")

    print("\nNote: Without geometry fetching, these are treated as distinct.")
    print("With IoU calculation, these might be flagged as near-duplicates if boundaries changed.")

def test_priority_merging():
    """Test Case 3: Priority-based merging (official beats random)"""
    print("\n" + "="*80)
    print("TEST CASE 3: Priority-Based Merging")
    print("="*80)

    layers = [
        {
            'layer_url': 'https://services.arcgis.com/random123/FeatureServer/5',
            'layer_name': 'Council Districts',
            'district_type': 'city_council',
        },
        {
            'layer_url': 'https://data.boston.gov/dataset/council-districts/resource/xyz',
            'layer_name': 'Boston City Council Districts',
            'district_type': 'city_council',
        }
    ]

    dedup = LayerDeduplicator(use_spatial_index=False)

    # Show priorities
    print("\nSource priorities:")
    for layer in layers:
        url = layer['layer_url']
        priority = dedup.get_source_priority(url)
        print(f"  - {url[:50]}... → Priority {priority}")

    unique, _ = dedup.deduplicate(layers)

    print(f"\nOutput: {len(unique)} unique layers")
    print("\n✓ Expected: If duplicates, official portal (data.boston.gov) wins over ArcGIS Online")

def test_distinct_districts():
    """Test Case 4: Distinct districts (no false positives)"""
    print("\n" + "="*80)
    print("TEST CASE 4: Distinct Districts (No False Positives)")
    print("="*80)

    layers = [
        {
            'layer_url': 'https://data.example.com/city-council/FeatureServer/0',
            'layer_name': 'City Council District 1',
            'district_type': 'city_council',
        },
        {
            'layer_url': 'https://data.example.com/school-board/FeatureServer/0',
            'layer_name': 'School Board District 1',
            'district_type': 'school_board',
        },
        {
            'layer_url': 'https://data.example.com/fire/FeatureServer/0',
            'layer_name': 'Fire District 1',
            'district_type': 'fire_district',
        }
    ]

    dedup = LayerDeduplicator(use_spatial_index=False)
    unique, _ = dedup.deduplicate(layers)

    print(f"\nInput: {len(layers)} layers")
    print(f"Output: {len(unique)} unique layers")
    print(f"Duplicates detected: {dedup.stats['duplicates_detected']}")

    print("\nAll layers preserved:")
    for layer in unique:
        print(f"  - {layer['district_type']}: {layer['layer_name']}")

    print("\n✓ Expected: All 3 layers distinct (different district_type)")

def test_name_similarity():
    """Test Case 5: Name similarity edge cases"""
    print("\n" + "="*80)
    print("TEST CASE 5: Name Similarity Edge Cases")
    print("="*80)

    test_cases = [
        ("San Francisco Supervisorial District 1", "SF District 1", "High similarity (abbreviation)"),
        ("City Council District 1", "City Council District One", "High similarity (number vs word)"),
        ("District 1", "District 2", "Low similarity (different numbers)"),
        ("City Council District", "School Board District", "Medium similarity (same structure)"),
        ("", "District 1", "Zero similarity (empty string)")
    ]

    dedup = LayerDeduplicator(use_spatial_index=False)

    print("\nName similarity scores:")
    for name1, name2, description in test_cases:
        sim = dedup.calculate_name_similarity(name1, name2)
        print(f"\n  {description}")
        print(f"    '{name1}' vs '{name2}'")
        print(f"    Similarity: {sim:.2f}")

def test_domain_priorities():
    """Test Case 6: Domain priority mapping"""
    print("\n" + "="*80)
    print("TEST CASE 6: Domain Priority Mapping")
    print("="*80)

    test_urls = [
        "https://data.sfgov.org/resource/abc123",
        "https://opendata.seattle.gov/dataset/xyz",
        "https://gis.oregon.gov/arcgis/rest/services/...",
        "https://www2.census.gov/geo/tiger/...",
        "https://services.arcgis.com/random/FeatureServer/1",
        "https://unknown-server.org/data",
    ]

    dedup = LayerDeduplicator(use_spatial_index=False)

    print("\nDomain priorities (higher = more authoritative):")
    for url in test_urls:
        priority = dedup.get_source_priority(url)
        from urllib.parse import urlparse
        domain = urlparse(url).netloc
        print(f"  {domain:40s} → Priority {priority:3d}")

    print("\n✓ Official portals (100) > State GIS (90) > Census (80) > ArcGIS Online (20) > Unknown (10)")

def main():
    """Run all practical test examples"""
    print("\n" + "="*80)
    print("SHADOW ATLAS DEDUPLICATION - PRACTICAL TEST EXAMPLES")
    print("="*80)

    test_exact_duplicates()
    test_near_duplicates()
    test_priority_merging()
    test_distinct_districts()
    test_name_similarity()
    test_domain_priorities()

    print("\n" + "="*80)
    print("ALL TESTS COMPLETE")
    print("="*80)
    print("\nNOTE: These are logic tests. For full deduplication:")
    print("1. Implement geometry fetching (fetch_geometry method)")
    print("2. Run with real dataset (comprehensive_classified_layers.jsonl)")
    print("3. Review near-duplicates manually (near_duplicates_for_review.jsonl)")
    print("="*80)

if __name__ == '__main__':
    main()
