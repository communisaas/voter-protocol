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

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative, posix as posixPath } from 'node:path';
import https from 'node:https';

// IPv4-only Agent — same rationale as _s3-multipart.ts. The SDK's
// default NodeHttpHandler builds its own https.Agent and would ignore
// our `https.globalAgent.options.family = 4` set at the entry point.
const IPV4_HTTPS_AGENT = new https.Agent({
	family: 4,
	keepAlive: true,
	maxSockets: 50,
});

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
	const { NodeHttpHandler } = await import('@smithy/node-http-handler');

	const endpoint = `https://${opts.env.accountId}.r2.cloudflarestorage.com`;
	const client = new S3Client({
		region: 'auto',
		endpoint,
		forcePathStyle: true,
		// Layered with the per-file backoff retry below: SDK retries handle
		// fast 5xx/4xx + short network hiccups; our outer wrapper handles
		// multi-second DNS outages that exhaust the SDK budget.
		maxAttempts: 6,
		requestHandler: new NodeHttpHandler({
			httpsAgent: IPV4_HTTPS_AGENT,
			connectionTimeout: 30_000,
			requestTimeout: 0,
		}),
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

	// Transient codes worth a script-level retry beyond the SDK's own. DNS
	// flaps (ENOTFOUND/EAI_AGAIN) and socket resets last seconds to minutes
	// — longer than the SDK's StandardRetryStrategy budget — but the rest
	// of the batch can succeed once the network heals. Without this layer
	// a 10-second DNS blip kills 10k files of progress.
	const TRANSIENT_CODES = new Set([
		'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET',
		'ECONNREFUSED', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH',
	]);
	const isTransient = (err: unknown): boolean => {
		const e = err as { code?: string; name?: string; cause?: { code?: string } } | null;
		const code = e?.code ?? e?.cause?.code ?? '';
		return TRANSIENT_CODES.has(code);
	};
	const PER_FILE_MAX_ATTEMPTS = 6;
	const PER_FILE_BACKOFF_MS = [1000, 3000, 7000, 15000, 30000]; // capped by attempts

	const putWithRetry = async (key: string, body: Buffer, contentType: string, size: number): Promise<void> => {
		let lastErr: unknown;
		for (let attempt = 0; attempt < PER_FILE_MAX_ATTEMPTS; attempt++) {
			try {
				await client.send(new PutObjectCommand({
					Bucket: opts.bucket,
					Key: key,
					Body: body,
					ContentType: contentType,
					ContentLength: size,
				}));
				return;
			} catch (err) {
				lastErr = err;
				if (!isTransient(err) || attempt === PER_FILE_MAX_ATTEMPTS - 1) throw err;
				const wait = PER_FILE_BACKOFF_MS[attempt] ?? 30000;
				await new Promise((r) => setTimeout(r, wait));
			}
		}
		throw lastErr;
	};

	await new Promise<void>((resolve) => {
		const launch = () => {
			while (inFlight < concurrency && cursor < relPaths.length && !firstError) {
				const relPath = relPaths[cursor++];
				const key = `${opts.keyPrefix}/${relPath}`;
				const localFile = join(opts.localDir, relPath);
				const size = statSync(localFile).size;
				inFlight++;

				// Buffer the file body so the SDK's StandardRetryStrategy can
				// actually retry on transient failures. createReadStream gets
				// consumed on the first send attempt, which makes any retry
				// surface as "non-retryable streaming request" — a single
				// flaky packet ~10% into the batch kills the whole publish.
				// Bundle files are tiny (geojson chunks, ~10–500 KB each),
				// so buffering them costs at most a few MB resident at peak
				// concurrency.
				const body = readFileSync(localFile);
				putWithRetry(key, body, opts.contentTypeFor(relPath), size)
					.then(() => {
						writtenKeys.push(key);
						uploaded++;
						if (progressFor) progressFor(uploaded, total);
					})
					.catch((err: unknown) => {
						if (!firstError) {
							const e = err instanceof Error ? err : new Error(String(err));
							const named = e as Error & { name?: string; code?: string; $metadata?: { httpStatusCode?: number } };
							const detail = [
								`key=${key}`,
								named.name && `name=${named.name}`,
								named.code && `code=${named.code}`,
								named.$metadata?.httpStatusCode && `http=${named.$metadata.httpStatusCode}`,
							].filter(Boolean).join(' ');
							process.stderr.write(`\n    [s3-batch] first error after ${PER_FILE_MAX_ATTEMPTS} attempts: ${e.message} | ${detail}\n`);
							firstError = e;
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
	const { NodeHttpHandler } = await import('@smithy/node-http-handler');
	const endpoint = `https://${env.accountId}.r2.cloudflarestorage.com`;
	const client = new S3Client({
		region: 'auto',
		endpoint,
		forcePathStyle: true,
		requestHandler: new NodeHttpHandler({
			httpsAgent: IPV4_HTTPS_AGENT,
			connectionTimeout: 30_000,
			requestTimeout: 0,
		}),
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
