#!/usr/bin/env python3
"""
Comprehensive District Type Classification

Classifies ALL governance districts by type and tier for Shadow Atlas.
Goal: Maximum granularity - every elected representative district for any address.

Tiers by governance authority:
- GOLD: City/town councils (direct local governance)
- SILVER: County/school boards/state legislative (regional elected bodies)
- BRONZE: Federal/special districts (broader scope, still elected)
- UTILITY: Non-governance service districts (informational only)
- REJECT: Non-district layers (parcels, infrastructure, zoning)
"""
import json
import sys
import re
from typing import Dict, List, Tuple, Optional

# DISTRICT TYPE PATTERNS - Comprehensive governance classification
DISTRICT_PATTERNS = {
    # GOLD TIER - City/Town Council (highest priority for ZK proofs)
    'city_council': {
        'patterns': [
            'city_council', 'town_council', 'municipal_council',
            'council_district', 'council_ward', 'aldermanic',
            'city_ward', 'town_ward', 'village_board'
        ],
        'tier': 'GOLD',
        'governance_level': 'municipal',
        'elected': True,
    },

    # SILVER TIER - County/Regional Legislative
    'county_commission': {
        'patterns': [
            'county_commission', 'county_supervisor', 'county_board',
            'commissioner_district', 'supervisor_district',
            'board_of_supervisors'
        ],
        'tier': 'SILVER',
        'governance_level': 'county',
        'elected': True,
    },

    # SILVER TIER - School Boards (elected education governance)
    'school_board': {
        'patterns': [
            'school_district', 'school_board', 'trustee_area',
            'education_district', 'unified_school', 'elementary_school_district',
            'high_school_district', 'board_of_education'
        ],
        'tier': 'SILVER',
        'governance_level': 'special',
        'elected': True,
    },

    # SILVER TIER - State Legislative
    'state_legislative': {
        'patterns': [
            'state_senate', 'state_house', 'state_assembly',
            'legislative_district', 'assembly_district',
            'senate_district', 'house_district'
        ],
        'tier': 'SILVER',
        'governance_level': 'state',
        'elected': True,
    },

    # BRONZE TIER - Federal Legislative
    'congressional': {
        'patterns': [
            'congressional', 'congress', 'house_of_representatives',
            'senate', 'federal_district'
        ],
        'tier': 'BRONZE',
        'governance_level': 'federal',
        'elected': True,
    },

    # BRONZE TIER - Judicial Districts
    'judicial': {
        'patterns': [
            'judicial_district', 'court_district', 'circuit_court',
            'district_court', 'superior_court'
        ],
        'tier': 'BRONZE',
        'governance_level': 'judicial',
        'elected': False,  # Varies by jurisdiction
    },

    # BRONZE TIER - Fire Districts (often elected boards)
    'fire_district': {
        'patterns': [
            'fire_district', 'fire_protection', 'fire_response',
            'fire_service', 'emergency_services'
        ],
        'tier': 'BRONZE',
        'governance_level': 'special',
        'elected': True,
    },

    # UTILITY TIER - Water/Sewer (informational, rarely elected)
    'water_district': {
        'patterns': [
            'water_district', 'sewer_district', 'wastewater',
            'utility_district', 'sanitation_district', 'stormwater'
        ],
        'tier': 'UTILITY',
        'governance_level': 'special',
        'elected': False,
    },

    # UTILITY TIER - Police/Sheriff (administrative, not electoral districts)
    'police_district': {
        'patterns': [
            'police_district', 'police_zone', 'sheriff',
            'patrol_district', 'police_beat'
        ],
        'tier': 'UTILITY',
        'governance_level': 'administrative',
        'elected': False,
    },

    # UTILITY TIER - Parks/Recreation
    'park_district': {
        'patterns': [
            'park_district', 'recreation_district', 'park_board',
            'rec_district', 'parks_and_recreation'
        ],
        'tier': 'UTILITY',
        'governance_level': 'special',
        'elected': False,
    },

    # BRONZE TIER - Library Districts (sometimes elected)
    'library_district': {
        'patterns': [
            'library_district', 'library_board', 'library_service'
        ],
        'tier': 'BRONZE',
        'governance_level': 'special',
        'elected': True,
    },

    # BRONZE TIER - Hospital/Health Districts
    'health_district': {
        'patterns': [
            'hospital_district', 'health_district', 'healthcare',
            'medical_district', 'public_health'
        ],
        'tier': 'BRONZE',
        'governance_level': 'special',
        'elected': False,
    },

    # UTILITY TIER - Transportation/Transit
    'transit_district': {
        'patterns': [
            'transit_district', 'transportation', 'metro_district',
            'bus_district', 'rail_district'
        ],
        'tier': 'UTILITY',
        'governance_level': 'special',
        'elected': False,
    },

    # REJECT - Census/Statistical (not governance)
    'census': {
        'patterns': [
            'census_tract', 'census_block', 'block_group',
            'statistical_area', 'demographic'
        ],
        'tier': 'REJECT',
        'governance_level': 'statistical',
        'elected': False,
    },

    # REJECT - Administrative boundaries (not districts)
    'boundary': {
        'patterns': [
            'city_boundary', 'county_boundary', 'state_boundary',
            'city_limits', 'jurisdiction', 'municipal_boundary'
        ],
        'tier': 'REJECT',
        'governance_level': 'administrative',
        'elected': False,
    },

    # REJECT - Land use/Zoning (not governance)
    'zoning': {
        'patterns': [
            'zoning', 'land_use', 'landuse', 'zoning_district',
            'overlay_district', 'development_zone'
        ],
        'tier': 'REJECT',
        'governance_level': 'planning',
        'elected': False,
    },

    # REJECT - Tax/Parcel (property records, not governance)
    'parcel': {
        'patterns': [
            'parcel', 'tax_district', 'assessor', 'property',
            'tax_lot', 'assessment'
        ],
        'tier': 'REJECT',
        'governance_level': 'administrative',
        'elected': False,
    },

    # REJECT - Voting precincts (electoral admin, not representation)
    'precinct': {
        'patterns': [
            'precinct', 'polling', 'voting_district', 'election_district',
            'ballot_area'
        ],
        'tier': 'REJECT',
        'governance_level': 'electoral_admin',
        'elected': False,
    },
}

def matches_pattern(text: str, patterns: List[str]) -> bool:
    """Check if text matches any pattern (case-insensitive)"""
    text_lower = text.lower()
    return any(pattern.replace('_', ' ') in text_lower or
               pattern.replace('_', '') in text_lower.replace(' ', '') or
               pattern in text_lower
               for pattern in patterns)

def infer_district_type(layer_name: str, fields: List[str], service_url: str) -> Tuple[str, Dict]:
    """
    Infer district type from layer name, fields, and URL

    Returns: (district_type, metadata)
    """
    layer_lower = layer_name.lower()
    fields_text = ' '.join(fields).lower()
    url_lower = service_url.lower()

    # Check each district pattern
    for district_type, config in DISTRICT_PATTERNS.items():
        if matches_pattern(layer_name, config['patterns']):
            return district_type, config

    # Field-based inference (weaker signal)
    if any(f in fields_text for f in ['council', 'alderman', 'ward']):
        if 'city' in url_lower or 'town' in url_lower:
            return 'city_council', DISTRICT_PATTERNS['city_council']

    if any(f in fields_text for f in ['commissioner', 'supervisor']):
        if 'county' in url_lower:
            return 'county_commission', DISTRICT_PATTERNS['county_commission']

    if any(f in fields_text for f in ['trustee', 'school_board']):
        return 'school_board', DISTRICT_PATTERNS['school_board']

    # Default: unknown (will be rejected later if no governance signals)
    return 'unknown', {
        'tier': 'REJECT',
        'governance_level': 'unknown',
        'elected': False,
    }

def calculate_confidence(layer_name: str, fields: List[str], district_type: str) -> Tuple[int, List[str]]:
    """
    Calculate confidence score for district classification

    Returns: (score 0-100, reasons)
    """
    score = 0
    reasons = []

    layer_lower = layer_name.lower()
    fields_lower = [f.lower() for f in fields]
    fields_text = ' '.join(fields_lower)

    # District type in name (40 points)
    if district_type != 'unknown':
        config = DISTRICT_PATTERNS.get(district_type, {})
        patterns = config.get('patterns', [])
        if matches_pattern(layer_name, patterns):
            score += 40
            reasons.append(f"✓ {district_type} in name")

    # District ID field (20 points)
    if any(f in fields_text for f in ['district', 'ward', 'area', 'zone']):
        score += 20
        reasons.append("✓ District ID field")

    # Representative/Member field (25 points) - STRONG signal for elected bodies
    if any(f in fields_text for f in ['member', 'representative', 'commissioner',
                                       'supervisor', 'trustee', 'councilor', 'alderman']):
        score += 25
        reasons.append("✓ Representative/member field")

    # Name field (5 points)
    if any(f in fields_text for f in ['name', 'label']):
        score += 5
        reasons.append("✓ Name field")

    # Geometry fields (10 points)
    has_id = any(f in fields_lower for f in ['objectid', 'fid', 'id'])
    has_geom = any(f in fields_lower for f in ['shape__area', 'shape__length', 'geometry'])

    if has_id and has_geom:
        score += 10
        reasons.append("✓ Complete schema")

    return score, reasons

def classify_comprehensive(layer: Dict) -> Dict:
    """
    Comprehensive district classification

    Returns enriched layer with:
    - district_type
    - tier (GOLD/SILVER/BRONZE/UTILITY/REJECT)
    - governance_level
    - elected (boolean)
    - confidence score
    """
    layer_name = layer.get('layer_name', '')
    fields = layer.get('fields', [])
    service_url = layer.get('service_url', '')
    geometry_type = layer.get('geometry_type', '')

    # Must be polygon for governance districts
    if geometry_type != 'esriGeometryPolygon':
        return {
            **layer,
            'district_type': 'non_polygon',
            'tier': 'REJECT',
            'governance_level': 'non_governance',
            'elected': False,
            'confidence': 0.0,
            'score': 0,
            'classification_reasons': ['Not polygon geometry']
        }

    # Infer district type
    district_type, type_config = infer_district_type(layer_name, fields, service_url)

    # Calculate confidence
    score, reasons = calculate_confidence(layer_name, fields, district_type)
    confidence = score / 100.0

    # Tier assignment with confidence gating
    tier = type_config['tier']

    # Upgrade/downgrade based on confidence
    if tier in ['GOLD', 'SILVER', 'BRONZE'] and confidence < 0.4:
        tier = 'REJECT'
        reasons.append('✗ Insufficient confidence for governance district')

    return {
        **layer,
        'district_type': district_type,
        'tier': tier,
        'governance_level': type_config['governance_level'],
        'elected': type_config['elected'],
        'confidence': confidence,
        'score': score,
        'classification_reasons': reasons
    }

def main():
    input_file = sys.argv[1] if len(sys.argv) > 1 else 'data/enumerated_layers.jsonl'
    output_file = 'data/comprehensive_classified_layers.jsonl'

    print('=' * 70)
    print('COMPREHENSIVE DISTRICT TYPE CLASSIFICATION')
    print('=' * 70)
    print(f'Input: {input_file}')
    print(f'Output: {output_file}')
    print()

    # Load layers
    layers = []
    with open(input_file, 'r') as f:
        for line in f:
            if line.strip():
                layers.append(json.loads(line))

    print(f'Loaded {len(layers)} layers')
    print()

    # Classify all layers
    results = []
    for layer in layers:
        classified = classify_comprehensive(layer)
        results.append(classified)

    # Statistics by tier
    from collections import Counter

    total = len(results)
    by_tier = Counter(r['tier'] for r in results)
    by_type = Counter(r['district_type'] for r in results)

    print('CLASSIFICATION RESULTS BY TIER')
    print('=' * 70)
    print(f'Total layers: {total}')
    print()

    for tier in ['GOLD', 'SILVER', 'BRONZE', 'UTILITY', 'REJECT']:
        count = by_tier[tier]
        print(f'{tier:12} {count:6} ({count/total*100:5.1f}%)')

    print()
    print('DISTRICT TYPES (Top 20):')
    print('=' * 70)

    for dtype, count in by_type.most_common(20):
        tier = DISTRICT_PATTERNS.get(dtype, {}).get('tier', 'UNKNOWN')
        elected = DISTRICT_PATTERNS.get(dtype, {}).get('elected', False)
        elected_str = '✓' if elected else ' '
        print(f'{dtype:25} {tier:8} {elected_str}  {count:5} ({count/total*100:5.1f}%)')

    print()

    # Elected governance districts only
    elected_districts = [r for r in results if r.get('elected') and r['tier'] in ['GOLD', 'SILVER', 'BRONZE']]

    print(f'ELECTED GOVERNANCE DISTRICTS: {len(elected_districts)} ({len(elected_districts)/total*100:.1f}%)')
    print('=' * 70)

    by_elected_type = Counter(r['district_type'] for r in elected_districts)
    for dtype, count in by_elected_type.most_common():
        tier = DISTRICT_PATTERNS.get(dtype, {}).get('tier', 'UNKNOWN')
        print(f'  {dtype:25} {tier:8} {count:5}')

    print()

    # Save results
    with open(output_file, 'w') as f:
        for result in results:
            f.write(json.dumps(result) + '\n')

    print(f'Saved classified results: {output_file}')
    print('=' * 70)
    print()

    # Samples from each tier
    for tier in ['GOLD', 'SILVER', 'BRONZE']:
        tier_samples = [r for r in results if r['tier'] == tier and r.get('elected')]
        if tier_samples:
            print(f'Sample {tier} tier (elected governance):')
            for layer in sorted(tier_samples, key=lambda x: x['score'], reverse=True)[:3]:
                print(f'\n  {layer["layer_name"]} (type: {layer["district_type"]})')
                print(f'    Score: {layer["score"]}/100')
                print(f'    URL: {layer["layer_url"]}')
                print(f'    Reasons: {", ".join(layer["classification_reasons"][:3])}')
            print()

if __name__ == '__main__':
    main()
