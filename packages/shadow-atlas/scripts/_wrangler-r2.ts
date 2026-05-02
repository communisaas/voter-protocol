/**
 * Internal wrangler helper for R2 uploads / deletes.
 *
 * Both publish-source.ts and upload-to-r2.ts drive `wrangler r2 object`
 * subcommands. The hardening (--remote assertion, env allowlist,
 * timeout, stderr capture, no-npx invocation, content-type passthrough)
 * is identical between them. Extracted so the brutalist findings stay
 * fixed on both call sites in lockstep, rather than drifting per file.
 *
 * Single-token model: every call authenticates via CLOUDFLARE_API_TOKEN
 * + CLOUDFLARE_ACCOUNT_ID. No S3-compatible AKID/secret is touched.
 */

import { execFileSync, spawn, type ExecFileSyncOptions } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

/**
 * Hoisted to a const so a future edit/refactor can't silently drop it.
 * Without --remote, wrangler writes to local miniflare emulation and
 * exits 0; the verification layer alone wouldn't catch a misdirected
 * run. Every wrangler invocation in this module asserts the flag is
 * present in argv before spawning.
 */
export const REMOTE_FLAG = '--remote';

/** Default subprocess timeout for small uploads (sidecars, manifest, chunks). */
export const SHORT_UPLOAD_TIMEOUT_MS = 5 * 60_000;
/** Subprocess timeout for the multi-GB SQLite upload. */
export const LONG_UPLOAD_TIMEOUT_MS = 60 * 60_000;
/** Stderr buffer cap so wrangler error output doesn't truncate. */
export const STDERR_BUFFER = 10 * 1024 * 1024;

export interface WranglerEnv {
	readonly wranglerBin: string;
	readonly token: string;
	readonly accountId: string;
}

const requireFromHere = createRequire(import.meta.url);

/**
 * Resolve the wrangler bin once at startup. Skips per-invocation `npx`
 * resolution overhead and pins the version we use to the one in
 * node_modules — controlled via package.json — rather than whatever
 * `npx` happens to resolve on each call.
 */
export function resolveWranglerBin(): string {
	try {
		const pkgPath = requireFromHere.resolve('wrangler/package.json');
		const pkg = requireFromHere(pkgPath) as { bin?: string | Record<string, string> };
		const binEntry = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.['wrangler'];
		if (!binEntry) throw new Error('wrangler package has no bin entry');
		return resolve(dirname(pkgPath), binEntry);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(`Could not resolve wrangler bin: ${msg}. Install with: npm i -D wrangler`);
	}
}

/**
 * Allowlisted env handed to wrangler. We do NOT spread process.env
 * because wrangler's transitive deps (and any grandchild process they
 * fork) would otherwise inherit unrelated secrets. WRANGLER_SEND_METRICS
 * suppresses the analytics fork that would inherit the same env.
 */
function buildEnv(env: WranglerEnv): NodeJS.ProcessEnv {
	return {
		PATH: process.env.PATH,
		HOME: process.env.HOME,
		USERPROFILE: process.env.USERPROFILE,
		CLOUDFLARE_API_TOKEN: env.token,
		CLOUDFLARE_ACCOUNT_ID: env.accountId,
		WRANGLER_SEND_METRICS: 'false',
	};
}

function assertRemote(args: readonly string[]): void {
	if (!args.includes(REMOTE_FLAG)) {
		throw new Error(
			`Refusing to invoke wrangler without ${REMOTE_FLAG} — would write to local miniflare and exit 0`,
		);
	}
}

/** Stringify subprocess errors so the operator sees stderr, not just "Command failed". */
export function describeExecError(err: unknown): string {
	const e = err as { message?: string; stderr?: Buffer | string; stdout?: Buffer | string };
	const stderr = e.stderr ? e.stderr.toString() : '';
	const stdout = e.stdout ? e.stdout.toString() : '';
	const tail = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n').slice(-2000);
	const head = e.message ?? String(err);
	return tail ? `${head}\n${tail}` : head;
}

/**
 * Wrangler-driven R2 PUT. Returns when the upload completes; throws on
 * non-zero exit (with stderr surfaced in the message). Wrangler
 * internally handles arbitrary file sizes — single PUT for small,
 * multipart for large — using the CLOUDFLARE_API_TOKEN we hand it.
 */
export function wranglerPutFile(
	bucket: string,
	key: string,
	filePath: string,
	contentType: string,
	env: WranglerEnv,
	timeoutMs: number = SHORT_UPLOAD_TIMEOUT_MS,
): void {
	const args = [
		env.wranglerBin,
		'r2',
		'object',
		'put',
		`${bucket}/${key}`,
		'--file',
		filePath,
		'--content-type',
		contentType,
		REMOTE_FLAG,
	];
	assertRemote(args);
	const opts: ExecFileSyncOptions = {
		stdio: ['ignore', 'inherit', 'pipe'],
		env: buildEnv(env),
		timeout: timeoutMs,
		maxBuffer: STDERR_BUFFER,
	};
	try {
		execFileSync(process.execPath, args, opts);
	} catch (err) {
		throw new Error(`wrangler put ${key} failed:\n${describeExecError(err)}`);
	}
}

/**
 * Wrangler R2 PUT of an in-memory body. Wrangler only accepts --file,
 * so we materialize to a tmpfile in the OS tmp dir, upload, then unlink.
 * Used for the manifest JSON and the .sha256 sidecar text files (both
 * public-by-design — no sensitive data in the tmpfile).
 */
export function wranglerPutBody(
	bucket: string,
	key: string,
	body: string,
	contentType: string,
	env: WranglerEnv,
): void {
	const tmp = join(tmpdir(), `wrangler-r2-${randomBytes(8).toString('hex')}`);
	writeFileSync(tmp, body);
	try {
		wranglerPutFile(bucket, key, tmp, contentType, env);
	} finally {
		try {
			unlinkSync(tmp);
		} catch {
			/* tmpdir cleanup is best-effort */
		}
	}
}

/**
 * Async variant of `wranglerPutFile`. Spawns wrangler as a child
 * process and resolves on exit 0. Used by the upload-to-r2 concurrency
 * pool — ~2,196 sequential subprocesses cost ~36 min of dead startup
 * time per quarterly run; parallelism turns that into seconds.
 *
 * `signal` lets a coordinator abort an in-flight upload. When fired,
 * the wrangler child receives SIGTERM and the returned promise rejects.
 * Without this, a `runWithConcurrency` short-circuit on first failure
 * leaves up to N-1 children continuing to mutate R2 in the background.
 *
 * Stderr is captured to a tail buffer so failures surface with real
 * diagnostic content. The same `--remote` assertion + env allowlist
 * + timeout discipline as the sync helper applies.
 */
export function wranglerPutFileAsync(
	bucket: string,
	key: string,
	filePath: string,
	contentType: string,
	env: WranglerEnv,
	options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<void> {
	const args = [
		env.wranglerBin,
		'r2',
		'object',
		'put',
		`${bucket}/${key}`,
		'--file',
		filePath,
		'--content-type',
		contentType,
		REMOTE_FLAG,
	];
	assertRemote(args);
	const timeoutMs = options.timeoutMs ?? SHORT_UPLOAD_TIMEOUT_MS;
	const signal = options.signal;
	return new Promise((resolvePromise, reject) => {
		if (signal?.aborted) {
			reject(new Error(`wrangler put ${key} aborted before spawn`));
			return;
		}
		const child = spawn(process.execPath, args, {
			stdio: ['ignore', 'pipe', 'pipe'],
			env: buildEnv(env),
			timeout: timeoutMs,
		});
		// Tail of stderr — keep last ~2000 chars so a verbose wrangler
		// stack doesn't OOM the parent on a flapping batch.
		let stderrTail = '';
		child.stderr?.on('data', (chunk: Buffer | string) => {
			stderrTail = (stderrTail + chunk.toString()).slice(-2000);
		});
		// Drain stdout so wrangler can't backpressure-block on a full pipe.
		child.stdout?.on('data', () => {});
		const onAbort = () => {
			// SIGTERM gives wrangler a chance to clean up its multipart
			// upload (Cloudflare R2 supports AbortMultipartUpload). If it
			// doesn't honor SIGTERM within the existing subprocess timeout,
			// node's `timeout` killer escalates to SIGKILL.
			child.kill('SIGTERM');
		};
		signal?.addEventListener('abort', onAbort, { once: true });
		const cleanupSignal = () => signal?.removeEventListener('abort', onAbort);
		child.on('error', (err) => {
			cleanupSignal();
			reject(new Error(`wrangler spawn failed for ${key}: ${err.message}`));
		});
		child.on('exit', (code, exitSignal) => {
			cleanupSignal();
			if (signal?.aborted) {
				reject(new Error(`wrangler put ${key} aborted (signal ${exitSignal ?? 'TERM'})`));
				return;
			}
			if (code === 0) {
				resolvePromise();
			} else {
				const reason = exitSignal ? `signal ${exitSignal}` : `exit ${code ?? '?'}`;
				const tail = stderrTail.trim();
				reject(new Error(`wrangler put ${key} failed (${reason})${tail ? `:\n${tail}` : ''}`));
			}
		});
	});
}

/**
 * Run an async fn over items with bounded concurrency. Workers pull
 * from a shared index counter; first failure aborts the supplied
 * AbortController so in-flight children can short-circuit, then
 * rethrows the first error after all workers settle.
 *
 * `concurrency` is validated against integer + bounded range to defend
 * against a typo'd UPLOAD_CONCURRENCY=Infinity that would fan out to
 * `items.length` wrangler subprocesses (~2,196 in our quarterly load).
 */
const MAX_CONCURRENCY = 64;

export async function runWithConcurrency<T>(
	items: readonly T[],
	concurrency: number,
	fn: (item: T, index: number, signal: AbortSignal) => Promise<void>,
	options: { externalSignal?: AbortSignal } = {},
): Promise<void> {
	if (
		!Number.isInteger(concurrency) ||
		concurrency < 1 ||
		concurrency > MAX_CONCURRENCY
	) {
		throw new Error(
			`concurrency must be an integer in [1, ${MAX_CONCURRENCY}], got ${concurrency}`,
		);
	}
	if (items.length === 0) return;

	let nextIndex = 0;
	let firstError: unknown = undefined;
	const controller = new AbortController();

	// Caller-supplied signal (e.g. from a SIGINT handler) cascades into
	// the internal controller so in-flight workers receive the abort.
	if (options.externalSignal) {
		if (options.externalSignal.aborted) {
			controller.abort();
			firstError = new Error('cancelled before start');
		} else {
			const onExternal = () => {
				if (firstError === undefined) {
					firstError = new Error('cancelled by external signal');
					controller.abort();
				}
			};
			options.externalSignal.addEventListener('abort', onExternal, { once: true });
		}
	}

	const worker = async (): Promise<void> => {
		while (firstError === undefined) {
			const idx = nextIndex++;
			if (idx >= items.length) return;
			try {
				await fn(items[idx], idx, controller.signal);
			} catch (err) {
				if (firstError === undefined) {
					firstError = err;
					controller.abort();
				}
				return;
			}
		}
	};

	const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
	await Promise.all(workers);
	if (firstError !== undefined) throw firstError;
}

/** Wrangler R2 DELETE. Best-effort; logs on failure but does not throw. */
export function wranglerDelete(bucket: string, key: string, env: WranglerEnv): void {
	const args = [env.wranglerBin, 'r2', 'object', 'delete', `${bucket}/${key}`, REMOTE_FLAG];
	assertRemote(args);
	try {
		execFileSync(process.execPath, args, {
			stdio: ['ignore', 'inherit', 'pipe'],
			env: buildEnv(env),
			timeout: SHORT_UPLOAD_TIMEOUT_MS,
			maxBuffer: STDERR_BUFFER,
		});
	} catch (err) {
		console.error(`  could not delete ${key}:\n${describeExecError(err)}`);
	}
}
