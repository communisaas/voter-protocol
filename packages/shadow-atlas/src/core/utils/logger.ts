/**
 * Structured logging utility for Shadow Atlas
 *
 * Provides structured logging with levels, timestamps, and contextual metadata.
 * Uses console-based implementation (extensible to winston/pino in future).
 *
 * @module logger
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogMetadata {
  readonly [key: string]: unknown;
}

interface LoggerConfig {
  readonly level: LogLevel;
  readonly service: string;
  readonly pretty: boolean;
}

class Logger {
  private readonly config: LoggerConfig;
  private readonly levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(config: LoggerConfig) {
    this.config = config;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levels[level] >= this.levels[this.config.level];
  }

  private formatMessage(
    level: LogLevel,
    message: string,
    metadata?: LogMetadata
  ): string {
    const timestamp = new Date().toISOString();
    const baseLog = {
      timestamp,
      level,
      service: this.config.service,
      message,
      ...(metadata && Object.keys(metadata).length > 0 ? metadata : {}),
    };

    if (this.config.pretty) {
      // Pretty print for development
      const metaStr =
        metadata && Object.keys(metadata).length > 0
          ? ` ${JSON.stringify(metadata)}`
          : '';
      return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`;
    }

    // JSON format for production
    return JSON.stringify(baseLog);
  }

  debug(message: string, metadata?: LogMetadata): void {
    if (!this.shouldLog('debug')) return;
    console.debug(this.formatMessage('debug', message, metadata));
  }

  info(message: string, metadata?: LogMetadata): void {
    if (!this.shouldLog('info')) return;
    console.info(this.formatMessage('info', message, metadata));
  }

  warn(message: string, metadata?: LogMetadata): void {
    if (!this.shouldLog('warn')) return;
    console.warn(this.formatMessage('warn', message, metadata));
  }

  error(message: string, metadata?: LogMetadata): void {
    if (!this.shouldLog('error')) return;
    console.error(this.formatMessage('error', message, metadata));
  }
}

// Default logger instance
const getLogLevel = (): LogLevel => {
  const level = process.env.LOG_LEVEL?.toLowerCase();
  if (level === 'debug' || level === 'info' || level === 'warn' || level === 'error') {
    return level;
  }
  return 'info';
};

export const logger = new Logger({
  level: getLogLevel(),
  service: 'shadow-atlas',
  pretty: process.env.NODE_ENV !== 'production',
});

/**
 * Create a child logger with additional context
 */
export function createLogger(context: LogMetadata): Logger {
  return new Logger({
    level: getLogLevel(),
    service: `shadow-atlas:${context.module || 'unknown'}`,
    pretty: process.env.NODE_ENV !== 'production',
  });
}
