#!/usr/bin/env python3
"""
Generate final validation summary with correction breakdown
"""

import json
from pathlib import Path
from collections import defaultdict

# Load expert-reviewed results
results_path = Path("forensic_analysis/tier1_expert_reviewed_results.json")
with open(results_path) as f:
    results = json.load(f)

# Group corrections by pattern
correction_patterns = defaultdict(list)

for r in results:
    if r['correction_needed']:
        pattern = r['evidence']['title_pattern']
        correction_patterns[pattern].append({
            'title': r['title'],
            'old_label': r['current_label'],
            'new_label': r['manual_decision'],
            'confidence': r['confidence']
        })

# Print summary
print("="*80)
print("TIER 1 MANUAL VALIDATION SUMMARY")
print("="*80)
print()
print(f"Total samples validated: {len(results)}")
print(f"Corrections needed: {sum(1 for r in results if r['correction_needed'])}")
print(f"  - False positives (TRUE → FALSE): {sum(1 for r in results if r['correction_type'] == 'false_positive')}")
print(f"  - False negatives (FALSE → TRUE): {sum(1 for r in results if r['correction_type'] == 'false_negative')}")
print()

print("="*80)
print("CORRECTION BREAKDOWN BY PATTERN")
print("="*80)
print()

pattern_names = {
    'by_district_data': 'Pattern 1: "BY Council District" Data',
    'planning_overlay': 'Pattern 2: Planning/Zoning Overlays',
    'infrastructure_services': 'Pattern 3: Infrastructure Data',
    'voting_precinct': 'Pattern 4: Voting Precincts',
    'county_governance': 'Pattern 5: Statewide Aggregations',
    'form_survey': 'Pattern 6: Forms/Surveys',
    'simple_council_district': 'Pattern 7: Single District Extracts',
    'demographic_data': 'Pattern 1b: Demographic Data BY District',
    'no_clear_pattern': 'Pattern 8: Broken/Empty Datasets',
    'explicit_boundaries': 'FALSE NEGATIVE: Legitimate Boundaries'
}

for pattern in sorted(correction_patterns.keys(), key=lambda p: -len(correction_patterns[p])):
    samples = correction_patterns[pattern]
    pattern_name = pattern_names.get(pattern, f'Unknown: {pattern}')

    print(f"{pattern_name}: {len(samples)} corrections")
    for i, sample in enumerate(samples[:3], 1):  # Show first 3 examples
        print(f"  {i}. {sample['title']}")
        print(f"     {sample['old_label']} → {sample['new_label']} (confidence: {sample['confidence']}%)")
    if len(samples) > 3:
        print(f"  ... and {len(samples) - 3} more")
    print()

# High-confidence TRUE samples
true_samples = [r for r in results if r['manual_decision'] == True and r['confidence'] >= 90]
print("="*80)
print(f"HIGH-CONFIDENCE TRUE SAMPLES: {len(true_samples)}")
print("="*80)
print()
for sample in true_samples:
    print(f"✓ {sample['title']}")
    print(f"  Features: {sample.get('evidence', {}).get('feature_count_range', 'unknown')}")
    print(f"  Confidence: {sample['confidence']}%")
    print()

# Uncertain cases (flagged for human review)
uncertain = [r for r in results if r['manual_decision'] == True and 50 <= r['confidence'] < 75]
if uncertain:
    print("="*80)
    print(f"UNCERTAIN CASES (FLAGGED FOR VERIFICATION): {len(uncertain)}")
    print("="*80)
    print()
    for sample in uncertain:
        print(f"⚠️  {sample['title']}")
        print(f"  Features: {sample.get('evidence', {}).get('feature_count_range', 'unknown')}")
        print(f"  Confidence: {sample['confidence']}% (needs verification)")
        print(f"  URL: {sample['url']}")
        print()

print("="*80)
print("FILES GENERATED")
print("="*80)
print()
print("1. Validation Results:")
print("   - forensic_analysis/tier1_manual_validation_results.json (automated)")
print("   - forensic_analysis/tier1_expert_reviewed_results.json (with expert overrides)")
print()
print("2. Corrections:")
print("   - forensic_analysis/tier1_corrections_final.jsonl (29 corrections)")
print("   - forensic_analysis/expert_overrides_log.json (3 expert overrides)")
print()
print("3. Corrected Dataset:")
print("   - ../data/ml_training_data_tier1_corrected.jsonl (432 records, 29 corrections applied)")
print()
print("4. Report:")
print("   - TIER1_MANUAL_VALIDATION_REPORT.md (comprehensive analysis)")
print()
print("="*80)
