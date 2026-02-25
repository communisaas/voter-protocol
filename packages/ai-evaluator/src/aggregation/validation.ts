/**
 * Output validation for LLM evaluation responses (Layer 4 defense).
 *
 * Validates that model outputs conform to the expected schema, score ranges,
 * and basic sanity checks before aggregation.
 */

import type { ArgumentEvaluation, DimensionScores } from '../models/types.js';

/** Score must be in [0, 10000] basis points */
const MIN_SCORE = 0;
const MAX_SCORE = 10000;

export interface ValidationResult {
	valid: boolean;
	errors: string[];
}

/**
 * Validate a single argument evaluation from a model.
 */
export function validateArgumentEvaluation(
	eval_: ArgumentEvaluation,
	expectedArgCount: number,
): ValidationResult {
	const errors: string[] = [];

	// Check argument index bounds
	if (eval_.argumentIndex < 0 || eval_.argumentIndex >= expectedArgCount) {
		errors.push(
			`argumentIndex ${eval_.argumentIndex} out of range [0, ${expectedArgCount - 1}]`,
		);
	}

	// Check all dimension scores are in range
	const dimensions: (keyof DimensionScores)[] = [
		'reasoning',
		'accuracy',
		'evidence',
		'constructiveness',
		'feasibility',
	];

	for (const dim of dimensions) {
		const score = eval_.scores[dim];
		if (typeof score !== 'number' || !Number.isFinite(score)) {
			errors.push(`${dim} score is not a finite number: ${score}`);
		} else if (score < MIN_SCORE || score > MAX_SCORE) {
			errors.push(
				`${dim} score ${score} out of range [${MIN_SCORE}, ${MAX_SCORE}]`,
			);
		} else if (!Number.isInteger(score)) {
			errors.push(`${dim} score ${score} is not an integer`);
		}
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Validate a full set of argument evaluations from a model.
 * Ensures all expected arguments are covered and no duplicates.
 */
export function validateModelOutput(
	evaluations: ArgumentEvaluation[],
	expectedArgCount: number,
): ValidationResult {
	const errors: string[] = [];

	// Check correct number of evaluations
	if (evaluations.length !== expectedArgCount) {
		errors.push(
			`Expected ${expectedArgCount} evaluations, got ${evaluations.length}`,
		);
	}

	// Check for duplicate argument indices
	const seen = new Set<number>();
	for (const ev of evaluations) {
		if (seen.has(ev.argumentIndex)) {
			errors.push(`Duplicate argumentIndex: ${ev.argumentIndex}`);
		}
		seen.add(ev.argumentIndex);
	}

	// Check coverage
	for (let i = 0; i < expectedArgCount; i++) {
		if (!seen.has(i)) {
			errors.push(`Missing evaluation for argumentIndex ${i}`);
		}
	}

	// Validate each individual evaluation
	for (const ev of evaluations) {
		const result = validateArgumentEvaluation(ev, expectedArgCount);
		if (!result.valid) {
			errors.push(
				...result.errors.map(
					(e) => `arg[${ev.argumentIndex}]: ${e}`,
				),
			);
		}
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Clamp a score to the valid range [0, 10000] and round to integer.
 * Used as a safety net when models return slightly out-of-range values.
 */
export function clampScore(score: number): number {
	return Math.max(MIN_SCORE, Math.min(MAX_SCORE, Math.round(score)));
}

/**
 * Sanitize scores from a model response by clamping to valid range.
 * Returns a new DimensionScores object with all values clamped.
 */
export function sanitizeScores(scores: DimensionScores): DimensionScores {
	return {
		reasoning: clampScore(scores.reasoning),
		accuracy: clampScore(scores.accuracy),
		evidence: clampScore(scores.evidence),
		constructiveness: clampScore(scores.constructiveness),
		feasibility: clampScore(scores.feasibility),
	};
}
