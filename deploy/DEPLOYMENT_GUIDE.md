# Shadow Atlas Deployment Guide

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Environment Setup](#environment-setup)
4. [Deployment Procedures](#deployment-procedures)
5. [Rollback Procedures](#rollback-procedures)
6. [Monitoring and Observability](#monitoring-and-observability)
7. [Troubleshooting](#troubleshooting)
8. [Security Considerations](#security-considerations)

---

## Overview

Shadow Atlas is deployed using a **blue-green deployment strategy** with zero-downtime updates. This guide covers production-grade deployment to Kubernetes clusters with comprehensive CI/CD automation.

### Architecture

- **Container Runtime**: Docker (multi-stage builds)
- **Orchestration**: Kubernetes 1.28+
- **CI/CD**: GitHub Actions
- **Container Registry**: GitHub Container Registry (GHCR)
- **Deployment Strategy**: Blue-Green with automatic rollback
- **Environment Parity**: Dev → Staging → Production

---

## Prerequisites

### Required Tools

```bash
# Kubernetes CLI
kubectl version --client  # 1.28+

# Docker
docker --version          # 20.10+

# Node.js
node --version            # 20.x

# jq (for JSON parsing)
jq --version              # 1.6+
```

### Access Requirements

1. **GitHub Container Registry**:
   - GitHub personal access token with `write:packages` scope
   - Configure Docker authentication:
     ```bash
     echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin
     ```

2. **Kubernetes Cluster**:
   - Valid kubeconfig for target environment
   - Namespace permissions: `shadow-atlas-staging` / `shadow-atlas-production`
   - RBAC permissions for deployments, services, ingress

3. **Secrets**:
   - `KUBE_CONFIG_STAGING` (base64-encoded kubeconfig)
   - `KUBE_CONFIG_PRODUCTION` (base64-encoded kubeconfig)
   - `DEPLOYER_PRIVATE_KEY` (for on-chain registry updates)
   - `SCROLL_RPC_URL` (Scroll zkEVM RPC endpoint)
   - `PINATA_API_KEY` / `PINATA_SECRET_KEY` (optional, for IPFS pinning)
   - `CODECOV_TOKEN` (optional, for coverage reporting)
   - `SLACK_WEBHOOK_URL` (optional, for notifications)

---

## Environment Setup

### Local Development

```bash
# Navigate to deployment directory
cd packages/crypto/services/shadow-atlas/deploy

# Start local development environment
docker-compose up -d

# Verify services
docker-compose ps

# View logs
docker-compose logs -f shadow-atlas

# Stop environment
docker-compose down
```

### Environment Variables

Create `.env` files for each environment:

**`.env.staging`**:
```bash
NODE_ENV=staging
PORT=3000
DATA_DIR=/app/data
LOG_LEVEL=debug

# Database
DB_PATH=/app/data/shadow-atlas.db

# IPFS
IPFS_GATEWAY_URL=https://ipfs.io

# API
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000
```

**`.env.production`**:
```bash
NODE_ENV=production
PORT=3000
DATA_DIR=/app/data
LOG_LEVEL=info

# Database
DB_PATH=/app/data/shadow-atlas.db

# IPFS
IPFS_GATEWAY_URL=https://ipfs.io

# API
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX=50
RATE_LIMIT_WINDOW_MS=60000
```

### Secret Management

**DO NOT commit secrets to version control.**

Store secrets in GitHub repository settings:
1. Navigate to: `Settings → Secrets and variables → Actions`
2. Add repository secrets (listed in Prerequisites)
3. For local development, use `.env` files (gitignored)

---

## Deployment Procedures

### Automated Deployment (Recommended)

#### Staging Deployment

1. **Trigger via Pull Request**:
   ```bash
   # CI runs automatically on PR
   # - Lint, typecheck, unit tests, integration tests
   # - Build Docker image
   # - Deploy to staging
   # - Run E2E tests
   ```

2. **Manual Deployment**:
   ```bash
   # Navigate to GitHub Actions
   # Select "Shadow Atlas CD" workflow
   # Click "Run workflow"
   # Choose environment: staging
   ```

#### Production Deployment

1. **Release-based (Recommended)**:
   ```bash
   # Create GitHub release
   git tag v1.0.0
   git push origin v1.0.0

   # GitHub Release triggers CD workflow:
   # 1. Full test suite
   # 2. Build production image
   # 3. Deploy to staging
   # 4. E2E tests on staging
   # 5. Deploy to production (blue-green)
   # 6. Verify production
   # 7. Automatic rollback on failure
   ```

2. **Manual Deployment**:
   ```bash
   # Navigate to GitHub Actions
   # Select "Shadow Atlas CD" workflow
   # Click "Run workflow"
   # Choose environment: production
   # Confirm deployment
   ```

### Manual Deployment (Advanced)

#### Build Container Image

```bash
cd packages/crypto

# Build image
docker build \
  -t ghcr.io/voter-protocol/shadow-atlas:v1.0.0 \
  -f services/shadow-atlas/deploy/Dockerfile \
  .

# Push to registry
docker push ghcr.io/voter-protocol/shadow-atlas:v1.0.0
```

#### Deploy to Kubernetes

```bash
# Set context
kubectl config use-context <staging-context>

# Create namespace (first time only)
kubectl apply -f deploy/kubernetes/namespace.yaml

# Deploy resources
kubectl apply -f deploy/kubernetes/deployment.yaml
kubectl apply -f deploy/kubernetes/service.yaml
kubectl apply -f deploy/kubernetes/ingress.yaml
kubectl apply -f deploy/kubernetes/hpa.yaml

# Update image
kubectl set image deployment/shadow-atlas \
  shadow-atlas=ghcr.io/voter-protocol/shadow-atlas:v1.0.0 \
  -n shadow-atlas-staging

# Monitor rollout
kubectl rollout status deployment/shadow-atlas \
  -n shadow-atlas-staging \
  --timeout=10m
```

#### Using Deployment Script

```bash
cd packages/crypto/services/shadow-atlas/deploy/scripts

# Deploy to staging
./deploy.sh staging v1.0.0

# Deploy to production (requires confirmation)
./deploy.sh production v1.0.0
```

---

## Rollback Procedures

### Automatic Rollback

CD workflow automatically rolls back on:
- E2E test failures on staging
- Production verification failures
- High error rates (>10 errors per 1000 log lines)

### Manual Rollback

#### Using GitHub Actions

```bash
# 1. Navigate to failed deployment run
# 2. Re-run "Rollback Production" job
# 3. Verify rollback via monitoring
```

#### Using Rollback Script

```bash
cd packages/crypto/services/shadow-atlas/deploy/scripts

# Rollback to previous revision
./rollback.sh production

# Rollback to specific revision
./rollback.sh production 5
```

#### Using kubectl

```bash
# View rollout history
kubectl rollout history deployment/shadow-atlas \
  -n shadow-atlas-production

# Undo to previous revision
kubectl rollout undo deployment/shadow-atlas \
  -n shadow-atlas-production

# Undo to specific revision
kubectl rollout undo deployment/shadow-atlas \
  -n shadow-atlas-production \
  --to-revision=5

# Monitor rollback
kubectl rollout status deployment/shadow-atlas \
  -n shadow-atlas-production
```

### Blue-Green Rollback

```bash
# Switch traffic back to blue deployment
kubectl patch service shadow-atlas \
  -n shadow-atlas-production \
  -p '{"spec":{"selector":{"version":"blue"}}}'

# Scale up blue
kubectl scale deployment shadow-atlas-blue \
  -n shadow-atlas-production \
  --replicas=3

# Scale down green
kubectl scale deployment shadow-atlas-green \
  -n shadow-atlas-production \
  --replicas=0
```

---

## Monitoring and Observability

### Health Checks

**Endpoint**: `GET /health`

```bash
# Local
curl http://localhost:3000/health

# Staging
curl https://staging-shadow-atlas.voter-protocol.org/health

# Production
curl https://shadow-atlas.voter-protocol.org/health
```

**Expected Response**:
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "timestamp": "2025-01-15T12:00:00.000Z",
  "uptime": 3600
}
```

### Kubernetes Monitoring

```bash
# Pod status
kubectl get pods -n shadow-atlas-production -l app=shadow-atlas

# Pod logs
kubectl logs -n shadow-atlas-production \
  -l app=shadow-atlas \
  --tail=100 \
  -f

# Service endpoints
kubectl get endpoints -n shadow-atlas-production shadow-atlas

# Resource usage
kubectl top pods -n shadow-atlas-production -l app=shadow-atlas

# Events
kubectl get events -n shadow-atlas-production \
  --sort-by='.lastTimestamp'
```

### Metrics

**Prometheus Integration**:
- Scrape endpoint: `GET /metrics`
- Annotations configured in deployment manifests
- Default port: 3000

**Key Metrics**:
- `http_requests_total` - Total HTTP requests
- `http_request_duration_seconds` - Request duration histogram
- `shadow_atlas_queries_total` - Total boundary queries
- `shadow_atlas_cache_hit_rate` - Cache hit rate

### Log Aggregation

**Structured Logging**:
- Format: JSON
- Fields: `timestamp`, `level`, `message`, `context`, `error`

**Example**:
```json
{
  "timestamp": "2025-01-15T12:00:00.000Z",
  "level": "info",
  "message": "Boundary query successful",
  "context": {
    "lat": 40.7128,
    "lng": -74.0060,
    "district": "NY-12"
  }
}
```

---

## Troubleshooting

### Deployment Failures

#### Pod CrashLoopBackOff

```bash
# Check pod status
kubectl describe pod <pod-name> -n shadow-atlas-production

# Check logs
kubectl logs <pod-name> -n shadow-atlas-production

# Common causes:
# 1. Missing environment variables
# 2. Database connection issues
# 3. Resource limits (OOMKilled)
# 4. Invalid configuration
```

#### ImagePullBackOff

```bash
# Check image pull status
kubectl describe pod <pod-name> -n shadow-atlas-production

# Common causes:
# 1. Image doesn't exist in registry
# 2. Authentication issues (imagePullSecrets)
# 3. Network connectivity to registry
```

#### Rollout Timeout

```bash
# Check rollout status
kubectl rollout status deployment/shadow-atlas \
  -n shadow-atlas-production

# Check readiness probes
kubectl describe deployment shadow-atlas \
  -n shadow-atlas-production

# Common causes:
# 1. Readiness probe failures
# 2. Resource constraints
# 3. Application startup issues
```

### Service Issues

#### 502 Bad Gateway

```bash
# Check service endpoints
kubectl get endpoints shadow-atlas -n shadow-atlas-production

# Check pod readiness
kubectl get pods -n shadow-atlas-production -l app=shadow-atlas

# Common causes:
# 1. No healthy pods
# 2. Readiness probe failures
# 3. Network policy blocking traffic
```

#### High Latency

```bash
# Check resource usage
kubectl top pods -n shadow-atlas-production -l app=shadow-atlas

# Check HPA status
kubectl get hpa -n shadow-atlas-production

# Common causes:
# 1. CPU throttling
# 2. Memory pressure
# 3. Database performance
# 4. Network latency
```

### CI/CD Issues

#### Test Failures

```bash
# Run tests locally
cd packages/crypto
npm run test:atlas

# Check CI logs in GitHub Actions
# Review test artifacts for detailed failure logs
```

#### Build Failures

```bash
# Build locally
npm run build

# Check TypeScript errors
npx tsc --noEmit

# Common causes:
# 1. TypeScript compilation errors
# 2. Missing dependencies
# 3. Linting failures
```

---

## Security Considerations

### Container Security

**Image Scanning**:
- GitHub Actions runs Anchore SBOM generation
- Scan for CVEs before deployment
- Use distroless base images (minimal attack surface)

**Runtime Security**:
- Run as non-root user (UID 1001)
- Read-only root filesystem
- Drop all capabilities
- Security context configured in Kubernetes manifests

### Network Security

**Ingress**:
- TLS/SSL enforced (Let's Encrypt)
- CORS configured
- Rate limiting enabled
- Security headers set

**Service Mesh** (optional):
- Istio/Linkerd for mTLS between services
- Network policies for pod-to-pod communication

### Secret Management

**DO NOT**:
- Commit secrets to version control
- Log sensitive data
- Expose secrets in environment variables (use Kubernetes secrets)

**DO**:
- Use GitHub Secrets for CI/CD
- Use Kubernetes Secrets for runtime
- Rotate secrets regularly
- Use least-privilege access

### Compliance

**Data Privacy**:
- No PII stored in Shadow Atlas
- GDPR-compliant data handling
- Audit logs for all access

**Infrastructure**:
- SOC 2 Type II compliance
- Regular security audits
- Penetration testing

---

## Quarterly Update Workflow

Shadow Atlas requires quarterly updates for TIGER data:

### Automatic Quarterly Updates

**Schedule**: 1st day of January, April, July, October at 2 AM UTC

**Workflow**:
1. Extract TIGER data for all 50 states
2. Validate extraction (95% pass rate required)
3. Build new Merkle tree
4. Publish to IPFS with pinning
5. Update on-chain registry (manual approval)
6. Send notifications (GitHub Issue + Slack)

### Manual Quarterly Update

```bash
# Navigate to GitHub Actions
# Select "Shadow Atlas Quarterly Update" workflow
# Click "Run workflow"
# Options:
#   - publish_ipfs: true/false
#   - update_registry: true/false (requires DEPLOYER_PRIVATE_KEY)
```

### Verification

```bash
# Check IPFS publication
curl https://ipfs.io/ipfs/<CID>

# Verify on-chain registry
# (requires Web3 tools to query smart contract)
```

---

## Best Practices

### Pre-Deployment Checklist

- [ ] All tests passing (unit, integration, E2E)
- [ ] Code review approved
- [ ] Security scan passed
- [ ] Staging deployment successful
- [ ] E2E tests on staging passed
- [ ] Performance benchmarks acceptable
- [ ] Documentation updated
- [ ] Changelog updated
- [ ] Release notes prepared

### Post-Deployment Checklist

- [ ] Health check returns 200
- [ ] Logs show no errors
- [ ] Metrics within normal range
- [ ] E2E smoke tests passed
- [ ] IPFS CID accessible
- [ ] Monitoring dashboards updated
- [ ] Stakeholders notified

### Environment Parity

Maintain identical configurations across environments:
- Same container images (different tags)
- Same Kubernetes manifests (different namespaces)
- Same environment variables (different values)
- Same resource limits (scaled appropriately)

### Zero-Downtime Deployments

Blue-green strategy ensures:
- No service interruption
- Instant rollback capability
- Traffic switch only after health checks
- Graceful pod termination (30s)

---

## Support

### Internal Resources

- **Architecture**: `/packages/crypto/services/shadow-atlas/ARCHITECTURE.md`
- **Test Documentation**: `/packages/crypto/services/shadow-atlas/__tests__/README.md`
- **Integration Guide**: `/packages/crypto/services/shadow-atlas/INTEGRATION_EXAMPLE.md`

### External Resources

- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)

### Contact

- **Issues**: GitHub Issues
- **Security**: security@voter-protocol.org
- **General**: support@voter-protocol.org

---

**Last Updated**: 2025-01-15
**Version**: 1.0.0
