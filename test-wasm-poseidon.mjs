/**
 * Test WASM Poseidon hash_pair against expected Axiom output
 *
 * This verifies the WASM-exported hash_pair produces the correct hash
 * that matches the Rust circuit implementation.
 */

import { readFile } from 'fs/promises';
import init, { hash_pair } from './packages/crypto/circuits/pkg/voter_district_circuit.js';

async function test() {
  console.log('Testing WASM Poseidon hash_pair(12345, 67890)\n');

  // Initialize WASM module (Node.js requires manual file loading)
  const wasmPath = './packages/crypto/circuits/pkg/voter_district_circuit_bg.wasm';
  const wasmBytes = await readFile(wasmPath);
  await init(wasmBytes);

  // Test hash_pair(12345, 67890)
  // Try both hex and simple hex without padding
  const leftSimple = "0x3039";  // 12345 in hex
  const rightSimple = "0x10932"; // 67890 in hex

  console.log(`Input: hash_pair(${leftSimple}, ${rightSimple})`);

  let hash;
  try {
    hash = await hash_pair(leftSimple, rightSimple);
  } catch (e) {
    console.log('Error with simple hex:', e.toString());
    console.log('\nTrying padded hex...');

    const leftPadded = "0x" + (12345).toString(16).padStart(64, '0');
    const rightPadded = "0x" + (67890).toString(16).padStart(64, '0');

    hash = await hash_pair(leftPadded, rightPadded);
  }

  console.log('\nWASM output:');
  console.log('  Hex:', hash);
  console.log();

  // Expected from Axiom halo2_base (from poseidon_hash.rs golden vector)
  const expectedHex = '0x1a52400b0566a6d2eb81fcf923da131e3f0db95e6e618ed4041225c78530a49a';

  console.log('Axiom halo2_base expected:');
  console.log('  Hex:', expectedHex);
  console.log();

  // Compare
  if (hash.toLowerCase() === expectedHex.toLowerCase()) {
    console.log('✅ MATCH! WASM hash_pair produces correct Axiom hash');
    console.log('   Solution: Replace circomlibjs with WASM hash_pair in Shadow Atlas build');
    console.log('   This guarantees hashes match circuit verification');
  } else {
    console.log('🚨 MISMATCH! WASM implementation is broken');
    console.log('   This should NEVER happen - same Rust code');
    console.log();
    console.log('Difference:');
    console.log('  WASM:     ', hash);
    console.log('  Expected: ', expectedHex);
  }
}

test().catch(console.error);
