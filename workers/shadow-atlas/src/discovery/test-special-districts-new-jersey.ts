import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';

import { discoverBoundary } from './orchestrator';
import { getStateEntry } from './special-districts/registry';

const TEST_CASES = [
  {
    name: 'Newark – NJ TRANSIT',
    lat: 40.73,
    lng: -74.17,
    expected: 'NJ TRANSIT Board District'
  },
  {
    name: 'Passaic – Water Commission',
    lat: 40.88,
    lng: -74.16,
    expected: 'Passaic Valley Water Commission'
  }
];

async function run() {
  const registry = getStateEntry('NJ');
  assert.ok(registry && registry.status === 'live');

  console.log('='.repeat(80));
  console.log('New Jersey DCA Special District Tests');
  console.log('='.repeat(80));

  for (const test of TEST_CASES) {
    console.log(`\n→ ${test.name}`);
    const result = await discoverBoundary({
      location: { lat: test.lat, lng: test.lng, state: 'NJ' },
      boundaryType: 'special_district'
    });

    assert.ok(result.success);
    assert.equal(result.source, 'NJ Special District Registry');
    assert.equal(result.metadata?.districtName, test.expected);
    console.log('   ✅ District:', result.metadata?.districtName);
  }
}

run().catch((error) => {
  console.error('\n❌ New Jersey tests failed');
  console.error(error);
  process.exit(1);
});
