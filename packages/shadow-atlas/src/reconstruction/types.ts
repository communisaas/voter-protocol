/**
 * Boundary Reconstruction Types
 *
 * Type definitions for reconstructing ward/district boundaries from
 * legal descriptions and PDF maps.
 *
 * PHILOSOPHY:
 * - Street-snap reconstruction (boundaries follow streets, not pixels)
 * - Immutable data structures
 * - Explicit provenance (source documents tracked)
 * - Binary validation (tessellation proof, no confidence scores)
 *
 * ARCHITECTURE:
 * Legal Description → Street Matching → Polygon Construction → Validation
 */

import type { Feature, LineString, Polygon, MultiPolygon, Position } from 'geojson';

// =============================================================================
// Source Document Types
// =============================================================================

/**
 * Source document types for boundary descriptions
 */
export type SourceDocumentType =
  | 'pdf_redistricting_plan'    // Official redistricting PDF
  | 'pdf_ward_map'              // Ward/district map PDF
  | 'ordinance_text'            // Municipal ordinance text
  | 'resolution_text'           // City council resolution
  | 'charter_section'           // City charter section
  | 'web_page'                  // City website description
  | 'gis_metadata';             // GIS layer metadata/description

/**
 * Source document metadata
 */
export interface SourceDocument {
  /** Document type */
  readonly type: SourceDocumentType;

  /** Source URL or file path */
  readonly source: string;

  /** Document title */
  readonly title: string;

  /** Adoption/effective date */
  readonly effectiveDate: string;

  /** Document retrieval date */
  readonly retrievedAt: string;

  /** SHA-256 hash of document for integrity verification */
  readonly contentHash?: string;

  /** Notes about document quality/completeness */
  readonly notes?: string;
}

// =============================================================================
// Legal Description Types
// =============================================================================

/**
 * Direction in legal description (metes and bounds)
 */
export type CardinalDirection =
  | 'north' | 'south' | 'east' | 'west'
  | 'northeast' | 'northwest' | 'southeast' | 'southwest'
  | 'northerly' | 'southerly' | 'easterly' | 'westerly';

/**
 * Boundary segment reference type
 */
export type SegmentReferenceType =
  | 'street_centerline'     // "along Main Street"
  | 'street_edge'           // "along the northern edge of Main Street"
  | 'municipal_boundary'    // "along the city limits"
  | 'natural_feature'       // "along the river centerline"
  | 'railroad'              // "along the railroad right-of-way"
  | 'property_line'         // "along the rear property lines of..."
  | 'creek_stream'          // "along the creek"
  | 'highway'               // "along I-95" or "along US-1"
  | 'coordinate';           // Explicit lat/lng coordinate

/**
 * Single segment of a boundary description
 */
export interface BoundarySegmentDescription {
  /** Segment index in the boundary (0-based) */
  readonly index: number;

  /** Reference type */
  readonly referenceType: SegmentReferenceType;

  /** Street/feature name (e.g., "Main Street", "Elm Avenue") */
  readonly featureName: string;

  /** Direction of travel along feature */
  readonly direction?: CardinalDirection;

  /** Starting point description (e.g., "intersection with Oak St") */
  readonly from?: string;

  /** Ending point description */
  readonly to?: string;

  /** Raw text from source document */
  readonly rawText: string;

  /** Confidence in parsing (for diagnostics, not validation) */
  readonly parseConfidence: 'high' | 'medium' | 'low';
}

/**
 * Complete legal description of a ward/district boundary
 */
export interface WardLegalDescription {
  /** City FIPS code */
  readonly cityFips: string;

  /** City name */
  readonly cityName: string;

  /** State abbreviation */
  readonly state: string;

  /** Ward/district identifier (e.g., "1", "Ward 1", "District A") */
  readonly wardId: string;

  /** Ward/district display name */
  readonly wardName: string;

  /** Ordered list of boundary segments (forms closed ring) */
  readonly segments: readonly BoundarySegmentDescription[];

  /** Source document */
  readonly source: SourceDocument;

  /** Population (if available from source) */
  readonly population?: number;

  /** Notes about the description */
  readonly notes?: string;
}

// =============================================================================
// Street Network Types
// =============================================================================

/**
 * Street segment from OSM or other street network source
 */
export interface StreetSegment {
  /** OSM way ID or other unique identifier */
  readonly id: string;

  /** Street name (normalized) */
  readonly name: string;

  /** Alternative names (aliases) */
  readonly altNames: readonly string[];

  /** Street type (e.g., "street", "avenue", "boulevard") */
  readonly streetType: string;

  /** Highway classification (e.g., "residential", "primary", "motorway") */
  readonly highway: string;

  /** Geometry as GeoJSON LineString */
  readonly geometry: Feature<LineString>;

  /** Bounding box [minLon, minLat, maxLon, maxLat] */
  readonly bbox: readonly [number, number, number, number];
}

/**
 * Street network for a city
 */
export interface StreetNetwork {
  /** City FIPS code */
  readonly cityFips: string;

  /** All street segments indexed by normalized name */
  readonly segmentsByName: ReadonlyMap<string, readonly StreetSegment[]>;

  /** Spatial index for efficient lookup */
  readonly spatialIndex: unknown; // RBush or similar

  /** Municipal boundary for containment checks */
  readonly municipalBoundary: Feature<Polygon | MultiPolygon>;

  /** Data vintage */
  readonly vintage: string;

  /** Source (e.g., "osm", "tiger") */
  readonly source: 'osm' | 'tiger';
}

// =============================================================================
// Matching Result Types
// =============================================================================

/**
 * Match result for a single boundary segment
 */
export interface SegmentMatchResult {
  /** Original description segment */
  readonly description: BoundarySegmentDescription;

  /** Matched street segment(s) */
  readonly matchedSegments: readonly StreetSegment[];

  /** Match quality */
  readonly matchQuality: 'exact' | 'fuzzy' | 'partial' | 'failed';

  /** Extracted coordinates forming this part of the boundary */
  readonly coordinates: readonly Position[];

  /** Diagnostic info */
  readonly diagnostics: {
    /** Street name similarity score (0-1) */
    readonly nameSimilarity: number;
    /** Distance to nearest candidate (meters) */
    readonly distanceToCandidate: number;
    /** Alternative candidates considered */
    readonly alternativesConsidered: number;
    /** Reason for match/failure */
    readonly reason: string;
  };
}

/**
 * Complete matching result for a ward
 */
export interface WardMatchResult {
  /** Original legal description */
  readonly description: WardLegalDescription;

  /** Match results for each segment */
  readonly segmentMatches: readonly SegmentMatchResult[];

  /** Overall match success */
  readonly success: boolean;

  /** Failed segments (if any) */
  readonly failedSegments: readonly number[];

  /** Constructed polygon (if successful) */
  readonly polygon: Feature<Polygon | MultiPolygon> | null;

  /** Diagnostics */
  readonly diagnostics: {
    /** Total segments */
    readonly totalSegments: number;
    /** Successfully matched segments */
    readonly matchedSegments: number;
    /** Match rate (0-1) */
    readonly matchRate: number;
    /** Polygon closes properly */
    readonly ringClosed: boolean;
    /** Polygon is valid geometry */
    readonly geometryValid: boolean;
  };
}

// =============================================================================
// Reconstruction Result Types
// =============================================================================

/**
 * Reconstruction result for a single city
 */
export interface CityReconstructionResult {
  /** City FIPS code */
  readonly cityFips: string;

  /** City name */
  readonly cityName: string;

  /** State */
  readonly state: string;

  /** Ward reconstruction results */
  readonly wards: readonly WardMatchResult[];

  /** Overall success (all wards reconstructed) */
  readonly success: boolean;

  /** Tessellation validation (if all wards reconstructed) */
  readonly tessellationProof: TessellationProofSummary | null;

  /** Timestamp */
  readonly reconstructedAt: string;

  /** Source documents used */
  readonly sources: readonly SourceDocument[];
}

/**
 * Tessellation proof summary (from tessellation-proof.ts)
 */
export interface TessellationProofSummary {
  /** Binary correctness */
  readonly valid: boolean;

  /** Failed axiom (if any) */
  readonly failedAxiom: 'exclusivity' | 'exhaustivity' | 'containment' | 'cardinality' | null;

  /** Coverage ratio */
  readonly coverageRatio: number;

  /** Failure reason (if any) */
  readonly reason: string | null;
}

// =============================================================================
// Golden Vector Types (for regression testing)
// =============================================================================

/**
 * Golden vector for a city - known correct reconstruction
 */
export interface GoldenVector {
  /** City FIPS code */
  readonly cityFips: string;

  /** City name */
  readonly cityName: string;

  /** State */
  readonly state: string;

  /** Expected ward count */
  readonly expectedWardCount: number;

  /** Legal descriptions (input) */
  readonly legalDescriptions: readonly WardLegalDescription[];

  /** Expected polygon geometries (output) */
  readonly expectedPolygons: readonly Feature<Polygon>[];

  /** Verification date */
  readonly verifiedAt: string;

  /** Verification source */
  readonly verificationSource: string;

  /** Notes */
  readonly notes?: string;
}

// =============================================================================
// Parser Configuration Types
// =============================================================================

/**
 * Street name normalization rules
 */
export interface StreetNameNormalization {
  /** Suffix expansions (e.g., "St" → "Street") */
  readonly suffixExpansions: ReadonlyMap<string, string>;

  /** Direction expansions (e.g., "N" → "North") */
  readonly directionExpansions: ReadonlyMap<string, string>;

  /** Common abbreviations (e.g., "MLK" → "Martin Luther King") */
  readonly abbreviations: ReadonlyMap<string, string>;

  /** Words to remove (e.g., "the", "of") */
  readonly stopWords: ReadonlySet<string>;
}

/**
 * Parser configuration for legal descriptions
 */
export interface ParserConfig {
  /** Street name normalization */
  readonly normalization: StreetNameNormalization;

  /** Pattern matchers for segment types */
  readonly patterns: {
    readonly streetCenterline: readonly RegExp[];
    readonly intersection: readonly RegExp[];
    readonly direction: readonly RegExp[];
    readonly municipalBoundary: readonly RegExp[];
    readonly naturalFeature: readonly RegExp[];
  };

  /** Fuzzy matching threshold (0-1) */
  readonly fuzzyMatchThreshold: number;

  /** Maximum distance for street snap (meters) */
  readonly maxSnapDistance: number;
}
