#!/usr/bin/env python3
"""
Contextual Classifier - URL and Service Name Features

Addresses test errors where title alone is ambiguous:
- "boundaries" (generic, could be parcels/districts/neighborhoods)
- "VacantLand" (zero district keywords)
- "Projects_2021" (completely generic)
- "StatsNZ" (needs domain context to understand it's statistical boundaries)

URL structure and service names provide disambiguating context.

Author: ML Engineering
Date: 2025-11-24
"""

import re
import numpy as np
import lightgbm as lgb
from typing import Dict, List
from urllib.parse import urlparse


class ContextualFeatureExtractor:
    """
    Extract features from URL patterns and service names.

    This addresses test errors where title alone is ambiguous.
    URL structure and service names provide disambiguating context.
    """

    def __init__(self):
        # Positive signals for council districts
        self.council_keywords = ['council', 'ward', 'legislative', 'alderman', 'supervisor']
        self.district_keywords = ['district', 'dist', 'constituency']

        # Negative signals (NOT council districts)
        self.negative_keywords = [
            'demograph', 'census', 'population', 'statistic',
            'parcel', 'property', 'zoning', 'land', 'vacant',
            'project', 'development', 'infrastructure',
            'school', 'education', 'health', 'hospital',
            'police', 'fire', 'emergency',
            'water', 'sewer', 'utility',
            'transit', 'transport', 'traffic'
        ]

        # Statistical/aggregation agencies (NOT boundaries)
        self.stats_agencies = ['statsnz', 'census', 'acs_', 'demographic']

    def extract_url_features(self, url: str) -> Dict[str, float]:
        """
        Extract structural features from URL.

        Key patterns that disambiguate:
        - Path components: /council/, /legislative/, /ward/
        - Domain structure: gis.{city}.gov vs data.{county}.gov
        - Negative signals: /demographics/, /census/, /zoning/

        Args:
            url: ArcGIS REST endpoint URL (may be empty string)

        Returns:
            Dictionary of URL features (all float values)
        """
        if not url:
            return {
                'url_has_council': 0.0,
                'url_has_ward': 0.0,
                'url_has_district': 0.0,
                'url_has_legislative': 0.0,
                'url_has_boundaries': 0.0,
                'url_has_demographics': 0.0,
                'url_has_census': 0.0,
                'url_has_zoning': 0.0,
                'url_has_parcels': 0.0,
                'url_has_projects': 0.0,
                'url_depth': 0.0,
                'url_has_mapserver': 0.0,
                'url_has_featureserver': 0.0,
                'url_is_gov': 0.0,
                'url_is_city_domain': 0.0,
                'url_is_county_domain': 0.0,
                'url_is_gis_subdomain': 0.0,
                'url_has_opendata': 0.0,
            }

        url_lower = url.lower()
        parsed = urlparse(url_lower)
        path_parts = [p for p in parsed.path.split('/') if p]
        domain_parts = parsed.netloc.split('.')

        features = {
            # Explicit council/district keywords in URL path
            'url_has_council': float('council' in url_lower),
            'url_has_ward': float('ward' in url_lower),
            'url_has_district': float('district' in url_lower or 'dist' in url_lower),
            'url_has_legislative': float('legislat' in url_lower),
            'url_has_boundaries': float('bound' in url_lower or 'border' in url_lower),

            # Negative signals (usually NOT council districts)
            'url_has_demographics': float(any(kw in url_lower for kw in ['demograph', 'census', 'population'])),
            'url_has_census': float('census' in url_lower),
            'url_has_zoning': float('zoning' in url_lower),
            'url_has_parcels': float('parcel' in url_lower or 'property' in url_lower),
            'url_has_projects': float('project' in url_lower),

            # Structural features
            'url_depth': float(len(path_parts)),
            'url_has_mapserver': float('mapserver' in url_lower),
            'url_has_featureserver': float('featureserver' in url_lower),

            # Domain characteristics
            'url_is_gov': float('.gov' in url_lower),
            'url_is_city_domain': float(any(x in url_lower for x in ['city', 'municipality', 'municipal'])),
            'url_is_county_domain': float('county' in url_lower),
            'url_is_gis_subdomain': float(any(d.startswith('gis') for d in domain_parts)),
            'url_has_opendata': float('opendata' in url_lower),
        }

        return features

    def extract_service_features(self, service_name: str) -> Dict[str, float]:
        """
        Extract features from ArcGIS service name.

        Service names often reveal layer purpose:
        - "City_Council_Districts" (TRUE)
        - "Demographics_by_District" (FALSE - aggregated data)
        - "District_Population_Stats" (FALSE - statistics)

        Args:
            service_name: ArcGIS service name (may be None or "N/A")

        Returns:
            Dictionary of service features (all float values)
        """
        if not service_name or service_name == "N/A":
            return {
                'service_has_council': 0.0,
                'service_has_ward': 0.0,
                'service_has_legislative': 0.0,
                'service_has_district': 0.0,
                'service_has_boundaries': 0.0,
                'service_is_plural_districts': 0.0,
                'service_has_demographics': 0.0,
                'service_has_by_preposition': 0.0,
                'service_length': 0.0,
                'service_word_count': 0.0,
            }

        service_lower = service_name.lower()

        features = {
            # Positive signals
            'service_has_council': float('council' in service_lower),
            'service_has_ward': float('ward' in service_lower),
            'service_has_legislative': float('legislat' in service_lower),
            'service_has_district': float('district' in service_lower),
            'service_has_boundaries': float('bound' in service_lower or 'border' in service_lower),

            # Plurality matters: "Districts" (TRUE) vs "District_Demographics" (FALSE)
            'service_is_plural_districts': float(
                service_lower.endswith('districts') or
                service_lower.endswith('wards') or
                '_districts' in service_lower or
                '_wards' in service_lower
            ),

            # Negative signals
            'service_has_demographics': float(
                any(kw in service_lower for kw in ['demograph', 'population', 'census', 'statistic'])
            ),

            # Aggregation pattern: "by District" indicates aggregated data
            'service_has_by_preposition': float('_by_' in service_lower or ' by ' in service_lower),

            # Length as signal (shorter = more likely to be primary layer)
            'service_length': float(len(service_name)),
            'service_word_count': float(len(service_name.split('_'))),
        }

        return features

    def extract_title_features(self, title: str) -> Dict[str, float]:
        """
        Extract enhanced features from title.

        These complement the existing features in train_ensemble.py
        but add more nuanced pattern detection.

        Args:
            title: Layer title

        Returns:
            Dictionary of title features (all float values)
        """
        title_lower = title.lower()

        features = {
            # Basic length features
            'title_length': float(len(title)),
            'title_word_count': float(len(title.split())),

            # Positive keywords
            'title_has_council': float('council' in title_lower),
            'title_has_ward': float('ward' in title_lower),
            'title_has_district': float('district' in title_lower),
            'title_has_boundary': float('bound' in title_lower),

            # Year pattern (often added to static boundary layers)
            'title_has_year': float(bool(re.search(r'\b(19|20)\d{2}\b', title))),

            # Aggregation patterns (NEGATIVE signals)
            'title_has_by_preposition': float(' by ' in title_lower or '(by ' in title_lower),
            'title_has_population': float('population' in title_lower),
            'title_has_demographics': float('demograph' in title_lower),
            'title_has_statistics': float('statistic' in title_lower or 'stats' in title_lower),

            # Generic/ambiguous patterns
            'title_is_very_short': float(len(title.split()) <= 2),
            'title_is_generic': float(title_lower in ['boundaries', 'districts', 'wards', 'borders']),
        }

        return features

    def extract_all(self, sample: Dict) -> np.ndarray:
        """
        Combine title, URL, and service features.

        Args:
            sample: Dictionary with keys: title, url, service_name, etc.

        Returns:
            Feature array (1D numpy array)
        """
        title_features = self.extract_title_features(sample['title'])
        url_features = self.extract_url_features(sample.get('url', ''))
        service_features = self.extract_service_features(sample.get('service_name', ''))

        # Combine all features
        all_features = {**title_features, **url_features, **service_features}

        # Return as ordered array
        return np.array(list(all_features.values()), dtype=np.float32)

    def get_feature_names(self) -> List[str]:
        """Return ordered list of feature names for interpretation."""
        sample = {
            'title': 'test',
            'url': 'http://test.com',
            'service_name': 'test'
        }
        title_features = self.extract_title_features(sample['title'])
        url_features = self.extract_url_features(sample['url'])
        service_features = self.extract_service_features(sample['service_name'])

        all_features = {**title_features, **url_features, **service_features}
        return list(all_features.keys())


class ContextualClassifier:
    """
    LightGBM classifier using full contextual features.

    Why LightGBM over XGBoost:
    - Better handling of categorical-like binary features
    - Faster training on small datasets (432 samples)
    - Lower memory footprint
    - Histogram-based splitting (better for binary features)

    Architecture:
    - Shallow trees (max_depth=4) to prevent overfitting
    - Strong regularization (L1 + L2)
    - Row and column sampling for robustness
    - min_child_samples=20 ensures each leaf has sufficient samples

    Expected to fix 4-5 test errors:
    - "boundaries" (generic, needs URL)
    - "VacantLand" (no keywords, needs URL)
    - "Projects_2021" (generic, needs URL)
    - "Geographic boundaries (StatsNZ)" (needs URL to see statsNZ domain)
    """

    def __init__(self):
        self.extractor = ContextualFeatureExtractor()

        # LightGBM parameters optimized for small dataset (432 samples)
        # Based on LightGBM 4.6.0 best practices for binary classification
        self.classifier = lgb.LGBMClassifier(
            # Tree structure (shallow to prevent overfitting)
            num_leaves=15,         # 2^4 - 1 = 15 max leaves for depth 4
            max_depth=4,           # Explicit depth limit
            min_child_samples=20,  # 432 samples / 20 ≈ 21 leaves max

            # Learning rate and iterations
            learning_rate=0.05,    # Slow learning for stability
            n_estimators=200,      # More trees with lower LR

            # Sampling for robustness
            subsample=0.7,         # Row sampling (70% per tree)
            subsample_freq=1,      # Apply subsample every iteration
            colsample_bytree=0.8,  # Column sampling (80% per tree)

            # Regularization
            reg_alpha=0.5,         # L1 regularization
            reg_lambda=1.0,        # L2 regularization
            min_split_gain=0.01,   # Minimum gain to split

            # Objective and metric
            objective='binary',
            metric='binary_logloss',

            # Reproducibility and performance
            random_state=42,       # Match project convention
            n_jobs=-1,             # Use all cores
            verbose=-1,            # Suppress training logs
            force_col_wise=True,   # Column-wise histogram building (faster for small data)
        )

    def fit(self, samples: List[Dict], labels: np.ndarray):
        """
        Train classifier on samples.

        Args:
            samples: List of sample dictionaries with title, url, service_name
            labels: Binary labels (0 = NOT_COUNCIL, 1 = COUNCIL_DISTRICT)
        """
        X = np.array([self.extractor.extract_all(s) for s in samples])
        self.classifier.fit(X, labels)

    def predict_proba(self, samples: List[Dict]) -> np.ndarray:
        """
        Return probabilities for positive class (council district = TRUE).

        Args:
            samples: List of sample dictionaries

        Returns:
            Array of probabilities for COUNCIL_DISTRICT class (1D array)
        """
        X = np.array([self.extractor.extract_all(s) for s in samples])
        return self.classifier.predict_proba(X)[:, 1]

    def predict(self, samples: List[Dict]) -> np.ndarray:
        """
        Return binary predictions.

        Args:
            samples: List of sample dictionaries

        Returns:
            Array of binary predictions (0 or 1)
        """
        proba = self.predict_proba(samples)
        return (proba >= 0.5).astype(int)

    def get_feature_importance(self, top_n: int = 20) -> List[tuple]:
        """
        Get feature importance scores.

        Args:
            top_n: Number of top features to return

        Returns:
            List of (feature_name, importance) tuples, sorted by importance
        """
        feature_names = self.extractor.get_feature_names()
        importances = self.classifier.feature_importances_

        # Sort by importance
        feature_importance = list(zip(feature_names, importances))
        feature_importance.sort(key=lambda x: x[1], reverse=True)

        return feature_importance[:top_n]


if __name__ == "__main__":
    # Quick test
    print("Contextual Classifier Test")
    print("=" * 70)

    # Test feature extraction
    extractor = ContextualFeatureExtractor()

    test_sample = {
        'title': 'City Council Districts',
        'url': 'https://gis.cityofboston.gov/arcgis/rest/services/Boundaries/City_Council/MapServer/0',
        'service_name': 'City_Council'
    }

    features = extractor.extract_all(test_sample)
    feature_names = extractor.get_feature_names()

    print("\nTest Sample:")
    print(f"  Title: {test_sample['title']}")
    print(f"  URL: {test_sample['url']}")
    print(f"  Service: {test_sample['service_name']}")

    print(f"\nExtracted {len(features)} features:")
    for name, value in zip(feature_names, features):
        if value > 0:
            print(f"  {name}: {value}")

    print("\n" + "=" * 70)
    print("Feature extraction successful!")
    print("Run evaluate_contextual_classifier.py to train and evaluate model.")
