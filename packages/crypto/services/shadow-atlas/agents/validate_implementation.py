#!/usr/bin/env python3
"""
Static validation of deduplicator implementation.
Checks code structure without executing HTTP calls.
"""

import ast
import re
from pathlib import Path


def validate_deduplicator():
    """Validate deduplicator.py implementation against requirements"""
    print("="*80)
    print("DEDUPLICATOR IMPLEMENTATION VALIDATION")
    print("="*80)
    print()

    dedup_path = Path(__file__).parent / "deduplicator.py"
    source_code = dedup_path.read_text()

    results = []

    # Parse AST
    tree = ast.parse(source_code)

    # 1. Check required imports
    print("1. Checking required imports...")
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.append(alias.name)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module)

    required_imports = ['asyncio', 'aiohttp']
    for imp in required_imports:
        if imp in imports:
            print(f"   ✅ {imp} imported")
            results.append(True)
        else:
            print(f"   ❌ {imp} NOT imported")
            results.append(False)

    # 2. Check async functions
    print("\n2. Checking async function definitions...")
    async_funcs = [node.name for node in ast.walk(tree) if isinstance(node, ast.AsyncFunctionDef)]

    required_async_funcs = ['fetch_geometry', 'detect_duplicate', 'deduplicate', 'main_async']
    for func in required_async_funcs:
        if func in async_funcs:
            print(f"   ✅ async def {func}() exists")
            results.append(True)
        else:
            print(f"   ❌ async def {func}() NOT FOUND")
            results.append(False)

    # 3. Check for await statements in critical places
    print("\n3. Checking await statements...")

    # Check fetch_geometry is awaited in detect_duplicate
    detect_duplicate_func = None
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef) and node.name == 'detect_duplicate':
            detect_duplicate_func = node
            break

    if detect_duplicate_func:
        awaits = [node for node in ast.walk(detect_duplicate_func) if isinstance(node, ast.Await)]
        if len(awaits) >= 2:  # Should await fetch_geometry twice
            print(f"   ✅ detect_duplicate() has {len(awaits)} await statements")
            results.append(True)
        else:
            print(f"   ❌ detect_duplicate() has only {len(awaits)} await statements (expected >= 2)")
            results.append(False)

    # 4. Check for semaphore initialization
    print("\n4. Checking rate limiting...")
    if 'Semaphore(10)' in source_code:
        print("   ✅ asyncio.Semaphore(10) found")
        results.append(True)
    else:
        print("   ❌ asyncio.Semaphore(10) NOT FOUND")
        results.append(False)

    # 5. Check for geometry cache
    print("\n5. Checking geometry caching...")
    if '_geometry_cache' in source_code:
        print("   ✅ _geometry_cache exists")
        results.append(True)
    else:
        print("   ❌ _geometry_cache NOT FOUND")
        results.append(False)

    # Check cache usage in fetch_geometry
    fetch_geom_match = re.search(
        r'async def fetch_geometry.*?(?=\n    async def|\nclass|\Z)',
        source_code,
        re.DOTALL
    )
    if fetch_geom_match:
        fetch_geom_code = fetch_geom_match.group(0)
        if 'if layer_url in self._geometry_cache:' in fetch_geom_code:
            print("   ✅ Cache check before HTTP request")
            results.append(True)
        else:
            print("   ❌ Cache check NOT FOUND")
            results.append(False)

        if 'self._geometry_cache[layer_url] = ' in fetch_geom_code:
            print("   ✅ Cache storage after fetch")
            results.append(True)
        else:
            print("   ❌ Cache storage NOT FOUND")
            results.append(False)

    # 6. Check for stats tracking
    print("\n6. Checking stats tracking...")
    stats_fields = [
        'geometry_fetch_attempts',
        'geometry_fetch_successes',
        'geometry_fetch_failures'
    ]
    for field in stats_fields:
        if field in source_code:
            print(f"   ✅ stats['{field}'] tracked")
            results.append(True)
        else:
            print(f"   ❌ stats['{field}'] NOT FOUND")
            results.append(False)

    # 7. Check HTTP client implementation
    print("\n7. Checking HTTP client implementation...")

    if 'aiohttp.ClientSession' in source_code:
        print("   ✅ aiohttp.ClientSession used")
        results.append(True)
    else:
        print("   ❌ aiohttp.ClientSession NOT FOUND")
        results.append(False)

    if 'timeout=30' in source_code or 'timeout=aiohttp.ClientTimeout' in source_code:
        print("   ✅ Timeout configured")
        results.append(True)
    else:
        print("   ❌ Timeout NOT configured")
        results.append(False)

    # 8. Check ArcGIS REST API query parameters
    print("\n8. Checking ArcGIS REST API integration...")
    required_params = [
        'where=1=1',
        'returnGeometry=true',
        'outSR=4326',
        'f=geojson'
    ]
    for param in required_params:
        if param in source_code:
            print(f"   ✅ Query parameter: {param}")
            results.append(True)
        else:
            print(f"   ❌ Query parameter: {param} NOT FOUND")
            results.append(False)

    # 9. Check for Shapely geometry handling
    print("\n9. Checking Shapely geometry handling...")
    if 'shapely.geometry.shape' in source_code:
        print("   ✅ GeoJSON to Shapely conversion")
        results.append(True)
    else:
        print("   ❌ shapely.geometry.shape NOT FOUND")
        results.append(False)

    if 'shapely.ops.unary_union' in source_code:
        print("   ✅ Multi-feature union")
        results.append(True)
    else:
        print("   ❌ shapely.ops.unary_union NOT FOUND")
        results.append(False)

    # 10. Check error handling
    print("\n10. Checking error handling...")
    if 'asyncio.TimeoutError' in source_code:
        print("   ✅ Timeout error handling")
        results.append(True)
    else:
        print("   ❌ TimeoutError handling NOT FOUND")
        results.append(False)

    if fetch_geom_match:
        fetch_geom_code = fetch_geom_match.group(0)
        try_blocks = fetch_geom_code.count('try:')
        if try_blocks > 0:
            print(f"   ✅ Exception handling ({try_blocks} try/except blocks)")
            results.append(True)
        else:
            print("   ❌ No try/except blocks found")
            results.append(False)

    # 11. Check asyncio.run() in main
    print("\n11. Checking main entry point...")
    if 'asyncio.run(main_async())' in source_code:
        print("   ✅ asyncio.run() in main()")
        results.append(True)
    else:
        print("   ❌ asyncio.run() NOT FOUND")
        results.append(False)

    # Summary
    print("\n" + "="*80)
    passed = sum(results)
    total = len(results)
    percentage = (passed / total) * 100 if total > 0 else 0

    print(f"VALIDATION RESULTS: {passed}/{total} checks passed ({percentage:.1f}%)")
    print("="*80)

    if passed == total:
        print("\n✅ ALL CHECKS PASSED - Implementation is complete!")
        print("\nNext steps:")
        print("  1. Install dependencies: pip install -r requirements.txt")
        print("  2. Run integration tests with live ArcGIS servers")
        print("  3. Monitor geometry fetch success rates")
        return 0
    else:
        print(f"\n⚠️  {total - passed} checks failed - Review implementation")
        return 1


if __name__ == '__main__':
    exit(validate_deduplicator())
