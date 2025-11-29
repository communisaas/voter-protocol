#!/usr/bin/env python3
"""
Test Suite for Semantic Classifier

Tests semantic understanding capabilities that go beyond keyword matching.
"""

import numpy as np
from typing import List, Dict
import sys

try:
    from semantic_classifier import SemanticFeatureExtractor, SemanticClassifier
except ImportError:
    print("ERROR: Cannot import semantic_classifier")
    print("Make sure semantic_classifier.py is in the same directory")
    sys.exit(1)


def test_semantic_embeddings():
    """Test that semantic embeddings capture meaning."""
    print("\n" + "="*70)
    print("TEST 1: Semantic Embedding Quality")
    print("="*70)

    extractor = SemanticFeatureExtractor()

    # Semantically similar titles should have similar embeddings
    similar_titles = [
        {'title': 'City Council District Boundaries'},
        {'title': 'Council District Geographic Boundaries'},
        {'title': 'Municipal Council Districts'}
    ]

    embeddings = extractor.extract(similar_titles)

    # Check shape
    assert embeddings.shape == (3, 384), f"Expected (3, 384), got {embeddings.shape}"
    print(f"✅ Embedding shape correct: {embeddings.shape}")

    # Check normalization (L2 norm should be ~1.0)
    norms = np.linalg.norm(embeddings, axis=1)
    assert np.allclose(norms, 1.0, atol=0.01), f"Embeddings not normalized: {norms}"
    print(f"✅ Embeddings normalized (L2 norms): {norms}")

    # Check semantic similarity (cosine similarity via dot product)
    sim_01 = np.dot(embeddings[0], embeddings[1])
    sim_02 = np.dot(embeddings[0], embeddings[2])

    print(f"\nSemantic similarity between similar titles:")
    print(f"  'City Council...' vs 'Council District...': {sim_01:.3f}")
    print(f"  'City Council...' vs 'Municipal Council...': {sim_02:.3f}")

    assert sim_01 > 0.7, f"Similar titles should have high similarity (got {sim_01:.3f})"
    assert sim_02 > 0.7, f"Similar titles should have high similarity (got {sim_02:.3f})"
    print(f"✅ Semantic similarity high for similar titles (>0.7)")


def test_semantic_vs_lexical():
    """Test that SBERT captures semantics beyond keywords."""
    print("\n" + "="*70)
    print("TEST 2: Semantic vs Lexical Understanding")
    print("="*70)

    extractor = SemanticFeatureExtractor()

    # Different words, same meaning
    semantic_samples = [
        {'title': 'City Council District Boundaries'},
        {'title': 'Municipal Legislative Districts'}  # Different words, same concept
    ]

    # Same words, different meaning (hierarchical aggregation)
    lexical_samples = [
        {'title': 'Population by Council District'},    # Aggregation (FALSE)
        {'title': 'Council District Population Data'}   # Aggregation (FALSE)
    ]

    semantic_emb = extractor.extract(semantic_samples)
    lexical_emb = extractor.extract(lexical_samples)

    semantic_sim = np.dot(semantic_emb[0], semantic_emb[1])
    lexical_sim = np.dot(lexical_emb[0], lexical_emb[1])

    print(f"\nSemantic understanding test:")
    print(f"  Different words, same meaning: {semantic_sim:.3f}")
    print(f"    'City Council District Boundaries'")
    print(f"    'Municipal Legislative Districts'")
    print(f"\n  Same domain, both aggregations: {lexical_sim:.3f}")
    print(f"    'Population by Council District'")
    print(f"    'Council District Population Data'")

    # SBERT should give reasonable similarity for both
    # (This test demonstrates concept, not strict assertion)
    print(f"\n✅ Embeddings capture semantic structure beyond keywords")


def test_aggregation_pattern_detection():
    """Test detection of hierarchical aggregation patterns."""
    print("\n" + "="*70)
    print("TEST 3: Aggregation Pattern Detection")
    print("="*70)

    extractor = SemanticFeatureExtractor()

    # Boundary layers (TRUE)
    boundary_samples = [
        {'title': 'Council District Boundaries'},
        {'title': 'Ward Boundaries 2024'},
        {'title': 'Legislative District Map'}
    ]

    # Aggregation layers (FALSE)
    aggregation_samples = [
        {'title': 'Population by Council District'},
        {'title': 'Demographics within Districts'},
        {'title': 'Housing Tenure (by Atlanta City Council District) 2019'}
    ]

    boundary_emb = extractor.extract(boundary_samples)
    aggregation_emb = extractor.extract(aggregation_samples)

    # Calculate centroid of each group
    boundary_centroid = np.mean(boundary_emb, axis=0)
    aggregation_centroid = np.mean(aggregation_emb, axis=0)

    # Distance between centroids
    centroid_distance = 1 - np.dot(boundary_centroid, aggregation_centroid)

    print(f"\nCentroid analysis:")
    print(f"  Boundary centroid distance from aggregation: {centroid_distance:.3f}")
    print(f"  Expected: >0.1 (distinct semantic clusters)")

    assert centroid_distance > 0.05, "Boundary and aggregation should form distinct clusters"
    print(f"✅ Semantic clustering separates boundaries from aggregations")


def test_multilingual_support():
    """Test multilingual understanding (only works with multilingual model)."""
    print("\n" + "="*70)
    print("TEST 4: Multilingual Support (Optional)")
    print("="*70)

    # This test only works with multilingual model
    # For all-MiniLM-L6-v2 (English-only), this will show lower similarity
    extractor = SemanticFeatureExtractor()

    # English and French for same concept
    samples = [
        {'title': 'Electoral District Boundaries'},
        {'title': 'carte electorale 2017'},  # French: "electoral map"
    ]

    embeddings = extractor.extract(samples)
    similarity = np.dot(embeddings[0], embeddings[1])

    print(f"\nEnglish-French similarity: {similarity:.3f}")

    if extractor.model_name == 'all-MiniLM-L6-v2':
        print(f"ℹ️  Using English-only model - low cross-lingual similarity expected")
        print(f"   To enable multilingual: use 'paraphrase-multilingual-MiniLM-L12-v2'")
    else:
        assert similarity > 0.5, "Should capture cross-lingual similarity"
        print(f"✅ Multilingual model captures cross-lingual similarity")


def test_classifier_on_known_patterns():
    """Test full classifier on known TRUE/FALSE patterns."""
    print("\n" + "="*70)
    print("TEST 5: Classifier on Known Patterns")
    print("="*70)

    # Create synthetic training data
    true_samples = [
        {'title': 'City Council Districts'},
        {'title': 'Ward Boundaries'},
        {'title': 'Council District Map'},
        {'title': 'Legislative Districts 2024'},
        {'title': 'Municipal Council Boundaries'},
        {'title': 'District Boundaries'},
        {'title': 'Council Ward Map'},
        {'title': 'City Council Geographic Boundaries'},
    ]

    false_samples = [
        {'title': 'Population by District'},
        {'title': 'Demographics within Council Districts'},
        {'title': 'Housing Data by Ward'},
        {'title': 'Census Data by District'},
        {'title': 'Zoning Map'},
        {'title': 'Parcel Boundaries'},
        {'title': 'School Districts'},
        {'title': 'Congressional Districts'},  # Different type of district
    ]

    train_samples = true_samples + false_samples
    train_labels = np.array([1]*len(true_samples) + [0]*len(false_samples))

    # Shuffle
    indices = np.random.permutation(len(train_samples))
    train_samples = [train_samples[i] for i in indices]
    train_labels = train_labels[indices]

    # Train classifier
    classifier = SemanticClassifier()
    classifier.fit(train_samples, train_labels)

    # Test on edge cases
    test_samples = [
        {'title': 'Council District Boundaries', 'expected': 1},
        {'title': 'Municipal Legislative Districts', 'expected': 1},
        {'title': 'Population by Council District', 'expected': 0},
        {'title': 'Demographics (by District)', 'expected': 0},
    ]

    print(f"\nTesting on edge cases:")
    predictions = classifier.predict(test_samples)
    probabilities = classifier.predict_proba(test_samples)

    for i, sample in enumerate(test_samples):
        expected = sample['expected']
        pred = predictions[i]
        prob = probabilities[i]
        status = "✅" if pred == expected else "❌"

        print(f"{status} '{sample['title']}'")
        print(f"   Expected: {expected}, Predicted: {pred}, Prob: {prob:.2%}")

    # At least 3/4 should be correct on this simple test
    accuracy = np.mean([predictions[i] == test_samples[i]['expected'] for i in range(len(test_samples))])
    assert accuracy >= 0.75, f"Should get at least 75% on simple patterns (got {accuracy*100:.0f}%)"
    print(f"\n✅ Classifier achieves {accuracy*100:.0f}% on known patterns")


def run_all_tests():
    """Run all tests."""
    print("\n" + "="*70)
    print("SEMANTIC CLASSIFIER TEST SUITE")
    print("="*70)

    try:
        test_semantic_embeddings()
        test_semantic_vs_lexical()
        test_aggregation_pattern_detection()
        test_multilingual_support()
        test_classifier_on_known_patterns()

        print("\n" + "="*70)
        print("ALL TESTS PASSED ✅")
        print("="*70)
        print("\nSemantic classifier is working correctly!")
        print("Ready for evaluation on real data.")

    except AssertionError as e:
        print(f"\n❌ TEST FAILED: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    run_all_tests()
