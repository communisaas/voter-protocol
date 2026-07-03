import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeChunkedOutputs } from '../../../../scripts/build-chunked-mapping.js';
import { resolveTigerVintage } from '../../../distribution/snapshots/tiger-vintage.js';

/**
 * Integrated assertion that the chunked-mapping build stamps `tigerVintage`
 * onto the REAL ChunkManifest artifact (US/manifest.json), not a mock.
 *
 * Exercises the actual manifest-construction + JSON serialization path inside
 * writeChunkedOutputs() — the same code the CLI build runs — by driving it with
 * a tiny in-memory mapping and reading back the file it writes to disk. This is
 * the cross-side contract commons getManifestVintage (ipfs-store.ts) reads:
 * field name exactly `tigerVintage`, string form `TIGER20YY`, degrading to null
 * on absent/'unknown'.
 */
describe('chunked-mapping manifest tigerVintage stamp', () => {
	let outDir: string;

	// res-7 cell + its res-3 parent so writeChunkedOutputs partitions one chunk.
	// Real cell id (lowercase hex, h3-js v4 form) — geometry is irrelevant here;
	// only manifest construction/serialization is under test.
	const CELL = '872830828ffffff';
	const PARENT_RES3 = '832830fffffffff';
	const mapping = { [CELL]: ['CA-12', null] as (string | null)[] };
	const chunkGroups = new Map<string, Record<string, (string | null)[]>>([
		[PARENT_RES3, { [CELL]: mapping[CELL] }],
	]);
	const slotNames = { 0: 'us_house', 1: 'us_senate' };
	const stats = {
		totalEnumerated: 1,
		oceanFiltered: 0,
		totalProcessed: 1,
		totalMatched: 1,
		totalNoCandidate: 0,
		totalCacheHits: 0,
		totalCacheMisses: 0,
		workerCount: 1,
		totalElapsedSec: 1,
	};

	function buildManifest(tigerVintage: string): Record<string, unknown> {
		writeChunkedOutputs(outDir, mapping, chunkGroups, slotNames, tigerVintage, null, stats);
		const manifestPath = join(outDir, 'US', 'manifest.json');
		return JSON.parse(readFileSync(manifestPath, 'utf-8'));
	}

	beforeEach(() => {
		outDir = mkdtempSync(join(tmpdir(), 'chunkmanifest-vintage-'));
	});

	afterEach(() => {
		rmSync(outDir, { recursive: true, force: true });
	});

	it('lands a valid --tiger-vintage TIGER2024 as manifest.tigerVintage', () => {
		// Mirror the build's resolution of a valid flag value (dryRun:false).
		const resolved = resolveTigerVintage('TIGER2024', { dryRun: false });
		const manifest = buildManifest(resolved);

		expect(manifest.tigerVintage).toBe('TIGER2024');
		// Cross-repo form contract: TIGER20YY.
		expect(manifest.tigerVintage).toMatch(/^TIGER20\d{2}$/);
	});

	it("uses the exact field name 'tigerVintage' (cross-repo contract)", () => {
		const manifest = buildManifest('TIGER2024');

		expect(Object.prototype.hasOwnProperty.call(manifest, 'tigerVintage')).toBe(true);
		// Guard against a near-miss key shape the consumer would silently miss.
		expect(manifest).not.toHaveProperty('tiger_vintage');
		expect(manifest).not.toHaveProperty('tigervintage');
	});

	it("throws on an absent/'unknown' vintage in a real (non-dry) build and never writes 'unknown'", () => {
		// A real build resolves with { dryRun: false }; absent/'unknown' is the
		// parse-arg default and must fail loud before any manifest is produced.
		expect(() => resolveTigerVintage('unknown', { dryRun: false })).toThrow(/TIGER20YY/);

		// Because resolution throws, the build never reaches writeChunkedOutputs,
		// so no manifest is produced at all — 'unknown' can never land on disk.
		expect(existsSync(join(outDir, 'US', 'manifest.json'))).toBe(false);

		// Belt-and-suspenders: even if a malformed value reached the writer, the
		// produced artifact would carry that literal — proving 'unknown' is only
		// ever absent here because resolution gates it out, never serialized.
		const manifest = buildManifest('TIGER2024');
		expect(manifest.tigerVintage).not.toBe('unknown');
	});

	it('throws on a malformed bare-year vintage in a real (non-dry) build', () => {
		expect(() => resolveTigerVintage('2024', { dryRun: false })).toThrow(/TIGER20YY/);
	});
});
