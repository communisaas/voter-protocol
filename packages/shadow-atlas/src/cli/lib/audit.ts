/**
 * Audit Logging for Registry Operations
 *
 * Provides append-only audit logging for all registry mutations.
 * Audit logs are stored as NDJSON in data/audit/audit.ndjson
 *
 * @module cli/lib/audit
 */

import { readFile, appendFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import type { RegistryEntry, RegistryName } from './ndjson.js';

/**
 * Audit action types
 */
export type AuditAction =
  | 'add'
  | 'update'
  | 'delete'
  | 'quarantine'
  | 'restore'
  | 'promote'
  | 'migrate'
  | 'rollback';

/**
 * Audit entry schema
 */
export interface AuditEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly action: AuditAction;
  readonly registry: RegistryName;
  readonly fips: string;
  readonly actor: string;
  readonly reason?: string;
  readonly before?: Record<string, unknown>;
  readonly after?: Record<string, unknown>;
  readonly metadata?: {
    readonly cliVersion: string;
    readonly command: string;
    readonly duration_ms?: number;
  };
}

/**
 * Audit log configuration
 */
export interface AuditConfig {
  readonly dataDir: string;
  readonly enabled: boolean;
  readonly actor: string;
  readonly cliVersion: string;
}

/**
 * Default audit configuration
 */
const DEFAULT_CONFIG: AuditConfig = {
  dataDir: process.cwd(),
  enabled: true,
  actor: process.env.USER || 'unknown',
  cliVersion: '1.0.0',
};

let globalConfig: AuditConfig = DEFAULT_CONFIG;

/**
 * Configure the audit logger
 */
export function configureAudit(config: Partial<AuditConfig>): void {
  globalConfig = { ...globalConfig, ...config };
}

/**
 * Get the audit log file path
 */
export function getAuditLogPath(dataDir: string): string {
  return join(dataDir, 'audit', 'audit.ndjson');
}

/**
 * Log an audit entry
 *
 * @param entry - Partial audit entry (id, timestamp auto-generated)
 */
export async function logAudit(
  entry: Omit<AuditEntry, 'id' | 'timestamp' | 'actor' | 'metadata'> & {
    command?: string;
    duration_ms?: number;
  }
): Promise<AuditEntry> {
  if (!globalConfig.enabled) {
    // Return a mock entry when auditing is disabled
    return {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      action: entry.action,
      registry: entry.registry,
      fips: entry.fips,
      actor: globalConfig.actor,
      reason: entry.reason,
      before: entry.before,
      after: entry.after,
    };
  }

  const auditEntry: AuditEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    action: entry.action,
    registry: entry.registry,
    fips: entry.fips,
    actor: globalConfig.actor,
    reason: entry.reason,
    before: entry.before,
    after: entry.after,
    metadata: {
      cliVersion: globalConfig.cliVersion,
      command: entry.command || 'unknown',
      duration_ms: entry.duration_ms,
    },
  };

  const logPath = getAuditLogPath(globalConfig.dataDir);

  // Ensure audit directory exists
  await mkdir(dirname(logPath), { recursive: true });

  // Append entry to audit log
  const line = JSON.stringify(auditEntry) + '\n';
  await appendFile(logPath, line, 'utf-8');

  return auditEntry;
}

/**
 * Log an add operation
 */
export async function logAdd(
  registry: RegistryName,
  fips: string,
  after: RegistryEntry,
  options?: { reason?: string; command?: string }
): Promise<AuditEntry> {
  return logAudit({
    action: 'add',
    registry,
    fips,
    reason: options?.reason,
    after: after as unknown as Record<string, unknown>,
    command: options?.command,
  });
}

/**
 * Log an update operation
 */
export async function logUpdate(
  registry: RegistryName,
  fips: string,
  before: RegistryEntry,
  after: RegistryEntry,
  options?: { reason?: string; command?: string }
): Promise<AuditEntry> {
  return logAudit({
    action: 'update',
    registry,
    fips,
    reason: options?.reason,
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
    command: options?.command,
  });
}

/**
 * Log a delete operation
 */
export async function logDelete(
  registry: RegistryName,
  fips: string,
  before: RegistryEntry,
  options?: { reason?: string; command?: string }
): Promise<AuditEntry> {
  return logAudit({
    action: 'delete',
    registry,
    fips,
    reason: options?.reason,
    before: before as unknown as Record<string, unknown>,
    command: options?.command,
  });
}

/**
 * Log a quarantine operation
 */
export async function logQuarantine(
  fips: string,
  before: RegistryEntry,
  after: RegistryEntry,
  options?: { reason?: string; command?: string }
): Promise<AuditEntry> {
  return logAudit({
    action: 'quarantine',
    registry: 'quarantined-portals',
    fips,
    reason: options?.reason,
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
    command: options?.command,
  });
}

/**
 * Log a restore operation
 */
export async function logRestore(
  fips: string,
  before: RegistryEntry,
  after: RegistryEntry,
  options?: { reason?: string; command?: string }
): Promise<AuditEntry> {
  return logAudit({
    action: 'restore',
    registry: 'known-portals',
    fips,
    reason: options?.reason,
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
    command: options?.command,
  });
}

/**
 * Log a promote operation (quarantine -> at-large)
 */
export async function logPromote(
  fips: string,
  before: RegistryEntry,
  after: RegistryEntry,
  options?: { reason?: string; command?: string }
): Promise<AuditEntry> {
  return logAudit({
    action: 'promote',
    registry: 'at-large-cities',
    fips,
    reason: options?.reason,
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
    command: options?.command,
  });
}

/**
 * Query audit log entries
 *
 * @param options - Query options
 * @returns Matching audit entries
 */
export async function queryAuditLog(options: {
  fips?: string;
  action?: AuditAction;
  registry?: RegistryName;
  since?: Date;
  until?: Date;
  limit?: number;
}): Promise<AuditEntry[]> {
  const logPath = getAuditLogPath(globalConfig.dataDir);

  let content: string;
  try {
    content = await readFile(logPath, 'utf-8');
  } catch {
    return []; // Audit log doesn't exist yet
  }

  const lines = content.trim().split('\n').filter(Boolean);
  let entries: AuditEntry[] = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as AuditEntry;
      entries.push(entry);
    } catch {
      // Skip malformed lines
      continue;
    }
  }

  // Apply filters
  if (options.fips) {
    entries = entries.filter((e) => e.fips === options.fips);
  }

  if (options.action) {
    entries = entries.filter((e) => e.action === options.action);
  }

  if (options.registry) {
    entries = entries.filter((e) => e.registry === options.registry);
  }

  if (options.since) {
    entries = entries.filter((e) => new Date(e.timestamp) >= options.since!);
  }

  if (options.until) {
    entries = entries.filter((e) => new Date(e.timestamp) <= options.until!);
  }

  // Sort by timestamp descending (most recent first)
  entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Apply limit
  if (options.limit && options.limit > 0) {
    entries = entries.slice(0, options.limit);
  }

  return entries;
}

/**
 * Get history for a specific FIPS code
 *
 * @param fips - FIPS code
 * @returns Audit entries for this FIPS, sorted by timestamp descending
 */
export async function getEntryHistory(fips: string): Promise<AuditEntry[]> {
  return queryAuditLog({ fips });
}

/**
 * Format an audit entry for display
 */
export function formatAuditEntry(entry: AuditEntry): string {
  const date = new Date(entry.timestamp).toLocaleString();
  const parts = [
    `[${date}]`,
    entry.action.toUpperCase(),
    `${entry.registry}/${entry.fips}`,
    `by ${entry.actor}`,
  ];

  if (entry.reason) {
    parts.push(`- ${entry.reason}`);
  }

  return parts.join(' ');
}
