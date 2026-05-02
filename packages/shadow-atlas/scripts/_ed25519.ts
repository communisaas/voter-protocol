/**
 * Ed25519 helpers for source/manifest.json signing.
 *
 * Why this exists: the manifest at `source/manifest.json` is the
 * moving CI trust pointer. Without a signature, anyone with R2 write
 * access to the shadow-atlas bucket (CI token leak, accidental
 * pubkey-in-log, supply-chain on the publish path) can swap the
 * manifest body and within ~5 min CI consumes attacker-controlled
 * .db bytes. The `expected_manifest_sha256` workflow input only
 * relocates trust to "whoever typed the hash" — a stressed operator
 * can fat-finger it.
 *
 * Real fix: detached Ed25519 signature stored as a sidecar at
 * `source/manifest.json.sig`. Public key committed in this package
 * (public keys are public, safe to commit). Private key NEVER
 * committed — operator stores in env var or local PEM file.
 *
 * Adoption gate: verification is skippable while no public key has
 * been committed yet (first-publish bootstrap window). After the
 * first signed publish, the operator commits the public key and the
 * workflow flips `manifest_signing_required=true`. The unguarded
 * window is exactly one publish wide.
 */

import { createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

/** Ed25519 public key length, bytes. */
const ED25519_PUBLIC_KEY_BYTES = 32;
/** Ed25519 signature length, bytes. */
export const ED25519_SIGNATURE_BYTES = 64;

/**
 * Sign a manifest body with an Ed25519 private key.
 *
 * @param body  the exact bytes that will be uploaded to R2 — sign
 *              before any further mutation
 * @param privateKey  PEM-encoded Ed25519 private key (PKCS#8). The
 *              raw 32-byte seed is also accepted via the SEED:hex form
 *              for env-var convenience.
 * @returns base64-encoded 64-byte detached signature
 */
export function signManifest(body: string | Buffer, privateKey: string): string {
	const key = parsePrivateKey(privateKey);
	const sig = cryptoSign(null, Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8'), key);
	if (sig.length !== ED25519_SIGNATURE_BYTES) {
		throw new Error(`unexpected signature length ${sig.length}, want ${ED25519_SIGNATURE_BYTES}`);
	}
	return sig.toString('base64');
}

/**
 * Verify a base64-encoded Ed25519 signature against a manifest body.
 *
 * Returns true iff the signature is valid for the body under the
 * supplied public key. Throws on malformed inputs (signature wrong
 * length, public key not Ed25519, etc.) so caller distinguishes
 * "bad sig" from "configuration error."
 */
export function verifyManifestSignature(
	body: string | Buffer,
	signatureBase64: string,
	publicKey: string,
): boolean {
	const key = parsePublicKey(publicKey);
	const sig = Buffer.from(signatureBase64.trim(), 'base64');
	if (sig.length !== ED25519_SIGNATURE_BYTES) {
		throw new Error(
			`signature length ${sig.length} != ${ED25519_SIGNATURE_BYTES} (not Ed25519?)`,
		);
	}
	return cryptoVerify(null, Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8'), key, sig);
}

/** Defend against `Buffer.from(s, 'hex')` silently accepting non-hex chars and returning a short buffer. */
const HEX_64 = /^[0-9a-fA-F]{64}$/;

function parsePrivateKey(input: string): KeyObject {
	const trimmed = input.trim();
	// Convenience format for env vars: "SEED:<hex of 32 bytes>".
	if (trimmed.startsWith('SEED:')) {
		const hex = trimmed.slice('SEED:'.length).trim();
		if (!HEX_64.test(hex)) {
			throw new Error('SEED form must be exactly 64 hex chars (32 bytes)');
		}
		const seed = Buffer.from(hex, 'hex');
		// PKCS#8 wrapping for an Ed25519 raw seed.
		// Header: 30 2e 02 01 00 30 05 06 03 2b 65 70 04 22 04 20
		const prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
		const der = Buffer.concat([prefix, seed]);
		return assertEd25519(createPrivateKey({ key: der, format: 'der', type: 'pkcs8' }), 'private');
	}
	if (trimmed.startsWith('-----BEGIN')) {
		return assertEd25519(createPrivateKey({ key: trimmed, format: 'pem' }), 'private');
	}
	throw new Error('private key must be PEM (-----BEGIN…) or SEED:<64-hex>');
}

function parsePublicKey(input: string): KeyObject {
	const trimmed = input.trim();
	if (trimmed.startsWith('RAW:')) {
		const hex = trimmed.slice('RAW:'.length).trim();
		if (!HEX_64.test(hex)) {
			throw new Error('RAW public key must be exactly 64 hex chars (32 bytes)');
		}
		const raw = Buffer.from(hex, 'hex');
		// SubjectPublicKeyInfo wrap for Ed25519 raw 32-byte key.
		// Header: 30 2a 30 05 06 03 2b 65 70 03 21 00
		const prefix = Buffer.from('302a300506032b6570032100', 'hex');
		const der = Buffer.concat([prefix, raw]);
		return assertEd25519(createPublicKey({ key: der, format: 'der', type: 'spki' }), 'public');
	}
	// Reject PEM-encoded PRIVATE keys before they hit createPublicKey,
	// which would otherwise silently extract the public component and
	// return a valid public KeyObject. Worst-case: an operator pastes
	// the private key into a public-slot variable (which is plaintext
	// in run logs) and is now leaking the secret while verification
	// "still works."
	if (trimmed.startsWith('-----BEGIN PUBLIC KEY-----')) {
		return assertEd25519(createPublicKey({ key: trimmed, format: 'pem' }), 'public');
	}
	if (trimmed.startsWith('-----BEGIN PRIVATE KEY-----')) {
		throw new Error(
			'public-key slot received a PRIVATE key PEM. Do not paste a private key here — extract the public component first.',
		);
	}
	throw new Error(
		'public key must be PEM (-----BEGIN PUBLIC KEY-----) or RAW:<64-hex>',
	);
}

/**
 * Refuse non-Ed25519 keys (e.g. RSA, ECDSA, X25519) and refuse private
 * keys masquerading as public (createPublicKey extracts the public
 * component from a private PEM, which would otherwise let an operator
 * paste a private key into a public-key slot and have it "work" while
 * exposing the secret).
 */
function assertEd25519(key: KeyObject, expectedType: 'public' | 'private'): KeyObject {
	if (key.type !== expectedType) {
		throw new Error(`expected ${expectedType} key, got ${key.type}`);
	}
	if (key.asymmetricKeyType !== 'ed25519') {
		throw new Error(
			`expected Ed25519 key, got ${key.asymmetricKeyType ?? 'unknown'}`,
		);
	}
	return key;
}
