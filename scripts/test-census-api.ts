#!/usr/bin/env tsx

/**
 * Test Census Bureau API Integration
 *
 * Usage: npx tsx scripts/test-census-api.ts
 */

import { createCensusGeocoder } from '../packages/crypto/services/census-geocoder';

async function main() {
  console.log('🏛️  Census Bureau API Test\n');

  const geocoder = createCensusGeocoder();

  // Test addresses across different districts
  const testAddresses = [
    {
      street: '1600 Pennsylvania Avenue NW',
      city: 'Washington',
      state: 'DC',
      expected: 'DC At-Large Congressional District'
    },
    {
      street: '1 Market Street',
      city: 'San Francisco',
      state: 'CA',
      expected: 'CA Congressional District 11'
    },
    {
      street: '350 Fifth Avenue',
      city: 'New York',
      state: 'NY',
      expected: 'NY Congressional District 12'
    }
  ];

  console.log(`Testing ${testAddresses.length} addresses...\n`);

  for (const addr of testAddresses) {
    console.log(`📍 ${addr.street}, ${addr.city}, ${addr.state}`);
    console.log(`   Expected: ${addr.expected}`);

    try {
      const result = await geocoder.geocodeAddress(addr);

      console.log(`   ✅ Found:`);
      console.log(`      Coordinates: ${result.coordinates.latitude.toFixed(6)}, ${result.coordinates.longitude.toFixed(6)}`);

      if (result.congressional) {
        console.log(`      Congressional: ${result.congressional.state}-${result.congressional.geoid} (${result.congressional.name})`);
      }

      if (result.stateSenate) {
        console.log(`      State Senate: ${result.stateSenate.geoid} (${result.stateSenate.name})`);
      }

      if (result.stateHouse) {
        console.log(`      State House: ${result.stateHouse.geoid} (${result.stateHouse.name})`);
      }

      console.log('');
    } catch (error) {
      console.error(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}\n`);
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('✅ Census API test complete!');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
