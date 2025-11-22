/**
 * ArcGIS Hub Scanner Tests
 *
 * Tests SemanticLayerValidator integration into ArcGIS Hub scanner.
 * Verifies that negative keywords (precinct, canopy, voting) are rejected.
 */

import { describe, it, expect } from 'vitest';
import { ArcGISHubScanner } from './arcgis-hub.js';
import type { CityTarget } from '../validators/enhanced-geographic-validator.js';

describe('ArcGISHubScanner with SemanticValidator', () => {
  const scanner = new ArcGISHubScanner();
  const mockCity: CityTarget = {
    name: 'Seattle',
    state: 'WA',
    fipsCode: '5363000',
    population: 750000,
    lat: 47.6062,
    lon: -122.3321,
  };

  describe('scoreTitle - Negative Keyword Rejection', () => {
    it('rejects voting precinct layers', () => {
      const score = scanner['scoreTitle']('Voting Precincts 2024', mockCity);
      expect(score).toBe(0);
    });

    it('rejects election district layers', () => {
      const score = scanner['scoreTitle']('Election Districts', mockCity);
      expect(score).toBe(0);
    });

    it('rejects polling place layers', () => {
      const score = scanner['scoreTitle']('Polling Places', mockCity);
      expect(score).toBe(0);
    });

    it('rejects tree canopy cover layers', () => {
      const score = scanner['scoreTitle']('Tree Canopy Cover', mockCity);
      expect(score).toBe(0);
    });

    it('rejects canopy coverage layers', () => {
      const score = scanner['scoreTitle']('Canopy Coverage 2023', mockCity);
      expect(score).toBe(0);
    });

    it('rejects zoning overlay layers', () => {
      const score = scanner['scoreTitle']('Zoning Overlay Districts', mockCity);
      expect(score).toBe(0);
    });

    it('rejects parcel data layers', () => {
      const score = scanner['scoreTitle']('Tax Parcel Boundaries', mockCity);
      expect(score).toBe(0);
    });
  });

  describe('scoreTitle - False Positive Penalties', () => {
    it('penalizes school district layers', () => {
      const score = scanner['scoreTitle']('School District Boundaries', mockCity);
      expect(score).toBeLessThan(50); // Should not meet threshold
    });

    it('penalizes fire district layers', () => {
      const score = scanner['scoreTitle']('Fire District Boundaries', mockCity);
      expect(score).toBeLessThan(50);
    });

    it('penalizes congressional district layers', () => {
      const score = scanner['scoreTitle']('Congressional Districts', mockCity);
      expect(score).toBeLessThan(50);
    });

    it('penalizes state senate district layers', () => {
      const score = scanner['scoreTitle']('State Senate Districts', mockCity);
      expect(score).toBeLessThan(50);
    });
  });

  describe('scoreTitle - Positive Matches', () => {
    it('scores council district layers positively', () => {
      const score = scanner['scoreTitle']('City Council Districts', mockCity);
      expect(score).toBe(40); // High-confidence pattern (council\s*district)
    });

    it('scores ward boundary layers positively', () => {
      const score = scanner['scoreTitle']('Ward Boundaries', mockCity);
      expect(score).toBe(30); // Medium-confidence pattern (\bward\b)
    });

    it('scores municipal district layers positively', () => {
      const score = scanner['scoreTitle']('Municipal District Boundaries', mockCity);
      expect(score).toBe(40); // High-confidence pattern (municipal\s*district)
    });

    it('scores high-confidence patterns higher than low-confidence', () => {
      const score1 = scanner['scoreTitle']('City Council Districts', mockCity);
      const score2 = scanner['scoreTitle']('District Boundaries', mockCity);
      expect(score1).toBeGreaterThan(score2); // More specific = higher score
    });
  });

  describe('scoreTitle - Real-World False Positives (Wichita, Anaheim)', () => {
    it('rejects Wichita voting precincts (234 features)', () => {
      const score = scanner['scoreTitle']('Wichita Voting Precincts', mockCity);
      expect(score).toBe(0); // Should be rejected by "voting" keyword
    });

    it('rejects Anaheim canopy cover data', () => {
      const score = scanner['scoreTitle']('Anaheim Canopy Cover', mockCity);
      expect(score).toBe(0); // Should be rejected by "canopy" keyword
    });

    it('rejects generic "Precincts" title', () => {
      const score = scanner['scoreTitle']('Precincts', mockCity);
      expect(score).toBe(0); // Should be rejected by "precinct" keyword
    });

    it('rejects "Election Boundaries"', () => {
      const score = scanner['scoreTitle']('Election Boundaries', mockCity);
      expect(score).toBe(0); // Should be rejected by "election" keyword
    });
  });

  describe('isRelevantDataset - Hub API Pre-filtering', () => {
    it('rejects datasets with negative keywords', () => {
      const dataset = {
        id: 'test-1',
        type: 'dataset',
        attributes: {
          name: 'Voting Precincts 2024',
          description: 'Precinct boundaries for elections',
        },
      };
      const result = scanner['isRelevantDataset'](dataset, mockCity);
      expect(result).toBe(false); // Score 0, below threshold
    });

    it('accepts datasets with positive keywords', () => {
      const dataset = {
        id: 'test-2',
        type: 'dataset',
        attributes: {
          name: 'City Council Districts',
          description: 'Boundaries for city council representation',
        },
      };
      const result = scanner['isRelevantDataset'](dataset, mockCity);
      expect(result).toBe(true); // Score ≥20
    });

    it('rejects low-confidence generic titles', () => {
      const dataset = {
        id: 'test-3',
        type: 'dataset',
        attributes: {
          name: 'Municipal Data', // Too generic
          description: 'Various municipal boundaries',
        },
      };
      const result = scanner['isRelevantDataset'](dataset, mockCity);
      expect(result).toBe(false); // Score < 20
    });
  });

  describe('rankCandidates - Threshold Filtering', () => {
    it('filters out candidates below score threshold (30)', () => {
      const candidates = [
        {
          id: '1',
          title: 'City Council Districts', // Should score 40 (high confidence)
          description: '',
          url: 'http://example.com',
          downloadUrl: 'http://example.com/download',
          score: 0,
          portalType: 'arcgis-hub' as const,
        },
        {
          id: '2',
          title: 'Ward Boundaries', // Should score 30 (medium confidence)
          description: '',
          url: 'http://example.com',
          downloadUrl: 'http://example.com/download',
          score: 0,
          portalType: 'arcgis-hub' as const,
        },
        {
          id: '3',
          title: 'School Districts', // Should score <30 (false positive penalty)
          description: '',
          url: 'http://example.com',
          downloadUrl: 'http://example.com/download',
          score: 0,
          portalType: 'arcgis-hub' as const,
        },
        {
          id: '4',
          title: 'Voting Precincts', // Should score 0 (negative keyword)
          description: '',
          url: 'http://example.com',
          downloadUrl: 'http://example.com/download',
          score: 0,
          portalType: 'arcgis-hub' as const,
        },
      ];

      const ranked = scanner['rankCandidates'](candidates, mockCity);

      // Only "City Council Districts" and "Ward Boundaries" should remain (both ≥30)
      expect(ranked.length).toBe(2);
      expect(ranked[0].title).toBe('City Council Districts'); // Higher score (40)
      expect(ranked[1].title).toBe('Ward Boundaries'); // Lower score (30)
      expect(ranked[0].score).toBe(40);
      expect(ranked[1].score).toBe(30);
    });

    it('sorts candidates by score descending', () => {
      const candidates = [
        {
          id: '1',
          title: 'Ward Boundaries', // Medium confidence (30)
          description: '',
          url: 'http://example.com',
          downloadUrl: 'http://example.com/download',
          score: 0,
          portalType: 'arcgis-hub' as const,
        },
        {
          id: '2',
          title: 'City Council Districts', // High confidence (40)
          description: '',
          url: 'http://example.com',
          downloadUrl: 'http://example.com/download',
          score: 0,
          portalType: 'arcgis-hub' as const,
        },
      ];

      const ranked = scanner['rankCandidates'](candidates, mockCity);

      // "City Council Districts" should rank higher (40 > 30)
      expect(ranked.length).toBe(2);
      expect(ranked[0].title).toBe('City Council Districts');
      expect(ranked[1].title).toBe('Ward Boundaries');
      expect(ranked[0].score).toBe(40);
      expect(ranked[1].score).toBe(30);
    });
  });
});
