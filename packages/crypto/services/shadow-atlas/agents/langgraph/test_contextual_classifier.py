#!/usr/bin/env python3
"""
Test Suite for Contextual Classifier

Tests URL and service name feature extraction on known examples.
"""

import pytest
import numpy as np
from contextual_classifier import ContextualFeatureExtractor, ContextualClassifier


class TestContextualFeatureExtractor:
    """Test URL and service feature extraction."""

    def setup_method(self):
        """Initialize extractor for each test."""
        self.extractor = ContextualFeatureExtractor()

    def test_url_feature_extraction_council_district(self):
        """Test URL feature extraction on council district URL."""
        url = "https://gis.cityofboston.gov/arcgis/rest/services/Boundaries/City_Council/MapServer/0"
        features = self.extractor.extract_url_features(url)

        assert features['url_has_council'] == 1.0, "Should detect 'council' in URL"
        assert features['url_is_gov'] == 1.0, "Should detect .gov domain"
        assert features['url_is_city_domain'] == 1.0, "Should detect city domain"
        assert features['url_is_gis_subdomain'] == 1.0, "Should detect gis subdomain"
        assert features['url_has_boundaries'] == 1.0, "Should detect boundaries in path"
        assert features['url_has_mapserver'] == 1.0, "Should detect MapServer"

    def test_url_feature_extraction_demographics(self):
        """Test URL feature extraction on demographics URL (FALSE signal)."""
        url = "https://data.example.gov/Demographics_by_District/MapServer/0"
        features = self.extractor.extract_url_features(url)

        assert features['url_has_demographics'] == 1.0, "Should detect demographics"
        assert features['url_has_district'] == 1.0, "Should detect district"
        assert features['url_is_gov'] == 1.0, "Should detect .gov"

    def test_url_feature_extraction_generic(self):
        """Test URL feature extraction on generic URL (ambiguous)."""
        url = "https://gis.example.gov/services/boundaries/MapServer/0"
        features = self.extractor.extract_url_features(url)

        assert features['url_has_boundaries'] == 1.0, "Should detect boundaries"
        assert features['url_is_gov'] == 1.0, "Should detect .gov"
        assert features['url_has_council'] == 0.0, "Should not detect council"

    def test_url_feature_extraction_vacant_land(self):
        """Test URL feature extraction for VacantLand (test error case)."""
        url = "https://services.arcgis.com/WgElToYhbLt94zKA/arcgis/rest/services/VacantLand/FeatureServer"
        features = self.extractor.extract_url_features(url)

        # VacantLand should trigger negative signals
        assert features['url_has_council'] == 0.0, "VacantLand has no council keyword"
        assert features['url_has_featureserver'] == 1.0, "Should detect FeatureServer"

    def test_url_feature_extraction_projects(self):
        """Test URL feature extraction for Projects_2021 (test error case)."""
        url = "https://services6.arcgis.com/hM5ymMLbxIyWTjn2/arcgis/rest/services/Projects_2021/FeatureServer"
        features = self.extractor.extract_url_features(url)

        # Projects should trigger negative signal
        assert features['url_has_projects'] == 1.0, "Should detect projects"
        assert features['url_has_council'] == 0.0, "Projects has no council keyword"

    def test_url_feature_extraction_empty(self):
        """Test URL feature extraction with empty URL."""
        features = self.extractor.extract_url_features("")

        # All features should be 0
        for key, value in features.items():
            assert value == 0.0, f"Empty URL should have {key} = 0"

    def test_service_feature_extraction_clear_council(self):
        """Test service name feature extraction for clear council district."""
        service = "City_Council_Districts"
        features = self.extractor.extract_service_features(service)

        assert features['service_has_council'] == 1.0, "Should detect council"
        assert features['service_has_district'] == 1.0, "Should detect district"
        assert features['service_is_plural_districts'] == 1.0, "Should detect plural 'Districts'"

    def test_service_feature_extraction_demographics(self):
        """Test service name feature extraction for demographics (FALSE)."""
        service = "District_Demographics"
        features = self.extractor.extract_service_features(service)

        assert features['service_has_demographics'] == 1.0, "Should detect demographics"
        assert features['service_is_plural_districts'] == 0.0, "Not plural districts"

    def test_service_feature_extraction_by_preposition(self):
        """Test service name with 'by' preposition (aggregation pattern)."""
        service = "Population_by_District"
        features = self.extractor.extract_service_features(service)

        assert features['service_has_by_preposition'] == 1.0, "Should detect 'by' preposition"
        assert features['service_has_demographics'] == 1.0, "Should detect population keyword"

    def test_service_feature_extraction_none(self):
        """Test service feature extraction with None or N/A."""
        features_none = self.extractor.extract_service_features(None)
        features_na = self.extractor.extract_service_features("N/A")

        # All features should be 0
        for key, value in features_none.items():
            assert value == 0.0, f"None service should have {key} = 0"

        for key, value in features_na.items():
            assert value == 0.0, f"N/A service should have {key} = 0"

    def test_title_feature_extraction_basic(self):
        """Test title feature extraction on basic example."""
        title = "City Council Districts 2024"
        features = self.extractor.extract_title_features(title)

        assert features['title_has_council'] == 1.0, "Should detect council"
        assert features['title_has_district'] == 1.0, "Should detect district"
        assert features['title_has_year'] == 1.0, "Should detect year"

    def test_title_feature_extraction_aggregation(self):
        """Test title with aggregation pattern (FALSE signal)."""
        title = "Population by District Council District"
        features = self.extractor.extract_title_features(title)

        assert features['title_has_by_preposition'] == 1.0, "Should detect 'by' preposition"
        assert features['title_has_population'] == 1.0, "Should detect population"
        assert features['title_has_district'] == 1.0, "Should detect district"

    def test_title_feature_extraction_generic(self):
        """Test generic title (test error case)."""
        title = "boundaries"
        features = self.extractor.extract_title_features(title)

        assert features['title_is_generic'] == 1.0, "Should flag as generic"
        assert features['title_is_very_short'] == 1.0, "Should flag as very short"
        assert features['title_has_boundary'] == 1.0, "Should detect boundary keyword"

    def test_extract_all_integration(self):
        """Test full feature extraction integration."""
        sample = {
            'title': 'City Council Districts',
            'url': 'https://gis.cityofboston.gov/arcgis/rest/services/City_Council/MapServer/0',
            'service_name': 'City_Council'
        }

        features = self.extractor.extract_all(sample)

        # Should be a 1D numpy array
        assert isinstance(features, np.ndarray), "Should return numpy array"
        assert features.ndim == 1, "Should be 1D array"
        assert len(features) > 0, "Should have features"
        assert features.dtype == np.float32, "Should be float32"

        # Check that some features are non-zero
        assert np.sum(features) > 0, "Should have non-zero features"

    def test_feature_names_consistency(self):
        """Test that feature names are consistent with extraction."""
        feature_names = self.extractor.get_feature_names()

        sample = {
            'title': 'Test',
            'url': 'http://test.com',
            'service_name': 'Test'
        }
        features = self.extractor.extract_all(sample)

        assert len(feature_names) == len(features), "Feature names should match feature count"


class TestContextualClassifier:
    """Test full classifier integration."""

    def test_classifier_initialization(self):
        """Test that classifier initializes correctly."""
        classifier = ContextualClassifier()

        assert classifier.extractor is not None, "Should have extractor"
        assert classifier.classifier is not None, "Should have LightGBM classifier"

    def test_classifier_training(self):
        """Test classifier training on synthetic data."""
        classifier = ContextualClassifier()

        # Create synthetic training data
        train_samples = [
            {
                'title': 'City Council Districts',
                'url': 'https://gis.city.gov/council',
                'service_name': 'Council_Districts'
            },
            {
                'title': 'Ward Boundaries',
                'url': 'https://gis.city.gov/wards',
                'service_name': 'Ward_Boundaries'
            },
            {
                'title': 'Demographics by District',
                'url': 'https://data.city.gov/demographics',
                'service_name': 'Demographics'
            },
            {
                'title': 'Vacant Land Parcels',
                'url': 'https://gis.city.gov/parcels',
                'service_name': 'Vacant_Land'
            },
        ]

        train_labels = np.array([1, 1, 0, 0])  # First two are TRUE, last two are FALSE

        # Train classifier
        classifier.fit(train_samples, train_labels)

        # Predict on training data (should have high accuracy)
        predictions = classifier.predict(train_samples)

        assert len(predictions) == len(train_samples), "Should return predictions for all samples"
        assert predictions.dtype == np.int64 or predictions.dtype == np.int32, "Should return integers"

    def test_classifier_probability_output(self):
        """Test that probability predictions are valid."""
        classifier = ContextualClassifier()

        # Create minimal training data
        train_samples = [
            {'title': 'Council Districts', 'url': 'http://test.gov/council', 'service_name': 'Council'},
            {'title': 'Demographics', 'url': 'http://test.gov/demo', 'service_name': 'Demo'},
        ]
        train_labels = np.array([1, 0])

        classifier.fit(train_samples, train_labels)

        # Test probability output
        test_samples = [
            {'title': 'Test Council', 'url': 'http://test.gov', 'service_name': 'Test'}
        ]
        probabilities = classifier.predict_proba(test_samples)

        assert isinstance(probabilities, np.ndarray), "Should return numpy array"
        assert len(probabilities) == 1, "Should return one probability per sample"
        assert 0 <= probabilities[0] <= 1, "Probability should be in [0, 1]"

    def test_feature_importance(self):
        """Test feature importance extraction."""
        classifier = ContextualClassifier()

        # Create training data
        train_samples = [
            {'title': 'Council Districts', 'url': 'http://test.gov/council', 'service_name': 'Council'},
            {'title': 'Demographics', 'url': 'http://test.gov/demo', 'service_name': 'Demo'},
        ]
        train_labels = np.array([1, 0])

        classifier.fit(train_samples, train_labels)

        # Get feature importance
        importance = classifier.get_feature_importance(top_n=10)

        assert isinstance(importance, list), "Should return list"
        assert len(importance) <= 10, "Should return at most 10 features"
        assert all(isinstance(f, tuple) and len(f) == 2 for f in importance), "Should return (name, score) tuples"


class TestRealWorldExamples:
    """Test on real examples from test errors."""

    def setup_method(self):
        """Initialize extractor."""
        self.extractor = ContextualFeatureExtractor()

    def test_boundaries_generic(self):
        """Test 'boundaries' (test error - generic title)."""
        sample = {
            'title': 'boundaries',
            'url': 'https://services2.arcgis.com/pc4beVTMEhYHqerq/arcgis/rest/services/boundaries/FeatureServer',
            'service_name': 'N/A'
        }

        features = self.extractor.extract_all(sample)

        # Should extract URL features to disambiguate
        assert features is not None
        assert len(features) > 0

    def test_vacant_land(self):
        """Test 'VacantLand' (test error - no district keywords)."""
        sample = {
            'title': 'VacantLand',
            'url': 'https://services.arcgis.com/WgElToYhbLt94zKA/arcgis/rest/services/VacantLand/FeatureServer',
            'service_name': 'N/A'
        }

        features = self.extractor.extract_all(sample)

        # URL should provide disambiguating context
        assert features is not None

    def test_projects_2021(self):
        """Test 'Projects_2021' (test error - completely generic)."""
        sample = {
            'title': 'Projects_2021',
            'url': 'https://services6.arcgis.com/hM5ymMLbxIyWTjn2/arcgis/rest/services/Projects_2021/FeatureServer',
            'service_name': 'N/A'
        }

        features = self.extractor.extract_all(sample)

        # Should detect 'projects' in URL as negative signal
        url_features = self.extractor.extract_url_features(sample['url'])
        assert url_features['url_has_projects'] == 1.0

    def test_statsnz_geographic_boundaries(self):
        """Test 'Geographic boundaries (StatsNZ)' (test error - needs URL context)."""
        sample = {
            'title': 'Geographic boundaries (StatsNZ)',
            'url': 'https://services5.arcgis.com/H4FlrMy6xTBd6Ywx/arcgis/rest/services/GeographicBoundaries_FarNorth_StatsNZ/FeatureServer',
            'service_name': 'N/A'
        }

        features = self.extractor.extract_all(sample)

        # Title should detect 'stats' as statistical agency
        title_features = self.extractor.extract_title_features(sample['title'])
        assert title_features['title_has_statistics'] == 1.0


if __name__ == "__main__":
    # Run tests
    pytest.main([__file__, "-v", "--tb=short"])
