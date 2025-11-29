#!/usr/bin/env python3
"""
6-Model Ensemble - Phase 2D (FastText Removed)

Integrates 6 production-ready models:
- Baseline (3 models): XGBoost, LightGBM, LogisticRegression
- Phase 2A: ContextualClassifier (41 features from URL/service/title)
- Phase 2B: SemanticClassifier (SBERT embeddings)
- Phase 2C: PatternDetector (rule-based hierarchical detection)

FastText removed: Abandoned by Meta (March 2024), NumPy 2.0 incompatibility.

Expected: 90-94% test accuracy (improvement from 87.36% baseline)

Author: Principal ML Engineering
Date: 2025-11-25
"""

import json
import logging
import pickle
import numpy as np
from pathlib import Path
from typing import Dict, List, Tuple

# ML libraries
import lightgbm as lgb
import xgboost as xgb
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import StackingClassifier
from sklearn.calibration import CalibratedClassifierCV
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.metrics import (
    classification_report, confusion_matrix, roc_auc_score,
    precision_recall_fscore_support, accuracy_score
)
from sklearn.base import BaseEstimator, ClassifierMixin

# Phase 2 components
from contextual_classifier import ContextualClassifier
from model2vec_classifier import Model2VecClassifier
from semantic_classifier import SemanticClassifier
from pattern_detector import HierarchicalPatternDetector

logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger(__name__)

# Fixed random seed for full reproducibility
RANDOM_SEED = 42
np.random.seed(RANDOM_SEED)


class PatternDetectorWrapper(BaseEstimator, ClassifierMixin):
    """
    Sklearn-compatible wrapper for HierarchicalPatternDetector.

    Adds predict_proba with proper shape (N, 2) for stacking ensemble.
    """

    def __init__(self):
        self.detector = HierarchicalPatternDetector()

    def fit(self, X_samples: List[Dict], y: np.ndarray):
        """
        Pattern detector is rule-based, no training needed.

        This method exists for sklearn compatibility.
        """
        return self

    def predict_proba(self, X_samples: List[Dict]) -> np.ndarray:
        """
        Return probabilities for both classes.

        Args:
            X_samples: List of sample dictionaries

        Returns:
            Array of shape (N, 2) with probabilities [NOT_COUNCIL, COUNCIL_DISTRICT]
        """
        # Get probability for COUNCIL_DISTRICT class
        prob_true = self.detector.predict_proba(X_samples)
        prob_false = 1.0 - prob_true

        # Stack into (N, 2) array
        return np.column_stack([prob_false, prob_true])

    def predict(self, X_samples: List[Dict]) -> np.ndarray:
        """Return binary predictions."""
        return self.detector.predict(X_samples)


class ContextualClassifierWrapper(BaseEstimator, ClassifierMixin):
    """
    Sklearn-compatible wrapper for ContextualClassifier.

    Adds predict_proba with proper shape (N, 2) for stacking ensemble.
    """

    def __init__(self):
        self.classifier = ContextualClassifier()

    def fit(self, X_samples: List[Dict], y: np.ndarray):
        """Train contextual classifier."""
        self.classifier.fit(X_samples, y)
        return self

    def predict_proba(self, X_samples: List[Dict]) -> np.ndarray:
        """
        Return probabilities for both classes.

        Returns:
            Array of shape (N, 2) with probabilities [NOT_COUNCIL, COUNCIL_DISTRICT]
        """
        prob_true = self.classifier.predict_proba(X_samples)
        prob_false = 1.0 - prob_true
        return np.column_stack([prob_false, prob_true])

    def predict(self, X_samples: List[Dict]) -> np.ndarray:
        """Return binary predictions."""
        return self.classifier.predict(X_samples)


class SemanticClassifierWrapper(BaseEstimator, ClassifierMixin):
    """
    Sklearn-compatible wrapper for SemanticClassifier.

    Adds predict_proba with proper shape (N, 2) for stacking ensemble.
    """

    def __init__(self, model_name: str = 'all-MiniLM-L6-v2'):
        self.classifier = SemanticClassifier(model_name)

    def fit(self, X_samples: List[Dict], y: np.ndarray):
        """Train semantic classifier."""
        self.classifier.fit(X_samples, y)
        return self

    def predict_proba(self, X_samples: List[Dict]) -> np.ndarray:
        """
        Return probabilities for both classes.

        Returns:
            Array of shape (N, 2) with probabilities [NOT_COUNCIL, COUNCIL_DISTRICT]
        """
        prob_true = self.classifier.predict_proba(X_samples)
        prob_false = 1.0 - prob_true
        return np.column_stack([prob_false, prob_true])

    def predict(self, X_samples: List[Dict]) -> np.ndarray:
        """Return binary predictions."""
        return self.classifier.predict(X_samples)


class Model2VecClassifierWrapper(BaseEstimator, ClassifierMixin):
    """Sklearn-compatible wrapper for Model2VecClassifier."""

    def __init__(self, model_name: str = "minishlab/potion-base-8M"):
        self.classifier = Model2VecClassifier(model_name)

    def fit(self, X_samples: List[Dict], y: np.ndarray):
        self.classifier.fit(X_samples, y)
        return self

    def predict_proba(self, X_samples: List[Dict]) -> np.ndarray:
        prob_true = self.classifier.predict_proba(X_samples)
        prob_false = 1.0 - prob_true
        return np.column_stack([prob_false, prob_true])

    def predict(self, X_samples: List[Dict]) -> np.ndarray:
        return self.classifier.predict(X_samples)




def load_and_split_data(filepath: str = '../data/ml_training_data_expert_clean.jsonl') -> Tuple:
    """
    Load data and split BEFORE any processing to prevent data leaks.

    Returns: (train_samples, val_samples, test_samples)
    """
    samples = []
    with open(filepath) as f:
        for line in f:
            if line.strip():
                samples.append(json.loads(line))

    logger.info(f"Loaded {len(samples)} total samples")

    # Calculate class distribution
    labels = [s['is_council_district'] for s in samples]
    true_count = sum(labels)
    logger.info(f"  TRUE:  {true_count}/{len(samples)} ({100*true_count/len(samples):.1f}%)")
    logger.info(f"  FALSE: {len(samples)-true_count}/{len(samples)} ({100*(len(samples)-true_count)/len(samples):.1f}%)")

    # First split: 80% train+val, 20% test
    train_val_samples, test_samples = train_test_split(
        samples,
        test_size=0.2,
        random_state=RANDOM_SEED,
        stratify=labels
    )

    # Second split: 75% train, 25% val (from train+val)
    train_val_labels = [s['is_council_district'] for s in train_val_samples]
    train_samples, val_samples = train_test_split(
        train_val_samples,
        test_size=0.25,  # 0.25 * 0.8 = 0.2 of total
        random_state=RANDOM_SEED,
        stratify=train_val_labels
    )

    logger.info(f"\nData split:")
    logger.info(f"  Train: {len(train_samples)} samples ({100*sum(s['is_council_district'] for s in train_samples)/len(train_samples):.1f}% positive)")
    logger.info(f"  Val:   {len(val_samples)} samples ({100*sum(s['is_council_district'] for s in val_samples)/len(val_samples):.1f}% positive)")
    logger.info(f"  Test:  {len(test_samples)} samples ({100*sum(s['is_council_district'] for s in test_samples)/len(test_samples):.1f}% positive)")

    return train_samples, val_samples, test_samples


def extract_features(samples: List[Dict]) -> Tuple[np.ndarray, np.ndarray]:
    """Extract structured features for XGBoost/LightGBM/LogReg."""
    feature_matrix = []
    labels = []

    for sample in samples:
        title_lower = sample['title'].lower()

        features = {
            'title_length': len(sample['title']),
            'word_count': len(sample['title'].split()),
            'has_council': int('council' in title_lower),
            'has_ward': int('ward' in title_lower),
            'has_district': int('district' in title_lower),
            'has_boundary': int('bound' in title_lower),
            'has_year': int(any(year in sample['title'] for year in ['20' + str(i) for i in range(10, 26)])),
            'confidence': sample.get('confidence', 75) / 100.0,
            'feature_count': sample.get('live_feature_count', 0) or 0,
            'field_count': len(sample.get('live_fields', [])),
            'url_has_council': int('council' in sample.get('url', '').lower()),
            'url_has_ward': int('ward' in sample.get('url', '').lower()),
            'url_has_gov': int('.gov' in sample.get('url', '').lower()),
        }

        feature_matrix.append(list(features.values()))
        labels.append(int(sample['is_council_district']))

    return np.array(feature_matrix), np.array(labels)


def evaluate_detailed(y_true, y_pred, y_prob, model_name: str, dataset_name: str = "Validation"):
    """Detailed evaluation metrics."""
    print(f"\n{'='*70}")
    print(f"{model_name} - {dataset_name} Set")
    print(f"{'='*70}")

    print("\nClassification Report:")
    print(classification_report(y_true, y_pred, target_names=['Not Council', 'Council']))

    cm = confusion_matrix(y_true, y_pred)
    print(f"\nConfusion Matrix:")
    print(f"              Predicted")
    print(f"              Not    Council")
    print(f"Actual Not    {cm[0,0]:<6} {cm[0,1]:<6}")
    print(f"       Council {cm[1,0]:<6} {cm[1,1]:<6}")

    accuracy = accuracy_score(y_true, y_pred)
    precision, recall, f1, _ = precision_recall_fscore_support(y_true, y_pred, average='weighted')
    roc_auc = roc_auc_score(y_true, y_prob)

    print(f"\nMetrics:")
    print(f"  Accuracy:  {accuracy:.4f} ({accuracy*100:.2f}%)")
    print(f"  Precision: {precision:.4f}")
    print(f"  Recall:    {recall:.4f}")
    print(f"  F1 Score:  {f1:.4f}")
    print(f"  ROC AUC:   {roc_auc:.4f}")

    errors = y_true != y_pred
    print(f"\n  Errors: {np.sum(errors)}/{len(y_true)} ({100*np.sum(errors)/len(y_true):.2f}%)")

    return {
        'accuracy': accuracy,
        'precision': precision,
        'recall': recall,
        'f1': f1,
        'roc_auc': roc_auc,
        'error_rate': np.sum(errors) / len(y_true),
        'errors': int(np.sum(errors)),
        'total': len(y_true)
    }


def main():
    print("\n" + "="*70)
    print("PHASE 2D: 7-MODEL ENSEMBLE (FASTTEXT REMOVED)")
    print("="*70)
    print("\nFastText removed: Abandoned library (Meta, March 2024) + NumPy 2.0 incompatibility")
    print("Expected: 90-94% accuracy with 6 production-ready models")
    print("="*70)

    # 1. Load and split data
    train_samples, val_samples, test_samples = load_and_split_data()

    # Extract labels
    y_train = np.array([s['is_council_district'] for s in train_samples])
    y_val = np.array([s['is_council_district'] for s in val_samples])
    y_test = np.array([s['is_council_district'] for s in test_samples])

    # Extract structured features for baseline models
    X_train, _ = extract_features(train_samples)
    X_val, _ = extract_features(val_samples)
    X_test, _ = extract_features(test_samples)

    # Create models directory
    Path('../models_final').mkdir(parents=True, exist_ok=True)

    # 2. Train baseline models (XGBoost, LightGBM, LogReg)
    print("\n[1/6] Training XGBoost (baseline)...")
    xgb_model = xgb.XGBClassifier(
        max_depth=6, learning_rate=0.1, n_estimators=100,
        objective='binary:logistic', subsample=0.8,
        colsample_bytree=0.8, eval_metric='auc',
        random_state=RANDOM_SEED, n_jobs=-1
    )
    xgb_model.fit(X_train, y_train)

    print("\n[2/6] Training LightGBM (baseline)...")
    lgb_model = lgb.LGBMClassifier(
        num_leaves=31, learning_rate=0.1, n_estimators=100,
        max_depth=6, subsample=0.8, colsample_bytree=0.8,
        objective='binary', random_state=RANDOM_SEED,
        n_jobs=-1, verbose=-1
    )
    lgb_model.fit(X_train, y_train)

    print("\n[3/6] Training Logistic Regression (baseline)...")
    lr_model = LogisticRegression(
        C=1.0, max_iter=200, solver='lbfgs',
        class_weight='balanced', random_state=RANDOM_SEED, n_jobs=-1
    )
    lr_model.fit(X_train, y_train)

    print("\n[4/6] Training ContextualClassifier (Phase 2A)...")
    contextual_model = ContextualClassifierWrapper()
    contextual_model.fit(train_samples, y_train)

    print("\n[5/6] Training SemanticClassifier (Phase 2B)...")
    print("(This may take 30-60 seconds on first run - downloading SBERT model)")
    semantic_model = SemanticClassifierWrapper()
    semantic_model.fit(train_samples, y_train)

    print("\n[6/7] Initializing PatternDetector (Phase 2C)...")

    print("\n[7/7] Training Model2Vec (modern FastText replacement)...")
    model2vec_model = Model2VecClassifierWrapper()
    model2vec_model.fit(train_samples, y_train)
    pattern_model = PatternDetectorWrapper()
    pattern_model.fit(train_samples, y_train)  # No-op for rule-based model

    # 3. Create custom stacking ensemble
    # We need a custom approach because base models use different input types
    print("\n" + "="*70)
    print("BUILDING 7-MODEL STACKING ENSEMBLE")
    print("="*70)

    # Collect base model predictions on train set (for meta-learner)
    print("\nCollecting base model predictions on training set...")

    # Structured feature models
    train_meta_features = []
    train_meta_features.append(xgb_model.predict_proba(X_train)[:, 1])
    train_meta_features.append(lgb_model.predict_proba(X_train)[:, 1])
    train_meta_features.append(lr_model.predict_proba(X_train)[:, 1])

    # Sample-based models
    train_meta_features.append(contextual_model.predict_proba(train_samples)[:, 1])
    train_meta_features.append(semantic_model.predict_proba(train_samples)[:, 1])
    train_meta_features.append(pattern_model.predict_proba(train_samples)[:, 1])
    train_meta_features.append(model2vec_model.predict_proba(train_samples)[:, 1])

    X_meta_train = np.column_stack(train_meta_features)
    print(f"Meta-features shape: {X_meta_train.shape} (7 models)")

    # Collect on validation set
    print("\nCollecting base model predictions on validation set...")
    val_meta_features = []
    val_meta_features.append(xgb_model.predict_proba(X_val)[:, 1])
    val_meta_features.append(lgb_model.predict_proba(X_val)[:, 1])
    val_meta_features.append(lr_model.predict_proba(X_val)[:, 1])
    val_meta_features.append(contextual_model.predict_proba(val_samples)[:, 1])
    val_meta_features.append(semantic_model.predict_proba(val_samples)[:, 1])
    val_meta_features.append(pattern_model.predict_proba(val_samples)[:, 1])
    val_meta_features.append(model2vec_model.predict_proba(val_samples)[:, 1])

    X_meta_val = np.column_stack(val_meta_features)

    # Collect on test set
    print("\nCollecting base model predictions on test set...")
    test_meta_features = []
    test_meta_features.append(xgb_model.predict_proba(X_test)[:, 1])
    test_meta_features.append(lgb_model.predict_proba(X_test)[:, 1])
    test_meta_features.append(lr_model.predict_proba(X_test)[:, 1])
    test_meta_features.append(contextual_model.predict_proba(test_samples)[:, 1])
    test_meta_features.append(semantic_model.predict_proba(test_samples)[:, 1])
    test_meta_features.append(pattern_model.predict_proba(test_samples)[:, 1])
    test_meta_features.append(model2vec_model.predict_proba(test_samples)[:, 1])

    X_meta_test = np.column_stack(test_meta_features)

    # 4. Train meta-learner
    print("\nTraining meta-learner (Logistic Regression)...")
    meta_learner = LogisticRegression(
        C=0.1,  # Strong regularization
        max_iter=200,
        solver='lbfgs',
        random_state=RANDOM_SEED,
        n_jobs=-1
    )
    meta_learner.fit(X_meta_train, y_train)

    # Cross-validation on train
    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=RANDOM_SEED)
    cv_scores = cross_val_score(meta_learner, X_meta_train, y_train, cv=skf, scoring='accuracy')
    print(f"5-Fold CV Accuracy: {cv_scores.mean():.4f} ± {cv_scores.std():.4f}")

    # 5. Evaluate on validation set
    print("\n" + "="*70)
    print("VALIDATION SET EVALUATION")
    print("="*70)

    val_pred = meta_learner.predict(X_meta_val)
    val_prob = meta_learner.predict_proba(X_meta_val)[:, 1]
    val_metrics = evaluate_detailed(y_val, val_pred, val_prob, "6-Model Ensemble", "Validation")

    # 6. Calibrate ensemble
    print("\n" + "="*70)
    print("CALIBRATING ENSEMBLE")
    print("="*70)

    calibrator = CalibratedClassifierCV(meta_learner, cv='prefit', method='sigmoid')
    calibrator.fit(X_meta_val, y_val)

    cal_val_pred = calibrator.predict(X_meta_val)
    cal_val_prob = calibrator.predict_proba(X_meta_val)[:, 1]
    cal_val_metrics = evaluate_detailed(y_val, cal_val_pred, cal_val_prob, "Calibrated Ensemble", "Validation")

    # 7. FINAL TEST SET EVALUATION
    print("\n" + "="*70)
    print("FINAL TEST SET EVALUATION (NEVER SEEN BEFORE)")
    print("="*70)

    test_pred = calibrator.predict(X_meta_test)
    test_prob = calibrator.predict_proba(X_meta_test)[:, 1]
    test_metrics = evaluate_detailed(y_test, test_pred, test_prob, "Final Ensemble", "TEST")

    # 8. Model weights analysis
    print("\n" + "="*70)
    print("META-LEARNER WEIGHTS (Model Importance)")
    print("="*70)

    model_names = [
        'XGBoost', 'LightGBM', 'LogReg',
        'Contextual', 'Semantic', 'Pattern', 'Model2Vec'
    ]
    weights = meta_learner.coef_[0]

    print("\nModel contributions to final prediction:")
    for name, weight in sorted(zip(model_names, weights), key=lambda x: abs(x[1]), reverse=True):
        print(f"  {name:<12}: {weight:+.4f}")

    # 9. Compare to baseline
    print("\n" + "="*70)
    print("PERFORMANCE SUMMARY")
    print("="*70)

    baseline_accuracy = 0.8736  # From original training
    improvement = test_metrics['accuracy'] - baseline_accuracy

    print(f"\nBaseline (original 4 models):  {baseline_accuracy*100:.2f}%")
    print(f"Final Ensemble (7 models):     {test_metrics['accuracy']*100:.2f}%")
    print(f"Improvement:                   +{improvement*100:.2f} percentage points")
    print(f"Error reduction:               {100*(1-test_metrics['error_rate'])/(1-baseline_accuracy)-100:.1f}% fewer errors")

    print(f"\nTest Set Metrics:")
    print(f"  Accuracy:   {test_metrics['accuracy']*100:.2f}%")
    print(f"  Precision:  {test_metrics['precision']:.4f}")
    print(f"  Recall:     {test_metrics['recall']:.4f}")
    print(f"  F1 Score:   {test_metrics['f1']:.4f}")
    print(f"  ROC AUC:    {test_metrics['roc_auc']:.4f}")
    print(f"  Errors:     {test_metrics['errors']}/{test_metrics['total']} ({test_metrics['error_rate']*100:.2f}%)")

    # 10. Save ensemble
    print("\n" + "="*70)
    print("SAVING ENSEMBLE")
    print("="*70)

    ensemble_package = {
        'base_models': {
            'xgb': xgb_model,
            'lgb': lgb_model,
            'lr': lr_model,
            'contextual': contextual_model,
            'semantic': semantic_model,
            'pattern': pattern_model,
            'model2vec': model2vec_model
        },
        'meta_learner': meta_learner,
        'calibrator': calibrator,
        'model_names': model_names,
        'test_metrics': test_metrics
    }

    with open('../models_final/ensemble_6_models.pkl', 'wb') as f:
        pickle.dump(ensemble_package, f)

    print("\nSaved model:")
    print("  - ../models_final/ensemble_6_models.pkl (complete ensemble)")

    # 11. Success assessment
    print("\n" + "="*70)
    print("SUCCESS ASSESSMENT")
    print("="*70)

    if test_metrics['accuracy'] >= 0.95:
        print("\n✅ EXCELLENT: 95%+ accuracy achieved!")
        print("   Phase 2 complete. Ready for production deployment.")
    elif test_metrics['accuracy'] >= 0.94:
        print("\n✅ SUCCESS: 94%+ accuracy achieved (realistic target met)")
        print("   Phase 2 objectives met. Production-ready.")
    elif test_metrics['accuracy'] >= 0.90:
        print("\n✅ GOOD: 90%+ accuracy achieved")
        print("   Significant improvement over baseline. Phase 2 successful.")
    elif test_metrics['accuracy'] > baseline_accuracy:
        print(f"\n✅ IMPROVED: {test_metrics['accuracy']*100:.2f}% (baseline: {baseline_accuracy*100:.2f}%)")
        print("   6-model ensemble outperforms 4-model baseline.")
    else:
        print(f"\n⚠️  Below baseline ({test_metrics['accuracy']*100:.2f}% vs {baseline_accuracy*100:.2f}%)")
        print("   Consider:")
        print("   - Hyperparameter tuning")
        print("   - Error analysis on remaining errors")
        print("   - Add Model2Vec or lightweight transformer")

    print("\n" + "="*70)
    print("PHASE 2D COMPLETE")
    print("="*70 + "\n")


if __name__ == "__main__":
    main()
