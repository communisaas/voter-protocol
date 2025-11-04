/**
 * Test circomlibjs Poseidon hash against Axiom halo2_base golden vector
 *
 * Expected (Axiom halo2_base):
 * hash_pair(12345, 67890) = [0x041225c78530a49a, 0x3f0db95e6e618ed4, 0xeb81fcf923da131e, 0x1a52400b0566a6d2]
 * As big-endian hex: 0x1a52400b0566a6d2eb81fcf923da131e3f0db95e6e618ed4041225c78530a49a
 */

import { buildPoseidon } from 'circomlibjs';

async function test() {
  console.log('Testing circomlibjs Poseidon hash_pair(12345, 67890)\n');

  const poseidon = await buildPoseidon();

  // Hash the pair
  const left = BigInt(12345);
  const right = BigInt(67890);
  const hash = poseidon([left, right]);

  // Convert to string (circomlibjs returns field element)
  const hashString = poseidon.F.toString(hash);
  const hashBigInt = BigInt(hashString);
  const hashHex = '0x' + hashBigInt.toString(16).padStart(64, '0');

  console.log('circomlibjs output:');
  console.log('  Decimal:', hashString);
  console.log('  Hex:    ', hashHex);
  console.log();

  // Expected from Axiom halo2_base
  const expectedHex = '0x1a52400b0566a6d2eb81fcf923da131e3f0db95e6e618ed4041225c78530a49a';
  const expectedBigInt = BigInt(expectedHex);

  console.log('Axiom halo2_base expected:');
  console.log('  Hex:    ', expectedHex);
  console.log('  Decimal:', expectedBigInt.toString());
  console.log();

  // Compare
  if (hashHex === expectedHex) {
    console.log('✅ MATCH! circomlibjs produces identical hash to Axiom halo2_base');
    console.log('   Brutalist finding is FALSE POSITIVE - system is safe');
  } else {
    console.log('🚨 MISMATCH! circomlibjs produces DIFFERENT hash than Axiom halo2_base');
    console.log('   Brutalist finding is CONFIRMED - system is BROKEN');
    console.log();
    console.log('Difference analysis:');
    console.log('  circomlibjs:', hashHex);
    console.log('  Axiom:      ', expectedHex);
    console.log('  Delta:      ', (hashBigInt - expectedBigInt).toString());
  }
}

test().catch(console.error);
