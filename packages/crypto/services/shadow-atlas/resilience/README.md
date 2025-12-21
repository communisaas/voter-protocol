# Shadow Atlas Resilience Patterns

Production-grade resilience infrastructure for distributed systems.

**Reliability Target**: Graceful degradation under any single failure, full recovery within 5 minutes.

---

## Quick Start

```typescript
import { createResilienceStack } from './resilience';

// Create integrated resilience stack
const resilience = createResilienceStack({
  name: 'ipfs-gateway',
  circuitBreaker: {
    failureThreshold: 5,
    openDurationMs: 60000,
  },
  retry: {
    maxAttempts: 3,
    initialDelayMs: 100,
  },
  bulkhead: {
    maxConcurrent: 10,
    maxQueueSize: 20,
  },
  rateLimiter: {
    maxTokens: 100,
    refillRate: 10,
  },
});

// Execute with full resilience protection
const result = await resilience.execute('ipfs-gateway', async () => {
  return fetch('https://ipfs.io/ipfs/...');
}, {
  fallbackValue: { error: 'Service degraded' },
  cachedValue: { value: cachedData, timestamp: Date.now() },
});

// Monitor health
const health = resilience.getHealthState();
console.log(`System health: ${health.level}`);
```

---

## Patterns

### Circuit Breaker

Prevents cascade failures by monitoring error rates and temporarily blocking requests.

```typescript
import { createCircuitBreaker } from './resilience';

const breaker = createCircuitBreaker('upstream-service', {
  failureThreshold: 5,        // Open after 5 consecutive failures
  successThreshold: 2,         // Close after 2 consecutive successes
  openDurationMs: 60000,       // Stay open for 1 minute
  halfOpenMaxCalls: 3,         // Max 3 test calls in half-open
});

try {
  const result = await breaker.execute(async () => {
    return fetch('https://upstream.example.com/api');
  });
} catch (error) {
  if (error instanceof CircuitBreakerOpenError) {
    // Use fallback
  }
}
```

**States**: Closed → Open → Half-Open → Closed

**Metrics**: State, failure count, success count, consecutive failures

### Retry with Exponential Backoff

Handles transient failures with intelligent retry logic.

```typescript
import { retry } from './resilience';

const result = await retry(async () => {
  return fetch('https://upstream.example.com/api');
}, {
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
  jitterFactor: 0.1,
});
```

**Retry Schedule**:
- Attempt 1: Immediate
- Attempt 2: ~100ms (with jitter)
- Attempt 3: ~200ms (with jitter)

**Retryable Errors**: Network timeouts, 503, 429, temporary failures

**Non-Retryable**: 400, 404, validation errors

### Bulkhead Isolation

Limits concurrent executions to prevent resource exhaustion.

```typescript
import { createBulkhead } from './resilience';

const bulkhead = createBulkhead('ipfs-downloads', {
  maxConcurrent: 10,
  maxQueueSize: 20,
  queueTimeoutMs: 5000,
});

const result = await bulkhead.execute(async () => {
  return downloadFromIPFS(cid);
});
```

**Benefits**:
- Prevents resource exhaustion
- Isolates failure domains
- Predictable degradation

### Fallback Strategies

Graceful degradation when primary path fails.

```typescript
import { executeWithStaticFallback, executeWithStaleCache } from './resilience';

// Static fallback
const result = await executeWithStaticFallback(
  async () => fetchFromUpstream(),
  { districts: [], error: 'Service degraded' }
);

// Stale cache fallback
const result = await executeWithStaleCache(
  async () => fetchFromUpstream(),
  { value: cachedData, timestamp: Date.now() - 30000 },
  3600000  // Max 1 hour stale
);
```

**Strategies**:
- Static response
- Stale cache
- Degraded service
- Fail open

### Rate Limiting

Token bucket algorithm for traffic control.

```typescript
import { createRateLimiter } from './resilience';

const limiter = createRateLimiter({
  maxTokens: 60,
  refillRate: 1,  // 1 token per second
  refillIntervalMs: 1000,
});

if (limiter.tryConsume()) {
  // Process request
} else {
  // Rate limited
}
```

**Features**:
- Configurable burst capacity
- Per-client tracking
- Automatic token refill

---

## Chaos Engineering

Test resilience under failure conditions.

```typescript
import { createChaosFaultInjector } from './resilience/chaos';

const chaos = createChaosFaultInjector(true);

// Configure network delay
chaos.configureFault('network_delay', {
  enabled: true,
  probability: 0.2,  // 20% of requests
  delayMs: 1000,
});

// Configure network failure
chaos.configureFault('network_failure', {
  enabled: true,
  probability: 0.1,  // 10% of requests
  errorMessage: 'ECONNREFUSED',
});

// Execute with fault injection
await chaos.execute('network_delay', async () => {
  return fetch('https://upstream.example.com');
});
```

**Fault Types**:
- Network delay
- Network failure
- Upstream errors (503, 504)
- Timeouts
- Data corruption
- Resource exhaustion

---

## Monitoring & Observability

### Health Metrics

```typescript
const health = resilience.getHealthState();

console.log(`Health Level: ${health.level}`);
// Output: 'healthy' | 'degraded_minor' | 'degraded_major' | 'critical'

console.log(`Circuit Breakers Open: ${health.activeCircuitBreakers.join(', ')}`);
console.log(`Rate Limited Clients: ${health.rateLimitedClients}`);

for (const [name, upstream] of Object.entries(health.upstreamHealth)) {
  console.log(`${name}:`, {
    available: upstream.available,
    latency: upstream.latencyMs,
    errorRate: upstream.errorRate,
    circuitState: upstream.circuitState,
  });
}
```

### Prometheus Metrics

```typescript
// Circuit breaker metrics
circuit_breaker_state{name="ipfs-gateway"} = 0  // closed
circuit_breaker_failures_total{name="ipfs-gateway"} = 5
circuit_breaker_successes_total{name="ipfs-gateway"} = 100

// Retry metrics
retry_attempts_total{operation="ipfs-fetch"} = 10
retry_successes_total{operation="ipfs-fetch"} = 8
retry_exhausted_total{operation="ipfs-fetch"} = 2

// Bulkhead metrics
bulkhead_active{name="ipfs-downloads"} = 5
bulkhead_queued{name="ipfs-downloads"} = 3
bulkhead_rejected_total{name="ipfs-downloads"} = 2

// Rate limiter metrics
rate_limiter_allowed_total{client="192.168.1.1"} = 100
rate_limiter_rejected_total{client="192.168.1.1"} = 5
```

### Event Listeners

```typescript
breaker.onEvent((event) => {
  console.log(`Circuit breaker event: ${event.type}`, event.metadata);
});

bulkhead.onEvent((event) => {
  console.log(`Bulkhead event: ${event.type}`, event.metadata);
});

chaos.onEvent((event) => {
  console.log(`Chaos injection: ${event.faultType}`, event.config);
});
```

---

## Testing

### Unit Tests

```bash
npm run test -- resilience/circuit-breaker.test.ts
npm run test -- resilience/retry.test.ts
npm run test -- resilience/bulkhead.test.ts
npm run test -- resilience/fallback.test.ts
npm run test -- resilience/rate-limiter.test.ts
```

### Integration Tests

```bash
npm run test -- resilience/chaos/resilience-integration.test.ts
```

### Chaos Tests

```bash
# Run chaos scenarios
npm run test:chaos

# Run specific scenario
npm run test:chaos -- --scenario=network-failure

# Custom fault probability
npm run test:chaos -- --fault-probability=0.5
```

---

## Production Deployment

### Pre-Deployment Checklist

- [ ] Circuit breaker thresholds tuned for production traffic
- [ ] Retry budgets validated against upstream SLAs
- [ ] Bulkhead limits set based on resource capacity
- [ ] Rate limits configured for expected traffic
- [ ] Fallback strategies tested with stale data
- [ ] Chaos tests passing with 0 unexpected failures
- [ ] Prometheus metrics exported
- [ ] Grafana dashboards configured
- [ ] PagerDuty alerts configured
- [ ] Runbooks documented

### Recommended Configuration

**IPFS Gateway**:
```typescript
createResilienceStack({
  name: 'ipfs-gateway',
  circuitBreaker: {
    failureThreshold: 5,
    openDurationMs: 60000,
    volumeThreshold: 10,
  },
  retry: {
    maxAttempts: 3,
    initialDelayMs: 100,
    maxDelayMs: 5000,
    timeoutMs: 30000,
  },
  bulkhead: {
    maxConcurrent: 10,
    maxQueueSize: 20,
    queueTimeoutMs: 5000,
  },
  rateLimiter: {
    maxTokens: 100,
    refillRate: 10,
  },
});
```

**State GIS Portals**:
```typescript
createResilienceStack({
  name: 'state-gis',
  circuitBreaker: {
    failureThreshold: 3,
    openDurationMs: 120000,  // 2 minutes (slower recovery)
  },
  retry: {
    maxAttempts: 2,  // Fewer retries (avoid hammering)
    initialDelayMs: 500,
    maxDelayMs: 10000,
  },
  bulkhead: {
    maxConcurrent: 5,  // Lower concurrency (respect upstream)
    maxQueueSize: 10,
  },
  rateLimiter: {
    maxTokens: 60,
    refillRate: 1,  // 1 req/sec (conservative)
  },
});
```

---

## Architecture Decisions

### Why These Patterns?

**Circuit Breaker**: Prevents cascade failures when upstream is unhealthy. Fail fast instead of waiting for timeouts.

**Retry with Backoff**: Handles transient network failures. Exponential backoff + jitter prevents thundering herd.

**Bulkhead**: Isolates failure domains. One failing upstream doesn't exhaust all connections.

**Fallback**: Maintains availability during outages. Graceful degradation beats total failure.

**Rate Limiting**: Protects against traffic spikes. Prevents resource exhaustion and respects upstream limits.

### Design Principles

1. **Fail Fast**: Circuit breaker rejects immediately when open
2. **Graceful Degradation**: Fallback strategies maintain partial functionality
3. **Isolation**: Bulkheads prevent cascade failures
4. **Observability**: Rich metrics and events for monitoring
5. **Testability**: Chaos engineering for production readiness

### Trade-offs

**Circuit Breaker**:
- ✅ Prevents cascade failures
- ❌ May reject requests during recovery
- **Mitigation**: Half-open state allows gradual recovery

**Retry**:
- ✅ Handles transient failures
- ❌ Increases latency on failures
- **Mitigation**: Exponential backoff limits total time

**Bulkhead**:
- ✅ Prevents resource exhaustion
- ❌ Rejects requests when full
- **Mitigation**: Queue allows short bursts

**Rate Limiting**:
- ✅ Protects against spikes
- ❌ May reject legitimate traffic
- **Mitigation**: Token bucket allows bursts

---

## References

**Books**:
- Michael Nygard, "Release It!" (2nd Edition, 2018)
- Martin Kleppmann, "Designing Data-Intensive Applications" (2017)
- Casey Rosenthal, "Principles of Chaos Engineering" (O'Reilly, 2020)

**Papers**:
- AWS Architecture Blog, "Exponential Backoff And Jitter" (2015)
- Martin Fowler, "CircuitBreaker" (2014)

**Systems**:
- Netflix Hystrix
- Google SRE practices
- AWS resilience patterns

---

## License

SPDX-License-Identifier: MIT

See [RESILIENCE_SPEC.md](./RESILIENCE_SPEC.md) for complete specification.
