/**
 * Registration Service - Incremental Tree 1 Management
 *
 * Manages the User Identity Tree (Tree 1) for live registration.
 * Accepts precomputed leaf hashes from clients — the operator never sees
 * user_secret, cell_id, or registration_salt.
 *
 * Tree 1 is a standard balanced binary Merkle tree with Poseidon2 hashing.
 * Leaves are inserted sequentially (append-only) and the tree is updated
 * incrementally in O(depth) time per insertion.
 *
 * SPEC REFERENCE: TWO-TREE-ARCHITECTURE-SPEC.md Section 2
 * SPEC REFERENCE: WAVE-17-19-IMPLEMENTATION-PLAN.md Section 17b
 */

import { Poseidon2Hasher, getHasher } from '@voter-protocol/crypto/poseidon2';
import type {
  SparseMerkleTree,
  SMTProof,
} from '@voter-protocol/crypto';
import { logger } from '../core/utils/logger.js';

// ============================================================================
// Constants
// ============================================================================

/** BN254 scalar field modulus — all leaf values must be in [1, p-1] */
const BN254_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// ============================================================================
// Types
// ============================================================================

/** Result returned to the client after successful registration */
export interface RegistrationResult {
  /** Position of the leaf in Tree 1 */
  readonly leafIndex: number;
  /** Tree 1 root after insertion (hex-encoded) */
  readonly userRoot: string;
  /** Merkle siblings from leaf to root (hex-encoded, depth elements) */
  readonly userPath: readonly string[];
  /** Path direction bits (0=left child, 1=right child) */
  readonly pathIndices: readonly number[];
}

/** Result of a cell proof query from Tree 2 */
export interface CellProofResult {
  /** Tree 2 root (hex-encoded) */
  readonly cellMapRoot: string;
  /** SMT siblings (hex-encoded) */
  readonly cellMapPath: readonly string[];
  /** SMT direction bits */
  readonly cellMapPathBits: readonly number[];
  /** All 24 district IDs for this cell (hex-encoded) */
  readonly districts: readonly string[];
}

/** Internal state for cell-district map (Tree 2) */
export interface CellMapState {
  /** The sparse Merkle tree instance */
  readonly tree: SparseMerkleTree;
  /** Root hash */
  readonly root: bigint;
  /** Map from cellId string to district commitment */
  readonly commitments: ReadonlyMap<string, bigint>;
  /** Map from cellId string to district array */
  readonly districtMap: ReadonlyMap<string, readonly bigint[]>;
  /** Tree depth */
  readonly depth: number;
}

// ============================================================================
// Registration Service
// ============================================================================

/**
 * Manages Tree 1 (User Identity Tree) with incremental insertion.
 *
 * Uses a sparse node representation: only stores nodes that differ from
 * the precomputed "empty subtree" hashes. This means an empty tree with
 * depth=20 uses O(depth) memory, not O(2^depth).
 *
 * Thread safety: All insertions are serialized via an async mutex.
 * Reads (proof generation) are safe to call concurrently.
 */
export class RegistrationService {
  /** Sparse node storage: key = "level:index", value = hash */
  private readonly nodeMap: Map<string, bigint> = new Map();
  /** Set of all inserted leaf hashes (hex) for duplicate detection */
  private readonly leafSet: Set<string> = new Set();
  /** Precomputed empty subtree hashes at each level */
  private readonly emptyHashes: bigint[];
  /** Next available leaf position */
  private nextLeafIndex: number = 0;
  /** Tree depth */
  readonly depth: number;
  /** Tree capacity (2^depth) */
  private readonly capacity: number;
  /** Poseidon2 hasher instance */
  private readonly hasher: Poseidon2Hasher;
  /** Async mutex chain for serialized writes */
  private lockChain: Promise<void> = Promise.resolve();
  /** Current root hash */
  private root: bigint;

  private constructor(
    hasher: Poseidon2Hasher,
    emptyHashes: bigint[],
    depth: number,
  ) {
    this.hasher = hasher;
    this.emptyHashes = emptyHashes;
    this.depth = depth;
    this.capacity = 2 ** depth;
    this.root = emptyHashes[depth];
  }

  /**
   * Create a new RegistrationService with an empty Tree 1.
   *
   * Precomputes empty subtree hashes (O(depth) Poseidon2 calls).
   */
  static async create(depth: number = 20): Promise<RegistrationService> {
    const hasher = await getHasher();

    // Precompute empty hashes: level 0 = hashPair(0, 0), level i = hashPair(empty[i-1], empty[i-1])
    const paddingLeaf = await hasher.hashPair(0n, 0n);
    const emptyHashes: bigint[] = [paddingLeaf];

    for (let i = 1; i <= depth; i++) {
      emptyHashes[i] = await hasher.hashPair(emptyHashes[i - 1], emptyHashes[i - 1]);
    }

    logger.info('RegistrationService initialized', {
      depth,
      capacity: 2 ** depth,
      emptyRoot: '0x' + emptyHashes[depth].toString(16).slice(0, 16) + '...',
    });

    return new RegistrationService(hasher, emptyHashes, depth);
  }

  /**
   * Insert a precomputed leaf hash into Tree 1.
   *
   * The leaf is the client-computed Poseidon2_H3(user_secret, cell_id, registration_salt).
   * The operator sees ONLY this hash value.
   *
   * @param leafHex - Hex-encoded leaf hash (with or without 0x prefix)
   * @returns Registration result with Merkle proof
   * @throws Error if leaf is zero, exceeds field, is duplicate, or tree is full
   */
  async insertLeaf(leafHex: string): Promise<RegistrationResult> {
    // Parse and validate
    const leaf = this.parseLeaf(leafHex);

    // Acquire mutex for serialized insertion
    const release = await this.acquireLock();
    try {
      return await this.insertLeafInternal(leaf);
    } finally {
      release();
    }
  }

  /**
   * Generate a Merkle proof for an existing leaf.
   *
   * Safe to call concurrently (reads only).
   */
  getProof(leafIndex: number): RegistrationResult {
    if (leafIndex < 0 || leafIndex >= this.nextLeafIndex) {
      throw new Error(`Leaf index ${leafIndex} out of range [0, ${this.nextLeafIndex})`);
    }

    const { siblings, pathIndices } = this.computeProof(leafIndex);

    return {
      leafIndex,
      userRoot: '0x' + this.root.toString(16),
      userPath: siblings.map(s => '0x' + s.toString(16)),
      pathIndices,
    };
  }

  /** Current Tree 1 root hash */
  getRoot(): bigint {
    return this.root;
  }

  /** Current Tree 1 root as hex string */
  getRootHex(): string {
    return '0x' + this.root.toString(16);
  }

  /** Number of registered leaves */
  get leafCount(): number {
    return this.nextLeafIndex;
  }

  /** Whether the tree is full */
  get isFull(): boolean {
    return this.nextLeafIndex >= this.capacity;
  }

  // ============================================================================
  // Internal
  // ============================================================================

  private parseLeaf(leafHex: string): bigint {
    const normalized = leafHex.startsWith('0x') ? leafHex.slice(2) : leafHex;

    if (!/^[0-9a-fA-F]+$/.test(normalized)) {
      throw new Error('Invalid hex string');
    }

    const leaf = BigInt('0x' + normalized);

    if (leaf === 0n) {
      throw new Error('Zero leaf not allowed (SA-011)');
    }

    if (leaf >= BN254_MODULUS) {
      throw new Error('Leaf exceeds BN254 scalar field modulus');
    }

    return leaf;
  }

  private async insertLeafInternal(leaf: bigint): Promise<RegistrationResult> {
    const leafHex = leaf.toString(16);

    // Duplicate check
    if (this.leafSet.has(leafHex)) {
      throw new Error('DUPLICATE_LEAF');
    }

    // Capacity check
    if (this.nextLeafIndex >= this.capacity) {
      throw new Error('Tree capacity exceeded');
    }

    const leafIndex = this.nextLeafIndex;

    // Set leaf node
    this.setNode(0, leafIndex, leaf);
    this.leafSet.add(leafHex);
    this.nextLeafIndex++;

    // Recompute path from leaf to root: O(depth) hashes
    let currentIndex = leafIndex;
    for (let level = 0; level < this.depth; level++) {
      const parentIndex = currentIndex >> 1;
      const leftIndex = parentIndex << 1;
      const rightIndex = leftIndex + 1;
      const left = this.getNode(level, leftIndex);
      const right = this.getNode(level, rightIndex);
      const parentHash = await this.hasher.hashPair(left, right);
      this.setNode(level + 1, parentIndex, parentHash);
      currentIndex = parentIndex;
    }

    this.root = this.getNode(this.depth, 0);

    // Generate proof
    const { siblings, pathIndices } = this.computeProof(leafIndex);

    logger.info('Leaf registered', {
      leafIndex,
      treeSize: this.nextLeafIndex,
      rootPrefix: '0x' + this.root.toString(16).slice(0, 16) + '...',
    });

    return {
      leafIndex,
      userRoot: '0x' + this.root.toString(16),
      userPath: siblings.map(s => '0x' + s.toString(16)),
      pathIndices,
    };
  }

  private computeProof(leafIndex: number): {
    siblings: bigint[];
    pathIndices: number[];
  } {
    const siblings: bigint[] = [];
    const pathIndices: number[] = [];
    let currentIndex = leafIndex;

    for (let level = 0; level < this.depth; level++) {
      const isLeftChild = (currentIndex & 1) === 0;
      const siblingIndex = isLeftChild ? currentIndex + 1 : currentIndex - 1;
      siblings.push(this.getNode(level, siblingIndex));
      pathIndices.push(isLeftChild ? 0 : 1);
      currentIndex = currentIndex >> 1;
    }

    return { siblings, pathIndices };
  }

  /** Get a node value, falling back to the empty hash for that level */
  private getNode(level: number, index: number): bigint {
    return this.nodeMap.get(`${level}:${index}`) ?? this.emptyHashes[level];
  }

  /** Set a node value, deleting the key if it matches the empty hash */
  private setNode(level: number, index: number, value: bigint): void {
    const key = `${level}:${index}`;
    if (value === this.emptyHashes[level]) {
      this.nodeMap.delete(key);
    } else {
      this.nodeMap.set(key, value);
    }
  }

  /** Simple async mutex via promise chaining */
  private acquireLock(): Promise<() => void> {
    let release: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = this.lockChain;
    this.lockChain = next;
    return prev.then(() => release!);
  }
}
