#!/usr/bin/env python3
"""
Apply domain expert corrections to training data

This script fixes the 61 high-confidence mislabeled samples identified
by the governance domain expert validation.
"""

import json
from pathlib import Path
from datetime import datetime
from typing import Dict, List


class DomainExpertCorrector:
    """Applies domain expert corrections to training data"""

    def __init__(self):
        # Load validation results
        self.corrections = self._load_corrections()

    def _load_corrections(self) -> Dict:
        """Load domain validation report with corrections"""
        report_path = Path('governance_domain_validation_report.json')

        if not report_path.exists():
            raise FileNotFoundError(
                "Run governance_domain_validation.py first to generate corrections"
            )

        with open(report_path) as f:
            return json.load(f)

    def apply_corrections(self, input_path: str, output_path: str) -> Dict:
        """Apply corrections and generate corrected dataset"""

        corrections_applied = []
        unchanged_samples = []
        uncertain_flagged = []

        # Get mislabeled samples that need correction
        mislabeled = {
            item['line']: item
            for item in self.corrections['mislabeled_samples']
            if item['confidence'] >= 90  # Only high-confidence corrections
        }

        # Get uncertain samples that need review
        uncertain_lines = {
            item['line']
            for item in self.corrections['ambiguous_samples']
        }

        corrected_samples = []

        with open(input_path, 'r') as f_in:
            for line_num, line in enumerate(f_in, 1):
                sample = json.loads(line.strip())

                # Check if this line needs correction
                if line_num in mislabeled:
                    correction_info = mislabeled[line_num]

                    # Apply correction
                    old_label = sample.get('is_council_district')
                    new_label = correction_info['expert_label']

                    sample['is_council_district'] = new_label

                    # Add metadata about correction
                    sample['domain_expert_correction'] = {
                        'original_label': old_label,
                        'corrected_label': new_label,
                        'confidence': correction_info['confidence'],
                        'reasoning': correction_info['reasoning'],
                        'governance_type': correction_info['governance_type'],
                        'governance_level': correction_info['governance_level'],
                        'correction_date': datetime.now().isoformat()
                    }

                    corrections_applied.append({
                        'line': line_num,
                        'title': sample.get('title'),
                        'old_label': old_label,
                        'new_label': new_label,
                        'governance_type': correction_info['governance_type']
                    })

                # Flag uncertain samples for review
                elif line_num in uncertain_lines:
                    sample['domain_expert_review'] = {
                        'status': 'requires_manual_review',
                        'reason': 'ambiguous_governance_type',
                        'flagged_date': datetime.now().isoformat()
                    }

                    uncertain_flagged.append({
                        'line': line_num,
                        'title': sample.get('title'),
                        'current_label': sample.get('is_council_district')
                    })

                else:
                    # Sample unchanged
                    unchanged_samples.append(line_num)

                corrected_samples.append(sample)

        # Write corrected dataset
        with open(output_path, 'w') as f_out:
            for sample in corrected_samples:
                f_out.write(json.dumps(sample) + '\n')

        # Generate correction report
        return {
            'total_samples': len(corrected_samples),
            'corrections_applied': len(corrections_applied),
            'uncertain_flagged': len(uncertain_flagged),
            'unchanged': len(unchanged_samples),
            'correction_details': corrections_applied,
            'uncertain_details': uncertain_flagged
        }


def print_correction_summary(results: Dict):
    """Print summary of corrections applied"""

    print("=" * 80)
    print("DOMAIN EXPERT CORRECTIONS APPLIED")
    print("=" * 80)
    print()

    print(f"Total Samples: {results['total_samples']}")
    print(f"Corrections Applied: {results['corrections_applied']}")
    print(f"Uncertain Flagged: {results['uncertain_flagged']}")
    print(f"Unchanged: {results['unchanged']}")
    print()

    if results['corrections_applied'] > 0:
        print("-" * 80)
        print("CORRECTIONS APPLIED")
        print("-" * 80)

        # Group by governance type
        by_type = {}
        for item in results['correction_details']:
            gov_type = item['governance_type']
            by_type.setdefault(gov_type, []).append(item)

        for gov_type, items in sorted(by_type.items()):
            print(f"\n{gov_type.upper()} ({len(items)} corrections):")
            for item in items[:10]:  # Show first 10
                print(f"  Line {item['line']}: {item['old_label']} → {item['new_label']}")
                print(f"    {item['title'][:70]}")

    if results['uncertain_flagged'] > 0:
        print()
        print("-" * 80)
        print(f"UNCERTAIN SAMPLES FLAGGED FOR REVIEW ({results['uncertain_flagged']} samples)")
        print("-" * 80)
        for item in results['uncertain_details'][:15]:
            print(f"  Line {item['line']}: {item['title'][:70]} (label={item['current_label']})")


if __name__ == '__main__':
    input_path = '/Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas/agents/data/ml_training_data_enriched.jsonl'
    output_path = '/Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas/agents/data/ml_training_data_domain_corrected.jsonl'

    corrector = DomainExpertCorrector()

    print("Applying domain expert corrections...\n")
    results = corrector.apply_corrections(input_path, output_path)

    print_correction_summary(results)

    # Save correction report
    report_path = '/Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas/agents/langgraph/domain_corrections_applied.json'
    with open(report_path, 'w') as f:
        json.dump(results, f, indent=2)

    print(f"\nCorrected dataset saved to: {output_path}")
    print(f"Correction report saved to: {report_path}")
