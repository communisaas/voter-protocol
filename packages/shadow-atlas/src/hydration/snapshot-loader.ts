/**
 * Tree 2 Snapshot Loader
 *
 * Loads a pre-built Tree 2 snapshot (from build-tree2.ts) and reconstructs
 * CellMapState without re-downloading BAFs. This enables fast server startup
 * for production deployments.
 *
 * @packageDocumentation
 */

import { readFile } from 'node:fs/promises';
import { buildCellMapTree, toCellMapState, type CellDistrictMapping } from '../tree-builder.js';
import type { CellMapState } from '../serving/registration-service.js';

/**
 * Vintage metadata for a Tree 2 snapshot.
 * Tags the snapshot with temporal context so multiple redistricting
 * cycles can coexist and historical proofs remain valid.
 */
export interface SnapshotVintage {
  /** Human-readable label: "119th-congress" | "2023-representation-order" */
  readonly label: string;
  /** ISO 3166-1 alpha-3 country code: "USA" | "CAN" */
  readonly country: string;
  /** When these boundaries took effect (ISO 8601) */
  readonly effectiveDate: string;
  /** When superseded by new boundaries (null if current) */
  readonly expiryDate?: string;
  /** Data source identifier: "census-baf-2020+bef-119th" | "statcan-fed-2023" */
  readonly source: string;
  /** On-chain commitment timestamp (populated after DistrictGate.commitRoot) */
  readonly committedAt?: string;
  /** On-chain commitment transaction hash */
  readonly txHash?: string;
}

/** Shape of the snapshot JSON file (version 2 or 3) */
interface Tree2Snapshot {
  readonly version: number;
  readonly root: string;
  readonly depth: number;
  readonly cellCount: number;
  /** Vintage metadata (version 3+). Optional for backward compat with v2. */
  readonly vintage?: SnapshotVintage;
  readonly mappings: ReadonlyArray<{
    readonly cellId: string;
    readonly districts: readonly string[];
  }>;
}

/** Result of loading a snapshot — CellMapState + optional vintage. */
export interface SnapshotLoadResult {
  readonly state: CellMapState;
  readonly vintage: SnapshotVintage | null;
}

/** Options for snapshot loading. */
export interface SnapshotLoadOptions {
  /**
   * Expected root hash from an external trust anchor (e.g., on-chain CellMapRegistry).
   * If provided, the recomputed root is verified against this value in addition to
   * the root stored in the snapshot file itself. This prevents an attacker from
   * modifying both mappings and root consistently.
   *
   * Pass the root as a bigint. The caller is responsible for fetching it from
   * the chain — this module does NOT depend on ethers/viem.
   */
  readonly expectedRoot?: bigint;
}

/**
 * Load CellMapState from a pre-built Tree 2 snapshot file.
 *
 * Reads the JSON snapshot, reconstructs CellDistrictMapping[], rebuilds the
 * SMT via buildCellMapTree(), and returns a CellMapState ready for the API.
 *
 * @param snapshotPath - Path to the tree2-snapshot.json file
 * @param options - Optional verification parameters
 * @returns CellMapState ready for createShadowAtlasAPI()
 * @throws Error if snapshot is missing, invalid, or uses an unsupported version
 */
export async function loadCellMapStateFromSnapshot(
  snapshotPath: string,
  options?: SnapshotLoadOptions,
): Promise<CellMapState> {
  const result = await loadSnapshotWithVintage(snapshotPath, options);
  return result.state;
}

/**
 * Load CellMapState + vintage metadata from a pre-built Tree 2 snapshot file.
 *
 * Version 3+ snapshots include vintage metadata. Version 2 snapshots return
 * vintage as null (backward compatible).
 *
 * @param snapshotPath - Path to the tree2-snapshot.json file
 * @param options - Optional verification parameters (e.g., on-chain root)
 * @returns CellMapState + vintage metadata
 * @throws Error if snapshot is missing, invalid, or uses an unsupported version
 */
export async function loadSnapshotWithVintage(
  snapshotPath: string,
  options?: SnapshotLoadOptions,
): Promise<SnapshotLoadResult> {
  const raw = await readFile(snapshotPath, 'utf-8');
  const snapshot: Tree2Snapshot = JSON.parse(raw);

  if (snapshot.version < 2) {
    throw new Error(
      `Snapshot version ${snapshot.version} does not include mappings. ` +
      'Regenerate with build-tree2.ts (version 2+).'
    );
  }

  if (!snapshot.mappings || snapshot.mappings.length === 0) {
    throw new Error('Snapshot contains no mappings');
  }

  // Reconstruct CellDistrictMapping[] from serialized data
  const mappings: CellDistrictMapping[] = snapshot.mappings.map(m => ({
    cellId: BigInt(m.cellId),
    districts: m.districts.map(d => BigInt(d)),
  }));

  // Rebuild SMT from mappings
  const result = await buildCellMapTree(mappings, snapshot.depth);

  // Verify root matches snapshot (detect corruption)
  const snapshotRoot = BigInt(snapshot.root);
  if (result.root !== snapshotRoot) {
    throw new Error(
      `Snapshot root mismatch: expected ${snapshot.root}, got 0x${result.root.toString(16)}. ` +
      'Snapshot may be corrupted — regenerate with build-tree2.ts.'
    );
  }

  // Verify against external trust anchor (e.g., on-chain CellMapRegistry root)
  if (options?.expectedRoot !== undefined) {
    if (result.root !== options.expectedRoot) {
      throw new Error(
        `On-chain root verification failed: recomputed 0x${result.root.toString(16)}, ` +
        `expected 0x${options.expectedRoot.toString(16)}. ` +
        'Snapshot does not match the on-chain committed root.'
      );
    }
  }

  return {
    state: toCellMapState(result),
    vintage: snapshot.vintage ?? null,
  };
}
