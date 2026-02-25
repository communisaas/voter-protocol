/**
 * EIP-712 signing for AI evaluation attestations.
 *
 * Each model provider has a dedicated signing key. The signer produces
 * a 65-byte signature (r || s || v) that the on-chain contract verifies
 * via ecrecover to confirm the evaluation came from a registered model.
 */

import { ethers } from 'ethers';
import type { DimensionScores } from '../models/types.js';
import type { EIP712Domain, AIEvaluationMessage } from './eip712.js';
import { computeDomainSeparator, computeDigest } from './eip712.js';

/**
 * Pack 5 dimension scores (each 0-10000) into a single uint256.
 *
 * Bit layout (matches on-chain _computeWeightedAIScore):
 *   [79:64] reasoning
 *   [63:48] accuracy
 *   [47:32] evidence
 *   [31:16] constructiveness
 *   [15:0]  feasibility
 */
export function packScores(scores: DimensionScores): bigint {
	const r = BigInt(scores.reasoning) & 0xFFFFn;
	const a = BigInt(scores.accuracy) & 0xFFFFn;
	const e = BigInt(scores.evidence) & 0xFFFFn;
	const c = BigInt(scores.constructiveness) & 0xFFFFn;
	const f = BigInt(scores.feasibility) & 0xFFFFn;

	return (r << 64n) | (a << 48n) | (e << 32n) | (c << 16n) | f;
}

/**
 * Unpack a uint256 back into DimensionScores.
 * Inverse of packScores — useful for verification.
 */
export function unpackScores(packed: bigint): DimensionScores {
	return {
		reasoning: Number((packed >> 64n) & 0xFFFFn),
		accuracy: Number((packed >> 48n) & 0xFFFFn),
		evidence: Number((packed >> 32n) & 0xFFFFn),
		constructiveness: Number((packed >> 16n) & 0xFFFFn),
		feasibility: Number(packed & 0xFFFFn),
	};
}

/**
 * Sign an AI evaluation using a model's private key.
 *
 * @param privateKey Hex-encoded private key for this model's signer
 * @param domain EIP-712 domain parameters (must match deployed contract)
 * @param message The evaluation message to sign
 * @returns 65-byte signature as hex string
 */
export async function signEvaluation(
	privateKey: string,
	domain: EIP712Domain,
	message: AIEvaluationMessage,
): Promise<string> {
	const wallet = new ethers.Wallet(privateKey);
	const domainSeparator = computeDomainSeparator(domain);
	const digest = computeDigest(domainSeparator, message);

	// ethers SigningKey.sign returns { r, s, v } — we pack into 65 bytes
	const sig = wallet.signingKey.sign(digest);
	return ethers.Signature.from(sig).serialized;
}

/**
 * Recover the signer address from a signature.
 * Used for local verification before on-chain submission.
 */
export function recoverSigner(
	domain: EIP712Domain,
	message: AIEvaluationMessage,
	signature: string,
): string {
	const domainSeparator = computeDomainSeparator(domain);
	const digest = computeDigest(domainSeparator, message);
	return ethers.recoverAddress(digest, signature);
}
