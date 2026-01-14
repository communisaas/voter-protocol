/**
 * Snapshot Manager - Versioned Atlas Build Management
 *
 * Manages snapshot versioning for the Shadow Atlas, enabling:
 * - Reproducible builds with cryptographic commitments
 * - Incremental updates with provenance
 * - IPFS publishing with content addressing
 * - Snapshot comparison and diffing
 *
 * ARCHITECTURE:
 * - SQLite persistence for snapshot metadata (when available)
 * - File-based fallback for lightweight deployments
 * - Monotonic version numbers for ordering
 * - Snapshot IDs for unique identification
 *
 * CRITICAL TYPE SAFETY: This is cryptographic infrastructure.
 * Type errors can corrupt the snapshot chain or enable Merkle root forgery.
 */

import { randomUUID, createHash } from 'crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWriteJSON } from '../../core/utils/atomic-write.js';
import type { SqlitePersistenceAdapter } from '../../persistence/sqlite-adapter.js';
import type { AtlasBuildResult } from '../../core/types/atlas.js';
import type {
  Snapshot,
  SnapshotMetadata,
  SnapshotDiff,
  SnapshotListEntry,
  ProofTemplate,
  ProofTemplateStore,
} from './types.js';

/**
 * Snapshot Manager
 *
 * Manages versioned snapshots of Atlas builds with dual-mode persistence:
 * - SQLite for production deployments (queryable, transactional)
 * - File-based for development/testing (portable, no dependencies)
 */
export class SnapshotManager {
  private readonly storageDir: string;
  private readonly db: SqlitePersistenceAdapter | null;

  /**
   * Create a new SnapshotManager
   *
   * @param storageDir - Directory for snapshot storage
   * @param db - Optional SQLite adapter (if not provided, uses file-based storage)
   */
  constructor(storageDir: string, db?: SqlitePersistenceAdapter) {
    this.storageDir = storageDir;
    this.db = db ?? null;
  }

  /**
   * Initialize storage (create directories, run migrations)
   */
  async initialize(): Promise<void> {
    if (this.db) {
      // SQLite mode - ensure snapshots table exists
      await this.db.runMigrations();
    } else {
      // File mode - ensure snapshots directory exists
      const snapshotsDir = join(this.storageDir, 'snapshots');
      await mkdir(snapshotsDir, { recursive: true });
    }
  }

  /**
   * Create a new snapshot from Atlas build result
   *
   * @param result - Atlas build result
   * @param metadata - Partial metadata (will be merged with defaults)
   * @returns Created snapshot
   */
  async createSnapshot(
    result: AtlasBuildResult,
    metadata: Partial<SnapshotMetadata>
  ): Promise<Snapshot> {
    const id = randomUUID();
    const version = await this.getNextVersion();
    const timestamp = new Date();

    // Compute source checksums from layer validations
    const sourceChecksums: Record<string, string> = {};
    for (const layerValidation of result.layerValidations) {
      // Use layer name as key, compute checksum from validation data
      const checksumInput = JSON.stringify({
        layer: layerValidation.layer,
        boundaryCount: layerValidation.boundaryCount,
        qualityScore: layerValidation.qualityScore,
      });
      sourceChecksums[layerValidation.layer] = createHash('sha256')
        .update(checksumInput)
        .digest('hex');
    }

    // Build complete metadata
    const completeMetadata: SnapshotMetadata = {
      tigerVintage: metadata.tigerVintage ?? new Date().getFullYear(),
      statesIncluded: metadata.statesIncluded ?? [],
      layersIncluded: metadata.layersIncluded ?? Object.keys(result.layerCounts),
      buildDurationMs: metadata.buildDurationMs ?? result.duration,
      sourceChecksums: metadata.sourceChecksums ?? sourceChecksums,
      jobId: metadata.jobId ?? result.jobId,
      previousVersion: metadata.previousVersion,
      notes: metadata.notes,
    };

    const snapshot: Snapshot = {
      id,
      version,
      merkleRoot: result.merkleRoot,
      timestamp,
      layerCounts: result.layerCounts,
      metadata: completeMetadata,
    };

    // Persist snapshot
    await this.persistSnapshot(snapshot);

    return snapshot;
  }

  /**
   * Get latest snapshot
   *
   * @returns Latest snapshot or null if no snapshots exist
   */
  async getLatest(): Promise<Snapshot | null> {
    if (this.db) {
      return this.getLatestFromDb();
    } else {
      return this.getLatestFromFiles();
    }
  }

  /**
   * Get snapshot by version number
   *
   * @param version - Version number
   * @returns Snapshot or null if not found
   */
  async getByVersion(version: number): Promise<Snapshot | null> {
    if (this.db) {
      return this.getByVersionFromDb(version);
    } else {
      return this.getByVersionFromFiles(version);
    }
  }

  /**
   * Get snapshot by ID
   *
   * @param id - Snapshot ID
   * @returns Snapshot or null if not found
   */
  async getById(id: string): Promise<Snapshot | null> {
    if (this.db) {
      return this.getByIdFromDb(id);
    } else {
      return this.getByIdFromFiles(id);
    }
  }

  /**
   * List snapshots with pagination
   *
   * @param limit - Maximum number of snapshots to return
   * @param offset - Number of snapshots to skip
   * @returns List of snapshot entries (sorted by version DESC)
   */
  async list(limit: number, offset: number): Promise<readonly SnapshotListEntry[]> {
    if (this.db) {
      return this.listFromDb(limit, offset);
    } else {
      return this.listFromFiles(limit, offset);
    }
  }

  /**
   * Compare two snapshots
   *
   * @param fromVersion - Source snapshot version
   * @param toVersion - Target snapshot version
   * @returns Snapshot diff
   */
  async diff(fromVersion: number, toVersion: number): Promise<SnapshotDiff> {
    const fromSnapshot = await this.getByVersion(fromVersion);
    const toSnapshot = await this.getByVersion(toVersion);

    if (!fromSnapshot) {
      throw new Error(`Snapshot version ${fromVersion} not found`);
    }
    if (!toSnapshot) {
      throw new Error(`Snapshot version ${toVersion} not found`);
    }

    // Compute layer changes
    const fromLayers = new Set(fromSnapshot.metadata.layersIncluded);
    const toLayers = new Set(toSnapshot.metadata.layersIncluded);

    const layersAdded = Array.from(toLayers).filter(l => !fromLayers.has(l));
    const layersRemoved = Array.from(fromLayers).filter(l => !toLayers.has(l));

    const layersModified: Array<{
      readonly layer: string;
      readonly fromCount: number;
      readonly toCount: number;
      readonly delta: number;
    }> = [];

    for (const layer of Array.from(fromLayers)) {
      if (toLayers.has(layer)) {
        const fromCount = fromSnapshot.layerCounts[layer] ?? 0;
        const toCount = toSnapshot.layerCounts[layer] ?? 0;

        if (fromCount !== toCount) {
          layersModified.push({
            layer,
            fromCount,
            toCount,
            delta: toCount - fromCount,
          });
        }
      }
    }

    // Compute state changes
    const fromStates = new Set(fromSnapshot.metadata.statesIncluded);
    const toStates = new Set(toSnapshot.metadata.statesIncluded);

    const statesAdded = Array.from(toStates).filter(s => !fromStates.has(s));
    const statesRemoved = Array.from(fromStates).filter(s => !toStates.has(s));

    // Compute boundary count delta
    const fromTotalBoundaries = Object.values(fromSnapshot.layerCounts).reduce(
      (sum, count) => sum + count,
      0
    );
    const toTotalBoundaries = Object.values(toSnapshot.layerCounts).reduce(
      (sum, count) => sum + count,
      0
    );

    return {
      fromVersion,
      toVersion,
      layersAdded,
      layersRemoved,
      layersModified,
      statesAdded,
      statesRemoved,
      merkleRootChanged: fromSnapshot.merkleRoot !== toSnapshot.merkleRoot,
      boundaryCountDelta: toTotalBoundaries - fromTotalBoundaries,
    };
  }

  /**
   * Update snapshot with IPFS CID (after publishing)
   *
   * @param id - Snapshot ID
   * @param cid - IPFS content identifier
   */
  async setIpfsCid(id: string, cid: string): Promise<void> {
    if (this.db) {
      await this.setIpfsCidInDb(id, cid);
    } else {
      await this.setIpfsCidInFiles(id, cid);
    }
  }

  // ============================================================================
  // Private Methods - SQLite Persistence
  // ============================================================================

  private async persistSnapshot(snapshot: Snapshot): Promise<void> {
    if (this.db) {
      await this.persistSnapshotToDb(snapshot);
    } else {
      await this.persistSnapshotToFile(snapshot);
    }
  }

  private async persistSnapshotToDb(snapshot: Snapshot): Promise<void> {
    // Use the existing createSnapshot method from SqlitePersistenceAdapter
    // Note: We need to adapt our Snapshot type to the adapter's expected format
    const snapshotMetadataForDb = {
      merkleRoot: `0x${snapshot.merkleRoot.toString(16)}`,
      ipfsCID: snapshot.ipfsCid ?? '',
      boundaryCount: Object.values(snapshot.layerCounts).reduce((sum, count) => sum + count, 0),
      createdAt: snapshot.timestamp,
      regions: snapshot.metadata.statesIncluded,
    };

    // Store using adapter's createSnapshot method
    // The adapter will generate its own ID, so we'll need to track the mapping
    await this.db!.createSnapshot(snapshot.metadata.jobId ?? '', snapshotMetadataForDb);

    // Also store our extended snapshot data in a separate file for full metadata
    const snapshotsDir = join(this.storageDir, 'snapshots');
    await mkdir(snapshotsDir, { recursive: true });

    const filePath = join(snapshotsDir, `snapshot-v${snapshot.version}-${snapshot.id}.json`);
    // Use atomic write to prevent snapshot corruption on crash
    await atomicWriteJSON(filePath, this.serializeSnapshot(snapshot));
  }

  private async persistSnapshotToFile(snapshot: Snapshot): Promise<void> {
    const snapshotsDir = join(this.storageDir, 'snapshots');
    await mkdir(snapshotsDir, { recursive: true });

    const filePath = join(snapshotsDir, `snapshot-v${snapshot.version}-${snapshot.id}.json`);
    // Use atomic write to prevent snapshot corruption on crash
    await atomicWriteJSON(filePath, this.serializeSnapshot(snapshot));
  }

  private async getLatestFromDb(): Promise<Snapshot | null> {
    // Get latest from SQLite adapter
    const snapshots = await this.db!.listSnapshots(1);

    if (snapshots.length === 0) {
      return null;
    }

    // Load full snapshot from file
    const dbSnapshot = snapshots[0];
    return this.loadSnapshotFromFileById(dbSnapshot.id);
  }

  private async getLatestFromFiles(): Promise<Snapshot | null> {
    const snapshots = await this.listFromFiles(1, 0);

    if (snapshots.length === 0) {
      return null;
    }

    return this.getByIdFromFiles(snapshots[0].id);
  }

  private async getByVersionFromDb(version: number): Promise<Snapshot | null> {
    // List all snapshots and find matching version
    const allSnapshots = await this.listAllSnapshotFiles();
    const snapshot = allSnapshots.find(s => s.version === version);

    if (!snapshot) {
      return null;
    }

    return this.loadSnapshotFromFileById(snapshot.id);
  }

  private async getByVersionFromFiles(version: number): Promise<Snapshot | null> {
    const allSnapshots = await this.listAllSnapshotFiles();
    const snapshot = allSnapshots.find(s => s.version === version);

    if (!snapshot) {
      return null;
    }

    return this.loadSnapshotFromFileById(snapshot.id);
  }

  private async getByIdFromDb(id: string): Promise<Snapshot | null> {
    return this.loadSnapshotFromFileById(id);
  }

  private async getByIdFromFiles(id: string): Promise<Snapshot | null> {
    return this.loadSnapshotFromFileById(id);
  }

  private async listFromDb(limit: number, offset: number): Promise<readonly SnapshotListEntry[]> {
    const allSnapshots = await this.listAllSnapshotFiles();
    const sorted = allSnapshots.sort((a, b) => b.version - a.version);
    return sorted.slice(offset, offset + limit);
  }

  private async listFromFiles(limit: number, offset: number): Promise<readonly SnapshotListEntry[]> {
    const allSnapshots = await this.listAllSnapshotFiles();
    const sorted = allSnapshots.sort((a, b) => b.version - a.version);
    return sorted.slice(offset, offset + limit);
  }

  private async setIpfsCidInDb(id: string, cid: string): Promise<void> {
    const snapshot = await this.loadSnapshotFromFileById(id);

    if (!snapshot) {
      throw new Error(`Snapshot ${id} not found`);
    }

    const updated: Snapshot = {
      ...snapshot,
      ipfsCid: cid,
    };

    await this.persistSnapshotToFile(updated);
  }

  private async setIpfsCidInFiles(id: string, cid: string): Promise<void> {
    const snapshot = await this.loadSnapshotFromFileById(id);

    if (!snapshot) {
      throw new Error(`Snapshot ${id} not found`);
    }

    const updated: Snapshot = {
      ...snapshot,
      ipfsCid: cid,
    };

    await this.persistSnapshotToFile(updated);
  }

  // ============================================================================
  // Private Methods - File Operations
  // ============================================================================

  private async listAllSnapshotFiles(): Promise<SnapshotListEntry[]> {
    const snapshotsDir = join(this.storageDir, 'snapshots');

    try {
      const files = await readdir(snapshotsDir);
      const snapshotFiles = files.filter(f => f.startsWith('snapshot-v') && f.endsWith('.json'));

      const entries: SnapshotListEntry[] = [];

      for (const file of snapshotFiles) {
        try {
          const filePath = join(snapshotsDir, file);
          const content = await readFile(filePath, 'utf-8');
          const data = JSON.parse(content);
          const snapshot = this.deserializeSnapshot(data);

          const totalBoundaries = Object.values(snapshot.layerCounts).reduce(
            (sum, count) => sum + count,
            0
          );

          entries.push({
            id: snapshot.id,
            version: snapshot.version,
            merkleRoot: snapshot.merkleRoot,
            timestamp: snapshot.timestamp,
            ipfsCid: snapshot.ipfsCid,
            totalBoundaries,
          });
        } catch {
          // Skip invalid files
          continue;
        }
      }

      return entries;
    } catch {
      return [];
    }
  }

  private async loadSnapshotFromFileById(id: string): Promise<Snapshot | null> {
    const snapshotsDir = join(this.storageDir, 'snapshots');

    try {
      const files = await readdir(snapshotsDir);
      const matchingFile = files.find(f => f.includes(id) && f.endsWith('.json'));

      if (!matchingFile) {
        return null;
      }

      const filePath = join(snapshotsDir, matchingFile);
      const content = await readFile(filePath, 'utf-8');
      const data = JSON.parse(content);

      return this.deserializeSnapshot(data);
    } catch {
      return null;
    }
  }

  private async getNextVersion(): Promise<number> {
    const latest = await this.getLatest();
    return latest ? latest.version + 1 : 1;
  }

  // ============================================================================
  // Proof Template Storage
  // ============================================================================

  /**
   * Store proof templates for a snapshot
   *
   * Proof templates contain Merkle proofs (siblings + path indices) for each
   * district. Clients complete these with their user secret for nullifier
   * computation.
   *
   * @param snapshotId - Snapshot ID to store proofs for
   * @param proofs - Map of districtId → ProofTemplate
   * @param merkleRoot - Merkle root for this snapshot
   * @param treeDepth - Depth of the Merkle tree
   */
  async storeProofs(
    snapshotId: string,
    proofs: ReadonlyMap<string, ProofTemplate>,
    merkleRoot: bigint,
    treeDepth: number
  ): Promise<void> {
    const proofsDir = join(this.storageDir, 'proofs');
    await mkdir(proofsDir, { recursive: true });

    // Convert Map to Record for JSON serialization
    const templates: Record<string, ProofTemplate> = {};
    for (const [districtId, template] of proofs) {
      templates[districtId] = template;
    }

    const store: ProofTemplateStore = {
      merkleRoot: `0x${merkleRoot.toString(16)}`,
      treeDepth,
      templateCount: proofs.size,
      generatedAt: new Date().toISOString(),
      templates,
    };

    const filePath = join(proofsDir, `proofs-${snapshotId}.json`);
    // Use atomic write to prevent proof template corruption on crash
    await atomicWriteJSON(filePath, store);
  }

  /**
   * Get proof template for a specific district
   *
   * @param snapshotId - Snapshot ID to retrieve proof from
   * @param districtId - District ID to get proof template for
   * @returns ProofTemplate or null if not found
   */
  async getProofTemplate(
    snapshotId: string,
    districtId: string
  ): Promise<ProofTemplate | null> {
    const store = await this.getProofTemplateStore(snapshotId);
    if (!store) {
      return null;
    }

    return store.templates[districtId] ?? null;
  }

  /**
   * Get all proof templates for a snapshot
   *
   * @param snapshotId - Snapshot ID to retrieve proofs from
   * @returns ProofTemplateStore or null if not found
   */
  async getProofTemplateStore(snapshotId: string): Promise<ProofTemplateStore | null> {
    const proofsDir = join(this.storageDir, 'proofs');
    const filePath = join(proofsDir, `proofs-${snapshotId}.json`);

    try {
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content) as ProofTemplateStore;
    } catch {
      return null;
    }
  }

  /**
   * Check if proof templates exist for a snapshot
   *
   * @param snapshotId - Snapshot ID to check
   * @returns true if proof templates exist
   */
  async hasProofTemplates(snapshotId: string): Promise<boolean> {
    const store = await this.getProofTemplateStore(snapshotId);
    return store !== null;
  }

  // ============================================================================
  // Private Methods - Serialization
  // ============================================================================

  private serializeSnapshot(snapshot: Snapshot): Record<string, unknown> {
    return {
      id: snapshot.id,
      version: snapshot.version,
      merkleRoot: `0x${snapshot.merkleRoot.toString(16)}`,
      timestamp: snapshot.timestamp.toISOString(),
      ipfsCid: snapshot.ipfsCid,
      layerCounts: snapshot.layerCounts,
      metadata: snapshot.metadata,
    };
  }

  private deserializeSnapshot(data: Record<string, unknown>): Snapshot {
    return {
      id: data.id as string,
      version: data.version as number,
      merkleRoot: BigInt(data.merkleRoot as string),
      timestamp: new Date(data.timestamp as string),
      ipfsCid: data.ipfsCid as string | undefined,
      layerCounts: data.layerCounts as Record<string, number>,
      metadata: data.metadata as SnapshotMetadata,
    };
  }
}
