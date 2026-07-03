#!/usr/bin/env tsx
/**
 * Shadow Atlas Change Check — boundary source change detection runner
 *
 * Checks scheduled boundary sources for upstream changes (free HEAD requests),
 * then persists the new validator for each detected change via
 * ChangeDetector.updateChecksum (insertArtifact -> upsertHead -> UPDATE event).
 *
 * Usage:
 *   npm run changes:check
 *   npx tsx src/scripts/check-changes.ts
 *   npx tsx src/scripts/check-changes.ts --db ./data/shadow-atlas.db
 *   npx tsx src/scripts/check-changes.ts --db ./shadow-atlas.db --summary ./change-summary.json
 *
 * OPERATOR NOTE: prod cron enablement and the real TIGER vintage VALUE are
 * OPERATOR actions. This script registers NO cron and synthesizes NO vintage —
 * it only checks sources and records the validators upstream actually served.
 */

import { writeFileSync } from 'node:fs';
import { createSQLiteAdapter } from '../db/factory.js';
import { ChangeDetector } from '../acquisition/change-detector.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dbIdx = args.indexOf('--db');
  const dbPath = dbIdx >= 0 ? args[dbIdx + 1] : './shadow-atlas.db';
  const summaryIdx = args.indexOf('--summary');
  const summaryPath = summaryIdx >= 0 ? args[summaryIdx + 1] : undefined;

  // Reuse the factory so the schema + views are initialized on a freshly
  // created DB file (createSQLiteAdapter runs adapter.initialize). A raw
  // `new SQLiteAdapter` left an empty file with no `municipalities` table,
  // so the first run threw `no such table: municipalities`.
  const db = await createSQLiteAdapter(dbPath);
  const detector = new ChangeDetector(db);

  try {
    console.log('🔍 Checking scheduled boundary sources for changes...');

    const changes = await detector.checkScheduledSources();

    console.log(`✅ Detected ${changes.length} changed source(s)`);

    for (const change of changes) {
      console.log(`📥 ${change.url}`);
      console.log(`   Change type: ${change.changeType}`);
      console.log(`   Old checksum: ${change.oldChecksum ?? 'none'}`);
      console.log(`   New checksum: ${change.newChecksum}`);

      // Persist the new validator (insertArtifact -> upsertHead -> UPDATE event).
      await detector.updateChecksum(change.sourceId, change.newChecksum);
    }

    // Optional machine-readable summary for downstream consumers (e.g. the
    // change-check workflow's alert step). No --summary flag => no file, and
    // detections never change the exit code — success still exits 0.
    if (summaryPath) {
      writeFileSync(
        summaryPath,
        JSON.stringify({
          detections: changes.length,
          changes: changes.map(c => ({ url: c.url, changeType: c.changeType })),
        }),
      );
    }
  } finally {
    await db.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error('check-changes failed:', err);
    process.exit(1);
  });
}
