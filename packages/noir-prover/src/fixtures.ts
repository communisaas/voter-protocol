/**
 * Valid Circuit Fixtures Generator
 *
 * Generates inputs that SATISFY the district_membership circuit constraints.
 * Uses the same Poseidon2 implementation (Noir fixtures circuit) as the ZK circuit.
 *
 * CRITICAL: Without valid inputs, the profiler measures "time to assertion failure"
 * not actual proof generation time (20-60s on mobile).
 *
 * Circuit requirements (from main.nr):
 * 1. compute_merkle_root(leaf, merkle_path, leaf_index) == merkle_root
 * 2. compute_nullifier(user_secret, campaign_id, authority_hash, epoch_id) == nullifier
 */

import { Noir } from '@noir-lang/noir_js';
import type { CompiledCircuit } from '@noir-lang/noir_js';
import type { CircuitInputs, CircuitDepth } from './types.js';
import { DEFAULT_CIRCUIT_DEPTH } from './types.js';

// Import fixtures circuit for Poseidon2 hashing
// This is the SAME Poseidon2 implementation used by the district_membership circuit
import fixturesCircuit from '../../crypto/noir/fixtures/target/fixtures.json';

const ZERO_PAD = '0x' + '00'.repeat(32);

let fixtureNoir: Noir | null = null;

/**
 * Initialize the fixtures Noir circuit (singleton)
 */
async function getFixtureNoir(): Promise<Noir> {
  if (!fixtureNoir) {
    fixtureNoir = new Noir(fixturesCircuit as unknown as CompiledCircuit);
  }
  return fixtureNoir;
}

/**
 * Reset fixtures singleton to release WASM memory
 * Call this between profiler runs to prevent memory accumulation
 */
export function resetFixtures(): void {
  fixtureNoir = null;
  precomputedLoaded = false;
  // Clear all cached fixtures
  precomputedFixtures.clear();
  precomputedPromises.clear();
  // Clear legacy precomputed values
  PRECOMPUTED_FIXTURE.merkleRoot = '';
  PRECOMPUTED_FIXTURE.nullifier = '';
}

/**
 * Poseidon2 hash via Noir fixtures circuit
 * Matches: poseidon2_permutation([a, b, c, d], 4)[0]
 */
async function poseidon(inputs: (string | bigint)[]): Promise<string> {
  const noir = await getFixtureNoir();

  // Pad to 4 inputs
  const paddedInputs = [...inputs];
  while (paddedInputs.length < 4) {
    paddedInputs.push(ZERO_PAD);
  }

  // Convert to hex strings
  const hexInputs = paddedInputs.slice(0, 4).map((val) => {
    if (typeof val === 'bigint') {
      return '0x' + val.toString(16).padStart(64, '0');
    }
    return val.startsWith('0x') ? val : '0x' + val;
  });

  const result = await noir.execute({ inputs: hexInputs });
  const returnValue =
    (result as { returnValue?: string }).returnValue ??
    (result as { return_value?: string }).return_value;

  if (!returnValue) {
    throw new Error('Poseidon2 fixture returned no value');
  }

  return returnValue as string;
}

/**
 * Compute Merkle root using same algorithm as circuit
 *
 * From main.nr:
 * ```noir
 * let bit: bool = ((leaf_index >> i) & 1u32) == 1u32;
 * node = if bit { poseidon2_hash2(sibling, node) } else { poseidon2_hash2(node, sibling) };
 * ```
 */
async function computeMerkleRoot(
  leaf: string,
  path: string[],
  leafIndex: number
): Promise<string> {
  let node = leaf;

  for (let i = 0; i < path.length; i++) {
    const bit = (leafIndex >> i) & 1;
    const sibling = path[i];

    if (bit === 1) {
      // node is right child: hash(sibling, node)
      node = await poseidon([sibling, node]);
    } else {
      // node is left child: hash(node, sibling)
      node = await poseidon([node, sibling]);
    }
  }

  return node;
}

/**
 * Compute nullifier using same algorithm as circuit
 *
 * From main.nr:
 * ```noir
 * poseidon2_hash4(user_secret, campaign_id, authority_hash, epoch_id)
 * ```
 */
async function computeNullifier(
  userSecret: string,
  campaignId: string,
  authorityHash: string,
  epochId: string
): Promise<string> {
  return poseidon([userSecret, campaignId, authorityHash, epochId]);
}

/**
 * Fixture configuration options
 */
export interface FixtureOptions {
  /** Leaf value (district identifier hash) */
  leaf?: string;
  /** User's secret for nullifier derivation */
  userSecret?: string;
  /** Campaign identifier */
  campaignId?: string;
  /** Authority level hash */
  authorityHash?: string;
  /** Epoch identifier */
  epochId?: string;
  /** Leaf position in tree (0 to 2^depth - 1) */
  leafIndex?: number;
  /** Custom merkle path siblings */
  merklePath?: string[];
  /**
   * Circuit depth (18, 20, 22, or 24)
   * Determines merkle path length and max leaf index
   * Defaults to DEFAULT_CIRCUIT_DEPTH (20)
   */
  depth?: CircuitDepth;
}

/**
 * Generate valid circuit inputs
 *
 * Creates inputs that WILL satisfy circuit constraints:
 * - Merkle root computed from leaf + path
 * - Nullifier computed from user_secret + campaign + authority + epoch
 *
 * @param options - Optional overrides for fixture values (including depth)
 * @returns CircuitInputs that will pass circuit assertions
 */
export async function generateValidInputs(
  options: FixtureOptions = {}
): Promise<CircuitInputs> {
  // Get circuit depth (default to DEFAULT_CIRCUIT_DEPTH)
  const depth = options.depth ?? DEFAULT_CIRCUIT_DEPTH;

  // Default values (small for easy debugging)
  const leaf = options.leaf ?? '0x1111';
  const userSecret = options.userSecret ?? '0x1234';
  const campaignId = options.campaignId ?? '0x01';
  const authorityHash = options.authorityHash ?? '0x01';
  const epochId = options.epochId ?? '0x01';
  const leafIndex = options.leafIndex ?? 0;

  // Default merkle path: all zeros (simplest valid path)
  const merklePath = options.merklePath ?? Array(depth).fill(ZERO_PAD);

  // Validate merkle path length
  if (merklePath.length !== depth) {
    throw new Error(`Merkle path must have ${depth} elements, got ${merklePath.length}`);
  }

  // Validate leaf index range
  if (leafIndex < 0 || leafIndex >= 2 ** depth) {
    throw new Error(`Leaf index must be 0 to ${2 ** depth - 1}, got ${leafIndex}`);
  }

  // Compute valid merkle root (matches circuit computation)
  const merkleRoot = await computeMerkleRoot(leaf, merklePath, leafIndex);

  // Compute valid nullifier (matches circuit computation)
  const nullifier = await computeNullifier(userSecret, campaignId, authorityHash, epochId);

  return {
    merkleRoot,
    nullifier,
    authorityHash,
    epochId,
    campaignId,
    leaf,
    merklePath,
    leafIndex,
    userSecret,
  };
}

/**
 * Generate realistic fixtures using shadow-atlas style district data
 *
 * Creates a more realistic scenario:
 * - District identifier based on real naming convention
 * - Non-trivial merkle path (not all zeros)
 * - Realistic authority level
 *
 * @param depth - Circuit depth (defaults to DEFAULT_CIRCUIT_DEPTH)
 */
export async function generateRealisticInputs(
  depth: CircuitDepth = DEFAULT_CIRCUIT_DEPTH
): Promise<CircuitInputs> {
  // Realistic district identifier (Seattle District 1)
  const districtId = 'us-wa-seattle-council-1';
  const leaf = await poseidon([
    BigInt('0x' + Buffer.from(districtId, 'utf-8').toString('hex')),
  ]);

  // Realistic campaign/authority values
  const campaignId = '0x' + Buffer.from('seattle-2024-primary', 'utf-8').toString('hex').slice(0, 64).padStart(64, '0');
  const authorityHash = '0x03'; // MUNICIPAL_OFFICIAL authority level
  const epochId = '0x' + Date.now().toString(16).padStart(64, '0');

  // User secret (would be derived from wallet signature in production)
  const userSecret = '0x' + 'deadbeef'.repeat(8);

  // Create non-trivial merkle path with some non-zero siblings
  const merklePath = Array(depth).fill(ZERO_PAD);
  // Set some siblings to non-zero for more realistic tree structure
  merklePath[0] = await poseidon(['0x2222']);
  merklePath[1] = await poseidon(['0x3333']);
  merklePath[5] = await poseidon(['0x5555']);

  const leafIndex = 3; // Position in tree (binary: 11, so goes right twice then left)

  return generateValidInputs({
    leaf,
    userSecret,
    campaignId,
    authorityHash,
    epochId,
    leafIndex,
    merklePath,
    depth,
  });
}

/**
 * Base fixture values (shared across all depths)
 * merkleRoot and nullifier are computed on first use per depth
 */
const BASE_FIXTURE_VALUES = {
  authorityHash: '0x0000000000000000000000000000000000000000000000000000000000000001',
  epochId: '0x0000000000000000000000000000000000000000000000000000000000000001',
  campaignId: '0x0000000000000000000000000000000000000000000000000000000000000001',
  leaf: '0x0000000000000000000000000000000000000000000000000000000000001111',
  leafIndex: 0,
  userSecret: '0x0000000000000000000000000000000000000000000000000000000000001234',
};

/**
 * Cache of precomputed fixtures per depth
 */
const precomputedFixtures: Map<CircuitDepth, CircuitInputs> = new Map();
const precomputedPromises: Map<CircuitDepth, Promise<CircuitInputs>> = new Map();

/**
 * Precomputed minimal valid fixture for DEFAULT_CIRCUIT_DEPTH
 * @deprecated Use getPrecomputedFixture(depth) instead for explicit depth control
 */
export const PRECOMPUTED_FIXTURE: CircuitInputs = {
  // These will be computed on first use
  merkleRoot: '', // Computed on first getPrecomputedFixture() call
  nullifier: '',  // Computed on first getPrecomputedFixture() call
  ...BASE_FIXTURE_VALUES,
  merklePath: Array(DEFAULT_CIRCUIT_DEPTH).fill('0x0000000000000000000000000000000000000000000000000000000000000000'),
};

// Lazy-load flag for backward compatibility
let precomputedLoaded = false;

/**
 * Get precomputed fixture for a specific depth
 * Lazily computes and caches fixtures per depth
 *
 * @param depth - Circuit depth (defaults to DEFAULT_CIRCUIT_DEPTH)
 * @returns Precomputed CircuitInputs that satisfy circuit constraints
 */
export async function getPrecomputedFixture(
  depth: CircuitDepth = DEFAULT_CIRCUIT_DEPTH
): Promise<CircuitInputs> {
  // Check cache first
  const cached = precomputedFixtures.get(depth);
  if (cached) {
    // Also update legacy PRECOMPUTED_FIXTURE for default depth
    if (depth === DEFAULT_CIRCUIT_DEPTH && !precomputedLoaded) {
      PRECOMPUTED_FIXTURE.merkleRoot = cached.merkleRoot;
      PRECOMPUTED_FIXTURE.nullifier = cached.nullifier;
      precomputedLoaded = true;
    }
    return cached;
  }

  // Check for in-progress computation
  let computePromise = precomputedPromises.get(depth);
  if (!computePromise) {
    // Start computation
    computePromise = (async () => {
      const merklePath = Array(depth).fill(ZERO_PAD);
      const computed = await generateValidInputs({
        ...BASE_FIXTURE_VALUES,
        merklePath,
        depth,
      });
      precomputedFixtures.set(depth, computed);
      precomputedPromises.delete(depth);

      // Update legacy PRECOMPUTED_FIXTURE for default depth
      if (depth === DEFAULT_CIRCUIT_DEPTH) {
        PRECOMPUTED_FIXTURE.merkleRoot = computed.merkleRoot;
        PRECOMPUTED_FIXTURE.nullifier = computed.nullifier;
        PRECOMPUTED_FIXTURE.merklePath = computed.merklePath;
        precomputedLoaded = true;
      }

      return computed;
    })();
    precomputedPromises.set(depth, computePromise);
  }

  return computePromise;
}
