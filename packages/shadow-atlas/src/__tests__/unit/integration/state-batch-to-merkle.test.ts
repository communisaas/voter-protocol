/**
 * State Batch to Merkle Integration Tests - DEPRECATION TESTS
 *
 * These tests verify that the deprecated SHA256-based integration functions
 * correctly throw errors to prevent accidental usage.
 *
 * BREAKING CHANGE: The original state-batch-to-merkle.ts module has been removed
 * because it used SHA256 hashing which is NOT compatible with ZK circuits.
 *
 * MIGRATION:
 * - Old: integrateStateExtractionResult(), integrateMultipleStates(), incrementalUpdate()
 * - New: ShadowAtlasService.buildAtlas() which uses MultiLayerMerkleTreeBuilder
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import { describe, it, expect } from 'vitest';
import type { StateExtractionResult, ExtractedBoundary } from '../../../providers/state-batch-extractor.js';
import {
  integrateStateExtractionResult,
  integrateMultipleStates,
  incrementalUpdate,
  extractedBoundaryToNormalizedDistrict,
  quickIntegrateState,
  quickIntegrateMultipleStates,
} from '../../../integration/state-batch-to-merkle.js';
import { MerkleTreeBuilder } from '../../../transformation/merkle-builder.js';

// ============================================================================
// Deprecation Verification Tests
// ============================================================================

describe('State Batch to Merkle Integration - DEPRECATED', () => {
  describe('integrateStateExtractionResult()', () => {
    it('should throw deprecation error', () => {
      const mockData: StateExtractionResult = {
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

      expect(() => integrateStateExtractionResult(mockData)).toThrow(
        /DEPRECATED.*state-batch-to-merkle/i
      );
    });

    it('should mention migration to buildAtlas()', () => {
      const mockData: StateExtractionResult = {
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

      expect(() => integrateStateExtractionResult(mockData)).toThrow(
        /buildAtlas/i
      );
    });
  });

  describe('integrateMultipleStates()', () => {
    it('should throw deprecation error', () => {
      expect(() => integrateMultipleStates([])).toThrow(
        /DEPRECATED.*state-batch-to-merkle/i
      );
    });
  });

  describe('incrementalUpdate()', () => {
    it('should throw deprecation error', () => {
      const mockTree = {
        root: '0x123',
        leaves: [],
        tree: [[]],
        districts: [],
      };

      expect(() => incrementalUpdate(mockTree, [])).toThrow(
        /DEPRECATED.*state-batch-to-merkle/i
      );
    });
  });

  describe('extractedBoundaryToNormalizedDistrict()', () => {
    it('should throw deprecation error', () => {
      expect(() => extractedBoundaryToNormalizedDistrict({})).toThrow(
        /DEPRECATED/i
      );
    });
  });

  describe('quickIntegrateState()', () => {
    it('should throw deprecation error', () => {
      const mockData: StateExtractionResult = {
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

      expect(() => quickIntegrateState(mockData)).toThrow(/DEPRECATED/i);
    });
  });

  describe('quickIntegrateMultipleStates()', () => {
    it('should throw deprecation error', () => {
      expect(() => quickIntegrateMultipleStates([])).toThrow(/DEPRECATED/i);
    });
  });
});

describe('MerkleTreeBuilder - DEPRECATED', () => {
  it('should throw deprecation error on construction', () => {
    expect(() => new MerkleTreeBuilder()).toThrow(
      /DEPRECATED.*MerkleTreeBuilder/i
    );
  });

  it('should mention migration to MultiLayerMerkleTreeBuilder', () => {
    expect(() => new MerkleTreeBuilder()).toThrow(
      /MultiLayerMerkleTreeBuilder/i
    );
  });

  it('should mention SHA256 is not ZK-compatible', () => {
    expect(() => new MerkleTreeBuilder()).toThrow(/SHA256/i);
  });
});

// ============================================================================
// Migration Documentation Tests
// ============================================================================

describe('Migration Documentation', () => {
  it('should have clear error message with migration path', () => {
    try {
      const mockData: StateExtractionResult = {
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
      integrateStateExtractionResult(mockData);
      expect.fail('Should have thrown');
    } catch (error) {
      const message = (error as Error).message;

      // Verify error message contains helpful migration info
      expect(message).toContain('DEPRECATED');
      expect(message).toContain('buildAtlas');
      expect(message).toContain('MultiLayerMerkleTreeBuilder');
      expect(message).toContain('Poseidon2');
    }
  });
});
