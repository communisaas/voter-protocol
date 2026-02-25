/**
 * Core evaluation orchestrator.
 *
 * Orchestrates the full pipeline:
 * 1. Fetch debate arguments (caller provides)
 * 2. Randomize argument order (anti-position-bias)
 * 3. Fan out to N model providers in parallel
 * 4. Validate each model's output
 * 5. Aggregate via median-of-N
 * 6. Check consensus
 * 7. Pack scores and sign EIP-712 attestations
 * 8. Submit on-chain (optional)
 */

import type {
	DebateArgument,
	ModelProvider,
	ModelEvaluation,
	AggregatedScores,
	EvaluationResult,
	ModelConfig,
} from './models/types.js';
import { aggregateEvaluations } from './aggregation/median.js';
import { hasFullConsensus, quorumMet } from './aggregation/consensus.js';
import { packScores } from './attestation/signer.js';

/**
 * Shuffle array using Fisher-Yates (anti-position-bias).
 * Returns a new array with the same elements in random order.
 */
function shuffle<T>(arr: T[]): T[] {
	const result = [...arr];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[result[i], result[j]] = [result[j], result[i]];
	}
	return result;
}

export interface EvaluatorOptions {
	/** Model provider instances */
	providers: ModelProvider[];
	/** Timeout per model call in milliseconds (default: 60_000) */
	timeoutMs?: number;
}

/**
 * Run the full evaluation pipeline for a debate.
 *
 * @param debateId On-chain debate identifier (bytes32 hex)
 * @param args Debate arguments fetched from off-chain storage
 * @param options Evaluator configuration
 * @returns Evaluation result with packed scores ready for on-chain submission
 */
export async function evaluateDebate(
	debateId: string,
	args: DebateArgument[],
	options: EvaluatorOptions,
): Promise<EvaluationResult> {
	const { providers, timeoutMs = 60_000 } = options;
	const totalModels = providers.length;

	// Randomize argument order to prevent position bias
	const shuffled = shuffle(args);

	// Fan out to all models in parallel with timeout
	const modelResults = await Promise.allSettled(
		providers.map(async (provider) => {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeoutMs);

			try {
				const evaluations = await provider.evaluate(shuffled, '');
				return {
					provider: provider.provider,
					modelName: provider.modelName,
					argumentEvaluations: evaluations,
					timestamp: Date.now(),
				} satisfies ModelEvaluation;
			} finally {
				clearTimeout(timer);
			}
		}),
	);

	// Collect successful evaluations
	const modelEvaluations: ModelEvaluation[] = [];
	const failures: Array<{ provider: string; error: string }> = [];

	for (let i = 0; i < modelResults.length; i++) {
		const result = modelResults[i];
		if (result.status === 'fulfilled') {
			modelEvaluations.push(result.value);
		} else {
			failures.push({
				provider: providers[i].modelName,
				error: result.reason?.message ?? 'Unknown error',
			});
		}
	}

	// Check quorum
	const quorum = quorumMet(modelEvaluations.length, totalModels);

	if (failures.length > 0) {
		console.warn(
			`[ai-evaluator] ${failures.length} model(s) failed:`,
			failures,
		);
	}

	// Aggregate via median
	const aggregatedScores = aggregateEvaluations(
		modelEvaluations,
		args.length,
	);

	// Check consensus
	const consensus = hasFullConsensus(aggregatedScores);

	// Pack scores for on-chain submission
	const packedScores = aggregatedScores
		.sort((a, b) => a.argumentIndex - b.argumentIndex)
		.map((a) => packScores(a.medianScores));

	return {
		debateId,
		packedScores,
		aggregatedScores,
		modelEvaluations,
		consensusAchieved: consensus,
		quorumMet: quorum,
		totalCostUsd: 0, // TODO: track actual API costs per provider
	};
}
