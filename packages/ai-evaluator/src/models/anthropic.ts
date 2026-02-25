/**
 * Anthropic model provider (Claude Haiku 4.5).
 *
 * Uses the Messages API with tool_use for structured output.
 */

import { Provider } from './types.js';
import type {
	ModelProvider,
	DebateArgument,
	ArgumentEvaluation,
	DimensionScores,
} from './types.js';
import { buildEvaluationPrompt, EVALUATION_JSON_SCHEMA } from '../prompt/system-prompt.js';
import { validateModelOutput, sanitizeScores } from '../aggregation/validation.js';

export class AnthropicProvider implements ModelProvider {
	readonly provider = Provider.Anthropic;
	readonly modelName: string;
	private readonly apiKey: string;
	private readonly baseUrl: string;

	constructor(apiKey: string, modelName = 'claude-haiku-4-5-20251001', baseUrl = 'https://api.anthropic.com') {
		this.apiKey = apiKey;
		this.modelName = modelName;
		this.baseUrl = baseUrl;
	}

	async evaluate(
		args: DebateArgument[],
		_systemPrompt?: string,
	): Promise<ArgumentEvaluation[]> {
		const { system, user } = buildEvaluationPrompt(args);

		const response = await fetch(`${this.baseUrl}/v1/messages`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': this.apiKey,
				'anthropic-version': '2023-06-01',
			},
			body: JSON.stringify({
				model: this.modelName,
				max_tokens: 8192,
				system,
				messages: [{ role: 'user', content: user }],
				tools: [
					{
						name: 'submit_evaluation',
						description: 'Submit structured evaluation scores for all debate arguments',
						input_schema: EVALUATION_JSON_SCHEMA,
					},
				],
				tool_choice: { type: 'tool', name: 'submit_evaluation' },
				temperature: 0.1,
			}),
		});

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`Anthropic API error ${response.status}: ${text}`);
		}

		const data = await response.json();

		// Extract tool_use block
		const toolUse = data.content?.find(
			(block: { type: string }) => block.type === 'tool_use',
		);
		if (!toolUse?.input) {
			throw new Error('Anthropic returned no tool_use block');
		}

		return this.parseEvaluations(toolUse.input, args.length);
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
				`Anthropic output validation failed: ${validation.errors.join('; ')}`,
			);
		}

		return evaluations;
	}
}
