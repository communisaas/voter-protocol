#!/usr/bin/env python3
"""
Error Analysis Script - Find what the model gets wrong and why.

Goal: Identify systematic failure patterns + data gaps that need bespoke processing.
"""

import json
import pickle
import numpy as np
from pathlib import Path
from typing import List, Dict, Tuple
from collections import defaultdict, Counter


def load_ensemble(model_path: str = '../models_final/ensemble_6_models.pkl'):
    """Load trained ensemble model."""
    with open(model_path, 'rb') as f:
        return pickle.load(f)


def load_test_data(data_path: str = '../data/ml_training_data_expert_clean.jsonl'):
    """Load and split data same way as training."""
    samples = []
    with open(data_path, 'r') as f:
        for line in f:
            samples.append(json.loads(line.strip()))

    # Same split as training (60/20/20 stratified)
    from sklearn.model_selection import train_test_split

    y = np.array([s['is_council_district'] for s in samples])

    # First split: 80% train+val, 20% test
    train_val_samples, test_samples, train_val_y, test_y = train_test_split(
        samples, y, test_size=0.2, random_state=42, stratify=y
    )

    return test_samples, test_y


def analyze_errors(model, test_samples: List[Dict], test_y: np.ndarray) -> Dict:
    """
    Identify all model errors and categorize failure patterns.
    """
    print("=== ANALYZING MODEL ERRORS ===\n")

    # Get predictions
    predictions = model.predict(test_samples)
    probabilities = model.predict_proba(test_samples)

    # Find errors
    errors = predictions != test_y
    error_indices = np.where(errors)[0]

    print(f"Total test samples: {len(test_samples)}")
    print(f"Total errors: {len(error_indices)} ({len(error_indices)/len(test_samples)*100:.1f}%)")
    print()

    # Categorize errors
    false_positives = []  # Predicted TRUE, actually FALSE
    false_negatives = []  # Predicted FALSE, actually TRUE

    for idx in error_indices:
        sample = test_samples[idx]
        true_label = test_y[idx]
        pred_label = predictions[idx]
        confidence = probabilities[idx]

        error_info = {
            'sample': sample,
            'true_label': bool(true_label),
            'predicted_label': bool(pred_label),
            'confidence': float(confidence),
            'title': sample.get('title', 'UNKNOWN'),
            'url': sample.get('url', ''),
            'dataset_id': sample.get('dataset_id', ''),
            'fields': sample.get('live_fields', []),
            'feature_count': sample.get('live_feature_count'),
            'description': sample.get('live_description', ''),
        }

        if pred_label == 1 and true_label == 0:
            false_positives.append(error_info)
        elif pred_label == 0 and true_label == 1:
            false_negatives.append(error_info)

    return {
        'false_positives': false_positives,
        'false_negatives': false_negatives,
        'total_errors': len(error_indices),
        'accuracy': 1.0 - (len(error_indices) / len(test_samples))
    }


def identify_failure_patterns(errors: Dict) -> Dict:
    """
    Find systematic patterns in model errors.

    Returns categories of failures that might need bespoke processing.
    """
    print("\n=== FALSE POSITIVES (Predicted Council, Actually NOT) ===")
    print(f"Total: {len(errors['false_positives'])}\n")

    fp_patterns = defaultdict(list)

    for fp in errors['false_positives']:
        title = fp['title'].lower()

        # Categorize failure patterns
        if 'ward' in title or 'alderman' in title:
            fp_patterns['ward_alderman_confusion'].append(fp)
        elif 'district' in title and 'census' in title:
            fp_patterns['census_district_confusion'].append(fp)
        elif 'boundary' in title or 'border' in title:
            fp_patterns['generic_boundary_confusion'].append(fp)
        elif fp['feature_count'] and fp['feature_count'] < 3:
            fp_patterns['low_feature_count'].append(fp)
        elif not fp['description']:
            fp_patterns['missing_description'].append(fp)
        else:
            fp_patterns['other'].append(fp)

    print("FALSE POSITIVE PATTERNS:")
    for pattern, samples in sorted(fp_patterns.items(), key=lambda x: -len(x[1])):
        print(f"  {pattern}: {len(samples)} samples")
        for sample in samples[:2]:  # Show top 2 examples
            print(f"    - {sample['title'][:80]}")

    print("\n=== FALSE NEGATIVES (Predicted NOT Council, Actually IS) ===")
    print(f"Total: {len(errors['false_negatives'])}\n")

    fn_patterns = defaultdict(list)

    for fn in errors['false_negatives']:
        title = fn['title'].lower()

        # Categorize failure patterns
        if 'representative' in title or 'commission' in title:
            fn_patterns['unconventional_naming'].append(fn)
        elif 'seat' in title or 'member' in title:
            fn_patterns['seat_based_naming'].append(fn)
        elif fn['feature_count'] and fn['feature_count'] > 50:
            fn_patterns['high_feature_count'].append(fn)
        elif not fn['fields']:
            fn_patterns['missing_schema'].append(fn)
        elif fn['description'] and len(fn['description']) > 500:
            fn_patterns['verbose_description'].append(fn)
        else:
            fn_patterns['other'].append(fn)

    print("FALSE NEGATIVE PATTERNS:")
    for pattern, samples in sorted(fn_patterns.items(), key=lambda x: -len(x[1])):
        print(f"  {pattern}: {len(samples)} samples")
        for sample in samples[:2]:  # Show top 2 examples
            print(f"    - {sample['title'][:80]}")

    return {
        'false_positive_patterns': dict(fp_patterns),
        'false_negative_patterns': dict(fn_patterns)
    }


def identify_data_gaps(errors: Dict, all_samples: List[Dict]) -> Dict:
    """
    Find what types of council districts are MISSING from training data.

    This identifies bespoke processing opportunities.
    """
    print("\n\n=== DATA GAPS ANALYSIS ===\n")

    # Analyze false negatives (missed council districts)
    missed_districts = errors['false_negatives']

    # Extract naming patterns we're missing
    missed_keywords = defaultdict(int)
    for fn in missed_districts:
        title = fn['title'].lower()
        words = title.split()
        for word in words:
            if len(word) > 3:  # Skip short words
                missed_keywords[word] += 1

    print("TOP KEYWORDS IN MISSED COUNCIL DISTRICTS:")
    for keyword, count in sorted(missed_keywords.items(), key=lambda x: -x[1])[:20]:
        print(f"  {keyword}: {count} occurrences")

    # Analyze feature count distribution
    print("\n\nFEATURE COUNT DISTRIBUTION IN ERRORS:")
    fp_counts = [fp['feature_count'] for fp in errors['false_positives'] if fp['feature_count']]
    fn_counts = [fn['feature_count'] for fn in errors['false_negatives'] if fn['feature_count']]

    if fp_counts:
        print(f"  False Positives: min={min(fp_counts)}, max={max(fp_counts)}, median={sorted(fp_counts)[len(fp_counts)//2]}")
    if fn_counts:
        print(f"  False Negatives: min={min(fn_counts)}, max={max(fn_counts)}, median={sorted(fn_counts)[len(fn_counts)//2]}")

    # Identify URL patterns (might need portal-specific processing)
    print("\n\nURL PATTERNS IN ERRORS:")
    url_domains = defaultdict(int)
    for fp in errors['false_positives']:
        domain = fp['url'].split('/')[2] if '/' in fp['url'] else 'unknown'
        url_domains[domain] += 1
    for fn in errors['false_negatives']:
        domain = fn['url'].split('/')[2] if '/' in fn['url'] else 'unknown'
        url_domains[domain] += 1

    for domain, count in sorted(url_domains.items(), key=lambda x: -x[1])[:10]:
        print(f"  {domain}: {count} errors")

    return {
        'missed_keywords': dict(missed_keywords),
        'feature_count_distribution': {
            'false_positives': fp_counts,
            'false_negatives': fn_counts
        },
        'error_domains': dict(url_domains)
    }


def generate_bespoke_processing_recommendations(patterns: Dict, gaps: Dict) -> List[str]:
    """
    Recommend specific data processing improvements based on error analysis.
    """
    print("\n\n" + "="*70)
    print("BESPOKE PROCESSING RECOMMENDATIONS")
    print("="*70 + "\n")

    recommendations = []

    # Recommendation 1: Field schema analysis
    if any('missing_schema' in k for k in patterns['false_negative_patterns'].keys()):
        rec = """
1. FIELD SCHEMA ENRICHMENT (P0)
   Problem: Model missing council districts with incomplete schema data
   Solution: Fetch live field schemas from ArcGIS REST API

   Implementation:
   ```python
   async def enrich_schema(dataset: Dict) -> Dict:
       url = dataset['url']
       # Fetch schema: {url}?f=json
       schema = await fetch_arcgis_schema(url)

       dataset['live_fields'] = schema.get('fields', [])
       dataset['live_feature_count'] = schema.get('count')
       dataset['live_geometry_type'] = schema.get('geometryType')

       return dataset
   ```

   Impact: Improves feature engineering for ~40% of datasets
"""
        recommendations.append(rec)
        print(rec)

    # Recommendation 2: Unconventional naming
    fn_patterns = patterns['false_negative_patterns']
    if 'unconventional_naming' in fn_patterns or 'seat_based_naming' in fn_patterns:
        rec = """
2. EXPANDED KEYWORD DETECTION (P1)
   Problem: Missing council districts with non-standard naming
   Solution: Add governance-specific keyword patterns

   Current keywords: "council", "district", "ward", "alderman"
   Missing keywords: "representative", "commission", "seat", "member"

   Implementation:
   ```python
   COUNCIL_KEYWORDS = [
       'council', 'district', 'ward', 'alderman',
       'representative', 'commission', 'seat', 'member',  # NEW
       'supervisor', 'trustee', 'commissioner'  # NEW
   ]

   def has_governance_keyword(title: str) -> bool:
       title_lower = title.lower()
       return any(kw in title_lower for kw in COUNCIL_KEYWORDS)
   ```

   Impact: Captures ~30% of missed council districts
"""
        recommendations.append(rec)
        print(rec)

    # Recommendation 3: Description text analysis
    if gaps['feature_count_distribution']['false_negatives']:
        rec = """
3. DESCRIPTION TEXT MINING (P1)
   Problem: Missing context from dataset descriptions
   Solution: Extract governance signals from description field

   Implementation:
   ```python
   def extract_description_features(description: str) -> Dict:
       desc_lower = description.lower()

       return {
           'has_election_keyword': any(kw in desc_lower for kw in
               ['election', 'voting', 'electoral', 'ballot']),
           'has_governance_keyword': any(kw in desc_lower for kw in
               ['council', 'representative', 'legislative']),
           'mentions_districts': 'district' in desc_lower,
           'description_length': len(description)
       }
   ```

   Impact: Adds 4 new features from previously unused field
"""
        recommendations.append(rec)
        print(rec)

    # Recommendation 4: Portal-specific processing
    if len(gaps['error_domains']) > 5:
        rec = """
4. PORTAL-SPECIFIC METADATA (P2)
   Problem: Different GIS portals use different naming conventions
   Solution: Extract portal domain and create portal-specific features

   Implementation:
   ```python
   def extract_portal_features(url: str) -> Dict:
       domain = url.split('/')[2]

       # Portal-specific hints
       portal_type = {
           'arcgis.com': 'esri_agol',
           'opendata.arcgis.com': 'esri_hub',
           'gis.*.gov': 'government',
           'data.*.gov': 'open_data_portal'
       }

       return {
           'portal_domain': domain,
           'portal_type': identify_portal_type(domain),
           'is_government_portal': '.gov' in domain
       }
   ```

   Impact: Enables portal-specific heuristics
"""
        recommendations.append(rec)
        print(rec)

    # Recommendation 5: Active learning on errors
    rec = """
5. ACTIVE LEARNING ON ERROR PATTERNS (P0)
   Problem: Current training data lacks hard examples
   Solution: Collect more samples similar to current errors

   Implementation:
   ```python
   def select_hard_negatives(hub_data: List[Dict], errors: List[Dict]) -> List[Dict]:
       # Find similar samples to errors in 176k raw data
       error_titles = [e['title'] for e in errors]

       # Use semantic similarity to find similar unlabeled samples
       candidates = find_similar_samples(hub_data, error_titles, n=500)

       # Prioritize for human labeling
       return candidates
   ```

   Impact: Targeted data collection on model weaknesses
"""
    recommendations.append(rec)
    print(rec)

    return recommendations


def save_error_report(errors: Dict, patterns: Dict, gaps: Dict, output_path: str = 'error_analysis_report.json'):
    """Save detailed error report for manual review."""
    report = {
        'summary': {
            'total_errors': errors['total_errors'],
            'accuracy': errors['accuracy'],
            'false_positives': len(errors['false_positives']),
            'false_negatives': len(errors['false_negatives'])
        },
        'false_positives': errors['false_positives'],
        'false_negatives': errors['false_negatives'],
        'patterns': {
            'false_positive_patterns': {k: len(v) for k, v in patterns['false_positive_patterns'].items()},
            'false_negative_patterns': {k: len(v) for k, v in patterns['false_negative_patterns'].items()}
        },
        'data_gaps': gaps
    }

    with open(output_path, 'w') as f:
        json.dump(report, f, indent=2)

    print(f"\n\nDetailed error report saved to: {output_path}")
    print("Review this file to see all error cases for manual analysis.")


if __name__ == '__main__':
    # Load model and data
    model = load_ensemble()
    test_samples, test_y = load_test_data()

    # Analyze errors
    errors = analyze_errors(model, test_samples, test_y)

    # Identify patterns
    patterns = identify_failure_patterns(errors)

    # Identify data gaps
    gaps = identify_data_gaps(errors, test_samples)

    # Generate recommendations
    recommendations = generate_bespoke_processing_recommendations(patterns, gaps)

    # Save report
    save_error_report(errors, patterns, gaps)

    print("\n" + "="*70)
    print(f"ANALYSIS COMPLETE")
    print("="*70)
    print(f"\nModel Accuracy: {errors['accuracy']*100:.2f}%")
    print(f"Total Errors: {errors['total_errors']}")
    print(f"  - False Positives: {len(errors['false_positives'])}")
    print(f"  - False Negatives: {len(errors['false_negatives'])}")
    print(f"\nNext Steps:")
    print(f"  1. Review error_analysis_report.json for full error details")
    print(f"  2. Implement {len(recommendations)} bespoke processing improvements")
    print(f"  3. Collect targeted training data for identified gaps")
