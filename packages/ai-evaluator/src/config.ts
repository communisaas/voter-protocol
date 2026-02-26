/**
 * Model panel configuration.
 *
 * Defines the 5-model evaluation panel with provider diversity.
 * Each model uses a separate EIP-712 signing key.
 *
 * Supports two modes:
 * - **Direct mode**: 5 individual API keys (OPENAI_API_KEY, etc.)
 * - **OpenRouter mode**: 1 OPENROUTER_API_KEY routes to all 5 models
 *
 * OpenRouter mode is detected automatically when OPENROUTER_API_KEY is set.
 * Signer keys are always required regardless of mode (EIP-712 per-model).
 */

import { Provider } from './models/types.js';
import type { ModelConfig, ModelProvider } from './models/types.js';
import type { EIP712Domain } from './attestation/eip712.js';

import { OpenAIProvider } from './models/openai.js';
import { GoogleProvider } from './models/google.js';
import { DeepSeekProvider } from './models/deepseek.js';
import { MistralProvider } from './models/mistral.js';
import { AnthropicProvider } from './models/anthropic.js';
import { OpenRouterProvider } from './models/openrouter.js';

/** Model identifiers for the evaluation panel (Feb 2026) */
export const MODEL_PANEL = {
	[Provider.OpenAI]: 'gpt-5-nano',
	[Provider.Google]: 'gemini-3-flash',
	[Provider.DeepSeek]: 'deepseek-v3.2',
	[Provider.Mistral]: 'mistral-large-3',
	[Provider.Anthropic]: 'claude-haiku-4-5',
} as const;

/** OpenRouter model identifiers (provider-prefixed) */
export const OPENROUTER_MODEL_MAP = {
	[Provider.OpenAI]: 'openai/gpt-5-nano',
	[Provider.Google]: 'google/gemini-3-flash',
	[Provider.DeepSeek]: 'deepseek/deepseek-v3.2',
	[Provider.Mistral]: 'mistralai/mistral-large-3',
	[Provider.Anthropic]: 'anthropic/claude-haiku-4-5',
} as const;

/** Environment variable names for API keys (direct mode) */
const API_KEY_ENV = {
	[Provider.OpenAI]: 'OPENAI_API_KEY',
	[Provider.Google]: 'GOOGLE_AI_API_KEY',
	[Provider.DeepSeek]: 'DEEPSEEK_API_KEY',
	[Provider.Mistral]: 'MISTRAL_API_KEY',
	[Provider.Anthropic]: 'ANTHROPIC_API_KEY',
} as const;

/** Environment variable names for model signer private keys */
const SIGNER_KEY_ENV = {
	[Provider.OpenAI]: 'MODEL_SIGNER_KEY_OPENAI',
	[Provider.Google]: 'MODEL_SIGNER_KEY_GOOGLE',
	[Provider.DeepSeek]: 'MODEL_SIGNER_KEY_DEEPSEEK',
	[Provider.Mistral]: 'MODEL_SIGNER_KEY_MISTRAL',
	[Provider.Anthropic]: 'MODEL_SIGNER_KEY_ANTHROPIC',
} as const;

const PROVIDERS = [
	Provider.OpenAI,
	Provider.Google,
	Provider.DeepSeek,
	Provider.Mistral,
	Provider.Anthropic,
] as const;

/**
 * Load model configurations from environment variables.
 *
 * When OPENROUTER_API_KEY is set, uses it for all 5 models (skipping
 * individual API keys). Sets `baseUrl` to OpenRouter endpoint so
 * createProviders() knows to use OpenRouterProvider.
 *
 * Signer keys are always required regardless of mode.
 */
export function loadModelConfigs(): ModelConfig[] {
	const openRouterKey = process.env.OPENROUTER_API_KEY;
	const useOpenRouter = !!openRouterKey;
	const configs: ModelConfig[] = [];

	for (const providerValue of PROVIDERS) {
		// Signer key always required
		const signerKey = process.env[SIGNER_KEY_ENV[providerValue]];
		if (!signerKey) {
			throw new Error(
				`Missing environment variable: ${SIGNER_KEY_ENV[providerValue]}`,
			);
		}

		if (useOpenRouter) {
			configs.push({
				provider: providerValue,
				modelName: MODEL_PANEL[providerValue],
				apiKey: openRouterKey,
				baseUrl: 'https://openrouter.ai/api/v1',
				signerPrivateKey: signerKey,
			});
		} else {
			const apiKey = process.env[API_KEY_ENV[providerValue]];
			if (!apiKey) {
				throw new Error(
					`Missing environment variable: ${API_KEY_ENV[providerValue]}`,
				);
			}

			configs.push({
				provider: providerValue,
				modelName: MODEL_PANEL[providerValue],
				apiKey,
				signerPrivateKey: signerKey,
			});
		}
	}

	return configs;
}

/**
 * Create model provider instances from configs.
 *
 * Detects OpenRouter mode via baseUrl and instantiates OpenRouterProvider
 * for all 5 slots. Otherwise constructs the native provider for each slot.
 */
export function createProviders(configs: ModelConfig[]): ModelProvider[] {
	return configs.map((config) => {
		// OpenRouter mode: baseUrl contains openrouter.ai
		if (config.baseUrl?.includes('openrouter.ai')) {
			return new OpenRouterProvider(
				config.provider,
				config.apiKey,
				OPENROUTER_MODEL_MAP[config.provider],
				config.modelName,
			);
		}

		// Direct mode: use native provider
		switch (config.provider) {
			case Provider.OpenAI:
				return new OpenAIProvider(config.apiKey, config.modelName, config.baseUrl);
			case Provider.Google:
				return new GoogleProvider(config.apiKey, config.modelName);
			case Provider.DeepSeek:
				return new DeepSeekProvider(config.apiKey, config.modelName, config.baseUrl);
			case Provider.Mistral:
				return new MistralProvider(config.apiKey, config.modelName, config.baseUrl);
			case Provider.Anthropic:
				return new AnthropicProvider(config.apiKey, config.modelName, config.baseUrl);
			default:
				throw new Error(`Unknown provider: ${config.provider}`);
		}
	});
}

/**
 * Build EIP-712 domain from environment variables.
 * Requires DEBATE_MARKET_ADDRESS and CHAIN_ID.
 */
export function loadEIP712Domain(): EIP712Domain {
	const address = process.env.DEBATE_MARKET_ADDRESS;
	if (!address) {
		throw new Error('Missing environment variable: DEBATE_MARKET_ADDRESS');
	}

	const chainId = process.env.CHAIN_ID;
	if (!chainId) {
		throw new Error('Missing environment variable: CHAIN_ID');
	}

	return {
		name: 'DebateMarket',
		version: '3',
		chainId: BigInt(chainId),
		verifyingContract: address,
	};
}
