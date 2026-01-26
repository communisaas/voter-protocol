/**
 * Shadow Atlas CLI Structured Logging
 *
 * Provides structured logging with JSON output for machine consumption
 * and human-readable output for interactive use. Includes timestamp,
 * command context, and duration tracking.
 *
 * @module cli/lib/logger
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Log levels in order of severity
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Log entry metadata
 */
export interface LogMetadata {
  readonly [key: string]: unknown;
}

/**
 * Structured log entry for JSON output
 */
export interface StructuredLogEntry {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly command?: string;
  readonly duration_ms?: number;
  readonly [key: string]: unknown;
}

/**
 * Logger configuration
 */
export interface CLILoggerConfig {
  /** Minimum log level to output */
  readonly level: LogLevel;
  /** Output as JSON */
  readonly json: boolean;
  /** Command name for context */
  readonly command?: string;
  /** Service name */
  readonly service?: string;
}

/**
 * Progress tracking options
 */
export interface ProgressOptions {
  /** Total items to process */
  total: number;
  /** Current item index */
  current: number;
  /** Item label */
  label?: string;
  /** Additional metadata */
  metadata?: LogMetadata;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Log level numeric values for comparison
 */
const LOG_LEVEL_VALUES: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * ANSI color codes for terminal output
 */
const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
} as const;

/**
 * Level-specific colors
 */
const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: COLORS.gray,
  info: COLORS.blue,
  warn: COLORS.yellow,
  error: COLORS.red,
};

/**
 * Level display names
 */
const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
};

// ============================================================================
// CLI Logger Class
// ============================================================================

/**
 * CLI Logger with structured JSON and human-readable output
 */
export class CLILogger {
  private readonly config: CLILoggerConfig;
  private startTime: number;
  private commandContext: string | null = null;

  constructor(config: CLILoggerConfig) {
    this.config = {
      service: 'shadow-atlas',
      ...config,
    };
    this.startTime = Date.now();
  }

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_VALUES[level] >= LOG_LEVEL_VALUES[this.config.level];
  }

  /**
   * Get current timestamp in ISO format
   */
  private getTimestamp(): string {
    return new Date().toISOString();
  }

  /**
   * Get elapsed time since start or last reset
   */
  private getElapsedMs(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Format message for JSON output
   */
  private formatJson(
    level: LogLevel,
    message: string,
    metadata?: LogMetadata
  ): string {
    const entry: StructuredLogEntry = {
      timestamp: this.getTimestamp(),
      level,
      message,
      ...(this.config.service && { service: this.config.service }),
      ...(this.commandContext && { command: this.commandContext }),
      ...(metadata && Object.keys(metadata).length > 0 ? metadata : {}),
    };
    return JSON.stringify(entry);
  }

  /**
   * Format message for human-readable output
   */
  private formatHuman(
    level: LogLevel,
    message: string,
    metadata?: LogMetadata
  ): string {
    const timestamp = this.getTimestamp();
    const color = LEVEL_COLORS[level];
    const label = LEVEL_LABELS[level];

    // Build the formatted line
    let line = `${COLORS.dim}${timestamp}${COLORS.reset} `;
    line += `${color}${label}${COLORS.reset} `;
    line += message;

    // Add metadata if present
    if (metadata && Object.keys(metadata).length > 0) {
      const metaStr = Object.entries(metadata)
        .map(([key, value]) => {
          const valueStr =
            typeof value === 'object' ? JSON.stringify(value) : String(value);
          return `${COLORS.cyan}${key}${COLORS.reset}=${valueStr}`;
        })
        .join(' ');
      line += ` ${COLORS.dim}(${metaStr})${COLORS.reset}`;
    }

    return line;
  }

  /**
   * Output a log entry
   */
  private log(level: LogLevel, message: string, metadata?: LogMetadata): void {
    if (!this.shouldLog(level)) return;

    const formatted = this.config.json
      ? this.formatJson(level, message, metadata)
      : this.formatHuman(level, message, metadata);

    switch (level) {
      case 'debug':
        console.debug(formatted);
        break;
      case 'info':
        console.info(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      case 'error':
        console.error(formatted);
        break;
    }
  }

  /**
   * Set command context for subsequent log entries
   */
  setCommand(command: string): void {
    this.commandContext = command;
    this.startTime = Date.now();
  }

  /**
   * Reset the start time for duration tracking
   */
  resetTimer(): void {
    this.startTime = Date.now();
  }

  /**
   * Log a debug message
   */
  debug(message: string, metadata?: LogMetadata): void {
    this.log('debug', message, metadata);
  }

  /**
   * Log an info message
   */
  info(message: string, metadata?: LogMetadata): void {
    this.log('info', message, metadata);
  }

  /**
   * Log a warning message
   */
  warn(message: string, metadata?: LogMetadata): void {
    this.log('warn', message, metadata);
  }

  /**
   * Log an error message
   */
  error(message: string, metadata?: LogMetadata): void {
    this.log('error', message, metadata);
  }

  /**
   * Log command start
   */
  commandStart(command: string, options?: LogMetadata): void {
    this.setCommand(command);
    this.info(`Starting ${command}`, options);
  }

  /**
   * Log command completion with duration
   */
  commandEnd(success: boolean, metadata?: LogMetadata): void {
    const duration_ms = this.getElapsedMs();
    const baseMetadata = { duration_ms, ...metadata };

    if (success) {
      this.info(`Command completed`, baseMetadata);
    } else {
      this.error(`Command failed`, baseMetadata);
    }
  }

  /**
   * Log progress for long-running operations
   */
  progress(options: ProgressOptions): void {
    const { total, current, label, metadata } = options;
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;

    if (this.config.json) {
      this.info('Progress', {
        current,
        total,
        percent,
        label,
        ...metadata,
      });
    } else {
      // Human-readable progress bar
      const barWidth = 30;
      const filled = Math.round((current / total) * barWidth);
      const empty = barWidth - filled;
      const bar = `[${'='.repeat(filled)}${' '.repeat(empty)}]`;

      const labelStr = label ? ` ${label}` : '';
      process.stdout.write(
        `\r${COLORS.dim}${bar}${COLORS.reset} ${percent}% (${current}/${total})${labelStr}`
      );

      // Clear line when complete
      if (current >= total) {
        process.stdout.write('\n');
      }
    }
  }

  /**
   * Log a table of data (for non-JSON output)
   */
  table(data: Record<string, unknown>[], columns?: string[]): void {
    if (this.config.json) {
      console.log(JSON.stringify(data));
      return;
    }

    if (data.length === 0) {
      this.info('No data to display');
      return;
    }

    // Use provided columns or extract from first row
    const cols = columns ?? Object.keys(data[0]);

    // Calculate column widths
    const widths: Record<string, number> = {};
    for (const col of cols) {
      widths[col] = col.length;
      for (const row of data) {
        const value = String(row[col] ?? '');
        widths[col] = Math.max(widths[col], value.length);
      }
    }

    // Print header
    const headerLine = cols.map((col) => col.padEnd(widths[col])).join(' | ');
    const separator = cols.map((col) => '-'.repeat(widths[col])).join('-+-');
    console.log(headerLine);
    console.log(separator);

    // Print rows
    for (const row of data) {
      const rowLine = cols
        .map((col) => String(row[col] ?? '').padEnd(widths[col]))
        .join(' | ');
      console.log(rowLine);
    }
  }

  /**
   * Create a child logger with additional context
   */
  child(context: LogMetadata): CLILogger {
    const childLogger = new CLILogger(this.config);
    childLogger.commandContext = this.commandContext;
    // Note: In a full implementation, context would be merged into all log entries
    return childLogger;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a CLI logger with the given configuration
 */
export function createCLILogger(config: Partial<CLILoggerConfig> = {}): CLILogger {
  return new CLILogger({
    level: config.level ?? 'info',
    json: config.json ?? false,
    command: config.command,
    service: config.service ?? 'shadow-atlas',
  });
}

/**
 * Singleton logger instance for global access
 */
let defaultLogger: CLILogger | null = null;

/**
 * Get or create the default logger
 */
export function getDefaultLogger(): CLILogger {
  if (!defaultLogger) {
    defaultLogger = createCLILogger();
  }
  return defaultLogger;
}

/**
 * Set the default logger instance
 */
export function setDefaultLogger(logger: CLILogger): void {
  defaultLogger = logger;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format a duration in milliseconds for display
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`;
  } else {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(1);
    return `${minutes}m ${seconds}s`;
  }
}

/**
 * Format a byte count for display
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  } else if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  } else {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
}

/**
 * Create a spinner for long operations (non-JSON mode only)
 */
export function createSpinner(message: string): {
  start: () => void;
  stop: (success: boolean) => void;
  update: (newMessage: string) => void;
} {
  const frames = ['|', '/', '-', '\\'];
  let frameIndex = 0;
  let interval: NodeJS.Timeout | null = null;
  let currentMessage = message;

  return {
    start() {
      if (process.stdout.isTTY) {
        interval = setInterval(() => {
          process.stdout.write(`\r${frames[frameIndex]} ${currentMessage}`);
          frameIndex = (frameIndex + 1) % frames.length;
        }, 100);
      } else {
        console.log(`... ${currentMessage}`);
      }
    },

    stop(success: boolean) {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      if (process.stdout.isTTY) {
        const symbol = success ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
        process.stdout.write(`\r${symbol} ${currentMessage}\n`);
      }
    },

    update(newMessage: string) {
      currentMessage = newMessage;
    },
  };
}
