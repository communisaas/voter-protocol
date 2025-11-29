#!/usr/bin/env python3
"""
Statistical Data Quality Assurance for ML Training Dataset

Performs rigorous multi-method consensus validation to identify
contamination with mathematical confidence.
"""

import json
import sys
from pathlib import Path
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass, asdict
from collections import defaultdict, Counter

import numpy as np
import pandas as pd
from scipy import stats
from scipy.stats import chi2_contingency, fisher_exact
from sklearn.metrics import cohen_kappa_score, confusion_matrix
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA
from sklearn.cluster import DBSCAN
import warnings

warnings.filterwarnings('ignore')


def convert_to_native_types(obj):
    """Convert numpy/pandas types to native Python types for JSON serialization"""
    if isinstance(obj, (np.integer, np.int64)):
        return int(obj)
    elif isinstance(obj, (np.floating, np.float64)):
        return float(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif isinstance(obj, dict):
        return {key: convert_to_native_types(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [convert_to_native_types(item) for item in obj]
    elif isinstance(obj, tuple):
        return tuple(convert_to_native_types(item) for item in obj)
    return obj


@dataclass
class ValidationResult:
    """Single validation method's classification"""
    method: str
    is_council: Optional[bool]
    confidence: float
    reasoning: str


@dataclass
class SampleAnalysis:
    """Statistical analysis for a single sample"""
    dataset_id: str
    title: str
    llm_label: bool
    validations: List[ValidationResult]
    agreement_score: float
    consensus_label: Optional[bool]
    confidence_interval: Tuple[float, float]
    is_outlier: bool
    contamination_risk: str  # "LOW", "MEDIUM", "HIGH"
    recommended_action: str


class StatisticalValidator:
    """Multi-method consensus validation with rigorous statistical testing"""

    def __init__(self, data_path: str):
        self.data_path = Path(data_path)
        self.samples = []
        self.analyses = []

    def load_data(self) -> None:
        """Load enriched training data"""
        print(f"Loading data from {self.data_path}...")

        with open(self.data_path, 'r') as f:
            for line in f:
                if line.strip():
                    self.samples.append(json.loads(line))

        print(f"Loaded {len(self.samples)} samples")

    def extract_validations(self, sample: Dict) -> List[ValidationResult]:
        """Extract all validation classifications from enriched sample"""
        validations = []

        # 1. Original LLM classification
        validations.append(ValidationResult(
            method="llm_original",
            is_council=sample.get("is_council_district"),
            confidence=sample.get("confidence", 50) / 100.0,
            reasoning=sample.get("verification_status", "llm")
        ))

        # 2. Field-based classification (from enrichment)
        if sample.get("field_based_is_council") is not None:
            validations.append(ValidationResult(
                method="field_schema",
                is_council=sample["field_based_is_council"],
                confidence=sample.get("field_based_confidence", 50) / 100.0,
                reasoning=f"Based on {len(sample.get('fields', []))} fields"
            ))

        # 3. Title-based classification (heuristic)
        title_result = self._classify_by_title(sample.get("title", ""))
        if title_result[0] is not None:
            validations.append(ValidationResult(
                method="title_heuristic",
                is_council=title_result[0],
                confidence=title_result[1],
                reasoning=title_result[2]
            ))

        # 4. URL-based classification (heuristic)
        url_result = self._classify_by_url(sample.get("url", ""))
        if url_result[0] is not None:
            validations.append(ValidationResult(
                method="url_pattern",
                is_council=url_result[0],
                confidence=url_result[1],
                reasoning=url_result[2]
            ))

        # 5. Governance type classification
        gov_result = self._classify_by_governance(sample.get("governance_type", ""))
        if gov_result[0] is not None:
            validations.append(ValidationResult(
                method="governance_type",
                is_council=gov_result[0],
                confidence=gov_result[1],
                reasoning=gov_result[2]
            ))

        return validations

    def _classify_by_title(self, title: str) -> Tuple[Optional[bool], float, str]:
        """Classify based on title patterns"""
        if not title:
            return None, 0.0, "No title"

        title_lower = title.lower()

        # Strong positive signals
        council_patterns = [
            "council district", "ward", "city council", "council member",
            "councilmanic", "alderman", "aldermanic", "supervisorial"
        ]

        # Strong negative signals
        non_council_patterns = [
            "census", "tract", "block group", "zip", "postal",
            "school", "police", "fire", "park", "utility",
            "county", "congressional", "state house", "state senate",
            "precinct", "voting", "election"
        ]

        # Check positive patterns
        for pattern in council_patterns:
            if pattern in title_lower:
                return True, 0.85, f"Title contains '{pattern}'"

        # Check negative patterns
        for pattern in non_council_patterns:
            if pattern in title_lower:
                return False, 0.80, f"Title contains '{pattern}'"

        # Weak signal: year suffixes suggest redistricting
        import re
        if re.search(r'\b(20\d{2}|19\d{2})\b', title):
            year = int(re.search(r'\b(20\d{2}|19\d{2})\b', title).group())
            if year % 10 in [0, 1, 2, 3]:  # Redistricting years
                return True, 0.60, f"Year {year} suggests redistricting"

        return None, 0.5, "No clear title signal"

    def _classify_by_url(self, url: str) -> Tuple[Optional[bool], float, str]:
        """Classify based on URL patterns"""
        if not url:
            return None, 0.0, "No URL"

        url_lower = url.lower()

        # URL-specific patterns
        council_url_patterns = [
            "council", "ward", "district", "member"
        ]

        non_council_url_patterns = [
            "census", "tiger", "school", "police", "fire",
            "county", "congressional", "legislative"
        ]

        for pattern in council_url_patterns:
            if pattern in url_lower:
                return True, 0.70, f"URL contains '{pattern}'"

        for pattern in non_council_url_patterns:
            if pattern in url_lower:
                return False, 0.75, f"URL contains '{pattern}'"

        return None, 0.5, "No clear URL signal"

    def _classify_by_governance(self, governance_type: str) -> Tuple[Optional[bool], float, str]:
        """Classify based on governance type"""
        if not governance_type:
            return None, 0.0, "No governance type"

        gov_lower = governance_type.lower()

        # Council-specific governance types
        if gov_lower in ["district", "ward", "council"]:
            return True, 0.80, f"Governance type '{governance_type}'"

        # Non-council governance types
        if gov_lower in ["county", "state", "federal", "school", "special"]:
            return False, 0.85, f"Governance type '{governance_type}'"

        return None, 0.5, "Ambiguous governance type"

    def calculate_agreement(self, validations: List[ValidationResult]) -> Tuple[float, Optional[bool]]:
        """
        Calculate inter-method agreement and consensus label

        Returns:
            (agreement_score, consensus_label)
            agreement_score: 0.0-1.0, proportion of methods agreeing with consensus
            consensus_label: Most common label, or None if tie
        """
        if not validations:
            return 0.0, None

        # Weight by confidence
        weighted_votes = defaultdict(float)
        total_weight = 0.0

        for val in validations:
            if val.is_council is not None:
                weighted_votes[val.is_council] += val.confidence
                total_weight += val.confidence

        if total_weight == 0:
            return 0.0, None

        # Consensus is weighted majority
        if weighted_votes[True] > weighted_votes[False]:
            consensus = True
            agreement = weighted_votes[True] / total_weight
        elif weighted_votes[False] > weighted_votes[True]:
            consensus = False
            agreement = weighted_votes[False] / total_weight
        else:
            consensus = None
            agreement = 0.5

        return agreement, consensus

    def calculate_confidence_interval(self, validations: List[ValidationResult]) -> Tuple[float, float]:
        """Calculate confidence interval for consensus label using Wilson score"""
        if not validations:
            return (0.0, 1.0)

        # Count agreements (binary: agree with consensus or not)
        n = len(validations)
        agreement_score = self.calculate_agreement(validations)[0]
        successes = int(agreement_score * n)

        # Wilson score interval with 95% confidence
        z = 1.96  # 95% confidence

        if n == 0:
            return (0.0, 1.0)

        phat = successes / n
        denominator = 1 + z**2 / n
        center = (phat + z**2 / (2*n)) / denominator
        margin = z * np.sqrt(phat * (1 - phat) / n + z**2 / (4*n**2)) / denominator

        lower = max(0.0, center - margin)
        upper = min(1.0, center + margin)

        return (lower, upper)

    def analyze_sample(self, sample: Dict) -> SampleAnalysis:
        """Perform complete statistical analysis on single sample"""
        validations = self.extract_validations(sample)
        agreement_score, consensus_label = self.calculate_agreement(validations)
        confidence_interval = self.calculate_confidence_interval(validations)

        llm_label = sample.get("is_council_district")

        # Determine contamination risk
        if agreement_score >= 0.85:
            risk = "LOW"
        elif agreement_score >= 0.65:
            risk = "MEDIUM"
        else:
            risk = "HIGH"

        # Check if consensus disagrees with LLM
        label_mismatch = (consensus_label is not None and
                         llm_label is not None and
                         consensus_label != llm_label)

        # Recommend action
        if risk == "HIGH" or label_mismatch:
            action = "MANUAL_REVIEW"
        elif risk == "MEDIUM":
            action = "VERIFY"
        else:
            action = "ACCEPT"

        return SampleAnalysis(
            dataset_id=sample.get("dataset_id", "unknown"),
            title=sample.get("title", ""),
            llm_label=llm_label,
            validations=validations,
            agreement_score=agreement_score,
            consensus_label=consensus_label,
            confidence_interval=confidence_interval,
            is_outlier=False,  # Will be determined by cluster analysis
            contamination_risk=risk,
            recommended_action=action
        )

    def run_analysis(self) -> None:
        """Analyze all samples"""
        print("\nAnalyzing samples...")

        for sample in self.samples:
            analysis = self.analyze_sample(sample)
            self.analyses.append(analysis)

        print(f"Analyzed {len(self.analyses)} samples")

    def calculate_cohen_kappa(self) -> pd.DataFrame:
        """
        Calculate Cohen's Kappa between all pairs of validation methods

        Kappa interpretation:
        < 0.0: Poor agreement
        0.0-0.20: Slight agreement
        0.21-0.40: Fair agreement
        0.41-0.60: Moderate agreement
        0.61-0.80: Substantial agreement
        0.81-1.0: Almost perfect agreement
        """
        print("\nCalculating inter-method agreement (Cohen's Kappa)...")

        # Extract all validation methods
        all_methods = set()
        for analysis in self.analyses:
            for val in analysis.validations:
                all_methods.add(val.method)

        methods = sorted(all_methods)
        n_methods = len(methods)

        # Create agreement matrix
        kappa_matrix = np.full((n_methods, n_methods), np.nan)

        for i, method1 in enumerate(methods):
            for j, method2 in enumerate(methods):
                if i == j:
                    kappa_matrix[i, j] = 1.0
                    continue

                # Collect paired labels
                labels1 = []
                labels2 = []

                for analysis in self.analyses:
                    val1 = next((v for v in analysis.validations if v.method == method1), None)
                    val2 = next((v for v in analysis.validations if v.method == method2), None)

                    if val1 and val2 and val1.is_council is not None and val2.is_council is not None:
                        labels1.append(val1.is_council)
                        labels2.append(val2.is_council)

                if len(labels1) >= 2:
                    try:
                        kappa = cohen_kappa_score(labels1, labels2)
                        kappa_matrix[i, j] = kappa
                    except:
                        pass

        df = pd.DataFrame(kappa_matrix, index=methods, columns=methods)
        return df

    def test_label_quality(self) -> Dict:
        """
        Statistical hypothesis testing for label quality

        Tests:
        1. Chi-square test: Are TRUE/FALSE labels distributed as expected?
        2. Inter-rater reliability: Do methods agree more than random chance?
        3. Confidence distribution: Are confident samples more consistent?
        """
        print("\nPerforming statistical hypothesis tests...")

        results = {}

        # Test 1: Label distribution
        llm_labels = [a.llm_label for a in self.analyses if a.llm_label is not None]
        n_true = sum(llm_labels)
        n_false = len(llm_labels) - n_true

        # Expected: roughly balanced (50/50)
        expected = len(llm_labels) / 2
        chi2 = ((n_true - expected)**2 / expected +
                (n_false - expected)**2 / expected)
        p_value_balance = 1 - stats.chi2.cdf(chi2, df=1)

        results['label_distribution'] = {
            'n_true': n_true,
            'n_false': n_false,
            'chi2_statistic': chi2,
            'p_value': p_value_balance,
            'interpretation': 'Balanced' if p_value_balance > 0.05 else 'Imbalanced'
        }

        # Test 2: Agreement vs random chance
        agreement_scores = [a.agreement_score for a in self.analyses]

        # Null hypothesis: agreement = 0.5 (random)
        # Alternative: agreement > 0.5 (systematic)
        t_stat, p_value_agreement = stats.ttest_1samp(agreement_scores, 0.5)

        results['agreement_test'] = {
            'mean_agreement': np.mean(agreement_scores),
            'std_agreement': np.std(agreement_scores),
            't_statistic': t_stat,
            'p_value': p_value_agreement / 2,  # One-tailed
            'interpretation': 'Systematic' if p_value_agreement / 2 < 0.01 else 'Random'
        }

        # Test 3: Confidence vs consistency
        high_conf_samples = [a for a in self.analyses if a.agreement_score >= 0.75]
        low_conf_samples = [a for a in self.analyses if a.agreement_score < 0.75]

        if high_conf_samples and low_conf_samples:
            high_conf_agreements = [a.agreement_score for a in high_conf_samples]
            low_conf_agreements = [a.agreement_score for a in low_conf_samples]

            t_stat, p_value = stats.ttest_ind(high_conf_agreements, low_conf_agreements)

            results['confidence_consistency'] = {
                'high_conf_mean': np.mean(high_conf_agreements),
                'low_conf_mean': np.mean(low_conf_agreements),
                't_statistic': t_stat,
                'p_value': p_value,
                'interpretation': 'Significant' if p_value < 0.05 else 'Not significant'
            }

        return results

    def detect_outliers(self) -> None:
        """
        Detect outliers using clustering in feature space

        Features:
        - Agreement score
        - Number of validations
        - Confidence interval width
        - LLM confidence
        """
        print("\nDetecting outliers via clustering...")

        # Extract features
        features = []
        for analysis in self.analyses:
            sample = next(s for s in self.samples if s['dataset_id'] == analysis.dataset_id)

            feature_vector = [
                analysis.agreement_score,
                len(analysis.validations),
                analysis.confidence_interval[1] - analysis.confidence_interval[0],
                sample.get('confidence', 50) / 100.0,
                1.0 if analysis.consensus_label != analysis.llm_label else 0.0
            ]
            features.append(feature_vector)

        X = np.array(features)

        # Standardize
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        # DBSCAN clustering
        clustering = DBSCAN(eps=0.5, min_samples=5)
        labels = clustering.fit_predict(X_scaled)

        # Mark outliers (label = -1)
        for i, analysis in enumerate(self.analyses):
            analysis.is_outlier = (labels[i] == -1)

        n_outliers = sum(labels == -1)
        print(f"Identified {n_outliers} outliers ({n_outliers/len(self.analyses)*100:.1f}%)")

    def generate_report(self) -> Dict:
        """Generate comprehensive statistical report"""
        print("\n" + "="*80)
        print("STATISTICAL DATA QUALITY ASSURANCE REPORT")
        print("="*80)

        report = {}

        # 1. Dataset Overview
        print("\n1. DATASET OVERVIEW")
        print("-" * 80)

        n_samples = len(self.analyses)
        n_true = sum(1 for a in self.analyses if a.llm_label == True)
        n_false = sum(1 for a in self.analyses if a.llm_label == False)

        overview = {
            'total_samples': n_samples,
            'llm_true_labels': n_true,
            'llm_false_labels': n_false,
            'class_balance': f"{n_true/n_samples*100:.1f}% TRUE, {n_false/n_samples*100:.1f}% FALSE"
        }

        report['overview'] = overview

        print(f"Total samples: {n_samples}")
        print(f"LLM labels: {n_true} TRUE, {n_false} FALSE")
        print(f"Class balance: {overview['class_balance']}")

        # 2. Inter-Method Agreement
        print("\n2. INTER-METHOD AGREEMENT (Cohen's Kappa)")
        print("-" * 80)

        kappa_df = self.calculate_cohen_kappa()
        report['cohen_kappa'] = kappa_df.to_dict()

        print(kappa_df.round(3).to_string())

        # Average kappa (excluding diagonal)
        mask = ~np.eye(kappa_df.shape[0], dtype=bool)
        avg_kappa = kappa_df.values[mask].mean()
        print(f"\nAverage inter-method Kappa: {avg_kappa:.3f}")

        if avg_kappa > 0.6:
            print("Interpretation: SUBSTANTIAL agreement between methods")
        elif avg_kappa > 0.4:
            print("Interpretation: MODERATE agreement between methods")
        else:
            print("Interpretation: FAIR agreement between methods (CONCERN)")

        # 3. Statistical Hypothesis Tests
        print("\n3. STATISTICAL HYPOTHESIS TESTS")
        print("-" * 80)

        test_results = self.test_label_quality()
        report['hypothesis_tests'] = test_results

        for test_name, test_data in test_results.items():
            print(f"\n{test_name.upper().replace('_', ' ')}:")
            for key, value in test_data.items():
                if isinstance(value, float):
                    print(f"  {key}: {value:.4f}")
                else:
                    print(f"  {key}: {value}")

        # 4. Agreement Score Distribution
        print("\n4. AGREEMENT SCORE DISTRIBUTION")
        print("-" * 80)

        agreement_scores = [a.agreement_score for a in self.analyses]

        distribution = {
            'mean': np.mean(agreement_scores),
            'median': np.median(agreement_scores),
            'std': np.std(agreement_scores),
            'min': np.min(agreement_scores),
            'max': np.max(agreement_scores),
            'percentiles': {
                '25th': np.percentile(agreement_scores, 25),
                '50th': np.percentile(agreement_scores, 50),
                '75th': np.percentile(agreement_scores, 75),
                '90th': np.percentile(agreement_scores, 90)
            }
        }

        report['agreement_distribution'] = distribution

        print(f"Mean: {distribution['mean']:.3f}")
        print(f"Median: {distribution['median']:.3f}")
        print(f"Std Dev: {distribution['std']:.3f}")
        print(f"Range: [{distribution['min']:.3f}, {distribution['max']:.3f}]")
        print(f"\nPercentiles:")
        for pct, val in distribution['percentiles'].items():
            print(f"  {pct}: {val:.3f}")

        # 5. Contamination Analysis
        print("\n5. CONTAMINATION RISK ANALYSIS")
        print("-" * 80)

        risk_counts = Counter(a.contamination_risk for a in self.analyses)

        contamination = {
            'low_risk': risk_counts['LOW'],
            'medium_risk': risk_counts['MEDIUM'],
            'high_risk': risk_counts['HIGH'],
            'estimated_contamination_rate': risk_counts['HIGH'] / len(self.analyses),
            'confidence_interval_95': self._calculate_contamination_ci(risk_counts['HIGH'], len(self.analyses))
        }

        report['contamination'] = contamination

        print(f"LOW risk: {contamination['low_risk']} samples ({contamination['low_risk']/n_samples*100:.1f}%)")
        print(f"MEDIUM risk: {contamination['medium_risk']} samples ({contamination['medium_risk']/n_samples*100:.1f}%)")
        print(f"HIGH risk: {contamination['high_risk']} samples ({contamination['high_risk']/n_samples*100:.1f}%)")
        print(f"\nEstimated contamination rate: {contamination['estimated_contamination_rate']*100:.2f}%")
        print(f"95% CI: [{contamination['confidence_interval_95'][0]*100:.2f}%, {contamination['confidence_interval_95'][1]*100:.2f}%]")

        # 6. Outlier Analysis
        print("\n6. OUTLIER DETECTION")
        print("-" * 80)

        n_outliers = sum(a.is_outlier for a in self.analyses)
        outlier_data = {
            'n_outliers': n_outliers,
            'outlier_rate': n_outliers / len(self.analyses)
        }

        report['outliers'] = outlier_data

        print(f"Outliers detected: {n_outliers} ({n_outliers/n_samples*100:.1f}%)")

        # 7. Label Disagreements
        print("\n7. LLM vs CONSENSUS DISAGREEMENTS")
        print("-" * 80)

        disagreements = [a for a in self.analyses
                        if a.consensus_label is not None
                        and a.llm_label is not None
                        and a.consensus_label != a.llm_label]

        disagreement_data = {
            'n_disagreements': len(disagreements),
            'disagreement_rate': len(disagreements) / len(self.analyses)
        }

        report['disagreements'] = disagreement_data

        print(f"Disagreements: {len(disagreements)} ({len(disagreements)/n_samples*100:.1f}%)")

        # 8. Recommended Actions
        print("\n8. RECOMMENDED ACTIONS")
        print("-" * 80)

        action_counts = Counter(a.recommended_action for a in self.analyses)

        actions = {
            'accept': action_counts['ACCEPT'],
            'verify': action_counts['VERIFY'],
            'manual_review': action_counts['MANUAL_REVIEW']
        }

        report['recommended_actions'] = actions

        print(f"ACCEPT: {actions['accept']} samples ({actions['accept']/n_samples*100:.1f}%)")
        print(f"VERIFY: {actions['verify']} samples ({actions['verify']/n_samples*100:.1f}%)")
        print(f"MANUAL_REVIEW: {actions['manual_review']} samples ({actions['manual_review']/n_samples*100:.1f}%)")

        return report

    def _calculate_contamination_ci(self, n_contaminated: int, n_total: int) -> Tuple[float, float]:
        """Calculate 95% confidence interval for contamination rate using Wilson score"""
        if n_total == 0:
            return (0.0, 1.0)

        p = n_contaminated / n_total
        z = 1.96  # 95% confidence

        denominator = 1 + z**2 / n_total
        center = (p + z**2 / (2*n_total)) / denominator
        margin = z * np.sqrt(p * (1 - p) / n_total + z**2 / (4*n_total**2)) / denominator

        lower = max(0.0, center - margin)
        upper = min(1.0, center + margin)

        return (lower, upper)

    def export_results(self, output_dir: str) -> None:
        """Export detailed results for review"""
        output_path = Path(output_dir)
        output_path.mkdir(exist_ok=True)

        print(f"\nExporting results to {output_path}...")

        # 1. Per-sample analysis
        samples_output = []
        for analysis in sorted(self.analyses, key=lambda a: a.agreement_score):
            samples_output.append({
                'dataset_id': analysis.dataset_id,
                'title': analysis.title,
                'llm_label': bool(analysis.llm_label) if analysis.llm_label is not None else None,
                'consensus_label': bool(analysis.consensus_label) if analysis.consensus_label is not None else None,
                'agreement_score': float(analysis.agreement_score),
                'confidence_interval': [float(analysis.confidence_interval[0]), float(analysis.confidence_interval[1])],
                'contamination_risk': analysis.contamination_risk,
                'recommended_action': analysis.recommended_action,
                'is_outlier': bool(analysis.is_outlier),
                'validations': [
                    {
                        'method': v.method,
                        'is_council': bool(v.is_council) if v.is_council is not None else None,
                        'confidence': float(v.confidence),
                        'reasoning': v.reasoning
                    }
                    for v in analysis.validations
                ]
            })

        with open(output_path / 'sample_analysis.json', 'w') as f:
            json.dump(samples_output, f, indent=2)

        print(f"  - sample_analysis.json ({len(samples_output)} samples)")

        # 2. High-risk samples for manual review
        high_risk = [s for s in samples_output if s['contamination_risk'] == 'HIGH']

        with open(output_path / 'high_risk_samples.json', 'w') as f:
            json.dump(high_risk, f, indent=2)

        print(f"  - high_risk_samples.json ({len(high_risk)} samples)")

        # 3. Disagreements
        disagreements = [s for s in samples_output
                        if s['consensus_label'] is not None
                        and s['llm_label'] is not None
                        and s['consensus_label'] != s['llm_label']]

        with open(output_path / 'disagreements.json', 'w') as f:
            json.dump(disagreements, f, indent=2)

        print(f"  - disagreements.json ({len(disagreements)} samples)")

        # 4. Outliers
        outliers = [s for s in samples_output if s['is_outlier']]

        with open(output_path / 'outliers.json', 'w') as f:
            json.dump(outliers, f, indent=2)

        print(f"  - outliers.json ({len(outliers)} samples)")

        # 5. Summary report
        report = self.generate_report()

        with open(output_path / 'statistical_report.json', 'w') as f:
            json.dump(convert_to_native_types(report), f, indent=2)

        print(f"  - statistical_report.json")

        # 6. CSV for easy review
        df = pd.DataFrame([
            {
                'dataset_id': a.dataset_id,
                'title': a.title[:100],
                'llm_label': a.llm_label,
                'consensus_label': a.consensus_label,
                'agreement_score': a.agreement_score,
                'risk': a.contamination_risk,
                'action': a.recommended_action,
                'outlier': a.is_outlier
            }
            for a in sorted(self.analyses, key=lambda a: a.agreement_score)
        ])

        df.to_csv(output_path / 'sample_analysis.csv', index=False)
        print(f"  - sample_analysis.csv")


def main():
    """Main execution"""
    data_path = "/Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas/agents/data/ml_training_data_enriched.jsonl"
    output_dir = "/Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas/agents/langgraph/validation_results"

    validator = StatisticalValidator(data_path)

    # Run analysis pipeline
    validator.load_data()
    validator.run_analysis()
    validator.detect_outliers()

    # Generate report
    report = validator.generate_report()

    # Export results
    validator.export_results(output_dir)

    print("\n" + "="*80)
    print("ANALYSIS COMPLETE")
    print("="*80)
    print(f"\nResults exported to: {output_dir}")
    print("\nNext steps:")
    print("  1. Review high_risk_samples.json for manual verification")
    print("  2. Investigate disagreements.json for systematic errors")
    print("  3. Check outliers.json for anomalous samples")
    print("  4. Use sample_analysis.csv for quick triage")


if __name__ == "__main__":
    main()
