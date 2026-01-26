#!/usr/bin/env tsx
/**
 * Audit Logger Demo
 *
 * Demonstrates the complete audit logging implementation:
 * 1. Log file cleanup
 * 2. Log querying
 * 3. Hash chain verification
 *
 * Run: tsx src/security/demo-audit-logger.ts
 */

import { randomUUID } from 'crypto';
import { rm } from 'fs/promises';
import { join } from 'path';
import {
  SecurityAuditLogger,
  queryAuditLogs,
  verifyAuditLogIntegrity,
  generateCorrelationId,
  type SecurityEvent,
} from '../src/security/audit-logger';

const DEMO_LOG_DIR = join(process.cwd(), 'demo-logs');

async function main(): Promise<void> {
  console.log('🔒 Shadow Atlas Security Audit Logger Demo\n');

  // ============================================================================
  // Setup
  // ============================================================================

  console.log('📁 Setting up demo environment...');
  await rm(DEMO_LOG_DIR, { recursive: true, force: true });

  const logger = new SecurityAuditLogger({
    logDir: DEMO_LOG_DIR,
    maxFileSize: 1024, // Small size to force rotation
    maxFiles: 3, // Keep only 3 log files
    enableHashChain: true,
  });

  // ============================================================================
  // 1. Demonstrate Tamper-Evident Logging
  // ============================================================================

  console.log('\n1️⃣  Logging Security Events with Hash Chain...\n');

  const correlationId1 = generateCorrelationId();
  const correlationId2 = generateCorrelationId();

  // Log various security events
  await logger.logAuthentication({
    success: true,
    client: {
      ip: '192.168.1.100',
      apiKeyHash: 'abc123',
      userAgent: 'Demo Client',
    },
    request: {
      method: 'POST',
      path: '/api/districts',
    },
    apiKeyProvided: true,
    correlationId: correlationId1,
  });

  await logger.logDataAccess({
    client: {
      ip: '192.168.1.100',
    },
    request: {
      method: 'GET',
      path: '/api/districts/CA-12',
    },
    resourceType: 'district',
    resourceId: 'CA-12',
    action: 'read',
    correlationId: correlationId1,
  });

  await logger.logValidationFailure({
    client: {
      ip: '10.0.0.50',
    },
    request: {
      method: 'POST',
      path: '/api/verify',
    },
    validationType: 'district_membership',
    validationError: 'Invalid proof',
    correlationId: correlationId2,
  });

  await logger.logSuspiciousActivity({
    client: {
      ip: '10.0.0.50',
    },
    request: {
      method: 'POST',
      path: '/api/verify',
    },
    suspicionType: 'repeated_failures',
    details: 'Multiple failed validations from same IP',
    riskScore: 0.85,
    correlationId: correlationId2,
  });

  await logger.logIntegrityViolation({
    client: {
      ip: '10.0.0.50',
    },
    request: {
      method: 'POST',
      path: '/api/verify',
    },
    violationType: 'proof_tampering',
    details: 'Proof signature mismatch',
    correlationId: correlationId2,
  });

  // Force flush to disk
  await logger.flush();

  console.log('✅ Logged 5 security events with hash chain');

  // ============================================================================
  // 2. Demonstrate Log Querying
  // ============================================================================

  console.log('\n2️⃣  Querying Audit Logs...\n');

  // Query all events
  const allEvents = await queryAuditLogs({
    logDir: DEMO_LOG_DIR,
  });
  console.log(`   📋 Total events logged: ${allEvents.length}`);

  // Query by severity
  const criticalEvents = await queryAuditLogs({
    logDir: DEMO_LOG_DIR,
    severity: ['critical', 'high'],
  });
  console.log(`   🚨 Critical/high severity events: ${criticalEvents.length}`);

  // Query by correlation ID
  const suspiciousRequest = await queryAuditLogs({
    logDir: DEMO_LOG_DIR,
    correlationId: correlationId2,
  });
  console.log(`   🔍 Events for suspicious request (${correlationId2.slice(0, 8)}...): ${suspiciousRequest.length}`);

  // Query by client IP
  const suspiciousIP = await queryAuditLogs({
    logDir: DEMO_LOG_DIR,
    clientIP: '10.0.0.50',
  });
  console.log(`   🌐 Events from suspicious IP (10.0.0.50): ${suspiciousIP.length}`);

  // Query by category
  const authEvents = await queryAuditLogs({
    logDir: DEMO_LOG_DIR,
    category: ['authentication'],
  });
  console.log(`   🔐 Authentication events: ${authEvents.length}`);

  // ============================================================================
  // 3. Demonstrate Hash Chain Verification
  // ============================================================================

  console.log('\n3️⃣  Verifying Hash Chain Integrity...\n');

  // Get the log file path
  const logFile = join(DEMO_LOG_DIR, allEvents[0]?.timestamp ? `security-${allEvents[0].timestamp.split('T')[0] ?? ''}.jsonl` : 'security.jsonl');

  // Find actual log file
  const { readdir } = await import('fs/promises');
  const files = await readdir(DEMO_LOG_DIR);
  const actualLogFile = files.find((f) => f.startsWith('security-') && f.endsWith('.jsonl'));

  if (actualLogFile) {
    const verification = await verifyAuditLogIntegrity(join(DEMO_LOG_DIR, actualLogFile));

    if (verification.valid) {
      console.log(`   ✅ Hash chain valid!`);
      console.log(`   📊 Entries checked: ${verification.entriesChecked}`);
      console.log(`   🔗 Hash chain integrity confirmed`);
    } else {
      console.log(`   ❌ Hash chain broken at entry ${verification.brokenAt}`);
      console.log(`   🐛 Error: ${verification.error}`);
      console.log(`   📝 Details: ${verification.details}`);
    }
  }

  // ============================================================================
  // 4. Demonstrate Log File Cleanup
  // ============================================================================

  console.log('\n4️⃣  Testing Log File Rotation & Cleanup...\n');

  // Log many events to force rotation
  console.log('   📝 Generating events to trigger rotation...');
  for (let i = 0; i < 10; i++) {
    const largeData = 'x'.repeat(200); // Force file size growth
    await logger.log({
      severity: 'info',
      category: 'system',
      eventType: 'test_rotation',
      client: { ip: '127.0.0.1' },
      request: { method: 'GET', path: '/test' },
      data: { iteration: i, filler: largeData },
      success: true,
    });
  }
  await logger.flush();

  // Check remaining files
  const filesAfterRotation = await readdir(DEMO_LOG_DIR);
  const logFilesAfter = filesAfterRotation.filter((f) => f.startsWith('security-') && f.endsWith('.jsonl'));

  console.log(`   📂 Log files after rotation: ${logFilesAfter.length}`);
  console.log(`   📏 Max files configured: 3`);
  console.log(`   ${logFilesAfter.length <= 3 ? '✅' : '❌'} Cleanup working correctly`);

  // ============================================================================
  // Cleanup
  // ============================================================================

  await logger.destroy();

  console.log('\n🎉 Demo Complete!\n');
  console.log('📖 Summary:');
  console.log('   ✅ Tamper-evident logging with hash chains');
  console.log('   ✅ Flexible log querying by multiple criteria');
  console.log('   ✅ Cryptographic integrity verification');
  console.log('   ✅ Automatic log rotation and cleanup');
  console.log(`\n📁 Demo logs stored in: ${DEMO_LOG_DIR}`);
  console.log('   Run again to see log rotation in action!\n');
}

main().catch((error) => {
  console.error('❌ Demo failed:', error);
  process.exit(1);
});
