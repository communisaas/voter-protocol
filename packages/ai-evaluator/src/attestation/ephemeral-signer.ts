/**
 * In-memory EIP-712 signer backed by an ethers.Wallet.
 *
 * This is the current (pre-KMS) behavior: private keys are loaded from
 * environment variables and held in process memory. Suitable for development
 * and testing. For production, use KMSSigner.
 */

import { ethers } from 'ethers';
import type { AttestationSigner } from './types.js';

export class EphemeralSigner implements AttestationSigner {
	private readonly wallet: ethers.Wallet;
	readonly label: string;

	constructor(privateKey: string) {
		this.wallet = new ethers.Wallet(privateKey);
		this.label = `ephemeral:${this.wallet.address.slice(0, 10)}…`;
	}

	async sign(digest: string): Promise<string> {
		const sig = this.wallet.signingKey.sign(digest);
		return ethers.Signature.from(sig).serialized;
	}

	async getAddress(): Promise<string> {
		return this.wallet.address;
	}
}
