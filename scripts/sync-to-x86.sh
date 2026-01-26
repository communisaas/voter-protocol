#!/bin/bash
#
# Sync voter-protocol to x86 build box
#
# Used for running tools that require x86 architecture (e.g., bb CLI for verifier generation)
#
# USAGE:
#   ./scripts/sync-to-x86.sh                    # Sync entire project
#   ./scripts/sync-to-x86.sh --dry-run          # Preview what would be synced
#   ./scripts/sync-to-x86.sh --user=root        # Specify remote user
#   SSH_USER=ubuntu ./scripts/sync-to-x86.sh   # Via environment variable
#

set -e

# Configuration
REMOTE_IP="100.82.94.106"
REMOTE_USER="${SSH_USER:-}"  # Empty = use SSH config default
REMOTE_DIR="${REMOTE_PATH:-/home/voter-protocol}"
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[SYNC]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Parse args
DRY_RUN=""
for arg in "$@"; do
    case $arg in
        --dry-run)
            DRY_RUN="--dry-run"
            log_warn "Dry run mode - no files will be transferred"
            ;;
        --user=*)
            REMOTE_USER="${arg#*=}"
            ;;
    esac
done

# Build remote host string
if [[ -n "${REMOTE_USER}" ]]; then
    REMOTE_HOST="${REMOTE_USER}@${REMOTE_IP}"
else
    REMOTE_HOST="${REMOTE_IP}"
fi

log_info "Syncing to ${REMOTE_HOST}:${REMOTE_DIR}"
log_info "Local: ${LOCAL_DIR}"

# Ensure remote directory exists
ssh "${REMOTE_HOST}" "mkdir -p ${REMOTE_DIR}"

# Sync with rsync
# Excludes: node_modules, dist, .git, target (build artifacts)
rsync -avz --progress ${DRY_RUN} \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude '.git' \
    --exclude 'target' \
    --exclude '*.log' \
    --exclude '.DS_Store' \
    --exclude 'coverage' \
    --exclude '.turbo' \
    --exclude '.next' \
    "${LOCAL_DIR}/" "${REMOTE_HOST}:${REMOTE_DIR}/"

log_info "Sync complete!"
log_info ""
log_info "To generate verifiers on x86 box:"
log_info "  ssh ${REMOTE_HOST}"
log_info "  cd ${REMOTE_DIR}/packages/crypto"
log_info "  ./scripts/generate-verifiers.sh"
