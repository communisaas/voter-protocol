/**
 * Position Tree Builder
 *
 * Append-only balanced binary Merkle tree for debate position commitments.
 * Each leaf records a single trade reveal as:
 *
 *   commitment = Poseidon2(argumentIndex, weightedAmount, randomness, DOMAIN_POS_COMMIT)
 *
 * where DOMAIN_POS_COMMIT = 0x50434d ("PCM") occupies the 4th state slot,
 * using the same permutation state layout as all other Poseidon2 calls in this
 * protocol: [a, b, c, domainTag].
 *
 * Merkle node hashing uses the standard pair hash:
 *
 *   node = Poseidon2(left, right, DOMAIN_HASH2, 0)
 *
 * where DOMAIN_HASH2 = 0x48324d ("H2M"). This matches hashPair() throughout
 * Trees 1 and 2, and is what the position_note Noir circuit expects when it
 * verifies inclusion against the position root public input.
 *
 * TREE MODEL:
 * - Fixed depth at construction (default 20 = 2^20 = 1,048,576 slots/debate)
 * - Append-only: leaves are assigned sequential indices starting at 0
 * - Padding: empty slots use ZERO_LEAF = hashPair(0n, 0n), matching Tree 1
 * - Full layer state is kept in memory so that getProof() is O(depth)
 *
 * LIFECYCLE:
 * - One PositionTreeBuilder instance per debate (keyed by debateId)
 * - Constructed lazily by DebateService on first TradeRevealed event
 * - Tree init is lazy (first call to appendPosition/getRoot/getProof triggers it)
 *
 * SPEC REFERENCE: specs/STAKED-DEBATE-PROTOCOL-SPEC.md
 * CIRCUIT REFERENCE: packages/crypto/noir/position_note/src/main.nr
 *
 * @packageDocumentation
 */

import { Poseidon2Hasher, getHasher } from '@voter-protocol/crypto/poseidon2';

// ============================================================================
// Domain constants
// ============================================================================

/**
 * Domain tag for position commitment leaf hashing.
 * Matches Noir circuit: global DOMAIN_POS_COMMIT: Field = 0x50434d  // "PCM"
 *
 * State layout passed to Poseidon2 permutation: [argumentIndex, weightedAmount, randomness, DOMAIN_POS_COMMIT]
 * Uses hashWithCustomDomain3() on the Poseidon2Hasher.
 */
export const DOMAIN_POS_COMMIT = 0x50434dn;

/**
 * Default position tree depth.
 * 2^20 = 1,048,576 position slots per debate.
 * Matches the depth used in the position_note Noir circuit.
 */
export const POSITION_TREE_DEFAULT_DEPTH = 20;

// ============================================================================
// Types
// ============================================================================

/**
 * A Merkle proof for a position commitment leaf.
 *
 * Provides all data needed by PositionNoteNoirProver.generateProof():
 *   path  -> position_path  (Merkle siblings, length = depth)
 *   index -> position_index (leaf position in tree)
 *
 * The circuit derives path direction bits from the index:
 *   bit[i] = (index >> i) & 1
 *   bit=0: current node is left child (sibling is right)
 *   bit=1: current node is right child (sibling is left)
 */
export interface PositionMerkleProof {
  /** Sibling hashes from leaf level to root (length = tree depth) */
  readonly path: bigint[];
  /** Zero-based leaf index */
  readonly index: number;
  /** The commitment hash stored at this leaf (for verification convenience) */
  readonly commitment: bigint;
}

/**
 * Result of appending a new position.
 */
export interface AppendPositionResult {
  /** Zero-based leaf index assigned to this position */
  readonly index: number;
  /** Position commitment = Poseidon2(argumentIndex, weightedAmount, randomness, DOMAIN_POS_COMMIT) */
  readonly commitment: bigint;
}

/**
 * Lightweight tree state snapshot for persistence or reporting.
 */
export interface PositionTreeState {
  /** Current Merkle root */
  readonly root: bigint;
  /** Number of real commitments inserted (excluding padding) */
  readonly leafCount: number;
  /** Tree depth */
  readonly depth: number;
  /** Maximum capacity: 2^depth */
  readonly capacity: number;
}

// ============================================================================
// Module-level hasher cache
// ============================================================================

let _hasher: Poseidon2Hasher | null = null;

async function ensureHasher(): Promise<Poseidon2Hasher> {
  if (!_hasher) {
    _hasher = await getHasher();
  }
  return _hasher;
}

// ============================================================================
// PositionTreeBuilder
// ============================================================================

/**
 * Off-chain Merkle tree for position commitments.
 *
 * ARCHITECTURE:
 *   Full layer-by-layer storage (layers[0] = leaves, layers[depth] = root).
 *   Each appendPosition() call updates only the O(depth) path from the new
 *   leaf to the root. All other paths are untouched.
 *
 * THREAD SAFETY:
 *   Not thread-safe. Insertions must be serialized. DebateService should
 *   await each appendPosition() call before processing the next event.
 *
 * PERSISTENCE:
 *   In-memory only. Rebuild from commitments array after restart:
 *     const builder = await buildPositionTreeFromCommitments(storedCommitments, depth)
 */
export class PositionTreeBuilder {
  /** Insertion-ordered commitment leaves (real positions only, no padding) */
  private commitmentLeaves: bigint[] = [];

  /**
   * All tree layers.
   * layers[0] = leaf layer (length = capacity, padded with zeroLeaf).
   * layers[k] = level k above leaves (length = capacity / 2^k).
   * layers[depth] = root layer (length = 1).
   * Allocated and filled lazily on first use.
   */
  private layers: bigint[][] = [];

  /** Canonical empty leaf = hashPair(0n, 0n). Set during initialization. */
  private zeroLeaf = 0n;

  /** Tree depth (fixed at construction) */
  readonly depth: number;

  /** Whether async initialization has completed */
  private initialized = false;

  /** Initialization promise for concurrent-safe lazy init */
  private initPromise: Promise<void> | null = null;

  constructor(depth: number = POSITION_TREE_DEFAULT_DEPTH) {
    if (!Number.isInteger(depth) || depth < 1 || depth > 32) {
      throw new RangeError(`PositionTreeBuilder: depth must be an integer in [1, 32], got ${depth}`);
    }
    this.depth = depth;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Append a new position commitment to the tree.
   *
   * Computes:
   *   commitment = Poseidon2(argumentIndex, weightedAmount, randomness, DOMAIN_POS_COMMIT)
   *
   * then inserts the commitment at the next available leaf slot and recomputes
   * the O(depth) path from that leaf up to the root.
   *
   * @param argumentIndex  - Argument index from TradeRevealed event (uint256 → bigint)
   * @param weightedAmount - Stake-weighted trade amount from TradeRevealed event
   * @param randomness     - Blinding randomness committed by the trader
   * @returns              - Leaf index and the commitment hash
   * @throws Error if tree has reached capacity
   */
  async appendPosition(
    argumentIndex: bigint,
    weightedAmount: bigint,
    randomness: bigint,
  ): Promise<AppendPositionResult> {
    await this._ensureInit();

    const capacity = 2 ** this.depth;
    if (this.commitmentLeaves.length >= capacity) {
      throw new Error(
        `PositionTreeBuilder: tree is full ` +
        `(depth=${this.depth}, capacity=${capacity}). Increase depth.`
      );
    }

    const hasher = await ensureHasher();

    // commitment = Poseidon2(argumentIndex, weightedAmount, randomness, DOMAIN_POS_COMMIT)
    // Uses the custom-domain path so DOMAIN_POS_COMMIT occupies state slot 3.
    const commitment = await hasher.hashWithCustomDomain3(
      argumentIndex,
      weightedAmount,
      randomness,
      DOMAIN_POS_COMMIT,
    );

    const index = this.commitmentLeaves.length;
    this.commitmentLeaves.push(commitment);

    // Update leaf layer
    this.layers[0][index] = commitment;

    // Propagate up to root (O(depth) hashPair calls)
    await this._updateAncestors(index, hasher);

    return { index, commitment };
  }

  /**
   * Return the current Merkle root.
   *
   * For an empty tree, this is the root of the all-padding tree (all leaves =
   * hashPair(0n, 0n)). This value is stable and deterministic across instances.
   */
  async getRoot(): Promise<bigint> {
    await this._ensureInit();
    return this.layers[this.depth][0];
  }

  /**
   * Generate a Merkle inclusion proof for the position at `index`.
   *
   * The returned path and index are ready to pass directly to the position_note
   * Noir prover as positionPath and positionIndex.
   *
   * @param index - Zero-based leaf index (must be < leafCount)
   * @returns PositionMerkleProof
   * @throws RangeError if index is out of bounds
   */
  async getProof(index: number): Promise<PositionMerkleProof> {
    await this._ensureInit();

    if (!Number.isInteger(index) || index < 0 || index >= this.commitmentLeaves.length) {
      throw new RangeError(
        `PositionTreeBuilder.getProof: index ${index} out of range ` +
        `[0, ${this.commitmentLeaves.length})`
      );
    }

    const path: bigint[] = [];
    let currentIndex = index;

    for (let level = 0; level < this.depth; level++) {
      const isLeftChild = currentIndex % 2 === 0;
      const siblingIndex = isLeftChild ? currentIndex + 1 : currentIndex - 1;
      path.push(this.layers[level][siblingIndex]);
      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      path,
      index,
      commitment: this.commitmentLeaves[index],
    };
  }

  /**
   * Locally verify a Merkle proof without invoking the circuit.
   *
   * Recomputes the root from (commitment, path, index) using the same hashPair
   * call that the Noir circuit uses for node hashing, then compares with the
   * stored root.
   *
   * @param proof - A proof from getProof()
   * @returns true if the proof reconstructs to the current root
   */
  async verifyProof(proof: PositionMerkleProof): Promise<boolean> {
    const hasher = await ensureHasher();
    const root = await this.getRoot();

    let node = proof.commitment;
    let currentIndex = proof.index;

    for (let i = 0; i < this.depth; i++) {
      const sibling = proof.path[i];
      const isLeftChild = currentIndex % 2 === 0;

      node = isLeftChild
        ? await hasher.hashPair(node, sibling)   // node is left child
        : await hasher.hashPair(sibling, node);   // node is right child

      currentIndex = Math.floor(currentIndex / 2);
    }

    return node === root;
  }

  /**
   * Number of real commitments inserted (excludes padding leaves).
   */
  getLeafCount(): number {
    return this.commitmentLeaves.length;
  }

  /**
   * Maximum number of commitments this tree can hold (= 2^depth).
   */
  getCapacity(): number {
    return 2 ** this.depth;
  }

  /**
   * Lightweight snapshot of the current tree state.
   */
  async getState(): Promise<PositionTreeState> {
    const root = await this.getRoot();
    return {
      root,
      leafCount: this.commitmentLeaves.length,
      depth: this.depth,
      capacity: 2 ** this.depth,
    };
  }

  /**
   * Return a copy of the real commitment leaves in insertion order.
   *
   * Use to reconstruct the tree after a restart:
   *   const builder2 = await buildPositionTreeFromCommitments(builder.getLeaves(), depth)
   */
  getLeaves(): bigint[] {
    return [...this.commitmentLeaves];
  }

  /**
   * Insert a pre-computed commitment directly into the tree without re-hashing.
   *
   * Used by buildPositionTreeFromCommitments() during tree reconstruction from
   * persisted data. Callers must supply valid field elements.
   *
   * @param commitment - Pre-computed position commitment (field element)
   * @returns          - Leaf index at which the commitment was inserted
   */
  async insertCommitment(commitment: bigint): Promise<number> {
    await this._ensureInit();

    const capacity = 2 ** this.depth;
    if (this.commitmentLeaves.length >= capacity) {
      throw new Error(
        `PositionTreeBuilder: tree is full ` +
        `(depth=${this.depth}, capacity=${capacity}).`
      );
    }

    const hasher = await ensureHasher();
    const index = this.commitmentLeaves.length;

    this.commitmentLeaves.push(commitment);
    this.layers[0][index] = commitment;
    await this._updateAncestors(index, hasher);

    return index;
  }

  // ==========================================================================
  // Internal helpers
  // ==========================================================================

  /**
   * Lazy initialization: build all tree layers filled with padding leaves.
   *
   * Uses a double-check idiom with a promise lock to avoid concurrent init.
   */
  private async _ensureInit(): Promise<void> {
    if (this.initialized) return;

    if (!this.initPromise) {
      this.initPromise = this._init().catch((err) => {
        // Clear promise so the next caller can retry.
        this.initPromise = null;
        throw err;
      });
    }

    return this.initPromise;
  }

  private async _init(): Promise<void> {
    const hasher = await ensureHasher();

    // Canonical empty leaf = hashPair(0n, 0n) — matches buildUserTree() in tree-builder.ts
    this.zeroLeaf = await hasher.hashPair(0n, 0n);

    const capacity = 2 ** this.depth;

    // Allocate layers
    this.layers = [];

    // Layer 0: all padding leaves
    this.layers.push(new Array<bigint>(capacity).fill(this.zeroLeaf));

    // Layers 1..depth: build bottom-up from the padding leaf layer.
    // Since all leaves are identical, sibling pairs are always (zeroLeaf, zeroLeaf),
    // (zeroNode, zeroNode), etc. — so we can use a running "zero hash" that doubles
    // at each level. This is O(depth) rather than O(capacity).
    let zeroNode = this.zeroLeaf;
    for (let level = 0; level < this.depth; level++) {
      const levelSize = capacity >> (level + 1); // capacity / 2^(level+1)
      const parentZero = await hasher.hashPair(zeroNode, zeroNode);
      this.layers.push(new Array<bigint>(levelSize).fill(parentZero));
      zeroNode = parentZero;
    }

    this.initialized = true;
  }

  /**
   * Recompute every ancestor of leafIndex up to the root.
   *
   * At each level: parent = hashPair(left_sibling, right_sibling).
   * Both children are already correct in this.layers before we hash them.
   */
  private async _updateAncestors(leafIndex: number, hasher: Poseidon2Hasher): Promise<void> {
    let currentIndex = leafIndex;

    for (let level = 0; level < this.depth; level++) {
      const isLeftChild = currentIndex % 2 === 0;
      const leftIndex = isLeftChild ? currentIndex : currentIndex - 1;
      const rightIndex = leftIndex + 1;

      const left = this.layers[level][leftIndex];
      const right = this.layers[level][rightIndex];
      const parentIndex = Math.floor(currentIndex / 2);

      this.layers[level + 1][parentIndex] = await hasher.hashPair(left, right);
      currentIndex = parentIndex;
    }
  }
}

// ============================================================================
// Standalone helper functions
// ============================================================================

/**
 * Compute a position commitment hash.
 *
 * commitment = Poseidon2(argumentIndex, weightedAmount, randomness, DOMAIN_POS_COMMIT)
 *
 * Convenience wrapper for one-off usage (e.g., in tests or API handlers that
 * need the commitment value without a full PositionTreeBuilder).
 *
 * @param argumentIndex  - Argument index (uint256 as bigint)
 * @param weightedAmount - Stake-weighted trade amount (uint256 as bigint)
 * @param randomness     - Blinding randomness (field element)
 * @returns              - Position commitment as bigint
 */
export async function computePositionCommitment(
  argumentIndex: bigint,
  weightedAmount: bigint,
  randomness: bigint,
): Promise<bigint> {
  const hasher = await ensureHasher();
  return hasher.hashWithCustomDomain3(argumentIndex, weightedAmount, randomness, DOMAIN_POS_COMMIT);
}

/**
 * Reconstruct a PositionTreeBuilder from persisted commitment leaves.
 *
 * Replays insertions in order so that the tree state matches the on-chain
 * position root. Use this after a server restart to restore proof capability.
 *
 * @param commitments - Ordered list of position commitments (insertion order)
 * @param depth       - Tree depth (default: 20)
 * @returns           - Initialized PositionTreeBuilder
 */
export async function buildPositionTreeFromCommitments(
  commitments: bigint[],
  depth: number = POSITION_TREE_DEFAULT_DEPTH,
): Promise<PositionTreeBuilder> {
  const builder = new PositionTreeBuilder(depth);
  for (const commitment of commitments) {
    await builder.insertCommitment(commitment);
  }
  return builder;
}

/**
 * Verify a Merkle proof against a known root without a PositionTreeBuilder.
 *
 * Useful for API-layer validation before submitting to the circuit.
 *
 * @param commitment   - Position commitment (leaf value)
 * @param path         - Sibling hashes from leaf to root (length = depth)
 * @param index        - Leaf index in tree
 * @param expectedRoot - Expected Merkle root
 * @param depth        - Tree depth (default: 20)
 * @returns            - true if proof is valid
 */
export async function verifyPositionMerkleProof(
  commitment: bigint,
  path: bigint[],
  index: number,
  expectedRoot: bigint,
  depth: number = POSITION_TREE_DEFAULT_DEPTH,
): Promise<boolean> {
  if (path.length !== depth) {
    throw new Error(`verifyPositionMerkleProof: path length ${path.length} must equal depth ${depth}`);
  }

  const hasher = await ensureHasher();
  let node = commitment;
  let currentIndex = index;

  for (let i = 0; i < depth; i++) {
    const sibling = path[i];
    const isLeftChild = currentIndex % 2 === 0;

    node = isLeftChild
      ? await hasher.hashPair(node, sibling)
      : await hasher.hashPair(sibling, node);

    currentIndex = Math.floor(currentIndex / 2);
  }

  return node === expectedRoot;
}
