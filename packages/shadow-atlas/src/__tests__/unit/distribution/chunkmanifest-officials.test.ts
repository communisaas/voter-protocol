import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
	writeChunkedOutputs,
	readOfficialsGenerated,
} from '../../../../scripts/build-chunked-mapping.js';
import { OFFICIALS_SCHEMA_DDL } from '../../../db/officials-schema.js';

/**
 * Integrated assertion that the chunked-mapping build stamps `officialsGenerated`
 * onto the REAL ChunkManifest artifact (US/manifest.json), not a mock.
 *
 * Exercises the actual manifest-construction + JSON serialization path inside
 * writeChunkedOutputs() — the same code the CLI build runs — by driving it with
 * a tiny in-memory mapping and reading back the file it writes to disk.
 *
 * This is the cross-side contract the shipped commons consumer reads:
 *   - client.ts:1280       `manifest?.officialsGenerated ?? null`
 *   - ipfs-store.ts:644/656
 *   - redraw-guard.ts:75
 * Field name must be EXACTLY `officialsGenerated`. The officials clock is kept
 * DISTINCT from the boundary clocks (`generated`, `tigerVintage`): when the
 * ingest timestamp is unknown the field is present-but-null — never a fabricated
 * or borrowed timestamp.
 */
describe('chunked-mapping manifest officialsGenerated stamp', () => {
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
	const tigerVintage = 'TIGER2024';
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

	function buildManifest(officialsGenerated: string | null): Record<string, unknown> {
		writeChunkedOutputs(outDir, mapping, chunkGroups, slotNames, tigerVintage, officialsGenerated, stats);
		const manifestPath = join(outDir, 'US', 'manifest.json');
		return JSON.parse(readFileSync(manifestPath, 'utf-8'));
	}

	beforeEach(() => {
		outDir = mkdtempSync(join(tmpdir(), 'chunkmanifest-officials-'));
	});

	afterEach(() => {
		rmSync(outDir, { recursive: true, force: true });
	});

	it('lands a passed ISO ingest timestamp verbatim as manifest.officialsGenerated', () => {
		const isoTs = '2026-06-15T12:00:00.000Z';
		const manifest = buildManifest(isoTs);

		expect(manifest.officialsGenerated).toBe(isoTs);
	});

	it('preserves the field as present-but-null when the ingest timestamp is unknown', () => {
		const manifest = buildManifest(null);

		// The consumer reads `manifest?.officialsGenerated ?? null`, so the key MUST
		// be present (not undefined/omitted) and explicitly null — honestly-unknown.
		expect(Object.prototype.hasOwnProperty.call(manifest, 'officialsGenerated')).toBe(true);
		expect(manifest.officialsGenerated).toBeNull();
		expect(manifest.officialsGenerated).not.toBeUndefined();
	});

	it("uses the exact field name 'officialsGenerated' (cross-side contract)", () => {
		const manifest = buildManifest('2026-06-15T12:00:00.000Z');

		expect(Object.prototype.hasOwnProperty.call(manifest, 'officialsGenerated')).toBe(true);
		// Guard against near-miss key shapes the shipped consumer would silently miss.
		expect(manifest).not.toHaveProperty('officials_generated');
		expect(manifest).not.toHaveProperty('officialsAsOf');
		expect(manifest).not.toHaveProperty('officialsgenerated');
	});

	it('never fabricates a date string when the ingest timestamp is unknown', () => {
		const before = new Date().toISOString();
		const manifest = buildManifest(null);
		const after = new Date().toISOString();

		// No fabricated/current-time leakage: the null case carries no string at all.
		expect(manifest.officialsGenerated).toBeNull();
		expect(typeof manifest.officialsGenerated).not.toBe('string');

		// Belt-and-suspenders: the boundary `generated` clock is independent and must
		// NOT have been borrowed into the officials clock (which stayed null).
		expect(typeof manifest.generated).toBe('string');
		expect(manifest.officialsGenerated).not.toBe(manifest.generated);
		expect(manifest.officialsGenerated).not.toBe(before);
		expect(manifest.officialsGenerated).not.toBe(after);
	});

	it('stamps a source-populated timestamp end to end: real officials DB row → readOfficialsGenerated → manifest', () => {
		// Not an injected literal at the writeChunkedOutputs seam: the timestamp
		// travels from a REAL officials-schema DB (canonical DDL bootstrap) through
		// readOfficialsGenerated into the manifest the CLI build writes.
		const runAt = '2026-06-20T04:30:00.000Z';
		const dbPath = join(outDir, 'officials.db');
		const db = new Database(dbPath);
		try {
			db.exec(OFFICIALS_SCHEMA_DDL);
			db.prepare(
				`INSERT INTO ingestion_log (source, status, records_upserted, records_deleted, duration_ms, run_at)
				 VALUES ('congress-legislators', 'success', 541, 0, 1200, ?)`
			).run(runAt);
		} finally {
			db.close();
		}

		const manifest = buildManifest(readOfficialsGenerated(dbPath));

		expect(manifest.officialsGenerated).toBe(runAt);
		// Still an independent clock: sourced from ingestion_log, not borrowed.
		expect(manifest.officialsGenerated).not.toBe(manifest.generated);
		expect(manifest.officialsGenerated).not.toBe(manifest.tigerVintage);
	});

	it('keeps the officials clock distinct from generated and tigerVintage', () => {
		const isoTs = '2026-06-15T12:00:00.000Z';
		const manifest = buildManifest(isoTs);

		// Three independent clocks: none derived from another.
		expect(manifest.officialsGenerated).toBe(isoTs);
		expect(manifest.tigerVintage).toBe('TIGER2024');
		expect(typeof manifest.generated).toBe('string');
		expect(manifest.officialsGenerated).not.toBe(manifest.generated);
		expect(manifest.officialsGenerated).not.toBe(manifest.tigerVintage);
	});
});
