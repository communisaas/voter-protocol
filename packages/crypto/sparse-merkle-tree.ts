/**
 * Sparse Merkle Tree (SMT) - Two-Tree Architecture Component
 *
 * CRITICAL BLOCKER RESOLUTION: This is Tree 2 of the Two-Tree Architecture.
 * Everything downstream (circuits, contracts, Shadow Atlas, client integration)
 * depends on this implementation.
 *
 * PURPOSE:
 * Maps Census Tract cell IDs (~242K in the US) to their 24-slot district arrays.
 * Uses sparse structure because:
 * - Cell IDs are not sequential (e.g., Census FIPS codes like 06075061200)
 * - Position in tree is deterministic from cell_id (hash-based)
 * - Supports efficient non-membership proofs (empty subtrees)
 * - Enables efficient redistricting updates (only changed cells need recalculation)
 *
 * SECURITY:
 * - Uses EXACT same Poseidon2 as ZK circuit (Noir stdlib via @noir-lang/noir_js)
 * - Collision handling via overflow chaining (birthday paradox mitigation)
 * - Empty hash precomputation for zero-knowledge proofs
 * - Domain separation tags prevent cross-context collisions
 *
 * INTEGRATION:
 * - Works with existing Poseidon2Hasher singleton
 * - Follows patterns from ShadowAtlasMerkleTree (dense tree)
 * - Async operations for WASM hash execution
 *
 * @packageDocumentation
 */

import { Poseidon2Hasher } from './poseidon2.js';

/**
 * Field type for BN254 scalar field elements
 */
export type Field = bigint;

/**
 * Sparse Merkle Tree proof for ZK circuit verification
 *
 * A proof consists of:
 * - The key being proven (cell_id)
 * - The value stored at that key (district commitment)
 * - Sibling hashes along the path from leaf to root
 * - Path bits (0=left, 1=right) derived from position
 * - The root hash for verification
 * - Attempt counter for collision handling
 */
export interface SMTProof {
  /** Key being proven (e.g., cell_id) */
  readonly key: Field;
  /** Value at this key (e.g., district commitment hash) */
  readonly value: Field;
  /** Sibling hashes from leaf to root (length = depth) */
  readonly siblings: readonly Field[];
  /** Path direction bits: 0 = left child, 1 = right child */
  readonly pathBits: readonly number[];
  /** Root hash this proof verifies against */
  readonly root: Field;
  /** Collision handling: attempt counter for position derivation */
  readonly attempt: number;
}

/**
 * Configuration for SMT construction
 */
export interface SMTConfig {
  /** Tree depth (default: 20 for 1M capacity) */
  readonly depth?: number;
  /** Optional: Poseidon2Hasher instance (creates new if not provided) */
  readonly hasher?: Poseidon2Hasher;
}

/**
 * Internal node storage
 */
interface SMTNode {
  key: Field;
  value: Field;
  attempt: number; // Collision handling counter
}

/**
 * Sparse Merkle Tree Implementation
 *
 * POSITION DERIVATION:
 * position = hash(key, attempt) mod 2^depth
 *
 * COLLISION HANDLING (HIGH-1 fix):
 * With 242K cells → 2^20 positions, birthday paradox collisions are ~34% probable.
 * We use overflow chaining:
 *   1. Try position = hash(key, 0)
 *   2. If occupied by different key, try position = hash(key, 1)
 *   3. Repeat until empty slot found or max attempts exceeded
 *
 * EMPTY HASH PRECOMPUTATION:
 * Empty nodes have deterministic hashes computed recursively:
 *   empty[0] = 0 (empty leaf)
 *   empty[i] = hash(empty[i-1], empty[i-1])
 *
 * PATH BIT ENCODING:
 * Path bits are derived from position (not from key directly):
 *   bit[i] = (position >> i) & 1
 * These bits navigate left (0) or right (1) at each tree level.
 */
export class SparseMerkleTree {
  private readonly depth: number;
  private readonly hasher: Poseidon2Hasher;
  private readonly emptyHashes: Field[];
  private readonly nodes: Map<number, SMTNode>; // position → node
  private readonly keyToPosition: Map<string, number>; // key string → position
  private rootCache: Field | null = null;
  private subtreeCache: Map<string, Field>; // Memoization for subtree hashes

  /** Maximum collision attempts before failing */
  private static readonly MAX_ATTEMPTS = 16;

  /** Domain separation tag for empty cell hashing */
  private static readonly EMPTY_CELL_TAG = 0x454d50545943454c4cn; // "EMPTYCELL"

  /**
   * Private constructor - use create() factory instead
   */
  private constructor(depth: number, hasher: Poseidon2Hasher, emptyHashes: Field[]) {
    if (depth < 1 || depth > 32) {
      throw new Error(`Invalid depth: ${depth}. Valid range: 1-32`);
    }
    this.depth = depth;
    this.hasher = hasher;
    this.emptyHashes = emptyHashes;
    this.nodes = new Map();
    this.keyToPosition = new Map();
    this.subtreeCache = new Map();
  }

  /**
   * Create a new Sparse Merkle Tree (async factory)
   *
   * @param config - Optional configuration (depth, hasher)
   * @returns Promise<SparseMerkleTree>
   */
  static async create(config: SMTConfig = {}): Promise<SparseMerkleTree> {
    const depth = config.depth ?? 20; // Default: 2^20 = 1M capacity
    const hasher = config.hasher ?? (await Poseidon2Hasher.getInstance());

    // Precompute empty hashes for all levels
    const emptyHashes = await SparseMerkleTree.computeEmptyHashes(depth, hasher);

    return new SparseMerkleTree(depth, hasher, emptyHashes);
  }

  /**
   * Precompute empty subtree hashes for each depth level
   *
   * Level 0 (leaf): hash(EMPTY_CELL_TAG, 0) for domain separation
   * Level i (node): hash(empty[i-1], empty[i-1])
   *
   * This enables efficient proof generation for non-existent keys.
   */
  private static async computeEmptyHashes(
    depth: number,
    hasher: Poseidon2Hasher
  ): Promise<Field[]> {
    const hashes: Field[] = new Array(depth + 1);

    // Empty leaf: hash with domain separation tag
    hashes[0] = await hasher.hashPair(
      BigInt(SparseMerkleTree.EMPTY_CELL_TAG),
      0n
    );

    // Empty nodes: recursive hash(empty[i-1], empty[i-1])
    for (let i = 1; i <= depth; i++) {
      hashes[i] = await hasher.hashPair(hashes[i - 1], hashes[i - 1]);
    }

    return hashes;
  }

  /**
   * Compute position for a key with collision handling
   *
   * Position = hash(key, attempt) mod 2^depth
   *
   * The attempt counter is incremented on collisions to find the next
   * available position. This deterministic overflow chaining ensures:
   * - Same key always maps to same position (with same attempt)
   * - Different keys rarely collide (birthday paradox bound)
   * - Collisions are resolved transparently
   *
   * @param key - Key to position (e.g., cell_id)
   * @param attempt - Collision counter (default: 0)
   * @returns Position in tree [0, 2^depth)
   */
  private async computePosition(key: Field, attempt: number = 0): Promise<number> {
    // Hash key with attempt counter for collision handling
    const hash = await this.hasher.hashPair(key, BigInt(attempt));

    // Take lower 'depth' bits as position
    const mask = (1n << BigInt(this.depth)) - 1n;
    const position = Number(hash & mask);

    return position;
  }

  /**
   * Find available position for key (handles collisions)
   *
   * Tries positions hash(key, 0), hash(key, 1), ... until finding:
   * - Empty position, OR
   * - Position already occupied by this same key
   *
   * @param key - Key to insert
   * @returns { position, attempt } or throws if max attempts exceeded
   */
  private async findPosition(key: Field): Promise<{ position: number; attempt: number }> {
    const keyStr = key.toString();

    // Check if key already exists
    const existingPosition = this.keyToPosition.get(keyStr);
    if (existingPosition !== undefined) {
      const node = this.nodes.get(existingPosition);
      return { position: existingPosition, attempt: node!.attempt };
    }

    // Find empty position with collision handling
    for (let attempt = 0; attempt < SparseMerkleTree.MAX_ATTEMPTS; attempt++) {
      const position = await this.computePosition(key, attempt);

      const existingNode = this.nodes.get(position);
      if (!existingNode || existingNode.key === key) {
        return { position, attempt };
      }
    }

    throw new Error(
      `SMT collision overflow: Could not find position for key ${key} after ${SparseMerkleTree.MAX_ATTEMPTS} attempts`
    );
  }

  /**
   * Insert or update a key-value pair in the tree
   *
   * If key exists, updates its value.
   * If key is new, finds available position via collision handling.
   *
   * IMPORTANT: Invalidates root cache. Call getRoot() to recompute.
   *
   * @param key - Key (e.g., cell_id)
   * @param value - Value (e.g., district commitment)
   */
  async insert(key: Field, value: Field): Promise<void> {
    if (key < 0n) {
      throw new Error('Key must be non-negative');
    }

    const { position, attempt } = await this.findPosition(key);

    // Store node
    this.nodes.set(position, { key, value, attempt });
    this.keyToPosition.set(key.toString(), position);

    // Invalidate caches
    this.rootCache = null;
    this.subtreeCache.clear();
  }

  /**
   * Get value for a key
   *
   * @param key - Key to lookup
   * @returns Value if key exists, undefined otherwise
   */
  get(key: Field): Field | undefined {
    const position = this.keyToPosition.get(key.toString());
    if (position === undefined) {
      return undefined;
    }

    const node = this.nodes.get(position);
    return node?.value;
  }

  /**
   * Check if key exists in tree
   */
  has(key: Field): boolean {
    return this.keyToPosition.has(key.toString());
  }

  /**
   * Get number of keys in tree
   */
  size(): number {
    return this.nodes.size;
  }

  /**
   * Get tree depth
   */
  getDepth(): number {
    return this.depth;
  }

  /**
   * Get tree capacity (2^depth)
   */
  getCapacity(): number {
    return 2 ** this.depth;
  }

  /**
   * Get current root hash
   *
   * Computes root by building tree bottom-up from stored nodes.
   * Uses cached value if tree hasn't changed since last call.
   *
   * @returns Root hash
   */
  async getRoot(): Promise<Field> {
    if (this.rootCache !== null) {
      return this.rootCache;
    }

    this.rootCache = await this.computeRoot();
    return this.rootCache;
  }

  /**
   * Compute root hash iteratively from leaves to root
   *
   * For sparse trees with few nodes, we:
   * 1. Track only necessary node positions
   * 2. Use precomputed empty hashes for missing positions
   * 3. Build tree level-by-level in batches for parallelism
   */
  private async computeRoot(): Promise<Field> {
    if (this.nodes.size === 0) {
      return this.emptyHashes[this.depth];
    }

    // Initialize cache with leaf level
    let currentLevel = new Map<number, Field>();
    for (const [position, node] of this.nodes.entries()) {
      currentLevel.set(position, node.value);
    }

    // Build tree bottom-up
    for (let level = 0; level < this.depth; level++) {
      const nextLevel = new Map<number, Field>();

      // Find all parent positions we need to compute
      const parentPositions = new Set<number>();
      for (const position of currentLevel.keys()) {
        parentPositions.add(Math.floor(position / 2));
      }

      // Compute hash for each parent
      const pairs: Array<{ position: number; left: Field; right: Field }> = [];

      for (const parentPos of parentPositions) {
        const leftPos = parentPos * 2;
        const rightPos = parentPos * 2 + 1;

        const left = currentLevel.get(leftPos) ?? this.emptyHashes[level];
        const right = currentLevel.get(rightPos) ?? this.emptyHashes[level];

        pairs.push({ position: parentPos, left, right });
      }

      // Hash all pairs (could parallelize here for large trees)
      for (const { position, left, right } of pairs) {
        const hash = await this.hasher.hashPair(left, right);
        nextLevel.set(position, hash);
      }

      currentLevel = nextLevel;
    }

    // Root should be at position 0
    return currentLevel.get(0) ?? this.emptyHashes[this.depth];
  }

  /**
   * Compute hash of subtree at given position and level (with memoization)
   *
   * Used for generating proof siblings. Walks down the tree recursively.
   *
   * @param position - Position in current level
   * @param level - Current level (0 = leaves)
   * @returns Hash of subtree
   */
  private async computeSubtreeHash(position: number, level: number): Promise<Field> {
    // Check cache first
    const cacheKey = `${level}:${position}`;
    if (this.subtreeCache.has(cacheKey)) {
      return this.subtreeCache.get(cacheKey)!;
    }

    let hash: Field;

    if (level === 0) {
      // Leaf level
      const node = this.nodes.get(position);
      hash = node ? node.value : this.emptyHashes[0];
    } else {
      // Internal node: recursively compute children
      const leftPos = position * 2;
      const rightPos = position * 2 + 1;

      const leftHash = await this.computeSubtreeHash(leftPos, level - 1);
      const rightHash = await this.computeSubtreeHash(rightPos, level - 1);

      hash = await this.hasher.hashPair(leftHash, rightHash);
    }

    // Cache result
    this.subtreeCache.set(cacheKey, hash);
    return hash;
  }

  /**
   * Generate Merkle proof for a key
   *
   * For membership proof (key exists):
   * - Walks from leaf position to root
   * - Collects sibling hashes (computed recursively if needed)
   * - Derives path bits from position
   *
   * For non-membership proof (key doesn't exist):
   * - Uses empty hashes at expected position
   * - Proof verifies that position is empty
   *
   * @param key - Key to prove
   * @returns SMT proof
   */
  async getProof(key: Field): Promise<SMTProof> {
    const keyStr = key.toString();
    const existingPosition = this.keyToPosition.get(keyStr);

    let position: number;
    let attempt: number;
    let value: Field;

    if (existingPosition !== undefined) {
      // Membership proof: key exists
      const node = this.nodes.get(existingPosition)!;
      position = existingPosition;
      attempt = node.attempt;
      value = node.value;
    } else {
      // Non-membership proof: key doesn't exist
      // Use attempt=0 and empty value
      position = await this.computePosition(key, 0);
      attempt = 0;
      value = this.emptyHashes[0];
    }

    // Collect siblings and path bits
    const siblings: Field[] = [];
    const pathBits: number[] = [];

    let currentPosition = position;

    for (let level = 0; level < this.depth; level++) {
      // Determine if current node is left (0) or right (1) child
      const isLeftChild = (currentPosition & 1) === 0;
      const bit = isLeftChild ? 0 : 1;
      pathBits.push(bit);

      // Sibling is the other child at this level
      const siblingPosition = isLeftChild ? currentPosition + 1 : currentPosition - 1;

      // Get sibling hash (need to compute subtree hash, not just node value)
      const sibling = await this.computeSubtreeHash(siblingPosition, level);

      siblings.push(sibling);

      // Move to parent position
      currentPosition = Math.floor(currentPosition / 2);
    }

    const root = await this.getRoot();

    return {
      key,
      value,
      siblings,
      pathBits,
      root,
      attempt,
    };
  }

  /**
   * Verify a Merkle proof against a root.
   *
   * Reconstructs the root by walking from leaf to root using siblings.
   * Proof is valid if reconstructed root matches expected root.
   *
   * WARNING: This method verifies the Merkle PATH only. It does NOT verify that
   * proof.key maps to the proven position (proof.pathBits). A valid proof for
   * cell A will return true even if proof.key is set to cell B.
   *
   * For on-chain verification, this is safe because the ZK circuit binds cell_id
   * into the leaf hash: cell_map_leaf = hash(cell_id, district_commitment).
   * An attacker cannot substitute keys without invalidating the leaf.
   *
   * For off-chain callers performing access control or data validation,
   * independently verify that proof.value = hash(proof.key, expected_data)
   * before trusting the key field.
   *
   * @param proof - Proof to verify (path math only; proof.key is NOT checked)
   * @param root - Expected root hash
   * @param hasher - Poseidon2Hasher instance
   * @returns true if the Merkle path from proof.value reconstructs to root
   */
  static async verify(
    proof: SMTProof,
    root: Field,
    hasher: Poseidon2Hasher
  ): Promise<boolean> {
    if (proof.siblings.length !== proof.pathBits.length) {
      return false;
    }

    const depth = proof.siblings.length;
    let currentHash = proof.value;

    // Walk from leaf to root
    for (let i = 0; i < depth; i++) {
      const sibling = proof.siblings[i];
      const isLeftChild = proof.pathBits[i] === 0;

      if (isLeftChild) {
        // Current node is left child
        currentHash = await hasher.hashPair(currentHash, sibling);
      } else {
        // Current node is right child
        currentHash = await hasher.hashPair(sibling, currentHash);
      }
    }

    return currentHash === root;
  }

  /**
   * Get all stored entries (for debugging/export)
   *
   * Returns array of [key, value] pairs.
   * Useful for inspection and serialization.
   */
  entries(): Array<[Field, Field]> {
    const result: Array<[Field, Field]> = [];

    for (const node of this.nodes.values()) {
      result.push([node.key, node.value]);
    }

    return result;
  }

  /**
   * Get empty hash at specific level (for testing)
   */
  getEmptyHash(level: number): Field {
    if (level < 0 || level > this.depth) {
      throw new Error(`Invalid level: ${level}. Valid range: 0-${this.depth}`);
    }
    return this.emptyHashes[level];
  }
}

/**
 * Convenience function: Create SMT instance
 */
export async function createSparseMerkleTree(config?: SMTConfig): Promise<SparseMerkleTree> {
  return SparseMerkleTree.create(config);
}
