/**
 * Debug circomlibjs Poseidon configuration
 * Try to understand why hash doesn't match Axiom despite R_P=57
 */

import { buildPoseidon } from 'circomlibjs';

async function debug() {
  console.log('Debugging circomlibjs Poseidon configuration\n');

  const poseidon = await buildPoseidon();

  console.log('Field info:');
  console.log('  Prime (p):', poseidon.F.p.toString());
  console.log('  Is BN128?:', poseidon.F.p.toString() === '21888242871839275222246405745257275088548364400416034343698204186575808495617');
  console.log();

  // Try different input widths to see which N_ROUNDS_P value is used
  console.log('Testing different input widths:');

  // Width 1 (should use N_ROUNDS_P[0] = 56)
  const hash1 = poseidon([BigInt(12345)]);
  console.log('  hash([12345]):', '0x' + BigInt(poseidon.F.toString(hash1)).toString(16).padStart(64, '0'));

  // Width 2 (should use N_ROUNDS_P[1] = 57)
  const hash2 = poseidon([BigInt(12345), BigInt(67890)]);
  console.log('  hash([12345, 67890]):', '0x' + BigInt(poseidon.F.toString(hash2)).toString(16).padStart(64, '0'));

  // Width 3 (should use N_ROUNDS_P[2] = 56)
  const hash3 = poseidon([BigInt(12345), BigInt(67890), BigInt(11111)]);
  console.log('  hash([12345, 67890, 11111]):', '0x' + BigInt(poseidon.F.toString(hash3)).toString(16).padStart(64, '0'));
  console.log();

  // Check if there's a way to inspect the actual parameters used
  console.log('Poseidon object properties:');
  for (const key in poseidon) {
    if (typeof poseidon[key] !== 'function') {
      console.log(`  ${key}:`, poseidon[key]);
    }
  }
}

debug().catch(console.error);
