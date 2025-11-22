process.env.NODE_ENV = 'test';

import assert from 'node:assert/strict';
import { discoverBoundary } from './orchestrator';
import { getStateEntry } from './special-districts/registry';

const TEST_CASES = [
  {
    name: 'Nashville – MTA',
    lat: 36.17,
    lng: -86.78,
    expected: 'Nashville Metropolitan Transit Authority'
  },
  {
    name: 'Memphis – MLGW',
    lat: 35.14,
    lng: -90.05,
    expected: 'Memphis Light, Gas and Water'
  }
];

async function run() {
  const registry = getStateEntry('TN');
  assert.ok(registry && registry.status === 'live');

  console.log('='.repeat(80));
  console.log('Tennessee Comptroller Special District Tests');
  console.log('='.repeat(80));

  for (const test of TEST_CASES) {
    console.log(`\n→ ${test.name}`);
    const result = await discoverBoundary({
      location: { lat: test.lat, lng: test.lng, state: 'TN' },
      boundaryType: 'special_district'
    });

    assert.ok(result.success);
    assert.equal(result.source, 'TN Special District Registry');
    assert.equal(result.metadata?.districtName, test.expected);
    console.log('   ✅ District:', result.metadata?.districtName);
  }
}

run().catch((error) => {
  console.error('\n❌ Tennessee tests failed');
  console.error(error);
  process.exit(1);
});
