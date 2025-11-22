import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';

import { discoverBoundary } from './orchestrator';
import { getStateEntry } from './special-districts/registry';

const TEST_CASES = [
  {
    name: 'Chicago – CTA Board',
    lat: 41.88,
    lng: -87.65,
    expected: 'Chicago Transit Authority'
  },
  {
    name: 'DuPage – Water Commission',
    lat: 41.82,
    lng: -88.05,
    expected: 'DuPage Water Commission'
  }
];

async function run() {
  const registry = getStateEntry('IL');
  assert.ok(registry && registry.status === 'live');

  console.log('='.repeat(80));
  console.log('Illinois Comptroller Special District Tests');
  console.log('='.repeat(80));

  for (const test of TEST_CASES) {
    console.log(`\n→ ${test.name}`);
    const result = await discoverBoundary({
      location: { lat: test.lat, lng: test.lng, state: 'IL' },
      boundaryType: 'special_district'
    });

    assert.ok(result.success);
    assert.equal(result.source, 'IL Special District Registry');
    assert.equal(result.metadata?.districtName, test.expected);
    console.log('   ✅ District:', result.metadata?.districtName);
  }
}

run().catch((error) => {
  console.error('\n❌ Illinois tests failed');
  console.error(error);
  process.exit(1);
});
