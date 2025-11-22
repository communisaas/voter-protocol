import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';

import { discoverBoundary } from './orchestrator';
import { getStateEntry } from './special-districts/registry';

const TEST_CASES = [
  {
    name: 'Denver – RTD',
    lat: 39.80,
    lng: -104.65,
    expected: 'Denver Regional Transportation District'
  },
  {
    name: 'Denver – Denver Water',
    lat: 39.75,
    lng: -105.05,
    expected: 'Denver Water Service Area'
  }
];

async function run() {
  const registry = getStateEntry('CO');
  assert.ok(registry && registry.status === 'live');

  console.log('='.repeat(80));
  console.log('Colorado DOLA Special District Tests');
  console.log('='.repeat(80));

  for (const test of TEST_CASES) {
    console.log(`\n→ ${test.name}`);
    const result = await discoverBoundary({
      location: { lat: test.lat, lng: test.lng, state: 'CO' },
      boundaryType: 'special_district'
    });

    assert.ok(result.success);
    assert.equal(result.source, 'CO Special District Registry');
    assert.equal(result.metadata?.districtName, test.expected);
    console.log('   ✅ District:', result.metadata?.districtName);
  }
}

run().catch((error) => {
  console.error('\n❌ Colorado tests failed');
  console.error(error);
  process.exit(1);
});
