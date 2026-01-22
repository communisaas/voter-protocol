#!/usr/bin/env npx tsx
/**
 * Run tessellation validation on city entries only (7-digit FIPS)
 *
 * POST-REMEDIATION VERSION:
 * - Filters out quarantined entries (data quality issues)
 * - Filters out at-large cities (no geographic districts)
 * - Tracks skip reasons separately from failures
 */

import { KNOWN_PORTALS, type KnownPortal } from '../src/core/registry/known-portals.generated.js';
import { QUARANTINED_PORTALS } from '../src/core/registry/quarantined-portals.generated.js';
import { isAtLargeCity } from '../src/core/registry/registry-utils.js';
import { TessellationProofValidator, type TessellationProof } from '../src/validators/council/tessellation-proof.js';
import { MunicipalBoundaryResolver } from '../src/validators/council/municipal-boundary.js';
import { EXPECTED_DISTRICT_COUNTS } from '../src/core/registry/district-count-registry.js';
import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';

// Parse limit argument
const limitArg = process.argv.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 100;

// Parse --no-filter flag to run without quarantine/at-large filtering
const noFilter = process.argv.includes('--no-filter');

async function fetchDistricts(url: string) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'VOTER-Protocol/1.0', Accept: 'application/geo+json' },
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.features || !Array.isArray(data.features)) return null;
    return data as FeatureCollection<Polygon | MultiPolygon>;
  } catch {
    return null;
  }
}

async function main() {
  console.log('=== CITY-ONLY VALIDATION (POST-REMEDIATION) ===\n');

  // Filter to 7-digit FIPS only (cities)
  const allPortals = Object.values(KNOWN_PORTALS);
  const allCities = allPortals.filter(p => /^\d{7}$/.test(p.cityFips));

  // Track filtered entries
  let quarantinedCount = 0;
  let atLargeCount = 0;

  // Filter out quarantined and at-large cities (unless --no-filter)
  const eligibleCities = noFilter ? allCities : allCities.filter(p => {
    if (QUARANTINED_PORTALS[p.cityFips]) {
      quarantinedCount++;
      return false;
    }
    if (isAtLargeCity(p.cityFips)) {
      atLargeCount++;
      return false;
    }
    return true;
  });

  const portals = eligibleCities.slice(0, limit);

  console.log(`Total registry: ${allPortals.length} entries`);
  console.log(`Cities (7-digit FIPS): ${allCities.length}`);
  if (!noFilter) {
    console.log(`  Quarantined (skipped): ${quarantinedCount}`);
    console.log(`  At-Large (skipped): ${atLargeCount}`);
    console.log(`  Eligible for validation: ${eligibleCities.length}`);
  }
  console.log(`Processing: ${portals.length}\n`);

  const boundaryResolver = new MunicipalBoundaryResolver();
  const tessellationValidator = new TessellationProofValidator();

  let passed = 0;
  let failed = 0;
  const failures: { city: string; reason: string }[] = [];

  for (let i = 0; i < portals.length; i++) {
    const portal = portals[i];
    process.stdout.write(`[${i + 1}/${portals.length}] ${portal.cityName}, ${portal.state}... `);

    // Fetch districts
    const districts = await fetchDistricts(portal.downloadUrl);
    if (!districts) {
      console.log('✗ FAIL (fetch)');
      failed++;
      failures.push({ city: `${portal.cityName}, ${portal.state}`, reason: 'fetch' });
      continue;
    }

    // Resolve boundary
    const boundaryResult = await boundaryResolver.resolve(portal.cityFips);
    if (!boundaryResult.success || !boundaryResult.boundary) {
      console.log(`✗ FAIL (boundary: ${boundaryResult.error})`);
      failed++;
      failures.push({ city: `${portal.cityName}, ${portal.state}`, reason: `boundary: ${boundaryResult.error}` });
      continue;
    }

    // Expected count
    const registryEntry = EXPECTED_DISTRICT_COUNTS[portal.cityFips];
    const expectedCount = registryEntry?.expectedDistrictCount ?? districts.features.length;

    // Tessellation proof
    const proof = tessellationValidator.prove(
      districts,
      boundaryResult.boundary.geometry,
      expectedCount,
      boundaryResult.boundary.landAreaSqM,
      undefined,
      boundaryResult.boundary.waterAreaSqM,
      portal.cityFips
    );

    if (proof.valid) {
      console.log('✓ PASS');
      passed++;
    } else {
      const coverage = (proof.diagnostics.coverageRatio * 100).toFixed(1);
      console.log(`✗ FAIL (${proof.failedAxiom}: ${coverage}%)`);
      failed++;
      failures.push({ city: `${portal.cityName}, ${portal.state}`, reason: `${proof.failedAxiom}: ${coverage}%` });
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Passed: ${passed}/${portals.length} (${((passed / portals.length) * 100).toFixed(1)}%)`);
  console.log(`Failed: ${failed}/${portals.length}`);

  if (failures.length > 0 && failures.length <= 20) {
    console.log('\n=== FAILURES ===');
    for (const f of failures) {
      console.log(`  ${f.city}: ${f.reason}`);
    }
  }
}

main().catch(console.error);
