#!/usr/bin/env python3
"""
Test deduplicator on real Shadow Atlas data (small subset)
"""

import json
from pathlib import Path
from deduplicator import LayerDeduplicator

def main():
    agents_dir = Path(__file__).parent
    data_dir = agents_dir / "data"

    # Test on small subset
    input_path = data_dir / "test_subset_100.jsonl"

    if not input_path.exists():
        print(f"ERROR: {input_path} not found")
        print("Creating test subset...")
        import subprocess
        subprocess.run([
            "head", "-100",
            str(data_dir / "comprehensive_classified_layers.jsonl")
        ], stdout=open(input_path, 'w'), check=True)

    print(f"Loading test data from {input_path}...")
    layers = []
    with open(input_path, 'r') as f:
        for line in f:
            if line.strip():
                layers.append(json.loads(line))

    print(f"Loaded {len(layers):,} layers")

    # Analyze input
    print("\nInput Analysis:")
    district_types = {}
    priorities = {}

    for layer in layers:
        dt = layer.get('district_type', 'unknown')
        district_types[dt] = district_types.get(dt, 0) + 1

        from urllib.parse import urlparse
        domain = urlparse(layer['layer_url']).netloc
        from deduplicator import AUTHORITATIVE_DOMAINS

        priority = 10  # Default
        for auth_domain, auth_priority in AUTHORITATIVE_DOMAINS.items():
            if auth_domain in domain:
                priority = auth_priority
                break

        priorities[priority] = priorities.get(priority, 0) + 1

    print(f"\nDistrict types:")
    for dt, count in sorted(district_types.items(), key=lambda x: -x[1]):
        print(f"  {dt}: {count}")

    print(f"\nSource priorities:")
    for priority in sorted(priorities.keys(), reverse=True):
        count = priorities[priority]
        print(f"  Priority {priority:3d}: {count:3d} layers")

    # Deduplicate
    print("\n" + "="*80)
    print("Running deduplication...")
    print("="*80)

    deduplicator = LayerDeduplicator(use_spatial_index=False)  # Disable R-tree for small dataset
    unique_layers, near_duplicates = deduplicator.deduplicate(layers)

    print("\n" + "="*80)
    print("RESULTS")
    print("="*80)
    print(f"Input:  {len(layers):,} layers")
    print(f"Output: {len(unique_layers):,} unique layers")
    print(f"Duplicates detected: {deduplicator.stats['duplicates_detected']:,}")
    print(f"Near-duplicates flagged: {deduplicator.stats['near_duplicates_flagged']:,}")
    print(f"Deduplication rate: {(deduplicator.stats['duplicates_detected'] / len(layers) * 100) if len(layers) > 0 else 0:.1f}%")

    # Show provenance examples
    print("\n" + "="*80)
    print("PROVENANCE EXAMPLES")
    print("="*80)

    for i, layer in enumerate(unique_layers[:5]):
        prov = layer.get('provenance', {})
        primary = prov.get('primary_source', {})
        dupes = prov.get('duplicate_sources', [])

        print(f"\n{i+1}. {layer['layer_name'][:50]}...")
        print(f"   URL: {primary.get('url', 'unknown')[:60]}...")
        print(f"   Priority: {primary.get('priority', 'unknown')}")
        print(f"   Duplicates merged: {len(dupes)}")
        if dupes:
            for j, dup in enumerate(dupes[:2]):  # Show first 2
                print(f"     - {dup['url'][:50]}... (IoU={dup.get('iou_score', 0):.2f}, name_sim={dup.get('name_similarity', 0):.2f})")

    # Show near-duplicates
    if near_duplicates:
        print("\n" + "="*80)
        print("NEAR-DUPLICATES FOR REVIEW")
        print("="*80)
        for match in near_duplicates[:5]:
            print(f"\n- {match.layer1_url[:50]}...")
            print(f"  vs {match.layer2_url[:50]}...")
            print(f"  IoU: {match.iou_score:.2f}, Name similarity: {match.name_similarity:.2f}")

    print("\n" + "="*80)
    print("TEST COMPLETE")
    print("="*80)
    print("\nNote: This test uses a small subset (100 layers).")
    print("For full deduplication, run:")
    print("  python3 deduplicator.py")
    print("\nOutputs:")
    print("  - data/deduplicated_layers.jsonl (final unique layers)")
    print("  - data/near_duplicates_for_review.jsonl (manual review queue)")
    print("  - data/deduplication_report.txt (summary statistics)")

if __name__ == '__main__':
    main()
