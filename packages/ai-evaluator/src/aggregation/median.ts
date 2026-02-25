/**
 * Median aggregation across model evaluations.
 *
 * Median-of-N is proven optimal against strategic manipulation:
 * tolerates floor((N-1)/2) corrupted inputs. With 5 models,
 * an attacker must compromise 3+ to shift the median.
 */

import type {
	DimensionScores,
	ModelEvaluation,
	AggregatedScores,
} from '../models/types.js';
import { DIMENSION_WEIGHTS, TOTAL_WEIGHT } from '../prompt/scoring-rubric.js';

/**
 * Compute the median of a numeric array.
 * For even-length arrays, returns the lower of the two middle values (floor).
 */
export function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 1) {
		return sorted[mid];
	}
	// Even count: floor of average (uint16 on-chain, so no fractions)
	return Math.floor((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Compute dimension-weighted score from DimensionScores.
 * Mirrors on-chain _computeWeightedAIScore exactly.
 */
export function computeWeightedScore(scores: DimensionScores): number {
	return Math.floor(
		(scores.reasoning * DIMENSION_WEIGHTS['reasoning'] +
			scores.accuracy * DIMENSION_WEIGHTS['accuracy'] +
			scores.evidence * DIMENSION_WEIGHTS['evidence'] +
			scores.constructiveness * DIMENSION_WEIGHTS['constructiveness'] +
			scores.feasibility * DIMENSION_WEIGHTS['feasibility']) /
			TOTAL_WEIGHT,
	);
}

/**
 * Aggregate evaluations from multiple models into median scores per argument.
 *
 * @param evaluations Array of model evaluations (one per model, each covering all arguments)
 * @param argumentCount Number of arguments in the debate
 * @returns Aggregated scores with median values and agreement metrics
 */
export function aggregateEvaluations(
	evaluations: ModelEvaluation[],
	argumentCount: number,
): AggregatedScores[] {
	const results: AggregatedScores[] = [];

	for (let argIdx = 0; argIdx < argumentCount; argIdx++) {
		// Collect each dimension's values across models for this argument
		const reasoning: number[] = [];
		const accuracy: number[] = [];
		const evidence: number[] = [];
		const constructiveness: number[] = [];
		const feasibility: number[] = [];

		for (const evalResult of evaluations) {
			const argEval = evalResult.argumentEvaluations.find(
				(e) => e.argumentIndex === argIdx,
			);
			if (!argEval) continue;

			reasoning.push(argEval.scores.reasoning);
			accuracy.push(argEval.scores.accuracy);
			evidence.push(argEval.scores.evidence);
			constructiveness.push(argEval.scores.constructiveness);
			feasibility.push(argEval.scores.feasibility);
		}

		const medianScores: DimensionScores = {
			reasoning: median(reasoning),
			accuracy: median(accuracy),
			evidence: median(evidence),
			constructiveness: median(constructiveness),
			feasibility: median(feasibility),
		};

		const weightedScore = computeWeightedScore(medianScores);

		// Compute model agreement: fraction within 20% of median weighted score
		const modelWeightedScores = evaluations
			.map((ev) => {
				const argEval = ev.argumentEvaluations.find(
					(e) => e.argumentIndex === argIdx,
				);
				if (!argEval) return null;
				return computeWeightedScore(argEval.scores);
			})
			.filter((s): s is number => s !== null);

		const threshold = weightedScore * 0.2;
		const agreeing = modelWeightedScores.filter(
			(s) => Math.abs(s - weightedScore) <= threshold,
		).length;
		const modelAgreement =
			modelWeightedScores.length > 0
				? agreeing / modelWeightedScores.length
				: 0;

		results.push({
			argumentIndex: argIdx,
			medianScores,
			weightedScore,
			modelAgreement,
		});
	}

	return results;
}
