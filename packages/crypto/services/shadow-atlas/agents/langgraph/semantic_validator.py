#!/usr/bin/env python3
"""
Advanced NLP Semantic Validation for Council District Training Data
Uses contextual semantic analysis to validate LLM and field-based classifications
"""

import json
import re
from typing import Dict, List, Tuple, Optional
from collections import defaultdict
from dataclasses import dataclass
import sys

@dataclass
class SemanticAnalysis:
    """Results of semantic analysis on a dataset title"""
    is_council: bool
    confidence: int  # 0-100
    reasoning: str
    patterns_matched: List[str]
    red_flags: List[str]

class CouncilDistrictSemanticAnalyzer:
    """Advanced semantic analysis for council district dataset identification"""

    def __init__(self):
        # Strong positive patterns (IS council district)
        self.positive_patterns = {
            'primary_council': [
                r'\bcouncil\s+district',
                r'\bcity\s+council',
                r'\bward\s+boundaries',
                r'\baldermanic\s+district',
                r'\bcouncil\s+boundaries',
                r'\bcouncilmanic\s+district',
                r'\bmunicip.*council.*district',
            ],
            'official_indicators': [
                r'\bcurrent.*council.*district',
                r'\badopted.*council.*district',
                r'\bofficial.*council.*district',
                r'\b20\d{2}.*council.*district',
                r'\bcouncil.*district.*20\d{2}',
            ],
            'ward_patterns': [
                r'\bward\s+\d+',
                r'\bwards?\s+boundaries',
                r'\bcity\s+wards?',
            ],
            'aldermanic_patterns': [
                r'\balderman',
                r'\balder\b',
            ],
        }

        # Strong negative patterns (NOT council district)
        self.negative_patterns = {
            'other_districts': [
                r'\bfire\s+district',
                r'\bschool\s+district',
                r'\bcensus\s+tract',
                r'\bcongressional\s+district',
                r'\bstate\s+senate',
                r'\bstate\s+house',
                r'\blegislative\s+district',
                r'\bplanning\s+district',
                r'\bneighborhood\s+district',
                r'\bpolice\s+district',
                r'\butility\s+district',
                r'\bwater\s+district',
                r'\bpark\s+district',
            ],
            'data_about_districts': [
                r'\bby\s+(.*?\s+)?council\s+district',  # "by Atlanta City Council District"
                r'\bper\s+district',
                r'\bwithin\s+districts?',
                r'\bin\s+(.*?\s+)?council\s+district',  # "in Penrith City Council"
                r'\bfor\s+(.*?\s+)?council\s+district',  # "for Los Angeles City Council District"
                r'\bat\s+(.*?\s+)?council',  # "at Hamilton City Council"
                r'\bfrom\s+(.*?\s+)?council',
                r'\bdata.*council.*district',
                r'\bstudy.*council.*district',
                r'\bsurvey.*council',  # "Travel Survey...City Council"
            ],
            'data_topics': [
                # These indicate the dataset is ABOUT a topic, not boundaries
                r'\bcrime\b',
                r'\bhousing\b',
                r'\bvehicle\b',
                r'\btransport',
                r'\btravel\b',
                r'\bchildcare\b',
                r'\bwastewater\b',
                r'\bzoning\b',
                r'\bsuitable\s+sites\b',
                r'\bcomments\b',
                r'\bspeakers?\b',
                r'\btenure\b',
                r'\bavailability\b',
            ],
            'state_level': [
                r'\bgovernor.*council',
                r'\bexecutive\s+council',
                r'\bstate.*council\b(?!.*district)',
            ],
            'non_governance': [
                r'\bcommunity\s+council\b(?!.*district)',
                r'\bneighborhood\s+council\b(?!.*district)',
                r'\badvisory\s+council',
            ],
            'analysis_datasets': [
                r'\banalysis\s+of\b',
                r'\bstudy\s+of\b',
                r'\bassessment\s+of\b',
                r'\breport\s+on\b',
            ],
            'form_surveys': [
                r'_form\b',
                r'_survey\b',
                r'\bsurvey\s+form\b',
            ],
        }

        # Contextual disambiguation patterns
        self.context_patterns = {
            'single_district_data': r'\bcouncil\s+district\s+\d+\b',  # Could be boundaries or data
            'aggregated_data': r'\b(total|sum|count|average|median).*\bdistrict',
            'year_suffix': r'\bdistrict.*20\d{2}\b',  # Likely redistricting
            'boundaries_explicit': r'\b(boundaries|boundary|border|polygon)\b',
        }

    def analyze(self, title: str, fields: List[str], description: str) -> SemanticAnalysis:
        """
        Perform semantic analysis on dataset title, fields, and description

        Returns:
            SemanticAnalysis with classification, confidence, and reasoning
        """
        title_lower = title.lower()
        fields_text = ' '.join(fields).lower()
        desc_lower = description.lower()
        combined = f"{title_lower} {fields_text} {desc_lower}"

        positive_signals = []
        negative_signals = []
        confidence_score = 50  # Start neutral

        # Check positive patterns
        for category, patterns in self.positive_patterns.items():
            for pattern in patterns:
                if re.search(pattern, title_lower, re.IGNORECASE):
                    positive_signals.append(f"Positive:{category}:{pattern}")

                    # Weight by category
                    if category == 'primary_council':
                        confidence_score += 20
                    elif category == 'official_indicators':
                        confidence_score += 10
                    elif category in ['ward_patterns', 'aldermanic_patterns']:
                        confidence_score += 15

        # Check negative patterns
        for category, patterns in self.negative_patterns.items():
            for pattern in patterns:
                if re.search(pattern, title_lower, re.IGNORECASE):
                    negative_signals.append(f"Negative:{category}:{pattern}")

                    # Weight by category
                    if category == 'other_districts':
                        confidence_score -= 25
                    elif category == 'data_about_districts':
                        confidence_score -= 30  # Strong signal this is data ABOUT districts
                    elif category == 'data_topics':
                        confidence_score -= 25  # Topic-specific datasets are not boundaries
                    elif category in ['state_level', 'non_governance']:
                        confidence_score -= 15
                    elif category == 'analysis_datasets':
                        confidence_score -= 10
                    elif category == 'form_surveys':
                        confidence_score -= 20  # Forms/surveys are not boundaries

        # Contextual disambiguation
        context_signals = []

        # CRITICAL: Check if "council district" appears with a data topic
        # Pattern: "Crime in Council District 8" or "Housing by Council District"
        has_council_district = re.search(r'\bcouncil\s+district', title_lower)
        has_data_topic = any(re.search(pattern, title_lower) for pattern in self.negative_patterns['data_topics'])

        if has_council_district and has_data_topic:
            context_signals.append("Context:council_district_WITH_topic_data")
            confidence_score -= 40  # Very strong signal this is NOT boundaries

        # Single district number (ambiguous)
        if re.search(self.context_patterns['single_district_data'], title_lower):
            # Check if it's boundaries or data
            if re.search(self.context_patterns['boundaries_explicit'], combined):
                context_signals.append("Context:single_district_boundaries")
                confidence_score += 5
            else:
                context_signals.append("Context:single_district_data_uncertain")
                confidence_score -= 5

        # Aggregated data indicators (NOT boundaries)
        if re.search(self.context_patterns['aggregated_data'], title_lower):
            context_signals.append("Context:aggregated_data")
            confidence_score -= 15

        # Year suffix (likely redistricting cycle)
        if re.search(self.context_patterns['year_suffix'], title_lower):
            context_signals.append("Context:year_suffix_redistricting")
            confidence_score += 10

        # Field-based signals
        field_signals = self._analyze_fields(fields)
        for signal, weight in field_signals:
            context_signals.append(f"Field:{signal}")
            confidence_score += weight

        # Clamp confidence to 0-100
        confidence_score = max(0, min(100, confidence_score))

        # Determine classification
        is_council = confidence_score >= 60  # Threshold for positive classification

        # Build reasoning
        reasoning_parts = []
        if positive_signals:
            reasoning_parts.append(f"Positive signals: {', '.join(positive_signals[:3])}")
        if negative_signals:
            reasoning_parts.append(f"Negative signals: {', '.join(negative_signals[:3])}")
        if context_signals:
            reasoning_parts.append(f"Context: {', '.join(context_signals[:3])}")

        reasoning = '; '.join(reasoning_parts) if reasoning_parts else "No strong signals detected"

        return SemanticAnalysis(
            is_council=is_council,
            confidence=confidence_score,
            reasoning=reasoning,
            patterns_matched=positive_signals + context_signals,
            red_flags=negative_signals
        )

    def _analyze_fields(self, fields: List[str]) -> List[Tuple[str, int]]:
        """
        Analyze field names for semantic signals

        Returns:
            List of (signal_name, confidence_weight) tuples
        """
        signals = []
        fields_text = ' '.join(fields).lower()

        # Positive field indicators
        if any(f in fields_text for f in ['district', 'ward', 'alderman', 'council']):
            if 'district_n' in fields_text or 'district_number' in fields_text:
                signals.append(('district_number_field', 10))
            if 'ward' in fields_text:
                signals.append(('ward_field', 10))
            if 'alderman' in fields_text or 'councilmember' in fields_text:
                signals.append(('representative_field', 15))

        # Negative field indicators
        if any(f in fields_text for f in ['population', 'demographic', 'census', 'income']):
            signals.append(('demographic_field', -10))
        if any(f in fields_text for f in ['fire', 'school', 'utility', 'water']):
            signals.append(('other_service_field', -15))

        return signals

    def get_uncertain_threshold(self) -> int:
        """Confidence threshold below which classification is uncertain"""
        return 70  # Below 70 confidence = uncertain


def load_training_data(filepath: str) -> List[Dict]:
    """Load JSONL training data"""
    samples = []
    with open(filepath, 'r') as f:
        for line in f:
            if line.strip():
                samples.append(json.loads(line))
    return samples


def compare_classifications(
    samples: List[Dict],
    analyzer: CouncilDistrictSemanticAnalyzer
) -> Dict:
    """
    Compare semantic analysis with LLM and field-based classifications

    Returns:
        Dict with agreement statistics and disagreement cases
    """
    stats = {
        'total': len(samples),
        'semantic_vs_llm_agree': 0,
        'semantic_vs_field_agree': 0,
        'all_three_agree': 0,
        'all_three_disagree': 0,
        'semantic_confident_corrections': [],
        'triple_disagreements': [],
        'semantic_uncertain': [],
        'contamination_patterns': defaultdict(list),
    }

    for sample in samples:
        # Extract existing labels
        llm_label = sample.get('is_council_district')
        field_label = sample.get('field_based_is_council')

        # Perform semantic analysis
        semantic = analyzer.analyze(
            title=sample.get('title', ''),
            fields=sample.get('live_fields', []),
            description=sample.get('live_description', '')
        )

        # Track agreement
        llm_agree = (semantic.is_council == llm_label) if llm_label is not None else None
        field_agree = (semantic.is_council == field_label) if field_label is not None else None

        if llm_agree:
            stats['semantic_vs_llm_agree'] += 1
        if field_agree:
            stats['semantic_vs_field_agree'] += 1

        # All three agree
        if (llm_label is not None and field_label is not None and
            llm_label == field_label == semantic.is_council):
            stats['all_three_agree'] += 1

        # Triple disagreement
        if (llm_label is not None and field_label is not None and
            llm_label != field_label and llm_label != semantic.is_council and
            field_label != semantic.is_council):
            stats['all_three_disagree'] += 1
            stats['triple_disagreements'].append({
                'dataset_id': sample.get('dataset_id'),
                'title': sample.get('title'),
                'llm': llm_label,
                'field': field_label,
                'semantic': semantic.is_council,
                'semantic_confidence': semantic.confidence,
                'reasoning': semantic.reasoning,
            })

        # High-confidence semantic corrections
        if semantic.confidence >= analyzer.get_uncertain_threshold():
            if llm_agree is False:
                stats['semantic_confident_corrections'].append({
                    'dataset_id': sample.get('dataset_id'),
                    'title': sample.get('title'),
                    'llm_label': llm_label,
                    'semantic_label': semantic.is_council,
                    'confidence': semantic.confidence,
                    'reasoning': semantic.reasoning,
                })

        # Track uncertain cases
        if semantic.confidence < analyzer.get_uncertain_threshold():
            stats['semantic_uncertain'].append({
                'dataset_id': sample.get('dataset_id'),
                'title': sample.get('title'),
                'semantic_label': semantic.is_council,
                'confidence': semantic.confidence,
                'llm_label': llm_label,
                'field_label': field_label,
            })

        # Track contamination patterns (LLM wrong, semantic confident)
        if (llm_agree is False and semantic.confidence >= 80):
            # Identify what confused the LLM
            if semantic.red_flags:
                for flag in semantic.red_flags:
                    stats['contamination_patterns'][flag].append(sample.get('title'))

    return stats


def print_report(stats: Dict):
    """Print detailed validation report"""
    print("=" * 80)
    print("SEMANTIC VALIDATION REPORT")
    print("=" * 80)
    print(f"\nTotal samples: {stats['total']}")

    # Agreement statistics
    print("\n" + "=" * 80)
    print("AGREEMENT STATISTICS")
    print("=" * 80)

    if stats['total'] > 0:
        llm_agree_pct = (stats['semantic_vs_llm_agree'] / stats['total']) * 100
        field_agree_pct = (stats['semantic_vs_field_agree'] / stats['total']) * 100
        all_agree_pct = (stats['all_three_agree'] / stats['total']) * 100

        print(f"\nSemantic vs LLM agreement: {stats['semantic_vs_llm_agree']}/{stats['total']} ({llm_agree_pct:.1f}%)")
        print(f"Semantic vs Field agreement: {stats['semantic_vs_field_agree']}/{stats['total']} ({field_agree_pct:.1f}%)")
        print(f"All three methods agree: {stats['all_three_agree']}/{stats['total']} ({all_agree_pct:.1f}%)")
        print(f"Triple disagreements: {stats['all_three_disagree']}/{stats['total']}")

    # High-confidence corrections
    print("\n" + "=" * 80)
    print(f"HIGH-CONFIDENCE SEMANTIC CORRECTIONS (LLM likely wrong): {len(stats['semantic_confident_corrections'])}")
    print("=" * 80)

    for i, case in enumerate(stats['semantic_confident_corrections'][:10], 1):
        print(f"\n{i}. {case['title']}")
        print(f"   LLM: {case['llm_label']} → Semantic: {case['semantic_label']} (confidence: {case['confidence']}%)")
        print(f"   Reasoning: {case['reasoning'][:150]}")

    if len(stats['semantic_confident_corrections']) > 10:
        print(f"\n   ... and {len(stats['semantic_confident_corrections']) - 10} more")

    # Triple disagreements
    print("\n" + "=" * 80)
    print(f"TRIPLE DISAGREEMENTS (contamination risk): {len(stats['triple_disagreements'])}")
    print("=" * 80)

    for i, case in enumerate(stats['triple_disagreements'][:10], 1):
        print(f"\n{i}. {case['title']}")
        print(f"   LLM: {case['llm']} | Field: {case['field']} | Semantic: {case['semantic']} (conf: {case['semantic_confidence']}%)")
        print(f"   Reasoning: {case['reasoning'][:150]}")

    if len(stats['triple_disagreements']) > 10:
        print(f"\n   ... and {len(stats['triple_disagreements']) - 10} more")

    # Contamination patterns
    print("\n" + "=" * 80)
    print("CONTAMINATION PATTERNS (what confuses LLM)")
    print("=" * 80)

    sorted_patterns = sorted(
        stats['contamination_patterns'].items(),
        key=lambda x: len(x[1]),
        reverse=True
    )

    for pattern, examples in sorted_patterns[:10]:
        print(f"\n{pattern}: {len(examples)} cases")
        for example in examples[:3]:
            print(f"  - {example}")

    # Uncertain cases
    print("\n" + "=" * 80)
    print(f"UNCERTAIN CLASSIFICATIONS (confidence < 70%): {len(stats['semantic_uncertain'])}")
    print("=" * 80)

    for i, case in enumerate(stats['semantic_uncertain'][:10], 1):
        print(f"\n{i}. {case['title']}")
        print(f"   Semantic: {case['semantic_label']} (confidence: {case['confidence']}%)")
        print(f"   LLM: {case['llm_label']} | Field: {case['field_label']}")

    if len(stats['semantic_uncertain']) > 10:
        print(f"\n   ... and {len(stats['semantic_uncertain']) - 10} more")


def main():
    """Main execution"""
    data_path = '/Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas/agents/data/ml_training_data_enriched.jsonl'

    print("Loading training data...")
    samples = load_training_data(data_path)
    print(f"Loaded {len(samples)} samples")

    print("\nInitializing semantic analyzer...")
    analyzer = CouncilDistrictSemanticAnalyzer()

    print("\nPerforming semantic analysis on all samples...")
    stats = compare_classifications(samples, analyzer)

    print_report(stats)

    # Export detailed results
    output_path = '/Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas/agents/langgraph/semantic_validation_results.json'
    with open(output_path, 'w') as f:
        json.dump(stats, f, indent=2)
    print(f"\n\nDetailed results exported to: {output_path}")


if __name__ == '__main__':
    main()
