/**
 * Resilience Pattern Types
 *
 * Type-safe resilience patterns for production Shadow Atlas deployment.
 * Battle-tested patterns from distributed systems research.
 *
 * DESIGN PRINCIPLES:
 * - Fail gracefully under any single failure
 * - Full recovery within 5 minutes
 * - Observable degradation states
 * - Zero data loss under network partitions
 */

/**
 * Circuit breaker states (finite state machine)
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker statistics
 */
export interface CircuitBreakerStats {
  readonly state: CircuitState;
  readonly failureCount: number;
  readonly successCount: number;
  readonly lastFailureTime: number | null;
  readonly lastStateChange: number;
  readonly consecutiveFailures: number;
  readonly consecutiveSuccesses: number;
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  readonly name: string;
  readonly failureThreshold: number; // Open after N consecutive failures
  readonly successThreshold: number; // Close after N consecutive successes in half-open
  readonly openDurationMs: number; // How long to stay open before trying half-open
  readonly halfOpenMaxCalls: number; // Max concurrent calls in half-open state
  readonly monitoringWindowMs: number; // Window for failure rate calculation
  readonly volumeThreshold: number; // Minimum calls before circuit can open
}

/**
 * Retry configuration with exponential backoff
 */
export interface RetryConfig {
  readonly maxAttempts: number;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly backoffMultiplier: number;
  readonly jitterFactor: number; // 0-1, randomness to prevent thundering herd
  readonly retryableErrors: readonly RetryableErrorType[];
  readonly timeoutMs?: number;
}

/**
 * Error types that are safe to retry
 */
export type RetryableErrorType =
  | 'network_timeout'
  | 'network_error'
  | 'rate_limit'
  | 'service_unavailable'
  | 'gateway_timeout'
  | 'temporary_failure';

/**
 * Retry attempt metadata
 */
export interface RetryAttempt {
  readonly attemptNumber: number;
  readonly delayMs: number;
  readonly totalElapsedMs: number;
  readonly error: Error;
  readonly retryable: boolean;
}

/**
 * Bulkhead configuration (isolate failures)
 */
export interface BulkheadConfig {
  readonly name: string;
  readonly maxConcurrent: number; // Max concurrent executions
  readonly maxQueueSize: number; // Max queued requests
  readonly queueTimeoutMs: number; // Max time request can wait in queue
}

/**
 * Bulkhead statistics
 */
export interface BulkheadStats {
  readonly name: string;
  readonly activeCount: number;
  readonly queuedCount: number;
  readonly rejectedCount: number;
  readonly completedCount: number;
  readonly avgExecutionMs: number;
}

/**
 * Fallback strategy configuration
 */
export interface FallbackConfig<T> {
  readonly strategy: FallbackStrategy;
  readonly staticValue?: T;
  readonly staleDataMaxAgeMs?: number;
  readonly degradedMode?: boolean;
}

/**
 * Fallback strategies
 */
export type FallbackStrategy =
  | 'static_response' // Return pre-configured static value
  | 'stale_cache' // Serve stale cached data
  | 'degraded_service' // Partial functionality
  | 'fail_open'; // Allow through without validation

/**
 * Rate limiter configuration (token bucket algorithm)
 */
export interface RateLimiterConfig {
  readonly maxTokens: number; // Bucket capacity
  readonly refillRate: number; // Tokens per second
  readonly refillIntervalMs: number; // How often to refill
  readonly burstSize?: number; // Allow bursts up to this size
}

/**
 * Rate limiter statistics
 */
export interface RateLimiterStats {
  readonly currentTokens: number;
  readonly maxTokens: number;
  readonly refillRate: number;
  readonly requestsAllowed: number;
  readonly requestsRejected: number;
  readonly lastRefillTime: number;
}

/**
 * Degradation level (observable health state)
 */
export type DegradationLevel =
  | 'healthy' // All systems operational
  | 'degraded_minor' // Non-critical failures, >80% capacity
  | 'degraded_major' // Critical path affected, >50% capacity
  | 'critical'; // Multiple failures, <50% capacity

/**
 * System health state
 */
export interface HealthState {
  readonly level: DegradationLevel;
  readonly upstreamHealth: Record<string, UpstreamHealthStatus>;
  readonly activeCircuitBreakers: readonly string[];
  readonly rateLimitedClients: number;
  readonly timestamp: number;
}

/**
 * Upstream service health
 */
export interface UpstreamHealthStatus {
  readonly name: string;
  readonly available: boolean;
  readonly latencyMs: number | null;
  readonly errorRate: number; // 0-1
  readonly lastCheckTime: number;
  readonly circuitState: CircuitState;
}

/**
 * Timeout configuration
 */
export interface TimeoutConfig {
  readonly operationTimeoutMs: number; // Max time for operation
  readonly connectTimeoutMs: number; // Max time to establish connection
  readonly readTimeoutMs: number; // Max time to read response
}

/**
 * Chaos engineering fault injection
 */
export interface ChaosFault {
  readonly type: ChaosFaultType;
  readonly probability: number; // 0-1
  readonly enabled: boolean;
  readonly config: ChaosFaultConfig;
}

export type ChaosFaultType =
  | 'network_delay'
  | 'network_failure'
  | 'upstream_error'
  | 'data_corruption'
  | 'timeout'
  | 'resource_exhaustion';

export interface ChaosFaultConfig {
  readonly delayMs?: number;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly failureRate?: number; // 0-1
}

/**
 * Resilience metrics for observability
 */
export interface ResilienceMetrics {
  readonly circuitBreakers: readonly CircuitBreakerStats[];
  readonly bulkheads: readonly BulkheadStats[];
  readonly rateLimiters: readonly RateLimiterStats[];
  readonly retryStats: RetryStatistics;
  readonly timestamp: number;
}

export interface RetryStatistics {
  readonly totalRetries: number;
  readonly successfulRetries: number;
  readonly failedRetries: number;
  readonly avgAttemptsUntilSuccess: number;
}

/**
 * Resilience event for monitoring
 */
export interface ResilienceEvent {
  readonly type: ResilienceEventType;
  readonly component: string;
  readonly timestamp: number;
  readonly metadata: Record<string, unknown>;
}

export type ResilienceEventType =
  | 'circuit_opened'
  | 'circuit_closed'
  | 'circuit_half_open'
  | 'retry_exhausted'
  | 'bulkhead_rejected'
  | 'rate_limit_exceeded'
  | 'fallback_activated'
  | 'upstream_recovered'
  | 'upstream_failed';
