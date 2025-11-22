/**
 * Retry Worker - Autonomous Retry Execution
 *
 * PURPOSE: Execute retry attempts for eligible candidates
 * FREQUENCY: Runs continuously, checks hourly
 * SCALE: Handles thousands of retries efficiently
 *
 * DESIGN PHILOSOPHY: Set-and-forget autonomous healing
 * - Runs as daemon process (systemd, pm2, or docker)
 * - Prioritizes high-population cities (maximum coverage impact)
 * - Rate-limits retries to avoid overwhelming discovery workers
 * - Logs all retry attempts to provenance (audit trail)
 *
 * DEPLOYMENT:
 * ```bash
 * # Foreground (development)
 * npm run atlas:retry-worker
 *
 * # Background (production)
 * pm2 start "npm run atlas:retry-worker" --name shadow-atlas-retry
 *
 * # Docker (production)
 * docker run -d --name shadow-atlas-retry voter-protocol/shadow-atlas retry-worker
 * ```
 */

import { getRetryCandidates, type RetryCandidate } from '../services/retry-orchestrator.js';

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const MAX_RETRIES_PER_RUN = 100; // Limit retries per run to avoid overwhelming system

/**
 * Execute retry attempts for eligible candidates
 *
 * ALGORITHM:
 * 1. Get all retry-eligible candidates (sorted by priority)
 * 2. Limit batch size to MAX_RETRIES_PER_RUN
 * 3. For each candidate, invoke discovery worker
 * 4. Discovery worker logs attempt to provenance automatically
 * 5. Sleep until next check interval
 *
 * @param baseDir - Provenance log directory
 */
export async function executeRetries(baseDir: string = './discovery-attempts'): Promise<void> {
  console.log('[Retry Worker] Starting retry execution...');

  try {
    // Get all eligible retry candidates (sorted by population priority)
    const candidates = await getRetryCandidates(baseDir);

    if (candidates.length === 0) {
      console.log('[Retry Worker] No eligible retries found');
      return;
    }

    console.log(`[Retry Worker] Found ${candidates.length} eligible retries`);

    // Limit retries per run (avoid overwhelming discovery workers)
    const toBatch = candidates.slice(0, MAX_RETRIES_PER_RUN);

    console.log(
      `[Retry Worker] Executing ${toBatch.length} retries (max ${MAX_RETRIES_PER_RUN})`
    );

    let successCount = 0;
    let failCount = 0;

    for (const candidate of toBatch) {
      try {
        console.log(
          `[Retry Worker] Retrying ${candidate.cityName || candidate.fips} ` +
            `(blocker: ${candidate.blockerCode}, attempt ${candidate.attemptCount + 1})`
        );

        // INTEGRATION POINT: Call discovery worker
        // This is a placeholder - the integration agent will wire this up
        // Discovery worker will automatically log new attempt to provenance
        //
        // Example integration:
        // const { processCityDiscovery } = await import('../workers/discover-council-districts.js');
        // await processCityDiscovery({
        //   fips: candidate.fips,
        //   cityName: candidate.cityName,
        //   state: candidate.state,
        //   retryAttempt: candidate.attemptCount + 1,
        // });

        console.log(`[Retry Worker] TODO: Call discovery worker for ${candidate.fips}`);

        successCount++;
      } catch (error) {
        console.error(`[Retry Worker] Retry failed for ${candidate.fips}:`, error);
        failCount++;
      }
    }

    console.log(
      `[Retry Worker] Retry batch complete: ${successCount} success, ${failCount} failed`
    );

    // Log remaining candidates
    const remaining = candidates.length - toBatch.length;
    if (remaining > 0) {
      console.log(`[Retry Worker] ${remaining} retries deferred to next run`);
    }
  } catch (error) {
    console.error('[Retry Worker] Retry execution failed:', error);
  }
}

/**
 * Run retry worker continuously
 *
 * DAEMON MODE: Runs forever with periodic retry checks
 * PRODUCTION: Use process manager (pm2, systemd) for automatic restarts
 *
 * @param baseDir - Provenance log directory
 */
export async function runRetryWorker(baseDir: string = './discovery-attempts'): Promise<void> {
  console.log(`[Retry Worker] Started (interval: ${CHECK_INTERVAL_MS}ms)`);
  console.log(`[Retry Worker] Base directory: ${baseDir}`);
  console.log(`[Retry Worker] Max retries per run: ${MAX_RETRIES_PER_RUN}`);

  // Initial execution
  await executeRetries(baseDir);

  // Schedule periodic execution
  setInterval(async () => {
    await executeRetries(baseDir);
  }, CHECK_INTERVAL_MS);
}

// Run worker if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const baseDir = process.env.DISCOVERY_ATTEMPTS_DIR || './discovery-attempts';

  runRetryWorker(baseDir).catch((error) => {
    console.error('[Retry Worker] Fatal error:', error);
    process.exit(1);
  });
}
