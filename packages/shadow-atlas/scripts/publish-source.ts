#!/usr/bin/env tsx
/**
 * Publish Shadow Atlas Source Artifacts to R2
 *
 * Single-command bootstrap for the quarterly republish path. Builds (or
 * reuses) `shadow-atlas-full.db` + `officials.db` locally, computes their
 * SHA-256, uploads to `source/v{TAG}/...` in the shadow-atlas R2 bucket
 * via wrangler (CF-native API auth, no S3-compat AKID/secret needed),
 * and atomically replaces `source/manifest.json` so the workflow's
 * resolve-source step finds the new build.
 *
 * Single-token model: the only credential needed is a Cloudflare API
 * token with `Account → R2 → Edit`. All R2 operations go through
 * `wrangler r2 object put`, which handles arbitrary file sizes and
 * absorbs the multipart vs single-PUT decision internally.
 *
 * Usage:
 *   npm run publish:source -- --version v20260418 [flags]
 *
 * Required:
 *   --version v{YYYYMMDD}    Version tag, must match chunked output prefix.
 *
 * Optional:
 *   --source-dir <path>      Where to find/build the .db files. Default: ./data
 *   --tiger-vintage <label>  Provenance tag for TIGER source data. Default: 'unknown'.
 *   --rebuild                Run npm scripts to (re)build the .db files even if present.
 *   --force                  Overwrite an existing version in the manifest.
 *   --dry-run                Print the plan without uploading.
 *   --output <path>          Where to write run record. Default: ./output/publish-source-results.json
 *
 * Environment Variables:
 *   CLOUDFLARE_API_TOKEN     - Bearer token with R2:Edit scope (required, except --dry-run)
 *   CLOUDFLARE_ACCOUNT_ID    - Cloudflare account ID (required, except --dry-run)
 *   R2_BUCKET_NAME           - Default: 'shadow-atlas'
 *   R2_PUBLIC_URL            - Default: 'https://atlas.commons.email'
 *
 * Exit Codes:
 *   0  success
 *   1  argument or environment error
 *   2  build failure
 *   3  upload or verification failure
 *   4  manifest collision (use --force to overwrite)
 */

import { createReadStream, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { open as openFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';

import {
	LONG_UPLOAD_TIMEOUT_MS,
	resolveWranglerBin,
	wranglerDelete,
	wranglerPutBody,
	wranglerPutFile,
	type WranglerEnv,
} from './_wrangler-r2.js';
import { signManifest } from './_ed25519.js';

const VERSION_PATTERN = /^v\d{8}$/;
const ARTIFACTS = ['shadow-atlas-full.db', 'officials.db'] as const;

interface ParsedArgs {
	version: string;
	sourceDir: string;
	tigerVintage: string;
	rebuild: boolean;
	force: boolean;
	dryRun: boolean;
	outputPath: string;
}

interface FileEntry {
	sizeBytes: number;
	sha256: string;
	url: string;
}

interface BuildEntry {
	version: string;
	publishedAt: string;
	gitSha: string | null;
	tigerVintage: string;
	files: Record<string, FileEntry>;
}

interface SourceManifest {
	schemaVersion: number;
	currentVersion: string;
	builds: BuildEntry[];
}

interface PublishResults {
	timestamp: string;
	version: string;
	bucket: string;
	publicUrl: string;
	dbSourceUrl: string;
	files: Record<string, FileEntry>;
	durationMs: number;
}

function parseArgs(argv: string[]): ParsedArgs {
	let version = '';
	let sourceDir = './data';
	let tigerVintage = 'unknown';
	let rebuild = false;
	let force = false;
	let dryRun = false;
	let outputPath = './output/publish-source-results.json';

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		switch (arg) {
			case '--version':
				version = argv[++i];
				break;
			case '--source-dir':
				sourceDir = argv[++i];
				break;
			case '--tiger-vintage':
				tigerVintage = argv[++i];
				break;
			case '--rebuild':
				rebuild = true;
				break;
			case '--force':
				force = true;
				break;
			case '--dry-run':
				dryRun = true;
				break;
			case '--output':
				outputPath = argv[++i];
				break;
			case '--help':
			case '-h':
				printUsage();
				process.exit(0);
			default:
				console.error(`Unknown argument: ${arg}`);
				printUsage();
				process.exit(1);
		}
	}

	if (!version) {
		console.error('Error: --version is required (e.g. --version v20260418)');
		process.exit(1);
	}
	if (!VERSION_PATTERN.test(version)) {
		console.error(`Error: --version must match v{YYYYMMDD}, got: ${version}`);
		process.exit(1);
	}

	return { version, sourceDir, tigerVintage, rebuild, force, dryRun, outputPath };
}

function printUsage(): void {
	console.error(`
Usage:
  tsx scripts/publish-source.ts --version v{YYYYMMDD} [options]

Required:
  --version v{YYYYMMDD}    Version tag (must match the chunked output prefix)

Options:
  --source-dir <path>      Default: ./data
  --tiger-vintage <label>  Default: unknown
  --rebuild                Re-run npm build scripts even if .db files exist
  --force                  Overwrite an existing version in the manifest
  --dry-run                Print plan without uploading
  --output <path>          Default: ./output/publish-source-results.json
  -h, --help               Print this message

Required environment variables (single-token model):
  CLOUDFLARE_API_TOKEN     Token with Account → R2 → Edit
  CLOUDFLARE_ACCOUNT_ID    Cloudflare account ID
`);
}

/** Resolve the current git SHA of the shadow-atlas package. */
function readGitSha(): string | null {
	try {
		return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
	} catch {
		return null;
	}
}

/** Stream-hash a file. */
async function sha256File(path: string): Promise<string> {
	const hash = createHash('sha256');
	await pipeline(createReadStream(path), hash);
	return hash.digest('hex');
}

/** Slice size used for ground-truth post-upload verification of large files. */
const SLICE_SIZE = 1024 * 1024; // 1 MB
/** Files at or above this size get slice-verified rather than full-fetched. */
const SLICE_VERIFY_THRESHOLD = 4 * 1024 * 1024; // 4 MB

interface SliceHashes {
	readonly firstHash: string;
	readonly lastHash: string;
	readonly size: number;
}

/**
 * Compute SHA-256 of the first 1 MB and last 1 MB of a local file.
 * Used for ground-truth post-upload verification: after wrangler PUT,
 * we Range-GET the same slices from R2 and compare. This breaks the
 * self-referential sidecar check (which only proved R2 returns what we
 * wrote, not that the bytes are correct) and costs ~2 MB of egress on
 * a 3.6 GB upload.
 */
async function fileSliceHashes(path: string): Promise<SliceHashes> {
	const size = statSync(path).size;
	const fd = await openFile(path, 'r');
	try {
		const firstLen = Math.min(SLICE_SIZE, size);
		const firstBuf = Buffer.alloc(firstLen);
		await fd.read(firstBuf, 0, firstLen, 0);

		const lastStart = Math.max(0, size - SLICE_SIZE);
		const lastLen = size - lastStart;
		const lastBuf = Buffer.alloc(lastLen);
		await fd.read(lastBuf, 0, lastLen, lastStart);

		return {
			firstHash: createHash('sha256').update(firstBuf).digest('hex'),
			lastHash: createHash('sha256').update(lastBuf).digest('hex'),
			size,
		};
	} finally {
		await fd.close();
	}
}

/**
 * Re-derive a hash from R2 bytes by Range-GETting slices and comparing.
 * Returns ok iff every slice (or full body, for small files) matches
 * its locally-computed expectation. Throws on transport errors (so a
 * network blip surfaces, not a silent "verified" pass).
 *
 * `expectedFullSha` is the full-file sha256 from `sha256File()` —
 * needed for the small-file path (size <= SLICE_SIZE) where firstHash
 * already covers the entire body, and for the (SLICE_SIZE, threshold]
 * range where neither slice alone is the full file.
 */
async function verifyR2Slices(
	url: string,
	expected: SliceHashes,
	expectedFullSha: string,
	noCacheHeaders: Record<string, string>,
): Promise<{ ok: boolean; reason?: string }> {
	const cacheBust = `?t=${Date.now()}`;

	if (expected.size <= SLICE_VERIFY_THRESHOLD) {
		// Small file: full-GET, full-hash. Compare against the full-file
		// sha (NOT firstHash, which only covers the first 1 MB and would
		// false-mismatch any file > SLICE_SIZE).
		const res = await fetch(`${url}${cacheBust}`, {
			signal: AbortSignal.timeout(60_000),
			headers: noCacheHeaders,
		});
		if (!res.ok) return { ok: false, reason: `GET returned ${res.status}` };
		const buf = Buffer.from(await res.arrayBuffer());
		const got = createHash('sha256').update(buf).digest('hex');
		if (got !== expectedFullSha) {
			return { ok: false, reason: `full-body hash mismatch: got ${got.slice(0, 16)}…` };
		}
		return { ok: true };
	}

	// Large file: hash the first and last 1 MB.
	const firstEnd = SLICE_SIZE - 1;
	const firstRes = await fetch(`${url}${cacheBust}`, {
		signal: AbortSignal.timeout(60_000),
		headers: { ...noCacheHeaders, Range: `bytes=0-${firstEnd}` },
	});
	if (firstRes.status !== 206) {
		return { ok: false, reason: `first-slice expected 206, got ${firstRes.status}` };
	}
	const firstBuf = Buffer.from(await firstRes.arrayBuffer());
	const firstGot = createHash('sha256').update(firstBuf).digest('hex');
	if (firstGot !== expected.firstHash) {
		return {
			ok: false,
			reason: `first-slice hash mismatch: got ${firstGot.slice(0, 16)}…`,
		};
	}

	const lastStart = expected.size - SLICE_SIZE;
	const lastEnd = expected.size - 1;
	const lastRes = await fetch(`${url}${cacheBust}`, {
		signal: AbortSignal.timeout(60_000),
		headers: { ...noCacheHeaders, Range: `bytes=${lastStart}-${lastEnd}` },
	});
	if (lastRes.status !== 206) {
		return { ok: false, reason: `last-slice expected 206, got ${lastRes.status}` };
	}
	const lastBuf = Buffer.from(await lastRes.arrayBuffer());
	const lastGot = createHash('sha256').update(lastBuf).digest('hex');
	if (lastGot !== expected.lastHash) {
		return {
			ok: false,
			reason: `last-slice hash mismatch: got ${lastGot.slice(0, 16)}…`,
		};
	}

	return { ok: true };
}

/**
 * Build the .db files via the existing npm scripts. CF credentials are
 * scrubbed from the child env so a typosquatted transitive dep deep in
 * the build graph can't exfil CLOUDFLARE_API_TOKEN to its inherited stdout.
 */
function runBuild(): void {
	const scrubbedEnv: NodeJS.ProcessEnv = {
		...process.env,
		CLOUDFLARE_API_TOKEN: undefined,
		CLOUDFLARE_ACCOUNT_ID: undefined,
		R2_ACCOUNT_ID: undefined,
		R2_ACCESS_KEY_ID: undefined,
		R2_SECRET_ACCESS_KEY: undefined,
		// The signing key forges trust for every future publish until
		// rotated — higher-value than the CF token. Scrub from the
		// build subprocess (and its grandchildren) so a typosquatted
		// transitive dep can't exfil it.
		MANIFEST_SIGNING_PRIVATE_KEY: undefined,
	};
	console.log('Building shadow-atlas-full.db (this can take 1-3 hours)...');
	execFileSync('npm', ['run', 'build:districts:full'], { stdio: 'inherit', env: scrubbedEnv });
	console.log('Building officials.db...');
	execFileSync('npm', ['run', 'ingest:legislators'], { stdio: 'inherit', env: scrubbedEnv });
}


interface FetchedManifest {
	manifest: SourceManifest | null;
}

/**
 * Fetch the current source manifest via the public Atlas Worker URL.
 *
 * The manifest path is short-cached (5 min) by the Worker, but a
 * republish from CI runner A while operator B is reading via the same
 * edge POP would otherwise serve B a stale cached copy. We bust both
 * the edge cache (?t=) and any intermediate caches (Cache-Control)
 * so the fetched body is always the live R2 object.
 *
 * Trade-off vs the previous S3 GetObject path: we lose the ETag we used
 * to drive a conditional `IfMatch` write. With the single-token model
 * there is no S3 client; conditional writes aren't reachable through
 * `wrangler r2 object put`. The mitigation is operational: this script
 * runs once per quarter, by one operator at a time. The race window
 * (fetch → upload artifacts → upload manifest) is the operator's
 * uninterrupted local session.
 */
async function fetchManifest(publicUrl: string): Promise<FetchedManifest> {
	const url = `${publicUrl}/source/manifest.json?t=${Date.now()}`;
	try {
		const response = await fetch(url, {
			signal: AbortSignal.timeout(30_000),
			headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
		});
		if (response.status === 404) return { manifest: null };
		if (!response.ok) {
			throw new Error(`Manifest fetch failed: ${response.status} ${response.statusText}`);
		}
		const body = (await response.json()) as SourceManifest;
		// Validate every entry's version tag — a malformed entry could
		// otherwise sort to the top of mergeBuild and become
		// currentVersion permanently.
		for (const build of body.builds ?? []) {
			if (!VERSION_PATTERN.test(build.version)) {
				throw new Error(
					`Manifest contains invalid version tag: ${JSON.stringify(build.version)}`,
				);
			}
		}
		return { manifest: body };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to read existing manifest: ${msg}`);
	}
}

/**
 * Merge a new build entry into the manifest. The currentVersion pointer
 * is derived from the SORTED build list (newest first by lex order on
 * v{YYYYMMDD}) — never from the entry being inserted — so backfilling
 * an older tag cannot silently downgrade the pointer.
 */
function mergeBuild(
	current: SourceManifest | null,
	entry: BuildEntry,
	force: boolean,
): SourceManifest {
	const existing = current?.builds ?? [];
	const collision = existing.find((b) => b.version === entry.version);
	if (collision && !force) {
		throw new ManifestCollisionError(
			`Version ${entry.version} is already in the manifest. Use --force to overwrite.`,
		);
	}
	const filtered = existing.filter((b) => b.version !== entry.version);
	const builds = [entry, ...filtered].sort((a, b) =>
		a.version < b.version ? 1 : a.version > b.version ? -1 : 0,
	);
	return {
		schemaVersion: current?.schemaVersion ?? 1,
		currentVersion: builds[0].version,
		builds,
	};
}

class ManifestCollisionError extends Error {}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	const cfToken = process.env['CLOUDFLARE_API_TOKEN'];
	const accountId = process.env['CLOUDFLARE_ACCOUNT_ID'];
	const bucket = process.env['R2_BUCKET_NAME'] || 'shadow-atlas';
	const publicUrl = (process.env['R2_PUBLIC_URL'] || 'https://atlas.commons.email').replace(/\/$/, '');

	if (!args.dryRun) {
		if (!cfToken || !accountId) {
			console.error('Missing required environment variables:');
			console.error('  CLOUDFLARE_API_TOKEN  (token with Account → R2 → Edit)');
			console.error('  CLOUDFLARE_ACCOUNT_ID');
			console.error(
				'\nCreate API tokens at: Cloudflare Dashboard > My Profile > API Tokens',
			);
			process.exit(1);
		}
	}

	const sourceDir = resolve(args.sourceDir);
	if (!existsSync(sourceDir)) {
		mkdirSync(sourceDir, { recursive: true });
	}

	const cfEnv: WranglerEnv = {
		wranglerBin: args.dryRun ? '' : resolveWranglerBin(),
		token: cfToken ?? '',
		accountId: accountId ?? '',
	};

	// PRE-BUILD COLLISION CHECK: if the version is already in the manifest
	// and --force was not passed, abort BEFORE the (possibly hours-long)
	// rebuild. Operators forgetting --force should not lose a multi-hour
	// build to a cleanup-time error.
	let currentManifest: SourceManifest | null = null;
	if (!args.dryRun) {
		console.log(`Fetching ${publicUrl}/source/manifest.json...`);
		const fetched = await fetchManifest(publicUrl);
		currentManifest = fetched.manifest;
		if (currentManifest) {
			console.log(`  Found existing manifest, currentVersion=${currentManifest.currentVersion}`);
		} else {
			console.log('  No manifest yet — first publish.');
		}
		const collision = currentManifest?.builds.find((b) => b.version === args.version);
		if (collision && !args.force) {
			console.error(
				`\nError: Version ${args.version} is already in the manifest. Use --force to overwrite.`,
			);
			process.exit(4);
		}
	}

	// Build if asked or if any artifact is missing.
	const missing = ARTIFACTS.filter((name) => {
		const path = join(sourceDir, name);
		return !existsSync(path) || statSync(path).size === 0;
	});

	if (missing.length > 0 || args.rebuild) {
		if (missing.length > 0 && !args.rebuild) {
			console.error(
				`Missing or empty artifacts in ${sourceDir}: ${missing.join(', ')}.`,
			);
			console.error('Run with --rebuild to regenerate, or pre-build the files.');
			process.exit(2);
		}
		try {
			runBuild();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`Build failed: ${msg}`);
			process.exit(2);
		}
	}

	// Verify all artifacts exist post-build.
	for (const name of ARTIFACTS) {
		const path = join(sourceDir, name);
		if (!existsSync(path) || statSync(path).size === 0) {
			console.error(`Build did not produce ${name} at ${path}`);
			process.exit(2);
		}
	}

	const startedAt = Date.now();
	const files: Record<string, FileEntry> = {};

	// Hash before upload. The wrangler subprocess reads the file via its
	// own FD, so we can't tee a hash through the upload like we did with
	// lib-storage. The TOCTOU window between hash and upload is the
	// duration of the wrangler subprocess (~minutes for multi-GB files).
	// In practice this script runs against artifacts that aren't being
	// concurrently modified — quarterly cadence, single operator, fresh
	// build outputs. If the file changes mid-upload, the .sha256 sidecar
	// will not match the bytes wrangler PUTs and downstream verification
	// (workflow's resolve-source SHA check) will fail loud.
	console.log(`\nHashing ${ARTIFACTS.length} artifacts...`);
	const slices: Record<string, SliceHashes> = {};
	for (const name of ARTIFACTS) {
		const path = join(sourceDir, name);
		const size = statSync(path).size;
		const sha = await sha256File(path);
		// Slice hashes are computed alongside the full hash so post-upload
		// verification has ground-truth values to compare against R2 bytes.
		slices[name] = await fileSliceHashes(path);
		files[name] = {
			sizeBytes: size,
			sha256: sha,
			url: `${publicUrl}/source/${args.version}/${name}`,
		};
		console.log(`  ${name}  ${(size / 1024 / 1024).toFixed(1)} MB  sha256=${sha.slice(0, 16)}…`);
	}

	const buildEntry: BuildEntry = {
		version: args.version,
		publishedAt: new Date().toISOString(),
		gitSha: readGitSha(),
		tigerVintage: args.tigerVintage,
		files,
	};

	if (args.dryRun) {
		console.log('\n[DRY RUN] Would upload via wrangler:');
		for (const [name, entry] of Object.entries(files)) {
			console.log(`  source/${args.version}/${name}  (${entry.sizeBytes} bytes)`);
			console.log(`  source/${args.version}/${name}.sha256`);
		}
		console.log('\n[DRY RUN] Would update source/manifest.json with build entry:');
		console.log(JSON.stringify(buildEntry, null, 2));
		return;
	}

	const nextManifest = mergeBuild(currentManifest, buildEntry, args.force);

	console.log(`\nUploading to bucket=${bucket} prefix=source/${args.version}/ (via wrangler)`);

	// Per-version artifacts uploaded BEFORE the manifest pointer flips,
	// so a partial upload can't leave the manifest pointing at incomplete
	// data. On a mid-batch failure we best-effort delete what we wrote.
	const uploadedKeys: string[] = [];
	try {
		for (const name of ARTIFACTS) {
			const path = join(sourceDir, name);
			const dbKey = `source/${args.version}/${name}`;
			const shaKey = `${dbKey}.sha256`;

			console.log(`  → ${dbKey}  (${(files[name].sizeBytes / 1024 / 1024).toFixed(1)} MB)`);
			// Multi-GB SQLite gets the long timeout; wrangler internally
			// chunks via multipart and we don't want a stuck upload to wedge
			// the script forever.
			wranglerPutFile(
				bucket,
				dbKey,
				path,
				'application/vnd.sqlite3',
				cfEnv,
				LONG_UPLOAD_TIMEOUT_MS,
			);
			uploadedKeys.push(dbKey);

			console.log(`  → ${shaKey}`);
			wranglerPutBody(
				bucket,
				shaKey,
				`${files[name].sha256}  ${name}\n`,
				'text/plain; charset=utf-8',
				cfEnv,
			);
			uploadedKeys.push(shaKey);
		}
	} catch (err) {
		console.error('\nUpload failed mid-batch. Best-effort cleanup of partial uploads...');
		for (const key of uploadedKeys) {
			console.error(`  deleting ${key}`);
			wranglerDelete(bucket, key, cfEnv);
		}
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`\nUpload error: ${msg}`);
		process.exit(3);
	}

	// Verification BEFORE manifest write. The manifest is the moving
	// pointer consumers follow; if we wrote it pointing at version-X and
	// then verification failed, consumers would already see the bad
	// pointer when we exit 3. Reordered to: verify-then-publish-pointer.
	//
	// Layered checks:
	//   (1) HEAD with Content-Length match — catches truncated uploads.
	//   (2) Sidecar matches local hash — confirms wrangler wrote the
	//       sidecar we expected (round-trip of our hash; proves the
	//       sidecar wasn't dropped or replaced).
	//   (3) Range-GET slices and re-hash — re-derives a hash from the
	//       bytes R2 actually returns. Ground-truth check.
	console.log('\nVerifying uploaded artifacts (HEAD + sidecar + Range-GET slice hashes)...');
	const noCacheHeaders = { 'Cache-Control': 'no-cache', Pragma: 'no-cache' };
	let verifyFailed = false;
	for (const name of ARTIFACTS) {
		const url = files[name].url;
		const head = await fetch(`${url}?t=${Date.now()}`, {
			method: 'HEAD',
			signal: AbortSignal.timeout(30_000),
			headers: noCacheHeaders,
		});
		const sizeOk = head.ok && head.headers.get('content-length') === String(files[name].sizeBytes);

		const sidecarRes = await fetch(`${url}.sha256?t=${Date.now()}`, {
			signal: AbortSignal.timeout(30_000),
			headers: noCacheHeaders,
		});
		const sidecarBody = sidecarRes.ok ? await sidecarRes.text() : '';
		const sidecarHash = sidecarBody.trim().split(/\s+/)[0];
		const hashOk = sidecarHash === files[name].sha256;

		const sliceCheck = await verifyR2Slices(url, slices[name], files[name].sha256, noCacheHeaders);

		const ok = sizeOk && hashOk && sliceCheck.ok;
		console.log(`  ${ok ? 'OK ' : 'BAD'}  ${url}`);
		if (!ok) {
			verifyFailed = true;
			if (!sizeOk) {
				console.error(
					`    size: expected ${files[name].sizeBytes}, got ${head.headers.get('content-length')}`,
				);
			}
			if (!hashOk) {
				console.error(
					`    sidecar hash: expected ${files[name].sha256.slice(0, 16)}…, got ${sidecarHash.slice(0, 16) || '<empty>'}…`,
				);
			}
			if (!sliceCheck.ok) {
				console.error(`    slice verify: ${sliceCheck.reason}`);
			}
		}
	}

	if (verifyFailed) {
		console.error('\nVerification failed before manifest publish. Cleaning up artifacts...');
		for (const key of uploadedKeys) {
			console.error(`  deleting ${key}`);
			wranglerDelete(bucket, key, cfEnv);
		}
		console.error('Manifest NOT updated; consumers continue to see the previous currentVersion.');
		process.exit(3);
	}

	// Now safe to flip the moving pointer: every artifact passed integrity.
	const manifestBody = JSON.stringify(nextManifest, null, 2) + '\n';
	const manifestSha = createHash('sha256').update(manifestBody).digest('hex');

	// Sign the manifest if a private key is supplied. Signature goes
	// to source/manifest.json.sig (sidecar; mirrors the .sha256 pattern).
	// Without a key we publish unsigned and emit a clear warning — fine
	// for the bootstrap window before the first key is committed, but
	// the workflow's gate should be flipped to require_signed=true after
	// the first signed publish so future runs can't silently regress.
	const signingKey = process.env['MANIFEST_SIGNING_PRIVATE_KEY'];
	let manifestSignature: string | null = null;
	if (signingKey) {
		try {
			manifestSignature = signManifest(manifestBody, signingKey);
			console.log('\nManifest signed with Ed25519.');
		} catch (err) {
			const m = err instanceof Error ? err.message : String(err);
			console.error(`\nFatal: signing failed (${m}).`);
			console.error('Aborting before any pointer flip — leaving the prior manifest live.');
			for (const key of uploadedKeys) {
				console.error(`  deleting ${key}`);
				wranglerDelete(bucket, key, cfEnv);
			}
			process.exit(3);
		}
	} else {
		console.log('\nNo MANIFEST_SIGNING_PRIVATE_KEY set — publishing UNSIGNED manifest.');
		console.log(
			'  Fine during bootstrap; once a public key is committed and the workflow gate flips, this path will fail downstream.',
		);
	}

	console.log(`\n  → source/manifest.json (currentVersion=${nextManifest.currentVersion})`);
	console.log(`    sha256=${manifestSha}`);
	wranglerPutBody(bucket, 'source/manifest.json', manifestBody, 'application/json', cfEnv);

	if (manifestSignature) {
		console.log('  → source/manifest.json.sig');
		wranglerPutBody(
			bucket,
			'source/manifest.json.sig',
			manifestSignature + '\n',
			'text/plain; charset=utf-8',
			cfEnv,
		);
	} else {
		// Defensive: if a previous run left a .sig pointing at an older
		// manifest body, leaving it live would let consumers verify
		// against stale bytes — they'd fail closed on a body the publisher
		// considers good. Throw on failure here (unlike error-path
		// cleanups) because downstream verification correctness depends
		// on this delete succeeding.
		console.log('  → source/manifest.json.sig (deleting stale, if any)');
		wranglerDelete(bucket, 'source/manifest.json.sig', cfEnv, { throwOnFailure: true });
	}

	const durationMs = Date.now() - startedAt;
	const dbSourceUrl = files['shadow-atlas-full.db'].url;

	// Persist the run record locally.
	const results: PublishResults = {
		timestamp: new Date().toISOString(),
		version: args.version,
		bucket,
		publicUrl,
		dbSourceUrl,
		files,
		durationMs,
	};
	mkdirSync(dirname(args.outputPath), { recursive: true });
	writeFileSync(args.outputPath, JSON.stringify(results, null, 2) + '\n');
	console.log(`\nResults written to: ${args.outputPath}`);

	console.log('\n──────────────────────────────────────────────────────────────');
	console.log(`Source published. Manifest SHA-256 (paste into workflow):`);
	console.log(`  ${manifestSha}`);
	console.log('');
	console.log('Workflow dispatch:');
	console.log('  gh workflow run shadow-atlas-quarterly.yml \\');
	console.log('    -R communisaas/voter-protocol \\');
	console.log(`    -f expected_manifest_sha256=${manifestSha} \\`);
	console.log('    -f update_registry=false');
	console.log('──────────────────────────────────────────────────────────────');
}

main().catch((err) => {
	console.error('\nFatal error:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});
