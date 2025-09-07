"""
Statistical validity tests for causation claims
Ensures we're not making unfounded causal assertions
"""

import pytest
import numpy as np
from scipy import stats
from typing import Dict, List, Tuple
import networkx as nx


class TestStatisticalValidity:
    """Validate statistical rigor of causation tracking"""
    
    @pytest.mark.critical
    def test_confidence_interval_calculation(self):
        """Test proper confidence interval construction"""
        # Sample data: template usage correlation with vote changes
        sample_size = 100
        successes = 65  # 65% correlation observed
        
        # Calculate 95% confidence interval using Wilson score
        p_hat = successes / sample_size
        z = 1.96  # 95% confidence
        
        # Wilson score interval (better for small samples)
        denominator = 1 + z**2 / sample_size
        center = (p_hat + z**2 / (2 * sample_size)) / denominator
        margin = z * np.sqrt(p_hat * (1 - p_hat) / sample_size + z**2 / (4 * sample_size**2)) / denominator
        
        ci_lower = center - margin
        ci_upper = center + margin
        
        # Verify confidence interval properties
        assert 0 <= ci_lower <= 1, "Lower bound must be valid probability"
        assert 0 <= ci_upper <= 1, "Upper bound must be valid probability"
        assert ci_lower < p_hat < ci_upper, "Point estimate should be within CI"
        
        # With 100 samples, CI should be reasonably tight
        ci_width = ci_upper - ci_lower
        assert ci_width < 0.2, f"CI too wide ({ci_width:.2f}) for sample size"
    
    @pytest.mark.critical
    def test_statistical_significance(self):
        """Test p-value calculation for causation claims"""
        # Null hypothesis: No causal relationship
        # Alternative: Template causes position change
        
        # Observed data
        template_users = 1000
        position_changes = 120  # 12% changed position
        baseline_rate = 0.05  # 5% baseline position change rate
        
        # Binomial test for significance
        p_value = stats.binom_test(
            position_changes,
            template_users,
            baseline_rate,
            alternative='greater'
        )
        
        # Check if statistically significant at α = 0.05
        alpha = 0.05
        is_significant = p_value < alpha
        
        assert is_significant, f"p-value {p_value:.4f} not significant"
        
        # Calculate effect size (Cohen's h)
        p1 = position_changes / template_users
        p2 = baseline_rate
        h = 2 * (np.arcsin(np.sqrt(p1)) - np.arcsin(np.sqrt(p2)))
        
        # Effect size should be meaningful (not just statistically significant)
        assert abs(h) > 0.2, f"Effect size {h:.2f} too small to be meaningful"
    
    @pytest.mark.critical
    def test_sample_size_adequacy(self):
        """Test that sample sizes are adequate for claims"""
        # Power analysis for different scenarios
        scenarios = [
            {'effect_size': 0.1, 'power': 0.8, 'alpha': 0.05},  # Small effect
            {'effect_size': 0.3, 'power': 0.8, 'alpha': 0.05},  # Medium effect
            {'effect_size': 0.5, 'power': 0.8, 'alpha': 0.05}   # Large effect
        ]
        
        for scenario in scenarios:
            # Calculate required sample size for desired power
            # Using approximation for proportions
            z_alpha = stats.norm.ppf(1 - scenario['alpha']/2)
            z_beta = stats.norm.ppf(scenario['power'])
            
            p1 = 0.5  # Baseline
            p2 = p1 + scenario['effect_size']
            p_bar = (p1 + p2) / 2
            
            n = ((z_alpha * np.sqrt(2 * p_bar * (1 - p_bar)) + 
                  z_beta * np.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2) / (p1 - p2) ** 2
            
            required_n = int(np.ceil(n))
            scenario['required_n'] = required_n
            
            # Verify we don't make claims with insufficient data
            assert required_n > 30, f"Need at least 30 samples for {scenario['effect_size']} effect"
            
            if scenario['effect_size'] == 0.1:
                assert required_n > 300, "Small effects need large samples"
    
    @pytest.mark.critical
    def test_multiple_testing_correction(self):
        """Test Bonferroni correction for multiple hypothesis testing"""
        # When testing many templates, need to adjust for multiple comparisons
        num_templates = 100
        raw_p_values = np.random.uniform(0, 0.1, num_templates)  # Some significant
        
        # Apply Bonferroni correction
        alpha = 0.05
        corrected_alpha = alpha / num_templates
        
        # Count significant results
        significant_raw = sum(p < alpha for p in raw_p_values)
        significant_corrected = sum(p < corrected_alpha for p in raw_p_values)
        
        # Correction should reduce false positives
        assert significant_corrected < significant_raw, "Correction should be more conservative"
        assert corrected_alpha < alpha, "Corrected threshold should be stricter"
        
        # Alternative: Benjamini-Hochberg for FDR control
        sorted_p = sorted(raw_p_values)
        bh_threshold = [(i+1) * alpha / num_templates for i in range(num_templates)]
        
        # Find largest i where P(i) <= threshold(i)
        significant_bh = 0
        for i in range(num_templates-1, -1, -1):
            if sorted_p[i] <= bh_threshold[i]:
                significant_bh = i + 1
                break
        
        # BH should be less conservative than Bonferroni but control FDR
        assert significant_bh >= significant_corrected, "BH should be less conservative"
    
    @pytest.mark.critical
    def test_correlation_vs_causation_distinction(self):
        """Test that we properly distinguish correlation from causation"""
        # Create scenarios with different evidence levels
        scenarios = [
            {
                'name': 'Direct Citation',
                'evidence': {
                    'verbatim_match': True,
                    'temporal_precedence': True,
                    'dose_response': True,
                    'consistency': True
                },
                'expected_classification': 'causal'
            },
            {
                'name': 'Strong Correlation',
                'evidence': {
                    'verbatim_match': False,
                    'temporal_precedence': True,
                    'dose_response': True,
                    'consistency': True
                },
                'expected_classification': 'strong_correlation'
            },
            {
                'name': 'Weak Correlation',
                'evidence': {
                    'verbatim_match': False,
                    'temporal_precedence': True,
                    'dose_response': False,
                    'consistency': False
                },
                'expected_classification': 'weak_correlation'
            },
            {
                'name': 'Spurious',
                'evidence': {
                    'verbatim_match': False,
                    'temporal_precedence': False,
                    'dose_response': False,
                    'consistency': False
                },
                'expected_classification': 'spurious'
            }
        ]
        
        for scenario in scenarios:
            # Calculate evidence score
            evidence_score = sum(scenario['evidence'].values()) / len(scenario['evidence'])
            
            # Classify based on evidence
            if scenario['evidence']['verbatim_match']:
                classification = 'causal'
            elif evidence_score >= 0.75:
                classification = 'strong_correlation'
            elif evidence_score >= 0.5:
                classification = 'weak_correlation'
            else:
                classification = 'spurious'
            
            assert classification == scenario['expected_classification'], \
                f"Misclassified {scenario['name']}: got {classification}"
    
    @pytest.mark.critical
    def test_bayesian_updating(self):
        """Test Bayesian updating of causation beliefs"""
        # Prior belief about template effectiveness
        prior_success = 10
        prior_failure = 10
        prior_prob = prior_success / (prior_success + prior_failure)
        
        # New evidence: 8 successes, 2 failures
        new_success = 8
        new_failure = 2
        
        # Bayesian update using Beta distribution
        posterior_success = prior_success + new_success
        posterior_failure = prior_failure + new_failure
        posterior_prob = posterior_success / (posterior_success + posterior_failure)
        
        # Posterior should incorporate both prior and evidence
        assert posterior_prob > prior_prob, "Positive evidence should increase belief"
        assert 0 < posterior_prob < 1, "Probability must be valid"
        
        # Calculate credible interval (Bayesian equivalent of CI)
        alpha = posterior_success
        beta = posterior_failure
        credible_lower = stats.beta.ppf(0.025, alpha, beta)
        credible_upper = stats.beta.ppf(0.975, alpha, beta)
        
        assert credible_lower < posterior_prob < credible_upper, "Mean within credible interval"
        
        # More evidence should narrow the interval
        initial_width = 1.0  # Uniform prior
        current_width = credible_upper - credible_lower
        assert current_width < initial_width, "Evidence should reduce uncertainty"
    
    @pytest.mark.critical
    def test_effect_size_reporting(self):
        """Test that effect sizes are properly calculated and reported"""
        # Different effect size measures for different scenarios
        
        # 1. Cohen's d for continuous outcomes
        control_mean = 50
        control_std = 10
        treatment_mean = 55
        treatment_std = 10
        
        cohens_d = (treatment_mean - control_mean) / np.sqrt((control_std**2 + treatment_std**2) / 2)
        
        # Interpret effect size
        if abs(cohens_d) < 0.2:
            effect_interpretation = 'negligible'
        elif abs(cohens_d) < 0.5:
            effect_interpretation = 'small'
        elif abs(cohens_d) < 0.8:
            effect_interpretation = 'medium'
        else:
            effect_interpretation = 'large'
        
        assert cohens_d > 0, "Treatment should show positive effect"
        assert effect_interpretation in ['small', 'medium'], f"Effect size {cohens_d:.2f} reasonable"
        
        # 2. Odds ratio for binary outcomes
        treatment_success = 60
        treatment_total = 100
        control_success = 40
        control_total = 100
        
        odds_treatment = treatment_success / (treatment_total - treatment_success)
        odds_control = control_success / (control_total - control_success)
        odds_ratio = odds_treatment / odds_control
        
        # Log odds ratio for symmetry
        log_odds_ratio = np.log(odds_ratio)
        se_log_or = np.sqrt(1/treatment_success + 1/(treatment_total-treatment_success) + 
                            1/control_success + 1/(control_total-control_success))
        
        # Confidence interval for odds ratio
        ci_lower = np.exp(log_odds_ratio - 1.96 * se_log_or)
        ci_upper = np.exp(log_odds_ratio + 1.96 * se_log_or)
        
        assert ci_lower > 1, "Should show positive effect"
        assert odds_ratio > 1, "Treatment should improve odds"
    
    @pytest.mark.critical
    def test_temporal_precedence(self):
        """Test that cause precedes effect in time"""
        # Timeline of events
        events = [
            {'time': 0, 'event': 'template_created'},
            {'time': 1, 'event': 'campaign_launched'},
            {'time': 3, 'event': 'messages_sent'},
            {'time': 5, 'event': 'speech_delivered'},
            {'time': 7, 'event': 'position_changed'}
        ]
        
        # Check temporal ordering
        for i in range(len(events) - 1):
            cause = events[i]
            effect = events[i + 1]
            
            assert cause['time'] < effect['time'], \
                f"{cause['event']} must precede {effect['event']}"
        
        # Calculate lag times
        template_to_change = events[-1]['time'] - events[0]['time']
        message_to_change = events[-1]['time'] - events[2]['time']
        
        # Realistic time windows
        assert template_to_change > 1, "Change shouldn't be immediate"
        assert template_to_change < 30, "Change shouldn't take too long"
        assert message_to_change > 0, "Effect must follow cause"