#!/bin/bash
#
# Build Bubble Membership Circuit - Single Compilation
#
# Compiles the bubble_membership Noir circuit and copies the artifact to the
# noir-prover circuits directory for use by BubbleMembershipProver.
#
# The bubble_membership circuit proves a verified user commits to a set of H3
# hexagonal cells (community field Phase 2). Identity binding via Tree 3
# (engagement tree) prevents Sybil attacks on epoch nullifiers.
#
# CIRCUIT:
#   Verifies Tree 3 membership (identity binding)
#   Builds cell set Merkle tree (depth 4, MAX_CELLS=16)
#   Computes epoch_nullifier = H2(identity_commitment, epoch_domain)
#   Returns (cell_set_root, epoch_nullifier, cell_count)
#
# NOTE: Unlike three_tree_membership, this circuit does NOT have depth variants.
# The engagement tree depth (TREE_DEPTH) is fixed at 20 for Phase 2. If multi-depth
# support is needed later, follow the three_tree_membership build pattern.
#
# USAGE:
#   ./scripts/build-bubble-membership-circuit.sh
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
CIRCUIT_DIR="noir/bubble_membership"
CIRCUIT_SRC="${CIRCUIT_DIR}/src/main.nr"
TARGET_DIR="${CIRCUIT_DIR}/target"
OUTPUT_DIR="../noir-prover/circuits"
ARTIFACT_NAME="bubble_membership.json"

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

    # Verify nargo version matches npm packages — HARD FAIL on mismatch
    # Rationale: nargo beta versions change ACIR encoding, witness format, and proof structure.
    # A version mismatch between the compiler and the TS prover produces artifacts that silently
    # fail to generate proofs or verify on-chain. See BR7-003, TRUST-MODEL Section 4.4.
    REQUIRED_NARGO="1.0.0-beta.16"
    if command -v nargo &> /dev/null; then
        ACTUAL_NARGO=$(nargo --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+-beta\.[0-9]+' || echo "unknown")
        if [ "$ACTUAL_NARGO" != "$REQUIRED_NARGO" ]; then
            log_error "nargo $REQUIRED_NARGO required (matching @noir-lang/* npm packages), got $ACTUAL_NARGO"
            log_error "Version mismatch produces incompatible circuit artifacts. Aborting."
            log_error "Install correct version: noirup -v $REQUIRED_NARGO"
            exit 1
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

    # Check output directory exists — create if missing
    if [[ ! -d "${OUTPUT_DIR}" ]]; then
        log_warn "Output directory not found: ${OUTPUT_DIR}"
        log_info "Creating output directory..."
        mkdir -p "${OUTPUT_DIR}"
    fi

    log_info "Prerequisites OK (nargo $(nargo --version | head -1))"
}

# Clean old build artifacts
clean_artifacts() {
    log_info "Cleaning old build artifacts..."

    if [[ -f "${TARGET_DIR}/${ARTIFACT_NAME}" ]]; then
        rm "${TARGET_DIR}/${ARTIFACT_NAME}"
        log_info "Removed old artifact: ${TARGET_DIR}/${ARTIFACT_NAME}"
    fi

    if [[ -f "${OUTPUT_DIR}/${ARTIFACT_NAME}" ]]; then
        rm "${OUTPUT_DIR}/${ARTIFACT_NAME}"
        log_info "Removed old artifact: ${OUTPUT_DIR}/${ARTIFACT_NAME}"
    fi
}

# Compile circuit
compile_circuit() {
    log_info "Compiling bubble_membership circuit..."
    log_info "Running: nargo compile (in ${CIRCUIT_DIR})"

    (cd "${CIRCUIT_DIR}" && nargo compile)

    # Check compilation succeeded
    if [[ ! -f "${TARGET_DIR}/${ARTIFACT_NAME}" ]]; then
        log_error "Compilation failed - no output JSON found at ${TARGET_DIR}/${ARTIFACT_NAME}"
        exit 1
    fi

    log_info "Compiled: ${TARGET_DIR}/${ARTIFACT_NAME}"
}

# Copy artifact to noir-prover circuits directory
copy_artifact() {
    log_info "Copying artifact to noir-prover circuits directory..."

    cp "${TARGET_DIR}/${ARTIFACT_NAME}" "${OUTPUT_DIR}/${ARTIFACT_NAME}"
    log_info "Copied to: ${OUTPUT_DIR}/${ARTIFACT_NAME}"
}

# Verify output
verify_output() {
    log_info "Verifying output..."

    # Verify target file
    if [[ ! -f "${TARGET_DIR}/${ARTIFACT_NAME}" ]]; then
        log_error "Target artifact missing: ${TARGET_DIR}/${ARTIFACT_NAME}"
        exit 1
    fi

    # Verify noir-prover copy
    if [[ ! -f "${OUTPUT_DIR}/${ARTIFACT_NAME}" ]]; then
        log_error "Output artifact missing: ${OUTPUT_DIR}/${ARTIFACT_NAME}"
        exit 1
    fi

    # Check file size is reasonable
    local file_size
    file_size=$(wc -c < "${TARGET_DIR}/${ARTIFACT_NAME}" | tr -d ' ')
    if [[ ${file_size} -lt 10000 ]]; then
        log_warn "Output file suspiciously small (${file_size} bytes) — circuit may not have compiled correctly"
    else
        log_info "Artifact size: ${file_size} bytes (OK)"
    fi
}

# Main build pipeline
main() {
    log_info "=== Bubble Membership Circuit Build ==="
    log_info "Circuit: bubble_membership (single variant, Tree 3 depth 20)"

    check_prerequisites
    clean_artifacts
    compile_circuit
    copy_artifact
    verify_output

    log_info "=== Build Complete ==="
    log_info "Generated circuit:"
    log_info "  - Target:   ${TARGET_DIR}/${ARTIFACT_NAME}"
    log_info "  - Prover:   ${OUTPUT_DIR}/${ARTIFACT_NAME}"
    log_info ""
    log_info "Remember to rebuild noir-prover after updating circuits:"
    log_info "  cd ../noir-prover && npm run build"
}

# Run main pipeline
main
