/**
 * Boundary Resolver Tests
 *
 * Comprehensive test suite for hierarchical address resolution.
 * Tests caching, precision ordering, temporal validity, and error handling.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BoundaryResolver,
  InMemoryBoundaryDataSource,
  MockGeocoder,
  ResolutionError,
  DEFAULT_RESOLVER_CONFIG,
  type AddressInput,
  type GeocodeResult,
} from '../../../services/boundary-resolver.js';
import type {
  BoundaryGeometry,
  BoundaryType,
  ProvenanceRecord,
} from '../types/boundary.js';

/**
 * Helper to create test boundary
 */
function createTestBoundary(
  id: string,
  type: BoundaryType,
  name: string,
  bbox: [number, number, number, number]
): BoundaryGeometry {
  const [minLon, minLat, maxLon, maxLat] = bbox;

  return {
    metadata: {
      id,
      type,
      name,
      jurisdiction: `Test Jurisdiction (${type})`,
      provenance: {
        source: 'test',
        sourceUrl: 'https://test.example.com',
        retrievedAt: new Date('2024-01-01'),
        dataVersion: '1.0',
        license: 'Public Domain',
        processingSteps: [],
      } as ProvenanceRecord,
      validFrom: new Date('2020-01-01'),
    },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [minLon, minLat],
          [maxLon, minLat],
          [maxLon, maxLat],
          [minLon, maxLat],
          [minLon, minLat],
        ],
      ],
    },
    bbox,
  };
}

describe('BoundaryResolver', () => {
  let resolver: BoundaryResolver;
  let geocoder: MockGeocoder;
  let dataSource: InMemoryBoundaryDataSource;

  beforeEach(() => {
    geocoder = new MockGeocoder();
    dataSource = new InMemoryBoundaryDataSource();

    resolver = new BoundaryResolver(geocoder, dataSource, {
      cacheTTLSeconds: 3600, // 1 hour for tests
      maxCacheEntries: 100,
      minGeocodeConfidence: 80,
      resolveAllBoundaries: true,
      boundaryTypes: [],
    });
  });

  describe('resolve()', () => {
    it('should resolve address to boundaries', async () => {
      // Setup geocoder
      const address: AddressInput = {
        street: '123 Main St',
        city: 'Seattle',
        state: 'WA',
        zip: '98101',
      };

      geocoder.addResult(address, {
        coordinates: { lat: 47.6, lng: -122.33 },
        confidence: 95,
        source: 'test',
        matchType: 'exact',
      });

      // Setup boundaries (nested hierarchy)
      const county = createTestBoundary(
        'king-county',
        'county' as BoundaryType,
        'King County',
        [-123, 47, -121, 48]
      );

      const city = createTestBoundary(
        'seattle',
        'city_limits' as BoundaryType,
        'Seattle',
        [-122.5, 47.4, -122.2, 47.8]
      );

      const district = createTestBoundary(
        'district-7',
        'city_council_district' as BoundaryType,
        'District 7',
        [-122.4, 47.55, -122.25, 47.65]
      );

      dataSource.addBoundaries([county, city, district]);

      // Resolve
      const result = await resolver.resolve(address);

      expect(result.geocode.confidence).toBe(95);
      expect(result.boundaries).toHaveLength(3);

      // Should be sorted by precision (finest first)
      expect(result.boundaries[0].precision).toBe('city_council_district');
      expect(result.boundaries[1].precision).toBe('city_limits');
      expect(result.boundaries[2].precision).toBe('county');

      // Finest should be district
      expect(result.finest?.boundary.id).toBe('district-7');
    });

    it('should return cached result on second call', async () => {
      const address: AddressInput = {
        street: '123 Main St',
        city: 'Seattle',
        state: 'WA',
      };

      geocoder.addResult(address, {
        coordinates: { lat: 47.6, lng: -122.33 },
        confidence: 95,
        source: 'test',
        matchType: 'exact',
      });

      const boundary = createTestBoundary(
        'test',
        'county' as BoundaryType,
        'Test County',
        [-123, 47, -121, 48]
      );

      dataSource.addBoundary(boundary);

      // First call
      const result1 = await resolver.resolve(address);
      expect(result1.cached).toBe(false);

      // Second call
      const result2 = await resolver.resolve(address);
      expect(result2.cached).toBe(true);
    });

    it('should throw on geocode failure', async () => {
      const address: AddressInput = {
        street: '123 Unknown St',
        city: 'Nowhere',
        state: 'XX',
      };

      // No geocode result added

      await expect(resolver.resolve(address)).rejects.toThrow(ResolutionError);
      await expect(resolver.resolve(address)).rejects.toMatchObject({
        code: 'GEOCODE_FAILED',
      });
    });

    it('should throw on low geocode confidence', async () => {
      const address: AddressInput = {
        street: '123 Ambiguous St',
        city: 'Seattle',
        state: 'WA',
      };

      geocoder.addResult(address, {
        coordinates: { lat: 47.6, lng: -122.33 },
        confidence: 50, // Below threshold
        source: 'test',
        matchType: 'centroid',
      });

      await expect(resolver.resolve(address)).rejects.toThrow(ResolutionError);
      await expect(resolver.resolve(address)).rejects.toMatchObject({
        code: 'LOW_CONFIDENCE',
      });
    });
  });

  describe('resolveCoordinates()', () => {
    it('should resolve coordinates without geocoding', async () => {
      const district = createTestBoundary(
        'district-1',
        'city_council_district' as BoundaryType,
        'District 1',
        [-122.4, 47.5, -122.3, 47.6]
      );

      dataSource.addBoundary(district);

      const resolutions = await resolver.resolveCoordinates({
        lat: 47.55,
        lng: -122.35,
      });

      expect(resolutions).toHaveLength(1);
      expect(resolutions[0].boundary.id).toBe('district-1');
    });

    it('should return empty array for point outside all boundaries', async () => {
      const district = createTestBoundary(
        'district-1',
        'city_council_district' as BoundaryType,
        'District 1',
        [-122.4, 47.5, -122.3, 47.6]
      );

      dataSource.addBoundary(district);

      const resolutions = await resolver.resolveCoordinates({
        lat: 40.0, // Far from Seattle
        lng: -100.0,
      });

      expect(resolutions).toHaveLength(0);
    });

    it('should filter by temporal validity', async () => {
      // Expired boundary
      const expiredBoundary: BoundaryGeometry = {
        ...createTestBoundary(
          'expired',
          'county' as BoundaryType,
          'Expired County',
          [-123, 47, -121, 48]
        ),
        metadata: {
          ...createTestBoundary(
            'expired',
            'county' as BoundaryType,
            'Expired',
            [-123, 47, -121, 48]
          ).metadata,
          validFrom: new Date('2010-01-01'),
          validUntil: new Date('2020-01-01'), // Expired
        },
      };

      // Valid boundary
      const validBoundary = createTestBoundary(
        'valid',
        'county' as BoundaryType,
        'Valid County',
        [-123, 47, -121, 48]
      );

      dataSource.addBoundaries([expiredBoundary, validBoundary]);

      const resolutions = await resolver.resolveCoordinates({
        lat: 47.5,
        lng: -122,
      });

      // Should only include valid boundary
      expect(resolutions).toHaveLength(1);
      expect(resolutions[0].boundary.id).toBe('valid');
    });
  });

  describe('getFinestBoundary()', () => {
    it('should return finest boundary only', async () => {
      const county = createTestBoundary(
        'county',
        'county' as BoundaryType,
        'County',
        [-123, 47, -121, 48]
      );

      const district = createTestBoundary(
        'district',
        'city_council_district' as BoundaryType,
        'District',
        [-122.4, 47.5, -122.3, 47.6]
      );

      dataSource.addBoundaries([county, district]);

      const finest = await resolver.getFinestBoundary({
        lat: 47.55,
        lng: -122.35,
      });

      expect(finest).not.toBeNull();
      expect(finest?.boundary.id).toBe('district');
      expect(finest?.precision).toBe('city_council_district');
    });

    it('should return null for no match', async () => {
      const district = createTestBoundary(
        'district',
        'city_council_district' as BoundaryType,
        'District',
        [-122.4, 47.5, -122.3, 47.6]
      );

      dataSource.addBoundary(district);

      const finest = await resolver.getFinestBoundary({
        lat: 0,
        lng: 0,
      });

      expect(finest).toBeNull();
    });
  });

  describe('getBoundaryAtPrecision()', () => {
    it('should return boundary at specific precision', async () => {
      const county = createTestBoundary(
        'county',
        'county' as BoundaryType,
        'County',
        [-123, 47, -121, 48]
      );

      const district = createTestBoundary(
        'district',
        'city_council_district' as BoundaryType,
        'District',
        [-122.4, 47.5, -122.3, 47.6]
      );

      dataSource.addBoundaries([county, district]);

      // Get county (skipping district)
      const countyResult = await resolver.getBoundaryAtPrecision(
        { lat: 47.55, lng: -122.35 },
        'county' as BoundaryType
      );

      expect(countyResult).not.toBeNull();
      expect(countyResult?.boundary.id).toBe('county');
    });

    it('should return null if precision level not found', async () => {
      const county = createTestBoundary(
        'county',
        'county' as BoundaryType,
        'County',
        [-123, 47, -121, 48]
      );

      dataSource.addBoundary(county);

      const result = await resolver.getBoundaryAtPrecision(
        { lat: 47.55, lng: -122.35 },
        'city_council_district' as BoundaryType
      );

      expect(result).toBeNull();
    });
  });

  describe('caching', () => {
    it('should evict oldest entries when cache is full', async () => {
      // Create resolver with small cache
      const smallCacheResolver = new BoundaryResolver(geocoder, dataSource, {
        cacheTTLSeconds: 3600,
        maxCacheEntries: 2,
        minGeocodeConfidence: 80,
        resolveAllBoundaries: true,
        boundaryTypes: [],
      });

      const boundary = createTestBoundary(
        'test',
        'county' as BoundaryType,
        'Test',
        [-123, 47, -121, 48]
      );

      dataSource.addBoundary(boundary);

      // Add 3 addresses
      for (let i = 0; i < 3; i++) {
        const address: AddressInput = {
          street: `${i} Main St`,
          city: 'Seattle',
          state: 'WA',
        };

        geocoder.addResult(address, {
          coordinates: { lat: 47.5, lng: -122 },
          confidence: 95,
          source: 'test',
          matchType: 'exact',
        });

        await smallCacheResolver.resolve(address);
      }

      // Cache should have evicted oldest entry
      const stats = smallCacheResolver.getCacheStats();
      expect(stats.entries).toBe(2); // Max is 2
    });

    it('should clear cache on clearCache()', async () => {
      const address: AddressInput = {
        street: '123 Main St',
        city: 'Seattle',
        state: 'WA',
      };

      geocoder.addResult(address, {
        coordinates: { lat: 47.5, lng: -122 },
        confidence: 95,
        source: 'test',
        matchType: 'exact',
      });

      const boundary = createTestBoundary(
        'test',
        'county' as BoundaryType,
        'Test',
        [-123, 47, -121, 48]
      );

      dataSource.addBoundary(boundary);

      await resolver.resolve(address);
      expect(resolver.getCacheStats().entries).toBe(1);

      resolver.clearCache();
      expect(resolver.getCacheStats().entries).toBe(0);
    });
  });

  describe('boundary type filtering', () => {
    it('should filter by configured boundary types', async () => {
      // Resolver that only looks for districts
      const districtOnlyResolver = new BoundaryResolver(geocoder, dataSource, {
        cacheTTLSeconds: 3600,
        maxCacheEntries: 100,
        minGeocodeConfidence: 80,
        resolveAllBoundaries: true,
        boundaryTypes: ['city_council_district' as BoundaryType],
      });

      const county = createTestBoundary(
        'county',
        'county' as BoundaryType,
        'County',
        [-123, 47, -121, 48]
      );

      const district = createTestBoundary(
        'district',
        'city_council_district' as BoundaryType,
        'District',
        [-122.4, 47.5, -122.3, 47.6]
      );

      dataSource.addBoundaries([county, district]);

      const resolutions = await districtOnlyResolver.resolveCoordinates({
        lat: 47.55,
        lng: -122.35,
      });

      // Should only include district, not county
      expect(resolutions).toHaveLength(1);
      expect(resolutions[0].precision).toBe('city_council_district');
    });
  });

  describe('hierarchical precision ordering', () => {
    it('should order all boundary types correctly', async () => {
      // Create boundaries at all precision levels
      const country = createTestBoundary(
        'us',
        'country' as BoundaryType,
        'United States',
        [-130, 20, -60, 50]
      );

      const state = createTestBoundary(
        'wa',
        'state_province' as BoundaryType,
        'Washington',
        [-125, 45, -116, 49]
      );

      const county = createTestBoundary(
        'king',
        'county' as BoundaryType,
        'King County',
        [-123, 47, -121, 48]
      );

      const city = createTestBoundary(
        'seattle',
        'city_limits' as BoundaryType,
        'Seattle',
        [-122.5, 47.4, -122.2, 47.8]
      );

      const district = createTestBoundary(
        'district-7',
        'city_council_district' as BoundaryType,
        'District 7',
        [-122.4, 47.55, -122.25, 47.65]
      );

      // Add in random order
      dataSource.addBoundaries([state, district, country, city, county]);

      const resolutions = await resolver.resolveCoordinates({
        lat: 47.6,
        lng: -122.33,
      });

      // Should be sorted: district → city → county → state → country
      expect(resolutions).toHaveLength(5);
      expect(resolutions[0].precision).toBe('city_council_district');
      expect(resolutions[1].precision).toBe('city_limits');
      expect(resolutions[2].precision).toBe('county');
      expect(resolutions[3].precision).toBe('state_province');
      expect(resolutions[4].precision).toBe('country');
    });
  });

  describe('InMemoryBoundaryDataSource', () => {
    it('should filter by bounding box', async () => {
      const seattle = createTestBoundary(
        'seattle',
        'city_limits' as BoundaryType,
        'Seattle',
        [-122.5, 47.4, -122.2, 47.8]
      );

      const sf = createTestBoundary(
        'sf',
        'city_limits' as BoundaryType,
        'San Francisco',
        [-122.6, 37.6, -122.3, 37.9]
      );

      dataSource.addBoundaries([seattle, sf]);

      // Point in Seattle area
      const candidates = await dataSource.getCandidateBoundaries({
        lat: 47.6,
        lng: -122.35,
      });

      expect(candidates).toHaveLength(1);
      expect(candidates[0].metadata.id).toBe('seattle');
    });

    it('should search by jurisdiction', async () => {
      const seattle = createTestBoundary(
        'seattle',
        'city_limits' as BoundaryType,
        'Seattle',
        [-122.5, 47.4, -122.2, 47.8]
      );

      seattle.metadata = {
        ...seattle.metadata,
        jurisdiction: 'Seattle, Washington, USA',
      };

      dataSource.addBoundary(seattle);

      const results = await dataSource.getBoundariesByJurisdiction('Washington');

      expect(results).toHaveLength(1);
      expect(results[0].metadata.id).toBe('seattle');
    });

    it('should get boundary by ID', async () => {
      const boundary = createTestBoundary(
        'test-id',
        'county' as BoundaryType,
        'Test',
        [-123, 47, -121, 48]
      );

      dataSource.addBoundary(boundary);

      const found = await dataSource.getBoundaryById('test-id');
      expect(found).not.toBeNull();
      expect(found?.metadata.name).toBe('Test');

      const notFound = await dataSource.getBoundaryById('nonexistent');
      expect(notFound).toBeNull();
    });
  });
});
