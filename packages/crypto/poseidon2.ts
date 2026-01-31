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

  // BN254 scalar field modulus
  private static readonly BN254_MODULUS = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');

  private readonly noir: Noir;
  private initialized = false;

  /**
   * Private constructor - use getInstance() instead
   */
  private constructor(noir: Noir) {
    this.noir = noir;
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
   * Initialize the Noir circuit (called once per process)
   */
  private static async initialize(): Promise<Poseidon2Hasher> {
    const circuit = fixturesCircuit as unknown as CompiledCircuit;
    const noir = new Noir(circuit);
    const instance = new Poseidon2Hasher(noir);
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
   * Hash a single field element: Poseidon2(value, 0, 0, 0)
   *
   * @param value - Input value (bigint or hex string)
   * @returns Poseidon2 hash as bigint
   */
  async hashSingle(value: bigint | string): Promise<bigint> {
    const inputs = [
      this.toHex(value),
      ZERO_PAD,
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
   * Hash four field elements: Poseidon2(a, b, c, d)
   *
   * @param a - First input
   * @param b - Second input
   * @param c - Third input
   * @param d - Fourth input
   * @returns Poseidon2 hash as bigint
   */
  async hash4(
    a: bigint | string,
    b: bigint | string,
    c: bigint | string,
    d: bigint | string
  ): Promise<bigint> {
    const inputs = [
      this.toHex(a),
      this.toHex(b),
      this.toHex(c),
      this.toHex(d),
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
