/**
 * Mistral model provider (Mistral Large 3).
 *
 * Uses the Mistral chat completions API with JSON mode.
 */

import { Provider } from './types.js';
import type {
	ModelProvider,
	DebateArgument,
	ArgumentEvaluation,
	DimensionScores,
} from './types.js';
import { buildEvaluationPrompt } from '../prompt/system-prompt.js';
import { validateModelOutput, sanitizeScores } from '../aggregation/validation.js';

export class MistralProvider implements ModelProvider {
	readonly provider = Provider.Mistral;
	readonly modelName: string;
	private readonly apiKey: string;
	private readonly baseUrl: string;

	constructor(apiKey: string, modelName = 'mistral-large-3', baseUrl = 'https://api.mistral.ai/v1') {
		this.apiKey = apiKey;
		this.modelName = modelName;
		this.baseUrl = baseUrl;
	}

	async evaluate(
		args: DebateArgument[],
		_systemPrompt?: string,
	): Promise<ArgumentEvaluation[]> {
		const { system, user } = buildEvaluationPrompt(args);

		const response = await fetch(`${this.baseUrl}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify({
				model: this.modelName,
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
			throw new Error(`Mistral API error ${response.status}: ${text}`);
		}

		const data = await response.json();
		const content = data.choices?.[0]?.message?.content;
		if (!content) {
			throw new Error('Mistral returned empty response');
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
				`Mistral output validation failed: ${validation.errors.join('; ')}`,
			);
		}

		return evaluations;
	}
}
