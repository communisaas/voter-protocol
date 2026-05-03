/**
 * S3-compat batch upload to R2 for many small files (bundle artifacts).
 *
 * Different mode from _s3-multipart.ts: that file streams ONE multi-GB
 * object via lib-storage Upload. This file uploads MANY small objects
 * (the per-district .geojson + index.json files) in parallel via plain
 * PutObject calls. Same SigV4 endpoint, same credential pair.
 *
 * Why batch via S3 instead of wrangler subprocess: extracting district
 * bundles produces ~10,500 files (cd + sldu + sldl + county across the
 * US). At ~1.5 sec per wrangler subprocess invocation, that would be
 * ~4 hours of dead startup time per quarterly publish. Persistent HTTP
 * connections + parallelism cut it to 2-5 minutes.
 *
 * Best-effort delete (used by publish-source.ts on rollback) batches up
 * to 1,000 keys per DeleteObjects call, which is the S3/R2 max.
 */

import { readdirSync, statSync, createReadStream } from 'node:fs';
import { join, relative, posix as posixPath } from 'node:path';

import type { S3MultipartEnv } from './_s3-multipart.js';

export type S3BatchEnv = S3MultipartEnv;

/**
 * Walk a directory recursively, returning relative POSIX paths (so the
 * R2 key is derived deterministically across OSes).
 */
function walkDir(root: string): string[] {
	const out: string[] = [];
	const stack: string[] = [root];
	while (stack.length > 0) {
		const dir = stack.pop()!;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const abs = join(dir, entry.name);
			if (entry.isDirectory()) stack.push(abs);
			else if (entry.isFile()) out.push(abs);
		}
	}
	return out.map((abs) => posixPath.normalize(relative(root, abs).split(/[\\/]/).join('/')));
}

interface BatchPutOptions {
	bucket: string;
	keyPrefix: string;
	localDir: string;
	contentTypeFor: (relPath: string) => string;
	env: S3BatchEnv;
	concurrency?: number;
	progress?: (uploaded: number, total: number) => void;
}

/**
 * Upload every regular file under `localDir` to R2 at
 *   <bucket>/<keyPrefix>/<relativePath-as-posix>
 *
 * Returns the list of R2 keys that were written (so the caller can
 * track them for rollback).
 */
export async function s3BatchPutDir(opts: BatchPutOptions): Promise<string[]> {
	const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');

	const endpoint = `https://${opts.env.accountId}.r2.cloudflarestorage.com`;
	const client = new S3Client({
		region: 'auto',
		endpoint,
		credentials: {
			accessKeyId: opts.env.accessKeyId,
			secretAccessKey: opts.env.secretAccessKey,
		},
	});

	const relPaths = walkDir(opts.localDir);
	const total = relPaths.length;
	if (total === 0) {
		client.destroy();
		return [];
	}

	const concurrency = Math.max(1, Math.min(64, opts.progress ? (opts.concurrency ?? 32) : (opts.concurrency ?? 32)));
	const writtenKeys: string[] = [];
	let inFlight = 0;
	let cursor = 0;
	let firstError: Error | null = null;
	let uploaded = 0;

	const progressFor = opts.progress;

	await new Promise<void>((resolve) => {
		const launch = () => {
			while (inFlight < concurrency && cursor < relPaths.length && !firstError) {
				const relPath = relPaths[cursor++];
				const key = `${opts.keyPrefix}/${relPath}`;
				const localFile = join(opts.localDir, relPath);
				const size = statSync(localFile).size;
				inFlight++;

				client
					.send(
						new PutObjectCommand({
							Bucket: opts.bucket,
							Key: key,
							Body: createReadStream(localFile),
							ContentType: opts.contentTypeFor(relPath),
							ContentLength: size,
						}),
					)
					.then(() => {
						writtenKeys.push(key);
						uploaded++;
						if (progressFor) progressFor(uploaded, total);
					})
					.catch((err: unknown) => {
						if (!firstError) {
							firstError = err instanceof Error ? err : new Error(String(err));
						}
					})
					.finally(() => {
						inFlight--;
						if (cursor >= relPaths.length && inFlight === 0) {
							resolve();
						} else {
							launch();
						}
					});
			}
		};
		launch();
	});

	client.destroy();

	if (firstError) {
		throw new Error(`S3 batch upload failed (uploaded ${writtenKeys.length}/${total}): ${firstError.message}`);
	}

	return writtenKeys.sort();
}

/**
 * Best-effort delete of many R2 keys via DeleteObjects (1,000 per call).
 * Doesn't throw on individual failures — the caller is doing rollback
 * cleanup and partial success is still useful.
 *
 * Returns specific failed keys (capped to first 100 to bound stderr noise)
 * so the operator can take targeted manual action without re-running the
 * entire pipeline.
 */
export async function s3BatchDelete(
	bucket: string,
	keys: string[],
	env: S3BatchEnv,
): Promise<{ deleted: number; failed: number; failedKeys: string[] }> {
	if (keys.length === 0) return { deleted: 0, failed: 0, failedKeys: [] };

	const { S3Client, DeleteObjectsCommand } = await import('@aws-sdk/client-s3');
	const endpoint = `https://${env.accountId}.r2.cloudflarestorage.com`;
	const client = new S3Client({
		region: 'auto',
		endpoint,
		credentials: {
			accessKeyId: env.accessKeyId,
			secretAccessKey: env.secretAccessKey,
		},
	});

	let deleted = 0;
	let failed = 0;
	const failedKeys: string[] = [];
	const FAILED_LOG_CAP = 100;

	try {
		for (let i = 0; i < keys.length; i += 1000) {
			const slice = keys.slice(i, i + 1000);
			try {
				const result = await client.send(
					new DeleteObjectsCommand({
						// Quiet: false so the response includes Errors[] with specific keys.
						// (Quiet: true elides successful deletes but also drops error detail
						// in some R2 versions; Errors[] population is what we want.)
						Bucket: bucket,
						Delete: { Objects: slice.map((Key) => ({ Key })), Quiet: false },
					}),
				);
				const errors = result.Errors ?? [];
				deleted += slice.length - errors.length;
				failed += errors.length;
				for (const e of errors) {
					if (failedKeys.length < FAILED_LOG_CAP && e.Key) {
						failedKeys.push(e.Key);
					}
				}
			} catch {
				// Whole-batch failure: we know the keys, can't pinpoint per-key cause.
				failed += slice.length;
				for (const k of slice) {
					if (failedKeys.length < FAILED_LOG_CAP) failedKeys.push(k);
				}
			}
		}
	} finally {
		client.destroy();
	}
	return { deleted, failed, failedKeys };
}
