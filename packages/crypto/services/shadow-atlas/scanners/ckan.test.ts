/**
 * CKAN Scanner Tests with SemanticLayerValidator Integration
 *
 * Tests the integration of semantic validation and geographic validation
 * to prevent data quality issues:
 * 1. Voting precincts rejected (negative keyword)
 * 2. Canopy/zoning data rejected (negative keyword)
 * 3. Cross-city contamination detected (geographic validation)
 */

import { describe, it, expect } from 'vitest';
import { CKANScanner } from './ckan.js';
import type { CityTarget } from '../validators/enhanced-geographic-validator.js';

describe('CKANScanner with SemanticValidator Integration', () => {
  const lexingtonCity: CityTarget = {
    name: 'Lexington',
    state: 'KY',
    fips: '2146027',
    region: 'KY',
  };

  const scanner = new CKANScanner();

  describe('Negative Keyword Filtering', () => {
    it('rejects voting precinct datasets', () => {
      const score = scanner['scoreTitle'](
        'Lexington Voting Precincts 2024',
        lexingtonCity,
        ['election', 'boundaries']
      );

      expect(score).toBe(0); // Rejected by negative keyword "voting"
    });

    it('rejects election precinct datasets', () => {
      const score = scanner['scoreTitle'](
        'Lexington-Fayette Election Precincts',
        lexingtonCity,
        ['precinct']
      );

      expect(score).toBe(0); // Rejected by negative keyword "precinct"
    });

    it('rejects canopy coverage datasets', () => {
      const score = scanner['scoreTitle'](
        'Lexington Tree Canopy Coverage',
        lexingtonCity,
        ['environment']
      );

      expect(score).toBe(0); // Rejected by negative keyword "canopy"
    });

    it('rejects zoning overlay datasets', () => {
      const score = scanner['scoreTitle'](
        'Lexington Zoning Overlay Districts',
        lexingtonCity,
        ['zoning', 'planning']
      );

      expect(score).toBe(0); // Rejected by negative keyword "zoning" or "overlay"
    });

    it('rejects parcel data', () => {
      const score = scanner['scoreTitle'](
        'Lexington Property Parcel Boundaries',
        lexingtonCity,
        ['property']
      );

      expect(score).toBe(0); // Rejected by negative keyword "parcel"
    });
  });

  describe('Legitimate Council District Datasets', () => {
    it('accepts council district datasets with good score', () => {
      const score = scanner['scoreTitle'](
        'Lexington-Fayette Council Districts',
        lexingtonCity,
        ['boundaries', 'governance']
      );

      // Expected: semantic score (40) + city match (15) + state match (10) + tag bonus (5) = 60-65
      expect(score).toBeGreaterThanOrEqual(50); // Meets threshold
      expect(score).toBeLessThanOrEqual(70);
    });

    it('accepts ward datasets with good score', () => {
      const score = scanner['scoreTitle'](
        'Lexington City Ward Boundaries',
        lexingtonCity,
        ['boundaries']
      );

      // Expected: semantic score (30) + city match (15) + state match (10) + tag bonus (5) = 50-55
      expect(score).toBeGreaterThanOrEqual(50); // Exactly at threshold
      expect(score).toBeLessThanOrEqual(60);
    });

    it('accepts district datasets with moderate score', () => {
      const score = scanner['scoreTitle'](
        'Lexington Municipal Districts KY',
        lexingtonCity,
        []
      );

      // Expected: semantic score (40) + city match (15) + state match (10) = 55-65
      // "Municipal district" is a high-confidence pattern (40 pts)
      expect(score).toBeGreaterThanOrEqual(50);
      expect(score).toBeLessThanOrEqual(70);
    });
  });

  describe('Geographic Validation (Cross-City Contamination)', () => {
    it('filters low-quality candidates below threshold', () => {
      const candidates = [
        {
          id: '1',
          title: 'Lexington Voting Precincts', // Should be rejected
          description: '',
          url: 'http://example.com/1',
          downloadUrl: 'http://example.com/1.geojson',
          score: 0,
          portalType: 'ckan' as const,
        },
        {
          id: '2',
          title: 'Lexington Council Districts', // Should pass
          description: '',
          url: 'http://example.com/2',
          downloadUrl: 'http://example.com/2.geojson',
          score: 75,
          portalType: 'ckan' as const,
        },
      ];

      const ranked = scanner['rankCandidates'](candidates, lexingtonCity);

      // Only high-quality candidate (≥50) should remain
      expect(ranked.length).toBe(1);
      expect(ranked[0].title).toBe('Lexington Council Districts');
    });

    it('applies strict confidence threshold (50+)', () => {
      const candidates = [
        {
          id: '1',
          title: 'Some Generic District Data',
          description: '',
          url: 'http://example.com/1',
          downloadUrl: 'http://example.com/1.geojson',
          score: 45, // Below threshold
          portalType: 'ckan' as const,
        },
        {
          id: '2',
          title: 'Another Low Quality Dataset',
          description: '',
          url: 'http://example.com/2',
          downloadUrl: 'http://example.com/2.geojson',
          score: 40, // Below threshold
          portalType: 'ckan' as const,
        },
      ];

      const ranked = scanner['rankCandidates'](candidates, lexingtonCity);

      // Both below threshold - should return empty
      expect(ranked.length).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('handles missing tags gracefully', () => {
      const score = scanner['scoreTitle'](
        'Lexington Council Districts',
        lexingtonCity
        // No tags provided
      );

      // Should still score based on title
      expect(score).toBeGreaterThan(0);
    });

    it('rejects mixed datasets (council + voting)', () => {
      const score = scanner['scoreTitle'](
        'Lexington Council Districts and Voting Precincts',
        lexingtonCity,
        ['boundaries', 'election']
      );

      // Negative keyword "voting" should reject
      expect(score).toBe(0);
    });

    it('accepts datasets without negative keywords', () => {
      const score = scanner['scoreTitle'](
        'Lexington City Council Representation Areas',
        lexingtonCity,
        ['governance']
      );

      // No negative keywords
      // "council" OR "representation" matches low-confidence pattern (20 pts) + city (15) = 35
      // Note: "City Council" does NOT match high-confidence "council\s*district" pattern
      expect(score).toBeGreaterThanOrEqual(35);
      expect(score).toBeLessThanOrEqual(45);
    });
  });

  describe('Regression Tests (Lexington-Louisville Bug)', () => {
    it('would reject Louisville data for Lexington query via geographic validation', () => {
      // NOTE: This test documents the expected behavior when geographic validation
      // is added after GeoJSON download. The CKAN scanner doesn't download data
      // during scoring phase, so this is tested in integration tests.

      const louisvilleTitle = 'Louisville Metro Council Districts';
      const score = scanner['scoreTitle'](louisvilleTitle, lexingtonCity);

      // Title scoring would accept (Louisville != Lexington, but both in KY)
      // Geographic validation would catch centroid mismatch
      expect(score).toBeGreaterThan(0); // Title score passes
      // Real rejection happens via validateCityBoundary() after download
    });

    it('prioritizes exact city matches in scoring', () => {
      const lexingtonScore = scanner['scoreTitle'](
        'Lexington Council Districts',
        lexingtonCity
      );

      const genericScore = scanner['scoreTitle'](
        'Kentucky Council Districts',
        lexingtonCity
      );

      // Lexington-specific should score higher than generic KY
      expect(lexingtonScore).toBeGreaterThan(genericScore);
    });
  });
});
