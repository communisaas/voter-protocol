/**
 * Generate Solidity DebateWeightVerifier from @aztec/bb.js
 *
 * Generates the on-chain verifier for the debate_weight Noir circuit.
 * The circuit has 2 public inputs:
 *   [0] weighted_amount  - influence weight for this position
 *   [1] note_commitment  - Poseidon2 commitment binding stake, tier, randomness
 *
 * Output: contracts/src/verifiers/DebateWeightVerifier.sol
 *
 * CRITICAL: Must use bb.js v2.1.8 (matching the on-chain verifiers).
 * Do NOT use `bb contract` CLI — this uses the bb.js programmatic API only.
 *
 * Usage:
 *   npx tsx scripts/generate-debate-weight-verifier.ts
 */

import { UltraHonkBackend } from '@aztec/bb.js';
import type { CompiledCircuit } from '@noir-lang/noir_js';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const REPO_ROOT = resolve(new URL('.', import.meta.url).pathname, '..');

async function generateDebateWeightVerifier(): Promise<void> {
  console.log('=== DebateWeightVerifier Generation (bb.js) ===');

  const circuitPath = resolve(
    REPO_ROOT,
    'packages/noir-prover/circuits/debate_weight.json',
  );

  console.log(`Loading circuit from: ${circuitPath}`);
  const module = await import(circuitPath);
  const circuit = module.default as unknown as CompiledCircuit;

  // Sanity-check that this is a real compiled circuit, not the placeholder
  if (!circuit.bytecode || circuit.bytecode.length === 0) {
    throw new Error(
      'debate_weight.json contains empty bytecode (placeholder). ' +
        'Compile the circuit first: cd packages/crypto/noir/debate_weight && nargo compile, ' +
        'then copy target/debate_weight.json to packages/noir-prover/circuits/debate_weight.json',
    );
  }

  console.log(`Circuit bytecode length: ${circuit.bytecode.length} chars`);
  console.log('Creating UltraHonkBackend (threads: 1)...');

  const backend = new UltraHonkBackend(circuit.bytecode, { threads: 1 });

  console.log('Generating Solidity verifier (keccak mode via getSolidityVerifier)...');
  console.log('This may take 30-90 seconds...');

  const soliditySource = await backend.getSolidityVerifier();

  await backend.destroy();

  console.log(`Raw source length: ${soliditySource.length} chars`);

  // Rename the contract from the generic "HonkVerifier" to "DebateWeightVerifier"
  // so it can coexist with HonkVerifier_18/20/22/24 in the same compilation unit.
  const renamed = soliditySource.replace(
    /contract HonkVerifier is/g,
    'contract DebateWeightVerifier is',
  );

  const outPath = resolve(
    REPO_ROOT,
    'contracts/src/verifiers/DebateWeightVerifier.sol',
  );

  writeFileSync(outPath, renamed);

  console.log(`\nWritten to: ${outPath}`);
  console.log(`Final size: ${renamed.length} chars`);

  // Extract and log the NUMBER_OF_PUBLIC_INPUTS constant to confirm it is 2
  const publicInputsMatch = renamed.match(
    /uint256 constant NUMBER_OF_PUBLIC_INPUTS = (\d+)/,
  );
  if (publicInputsMatch) {
    const publicInputCount = Number(publicInputsMatch[1]);
    console.log(`\nPublic inputs in verifier: ${publicInputCount}`);
    if (publicInputCount !== 2) {
      console.warn(
        `WARNING: Expected 2 public inputs (weighted_amount + note_commitment), ` +
          `got ${publicInputCount}. Check circuit compilation.`,
      );
    } else {
      console.log('Public input count OK (2: weighted_amount, note_commitment)');
    }
  }

  console.log('\n=== Done ===');
}

generateDebateWeightVerifier().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
