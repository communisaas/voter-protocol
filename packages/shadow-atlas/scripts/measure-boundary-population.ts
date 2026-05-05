#!/usr/bin/env tsx
/**
 * Measure H3-cell boundary populations per congressional-district pair.
 *
 * Answers the spec question: "how many users does the H3 sliver problem
 * affect at T0, by boundary pair?" (CONSTITUENCY-PROOF-SEMANTICS.md §4 G3).
 *
 * Methodology:
 *   1. For each state, read TIGER BAF (BLOCK → CD) from data/baf-cache.
 *   2. Look up each block's parent tract centroid via TractCentroidIndex.
 *   3. Map centroid → H3 res-7 cell (matches build-tree2.ts:315 convention).
 *   4. Group blocks by H3 cell. For each cell, collect the set of distinct
 *      CDs that any of its blocks are assigned to.
 *   5. Cells where |distinct CDs| >= 2 are "boundary cells" — multiple
 *      districts' blocks share a single H3 hex.
 *   6. Per-boundary-pair (CD_A, CD_B) aggregate: count of cells AND count
 *      of blocks that fall in the boundary set for that pair.
 *
 * Output: source/v{tag}/us/cd-boundary-population.json with per-pair
 * aggregates + ACS/TIGER vintage metadata + k-anonymity floor (pairs with
 * <K_ANONYMITY_FLOOR blocks roll up into a "minor" bucket so a single
 * boundary segment can't be narrowed via the published metric).
 *
 * Limitations (documented in output):
 *   - Block-COUNT, not population. ACS population per block requires a
 *     separate ~5 GB Census download; deferred to Phase 2.
 *   - Block-to-tract centroid: blocks within the same tract collapse to
 *     one H3 cell. Variance is small for 100m H3 cells (≈5 km²) since
 *     tracts average a few km², but at the H3 boundary the approximation
 *     bleeds. Real fix is per-block centroids from TIGER tabblock — also
 *     Phase 2.
 *   - Tract centroid coverage is incomplete for some states (split tracts,
 *     virtual cells); blocks falling into the GEOID-prefix fallback are
 *     counted in a separate "fallback" bucket so the operator can size
 *     the gap.
 *
 * The output IS audit-ready for the question "where are H3 sliver
 * problems concentrated?" — it's not perfect, but it's the first concrete
 * answer this codebase has had.
 *
 * Usage:
 *   tsx scripts/measure-boundary-population.ts [options]
 *
 * Options:
 *   --version v{YYYYMMDD}    Version tag for output filename (default: today)
 *   --state <FIPS>           Restrict to one state (e.g. 06 for CA). Default: all.
 *   --baf-cache <path>       BAF directory (default: ./data/baf-cache)
 *   --centroid-cache <path>  Tract centroid cache (default: ./data/baf-cache)
 *   --output <path>          Output JSON path (default: ./output/cd-boundary-population.json)
 *
 * Exit codes:
 *   0  success
 *   1  argument or env error
 *   2  no BAF data found
 *   3  centroid-index build failure
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const VERSION_PATTERN = /^v\d{8}$/;
const H3_RESOLUTION = 7;

/**
 * k-anonymity floor: per-pair aggregates with fewer than K blocks roll up
 * into a "minor" bucket. A single sliver of 3 city blocks containing a
 * known boundary segment is too narrow to publish. K=10 is a defensible
 * floor for block-count aggregates; reconsider when ACS population lands.
 *
 * Limitation noted in G3r: K=10 in dense urban areas (1 city block ≈ 1
 * intersection) has different privacy semantics than K=10 in rural areas
 * (1 block ≈ a single ranch). Scaling K with population density is the
 * right move, but ACS data is deferred — without it, the scaling rule
 * itself would be wrong. Documented in output.limitations.
 */
const K_ANONYMITY_FLOOR = 10;

/**
 * Fallback threshold: if more than this fraction of input blocks fall
 * through to the no-centroid bucket, the output is presumptively garbage.
 * The CT 2022 county dissolution caused 100% fallback for that state;
 * the script must fail loud rather than report "0 boundary blocks" for
 * an entire state with structural data drift.
 */
const FALLBACK_HARD_FAIL_RATIO = 0.01;

/**
 * Expected TIGER vintage. Pinned so an out-of-cycle Census release
 * (e.g., post-redistricting refresh) doesn't silently produce
 * topologically-mismatched joins between BAF and tract shapefiles.
 * Update only when the build pipeline's TIGER source updates.
 */
const EXPECTED_TIGER_VINTAGE = 'TIGER2024';

interface ParsedArgs {
	version: string;
	state: string | null;
	bafCache: string;
	centroidCache: string;
	output: string;
}

function parseArgs(argv: string[]): ParsedArgs {
	const out: Partial<ParsedArgs> = {
		bafCache: './data/baf-cache',
		centroidCache: './data/baf-cache',
		output: './output/cd-boundary-population.json',
		state: null,
	};
	const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
	out.version = `v${today}`;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const next = argv[i + 1];
		switch (arg) {
			case '--version':
				out.version = next;
				i++;
				break;
			case '--state':
				out.state = next;
				i++;
				break;
			case '--baf-cache':
				out.bafCache = next;
				i++;
				break;
			case '--centroid-cache':
				out.centroidCache = next;
				i++;
				break;
			case '--output':
				out.output = next;
				i++;
				break;
			case '--help':
			case '-h':
				printHelp();
				process.exit(0);
			default:
				if (arg.startsWith('--')) {
					console.error(`Unknown arg: ${arg}`);
					process.exit(1);
				}
		}
	}

	if (!out.version || !VERSION_PATTERN.test(out.version)) {
		console.error('--version must be v{YYYYMMDD}');
		process.exit(1);
	}
	if (out.state && !/^\d{2}$/.test(out.state)) {
		console.error('--state must be 2-digit FIPS');
		process.exit(1);
	}
	return out as ParsedArgs;
}

function printHelp(): void {
	console.log(`
measure-boundary-population — count blocks in H3 cells that span ≥2 CDs

Inputs:
  TIGER BAF (BLOCK → CD)         from data/baf-cache/{stateFips}/BlockAssign_ST*_CD.txt
  Tract centroids (GEOID → lat/lng) computed via build-tree2's index

Output (per pair):
  {
    pair: ["CA-12", "CA-13"],          // sorted lexically for deduplication
    boundaryCells: <count of H3 cells where the pair co-occurred>,
    blocks: <total blocks in those cells assigned to either district>
  }

Pairs with <${K_ANONYMITY_FLOOR} blocks roll up into a "minor" bucket.
`);
}

interface BlockAssignment {
	blockId: string;
	cd: string; // 2-digit district number; combine with stateFips for full code
	stateFips: string;
}

/**
 * Read BAF for one state. Format (header + pipe-delimited):
 *   BLOCKID|DISTRICT
 *   060014001001000|13
 *
 * BLOCKID is 15 digits: 2 (state) + 3 (county) + 6 (tract) + 4 (block).
 * DISTRICT is the CD number (1-53 for CA, etc.) — "00" for at-large
 * single-district states, "98" for non-voting delegates.
 */
function readBafForState(bafCache: string, stateFips: string): BlockAssignment[] {
	const stateDir = join(bafCache, stateFips);
	if (!existsSync(stateDir)) return [];

	const cdFile = readdirSync(stateDir).find((f) => f.endsWith('_CD.txt'));
	if (!cdFile) return [];

	const path = join(stateDir, cdFile);
	const lines = readFileSync(path, 'utf8').split('\n');
	const out: BlockAssignment[] = [];
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line) continue;
		const [blockId, district] = line.split('|');
		if (!blockId || !district) continue;
		out.push({ blockId, cd: district.padStart(2, '0'), stateFips });
	}
	return out;
}

/**
 * Format a (stateFips, cd) pair as the display code "CA-12" / "VT-AL".
 * Reuses the same FIPS_TO_STATE table as the commons district-format helper.
 */
const FIPS_TO_STATE: Record<string, string> = {
	'01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA',
	'08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL',
	'13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN',
	'19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME',
	'24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS',
	'29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
	'34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
	'39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
	'45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
	'50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI',
	'56': 'WY', '60': 'AS', '66': 'GU', '69': 'MP', '72': 'PR',
	'78': 'VI',
};

export function displayCode(stateFips: string, cd: string): string {
	const state = FIPS_TO_STATE[stateFips] ?? stateFips;
	const district = cd === '00' || cd === '98' ? 'AL' : cd;
	return `${state}-${district}`;
}

/** Sort a pair lexicographically so (A, B) and (B, A) collapse to one key. */
export function pairKey(a: string, b: string): string {
	return a < b ? `${a}|${b}` : `${b}|${a}`;
}

interface BoundaryPair {
	pair: [string, string];
	boundaryCells: number;
	blocks: number;
}

interface DistrictAggregate {
	district: string; // "CA-12"
	totalBlocks: number; // all blocks assigned to this district
	boundaryBlocks: number; // blocks in cells that span ≥2 CDs
	boundaryFraction: number; // boundaryBlocks / totalBlocks (rounded to 4 decimals)
}

interface OutputArtifact {
	schemaVersion: 1;
	version: string;
	generatedAt: string;
	tigerVintage: string;
	methodology: string;
	limitations: string[];
	totals: {
		statesProcessed: number;
		statesWithFallbackFailures: string[]; // FIPS codes that exceeded FALLBACK_HARD_FAIL_RATIO
		blocksTotal: number;
		blocksMappedToCells: number;
		blocksFallbackBucket: number;
		blocksFallbackRatio: number;
		boundaryCellsTotal: number;
		boundaryBlocksTotal: number;
		uniqueBoundaryPairs: number;
	};
	kAnonymityFloor: number;
	/**
	 * Per-district aggregate (less narrowing than per-pair). Audit reports
	 * that just need "where is the H3 sliver problem concentrated?" can read
	 * this; the per-pair detail below is for finer methodology investigation.
	 */
	districts: DistrictAggregate[];
	pairs: BoundaryPair[];
	minorPairsAggregate: { pairs: number; blocks: number };
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const bafCache = resolve(args.bafCache);
	const centroidCache = resolve(args.centroidCache);

	if (!existsSync(bafCache)) {
		console.error(`BAF cache not found: ${bafCache}`);
		console.error('Populate via the existing build-tree2 pipeline or extract-vtd path.');
		process.exit(2);
	}

	const stateFipsList = args.state
		? [args.state]
		: readdirSync(bafCache).filter((d) => /^\d{2}$/.test(d)).sort();
	if (stateFipsList.length === 0) {
		console.error(`No state directories under ${bafCache}`);
		process.exit(2);
	}

	console.log(`Reading BAF for ${stateFipsList.length} state(s)...`);

	// Lazy-import h3 + centroid index — heavy modules.
	const { latLngToCell } = await import('h3-js');
	const { buildTractCentroidIndex } = await import('../src/hydration/tract-centroid-index.js');

	console.log(`Building tract centroid index for ${stateFipsList.length} state(s)...`);
	let centroidIndex: Awaited<ReturnType<typeof buildTractCentroidIndex>>;
	try {
		centroidIndex = await buildTractCentroidIndex(stateFipsList, {
			cacheDir: centroidCache,
			log: (msg) => console.log(`  ${msg}`),
		});
	} catch (err) {
		console.error(`Centroid index build failed: ${err instanceof Error ? err.message : err}`);
		process.exit(3);
	}
	console.log(`  centroid index: ${centroidIndex.size} tracts`);

	// cellId → set of (stateFips, cd) pairs that have blocks in this cell
	const cellToDistricts = new Map<string, Set<string>>();
	// districtCode ("CA-12") → total blocks assigned + boundary blocks
	const districtBlockTotals = new Map<string, number>();
	let totalBlocks = 0;
	let mappedBlocks = 0;
	let fallbackBlocks = 0;
	const statesWithFallbackFailures: string[] = [];

	for (const stateFips of stateFipsList) {
		const blocks = readBafForState(bafCache, stateFips);
		if (blocks.length === 0) {
			console.warn(`  ${stateFips}: no BAF data`);
			continue;
		}
		totalBlocks += blocks.length;
		let stateMapped = 0;
		let stateFallback = 0;

		for (const b of blocks) {
			const tractGeoid = b.blockId.slice(0, 11); // state(2) + county(3) + tract(6)
			const centroid = centroidIndex.getCentroid(tractGeoid);
			const districtCode = displayCode(b.stateFips, b.cd);
			districtBlockTotals.set(districtCode, (districtBlockTotals.get(districtCode) ?? 0) + 1);
			if (!centroid) {
				stateFallback++;
				fallbackBlocks++;
				continue;
			}
			const h3Cell = latLngToCell(centroid[1], centroid[0], H3_RESOLUTION);
			const districtKey = `${b.stateFips}|${b.cd}`;
			let set = cellToDistricts.get(h3Cell);
			if (!set) {
				set = new Set();
				cellToDistricts.set(h3Cell, set);
			}
			set.add(districtKey);
			stateMapped++;
			mappedBlocks++;
		}

		// Per-state fallback hard-fail. Catches CT-style BAF/TIGER vintage
		// drift before it pollutes the published metric. We collect failures
		// rather than fail-fast so the operator sees ALL affected states in
		// one run, not one-state-at-a-time.
		const stateFallbackRatio = stateFallback / blocks.length;
		if (stateFallbackRatio > FALLBACK_HARD_FAIL_RATIO) {
			statesWithFallbackFailures.push(stateFips);
			console.error(
				`  ${stateFips}: ${blocks.length} blocks, ` +
					`${(stateFallbackRatio * 100).toFixed(1)}% FALLBACK ` +
					`(threshold: ${(FALLBACK_HARD_FAIL_RATIO * 100).toFixed(1)}%) ` +
					'— BAF/TIGER vintage mismatch likely',
			);
		} else {
			console.log(`  ${stateFips}: ${blocks.length} blocks (mapped ${stateMapped}, fallback ${stateFallback})`);
		}
	}

	console.log(`\nTotal blocks: ${totalBlocks} (mapped ${mappedBlocks}, fallback ${fallbackBlocks})`);

	// Hard-fail if any state exceeded the fallback threshold. Don't write
	// a partial-data artifact under the same filename — the operator must
	// reconcile the data before re-running.
	if (statesWithFallbackFailures.length > 0) {
		console.error(
			`\nFATAL: ${statesWithFallbackFailures.length} state(s) exceeded fallback threshold: ${statesWithFallbackFailures.join(', ')}`,
		);
		console.error(
			'BAF (block→district) and TIGER tract centroid vintages must agree. ' +
				'Connecticut 2022 county dissolution is a known case (BAF: old county FIPS, ' +
				'TIGER: new planning region FIPS). Reconcile sources or exclude affected states.',
		);
		process.exit(2);
	}

	// Identify boundary cells, aggregate per pair.
	const pairAggregates = new Map<string, { pair: [string, string]; cells: number; blocks: number }>();
	let boundaryCellsTotal = 0;
	let boundaryBlocksTotal = 0;

	for (const [, districts] of cellToDistricts) {
		if (districts.size < 2) continue;
		boundaryCellsTotal++;

		const codes = [...districts].map((dk) => {
			const [fips, cd] = dk.split('|');
			return displayCode(fips, cd);
		}).sort();

		// All pair combinations within this cell.
		for (let i = 0; i < codes.length; i++) {
			for (let j = i + 1; j < codes.length; j++) {
				const key = pairKey(codes[i], codes[j]);
				let agg = pairAggregates.get(key);
				if (!agg) {
					agg = { pair: [codes[i], codes[j]], cells: 0, blocks: 0 };
					pairAggregates.set(key, agg);
				}
				agg.cells++;
			}
		}
		// Block count: every block in this cell contributes to every pair
		// the cell touches. We count once per cell visit; the per-pair block
		// count is "blocks in cells where this pair co-occurs."
	}

	// Re-walk to count blocks per pair (couldn't do it in the first pass
	// without tracking which blocks fall in which cell).
	const cellBlocks = new Map<string, number>();
	for (const stateFips of stateFipsList) {
		const blocks = readBafForState(bafCache, stateFips);
		for (const b of blocks) {
			const tractGeoid = b.blockId.slice(0, 11);
			const centroid = centroidIndex.getCentroid(tractGeoid);
			if (!centroid) continue;
			const h3Cell = latLngToCell(centroid[1], centroid[0], H3_RESOLUTION);
			cellBlocks.set(h3Cell, (cellBlocks.get(h3Cell) ?? 0) + 1);
		}
	}
	for (const [cellId, districts] of cellToDistricts) {
		if (districts.size < 2) continue;
		const blockCount = cellBlocks.get(cellId) ?? 0;
		boundaryBlocksTotal += blockCount;
		const codes = [...districts].map((dk) => {
			const [fips, cd] = dk.split('|');
			return displayCode(fips, cd);
		}).sort();
		for (let i = 0; i < codes.length; i++) {
			for (let j = i + 1; j < codes.length; j++) {
				const agg = pairAggregates.get(pairKey(codes[i], codes[j]));
				if (agg) agg.blocks += blockCount;
			}
		}
	}

	// k-anonymity: pairs below the floor roll up.
	const publishedPairs: BoundaryPair[] = [];
	const minorAgg = { pairs: 0, blocks: 0 };
	for (const agg of pairAggregates.values()) {
		if (agg.blocks < K_ANONYMITY_FLOOR) {
			minorAgg.pairs++;
			minorAgg.blocks += agg.blocks;
		} else {
			publishedPairs.push({ pair: agg.pair, boundaryCells: agg.cells, blocks: agg.blocks });
		}
	}
	publishedPairs.sort((a, b) => b.blocks - a.blocks);

	// Per-district aggregate. boundaryBlocks for a district = sum of blocks
	// in cells where this district co-occurred with any other district. To
	// compute, we re-walk the boundary cells; each block in such a cell is
	// counted once for the district it's actually assigned to (NOT once per
	// pair, which would over-count for cells with ≥3 districts).
	const districtBoundaryBlocks = new Map<string, number>();
	for (const stateFips of stateFipsList) {
		const blocks = readBafForState(bafCache, stateFips);
		for (const b of blocks) {
			const tractGeoid = b.blockId.slice(0, 11);
			const centroid = centroidIndex.getCentroid(tractGeoid);
			if (!centroid) continue;
			const h3Cell = latLngToCell(centroid[1], centroid[0], H3_RESOLUTION);
			const districts = cellToDistricts.get(h3Cell);
			if (!districts || districts.size < 2) continue;
			const code = displayCode(b.stateFips, b.cd);
			districtBoundaryBlocks.set(code, (districtBoundaryBlocks.get(code) ?? 0) + 1);
		}
	}
	const districtAggregates: DistrictAggregate[] = [];
	for (const [district, totalBlocksForDist] of districtBlockTotals) {
		const boundaryBlocks = districtBoundaryBlocks.get(district) ?? 0;
		const fraction = totalBlocksForDist > 0 ? boundaryBlocks / totalBlocksForDist : 0;
		districtAggregates.push({
			district,
			totalBlocks: totalBlocksForDist,
			boundaryBlocks,
			boundaryFraction: Math.round(fraction * 10000) / 10000,
		});
	}
	districtAggregates.sort((a, b) => b.boundaryFraction - a.boundaryFraction);

	const out: OutputArtifact = {
		schemaVersion: 1,
		version: args.version,
		generatedAt: new Date().toISOString(),
		tigerVintage: `${EXPECTED_TIGER_VINTAGE} (BAF + tract centroids)`,
		methodology:
			'For each TIGER block, the parent tract centroid maps to an H3 res-7 cell. ' +
			'Cells where the set of distinct congressional districts (across all blocks ' +
			'in the cell) has cardinality >= 2 are boundary cells. Per-pair aggregates ' +
			'count cells and blocks for each adjacent CD pair; per-district aggregates ' +
			'count boundary blocks per CD (less narrowing).',
		limitations: [
			'Block COUNT, not population. ACS-weighted aggregates are deferred (Phase 2).',
			'Block-to-tract centroid: blocks within the same tract collapse to one H3 cell. ' +
				'For tracts that span H3 cell boundaries, this approximation under-counts ' +
				'boundary cells (lower bound on the real number).',
			'Fallback bucket: blocks whose tract centroid is missing fall through with no ' +
				'H3 mapping. Per-state fallback >1% triggers hard-fail (G3r).',
			`k-anonymity floor: per-pair aggregates with fewer than ${K_ANONYMITY_FLOOR} blocks ` +
				'aggregate into "minorPairsAggregate". K=10 in dense urban areas (≈1 ' +
				'intersection) has different privacy semantics than K=10 in rural areas ' +
				'(≈1 ranch). Density-aware K is deferred until ACS data lands.',
			'CD-only: this measurement covers congressional districts. State legislative ' +
				'(SLDU/SLDL) and county boundaries have more boundary surface area; ' +
				'expanding to those slots is deferred (Phase 1c).',
		],
		totals: {
			statesProcessed: stateFipsList.length,
			statesWithFallbackFailures,
			blocksTotal: totalBlocks,
			blocksMappedToCells: mappedBlocks,
			blocksFallbackBucket: fallbackBlocks,
			blocksFallbackRatio:
				totalBlocks > 0 ? Math.round((fallbackBlocks / totalBlocks) * 10000) / 10000 : 0,
			boundaryCellsTotal,
			boundaryBlocksTotal,
			uniqueBoundaryPairs: pairAggregates.size,
		},
		kAnonymityFloor: K_ANONYMITY_FLOOR,
		districts: districtAggregates,
		pairs: publishedPairs,
		minorPairsAggregate: minorAgg,
	};

	mkdirSync(dirname(resolve(args.output)), { recursive: true });
	writeFileSync(resolve(args.output), JSON.stringify(out, null, 2) + '\n');

	console.log(`\nBoundary cells: ${boundaryCellsTotal}`);
	console.log(`Boundary blocks: ${boundaryBlocksTotal} of ${totalBlocks} total`);
	console.log(`Unique pairs (pre-floor): ${pairAggregates.size}`);
	console.log(`Published pairs (≥${K_ANONYMITY_FLOOR}): ${publishedPairs.length}`);
	console.log(`Minor pairs (rolled up): ${minorAgg.pairs} (${minorAgg.blocks} blocks)`);
	console.log(`\nWritten to: ${resolve(args.output)}`);
	if (publishedPairs.length > 0) {
		console.log('\nTop 5 pairs by block count:');
		for (const p of publishedPairs.slice(0, 5)) {
			console.log(`  ${p.pair[0]} ↔ ${p.pair[1]}  ${p.boundaryCells} cells, ${p.blocks} blocks`);
		}
	}
}

// Only run when invoked as a script, not when imported for unit tests.
const isDirectInvocation =
	import.meta.url === `file://${process.argv[1]}` ||
	import.meta.url.endsWith('/measure-boundary-population.ts');
if (isDirectInvocation && process.argv.length > 1) {
	main().catch((err) => {
		console.error(`Fatal: ${err instanceof Error ? err.message : err}`);
		process.exit(1);
	});
}
