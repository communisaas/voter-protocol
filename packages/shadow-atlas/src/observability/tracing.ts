/**
 * Shadow Atlas Distributed Tracing
 *
 * OpenTelemetry integration for request tracing across services.
 * Tracks end-to-end latency, identifies bottlenecks, enables debugging.
 *
 * PRODUCTION PHILOSOPHY:
 * - Lightweight: No heavy APM agents, just structured span data
 * - Exportable: Works with Jaeger, Zipkin, or any OTLP-compatible backend
 * - Correlation: Every request gets a trace ID for cross-service debugging
 *
 * SLO TARGETS:
 * - P99 latency < 100ms (district lookup)
 * - P95 latency < 50ms (district lookup)
 * - Trace overhead < 1ms per request
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import { randomUUID } from 'crypto';

// ============================================================================
// Trace Types
// ============================================================================

/**
 * Trace context propagated across service boundaries
 */
export interface TraceContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly samplingDecision: boolean;
}

/**
 * Span status codes (aligned with OpenTelemetry)
 */
export enum SpanStatus {
  UNSET = 0,
  OK = 1,
  ERROR = 2,
}

/**
 * Span kind (aligned with OpenTelemetry)
 */
export enum SpanKind {
  INTERNAL = 0,
  SERVER = 1,
  CLIENT = 2,
  PRODUCER = 3,
  CONSUMER = 4,
}

/**
 * Span attributes (typed metadata)
 */
export interface SpanAttributes {
  readonly [key: string]: string | number | boolean | undefined;
}

/**
 * Span event (timestamped log within a span)
 */
export interface SpanEvent {
  readonly name: string;
  readonly timestamp: number;
  readonly attributes?: SpanAttributes;
}

/**
 * Completed span
 */
export interface Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind: SpanKind;
  readonly startTime: number;
  readonly endTime: number;
  readonly duration: number;
  readonly status: SpanStatus;
  readonly attributes: SpanAttributes;
  readonly events: readonly SpanEvent[];
}

/**
 * Active span (being recorded)
 */
interface ActiveSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind: SpanKind;
  readonly startTime: number;
  status: SpanStatus;
  attributes: Record<string, string | number | boolean>;
  events: SpanEvent[];
}

// ============================================================================
// Tracer
// ============================================================================

/**
 * Lightweight OpenTelemetry-compatible tracer
 *
 * Records spans in memory, exports to configured backends.
 * Thread-safe for concurrent requests (uses Map, not shared state).
 */
export class Tracer {
  private readonly serviceName: string;
  private readonly activeSpans = new Map<string, ActiveSpan>();
  private readonly completedSpans: Span[] = [];
  private readonly maxSpans: number;
  private readonly sampler: (traceId: string) => boolean;

  constructor(
    serviceName = 'shadow-atlas',
    maxSpans = 10000,
    samplingRate = 1.0
  ) {
    this.serviceName = serviceName;
    this.maxSpans = maxSpans;
    this.sampler = this.createSampler(samplingRate);
  }

  /**
   * Create sampling function
   */
  private createSampler(rate: number): (traceId: string) => boolean {
    if (rate >= 1.0) {
      return () => true; // Always sample
    }
    if (rate <= 0.0) {
      return () => false; // Never sample
    }

    // Deterministic sampling based on trace ID hash
    return (traceId: string) => {
      let hash = 0;
      for (let i = 0; i < traceId.length; i++) {
        hash = (hash << 5) - hash + traceId.charCodeAt(i);
        hash = hash & hash; // Convert to 32-bit integer
      }
      return Math.abs(hash % 100) < rate * 100;
    };
  }

  /**
   * Start a new trace (root span)
   */
  startTrace(
    name: string,
    kind: SpanKind = SpanKind.SERVER,
    attributes?: SpanAttributes
  ): TraceContext {
    const traceId = randomUUID();
    const spanId = randomUUID();
    const samplingDecision = this.sampler(traceId);

    if (!samplingDecision) {
      // Not sampling, return minimal context
      return { traceId, spanId, samplingDecision: false };
    }

    const span: ActiveSpan = {
      traceId,
      spanId,
      name,
      kind,
      startTime: performance.now(),
      status: SpanStatus.UNSET,
      attributes: {
        'service.name': this.serviceName,
        ...(attributes ?? {}),
      },
      events: [],
    };

    this.activeSpans.set(spanId, span);

    return { traceId, spanId, samplingDecision: true };
  }

  /**
   * Start a child span within existing trace
   */
  startSpan(
    context: TraceContext,
    name: string,
    kind: SpanKind = SpanKind.INTERNAL,
    attributes?: SpanAttributes
  ): TraceContext {
    if (!context.samplingDecision) {
      // Not sampling, return minimal context
      const spanId = randomUUID();
      return { ...context, spanId, parentSpanId: context.spanId, samplingDecision: false };
    }

    const spanId = randomUUID();
    const span: ActiveSpan = {
      traceId: context.traceId,
      spanId,
      parentSpanId: context.spanId,
      name,
      kind,
      startTime: performance.now(),
      status: SpanStatus.UNSET,
      attributes: {
        'service.name': this.serviceName,
        ...(attributes ?? {}),
      },
      events: [],
    };

    this.activeSpans.set(spanId, span);

    return { traceId: context.traceId, spanId, parentSpanId: context.spanId, samplingDecision: true };
  }

  /**
   * Add attribute to active span
   */
  setAttribute(context: TraceContext, key: string, value: string | number | boolean): void {
    if (!context.samplingDecision) return;

    const span = this.activeSpans.get(context.spanId);
    if (span) {
      span.attributes[key] = value;
    }
  }

  /**
   * Add event to active span
   */
  addEvent(context: TraceContext, name: string, attributes?: SpanAttributes): void {
    if (!context.samplingDecision) return;

    const span = this.activeSpans.get(context.spanId);
    if (span) {
      span.events.push({
        name,
        timestamp: performance.now(),
        attributes,
      });
    }
  }

  /**
   * Record exception in span
   */
  recordException(context: TraceContext, error: Error): void {
    if (!context.samplingDecision) return;

    const span = this.activeSpans.get(context.spanId);
    if (span) {
      span.status = SpanStatus.ERROR;
      span.attributes['error.type'] = error.name;
      span.attributes['error.message'] = error.message;
      if (error.stack) {
        span.attributes['error.stack'] = error.stack.substring(0, 500); // Truncate for storage
      }
    }
  }

  /**
   * End a span
   */
  endSpan(context: TraceContext, status: SpanStatus = SpanStatus.OK): void {
    if (!context.samplingDecision) return;

    const activeSpan = this.activeSpans.get(context.spanId);
    if (!activeSpan) return;

    const endTime = performance.now();
    const duration = endTime - activeSpan.startTime;

    const completedSpan: Span = {
      traceId: activeSpan.traceId,
      spanId: activeSpan.spanId,
      parentSpanId: activeSpan.parentSpanId,
      name: activeSpan.name,
      kind: activeSpan.kind,
      startTime: activeSpan.startTime,
      endTime,
      duration,
      status: activeSpan.status !== SpanStatus.UNSET ? activeSpan.status : status,
      attributes: activeSpan.attributes,
      events: activeSpan.events,
    };

    this.completedSpans.push(completedSpan);
    this.activeSpans.delete(context.spanId);

    // Prevent unbounded memory growth
    if (this.completedSpans.length > this.maxSpans) {
      this.completedSpans.shift(); // Remove oldest
    }
  }

  /**
   * Get completed spans (for export)
   */
  getSpans(traceId?: string): readonly Span[] {
    if (traceId) {
      return this.completedSpans.filter(span => span.traceId === traceId);
    }
    return this.completedSpans;
  }

  /**
   * Export spans to OpenTelemetry JSON format
   */
  exportOTLP(): string {
    const resourceSpans = {
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: this.serviceName } },
        ],
      },
      scopeSpans: [
        {
          scope: { name: 'shadow-atlas-tracer', version: '1.0.0' },
          spans: this.completedSpans.map(span => ({
            traceId: span.traceId,
            spanId: span.spanId,
            parentSpanId: span.parentSpanId,
            name: span.name,
            kind: span.kind,
            startTimeUnixNano: Math.floor(span.startTime * 1e6),
            endTimeUnixNano: Math.floor(span.endTime * 1e6),
            status: { code: span.status },
            attributes: Object.entries(span.attributes).map(([key, value]) => ({
              key,
              value: this.serializeAttribute(value),
            })),
            events: span.events.map(event => ({
              name: event.name,
              timeUnixNano: Math.floor(event.timestamp * 1e6),
              attributes: event.attributes
                ? Object.entries(event.attributes).map(([key, value]) => ({
                    key,
                    value: this.serializeAttribute(value),
                  }))
                : [],
            })),
          })),
        },
      ],
    };

    return JSON.stringify(resourceSpans, null, 2);
  }

  /**
   * Serialize attribute value to OTLP format
   */
  private serializeAttribute(value: string | number | boolean | undefined): object {
    if (typeof value === 'string') {
      return { stringValue: value };
    } else if (typeof value === 'number') {
      return Number.isInteger(value) ? { intValue: value } : { doubleValue: value };
    } else if (typeof value === 'boolean') {
      return { boolValue: value };
    }
    return { stringValue: '' };
  }

  /**
   * Clear all spans (for testing)
   */
  clear(): void {
    this.activeSpans.clear();
    this.completedSpans.length = 0;
  }

  /**
   * Get trace statistics
   */
  getStats(): {
    activeSpans: number;
    completedSpans: number;
    avgDuration: number;
    errorRate: number;
  } {
    const errorCount = this.completedSpans.filter(s => s.status === SpanStatus.ERROR).length;
    const totalDuration = this.completedSpans.reduce((sum, s) => sum + s.duration, 0);

    return {
      activeSpans: this.activeSpans.size,
      completedSpans: this.completedSpans.length,
      avgDuration: this.completedSpans.length > 0 ? totalDuration / this.completedSpans.length : 0,
      errorRate: this.completedSpans.length > 0 ? errorCount / this.completedSpans.length : 0,
    };
  }
}

// ============================================================================
// Trace Utilities
// ============================================================================

/**
 * Execute function with automatic span tracking
 */
export async function withSpan<T>(
  tracer: Tracer,
  context: TraceContext,
  name: string,
  fn: (ctx: TraceContext) => Promise<T>,
  kind: SpanKind = SpanKind.INTERNAL,
  attributes?: SpanAttributes
): Promise<T> {
  const spanContext = tracer.startSpan(context, name, kind, attributes);

  try {
    const result = await fn(spanContext);
    tracer.endSpan(spanContext, SpanStatus.OK);
    return result;
  } catch (error) {
    if (error instanceof Error) {
      tracer.recordException(spanContext, error);
    }
    tracer.endSpan(spanContext, SpanStatus.ERROR);
    throw error;
  }
}

/**
 * Parse W3C trace context from HTTP headers
 *
 * Format: traceparent: 00-{traceId}-{spanId}-{flags}
 */
export function parseTraceContext(traceparent?: string): TraceContext | null {
  if (!traceparent) return null;

  const parts = traceparent.split('-');
  if (parts.length !== 4 || parts[0] !== '00') {
    return null; // Invalid format
  }

  const [, traceId, spanId, flags] = parts;
  const samplingDecision = parseInt(flags, 16) & 1 ? true : false;

  return { traceId, spanId, samplingDecision };
}

/**
 * Serialize trace context to W3C traceparent header
 */
export function serializeTraceContext(context: TraceContext): string {
  const flags = context.samplingDecision ? '01' : '00';
  return `00-${context.traceId}-${context.spanId}-${flags}`;
}

// ============================================================================
// Global Tracer Instance
// ============================================================================

let globalTracer: Tracer | null = null;

/**
 * Get or create global tracer instance
 */
export function getTracer(): Tracer {
  if (!globalTracer) {
    globalTracer = new Tracer('shadow-atlas', 10000, 1.0);
  }
  return globalTracer;
}

/**
 * Set custom global tracer
 */
export function setTracer(tracer: Tracer): void {
  globalTracer = tracer;
}
