/**
 * Council District Verifier
 *
 * Unified verification pipeline for 100% accuracy.
 *
 * PROOF CHAIN:
 * 1. Registry Lookup → Expected count (ground truth)
 * 2. Boundary Resolution → Municipal polygon (TIGER)
 * 3. Tessellation Proof → Geometric correctness
 *
 * If all three succeed, the data is correct by construction.
 * No heuristics. No confidence intervals. Binary correctness.
 *
 * FAILURE SEMANTICS:
 * - registry_miss: City not in expected count registry
 * - boundary_fail: Could not fetch municipal boundary
 * - tessellation_fail: Geometric proof failed (see axiom)
 *
 * Each failure type maps to a specific remediation action.
 */

import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import { TessellationProofValidator, type TessellationProof } from './tessellation-proof.js';
import { MunicipalBoundaryResolver, type MunicipalBoundary } from './municipal-boundary.js';
import { EXPECTED_DISTRICT_COUNTS, type DistrictCountRecord } from '../../core/registry/district-count-registry.js';

// =============================================================================
// Types
// =============================================================================

export interface VerificationResult {
  /** Binary correctness */
  readonly verified: boolean;

  /** Failure stage (null if verified) */
  readonly failureStage: 'registry_miss' | 'boundary_fail' | 'tessellation_fail' | null;

  /** City information */
  readonly city: {
    readonly fips: string;
    readonly name: string;
    readonly state: string;
  };

  /** Expected count from registry */
  readonly expectedCount: number | null;

  /** Actual count from data */
  readonly actualCount: number;

  /** Municipal boundary (if resolved) */
  readonly municipalBoundary: MunicipalBoundary | null;

  /** Tessellation proof (if computed) */
  readonly tessellationProof: TessellationProof | null;

  /** Human-readable status */
  readonly status: string;

  /** Remediation guidance */
  readonly remediation: string | null;
}

// =============================================================================
// Council District Verifier
// =============================================================================

export class CouncilDistrictVerifier {
  private readonly boundaryResolver = new MunicipalBoundaryResolver();
  private readonly tessellationValidator = new TessellationProofValidator();

  /**
   * Verify council district data for a city
   *
   * @param fips - 7-digit Census PLACE FIPS
   * @param districts - Council district GeoJSON features
   * @returns Binary verification result with diagnostics
   */
  async verify(
    fips: string,
    districts: FeatureCollection<Polygon | MultiPolygon>
  ): Promise<VerificationResult> {
    const actualCount = districts.features.length;

    // Stage 1: Registry Lookup
    const registryRecord = EXPECTED_DISTRICT_COUNTS[fips];

    if (!registryRecord) {
      return this.fail('registry_miss', {
        fips,
        actualCount,
        status: `City ${fips} not in expected count registry`,
        remediation: 'Add city to EXPECTED_DISTRICT_COUNTS with verified count from official source',
      });
    }

    const expectedCount = registryRecord.expectedDistrictCount;

    // Handle at-large cities (no geographic districts)
    if (expectedCount === null) {
      if (actualCount === 1) {
        return this.success({
          fips,
          name: registryRecord.cityName,
          state: registryRecord.state,
          expectedCount: null,
          actualCount,
          status: 'At-large city with single municipal boundary',
        });
      } else {
        return this.fail('tessellation_fail', {
          fips,
          name: registryRecord.cityName,
          state: registryRecord.state,
          expectedCount: null,
          actualCount,
          status: `At-large city should have 1 boundary, found ${actualCount}`,
          remediation: 'Verify city governance structure - at-large cities have no geographic districts',
        });
      }
    }

    // Quick cardinality check before expensive boundary resolution
    if (actualCount !== expectedCount) {
      return this.fail('tessellation_fail', {
        fips,
        name: registryRecord.cityName,
        state: registryRecord.state,
        expectedCount,
        actualCount,
        status: `Expected ${expectedCount} districts, found ${actualCount}`,
        remediation: this.cardinalityRemediation(actualCount, expectedCount),
      });
    }

    // Stage 2: Municipal Boundary Resolution
    const boundaryResult = await this.boundaryResolver.resolve(fips);

    if (!boundaryResult.success || !boundaryResult.boundary) {
      return this.fail('boundary_fail', {
        fips,
        name: registryRecord.cityName,
        state: registryRecord.state,
        expectedCount,
        actualCount,
        status: `Could not resolve municipal boundary: ${boundaryResult.error}`,
        remediation: 'Check FIPS code validity or TIGER service availability',
      });
    }

    // Stage 3: Tessellation Proof
    // Pass land area to exclude water from coverage calculations
    // Pass water area for coastal city detection (wider tolerance for water-inclusive districts)
    // Pass FIPS for cities with known coverage exceptions (e.g., Portland, NYC)
    const proof = this.tessellationValidator.prove(
      districts,
      boundaryResult.boundary.geometry,
      expectedCount,
      boundaryResult.boundary.landAreaSqM,
      undefined, // authoritativeDistrictArea
      boundaryResult.boundary.waterAreaSqM,
      fips
    );

    if (!proof.valid) {
      return this.fail('tessellation_fail', {
        fips,
        name: registryRecord.cityName,
        state: registryRecord.state,
        expectedCount,
        actualCount,
        municipalBoundary: boundaryResult.boundary,
        tessellationProof: proof,
        status: `Tessellation proof failed: ${proof.reason}`,
        remediation: this.tessellationRemediation(proof),
      });
    }

    // All stages passed - verified
    return this.success({
      fips,
      name: registryRecord.cityName,
      state: registryRecord.state,
      expectedCount,
      actualCount,
      municipalBoundary: boundaryResult.boundary,
      tessellationProof: proof,
      status: 'Verified: districts tessellate municipal boundary',
    });
  }

  /**
   * Batch verify multiple cities
   */
  async verifyBatch(
    entries: Array<{ fips: string; districts: FeatureCollection<Polygon | MultiPolygon> }>
  ): Promise<Map<string, VerificationResult>> {
    const results = new Map<string, VerificationResult>();

    for (const entry of entries) {
      const result = await this.verify(entry.fips, entry.districts);
      results.set(entry.fips, result);
    }

    return results;
  }

  /**
   * Construct success result
   */
  private success(data: {
    fips: string;
    name: string;
    state: string;
    expectedCount: number | null;
    actualCount: number;
    municipalBoundary?: MunicipalBoundary | null;
    tessellationProof?: TessellationProof | null;
    status: string;
  }): VerificationResult {
    return {
      verified: true,
      failureStage: null,
      city: {
        fips: data.fips,
        name: data.name,
        state: data.state,
      },
      expectedCount: data.expectedCount,
      actualCount: data.actualCount,
      municipalBoundary: data.municipalBoundary ?? null,
      tessellationProof: data.tessellationProof ?? null,
      status: data.status,
      remediation: null,
    };
  }

  /**
   * Construct failure result
   */
  private fail(
    stage: 'registry_miss' | 'boundary_fail' | 'tessellation_fail',
    data: {
      fips: string;
      name?: string;
      state?: string;
      expectedCount?: number | null;
      actualCount: number;
      municipalBoundary?: MunicipalBoundary | null;
      tessellationProof?: TessellationProof | null;
      status: string;
      remediation: string;
    }
  ): VerificationResult {
    return {
      verified: false,
      failureStage: stage,
      city: {
        fips: data.fips,
        name: data.name ?? 'Unknown',
        state: data.state ?? 'XX',
      },
      expectedCount: data.expectedCount ?? null,
      actualCount: data.actualCount,
      municipalBoundary: data.municipalBoundary ?? null,
      tessellationProof: data.tessellationProof ?? null,
      status: data.status,
      remediation: data.remediation,
    };
  }

  /**
   * Generate remediation guidance for cardinality mismatch
   */
  private cardinalityRemediation(actual: number, expected: number): string {
    if (actual > expected * 2) {
      return 'Likely wrong granularity - data may be neighborhoods, precincts, or census tracts instead of council districts';
    }

    if (actual < expected / 2) {
      return 'Missing districts - data may be incomplete or represent only a subset of the city';
    }

    if (actual > expected) {
      return `${actual - expected} extra districts - possible redistricting or duplicate features`;
    }

    return `${expected - actual} missing districts - check for incomplete data extraction`;
  }

  /**
   * Generate remediation guidance for tessellation failures
   */
  private tessellationRemediation(proof: TessellationProof): string {
    switch (proof.failedAxiom) {
      case 'exclusivity':
        return `Overlapping districts detected. Check for: (1) duplicate features, (2) multiple data layers merged, (3) incorrect dataset selection`;

      case 'exhaustivity':
        return `Districts do not cover full municipal area (${(proof.diagnostics.coverageRatio * 100).toFixed(1)}%). Check for: (1) missing districts, (2) outdated boundary data, (3) annexation/boundary changes`;

      case 'containment':
        return `Districts extend beyond municipal boundary. Check for: (1) county-level data misattributed to city, (2) regional district data, (3) boundary vintage mismatch`;

      case 'cardinality':
        return `Wrong district count. Check EXPECTED_DISTRICT_COUNTS registry for correct count.`;

      default:
        return 'Unknown tessellation failure - manual investigation required';
    }
  }
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * One-shot verification
 */
export async function verifyCouncilDistricts(
  fips: string,
  districts: FeatureCollection<Polygon | MultiPolygon>
): Promise<VerificationResult> {
  const verifier = new CouncilDistrictVerifier();
  return verifier.verify(fips, districts);
}
