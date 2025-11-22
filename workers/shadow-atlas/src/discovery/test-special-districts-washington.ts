import assert from 'node:assert/strict';
import { discoverBoundary } from './orchestrator';
import { getStateEntry } from './special-districts/registry';

const TEST_CASES = [
  {
    name: 'Seattle – Sound Transit',
    lat: 47.35,
    lng: -122.25,
    expected: 'Sound Transit District'
  },
  {
    name: 'Seattle – Utilities Overlap',
    lat: 47.55,
    lng: -122.30,
    expected: 'Seattle Public Utilities Service Area'
  }
];

async function run() {
  const registry = getStateEntry('WA');
  assert.ok(registry && registry.status === 'live');

  console.log('='.repeat(80));
  console.log('Washington OFM Special District Tests');
  console.log('='.repeat(80));

  for (const test of TEST_CASES) {
    console.log(`\n→ ${test.name}`);
    const result = await discoverBoundary({
      location: { lat: test.lat, lng: test.lng, state: 'WA' },
      boundaryType: 'special_district'
    });

    assert.ok(result.success);
    assert.equal(result.source, 'WA Special District Registry');
    assert.equal(result.metadata?.districtName, test.expected);
    console.log('   ✅ District:', result.metadata?.districtName);
  }
}

run().catch((error) => {
  console.error('\n❌ Washington tests failed');
  console.error(error);
  process.exit(1);
});
