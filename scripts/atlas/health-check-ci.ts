#!/usr/bin/env npx tsx
/**
 * Shadow Atlas Health Check for CI
 *
 * Runs provider health checks and outputs JSON for GitHub Actions.
 * Designed to be run without persistent state.
 *
 * USAGE:
 *   npx tsx services/shadow-atlas/scripts/health-check-ci.ts
 *
 * OUTPUT:
 *   JSON object with health summary (stdout)
 *   Exit code 0 = healthy, 1 = unhealthy
 */

import { UKBoundaryProvider } from '../providers/international/uk-provider.js';
import { CanadaBoundaryProvider } from '../providers/international/canada-provider.js';

interface ProviderCheckResult {
  readonly name: string;
  readonly available: boolean;
  readonly latencyMs: number;
  readonly error?: string;
}

interface HealthCheckOutput {
  readonly healthy: boolean;
  readonly extractionSuccessRate: number;
  readonly validationPassRate: number;
  readonly avgJobDurationMs: number;
  readonly providerAvailability: Record<string, boolean>;
  readonly issues: readonly string[];
  readonly checkedAt: string;
  readonly providers: readonly ProviderCheckResult[];
}

async function checkProvider(
  name: string,
  checkFn: () => Promise<{ available: boolean; latencyMs: number; issues: string[] }>
): Promise<ProviderCheckResult> {
  const startTime = Date.now();
  try {
    const result = await checkFn();
    return {
      name,
      available: result.available,
      latencyMs: result.latencyMs,
      error: result.issues[0],
    };
  } catch (error) {
    return {
      name,
      available: false,
      latencyMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main(): Promise<void> {
  const issues: string[] = [];
  const providers: ProviderCheckResult[] = [];

  // Check UK provider
  const ukProvider = new UKBoundaryProvider({ retryAttempts: 1, retryDelayMs: 1000 });
  const ukResult = await checkProvider('UKBoundaryProvider', () => ukProvider.healthCheck());
  providers.push(ukResult);

  if (!ukResult.available) {
    issues.push(`UK provider unavailable: ${ukResult.error ?? 'unknown'}`);
  }

  // Check Canada provider
  const canadaProvider = new CanadaBoundaryProvider({ retryAttempts: 1, retryDelayMs: 1000 });
  const canadaResult = await checkProvider('CanadaBoundaryProvider', () =>
    canadaProvider.healthCheck()
  );
  providers.push(canadaResult);

  if (!canadaResult.available) {
    issues.push(`Canada provider unavailable: ${canadaResult.error ?? 'unknown'}`);
  }

  // Build availability map
  const providerAvailability: Record<string, boolean> = {};
  for (const p of providers) {
    providerAvailability[p.name] = p.available;
  }

  // Determine overall health
  const healthy = providers.every((p) => p.available);

  // Build output
  const output: HealthCheckOutput = {
    healthy,
    // CI mode doesn't have historical metrics, so use defaults
    extractionSuccessRate: healthy ? 1.0 : 0.5,
    validationPassRate: healthy ? 1.0 : 0.5,
    avgJobDurationMs: 0,
    providerAvailability,
    issues,
    checkedAt: new Date().toISOString(),
    providers,
  };

  // Output as JSON
  console.log(JSON.stringify(output, null, 2));

  // Exit with appropriate code
  process.exit(healthy ? 0 : 1);
}

main().catch((error) => {
  console.error(JSON.stringify({
    healthy: false,
    issues: [error instanceof Error ? error.message : String(error)],
    checkedAt: new Date().toISOString(),
  }));
  process.exit(1);
});
