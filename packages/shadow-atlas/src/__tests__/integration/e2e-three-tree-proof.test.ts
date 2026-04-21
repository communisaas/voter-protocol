/**
 * End-to-End Three-Tree Proof Test: Real Census Data + Engagement → ZK Proof → Verification
 *
 * This test proves the FULL three-tree pipeline with real data:
 *   1. Load Tree 2 from real Census BAF snapshot (CA -- 19,987 cells)
 *   2. Pick a real cell with a non-zero congressional district
 *   3. Build Tree 1 (User Identity) with a registered user in that cell
 *   4. Build Tree 3 (Engagement) with a tier-0 engagement leaf
 *   5. Get Merkle proofs from all three trees
 *   6. Generate a real Noir ZK proof (UltraHonk, ThreeTreeNoirProver)
 *   7. Verify the proof cryptographically
 *   8. Verify public inputs match expected values (anti-substitution)
 *
 * Gate: RUN_E2E=true (skipped otherwise -- requires WASM, ~10min total)
 *
 * Prerequisites:
 *   packages/shadow-atlas/data/tree2-snapshot.json must exist
 *   (CA snapshot with 19,987 cells, already committed)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';

// Shadow Atlas
import { loadCellMapStateFromSnapshot } from '../../hydration/snapshot-loader.js';
import { RegistrationService, type CellMapState } from '../../serving/registration-service.js';
import { EngagementService } from '../../serving/engagement-service.js';

// Crypto
import { getHasher, type Poseidon2Hasher } from '@voter-protocol/crypto';
import {
  computeEngagementDataCommitment,
  computeEngagementLeaf,
} from '@voter-protocol/crypto/engagement';

// Noir prover
import { ThreeTreeNoirProver } from '@voter-protocol/noir-prover';
import type { ThreeTreeProofInput } from '@voter-protocol/noir-prover';

// ============================================================================
// Config
// ============================================================================

const TREE_DEPTH = 20;

// __tests__/integration → src → shadow-atlas
const PACKAGE_ROOT = resolve(__dirname, '../../..');
const SNAPSHOT_PATH = resolve(PACKAGE_ROOT, 'data/tree2-snapshot.json');

// Private witness values (arbitrary, non-zero, BN254-safe)
const USER_SECRET = 123456789n;
const REGISTRATION_SALT = 987654321n;
const IDENTITY_COMMITMENT = 424242424242n;
const ACTION_DOMAIN = 200n;
const AUTHORITY_LEVEL = 5; // mDL

// Engagement: tier-0 (new user, no actions)
const ENGAGEMENT_TIER = 0;
const ACTION_COUNT = 0n;
const DIVERSITY_SCORE = 0n;

// ============================================================================
// Test
// ============================================================================

const RUN = process.env.RUN_E2E === 'true';

describe.skipIf(!RUN)('E2E: Three-Tree Real Census Data → ZK Proof', () => {
  let hasher: Poseidon2Hasher;
  let cellMapState: CellMapState;
  let prover: ThreeTreeNoirProver;
  let cellId: bigint;
  let districts: readonly bigint[];

  beforeAll(async () => {
    // Validate snapshot exists
    if (!existsSync(SNAPSHOT_PATH)) {
      throw new Error(
        `CA snapshot not found at ${SNAPSHOT_PATH}.\n` +
        'The tree2-snapshot.json file should exist in packages/shadow-atlas/data/',
      );
    }

    // Initialize Poseidon2 hasher (WASM -- slow first load)
    hasher = await getHasher();

    // Load Tree 2 from real Census BAF data (CA: 19,987 cells)
    cellMapState = await loadCellMapStateFromSnapshot(SNAPSHOT_PATH);
    expect(cellMapState.districtMap.size).toBeGreaterThan(0);

    // Pick a real cell with a non-zero congressional district (slot 0)
    for (const [key, dists] of cellMapState.districtMap) {
      // Congressional district is typically slot 0; find one that's non-zero
      const nonZero = dists.filter(d => d !== 0n).length;
      if (nonZero >= 1) {
        cellId = BigInt(key);
        districts = dists;
        break;
      }
    }
    if (!cellId) {
      const firstKey = cellMapState.districtMap.keys().next().value!;
      cellId = BigInt(firstKey);
      districts = cellMapState.districtMap.get(firstKey)!;
    }

    // Initialize ThreeTreeNoirProver (loads circuit WASM)
    prover = new ThreeTreeNoirProver({ depth: TREE_DEPTH });
    await prover.init();

    console.log(`Tree 2: ${cellMapState.districtMap.size} cells, root=0x${cellMapState.root.toString(16).slice(0, 12)}...`);
    console.log(`Selected cell: ${cellId} (${districts.filter(d => d !== 0n).length}/24 districts)`);
  }, 600_000); // Poseidon2 WASM + 19,987-cell snapshot rebuild + Noir init

  it('loads real Census data into Tree 2 and selects a valid cell', () => {
    // CA has ~19,987 cells from Census BAFs
    expect(cellMapState.districtMap.size).toBeGreaterThanOrEqual(1000);
    expect(cellMapState.depth).toBe(TREE_DEPTH);
    expect(cellMapState.root).toBeGreaterThan(0n);

    // Verify selected cell exists in Tree 2
    expect(cellMapState.districtMap.has(cellId.toString())).toBe(true);
    expect(districts.length).toBe(24);

    // At least one district should be non-zero
    const nonZero = districts.filter(d => d !== 0n);
    expect(nonZero.length).toBeGreaterThan(0);
  });

  it('generates and verifies a three-tree ZK proof from real Census data', async () => {
    // ── Step 1: Compute user leaf ───────────────────────────────────────
    // H4(userSecret, cellId, registrationSalt, authorityLevel)
    const userLeaf = await hasher.hash4(
      USER_SECRET,
      cellId,
      REGISTRATION_SALT,
      BigInt(AUTHORITY_LEVEL),
    );
    expect(userLeaf).toBeGreaterThan(0n);

    // ── Step 2: Insert into Tree 1 (User Identity) ─────────────────────
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

    // ── Step 3: Build Tree 3 (Engagement) ──────────────────────────────
    // Use EngagementService which manages a standard balanced Merkle tree
    const engagementService = await EngagementService.create(TREE_DEPTH);
    const engagementLeafIndex = await engagementService.registerIdentity(
      '0xdeadbeef00000000000000000000000000000001', // mock signer
      IDENTITY_COMMITMENT,
    );
    expect(engagementLeafIndex).toBe(0);

    const engagementProof = engagementService.getProof(engagementLeafIndex);
    const engagementRoot = BigInt(engagementProof.engagementRoot);
    const engagementPath = engagementProof.engagementPath.map(s => BigInt(s));
    const engagementIndex = engagementProof.leafIndex;

    console.log(`Tree 3: engagement root=0x${engagementRoot.toString(16).slice(0, 12)}... tier=${engagementProof.tier}`);

    // ── Step 4: Get Tree 2 SMT proof ───────────────────────────────────
    const smtProof = await cellMapState.tree.getProof(cellId);

    expect(smtProof.siblings.length).toBe(TREE_DEPTH);
    expect(smtProof.pathBits.length).toBe(TREE_DEPTH);

    // ── Step 5: Compute nullifier ──────────────────────────────────────
    // H2(identityCommitment, actionDomain)
    const nullifier = await hasher.hashPair(IDENTITY_COMMITMENT, ACTION_DOMAIN);
    expect(nullifier).toBeGreaterThan(0n);

    // ── Step 6: Assemble three-tree proof input ────────────────────────
    const proofInput: ThreeTreeProofInput = {
      // Public inputs (two-tree base)
      userRoot,
      cellMapRoot: cellMapState.root,
      districts: [...districts],
      nullifier,
      actionDomain: ACTION_DOMAIN,
      authorityLevel: AUTHORITY_LEVEL,

      // Public inputs (three-tree additions)
      engagementRoot,
      engagementTier: ENGAGEMENT_TIER,

      // Private inputs
      userSecret: USER_SECRET,
      cellId,
      registrationSalt: REGISTRATION_SALT,
      identityCommitment: IDENTITY_COMMITMENT,

      // Tree 1 proof (standard Merkle)
      userPath,
      userIndex,

      // Tree 2 proof (sparse Merkle)
      cellMapPath: [...smtProof.siblings],
      cellMapPathBits: [...smtProof.pathBits],

      // Tree 3 proof (standard Merkle)
      engagementPath,
      engagementIndex,

      // Engagement data (private witnesses)
      actionCount: ACTION_COUNT,
      diversityScore: DIVERSITY_SCORE,
    };

    // Sanity checks before proof generation
    expect(proofInput.districts.length).toBe(24);
    expect(proofInput.userPath.length).toBe(TREE_DEPTH);
    expect(proofInput.cellMapPath.length).toBe(TREE_DEPTH);
    expect(proofInput.engagementPath.length).toBe(TREE_DEPTH);

    // ── Step 7: Generate ZK proof ──────────────────────────────────────
    console.log('Generating three-tree ZK proof...');
    const startTime = Date.now();
    const proofResult = await prover.generateProof(proofInput);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    expect(proofResult.proof.length).toBeGreaterThan(0);
    expect(proofResult.publicInputs.length).toBe(31); // THREE_TREE_PUBLIC_INPUT_COUNT

    // ── Step 8: Verify proof ───────────────────────────────────────────
    const valid = await prover.verifyProof(proofResult);
    expect(valid).toBe(true);

    // ── Step 9: Verify with expected inputs (anti-substitution) ────────
    const validBound = await prover.verifyProofWithExpectedInputs(
      proofResult,
      proofInput,
    );
    expect(validBound).toBe(true);

    // ── Step 10: Verify public input layout ────────────────────────────
    const pi = proofResult.publicInputs;

    // [0] user_root
    expect(BigInt(pi[0])).toBe(userRoot);
    // [1] cell_map_root
    expect(BigInt(pi[1])).toBe(cellMapState.root);
    // [2-25] districts
    for (let i = 0; i < 24; i++) {
      expect(BigInt(pi[2 + i])).toBe(districts[i]);
    }
    // [26] nullifier
    expect(BigInt(pi[26])).toBe(nullifier);
    // [27] action_domain
    expect(BigInt(pi[27])).toBe(ACTION_DOMAIN);
    // [28] authority_level
    expect(BigInt(pi[28])).toBe(BigInt(AUTHORITY_LEVEL));
    // [29] engagement_root
    expect(BigInt(pi[29])).toBe(engagementRoot);
    // [30] engagement_tier
    expect(BigInt(pi[30])).toBe(BigInt(ENGAGEMENT_TIER));

    // ── Summary ────────────────────────────────────────────────────────
    console.log(`=== THREE-TREE E2E PROOF PASSED ===`);
    console.log(`Cell: ${cellId} | Districts: ${districts.filter(d => d !== 0n).length}/24`);
    console.log(`Engagement: tier=${ENGAGEMENT_TIER} actions=${ACTION_COUNT} diversity=${DIVERSITY_SCORE}`);
    console.log(`Proof: ${proofResult.proof.length} bytes in ${elapsed}s | Public inputs: ${pi.length} | Verified: OK`);
  }, 600_000); // UltraHonk proof generation can take 5-8 min
});
