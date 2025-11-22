process.env.NODE_ENV = 'test';

import assert from 'node:assert/strict';
import { discoverBoundary } from './orchestrator';
import { getStateEntry } from './special-districts/registry';

const TEST_CASES = [
  {
    name: 'Detroit – Transit',
    lat: 42.35,
    lng: -83.07,
    expected: 'Detroit Department of Transportation District'
  },
  {
    name: 'Detroit – GLWA',
    lat: 42.18,
    lng: -83.20,
    expected: 'Great Lakes Water Authority'
  }
];

async function run() {
  const registry = getStateEntry('MI');
  assert.ok(registry && registry.status === 'live');

  console.log('='.repeat(80));
  console.log('Michigan Treasury Special District Tests');
  console.log('='.repeat(80));

  for (const test of TEST_CASES) {
    console.log(`\n→ ${test.name}`);
    const result = await discoverBoundary({
      location: { lat: test.lat, lng: test.lng, state: 'MI' },
      boundaryType: 'special_district'
    });

    assert.ok(result.success);
    assert.equal(result.source, 'MI Special District Registry');
    assert.equal(result.metadata?.districtName, test.expected);
    console.log('   ✅ District:', result.metadata?.districtName);
  }
}

run().catch((error) => {
  console.error('\n❌ Michigan tests failed');
  console.error(error);
  process.exit(1);
});
