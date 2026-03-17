#!/usr/bin/env bash
# deploy_demo.sh — Deploy fresh demo DebateMarket to Scroll Sepolia
#
# Patches MIN_DURATION (72h → 60s) and ARGUMENT_COOLDOWN (1h → 10s),
# deploys the full stack, seeds a debate with 3 arguments, and reverts
# the source changes.
#
# The debate deadline is ~2 minutes from deployment.
# After the deadline passes, the Bittensor subnet validator can
# submit real AI evaluations via submitAIEvaluation().
#
# REQUIRES:
#   PRIVATE_KEY env var (the bridge/relayer key with Scroll Sepolia ETH)
#
# USAGE:
#   cd voter-protocol/contracts
#   PRIVATE_KEY=0x... ./script/deploy_demo.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONTRACTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEBATE_MARKET="$CONTRACTS_DIR/src/DebateMarket.sol"
RPC_URL="https://sepolia-rpc.scroll.io"

# Always revert source on exit (even on error)
cleanup() {
    if [ -f "$DEBATE_MARKET.bak" ]; then
        mv "$DEBATE_MARKET.bak" "$DEBATE_MARKET"
        echo "  (auto-reverted DebateMarket.sol on exit)"
    fi
}
trap cleanup EXIT

if [ -z "${PRIVATE_KEY:-}" ]; then
    echo "ERROR: Set PRIVATE_KEY env var (bridge wallet with Scroll Sepolia ETH)"
    exit 1
fi

echo "=== Demo Stack Deploy ==="
echo ""

# 1. Patch constants for fast demo cycle
echo "[1/5] Patching DebateMarket constants for demo..."

# Save backup before any patches
cp "$DEBATE_MARKET" "$DEBATE_MARKET.bak"

# Patch MIN_DURATION: 72 hours → 60 seconds
sed 's/MIN_DURATION = 72 hours/MIN_DURATION = 60/' "$DEBATE_MARKET" > "$DEBATE_MARKET.tmp" && mv "$DEBATE_MARKET.tmp" "$DEBATE_MARKET"
echo "  MIN_DURATION: 72 hours → 60 seconds"

# Patch ARGUMENT_COOLDOWN: 1 hours → 10 seconds
# Without this, a 2-minute debate can't accept arguments (cooldown > duration)
sed 's/ARGUMENT_COOLDOWN = 1 hours/ARGUMENT_COOLDOWN = 10/' "$DEBATE_MARKET" > "$DEBATE_MARKET.tmp" && mv "$DEBATE_MARKET.tmp" "$DEBATE_MARKET"
echo "  ARGUMENT_COOLDOWN: 1 hours → 10 seconds"

# Verify patches applied
grep -q "MIN_DURATION = 60" "$DEBATE_MARKET" || { echo "ERROR: MIN_DURATION patch failed"; exit 1; }
grep -q "ARGUMENT_COOLDOWN = 10" "$DEBATE_MARKET" || { echo "ERROR: ARGUMENT_COOLDOWN patch failed"; exit 1; }
echo "  Verified: both patches applied"

# 2. Compile + deploy (force recompile to pick up patched source)
echo ""
echo "[2/5] Deploying to Scroll Sepolia..."
cd "$CONTRACTS_DIR"

ETHERSCAN_API_KEY="" forge script script/DeployDemo.s.sol:DeployDemo \
    --rpc-url "$RPC_URL" \
    --private-key "$PRIVATE_KEY" \
    --broadcast \
    --force \
    --slow \
    2>&1 | tee /tmp/demo_deploy.log

# 3. Revert the source changes (always, even on failure)
echo ""
echo "[3/5] Reverting DebateMarket.sol..."
if [ -f "$DEBATE_MARKET.bak" ]; then
    mv "$DEBATE_MARKET.bak" "$DEBATE_MARKET"
    echo "  Reverted to original"
else
    echo "  No backup found, running git checkout..."
    git checkout "$DEBATE_MARKET" 2>/dev/null || echo "  (not a git repo or no changes)"
fi

# 4. Extract addresses from deploy log
echo ""
echo "[4/5] Extracting deployed addresses..."
echo ""

DEBATE_MARKET_ADDR=$(grep "DebateMarket:" /tmp/demo_deploy.log | tail -1 | awk '{print $NF}')
SEEDER_ADDR=$(grep "DemoSeeder:" /tmp/demo_deploy.log | tail -1 | awk '{print $NF}')

if [ -n "$DEBATE_MARKET_ADDR" ] && [ -n "$SEEDER_ADDR" ]; then
    # Read the real debateId from the DemoSeeder contract on-chain
    echo "  Reading debateId from DemoSeeder..."
    DEBATE_ID=$(cast call "$SEEDER_ADDR" "lastDebateId()(bytes32)" --rpc-url "$RPC_URL" 2>/dev/null || echo "")

    echo "=== DEPLOYMENT COMPLETE ==="
    echo ""
    echo "  DebateMarket: $DEBATE_MARKET_ADDR"
    echo "  DemoSeeder:   $SEEDER_ADDR"
    echo "  DebateID:     $DEBATE_ID"
    echo ""

    # 5. Auto-update subnet config if commons-subnet exists nearby
    SUBNET_DIR="${COMMONS_SUBNET_DIR:-$(cd "$CONTRACTS_DIR/../../commons-subnet" 2>/dev/null && pwd || echo "")}"
    if [ -n "$SUBNET_DIR" ] && [ -f "$SUBNET_DIR/.env" ]; then
        echo "[5/5] Updating commons-subnet/.env..."
        if grep -q "^DEBATE_MARKET_ADDRESS=" "$SUBNET_DIR/.env"; then
            sed "s|^DEBATE_MARKET_ADDRESS=.*|DEBATE_MARKET_ADDRESS=$DEBATE_MARKET_ADDR|" "$SUBNET_DIR/.env" > "$SUBNET_DIR/.env.tmp" && mv "$SUBNET_DIR/.env.tmp" "$SUBNET_DIR/.env"
        else
            echo "DEBATE_MARKET_ADDRESS=$DEBATE_MARKET_ADDR" >> "$SUBNET_DIR/.env"
        fi
        echo "  Updated DEBATE_MARKET_ADDRESS in $SUBNET_DIR/.env"
    else
        echo "[5/5] Manual config needed:"
        echo "  Update commons-subnet/.env:"
        echo "    DEBATE_MARKET_ADDRESS=$DEBATE_MARKET_ADDR"
        if [ -n "$DEBATE_ID" ]; then
            echo "    DEMO_DEBATE_ID=$DEBATE_ID"
        fi
        echo ""
        echo "  Update commons-subnet/chain/eip712.py:"
        echo "    DEBATE_MARKET_ADDRESS = \"$DEBATE_MARKET_ADDR\""
    fi

    echo ""
    echo "  Deadline is ~2 minutes from now."
    echo "  After that, run the validator to submit real AI evaluations."
else
    echo "  Could not extract addresses from deploy log."
    echo "  Check /tmp/demo_deploy.log for details."
fi
