/**
 * @voter-protocol/ai-evaluator
 *
 * Multi-model AI evaluation service for debate market resolution.
 * Orchestrates 5 LLM providers, aggregates via median-of-N, signs
 * EIP-712 attestations, and submits packed scores on-chain.
 */

// Core evaluator
export { evaluateDebate } from './evaluator.js';
export type { EvaluatorOptions } from './evaluator.js';

// Types
export {
	Provider,
	type DimensionScores,
	type ArgumentEvaluation,
	type ModelEvaluation,
	type AggregatedScores,
	type EvaluationResult,
	type DebateArgument,
	type ModelConfig,
	type ModelProvider,
} from './models/types.js';

// Model providers
export { OpenAIProvider } from './models/openai.js';
export { GoogleProvider } from './models/google.js';
export { DeepSeekProvider } from './models/deepseek.js';
export { MistralProvider } from './models/mistral.js';
export { AnthropicProvider } from './models/anthropic.js';
export { OpenRouterProvider } from './models/openrouter.js';

// Aggregation
export { median, computeWeightedScore, aggregateEvaluations } from './aggregation/median.js';
export { hasConsensus, hasFullConsensus, quorumMet, computeCV } from './aggregation/consensus.js';
export { validateModelOutput, validateArgumentEvaluation, clampScore, sanitizeScores } from './aggregation/validation.js';

// Prompt
export { buildEvaluationPrompt, EVALUATION_JSON_SCHEMA } from './prompt/system-prompt.js';
export { sanitizeArgumentText, wrapArgument } from './prompt/sanitizer.js';
export { DIMENSIONS, DIMENSION_WEIGHTS, TOTAL_WEIGHT } from './prompt/scoring-rubric.js';

// Attestation
export { packScores, unpackScores, signEvaluation, recoverSigner } from './attestation/signer.js';
export { computeDomainSeparator, computeStructHash, computeDigest, AI_EVALUATION_TYPEHASH } from './attestation/eip712.js';
export type { EIP712Domain, AIEvaluationMessage } from './attestation/eip712.js';
export { submitAndResolve } from './attestation/submitter.js';

// Config
export { loadModelConfigs, loadEIP712Domain, createProviders, MODEL_PANEL, OPENROUTER_MODEL_MAP } from './config.js';
