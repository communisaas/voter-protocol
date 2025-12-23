#!/bin/bash
#
# Shadow Atlas Deployment Script
#
# USAGE:
#   ./deploy.sh <environment> <image_tag>
#
# EXAMPLES:
#   ./deploy.sh staging v1.0.0
#   ./deploy.sh production v1.0.0
#
# REQUIREMENTS:
#   - kubectl configured with appropriate context
#   - Valid kubeconfig for target environment
#   - Container image already built and pushed to registry

set -euo pipefail

# ============================================================================
# Configuration
# ============================================================================

ENVIRONMENT="${1:-staging}"
IMAGE_TAG="${2:-latest}"
NAMESPACE="shadow-atlas-${ENVIRONMENT}"
IMAGE_NAME="ghcr.io/voter-protocol/shadow-atlas:${IMAGE_TAG}"

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

check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check kubectl
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl is not installed"
        exit 1
    fi

    # Check namespace
    if ! kubectl get namespace "$NAMESPACE" &> /dev/null; then
        log_error "Namespace $NAMESPACE does not exist"
        exit 1
    fi

    log_info "Prerequisites check passed"
}

verify_image() {
    log_info "Verifying container image: $IMAGE_NAME"

    # Check if image exists in registry
    if ! docker manifest inspect "$IMAGE_NAME" &> /dev/null; then
        log_error "Image $IMAGE_NAME not found in registry"
        exit 1
    fi

    log_info "Image verified"
}

deploy() {
    log_info "Deploying Shadow Atlas to $ENVIRONMENT..."

    # Update deployment with new image
    kubectl set image deployment/shadow-atlas \
        shadow-atlas="$IMAGE_NAME" \
        -n "$NAMESPACE"

    # Wait for rollout to complete
    log_info "Waiting for rollout to complete..."
    kubectl rollout status deployment/shadow-atlas \
        -n "$NAMESPACE" \
        --timeout=10m

    log_info "Deployment complete"
}

verify_deployment() {
    log_info "Verifying deployment..."

    # Check pod status
    READY_PODS=$(kubectl get pods -n "$NAMESPACE" -l app=shadow-atlas -o jsonpath='{.items[*].status.containerStatuses[0].ready}' | tr ' ' '\n' | grep -c "true" || echo "0")
    TOTAL_PODS=$(kubectl get pods -n "$NAMESPACE" -l app=shadow-atlas --no-headers | wc -l)

    log_info "Ready pods: $READY_PODS/$TOTAL_PODS"

    if [ "$READY_PODS" -eq 0 ]; then
        log_error "No pods are ready"
        exit 1
    fi

    # Check service endpoints
    ENDPOINTS=$(kubectl get endpoints -n "$NAMESPACE" shadow-atlas -o jsonpath='{.subsets[*].addresses[*].ip}' | wc -w)
    log_info "Service endpoints: $ENDPOINTS"

    if [ "$ENDPOINTS" -eq 0 ]; then
        log_error "No service endpoints available"
        exit 1
    fi

    log_info "Deployment verification passed"
}

run_smoke_tests() {
    log_info "Running smoke tests..."

    # Get service URL
    if [ "$ENVIRONMENT" == "production" ]; then
        SERVICE_URL="https://shadow-atlas.voter-protocol.org"
    else
        SERVICE_URL="https://staging-shadow-atlas.voter-protocol.org"
    fi

    # Health check
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$SERVICE_URL/health")

    if [ "$HTTP_STATUS" != "200" ]; then
        log_error "Health check failed: HTTP $HTTP_STATUS"
        exit 1
    fi

    log_info "Smoke tests passed"
}

# ============================================================================
# Main Execution
# ============================================================================

main() {
    log_info "Shadow Atlas Deployment"
    log_info "Environment: $ENVIRONMENT"
    log_info "Image: $IMAGE_NAME"
    log_info "Namespace: $NAMESPACE"
    echo ""

    # Confirm deployment
    if [ "$ENVIRONMENT" == "production" ]; then
        log_warn "You are about to deploy to PRODUCTION"
        read -p "Are you sure? (yes/no): " CONFIRM

        if [ "$CONFIRM" != "yes" ]; then
            log_info "Deployment cancelled"
            exit 0
        fi
    fi

    check_prerequisites
    verify_image
    deploy
    verify_deployment
    run_smoke_tests

    log_info "✅ Deployment successful!"
}

main
