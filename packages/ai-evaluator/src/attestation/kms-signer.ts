/**
 * AWS KMS-backed EIP-712 signer for production attestations.
 *
 * Uses an asymmetric ECDSA key in AWS KMS (ECC_SECG_P256K1 = secp256k1)
 * for hardware-protected signing. The private key never leaves the HSM.
 *
 * Setup:
 *   1. Create KMS key: algorithm ECC_SECG_P256K1, usage SIGN_VERIFY
 *   2. Set key policy: allow ai-evaluator IAM role to call Sign + GetPublicKey
 *   3. Set env: MODEL_SIGNER_OPENAI_KMS_KEY_ID=arn:aws:kms:…
 *   4. Register the KMS key's Ethereum address in AIEvaluationRegistry
 *
 * Key rotation:
 *   1. Create new KMS key
 *   2. Derive Ethereum address from new key's public key
 *   3. Call AIEvaluationRegistry.rotateModel(providerSlot, newSignerAddress)
 *   4. Wait for timelock (7 days)
 *   5. Execute rotation
 *   6. Update env to point to new KMS key ID
 *   7. Disable old KMS key after confirming new key works
 *
 * v-value recovery:
 *   AWS KMS returns DER-encoded (r, s) without the recovery ID (v).
 *   We try v=27 and v=28, ecrecover both, and pick the one matching
 *   our known signer address. This is safe because exactly one v value
 *   will recover to the correct address for any valid signature.
 */

import { ethers } from 'ethers';
import type { AttestationSigner } from './types.js';

export interface KMSSignerConfig {
	/** AWS KMS key ARN or key ID */
	keyId: string;
	/** AWS region (e.g. 'us-east-1') */
	region: string;
	/** Pre-computed Ethereum address for this KMS key (for v-recovery) */
	expectedAddress: string;
}

/**
 * Parse a DER-encoded ECDSA signature into (r, s) components.
 * DER format: 0x30 <total-len> 0x02 <r-len> <r-bytes> 0x02 <s-len> <s-bytes>
 */
export function parseDERSignature(der: Uint8Array): { r: bigint; s: bigint } {
	// Skip SEQUENCE tag (0x30) and total length
	let offset = 2;

	// Parse r: INTEGER tag (0x02), length, value
	if (der[offset] !== 0x02) throw new Error('Expected INTEGER tag for r');
	offset++;
	const rLen = der[offset++];
	const rBytes = der.slice(offset, offset + rLen);
	offset += rLen;

	// Parse s: INTEGER tag (0x02), length, value
	if (der[offset] !== 0x02) throw new Error('Expected INTEGER tag for s');
	offset++;
	const sLen = der[offset++];
	const sBytes = der.slice(offset, offset + sLen);

	// Strip leading zero byte (DER uses signed integers)
	const r = BigInt('0x' + Buffer.from(rBytes[0] === 0 ? rBytes.slice(1) : rBytes).toString('hex'));
	const s = BigInt('0x' + Buffer.from(sBytes[0] === 0 ? sBytes.slice(1) : sBytes).toString('hex'));

	return { r, s };
}

/**
 * Normalize s to the lower half of the curve order (EIP-2).
 * secp256k1 order N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
 */
const SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;

export function normalizeS(s: bigint): bigint {
	if (s > SECP256K1_N / 2n) {
		return SECP256K1_N - s;
	}
	return s;
}

export class KMSSigner implements AttestationSigner {
	readonly label: string;
	private readonly config: KMSSignerConfig;

	constructor(config: KMSSignerConfig) {
		this.config = config;
		this.label = `aws-kms:${config.keyId.slice(-8)}`;
	}

	async sign(digest: string): Promise<string> {
		// Dynamic import: @aws-sdk/client-kms is an optional peer dependency.
		// Only loaded when KMS signing is actually configured.
		const { KMSClient, SignCommand } = await import('@aws-sdk/client-kms');

		const client = new KMSClient({ region: this.config.region });
		const command = new SignCommand({
			KeyId: this.config.keyId,
			Message: ethers.getBytes(digest),
			MessageType: 'DIGEST',
			SigningAlgorithm: 'ECDSA_SHA_256',
		});

		const response = await client.send(command);
		if (!response.Signature) {
			throw new Error('KMS Sign returned empty signature');
		}

		const { r, s: rawS } = parseDERSignature(new Uint8Array(response.Signature));
		const s = normalizeS(rawS);

		// Try both v values (27, 28) — ecrecover to find which matches
		const rHex = '0x' + r.toString(16).padStart(64, '0');
		const sHex = '0x' + s.toString(16).padStart(64, '0');

		for (const v of [27, 28]) {
			const sig = ethers.Signature.from({ r: rHex, s: sHex, v });
			const recovered = ethers.recoverAddress(digest, sig);
			if (recovered.toLowerCase() === this.config.expectedAddress.toLowerCase()) {
				return sig.serialized;
			}
		}

		throw new Error(
			`KMS signature recovery failed: neither v=27 nor v=28 recovers to ${this.config.expectedAddress}`,
		);
	}

	async getAddress(): Promise<string> {
		return this.config.expectedAddress;
	}
}
