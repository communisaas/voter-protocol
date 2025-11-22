import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';

import { discoverBoundary } from './orchestrator';
import { getStateEntry } from './special-districts/registry';

const TEST_CASES = [
  {
    name: 'Philadelphia – SEPTA Board',
    lat: 40.20,
    lng: -75.30,
    expected: 'SEPTA Board District'
  },
  {
    name: 'Philadelphia – Water Department',
    lat: 40.01,
    lng: -75.12,
    expected: 'Philadelphia Water Department Service Area'
  }
];

async function run() {
  const registry = getStateEntry('PA');
  assert.ok(registry && registry.status === 'live');

  console.log('='.repeat(80));
  console.log('Pennsylvania DCED Special District Tests');
  console.log('='.repeat(80));

  for (const test of TEST_CASES) {
    console.log(`\n→ ${test.name}`);
    const result = await discoverBoundary({
      location: { lat: test.lat, lng: test.lng, state: 'PA' },
      boundaryType: 'special_district'
    });

    assert.ok(result.success);
    assert.equal(result.source, 'PA Special District Registry');
    assert.equal(result.metadata?.districtName, test.expected);
    console.log('   ✅ District:', result.metadata?.districtName);
  }
}

run().catch((error) => {
  console.error('\n❌ Pennsylvania tests failed');
  console.error(error);
  process.exit(1);
});
