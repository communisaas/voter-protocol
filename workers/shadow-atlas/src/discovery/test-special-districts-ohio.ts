process.env.NODE_ENV = 'test';

import assert from 'node:assert/strict';
import { discoverBoundary } from './orchestrator';
import { getStateEntry } from './special-districts/registry';

const TEST_CASES = [
  {
    name: 'Columbus – COTA',
    lat: 39.97,
    lng: -82.99,
    expected: 'Central Ohio Transit Authority'
  },
  {
    name: 'Cleveland – Water',
    lat: 41.48,
    lng: -81.69,
    expected: 'Cleveland Water Service Area'
  }
];

async function run() {
  const registry = getStateEntry('OH');
  assert.ok(registry && registry.status === 'live');

  console.log('='.repeat(80));
  console.log('Ohio Auditor Special District Tests');
  console.log('='.repeat(80));

  for (const test of TEST_CASES) {
    console.log(`\n→ ${test.name}`);
    const result = await discoverBoundary({
      location: { lat: test.lat, lng: test.lng, state: 'OH' },
      boundaryType: 'special_district'
    });

    assert.ok(result.success);
    assert.equal(result.source, 'OH Special District Registry');
    assert.equal(result.metadata?.districtName, test.expected);
    console.log('   ✅ District:', result.metadata?.districtName);
  }
}

run().catch((error) => {
  console.error('\n❌ Ohio tests failed');
  console.error(error);
  process.exit(1);
});
