#!/usr/bin/env npx tsx
/**
 * Registry Coverage Validator
 *
 * Cross-references known-portals registry with top 50 cities.
 * Validates download URLs are still active.
 *
 * Run: npx tsx scripts/validate-registry-coverage.ts
 */

import { KNOWN_PORTALS } from '../src/core/registry/known-portals.generated.js';
import { isStale } from '../src/core/registry/registry-utils.js';

/**
 * Compute registry statistics from KNOWN_PORTALS
 */
function getRegistryStats(): { total: number; fresh: number; stale: number; avgConfidence: number } {
  const portals = Object.values(KNOWN_PORTALS);
  const staleCount = portals.filter(isStale).length;
  const avgConfidence = portals.reduce((sum, p) => sum + p.confidence, 0) / portals.length;
  return {
    total: portals.length,
    fresh: portals.length - staleCount,
    stale: staleCount,
    avgConfidence,
  };
}

// Top 50 cities with FIPS codes
const TOP_50_FIPS: Record<string, { rank: number; name: string; state: string }> = {
  '3651000': { rank: 1, name: 'New York', state: 'NY' },
  '0644000': { rank: 2, name: 'Los Angeles', state: 'CA' },
  '1714000': { rank: 3, name: 'Chicago', state: 'IL' },
  '4835000': { rank: 4, name: 'Houston', state: 'TX' },
  '0455000': { rank: 5, name: 'Phoenix', state: 'AZ' },
  '4260000': { rank: 6, name: 'Philadelphia', state: 'PA' },
  '4865000': { rank: 7, name: 'San Antonio', state: 'TX' },
  '0666000': { rank: 8, name: 'San Diego', state: 'CA' },
  '4819000': { rank: 9, name: 'Dallas', state: 'TX' },
  '0668000': { rank: 10, name: 'San Jose', state: 'CA' },
  '4805000': { rank: 11, name: 'Austin', state: 'TX' },
  '1235000': { rank: 12, name: 'Jacksonville', state: 'FL' },
  '4827000': { rank: 13, name: 'Fort Worth', state: 'TX' },
  '3918000': { rank: 14, name: 'Columbus', state: 'OH' },
  '3712000': { rank: 15, name: 'Charlotte', state: 'NC' },
  '1836003': { rank: 16, name: 'Indianapolis', state: 'IN' },
  '0667000': { rank: 17, name: 'San Francisco', state: 'CA' },
  '5363000': { rank: 18, name: 'Seattle', state: 'WA' },
  '0820000': { rank: 19, name: 'Denver', state: 'CO' },
  '1150000': { rank: 20, name: 'Washington', state: 'DC' },
  '2507000': { rank: 21, name: 'Boston', state: 'MA' },
  '4824000': { rank: 22, name: 'El Paso', state: 'TX' },
  '4752006': { rank: 23, name: 'Nashville', state: 'TN' },
  '2622000': { rank: 24, name: 'Detroit', state: 'MI' },
  '4055000': { rank: 25, name: 'Oklahoma City', state: 'OK' },
  '4159000': { rank: 26, name: 'Portland', state: 'OR' },
  '3240000': { rank: 27, name: 'Las Vegas', state: 'NV' },
  '4748000': { rank: 28, name: 'Memphis', state: 'TN' },
  '2148006': { rank: 29, name: 'Louisville', state: 'KY' },
  '2404000': { rank: 30, name: 'Baltimore', state: 'MD' },
  '5553000': { rank: 31, name: 'Milwaukee', state: 'WI' },
  '3502000': { rank: 32, name: 'Albuquerque', state: 'NM' },
  '0477000': { rank: 33, name: 'Tucson', state: 'AZ' },
  '0627000': { rank: 34, name: 'Fresno', state: 'CA' },
  '0664000': { rank: 35, name: 'Sacramento', state: 'CA' },
  '0446000': { rank: 36, name: 'Mesa', state: 'AZ' },
  '1304000': { rank: 37, name: 'Atlanta', state: 'GA' },
  '2938000': { rank: 38, name: 'Kansas City', state: 'MO' },
  '0816000': { rank: 39, name: 'Colorado Springs', state: 'CO' },
  '3137000': { rank: 40, name: 'Omaha', state: 'NE' },
  '3755000': { rank: 41, name: 'Raleigh', state: 'NC' },
  '1245000': { rank: 42, name: 'Miami', state: 'FL' },
  '0643000': { rank: 43, name: 'Long Beach', state: 'CA' },
  '5182000': { rank: 44, name: 'Virginia Beach', state: 'VA' },
  '0653000': { rank: 45, name: 'Oakland', state: 'CA' },
  '2743000': { rank: 46, name: 'Minneapolis', state: 'MN' },
  '4075000': { rank: 47, name: 'Tulsa', state: 'OK' },
  '1271000': { rank: 48, name: 'Tampa', state: 'FL' },
  '4804000': { rank: 49, name: 'Arlington', state: 'TX' },
  '2079000': { rank: 50, name: 'Wichita', state: 'KS' },
};

async function validateUrl(url: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: { 'User-Agent': 'VOTER-Protocol/1.0 (Validation)' },
    });

    clearTimeout(timeout);
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('                 KNOWN-PORTALS REGISTRY ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const stats = getRegistryStats();
  console.log(`Registry contains ${stats.total} entries`);
  console.log(`  Fresh (< 90 days): ${stats.fresh}`);
  console.log(`  Stale (> 90 days): ${stats.stale}`);
  console.log(`  Avg confidence: ${stats.avgConfidence.toFixed(1)}`);
  console.log('');

  // Check top 50 coverage
  const inRegistry: string[] = [];
  const missing: string[] = [];

  for (const [fips, city] of Object.entries(TOP_50_FIPS)) {
    if (KNOWN_PORTALS[fips]) {
      inRegistry.push(fips);
    } else {
      missing.push(fips);
    }
  }

  console.log(`\n✅ TOP 50 IN REGISTRY (${inRegistry.length}/50):`);
  console.log('─'.repeat(80));
  inRegistry
    .sort((a, b) => TOP_50_FIPS[a].rank - TOP_50_FIPS[b].rank)
    .forEach((fips) => {
      const city = TOP_50_FIPS[fips];
      const portal = KNOWN_PORTALS[fips];
      console.log(
        `  ${city.rank.toString().padStart(2)}. ${city.name.padEnd(20)} ${city.state} | ` +
        `${portal.featureCount} districts | conf: ${portal.confidence}`
      );
    });

  console.log(`\n❌ MISSING FROM REGISTRY (${missing.length}/50):`);
  console.log('─'.repeat(80));
  missing
    .sort((a, b) => TOP_50_FIPS[a].rank - TOP_50_FIPS[b].rank)
    .forEach((fips) => {
      const city = TOP_50_FIPS[fips];
      console.log(`  ${city.rank.toString().padStart(2)}. ${city.name.padEnd(20)} ${city.state} | FIPS: ${fips}`);
    });

  // Validate URLs (sample)
  console.log(`\n\n🔗 URL VALIDATION (first 10 entries):`);
  console.log('─'.repeat(80));

  const entriesToValidate = Object.values(KNOWN_PORTALS).slice(0, 10);
  for (const portal of entriesToValidate) {
    const result = await validateUrl(portal.downloadUrl);
    const status = result.ok ? '✅' : '❌';
    const info = result.ok ? `HTTP ${result.status}` : result.error;
    console.log(`  ${status} ${portal.cityName.padEnd(20)} - ${info}`);
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('                           SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`  Top 50 coverage: ${inRegistry.length}/50 (${((inRegistry.length / 50) * 100).toFixed(0)}%)`);
  console.log(`  Total registry:  ${stats.total} cities`);
  console.log(`\n  Missing cities need manual curation or discovery pipeline.`);
}

main().catch(console.error);
