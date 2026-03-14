/**
 * US Country Provider Tests
 *
 * Tests the USCountryProvider with mocked API responses.
 *
 * Test Coverage:
 * 1. Provider metadata (country, dataSource, apiType, license)
 * 2. extractAll() with mocked TIGERweb ArcGIS responses
 * 3. CD layer URL verification — MapServer/54 (119th Congress)
 * 4. extractOfficials() with mocked YAML response
 * 5. GEOID resolution — officials matched to boundaries
 * 6. Territory delegate handling (is_voting=false)
 * 7. validate() Layer 3 — code resolution via GEOID
 * 8. CWC code generation (H + state + district)
 * 9. Party normalization
 * 10. Error handling — fetch failures
 * 11. Health check
 * 12. Boundary normalization
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  USCountryProvider,
  type USDistrict,
  type USOfficial,
} from '../../../../providers/international/us-provider.js';
import type { FeatureCollection } from 'geojson';

// ============================================================================
// Mock Data
// ============================================================================

function makeMockTIGERGeoJSON(districts: { geoid: string; name: string; stateFips: string }[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: districts.map(d => ({
      type: 'Feature' as const,
      properties: {
        GEOID: d.geoid,
        BASENAME: d.name,
        STATE: d.stateFips,
        CD119: d.geoid,
        NAMELSAD: d.name,
      },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [-77.0, 38.9],
            [-76.9, 38.9],
            [-76.9, 39.0],
            [-77.0, 39.0],
            [-77.0, 38.9],
          ],
        ],
      },
    })),
  };
}

/**
 * Minimal congress-legislators YAML for testing.
 * Includes a House member, a Senate member, and a territory delegate.
 */
const MOCK_LEGISLATORS_YAML = `
- id:
    bioguide: A000055
  name:
    first: Robert
    last: Aderholt
    official_full: Robert B. Aderholt
  bio:
    birthday: "1965-07-22"
    gender: M
  terms:
    - type: rep
      start: "2025-01-03"
      end: "2027-01-03"
      state: AL
      district: 4
      party: Republican
      url: https://aderholt.house.gov
      phone: "202-225-4876"
      contact_form: https://aderholt.house.gov/contact

- id:
    bioguide: B000944
  name:
    first: Sherrod
    last: Brown
  bio:
    birthday: "1952-11-09"
    gender: M
  terms:
    - type: sen
      start: "2025-01-03"
      end: "2031-01-03"
      state: OH
      class: 1
      party: Democrat
      url: https://brown.senate.gov
      phone: "202-224-2315"

- id:
    bioguide: N000147
  name:
    first: Eleanor
    last: Norton
    official_full: Eleanor Holmes Norton
  bio:
    birthday: "1937-06-13"
    gender: F
  terms:
    - type: rep
      start: "2025-01-03"
      end: "2027-01-03"
      state: DC
      district: 0
      party: Democrat
      url: https://norton.house.gov

- id:
    bioguide: S000033
  name:
    first: Bernard
    last: Sanders
    official_full: Bernard Sanders
  bio:
    birthday: "1941-09-08"
    gender: M
  terms:
    - type: sen
      start: "2025-01-03"
      end: "2031-01-03"
      state: VT
      class: 1
      party: Independent
      url: https://sanders.senate.gov
`;

// ============================================================================
// Test Suite
// ============================================================================

describe('USCountryProvider', () => {
  let provider: USCountryProvider;

  beforeEach(() => {
    provider = new USCountryProvider({ retryAttempts: 1, retryDelayMs: 10 });
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Provider Metadata
  // ==========================================================================

  describe('Provider metadata', () => {
    it('should have correct metadata', () => {
      expect(provider.country).toBe('US');
      expect(provider.countryName).toBe('United States');
      expect(provider.dataSource).toBe('US Census Bureau TIGER/Line + Congress Legislators');
      expect(provider.apiType).toBe('census-api');
      expect(provider.license).toBe('CC0-1.0');
    });

    it('should have congressional layer configured', () => {
      const cd = provider.layers.get('congressional');
      expect(cd).toBeDefined();
      expect(cd?.expectedCount).toBe(444);
      expect(cd?.updateSchedule).toBe('decennial');
      expect(cd?.authority).toBe('constitutional');
      expect(cd?.vintage).toBe(2024);
    });

    it('should have correct expected official counts', () => {
      expect(provider.expectedOfficialCounts.get('house')).toBe(435);
      expect(provider.expectedOfficialCounts.get('senate')).toBe(100);
      expect(provider.expectedOfficialCounts.get('delegates')).toBe(6);
    });
  });

  // ==========================================================================
  // CD Layer URL — MapServer/54 Verification
  // ==========================================================================

  describe('CD layer URL', () => {
    it('should use MapServer/54 for 119th Congress districts', () => {
      const cd = provider.layers.get('congressional');
      expect(cd?.endpoint).toContain('MapServer/54');
      expect(cd?.endpoint).not.toContain('MapServer/0');
    });

    it('should point to TIGERweb service', () => {
      const cd = provider.layers.get('congressional');
      expect(cd?.endpoint).toContain('tigerweb.geo.census.gov');
    });
  });

  // ==========================================================================
  // extractAll
  // ==========================================================================

  describe('extractAll', () => {
    it('should extract congressional districts from mocked GeoJSON', async () => {
      const mockGeoJSON = makeMockTIGERGeoJSON([
        { geoid: '0601', name: 'Congressional District 1', stateFips: '06' },
        { geoid: '0602', name: 'Congressional District 2', stateFips: '06' },
        { geoid: '3601', name: 'Congressional District 1', stateFips: '36' },
      ]);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockGeoJSON,
      } as Response);

      const result = await provider.extractAll();

      expect(result.country).toBe('US');
      expect(result.layers).toHaveLength(1);
      expect(result.totalBoundaries).toBe(3);
      expect(result.providerVersion).toBe('1.0.0');
    });

    it('should normalize district properties correctly', async () => {
      const mockGeoJSON = makeMockTIGERGeoJSON([
        { geoid: '0601', name: 'Congressional District 1', stateFips: '06' },
      ]);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockGeoJSON,
      } as Response);

      const result = await provider.extractAll();
      const boundaries = result.layers[0].boundaries as USDistrict[];

      expect(boundaries).toHaveLength(1);
      expect(boundaries[0].id).toBe('0601');
      expect(boundaries[0].stateFips).toBe('06');
      expect(boundaries[0].district).toBe('01');
      expect(boundaries[0].stateAbbr).toBe('CA');
      expect(boundaries[0].type).toBe('congressional');
      expect(boundaries[0].source.country).toBe('US');
      expect(boundaries[0].source.dataSource).toBe('Census TIGER');
      expect(boundaries[0].source.authority).toBe('constitutional');
    });

    it('should handle extraction errors gracefully', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('TIGERweb down'));

      const result = await provider.extractAll();

      expect(result.layers[0].success).toBe(false);
      expect(result.layers[0].actualCount).toBe(0);
      expect(result.totalBoundaries).toBe(0);
    });

    it('should flag count mismatch', async () => {
      const mockGeoJSON = makeMockTIGERGeoJSON([
        { geoid: '0601', name: 'CD 1', stateFips: '06' },
      ]);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockGeoJSON,
      } as Response);

      const result = await provider.extractAll();
      const cdLayer = result.layers[0];

      expect(cdLayer.actualCount).toBe(1);
      expect(cdLayer.expectedCount).toBe(444);
      expect(cdLayer.matched).toBe(false);
    });
  });

  // ==========================================================================
  // extractOfficials
  // ==========================================================================

  describe('extractOfficials', () => {
    it('should extract officials from mocked YAML', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => MOCK_LEGISLATORS_YAML,
      } as Response);

      const boundaryIndex = new Map<string, USDistrict>();
      const result = await provider.extractOfficials(boundaryIndex);

      expect(result.country).toBe('US');
      expect(result.actualCount).toBe(4); // 2 reps + 2 senators
      expect(result.officials).toHaveLength(4);
    });

    it('should parse House member with correct fields', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => MOCK_LEGISLATORS_YAML,
      } as Response);

      const result = await provider.extractOfficials(new Map());

      const aderholt = result.officials.find(o => o.bioguideId === 'A000055');
      expect(aderholt).toBeDefined();
      expect(aderholt?.name).toBe('Robert B. Aderholt');
      expect(aderholt?.chamber).toBe('house');
      expect(aderholt?.state).toBe('AL');
      expect(aderholt?.district).toBe('04');
      expect(aderholt?.isVoting).toBe(true);
      expect(aderholt?.party).toBe('Republican');
    });

    it('should parse Senate member correctly', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => MOCK_LEGISLATORS_YAML,
      } as Response);

      const result = await provider.extractOfficials(new Map());

      const brown = result.officials.find(o => o.bioguideId === 'B000944');
      expect(brown).toBeDefined();
      expect(brown?.chamber).toBe('senate');
      expect(brown?.state).toBe('OH');
      expect(brown?.senateClass).toBe(1);
      expect(brown?.district).toBeUndefined();
      expect(brown?.isVoting).toBe(true);
    });

    it('should handle territory delegates with isVoting=false', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => MOCK_LEGISLATORS_YAML,
      } as Response);

      const result = await provider.extractOfficials(new Map());

      const norton = result.officials.find(o => o.bioguideId === 'N000147');
      expect(norton).toBeDefined();
      expect(norton?.isVoting).toBe(false);
      expect(norton?.delegateType).toBe('delegate');
      expect(norton?.state).toBe('DC');
      expect(norton?.chamber).toBe('house');
    });

    it('should resolve GEOID-based boundary codes for House members', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => MOCK_LEGISLATORS_YAML,
      } as Response);

      // Create a boundary that matches Aderholt's district: AL-04 = FIPS 01 + 04
      const boundaryIndex = new Map<string, USDistrict>();
      boundaryIndex.set('0104', {
        id: '0104',
        name: 'Congressional District 4',
        type: 'congressional',
        stateFips: '01',
        stateAbbr: 'AL',
        district: '04',
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
        source: {
          country: 'US',
          dataSource: 'Census TIGER',
          endpoint: 'test',
          vintage: 2024,
          retrievedAt: new Date().toISOString(),
          authority: 'constitutional',
        },
        properties: {},
      });

      const result = await provider.extractOfficials(boundaryIndex);

      const aderholt = result.officials.find(o => o.bioguideId === 'A000055');
      expect(aderholt?.cdGeoid).toBe('0104');
      expect(aderholt?.boundaryCode).toBe('0104');
    });
  });

  // ==========================================================================
  // CWC Code Generation
  // ==========================================================================

  describe('CWC code generation', () => {
    it('should generate H + state + district CWC codes for House members', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => MOCK_LEGISLATORS_YAML,
      } as Response);

      const result = await provider.extractOfficials(new Map());

      const aderholt = result.officials.find(o => o.bioguideId === 'A000055');
      expect(aderholt?.cwcCode).toBe('HAL04');

      const norton = result.officials.find(o => o.bioguideId === 'N000147');
      expect(norton?.cwcCode).toBe('HDC00');
    });

    it('should not generate CWC codes for Senate members', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => MOCK_LEGISLATORS_YAML,
      } as Response);

      const result = await provider.extractOfficials(new Map());

      const brown = result.officials.find(o => o.bioguideId === 'B000944');
      expect(brown?.cwcCode).toBeUndefined();
    });
  });

  // ==========================================================================
  // Party Normalization
  // ==========================================================================

  describe('Party normalization', () => {
    it('should normalize Democrat/Republican/Independent parties', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => MOCK_LEGISLATORS_YAML,
      } as Response);

      const result = await provider.extractOfficials(new Map());

      const aderholt = result.officials.find(o => o.bioguideId === 'A000055');
      expect(aderholt?.party).toBe('Republican');

      const brown = result.officials.find(o => o.bioguideId === 'B000944');
      expect(brown?.party).toBe('Democrat');

      const sanders = result.officials.find(o => o.bioguideId === 'S000033');
      expect(sanders?.party).toBe('Independent');
    });
  });

  // ==========================================================================
  // Validation Pipeline
  // ==========================================================================

  describe('validate', () => {
    function makeMockDistrict(geoid: string, stateAbbr: string): USDistrict {
      return {
        id: geoid,
        name: `Congressional District ${geoid.substring(2)}`,
        type: 'congressional',
        stateFips: geoid.substring(0, 2),
        stateAbbr,
        district: geoid.substring(2),
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
        source: {
          country: 'US',
          dataSource: 'Census TIGER',
          endpoint: 'test',
          vintage: 2024,
          retrievedAt: new Date().toISOString(),
          authority: 'constitutional',
        },
        properties: {},
      };
    }

    function makeMockOfficial(overrides: Partial<USOfficial> = {}): USOfficial {
      return {
        id: 'A000055',
        name: 'Test Rep',
        firstName: 'Test',
        lastName: 'Rep',
        party: 'Republican',
        chamber: 'house',
        boundaryName: 'AL-04',
        boundaryCode: '0104',
        isActive: true,
        bioguideId: 'A000055',
        state: 'AL',
        district: '04',
        stateFips: '01',
        cdGeoid: '0104',
        cwcCode: 'HAL04',
        isVoting: true,
        ...overrides,
      };
    }

    it('should run full 4-layer validation', async () => {
      const boundaries = [makeMockDistrict('0104', 'AL')];
      const officials = [makeMockOfficial()];

      const report = await provider.validate(boundaries, officials);

      expect(report).toBeDefined();
      expect(report.layers.sourceAuthority).toBeDefined();
      expect(report.layers.schemaValidation).toBeDefined();
      expect(report.layers.codeResolution).toBeDefined();
      expect(report.layers.pipVerification).toBeDefined();
    });

    it('should resolve House members via GEOID in Layer 3', async () => {
      const boundaries = [makeMockDistrict('0104', 'AL')];
      const officials = [makeMockOfficial({ cdGeoid: '0104' })];

      const report = await provider.validate(boundaries, officials);

      expect(report.layers.codeResolution.resolved).toBe(1);
      expect(report.layers.codeResolution.unmatched).toHaveLength(0);
    });

    it('should not resolve senators in Layer 3 (no district boundary)', async () => {
      const boundaries = [makeMockDistrict('0104', 'AL')];
      const senator: USOfficial = {
        id: 'B000944',
        name: 'Sherrod Brown',
        firstName: 'Sherrod',
        lastName: 'Brown',
        party: 'Democrat',
        chamber: 'senate',
        boundaryName: 'OH',
        boundaryCode: '39',
        isActive: true,
        bioguideId: 'B000944',
        state: 'OH',
        stateFips: '39',
        isVoting: true,
        senateClass: 1,
      };

      const report = await provider.validate(boundaries, [senator]);

      // Senators are filtered out of code resolution (House only)
      const codeTotal = report.layers.codeResolution.resolved +
        report.layers.codeResolution.unmatched.length +
        report.layers.codeResolution.ambiguous.length;
      expect(codeTotal).toBe(0);
    });

    it('should skip PIP when no geocoder provided', async () => {
      const report = await provider.validate([], []);

      expect(report.layers.pipVerification.confirmed).toBe(0);
      expect(report.layers.pipVerification.skipped).toBe(0);
    });
  });

  // ==========================================================================
  // Health Check
  // ==========================================================================

  describe('healthCheck', () => {
    it('should return healthy when TIGERweb is available', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ name: 'Congressional Districts' }),
      } as Response);

      const health = await provider.healthCheck();

      expect(health.available).toBe(true);
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
      expect(health.issues).toHaveLength(0);
    });

    it('should report unhealthy on HTTP error', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      } as Response);

      const health = await provider.healthCheck();

      expect(health.issues.length).toBeGreaterThan(0);
      expect(health.issues[0]).toContain('503');
    });

    it('should report unhealthy on network failure', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

      const health = await provider.healthCheck();

      expect(health.available).toBe(false);
      expect(health.issues.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('Error handling', () => {
    it('should handle YAML fetch failure gracefully', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('GitHub unreachable'));

      await expect(provider.extractOfficials(new Map())).rejects.toThrow();
    });

    it('should handle invalid YAML response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => 'not: valid: yaml: [[[',
      } as Response);

      // Should throw because parsed result won't be an array of legislators
      await expect(provider.extractOfficials(new Map())).rejects.toThrow();
    });

    it('should handle HTTP error on officials fetch', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as Response);

      await expect(provider.extractOfficials(new Map())).rejects.toThrow();
    });
  });

  // ==========================================================================
  // Expected Counts
  // ==========================================================================

  describe('getExpectedCounts', () => {
    it('should return expected count for congressional layer', async () => {
      const counts = await provider.getExpectedCounts();

      expect(counts.get('congressional')).toBe(444);
    });
  });
});
