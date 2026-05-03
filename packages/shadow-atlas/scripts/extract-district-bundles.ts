#!/usr/bin/env tsx
/**
 * Extract per-district GeoJSON bundles from shadow-atlas-full.db.
 *
 * Why bundles, not a single static GeoJSON: per-layer aggregates run 150 MB
 * (cd) to 450 MB (sldl) uncompressed — too large for browsers to fetch every
 * page render. Per-district files are 50 KB to ~1.5 MB each; the browser
 * fetches just the district it cares about plus a small per-layer index.
 *
 * Why "ship the data, drop the queries": district boundaries are public law.
 * Serving them through an authenticated proxy that takes lat/lng + session
 * identity to return a polygon every constituent of CA-11 receives the same
 * version of leaks the user's location and identity for a question whose
 * answer is identical for everyone. Static R2 + browser-side district lookup
 * gives equivalent UX with no server-side query path.
 *
 * Output layout (relative to --output):
 *   {country}/{layer}/index.json            — list of {id, name, bbox} per district
 *   {country}/{layer}/{id}.geojson          — single Feature per district
 *
 * Index shape (browser fetches once per layer, caches indefinitely):
 *   {
 *     "schemaVersion": 1,
 *     "layer": "cd",
 *     "country": "us",
 *     "version": "v20260503",
 *     "generatedAt": "2026-05-03T...",
 *     "districts": [
 *       { "id": "cd-0611", "name": "Congressional District 11",
 *         "bbox": [minLon, minLat, maxLon, maxLat] }
 *     ]
 *   }
 *
 * Per-district file shape (RFC 7946 Feature):
 *   { "type": "Feature", "id": "cd-0611",
 *     "properties": { "name": "...", "layer": "cd", "jurisdiction": "USA/06",
 *                     "districtType": "council" },
 *     "geometry": { "type": "Polygon" | "MultiPolygon", "coordinates": [...] } }
 *
 * MVP layers (Phase 2a): cd, sldu, sldl, county for US.
 * Deferred (Phase 2b): cousub, place, unsd, elsd, scsd, aiannh, concity —
 *   useful for non-CD use cases but large surface; ship after MVP proves out.
 * Deferred (Phase 2b): fences via TIGER EDGES — separate task; the boundary
 *   feature renders one polygon per page, not adjacency lines.
 *
 * Usage:
 *   tsx scripts/extract-district-bundles.ts --version v20260503 [--db ...] [--output ...]
 *
 * Exit codes:
 *   0  success
 *   1  argument or environment error
 *   2  database read failure
 *   3  output write failure
 */

import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';

const VERSION_PATTERN = /^v\d{8}$/;

/**
 * MVP layer set. Each entry: id-prefix in the SQLite (rows with `id LIKE
 * '{prefix}-%'`) → public layer code in the output URL. Same value for now;
 * separated so we can rename a public-facing layer without renaming SQLite ids
 * (and vice versa) if either evolves.
 */
const LAYERS: Array<{ prefix: string; layer: string }> = [
	{ prefix: 'cd', layer: 'cd' },
	{ prefix: 'sldu', layer: 'sldu' },
	{ prefix: 'sldl', layer: 'sldl' },
	{ prefix: 'county', layer: 'county' },
];

interface ParsedArgs {
	version: string;
	dbPath: string;
	output: string;
	country: string;
	layers: string[] | null;
}

function parseArgs(argv: string[]): ParsedArgs {
	const out: Partial<ParsedArgs> = {
		dbPath: './data/shadow-atlas-full.db',
		output: './output/bundles',
		country: 'us',
		layers: null,
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const next = argv[i + 1];
		switch (arg) {
			case '--version':
				out.version = next;
				i++;
				break;
			case '--db':
				out.dbPath = next;
				i++;
				break;
			case '--output':
				out.output = next;
				i++;
				break;
			case '--country':
				out.country = next?.toLowerCase();
				i++;
				break;
			case '--layers':
				out.layers = next?.split(',').map((s) => s.trim());
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
		console.error('Required: --version v{YYYYMMDD}, e.g. --version v20260503');
		process.exit(1);
	}
	if (!out.country || !/^[a-z]{2,3}$/.test(out.country)) {
		console.error('--country must be lowercase 2-3 letter (us, ca, gb, au)');
		process.exit(1);
	}
	return out as ParsedArgs;
}

function printHelp(): void {
	console.log(`
extract-district-bundles — emit per-district GeoJSON + per-layer index from shadow-atlas-full.db

Usage:
  tsx scripts/extract-district-bundles.ts --version v{YYYYMMDD} [options]

Required:
  --version v{YYYYMMDD}   Version tag (matches publish:source convention)

Optional:
  --db <path>             Source SQLite (default: ./data/shadow-atlas-full.db)
  --output <path>         Output dir (default: ./output/bundles)
  --country <code>        Country code in output paths (default: us)
  --layers <csv>          Restrict to specific layers (default: all MVP layers)
  --help                  Show this message

Layout:
  <output>/<country>/<layer>/index.json
  <output>/<country>/<layer>/<id>.geojson
`);
}

interface DbRow {
	id: string;
	name: string;
	jurisdiction: string;
	district_type: string;
	geometry: string;
	min_lon: number;
	min_lat: number;
	max_lon: number;
	max_lat: number;
}

interface IndexEntry {
	id: string;
	name: string;
	bbox: [number, number, number, number];
}

/**
 * IDs land in R2 keys + filenames. We don't trust upstream pipelines blindly:
 * a corrupted/poisoned SQLite with `id = '../foo'` would otherwise produce a
 * writeFileSync outside layerDir and an R2 key with traversal sequences. The
 * Atlas Worker regex independently rejects malformed ids on the read path,
 * but defense-in-depth happens at the producer too.
 */
const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

function isValidGeometry(geom: unknown): geom is { type: string; coordinates: unknown } {
	if (!geom || typeof geom !== 'object') return false;
	const t = (geom as { type?: unknown }).type;
	const c = (geom as { coordinates?: unknown }).coordinates;
	return (t === 'Polygon' || t === 'MultiPolygon') && Array.isArray(c);
}

function extractLayer(
	db: Database.Database,
	args: ParsedArgs,
	prefix: string,
	layer: string,
): { layer: string; districts: number; bytes: number; skipped: number } {
	const layerDir = join(args.output, args.country, layer);
	mkdirSync(layerDir, { recursive: true });

	// Streaming iterator: 5,000 row layers (sldl) hold ~450 MB of geometry. We
	// don't want to materialize all rows in memory at once.
	const stmt = db.prepare<[string]>(
		`SELECT id, name, jurisdiction, district_type, geometry,
		        min_lon, min_lat, max_lon, max_lat
		 FROM districts
		 WHERE id LIKE ? || '-%'
		 ORDER BY id`,
	);

	const indexEntries: IndexEntry[] = [];
	let totalBytes = 0;
	let skipped = 0;

	for (const row of stmt.iterate(prefix) as IterableIterator<DbRow>) {
		// Defense-in-depth: validate id shape before using it as a path
		// component. The same regex applies in the Atlas Worker; rejecting
		// here prevents a poisoned SQLite from escaping the layer directory.
		if (!ID_PATTERN.test(row.id)) {
			skipped++;
			console.warn(`  skipping ${prefix} row with invalid id: ${JSON.stringify(row.id).slice(0, 64)}`);
			continue;
		}

		let parsedGeom: unknown;
		try {
			parsedGeom = JSON.parse(row.geometry);
		} catch (err) {
			skipped++;
			console.warn(
				`  skipping ${row.id}: geometry JSON parse failed (${err instanceof Error ? err.message : err})`,
			);
			continue;
		}
		if (!isValidGeometry(parsedGeom)) {
			skipped++;
			console.warn(`  skipping ${row.id}: geometry not Polygon/MultiPolygon`);
			continue;
		}

		const feature = {
			type: 'Feature' as const,
			id: row.id,
			properties: {
				name: row.name,
				layer,
				jurisdiction: row.jurisdiction,
				districtType: row.district_type,
			},
			geometry: parsedGeom,
		};
		const json = JSON.stringify(feature);
		const path = join(layerDir, `${row.id}.geojson`);
		writeFileSync(path, json);
		totalBytes += json.length;

		indexEntries.push({
			id: row.id,
			name: row.name,
			bbox: [row.min_lon, row.min_lat, row.max_lon, row.max_lat],
		});
	}

	const indexBody = {
		schemaVersion: 1,
		layer,
		country: args.country,
		version: args.version,
		generatedAt: new Date().toISOString(),
		districtCount: indexEntries.length,
		districts: indexEntries,
	};
	const indexJson = JSON.stringify(indexBody);
	writeFileSync(join(layerDir, 'index.json'), indexJson);
	totalBytes += indexJson.length;

	return { layer, districts: indexEntries.length, bytes: totalBytes, skipped };
}

function main(): void {
	const args = parseArgs(process.argv.slice(2));

	const dbPath = resolve(args.dbPath);
	if (!existsSync(dbPath)) {
		console.error(`Source DB not found: ${dbPath}`);
		console.error('Run: npm run build:districts:full');
		process.exit(2);
	}

	args.output = resolve(args.output);
	mkdirSync(args.output, { recursive: true });

	const layersToProcess = args.layers
		? LAYERS.filter((l) => args.layers!.includes(l.layer))
		: LAYERS;

	if (layersToProcess.length === 0) {
		console.error(`No matching layers. Available: ${LAYERS.map((l) => l.layer).join(', ')}`);
		process.exit(1);
	}

	console.log(`Reading ${dbPath}`);
	console.log(`Output  ${args.output}`);
	console.log(`Layers  ${layersToProcess.map((l) => l.layer).join(', ')}`);
	console.log('');

	let db: Database.Database;
	try {
		db = new Database(dbPath, { readonly: true });
	} catch (err) {
		console.error(`Failed to open ${dbPath}: ${err instanceof Error ? err.message : err}`);
		process.exit(2);
	}

	const results: Array<{ layer: string; districts: number; bytes: number; skipped: number }> = [];
	for (const { prefix, layer } of layersToProcess) {
		const t0 = Date.now();
		try {
			const r = extractLayer(db, args, prefix, layer);
			const ms = Date.now() - t0;
			const mb = (r.bytes / 1024 / 1024).toFixed(1);
			const skip = r.skipped > 0 ? `, ${r.skipped} skipped` : '';
			console.log(
				`  ${layer.padEnd(10)} ${String(r.districts).padStart(6)} districts  ${mb.padStart(6)} MB  ${ms}ms${skip}`,
			);
			results.push(r);
		} catch (err) {
			console.error(`Layer ${layer} failed: ${err instanceof Error ? err.message : err}`);
			db.close();
			process.exit(3);
		}
	}
	db.close();

	const totalDistricts = results.reduce((s, r) => s + r.districts, 0);
	const totalSkipped = results.reduce((s, r) => s + r.skipped, 0);
	const totalMb = results.reduce((s, r) => s + r.bytes, 0) / 1024 / 1024;
	console.log('');
	console.log(
		`Total: ${totalDistricts} districts, ${totalMb.toFixed(1)} MB across ${results.length} layers${totalSkipped > 0 ? ` (${totalSkipped} skipped)` : ''}`,
	);
}

main();
