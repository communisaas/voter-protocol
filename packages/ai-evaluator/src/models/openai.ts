/**
 * OpenAI model provider (GPT-5 Nano).
 *
 * Uses the Chat Completions API with JSON mode for structured output.
 */

import { Provider } from './types.js';
import type {
	ModelProvider,
	DebateArgument,
	ArgumentEvaluation,
	DimensionScores,
} from './types.js';
import { buildEvaluationPrompt, EVALUATION_JSON_SCHEMA } from '../prompt/system-prompt.js';
import { validateModelOutput } from '../aggregation/validation.js';
import { sanitizeScores } from '../aggregation/validation.js';

export class OpenAIProvider implements ModelProvider {
	readonly provider = Provider.OpenAI;
	readonly modelName: string;
	private readonly apiKey: string;
	private readonly baseUrl: string;

	constructor(apiKey: string, modelName = 'gpt-5-nano', baseUrl = 'https://api.openai.com/v1') {
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
				response_format: {
					type: 'json_schema',
					json_schema: {
						name: 'evaluation',
						schema: EVALUATION_JSON_SCHEMA,
						strict: true,
					},
				},
				temperature: 0.1,
			}),
		});

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`OpenAI API error ${response.status}: ${text}`);
		}

		const data = await response.json();
		const content = data.choices?.[0]?.message?.content;
		if (!content) {
			throw new Error('OpenAI returned empty response');
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
				`OpenAI output validation failed: ${validation.errors.join('; ')}`,
			);
		}

		return evaluations;
	}
}
