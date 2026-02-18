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
import { buildCellMapTree, toCellMapState, type CellDistrictMapping } from '../dual-tree-builder.js';
import type { CellMapState } from '../serving/registration-service.js';

/** Shape of the snapshot JSON file (version 2) */
interface Tree2Snapshot {
  readonly version: number;
  readonly root: string;
  readonly depth: number;
  readonly cellCount: number;
  readonly mappings: ReadonlyArray<{
    readonly cellId: string;
    readonly districts: readonly string[];
  }>;
}

/**
 * Load CellMapState from a pre-built Tree 2 snapshot file.
 *
 * Reads the JSON snapshot, reconstructs CellDistrictMapping[], rebuilds the
 * SMT via buildCellMapTree(), and returns a CellMapState ready for the API.
 *
 * @param snapshotPath - Path to the tree2-snapshot.json file
 * @returns CellMapState ready for createShadowAtlasAPI()
 * @throws Error if snapshot is missing, invalid, or uses an unsupported version
 */
export async function loadCellMapStateFromSnapshot(
  snapshotPath: string,
): Promise<CellMapState> {
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
  const expectedRoot = BigInt(snapshot.root);
  if (result.root !== expectedRoot) {
    throw new Error(
      `Snapshot root mismatch: expected ${snapshot.root}, got 0x${result.root.toString(16)}. ` +
      'Snapshot may be corrupted — regenerate with build-tree2.ts.'
    );
  }

  return toCellMapState(result);
}
