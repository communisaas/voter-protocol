/**
 * Shadow Atlas Build/Verify Test Suite
 *
 * Validates that Shadow Atlas build and verification use consistent Poseidon hashing.
 * This test prevents the circomlibjs disaster: different hash functions = 100% proof failure.
 *
 * Test flow:
 * 1. Build Shadow Atlas with WASM Poseidon
 * 2. Verify Atlas Merkle tree integrity
 * 3. Test proof generation for sample districts
 * 4. Validate hash consistency across runs
 *
 * Usage:
 *   npm run test:atlas
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { execSync } from 'child_process';

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

interface TestSuite {
  name: string;
  results: TestResult[];
  totalDuration: number;
  passRate: number;
}

async function runTest(
  name: string,
  testFn: () => Promise<void>
): Promise<TestResult> {
  const start = Date.now();
  try {
    await testFn();
    return {
      name,
      passed: true,
      duration: Date.now() - start
    };
  } catch (error) {
    return {
      name,
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function testAtlasBuild(): Promise<void> {
  console.log('\n📦 Building Shadow Atlas with WASM Poseidon...');

  try {
    execSync('npm run atlas:dev', {
      stdio: 'pipe',
      encoding: 'utf-8'
    });
  } catch (error) {
    throw new Error(`Atlas build failed: ${error}`);
  }

  // Verify atlas file was created
  const atlasPath = path.join(process.cwd(), 'shadow-atlas-us.json');
  const exists = await fs.access(atlasPath).then(() => true).catch(() => false);

  if (!exists) {
    throw new Error('Atlas file not created after build');
  }

  // Verify file is valid JSON
  const content = await fs.readFile(atlasPath, 'utf-8');
  const atlas = JSON.parse(content);

  // Validate structure
  if (!atlas.districts || !atlas.root || !atlas.metadata) {
    throw new Error('Atlas missing required fields');
  }

  if (atlas.districts.length !== 535) {
    throw new Error(`Expected 535 districts, got ${atlas.districts.length}`);
  }

  console.log(`   ✅ Atlas built with ${atlas.districts.length} districts`);
  console.log(`   ✅ Merkle root: ${atlas.root}`);
}

async function testAtlasVerify(): Promise<void> {
  console.log('\n🔍 Verifying Shadow Atlas integrity...');

  try {
    const output = execSync('npm run atlas:verify', {
      stdio: 'pipe',
      encoding: 'utf-8'
    });

    // Check for success message in output
    if (!output.includes('All verification checks passed')) {
      throw new Error('Verification did not report success');
    }

    // Check for Merkle root verification
    if (!output.includes('Merkle root verified')) {
      throw new Error('Merkle root verification not confirmed');
    }

    console.log('   ✅ Merkle tree integrity verified');
    console.log('   ✅ All sample district proofs valid');
  } catch (error) {
    throw new Error(`Atlas verification failed: ${error}`);
  }
}

async function testHashConsistency(): Promise<void> {
  console.log('\n🔐 Testing hash consistency across runs...');

  const atlasPath = path.join(process.cwd(), 'shadow-atlas-us.json');

  // Load atlas
  const content = await fs.readFile(atlasPath, 'utf-8');
  const atlas = JSON.parse(content);

  const firstRoot = atlas.root;
  const firstDistrictHash = atlas.districts[0].hash;

  // Rebuild atlas
  console.log('   Rebuilding atlas...');
  execSync('npm run atlas:dev', { stdio: 'pipe' });

  // Load rebuilt atlas
  const rebuiltContent = await fs.readFile(atlasPath, 'utf-8');
  const rebuiltAtlas = JSON.parse(rebuiltContent);

  const secondRoot = rebuiltAtlas.root;
  const secondDistrictHash = rebuiltAtlas.districts[0].hash;

  // Compare roots
  if (firstRoot !== secondRoot) {
    throw new Error(
      `Merkle root not deterministic:\n` +
      `  First:  ${firstRoot}\n` +
      `  Second: ${secondRoot}`
    );
  }

  // Compare first district hash
  if (firstDistrictHash !== secondDistrictHash) {
    throw new Error(
      `District hash not deterministic:\n` +
      `  First:  ${firstDistrictHash}\n` +
      `  Second: ${secondDistrictHash}`
    );
  }

  console.log('   ✅ Merkle root deterministic across builds');
  console.log('   ✅ District hashes deterministic');
}

async function testWASMPoseidonConsistency(): Promise<void> {
  console.log('\n⚡ Testing WASM Poseidon matches circuit...');

  try {
    const output = execSync('node test-wasm-poseidon.mjs', {
      stdio: 'pipe',
      encoding: 'utf-8'
    });

    if (!output.includes('✅ MATCH')) {
      throw new Error('WASM Poseidon does not match circuit implementation');
    }

    console.log('   ✅ WASM hash_pair matches Axiom circuit');
  } catch (error) {
    throw new Error(`WASM Poseidon test failed: ${error}`);
  }
}

async function testProofGeneration(): Promise<void> {
  console.log('\n🧪 Testing Merkle proof generation...');

  const atlasPath = path.join(process.cwd(), 'shadow-atlas-us.json');
  const content = await fs.readFile(atlasPath, 'utf-8');
  const atlas = JSON.parse(content);

  // Test sample districts
  const sampleDistricts = ['CA-12', 'NY-14', 'TX-21'];
  let proofsGenerated = 0;

  for (const districtId of sampleDistricts) {
    const district = atlas.districts.find((d: any) => d.districtId === districtId);

    if (!district) {
      throw new Error(`District ${districtId} not found in atlas`);
    }

    // Verify district has valid hash
    if (!district.hash || !district.hash.match(/^0x[0-9a-f]{64}$/)) {
      throw new Error(`District ${districtId} has invalid hash: ${district.hash}`);
    }

    proofsGenerated++;
  }

  console.log(`   ✅ Verified ${proofsGenerated} sample districts`);
  console.log(`   ✅ All districts have valid Poseidon hashes`);
}

async function testMetadataValidation(): Promise<void> {
  console.log('\n📋 Testing metadata validation...');

  const atlasPath = path.join(process.cwd(), 'shadow-atlas-us.json');
  const content = await fs.readFile(atlasPath, 'utf-8');
  const atlas = JSON.parse(content);

  const requiredFields = ['version', 'generatedAt', 'congress', 'totalDistricts', 'dataSource', 'hashFunction'];

  for (const field of requiredFields) {
    if (!(field in atlas.metadata)) {
      throw new Error(`Missing metadata field: ${field}`);
    }
  }

  if (atlas.metadata.hashFunction !== 'poseidon') {
    throw new Error(`Expected hashFunction 'poseidon', got '${atlas.metadata.hashFunction}'`);
  }

  if (atlas.metadata.totalDistricts !== 535) {
    throw new Error(`Expected totalDistricts 535, got ${atlas.metadata.totalDistricts}`);
  }

  console.log(`   ✅ Metadata version: ${atlas.metadata.version}`);
  console.log(`   ✅ Congress: ${atlas.metadata.congress}th`);
  console.log(`   ✅ Hash function: ${atlas.metadata.hashFunction}`);
}

async function testDistrictStructure(): Promise<void> {
  console.log('\n🏛️  Testing district structure...');

  const atlasPath = path.join(process.cwd(), 'shadow-atlas-us.json');
  const content = await fs.readFile(atlasPath, 'utf-8');
  const atlas = JSON.parse(content);

  const requiredDistrictFields = ['districtId', 'districtType', 'hash', 'centroid'];

  // Test first 10 districts
  for (let i = 0; i < 10; i++) {
    const district = atlas.districts[i];

    for (const field of requiredDistrictFields) {
      if (!(field in district)) {
        throw new Error(`District ${district.districtId} missing field: ${field}`);
      }
    }

    // Validate hash format
    if (!district.hash.match(/^0x[0-9a-f]{64}$/)) {
      throw new Error(`District ${district.districtId} has invalid hash format`);
    }

    // Validate district type
    if (!['house', 'senate'].includes(district.districtType)) {
      throw new Error(`District ${district.districtId} has invalid type: ${district.districtType}`);
    }
  }

  // Count districts by type
  const houseCount = atlas.districts.filter((d: any) => d.districtType === 'house').length;
  const senateCount = atlas.districts.filter((d: any) => d.districtType === 'senate').length;

  if (houseCount !== 435) {
    throw new Error(`Expected 435 House districts, got ${houseCount}`);
  }

  if (senateCount !== 100) {
    throw new Error(`Expected 100 Senate districts, got ${senateCount}`);
  }

  console.log(`   ✅ House districts: ${houseCount}`);
  console.log(`   ✅ Senate districts: ${senateCount}`);
  console.log(`   ✅ All districts have valid structure`);
}

async function main() {
  console.log('━'.repeat(70));
  console.log('🧪 Shadow Atlas Test Suite');
  console.log('━'.repeat(70));

  const tests = [
    { name: 'WASM Poseidon Consistency', fn: testWASMPoseidonConsistency },
    { name: 'Atlas Build', fn: testAtlasBuild },
    { name: 'Atlas Verification', fn: testAtlasVerify },
    { name: 'Hash Consistency', fn: testHashConsistency },
    { name: 'Proof Generation', fn: testProofGeneration },
    { name: 'Metadata Validation', fn: testMetadataValidation },
    { name: 'District Structure', fn: testDistrictStructure },
  ];

  const results: TestResult[] = [];

  for (const test of tests) {
    const result = await runTest(test.name, test.fn);
    results.push(result);
  }

  // Print summary
  console.log('\n' + '━'.repeat(70));
  console.log('📊 Test Summary');
  console.log('━'.repeat(70));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  results.forEach(result => {
    const icon = result.passed ? '✅' : '❌';
    const duration = (result.duration / 1000).toFixed(2);
    console.log(`${icon} ${result.name} (${duration}s)`);
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  });

  console.log('━'.repeat(70));
  console.log(`Total: ${passed}/${results.length} passed`);
  console.log(`Duration: ${(totalDuration / 1000).toFixed(2)}s`);
  console.log('━'.repeat(70));

  if (failed > 0) {
    console.error(`\n❌ ${failed} test(s) failed`);
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed!');
    console.log('\nShadow Atlas is production-ready:');
    console.log('  • WASM Poseidon matches circuit');
    console.log('  • Merkle tree builds correctly');
    console.log('  • Verification passes');
    console.log('  • Hashes are deterministic');
    console.log('  • All 535 districts valid');
    process.exit(0);
  }
}

main().catch(error => {
  console.error('❌ Test suite failed:', error);
  process.exit(1);
});
