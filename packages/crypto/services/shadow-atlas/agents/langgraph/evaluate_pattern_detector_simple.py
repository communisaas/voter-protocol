#!/usr/bin/env python3
"""
Simple Pattern Detector Evaluation (No Dependencies on Training Pipeline)

Loads data directly and evaluates pattern detector.
"""

import json
import numpy as np
from pathlib import Path
from pattern_detector import HierarchicalPatternDetector


def load_data(filepath='../data/ml_training_data_expert_clean.jsonl'):
    """Load training data directly."""
    samples = []
    with open(filepath) as f:
        for line in f:
            if line.strip():
                samples.append(json.loads(line))
    return samples


def simple_split(samples, test_size=0.2, random_seed=42):
    """Simple stratified split."""
    np.random.seed(random_seed)

    # Separate TRUE and FALSE samples
    true_samples = [s for s in samples if s['is_council_district']]
    false_samples = [s for s in samples if not s['is_council_district']]

    # Shuffle
    np.random.shuffle(true_samples)
    np.random.shuffle(false_samples)

    # Split each class
    true_test_size = int(len(true_samples) * test_size)
    false_test_size = int(len(false_samples) * test_size)

    test_samples = true_samples[:true_test_size] + false_samples[:false_test_size]
    np.random.shuffle(test_samples)

    return test_samples


def evaluate():
    detector = HierarchicalPatternDetector()

    # Load data and create test set
    all_samples = load_data()
    print(f"Loaded {len(all_samples)} total samples")

    test_samples = simple_split(all_samples, test_size=0.2)
    print(f"Test set: {len(test_samples)} samples")

    test_labels = np.array([s['is_council_district'] for s in test_samples])
    print(f"  TRUE: {np.sum(test_labels)}/{len(test_labels)} ({100*np.sum(test_labels)/len(test_labels):.1f}%)")

    # Predict
    test_pred = detector.predict(test_samples)
    test_proba = detector.predict_proba(test_samples)

    # Calculate metrics manually
    correct = np.sum(test_pred == test_labels)
    accuracy = correct / len(test_labels)

    # Confusion matrix
    tp = np.sum((test_pred == 1) & (test_labels == 1))
    tn = np.sum((test_pred == 0) & (test_labels == 0))
    fp = np.sum((test_pred == 1) & (test_labels == 0))
    fn = np.sum((test_pred == 0) & (test_labels == 1))

    print("\n" + "="*70)
    print("PATTERN DETECTOR EVALUATION")
    print("="*70)
    print(f"\nTest Accuracy: {accuracy:.4f} ({accuracy*100:.2f}%)")
    print(f"Correct: {correct}/{len(test_labels)}")

    print(f"\nConfusion Matrix:")
    print(f"              Predicted")
    print(f"              Not    Council")
    print(f"Actual Not    {tn:<6} {fp:<6}")
    print(f"       Council {fn:<6} {tp:<6}")

    # Precision/Recall
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0

    print(f"\nMetrics:")
    print(f"  Precision: {precision:.4f}")
    print(f"  Recall:    {recall:.4f}")
    print(f"  F1 Score:  {f1:.4f}")

    # Analyze predictions by confidence
    print("\n=== Prediction Distribution ===")
    confident_true = np.sum(test_proba > 0.7)
    confident_false = np.sum(test_proba < 0.3)
    neutral = np.sum((test_proba >= 0.3) & (test_proba <= 0.7))

    print(f"Confident TRUE (>0.7): {confident_true} samples ({100*confident_true/len(test_labels):.1f}%)")
    print(f"Confident FALSE (<0.3): {confident_false} samples ({100*confident_false/len(test_labels):.1f}%)")
    print(f"Neutral (0.3-0.7): {neutral} samples ({100*neutral/len(test_labels):.1f}%) - defers to other models")

    # Precision on confident predictions
    print("\n=== Precision Analysis ===")
    confident_preds = (test_proba > 0.7) | (test_proba < 0.3)
    if np.sum(confident_preds) > 0:
        confident_correct = np.sum(test_pred[confident_preds] == test_labels[confident_preds])
        confident_accuracy = confident_correct / np.sum(confident_preds)
        print(f"Accuracy on confident predictions: {confident_accuracy:.4f} ({confident_accuracy*100:.2f}%)")
        print(f"(Pattern detector makes {np.sum(confident_preds)}/{len(test_labels)} confident predictions)")
    else:
        print("No confident predictions made (all neutral)")

    # Analyze target errors
    print("\n=== Target Error Analysis ===")
    target_titles = [
        "Projected Population by District Council District",
        "Housing Tenure (by Atlanta City Council District)",
    ]

    errors_found = 0
    errors_fixed = 0

    for i, sample in enumerate(test_samples):
        if any(target in sample['title'] for target in target_titles):
            errors_found += 1
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
            print(f"\nExplanation:\n{explanation}")

    if errors_found == 0:
        print("NOTE: Target errors not found in test set (may be in train set)")

    # Show sample predictions
    print("\n=== Sample Predictions ===")
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
        'test_samples': len(test_samples),
        'correct': int(correct),
        'confident_predictions': int(np.sum(confident_preds)),
        'confident_true': int(confident_true),
        'confident_false': int(confident_false),
        'neutral_predictions': int(neutral),
        'target_errors_found': int(errors_found),
        'target_errors_fixed': int(errors_fixed),
        'confusion_matrix': {
            'true_negatives': int(tn),
            'false_positives': int(fp),
            'false_negatives': int(fn),
            'true_positives': int(tp),
        },
        'metrics': {
            'precision': float(precision),
            'recall': float(recall),
            'f1': float(f1),
        }
    }

    output_file = Path(__file__).parent / 'pattern_detector_results.json'
    with open(output_file, 'w') as f:
        json.dump(results, f, indent=2)

    print(f"\n{'='*70}")
    print(f"Results saved to: {output_file}")
    print(f"{'='*70}")

    # Summary
    print("\n=== SUMMARY ===")
    print(f"Test Accuracy: {accuracy*100:.2f}%")
    print(f"Confident Predictions: {np.sum(confident_preds)}/{len(test_labels)} ({100*np.sum(confident_preds)/len(test_labels):.1f}%)")
    if np.sum(confident_preds) > 0:
        print(f"Precision on Confident: {confident_accuracy*100:.2f}%")
    print(f"Target Errors Found: {errors_found}")
    print(f"Target Errors Fixed: {errors_fixed}/{errors_found}")

    print("\n=== EXPECTED BEHAVIOR ===")
    print("Pattern detector is a PRECISION component:")
    print("- Should have HIGH accuracy on confident predictions (>90%)")
    print("- Should defer most predictions to other models (high neutral %)")
    print("- Should fix hierarchical aggregation errors (2 target errors)")
    print("- Better to be neutral (0.5) than wrong")


if __name__ == "__main__":
    evaluate()
