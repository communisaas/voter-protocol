/**
 * Model provider interface and evaluation types for the AI evaluation panel.
 *
 * Each model provider implements the ModelProvider interface, which standardizes
 * how we send evaluation requests and parse responses across 5 different LLM APIs.
 */

/** Provider identifiers matching on-chain providerSlot in AIEvaluationRegistry */
export enum Provider {
	OpenAI = 0,
	Google = 1,
	DeepSeek = 2,
	Mistral = 3,
	Anthropic = 4,
}

/** The 5 scoring dimensions from the spec */
export interface DimensionScores {
	reasoning: number; // 0-10000 basis points
	accuracy: number;
	evidence: number;
	constructiveness: number;
	feasibility: number;
}

/** Per-argument evaluation from a single model */
export interface ArgumentEvaluation {
	argumentIndex: number;
	scores: DimensionScores;
	chainOfThought: string; // G-Eval reasoning trace (not submitted on-chain)
}

/** Full evaluation from a single model for all arguments in a debate */
export interface ModelEvaluation {
	provider: Provider;
	modelName: string;
	argumentEvaluations: ArgumentEvaluation[];
	timestamp: number;
}

/** Aggregated scores after median computation across models */
export interface AggregatedScores {
	argumentIndex: number;
	medianScores: DimensionScores;
	weightedScore: number; // dimension-weighted, 0-10000
	modelAgreement: number; // fraction of models within 20% of median, 0-1
}

/** Result of the full evaluation pipeline */
export interface EvaluationResult {
	debateId: string;
	packedScores: bigint[]; // one per argument, ready for on-chain submission
	aggregatedScores: AggregatedScores[];
	modelEvaluations: ModelEvaluation[];
	consensusAchieved: boolean;
	quorumMet: boolean;
	totalCostUsd: number;
}

/** Debate argument as fetched from off-chain storage */
export interface DebateArgument {
	index: number;
	stance: 'SUPPORT' | 'OPPOSE' | 'AMEND';
	bodyText: string;
	amendmentText?: string;
}

/** Configuration for a model provider */
export interface ModelConfig {
	provider: Provider;
	modelName: string;
	apiKey: string;
	baseUrl?: string;
	/** EIP-712 signing key for this model's attestations */
	signerPrivateKey: string;
}

/** Interface that all model providers implement */
export interface ModelProvider {
	readonly provider: Provider;
	readonly modelName: string;

	/**
	 * Evaluate all arguments in a debate.
	 * Arguments are passed in randomized order (caller handles randomization).
	 */
	evaluate(
		args: DebateArgument[],
		systemPrompt: string,
	): Promise<ArgumentEvaluation[]>;
}
