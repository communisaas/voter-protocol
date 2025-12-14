/**
 * Change Detector - Usage Examples
 *
 * Demonstrates event-driven change detection for Shadow Atlas.
 * Shows how to avoid wasteful batch scraping.
 */

import { ChangeDetector } from './change-detector.js';
import { SQLiteAdapter } from '../db/sqlite-adapter.js';
import type { CanonicalSource } from './change-detector.js';

/**
 * Example 1: Daily Scheduled Check
 *
 * Run this daily to check sources that are due for verification.
 * Cost: $0 (HEAD requests only)
 */
export async function dailyScheduledCheck(): Promise<void> {
  const db = new SQLiteAdapter('./shadow-atlas.db');
  const detector = new ChangeDetector(db);

  console.log('🔍 Checking sources due for verification...');

  const changes = await detector.checkScheduledSources();

  console.log(`✅ Found ${changes.length} changed sources`);

  // Only download what changed
  for (const change of changes) {
    console.log(`📥 Downloading: ${change.url}`);
    console.log(`   Change type: ${change.changeType}`);
    console.log(`   Old checksum: ${change.oldChecksum || 'none'}`);
    console.log(`   New checksum: ${change.newChecksum}`);

    // TODO: Download and process the changed source
    // await downloadAndProcess(change.sourceId);

    // Update checksum after successful download
    // await detector.updateChecksum(change.sourceId, change.newChecksum);
  }

  await db.close();
}

/**
 * Example 2: Force Check After System Outage
 *
 * Run this after a system outage to catch any missed updates.
 * Use sparingly - checks all sources regardless of schedule.
 */
export async function forceCheckAll(): Promise<void> {
  const db = new SQLiteAdapter('./shadow-atlas.db');
  const detector = new ChangeDetector(db);

  console.log('⚠️  Force checking ALL sources (use sparingly)...');

  const changes = await detector.checkAllSources();

  console.log(`✅ Found ${changes.length} changed sources`);

  for (const change of changes) {
    console.log(`📥 Downloading: ${change.url}`);
    // ... download and update checksum
  }

  await db.close();
}

/**
 * Example 3: Check Single Source
 *
 * Test a specific source for changes.
 */
export async function checkSingleSource(sourceUrl: string): Promise<void> {
  const db = new SQLiteAdapter('./shadow-atlas.db');
  const detector = new ChangeDetector(db);

  // Create a test source
  const source: CanonicalSource = {
    id: 'test-1',
    url: sourceUrl,
    boundaryType: 'municipal',
    lastChecksum: null,
    lastChecked: null,
    nextScheduledCheck: new Date().toISOString(),
    updateTriggers: [
      { type: 'annual', month: 7 }, // Check in July
    ],
  };

  console.log(`🔍 Checking source: ${sourceUrl}`);

  const change = await detector.checkForChange(source);

  if (change) {
    console.log('✅ Source has changed!');
    console.log(`   Change type: ${change.changeType}`);
    console.log(`   New checksum: ${change.newChecksum}`);
  } else {
    console.log('✅ Source unchanged');
  }

  await db.close();
}

/**
 * Example 4: Redistricting Year Check
 *
 * Run this during redistricting years (2021-2022, 2031-2032, etc.)
 * to catch boundary updates.
 */
export async function redistrictingYearCheck(): Promise<void> {
  const db = new SQLiteAdapter('./shadow-atlas.db');
  const detector = new ChangeDetector(db);

  const currentYear = new Date().getFullYear();

  console.log(`🗳️  Redistricting year check for ${currentYear}...`);

  const sourcesDue = await detector.getSourcesDueForCheck();

  console.log(`📊 Found ${sourcesDue.length} sources due for check`);

  // Filter to redistricting-triggered sources
  const redistrictingSources = sourcesDue.filter(source =>
    source.updateTriggers.some(
      trigger =>
        trigger.type === 'redistricting' &&
        trigger.years.includes(currentYear)
    )
  );

  console.log(`🗺️  Redistricting-triggered sources: ${redistrictingSources.length}`);

  for (const source of redistrictingSources) {
    const change = await detector.checkForChange(source);
    if (change) {
      console.log(`📥 Boundary change detected: ${change.url}`);
    }
  }

  await db.close();
}

/**
 * Example 5: Annual July Update Check
 *
 * Run this in July when Census TIGER boundaries update.
 */
export async function julyAnnualCheck(): Promise<void> {
  const db = new SQLiteAdapter('./shadow-atlas.db');
  const detector = new ChangeDetector(db);

  console.log('📅 July annual boundary update check...');

  const sourcesDue = await detector.getSourcesDueForCheck();

  // Filter to July annual updates
  const julyUpdates = sourcesDue.filter(source =>
    source.updateTriggers.some(
      trigger => trigger.type === 'annual' && trigger.month === 7
    )
  );

  console.log(`🏛️  Annual update sources: ${julyUpdates.length}`);

  for (const source of julyUpdates) {
    const change = await detector.checkForChange(source);
    if (change) {
      console.log(`📥 Annual update detected: ${change.url}`);
    }
  }

  await db.close();
}

/**
 * Example 6: Compare Costs - Before vs After
 *
 * Demonstrates cost savings from change detection.
 */
export function demonstrateCostSavings(): void {
  const totalSources = 19495; // 19,495 US municipalities
  const avgDownloadSizeMB = 2; // Average GeoJSON file size
  const bandwidthCostPerGB = 0.09; // AWS egress cost

  // OLD APPROACH: Download everything quarterly
  const oldQuarterlyDownloadGB = (totalSources * avgDownloadSizeMB) / 1024;
  const oldAnnualDownloadGB = oldQuarterlyDownloadGB * 4;
  const oldAnnualCost = oldAnnualDownloadGB * bandwidthCostPerGB;

  console.log('📊 COST COMPARISON');
  console.log('==================');
  console.log('\n❌ OLD APPROACH (Batch Scraping):');
  console.log(`   Quarterly download: ${oldQuarterlyDownloadGB.toFixed(2)} GB`);
  console.log(`   Annual download: ${oldAnnualDownloadGB.toFixed(2)} GB`);
  console.log(`   Annual cost: $${oldAnnualCost.toFixed(2)}`);

  // NEW APPROACH: Only download what changed
  const typicalChangeRate = 0.05; // 5% of sources change per quarter
  const changedSourcesPerQuarter = totalSources * typicalChangeRate;
  const newQuarterlyDownloadGB = (changedSourcesPerQuarter * avgDownloadSizeMB) / 1024;
  const newAnnualDownloadGB = newQuarterlyDownloadGB * 4;
  const newAnnualCost = newAnnualDownloadGB * bandwidthCostPerGB;
  const headRequestCost = 0; // HEAD requests don't count toward bandwidth

  console.log('\n✅ NEW APPROACH (Change Detection):');
  console.log(`   Sources checked: ${totalSources} (HEAD requests)`);
  console.log(`   Sources changed: ~${changedSourcesPerQuarter.toFixed(0)} per quarter`);
  console.log(`   Quarterly download: ${newQuarterlyDownloadGB.toFixed(2)} GB`);
  console.log(`   Annual download: ${newAnnualDownloadGB.toFixed(2)} GB`);
  console.log(`   HEAD request cost: $${headRequestCost.toFixed(2)}`);
  console.log(`   Annual download cost: $${newAnnualCost.toFixed(2)}`);
  console.log(`   TOTAL annual cost: $${(newAnnualCost + headRequestCost).toFixed(2)}`);

  const savings = oldAnnualCost - (newAnnualCost + headRequestCost);
  const savingsPercent = (savings / oldAnnualCost) * 100;

  console.log('\n💰 SAVINGS:');
  console.log(`   Annual savings: $${savings.toFixed(2)}`);
  console.log(`   Savings rate: ${savingsPercent.toFixed(1)}%`);
  console.log(`   Bandwidth saved: ${(oldAnnualDownloadGB - newAnnualDownloadGB).toFixed(2)} GB/year`);
}

/**
 * Example 7: Monitor for Unexpected Changes
 *
 * Alert when sources change outside their scheduled update windows.
 */
export async function monitorUnexpectedChanges(): Promise<void> {
  const db = new SQLiteAdapter('./shadow-atlas.db');
  const detector = new ChangeDetector(db);

  console.log('🚨 Monitoring for unexpected boundary changes...');

  // Check all sources (even those not due)
  const allChanges = await detector.checkAllSources();

  // Get sources that are actually due
  const expectedChanges = await detector.checkScheduledSources();
  const expectedSourceIds = new Set(expectedChanges.map(c => c.sourceId));

  // Find unexpected changes
  const unexpectedChanges = allChanges.filter(
    change => !expectedSourceIds.has(change.sourceId)
  );

  if (unexpectedChanges.length > 0) {
    console.log(`⚠️  ALERT: ${unexpectedChanges.length} unexpected boundary changes!`);

    for (const change of unexpectedChanges) {
      console.log(`   🚨 ${change.url}`);
      console.log(`      Expected next check: (see source metadata)`);
      console.log(`      Actual change: ${change.detectedAt}`);
    }
  } else {
    console.log('✅ No unexpected changes detected');
  }

  await db.close();
}

/**
 * Run examples
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];

  switch (command) {
    case 'daily':
      await dailyScheduledCheck();
      break;

    case 'force':
      await forceCheckAll();
      break;

    case 'check':
      if (!process.argv[3]) {
        console.error('Usage: change-detector-example check <url>');
        process.exit(1);
      }
      await checkSingleSource(process.argv[3]);
      break;

    case 'redistricting':
      await redistrictingYearCheck();
      break;

    case 'july':
      await julyAnnualCheck();
      break;

    case 'costs':
      demonstrateCostSavings();
      break;

    case 'monitor':
      await monitorUnexpectedChanges();
      break;

    default:
      console.log('Usage: change-detector-example <command>');
      console.log('');
      console.log('Commands:');
      console.log('  daily         - Daily scheduled check');
      console.log('  force         - Force check all sources');
      console.log('  check <url>   - Check single source');
      console.log('  redistricting - Redistricting year check');
      console.log('  july          - July annual update check');
      console.log('  costs         - Show cost comparison');
      console.log('  monitor       - Monitor unexpected changes');
      process.exit(1);
  }
}
