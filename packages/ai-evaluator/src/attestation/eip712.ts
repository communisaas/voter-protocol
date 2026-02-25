/**
 * EIP-712 typed data construction for AI evaluation attestations.
 *
 * Must produce the exact same digest as the on-chain verification in
 * DebateMarket.submitAIEvaluation(). The contract computes:
 *
 *   structHash = keccak256(abi.encode(
 *     AI_EVALUATION_TYPEHASH,
 *     debateId,
 *     keccak256(abi.encodePacked(packedScores)),
 *     nonce,
 *     deadline
 *   ))
 *   digest = keccak256("\x19\x01" || DOMAIN_SEPARATOR || structHash)
 */

import { ethers } from 'ethers';

/** EIP-712 domain parameters — must match constructor in DebateMarket.sol */
export interface EIP712Domain {
	name: string; // "DebateMarket"
	version: string; // "3"
	chainId: bigint;
	verifyingContract: string;
}

/** The struct being signed */
export interface AIEvaluationMessage {
	debateId: string; // bytes32 hex
	packedScores: bigint[]; // one per argument
	nonce: bigint;
	deadline: bigint;
}

/**
 * AI_EVALUATION_TYPEHASH — matches the constant in DebateMarket.sol:
 * keccak256("AIEvaluation(bytes32 debateId,uint256[] packedScores,uint256 nonce,uint256 deadline)")
 */
export const AI_EVALUATION_TYPEHASH = ethers.keccak256(
	ethers.toUtf8Bytes(
		'AIEvaluation(bytes32 debateId,uint256[] packedScores,uint256 nonce,uint256 deadline)',
	),
);

/**
 * Compute the EIP-712 domain separator.
 * Must match the on-chain computation in DebateMarket's constructor.
 */
export function computeDomainSeparator(domain: EIP712Domain): string {
	return ethers.keccak256(
		ethers.AbiCoder.defaultAbiCoder().encode(
			['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
			[
				ethers.keccak256(
					ethers.toUtf8Bytes(
						'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)',
					),
				),
				ethers.keccak256(ethers.toUtf8Bytes(domain.name)),
				ethers.keccak256(ethers.toUtf8Bytes(domain.version)),
				domain.chainId,
				domain.verifyingContract,
			],
		),
	);
}

/**
 * Compute the struct hash for an AI evaluation.
 * Matches the on-chain keccak256(abi.encode(TYPEHASH, debateId, keccak256(abi.encodePacked(packedScores)), nonce, deadline))
 */
export function computeStructHash(message: AIEvaluationMessage): string {
	// keccak256(abi.encodePacked(packedScores)) — array of uint256 packed contiguously
	const packedScoresHash = ethers.keccak256(
		ethers.solidityPacked(
			message.packedScores.map(() => 'uint256'),
			message.packedScores,
		),
	);

	return ethers.keccak256(
		ethers.AbiCoder.defaultAbiCoder().encode(
			['bytes32', 'bytes32', 'bytes32', 'uint256', 'uint256'],
			[
				AI_EVALUATION_TYPEHASH,
				message.debateId,
				packedScoresHash,
				message.nonce,
				message.deadline,
			],
		),
	);
}

/**
 * Compute the full EIP-712 digest ready for signing.
 * digest = keccak256("\x19\x01" || domainSeparator || structHash)
 */
export function computeDigest(
	domainSeparator: string,
	message: AIEvaluationMessage,
): string {
	const structHash = computeStructHash(message);
	return ethers.keccak256(
		ethers.solidityPacked(
			['bytes1', 'bytes1', 'bytes32', 'bytes32'],
			['0x19', '0x01', domainSeparator, structHash],
		),
	);
}
