#!/usr/bin/env python3
"""
Evaluate PatternDetector on real data.

Measures:
1. Overall accuracy on test set
2. Precision on confident predictions
3. Coverage (how many predictions are confident vs neutral)
4. Target error fixes (2 specific errors from error analysis)
"""

import json
import sys
import numpy as np
from sklearn.metrics import classification_report, accuracy_score, confusion_matrix
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

from train_ensemble import load_and_split_data
from pattern_detector import HierarchicalPatternDetector


def evaluate():
    detector = HierarchicalPatternDetector()

    # Load data
    _, _, test_samples = load_and_split_data()
    test_labels = np.array([s['is_council_district'] for s in test_samples])

    # Predict
    test_pred = detector.predict(test_samples)
    test_proba = detector.predict_proba(test_samples)

    # Overall metrics
    print("="*70)
    print("PATTERN DETECTOR EVALUATION")
    print("="*70)
    print("\n=== Test Set ===")
    print(classification_report(test_labels, test_pred, target_names=['Not Council', 'Council']))

    accuracy = accuracy_score(test_labels, test_pred)
    print(f"Accuracy: {accuracy:.4f} ({accuracy*100:.2f}%)")

    # Confusion matrix
    cm = confusion_matrix(test_labels, test_pred)
    print(f"\nConfusion Matrix:")
    print(f"              Predicted")
    print(f"              Not    Council")
    print(f"Actual Not    {cm[0,0]:<6} {cm[0,1]:<6}")
    print(f"       Council {cm[1,0]:<6} {cm[1,1]:<6}")

    # Analyze predictions by confidence
    print("\n=== Prediction Distribution ===")
    confident_true = np.sum(test_proba > 0.7)
    confident_false = np.sum(test_proba < 0.3)
    neutral = np.sum((test_proba >= 0.3) & (test_proba <= 0.7))

    print(f"Confident TRUE (>0.7): {confident_true} samples ({100*confident_true/len(test_labels):.1f}%)")
    print(f"Confident FALSE (<0.3): {confident_false} samples ({100*confident_false/len(test_labels):.1f}%)")
    print(f"Neutral (0.3-0.7): {neutral} samples ({100*neutral/len(test_labels):.1f}%) - defers to other models")

    # Analyze target errors
    print("\n=== Target Error Analysis ===")
    target_titles = [
        "Projected Population by District Council District",
        "Housing Tenure (by Atlanta City Council District)",
    ]

    errors_fixed = 0
    errors_checked = 0

    for i, sample in enumerate(test_samples):
        if any(target in sample['title'] for target in target_titles):
            errors_checked += 1
            true_label = test_labels[i]
            pred_label = test_pred[i]
            prob = test_proba[i]

            status = "✅ FIXED" if pred_label == true_label else "❌ STILL ERROR"
            if pred_label == true_label:
                errors_fixed += 1

            print(f"\n{status}: {sample['title']}")
            print(f"  True: {true_label}, Pred: {pred_label}, Prob: {prob:.2%}")

            # Show explanation
            explanation = detector.explain_prediction(sample)
            print(f"\n{explanation}")

    if errors_checked == 0:
        print("NOTE: Target errors not found in test set (may be in train/val)")

    # Precision on confident predictions
    print("\n=== Precision Analysis ===")
    confident_preds = (test_proba > 0.7) | (test_proba < 0.3)
    if np.sum(confident_preds) > 0:
        confident_accuracy = accuracy_score(
            test_labels[confident_preds],
            test_pred[confident_preds]
        )
        print(f"Accuracy on confident predictions: {confident_accuracy:.4f} ({confident_accuracy*100:.2f}%)")
        print(f"(Pattern detector makes {np.sum(confident_preds)}/{len(test_labels)} confident predictions)")

        # Break down by confident TRUE vs confident FALSE
        confident_true_mask = test_proba > 0.7
        confident_false_mask = test_proba < 0.3

        if np.sum(confident_true_mask) > 0:
            true_acc = accuracy_score(
                test_labels[confident_true_mask],
                test_pred[confident_true_mask]
            )
            print(f"Accuracy on confident TRUE predictions: {true_acc:.4f} ({np.sum(confident_true_mask)} samples)")

        if np.sum(confident_false_mask) > 0:
            false_acc = accuracy_score(
                test_labels[confident_false_mask],
                test_pred[confident_false_mask]
            )
            print(f"Accuracy on confident FALSE predictions: {false_acc:.4f} ({np.sum(confident_false_mask)} samples)")
    else:
        print("No confident predictions made (all neutral)")

    # Sample predictions from each confidence tier
    print("\n=== Sample Predictions ===")

    # Show 3 examples from each tier
    for tier_name, tier_mask in [
        ("Confident TRUE", test_proba > 0.7),
        ("Neutral", (test_proba >= 0.3) & (test_proba <= 0.7)),
        ("Confident FALSE", test_proba < 0.3),
    ]:
        tier_indices = np.where(tier_mask)[0]
        if len(tier_indices) > 0:
            print(f"\n{tier_name} (showing up to 3):")
            for idx in tier_indices[:3]:
                sample = test_samples[idx]
                true_label = test_labels[idx]
                pred_label = test_pred[idx]
                prob = test_proba[idx]

                status = "✅" if pred_label == true_label else "❌"
                print(f"  {status} {sample['title'][:60]}...")
                print(f"     True: {true_label}, Pred: {pred_label}, Prob: {prob:.2%}")

    # Save results
    results = {
        'test_accuracy': float(accuracy),
        'confident_predictions': int(np.sum(confident_preds)),
        'confident_true': int(confident_true),
        'confident_false': int(confident_false),
        'neutral_predictions': int(neutral),
        'target_errors_checked': int(errors_checked),
        'target_errors_fixed': int(errors_fixed),
        'confusion_matrix': {
            'true_negatives': int(cm[0,0]),
            'false_positives': int(cm[0,1]),
            'false_negatives': int(cm[1,0]),
            'true_positives': int(cm[1,1]),
        }
    }

    output_file = Path(__file__).parent / 'pattern_detector_results.json'
    with open(output_file, 'w') as f:
        json.dump(results, f, indent=2)

    print(f"\n{'='*70}")
    print(f"Results saved to: {output_file}")
    print(f"{'='*70}\n")

    # Summary
    print("=== SUMMARY ===")
    print(f"Test Accuracy: {accuracy*100:.2f}%")
    print(f"Confident Predictions: {np.sum(confident_preds)}/{len(test_labels)} ({100*np.sum(confident_preds)/len(test_labels):.1f}%)")
    if np.sum(confident_preds) > 0:
        print(f"Precision on Confident: {confident_accuracy*100:.2f}%")
    print(f"Target Errors Fixed: {errors_fixed}/{errors_checked}")

    # Expected behavior
    print("\n=== EXPECTED BEHAVIOR ===")
    print("Pattern detector is a PRECISION component:")
    print("- Should have HIGH accuracy on confident predictions (>90%)")
    print("- Should defer most predictions to other models (high neutral %)")
    print("- Should fix hierarchical aggregation errors (2 target errors)")
    print("- Better to be neutral (0.5) than wrong")


if __name__ == "__main__":
    evaluate()
