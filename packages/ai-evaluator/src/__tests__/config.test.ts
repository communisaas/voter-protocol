import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Provider } from '../models/types.js';
import { OpenRouterProvider } from '../models/openrouter.js';
import { OpenAIProvider } from '../models/openai.js';
import { GoogleProvider } from '../models/google.js';
import { DeepSeekProvider } from '../models/deepseek.js';
import { MistralProvider } from '../models/mistral.js';
import { AnthropicProvider } from '../models/anthropic.js';

// Must use dynamic import for loadModelConfigs/createProviders since they read process.env at call time
let loadModelConfigs: typeof import('../config.js')['loadModelConfigs'];
let createProviders: typeof import('../config.js')['createProviders'];

beforeEach(async () => {
	vi.unstubAllEnvs();
	// Re-import to get fresh module
	const mod = await import('../config.js');
	loadModelConfigs = mod.loadModelConfigs;
	createProviders = mod.createProviders;
});

afterEach(() => {
	vi.unstubAllEnvs();
});

const SIGNER_KEYS = {
	MODEL_SIGNER_KEY_OPENAI: '0x' + 'aa'.repeat(32),
	MODEL_SIGNER_KEY_GOOGLE: '0x' + 'bb'.repeat(32),
	MODEL_SIGNER_KEY_DEEPSEEK: '0x' + 'cc'.repeat(32),
	MODEL_SIGNER_KEY_MISTRAL: '0x' + 'dd'.repeat(32),
	MODEL_SIGNER_KEY_ANTHROPIC: '0x' + 'ee'.repeat(32),
};

const DIRECT_API_KEYS = {
	OPENAI_API_KEY: 'sk-openai-test',
	GOOGLE_AI_API_KEY: 'google-test',
	DEEPSEEK_API_KEY: 'sk-deepseek-test',
	MISTRAL_API_KEY: 'mistral-test',
	ANTHROPIC_API_KEY: 'sk-ant-test',
};

describe('loadModelConfigs', () => {
	it('loads direct mode configs when individual API keys are set', () => {
		vi.stubEnv('OPENROUTER_API_KEY', '');
		for (const [k, v] of Object.entries({ ...SIGNER_KEYS, ...DIRECT_API_KEYS })) {
			vi.stubEnv(k, v);
		}

		const configs = loadModelConfigs();
		expect(configs).toHaveLength(5);

		const openai = configs.find((c) => c.provider === Provider.OpenAI)!;
		expect(openai.apiKey).toBe('sk-openai-test');
		expect(openai.baseUrl).toBeUndefined();
		expect(openai.modelName).toBe('gpt-5-nano');
	});

	it('loads OpenRouter mode when OPENROUTER_API_KEY is set', () => {
		vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-test-key');
		for (const [k, v] of Object.entries(SIGNER_KEYS)) {
			vi.stubEnv(k, v);
		}

		const configs = loadModelConfigs();
		expect(configs).toHaveLength(5);

		for (const config of configs) {
			expect(config.apiKey).toBe('sk-or-test-key');
			expect(config.baseUrl).toBe('https://openrouter.ai/api/v1');
		}
	});

	it('throws when signer key is missing', () => {
		vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-test');
		vi.stubEnv('MODEL_SIGNER_KEY_OPENAI', '0x' + 'aa'.repeat(32));
		// Missing other signer keys

		expect(() => loadModelConfigs()).toThrow('Missing environment variable: MODEL_SIGNER_KEY_GOOGLE');
	});

	it('throws when direct API key is missing (no OpenRouter)', () => {
		vi.stubEnv('OPENROUTER_API_KEY', '');
		for (const [k, v] of Object.entries(SIGNER_KEYS)) {
			vi.stubEnv(k, v);
		}
		vi.stubEnv('OPENAI_API_KEY', 'sk-openai-test');
		// Missing GOOGLE_AI_API_KEY etc.

		expect(() => loadModelConfigs()).toThrow('Missing environment variable: GOOGLE_AI_API_KEY');
	});
});

describe('createProviders', () => {
	it('creates OpenRouterProvider instances for OpenRouter configs', () => {
		const configs = [
			{ provider: Provider.OpenAI, modelName: 'gpt-5-nano', apiKey: 'sk-or-test', baseUrl: 'https://openrouter.ai/api/v1', signerPrivateKey: '0x' + 'aa'.repeat(32) },
			{ provider: Provider.Google, modelName: 'gemini-3-flash', apiKey: 'sk-or-test', baseUrl: 'https://openrouter.ai/api/v1', signerPrivateKey: '0x' + 'bb'.repeat(32) },
			{ provider: Provider.Anthropic, modelName: 'claude-haiku-4-5', apiKey: 'sk-or-test', baseUrl: 'https://openrouter.ai/api/v1', signerPrivateKey: '0x' + 'cc'.repeat(32) },
		];

		const providers = createProviders(configs);
		expect(providers).toHaveLength(3);
		expect(providers[0]).toBeInstanceOf(OpenRouterProvider);
		expect(providers[1]).toBeInstanceOf(OpenRouterProvider);
		expect(providers[2]).toBeInstanceOf(OpenRouterProvider);

		expect(providers[0].provider).toBe(Provider.OpenAI);
		expect(providers[1].provider).toBe(Provider.Google);
		expect(providers[2].provider).toBe(Provider.Anthropic);
	});

	it('creates native provider instances for direct configs', () => {
		const configs = [
			{ provider: Provider.OpenAI, modelName: 'gpt-5-nano', apiKey: 'sk-openai', signerPrivateKey: '0x' + 'aa'.repeat(32) },
			{ provider: Provider.Google, modelName: 'gemini-3-flash', apiKey: 'google-key', signerPrivateKey: '0x' + 'bb'.repeat(32) },
			{ provider: Provider.DeepSeek, modelName: 'deepseek-v3.2', apiKey: 'sk-deep', signerPrivateKey: '0x' + 'cc'.repeat(32) },
			{ provider: Provider.Mistral, modelName: 'mistral-large-3', apiKey: 'mistral-key', signerPrivateKey: '0x' + 'dd'.repeat(32) },
			{ provider: Provider.Anthropic, modelName: 'claude-haiku-4-5', apiKey: 'sk-ant', signerPrivateKey: '0x' + 'ee'.repeat(32) },
		];

		const providers = createProviders(configs);
		expect(providers).toHaveLength(5);
		expect(providers[0]).toBeInstanceOf(OpenAIProvider);
		expect(providers[1]).toBeInstanceOf(GoogleProvider);
		expect(providers[2]).toBeInstanceOf(DeepSeekProvider);
		expect(providers[3]).toBeInstanceOf(MistralProvider);
		expect(providers[4]).toBeInstanceOf(AnthropicProvider);
	});

	it('preserves provider enum values for attestation mapping', () => {
		const configs = [
			{ provider: Provider.Mistral, modelName: 'mistral-large-3', apiKey: 'sk-or-test', baseUrl: 'https://openrouter.ai/api/v1', signerPrivateKey: '0x' + 'dd'.repeat(32) },
		];

		const [provider] = createProviders(configs);
		expect(provider.provider).toBe(Provider.Mistral);
		expect(provider.provider).toBe(3);
	});
});
