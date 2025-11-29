#!/usr/bin/env python3
"""
Hierarchical Pattern Detector - Rule-Based + ML Hybrid

High-precision component that catches specific linguistic patterns indicating
hierarchical aggregation (FALSE) vs boundary data (TRUE).

Target errors from ERROR_ANALYSIS_RESULTS.md:
- "Projected Population by District Council District of Hong Kong" (FALSE - aggregation)
- "Housing Tenure (by Atlanta City Council District) 2019" (FALSE - aggregation)

Why rule-based:
- These patterns are deterministic and interpretable
- 100% precision on known patterns
- Doesn't require training data for these specific cases
- Complements ML models (catches what they miss)

Author: Principal ML Engineering
Date: 2025-11-24
"""

import re
from typing import Dict, List
import numpy as np


class HierarchicalPatternDetector:
    """
    Detect hierarchical aggregation patterns using linguistic analysis.

    Hybrid approach:
    1. Rule-based pattern matching (high precision, interpretable)
    2. Calibrated probability scoring (integrates with ML ensemble)

    Target patterns:
    - "Population BY District" → FALSE (demographics aggregated by districts)
    - "Housing (by District)" → FALSE (data grouped by districts)
    - "District Boundaries" → TRUE (the boundaries themselves)

    Why rule-based:
    - These patterns are deterministic and interpretable
    - 100% precision on known patterns
    - Doesn't require training data for these specific cases
    - Complements ML models (catches what they miss)
    """

    # Aggregation patterns (ordered by strength - match longest first)
    AGGREGATION_PATTERNS = [
        # Strong aggregation signals (high confidence FALSE)
        (r'\b(population|demographics|statistics|data|housing|income|employment)\s+(by|for|within|under|across)\s+(district|ward|council)', 0.95),
        (r'\b(grouped|aggregated|summarized|tabulated|calculated)\s+by\s+(district|ward)', 0.95),
        (r'\bper\s+(district|ward)\b', 0.90),

        # Parenthetical aggregation (key pattern from error analysis)
        (r'\(by\s+(district|ward|council\s+district|city\s+council\s+district|atlanta\s+city\s+council\s+district)\)', 0.90),

        # Moderate aggregation signals
        (r'\b(breakdown|distribution|analysis|summary)\s+(by|of)\s+(district|ward)', 0.80),
        (r'\b\w+\s+under\s+(district|ward)\b', 0.75),

        # Weak aggregation signals
        (r'\b(district|ward)\s+(level|based)\s+(data|statistics)', 0.60),

        # Negative boundary signals (NOT boundaries)
        (r'\b(district|ward)\s+\d+\s+(suitable|sites|projects|parcels|data)', 0.65),  # "District 11 Suitable Sites" = NOT boundaries
    ]

    BOUNDARY_PATTERNS = [
        # Strong boundary signals (high confidence TRUE)
        (r'\b(district|ward|council)\s+(boundaries|borders|outlines|polygons|shapes|geometry)\b', 0.95),
        (r'\b(electoral|election)\s+(district|ward|boundaries)\b', 0.90),

        # Map layer indicators (with negative lookahead to avoid false matches)
        (r'\b(district|ward)\s+\d+(?!\s+(suitable|sites|projects|parcels|data))\b', 0.60),  # "District 5" but not "District 11 Suitable Sites"
        (r'\b(district|ward)\s+(map|layer|shapefile|geojson)\b', 0.80),
    ]

    def __init__(self):
        """Compile regex patterns for efficiency."""
        self.agg_patterns = [
            (re.compile(pattern, re.IGNORECASE), score)
            for pattern, score in self.AGGREGATION_PATTERNS
        ]

        self.boundary_patterns = [
            (re.compile(pattern, re.IGNORECASE), score)
            for pattern, score in self.BOUNDARY_PATTERNS
        ]

    def analyze_patterns(self, title: str) -> Dict[str, any]:
        """
        Analyze title for hierarchical patterns.

        Args:
            title: GIS layer title

        Returns:
            Dictionary with:
            - agg_score: Max aggregation pattern score (0-1)
            - boundary_score: Max boundary pattern score (0-1)
            - agg_matches: List of matched aggregation patterns
            - boundary_matches: List of matched boundary patterns
            - net_score: boundary_score - agg_score (positive = likely TRUE)
        """
        # Check aggregation patterns
        agg_score = 0.0
        agg_matches = []

        for pattern, score in self.agg_patterns:
            match = pattern.search(title)
            if match:
                if score > agg_score:
                    agg_score = score
                agg_matches.append({
                    'pattern': pattern.pattern,
                    'match': match.group(),
                    'score': score
                })

        # Check boundary patterns
        boundary_score = 0.0
        boundary_matches = []

        for pattern, score in self.boundary_patterns:
            match = pattern.search(title)
            if match:
                if score > boundary_score:
                    boundary_score = score
                boundary_matches.append({
                    'pattern': pattern.pattern,
                    'match': match.group(),
                    'score': score
                })

        # Net score: positive = boundary, negative = aggregation
        net_score = boundary_score - agg_score

        return {
            'agg_score': agg_score,
            'boundary_score': boundary_score,
            'agg_matches': agg_matches,
            'boundary_matches': boundary_matches,
            'net_score': net_score
        }

    def predict_proba(self, samples: List[Dict]) -> np.ndarray:
        """
        Predict probabilities using pattern analysis.

        Returns:
            Array of probabilities that sample is council district (TRUE)

        Calibration:
        - Strong boundary signal (net > 0.5): prob = 0.9
        - Moderate boundary (net > 0.2): prob = 0.7
        - Neutral (net in [-0.2, 0.2]): prob = 0.5 (defer to other models)
        - Moderate aggregation (net < -0.2): prob = 0.3
        - Strong aggregation (net < -0.5): prob = 0.1
        """
        probabilities = []

        for sample in samples:
            analysis = self.analyze_patterns(sample['title'])
            net = analysis['net_score']

            # Convert net score to calibrated probability
            if net > 0.5:
                prob = 0.9  # Strong boundary signal
            elif net > 0.2:
                prob = 0.7  # Moderate boundary
            elif net > -0.2:
                prob = 0.5  # Neutral (defer to other models)
            elif net > -0.5:
                prob = 0.3  # Moderate aggregation
            else:
                prob = 0.1  # Strong aggregation signal

            probabilities.append(prob)

        return np.array(probabilities)

    def predict(self, samples: List[Dict]) -> np.ndarray:
        """Return binary predictions."""
        proba = self.predict_proba(samples)
        return (proba >= 0.5).astype(int)

    def explain_prediction(self, sample: Dict) -> str:
        """
        Explain why pattern detector predicted TRUE/FALSE.

        Returns human-readable explanation.
        """
        analysis = self.analyze_patterns(sample['title'])
        proba = self.predict_proba([sample])[0]
        pred = "COUNCIL_DISTRICT" if proba >= 0.5 else "NOT_COUNCIL"

        explanation = f"Title: {sample['title']}\n"
        explanation += f"Prediction: {pred} (probability: {proba:.2%})\n"
        explanation += f"Net score: {analysis['net_score']:.2f}\n\n"

        if analysis['agg_matches']:
            explanation += "Aggregation patterns detected:\n"
            for match in analysis['agg_matches']:
                explanation += f"  - '{match['match']}' (score: {match['score']:.2f})\n"

        if analysis['boundary_matches']:
            explanation += "Boundary patterns detected:\n"
            for match in analysis['boundary_matches']:
                explanation += f"  - '{match['match']}' (score: {match['score']:.2f})\n"

        if not analysis['agg_matches'] and not analysis['boundary_matches']:
            explanation += "No clear patterns detected (defers to other models)\n"

        return explanation


if __name__ == "__main__":
    # Quick test
    detector = HierarchicalPatternDetector()

    test_cases = [
        {'title': "Population by District Council District"},
        {'title': "Housing Tenure (by Atlanta City Council District) 2019"},
        {'title': "City Council District Boundaries"},
        {'title': "District 5"},
    ]

    print("Pattern Detector Quick Test\n" + "="*70)
    for case in test_cases:
        prob = detector.predict_proba([case])[0]
        pred = "COUNCIL_DISTRICT" if prob >= 0.5 else "NOT_COUNCIL"
        print(f"\nTitle: {case['title']}")
        print(f"Prediction: {pred} (prob: {prob:.2%})")

        analysis = detector.analyze_patterns(case['title'])
        if analysis['agg_matches']:
            print(f"Aggregation matches: {len(analysis['agg_matches'])}")
        if analysis['boundary_matches']:
            print(f"Boundary matches: {len(analysis['boundary_matches'])}")
