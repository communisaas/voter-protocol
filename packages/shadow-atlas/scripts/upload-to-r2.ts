#!/usr/bin/env tsx
/**
 * Upload Shadow Atlas Artifacts to Cloudflare R2
 *
 * Uploads the validated build output directory to an R2 bucket,
 * preserving the directory structure for path-based HTTP access.
 *
 * Single-token model (2026-05-02): all R2 PUTs go through `wrangler r2
 * object put` which authenticates via CLOUDFLARE_API_TOKEN. No
 * S3-compatible AKID/secret pair is needed. The previous
 * `@aws-sdk/client-s3` path was retired with the storacha-sunset
 * migration so CI carries one credential, not three.
 *
 * Usage:
 *   tsx scripts/upload-to-r2.ts --directory <path> [--output <path>]
 *
 * Environment Variables:
 *   CLOUDFLARE_API_TOKEN  - Token with Account → R2 → Edit (required)
 *   CLOUDFLARE_ACCOUNT_ID - Cloudflare account ID (required)
 *   R2_BUCKET_NAME        - Default: 'shadow-atlas'
 *   R2_PUBLIC_URL         - Default: 'https://atlas.commons.email'
 *
 * Outputs:
 *   r2-upload-results.json - Upload metadata and verification results
 */

import { readdirSync, lstatSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

import {
	resolveWranglerBin,
	runWithConcurrency,
	wranglerPutFileAsync,
	type WranglerEnv,
} from './_wrangler-r2.js';

/**
 * Concurrent wrangler subprocesses. Each pool slot spawns a wrangler
 * child; with 16 in flight, ~2,196 small files clear in seconds rather
 * than the ~36 min of cumulative startup overhead serial mode would
 * take. Tunable via UPLOAD_CONCURRENCY env var.
 */
const DEFAULT_CONCURRENCY = 16;
const MAX_USER_CONCURRENCY = 64;

function parseConcurrency(envVal: string | undefined, defaultValue: number): number {
	if (envVal === undefined || envVal === '') return defaultValue;
	const n = Number(envVal);
	if (!Number.isInteger(n) || n < 1 || n > MAX_USER_CONCURRENCY) {
		console.error(
			`Ignoring invalid UPLOAD_CONCURRENCY=${envVal} (must be integer in [1, ${MAX_USER_CONCURRENCY}]); using ${defaultValue}.`,
		);
		return defaultValue;
	}
	return n;
}

interface UploadResults {
	timestamp: string;
	bucket: string;
	publicUrl: string;
	directoryPath: string;
	totalFiles: number;
	totalSizeBytes: number;
	durationMs: number;
	verified: boolean;
	verificationDetails: {
		manifestAccessible: boolean;
		sampleChunkAccessible: boolean;
	};
}

/** Recursively collect all files in a directory. Returns relative paths. */
function walkDirectory(
	dir: string,
	base?: string,
): Array<{ relativePath: string; absolutePath: string; sizeBytes: number }> {
	const root = base ?? dir;
	const files: Array<{ relativePath: string; absolutePath: string; sizeBytes: number }> = [];

	for (const entry of readdirSync(dir)) {
		const fullPath = join(dir, entry);
		const stat = lstatSync(fullPath);
		if (stat.isSymbolicLink()) continue;
		if (stat.isDirectory()) {
			files.push(...walkDirectory(fullPath, root));
		} else if (stat.isFile()) {
			files.push({
				relativePath: relative(root, fullPath),
				absolutePath: fullPath,
				sizeBytes: stat.size,
			});
		}
	}

	return files;
}

/** Infer content-type from file extension. */
function contentType(filePath: string): string {
	const ext = extname(filePath).toLowerCase();
	switch (ext) {
		case '.json':
			return 'application/json';
		case '.br':
			return 'application/octet-stream';
		default:
			return 'application/octet-stream';
	}
}

async function verifyUrl(url: string): Promise<boolean> {
	try {
		// Cache-bust + no-cache so a stale CDN response from a prior
		// version's same-keyed object can't make a misdirected upload
		// pass verification.
		const response = await fetch(`${url}?t=${Date.now()}`, {
			method: 'HEAD',
			signal: AbortSignal.timeout(15_000),
			headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
		});
		return response.ok;
	} catch {
		return false;
	}
}

async function main(): Promise<void> {
	let directoryPath = '';
	let outputPath = 'r2-upload-results.json';

	const args = process.argv.slice(2);
	for (let i = 0; i < args.length; i++) {
		switch (args[i]) {
			case '--directory':
				directoryPath = args[++i];
				break;
			case '--output':
				outputPath = args[++i];
				break;
			default:
				console.error(`Unknown argument: ${args[i]}`);
				console.error('Usage: tsx scripts/upload-to-r2.ts --directory <path> [--output <path>]');
				process.exit(1);
		}
	}

	if (!directoryPath) {
		console.error('Error: --directory is required.');
		process.exit(1);
	}
	if (!existsSync(directoryPath)) {
		console.error(`Error: Directory not found: ${directoryPath}`);
		process.exit(1);
	}

	const cfToken = process.env['CLOUDFLARE_API_TOKEN'];
	const accountId = process.env['CLOUDFLARE_ACCOUNT_ID'];
	const bucket = process.env['R2_BUCKET_NAME'] || 'shadow-atlas';
	const publicUrl = (process.env['R2_PUBLIC_URL'] || 'https://atlas.commons.email').replace(
		/\/$/,
		'',
	);

	if (!cfToken || !accountId) {
		console.error('Missing required environment variables:');
		console.error('  CLOUDFLARE_API_TOKEN  (Account → R2 → Edit)');
		console.error('  CLOUDFLARE_ACCOUNT_ID');
		process.exit(1);
	}

	const cfEnv: WranglerEnv = {
		wranglerBin: resolveWranglerBin(),
		token: cfToken,
		accountId,
	};

	// Versioned prefix for atomic deploys.
	const version = new Date().toISOString().slice(0, 10).replace(/-/g, '');
	const prefix = `v${version}`;

	console.log(`Scanning directory: ${directoryPath}`);
	const files = walkDirectory(directoryPath);
	const totalSize = files.reduce((sum, f) => sum + f.sizeBytes, 0);
	console.log(`  Files: ${files.length}, Total size: ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
	console.log(`  Bucket: ${bucket}`);
	console.log(`  Prefix: ${prefix}/`);
	console.log();

	const concurrency = parseConcurrency(process.env['UPLOAD_CONCURRENCY'], DEFAULT_CONCURRENCY);
	console.log(`  Concurrency: ${concurrency}`);
	console.log();

	// Caller-owned AbortController so a SIGINT/SIGTERM (CI cancel,
	// operator Ctrl-C, runner timeout) propagates into runWithConcurrency
	// → wranglerPutFileAsync, which kills its child. Without this, dying
	// before completion orphans wrangler children that hold
	// CLOUDFLARE_API_TOKEN in env and continue mutating R2.
	const cancelController = new AbortController();
	const onSignal = (sig: NodeJS.Signals) => {
		console.error(`\nReceived ${sig}; aborting in-flight uploads...`);
		cancelController.abort();
	};
	process.once('SIGINT', () => onSignal('SIGINT'));
	process.once('SIGTERM', () => onSignal('SIGTERM'));

	const startTime = Date.now();
	let uploaded = 0;
	let firstFailureKey: string | undefined;
	let firstFailureMessage: string | undefined;

	try {
		await runWithConcurrency(
			files,
			concurrency,
			async (file, _idx, signal) => {
				const key = `${prefix}/${file.relativePath}`;
				const type = contentType(file.relativePath);
				try {
					await wranglerPutFileAsync(bucket, key, file.absolutePath, type, cfEnv, { signal });
					uploaded++;
					if (uploaded % 100 === 0 || uploaded === files.length) {
						const pct = ((uploaded / files.length) * 100).toFixed(0);
						console.log(`  [${pct}%] ${uploaded}/${files.length} files uploaded`);
					}
				} catch (err) {
					if (firstFailureKey === undefined) {
						firstFailureKey = key;
						firstFailureMessage = err instanceof Error ? err.message : String(err);
					}
					throw err;
				}
			},
			{ externalSignal: cancelController.signal },
		);
	} catch {
		console.error(`\nFAILED: ${firstFailureKey ?? '<cancelled>'} — ${firstFailureMessage ?? 'aborted'}`);
		console.error('Aborting — partial upload is not safe. Re-run after addressing the cause.');
		process.exit(1);
	}

	const durationMs = Date.now() - startTime;
	console.log();
	console.log(`Upload complete: ${uploaded} files in ${(durationMs / 1000).toFixed(1)}s`);

	// Legacy invariant: in serial mode this branch was reachable when a
	// few files failed but the loop continued. The runWithConcurrency
	// helper short-circuits on first failure, so this is now unreachable —
	// kept as a defensive belt-and-suspenders guard.
	if (uploaded !== files.length) {
		console.error(
			`Upload count mismatch: uploaded=${uploaded} expected=${files.length}. Aborting.`,
		);
		process.exit(1);
	}

	const versionedPublicUrl = `${publicUrl}/${prefix}`;

	console.log(`\nVerifying via public URL: ${versionedPublicUrl}`);
	const manifestOk = await verifyUrl(`${versionedPublicUrl}/US/manifest.json`);
	console.log(`  US/manifest.json: ${manifestOk ? 'OK' : 'FAILED'}`);

	const sampleChunkOk = await verifyUrl(`${versionedPublicUrl}/US/district-index.json`);
	console.log(`  US/district-index.json: ${sampleChunkOk ? 'OK' : 'FAILED'}`);

	const verified = manifestOk && sampleChunkOk;

	const results: UploadResults = {
		timestamp: new Date().toISOString(),
		bucket,
		publicUrl: versionedPublicUrl,
		directoryPath,
		totalFiles: uploaded,
		totalSizeBytes: totalSize,
		durationMs,
		verified,
		verificationDetails: {
			manifestAccessible: manifestOk,
			sampleChunkAccessible: sampleChunkOk,
		},
	};

	writeFileSync(outputPath, JSON.stringify(results, null, 2) + '\n');
	console.log(`\nResults written to: ${outputPath}`);

	if (!verified) {
		console.error(
			'\nVerification FAILED. R2 upload may have succeeded but public access is not working.',
		);
		console.error('Check custom domain configuration and retry.');
		process.exit(1);
	}

	console.log(`\nATLAS_BASE_URL for push-cids: ${versionedPublicUrl}`);
}

main().catch((err) => {
	console.error('Fatal error:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});
