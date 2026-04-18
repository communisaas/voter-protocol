#!/usr/bin/env tsx
/**
 * Upload Shadow Atlas Artifacts to Cloudflare R2
 *
 * Uploads the validated build output directory to an R2 bucket,
 * preserving the directory structure for path-based HTTP access.
 *
 * R2 is the primary production read path for the commons content store.
 * IPFS pinning is a separate, optional step for content-addressed verification.
 *
 * Usage:
 *   tsx scripts/upload-to-r2.ts --directory <path> [--output <path>]
 *
 * Examples:
 *   tsx scripts/upload-to-r2.ts --directory output/chunked/ --output output/r2-upload-results.json
 *
 * Environment Variables:
 *   R2_ACCOUNT_ID       - Cloudflare account ID (required)
 *   R2_ACCESS_KEY_ID    - R2 S3-compatible API key (required)
 *   R2_SECRET_ACCESS_KEY - R2 S3-compatible secret (required)
 *   R2_BUCKET_NAME      - Bucket name (default: 'shadow-atlas')
 *   R2_PUBLIC_URL       - Public base URL for verification (default: 'https://atlas.commons.email')
 *
 * Outputs:
 *   r2-upload-results.json - Upload metadata and verification results
 */

import { readdirSync, lstatSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// File Discovery
// ---------------------------------------------------------------------------

/** Recursively collect all files in a directory. Returns relative paths. */
function walkDirectory(dir: string, base?: string): Array<{ relativePath: string; absolutePath: string; sizeBytes: number }> {
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
		case '.json': return 'application/json';
		case '.br': return 'application/octet-stream';
		default: return 'application/octet-stream';
	}
}

// ---------------------------------------------------------------------------
// R2 Upload via S3-Compatible API
// ---------------------------------------------------------------------------

/**
 * Upload a single file to R2 using the S3-compatible PutObject API.
 * Uses raw fetch with AWS Signature V4 — no SDK dependency.
 */
async function putObject(
	endpoint: string,
	bucket: string,
	key: string,
	body: Buffer,
	type: string,
	accessKeyId: string,
	secretAccessKey: string,
): Promise<void> {
	// Use the S3-compatible endpoint directly via fetch.
	// For simplicity, we shell out to a lightweight S3 put — the R2 S3 API
	// is fully compatible. In CI, `aws s3 cp` or `wrangler r2 object put` works.
	//
	// Here we use the Cloudflare R2 API directly via fetch for zero-dependency uploads.
	const url = `${endpoint}/${bucket}/${key}`;
	const now = new Date();
	const dateStamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 8);
	const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

	// For R2, we use the simple unsigned payload approach with the S3-compatible auth.
	// The @aws-sdk/client-s3 handles signing properly; this script is intended
	// to be called from CI where `aws s3 sync` or `wrangler r2 object put` is available.
	// When run directly, install @aws-sdk/client-s3 as a dev dependency.

	// Deferred: use dynamic import to keep this script zero-dependency by default.
	const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');

	const client = new S3Client({
		region: 'auto',
		endpoint,
		credentials: {
			accessKeyId,
			secretAccessKey,
		},
	});

	await client.send(new PutObjectCommand({
		Bucket: bucket,
		Key: key,
		Body: body,
		ContentType: type,
	}));
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

async function verifyUrl(url: string): Promise<boolean> {
	try {
		const response = await fetch(url, {
			method: 'HEAD',
			signal: AbortSignal.timeout(15_000),
		});
		return response.ok;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	// Parse arguments
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

	// Validate environment
	const accountId = process.env['R2_ACCOUNT_ID'] || process.env['CLOUDFLARE_ACCOUNT_ID'];
	const accessKeyId = process.env['R2_ACCESS_KEY_ID'];
	const secretAccessKey = process.env['R2_SECRET_ACCESS_KEY'];
	const bucket = process.env['R2_BUCKET_NAME'] || 'shadow-atlas';
	const publicUrl = (process.env['R2_PUBLIC_URL'] || 'https://atlas.commons.email').replace(/\/$/, '');

	if (!accountId || !accessKeyId || !secretAccessKey) {
		console.error('Missing required environment variables:');
		console.error('  R2_ACCOUNT_ID (or CLOUDFLARE_ACCOUNT_ID)');
		console.error('  R2_ACCESS_KEY_ID');
		console.error('  R2_SECRET_ACCESS_KEY');
		console.error('\nCreate R2 API tokens at: Cloudflare Dashboard > R2 > Manage R2 API Tokens');
		process.exit(1);
	}

	const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;

	// Versioned prefix for atomic deploys.
	// Upload to a dated prefix, then update ATLAS_BASE_URL to point to it.
	// Old prefixes remain in the bucket (no inconsistency window).
	const version = new Date().toISOString().slice(0, 10).replace(/-/g, '');
	const prefix = `v${version}`;

	// Discover files
	console.log(`Scanning directory: ${directoryPath}`);
	const files = walkDirectory(directoryPath);
	const totalSize = files.reduce((sum, f) => sum + f.sizeBytes, 0);
	console.log(`  Files: ${files.length}, Total size: ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
	console.log(`  Bucket: ${bucket}`);
	console.log(`  Prefix: ${prefix}/`);
	console.log(`  Endpoint: ${endpoint}`);
	console.log();

	// Upload all files under versioned prefix
	const startTime = Date.now();
	let uploaded = 0;
	let failed = 0;

	for (const file of files) {
		const key = `${prefix}/${file.relativePath}`;
		const type = contentType(file.relativePath);

		try {
			const body = readFileSync(file.absolutePath);
			await putObject(endpoint, bucket, key, body, type, accessKeyId, secretAccessKey);
			uploaded++;

			if (uploaded % 100 === 0 || uploaded === files.length) {
				const pct = ((uploaded / files.length) * 100).toFixed(0);
				console.log(`  [${pct}%] ${uploaded}/${files.length} files uploaded`);
			}
		} catch (err) {
			failed++;
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`  FAILED: ${key} — ${msg}`);
			if (failed > 10) {
				console.error('Too many failures, aborting.');
				process.exit(1);
			}
		}
	}

	const durationMs = Date.now() - startTime;
	console.log();
	console.log(`Upload complete: ${uploaded} files in ${(durationMs / 1000).toFixed(1)}s`);

	// Completeness check: all files must succeed
	if (failed > 0) {
		console.error(`${failed} files failed. Aborting — partial upload is not safe.`);
		process.exit(1);
	}

	// The public URL for this version includes the prefix
	const versionedPublicUrl = `${publicUrl}/${prefix}`;

	// Verify via public URL
	console.log(`\nVerifying via public URL: ${versionedPublicUrl}`);
	const manifestOk = await verifyUrl(`${versionedPublicUrl}/US/manifest.json`);
	console.log(`  US/manifest.json: ${manifestOk ? 'OK' : 'FAILED'}`);

	const sampleChunkOk = await verifyUrl(`${versionedPublicUrl}/US/district-index.json`);
	console.log(`  US/district-index.json: ${sampleChunkOk ? 'OK' : 'FAILED'}`);

	const verified = manifestOk && sampleChunkOk;

	// Write results
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
		console.error('\nVerification FAILED. R2 upload may have succeeded but public access is not working.');
		console.error('Check custom domain configuration and retry.');
		process.exit(1);
	}

	console.log(`\nATLAS_BASE_URL for push-cids: ${versionedPublicUrl}`);
}

main().catch((err) => {
	console.error('Fatal error:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});
