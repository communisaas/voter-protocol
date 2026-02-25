import { describe, it, expect } from 'vitest';
import {
	hasConsensus,
	hasFullConsensus,
	quorumMet,
	computeCV,
} from '../aggregation/consensus.js';
import type { AggregatedScores, ModelEvaluation } from '../models/types.js';
import { Provider } from '../models/types.js';

describe('hasConsensus', () => {
	it('returns true when agreement >= 0.6', () => {
		const agg: AggregatedScores = {
			argumentIndex: 0,
			medianScores: {
				reasoning: 5000,
				accuracy: 5000,
				evidence: 5000,
				constructiveness: 5000,
				feasibility: 5000,
			},
			weightedScore: 5000,
			modelAgreement: 0.8,
		};
		expect(hasConsensus(agg)).toBe(true);
	});

	it('returns false when agreement < 0.6', () => {
		const agg: AggregatedScores = {
			argumentIndex: 0,
			medianScores: {
				reasoning: 5000,
				accuracy: 5000,
				evidence: 5000,
				constructiveness: 5000,
				feasibility: 5000,
			},
			weightedScore: 5000,
			modelAgreement: 0.4,
		};
		expect(hasConsensus(agg)).toBe(false);
	});

	it('returns true at exactly 0.6', () => {
		const agg: AggregatedScores = {
			argumentIndex: 0,
			medianScores: {
				reasoning: 5000,
				accuracy: 5000,
				evidence: 5000,
				constructiveness: 5000,
				feasibility: 5000,
			},
			weightedScore: 5000,
			modelAgreement: 0.6,
		};
		expect(hasConsensus(agg)).toBe(true);
	});
});

describe('hasFullConsensus', () => {
	it('returns true when all arguments have consensus', () => {
		const aggs: AggregatedScores[] = [
			{
				argumentIndex: 0,
				medianScores: { reasoning: 5000, accuracy: 5000, evidence: 5000, constructiveness: 5000, feasibility: 5000 },
				weightedScore: 5000,
				modelAgreement: 0.8,
			},
			{
				argumentIndex: 1,
				medianScores: { reasoning: 6000, accuracy: 6000, evidence: 6000, constructiveness: 6000, feasibility: 6000 },
				weightedScore: 6000,
				modelAgreement: 1.0,
			},
		];
		expect(hasFullConsensus(aggs)).toBe(true);
	});

	it('returns false when any argument lacks consensus', () => {
		const aggs: AggregatedScores[] = [
			{
				argumentIndex: 0,
				medianScores: { reasoning: 5000, accuracy: 5000, evidence: 5000, constructiveness: 5000, feasibility: 5000 },
				weightedScore: 5000,
				modelAgreement: 0.8,
			},
			{
				argumentIndex: 1,
				medianScores: { reasoning: 6000, accuracy: 6000, evidence: 6000, constructiveness: 6000, feasibility: 6000 },
				weightedScore: 6000,
				modelAgreement: 0.2,
			},
		];
		expect(hasFullConsensus(aggs)).toBe(false);
	});
});

describe('quorumMet', () => {
	it('requires ceil(2*5/3) = 4 of 5', () => {
		expect(quorumMet(4, 5)).toBe(true);
		expect(quorumMet(3, 5)).toBe(false);
		expect(quorumMet(5, 5)).toBe(true);
	});

	it('requires ceil(2*3/3) = 2 of 3', () => {
		expect(quorumMet(2, 3)).toBe(true);
		expect(quorumMet(1, 3)).toBe(false);
	});

	it('handles N=1', () => {
		expect(quorumMet(1, 1)).toBe(true);
		expect(quorumMet(0, 1)).toBe(false);
	});
});

describe('computeCV', () => {
	it('returns 0 for identical scores', () => {
		const uniform = (v: number) => ({
			reasoning: v,
			accuracy: v,
			evidence: v,
			constructiveness: v,
			feasibility: v,
		});

		const evals: ModelEvaluation[] = [
			{
				provider: Provider.OpenAI,
				modelName: 'test',
				argumentEvaluations: [{ argumentIndex: 0, scores: uniform(5000), chainOfThought: '' }],
				timestamp: 0,
			},
			{
				provider: Provider.Google,
				modelName: 'test',
				argumentEvaluations: [{ argumentIndex: 0, scores: uniform(5000), chainOfThought: '' }],
				timestamp: 0,
			},
		];

		expect(computeCV(evals, 0)).toBe(0);
	});

	it('returns positive CV for divergent scores', () => {
		const evals: ModelEvaluation[] = [
			{
				provider: Provider.OpenAI,
				modelName: 'test',
				argumentEvaluations: [{
					argumentIndex: 0,
					scores: { reasoning: 2000, accuracy: 2000, evidence: 2000, constructiveness: 2000, feasibility: 2000 },
					chainOfThought: '',
				}],
				timestamp: 0,
			},
			{
				provider: Provider.Google,
				modelName: 'test',
				argumentEvaluations: [{
					argumentIndex: 0,
					scores: { reasoning: 8000, accuracy: 8000, evidence: 8000, constructiveness: 8000, feasibility: 8000 },
					chainOfThought: '',
				}],
				timestamp: 0,
			},
		];

		const cv = computeCV(evals, 0);
		expect(cv).toBeGreaterThan(0);
		expect(cv).toBeLessThan(1);
	});
});
