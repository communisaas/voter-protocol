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

	// Step 1: Load snapshot
	console.log('[1/4] Loading snapshot...');
	const raw = await readFile(snapshotPath, 'utf-8');
	const snapshot = JSON.parse(raw);

	const mappings: CellDistrictMapping[] = snapshot.mappings.map((m: { cellId: string; districts: string[] }) => ({
		cellId: BigInt(m.cellId),
		districts: m.districts.map((d: string) => BigInt(d)),
	}));

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

	// Build GEOID → H3 mapping
	const geoidToH3Cache = new Map<string, string>();
	let hits = 0;
	let misses = 0;

	const getH3 = (geoid: string): string => {
		const cached = geoidToH3Cache.get(geoid);
		if (cached) return cached;

		// BigInt drops leading zeros. Restore to 11-char FIPS for centroid lookup.
		const paddedGeoid = geoid.length <= 11 ? geoid.padStart(11, '0') : geoid;

		const centroid = centroidIndex.getCentroid(paddedGeoid);
		if (centroid) {
			const h3 = latLngToCell(centroid[1], centroid[0], 7);
			geoidToH3Cache.set(geoid, h3);
			hits++;
			return h3;
		}

		// Also try unpadded (in case centroid index uses raw geoid)
		if (paddedGeoid !== geoid) {
			const c2 = centroidIndex.getCentroid(geoid);
			if (c2) {
				const h3 = latLngToCell(c2[1], c2[0], 7);
				geoidToH3Cache.set(geoid, h3);
				hits++;
				return h3;
			}
		}

		// Virtual cells (hash-derived, 30+ chars): try parent tract GEOID
		if (geoid.length > 12) {
			// Virtual cells don't have a simple GEOID prefix. Fall back.
			misses++;
			const fallback = `virtual-${(BigInt(geoid) % 1000n).toString()}`;
			geoidToH3Cache.set(geoid, fallback);
			return fallback;
		}

		misses++;
		const fallback = `geoid-${paddedGeoid.slice(0, 5)}`;
		geoidToH3Cache.set(geoid, fallback);
		return fallback;
	};

	console.log();

	// Step 4: Generate cell chunks
	console.log('[4/4] Generating cell chunks...');
	const result = await buildCellChunks(treeResult, mappings, {
		country: 'US',
		groupFn: (cellId) => {
			const h3 = getH3(cellId.toString());
			// Non-H3 fallback keys (virtual cells, missing centroids) group as-is
			if (h3.startsWith('geoid-') || h3.startsWith('virtual-')) return h3;
			return cellToParent(h3, 3);
		},
		cellIdToKey: (cellId) => getH3(cellId.toString()),
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
