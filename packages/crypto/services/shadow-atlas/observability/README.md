# Shadow Atlas Observability

Production-grade observability infrastructure for 24/7 global district verification service.

## Overview

Shadow Atlas observability targets **99.9% availability** and **p99 latency < 100ms** through comprehensive metrics, distributed tracing, structured logging, and proactive alerting.

**Architecture**: Lightweight, zero external dependencies for pre-launch, Prometheus/OpenTelemetry-compatible for production scale.

## Quick Start

```typescript
import {
  createMetricsStore,
  createLogger,
  getTracer,
  withSpan,
  SpanKind
} from './observability';

// Initialize
const metrics = createMetricsStore('.shadow-atlas');
const log = createLogger('MyService', 'info');
const tracer = getTracer();

// Log with context
log.info('Processing request', { userId: '123', action: 'lookup' });

// Record metrics
metrics.recordRequest('GET', '/lookup', 200, 12.5, true);

// Trace operations
const context = tracer.startTrace('http_request', SpanKind.SERVER);
await withSpan(tracer, context, 'business_logic', async (ctx) => {
  // Your code here
  tracer.setAttribute(ctx, 'custom.field', 'value');
});
tracer.endSpan(context);
```

## Components

### Metrics (`metrics.ts`)

SQLite-backed metrics store with Prometheus export.

**Capabilities**:
- Counter, Gauge, Histogram metric types
- Label-based dimensional data
- Automatic aggregation (min, max, avg, percentiles)
- 30-day retention with daily summaries
- Prometheus `/metrics` endpoint

**Key Methods**:
- `recordRequest()` - HTTP request metrics
- `recordExtraction()` - Boundary extraction tracking
- `recordProofGeneration()` - ZK/Merkle proof latency
- `getHealthSummary()` - Overall system health

### Structured Logging (`metrics.ts`)

JSON-formatted logs to stdout for aggregation.

**Features**:
- Log levels: debug, info, warn, error
- Contextual metadata (traceId, component, etc.)
- Child loggers with inherited context
- Zero external dependencies

### Distributed Tracing (`tracing.ts`)

OpenTelemetry-compatible request path tracing.

**Features**:
- W3C Trace Context propagation
- Parent-child span relationships
- Span events and attributes
- OTLP JSON export
- Configurable sampling (default: 100%)

**Span Kinds**: SERVER, CLIENT, INTERNAL, PRODUCER, CONSUMER

### Alerting (`alerts.ts`)

Rule-based alerting with multiple channels.

**Channels**:
- Console (stdout JSON)
- File (persistent log)
- Webhook (Slack, Discord, custom)

**Alert Lifecycle**: Firing → Resolved → Acknowledged

### Health Checks (`health.ts`)

Kubernetes-compatible health endpoints.

**Endpoints**:
- `/health/live` - Liveness probe (process alive?)
- `/health/ready` - Readiness probe (ready for traffic?)
- `/health` - Detailed metrics and status

## Dashboards

Pre-built Grafana dashboards in `dashboards/`:

1. **overview.json** - System-wide metrics (requests, latency, errors, health)
2. **performance.json** - Deep performance analysis (heatmaps, percentiles, SLO compliance)
3. **errors.json** - Error tracking, debugging, root cause analysis

**Import**: Upload JSON files to Grafana or deploy via ConfigMap.

## Alerting Rules

Production alert rules in `alerts/`:

1. **critical.yaml** - Page-worthy incidents (SLO violations, outages)
2. **warning.yaml** - Early warnings (approaching thresholds)

**Prometheus AlertManager Config**:
```yaml
rule_files:
  - /etc/prometheus/alerts/critical.yaml
  - /etc/prometheus/alerts/warning.yaml

alerting:
  alertmanagers:
    - static_configs:
      - targets: ['alertmanager:9093']
```

## SLO Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| Availability | 99.9% | Error rate < 0.1% |
| Latency (p99) | < 100ms | District lookups |
| Latency (p95) | < 50ms | District lookups |
| Extraction Success | > 90% | Boundary extractions |

**Error Budget**: 43.2 minutes/month downtime

## Usage Examples

### API Server Integration

```typescript
import { getTracer, createMetricsStore, createLogger, SpanKind } from './observability';

const tracer = getTracer();
const metrics = createMetricsStore();
const log = createLogger('API', 'info');

app.get('/lookup', async (req, res) => {
  const startTime = performance.now();
  const context = tracer.startTrace('http_request', SpanKind.SERVER, {
    'http.method': 'GET',
    'http.path': '/lookup',
  });

  try {
    const result = await lookupDistrict(req.query.lat, req.query.lon, context);
    const latencyMs = performance.now() - startTime;

    metrics.recordRequest('GET', '/lookup', 200, latencyMs, result.cacheHit);
    tracer.endSpan(context);

    res.json(result);
  } catch (error) {
    tracer.recordException(context, error);
    tracer.endSpan(context);

    metrics.recordRequest('GET', '/lookup', 500, performance.now() - startTime, false);
    log.error('Lookup failed', { error: error.message });

    res.status(500).json({ error: 'Internal error' });
  }
});
```

### Extraction Service Integration

```typescript
import { createMetricsStore, createLogger } from './observability';

const metrics = createMetricsStore();
const log = createLogger('Extraction', 'info');

async function extractState(state: string) {
  const startTime = Date.now();
  log.info('Starting extraction', { state });

  try {
    const boundaries = await fetchBoundaries(state);
    const duration = Date.now() - startTime;

    metrics.recordExtraction(state, 'congressional', true, duration, boundaries.length);
    log.info('Extraction complete', { state, count: boundaries.length, duration });

    return boundaries;
  } catch (error) {
    metrics.recordExtraction(state, 'congressional', false, Date.now() - startTime);
    log.error('Extraction failed', { state, error: error.message });
    throw error;
  }
}
```

### Health Check Setup

```typescript
import { createMetricsStore } from './observability';

const metrics = createMetricsStore();

// Liveness (Kubernetes)
app.get('/health/live', (req, res) => {
  res.status(200).json({ status: 'up' });
});

// Readiness (Kubernetes)
app.get('/health/ready', async (req, res) => {
  const dbOk = await checkDatabase();
  const cacheOk = await checkCache();

  if (dbOk && cacheOk) {
    res.status(200).json({ status: 'ready' });
  } else {
    res.status(503).json({ status: 'not_ready' });
  }
});

// Detailed health
app.get('/health', (req, res) => {
  const health = metrics.getHealthSummary(24);
  res.json(health);
});

// Prometheus metrics
app.get('/metrics', (req, res) => {
  // Export metrics in Prometheus format
  const prometheusMetrics = exportPrometheusMetrics(metrics);
  res.set('Content-Type', 'text/plain; version=0.0.4');
  res.send(prometheusMetrics);
});
```

## Deployment

### Docker

```dockerfile
FROM node:20-alpine

WORKDIR /app
COPY . .

# Install dependencies
RUN npm install

# Expose metrics port
EXPOSE 3000

# Health checks
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q --spider http://localhost:3000/health/live || exit 1

CMD ["npm", "start"]
```

### Kubernetes

```yaml
apiVersion: v1
kind: Service
metadata:
  name: shadow-atlas
  labels:
    app: shadow-atlas
  annotations:
    prometheus.io/scrape: "true"
    prometheus.io/port: "3000"
    prometheus.io/path: "/metrics"
spec:
  selector:
    app: shadow-atlas
  ports:
    - port: 3000
      targetPort: 3000

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: shadow-atlas
spec:
  replicas: 3
  selector:
    matchLabels:
      app: shadow-atlas
  template:
    metadata:
      labels:
        app: shadow-atlas
    spec:
      containers:
      - name: shadow-atlas
        image: shadow-atlas:latest
        ports:
        - containerPort: 3000
        env:
        - name: TRACING_SAMPLE_RATE
          value: "0.1"
        - name: LOG_LEVEL
          value: "info"
        livenessProbe:
          httpGet:
            path: /health/live
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Minimum log level (debug, info, warn, error) |
| `TRACING_SAMPLE_RATE` | `1.0` | Trace sampling rate (0.0-1.0) |
| `METRICS_RETENTION_DAYS` | `30` | Metric retention period |
| `SLACK_WEBHOOK_URL` | - | Slack webhook for alerts |
| `ALERT_FILE_PATH` | `/data/alerts.log` | Alert log file path |

### Runtime Configuration

```typescript
import { createMetricsStore, createAlertManager, setTracer, Tracer } from './observability';

// Custom metrics store
const metrics = createMetricsStore('.shadow-atlas', 30); // 30 days retention

// Alert manager with webhook
const alerts = createAlertManager({
  webhookUrl: process.env.SLACK_WEBHOOK_URL,
  alertFilePath: '/data/alerts.log'
});

// Custom tracer
const tracer = new Tracer('shadow-atlas', 10000, 0.1); // 10% sampling
setTracer(tracer);
```

## Documentation

- **[OBSERVABILITY_SPEC.md](./OBSERVABILITY_SPEC.md)** - Complete specification with metrics catalog, SLOs, runbooks
- **Dashboards** - Pre-built Grafana dashboards in `dashboards/`
- **Alerts** - Production alerting rules in `alerts/`

## Architecture Decisions

### Why SQLite for Metrics?

**Pre-launch philosophy**: Zero external dependencies until proven necessary.

- ✅ No Prometheus/Grafana infrastructure required
- ✅ Queryable local storage for debugging
- ✅ 30-day retention with automatic cleanup
- ✅ Export to Prometheus when ready to scale

**Migration path**: SQLite → Prometheus → Thanos (long-term storage)

### Why Custom Tracer vs OpenTelemetry SDK?

**Size & complexity tradeoff**:

- OpenTelemetry SDK: ~500KB, complex setup
- Custom tracer: ~5KB, zero dependencies
- 100% compatible export format (OTLP JSON)

**Migration path**: Custom tracer works alongside OpenTelemetry collector; can swap implementation without changing code.

### Why JSON Logs vs Pino/Winston?

**Simplicity**:

- Zero dependencies
- Pipe to any log aggregator (Loki, Elasticsearch, CloudWatch)
- 100% structured, no parsing needed

## Contributing

When adding new metrics:

1. **Update `MetricType`** in `metrics.ts`
2. **Add recording method** if needed (e.g., `recordNewOperation()`)
3. **Update OBSERVABILITY_SPEC.md** metrics catalog
4. **Add dashboard panels** if metric needs visualization
5. **Create alerts** if metric has SLO implications

## License

MIT - Part of VOTER Protocol
