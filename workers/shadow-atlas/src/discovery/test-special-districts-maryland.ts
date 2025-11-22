process.env.NODE_ENV = 'test';

import assert from 'node:assert/strict';
import { discoverBoundary } from './orchestrator';
import { getStateEntry } from './special-districts/registry';

const TEST_CASES = [
  {
    name: 'Bethesda – WMATA',
    lat: 38.80,
    lng: -77.05,
    expected: 'WMATA Compact District'
  },
  {
    name: 'Laurel – WSSC',
    lat: 39.05,
    lng: -76.93,
    expected: 'WSSC Water'
  }
];

async function run() {
  const registry = getStateEntry('MD');
  assert.ok(registry && registry.status === 'live');

  console.log('='.repeat(80));
  console.log('Maryland Special District Tests');
  console.log('='.repeat(80));

  for (const test of TEST_CASES) {
    console.log(`\n→ ${test.name}`);
    const result = await discoverBoundary({
      location: { lat: test.lat, lng: test.lng, state: 'MD' },
      boundaryType: 'special_district'
    });

    assert.ok(result.success);
    assert.equal(result.source, 'MD Special District Registry');
    assert.equal(result.metadata?.districtName, test.expected);
    console.log('   ✅ District:', result.metadata?.districtName);
  }
}

run().catch((error) => {
  console.error('\n❌ Maryland tests failed');
  console.error(error);
  process.exit(1);
});
