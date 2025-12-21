# Resilience Integration Guide

How to integrate resilience patterns into Shadow Atlas services.

---

## Integration Points

### 1. Batch Orchestrator (State Extractions)

**Current Error Handling**:
```typescript
// batch-orchestrator.ts
for (let attempt = 1; attempt <= options.maxRetries; attempt++) {
  try {
    const result = await this.extractor.extractLayer(state, layer);
    return result;
  } catch (error) {
    if (attempt < options.maxRetries) {
      await this.delay(options.retryDelayMs);
    }
  }
}
```

**Enhanced with Resilience Patterns**:
```typescript
import { createResilienceStack } from './resilience';

class BatchOrchestrator {
  private readonly resilience: ResilienceStack;

  constructor() {
    this.resilience = createResilienceStack({
      name: 'state-extraction',
      circuitBreaker: {
        failureThreshold: 5,
        openDurationMs: 60000,
      },
      retry: {
        maxAttempts: 3,
        initialDelayMs: 1000,
        maxDelayMs: 10000,
        backoffMultiplier: 2,
        jitterFactor: 0.1,
      },
      bulkhead: {
        maxConcurrent: 5,  // Limit concurrent state extractions
        maxQueueSize: 10,
      },
    });
  }

  private async executeTask(state: string, layer: LegislativeLayerType): Promise<void> {
    return this.resilience.execute(`${state}-${layer}`, async () => {
      return this.extractor.extractLayer(state, layer);
    }, {
      fallbackValue: null,  // Allow graceful degradation
    });
  }
}
```

**Benefits**:
- Circuit breaker prevents hammering failing state portals
- Exponential backoff with jitter prevents thundering herd
- Bulkhead limits concurrent extractions per state
- Graceful degradation on unrecoverable failures

---

### 2. State Batch Extractor (Network Requests)

**Current Error Handling**:
```typescript
// state-batch-extractor.ts
private async fetchGeoJSON(endpoint: string, stateFips?: string): Promise<FeatureCollection> {
  for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      if (attempt < this.retryAttempts) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}
```

**Enhanced with Resilience Patterns**:
```typescript
import { createCircuitBreaker, retry } from './resilience';

class StateBatchExtractor {
  private readonly circuitBreakers = new Map<string, CircuitBreaker>();

  private getCircuitBreaker(endpoint: string): CircuitBreaker {
    if (!this.circuitBreakers.has(endpoint)) {
      this.circuitBreakers.set(
        endpoint,
        createCircuitBreaker(`upstream-${endpoint}`, {
          failureThreshold: 3,
          openDurationMs: 120000,  // 2 minutes for state portals
        })
      );
    }
    return this.circuitBreakers.get(endpoint)!;
  }

  private async fetchGeoJSON(
    endpoint: string,
    stateFips?: string
  ): Promise<FeatureCollection> {
    const breaker = this.getCircuitBreaker(endpoint);

    return breaker.execute(async () => {
      return retry(async () => {
        const url = this.buildQueryUrl(endpoint, stateFips);
        const response = await fetch(url, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0',
          },
          signal: AbortSignal.timeout(10000),  // 10 second timeout
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
      }, {
        maxAttempts: 3,
        initialDelayMs: 500,
        maxDelayMs: 10000,
        timeoutMs: 30000,
      });
    });
  }
}
```

**Benefits**:
- Per-endpoint circuit breakers (don't block all portals if one fails)
- Automatic timeout handling
- Exponential backoff respects upstream rate limits
- Circuit opens after repeated failures to specific portal

---

### 3. Shadow Atlas API (Client-Facing)

**Current Error Handling**:
```typescript
// api.ts
private async handleLookup(url: URL, res: ServerResponse, req: IncomingMessage): Promise<void> {
  const clientId = this.getClientId(req);
  if (!this.rateLimiter.check(clientId)) {
    this.sendError(res, 429, 'RATE_LIMIT_EXCEEDED', 'Rate limit exceeded');
    return;
  }

  try {
    const result = this.lookupService.lookup(lat, lon);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  } catch (error) {
    this.sendError(res, 500, 'INTERNAL_ERROR', errorMsg);
  }
}
```

**Enhanced with Resilience Patterns**:
```typescript
import { createResilienceStack } from './resilience';

class ShadowAtlasAPI {
  private readonly resilience: ResilienceStack;
  private readonly cachedSnapshots = new Map<string, CachedValue<SnapshotData>>();

  constructor() {
    this.resilience = createResilienceStack({
      name: 'api-server',
      circuitBreaker: {
        failureThreshold: 10,  // Higher threshold for user-facing API
        openDurationMs: 30000,  // 30 seconds recovery
      },
      retry: {
        maxAttempts: 2,  // Quick retry for low latency
        initialDelayMs: 50,
        maxDelayMs: 500,
      },
      bulkhead: {
        maxConcurrent: 100,  // High concurrency for user requests
        maxQueueSize: 200,
      },
      rateLimiter: {
        maxTokens: 100,
        refillRate: 10,
      },
    });
  }

  private async handleLookup(
    url: URL,
    res: ServerResponse,
    req: IncomingMessage
  ): Promise<void> {
    const clientId = this.getClientId(req);
    const lat = parseFloat(url.searchParams.get('lat') || '');
    const lon = parseFloat(url.searchParams.get('lon') || '');

    try {
      const result = await this.resilience.execute('district-lookup', async () => {
        return this.lookupService.lookup(lat, lon);
      }, {
        cachedValue: this.cachedSnapshots.get(`${lat},${lon}`),
      });

      // Cache successful result
      this.cachedSnapshots.set(`${lat},${lon}`, {
        value: result,
        timestamp: Date.now(),
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (error) {
      // Check degradation level
      const health = this.resilience.getHealthState();

      if (health.level === 'critical') {
        this.sendError(res, 503, 'SERVICE_DEGRADED', 'Service temporarily degraded');
      } else {
        this.sendError(res, 500, 'INTERNAL_ERROR', error.message);
      }
    }
  }
}
```

**Benefits**:
- Stale cache fallback maintains availability during outages
- Circuit breaker prevents hammering database during failures
- Rate limiting per client protects server resources
- Health-aware error responses (503 vs 500)

---

### 4. IPFS Sync Service

**New Integration** (not yet implemented):
```typescript
import { createResilienceStack } from './resilience';

class IPFSSyncService {
  private readonly resilience: ResilienceStack;

  constructor(ipfsGateway: string) {
    this.resilience = createResilienceStack({
      name: 'ipfs-sync',
      circuitBreaker: {
        failureThreshold: 5,
        openDurationMs: 60000,
      },
      retry: {
        maxAttempts: 3,
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
        jitterFactor: 0.1,
        retryableErrors: ['network_timeout', 'network_error', 'gateway_timeout'],
      },
      bulkhead: {
        maxConcurrent: 3,  // Limit concurrent IPFS fetches
        maxQueueSize: 5,
      },
    });
  }

  async syncSnapshot(cid: string): Promise<SnapshotData> {
    return this.resilience.execute('ipfs-gateway', async () => {
      const response = await fetch(`https://ipfs.io/ipfs/${cid}`, {
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new Error(`IPFS fetch failed: ${response.status}`);
      }

      return await response.json();
    }, {
      fallbackValue: null,  // Graceful degradation on failure
    });
  }

  async downloadWithFallback(cid: string, gateways: string[]): Promise<SnapshotData> {
    for (const gateway of gateways) {
      try {
        return await this.resilience.execute(`ipfs-${gateway}`, async () => {
          const response = await fetch(`${gateway}/ipfs/${cid}`, {
            signal: AbortSignal.timeout(30000),
          });

          if (!response.ok) {
            throw new Error(`Gateway ${gateway} failed: ${response.status}`);
          }

          return await response.json();
        });
      } catch (error) {
        console.warn(`Gateway ${gateway} failed, trying next...`);
        continue;
      }
    }

    throw new Error('All IPFS gateways failed');
  }
}
```

**Benefits**:
- Circuit breaker per gateway (try alternatives when one fails)
- Automatic gateway failover
- Bulkhead prevents IPFS fetches from blocking other operations
- Exponential backoff respects gateway rate limits

---

## Migration Strategy

### Phase 1: Add Resilience to Critical Paths

**Week 1**: Integrate into API serving layer
- District lookups with circuit breaker
- Stale cache fallback
- Rate limiting per client

**Week 2**: Integrate into batch extraction
- Circuit breaker per state portal
- Exponential backoff with jitter
- Bulkhead isolation

### Phase 2: Add Resilience to Background Tasks

**Week 3**: Integrate into IPFS sync
- Circuit breaker per gateway
- Gateway failover
- Retry with timeout

**Week 4**: Integrate into state boundary updates
- Circuit breaker for upstream APIs
- Graceful degradation on failures

### Phase 3: Production Validation

**Week 5**: Chaos testing
- Network delay injection
- Upstream failure simulation
- Resource exhaustion tests

**Week 6**: Production rollout
- Deploy with monitoring
- Validate recovery times
- Tune thresholds based on real traffic

---

## Testing Integration

### Unit Tests

```typescript
import { describe, it, expect } from 'vitest';
import { BatchOrchestrator } from './batch-orchestrator';

describe('BatchOrchestrator with Resilience', () => {
  it('should retry on transient failures', async () => {
    const orchestrator = new BatchOrchestrator();
    let attempts = 0;

    // Mock extractor with transient failure
    orchestrator['extractor'].extractLayer = async () => {
      attempts++;
      if (attempts === 1) {
        throw new Error('ETIMEDOUT');
      }
      return { success: true, featureCount: 100 };
    };

    await orchestrator.executeTask('WI', 'congressional');
    expect(attempts).toBe(2);
  });

  it('should open circuit after repeated failures', async () => {
    const orchestrator = new BatchOrchestrator();

    // Cause repeated failures
    orchestrator['extractor'].extractLayer = async () => {
      throw new Error('Service down');
    };

    for (let i = 0; i < 5; i++) {
      try {
        await orchestrator.executeTask('WI', 'congressional');
      } catch (error) {
        // Expected
      }
    }

    const health = orchestrator.resilience.getHealthState();
    expect(health.level).not.toBe('healthy');
  });
});
```

### Integration Tests

```typescript
import { describe, it, expect } from 'vitest';
import { ShadowAtlasAPI } from './api';

describe('API Resilience Integration', () => {
  it('should serve stale cache on database failure', async () => {
    const api = new ShadowAtlasAPI();

    // Populate cache
    await api.handleLookup(/* ... */);

    // Simulate database failure
    api['lookupService'].lookup = async () => {
      throw new Error('Database unavailable');
    };

    // Should serve from stale cache
    const response = await api.handleLookup(/* ... */);
    expect(response.status).toBe(200);
  });

  it('should enforce rate limits', async () => {
    const api = new ShadowAtlasAPI();

    // Make 150 requests rapidly
    const results = await Promise.allSettled(
      Array(150).fill(0).map(() => api.handleLookup(/* ... */))
    );

    const rateLimited = results.filter(
      r => r.status === 'rejected' && r.reason.code === 'RATE_LIMIT_EXCEEDED'
    );

    expect(rateLimited.length).toBeGreaterThan(0);
  });
});
```

### Chaos Tests

```typescript
import { describe, it, expect } from 'vitest';
import { createChaosFaultInjector } from './resilience/chaos';

describe('Chaos Engineering', () => {
  it('should survive 50% network failure rate', async () => {
    const chaos = createChaosFaultInjector(true);
    const orchestrator = new BatchOrchestrator({ chaos });

    chaos.configureFault('network_failure', {
      enabled: true,
      probability: 0.5,
      errorMessage: 'ECONNREFUSED',
    });

    const results = await Promise.allSettled(
      Array(100).fill(0).map(() => orchestrator.extractState('WI'))
    );

    const succeeded = results.filter(r => r.status === 'fulfilled');
    expect(succeeded.length).toBeGreaterThan(80);  // Should retry successfully
  });
});
```

---

## Monitoring & Alerting

### Grafana Dashboard

```yaml
# Circuit Breaker Panel
- title: Circuit Breaker States
  targets:
    - expr: circuit_breaker_state{name=~".*"}
      legendFormat: "{{name}}"

# Retry Rate Panel
- title: Retry Success Rate
  targets:
    - expr: rate(retry_successes_total[5m]) / rate(retry_attempts_total[5m])
      legendFormat: "{{operation}}"

# Bulkhead Utilization Panel
- title: Bulkhead Active/Queued
  targets:
    - expr: bulkhead_active{name=~".*"}
      legendFormat: "{{name}} (active)"
    - expr: bulkhead_queued{name=~".*"}
      legendFormat: "{{name}} (queued)"
```

### PagerDuty Alerts

```yaml
# Critical: Circuit breaker open >5 minutes
- alert: CircuitBreakerOpenCritical
  expr: circuit_breaker_state == 1 and (time() - circuit_breaker_last_state_change) > 300
  severity: critical
  annotations:
    summary: "Circuit breaker {{$labels.name}} open >5 minutes"

# Warning: High retry rate
- alert: HighRetryRate
  expr: rate(retry_attempts_total[5m]) > 10
  severity: warning
  annotations:
    summary: "High retry rate for {{$labels.operation}}"

# Warning: Bulkhead rejections
- alert: BulkheadRejections
  expr: rate(bulkhead_rejected_total[5m]) > 5
  severity: warning
  annotations:
    summary: "Bulkhead {{$labels.name}} rejecting requests"
```

---

## Configuration Best Practices

### Circuit Breaker Thresholds

**High-traffic user-facing APIs**:
- `failureThreshold: 10-20` (higher tolerance)
- `openDurationMs: 30000-60000` (faster recovery)

**Low-traffic background jobs**:
- `failureThreshold: 3-5` (lower tolerance)
- `openDurationMs: 60000-300000` (slower recovery)

### Retry Configuration

**Fast APIs (IPFS, CDN)**:
- `maxAttempts: 2-3`
- `initialDelayMs: 50-100`
- `maxDelayMs: 1000-5000`

**Slow APIs (State portals)**:
- `maxAttempts: 2`
- `initialDelayMs: 500-1000`
- `maxDelayMs: 10000-30000`

### Bulkhead Sizing

**CPU-bound operations**:
- `maxConcurrent: CPU_CORES * 2`

**Network-bound operations**:
- `maxConcurrent: 10-50` (based on connection pool)

**Memory-bound operations**:
- `maxConcurrent: MEMORY_MB / OPERATION_SIZE_MB`

---

## Troubleshooting

### Circuit Breaker Stuck Open

**Symptoms**: Circuit remains open despite upstream recovery

**Diagnosis**:
```typescript
const stats = breaker.getStats();
console.log('Circuit state:', stats.state);
console.log('Consecutive failures:', stats.consecutiveFailures);
console.log('Time since state change:', Date.now() - stats.lastStateChange);
```

**Solutions**:
- Check `openDurationMs` - may need tuning
- Verify upstream actually recovered
- Check half-open call limits
- Consider manual reset: `breaker.reset()`

### Excessive Retries

**Symptoms**: High latency, upstream complaints about traffic

**Diagnosis**:
```typescript
const attempts = error.attempts;  // From RetryExhaustedError
console.log('Retry attempts:', attempts.map(a => ({
  attempt: a.attemptNumber,
  delay: a.delayMs,
  retryable: a.retryable,
})));
```

**Solutions**:
- Reduce `maxAttempts`
- Increase `initialDelayMs` and `maxDelayMs`
- Review `retryableErrors` - may be retrying permanent failures

### Bulkhead Rejections

**Symptoms**: High rejection rate, degraded user experience

**Diagnosis**:
```typescript
const stats = bulkhead.getStats();
console.log('Active:', stats.activeCount);
console.log('Queued:', stats.queuedCount);
console.log('Rejected:', stats.rejectedCount);
console.log('Avg execution time:', stats.avgExecutionMs);
```

**Solutions**:
- Increase `maxConcurrent` if resources available
- Increase `maxQueueSize` for burst handling
- Reduce `queueTimeoutMs` if queueing too long
- Consider horizontal scaling

---

## Next Steps

1. **Integrate into batch-orchestrator.ts** (highest impact)
2. **Add to state-batch-extractor.ts** (prevent upstream hammering)
3. **Enhance api.ts** (user-facing resilience)
4. **Deploy to staging** (validate with real traffic)
5. **Run chaos tests** (verify failure handling)
6. **Monitor metrics** (tune thresholds)
7. **Deploy to production** (gradual rollout)

See [RESILIENCE_SPEC.md](./RESILIENCE_SPEC.md) for complete technical specification.
