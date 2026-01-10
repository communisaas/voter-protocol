/**
 * Council District Edge Case Detection & Resolution
 *
 * EMPIRICAL FINDINGS from validated_layers.jsonl analysis:
 *
 * FALSE POSITIVE PATTERNS:
 * 1. "Parcels" - Has "District field" but is property parcels
 * 2. "Volunteer_Fire_District" - District in name, but fire service areas
 * 3. "SCHOOL_DISTRICT" - Educational, not political
 * 4. "VOTING_PRECINCT" - VTDs, finer grain than council districts
 * 5. "Hydro_Poly" - Infrastructure/environmental layers
 * 6. "Recreation_Parks" - Parks/facilities
 * 7. "SUBDIVISION" - Real estate subdivisions
 *
 * AMBIGUOUS CASES:
 * 1. "BOS" - Board of Supervisors (valid in SF, but unclear elsewhere)
 * 2. "City Wards" - Usually valid, but need city context
 * 3. "Housing_Database_by_City_Council" - Aggregated data, not boundaries
 *
 * RESOLUTION STRATEGY:
 * - Layer 1: Explicit rejection patterns (high confidence rejection)
 * - Layer 2: Required positive signals (must have council/ward in name OR field)
 * - Layer 3: City attribution (match to Census Place FIPS)
 * - Layer 4: Expected count validation (final gate)
 */

// =============================================================================
// Types
// =============================================================================

export interface EdgeCaseAnalysis {
  /** Layer URL being analyzed */
  readonly url: string;

  /** Layer name */
  readonly name: string;

  /** Edge case classification */
  readonly classification: EdgeCaseType;

  /** Confidence in classification (0-100) */
  readonly confidence: number;

  /** Resolution action */
  readonly action: 'ACCEPT' | 'REJECT' | 'NEEDS_CITY_CONTEXT' | 'NEEDS_MANUAL_REVIEW';

  /** Detailed reasoning */
  readonly reasoning: string[];

  /** Suggested city FIPS if identifiable */
  readonly suggestedCityFips?: string;

  /** Warnings for human review */
  readonly warnings: string[];
}

export type EdgeCaseType =
  | 'TRUE_POSITIVE'           // Definitely council districts
  | 'FALSE_POSITIVE_SERVICE'  // Fire, police, utility districts
  | 'FALSE_POSITIVE_PROPERTY' // Parcels, subdivisions
  | 'FALSE_POSITIVE_INFRA'    // Hydrology, roads, facilities
  | 'FALSE_POSITIVE_CENSUS'   // VTDs, tracts, blocks
  | 'FALSE_POSITIVE_SCHOOL'   // School districts (different layer)
  | 'AMBIGUOUS_BOS'           // Board of Supervisors (city-dependent)
  | 'AMBIGUOUS_WARD'          // Wards without clear city context
  | 'HISTORICAL_VERSION'      // Outdated vintage (e.g., 2016 vs 2021)
  | 'AGGREGATED_DATA'         // Statistics by district, not boundaries
  | 'DUPLICATE'               // Same data from different URL
  | 'UNKNOWN';

// =============================================================================
// Rejection Patterns (High Confidence Exclusions)
// =============================================================================

/**
 * Explicit rejection patterns - if ANY match, reject immediately
 */
const REJECTION_PATTERNS: readonly { pattern: RegExp; type: EdgeCaseType; reason: string }[] = [
  // Service districts (not political)
  { pattern: /fire.*district|district.*fire/i, type: 'FALSE_POSITIVE_SERVICE', reason: 'Fire service district, not city council' },
  { pattern: /police.*district|district.*police/i, type: 'FALSE_POSITIVE_SERVICE', reason: 'Police district, not city council' },
  { pattern: /utility.*district/i, type: 'FALSE_POSITIVE_SERVICE', reason: 'Utility district, not city council' },
  { pattern: /water.*district/i, type: 'FALSE_POSITIVE_SERVICE', reason: 'Water district, not city council' },
  { pattern: /sewer.*district/i, type: 'FALSE_POSITIVE_SERVICE', reason: 'Sewer district, not city council' },
  { pattern: /sanitation/i, type: 'FALSE_POSITIVE_SERVICE', reason: 'Sanitation district, not city council' },
  { pattern: /ambulance|ems|emergency/i, type: 'FALSE_POSITIVE_SERVICE', reason: 'Emergency services district' },
  { pattern: /hospital.*district/i, type: 'FALSE_POSITIVE_SERVICE', reason: 'Hospital district' },

  // Property/real estate
  { pattern: /\bparcel/i, type: 'FALSE_POSITIVE_PROPERTY', reason: 'Property parcels, not council districts' },
  { pattern: /subdivision/i, type: 'FALSE_POSITIVE_PROPERTY', reason: 'Real estate subdivision' },
  { pattern: /\blot\b/i, type: 'FALSE_POSITIVE_PROPERTY', reason: 'Property lots' },
  { pattern: /zoning/i, type: 'FALSE_POSITIVE_PROPERTY', reason: 'Zoning districts, not council' },
  { pattern: /land.*use/i, type: 'FALSE_POSITIVE_PROPERTY', reason: 'Land use designation' },

  // Infrastructure/environmental
  { pattern: /hydro/i, type: 'FALSE_POSITIVE_INFRA', reason: 'Hydrology layer' },
  { pattern: /\bpark\b|recreation/i, type: 'FALSE_POSITIVE_INFRA', reason: 'Parks/recreation facilities' },
  { pattern: /road|street|highway/i, type: 'FALSE_POSITIVE_INFRA', reason: 'Transportation infrastructure' },
  { pattern: /building|structure/i, type: 'FALSE_POSITIVE_INFRA', reason: 'Building footprints' },
  { pattern: /facility|facilities/i, type: 'FALSE_POSITIVE_INFRA', reason: 'Facilities layer' },
  { pattern: /flood.*zone/i, type: 'FALSE_POSITIVE_INFRA', reason: 'Flood zone, not council' },

  // Census/electoral (different granularity)
  { pattern: /voting.*precinct|precinct.*voting/i, type: 'FALSE_POSITIVE_CENSUS', reason: 'Voting precincts (VTDs), finer than council' },
  { pattern: /census.*tract|tract.*census/i, type: 'FALSE_POSITIVE_CENSUS', reason: 'Census tracts, not council' },
  { pattern: /census.*block/i, type: 'FALSE_POSITIVE_CENSUS', reason: 'Census blocks, not council' },
  { pattern: /\bvtd\b/i, type: 'FALSE_POSITIVE_CENSUS', reason: 'Voting Tabulation Districts' },
  { pattern: /congressional/i, type: 'FALSE_POSITIVE_CENSUS', reason: 'Congressional districts (federal, not city)' },
  { pattern: /state.*house|state.*senate/i, type: 'FALSE_POSITIVE_CENSUS', reason: 'State legislative (not city council)' },

  // School districts (separate layer in Shadow Atlas)
  { pattern: /school.*district|district.*school/i, type: 'FALSE_POSITIVE_SCHOOL', reason: 'School districts (separate layer)' },
  { pattern: /\bisd\b|\busd\b/i, type: 'FALSE_POSITIVE_SCHOOL', reason: 'Independent/Unified School District' },
  { pattern: /elementary|secondary|high.*school/i, type: 'FALSE_POSITIVE_SCHOOL', reason: 'School-related boundary' },

  // Aggregated data (not geometry)
  { pattern: /database|statistics|demographics/i, type: 'AGGREGATED_DATA', reason: 'Aggregated data, not boundary geometry' },
  { pattern: /housing.*database/i, type: 'AGGREGATED_DATA', reason: 'Housing statistics by district' },
  { pattern: /crime.*by|by.*district.*crime/i, type: 'AGGREGATED_DATA', reason: 'Crime statistics by district' },
];

/**
 * Required positive signals - at least ONE must be present
 */
const REQUIRED_POSITIVE_PATTERNS: readonly { pattern: RegExp; weight: number }[] = [
  { pattern: /city.*council/i, weight: 30 },
  { pattern: /council.*district/i, weight: 30 },
  { pattern: /\bward\b/i, weight: 25 },
  { pattern: /alderman|aldermanic/i, weight: 30 },
  { pattern: /supervisor.*district/i, weight: 25 },  // SF-style
  { pattern: /borough/i, weight: 20 },  // NYC boroughs, though not exactly council
  { pattern: /council.*member/i, weight: 25 },
  { pattern: /commissioner.*district/i, weight: 25 },  // County commissioner districts
  { pattern: /county.*commissioner/i, weight: 25 },
  { pattern: /city.*ward/i, weight: 30 },
  { pattern: /city_council/i, weight: 30 },  // Underscore variant
  { pattern: /council_district/i, weight: 30 },  // Underscore variant
  { pattern: /\bcity\s+council\b/i, weight: 30 },
];

/**
 * Weak positive signals - boost confidence but don't require
 */
const WEAK_POSITIVE_PATTERNS: readonly { pattern: RegExp; weight: number }[] = [
  { pattern: /council/i, weight: 10 },
  { pattern: /district/i, weight: 5 },
  { pattern: /boundary|boundaries/i, weight: 5 },
  { pattern: /electoral/i, weight: 10 },
  { pattern: /representative/i, weight: 10 },
  { pattern: /elected/i, weight: 10 },
];

// =============================================================================
// City Name Patterns for Attribution
// =============================================================================

/**
 * Top 100 US cities for URL/name matching
 */
const CITY_PATTERNS: readonly { name: string; patterns: RegExp[]; fips: string }[] = [
  { name: 'New York', patterns: [/new.*york|nyc|\bnyc\b/i], fips: '3651000' },
  { name: 'Los Angeles', patterns: [/los.*angeles|\bla\b.*city/i], fips: '0644000' },
  { name: 'Chicago', patterns: [/chicago/i], fips: '1714000' },
  { name: 'Houston', patterns: [/houston/i], fips: '4835000' },
  { name: 'Phoenix', patterns: [/phoenix/i], fips: '0455000' },
  { name: 'Philadelphia', patterns: [/philadelphia|phila|philly/i], fips: '4260000' },
  { name: 'San Antonio', patterns: [/san.*antonio/i], fips: '4865000' },
  { name: 'San Diego', patterns: [/san.*diego/i], fips: '0666000' },
  { name: 'Dallas', patterns: [/dallas/i], fips: '4819000' },
  { name: 'San Jose', patterns: [/san.*jose/i], fips: '0668000' },
  { name: 'Austin', patterns: [/austin/i], fips: '4805000' },
  { name: 'Jacksonville', patterns: [/jacksonville/i], fips: '1235000' },
  { name: 'Fort Worth', patterns: [/fort.*worth/i], fips: '4827000' },
  { name: 'Columbus', patterns: [/columbus/i], fips: '3918000' },
  { name: 'San Francisco', patterns: [/san.*francisco|\bsf\b/i], fips: '0667000' },
  { name: 'Charlotte', patterns: [/charlotte/i], fips: '3712000' },
  { name: 'Indianapolis', patterns: [/indianapolis|indy/i], fips: '1836003' },
  { name: 'Seattle', patterns: [/seattle/i], fips: '5363000' },
  { name: 'Denver', patterns: [/denver/i], fips: '0820000' },
  { name: 'Washington DC', patterns: [/washington.*dc|\bdc\b.*gov/i], fips: '1150000' },
  { name: 'Boston', patterns: [/boston/i], fips: '2507000' },
  { name: 'Nashville', patterns: [/nashville/i], fips: '4752006' },
  { name: 'Detroit', patterns: [/detroit/i], fips: '2622000' },
  { name: 'Portland', patterns: [/portland.*or/i], fips: '4159000' },
  { name: 'Las Vegas', patterns: [/las.*vegas/i], fips: '3240000' },
  { name: 'Memphis', patterns: [/memphis/i], fips: '4748000' },
  { name: 'Louisville', patterns: [/louisville/i], fips: '2148006' },
  { name: 'Baltimore', patterns: [/baltimore/i], fips: '2404000' },
  { name: 'Milwaukee', patterns: [/milwaukee/i], fips: '5553000' },
  { name: 'Albuquerque', patterns: [/albuquerque/i], fips: '3502000' },
  { name: 'Tucson', patterns: [/tucson/i], fips: '0477000' },
  { name: 'Sacramento', patterns: [/sacramento/i], fips: '0664000' },
  { name: 'Kansas City', patterns: [/kansas.*city/i], fips: '2938000' },
  { name: 'Atlanta', patterns: [/atlanta/i], fips: '1304000' },
  { name: 'Raleigh', patterns: [/raleigh/i], fips: '3755000' },
  { name: 'Oakland', patterns: [/oakland/i], fips: '0653000' },
  { name: 'Minneapolis', patterns: [/minneapolis/i], fips: '2743000' },
  { name: 'Cleveland', patterns: [/cleveland/i], fips: '3916000' },
  { name: 'Tampa', patterns: [/tampa/i], fips: '1271000' },
  { name: 'New Orleans', patterns: [/new.*orleans/i], fips: '2255000' },
  { name: 'Cincinnati', patterns: [/cincinnati/i], fips: '3915000' },
  { name: 'Pittsburgh', patterns: [/pittsburgh/i], fips: '4261000' },
  { name: 'St. Louis', patterns: [/st\.?\s*louis|saint.*louis/i], fips: '2965000' },
  { name: 'Orlando', patterns: [/orlando/i], fips: '1253000' },
];

// =============================================================================
// Edge Case Analyzer
// =============================================================================

export class EdgeCaseAnalyzer {
  /**
   * Analyze a layer for edge cases
   */
  analyze(
    url: string,
    name: string,
    featureCount: number,
    fields?: readonly string[],
    originalConfidence?: number
  ): EdgeCaseAnalysis {
    const reasoning: string[] = [];
    const warnings: string[] = [];

    // Combine URL and name for pattern matching
    const searchText = `${url} ${name}`.toLowerCase();

    // =========================================================================
    // Layer 1: Explicit Rejection Patterns
    // =========================================================================
    for (const rejection of REJECTION_PATTERNS) {
      if (rejection.pattern.test(searchText)) {
        return {
          url,
          name,
          classification: rejection.type,
          confidence: 95,
          action: 'REJECT',
          reasoning: [rejection.reason],
          warnings: [],
        };
      }
    }

    // =========================================================================
    // Layer 2: Required Positive Signals
    // =========================================================================
    let positiveScore = 0;
    let hasStrongPositive = false;

    for (const positive of REQUIRED_POSITIVE_PATTERNS) {
      if (positive.pattern.test(searchText)) {
        positiveScore += positive.weight;
        hasStrongPositive = true;
        reasoning.push(`Strong positive: ${positive.pattern.source} matched`);
      }
    }

    for (const weak of WEAK_POSITIVE_PATTERNS) {
      if (weak.pattern.test(searchText)) {
        positiveScore += weak.weight;
        reasoning.push(`Weak positive: ${weak.pattern.source} matched`);
      }
    }

    // If no strong positive signal, likely false positive
    if (!hasStrongPositive) {
      return {
        url,
        name,
        classification: 'UNKNOWN',
        confidence: 30,
        action: 'REJECT',
        reasoning: ['No strong positive signal (council/ward/district) found'],
        warnings: ['Consider manual review if this is a known council district source'],
      };
    }

    // =========================================================================
    // Layer 3: City Attribution
    // =========================================================================
    let cityFips: string | undefined;
    let cityName: string | undefined;

    for (const city of CITY_PATTERNS) {
      for (const pattern of city.patterns) {
        if (pattern.test(searchText)) {
          cityFips = city.fips;
          cityName = city.name;
          reasoning.push(`City identified: ${city.name} (FIPS: ${city.fips})`);
          break;
        }
      }
      if (cityFips) break;
    }

    if (!cityFips) {
      warnings.push('Could not identify city from URL/name - manual attribution needed');
    }

    // =========================================================================
    // Layer 4: Historical/Duplicate Detection
    // =========================================================================
    const yearMatch = name.match(/\b(19|20)\d{2}\b/);
    const currentYear = new Date().getFullYear();

    if (yearMatch) {
      const dataYear = parseInt(yearMatch[0], 10);
      if (dataYear < currentYear - 3) {
        warnings.push(`Possibly outdated: data year ${dataYear} (current: ${currentYear})`);

        // If there's a much older version, flag as historical
        if (dataYear < currentYear - 5) {
          return {
            url,
            name,
            classification: 'HISTORICAL_VERSION',
            confidence: 60,
            action: 'REJECT',
            reasoning: [`Data vintage ${dataYear} is more than 5 years old`],
            warnings: ['Check for newer version of this dataset'],
            suggestedCityFips: cityFips,
          };
        }
      }
    }

    // =========================================================================
    // Layer 5: Feature Count Reasonableness
    // =========================================================================
    // NOTE: ArcGIS Hub crawler returns placeholder values (1000, 2000) for many layers
    // These should not trigger rejection - they indicate "unknown" count
    const PLACEHOLDER_COUNTS = [1000, 2000];
    const isPlaceholderCount = PLACEHOLDER_COUNTS.includes(featureCount);

    if (isPlaceholderCount) {
      warnings.push(`Feature count ${featureCount} is likely a placeholder - verify actual count from source`);
    } else if (featureCount < 3) {
      warnings.push(`Very low feature count (${featureCount}) - may be incomplete or at-large city`);
    } else if (featureCount > 60) {
      // Cincinnati had 74 "community councils" - classic wrong granularity
      warnings.push(`High feature count (${featureCount}) - verify this isn't neighborhoods/precincts`);

      // If >100 and NOT a placeholder, almost certainly wrong granularity
      if (featureCount > 100) {
        return {
          url,
          name,
          classification: 'FALSE_POSITIVE_CENSUS',
          confidence: 85,
          action: 'REJECT',
          reasoning: [`Feature count ${featureCount} too high for council districts (typical: 5-51)`],
          warnings: ['Likely precincts, neighborhoods, or census tracts'],
          suggestedCityFips: cityFips,
        };
      }
    }

    // =========================================================================
    // Final Classification
    // =========================================================================
    const baseConfidence = positiveScore;
    const cityBonus = cityFips ? 15 : 0;
    const finalConfidence = Math.min(95, baseConfidence + cityBonus);

    // Very high confidence with city context → ACCEPT
    if (finalConfidence >= 70 && cityFips) {
      return {
        url,
        name,
        classification: 'TRUE_POSITIVE',
        confidence: finalConfidence,
        action: 'ACCEPT',
        reasoning,
        warnings,
        suggestedCityFips: cityFips,
      };
    }

    // Very high base confidence (>=60) but no city → provisional accept with warning
    // These are clearly council districts, just need city attribution
    if (baseConfidence >= 60 && !cityFips) {
      return {
        url,
        name,
        classification: 'TRUE_POSITIVE',
        confidence: Math.min(95, baseConfidence),
        action: 'NEEDS_CITY_CONTEXT',
        reasoning,
        warnings: [...warnings, 'High confidence but city attribution required for Merkle commitment'],
        suggestedCityFips: undefined,
      };
    }

    // Moderate confidence with city → ACCEPT with verification warning
    if (finalConfidence >= 50 && cityFips) {
      return {
        url,
        name,
        classification: 'TRUE_POSITIVE',
        confidence: finalConfidence,
        action: 'ACCEPT',
        reasoning,
        warnings: [...warnings, 'Moderate confidence - verify before Merkle commitment'],
        suggestedCityFips: cityFips,
      };
    }

    // Moderate confidence without city → needs context
    if (baseConfidence >= 30) {
      return {
        url,
        name,
        classification: 'AMBIGUOUS_WARD',
        confidence: baseConfidence,
        action: 'NEEDS_CITY_CONTEXT',
        reasoning,
        warnings: [...warnings, 'Moderate confidence - needs city attribution'],
        suggestedCityFips: cityFips,
      };
    }

    return {
      url,
      name,
      classification: 'UNKNOWN',
      confidence: finalConfidence,
      action: 'NEEDS_MANUAL_REVIEW',
      reasoning,
      warnings: [...warnings, 'Low confidence - manual review required'],
      suggestedCityFips: cityFips,
    };
  }

  /**
   * Batch analyze multiple layers and return summary
   */
  batchAnalyze(
    layers: readonly { url: string; name: string; featureCount: number }[]
  ): {
    results: readonly EdgeCaseAnalysis[];
    summary: {
      total: number;
      accepted: number;
      rejected: number;
      needsReview: number;
      byClassification: Record<EdgeCaseType, number>;
    };
  } {
    const results = layers.map(l => this.analyze(l.url, l.name, l.featureCount));

    const byClassification: Record<EdgeCaseType, number> = {
      TRUE_POSITIVE: 0,
      FALSE_POSITIVE_SERVICE: 0,
      FALSE_POSITIVE_PROPERTY: 0,
      FALSE_POSITIVE_INFRA: 0,
      FALSE_POSITIVE_CENSUS: 0,
      FALSE_POSITIVE_SCHOOL: 0,
      AMBIGUOUS_BOS: 0,
      AMBIGUOUS_WARD: 0,
      HISTORICAL_VERSION: 0,
      AGGREGATED_DATA: 0,
      DUPLICATE: 0,
      UNKNOWN: 0,
    };

    for (const result of results) {
      byClassification[result.classification]++;
    }

    return {
      results,
      summary: {
        total: results.length,
        accepted: results.filter(r => r.action === 'ACCEPT').length,
        rejected: results.filter(r => r.action === 'REJECT').length,
        needsReview: results.filter(r =>
          r.action === 'NEEDS_CITY_CONTEXT' || r.action === 'NEEDS_MANUAL_REVIEW'
        ).length,
        byClassification,
      },
    };
  }
}

// =============================================================================
// Exports
// =============================================================================

export {
  REJECTION_PATTERNS,
  REQUIRED_POSITIVE_PATTERNS,
  CITY_PATTERNS,
};
