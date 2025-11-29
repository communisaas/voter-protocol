#!/usr/bin/env python3
"""
Extract Test Errors - Non-Interactive Export

Export all 11 test errors to JSON for manual review and categorization.
"""

import json
import pickle
from train_ensemble import load_and_split_data, extract_features


def extract_all_errors():
    """Extract and save all test errors to JSON."""
    # Load data
    train_samples, val_samples, test_samples = load_and_split_data()

    # Load model
    with open('../models_clean/calibrated_model.pkl', 'rb') as f:
        model = pickle.load(f)

    # Get predictions
    X_test, y_test = extract_features(test_samples)
    predictions = model.predict(X_test)
    probabilities = model.predict_proba(X_test)

    # Extract errors
    errors = []
    for i, (true_label, pred_label, prob) in enumerate(zip(y_test, predictions, probabilities)):
        if true_label != pred_label:
            errors.append({
                'index': i,
                'title': test_samples[i]['title'],
                'url': test_samples[i].get('url', 'N/A'),
                'service_name': test_samples[i].get('service_name', 'N/A'),
                'feature_count': test_samples[i].get('live_feature_count', 0),
                'field_count': len(test_samples[i].get('live_fields', [])),
                'fields': test_samples[i].get('live_fields', [])[:10],  # First 10 fields
                'true_label': 'COUNCIL_DISTRICT' if true_label else 'NOT_COUNCIL',
                'predicted_label': 'COUNCIL_DISTRICT' if pred_label else 'NOT_COUNCIL',
                'error_type': 'FALSE_POSITIVE' if pred_label == 1 else 'FALSE_NEGATIVE',
                'prob_false': float(prob[0]),
                'prob_true': float(prob[1]),
                'confidence': float(max(prob)),
            })

    # Save to JSON
    with open('test_errors.json', 'w') as f:
        json.dump({
            'total_test_samples': len(test_samples),
            'total_errors': len(errors),
            'false_positives': sum(1 for e in errors if e['error_type'] == 'FALSE_POSITIVE'),
            'false_negatives': sum(1 for e in errors if e['error_type'] == 'FALSE_NEGATIVE'),
            'errors': errors
        }, f, indent=2)

    print(f"\n{'='*70}")
    print("TEST ERRORS EXTRACTED")
    print(f"{'='*70}")
    print(f"Total errors: {len(errors)}")
    print(f"  False Positives: {sum(1 for e in errors if e['error_type'] == 'FALSE_POSITIVE')}")
    print(f"  False Negatives: {sum(1 for e in errors if e['error_type'] == 'FALSE_NEGATIVE')}")
    print(f"\nSaved to: test_errors.json")

    # Print errors for quick review
    print(f"\n{'='*70}")
    print("ERROR DETAILS:")
    print(f"{'='*70}")

    for i, error in enumerate(errors, 1):
        print(f"\n{i}. {error['error_type']}")
        print(f"   Title: {error['title']}")
        print(f"   True: {error['true_label']}, Predicted: {error['predicted_label']}")
        print(f"   Confidence: {error['confidence']:.2%}")


if __name__ == "__main__":
    extract_all_errors()
