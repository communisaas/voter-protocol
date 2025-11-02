/**
 * Shadow Atlas Verification Script
 * Validates Atlas structure, Merkle tree integrity, and proof generation
 *
 * Usage:
 *   npm run atlas:verify
 *
 * SECURITY FIX (2025-10-31):
 * Replaced circomlibjs with WASM Poseidon (Axiom halo2_base implementation).
 * circomlibjs uses different round constants than circuit → 100% proof failure.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { readFile } from 'fs/promises';
import init, { hash_pair } from '../packages/crypto/circuits/pkg/voter_district_circuit.js';

interface DistrictLeaf {
  districtId: string;
  districtType: 'house' | 'senate';
  hash: string;
  addressRangeStart: string;
  addressRangeEnd: string;
  centroid: { lat: number; lon: number };
}

interface ShadowAtlasMetadata {
  version: string;
  generatedAt: string;
  congress: number;
  totalDistricts: number;
  dataSource: string;
  hashFunction: 'poseidon';
}

interface AtlasData {
  districts: DistrictLeaf[];
  root: string;
  metadata: ShadowAtlasMetadata;
}

async function verifyAtlas() {
  console.log('🔍 Shadow Atlas Verification\n');

  // Initialize WASM module (Axiom Poseidon implementation)
  console.log('Initializing WASM Poseidon...');
  const wasmPath = path.join(process.cwd(), 'packages/crypto/circuits/pkg/voter_district_circuit_bg.wasm');
  const wasmBytes = await readFile(wasmPath);
  await init(wasmBytes);
  console.log('✓ WASM initialized\n');

  const atlasPath = path.join(process.cwd(), 'shadow-atlas-us.json');

  // Step 1: Load Atlas
  console.log('1. Loading Atlas...');
  let atlas: AtlasData;
  try {
    const data = await fs.readFile(atlasPath, 'utf-8');
    atlas = JSON.parse(data);
    console.log(`   ✓ Loaded ${atlasPath}`);
    console.log(`   ✓ Size: ${(data.length / 1024).toFixed(2)}KB\n`);
  } catch (error) {
    console.error(`   ❌ Failed to load Atlas: ${error}`);
    console.error(`      Run: npm run atlas:dev\n`);
    process.exit(1);
  }

  // Step 2: Validate metadata
  console.log('2. Validating metadata...');
  const requiredFields = ['version', 'generatedAt', 'congress', 'totalDistricts', 'dataSource', 'hashFunction'];
  for (const field of requiredFields) {
    if (!(field in atlas.metadata)) {
      console.error(`   ❌ Missing metadata field: ${field}`);
      process.exit(1);
    }
  }
  console.log(`   ✓ Version: ${atlas.metadata.version}`);
  console.log(`   ✓ Congress: ${atlas.metadata.congress}th`);
  console.log(`   ✓ Districts: ${atlas.metadata.totalDistricts}`);
  console.log(`   ✓ Hash Function: ${atlas.metadata.hashFunction}`);
  console.log(`   ✓ Generated: ${new Date(atlas.metadata.generatedAt).toLocaleString()}\n`);

  // Step 3: Validate district count
  console.log('3. Validating district count...');
  if (atlas.districts.length !== 535) {
    console.error(`   ❌ Expected 535 districts, got ${atlas.districts.length}`);
    process.exit(1);
  }
  const houseCount = atlas.districts.filter(d => d.districtType === 'house').length;
  const senateCount = atlas.districts.filter(d => d.districtType === 'senate').length;
  console.log(`   ✓ Total: ${atlas.districts.length}`);
  console.log(`   ✓ House: ${houseCount}`);
  console.log(`   ✓ Senate: ${senateCount}\n`);

  if (houseCount !== 435) {
    console.error(`   ❌ Expected 435 House districts, got ${houseCount}`);
    process.exit(1);
  }
  if (senateCount !== 100) {
    console.error(`   ❌ Expected 100 Senate districts, got ${senateCount}`);
    process.exit(1);
  }

  // Step 4: Validate district structure
  console.log('4. Validating district structure...');
  const requiredDistrictFields = ['districtId', 'districtType', 'hash', 'centroid'];
  for (const district of atlas.districts) {
    for (const field of requiredDistrictFields) {
      if (!(field in district)) {
        console.error(`   ❌ District ${district.districtId} missing field: ${field}`);
        process.exit(1);
      }
    }

    // Validate hash format
    if (!district.hash.match(/^0x[0-9a-f]{64}$/)) {
      console.error(`   ❌ Invalid hash format for ${district.districtId}: ${district.hash}`);
      process.exit(1);
    }
  }
  console.log(`   ✓ All districts have required fields`);
  console.log(`   ✓ All hashes are valid hex strings\n`);

  // Step 5: Verify Merkle root
  console.log('5. Verifying Merkle root...');
  console.log(`   Computing Merkle tree...`);

  let currentLevel = atlas.districts.map(d => d.hash);

  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length
        ? currentLevel[i + 1]
        : currentLevel[i];

      // Use WASM hash_pair (Axiom implementation)
      const hash = await hash_pair(left, right);

      nextLevel.push(hash);
    }

    currentLevel = nextLevel;
  }

  const computedRoot = currentLevel[0];

  if (computedRoot !== atlas.root) {
    console.error(`   ❌ Merkle root mismatch!`);
    console.error(`      Expected: ${atlas.root}`);
    console.error(`      Computed: ${computedRoot}`);
    process.exit(1);
  }

  console.log(`   ✓ Merkle root verified: ${atlas.root}\n`);

  // Step 6: Test proof generation for sample districts
  console.log('6. Testing proof generation...');

  const sampleDistricts = [
    'CA-12',  // San Francisco
    'NY-14',  // AOC's district
    'TX-21',  // Austin
    'FL-01',  // Florida panhandle
    'CA-S1',  // California Senate Class I
  ];

  for (const districtId of sampleDistricts) {
    const leafIndex = atlas.districts.findIndex(d => d.districtId === districtId);

    if (leafIndex === -1) {
      console.error(`   ❌ District not found: ${districtId}`);
      continue;
    }

    const district = atlas.districts[leafIndex];

    // Generate Merkle path
    const depth = Math.ceil(Math.log2(atlas.districts.length));
    const path: string[] = [];
    const pathIndices: number[] = [];

    let currentIndex = leafIndex;
    let currentLevelData = atlas.districts.map(d => d.hash);

    for (let level = 0; level < depth; level++) {
      const isRightNode = currentIndex % 2 === 1;
      const siblingIndex = isRightNode ? currentIndex - 1 : currentIndex + 1;

      if (siblingIndex < currentLevelData.length) {
        path.push(currentLevelData[siblingIndex]);
        pathIndices.push(isRightNode ? 1 : 0);
      } else {
        path.push(currentLevelData[currentIndex]);
        pathIndices.push(0);
      }

      // Compute parent level
      const parentLevel: string[] = [];
      for (let i = 0; i < currentLevelData.length; i += 2) {
        const left = currentLevelData[i];
        const right = i + 1 < currentLevelData.length
          ? currentLevelData[i + 1]
          : currentLevelData[i];

        // Use WASM hash_pair (Axiom implementation)
        const parentHash = await hash_pair(left, right);

        parentLevel.push(parentHash);
      }

      currentLevelData = parentLevel;
      currentIndex = Math.floor(currentIndex / 2);
    }

    // Verify proof
    let computedHash = district.hash;
    for (let i = 0; i < path.length; i++) {
      const left = pathIndices[i] === 0 ? computedHash : path[i];
      const right = pathIndices[i] === 0 ? path[i] : computedHash;

      // Use WASM hash_pair (Axiom implementation)
      computedHash = await hash_pair(left, right);
    }

    if (computedHash === atlas.root) {
      console.log(`   ✓ ${districtId}: Proof valid (${path.length} steps)`);
    } else {
      console.error(`   ❌ ${districtId}: Proof invalid`);
      process.exit(1);
    }
  }

  console.log();

  // Step 7: Summary
  console.log('━'.repeat(60));
  console.log('✅ All verification checks passed!\n');
  console.log('Summary:');
  console.log(`  • Atlas version: ${atlas.metadata.version}`);
  console.log(`  • Total districts: ${atlas.districts.length}`);
  console.log(`  • Merkle root: ${atlas.root}`);
  console.log(`  • Hash function: ${atlas.metadata.hashFunction}`);
  console.log(`  • Generated: ${new Date(atlas.metadata.generatedAt).toLocaleString()}`);
  console.log();
  console.log('Ready for local testing! Run:');
  console.log('  npm run atlas:serve');
  console.log();
}

verifyAtlas().catch(error => {
  console.error('❌ Verification failed:', error);
  process.exit(1);
});
