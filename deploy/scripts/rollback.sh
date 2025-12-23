#!/bin/bash
#
# Shadow Atlas Rollback Script
#
# USAGE:
#   ./rollback.sh <environment> [revision]
#
# EXAMPLES:
#   ./rollback.sh production           # Rollback to previous revision
#   ./rollback.sh staging 3            # Rollback to specific revision
#
# REQUIREMENTS:
#   - kubectl configured with appropriate context

set -euo pipefail

# ============================================================================
# Configuration
# ============================================================================

ENVIRONMENT="${1:-staging}"
REVISION="${2:-0}"  # 0 means previous revision
NAMESPACE="shadow-atlas-${ENVIRONMENT}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ============================================================================
# Helper Functions
# ============================================================================

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

get_current_revision() {
    kubectl rollout history deployment/shadow-atlas \
        -n "$NAMESPACE" \
        --revision=0 \
        | grep -oP '(?<=REVISION:).*?(?=CHANGE)' \
        | head -1 \
        | xargs
}

show_rollout_history() {
    log_info "Rollout history:"
    kubectl rollout history deployment/shadow-atlas -n "$NAMESPACE"
}

rollback() {
    log_info "Rolling back Shadow Atlas in $ENVIRONMENT..."

    CURRENT_REVISION=$(get_current_revision)
    log_info "Current revision: $CURRENT_REVISION"

    if [ "$REVISION" -eq 0 ]; then
        log_info "Rolling back to previous revision"
        kubectl rollout undo deployment/shadow-atlas -n "$NAMESPACE"
    else
        log_info "Rolling back to revision $REVISION"
        kubectl rollout undo deployment/shadow-atlas \
            -n "$NAMESPACE" \
            --to-revision="$REVISION"
    fi

    # Wait for rollback to complete
    log_info "Waiting for rollback to complete..."
    kubectl rollout status deployment/shadow-atlas \
        -n "$NAMESPACE" \
        --timeout=10m

    log_info "Rollback complete"
}

verify_rollback() {
    log_info "Verifying rollback..."

    # Check pod status
    READY_PODS=$(kubectl get pods -n "$NAMESPACE" -l app=shadow-atlas -o jsonpath='{.items[*].status.containerStatuses[0].ready}' | tr ' ' '\n' | grep -c "true" || echo "0")
    TOTAL_PODS=$(kubectl get pods -n "$NAMESPACE" -l app=shadow-atlas --no-headers | wc -l)

    log_info "Ready pods: $READY_PODS/$TOTAL_PODS"

    if [ "$READY_PODS" -eq 0 ]; then
        log_error "No pods are ready after rollback"
        exit 1
    fi

    # Health check
    sleep 10  # Wait for service to stabilize

    if [ "$ENVIRONMENT" == "production" ]; then
        SERVICE_URL="https://shadow-atlas.voter-protocol.org"
    else
        SERVICE_URL="https://staging-shadow-atlas.voter-protocol.org"
    fi

    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$SERVICE_URL/health" || echo "000")

    if [ "$HTTP_STATUS" != "200" ]; then
        log_error "Health check failed after rollback: HTTP $HTTP_STATUS"
        exit 1
    fi

    log_info "Rollback verification passed"
}

# ============================================================================
# Main Execution
# ============================================================================

main() {
    log_info "Shadow Atlas Rollback"
    log_info "Environment: $ENVIRONMENT"
    log_info "Namespace: $NAMESPACE"
    echo ""

    # Confirm rollback
    log_warn "You are about to ROLLBACK the deployment in $ENVIRONMENT"
    show_rollout_history
    echo ""

    read -p "Are you sure you want to proceed? (yes/no): " CONFIRM

    if [ "$CONFIRM" != "yes" ]; then
        log_info "Rollback cancelled"
        exit 0
    fi

    rollback
    verify_rollback

    log_info "✅ Rollback successful!"
    log_info "New revision: $(get_current_revision)"
}

main
