import assert from 'node:assert/strict';
import { discoverBoundary } from './orchestrator';
import { getStateEntry } from './special-districts/registry';

interface TestCase {
  name: string;
  lat: number;
  lng: number;
  expectedDistrict: string;
  expectedType: string;
}

const TEST_CASES: TestCase[] = [
  {
    name: 'Los Angeles – West Basin Municipal Water District',
    lat: 33.93,
    lng: -118.35,
    expectedDistrict: 'West Basin Municipal Water District',
    expectedType: 'water'
  },
  {
    name: 'San Diego – North County Transit District',
    lat: 33.20,
    lng: -117.15,
    expectedDistrict: 'North County Transit District',
    expectedType: 'transit'
  },
  {
    name: 'Orange County – Water District',
    lat: 33.72,
    lng: -117.82,
    expectedDistrict: 'Orange County Water District',
    expectedType: 'water'
  }
];

async function run() {
  const registryEntry = getStateEntry('CA');
  assert.ok(registryEntry, 'Registry must include California entry');
  assert.ok(
    registryEntry.sources.filter(source => source.status === 'live').length >= TEST_CASES.length,
    'Registry should mark California counties with live datasets'
  );

  console.log('='.repeat(80));
  console.log('California LAFCo Special District Authority Tests');
  console.log('='.repeat(80));

  for (const test of TEST_CASES) {
    console.log(`\n→ ${test.name}`);

    const result = await discoverBoundary({
      location: {
        lat: test.lat,
        lng: test.lng,
        state: 'CA'
      },
      boundaryType: 'special_district'
    });

    assert.ok(result.success, 'Expected discovery to succeed');
    assert.equal(result.source, 'California LAFCo Special Districts');
    assert.ok(result.score && result.score >= 90, 'Expected score >= 90 from authority source');
    assert.equal(result.metadata?.districtName, test.expectedDistrict);
    assert.ok(
      result.metadata?.notes?.toLowerCase().includes('lafco'),
      'Expected metadata notes to mention LAFCo authority'
    );

    const districtType = result.data?.properties?.district_type ?? result.metadata?.notes;
    assert.ok(
      typeof districtType === 'string' && districtType.toLowerCase().includes(test.expectedType),
      `Expected district type to include "${test.expectedType}"`
    );

    if (test.name.includes('Los Angeles')) {
      assert.ok(
        result.metadata?.overlappingDistricts && result.metadata.overlappingDistricts.length > 1,
        'Los Angeles case should report overlapping districts'
      );
    }

    console.log('   ✅ Source:', result.source);
    console.log('   ✅ District:', result.metadata?.districtName);
    console.log('   ✅ Score:', result.score);
  }

  console.log('\nAll California LAFCo tests passed!');
}

run().catch((error) => {
  console.error('\n❌ California LAFCo tests failed');
  console.error(error);
  process.exit(1);
});
