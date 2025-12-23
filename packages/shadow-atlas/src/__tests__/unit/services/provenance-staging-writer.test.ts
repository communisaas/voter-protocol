/**
 * Provenance Staging Writer - Zero-Contention Test Suite
 *
 * PURPOSE: Verify 100+ concurrent writes without failures
 * CRITICAL: Staging must handle massive parallelism (true zero lock contention)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  appendToStaging,
  getStagingFiles,
  readStagingEntries,
  clearStagingFiles,
} from '../../../services/provenance-staging-writer.js';
import type { ProvenanceEntry } from '../../../services/provenance-writer.js';

// Test constants
const TEST_STAGING_DIR = './test-staging';

/**
 * Helper: Create sample provenance entry
 */
function createSampleEntry(fips: string, agentId: string): ProvenanceEntry {
  return {
    f: fips,
    n: 'Test City',
    s: 'CA',
    p: 100000,
    g: 1,
    fc: 9,
    conf: 85,
    auth: 3,
    src: 'test',
    url: 'https://test.com',
    q: { v: true, t: 1, r: 100 },
    why: ['Test reason'],
    tried: [0, 1],
    blocked: null,
    ts: new Date().toISOString(),
    aid: agentId,
  };
}

describe('Provenance Staging Writer', () => {
  beforeEach(async () => {
    // Clean up test directory before each test
    try {
      await fs.rm(TEST_STAGING_DIR, { recursive: true });
    } catch {
      // Directory doesn't exist
    }
  });

  afterEach(async () => {
    // Clean up test directory after each test
    try {
      await fs.rm(TEST_STAGING_DIR, { recursive: true });
    } catch {
      // Directory doesn't exist
    }
  });

  it('should create staging directory on first write', async () => {
    const entry = createSampleEntry('0666000', 'agt-001');
    await appendToStaging(entry, 'agt-001', TEST_STAGING_DIR);

    const stat = await fs.stat(TEST_STAGING_DIR);
    expect(stat.isDirectory()).toBe(true);
  });

  it('should write entry to unique staging file', async () => {
    const entry = createSampleEntry('0666000', 'agt-001');
    await appendToStaging(entry, 'agt-001', TEST_STAGING_DIR);

    const files = await getStagingFiles(TEST_STAGING_DIR);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/agt-001-\d+\.ndjson$/);
  });

  it('should handle 100+ concurrent writes without failures', async () => {
    const numAgents = 100;
    const numWritesPerAgent = 10;
    const totalWrites = numAgents * numWritesPerAgent;

    // Create 100 concurrent agents, each writing 10 entries
    const writes = [];
    for (let i = 0; i < numAgents; i++) {
      const agentId = `agt-${String(i).padStart(3, '0')}`;

      for (let j = 0; j < numWritesPerAgent; j++) {
        const fips = `06${String(j).padStart(5, '0')}`;
        const entry = createSampleEntry(fips, agentId);
        writes.push(appendToStaging(entry, agentId, TEST_STAGING_DIR));
      }
    }

    // Execute all writes in parallel
    const startTime = Date.now();
    await Promise.all(writes);
    const duration = Date.now() - startTime;

    console.log(
      `[Staging Test] ${totalWrites} writes in ${duration}ms (${(totalWrites / (duration / 1000)).toFixed(0)} writes/sec)`
    );

    // Verify all writes succeeded
    const entries = await readStagingEntries(TEST_STAGING_DIR);
    expect(entries.length).toBe(totalWrites);

    // Verify zero failures (all promises resolved)
    expect(writes.every((p) => p)).toBe(true);
  });

  it('should read all staging entries correctly', async () => {
    const entries = [
      createSampleEntry('0666000', 'agt-001'),
      createSampleEntry('0666001', 'agt-002'),
      createSampleEntry('0666002', 'agt-003'),
    ];

    // Write entries from different agents
    await Promise.all([
      appendToStaging(entries[0], 'agt-001', TEST_STAGING_DIR),
      appendToStaging(entries[1], 'agt-002', TEST_STAGING_DIR),
      appendToStaging(entries[2], 'agt-003', TEST_STAGING_DIR),
    ]);

    // Read all entries
    const readEntries = await readStagingEntries(TEST_STAGING_DIR);

    expect(readEntries.length).toBe(3);
    expect(readEntries.map((e) => e.f).sort()).toEqual(['0666000', '0666001', '0666002']);
  });

  it('should handle empty staging directory', async () => {
    const files = await getStagingFiles(TEST_STAGING_DIR);
    expect(files.length).toBe(0);

    const entries = await readStagingEntries(TEST_STAGING_DIR);
    expect(entries.length).toBe(0);
  });

  it('should clear staging files after successful merge', async () => {
    // Write some entries
    await Promise.all([
      appendToStaging(createSampleEntry('0666000', 'agt-001'), 'agt-001', TEST_STAGING_DIR),
      appendToStaging(createSampleEntry('0666001', 'agt-002'), 'agt-002', TEST_STAGING_DIR),
      appendToStaging(createSampleEntry('0666002', 'agt-003'), 'agt-003', TEST_STAGING_DIR),
    ]);

    // Verify files exist
    let files = await getStagingFiles(TEST_STAGING_DIR);
    expect(files.length).toBe(3);

    // Clear staging files
    await clearStagingFiles(TEST_STAGING_DIR);

    // Verify files are deleted
    files = await getStagingFiles(TEST_STAGING_DIR);
    expect(files.length).toBe(0);
  });

  it('should handle malformed entries gracefully', async () => {
    // Write a valid entry
    await appendToStaging(createSampleEntry('0666000', 'agt-001'), 'agt-001', TEST_STAGING_DIR);

    // Manually write a malformed entry
    const files = await getStagingFiles(TEST_STAGING_DIR);
    await fs.appendFile(files[0], 'invalid json\n', 'utf-8');

    // Read entries (should skip malformed)
    const entries = await readStagingEntries(TEST_STAGING_DIR);
    expect(entries.length).toBe(1); // Only valid entry
    expect(entries[0].f).toBe('0666000');
  });

  it('should create unique files per timestamp', async () => {
    const agentId = 'agt-001';
    const entry = createSampleEntry('0666000', agentId);

    // Write multiple entries rapidly from same agent
    // NOTE: Writes in same millisecond may use same file (this is fine - still lock-free)
    await Promise.all([
      appendToStaging(entry, agentId, TEST_STAGING_DIR),
      appendToStaging(entry, agentId, TEST_STAGING_DIR),
      appendToStaging(entry, agentId, TEST_STAGING_DIR),
    ]);

    // Should create at least 1 file (may be 1-3 depending on timing)
    const files = await getStagingFiles(TEST_STAGING_DIR);
    expect(files.length).toBeGreaterThanOrEqual(1);

    // But all 3 entries should be readable
    const entries = await readStagingEntries(TEST_STAGING_DIR);
    expect(entries.length).toBe(3);
  });

  it('should preserve entry structure exactly', async () => {
    const originalEntry = createSampleEntry('0666000', 'agt-001');
    await appendToStaging(originalEntry, 'agt-001', TEST_STAGING_DIR);

    const entries = await readStagingEntries(TEST_STAGING_DIR);
    expect(entries.length).toBe(1);

    const readEntry = entries[0];

    // Verify all fields match
    expect(readEntry.f).toBe(originalEntry.f);
    expect(readEntry.n).toBe(originalEntry.n);
    expect(readEntry.s).toBe(originalEntry.s);
    expect(readEntry.p).toBe(originalEntry.p);
    expect(readEntry.g).toBe(originalEntry.g);
    expect(readEntry.fc).toBe(originalEntry.fc);
    expect(readEntry.conf).toBe(originalEntry.conf);
    expect(readEntry.auth).toBe(originalEntry.auth);
    expect(readEntry.src).toBe(originalEntry.src);
    expect(readEntry.url).toBe(originalEntry.url);
    expect(readEntry.q).toEqual(originalEntry.q);
    expect(readEntry.why).toEqual(originalEntry.why);
    expect(readEntry.tried).toEqual(originalEntry.tried);
    expect(readEntry.blocked).toBe(originalEntry.blocked);
    expect(readEntry.ts).toBe(originalEntry.ts);
    expect(readEntry.aid).toBe(originalEntry.aid);
  });

  it('should demonstrate zero lock contention advantage', async () => {
    const numWrites = 200;

    // Staging mode: All writes in parallel (zero contention)
    const stagingWrites = Array.from({ length: numWrites }, (_, i) => {
      const agentId = `agt-${String(i).padStart(3, '0')}`;
      const entry = createSampleEntry(`0666${String(i).padStart(3, '0')}`, agentId);
      return appendToStaging(entry, agentId, TEST_STAGING_DIR);
    });

    const startTime = Date.now();
    await Promise.all(stagingWrites);
    const duration = Date.now() - startTime;

    console.log(
      `[Zero Contention] ${numWrites} writes in ${duration}ms (${(numWrites / (duration / 1000)).toFixed(0)} writes/sec)`
    );

    // Verify all writes succeeded
    const entries = await readStagingEntries(TEST_STAGING_DIR);
    expect(entries.length).toBe(numWrites);

    // CRITICAL: Duration should be minimal (no blocking)
    // Expect < 1 second for 200 writes
    expect(duration).toBeLessThan(1000);
  });
});
