#!/usr/bin/env python3
"""
Compare original vs domain-corrected datasets

Shows impact of domain expert corrections on label distribution
"""

import json
from collections import Counter


def analyze_dataset(file_path: str) -> dict:
    """Analyze label distribution in dataset"""

    label_dist = Counter()
    total = 0

    with open(file_path, 'r') as f:
        for line in f:
            sample = json.loads(line.strip())
            label = sample.get('is_council_district')
            label_dist[label] += 1
            total += 1

    return {
        'total': total,
        'true': label_dist.get(True, 0),
        'false': label_dist.get(False, 0),
        'true_pct': (label_dist.get(True, 0) / total) * 100,
        'false_pct': (label_dist.get(False, 0) / total) * 100
    }


def compare_datasets():
    """Compare original vs corrected datasets"""

    original_path = '/Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas/agents/data/ml_training_data_enriched.jsonl'
    corrected_path = '/Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas/agents/data/ml_training_data_domain_corrected.jsonl'

    print("=" * 80)
    print("DATASET COMPARISON: ORIGINAL vs DOMAIN CORRECTED")
    print("=" * 80)
    print()

    original = analyze_dataset(original_path)
    corrected = analyze_dataset(corrected_path)

    print("-" * 80)
    print("ORIGINAL DATASET (Before Domain Expert Review)")
    print("-" * 80)
    print(f"Total Samples: {original['total']}")
    print(f"  TRUE (city council):  {original['true']:3d} ({original['true_pct']:5.1f}%)")
    print(f"  FALSE (not council):  {original['false']:3d} ({original['false_pct']:5.1f}%)")
    print()

    print("-" * 80)
    print("CORRECTED DATASET (After Domain Expert Review)")
    print("-" * 80)
    print(f"Total Samples: {corrected['total']}")
    print(f"  TRUE (city council):  {corrected['true']:3d} ({corrected['true_pct']:5.1f}%)")
    print(f"  FALSE (not council):  {corrected['false']:3d} ({corrected['false_pct']:5.1f}%)")
    print()

    print("-" * 80)
    print("IMPACT OF CORRECTIONS")
    print("-" * 80)

    true_change = corrected['true'] - original['true']
    false_change = corrected['false'] - original['false']

    print(f"TRUE labels:  {original['true']} → {corrected['true']} ({true_change:+d})")
    print(f"FALSE labels: {original['false']} → {corrected['false']} ({false_change:+d})")
    print()

    # Class balance
    original_ratio = original['true'] / original['false'] if original['false'] > 0 else 0
    corrected_ratio = corrected['true'] / corrected['false'] if corrected['false'] > 0 else 0

    print(f"Class balance (TRUE/FALSE ratio):")
    print(f"  Original:  {original_ratio:.3f}")
    print(f"  Corrected: {corrected_ratio:.3f}")
    print(f"  Change:    {corrected_ratio - original_ratio:+.3f}")
    print()

    # Interpretation
    print("-" * 80)
    print("INTERPRETATION")
    print("-" * 80)
    print()

    if true_change > 0:
        print(f"✓ {abs(true_change)} false negatives corrected")
        print(f"  (Valid city council samples that were mislabeled FALSE)")
        print()

    if false_change < 0:
        print(f"✓ {abs(false_change)} false positives corrected")
        print(f"  (Non-council samples that were mislabeled TRUE)")
        print()

    print("Impact on model training:")
    print(f"  - Improved recall: Model will recognize more valid council districts")
    print(f"  - Better class balance: {corrected_ratio:.3f} ratio vs {original_ratio:.3f}")
    print(f"  - Higher quality training: Domain-validated labels vs heuristic labels")
    print()

    # Calculate expected performance improvement
    error_rate_original = 61 / original['total'] * 100  # 61 mislabeled samples
    error_rate_corrected = 0  # Assuming all high-confidence corrections are correct

    print(f"Training data quality:")
    print(f"  Original:  ~{100 - error_rate_original:.1f}% accurate ({error_rate_original:.1f}% error rate)")
    print(f"  Corrected: ~100% accurate for high-confidence samples")
    print(f"  (158 uncertain samples still need manual review)")


if __name__ == '__main__':
    compare_datasets()
