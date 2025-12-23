# Shadow Atlas Deployment Checklist

Production deployment verification checklist for Shadow Atlas infrastructure.

---

## Pre-Deployment Checklist

### Prerequisites (All Environments)

- [ ] Node.js v20.0.0 or higher installed
- [ ] Wrangler CLI v3.22.0 or higher installed (`npm install -g wrangler`)
- [ ] Cloudflare account created
- [ ] Cloudflare Workers Paid plan enabled ($5/month)
- [ ] GitHub repository access configured
- [ ] Local development environment tested

### Terraform-Specific Prerequisites

- [ ] Terraform v1.6.0 or higher installed
- [ ] AWS CLI configured (for R2 state backend)
- [ ] `terraform.tfvars` created (DO NOT COMMIT)

### Secrets Configuration

- [ ] `CLOUDFLARE_API_TOKEN` obtained from Cloudflare dashboard
- [ ] `CLOUDFLARE_ACCOUNT_ID` obtained from Cloudflare dashboard
- [ ] `CLOUDFLARE_R2_ACCESS_KEY` generated for R2 access
- [ ] `CLOUDFLARE_R2_SECRET_KEY` generated for R2 access
- [ ] GitHub Secrets configured (for CI/CD)

---

## Infrastructure Provisioning

### Cloudflare R2 Buckets

- [ ] Production bucket created: `shadow-atlas-districts-prod`
- [ ] Staging bucket created: `shadow-atlas-districts-staging`
- [ ] Development bucket created: `shadow-atlas-districts-dev`
- [ ] Logs bucket created: `shadow-atlas-logs-prod` (if logging enabled)

**Commands**:
```bash
wrangler r2 bucket create shadow-atlas-districts-prod
wrangler r2 bucket create shadow-atlas-districts-staging
wrangler r2 bucket create shadow-atlas-districts-dev
wrangler r2 bucket create shadow-atlas-logs-prod
```

### Workers KV Namespaces

- [ ] Production rate limit KV created
- [ ] Production cache KV created
- [ ] Staging rate limit KV created
- [ ] Staging cache KV created
- [ ] Development rate limit KV created
- [ ] Development cache KV created
- [ ] KV namespace IDs updated in `wrangler.toml`

**Commands**:
```bash
# Production
wrangler kv:namespace create "RATE_LIMIT_KV" --env production --preview false
wrangler kv:namespace create "CACHE_KV" --env production --preview false

# Staging
wrangler kv:namespace create "RATE_LIMIT_KV" --env staging --preview false
wrangler kv:namespace create "CACHE_KV" --env staging --preview false

# Development
wrangler kv:namespace create "RATE_LIMIT_KV" --env development --preview false
wrangler kv:namespace create "CACHE_KV" --env development --preview false
```

### DNS Configuration (Production Only)

- [ ] Domain registered: `shadow-atlas.org`
- [ ] Cloudflare DNS configured
- [ ] CNAME record created: `api.shadow-atlas.org`
- [ ] CNAME record created: `staging.shadow-atlas.org`
- [ ] CAA record created (certificate authority authorization)
- [ ] TXT record created (SPF, if email needed)

---

## Code Deployment

### Build and Test

- [ ] Dependencies installed: `npm ci`
- [ ] TypeScript compilation successful: `npm run build`
- [ ] Unit tests passing: `npm test`
- [ ] Type checking passing: `npm run typecheck`
- [ ] No ESLint errors: `npm run lint`

### Wrangler Deployment

#### Development

- [ ] Worker deployed to development
- [ ] Development URL accessible: `https://shadow-atlas-api-dev.workers.dev`
- [ ] Health check passing: `curl https://shadow-atlas-api-dev.workers.dev/v1/health`

**Commands**:
```bash
cd cloudflare
npm run build
npm run deploy:development
```

#### Staging

- [ ] Worker deployed to staging
- [ ] Staging URL accessible: `https://staging.shadow-atlas.org`
- [ ] Health check passing
- [ ] Snapshot metadata accessible

**Commands**:
```bash
npm run deploy:staging
curl https://staging.shadow-atlas.org/v1/health
curl https://staging.shadow-atlas.org/v1/snapshot
```

#### Production

- [ ] Worker deployed to production
- [ ] Production URL accessible: `https://api.shadow-atlas.org`
- [ ] Health check passing
- [ ] Snapshot metadata accessible
- [ ] District lookup functional

**Commands**:
```bash
npm run deploy:production
curl https://api.shadow-atlas.org/v1/health
curl https://api.shadow-atlas.org/v1/snapshot
curl "https://api.shadow-atlas.org/v1/districts?lat=43.0731&lng=-89.4012"
```

### Terraform Deployment (Alternative)

- [ ] Terraform initialized: `terraform init`
- [ ] Terraform validated: `terraform validate`
- [ ] Terraform plan reviewed: `terraform plan -var-file="environments/production.tfvars"`
- [ ] Terraform applied: `terraform apply -var-file="environments/production.tfvars"`
- [ ] Terraform outputs verified: `terraform output`

---

## Data Seeding

### Initial Data Upload

- [ ] Quarterly IPFS snapshot prepared
- [ ] GeoJSON extracted for R2 upload
- [ ] District data uploaded to R2 buckets
- [ ] Snapshot metadata uploaded to R2
- [ ] Merkle tree generated and uploaded to Storacha/IPFS

**Commands**:
```bash
# Run extraction pipeline
npm run extract:all-states

# Build Merkle tree
npm run merkle:build

# Upload to Storacha
npm run storacha:upload -- ./dist/shadow-atlas-2025-Q1.json

# Sync GeoJSON to R2
npm run r2:sync -- ./dist/r2-upload
```

### Verify Data Integrity

- [ ] R2 bucket contains all state GeoJSON files (50+ files for US)
- [ ] Snapshot metadata JSON accessible
- [ ] Merkle root matches IPFS snapshot
- [ ] IPFS CID resolvable: `ipfs cat {CID}`

---

## Post-Deployment Verification

### Functional Tests

- [ ] Health endpoint responding: `GET /v1/health`
- [ ] Snapshot endpoint responding: `GET /v1/snapshot`
- [ ] District lookup working: `GET /v1/districts?lat=X&lng=Y`
- [ ] District by ID working: `GET /v1/districts/:id`
- [ ] CORS headers present
- [ ] Rate limiting functional (test with 1001 requests)

### Performance Tests

- [ ] Latency p50 <30ms
- [ ] Latency p95 <50ms
- [ ] Latency p99 <100ms
- [ ] Cache hit rate >80% (after warm-up)
- [ ] Zero 500 errors

**Load Test Commands**:
```bash
# Apache Bench (1000 requests, 10 concurrent)
ab -n 1000 -c 10 "https://api.shadow-atlas.org/v1/districts?lat=43.0731&lng=-89.4012"

# Expected:
# - Mean latency: <50ms
# - p95 latency: <100ms
# - 0 failed requests
```

### Security Tests

- [ ] HTTPS enforced (HTTP redirects to HTTPS)
- [ ] CORS configured correctly
- [ ] Rate limiting blocks after threshold
- [ ] No secrets in Worker code (inspect via Cloudflare dashboard)
- [ ] R2 bucket is private (no public URLs)
- [ ] CAA records prevent unauthorized certificate issuance

### Monitoring Setup

- [ ] Cloudflare Analytics dashboard accessible
- [ ] Health checks configured (production only)
- [ ] PagerDuty/Sentry alerts configured (production only)
- [ ] Logpush enabled (production/staging)
- [ ] Prometheus metrics endpoint accessible: `GET /v1/metrics`

---

## CI/CD Pipeline Verification

### GitHub Actions

- [ ] Deploy workflow exists: `.github/workflows/deploy-production.yml`
- [ ] GitHub Secrets configured:
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
  - `CLOUDFLARE_R2_ACCESS_KEY`
  - `CLOUDFLARE_R2_SECRET_KEY`
- [ ] Workflow dispatch tested (manual trigger)
- [ ] Deployment to staging via workflow successful
- [ ] Deployment to production via workflow successful
- [ ] Post-deployment verification passing

**Test Workflow**:
```bash
# Trigger via GitHub UI: Actions > Deploy Shadow Atlas > Run workflow
# Select environment: staging
# Monitor workflow logs for errors
```

---

## Cost Monitoring

### Initial Deployment

- [ ] Cloudflare billing dashboard shows expected costs
- [ ] Workers Paid plan active ($5/month base)
- [ ] R2 storage costs within free tier (<10 GB)
- [ ] KV read/write operations within free tier
- [ ] No unexpected charges

### Ongoing Monitoring

- [ ] Set up cost alerts in Cloudflare dashboard
- [ ] Monitor monthly invoice for budget compliance
- [ ] Review Terraform cost estimates: `terraform output estimated_monthly_cost_usd`

**Expected Costs**:
- Development: $0/month (free tier)
- Staging: $5/month (Workers paid plan)
- Production (100M requests): $55-100/month

---

## Documentation

- [ ] `README.md` reviewed and updated
- [ ] `INFRASTRUCTURE_SPEC.md` reviewed
- [ ] `DEPLOYMENT_GUIDE.md` exists (this file)
- [ ] Runbook created for common operations
- [ ] API documentation published (OpenAPI spec)
- [ ] Client SDK examples provided

---

## Final Sign-Off

### Development Environment

- [ ] All functional tests passing
- [ ] All performance benchmarks met
- [ ] No security vulnerabilities
- [ ] Documentation complete
- [ ] **Approved by**: ________________ (Engineer)
- [ ] **Date**: ________________

### Staging Environment

- [ ] All functional tests passing
- [ ] All performance benchmarks met
- [ ] No security vulnerabilities
- [ ] Load testing completed (1k-10k requests)
- [ ] **Approved by**: ________________ (Tech Lead)
- [ ] **Date**: ________________

### Production Environment

- [ ] All functional tests passing
- [ ] All performance benchmarks met
- [ ] No security vulnerabilities
- [ ] Load testing completed (100k+ requests)
- [ ] Monitoring and alerting active
- [ ] Disaster recovery plan tested
- [ ] **Approved by**: ________________ (Engineering Manager)
- [ ] **Date**: ________________

---

## Rollback Plan

In case of deployment failure:

1. **Immediate**: Disable Worker route (stops traffic)
   ```bash
   wrangler route disable --name shadow-atlas-api-production
   ```

2. **Rollback Worker**: Deploy previous version
   ```bash
   wrangler rollback --name shadow-atlas-api-production
   ```

3. **Rollback R2 Data**: Restore from IPFS snapshot
   ```bash
   ipfs get QmXyz789... -o /tmp/shadow-atlas-2025-Q1.json
   npm run r2:restore -- /tmp/shadow-atlas-2025-Q1.json
   ```

4. **Rollback Infrastructure**: Terraform destroy + apply previous version
   ```bash
   cd terraform
   terraform destroy -var-file="environments/production.tfvars"
   git checkout <previous-commit>
   terraform apply -var-file="environments/production.tfvars"
   ```

5. **Verify Rollback**: Run all post-deployment verification tests

**RTO (Recovery Time Objective)**: <30 minutes
**RPO (Recovery Point Objective)**: <24 hours

---

## Support Contacts

- **Primary Engineer**: ops@voter-protocol.org
- **Cloudflare Support**: support@cloudflare.com
- **PagerDuty Escalation**: [Link to PagerDuty]
- **Documentation**: `/packages/crypto/services/shadow-atlas/deploy/`

---

## Change Log

| Date | Environment | Change | Approver |
|------|-------------|--------|----------|
| 2025-12-18 | All | Initial deployment infrastructure created | Infrastructure Team |

---

**Status**: Ready for deployment
**Last Reviewed**: 2025-12-18
**Next Review**: 2026-01-18 (monthly)
