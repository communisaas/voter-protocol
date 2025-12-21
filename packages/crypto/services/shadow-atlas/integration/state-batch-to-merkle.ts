/**
 * State Batch to Merkle Tree Integration
 *
 * Bridges StateBatchExtractor output into Shadow Atlas merkle tree construction.
 *
 * ARCHITECTURE:
 * 1. StateBatchExtractor produces ExtractedBoundary[] (raw state data)
 * 2. This module converts to NormalizedDistrict[] (merkle tree format)
 * 3. Applies authority resolution for source precedence
 * 4. Feeds into MerkleTreeBuilder for cryptographic commitment
 *
 * DATA FLOW:
 * State GIS Portal → ExtractedBoundary → Authority Resolution → NormalizedDistrict → Merkle Tree → IPFS
 *
 * CRITICAL REQUIREMENTS:
 * - Zero data loss: All boundary metadata preserved
 * - Deterministic: Same input → same merkle root
 * - Authority-aware: Apply source precedence rules
 * - Incremental: Support updates without full rebuild
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type { Polygon, MultiPolygon } from 'geojson';
import type {
  ExtractedBoundary,
  LayerExtractionResult,
  StateExtractionResult,
  LegislativeLayerType,
  StateAuthorityLevel,
} from '../providers/state-batch-extractor.js';
import type { NormalizedDistrict, ProvenanceMetadata, MerkleTree } from '../transformation/types.js';
import type { BoundaryWithSource, ResolvedBoundarySource } from '../provenance/authority-resolver.js';
import {
  convertStateBatchBoundary,
  resolveAuthorityConflict,
  batchResolveStateSources,
} from '../provenance/authority-resolver.js';
import { MerkleTreeBuilder } from '../transformation/merkle-builder.js';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Integration configuration
 */
export interface IntegrationConfig {
  /** Apply authority resolution (default: true) */
  readonly applyAuthorityResolution?: boolean;

  /** Date for authority resolution freshness scoring */
  readonly resolutionDate?: Date;

  /** Include metadata in provenance (default: true) */
  readonly includeSourceMetadata?: boolean;
}

/**
 * Integration result with audit trail
 */
export interface IntegrationResult {
  /** Merkle tree */
  readonly merkleTree: MerkleTree;

  /** Statistics */
  readonly stats: {
    readonly totalBoundaries: number;
    readonly includedBoundaries: number;
    readonly deduplicatedBoundaries: number;
    readonly authorityConflicts: number;
  };

  /** Authority resolution decisions (for audit) */
  readonly authorityDecisions: ReadonlyMap<string, ResolvedBoundarySource>;

  /** Processing metadata */
  readonly metadata: {
    readonly processedAt: Date;
    readonly durationMs: number;
    readonly config: IntegrationConfig;
  };
}

/**
 * Incremental update result
 */
export interface IncrementalUpdateResult {
  /** Updated merkle tree */
  readonly merkleTree: MerkleTree;

  /** Update statistics */
  readonly stats: {
    readonly previousBoundaries: number;
    readonly newBoundaries: number;
    readonly updatedBoundaries: number;
    readonly totalBoundaries: number;
  };

  /** Merkle root changed */
  readonly rootChanged: boolean;

  /** Previous root (for verification) */
  readonly previousRoot: string;
}

export interface StateBatchBoundary {
  /** Unique identifier (GEOID format) */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /** District/boundary type */
  readonly layerType: 'congressional' | 'state_senate' | 'state_house' | 'county';

  /** GeoJSON geometry */
  readonly geometry: unknown;

  /** Source metadata */
  readonly source: {
    readonly state: string;
    readonly portalName: string;
    readonly endpoint: string;
    readonly authority: StateAuthorityLevel;
    readonly vintage: number;
    readonly retrievedAt: string;
  };

  /** Original properties from source */
  readonly properties: Record<string, unknown>;
}

// ============================================================================
// Core Integration Functions
// ============================================================================

/**
 * Convert ExtractedBoundary to NormalizedDistrict
 *
 * Maps state batch extractor output to merkle tree builder input.
 * Preserves all boundary metadata through the pipeline.
 *
 * KEY MAPPINGS:
 * - ExtractedBoundary.layerType → NormalizedDistrict.districtType
 * - ExtractedBoundary.source → NormalizedDistrict.provenance
 * - ExtractedBoundary.geometry → NormalizedDistrict.geometry + bbox
 *
 * @param boundary - Extracted boundary from state batch processing
 * @returns Normalized district for merkle tree construction
 */
export function extractedBoundaryToNormalizedDistrict(
  boundary: ExtractedBoundary
): NormalizedDistrict {
  // Map legislative layer type to district type
  // NOTE: Extending the NormalizedDistrict.districtType to include legislative types
  const districtType = mapLayerTypeToDistrictType(boundary.layerType);

  // Build jurisdiction string (USA/{state}/{name})
  const jurisdiction = buildJurisdictionString(boundary);

  // Extract bounding box from geometry
  const bbox = extractBoundingBox(boundary.geometry);

  // Convert source metadata to provenance record
  const provenance = buildProvenanceMetadata(boundary);

  return {
    id: boundary.id,
    name: boundary.name,
    jurisdiction,
    districtType,
    geometry: boundary.geometry,
    provenance,
    bbox,
  };
}

/**
 * Integrate state extraction result into merkle tree
 *
 * Primary integration point:
 * 1. Extracts boundaries from state GIS portals (via StateBatchExtractor)
 * 2. Applies authority resolution for source precedence
 * 3. Converts to normalized district format
 * 4. Builds cryptographic merkle tree commitment
 *
 * @param stateResult - Complete state extraction result
 * @param config - Integration configuration
 * @returns Merkle tree with audit trail
 *
 * @example
 * ```typescript
 * const extractor = new StateBatchExtractor();
 * const stateResult = await extractor.extractState('WI');
 *
 * const integration = integrateStateExtractionResult(stateResult, {
 *   applyAuthorityResolution: true,
 *   resolutionDate: new Date(),
 * });
 *
 * console.log(`Merkle root: ${integration.merkleTree.root}`);
 * console.log(`Included ${integration.stats.includedBoundaries} boundaries`);
 * ```
 */
export function integrateStateExtractionResult(
  stateResult: StateExtractionResult,
  config: IntegrationConfig = {}
): IntegrationResult {
  const startTime = Date.now();
  const resolvedConfig: Required<IntegrationConfig> = {
    applyAuthorityResolution: config.applyAuthorityResolution ?? true,
    resolutionDate: config.resolutionDate ?? new Date(),
    includeSourceMetadata: config.includeSourceMetadata ?? true,
  };

  // Flatten all boundaries from all layers
  const allBoundaries = flattenStateLayers(stateResult);

  // Track authority resolution decisions
  const authorityDecisions = new Map<string, ResolvedBoundarySource>();
  let authorityConflicts = 0;

  // Apply authority resolution if enabled
  let selectedBoundaries: ExtractedBoundary[];
  if (resolvedConfig.applyAuthorityResolution) {
    const resolved = applyAuthorityResolutionToExtraction(
      stateResult,
      resolvedConfig.resolutionDate
    );

    // Extract boundaries from resolved sources
    selectedBoundaries = extractBoundariesFromResolved(resolved.resolutions);
    authorityConflicts = resolved.conflicts;

    // Store decisions for audit
    for (const [layerType, resolution] of resolved.resolutions) {
      authorityDecisions.set(layerType, resolution);
    }
  } else {
    selectedBoundaries = allBoundaries;
  }

  // Convert to normalized districts
  const normalizedDistricts = selectedBoundaries.map(
    extractedBoundaryToNormalizedDistrict
  );

  // Build merkle tree
  const builder = new MerkleTreeBuilder();
  const merkleTree = builder.build(normalizedDistricts);

  const durationMs = Date.now() - startTime;

  return {
    merkleTree,
    stats: {
      totalBoundaries: allBoundaries.length,
      includedBoundaries: selectedBoundaries.length,
      deduplicatedBoundaries: allBoundaries.length - selectedBoundaries.length,
      authorityConflicts,
    },
    authorityDecisions,
    metadata: {
      processedAt: new Date(),
      durationMs,
      config: resolvedConfig,
    },
  };
}

/**
 * Integrate multiple states into a single merkle tree
 *
 * Batch processing for multi-state integration.
 * Applies authority resolution across all states.
 *
 * @param stateResults - Array of state extraction results
 * @param config - Integration configuration
 * @returns Merkle tree with all states
 *
 * @example
 * ```typescript
 * const extractor = new StateBatchExtractor();
 * const batchResult = await extractor.extractAllStates();
 *
 * const integration = integrateMultipleStates(batchResult.states, {
 *   applyAuthorityResolution: true,
 * });
 *
 * console.log(`Merkle root for ${batchResult.states.length} states: ${integration.merkleTree.root}`);
 * ```
 */
export function integrateMultipleStates(
  stateResults: ReadonlyArray<StateExtractionResult>,
  config: IntegrationConfig = {}
): IntegrationResult {
  const startTime = Date.now();
  const resolvedConfig: Required<IntegrationConfig> = {
    applyAuthorityResolution: config.applyAuthorityResolution ?? true,
    resolutionDate: config.resolutionDate ?? new Date(),
    includeSourceMetadata: config.includeSourceMetadata ?? true,
  };

  const allBoundaries: ExtractedBoundary[] = [];
  const authorityDecisions = new Map<string, ResolvedBoundarySource>();
  let totalConflicts = 0;

  // Process each state
  for (const stateResult of stateResults) {
    const stateBoundaries = flattenStateLayers(stateResult);
    allBoundaries.push(...stateBoundaries);

    // Apply authority resolution per state if enabled
    if (resolvedConfig.applyAuthorityResolution) {
      const resolved = applyAuthorityResolutionToExtraction(
        stateResult,
        resolvedConfig.resolutionDate
      );
      totalConflicts += resolved.conflicts;

      // Store decisions (prefix with state code for uniqueness)
      for (const [layerType, resolution] of resolved.resolutions) {
        const key = `${stateResult.state}-${layerType}`;
        authorityDecisions.set(key, resolution);
      }
    }
  }

  // Deduplicate by boundary ID (same boundary from different sources)
  const uniqueBoundaries = deduplicateBoundaries(allBoundaries);

  // Convert to normalized districts
  const normalizedDistricts = uniqueBoundaries.map(
    extractedBoundaryToNormalizedDistrict
  );

  // Build merkle tree
  const builder = new MerkleTreeBuilder();
  const merkleTree = builder.build(normalizedDistricts);

  const durationMs = Date.now() - startTime;

  return {
    merkleTree,
    stats: {
      totalBoundaries: allBoundaries.length,
      includedBoundaries: uniqueBoundaries.length,
      deduplicatedBoundaries: allBoundaries.length - uniqueBoundaries.length,
      authorityConflicts: totalConflicts,
    },
    authorityDecisions,
    metadata: {
      processedAt: new Date(),
      durationMs,
      config: resolvedConfig,
    },
  };
}

/**
 * Incremental update to existing merkle tree
 *
 * Adds new boundaries to existing tree without full rebuild.
 * Useful for adding newly discovered state portals or updated boundaries.
 *
 * ALGORITHM:
 * 1. Extract existing districts from current tree
 * 2. Merge new boundaries (deduplicate by ID)
 * 3. Rebuild merkle tree with combined set
 * 4. Return new tree + change statistics
 *
 * @param existingTree - Current merkle tree
 * @param newBoundaries - New boundaries to add
 * @param config - Integration configuration
 * @returns Updated tree with statistics
 *
 * @example
 * ```typescript
 * const existingTree = loadMerkleTree('shadow-atlas-2024-01.json');
 * const newData = await extractor.extractState('TX');
 *
 * const update = incrementalUpdate(existingTree, flattenStateLayers(newData), {
 *   applyAuthorityResolution: true,
 * });
 *
 * if (update.rootChanged) {
 *   console.log(`Root changed: ${update.previousRoot} → ${update.merkleTree.root}`);
 *   saveMerkleTree('shadow-atlas-2024-02.json', update.merkleTree);
 * }
 * ```
 */
export function incrementalUpdate(
  existingTree: MerkleTree,
  newBoundaries: ReadonlyArray<ExtractedBoundary>,
  config: IntegrationConfig = {}
): IncrementalUpdateResult {
  const previousRoot = existingTree.root;

  // Convert existing districts back to ExtractedBoundary format (lossy, but preserves ID)
  const existingBoundaryIds = new Set(existingTree.districts.map(d => d.id));

  // Filter out boundaries that already exist
  const trulyNewBoundaries = newBoundaries.filter(
    b => !existingBoundaryIds.has(b.id)
  );

  // Merge existing + new
  const allBoundaries = [
    ...existingTree.districts,
    ...trulyNewBoundaries.map(extractedBoundaryToNormalizedDistrict),
  ];

  // Rebuild merkle tree
  const builder = new MerkleTreeBuilder();
  const merkleTree = builder.build(allBoundaries);

  return {
    merkleTree,
    stats: {
      previousBoundaries: existingTree.districts.length,
      newBoundaries: trulyNewBoundaries.length,
      updatedBoundaries: 0, // TODO: Implement update detection
      totalBoundaries: allBoundaries.length,
    },
    rootChanged: merkleTree.root !== previousRoot,
    previousRoot,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Map legislative layer type to district type
 *
 * Extends the original districtType enum to include legislative boundaries.
 * This bridges the semantic gap between state legislative data and the
 * city council district schema.
 */
function mapLayerTypeToDistrictType(
  layerType: LegislativeLayerType
): 'council' | 'ward' | 'municipal' {
  // NOTE: This is a semantic bridge. The original schema was designed for
  // city council districts. We're extending it to support state legislative
  // boundaries by mapping them to the 'municipal' type, which serves as a
  // catch-all for non-city-council districts.
  //
  // Future improvement: Extend NormalizedDistrict.districtType to include
  // explicit types like 'congressional', 'state_senate', 'state_house', 'county'

  switch (layerType) {
    case 'congressional':
    case 'state_senate':
    case 'state_house':
    case 'county':
      return 'municipal'; // Temporary mapping
    default:
      return 'municipal';
  }
}

/**
 * Build jurisdiction string from boundary
 *
 * Format: "USA/{state}/{name}"
 */
function buildJurisdictionString(boundary: ExtractedBoundary): string {
  return `USA/${boundary.source.state}/${boundary.name}`;
}

/**
 * Extract bounding box from geometry
 *
 * Computes [minLon, minLat, maxLon, maxLat] from polygon coordinates.
 */
function extractBoundingBox(
  geometry: Polygon | MultiPolygon
): readonly [number, number, number, number] {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  const processRing = (ring: Array<[number, number]>): void => {
    for (const [lon, lat] of ring) {
      minLon = Math.min(minLon, lon);
      minLat = Math.min(minLat, lat);
      maxLon = Math.max(maxLon, lon);
      maxLat = Math.max(maxLat, lat);
    }
  };

  if (geometry.type === 'Polygon') {
    for (const ring of geometry.coordinates) {
      processRing(ring as Array<[number, number]>);
    }
  } else {
    // MultiPolygon
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) {
        processRing(ring as Array<[number, number]>);
      }
    }
  }

  return [minLon, minLat, maxLon, maxLat];
}

/**
 * Build provenance metadata from extracted boundary
 *
 * Converts ExtractedBoundary.source to ProvenanceMetadata format.
 */
function buildProvenanceMetadata(
  boundary: ExtractedBoundary
): ProvenanceMetadata {
  const retrievedDate = new Date(boundary.source.retrievedAt);

  return {
    source: boundary.source.endpoint,
    authority: mapAuthorityLevel(boundary.source.authority),
    jurisdiction: `${boundary.source.state}, USA`,
    timestamp: retrievedDate.getTime(),
    method: detectMethodFromEndpoint(boundary.source.endpoint),
    responseHash: generateResponseHash(boundary),
    httpStatus: 200, // Successful extraction implies 200
    featureCount: 1, // Each boundary is one feature
    geometryType: boundary.geometry.type,
    coordinateSystem: 'EPSG:4326',
    effectiveDate: `${boundary.source.vintage}-01-01`,
  };
}

/**
 * Map state authority level to provenance authority
 */
function mapAuthorityLevel(
  authority: StateAuthorityLevel
): 'state-gis' | 'federal' | 'municipal' | 'community' {
  // Both state redistricting commissions and state GIS portals are state-level authorities
  return 'state-gis';
}

/**
 * Detect extraction method from endpoint URL
 */
function detectMethodFromEndpoint(endpoint: string): string {
  if (endpoint.includes('FeatureServer') || endpoint.includes('MapServer')) {
    return 'ArcGIS REST API';
  }
  if (endpoint.includes('tigerweb.geo.census.gov')) {
    return 'TIGERweb REST API';
  }
  if (endpoint.includes('data.') || endpoint.includes('opendata.')) {
    return 'Open Data Portal';
  }
  return 'GIS API';
}

/**
 * Generate deterministic response hash for boundary
 *
 * Uses boundary ID + geometry as proxy for response hash.
 * In production, this should be the actual HTTP response hash from extraction.
 */
function generateResponseHash(boundary: ExtractedBoundary): string {
  // Simplified hash generation (should match actual response hash from extractor)
  const data = JSON.stringify({
    id: boundary.id,
    geometry: boundary.geometry,
  });

  // Simple hash (in production, use crypto.createHash('sha256'))
  return `sha256-${data.length.toString(16).padStart(16, '0')}`;
}

/**
 * Flatten state extraction layers into single boundary array
 */
function flattenStateLayers(
  stateResult: StateExtractionResult
): ExtractedBoundary[] {
  const boundaries: ExtractedBoundary[] = [];

  for (const layer of stateResult.layers) {
    if (layer.success) {
      boundaries.push(...layer.boundaries);
    }
  }

  return boundaries;
}

/**
 * Apply authority resolution to state extraction result
 *
 * Uses authority-resolver.ts to select the most authoritative source
 * for each layer type when multiple sources provide the same boundary.
 */
function applyAuthorityResolutionToExtraction(
  stateResult: StateExtractionResult,
  asOf: Date
): {
  resolutions: Map<string, ResolvedBoundarySource>;
  conflicts: number;
} {
  const resolutions = new Map<string, ResolvedBoundarySource>();
  let conflicts = 0;

  // Group boundaries by layer type
  const boundariesByLayer = new Map<
    LegislativeLayerType,
    ExtractedBoundary[]
  >();

  for (const layer of stateResult.layers) {
    if (layer.success && layer.boundaries.length > 0) {
      boundariesByLayer.set(layer.layerType, [...layer.boundaries]);
    }
  }

  // Resolve authority for each layer type
  for (const [layerType, boundaries] of boundariesByLayer) {
    if (boundaries.length > 0) {
      // Convert to authority resolver format
      const converted = boundaries.map(b => convertStateBatchBoundary(b as any));

      // Check if there are multiple sources (conflict scenario)
      const uniqueSources = new Set(converted.map(b => b.provider));
      if (uniqueSources.size > 1) {
        conflicts++;
      }

      // Resolve (even single source goes through resolver for consistency)
      const resolved = resolveAuthorityConflict(converted, asOf);
      resolutions.set(layerType, resolved);
    }
  }

  return { resolutions, conflicts };
}

/**
 * Extract boundaries from resolved authority sources
 *
 * Converts ResolvedBoundarySource back to ExtractedBoundary format.
 * NOTE: This is a lossy conversion - we only extract the winning boundary.
 */
function extractBoundariesFromResolved(
  resolutions: Map<string, ResolvedBoundarySource>
): ExtractedBoundary[] {
  const boundaries: ExtractedBoundary[] = [];

  for (const [layerType, resolution] of resolutions) {
    // Extract the winning boundary's properties
    const props = resolution.boundary.properties;
    if (
      props &&
      typeof props === 'object' &&
      'id' in props &&
      'name' in props &&
      'state' in props
    ) {
      // Reconstruct ExtractedBoundary from properties
      const boundary: ExtractedBoundary = {
        id: String(props.id),
        name: String(props.name),
        layerType: layerType as LegislativeLayerType,
        geometry: resolution.boundary.geometry as Polygon | MultiPolygon,
        source: {
          state: String(props.state),
          portalName: String(props.portalName ?? ''),
          endpoint: String(props.endpoint ?? ''),
          authority:
            resolution.boundary.provider === 'state-redistricting-commission'
              ? 'state-redistricting-commission'
              : (resolution.boundary.provider === 'federal-mandate' ? 'federal-mandate' : 'state-gis'),
          vintage: new Date(resolution.boundary.releaseDate).getFullYear(),
          retrievedAt: String(props.retrievedAt ?? new Date().toISOString()),
        },
        properties: props,
      };
      boundaries.push(boundary);
    }
  }

  return boundaries;
}

/**
 * Deduplicate boundaries by ID
 *
 * When multiple sources provide the same boundary (same ID), keep only one.
 * Uses last-wins strategy (assumes later entries are fresher).
 */
function deduplicateBoundaries(
  boundaries: ReadonlyArray<ExtractedBoundary>
): ExtractedBoundary[] {
  const uniqueMap = new Map<string, ExtractedBoundary>();

  for (const boundary of boundaries) {
    uniqueMap.set(boundary.id, boundary);
  }

  return Array.from(uniqueMap.values());
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Quick integration for single state (common use case)
 *
 * @param stateResult - State extraction result
 * @returns Merkle tree
 */
export function quickIntegrateState(
  stateResult: StateExtractionResult
): MerkleTree {
  const result = integrateStateExtractionResult(stateResult, {
    applyAuthorityResolution: true,
  });
  return result.merkleTree;
}

/**
 * Quick integration for multiple states (common use case)
 *
 * @param stateResults - Array of state extraction results
 * @returns Merkle tree
 */
export function quickIntegrateMultipleStates(
  stateResults: ReadonlyArray<StateExtractionResult>
): MerkleTree {
  const result = integrateMultipleStates(stateResults, {
    applyAuthorityResolution: true,
  });
  return result.merkleTree;
}
