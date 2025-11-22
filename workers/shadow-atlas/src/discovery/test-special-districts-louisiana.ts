process.env.NODE_ENV = 'test';

import assert from 'node:assert/strict';
import { discoverBoundary } from './orchestrator';
import { getStateEntry } from './special-districts/registry';

const TEST_CASES = [
  {
    name: 'New Orleans – RTA',
    lat: 29.96,
    lng: -90.06,
    expected: 'New Orleans Regional Transit Authority'
  },
  {
    name: 'Jefferson Parish – Water',
    lat: 29.90,
    lng: -90.30,
    expected: 'Jefferson Parish Waterworks'
  }
];

async function run() {
  const registry = getStateEntry('LA');
  assert.ok(registry && registry.status === 'live');

  console.log('='.repeat(80));
  console.log('Louisiana Legislative Auditor Special District Tests');
  console.log('='.repeat(80));

  for (const test of TEST_CASES) {
    console.log(`\n→ ${test.name}`);
    const result = await discoverBoundary({
      location: { lat: test.lat, lng: test.lng, state: 'LA' },
      boundaryType: 'special_district'
    });

    assert.ok(result.success);
    assert.equal(result.source, 'LA Special District Registry');
    assert.equal(result.metadata?.districtName, test.expected);
    console.log('   ✅ District:', result.metadata?.districtName);
  }
}

run().catch((error) => {
  console.error('\n❌ Louisiana tests failed');
  console.error(error);
  process.exit(1);
});
