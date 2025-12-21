/**
 * Shadow Atlas Observability - Public API
 *
 * Production-grade observability for 24/7 global operation.
 * Supports metrics, logging, tracing, and alerting.
 *
 * @example
 * ```typescript
 * import {
 *   createMetricsStore,
 *   createAlertManager,
 *   createLogger,
 *   getTracer,
 *   withSpan,
 *   SpanKind
 * } from './observability';
 *
 * // Metrics
 * const metrics = createMetricsStore();
 * metrics.recordRequest('GET', '/lookup', 200, 12.5, true);
 *
 * // Check health
 * const health = metrics.getHealthSummary(24);
 * console.log(`Healthy: ${health.healthy}`);
 *
 * // Alerts
 * const alerts = createAlertManager({ webhookUrl: process.env.SLACK_WEBHOOK });
 * await alerts.evaluate(health);
 *
 * // Logging
 * const log = createLogger('API', 'info');
 * log.info('Request started', { path: '/lookup', traceId: 'abc-123' });
 *
 * // Tracing
 * const tracer = getTracer();
 * const context = tracer.startTrace('http_request', SpanKind.SERVER);
 * await withSpan(tracer, context, 'district_lookup', async (ctx) => {
 *   return await lookupDistrict(lat, lon);
 * });
 * tracer.endSpan(context);
 * ```
 */

// Metrics
export {
  MetricsStore,
  createMetricsStore,
  type MetricType,
  type MetricEntry,
  type AggregatedMetric,
  type HealthSummary,
} from './metrics.js';

// Logging
export {
  StructuredLogger,
  createLogger,
  type LogLevel,
  type LogEntry,
} from './metrics.js';

// Alerting
export {
  AlertManager,
  HealthCheckRunner,
  ConsoleAlertChannel,
  FileAlertChannel,
  WebhookAlertChannel,
  createAlertManager,
  DEFAULT_ALERT_RULES,
  type Alert,
  type AlertRule,
  type AlertSeverity,
  type AlertStatus,
  type AlertChannel,
} from './alerts.js';

// Distributed Tracing
export {
  Tracer,
  getTracer,
  setTracer,
  withSpan,
  parseTraceContext,
  serializeTraceContext,
  SpanStatus,
  SpanKind,
  type TraceContext,
  type Span,
  type SpanAttributes,
  type SpanEvent,
} from './tracing.js';
