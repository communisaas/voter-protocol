# Shadow Atlas Deployment

Production deployment infrastructure for Shadow Atlas using **Kubernetes + Docker**.

## Infrastructure

Shadow Atlas runs on Kubernetes with:
- **Container Runtime**: Docker (multi-stage builds)
- **Orchestration**: Kubernetes 1.28+
- **Deployment Strategy**: Blue-green with zero downtime
- **CI/CD**: GitHub Actions
- **Container Registry**: GitHub Container Registry (GHCR)

## Quick Start

### Local Development

```bash
docker-compose up -d              # Start local environment
docker-compose logs -f            # View logs
docker-compose down               # Stop environment
```

### Deploy to Kubernetes

```bash
cd scripts
./deploy.sh staging v1.0.0        # Deploy to staging
./deploy.sh production v1.0.0     # Deploy to production
./rollback.sh production          # Rollback if needed
```

## Directory Structure

```
deploy/
├── docker-compose.yml            # Local development setup
├── Dockerfile                    # Production container build
├── kubernetes/                   # K8s manifests (deployments, services, ingress, HPA)
├── scripts/                      # Deployment automation scripts
└── archive/                      # Historical research documents
    └── cloudflare-research/      # Cloudflare Workers evaluation (not implemented)
```

## Documentation

- **[Kubernetes Manifests](kubernetes/)** - Production K8s configurations
- **[Full Deployment Guide](archive/cloudflare-research/DEPLOYMENT_GUIDE.md)** - Comprehensive deployment procedures (NOTE: references Kubernetes, despite being in archive)
- **[Cloudflare Research](archive/cloudflare-research/)** - Edge deployment evaluation (never implemented)

## Monitoring

```bash
# Health check
curl https://shadow-atlas.voter-protocol.org/health

# K8s monitoring
kubectl get pods -n shadow-atlas-production -l app=shadow-atlas
kubectl logs -n shadow-atlas-production -l app=shadow-atlas -f
```

## Support

- **Issues**: GitHub Issues
- **Security**: security@voter-protocol.org
