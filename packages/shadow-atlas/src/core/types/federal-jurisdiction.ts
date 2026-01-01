/**
 * Federal Jurisdiction Types
 *
 * Defines federal enclave types and voting jurisdiction resolution logic.
 * Military installations and federal lands have complex voting relationships
 * with surrounding state/county jurisdictions.
 *
 * LEGAL FRAMEWORK:
 * - Exclusive federal: Federal courts only (rare, e.g., DC federal buildings)
 * - Concurrent: Both federal and state jurisdiction (most military bases)
 * - Partial: Federal for some purposes, state for others
 * - Proprietary: Federal owns land but state has full jurisdiction
 *
 * VOTING IMPLICATIONS:
 * - Residents on federal land vote in the surrounding jurisdiction
 * - Base address determines congressional/state legislative district
 * - Some installations span multiple counties/states (joint-base complexity)
 *
 * Reference: 40 U.S.C. § 3112 (Federal jurisdiction cessions)
 */

// ============================================================================
// Federal Jurisdiction Types
// ============================================================================

/**
 * Federal jurisdiction type over a geographic area.
 *
 * Determines the relationship between federal and state authority,
 * which affects voting jurisdiction resolution.
 */
export type FederalJurisdictionType =
  | 'exclusive'   // Federal courts only - no state jurisdiction
  | 'concurrent'  // Both federal and state jurisdiction apply
  | 'partial'     // Federal for some purposes, state for others
  | 'proprietary'; // Federal owns land, state has full jurisdiction

/**
 * Military installation status.
 *
 * Active installations have current voting populations.
 * Closed/realigned bases may retain geographic footprint but no voters.
 */
export type InstallationStatus =
  | 'active'      // Currently operational
  | 'reserve'     // Reserve/Guard component only
  | 'realigned'   // BRAC realignment in progress
  | 'closed'      // Closed under BRAC or other authority
  | 'shared';     // Joint-use with civilian airport or other entity

/**
 * Military branch operating the installation.
 */
export type MilitaryBranch =
  | 'army'
  | 'navy'
  | 'air_force'
  | 'marine_corps'
  | 'space_force'
  | 'coast_guard'
  | 'joint'       // Multi-service joint base
  | 'dod';        // DoD-wide (e.g., DLA facilities)

/**
 * Federal agency type for non-military federal lands.
 */
export type FederalAgency =
  | 'dod'         // Department of Defense
  | 'doi'         // Department of Interior (BLM, NPS)
  | 'usda'        // Department of Agriculture (USFS)
  | 'doe'         // Department of Energy
  | 'dva'         // Department of Veterans Affairs
  | 'gsa'         // General Services Administration
  | 'other';      // Other federal agencies

// ============================================================================
// Military Installation Metadata
// ============================================================================

/**
 * Metadata for a military installation boundary.
 *
 * Extends TIGER MIL layer data with voting-relevant information.
 */
export interface MilitaryInstallationMetadata {
  /** TIGER AREAID (unique installation identifier) */
  readonly areaId: string;

  /** Installation name (e.g., "Fort Liberty", "Joint Base Lewis-McChord") */
  readonly name: string;

  /** Full legal name from TIGER FULLNAME field */
  readonly fullName: string;

  /** Primary state FIPS containing the installation */
  readonly primaryStateFips: string;

  /** All state FIPS codes if installation spans multiple states */
  readonly stateFipsCodes: readonly string[];

  /** All county FIPS codes the installation overlaps */
  readonly countyFipsCodes: readonly string[];

  /** Federal jurisdiction type */
  readonly jurisdictionType: FederalJurisdictionType;

  /** Installation operational status */
  readonly status: InstallationStatus;

  /** Primary military branch (or 'joint' for joint bases) */
  readonly branch: MilitaryBranch;

  /** Federal agency for non-military federal lands */
  readonly agency?: FederalAgency;

  /** Whether installation has resident voting population */
  readonly hasResidentVoters: boolean;

  /** Congressional districts the installation overlaps */
  readonly congressionalDistricts: readonly string[];

  /** State legislative upper districts overlapping */
  readonly stateSenateDistricts: readonly string[];

  /** State legislative lower districts overlapping */
  readonly stateHouseDistricts: readonly string[];

  /** Installation centroid for fallback jurisdiction assignment */
  readonly centroid?: {
    readonly lat: number;
    readonly lng: number;
  };

  /** Land area in square meters */
  readonly areaSquareMeters: number;

  /** Date of last boundary update */
  readonly boundaryUpdated: string;
}

// ============================================================================
// Voting Jurisdiction Resolution
// ============================================================================

/**
 * Result of resolving voting jurisdiction for a point on federal land.
 *
 * Even on federal land, residents vote in the surrounding state/local
 * jurisdiction based on their address.
 */
export interface VotingJurisdictionResolution {
  /** Whether the point is on federal land */
  readonly onFederalLand: boolean;

  /** Federal installation info if applicable */
  readonly installation?: {
    readonly areaId: string;
    readonly name: string;
    readonly jurisdictionType: FederalJurisdictionType;
  };

  /** Resolved voting jurisdiction (surrounding area) */
  readonly votingJurisdiction: {
    /** State FIPS for voting purposes */
    readonly stateFips: string;

    /** County FIPS for voting purposes */
    readonly countyFips: string;

    /** Congressional district GEOID */
    readonly congressionalDistrict?: string;

    /** State senate district GEOID */
    readonly stateSenateDistrict?: string;

    /** State house district GEOID */
    readonly stateHouseDistrict?: string;
  };

  /** Resolution method used */
  readonly resolutionMethod: VotingResolutionMethod;

  /** Confidence in resolution (0.0 - 1.0) */
  readonly confidence: number;

  /** Notes about resolution (e.g., "spans multiple counties") */
  readonly notes?: string;
}

/**
 * Method used to resolve voting jurisdiction on federal land.
 */
export type VotingResolutionMethod =
  | 'address_match'        // Direct address geocoding to surrounding jurisdiction
  | 'installation_primary' // Used installation's primary county/district
  | 'centroid_fallback'    // Used installation centroid for PIP lookup
  | 'manual_mapping';      // Pre-configured mapping for complex installations

// ============================================================================
// Resolution Functions
// ============================================================================

/**
 * Determine voting jurisdiction for a point on federal land.
 *
 * Federal land residents vote in the surrounding state/local jurisdiction.
 * This function resolves which jurisdiction applies based on:
 * 1. Installation metadata (preferred - pre-computed mappings)
 * 2. Centroid-based point-in-polygon lookup (fallback)
 *
 * @param installation - Military installation metadata
 * @param point - Optional specific point within installation
 * @returns Voting jurisdiction resolution
 *
 * @example
 * ```typescript
 * const installation = await getInstallation('M000001');
 * const resolution = getVotingJurisdiction(installation);
 *
 * if (resolution.onFederalLand) {
 *   console.log(`Vote in CD: ${resolution.votingJurisdiction.congressionalDistrict}`);
 * }
 * ```
 */
export function getVotingJurisdiction(
  installation: MilitaryInstallationMetadata,
  point?: { readonly lat: number; readonly lng: number }
): VotingJurisdictionResolution {
  // Use pre-computed primary jurisdiction if no specific point
  if (!point) {
    return {
      onFederalLand: true,
      installation: {
        areaId: installation.areaId,
        name: installation.name,
        jurisdictionType: installation.jurisdictionType,
      },
      votingJurisdiction: {
        stateFips: installation.primaryStateFips,
        countyFips: installation.countyFipsCodes[0] ?? 'unknown',
        congressionalDistrict: installation.congressionalDistricts[0],
        stateSenateDistrict: installation.stateSenateDistricts[0],
        stateHouseDistrict: installation.stateHouseDistricts[0],
      },
      resolutionMethod: 'installation_primary',
      confidence: installation.countyFipsCodes.length === 1 ? 0.95 : 0.7,
      notes: installation.countyFipsCodes.length > 1
        ? `Installation spans ${installation.countyFipsCodes.length} counties`
        : undefined,
    };
  }

  // Point provided - would need PIP lookup against surrounding jurisdictions
  // This is a placeholder - actual implementation would query the Merkle tree
  return {
    onFederalLand: true,
    installation: {
      areaId: installation.areaId,
      name: installation.name,
      jurisdictionType: installation.jurisdictionType,
    },
    votingJurisdiction: {
      stateFips: installation.primaryStateFips,
      countyFips: installation.countyFipsCodes[0] ?? 'unknown',
      congressionalDistrict: installation.congressionalDistricts[0],
      stateSenateDistrict: installation.stateSenateDistricts[0],
      stateHouseDistrict: installation.stateHouseDistricts[0],
    },
    resolutionMethod: 'centroid_fallback',
    confidence: 0.6,
    notes: 'Specific point lookup requires R-tree spatial index',
  };
}

/**
 * Check if a jurisdiction type allows state voting.
 *
 * All federal jurisdiction types allow state voting except
 * purely exclusive federal areas (which are extremely rare).
 *
 * @param type - Federal jurisdiction type
 * @returns True if state voting is permitted
 */
export function allowsStateVoting(type: FederalJurisdictionType): boolean {
  // Even exclusive federal jurisdiction allows voting for most purposes
  // The distinction mainly affects court jurisdiction, not voting rights
  return true;
}

/**
 * Get default confidence for installation jurisdiction resolution.
 *
 * @param installation - Installation metadata
 * @returns Confidence score (0.0 - 1.0)
 */
export function getResolutionConfidence(
  installation: MilitaryInstallationMetadata
): number {
  // Single county = high confidence
  if (installation.countyFipsCodes.length === 1) {
    return 0.95;
  }

  // Single state but multiple counties = moderate confidence
  if (installation.stateFipsCodes.length === 1) {
    return 0.8;
  }

  // Multi-state installation = lower confidence (needs manual mapping)
  return 0.5;
}

// ============================================================================
// Installation Classification Helpers
// ============================================================================

/**
 * Check if installation is a joint base (multi-service).
 */
export function isJointBase(installation: MilitaryInstallationMetadata): boolean {
  return installation.branch === 'joint' ||
    installation.name.toLowerCase().includes('joint base');
}

/**
 * Check if installation spans multiple states.
 */
export function isMultiStateInstallation(
  installation: MilitaryInstallationMetadata
): boolean {
  return installation.stateFipsCodes.length > 1;
}

/**
 * Check if installation is currently active.
 */
export function isActiveInstallation(
  installation: MilitaryInstallationMetadata
): boolean {
  return installation.status === 'active' || installation.status === 'reserve';
}

/**
 * Get primary voting county for installation.
 *
 * For multi-county installations, returns the county containing
 * the largest portion of the installation (based on metadata order).
 */
export function getPrimaryVotingCounty(
  installation: MilitaryInstallationMetadata
): string {
  return installation.countyFipsCodes[0] ?? 'unknown';
}
