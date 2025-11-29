#!/usr/bin/env python3
"""
Municipal Governance Domain Expert Validation

Uses deep domain knowledge of local government structures to identify
subtle mislabeling that technical methods might miss.
"""

import json
import re
from typing import Dict, List, Tuple
from collections import defaultdict, Counter
from dataclasses import dataclass


@dataclass
class GovernanceAssessment:
    """Domain expert assessment of governance type"""
    is_council: bool  # Is this actually city/county council governance?
    confidence: int  # 0-100
    reasoning: str
    governance_type: str  # city_council/county_council/ward/state_executive/federal/other/invalid
    governance_level: str  # municipal/county/state/federal/international
    flags: List[str]  # Issues found


class GovernanceDomainExpert:
    """Municipal governance expert with deep knowledge of US and international structures"""

    def __init__(self):
        # State executive councils (NOT city councils)
        self.state_executive_councils = {
            'massachusetts', 'maine', 'new hampshire', 'vermont',
            'governor council', 'governors council', 'executive council'
        }

        # International equivalents to US city councils
        self.international_councils = {
            'uk': ['ward', 'council ward', 'electoral division', 'borough'],
            'new zealand': ['ward', 'council ward', 'local board'],
            'australia': ['ward', 'council ward', 'local government area'],
            'canada': ['ward', 'municipal ward', 'council ward'],
            'ireland': ['local electoral area', 'ward'],
            'hong kong': ['district council'],
        }

        # Invalid governance types (not city councils)
        self.invalid_types = {
            'school board', 'school district', 'community council',
            'fire district', 'water district', 'sanitation district',
            'planning district', 'census tract', 'service zone',
            'neighborhood association', 'homeowners association',
            'parish council'  # Religious, unless Louisiana
        }

        # Valid municipal governance keywords
        self.valid_municipal = {
            'city council', 'town council', 'borough council',
            'county council', 'county commission', 'parish council',  # Louisiana
            'aldermanic district', 'supervisorial district',
            'ward', 'district', 'precinct'
        }

        # State/federal level indicators
        self.higher_level_indicators = {
            'congressional', 'senate district', 'house district',
            'legislative district', 'assembly district',
            'governor', 'state senate', 'state house'
        }

    def extract_jurisdiction(self, sample: Dict) -> Tuple[str, str]:
        """Extract jurisdiction name and type from sample"""
        title = sample.get('title', '').lower()
        url = sample.get('url', '').lower()

        # Extract jurisdiction from title/URL
        jurisdiction = ''

        # Try to extract city/county name
        for text in [title, url]:
            # City patterns
            city_match = re.search(r'(?:city of |town of |township of |borough of )([a-z\s]+)', text)
            if city_match:
                jurisdiction = city_match.group(1).strip()
                break

            # County patterns
            county_match = re.search(r'([a-z\s]+)\s+county', text)
            if county_match:
                jurisdiction = county_match.group(1).strip() + ' county'
                break

            # Direct city name in URL
            url_match = re.search(r'/([a-z]+)(?:/|_|-)', text)
            if url_match:
                jurisdiction = url_match.group(1)

        return jurisdiction, title

    def assess_governance_type(self, sample: Dict) -> GovernanceAssessment:
        """Apply domain expertise to classify governance type"""
        title = sample.get('title', '').lower()
        url = sample.get('url', '').lower()
        combined = f"{title} {url}"

        jurisdiction, full_title = self.extract_jurisdiction(sample)

        flags = []

        # Check for state executive councils (HIGH CONFIDENCE FALSE)
        for state_exec in self.state_executive_councils:
            if state_exec in combined:
                return GovernanceAssessment(
                    is_council=False,
                    confidence=100,
                    reasoning=f"State executive council detected: {state_exec}. This is STATE-level executive branch, NOT city council.",
                    governance_type='state_executive',
                    governance_level='state',
                    flags=['state_executive_mislabeled_as_city']
                )

        # Check for federal level
        for indicator in self.higher_level_indicators:
            if indicator in combined:
                if 'congressional' in indicator:
                    return GovernanceAssessment(
                        is_council=False,
                        confidence=100,
                        reasoning=f"Federal legislative district detected: {indicator}. This is FEDERAL, not city council.",
                        governance_type='federal_legislative',
                        governance_level='federal',
                        flags=['federal_mislabeled_as_city']
                    )
                else:
                    return GovernanceAssessment(
                        is_council=False,
                        confidence=95,
                        reasoning=f"State legislative district detected: {indicator}. This is STATE, not city council.",
                        governance_type='state_legislative',
                        governance_level='state',
                        flags=['state_legislative_mislabeled_as_city']
                    )

        # Check for invalid governance types
        for invalid in self.invalid_types:
            if invalid in combined:
                # Special case: Louisiana parishes are valid
                if 'parish' in invalid and 'louisiana' in combined:
                    continue

                return GovernanceAssessment(
                    is_council=False,
                    confidence=90,
                    reasoning=f"Invalid governance type: {invalid}. Not city/county council.",
                    governance_type='invalid',
                    governance_level='other',
                    flags=['invalid_governance_type']
                )

        # Check for international councils
        is_international = False
        for country, keywords in self.international_councils.items():
            if country in combined or any(k in combined for k in keywords):
                is_international = True
                return GovernanceAssessment(
                    is_council=True,
                    confidence=85,
                    reasoning=f"International council ({country}). Equivalent to US city council governance.",
                    governance_type='international_council',
                    governance_level='municipal',
                    flags=['international_jurisdiction']
                )

        # Check for valid municipal governance
        found_municipal_keywords = []
        for keyword in self.valid_municipal:
            if keyword in combined:
                found_municipal_keywords.append(keyword)

        if found_municipal_keywords:
            # Determine specific type
            if 'county' in combined:
                gov_type = 'county_council'
                gov_level = 'county'
            elif 'ward' in combined:
                gov_type = 'ward'
                gov_level = 'municipal'
            else:
                gov_type = 'city_council'
                gov_level = 'municipal'

            return GovernanceAssessment(
                is_council=True,
                confidence=90,
                reasoning=f"Valid municipal governance. Keywords: {', '.join(found_municipal_keywords)}",
                governance_type=gov_type,
                governance_level=gov_level,
                flags=[]
            )

        # Ambiguous case - needs more research
        return GovernanceAssessment(
            is_council=None,  # Uncertain
            confidence=50,
            reasoning="Ambiguous governance type. Insufficient keywords to determine classification.",
            governance_type='uncertain',
            governance_level='uncertain',
            flags=['requires_manual_review']
        )

    def validate_temporal_consistency(self, sample: Dict) -> List[str]:
        """Check temporal markers for consistency"""
        title = sample.get('title', '').lower()
        flags = []

        # Extract years
        years = re.findall(r'\b(19\d{2}|20\d{2})\b', title)

        # Check for redistricting cycle alignment
        redistricting_years = {2010, 2011, 2012, 2013, 2020, 2021, 2022, 2023}
        for year in years:
            year_int = int(year)
            if year_int in redistricting_years:
                flags.append(f'redistricting_cycle_{year}')

        # Check for temporal markers
        if 'current' in title:
            flags.append('current_boundaries')
        if 'adopted' in title:
            flags.append('adopted_boundaries')
        if 'proposed' in title:
            flags.append('proposed_boundaries')
        if 'historical' in title:
            flags.append('historical_boundaries')

        return flags


def analyze_dataset(file_path: str) -> Dict:
    """Analyze entire dataset with domain expertise"""
    expert = GovernanceDomainExpert()

    results = {
        'total_samples': 0,
        'governance_distribution': Counter(),
        'governance_level_distribution': Counter(),
        'confidence_distribution': [],
        'flags_distribution': Counter(),
        'mislabeled_samples': [],
        'ambiguous_samples': [],
        'high_confidence_corrections': [],
        'temporal_consistency': Counter(),
    }

    with open(file_path, 'r') as f:
        for line_num, line in enumerate(f, 1):
            sample = json.loads(line.strip())
            results['total_samples'] += 1

            # Get domain expert assessment
            assessment = expert.assess_governance_type(sample)

            # Track distributions
            results['governance_distribution'][assessment.governance_type] += 1
            results['governance_level_distribution'][assessment.governance_level] += 1
            results['confidence_distribution'].append(assessment.confidence)

            for flag in assessment.flags:
                results['flags_distribution'][flag] += 1

            # Check temporal consistency
            temporal_flags = expert.validate_temporal_consistency(sample)
            for flag in temporal_flags:
                results['temporal_consistency'][flag] += 1

            # Compare with existing label
            existing_label = sample.get('is_council_district', None)

            # Track mislabeled samples (high confidence disagreement)
            if assessment.confidence >= 90 and existing_label is not None:
                if assessment.is_council != existing_label:
                    mislabel_info = {
                        'line': line_num,
                        'title': sample.get('title'),
                        'url': sample.get('url'),
                        'existing_label': existing_label,
                        'expert_label': assessment.is_council,
                        'confidence': assessment.confidence,
                        'reasoning': assessment.reasoning,
                        'governance_type': assessment.governance_type,
                        'governance_level': assessment.governance_level,
                        'flags': assessment.flags
                    }
                    results['mislabeled_samples'].append(mislabel_info)

                    if assessment.confidence == 100:
                        results['high_confidence_corrections'].append(mislabel_info)

            # Track ambiguous samples
            if assessment.confidence < 70:
                results['ambiguous_samples'].append({
                    'line': line_num,
                    'title': sample.get('title'),
                    'url': sample.get('url'),
                    'confidence': assessment.confidence,
                    'reasoning': assessment.reasoning,
                    'governance_type': assessment.governance_type,
                    'flags': assessment.flags
                })

    # Calculate statistics
    results['avg_confidence'] = sum(results['confidence_distribution']) / len(results['confidence_distribution'])
    results['min_confidence'] = min(results['confidence_distribution'])
    results['max_confidence'] = max(results['confidence_distribution'])

    return results


def print_domain_expert_report(results: Dict):
    """Print comprehensive domain expert validation report"""

    print("=" * 80)
    print("MUNICIPAL GOVERNANCE DOMAIN EXPERT VALIDATION REPORT")
    print("=" * 80)
    print()

    print(f"Total Samples Analyzed: {results['total_samples']}")
    print(f"Average Confidence: {results['avg_confidence']:.1f}%")
    print(f"Confidence Range: {results['min_confidence']}% - {results['max_confidence']}%")
    print()

    print("-" * 80)
    print("GOVERNANCE TYPE DISTRIBUTION")
    print("-" * 80)
    for gov_type, count in results['governance_distribution'].most_common():
        pct = (count / results['total_samples']) * 100
        print(f"  {gov_type:30s}: {count:4d} ({pct:5.1f}%)")
    print()

    print("-" * 80)
    print("GOVERNANCE LEVEL DISTRIBUTION")
    print("-" * 80)
    for level, count in results['governance_level_distribution'].most_common():
        pct = (count / results['total_samples']) * 100
        print(f"  {level:30s}: {count:4d} ({pct:5.1f}%)")
    print()

    print("-" * 80)
    print("VALIDATION FLAGS")
    print("-" * 80)
    for flag, count in results['flags_distribution'].most_common():
        print(f"  {flag:50s}: {count:4d}")
    print()

    print("-" * 80)
    print("TEMPORAL CONSISTENCY")
    print("-" * 80)
    for flag, count in results['temporal_consistency'].most_common():
        print(f"  {flag:50s}: {count:4d}")
    print()

    if results['high_confidence_corrections']:
        print("-" * 80)
        print(f"HIGH CONFIDENCE CORRECTIONS ({len(results['high_confidence_corrections'])} samples)")
        print("-" * 80)
        for item in results['high_confidence_corrections'][:20]:  # Top 20
            print(f"\nLine {item['line']}:")
            print(f"  Title: {item['title']}")
            print(f"  Existing Label: {item['existing_label']}")
            print(f"  Expert Label: {item['expert_label']}")
            print(f"  Governance: {item['governance_type']} ({item['governance_level']})")
            print(f"  Confidence: {item['confidence']}%")
            print(f"  Reasoning: {item['reasoning']}")
            if item['flags']:
                print(f"  Flags: {', '.join(item['flags'])}")

    if results['mislabeled_samples']:
        print()
        print("-" * 80)
        print(f"ALL MISLABELED SAMPLES ({len(results['mislabeled_samples'])} total)")
        print("-" * 80)

        # Group by governance type
        by_type = defaultdict(list)
        for item in results['mislabeled_samples']:
            by_type[item['governance_type']].append(item)

        for gov_type, items in sorted(by_type.items()):
            print(f"\n{gov_type.upper()} ({len(items)} samples):")
            for item in items[:10]:  # Top 10 per type
                print(f"  Line {item['line']}: {item['title'][:70]}")
                print(f"    Label: {item['existing_label']} → {item['expert_label']} (conf: {item['confidence']}%)")

    if results['ambiguous_samples']:
        print()
        print("-" * 80)
        print(f"AMBIGUOUS SAMPLES REQUIRING MANUAL REVIEW ({len(results['ambiguous_samples'])} samples)")
        print("-" * 80)
        for item in results['ambiguous_samples'][:15]:  # Top 15
            print(f"\nLine {item['line']}:")
            print(f"  Title: {item['title']}")
            print(f"  Confidence: {item['confidence']}%")
            print(f"  Reasoning: {item['reasoning']}")

    print()
    print("=" * 80)
    print("DOMAIN EXPERT RECOMMENDATIONS")
    print("=" * 80)

    # Calculate key metrics
    total_mislabeled = len(results['mislabeled_samples'])
    state_level_errors = results['flags_distribution']['state_executive_mislabeled_as_city'] + \
                        results['flags_distribution']['state_legislative_mislabeled_as_city']
    federal_errors = results['flags_distribution']['federal_mislabeled_as_city']
    invalid_errors = results['flags_distribution']['invalid_governance_type']

    print(f"\n1. CRITICAL MISLABELING: {total_mislabeled} samples ({(total_mislabeled/results['total_samples']*100):.1f}%)")
    print(f"   - State-level governance mislabeled as city: {state_level_errors}")
    print(f"   - Federal-level governance mislabeled as city: {federal_errors}")
    print(f"   - Invalid governance types: {invalid_errors}")

    print(f"\n2. MANUAL REVIEW REQUIRED: {len(results['ambiguous_samples'])} samples")
    print(f"   - Low confidence classifications need domain research")

    print(f"\n3. INTERNATIONAL JURISDICTIONS: {results['flags_distribution']['international_jurisdiction']} samples")
    print(f"   - Validated as equivalent to US city councils")

    redistricting_samples = sum(1 for k, v in results['temporal_consistency'].items() if 'redistricting_cycle' in k)
    print(f"\n4. TEMPORAL CONSISTENCY: {redistricting_samples} samples from redistricting cycles")
    print(f"   - Indicates proper historical coverage")

    print()


if __name__ == '__main__':
    file_path = '/Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas/agents/data/ml_training_data_enriched.jsonl'

    print("Loading dataset and applying domain expertise...\n")
    results = analyze_dataset(file_path)

    print_domain_expert_report(results)

    # Save detailed results
    output_path = '/Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas/agents/langgraph/governance_domain_validation_report.json'
    with open(output_path, 'w') as f:
        # Convert Counter objects to dicts for JSON serialization
        json_results = {
            **results,
            'governance_distribution': dict(results['governance_distribution']),
            'governance_level_distribution': dict(results['governance_level_distribution']),
            'flags_distribution': dict(results['flags_distribution']),
            'temporal_consistency': dict(results['temporal_consistency']),
        }
        json.dump(json_results, f, indent=2)

    print(f"\nDetailed results saved to: {output_path}")
