#!/usr/bin/env python3
"""
Data Quality Forensics: Final Contamination Detection
Exhaustive cross-validation analysis to find last traces of contamination.
"""

import json
import pandas as pd
from pathlib import Path
from typing import Dict, List, Tuple, Any, Optional
from collections import defaultdict, Counter
import re

class ContaminationForensics:
    """Forensic analyzer for dataset contamination detection."""

    def __init__(self, base_dir: Path):
        self.base_dir = base_dir
        self.data_dir = base_dir.parent / "data"
        self.validation_results = {}
        self.dataset = None

        # Contamination patterns
        self.false_positive_patterns = {
            'demographic_by_district': [
                r'population.*by.*district',
                r'census.*by.*district',
                r'demographics.*by.*district',
                r'income.*by.*district',
                r'housing.*by.*district'
            ],
            'services_by_district': [
                r'services.*by.*district',
                r'programs.*by.*district',
                r'assistance.*by.*district',
                r'benefits.*by.*district'
            ],
            'infrastructure_by_district': [
                r'streets.*by.*district',
                r'parcels.*by.*district',
                r'buildings.*by.*district',
                r'addresses.*by.*district',
                r'address.*points.*by.*district'
            ],
            'analysis_layers': [
                r'analysis.*by.*district',
                r'study.*by.*district',
                r'report.*by.*district',
                r'dashboard.*by.*district',
                r'crime.*analysis.*district'
            ]
        }

        self.explicit_disqualifiers = [
            r'\bcensus\s+tract\b',
            r'\bschool\s+district\b',
            r'\bfire\s+district\b',
            r'\bpolice\s+district\b',
            r'\bneighborhood\b',
            r'\bprecinct\b',
            r'\bparcel',
            r'\bblock\s+group\b',
            r'\bzip\s+code\b'
        ]

    def load_all_validation_results(self) -> None:
        """Load all validation outputs from 5 agents."""
        print("🔍 Loading validation results from all agents...")

        # 1. Field schema validation
        field_val = self.base_dir / "validation_results.json"
        if field_val.exists():
            with open(field_val) as f:
                self.validation_results['field_schema'] = json.load(f)
            print(f"  ✓ Field schema validation: {len(self.validation_results['field_schema'])} samples")

        # 2. Semantic NLP validation
        semantic_val = self.base_dir / "semantic_validation_v2_results.json"
        if semantic_val.exists():
            with open(semantic_val) as f:
                self.validation_results['semantic_nlp'] = json.load(f)
            print(f"  ✓ Semantic NLP validation: {len(self.validation_results['semantic_nlp'])} samples")

        # 3. URL pattern validation
        url_val = self.base_dir / "url_validation_details.jsonl"
        if url_val.exists():
            url_data = []
            with open(url_val) as f:
                for line in f:
                    url_data.append(json.loads(line))
            self.validation_results['url_pattern'] = url_data
            print(f"  ✓ URL pattern validation: {len(url_data)} samples")

        # 4. Statistical validation
        stats_dir = self.base_dir / "validation_results"
        if stats_dir.exists():
            sample_analysis = stats_dir / "sample_analysis.json"
            if sample_analysis.exists():
                with open(sample_analysis) as f:
                    self.validation_results['statistical'] = json.load(f)
                print(f"  ✓ Statistical validation: {len(self.validation_results['statistical'])} samples")

        # 5. Governance domain validation
        gov_val = self.base_dir / "governance_domain_validation_report.json"
        if gov_val.exists():
            with open(gov_val) as f:
                self.validation_results['governance_domain'] = json.load(f)
            print(f"  ✓ Governance domain validation loaded")

        # Load main dataset
        dataset_path = self.data_dir / "ml_training_data_domain_corrected.jsonl"
        if dataset_path.exists():
            samples = []
            with open(dataset_path) as f:
                for line in f:
                    samples.append(json.loads(line))
            self.dataset = pd.DataFrame(samples)
            print(f"  ✓ Main dataset: {len(self.dataset)} samples")

        print(f"\n📊 Loaded {len(self.validation_results)} validation sources")

    def build_consensus_matrix(self) -> pd.DataFrame:
        """Build cross-validation consensus matrix for all samples."""
        print("\n🧮 Building consensus matrix...")

        if self.dataset is None:
            raise ValueError("Dataset not loaded")

        consensus_data = []

        for idx, row in self.dataset.iterrows():
            sample_id = row.get('dataset_id', row.get('id', idx))
            title = row.get('title', '')
            current_label = row.get('is_council_district', row.get('label'))

            verdicts = {}
            confidences = {}

            # Field schema verdict
            if 'field_schema' in self.validation_results:
                field_data = self.validation_results['field_schema'].get(str(sample_id), {})
                verdicts['field_schema'] = field_data.get('predicted_label')
                confidences['field_schema'] = field_data.get('confidence', 0)

            # Semantic NLP verdict
            if 'semantic_nlp' in self.validation_results:
                semantic_data = self.validation_results['semantic_nlp'].get(str(sample_id), {})
                verdicts['semantic_nlp'] = semantic_data.get('predicted_label')
                confidences['semantic_nlp'] = semantic_data.get('confidence', 0)

            # URL pattern verdict
            if 'url_pattern' in self.validation_results:
                url_sample = next((s for s in self.validation_results['url_pattern']
                                 if s.get('id') == sample_id), None)
                if url_sample:
                    verdicts['url_pattern'] = url_sample.get('predicted_label')
                    confidences['url_pattern'] = url_sample.get('confidence', 0)

            # Statistical verdict
            if 'statistical' in self.validation_results:
                # Statistical validation is a list, need to find by dataset_id
                stats_data = None
                if isinstance(self.validation_results['statistical'], list):
                    stats_data = next((s for s in self.validation_results['statistical']
                                     if s.get('dataset_id') == sample_id), None)
                else:
                    stats_data = self.validation_results['statistical'].get(str(sample_id), {})

                if stats_data:
                    # Use consensus_label if available, otherwise llm_label
                    verdicts['statistical'] = stats_data.get('consensus_label', stats_data.get('llm_label'))
                    # Use average confidence from validations if available
                    if 'validations' in stats_data:
                        avg_conf = sum(v.get('confidence', 0) for v in stats_data['validations']) / len(stats_data['validations'])
                        confidences['statistical'] = avg_conf * 100
                    else:
                        confidences['statistical'] = (1 - stats_data.get('agreement_score', 0)) * 100

            # Governance domain verdict
            if 'governance_domain' in self.validation_results:
                gov_data = self.validation_results['governance_domain']
                if 'sample_validations' in gov_data:
                    gov_sample = next((s for s in gov_data['sample_validations']
                                     if s.get('id') == sample_id), None)
                    if gov_sample:
                        verdicts['governance_domain'] = gov_sample.get('predicted_label')
                        confidences['governance_domain'] = gov_sample.get('confidence', 0)

            # Calculate consensus
            valid_verdicts = [v for v in verdicts.values() if v is not None]
            if valid_verdicts:
                consensus_count = Counter(valid_verdicts)
                majority_vote = consensus_count.most_common(1)[0][0]
                consensus_score = consensus_count[majority_vote] / len(valid_verdicts) * 100
            else:
                majority_vote = None
                consensus_score = 0

            # Check for contradictions
            label_mismatch = (majority_vote is not None and
                            majority_vote != current_label)

            consensus_data.append({
                'id': sample_id,
                'title': title,
                'current_label': current_label,
                'majority_vote': majority_vote,
                'consensus_score': consensus_score,
                'num_validators': len(valid_verdicts),
                'label_mismatch': label_mismatch,
                **{f'verdict_{k}': v for k, v in verdicts.items()},
                **{f'confidence_{k}': c for k, c in confidences.items()}
            })

        consensus_df = pd.DataFrame(consensus_data)
        print(f"  ✓ Consensus matrix built: {len(consensus_df)} samples")
        print(f"  ✓ Samples with <80% consensus: {len(consensus_df[consensus_df['consensus_score'] < 80])}")
        print(f"  ✓ Samples with label mismatch: {len(consensus_df[consensus_df['label_mismatch']])}")

        return consensus_df

    def detect_false_positive_patterns(self, sample: Dict[str, Any]) -> Tuple[bool, str]:
        """Detect false positive patterns (labeled TRUE, should be FALSE)."""
        title = sample.get('title', '').lower()
        description = sample.get('description', '').lower()
        combined_text = f"{title} {description}"

        # Check demographic data BY district
        for pattern_name, patterns in self.false_positive_patterns.items():
            for pattern in patterns:
                if re.search(pattern, combined_text, re.IGNORECASE):
                    return True, f"False positive: {pattern_name} pattern '{pattern}'"

        # Check explicit disqualifiers
        for pattern in self.explicit_disqualifiers:
            if re.search(pattern, combined_text, re.IGNORECASE):
                return True, f"Explicit disqualifier: '{pattern}'"

        return False, ""

    def detect_false_negative_patterns(self, sample: Dict[str, Any]) -> Tuple[bool, str]:
        """Detect false negative patterns (labeled FALSE, should be TRUE)."""
        url = sample.get('url', '').lower()
        title = sample.get('title', '').lower()

        # Clear council/ward/district in URL service name
        url_indicators = ['council', 'ward', 'district', 'electoral']
        url_has_indicator = any(ind in url for ind in url_indicators)

        # International equivalents
        international_terms = [
            'electoral division', 'local board', 'municipal ward',
            'county council', 'regional council', 'metropolitan council'
        ]
        has_international = any(term in title for term in international_terms)

        if url_has_indicator or has_international:
            return True, "Potential false negative: council/ward indicators present"

        return False, ""

    def detect_edge_cases(self, sample: Dict[str, Any]) -> Tuple[bool, str]:
        """Detect ambiguous edge cases."""
        title = sample.get('title', '').lower()
        feature_count = sample.get('live_feature_count', sample.get('feature_count', 0))

        edge_cases = []

        # Forms/surveys ABOUT districts
        if any(word in title for word in ['form', 'survey', 'questionnaire']):
            edge_cases.append("Form/survey about districts")

        # Crosswalk tables
        if 'crosswalk' in title or 'mapping' in title:
            edge_cases.append("Crosswalk/mapping table")

        # Single district extracts
        if re.search(r'district\s+\d+\b', title) or re.search(r'\bdistrict\s+[a-z]\b', title):
            edge_cases.append("Single district extract")

        # Named districts
        if re.search(r'\b[A-Z][a-z]+\s+[A-Z][a-z]+.*district', title):
            edge_cases.append("Named district (person name)")

        # Feature count extremes
        if feature_count is not None and feature_count > 0:
            if feature_count < 5:
                edge_cases.append(f"Suspiciously low feature count: {feature_count}")
            elif feature_count > 100:
                edge_cases.append(f"Suspiciously high feature count: {feature_count}")

        if edge_cases:
            return True, "; ".join(edge_cases)

        return False, ""

    def tier_contamination(self, consensus_df: pd.DataFrame) -> Dict[str, List[Dict]]:
        """Tier samples by contamination risk."""
        print("\n🎯 Tiering contamination risk...")

        tiers = {
            'tier_0_certain': [],
            'tier_1_probable': [],
            'tier_2_possible': [],
            'tier_3_clean': []
        }

        for idx, row in consensus_df.iterrows():
            sample_id = row['id']

            # Get full sample data
            sample_match = self.dataset[self.dataset['dataset_id'] == sample_id]
            if len(sample_match) == 0:
                # Fallback to index-based lookup
                sample_match = self.dataset.iloc[[idx]]
            sample_data = sample_match.iloc[0].to_dict()

            # Collect evidence
            evidence = []

            # Pattern checks
            is_false_pos, fp_reason = self.detect_false_positive_patterns(sample_data)
            if is_false_pos:
                evidence.append(f"FALSE_POSITIVE: {fp_reason}")

            is_false_neg, fn_reason = self.detect_false_negative_patterns(sample_data)
            if is_false_neg:
                evidence.append(f"FALSE_NEGATIVE: {fn_reason}")

            is_edge, edge_reason = self.detect_edge_cases(sample_data)
            if is_edge:
                evidence.append(f"EDGE_CASE: {edge_reason}")

            # Consensus checks
            consensus_score = row['consensus_score']
            label_mismatch = row['label_mismatch']
            num_validators = row['num_validators']

            # Count high-confidence disagreements
            high_conf_disagreements = 0
            verdicts = {}
            for method in ['field_schema', 'semantic_nlp', 'url_pattern', 'statistical', 'governance_domain']:
                verdict_col = f'verdict_{method}'
                conf_col = f'confidence_{method}'
                if verdict_col in row and conf_col in row:
                    if pd.notna(row[verdict_col]) and pd.notna(row[conf_col]):
                        verdicts[method] = (row[verdict_col], row[conf_col])
                        if row[conf_col] >= 90 and row[verdict_col] != row['current_label']:
                            high_conf_disagreements += 1

            # Triple disagreement check
            triple_disagreement = len(set(v[0] for v in verdicts.values())) >= 3

            # Build sample report
            sample_report = {
                'id': sample_id,
                'title': row['title'],
                'current_label': row['current_label'],
                'majority_vote': row['majority_vote'],
                'consensus_score': consensus_score,
                'num_validators': num_validators,
                'label_mismatch': label_mismatch,
                'verdicts': verdicts,
                'evidence': evidence,
                'feature_count': sample_data.get('live_feature_count', sample_data.get('feature_count', 0)) or 0
            }

            # TIER 0: Certain contamination
            if (is_false_pos and row['current_label'] == True) or \
               (is_false_neg and row['current_label'] == False) or \
               triple_disagreement or \
               (high_conf_disagreements >= 2):
                tiers['tier_0_certain'].append(sample_report)

            # TIER 1: Probable contamination
            elif label_mismatch or \
                 consensus_score < 80 or \
                 high_conf_disagreements >= 1 or \
                 (is_edge and consensus_score < 90):
                tiers['tier_1_probable'].append(sample_report)

            # TIER 2: Possible contamination
            elif consensus_score < 90 or \
                 is_edge or \
                 num_validators < 3:
                tiers['tier_2_possible'].append(sample_report)

            # TIER 3: Clean
            else:
                tiers['tier_3_clean'].append(sample_report)

        # Print tier summary
        print(f"\n📊 Contamination Tiers:")
        print(f"  🔴 TIER 0 (Certain):  {len(tiers['tier_0_certain'])} samples")
        print(f"  🟠 TIER 1 (Probable): {len(tiers['tier_1_probable'])} samples")
        print(f"  🟡 TIER 2 (Possible): {len(tiers['tier_2_possible'])} samples")
        print(f"  🟢 TIER 3 (Clean):    {len(tiers['tier_3_clean'])} samples")

        return tiers

    def generate_contamination_report(self, tiers: Dict[str, List[Dict]]) -> str:
        """Generate comprehensive contamination report."""
        print("\n📝 Generating forensic report...")

        report_lines = []
        report_lines.append("=" * 80)
        report_lines.append("DATA QUALITY FORENSICS: FINAL CONTAMINATION DETECTION")
        report_lines.append("=" * 80)
        report_lines.append("")

        # Executive Summary
        total_samples = sum(len(samples) for samples in tiers.values())
        contaminated_samples = len(tiers['tier_0_certain']) + len(tiers['tier_1_probable'])
        contamination_rate = (contaminated_samples / total_samples * 100) if total_samples > 0 else 0

        report_lines.append("EXECUTIVE SUMMARY")
        report_lines.append("-" * 80)
        report_lines.append(f"Total samples analyzed: {total_samples}")
        report_lines.append(f"Contaminated samples: {contaminated_samples} ({contamination_rate:.2f}%)")
        report_lines.append(f"  - TIER 0 (Certain):  {len(tiers['tier_0_certain'])}")
        report_lines.append(f"  - TIER 1 (Probable): {len(tiers['tier_1_probable'])}")
        report_lines.append(f"  - TIER 2 (Possible): {len(tiers['tier_2_possible'])}")
        report_lines.append(f"Clean samples (TIER 3): {len(tiers['tier_3_clean'])} ({len(tiers['tier_3_clean'])/total_samples*100:.2f}%)")
        report_lines.append("")

        # Final Verdict
        is_perfectly_clean = len(tiers['tier_0_certain']) == 0 and len(tiers['tier_1_probable']) == 0
        report_lines.append("FINAL VERDICT")
        report_lines.append("-" * 80)
        if is_perfectly_clean:
            report_lines.append("✅ DATASET IS PERFECTLY CLEAN")
            report_lines.append("   (Zero certain/probable contamination detected)")
        else:
            report_lines.append("❌ DATASET CONTAINS CONTAMINATION")
            report_lines.append(f"   {contaminated_samples} samples require correction")
            report_lines.append(f"   Estimated time to perfect cleanliness: {contaminated_samples * 2} minutes")
        report_lines.append("")

        # TIER 0 Details
        if tiers['tier_0_certain']:
            report_lines.append("TIER 0: CERTAIN CONTAMINATION (IMMEDIATE FIX REQUIRED)")
            report_lines.append("=" * 80)
            for i, sample in enumerate(tiers['tier_0_certain'][:50], 1):  # Limit to 50
                report_lines.append(f"\n[{i}] Sample ID: {sample['id']}")
                report_lines.append(f"    Title: {sample['title']}")
                report_lines.append(f"    Current Label: {sample['current_label']}")
                report_lines.append(f"    Majority Vote: {sample['majority_vote']}")
                report_lines.append(f"    Consensus: {sample['consensus_score']:.1f}%")
                report_lines.append(f"    Validators: {sample['num_validators']}")
                report_lines.append(f"    Feature Count: {sample['feature_count']}")

                report_lines.append(f"    Verdicts:")
                for method, (verdict, conf) in sample['verdicts'].items():
                    report_lines.append(f"      - {method}: {verdict} ({conf:.1f}% confidence)")

                report_lines.append(f"    Evidence:")
                for evidence in sample['evidence']:
                    report_lines.append(f"      - {evidence}")

                # Recommended correction
                if sample['majority_vote'] is not None:
                    report_lines.append(f"    ⚡ RECOMMENDED: Change label {sample['current_label']} → {sample['majority_vote']}")

            if len(tiers['tier_0_certain']) > 50:
                report_lines.append(f"\n... and {len(tiers['tier_0_certain']) - 50} more TIER 0 samples")
            report_lines.append("")

        # TIER 1 Summary
        if tiers['tier_1_probable']:
            report_lines.append("TIER 1: PROBABLE CONTAMINATION (MANUAL REVIEW REQUIRED)")
            report_lines.append("=" * 80)
            report_lines.append(f"Total: {len(tiers['tier_1_probable'])} samples")

            # Show top 20 by lowest consensus score
            sorted_tier1 = sorted(tiers['tier_1_probable'],
                                key=lambda x: x['consensus_score'])[:20]

            for i, sample in enumerate(sorted_tier1, 1):
                report_lines.append(f"\n[{i}] ID: {sample['id']} | Consensus: {sample['consensus_score']:.1f}%")
                report_lines.append(f"    Title: {sample['title']}")
                report_lines.append(f"    Current: {sample['current_label']} | Majority: {sample['majority_vote']}")
                if sample['evidence']:
                    report_lines.append(f"    Issues: {'; '.join(sample['evidence'][:2])}")

            if len(tiers['tier_1_probable']) > 20:
                report_lines.append(f"\n... and {len(tiers['tier_1_probable']) - 20} more TIER 1 samples")
            report_lines.append("")

        # TIER 2 Summary
        if tiers['tier_2_possible']:
            report_lines.append("TIER 2: POSSIBLE CONTAMINATION (SPOT-CHECK RECOMMENDED)")
            report_lines.append("=" * 80)
            report_lines.append(f"Total: {len(tiers['tier_2_possible'])} samples")
            report_lines.append(f"These samples have minor uncertainties but likely correct.")
            report_lines.append("")

        # Contamination Patterns
        report_lines.append("CONTAMINATION PATTERNS")
        report_lines.append("=" * 80)

        # Analyze common patterns in TIER 0 and TIER 1
        all_contaminated = tiers['tier_0_certain'] + tiers['tier_1_probable']
        evidence_counts = Counter()
        for sample in all_contaminated:
            for evidence in sample['evidence']:
                # Extract pattern type
                pattern_type = evidence.split(':')[0]
                evidence_counts[pattern_type] += 1

        if evidence_counts:
            report_lines.append("Most common contamination patterns:")
            for pattern, count in evidence_counts.most_common(10):
                report_lines.append(f"  - {pattern}: {count} samples")
        else:
            report_lines.append("No systematic contamination patterns detected.")
        report_lines.append("")

        # Recommendations
        report_lines.append("RECOMMENDED ACTIONS")
        report_lines.append("=" * 80)
        if tiers['tier_0_certain']:
            report_lines.append(f"1. IMMEDIATE: Correct {len(tiers['tier_0_certain'])} TIER 0 samples")
            report_lines.append(f"   Estimated time: {len(tiers['tier_0_certain']) * 2} minutes")
        if tiers['tier_1_probable']:
            report_lines.append(f"2. URGENT: Manual review of {len(tiers['tier_1_probable'])} TIER 1 samples")
            report_lines.append(f"   Estimated time: {len(tiers['tier_1_probable']) * 3} minutes")
        if tiers['tier_2_possible']:
            report_lines.append(f"3. RECOMMENDED: Spot-check {min(20, len(tiers['tier_2_possible']))} TIER 2 samples")
            report_lines.append(f"   Estimated time: 20 minutes")

        if is_perfectly_clean:
            report_lines.append("\n✅ Dataset ready for production ML training!")
        report_lines.append("")

        return "\n".join(report_lines)

    def save_results(self, tiers: Dict[str, List[Dict]], report: str) -> None:
        """Save analysis results."""
        output_dir = self.base_dir / "forensic_analysis"
        output_dir.mkdir(exist_ok=True)

        # Save report
        report_path = output_dir / "contamination_report.txt"
        with open(report_path, 'w') as f:
            f.write(report)
        print(f"\n📄 Report saved: {report_path}")

        # Save tier data
        for tier_name, samples in tiers.items():
            tier_path = output_dir / f"{tier_name}.jsonl"
            with open(tier_path, 'w') as f:
                for sample in samples:
                    f.write(json.dumps(sample) + '\n')
            print(f"📄 {tier_name}: {len(samples)} samples → {tier_path}")

        # Save correction instructions for TIER 0
        if tiers['tier_0_certain']:
            corrections_path = output_dir / "tier0_corrections.jsonl"
            with open(corrections_path, 'w') as f:
                for sample in tiers['tier_0_certain']:
                    correction = {
                        'id': sample['id'],
                        'title': sample['title'],
                        'current_label': sample['current_label'],
                        'corrected_label': sample['majority_vote'],
                        'reason': '; '.join(sample['evidence'])
                    }
                    f.write(json.dumps(correction) + '\n')
            print(f"📄 Correction instructions: {corrections_path}")


def main():
    """Run forensic contamination analysis."""
    base_dir = Path(__file__).parent

    analyzer = ContaminationForensics(base_dir)

    # Phase 1: Load all validation results
    analyzer.load_all_validation_results()

    # Phase 2: Build consensus matrix
    consensus_df = analyzer.build_consensus_matrix()

    # Phase 3-5: Tier contamination
    tiers = analyzer.tier_contamination(consensus_df)

    # Phase 6: Generate report
    report = analyzer.generate_contamination_report(tiers)

    # Save results
    analyzer.save_results(tiers, report)

    # Print report to console
    print("\n" + report)


if __name__ == '__main__':
    main()
