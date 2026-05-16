#!/usr/bin/env tsx
/**
 * Render per-district basemap PNGs alongside the GeoJSON bundles.
 *
 * Input layout (produced by extract-district-bundles.ts):
 *   {bundle-dir}/{country}/{layer}/index.json    — districts[] with bbox
 *   {bundle-dir}/{country}/{layer}/{id}.geojson  — single feature per district
 *
 * Output (this script writes alongside):
 *   {bundle-dir}/{country}/{layer}/{id}-base.png  — pre-rendered basemap raster
 *
 * The browser fetches one PNG per district profile view. Cloudflare edge cache
 * absorbs repeats; the third-party tile vendor is only hit at publish time.
 *
 * Provider: CARTO Positron `light_all` raster tiles from `basemaps.cartocdn.com`.
 * Free for our use, CC BY 3.0 cartography over OSM ODbL data — attribution
 * required and baked into the rendered image. The runtime never hits Carto;
 * publish time stitches the visible tile set into a single PNG once per
 * (district, atlas version) and serves the result from our R2/Worker.
 *
 * Usage:
 *   tsx scripts/render-district-basemaps.ts --bundle-dir <path> [--layers cd]
 *
 * Exit codes:
 *   0  success (including dry-run)
 *   1  argument error
 *   2  tile fetch / composite failure
 *   3  output write failure
 */

import { existsSync, readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Jimp, JimpMime, loadFont } from 'jimp';
import { SANS_10_BLACK } from 'jimp/fonts';

const TILE_HOSTS = ['a', 'b', 'c'];
const TILE_URL_TEMPLATE =
	'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png';
const DEFAULT_WIDTH = 360;
const DEFAULT_HEIGHT = 220;
const DEFAULT_PADDING_PCT = 0.06;
const DEFAULT_LAYERS = ['cd'];
const SCALE = 2; // @2x retina output
const TILE_PX = 512; // @2x tile dimension in physical pixels (256 logical × 2)
const MAX_ZOOM = 18;
const FETCH_USER_AGENT = 'commons-shadow-atlas-publish/1.0 (https://commons.email)';
// The default Jimp BMFont set doesn't carry the © glyph; rendering "©" produces
// "?". Use the textual "(c)" form — Carto + OSM both treat it as equivalent
// attribution; the requirement is acknowledgment, not the typographic mark.
const ATTRIBUTION_TEXT = '(c) OpenStreetMap contributors (c) CARTO';

interface ParsedArgs {
	bundleDir: string;
	layers: string[];
	maxFetches: number;
	dryRun: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
	const out: Partial<ParsedArgs> = {
		layers: DEFAULT_LAYERS,
		maxFetches: 4000,
		dryRun: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const next = argv[i + 1];
		switch (arg) {
			case '--bundle-dir':
				out.bundleDir = next;
				i++;
				break;
			case '--layers':
				out.layers = next?.split(',').map((s) => s.trim()) ?? DEFAULT_LAYERS;
				i++;
				break;
			case '--max-fetches':
				out.maxFetches = Number(next);
				i++;
				break;
			case '--dry-run':
				out.dryRun = true;
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
	if (!out.bundleDir) {
		console.error('Required: --bundle-dir <path>');
		process.exit(1);
	}
	if (!Number.isFinite(out.maxFetches) || (out.maxFetches as number) < 0) {
		console.error('Invalid --max-fetches value');
		process.exit(1);
	}
	return out as ParsedArgs;
}

function printHelp(): void {
	console.log(`render-district-basemaps — CARTO basemap stitcher for shadow-atlas bundles

Required:
  --bundle-dir <path>      Directory produced by extract-district-bundles.ts

Optional:
  --layers cd,sldu,sldl    Layers to render (default: cd)
  --max-fetches <n>        Abort if total tile fetches exceed this (default: 4000)
  --dry-run                Print plan + tile counts, no fetches

Tiles come from basemaps.cartocdn.com (Carto Positron light_all @2x). Each
district stitches its visible 360x220 frame from 3-9 tiles depending on bbox
shape and zoom. The browser never fetches Carto directly — publish writes a
single PNG to disk; uploader puts it on R2.

Attribution "© OpenStreetMap contributors © CARTO" is baked into the
bottom-right of each rendered image, satisfying both upstream licenses with
no UI work on the consumer side.`);
}

interface DistrictIndex {
	schemaVersion: number;
	layer: string;
	country: string;
	version: string;
	districts: Array<{
		id: string;
		name: string;
		bbox: [number, number, number, number];
	}>;
}

interface BBox {
	minLon: number;
	minLat: number;
	maxLon: number;
	maxLat: number;
}

interface RenderJob {
	id: string;
	country: string;
	layer: string;
	bbox: BBox;
	outPath: string;
}

// --- projection -------------------------------------------------------------

function lonToPx(lon: number, zoom: number): number {
	return ((lon + 180) / 360) * 256 * 2 ** zoom;
}
function latToPx(lat: number, zoom: number): number {
	const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
	const s = Math.sin((clamped * Math.PI) / 180);
	return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * 2 ** zoom;
}

function bboxCenter(b: BBox): { lat: number; lon: number } {
	return {
		lat: (b.minLat + b.maxLat) / 2,
		lon: (b.minLon + b.maxLon) / 2,
	};
}

/** Mirror of commons/src/lib/core/shadow-atlas/projection.ts → unwrapBBoxAntimeridian. */
function unwrapBBoxAntimeridian(b: BBox): BBox {
	if (b.maxLon - b.minLon <= 180) return b;
	return { ...b, minLon: b.maxLon, maxLon: b.minLon + 360 };
}

function wrapLonToStandard(lon: number): number {
	return (((lon + 180) % 360) + 360) % 360 - 180;
}

/**
 * Largest integer zoom at which `b` fits in (widthPx, heightPx) with
 * `padding` (fraction of dim) clear on each side. Must stay identical to the
 * runtime helper in commons/src/lib/core/shadow-atlas/projection.ts — drift
 * here = visible offset between the SVG district polygon and this basemap.
 */
function fitZoom(b: BBox, widthPx: number, heightPx: number, padding: number): number {
	const availW = widthPx * (1 - padding * 2);
	const availH = heightPx * (1 - padding * 2);
	for (let z = MAX_ZOOM; z >= 0; z--) {
		const w = lonToPx(b.maxLon, z) - lonToPx(b.minLon, z);
		const h = latToPx(b.minLat, z) - latToPx(b.maxLat, z);
		if (w <= availW && h <= availH) return z;
	}
	return 0;
}

// --- tile math --------------------------------------------------------------

interface TileCoord {
	z: number;
	x: number;
	y: number;
}

interface RenderPlan {
	tiles: TileCoord[];
	imageWidth: number;
	imageHeight: number;
	// Origin of the rendered image in world-tile-pixel coords (@2x scale).
	originX: number;
	originY: number;
}

function planFrame(bbox: BBox): RenderPlan {
	const effective = unwrapBBoxAntimeridian(bbox);
	const center = bboxCenter(effective);
	const zoom = fitZoom(effective, DEFAULT_WIDTH, DEFAULT_HEIGHT, DEFAULT_PADDING_PCT);
	const imgW = DEFAULT_WIDTH * SCALE;
	const imgH = DEFAULT_HEIGHT * SCALE;
	// Center in world @2x pixels: (logical 256 px/tile) × 2 × 2^zoom = TILE_PX × 2^zoom
	const cx = lonToPx(wrapLonToStandard(center.lon), zoom) * SCALE;
	const cy = latToPx(center.lat, zoom) * SCALE;
	const originX = cx - imgW / 2;
	const originY = cy - imgH / 2;
	const tileMinX = Math.floor(originX / TILE_PX);
	const tileMinY = Math.floor(originY / TILE_PX);
	const tileMaxX = Math.floor((originX + imgW - 1) / TILE_PX);
	const tileMaxY = Math.floor((originY + imgH - 1) / TILE_PX);
	const maxTileIndex = 2 ** zoom - 1;
	const tiles: TileCoord[] = [];
	for (let ty = tileMinY; ty <= tileMaxY; ty++) {
		if (ty < 0 || ty > maxTileIndex) continue;
		for (let tx = tileMinX; tx <= tileMaxX; tx++) {
			// Horizontal wrap-around for antimeridian-spanning frames.
			const wrappedX = ((tx % (maxTileIndex + 1)) + (maxTileIndex + 1)) % (maxTileIndex + 1);
			tiles.push({ z: zoom, x: wrappedX, y: ty });
		}
	}
	return { tiles, imageWidth: imgW, imageHeight: imgH, originX, originY };
}

function tileUrl(t: TileCoord, hostIndex: number): string {
	const host = TILE_HOSTS[hostIndex % TILE_HOSTS.length];
	return TILE_URL_TEMPLATE
		.replace('{s}', host)
		.replace('{z}', String(t.z))
		.replace('{x}', String(t.x))
		.replace('{y}', String(t.y));
}

// --- render -----------------------------------------------------------------

const TILE_FETCH_TIMEOUT_MS = 15_000;
const TILE_FETCH_MAX_ATTEMPTS = 3;

async function fetchTile(url: string): Promise<Buffer> {
	let lastErr: unknown = null;
	for (let attempt = 1; attempt <= TILE_FETCH_MAX_ATTEMPTS; attempt++) {
		try {
			const res = await fetch(url, {
				headers: { 'User-Agent': FETCH_USER_AGENT },
				signal: AbortSignal.timeout(TILE_FETCH_TIMEOUT_MS),
			});
			if (!res.ok) {
				// Retry 5xx; surface 4xx immediately (bad URL, never resolves).
				if (res.status >= 500 && attempt < TILE_FETCH_MAX_ATTEMPTS) {
					lastErr = new Error(`Tile ${res.status} for ${url}`);
				} else {
					throw new Error(`Tile ${res.status} for ${url}`);
				}
			} else {
				return Buffer.from(await res.arrayBuffer());
			}
		} catch (err) {
			lastErr = err;
			if (attempt >= TILE_FETCH_MAX_ATTEMPTS) break;
		}
		// Backoff: 400 ms, then 1200 ms.
		await new Promise((r) => setTimeout(r, 400 * attempt ** 2));
	}
	throw lastErr instanceof Error
		? lastErr
		: new Error(`Tile fetch failed for ${url} after ${TILE_FETCH_MAX_ATTEMPTS} attempts`);
}

async function renderOne(job: RenderJob, fetchCounter: { n: number }): Promise<void> {
	const plan = planFrame(job.bbox);
	const canvas = new Jimp({ width: plan.imageWidth, height: plan.imageHeight, color: 0xf5f5f5ff });
	for (let i = 0; i < plan.tiles.length; i++) {
		const t = plan.tiles[i];
		const url = tileUrl(t, i);
		const buf = await fetchTile(url);
		fetchCounter.n++;
		const tileImg = await Jimp.read(buf);
		// Tile origin in world @2x-pixel coords (using the actual tile index from
		// the request, which may differ from the unwrapped frame's continuous
		// space — re-derive from the plan's first tile column instead of t.x).
		const tilePxX = (Math.floor(plan.originX / TILE_PX) + (i % planTileCols(plan))) * TILE_PX;
		const tilePxY =
			(Math.floor(plan.originY / TILE_PX) + Math.floor(i / planTileCols(plan))) * TILE_PX;
		const placeX = Math.round(tilePxX - plan.originX);
		const placeY = Math.round(tilePxY - plan.originY);
		canvas.composite(tileImg, placeX, placeY);
	}

	const font = await loadFont(SANS_10_BLACK);
	const padding = 6;
	// Width estimate: ~5.5 px per char for SANS_10. Right-justify.
	const textWidthEstimate = ATTRIBUTION_TEXT.length * 5;
	canvas.print({
		font,
		x: plan.imageWidth - textWidthEstimate - padding,
		y: plan.imageHeight - 14 - padding,
		text: ATTRIBUTION_TEXT,
	});

	const out = await canvas.getBuffer(JimpMime.png);
	writeFileSync(job.outPath, out);
}

function planTileCols(plan: RenderPlan): number {
	const tileMinX = Math.floor(plan.originX / TILE_PX);
	const tileMaxX = Math.floor((plan.originX + plan.imageWidth - 1) / TILE_PX);
	return tileMaxX - tileMinX + 1;
}

function collectJobs(args: ParsedArgs): RenderJob[] {
	const jobs: RenderJob[] = [];
	for (const country of readdirSync(args.bundleDir)) {
		const countryDir = join(args.bundleDir, country);
		if (!statSync(countryDir).isDirectory()) continue;
		for (const layer of readdirSync(countryDir)) {
			if (!args.layers.includes(layer)) continue;
			const layerDir = join(countryDir, layer);
			const indexPath = join(layerDir, 'index.json');
			if (!existsSync(indexPath)) continue;
			const idx = JSON.parse(readFileSync(indexPath, 'utf8')) as DistrictIndex;
			for (const d of idx.districts) {
				const [minLon, minLat, maxLon, maxLat] = d.bbox;
				jobs.push({
					id: d.id,
					country,
					layer,
					bbox: { minLon, minLat, maxLon, maxLat },
					outPath: join(layerDir, `${d.id}-base.png`),
				});
			}
		}
	}
	return jobs;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const bundleDir = resolve(args.bundleDir);
	if (!existsSync(bundleDir)) {
		console.error(`Bundle dir not found: ${bundleDir}`);
		process.exit(1);
	}

	const jobs = collectJobs(args);
	const plans = jobs.map((j) => planFrame(j.bbox));
	const totalTiles = plans.reduce((sum, p) => sum + p.tiles.length, 0);
	console.log(
		`Planned: ${jobs.length} basemap renders across layers [${args.layers.join(', ')}], ${totalTiles} tile fetches total.`,
	);

	if (totalTiles > args.maxFetches) {
		console.error(
			`Tile-fetch count ${totalTiles} exceeds --max-fetches ${args.maxFetches}. ` +
				'Refusing to proceed (would hammer the upstream).',
		);
		process.exit(1);
	}

	if (args.dryRun) {
		const sample = jobs.slice(0, 5);
		console.log('Sample plans:');
		for (let i = 0; i < sample.length; i++) {
			const p = plans[i];
			const z = p.tiles[0]?.z ?? 0;
			console.log(`  ${sample[i].id}  tiles=${p.tiles.length}  zoom=${z}`);
		}
		console.log('Dry run — no fetches sent.');
		return;
	}

	// Idempotent: skip any district whose PNG already exists. Atlas versions
	// are immutable, so a re-run after a partial failure walks the same list
	// but only spends fetches on the gaps.
	const pending = jobs.filter((j) => !existsSync(j.outPath));
	const cached = jobs.length - pending.length;
	if (cached > 0) {
		console.log(`Skipping ${cached} districts with existing PNGs; ${pending.length} to render.`);
	}

	const fetchCounter = { n: 0 };
	let done = 0;
	let failed = 0;
	for (const job of pending) {
		try {
			await renderOne(job, fetchCounter);
			done++;
			if (done % 25 === 0) {
				console.log(`  rendered ${done}/${pending.length}  (${fetchCounter.n} fetches)`);
			}
		} catch (err) {
			failed++;
			console.error(`  ${job.id} failed:`, err instanceof Error ? err.message : err);
		}
	}
	console.log(
		`\nRendered ${done}/${pending.length} (${failed} failed; ${cached} cached; ${fetchCounter.n} tile fetches).`,
	);
	if (failed > 0) process.exit(2);
}

main().catch((err) => {
	console.error('render-district-basemaps fatal:', err);
	process.exit(3);
});
