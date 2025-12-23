/**
 * State Batch Extractor Integration Tests
 *
 * Tests the integration between state batch extraction and authority resolution.
 *
 * Test Coverage:
 * 1. State batch boundary conversion to resolver format
 * 2. Authority resolution with state-redistricting-commission
 * 3. Authority resolution with state-gis
 * 4. State vs TIGER conflict resolution during redistricting gaps
 * 5. Batch resolution for multiple layers
 * 6. Edge cases and error handling
 */

import { describe, it, expect } from 'vitest';
import {
  convertStateBatchBoundary,
  resolveStateBatchConflict,
  resolveStateBatchVsTIGER,
  batchResolveStateSources,
  type StateBatchBoundary,
  type BoundaryWithSource,
} from '../../../provenance/authority-resolver.js';
import { AuthorityLevel } from '../../../provenance/tiger-authority-rules.js';

describe('State Batch Extractor Integration', () => {
  describe('convertStateBatchBoundary', () => {
    it('should convert state-redistricting-commission boundary correctly', () => {
      const stateBoundary: StateBatchBoundary = {
        id: '5501',
        name: 'Congressional District 1',
        layerType: 'congressional',
        geometry: { type: 'Polygon', coordinates: [] },
        source: {
          state: 'WI',
          portalName: 'Wisconsin LTSB',
          endpoint: 'https://gis-ltsb.hub.arcgis.com/...',
          authority: 'state-redistricting-commission',
          vintage: 2022,
          retrievedAt: '2025-12-17T00:00:00Z',
        },
        properties: {
          GEOID: '5501',
          DISTRICT: '1',
        },
      };

      const converted = convertStateBatchBoundary(stateBoundary);

      expect(converted.boundaryType).toBe('congressional');
      expect(converted.provider).toBe('state-redistricting-commission');
      expect(converted.releaseDate).toEqual(new Date('2022-01-15'));
      expect(converted.geometry).toBeDefined();
      expect(converted.properties?.id).toBe('5501');
      expect(converted.properties?.name).toBe('Congressional District 1');
      expect(converted.properties?.state).toBe('WI');
    });

    it('should convert state-gis boundary correctly', () => {
      const stateBoundary: StateBatchBoundary = {
        id: '4801',
        name: 'Congressional District 1',
        layerType: 'congressional',
        geometry: { type: 'MultiPolygon', coordinates: [] },
        source: {
          state: 'TX',
          portalName: 'Texas TNRIS',
          endpoint: 'https://tigerweb.geo.census.gov/...',
          authority: 'state-gis',
          vintage: 2024,
          retrievedAt: '2025-12-17T00:00:00Z',
        },
        properties: {
          CD: '01',
        },
      };

      const converted = convertStateBatchBoundary(stateBoundary);

      expect(converted.boundaryType).toBe('congressional');
      expect(converted.provider).toBe('state-gis');
      expect(converted.releaseDate).toEqual(new Date('2024-01-15'));
    });

    it('should convert all layer types correctly', () => {
      const layerTypes: Array<'congressional' | 'state_senate' | 'state_house' | 'county'> = [
        'congressional',
        'state_senate',
        'state_house',
        'county',
      ];

      for (const layerType of layerTypes) {
        const boundary: StateBatchBoundary = {
          id: '5501',
          name: 'Test District',
          layerType,
          geometry: { type: 'Polygon', coordinates: [] },
          source: {
            state: 'WI',
            portalName: 'Test Portal',
            endpoint: 'https://example.com',
            authority: 'state-gis',
            vintage: 2024,
            retrievedAt: '2025-12-17T00:00:00Z',
          },
          properties: {},
        };

        const converted = convertStateBatchBoundary(boundary);
        expect(converted.boundaryType).toBe(layerType);
      }
    });

    it('should preserve all source metadata in properties', () => {
      const stateBoundary: StateBatchBoundary = {
        id: '5501',
        name: 'District 1',
        layerType: 'congressional',
        geometry: { type: 'Polygon', coordinates: [] },
        source: {
          state: 'WI',
          portalName: 'Wisconsin LTSB',
          endpoint: 'https://example.com/layer/0',
          authority: 'state-redistricting-commission',
          vintage: 2022,
          retrievedAt: '2022-03-15T12:00:00Z',
        },
        properties: {
          GEOID: '5501',
          POPULATION: 750000,
        },
      };

      const converted = convertStateBatchBoundary(stateBoundary);

      expect(converted.properties?.state).toBe('WI');
      expect(converted.properties?.portalName).toBe('Wisconsin LTSB');
      expect(converted.properties?.endpoint).toBe('https://example.com/layer/0');
      expect(converted.properties?.retrievedAt).toBe('2022-03-15T12:00:00Z');
      expect(converted.properties?.GEOID).toBe('5501');
      expect(converted.properties?.POPULATION).toBe(750000);
    });
  });

  describe('resolveStateBatchConflict', () => {
    it('should prefer state-redistricting-commission over state-gis', () => {
      const boundaries: StateBatchBoundary[] = [
        {
          id: '5501',
          name: 'District 1 (Commission)',
          layerType: 'congressional',
          geometry: { type: 'Polygon', coordinates: [] },
          source: {
            state: 'WI',
            portalName: 'Wisconsin LTSB',
            endpoint: 'https://ltsb.example.com',
            authority: 'state-redistricting-commission',
            vintage: 2022,
            retrievedAt: '2025-12-17T00:00:00Z',
          },
          properties: {},
        },
        {
          id: '5501',
          name: 'District 1 (GIS)',
          layerType: 'congressional',
          geometry: { type: 'Polygon', coordinates: [] },
          source: {
            state: 'WI',
            portalName: 'Wisconsin GIS',
            endpoint: 'https://gis.example.com',
            authority: 'state-gis',
            vintage: 2022,
            retrievedAt: '2025-12-17T00:00:00Z',
          },
          properties: {},
        },
      ];

      const resolved = resolveStateBatchConflict(boundaries);

      expect(resolved.boundary.provider).toBe('state-redistricting-commission');
      expect(resolved.authority).toBe(AuthorityLevel.FEDERAL_MANDATE);
      expect(resolved.preference).toBe(1);
      // State commission (authority=5, pref=1) vs state-gis (authority=4, pref=4)
      // Wins on authority level
      expect(resolved.reasoning).toContain('Higher authority');
    });

    it('should prefer fresher data when authority equal', () => {
      const boundaries: StateBatchBoundary[] = [
        {
          id: '5501',
          name: 'District 1 (2022)',
          layerType: 'congressional',
          geometry: { type: 'Polygon', coordinates: [] },
          source: {
            state: 'WI',
            portalName: 'Wisconsin LTSB',
            endpoint: 'https://ltsb.example.com',
            authority: 'state-redistricting-commission',
            vintage: 2022,
            retrievedAt: '2025-12-17T00:00:00Z',
          },
          properties: {},
        },
        {
          id: '5501',
          name: 'District 1 (2024)',
          layerType: 'congressional',
          geometry: { type: 'Polygon', coordinates: [] },
          source: {
            state: 'WI',
            portalName: 'Wisconsin LTSB Updated',
            endpoint: 'https://ltsb.example.com/v2',
            authority: 'state-redistricting-commission',
            vintage: 2024,
            retrievedAt: '2025-12-17T00:00:00Z',
          },
          properties: {},
        },
      ];

      const resolved = resolveStateBatchConflict(boundaries, new Date('2024-06-01'));

      expect(resolved.boundary.releaseDate).toEqual(new Date('2024-01-15'));
      expect(resolved.reasoning).toContain('fresher');
    });

    it('should handle single boundary without conflict', () => {
      const boundaries: StateBatchBoundary[] = [
        {
          id: '5501',
          name: 'District 1',
          layerType: 'congressional',
          geometry: { type: 'Polygon', coordinates: [] },
          source: {
            state: 'WI',
            portalName: 'Wisconsin LTSB',
            endpoint: 'https://ltsb.example.com',
            authority: 'state-redistricting-commission',
            vintage: 2022,
            retrievedAt: '2025-12-17T00:00:00Z',
          },
          properties: {},
        },
      ];

      const resolved = resolveStateBatchConflict(boundaries);

      expect(resolved.boundary.provider).toBe('state-redistricting-commission');
      expect(resolved.reasoning).toContain('Single source');
      expect(resolved.confidence).toBe(1.0);
    });
  });

  describe('resolveStateBatchVsTIGER', () => {
    it('should prefer state commission over TIGER during redistricting gap', () => {
      const stateBoundary: StateBatchBoundary = {
        id: '5501',
        name: 'Congressional District 1',
        layerType: 'congressional',
        geometry: { type: 'Polygon', coordinates: [] },
        source: {
          state: 'WI',
          portalName: 'Wisconsin LTSB',
          endpoint: 'https://ltsb.example.com',
          authority: 'state-redistricting-commission',
          vintage: 2022,
          retrievedAt: '2022-03-01T00:00:00Z',
        },
        properties: {},
      };

      const tigerBoundary: BoundaryWithSource = {
        boundaryType: 'congressional',
        provider: 'census-tiger',
        releaseDate: new Date('2021-07-01'),
      };

      // Feb 2022: State has new data, TIGER still on 2021
      const resolved = resolveStateBatchVsTIGER(
        stateBoundary,
        tigerBoundary,
        new Date('2022-02-15')
      );

      expect(resolved.boundary.provider).toBe('state-redistricting-commission');
      expect(resolved.preference).toBe(1);
      expect(resolved.reasoning).toContain('higher preference');
    });

    it('should still prefer state commission even after TIGER updates', () => {
      const stateBoundary: StateBatchBoundary = {
        id: '5501',
        name: 'Congressional District 1',
        layerType: 'congressional',
        geometry: { type: 'Polygon', coordinates: [] },
        source: {
          state: 'WI',
          portalName: 'Wisconsin LTSB',
          endpoint: 'https://ltsb.example.com',
          authority: 'state-redistricting-commission',
          vintage: 2022,
          retrievedAt: '2022-03-01T00:00:00Z',
        },
        properties: {},
      };

      const tigerBoundary: BoundaryWithSource = {
        boundaryType: 'congressional',
        provider: 'census-tiger',
        releaseDate: new Date('2022-07-01'),
      };

      // September 2022: Both have 2022 data
      const resolved = resolveStateBatchVsTIGER(
        stateBoundary,
        tigerBoundary,
        new Date('2022-09-01')
      );

      // State commission still wins due to higher preference
      expect(resolved.boundary.provider).toBe('state-redistricting-commission');
      expect(resolved.preference).toBe(1);
    });

    it('should prefer TIGER when state source is state-gis (lower authority)', () => {
      const stateBoundary: StateBatchBoundary = {
        id: '4801',
        name: 'Congressional District 1',
        layerType: 'congressional',
        geometry: { type: 'Polygon', coordinates: [] },
        source: {
          state: 'TX',
          portalName: 'Texas TNRIS',
          endpoint: 'https://tnris.example.com',
          authority: 'state-gis',
          vintage: 2024,
          retrievedAt: '2024-01-01T00:00:00Z',
        },
        properties: {},
      };

      const tigerBoundary: BoundaryWithSource = {
        boundaryType: 'congressional',
        provider: 'census-tiger',
        releaseDate: new Date('2024-07-01'),
      };

      const resolved = resolveStateBatchVsTIGER(
        stateBoundary,
        tigerBoundary,
        new Date('2024-09-01')
      );

      // TIGER (pref=3) > state-gis (pref=4)
      expect(resolved.boundary.provider).toBe('census-tiger');
      expect(resolved.preference).toBe(3);
    });

    it('should throw when TIGER boundary is not from TIGER', () => {
      const stateBoundary: StateBatchBoundary = {
        id: '5501',
        name: 'District 1',
        layerType: 'congressional',
        geometry: { type: 'Polygon', coordinates: [] },
        source: {
          state: 'WI',
          portalName: 'Wisconsin LTSB',
          endpoint: 'https://ltsb.example.com',
          authority: 'state-redistricting-commission',
          vintage: 2022,
          retrievedAt: '2022-03-01T00:00:00Z',
        },
        properties: {},
      };

      const notTiger: BoundaryWithSource = {
        boundaryType: 'congressional',
        provider: 'arcgis-hub',
        releaseDate: new Date('2022-07-01'),
      };

      expect(() => resolveStateBatchVsTIGER(stateBoundary, notTiger)).toThrow(
        'Expected TIGER boundary'
      );
    });

    it('should throw when boundary types mismatch', () => {
      const stateBoundary: StateBatchBoundary = {
        id: '5501',
        name: 'Congressional District 1',
        layerType: 'congressional',
        geometry: { type: 'Polygon', coordinates: [] },
        source: {
          state: 'WI',
          portalName: 'Wisconsin LTSB',
          endpoint: 'https://ltsb.example.com',
          authority: 'state-redistricting-commission',
          vintage: 2022,
          retrievedAt: '2022-03-01T00:00:00Z',
        },
        properties: {},
      };

      const tigerCounty: BoundaryWithSource = {
        boundaryType: 'county',
        provider: 'census-tiger',
        releaseDate: new Date('2022-07-01'),
      };

      expect(() => resolveStateBatchVsTIGER(stateBoundary, tigerCounty)).toThrow(
        'Boundary type mismatch'
      );
    });

    it('should handle county boundaries correctly', () => {
      const stateBoundary: StateBatchBoundary = {
        id: '55025',
        name: 'Dane County',
        layerType: 'county',
        geometry: { type: 'Polygon', coordinates: [] },
        source: {
          state: 'WI',
          portalName: 'Wisconsin GIS',
          endpoint: 'https://gis.example.com',
          authority: 'state-gis',
          vintage: 2024,
          retrievedAt: '2024-01-01T00:00:00Z',
        },
        properties: {},
      };

      const tigerBoundary: BoundaryWithSource = {
        boundaryType: 'county',
        provider: 'census-tiger',
        releaseDate: new Date('2024-07-01'),
      };

      const resolved = resolveStateBatchVsTIGER(
        stateBoundary,
        tigerBoundary,
        new Date('2024-09-01')
      );

      // TIGER is preferred for counties (pref=1)
      expect(resolved.boundary.provider).toBe('census-tiger');
      expect(resolved.preference).toBe(1);
    });
  });

  describe('batchResolveStateSources', () => {
    it('should resolve all layers from state extraction', () => {
      const stateResult = {
        layers: [
          {
            layerType: 'congressional' as const,
            boundaries: [
              {
                id: '5501',
                name: 'District 1',
                layerType: 'congressional' as const,
                geometry: { type: 'Polygon', coordinates: [] },
                source: {
                  state: 'WI',
                  portalName: 'Wisconsin LTSB',
                  endpoint: 'https://ltsb.example.com',
                  authority: 'state-redistricting-commission' as const,
                  vintage: 2022,
                  retrievedAt: '2022-03-01T00:00:00Z',
                },
                properties: {},
              },
            ],
          },
          {
            layerType: 'state_senate' as const,
            boundaries: [
              {
                id: '5501',
                name: 'Senate District 1',
                layerType: 'state_senate' as const,
                geometry: { type: 'Polygon', coordinates: [] },
                source: {
                  state: 'WI',
                  portalName: 'Wisconsin LTSB',
                  endpoint: 'https://ltsb.example.com/senate',
                  authority: 'state-redistricting-commission' as const,
                  vintage: 2022,
                  retrievedAt: '2022-03-01T00:00:00Z',
                },
                properties: {},
              },
            ],
          },
        ],
      };

      const resolved = batchResolveStateSources(stateResult);

      expect(resolved.size).toBe(2);
      expect(resolved.get('congressional')?.boundary.provider).toBe(
        'state-redistricting-commission'
      );
      expect(resolved.get('state_senate')?.boundary.provider).toBe(
        'state-redistricting-commission'
      );
    });

    it('should include TIGER boundaries in resolution when provided', () => {
      const stateResult = {
        layers: [
          {
            layerType: 'congressional' as const,
            boundaries: [
              {
                id: '5501',
                name: 'District 1',
                layerType: 'congressional' as const,
                geometry: { type: 'Polygon', coordinates: [] },
                source: {
                  state: 'WI',
                  portalName: 'Wisconsin GIS',
                  endpoint: 'https://gis.example.com',
                  authority: 'state-gis' as const,
                  vintage: 2024,
                  retrievedAt: '2024-01-01T00:00:00Z',
                },
                properties: {},
              },
            ],
          },
        ],
      };

      const tigerBoundaries = new Map<string, BoundaryWithSource[]>([
        [
          'congressional',
          [
            {
              boundaryType: 'congressional',
              provider: 'census-tiger',
              releaseDate: new Date('2024-07-01'),
            },
          ],
        ],
      ]);

      const resolved = batchResolveStateSources(stateResult, tigerBoundaries);

      expect(resolved.size).toBe(1);
      // TIGER (pref=3) > state-gis (pref=4)
      expect(resolved.get('congressional')?.boundary.provider).toBe('census-tiger');
    });

    it('should skip empty layers', () => {
      const stateResult = {
        layers: [
          {
            layerType: 'congressional' as const,
            boundaries: [],
          },
          {
            layerType: 'state_senate' as const,
            boundaries: [
              {
                id: '5501',
                name: 'Senate District 1',
                layerType: 'state_senate' as const,
                geometry: { type: 'Polygon', coordinates: [] },
                source: {
                  state: 'WI',
                  portalName: 'Wisconsin LTSB',
                  endpoint: 'https://ltsb.example.com',
                  authority: 'state-redistricting-commission' as const,
                  vintage: 2022,
                  retrievedAt: '2022-03-01T00:00:00Z',
                },
                properties: {},
              },
            ],
          },
        ],
      };

      const resolved = batchResolveStateSources(stateResult);

      expect(resolved.size).toBe(1);
      expect(resolved.has('congressional')).toBe(false);
      expect(resolved.has('state_senate')).toBe(true);
    });

    it('should handle all four layer types', () => {
      const stateResult = {
        layers: [
          {
            layerType: 'congressional' as const,
            boundaries: [
              {
                id: '5501',
                name: 'Congressional District 1',
                layerType: 'congressional' as const,
                geometry: { type: 'Polygon', coordinates: [] },
                source: {
                  state: 'WI',
                  portalName: 'Test',
                  endpoint: 'https://test.com',
                  authority: 'state-gis' as const,
                  vintage: 2024,
                  retrievedAt: '2024-01-01T00:00:00Z',
                },
                properties: {},
              },
            ],
          },
          {
            layerType: 'state_senate' as const,
            boundaries: [
              {
                id: '5501',
                name: 'State Senate District 1',
                layerType: 'state_senate' as const,
                geometry: { type: 'Polygon', coordinates: [] },
                source: {
                  state: 'WI',
                  portalName: 'Test',
                  endpoint: 'https://test.com',
                  authority: 'state-gis' as const,
                  vintage: 2024,
                  retrievedAt: '2024-01-01T00:00:00Z',
                },
                properties: {},
              },
            ],
          },
          {
            layerType: 'state_house' as const,
            boundaries: [
              {
                id: '5501',
                name: 'State House District 1',
                layerType: 'state_house' as const,
                geometry: { type: 'Polygon', coordinates: [] },
                source: {
                  state: 'WI',
                  portalName: 'Test',
                  endpoint: 'https://test.com',
                  authority: 'state-gis' as const,
                  vintage: 2024,
                  retrievedAt: '2024-01-01T00:00:00Z',
                },
                properties: {},
              },
            ],
          },
          {
            layerType: 'county' as const,
            boundaries: [
              {
                id: '55025',
                name: 'Dane County',
                layerType: 'county' as const,
                geometry: { type: 'Polygon', coordinates: [] },
                source: {
                  state: 'WI',
                  portalName: 'Test',
                  endpoint: 'https://test.com',
                  authority: 'state-gis' as const,
                  vintage: 2024,
                  retrievedAt: '2024-01-01T00:00:00Z',
                },
                properties: {},
              },
            ],
          },
        ],
      };

      const resolved = batchResolveStateSources(stateResult);

      expect(resolved.size).toBe(4);
      expect(resolved.has('congressional')).toBe(true);
      expect(resolved.has('state_senate')).toBe(true);
      expect(resolved.has('state_house')).toBe(true);
      expect(resolved.has('county')).toBe(true);
    });
  });

  describe('Redistricting gap scenarios', () => {
    it('should correctly handle Jan 2022 scenario (commission has new maps, TIGER stale)', () => {
      const stateBoundary: StateBatchBoundary = {
        id: '5501',
        name: 'Congressional District 1',
        layerType: 'congressional',
        geometry: { type: 'Polygon', coordinates: [] },
        source: {
          state: 'WI',
          portalName: 'Wisconsin LTSB',
          endpoint: 'https://ltsb.example.com',
          authority: 'state-redistricting-commission',
          vintage: 2022,
          retrievedAt: '2022-01-15T00:00:00Z',
        },
        properties: {},
      };

      const tigerBoundary: BoundaryWithSource = {
        boundaryType: 'congressional',
        provider: 'census-tiger',
        releaseDate: new Date('2021-07-01'), // Still 2021 data
      };

      const resolved = resolveStateBatchVsTIGER(
        stateBoundary,
        tigerBoundary,
        new Date('2022-01-20')
      );

      // State commission wins: higher preference + fresher
      expect(resolved.boundary.provider).toBe('state-redistricting-commission');
      expect(resolved.preference).toBe(1);

      // Should have moderate confidence (older data but higher preference)
      expect(resolved.confidence).toBeGreaterThan(0.3);
      expect(resolved.confidence).toBeLessThan(0.7);
    });

    it('should correctly handle July 2022 scenario (both have 2022 data)', () => {
      const stateBoundary: StateBatchBoundary = {
        id: '5501',
        name: 'Congressional District 1',
        layerType: 'congressional',
        geometry: { type: 'Polygon', coordinates: [] },
        source: {
          state: 'WI',
          portalName: 'Wisconsin LTSB',
          endpoint: 'https://ltsb.example.com',
          authority: 'state-redistricting-commission',
          vintage: 2022,
          retrievedAt: '2022-01-15T00:00:00Z',
        },
        properties: {},
      };

      const tigerBoundary: BoundaryWithSource = {
        boundaryType: 'congressional',
        provider: 'census-tiger',
        releaseDate: new Date('2022-07-01'), // Now updated
      };

      const resolved = resolveStateBatchVsTIGER(
        stateBoundary,
        tigerBoundary,
        new Date('2022-08-01')
      );

      // State commission still wins: higher preference (same vintage)
      expect(resolved.boundary.provider).toBe('state-redistricting-commission');
      expect(resolved.preference).toBe(1);
    });

    it('should correctly handle normal period (no redistricting)', () => {
      const stateBoundary: StateBatchBoundary = {
        id: '5501',
        name: 'Congressional District 1',
        layerType: 'congressional',
        geometry: { type: 'Polygon', coordinates: [] },
        source: {
          state: 'WI',
          portalName: 'Wisconsin LTSB',
          endpoint: 'https://ltsb.example.com',
          authority: 'state-redistricting-commission',
          vintage: 2024,
          retrievedAt: '2024-01-01T00:00:00Z',
        },
        properties: {},
      };

      const tigerBoundary: BoundaryWithSource = {
        boundaryType: 'congressional',
        provider: 'census-tiger',
        releaseDate: new Date('2024-07-01'),
      };

      const resolved = resolveStateBatchVsTIGER(
        stateBoundary,
        tigerBoundary,
        new Date('2024-09-01')
      );

      // State commission wins: always higher preference for legislative boundaries
      expect(resolved.boundary.provider).toBe('state-redistricting-commission');
    });
  });

  describe('Edge cases', () => {
    it('should handle boundaries with complex geometry', () => {
      const boundary: StateBatchBoundary = {
        id: '5501',
        name: 'District 1',
        layerType: 'congressional',
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [
              [
                [-90.0, 45.0],
                [-89.0, 45.0],
                [-89.0, 44.0],
                [-90.0, 44.0],
                [-90.0, 45.0],
              ],
            ],
          ],
        },
        source: {
          state: 'WI',
          portalName: 'Wisconsin LTSB',
          endpoint: 'https://ltsb.example.com',
          authority: 'state-redistricting-commission',
          vintage: 2022,
          retrievedAt: '2022-03-01T00:00:00Z',
        },
        properties: {},
      };

      const converted = convertStateBatchBoundary(boundary);

      expect(converted.geometry).toBeDefined();
      expect(converted.geometry).toEqual(boundary.geometry);
    });

    it('should handle boundaries with extensive properties', () => {
      const boundary: StateBatchBoundary = {
        id: '5501',
        name: 'District 1',
        layerType: 'congressional',
        geometry: { type: 'Polygon', coordinates: [] },
        source: {
          state: 'WI',
          portalName: 'Wisconsin LTSB',
          endpoint: 'https://ltsb.example.com',
          authority: 'state-redistricting-commission',
          vintage: 2022,
          retrievedAt: '2022-03-01T00:00:00Z',
        },
        properties: {
          GEOID: '5501',
          DISTRICT: '1',
          POPULATION: 750000,
          AREA_SQ_MI: 5000,
          PERIMETER: 500,
          PARTISAN_SCORE: 0.52,
          COMPACTNESS: 0.85,
        },
      };

      const converted = convertStateBatchBoundary(boundary);

      expect(converted.properties?.POPULATION).toBe(750000);
      expect(converted.properties?.AREA_SQ_MI).toBe(5000);
      expect(converted.properties?.PARTISAN_SCORE).toBe(0.52);
      expect(converted.properties?.COMPACTNESS).toBe(0.85);
    });
  });
});
