/**
 * Shadow Atlas Schema Usage Examples
 *
 * Demonstrates how to consume the Shadow Atlas dataset with full type safety.
 */

import type {
  GovernanceDistrict,
  ShadowAtlasDataset,
  QualityTier,
  DistrictType,
  GovernanceLevel,
} from './governance-district.js';

import {
  validateGovernanceDistrict,
  isGovernanceDistrict,
  QualityTier as QT,
  DistrictType as DT,
  GovernanceLevel as GL,
} from './governance-district.js';

/**
 * Example 1: Load and filter dataset
 */
export async function loadGoldTierDistricts(
  datasetPath: string
): Promise<GovernanceDistrict[]> {
  // Load dataset (in browser, use fetch; in Node, use fs.readFileSync)
  const dataset: ShadowAtlasDataset = JSON.parse(
    await import('fs').then((fs) => fs.readFileSync(datasetPath, 'utf-8'))
  );

  // Type-safe access to metadata
  console.log(`Schema version: ${dataset.metadata.schema_version}`);
  console.log(`Total districts: ${dataset.metadata.total_districts}`);
  console.log(`GOLD tier: ${dataset.metadata.coverage_stats.by_tier.GOLD}`);

  // Filter GOLD tier districts (elected representation, high confidence)
  const goldDistricts = dataset.districts.filter(
    (d) => d.tier === QT.GOLD
  );

  return goldDistricts;
}

/**
 * Example 2: Find city council districts for a specific city
 */
export function findCityCouncilDistricts(
  districts: readonly GovernanceDistrict[],
  cityName: string
): GovernanceDistrict[] {
  return districts.filter((d) => {
    // Filter by district type
    if (d.district_type !== DT.CITY_COUNCIL) {
      return false;
    }

    // Filter by city name (case-insensitive search in layer name or URL)
    const searchString = cityName.toLowerCase();
    const nameMatch = d.layer_name.toLowerCase().includes(searchString);
    const urlMatch = d.layer_url.toLowerCase().includes(searchString);

    return nameMatch || urlMatch;
  });
}

/**
 * Example 3: Get high-confidence elected districts by governance level
 */
export function getElectedDistrictsByLevel(
  districts: readonly GovernanceDistrict[],
  level: GovernanceLevel,
  minConfidence: number = 0.7
): GovernanceDistrict[] {
  return districts.filter((d) => {
    // Must be elected representation
    if (!d.elected) {
      return false;
    }

    // Must match governance level
    if (d.governance_level !== level) {
      return false;
    }

    // Must meet confidence threshold
    if (d.confidence < minConfidence) {
      return false;
    }

    return true;
  });
}

/**
 * Example 4: Validate external data before processing
 */
export function processDistrictWithValidation(
  data: unknown
): GovernanceDistrict | null {
  // Comprehensive validation with error details
  const errors = validateGovernanceDistrict(data);

  if (errors.length > 0) {
    console.error('Validation failed:');
    for (const error of errors) {
      console.error(`  ${error.field}: ${error.message}`);
    }
    return null;
  }

  // Type guard for safe casting
  if (isGovernanceDistrict(data)) {
    return data;
  }

  return null;
}

/**
 * Example 5: Get coverage statistics by tier
 */
export function getCoverageByTier(
  districts: readonly GovernanceDistrict[]
): Record<QualityTier, number> {
  const counts: Record<QualityTier, number> = {
    [QT.GOLD]: 0,
    [QT.SILVER]: 0,
    [QT.BRONZE]: 0,
    [QT.UTILITY]: 0,
    [QT.REJECT]: 0,
  };

  for (const district of districts) {
    counts[district.tier]++;
  }

  return counts;
}

/**
 * Example 6: Filter production-ready districts
 *
 * RECOMMENDATION: Use only GOLD tier for civic engagement applications.
 * GOLD tier = elected representation + high confidence (score >= 70)
 */
export function getProductionReadyDistricts(
  districts: readonly GovernanceDistrict[]
): GovernanceDistrict[] {
  return districts.filter((d) => {
    // GOLD tier only
    if (d.tier !== QT.GOLD) {
      return false;
    }

    // Must be elected representation
    if (!d.elected) {
      return false;
    }

    // Must be polygon geometry (required for point-in-polygon testing)
    if (d.geometry_type !== 'esriGeometryPolygon') {
      return false;
    }

    return true;
  });
}

/**
 * Example 7: Search by district type with multiple criteria
 */
export interface DistrictSearchCriteria {
  readonly districtTypes?: DistrictType[];
  readonly governanceLevels?: GovernanceLevel[];
  readonly minConfidence?: number;
  readonly electedOnly?: boolean;
  readonly polygonOnly?: boolean;
}

export function searchDistricts(
  districts: readonly GovernanceDistrict[],
  criteria: DistrictSearchCriteria
): GovernanceDistrict[] {
  return districts.filter((d) => {
    // Filter by district types
    if (
      criteria.districtTypes &&
      !criteria.districtTypes.includes(d.district_type)
    ) {
      return false;
    }

    // Filter by governance levels
    if (
      criteria.governanceLevels &&
      !criteria.governanceLevels.includes(d.governance_level)
    ) {
      return false;
    }

    // Filter by confidence threshold
    if (
      criteria.minConfidence !== undefined &&
      d.confidence < criteria.minConfidence
    ) {
      return false;
    }

    // Filter elected only
    if (criteria.electedOnly && !d.elected) {
      return false;
    }

    // Filter polygon only
    if (criteria.polygonOnly && d.geometry_type !== 'esriGeometryPolygon') {
      return false;
    }

    return true;
  });
}

/**
 * Example 8: Get districts with diagnostic information
 */
export interface DistrictDiagnostic {
  readonly district: GovernanceDistrict;
  readonly warnings: string[];
  readonly productionReady: boolean;
}

export function getDiagnostics(
  districts: readonly GovernanceDistrict[]
): DistrictDiagnostic[] {
  return districts.map((district) => {
    const warnings: string[] = [];
    let productionReady = true;

    // Check feature count cap warning
    if (district.feature_count === 1000 || district.feature_count === 2000) {
      warnings.push(
        `Feature count may be capped at API limit (${district.feature_count})`
      );
    }

    // Check confidence warnings
    if (district.confidence < 0.7 && district.tier === QT.GOLD) {
      warnings.push(
        `GOLD tier with confidence < 0.7: ${district.confidence.toFixed(2)}`
      );
    }

    // Check production readiness
    if (district.tier !== QT.GOLD && district.tier !== QT.SILVER) {
      warnings.push(`Not production-ready: tier=${district.tier}`);
      productionReady = false;
    }

    if (!district.elected && district.tier === QT.GOLD) {
      warnings.push(
        'GOLD tier should be elected representation (elected=false)'
      );
      productionReady = false;
    }

    if (district.geometry_type !== 'esriGeometryPolygon') {
      warnings.push(
        `Invalid geometry type for districts: ${district.geometry_type}`
      );
      productionReady = false;
    }

    return {
      district,
      warnings,
      productionReady,
    };
  });
}

/**
 * Example 9: Group districts by state/jurisdiction
 */
export interface JurisdictionGroup {
  readonly jurisdiction: string;
  readonly districts: GovernanceDistrict[];
  readonly coverage: {
    readonly total: number;
    readonly byTier: Record<QualityTier, number>;
    readonly electedCount: number;
  };
}

export function groupByJurisdiction(
  districts: readonly GovernanceDistrict[]
): Map<string, JurisdictionGroup> {
  const groups = new Map<string, JurisdictionGroup>();

  for (const district of districts) {
    // Extract jurisdiction from URL (heuristic: domain name or service path)
    const url = new URL(district.service_url);
    const jurisdiction = url.hostname;

    if (!groups.has(jurisdiction)) {
      groups.set(jurisdiction, {
        jurisdiction,
        districts: [],
        coverage: {
          total: 0,
          byTier: {
            [QT.GOLD]: 0,
            [QT.SILVER]: 0,
            [QT.BRONZE]: 0,
            [QT.UTILITY]: 0,
            [QT.REJECT]: 0,
          },
          electedCount: 0,
        },
      });
    }

    const group = groups.get(jurisdiction)!;
    group.districts.push(district);
    group.coverage.total++;
    group.coverage.byTier[district.tier]++;
    if (district.elected) {
      group.coverage.electedCount++;
    }
  }

  return groups;
}

/**
 * Example 10: Export for ZK circuit consumption
 *
 * CRITICAL: Field order must match schema exactly for Poseidon hash consistency.
 */
export interface ZKCircuitDistrict {
  // Only fields needed for ZK proof
  readonly layer_url: string; // Primary key
  readonly district_type: string; // Enum as string
  readonly governance_level: string; // Enum as string
  readonly confidence: number; // 0-1 score
}

export function exportForZKCircuit(
  district: GovernanceDistrict
): ZKCircuitDistrict {
  // IMPORTANT: Only include fields actually used in circuit
  // Full struct hashing would be expensive in circuit
  return {
    layer_url: district.layer_url,
    district_type: district.district_type,
    governance_level: district.governance_level,
    confidence: district.confidence,
  };
}
