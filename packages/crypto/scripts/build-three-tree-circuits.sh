#!/bin/bash
#
# Build Three-Tree Membership Circuits - Multi-Depth Compilation
#
# Compiles the three_tree_membership Noir circuit at 4 different Merkle depths:
# - TREE_DEPTH=18: Municipal (city council, ~262K leaves)
# - TREE_DEPTH=20: State (congressional districts, ~1M leaves)
# - TREE_DEPTH=22: Federal (national boundaries, ~4M leaves)
# - TREE_DEPTH=24: Large-scale (mega-regions, ~16M leaves)
#
# NOTE: Only even depths in range 18-24 are supported for production use.
#
# PROCESS:
# 1. Backup original main.nr
# 2. For each depth:
#    a. Replace `global TREE_DEPTH: u32 = <N>` with target depth
#    b. Compile with nargo
#    c. Rename output to three_tree_membership_{depth}.json
#    d. Restore original
#
# USAGE:
#   ./scripts/build-three-tree-circuits.sh
#
# REQUIREMENTS:
#   - nargo (Noir compiler) installed and in PATH
#   - Run from packages/crypto directory
#
# Requires: nargo 1.0.0-beta.16 (must match @noir-lang/* npm packages)
#

set -e  # Exit on error
set -u  # Exit on undefined variable

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
CIRCUIT_DIR="noir/three_tree_membership"
CIRCUIT_SRC="${CIRCUIT_DIR}/src/main.nr"
CIRCUIT_BACKUP="${CIRCUIT_DIR}/src/main.nr.bak"
TARGET_DIR="${CIRCUIT_DIR}/target"
OUTPUT_DIR="../noir-prover/circuits"
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

    # Verify nargo version matches npm packages
    REQUIRED_NARGO="1.0.0-beta.16"
    if command -v nargo &> /dev/null; then
        ACTUAL_NARGO=$(nargo --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+-beta\.[0-9]+' || echo "unknown")
        if [ "$ACTUAL_NARGO" != "$REQUIRED_NARGO" ]; then
            log_warn "nargo $REQUIRED_NARGO required (matching @noir-lang/* npm packages), got $ACTUAL_NARGO"
            log_warn "Version mismatch may produce incompatible circuit artifacts."
        fi
    fi

    # Check nargo is installed
    if ! command -v nargo &> /dev/null; then
        log_error "nargo not found in PATH"
        log_error "Install Noir: https://noir-lang.org/docs/getting_started/installation"
        exit 1
    fi

    # Check we're in the right directory
    if [[ ! -f "${CIRCUIT_SRC}" ]]; then
        log_error "Circuit source not found: ${CIRCUIT_SRC}"
        log_error "Run this script from packages/crypto directory"
        exit 1
    fi

    # Check output directory exists
    if [[ ! -d "${OUTPUT_DIR}" ]]; then
        log_warn "Output directory not found: ${OUTPUT_DIR}"
        log_info "Creating output directory..."
        mkdir -p "${OUTPUT_DIR}"
    fi

    log_info "Prerequisites OK (nargo $(nargo --version | head -1))"
}

# Backup original circuit
backup_original() {
    log_info "Backing up original circuit..."
    cp "${CIRCUIT_SRC}" "${CIRCUIT_BACKUP}"
}

# Restore original circuit (copy, don't move, to preserve backup)
restore_original() {
    if [[ -f "${CIRCUIT_BACKUP}" ]]; then
        cp "${CIRCUIT_BACKUP}" "${CIRCUIT_SRC}"
    fi
}

# Final cleanup - remove backup
cleanup_backup() {
    log_info "Cleaning up backup..."
    if [[ -f "${CIRCUIT_BACKUP}" ]]; then
        rm "${CIRCUIT_BACKUP}"
    fi
}

# Compile circuit for specific depth
compile_for_depth() {
    local depth=$1
    log_info "Compiling circuit for TREE_DEPTH=${depth}..."

    # Replace TREE_DEPTH constant in source
    # Uses platform-agnostic sed (works on macOS and Linux)
    # Note: [0-9][0-9]* is basic regex compatible with both BSD and GNU sed
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS sed requires -i with backup extension
        sed -i.tmp "s/global TREE_DEPTH: u32 = [0-9][0-9]*;/global TREE_DEPTH: u32 = ${depth};/" "${CIRCUIT_SRC}"
        rm "${CIRCUIT_SRC}.tmp"
    else
        # Linux sed supports extended regex
        sed -i "s/global TREE_DEPTH: u32 = [0-9]\+;/global TREE_DEPTH: u32 = ${depth};/" "${CIRCUIT_SRC}"
    fi

    # Verify replacement worked
    if ! grep -q "global TREE_DEPTH: u32 = ${depth};" "${CIRCUIT_SRC}"; then
        log_error "Failed to replace TREE_DEPTH constant (expected 'global TREE_DEPTH: u32 = ${depth};')"
        log_error "Current line: $(grep 'global TREE_DEPTH' ${CIRCUIT_SRC})"
        restore_original
        exit 1
    fi

    # Compile circuit
    log_info "Running: nargo compile --package three_tree_membership"
    (cd "${CIRCUIT_DIR}" && nargo compile)

    # Check compilation succeeded
    if [[ ! -f "${TARGET_DIR}/three_tree_membership.json" ]]; then
        log_error "Compilation failed - no output JSON"
        restore_original
        exit 1
    fi

    # Rename output to depth-specific name in target dir
    local target_file="${TARGET_DIR}/three_tree_membership_${depth}.json"
    mv "${TARGET_DIR}/three_tree_membership.json" "${target_file}"
    log_info "Created: ${target_file}"

    # Copy to noir-prover circuits directory
    local output_file="${OUTPUT_DIR}/three_tree_membership_${depth}.json"
    cp "${target_file}" "${output_file}"
    log_info "Copied to: ${output_file}"

    # Verify output file size is reasonable (should be >10KB)
    local file_size=$(wc -c < "${target_file}" | tr -d ' ')
    if [[ ${file_size} -lt 10000 ]]; then
        log_warn "Output file suspiciously small (${file_size} bytes)"
    fi
}

# Clean old build artifacts
clean_artifacts() {
    log_info "Cleaning old build artifacts..."

    # Remove old depth-specific JSONs from target dir
    for depth in "${DEPTHS[@]}"; do
        local artifact="${TARGET_DIR}/three_tree_membership_${depth}.json"
        if [[ -f "${artifact}" ]]; then
            rm "${artifact}"
            log_info "Removed old artifact: ${artifact}"
        fi
    done

    # Remove generic output if exists
    if [[ -f "${TARGET_DIR}/three_tree_membership.json" ]]; then
        rm "${TARGET_DIR}/three_tree_membership.json"
    fi
}

# Main build pipeline
main() {
    log_info "=== Three-Tree Membership Circuit Build ==="
    log_info "Building circuits for depths: ${DEPTHS[*]}"

    check_prerequisites
    clean_artifacts
    backup_original

    # Compile for each depth
    for depth in "${DEPTHS[@]}"; do
        compile_for_depth "${depth}"
        restore_original  # Restore after each compilation for next iteration
    done

    # Final cleanup - remove backup
    cleanup_backup

    log_info "=== Build Complete ==="
    log_info "Generated circuits:"
    for depth in "${DEPTHS[@]}"; do
        local target="${TARGET_DIR}/three_tree_membership_${depth}.json"
        local size=$(wc -c < "${target}" | tr -d ' ')
        log_info "  - TREE_DEPTH=${depth}: ${target} (${size} bytes)"
    done

    log_info ""
    log_info "Circuits also copied to: ${OUTPUT_DIR}/"
    log_info "Remember to rebuild noir-prover after updating circuits: cd ../noir-prover && npm run build"
}

# Cleanup trap - ensure original is restored even on error
cleanup_on_error() {
    log_error "Build failed, restoring original circuit..."
    restore_original
    cleanup_backup
}
trap cleanup_on_error ERR

# Run main pipeline
main
