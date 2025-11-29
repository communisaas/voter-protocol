#!/usr/bin/env python3
"""
Apply high feature count corrections to the ML training dataset.

This script reads the corrections from high_feature_count_corrections.jsonl
and applies them to the training dataset, updating is_council_district labels.

Usage:
    python3 apply_corrections.py

Input:
    - ../data/ml_training_data_tier1_corrected.jsonl (original dataset)
    - high_feature_count_corrections.jsonl (corrections to apply)

Output:
    - ../data/ml_training_data_tier1_corrected.jsonl (updated in place)
    - ../data/ml_training_data_tier1_corrected.backup.jsonl (backup of original)
"""

import json
import shutil
from datetime import datetime
from pathlib import Path

def load_corrections(corrections_path):
    """Load corrections from JSONL file."""
    corrections = {}
    with open(corrections_path, 'r') as f:
        for line in f:
            if line.strip():
                correction = json.loads(line)
                corrections[correction['dataset_id']] = correction
    return corrections

def apply_corrections(dataset_path, corrections):
    """Apply corrections to dataset."""
    # Create backup
    backup_path = dataset_path.replace('.jsonl', f'.backup_{datetime.now().strftime("%Y%m%d_%H%M%S")}.jsonl')
    shutil.copy2(dataset_path, backup_path)
    print(f"✅ Created backup: {backup_path}")

    # Load dataset
    samples = []
    with open(dataset_path, 'r') as f:
        for line in f:
            if line.strip():
                samples.append(json.loads(line))

    print(f"📊 Loaded {len(samples)} samples from dataset")

    # Apply corrections
    corrected_count = 0
    correction_log = []

    for sample in samples:
        dataset_id = sample.get('dataset_id')
        if dataset_id in corrections:
            correction = corrections[dataset_id]
            old_label = sample.get('is_council_district')
            new_label = correction['corrected_label']

            if old_label != new_label:
                # Apply correction
                sample['is_council_district'] = new_label

                # Add correction metadata
                if 'corrections' not in sample:
                    sample['corrections'] = []

                sample['corrections'].append({
                    'date': datetime.now().strftime('%Y-%m-%d'),
                    'from': old_label,
                    'to': new_label,
                    'reason': correction['correction_reason'],
                    'method': 'high_feature_count_forensics',
                    'confidence': correction['confidence'],
                    'feature_count': correction['feature_count']
                })

                corrected_count += 1
                correction_log.append({
                    'dataset_id': dataset_id,
                    'title': sample.get('title'),
                    'from': old_label,
                    'to': new_label,
                    'feature_count': correction['feature_count']
                })

    # Write updated dataset
    with open(dataset_path, 'w') as f:
        for sample in samples:
            f.write(json.dumps(sample) + '\n')

    print(f"✅ Applied {corrected_count} corrections to dataset")

    # Print summary
    print()
    print("=" * 100)
    print("CORRECTIONS APPLIED")
    print("=" * 100)

    for log in correction_log[:10]:  # Show first 10
        print(f"\n{log['title'][:60]}")
        print(f"  Feature count: {log['feature_count']:,}")
        print(f"  Changed: {log['from']} → {log['to']}")

    if len(correction_log) > 10:
        print(f"\n... and {len(correction_log) - 10} more")

    print()
    print(f"✅ Dataset updated: {dataset_path}")
    print(f"✅ Backup created: {backup_path}")

    return corrected_count

def main():
    """Main function."""
    corrections_path = Path(__file__).parent / "high_feature_count_corrections.jsonl"
    dataset_path = Path(__file__).parent / "../data/ml_training_data_tier1_corrected.jsonl"

    print("=" * 100)
    print("HIGH FEATURE COUNT CORRECTIONS - APPLY TO DATASET")
    print("=" * 100)
    print()

    # Check files exist
    if not corrections_path.exists():
        print(f"❌ Corrections file not found: {corrections_path}")
        return 1

    if not dataset_path.exists():
        print(f"❌ Dataset file not found: {dataset_path}")
        return 1

    # Load corrections
    corrections = load_corrections(corrections_path)
    print(f"📊 Loaded {len(corrections)} corrections")
    print()

    # Apply corrections
    corrected_count = apply_corrections(str(dataset_path), corrections)

    print()
    print("=" * 100)
    print(f"✅ SUCCESS: Applied {corrected_count} corrections")
    print("=" * 100)

    return 0

if __name__ == "__main__":
    exit(main())
