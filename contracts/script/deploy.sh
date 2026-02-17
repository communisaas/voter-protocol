#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# deploy.sh — Full deployment orchestration for VOTER Protocol on Scroll
# =============================================================================
#
# Stages:
#   1. Deploy HonkVerifier contracts (no via_ir, via deploy-verifiers.sh)
#   2. Deploy protocol contracts (via_ir, via forge script)
#   3. Post-deploy summary (addresses, timelock schedule, next steps)
#
# Usage:
#   ./deploy.sh [--network sepolia|mainnet] [--dry-run] [--depths "18 20 22 24"]
#
# Required env vars:
#   PRIVATE_KEY           — deployer wallet private key (funded with ETH on Scroll)
#
# Optional env vars:
#   GOVERNANCE_ADDRESS    — governance address (defaults to deployer)
#   ETHERSCAN_API_KEY     — for contract verification on Scrollscan
#   DEPTHS                — space-separated depths (default: "20")
#
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# -----------------------------------------------------------------------------
# Defaults
# -----------------------------------------------------------------------------
NETWORK="mainnet"
DRY_RUN=false
DEPTHS="${DEPTHS:-20}"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# RPC URLs (must match foundry.toml [rpc_endpoints])
RPC_URL_MAINNET="https://rpc.scroll.io"
RPC_URL_SEPOLIA="https://sepolia-rpc.scroll.io"

# Chain IDs
CHAIN_ID_MAINNET=534352
CHAIN_ID_SEPOLIA=534351

# -----------------------------------------------------------------------------
# Color helpers (disable if not a terminal)
# -----------------------------------------------------------------------------
if [[ -t 1 ]]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  CYAN='\033[0;36m'
  BOLD='\033[1m'
  NC='\033[0m'
else
  RED='' GREEN='' YELLOW='' CYAN='' BOLD='' NC=''
fi

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }

# -----------------------------------------------------------------------------
# Parse arguments
# -----------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --network)
      NETWORK="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --depths)
      DEPTHS="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: $0 [--network sepolia|mainnet] [--dry-run] [--depths \"18 20 22 24\"]"
      echo ""
      echo "Required env vars:"
      echo "  PRIVATE_KEY           Deployer wallet private key"
      echo ""
      echo "Optional env vars:"
      echo "  GOVERNANCE_ADDRESS    Governance address (defaults to deployer)"
      echo "  ETHERSCAN_API_KEY     For Scrollscan contract verification"
      echo ""
      echo "Options:"
      echo "  --network             Target network: sepolia or mainnet (default: mainnet)"
      echo "  --dry-run             Simulate deployment without broadcasting transactions"
      echo "  --depths              Space-separated Merkle tree depths (default: \"20\")"
      echo "  --help                Show this help message"
      exit 0
      ;;
    *)
      error "Unknown argument: $1"
      echo "Run '$0 --help' for usage."
      exit 1
      ;;
  esac
done

# -----------------------------------------------------------------------------
# Validate network
# -----------------------------------------------------------------------------
case "$NETWORK" in
  mainnet)
    RPC_URL="$RPC_URL_MAINNET"
    CHAIN_ID="$CHAIN_ID_MAINNET"
    FORGE_NETWORK="scroll_mainnet"
    ;;
  sepolia)
    RPC_URL="$RPC_URL_SEPOLIA"
    CHAIN_ID="$CHAIN_ID_SEPOLIA"
    FORGE_NETWORK="scroll_sepolia"
    ;;
  *)
    error "Invalid network: $NETWORK (must be 'sepolia' or 'mainnet')"
    exit 1
    ;;
esac

# -----------------------------------------------------------------------------
# Validate environment
# -----------------------------------------------------------------------------
if [[ -z "${PRIVATE_KEY:-}" ]]; then
  error "PRIVATE_KEY is not set. Export it before running this script."
  echo ""
  echo "  export PRIVATE_KEY=0x..."
  echo "  $0 $*"
  exit 1
fi

if [[ -z "$PRIVATE_KEY" ]]; then
  error "PRIVATE_KEY is empty."
  exit 1
fi

# Validate depths
for depth in $DEPTHS; do
  if [[ ! "$depth" =~ ^(18|20|22|24)$ ]]; then
    error "Invalid depth: $depth (must be 18, 20, 22, or 24)"
    exit 1
  fi
done

# Validate required tools
for cmd in forge cast jq; do
  if ! command -v "$cmd" &>/dev/null; then
    error "'$cmd' is not installed or not in PATH."
    exit 1
  fi
done

# Derive deployer address
DEPLOYER=$(cast wallet address "$PRIVATE_KEY" 2>/dev/null) || {
  error "Failed to derive deployer address from PRIVATE_KEY. Is the key valid?"
  exit 1
}

GOVERNANCE="${GOVERNANCE_ADDRESS:-$DEPLOYER}"

# Build forge flags
FORGE_EXTRA_FLAGS=""
if [[ "$DRY_RUN" == true ]]; then
  FORGE_EXTRA_FLAGS="--simulate"
fi

VERIFY_FLAGS=""
if [[ -n "${ETHERSCAN_API_KEY:-}" ]]; then
  VERIFY_FLAGS="--verify"
fi

# =============================================================================
# Banner
# =============================================================================
echo ""
echo -e "${BOLD}============================================================${NC}"
echo -e "${BOLD}  VOTER PROTOCOL — DEPLOYMENT ORCHESTRATION${NC}"
echo -e "${BOLD}============================================================${NC}"
echo ""
echo -e "  Network:      ${CYAN}${NETWORK}${NC} (chain ID ${CHAIN_ID})"
echo -e "  RPC URL:      ${RPC_URL}"
echo -e "  Deployer:     ${CYAN}${DEPLOYER}${NC}"
echo -e "  Governance:   ${GOVERNANCE}"
echo -e "  Depths:       ${CYAN}${DEPTHS}${NC}"
echo -e "  Dry run:      ${DRY_RUN}"
echo -e "  Verify:       ${VERIFY_FLAGS:-no (ETHERSCAN_API_KEY not set)}"
echo -e "  Timestamp:    ${TIMESTAMP}"
echo ""

if [[ "$NETWORK" == "mainnet" && "$DRY_RUN" == false ]]; then
  echo -e "${RED}${BOLD}  *** MAINNET DEPLOYMENT — REAL FUNDS AT RISK ***${NC}"
  echo ""
  echo -e "  ${YELLOW}You have 10 seconds to abort (Ctrl+C)...${NC}"
  sleep 10
  echo ""
fi

# =============================================================================
# Stage 1: Deploy HonkVerifier contracts (no via_ir)
# =============================================================================
echo -e "${BOLD}============================================================${NC}"
echo -e "${BOLD}  STAGE 1: Deploy HonkVerifier Contracts${NC}"
echo -e "${BOLD}============================================================${NC}"
echo ""
info "Compiling verifiers with FOUNDRY_PROFILE=verifiers (via_ir=false)..."

# Build verifiers with the verifiers profile (no via_ir)
(cd "$CONTRACTS_DIR" && FOUNDRY_PROFILE=verifiers forge build) || {
  error "Verifier compilation failed."
  exit 1
}
success "Verifier contracts compiled."

# Deploy each verifier via forge create
declare -A VERIFIER_ADDRESSES

for depth in $DEPTHS; do
  CONTRACT_NAME="HonkVerifier_${depth}"
  CONTRACT_PATH="src/verifiers/HonkVerifier_${depth}.sol:${CONTRACT_NAME}"

  info "Deploying ${CONTRACT_NAME} on ${NETWORK}..."

  if [[ "$DRY_RUN" == true ]]; then
    warn "DRY RUN — skipping actual deployment of ${CONTRACT_NAME}"
    # Use a placeholder address for dry-run flow
    VERIFIER_ADDRESSES[$depth]="0x$(printf '%040d' "$depth")"
    info "  (placeholder) ${CONTRACT_NAME} => ${VERIFIER_ADDRESSES[$depth]}"
    continue
  fi

  # Deploy with forge create (uses verifiers profile — no via_ir)
  DEPLOY_OUTPUT=$(
    cd "$CONTRACTS_DIR" && \
    FOUNDRY_PROFILE=verifiers forge create "$CONTRACT_PATH" \
      --rpc-url "$RPC_URL" \
      --private-key "$PRIVATE_KEY" \
      $VERIFY_FLAGS \
      --json 2>&1
  ) || {
    error "Failed to deploy ${CONTRACT_NAME}. Output:"
    echo "$DEPLOY_OUTPUT"
    exit 1
  }

  # Parse the deployed address from forge create JSON output
  DEPLOYED_ADDR=$(echo "$DEPLOY_OUTPUT" | jq -r '.deployedTo // empty' 2>/dev/null) || true

  if [[ -z "$DEPLOYED_ADDR" ]]; then
    # Fallback: try to parse non-JSON output (forge create sometimes outputs plain text)
    DEPLOYED_ADDR=$(echo "$DEPLOY_OUTPUT" | grep -oP 'Deployed to: \K0x[0-9a-fA-F]{40}' 2>/dev/null) || true
  fi

  if [[ -z "$DEPLOYED_ADDR" ]]; then
    error "Could not parse deployed address for ${CONTRACT_NAME}."
    error "Raw output:"
    echo "$DEPLOY_OUTPUT"
    exit 1
  fi

  VERIFIER_ADDRESSES[$depth]="$DEPLOYED_ADDR"
  success "${CONTRACT_NAME} deployed at ${DEPLOYED_ADDR}"
done

echo ""
info "Stage 1 complete. Verifier addresses:"
for depth in $DEPTHS; do
  echo "  Depth ${depth}: ${VERIFIER_ADDRESSES[$depth]}"
done
echo ""

# =============================================================================
# Stage 2: Deploy Protocol Contracts (via_ir)
# =============================================================================
echo -e "${BOLD}============================================================${NC}"
echo -e "${BOLD}  STAGE 2: Deploy Protocol Contracts${NC}"
echo -e "${BOLD}============================================================${NC}"
echo ""

# Export verifier addresses as environment variables for the Solidity script
for depth in $DEPTHS; do
  export "VERIFIER_ADDRESS_${depth}=${VERIFIER_ADDRESSES[$depth]}"
  info "VERIFIER_ADDRESS_${depth}=${VERIFIER_ADDRESSES[$depth]}"
done

# The DeployScrollMainnet.s.sol script reads VERIFIER_ADDRESS and VERIFIER_DEPTH.
# We deploy protocol contracts using the first (primary) depth, then register
# additional verifiers before sealing genesis.
#
# For a single depth, this is a single forge script call.
# For multiple depths, we pass the first depth to the deploy script (which
# deploys all protocol contracts + registers that verifier), then use cast send
# to register the remaining verifiers before genesis is sealed.

DEPTHS_ARRAY=($DEPTHS)
PRIMARY_DEPTH="${DEPTHS_ARRAY[0]}"
PRIMARY_VERIFIER="${VERIFIER_ADDRESSES[$PRIMARY_DEPTH]}"

info "Primary depth: ${PRIMARY_DEPTH} (verifier: ${PRIMARY_VERIFIER})"
info "Compiling protocol contracts with via_ir=true..."

# Build protocol contracts (default profile, via_ir=true, skip verifiers)
(cd "$CONTRACTS_DIR" && forge build --skip 'src/verifiers/**') || {
  error "Protocol contract compilation failed."
  exit 1
}
success "Protocol contracts compiled."

# Select the correct Forge script based on network
if [[ "$NETWORK" == "mainnet" ]]; then
  FORGE_SCRIPT="script/DeployScrollMainnet.s.sol:DeployScrollMainnet"
else
  FORGE_SCRIPT="script/DeployScrollSepolia.s.sol:DeployScrollSepolia"
fi

# Build forge script command
FORGE_CMD=(
  forge script "$FORGE_SCRIPT"
  --rpc-url "$RPC_URL"
  --private-key "$PRIVATE_KEY"
  --slow
)

if [[ "$DRY_RUN" == false ]]; then
  FORGE_CMD+=(--broadcast)
fi

if [[ -n "$VERIFY_FLAGS" ]]; then
  FORGE_CMD+=($VERIFY_FLAGS)
fi

# Set env vars for the Solidity script
export VERIFIER_ADDRESS="$PRIMARY_VERIFIER"
export VERIFIER_DEPTH="$PRIMARY_DEPTH"
export GOVERNANCE_ADDRESS="$GOVERNANCE"

info "Running: ${FORGE_CMD[*]}"
echo ""

FORGE_OUTPUT=$(cd "$CONTRACTS_DIR" && "${FORGE_CMD[@]}" 2>&1) || {
  error "Forge script failed. Output:"
  echo "$FORGE_OUTPUT"
  exit 1
}

echo "$FORGE_OUTPUT"
echo ""

# Parse deployed addresses from forge script output
parse_address() {
  local label="$1"
  echo "$FORGE_OUTPUT" | grep -oP "${label} deployed at: \K0x[0-9a-fA-F]{40}" | head -1
}

DISTRICT_REGISTRY=$(parse_address "DistrictRegistry")
NULLIFIER_REGISTRY=$(parse_address "NullifierRegistry")
VERIFIER_REGISTRY=$(parse_address "VerifierRegistry")
DISTRICT_GATE=$(parse_address "DistrictGate")
CAMPAIGN_REGISTRY=$(parse_address "CampaignRegistry")

# Validate we got addresses
for name in DISTRICT_REGISTRY NULLIFIER_REGISTRY VERIFIER_REGISTRY DISTRICT_GATE CAMPAIGN_REGISTRY; do
  addr="${!name}"
  if [[ -z "$addr" ]]; then
    warn "Could not parse ${name} address from forge output."
    warn "Check the forge output above and update deployed-addresses.json manually."
  fi
done

success "Protocol contracts deployed."

# Register additional verifier depths (if more than one depth)
if [[ ${#DEPTHS_ARRAY[@]} -gt 1 && "$DRY_RUN" == false && -n "$VERIFIER_REGISTRY" ]]; then
  echo ""
  info "Registering additional verifier depths in genesis phase..."

  for depth in "${DEPTHS_ARRAY[@]:1}"; do
    VERIFIER_ADDR="${VERIFIER_ADDRESSES[$depth]}"
    info "  Registering depth ${depth} => ${VERIFIER_ADDR}"

    cast send "$VERIFIER_REGISTRY" \
      "registerVerifier(uint8,address)" "$depth" "$VERIFIER_ADDR" \
      --rpc-url "$RPC_URL" \
      --private-key "$PRIVATE_KEY" || {
      error "Failed to register verifier for depth ${depth}."
      error "Genesis may not be sealed yet — you can retry manually:"
      echo "  cast send $VERIFIER_REGISTRY 'registerVerifier(uint8,address)' $depth $VERIFIER_ADDR --rpc-url $RPC_URL --private-key \$PRIVATE_KEY"
    }

    success "Depth ${depth} verifier registered."
  done
fi

echo ""

# =============================================================================
# Stage 3: Post-Deploy Summary
# =============================================================================
echo -e "${BOLD}============================================================${NC}"
echo -e "${BOLD}  STAGE 3: Deployment Summary${NC}"
echo -e "${BOLD}============================================================${NC}"
echo ""
echo -e "${BOLD}Network:${NC}            ${NETWORK} (chain ID ${CHAIN_ID})"
echo -e "${BOLD}Deployer:${NC}           ${DEPLOYER}"
echo -e "${BOLD}Governance:${NC}         ${GOVERNANCE}"
echo -e "${BOLD}Dry run:${NC}            ${DRY_RUN}"
echo ""
echo -e "${BOLD}--- Contract Addresses ---${NC}"
echo ""
echo -e "  DistrictRegistry:   ${GREEN}${DISTRICT_REGISTRY:-UNKNOWN}${NC}"
echo -e "  NullifierRegistry:  ${GREEN}${NULLIFIER_REGISTRY:-UNKNOWN}${NC}"
echo -e "  VerifierRegistry:   ${GREEN}${VERIFIER_REGISTRY:-UNKNOWN}${NC}"
echo -e "  DistrictGate:       ${GREEN}${DISTRICT_GATE:-UNKNOWN}${NC}"
echo -e "  CampaignRegistry:   ${GREEN}${CAMPAIGN_REGISTRY:-UNKNOWN}${NC}"
echo ""
echo -e "${BOLD}--- Verifier Addresses ---${NC}"
echo ""
for depth in $DEPTHS; do
  echo -e "  HonkVerifier_${depth}:   ${GREEN}${VERIFIER_ADDRESSES[$depth]}${NC}"
done
echo ""

echo -e "${BOLD}--- Timelock Schedule ---${NC}"
echo ""
echo "  Day 0  (now):    Contracts deployed, verifiers registered, genesis sealed."
echo "                   NullifierRegistry caller authorization PROPOSED (7-day timelock)."
echo ""
echo "  Day 7:           Execute nullifier caller authorization, then propose CampaignRegistry:"
echo "                     cast send $NULLIFIER_REGISTRY 'executeCallerAuthorization(address)' $DISTRICT_GATE --rpc-url $RPC_URL --private-key \$PRIVATE_KEY"
echo "                     cast send $DISTRICT_GATE 'proposeCampaignRegistry(address)' $CAMPAIGN_REGISTRY --rpc-url $RPC_URL --private-key \$PRIVATE_KEY"
echo ""
echo "  Day 14:          Execute CampaignRegistry integration:"
echo "                     cast send $DISTRICT_GATE 'executeCampaignRegistry()' --rpc-url $RPC_URL --private-key \$PRIVATE_KEY"
echo ""
echo "  Or use the timelock helper script:"
echo "    forge script script/ExecuteTimelocks.s.sol --rpc-url $RPC_URL --private-key \$PRIVATE_KEY --broadcast STEP=1"
echo ""

echo -e "${BOLD}--- Next Steps ---${NC}"
echo ""
echo "  1. Save the deployed-addresses.json (written below)"
echo "  2. Verify contracts on Scrollscan if not already verified:"
echo "       forge verify-contract <address> <Contract> --chain scroll --watch"
echo "  3. Register districts:"
echo "       cast send $DISTRICT_REGISTRY 'registerDistrict(bytes32,bytes32,uint8)' <root> <country> <depth> --rpc-url $RPC_URL --private-key \$PRIVATE_KEY"
echo "  4. Wait 7 days, then execute timelock operations (see schedule above)"
echo "  5. Update communique .env with contract addresses:"
echo "       DISTRICT_GATE_ADDRESS=${DISTRICT_GATE:-}"
echo "       VERIFIER_REGISTRY_ADDRESS=${VERIFIER_REGISTRY:-}"
echo ""

# =============================================================================
# Write deployed-addresses.json
# =============================================================================
ADDRESSES_FILE="$CONTRACTS_DIR/deployed-addresses.json"

# Build verifier addresses JSON fragment
VERIFIER_JSON="{"
FIRST=true
for depth in $DEPTHS; do
  if [[ "$FIRST" == true ]]; then
    FIRST=false
  else
    VERIFIER_JSON+=","
  fi
  VERIFIER_JSON+="\"HonkVerifier_${depth}\": \"${VERIFIER_ADDRESSES[$depth]}\""
done
VERIFIER_JSON+="}"

# Write the full JSON
jq -n \
  --arg network "$NETWORK" \
  --arg chainId "$CHAIN_ID" \
  --arg deployer "$DEPLOYER" \
  --arg governance "$GOVERNANCE" \
  --arg timestamp "$TIMESTAMP" \
  --arg dryRun "$DRY_RUN" \
  --arg districtRegistry "${DISTRICT_REGISTRY:-}" \
  --arg nullifierRegistry "${NULLIFIER_REGISTRY:-}" \
  --arg verifierRegistry "${VERIFIER_REGISTRY:-}" \
  --arg districtGate "${DISTRICT_GATE:-}" \
  --arg campaignRegistry "${CAMPAIGN_REGISTRY:-}" \
  --argjson verifiers "$VERIFIER_JSON" \
  '{
    network: $network,
    chainId: ($chainId | tonumber),
    deployer: $deployer,
    governance: $governance,
    deployedAt: $timestamp,
    dryRun: ($dryRun == "true"),
    contracts: {
      DistrictRegistry: $districtRegistry,
      NullifierRegistry: $nullifierRegistry,
      VerifierRegistry: $verifierRegistry,
      DistrictGate: $districtGate,
      CampaignRegistry: $campaignRegistry
    },
    verifiers: $verifiers,
    timelocks: {
      "day0": "Contracts deployed, verifiers registered in genesis, genesis sealed",
      "day7": "Execute nullifierRegistry.executeCallerAuthorization(gate), then gate.proposeCampaignRegistry(campaignRegistry)",
      "day14": "Execute gate.executeCampaignRegistry()"
    }
  }' > "$ADDRESSES_FILE"

success "Wrote ${ADDRESSES_FILE}"
echo ""

# Final status
if [[ "$DRY_RUN" == true ]]; then
  echo -e "${YELLOW}${BOLD}  DRY RUN COMPLETE — no transactions were broadcast.${NC}"
  echo -e "${YELLOW}  Re-run without --dry-run to deploy for real.${NC}"
else
  echo -e "${GREEN}${BOLD}  DEPLOYMENT COMPLETE${NC}"
  echo -e "  All contract addresses saved to: ${ADDRESSES_FILE}"
fi
echo ""
echo -e "${BOLD}============================================================${NC}"
