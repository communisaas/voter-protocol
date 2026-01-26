/**
 * Output Formatting for CLI Commands
 *
 * Provides consistent output formatting across all CLI commands.
 * Supports: table, json, ndjson, csv formats
 *
 * @module cli/lib/output
 */

/**
 * Output format options
 */
export type OutputFormat = 'table' | 'json' | 'ndjson' | 'csv';

/**
 * Column definition for table output
 */
export interface TableColumn {
  readonly key: string;
  readonly header: string;
  readonly width?: number;
  readonly align?: 'left' | 'right' | 'center';
  readonly formatter?: (value: unknown) => string;
}

/**
 * Format data as a table
 */
export function formatTable<T extends Record<string, unknown>>(
  data: T[],
  columns: TableColumn[]
): string {
  if (data.length === 0) {
    return 'No entries found.';
  }

  // Calculate column widths
  const widths = columns.map((col) => {
    if (col.width) return col.width;

    const headerWidth = col.header.length;
    const maxDataWidth = Math.max(
      ...data.map((row) => {
        const value = row[col.key];
        const formatted = col.formatter ? col.formatter(value) : String(value ?? '');
        return formatted.length;
      })
    );
    return Math.max(headerWidth, maxDataWidth);
  });

  // Build header row
  const headerRow = columns
    .map((col, i) => padCell(col.header, widths[i], col.align || 'left'))
    .join(' | ');

  // Build separator
  const separator = widths.map((w) => '-'.repeat(w)).join('-+-');

  // Build data rows
  const dataRows = data.map((row) =>
    columns
      .map((col, i) => {
        const value = row[col.key];
        const formatted = col.formatter ? col.formatter(value) : String(value ?? '');
        return padCell(formatted, widths[i], col.align || 'left');
      })
      .join(' | ')
  );

  return [headerRow, separator, ...dataRows].join('\n');
}

/**
 * Pad a cell value to the specified width
 */
function padCell(value: string, width: number, align: 'left' | 'right' | 'center'): string {
  const truncated = value.length > width ? value.slice(0, width - 1) + '~' : value;

  switch (align) {
    case 'right':
      return truncated.padStart(width);
    case 'center': {
      const padding = width - truncated.length;
      const leftPad = Math.floor(padding / 2);
      return ' '.repeat(leftPad) + truncated + ' '.repeat(padding - leftPad);
    }
    default:
      return truncated.padEnd(width);
  }
}

/**
 * Format data as JSON
 */
export function formatJson<T>(data: T, pretty = true): string {
  return pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
}

/**
 * Format data as NDJSON
 */
export function formatNdjson<T>(data: T[]): string {
  return data.map((item) => JSON.stringify(item)).join('\n');
}

/**
 * Format data as CSV
 */
export function formatCsv<T extends Record<string, unknown>>(
  data: T[],
  columns: TableColumn[]
): string {
  if (data.length === 0) {
    return columns.map((c) => c.header).join(',');
  }

  // Build header row
  const headerRow = columns.map((c) => escapeCSV(c.header)).join(',');

  // Build data rows
  const dataRows = data.map((row) =>
    columns
      .map((col) => {
        const value = row[col.key];
        const formatted = col.formatter ? col.formatter(value) : String(value ?? '');
        return escapeCSV(formatted);
      })
      .join(',')
  );

  return [headerRow, ...dataRows].join('\n');
}

/**
 * Escape a value for CSV output
 */
function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Format data in the specified format
 */
export function formatOutput<T extends Record<string, unknown>>(
  data: T[],
  format: OutputFormat,
  columns: TableColumn[]
): string {
  switch (format) {
    case 'json':
      return formatJson(data);
    case 'ndjson':
      return formatNdjson(data);
    case 'csv':
      return formatCsv(data, columns);
    case 'table':
    default:
      return formatTable(data, columns);
  }
}

/**
 * Common column formatters
 */
export const formatters = {
  /**
   * Format a date string as locale date
   */
  date: (value: unknown): string => {
    if (!value) return '-';
    const date = new Date(String(value));
    return isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
  },

  /**
   * Format a date string with time
   */
  datetime: (value: unknown): string => {
    if (!value) return '-';
    const date = new Date(String(value));
    return isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  },

  /**
   * Format a date as relative time (e.g., "3 days ago")
   */
  relativeDate: (value: unknown): string => {
    if (!value) return '-';
    const date = new Date(String(value));
    if (isNaN(date.getTime())) return String(value);

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
  },

  /**
   * Format a number with locale formatting
   */
  number: (value: unknown): string => {
    if (value === null || value === undefined) return '-';
    const num = Number(value);
    return isNaN(num) ? String(value) : num.toLocaleString();
  },

  /**
   * Format a confidence score as percentage
   */
  confidence: (value: unknown): string => {
    if (value === null || value === undefined) return '-';
    const num = Number(value);
    return isNaN(num) ? String(value) : `${num}%`;
  },

  /**
   * Truncate a string to max length
   */
  truncate:
    (maxLength: number) =>
    (value: unknown): string => {
      const str = String(value ?? '');
      return str.length > maxLength ? str.slice(0, maxLength - 3) + '...' : str;
    },

  /**
   * Format URL (show domain only)
   */
  urlDomain: (value: unknown): string => {
    if (!value) return '-';
    try {
      const url = new URL(String(value));
      return url.hostname;
    } catch {
      return String(value).slice(0, 30) + '...';
    }
  },

  /**
   * Format boolean as yes/no
   */
  yesNo: (value: unknown): string => {
    return value ? 'yes' : 'no';
  },
};

/**
 * Print output to console
 */
export function printOutput(output: string): void {
  console.log(output);
}

/**
 * Print error to stderr
 */
export function printError(message: string): void {
  console.error(`Error: ${message}`);
}

/**
 * Print success message
 */
export function printSuccess(message: string): void {
  console.log(`Success: ${message}`);
}

/**
 * Print warning message
 */
export function printWarning(message: string): void {
  console.warn(`Warning: ${message}`);
}

/**
 * Print verbose output (only if verbose mode)
 */
export function printVerbose(message: string, verbose: boolean): void {
  if (verbose) {
    console.log(`[verbose] ${message}`);
  }
}
