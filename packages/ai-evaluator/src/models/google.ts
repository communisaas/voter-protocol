/**
 * Google model provider (Gemini 3 Flash).
 *
 * Uses the Gemini API with JSON mode for structured output.
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

export class GoogleProvider implements ModelProvider {
	readonly provider = Provider.Google;
	readonly modelName: string;
	private readonly apiKey: string;

	constructor(apiKey: string, modelName = 'gemini-3-flash') {
		this.apiKey = apiKey;
		this.modelName = modelName;
	}

	async evaluate(
		args: DebateArgument[],
		_systemPrompt?: string,
	): Promise<ArgumentEvaluation[]> {
		const { system, user } = buildEvaluationPrompt(args);

		const response = await fetch(
			`https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${this.apiKey}`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					systemInstruction: { parts: [{ text: system }] },
					contents: [{ parts: [{ text: user }] }],
					generationConfig: {
						responseMimeType: 'application/json',
						temperature: 0.1,
					},
				}),
			},
		);

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`Google API error ${response.status}: ${text}`);
		}

		const data = await response.json();
		const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
		if (!content) {
			throw new Error('Google returned empty response');
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
				`Google output validation failed: ${validation.errors.join('; ')}`,
			);
		}

		return evaluations;
	}
}
