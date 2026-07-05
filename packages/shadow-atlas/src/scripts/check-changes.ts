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
 *   npx tsx src/scripts/check-changes.ts --db ./shadow-atlas.db --health-summary ./health-summary.json
 *   npx tsx src/scripts/check-changes.ts --db ./shadow-atlas.db --health-summary ./health-summary.json --config-breach-summary ./config-breach-summary.json
 *
 * OPERATOR NOTE: prod cron enablement and the real TIGER vintage VALUE are
 * OPERATOR actions. This script registers NO cron and synthesizes NO vintage —
 * it only checks sources and records the validators upstream actually served.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createSQLiteAdapter } from '../db/factory.js';
import { ChangeDetector, CONGRESSIONAL_CANONICAL_SOURCES } from '../acquisition/change-detector.js';
import {
  SOURCE_REGISTRY,
  SourceHealthStore,
  evaluateSourceHealth,
  isWardArcgisFamilyUrl,
  type SourceBreachRecord,
} from '../acquisition/source-health.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dbIdx = args.indexOf('--db');
  const dbPath = dbIdx >= 0 ? args[dbIdx + 1] : './shadow-atlas.db';
  const summaryIdx = args.indexOf('--summary');
  const summaryPath = summaryIdx >= 0 ? args[summaryIdx + 1] : undefined;
  const healthSummaryIdx = args.indexOf('--health-summary');
  const healthSummaryPath = healthSummaryIdx >= 0 ? args[healthSummaryIdx + 1] : undefined;
  const configBreachSummaryIdx = args.indexOf('--config-breach-summary');
  const configBreachSummaryPath =
    configBreachSummaryIdx >= 0 ? args[configBreachSummaryIdx + 1] : undefined;

  // Reuse the factory so the schema + views are initialized on a freshly
  // created DB file (createSQLiteAdapter runs adapter.initialize). A raw
  // `new SQLiteAdapter` left an empty file with no `municipalities` table,
  // so the first run threw `no such table: municipalities`.
  const db = await createSQLiteAdapter(dbPath);
  const healthStore = new SourceHealthStore(db.rawDb());

  // Health-ledger attempt-outcome hook (self-healing data ops, §Health
  // ledger): every checkForChange attempt — success or failure — now lands
  // in source_health, independent of and without altering checksum/change
  // semantics. This is the fix for the fetch-lane error-swallow: a fetch
  // error can no longer die silently inside checkForChange's try/catch.
  const detector = new ChangeDetector(db, undefined, {}, outcome => {
    const at = new Date().toISOString();
    if (outcome.success) {
      healthStore.recordSuccess(outcome.sourceId, at, { stampSuccess: true });
    } else {
      healthStore.recordFailure(outcome.sourceId, at, outcome.error ?? 'unknown error');
    }
  });

  try {
    console.log('🔍 Checking scheduled boundary sources for changes...');

    const scheduledChanges = await detector.checkScheduledSources();
    const scheduledIds = new Set(scheduledChanges.map(c => c.sourceId));

    // Fix for the cadence mismatch: checkScheduledSources due-filters on
    // updateTriggers (congress-legislators-current: annual, month 1;
    // tiger-cd119: annual, month 7), so relying on it alone means the 2
    // congressional seeds' content clock advances only ~1 month/year even
    // though their SLOs (7d / 400d) assume a daily-checked lane. The 2
    // seeds are 2 cheap HEAD/checksum requests — explicitly ALWAYS check
    // them here, every run, regardless of the due-filter. This is a check-
    // invocation fix, not a scheduler rewrite: getSourcesDueForCheck and
    // checkScheduledSources are untouched; we simply also check the 2 seeds
    // directly when the due-filter didn't already include them this run.
    const allSources = await detector.getAllCanonicalSources();
    const seedSources = allSources.filter(
      s =>
        CONGRESSIONAL_CANONICAL_SOURCES.some(seed => seed.id === s.id) && !scheduledIds.has(s.id)
    );
    const seedChanges = seedSources.length > 0 ? await detector.checkSourcesBatch(seedSources) : [];

    const changes = [...scheduledChanges, ...seedChanges];

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

    // Optional breach-evaluation summary (self-healing data ops, §Breach
    // evaluation). No --health-summary flag => no file, no behavior change.
    // Exit code stays 0 regardless of breach count — the issue is the
    // alarm, not a red run.
    if (healthSummaryPath) {
      // Ward-arcgis family membership: derived from the REAL producer
      // output (allSources' actual URLs), never an invented id shape.
      const wardArcgisLedgerIds = allSources
        .filter(s => isWardArcgisFamilyUrl(s.url))
        .map(s => s.id);

      const { breaches } = evaluateSourceHealth(
        healthStore.getAllRows(),
        SOURCE_REGISTRY,
        new Date(),
        {
          // Real, persisted registration times (falls back to the
          // ledger-row-level registered_at inside evaluateSourceHealth for
          // any source this map doesn't cover).
          registeredAt: healthStore.getRegisteredAtMap(),
          wardArcgisLedgerIds,
        }
      );

      // Merge in any fetch-lane config breaches the probe lane recorded
      // this run (probe-sources.ts --config-breach-summary), so a real
      // absence surfaces through the SAME issue pipeline instead of being
      // silently dropped when no --config-breach-summary flag is passed.
      let configBreaches: SourceBreachRecord[] = [];
      if (configBreachSummaryPath) {
        try {
          const raw = JSON.parse(readFileSync(configBreachSummaryPath, 'utf-8')) as {
            breaches?: SourceBreachRecord[];
          };
          configBreaches = raw.breaches ?? [];
        } catch {
          // Missing/unreadable file (e.g. probe-sources.ts wasn't run this
          // pass, or found zero breaches and never wrote it) — no breaches
          // to merge, not a fatal condition for the content-check run.
        }
      }

      writeFileSync(healthSummaryPath, JSON.stringify({ breaches: [...breaches, ...configBreaches] }));
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
