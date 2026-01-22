/**
 * Boundary Reconstruction Module
 *
 * Reconstructs ward/district boundaries from legal descriptions and PDF maps.
 * Generalizable, regression-proof infrastructure for converting text-based
 * boundary descriptions into validated GeoJSON polygons.
 *
 * ARCHITECTURE:
 * ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
 * │  Legal         │    │  Street         │    │  Polygon        │
 * │  Description   │───▶│  Matching       │───▶│  Construction   │
 * │  Parser        │    │  Engine         │    │  & Validation   │
 * └─────────────────┘    └─────────────────┘    └─────────────────┘
 *         │                      │                      │
 *         ▼                      ▼                      ▼
 *   Structured             Matched               Valid GeoJSON
 *   Segments               Coordinates           Polygons
 *
 * PHILOSOPHY:
 * - Street-snap reconstruction (boundaries follow streets, not pixels)
 * - Immutable data structures (readonly throughout)
 * - Explicit provenance (source documents tracked)
 * - Binary validation (tessellation proof, no confidence scores)
 * - Golden vectors for regression prevention
 *
 * USAGE:
 * ```typescript
 * import {
 *   parseLegalDescription,
 *   matchWardDescription,
 *   buildWardPolygon,
 *   validateCityAgainstGolden,
 * } from './reconstruction';
 *
 * // 1. Parse legal description text
 * const parseResult = parseLegalDescription(ordinanceText);
 *
 * // 2. Create ward description
 * const { description } = parseWardDescription({
 *   cityFips: '1234567',
 *   cityName: 'Example City',
 *   state: 'TX',
 *   wardId: '1',
 *   wardName: 'Ward 1',
 *   descriptionText: ordinanceText,
 *   source: sourceDoc,
 * });
 *
 * // 3. Match to street network
 * const matchResult = matchWardDescription(description, streetQuery);
 *
 * // 4. Build polygon
 * const buildResult = buildWardPolygon(matchResult);
 *
 * // 5. Validate against golden vector (if available)
 * const validationResult = validateCityAgainstGolden(polygons, goldenVector);
 * ```
 */

// =============================================================================
// Types - Core type definitions
// =============================================================================

export type {
  // Source documents
  SourceDocumentType,
  SourceDocument,

  // Legal descriptions
  CardinalDirection,
  SegmentReferenceType,
  BoundarySegmentDescription,
  WardLegalDescription,

  // Street network
  StreetSegment,
  StreetNetwork,

  // Matching results
  SegmentMatchResult,
  WardMatchResult,

  // Reconstruction results
  CityReconstructionResult,
  TessellationProofSummary,

  // Golden vectors
  GoldenVector,

  // Configuration
  StreetNameNormalization,
  ParserConfig,
} from './types';

// =============================================================================
// Street Normalizer - Street name normalization and similarity
// =============================================================================

export {
  // Main functions
  normalizeStreetName,
  streetNameSimilarity,
  areStreetNamesEquivalent,
  extractStreetCandidates,
  getDefaultNormalization,

  // Types
  type NormalizedStreetName,
} from './street-normalizer';

// =============================================================================
// Description Parser - Parse legal descriptions into structured segments
// =============================================================================

export {
  // Main functions
  parseLegalDescription,
  parseWardDescription,
  validateParsedSegments,
  getDefaultParserConfig,

  // Types
  type ParseResult,
} from './description-parser';

// =============================================================================
// Segment Matcher - Match description segments to street network
// =============================================================================

export {
  // Main functions
  matchSegment,
  matchWardDescription,
  matchCityWards,
  haversineDistance,
  getDefaultMatcherConfig,

  // Street network query
  SimpleStreetNetworkQuery,
  type StreetNetworkQuery,

  // Configuration
  type MatcherConfig,
} from './segment-matcher';

// =============================================================================
// Polygon Builder - Construct valid polygons from matched segments
// =============================================================================

export {
  // Main functions
  buildPolygonFromMatches,
  buildWardPolygon,
  buildCityPolygons,
  combineWardPolygons,
  getDefaultPolygonBuilderConfig,

  // Geometry utilities
  signedRingArea,
  ringAreaSquareMeters,
  isCounterClockwise,
  hasSelfIntersections,
  reverseRing,
  closeRing,
  pointInRing,
  simplifyRing,

  // Types
  type PolygonBuilderConfig,
  type PolygonRepair,
  type PolygonBuildResult,
} from './polygon-builder';

// =============================================================================
// Golden Vector Validator - Regression prevention via golden vectors
// =============================================================================

export {
  // Main functions
  validateWardAgainstGolden,
  validateCityAgainstGolden,
  createGoldenVector,
  serializeGoldenVector,
  deserializeGoldenVector,
  detectRegressions,
  getDefaultGoldenVectorConfig,

  // Types
  type GoldenVectorConfig,
  type WardValidationResult,
  type GoldenVectorValidationResult,
} from './golden-vector-validator';

// =============================================================================
// Test Utilities - For testing and fixture generation
// =============================================================================

export {
  // Mock data generators
  createMockStreetSegment,
  createMockStreetGrid,
  createMockSegmentDescription,
  createMockSourceDocument,
  createMockWardDescription,
  createRectangularWardDescription,
  createMockPolygon,
  createRectangularPolygon,
  createTestFixture,

  // Assertions
  assertValidPolygon,
  assertPolygonsApproximatelyEqual,
} from './test-utils';

// =============================================================================
// OSM Street Network Loader - Real street data from OpenStreetMap
// =============================================================================

export {
  // Main functions
  loadStreetNetworkFromOSM,
  loadStreetNetworkForCity,
  getCityBoundingBox,
  createStreetQueryForCity,

  // Types
  type StreetNetworkLoadOptions,
} from './osm-street-loader';

// =============================================================================
// PDF Extractor - Extract legal descriptions from PDF documents
// =============================================================================

export {
  // Main functions
  extractTextFromPDF,
  extractTextFromPDFUrl,
  extractLegalDescriptions,
  extractLegalDescriptionsFromPDF,
  extractLegalDescriptionsFromPDFUrl,

  // Types
  type ExtractionConfidence,
  type PDFMetadata,
  type PDFExtractionResult,
  type LegalDescriptionSection,
  type LegalDescriptionsExtraction,
} from './pdf-extractor';

// =============================================================================
// Pipeline Convenience Functions
// =============================================================================

import type { Feature, Polygon } from 'geojson';
import type { WardLegalDescription, SourceDocument, GoldenVector } from './types';
import { parseWardDescription, type ParseResult } from './description-parser';
import { matchWardDescription, SimpleStreetNetworkQuery, type MatcherConfig } from './segment-matcher';
import { buildWardPolygon, type PolygonBuilderConfig, type PolygonBuildResult } from './polygon-builder';
import { validateCityAgainstGolden, type GoldenVectorValidationResult } from './golden-vector-validator';
import type { StreetSegment } from './types';

/**
 * Complete reconstruction pipeline for a single ward
 */
export interface WardReconstructionInput {
  readonly cityFips: string;
  readonly cityName: string;
  readonly state: string;
  readonly wardId: string;
  readonly wardName: string;
  readonly descriptionText: string;
  readonly source: SourceDocument;
  readonly population?: number;
  readonly notes?: string;
}

/**
 * Complete reconstruction result for a single ward
 */
export interface WardReconstructionOutput {
  readonly success: boolean;
  readonly description: WardLegalDescription;
  readonly parseResult: ParseResult;
  readonly buildResult: PolygonBuildResult;
  readonly polygon: Feature<Polygon> | null;
  readonly failureReason: string | null;
}

/**
 * Optimized reconstruction result for pre-parsed ward descriptions
 * (no parse result since parsing was already done)
 */
export interface WardReconstructionOutputFromParsed {
  readonly success: boolean;
  readonly description: WardLegalDescription;
  readonly buildResult: PolygonBuildResult;
  readonly polygon: Feature<Polygon> | null;
  readonly failureReason: string | null;
}

/**
 * Reconstruct a single ward from legal description text
 *
 * This is the main entry point for the reconstruction pipeline.
 */
export function reconstructWard(
  input: WardReconstructionInput,
  streetSegments: readonly StreetSegment[],
  matcherConfig?: MatcherConfig,
  builderConfig?: PolygonBuilderConfig
): WardReconstructionOutput {
  // Step 1: Parse legal description
  const { description, parseResult } = parseWardDescription({
    cityFips: input.cityFips,
    cityName: input.cityName,
    state: input.state,
    wardId: input.wardId,
    wardName: input.wardName,
    descriptionText: input.descriptionText,
    source: input.source,
    population: input.population,
    notes: input.notes,
  });

  if (!parseResult.success || parseResult.segments.length === 0) {
    return {
      success: false,
      description,
      parseResult,
      buildResult: {
        success: false,
        polygon: null,
        repairs: [],
        validation: {
          isClosed: false,
          isCounterClockwise: false,
          hasValidArea: false,
          areaSquareMeters: 0,
          hasSelfIntersections: false,
          vertexCount: 0,
        },
        failureReason: 'Failed to parse legal description',
      },
      polygon: null,
      failureReason: `Parse failed: ${parseResult.diagnostics.warnings.join('; ')}`,
    };
  }

  // Step 2: Create street network query
  const query = new SimpleStreetNetworkQuery(streetSegments);

  // Step 3: Match segments to street network
  const matchResult = matchWardDescription(description, query, matcherConfig);

  if (!matchResult.success) {
    const failedSegs = matchResult.failedSegments.map((i) => description.segments[i]?.featureName).join(', ');
    return {
      success: false,
      description,
      parseResult,
      buildResult: {
        success: false,
        polygon: null,
        repairs: [],
        validation: {
          isClosed: false,
          isCounterClockwise: false,
          hasValidArea: false,
          areaSquareMeters: 0,
          hasSelfIntersections: false,
          vertexCount: 0,
        },
        failureReason: `Failed to match streets: ${failedSegs}`,
      },
      polygon: null,
      failureReason: `Match failed for segments: ${failedSegs}`,
    };
  }

  // Step 4: Build polygon
  const buildResult = buildWardPolygon(matchResult, builderConfig);

  return {
    success: buildResult.success,
    description,
    parseResult,
    buildResult,
    polygon: buildResult.polygon,
    failureReason: buildResult.failureReason,
  };
}

/**
 * Reconstruct a single ward from pre-parsed legal description
 *
 * OPTIMIZED PATH: Accepts WardLegalDescription directly (already has parsed segments),
 * skipping the wasteful parse step. Use this when you already have parsed segments
 * (e.g., from golden vectors).
 *
 * @param description - Pre-parsed ward legal description with segments
 * @param streetSegments - Street network for matching
 * @param matcherConfig - Optional matcher configuration
 * @param builderConfig - Optional polygon builder configuration
 * @returns Reconstruction result (without parse result)
 */
export function reconstructWardFromParsed(
  description: WardLegalDescription,
  streetSegments: readonly StreetSegment[],
  matcherConfig?: MatcherConfig,
  builderConfig?: PolygonBuilderConfig
): WardReconstructionOutputFromParsed {
  // Validate segments exist
  if (description.segments.length === 0) {
    return Object.freeze({
      success: false,
      description,
      buildResult: Object.freeze({
        success: false,
        polygon: null,
        repairs: Object.freeze([]),
        validation: Object.freeze({
          isClosed: false,
          isCounterClockwise: false,
          hasValidArea: false,
          areaSquareMeters: 0,
          hasSelfIntersections: false,
          vertexCount: 0,
        }),
        failureReason: 'No segments in legal description',
      }),
      polygon: null,
      failureReason: 'No segments in legal description',
    });
  }

  // Step 1: Create street network query
  const query = new SimpleStreetNetworkQuery(streetSegments);

  // Step 2: Match segments to street network (skip parse!)
  const matchResult = matchWardDescription(description, query, matcherConfig);

  if (!matchResult.success) {
    const failedSegs = matchResult.failedSegments.map((i) => description.segments[i]?.featureName).join(', ');
    return Object.freeze({
      success: false,
      description,
      buildResult: Object.freeze({
        success: false,
        polygon: null,
        repairs: Object.freeze([]),
        validation: Object.freeze({
          isClosed: false,
          isCounterClockwise: false,
          hasValidArea: false,
          areaSquareMeters: 0,
          hasSelfIntersections: false,
          vertexCount: 0,
        }),
        failureReason: `Failed to match streets: ${failedSegs}`,
      }),
      polygon: null,
      failureReason: `Match failed for segments: ${failedSegs}`,
    });
  }

  // Step 3: Build polygon
  const buildResult = buildWardPolygon(matchResult, builderConfig);

  return Object.freeze({
    success: buildResult.success,
    description,
    buildResult,
    polygon: buildResult.polygon,
    failureReason: buildResult.failureReason,
  });
}

/**
 * Reconstruct all wards for a city
 */
export function reconstructCity(
  wards: readonly WardReconstructionInput[],
  streetSegments: readonly StreetSegment[],
  matcherConfig?: MatcherConfig,
  builderConfig?: PolygonBuilderConfig
): {
  readonly results: readonly WardReconstructionOutput[];
  readonly successCount: number;
  readonly failureCount: number;
  readonly polygons: readonly Feature<Polygon>[];
} {
  const results = wards.map((ward) =>
    reconstructWard(ward, streetSegments, matcherConfig, builderConfig)
  );

  const successCount = results.filter((r) => r.success).length;
  const failureCount = results.length - successCount;
  const polygons = results
    .filter((r) => r.success && r.polygon)
    .map((r) => r.polygon as Feature<Polygon>);

  return {
    results: Object.freeze(results),
    successCount,
    failureCount,
    polygons: Object.freeze(polygons),
  };
}

/**
 * Reconstruct all wards for a city from pre-parsed legal descriptions
 *
 * OPTIMIZED PATH: Use this when you have golden vectors or other pre-parsed
 * ward descriptions. Eliminates wasteful text re-assembly and re-parsing.
 *
 * @param descriptions - Pre-parsed ward legal descriptions
 * @param streetSegments - Street network for matching
 * @param matcherConfig - Optional matcher configuration
 * @param builderConfig - Optional polygon builder configuration
 * @returns City reconstruction result
 */
export function reconstructCityFromParsed(
  descriptions: readonly WardLegalDescription[],
  streetSegments: readonly StreetSegment[],
  matcherConfig?: MatcherConfig,
  builderConfig?: PolygonBuilderConfig
): {
  readonly results: readonly WardReconstructionOutputFromParsed[];
  readonly successCount: number;
  readonly failureCount: number;
  readonly polygons: readonly Feature<Polygon>[];
} {
  const results = descriptions.map((desc) =>
    reconstructWardFromParsed(desc, streetSegments, matcherConfig, builderConfig)
  );

  const successCount = results.filter((r) => r.success).length;
  const failureCount = results.length - successCount;
  const polygons = results
    .filter((r) => r.success && r.polygon)
    .map((r) => r.polygon as Feature<Polygon>);

  return Object.freeze({
    results: Object.freeze(results),
    successCount,
    failureCount,
    polygons: Object.freeze(polygons),
  });
}

/**
 * Reconstruct and validate against golden vector
 */
export function reconstructAndValidate(
  wards: readonly WardReconstructionInput[],
  streetSegments: readonly StreetSegment[],
  goldenVector: GoldenVector,
  matcherConfig?: MatcherConfig,
  builderConfig?: PolygonBuilderConfig
): {
  readonly reconstruction: ReturnType<typeof reconstructCity>;
  readonly validation: GoldenVectorValidationResult;
} {
  const reconstruction = reconstructCity(wards, streetSegments, matcherConfig, builderConfig);
  const validation = validateCityAgainstGolden(reconstruction.polygons, goldenVector);

  return {
    reconstruction,
    validation,
  };
}
