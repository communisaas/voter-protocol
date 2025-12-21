/**
 * Shadow Atlas Alerting - Simple Pre-Launch Alerting
 *
 * No PagerDuty, no OpsGenie, no complex routing.
 * Just detect issues and notify through simple channels.
 *
 * CHANNELS:
 * - stdout (for local dev / container logs)
 * - file (for log aggregation later)
 * - webhook (Slack, Discord, or custom)
 *
 * ALERT TYPES:
 * - Extraction failure rate exceeded
 * - Provider down
 * - Validation pass rate dropped
 * - Job duration regression
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import { appendFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import type { HealthSummary, MetricsStore } from './metrics.js';

// ============================================================================
// Alert Types
// ============================================================================

/**
 * Alert severity levels
 */
export type AlertSeverity = 'warning' | 'critical';

/**
 * Alert status
 */
export type AlertStatus = 'firing' | 'resolved';

/**
 * Alert definition
 */
export interface Alert {
  readonly name: string;
  readonly severity: AlertSeverity;
  readonly status: AlertStatus;
  readonly message: string;
  readonly firedAt: Date;
  readonly resolvedAt?: Date;
  readonly context: Record<string, unknown>;
}

/**
 * Alert rule definition
 */
export interface AlertRule {
  readonly name: string;
  readonly severity: AlertSeverity;
  readonly condition: (health: HealthSummary) => boolean;
  readonly message: (health: HealthSummary) => string;
}

/**
 * Alert channel interface
 */
export interface AlertChannel {
  send(alert: Alert): Promise<void>;
}

// ============================================================================
// Default Alert Rules
// ============================================================================

/**
 * Default alert rules for Shadow Atlas
 */
export const DEFAULT_ALERT_RULES: readonly AlertRule[] = [
  {
    name: 'extraction_failure_rate_high',
    severity: 'critical',
    condition: (health) => health.extractionSuccessRate < 0.8,
    message: (health) =>
      `Extraction success rate dropped to ${(health.extractionSuccessRate * 100).toFixed(1)}% (threshold: 80%)`,
  },
  {
    name: 'extraction_failure_rate_warning',
    severity: 'warning',
    condition: (health) =>
      health.extractionSuccessRate >= 0.8 && health.extractionSuccessRate < 0.9,
    message: (health) =>
      `Extraction success rate at ${(health.extractionSuccessRate * 100).toFixed(1)}% (warning: <90%)`,
  },
  {
    name: 'validation_pass_rate_low',
    severity: 'critical',
    condition: (health) => health.validationPassRate < 0.8,
    message: (health) =>
      `Validation pass rate dropped to ${(health.validationPassRate * 100).toFixed(1)}% (threshold: 80%)`,
  },
  {
    name: 'provider_down',
    severity: 'critical',
    condition: (health) =>
      Object.values(health.providerAvailability).some((available) => !available),
    message: (health) => {
      const down = Object.entries(health.providerAvailability)
        .filter(([, available]) => !available)
        .map(([provider]) => provider);
      return `Providers down: ${down.join(', ')}`;
    },
  },
  {
    name: 'job_duration_regression',
    severity: 'warning',
    condition: (health) => health.avgJobDurationMs > 60000, // 1 minute
    message: (health) =>
      `Average job duration ${(health.avgJobDurationMs / 1000).toFixed(1)}s exceeds threshold (60s)`,
  },
];

// ============================================================================
// Alert Channels
// ============================================================================

/**
 * Console alert channel (stdout)
 */
export class ConsoleAlertChannel implements AlertChannel {
  async send(alert: Alert): Promise<void> {
    const prefix = alert.severity === 'critical' ? '🚨' : '⚠️';
    const status = alert.status === 'firing' ? 'FIRING' : 'RESOLVED';

    console.log(
      JSON.stringify({
        type: 'alert',
        prefix,
        status,
        name: alert.name,
        severity: alert.severity,
        message: alert.message,
        firedAt: alert.firedAt.toISOString(),
        resolvedAt: alert.resolvedAt?.toISOString(),
        context: alert.context,
      })
    );
  }
}

/**
 * File alert channel (append to file)
 */
export class FileAlertChannel implements AlertChannel {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async send(alert: Alert): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });

    const line =
      JSON.stringify({
        timestamp: new Date().toISOString(),
        status: alert.status,
        name: alert.name,
        severity: alert.severity,
        message: alert.message,
        firedAt: alert.firedAt.toISOString(),
        resolvedAt: alert.resolvedAt?.toISOString(),
        context: alert.context,
      }) + '\n';

    await appendFile(this.filePath, line);
  }
}

/**
 * Webhook alert channel (Slack, Discord, or custom)
 */
export class WebhookAlertChannel implements AlertChannel {
  private readonly webhookUrl: string;

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl;
  }

  async send(alert: Alert): Promise<void> {
    const emoji = alert.severity === 'critical' ? ':rotating_light:' : ':warning:';
    const color = alert.severity === 'critical' ? '#dc3545' : '#ffc107';
    const status = alert.status === 'firing' ? 'FIRING' : 'RESOLVED';

    // Slack-compatible payload
    const payload = {
      text: `${emoji} *[${status}]* ${alert.name}`,
      attachments: [
        {
          color,
          fields: [
            {
              title: 'Message',
              value: alert.message,
              short: false,
            },
            {
              title: 'Severity',
              value: alert.severity,
              short: true,
            },
            {
              title: 'Status',
              value: status,
              short: true,
            },
          ],
          footer: 'Shadow Atlas',
          ts: Math.floor(alert.firedAt.getTime() / 1000),
        },
      ],
    };

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error(`Webhook failed: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.error('Failed to send webhook:', error);
    }
  }
}

// ============================================================================
// Alert Manager
// ============================================================================

/**
 * Simple alert manager
 *
 * Evaluates rules against health summary, tracks alert state,
 * sends to configured channels.
 */
export class AlertManager {
  private readonly rules: readonly AlertRule[];
  private readonly channels: readonly AlertChannel[];
  private readonly activeAlerts = new Map<string, Alert>();

  constructor(
    rules: readonly AlertRule[] = DEFAULT_ALERT_RULES,
    channels: readonly AlertChannel[] = [new ConsoleAlertChannel()]
  ) {
    this.rules = rules;
    this.channels = channels;
  }

  /**
   * Evaluate health and trigger/resolve alerts
   */
  async evaluate(health: HealthSummary): Promise<readonly Alert[]> {
    const triggered: Alert[] = [];

    for (const rule of this.rules) {
      const shouldFire = rule.condition(health);
      const existing = this.activeAlerts.get(rule.name);

      if (shouldFire && !existing) {
        // New alert
        const alert: Alert = {
          name: rule.name,
          severity: rule.severity,
          status: 'firing',
          message: rule.message(health),
          firedAt: new Date(),
          context: {
            extractionSuccessRate: health.extractionSuccessRate,
            validationPassRate: health.validationPassRate,
            avgJobDurationMs: health.avgJobDurationMs,
          },
        };

        this.activeAlerts.set(rule.name, alert);
        await this.notify(alert);
        triggered.push(alert);
      } else if (!shouldFire && existing) {
        // Alert resolved
        const resolved: Alert = {
          ...existing,
          status: 'resolved',
          resolvedAt: new Date(),
        };

        this.activeAlerts.delete(rule.name);
        await this.notify(resolved);
        triggered.push(resolved);
      }
    }

    return triggered;
  }

  /**
   * Send alert to all channels
   */
  private async notify(alert: Alert): Promise<void> {
    await Promise.all(this.channels.map((channel) => channel.send(alert)));
  }

  /**
   * Get currently active alerts
   */
  getActiveAlerts(): readonly Alert[] {
    return Array.from(this.activeAlerts.values());
  }

  /**
   * Check if any critical alerts are firing
   */
  hasCriticalAlerts(): boolean {
    return Array.from(this.activeAlerts.values()).some(
      (alert) => alert.severity === 'critical'
    );
  }
}

// ============================================================================
// Health Check Runner
// ============================================================================

/**
 * Scheduled health check runner
 *
 * Runs health checks at intervals, evaluates alerts,
 * suitable for cron jobs or simple scheduling.
 */
export class HealthCheckRunner {
  private readonly metricsStore: MetricsStore;
  private readonly alertManager: AlertManager;
  private readonly intervalMs: number;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    metricsStore: MetricsStore,
    alertManager: AlertManager,
    intervalMs = 5 * 60 * 1000 // 5 minutes
  ) {
    this.metricsStore = metricsStore;
    this.alertManager = alertManager;
    this.intervalMs = intervalMs;
  }

  /**
   * Run a single health check
   */
  async check(): Promise<HealthSummary> {
    const health = this.metricsStore.getHealthSummary(24);
    await this.alertManager.evaluate(health);
    return health;
  }

  /**
   * Start scheduled checks
   */
  start(): void {
    if (this.intervalId) return;

    // Run immediately
    this.check().catch(console.error);

    // Then on interval
    this.intervalId = setInterval(() => {
      this.check().catch(console.error);
    }, this.intervalMs);
  }

  /**
   * Stop scheduled checks
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create alert manager with default configuration
 */
export function createAlertManager(options?: {
  webhookUrl?: string;
  alertFilePath?: string;
}): AlertManager {
  const channels: AlertChannel[] = [new ConsoleAlertChannel()];

  if (options?.alertFilePath) {
    channels.push(new FileAlertChannel(options.alertFilePath));
  }

  if (options?.webhookUrl) {
    channels.push(new WebhookAlertChannel(options.webhookUrl));
  }

  return new AlertManager(DEFAULT_ALERT_RULES, channels);
}
