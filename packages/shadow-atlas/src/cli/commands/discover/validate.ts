/**
 * Discover Validate Command
 *
 * Validate a single discovered URL for data quality.
 *
 * Usage:
 *   shadow-atlas discover validate <url> [options]
 *
 * Options:
 *   --expected-count <n>  Expected feature count
 *   --city <name>         City name for context
 *   --state <code>        State code for context
 *   --output <file>       Output validation report to file
 *   --format <fmt>        Output format: json|table (default: table)
 *
 * Validation Checks:
 *   - URL accessibility (HTTP response)
 *   - GeoJSON structure validity
 *   - Feature count (reasonable range)
 *   - Geometry type check
 *   - Coordinate bounds (within US)
 *   - Common issues detection
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type { Command } from 'commander';
import { writeFile } from 'fs/promises';
import { fetchGeoJSON, fetchArcGIS, validateGeoJSON } from '../../lib/ingestion.js';

// GeoJSON types (inline to avoid external dependency issues)
interface Geometry {
  readonly type: string;
  readonly coordinates: unknown;
  readonly geometries?: readonly Geometry[];
}

interface Feature {
  readonly type: 'Feature';
  readonly geometry: Geometry | null;
  readonly properties: Record<string, unknown> | null;
}

interface FeatureCollection {
  readonly type: 'FeatureCollection';
  readonly features: readonly Feature[];
}

/**
 * Validate options from CLI
 */
interface ValidateOptions {
  readonly expectedCount?: string;
  readonly city?: string;
  readonly state?: string;
  readonly output?: string;
  readonly format: 'json' | 'table';
  readonly verbose?: boolean;
  readonly json?: boolean;
}

/**
 * Validation result
 */
interface ValidationResult {
  readonly url: string;
  readonly valid: boolean;
  readonly timestamp: string;
  readonly checks: readonly ValidationCheck[];
  readonly summary: {
    readonly passed: number;
    readonly failed: number;
    readonly warnings: number;
  };
  readonly featureCount?: number;
  readonly geometryType?: string;
  readonly bounds?: {
    readonly minLon: number;
    readonly minLat: number;
    readonly maxLon: number;
    readonly maxLat: number;
  };
  readonly error?: string;
}

/**
 * Individual validation check
 */
interface ValidationCheck {
  readonly name: string;
  readonly status: 'pass' | 'fail' | 'warn';
  readonly message: string;
  readonly details?: string;
}

/**
 * Register the validate command
 */
export function registerValidateCommand(parent: Command): void {
  parent
    .command('validate <url>')
    .description('Validate a discovered URL for data quality')
    .option('-c, --expected-count <n>', 'Expected feature count')
    .option('--city <name>', 'City name for context')
    .option('--state <code>', 'State code for context')
    .option('-o, --output <file>', 'Output validation report to file')
    .option('-f, --format <fmt>', 'Output format: json|table', 'table')
    .option('-v, --verbose', 'Verbose output')
    .option('--json', 'Output as JSON')
    .action(async (url: string, options: ValidateOptions) => {
      await executeValidate(url, options);
    });
}

/**
 * Execute the validate command
 */
async function executeValidate(url: string, options: ValidateOptions): Promise<void> {
  const format = options.json ? 'json' : options.format;

  if (format !== 'json') {
    console.log('\nShadow Atlas URL Validation');
    console.log('='.repeat(50));
    console.log(`URL: ${url}`);
    if (options.city) console.log(`City: ${options.city}`);
    if (options.state) console.log(`State: ${options.state}`);
    if (options.expectedCount) console.log(`Expected count: ${options.expectedCount}`);
    console.log('');
    console.log('Running validation checks...\n');
  }

  const result = await runValidation(url, options);

  if (format === 'json') {
    const output = JSON.stringify(result, null, 2);
    if (options.output) {
      await writeFile(options.output, output);
      console.log(`Report saved to: ${options.output}`);
    } else {
      console.log(output);
    }
  } else {
    printValidationResult(result, options.verbose);
    if (options.output) {
      await writeFile(options.output, JSON.stringify(result, null, 2));
      console.log(`\nReport also saved to: ${options.output}`);
    }
  }

  // Exit with appropriate code
  if (!result.valid) {
    process.exit(2);
  }
}

/**
 * Run all validation checks
 */
async function runValidation(
  url: string,
  options: ValidateOptions
): Promise<ValidationResult> {
  const checks: ValidationCheck[] = [];
  let data: FeatureCollection | null = null;

  // Check 1: URL accessibility
  try {
    const startTime = Date.now();
    const headResponse = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10000),
    });
    const headDuration = Date.now() - startTime;

    if (headResponse.ok) {
      checks.push({
        name: 'url_accessible',
        status: 'pass',
        message: `URL accessible (${headResponse.status})`,
        details: `Response time: ${headDuration}ms`,
      });
    } else {
      checks.push({
        name: 'url_accessible',
        status: 'fail',
        message: `URL returned ${headResponse.status}`,
      });
    }
  } catch (error) {
    checks.push({
      name: 'url_accessible',
      status: 'fail',
      message: `URL not accessible: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  // Check 2: Fetch data
  try {
    if (url.includes('FeatureServer') || url.includes('MapServer')) {
      // ArcGIS URL
      data = await fetchArcGIS(url, { timeout: 30000 });
    } else if (url.includes('f=geojson') || url.endsWith('.geojson')) {
      // GeoJSON URL
      data = await fetchGeoJSON(url, { timeout: 30000, validate: false });
    } else {
      // Try as GeoJSON first
      try {
        data = await fetchGeoJSON(url, { timeout: 30000, validate: false });
      } catch {
        // Try as ArcGIS
        data = await fetchArcGIS(url, { timeout: 30000 });
      }
    }

    checks.push({
      name: 'data_fetch',
      status: 'pass',
      message: 'Data fetched successfully',
    });
  } catch (error) {
    checks.push({
      name: 'data_fetch',
      status: 'fail',
      message: `Failed to fetch data: ${error instanceof Error ? error.message : String(error)}`,
    });

    return buildResult(url, checks, null);
  }

  // Check 3: GeoJSON structure
  try {
    validateGeoJSON(data);
    checks.push({
      name: 'geojson_structure',
      status: 'pass',
      message: 'Valid GeoJSON structure',
    });
  } catch (error) {
    checks.push({
      name: 'geojson_structure',
      status: 'fail',
      message: `Invalid GeoJSON: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  // Check 4: Feature count
  const featureCount = data?.features?.length ?? 0;
  if (featureCount === 0) {
    checks.push({
      name: 'feature_count',
      status: 'fail',
      message: 'No features in dataset',
    });
  } else if (featureCount === 1) {
    checks.push({
      name: 'feature_count',
      status: 'warn',
      message: 'Only 1 feature (possible at-large or data issue)',
    });
  } else if (featureCount > 100) {
    checks.push({
      name: 'feature_count',
      status: 'warn',
      message: `High feature count: ${featureCount} (may not be council districts)`,
    });
  } else {
    checks.push({
      name: 'feature_count',
      status: 'pass',
      message: `${featureCount} features`,
    });
  }

  // Check 5: Expected count match
  if (options.expectedCount) {
    const expected = parseInt(options.expectedCount, 10);
    const ratio = featureCount / expected;

    if (ratio >= 0.8 && ratio <= 1.2) {
      checks.push({
        name: 'expected_count_match',
        status: 'pass',
        message: `Feature count matches expected (${featureCount} vs ${expected})`,
      });
    } else if (ratio >= 0.5 && ratio <= 2.0) {
      checks.push({
        name: 'expected_count_match',
        status: 'warn',
        message: `Feature count differs from expected (${featureCount} vs ${expected})`,
      });
    } else {
      checks.push({
        name: 'expected_count_match',
        status: 'fail',
        message: `Feature count significantly different from expected (${featureCount} vs ${expected})`,
      });
    }
  }

  // Check 6: Geometry types
  const geometryTypes = new Set<string>();
  let hasNullGeometry = false;

  for (const feature of data?.features ?? []) {
    if (feature.geometry === null) {
      hasNullGeometry = true;
    } else if (feature.geometry) {
      geometryTypes.add(feature.geometry.type);
    }
  }

  if (hasNullGeometry) {
    checks.push({
      name: 'geometry_presence',
      status: 'warn',
      message: 'Some features have null geometry',
    });
  }

  if (geometryTypes.has('Polygon') || geometryTypes.has('MultiPolygon')) {
    checks.push({
      name: 'geometry_type',
      status: 'pass',
      message: `Polygon geometry found (${Array.from(geometryTypes).join(', ')})`,
    });
  } else if (geometryTypes.size === 0) {
    checks.push({
      name: 'geometry_type',
      status: 'fail',
      message: 'No valid geometries found',
    });
  } else {
    checks.push({
      name: 'geometry_type',
      status: 'warn',
      message: `Unexpected geometry type: ${Array.from(geometryTypes).join(', ')}`,
    });
  }

  // Check 7: Coordinate bounds
  const bounds = calculateBounds(data);
  if (bounds) {
    // US bounds check
    const inUS =
      bounds.minLon >= -180 &&
      bounds.maxLon <= -60 &&
      bounds.minLat >= 15 &&
      bounds.maxLat <= 75;

    if (inUS) {
      checks.push({
        name: 'coordinate_bounds',
        status: 'pass',
        message: 'Coordinates within US bounds',
        details: `[${bounds.minLon.toFixed(2)}, ${bounds.minLat.toFixed(2)}] to [${bounds.maxLon.toFixed(2)}, ${bounds.maxLat.toFixed(2)}]`,
      });
    } else {
      checks.push({
        name: 'coordinate_bounds',
        status: 'warn',
        message: 'Coordinates may be outside US',
        details: `[${bounds.minLon.toFixed(2)}, ${bounds.minLat.toFixed(2)}] to [${bounds.maxLon.toFixed(2)}, ${bounds.maxLat.toFixed(2)}]`,
      });
    }
  }

  // Check 8: Common issues
  const issues = detectCommonIssues(data);
  for (const issue of issues) {
    checks.push(issue);
  }

  return buildResult(url, checks, data);
}

/**
 * Build validation result from checks
 */
function buildResult(
  url: string,
  checks: readonly ValidationCheck[],
  data: FeatureCollection | null
): ValidationResult {
  const passed = checks.filter((c) => c.status === 'pass').length;
  const failed = checks.filter((c) => c.status === 'fail').length;
  const warnings = checks.filter((c) => c.status === 'warn').length;

  const geometryTypes = new Set<string>();
  for (const feature of data?.features ?? []) {
    if (feature.geometry) {
      geometryTypes.add(feature.geometry.type);
    }
  }

  return {
    url,
    valid: failed === 0,
    timestamp: new Date().toISOString(),
    checks,
    summary: { passed, failed, warnings },
    featureCount: data?.features?.length,
    geometryType: Array.from(geometryTypes).join(', ') || undefined,
    bounds: data ? calculateBounds(data) ?? undefined : undefined,
  };
}

/**
 * Calculate bounding box of features
 */
function calculateBounds(
  data: FeatureCollection | null
): { minLon: number; minLat: number; maxLon: number; maxLat: number } | null {
  if (!data?.features?.length) return null;

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  const processCoord = (coord: readonly number[]): void => {
    const [lon, lat] = coord;
    if (lon !== undefined && lat !== undefined) {
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
  };

  const processGeometry = (geom: Geometry): void => {
    const coords = geom.coordinates as unknown;
    switch (geom.type) {
      case 'Point':
        processCoord(coords as readonly number[]);
        break;
      case 'MultiPoint':
      case 'LineString':
        for (const coord of coords as readonly (readonly number[])[]) {
          processCoord(coord);
        }
        break;
      case 'MultiLineString':
      case 'Polygon':
        for (const ring of coords as readonly (readonly (readonly number[])[])[]) {
          for (const coord of ring) {
            processCoord(coord);
          }
        }
        break;
      case 'MultiPolygon':
        for (const poly of coords as readonly (readonly (readonly (readonly number[])[])[])[]) {
          for (const ring of poly) {
            for (const coord of ring) {
              processCoord(coord);
            }
          }
        }
        break;
      case 'GeometryCollection':
        for (const g of geom.geometries ?? []) {
          processGeometry(g);
        }
        break;
    }
  };

  for (const feature of data.features) {
    if (feature.geometry) {
      processGeometry(feature.geometry);
    }
  }

  if (minLon === Infinity) return null;

  return { minLon, minLat, maxLon, maxLat };
}

/**
 * Detect common data issues
 */
function detectCommonIssues(data: FeatureCollection | null): ValidationCheck[] {
  const issues: ValidationCheck[] = [];

  if (!data?.features?.length) return issues;

  // Check for duplicate features
  const geometryHashes = new Set<string>();
  let duplicates = 0;

  for (const feature of data.features) {
    if (feature.geometry) {
      const hash = JSON.stringify(feature.geometry.coordinates);
      if (geometryHashes.has(hash)) {
        duplicates++;
      }
      geometryHashes.add(hash);
    }
  }

  if (duplicates > 0) {
    issues.push({
      name: 'duplicate_geometries',
      status: 'warn',
      message: `${duplicates} potential duplicate geometries detected`,
    });
  }

  // Check for properties that indicate district data
  const hasDistrictField = data.features.some((f: Feature) => {
    const props = f.properties ?? {};
    const keys = Object.keys(props).map((k) => k.toLowerCase());
    return keys.some(
      (k) =>
        k.includes('district') ||
        k.includes('ward') ||
        k.includes('council') ||
        k.includes('district_id') ||
        k === 'id' ||
        k === 'name'
    );
  });

  if (hasDistrictField) {
    issues.push({
      name: 'district_fields',
      status: 'pass',
      message: 'District-related fields found in properties',
    });
  } else {
    issues.push({
      name: 'district_fields',
      status: 'warn',
      message: 'No obvious district identifier fields found',
    });
  }

  // Check for very small or very large geometries (possible issues)
  // This is a simple heuristic check
  let suspiciouslySmall = 0;
  let suspiciouslyLarge = 0;

  for (const feature of data.features) {
    if (feature.geometry && (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon')) {
      const bounds = calculateFeatureBounds(feature);
      if (bounds) {
        const width = bounds.maxLon - bounds.minLon;
        const height = bounds.maxLat - bounds.minLat;
        const area = width * height;

        if (area < 0.0001) {
          suspiciouslySmall++;
        } else if (area > 10) {
          suspiciouslyLarge++;
        }
      }
    }
  }

  if (suspiciouslySmall > 0) {
    issues.push({
      name: 'small_geometries',
      status: 'warn',
      message: `${suspiciouslySmall} features have very small extents`,
    });
  }

  if (suspiciouslyLarge > 0) {
    issues.push({
      name: 'large_geometries',
      status: 'warn',
      message: `${suspiciouslyLarge} features have very large extents (may not be city-level)`,
    });
  }

  return issues;
}

/**
 * Calculate bounds of a single feature
 */
function calculateFeatureBounds(
  feature: Feature
): { minLon: number; minLat: number; maxLon: number; maxLat: number } | null {
  return calculateBounds({
    type: 'FeatureCollection',
    features: [feature],
  });
}

/**
 * Print validation result in table format
 */
function printValidationResult(result: ValidationResult, verbose?: boolean): void {
  const statusIcon = (status: 'pass' | 'fail' | 'warn'): string => {
    switch (status) {
      case 'pass':
        return '[PASS]';
      case 'fail':
        return '[FAIL]';
      case 'warn':
        return '[WARN]';
    }
  };

  console.log('Validation Checks:');
  console.log('-'.repeat(60));

  for (const check of result.checks) {
    const icon = statusIcon(check.status);
    console.log(`${icon} ${check.name}: ${check.message}`);
    if (verbose && check.details) {
      console.log(`       ${check.details}`);
    }
  }

  console.log('-'.repeat(60));
  console.log('\nSummary:');
  console.log(`  Passed:   ${result.summary.passed}`);
  console.log(`  Failed:   ${result.summary.failed}`);
  console.log(`  Warnings: ${result.summary.warnings}`);

  if (result.featureCount !== undefined) {
    console.log(`\nFeature count: ${result.featureCount}`);
  }
  if (result.geometryType) {
    console.log(`Geometry types: ${result.geometryType}`);
  }
  if (result.bounds) {
    console.log(
      `Bounds: [${result.bounds.minLon.toFixed(4)}, ${result.bounds.minLat.toFixed(4)}] to [${result.bounds.maxLon.toFixed(4)}, ${result.bounds.maxLat.toFixed(4)}]`
    );
  }

  console.log('\n' + (result.valid ? 'VALIDATION PASSED' : 'VALIDATION FAILED'));
}
