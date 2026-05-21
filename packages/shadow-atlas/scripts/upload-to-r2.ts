#!/usr/bin/env tsx
/**
 * Upload Shadow Atlas Artifacts to Cloudflare R2
 *
 * Uploads the validated build output directory to an R2 bucket,
 * preserving the directory structure for path-based HTTP access.
 *
 * Uploads use R2's S3-compatible endpoint with the same access key pair
 * used by the quarterly workflow's source downloads. The previous
 * Wrangler bearer-token path was brittle for CI bulk uploads: it spawned
 * one Wrangler process per object and failed when CLOUDFLARE_API_TOKEN
 * was not an R2-edit token.
 *
 * Usage:
 *   tsx scripts/upload-to-r2.ts --directory <path> [--output <path>] [--prefix <prefix>]
 *
 * Environment Variables:
 *   CLOUDFLARE_ACCOUNT_ID - Cloudflare account ID (required)
 *   R2_ACCESS_KEY_ID      - R2 S3-compatible access key (required)
 *   R2_SECRET_ACCESS_KEY  - R2 S3-compatible secret key (required)
 *   R2_BUCKET_NAME        - Default: 'shadow-atlas'
 *   R2_PUBLIC_URL         - Default: 'https://atlas.commons.email'
 *   R2_PREFIX             - Optional object prefix, otherwise UTC date
 *
 * Outputs:
 *   r2-upload-results.json - Upload metadata and verification results
 */

import { createReadStream } from 'node:fs';
import { readdirSync, lstatSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import https from 'node:https';

import { runWithConcurrency } from './_wrangler-r2.js';

/**
 * Concurrent wrangler subprocesses. Each pool slot spawns a wrangler
 * child; with 16 in flight, ~2,196 small files clear in seconds rather
 * than the ~36 min of cumulative startup overhead serial mode would
 * take. Tunable via UPLOAD_CONCURRENCY env var.
 */
const DEFAULT_CONCURRENCY = 16;
const MAX_USER_CONCURRENCY = 64;
const S3_PART_SIZE_BYTES = 16 * 1024 * 1024;
const S3_PART_CONCURRENCY = 2;

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
		s3ObjectsVerified: number;
		s3BytesVerified: number;
		manifestAccessible: boolean;
		districtIndexAccessible: boolean;
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

function defaultDatePrefix(): string {
	const version = new Date().toISOString().slice(0, 10).replace(/-/g, '');
	return `v${version}`;
}

function normalizePrefix(prefix: string): string {
	const clean = prefix.replace(/^\/+|\/+$/g, '');
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(clean)) {
		console.error(
			`Error: invalid R2 prefix "${prefix}". Use a simple version tag such as v20260521.`,
		);
		process.exit(1);
	}
	return clean;
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

interface S3UploadEnv {
	readonly accountId: string;
	readonly accessKeyId: string;
	readonly secretAccessKey: string;
}

async function createS3Client(env: S3UploadEnv) {
	const { S3Client } = await import('@aws-sdk/client-s3');
	const { NodeHttpHandler } = await import('@smithy/node-http-handler');

	return new S3Client({
		region: 'auto',
		endpoint: `https://${env.accountId}.r2.cloudflarestorage.com`,
		forcePathStyle: true,
		maxAttempts: 10,
		requestHandler: new NodeHttpHandler({
			httpsAgent: new https.Agent({
				family: 4,
				keepAlive: true,
				maxSockets: Math.max(50, DEFAULT_CONCURRENCY * S3_PART_CONCURRENCY),
			}),
			connectionTimeout: 30_000,
			requestTimeout: 0,
		}),
		credentials: {
			accessKeyId: env.accessKeyId,
			secretAccessKey: env.secretAccessKey,
		},
	});
}

async function s3UploadFile(
	client: Awaited<ReturnType<typeof createS3Client>>,
	bucket: string,
	key: string,
	filePath: string,
	contentType: string,
	signal: AbortSignal,
): Promise<void> {
	const { Upload } = await import('@aws-sdk/lib-storage');

	const upload = new Upload({
		client,
		params: {
			Bucket: bucket,
			Key: key,
			Body: createReadStream(filePath),
			ContentType: contentType,
		},
		partSize: S3_PART_SIZE_BYTES,
		queueSize: S3_PART_CONCURRENCY,
	});

	const onAbort = () => {
		void upload.abort();
	};
	signal.addEventListener('abort', onAbort, { once: true });
	try {
		await upload.done();
	} finally {
		signal.removeEventListener('abort', onAbort);
	}
}

async function verifyS3Objects(
	client: Awaited<ReturnType<typeof createS3Client>>,
	bucket: string,
	prefix: string,
	files: Array<{ relativePath: string; absolutePath: string; sizeBytes: number }>,
	concurrency: number,
): Promise<{ verified: number; bytesVerified: number }> {
	const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
	let verified = 0;
	let bytesVerified = 0;
	let firstFailureKey: string | undefined;
	let firstFailureMessage: string | undefined;

	try {
		await runWithConcurrency(
			files,
			concurrency,
			async (file, _idx, signal) => {
				const key = `${prefix}/${file.relativePath}`;
				try {
					const head = await client.send(
						new HeadObjectCommand({ Bucket: bucket, Key: key }),
						{ abortSignal: signal },
					);
					if (head.ContentLength !== file.sizeBytes) {
						throw new Error(
							`size mismatch: expected ${file.sizeBytes}, got ${head.ContentLength ?? '<missing>'}`,
						);
					}
					verified++;
					bytesVerified += file.sizeBytes;
					if (verified % 250 === 0 || verified === files.length) {
						const pct = files.length === 0 ? '100' : ((verified / files.length) * 100).toFixed(0);
						console.log(`  [${pct}%] ${verified}/${files.length} objects verified`);
					}
				} catch (err) {
					if (firstFailureKey === undefined) {
						firstFailureKey = key;
						firstFailureMessage = err instanceof Error ? err.message : String(err);
					}
					throw err;
				}
			},
		);
	} catch {
		throw new Error(`${firstFailureKey ?? '<unknown>'} — ${firstFailureMessage ?? 'verification failed'}`);
	}

	return { verified, bytesVerified };
}

async function main(): Promise<void> {
	let directoryPath = '';
	let outputPath = 'r2-upload-results.json';
	let prefixArg = process.env['R2_PREFIX'] || '';

	const args = process.argv.slice(2);
	for (let i = 0; i < args.length; i++) {
		switch (args[i]) {
			case '--directory':
				directoryPath = args[++i];
				break;
			case '--output':
				outputPath = args[++i];
				break;
			case '--prefix':
				prefixArg = args[++i];
				break;
			default:
				console.error(`Unknown argument: ${args[i]}`);
				console.error(
					'Usage: tsx scripts/upload-to-r2.ts --directory <path> [--output <path>] [--prefix <prefix>]',
				);
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

	const accountId = process.env['CLOUDFLARE_ACCOUNT_ID'];
	const accessKeyId = process.env['R2_ACCESS_KEY_ID'] || process.env['AWS_ACCESS_KEY_ID'];
	const secretAccessKey = process.env['R2_SECRET_ACCESS_KEY'] || process.env['AWS_SECRET_ACCESS_KEY'];
	const bucket = process.env['R2_BUCKET_NAME'] || 'shadow-atlas';
	const publicUrl = (process.env['R2_PUBLIC_URL'] || 'https://atlas.commons.email').replace(
		/\/$/,
		'',
	);

	if (!accountId || !accessKeyId || !secretAccessKey) {
		console.error('Missing required environment variables:');
		console.error('  CLOUDFLARE_ACCOUNT_ID');
		console.error('  R2_ACCESS_KEY_ID or AWS_ACCESS_KEY_ID');
		console.error('  R2_SECRET_ACCESS_KEY or AWS_SECRET_ACCESS_KEY');
		process.exit(1);
	}

	const s3Env: S3UploadEnv = {
		accountId,
		accessKeyId,
		secretAccessKey,
	};

	const prefix = normalizePrefix(prefixArg || defaultDatePrefix());

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
	// and aborts in-flight S3 uploads instead of continuing to mutate R2
	// after the coordinator has already failed.
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
	const s3Client = await createS3Client(s3Env);

	try {
		await runWithConcurrency(
			files,
			concurrency,
			async (file, _idx, signal) => {
				const key = `${prefix}/${file.relativePath}`;
				const type = contentType(file.relativePath);
					try {
						await s3UploadFile(
							s3Client,
							bucket,
							key,
							file.absolutePath,
							type,
							signal,
						);
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
		s3Client.destroy();
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

	console.log(`\nVerifying uploaded objects through R2 S3 API...`);
	let s3Verified = 0;
	let s3BytesVerified = 0;
	try {
		const s3Verification = await verifyS3Objects(s3Client, bucket, prefix, files, concurrency);
		s3Verified = s3Verification.verified;
		s3BytesVerified = s3Verification.bytesVerified;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`\nS3 verification FAILED: ${msg}`);
		s3Client.destroy();
		process.exit(1);
	} finally {
		s3Client.destroy();
	}

	console.log(`\nVerifying via public URL: ${versionedPublicUrl}`);
	const manifestOk = await verifyUrl(`${versionedPublicUrl}/US/manifest.json`);
	console.log(`  US/manifest.json: ${manifestOk ? 'OK' : 'FAILED'}`);

	const districtIndexOk = await verifyUrl(`${versionedPublicUrl}/US/district-index.json`);
	console.log(`  US/district-index.json: ${districtIndexOk ? 'OK' : 'FAILED'}`);

	const verified = s3Verified === files.length && manifestOk && districtIndexOk;

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
			s3ObjectsVerified: s3Verified,
			s3BytesVerified,
			manifestAccessible: manifestOk,
			districtIndexAccessible: districtIndexOk,
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
