#!/usr/bin/env bash
# Deploy HonkVerifier contracts to Scroll
# Usage: ./deploy-verifiers.sh [--network sepolia|mainnet] [--depths "18 20 22 24"]
#
# Environment:
#   PRIVATE_KEY          (required) Deployer private key
#   ETHERSCAN_API_KEY    (optional) For contract verification on Scrollscan
#
# Examples:
#   PRIVATE_KEY=0x... ./deploy-verifiers.sh --network sepolia --depths "20"
#   PRIVATE_KEY=0x... ./deploy-verifiers.sh --network mainnet
#   PRIVATE_KEY=0x... ./deploy-verifiers.sh --network sepolia --depths "18 20 22 24"

set -euo pipefail

# =========================================================================
# Defaults
# =========================================================================

NETWORK="mainnet"
DEPTHS="18 20 22 24"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(dirname "$SCRIPT_DIR")"

# =========================================================================
# Parse arguments
# =========================================================================

while [[ $# -gt 0 ]]; do
    case "$1" in
        --network)
            NETWORK="$2"
            shift 2
            ;;
        --depths)
            DEPTHS="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [--network sepolia|mainnet] [--depths \"18 20 22 24\"]"
            echo ""
            echo "Environment:"
            echo "  PRIVATE_KEY          (required) Deployer private key"
            echo "  ETHERSCAN_API_KEY    (optional) For contract verification"
            exit 0
            ;;
        *)
            echo "ERROR: Unknown argument: $1"
            echo "Run with --help for usage."
            exit 1
            ;;
    esac
done

# =========================================================================
# Validate inputs
# =========================================================================

if [[ -z "${PRIVATE_KEY:-}" ]]; then
    echo "ERROR: PRIVATE_KEY environment variable is required"
    exit 1
fi

# Validate network
case "$NETWORK" in
    sepolia)
        RPC_URL="https://sepolia-rpc.scroll.io"
        CHAIN_ID=534351
        ETHERSCAN_URL="https://api-sepolia.scrollscan.com/api"
        ;;
    mainnet)
        RPC_URL="https://rpc.scroll.io"
        CHAIN_ID=534352
        ETHERSCAN_URL="https://api.scrollscan.com/api"
        ;;
    *)
        echo "ERROR: Invalid network '$NETWORK'. Must be 'sepolia' or 'mainnet'."
        exit 1
        ;;
esac

# Validate depths
VALID_DEPTHS="18 20 22 24"
for depth in $DEPTHS; do
    if ! echo "$VALID_DEPTHS" | grep -qw "$depth"; then
        echo "ERROR: Invalid depth '$depth'. Must be one of: $VALID_DEPTHS"
        exit 1
    fi
done

# =========================================================================
# Pre-flight
# =========================================================================

echo "============================================================"
echo "  HONK VERIFIER DEPLOYMENT - SCROLL ${NETWORK^^}"
echo "============================================================"
echo ""
echo "  Network:    $NETWORK (chain ID $CHAIN_ID)"
echo "  RPC URL:    $RPC_URL"
echo "  Depths:     $DEPTHS"
echo "  Verify:     ${ETHERSCAN_API_KEY:+YES (Etherscan API key set)}${ETHERSCAN_API_KEY:-NO (ETHERSCAN_API_KEY not set)}"
echo ""

# Verify source files exist
for depth in $DEPTHS; do
    src_file="$CONTRACTS_DIR/src/verifiers/HonkVerifier_${depth}.sol"
    if [[ ! -f "$src_file" ]]; then
        echo "ERROR: Source file not found: $src_file"
        echo "Generate verifiers first: npx tsx scripts/generate-verifier-sol.ts"
        exit 1
    fi
done

echo "  Source files verified."
echo ""

# =========================================================================
# Build verification arguments
# =========================================================================

VERIFY_ARGS=""
if [[ -n "${ETHERSCAN_API_KEY:-}" ]]; then
    VERIFY_ARGS="--verify --verifier-url $ETHERSCAN_URL --etherscan-api-key $ETHERSCAN_API_KEY"
fi

# =========================================================================
# Deploy each verifier
# =========================================================================

declare -A DEPLOYED_ADDRESSES
FAILURES=0

cd "$CONTRACTS_DIR"

for depth in $DEPTHS; do
    echo "------------------------------------------------------------"
    echo "  Deploying HonkVerifier for depth $depth..."
    echo "------------------------------------------------------------"

    CONTRACT_PATH="src/verifiers/HonkVerifier_${depth}.sol:HonkVerifier"

    # Build the forge create command
    CMD=(
        forge create "$CONTRACT_PATH"
        --rpc-url "$RPC_URL"
        --private-key "$PRIVATE_KEY"
        --optimizer-runs 1
        --via-ir false
    )

    # Add verification if API key is available
    if [[ -n "${ETHERSCAN_API_KEY:-}" ]]; then
        CMD+=(--verify --verifier-url "$ETHERSCAN_URL" --etherscan-api-key "$ETHERSCAN_API_KEY")
    fi

    echo "  Command: forge create $CONTRACT_PATH --rpc-url $RPC_URL --optimizer-runs 1 --via-ir false ${ETHERSCAN_API_KEY:+--verify}"
    echo ""

    # Execute deployment and capture output
    if OUTPUT=$("${CMD[@]}" 2>&1); then
        # Extract deployed address from forge create output
        # Format: "Deployed to: 0x..."
        ADDRESS=$(echo "$OUTPUT" | grep -i "Deployed to:" | awk '{print $NF}')

        if [[ -n "$ADDRESS" ]]; then
            DEPLOYED_ADDRESSES[$depth]="$ADDRESS"
            echo "  SUCCESS: HonkVerifier_$depth deployed to $ADDRESS"
        else
            echo "  WARNING: Deployment appeared to succeed but could not parse address."
            echo "  Output: $OUTPUT"
            DEPLOYED_ADDRESSES[$depth]="UNKNOWN"
        fi
    else
        echo "  FAILED: HonkVerifier_$depth deployment failed!"
        echo "  Output: $OUTPUT"
        FAILURES=$((FAILURES + 1))
        DEPLOYED_ADDRESSES[$depth]="FAILED"
    fi
    echo ""
done

# =========================================================================
# Summary
# =========================================================================

echo "============================================================"
echo "  DEPLOYMENT SUMMARY - SCROLL ${NETWORK^^}"
echo "============================================================"
echo ""

SUCCESS_COUNT=0
for depth in $DEPTHS; do
    STATUS="${DEPLOYED_ADDRESSES[$depth]:-NOT_ATTEMPTED}"
    if [[ "$STATUS" != "FAILED" && "$STATUS" != "UNKNOWN" && "$STATUS" != "NOT_ATTEMPTED" ]]; then
        echo "  Depth $depth: $STATUS"
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    else
        echo "  Depth $depth: $STATUS"
    fi
done

echo ""
echo "  Total: $SUCCESS_COUNT succeeded, $FAILURES failed"
echo ""

# =========================================================================
# Write deployed-verifiers.json
# =========================================================================

JSON_FILE="$CONTRACTS_DIR/deployed-verifiers.json"

{
    echo "{"
    echo "  \"network\": \"$NETWORK\","
    echo "  \"chainId\": $CHAIN_ID,"
    echo "  \"deployedAt\": \"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\","
    echo "  \"verifiers\": {"

    FIRST=true
    for depth in $DEPTHS; do
        ADDRESS="${DEPLOYED_ADDRESSES[$depth]:-FAILED}"
        if [[ "$FIRST" == true ]]; then
            FIRST=false
        else
            echo ","
        fi
        printf "    \"%s\": \"%s\"" "$depth" "$ADDRESS"
    done
    echo ""

    echo "  }"
    echo "}"
} > "$JSON_FILE"

echo "  Addresses written to: $JSON_FILE"
echo ""

# =========================================================================
# Environment variable hints for DeployScrollMainnet
# =========================================================================

echo "============================================================"
echo "  NEXT STEPS"
echo "============================================================"
echo ""
echo "Set these environment variables for DeployScrollMainnet.s.sol:"
echo ""
for depth in $DEPTHS; do
    ADDRESS="${DEPLOYED_ADDRESSES[$depth]:-FAILED}"
    if [[ "$ADDRESS" != "FAILED" && "$ADDRESS" != "UNKNOWN" ]]; then
        echo "  export VERIFIER_ADDRESS_$depth=$ADDRESS"
    fi
done
echo ""
echo "Then run:"
echo "  forge script script/DeployScrollMainnet.s.sol:DeployScrollMainnet \\"
echo "    --rpc-url scroll_$NETWORK --private-key \$PRIVATE_KEY --broadcast --slow"
echo ""
echo "============================================================"

# Exit with failure if any deployments failed
if [[ $FAILURES -gt 0 ]]; then
    echo "WARNING: $FAILURES deployment(s) failed. Review output above."
    exit 1
fi
