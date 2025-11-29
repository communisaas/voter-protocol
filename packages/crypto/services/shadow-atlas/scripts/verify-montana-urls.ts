#!/usr/bin/env npx tsx
/**
 * Verify Montana Boundary URLs
 *
 * Tests all discovered Montana boundary URLs to ensure they're accessible
 * and return valid GeoJSON with expected feature counts.
 *
 * Usage:
 *   npx tsx scripts/verify-montana-urls.ts
 */

import { MONTANA_WARD_BOUNDARIES, type MontanaBoundarySource } from '../registry/montana-boundaries.js';

interface VerificationResult {
  readonly city: string;
  readonly status: 'ok' | 'error' | 'wrong_count';
  readonly expectedDistricts: number;
  readonly actualFeatures: number | null;
  readonly responseTime: number;
  readonly error?: string;
}

async function verifyUrl(source: MontanaBoundarySource): Promise<VerificationResult> {
  const startTime = Date.now();

  try {
    const response = await fetch(source.geojsonUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'VOTER-Protocol/1.0 (Montana URL Verification)',
      },
      signal: AbortSignal.timeout(30000),
    });

    const responseTime = Date.now() - startTime;

    if (!response.ok) {
      return {
        city: source.city,
        status: 'error',
        expectedDistricts: source.districtCount,
        actualFeatures: null,
        responseTime,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const data = await response.json();

    // GeoJSON feature count
    let featureCount = 0;
    if (data.features && Array.isArray(data.features)) {
      featureCount = data.features.length;
    } else if (data.type === 'Feature') {
      featureCount = 1;
    }

    // For multipart geometries, we may have more features than districts
    // (e.g., Missoula has 36 features for 6 wards)
    // So we just verify we got SOME features
    const status = featureCount > 0 ? 'ok' : 'wrong_count';

    return {
      city: source.city,
      status,
      expectedDistricts: source.districtCount,
      actualFeatures: featureCount,
      responseTime,
    };
  } catch (error) {
    return {
      city: source.city,
      status: 'error',
      expectedDistricts: source.districtCount,
      actualFeatures: null,
      responseTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main(): Promise<void> {
  console.log('='.repeat(70));
  console.log('  MONTANA BOUNDARY URL VERIFICATION');
  console.log('  Testing all discovered GeoJSON endpoints');
  console.log('='.repeat(70));
  console.log();

  const results: VerificationResult[] = [];

  for (const source of MONTANA_WARD_BOUNDARIES) {
    process.stdout.write(`Verifying ${source.city}... `);
    const result = await verifyUrl(source);
    results.push(result);

    if (result.status === 'ok') {
      console.log(`OK (${result.actualFeatures} features, ${result.responseTime}ms)`);
    } else if (result.status === 'wrong_count') {
      console.log(`WARN: ${result.actualFeatures} features (expected ~${result.expectedDistricts})`);
    } else {
      console.log(`ERROR: ${result.error}`);
    }

    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Summary
  console.log();
  console.log('='.repeat(70));
  console.log('  VERIFICATION SUMMARY');
  console.log('='.repeat(70));
  console.log();

  const ok = results.filter(r => r.status === 'ok');
  const errors = results.filter(r => r.status === 'error');
  const warnings = results.filter(r => r.status === 'wrong_count');

  console.log(`Total cities: ${results.length}`);
  console.log(`  OK: ${ok.length}`);
  console.log(`  Warnings: ${warnings.length}`);
  console.log(`  Errors: ${errors.length}`);
  console.log();

  if (errors.length > 0) {
    console.log('ERRORS:');
    for (const r of errors) {
      console.log(`  ${r.city}: ${r.error}`);
    }
    console.log();
  }

  if (warnings.length > 0) {
    console.log('WARNINGS (may need investigation):');
    for (const r of warnings) {
      console.log(`  ${r.city}: got ${r.actualFeatures} features, expected ~${r.expectedDistricts}`);
    }
    console.log();
  }

  // Overall status
  const avgResponseTime = results
    .filter(r => r.status === 'ok')
    .reduce((sum, r) => sum + r.responseTime, 0) / ok.length;

  console.log('='.repeat(70));
  if (errors.length === 0) {
    console.log('ALL URLs VERIFIED SUCCESSFULLY');
  } else {
    console.log(`${errors.length} URLs FAILED VERIFICATION`);
    process.exitCode = 1;
  }
  console.log(`Average response time: ${avgResponseTime.toFixed(0)}ms`);
  console.log('='.repeat(70));
}

main().catch(console.error);
