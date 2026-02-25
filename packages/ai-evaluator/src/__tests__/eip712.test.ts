import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
import {
	computeDomainSeparator,
	computeStructHash,
	computeDigest,
	AI_EVALUATION_TYPEHASH,
} from '../attestation/eip712.js';
import {
	packScores,
	unpackScores,
	signEvaluation,
	recoverSigner,
} from '../attestation/signer.js';
import type { EIP712Domain, AIEvaluationMessage } from '../attestation/eip712.js';
import type { DimensionScores } from '../models/types.js';

const TEST_DOMAIN: EIP712Domain = {
	name: 'DebateMarket',
	version: '3',
	chainId: 31337n, // Foundry default
	verifyingContract: '0x1234567890AbcdEF1234567890aBcdef12345678',
};

describe('EIP-712', () => {
	describe('AI_EVALUATION_TYPEHASH', () => {
		it('matches the keccak256 of the type string', () => {
			const expected = ethers.keccak256(
				ethers.toUtf8Bytes(
					'AIEvaluation(bytes32 debateId,uint256[] packedScores,uint256 nonce,uint256 deadline)',
				),
			);
			expect(AI_EVALUATION_TYPEHASH).toBe(expected);
		});
	});

	describe('computeDomainSeparator', () => {
		it('produces a 32-byte hash', () => {
			const sep = computeDomainSeparator(TEST_DOMAIN);
			expect(sep).toMatch(/^0x[0-9a-f]{64}$/);
		});

		it('changes when chain ID changes', () => {
			const sep1 = computeDomainSeparator(TEST_DOMAIN);
			const sep2 = computeDomainSeparator({ ...TEST_DOMAIN, chainId: 1n });
			expect(sep1).not.toBe(sep2);
		});
	});

	describe('computeDigest', () => {
		it('produces a deterministic 32-byte digest', () => {
			const domainSep = computeDomainSeparator(TEST_DOMAIN);
			const message: AIEvaluationMessage = {
				debateId: ethers.keccak256(ethers.toUtf8Bytes('test-debate')),
				packedScores: [123n, 456n],
				nonce: 0n,
				deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
			};

			const d1 = computeDigest(domainSep, message);
			const d2 = computeDigest(domainSep, message);
			expect(d1).toBe(d2);
			expect(d1).toMatch(/^0x[0-9a-f]{64}$/);
		});
	});
});

describe('packScores / unpackScores', () => {
	it('round-trips correctly', () => {
		const scores: DimensionScores = {
			reasoning: 7500,
			accuracy: 6000,
			evidence: 8000,
			constructiveness: 4500,
			feasibility: 3000,
		};
		const packed = packScores(scores);
		const unpacked = unpackScores(packed);
		expect(unpacked).toEqual(scores);
	});

	it('handles zero scores', () => {
		const scores: DimensionScores = {
			reasoning: 0,
			accuracy: 0,
			evidence: 0,
			constructiveness: 0,
			feasibility: 0,
		};
		const packed = packScores(scores);
		expect(packed).toBe(0n);
		expect(unpackScores(packed)).toEqual(scores);
	});

	it('handles max scores (10000)', () => {
		const scores: DimensionScores = {
			reasoning: 10000,
			accuracy: 10000,
			evidence: 10000,
			constructiveness: 10000,
			feasibility: 10000,
		};
		const packed = packScores(scores);
		const unpacked = unpackScores(packed);
		expect(unpacked).toEqual(scores);
	});

	it('produces correct bit layout matching on-chain', () => {
		const scores: DimensionScores = {
			reasoning: 1,
			accuracy: 2,
			evidence: 3,
			constructiveness: 4,
			feasibility: 5,
		};
		const packed = packScores(scores);
		// reasoning at bits [79:64], accuracy at [63:48], etc.
		expect(Number((packed >> 64n) & 0xFFFFn)).toBe(1);
		expect(Number((packed >> 48n) & 0xFFFFn)).toBe(2);
		expect(Number((packed >> 32n) & 0xFFFFn)).toBe(3);
		expect(Number((packed >> 16n) & 0xFFFFn)).toBe(4);
		expect(Number(packed & 0xFFFFn)).toBe(5);
	});
});

describe('signEvaluation / recoverSigner', () => {
	it('sign and recover round-trip', async () => {
		const wallet = ethers.Wallet.createRandom();
		const message: AIEvaluationMessage = {
			debateId: ethers.keccak256(ethers.toUtf8Bytes('test-debate')),
			packedScores: [packScores({
				reasoning: 7000,
				accuracy: 6000,
				evidence: 5000,
				constructiveness: 4000,
				feasibility: 3000,
			})],
			nonce: 0n,
			deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
		};

		const signature = await signEvaluation(
			wallet.privateKey,
			TEST_DOMAIN,
			message,
		);

		const recovered = recoverSigner(TEST_DOMAIN, message, signature);
		expect(recovered.toLowerCase()).toBe(wallet.address.toLowerCase());
	});

	it('different keys produce different signatures', async () => {
		const wallet1 = ethers.Wallet.createRandom();
		const wallet2 = ethers.Wallet.createRandom();
		const message: AIEvaluationMessage = {
			debateId: ethers.keccak256(ethers.toUtf8Bytes('same-debate')),
			packedScores: [0n],
			nonce: 0n,
			deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
		};

		const sig1 = await signEvaluation(wallet1.privateKey, TEST_DOMAIN, message);
		const sig2 = await signEvaluation(wallet2.privateKey, TEST_DOMAIN, message);
		expect(sig1).not.toBe(sig2);
	});
});
