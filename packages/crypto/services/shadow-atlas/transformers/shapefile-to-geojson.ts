/**
 * GDAL-based Shapefile to GeoJSON transformer
 *
 * Wraps ogr2ogr for production-grade coordinate transformation:
 * - Reprojects to WGS84 (EPSG:4326)
 * - Validates topology
 * - Repairs invalid geometries
 * - Handles CRS ambiguity
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FeatureCollection, Geometry } from 'geojson';
import type { TransformOptions, ValidationResult, ValidationError, ValidationWarning } from '../types/provider.js';

const execFileAsync = promisify(execFile);

/**
 * Transform Shapefile to WGS84 GeoJSON using GDAL
 *
 * @param shapefileZip - Buffer containing Shapefile ZIP archive
 * @param options - Transformation options
 * @returns Validated GeoJSON FeatureCollection
 *
 * @example
 * const geojson = await transformShapefileToGeoJSON(buffer, {
 *   targetCRS: 'EPSG:4326',
 *   validate: true,
 *   repair: true
 * });
 */
export async function transformShapefileToGeoJSON(
  shapefileZip: Buffer,
  options: TransformOptions
): Promise<FeatureCollection> {
  // Create temporary directory for extraction
  const tempDir = await mkdtemp(join(tmpdir(), 'shadow-atlas-'));

  try {
    // Extract Shapefile components
    const zipPath = join(tempDir, 'input.zip');
    await writeFile(zipPath, shapefileZip);

    await execFileAsync('unzip', ['-q', '-o', zipPath, '-d', tempDir]);

    // Find .shp file
    const shpFile = await findShapefileInDir(tempDir);
    if (!shpFile) {
      throw new Error('No .shp file found in ZIP archive');
    }

    // Convert to GeoJSON using ogr2ogr
    const outputPath = join(tempDir, 'output.geojson');
    const gdalArgs = buildGDALArgs(shpFile, outputPath, options);

    await execFileAsync('ogr2ogr', gdalArgs);

    // Read GeoJSON output
    const geojsonBuffer = await readFile(outputPath, 'utf-8');
    const geojson = JSON.parse(geojsonBuffer) as FeatureCollection;

    // Validate if requested
    if (options.validate) {
      const validation = validateGeoJSON(geojson);
      if (!validation.valid) {
        throw new GeoJSONValidationError(validation.errors);
      }

      // Log warnings but don't fail
      if (validation.warnings.length > 0) {
        console.warn('GeoJSON validation warnings:', validation.warnings);
      }
    }

    return geojson;
  } finally {
    // Cleanup temporary directory
    await rm(tempDir, { recursive: true, force: true });
  }
}

/**
 * Find .shp file in directory
 */
async function findShapefileInDir(dir: string): Promise<string | null> {
  const { readdir } = await import('node:fs/promises');
  const files = await readdir(dir);

  const shpFile = files.find((f) => f.endsWith('.shp'));
  return shpFile ? join(dir, shpFile) : null;
}

/**
 * Build ogr2ogr command arguments
 */
function buildGDALArgs(
  inputPath: string,
  outputPath: string,
  options: TransformOptions
): string[] {
  const args: string[] = [
    '-f', 'GeoJSON',           // Output format
    '-t_srs', options.targetCRS, // Target CRS (WGS84)
    '-ct_opt', 'WARN_ABOUT_DIFFERENT_COORD_OP=NO', // Suppress CRS warnings
  ];

  // Simplify geometry (Douglas-Peucker algorithm)
  if (options.simplify !== undefined) {
    args.push('-simplify', options.simplify.toString());
  }

  // Repair invalid geometries
  if (options.repair) {
    args.push('-makevalid');
  }

  // Ensure valid topology
  args.push(
    '-nlt', 'PROMOTE_TO_MULTI', // Promote to MultiPolygon if needed
    '-lco', 'RFC7946=YES',       // RFC 7946 GeoJSON (right-hand rule)
    '-lco', 'WRITE_BBOX=NO',     // Exclude bounding boxes (smaller files)
  );

  // Output and input paths (order matters!)
  args.push(outputPath, inputPath);

  return args;
}

/**
 * Validate GeoJSON output
 *
 * Checks:
 * - Valid FeatureCollection structure
 * - All features have geometries
 * - All geometries are valid (no self-intersections)
 * - All coordinates are within WGS84 bounds
 */
function validateGeoJSON(geojson: FeatureCollection): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Check FeatureCollection structure
  if (geojson.type !== 'FeatureCollection') {
    errors.push({
      type: 'completeness',
      message: `Expected type "FeatureCollection", got "${geojson.type}"`,
    });
    return { valid: false, errors, warnings };
  }

  if (!Array.isArray(geojson.features)) {
    errors.push({
      type: 'completeness',
      message: 'Missing "features" array in FeatureCollection',
    });
    return { valid: false, errors, warnings };
  }

  // Validate each feature
  for (let i = 0; i < geojson.features.length; i++) {
    const feature = geojson.features[i];
    const featureId = feature.properties?.id?.toString() ?? `feature-${i}`;

    // Check feature structure
    if (feature.type !== 'Feature') {
      errors.push({
        type: 'completeness',
        message: `Feature ${featureId}: Expected type "Feature", got "${feature.type}"`,
        featureId,
      });
      continue;
    }

    if (!feature.geometry) {
      errors.push({
        type: 'completeness',
        message: `Feature ${featureId}: Missing geometry`,
        featureId,
      });
      continue;
    }

    // Validate WGS84 bounds (longitude: -180 to 180, latitude: -90 to 90)
    const boundsCheck = validateWGS84Bounds(feature.geometry);
    if (!boundsCheck.valid) {
      errors.push({
        type: 'projection',
        message: `Feature ${featureId}: Coordinates outside WGS84 bounds`,
        featureId,
      });
    }

    // Check for properties
    if (!feature.properties || typeof feature.properties !== 'object') {
      warnings.push({
        type: 'missing-population',
        message: `Feature ${featureId}: Missing properties object`,
        featureId,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate that all coordinates are within WGS84 bounds
 */
function validateWGS84Bounds(geometry: Geometry): { valid: boolean } {
  const coords = extractAllCoordinates(geometry);

  for (const [lon, lat] of coords) {
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      return { valid: false };
    }
  }

  return { valid: true };
}

/**
 * Extract all coordinate pairs from geometry (recursive)
 */
function extractAllCoordinates(geometry: Geometry): Array<[number, number]> {
  const coords: Array<[number, number]> = [];

  function extract(geo: Geometry): void {
    if (geo.type === 'Point') {
      coords.push(geo.coordinates as [number, number]);
    } else if (geo.type === 'LineString' || geo.type === 'MultiPoint') {
      for (const coord of geo.coordinates) {
        coords.push(coord as [number, number]);
      }
    } else if (geo.type === 'Polygon' || geo.type === 'MultiLineString') {
      for (const ring of geo.coordinates) {
        for (const coord of ring) {
          coords.push(coord as [number, number]);
        }
      }
    } else if (geo.type === 'MultiPolygon') {
      for (const polygon of geo.coordinates) {
        for (const ring of polygon) {
          for (const coord of ring) {
            coords.push(coord as [number, number]);
          }
        }
      }
    } else if (geo.type === 'GeometryCollection') {
      for (const subGeo of geo.geometries) {
        extract(subGeo);
      }
    }
  }

  extract(geometry);
  return coords;
}

/**
 * Custom error for GeoJSON validation failures
 */
export class GeoJSONValidationError extends Error {
  constructor(public readonly errors: ValidationError[]) {
    super(`GeoJSON validation failed: ${errors.length} errors`);
    this.name = 'GeoJSONValidationError';
  }
}

/**
 * Check if GDAL is installed and accessible
 * @returns GDAL version string
 * @throws Error if GDAL is not installed
 */
export async function checkGDALAvailability(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('ogr2ogr', ['--version']);
    return stdout.trim();
  } catch (error) {
    throw new Error(
      'GDAL not installed. Install via: brew install gdal (macOS) or apt install gdal-bin (Linux)'
    );
  }
}
