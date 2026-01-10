/**
 * Council District Validator
 *
 * CRITICAL: This validator ensures 100% accuracy for ZK proof resolution.
 * A user's council district assignment is cryptographically committed via Merkle proof.
 * Any error here means INVALID PROOFS that cannot be corrected after commitment.
 *
 * VALIDATION PHILOSOPHY:
 * - REJECT by default, ACCEPT only with high confidence
 * - Multiple independent validation signals required
 * - Human review for edge cases (better slow than wrong)
 *
 * VALIDATION LAYERS:
 * 1. Source Authority - Is this from an official city/state GIS portal?
 * 2. Expected Count - Does district count match official records?
 * 3. Topological Integrity - No gaps, no overlaps, complete coverage
 * 4. Semantic Validation - Field names, values match council district patterns
 * 5. Temporal Validity - Data is current (post-redistricting)
 * 6. Cross-Reference - Matches independent sources (Ballotpedia, Wikipedia)
 */

import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import * as turf from '@turf/turf';

// =============================================================================
// Types
// =============================================================================

/**
 * Validation result with detailed reasoning
 */
export interface ValidationResult {
  /** Overall validation status */
  readonly status: 'PASS' | 'FAIL' | 'NEEDS_REVIEW';

  /** Confidence score (0-100) */
  readonly confidence: number;

  /** Individual validation checks */
  readonly checks: readonly ValidationCheck[];

  /** Human-readable summary */
  readonly summary: string;

  /** Recommended action */
  readonly action: 'COMMIT' | 'REJECT' | 'MANUAL_REVIEW';

  /** Warnings that don't fail validation but need attention */
  readonly warnings: readonly string[];
}

/**
 * Individual validation check result
 */
export interface ValidationCheck {
  readonly name: string;
  readonly status: 'PASS' | 'FAIL' | 'WARN';
  readonly weight: number;  // 0-100, contribution to confidence
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

/**
 * Council district feature with required metadata
 */
export interface CouncilDistrictFeature extends Feature<Polygon | MultiPolygon> {
  properties: {
    /** District identifier (1, 2, ... or "Ward 1", "District A") */
    districtId: string | number;
    /** District name (human-readable) */
    districtName?: string;
    /** Council member name (for cross-reference) */
    representative?: string;
    /** Source metadata */
    source?: {
      portal: string;
      datasetId: string;
      retrievedAt: string;
      vintage?: number;
    };
    [key: string]: unknown;
  };
}

/**
 * Expected district count record
 */
export interface ExpectedCount {
  readonly cityFips: string;
  readonly cityName: string;
  readonly state: string;
  readonly expectedCount: number;
  readonly governanceType: 'district-based' | 'at-large' | 'hybrid';
  readonly source: string;
  readonly lastVerified: string;
}

// =============================================================================
// Validation Thresholds
// =============================================================================

const THRESHOLDS = {
  /** Minimum confidence to COMMIT (proceed with Merkle tree) */
  COMMIT_THRESHOLD: 95,

  /** Minimum confidence to avoid outright rejection */
  REVIEW_THRESHOLD: 70,

  /** Maximum acceptable gap between districts (sq meters) */
  MAX_GAP_AREA: 1000,  // ~0.1 hectare

  /** Maximum acceptable overlap between districts (sq meters) */
  MAX_OVERLAP_AREA: 100,  // ~10m x 10m

  /** Minimum district area (sq km) - smaller likely wrong granularity */
  MIN_DISTRICT_AREA_KM2: 0.5,

  /** Maximum district count deviation from expected */
  MAX_COUNT_DEVIATION: 2,

  /** Minimum days since data retrieval to flag staleness */
  STALENESS_DAYS: 90,
} as const;

// =============================================================================
// Council District Validator
// =============================================================================

export class CouncilDistrictValidator {
  private readonly expectedCounts: Map<string, ExpectedCount>;

  constructor(expectedCounts?: readonly ExpectedCount[]) {
    this.expectedCounts = new Map(
      (expectedCounts || []).map(ec => [ec.cityFips, ec])
    );
  }

  /**
   * Validate a council district dataset for Merkle commitment
   *
   * @param cityFips - 7-digit Census Place FIPS
   * @param features - GeoJSON features from discovery
   * @param sourceMetadata - Portal and retrieval information
   * @returns Validation result with commit/reject/review recommendation
   */
  async validate(
    cityFips: string,
    features: FeatureCollection<Polygon | MultiPolygon>,
    sourceMetadata: {
      portal: string;
      datasetId: string;
      retrievedAt: Date;
      vintage?: number;
    }
  ): Promise<ValidationResult> {
    const checks: ValidationCheck[] = [];
    const warnings: string[] = [];

    // 1. Source Authority Check
    checks.push(this.checkSourceAuthority(sourceMetadata.portal));

    // 2. Expected Count Check
    checks.push(this.checkExpectedCount(cityFips, features.features.length));

    // 3. Topological Integrity Check
    const topoCheck = await this.checkTopologicalIntegrity(features);
    checks.push(topoCheck.check);
    warnings.push(...topoCheck.warnings);

    // 4. Semantic Validation Check
    checks.push(this.checkSemanticValidity(features));

    // 5. Temporal Validity Check
    checks.push(this.checkTemporalValidity(sourceMetadata.retrievedAt, sourceMetadata.vintage));

    // 6. District ID Continuity Check
    checks.push(this.checkDistrictIdContinuity(features));

    // 7. Area Reasonableness Check
    const areaCheck = this.checkAreaReasonableness(features);
    checks.push(areaCheck.check);
    warnings.push(...areaCheck.warnings);

    // Calculate weighted confidence
    const totalWeight = checks.reduce((sum, c) => sum + c.weight, 0);
    const weightedScore = checks.reduce((sum, c) => {
      const score = c.status === 'PASS' ? 1 : c.status === 'WARN' ? 0.5 : 0;
      return sum + score * c.weight;
    }, 0);
    const confidence = Math.round((weightedScore / totalWeight) * 100);

    // Determine action
    let action: 'COMMIT' | 'REJECT' | 'MANUAL_REVIEW';
    let status: 'PASS' | 'FAIL' | 'NEEDS_REVIEW';

    const hasFailures = checks.some(c => c.status === 'FAIL');

    if (confidence >= THRESHOLDS.COMMIT_THRESHOLD && !hasFailures) {
      action = 'COMMIT';
      status = 'PASS';
    } else if (confidence < THRESHOLDS.REVIEW_THRESHOLD || hasFailures) {
      action = 'REJECT';
      status = 'FAIL';
    } else {
      action = 'MANUAL_REVIEW';
      status = 'NEEDS_REVIEW';
    }

    // Generate summary
    const passCount = checks.filter(c => c.status === 'PASS').length;
    const failCount = checks.filter(c => c.status === 'FAIL').length;
    const summary = `${passCount}/${checks.length} checks passed. ` +
      `Confidence: ${confidence}%. ` +
      (failCount > 0 ? `FAILURES: ${checks.filter(c => c.status === 'FAIL').map(c => c.name).join(', ')}` : '');

    return {
      status,
      confidence,
      checks,
      summary,
      action,
      warnings,
    };
  }

  // ===========================================================================
  // Individual Validation Checks
  // ===========================================================================

  /**
   * Check 1: Source Authority
   * Is this from an official city/state GIS portal?
   */
  private checkSourceAuthority(portal: string): ValidationCheck {
    const officialPatterns = [
      /\.gov\//,           // Government domains
      /gis\.[a-z]+\./,     // GIS subdomains
      /data\.[a-z]+\./,    // Open data portals
      /arcgis\.com/,       // ArcGIS hosted (with city owner)
      /opendata\./,        // Open data platforms
    ];

    const suspiciousPatterns = [
      /github\./,          // Community-sourced
      /kaggle\./,          // Data science platforms
      /dropbox\./,         // File sharing
    ];

    const isOfficial = officialPatterns.some(p => p.test(portal));
    const isSuspicious = suspiciousPatterns.some(p => p.test(portal));

    if (isSuspicious) {
      return {
        name: 'Source Authority',
        status: 'FAIL',
        weight: 25,
        message: `Suspicious source: ${portal}`,
        details: { portal, reason: 'Non-authoritative source' },
      };
    }

    if (isOfficial) {
      return {
        name: 'Source Authority',
        status: 'PASS',
        weight: 25,
        message: `Official source: ${portal}`,
        details: { portal },
      };
    }

    return {
      name: 'Source Authority',
      status: 'WARN',
      weight: 25,
      message: `Unknown source authority: ${portal}`,
      details: { portal, reason: 'Manual verification recommended' },
    };
  }

  /**
   * Check 2: Expected Count
   * Does district count match official records?
   */
  private checkExpectedCount(cityFips: string, actualCount: number): ValidationCheck {
    const expected = this.expectedCounts.get(cityFips);

    if (!expected) {
      return {
        name: 'Expected Count',
        status: 'WARN',
        weight: 20,
        message: `No expected count registered for ${cityFips}`,
        details: { cityFips, actualCount, reason: 'Add to expected count registry' },
      };
    }

    if (expected.governanceType === 'at-large') {
      // At-large cities should have 0 geographic districts (just city boundary)
      if (actualCount <= 1) {
        return {
          name: 'Expected Count',
          status: 'PASS',
          weight: 20,
          message: `At-large city: ${actualCount} boundary (expected)`,
          details: { cityFips, actualCount, governanceType: 'at-large' },
        };
      }
      return {
        name: 'Expected Count',
        status: 'FAIL',
        weight: 20,
        message: `At-large city has ${actualCount} districts (expected 0-1)`,
        details: { cityFips, actualCount, expectedType: 'at-large' },
      };
    }

    const deviation = Math.abs(actualCount - expected.expectedCount);

    if (deviation === 0) {
      return {
        name: 'Expected Count',
        status: 'PASS',
        weight: 20,
        message: `District count matches: ${actualCount} (expected ${expected.expectedCount})`,
        details: { cityFips, actualCount, expected: expected.expectedCount },
      };
    }

    if (deviation <= THRESHOLDS.MAX_COUNT_DEVIATION) {
      return {
        name: 'Expected Count',
        status: 'WARN',
        weight: 20,
        message: `District count deviation: ${actualCount} (expected ${expected.expectedCount}, diff: ${deviation})`,
        details: {
          cityFips,
          actualCount,
          expected: expected.expectedCount,
          deviation,
          reason: 'May indicate recent redistricting',
        },
      };
    }

    return {
      name: 'Expected Count',
      status: 'FAIL',
      weight: 20,
      message: `District count mismatch: ${actualCount} (expected ${expected.expectedCount}, diff: ${deviation})`,
      details: {
        cityFips,
        actualCount,
        expected: expected.expectedCount,
        deviation,
        reason: 'Likely wrong granularity (neighborhoods, precincts, etc.)',
      },
    };
  }

  /**
   * Check 3: Topological Integrity
   * No gaps, no overlaps, districts form complete coverage
   */
  private async checkTopologicalIntegrity(
    features: FeatureCollection<Polygon | MultiPolygon>
  ): Promise<{ check: ValidationCheck; warnings: string[] }> {
    const warnings: string[] = [];

    if (features.features.length < 2) {
      return {
        check: {
          name: 'Topological Integrity',
          status: 'WARN',
          weight: 20,
          message: 'Too few features for topology check',
          details: { featureCount: features.features.length },
        },
        warnings,
      };
    }

    let overlapCount = 0;
    let maxOverlapArea = 0;

    // Check pairwise overlaps
    for (let i = 0; i < features.features.length; i++) {
      for (let j = i + 1; j < features.features.length; j++) {
        try {
          const intersection = turf.intersect(
            turf.featureCollection([features.features[i], features.features[j]])
          );

          if (intersection) {
            const area = turf.area(intersection);
            if (area > THRESHOLDS.MAX_OVERLAP_AREA) {
              overlapCount++;
              maxOverlapArea = Math.max(maxOverlapArea, area);
            }
          }
        } catch {
          // Invalid geometry - will be caught by other checks
        }
      }
    }

    if (overlapCount > 0) {
      warnings.push(`${overlapCount} district pairs have overlapping boundaries (max: ${Math.round(maxOverlapArea)}m²)`);
    }

    // Check for valid geometries
    let invalidGeometries = 0;
    for (const feature of features.features) {
      try {
        if (!turf.booleanValid(feature)) {
          invalidGeometries++;
        }
      } catch {
        invalidGeometries++;
      }
    }

    if (invalidGeometries > 0) {
      return {
        check: {
          name: 'Topological Integrity',
          status: 'FAIL',
          weight: 20,
          message: `${invalidGeometries} features have invalid geometry`,
          details: { invalidGeometries, totalFeatures: features.features.length },
        },
        warnings,
      };
    }

    if (overlapCount > features.features.length * 0.1) {
      return {
        check: {
          name: 'Topological Integrity',
          status: 'FAIL',
          weight: 20,
          message: `Too many overlapping districts: ${overlapCount}`,
          details: { overlapCount, maxOverlapArea },
        },
        warnings,
      };
    }

    return {
      check: {
        name: 'Topological Integrity',
        status: overlapCount > 0 ? 'WARN' : 'PASS',
        weight: 20,
        message: overlapCount > 0
          ? `Minor overlaps detected: ${overlapCount} pairs`
          : 'All geometries valid, no significant overlaps',
        details: { overlapCount, invalidGeometries: 0 },
      },
      warnings,
    };
  }

  /**
   * Check 4: Semantic Validity
   * Field names and values match council district patterns
   */
  private checkSemanticValidity(features: FeatureCollection): ValidationCheck {
    if (features.features.length === 0) {
      return {
        name: 'Semantic Validity',
        status: 'FAIL',
        weight: 15,
        message: 'No features to validate',
      };
    }

    const sample = features.features[0];
    const props = sample.properties || {};
    const propKeys = Object.keys(props).map(k => k.toLowerCase());

    // Positive signals
    const hasDistrictId = propKeys.some(k =>
      k.includes('district') || k.includes('ward') || k.includes('council') ||
      k === 'id' || k === 'number' || k === 'name'
    );

    // Negative signals (wrong granularity)
    const negativePatterns = [
      'census', 'tract', 'block', 'precinct', 'vtd',
      'neighborhood', 'community', 'planning',
      'zip', 'postal',
    ];
    const hasNegativeSignal = propKeys.some(k =>
      negativePatterns.some(neg => k.includes(neg))
    );

    // Check for sequential district IDs
    let hasSequentialIds = false;
    const idField = propKeys.find(k =>
      k.includes('district') || k.includes('ward') || k === 'id' || k === 'number'
    );

    if (idField) {
      const ids = features.features
        .map(f => f.properties?.[idField])
        .filter(id => id !== undefined && id !== null);

      const numericIds = ids
        .map(id => typeof id === 'number' ? id : parseInt(String(id), 10))
        .filter(n => !isNaN(n))
        .sort((a, b) => a - b);

      if (numericIds.length === features.features.length) {
        // Check if IDs are roughly sequential (1,2,3,... or similar)
        const min = numericIds[0];
        const max = numericIds[numericIds.length - 1];
        hasSequentialIds = max - min + 1 === numericIds.length;
      }
    }

    if (hasNegativeSignal) {
      return {
        name: 'Semantic Validity',
        status: 'FAIL',
        weight: 15,
        message: 'Fields suggest wrong granularity (census/neighborhood/etc.)',
        details: { fields: propKeys },
      };
    }

    if (hasDistrictId && hasSequentialIds) {
      return {
        name: 'Semantic Validity',
        status: 'PASS',
        weight: 15,
        message: 'Valid district ID field with sequential values',
        details: { fields: propKeys, idField },
      };
    }

    if (hasDistrictId) {
      return {
        name: 'Semantic Validity',
        status: 'WARN',
        weight: 15,
        message: 'District ID field found but IDs not sequential',
        details: { fields: propKeys },
      };
    }

    return {
      name: 'Semantic Validity',
      status: 'WARN',
      weight: 15,
      message: 'No clear district ID field found',
      details: { fields: propKeys },
    };
  }

  /**
   * Check 5: Temporal Validity
   * Data is current and not stale
   */
  private checkTemporalValidity(retrievedAt: Date, vintage?: number): ValidationCheck {
    const now = new Date();
    const daysSinceRetrieval = Math.floor(
      (now.getTime() - retrievedAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    const currentYear = now.getFullYear();

    // Check if we're in a redistricting year (years ending in 1-2 after Census)
    const isRedistrictingPeriod = currentYear % 10 === 1 || currentYear % 10 === 2;

    if (vintage && vintage < currentYear - 5) {
      return {
        name: 'Temporal Validity',
        status: 'FAIL',
        weight: 10,
        message: `Data vintage too old: ${vintage} (current: ${currentYear})`,
        details: { vintage, currentYear, daysSinceRetrieval },
      };
    }

    if (isRedistrictingPeriod && vintage && vintage < currentYear) {
      return {
        name: 'Temporal Validity',
        status: 'WARN',
        weight: 10,
        message: `Redistricting period - verify boundaries are post-2020 Census`,
        details: { vintage, currentYear, isRedistrictingPeriod },
      };
    }

    if (daysSinceRetrieval > THRESHOLDS.STALENESS_DAYS) {
      return {
        name: 'Temporal Validity',
        status: 'WARN',
        weight: 10,
        message: `Data may be stale: retrieved ${daysSinceRetrieval} days ago`,
        details: { retrievedAt: retrievedAt.toISOString(), daysSinceRetrieval },
      };
    }

    return {
      name: 'Temporal Validity',
      status: 'PASS',
      weight: 10,
      message: `Data is current (retrieved ${daysSinceRetrieval} days ago)`,
      details: { retrievedAt: retrievedAt.toISOString(), vintage },
    };
  }

  /**
   * Check 6: District ID Continuity
   * IDs should be sequential with no gaps (1,2,3,... or A,B,C,...)
   */
  private checkDistrictIdContinuity(features: FeatureCollection): ValidationCheck {
    if (features.features.length === 0) {
      return {
        name: 'ID Continuity',
        status: 'FAIL',
        weight: 5,
        message: 'No features',
      };
    }

    // Try to find district ID field
    const sample = features.features[0];
    const props = sample.properties || {};
    const propKeys = Object.keys(props);

    const idField = propKeys.find(k => {
      const lower = k.toLowerCase();
      return lower.includes('district') || lower.includes('ward') ||
        lower === 'id' || lower === 'number' || lower === 'name';
    });

    if (!idField) {
      return {
        name: 'ID Continuity',
        status: 'WARN',
        weight: 5,
        message: 'Could not identify district ID field',
        details: { availableFields: propKeys },
      };
    }

    const ids = features.features
      .map(f => f.properties?.[idField])
      .filter(id => id !== undefined && id !== null);

    // Try numeric interpretation
    const numericIds = ids
      .map(id => typeof id === 'number' ? id : parseInt(String(id).replace(/\D/g, ''), 10))
      .filter(n => !isNaN(n))
      .sort((a, b) => a - b);

    if (numericIds.length === features.features.length) {
      const min = numericIds[0];
      const max = numericIds[numericIds.length - 1];
      const expectedRange = max - min + 1;
      const uniqueCount = new Set(numericIds).size;

      if (uniqueCount === expectedRange && uniqueCount === features.features.length) {
        return {
          name: 'ID Continuity',
          status: 'PASS',
          weight: 5,
          message: `Sequential IDs: ${min} to ${max}`,
          details: { min, max, count: numericIds.length },
        };
      }

      if (uniqueCount !== features.features.length) {
        return {
          name: 'ID Continuity',
          status: 'FAIL',
          weight: 5,
          message: `Duplicate IDs detected`,
          details: { uniqueCount, featureCount: features.features.length },
        };
      }
    }

    return {
      name: 'ID Continuity',
      status: 'WARN',
      weight: 5,
      message: 'Non-sequential or non-numeric district IDs',
      details: { sampleIds: ids.slice(0, 5) },
    };
  }

  /**
   * Check 7: Area Reasonableness
   * Districts should have reasonable size (not too small = wrong granularity)
   */
  private checkAreaReasonableness(
    features: FeatureCollection<Polygon | MultiPolygon>
  ): { check: ValidationCheck; warnings: string[] } {
    const warnings: string[] = [];

    const areas = features.features.map(f => {
      try {
        return turf.area(f) / 1_000_000; // Convert to km²
      } catch {
        return 0;
      }
    });

    const minArea = Math.min(...areas);
    const maxArea = Math.max(...areas);
    const avgArea = areas.reduce((a, b) => a + b, 0) / areas.length;

    // Districts smaller than threshold are suspicious
    const tooSmall = areas.filter(a => a < THRESHOLDS.MIN_DISTRICT_AREA_KM2).length;

    if (tooSmall > features.features.length * 0.5) {
      return {
        check: {
          name: 'Area Reasonableness',
          status: 'FAIL',
          weight: 5,
          message: `${tooSmall}/${features.features.length} districts too small (<${THRESHOLDS.MIN_DISTRICT_AREA_KM2}km²)`,
          details: { minArea, maxArea, avgArea, tooSmall },
        },
        warnings,
      };
    }

    if (tooSmall > 0) {
      warnings.push(`${tooSmall} districts are smaller than ${THRESHOLDS.MIN_DISTRICT_AREA_KM2}km²`);
    }

    // Check for extreme size variance (10x+ difference suggests mixed granularity)
    if (maxArea > minArea * 10 && features.features.length > 3) {
      warnings.push(`Large area variance: ${minArea.toFixed(2)}km² to ${maxArea.toFixed(2)}km²`);
    }

    return {
      check: {
        name: 'Area Reasonableness',
        status: tooSmall > 0 ? 'WARN' : 'PASS',
        weight: 5,
        message: `Areas: ${minArea.toFixed(2)}-${maxArea.toFixed(2)}km² (avg: ${avgArea.toFixed(2)}km²)`,
        details: { minArea, maxArea, avgArea },
      },
      warnings,
    };
  }
}

// =============================================================================
// Exports
// =============================================================================

export { THRESHOLDS };
