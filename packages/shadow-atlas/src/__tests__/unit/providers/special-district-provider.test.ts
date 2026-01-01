/**
 * Special District Provider Tests
 *
 * Tests for the abstract SpecialDistrictProvider base class
 * and the CaliforniaFireDistrictsProvider example implementation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FeatureCollection, Polygon } from 'geojson';
import type { ProviderSourceMetadata, DownloadParams } from '../../../core/types/index.js';
import {
  SpecialDistrictProvider,
  CaliforniaFireDistrictsProvider,
  SPECIAL_DISTRICT_PROVIDERS,
  SPECIAL_DISTRICT_PRIORITY,
  getSpecialDistrictProvider,
  registerSpecialDistrictProvider,
  getProvidersForState,
  getProvidersByType,
  getDistrictTypesForState,
  type SpecialDistrictType,
  type SpecialDistrictMetadata,
  type NormalizedSpecialDistrict,
  type GovernanceType,
} from '../../../providers/special-district-provider.js';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Sample GeoJSON for testing
 */
const SAMPLE_GEOJSON: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        DIST_NAME: 'Metro Fire District',
        COUNTY: 'Sacramento',
        ACRES: 12500,
        DIST_TYPE: 'independent',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-121.5, 38.5],
          [-121.4, 38.5],
          [-121.4, 38.6],
          [-121.5, 38.6],
          [-121.5, 38.5],
        ]],
      } as Polygon,
    },
    {
      type: 'Feature',
      properties: {
        NAME: 'Rural Fire Protection',
        COUNTY: 'Placer',
        FORMATION: '1952',
        TYPE: 'dependent',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-121.0, 39.0],
          [-120.9, 39.0],
          [-120.9, 39.1],
          [-121.0, 39.1],
          [-121.0, 39.0],
        ]],
      } as Polygon,
    },
  ],
};

/**
 * Mock implementation of SpecialDistrictProvider for testing abstract class
 */
class MockSpecialDistrictProvider extends SpecialDistrictProvider {
  readonly name = 'Mock Special District Provider';
  readonly source = 'https://mock.example.com/districts';
  readonly stateFips = '99';
  readonly districtType = 'water' as const;

  private mockGeojson: FeatureCollection;

  constructor(geojson: FeatureCollection = SAMPLE_GEOJSON) {
    super({ cacheDir: '/tmp/mock-cache' });
    this.mockGeojson = geojson;
  }

  protected getSourceUrl(): string {
    return 'https://mock.example.com/api/districts.geojson';
  }

  protected parseFeatures(
    featureCollection: FeatureCollection
  ): NormalizedSpecialDistrict[] {
    return featureCollection.features.map((feature, index) => {
      const props = feature.properties ?? {};
      const name = (props['NAME'] ?? `District ${index + 1}`) as string;
      const id = `${this.stateFips}WD${String(index + 1).padStart(5, '0')}`;

      const metadata: SpecialDistrictMetadata = {
        districtType: 'water',
        governanceType: 'appointed-board',
        services: ['water-supply', 'wastewater'],
      };

      return this.createNormalizedBoundary(
        id,
        name,
        feature.geometry,
        props,
        metadata
      );
    });
  }

  async getMetadata(): Promise<ProviderSourceMetadata> {
    return this.createBaseMetadata({
      provider: 'mock-provider',
      authorityLevel: 'state-agency',
    });
  }

  // Expose protected methods for testing
  public testGetSourceUrl(): string {
    return this.getSourceUrl();
  }

  public testParseFeatures(fc: FeatureCollection): NormalizedSpecialDistrict[] {
    return this.parseFeatures(fc);
  }

  public testCreateBaseMetadata(
    overrides?: Partial<ProviderSourceMetadata>
  ): ProviderSourceMetadata {
    return this.createBaseMetadata(overrides);
  }

  public getMockGeojson(): FeatureCollection {
    return this.mockGeojson;
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('SpecialDistrictProvider', () => {
  let mockProvider: MockSpecialDistrictProvider;

  beforeEach(() => {
    mockProvider = new MockSpecialDistrictProvider();
    // Clear any registered mock providers
    SPECIAL_DISTRICT_PROVIDERS.delete('99-water');
  });

  describe('class properties', () => {
    it('should have correct countryCode', () => {
      expect(mockProvider.countryCode).toBe('US');
    });

    it('should have correct updateSchedule', () => {
      expect(mockProvider.updateSchedule).toBe('annual');
    });

    it('should have district as only administrative level', () => {
      expect(mockProvider.administrativeLevels).toEqual(['district']);
    });

    it('should expose abstract properties through implementation', () => {
      expect(mockProvider.name).toBe('Mock Special District Provider');
      expect(mockProvider.source).toBe('https://mock.example.com/districts');
      expect(mockProvider.stateFips).toBe('99');
      expect(mockProvider.districtType).toBe('water');
    });
  });

  describe('getSourceUrl()', () => {
    it('should return the configured source URL', () => {
      expect(mockProvider.testGetSourceUrl()).toBe(
        'https://mock.example.com/api/districts.geojson'
      );
    });
  });

  describe('parseFeatures()', () => {
    it('should parse GeoJSON features into normalized boundaries', () => {
      const boundaries = mockProvider.testParseFeatures(SAMPLE_GEOJSON);

      expect(boundaries).toHaveLength(2);
      expect(boundaries[0].id).toBe('99WD00001');
      expect(boundaries[0].level).toBe('district');
      expect(boundaries[0].specialDistrictMetadata.districtType).toBe('water');
    });

    it('should include geometry in normalized boundaries', () => {
      const boundaries = mockProvider.testParseFeatures(SAMPLE_GEOJSON);

      expect(boundaries[0].geometry.type).toBe('Polygon');
    });

    it('should include properties in normalized boundaries', () => {
      const boundaries = mockProvider.testParseFeatures(SAMPLE_GEOJSON);

      expect(boundaries[0].properties.stateFips).toBe('99');
      expect(boundaries[0].properties.districtType).toBe('water');
    });
  });

  describe('createBaseMetadata()', () => {
    it('should create metadata with default values', () => {
      const metadata = mockProvider.testCreateBaseMetadata();

      expect(metadata.provider).toBe('Mock Special District Provider');
      expect(metadata.coordinateSystem).toBe('EPSG:4326');
      expect(metadata.authorityLevel).toBe('state-agency');
      expect(metadata.legalStatus).toBe('official');
    });

    it('should allow overriding default metadata values', () => {
      const metadata = mockProvider.testCreateBaseMetadata({
        license: 'MIT',
        authorityLevel: 'county-agency',
      });

      expect(metadata.license).toBe('MIT');
      expect(metadata.authorityLevel).toBe('county-agency');
    });
  });

  describe('transform()', () => {
    it('should transform raw boundary files to normalized districts', async () => {
      const rawFiles = [{
        url: 'https://example.com/test.geojson',
        format: 'geojson' as const,
        data: Buffer.from(JSON.stringify(SAMPLE_GEOJSON), 'utf-8'),
        metadata: {
          layer: 'water',
          stateFips: '99',
        },
      }];

      const boundaries = await mockProvider.transform(rawFiles);

      expect(boundaries).toHaveLength(2);
      expect(boundaries[0].specialDistrictMetadata).toBeDefined();
    });

    it('should handle empty feature collections', async () => {
      const emptyGeoJSON: FeatureCollection = {
        type: 'FeatureCollection',
        features: [],
      };

      const rawFiles = [{
        url: 'https://example.com/empty.geojson',
        format: 'geojson' as const,
        data: Buffer.from(JSON.stringify(emptyGeoJSON), 'utf-8'),
        metadata: {},
      }];

      const boundaries = await mockProvider.transform(rawFiles);

      expect(boundaries).toHaveLength(0);
    });

    it('should handle malformed JSON gracefully', async () => {
      const rawFiles = [{
        url: 'https://example.com/bad.geojson',
        format: 'geojson' as const,
        data: Buffer.from('not valid json', 'utf-8'),
        metadata: {},
      }];

      // Should not throw, just log error and return empty array
      const boundaries = await mockProvider.transform(rawFiles);

      expect(boundaries).toHaveLength(0);
    });
  });

  describe('getCivicPriority()', () => {
    it('should return priority score for district type', () => {
      const priority = mockProvider.getCivicPriority();

      expect(priority).toBe(SPECIAL_DISTRICT_PRIORITY.water);
      expect(priority).toBe(60);
    });
  });
});

describe('CaliforniaFireDistrictsProvider', () => {
  let provider: CaliforniaFireDistrictsProvider;

  beforeEach(() => {
    provider = new CaliforniaFireDistrictsProvider();
  });

  describe('class properties', () => {
    it('should have correct name', () => {
      expect(provider.name).toBe('California Fire Protection Districts');
    });

    it('should have correct source', () => {
      expect(provider.source).toContain('gis.data.ca.gov');
    });

    it('should have correct state FIPS for California', () => {
      expect(provider.stateFips).toBe('06');
    });

    it('should have fire as district type', () => {
      expect(provider.districtType).toBe('fire');
    });
  });

  describe('getMetadata()', () => {
    it('should return California-specific metadata', async () => {
      const metadata = await provider.getMetadata();

      expect(metadata.provider).toBe('california-state-gis');
      expect(metadata.authorityLevel).toBe('state-agency');
      expect(metadata.legalStatus).toBe('official');
    });
  });

  describe('getCivicPriority()', () => {
    it('should return high priority for fire districts', () => {
      const priority = provider.getCivicPriority();

      expect(priority).toBe(90);
      expect(priority).toBeGreaterThan(SPECIAL_DISTRICT_PRIORITY.water);
    });
  });
});

describe('SPECIAL_DISTRICT_PRIORITY', () => {
  it('should have fire districts as highest priority', () => {
    const priorities = Object.entries(SPECIAL_DISTRICT_PRIORITY);
    const sorted = priorities.sort((a, b) => b[1] - a[1]);

    expect(sorted[0][0]).toBe('fire');
  });

  it('should have all district types defined', () => {
    const districtTypes: SpecialDistrictType[] = [
      'fire', 'library', 'hospital', 'water', 'utility', 'transit',
      'park', 'cemetery', 'mosquito', 'flood', 'soil', 'airport',
    ];

    for (const type of districtTypes) {
      expect(SPECIAL_DISTRICT_PRIORITY[type]).toBeDefined();
      expect(typeof SPECIAL_DISTRICT_PRIORITY[type]).toBe('number');
    }
  });

  it('should have priorities in 0-100 range', () => {
    for (const [, priority] of Object.entries(SPECIAL_DISTRICT_PRIORITY)) {
      expect(priority).toBeGreaterThanOrEqual(0);
      expect(priority).toBeLessThanOrEqual(100);
    }
  });
});

describe('Provider Registry', () => {
  let mockProvider: MockSpecialDistrictProvider;

  beforeEach(() => {
    mockProvider = new MockSpecialDistrictProvider();
    // Clear test entries
    SPECIAL_DISTRICT_PROVIDERS.delete('99-water');
    SPECIAL_DISTRICT_PROVIDERS.delete('99-fire');
  });

  describe('SPECIAL_DISTRICT_PROVIDERS', () => {
    it('should have California fire districts pre-registered', () => {
      expect(SPECIAL_DISTRICT_PROVIDERS.has('06-fire')).toBe(true);
    });

    it('should return provider instance', () => {
      const provider = SPECIAL_DISTRICT_PROVIDERS.get('06-fire');

      expect(provider).toBeInstanceOf(CaliforniaFireDistrictsProvider);
    });
  });

  describe('getSpecialDistrictProvider()', () => {
    it('should return provider by state FIPS and district type', () => {
      const provider = getSpecialDistrictProvider('06', 'fire');

      expect(provider).toBeInstanceOf(CaliforniaFireDistrictsProvider);
    });

    it('should return undefined for unregistered provider', () => {
      const provider = getSpecialDistrictProvider('99', 'water');

      expect(provider).toBeUndefined();
    });
  });

  describe('registerSpecialDistrictProvider()', () => {
    it('should register a new provider', () => {
      registerSpecialDistrictProvider(mockProvider);

      const retrieved = getSpecialDistrictProvider('99', 'water');

      expect(retrieved).toBe(mockProvider);
    });

    it('should overwrite existing provider', () => {
      const firstProvider = new MockSpecialDistrictProvider();
      const secondProvider = new MockSpecialDistrictProvider();

      registerSpecialDistrictProvider(firstProvider);
      registerSpecialDistrictProvider(secondProvider);

      const retrieved = getSpecialDistrictProvider('99', 'water');

      expect(retrieved).toBe(secondProvider);
    });
  });

  describe('getProvidersForState()', () => {
    it('should return all providers for a state', () => {
      const caProviders = getProvidersForState('06');

      expect(caProviders.length).toBeGreaterThanOrEqual(1);
      expect(caProviders.some(p => p.districtType === 'fire')).toBe(true);
    });

    it('should return empty array for state with no providers', () => {
      const providers = getProvidersForState('99');

      expect(providers).toEqual([]);
    });
  });

  describe('getProvidersByType()', () => {
    it('should return all providers for a district type', () => {
      const fireProviders = getProvidersByType('fire');

      expect(fireProviders.length).toBeGreaterThanOrEqual(1);
      expect(fireProviders.every(p => p.districtType === 'fire')).toBe(true);
    });

    it('should return empty array for type with no providers', () => {
      const providers = getProvidersByType('mosquito');

      expect(providers).toEqual([]);
    });
  });

  describe('getDistrictTypesForState()', () => {
    it('should return all district types for a state', () => {
      const types = getDistrictTypesForState('06');

      expect(types).toContain('fire');
    });

    it('should return empty array for state with no providers', () => {
      const types = getDistrictTypesForState('99');

      expect(types).toEqual([]);
    });
  });
});

describe('GovernanceType', () => {
  it('should support all governance types in metadata', () => {
    const governanceTypes: GovernanceType[] = [
      'elected-board',
      'appointed-board',
      'mixed',
      'independent',
      'dependent',
    ];

    const metadata: SpecialDistrictMetadata = {
      districtType: 'fire',
      governanceType: 'elected-board',
    };

    for (const type of governanceTypes) {
      metadata.governanceType = type;
      expect(metadata.governanceType).toBe(type);
    }
  });
});

describe('NormalizedSpecialDistrict', () => {
  it('should extend NormalizedBoundary with specialDistrictMetadata', () => {
    const mockProvider = new MockSpecialDistrictProvider();
    const boundaries = mockProvider.testParseFeatures(SAMPLE_GEOJSON);

    const boundary = boundaries[0];

    // Standard NormalizedBoundary fields
    expect(boundary.id).toBeDefined();
    expect(boundary.name).toBeDefined();
    expect(boundary.level).toBe('district');
    expect(boundary.geometry).toBeDefined();
    expect(boundary.properties).toBeDefined();
    expect(boundary.source).toBeDefined();

    // Special district extension
    expect(boundary.specialDistrictMetadata).toBeDefined();
    expect(boundary.specialDistrictMetadata.districtType).toBe('water');
    expect(boundary.specialDistrictMetadata.services).toEqual(['water-supply', 'wastewater']);
  });
});

describe('Integration: Download and Transform', () => {
  it('should handle complete workflow with mocked fetch', async () => {
    const mockProvider = new MockSpecialDistrictProvider();

    // Mock fetch globally
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(SAMPLE_GEOJSON)),
    }) as typeof fetch;

    try {
      const params: DownloadParams = {
        level: 'district',
        forceRefresh: false,
      };

      const rawFiles = await mockProvider.download(params);

      expect(rawFiles).toHaveLength(1);
      expect(rawFiles[0].format).toBe('geojson');

      const boundaries = await mockProvider.transform(rawFiles);

      expect(boundaries).toHaveLength(2);
      expect(boundaries[0].specialDistrictMetadata.districtType).toBe('water');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('should retry on network failure', async () => {
    const mockProvider = new MockSpecialDistrictProvider();
    let attempts = 0;

    // Mock fetch with failures then success
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation(() => {
      attempts++;
      if (attempts < 3) {
        return Promise.reject(new Error('Network error'));
      }
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(SAMPLE_GEOJSON)),
      });
    }) as typeof fetch;

    try {
      const params: DownloadParams = {
        level: 'district',
      };

      const rawFiles = await mockProvider.download(params);

      expect(attempts).toBe(3);
      expect(rawFiles).toHaveLength(1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('should throw after max retries exceeded', async () => {
    const mockProvider = new MockSpecialDistrictProvider();

    // Mock fetch to always fail
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    try {
      const params: DownloadParams = {
        level: 'district',
      };

      await expect(mockProvider.download(params)).rejects.toThrow(
        /Download failed after \d+ attempts/
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});
