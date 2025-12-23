/**
 * New Zealand Provider Tests
 *
 * Unit tests for NZ electoral district provider.
 */

import { describe, it, expect } from 'vitest';
import { NewZealandBoundaryProvider } from './nz-provider.js';

describe('NewZealandBoundaryProvider', () => {
  const provider = new NewZealandBoundaryProvider();

  describe('Provider Configuration', () => {
    it('should have correct country metadata', () => {
      expect(provider.country).toBe('NZ');
      expect(provider.countryName).toBe('New Zealand');
      expect(provider.dataSource).toBe('Stats NZ (Statistics New Zealand)');
      expect(provider.apiType).toBe('arcgis-rest');
      expect(provider.license).toBe('CC-BY-4.0');
    });

    it('should have both general and Māori electorate layers', () => {
      expect(provider.layers.size).toBe(2);
      expect(provider.layers.has('general')).toBe(true);
      expect(provider.layers.has('maori')).toBe(true);
    });

    it('should have correct expected counts', () => {
      const generalLayer = provider.layers.get('general');
      const maoriLayer = provider.layers.get('maori');

      expect(generalLayer).toBeDefined();
      expect(maoriLayer).toBeDefined();

      expect(generalLayer?.expectedCount).toBe(65);
      expect(maoriLayer?.expectedCount).toBe(7);
    });

    it('should have 2025 vintage for both layers', () => {
      const generalLayer = provider.layers.get('general');
      const maoriLayer = provider.layers.get('maori');

      expect(generalLayer?.vintage).toBe(2025);
      expect(maoriLayer?.vintage).toBe(2025);
    });

    it('should have national-statistics authority', () => {
      const generalLayer = provider.layers.get('general');
      const maoriLayer = provider.layers.get('maori');

      expect(generalLayer?.authority).toBe('national-statistics');
      expect(maoriLayer?.authority).toBe('national-statistics');
    });

    it('should have event-driven update schedule', () => {
      const generalLayer = provider.layers.get('general');
      const maoriLayer = provider.layers.get('maori');

      expect(generalLayer?.updateSchedule).toBe('event-driven');
      expect(maoriLayer?.updateSchedule).toBe('event-driven');
    });
  });

  describe('Expected Counts', () => {
    it('should return correct expected counts', async () => {
      const counts = await provider.getExpectedCounts();

      expect(counts.get('general')).toBe(65);
      expect(counts.get('maori')).toBe(7);
    });

    it('should total 72 electorates', async () => {
      const counts = await provider.getExpectedCounts();
      const total = Array.from(counts.values()).reduce((sum, count) => sum + count, 0);

      expect(total).toBe(72);
    });
  });

  describe('Layer Type Safety', () => {
    it('should reject invalid layer types', async () => {
      // @ts-expect-error - Testing runtime error for invalid layer type
      await expect(provider.extractLayer('invalid')).rejects.toThrow('Unsupported layer type');
    });

    it('should accept valid layer types', () => {
      // Type-level test: these should compile without errors
      const _general: 'general' = 'general';
      const _maori: 'maori' = 'maori';

      expect(_general).toBe('general');
      expect(_maori).toBe('maori');
    });
  });

  describe('Data Source Endpoints', () => {
    it('should have valid Stats NZ datafinder endpoints', () => {
      const generalLayer = provider.layers.get('general');
      const maoriLayer = provider.layers.get('maori');

      expect(generalLayer?.endpoint).toContain('datafinder.stats.govt.nz');
      expect(generalLayer?.endpoint).toContain('FeatureServer');

      expect(maoriLayer?.endpoint).toContain('datafinder.stats.govt.nz');
      expect(maoriLayer?.endpoint).toContain('FeatureServer');
    });

    it('should have distinct endpoints for each layer', () => {
      const generalLayer = provider.layers.get('general');
      const maoriLayer = provider.layers.get('maori');

      expect(generalLayer?.endpoint).not.toBe(maoriLayer?.endpoint);
    });

    it('should reference 2025 boundary review datasets', () => {
      const generalLayer = provider.layers.get('general');
      const maoriLayer = provider.layers.get('maori');

      // Both should reference layer IDs 122741 (general) and 122742 (maori)
      expect(generalLayer?.endpoint).toContain('122741');
      expect(maoriLayer?.endpoint).toContain('122742');
    });
  });

  describe('Validation Logic', () => {
    it('should validate count matches correctly', () => {
      // Access private method via type assertion for testing
      const validateCounts = (provider as any).validateCounts.bind(provider);

      const noErrors = validateCounts('general', 65, 65);
      expect(noErrors).toHaveLength(0);

      const mismatchErrors = validateCounts('general', 63, 65);
      expect(mismatchErrors).toHaveLength(1);
      expect(mismatchErrors[0]).toContain('expected 65, got 63');
    });

    it('should detect zero feature counts', () => {
      const validateCounts = (provider as any).validateCounts.bind(provider);

      const zeroErrors = validateCounts('general', 0, 65);
      expect(zeroErrors.length).toBeGreaterThan(0);
      expect(zeroErrors.some((e: string) => e.includes('No general'))).toBe(true);
    });

    it('should count duplicate IDs correctly', () => {
      const countDuplicates = (provider as any).countDuplicates.bind(provider);

      expect(countDuplicates(['1', '2', '3'])).toBe(0);
      expect(countDuplicates(['1', '1', '2'])).toBe(1);
      expect(countDuplicates(['1', '1', '2', '2', '3'])).toBe(2);
    });
  });

  describe('Region Inference', () => {
    it('should infer North Island for Auckland', () => {
      const inferRegion = (provider as any).inferRegion.bind(provider);

      const region = inferRegion({ electorate_name: 'Auckland Central' });
      expect(region).toBe('North Island');
    });

    it('should infer South Island for Canterbury', () => {
      const inferRegion = (provider as any).inferRegion.bind(provider);

      const region = inferRegion({ region: 'Canterbury' });
      expect(region).toBe('South Island');
    });

    it('should infer Chatham Islands correctly', () => {
      const inferRegion = (provider as any).inferRegion.bind(provider);

      const region = inferRegion({ electorate_name: 'Chatham Islands' });
      expect(region).toBe('Chatham Islands');
    });

    it('should default to North Island', () => {
      const inferRegion = (provider as any).inferRegion.bind(provider);

      const region = inferRegion({});
      expect(region).toBe('North Island');
    });
  });

  describe('Population Parsing', () => {
    it('should parse numeric population', () => {
      const parsePopulation = (provider as any).parsePopulation.bind(provider);

      expect(parsePopulation({ population: 50000 })).toBe(50000);
    });

    it('should parse string population', () => {
      const parsePopulation = (provider as any).parsePopulation.bind(provider);

      expect(parsePopulation({ population: '50000' })).toBe(50000);
    });

    it('should return undefined for missing population', () => {
      const parsePopulation = (provider as any).parsePopulation.bind(provider);

      expect(parsePopulation({})).toBeUndefined();
    });

    it('should return undefined for invalid string', () => {
      const parsePopulation = (provider as any).parsePopulation.bind(provider);

      expect(parsePopulation({ population: 'invalid' })).toBeUndefined();
    });
  });
});
