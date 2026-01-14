/**
 * Shadow Atlas Service Test Mocks
 *
 * SCOPE: Type-safe mocks for ShadowAtlasService dependencies
 *
 * PHILOSOPHY: Nuclear-level type safety. Every mock matches production interfaces exactly.
 * No `any` types, no loose casts, no shortcuts.
 *
 * TYPE SAFETY: All mocks are fully typed to match their production counterparts.
 */

import type { Polygon, MultiPolygon } from 'geojson';
import type {
  ExtractedBoundary,
  LayerExtractionResult,
  StateExtractionResult,
  LegislativeLayerType,
} from '../../providers/state-batch-extractor.js';
import type { MerkleBoundaryInput } from '../../core/multi-layer-builder.js';
import type { BoundaryType } from '../../merkle-tree.js';
import { createSquarePolygon, createBoundary } from './fixtures.js';

// ============================================================================
// StateBatchExtractor Mock
// ============================================================================

export interface MockStateBatchExtractor {
  extractState(state: string): Promise<StateExtractionResult>;
  extractLayer(state: string, layer: LegislativeLayerType): Promise<LayerExtractionResult>;
  extractAllStates(): Promise<readonly StateExtractionResult[]>;
  healthCheck(): Promise<{ available: boolean; latencyMs: number }>;
}

/**
 * Create a mock StateBatchExtractor
 */
export function createMockExtractor(
  options: {
    boundaryCount?: number;
    shouldFail?: boolean;
    failureMessage?: string;
  } = {}
): MockStateBatchExtractor {
  const { boundaryCount = 8, shouldFail = false, failureMessage = 'Mock failure' } = options;

  return {
    extractState: async (state: string) => {
      if (shouldFail) {
        throw new Error(failureMessage);
      }

      const layers: LayerExtractionResult[] = [
        {
          state,
          layerType: 'congressional',
          success: true,
          featureCount: boundaryCount,
          expectedCount: boundaryCount,
          boundaries: createMockBoundaries(boundaryCount).map(b => ({
            ...b,
            layerType: 'congressional' as LegislativeLayerType,
            source: {
              state,
              portalName: 'Mock Portal',
              endpoint: 'https://mock.example.com/api',
              authority: 'state-gis' as const,
              vintage: 2024,
              retrievedAt: new Date().toISOString(),
            },
          })),
          metadata: {
            endpoint: 'https://mock.example.com/api',
            extractedAt: new Date().toISOString(),
            durationMs: 100,
          },
        },
      ];

      return {
        state,
        stateName: 'Mock State',
        authority: 'state-gis',
        layers,
        summary: {
          totalBoundaries: boundaryCount,
          layersSucceeded: 1,
          layersFailed: 0,
          durationMs: 100,
        },
      };
    },

    extractLayer: async (state: string, layer: LegislativeLayerType) => {
      if (shouldFail) {
        throw new Error(failureMessage);
      }

      return {
        state,
        layerType: layer,
        success: true,
        featureCount: boundaryCount,
        expectedCount: boundaryCount,
        boundaries: createMockBoundaries(boundaryCount).map(b => ({
          ...b,
          layerType: layer,
          source: {
            state,
            portalName: 'Mock Portal',
            endpoint: 'https://mock.example.com/api',
            authority: 'state-gis' as const,
            vintage: 2024,
            retrievedAt: new Date().toISOString(),
          },
        })),
        metadata: {
          endpoint: 'https://mock.example.com/api',
          extractedAt: new Date().toISOString(),
          durationMs: 100,
        },
      };
    },

    extractAllStates: async () => {
      if (shouldFail) {
        throw new Error(failureMessage);
      }

      return [
        {
          state: 'WI',
          stateName: 'Wisconsin',
          authority: 'state-gis',
          layers: [
            {
              state: 'WI',
              layerType: 'congressional',
              success: true,
              featureCount: boundaryCount,
              expectedCount: boundaryCount,
              boundaries: createMockBoundaries(boundaryCount).map(b => ({
                ...b,
                layerType: 'congressional' as LegislativeLayerType,
                source: {
                  state: 'WI',
                  portalName: 'Mock Portal',
                  endpoint: 'https://mock.example.com/api',
                  authority: 'state-gis' as const,
                  vintage: 2024,
                  retrievedAt: new Date().toISOString(),
                },
              })),
              metadata: {
                endpoint: 'https://mock.example.com/api',
                extractedAt: new Date().toISOString(),
                durationMs: 100,
              },
            },
          ],
          summary: {
            totalBoundaries: boundaryCount,
            layersSucceeded: 1,
            layersFailed: 0,
            durationMs: 100,
          },
        },
      ];
    },

    healthCheck: async () => ({
      available: !shouldFail,
      latencyMs: 10,
    }),
  };
}

// ============================================================================
// DeterministicValidationPipeline Mock
// ============================================================================

export interface MockValidationPipeline {
  validate(boundaries: readonly unknown[]): Promise<{
    valid: boolean;
    confidence: number;
    issues: readonly string[];
    warnings: readonly string[];
  }>;
}

/**
 * Create a mock DeterministicValidationPipeline
 */
export function createMockValidator(
  options: {
    shouldPass?: boolean;
    confidence?: number;
  } = {}
): MockValidationPipeline {
  const { shouldPass = true, confidence = 95 } = options;

  return {
    validate: async () => ({
      valid: shouldPass,
      confidence,
      issues: shouldPass ? [] : ['Mock validation failure'],
      warnings: [],
    }),
  };
}

// ============================================================================
// MultiLayerMerkleTreeBuilder Mock
// ============================================================================

export interface MockMerkleTree {
  readonly root: bigint;
  readonly leaves: readonly {
    readonly hash: bigint;
    readonly boundaryId: string;
    readonly boundaryType: BoundaryType;
  }[];
  readonly tree: readonly (readonly bigint[])[];
  readonly boundaryCount: number;
  readonly layerCounts: Record<BoundaryType, number>;
  readonly depth: number;
}

export interface MockTreeBuilder {
  build(boundaries: readonly MerkleBoundaryInput[]): Promise<MockMerkleTree>;
  exportToJSON(tree: MockMerkleTree, outputPath: string): Promise<void>;
}

/**
 * Create a mock MultiLayerMerkleTreeBuilder
 */
export function createMockTreeBuilder(
  options: {
    mockRoot?: bigint;
  } = {}
): MockTreeBuilder {
  const { mockRoot = 12345678901234567890n } = options;

  return {
    build: async (boundaries: readonly MerkleBoundaryInput[]) => {
      const leaves = boundaries.map((b, i) => ({
        hash: BigInt(i + 1),
        boundaryId: b.id,
        boundaryType: b.boundaryType,
      }));

      const layerCounts: Record<BoundaryType, number> = {} as Record<BoundaryType, number>;
      for (const b of boundaries) {
        layerCounts[b.boundaryType] = (layerCounts[b.boundaryType] || 0) + 1;
      }

      return {
        root: mockRoot,
        leaves,
        tree: [leaves.map(l => l.hash)],
        boundaryCount: boundaries.length,
        layerCounts,
        depth: Math.ceil(Math.log2(boundaries.length || 1)),
      };
    },

    exportToJSON: async () => {
      // No-op for mock
    },
  };
}

// ============================================================================
// Boundary Data Generators
// ============================================================================

/**
 * Create mock NormalizedBoundary array for testing
 */
export function createMockBoundaries(count: number): readonly MerkleBoundaryInput[] {
  return Array.from({ length: count }, (_, i) => {
    const id = `55${(i + 1).toString().padStart(2, '0')}`;
    return {
      id,
      name: `District ${i + 1}`,
      geometry: createSquarePolygon(-90 + i, 43, 0.5),
      boundaryType: 'congressional' as BoundaryType,
      authority: 3, // state-gis authority level
      jurisdiction: 'Wisconsin, USA',
    };
  });
}

/**
 * Create mock MerkleBoundaryInput array for tree building
 */
export function createMockMerkleBoundaryInputs(count: number): readonly MerkleBoundaryInput[] {
  return createMockBoundaries(count);
}

// ============================================================================
// Progress Callback Mock
// ============================================================================

export interface ProgressCallback {
  (progress: {
    stage: string;
    statesFips: readonly string[];
    current: number;
    total: number;
    message: string;
  }): void;
}

/**
 * Create a mock progress callback that captures progress updates
 */
export function createMockProgressCallback(): {
  callback: ProgressCallback;
  getProgress: () => readonly {
    stage: string;
    statesFips: readonly string[];
    current: number;
    total: number;
    message: string;
  }[];
} {
  const progress: {
    stage: string;
    statesFips: readonly string[];
    current: number;
    total: number;
    message: string;
  }[] = [];

  return {
    callback: (update) => {
      progress.push({ ...update });
    },
    getProgress: () => [...progress],
  };
}
