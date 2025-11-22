import assert from 'node:assert/strict';
import { discoverBoundary } from './orchestrator';
import { getStateEntry } from './special-districts/registry';

interface TestCase {
  name: string;
  lat: number;
  lng: number;
  expectedDistrict: string;
}

const TEST_CASES: TestCase[] = [
  {
    name: 'Orlando – Lake Nona CDD',
    lat: 28.48,
    lng: -81.20,
    expectedDistrict: 'Lake Nona Community Development District'
  },
  {
    name: 'Tampa – Tampa Palms CDD',
    lat: 28.05,
    lng: -82.40,
    expectedDistrict: 'Tampa Palms Community Development District'
  }
];

async function run() {
  const registryEntry = getStateEntry('FL');
  assert.ok(registryEntry, 'Registry must include Florida entry');
  assert.equal(registryEntry.status, 'live');
  assert.equal(registryEntry.sources[0]?.status, 'live');

  console.log('='.repeat(80));
  console.log('Florida DEO Community Development District Tests');
  console.log('='.repeat(80));

  for (const test of TEST_CASES) {
    console.log(`\n→ ${test.name}`);

    const result = await discoverBoundary({
      location: {
        lat: test.lat,
        lng: test.lng,
        state: 'FL'
      },
      boundaryType: 'special_district'
    });

    assert.ok(result.success, 'Expected discovery to succeed');
    assert.equal(result.source, 'Florida DEO Community Development Districts');
    assert.equal(result.metadata?.districtName, test.expectedDistrict);
    assert.ok(result.score && result.score >= 90);

    console.log('   ✅ Source:', result.source);
    console.log('   ✅ District:', result.metadata?.districtName);
    console.log('   ✅ Score:', result.score);
  }

  console.log('\nAll Florida CDD tests passed!');
}

run().catch((error) => {
  console.error('\n❌ Florida special district tests failed');
  console.error(error);
  process.exit(1);
});
