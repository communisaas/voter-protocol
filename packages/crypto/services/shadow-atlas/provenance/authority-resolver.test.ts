/**
 * Authority Conflict Resolution Tests
 *
 * Tests the authority resolver that picks the best source when multiple
 * sources provide the same boundary data.
 *
 * Test Coverage:
 * TEST 5: Authority conflict resolution picks highest authority source
 * - Higher authority wins (FEDERAL > STATE > MUNICIPAL)
 * - Same authority: higher preference wins
 * - Same preference: fresher data wins
 */

import { describe, it, expect } from 'vitest';
import {
  resolveAuthorityConflict,
  resolveAuthorityConflictForType,
  getAvailableSources,
  isPreferredSource,
  compareSources,
  type BoundaryWithSource,
  type ResolvedBoundarySource,
} from './authority-resolver.js';
import { AuthorityLevel } from './tiger-authority-rules.js';

describe('AuthorityResolver', () => {
  describe('TEST 5: Authority conflict resolution', () => {
    describe('Higher authority wins', () => {
      it('should prefer TIGER (authority=5) over ArcGIS Hub (authority=2)', () => {
        const boundaries: BoundaryWithSource[] = [
          {
            boundaryType: 'congressional',
            provider: 'census-tiger',
            releaseDate: new Date('2024-07-01'),
          },
          {
            boundaryType: 'congressional',
            provider: 'arcgis-hub',
            releaseDate: new Date('2024-07-01'),
          },
        ];

        const resolved = resolveAuthorityConflict(boundaries);

        expect(resolved.boundary.provider).toBe('census-tiger');
        expect(resolved.authority).toBe(AuthorityLevel.FEDERAL_MANDATE);
        expect(resolved.reasoning).toContain('Higher authority');
      });

      it('should prefer state commission (authority=5) over state GIS (authority=4)', () => {
        const boundaries: BoundaryWithSource[] = [
          {
            boundaryType: 'congressional',
            provider: 'state-redistricting-commission',
            releaseDate: new Date('2022-01-15'),
          },
          {
            boundaryType: 'congressional',
            provider: 'state-gis',
            releaseDate: new Date('2022-01-15'),
          },
        ];

        const resolved = resolveAuthorityConflict(boundaries);

        expect(resolved.boundary.provider).toBe('state-redistricting-commission');
        expect(resolved.authority).toBe(AuthorityLevel.FEDERAL_MANDATE);
      });

      it('should prefer state GIS (authority=4) over county GIS (authority=3)', () => {
        const boundaries: BoundaryWithSource[] = [
          {
            boundaryType: 'county',
            provider: 'state-gis',
            releaseDate: new Date('2024-07-01'),
          },
          {
            boundaryType: 'county',
            provider: 'county-gis',
            releaseDate: new Date('2024-07-01'),
          },
        ];

        const resolved = resolveAuthorityConflict(boundaries);

        expect(resolved.boundary.provider).toBe('state-gis');
        expect(resolved.authority).toBe(AuthorityLevel.STATE_MANDATE);
      });
    });

    describe('Same authority: higher preference wins', () => {
      it('should prefer state commission (pref=1) over TIGER (pref=3) for congressional', () => {
        const boundaries: BoundaryWithSource[] = [
          {
            boundaryType: 'congressional',
            provider: 'census-tiger',
            releaseDate: new Date('2022-07-01'),
          },
          {
            boundaryType: 'congressional',
            provider: 'state-redistricting-commission',
            releaseDate: new Date('2022-01-15'),
          },
        ];

        const resolved = resolveAuthorityConflict(boundaries, new Date('2022-09-01'));

        expect(resolved.boundary.provider).toBe('state-redistricting-commission');
        expect(resolved.authority).toBe(AuthorityLevel.FEDERAL_MANDATE);
        expect(resolved.preference).toBe(1);
        expect(resolved.reasoning).toContain('higher preference');
      });

      it('should prefer state commission (pref=1) over state redistricting (pref=2)', () => {
        const boundaries: BoundaryWithSource[] = [
          {
            boundaryType: 'congressional',
            provider: 'state-redistricting-commission',
            releaseDate: new Date('2022-01-15'),
          },
          {
            boundaryType: 'congressional',
            provider: 'state-redistricting',
            releaseDate: new Date('2022-01-15'),
          },
        ];

        const resolved = resolveAuthorityConflict(boundaries);

        expect(resolved.boundary.provider).toBe('state-redistricting-commission');
        expect(resolved.preference).toBe(1);
      });
    });

    describe('Same preference: fresher data wins', () => {
      it('should prefer newer TIGER data when authority/preference equal', () => {
        const boundaries: BoundaryWithSource[] = [
          {
            boundaryType: 'county',
            provider: 'census-tiger',
            releaseDate: new Date('2023-07-01'),
          },
          {
            boundaryType: 'county',
            provider: 'census-tiger',
            releaseDate: new Date('2024-07-01'),
          },
        ];

        const resolved = resolveAuthorityConflict(boundaries, new Date('2024-09-01'));

        expect(resolved.boundary.provider).toBe('census-tiger');
        expect(resolved.boundary.releaseDate).toEqual(new Date('2024-07-01'));
        expect(resolved.reasoning).toContain('fresher');
      });

      it('should prefer recent state commission over older commission data', () => {
        const boundaries: BoundaryWithSource[] = [
          {
            boundaryType: 'congressional',
            provider: 'state-redistricting-commission',
            releaseDate: new Date('2021-12-15'),
          },
          {
            boundaryType: 'congressional',
            provider: 'state-redistricting-commission',
            releaseDate: new Date('2022-01-15'),
          },
        ];

        const resolved = resolveAuthorityConflict(boundaries, new Date('2022-03-01'));

        expect(resolved.boundary.releaseDate).toEqual(new Date('2022-01-15'));
      });
    });

    describe('Complex scenarios', () => {
      it('should handle 3+ sources correctly', () => {
        const boundaries: BoundaryWithSource[] = [
          {
            boundaryType: 'congressional',
            provider: 'census-tiger',
            releaseDate: new Date('2024-07-01'),
          },
          {
            boundaryType: 'congressional',
            provider: 'state-redistricting-commission',
            releaseDate: new Date('2022-01-15'),
          },
          {
            boundaryType: 'congressional',
            provider: 'state-gis',
            releaseDate: new Date('2024-06-01'),
          },
          {
            boundaryType: 'congressional',
            provider: 'arcgis-hub',
            releaseDate: new Date('2024-08-01'),
          },
        ];

        const resolved = resolveAuthorityConflict(boundaries, new Date('2024-09-01'));

        // State commission has highest preference despite older data
        expect(resolved.boundary.provider).toBe('state-redistricting-commission');
        expect(resolved.candidates.length).toBe(4);
      });

      it('should score candidates deterministically', () => {
        const boundaries: BoundaryWithSource[] = [
          {
            boundaryType: 'congressional',
            provider: 'census-tiger',
            releaseDate: new Date('2024-07-01'),
          },
          {
            boundaryType: 'congressional',
            provider: 'state-redistricting-commission',
            releaseDate: new Date('2022-01-15'),
          },
        ];

        const resolved1 = resolveAuthorityConflict(boundaries, new Date('2024-09-01'));
        const resolved2 = resolveAuthorityConflict(boundaries, new Date('2024-09-01'));

        expect(resolved1.boundary.provider).toBe(resolved2.boundary.provider);
        expect(resolved1.candidates.length).toBe(resolved2.candidates.length);
      });
    });
  });

  describe('resolveAuthorityConflict', () => {
    it('should throw for empty boundaries array', () => {
      expect(() => resolveAuthorityConflict([])).toThrow('No boundaries provided');
    });

    it('should handle single boundary without conflict', () => {
      const boundaries: BoundaryWithSource[] = [
        {
          boundaryType: 'congressional',
          provider: 'census-tiger',
          releaseDate: new Date('2024-07-01'),
        },
      ];

      const resolved = resolveAuthorityConflict(boundaries);

      expect(resolved.boundary.provider).toBe('census-tiger');
      expect(resolved.reasoning).toContain('Single source');
      expect(resolved.candidates.length).toBe(0);
    });

    it('should include all candidates in result', () => {
      const boundaries: BoundaryWithSource[] = [
        {
          boundaryType: 'congressional',
          provider: 'census-tiger',
          releaseDate: new Date('2024-07-01'),
        },
        {
          boundaryType: 'congressional',
          provider: 'state-redistricting-commission',
          releaseDate: new Date('2022-01-15'),
        },
        {
          boundaryType: 'congressional',
          provider: 'state-gis',
          releaseDate: new Date('2024-06-01'),
        },
      ];

      const resolved = resolveAuthorityConflict(boundaries);

      expect(resolved.candidates.length).toBe(3);
      expect(resolved.candidates.every((c) => c.boundary)).toBe(true);
      expect(resolved.candidates.every((c) => c.authority !== undefined)).toBe(true);
      expect(resolved.candidates.every((c) => c.preference !== undefined)).toBe(true);
    });

    it('should calculate confidence', () => {
      const boundaries: BoundaryWithSource[] = [
        {
          boundaryType: 'congressional',
          provider: 'census-tiger',
          releaseDate: new Date('2024-07-01'),
        },
        {
          boundaryType: 'congressional',
          provider: 'arcgis-hub',
          releaseDate: new Date('2024-07-01'),
        },
      ];

      const resolved = resolveAuthorityConflict(boundaries);

      // Large authority gap → high confidence
      expect(resolved.confidence).toBeGreaterThan(0.7);
      expect(resolved.confidence).toBeLessThanOrEqual(1.0);
    });

    it('should have lower confidence when sources are close', () => {
      const boundaries: BoundaryWithSource[] = [
        {
          boundaryType: 'congressional',
          provider: 'state-redistricting-commission',
          releaseDate: new Date('2022-01-15'),
        },
        {
          boundaryType: 'congressional',
          provider: 'census-tiger',
          releaseDate: new Date('2022-07-01'),
        },
      ];

      const resolved = resolveAuthorityConflict(boundaries, new Date('2022-09-01'));

      // Same authority, close preference → moderate confidence
      expect(resolved.confidence).toBeGreaterThan(0.0);
      expect(resolved.confidence).toBeLessThan(1.0);
    });
  });

  describe('resolveAuthorityConflictForType', () => {
    it('should filter by boundary type', () => {
      const boundaries: BoundaryWithSource[] = [
        {
          boundaryType: 'congressional',
          provider: 'census-tiger',
          releaseDate: new Date('2024-07-01'),
        },
        {
          boundaryType: 'county',
          provider: 'census-tiger',
          releaseDate: new Date('2024-07-01'),
        },
        {
          boundaryType: 'congressional',
          provider: 'state-redistricting-commission',
          releaseDate: new Date('2022-01-15'),
        },
      ];

      const resolved = resolveAuthorityConflictForType(
        boundaries,
        'congressional',
        new Date('2024-09-01')
      );

      expect(resolved).not.toBeNull();
      expect(resolved!.boundary.boundaryType).toBe('congressional');
      expect(resolved!.candidates.length).toBe(2);
    });

    it('should return null when no boundaries of type', () => {
      const boundaries: BoundaryWithSource[] = [
        {
          boundaryType: 'county',
          provider: 'census-tiger',
          releaseDate: new Date('2024-07-01'),
        },
      ];

      const resolved = resolveAuthorityConflictForType(boundaries, 'congressional');

      expect(resolved).toBeNull();
    });
  });

  describe('Utility functions', () => {
    describe('getAvailableSources', () => {
      it('should return sources in precedence order for congressional', () => {
        const sources = getAvailableSources('congressional');

        expect(sources.length).toBeGreaterThan(0);
        expect(sources[0]).toBe('state-redistricting-commission');
      });

      it('should return sources for county', () => {
        const sources = getAvailableSources('county');

        expect(sources.length).toBeGreaterThan(0);
        expect(sources[0]).toBe('census-tiger');
      });
    });

    describe('isPreferredSource', () => {
      it('should return true for highest-preference source', () => {
        expect(isPreferredSource('congressional', 'state-redistricting-commission')).toBe(true);
        expect(isPreferredSource('county', 'census-tiger')).toBe(true);
      });

      it('should return false for lower-preference sources', () => {
        expect(isPreferredSource('congressional', 'census-tiger')).toBe(false);
        expect(isPreferredSource('congressional', 'state-gis')).toBe(false);
      });
    });

    describe('compareSources', () => {
      it('should return negative when source1 has lower preference', () => {
        const result = compareSources(
          'congressional',
          'state-redistricting-commission',
          'census-tiger'
        );

        expect(result).toBeLessThan(0);
      });

      it('should return positive when source1 has higher preference number', () => {
        const result = compareSources(
          'congressional',
          'census-tiger',
          'state-redistricting-commission'
        );

        expect(result).toBeGreaterThan(0);
      });

      it('should return zero when sources are equal', () => {
        const result = compareSources(
          'congressional',
          'census-tiger',
          'census-tiger'
        );

        expect(result).toBe(0);
      });

      it('should handle unknown sources', () => {
        const result = compareSources(
          'congressional',
          'census-tiger',
          'osm' as any
        );

        expect(typeof result).toBe('number');
      });
    });
  });

  describe('Freshness scoring', () => {
    it('should score fresh data higher', () => {
      const boundaries: BoundaryWithSource[] = [
        {
          boundaryType: 'county',
          provider: 'census-tiger',
          releaseDate: new Date('2023-07-01'),
        },
        {
          boundaryType: 'county',
          provider: 'census-tiger',
          releaseDate: new Date('2024-07-01'),
        },
      ];

      const resolved = resolveAuthorityConflict(boundaries, new Date('2024-08-01'));

      expect(resolved.boundary.releaseDate).toEqual(new Date('2024-07-01'));
    });

    it('should account for data age', () => {
      const boundaries: BoundaryWithSource[] = [
        {
          boundaryType: 'county',
          provider: 'census-tiger',
          releaseDate: new Date('2020-07-01'),
        },
        {
          boundaryType: 'county',
          provider: 'census-tiger',
          releaseDate: new Date('2024-07-01'),
        },
      ];

      const resolved = resolveAuthorityConflict(boundaries, new Date('2024-09-01'));

      // 2024 data much fresher
      expect(resolved.boundary.releaseDate).toEqual(new Date('2024-07-01'));
      expect(resolved.reasoning).toContain('fresh');
    });
  });

  describe('Edge cases', () => {
    it('should handle boundaries with geometry', () => {
      const boundaries: BoundaryWithSource[] = [
        {
          boundaryType: 'congressional',
          provider: 'census-tiger',
          releaseDate: new Date('2024-07-01'),
          geometry: { type: 'Polygon', coordinates: [] },
        },
      ];

      const resolved = resolveAuthorityConflict(boundaries);

      expect(resolved.boundary.geometry).toBeDefined();
    });

    it('should handle boundaries with properties', () => {
      const boundaries: BoundaryWithSource[] = [
        {
          boundaryType: 'congressional',
          provider: 'census-tiger',
          releaseDate: new Date('2024-07-01'),
          properties: { name: 'District 1' },
        },
      ];

      const resolved = resolveAuthorityConflict(boundaries);

      expect(resolved.boundary.properties).toBeDefined();
    });

    it('should handle very old data', () => {
      const boundaries: BoundaryWithSource[] = [
        {
          boundaryType: 'county',
          provider: 'census-tiger',
          releaseDate: new Date('2010-07-01'),
        },
      ];

      const resolved = resolveAuthorityConflict(boundaries, new Date('2024-09-01'));

      expect(resolved.boundary.provider).toBe('census-tiger');
      expect(resolved.reasoning).toBe('Single source available (no conflict)');
      expect(resolved.confidence).toBe(1.0);
    });

    it('should handle future release dates gracefully', () => {
      const boundaries: BoundaryWithSource[] = [
        {
          boundaryType: 'congressional',
          provider: 'census-tiger',
          releaseDate: new Date('2025-07-01'),
        },
      ];

      const resolved = resolveAuthorityConflict(boundaries, new Date('2024-09-01'));

      expect(resolved.boundary.provider).toBe('census-tiger');
    });
  });
});
