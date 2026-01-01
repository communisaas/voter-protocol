/**
 * Temporal Versioning Types for Court-Ordered Redistricting
 *
 * Handles complex redistricting scenarios where multiple boundary versions
 * may be legally valid simultaneously due to court orders, litigation, or
 * pending legislative action.
 *
 * LEGAL FRAMEWORK:
 * - Court-ordered redistricting can create interim/remedial maps
 * - Multiple versions may exist: enacted, challenged, enjoined, remedial
 * - Each version has legal effective dates and election applicability
 * - Resolution requires understanding court order hierarchy
 *
 * KEY SCENARIOS:
 * 1. TX 2011: Federal court drew interim maps after legislative maps enjoined
 * 2. AL 2023: Court-ordered remedial map replaced legislative map mid-cycle
 * 3. NC 2022: State supreme court invalidated legislative maps
 * 4. WI 2022: Governor vetoed maps, court adopted alternative
 *
 * Reference: Rucho v. Common Cause (2019), Harper v. Moore (2023)
 */

// ============================================================================
// Version Status Types
// ============================================================================

/**
 * Boundary version status.
 *
 * Tracks the legal status of a boundary version through its lifecycle.
 */
export type BoundaryVersionStatus =
  | 'enacted'      // Passed by legislature, signed by governor
  | 'challenged'   // Under legal challenge but still effective
  | 'enjoined'     // Court blocked enforcement (not currently effective)
  | 'interim'      // Court-drawn interim map while litigation pending
  | 'remedial'     // Court-ordered remedial map after finding violation
  | 'superseded';  // Replaced by newer version

/**
 * Court order type hierarchy (by precedence).
 *
 * Higher precedence orders supersede lower ones.
 */
export type CourtOrderType =
  | 'mandate'     // Final order from appeals court (highest precedence)
  | 'remedial'    // Court-drawn remedial map
  | 'interim'     // Temporary map pending final resolution
  | 'preliminary' // Preliminary injunction
  | 'stay';       // Stay of lower court order

/**
 * Court level for jurisdiction determination.
 */
export type CourtLevel =
  | 'scotus'       // U.S. Supreme Court
  | 'circuit'      // Federal Circuit Court of Appeals
  | 'district'     // Federal District Court
  | 'state_supreme' // State Supreme Court
  | 'state_appeals' // State Court of Appeals
  | 'state_trial'; // State Trial Court

// ============================================================================
// Court Order Provenance
// ============================================================================

/**
 * Provenance for court-ordered boundary changes.
 *
 * Captures the legal authority and timeline for court-ordered maps.
 */
export interface CourtOrderProvenance {
  /** Unique identifier for the court case (e.g., "2:21-cv-01536") */
  readonly caseNumber: string;

  /** Name of the case (e.g., "Allen v. Milligan") */
  readonly caseName: string;

  /** Court that issued the order */
  readonly court: string;

  /** Court level for precedence */
  readonly courtLevel: CourtLevel;

  /** Type of court order */
  readonly orderType: CourtOrderType;

  /** Date the order was issued */
  readonly orderDate: Date;

  /** Date the order takes legal effect */
  readonly effectiveDate: Date;

  /** Date the order expires (null if no expiration) */
  readonly expirationDate: Date | null;

  /** Elections this order applies to (e.g., ["2024-primary", "2024-general"]) */
  readonly applicableElections: readonly string[];

  /** URL to the court order document (PDF typically) */
  readonly orderUrl?: string;

  /** URL to the case docket */
  readonly docketUrl?: string;

  /** Whether the order has been appealed */
  readonly appealed: boolean;

  /** Current appeal status if appealed */
  readonly appealStatus?: 'pending' | 'affirmed' | 'reversed' | 'remanded';

  /** Notes about the order's scope or limitations */
  readonly notes?: string;
}

// ============================================================================
// Extended Boundary Metadata with Versioning
// ============================================================================

/**
 * Extended boundary metadata with temporal versioning support.
 *
 * Extends the base BoundaryMetadata with fields needed to track
 * court-ordered redistricting and version lifecycle.
 */
export interface BoundaryMetadataVersioned {
  /** Unique identifier for this specific version */
  readonly versionId: string;

  /** Sequence number within version chain (1 = original enacted, 2+ = revisions) */
  readonly versionSequence: number;

  /** Previous version ID in the chain (null for original enacted) */
  readonly previousVersion: string | null;

  /** Current status of this version */
  readonly versionStatus: BoundaryVersionStatus;

  /** Court order that created/modified this version (null for legislative maps) */
  readonly courtOrder: CourtOrderProvenance | null;

  /** Legal effective date (when this version became/becomes legally effective) */
  readonly legalEffectiveFrom: Date;

  /** Legal expiration date (when this version ceased/ceases to be effective) */
  readonly legalEffectiveUntil: Date | null;

  /** Elections where this version was/will be used */
  readonly usedInElections: readonly string[];

  /** Source of the map (legislature, federal court, state court, commission) */
  readonly mapSource: MapSource;

  /** Geographic hash of the boundary geometry (for change detection) */
  readonly geometryHash: string;

  /** Whether this is the currently applicable version */
  readonly isCurrent: boolean;
}

/**
 * Source of the redistricting map.
 */
export type MapSource =
  | 'legislature'       // State legislature enacted
  | 'commission'        // Independent redistricting commission
  | 'federal_court'     // Federal court (interim or remedial)
  | 'state_court'       // State court (interim or remedial)
  | 'special_master';   // Court-appointed special master

// ============================================================================
// Version Resolution Types
// ============================================================================

/**
 * Query for resolving which boundary version applies.
 */
export interface VersionResolutionQuery {
  /** Boundary ID (GEOID) */
  readonly boundaryId: string;

  /** Layer type (cd, sldu, sldl) */
  readonly layerType: string;

  /** State FIPS code */
  readonly stateFips: string;

  /** Date to resolve version for (election date or query date) */
  readonly asOfDate: Date;

  /** Specific election to resolve for (optional, more precise than date) */
  readonly election?: string;

  /** Whether to include superseded versions in response */
  readonly includeHistory?: boolean;
}

/**
 * Result of version resolution.
 */
export interface VersionResolutionResult {
  /** The resolved version (current as of query) */
  readonly currentVersion: BoundaryMetadataVersioned;

  /** All versions that were considered */
  readonly versionChain: readonly BoundaryMetadataVersioned[];

  /** Confidence in the resolution (affected by pending litigation) */
  readonly confidence: number;

  /** Resolution method used */
  readonly resolutionMethod: ResolutionMethod;

  /** Warnings about the resolution (e.g., pending appeals) */
  readonly warnings: readonly string[];

  /** Recommended action if confidence is low */
  readonly recommendation?: string;
}

/**
 * Method used to resolve version.
 */
export type ResolutionMethod =
  | 'date_match'       // Simple date range matching
  | 'election_match'   // Matched to specific election
  | 'court_order'      // Resolved via court order precedence
  | 'fallback';        // No exact match, used most recent valid

// ============================================================================
// Version Chain Types
// ============================================================================

/**
 * Complete version chain for a boundary.
 *
 * Represents the full history of a boundary through redistricting cycles.
 */
export interface BoundaryVersionChain {
  /** Boundary ID (GEOID) */
  readonly boundaryId: string;

  /** Layer type */
  readonly layerType: string;

  /** State FIPS code */
  readonly stateFips: string;

  /** Census year this chain started (e.g., 2020) */
  readonly censusYear: number;

  /** All versions in chronological order */
  readonly versions: readonly BoundaryMetadataVersioned[];

  /** Currently effective version ID */
  readonly currentVersionId: string;

  /** Whether any version is under active litigation */
  readonly hasActiveLitigation: boolean;

  /** Next scheduled update (if known) */
  readonly nextScheduledUpdate?: Date;
}

// ============================================================================
// Court Order Precedence Helpers
// ============================================================================

/**
 * Precedence scores for court order types.
 * Higher score = higher precedence.
 */
export const COURT_ORDER_PRECEDENCE: Record<CourtOrderType, number> = {
  mandate: 5,     // Final appellate mandate
  remedial: 4,    // Court-drawn remedial map
  interim: 3,     // Temporary pending resolution
  preliminary: 2, // Preliminary injunction
  stay: 1,        // Stay of lower order
} as const;

/**
 * Precedence scores for court levels.
 * Higher score = higher authority.
 */
export const COURT_LEVEL_PRECEDENCE: Record<CourtLevel, number> = {
  scotus: 6,        // Supreme Court
  circuit: 5,       // Circuit Court of Appeals
  district: 4,      // Federal District Court
  state_supreme: 3, // State Supreme Court
  state_appeals: 2, // State Appeals Court
  state_trial: 1,   // State Trial Court
} as const;

/**
 * Compare two court orders by precedence.
 *
 * @param a - First court order
 * @param b - Second court order
 * @returns Negative if a takes precedence, positive if b takes precedence
 */
export function compareCourtOrderPrecedence(
  a: CourtOrderProvenance,
  b: CourtOrderProvenance
): number {
  // First compare by court level
  const levelDiff = COURT_LEVEL_PRECEDENCE[b.courtLevel] - COURT_LEVEL_PRECEDENCE[a.courtLevel];
  if (levelDiff !== 0) {
    return levelDiff;
  }

  // Then by order type
  const typeDiff = COURT_ORDER_PRECEDENCE[b.orderType] - COURT_ORDER_PRECEDENCE[a.orderType];
  if (typeDiff !== 0) {
    return typeDiff;
  }

  // Finally by date (newer takes precedence)
  return b.orderDate.getTime() - a.orderDate.getTime();
}

/**
 * Check if a version is currently effective as of a given date.
 *
 * @param version - Boundary version to check
 * @param asOfDate - Date to check against
 * @returns True if version is effective
 */
export function isVersionEffective(
  version: BoundaryMetadataVersioned,
  asOfDate: Date
): boolean {
  const date = asOfDate.getTime();

  // Check if before effective date
  if (date < version.legalEffectiveFrom.getTime()) {
    return false;
  }

  // Check if after expiration (if set)
  if (version.legalEffectiveUntil !== null &&
      date >= version.legalEffectiveUntil.getTime()) {
    return false;
  }

  // Check status - enjoined versions are not effective
  if (version.versionStatus === 'enjoined' ||
      version.versionStatus === 'superseded') {
    return false;
  }

  return true;
}

/**
 * Get the confidence score for a version based on its status.
 *
 * @param version - Boundary version
 * @returns Confidence score (0.0 - 1.0)
 */
export function getVersionConfidence(
  version: BoundaryMetadataVersioned
): number {
  switch (version.versionStatus) {
    case 'enacted':
      return version.courtOrder?.appealed ? 0.7 : 1.0;
    case 'remedial':
      return version.courtOrder?.appealed ? 0.6 : 0.9;
    case 'interim':
      return 0.5; // Inherently temporary
    case 'challenged':
      return 0.4; // Under active challenge
    case 'enjoined':
      return 0.0; // Not currently effective
    case 'superseded':
      return 0.0; // Replaced by newer version
    default:
      return 0.5;
  }
}
