#!/usr/bin/env python3
"""
Semantic Classifier - Phase 2B: Sentence-BERT Embeddings

Implements semantic understanding layer using sentence-transformers to catch
errors that require meaning beyond keywords.

Target errors (from ERROR_ANALYSIS_RESULTS.md):
- "carte_electoral_2017" (French, non-English)
- "King County Find My Districts Layer" (descriptive/functional phrasing)
- "1992 Metropolitan King County Council Districts" (historical + noise)

Architecture:
- Encoder: all-MiniLM-L6-v2 (384-dim sentence embeddings)
- Classifier: XGBoost on embeddings (handles high-dimensional input)
- Regularization: Strong L1/L2 + subsampling for small dataset (432 samples)

Expected standalone accuracy: 75-82%
Expected ensemble contribution: +3-4% to baseline
"""

import numpy as np
from typing import List, Dict
from numpy.typing import NDArray
import xgboost as xgb
from sklearn.model_selection import StratifiedKFold, cross_val_score

try:
    from sentence_transformers import SentenceTransformer
except ImportError:
    print("ERROR: sentence-transformers not installed")
    print("Install with: pip install -U sentence-transformers")
    raise


class SemanticFeatureExtractor:
    """
    Extract semantic embeddings using Sentence-BERT.

    Why SBERT over FastText:
    - Captures semantic meaning, not just lexical patterns
    - Trained on 1B+ sentence pairs (semantic similarity)
    - Understands word order and syntactic structure
    - Can distinguish "Demographics BY District" (FALSE) from "District Demographics" (TRUE)

    Target errors this fixes:
    - "carte_electoral" (French) - If using multilingual model
    - "Find My Districts Layer" - Semantic intent vs keywords
    - "conflated to Census Blocks" - Understands transformation
    """

    def __init__(self, model_name: str = 'all-MiniLM-L6-v2'):
        """
        Initialize SBERT encoder.

        Args:
            model_name: HuggingFace model name
                - 'all-MiniLM-L6-v2': English, 384-dim, fast (default, recommended)
                - 'paraphrase-multilingual-MiniLM-L12-v2': 50+ languages, 384-dim

        Model Details:
            all-MiniLM-L6-v2:
            - Size: ~80-100MB download (first use only)
            - Embedding dimension: 384
            - Parameters: 80M
            - Inference speed: ~50ms CPU per sample, ~5ms batched
            - Languages: English only
            - Training: 1B+ sentence pairs

        Research: https://www.sbert.net/docs/pretrained_models.html
        """
        print(f"Loading SBERT model: {model_name}")
        print("This may take 30-60 seconds on first run (downloads model)")

        # Load model (will download on first use to ~/.cache/torch/sentence_transformers/)
        self.model = SentenceTransformer(model_name)
        self.model_name = model_name

        embedding_dim = self.model.get_sentence_embedding_dimension()
        print(f"Model loaded: {model_name}")
        print(f"Embedding dimension: {embedding_dim}")

    def extract(self, samples: List[Dict]) -> NDArray[np.float32]:
        """
        Extract semantic embeddings for titles.

        Args:
            samples: List of sample dictionaries with 'title' key

        Returns:
            Embeddings array of shape (N, 384)

        Performance:
            - 432 samples: ~3-5 seconds CPU
            - Batched processing for efficiency
            - L2 normalized for cosine similarity
        """
        titles = [s['title'] for s in samples]

        # Encode with batching for efficiency
        embeddings = self.model.encode(
            titles,
            batch_size=32,              # Process 32 at a time
            show_progress_bar=True,     # Show progress for long operations
            normalize_embeddings=True,  # L2 normalize for cosine similarity
            convert_to_numpy=True       # Return numpy array
        )

        return embeddings  # Shape: (N, 384)


class SemanticClassifier:
    """
    XGBoost classifier on SBERT embeddings.

    Architecture choice: XGBoost
    - Handles high-dimensional embeddings (384 dims) well
    - Can learn non-linear decision boundaries in embedding space
    - Robust to overfitting with proper regularization
    - Fast inference even with deep trees

    Hyperparameter rationale (for 432 samples, 384 dims):
    - max_depth=4: Shallow trees prevent overfitting on small dataset
    - learning_rate=0.05: Slow learning for better generalization
    - n_estimators=200: More trees compensate for lower learning rate
    - subsample=0.7: Row sampling for regularization
    - colsample_bytree=0.7: Column sampling (384 → ~269 features per tree)
    - reg_alpha=1.0, reg_lambda=2.0: Strong L1/L2 regularization

    Expected performance:
    - Standalone validation accuracy: 75-82%
    - Ensemble contribution: +3-4% to baseline
    - Inference time: ~50ms per sample (dominated by SBERT encoding)
    """

    def __init__(self, model_name: str = 'all-MiniLM-L6-v2'):
        """
        Initialize semantic classifier.

        Args:
            model_name: SBERT model name (passed to SemanticFeatureExtractor)
        """
        self.extractor = SemanticFeatureExtractor(model_name)

        # XGBoost params for 384-dim embeddings on 432 samples
        # Research: https://xgboost.readthedocs.io/en/stable/parameter.html
        self.classifier = xgb.XGBClassifier(
            max_depth=4,           # Shallow trees (prevent overfitting)
            learning_rate=0.05,    # Slow learning
            n_estimators=200,      # More trees with lower LR
            subsample=0.7,         # Row sampling (70% of 432 = ~302 per tree)
            colsample_bytree=0.7,  # Column sampling (70% of 384 = ~269 per tree)
            reg_alpha=1.0,         # L1 regularization (feature sparsity)
            reg_lambda=2.0,        # L2 regularization (weight smoothing)
            random_state=42,       # Reproducibility
            objective='binary:logistic',
            eval_metric='auc',
            n_jobs=-1,             # Use all CPU cores
            verbosity=1            # Show training progress
        )

    def fit(self, samples: List[Dict], labels: NDArray[np.int32]):
        """
        Train classifier on samples.

        Args:
            samples: List of sample dictionaries with 'title' key
            labels: Binary labels (0=NOT_COUNCIL, 1=COUNCIL_DISTRICT)
        """
        print(f"\nExtracting semantic embeddings for {len(samples)} samples...")
        X = self.extractor.extract(samples)

        print(f"\nTraining XGBoost on embeddings (shape: {X.shape})...")
        self.classifier.fit(X, labels)

        # Cross-validation for stability check
        print("\nRunning 5-fold cross-validation...")
        skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
        cv_scores = cross_val_score(
            self.classifier, X, labels,
            cv=skf, scoring='accuracy'
        )
        print(f"5-Fold CV Accuracy: {cv_scores.mean():.4f} ± {cv_scores.std():.4f}")
        print(f"Individual folds: {[f'{s:.4f}' for s in cv_scores]}")

    def predict_proba(self, samples: List[Dict]) -> NDArray[np.float64]:
        """
        Return probabilities for positive class.

        Args:
            samples: List of sample dictionaries with 'title' key

        Returns:
            Probability array of shape (N,) with values in [0, 1]
            Higher values = more likely to be council district
        """
        X = self.extractor.extract(samples)
        return self.classifier.predict_proba(X)[:, 1]

    def predict(self, samples: List[Dict]) -> NDArray[np.int32]:
        """
        Return binary predictions.

        Args:
            samples: List of sample dictionaries with 'title' key

        Returns:
            Binary predictions (0=NOT_COUNCIL, 1=COUNCIL_DISTRICT)
        """
        proba = self.predict_proba(samples)
        return (proba >= 0.5).astype(np.int32)


def main():
    """
    Quick test to verify installation and basic functionality.
    """
    print("="*70)
    print("SEMANTIC CLASSIFIER - Installation Test")
    print("="*70)

    # Test data
    test_samples = [
        {'title': 'City Council District Boundaries'},
        {'title': 'Municipal Council Districts'},
        {'title': 'Population by Council District'},  # Aggregation (FALSE)
        {'title': 'Demographics within Districts'},   # Aggregation (FALSE)
    ]

    # Test embedding extraction
    print("\nTesting embedding extraction...")
    extractor = SemanticFeatureExtractor()
    embeddings = extractor.extract(test_samples)

    print(f"\nEmbedding shape: {embeddings.shape}")
    print(f"Expected: (4, 384)")

    # Check normalization
    norms = np.linalg.norm(embeddings, axis=1)
    print(f"\nL2 norms: {norms}")
    print(f"Expected: ~1.0 (normalized)")

    # Check semantic similarity
    sim_01 = np.dot(embeddings[0], embeddings[1])  # Both TRUE, should be similar
    sim_02 = np.dot(embeddings[0], embeddings[2])  # TRUE vs FALSE

    print(f"\nSemantic similarity:")
    print(f"  'Council Districts' vs 'Municipal Districts': {sim_01:.3f}")
    print(f"  'Council Districts' vs 'Population by District': {sim_02:.3f}")
    print(f"  Expected: First similarity > second (captures semantic difference)")

    print("\n✅ Installation test complete!")
    print("If you see embeddings with shape (4, 384) and normalized to ~1.0, you're ready.")


if __name__ == "__main__":
    main()
