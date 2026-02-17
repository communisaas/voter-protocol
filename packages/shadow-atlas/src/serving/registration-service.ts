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
import { InsertionLog, type InsertionLogEntry, type InsertionLogOptions } from './insertion-log.js';

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
  /** Optional append-only insertion log for persistence (BR5-007) */
  private insertionLog: InsertionLog | null = null;

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
   *
   * If `logOptions` is provided, opens (or creates) the insertion log
   * and replays any existing entries to restore previous state (BR5-007).
   */
  static async create(
    depth: number = 20,
    logOptions?: InsertionLogOptions,
  ): Promise<RegistrationService> {
    const hasher = await getHasher();

    // Precompute empty hashes: level 0 = hashPair(0, 0), level i = hashPair(empty[i-1], empty[i-1])
    const paddingLeaf = await hasher.hashPair(0n, 0n);
    const emptyHashes: bigint[] = [paddingLeaf];

    for (let i = 1; i <= depth; i++) {
      emptyHashes[i] = await hasher.hashPair(emptyHashes[i - 1], emptyHashes[i - 1]);
    }

    const service = new RegistrationService(hasher, emptyHashes, depth);

    // BR5-007: Open insertion log and replay if entries exist
    if (logOptions) {
      service.insertionLog = await InsertionLog.open(logOptions);
      const { entries, verification } = await service.insertionLog.replay();

      if (verification.brokenLinks > 0 || verification.invalidSignatures > 0) {
        // Allow single broken last entry (incomplete write from crash)
        const isRecoverableCrash = verification.brokenLinks === 1
          && verification.invalidSignatures === 0
          && verification.lastEntryBroken === true;

        if (!isRecoverableCrash) {
          throw new Error(
            `FATAL: Insertion log integrity compromised. ` +
            `${verification.brokenLinks} broken chain links, ` +
            `${verification.invalidSignatures} invalid signatures. ` +
            `Manual investigation required before service can start. ` +
            `See TRUST-MODEL-AND-OPERATOR-INTEGRITY.md for recovery procedures.`
          );
        }

        logger.warn('RegistrationService: last log entry truncated (likely crash recovery)', {
          brokenLinks: verification.brokenLinks,
        });
      }

      if (entries.length > 0) {
        logger.info('RegistrationService replaying insertion log', {
          entries: entries.length,
        });

        for (const entry of entries) {
          if (entry.type === 'replace' && entry.oldIndex !== undefined) {
            await service.replayReplace(entry.leaf, entry.oldIndex);
          } else {
            await service.replayLeaf(entry.leaf);
          }
        }

        logger.info('RegistrationService replay complete', {
          treeSize: service.nextLeafIndex,
          rootPrefix: '0x' + service.root.toString(16).slice(0, 16) + '...',
        });
      }
    }

    logger.info('RegistrationService initialized', {
      depth,
      capacity: 2 ** depth,
      treeSize: service.nextLeafIndex,
      persistent: logOptions != null,
      emptyRoot: '0x' + emptyHashes[depth].toString(16).slice(0, 16) + '...',
    });

    return service;
  }

  /**
   * Insert a precomputed leaf hash into Tree 1.
   *
   * The leaf is the client-computed Poseidon2_H4(user_secret, cell_id, registration_salt, authority_level).
   * The operator sees ONLY this hash value.
   *
   * @param leafHex - Hex-encoded leaf hash (with or without 0x prefix)
   * @param options - Optional metadata to record with the insertion
   * @param options.attestationHash - Hash of the identity attestation that authorized this insertion
   * @returns Registration result with Merkle proof
   * @throws Error if leaf is zero, exceeds field, is duplicate, or tree is full
   */
  async insertLeaf(leafHex: string, options?: { attestationHash?: string }): Promise<RegistrationResult> {
    // Parse and validate
    const leaf = this.parseLeaf(leafHex);

    // Acquire mutex for serialized insertion
    const release = await this.acquireLock();
    try {
      return await this.insertLeafInternal(leaf, options);
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

  /**
   * Replace an existing leaf in Tree 1 with a new leaf.
   *
   * Atomically zeros the old leaf (sets it to padding), removes it from the
   * duplicate tracking set, and inserts the new leaf at the next available index.
   * This allows users to re-register with a new derived leaf while invalidating
   * the old one (e.g., after cell boundary changes or salt rotation).
   *
   * **Authorization boundary:** This method trusts the caller to enforce
   * per-leaf ownership. Shadow Atlas validates API access (Bearer token) but
   * cannot verify that the caller owns the leaf at oldLeafIndex. The communique
   * layer must enforce ownership via OAuth session + Postgres record lookup.
   *
   * @param oldLeafIndex - Index of the leaf to replace (must be in [0, nextLeafIndex))
   * @param newLeafHex - Hex-encoded new leaf hash (with or without 0x prefix)
   * @returns Registration result for the NEW leaf (at nextLeafIndex)
   * @throws Error if oldLeafIndex is invalid, old leaf is already empty,
   *         new leaf is duplicate/same as old, or tree is full
   */
  async replaceLeaf(
    oldLeafIndex: number,
    newLeafHex: string,
    options?: { attestationHash?: string },
  ): Promise<RegistrationResult> {
    // Parse and validate new leaf (BN254 bounds, non-zero, valid hex)
    const newLeaf = this.parseLeaf(newLeafHex);

    // Validate oldLeafIndex is in range BEFORE acquiring lock
    if (oldLeafIndex < 0 || oldLeafIndex >= this.nextLeafIndex) {
      throw new Error('INVALID_OLD_INDEX');
    }

    // Acquire mutex for serialized operation
    const release = await this.acquireLock();
    try {
      // Re-validate state inside the lock
      if (oldLeafIndex >= this.nextLeafIndex) {
        throw new Error('INVALID_OLD_INDEX');
      }

      // Get old leaf value BEFORE zeroing
      const oldLeafValue = this.getNode(0, oldLeafIndex);

      // Validate old position is NOT already empty/padding
      if (oldLeafValue === this.emptyHashes[0]) {
        throw new Error('OLD_LEAF_ALREADY_EMPTY');
      }

      // Check new leaf isn't a duplicate (in leafSet)
      const newLeafHexNorm = newLeaf.toString(16);
      if (this.leafSet.has(newLeafHexNorm)) {
        throw new Error('DUPLICATE_LEAF');
      }

      // Note: SAME_LEAF is unreachable — if newLeaf === oldLeafValue, the
      // DUPLICATE_LEAF check above fires first (old leaf is still in leafSet).
      // Kept as defense-in-depth for clarity.
      if (newLeaf === oldLeafValue) {
        throw new Error('SAME_LEAF');
      }

      // Capacity check for the NEW insertion
      if (this.nextLeafIndex >= this.capacity) {
        throw new Error('Tree capacity exceeded');
      }

      const newLeafIndex = this.nextLeafIndex;
      // BR7-017: Write-ahead logging — persist BEFORE tree mutation
      if (this.insertionLog) {
        await this.insertionLog.append({
          leaf: '0x' + newLeaf.toString(16),
          index: newLeafIndex,
          ts: Date.now(),
          type: 'replace',
          oldIndex: oldLeafIndex,
          attestationHash: options?.attestationHash,
        });
      }


      // ========================================================================
      // Step 1: Zero the old leaf (set to padding)
      // ========================================================================
      this.setNode(0, oldLeafIndex, this.emptyHashes[0]);

      // Recompute path from old index to root
      let currentIndex = oldLeafIndex;
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

      // Remove old leaf from duplicate tracking set
      const oldLeafHex = oldLeafValue.toString(16);
      this.leafSet.delete(oldLeafHex);

      // ========================================================================
      // Step 2: Insert the new leaf at nextLeafIndex
      // ========================================================================

      // Set new leaf node
      this.setNode(0, newLeafIndex, newLeaf);
      this.leafSet.add(newLeafHexNorm);
      this.nextLeafIndex++;

      // Recompute path from new index to root
      currentIndex = newLeafIndex;
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

      // Update root
      this.root = this.getNode(this.depth, 0);

      // Generate proof for the new leaf
      const { siblings, pathIndices } = this.computeProof(newLeafIndex);


      logger.info('Leaf replaced', {
        oldLeafIndex,
        newLeafIndex,
        treeSize: this.nextLeafIndex,
        persistent: this.insertionLog != null,
        attestationBound: !!options?.attestationHash,
        rootPrefix: '0x' + this.root.toString(16).slice(0, 16) + '...',
      });

      return {
        leafIndex: newLeafIndex,
        userRoot: '0x' + this.root.toString(16),
        userPath: siblings.map(s => '0x' + s.toString(16)),
        pathIndices,
      };
    } finally {
      release();
    }
  }

  /** Current Tree 1 root hash */
  getRoot(): bigint {
    return this.root;
  }

  /** Current Tree 1 root as hex string */
  getRootHex(): string {
    return '0x' + this.root.toString(16);
  }

  /** Get the insertion log (for IPFS export) */
  getInsertionLog(): InsertionLog | null {
    return this.insertionLog;
  }

  /** Close the insertion log (call on shutdown) */
  async close(): Promise<void> {
    if (this.insertionLog) {
      await this.insertionLog.close();
      this.insertionLog = null;
    }
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

  /**
   * Replay a leaf from the insertion log (no re-logging, no mutex).
   *
   * Used during startup to rebuild tree from persisted log.
   * Skips the insertion log write since the entry already exists.
   */
  private async replayLeaf(leafHex: string): Promise<void> {
    const leaf = this.parseLeaf(leafHex);
    const leafHexNorm = leaf.toString(16);

    if (this.leafSet.has(leafHexNorm)) {
      logger.warn('InsertionLog replay: skipping duplicate leaf', {
        leaf: leafHex,
      });
      return;
    }

    if (this.nextLeafIndex >= this.capacity) {
      throw new Error('Tree capacity exceeded during replay');
    }

    const leafIndex = this.nextLeafIndex;
    this.setNode(0, leafIndex, leaf);
    this.leafSet.add(leafHexNorm);
    this.nextLeafIndex++;

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
  }

  /**
   * Replay a replace entry from the insertion log (no re-logging, no mutex).
   *
   * Replace entries zero an old leaf position and insert a new leaf at the
   * next available index. Used during startup to rebuild tree from persisted log.
   */
  private async replayReplace(newLeafHex: string, oldLeafIndex: number): Promise<void> {
    // Parse and validate new leaf
    const newLeaf = this.parseLeaf(newLeafHex);
    const newLeafHexNorm = newLeaf.toString(16);

    // Validate old index is in range
    if (oldLeafIndex < 0 || oldLeafIndex >= this.nextLeafIndex) {
      throw new Error(`Replace replay: old index ${oldLeafIndex} out of range [0, ${this.nextLeafIndex})`);
    }

    // Get old leaf value
    const oldLeaf = this.getNode(0, oldLeafIndex);
    const oldLeafHex = oldLeaf.toString(16);

    // Remove old leaf from set (unless it's the padding hash)
    if (oldLeaf !== this.emptyHashes[0]) {
      this.leafSet.delete(oldLeafHex);
    }

    // Zero old position
    this.setNode(0, oldLeafIndex, this.emptyHashes[0]);

    // Recompute path from old index to root
    let currentIndex = oldLeafIndex;
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

    // Check new leaf not duplicate
    if (this.leafSet.has(newLeafHexNorm)) {
      logger.warn('InsertionLog replay: skipping duplicate leaf in replace', {
        leaf: newLeafHex,
        oldLeafIndex,
        nextLeafIndex: this.nextLeafIndex,
      });
      return;
    }

    // Check capacity
    if (this.nextLeafIndex >= this.capacity) {
      throw new Error('Tree capacity exceeded during replace replay');
    }

    // Insert new leaf at next available index
    const newLeafIndex = this.nextLeafIndex;
    this.setNode(0, newLeafIndex, newLeaf);
    this.leafSet.add(newLeafHexNorm);
    this.nextLeafIndex++;

    // Recompute path from new index to root
    currentIndex = newLeafIndex;
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

    // Update root
    this.root = this.getNode(this.depth, 0);
  }

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

  private async insertLeafInternal(leaf: bigint, options?: { attestationHash?: string }): Promise<RegistrationResult> {
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


    // BR7-017: Write-ahead logging — persist BEFORE tree mutation
    if (this.insertionLog) {
      await this.insertionLog.append({
        leaf: '0x' + leaf.toString(16),
        index: leafIndex,
        ts: Date.now(),
        attestationHash: options?.attestationHash,
      });
    }

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
      persistent: this.insertionLog != null,
      attestationBound: !!options?.attestationHash,
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
