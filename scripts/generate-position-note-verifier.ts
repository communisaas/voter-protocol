/**
 * Generate Solidity PositionNoteVerifier from @aztec/bb.js
 *
 * Generates the on-chain verifier for the position_note Noir circuit.
 * The circuit has 5 public inputs:
 *   [0] position_root           - Merkle root of the position tree
 *   [1] nullifier               - Prevents double-claim (H_PNL)
 *   [2] debate_id               - Identifies which debate this claim is for
 *   [3] winning_argument_index  - Winning argument from resolution (contract-controlled)
 *   [4] claimed_weighted_amount - Amount to be paid out
 *
 * Circuit depth: 20 (position Merkle tree, 2^20 = 1,048,576 positions)
 *
 * Output: contracts/src/verifiers/PositionNoteVerifier.sol
 *
 * CRITICAL: Must use bb.js v2.1.8 (matching the on-chain verifiers).
 * Do NOT use `bb contract` CLI -- this uses the bb.js programmatic API only.
 *
 * Usage:
 *   npx tsx scripts/generate-position-note-verifier.ts
 */

import { UltraHonkBackend } from '@aztec/bb.js';
import type { CompiledCircuit } from '@noir-lang/noir_js';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const REPO_ROOT = resolve(new URL('.', import.meta.url).pathname, '..');

async function generatePositionNoteVerifier(): Promise<void> {
  console.log('=== PositionNoteVerifier Generation (bb.js) ===');

  const circuitPath = resolve(
    REPO_ROOT,
    'packages/noir-prover/circuits/position_note.json',
  );

  console.log(`Loading circuit from: ${circuitPath}`);
  const module = await import(circuitPath);
  const circuit = module.default as unknown as CompiledCircuit;

  // Sanity-check that this is a real compiled circuit, not the placeholder
  if (!circuit.bytecode || circuit.bytecode.length === 0) {
    throw new Error(
      'position_note.json contains empty bytecode (placeholder). ' +
        'Compile the circuit first: ' +
        'cd packages/crypto/noir/position_note && nargo compile, ' +
        'then copy target/position_note.json to packages/noir-prover/circuits/position_note.json',
    );
  }

  console.log(`Circuit bytecode length: ${circuit.bytecode.length} chars`);
  console.log('Creating UltraHonkBackend (threads: 1)...');

  const backend = new UltraHonkBackend(circuit.bytecode, { threads: 1 });

  console.log('Generating Solidity verifier (keccak mode via getSolidityVerifier)...');
  console.log('This may take 60-180 seconds (depth-20 Merkle tree is larger than debate_weight)...');

  const soliditySource = await backend.getSolidityVerifier();

  await backend.destroy();

  console.log(`Raw source length: ${soliditySource.length} chars`);

  // Rename the contract from the generic "HonkVerifier" to "PositionNoteVerifier"
  // so it can coexist with HonkVerifier_18/20/22/24 and DebateWeightVerifier in
  // the same compilation unit.
  const renamed = soliditySource.replace(
    /contract HonkVerifier is/g,
    'contract PositionNoteVerifier is',
  );

  const outPath = resolve(
    REPO_ROOT,
    'contracts/src/verifiers/PositionNoteVerifier.sol',
  );

  writeFileSync(outPath, renamed);

  console.log(`\nWritten to: ${outPath}`);
  console.log(`Final size: ${renamed.length} chars`);

  // Extract and log the NUMBER_OF_PUBLIC_INPUTS constant.
  //
  // NOTE: Honk verifiers include 16 pairing points in NUMBER_OF_PUBLIC_INPUTS
  // in addition to the circuit's declared public inputs.
  //   circuit public inputs: 5
  //   PAIRING_POINTS_SIZE:   16
  //   expected total:        21
  const PAIRING_POINTS_SIZE = 16;
  const CIRCUIT_PUBLIC_INPUTS = 5;
  const EXPECTED_TOTAL = CIRCUIT_PUBLIC_INPUTS + PAIRING_POINTS_SIZE; // 21

  const publicInputsMatch = renamed.match(
    /uint256 constant NUMBER_OF_PUBLIC_INPUTS = (\d+)/,
  );
  if (publicInputsMatch) {
    const publicInputCount = Number(publicInputsMatch[1]);
    console.log(`\nPublic inputs in verifier (circuit + pairing points): ${publicInputCount}`);
    if (publicInputCount !== EXPECTED_TOTAL) {
      console.warn(
        `WARNING: Expected ${EXPECTED_TOTAL} (5 circuit + 16 pairing points), ` +
          `got ${publicInputCount}. Check circuit compilation.`,
      );
    } else {
      console.log(
        `Public input count OK (${publicInputCount} = 5 circuit inputs + 16 Honk pairing points)`,
      );
      console.log(
        '  [0] position_root, [1] nullifier, [2] debate_id, ' +
          '[3] winning_argument_index, [4] claimed_weighted_amount',
      );
    }
  }

  console.log('\n=== Done ===');
}

generatePositionNoteVerifier().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
