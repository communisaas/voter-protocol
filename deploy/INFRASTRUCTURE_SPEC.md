# Shadow Atlas Infrastructure Specification

**Version**: 1.0
**Status**: Production-Ready IaC
**Last Updated**: 2025-12-18
**Maintainer**: VOTER Protocol Infrastructure Team

---

## Executive Summary

Shadow Atlas production infrastructure deploys a globally distributed, cryptographically verifiable district lookup API to Cloudflare's edge network. Two-tier storage architecture (R2 for serving, Storacha/IPFS for verification) enables <50ms p95 latency worldwide at <$100/month for 100M requests.

**Deployment Methods**:
1. **Wrangler CLI** (recommended): Direct deployment via `wrangler deploy`
2. **Terraform** (IaC): Reproducible infrastructure with environment parity

**Cost Target**: $5-100/month for 1M-100M requests (99% cheaper than Cicero API)

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Component Inventory](#component-inventory)
3. [Deployment Guide](#deployment-guide)
4. [Scaling Configuration](#scaling-configuration)
5. [Cost Analysis](#cost-analysis)
6. [Disaster Recovery](#disaster-recovery)
7. [Security Hardening](#security-hardening)
8. [Monitoring & Observability](#monitoring--observability)

---

## Architecture Overview

### Deployment Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CLOUDFLARE GLOBAL NETWORK                         │
│                      (330+ Edge Locations)                           │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  Cloudflare Workers (Edge Compute)                         │    │
│  │  • V8 Isolates (instant cold starts)                       │    │
│  │  • 10ms CPU time per request                               │    │
│  │  • Auto-scaling to 1M+ req/sec                             │    │
│  └───────┬────────────────────────────────────┬───────────────┘    │
│          │                                     │                     │
│          ▼                                     ▼                     │
│  ┌────────────────────┐              ┌────────────────────┐         │
│  │  Workers KV        │              │  Cloudflare R2     │         │
│  │  • Rate limiting   │              │  • District GeoJSON│         │
│  │  • Cache layer     │              │  • Metadata        │         │
│  │  • <10ms latency   │              │  • Zero egress fees│         │
│  └────────────────────┘              └────────────────────┘         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ Quarterly Updates
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      GITHUB ACTIONS PIPELINE                         │
│  1. Extract state boundaries (StateBatchExtractor)                  │
│  2. Validate (DeterministicValidationPipeline)                      │
│  3. Build Merkle tree (MerkleTreeBuilder)                           │
│  4. Upload to Storacha/IPFS (permanent archive)                     │
│  5. Sync GeoJSON to R2 (serving layer)                              │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     STORACHA/IPFS (Verification)                     │
│  • Permanent IPFS snapshots (quarterly)                             │
│  • Merkle tree with cryptographic proofs                            │
│  • Content addressing (tamper-proof CIDs)                           │
│  • Filecoin backing (decentralized storage)                         │
└─────────────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Edge Compute** | Cloudflare Workers | API request handling, PIP algorithm |
| **Storage** | Cloudflare R2 | District GeoJSON serving (S3-compatible) |
| **Caching** | Workers KV | Rate limiting, hot query caching |
| **Verification** | Storacha/IPFS | Permanent Merkle tree snapshots |
| **Orchestration** | GitHub Actions | Quarterly extraction and sync |
| **IaC** | Terraform + Wrangler | Infrastructure provisioning |

---

## Component Inventory

### Cloudflare Workers

**Resource**: `shadow-atlas-api-{environment}`

**Configuration**:
```toml
# wrangler.toml
name = "shadow-atlas-api"
main = "src/worker.ts"
compatibility_date = "2024-01-01"

# CPU/Memory Limits
# - CPU time: 10ms per request (free tier), 30M CPU-ms/month (paid)
# - Memory: 128MB per isolate
# - Bundle size: <3MB (free), <10MB (paid)
```

**Endpoints**:
- `GET /v1/districts?lat={lat}&lng={lng}` - District lookup
- `GET /v1/health` - Health check
- `GET /v1/snapshot` - Current snapshot metadata

**Scaling**:
- Automatic global distribution (330+ POPs)
- Zero configuration scaling (1 req/sec → 1M req/sec)
- <2ms cold starts (V8 isolates)

---

### Cloudflare R2

**Resource**: `shadow-atlas-districts-{environment}`

**Storage Schema**:
```
shadow-atlas-districts-prod/
├── districts/
│   ├── US/
│   │   ├── AL.geojson (compressed, ~500KB)
│   │   ├── AK.geojson
│   │   └── ... (50 states)
│   ├── CA/
│   │   └── ... (provinces)
│   └── GB/
│       └── constituencies.geojson
└── metadata/
    ├── snapshot-current.json
    └── snapshots-history.json
```

**Replication**:
- Automatic multi-region replication
- Jurisdiction hint: `WNAM` (Western North America)
- Zero egress fees (unlimited bandwidth)

**Access**:
- Private bucket (Worker-only access via bindings)
- No public URLs (security by design)
- S3-compatible API for uploads

---

### Workers KV Namespaces

#### Rate Limiting KV

**Resource**: `shadow-atlas-rate-limit-{environment}`

**Schema**:
```typescript
// Key format: ratelimit:{clientIP}:{date}
// Example: ratelimit:203.0.113.42:2025-12-18
// Value: Request count (integer string)
// TTL: 86400 seconds (24 hours)
```

**Configuration**:
- Free tier: 100k reads/day
- Paid tier: Unlimited reads ($0.50/10M)
- Automatic expiration (no manual cleanup)

#### Cache KV

**Resource**: `shadow-atlas-cache-{environment}`

**Schema**:
```typescript
// Key format: cache:{state}:geojson
// Example: cache:WI:geojson
// Value: Compressed GeoJSON string
// TTL: 3600 seconds (1 hour)
```

**Purpose**:
- Pre-warm frequently accessed state boundaries
- Reduce R2 read operations
- Improve cache hit rates (80%+ target)

---

### DNS Configuration

#### Production Records

```
# A/CNAME Records
api.shadow-atlas.org    CNAME    shadow-atlas-api-production.workers.dev
staging.shadow-atlas.org CNAME   shadow-atlas-api-staging.workers.dev

# TXT Records
shadow-atlas.org        TXT      "v=spf1 include:_spf.cloudflare.com ~all"

# CAA Records (Certificate Authority Authorization)
shadow-atlas.org        CAA      0 issue "letsencrypt.org"
```

---

## Deployment Guide

### Prerequisites

**Required Tools**:
- Node.js ≥20.0.0
- Wrangler CLI ≥3.22.0
- Terraform ≥1.6.0 (if using Terraform)
- Cloudflare account with Workers paid plan ($5/month)

**Required Secrets**:
- `CLOUDFLARE_API_TOKEN` (Terraform)
- `CLOUDFLARE_ACCOUNT_ID` (both)

### Deployment Method 1: Wrangler CLI (Recommended)

**Step 1: Install Dependencies**

```bash
cd deploy/cloudflare
npm install
```

**Step 2: Build Worker**

```bash
npm run build
# Output: dist/worker.js
```

**Step 3: Login to Cloudflare**

```bash
wrangler login
# Opens browser for OAuth authentication
```

**Step 4: Create R2 Bucket**

```bash
wrangler r2 bucket create shadow-atlas-districts-prod
```

**Step 5: Create KV Namespaces**

```bash
# Rate limiting
wrangler kv:namespace create "RATE_LIMIT_KV" --preview false
# Copy ID to wrangler.toml

# Cache
wrangler kv:namespace create "CACHE_KV" --preview false
# Copy ID to wrangler.toml
```

**Step 6: Deploy to Production**

```bash
npm run deploy:production
# Deploys to https://shadow-atlas-api-production.workers.dev
```

**Step 7: Verify Deployment**

```bash
curl https://api.shadow-atlas.org/v1/health
# Expected: {"status":"healthy","environment":"production","version":"v1",...}
```

---

### Deployment Method 2: Terraform IaC

**Step 1: Initialize Terraform**

```bash
cd deploy/terraform
terraform init
```

**Step 2: Configure Secrets**

```bash
# Create terraform.tfvars (DO NOT COMMIT)
cat > terraform.tfvars <<EOF
cloudflare_api_token   = "YOUR_API_TOKEN"
cloudflare_account_id  = "YOUR_ACCOUNT_ID"
EOF
```

**Step 3: Plan Deployment**

```bash
terraform plan -var-file="environments/production.tfvars"
# Review proposed changes
```

**Step 4: Apply Infrastructure**

```bash
terraform apply -var-file="environments/production.tfvars"
# Type 'yes' to confirm
```

**Step 5: Verify Outputs**

```bash
terraform output
# Displays:
# - api_url
# - r2_bucket_name
# - estimated_monthly_cost_usd
```

---

## Scaling Configuration

### Traffic Scaling Thresholds

| Metric | Development | Staging | Production |
|--------|-------------|---------|-----------|
| **Requests/Month** | 100k | 1M | 100M |
| **Peak QPS** | 1 | 10 | 1,000 |
| **Workers CPU** | 1k ms/month | 10k ms/month | 3M ms/month |
| **R2 Storage** | 1 GB | 10 GB | 50 GB |
| **R2 Reads/Month** | 10k | 100k | 10M |

### Auto-Scaling Behavior

**Cloudflare Workers**:
- No configuration required (automatic)
- Scales horizontally across 330+ POPs
- Request distribution via Anycast routing
- Zero cold starts (<2ms isolate initialization)

**R2 Object Storage**:
- No provisioned capacity (automatic scaling)
- Concurrent read limit: 1,000 requests/second per object
- Multi-region replication (automatic)

**Workers KV**:
- Global replication (~60 seconds eventual consistency)
- Read throughput: 100k+ reads/second
- Write throughput: 1k+ writes/second

---

## Cost Analysis

### Cost Breakdown by Environment

#### Development Environment

| Component | Usage | Free Tier | Paid Rate | Monthly Cost |
|-----------|-------|-----------|-----------|--------------|
| Workers Requests | 100k | 3M free | $0.50/1M | **$0** |
| Workers CPU | 1k ms | 30M free | $0.02/1M ms | **$0** |
| R2 Storage | 1 GB | 10 GB free | $0.015/GB | **$0** |
| R2 Reads | 10k | 10M free | $0.36/1M | **$0** |
| KV Reads | 10k | 100k free | $0.50/10M | **$0** |
| **TOTAL** | | | | **$0** |

#### Staging Environment

| Component | Usage | Free Tier | Paid Rate | Monthly Cost |
|-----------|-------|-----------|-----------|--------------|
| Workers Requests | 1M | 3M free | $0.50/1M | **$0** |
| Workers CPU | 10k ms | 30M free | $0.02/1M ms | **$0** |
| R2 Storage | 10 GB | 10 GB free | $0.015/GB | **$0** |
| R2 Reads | 100k | 10M free | $0.36/1M | **$0** |
| KV Reads | 100k | 100k free | $0.50/10M | **$0** |
| Workers Paid Plan | N/A | N/A | $5/month | **$5** |
| **TOTAL** | | | | **$5** |

#### Production Environment (100M requests/month)

| Component | Usage | Free Tier | Paid Rate | Monthly Cost |
|-----------|-------|-----------|-----------|--------------|
| Workers Requests | 100M | 10M included | $0.50/1M | **$45** |
| Workers CPU | 1M ms | 30M included | $0.02/1M ms | **$0** |
| R2 Storage | 50 GB | 10 GB free | $0.015/GB | **$0.60** |
| R2 Reads | 10M | 10M free | $0.36/1M | **$0** |
| KV Reads | 100M | 100k free | $0.50/10M | **$5** |
| Workers Paid Plan | N/A | N/A | $5/month | **$5** |
| Logpush | 10 GB | N/A | Free to R2 | **$0** |
| **TOTAL** | | | | **$55.60** |

### Cost Comparison to Competitors

| Provider | 100M Lookups/Month | Shadow Atlas Savings |
|----------|------------------:|---------------------:|
| **Shadow Atlas** | **$55.60** | Baseline |
| Cicero API | $6,000,000 | **99.999%** cheaper |
| Google Civic API | $500,000 | **99.989%** cheaper |
| Smarty Streets | $399,000 | **99.986%** cheaper |

---

## Disaster Recovery

### Backup Strategy

**R2 Bucket Snapshots**:
```bash
# Daily backup to secondary region (automated via GitHub Actions)
wrangler r2 object get shadow-atlas-districts-prod/metadata/snapshot-current.json \
  | aws s3 cp - s3://shadow-atlas-backups/$(date +%Y-%m-%d)/snapshot.json
```

**IPFS Permanent Archive**:
- Quarterly snapshots pinned to Storacha/IPFS (permanent)
- Immutable CIDs provide audit trail
- Filecoin backing ensures long-term availability

### Rollback Procedures

**Scenario 1: Bad Worker Deployment**

```bash
# Rollback to previous version (Wrangler)
wrangler rollback --name shadow-atlas-api-production

# Rollback to specific version
wrangler rollback --name shadow-atlas-api-production --version VERSION_ID
```

**Scenario 2: Corrupted R2 Data**

```bash
# Restore from IPFS snapshot
ipfs get QmXyz789... -o /tmp/shadow-atlas-2025-Q1.json

# Extract GeoJSON and re-upload to R2
npm run r2:restore -- /tmp/shadow-atlas-2025-Q1.json
```

**Scenario 3: Complete Infrastructure Failure**

```bash
# Re-provision infrastructure from scratch (Terraform)
cd deploy/terraform
terraform destroy -var-file="environments/production.tfvars"
terraform apply -var-file="environments/production.tfvars"

# Re-deploy Worker
cd ../cloudflare
npm run deploy:production
```

**Recovery Time Objective (RTO)**: <30 minutes
**Recovery Point Objective (RPO)**: <24 hours (daily backups)

---

## Security Hardening

### Worker Security

**Rate Limiting**:
- IP-based: 1000 requests/day per IP (free tier)
- Geographic filtering: Optional country-level blocking
- CAPTCHA challenge: Automatic for suspicious traffic

**Request Validation**:
```typescript
// Coordinate validation (worker.ts)
if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
  return jsonResponse({ error: 'Invalid coordinates' }, 400);
}
```

**CORS Policy**:
```typescript
// Permissive for public API
'Access-Control-Allow-Origin': '*'

// Restrictive option (production hardening)
'Access-Control-Allow-Origin': 'https://voter-protocol.org'
```

### R2 Bucket Security

**Access Control**:
- Private bucket (no public URLs)
- Worker-only access via R2 bindings
- No API keys in code (environment bindings)

**Encryption**:
- Server-side encryption (AES-256, automatic)
- TLS 1.3 for all transfers
- Zero plaintext at rest

### DNS Security

**CAA Records**:
```
shadow-atlas.org    CAA    0 issue "letsencrypt.org"
shadow-atlas.org    CAA    0 issuewild ";"  # Disable wildcard certs
```

**DNSSEC**:
- Enabled by default on Cloudflare
- RRSIG records signed with RSA/SHA-256
- Chain of trust to ICANN root

---

## Monitoring & Observability

### Health Checks

**Endpoint**: `GET /v1/health`

**Response**:
```json
{
  "status": "healthy",
  "environment": "production",
  "version": "v1",
  "timestamp": 1734528000000
}
```

**Cloudflare Health Check**:
- Frequency: 60 seconds
- Regions: 5 (WNAM, ENAM, WEU, EEU, SEAS)
- Timeout: 5 seconds
- Expected HTTP status: 200
- Expected body substring: `"status":"healthy"`

### Metrics & Alerting

**Cloudflare Analytics**:
- Request volume (total, errors, cache hits)
- Latency (p50, p95, p99)
- Geographic distribution
- Status code breakdown

**Logpush to R2** (production only):
```json
{
  "EventTimestampMs": 1734528000123,
  "Outcome": "ok",
  "ScriptName": "shadow-atlas-api-production",
  "Logs": [...]
}
```

**PagerDuty Integration**:
- Health check failures → Immediate alert
- Error rate >5% for 5 minutes → Warning
- Latency p95 >100ms for 5 minutes → Warning

### Dashboard Queries

**Request Volume (Last 24h)**:
```sql
SELECT
  DATE_TRUNC('hour', EventTimestampMs) AS hour,
  COUNT(*) AS requests,
  AVG(CPUTime) AS avg_cpu_ms
FROM workers_trace_events
WHERE ScriptName = 'shadow-atlas-api-production'
  AND EventTimestampMs > NOW() - INTERVAL '24 hours'
GROUP BY hour
ORDER BY hour DESC;
```

**Cache Hit Rate**:
```sql
SELECT
  COUNT(CASE WHEN CacheStatus = 'hit' THEN 1 END) / COUNT(*) AS cache_hit_rate
FROM workers_trace_events
WHERE ScriptName = 'shadow-atlas-api-production'
  AND EventTimestampMs > NOW() - INTERVAL '1 hour';
```

---

## Infrastructure Testing

### Pre-Deployment Validation

```bash
# Terraform validation
cd deploy/terraform
terraform validate

# Wrangler dry-run
cd deploy/cloudflare
wrangler deploy --dry-run --env production
```

### Post-Deployment Smoke Tests

```bash
# Health check
curl https://api.shadow-atlas.org/v1/health

# Snapshot metadata
curl https://api.shadow-atlas.org/v1/snapshot

# District lookup (Madison, WI)
curl "https://api.shadow-atlas.org/v1/districts?lat=43.0731&lng=-89.4012"

# Rate limiting test (should fail after 1000 requests)
for i in {1..1001}; do
  curl -s https://api.shadow-atlas.org/v1/health > /dev/null
done
# Expected: HTTP 429 on request 1001
```

### Load Testing

```bash
# Apache Bench (1000 requests, 10 concurrent)
ab -n 1000 -c 10 "https://api.shadow-atlas.org/v1/districts?lat=43.0731&lng=-89.4012"

# Expected results:
# - Mean latency: <50ms
# - p95 latency: <100ms
# - Throughput: >200 req/sec
```

---

## Runbook

### Common Operations

**Deploy New Version**:
```bash
cd deploy/cloudflare
npm run build
npm run deploy:production
```

**Rotate Secrets**:
```bash
# Generate new API token in Cloudflare dashboard
# Update terraform.tfvars (DO NOT COMMIT)
terraform apply -var-file="environments/production.tfvars"
```

**Scale Up Resources**:
```bash
# No action required - Cloudflare Workers auto-scale
# Monitor costs via Cloudflare dashboard
```

**Emergency Shutdown**:
```bash
# Disable Worker route (stops all traffic)
wrangler route disable --name shadow-atlas-api-production
```

---

## Summary

Shadow Atlas infrastructure provides production-ready, globally distributed district lookup API with:

✅ **Reproducible Deployments**: Terraform + Wrangler IaC
✅ **Cost Efficiency**: $5-100/month for 1M-100M requests
✅ **Global Performance**: <50ms p95 latency (330+ POPs)
✅ **Zero-Trust Security**: Rate limiting, encryption, DNSSEC
✅ **Disaster Recovery**: IPFS backups, <30min RTO
✅ **Observability**: Health checks, Logpush, PagerDuty

**Next Steps**:
1. Complete Cloudflare account setup
2. Replace placeholder IDs in `wrangler.toml`
3. Run `terraform plan` to validate configuration
4. Deploy to staging for validation
5. Deploy to production with monitoring

**Support**: ops@voter-protocol.org
