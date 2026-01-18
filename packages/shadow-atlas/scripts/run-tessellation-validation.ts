#!/usr/bin/env npx tsx
/**
 * Tessellation Validation Runner
 *
 * Validates council district data against TIGER municipal boundaries
 * using mathematical tessellation proofs.
 *
 * USAGE:
 *   npx tsx scripts/run-tessellation-validation.ts [--limit N] [--fips FIPS] [--verbose]
 *
 * OPTIONS:
 *   --limit N     Process only first N cities (default: all)
 *   --fips FIPS   Validate single city by FIPS code
 *   --verbose     Show detailed proof diagnostics
 *   --generate    Output registry entries for cities that pass
 *
 * OUTPUT:
 *   - Summary statistics
 *   - Failed cities with remediation guidance
 *   - Optional registry entries (--generate)
 */

import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import { KNOWN_PORTALS, type KnownPortal } from '../src/core/registry/known-portals.js';
import { QUARANTINED_PORTALS } from '../src/core/registry/quarantined-portals.js';
import { TessellationProofValidator, type TessellationProof } from '../src/validators/council/tessellation-proof.js';
import { MunicipalBoundaryResolver, type MunicipalBoundary } from '../src/validators/council/municipal-boundary.js';
import { EXPECTED_DISTRICT_COUNTS, type DistrictCountRecord } from '../src/core/registry/district-count-registry.js';

// =============================================================================
// Configuration
// =============================================================================

interface Config {
  limit: number | null;
  fips: string | null;
  verbose: boolean;
  generate: boolean;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  const config: Config = {
    limit: null,
    fips: null,
    verbose: false,
    generate: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--limit':
        config.limit = parseInt(args[++i], 10);
        break;
      case '--fips':
        config.fips = args[++i];
        break;
      case '--verbose':
        config.verbose = true;
        break;
      case '--generate':
        config.generate = true;
        break;
    }
  }

  return config;
}

// =============================================================================
// Result Types
// =============================================================================

interface ValidationResult {
  fips: string;
  cityName: string;
  state: string;
  stage: 'fetch' | 'boundary' | 'tessellation' | 'complete';
  success: boolean;
  error: string | null;
  proof: TessellationProof | null;
  boundary: MunicipalBoundary | null;
  actualCount: number;
  expectedCount: number | null;
  remediation: string | null;
}

// =============================================================================
// Fetch Districts
// =============================================================================

interface FetchResult {
  districts: FeatureCollection<Polygon | MultiPolygon>;
  /** Authoritative area sum from source (bypasses GeoJSON projection artifacts) */
  authoritativeArea: number | null;
}

/**
 * Known area field names from various GIS platforms
 * ArcGIS uses Shape__Area (in native projection units, often sq feet)
 */
const AREA_FIELD_NAMES = ['Shape__Area', 'SHAPE_Area', 'shape_area', 'Area', 'AREA'];

/**
 * Smart area conversion that validates against computed polygon area
 *
 * The problem: Shape__Area can be in sq ft (ArcGIS State Plane) or sq m (Web Mercator).
 * We can't reliably detect units from the values alone.
 *
 * Solution: Skip authoritative area for now - rely on geometry rewind + turf.area()
 * The rewind fix handles winding order issues that were the main source of area errors.
 *
 * TODO: Implement projection-aware area validation if needed in future
 */
function detectAndConvertArea(_totalArea: number, _featureCount: number): number | null {
  // Disabled: The heuristic-based conversion is unreliable
  // Different cities use different projections (State Plane vs Web Mercator)
  // and different units (sq ft vs sq m)
  //
  // Better approach: Trust turf.area() on rewound geometries
  // This correctly handles NYC (was 55% due to winding) and won't
  // break cities like Boston where Shape__Area units are ambiguous
  return null;
}

async function fetchDistricts(url: string): Promise<FetchResult | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'VOTER-Protocol/1.0 (Tessellation-Validation)',
        Accept: 'application/geo+json, application/json',
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    // Handle ArcGIS feature collection wrapper
    if (!data.features || !Array.isArray(data.features)) {
      return null;
    }

    // Extract authoritative area from properties if available
    let authoritativeArea: number | null = null;
    const features = data.features;

    if (features.length > 0) {
      const props = features[0].properties || {};
      const areaField = AREA_FIELD_NAMES.find((f) => f in props);

      if (areaField) {
        let totalArea = 0;
        for (const feature of features) {
          const area = feature.properties?.[areaField];
          if (typeof area === 'number') {
            totalArea += Math.abs(area); // Abs handles negative winding
          }
        }
        authoritativeArea = detectAndConvertArea(totalArea, features.length);
      }
    }

    return {
      districts: data as FeatureCollection<Polygon | MultiPolygon>,
      authoritativeArea,
    };
  } catch {
    return null;
  }
}

// =============================================================================
// Validation Pipeline
// =============================================================================

async function validateCity(
  portal: KnownPortal,
  boundaryResolver: MunicipalBoundaryResolver,
  tessellationValidator: TessellationProofValidator,
  verbose: boolean
): Promise<ValidationResult> {
  const result: ValidationResult = {
    fips: portal.cityFips,
    cityName: portal.cityName,
    state: portal.state,
    stage: 'fetch',
    success: false,
    error: null,
    proof: null,
    boundary: null,
    actualCount: 0,
    expectedCount: null,
    remediation: null,
  };

  // Stage 1: Fetch district data
  const fetchResult = await fetchDistricts(portal.downloadUrl);

  if (!fetchResult) {
    result.error = 'Failed to fetch district GeoJSON';
    result.remediation = 'Check URL validity and network connectivity';
    return result;
  }

  const { districts, authoritativeArea } = fetchResult;
  result.actualCount = districts.features.length;
  result.stage = 'boundary';

  // Stage 2: Resolve municipal boundary
  const boundaryResult = await boundaryResolver.resolve(portal.cityFips);

  if (!boundaryResult.success || !boundaryResult.boundary) {
    result.error = `Boundary resolution failed: ${boundaryResult.error}`;
    result.remediation = 'Verify FIPS code validity or TIGER service availability';
    return result;
  }

  result.boundary = boundaryResult.boundary;
  result.stage = 'tessellation';

  // Get expected count if in registry
  const registryEntry = EXPECTED_DISTRICT_COUNTS[portal.cityFips];
  result.expectedCount = registryEntry?.expectedDistrictCount ?? null;

  // Use actual count if no registry entry (proof still validates geometric properties)
  const expectedForProof = result.expectedCount ?? result.actualCount;

  // Stage 3: Tessellation proof
  // Pass land area to exclude water from coverage calculations (coastal cities)
  // Pass authoritative area to bypass GeoJSON projection artifacts
  // Pass water area for coastal city detection (wider tolerance for water-inclusive districts)
  // Pass FIPS for cities with known coverage exceptions (e.g., Portland, NYC)
  const proof = tessellationValidator.prove(
    districts,
    boundaryResult.boundary.geometry,
    expectedForProof,
    boundaryResult.boundary.landAreaSqM,
    authoritativeArea ?? undefined,
    boundaryResult.boundary.waterAreaSqM,
    portal.cityFips
  );

  result.proof = proof;
  result.stage = 'complete';

  if (!proof.valid) {
    result.error = proof.reason ?? 'Tessellation proof failed';
    result.remediation = getRemediation(proof);
    return result;
  }

  result.success = true;
  return result;
}

function getRemediation(proof: TessellationProof): string {
  switch (proof.failedAxiom) {
    case 'exclusivity':
      return 'Overlapping districts detected - check for duplicate features or merged layers';
    case 'exhaustivity':
      return `Coverage ${(proof.diagnostics.coverageRatio * 100).toFixed(1)}% - missing ${proof.diagnostics.uncoveredArea.toFixed(0)} sq meters`;
    case 'containment':
      return `Districts extend ${proof.diagnostics.outsideBoundaryArea.toFixed(0)} sq meters beyond boundary - check data/boundary vintage`;
    case 'cardinality':
      return `Expected ${proof.diagnostics.expectedCount}, found ${proof.diagnostics.districtCount}`;
    default:
      return 'Unknown failure - manual investigation required';
  }
}

// =============================================================================
// Registry Entry Generation
// =============================================================================

function generateRegistryEntry(result: ValidationResult): DistrictCountRecord {
  return {
    fips: result.fips,
    cityName: result.cityName,
    state: result.state,
    expectedDistrictCount: result.actualCount,
    governanceType: 'district-based',
    source: 'tessellation-validation',
    lastVerified: new Date().toISOString().split('T')[0],
    notes: `Auto-generated from tessellation proof (coverage: ${((result.proof?.diagnostics.coverageRatio ?? 0) * 100).toFixed(1)}%)`,
  };
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const config = parseArgs();

  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║           TESSELLATION VALIDATION RUNNER                       ║');
  console.log('║     Mathematical Proof of Council District Correctness         ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Get cities to validate, excluding quarantined entries
  const quarantinedFips = new Set(Object.keys(QUARANTINED_PORTALS));
  let portals: KnownPortal[];

  if (config.fips) {
    if (quarantinedFips.has(config.fips)) {
      console.error(`City with FIPS ${config.fips} is quarantined - skipping`);
      process.exit(0);
    }
    const portal = KNOWN_PORTALS[config.fips];
    if (!portal) {
      console.error(`City with FIPS ${config.fips} not found in registry`);
      process.exit(1);
    }
    portals = [portal];
  } else {
    // Filter out quarantined entries from validation
    portals = Object.values(KNOWN_PORTALS).filter(
      (p) => !quarantinedFips.has(p.cityFips)
    );
    if (config.limit) {
      portals = portals.slice(0, config.limit);
    }
  }

  const skippedCount = Object.keys(KNOWN_PORTALS).length - portals.length - (config.limit ? 0 : 0);
  console.log(`Processing ${portals.length} cities (${quarantinedFips.size} quarantined entries skipped)...\n`);

  // Initialize validators
  const boundaryResolver = new MunicipalBoundaryResolver();
  const tessellationValidator = new TessellationProofValidator();

  // Track results
  const results: ValidationResult[] = [];
  const passed: ValidationResult[] = [];
  const failed: ValidationResult[] = [];
  const newRegistryEntries: DistrictCountRecord[] = [];

  // Process cities
  for (let i = 0; i < portals.length; i++) {
    const portal = portals[i];
    const progress = `[${i + 1}/${portals.length}]`;

    process.stdout.write(`${progress} ${portal.cityName}, ${portal.state}... `);

    const result = await validateCity(
      portal,
      boundaryResolver,
      tessellationValidator,
      config.verbose
    );

    results.push(result);

    if (result.success) {
      passed.push(result);
      console.log('✓ PASS');

      // Generate registry entry if not already in registry
      if (!EXPECTED_DISTRICT_COUNTS[result.fips] && config.generate) {
        newRegistryEntries.push(generateRegistryEntry(result));
      }
    } else {
      failed.push(result);
      console.log(`✗ FAIL (${result.stage}: ${result.error})`);
    }

    if (config.verbose && result.proof) {
      const d = result.proof.diagnostics;
      console.log(`    Districts: ${d.districtCount}/${d.expectedCount}`);
      console.log(`    Coverage: ${(d.coverageRatio * 100).toFixed(2)}%`);
      console.log(`    Overlap: ${d.totalOverlapArea.toFixed(0)} sq m`);
      console.log(`    Outside: ${d.outsideBoundaryArea.toFixed(0)} sq m`);
    }

    // Rate limiting
    await new Promise((r) => setTimeout(r, 100));
  }

  // Print summary
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                         SUMMARY                                ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log(`Total processed: ${results.length}`);
  console.log(`  Passed: ${passed.length} (${((passed.length / results.length) * 100).toFixed(1)}%)`);
  console.log(`  Failed: ${failed.length} (${((failed.length / results.length) * 100).toFixed(1)}%)`);

  if (failed.length > 0) {
    console.log('\n── FAILURES BY STAGE ──');
    const byStage = failed.reduce(
      (acc, r) => {
        acc[r.stage] = (acc[r.stage] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
    for (const [stage, count] of Object.entries(byStage)) {
      console.log(`  ${stage}: ${count}`);
    }

    console.log('\n── FAILED CITIES ──');
    for (const result of failed.slice(0, 20)) {
      console.log(`  ${result.cityName}, ${result.state} (${result.fips})`);
      console.log(`    Stage: ${result.stage}`);
      console.log(`    Error: ${result.error}`);
      console.log(`    Remediation: ${result.remediation}`);
    }
    if (failed.length > 20) {
      console.log(`  ... and ${failed.length - 20} more`);
    }
  }

  // Output new registry entries
  if (config.generate && newRegistryEntries.length > 0) {
    console.log('\n── NEW REGISTRY ENTRIES ──');
    console.log(`Generated ${newRegistryEntries.length} entries for cities not in registry:\n`);

    for (const entry of newRegistryEntries.slice(0, 10)) {
      console.log(`  '${entry.fips}': {`);
      console.log(`    fips: '${entry.fips}',`);
      console.log(`    cityName: '${entry.cityName}',`);
      console.log(`    state: '${entry.state}',`);
      console.log(`    expectedDistrictCount: ${entry.expectedDistrictCount},`);
      console.log(`    governanceType: '${entry.governanceType}',`);
      console.log(`    source: '${entry.source}',`);
      console.log(`    lastVerified: '${entry.lastVerified}',`);
      console.log(`    notes: '${entry.notes}',`);
      console.log(`  },\n`);
    }

    if (newRegistryEntries.length > 10) {
      console.log(`  ... and ${newRegistryEntries.length - 10} more`);
    }
  }

  // Exit with appropriate code
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(console.error);
