#!/usr/bin/env tsx
/**
 * Shadow Atlas Probe Sources — daily reachability probe lane runner
 *
 * Runs the probe lane (source-prober.ts) over every SOURCE_REGISTRY row the
 * fetch lane never touches, writing attempt outcomes to the same
 * `source_health` ledger table the fetch lane writes to (via
 * check-changes.ts's ChangeDetector attempt-outcome hook). Reachability
 * only — no checksums, no change events.
 *
 * Also runs a SEPARATE daily reachability probe over the fetch lane itself
 * (the 2 congressional seeds, always, + a bounded date-rotated sample of
 * muni-derived sources — getAllCanonicalSources can return thousands of
 * municipalities, so probing all of them daily would blow the design's
 * cost posture): muni content checks are due-filtered (annual triggers), so
 * relying on the content clock alone would leave those rows with no daily
 * signal at all for ~11 months/year. This writes ONLY the
 * probe_consecutive_failures/last_probe_at columns — never the content
 * clock (consecutive_failures/last_success_at/last_error) those rows' real
 * checksum checks own. (The 2 seeds also get an ALWAYS-due real content
 * check — see check-changes.ts — so this probe is belt-and-suspenders for
 * them; it is the primary daily signal for the sampled munis.)
 *
 * Usage:
 *   npx tsx src/scripts/probe-sources.ts
 *   npx tsx src/scripts/probe-sources.ts --db ./shadow-atlas.db
 *   npx tsx src/scripts/probe-sources.ts --db ./shadow-atlas.db --config-breach-summary ./config-breach-summary.json
 *
 * OPERATOR NOTE: this script registers no cron; it only probes sources and
 * records the reachability outcomes upstream actually served.
 */

import { writeFileSync } from 'node:fs';
import { createSQLiteAdapter } from '../db/factory.js';
import { ChangeDetector } from '../acquisition/change-detector.js';
import { SourceHealthStore, buildConfigBreachRecord, SOURCE_REGISTRY } from '../acquisition/source-health.js';
import { runProbeLane, probeFetchLaneReachability } from '../acquisition/source-prober.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dbIdx = args.indexOf('--db');
  const dbPath = dbIdx >= 0 ? args[dbIdx + 1] : './shadow-atlas.db';
  const breachSummaryIdx = args.indexOf('--config-breach-summary');
  const breachSummaryPath = breachSummaryIdx >= 0 ? args[breachSummaryIdx + 1] : undefined;

  // Reuse the same factory check-changes.ts uses, so a fresh DB bootstraps
  // the source_health table via the identical schema path.
  const db = await createSQLiteAdapter(dbPath);
  const detector = new ChangeDetector(db);
  const store = new SourceHealthStore(db.rawDb());

  try {
    console.log('Probing registry sources for reachability...');

    // Real producer surface: id + url, exactly as getAllCanonicalSources
    // returns it (numeric string ids for muni sources, stable seed ids for
    // the 2 congressional seeds). Ward-arcgis family membership is derived
    // from url, never from an invented id shape.
    const fetchLaneSources = await detector.getAllCanonicalSources();

    const summary = await runProbeLane({
      fetchImpl: fetch as unknown as Parameters<typeof runProbeLane>[0]['fetchImpl'],
      store,
      now: () => new Date(),
      fetchLaneSources,
    });

    const probed = summary.attempts.filter(a => !a.skipped);
    const succeeded = probed.filter(a => a.outcome === 'success').length;
    const failed = probed.filter(a => a.outcome === 'failure').length;

    console.log(`Probed ${probed.length} source(s): ${succeeded} reachable, ${failed} failed`);

    // Daily reachability probe of the fetch lane itself (probe-only
    // columns — see module doc). Separate from runProbeLane's content-clock
    // probe pass above.
    const reachability = await probeFetchLaneReachability({
      fetchImpl: fetch as unknown as Parameters<typeof probeFetchLaneReachability>[0]['fetchImpl'],
      store,
      now: () => new Date(),
      fetchLaneSources,
    });
    const reachableCount = reachability.filter(r => r.outcome === 'success').length;
    console.log(
      `Fetch-lane daily reachability: ${reachableCount}/${reachability.length} reachable`
    );

    if (summary.fetchLaneConfigBreaches.length > 0) {
      console.warn(
        `Fetch-lane config breach: declared lane:'fetch' row(s) not found in getAllCanonicalSources: ${summary.fetchLaneConfigBreaches.join(', ')}`
      );
    }

    // Persist config breaches (not just console.warn) so they surface
    // through the same health-summary/issue pipeline as fetch/staleness
    // breaches — "absence is loud" per the design, not silent CI noise.
    if (breachSummaryPath) {
      const records = summary.fetchLaneConfigBreaches
        .map(id => SOURCE_REGISTRY.find(r => r.id === id))
        .filter((r): r is NonNullable<typeof r> => r !== undefined)
        .map(buildConfigBreachRecord);
      writeFileSync(breachSummaryPath, JSON.stringify({ breaches: records }));
    }
  } finally {
    await db.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error('probe-sources failed:', err);
    process.exit(1);
  });
}
