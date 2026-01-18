#!/usr/bin/env npx tsx
/**
 * Boundary Download Validator
 *
 * Downloads and validates actual GeoJSON from known-portals registry.
 * Verifies feature counts match expected, geometry is valid.
 *
 * Run: npx tsx scripts/validate-boundary-downloads.ts
 */

import { KNOWN_PORTALS, type KnownPortal } from '../src/core/registry/known-portals.js';

interface ValidationResult {
  cityFips: string;
  cityName: string;
  state: string;
  expected: number;
  actual: number | null;
  status: 'valid' | 'count_mismatch' | 'fetch_error' | 'invalid_geojson';
  error?: string;
  hasGeometry: boolean;
  sampleDistricts?: string[];
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number = 30000
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'VOTER-Protocol/1.0 (Boundary-Validation)',
        Accept: 'application/geo+json, application/json',
      },
    });
    clearTimeout(timeout);
    return response;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

function extractDistrictName(feature: unknown): string | null {
  if (!feature || typeof feature !== 'object') return null;
  const props = (feature as Record<string, unknown>).properties;
  if (!props || typeof props !== 'object') return null;

  const propObj = props as Record<string, unknown>;

  // Common field names for district identifiers
  const nameFields = [
    'DISTRICT',
    'District',
    'district',
    'DIST',
    'Dist',
    'COUNCIL_DISTRICT',
    'CouncilDistrict',
    'WARD',
    'Ward',
    'ward',
    'NAME',
    'Name',
    'name',
    'DISPLAY_NAME',
    'DisplayName',
    'DIST_NUM',
    'DistrictNumber',
    'CD',
    'COUNCILDIST',
  ];

  for (const field of nameFields) {
    if (propObj[field] !== undefined && propObj[field] !== null) {
      return String(propObj[field]);
    }
  }

  return null;
}

async function validatePortal(portal: KnownPortal): Promise<ValidationResult> {
  const result: ValidationResult = {
    cityFips: portal.cityFips,
    cityName: portal.cityName,
    state: portal.state,
    expected: portal.featureCount,
    actual: null,
    status: 'fetch_error',
    hasGeometry: false,
  };

  try {
    const response = await fetchWithTimeout(portal.downloadUrl);

    if (!response.ok) {
      result.error = `HTTP ${response.status}`;
      return result;
    }

    const data = await response.json();

    // Validate GeoJSON structure
    if (!data || typeof data !== 'object') {
      result.status = 'invalid_geojson';
      result.error = 'Response is not an object';
      return result;
    }

    // Check for features array (standard GeoJSON FeatureCollection)
    let features: unknown[] | null = null;

    if (Array.isArray((data as Record<string, unknown>).features)) {
      features = (data as Record<string, unknown>).features as unknown[];
    } else if ((data as Record<string, unknown>).type === 'Feature') {
      // Single feature
      features = [data];
    } else if (Array.isArray(data)) {
      // Raw array of features
      features = data as unknown[];
    }

    if (!features) {
      result.status = 'invalid_geojson';
      result.error = 'No features array found';
      return result;
    }

    result.actual = features.length;

    // Check for geometry presence
    result.hasGeometry = features.some((f) => {
      if (!f || typeof f !== 'object') return false;
      const feature = f as Record<string, unknown>;
      return (
        feature.geometry !== null &&
        feature.geometry !== undefined &&
        typeof feature.geometry === 'object'
      );
    });

    // Extract sample district names
    result.sampleDistricts = features
      .slice(0, 5)
      .map(extractDistrictName)
      .filter((n): n is string => n !== null);

    // Determine status
    if (result.actual === portal.featureCount) {
      result.status = 'valid';
    } else if (result.actual > 0) {
      result.status = 'count_mismatch';
    } else {
      result.status = 'invalid_geojson';
      result.error = 'Zero features returned';
    }

    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Unknown error';
    if (result.error.includes('aborted')) {
      result.error = 'Timeout (30s)';
    }
    return result;
  }
}

// Top 50 FIPS codes for prioritization
const TOP_50_FIPS = new Set([
  '3651000', '0644000', '1714000', '4835000', '0455000', '4260000', '4865000',
  '0666000', '4819000', '0668000', '4805000', '1235000', '4827000', '3918000',
  '3712000', '1836003', '0667000', '5363000', '0820000', '1150000', '2507000',
  '4824000', '4752006', '2622000', '4055000', '4159000', '3240000', '4748000',
  '2148006', '2404000', '5553000', '3502000', '0477000', '0627000', '0664000',
  '0446000', '1304000', '2938000', '0816000', '3137000', '3755000', '1245000',
  '0643000', '5182000', '0653000', '2743000', '4075000', '1271000', '4804000',
  '2079000',
]);

async function main(): Promise<void> {
  const allPortals = Object.values(KNOWN_PORTALS);

  // Prioritize top 50 cities
  const top50Portals = allPortals.filter((p) => TOP_50_FIPS.has(p.cityFips));
  const otherPortals = allPortals.filter((p) => !TOP_50_FIPS.has(p.cityFips));

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('              BOUNDARY DOWNLOAD VALIDATION');
  console.log('═══════════════════════════════════════════════════════════════════\n');
  console.log(`Total registry entries: ${allPortals.length}`);
  console.log(`Top 50 cities in registry: ${top50Portals.length}`);
  console.log(`Other cities: ${otherPortals.length}\n`);

  // Validate top 50 first (in batches to avoid rate limiting)
  console.log('🔍 VALIDATING TOP 50 CITIES...\n');

  const results: ValidationResult[] = [];
  const batchSize = 5;

  for (let i = 0; i < top50Portals.length; i += batchSize) {
    const batch = top50Portals.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(validatePortal));
    results.push(...batchResults);

    // Progress indicator
    process.stdout.write(`  Validated ${Math.min(i + batchSize, top50Portals.length)}/${top50Portals.length} cities...\r`);

    // Small delay between batches
    if (i + batchSize < top50Portals.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log('\n');

  // Categorize results
  const valid = results.filter((r) => r.status === 'valid');
  const countMismatch = results.filter((r) => r.status === 'count_mismatch');
  const fetchError = results.filter((r) => r.status === 'fetch_error');
  const invalidJson = results.filter((r) => r.status === 'invalid_geojson');

  // Print valid results
  console.log(`✅ VALID (${valid.length}/${results.length}) - Correct feature count:`);
  console.log('─'.repeat(80));
  for (const r of valid.sort((a, b) => a.cityName.localeCompare(b.cityName))) {
    const samples = r.sampleDistricts?.slice(0, 3).join(', ') || '';
    console.log(
      `  ${r.cityName.padEnd(20)} ${r.state} | ${r.actual} features | ${samples ? `[${samples}...]` : ''}`
    );
  }

  // Print count mismatches
  if (countMismatch.length > 0) {
    console.log(`\n⚠️  COUNT MISMATCH (${countMismatch.length}) - Different from expected:`);
    console.log('─'.repeat(80));
    for (const r of countMismatch) {
      const diff = (r.actual || 0) - r.expected;
      const sign = diff > 0 ? '+' : '';
      console.log(
        `  ${r.cityName.padEnd(20)} ${r.state} | Expected: ${r.expected} | Actual: ${r.actual} (${sign}${diff})`
      );
    }
  }

  // Print fetch errors
  if (fetchError.length > 0) {
    console.log(`\n❌ FETCH ERROR (${fetchError.length}) - Could not download:`);
    console.log('─'.repeat(80));
    for (const r of fetchError) {
      console.log(`  ${r.cityName.padEnd(20)} ${r.state} | ${r.error}`);
    }
  }

  // Print invalid JSON
  if (invalidJson.length > 0) {
    console.log(`\n❌ INVALID GEOJSON (${invalidJson.length}) - Bad response format:`);
    console.log('─'.repeat(80));
    for (const r of invalidJson) {
      console.log(`  ${r.cityName.padEnd(20)} ${r.state} | ${r.error}`);
    }
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('                           SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`  Valid boundaries:    ${valid.length}/${results.length} (${((valid.length / results.length) * 100).toFixed(0)}%)`);
  console.log(`  Count mismatches:    ${countMismatch.length}/${results.length}`);
  console.log(`  Fetch errors:        ${fetchError.length}/${results.length}`);
  console.log(`  Invalid GeoJSON:     ${invalidJson.length}/${results.length}`);
  console.log('');

  // Total districts
  const totalDistricts = valid.reduce((sum, r) => sum + (r.actual || 0), 0);
  console.log(`  Total validated districts: ${totalDistricts}`);

  // Cities needing attention
  const needsAttention = [...countMismatch, ...fetchError, ...invalidJson];
  if (needsAttention.length > 0) {
    console.log(`\n⚠️  CITIES NEEDING ATTENTION:`);
    for (const r of needsAttention) {
      console.log(`  - ${r.cityName}, ${r.state}: ${r.status} ${r.error ? `(${r.error})` : ''}`);
    }
  }
}

main().catch(console.error);
