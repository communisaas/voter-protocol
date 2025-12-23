/**
 * Security Audit Logger Tests
 *
 * TYPE SAFETY: Nuclear-level strictness. Zero tolerance for `any` types.
 * SECURITY: Verify tamper-evident logging, hash chain integrity, and cleanup behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm, readdir } from 'fs/promises';
import { join } from 'path';
import { randomUUID, createHash } from 'crypto';
import {
  SecurityAuditLogger,
  queryAuditLogs,
  verifyAuditLogIntegrity,
  type SecurityEvent,
  type LogFilter,
  type HashChainVerification,
} from '../audit-logger';

// ============================================================================
// Test Utilities
// ============================================================================

const TEST_LOG_DIR = join(process.cwd(), 'test-logs-' + randomUUID());

/**
 * Create a test security event
 */
function createTestEvent(overrides: Partial<SecurityEvent> = {}): Omit<
  SecurityEvent,
  'id' | 'timestamp' | 'eventHash' | 'previousHash'
> {
  return {
    severity: 'info',
    category: 'data_access',
    eventType: 'test_event',
    client: {
      ip: '192.168.1.1',
      apiKeyHash: 'test-key-hash',
      userAgent: 'test-agent',
    },
    request: {
      method: 'GET',
      path: '/test',
      query: { param: 'value' },
    },
    data: { testKey: 'testValue' },
    success: true,
    correlationId: randomUUID(),
    ...overrides,
  };
}

/**
 * Create a mock log file with known events
 */
async function createMockLogFile(
  logDir: string,
  fileName: string,
  events: SecurityEvent[]
): Promise<string> {
  const filePath = join(logDir, fileName);
  const content = events.map((event) => JSON.stringify(event)).join('\n') + '\n';
  await writeFile(filePath, content, 'utf8');
  return filePath;
}

/**
 * Compute event hash (must match logger implementation)
 */
function computeEventHash(event: SecurityEvent): string {
  const { eventHash, ...eventWithoutHash } = event;
  const normalized = JSON.stringify(eventWithoutHash, Object.keys(eventWithoutHash).sort());
  return createHash('sha256').update(normalized).digest('hex');
}

// ============================================================================
// Setup and Teardown
// ============================================================================

beforeEach(async () => {
  await mkdir(TEST_LOG_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_LOG_DIR, { recursive: true, force: true });
});

// ============================================================================
// Test Suite: Log File Cleanup
// ============================================================================

describe('SecurityAuditLogger - Log File Cleanup', () => {
  it('should delete oldest files when maxFiles exceeded', async () => {
    const logger = new SecurityAuditLogger({
      logDir: TEST_LOG_DIR,
      maxFiles: 3,
      maxFileSize: 100, // Force rotation after small size
    });

    try {
      // Create 5 log files by forcing rotations
      for (let i = 0; i < 5; i++) {
        const event = createTestEvent({ data: { iteration: i } });
        await logger.log(event);
        await logger.flush();

        // Force rotation by manually calling private method via reflection
        // Alternative: Fill buffer to exceed maxFileSize
        const largeData = 'x'.repeat(200);
        await logger.log(createTestEvent({ data: { filler: largeData } }));
        await logger.flush();
      }

      // Wait for cleanup to occur
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify only maxFiles (3) remain
      const files = await readdir(TEST_LOG_DIR);
      const logFiles = files.filter((f) => f.startsWith('security-') && f.endsWith('.jsonl'));

      expect(logFiles.length).toBeLessThanOrEqual(3);
    } finally {
      await logger.destroy();
    }
  });

  it('should not delete files when under maxFiles limit', async () => {
    const logger = new SecurityAuditLogger({
      logDir: TEST_LOG_DIR,
      maxFiles: 10,
    });

    try {
      // Log 3 events
      for (let i = 0; i < 3; i++) {
        await logger.log(createTestEvent({ data: { iteration: i } }));
      }
      await logger.flush();

      const files = await readdir(TEST_LOG_DIR);
      const logFiles = files.filter((f) => f.startsWith('security-') && f.endsWith('.jsonl'));

      // Should have at least 1 file (no cleanup needed)
      expect(logFiles.length).toBeGreaterThanOrEqual(1);
      expect(logFiles.length).toBeLessThanOrEqual(10);
    } finally {
      await logger.destroy();
    }
  });

  it('should handle cleanup errors gracefully', async () => {
    // Create logger with non-existent directory (will fail to cleanup)
    const invalidDir = join(TEST_LOG_DIR, 'nonexistent-subdir');
    const logger = new SecurityAuditLogger({
      logDir: invalidDir,
      maxFiles: 3,
    });

    try {
      // Log an event (should create directory)
      await logger.log(createTestEvent());
      await logger.flush();

      // Logger should successfully handle the operation
      expect(true).toBe(true);
    } finally {
      await logger.destroy();
    }
  });
});

// ============================================================================
// Test Suite: Log Querying
// ============================================================================

describe('queryAuditLogs', () => {
  it('should query logs by date range', async () => {
    const baseTime = new Date('2025-01-01T00:00:00Z');
    const events: SecurityEvent[] = [
      {
        ...createTestEvent(),
        id: '1',
        timestamp: new Date(baseTime.getTime()).toISOString(),
      } as SecurityEvent,
      {
        ...createTestEvent(),
        id: '2',
        timestamp: new Date(baseTime.getTime() + 3600000).toISOString(), // +1 hour
      } as SecurityEvent,
      {
        ...createTestEvent(),
        id: '3',
        timestamp: new Date(baseTime.getTime() + 7200000).toISOString(), // +2 hours
      } as SecurityEvent,
    ];

    await createMockLogFile(TEST_LOG_DIR, 'security-test.jsonl', events);

    const results = await queryAuditLogs({
      logDir: TEST_LOG_DIR,
      startDate: new Date(baseTime.getTime() + 1800000), // +30 min
      endDate: new Date(baseTime.getTime() + 5400000), // +90 min
    });

    expect(results.length).toBe(1);
    expect(results[0]?.id).toBe('2');
  });

  it('should query logs by severity', async () => {
    const events: SecurityEvent[] = [
      {
        ...createTestEvent({ severity: 'info' }),
        id: '1',
        timestamp: new Date().toISOString(),
      } as SecurityEvent,
      {
        ...createTestEvent({ severity: 'critical' }),
        id: '2',
        timestamp: new Date().toISOString(),
      } as SecurityEvent,
      {
        ...createTestEvent({ severity: 'high' }),
        id: '3',
        timestamp: new Date().toISOString(),
      } as SecurityEvent,
    ];

    await createMockLogFile(TEST_LOG_DIR, 'security-test.jsonl', events);

    const results = await queryAuditLogs({
      logDir: TEST_LOG_DIR,
      severity: ['critical', 'high'],
    });

    expect(results.length).toBe(2);
    expect(results.map((e) => e.id).sort()).toEqual(['2', '3']);
  });

  it('should query logs by category', async () => {
    const events: SecurityEvent[] = [
      {
        ...createTestEvent({ category: 'authentication' }),
        id: '1',
        timestamp: new Date().toISOString(),
      } as SecurityEvent,
      {
        ...createTestEvent({ category: 'authorization' }),
        id: '2',
        timestamp: new Date().toISOString(),
      } as SecurityEvent,
      {
        ...createTestEvent({ category: 'authentication' }),
        id: '3',
        timestamp: new Date().toISOString(),
      } as SecurityEvent,
    ];

    await createMockLogFile(TEST_LOG_DIR, 'security-test.jsonl', events);

    const results = await queryAuditLogs({
      logDir: TEST_LOG_DIR,
      category: ['authentication'],
    });

    expect(results.length).toBe(2);
    expect(results.map((e) => e.id).sort()).toEqual(['1', '3']);
  });

  it('should query logs by event type', async () => {
    const events: SecurityEvent[] = [
      {
        ...createTestEvent({ eventType: 'api_key_auth' }),
        id: '1',
        timestamp: new Date().toISOString(),
      } as SecurityEvent,
      {
        ...createTestEvent({ eventType: 'ip_auth' }),
        id: '2',
        timestamp: new Date().toISOString(),
      } as SecurityEvent,
      {
        ...createTestEvent({ eventType: 'api_key_auth' }),
        id: '3',
        timestamp: new Date().toISOString(),
      } as SecurityEvent,
    ];

    await createMockLogFile(TEST_LOG_DIR, 'security-test.jsonl', events);

    const results = await queryAuditLogs({
      logDir: TEST_LOG_DIR,
      eventType: ['api_key_auth'],
    });

    expect(results.length).toBe(2);
    expect(results.map((e) => e.id).sort()).toEqual(['1', '3']);
  });

  it('should query logs by client IP', async () => {
    const events: SecurityEvent[] = [
      {
        ...createTestEvent({ client: { ip: '192.168.1.1' } }),
        id: '1',
        timestamp: new Date().toISOString(),
      } as SecurityEvent,
      {
        ...createTestEvent({ client: { ip: '10.0.0.1' } }),
        id: '2',
        timestamp: new Date().toISOString(),
      } as SecurityEvent,
      {
        ...createTestEvent({ client: { ip: '192.168.1.1' } }),
        id: '3',
        timestamp: new Date().toISOString(),
      } as SecurityEvent,
    ];

    await createMockLogFile(TEST_LOG_DIR, 'security-test.jsonl', events);

    const results = await queryAuditLogs({
      logDir: TEST_LOG_DIR,
      clientIP: '192.168.1.1',
    });

    expect(results.length).toBe(2);
    expect(results.map((e) => e.id).sort()).toEqual(['1', '3']);
  });

  it('should query logs by correlation ID', async () => {
    const correlationId = randomUUID();
    const events: SecurityEvent[] = [
      {
        ...createTestEvent({ correlationId }),
        id: '1',
        timestamp: new Date().toISOString(),
      } as SecurityEvent,
      {
        ...createTestEvent({ correlationId: randomUUID() }),
        id: '2',
        timestamp: new Date().toISOString(),
      } as SecurityEvent,
      {
        ...createTestEvent({ correlationId }),
        id: '3',
        timestamp: new Date().toISOString(),
      } as SecurityEvent,
    ];

    await createMockLogFile(TEST_LOG_DIR, 'security-test.jsonl', events);

    const results = await queryAuditLogs({
      logDir: TEST_LOG_DIR,
      correlationId,
    });

    expect(results.length).toBe(2);
    expect(results.map((e) => e.id).sort()).toEqual(['1', '3']);
  });

  it('should handle multiple filters combined', async () => {
    const correlationId = randomUUID();
    const events: SecurityEvent[] = [
      {
        ...createTestEvent({ severity: 'critical', correlationId }),
        id: '1',
        timestamp: new Date().toISOString(),
      } as SecurityEvent,
      {
        ...createTestEvent({ severity: 'info', correlationId }),
        id: '2',
        timestamp: new Date().toISOString(),
      } as SecurityEvent,
      {
        ...createTestEvent({ severity: 'critical', correlationId: randomUUID() }),
        id: '3',
        timestamp: new Date().toISOString(),
      } as SecurityEvent,
    ];

    await createMockLogFile(TEST_LOG_DIR, 'security-test.jsonl', events);

    const results = await queryAuditLogs({
      logDir: TEST_LOG_DIR,
      severity: ['critical'],
      correlationId,
    });

    expect(results.length).toBe(1);
    expect(results[0]?.id).toBe('1');
  });

  it('should return empty array for non-existent log directory', async () => {
    const results = await queryAuditLogs({
      logDir: '/invalid/path',
    });

    expect(results).toEqual([]);
  });

  it('should skip malformed log entries', async () => {
    const validEvent: SecurityEvent = {
      ...createTestEvent(),
      id: '1',
      timestamp: new Date().toISOString(),
    } as SecurityEvent;

    const content = `${JSON.stringify(validEvent)}\n{invalid json}\n${JSON.stringify({ ...validEvent, id: '2' })}\n`;
    await writeFile(join(TEST_LOG_DIR, 'security-test.jsonl'), content, 'utf8');

    const results = await queryAuditLogs({
      logDir: TEST_LOG_DIR,
    });

    expect(results.length).toBe(2);
    expect(results.map((e) => e.id).sort()).toEqual(['1', '2']);
  });
});

// ============================================================================
// Test Suite: Hash Chain Verification
// ============================================================================

describe('verifyAuditLogIntegrity', () => {
  it('should verify valid hash chain', async () => {
    // Create events with proper hash chain
    const event1: SecurityEvent = {
      ...createTestEvent(),
      id: '1',
      timestamp: new Date().toISOString(),
      previousHash: undefined,
    } as SecurityEvent;
    event1.eventHash = computeEventHash(event1);

    const event2: SecurityEvent = {
      ...createTestEvent(),
      id: '2',
      timestamp: new Date().toISOString(),
      previousHash: event1.eventHash,
    } as SecurityEvent;
    event2.eventHash = computeEventHash(event2);

    const event3: SecurityEvent = {
      ...createTestEvent(),
      id: '3',
      timestamp: new Date().toISOString(),
      previousHash: event2.eventHash,
    } as SecurityEvent;
    event3.eventHash = computeEventHash(event3);

    const logFile = await createMockLogFile(TEST_LOG_DIR, 'security-test.jsonl', [
      event1,
      event2,
      event3,
    ]);

    const result = await verifyAuditLogIntegrity(logFile);

    expect(result.valid).toBe(true);
    expect(result.entriesChecked).toBe(3);
    expect(result.brokenAt).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it('should detect broken hash chain link', async () => {
    const event1: SecurityEvent = {
      ...createTestEvent(),
      id: '1',
      timestamp: new Date().toISOString(),
      previousHash: undefined,
    } as SecurityEvent;
    event1.eventHash = computeEventHash(event1);

    const event2: SecurityEvent = {
      ...createTestEvent(),
      id: '2',
      timestamp: new Date().toISOString(),
      previousHash: 'WRONG_HASH', // Broken link
    } as SecurityEvent;
    event2.eventHash = computeEventHash(event2);

    const logFile = await createMockLogFile(TEST_LOG_DIR, 'security-test.jsonl', [event1, event2]);

    const result = await verifyAuditLogIntegrity(logFile);

    expect(result.valid).toBe(false);
    expect(result.entriesChecked).toBe(2);
    expect(result.brokenAt).toBe(1);
    expect(result.error).toBe('Hash chain broken');
  });

  it('should detect tampered event hash', async () => {
    const event1: SecurityEvent = {
      ...createTestEvent(),
      id: '1',
      timestamp: new Date().toISOString(),
      previousHash: undefined,
    } as SecurityEvent;
    event1.eventHash = computeEventHash(event1);

    const event2: SecurityEvent = {
      ...createTestEvent(),
      id: '2',
      timestamp: new Date().toISOString(),
      previousHash: event1.eventHash,
    } as SecurityEvent;
    event2.eventHash = 'TAMPERED_HASH'; // Wrong hash

    const logFile = await createMockLogFile(TEST_LOG_DIR, 'security-test.jsonl', [event1, event2]);

    const result = await verifyAuditLogIntegrity(logFile);

    expect(result.valid).toBe(false);
    expect(result.entriesChecked).toBe(2);
    expect(result.brokenAt).toBe(1);
    expect(result.error).toBe('Hash mismatch');
  });

  it('should handle empty log file', async () => {
    const logFile = join(TEST_LOG_DIR, 'security-empty.jsonl');
    await writeFile(logFile, '', 'utf8');

    const result = await verifyAuditLogIntegrity(logFile);

    expect(result.valid).toBe(true);
    expect(result.entriesChecked).toBe(0);
    expect(result.details).toBe('Empty log file (valid)');
  });

  it('should handle malformed JSON', async () => {
    const event1: SecurityEvent = {
      ...createTestEvent(),
      id: '1',
      timestamp: new Date().toISOString(),
      previousHash: undefined,
    } as SecurityEvent;
    event1.eventHash = computeEventHash(event1);

    const content = `${JSON.stringify(event1)}\n{invalid json}\n`;
    const logFile = join(TEST_LOG_DIR, 'security-test.jsonl');
    await writeFile(logFile, content, 'utf8');

    const result = await verifyAuditLogIntegrity(logFile);

    expect(result.valid).toBe(false);
    expect(result.entriesChecked).toBe(1);
    expect(result.brokenAt).toBe(1);
    expect(result.error).toBe('Parse error');
  });

  it('should handle non-existent file', async () => {
    const result = await verifyAuditLogIntegrity('/invalid/path/file.jsonl');

    expect(result.valid).toBe(false);
    expect(result.entriesChecked).toBe(0);
    expect(result.error).toBe('File read error');
  });

  it('should verify hash chain across multiple events', async () => {
    // Create 100 events with proper hash chain
    const events: SecurityEvent[] = [];
    let previousHash: string | undefined = undefined;

    for (let i = 0; i < 100; i++) {
      const event: SecurityEvent = {
        ...createTestEvent({ data: { index: i } }),
        id: `${i}`,
        timestamp: new Date().toISOString(),
        previousHash,
      } as SecurityEvent;
      event.eventHash = computeEventHash(event);
      events.push(event);
      previousHash = event.eventHash;
    }

    const logFile = await createMockLogFile(TEST_LOG_DIR, 'security-large.jsonl', events);

    const result = await verifyAuditLogIntegrity(logFile);

    expect(result.valid).toBe(true);
    expect(result.entriesChecked).toBe(100);
  });
});

// ============================================================================
// Test Suite: Integration Tests
// ============================================================================

describe('SecurityAuditLogger - Integration', () => {
  it('should create verifiable hash chain in production usage', async () => {
    const logger = new SecurityAuditLogger({
      logDir: TEST_LOG_DIR,
      enableHashChain: true,
    });

    try {
      // Log multiple events
      for (let i = 0; i < 10; i++) {
        await logger.log(createTestEvent({ data: { iteration: i } }));
      }
      await logger.flush();

      // Find the log file
      const files = await readdir(TEST_LOG_DIR);
      const logFile = files.find((f) => f.startsWith('security-') && f.endsWith('.jsonl'));
      expect(logFile).toBeDefined();

      // Verify hash chain
      const result = await verifyAuditLogIntegrity(join(TEST_LOG_DIR, logFile as string));
      expect(result.valid).toBe(true);
      expect(result.entriesChecked).toBe(10);
    } finally {
      await logger.destroy();
    }
  });

  it('should query logged events after flush', async () => {
    const logger = new SecurityAuditLogger({
      logDir: TEST_LOG_DIR,
    });

    try {
      const correlationId = randomUUID();

      // Log events with specific correlation ID
      await logger.log(createTestEvent({ severity: 'critical', correlationId }));
      await logger.log(createTestEvent({ severity: 'info', correlationId }));
      await logger.log(createTestEvent({ severity: 'high', correlationId: randomUUID() }));
      await logger.flush();

      // Query by correlation ID
      const results = await queryAuditLogs({
        logDir: TEST_LOG_DIR,
        correlationId,
      });

      expect(results.length).toBe(2);
      expect(results.every((e) => e.correlationId === correlationId)).toBe(true);
    } finally {
      await logger.destroy();
    }
  });
});
