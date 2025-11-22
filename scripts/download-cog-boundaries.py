#!/usr/bin/env python3
"""
Download municipal boundaries from regional COGs using ArcGIS REST APIs
"""

import json
import requests
from pathlib import Path
from typing import Dict, List, Tuple

COG_DATASETS = [
    {
        'name': 'arc',
        'url': 'https://opendata.atlantaregional.com',
        'search_term': 'Atlanta Region Cities',
        'expected': 75,
        'coverage': 'Atlanta Regional Commission - 75 cities, 6M population'
    },
    {
        'name': 'mapc',
        'url': 'https://data.mapc.org',
        'search_term': 'Municipal Boundaries',
        'expected': 101,
        'coverage': 'Metro Boston (MAPC) - 101 municipalities, 4M population'
    },
    {
        'name': 'cmap',
        'url': 'https://datahub.cmap.illinois.gov',
        'search_term': 'municipalities',
        'expected': 284,
        'coverage': 'Chicago Metro (CMAP) - 284 municipalities, 9M population'
    },
    {
        'name': 'semcog',
        'url': 'https://gisdata-semcog.opendata.arcgis.com',
        'search_term': 'Community Boundaries',
        'expected': 147,
        'coverage': 'Southeast Michigan (SEMCOG) - 147 communities, 5M population'
    },
    {
        'name': 'nymtc',
        'url': 'https://www.nymtc.org',
        'search_term': 'Municipal Boundaries',
        'expected': 347,
        'coverage': 'NY Metro (NYMTC) - 347 municipalities, 23M population'
    }
]

# Known direct REST API endpoints (fallback if search fails)
DIRECT_ENDPOINTS = {
    'arc': 'https://services3.arcgis.com/Et5Qekg9b3STLgo3/arcgis/rest/services/Atlanta_Region_Cities/FeatureServer/0/query',
    'mapc': 'https://services1.arcgis.com/hGdibHYSPO59RG1h/arcgis/rest/services/MUNICIPALITIES_POLY/FeatureServer/0/query',
    'cmap': 'https://services.arcgis.com/rOo16HdIMeOBI4Mb/arcgis/rest/services/municipalities/FeatureServer/0/query',
    'semcog': 'https://semcog.maps.arcgis.com/sharing/rest/content/items/a8c6d3bd579a48b6b503925d805e20e8/data',
    'nymtc': 'https://services5.arcgis.com/UEUDVd1QVLH7YWJt/arcgis/rest/services/LION/FeatureServer/6/query'
}

def download_from_rest_api(endpoint: str, name: str) -> Tuple[bool, Dict]:
    """Download GeoJSON from ArcGIS REST API endpoint"""

    params = {
        'where': '1=1',
        'outFields': '*',
        'f': 'geojson',
        'returnGeometry': 'true',
        'outSR': '4326'
    }

    try:
        print(f"  Attempting download from: {endpoint}")
        response = requests.get(endpoint, params=params, timeout=60)

        if response.status_code != 200:
            print(f"  HTTP {response.status_code}: {response.text[:200]}")
            return False, {}

        data = response.json()

        if 'type' in data and data['type'] == 'FeatureCollection':
            return True, data
        else:
            print(f"  Invalid response format: {list(data.keys())[:5]}")
            return False, {}

    except Exception as e:
        print(f"  Error: {e}")
        return False, {}

def main():
    print("Regional COG Municipal Boundaries Downloader")
    print("=" * 60)

    output_dir = Path(__file__).parent.parent / 'packages' / 'crypto' / 'data' / 'regional-consortiums'
    output_dir.mkdir(parents=True, exist_ok=True)

    success_count = 0
    total_cities = 0
    results = []

    for dataset in COG_DATASETS:
        name = dataset['name']
        print(f"\n{dataset['coverage']}")

        if name in DIRECT_ENDPOINTS:
            success, geojson = download_from_rest_api(DIRECT_ENDPOINTS[name], name)

            if success and geojson:
                feature_count = len(geojson.get('features', []))

                if feature_count > 0:
                    output_path = output_dir / f'{name}.geojson'

                    with open(output_path, 'w') as f:
                        json.dump(geojson, f, indent=2)

                    size_mb = output_path.stat().st_size / 1024 / 1024

                    print(f"  ✓ Saved: {output_path.name}")
                    print(f"    Size: {size_mb:.2f} MB")
                    print(f"    Features: {feature_count}")

                    if feature_count < dataset['expected'] * 0.5:
                        print(f"    ⚠️  WARNING: Expected ~{dataset['expected']}, got {feature_count}")

                    success_count += 1
                    total_cities += feature_count
                    results.append((name, feature_count, True))
                    continue

        print(f"  ✗ Failed: {name}")
        results.append((name, 0, False))

    print("\n" + "=" * 60)
    print(f"Summary: {success_count}/{len(COG_DATASETS)} COGs downloaded successfully")
    print(f"Total cities: {total_cities:,}")
    print(f"Combined with existing SCAG + NCTCOG: {(total_cities + 1951):,} cities")

    print("\nResults:")
    for name, count, success in results:
        status = "✓" if success else "✗"
        print(f"  {status} {name.upper()}: {count:,} features")

if __name__ == '__main__':
    main()
