import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';

import { discoverBoundary } from './orchestrator';
import { getStateEntry } from './special-districts/registry';

const TEST_CASES = [
  {
    name: 'Atlanta – MARTA',
    lat: 33.76,
    lng: -84.39,
    expected: 'MARTA Transit District'
  },
  {
    name: 'Gwinnett – Water Authority',
    lat: 33.95,
    lng: -84.05,
    expected: 'Gwinnett County Water and Sewer Authority'
  }
];

async function run() {
  const registry = getStateEntry('GA');
  assert.ok(registry && registry.status === 'live');

  console.log('='.repeat(80));
  console.log('Georgia DCA Special District Tests');
  console.log('='.repeat(80));

  for (const test of TEST_CASES) {
    console.log(`\n→ ${test.name}`);
    const result = await discoverBoundary({
      location: { lat: test.lat, lng: test.lng, state: 'GA' },
      boundaryType: 'special_district'
    });

    assert.ok(result.success);
    assert.equal(result.source, 'GA Special District Registry');
    assert.equal(result.metadata?.districtName, test.expected);
    console.log('   ✅ District:', result.metadata?.districtName);
  }
}

run().catch((error) => {
  console.error('\n❌ Georgia tests failed');
  console.error(error);
  process.exit(1);
});
