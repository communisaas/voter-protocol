/**
 * Snapshot Versioning Types
 *
 * Type definitions for Shadow Atlas snapshot versioning system.
 * Snapshots represent immutable checkpoints of the boundary Merkle tree,
 * enabling reproducible builds and incremental updates.
 *
 * CRITICAL TYPE SAFETY: Snapshot versioning is cryptographic infrastructure.
 * Wrong types here can:
 * - Break snapshot provenance (audit trail corruption)
 * - Enable Merkle root forgery (security breach)
 * - Cause IPFS content mismatches (data integrity failure)
 */

/**
 * Snapshot metadata - complete record of an Atlas build
 */
export interface Snapshot {
  /** Unique snapshot identifier (UUID v4) */
  readonly id: string;

  /** Monotonic version number (1, 2, 3, ...) */
  readonly version: number;

  /** Merkle root commitment (bigint for precision) */
  readonly merkleRoot: bigint;

  /** Snapshot creation timestamp */
  readonly timestamp: Date;

  /** IPFS CID (optional until published) */
  readonly ipfsCid?: string;

  /** Boundary counts per layer */
  readonly layerCounts: Record<string, number>;

  /** Build metadata and provenance */
  readonly metadata: SnapshotMetadata;
}

/**
 * Snapshot metadata - provenance and build context
 */
export interface SnapshotMetadata {
  /** TIGER data vintage/year (e.g., 2024) */
  readonly tigerVintage: number;

  /** States included (FIPS codes) */
  readonly statesIncluded: readonly string[];

  /** Layers included (cd, sldu, sldl, county, etc.) */
  readonly layersIncluded: readonly string[];

  /** Build duration in milliseconds */
  readonly buildDurationMs: number;

  /** Source checksums (layer → SHA-256 hash) */
  readonly sourceChecksums: Record<string, string>;

  /** Optional: Job ID that created this snapshot */
  readonly jobId?: string;

  /** Optional: Previous snapshot version (for incremental updates) */
  readonly previousVersion?: number;

  /** Optional: Notes about this snapshot */
  readonly notes?: string;
}

/**
 * Snapshot diff - changes between two snapshots
 */
export interface SnapshotDiff {
  /** Source snapshot version */
  readonly fromVersion: number;

  /** Target snapshot version */
  readonly toVersion: number;

  /** Layers added */
  readonly layersAdded: readonly string[];

  /** Layers removed */
  readonly layersRemoved: readonly string[];

  /** Layers modified */
  readonly layersModified: readonly {
    readonly layer: string;
    readonly fromCount: number;
    readonly toCount: number;
    readonly delta: number;
  }[];

  /** States added */
  readonly statesAdded: readonly string[];

  /** States removed */
  readonly statesRemoved: readonly string[];

  /** Merkle root changed */
  readonly merkleRootChanged: boolean;

  /** Total boundary count change */
  readonly boundaryCountDelta: number;
}

/**
 * Snapshot list entry (lightweight for pagination)
 */
export interface SnapshotListEntry {
  readonly id: string;
  readonly version: number;
  readonly merkleRoot: bigint;
  readonly timestamp: Date;
  readonly ipfsCid?: string;
  readonly totalBoundaries: number;
}

/**
 * Proof template storage entry (for snapshot persistence)
 *
 * This is imported from atlas.ts - re-exported here for convenience.
 */
export type { ProofTemplate, ProofTemplateStore } from '../core/types/atlas.js';
