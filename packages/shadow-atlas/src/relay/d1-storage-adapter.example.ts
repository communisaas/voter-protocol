/**
 * D1 Storage Adapter — Reference Implementation
 *
 * This is a reference implementation of RelayStorageAdapter for Cloudflare D1.
 * Bedrock adapts this to the actual CF Worker relay.
 *
 * D1 SCHEMA (create these tables in the D1 database):
 *
 * ```sql
 * -- Tree 1: Registration leaves
 * CREATE TABLE registration_leaves (
 *   leaf_index INTEGER PRIMARY KEY,
 *   leaf_hex TEXT NOT NULL,
 *   is_empty INTEGER NOT NULL DEFAULT 0,
 *   attestation_hash TEXT,
 *   created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
 * );
 * CREATE UNIQUE INDEX idx_leaf_hex ON registration_leaves(leaf_hex) WHERE is_empty = 0;
 *
 * -- Tree 1: Metadata
 * CREATE TABLE tree_metadata (
 *   key TEXT PRIMARY KEY,
 *   value TEXT NOT NULL
 * );
 * INSERT INTO tree_metadata (key, value) VALUES ('tree_size', '0');
 * INSERT INTO tree_metadata (key, value) VALUES ('tree_depth', '20');
 * INSERT INTO tree_metadata (key, value) VALUES ('tree_capacity', '1048576');
 *
 * -- Idempotency cache
 * CREATE TABLE idempotency_cache (
 *   key TEXT PRIMARY KEY,
 *   result TEXT NOT NULL,
 *   expires_at INTEGER NOT NULL
 * );
 *
 * -- Tree 3: Engagement identities
 * CREATE TABLE engagement_identities (
 *   leaf_index INTEGER PRIMARY KEY,
 *   identity_commitment TEXT NOT NULL UNIQUE,
 *   signer_address TEXT NOT NULL UNIQUE,
 *   tier INTEGER NOT NULL DEFAULT 0,
 *   action_count INTEGER NOT NULL DEFAULT 0,
 *   diversity_score INTEGER NOT NULL DEFAULT 0,
 *   tenure_months INTEGER NOT NULL DEFAULT 0,
 *   adoption_count INTEGER NOT NULL DEFAULT 0,
 *   registered_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
 * );
 *
 * -- WAL (Write-Ahead Log) for crash recovery
 * CREATE TABLE insertion_log (
 *   id INTEGER PRIMARY KEY AUTOINCREMENT,
 *   leaf_hex TEXT NOT NULL,
 *   leaf_index INTEGER NOT NULL,
 *   entry_type TEXT NOT NULL DEFAULT 'insert',
 *   old_index INTEGER,
 *   attestation_hash TEXT,
 *   prev_hash TEXT,
 *   created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
 * );
 * ```
 */

import type {
  RelayStorageAdapter,
  EngagementRecord,
  EngagementBreakdownResult,
} from './write-functions.js';
import {
  TIER_BOUNDARIES,
  computeCompositeScore,
} from './write-functions.js';

// D1Database type from @cloudflare/workers-types
type D1Database = {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
};
type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(column?: string): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
};
type D1Result<T = unknown> = {
  results: T[];
  success: boolean;
  meta: Record<string, unknown>;
};

export class D1StorageAdapter implements RelayStorageAdapter {
  constructor(private readonly db: D1Database) {}

  // --- Registration (Tree 1) ---

  async findLeaf(leafHex: string): Promise<number | null> {
    const normalized = leafHex.startsWith('0x') ? leafHex.slice(2) : leafHex;
    const row = await this.db
      .prepare('SELECT leaf_index FROM registration_leaves WHERE leaf_hex = ? AND is_empty = 0')
      .bind(normalized)
      .first<{ leaf_index: number }>();
    return row?.leaf_index ?? null;
  }

  async getTreeSize(): Promise<number> {
    const row = await this.db
      .prepare("SELECT value FROM tree_metadata WHERE key = 'tree_size'")
      .first<{ value: string }>();
    return parseInt(row?.value ?? '0', 10);
  }

  async getTreeCapacity(): Promise<number> {
    const row = await this.db
      .prepare("SELECT value FROM tree_metadata WHERE key = 'tree_capacity'")
      .first<{ value: string }>();
    return parseInt(row?.value ?? '1048576', 10);
  }

  async insertLeaf(leafHex: string, attestationHash?: string): Promise<number> {
    const normalized = leafHex.startsWith('0x') ? leafHex.slice(2) : leafHex;
    const treeSize = await this.getTreeSize();
    const leafIndex = treeSize;

    // Batch: WAL entry + leaf record + tree size update
    await this.db.batch([
      this.db
        .prepare('INSERT INTO insertion_log (leaf_hex, leaf_index, entry_type, attestation_hash) VALUES (?, ?, ?, ?)')
        .bind(normalized, leafIndex, 'insert', attestationHash ?? null),
      this.db
        .prepare('INSERT INTO registration_leaves (leaf_index, leaf_hex, attestation_hash) VALUES (?, ?, ?)')
        .bind(leafIndex, normalized, attestationHash ?? null),
      this.db
        .prepare("UPDATE tree_metadata SET value = ? WHERE key = 'tree_size'")
        .bind(String(leafIndex + 1)),
    ]);

    return leafIndex;
  }

  async replaceLeaf(oldLeafIndex: number, newLeafHex: string, attestationHash?: string): Promise<number> {
    const normalized = newLeafHex.startsWith('0x') ? newLeafHex.slice(2) : newLeafHex;
    const treeSize = await this.getTreeSize();
    const newLeafIndex = treeSize;

    // Batch: WAL entry + zero old leaf + insert new leaf + tree size update
    await this.db.batch([
      this.db
        .prepare('INSERT INTO insertion_log (leaf_hex, leaf_index, entry_type, old_index, attestation_hash) VALUES (?, ?, ?, ?, ?)')
        .bind(normalized, newLeafIndex, 'replace', oldLeafIndex, attestationHash ?? null),
      this.db
        .prepare('UPDATE registration_leaves SET is_empty = 1 WHERE leaf_index = ?')
        .bind(oldLeafIndex),
      this.db
        .prepare('INSERT INTO registration_leaves (leaf_index, leaf_hex, attestation_hash) VALUES (?, ?, ?)')
        .bind(newLeafIndex, normalized, attestationHash ?? null),
      this.db
        .prepare("UPDATE tree_metadata SET value = ? WHERE key = 'tree_size'")
        .bind(String(newLeafIndex + 1)),
    ]);

    return newLeafIndex;
  }

  async getLeafAt(index: number): Promise<{ leaf: string; isEmpty: boolean } | null> {
    const row = await this.db
      .prepare('SELECT leaf_hex, is_empty FROM registration_leaves WHERE leaf_index = ?')
      .bind(index)
      .first<{ leaf_hex: string; is_empty: number }>();
    if (!row) return null;
    return { leaf: '0x' + row.leaf_hex, isEmpty: row.is_empty === 1 };
  }

  // --- Idempotency ---

  async getIdempotencyResult(key: string): Promise<unknown | null> {
    const row = await this.db
      .prepare('SELECT result, expires_at FROM idempotency_cache WHERE key = ?')
      .bind(key)
      .first<{ result: string; expires_at: number }>();
    if (!row || Date.now() >= row.expires_at) return null;
    return JSON.parse(row.result);
  }

  async setIdempotencyResult(key: string, result: unknown, ttlMs = 3600000): Promise<void> {
    const expiresAt = Date.now() + ttlMs;
    await this.db
      .prepare('INSERT OR REPLACE INTO idempotency_cache (key, result, expires_at) VALUES (?, ?, ?)')
      .bind(key, JSON.stringify(result), expiresAt)
      .run();
  }

  // --- Engagement (Tree 3) ---

  async isIdentityRegistered(identityCommitmentHex: string): Promise<boolean> {
    const row = await this.db
      .prepare('SELECT 1 FROM engagement_identities WHERE identity_commitment = ?')
      .bind(identityCommitmentHex)
      .first();
    return row !== null;
  }

  async isSignerRegistered(signerAddress: string): Promise<boolean> {
    const row = await this.db
      .prepare('SELECT 1 FROM engagement_identities WHERE signer_address = ?')
      .bind(signerAddress.toLowerCase())
      .first();
    return row !== null;
  }

  async registerEngagementIdentity(
    signerAddress: string,
    identityCommitmentHex: string,
  ): Promise<number> {
    // Get next leaf index from engagement tree size
    const row = await this.db
      .prepare('SELECT COUNT(*) as count FROM engagement_identities')
      .first<{ count: number }>();
    const leafIndex = row?.count ?? 0;

    await this.db
      .prepare(
        'INSERT INTO engagement_identities (leaf_index, identity_commitment, signer_address) VALUES (?, ?, ?)'
      )
      .bind(leafIndex, identityCommitmentHex, signerAddress.toLowerCase())
      .run();

    return leafIndex;
  }

  async getEngagementMetrics(identityCommitmentHex: string): Promise<EngagementRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM engagement_identities WHERE identity_commitment = ?')
      .bind(identityCommitmentHex)
      .first<{
        leaf_index: number;
        identity_commitment: string;
        signer_address: string;
        tier: number;
        action_count: number;
        diversity_score: number;
        tenure_months: number;
        adoption_count: number;
        registered_at: number;
      }>();
    if (!row) return null;

    return {
      identityCommitment: '0x' + row.identity_commitment,
      signerAddress: row.signer_address,
      leafIndex: row.leaf_index,
      tier: row.tier as 0 | 1 | 2 | 3 | 4,
      actionCount: row.action_count,
      diversityScore: row.diversity_score,
      tenureMonths: row.tenure_months,
      registeredAt: row.registered_at,
    };
  }

  async getEngagementMetricsBySigner(signerAddress: string): Promise<EngagementRecord | null> {
    const row = await this.db
      .prepare('SELECT identity_commitment FROM engagement_identities WHERE signer_address = ?')
      .bind(signerAddress.toLowerCase())
      .first<{ identity_commitment: string }>();
    if (!row) return null;
    return this.getEngagementMetrics(row.identity_commitment);
  }

  async getEngagementBreakdown(identityCommitmentHex: string): Promise<EngagementBreakdownResult | null> {
    const record = await this.getEngagementMetrics(identityCommitmentHex);
    if (!record) return null;

    const shannonH = record.diversityScore / 1000;
    const compositeScore = computeCompositeScore(
      record.actionCount, shannonH, record.tenureMonths, 0,
    );

    const actionFactor = record.actionCount === 0 ? 0 : Math.log2(1 + record.actionCount);
    const diversityFactor = 1 + shannonH;
    const tenureFactor = 1 + Math.sqrt(record.tenureMonths / 12);
    const adoptionFactor = 1;

    return {
      identityCommitment: record.identityCommitment,
      currentTier: record.tier,
      compositeScore: Math.round(compositeScore * 1000) / 1000,
      metrics: {
        actionCount: record.actionCount,
        diversityScore: record.diversityScore,
        shannonH: Math.round(shannonH * 1000) / 1000,
        tenureMonths: record.tenureMonths,
        adoptionCount: 0,
      },
      factors: {
        action: Math.round(actionFactor * 1000) / 1000,
        diversity: Math.round(diversityFactor * 1000) / 1000,
        tenure: Math.round(tenureFactor * 1000) / 1000,
        adoption: Math.round(adoptionFactor * 1000) / 1000,
      },
      tierBoundaries: TIER_BOUNDARIES,
      leafIndex: record.leafIndex,
    };
  }
}
