/**
 * Abstract signing interface for AI evaluation attestations.
 *
 * Implementations:
 * - EphemeralSigner: in-memory ethers.Wallet (development/testing)
 * - KMSSigner: AWS KMS or GCP Cloud KMS backed (production)
 *
 * All signers produce 65-byte EIP-712 signatures (r || s || v)
 * compatible with on-chain ecrecover in DebateMarket.submitAIEvaluation().
 */

export interface AttestationSigner {
	/** Sign a 32-byte EIP-712 digest. Returns 65-byte hex signature. */
	sign(digest: string): Promise<string>;

	/** Return the Ethereum address corresponding to this signer's key. */
	getAddress(): Promise<string>;

	/** Human-readable label for logging (e.g. "ephemeral:0xAbCd…" or "aws-kms:key-id") */
	readonly label: string;
}
