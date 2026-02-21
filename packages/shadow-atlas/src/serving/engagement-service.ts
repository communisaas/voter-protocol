/**
 * Engagement Service - Tree 3 (Engagement Tree) Management
 *
 * Manages the Engagement Tree (Tree 3) for tracking civic participation.
 * Operator-controlled: the operator builds the tree from on-chain nullifier
 * events and clients query proofs.
 *
 * Tree 3 is a standard balanced binary Merkle tree with Poseidon2 hashing.
 * Leaves are computed as: H2(identityCommitment, H3(tier, actionCount, diversityScore))
 *
 * Unlike Tree 1 (append-only), Tree 3 supports UPSERT semantics:
 * leaves are updated in-place when engagement metrics change.
 *
 * SPEC REFERENCE: specs/REPUTATION-ARCHITECTURE-SPEC.md Sections 3, 9
 */

import { Poseidon2Hasher, getHasher } from '@voter-protocol/crypto/poseidon2';
import {
  computeEngagementDataCommitment,
  computeEngagementLeaf,
  deriveTier,
  type EngagementMetrics,
  type EngagementData,
} from '@voter-protocol/crypto/engagement';
import { logger } from '../core/utils/logger.js';
import { InsertionLog, type InsertionLogOptions } from './insertion-log.js';

// ============================================================================
// Constants
// ============================================================================

const BN254_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// ============================================================================
// Types
// ============================================================================

/** Result returned after proof query or metrics update */
export interface EngagementProofResult {
  readonly leafIndex: number;
  readonly engagementRoot: string;
  readonly engagementPath: readonly string[];
  readonly pathIndices: readonly number[];
  readonly tier: number;
  readonly actionCount: number;
  readonly diversityScore: number;
}

/** Internal record per registered identity */
export interface EngagementIdentityRecord {
  readonly identityCommitment: bigint;
  readonly signerAddress: string;
  readonly leafIndex: number;
  readonly metrics: EngagementMetrics;
  readonly tier: 0 | 1 | 2 | 3 | 4;
  readonly registeredAt: number;
}

// ============================================================================
// Engagement Service
// ============================================================================

export class EngagementService {
  private readonly nodeMap: Map<string, bigint> = new Map();
  private readonly emptyHashes: bigint[];
  private readonly identityMap: Map<string, EngagementIdentityRecord> = new Map(); // identityCommitment hex → record
  private readonly signerMap: Map<string, string> = new Map(); // signer address (lowercase) → identityCommitment hex
  private readonly leafIndexMap: Map<number, string> = new Map(); // leafIndex → identityCommitment hex (reverse index for O(1) getProof)
  private nextLeafIndex: number = 0;
  readonly depth: number;
  private readonly capacity: number;
  private readonly hasher: Poseidon2Hasher;
  private lockChain: Promise<void> = Promise.resolve();
  private root: bigint;
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
   * Create a new EngagementService with an empty Tree 3.
   */
  static async create(
    depth: number = 20,
    logOptions?: InsertionLogOptions,
  ): Promise<EngagementService> {
    const hasher = await getHasher();

    const paddingLeaf = await hasher.hashPair(0n, 0n);
    const emptyHashes: bigint[] = [paddingLeaf];
    for (let i = 1; i <= depth; i++) {
      emptyHashes[i] = await hasher.hashPair(emptyHashes[i - 1], emptyHashes[i - 1]);
    }

    const service = new EngagementService(hasher, emptyHashes, depth);

    if (logOptions) {
      service.insertionLog = await InsertionLog.open(logOptions);
      const { entries, verification } = await service.insertionLog.replay();

      if (verification.brokenLinks > 0 || verification.invalidSignatures > 0) {
        const isRecoverableCrash = verification.brokenLinks === 1
          && verification.invalidSignatures === 0
          && verification.lastEntryBroken === true;

        if (!isRecoverableCrash) {
          throw new Error(
            `FATAL: Engagement log integrity compromised. ` +
            `${verification.brokenLinks} broken links, ` +
            `${verification.invalidSignatures} invalid signatures.`
          );
        }
        logger.warn('EngagementService: last log entry truncated (crash recovery)');
      }

      if (entries.length > 0) {
        logger.info('EngagementService replaying engagement log', { entries: entries.length });

        for (const entry of entries) {
          // Engagement log entries carry metadata in a JSON field
          if (entry.type === 'replace') {
            // Upsert: parse metadata from leaf field
            await service.replayUpsert(entry);
          } else {
            // Register: parse metadata from leaf field
            await service.replayRegister(entry);
          }
        }

        logger.info('EngagementService replay complete', {
          identities: service.identityMap.size,
          rootPrefix: '0x' + service.root.toString(16).slice(0, 16) + '...',
        });
      }
    }

    logger.info('EngagementService initialized', {
      depth,
      capacity: 2 ** depth,
      identities: service.identityMap.size,
    });

    return service;
  }

  // ========================================================================
  // Identity Registration
  // ========================================================================

  /**
   * Register an identity for engagement tracking.
   * Inserts a tier-0 leaf and returns the leaf index.
   */
  async registerIdentity(signerAddress: string, identityCommitment: bigint): Promise<number> {
    this.validateField(identityCommitment);
    const icHex = identityCommitment.toString(16);
    const signerLower = signerAddress.toLowerCase();

    const release = await this.acquireLock();
    try {
      // Duplicate checks INSIDE lock to prevent TOCTOU race
      if (this.identityMap.has(icHex)) {
        throw new Error('IDENTITY_ALREADY_REGISTERED');
      }
      if (this.signerMap.has(signerLower)) {
        throw new Error('SIGNER_ALREADY_REGISTERED');
      }
      if (this.nextLeafIndex >= this.capacity) {
        throw new Error('Tree capacity exceeded');
      }

      const leafIndex = this.nextLeafIndex;
      const metrics: EngagementMetrics = { actionCount: 0, diversityScore: 0, tenureMonths: 0 };
      const tier = 0 as const;

      // Compute leaf: H2(identityCommitment, H3(0, 0, 0))
      const dc = await computeEngagementDataCommitment(0n, 0n, 0n);
      const leaf = await computeEngagementLeaf(identityCommitment, dc);

      // WAL: log before mutation
      if (this.insertionLog) {
        await this.insertionLog.append({
          leaf: '0x' + leaf.toString(16),
          index: leafIndex,
          ts: Date.now(),
          type: 'insert',
          attestationHash: `engagement:register:${signerLower}:${icHex}`,
        });
      }

      // Insert into tree
      await this.insertLeafAtIndex(leafIndex, leaf);
      this.nextLeafIndex++;

      // Store identity record
      const record: EngagementIdentityRecord = {
        identityCommitment,
        signerAddress: signerLower,
        leafIndex,
        metrics,
        tier,
        registeredAt: Date.now(),
      };
      this.identityMap.set(icHex, record);
      this.signerMap.set(signerLower, icHex);
      this.leafIndexMap.set(leafIndex, icHex);

      logger.info('Identity registered for engagement', {
        leafIndex,
        signer: signerLower,
        rootPrefix: '0x' + this.root.toString(16).slice(0, 16) + '...',
      });

      return leafIndex;
    } finally {
      release();
    }
  }

  // ========================================================================
  // Metrics Update
  // ========================================================================

  /**
   * Update engagement metrics for a registered identity.
   * Recomputes the leaf in-place (same leafIndex, new hash).
   */
  async updateMetrics(
    identityCommitment: bigint,
    metrics: EngagementMetrics,
  ): Promise<EngagementProofResult> {
    this.validateField(identityCommitment);
    if (!Number.isInteger(metrics.actionCount) || metrics.actionCount < 0) {
      throw new Error('actionCount must be a non-negative integer');
    }
    if (!Number.isInteger(metrics.diversityScore) || metrics.diversityScore < 0) {
      throw new Error('diversityScore must be a non-negative integer');
    }
    if (!Number.isInteger(metrics.tenureMonths) || metrics.tenureMonths < 0) {
      throw new Error('tenureMonths must be a non-negative integer');
    }
    const icHex = identityCommitment.toString(16);
    const record = this.identityMap.get(icHex);
    if (!record) {
      throw new Error('IDENTITY_NOT_REGISTERED');
    }

    const release = await this.acquireLock();
    try {
      const tier = deriveTier(metrics.actionCount, metrics.diversityScore, metrics.tenureMonths);

      // Compute new leaf
      const dc = await computeEngagementDataCommitment(
        BigInt(tier),
        BigInt(metrics.actionCount),
        BigInt(metrics.diversityScore),
      );
      const leaf = await computeEngagementLeaf(identityCommitment, dc);

      // WAL: log before mutation (type=replace for upsert)
      if (this.insertionLog) {
        await this.insertionLog.append({
          leaf: '0x' + leaf.toString(16),
          index: record.leafIndex,
          ts: Date.now(),
          type: 'replace',
          oldIndex: record.leafIndex,
          attestationHash: `engagement:update:${icHex}:${metrics.actionCount}:${metrics.diversityScore}:${metrics.tenureMonths}`,
        });
      }

      // Update tree in-place
      await this.insertLeafAtIndex(record.leafIndex, leaf);

      // Update record
      const updatedRecord: EngagementIdentityRecord = {
        ...record,
        metrics,
        tier: tier as 0 | 1 | 2 | 3 | 4,
      };
      this.identityMap.set(icHex, updatedRecord);

      const { siblings, pathIndices } = this.computeProof(record.leafIndex);

      return {
        leafIndex: record.leafIndex,
        engagementRoot: '0x' + this.root.toString(16),
        engagementPath: siblings.map(s => '0x' + s.toString(16)),
        pathIndices,
        tier,
        actionCount: metrics.actionCount,
        diversityScore: metrics.diversityScore,
      };
    } finally {
      release();
    }
  }

  /**
   * Batch update: process multiple entries at once.
   * For each entry, registers if new or updates if existing.
   */
  async batchUpdate(entries: EngagementData[]): Promise<void> {
    for (const entry of entries) {
      const icHex = entry.identityCommitment.toString(16);
      if (!this.identityMap.has(icHex)) {
        // Skip unregistered identities in batch mode
        continue;
      }
      await this.updateMetrics(entry.identityCommitment, {
        actionCount: Number(entry.actionCount),
        diversityScore: Number(entry.diversityScore),
        tenureMonths: entry.tenureMonths ?? 0,
      });
    }
  }

  // ========================================================================
  // Read Operations
  // ========================================================================

  /**
   * Get Merkle proof for a leaf by index.
   * Intentionally lock-free: this method is synchronous and Node.js single-threaded
   * execution prevents interleaving with async mutations in updateMetrics.
   * Do NOT introduce await statements in updateMetrics between tree mutation
   * and identityMap update, or this assumption breaks.
   */
  getProof(leafIndex: number): EngagementProofResult {
    if (leafIndex < 0 || leafIndex >= this.nextLeafIndex) {
      throw new Error(`Leaf index ${leafIndex} out of range [0, ${this.nextLeafIndex})`);
    }

    // O(1) reverse index lookup
    const icHex = this.leafIndexMap.get(leafIndex);
    const record = icHex ? this.identityMap.get(icHex) : undefined;

    const { siblings, pathIndices } = this.computeProof(leafIndex);

    return {
      leafIndex,
      engagementRoot: '0x' + this.root.toString(16),
      engagementPath: siblings.map(s => '0x' + s.toString(16)),
      pathIndices,
      tier: record?.tier ?? 0,
      actionCount: record?.metrics.actionCount ?? 0,
      diversityScore: record?.metrics.diversityScore ?? 0,
    };
  }

  /** Get identity record by identityCommitment */
  getMetrics(identityCommitment: bigint): EngagementIdentityRecord | null {
    const icHex = identityCommitment.toString(16);
    return this.identityMap.get(icHex) ?? null;
  }

  /** Get identity record by signer address */
  getMetricsBySigner(signerAddress: string): EngagementIdentityRecord | null {
    const signerLower = signerAddress.toLowerCase();
    const icHex = this.signerMap.get(signerLower);
    if (!icHex) return null;
    return this.identityMap.get(icHex) ?? null;
  }

  getRoot(): bigint { return this.root; }
  getRootHex(): string { return '0x' + this.root.toString(16); }
  getLeafCount(): number { return this.nextLeafIndex; }
  getDepth(): number { return this.depth; }

  getInsertionLog(): InsertionLog | null { return this.insertionLog; }

  async close(): Promise<void> {
    if (this.insertionLog) {
      await this.insertionLog.close();
      this.insertionLog = null;
    }
  }

  // ========================================================================
  // Internal Helpers
  // ========================================================================

  private async insertLeafAtIndex(index: number, leaf: bigint): Promise<void> {
    this.setNode(0, index, leaf);

    let currentIndex = index;
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

  private computeProof(leafIndex: number): { siblings: bigint[]; pathIndices: number[] } {
    const siblings: bigint[] = [];
    const pathIndices: number[] = [];

    let currentIndex = leafIndex;
    for (let level = 0; level < this.depth; level++) {
      const isRight = currentIndex & 1;
      const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;
      siblings.push(this.getNode(level, siblingIndex));
      pathIndices.push(isRight ? 1 : 0);
      currentIndex = currentIndex >> 1;
    }

    return { siblings, pathIndices };
  }

  private getNode(level: number, index: number): bigint {
    const key = `${level}:${index}`;
    return this.nodeMap.get(key) ?? this.emptyHashes[level];
  }

  private setNode(level: number, index: number, value: bigint): void {
    const key = `${level}:${index}`;
    if (value === this.emptyHashes[level]) {
      this.nodeMap.delete(key);
    } else {
      this.nodeMap.set(key, value);
    }
  }

  private validateField(value: bigint): void {
    if (value <= 0n || value >= BN254_MODULUS) {
      throw new Error('Value must be a valid BN254 field element (0 < v < p)');
    }
  }

  private async acquireLock(): Promise<() => void> {
    let release!: () => void;
    const acquired = new Promise<void>((resolve) => { release = resolve; });
    const previousLock = this.lockChain;
    this.lockChain = acquired;
    await previousLock;
    return release;
  }

  // ========================================================================
  // Log Replay
  // ========================================================================

  private async replayRegister(entry: { leaf: string; index: number; ts?: number; attestationHash?: string }): Promise<void> {
    // Parse attestation to recover signer and identityCommitment
    const meta = entry.attestationHash ?? '';
    const parts = meta.split(':');
    if (parts.length < 4 || parts[0] !== 'engagement' || parts[1] !== 'register') {
      logger.warn('EngagementService: skipping unrecognized log entry', { index: entry.index });
      return;
    }

    const signerLower = parts[2];
    const icHex = parts[3];
    const identityCommitment = BigInt('0x' + icHex);
    const leaf = BigInt(entry.leaf);

    // Verify leaf matches recomputed value (ENG-003: detect log corruption)
    const dc = await computeEngagementDataCommitment(0n, 0n, 0n);
    const expectedLeaf = await computeEngagementLeaf(identityCommitment, dc);
    if (leaf !== expectedLeaf) {
      throw new Error(
        `FATAL: Replay leaf mismatch at index ${entry.index} — log integrity compromised`
      );
    }

    if (this.identityMap.has(icHex)) return; // Already replayed

    await this.insertLeafAtIndex(entry.index, leaf);
    if (entry.index >= this.nextLeafIndex) {
      this.nextLeafIndex = entry.index + 1;
    }

    const record: EngagementIdentityRecord = {
      identityCommitment,
      signerAddress: signerLower,
      leafIndex: entry.index,
      metrics: { actionCount: 0, diversityScore: 0, tenureMonths: 0 },
      tier: 0,
      registeredAt: entry.ts ?? Date.now(),
    };
    this.identityMap.set(icHex, record);
    this.signerMap.set(signerLower, icHex);
    this.leafIndexMap.set(entry.index, icHex);
  }

  private async replayUpsert(entry: { leaf: string; index: number; attestationHash?: string }): Promise<void> {
    // Parse attestation to recover metrics
    const meta = entry.attestationHash ?? '';
    const parts = meta.split(':');
    if (parts.length < 6 || parts[0] !== 'engagement' || parts[1] !== 'update') {
      logger.warn('EngagementService: skipping unrecognized update entry', { index: entry.index });
      return;
    }

    const icHex = parts[2];
    const actionCount = parseInt(parts[3], 10);
    const diversityScore = parseInt(parts[4], 10);
    const tenureMonths = parseInt(parts[5], 10);
    const leaf = BigInt(entry.leaf);

    const existing = this.identityMap.get(icHex);
    if (!existing) {
      logger.warn('EngagementService: skipping update for unregistered identity', { icHex });
      return;
    }

    // Assert log index matches record to detect corruption (ENG-009)
    if (entry.index !== existing.leafIndex) {
      throw new Error(
        `FATAL: Replay index mismatch for ${icHex}: log=${entry.index}, record=${existing.leafIndex}`
      );
    }

    // Verify leaf matches recomputed value (ENG-003: detect log corruption)
    const tier = deriveTier(actionCount, diversityScore, tenureMonths);
    const dc = await computeEngagementDataCommitment(
      BigInt(tier), BigInt(actionCount), BigInt(diversityScore),
    );
    const expectedLeaf = await computeEngagementLeaf(existing.identityCommitment, dc);
    if (leaf !== expectedLeaf) {
      throw new Error(
        `FATAL: Replay leaf mismatch at index ${entry.index} — log integrity compromised`
      );
    }

    await this.insertLeafAtIndex(entry.index, leaf);

    const metrics: EngagementMetrics = { actionCount, diversityScore, tenureMonths };

    const updated: EngagementIdentityRecord = {
      ...existing,
      metrics,
      tier: tier as 0 | 1 | 2 | 3 | 4,
    };
    this.identityMap.set(icHex, updated);
  }
}
