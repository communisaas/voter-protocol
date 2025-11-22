import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';

import { discoverBoundary } from './orchestrator';
import { getStateEntry } from './special-districts/registry';

const TEST_CASES = [
  {
    name: 'Phoenix – Valley Metro',
    lat: 33.45,
    lng: -112.07,
    expected: 'Valley Metro RPTA'
  },
  {
    name: 'Phoenix – CAP',
    lat: 33.85,
    lng: -112.45,
    expected: 'Central Arizona Project'
  }
];

async function run() {
  const registry = getStateEntry('AZ');
  assert.ok(registry && registry.status === 'live');

  console.log('='.repeat(80));
  console.log('Arizona Special District Tests');
  console.log('='.repeat(80));

  for (const test of TEST_CASES) {
    console.log(`\n→ ${test.name}`);
    const result = await discoverBoundary({
      location: { lat: test.lat, lng: test.lng, state: 'AZ' },
      boundaryType: 'special_district'
    });

    assert.ok(result.success);
    assert.equal(result.source, 'AZ Special District Registry');
    assert.equal(result.metadata?.districtName, test.expected);
    console.log('   ✅ District:', result.metadata?.districtName);
  }
}

run().catch((error) => {
  console.error('\n❌ Arizona tests failed');
  console.error(error);
  process.exit(1);
});
