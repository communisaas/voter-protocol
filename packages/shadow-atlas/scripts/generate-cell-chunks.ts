#!/usr/bin/env npx tsx
/**
 * Generate Cell Chunks from Existing Tree 2 Snapshot
 *
 * Rebuilds the SMT from a tree2-snapshot.json and generates cell chunk files
 * (districts + SMT proofs) for IPFS distribution.
 *
 * This avoids re-downloading Census BAF data — it reads the mappings from
 * an existing snapshot and rebuilds just the tree + proof chunks.
 *
 * Usage:
 *   npx tsx scripts/generate-cell-chunks.ts
 *   npx tsx scripts/generate-cell-chunks.ts --snapshot data/tree2-snapshot.json --output output
 *
 * After running:
 *   npx tsx scripts/pin-to-ipfs.ts --directory output
 *   npx tsx scripts/push-cids.ts
 */

import { readFile } from 'node:fs/promises';
import { buildCellMapTree, type CellDistrictMapping } from '../src/tree-builder.js';
import { buildCellChunks, buildCellChunksManifestEntry, buildDistrictIndex } from '../src/distribution/build-cell-chunks.js';
import { latLngToCell, cellToParent } from 'h3-js';
import { buildTractCentroidIndex } from '../src/hydration/tract-centroid-index.js';
import { atomicWriteFile } from '../src/core/utils/atomic-write.js';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// ============================================================================
// CLI
// ============================================================================

const args = process.argv.slice(2);
let snapshotPath = 'data/tree2-snapshot.json';
let outputDir = 'output';
let cacheDir = 'data/baf-cache';

for (let i = 0; i < args.length; i++) {
	switch (args[i]) {
		case '--snapshot': snapshotPath = args[++i]; break;
		case '--output': outputDir = args[++i]; break;
		case '--cache-dir': cacheDir = args[++i]; break;
		case '--help':
			console.log(`
Usage: generate-cell-chunks.ts [options]

Options:
  --snapshot <path>   Input tree2-snapshot.json (default: data/tree2-snapshot.json)
  --output <path>     Output directory (default: output)
  --cache-dir <path>  Cache dir for TIGER downloads (default: data/baf-cache)
  --help              Show this help
`);
			process.exit(0);
	}
}

// ============================================================================
// Main
// ============================================================================

async function main() {
	const startTime = Date.now();

	console.log('=== Cell Chunk Generator ===');
	console.log(`Snapshot: ${snapshotPath}`);
	console.log(`Output:   ${outputDir}`);
	console.log();

	// Step 1: Load snapshot (supports both formats)
	console.log('[1/4] Loading snapshot...');
	const raw = await readFile(snapshotPath, 'utf-8');
	const snapshot = JSON.parse(raw);

	let mappings: CellDistrictMapping[];

	if (snapshot.mappings) {
		// Format A: build-tree2.ts v3 output — { mappings: [{ cellId: "6001400100", districts: ["613", ...] }] }
		mappings = snapshot.mappings.map((m: { cellId: string; districts: string[] }) => ({
			cellId: BigInt(m.cellId),
			districts: m.districts.map((d: string) => BigInt(d)),
		}));
		console.log(`  → Format: build-tree2 v${snapshot.version}`);
	} else if (snapshot.cells) {
		// Format B: build-cell-tree-snapshot.ts output
		// cellId may be: "0x..." (hex field element), "872756711ffffff" (H3 hex), or decimal string
		// districts are always "0x..." hex field elements
		const parseCellId = (id: string): bigint => {
			if (id.startsWith('0x') || id.startsWith('0X')) return BigInt(id);
			if (/^[0-9a-f]+$/i.test(id)) return BigInt('0x' + id); // H3 hex index
			return BigInt(id); // decimal string
		};
		mappings = snapshot.cells.map((c: { cellId: string; districts: string[] }) => ({
			cellId: parseCellId(c.cellId),
			districts: c.districts.map((d: string) => BigInt(d)),
		}));
		console.log(`  → Format: cell-tree-snapshot v${snapshot.version}`);
	} else {
		throw new Error('Unrecognized snapshot format: expected "mappings" or "cells" array');
	}

	console.log(`  → ${mappings.length.toLocaleString()} cells, depth ${snapshot.depth}`);
	console.log(`  → State filter: ${snapshot.stateFilter ?? 'ALL'}`);
	console.log();

	// Step 2: Rebuild SMT
	console.log('[2/4] Building Sparse Merkle Tree...');
	const treeResult = await buildCellMapTree(mappings, snapshot.depth);
	console.log(`  → Root: 0x${treeResult.root.toString(16).slice(0, 16)}...`);
	console.log(`  → Cells: ${treeResult.cellCount.toLocaleString()}`);
	console.log();

	// Step 3: Build centroid index for H3 grouping
	console.log('[3/4] Building tract centroid index for H3 grouping...');

	// Extract state FIPS codes from real tract GEOIDs.
	// BigInt drops leading zeros: "06001400100" → 6001400100 → "6001400100" (10 chars).
	// Real tract GEOIDs are 11 chars with leading zero (FIPS 01-56), or 10 chars for
	// states 01-09 (where BigInt drops the leading zero).
	// Virtual cell IDs (hash-derived, 30+ chars) are skipped.
	const stateFips = [...new Set(
		mappings
			.map(m => m.cellId.toString())
			.filter(g => g.length <= 12) // Real tract GEOIDs only (10-11 chars)
			.map(g => g.padStart(11, '0').slice(0, 2)) // Restore leading zero, take state FIPS
	)];
	console.log(`  → States: ${stateFips.join(', ')}`);

	const centroidIndex = await buildTractCentroidIndex(stateFips, {
		cacheDir,
		log: (msg) => console.log(`    ${msg}`),
	});
	console.log(`  → ${centroidIndex.size.toLocaleString()} tract centroids indexed`);

	// Build GEOID → H3 mapping (for grouping, not for chunk keys)
	const geoidToH3Cache = new Map<string, string>();
	let hits = 0;
	let misses = 0;

	/** Resolve a real tract GEOID to its H3 res-7 cell. Returns undefined if no centroid. */
	const resolveRealH3 = (geoid: string): string | undefined => {
		const paddedGeoid = geoid.length <= 11 ? geoid.padStart(11, '0') : geoid;

		const centroid = centroidIndex.getCentroid(paddedGeoid);
		if (centroid) {
			return latLngToCell(centroid[1], centroid[0], 7);
		}

		// Also try unpadded (in case centroid index uses raw geoid)
		if (paddedGeoid !== geoid) {
			const c2 = centroidIndex.getCentroid(geoid);
			if (c2) {
				return latLngToCell(c2[1], c2[0], 7);
			}
		}

		return undefined;
	};

	// First pass: build district → H3 res-3 parent mapping from real cells.
	// Virtual cells will be assigned to the same H3 group as real cells in their district.
	const districtToH3Parent = new Map<string, string>();
	for (const m of mappings) {
		const geoid = m.cellId.toString();
		if (geoid.length > 12) continue; // skip virtual cells

		const h3 = resolveRealH3(geoid);
		if (!h3) continue;

		const parent = cellToParent(h3, 3);
		const districtKey = m.districts[0].toString(); // congressional district (slot 0)
		if (!districtToH3Parent.has(districtKey)) {
			districtToH3Parent.set(districtKey, parent);
		}
	}
	console.log(`  → ${districtToH3Parent.size} congressional districts mapped to H3 groups`);

	/** Get H3 res-3 parent for grouping. Works for both real and virtual cells. */
	const getH3Parent = (cellId: bigint, mapping: CellDistrictMapping): string => {
		const geoid = cellId.toString();
		const cached = geoidToH3Cache.get(geoid);
		if (cached) return cached;

		// Real cells: resolve via centroid
		if (geoid.length <= 12) {
			const h3 = resolveRealH3(geoid);
			if (h3) {
				const parent = cellToParent(h3, 3);
				geoidToH3Cache.set(geoid, parent);
				hits++;
				return parent;
			}
			misses++;
			// Fallback: try district mapping
			const districtKey = mapping.districts[0].toString();
			const fallback = districtToH3Parent.get(districtKey) ?? `geoid-${geoid.padStart(11, '0').slice(0, 5)}`;
			geoidToH3Cache.set(geoid, fallback);
			return fallback;
		}

		// Virtual cells: map to the same H3 group as a real cell in the same congressional district
		const districtKey = mapping.districts[0].toString();
		const parent = districtToH3Parent.get(districtKey);
		if (parent) {
			geoidToH3Cache.set(geoid, parent);
			hits++;
			return parent;
		}

		misses++;
		const fallback = `virtual-${districtKey}`;
		geoidToH3Cache.set(geoid, fallback);
		return fallback;
	};

	console.log();

	// Step 4: Generate cell chunks
	// Key insight: cellIdToKey must be UNIQUE per cell (use cellId string),
	// while groupFn determines which chunk file a cell lands in (H3 res-3 parent).
	// Previous bug: cellIdToKey returned H3 res-7 which collided for multiple tracts.
	console.log('[4/4] Generating cell chunks...');

	// Build a mapping lookup for the groupFn (needs access to districts for virtual cells)
	const cellIdToMapping = new Map<string, CellDistrictMapping>();
	for (const m of mappings) {
		cellIdToMapping.set(m.cellId.toString(), m);
	}

	const result = await buildCellChunks(treeResult, mappings, {
		country: 'US',
		groupFn: (cellId) => {
			const mapping = cellIdToMapping.get(cellId.toString())!;
			return getH3Parent(cellId, mapping);
		},
		cellIdToKey: (cellId) => cellId.toString(),
		h3Fn: (cellId) => {
			// Only real tract cells get an H3 index entry (virtual cells have no centroid)
			const geoid = cellId.toString();
			if (geoid.length > 12) return undefined;
			return resolveRealH3(geoid);
		},
		outputDir,
		log: console.log,
	});

	console.log(`  → Centroid hits: ${hits.toLocaleString()}, misses: ${misses.toLocaleString()}`);
	console.log(`  → ${result.totalChunks.toLocaleString()} chunks, ${result.totalCells.toLocaleString()} cells`);
	console.log(`  → ${(result.durationMs / 1000).toFixed(1)}s`);

	// Write manifest entry
	const manifestEntry = buildCellChunksManifestEntry(result, treeResult, 'US');
	const manifestPath = `${outputDir}/US/manifest-cells.json`;
	await mkdir(dirname(manifestPath), { recursive: true });
	await atomicWriteFile(manifestPath, JSON.stringify(manifestEntry, null, 2) + '\n');
	console.log(`  → Manifest: ${manifestPath}`);

	// Update main manifest if it exists
	const mainManifestPath = `${outputDir}/US/manifest.json`;
	try {
		const existing = JSON.parse(await readFile(mainManifestPath, 'utf-8'));
		existing.cells = manifestEntry;
		await atomicWriteFile(mainManifestPath, JSON.stringify(existing, null, 2) + '\n');
		console.log(`  → Updated main manifest with cells section`);
	} catch {
		console.log(`  → No main manifest found at ${mainManifestPath} (cells-only manifest written)`);
	}

	// Step 5: Build district index (O(1) lookups by district for all 24 slots)
	console.log();
	console.log('[5/5] Building district index...');
	const districtIndex = buildDistrictIndex(result, mappings);
	const populatedSlots = Object.keys(districtIndex.slots).length;
	const totalDistricts = Object.values(districtIndex.slots)
		.reduce((sum, s) => sum + Object.keys(s).length, 0);
	console.log(`  → ${populatedSlots} populated slots, ${totalDistricts} unique district values`);
	console.log(`  → ${Object.keys(districtIndex.labels).length} field element labels`);

	const indexPath = `${outputDir}/US/district-index.json`;
	await atomicWriteFile(indexPath, JSON.stringify(districtIndex) + '\n');
	console.log(`  → Written to ${indexPath}`);

	const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
	console.log(`\nDone in ${elapsed}s.`);
}

main().catch(err => {
	console.error('Fatal:', err);
	process.exit(1);
});
