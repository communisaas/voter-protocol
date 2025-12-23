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
import fixturesCircuit from './noir/fixtures/target/fixtures.json';

/**
 * Zero padding constant for hash inputs
 */
const ZERO_PAD = '0x' + '00'.repeat(32);

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
      Poseidon2Hasher.initPromise = Poseidon2Hasher.initialize();
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
   * Hash two field elements: Poseidon2(left, right, 0, 0)
   *
   * Matches the circuit: poseidon2_permutation([left, right, 0, 0], 4)[0]
   *
   * @param left - Left input (bigint or hex string)
   * @param right - Right input (bigint or hex string)
   * @returns Poseidon2 hash as bigint
   */
  async hashPair(left: bigint | string, right: bigint | string): Promise<bigint> {
    const inputs = [
      this.toHex(left),
      this.toHex(right),
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
   * Chunking strategy for strings > 31 bytes:
   * - UTF-8 encode string
   * - Split into 31-byte chunks (safe for 254-bit BN254 field)
   * - Hash iteratively: hash(chunk[0], chunk[1]) → hash(result, chunk[2]) → ...
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

    if (chunks.length === 0) {
      return this.hashSingle(0n);
    } else if (chunks.length === 1) {
      return this.hashSingle(chunks[0]);
    } else {
      // Iterative hashing for multi-chunk strings
      let hash = await this.hashPair(chunks[0], chunks[1]);
      for (let i = 2; i < chunks.length; i++) {
        hash = await this.hashPair(hash, chunks[i]);
      }
      return hash;
    }
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
   * Convert value to 0x-prefixed 64-char hex string
   */
  private toHex(value: bigint | string): string {
    if (typeof value === 'string') {
      if (value.startsWith('0x')) {
        // Pad to 64 chars
        return '0x' + value.slice(2).padStart(64, '0');
      }
      return '0x' + value.padStart(64, '0');
    }
    return '0x' + value.toString(16).padStart(64, '0');
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
