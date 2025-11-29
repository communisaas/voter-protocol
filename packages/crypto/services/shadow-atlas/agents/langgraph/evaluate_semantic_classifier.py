#!/usr/bin/env python3
"""
Evaluate SemanticClassifier standalone and vs baseline.

This script:
1. Loads the same data splits as train_ensemble.py
2. Trains the semantic classifier
3. Evaluates on validation and test sets
4. Compares to baseline ensemble (87.36% test accuracy)
5. Analyzes which target errors are fixed
"""

import json
import numpy as np
from sklearn.metrics import classification_report, accuracy_score, roc_auc_score, confusion_matrix
from train_ensemble import load_and_split_data
from semantic_classifier import SemanticClassifier


def analyze_target_errors(test_samples, test_labels, test_pred, test_proba):
    """
    Analyze target errors from ERROR_ANALYSIS_RESULTS.md.

    Target errors needing semantic understanding:
    1. "carte_electoral_2017_WFL1" (French, non-English)
    2. "King County Find My Districts Layer (2024)" (descriptive phrasing)
    3. "1992 Metropolitan King County Council Districts" (historical + noise)
    """
    target_patterns = [
        "carte_electoral",
        "Find My Districts",
        "1992 Metropolitan King County Council Districts"
    ]

    print("\n" + "="*70)
    print("TARGET ERROR ANALYSIS")
    print("="*70)
    print("\nTarget errors from baseline (need semantic understanding):")

    fixes = []
    still_errors = []

    for i, sample in enumerate(test_samples):
        title = sample['title']
        true_label = test_labels[i]
        pred_label = test_pred[i]
        prob = test_proba[i]

        # Check if this is one of our target errors
        is_target = any(pattern in title for pattern in target_patterns)

        if is_target:
            correct = (pred_label == true_label)
            status = "✅ FIXED" if correct else "❌ STILL ERROR"

            result = {
                'title': title,
                'true': bool(true_label),
                'predicted': bool(pred_label),
                'probability': float(prob),
                'correct': bool(correct)
            }

            if correct:
                fixes.append(result)
            else:
                still_errors.append(result)

            print(f"\n{status}: {title}")
            print(f"  True: {true_label}, Pred: {pred_label}, Prob: {prob:.2%}")

    return fixes, still_errors


def evaluate():
    """Main evaluation function."""
    # Load data (same splits as train_ensemble.py)
    train_samples, val_samples, test_samples = load_and_split_data()
    train_labels = np.array([s['is_council_district'] for s in train_samples])
    val_labels = np.array([s['is_council_district'] for s in val_samples])
    test_labels = np.array([s['is_council_district'] for s in test_samples])

    # Train classifier
    print("\n" + "="*70)
    print("SEMANTIC CLASSIFIER EVALUATION")
    print("="*70)

    classifier = SemanticClassifier()
    classifier.fit(train_samples, train_labels)

    # Validation set
    print("\n" + "="*70)
    print("VALIDATION SET PERFORMANCE")
    print("="*70)

    val_proba = classifier.predict_proba(val_samples)
    val_pred = classifier.predict(val_samples)

    print("\nClassification Report:")
    print(classification_report(val_labels, val_pred, target_names=['Not Council', 'Council']))

    val_cm = confusion_matrix(val_labels, val_pred)
    print(f"\nConfusion Matrix:")
    print(f"              Predicted")
    print(f"              Not    Council")
    print(f"Actual Not    {val_cm[0,0]:<6} {val_cm[0,1]:<6}")
    print(f"       Council {val_cm[1,0]:<6} {val_cm[1,1]:<6}")

    val_acc = accuracy_score(val_labels, val_pred)
    val_auc = roc_auc_score(val_labels, val_proba)
    print(f"\nMetrics:")
    print(f"  Accuracy: {val_acc:.4f} ({val_acc*100:.2f}%)")
    print(f"  ROC AUC:  {val_auc:.4f}")

    # Test set
    print("\n" + "="*70)
    print("TEST SET PERFORMANCE")
    print("="*70)

    test_proba = classifier.predict_proba(test_samples)
    test_pred = classifier.predict(test_samples)

    print("\nClassification Report:")
    print(classification_report(test_labels, test_pred, target_names=['Not Council', 'Council']))

    test_cm = confusion_matrix(test_labels, test_pred)
    print(f"\nConfusion Matrix:")
    print(f"              Predicted")
    print(f"              Not    Council")
    print(f"Actual Not    {test_cm[0,0]:<6} {test_cm[0,1]:<6}")
    print(f"       Council {test_cm[1,0]:<6} {test_cm[1,1]:<6}")

    test_acc = accuracy_score(test_labels, test_pred)
    test_auc = roc_auc_score(test_labels, test_proba)
    print(f"\nMetrics:")
    print(f"  Accuracy: {test_acc:.4f} ({test_acc*100:.2f}%)")
    print(f"  ROC AUC:  {test_auc:.4f}")

    # Compare to baseline
    baseline = 0.8736
    improvement = test_acc - baseline

    print("\n" + "="*70)
    print("COMPARISON TO BASELINE")
    print("="*70)
    print(f"  Baseline ensemble accuracy:  {baseline:.4f} ({baseline*100:.2f}%)")
    print(f"  Semantic standalone accuracy: {test_acc:.4f} ({test_acc*100:.2f}%)")
    print(f"  Difference: {improvement:+.4f} ({improvement*100:+.2f}%)")

    if test_acc >= baseline:
        print(f"\n✅ Semantic classifier beats baseline standalone!")
    else:
        print(f"\nℹ️  Semantic classifier lower standalone (expected)")
        print(f"   Value comes from ensemble integration (complementary errors)")

    # Analyze target errors
    fixes, still_errors = analyze_target_errors(test_samples, test_labels, test_pred, test_proba)

    # Save results
    results = {
        'validation': {
            'accuracy': float(val_acc),
            'roc_auc': float(val_auc),
            'confusion_matrix': val_cm.tolist()
        },
        'test': {
            'accuracy': float(test_acc),
            'roc_auc': float(test_auc),
            'confusion_matrix': test_cm.tolist()
        },
        'baseline_comparison': {
            'baseline_accuracy': baseline,
            'semantic_accuracy': float(test_acc),
            'improvement': float(improvement)
        },
        'target_errors': {
            'fixed': fixes,
            'still_errors': still_errors,
            'fix_rate': len(fixes) / (len(fixes) + len(still_errors)) if (len(fixes) + len(still_errors)) > 0 else 0.0
        }
    }

    with open('semantic_classifier_results.json', 'w') as f:
        json.dump(results, f, indent=2)

    print(f"\n✅ Results saved to: semantic_classifier_results.json")

    # Summary
    print("\n" + "="*70)
    print("SUMMARY")
    print("="*70)
    print(f"  Validation accuracy: {val_acc*100:.2f}%")
    print(f"  Test accuracy:       {test_acc*100:.2f}%")
    print(f"  Baseline ensemble:   {baseline*100:.2f}%")
    print(f"  Standalone gap:      {improvement*100:+.2f}%")

    total_target = len(fixes) + len(still_errors)
    if total_target > 0:
        fix_rate = len(fixes) / total_target
        print(f"\n  Target errors found: {total_target}")
        print(f"  Target errors fixed: {len(fixes)}/{total_target} ({fix_rate*100:.0f}%)")
        print(f"  Remaining errors:    {len(still_errors)}/{total_target}")

    print("\n" + "="*70)
    print("\nNext step: Integrate into ensemble (Phase 2D) for expected +3-4% boost")


if __name__ == "__main__":
    evaluate()
