/**
 * Poseidon2 Hasher - Singleton wrapper for Noir fixtures circuit
 *
 * Provides efficient Poseidon2 hashing using the Noir stdlib implementation
 * via @noir-lang/noir_js. Uses a singleton pattern to avoid re-initializing
 * the WASM circuit for each hash operation.
 *
 * PERFORMANCE OPTIMIZATIONS:
 * 1. Singleton pattern - Noir instance initialized once, reused
 * 2. Batch hashing - Process multiple pairs concurrently with Promise.all()
 * 3. Configurable concurrency - Tune parallelism for different environments
 * 4. Pre-allocated hex conversion - Reduce string allocations
 *
 * SECURITY:
 * - Uses EXACT same Poseidon2 implementation as ZK circuit (Noir stdlib)
 * - Deterministic output guarantees TypeScript roots match circuit verification
 * - No divergence possible since both use identical Noir code
 */

import { Noir } from '@noir-lang/noir_js';
import type { CompiledCircuit } from '@noir-lang/noir_js';

// Import the compiled fixtures circuit (Poseidon2 hash wrapper)
// Node.js 22+ requires import attributes for JSON modules
import fixturesCircuit from './noir/fixtures/target/fixtures.json' with { type: 'json' };
import spongeHelperCircuit from './noir/sponge_helper/target/sponge_helper.json' with { type: 'json' };

/**
 * Zero padding constant for hash inputs
 */
const ZERO_PAD = '0x' + '00'.repeat(32);

/**
 * Domain separation tag for hashPair (BA-003).
 * Matches circuit: global DOMAIN_HASH2: Field = 0x48324d;  // "H2M" marker
 */
const DOMAIN_HASH2 = '0x' + (0x48324d).toString(16).padStart(64, '0');

/**
 * Domain separation tag for hashSingle (SA-007).
 * Prevents collision between hashSingle(x) and hash4(x, 0, 0, 0).
 * Tag value: 0x48314d = "H1M" (Hash-1 Marker)
 */
const DOMAIN_HASH1 = '0x' + (0x48314d).toString(16).padStart(64, '0');

/**
 * Domain separation tag for hash3 (3-input hash, two-tree architecture).
 * Prevents collision between hash3(a, b, c) and hash4(a, b, c, 0).
 * Tag value: 0x48334d = "H3M" (Hash-3 Marker)
 */
const DOMAIN_HASH3 = '0x' + (0x48334d).toString(16).padStart(64, '0');

/**
 * Domain separation tag for hash4 (4-input hash, BR5-001 authority binding).
 * Tag value: 0x48344d = "H4M" (Hash-4 Marker)
 * Used for user leaf computation: hash4(user_secret, cell_id, registration_salt, authority_level)
 *
 * 2-round sponge construction:
 *   Round 1: permute([DOMAIN_HASH4, a, b, c])
 *   Round 2: state[1] += d, permute(state), return state[0]
 *
 * Must match Noir circuit: global DOMAIN_HASH4: Field = 0x48344d
 */
const DOMAIN_HASH4 = '0x' + (0x48344d).toString(16).padStart(64, '0');

/**
 * Domain separation tag for Poseidon2 sponge with 24 inputs.
 * Prevents collision between sponge(24 inputs) and other hash functions.
 * Tag value: 0x534f4e4745_24 = "SONGE" (ASCII) + "_24" (hex suffix for 24 districts)
 *
 * Breakdown:
 * - 0x53 = 'S'
 * - 0x4f = 'O'
 * - 0x4e = 'N'
 * - 0x47 = 'G'
 * - 0x45 = 'E'
 * - 0x5f = '_'
 * - 0x24 = 36 decimal (hex representation of "24")
 */
const DOMAIN_SPONGE_24 = '0x' + (0x534f4e47455f24n).toString(16).padStart(64, '0');

/**
 * Default concurrency for batch operations
 * Higher values = more parallelism, but may cause memory pressure
 */
const DEFAULT_BATCH_SIZE = 64;

/**
 * Poseidon2Hasher - Singleton for efficient Poseidon2 hashing
 *
 * USAGE:
 * ```typescript
 * const hasher = await Poseidon2Hasher.getInstance();
 * const hash = await hasher.hashPair(left, right);
 * const hashes = await hasher.hashPairsBatch(pairs, 32); // batch with concurrency
 * ```
 */
export class Poseidon2Hasher {
  private static instance: Poseidon2Hasher | null = null;
  private static initPromise: Promise<Poseidon2Hasher> | null = null;

  // BN254 scalar field modulus (exported for validation in dependent packages)
  public static readonly BN254_MODULUS = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');

  private readonly noir: Noir;
  private readonly spongeHelperNoir: Noir;
  private initialized = false;

  /**
   * Private constructor - use getInstance() instead
   */
  private constructor(noir: Noir, spongeHelperNoir: Noir) {
    this.noir = noir;
    this.spongeHelperNoir = spongeHelperNoir;
  }

  /**
   * Get singleton instance (thread-safe initialization)
   *
   * First call initializes the Noir circuit, subsequent calls return cached instance.
   * Uses promise-based locking to prevent double initialization.
   */
  static async getInstance(): Promise<Poseidon2Hasher> {
    if (Poseidon2Hasher.instance?.initialized) {
      return Poseidon2Hasher.instance;
    }

    // Prevent double initialization with promise lock
    if (!Poseidon2Hasher.initPromise) {
      Poseidon2Hasher.initPromise = Poseidon2Hasher.initialize().catch((err) => {
        // BA-015 FIX: Clear promise on failure so next call retries
        Poseidon2Hasher.initPromise = null;
        throw err;
      });
    }

    return Poseidon2Hasher.initPromise;
  }

  /**
   * Initialize the Noir circuits (called once per process)
   */
  private static async initialize(): Promise<Poseidon2Hasher> {
    const circuit = fixturesCircuit as unknown as CompiledCircuit;
    const noir = new Noir(circuit);

    const spongeCircuit = spongeHelperCircuit as unknown as CompiledCircuit;
    const spongeHelperNoir = new Noir(spongeCircuit);

    const instance = new Poseidon2Hasher(noir, spongeHelperNoir);
    instance.initialized = true;
    Poseidon2Hasher.instance = instance;
    return instance;
  }

  /**
   * Reset singleton (for testing only)
   */
  static resetInstance(): void {
    Poseidon2Hasher.instance = null;
    Poseidon2Hasher.initPromise = null;
  }

  /**
   * Hash two field elements: Poseidon2(left, right, DOMAIN_HASH2, 0)
   *
   * Matches the circuit: poseidon2_permutation([left, right, 0x48324d, 0], 4)[0]
   * BA-003: Third state element carries the "H2M" domain separation tag to
   * distinguish pair-hashing from single/quad modes in the Noir circuit.
   *
   * @param left - Left input (bigint or hex string)
   * @param right - Right input (bigint or hex string)
   * @returns Poseidon2 hash as bigint
   */
  async hashPair(left: bigint | string, right: bigint | string): Promise<bigint> {
    const inputs = [
      this.toHex(left),
      this.toHex(right),
      DOMAIN_HASH2,   // BA-003: Domain separation tag matching circuit
      ZERO_PAD,
    ];

    const result = await this.noir.execute({ inputs });
    const returnValue = (result as { returnValue?: string }).returnValue ??
      (result as { return_value?: string }).return_value;

    if (!returnValue) {
      throw new Error('Noir circuit returned no value');
    }

    return BigInt(returnValue);
  }

  /**
   * Hash a single field element: Poseidon2(value, DOMAIN_HASH1, 0, 0)
   *
   * SA-007 FIX: Now includes DOMAIN_HASH1 in slot 1 for domain separation.
   * This prevents collision with hash4(value, 0, 0, 0).
   *
   * @param value - Input value (bigint or hex string)
   * @returns Poseidon2 hash as bigint
   */
  async hashSingle(value: bigint | string): Promise<bigint> {
    const inputs = [
      this.toHex(value),
      DOMAIN_HASH1,   // SA-007: Domain tag in slot 1 to prevent collision with hash4
      ZERO_PAD,
      ZERO_PAD,
    ];

    const result = await this.noir.execute({ inputs });
    const returnValue = (result as { returnValue?: string }).returnValue ??
      (result as { return_value?: string }).return_value;

    if (!returnValue) {
      throw new Error('Noir circuit returned no value');
    }

    return BigInt(returnValue);
  }

  /**
   * Hash three field elements: Poseidon2(a, b, c, DOMAIN_HASH3)
   *
   * Two-tree architecture: Used for user leaf computation
   * user_leaf = hash3(user_secret, cell_id, registration_salt)
   *
   * Domain separation: DOMAIN_HASH3 (0x48334d = "H3M") in slot 3 prevents
   * collision with hash4(a, b, c, 0).
   *
   * @param a - First input
   * @param b - Second input
   * @param c - Third input
   * @returns Poseidon2 hash as bigint
   */
  async hash3(
    a: bigint | string,
    b: bigint | string,
    c: bigint | string
  ): Promise<bigint> {
    const inputs = [
      this.toHex(a),
      this.toHex(b),
      this.toHex(c),
      DOMAIN_HASH3,   // Domain tag in slot 3 to prevent collision with hash4
    ];

    const result = await this.noir.execute({ inputs });
    const returnValue = (result as { returnValue?: string }).returnValue ??
      (result as { return_value?: string }).return_value;

    if (!returnValue) {
      throw new Error('Noir circuit returned no value');
    }

    return BigInt(returnValue);
  }

  /**
   * Hash four field elements using 2-round Poseidon2 sponge (BR5-001).
   *
   * Matches Noir circuit poseidon2_hash4:
   *   Round 1: state = permute([DOMAIN_HASH4, a, b, c])
   *   Round 2: state[1] += d, state = permute(state), return state[0]
   *
   * Used for user leaf: hash4(user_secret, cell_id, registration_salt, authority_level)
   *
   * @param a - First input (user_secret)
   * @param b - Second input (cell_id)
   * @param c - Third input (registration_salt)
   * @param d - Fourth input (authority_level)
   * @returns Poseidon2 hash as bigint
   */
  async hash4(
    a: bigint | string,
    b: bigint | string,
    c: bigint | string,
    d: bigint | string
  ): Promise<bigint> {
    // Round 1: permute([DOMAIN_HASH4, a, b, c]) — uses sponge helper for full state
    const round1Inputs = [
      DOMAIN_HASH4,
      this.toHex(a),
      this.toHex(b),
      this.toHex(c),
    ];

    const r1 = await this.spongeHelperNoir.execute({ inputs: round1Inputs });
    const r1State = (r1 as { returnValue?: string[] }).returnValue ??
      (r1 as { return_value?: string[] }).return_value;

    if (!r1State || !Array.isArray(r1State) || r1State.length !== 4) {
      throw new Error('Sponge helper circuit returned invalid state array');
    }

    // Round 2: state[1] += d, then permute — uses fixtures for state[0] only
    const s1PlusD = (BigInt(r1State[1]) + BigInt(this.toHex(d))) % Poseidon2Hasher.BN254_MODULUS;
    const round2Inputs = [
      r1State[0],
      this.toHex(s1PlusD),
      r1State[2],
      r1State[3],
    ];

    const r2 = await this.noir.execute({ inputs: round2Inputs });
    const returnValue = (r2 as { returnValue?: string }).returnValue ??
      (r2 as { return_value?: string }).return_value;

    if (!returnValue) {
      throw new Error('Noir circuit returned no value');
    }

    return BigInt(returnValue);
  }

  /**
   * Batch hash multiple pairs with controlled concurrency
   *
   * PARALLELISM STRATEGY:
   * - Divides pairs into batches of size `batchSize`
   * - Each batch runs concurrently with Promise.all()
   * - Batches run sequentially to prevent memory pressure
   *
   * @param pairs - Array of [left, right] pairs to hash
   * @param batchSize - Max concurrent operations (default: 64)
   * @returns Array of hashes in same order as input pairs
   */
  async hashPairsBatch(
    pairs: ReadonlyArray<readonly [bigint, bigint]>,
    batchSize: number = DEFAULT_BATCH_SIZE
  ): Promise<bigint[]> {
    const results: bigint[] = new Array(pairs.length);

    // Process in batches to control memory usage
    for (let i = 0; i < pairs.length; i += batchSize) {
      const batch = pairs.slice(i, Math.min(i + batchSize, pairs.length));

      const batchResults = await Promise.all(
        batch.map(([left, right]) => this.hashPair(left, right))
      );

      // Copy results to output array
      for (let j = 0; j < batchResults.length; j++) {
        results[i + j] = batchResults[j];
      }
    }

    return results;
  }

  /**
   * Batch hash multiple single values with controlled concurrency
   *
   * @param values - Array of values to hash
   * @param batchSize - Max concurrent operations (default: 64)
   * @returns Array of hashes in same order as input values
   */
  async hashSinglesBatch(
    values: ReadonlyArray<bigint | string>,
    batchSize: number = DEFAULT_BATCH_SIZE
  ): Promise<bigint[]> {
    const results: bigint[] = new Array(values.length);

    for (let i = 0; i < values.length; i += batchSize) {
      const batch = values.slice(i, Math.min(i + batchSize, values.length));

      const batchResults = await Promise.all(
        batch.map((value) => this.hashSingle(value))
      );

      for (let j = 0; j < batchResults.length; j++) {
        results[i + j] = batchResults[j];
      }
    }

    return results;
  }

  /**
   * Poseidon2 sponge construction for absorbing 24 field elements.
   * Rate = 3 (absorb 3 fields per round), Capacity = 1.
   * State width = 4 (matches Poseidon2 permutation width).
   *
   * CRITICAL: State elements are ADDED TO, not overwritten.
   * The spec (v0.1) had a bug that overwrote state — this is the correct version.
   *
   * ALGORITHM:
   * 1. Initialize state with domain tag in capacity element: [DOMAIN_SPONGE_24, 0, 0, 0]
   * 2. For each chunk of 3 inputs:
   *    - ADD inputs to rate elements (state[1], state[2], state[3])
   *    - Apply full Poseidon2 permutation
   * 3. Handle remaining inputs (if not multiple of 3) by padding with zeros
   * 4. Squeeze: return state[0] as output
   *
   * SECURITY NOTE: Adding to state (not overwriting) ensures proper chaining between
   * rounds. Overwriting would discard the cryptographic state and create collision
   * vulnerabilities (see TWO-TREE-AGENT-REVIEW-SUMMARY.md BLOCKER-3).
   *
   * @param inputs - Array of exactly 24 field elements (district IDs)
   * @param domainTag - Domain separation tag (default: DOMAIN_SPONGE_24)
   * @returns Poseidon2 sponge output as bigint (district commitment)
   */
  async poseidon2Sponge(
    inputs: bigint[],
    domainTag: bigint = BigInt(DOMAIN_SPONGE_24)
  ): Promise<bigint> {
    // Validate input length (24 districts for two-tree architecture)
    if (inputs.length !== 24) {
      throw new Error(`poseidon2Sponge expects 24 inputs, got ${inputs.length}`);
    }

    // Validate all inputs are valid field elements
    for (let i = 0; i < inputs.length; i++) {
      if (inputs[i] < 0n) {
        throw new Error(`Input ${i} is negative: ${inputs[i]}`);
      }
      if (inputs[i] >= Poseidon2Hasher.BN254_MODULUS) {
        throw new Error(`Input ${i} exceeds BN254 field modulus: ${inputs[i]}`);
      }
    }

    // Initialize state: capacity element (state[0]) = domain tag, rate elements = 0
    let state = [
      domainTag % Poseidon2Hasher.BN254_MODULUS,
      0n,
      0n,
      0n,
    ];

    // Absorb phase: Process 3 inputs per round (rate = 3)
    // 24 inputs / 3 rate = 8 rounds
    for (let i = 0; i < 8; i++) {
      // ADD inputs to state (NOT overwrite) - this is the correct sponge construction
      state[1] = (state[1] + inputs[i * 3]) % Poseidon2Hasher.BN254_MODULUS;
      state[2] = (state[2] + inputs[i * 3 + 1]) % Poseidon2Hasher.BN254_MODULUS;
      state[3] = (state[3] + inputs[i * 3 + 2]) % Poseidon2Hasher.BN254_MODULUS;

      // Apply full Poseidon2 permutation using sponge_helper circuit
      // This circuit returns all 4 state elements (not just state[0])
      const stateHex = state.map(x => this.toHex(x));
      const result = await this.spongeHelperNoir.execute({ inputs: stateHex });

      // Extract the return value - it's an array of 4 field elements
      const returnValue = (result as { returnValue?: string[] }).returnValue ??
        (result as { return_value?: string[] }).return_value;

      if (!returnValue || !Array.isArray(returnValue) || returnValue.length !== 4) {
        throw new Error('Sponge helper circuit returned invalid state array');
      }

      // Update state with full permutation output
      state = returnValue.map(x => BigInt(x));
    }

    // Squeeze phase: return state[0]
    return state[0];
  }

  /**
   * Hash a string to BN254 field element
   *
   * Chunking strategy:
   * - UTF-8 encode string
   * - Split into 31-byte chunks (safe for 254-bit BN254 field)
   * - Commit to byte length first, then fold in chunks iteratively:
   *     hash = hashSingle(length)
   *     hash = hashPair(hash, chunk[0])
   *     hash = hashPair(hash, chunk[1])
   *     ...
   *
   * LENGTH PREFIX (BA-022 fix):
   * Without a length commitment, "" and "\x00" both reduce to hashSingle(0n).
   * More generally, any two strings whose chunk representations share a common
   * suffix (due to trailing zero bytes) could collide. Hashing the byte length
   * as the first element makes every distinct string length a separate domain,
   * eliminating this class of collision.
   *
   * @param str - String to hash
   * @returns Poseidon2 hash as bigint
   */
  async hashString(str: string): Promise<bigint> {
    const bytes = Buffer.from(str, 'utf-8');
    const chunks: bigint[] = [];

    // Split into 31-byte chunks (31 * 8 = 248 bits < 254-bit BN254 field)
    for (let i = 0; i < bytes.length; i += 31) {
      const chunk = bytes.subarray(i, Math.min(i + 31, bytes.length));
      chunks.push(BigInt('0x' + chunk.toString('hex')));
    }

    // BA-022: Start with the byte length to guarantee domain separation.
    // This ensures "" (length 0) and "\x00" (length 1) hash differently,
    // and prevents all trailing-zero-byte collision classes.
    let hash = await this.hashSingle(BigInt(bytes.length));

    for (const chunk of chunks) {
      hash = await this.hashPair(hash, chunk);
    }

    return hash;
  }

  /**
   * Batch hash multiple strings with controlled concurrency
   *
   * @param strings - Array of strings to hash
   * @param batchSize - Max concurrent operations (default: 64)
   * @returns Array of hashes in same order as input strings
   */
  async hashStringsBatch(
    strings: ReadonlyArray<string>,
    batchSize: number = DEFAULT_BATCH_SIZE
  ): Promise<bigint[]> {
    const results: bigint[] = new Array(strings.length);

    for (let i = 0; i < strings.length; i += batchSize) {
      const batch = strings.slice(i, Math.min(i + batchSize, strings.length));

      const batchResults = await Promise.all(
        batch.map((str) => this.hashString(str))
      );

      for (let j = 0; j < batchResults.length; j++) {
        results[i + j] = batchResults[j];
      }
    }

    return results;
  }

  /**
   * Convert value to 0x-prefixed 64-char hex string.
   * BA-016: Validates hex characters, rejects negative bigints,
   * and enforces BN254 field modulus bound.
   */
  private toHex(value: bigint | string): string {
    if (typeof value === 'bigint') {
      if (value < 0n) {
        throw new Error(`Negative bigint not allowed: ${value}`);
      }
      if (value >= Poseidon2Hasher.BN254_MODULUS) {
        throw new Error(`Value exceeds BN254 field modulus: ${value}`);
      }
      return '0x' + value.toString(16).padStart(64, '0');
    }
    // String path
    const hex = value.startsWith('0x') ? value.slice(2) : value;
    if (!/^[0-9a-fA-F]*$/.test(hex)) {
      throw new Error(`Invalid hex string: ${value}`);
    }
    const padded = hex.padStart(64, '0');
    // Validate field range
    const asBigInt = BigInt('0x' + padded);
    if (asBigInt >= Poseidon2Hasher.BN254_MODULUS) {
      throw new Error(`Value exceeds BN254 field modulus: 0x${padded}`);
    }
    return '0x' + padded;
  }
}

/**
 * Convenience function: Get hasher instance
 */
export async function getHasher(): Promise<Poseidon2Hasher> {
  return Poseidon2Hasher.getInstance();
}

/**
 * Convenience function: Hash pair (one-off usage)
 */
export async function hashPair(left: bigint, right: bigint): Promise<bigint> {
  const hasher = await Poseidon2Hasher.getInstance();
  return hasher.hashPair(left, right);
}

/**
 * Convenience function: Hash three elements (one-off usage)
 */
export async function hash3(a: bigint, b: bigint, c: bigint): Promise<bigint> {
  const hasher = await Poseidon2Hasher.getInstance();
  return hasher.hash3(a, b, c);
}

/**
 * Convenience function: Hash four elements (one-off usage)
 * Two-tree architecture: user_leaf = hash4(user_secret, cell_id, salt, authority_level)
 */
export async function hash4(a: bigint, b: bigint, c: bigint, d: bigint): Promise<bigint> {
  const hasher = await Poseidon2Hasher.getInstance();
  return hasher.hash4(a, b, c, d);
}

/**
 * Convenience function: Hash single (one-off usage)
 */
export async function hashSingle(value: bigint): Promise<bigint> {
  const hasher = await Poseidon2Hasher.getInstance();
  return hasher.hashSingle(value);
}

/**
 * Convenience function: Hash string (one-off usage)
 */
export async function hashString(str: string): Promise<bigint> {
  const hasher = await Poseidon2Hasher.getInstance();
  return hasher.hashString(str);
}

/**
 * Convenience function: Poseidon2 sponge (one-off usage)
 */
export async function poseidon2Sponge(inputs: bigint[], domainTag?: bigint): Promise<bigint> {
  const hasher = await Poseidon2Hasher.getInstance();
  return hasher.poseidon2Sponge(inputs, domainTag);
}
