import { describe, it, expect } from 'vitest';
import { getCityNameVariations, generateSearchQueries, getDistrictSynonyms, getStateVariations } from '../../../utils/search-term-generator.js';

describe('Search Term Generator', () => {
  describe('getCityNameVariations', () => {
    it('generates St./Saint variations', () => {
      const variations = getCityNameVariations('St. Paul');
      expect(variations).toContain('St. Paul');
      expect(variations).toContain('Saint Paul');
      expect(variations).toContain('St Paul');
      expect(variations.length).toBe(3);
    });

    it('generates Saint/St. variations (reverse)', () => {
      const variations = getCityNameVariations('Saint Louis');
      expect(variations).toContain('Saint Louis');
      expect(variations).toContain('St. Louis');
      expect(variations).toContain('St Louis');
      expect(variations.length).toBe(3);
    });

    it('generates Fort/Ft. variations', () => {
      const variations = getCityNameVariations('Fort Worth');
      expect(variations).toContain('Fort Worth');
      expect(variations).toContain('Ft. Worth');
      expect(variations).toContain('Ft Worth');
      expect(variations.length).toBe(3);
    });

    it('generates Ft./Fort variations (reverse)', () => {
      const variations = getCityNameVariations('Ft. Lauderdale');
      expect(variations).toContain('Ft. Lauderdale');
      expect(variations).toContain('Fort Lauderdale');
      expect(variations).toContain('Ft Lauderdale');
      expect(variations.length).toBe(3);
    });

    it('generates Mount/Mt. variations', () => {
      const variations = getCityNameVariations('Mount Vernon');
      expect(variations).toContain('Mount Vernon');
      expect(variations).toContain('Mt. Vernon');
      expect(variations).toContain('Mt Vernon');
      expect(variations.length).toBe(3);
    });

    it('returns single variation for cities with no abbreviations', () => {
      const variations = getCityNameVariations('Seattle');
      expect(variations).toEqual(['Seattle']);
      expect(variations.length).toBe(1);
    });
  });

  describe('getDistrictSynonyms', () => {
    it('returns comprehensive district terminology', () => {
      const synonyms = getDistrictSynonyms();

      expect(synonyms).toContain('council district');
      expect(synonyms).toContain('council ward');
      expect(synonyms).toContain('ward');
      expect(synonyms).toContain('district');
      expect(synonyms).toContain('municipal district');
      expect(synonyms).toContain('city council district');
      expect(synonyms.length).toBe(6);
    });
  });

  describe('getStateVariations', () => {
    it('generates abbreviation + full name from abbreviation', () => {
      const variations = getStateVariations('MN');
      expect(variations).toContain('MN');
      expect(variations).toContain('Minnesota');
      expect(variations.length).toBe(2);
    });

    it('generates abbreviation + full name from full name', () => {
      const variations = getStateVariations('Minnesota');
      expect(variations).toContain('MN');
      expect(variations).toContain('Minnesota');
      expect(variations.length).toBe(2);
    });

    it('handles Texas correctly', () => {
      const variations = getStateVariations('TX');
      expect(variations).toContain('TX');
      expect(variations).toContain('Texas');
    });

    it('handles Hawaii correctly', () => {
      const variations = getStateVariations('HI');
      expect(variations).toContain('HI');
      expect(variations).toContain('Hawaii');
    });

    it('returns single variation for unknown states', () => {
      const variations = getStateVariations('ZZ');
      expect(variations).toEqual(['ZZ']);
    });
  });

  describe('generateSearchQueries', () => {
    it('generates comprehensive search queries for St. Paul', () => {
      const queries = generateSearchQueries('St. Paul', 'MN');

      // Should include ward terminology (St. Paul uses "wards")
      expect(queries.some(q => q.includes('ward'))).toBe(true);

      // Should include city name variations
      expect(queries.some(q => q.includes('St. Paul'))).toBe(true);
      expect(queries.some(q => q.includes('Saint Paul'))).toBe(true);

      // Should include state variations
      expect(queries.some(q => q.includes('MN'))).toBe(true);
      expect(queries.some(q => q.includes('Minnesota'))).toBe(true);

      // Should generate multiple combinations
      expect(queries.length).toBeGreaterThan(10);
    });

    it('generates comprehensive search queries for Fort Worth', () => {
      const queries = generateSearchQueries('Fort Worth', 'TX');

      // Should include district terminology
      expect(queries.some(q => q.includes('district'))).toBe(true);

      // Should include city name variations
      expect(queries.some(q => q.includes('Fort Worth'))).toBe(true);
      expect(queries.some(q => q.includes('Ft. Worth'))).toBe(true);

      // Should include state variations
      expect(queries.some(q => q.includes('TX'))).toBe(true);
      expect(queries.some(q => q.includes('Texas'))).toBe(true);
    });

    it('respects maxQueries limit', () => {
      const queries = generateSearchQueries('St. Paul', 'MN', 10);
      expect(queries.length).toBe(10);
    });

    it('generates expected query format', () => {
      const queries = generateSearchQueries('Seattle', 'WA', 5);

      // All queries should follow pattern: "City State Synonym"
      queries.forEach(query => {
        expect(query.split(' ').length).toBeGreaterThanOrEqual(3);
      });
    });

    it('generates queries for cities with no variations', () => {
      const queries = generateSearchQueries('Seattle', 'WA', 5);

      // Should still generate multiple queries with different synonyms
      expect(queries.length).toBe(5);
      expect(queries.every(q => q.includes('Seattle'))).toBe(true);
    });
  });
});
