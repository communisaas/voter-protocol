/**
 * Semantic Layer Validator
 *
 * Filters GIS layers to identify council district candidates using semantic analysis.
 *
 * Scoring System (0-100 confidence):
 * - Name patterns (40 pts): council, district, ward, voting
 * - Geometry type (30 pts): polygon geometry required
 * - Field schema (20 pts): DISTRICT, COUNCIL, WARD fields
 * - Feature count (10 pts): 3-25 features expected
 * - Geographic extent (bonus): city-scale validation
 *
 * Goal: 85%+ precision in identifying council district layers.
 *
 * TYPE SAFETY: Nuclear-level strictness - no `any`, no loose casts.
 * Zero tolerance for type bypasses.
 */

import type { GISLayer } from '../services/gis-server-discovery.js';
import type { CityTarget } from '../providers/us-council-district-discovery.js';

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
]);

/**
 * Layer match with confidence score
 */
export interface LayerMatch {
  readonly layer: GISLayer;
  readonly confidence: number; // 0-100
  readonly reasons: readonly string[]; // Why this layer matches council districts
}

/**
 * Semantic Layer Validator
 *
 * Identifies council district layers from discovered GIS layers.
 */
export class SemanticLayerValidator {
  /**
   * Filter layers to find council district candidates
   *
   * @param layers - All discovered layers
   * @param city - City context for validation
   * @returns Ranked list of likely council district layers (sorted by confidence)
   */
  filterCouncilDistrictLayers(
    layers: readonly GISLayer[],
    city: CityTarget
  ): readonly LayerMatch[] {
    const matches: LayerMatch[] = [];

    for (const layer of layers) {
      const match = this.scoreLayer(layer, city);
      // Only return candidates with ≥50% confidence
      if (match.confidence >= 50) {
        matches.push(match);
      }
    }

    // Sort by confidence (highest first)
    return matches.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Score a layer's likelihood of being council districts
   */
  private scoreLayer(layer: GISLayer, city: CityTarget): LayerMatch {
    let confidence = 0;
    const reasons: string[] = [];

    // NAME PATTERNS (40 points max)
    const nameScore = this.scoreNamePatterns(layer.name, reasons);
    confidence += nameScore;

    // GEOMETRY TYPE (30 points or -20 penalty)
    const geometryScore = this.scoreGeometryType(layer.geometryType, reasons);
    confidence += geometryScore;

    // FIELD SCHEMA (20 points max, 5 points per matching field)
    const fieldScore = this.scoreFieldSchema(layer.fields, reasons);
    confidence += fieldScore;

    // FEATURE COUNT (10 points or -10 penalty)
    const countScore = this.scoreFeatureCount(layer.featureCount, reasons);
    confidence += countScore;

    // GEOGRAPHIC EXTENT (bonus 5 points)
    const extentScore = this.scoreGeographicExtent(layer.extent, city, reasons);
    confidence += extentScore;

    // Clamp confidence to 0-100 range
    confidence = Math.max(0, Math.min(100, confidence));

    return {
      layer,
      confidence,
      reasons: Object.freeze([...reasons]),
    };
  }

  /**
   * Score layer name against expected patterns
   */
  private scoreNamePatterns(name: string, reasons: string[]): number {
    const nameLower = name.toLowerCase();

    // CHECK NEGATIVE KEYWORDS FIRST - Immediately disqualify wrong granularity
    for (const negativeKeyword of NEGATIVE_KEYWORDS) {
      if (nameLower.includes(negativeKeyword)) {
        reasons.push(`Layer rejected: contains negative keyword "${negativeKeyword}" (wrong granularity)`);
        return 0; // Immediate disqualification
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
      if (pattern.test(nameLower)) {
        reasons.push(`Name matches high-confidence pattern: "${pattern.source}"`);
        return 40;
      }
    }

    // Medium-confidence patterns (30 points)
    // NOTE: "voting" and "election" removed - now negative keywords
    // NOTE: "political boundaries" too generic - could be neighborhoods
    const mediumConfidencePatterns: readonly RegExp[] = [
      /^ward/i,
      /\bwards?\b/i,     // Match "ward" or "wards"
      /civic\s*district/i,
      /city\s*boundaries/i,       // Municipal boundary data
      /commission\s*district/i,   // Commission districts (Butte-Silver Bow style)
    ];

    for (const pattern of mediumConfidencePatterns) {
      if (pattern.test(nameLower)) {
        reasons.push(`Name matches medium-confidence pattern: "${pattern.source}"`);
        return 30;
      }
    }

    // Low-confidence patterns (20 points)
    const lowConfidencePatterns: readonly RegExp[] = [
      /\bcouncil\b/i,
      /\bdistrict\b/i,
      /\brepresentation\b/i,
    ];

    for (const pattern of lowConfidencePatterns) {
      if (pattern.test(nameLower)) {
        reasons.push(`Name matches low-confidence pattern: "${pattern.source}"`);
        return 20;
      }
    }

    // False positive penalties
    // NOTE: "zoning" removed - now a negative keyword
    const falsePositivePatterns: readonly RegExp[] = [
      /school/i,
      /fire/i,
      /police/i,
      /congressional/i,
      /state\s*senate/i,
      /state\s*house/i,
      /legislative/i,
      /park/i,
    ];

    for (const pattern of falsePositivePatterns) {
      if (pattern.test(nameLower)) {
        reasons.push(`Name matches false-positive pattern: "${pattern.source}" (penalty)`);
        return -30;
      }
    }

    reasons.push('Name does not match known patterns');
    return 0;
  }

  /**
   * Score geometry type (polygons required for districts)
   */
  private scoreGeometryType(
    geometryType: string | null,
    reasons: string[]
  ): number {
    if (geometryType === null) {
      reasons.push('Geometry type unknown (neutral)');
      return 0;
    }

    const typeUpper = geometryType.toUpperCase();

    if (typeUpper.includes('POLYGON')) {
      reasons.push('Polygon geometry (expected for districts)');
      return 30;
    }

    // Non-polygon geometry is unlikely to be districts
    reasons.push(`Non-polygon geometry: ${geometryType} (penalty)`);
    return -20;
  }

  /**
   * Score field schema against expected district fields
   */
  private scoreFieldSchema(
    fields: readonly { readonly name: string; readonly type: string }[],
    reasons: string[]
  ): number {
    const fieldNamesUpper = fields.map(f => f.name.toUpperCase());

    let score = 0;
    const matchedFields: string[] = [];

    // Expected field patterns
    const expectedPatterns: readonly { pattern: RegExp; field: string }[] = [
      { pattern: /DISTRICT/, field: 'DISTRICT' },
      { pattern: /COUNCIL/, field: 'COUNCIL' },
      { pattern: /WARD/, field: 'WARD' },
      { pattern: /NAME/, field: 'NAME' },
      { pattern: /NUMBER/, field: 'NUMBER' },
      { pattern: /MEMBER/, field: 'MEMBER' },
      { pattern: /REP/, field: 'REP' },
    ];

    for (const { pattern, field } of expectedPatterns) {
      const hasMatch = fieldNamesUpper.some(name => pattern.test(name));
      if (hasMatch) {
        score += 5;
        matchedFields.push(field);
      }
    }

    if (matchedFields.length > 0) {
      reasons.push(`Fields contain: ${matchedFields.join(', ')}`);
    } else {
      reasons.push('No district-related fields found');
    }

    return Math.min(20, score); // Max 20 points
  }

  /**
   * Score feature count (most cities have 3-25 council districts)
   */
  private scoreFeatureCount(
    featureCount: number | null,
    reasons: string[]
  ): number {
    if (featureCount === null) {
      reasons.push('Feature count unknown (neutral)');
      return 0;
    }

    // Typical range for council districts: 3-25
    if (featureCount >= 3 && featureCount <= 25) {
      reasons.push(`Feature count ${featureCount} in expected range (3-25)`);
      return 10;
    }

    // Very few features (likely not districts)
    if (featureCount < 3) {
      reasons.push(`Feature count ${featureCount} too low for districts (penalty)`);
      return -5;
    }

    // Too many features (likely not districts)
    if (featureCount > 100) {
      reasons.push(`Feature count ${featureCount} too high for districts (penalty)`);
      return -10;
    }

    // Moderate count (26-100) - possible but less likely
    reasons.push(`Feature count ${featureCount} outside typical range (neutral)`);
    return 0;
  }

  /**
   * Validate geographic extent is city-scale (bonus points)
   */
  private scoreGeographicExtent(
    extent: {
      readonly xmin: number;
      readonly ymin: number;
      readonly xmax: number;
      readonly ymax: number;
    } | null,
    city: CityTarget,
    reasons: string[]
  ): number {
    if (extent === null) {
      reasons.push('Geographic extent unknown (neutral)');
      return 0;
    }

    const width = extent.xmax - extent.xmin;
    const height = extent.ymax - extent.ymin;

    // City-scale heuristic: ~0.1-2 degrees (5-120 miles)
    // State-scale would be >3 degrees
    // Point data would be <0.01 degrees

    if (width < 0.01 || height < 0.01) {
      reasons.push('Geographic extent too small (likely point data) (penalty)');
      return -5;
    }

    if (width > 3.0 || height > 3.0) {
      reasons.push('Geographic extent too large (likely state/regional) (penalty)');
      return -5;
    }

    // City-scale extent
    reasons.push('Geographic extent reasonable for city (bonus)');
    return 5;
  }

  /**
   * Get top N candidates by confidence
   */
  getTopCandidates(
    matches: readonly LayerMatch[],
    limit: number = 3
  ): readonly LayerMatch[] {
    return matches.slice(0, limit);
  }

  /**
   * Filter to high-confidence matches only (≥70%)
   */
  getHighConfidenceMatches(
    matches: readonly LayerMatch[]
  ): readonly LayerMatch[] {
    return matches.filter(m => m.confidence >= 70);
  }

  /**
   * Score a layer title for ArcGIS Hub/Portal integration
   *
   * Simplified scoring for cases where we only have title/tags metadata.
   * Returns 0-100 score based primarily on name patterns and negative keywords.
   *
   * @param title - Layer title/name
   * @param tags - Optional layer tags for additional context
   * @returns Score 0-100 (0 = rejected, 50+ = candidate, 70+ = high confidence)
   */
  scoreTitleOnly(title: string, tags?: readonly string[]): { score: number; reasons: readonly string[] } {
    const reasons: string[] = [];

    // Name pattern scoring (primary signal)
    const nameScore = this.scoreNamePatterns(title, reasons);

    // If name score is 0 (rejected by negative keywords), return immediately
    if (nameScore === 0) {
      return { score: 0, reasons: Object.freeze([...reasons]) };
    }

    // Tag-based bonus scoring (optional, max +10 points)
    let tagBonus = 0;
    if (tags && tags.length > 0) {
      const tagText = tags.join(' ').toLowerCase();

      // Positive tags
      if (tagText.includes('boundaries') || tagText.includes('governance')) {
        tagBonus += 5;
        reasons.push('Tags indicate boundary/governance data');
      }

      // Negative tags (reduce score)
      if (tagText.includes('election') || tagText.includes('voting') || tagText.includes('precinct')) {
        tagBonus -= 10;
        reasons.push('Tags indicate voting/election data (penalty)');
      }
    }

    const finalScore = Math.max(0, Math.min(100, nameScore + tagBonus));

    return {
      score: finalScore,
      reasons: Object.freeze([...reasons]),
    };
  }
}
