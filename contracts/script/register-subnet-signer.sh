#!/usr/bin/env bash
# Register the Bittensor subnet bridge operator as an AI model signer
# on AIEvaluationRegistry (provider slot 5).
#
# For local Anvil testnet / hackathon demo.
#
# Prerequisites:
#   - Anvil running (anvil or anvil --fork-url ...)
#   - AIEvaluationRegistry deployed (set AI_REGISTRY)
#   - PRIVATE_KEY set to governance key
#
# Usage:
#   AI_REGISTRY=0x... PRIVATE_KEY=0x... ./contracts/script/register-subnet-signer.sh
#
# Optional:
#   SUBNET_SIGNER_KEY=0x...  — Use a specific private key for the signer.
#                               If not set, generates a new keypair.
#   RPC_URL=http://...       — RPC endpoint (default: http://127.0.0.1:8545)

set -euo pipefail

RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"

# Validate required env vars
if [ -z "${PRIVATE_KEY:-}" ]; then
  echo "ERROR: PRIVATE_KEY must be set (governance key)"
  exit 1
fi

if [ -z "${AI_REGISTRY:-}" ]; then
  echo "ERROR: AI_REGISTRY must be set (AIEvaluationRegistry address)"
  exit 1
fi

# Generate a signer keypair if not provided
if [ -z "${SUBNET_SIGNER_KEY:-}" ]; then
  echo "No SUBNET_SIGNER_KEY set — generating new keypair..."
  WALLET_OUTPUT=$(cast wallet new 2>/dev/null)
  SUBNET_SIGNER_KEY=$(echo "$WALLET_OUTPUT" | grep "Private key" | awk '{print $3}')
  SUBNET_SIGNER_ADDRESS=$(echo "$WALLET_OUTPUT" | grep "Address" | awk '{print $2}')
  echo "Generated signer address: ${SUBNET_SIGNER_ADDRESS}"
  echo "Generated signer key:     ${SUBNET_SIGNER_KEY}"
  echo ""
else
  SUBNET_SIGNER_ADDRESS=$(cast wallet address "$SUBNET_SIGNER_KEY" 2>/dev/null)
  echo "Using provided SUBNET_SIGNER_KEY"
  echo "Signer address: ${SUBNET_SIGNER_ADDRESS}"
  echo ""
fi

export SUBNET_SIGNER_KEY
export AI_REGISTRY
export PRIVATE_KEY

echo "Running RegisterSubnetSigner Foundry script..."
echo "  RPC:          ${RPC_URL}"
echo "  AI_REGISTRY:  ${AI_REGISTRY}"
echo "  Signer:       ${SUBNET_SIGNER_ADDRESS}"
echo ""

cd "$(dirname "$0")/.."

forge script script/RegisterSubnetSigner.s.sol:RegisterSubnetSigner \
  --rpc-url "$RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --broadcast

echo ""
echo "============================================================"
echo "  SUBNET SIGNER REGISTERED"
echo "============================================================"
echo ""
echo "Export these for the subnet bridge:"
echo "  export SUBNET_SIGNER_KEY=${SUBNET_SIGNER_KEY}"
echo "  export SUBNET_SIGNER_ADDRESS=${SUBNET_SIGNER_ADDRESS}"
echo "============================================================"
