# Shadow Atlas Global IPFS Distribution

Production-ready global distribution architecture for Shadow Atlas Merkle trees.

## Quick Start

```typescript
import { ShadowAtlasService } from '../core/shadow-atlas-service.js';
import { ShadowAtlasGlobalExtension } from './shadow-atlas-global-extension.js';

// Initialize service
const atlas = new ShadowAtlasService();
await atlas.initialize();

// Add global distribution
const globalExt = new ShadowAtlasGlobalExtension(atlas);

// Publish globally
const result = await globalExt.publishGlobal({
  regions: ['americas-east', 'europe-west', 'asia-east'],
  verifyReplication: true,
});

console.log(`Published CID: ${result.cid}`);
console.log(`Total replicas: ${result.totalReplicaCount}`);
```

## Architecture Overview

**Performance Targets:**
- <100ms lookup latency from any region
- 99.9% availability (three-nines SLA)
- Graceful degradation on regional failures

**Cost Structure:**
- Free tier: $0/month (Storacha 5GB storage + egress)
- Production: $5-10/month (1M requests/month with optimizations)

## Core Components

### 1. Regional Pinning Service
**File:** `regional-pinning-service.ts`

Orchestrates IPFS pinning across geographically distributed nodes.

```typescript
import { RegionalPinningService } from './regional-pinning-service.js';

const service = new RegionalPinningService('americas-east', services, {
  maxParallelUploads: 3,
  retryAttempts: 3,
});

const result = await service.pinToRegion(content, {
  name: 'shadow-atlas-2025-Q1',
  requiredSuccesses: 2, // Require 2/3 services to succeed
});
```

**Features:**
- Multi-service pinning (Storacha, Pinata, Fleek)
- Parallel uploads with failure isolation
- Automatic retry with exponential backoff
- Health tracking with circuit breakers

### 2. Update Coordinator
**File:** `update-coordinator.ts`

Coordinates zero-downtime global updates with staged rollout.

```typescript
import { UpdateCoordinator } from './update-coordinator.js';

const coordinator = new UpdateCoordinator(rolloutConfig, regionalServices);

const result = await coordinator.coordinateUpdate(merkleTree, metadata, {
  regions: ['americas-east', 'europe-west', 'asia-east'],
  verifyReplication: true,
});
```

**Features:**
- Staged rollout (Phase 1: Americas, Phase 2: Europe, Phase 3: APAC)
- Verification between phases
- Automatic rollback on failure
- CID consistency validation

### 3. Availability Monitor
**File:** `availability-monitor.ts`

Tracks global gateway health and availability metrics.

```typescript
import { AvailabilityMonitor } from './availability-monitor.js';

const monitor = new AvailabilityMonitor(regions, {
  healthCheckIntervalMs: 300_000, // 5 minutes
  healthCheckTimeoutMs: 10_000,   // 10 seconds
});

monitor.startMonitoring();

// Check SLA compliance
const sla = monitor.checkSLA(0.999, 24); // 99.9% over last 24 hours
console.log(`Meets SLA: ${sla.meetsSLA}`);
```

**Features:**
- Continuous health checks (HTTP HEAD requests)
- Latency tracking (p50, p95, p99)
- Success rate monitoring (rolling 100-request window)
- Circuit breaker (3 consecutive failures)

### 4. Fallback Resolver
**File:** `fallback-resolver.ts`

Implements intelligent gateway failover with caching.

```typescript
import { FallbackResolver } from './fallback-resolver.js';

const resolver = new FallbackResolver(regions, monitor, {
  fallbackStrategy: {
    maxRetries: 3,
    exponentialBackoff: true,
    cacheFailures: true,
  },
});

const result = await resolver.resolve(cid, {
  userRegion: 'americas-east',
  maxLatencyMs: 100,
});
```

**Features:**
- Latency-based gateway selection
- Multi-level fallback (regional → global)
- Response caching (1-hour TTL)
- Failure caching (5-minute window)

## Configuration

### Default Configuration

```typescript
import { DEFAULT_GLOBAL_CONFIG } from './global-ipfs-strategy.js';

// Override specific settings
const customConfig = {
  ...DEFAULT_GLOBAL_CONFIG,
  replicationFactor: 5, // Increase redundancy
  healthCheck: {
    intervalMs: 60_000, // Check every minute
    timeoutMs: 5_000,   // 5-second timeout
    retries: 3,
  },
};
```

### Environment Variables

```bash
# Storacha authentication (production)
STORACHA_AGENT_KEY="Mg..."
STORACHA_PROOF="uOqJlcm9vdHOB..."

# Pinata authentication
PINATA_API_KEY="..."
PINATA_SECRET_API_KEY="..."

# Fleek authentication
FLEEK_API_KEY="..."

# Web3.Storage authentication (legacy)
WEB3_STORAGE_TOKEN="..."
```

## Regional Coverage

### Americas (Primary: US East/West)
- **Gateways:** Storacha, Cloudflare IPFS
- **Pinning:** Storacha (free), Pinata (paid)
- **Latency target:** <50ms (US East), <80ms (US West)

### Europe (Primary: EU/UK)
- **Gateways:** Pinata, Cloudflare IPFS
- **Pinning:** Pinata (EU residency), Web3.Storage
- **Latency target:** <60ms (Western EU), <100ms (Eastern EU)

### Asia-Pacific (Primary: East/Southeast Asia)
- **Gateways:** Fleek, IPFS.io
- **Pinning:** Fleek (APAC pricing), Storacha
- **Latency target:** <100ms (East Asia), <120ms (Southeast Asia)

## Cost Projections

### Free Tier (0-10K users)
- **Storage:** 20 MB/year (4 quarterly snapshots)
- **Egress:** <5 GB/month
- **Cost:** $0/month (Storacha free tier covers)

### Production (1M users)
- **Storage:** 20 MB/year (negligible)
- **Egress:** 5,000 GB/month (unoptimized)
- **Cost:** $750/month (Pinata $0.15/GB)

### Optimized Production
- **Compression:** gzip (5MB → 500KB) = 90% savings
- **Caching:** 1-hour client cache = 50% request reduction
- **CDN:** Cloudflare workers cache = 90% load reduction
- **Final cost:** $5-10/month

## Monitoring

### Health Metrics

```typescript
// Get global metrics
const metrics = globalExt.getAvailabilityMetrics(24); // Last 24 hours

console.log(`Overall availability: ${metrics.overallAvailability * 100}%`);
console.log(`p95 latency: ${metrics.p95LatencyMs}ms`);
console.log(`Failed requests: ${metrics.failedRequests}/${metrics.totalRequests}`);
```

### SLA Compliance

```typescript
// Check SLA (99.9% target)
const sla = globalExt.checkSLA(0.999, 24);

if (!sla.meetsSLA) {
  console.error(`SLA BREACH: ${sla.currentAvailability * 100}% < 99.9%`);
}
```

### Replication Status

```typescript
// Check replication for CID
const replication = await monitor.checkReplicationStatus(cid, 9);

console.log(`Healthy replicas: ${replication.healthyReplicas}/${replication.totalReplicas}`);
console.log(`Meets target: ${replication.meetsTarget}`);
```

## Testing

### Unit Tests

```bash
# Run distribution tests
npm test -- distribution/*.test.ts
```

### Integration Tests

```bash
# Test multi-region pinning (requires credentials)
STORACHA_AGENT_KEY="..." npm test -- distribution/integration.test.ts
```

### E2E Tests

```bash
# Test global retrieval from all regions
npm run test:e2e -- distribution/e2e.test.ts
```

## Production Deployment

### Staging Environment

```bash
# 1. Deploy to staging
npm run shadow-atlas:publish-global -- \
  --env staging \
  --regions americas-east,americas-west \
  --verify-replication

# 2. Verify staging deployment
npm run shadow-atlas:verify -- --env staging --cid <CID>
```

### Production Rollout

```bash
# 1. Deploy globally (staged rollout)
npm run shadow-atlas:publish-global -- \
  --env production \
  --regions americas-east,americas-west,europe-west,asia-east \
  --verify-replication \
  --rollback-on-failure

# 2. Monitor rollout
npm run shadow-atlas:rollout-status

# 3. Verify global replication
npm run shadow-atlas:verify-replication -- --cid <CID>
```

## Operational Runbook

### Quarterly Update Procedure

1. **Pre-deployment:**
   - Extract boundaries (all states + international)
   - Run validation (>90% pass rate required)
   - Verify pinning service quotas

2. **Deployment:**
   - Execute staged rollout (Phase 1 → 2 → 3)
   - Verify replication between phases
   - Monitor for failures

3. **Post-deployment:**
   - Verify global availability (>99.9%)
   - Check latency targets (p95 < 100ms)
   - Update smart contract with CID

### Incident Response

**Regional outage:**
1. Detect: Availability monitor alerts
2. Diagnose: Check gateway health
3. Mitigate: Automatic fallback (no action)
4. Resolve: Wait for recovery
5. Postmortem: Document outage

**Failed deployment:**
1. Detect: Rollout fails
2. Diagnose: Check error logs
3. Mitigate: Automatic rollback
4. Resolve: Fix issue, re-deploy
5. Postmortem: Update procedures

## Architecture Documentation

- **Specification:** [GLOBAL_DISTRIBUTION_SPEC.md](./GLOBAL_DISTRIBUTION_SPEC.md)
- **Type definitions:** [types.ts](./types.ts)
- **Configuration:** [global-ipfs-strategy.ts](./global-ipfs-strategy.ts)
- **Integration guide:** [shadow-atlas-global-extension.ts](./shadow-atlas-global-extension.ts)

## Future Enhancements

### Edge Caching (Cloudflare Workers)
- Cache popular CIDs at 200+ edge locations
- <20ms latency globally
- 90% load reduction on IPFS gateways

### Dynamic Gateway Selection
- Client-side latency measurement
- Adaptive routing based on network conditions
- Per-request gateway optimization

### Decentralized Monitoring
- IPFS Observatory integration
- Community-validated gateway status
- Transparent uptime reporting

## Support

For issues or questions:
- GitHub Issues: [voter-protocol/issues](https://github.com/voter-protocol/voter-protocol/issues)
- Documentation: [GLOBAL_DISTRIBUTION_SPEC.md](./GLOBAL_DISTRIBUTION_SPEC.md)
- Storacha Docs: [docs.storacha.network](https://docs.storacha.network)

---

**Status:** Production-Ready Architecture
**Last Updated:** 2025-12-18
**Version:** 1.0
