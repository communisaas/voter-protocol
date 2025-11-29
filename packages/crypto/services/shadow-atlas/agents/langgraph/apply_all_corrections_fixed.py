#!/usr/bin/env python3
"""
Apply all pattern-based corrections to the tier1_corrected dataset.
Handles multiple field name variations across correction files.
"""

import json
from pathlib import Path
from collections import defaultdict

# Configuration
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR.parent / "data"
INPUT_FILE = DATA_DIR / "ml_training_data_tier1_corrected.jsonl"
OUTPUT_FILE = DATA_DIR / "ml_training_data_final_clean.jsonl"

CORRECTION_FILES = [
    BASE_DIR / "high_feature_count_corrections.jsonl",
    BASE_DIR / "by_pattern_corrections.jsonl",
    BASE_DIR / "low_feature_count_corrections.jsonl",
    BASE_DIR / "conflicting_signals_corrections.jsonl",
    BASE_DIR / "census_keywords_corrections.jsonl",
]

def load_corrections():
    """Load all correction files and standardize field names."""
    corrections = {}
    correction_sources = defaultdict(list)

    for correction_file in CORRECTION_FILES:
        if not correction_file.exists():
            print(f"Warning: {correction_file.name} not found, skipping...")
            continue

        source_name = correction_file.stem.replace('_corrections', '')
        print(f"\nLoading {correction_file.name}...")

        with open(correction_file, 'r') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue

                correction = json.loads(line)
                dataset_id = correction.get('dataset_id')

                if not dataset_id:
                    print(f"  Warning: Correction missing dataset_id: {correction}")
                    continue

                # Extract the corrected label (try all possible field names)
                new_label = correction.get('corrected_label')
                if new_label is None:
                    new_label = correction.get('recommended_label')
                if new_label is None:
                    new_label = correction.get('final_label')

                if new_label is None:
                    print(f"  Warning: No label field found for {dataset_id}")
                    continue

                current_label = correction.get('current_label')

                # Convert to boolean if needed (JSON uses true/false, Python uses True/False)
                if isinstance(new_label, bool):
                    pass  # Already boolean
                elif isinstance(new_label, str):
                    new_label = new_label.lower() == 'true'

                if isinstance(current_label, bool):
                    pass
                elif isinstance(current_label, str):
                    current_label = current_label.lower() == 'true'

                # Only include corrections that actually change the label
                if current_label is not None and current_label != new_label:
                    # Store the correction
                    if dataset_id in corrections:
                        correction_sources[dataset_id].append(source_name)
                    else:
                        corrections[dataset_id] = {
                            'new_label': new_label,
                            'current_label': current_label,
                            'confidence': correction.get('confidence', 80),
                            'reasoning': correction.get('reasoning') or correction.get('correction_reason', ''),
                            'validation_method': correction.get('validation_method') or correction.get('correction_type', source_name),
                            'sources': [source_name]
                        }
                        correction_sources[dataset_id] = [source_name]

    # Add multi-source info to corrections
    for dataset_id, sources in correction_sources.items():
        if len(sources) > 1:
            corrections[dataset_id]['sources'] = sources
            corrections[dataset_id]['multi_agent_consensus'] = True
            print(f"\n✓ Multi-agent consensus for {dataset_id}: {sources}")

    return corrections

def apply_corrections(corrections):
    """Apply corrections to the dataset."""
    # Load original dataset
    with open(INPUT_FILE, 'r') as f:
        samples = [json.loads(line) for line in f if line.strip()]

    print(f"\nLoaded {len(samples)} samples from {INPUT_FILE.name}")
    print(f"Found {len(corrections)} corrections to apply")

    # Track statistics
    stats = {
        'total_samples': len(samples),
        'corrections_applied': 0,
        'true_to_false': 0,
        'false_to_true': 0,
        'multi_agent': 0,
        'not_found': 0
    }

    # Create lookup by dataset_id
    samples_by_id = {s['dataset_id']: s for s in samples}

    # Apply corrections
    for dataset_id, correction in corrections.items():
        if dataset_id not in samples_by_id:
            print(f"Warning: dataset_id {dataset_id} not found in dataset")
            stats['not_found'] += 1
            continue

        sample = samples_by_id[dataset_id]
        old_label = sample['is_council_district']
        new_label = correction['new_label']

        # Verify current label matches expectation
        if old_label != correction['current_label']:
            print(f"Warning: Label mismatch for {dataset_id}")
            print(f"  Expected current: {correction['current_label']}")
            print(f"  Actual current: {old_label}")
            print(f"  Will still apply correction to: {new_label}")

        # Apply correction
        sample['is_council_district'] = new_label

        # Add correction metadata
        if 'correction_metadata' not in sample:
            sample['correction_metadata'] = {}

        sample['correction_metadata']['pattern_validation'] = {
            'corrected': True,
            'old_label': old_label,
            'new_label': new_label,
            'confidence': correction['confidence'],
            'reasoning': correction['reasoning'],
            'validation_method': correction['validation_method'],
            'sources': correction['sources'],
            'multi_agent_consensus': correction.get('multi_agent_consensus', False)
        }

        # Track stats
        stats['corrections_applied'] += 1
        if old_label and not new_label:
            stats['true_to_false'] += 1
        elif not old_label and new_label:
            stats['false_to_true'] += 1

        if correction.get('multi_agent_consensus'):
            stats['multi_agent'] += 1

    # Save corrected dataset
    with open(OUTPUT_FILE, 'w') as f:
        for sample in samples:
            f.write(json.dumps(sample) + '\n')

    return stats

def main():
    print("=" * 80)
    print("APPLYING ALL PATTERN-BASED CORRECTIONS")
    print("=" * 80)

    # Load all corrections
    corrections = load_corrections()

    print(f"\n{'='*80}")
    print(f"CORRECTION SUMMARY")
    print(f"{'='*80}")
    print(f"Total unique corrections: {len(corrections)}")

    # Apply corrections
    stats = apply_corrections(corrections)

    # Print final statistics
    print(f"\n{'='*80}")
    print(f"FINAL STATISTICS")
    print(f"{'='*80}")
    print(f"Total samples: {stats['total_samples']}")
    print(f"Corrections applied: {stats['corrections_applied']}/{len(corrections)} ({100*stats['corrections_applied']/len(corrections):.1f}%)")
    print(f"  TRUE → FALSE: {stats['true_to_false']}")
    print(f"  FALSE → TRUE: {stats['false_to_true']}")
    print(f"  Net change: {stats['false_to_true'] - stats['true_to_false']:+d}")
    print(f"Multi-agent consensus: {stats['multi_agent']}")
    print(f"Not found in dataset: {stats['not_found']}")

    # Calculate final label distribution
    with open(OUTPUT_FILE, 'r') as f:
        final_samples = [json.loads(line) for line in f if line.strip()]

    true_count = sum(1 for s in final_samples if s['is_council_district'])
    false_count = len(final_samples) - true_count

    print(f"\nFinal label distribution:")
    print(f"  TRUE:  {true_count}/{len(final_samples)} ({100*true_count/len(final_samples):.1f}%)")
    print(f"  FALSE: {false_count}/{len(final_samples)} ({100*false_count/len(final_samples):.1f}%)")

    print(f"\n✓ Saved to: {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
