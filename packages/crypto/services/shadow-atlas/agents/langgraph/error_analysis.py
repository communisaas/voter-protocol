#!/usr/bin/env python3
"""
Error Analysis - Categorize Test Set Errors

Extract and categorize the 11 test errors to understand what architectural
improvements will have the highest impact.

This is Phase 1 of the ML accuracy improvement plan.
"""

import json
import pickle
import numpy as np
from pathlib import Path
from typing import Dict, List, Tuple
from train_ensemble import load_and_split_data, extract_features

RANDOM_SEED = 42


def load_test_errors() -> List[Dict]:
    """
    Load test set and identify errors from calibrated model.

    Returns list of error dictionaries with:
    - sample: Original sample dict
    - true_label: Ground truth
    - predicted_label: Model prediction
    - confidence: Model confidence
    - error_type: 'false_positive' or 'false_negative'
    """
    # Load data with same split as training
    train_samples, val_samples, test_samples = load_and_split_data()

    # Load calibrated model (best model from training)
    with open('../models_clean/calibrated_model.pkl', 'rb') as f:
        model = pickle.load(f)

    # Extract features for test set
    X_test, y_test = extract_features(test_samples)

    # Get predictions
    predictions = model.predict(X_test)
    probabilities = model.predict_proba(X_test)

    # Find errors
    errors = []
    correct = []

    for i, (true_label, pred_label, prob) in enumerate(zip(y_test, predictions, probabilities)):
        sample_data = {
            'sample': test_samples[i],
            'true_label': bool(true_label),
            'predicted_label': bool(pred_label),
            'confidence': float(max(prob)),
            'prob_false': float(prob[0]),
            'prob_true': float(prob[1]),
        }

        if true_label != pred_label:
            sample_data['error_type'] = 'false_positive' if pred_label == 1 else 'false_negative'
            errors.append(sample_data)
        else:
            correct.append(sample_data)

    print(f"\n{'='*70}")
    print(f"TEST SET ERROR ANALYSIS")
    print(f"{'='*70}")
    print(f"Total test samples: {len(test_samples)}")
    print(f"Correct: {len(correct)} ({100*len(correct)/len(test_samples):.2f}%)")
    print(f"Errors: {len(errors)} ({100*len(errors)/len(test_samples):.2f}%)")
    print(f"  False Positives: {sum(1 for e in errors if e['error_type'] == 'false_positive')}")
    print(f"  False Negatives: {sum(1 for e in errors if e['error_type'] == 'false_negative')}")

    return errors, correct


def display_error_for_categorization(error: Dict, index: int, total: int):
    """Display error details for manual categorization."""
    sample = error['sample']

    print(f"\n{'='*70}")
    print(f"ERROR {index}/{total} - {error['error_type'].upper()}")
    print(f"{'='*70}")
    print(f"Title: {sample['title']}")
    print(f"URL: {sample.get('url', 'N/A')}")
    print(f"Service: {sample.get('service_name', 'N/A')}")
    print(f"Feature Count: {sample.get('live_feature_count', 'N/A')}")
    print(f"Field Count: {len(sample.get('live_fields', []))}")
    print(f"\nGround Truth: {error['true_label']} (council district boundaries)")
    print(f"Predicted: {error['predicted_label']}")
    print(f"Confidence: {error['confidence']:.2%}")
    print(f"P(FALSE): {error['prob_false']:.2%}, P(TRUE): {error['prob_true']:.2%}")

    # Show available fields for context
    if sample.get('live_fields'):
        print(f"\nAvailable fields (first 10):")
        for i, field in enumerate(sample['live_fields'][:10]):
            print(f"  {i+1}. {field}")


def categorize_errors_interactive(errors: List[Dict]) -> Dict[str, List[Dict]]:
    """
    Interactively categorize errors.

    Categories:
    1. semantic_ambiguity - Title semantically unclear
    2. missing_context - Need URL/service name context
    3. hierarchical_aggregation - "Population BY District" patterns
    4. partial_boundaries - Single district extracts
    5. international_nuance - Commonwealth terminology edge cases
    6. feature_extraction_failure - Our features miss key signals
    7. edge_case_outlier - Genuinely ambiguous even to experts
    """
    categories = {
        'semantic_ambiguity': [],
        'missing_context': [],
        'hierarchical_aggregation': [],
        'partial_boundaries': [],
        'international_nuance': [],
        'feature_extraction_failure': [],
        'edge_case_outlier': []
    }

    print(f"\n{'='*70}")
    print("INTERACTIVE ERROR CATEGORIZATION")
    print(f"{'='*70}")
    print("\nAvailable categories:")
    for i, (key, desc) in enumerate([
        ('semantic_ambiguity', 'Title semantically unclear'),
        ('missing_context', 'Need URL/service name context'),
        ('hierarchical_aggregation', '"Population BY District" patterns'),
        ('partial_boundaries', 'Single district extracts'),
        ('international_nuance', 'Commonwealth terminology edge cases'),
        ('feature_extraction_failure', 'Our features miss key signals'),
        ('edge_case_outlier', 'Genuinely ambiguous even to experts'),
    ], 1):
        print(f"  {i}. {key} - {desc}")

    for i, error in enumerate(errors, 1):
        display_error_for_categorization(error, i, len(errors))

        while True:
            category_num = input(f"\nCategory (1-7, or 's' to skip): ").strip()

            if category_num.lower() == 's':
                print("Skipped.")
                break

            try:
                category_idx = int(category_num) - 1
                category_keys = list(categories.keys())

                if 0 <= category_idx < len(category_keys):
                    category = category_keys[category_idx]
                    categories[category].append(error)
                    print(f"Categorized as: {category}")
                    break
                else:
                    print("Invalid category number. Try again.")
            except ValueError:
                print("Invalid input. Enter a number 1-7 or 's' to skip.")

    return categories


def analyze_error_patterns(categories: Dict[str, List[Dict]]) -> Dict:
    """Analyze patterns in categorized errors."""
    analysis = {
        'total_errors': sum(len(v) for v in categories.values()),
        'category_counts': {k: len(v) for k, v in categories.items()},
        'false_positive_breakdown': {},
        'false_negative_breakdown': {},
        'avg_confidence_by_category': {},
        'detailed_errors': categories
    }

    # Breakdown by error type
    for category, errors in categories.items():
        if not errors:
            continue

        fps = [e for e in errors if e['error_type'] == 'false_positive']
        fns = [e for e in errors if e['error_type'] == 'false_negative']

        analysis['false_positive_breakdown'][category] = len(fps)
        analysis['false_negative_breakdown'][category] = len(fns)

        avg_conf = np.mean([e['confidence'] for e in errors])
        analysis['avg_confidence_by_category'][category] = float(avg_conf)

    return analysis


def save_error_analysis(analysis: Dict, output_path: str = 'error_analysis_report.json'):
    """Save error analysis report."""
    with open(output_path, 'w') as f:
        json.dump(analysis, f, indent=2)

    print(f"\n{'='*70}")
    print("ERROR ANALYSIS SAVED")
    print(f"{'='*70}")
    print(f"Output: {output_path}")
    print(f"\nCategory breakdown:")
    for category, count in analysis['category_counts'].items():
        if count > 0:
            fp = analysis['false_positive_breakdown'].get(category, 0)
            fn = analysis['false_negative_breakdown'].get(category, 0)
            avg_conf = analysis['avg_confidence_by_category'].get(category, 0)
            print(f"  {category}: {count} errors (FP: {fp}, FN: {fn}, avg conf: {avg_conf:.2%})")


def generate_recommendations(analysis: Dict) -> List[str]:
    """Generate architectural recommendations based on error patterns."""
    recommendations = []

    # Check semantic ambiguity
    if analysis['category_counts'].get('semantic_ambiguity', 0) > 2:
        recommendations.append(
            "HIGH PRIORITY: Semantic layer (SBERT) - "
            f"{analysis['category_counts']['semantic_ambiguity']} errors from semantic ambiguity"
        )

    # Check missing context
    if analysis['category_counts'].get('missing_context', 0) > 2:
        recommendations.append(
            "HIGH PRIORITY: Contextual layer (URL/service) - "
            f"{analysis['category_counts']['missing_context']} errors need additional context"
        )

    # Check hierarchical aggregation
    if analysis['category_counts'].get('hierarchical_aggregation', 0) > 1:
        recommendations.append(
            "MEDIUM PRIORITY: Pattern detector - "
            f"{analysis['category_counts']['hierarchical_aggregation']} errors from aggregation patterns"
        )

    # Check feature extraction
    if analysis['category_counts'].get('feature_extraction_failure', 0) > 2:
        recommendations.append(
            "MEDIUM PRIORITY: Feature engineering - "
            f"{analysis['category_counts']['feature_extraction_failure']} errors from missing features"
        )

    # Check edge cases
    if analysis['category_counts'].get('edge_case_outlier', 0) > 3:
        recommendations.append(
            "LOW PRIORITY: Active learning - "
            f"{analysis['category_counts']['edge_case_outlier']} genuinely ambiguous cases (may need expert labels)"
        )

    return recommendations


def main():
    """Run error analysis pipeline."""
    # Load errors
    errors, correct = load_test_errors()

    if not errors:
        print("\n✅ No errors! Model is perfect on test set.")
        return

    # Interactive categorization
    print("\n\nStarting interactive categorization...")
    print("This will help us understand which architectural improvements to prioritize.")

    proceed = input("\nProceed with interactive categorization? (y/n): ").strip().lower()

    if proceed != 'y':
        print("Skipping interactive categorization.")
        print("Run with 'y' to categorize errors and generate recommendations.")
        return

    categories = categorize_errors_interactive(errors)

    # Analyze patterns
    analysis = analyze_error_patterns(categories)

    # Save report
    save_error_analysis(analysis)

    # Generate recommendations
    recommendations = generate_recommendations(analysis)

    print(f"\n{'='*70}")
    print("ARCHITECTURAL RECOMMENDATIONS")
    print(f"{'='*70}")
    for i, rec in enumerate(recommendations, 1):
        print(f"{i}. {rec}")

    if not recommendations:
        print("No clear patterns identified. Consider:")
        print("  - Hyperparameter tuning")
        print("  - Active learning for edge cases")
        print("  - Ensemble with external models")

    print(f"\n{'='*70}")
    print("Next steps:")
    print("  1. Review error_analysis_report.json")
    print("  2. Implement recommended architectural improvements")
    print("  3. Measure improvement after each phase")
    print(f"{'='*70}\n")


if __name__ == "__main__":
    main()
