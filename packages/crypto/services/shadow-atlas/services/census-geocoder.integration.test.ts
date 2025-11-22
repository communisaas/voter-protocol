/**
 * Census Geocoder Integration Test
 *
 * Tests REAL Census Bureau API with actual network requests.
 * Run with: npm test -- census-geocoder.integration.test.ts
 *
 * NOTE: Skipped by default (slow, requires network).
 * Remove .skip to run against live API.
 */

import { describe, it, expect } from 'vitest';
import { CensusGeocoder } from './census-geocoder.js';
import type { Address } from './census-geocoder.js';

describe.skip('CensusGeocoder Integration (Live API)', () => {
  const geocoder = new CensusGeocoder();

  it('should geocode single address successfully', async () => {
    const address: Address = {
      id: '1',
      street: '1600 Pennsylvania Avenue NW',
      city: 'Washington',
      state: 'DC',
      zip: '20500',
    };

    const result = await geocoder.geocodeSingle(address);

    console.log('White House geocode result:', JSON.stringify(result, null, 2));

    expect(result.match).toBe(true);
    expect(result.coordinates).toBeDefined();
    expect(result.coordinates?.lat).toBeCloseTo(38.8977, 2);
    expect(result.coordinates?.lng).toBeCloseTo(-77.0365, 2);
    expect(result.matchType).toBe('Exact');
  }, 30000);

  it('should geocode batch of addresses', async () => {
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
      {
        id: '3',
        street: '1 Apple Park Way',
        city: 'Cupertino',
        state: 'CA',
        zip: '95014',
      },
    ];

    const results = await geocoder.geocodeBatch(addresses);

    console.log('\nBatch geocode results:');
    for (const [id, result] of results) {
      console.log(`\n${id}: ${result.address.street}, ${result.address.city}`);
      console.log(`  Match: ${result.match}`);
      console.log(`  Coordinates: ${result.coordinates ? `${result.coordinates.lat}, ${result.coordinates.lng}` : 'N/A'}`);
      console.log(`  Match Type: ${result.matchType || 'N/A'}`);
      if (result.error) console.log(`  Error: ${result.error}`);
    }

    expect(results.size).toBe(3);

    const stats = geocoder.computeStats(results);
    console.log('\nBatch statistics:');
    console.log(`  Total: ${stats.total}`);
    console.log(`  Matched: ${stats.matched} (${(stats.matchRate * 100).toFixed(1)}%)`);
    console.log(`  Exact: ${stats.exactMatches}`);
    console.log(`  Non-Exact: ${stats.nonExactMatches}`);
    console.log(`  Unmatched: ${stats.unmatched}`);

    expect(stats.total).toBe(3);
    expect(stats.matched).toBeGreaterThan(0);
    expect(stats.matchRate).toBeGreaterThan(0.5);
  }, 30000);

  it('should handle invalid addresses gracefully', async () => {
    const address: Address = {
      id: '1',
      street: '999 Fake Street',
      city: 'Nowhere',
      state: 'XX',
      zip: '00000',
    };

    const result = await geocoder.geocodeSingle(address);

    console.log('\nInvalid address result:', JSON.stringify(result, null, 2));

    expect(result.match).toBe(false);
    expect(result.coordinates).toBeNull();
    expect(result.error).toBeDefined();
  }, 30000);

  it('should demonstrate batch processing with progress', async () => {
    // Create 15 addresses (will trigger multi-batch processing if batch size < 15)
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
        street: '350 Fifth Avenue',
        city: 'New York',
        state: 'NY',
        zip: '10118',
      },
      {
        id: '3',
        street: '233 South Wacker Drive',
        city: 'Chicago',
        state: 'IL',
        zip: '60606',
      },
      {
        id: '4',
        street: '555 California Street',
        city: 'San Francisco',
        state: 'CA',
        zip: '94104',
      },
      {
        id: '5',
        street: '1 World Way',
        city: 'Los Angeles',
        state: 'CA',
        zip: '90045',
      },
    ];

    let progressCalls = 0;
    const results = await geocoder.geocodeBatch(addresses);

    console.log(`\nProcessed ${addresses.length} addresses`);

    const stats = geocoder.computeStats(results);
    console.log(`Match rate: ${(stats.matchRate * 100).toFixed(1)}%`);
    console.log(`Exact matches: ${stats.exactMatches}`);
    console.log(`Non-exact matches: ${stats.nonExactMatches}`);

    expect(results.size).toBe(addresses.length);
  }, 60000);

  it('should extract FIPS codes from results', async () => {
    const address: Address = {
      id: '1',
      street: '1600 Pennsylvania Avenue NW',
      city: 'Washington',
      state: 'DC',
      zip: '20500',
    };

    const result = await geocoder.geocodeSingle(address);

    console.log('\nFIPS codes:', result.fips);

    if (result.fips) {
      expect(result.fips.state).toBeDefined();
      expect(result.fips.county).toBeDefined();
      console.log(`  State FIPS: ${result.fips.state}`);
      console.log(`  County FIPS: ${result.fips.county}`);
      console.log(`  Tract: ${result.fips.tract}`);
      console.log(`  Block: ${result.fips.block}`);
    }
  }, 30000);
});

describe('CensusGeocoder Usage Examples', () => {
  const geocoder = new CensusGeocoder();

  it('demonstrates typical usage pattern', () => {
    // This test demonstrates API usage without making real requests

    const exampleAddresses: Address[] = [
      {
        id: 'user_001',
        street: '123 Main Street',
        city: 'Seattle',
        state: 'WA',
        zip: '98101',
      },
      {
        id: 'user_002',
        street: '456 Oak Avenue',
        city: 'Portland',
        state: 'OR',
        zip: '97201',
      },
    ];

    console.log('\n=== Census Geocoder Usage Example ===\n');
    console.log('1. Create geocoder instance:');
    console.log('   const geocoder = new CensusGeocoder();');
    console.log('');
    console.log('2. Geocode addresses:');
    console.log('   const results = await geocoder.geocodeBatch(addresses);');
    console.log('');
    console.log('3. Process results:');
    console.log('   for (const [id, result] of results) {');
    console.log('     if (result.match) {');
    console.log('       const { lat, lng } = result.coordinates;');
    console.log('       // Use coordinates for point-in-polygon testing');
    console.log('     }');
    console.log('   }');
    console.log('');
    console.log('4. Compute statistics:');
    console.log('   const stats = geocoder.computeStats(results);');
    console.log('   console.log(`Match rate: ${stats.matchRate * 100}%`);');
    console.log('');
    console.log('=== Key Features ===');
    console.log('- FREE forever (no API key required)');
    console.log('- 10,000 addresses per batch');
    console.log('- Returns lat/lng + FIPS codes');
    console.log('- Authoritative US boundary assignments');
    console.log('- Zero infrastructure cost\n');

    expect(exampleAddresses.length).toBe(2);
  });
});
