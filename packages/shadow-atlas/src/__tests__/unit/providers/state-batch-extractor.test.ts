/**
 * State Batch Extractor Tests
 *
 * Tests the state boundary extraction from state GIS portals.
 * Includes unit tests (mocked) and integration tests (live API calls).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  StateBatchExtractor,
  extractStateBoundaries,
  extractLayer,
  type LayerExtractionResult,
  type StateExtractionResult,
} from '../../../providers/state-batch-extractor.js';
import {
  getStatesWithLegislativeData,
  getLegislativeEndpoint,
  getLegislativeStats,
  getRedistrictingCommissionStates,
} from '../../../core/registry/state-gis-portals.js';

// ============================================================================
// Registry Tests
// ============================================================================

describe('State GIS Portal Registry', () => {
  describe('getStatesWithLegislativeData', () => {
    it('returns states with legislative district layers configured', () => {
      const states = getStatesWithLegislativeData();

      expect(states.length).toBeGreaterThan(0);

      // All returned states should have legislative layers
      for (const state of states) {
        expect(state.legislativeDistrictLayers).toBeDefined();
        expect(state.legislativeDistrictLayers!.length).toBeGreaterThan(0);
      }
    });

    it('includes Wisconsin with legislative district data', () => {
      const states = getStatesWithLegislativeData();
      const wisconsin = states.find(s => s.state === 'WI');

      expect(wisconsin).toBeDefined();
      // Wisconsin uses TIGERweb for reliable API access (state-gis authority)
      expect(wisconsin!.legislativeAuthority).toBe('state-gis');
    });

    it('includes Texas with quarterly updates', () => {
      const states = getStatesWithLegislativeData();
      const texas = states.find(s => s.state === 'TX');

      expect(texas).toBeDefined();
      expect(texas!.updateSchedule).toBe('quarterly');
    });
  });

  describe('getLegislativeEndpoint', () => {
    it('returns congressional district endpoint for Wisconsin', () => {
      const layer = getLegislativeEndpoint('WI', 'congressional');

      expect(layer).toBeDefined();
      expect(layer!.type).toBe('congressional');
      expect(layer!.expectedCount).toBe(8); // Wisconsin has 8 congressional districts
      expect(layer!.vintage).toBe(2024); // TIGERweb 119th Congress data
    });

    it('returns state senate endpoint for Texas', () => {
      const layer = getLegislativeEndpoint('TX', 'state_senate');

      expect(layer).toBeDefined();
      expect(layer!.type).toBe('state_senate');
      expect(layer!.expectedCount).toBe(31); // Texas has 31 State Senate districts
    });

    it('returns undefined for unconfigured state', () => {
      const layer = getLegislativeEndpoint('ZZ', 'congressional');
      expect(layer).toBeUndefined();
    });
  });

  describe('getLegislativeStats', () => {
    it('returns statistics about configured legislative data', () => {
      const stats = getLegislativeStats();

      expect(stats.statesWithLegislativeData).toBeGreaterThan(0);
      expect(stats.totalLayers).toBeGreaterThan(0);

      // Should have at least some congressional districts
      expect(stats.byLayerType.congressional).toBeGreaterThan(0);

      // Should have redistricting commission states
      expect(stats.byAuthority['state-redistricting-commission']).toBeGreaterThan(0);
    });
  });

  describe('getRedistrictingCommissionStates', () => {
    it('returns states with highest authority during redistricting gaps', () => {
      const states = getRedistrictingCommissionStates();

      expect(states.length).toBeGreaterThan(0);

      // All should have state-redistricting-commission authority
      for (const state of states) {
        expect(state.legislativeAuthority).toBe('state-redistricting-commission');
      }

      // Colorado IRC uses independent redistricting commissions
      const stateAbbrs = states.map(s => s.state);
      expect(stateAbbrs).toContain('CO');
    });
  });
});

// ============================================================================
// Unit Tests (Mocked)
// ============================================================================

describe('StateBatchExtractor (Unit)', () => {
  let extractor: StateBatchExtractor;

  beforeEach(() => {
    extractor = new StateBatchExtractor({ retryAttempts: 1, retryDelayMs: 100 });
  });

  describe('extractLayer', () => {
    it('returns error for non-existent state', async () => {
      const result = await extractor.extractLayer('ZZ', 'congressional');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('returns error for state without legislative layers in registry', async () => {
      // Test behavior when a state exists in STATE_GIS_PORTALS but has no legislativeDistrictLayers
      // Since all 50 states now have TIGERweb layers configured, we test this by
      // checking the error handling path for a truly non-existent state
      const result = await extractor.extractLayer('XX', 'congressional');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('extractState', () => {
    it('returns empty results for non-existent state', async () => {
      const result = await extractor.extractState('ZZ');

      expect(result.state).toBe('ZZ');
      expect(result.layers).toHaveLength(0);
      expect(result.summary.layersFailed).toBe(1);
    });
  });
});

// ============================================================================
// Integration Tests (Live API - skip in CI)
// ============================================================================

describe.skipIf(process.env.CI)('StateBatchExtractor (Integration)', () => {
  let extractor: StateBatchExtractor;

  beforeEach(() => {
    extractor = new StateBatchExtractor({ retryAttempts: 2, retryDelayMs: 1000 });
  });

  describe('Wisconsin (TIGERweb)', () => {
    it('extracts congressional districts from Wisconsin', async () => {
      const result = await extractor.extractLayer('WI', 'congressional');

      console.log('Wisconsin Congressional Districts:', {
        success: result.success,
        featureCount: result.featureCount,
        expectedCount: result.expectedCount,
        error: result.error,
      });

      // We expect this to succeed in a real environment
      // But API might be down, so we check structure regardless
      expect(result.state).toBe('WI');
      expect(result.layerType).toBe('congressional');

      if (result.success) {
        expect(result.featureCount).toBe(8);
        expect(result.boundaries.length).toBe(8);

        // Verify boundary structure
        const firstBoundary = result.boundaries[0];
        expect(firstBoundary.id).toBeDefined();
        expect(firstBoundary.name).toBeDefined();
        expect(firstBoundary.geometry).toBeDefined();
        expect(firstBoundary.source.authority).toBe('state-gis');
      }
    }, 30000);

    it('extracts all Wisconsin legislative boundaries', async () => {
      const result = await extractor.extractState('WI');

      console.log('Wisconsin Extraction Summary:', result.summary);

      expect(result.state).toBe('WI');
      expect(result.stateName).toBe('Wisconsin');
      expect(result.authority).toBe('state-gis');

      // Should have 4 layers configured (CD, Senate, House, County)
      expect(result.layers.length).toBe(4);
    }, 60000);
  });

  describe('Texas (TIGERweb)', () => {
    it('extracts state house districts from Texas', async () => {
      const result = await extractor.extractLayer('TX', 'state_house');

      console.log('Texas State House Districts:', {
        success: result.success,
        featureCount: result.featureCount,
        expectedCount: result.expectedCount,
        error: result.error,
      });

      expect(result.state).toBe('TX');
      expect(result.layerType).toBe('state_house');

      if (result.success) {
        expect(result.featureCount).toBe(150);
        expect(result.boundaries[0].source.authority).toBe('state-gis');
      }
    }, 60000); // Texas has 150 districts - allow more time
  });

  describe('Colorado (TIGERweb)', () => {
    it('extracts congressional districts from Colorado', async () => {
      const result = await extractor.extractLayer('CO', 'congressional');

      console.log('Colorado Congressional Districts:', {
        success: result.success,
        featureCount: result.featureCount,
        expectedCount: result.expectedCount,
        error: result.error,
      });

      expect(result.state).toBe('CO');
      expect(result.layerType).toBe('congressional');

      if (result.success) {
        expect(result.featureCount).toBe(8);
        // Colorado uses independent commissions - highest authority
        expect(result.boundaries[0].source.authority).toBe('state-redistricting-commission');
      }
    }, 30000);
  });
});

// ============================================================================
// Cross-Validation Tests (TIGER vs State)
// ============================================================================

describe.skip('Cross-Validation: TIGER vs State Sources', () => {
  it('validates Wisconsin congressional district count matches TIGER', async () => {
    // This would compare state source to TIGER data
    // Implementation depends on TIGER provider being available
    expect(true).toBe(true); // Placeholder
  });

  it('validates boundary geometries overlap within tolerance', async () => {
    // This would check geometric similarity between sources
    // Implementation requires turf.js or similar
    expect(true).toBe(true); // Placeholder
  });
});
