#!/usr/bin/env bash
# Generate 5 EIP-712 signing keypairs for the AI evaluation panel.
# These wallets sign attestations but never send transactions (no funding needed).
# On testnet: MockAIEvaluationRegistry accepts any signer.
# On production: Register each address in AIEvaluationRegistry on-chain.
#
# Usage: ./contracts/script/generate-ai-signers.sh

set -euo pipefail

PROVIDERS=("OPENAI" "GOOGLE" "DEEPSEEK" "MISTRAL" "ANTHROPIC")

echo "# AI Evaluation Model Signer Keys"
echo "# Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "# Paste into .env (communique and/or ai-evaluator)"
echo ""

for provider in "${PROVIDERS[@]}"; do
  output=$(cast wallet new 2>/dev/null)
  address=$(echo "$output" | grep "Address" | awk '{print $2}')
  private_key=$(echo "$output" | grep "Private key" | awk '{print $3}')

  echo "# ${provider} signer: ${address}"
  echo "MODEL_SIGNER_KEY_${provider}=${private_key}"
  echo ""
done

echo "# To register on production AIEvaluationRegistry:"
echo "# cast send \$AI_REGISTRY 'registerModel(address,uint8)' <address> <providerSlot>"
echo "# Provider slots: 0=OpenAI, 1=Google, 2=DeepSeek, 3=Mistral, 4=Anthropic"
