/**
 * Post-Download Validator
 *
 * Validates scraped data BEFORE it enters transformation pipeline.
 * Ensures data quality and prevents garbage from corrupting Shadow Atlas.
 *
 * PHILOSOPHY: Fail fast. Reject ambiguous data. Better to have no data than wrong data.
 */

import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';

export interface ValidationResult {
  readonly valid: boolean;
  readonly confidence: number; // 0-100
  readonly issues: readonly string[];
  readonly warnings: readonly string[];
  readonly metadata: {
    readonly featureCount: number;
    readonly geometryTypes: Record<string, number>;
    readonly propertyKeys: readonly string[];
    readonly boundingBox: readonly [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  };
}

export interface ValidationConfig {
  readonly minFeatures: number;      // Default: 1
  readonly maxFeatures: number;      // Default: 100 (reject if >100, likely precincts)
  readonly requirePolygons: boolean; // Default: true
  readonly strictBounds: boolean;    // Default: true (reject if outside WGS84)
}

const DEFAULT_CONFIG: ValidationConfig = {
  minFeatures: 1,
  maxFeatures: 100,
  requirePolygons: true,
  strictBounds: true,
};

/**
 * Post-Download Validator
 *
 * Validates GeoJSON immediately after download, before transformation.
 */
export class PostDownloadValidator {
  private readonly config: ValidationConfig;

  constructor(config: Partial<ValidationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Validate GeoJSON structure and content
   *
   * CRITICAL: This runs BEFORE transformation, so we validate raw scraped data.
   */
  validate(geojson: unknown, context: { source: string; city?: string }): ValidationResult {
    const issues: string[] = [];
    const warnings: string[] = [];

    // 1. Type validation
    if (!this.isFeatureCollection(geojson)) {
      return {
        valid: false,
        confidence: 0,
        issues: ['Not a valid GeoJSON FeatureCollection'],
        warnings: [],
        metadata: {
          featureCount: 0,
          geometryTypes: {},
          propertyKeys: [],
          boundingBox: [0, 0, 0, 0],
        },
      };
    }

    const features = geojson.features;

    // 2. Feature count validation
    if (features.length < this.config.minFeatures) {
      issues.push(`Too few features: ${features.length} (min: ${this.config.minFeatures})`);
    }

    if (features.length > this.config.maxFeatures) {
      issues.push(
        `Too many features: ${features.length} (max: ${this.config.maxFeatures}) - likely precincts/parcels`
      );
    }

    // 3. Geometry type analysis
    const geometryTypes: Record<string, number> = {};
    let polygonCount = 0;

    for (const feature of features) {
      const geomType = feature.geometry?.type || 'null';
      geometryTypes[geomType] = (geometryTypes[geomType] || 0) + 1;

      if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
        polygonCount++;
      }
    }

    if (this.config.requirePolygons && polygonCount === 0) {
      issues.push('No polygon geometries found (required for district boundaries)');
    }

    if (polygonCount < features.length) {
      warnings.push(
        `Mixed geometry types: ${polygonCount}/${features.length} are polygons (${Object.keys(geometryTypes).join(', ')})`
      );
    }

    // 4. Property key analysis (detect common issues)
    const propertyKeySets = features.map((f) => Object.keys(f.properties || {}));
    const allKeys = new Set(propertyKeySets.flat());
    const propertyKeys = Array.from(allKeys);

    // Check for district-like properties
    const hasDistrictProperty = propertyKeys.some((key) =>
      /district|ward|council|member|representative/i.test(key)
    );

    if (!hasDistrictProperty) {
      warnings.push(
        `No district-like properties found (keys: ${propertyKeys.slice(0, 5).join(', ')}${propertyKeys.length > 5 ? '...' : ''})`
      );
    }

    // Check for precinct/parcel properties (red flags)
    const hasBadProperty = propertyKeys.some((key) =>
      /precinct|parcel|lot|voting|polling|canopy|zoning/i.test(key)
    );

    if (hasBadProperty) {
      issues.push(
        `Suspicious properties detected: ${propertyKeys.filter((k) => /precinct|parcel|lot|voting|polling|canopy|zoning/i.test(k)).join(', ')}`
      );
    }

    // 5. Bounding box computation + validation
    const bbox = this.computeBoundingBox(features);

    if (this.config.strictBounds) {
      const [minLon, minLat, maxLon, maxLat] = bbox;

      if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90) {
        issues.push(
          `Invalid coordinates: bbox [${minLon.toFixed(2)}, ${minLat.toFixed(2)}, ${maxLon.toFixed(2)}, ${maxLat.toFixed(2)}] outside WGS84 bounds`
        );
      }

      // Warn if bounding box is suspiciously large (> 1000km in any direction)
      const lonSpan = maxLon - minLon;
      const latSpan = maxLat - minLat;

      if (lonSpan > 10 || latSpan > 10) {
        warnings.push(
          `Large bounding box: ${lonSpan.toFixed(2)}° × ${latSpan.toFixed(2)}° (may span multiple cities)`
        );
      }

      // Warn if bounding box is suspiciously small (< 100m in any direction)
      if (lonSpan < 0.001 || latSpan < 0.001) {
        warnings.push(
          `Small bounding box: ${lonSpan.toFixed(4)}° × ${latSpan.toFixed(4)}° (may be a single building)`
        );
      }
    }

    // 6. Geometry validity (basic checks)
    for (let i = 0; i < features.length; i++) {
      const feature = features[i];
      const geom = feature.geometry;

      if (!geom) {
        issues.push(`Feature ${i} has null geometry`);
        continue;
      }

      if (geom.type === 'Polygon') {
        const polygon = geom as Polygon;
        const rings = polygon.coordinates;

        if (rings.length === 0) {
          issues.push(`Feature ${i}: Polygon has no rings`);
        }

        for (const ring of rings) {
          if (ring.length < 4) {
            issues.push(`Feature ${i}: Ring has < 4 vertices (${ring.length})`);
          }

          // Check for closed rings (first == last coordinate)
          const first = ring[0];
          const last = ring[ring.length - 1];
          if (first[0] !== last[0] || first[1] !== last[1]) {
            issues.push(`Feature ${i}: Ring not closed`);
          }
        }
      }

      if (geom.type === 'MultiPolygon') {
        const multiPolygon = geom as MultiPolygon;
        const polygons = multiPolygon.coordinates;

        if (polygons.length === 0) {
          issues.push(`Feature ${i}: MultiPolygon has no polygons`);
        }

        for (const polygon of polygons) {
          for (const ring of polygon) {
            if (ring.length < 4) {
              issues.push(`Feature ${i}: Ring has < 4 vertices (${ring.length})`);
            }
          }
        }
      }
    }

    // 7. Compute confidence score
    let confidence = 100;

    // Deduct for issues (CRITICAL - each issue blocks acceptance)
    // Precinct/parcel/voting properties = instant <60% rejection
    confidence -= issues.length * 50;

    // Deduct for warnings
    confidence -= warnings.length * 5;

    // Bonus for good signals (ONLY if no critical issues)
    if (issues.length === 0) {
      if (hasDistrictProperty) confidence += 10;
      if (polygonCount === features.length) confidence += 10; // All polygons
      if (features.length >= 3 && features.length <= 50) confidence += 10; // Reasonable count
    }

    confidence = Math.max(0, Math.min(100, confidence));

    return {
      valid: issues.length === 0,
      confidence,
      issues,
      warnings,
      metadata: {
        featureCount: features.length,
        geometryTypes,
        propertyKeys,
        boundingBox: bbox,
      },
    };
  }

  /**
   * Type guard: Is this a valid FeatureCollection?
   */
  private isFeatureCollection(value: unknown): value is FeatureCollection {
    return (
      typeof value === 'object' &&
      value !== null &&
      'type' in value &&
      value.type === 'FeatureCollection' &&
      'features' in value &&
      Array.isArray((value as FeatureCollection).features)
    );
  }

  /**
   * Compute bounding box from features
   */
  private computeBoundingBox(
    features: FeatureCollection['features']
  ): readonly [number, number, number, number] {
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;

    for (const feature of features) {
      const geom = feature.geometry;
      if (!geom) continue;

      if (geom.type === 'Polygon') {
        const polygon = geom as Polygon;
        for (const ring of polygon.coordinates) {
          for (const [lon, lat] of ring) {
            minLon = Math.min(minLon, lon);
            minLat = Math.min(minLat, lat);
            maxLon = Math.max(maxLon, lon);
            maxLat = Math.max(maxLat, lat);
          }
        }
      }

      if (geom.type === 'MultiPolygon') {
        const multiPolygon = geom as MultiPolygon;
        for (const polygon of multiPolygon.coordinates) {
          for (const ring of polygon) {
            for (const [lon, lat] of ring) {
              minLon = Math.min(minLon, lon);
              minLat = Math.min(minLat, lat);
              maxLon = Math.max(maxLon, lon);
              maxLat = Math.max(maxLat, lat);
            }
          }
        }
      }
    }

    // Handle empty feature collections
    if (!isFinite(minLon)) {
      return [0, 0, 0, 0];
    }

    return [minLon, minLat, maxLon, maxLat];
  }
}
