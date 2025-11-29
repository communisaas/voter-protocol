#!/usr/bin/env python3
"""
Apply TIER 1 corrections to create ml_training_data_tier1_corrected.jsonl
"""

import json
from pathlib import Path
from typing import Dict

# Load expert-reviewed validation results
validation_path = Path("forensic_analysis/tier1_expert_reviewed_results.json")
with open(validation_path) as f:
    validation_results = json.load(f)

# Create correction lookup: dataset_id -> new label
correction_lookup = {}
for result in validation_results:
    if result['correction_needed']:
        correction_lookup[result['dataset_id']] = result['manual_decision']

print(f"Loaded {len(correction_lookup)} corrections from expert review")
print(f"  Corrections: {correction_lookup}")

# Load tier0 corrected dataset
tier0_path = Path("../data/ml_training_data_tier0_corrected.jsonl")
output_path = Path("../data/ml_training_data_tier1_corrected.jsonl")

corrections_applied = 0
total_records = 0

with open(tier0_path) as infile, open(output_path, 'w') as outfile:
    for line in infile:
        if not line.strip():
            continue

        record = json.loads(line)
        total_records += 1
        dataset_id = record['dataset_id']

        # Apply correction if exists
        if dataset_id in correction_lookup:
            old_label = record['is_council_district']
            new_label = correction_lookup[dataset_id]

            print(f"\nApplying correction to {dataset_id}:")
            print(f"  Title: {record['title']}")
            print(f"  {old_label} → {new_label}")

            record['is_council_district'] = new_label
            record['confidence'] = 95  # High confidence from expert manual review

            # Update verification status
            if 'domain_expert_review' not in record:
                record['domain_expert_review'] = {}

            record['domain_expert_review']['status'] = 'expert_validated'
            record['domain_expert_review']['tier1_validation'] = True
            record['domain_expert_review']['correction_applied'] = True
            record['domain_expert_review']['original_label'] = old_label
            record['domain_expert_review']['validated_date'] = '2025-11-24T22:00:00Z'

            corrections_applied += 1

        # Write record (corrected or unchanged)
        outfile.write(json.dumps(record) + '\n')

print(f"\n{'='*80}")
print(f"TIER 1 CORRECTIONS APPLIED")
print(f"{'='*80}")
print(f"Total records processed: {total_records}")
print(f"Corrections applied: {corrections_applied}")
print(f"Output saved to: {output_path}")
print(f"{'='*80}")

# Verify corrections
print("\nVerifying corrections...")
verify_count = 0
with open(output_path) as f:
    for line in f:
        if not line.strip():
            continue
        record = json.loads(line)
        if record['dataset_id'] in correction_lookup:
            expected = correction_lookup[record['dataset_id']]
            actual = record['is_council_district']
            if expected != actual:
                print(f"ERROR: Correction not applied correctly for {record['dataset_id']}")
            else:
                verify_count += 1

print(f"Verified {verify_count}/{len(correction_lookup)} corrections successfully applied")
