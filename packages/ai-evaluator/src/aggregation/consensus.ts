/**
 * Consensus detection for multi-model evaluation panel.
 *
 * Determines whether the model panel has sufficient agreement to proceed
 * with on-chain submission, or whether governance escalation is required.
 */

import type { AggregatedScores, ModelEvaluation } from '../models/types.js';
import { computeWeightedScore } from './median.js';

/** Minimum fraction of models that must agree (within threshold) for consensus */
export const MIN_AGREEMENT_THRESHOLD = 0.6;

/** Maximum allowed coefficient of variation across model weighted scores */
export const MAX_CV_THRESHOLD = 0.3;

/**
 * Check whether the evaluation panel achieved consensus for an argument.
 *
 * Consensus requires:
 * 1. Model agreement >= 60% (fraction of models within 20% of median weighted score)
 * 2. Coefficient of variation of weighted scores <= 30%
 */
export function hasConsensus(aggregated: AggregatedScores): boolean {
	return aggregated.modelAgreement >= MIN_AGREEMENT_THRESHOLD;
}

/**
 * Check whether ALL arguments in a debate achieved consensus.
 */
export function hasFullConsensus(aggregatedScores: AggregatedScores[]): boolean {
	return aggregatedScores.every((a) => hasConsensus(a));
}

/**
 * Compute the coefficient of variation for an argument's scores across models.
 * CV = stddev / mean. Lower is better (more agreement).
 */
export function computeCV(
	evaluations: ModelEvaluation[],
	argumentIndex: number,
): number {
	const weightedScores: number[] = [];

	for (const ev of evaluations) {
		const argEval = ev.argumentEvaluations.find(
			(e) => e.argumentIndex === argumentIndex,
		);
		if (!argEval) continue;
		weightedScores.push(computeWeightedScore(argEval.scores));
	}

	if (weightedScores.length < 2) return 0;

	const mean =
		weightedScores.reduce((a, b) => a + b, 0) / weightedScores.length;
	if (mean === 0) return 0;

	const variance =
		weightedScores.reduce((sum, s) => sum + (s - mean) ** 2, 0) /
		weightedScores.length;
	const stddev = Math.sqrt(variance);

	return stddev / mean;
}

/**
 * Determine whether the quorum requirement is met.
 * Quorum = ceil(2N/3) where N = total registered models.
 */
export function quorumMet(
	successfulEvaluations: number,
	totalModels: number,
): boolean {
	const required = Math.ceil((2 * totalModels) / 3);
	return successfulEvaluations >= required;
}
