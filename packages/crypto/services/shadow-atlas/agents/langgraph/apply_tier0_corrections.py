#!/usr/bin/env python3
"""
Apply TIER 0 corrections to the dataset.
Corrects 27 confirmed contaminated samples.
"""

import json
from pathlib import Path
from typing import Dict, List, Set

# TIER 0 Corrections - Confirmed Contamination
CORRECTIONS = {
    # False Positives (TRUE → FALSE): 6 samples
    "9af5a364474c4543878c7a8e40448d3f": {
        "title": "2010_Census_Tracts_by_Council_District_Copy",
        "from": True,
        "to": False,
        "reason": "Census tracts BY district, not district boundaries"
    },
    "6e99b683334b409083dd9c7c603c40e4": {
        "title": "Kiwipoint Quarry Precinct - 2024 District Plan",
        "from": True,
        "to": False,
        "reason": "Zoning precinct, not electoral district"
    },
    "b3c3793caf54430c91585ea2e9f7a871": {
        "title": "Housing Tenure (by Atlanta City Council District) 2019",
        "from": True,
        "to": False,
        "reason": "Demographic data BY district, not district boundaries"
    },
    "ae882ebdc81a4631aa8486f1e9d281fa": {
        "title": "Mt Victoria North Townscape Precinct - 2024 Operative District Plan",
        "from": True,
        "to": False,
        "reason": "Zoning precinct, not electoral district"
    },
    "632036b8ebd34f6181b0c60a7cb9198c": {
        "title": "Address Points By Council Districts",
        "from": True,
        "to": False,
        "reason": "Address-level data (109k features), not district boundaries"
    },

    # False Negatives (FALSE → TRUE): 21 samples
    "11f6957d61b64c9695ff83dd6833e398": {
        "title": "Petersburg Green Space CORRECT Wards_WFL1",
        "from": False,
        "to": True,
        "reason": "Ward boundaries"
    },
    "ac724cfa34a74c56a891a1a5d33d681f": {
        "title": "Aurora Wards System",
        "from": False,
        "to": True,
        "reason": "Ward boundaries"
    },
    "5c9b00f4ccd2431281c0e502bd40e646": {
        "title": "Governor's Council Districts (2021)",
        "from": False,
        "to": True,
        "reason": "Executive council districts"
    },
    "b6df174950f54128bea05f8c01bd061f": {
        "title": "MATURE SUPPORT - Ward Boundaries for New Jersey",
        "from": False,
        "to": True,
        "reason": "Ward boundaries"
    },
    "40d93f670bff4af2b41165503070102b": {
        "title": "AR Municipal Wards",
        "from": False,
        "to": True,
        "reason": "Municipal ward boundaries"
    },
    "f0a85ed1d34e474681ec3a7478ab9d6a": {
        "title": "2012 to 2020 Election Data with 2020 Wards",
        "from": False,
        "to": True,
        "reason": "Ward boundary data"
    },
    "a519c97ce6c044ad9a7d62b72e534e0a": {
        "title": "Intersect_of_Missed_Collection_Locations_and_Ward_Boundaries_NT",
        "from": False,
        "to": True,
        "reason": "Ward boundaries"
    },
    "25692cfb40494cbbb1e8ff164c071803": {
        "title": "Intersect_of_Missed_Collection_Locations_and_Ward_Boundaries_Bishnu_Sharma",
        "from": False,
        "to": True,
        "reason": "Ward boundaries"
    },
    "aa3099390ce64f0f9fa1a38bc82bfd9b": {
        "title": "Katsina_operational_ward_boundaries",
        "from": False,
        "to": True,
        "reason": "Ward boundaries"
    },
    "112bf032cf414a51a5f4749f49bff75e": {
        "title": "Ward Map_WFL1",
        "from": False,
        "to": True,
        "reason": "Ward boundaries"
    },
    "79cac0d14d6f4c10a5a6073a1d3480ae": {
        "title": "Dissolve_Burlington_City_Wards",
        "from": False,
        "to": True,
        "reason": "Ward boundaries"
    },
    "fa1701a1d4b94aa7b5d687688a1e64d4": {
        "title": "MedfordWardUpdate3",
        "from": False,
        "to": True,
        "reason": "Ward boundaries"
    },
    "d62ca8e37ae74762a9675ad53a50c0ed": {
        "title": "Seligman Wards Boundary",
        "from": False,
        "to": True,
        "reason": "Ward boundaries"
    },
    "a31c027591df49499d6b66d6587eb84a": {
        "title": "Lowest Turnout Wards_WFL1",
        "from": False,
        "to": True,
        "reason": "Ward boundaries"
    },
    "bcd401875ef640e09cf29bcb01828475": {
        "title": "FS_Housing_LettingAreas_Wards",
        "from": False,
        "to": True,
        "reason": "Ward boundaries"
    },
    "642c3fe50c304f4ba38d7dd452967f8d": {
        "title": "Wards Precincts Places Zones",
        "from": False,
        "to": True,
        "reason": "Ward boundaries"
    },
    "514eb780e5b84360a6044d8c72c71846": {
        "title": "Community Council Districts",
        "from": False,
        "to": True,
        "reason": "Community council districts"
    },
    "6d4ae7efad4f4c77907db7cbfb012e64": {
        "title": "Wards and Precincts (2022) (Feature Service)",
        "from": False,
        "to": True,
        "reason": "Ward boundaries"
    },
    "c1b9a93eaa054144a10b39d954b6c6d1": {
        "title": "NZ Ward boundaries 2018 (Mature Support)",
        "from": False,
        "to": True,
        "reason": "Ward boundaries"
    },
    "bd257807207647d2abb8f86cdf79b52a": {
        "title": "New Hampshire Executive Council District Boundaries - 2022",
        "from": False,
        "to": True,
        "reason": "Executive council districts"
    },
    "420783bf0f5c481581aee1957268c641": {
        "title": "Establishments and Persons by Industry and District Council District in Hong Kong",
        "from": False,
        "to": True,
        "reason": "District council districts"
    },
}


def apply_corrections(dataset_path: Path, output_path: Path) -> Dict[str, int]:
    """Apply TIER 0 corrections to dataset."""

    print(f"📂 Loading dataset: {dataset_path}")
    samples = []
    with open(dataset_path) as f:
        for line in f:
            samples.append(json.loads(line))

    print(f"✓ Loaded {len(samples)} samples")

    # Apply corrections
    stats = {
        "total": len(samples),
        "corrected": 0,
        "true_to_false": 0,
        "false_to_true": 0,
        "unchanged": 0
    }

    corrected_samples = []
    for sample in samples:
        sample_id = sample.get("dataset_id")

        if sample_id in CORRECTIONS:
            correction = CORRECTIONS[sample_id]
            old_label = sample.get("is_council_district")

            # Verify expected label
            if old_label != correction["from"]:
                print(f"⚠️  WARNING: {sample_id} has label {old_label}, expected {correction['from']}")
                print(f"    Skipping correction to avoid unintended changes")
                corrected_samples.append(sample)
                stats["unchanged"] += 1
                continue

            # Apply correction
            sample["is_council_district"] = correction["to"]

            # Add audit trail
            if "corrections" not in sample:
                sample["corrections"] = []
            sample["corrections"].append({
                "date": "2025-11-24",
                "from": correction["from"],
                "to": correction["to"],
                "reason": correction["reason"],
                "method": "forensic_tier0_correction"
            })

            # Update stats
            stats["corrected"] += 1
            if correction["from"] and not correction["to"]:
                stats["true_to_false"] += 1
            elif not correction["from"] and correction["to"]:
                stats["false_to_true"] += 1

            print(f"✓ Corrected: {sample_id[:8]}... | {correction['from']} → {correction['to']}")
            print(f"  Title: {correction['title'][:60]}...")
            print(f"  Reason: {correction['reason']}")

        corrected_samples.append(sample)
        if sample_id not in CORRECTIONS:
            stats["unchanged"] += 1

    # Save corrected dataset
    print(f"\n💾 Saving corrected dataset: {output_path}")
    with open(output_path, 'w') as f:
        for sample in corrected_samples:
            f.write(json.dumps(sample) + '\n')

    print(f"✓ Saved {len(corrected_samples)} samples")

    return stats


def main():
    """Apply TIER 0 corrections."""
    base_dir = Path(__file__).parent
    data_dir = base_dir.parent / "data"

    dataset_path = data_dir / "ml_training_data_domain_corrected.jsonl"
    output_path = data_dir / "ml_training_data_tier0_corrected.jsonl"

    print("=" * 80)
    print("TIER 0 CONTAMINATION CORRECTIONS")
    print("=" * 80)
    print(f"\nApplying {len(CORRECTIONS)} corrections...")
    print(f"  - False Positives (TRUE → FALSE): 6 samples")
    print(f"  - False Negatives (FALSE → TRUE): 21 samples")
    print()

    stats = apply_corrections(dataset_path, output_path)

    print("\n" + "=" * 80)
    print("CORRECTION SUMMARY")
    print("=" * 80)
    print(f"Total samples:        {stats['total']}")
    print(f"Corrected:            {stats['corrected']}")
    print(f"  - TRUE → FALSE:     {stats['true_to_false']}")
    print(f"  - FALSE → TRUE:     {stats['false_to_true']}")
    print(f"Unchanged:            {stats['unchanged']}")
    print()

    # Calculate new label distribution
    true_count = stats['false_to_true'] - stats['true_to_false']
    print(f"Net change in TRUE labels: {true_count:+d}")
    print()

    if stats['corrected'] == len(CORRECTIONS):
        print("✅ All TIER 0 corrections applied successfully!")
    else:
        print(f"⚠️  Only {stats['corrected']}/{len(CORRECTIONS)} corrections applied")
        print("   Some samples may have unexpected labels")

    print(f"\n📄 Corrected dataset saved to:")
    print(f"   {output_path}")


if __name__ == '__main__':
    main()
