#!/bin/bash
#
# Build District Membership Circuits - Multi-Depth Compilation
#
# Compiles the district_membership Noir circuit at 3 different Merkle depths:
# - DEPTH=14: Municipal (city council, ~16K leaves)
# - DEPTH=20: State (congressional districts, ~1M leaves)
# - DEPTH=22: Federal (national boundaries, ~4M leaves)
#
# PROCESS:
# 1. Backup original main.nr
# 2. For each depth:
#    a. Replace `global DEPTH: u32 = 14` with target depth
#    b. Compile with nargo
#    c. Rename output to district_membership_{depth}.json
#    d. Restore original
#
# USAGE:
#   ./scripts/build-circuits.sh
#
# REQUIREMENTS:
#   - nargo (Noir compiler) installed and in PATH
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
CIRCUIT_SRC="${CIRCUIT_DIR}/src/main.nr"
CIRCUIT_BACKUP="${CIRCUIT_DIR}/src/main.nr.bak"
TARGET_DIR="${CIRCUIT_DIR}/target"
DEPTHS=(14 20 22)

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
    log_info "Compiling circuit for DEPTH=${depth}..."

    # Replace DEPTH constant in source
    # Uses platform-agnostic sed (works on macOS and Linux)
    # Note: [0-9][0-9]* is basic regex compatible with both BSD and GNU sed
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS sed requires -i with backup extension
        sed -i.tmp "s/global DEPTH: u32 = [0-9][0-9]*;/global DEPTH: u32 = ${depth};/" "${CIRCUIT_SRC}"
        rm "${CIRCUIT_SRC}.tmp"
    else
        # Linux sed supports extended regex
        sed -i "s/global DEPTH: u32 = [0-9]\+;/global DEPTH: u32 = ${depth};/" "${CIRCUIT_SRC}"
    fi

    # Verify replacement worked
    if ! grep -q "global DEPTH: u32 = ${depth};" "${CIRCUIT_SRC}"; then
        log_error "Failed to replace DEPTH constant (expected 'global DEPTH: u32 = ${depth};')"
        log_error "Current line: $(grep 'global DEPTH' ${CIRCUIT_SRC})"
        restore_original
        exit 1
    fi

    # Compile circuit
    log_info "Running: nargo compile --package district_membership"
    (cd "${CIRCUIT_DIR}" && nargo compile)

    # Check compilation succeeded
    if [[ ! -f "${TARGET_DIR}/district_membership.json" ]]; then
        log_error "Compilation failed - no output JSON"
        restore_original
        exit 1
    fi

    # Rename output to depth-specific name
    local output_file="${TARGET_DIR}/district_membership_${depth}.json"
    mv "${TARGET_DIR}/district_membership.json" "${output_file}"
    log_info "Created: ${output_file}"

    # Verify output file size is reasonable (should be >10KB)
    local file_size=$(wc -c < "${output_file}" | tr -d ' ')
    if [[ ${file_size} -lt 10000 ]]; then
        log_warn "Output file suspiciously small (${file_size} bytes)"
    fi
}

# Clean old build artifacts
clean_artifacts() {
    log_info "Cleaning old build artifacts..."

    # Remove old depth-specific JSONs
    for depth in "${DEPTHS[@]}"; do
        local artifact="${TARGET_DIR}/district_membership_${depth}.json"
        if [[ -f "${artifact}" ]]; then
            rm "${artifact}"
            log_info "Removed old artifact: ${artifact}"
        fi
    done

    # Remove generic output if exists
    if [[ -f "${TARGET_DIR}/district_membership.json" ]]; then
        rm "${TARGET_DIR}/district_membership.json"
    fi
}

# Main build pipeline
main() {
    log_info "=== District Membership Circuit Build ==="
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
        local output="${TARGET_DIR}/district_membership_${depth}.json"
        local size=$(wc -c < "${output}" | tr -d ' ')
        log_info "  - DEPTH=${depth}: ${output} (${size} bytes)"
    done
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
