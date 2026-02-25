import { describe, it, expect } from 'vitest';
import { median, computeWeightedScore, aggregateEvaluations } from '../aggregation/median.js';
import type { DimensionScores, ModelEvaluation } from '../models/types.js';
import { Provider } from '../models/types.js';

describe('median', () => {
	it('returns 0 for empty array', () => {
		expect(median([])).toBe(0);
	});

	it('returns the single element for length-1 array', () => {
		expect(median([42])).toBe(42);
	});

	it('returns middle element for odd-length array', () => {
		expect(median([3, 1, 2])).toBe(2);
		expect(median([5, 3, 1, 4, 2])).toBe(3);
	});

	it('returns floor of average of two middle elements for even-length', () => {
		expect(median([1, 3])).toBe(2);
		expect(median([1, 2, 3, 4])).toBe(2); // floor((2+3)/2) = 2
		expect(median([1, 3, 5, 7])).toBe(4); // floor((3+5)/2) = 4
	});

	it('handles duplicates', () => {
		expect(median([5, 5, 5])).toBe(5);
		expect(median([1, 5, 5, 5, 9])).toBe(5);
	});

	it('does not mutate original array', () => {
		const arr = [3, 1, 2];
		median(arr);
		expect(arr).toEqual([3, 1, 2]);
	});
});

describe('computeWeightedScore', () => {
	it('computes correct weighted score for uniform 5000', () => {
		const scores: DimensionScores = {
			reasoning: 5000,
			accuracy: 5000,
			evidence: 5000,
			constructiveness: 5000,
			feasibility: 5000,
		};
		// (5000*3000 + 5000*2500 + 5000*2000 + 5000*1500 + 5000*1000) / 10000
		// = 5000*(3000+2500+2000+1500+1000)/10000 = 5000*10000/10000 = 5000
		expect(computeWeightedScore(scores)).toBe(5000);
	});

	it('computes correct weighted score for max scores', () => {
		const scores: DimensionScores = {
			reasoning: 10000,
			accuracy: 10000,
			evidence: 10000,
			constructiveness: 10000,
			feasibility: 10000,
		};
		expect(computeWeightedScore(scores)).toBe(10000);
	});

	it('weights reasoning higher than feasibility', () => {
		const highReasoning: DimensionScores = {
			reasoning: 10000,
			accuracy: 0,
			evidence: 0,
			constructiveness: 0,
			feasibility: 0,
		};
		const highFeasibility: DimensionScores = {
			reasoning: 0,
			accuracy: 0,
			evidence: 0,
			constructiveness: 0,
			feasibility: 10000,
		};
		// reasoning: 10000*3000/10000 = 3000
		// feasibility: 10000*1000/10000 = 1000
		expect(computeWeightedScore(highReasoning)).toBe(3000);
		expect(computeWeightedScore(highFeasibility)).toBe(1000);
	});
});

describe('aggregateEvaluations', () => {
	function makeEvaluation(
		provider: Provider,
		scores: DimensionScores[],
	): ModelEvaluation {
		return {
			provider,
			modelName: 'test',
			argumentEvaluations: scores.map((s, i) => ({
				argumentIndex: i,
				scores: s,
				chainOfThought: 'test',
			})),
			timestamp: Date.now(),
		};
	}

	it('computes median across 3 models for single argument', () => {
		const uniform = (v: number): DimensionScores => ({
			reasoning: v,
			accuracy: v,
			evidence: v,
			constructiveness: v,
			feasibility: v,
		});

		const evals = [
			makeEvaluation(Provider.OpenAI, [uniform(4000)]),
			makeEvaluation(Provider.Google, [uniform(6000)]),
			makeEvaluation(Provider.Anthropic, [uniform(5000)]),
		];

		const result = aggregateEvaluations(evals, 1);
		expect(result).toHaveLength(1);
		expect(result[0].medianScores.reasoning).toBe(5000);
		expect(result[0].weightedScore).toBe(5000);
	});

	it('handles multiple arguments', () => {
		const scores1: DimensionScores = {
			reasoning: 7000,
			accuracy: 6000,
			evidence: 5000,
			constructiveness: 4000,
			feasibility: 3000,
		};
		const scores2: DimensionScores = {
			reasoning: 3000,
			accuracy: 4000,
			evidence: 5000,
			constructiveness: 6000,
			feasibility: 7000,
		};

		const evals = [
			makeEvaluation(Provider.OpenAI, [scores1, scores2]),
			makeEvaluation(Provider.Google, [scores1, scores2]),
			makeEvaluation(Provider.Anthropic, [scores1, scores2]),
		];

		const result = aggregateEvaluations(evals, 2);
		expect(result).toHaveLength(2);
		expect(result[0].medianScores.reasoning).toBe(7000);
		expect(result[1].medianScores.reasoning).toBe(3000);
	});

	it('computes model agreement correctly', () => {
		const uniform = (v: number): DimensionScores => ({
			reasoning: v,
			accuracy: v,
			evidence: v,
			constructiveness: v,
			feasibility: v,
		});

		// All models agree perfectly
		const evals = [
			makeEvaluation(Provider.OpenAI, [uniform(5000)]),
			makeEvaluation(Provider.Google, [uniform(5000)]),
			makeEvaluation(Provider.Anthropic, [uniform(5000)]),
		];

		const result = aggregateEvaluations(evals, 1);
		expect(result[0].modelAgreement).toBe(1);
	});
});
