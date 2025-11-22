process.env.NODE_ENV = 'test';

import assert from 'node:assert/strict';
import { discoverBoundary } from './orchestrator';
import { getStateEntry } from './special-districts/registry';

const TEST_CASES = [
  {
    name: 'Milwaukee – Transit',
    lat: 43.04,
    lng: -87.92,
    expected: 'Milwaukee County Transit System'
  },
  {
    name: 'Madison – Water',
    lat: 43.08,
    lng: -89.38,
    expected: 'Madison Water Utility'
  }
];

async function run() {
  const registry = getStateEntry('WI');
  assert.ok(registry && registry.status === 'live');

  console.log('='.repeat(80));
  console.log('Wisconsin DOR Special District Tests');
  console.log('='.repeat(80));

  for (const test of TEST_CASES) {
    console.log(`\n→ ${test.name}`);
    const result = await discoverBoundary({
      location: { lat: test.lat, lng: test.lng, state: 'WI' },
      boundaryType: 'special_district'
    });

    assert.ok(result.success);
    assert.equal(result.source, 'WI Special District Registry');
    assert.equal(result.metadata?.districtName, test.expected);
    console.log('   ✅ District:', result.metadata?.districtName);
  }
}

run().catch((error) => {
  console.error('\n❌ Wisconsin tests failed');
  console.error(error);
  process.exit(1);
});
