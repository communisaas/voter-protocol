import assert from 'node:assert/strict';
import { discoverBoundary } from './orchestrator';
import { getStateEntry } from './special-districts/registry';

const TEST_CASES = [
  {
    name: 'Portland – TriMet District',
    lat: 45.50,
    lng: -122.45,
    expected: 'TriMet Transit District'
  },
  {
    name: 'Beaverton – Tualatin Valley Water',
    lat: 45.55,
    lng: -122.80,
    expected: 'Tualatin Valley Water District'
  }
];

async function run() {
  const registry = getStateEntry('OR');
  assert.ok(registry && registry.status === 'live');

  console.log('='.repeat(80));
  console.log('Oregon DLCD Special District Tests');
  console.log('='.repeat(80));

  for (const test of TEST_CASES) {
    console.log(`\n→ ${test.name}`);
    const result = await discoverBoundary({
      location: { lat: test.lat, lng: test.lng, state: 'OR' },
      boundaryType: 'special_district'
    });

    assert.ok(result.success);
    assert.equal(result.source, 'OR Special District Registry');
    assert.equal(result.metadata?.districtName, test.expected);
    console.log('   ✅ District:', result.metadata?.districtName);
  }
}

run().catch((error) => {
  console.error('\n❌ Oregon tests failed');
  console.error(error);
  process.exit(1);
});
