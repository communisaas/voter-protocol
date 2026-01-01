/**
 * Test for authority resolution fix - DEPRECATION TEST
 *
 * The original integrateStateExtractionResult function has been REMOVED
 * because it used SHA256 hashing which is NOT compatible with ZK circuits.
 *
 * This test verifies that attempting to use the deprecated function throws
 * an informative error directing users to the correct migration path.
 *
 * MIGRATION:
 * - Old: integrateStateExtractionResult() from state-batch-to-merkle.ts
 * - New: ShadowAtlasService.buildAtlas() which uses MultiLayerMerkleTreeBuilder
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import { describe, it, expect } from 'vitest';
import type { StateExtractionResult } from '../../../providers/state-batch-extractor.js';
import { integrateStateExtractionResult } from '../../../integration/state-batch-to-merkle.js';

describe('Authority Resolution Fix - DEPRECATED', () => {
  it('should throw deprecation error directing users to buildAtlas()', () => {
    // Mock Wisconsin extraction result
    const wiResult: StateExtractionResult = {
      state: 'WI',
      stateName: 'Wisconsin',
      authority: undefined,
      layers: [
        {
          state: 'WI',
          layerType: 'congressional',
          success: true,
          featureCount: 8,
          expectedCount: 8,
          boundaries: [],
          metadata: {
            endpoint: 'https://data-ltsb.opendata.arcgis.com/congressional',
            extractedAt: new Date('2024-12-01').toISOString(),
            durationMs: 1000,
          },
        },
      ],
      summary: {
        totalBoundaries: 8,
        layersSucceeded: 1,
        layersFailed: 0,
        durationMs: 1000,
      },
    };

    // The deprecated function should throw with migration guidance
    expect(() => integrateStateExtractionResult(wiResult)).toThrow(
      /DEPRECATED/i
    );

    expect(() => integrateStateExtractionResult(wiResult)).toThrow(
      /buildAtlas/i
    );

    expect(() => integrateStateExtractionResult(wiResult)).toThrow(
      /MultiLayerMerkleTreeBuilder/i
    );
  });

  it('should mention SHA256 incompatibility with ZK circuits', () => {
    const wiResult: StateExtractionResult = {
      state: 'WI',
      stateName: 'Wisconsin',
      authority: undefined,
      layers: [],
      summary: {
        totalBoundaries: 0,
        layersSucceeded: 0,
        layersFailed: 0,
        durationMs: 0,
      },
    };

    expect(() => integrateStateExtractionResult(wiResult)).toThrow(/SHA256/i);
    expect(() => integrateStateExtractionResult(wiResult)).toThrow(
      /ZK-compatible/i
    );
  });
});
