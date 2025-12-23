/**
 * Test Fixture Factories
 *
 * SCOPE: Reusable factories for creating test data
 *
 * PHILOSOPHY: Type-safe, composable builders for deterministic test data.
 * Each factory creates minimal valid objects with sensible defaults.
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type { Polygon, MultiPolygon, Feature, FeatureCollection } from 'geojson';
import type {
  ExtractedBoundary,
  LayerExtractionResult,
  StateExtractionResult,
  BatchExtractionResult,
  LegislativeLayerType,
} from '../../providers/state-batch-extractor.js';
import type { LayerType } from '../../core/types.js';

// ============================================================================
// Geometry Fixtures
// ============================================================================

/**
 * Create a simple square polygon
 */
export function createSquarePolygon(
  minLon: number,
  minLat: number,
  size: number
): Polygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [minLon, minLat],
        [minLon + size, minLat],
        [minLon + size, minLat + size],
        [minLon, minLat + size],
        [minLon, minLat],
      ],
    ],
  };
}

/**
 * Create a MultiPolygon with multiple parts
 */
export function createMultiPolygon(parts: readonly Polygon[]): MultiPolygon {
  return {
    type: 'MultiPolygon',
    coordinates: parts.map((p) => p.coordinates),
  };
}

/**
 * Create a self-intersecting bowtie polygon (for testing invalid geometry)
 */
export function createBowtiePolygon(
  centerLon: number,
  centerLat: number,
  size: number
): Polygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [centerLon - size, centerLat - size],
        [centerLon + size, centerLat + size],
        [centerLon + size, centerLat - size],
        [centerLon - size, centerLat + size],
        [centerLon - size, centerLat - size],
      ],
    ],
  };
}

/**
 * Create a polygon with a hole
 */
export function createPolygonWithHole(
  outerMinLon: number,
  outerMinLat: number,
  outerSize: number,
  holeMinLon: number,
  holeMinLat: number,
  holeSize: number
): Polygon {
  return {
    type: 'Polygon',
    coordinates: [
      // Outer ring
      [
        [outerMinLon, outerMinLat],
        [outerMinLon + outerSize, outerMinLat],
        [outerMinLon + outerSize, outerMinLat + outerSize],
        [outerMinLon, outerMinLat + outerSize],
        [outerMinLon, outerMinLat],
      ],
      // Inner ring (hole)
      [
        [holeMinLon, holeMinLat],
        [holeMinLon + holeSize, holeMinLat],
        [holeMinLon + holeSize, holeMinLat + holeSize],
        [holeMinLon, holeMinLat + holeSize],
        [holeMinLon, holeMinLat],
      ],
    ],
  };
}

// ============================================================================
// Boundary Fixtures
// ============================================================================

export interface CreateBoundaryOptions {
  readonly id: string;
  readonly name: string;
  readonly state: string;
  readonly layerType?: LayerType;
  readonly geometry?: Polygon | MultiPolygon;
  readonly geoid?: string;
  readonly vintage?: number;
  readonly authority?: 'state-gis' | 'tiger' | 'arcgis-hub';
}

/**
 * Create a mock extracted boundary
 */
export function createBoundary(options: CreateBoundaryOptions): ExtractedBoundary {
  const {
    id,
    name,
    state,
    layerType = 'congressional',
    geometry = createSquarePolygon(-90, 45, 1),
    geoid = id,
    vintage = 2024,
    authority = 'state-gis',
  } = options;

  return {
    id,
    name,
    layerType: layerType as LegislativeLayerType,
    geometry,
    source: {
      state,
      portalName: 'Test Portal',
      endpoint: 'https://example.com/api',
      authority,
      vintage,
      retrievedAt: new Date().toISOString(),
    },
    properties: {
      GEOID: geoid,
      NAME: name,
    },
  };
}

/**
 * Create multiple boundaries for a state
 */
export function createBoundaries(
  state: string,
  count: number,
  layerType: LayerType = 'congressional'
): readonly ExtractedBoundary[] {
  // State FIPS mapping
  const fipsMap: Record<string, string> = {
    WI: '55',
    TX: '48',
    CT: '09',
    CA: '06',
    IL: '17',
    NH: '33',
    NY: '36',
  };

  const fips = fipsMap[state] ?? '99';

  return Array.from({ length: count }, (_, i) => {
    const districtNum = (i + 1).toString().padStart(2, '0');
    const geoid = `${fips}${districtNum}`;

    return createBoundary({
      id: geoid,
      name: `District ${i + 1}`,
      state,
      layerType,
      geoid,
      geometry: createSquarePolygon(-90 + i, 45, 0.5),
    });
  });
}

// ============================================================================
// Extraction Result Fixtures
// ============================================================================

export interface CreateLayerResultOptions {
  readonly state: string;
  readonly layerType?: LayerType;
  readonly expectedCount: number;
  readonly actualCount?: number;
  readonly success?: boolean;
}

/**
 * Create a mock layer extraction result
 */
export function createLayerResult(
  options: CreateLayerResultOptions
): LayerExtractionResult {
  const {
    state,
    layerType = 'congressional',
    expectedCount,
    actualCount = expectedCount,
    success = true,
  } = options;

  const boundaries = createBoundaries(state, actualCount, layerType);

  return {
    state,
    layerType: layerType as LegislativeLayerType,
    success,
    featureCount: actualCount,
    expectedCount,
    boundaries: [...boundaries],
    metadata: {
      endpoint: 'https://example.com/api',
      extractedAt: new Date().toISOString(),
      durationMs: 1000,
    },
  };
}

export interface CreateStateResultOptions {
  readonly state: string;
  readonly stateName?: string;
  readonly authority?: 'state-gis' | 'tiger' | 'arcgis-hub';
  readonly layers: readonly LayerExtractionResult[];
}

/**
 * Create a mock state extraction result
 */
export function createStateResult(
  options: CreateStateResultOptions
): StateExtractionResult {
  const { state, stateName = 'Test State', authority = 'state-gis', layers } = options;

  return {
    state,
    stateName,
    authority,
    layers: [...layers],
    summary: {
      totalBoundaries: layers.reduce((sum, l) => sum + l.featureCount, 0),
      layersSucceeded: layers.filter((l) => l.success).length,
      layersFailed: layers.filter((l) => !l.success).length,
      durationMs: 3000,
    },
  };
}

export interface CreateBatchResultOptions {
  readonly states: readonly StateExtractionResult[];
}

/**
 * Create a mock batch extraction result
 */
export function createBatchResult(
  options: CreateBatchResultOptions
): BatchExtractionResult {
  const { states } = options;

  return {
    states: [...states],
    summary: {
      totalStates: states.length,
      statesSucceeded: states.filter((s) => s.summary.layersFailed === 0).length,
      statesFailed: states.filter((s) => s.summary.layersFailed > 0).length,
      totalBoundaries: states.reduce((sum, s) => sum + s.summary.totalBoundaries, 0),
      durationMs: 10000,
    },
  };
}

// ============================================================================
// GeoJSON Fixtures
// ============================================================================

export interface CreateFeatureOptions {
  readonly id: string | number;
  readonly geoid: string;
  readonly name: string;
  readonly stateFips: string;
  readonly geometry?: Polygon | MultiPolygon;
}

/**
 * Create a GeoJSON Feature
 */
export function createFeature(options: CreateFeatureOptions): Feature {
  const { id, geoid, name, stateFips, geometry = createSquarePolygon(-90, 45, 1) } =
    options;

  return {
    type: 'Feature',
    id,
    geometry,
    properties: {
      OBJECTID: typeof id === 'number' ? id : 1,
      GEOID: geoid,
      NAME: name,
      STATEFP: stateFips,
      NAMELSAD: name,
    },
  };
}

/**
 * Create a GeoJSON FeatureCollection
 */
export function createFeatureCollection(
  features: readonly Feature[]
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [...features],
  };
}

// ============================================================================
// TIGERweb API Response Fixtures
// ============================================================================

export interface CreateTIGERwebResponseOptions {
  readonly state: string;
  readonly count: number;
  readonly includeZZ?: boolean;
}

/**
 * Create a mock TIGERweb API response
 */
export function createTIGERwebResponse(
  options: CreateTIGERwebResponseOptions
): { features: readonly { attributes: Record<string, string | number> }[] } {
  const { state, count, includeZZ = false } = options;

  // State FIPS mapping
  const fipsMap: Record<string, string> = {
    WI: '55',
    TX: '48',
    CT: '09',
    CA: '06',
    IL: '17',
    NH: '33',
    NY: '36',
  };

  const fips = fipsMap[state] ?? state;

  const features = [];

  // Regular districts
  for (let i = 1; i <= count; i++) {
    features.push({
      attributes: {
        GEOID: `${fips}${i.toString().padStart(2, '0')}`,
        NAME: `District ${i}`,
        STATE: fips,
      },
    });
  }

  // ZZ water district (if requested)
  if (includeZZ) {
    features.push({
      attributes: {
        GEOID: `${fips}ZZ`,
        NAME: 'District ZZ (water)',
        STATE: fips,
      },
    });
  }

  return { features };
}

// ============================================================================
// Validation Result Fixtures
// ============================================================================

export interface CreateValidationIssueOptions {
  readonly type: string;
  readonly severity: 'critical' | 'warning' | 'info';
  readonly description: string;
  readonly boundaryId?: string;
  readonly location?: { readonly lat: number; readonly lon: number };
  readonly suggestedFix?: string;
}

/**
 * Create a validation issue
 */
export function createValidationIssue(options: CreateValidationIssueOptions): {
  readonly type: string;
  readonly severity: 'critical' | 'warning' | 'info';
  readonly description: string;
  readonly boundaryId?: string;
  readonly location?: { readonly lat: number; readonly lon: number };
  readonly suggestedFix?: string;
} {
  return { ...options };
}

// ============================================================================
// State Registry Fixtures
// ============================================================================

export interface CreateStateRegistryEntryOptions {
  readonly state: string;
  readonly stateName: string;
  readonly stateFips: string;
  readonly layers: {
    readonly congressional?: number;
    readonly state_senate?: number;
    readonly state_house?: number;
  };
}

/**
 * Create a state registry entry
 */
export function createStateRegistryEntry(
  options: CreateStateRegistryEntryOptions
): {
  readonly state: string;
  readonly stateName: string;
  readonly stateFips: string;
  readonly layers: {
    readonly congressional?: number;
    readonly state_senate?: number;
    readonly state_house?: number;
  };
} {
  return { ...options };
}

// ============================================================================
// Common Test States
// ============================================================================

/**
 * Wisconsin - 8 congressional districts
 */
export const WISCONSIN_REGISTRY = createStateRegistryEntry({
  state: 'WI',
  stateName: 'Wisconsin',
  stateFips: '55',
  layers: {
    congressional: 8,
    state_senate: 33,
    state_house: 99,
  },
});

/**
 * Texas - 38 congressional districts
 */
export const TEXAS_REGISTRY = createStateRegistryEntry({
  state: 'TX',
  stateName: 'Texas',
  stateFips: '48',
  layers: {
    congressional: 38,
    state_senate: 31,
    state_house: 150,
  },
});

/**
 * Connecticut - 5 congressional districts
 */
export const CONNECTICUT_REGISTRY = createStateRegistryEntry({
  state: 'CT',
  stateName: 'Connecticut',
  stateFips: '09',
  layers: {
    congressional: 5,
    state_senate: 36,
    state_house: 151,
  },
});

/**
 * California - 52 congressional districts
 */
export const CALIFORNIA_REGISTRY = createStateRegistryEntry({
  state: 'CA',
  stateName: 'California',
  stateFips: '06',
  layers: {
    congressional: 52,
    state_senate: 40,
    state_house: 80,
  },
});
