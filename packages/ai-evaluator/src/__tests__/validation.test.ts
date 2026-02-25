import { describe, it, expect } from 'vitest';
import {
	validateArgumentEvaluation,
	validateModelOutput,
	clampScore,
	sanitizeScores,
} from '../aggregation/validation.js';
import type { ArgumentEvaluation } from '../models/types.js';

describe('validateArgumentEvaluation', () => {
	const validEval: ArgumentEvaluation = {
		argumentIndex: 0,
		chainOfThought: 'good reasoning',
		scores: {
			reasoning: 5000,
			accuracy: 6000,
			evidence: 4000,
			constructiveness: 7000,
			feasibility: 3000,
		},
	};

	it('accepts valid evaluation', () => {
		const result = validateArgumentEvaluation(validEval, 3);
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it('rejects out-of-range argument index', () => {
		const result = validateArgumentEvaluation({ ...validEval, argumentIndex: 5 }, 3);
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toContain('out of range');
	});

	it('rejects negative scores', () => {
		const result = validateArgumentEvaluation(
			{
				...validEval,
				scores: { ...validEval.scores, reasoning: -1 },
			},
			3,
		);
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toContain('reasoning');
	});

	it('rejects scores above 10000', () => {
		const result = validateArgumentEvaluation(
			{
				...validEval,
				scores: { ...validEval.scores, accuracy: 10001 },
			},
			3,
		);
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toContain('accuracy');
	});

	it('rejects non-integer scores', () => {
		const result = validateArgumentEvaluation(
			{
				...validEval,
				scores: { ...validEval.scores, evidence: 5000.5 },
			},
			3,
		);
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toContain('not an integer');
	});
});

describe('validateModelOutput', () => {
	it('accepts valid output', () => {
		const evals: ArgumentEvaluation[] = [0, 1, 2].map((i) => ({
			argumentIndex: i,
			chainOfThought: 'test',
			scores: {
				reasoning: 5000,
				accuracy: 5000,
				evidence: 5000,
				constructiveness: 5000,
				feasibility: 5000,
			},
		}));

		const result = validateModelOutput(evals, 3);
		expect(result.valid).toBe(true);
	});

	it('rejects wrong count', () => {
		const evals: ArgumentEvaluation[] = [0, 1].map((i) => ({
			argumentIndex: i,
			chainOfThought: 'test',
			scores: {
				reasoning: 5000,
				accuracy: 5000,
				evidence: 5000,
				constructiveness: 5000,
				feasibility: 5000,
			},
		}));

		const result = validateModelOutput(evals, 3);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes('Expected 3'))).toBe(true);
	});

	it('rejects duplicate argument indices', () => {
		const evals: ArgumentEvaluation[] = [0, 0, 1].map((i) => ({
			argumentIndex: i,
			chainOfThought: 'test',
			scores: {
				reasoning: 5000,
				accuracy: 5000,
				evidence: 5000,
				constructiveness: 5000,
				feasibility: 5000,
			},
		}));

		const result = validateModelOutput(evals, 3);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes('Duplicate'))).toBe(true);
	});
});

describe('clampScore', () => {
	it('clamps negative to 0', () => {
		expect(clampScore(-100)).toBe(0);
	});

	it('clamps above 10000 to 10000', () => {
		expect(clampScore(15000)).toBe(10000);
	});

	it('rounds fractional', () => {
		expect(clampScore(5000.7)).toBe(5001);
		expect(clampScore(5000.3)).toBe(5000);
	});

	it('passes through valid integers', () => {
		expect(clampScore(5000)).toBe(5000);
		expect(clampScore(0)).toBe(0);
		expect(clampScore(10000)).toBe(10000);
	});
});

describe('sanitizeScores', () => {
	it('clamps all dimensions', () => {
		const result = sanitizeScores({
			reasoning: -100,
			accuracy: 15000,
			evidence: 5000.7,
			constructiveness: 5000,
			feasibility: 0,
		});
		expect(result.reasoning).toBe(0);
		expect(result.accuracy).toBe(10000);
		expect(result.evidence).toBe(5001);
		expect(result.constructiveness).toBe(5000);
		expect(result.feasibility).toBe(0);
	});
});
