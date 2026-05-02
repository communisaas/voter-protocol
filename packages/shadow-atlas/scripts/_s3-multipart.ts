/**
 * S3-compatible multipart upload to R2 for files >300 MiB.
 *
 * Wrangler's `r2 object put` has a hard 300 MiB cap (single-shot only,
 * no multipart subcommand) and Cloudflare's native R2 API exposes no
 * multipart endpoints. The S3-compatible endpoint at
 * `<account>.r2.cloudflarestorage.com` is the only path for multi-GB
 * uploads. It REQUIRES AWS Signature V4 — Bearer-token auth on the
 * S3-compat endpoint is not supported. This file is therefore
 * deliberately scoped to the .db artifacts and isolates the
 * AKID/secret from the rest of the publish path.
 *
 * Two-credential model (post-300MiB-discovery 2026-05-02):
 *   - CLOUDFLARE_API_TOKEN (cfat_): wrangler r2 ops <300 MiB +
 *     Pages env updates. Single-token model still applies for
 *     officials.db (~1 MB), sidecars, manifest, and signature.
 *   - R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY: S3-compat AWS SigV4
 *     auth ONLY for shadow-atlas-full.db (3.6 GB) multipart upload.
 *     Scope is an unfortunate consequence of platform limits, not
 *     a security regression — these creds are at the same trust
 *     tier as the cfat_ token.
 */

import { createReadStream } from 'node:fs';
import { statSync } from 'node:fs';

export interface S3MultipartEnv {
	readonly accountId: string;
	readonly accessKeyId: string;
	readonly secretAccessKey: string;
	/** S3-compat client lazily imports @aws-sdk/client-s3 + lib-storage. */
}

/**
 * Multipart parameters tuned for our workload (single 3.6 GB SQLite,
 * occasional smaller .db files). Explicit values, not SDK defaults, so
 * a future SDK upgrade can't quietly change part sizing under us.
 *
 *   partSize 16 MiB × queueSize 4 → ~64 MiB in flight. R2 multipart
 *   inherits S3 limits: 5 MiB min part, 10k parts max. 16 MiB parts let
 *   a 5 GiB object fit in ~320 parts (well under the 10k cap) and reduce
 *   round-trip overhead vs the 5 MiB SDK default.
 */
const PART_SIZE_BYTES = 16 * 1024 * 1024;
const PART_CONCURRENCY = 4;

/**
 * Stream a file to R2 via S3-compatible multipart upload. Resolves on
 * complete, throws on any failure. The AWS SDK handles part chunking,
 * concurrent part uploads, and per-part retries internally.
 *
 * Abort handling: registers SIGINT/SIGTERM listeners that call
 * upload.abort(), which sends an AbortMultipartUpload to R2 so the
 * staged parts don't sit unbilled-cleanup until the bucket lifecycle
 * rule (#45) sweeps them. Listeners are removed on completion (success
 * OR failure) so we don't leak handlers across multiple uploads.
 */
export async function s3MultipartUpload(
	bucket: string,
	key: string,
	filePath: string,
	contentType: string,
	env: S3MultipartEnv,
): Promise<void> {
	const { S3Client } = await import('@aws-sdk/client-s3');
	const { Upload } = await import('@aws-sdk/lib-storage');

	const endpoint = `https://${env.accountId}.r2.cloudflarestorage.com`;
	const client = new S3Client({
		region: 'auto',
		endpoint,
		credentials: {
			accessKeyId: env.accessKeyId,
			secretAccessKey: env.secretAccessKey,
		},
	});

	const sizeBytes = statSync(filePath).size;
	const upload = new Upload({
		client,
		params: {
			Bucket: bucket,
			Key: key,
			Body: createReadStream(filePath),
			ContentType: contentType,
		},
		partSize: PART_SIZE_BYTES,
		queueSize: PART_CONCURRENCY,
	});

	// Inline progress redraw on TTY (one rewriting line); emit one log
	// line per ~5% on non-TTY (CI) so the build log stays tailable
	// without thousands of \r-corrupted entries.
	const interactive = process.stderr.isTTY === true;
	let lastReportedDecile = -1;
	upload.on('httpUploadProgress', (progress) => {
		const loaded = progress.loaded ?? 0;
		const total = progress.total ?? sizeBytes;
		const pct = total > 0 ? (loaded / total) * 100 : 0;
		if (interactive) {
			process.stderr.write(
				`\r    ${(loaded / 1024 / 1024).toFixed(0)} / ${(total / 1024 / 1024).toFixed(0)} MB  (${pct.toFixed(1)}%)        `,
			);
			return;
		}
		const decile = Math.floor(pct / 5);
		if (decile > lastReportedDecile) {
			lastReportedDecile = decile;
			process.stderr.write(
				`    ${(loaded / 1024 / 1024).toFixed(0)} / ${(total / 1024 / 1024).toFixed(0)} MB (${pct.toFixed(0)}%)\n`,
			);
		}
	});

	// Abort the multipart on Ctrl-C / SIGTERM so staged parts don't
	// hang around. The Upload.abort() promise rejects upload.done()
	// on the way out, which our catch below converts to an Error.
	const abortHandler = (signal: NodeJS.Signals) => {
		process.stderr.write(`\n  Aborting multipart upload (${signal})...\n`);
		void upload.abort();
	};
	process.on('SIGINT', abortHandler);
	process.on('SIGTERM', abortHandler);

	try {
		await upload.done();
		if (interactive) process.stderr.write('\n');
	} catch (err) {
		if (interactive) process.stderr.write('\n');
		const m = err instanceof Error ? err.message : String(err);
		throw new Error(`S3 multipart upload failed for ${key}: ${m}`);
	} finally {
		process.off('SIGINT', abortHandler);
		process.off('SIGTERM', abortHandler);
		client.destroy();
	}
}
