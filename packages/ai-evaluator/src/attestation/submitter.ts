/**
 * On-chain submission of AI evaluation results.
 *
 * Bundles M-of-N EIP-712 signatures and packed scores, then calls
 * DebateMarket.submitAIEvaluation() followed by resolveDebateWithAI().
 */

import { ethers } from 'ethers';
import type { AggregatedScores, ModelConfig } from '../models/types.js';
import type { EIP712Domain, AIEvaluationMessage } from './eip712.js';
import { packScores } from './signer.js';
import { signEvaluation } from './signer.js';

/** Minimal ABI for the two contract calls we need */
const DEBATE_MARKET_ABI = [
	'function submitAIEvaluation(bytes32 debateId, uint256[] calldata packedScores, uint256 deadline, bytes[] calldata signatures) external',
	'function resolveDebateWithAI(bytes32 debateId) external',
	'function aiEvalNonce(bytes32 debateId) external view returns (uint256)',
	'function debates(bytes32 debateId) external view returns (tuple(bytes32,bytes32,uint256,uint256,uint256,uint256,uint256,uint256,uint8,bytes32,bytes32,uint8,uint256,bool,uint256,uint256,bytes32,uint8))',
];

export interface SubmissionResult {
	submitTxHash: string;
	resolveTxHash: string;
	gasUsed: bigint;
}

/**
 * Submit AI evaluation scores and resolve the debate on-chain.
 *
 * @param provider Ethers provider connected to the target chain
 * @param submitterKey Private key for the transaction sender (pays gas)
 * @param debateMarketAddress Address of the deployed DebateMarket contract
 * @param debateId bytes32 debate identifier
 * @param aggregatedScores Median-aggregated scores for each argument
 * @param modelConfigs Configuration for each model (includes signing keys)
 * @param domain EIP-712 domain parameters
 * @param signatureDeadline Unix timestamp after which signatures expire
 */
export async function submitAndResolve(
	provider: ethers.Provider,
	submitterKey: string,
	debateMarketAddress: string,
	debateId: string,
	aggregatedScores: AggregatedScores[],
	modelConfigs: ModelConfig[],
	domain: EIP712Domain,
	signatureDeadline: bigint,
): Promise<SubmissionResult> {
	const wallet = new ethers.Wallet(submitterKey, provider);
	const contract = new ethers.Contract(
		debateMarketAddress,
		DEBATE_MARKET_ABI,
		wallet,
	);

	// Pack median scores for each argument
	const packedScores = aggregatedScores
		.sort((a, b) => a.argumentIndex - b.argumentIndex)
		.map((a) => packScores(a.medianScores));

	// Get current nonce from contract
	const nonce: bigint = await contract.aiEvalNonce(debateId);

	const message: AIEvaluationMessage = {
		debateId,
		packedScores,
		nonce,
		deadline: signatureDeadline,
	};

	// Collect signatures from all model signers.
	// Use AttestationSigner if available (KMS mode), otherwise fall back to raw key.
	const signatures: string[] = [];
	for (const config of modelConfigs) {
		const sig = await signEvaluation(
			config.signer ?? config.signerPrivateKey,
			domain,
			message,
		);
		signatures.push(sig);
	}

	// Submit AI evaluation on-chain
	const submitTx = await contract.submitAIEvaluation(
		debateId,
		packedScores,
		signatureDeadline,
		signatures,
	);
	const submitReceipt = await submitTx.wait();

	// Resolve the debate using AI + community scores
	const resolveTx = await contract.resolveDebateWithAI(debateId);
	const resolveReceipt = await resolveTx.wait();

	return {
		submitTxHash: submitReceipt.hash,
		resolveTxHash: resolveReceipt.hash,
		gasUsed: submitReceipt.gasUsed + resolveReceipt.gasUsed,
	};
}
