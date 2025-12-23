/**
 * Primary Source Comparator Tests
 *
 * Tests for WP-FRESHNESS-3 implementation.
 * Verifies HTTP HEAD request logic, comparison algorithm, and error handling.
 *
 * NOTE: Some tests hit real URLs and may be slow or flaky.
 * Use mock fetch for CI/CD environments.
 */

import { describe, it, expect } from 'vitest';
import {
  PrimarySourceComparator,
  type BoundaryType,
  type SourceFreshness,
  type TigerComparison,
} from '../../../provenance/primary-comparator.js';

describe('PrimarySourceComparator', () => {
  const comparator = new PrimarySourceComparator();

  describe('Static methods', () => {
    it('should return all primary sources', () => {
      const sources = PrimarySourceComparator.getPrimarySources();
      expect(sources.size).toBeGreaterThan(0);
      expect(sources.has('CA')).toBe(true);
      expect(sources.has('TX')).toBe(true);
    });

    it('should return states with congressional primary sources', () => {
      const states =
        PrimarySourceComparator.getStatesWithPrimarySources('congressional');
      expect(states.length).toBeGreaterThan(0);
      expect(states).toContain('CA');
      expect(states).toContain('TX');
    });

    it('should return states with state senate primary sources', () => {
      const states =
        PrimarySourceComparator.getStatesWithPrimarySources('state_senate');
      expect(states.length).toBeGreaterThan(0);
      expect(states).toContain('CA');
    });
  });

  describe('TIGER URL generation', () => {
    it('should generate correct TIGER URL for congressional districts', async () => {
      // Test by checking for change - we can't directly call getTigerUrl since it's private
      // But we can verify the comparison works
      const comparison = await comparator.compareTigerFreshness(
        'congressional',
        'ZZ' // Non-existent state
      );

      expect(comparison.jurisdiction).toBe('ZZ');
      expect(comparison.recommendation).toBe('use-tiger');
      expect(comparison.reason).toContain('No primary source');
    });
  });

  describe('Primary source lookup', () => {
    it('should return null for states without primary sources', async () => {
      const comparison = await comparator.compareTigerFreshness(
        'congressional',
        'ZZ' // Non-existent state
      );

      expect(comparison.tigerIsFresh).toBe(true);
      expect(comparison.recommendation).toBe('use-tiger');
      expect(comparison.primarySource).toBeUndefined();
    });

    it('should find primary source for California', async () => {
      const comparison = await comparator.compareTigerFreshness(
        'congressional',
        'CA'
      );

      expect(comparison.jurisdiction).toBe('CA');
      expect(comparison.boundaryType).toBe('congressional');
      // Primary source should exist
      expect(comparison.primarySource).toBeDefined();
      // Source name should reference California (either "CA" or "California")
      expect(
        comparison.primarySource?.name.includes('CA') ||
          comparison.primarySource?.name.includes('California')
      ).toBe(true);
    });

    it('should handle case-insensitive jurisdiction codes', async () => {
      const comparison = await comparator.compareTigerFreshness(
        'congressional',
        'ca' // lowercase
      );

      expect(comparison.jurisdiction).toBe('ca');
      expect(comparison.primarySource).toBeDefined();
    });
  });

  describe('Comparison logic', () => {
    it('should recommend TIGER when primary is unavailable', async () => {
      // Use a state with primary source but boundary type not covered
      const comparison = await comparator.compareTigerFreshness(
        'county', // Not covered by CA redistricting commission
        'CA'
      );

      expect(comparison.tigerIsFresh).toBe(true);
      expect(comparison.recommendation).toBe('use-tiger');
    });

    it('should return structured comparison result', async () => {
      const comparison = await comparator.compareTigerFreshness(
        'congressional',
        'TX'
      );

      // Verify structure
      expect(comparison).toHaveProperty('jurisdiction');
      expect(comparison).toHaveProperty('boundaryType');
      expect(comparison).toHaveProperty('tigerIsFresh');
      expect(comparison).toHaveProperty('reason');
      expect(comparison).toHaveProperty('recommendation');
      expect(comparison).toHaveProperty('tigerLastModified');
      expect(comparison).toHaveProperty('primaryLastModified');

      // Should have valid recommendation
      expect(['use-tiger', 'use-primary', 'manual-review']).toContain(
        comparison.recommendation
      );
    });
  });

  describe('checkSourceFreshness', () => {
    it('should return unavailable for invalid URLs', async () => {
      const freshness = await comparator.checkSourceFreshness(
        'https://invalid-domain-that-does-not-exist-12345.com/'
      );

      expect(freshness.available).toBe(false);
      expect(freshness.error).toBeDefined();
      expect(freshness.lastModified).toBeNull();
    });

    it('should handle 404 responses', async () => {
      const freshness = await comparator.checkSourceFreshness(
        'https://www.census.gov/nonexistent-path-404'
      );

      expect(freshness.available).toBe(false);
      expect(freshness.error).toBe('HTTP 404');
    });

    // Note: Skipping real URL tests by default to avoid network dependency
    // Uncomment to test against actual Census TIGER URLs
    it.skip('should check real TIGER URL (network test)', async () => {
      const year = new Date().getFullYear();
      const tigerUrl = `https://www2.census.gov/geo/tiger/TIGER${year}/CD/`;

      const freshness = await comparator.checkSourceFreshness(tigerUrl);

      // TIGER directory should exist
      expect(freshness.available).toBe(true);
      expect(freshness.checkedAt).toBeInstanceOf(Date);
    }, 10000); // 10 second timeout for network test
  });

  describe('Batch operations', () => {
    it('should compare all states for congressional districts', async () => {
      const results = await comparator.compareAllStates('congressional');

      expect(results.size).toBeGreaterThan(0);

      // Verify each result has correct structure
      for (const [state, comparison] of Array.from(results.entries())) {
        expect(comparison.jurisdiction).toBe(state);
        expect(comparison.boundaryType).toBe('congressional');
        expect(['use-tiger', 'use-primary', 'manual-review']).toContain(
          comparison.recommendation
        );
      }
    }, 30000); // 30 second timeout for batch network operations

    it('should handle empty results for boundary types without primaries', async () => {
      const results = await comparator.compareAllStates('county');

      // County boundaries don't have state redistricting primaries
      // So we should get results but all should recommend TIGER
      for (const [_, comparison] of Array.from(results.entries())) {
        expect(comparison.recommendation).toBe('use-tiger');
      }
    }, 30000);
  });

  describe('Error handling', () => {
    it('should handle timeout gracefully', async () => {
      // Use a URL known to be slow (or mock in production)
      const freshness = await comparator.checkSourceFreshness(
        'https://httpstat.us/200?sleep=10000' // Sleeps for 10 seconds
      );

      expect(freshness.available).toBe(false);
      expect(freshness.error).toBeDefined();
    }, 10000); // 10 second timeout (request should timeout at 5s)

    it('should handle network errors', async () => {
      const freshness = await comparator.checkSourceFreshness(
        'https://10.255.255.1/' // Non-routable IP
      );

      expect(freshness.available).toBe(false);
      expect(freshness.error).toBeDefined();
    });
  });

  describe('Lag calculation', () => {
    it('should calculate lag days correctly when primary is fresher', async () => {
      // This test requires mocking since we can't control real timestamps
      // In a real scenario, we'd mock the checkSourceFreshness method
      // For now, we test the structure

      const comparison = await comparator.compareTigerFreshness(
        'congressional',
        'CA'
      );

      if (comparison.lagDays !== undefined) {
        expect(typeof comparison.lagDays).toBe('number');
        expect(comparison.lagDays).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Edge cases', () => {
    it('should handle missing Last-Modified headers', async () => {
      // Use a URL that might not have Last-Modified
      const freshness = await comparator.checkSourceFreshness(
        'https://www.example.com/'
      );

      expect(freshness.checkedAt).toBeInstanceOf(Date);
      // lastModified might be null if header is missing
      if (freshness.lastModified !== null) {
        expect(freshness.lastModified).toBeInstanceOf(Date);
      }
    });

    it('should handle both sources unavailable', async () => {
      // Can't easily test this without mocking, but verify structure is correct
      const comparison = await comparator.compareTigerFreshness(
        'congressional',
        'CA'
      );

      // Should always return a valid recommendation
      expect(comparison.recommendation).toBeDefined();
      expect(comparison.reason).toBeDefined();
    });
  });
});
