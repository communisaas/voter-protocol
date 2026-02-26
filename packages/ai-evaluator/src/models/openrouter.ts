/**
 * OpenRouter model provider.
 *
 * Routes all 5 model calls through OpenRouter's unified API, which normalizes
 * Anthropic, Google, and other proprietary APIs to OpenAI-compatible format.
 * One API key replaces 5 individual provider keys.
 *
 * Uses `json_object` response format (lowest common denominator across all
 * models on OpenRouter). The system prompt instructs the model to return
 * the same JSON schema as the direct providers.
 */

import type { Provider } from './types.js';
import type {
	ModelProvider,
	DebateArgument,
	ArgumentEvaluation,
	DimensionScores,
} from './types.js';
import { buildEvaluationPrompt } from '../prompt/system-prompt.js';
import { validateModelOutput, sanitizeScores } from '../aggregation/validation.js';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

export class OpenRouterProvider implements ModelProvider {
	readonly provider: Provider;
	readonly modelName: string;
	private readonly apiKey: string;
	private readonly routerModel: string;

	/**
	 * @param provider Provider enum slot (for attestation mapping)
	 * @param apiKey OpenRouter API key (shared across all 5 instances)
	 * @param routerModel OpenRouter model identifier (e.g. "anthropic/claude-haiku-4-5")
	 * @param displayName Human-readable model name for logging
	 */
	constructor(provider: Provider, apiKey: string, routerModel: string, displayName?: string) {
		this.provider = provider;
		this.apiKey = apiKey;
		this.routerModel = routerModel;
		this.modelName = displayName ?? routerModel;
	}

	async evaluate(
		args: DebateArgument[],
		_systemPrompt?: string,
	): Promise<ArgumentEvaluation[]> {
		const { system, user } = buildEvaluationPrompt(args);

		const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${this.apiKey}`,
				'HTTP-Referer': 'https://communique.dev',
				'X-Title': 'Communique AI Evaluator',
			},
			body: JSON.stringify({
				model: this.routerModel,
				messages: [
					{ role: 'system', content: system },
					{ role: 'user', content: user },
				],
				response_format: { type: 'json_object' },
				temperature: 0.1,
			}),
		});

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`OpenRouter [${this.routerModel}] error ${response.status}: ${text}`);
		}

		const data = await response.json();
		const content = data.choices?.[0]?.message?.content;
		if (!content) {
			throw new Error(`OpenRouter [${this.routerModel}] returned empty response`);
		}

		const parsed = JSON.parse(content);
		return this.parseEvaluations(parsed, args.length);
	}

	private parseEvaluations(
		parsed: { evaluations: Array<{ argumentIndex: number; chainOfThought: string; scores: DimensionScores }> },
		argCount: number,
	): ArgumentEvaluation[] {
		const evaluations: ArgumentEvaluation[] = parsed.evaluations.map((ev) => ({
			argumentIndex: ev.argumentIndex,
			chainOfThought: ev.chainOfThought,
			scores: sanitizeScores(ev.scores),
		}));

		const validation = validateModelOutput(evaluations, argCount);
		if (!validation.valid) {
			throw new Error(
				`OpenRouter [${this.routerModel}] output validation failed: ${validation.errors.join('; ')}`,
			);
		}

		return evaluations;
	}
}
