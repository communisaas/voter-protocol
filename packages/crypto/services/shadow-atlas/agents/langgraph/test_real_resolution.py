#!/usr/bin/env python3
"""
Test spatial resolution with the full crawled dataset.
"""

import asyncio
from spatial_resolver import SpatialResolver

# Test coordinates for major US cities
TEST_CASES = [
    # (lat, lon, city_name, expected_district_count_range)
    (34.0522, -118.2437, "Los Angeles (City Hall)", (1, 20)),  # LA has 15 districts
    (40.7128, -74.0060, "NYC (Manhattan)", (1, 60)),  # NYC has 51 districts
    (33.4484, -112.0740, "Phoenix (Downtown)", (1, 10)),  # Phoenix has 8 districts
    (41.8781, -87.6298, "Chicago (Downtown)", (1, 55)),  # Chicago has 50 wards
    (29.7604, -95.3698, "Houston (Downtown)", (1, 20)),  # Houston has 16 districts
    (32.7767, -96.7970, "Dallas (Downtown)", (1, 20)),  # Dallas has 14 districts
    (37.7749, -122.4194, "San Francisco (Downtown)", (1, 15)),  # SF has 11 districts
    (47.6062, -122.3321, "Seattle (Downtown)", (1, 10)),  # Seattle has 7 districts
    (39.7392, -104.9903, "Denver (Downtown)", (1, 15)),  # Denver has 13 districts
    (38.9072, -77.0369, "Washington DC (Downtown)", (1, 10)),  # DC has 8 wards
]


async def main():
    resolver = SpatialResolver()
    await resolver.load_datasets("../data/hub-council-districts.json")

    print(f"\n=== Testing {len(TEST_CASES)} cities against {len(resolver.datasets)} datasets ===\n")

    success = 0
    failed = 0

    for lat, lon, name, expected_range in TEST_CASES:
        print(f"--- {name} ({lat}, {lon}) ---")
        result = await resolver.resolve(lat, lon)

        if result.found:
            success += 1
            print(f"  Found: District {result.district_id}")
            if result.district_name:
                print(f"  Name: {result.district_name}")
            print(f"  City: {result.city}, State: {result.state}")
            print(f"  Source: {result.source_title}")
            print(f"  Candidates checked: {result.candidates_checked}")
        else:
            failed += 1
            print(f"  NOT FOUND")
            print(f"  Method: {result.method}")
            print(f"  Candidates checked: {result.candidates_checked}")
        print()

    print(f"=== Results: {success}/{len(TEST_CASES)} cities resolved ({100*success//len(TEST_CASES)}%) ===")


if __name__ == "__main__":
    asyncio.run(main())
