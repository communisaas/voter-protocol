import { describe, it, expect, vi } from 'vitest';
import { evaluateDebate } from '../evaluator.js';
import { Provider } from '../models/types.js';
import type {
	ModelProvider,
	DebateArgument,
	ArgumentEvaluation,
	DimensionScores,
} from '../models/types.js';

/** Create a mock provider that returns fixed scores */
function mockProvider(
	provider: Provider,
	name: string,
	scores: DimensionScores,
): ModelProvider {
	return {
		provider,
		modelName: name,
		evaluate: vi.fn(async (args: DebateArgument[]): Promise<ArgumentEvaluation[]> => {
			return args.map((a) => ({
				argumentIndex: a.index,
				chainOfThought: `Mock analysis for arg ${a.index}`,
				scores: { ...scores },
			}));
		}),
	};
}

/** Create a mock provider that throws */
function failingProvider(provider: Provider, name: string): ModelProvider {
	return {
		provider,
		modelName: name,
		evaluate: vi.fn(async () => {
			throw new Error(`${name} API unavailable`);
		}),
	};
}

const TEST_ARGS: DebateArgument[] = [
	{
		index: 0,
		stance: 'SUPPORT',
		bodyText: 'Argument supporting the proposition with evidence.',
	},
	{
		index: 1,
		stance: 'OPPOSE',
		bodyText: 'Argument opposing the proposition with counterpoints.',
	},
];

const UNIFORM_SCORES: DimensionScores = {
	reasoning: 6000,
	accuracy: 6000,
	evidence: 6000,
	constructiveness: 6000,
	feasibility: 6000,
};

describe('evaluateDebate', () => {
	it('runs evaluation with all providers succeeding', async () => {
		const providers = [
			mockProvider(Provider.OpenAI, 'gpt-5-nano', UNIFORM_SCORES),
			mockProvider(Provider.Google, 'gemini-3-flash', UNIFORM_SCORES),
			mockProvider(Provider.DeepSeek, 'deepseek-v3.2', UNIFORM_SCORES),
			mockProvider(Provider.Mistral, 'mistral-large-3', UNIFORM_SCORES),
			mockProvider(Provider.Anthropic, 'claude-haiku-4.5', UNIFORM_SCORES),
		];

		const result = await evaluateDebate(
			'0x' + '00'.repeat(32),
			TEST_ARGS,
			{ providers },
		);

		expect(result.quorumMet).toBe(true);
		expect(result.consensusAchieved).toBe(true);
		expect(result.modelEvaluations).toHaveLength(5);
		expect(result.aggregatedScores).toHaveLength(2);
		expect(result.packedScores).toHaveLength(2);

		// Each provider should have been called once
		for (const p of providers) {
			expect(p.evaluate).toHaveBeenCalledOnce();
		}
	});

	it('handles partial failures and still meets quorum', async () => {
		const providers = [
			mockProvider(Provider.OpenAI, 'gpt-5-nano', UNIFORM_SCORES),
			failingProvider(Provider.Google, 'gemini-3-flash'),
			mockProvider(Provider.DeepSeek, 'deepseek-v3.2', UNIFORM_SCORES),
			mockProvider(Provider.Mistral, 'mistral-large-3', UNIFORM_SCORES),
			mockProvider(Provider.Anthropic, 'claude-haiku-4.5', UNIFORM_SCORES),
		];

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const result = await evaluateDebate(
			'0x' + '00'.repeat(32),
			TEST_ARGS,
			{ providers },
		);

		expect(result.quorumMet).toBe(true); // 4/5 >= ceil(10/3)=4
		expect(result.modelEvaluations).toHaveLength(4);

		warnSpy.mockRestore();
	});

	it('fails quorum when too many providers fail', async () => {
		const providers = [
			mockProvider(Provider.OpenAI, 'gpt-5-nano', UNIFORM_SCORES),
			failingProvider(Provider.Google, 'gemini-3-flash'),
			failingProvider(Provider.DeepSeek, 'deepseek-v3.2'),
			mockProvider(Provider.Mistral, 'mistral-large-3', UNIFORM_SCORES),
			failingProvider(Provider.Anthropic, 'claude-haiku-4.5'),
		];

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const result = await evaluateDebate(
			'0x' + '00'.repeat(32),
			TEST_ARGS,
			{ providers },
		);

		expect(result.quorumMet).toBe(false); // 2/5 < ceil(10/3)=4
		expect(result.modelEvaluations).toHaveLength(2);

		warnSpy.mockRestore();
	});

	it('produces packed scores matching on-chain bit layout', async () => {
		const scores: DimensionScores = {
			reasoning: 7500,
			accuracy: 6000,
			evidence: 5000,
			constructiveness: 4000,
			feasibility: 3000,
		};

		const providers = [
			mockProvider(Provider.OpenAI, 'test', scores),
			mockProvider(Provider.Google, 'test', scores),
			mockProvider(Provider.Anthropic, 'test', scores),
		];

		const result = await evaluateDebate(
			'0x' + '00'.repeat(32),
			[TEST_ARGS[0]],
			{ providers },
		);

		const packed = result.packedScores[0];
		expect(Number((packed >> 64n) & 0xFFFFn)).toBe(7500); // reasoning
		expect(Number((packed >> 48n) & 0xFFFFn)).toBe(6000); // accuracy
		expect(Number((packed >> 32n) & 0xFFFFn)).toBe(5000); // evidence
		expect(Number((packed >> 16n) & 0xFFFFn)).toBe(4000); // constructiveness
		expect(Number(packed & 0xFFFFn)).toBe(3000); // feasibility
	});

	it('detects lack of consensus when models diverge', async () => {
		const lowScores: DimensionScores = {
			reasoning: 2000,
			accuracy: 2000,
			evidence: 2000,
			constructiveness: 2000,
			feasibility: 2000,
		};
		const highScores: DimensionScores = {
			reasoning: 9000,
			accuracy: 9000,
			evidence: 9000,
			constructiveness: 9000,
			feasibility: 9000,
		};

		const providers = [
			mockProvider(Provider.OpenAI, 'test', lowScores),
			mockProvider(Provider.Google, 'test', lowScores),
			mockProvider(Provider.DeepSeek, 'test', highScores),
			mockProvider(Provider.Mistral, 'test', highScores),
			mockProvider(Provider.Anthropic, 'test', highScores),
		];

		const result = await evaluateDebate(
			'0x' + '00'.repeat(32),
			[TEST_ARGS[0]],
			{ providers },
		);

		// Median will be 9000, but 2/5 models are far from it
		// Agreement: 3/5 = 0.6 — right at the threshold
		expect(result.quorumMet).toBe(true);
	});
});
