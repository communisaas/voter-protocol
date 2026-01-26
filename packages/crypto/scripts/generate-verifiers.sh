#!/bin/bash
#
# Generate Solidity Verifiers for Multi-Depth Circuits
#
# PREREQUISITE: bb (Barretenberg CLI) must be installed
#   Install via: curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/cpp/installation/install | bash
#   Then run: bbup -v <version>
#
# This script generates UltraHonk Solidity verifiers for each circuit depth.
# The generated verifiers are placed in contracts/src/verifiers/
#
# USAGE:
#   ./scripts/generate-verifiers.sh
#
# REQUIREMENTS:
#   - bb CLI installed and in PATH
#   - Compiled circuits in noir/district_membership/target/
#   - Run from packages/crypto directory
#

set -e  # Exit on error
set -u  # Exit on undefined variable

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
CIRCUIT_DIR="noir/district_membership"
TARGET_DIR="${CIRCUIT_DIR}/target"
VERIFIER_OUTPUT_DIR="../../contracts/src/verifiers"
DEPTHS=(18 20 22 24)

# Logging functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check bb is installed
    if ! command -v bb &> /dev/null; then
        log_error "bb (Barretenberg CLI) not found in PATH"
        log_error "Install via: bbup -v <version>"
        log_error "See: https://barretenberg.aztec.network/docs/how_to_guides/how-to-solidity-verifier/"
        exit 1
    fi

    # Check bb version
    BB_VERSION=$(bb --version 2>&1 | head -1 || echo "unknown")
    log_info "Using bb: ${BB_VERSION}"

    # Ensure output directory exists
    mkdir -p "${VERIFIER_OUTPUT_DIR}"

    log_info "Prerequisites OK"
}

# Generate verifier for specific depth
generate_verifier_for_depth() {
    local depth=$1
    local circuit_json="${TARGET_DIR}/district_membership_${depth}.json"
    local vk_path="${TARGET_DIR}/vk_${depth}.bin"
    local verifier_path="${VERIFIER_OUTPUT_DIR}/UltraPlonkVerifier_${depth}.sol"

    log_info "Generating verifier for DEPTH=${depth}..."

    # Check circuit exists
    if [[ ! -f "${circuit_json}" ]]; then
        log_error "Circuit not found: ${circuit_json}"
        log_error "Run build-circuits.sh first"
        return 1
    fi

    # Step 1: Generate verification key
    log_info "  Generating verification key..."
    bb write_vk -b "${circuit_json}" -o "${vk_path}" --oracle_hash keccak

    if [[ ! -f "${vk_path}" ]]; then
        log_error "Failed to generate verification key"
        return 1
    fi

    # Step 2: Generate Solidity verifier
    log_info "  Generating Solidity verifier..."
    bb write_solidity_verifier -k "${vk_path}" -o "${verifier_path}"

    if [[ ! -f "${verifier_path}" ]]; then
        log_error "Failed to generate Solidity verifier"
        return 1
    fi

    # Step 3: Rename contract to include depth in name
    # bb generates "HonkVerifier" by default, we want "UltraPlonkVerifier_18" etc.
    sed -i.bak "s/contract HonkVerifier/contract UltraPlonkVerifier_${depth}/g" "${verifier_path}"
    rm -f "${verifier_path}.bak"

    local file_size=$(wc -c < "${verifier_path}" | tr -d ' ')
    log_info "  Created: ${verifier_path} (${file_size} bytes)"
}

# Clean old verifiers
clean_old_verifiers() {
    log_info "Cleaning old verifier artifacts..."

    for depth in "${DEPTHS[@]}"; do
        local vk_path="${TARGET_DIR}/vk_${depth}.bin"
        local verifier_path="${VERIFIER_OUTPUT_DIR}/UltraPlonkVerifier_${depth}.sol"

        [[ -f "${vk_path}" ]] && rm "${vk_path}" && log_info "  Removed: ${vk_path}"
        [[ -f "${verifier_path}" ]] && rm "${verifier_path}" && log_info "  Removed: ${verifier_path}"
    done
}

# Main pipeline
main() {
    log_info "=== Verifier Generation Pipeline ==="
    log_info "Generating verifiers for depths: ${DEPTHS[*]}"

    check_prerequisites
    clean_old_verifiers

    local success_count=0
    local fail_count=0

    for depth in "${DEPTHS[@]}"; do
        if generate_verifier_for_depth "${depth}"; then
            ((success_count++))
        else
            ((fail_count++))
            log_warn "Skipping depth ${depth} due to error"
        fi
    done

    log_info "=== Generation Complete ==="
    log_info "Generated: ${success_count} verifiers"
    [[ ${fail_count} -gt 0 ]] && log_warn "Failed: ${fail_count} verifiers"

    log_info "Verifier contracts saved to: ${VERIFIER_OUTPUT_DIR}/"
    for depth in "${DEPTHS[@]}"; do
        local verifier_path="${VERIFIER_OUTPUT_DIR}/UltraPlonkVerifier_${depth}.sol"
        if [[ -f "${verifier_path}" ]]; then
            local size=$(wc -c < "${verifier_path}" | tr -d ' ')
            log_info "  - UltraPlonkVerifier_${depth}.sol (${size} bytes)"
        fi
    done

    if [[ ${fail_count} -gt 0 ]]; then
        exit 1
    fi
}

# Run main pipeline
main
