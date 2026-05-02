#!/usr/bin/env tsx
/**
 * Verify the Ed25519 signature on a source manifest.
 *
 * Designed for the workflow's resolve-source step. Returns:
 *   0  signature valid
 *   1  signature missing or invalid (treated as fatal by caller)
 *   2  configuration error (no public key supplied)
 *
 * Usage:
 *   tsx scripts/verify-manifest.ts \
 *     --manifest <path-to-body> \
 *     --signature <path-to-sig-base64> \
 *     [--public-key <path-or-env:VARNAME>]
 *
 * If --public-key is not supplied, reads MANIFEST_SIGNING_PUBLIC_KEY
 * from the environment (PEM or RAW:hex). At least one path must
 * resolve to a key.
 */

import { readFileSync } from 'node:fs';

import { verifyManifestSignature } from './_ed25519.js';

interface Args {
	manifestPath: string;
	signaturePath: string;
	publicKeyArg?: string;
}

function parseArgs(argv: string[]): Args {
	let manifestPath = '';
	let signaturePath = '';
	let publicKeyArg: string | undefined;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		switch (arg) {
			case '--manifest':
				manifestPath = argv[++i];
				break;
			case '--signature':
				signaturePath = argv[++i];
				break;
			case '--public-key':
				publicKeyArg = argv[++i];
				break;
			case '--help':
			case '-h':
				console.error(
					'Usage: verify-manifest.ts --manifest <path> --signature <path> [--public-key <path>]',
				);
				process.exit(0);
				break;
			default:
				console.error(`Unknown argument: ${arg}`);
				process.exit(2);
		}
	}

	if (!manifestPath) {
		console.error('Error: --manifest is required');
		process.exit(2);
	}
	if (!signaturePath) {
		console.error('Error: --signature is required');
		process.exit(2);
	}

	return { manifestPath, signaturePath, publicKeyArg };
}

function loadPublicKey(arg: string | undefined): string {
	if (arg) {
		// `--public-key env:VARNAME` reads from env (useful when the
		// key is a workflow secret/var); otherwise treat as a file path.
		if (arg.startsWith('env:')) {
			const name = arg.slice('env:'.length);
			const v = process.env[name];
			if (!v) {
				console.error(`Error: env var ${name} not set`);
				process.exit(2);
			}
			return v;
		}
		return readFileSync(arg, 'utf8');
	}
	const envKey = process.env['MANIFEST_SIGNING_PUBLIC_KEY'];
	if (envKey) return envKey;
	console.error(
		'Error: no public key supplied (pass --public-key or set MANIFEST_SIGNING_PUBLIC_KEY)',
	);
	process.exit(2);
}

function main(): void {
	const args = parseArgs(process.argv.slice(2));
	const publicKey = loadPublicKey(args.publicKeyArg);

	let manifestBody: Buffer;
	let signatureB64: string;
	try {
		manifestBody = readFileSync(args.manifestPath);
		signatureB64 = readFileSync(args.signaturePath, 'utf8');
	} catch (err) {
		const m = err instanceof Error ? err.message : String(err);
		console.error(`Error reading inputs: ${m}`);
		process.exit(1);
	}

	let ok: boolean;
	try {
		ok = verifyManifestSignature(manifestBody, signatureB64, publicKey);
	} catch (err) {
		const m = err instanceof Error ? err.message : String(err);
		console.error(`Verification error: ${m}`);
		process.exit(1);
	}

	if (!ok) {
		console.error('Manifest signature INVALID for the supplied public key.');
		console.error(
			'  This means either: the manifest was tampered with, the signature was tampered with, or the public key does not match the signing key.',
		);
		process.exit(1);
	}

	console.log('Manifest signature OK.');
}

main();
