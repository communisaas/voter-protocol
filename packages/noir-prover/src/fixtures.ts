/**
 * Valid Circuit Fixtures Generator
 *
 * Generates inputs that SATISFY the district_membership circuit constraints.
 * Uses the same Poseidon2 implementation (Noir fixtures circuit) as the ZK circuit.
 *
 * SECURITY MODEL (NEW):
 * The circuit now COMPUTES leaf and nullifier internally:
 * - leaf = hash(userSecret, districtId, authorityLevel, registrationSalt)
 * - nullifier = hash(userSecret, actionDomain)
 *
 * This prevents attackers from submitting arbitrary leaves or nullifiers.
 * The fixtures generator mirrors this computation to produce valid merkle roots.
 *
 * Circuit requirements (from main.nr):
 * 1. compute_merkle_root(computed_leaf, merkle_path, leaf_index) == merkle_root
 *    where computed_leaf = hash(user_secret, district_id, authority_level, registration_salt)
 */

import { Noir } from '@noir-lang/noir_js';
import type { CompiledCircuit } from '@noir-lang/noir_js';
import type { CircuitInputs, CircuitDepth, AuthorityLevel } from './types.js';
import { DEFAULT_CIRCUIT_DEPTH, validateAuthorityLevel } from './types.js';

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
}

/**
 * Poseidon2 hash via Noir fixtures circuit
 * Matches: poseidon2_permutation([a, b, c, d], 4)[0]
 */
async function poseidon(inputs: (string | bigint | number)[]): Promise<string> {
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
    if (typeof val === 'number') {
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
 * Compute leaf hash as the circuit does internally
 *
 * From the new secure circuit:
 * ```noir
 * let leaf = poseidon2_hash4(user_secret, district_id, authority_level, registration_salt);
 * ```
 */
async function computeLeaf(
  userSecret: string,
  districtId: string,
  authorityLevel: number,
  registrationSalt: string
): Promise<string> {
  return poseidon([userSecret, districtId, authorityLevel, registrationSalt]);
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
 * Compute nullifier as the circuit does internally
 *
 * From the new secure circuit:
 * ```noir
 * let nullifier = poseidon2_hash2(user_secret, action_domain);
 * ```
 *
 * Note: This is for reference/testing only - the actual nullifier is
 * computed INSIDE the circuit and returned as a public output.
 */
export async function computeNullifier(
  userSecret: string,
  actionDomain: string
): Promise<string> {
  return poseidon([userSecret, actionDomain]);
}

/**
 * Fixture configuration options for the new secure circuit
 */
export interface FixtureOptions {
  // Private inputs (user secrets)
  /** User's secret for nullifier derivation and leaf computation */
  userSecret?: string;
  /** District identifier */
  districtId?: string;
  /** Authority level (1-5) */
  authorityLevel?: AuthorityLevel;
  /** Registration salt for leaf computation */
  registrationSalt?: string;

  // Public inputs
  /** Action domain (replaces epochId + campaignId) */
  actionDomain?: string;

  // Merkle proof data
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
 * Generate valid circuit inputs for the new secure circuit
 *
 * Creates inputs that WILL satisfy circuit constraints:
 * - Leaf is computed from userSecret, districtId, authorityLevel, registrationSalt
 * - Merkle root is computed from the leaf + path
 * - Nullifier will be computed inside the circuit from userSecret + actionDomain
 *
 * @param options - Optional overrides for fixture values (including depth)
 * @returns CircuitInputs that will pass circuit assertions
 */
export async function generateValidInputs(
  options: FixtureOptions = {}
): Promise<CircuitInputs> {
  // Get circuit depth (default to DEFAULT_CIRCUIT_DEPTH)
  const depth = options.depth ?? DEFAULT_CIRCUIT_DEPTH;

  // Private inputs (default values for testing)
  const userSecret = options.userSecret ?? '0x1234';
  const districtId = options.districtId ?? '0x42';
  const authorityLevel = validateAuthorityLevel(options.authorityLevel ?? 1);
  const registrationSalt = options.registrationSalt ?? '0x99';

  // Public inputs
  const actionDomain = options.actionDomain ?? '0x01';

  // Merkle proof data
  const leafIndex = options.leafIndex ?? 0;
  const merklePath = options.merklePath ?? Array(depth).fill(ZERO_PAD);

  // Validate merkle path length
  if (merklePath.length !== depth) {
    throw new Error(`Merkle path must have ${depth} elements, got ${merklePath.length}`);
  }

  // Validate leaf index range
  if (leafIndex < 0 || leafIndex >= 2 ** depth) {
    throw new Error(`Leaf index must be 0 to ${2 ** depth - 1}, got ${leafIndex}`);
  }

  // Compute leaf as the circuit will do internally
  const leaf = await computeLeaf(userSecret, districtId, authorityLevel, registrationSalt);

  // Compute valid merkle root from the computed leaf
  const merkleRoot = await computeMerkleRoot(leaf, merklePath, leafIndex);

  return {
    // Public inputs
    merkleRoot,
    actionDomain,

    // Private inputs
    userSecret,
    districtId,
    authorityLevel,
    registrationSalt,

    // Merkle proof data
    merklePath,
    leafIndex,
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
  const districtIdString = 'us-wa-seattle-council-1';
  const districtId = '0x' + Buffer.from(districtIdString, 'utf-8').toString('hex').padStart(64, '0');

  // Realistic action domain (would be contract-provided in production)
  const actionDomainString = 'seattle-2024-primary';
  const actionDomain = '0x' + Buffer.from(actionDomainString, 'utf-8').toString('hex').slice(0, 64).padStart(64, '0');

  // User secret (would be derived from wallet signature in production)
  const userSecret = '0x' + 'deadbeef'.repeat(8);

  // Registration salt (assigned during registration)
  const registrationSalt = '0x' + 'cafebabe'.repeat(8);

  // Authority level: MUNICIPAL_OFFICIAL (level 3)
  const authorityLevel: AuthorityLevel = 3;

  // Create non-trivial merkle path with some non-zero siblings
  const merklePath = Array(depth).fill(ZERO_PAD);
  // Set some siblings to non-zero for more realistic tree structure
  merklePath[0] = await poseidon(['0x2222']);
  merklePath[1] = await poseidon(['0x3333']);
  merklePath[5] = await poseidon(['0x5555']);

  const leafIndex = 3; // Position in tree (binary: 11, so goes right twice then left)

  return generateValidInputs({
    userSecret,
    districtId,
    authorityLevel,
    registrationSalt,
    actionDomain,
    leafIndex,
    merklePath,
    depth,
  });
}

/**
 * Base fixture values (shared across all depths)
 * merkleRoot is computed on first use per depth
 */
const BASE_FIXTURE_VALUES = {
  userSecret: '0x0000000000000000000000000000000000000000000000000000000000001234',
  districtId: '0x0000000000000000000000000000000000000000000000000000000000000042',
  authorityLevel: 1 as AuthorityLevel,
  registrationSalt: '0x0000000000000000000000000000000000000000000000000000000000000099',
  actionDomain: '0x0000000000000000000000000000000000000000000000000000000000000001',
  leafIndex: 0,
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
        PRECOMPUTED_FIXTURE.merklePath = computed.merklePath;
        precomputedLoaded = true;
      }

      return computed;
    })();
    precomputedPromises.set(depth, computePromise);
  }

  return computePromise;
}
