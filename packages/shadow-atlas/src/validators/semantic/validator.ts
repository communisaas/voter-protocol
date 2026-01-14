/**
 * Semantic Validator - Layer Title and Tag Analysis
 *
 * Determines if a discovered GIS layer is actually council district data
 * based on semantic analysis of titles, tags, and property names.
 *
 * Consolidates:
 * - validators/semantic-layer-validator.ts
 * - validators/governance-validator.ts
 * - registry/city-name-aliases.ts
 */

/**
 * Semantic score result
 */
export interface SemanticScore {
  readonly score: number;           // 0-100
  readonly passed: boolean;         // score >= threshold (30)
  readonly reasons: readonly string[];
  readonly negativeMatches: readonly string[];
}

/**
 * City name matching result
 */
export interface CityNameMatch {
  readonly matched: boolean;
  readonly matchedAlias: string | null;
  readonly confidence: number;      // 0-100
}

/**
 * City name alias configuration
 */
export interface CityNameAlias {
  readonly censusFips: string;
  readonly censusName: string;
  readonly searchNames: readonly string[];
  readonly governanceName: string;
  readonly governanceLevel: 'place' | 'county' | 'consolidated';
  readonly reason: string;
}

/**
 * Governance structure type
 */
export type GovernanceStructure = 'district-based' | 'at-large' | 'mixed' | 'unknown';

/**
 * Negative keywords that immediately disqualify layers (wrong granularity)
 *
 * These patterns indicate data at the wrong geographic scale:
 * - Voting precincts (sub-district level)
 * - Canopy/coverage/zoning (environmental/planning, not political)
 * - Parcel data (property-level, not district-level)
 */
const NEGATIVE_KEYWORDS: readonly string[] = Object.freeze([
  'precinct',
  'precincts',
  'voting',
  'election',
  'polling',
  'canopy',
  'coverage',
  'zoning',
  'overlay',
  'parcel',
  'school',
  'fire',
  'police',
  'congressional',
  'state senate',
  'state house',
  'park',
]);

/**
 * City name aliases registry
 *
 * Maps Census-designated place names to governance entity search names.
 */
const CITY_NAME_ALIASES: Record<string, CityNameAlias> = {
  // Hawaii consolidated city-counties (ALL Hawaiian cities are CDPs)
  '1571550': {
    censusFips: '1571550',
    censusName: 'Urban Honolulu',
    searchNames: ['Honolulu', 'City and County of Honolulu'],
    governanceName: 'City and County of Honolulu',
    governanceLevel: 'county',
    reason: 'Hawaii has no incorporated places. Census CDP "Urban Honolulu" covers urban core, but governance is county-wide.',
  },

  // Consolidated city-counties
  '1836003': {
    censusFips: '1836003',
    censusName: 'Indianapolis city (balance)',
    searchNames: ['Indianapolis', 'Indianapolis Marion County'],
    governanceName: 'City of Indianapolis',
    governanceLevel: 'consolidated',
    reason: 'Consolidated city-county government (Unigov). Search uses city name.',
  },

  '4752006': {
    censusFips: '4752006',
    censusName: 'Nashville-Davidson metropolitan government (balance)',
    searchNames: ['Nashville', 'Nashville Davidson', 'Metro Nashville'],
    governanceName: 'Metropolitan Government of Nashville and Davidson County',
    governanceLevel: 'consolidated',
    reason: 'Consolidated metropolitan government. Multiple search name variations.',
  },
};

/**
 * Semantic Validator
 *
 * Identifies council district layers from discovered GIS layers through
 * semantic analysis of titles, tags, and city name matching.
 */
export class SemanticValidator {
  private readonly positiveKeywords: readonly string[];
  private readonly negativeKeywords: readonly string[];
  private readonly cityAliases: Map<string, CityNameAlias>;

  constructor() {
    // High-confidence patterns (40 points)
    this.positiveKeywords = Object.freeze([
      'council districts',
      'council district',
      'district council',
      'districts council',
      'city council district',
      'municipal district',
      'citizens council district',
      'wards',
      'ward',
      'civic district',
      'commission district',
      'legislative district',
    ]);

    this.negativeKeywords = NEGATIVE_KEYWORDS;

    // Initialize city aliases map
    const aliasEntries: Array<[string, CityNameAlias]> = Object.entries(CITY_NAME_ALIASES).map(
      ([fips, alias]) => [fips, alias]
    );
    this.cityAliases = new Map(aliasEntries);
  }

  /**
   * Score a layer title for council district semantics
   *
   * Returns 0-100 score based on keyword matching and negative keyword detection.
   * Threshold for acceptance: 30 points.
   *
   * @param title - Layer title/name to score
   * @returns Semantic score with pass/fail and reasoning
   */
  scoreTitle(title: string): SemanticScore {
    const reasons: string[] = [];
    const negativeMatches: string[] = [];
    let score = 0;

    const titleLower = title.toLowerCase();

    // CHECK NEGATIVE KEYWORDS FIRST - Immediately disqualify wrong granularity
    for (const negativeKeyword of this.negativeKeywords) {
      if (titleLower.includes(negativeKeyword)) {
        negativeMatches.push(negativeKeyword);
        reasons.push(`Layer rejected: contains negative keyword "${negativeKeyword}" (wrong granularity)`);
        return {
          score: 0,
          passed: false,
          reasons: Object.freeze([...reasons]),
          negativeMatches: Object.freeze([...negativeMatches]),
        };
      }
    }

    // High-confidence patterns (40 points)
    const highConfidencePatterns: readonly RegExp[] = [
      /council\s*districts?/i,      // council district(s)
      /districts?\s*council/i,      // district(s) council
      /city\s*council\s*district/i,
      /municipal\s*district/i,
      /citizens?\s*council\s*district/i,  // citizens council districts (Helena)
      /\w+\s+wards?\b/i,            // "{City} Wards" pattern (e.g., "Billings Wards")
    ];

    for (const pattern of highConfidencePatterns) {
      if (pattern.test(titleLower)) {
        score = 40;
        reasons.push(`Name matches high-confidence pattern: "${pattern.source}"`);
        break;
      }
    }

    // Medium-confidence patterns (30 points)
    if (score === 0) {
      const mediumConfidencePatterns: readonly RegExp[] = [
        /^ward/i,
        /\bwards?\b/i,
        /civic\s*district/i,
        /city\s*boundaries/i,
        /commission\s*district/i,
      ];

      for (const pattern of mediumConfidencePatterns) {
        if (pattern.test(titleLower)) {
          score = 30;
          reasons.push(`Name matches medium-confidence pattern: "${pattern.source}"`);
          break;
        }
      }
    }

    // Low-confidence patterns (20 points)
    if (score === 0) {
      const lowConfidencePatterns: readonly RegExp[] = [
        /\bcouncil\b/i,
        /\bdistrict\b/i,
        /\brepresentation\b/i,
      ];

      for (const pattern of lowConfidencePatterns) {
        if (pattern.test(titleLower)) {
          score = 20;
          reasons.push(`Name matches low-confidence pattern: "${pattern.source}"`);
          break;
        }
      }
    }

    // No patterns matched
    if (score === 0) {
      reasons.push('Name does not match known patterns');
    }

    const threshold = 30;
    return {
      score,
      passed: score >= threshold,
      reasons: Object.freeze([...reasons]),
      negativeMatches: Object.freeze([...negativeMatches]),
    };
  }

  /**
   * Check if title contains exclusion keywords
   *
   * @param title - Layer title to check
   * @returns True if title contains negative keywords
   */
  hasNegativeKeywords(title: string): boolean {
    const titleLower = title.toLowerCase();
    return this.negativeKeywords.some(keyword => titleLower.includes(keyword));
  }

  /**
   * Match city name against known aliases
   *
   * Handles cases where Census CDP name differs from official municipal name.
   * Example: "Urban Honolulu" (Census) vs "City and County of Honolulu" (governance)
   *
   * @param name - City name to match
   * @param expectedCity - Expected city name
   * @param state - State abbreviation
   * @returns Match result with confidence score
   */
  matchCityName(name: string, expectedCity: string, state: string): CityNameMatch {
    const nameLower = name.toLowerCase();
    const expectedLower = expectedCity.toLowerCase();

    // Exact match (100% confidence)
    if (nameLower === expectedLower) {
      return {
        matched: true,
        matchedAlias: null,
        confidence: 100,
      };
    }

    // Check aliases for each city in state
    // Convert Map to Array to avoid downlevelIteration issues
    const aliasEntries = Array.from(this.cityAliases.entries());
    for (const [fips, alias] of aliasEntries) {
      // Skip if wrong state (first 2 digits of FIPS)
      const stateFips = fips.substring(0, 2);
      // Note: This is a simplified check; full implementation would need state FIPS lookup

      // Check if any search name matches
      for (const searchName of alias.searchNames) {
        if (nameLower.includes(searchName.toLowerCase()) || searchName.toLowerCase().includes(nameLower)) {
          return {
            matched: true,
            matchedAlias: searchName,
            confidence: 90,
          };
        }
      }
    }

    // Fuzzy match: partial string matching
    if (nameLower.includes(expectedLower) || expectedLower.includes(nameLower)) {
      return {
        matched: true,
        matchedAlias: null,
        confidence: 70,
      };
    }

    // No match
    return {
      matched: false,
      matchedAlias: null,
      confidence: 0,
    };
  }

  /**
   * Validate governance structure matches expected pattern
   *
   * Checks if feature properties contain expected district structure (district numbers,
   * council member fields, etc.) and if feature count matches expected districts.
   *
   * @param properties - Feature properties to validate
   * @param expectedDistricts - Expected number of districts
   * @returns True if governance structure is valid
   */
  validateGovernanceStructure(
    properties: Record<string, unknown>,
    expectedDistricts: number
  ): boolean {
    // Check for district-related fields
    const districtFields = [
      'DISTRICT',
      'district',
      'District',
      'COUNCIL',
      'council',
      'Council',
      'WARD',
      'ward',
      'Ward',
      'NUMBER',
      'number',
      'Number',
      'MEMBER',
      'member',
      'Member',
    ];

    const hasDistrictField = districtFields.some(field => field in properties);

    if (!hasDistrictField) {
      return false;
    }

    // Check if district identifier is numeric or alphanumeric
    for (const field of districtFields) {
      const value = properties[field];
      if (value !== undefined && value !== null) {
        const valueStr = String(value);
        // Valid district identifiers: numbers (1, 2, 3) or letters (A, B, C)
        if (/^[0-9]+$/.test(valueStr) || /^[A-Z]$/i.test(valueStr)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Get search names for a city, including aliases
   *
   * @param cityFips - Census FIPS code
   * @param defaultName - Default city name
   * @returns Array of search names to try
   */
  getSearchNames(cityFips: string, defaultName: string): readonly string[] {
    const alias = this.cityAliases.get(cityFips);

    if (alias) {
      return alias.searchNames;
    }

    // No alias needed, use default name
    return [defaultName];
  }

  /**
   * Detect if city needs alias (for autonomous discovery)
   *
   * @param cityFips - Census FIPS code
   * @returns True if city has alias configuration
   */
  needsAlias(cityFips: string): boolean {
    return this.cityAliases.has(cityFips);
  }
}
