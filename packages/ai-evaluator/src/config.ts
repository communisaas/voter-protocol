/**
 * Model panel configuration.
 *
 * Defines the 5-model evaluation panel with provider diversity.
 * Each model uses a separate API key and EIP-712 signing key.
 */

import { Provider } from './models/types.js';
import type { ModelConfig } from './models/types.js';
import type { EIP712Domain } from './attestation/eip712.js';

/** Model identifiers for the evaluation panel (Feb 2026) */
export const MODEL_PANEL = {
	[Provider.OpenAI]: 'gpt-5-nano',
	[Provider.Google]: 'gemini-3-flash',
	[Provider.DeepSeek]: 'deepseek-v3.2',
	[Provider.Mistral]: 'mistral-large-3',
	[Provider.Anthropic]: 'claude-haiku-4-5',
} as const;

/** Environment variable names for API keys */
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

/**
 * Load model configurations from environment variables.
 * Throws if any required API key or signer key is missing.
 */
export function loadModelConfigs(): ModelConfig[] {
	const configs: ModelConfig[] = [];

	for (const providerValue of [
		Provider.OpenAI,
		Provider.Google,
		Provider.DeepSeek,
		Provider.Mistral,
		Provider.Anthropic,
	]) {
		const apiKey = process.env[API_KEY_ENV[providerValue]];
		if (!apiKey) {
			throw new Error(
				`Missing environment variable: ${API_KEY_ENV[providerValue]}`,
			);
		}

		const signerKey = process.env[SIGNER_KEY_ENV[providerValue]];
		if (!signerKey) {
			throw new Error(
				`Missing environment variable: ${SIGNER_KEY_ENV[providerValue]}`,
			);
		}

		configs.push({
			provider: providerValue,
			modelName: MODEL_PANEL[providerValue],
			apiKey,
			signerPrivateKey: signerKey,
		});
	}

	return configs;
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
