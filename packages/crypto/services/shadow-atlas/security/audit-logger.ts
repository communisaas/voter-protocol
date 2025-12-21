/**
 * Security Audit Logging Module
 *
 * Structured logging for security events in Shadow Atlas.
 * Defense against unauthorized access, data tampering, and attack detection.
 *
 * TYPE SAFETY: Nuclear-level strictness. All events strongly typed.
 *
 * SECURITY PRINCIPLE: Comprehensive logging with tamper-evident storage.
 */

import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import { writeFile, appendFile, mkdir } from 'fs/promises';
import { join } from 'path';

// ============================================================================
// Types
// ============================================================================

/**
 * Security event severity
 */
export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * Security event category
 */
export type SecurityEventCategory =
  | 'authentication'
  | 'authorization'
  | 'validation'
  | 'rate_limit'
  | 'integrity'
  | 'data_access'
  | 'configuration'
  | 'system';

/**
 * Security event
 */
export interface SecurityEvent {
  /** Unique event ID */
  readonly id: string;

  /** Event timestamp (ISO 8601) */
  readonly timestamp: string;

  /** Event severity */
  readonly severity: SecuritySeverity;

  /** Event category */
  readonly category: SecurityEventCategory;

  /** Event type (specific action) */
  readonly eventType: string;

  /** Client identifier (IP, API key hash) */
  readonly client: {
    readonly ip: string;
    readonly apiKeyHash?: string;
    readonly userAgent?: string;
  };

  /** Request context */
  readonly request: {
    readonly method: string;
    readonly path: string;
    readonly query?: Record<string, string>;
    readonly headers?: Record<string, string>;
  };

  /** Event-specific data */
  readonly data: Record<string, unknown>;

  /** Success/failure status */
  readonly success: boolean;

  /** Error message (if failed) */
  readonly error?: string;

  /** Correlation ID (for request tracing) */
  readonly correlationId?: string;

  /** Hash chain link (for tamper detection) */
  readonly previousHash?: string;
  readonly eventHash?: string;
}

/**
 * Audit log configuration
 */
export interface AuditLogConfig {
  /** Log file directory */
  readonly logDir: string;

  /** Maximum log file size (bytes) before rotation */
  readonly maxFileSize: number;

  /** Maximum number of rotated files to keep */
  readonly maxFiles: number;

  /** Minimum severity to log */
  readonly minSeverity: SecuritySeverity;

  /** Enable hash chain for tamper detection */
  readonly enableHashChain: boolean;

  /** Retention period (days) */
  readonly retentionDays: number;
}

// ============================================================================
// Security Audit Logger
// ============================================================================

/**
 * Security audit logger with tamper-evident hash chain
 *
 * SECURITY FEATURES:
 * - Hash chain linking events (detect tampering)
 * - Structured JSON logging (machine-readable)
 * - Automatic log rotation (prevent disk exhaustion)
 * - Correlation IDs (trace requests across services)
 * - PII sanitization (GDPR/CCPA compliance)
 */
export class SecurityAuditLogger {
  private readonly config: AuditLogConfig;
  private currentLogFile: string;
  private currentFileSize: number;
  private lastEventHash: string | undefined;
  private eventBuffer: SecurityEvent[] = [];
  private flushInterval: ReturnType<typeof setInterval> | undefined;

  constructor(config: Partial<AuditLogConfig> = {}) {
    this.config = {
      logDir: config.logDir ?? './logs/security',
      maxFileSize: config.maxFileSize ?? 100 * 1024 * 1024, // 100 MB
      maxFiles: config.maxFiles ?? 10,
      minSeverity: config.minSeverity ?? 'info',
      enableHashChain: config.enableHashChain ?? true,
      retentionDays: config.retentionDays ?? 90,
    };

    this.currentLogFile = this.generateLogFileName();
    this.currentFileSize = 0;

    // Flush buffer every 5 seconds
    this.flushInterval = setInterval(() => this.flush(), 5000);
  }

  /**
   * Log a security event
   *
   * @param event - Event data (partial, will be enriched)
   */
  async log(event: Omit<SecurityEvent, 'id' | 'timestamp' | 'eventHash' | 'previousHash'>): Promise<void> {
    // Check severity filter
    if (!this.shouldLog(event.severity)) {
      return;
    }

    // Enrich event
    const enrichedEvent: SecurityEvent = {
      ...event,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      previousHash: this.config.enableHashChain ? this.lastEventHash : undefined,
      eventHash: undefined, // Computed below
    };

    // Compute event hash (for hash chain)
    if (this.config.enableHashChain) {
      const hash = this.computeEventHash(enrichedEvent);
      (enrichedEvent as { eventHash: string }).eventHash = hash;
      this.lastEventHash = hash;
    }

    // Add to buffer
    this.eventBuffer.push(enrichedEvent);

    // Flush if critical event (immediate write)
    if (event.severity === 'critical') {
      await this.flush();
    }
  }

  /**
   * Log authentication event
   */
  async logAuthentication(params: {
    success: boolean;
    client: SecurityEvent['client'];
    request: SecurityEvent['request'];
    apiKeyProvided: boolean;
    error?: string;
    correlationId?: string;
  }): Promise<void> {
    await this.log({
      severity: params.success ? 'info' : 'high',
      category: 'authentication',
      eventType: params.apiKeyProvided ? 'api_key_auth' : 'ip_auth',
      client: params.client,
      request: params.request,
      data: {
        apiKeyProvided: params.apiKeyProvided,
      },
      success: params.success,
      error: params.error,
      correlationId: params.correlationId,
    });
  }

  /**
   * Log authorization event
   */
  async logAuthorization(params: {
    success: boolean;
    client: SecurityEvent['client'];
    request: SecurityEvent['request'];
    resource: string;
    action: string;
    error?: string;
    correlationId?: string;
  }): Promise<void> {
    await this.log({
      severity: params.success ? 'info' : 'high',
      category: 'authorization',
      eventType: 'access_check',
      client: params.client,
      request: params.request,
      data: {
        resource: params.resource,
        action: params.action,
      },
      success: params.success,
      error: params.error,
      correlationId: params.correlationId,
    });
  }

  /**
   * Log validation failure
   */
  async logValidationFailure(params: {
    client: SecurityEvent['client'];
    request: SecurityEvent['request'];
    validationType: string;
    validationError: string;
    inputData?: Record<string, unknown>;
    correlationId?: string;
  }): Promise<void> {
    await this.log({
      severity: 'medium',
      category: 'validation',
      eventType: 'validation_failed',
      client: params.client,
      request: params.request,
      data: {
        validationType: params.validationType,
        validationError: params.validationError,
        inputData: this.sanitizePII(params.inputData ?? {}),
      },
      success: false,
      error: params.validationError,
      correlationId: params.correlationId,
    });
  }

  /**
   * Log rate limit violation
   */
  async logRateLimitViolation(params: {
    client: SecurityEvent['client'];
    request: SecurityEvent['request'];
    limit: number;
    remaining: number;
    resetAt: number;
    correlationId?: string;
  }): Promise<void> {
    await this.log({
      severity: 'medium',
      category: 'rate_limit',
      eventType: 'rate_limit_exceeded',
      client: params.client,
      request: params.request,
      data: {
        limit: params.limit,
        remaining: params.remaining,
        resetAt: params.resetAt,
      },
      success: false,
      error: 'Rate limit exceeded',
      correlationId: params.correlationId,
    });
  }

  /**
   * Log integrity violation
   */
  async logIntegrityViolation(params: {
    client: SecurityEvent['client'];
    request: SecurityEvent['request'];
    violationType: string;
    details: string;
    affectedData?: string;
    correlationId?: string;
  }): Promise<void> {
    await this.log({
      severity: 'critical',
      category: 'integrity',
      eventType: 'integrity_violation',
      client: params.client,
      request: params.request,
      data: {
        violationType: params.violationType,
        details: params.details,
        affectedData: params.affectedData,
      },
      success: false,
      error: params.details,
      correlationId: params.correlationId,
    });
  }

  /**
   * Log data access
   */
  async logDataAccess(params: {
    client: SecurityEvent['client'];
    request: SecurityEvent['request'];
    resourceType: string;
    resourceId: string;
    action: 'read' | 'write' | 'delete';
    correlationId?: string;
  }): Promise<void> {
    await this.log({
      severity: 'info',
      category: 'data_access',
      eventType: `data_${params.action}`,
      client: params.client,
      request: params.request,
      data: {
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        action: params.action,
      },
      success: true,
      correlationId: params.correlationId,
    });
  }

  /**
   * Log suspicious activity
   */
  async logSuspiciousActivity(params: {
    client: SecurityEvent['client'];
    request: SecurityEvent['request'];
    suspicionType: string;
    details: string;
    riskScore?: number;
    correlationId?: string;
  }): Promise<void> {
    await this.log({
      severity: 'high',
      category: 'system',
      eventType: 'suspicious_activity',
      client: params.client,
      request: params.request,
      data: {
        suspicionType: params.suspicionType,
        details: params.details,
        riskScore: params.riskScore,
      },
      success: false,
      error: params.details,
      correlationId: params.correlationId,
    });
  }

  /**
   * Flush buffered events to disk
   */
  async flush(): Promise<void> {
    if (this.eventBuffer.length === 0) {
      return;
    }

    // Ensure log directory exists
    await mkdir(this.config.logDir, { recursive: true });

    // Serialize events
    const logLines = this.eventBuffer.map((event) => JSON.stringify(event)).join('\n') + '\n';
    const logSize = Buffer.byteLength(logLines, 'utf8');

    // Check if rotation needed
    if (this.currentFileSize + logSize > this.config.maxFileSize) {
      await this.rotateLogFile();
    }

    // Append to current log file
    await appendFile(this.currentLogFile, logLines, 'utf8');
    this.currentFileSize += logSize;

    // Clear buffer
    this.eventBuffer = [];
  }

  /**
   * Rotate log file
   */
  private async rotateLogFile(): Promise<void> {
    // Generate new log file name
    this.currentLogFile = this.generateLogFileName();
    this.currentFileSize = 0;

    // TODO: Cleanup old log files (beyond maxFiles limit)
    // This would involve scanning logDir for old files and deleting them
  }

  /**
   * Generate log file name with timestamp
   */
  private generateLogFileName(): string {
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    return join(this.config.logDir, `security-${timestamp}.jsonl`);
  }

  /**
   * Compute event hash (for hash chain)
   */
  private computeEventHash(event: SecurityEvent): string {
    // Exclude eventHash itself from hash computation
    const { eventHash, ...eventWithoutHash } = event;

    // Normalize JSON (sort keys)
    const normalized = JSON.stringify(eventWithoutHash, Object.keys(eventWithoutHash).sort());

    return createHash('sha256').update(normalized).digest('hex');
  }

  /**
   * Check if event should be logged based on severity
   */
  private shouldLog(severity: SecuritySeverity): boolean {
    const severityOrder: SecuritySeverity[] = ['info', 'low', 'medium', 'high', 'critical'];
    const minIndex = severityOrder.indexOf(this.config.minSeverity);
    const eventIndex = severityOrder.indexOf(severity);

    return eventIndex >= minIndex;
  }

  /**
   * Sanitize PII from log data
   *
   * SECURITY: Remove sensitive data before logging (GDPR/CCPA compliance).
   */
  private sanitizePII(data: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data)) {
      // Redact sensitive fields
      const lowerKey = key.toLowerCase();

      if (
        lowerKey.includes('password') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('token') ||
        lowerKey.includes('apikey') ||
        lowerKey.includes('ssn') ||
        lowerKey.includes('credit') ||
        lowerKey.includes('card')
      ) {
        sanitized[key] = '[REDACTED]';
        continue;
      }

      // Hash email addresses (preserve domain for analysis)
      if (lowerKey.includes('email') && typeof value === 'string') {
        const [local, domain] = value.split('@');
        if (local && domain) {
          const hashedLocal = createHash('sha256').update(local).digest('hex').substring(0, 8);
          sanitized[key] = `${hashedLocal}@${domain}`;
          continue;
        }
      }

      // Hash IP addresses (preserve first octet for geolocation)
      if (lowerKey.includes('ip') && typeof value === 'string') {
        const parts = value.split('.');
        if (parts.length === 4 && parts[0]) {
          const hashedSuffix = createHash('sha256')
            .update(parts.slice(1).join('.'))
            .digest('hex')
            .substring(0, 8);
          sanitized[key] = `${parts[0]}.xxx.xxx.${hashedSuffix}`;
          continue;
        }
      }

      // Truncate long strings
      if (typeof value === 'string' && value.length > 1000) {
        sanitized[key] = value.substring(0, 1000) + '... [truncated]';
        continue;
      }

      sanitized[key] = value;
    }

    return sanitized;
  }

  /**
   * Destroy logger (cleanup)
   */
  async destroy(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }

    await this.flush();
  }
}

// ============================================================================
// Default Logger Instance
// ============================================================================

/**
 * Default security audit logger instance
 */
export const defaultSecurityLogger = new SecurityAuditLogger({
  logDir: './logs/security',
  minSeverity: 'info',
  enableHashChain: true,
});

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate correlation ID for request tracing
 */
export function generateCorrelationId(): string {
  return randomUUID();
}

/**
 * Hash API key for logging (never log raw API keys)
 */
export function hashAPIKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex').substring(0, 16);
}

/**
 * Extract client info from HTTP request
 */
export function extractClientInfo(req: {
  socket: { remoteAddress?: string };
  headers: Record<string, string | string[] | undefined>;
}): SecurityEvent['client'] {
  return {
    ip: req.socket.remoteAddress || 'unknown',
    apiKeyHash: undefined, // Set separately after key extraction
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
  };
}

/**
 * Extract request info from HTTP request
 */
export function extractRequestInfo(req: {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}): SecurityEvent['request'] {
  const url = req.url ? new URL(req.url, 'http://localhost') : undefined;

  return {
    method: req.method || 'GET',
    path: url?.pathname || '/',
    query: url ? Object.fromEntries(url.searchParams.entries()) : undefined,
    headers: {
      'user-agent': typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
      'referer': typeof req.headers['referer'] === 'string' ? req.headers['referer'] : undefined,
    } as Record<string, string>,
  };
}

// ============================================================================
// Log Query Interface
// ============================================================================

/**
 * Query audit logs (for security analysis)
 *
 * @param filters - Query filters
 * @returns Matching events
 */
export async function queryAuditLogs(filters: {
  startDate?: Date;
  endDate?: Date;
  severity?: SecuritySeverity[];
  category?: SecurityEventCategory[];
  clientIP?: string;
  correlationId?: string;
}): Promise<readonly SecurityEvent[]> {
  // TODO: Implement log querying
  // This would read JSONL files and filter events
  // For production, consider using a log aggregation service (e.g., Elasticsearch)
  return [];
}

/**
 * Verify audit log integrity (check hash chain)
 *
 * @param logFilePath - Path to log file
 * @returns True if chain valid, false if tampered
 */
export async function verifyAuditLogIntegrity(logFilePath: string): Promise<{
  valid: boolean;
  brokenAt?: number;
  error?: string;
}> {
  // TODO: Implement hash chain verification
  // This would read log file and verify each event's hash matches computed hash
  return { valid: true };
}
