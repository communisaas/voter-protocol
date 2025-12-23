# Shadow Atlas Deployment

Production-grade deployment infrastructure for Shadow Atlas with zero-downtime blue-green deployments.

## Quick Start

### Local Development

```bash
# Start local environment
docker-compose up -d

# View logs
docker-compose logs -f shadow-atlas

# Stop environment
docker-compose down
```

### Deploy to Staging

```bash
cd scripts
./deploy.sh staging v1.0.0
```

### Deploy to Production

```bash
cd scripts
./deploy.sh production v1.0.0
```

### Rollback

```bash
cd scripts
./rollback.sh production
```

## Directory Structure

```
deploy/
├── Dockerfile                    # Multi-stage production container
├── docker-compose.yml            # Local development environment
├── DEPLOYMENT_GUIDE.md           # Complete deployment documentation
├── README.md                     # This file
├── kubernetes/                   # Kubernetes manifests
│   ├── namespace.yaml            # Namespace definitions
│   ├── deployment.yaml           # Blue deployment
│   ├── deployment-green.yaml    # Green deployment
│   ├── service.yaml              # Service definitions
│   ├── ingress.yaml              # Ingress configuration
│   └── hpa.yaml                  # Horizontal Pod Autoscaler
└── scripts/                      # Deployment scripts
    ├── deploy.sh                 # Deployment automation
    └── rollback.sh               # Rollback automation
```

## CI/CD Workflows

### Continuous Integration (`shadow-atlas-ci.yml`)

**Triggers**: Pull requests, push to main

**Jobs**:
- Lint (ESLint + Prettier)
- TypeScript type check
- Unit tests
- Integration tests (mocked)
- Code coverage (90% minimum)
- Security audit (npm audit)
- Production build

### Continuous Deployment (`shadow-atlas-cd.yml`)

**Triggers**: GitHub releases, manual dispatch

**Jobs**:
1. **Validate**: Full test suite
2. **Build**: Production Docker image + SBOM
3. **Deploy Staging**: Deploy to staging environment
4. **E2E Staging**: E2E tests on staging
5. **Deploy Production**: Blue-green production deployment
6. **Verify Production**: Production smoke tests
7. **Rollback**: Automatic rollback on failure

### Quarterly Update (`shadow-atlas-quarterly.yml`)

**Schedule**: Quarterly (Jan 1, Apr 1, Jul 1, Oct 1 at 2 AM UTC)

**Jobs**:
1. **Extract TIGER**: Download latest TIGER data (all 50 states)
2. **Validate**: Validate extraction (95% pass rate)
3. **Build Merkle**: Build new Merkle tree
4. **Publish IPFS**: Publish to IPFS with pinning
5. **Update Registry**: Update on-chain registry (manual approval)
6. **Notify**: GitHub Issue + Slack notifications

## Deployment Strategy

### Blue-Green Deployment

**Production deployments use blue-green strategy**:

1. Deploy **green** version alongside **blue**
2. Wait for **green** to be healthy
3. Switch traffic from **blue** to **green**
4. Monitor **green** for errors
5. Scale down **blue** if successful
6. Automatic rollback to **blue** on failure

**Benefits**:
- Zero downtime
- Instant rollback
- Safe production deployments

### Rollback Strategy

**Automatic rollback triggers**:
- E2E test failures on staging
- Production verification failures
- High error rate (>10 errors per 1000 log lines)
- Health check failures

**Manual rollback**:
```bash
# Via script
./scripts/rollback.sh production

# Via kubectl
kubectl rollout undo deployment/shadow-atlas -n shadow-atlas-production
```

## Environment Configuration

### Staging

- **Namespace**: `shadow-atlas-staging`
- **URL**: `https://staging-shadow-atlas.voter-protocol.org`
- **Replicas**: 2
- **Resources**: 512Mi memory, 250m CPU
- **Log Level**: debug

### Production

- **Namespace**: `shadow-atlas-production`
- **URL**: `https://shadow-atlas.voter-protocol.org`
- **Replicas**: 3 (autoscale to 10)
- **Resources**: 2Gi memory, 1000m CPU
- **Log Level**: info

## Security

### Container Security

- **Base Image**: `node:20-alpine` (distroless production)
- **User**: Non-root (UID 1001)
- **Filesystem**: Read-only root filesystem
- **Capabilities**: All dropped
- **SBOM**: Generated on every build

### Network Security

- **TLS**: Let's Encrypt certificates
- **CORS**: Configured in ingress
- **Rate Limiting**: 100 requests/minute
- **Security Headers**: X-Frame-Options, CSP, etc.

### Secret Management

**DO NOT commit secrets to version control.**

**GitHub Secrets** (required):
- `KUBE_CONFIG_STAGING`
- `KUBE_CONFIG_PRODUCTION`
- `DEPLOYER_PRIVATE_KEY`
- `SCROLL_RPC_URL`

**Optional Secrets**:
- `PINATA_API_KEY` / `PINATA_SECRET_KEY`
- `CODECOV_TOKEN`
- `SLACK_WEBHOOK_URL`

## Monitoring

### Health Check

```bash
curl https://shadow-atlas.voter-protocol.org/health
```

### Kubernetes Monitoring

```bash
# Pod status
kubectl get pods -n shadow-atlas-production -l app=shadow-atlas

# Logs
kubectl logs -n shadow-atlas-production -l app=shadow-atlas -f

# Events
kubectl get events -n shadow-atlas-production --sort-by='.lastTimestamp'
```

### Metrics

- **Endpoint**: `GET /metrics` (Prometheus format)
- **Scraping**: Configured via pod annotations
- **Dashboards**: Grafana (optional)

## Troubleshooting

### Common Issues

**Pod CrashLoopBackOff**:
```bash
kubectl describe pod <pod-name> -n shadow-atlas-production
kubectl logs <pod-name> -n shadow-atlas-production
```

**ImagePullBackOff**:
- Verify image exists in GHCR
- Check imagePullSecrets configured

**502 Bad Gateway**:
- Check pod readiness
- Verify service endpoints
- Review ingress configuration

### Debug Mode

```bash
# Enable debug logging
kubectl set env deployment/shadow-atlas \
  LOG_LEVEL=debug \
  -n shadow-atlas-production

# Restart pods
kubectl rollout restart deployment/shadow-atlas \
  -n shadow-atlas-production
```

## Resources

- **Full Documentation**: [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)
- **Architecture**: [ARCHITECTURE_ACTUAL.md](../ARCHITECTURE_ACTUAL.md)
- **Test Documentation**: [__tests__/README.md](../__tests__/README.md)
- **Integration Guide**: [INTEGRATION_EXAMPLE.md](../INTEGRATION_EXAMPLE.md)

## Support

- **Issues**: GitHub Issues
- **Security**: security@voter-protocol.org
- **General**: support@voter-protocol.org

---

**Production-ready deployment infrastructure for Shadow Atlas.**
