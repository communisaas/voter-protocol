#!/bin/bash
#
# Build Position Note Circuit - Single Compilation
#
# Compiles the position_note Noir circuit and copies the artifact to the
# noir-prover circuits directory for use by PositionNoteNoirProver.
#
# The position_note circuit is a Merkle membership + nullifier circuit with
# NO depth variants. There is only one artifact:
#   position_note.json
#
# CIRCUIT:
#   commitment = H_PCM(argument_index, weighted_amount, randomness)
#   Merkle membership proof (depth 20, ~1M positions)
#   nullifier  = H_PNL(nullifier_key, commitment, debate_id)
#
# DOMAIN SEPARATION:
#   DOMAIN_POS_COMMIT = 0x50434d ("PCM") — position commitment
#   DOMAIN_POS_NUL    = 0x504e4c ("PNL") — position nullifier
#   DOMAIN_HASH2      = 0x48324d ("H2M") — shared Merkle node hash
#
# USAGE:
#   ./scripts/build-position-note-circuit.sh
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
CIRCUIT_DIR="noir/position_note"
CIRCUIT_SRC="${CIRCUIT_DIR}/src/main.nr"
TARGET_DIR="${CIRCUIT_DIR}/target"
OUTPUT_DIR="../noir-prover/circuits"
ARTIFACT_NAME="position_note.json"

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
    log_info "Compiling position_note circuit..."
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

    # Check file size is reasonable (should be >10KB for a valid circuit)
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
    log_info "=== Position Note Circuit Build ==="
    log_info "Circuit: position_note (single variant, depth=20, ~1M positions)"
    log_info "Domain tags: PCM=0x50434d, PNL=0x504e4c, H2M=0x48324d"

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
