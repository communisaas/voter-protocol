#!/usr/bin/env python3
"""
Prioritize uncertain samples for manual review

Analyzes the 158 uncertain samples and creates a prioritized review queue
based on URL analysis, domain patterns, and potential impact.
"""

import json
import re
from urllib.parse import urlparse
from collections import defaultdict, Counter


def extract_url_insights(url: str) -> dict:
    """Extract useful information from URL"""

    parsed = urlparse(url)
    domain = parsed.netloc.lower()

    insights = {
        'domain': domain,
        'is_government': False,
        'is_state_gov': False,
        'is_city_gov': False,
        'is_county_gov': False,
        'government_type': 'unknown',
        'country': 'unknown'
    }

    # Government domain patterns
    if '.gov' in domain:
        insights['is_government'] = True

        # State government
        if 'state.' in domain or '.state.' in domain or 'legis' in domain:
            insights['is_state_gov'] = True
            insights['government_type'] = 'state'

        # City government
        elif 'city.' in domain or '.city.' in domain or 'cityof' in domain:
            insights['is_city_gov'] = True
            insights['government_type'] = 'city'

        # County government
        elif 'county' in domain or 'co.' in domain:
            insights['is_county_gov'] = True
            insights['government_type'] = 'county'

    # International domains
    if '.uk' in domain or '.gov.uk' in domain:
        insights['country'] = 'uk'
    elif '.nz' in domain or 'govt.nz' in domain:
        insights['country'] = 'new_zealand'
    elif '.au' in domain or 'gov.au' in domain:
        insights['country'] = 'australia'
    elif '.ie' in domain or 'gov.ie' in domain:
        insights['country'] = 'ireland'

    # ArcGIS hosting (need to check layer metadata)
    if 'arcgis.com' in domain:
        insights['government_type'] = 'arcgis_hosted'  # Could be anything

    return insights


def prioritize_uncertain_samples():
    """Create prioritized review queue for uncertain samples"""

    corrected_path = '/Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas/agents/data/ml_training_data_domain_corrected.jsonl'

    uncertain_samples = []

    with open(corrected_path) as f:
        for line_num, line in enumerate(f, 1):
            sample = json.loads(line.strip())

            if 'domain_expert_review' in sample:
                url_insights = extract_url_insights(sample.get('url', ''))

                uncertain_samples.append({
                    'line': line_num,
                    'title': sample.get('title'),
                    'url': sample.get('url'),
                    'current_label': sample.get('is_council_district'),
                    'url_insights': url_insights
                })

    # Prioritization logic
    priority_queues = {
        'high_priority': [],      # Government domains - likely council districts
        'medium_priority': [],    # ArcGIS hosted - need metadata check
        'low_priority': [],       # Generic titles - need deep investigation
        'international': []       # International jurisdictions
    }

    for sample in uncertain_samples:
        insights = sample['url_insights']
        title = sample['title'].lower()

        # High priority: Government domains (city/county)
        if insights['is_city_gov'] or insights['is_county_gov']:
            priority_queues['high_priority'].append({
                **sample,
                'priority_reason': f"{insights['government_type']} government domain - likely valid council district"
            })

        # International: Needs domain knowledge
        elif insights['country'] != 'unknown':
            priority_queues['international'].append({
                **sample,
                'priority_reason': f"International ({insights['country']}) - validate governance equivalence"
            })

        # Medium priority: ArcGIS hosted - check metadata
        elif insights['government_type'] == 'arcgis_hosted':
            # Check if title has any governance hints
            if any(keyword in title for keyword in ['district', 'ward', 'boundary', 'council']):
                priority_queues['medium_priority'].append({
                    **sample,
                    'priority_reason': 'ArcGIS hosted with governance keywords - check metadata'
                })
            else:
                priority_queues['low_priority'].append({
                    **sample,
                    'priority_reason': 'Generic title on ArcGIS - likely non-governance'
                })

        # State government: Likely FALSE
        elif insights['is_state_gov']:
            priority_queues['low_priority'].append({
                **sample,
                'priority_reason': 'State government domain - likely not city council (unless supervisory districts)'
            })

        # Low priority: Generic domains
        else:
            priority_queues['low_priority'].append({
                **sample,
                'priority_reason': 'Generic domain - requires deep investigation'
            })

    # Print prioritized review queue
    print("=" * 80)
    print("PRIORITIZED MANUAL REVIEW QUEUE")
    print("=" * 80)
    print()

    total_uncertain = len(uncertain_samples)

    print(f"Total Uncertain Samples: {total_uncertain}")
    print()

    for priority, queue in priority_queues.items():
        if queue:
            print("-" * 80)
            print(f"{priority.upper().replace('_', ' ')} ({len(queue)} samples)")
            print("-" * 80)

            for i, item in enumerate(queue[:10], 1):  # Show top 10
                print(f"\n{i}. Line {item['line']}: {item['title'][:60]}")
                print(f"   Current Label: {item['current_label']}")
                print(f"   URL: {item['url'][:80]}...")
                print(f"   Priority Reason: {item['priority_reason']}")

            if len(queue) > 10:
                print(f"\n   ... and {len(queue) - 10} more samples")

            print()

    # Summary statistics
    print("=" * 80)
    print("REVIEW QUEUE SUMMARY")
    print("=" * 80)
    print()

    for priority, queue in priority_queues.items():
        pct = (len(queue) / total_uncertain * 100) if total_uncertain > 0 else 0
        print(f"{priority:20s}: {len(queue):3d} samples ({pct:5.1f}%)")

    print()
    print("Recommended Review Order:")
    print("  1. HIGH PRIORITY: Government domains - quick validation")
    print("  2. INTERNATIONAL: Domain knowledge required")
    print("  3. MEDIUM PRIORITY: ArcGIS metadata check")
    print("  4. LOW PRIORITY: Deep investigation needed")

    # Save prioritized queue
    output = {
        'total_uncertain': total_uncertain,
        'priority_queues': {
            name: [
                {k: v for k, v in item.items() if k != 'url_insights'}
                for item in queue
            ]
            for name, queue in priority_queues.items()
        }
    }

    output_path = '/Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas/agents/langgraph/manual_review_queue.json'
    with open(output_path, 'w') as f:
        json.dump(output, f, indent=2)

    print(f"\nPrioritized queue saved to: {output_path}")


if __name__ == '__main__':
    prioritize_uncertain_samples()
