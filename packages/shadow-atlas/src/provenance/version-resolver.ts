/**
 * Version Resolver for Court-Ordered Redistricting
 *
 * Resolves which boundary version applies for a given date/election
 * when multiple versions exist due to court orders and litigation.
 *
 * RESOLUTION ALGORITHM:
 * 1. Filter to versions effective on query date
 * 2. If election specified, filter to versions applicable to that election
 * 3. Apply court order precedence (higher court > lower court)
 * 4. Apply order type precedence (mandate > remedial > interim)
 * 5. Return highest precedence version with confidence score
 *
 * EDGE CASES HANDLED:
 * - Pending appeals (reduced confidence)
 * - Multiple court orders from different courts
 * - Gap periods between versions
 * - Future versions (scheduled redistricting)
 */

import type {
  BoundaryMetadataVersioned,
  VersionResolutionQuery,
  VersionResolutionResult,
  ResolutionMethod,
  BoundaryVersionChain,
  CourtOrderProvenance,
} from '../core/types/temporal-versioning.js';

import {
  isVersionEffective,
  getVersionConfidence,
  compareCourtOrderPrecedence,
} from '../core/types/temporal-versioning.js';

// ============================================================================
// Version Resolver Class
// ============================================================================

/**
 * Resolves which boundary version applies for a given query.
 *
 * Thread-safe, stateless resolver that can be used across multiple requests.
 */
export class VersionResolver {
  /**
   * Resolve which version applies for a given query.
   *
   * @param query - Resolution query with date/election
   * @param versionChain - All versions for the boundary
   * @returns Resolution result with current version and confidence
   *
   * @example
   * ```typescript
   * const resolver = new VersionResolver();
   * const result = resolver.resolve(
   *   {
   *     boundaryId: '0101',
   *     layerType: 'cd',
   *     stateFips: '01',
   *     asOfDate: new Date('2024-11-05'),
   *     election: '2024-general',
   *   },
   *   versionChain
   * );
   *
   * if (result.confidence > 0.8) {
   *   // Use result.currentVersion
   * } else {
   *   console.warn(result.warnings);
   * }
   * ```
   */
  resolve(
    query: VersionResolutionQuery,
    versionChain: BoundaryVersionChain
  ): VersionResolutionResult {
    const { asOfDate, election } = query;

    // Step 1: Filter to effective versions
    const effectiveVersions = versionChain.versions.filter(
      (v) => isVersionEffective(v, asOfDate)
    );

    // Handle no effective versions
    if (effectiveVersions.length === 0) {
      return this.handleNoEffectiveVersions(query, versionChain);
    }

    // Step 2: If election specified, filter to applicable elections
    let candidates = effectiveVersions;
    let method: ResolutionMethod = 'date_match';

    if (election) {
      const electionMatches = effectiveVersions.filter(
        (v) => v.usedInElections.includes(election)
      );

      if (electionMatches.length > 0) {
        candidates = electionMatches;
        method = 'election_match';
      }
    }

    // Step 3: If single candidate, return it
    if (candidates.length === 1) {
      return this.buildResult(
        candidates[0],
        versionChain.versions,
        method,
        query.includeHistory ?? false
      );
    }

    // Step 4: Multiple candidates - resolve by court order precedence
    const resolved = this.resolveByCourtOrder(candidates);
    method = resolved.hadCourtOrder ? 'court_order' : method;

    return this.buildResult(
      resolved.version,
      versionChain.versions,
      method,
      query.includeHistory ?? false
    );
  }

  /**
   * Resolve a boundary version at a specific date.
   *
   * Convenience method that builds the query internally.
   *
   * @param boundaryId - Boundary GEOID
   * @param layerType - Layer type (cd, sldu, sldl)
   * @param stateFips - State FIPS code
   * @param asOfDate - Date to resolve for
   * @param versionChain - All versions for the boundary
   * @returns Resolution result
   */
  resolveAtDate(
    boundaryId: string,
    layerType: string,
    stateFips: string,
    asOfDate: Date,
    versionChain: BoundaryVersionChain
  ): VersionResolutionResult {
    return this.resolve(
      {
        boundaryId,
        layerType,
        stateFips,
        asOfDate,
      },
      versionChain
    );
  }

  /**
   * Resolve a boundary version for a specific election.
   *
   * @param boundaryId - Boundary GEOID
   * @param layerType - Layer type (cd, sldu, sldl)
   * @param stateFips - State FIPS code
   * @param election - Election identifier (e.g., "2024-general")
   * @param electionDate - Date of the election
   * @param versionChain - All versions for the boundary
   * @returns Resolution result
   */
  resolveForElection(
    boundaryId: string,
    layerType: string,
    stateFips: string,
    election: string,
    electionDate: Date,
    versionChain: BoundaryVersionChain
  ): VersionResolutionResult {
    return this.resolve(
      {
        boundaryId,
        layerType,
        stateFips,
        asOfDate: electionDate,
        election,
      },
      versionChain
    );
  }

  // ============================================================================
  // Private Resolution Methods
  // ============================================================================

  /**
   * Resolve multiple candidates by court order precedence.
   */
  private resolveByCourtOrder(
    candidates: readonly BoundaryMetadataVersioned[]
  ): { version: BoundaryMetadataVersioned; hadCourtOrder: boolean } {
    // Separate versions with and without court orders
    const withCourtOrder = candidates.filter((v) => v.courtOrder !== null);
    const withoutCourtOrder = candidates.filter((v) => v.courtOrder === null);

    // If any have court orders, use court order precedence
    if (withCourtOrder.length > 0) {
      const sorted = [...withCourtOrder].sort((a, b) =>
        compareCourtOrderPrecedence(
          a.courtOrder as CourtOrderProvenance,
          b.courtOrder as CourtOrderProvenance
        )
      );
      return { version: sorted[0], hadCourtOrder: true };
    }

    // No court orders - use most recent by effective date
    const sorted = [...withoutCourtOrder].sort(
      (a, b) => b.legalEffectiveFrom.getTime() - a.legalEffectiveFrom.getTime()
    );
    return { version: sorted[0], hadCourtOrder: false };
  }

  /**
   * Handle case where no versions are effective.
   */
  private handleNoEffectiveVersions(
    query: VersionResolutionQuery,
    versionChain: BoundaryVersionChain
  ): VersionResolutionResult {
    // Check if there are any versions at all
    if (versionChain.versions.length === 0) {
      throw new Error(
        `No versions found for boundary ${query.boundaryId} in ${query.layerType}`
      );
    }

    // Check for future versions
    const futureVersions = versionChain.versions.filter(
      (v) => v.legalEffectiveFrom.getTime() > query.asOfDate.getTime()
    );

    if (futureVersions.length > 0) {
      // Return the next upcoming version with warning
      const nextVersion = futureVersions.sort(
        (a, b) => a.legalEffectiveFrom.getTime() - b.legalEffectiveFrom.getTime()
      )[0];

      return {
        currentVersion: nextVersion,
        versionChain: versionChain.versions,
        confidence: 0.3,
        resolutionMethod: 'fallback',
        warnings: [
          `Query date ${query.asOfDate.toISOString()} is before any effective version`,
          `Next version effective: ${nextVersion.legalEffectiveFrom.toISOString()}`,
        ],
        recommendation: 'Wait for upcoming version or check historical data',
      };
    }

    // Use most recent expired version as fallback
    const mostRecent = [...versionChain.versions].sort(
      (a, b) => b.legalEffectiveFrom.getTime() - a.legalEffectiveFrom.getTime()
    )[0];

    return {
      currentVersion: mostRecent,
      versionChain: versionChain.versions,
      confidence: 0.2,
      resolutionMethod: 'fallback',
      warnings: [
        `No version effective on ${query.asOfDate.toISOString()}`,
        `Using most recent version (${mostRecent.versionStatus}) as fallback`,
      ],
      recommendation: 'Verify current legal status of redistricting',
    };
  }

  /**
   * Build the resolution result.
   */
  private buildResult(
    version: BoundaryMetadataVersioned,
    allVersions: readonly BoundaryMetadataVersioned[],
    method: ResolutionMethod,
    includeHistory: boolean
  ): VersionResolutionResult {
    const confidence = getVersionConfidence(version);
    const warnings: string[] = [];

    // Add warnings for low confidence scenarios
    if (version.courtOrder?.appealed) {
      warnings.push(
        `Version under appeal (${version.courtOrder.appealStatus ?? 'pending'})`
      );
    }

    if (version.versionStatus === 'challenged') {
      warnings.push('Version is under active legal challenge');
    }

    if (version.versionStatus === 'interim') {
      warnings.push('Version is an interim map pending final resolution');
    }

    // Check for pending supersession
    const hasNewer = allVersions.some(
      (v) =>
        v.legalEffectiveFrom.getTime() > version.legalEffectiveFrom.getTime() &&
        v.versionStatus !== 'enjoined' &&
        v.versionStatus !== 'superseded'
    );

    if (hasNewer) {
      warnings.push('Newer version exists - may be superseded soon');
    }

    return {
      currentVersion: version,
      versionChain: includeHistory ? allVersions : [version],
      confidence,
      resolutionMethod: method,
      warnings,
      recommendation:
        confidence < 0.5
          ? 'Verify with state election authority before use'
          : undefined,
    };
  }
}

// ============================================================================
// Factory and Singleton
// ============================================================================

/** Singleton resolver instance */
let resolverInstance: VersionResolver | null = null;

/**
 * Get the singleton VersionResolver instance.
 */
export function getVersionResolver(): VersionResolver {
  if (resolverInstance === null) {
    resolverInstance = new VersionResolver();
  }
  return resolverInstance;
}

/**
 * Resolve a version at a specific date (convenience function).
 *
 * @param query - Resolution query
 * @param versionChain - Boundary version chain
 * @returns Resolution result
 */
export function resolveVersionAtDate(
  query: VersionResolutionQuery,
  versionChain: BoundaryVersionChain
): VersionResolutionResult {
  return getVersionResolver().resolve(query, versionChain);
}

// ============================================================================
// Version Chain Builders
// ============================================================================

/**
 * Build a version chain from an array of versioned boundaries.
 *
 * @param boundaryId - Boundary GEOID
 * @param layerType - Layer type
 * @param stateFips - State FIPS code
 * @param censusYear - Census year for the redistricting cycle
 * @param versions - All versions for this boundary
 * @returns Complete version chain
 */
export function buildVersionChain(
  boundaryId: string,
  layerType: string,
  stateFips: string,
  censusYear: number,
  versions: readonly BoundaryMetadataVersioned[]
): BoundaryVersionChain {
  // Sort by effective date
  const sorted = [...versions].sort(
    (a, b) => a.legalEffectiveFrom.getTime() - b.legalEffectiveFrom.getTime()
  );

  // Find current version (effective and not superseded/enjoined)
  const now = new Date();
  const current = sorted.find(
    (v) => isVersionEffective(v, now) && v.isCurrent
  );

  // Check for active litigation
  const hasActiveLitigation = versions.some(
    (v) =>
      v.versionStatus === 'challenged' ||
      (v.courtOrder?.appealed && v.courtOrder.appealStatus === 'pending')
  );

  return {
    boundaryId,
    layerType,
    stateFips,
    censusYear,
    versions: sorted,
    currentVersionId: current?.versionId ?? sorted[sorted.length - 1].versionId,
    hasActiveLitigation,
  };
}

/**
 * Create a single enacted version (no court orders).
 *
 * Convenience for creating the common case of a legislative-enacted map
 * with no court involvement.
 *
 * @param boundaryId - Boundary GEOID
 * @param effectiveFrom - Legal effective date
 * @param elections - Elections this applies to
 * @param geometryHash - Hash of boundary geometry
 * @returns Versioned boundary metadata
 */
export function createEnactedVersion(
  boundaryId: string,
  effectiveFrom: Date,
  elections: readonly string[],
  geometryHash: string
): BoundaryMetadataVersioned {
  return {
    versionId: `${boundaryId}-enacted-${effectiveFrom.getFullYear()}`,
    versionSequence: 1,
    previousVersion: null,
    versionStatus: 'enacted',
    courtOrder: null,
    legalEffectiveFrom: effectiveFrom,
    legalEffectiveUntil: null,
    usedInElections: elections,
    mapSource: 'legislature',
    geometryHash,
    isCurrent: true,
  };
}

/**
 * Create a court-ordered remedial version.
 *
 * @param boundaryId - Boundary GEOID
 * @param previousVersionId - ID of the version being replaced
 * @param courtOrder - Court order provenance
 * @param geometryHash - Hash of new boundary geometry
 * @returns Versioned boundary metadata
 */
export function createRemedialVersion(
  boundaryId: string,
  previousVersionId: string,
  versionSequence: number,
  courtOrder: CourtOrderProvenance,
  geometryHash: string
): BoundaryMetadataVersioned {
  return {
    versionId: `${boundaryId}-remedial-${courtOrder.orderDate.getFullYear()}`,
    versionSequence,
    previousVersion: previousVersionId,
    versionStatus: 'remedial',
    courtOrder,
    legalEffectiveFrom: courtOrder.effectiveDate,
    legalEffectiveUntil: courtOrder.expirationDate,
    usedInElections: courtOrder.applicableElections,
    mapSource: courtOrder.courtLevel.startsWith('state') ? 'state_court' : 'federal_court',
    geometryHash,
    isCurrent: true,
  };
}
