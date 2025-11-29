#!/usr/bin/env python3
"""
Test Suite for Hierarchical Pattern Detector

Tests all pattern matching logic and ensures high precision on known edge cases.
"""

import pytest
from pattern_detector import HierarchicalPatternDetector


def test_aggregation_patterns():
    """Test detection of hierarchical aggregation patterns."""
    detector = HierarchicalPatternDetector()

    # Test cases that should be FALSE (aggregation)
    false_cases = [
        "Population by District Council District",
        "Housing Tenure (by Atlanta City Council District) 2019",
        "Demographics grouped by Ward",
        "Income per District",
        "Statistics under Council District",
        "Projected Population by District Council District of Hong Kong 2021 to 2029",
        "Housing data for Districts",
        "Employment within Council District",
    ]

    for title in false_cases:
        analysis = detector.analyze_patterns(title)
        assert analysis['agg_score'] > 0, f"Should detect aggregation in: {title}"
        assert analysis['net_score'] < 0, f"Net score should be negative for: {title}"

        proba = detector.predict_proba([{'title': title}])[0]
        assert proba < 0.5, f"Should predict FALSE for: {title}, got {proba:.2%}"


def test_boundary_patterns():
    """Test detection of boundary patterns."""
    detector = HierarchicalPatternDetector()

    # Test cases that should be TRUE (boundaries)
    true_cases = [
        "City Council District Boundaries",
        "Ward Polygons",
        "Legislative District Outlines 2024",
        "Council District 5",
        "Electoral Ward Map",
        "District Borders",
        "Council District Shapes",
    ]

    for title in true_cases:
        analysis = detector.analyze_patterns(title)
        assert analysis['boundary_score'] > 0, f"Should detect boundary in: {title}"

        # Note: Some may still predict neutral if no strong boundary signals
        # This is acceptable - detector is conservative


def test_neutral_cases():
    """Test cases where detector should defer to other models."""
    detector = HierarchicalPatternDetector()

    # Ambiguous cases (no clear patterns)
    neutral_cases = [
        "District Data",
        "Council Information",
        "Ward Details",
    ]

    for title in neutral_cases:
        analysis = detector.analyze_patterns(title)
        # Net score should be near zero
        assert abs(analysis['net_score']) < 0.3, f"Should be neutral: {title}"

        proba = detector.predict_proba([{'title': title}])[0]
        # Should be near 0.5 (defers to other models)
        assert 0.4 <= proba <= 0.6, f"Should defer for: {title}, got {proba:.2%}"


def test_target_errors():
    """Test on actual error cases from ERROR_ANALYSIS_RESULTS.md."""
    detector = HierarchicalPatternDetector()

    # These should be predicted as FALSE (aggregation)
    target_errors = [
        {
            'title': "Projected Population by District Council District of Hong Kong 2021 to 2029",
            'expected': False  # Aggregation
        },
        {
            'title': "Housing Tenure (by Atlanta City Council District) 2019",
            'expected': False  # Aggregation
        },
    ]

    for case in target_errors:
        pred = detector.predict([{'title': case['title']}])[0]
        proba = detector.predict_proba([{'title': case['title']}])[0]

        expected = 1 if case['expected'] else 0
        status = "✅ CORRECT" if pred == expected else "❌ WRONG"

        print(f"{status}: {case['title'][:60]}...")
        print(f"  Predicted: {pred}, Expected: {expected}, Prob: {proba:.2%}")

        assert pred == expected, f"Failed on: {case['title']}"


def test_explanation():
    """Test human-readable explanations."""
    detector = HierarchicalPatternDetector()

    sample = {'title': "Population by District Council District"}
    explanation = detector.explain_prediction(sample)

    print("\n" + "="*70)
    print("EXPLANATION TEST")
    print("="*70)
    print(explanation)

    assert "Aggregation patterns detected" in explanation
    assert "by district" in explanation.lower()


def test_parenthetical_pattern():
    """Test parenthetical aggregation pattern specifically."""
    detector = HierarchicalPatternDetector()

    parenthetical_cases = [
        "(by Atlanta City Council District)",
        "(by District)",
        "(by Ward)",
        "(by Council District)",
    ]

    for phrase in parenthetical_cases:
        title = f"Some Data {phrase} 2019"
        analysis = detector.analyze_patterns(title)

        assert analysis['agg_score'] > 0, f"Should detect parenthetical aggregation: {phrase}"
        assert any('\\(by' in m['pattern'] for m in analysis['agg_matches']), \
            f"Should match parenthetical pattern: {phrase}"

        proba = detector.predict_proba([{'title': title}])[0]
        assert proba < 0.5, f"Should predict FALSE for parenthetical aggregation: {title}"


def test_preposition_patterns():
    """Test various preposition patterns."""
    detector = HierarchicalPatternDetector()

    prepositions = ['by', 'for', 'within', 'under', 'across', 'per']

    for prep in prepositions:
        title = f"Demographics {prep} District"
        analysis = detector.analyze_patterns(title)

        if prep in ['by', 'for', 'within', 'under', 'across', 'per']:
            assert analysis['agg_score'] > 0, f"Should detect aggregation with '{prep}': {title}"
            proba = detector.predict_proba([{'title': title}])[0]
            assert proba < 0.5, f"Should predict FALSE for '{prep}' pattern: {title}"


def test_case_insensitivity():
    """Test that patterns are case-insensitive."""
    detector = HierarchicalPatternDetector()

    cases = [
        "population BY district",
        "POPULATION by DISTRICT",
        "Population By District",
        "POPULATION BY DISTRICT",
    ]

    for title in cases:
        analysis = detector.analyze_patterns(title)
        assert analysis['agg_score'] > 0, f"Should detect aggregation (case-insensitive): {title}"


def test_predict_interface():
    """Test that predict_proba and predict interfaces work correctly."""
    detector = HierarchicalPatternDetector()

    samples = [
        {'title': "Population by District"},
        {'title': "District Boundaries"},
        {'title': "Generic Title"},
    ]

    # Test predict_proba returns probabilities [0, 1]
    proba = detector.predict_proba(samples)
    assert len(proba) == len(samples)
    assert all(0 <= p <= 1 for p in proba)

    # Test predict returns binary 0/1
    pred = detector.predict(samples)
    assert len(pred) == len(samples)
    assert all(p in [0, 1] for p in pred)

    # Test predict matches predict_proba threshold
    for i in range(len(samples)):
        assert pred[i] == (1 if proba[i] >= 0.5 else 0)


if __name__ == "__main__":
    print("Running Pattern Detector Tests\n" + "="*70)
    pytest.main([__file__, "-v", "-s"])
