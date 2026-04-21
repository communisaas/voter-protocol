/**
 * End-to-End Proof Test: Real Census Data → ZK Proof → Verification
 *
 * This test proves the ENTIRE pipeline works with real data:
 *   1. Load Tree 2 from real Census BAF snapshot (DC -- 404 cells)
 *   2. Pick a real cell (Census tract) from Tree 2
 *   3. Compute user leaf and register in Tree 1
 *   4. Get Merkle proofs from both trees
 *   5. Generate a real Noir ZK proof (UltraHonk)
 *   6. Verify the proof cryptographically
 *
 * Gate: RUN_E2E=true (skipped otherwise -- requires WASM, ~6min total)
 *
 * Prerequisites:
 *   npx tsx packages/shadow-atlas/src/hydration/build-tree2.ts \
 *     --state 11 --output data/test-dc-snapshot.json --depth 20
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';

// Shadow Atlas
import { loadCellMapStateFromSnapshot } from '../../hydration/snapshot-loader.js';
import { RegistrationService, type CellMapState } from '../../serving/registration-service.js';

// Crypto
import { getHasher, type Poseidon2Hasher } from '@voter-protocol/crypto';

// Noir prover
// TODO: Migrate to ThreeTreeNoirProver once engagement pipeline is wired into e2e tests.
// The TwoTreeNoirProver tests the two-tree subset; a three-tree e2e test should
// additionally build Tree 3 (Engagement) and use ThreeTreeNoirProver.
import { TwoTreeNoirProver } from '@voter-protocol/noir-prover';
import type { TwoTreeProofInput } from '@voter-protocol/noir-prover';

// ============================================================================
// Config
// ============================================================================

const TREE_DEPTH = 20;

// __tests__/integration → src → shadow-atlas → packages → voter-protocol
const REPO_ROOT = resolve(__dirname, '../../../../..');
const SNAPSHOT_PATH = resolve(REPO_ROOT, 'data/test-dc-snapshot.json');

// Private witness values (arbitrary, non-zero)
const USER_SECRET = 987654321n;
const REGISTRATION_SALT = 1122334455n;
const IDENTITY_COMMITMENT = 42424242n;
const ACTION_DOMAIN = 100n;
const AUTHORITY_LEVEL = 1;

// ============================================================================
// Test
// ============================================================================

const RUN = process.env.RUN_E2E === 'true';

describe.skipIf(!RUN)('E2E: Real Census Data → ZK Proof', () => {
  let hasher: Poseidon2Hasher;
  let cellMapState: CellMapState;
  let prover: TwoTreeNoirProver;
  let cellId: bigint;
  let districts: readonly bigint[];

  beforeAll(async () => {
    // Validate snapshot exists
    if (!existsSync(SNAPSHOT_PATH)) {
      throw new Error(
        `DC snapshot not found at ${SNAPSHOT_PATH}.\n` +
        'Run: npx tsx packages/shadow-atlas/src/hydration/build-tree2.ts ' +
        '--state 11 --output data/test-dc-snapshot.json --depth 20',
      );
    }

    // Initialize Poseidon2 hasher (WASM -- slow first load)
    hasher = await getHasher();

    // Load Tree 2 from real Census BAF data (DC: 404 cells)
    cellMapState = await loadCellMapStateFromSnapshot(SNAPSHOT_PATH);
    expect(cellMapState.districtMap.size).toBeGreaterThan(0);

    // Pick a real cell from Tree 2 -- prefer one with multiple district assignments
    for (const [key, dists] of cellMapState.districtMap) {
      const nonZero = dists.filter(d => d !== 0n).length;
      if (nonZero >= 2) {
        cellId = BigInt(key);
        districts = dists;
        break;
      }
    }
    // Fallback: first cell
    if (!cellId) {
      const firstKey = cellMapState.districtMap.keys().next().value!;
      cellId = BigInt(firstKey);
      districts = cellMapState.districtMap.get(firstKey)!;
    }

    // Initialize Noir prover (loads circuit WASM)
    prover = new TwoTreeNoirProver({ depth: TREE_DEPTH });
    await prover.init();

    console.log(`Tree 2: ${cellMapState.districtMap.size} cells, root=0x${cellMapState.root.toString(16).slice(0, 12)}...`);
    console.log(`Selected cell: ${cellId} (${districts.filter(d => d !== 0n).length}/24 districts)`);
  }, 180_000); // Poseidon2 WASM + snapshot rebuild + Noir init

  it('loads real Census data into Tree 2', () => {
    // DC has ~404 cells from Census BAFs
    expect(cellMapState.districtMap.size).toBeGreaterThanOrEqual(200);
    expect(cellMapState.depth).toBe(TREE_DEPTH);
    expect(cellMapState.root).toBeGreaterThan(0n);

    // Verify selected cell exists in Tree 2
    expect(cellMapState.districtMap.has(cellId.toString())).toBe(true);
    expect(districts.length).toBe(24);

    // At least one district should be non-zero (DC has congressional district)
    const nonZero = districts.filter(d => d !== 0n);
    expect(nonZero.length).toBeGreaterThan(0);
  });

  it('generates and verifies a ZK proof from real Census data', async () => {
    // ── Step 1: Compute user leaf ───────────────────────────────────────
    // H4(userSecret, cellId, registrationSalt, authorityLevel) with DOMAIN_HASH4
    const userLeaf = await hasher.hash4(
      USER_SECRET,
      cellId,
      REGISTRATION_SALT,
      BigInt(AUTHORITY_LEVEL),
    );
    expect(userLeaf).toBeGreaterThan(0n);

    // ── Step 2: Insert into Tree 1 ──────────────────────────────────────
    const registrationService = await RegistrationService.create(TREE_DEPTH);
    const regResult = await registrationService.insertLeaf(
      '0x' + userLeaf.toString(16),
    );

    expect(regResult.leafIndex).toBe(0);
    expect(regResult.userPath.length).toBe(TREE_DEPTH);
    expect(regResult.pathIndices.length).toBe(TREE_DEPTH);

    const userRoot = BigInt(regResult.userRoot);
    const userPath = regResult.userPath.map(s => BigInt(s));
    const userIndex = regResult.leafIndex;

    // ── Step 3: Get Tree 2 SMT proof ────────────────────────────────────
    const smtProof = await cellMapState.tree.getProof(cellId);

    expect(smtProof.siblings.length).toBe(TREE_DEPTH);
    expect(smtProof.pathBits.length).toBe(TREE_DEPTH);

    // ── Step 4: Compute nullifier ───────────────────────────────────────
    // H2(identityCommitment, actionDomain) with DOMAIN_HASH2
    const nullifier = await hasher.hashPair(IDENTITY_COMMITMENT, ACTION_DOMAIN);
    expect(nullifier).toBeGreaterThan(0n);

    // ── Step 5: Assemble proof input ────────────────────────────────────
    const proofInput: TwoTreeProofInput = {
      // Public inputs
      userRoot,
      cellMapRoot: cellMapState.root,
      districts: [...districts],
      nullifier,
      actionDomain: ACTION_DOMAIN,
      authorityLevel: AUTHORITY_LEVEL,

      // Private inputs
      userSecret: USER_SECRET,
      cellId,
      registrationSalt: REGISTRATION_SALT,
      identityCommitment: IDENTITY_COMMITMENT,

      // Tree 1 proof
      userPath,
      userIndex,

      // Tree 2 proof
      cellMapPath: [...smtProof.siblings],
      cellMapPathBits: [...smtProof.pathBits],
    };

    // Sanity checks before proof generation
    expect(proofInput.districts.length).toBe(24);
    expect(proofInput.userPath.length).toBe(TREE_DEPTH);
    expect(proofInput.cellMapPath.length).toBe(TREE_DEPTH);

    // ── Step 6: Generate ZK proof ───────────────────────────────────────
    console.log('Generating ZK proof...');
    const startTime = Date.now();
    const proofResult = await prover.generateProof(proofInput);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    expect(proofResult.proof.length).toBeGreaterThan(0);
    expect(proofResult.publicInputs.length).toBe(29);

    // ── Step 7: Verify proof ────────────────────────────────────────────
    const valid = await prover.verifyProof(proofResult);
    expect(valid).toBe(true);

    // ── Step 8: Verify with expected inputs (anti-substitution) ─────────
    const validBound = await prover.verifyProofWithExpectedInputs(
      proofResult,
      proofInput,
    );
    expect(validBound).toBe(true);

    // ── Summary ─────────────────────────────────────────────────────────
    console.log(`=== E2E PROOF PASSED ===`);
    console.log(`Cell: ${cellId} | Districts: ${districts.filter(d => d !== 0n).length}/24`);
    console.log(`Proof: ${proofResult.proof.length} bytes in ${elapsed}s | Verified: OK`);
  }, 600_000); // UltraHonk proof generation can take 5-8 min
});
