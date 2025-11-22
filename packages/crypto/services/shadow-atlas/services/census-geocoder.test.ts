/**
 * Census Geocoder Tests
 *
 * Tests Census Bureau API integration for free US address geocoding.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CensusGeocoder } from './census-geocoder.js';
import type { Address, GeocodeResult } from './census-geocoder.js';

describe('CensusGeocoder', () => {
  let geocoder: CensusGeocoder;

  beforeEach(() => {
    geocoder = new CensusGeocoder();
  });

  describe('generateCSV', () => {
    it('should generate correctly formatted CSV', () => {
      const addresses: Address[] = [
        {
          id: '1',
          street: '1600 Pennsylvania Avenue NW',
          city: 'Washington',
          state: 'DC',
          zip: '20500',
        },
        {
          id: '2',
          street: '1 Microsoft Way',
          city: 'Redmond',
          state: 'WA',
          zip: '98052',
        },
      ];

      const csv = (geocoder as any).generateCSV(addresses);

      expect(csv).toContain('Unique ID,Street address,City,State,ZIP');
      expect(csv).toContain('"1","1600 Pennsylvania Avenue NW","Washington","DC","20500"');
      expect(csv).toContain('"2","1 Microsoft Way","Redmond","WA","98052"');
    });

    it('should handle special characters in addresses', () => {
      const addresses: Address[] = [
        {
          id: '1',
          street: '123 "Main" Street',
          city: "O'Fallon",
          state: 'MO',
          zip: '63366',
        },
      ];

      const csv = (geocoder as any).generateCSV(addresses);

      expect(csv).toContain('"123 \\"Main\\" Street"');
      expect(csv).toContain("\"O'Fallon\"");
    });
  });

  describe('parseCSVRow', () => {
    it('should parse simple CSV row', () => {
      const row = '"1","123 Main St","Seattle","WA","98101"';
      const fields = (geocoder as any).parseCSVRow(row);

      expect(fields).toEqual(['1', '123 Main St', 'Seattle', 'WA', '98101']);
    });

    it('should handle quoted fields with commas', () => {
      const row = '"1","123 Main St, Apt 4","Seattle","WA","98101"';
      const fields = (geocoder as any).parseCSVRow(row);

      expect(fields).toEqual(['1', '123 Main St, Apt 4', 'Seattle', 'WA', '98101']);
    });

    it('should handle fields with extra whitespace', () => {
      const row = ' "1" , "123 Main St" , "Seattle" , "WA" , "98101" ';
      const fields = (geocoder as any).parseCSVRow(row);

      expect(fields).toEqual(['1', '123 Main St', 'Seattle', 'WA', '98101']);
    });
  });

  describe('parseBatchResults', () => {
    it('should parse successful match result', () => {
      const resultText = `"1","123 Main St, Seattle, WA, 98101","Match","Exact","123 MAIN ST, SEATTLE, WA, 98101","-122.3321, 47.6062","76516885","L"`;

      const addresses: Address[] = [
        {
          id: '1',
          street: '123 Main St',
          city: 'Seattle',
          state: 'WA',
          zip: '98101',
        },
      ];

      const results = (geocoder as any).parseBatchResults(resultText, addresses);

      expect(results.size).toBe(1);

      const result = results.get('1');
      expect(result).toBeDefined();
      expect(result?.match).toBe(true);
      expect(result?.matchType).toBe('Exact');
      expect(result?.coordinates).toEqual({
        lat: 47.6062,
        lng: -122.3321,
      });
    });

    it('should parse no-match result', () => {
      const resultText = `"1","999 Fake Street, Nowhere, XX, 00000","No_Match","","","","",""`;

      const addresses: Address[] = [
        {
          id: '1',
          street: '999 Fake Street',
          city: 'Nowhere',
          state: 'XX',
          zip: '00000',
        },
      ];

      const results = (geocoder as any).parseBatchResults(resultText, addresses);

      expect(results.size).toBe(1);

      const result = results.get('1');
      expect(result).toBeDefined();
      expect(result?.match).toBe(false);
      expect(result?.coordinates).toBeNull();
      expect(result?.error).toContain('not found');
    });

    it('should parse tie result (multiple matches)', () => {
      const resultText = `"1","123 Main St, Springfield, IL, 62701","Tie","","","","",""`;

      const addresses: Address[] = [
        {
          id: '1',
          street: '123 Main St',
          city: 'Springfield',
          state: 'IL',
          zip: '62701',
        },
      ];

      const results = (geocoder as any).parseBatchResults(resultText, addresses);

      expect(results.size).toBe(1);

      const result = results.get('1');
      expect(result).toBeDefined();
      expect(result?.match).toBe(false);
      expect(result?.error).toContain('Multiple matches');
    });

    it('should handle missing addresses in results', () => {
      const resultText = `"1","123 Main St, Seattle, WA, 98101","Match","Exact","123 MAIN ST, SEATTLE, WA, 98101","-122.3321, 47.6062","76516885","L"`;

      const addresses: Address[] = [
        {
          id: '1',
          street: '123 Main St',
          city: 'Seattle',
          state: 'WA',
          zip: '98101',
        },
        {
          id: '2',
          street: '456 Other St',
          city: 'Seattle',
          state: 'WA',
          zip: '98102',
        },
      ];

      const results = (geocoder as any).parseBatchResults(resultText, addresses);

      expect(results.size).toBe(2);
      expect(results.get('1')?.match).toBe(true);
      expect(results.get('2')?.match).toBe(false);
      expect(results.get('2')?.error).toContain('No result returned');
    });
  });

  describe('chunkAddresses', () => {
    it('should split addresses into chunks', () => {
      const addresses: Address[] = Array.from({ length: 25 }, (_, i) => ({
        id: `${i}`,
        street: `${i} Main St`,
        city: 'Seattle',
        state: 'WA',
        zip: '98101',
      }));

      const chunks = (geocoder as any).chunkAddresses(addresses, 10);

      expect(chunks.length).toBe(3);
      expect(chunks[0].length).toBe(10);
      expect(chunks[1].length).toBe(10);
      expect(chunks[2].length).toBe(5);
    });

    it('should handle exact multiples', () => {
      const addresses: Address[] = Array.from({ length: 20 }, (_, i) => ({
        id: `${i}`,
        street: `${i} Main St`,
        city: 'Seattle',
        state: 'WA',
        zip: '98101',
      }));

      const chunks = (geocoder as any).chunkAddresses(addresses, 10);

      expect(chunks.length).toBe(2);
      expect(chunks[0].length).toBe(10);
      expect(chunks[1].length).toBe(10);
    });
  });

  describe('computeStats', () => {
    it('should compute correct statistics', () => {
      const results = new Map<string, GeocodeResult>([
        [
          '1',
          {
            address: {
              id: '1',
              street: '123 Main St',
              city: 'Seattle',
              state: 'WA',
              zip: '98101',
            },
            coordinates: { lat: 47.6062, lng: -122.3321 },
            match: true,
            matchType: 'Exact',
          },
        ],
        [
          '2',
          {
            address: {
              id: '2',
              street: '456 Other St',
              city: 'Seattle',
              state: 'WA',
              zip: '98102',
            },
            coordinates: { lat: 47.6062, lng: -122.3321 },
            match: true,
            matchType: 'Non_Exact',
          },
        ],
        [
          '3',
          {
            address: {
              id: '3',
              street: '999 Fake St',
              city: 'Nowhere',
              state: 'XX',
              zip: '00000',
            },
            coordinates: null,
            match: false,
            error: 'No match',
          },
        ],
      ]);

      const stats = geocoder.computeStats(results);

      expect(stats.total).toBe(3);
      expect(stats.matched).toBe(2);
      expect(stats.unmatched).toBe(1);
      expect(stats.exactMatches).toBe(1);
      expect(stats.nonExactMatches).toBe(1);
      expect(stats.matchRate).toBeCloseTo(0.667, 2);
    });

    it('should handle empty results', () => {
      const results = new Map<string, GeocodeResult>();

      const stats = geocoder.computeStats(results);

      expect(stats.total).toBe(0);
      expect(stats.matched).toBe(0);
      expect(stats.unmatched).toBe(0);
      expect(stats.matchRate).toBe(0);
    });
  });

  describe('geocodeBatch error handling', () => {
    it('should reject batches exceeding max size', async () => {
      const addresses: Address[] = Array.from({ length: 10001 }, (_, i) => ({
        id: `${i}`,
        street: `${i} Main St`,
        city: 'Seattle',
        state: 'WA',
        zip: '98101',
      }));

      await expect(geocoder.geocodeBatch(addresses)).rejects.toThrow(
        'exceeds Census API limit of 10000'
      );
    });

    it('should handle empty address arrays', async () => {
      const results = await geocoder.geocodeBatch([]);

      expect(results.size).toBe(0);
    });
  });

  describe('geocodeMultiBatch', () => {
    it('should process multiple batches', async () => {
      // Mock fetch for testing
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => `"1","123 Main St, Seattle, WA, 98101","Match","Exact","123 MAIN ST, SEATTLE, WA, 98101","-122.3321, 47.6062","76516885","L"`,
      });
      global.fetch = mockFetch;

      const addresses: Address[] = Array.from({ length: 15 }, (_, i) => ({
        id: `${i}`,
        street: `${i} Main St`,
        city: 'Seattle',
        state: 'WA',
        zip: '98101',
      }));

      // Should NOT throw since we're mocking successful responses
      const results = await geocoder.geocodeMultiBatch(addresses);

      expect(results.size).toBeGreaterThan(0);
    });

    it('should call progress callback', async () => {
      const progressFn = vi.fn();

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => '',
      });
      global.fetch = mockFetch;

      const addresses: Address[] = Array.from({ length: 5 }, (_, i) => ({
        id: `${i}`,
        street: `${i} Main St`,
        city: 'Seattle',
        state: 'WA',
        zip: '98101',
      }));

      await geocoder.geocodeMultiBatch(addresses, { onProgress: progressFn });

      expect(progressFn).toHaveBeenCalled();
    });
  });
});
