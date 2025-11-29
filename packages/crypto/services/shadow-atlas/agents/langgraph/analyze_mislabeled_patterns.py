#!/usr/bin/env python3
"""
Deep dive analysis of mislabeled samples to understand patterns
"""

import json
import re
from collections import defaultdict

def analyze_mislabeling_patterns():
    """Analyze why samples are mislabeled"""

    file_path = '/Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas/agents/data/ml_training_data_enriched.jsonl'

    patterns = {
        'false_negatives': [],  # Should be TRUE but labeled FALSE
        'false_positives': [],  # Should be FALSE but labeled TRUE
        'weak_signals': [],     # Ambiguous titles that fooled classifier
    }

    # Keywords that indicate TRUE city council
    true_indicators = [
        'city council', 'town council', 'aldermanic', 'supervisory district',
        'county council', 'council district', 'ward', 'borough council'
    ]

    # Keywords that indicate FALSE (not city council)
    false_indicators = [
        "governor's council", 'executive council', 'congressional',
        'senate district', 'house district', 'legislative district',
        'school board', 'fire district', 'planning district'
    ]

    with open(file_path, 'r') as f:
        for line_num, line in enumerate(f, 1):
            sample = json.loads(line.strip())
            title = sample.get('title', '').lower()
            label = sample.get('is_council_district')

            has_true_signal = any(indicator in title for indicator in true_indicators)
            has_false_signal = any(indicator in title for indicator in false_indicators)

            # FALSE NEGATIVES: Clear city council signals but labeled FALSE
            if label == False and has_true_signal and not has_false_signal:
                patterns['false_negatives'].append({
                    'line': line_num,
                    'title': sample.get('title'),
                    'url': sample.get('url', '')[:100],
                    'signals': [ind for ind in true_indicators if ind in title]
                })

            # FALSE POSITIVES: Should be FALSE but labeled TRUE
            elif label == True and has_false_signal:
                patterns['false_positives'].append({
                    'line': line_num,
                    'title': sample.get('title'),
                    'url': sample.get('url', '')[:100],
                    'signals': [ind for ind in false_indicators if ind in title]
                })

            # WEAK SIGNALS: No clear indicators
            elif not has_true_signal and not has_false_signal:
                patterns['weak_signals'].append({
                    'line': line_num,
                    'title': sample.get('title'),
                    'label': label,
                    'url': sample.get('url', '')[:100]
                })

    # Print analysis
    print("=" * 80)
    print("MISLABELING PATTERN ANALYSIS")
    print("=" * 80)
    print()

    print(f"FALSE NEGATIVES: {len(patterns['false_negatives'])} samples")
    print("(Strong city council signals but labeled FALSE)")
    print("-" * 80)
    for item in patterns['false_negatives'][:20]:
        print(f"\nLine {item['line']}: {item['title']}")
        print(f"  Signals: {', '.join(item['signals'])}")
        print(f"  URL: {item['url']}")

    print("\n\n" + "=" * 80)
    print(f"FALSE POSITIVES: {len(patterns['false_positives'])} samples")
    print("(Should be FALSE but labeled TRUE)")
    print("-" * 80)
    for item in patterns['false_positives']:
        print(f"\nLine {item['line']}: {item['title']}")
        print(f"  False signals: {', '.join(item['signals'])}")
        print(f"  URL: {item['url']}")

    print("\n\n" + "=" * 80)
    print(f"WEAK SIGNALS: {len(patterns['weak_signals'])} samples")
    print("(No clear indicators - requires context from URL/metadata)")
    print("-" * 80)
    for item in patterns['weak_signals'][:20]:
        print(f"\nLine {item['line']}: {item['title']} (label={item['label']})")
        print(f"  URL: {item['url']}")

    # Analyze URL patterns for weak signals
    print("\n\n" + "=" * 80)
    print("URL PATTERN ANALYSIS FOR WEAK SIGNALS")
    print("-" * 80)

    url_domains = defaultdict(list)
    for item in patterns['weak_signals']:
        # Extract domain
        match = re.search(r'https?://([^/]+)', item['url'])
        if match:
            domain = match.group(1)
            url_domains[domain].append(item)

    for domain, items in sorted(url_domains.items(), key=lambda x: -len(x[1]))[:10]:
        print(f"\n{domain}: {len(items)} samples")
        for item in items[:3]:
            print(f"  - {item['title'][:60]}")

if __name__ == '__main__':
    analyze_mislabeling_patterns()
