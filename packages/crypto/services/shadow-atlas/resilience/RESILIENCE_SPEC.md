# Shadow Atlas Resilience Specification

Battle-tested resilience patterns for production Shadow Atlas deployment.

**Reliability Target**: Graceful degradation under any single failure, full recovery within 5 minutes.

---

## Table of Contents

1. [Failure Modes Catalog](#failure-modes-catalog)
2. [Resilience Patterns](#resilience-patterns)
3. [Recovery Procedures](#recovery-procedures)
4. [Timeout Budgets](#timeout-budgets)
5. [Degradation Levels](#degradation-levels)
6. [Observability](#observability)
7. [Chaos Testing](#chaos-testing)

---

## Failure Modes Catalog

### Network Failures

| Failure Mode | Probability | Impact | MTTR | Mitigation |
|--------------|-------------|--------|------|------------|
| **IPFS Gateway Timeout** | Medium | High | 5-30s | Circuit breaker + retry with backoff |
| **DNS Resolution Failure** | Low | Critical | 1-5m | Multiple gateway fallbacks |
| **Partial Network Partition** | Low | High | 5-15m | Stale cache fallback |
| **SSL/TLS Handshake Failure** | Low | Medium | 10-60s | Retry with exponential backoff |
| **Rate Limiting (429)** | Medium | Medium | Variable | Exponential backoff + jitter |

### Upstream Service Failures

| Failure Mode | Probability | Impact | MTTR | Mitigation |
|--------------|-------------|--------|------|------------|
| **IPFS Gateway 503** | Medium | High | 1-10m | Circuit breaker + fallback gateway |
| **Census TIGER API Down** | Low | Medium | 30m-2h | Stale cache + degraded mode |
| **State GIS Portal Outage** | Low | Medium | 1-24h | TIGER fallback + cached data |
| **Storacha Upload Failure** | Low | Low | 5-30m | Local storage + retry queue |

### Data Integrity Failures

| Failure Mode | Probability | Impact | MTTR | Mitigation |
|--------------|-------------|--------|------|------------|
| **Merkle Root Mismatch** | Very Low | Critical | 0s | Reject immediately, alert |
| **GeoJSON Malformation** | Low | Medium | 0s | Schema validation + error boundaries |
| **IPFS Content Corruption** | Very Low | High | Variable | CID verification + re-fetch |
| **Database Corruption** | Very Low | Critical | 1-6h | Point-in-time recovery |

### Resource Exhaustion

| Failure Mode | Probability | Impact | MTTR | Mitigation |
|--------------|-------------|--------|------|------------|
| **Memory Exhaustion** | Low | Critical | 1-5m | Bulkhead isolation + memory limits |
| **Disk Space Full** | Low | High | 5-30m | Monitoring + automatic cleanup |
| **CPU Saturation** | Medium | Medium | 1-5m | Rate limiting + bulkheads |
| **Connection Pool Exhausted** | Medium | High | 1-10s | Connection pooling + timeouts |

---

## Resilience Patterns

### 1. Circuit Breaker

**Purpose**: Prevent cascade failures by monitoring upstream dependencies.

**Implementation**: Finite state machine (closed → open → half-open)

**Configuration**:
```typescript
{
  failureThreshold: 5,        // Open after 5 consecutive failures
  successThreshold: 2,         // Close after 2 consecutive successes in half-open
  openDurationMs: 60000,       // Stay open for 1 minute
  halfOpenMaxCalls: 3,         // Max 3 concurrent calls in half-open
  monitoringWindowMs: 60000,   // 1 minute monitoring window
  volumeThreshold: 10,         // Min 10 calls before circuit can open
}
```

**Upstreams Protected**:
- IPFS gateway requests
- Census TIGER API calls
- State GIS portal queries
- Storacha uploads

**State Transitions**:
- **Closed**: Normal operation, all requests allowed
- **Open**: Fail fast, all requests rejected immediately
- **Half-Open**: Limited requests to test recovery

**Metrics**:
- State (closed/open/half-open)
- Failure count / success count
- Consecutive failures
- Last state change timestamp

### 2. Retry with Exponential Backoff

**Purpose**: Handle transient failures with intelligent retry logic.

**Algorithm**:
```
delay = initialDelay * (multiplier ^ attempt) + jitter
jitter = random(-jitterFactor * delay, +jitterFactor * delay)
```

**Configuration**:
```typescript
{
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
  jitterFactor: 0.1,          // 10% randomness
  retryableErrors: [
    'network_timeout',
    'network_error',
    'rate_limit',
    'service_unavailable',
    'gateway_timeout',
  ],
  timeoutMs: 30000,            // Total timeout: 30s
}
```

**Retry Schedule Example**:
- Attempt 1: Immediate
- Attempt 2: ~100ms (90-110ms with jitter)
- Attempt 3: ~200ms (180-220ms with jitter)
- Attempt 4: ~400ms (360-440ms with jitter)

**Non-Retryable Errors**:
- 400 Bad Request (client error)
- 401 Unauthorized (auth failure)
- 404 Not Found (permanent failure)
- Data validation errors

### 3. Bulkhead Isolation

**Purpose**: Prevent resource exhaustion from cascading across services.

**Configuration**:
```typescript
{
  name: 'ipfs-downloads',
  maxConcurrent: 10,           // Max 10 concurrent downloads
  maxQueueSize: 20,            // Queue up to 20 requests
  queueTimeoutMs: 5000,        // Max 5s wait in queue
}
```

**Isolated Paths**:
- **Critical**: District lookups (high priority)
- **Batch**: State extractions (lower priority, higher concurrency)
- **Background**: IPFS sync (lowest priority)

**Benefits**:
- One failing upstream doesn't exhaust all connections
- Critical paths remain responsive
- Predictable degradation under load

### 4. Fallback Strategies

**Purpose**: Graceful degradation when primary path fails.

**Strategies**:

#### Static Response
```typescript
{
  strategy: 'static_response',
  staticValue: { districts: [], error: 'Service degraded' }
}
```
Use for: Non-critical features that can return empty results

#### Stale Cache
```typescript
{
  strategy: 'stale_cache',
  staleDataMaxAgeMs: 3600000,  // Serve cache up to 1 hour old
}
```
Use for: District data (updated quarterly, stale cache acceptable)

#### Degraded Service
```typescript
{
  strategy: 'degraded_service',
  degradedMode: true,
}
```
Use for: Reduced functionality (e.g., lookups without proofs)

### 5. Rate Limiting (Token Bucket)

**Purpose**: Prevent resource exhaustion from traffic spikes.

**Algorithm**: Token bucket with configurable refill rate

**Configuration**:
```typescript
{
  maxTokens: 60,               // Bucket capacity
  refillRate: 1,               // 1 token per second
  refillIntervalMs: 1000,      // Refill every 1 second
  burstSize: 10,               // Allow bursts up to 10
}
```

**Per-Client Limits**:
- API requests: 60 req/min per IP
- Bursts: Up to 10 requests instantly
- Refill: 1 request per second sustained

**Global Limits**:
- IPFS gateway: 100 req/sec aggregate
- State GIS portals: 10 req/sec per portal

---

## Recovery Procedures

### Automatic Recovery

**Circuit Breaker Auto-Recovery**:
1. Circuit opens after threshold failures
2. Wait 1 minute (openDurationMs)
3. Transition to half-open
4. Allow 3 test requests (halfOpenMaxCalls)
5. If 2+ succeed, transition to closed
6. If any fail, transition back to open

**Expected Timeline**: 1-2 minutes for transient failures

**Retry Recovery**:
1. Exponential backoff with jitter
2. Max 3 attempts over ~5 seconds
3. Automatic on retryable errors
4. Manual intervention needed if all attempts fail

**Bulkhead Recovery**:
- Automatic when concurrent calls drop below threshold
- Queue processed FIFO when capacity available
- No manual intervention needed

### Manual Recovery

**Database Corruption**:
1. Stop API server
2. Restore from latest IPFS snapshot
3. Verify Merkle root matches on-chain
4. Restart API server
5. Monitor error rates

**Expected Timeline**: 5-15 minutes

**Upstream Dependency Total Failure**:
1. Check circuit breaker state (should be open)
2. Verify fallback strategy active
3. Enable stale cache serving if needed
4. Monitor upstream recovery
5. Circuit auto-recovers when upstream healthy

**Expected Timeline**: Automatic once upstream recovers

---

## Timeout Budgets

### Client-Facing Operations

| Operation | Timeout | Breakdown |
|-----------|---------|-----------|
| **District Lookup** | 500ms | DB query (50ms) + Merkle proof (50ms) + overhead (400ms) |
| **Snapshot Sync** | 30s | IPFS fetch (20s) + DB write (5s) + overhead (5s) |
| **Health Check** | 100ms | Metrics collection (50ms) + serialization (50ms) |

### Upstream Dependencies

| Upstream | Connect | Read | Total | Retry Budget |
|----------|---------|------|-------|--------------|
| **IPFS Gateway** | 2s | 10s | 12s | 3 attempts = 36s max |
| **Census TIGER** | 2s | 8s | 10s | 3 attempts = 30s max |
| **State GIS Portal** | 2s | 15s | 17s | 3 attempts = 51s max |
| **Storacha Upload** | 5s | 30s | 35s | 3 attempts = 105s max |

### Total Timeout Budget

**End-to-end lookup with all retries**: <50 seconds worst case

**95th percentile target**: <500ms

---

## Degradation Levels

### Healthy (100% Capacity)

**Characteristics**:
- All upstreams responding normally
- All circuit breakers closed
- Cache hit rate >80%
- P95 latency <100ms

**Capabilities**:
- Full district lookups with Merkle proofs
- Real-time IPFS snapshot sync
- All validation enabled

### Degraded Minor (80-100% Capacity)

**Characteristics**:
- 1 non-critical upstream degraded
- 1-2 circuit breakers half-open
- Cache hit rate 60-80%
- P95 latency 100-500ms

**Capabilities**:
- Full district lookups (slower)
- Delayed IPFS sync (stale cache <1 hour)
- Critical validation only

**Fallbacks Active**:
- Stale cache for non-critical data
- Retry with longer backoff

### Degraded Major (50-80% Capacity)

**Characteristics**:
- 2+ upstreams degraded
- Multiple circuit breakers open
- Cache hit rate 40-60%
- P95 latency 500-2000ms

**Capabilities**:
- District lookups without proofs
- Manual IPFS sync only
- No validation (trust cache)

**Fallbacks Active**:
- Stale cache for all data (up to 6 hours)
- Static responses for non-essential features

### Critical (<50% Capacity)

**Characteristics**:
- Primary IPFS gateway down
- All circuit breakers open
- Cache hit rate <40%
- P95 latency >2000ms

**Capabilities**:
- Read-only from stale cache
- No new data ingestion
- Basic health checks only

**Fallbacks Active**:
- Emergency fallback gateway
- Static error responses
- Manual intervention required

---

## Observability

### Metrics

**Circuit Breaker Metrics**:
```
circuit_breaker_state{name="ipfs-gateway"} = 0|1|2  # closed|open|half-open
circuit_breaker_failures_total{name="ipfs-gateway"}
circuit_breaker_successes_total{name="ipfs-gateway"}
circuit_breaker_state_changes_total{name="ipfs-gateway"}
```

**Retry Metrics**:
```
retry_attempts_total{operation="ipfs-fetch"}
retry_successes_total{operation="ipfs-fetch"}
retry_exhausted_total{operation="ipfs-fetch"}
retry_latency_seconds{operation="ipfs-fetch",quantile="0.95"}
```

**Bulkhead Metrics**:
```
bulkhead_active{name="ipfs-downloads"}
bulkhead_queued{name="ipfs-downloads"}
bulkhead_rejected_total{name="ipfs-downloads"}
bulkhead_completed_total{name="ipfs-downloads"}
```

**Rate Limiter Metrics**:
```
rate_limiter_tokens{client="192.168.1.1"}
rate_limiter_allowed_total{client="192.168.1.1"}
rate_limiter_rejected_total{client="192.168.1.1"}
```

### Alerts

**Critical (Page Immediately)**:
- Circuit breaker open >5 minutes
- Error rate >10% sustained 5 minutes
- P95 latency >5 seconds sustained 5 minutes
- Memory usage >90%

**Warning (Page During Business Hours)**:
- Circuit breaker open >1 minute
- Error rate >5% sustained 10 minutes
- P95 latency >1 second sustained 10 minutes
- Cache hit rate <50%

**Info (Log Only)**:
- Circuit breaker state changes
- Retry exhaustion
- Bulkhead rejections
- Rate limiting events

---

## Chaos Testing

### Test Scenarios

**Network Failure Scenarios**:
```typescript
// Scenario 1: IPFS gateway timeout
injector.configureFault('network_delay', {
  enabled: true,
  probability: 0.5,  // 50% of requests
  delayMs: 5000,     // 5 second delay
});

// Scenario 2: Complete network failure
injector.configureFault('network_failure', {
  enabled: true,
  probability: 0.2,  // 20% of requests
  errorMessage: 'ECONNREFUSED',
});
```

**Upstream Failure Scenarios**:
```typescript
// Scenario 3: Upstream 503 errors
injector.configureFault('upstream_error', {
  enabled: true,
  probability: 0.3,  // 30% of requests
  errorCode: '503',
  errorMessage: 'Service temporarily unavailable',
});
```

**Resource Exhaustion Scenarios**:
```typescript
// Scenario 4: Gradual memory exhaustion
injector.configureFault('resource_exhaustion', {
  enabled: true,
  probability: 0.1,  // 10% of requests
  errorMessage: 'Out of memory',
});
```

### Validation Criteria

**Circuit Breaker Tests**:
- ✅ Opens after 5 consecutive failures
- ✅ Transitions to half-open after 1 minute
- ✅ Closes after 2 consecutive successes
- ✅ Returns to open on single half-open failure

**Retry Tests**:
- ✅ Retries transient failures (timeouts, 503)
- ✅ Does NOT retry permanent failures (400, 404)
- ✅ Respects exponential backoff timing
- ✅ Adds jitter to prevent thundering herd

**Bulkhead Tests**:
- ✅ Rejects when concurrent limit exceeded
- ✅ Queues up to maxQueueSize
- ✅ Times out queued requests after queueTimeoutMs
- ✅ Processes queue FIFO when capacity available

**Fallback Tests**:
- ✅ Returns static response on primary failure
- ✅ Serves stale cache within maxAgeMs
- ✅ Rejects stale cache beyond maxAgeMs
- ✅ Automatically switches back to primary when available

### Test Commands

```bash
# Run chaos tests
npm run test:chaos

# Run specific scenario
npm run test:chaos -- --scenario=network-failure

# Run with custom fault probability
npm run test:chaos -- --fault-probability=0.5

# Run end-to-end resilience test
npm run test:resilience
```

---

## Production Deployment Checklist

**Pre-Deployment**:
- [ ] Circuit breaker thresholds tuned for production traffic
- [ ] Retry budgets validated against upstream SLAs
- [ ] Bulkhead limits set based on resource capacity
- [ ] Rate limits configured for expected traffic
- [ ] Fallback strategies tested with stale data
- [ ] Chaos tests passing with 0 unexpected failures

**Monitoring**:
- [ ] Prometheus metrics exported
- [ ] Grafana dashboards configured
- [ ] PagerDuty alerts configured
- [ ] Error tracking (Sentry/Rollbar) enabled
- [ ] Structured logging with trace IDs

**Runbooks**:
- [ ] Circuit breaker manual override procedure
- [ ] Database corruption recovery procedure
- [ ] IPFS gateway failover procedure
- [ ] Emergency degraded mode activation

**Capacity Planning**:
- [ ] Load test at 2x expected peak traffic
- [ ] Validate graceful degradation at 5x traffic
- [ ] Confirm recovery after simulated failures
- [ ] Document resource limits and scaling triggers

---

## References

**Resilience Patterns**:
- Martin Fowler, "CircuitBreaker" (2014)
- Michael Nygard, "Release It!" (2nd Edition, 2018)
- AWS Architecture Blog, "Exponential Backoff And Jitter" (2015)

**Chaos Engineering**:
- Casey Rosenthal, "Principles of Chaos Engineering" (O'Reilly, 2020)
- Netflix Chaos Monkey documentation
- Gremlin chaos engineering platform

**Distributed Systems**:
- Andrew Tanenbaum, "Computer Networks" (6th Edition)
- Martin Kleppmann, "Designing Data-Intensive Applications" (2017)
- Google SRE Book, "Site Reliability Engineering" (2016)
