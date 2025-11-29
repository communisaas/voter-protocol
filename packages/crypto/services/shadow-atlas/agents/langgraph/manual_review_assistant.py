#!/usr/bin/env python3
"""
Manual Review Assistant

Interactive tool to help reviewers process high-risk samples efficiently.
Displays sample details and validation conflicts, allows for quick labeling.
"""

import json
from pathlib import Path
from typing import Dict, List, Optional


class ManualReviewAssistant:
    """Interactive assistant for manual sample review"""

    def __init__(self, high_risk_path: str, enriched_data_path: str):
        self.high_risk_path = Path(high_risk_path)
        self.enriched_data_path = Path(enriched_data_path)
        self.high_risk_samples = []
        self.enriched_lookup = {}
        self.reviews = []

    def load_data(self) -> None:
        """Load high-risk samples and enriched data"""
        print("Loading data...")

        # Load high-risk samples
        with open(self.high_risk_path, 'r') as f:
            self.high_risk_samples = json.load(f)

        # Load enriched data for additional context
        with open(self.enriched_data_path, 'r') as f:
            for line in f:
                if line.strip():
                    sample = json.loads(line)
                    self.enriched_lookup[sample['dataset_id']] = sample

        print(f"Loaded {len(self.high_risk_samples)} high-risk samples")

    def display_sample(self, sample: Dict, index: int) -> None:
        """Display sample details for review"""
        print("\n" + "=" * 80)
        print(f"SAMPLE {index + 1} / {len(self.high_risk_samples)}")
        print("=" * 80)

        # Basic info
        print(f"\nDataset ID: {sample['dataset_id']}")
        print(f"Title: {sample['title']}")
        print(f"\nURL: {sample.get('url', 'N/A')}")

        # Get enriched data
        enriched = self.enriched_lookup.get(sample['dataset_id'], {})

        # Description (if available)
        if enriched.get('live_description'):
            print(f"\nDescription:")
            desc = enriched['live_description'][:300]
            if len(enriched['live_description']) > 300:
                desc += "..."
            print(f"  {desc}")

        # Fields (if available)
        fields = enriched.get('live_fields', [])
        if fields:
            print(f"\nFields ({len(fields)} total):")
            for field in fields[:10]:  # Show first 10
                print(f"  - {field}")
            if len(fields) > 10:
                print(f"  ... and {len(fields) - 10} more")

        # Current labels and agreement
        print(f"\n{'=' * 80}")
        print("VALIDATION RESULTS:")
        print(f"{'=' * 80}")

        print(f"\nOriginal LLM Label: {sample['llm_label']}")
        print(f"Consensus Label:    {sample['consensus_label']}")
        print(f"Agreement Score:    {sample['agreement_score']:.2f}")
        print(f"Risk Level:         {sample['contamination_risk']}")

        print(f"\nValidation Methods:")
        for val in sample['validations']:
            confidence = val['confidence']
            is_council = val['is_council']

            # Format with color coding
            if is_council is None:
                label = "N/A"
            elif is_council:
                label = "TRUE "
            else:
                label = "FALSE"

            print(f"  {val['method']:20s} → {label} (confidence: {confidence:.2f})")
            print(f"    Reasoning: {val['reasoning']}")

        print(f"\n{'=' * 80}")

    def get_review_decision(self) -> Optional[Dict]:
        """Prompt reviewer for decision"""
        print("\nYour decision:")
        print("  [t] TRUE - This is council district data")
        print("  [f] FALSE - This is NOT council district data")
        print("  [u] UNSURE - Need more investigation")
        print("  [s] SKIP - Review later")
        print("  [q] QUIT - Exit review session")
        print("  [h] HELP - Show criteria")

        while True:
            choice = input("\nEnter choice: ").strip().lower()

            if choice == 'h':
                self.show_criteria()
                continue

            if choice == 'q':
                return None

            if choice == 's':
                return {'action': 'skip'}

            if choice not in ['t', 'f', 'u']:
                print("Invalid choice. Please enter t, f, u, s, or q.")
                continue

            # Get confidence
            print("\nConfidence level:")
            print("  [h] HIGH - Very confident in this label")
            print("  [m] MEDIUM - Reasonably confident")
            print("  [l] LOW - Uncertain, may need verification")

            conf = input("Enter confidence: ").strip().lower()
            while conf not in ['h', 'm', 'l']:
                print("Invalid confidence. Please enter h, m, or l.")
                conf = input("Enter confidence: ").strip().lower()

            confidence_map = {'h': 'HIGH', 'm': 'MEDIUM', 'l': 'LOW'}

            # Get reasoning
            reasoning = input("\nBrief reasoning (optional): ").strip()

            return {
                'action': 'review',
                'label': choice == 't',
                'confidence': confidence_map[conf],
                'reasoning': reasoning
            }

    def show_criteria(self) -> None:
        """Display labeling criteria"""
        print("\n" + "=" * 80)
        print("LABELING CRITERIA")
        print("=" * 80)
        print("\nLabel as TRUE if dataset contains:")
        print("  ✓ City/municipal council district boundaries (geographic polygons)")
        print("  ✓ Ward or district boundaries for city councils")
        print("  ✓ Demographic data GROUPED BY council districts")
        print("  ✓ Electoral maps showing council districts")
        print("  ✓ Council district names, numbers, or representatives")
        print("\nLabel as FALSE if dataset contains:")
        print("  ✗ County districts, congressional districts, state legislature districts")
        print("  ✗ Census tracts, block groups, ZIP codes (unless explicitly linked to councils)")
        print("  ✗ School districts, police precincts, fire districts")
        print("  ✗ Voting precincts or election districts (unless same as council districts)")
        print("  ✗ Unrelated data that mentions council districts in passing")
        print("\nEdge Cases (use judgment):")
        print("  ? Census data CROSSWALKED to council districts → Usually TRUE")
        print("  ? Historical boundaries from past years → TRUE if clearly labeled")
        print("  ? Forms or reports ABOUT districts → FALSE (metadata, not geography)")
        print("  ? Regional councils (COGs) → FALSE (different governance level)")
        print("=" * 80)

    def run_review_session(self) -> None:
        """Interactive review session"""
        print("\n" + "=" * 80)
        print("MANUAL REVIEW SESSION")
        print("=" * 80)
        print(f"\nReviewing {len(self.high_risk_samples)} high-risk samples")
        print("These samples have low agreement scores and require human judgment.")
        print("\nType 'h' at any prompt to see labeling criteria.")
        print("=" * 80)

        for i, sample in enumerate(self.high_risk_samples):
            self.display_sample(sample, i)

            decision = self.get_review_decision()

            if decision is None:  # Quit
                break

            if decision['action'] == 'skip':
                print("Skipped.")
                continue

            # Record review
            review = {
                'dataset_id': sample['dataset_id'],
                'title': sample['title'],
                'original_llm_label': sample['llm_label'],
                'consensus_label': sample['consensus_label'],
                'agreement_score': sample['agreement_score'],
                'reviewer_label': decision['label'],
                'reviewer_confidence': decision['confidence'],
                'reviewer_reasoning': decision['reasoning'],
            }
            self.reviews.append(review)

            print(f"\n✓ Review recorded. ({len(self.reviews)} / {len(self.high_risk_samples)} completed)")

        print("\n" + "=" * 80)
        print("REVIEW SESSION COMPLETE")
        print("=" * 80)

    def save_reviews(self, output_path: str) -> None:
        """Save review results"""
        output_file = Path(output_path)

        with open(output_file, 'w') as f:
            json.dump(self.reviews, f, indent=2)

        print(f"\n✓ Reviews saved to: {output_file}")
        print(f"  Total reviews: {len(self.reviews)}")

        # Summary stats
        if self.reviews:
            true_count = sum(1 for r in self.reviews if r['reviewer_label'])
            false_count = len(self.reviews) - true_count

            print(f"\n  Reviewer labels: {true_count} TRUE, {false_count} FALSE")

            # Agreement with LLM
            agree_with_llm = sum(1 for r in self.reviews
                                if r['reviewer_label'] == r['original_llm_label'])
            print(f"  Agreement with original LLM: {agree_with_llm}/{len(self.reviews)} "
                  f"({agree_with_llm/len(self.reviews)*100:.1f}%)")

            # Agreement with consensus
            agree_with_consensus = sum(1 for r in self.reviews
                                      if r['consensus_label'] is not None and
                                      r['reviewer_label'] == r['consensus_label'])
            consensus_available = sum(1 for r in self.reviews if r['consensus_label'] is not None)
            if consensus_available > 0:
                print(f"  Agreement with consensus: {agree_with_consensus}/{consensus_available} "
                      f"({agree_with_consensus/consensus_available*100:.1f}%)")

    def generate_summary_report(self) -> str:
        """Generate summary of review session"""
        if not self.reviews:
            return "No reviews completed."

        output = []
        output.append("MANUAL REVIEW SUMMARY")
        output.append("=" * 80)

        output.append(f"\nTotal samples reviewed: {len(self.reviews)}")

        # Label changes
        changes = [r for r in self.reviews if r['reviewer_label'] != r['original_llm_label']]
        output.append(f"Labels changed: {len(changes)} ({len(changes)/len(self.reviews)*100:.1f}%)")

        # Confidence distribution
        high_conf = sum(1 for r in self.reviews if r['reviewer_confidence'] == 'HIGH')
        med_conf = sum(1 for r in self.reviews if r['reviewer_confidence'] == 'MEDIUM')
        low_conf = sum(1 for r in self.reviews if r['reviewer_confidence'] == 'LOW')

        output.append(f"\nConfidence distribution:")
        output.append(f"  HIGH:   {high_conf} ({high_conf/len(self.reviews)*100:.1f}%)")
        output.append(f"  MEDIUM: {med_conf} ({med_conf/len(self.reviews)*100:.1f}%)")
        output.append(f"  LOW:    {low_conf} ({low_conf/len(self.reviews)*100:.1f}%)")

        # Most common label changes
        output.append(f"\nLabel changes:")
        false_to_true = sum(1 for r in changes
                          if not r['original_llm_label'] and r['reviewer_label'])
        true_to_false = sum(1 for r in changes
                          if r['original_llm_label'] and not r['reviewer_label'])

        output.append(f"  FALSE → TRUE: {false_to_true}")
        output.append(f"  TRUE → FALSE: {true_to_false}")

        output.append(f"\n{'=' * 80}")

        return "\n".join(output)


def main():
    """Main execution"""
    base_path = "/Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas/agents"

    high_risk_path = f"{base_path}/langgraph/validation_results/high_risk_samples.json"
    enriched_path = f"{base_path}/data/ml_training_data_enriched.jsonl"
    output_path = f"{base_path}/langgraph/validation_results/manual_reviews.json"

    assistant = ManualReviewAssistant(high_risk_path, enriched_path)
    assistant.load_data()

    # Show criteria first
    assistant.show_criteria()
    input("\nPress Enter to start review session...")

    # Run review
    assistant.run_review_session()

    # Save results
    if assistant.reviews:
        assistant.save_reviews(output_path)
        print("\n" + assistant.generate_summary_report())
    else:
        print("\nNo reviews completed.")


if __name__ == "__main__":
    main()
