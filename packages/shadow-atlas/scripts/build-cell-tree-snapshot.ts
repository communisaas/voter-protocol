#!/usr/bin/env npx tsx
/**
 * Build Cell Tree Snapshot (Tree 2 — Cell-District Map)
 *
 * Produces a CellTreeSnapshotWire JSON blob for IPFS distribution.
 * Clients deserialize this to compute Tree 2 Merkle paths locally.
 *
 * Usage:
 *   npx tsx scripts/build-cell-tree-snapshot.ts --sample              # 10-cell sample with real Poseidon2
 *   npx tsx scripts/build-cell-tree-snapshot.ts --from mapping.json   # from H3 mapping output
 *
 * Output: cell-tree-snapshot.json (CellTreeSnapshotWire format)
 *
 * Tree structure:
 *   leaf = hashPair(cell_id, poseidon2Sponge(districts[24]))
 *   internal = hashPair(left, right)
 *   empty = zeroHashes[level] (precomputed chain)
 */

import { Poseidon2Hasher } from '@voter-protocol/crypto';

// ============================================================================
// Types
// ============================================================================

interface CellTreeSnapshotWire {
  version: number;
  depth: number;
  root: string;
  zeroHashes: string[];
  layers: Array<Array<[number, string]>>;
  cells: Array<{
    cellId: string;
    leafIndex: number;
    districts: string[];
  }>;
}

interface CellEntry {
  cellId: string;
  cellIdBigInt: bigint;
  districts: bigint[];
  leafIndex: number;
}

// ============================================================================
// Configuration
// ============================================================================

const TREE_DEPTH = 20; // Production depth — 2^20 = 1,048,576 leaf capacity

/**
 * Sample H3 cell IDs (res-7, US locations).
 * These are real H3 indexes for recognizable places.
 */
const SAMPLE_H3_CELLS = [
  '872830828ffffff', // San Francisco, CA
  '87283082affffff', // San Francisco, CA (adjacent)
  '872a1072dffffff', // New York, NY (Manhattan)
  '872a1072bffffff', // New York, NY (Brooklyn)
  '87264e64dffffff', // Washington, DC
  '8726cc6cdffffff', // Chicago, IL
  '8726a20a9ffffff', // Houston, TX
  '87290d049ffffff', // Los Angeles, CA
  '87266e1a3ffffff', // Atlanta, GA
  '8726a5429ffffff', // Denver, CO
];

/**
 * Generate mock district IDs for a cell.
 * 24 slots: cd, sldu, sldl, county, + 20 padding zeros.
 * In production, these come from R-tree district resolution.
 *
 * Encoding: district string → deterministic integer.
 * The circuit treats these as opaque field elements.
 */
function generateSampleDistricts(seed: number): bigint[] {
  const districts: bigint[] = [];
  // 4 real-ish district IDs (cd, sldu, sldl, county)
  for (let i = 0; i < 4; i++) {
    districts.push(BigInt(seed * 10000 + (i + 1) * 100 + 1));
  }
  // 20 padding zeros (unused district slots)
  for (let i = 4; i < 24; i++) {
    districts.push(0n);
  }
  return districts;
}

// ============================================================================
// Core Builder
// ============================================================================

function toHex(value: bigint): string {
  return '0x' + value.toString(16).padStart(64, '0');
}

async function buildSnapshot(
  cells: CellEntry[],
  depth: number,
): Promise<CellTreeSnapshotWire> {
  const hasher = await Poseidon2Hasher.getInstance();

  console.log(`  Initializing Poseidon2 hasher...`);

  // Step 1: Compute zero hashes (empty subtree chain)
  console.log(`  Computing zero hashes for depth ${depth}...`);
  const zeroHashesBigInt: bigint[] = new Array(depth);
  zeroHashesBigInt[0] = 0n; // Empty leaf = 0
  for (let i = 1; i < depth; i++) {
    zeroHashesBigInt[i] = await hasher.hashPair(zeroHashesBigInt[i - 1], zeroHashesBigInt[i - 1]);
  }
  const zeroHashes = zeroHashesBigInt.map(toHex);

  // Step 2: Compute leaf hashes
  console.log(`  Computing ${cells.length} leaf hashes...`);
  const leafLayer = new Map<number, bigint>();

  for (const cell of cells) {
    // district_commitment = poseidon2Sponge(districts[24])
    const districtCommitment = await hasher.poseidon2Sponge(cell.districts);
    // leaf = hashPair(cell_id, district_commitment)
    const leafHash = await hasher.hashPair(cell.cellIdBigInt, districtCommitment);
    leafLayer.set(cell.leafIndex, leafHash);
  }

  // Step 3: Build sparse tree layers bottom-up
  console.log(`  Building sparse tree (${depth} levels)...`);
  const layers: Map<number, bigint>[] = new Array(depth);
  layers[0] = leafLayer;

  for (let level = 0; level < depth - 1; level++) {
    const currentLayer = layers[level];
    const parentLayer = new Map<number, bigint>();

    // Collect all parent indices that need computation
    const parentIndices = new Set<number>();
    for (const idx of currentLayer.keys()) {
      parentIndices.add(idx >> 1);
    }

    for (const parentIdx of parentIndices) {
      const leftIdx = parentIdx * 2;
      const rightIdx = parentIdx * 2 + 1;
      const left = currentLayer.get(leftIdx) ?? zeroHashesBigInt[level];
      const right = currentLayer.get(rightIdx) ?? zeroHashesBigInt[level];

      const parentHash = await hasher.hashPair(left, right);

      // Only store if different from the zero hash at this level
      // (optimization: skip storing nodes that equal the empty subtree)
      if (parentHash !== zeroHashesBigInt[level + 1]) {
        parentLayer.set(parentIdx, parentHash);
      }
    }

    layers[level + 1] = parentLayer;
  }

  // Step 4: Compute root
  // The root is the single node at the top level, or zeroHash[depth-1] if empty
  const topLayer = layers[depth - 1];
  let root: bigint;
  if (topLayer.size === 0) {
    root = zeroHashesBigInt[depth - 1];
  } else if (topLayer.size === 1 && topLayer.has(0)) {
    // The top layer should have exactly one node at index 0
    // But we need one more hash: root = hashPair(topLayer[0], zeroHash[depth-1]) or similar
    // Actually, the top layer IS the second-to-last level. The root is computed from it.
    // Let me reconsider: depth=20 means 20 levels of hashing.
    // layers[0] = leaves, layers[1..19] = internal nodes.
    // root = hashPair(layers[19][0], layers[19][1]) — but we only go up to layers[depth-1] = layers[19].
    // Actually with the loop above going to depth-2, layers[depth-1] has the penultimate level.
    // We need one final hash.
    const leftTop = topLayer.get(0) ?? zeroHashesBigInt[depth - 1];
    const rightTop = topLayer.get(1) ?? zeroHashesBigInt[depth - 1];
    root = await hasher.hashPair(leftTop, rightTop);
  } else {
    // Multiple nodes at top — hash the pair at indices 0,1
    const leftTop = topLayer.get(0) ?? zeroHashesBigInt[depth - 1];
    const rightTop = topLayer.get(1) ?? zeroHashesBigInt[depth - 1];
    root = await hasher.hashPair(leftTop, rightTop);
  }

  // Step 5: Serialize to wire format
  console.log(`  Serializing wire format...`);
  const wireLayers: Array<Array<[number, string]>> = [];
  for (let level = 0; level < depth; level++) {
    const layer = layers[level];
    const entries: Array<[number, string]> = [];
    for (const [idx, hash] of layer.entries()) {
      entries.push([idx, toHex(hash)]);
    }
    // Sort by index for deterministic output + efficient binary search on client
    entries.sort((a, b) => a[0] - b[0]);
    wireLayers.push(entries);
  }

  const wireCells = cells.map(cell => ({
    cellId: cell.cellId,
    leafIndex: cell.leafIndex,
    districts: cell.districts.map(toHex),
  }));
  wireCells.sort((a, b) => a.leafIndex - b.leafIndex);

  const snapshot: CellTreeSnapshotWire = {
    version: 1,
    depth,
    root: toHex(root),
    zeroHashes,
    layers: wireLayers,
    cells: wireCells,
  };

  // Stats
  let totalNodes = 0;
  for (const layer of wireLayers) totalNodes += layer.length;
  console.log(`  Tree stats: ${cells.length} cells, ${totalNodes} non-zero nodes, root=${toHex(root).slice(0, 18)}...`);

  return snapshot;
}

// ============================================================================
// Sample Mode
// ============================================================================

function buildSampleCells(): CellEntry[] {
  return SAMPLE_H3_CELLS.map((h3Id, index) => ({
    cellId: h3Id,
    cellIdBigInt: BigInt('0x' + h3Id),
    districts: generateSampleDistricts(index + 1),
    leafIndex: index, // Sequential for sample
  }));
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const isSample = args.includes('--sample');
  const fromIndex = args.indexOf('--from');
  const outputIndex = args.indexOf('--output');
  const outputPath = outputIndex !== -1 ? args[outputIndex + 1] : 'cell-tree-snapshot.json';

  if (!isSample && fromIndex === -1) {
    console.error('Usage:');
    console.error('  npx tsx scripts/build-cell-tree-snapshot.ts --sample [--output path.json]');
    console.error('  npx tsx scripts/build-cell-tree-snapshot.ts --from mapping.json [--output path.json]');
    process.exit(1);
  }

  let cells: CellEntry[];

  if (isSample) {
    console.log('Building SAMPLE cell tree snapshot (10 cells, real Poseidon2)...');
    cells = buildSampleCells();
  } else {
    const mappingPath = args[fromIndex + 1];
    console.log(`Building cell tree snapshot from ${mappingPath}...`);

    const fs = await import('fs');
    const rawMapping = JSON.parse(fs.readFileSync(mappingPath, 'utf-8'));

    // H3 mapping format: { mapping: { h3Index: { cd, sldu, sldl, county } }, metadata: {...} }
    const mapping: Record<string, { cd?: string; sldu?: string; sldl?: string; county?: string }> =
      rawMapping.mapping ?? rawMapping;

    const h3Ids = Object.keys(mapping);
    console.log(`  Found ${h3Ids.length} cells in mapping`);

    cells = h3Ids.map((h3Id, index) => {
      const entry = mapping[h3Id];
      // Encode district strings as small deterministic integers
      // In production, these would be hashString() outputs — but for now,
      // we use a simple encoding since the circuit treats them as opaque.
      const districts: bigint[] = [];
      const districtStrings = [entry.cd, entry.sldu, entry.sldl, entry.county];
      for (const ds of districtStrings) {
        districts.push(ds ? BigInt(Buffer.from(ds).reduce((acc, b) => acc * 256n + BigInt(b), 0n)) : 0n);
      }
      // Pad to 24 slots
      while (districts.length < 24) {
        districts.push(0n);
      }

      return {
        cellId: h3Id,
        cellIdBigInt: BigInt('0x' + h3Id),
        districts,
        leafIndex: index,
      };
    });
  }

  const snapshot = await buildSnapshot(cells, TREE_DEPTH);

  const fs = await import('fs');
  const json = JSON.stringify(snapshot, null, 2);
  fs.writeFileSync(outputPath, json);
  console.log(`\nSnapshot written to ${outputPath} (${(json.length / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
