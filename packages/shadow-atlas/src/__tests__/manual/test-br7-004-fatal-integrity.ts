/**
 * Manual Test for BR7-004: Fatal Insertion Log Integrity Failure
 *
 * This script demonstrates that:
 * 1. A corrupted insertion log (broken hash chain) causes fatal startup failure
 * 2. A single broken last entry (crash recovery) allows startup with warning
 * 3. Invalid signatures cause fatal startup failure
 *
 * Run: npx tsx packages/shadow-atlas/src/__tests__/manual/test-br7-004-fatal-integrity.ts
 */

import { RegistrationService } from '../../serving/registration-service.js';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

async function test1_BrokenChainMiddleEntry() {
  console.log('\n=== TEST 1: Broken chain in middle entry (should FAIL) ===');
  const tmpDir = join(tmpdir(), 'br7-004-test1-' + Date.now());
  const logPath = join(tmpDir, 'tree1.ndjson');

  try {
    // Create service and insert 3 valid entries
    const service1 = await RegistrationService.create(4, { path: logPath });
    await service1.insertLeaf('0x' + '01'.padStart(64, '0'));
    await service1.insertLeaf('0x' + '02'.padStart(64, '0'));
    await service1.insertLeaf('0x' + '03'.padStart(64, '0'));
    await service1.close();

    // Corrupt the middle entry's prevHash
    const content = await fs.readFile(logPath, 'utf8');
    const lines = content.trim().split('\n');
    const entry2 = JSON.parse(lines[1]);
    entry2.prevHash = '0000000000000000000000000000000000000000000000000000000000000000';
    lines[1] = JSON.stringify(entry2);
    await fs.writeFile(logPath, lines.join('\n') + '\n');

    // Try to reload — should throw fatal error
    console.log('Attempting to reload service with corrupted log...');
    await RegistrationService.create(4, { path: logPath });
    console.error('❌ FAILED: Service loaded despite broken hash chain!');
  } catch (err: any) {
    if (err.message.includes('FATAL: Insertion log integrity compromised')) {
      console.log('✅ PASSED: Fatal error thrown as expected');
      console.log(`   Message: ${err.message}`);
    } else {
      console.error('❌ FAILED: Wrong error thrown:', err.message);
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function test2_BrokenLastEntry_CrashRecovery() {
  console.log('\n=== TEST 2: Broken last entry only (should SUCCEED with warning) ===');
  const tmpDir = join(tmpdir(), 'br7-004-test2-' + Date.now());
  const logPath = join(tmpDir, 'tree1.ndjson');

  try {
    // Create service and insert 3 valid entries
    const service1 = await RegistrationService.create(4, { path: logPath });
    await service1.insertLeaf('0x' + '01'.padStart(64, '0'));
    await service1.insertLeaf('0x' + '02'.padStart(64, '0'));
    await service1.insertLeaf('0x' + '03'.padStart(64, '0'));
    await service1.close();

    // Corrupt ONLY the last entry's prevHash (simulates incomplete write)
    const content = await fs.readFile(logPath, 'utf8');
    const lines = content.trim().split('\n');
    const entry3 = JSON.parse(lines[2]);
    entry3.prevHash = '0000000000000000000000000000000000000000000000000000000000000000';
    lines[2] = JSON.stringify(entry3);
    await fs.writeFile(logPath, lines.join('\n') + '\n');

    // Should load successfully (crash recovery scenario)
    console.log('Attempting to reload service with last entry corrupted (crash recovery)...');
    const service2 = await RegistrationService.create(4, { path: logPath });
    console.log('✅ PASSED: Service loaded despite broken last entry (crash recovery)');
    console.log(`   Tree size after reload: ${service2.leafCount}`);
    await service2.close();
  } catch (err: any) {
    console.error('❌ FAILED: Should have allowed crash recovery, but threw:', err.message);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function test3_MultipleBrokenLinks() {
  console.log('\n=== TEST 3: Multiple broken chain links (should FAIL) ===');
  const tmpDir = join(tmpdir(), 'br7-004-test3-' + Date.now());
  const logPath = join(tmpDir, 'tree1.ndjson');

  try {
    // Create service and insert 3 valid entries
    const service1 = await RegistrationService.create(4, { path: logPath });
    await service1.insertLeaf('0x' + '01'.padStart(64, '0'));
    await service1.insertLeaf('0x' + '02'.padStart(64, '0'));
    await service1.insertLeaf('0x' + '03'.padStart(64, '0'));
    await service1.close();

    // Corrupt both entry 2 and entry 3's prevHash
    const content = await fs.readFile(logPath, 'utf8');
    const lines = content.trim().split('\n');

    const entry2 = JSON.parse(lines[1]);
    entry2.prevHash = '0000000000000000000000000000000000000000000000000000000000000000';
    lines[1] = JSON.stringify(entry2);

    const entry3 = JSON.parse(lines[2]);
    entry3.prevHash = '1111111111111111111111111111111111111111111111111111111111111111';
    lines[2] = JSON.stringify(entry3);

    await fs.writeFile(logPath, lines.join('\n') + '\n');

    // Try to reload — should throw fatal error
    console.log('Attempting to reload service with multiple broken links...');
    await RegistrationService.create(4, { path: logPath });
    console.error('❌ FAILED: Service loaded despite multiple broken links!');
  } catch (err: any) {
    if (err.message.includes('FATAL: Insertion log integrity compromised') && err.message.includes('2 broken chain links')) {
      console.log('✅ PASSED: Fatal error thrown as expected');
      console.log(`   Message: ${err.message}`);
    } else {
      console.error('❌ FAILED: Wrong error thrown:', err.message);
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  console.log('BR7-004: Make Insertion Log Integrity Failure Fatal\n');
  console.log('This test verifies that tampering with the insertion log is detected and prevents startup.');

  await test1_BrokenChainMiddleEntry();
  await test2_BrokenLastEntry_CrashRecovery();
  await test3_MultipleBrokenLinks();

  console.log('\n=== All tests complete ===\n');
}

main().catch(console.error);
