/**
 * Migration Utilities for Shadow Atlas CLI
 *
 * Provides functions for managing data migrations including snapshots,
 * applying migrations, and rollback capabilities.
 *
 * @module cli/lib/migration
 */

import { readFile, writeFile, readdir, mkdir, cp, rm, stat } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { atomicWriteFile, atomicWriteJSON } from '../../core/utils/atomic-write.js';
import { getPackageRoot, getNdjsonPath, REGISTRY_NAMES, type RegistryName } from './codegen.js';

// ============================================================================
// Types
// ============================================================================

export interface Snapshot {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly path: string;
  readonly registries: readonly SnapshotRegistry[];
  readonly metadata?: Record<string, unknown>;
}

export interface SnapshotRegistry {
  readonly name: RegistryName;
  readonly entryCount: number;
  readonly checksum: string;
}

export interface Migration {
  readonly name: string;
  readonly description?: string;
  readonly up: (context: MigrationContext) => Promise<void>;
  readonly down?: (context: MigrationContext) => Promise<void>;
  readonly validate?: (context: MigrationContext) => Promise<MigrationValidation>;
}

export interface MigrationContext {
  readonly dryRun: boolean;
  readonly verbose: boolean;
  readonly log: (message: string) => void;
  readonly warn: (message: string) => void;
  readonly readNdjson: (registry: RegistryName) => Promise<NdjsonData>;
  readonly writeNdjson: (registry: RegistryName, data: NdjsonData) => Promise<void>;
}

export interface NdjsonData {
  readonly header: NdjsonHeader;
  readonly entries: Map<string, Record<string, unknown>>;
}

export interface NdjsonHeader {
  readonly _schema: string;
  readonly _type: string;
  _count: number;
  _extracted: string;
  readonly _description: string;
}

export interface MigrationValidation {
  readonly valid: boolean;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

export interface MigrationStatus {
  readonly appliedMigrations: readonly AppliedMigration[];
  readonly pendingMigrations: readonly string[];
  readonly currentSnapshot?: Snapshot;
}

export interface AppliedMigration {
  readonly name: string;
  readonly appliedAt: string;
  readonly snapshotId?: string;
}

export interface MigrationResult {
  readonly success: boolean;
  readonly migrationName: string;
  readonly snapshotId?: string;
  readonly changes: readonly MigrationChange[];
  readonly errors?: readonly string[];
}

export interface MigrationChange {
  readonly registry: RegistryName;
  readonly action: 'add' | 'update' | 'delete';
  readonly fips: string;
  readonly field?: string;
  readonly oldValue?: unknown;
  readonly newValue?: unknown;
}

// ============================================================================
// Path Utilities
// ============================================================================

export function getSnapshotsDir(): string {
  return join(getPackageRoot(), 'data', 'snapshots');
}

export function getMigrationsDir(): string {
  return join(getPackageRoot(), 'data', 'migrations');
}

export function getMigrationHistoryPath(): string {
  return join(getMigrationsDir(), 'history.json');
}

// ============================================================================
// Checksum Utilities
// ============================================================================

/**
 * Calculate simple checksum for NDJSON content
 */
function calculateChecksum(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

// ============================================================================
// NDJSON Utilities
// ============================================================================

/**
 * Parse NDJSON file into structured data
 */
export async function readNdjsonFile(filepath: string): Promise<NdjsonData> {
  const content = await readFile(filepath, 'utf-8');
  const lines = content.trim().split('\n');

  if (lines.length === 0) {
    throw new Error(`Empty NDJSON file: ${filepath}`);
  }

  const header = JSON.parse(lines[0]) as NdjsonHeader;
  const entries = new Map<string, Record<string, unknown>>();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const entry = JSON.parse(line) as Record<string, unknown>;
    const fips = entry._fips as string;
    const { _fips, ...rest } = entry;
    entries.set(fips, rest);
  }

  return { header, entries };
}

/**
 * Write NDJSON data to file
 */
export async function writeNdjsonFile(
  filepath: string,
  data: NdjsonData,
): Promise<void> {
  const header = {
    ...data.header,
    _count: data.entries.size,
    _extracted: new Date().toISOString(),
  };

  const lines: string[] = [JSON.stringify(header)];

  // Sort entries by FIPS for deterministic output
  const sortedEntries = [...data.entries.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  );

  for (const [fips, entry] of sortedEntries) {
    const entryWithKey = { _fips: fips, ...entry };
    lines.push(JSON.stringify(entryWithKey));
  }

  await mkdir(dirname(filepath), { recursive: true });
  await atomicWriteFile(filepath, lines.join('\n') + '\n');
}

// ============================================================================
// Snapshot Operations
// ============================================================================

/**
 * Create a named snapshot of all NDJSON registries
 */
export async function createSnapshot(
  name: string,
  metadata?: Record<string, unknown>,
): Promise<Snapshot> {
  const timestamp = new Date().toISOString();
  const id = `${timestamp.replace(/[:.]/g, '-')}_${name.replace(/[^a-zA-Z0-9-_]/g, '_')}`;
  const snapshotDir = join(getSnapshotsDir(), id);

  await mkdir(snapshotDir, { recursive: true });

  const registries: SnapshotRegistry[] = [];

  for (const registry of REGISTRY_NAMES) {
    const sourcePath = getNdjsonPath(registry);
    const destPath = join(snapshotDir, `${registry}.ndjson`);

    try {
      const content = await readFile(sourcePath, 'utf-8');
      await writeFile(destPath, content, 'utf-8');

      const lines = content.trim().split('\n');
      const header = JSON.parse(lines[0]) as NdjsonHeader;

      registries.push({
        name: registry,
        entryCount: header._count,
        checksum: calculateChecksum(content),
      });
    } catch (error) {
      // Skip missing registries
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  const snapshot: Snapshot = {
    id,
    name,
    createdAt: timestamp,
    path: snapshotDir,
    registries,
    metadata,
  };

  // Write snapshot metadata
  const metadataPath = join(snapshotDir, 'snapshot.json');
  await atomicWriteJSON(metadataPath, snapshot);

  return snapshot;
}

/**
 * Restore from a snapshot
 */
export async function restoreSnapshot(snapshotPath: string): Promise<void> {
  const metadataPath = join(snapshotPath, 'snapshot.json');

  try {
    await stat(metadataPath);
  } catch {
    throw new Error(`Invalid snapshot: missing snapshot.json at ${snapshotPath}`);
  }

  const metadataContent = await readFile(metadataPath, 'utf-8');
  const snapshot = JSON.parse(metadataContent) as Snapshot;

  for (const registry of snapshot.registries) {
    const sourcePath = join(snapshotPath, `${registry.name}.ndjson`);
    const destPath = getNdjsonPath(registry.name);

    await mkdir(dirname(destPath), { recursive: true });
    await cp(sourcePath, destPath);
  }
}

/**
 * List all available snapshots
 */
export async function listSnapshots(): Promise<Snapshot[]> {
  const snapshotsDir = getSnapshotsDir();

  try {
    await mkdir(snapshotsDir, { recursive: true });
    const entries = await readdir(snapshotsDir, { withFileTypes: true });

    const snapshots: Snapshot[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const metadataPath = join(snapshotsDir, entry.name, 'snapshot.json');

      try {
        const content = await readFile(metadataPath, 'utf-8');
        const snapshot = JSON.parse(content) as Snapshot;
        snapshots.push(snapshot);
      } catch {
        // Skip invalid snapshots
      }
    }

    // Sort by creation time, newest first
    snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return snapshots;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Get snapshot by ID or name
 */
export async function getSnapshot(idOrName: string): Promise<Snapshot | null> {
  const snapshots = await listSnapshots();
  return (
    snapshots.find((s) => s.id === idOrName || s.name === idOrName) || null
  );
}

/**
 * Delete a snapshot
 */
export async function deleteSnapshot(snapshotId: string): Promise<void> {
  const snapshot = await getSnapshot(snapshotId);
  if (!snapshot) {
    throw new Error(`Snapshot not found: ${snapshotId}`);
  }

  await rm(snapshot.path, { recursive: true, force: true });
}

// ============================================================================
// Migration History
// ============================================================================

interface MigrationHistory {
  readonly version: number;
  readonly migrations: AppliedMigration[];
}

async function loadMigrationHistory(): Promise<MigrationHistory> {
  const historyPath = getMigrationHistoryPath();

  try {
    const content = await readFile(historyPath, 'utf-8');
    return JSON.parse(content) as MigrationHistory;
  } catch {
    return { version: 1, migrations: [] };
  }
}

async function saveMigrationHistory(history: MigrationHistory): Promise<void> {
  const historyPath = getMigrationHistoryPath();
  await mkdir(dirname(historyPath), { recursive: true });
  await atomicWriteJSON(historyPath, history);
}

// ============================================================================
// Migration Operations
// ============================================================================

/**
 * Load a migration from a file
 */
export async function loadMigration(filepath: string): Promise<Migration> {
  const module = await import(filepath);

  if (!module.name || typeof module.name !== 'string') {
    throw new Error(`Migration must export a 'name' string: ${filepath}`);
  }

  if (!module.up || typeof module.up !== 'function') {
    throw new Error(`Migration must export an 'up' function: ${filepath}`);
  }

  return {
    name: module.name,
    description: module.description,
    up: module.up,
    down: module.down,
    validate: module.validate,
  };
}

/**
 * Create a migration context
 */
function createMigrationContext(
  dryRun: boolean,
  verbose: boolean,
): MigrationContext {
  const changes: MigrationChange[] = [];

  return {
    dryRun,
    verbose,
    log: (message: string) => {
      if (verbose) {
        console.log(`  ${message}`);
      }
    },
    warn: (message: string) => {
      console.warn(`  WARNING: ${message}`);
    },
    readNdjson: async (registry: RegistryName) => {
      const filepath = getNdjsonPath(registry);
      return readNdjsonFile(filepath);
    },
    writeNdjson: async (registry: RegistryName, data: NdjsonData) => {
      if (dryRun) {
        console.log(`  [DRY RUN] Would write ${data.entries.size} entries to ${registry}`);
        return;
      }
      const filepath = getNdjsonPath(registry);
      await writeNdjsonFile(filepath, data);
    },
  };
}

/**
 * Apply a migration
 */
export async function applyMigration(
  filepath: string,
  options: {
    dryRun?: boolean;
    force?: boolean;
    snapshot?: boolean;
    verbose?: boolean;
  } = {},
): Promise<MigrationResult> {
  const { dryRun = false, force = false, snapshot = true, verbose = false } = options;

  const migration = await loadMigration(filepath);
  const context = createMigrationContext(dryRun, verbose);

  // Validate migration if validator exists
  if (migration.validate) {
    const validation = await migration.validate(context);

    if (!validation.valid && !force) {
      return {
        success: false,
        migrationName: migration.name,
        changes: [],
        errors: validation.errors,
      };
    }

    if (validation.warnings.length > 0) {
      for (const warning of validation.warnings) {
        context.warn(warning);
      }
    }
  }

  // Create snapshot before applying
  let snapshotId: string | undefined;
  if (snapshot && !dryRun) {
    const snap = await createSnapshot(`pre-${migration.name}`);
    snapshotId = snap.id;
  }

  // Apply migration
  try {
    await migration.up(context);

    // Record migration in history
    if (!dryRun) {
      const history = await loadMigrationHistory();
      history.migrations.push({
        name: migration.name,
        appliedAt: new Date().toISOString(),
        snapshotId,
      });
      await saveMigrationHistory(history);
    }

    return {
      success: true,
      migrationName: migration.name,
      snapshotId,
      changes: [],
    };
  } catch (error) {
    return {
      success: false,
      migrationName: migration.name,
      snapshotId,
      changes: [],
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

/**
 * Rollback to a specific snapshot or N steps
 */
export async function rollback(
  options: {
    to?: string;
    steps?: number;
  } = {},
): Promise<{ success: boolean; snapshotId?: string; error?: string }> {
  const { to, steps = 1 } = options;

  const snapshots = await listSnapshots();

  if (snapshots.length === 0) {
    return { success: false, error: 'No snapshots available for rollback' };
  }

  let targetSnapshot: Snapshot | undefined;

  if (to) {
    targetSnapshot = snapshots.find((s) => s.id === to || s.name === to);
    if (!targetSnapshot) {
      return { success: false, error: `Snapshot not found: ${to}` };
    }
  } else {
    // Rollback N steps (find Nth most recent snapshot)
    if (steps <= 0 || steps > snapshots.length) {
      return {
        success: false,
        error: `Invalid steps: ${steps} (available: ${snapshots.length})`,
      };
    }
    targetSnapshot = snapshots[steps - 1];
  }

  try {
    await restoreSnapshot(targetSnapshot.path);
    return { success: true, snapshotId: targetSnapshot.id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get migration status
 */
export async function getMigrationStatus(): Promise<MigrationStatus> {
  const history = await loadMigrationHistory();
  const snapshots = await listSnapshots();

  // Find pending migrations by scanning migrations directory
  const migrationsDir = getMigrationsDir();
  let pendingMigrations: string[] = [];

  try {
    const entries = await readdir(migrationsDir);
    const appliedNames = new Set(history.migrations.map((m) => m.name));

    pendingMigrations = entries
      .filter((e) => e.endsWith('.ts') || e.endsWith('.js'))
      .filter((e) => !e.includes('history'))
      .map((e) => basename(e, e.endsWith('.ts') ? '.ts' : '.js'))
      .filter((name) => !appliedNames.has(name));
  } catch {
    // No migrations directory
  }

  return {
    appliedMigrations: history.migrations,
    pendingMigrations,
    currentSnapshot: snapshots[0],
  };
}
