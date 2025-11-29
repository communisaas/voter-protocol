#!/usr/bin/env python3
"""
Model2Vec Classifier - Phase 2D (7th model)

Uses Model2Vec static embeddings (modern FastText replacement):
- 256-dimensional embeddings
- 500x faster than transformers on CPU
- 15x smaller than Sentence Transformers
- Actively maintained (Jan 2025)

Superior to FastText for text classification while being production-ready.

Author: Principal ML Engineering
Date: 2025-11-25
"""

import numpy as np
from typing import List, Dict
from numpy.typing import NDArray

import xgboost as xgb
from model2vec import StaticModel


class Model2VecFeatureExtractor:
    """
    Extract static embeddings using Model2Vec.

    Model2Vec provides distilled word embeddings that are:
    - Much smaller than transformers (7.5M vs 120M params)
    - Much faster (500x faster inference)
    - Better than FastText on most benchmarks
    """

    def __init__(self, model_name: str = 'minishlab/potion-base-8M'):
        """
        Initialize Model2Vec embeddings.

        Args:
            model_name: HuggingFace model name
                       - potion-base-8M: 8M params, 256 dims (default)
                       - potion-base-32M: 32M params, higher quality
        """
        print(f"Loading Model2Vec model: {model_name}")
        print("This will download the model on first run (~8MB)")

        self.model = StaticModel.from_pretrained(model_name)

        # Get embedding dimension
        test_embedding = self.model.encode(["test"])
        self.embedding_dim = test_embedding.shape[1]

        print(f"Model loaded: {model_name}")
        print(f"Embedding dimension: {self.embedding_dim}")

    def extract(self, samples: List[Dict]) -> NDArray[np.float32]:
        """
        Extract Model2Vec embeddings from title text.

        Args:
            samples: List of samples with 'title' key

        Returns:
            Matrix of shape (N, embedding_dim) with embeddings
        """
        titles = [s['title'] for s in samples]

        print(f"\nExtracting Model2Vec embeddings for {len(samples)} samples...")

        # Model2Vec is MUCH faster than SBERT - no batch processing needed
        embeddings = self.model.encode(titles)

        print(f"Embeddings extracted: shape {embeddings.shape}")

        return embeddings


class Model2VecClassifier:
    """
    Text classifier using Model2Vec embeddings + XGBoost.

    Combines:
    - Model2Vec static embeddings (256 dims)
    - XGBoost gradient boosting classifier

    Expected to outperform FastText while being faster and more maintainable.
    """

    def __init__(self, model_name: str = 'minishlab/potion-base-8M'):
        self.feature_extractor = Model2VecFeatureExtractor(model_name)
        self.classifier = None

    def fit(self, samples: List[Dict], y: np.ndarray):
        """
        Train classifier on Model2Vec embeddings.

        Args:
            samples: List of sample dictionaries with 'title' key
            y: Binary labels (0 = not council, 1 = council)
        """
        # Extract embeddings
        X = self.feature_extractor.extract(samples)

        # Train XGBoost on embeddings
        print(f"\nTraining XGBoost on embeddings (shape: {X.shape})...")

        self.classifier = xgb.XGBClassifier(
            max_depth=6,
            learning_rate=0.1,
            n_estimators=100,
            objective='binary:logistic',
            subsample=0.8,
            colsample_bytree=0.8,
            eval_metric='auc',
            random_state=42,
            n_jobs=-1
        )

        self.classifier.fit(X, y)

        return self

    def predict_proba(self, samples: List[Dict]) -> np.ndarray:
        """
        Return probability of COUNCIL_DISTRICT class (1D array).

        Args:
            samples: List of sample dictionaries

        Returns:
            1D array of probabilities for COUNCIL_DISTRICT class
        """
        if self.classifier is None:
            raise ValueError("Classifier not fitted yet")

        X = self.feature_extractor.extract(samples)
        proba = self.classifier.predict_proba(X)

        # Return probability of positive class (council district)
        return proba[:, 1]

    def predict(self, samples: List[Dict]) -> np.ndarray:
        """
        Return binary predictions.

        Args:
            samples: List of sample dictionaries

        Returns:
            Binary predictions (0 or 1)
        """
        proba = self.predict_proba(samples)
        return (proba >= 0.5).astype(int)


# Example usage
if __name__ == "__main__":
    # Test with sample data
    samples = [
        {'title': 'City Council Districts 2024'},
        {'title': 'Population Demographics'},
        {'title': 'Ward Boundaries'},
        {'title': 'Random GIS Layer'}
    ]

    y_train = np.array([1, 0, 1, 0])  # Binary labels

    # Train classifier
    classifier = Model2VecClassifier()
    classifier.fit(samples, y_train)

    # Make predictions
    proba = classifier.predict_proba(samples)
    preds = classifier.predict(samples)

    print("\nPredictions:")
    for i, sample in enumerate(samples):
        print(f"  {sample['title']}: {proba[i]:.3f} ({'council' if preds[i] else 'not council'})")
