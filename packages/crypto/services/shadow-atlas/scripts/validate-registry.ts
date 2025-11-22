/**
 * Registry Validation Worker - Daily Health Checks
 *
 * PURPOSE: Automated daily validation of known-portals
 * USAGE: npm run atlas:validate-registry
 */

import * as fs from 'fs/promises';
import { validateRegistry, type HealthCheckSummary } from '../services/registry-validator.js';
import { KNOWN_PORTALS } from '../registry/known-portals.js';

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║       SHADOW ATLAS REGISTRY VALIDATION              ║');
  console.log('╚══════════════════════════════════════════════════════╝');

  const summary = await validateRegistry(KNOWN_PORTALS, 5);

  // Print summary
  console.log('\n═══ VALIDATION SUMMARY ═══\n');
  console.log(`Total Entries:     ${summary.totalEntries}`);
  console.log(`✅ Healthy:         ${summary.healthy} (${((summary.healthy / summary.totalEntries) * 100).toFixed(1)}%)`);
  console.log(`⚠️  Warnings:        ${summary.warnings} (${((summary.warnings / summary.totalEntries) * 100).toFixed(1)}%)`);
  console.log(`❌ Errors:          ${summary.errors} (${((summary.errors / summary.totalEntries) * 100).toFixed(1)}%)`);
  console.log(`Avg Response Time: ${summary.averageResponseTime.toFixed(0)}ms\n`);

  // Print errors
  const errorResults = summary.results.filter((r) => r.status === 'error');
  if (errorResults.length > 0) {
    console.log('═══ ERRORS ═══\n');
    for (const result of errorResults) {
      console.log(`❌ ${result.cityName}, ${result.state} (${result.fips})`);
      console.log(`   URL: ${result.url}`);
      console.log(`   Status: HTTP ${result.httpStatus}`);
      for (const issue of result.issues) {
        console.log(`   - ${issue}`);
      }
      console.log();
    }
  }

  // Print warnings
  const warningResults = summary.results.filter((r) => r.status === 'warning');
  if (warningResults.length > 0) {
    console.log('═══ WARNINGS ═══\n');
    for (const result of warningResults) {
      console.log(`⚠️  ${result.cityName}, ${result.state} (${result.fips})`);
      for (const issue of result.issues) {
        console.log(`   - ${issue}`);
      }
      console.log();
    }
  }

  // Write results to file
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = `./services/shadow-atlas/registry-health-check-${timestamp}.json`;
  await fs.writeFile(outputPath, JSON.stringify(summary, null, 2));
  console.log(`\n✅ Results written to: ${outputPath}\n`);

  // Exit with error code if any errors
  if (summary.errors > 0) {
    console.error(`\n❌ ${summary.errors} errors detected - manual intervention required\n`);
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error('Fatal error:', error.message);
  } else {
    console.error('Fatal error:', error);
  }
  process.exit(1);
});
