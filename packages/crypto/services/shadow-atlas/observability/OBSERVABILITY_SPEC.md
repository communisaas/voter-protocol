# Shadow Atlas Observability Specification

**Version**: 1.0
**Last Updated**: 2025-12-18
**Owner**: SRE Team
**Status**: Production Ready

## Executive Summary

Shadow Atlas implements production-grade observability for 24/7 global operation supporting VOTER Protocol district verification. This specification defines metrics, logging, tracing, alerting, and dashboard infrastructure targeting **99.9% availability** and **p99 latency < 100ms**.

**Architecture Philosophy**: Lightweight, zero external dependencies for pre-launch, Prometheus-compatible for future scale.

---

## Table of Contents

1. [Service Level Objectives (SLOs)](#service-level-objectives-slos)
2. [Metrics Catalog](#metrics-catalog)
3. [Distributed Tracing](#distributed-tracing)
4. [Structured Logging](#structured-logging)
5. [Alerting Rules](#alerting-rules)
6. [Dashboards](#dashboards)
7. [Health Checks](#health-checks)
8. [Runbook Index](#runbook-index)
9. [Integration Guide](#integration-guide)

---

## Service Level Objectives (SLOs)

### Availability SLO

**Target**: 99.9% availability (30-day rolling window)

- **Error Budget**: 43.2 minutes/month downtime
- **Measurement**: `(successful_requests / total_requests) >= 0.999`
- **Critical Threshold**: Error rate > 1% for 2 minutes
- **Warning Threshold**: Error rate > 0.1% for 5 minutes

### Latency SLO

**Target**: p99 latency < 100ms for district lookups

- **Measurement**: `histogram_quantile(0.99, shadow_atlas_request_latency_bucket)`
- **Critical Threshold**: p99 > 100ms for 5 minutes
- **Warning Threshold**: p99 > 75ms for 10 minutes

**Secondary Target**: p95 latency < 50ms

- **Critical Threshold**: p95 > 50ms for 10 minutes
- **Warning Threshold**: p95 > 40ms for 15 minutes

### Data Quality SLO

**Target**: 90% extraction success rate

- **Measurement**: `extraction_success / (extraction_success + extraction_failure)`
- **Critical Threshold**: Success rate < 80% for 5 minutes
- **Warning Threshold**: Success rate < 90% for 10 minutes

---

## Metrics Catalog

All metrics use SQLite for storage (pre-launch) and export to Prometheus format via `/metrics` endpoint.

### Request Metrics

| Metric Name | Type | Labels | Description |
|-------------|------|--------|-------------|
| `shadow_atlas_requests_total` | Counter | `method`, `path`, `status` | Total HTTP requests |
| `shadow_atlas_request_latency` | Histogram | `method`, `path` | Request latency in milliseconds |
| `shadow_atlas_request_error_total` | Counter | `method`, `path`, `status` | Failed requests (4xx/5xx) |
| `shadow_atlas_active_connections` | Gauge | - | Current active HTTP connections |

**Buckets** (latency histogram): `[5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]` ms

### Extraction Metrics

| Metric Name | Type | Labels | Description |
|-------------|------|--------|-------------|
| `shadow_atlas_extraction_success_total` | Counter | `state`, `layer` | Successful boundary extractions |
| `shadow_atlas_extraction_failure_total` | Counter | `state`, `layer` | Failed extractions |
| `shadow_atlas_boundary_count` | Gauge | `state`, `layer` | Number of boundaries extracted |
| `shadow_atlas_job_duration` | Histogram | `state`, `layer` | Extraction job duration |

### Provider Metrics

| Metric Name | Type | Labels | Description |
|-------------|------|--------|-------------|
| `shadow_atlas_provider_health` | Gauge | `provider` | Provider availability (0=down, 1=up) |
| `shadow_atlas_provider_latency` | Histogram | `provider` | Provider response latency |
| `shadow_atlas_provider_error_total` | Counter | `provider`, `error` | Provider errors |

### Validation Metrics

| Metric Name | Type | Labels | Description |
|-------------|------|--------|-------------|
| `shadow_atlas_validation_pass_total` | Counter | `state`, `layer` | Passed validations |
| `shadow_atlas_validation_fail_total` | Counter | `state`, `layer` | Failed validations |

### Cache Metrics

| Metric Name | Type | Labels | Description |
|-------------|------|--------|-------------|
| `shadow_atlas_cache_hit_total` | Counter | `path` | Cache hits |
| `shadow_atlas_cache_miss_total` | Counter | `path` | Cache misses |
| `shadow_atlas_cache_hit_rate` | Gauge | - | Cache hit rate (0-1) |
| `shadow_atlas_cache_evictions_total` | Counter | - | Cache evictions |

### Proof Generation Metrics

| Metric Name | Type | Labels | Description |
|-------------|------|--------|-------------|
| `shadow_atlas_merkle_proof` | Histogram | `success` | Merkle proof generation latency |
| `shadow_atlas_proof_generation` | Histogram | `success` | ZK proof generation latency |

### Database Metrics

| Metric Name | Type | Labels | Description |
|-------------|------|--------|-------------|
| `shadow_atlas_db_query` | Histogram | `queryType` | Database query latency |

### System Metrics

| Metric Name | Type | Labels | Description |
|-------------|------|--------|-------------|
| `shadow_atlas_health` | Gauge | - | Overall health (0=unhealthy, 1=degraded, 2=healthy) |
| `process_resident_memory_bytes` | Gauge | - | Memory usage (RSS) |
| `process_heap_bytes` | Gauge | - | Heap memory usage |

---

## Distributed Tracing

### Architecture

Shadow Atlas implements **OpenTelemetry-compatible distributed tracing** for request path analysis.

**Components**:
- **Tracer**: Lightweight in-memory span collector
- **Span Context Propagation**: W3C Trace Context format
- **Export**: OTLP JSON format to Jaeger/Zipkin

### Trace Structure

```
[SERVER] GET /lookup?lat=X&lon=Y (traceId: abc-123)
  └─ [INTERNAL] District Lookup (spanId: def-456, parentSpanId: abc-123)
      ├─ [CLIENT] Database Query (spanId: ghi-789)
      └─ [INTERNAL] Merkle Proof Generation (spanId: jkl-012)
```

### Key Spans

| Span Name | Kind | Attributes | Description |
|-----------|------|------------|-------------|
| `http_request` | SERVER | `method`, `path`, `status` | HTTP request handling |
| `district_lookup` | INTERNAL | `lat`, `lon`, `cache_hit` | District query |
| `db_query` | INTERNAL | `query_type`, `duration_ms` | Database operation |
| `merkle_proof` | INTERNAL | `district_id`, `proof_size` | Proof generation |
| `provider_request` | CLIENT | `provider`, `endpoint` | External provider call |

### Span Events

- `cache_hit`: Cache lookup succeeded
- `cache_miss`: Cache miss, fetching from DB
- `validation_start`: Validation pipeline started
- `validation_complete`: Validation finished with result

### Sampling

- **Default**: 100% sampling (pre-launch, low traffic)
- **Production**: Tail-based sampling (100% errors, 10% success)
- **Configuration**: `TRACING_SAMPLE_RATE` environment variable

### Integration

```typescript
import { getTracer, withSpan, SpanKind } from './observability/tracing';

const tracer = getTracer();

// Start trace
const context = tracer.startTrace('http_request', SpanKind.SERVER, {
  'http.method': 'GET',
  'http.path': '/lookup',
});

// Child span
await withSpan(tracer, context, 'district_lookup', async (spanCtx) => {
  const district = await lookupDistrict(lat, lon);
  tracer.setAttribute(spanCtx, 'district.id', district.id);
  return district;
});

// End trace
tracer.endSpan(context);
```

---

## Structured Logging

### Log Format

All logs output **JSON** to stdout for aggregation.

```json
{
  "level": "info",
  "message": "District lookup complete",
  "timestamp": "2025-12-18T10:30:45.123Z",
  "context": {
    "component": "ShadowAtlas",
    "traceId": "abc-123-def-456",
    "lat": 43.0731,
    "lon": -89.4012,
    "district": "WI-02",
    "latencyMs": 12.5,
    "cacheHit": true
  }
}
```

### Log Levels

| Level | Usage | Examples |
|-------|-------|----------|
| `debug` | Detailed diagnostic info | Query parameters, cache keys |
| `info` | Normal operations | Request start/end, extraction complete |
| `warn` | Recoverable issues | Cache miss, validation warning |
| `error` | Failures requiring attention | Provider timeout, DB error |

### Context Fields

**Required**:
- `component`: Service component name
- `timestamp`: ISO 8601 timestamp

**Recommended**:
- `traceId`: Distributed trace ID
- `spanId`: Current span ID
- `userId`: User identifier (if authenticated)
- `requestId`: Unique request identifier

### Sensitive Data Redaction

**NEVER log**:
- Full residential addresses
- PII (names, emails, phone numbers)
- API keys or secrets

**Safe to log**:
- Latitude/longitude (aggregated)
- District identifiers
- State codes
- Error messages (sanitized)

### Integration

```typescript
import { createLogger } from './observability/metrics';

const log = createLogger('ExtractionService', 'info');

log.info('Starting extraction', { state: 'WI', layers: ['congressional'] });
log.error('Extraction failed', { state: 'WI', error: e.message });
```

---

## Alerting Rules

### Critical Alerts

**Target**: Page on-call engineer immediately

| Alert | Condition | Duration | Action |
|-------|-----------|----------|--------|
| `HighErrorRate` | Error rate > 1% | 2 min | Page on-call |
| `ServiceDown` | Service unreachable | 1 min | Page on-call |
| `HighP99Latency` | p99 > 100ms | 5 min | Page on-call |
| `ProviderDown` | Provider health < 50% | 5 min | Page on-call |
| `SLOBudgetBurnRateFast` | Budget exhaustion < 7 days | 5 min | Page on-call |

### Warning Alerts

**Target**: Slack notification, investigate during business hours

| Alert | Condition | Duration | Action |
|-------|-----------|----------|--------|
| `LatencyIncreasing` | p99 > 75ms | 10 min | Slack warning |
| `ErrorRateIncreasing` | Error rate > 0.1% | 5 min | Slack warning |
| `CacheHitRateWarning` | Hit rate < 70% | 20 min | Investigate |
| `ExtractionFailureRateWarning` | Failure rate > 10% | 10 min | Monitor |

### Alert Channels

1. **PagerDuty** (critical): Immediate on-call escalation
2. **Slack** (#shadow-atlas-alerts): Warning/info alerts
3. **Email** (sre@voter-protocol.org): Daily digest
4. **File** (`/data/alerts.log`): Persistent audit trail

### Alert Configuration

Alerts defined in:
- `/observability/alerts/critical.yaml` - Critical alerts
- `/observability/alerts/warning.yaml` - Warning alerts

**Deployment**: Alerts deployed via Prometheus AlertManager or custom AlertManager.

---

## Dashboards

### Overview Dashboard

**File**: `observability/dashboards/overview.json`

**Panels**:
1. Request Rate (req/s) - Line graph
2. Request Latency (p50, p95, p99) - Line graph
3. Error Rate (%) - Line graph with thresholds
4. Cache Hit Rate (%) - Gauge
5. Active Connections - Line graph
6. System Health Score - Stat (0-2)
7. Uptime - Stat
8. Total Requests (24h) - Stat
9. Extraction Success Rate - Gauge
10. Memory Usage - Line graph
11. Provider Health - Table

**URL**: `https://grafana.voter-protocol.org/d/shadow-atlas-overview`

### Performance Dashboard

**File**: `observability/dashboards/performance.json`

**Panels**:
1. Request Latency Distribution - Heatmap
2. Latency by Endpoint (p99) - Line graph
3. Database Query Latency - Line graph
4. Merkle Proof Generation - Line graph
5. ZK Proof Generation - Line graph
6. Cache Performance Breakdown - Stacked graph
7. Request Rate by Status Code - Stacked graph
8. Throughput (req/s) - Stat
9. Avg Latency (1m) - Stat with thresholds
10. p99 Latency (5m) - Stat with thresholds
11. SLO Compliance - Gauge

**URL**: `https://grafana.voter-protocol.org/d/shadow-atlas-performance`

### Errors Dashboard

**File**: `observability/dashboards/errors.json`

**Panels**:
1. Error Rate Over Time - Line graph with alert
2. Errors by Type (24h) - Pie chart
3. Errors by Endpoint (24h) - Bar gauge
4. Extraction Failures - Line graph by state/layer
5. Provider Errors - Line graph by provider
6. Validation Failures - Line graph
7. Recent Error Log - Table
8. 4xx Error Rate - Stat
9. 5xx Error Rate - Stat
10. Total Errors (Last Hour) - Stat
11. Error Budget Remaining - Gauge
12. Failed Extractions by State - Table
13. Provider Availability - Table

**URL**: `https://grafana.voter-protocol.org/d/shadow-atlas-errors`

---

## Health Checks

### Liveness Probe

**Endpoint**: `GET /health/live`

**Purpose**: Is the process running?

**Response**:
```json
{
  "status": "up",
  "timestamp": 1703001645000
}
```

**HTTP Codes**:
- `200`: Service alive
- `503`: Service dead (restart required)

**Kubernetes Config**:
```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 10
  failureThreshold: 3
```

### Readiness Probe

**Endpoint**: `GET /health/ready`

**Purpose**: Is the service ready to accept traffic?

**Response**:
```json
{
  "status": "ready",
  "checks": {
    "database": "ok",
    "cache": "ok",
    "providers": "ok"
  },
  "timestamp": 1703001645000
}
```

**HTTP Codes**:
- `200`: Ready to serve traffic
- `503`: Not ready (remove from load balancer)

**Kubernetes Config**:
```yaml
readinessProbe:
  httpGet:
    path: /health/ready
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 5
  failureThreshold: 2
```

### Detailed Health Check

**Endpoint**: `GET /health`

**Purpose**: Comprehensive health status with metrics

**Response**:
```json
{
  "status": "healthy",
  "uptime": 86400,
  "queries": {
    "total": 1000000,
    "successful": 999500,
    "failed": 500,
    "latencyP50": 12.5,
    "latencyP95": 45.2,
    "latencyP99": 89.7,
    "throughput": 11.57
  },
  "cache": {
    "size": 50000,
    "hits": 850000,
    "misses": 150000,
    "hitRate": 0.85,
    "evictions": 1200
  },
  "snapshot": {
    "currentCid": "QmXYZ...",
    "merkleRoot": "0x1234...",
    "districtCount": 51234,
    "ageSeconds": 86400,
    "nextCheckSeconds": 3600
  },
  "errors": {
    "last5m": 2,
    "last1h": 15,
    "last24h": 120,
    "recentErrors": [...]
  },
  "timestamp": 1703001645000
}
```

---

## Runbook Index

All runbooks located at: `https://docs.voter-protocol.org/shadow-atlas/runbooks/`

### Critical Runbooks

| Alert | Runbook | On-Call Action |
|-------|---------|----------------|
| `HighErrorRate` | [high-error-rate](https://docs.voter-protocol.org/shadow-atlas/runbooks/high-error-rate) | Check logs, restart if needed |
| `ServiceDown` | [service-down](https://docs.voter-protocol.org/shadow-atlas/runbooks/service-down) | Immediate restart, check infra |
| `HighP99Latency` | [high-latency](https://docs.voter-protocol.org/shadow-atlas/runbooks/high-latency) | Check DB, cache, providers |
| `ProviderDown` | [provider-down](https://docs.voter-protocol.org/shadow-atlas/runbooks/provider-down) | Verify external services |
| `SLOBudgetBurnRateFast` | [slo-budget-burn](https://docs.voter-protocol.org/shadow-atlas/runbooks/slo-budget-burn) | Investigate error spike |

### Warning Runbooks

| Alert | Runbook | Action |
|-------|---------|--------|
| `LatencyIncreasing` | [latency-warning](https://docs.voter-protocol.org/shadow-atlas/runbooks/latency-warning) | Monitor trends |
| `CacheHitRateWarning` | [cache-thrashing](https://docs.voter-protocol.org/shadow-atlas/runbooks/cache-thrashing) | Review cache config |
| `ExtractionFailureRateWarning` | [extraction-failures](https://docs.voter-protocol.org/shadow-atlas/runbooks/extraction-failures) | Check provider health |

---

## Integration Guide

### API Server Integration

```typescript
import { getTracer, SpanKind } from './observability/tracing';
import { createMetricsStore } from './observability/metrics';
import { createLogger } from './observability/metrics';

const tracer = getTracer();
const metrics = createMetricsStore('.shadow-atlas');
const log = createLogger('API', 'info');

// In request handler
async function handleRequest(req, res) {
  const startTime = performance.now();
  const context = tracer.startTrace('http_request', SpanKind.SERVER, {
    'http.method': req.method,
    'http.path': req.url,
  });

  log.info('Request started', {
    method: req.method,
    path: req.url,
    traceId: context.traceId
  });

  try {
    const result = await processRequest(req, context);
    const latencyMs = performance.now() - startTime;

    metrics.recordRequest(
      req.method!,
      req.url!,
      200,
      latencyMs,
      result.cacheHit
    );

    tracer.endSpan(context);
    log.info('Request complete', { latencyMs, traceId: context.traceId });

    res.writeHead(200).end(JSON.stringify(result));
  } catch (error) {
    const latencyMs = performance.now() - startTime;

    tracer.recordException(context, error as Error);
    tracer.endSpan(context);

    metrics.recordRequest(req.method!, req.url!, 500, latencyMs, false);
    log.error('Request failed', { error: (error as Error).message });

    res.writeHead(500).end();
  }
}
```

### Extraction Service Integration

```typescript
import { createMetricsStore, createLogger } from './observability/metrics';

const metrics = createMetricsStore('.shadow-atlas');
const log = createLogger('Extraction', 'info');

async function extractState(state: string, layer: string) {
  const startTime = Date.now();

  log.info('Starting extraction', { state, layer });

  try {
    const boundaries = await fetchBoundaries(state, layer);
    const duration = Date.now() - startTime;

    metrics.recordExtraction(state, layer, true, duration, boundaries.length);
    log.info('Extraction complete', { state, layer, count: boundaries.length });

    return boundaries;
  } catch (error) {
    const duration = Date.now() - startTime;

    metrics.recordExtraction(state, layer, false, duration);
    log.error('Extraction failed', { state, layer, error: (error as Error).message });

    throw error;
  }
}
```

### Health Check Integration

```typescript
import { createMetricsStore } from './observability/metrics';

const metrics = createMetricsStore('.shadow-atlas');

// Liveness
app.get('/health/live', (req, res) => {
  res.status(200).json({ status: 'up', timestamp: Date.now() });
});

// Readiness
app.get('/health/ready', async (req, res) => {
  const dbOk = await checkDatabase();
  const cacheOk = await checkCache();

  if (dbOk && cacheOk) {
    res.status(200).json({
      status: 'ready',
      checks: { database: 'ok', cache: 'ok' }
    });
  } else {
    res.status(503).json({
      status: 'not_ready',
      checks: { database: dbOk ? 'ok' : 'fail', cache: cacheOk ? 'ok' : 'fail' }
    });
  }
});

// Detailed health
app.get('/health', (req, res) => {
  const healthSummary = metrics.getHealthSummary(24);
  // ... (see Health Checks section)
});
```

---

## Appendix: Metric Collection Examples

### Prometheus Scrape Config

```yaml
scrape_configs:
  - job_name: 'shadow-atlas'
    scrape_interval: 15s
    static_configs:
      - targets: ['shadow-atlas:3000']
    metrics_path: /metrics
```

### Export to OTLP Collector

```typescript
import { getTracer } from './observability/tracing';

const tracer = getTracer();
const spans = tracer.getSpans();

// Export to OTLP
const otlpJson = tracer.exportOTLP();
await fetch('http://otel-collector:4318/v1/traces', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: otlpJson,
});
```

---

**Document End**

For questions or updates, contact: sre@voter-protocol.org
