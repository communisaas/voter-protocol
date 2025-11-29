#!/usr/bin/env python3
"""
Evaluate ContextualClassifier Standalone Performance

This measures the improvement from adding URL/service context to title features.

Expected improvement: +4-5% accuracy over baseline (87.36%)
Target errors:
- "boundaries" (generic, needs URL)
- "VacantLand" (no keywords, needs URL)
- "Projects_2021" (generic, needs URL)
- "Geographic boundaries (StatsNZ)" (needs URL context)
"""

import json
import numpy as np
from sklearn.metrics import (
    classification_report, accuracy_score, roc_auc_score,
    confusion_matrix, precision_recall_fscore_support
)
from train_ensemble import load_and_split_data
from contextual_classifier import ContextualClassifier


def load_test_errors(filepath: str = 'test_errors.json') -> dict:
    """Load test errors to analyze which were fixed."""
    with open(filepath, 'r') as f:
        return json.load(f)


def analyze_error_fixes(test_samples, y_test, test_pred, test_proba, test_errors):
    """
    Analyze which test errors were fixed by contextual classifier.

    Args:
        test_samples: Test samples
        y_test: True labels
        test_pred: Predictions
        test_proba: Prediction probabilities
        test_errors: Dict with test error details from baseline model

    Returns:
        Dict with analysis
    """
    baseline_errors = test_errors['errors']

    # Map test samples to baseline error indices
    fixed_errors = []
    remaining_errors = []

    for i, (sample, true_label, pred_label, prob) in enumerate(zip(test_samples, y_test, test_pred, test_proba)):
        # Check if this was a baseline error
        baseline_error = None
        for err in baseline_errors:
            if err['title'] == sample['title'] and err['url'] == sample.get('url', ''):
                baseline_error = err
                break

        if baseline_error:
            # Was this error fixed?
            if true_label == pred_label:
                fixed_errors.append({
                    'title': sample['title'],
                    'url': sample.get('url', ''),
                    'baseline_error_type': baseline_error['error_type'],
                    'baseline_confidence': baseline_error['confidence'],
                    'new_confidence': prob if pred_label == 1 else (1 - prob),
                    'status': 'FIXED'
                })
            else:
                remaining_errors.append({
                    'title': sample['title'],
                    'url': sample.get('url', ''),
                    'baseline_error_type': baseline_error['error_type'],
                    'baseline_confidence': baseline_error['confidence'],
                    'new_confidence': prob if pred_label == 1 else (1 - prob),
                    'status': 'STILL_ERROR'
                })

    return {
        'total_baseline_errors': len(baseline_errors),
        'errors_fixed': len(fixed_errors),
        'errors_remaining': len(remaining_errors),
        'fix_rate': len(fixed_errors) / len(baseline_errors) if baseline_errors else 0,
        'fixed_details': fixed_errors,
        'remaining_details': remaining_errors
    }


def evaluate():
    """Main evaluation function."""
    print("=" * 70)
    print("CONTEXTUAL CLASSIFIER EVALUATION")
    print("=" * 70)

    # Load data (same splits as train_ensemble.py)
    print("\nLoading data...")
    train_samples, val_samples, test_samples = load_and_split_data()

    train_labels = np.array([s['is_council_district'] for s in train_samples])
    val_labels = np.array([s['is_council_district'] for s in val_samples])
    test_labels = np.array([s['is_council_district'] for s in test_samples])

    print(f"  Train: {len(train_samples)} samples")
    print(f"  Val:   {len(val_samples)} samples")
    print(f"  Test:  {len(test_samples)} samples")

    # Train classifier
    print("\n" + "=" * 70)
    print("Training ContextualClassifier...")
    print("=" * 70)
    classifier = ContextualClassifier()
    classifier.fit(train_samples, train_labels)
    print("Training complete!")

    # Evaluate on validation set
    print("\n" + "=" * 70)
    print("VALIDATION SET EVALUATION")
    print("=" * 70)

    val_proba = classifier.predict_proba(val_samples)
    val_pred = classifier.predict(val_samples)

    print("\nClassification Report:")
    print(classification_report(val_labels, val_pred, target_names=['Not Council', 'Council']))

    val_accuracy = accuracy_score(val_labels, val_pred)
    val_roc_auc = roc_auc_score(val_labels, val_proba)
    val_precision, val_recall, val_f1, _ = precision_recall_fscore_support(
        val_labels, val_pred, average='weighted'
    )

    print(f"\nMetrics:")
    print(f"  Accuracy:  {val_accuracy:.4f} ({val_accuracy*100:.2f}%)")
    print(f"  Precision: {val_precision:.4f}")
    print(f"  Recall:    {val_recall:.4f}")
    print(f"  F1 Score:  {val_f1:.4f}")
    print(f"  ROC AUC:   {val_roc_auc:.4f}")

    # Confusion matrix
    cm = confusion_matrix(val_labels, val_pred)
    print(f"\nConfusion Matrix:")
    print(f"              Predicted")
    print(f"              Not    Council")
    print(f"Actual Not    {cm[0,0]:<6} {cm[0,1]:<6}")
    print(f"       Council {cm[1,0]:<6} {cm[1,1]:<6}")

    # Evaluate on test set
    print("\n" + "=" * 70)
    print("TEST SET EVALUATION (NEVER SEEN BEFORE)")
    print("=" * 70)

    test_proba = classifier.predict_proba(test_samples)
    test_pred = classifier.predict(test_samples)

    print("\nClassification Report:")
    print(classification_report(test_labels, test_pred, target_names=['Not Council', 'Council']))

    test_accuracy = accuracy_score(test_labels, test_pred)
    test_roc_auc = roc_auc_score(test_labels, test_proba)
    test_precision, test_recall, test_f1, _ = precision_recall_fscore_support(
        test_labels, test_pred, average='weighted'
    )

    print(f"\nMetrics:")
    print(f"  Accuracy:  {test_accuracy:.4f} ({test_accuracy*100:.2f}%)")
    print(f"  Precision: {test_precision:.4f}")
    print(f"  Recall:    {test_recall:.4f}")
    print(f"  F1 Score:  {test_f1:.4f}")
    print(f"  ROC AUC:   {test_roc_auc:.4f}")

    # Confusion matrix
    cm = confusion_matrix(test_labels, test_pred)
    print(f"\nConfusion Matrix:")
    print(f"              Predicted")
    print(f"              Not    Council")
    print(f"Actual Not    {cm[0,0]:<6} {cm[0,1]:<6}")
    print(f"       Council {cm[1,0]:<6} {cm[1,1]:<6}")

    # Compare to baseline
    baseline_accuracy = 0.8736
    improvement = test_accuracy - baseline_accuracy

    print("\n" + "=" * 70)
    print("IMPROVEMENT ANALYSIS")
    print("=" * 70)
    print(f"\nBaseline accuracy (train_ensemble.py): {baseline_accuracy*100:.2f}%")
    print(f"Contextual accuracy:                    {test_accuracy*100:.2f}%")
    print(f"Improvement:                            {improvement:+.4f} ({improvement*100:+.2f}%)")

    if improvement >= 0.04:
        print(f"\n✅ SUCCESS! Achieved +{improvement*100:.1f}% improvement (target: +4-5%)")
    elif improvement >= 0.03:
        print(f"\n✅ GOOD! Achieved +{improvement*100:.1f}% improvement (close to target)")
    else:
        print(f"\n⚠️  Below target: +{improvement*100:.1f}% improvement (target: +4-5%)")

    # Load baseline test errors and analyze fixes
    print("\n" + "=" * 70)
    print("ERROR FIX ANALYSIS")
    print("=" * 70)

    try:
        test_errors = load_test_errors()
        error_analysis = analyze_error_fixes(
            test_samples, test_labels, test_pred, test_proba, test_errors
        )

        print(f"\nBaseline errors: {error_analysis['total_baseline_errors']}")
        print(f"Errors fixed:    {error_analysis['errors_fixed']} ({error_analysis['fix_rate']*100:.1f}%)")
        print(f"Errors remaining: {error_analysis['errors_remaining']}")

        if error_analysis['fixed_details']:
            print("\n✅ FIXED ERRORS:")
            for err in error_analysis['fixed_details']:
                print(f"  - '{err['title']}'")
                print(f"    Type: {err['baseline_error_type']}")
                print(f"    Baseline confidence: {err['baseline_confidence']:.2%}")
                print(f"    New confidence:      {err['new_confidence']:.2%}")
                print()

        if error_analysis['remaining_details']:
            print("\n❌ REMAINING ERRORS:")
            for err in error_analysis['remaining_details']:
                print(f"  - '{err['title']}'")
                print(f"    Type: {err['baseline_error_type']}")
                print(f"    URL: {err['url'][:80]}...")
                print()

    except FileNotFoundError:
        print("\nWarning: test_errors.json not found. Skipping error fix analysis.")
        error_analysis = None

    # Feature importance
    print("\n" + "=" * 70)
    print("FEATURE IMPORTANCE (Top 20)")
    print("=" * 70)

    feature_importance = classifier.get_feature_importance(top_n=20)

    print("\nTop features for distinguishing council districts:")
    for i, (feature_name, importance) in enumerate(feature_importance, 1):
        print(f"{i:2d}. {feature_name:<35} {importance:.4f}")

    # Save results
    results = {
        'validation': {
            'accuracy': float(val_accuracy),
            'precision': float(val_precision),
            'recall': float(val_recall),
            'f1': float(val_f1),
            'roc_auc': float(val_roc_auc),
        },
        'test': {
            'accuracy': float(test_accuracy),
            'precision': float(test_precision),
            'recall': float(test_recall),
            'f1': float(test_f1),
            'roc_auc': float(test_roc_auc),
        },
        'comparison': {
            'baseline_accuracy': baseline_accuracy,
            'contextual_accuracy': float(test_accuracy),
            'improvement': float(improvement),
            'improvement_pct': float(improvement * 100),
        },
        'feature_importance': [
            {'feature': name, 'importance': float(imp)}
            for name, imp in feature_importance
        ]
    }

    if error_analysis:
        results['error_analysis'] = {
            'baseline_errors': error_analysis['total_baseline_errors'],
            'errors_fixed': error_analysis['errors_fixed'],
            'errors_remaining': error_analysis['errors_remaining'],
            'fix_rate': error_analysis['fix_rate'],
            'fixed_details': error_analysis['fixed_details'],
            'remaining_details': error_analysis['remaining_details']
        }

    with open('contextual_classifier_results.json', 'w') as f:
        json.dump(results, f, indent=2)

    print("\n" + "=" * 70)
    print("EVALUATION COMPLETE")
    print("=" * 70)
    print("\nResults saved to: contextual_classifier_results.json")
    print("\nNext steps:")
    print("1. Review CONTEXTUAL_CLASSIFIER_RESULTS.md for detailed analysis")
    print("2. If improvement >= +4%, integrate into ensemble (train_ensemble.py)")
    print("3. If improvement < +4%, analyze remaining errors and iterate")

    return results


if __name__ == "__main__":
    results = evaluate()
