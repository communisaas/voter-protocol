import assert from 'node:assert/strict';
import { discoverBoundary } from './orchestrator';
import { getStateEntry } from './special-districts/registry';

const TEST_CASES = [
  {
    name: 'New York City – MTA District',
    lat: 40.73,
    lng: -73.95,
    expected: 'Metropolitan Transportation Authority'
  },
  {
    name: 'Long Island – Nassau Water Authority',
    lat: 40.75,
    lng: -73.60,
    expected: 'Nassau County Water Authority'
  }
];

async function run() {
  const registry = getStateEntry('NY');
  assert.ok(registry && registry.status === 'live');

  console.log('='.repeat(80));
  console.log('New York DOS Special District Tests');
  console.log('='.repeat(80));

  for (const test of TEST_CASES) {
    console.log(`\n→ ${test.name}`);
    const result = await discoverBoundary({
      location: { lat: test.lat, lng: test.lng, state: 'NY' },
      boundaryType: 'special_district'
    });

    assert.ok(result.success, 'Expected discovery to succeed');
    assert.equal(result.source, 'NY Special District Registry');
    assert.equal(result.metadata?.districtName, test.expected);
    console.log('   ✅ District:', result.metadata?.districtName);
  }
}

run().catch((error) => {
  console.error('\n❌ New York tests failed');
  console.error(error);
  process.exit(1);
});
