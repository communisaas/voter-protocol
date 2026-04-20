/**
 * Transformation Normalization Pipeline
 *
 * Normalizes validated districts: geometry simplification, metadata standardization,
 * deterministic ID generation, coordinate precision.
 *
 * DETERMINISM: Same input → same output (critical for Merkle tree reproducibility)
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type { Feature, Polygon, MultiPolygon, Position } from 'geojson';
import simplify from '@turf/simplify';
import rewind from '@turf/rewind';
import cleanCoords from '@turf/clean-coords';
import { createHash } from 'crypto';
import type {
  RawDataset,
  NormalizedDistrict,
  BoundingBox,
  ProvenanceMetadata,
  NormalizationStats,
} from './types.js';

/**
 * Normalization options
 */
export interface NormalizationOptions {
  readonly tolerance: number;          // Simplification tolerance (degrees)
  readonly coordinatePrecision: number; // Decimal places for coordinates
  readonly highQuality: boolean;       // Use high-quality simplification
}

/**
 * Default normalization options
 */
const DEFAULT_OPTIONS: NormalizationOptions = {
  tolerance: 0.0001,         // ~11 meters at equator
  coordinatePrecision: 6,     // 0.11m accuracy
  highQuality: true,
};

/**
 * Normalizer
 *
 * Transforms validated districts into canonical form for indexing + Merkle tree
 */
export class TransformationNormalizer {
  private options: NormalizationOptions;

  constructor(options: Partial<NormalizationOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Normalize a single dataset
   *
   * DETERMINISTIC: Same input → same normalized districts
   *
   * @param dataset - Validated raw dataset
   * @returns Array of normalized districts
   */
  normalize(dataset: RawDataset): readonly NormalizedDistrict[] {
    const normalized: NormalizedDistrict[] = [];

    for (let i = 0; i < dataset.geojson.features.length; i++) {
      const feature = dataset.geojson.features[i];
      const district = this.normalizeFeature(feature, dataset.provenance, i);
      if (district) normalized.push(district);
    }

    return normalized;
  }

  /**
   * Batch normalize multiple datasets
   *
   * @param datasets - Array of validated datasets
   * @returns Array of normalized districts + statistics
   */
  normalizeBatch(
    datasets: readonly RawDataset[]
  ): { districts: readonly NormalizedDistrict[]; stats: NormalizationStats } {
    const allDistricts: NormalizedDistrict[] = [];
    let totalVerticesBefore = 0;
    let totalVerticesAfter = 0;
    let featureCount = 0;

    for (const dataset of datasets) {
      for (let i = 0; i < dataset.geojson.features.length; i++) {
        const feature = dataset.geojson.features[i];

        // R41-FIX: Guard countVertices against null geometry (RFC 7946 §3.2)
        const verticesBefore = feature.geometry ? this.countVertices(feature) : 0;
        totalVerticesBefore += verticesBefore;
        featureCount++;

        const district = this.normalizeFeature(feature, dataset.provenance, i);
        if (!district) continue;
        allDistricts.push(district);

        // Count vertices after normalization
        const verticesAfter = this.countVerticesFromGeometry(district.geometry);
        totalVerticesAfter += verticesAfter;
      }
    }

    return {
      districts: allDistricts,
      stats: {
        total: featureCount,
        normalized: allDistricts.length,
        avgVertexCountBefore: featureCount > 0 ? totalVerticesBefore / featureCount : 0,
        avgVertexCountAfter: featureCount > 0 ? totalVerticesAfter / featureCount : 0,
        simplificationRatio: totalVerticesBefore > 0 ? totalVerticesAfter / totalVerticesBefore : 1,
      },
    };
  }

  /**
   * Normalize a single feature into a district
   */
  private normalizeFeature(
    feature: Feature,
    provenance: ProvenanceMetadata,
    index: number
  ): NormalizedDistrict | null {
    // R40-FIX: Guard against null geometry (valid per RFC 7946 §3.2)
    if (!feature.geometry) {
      console.warn('Skipping feature with null geometry', { index });
      return null;
    }
    // Guard against non-polygonal geometry types
    if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') {
      console.warn('Skipping non-polygonal feature', { type: feature.geometry.type, index });
      return null;
    }
    // STEP 1: Normalize geometry
    const normalizedGeometry = this.normalizeGeometry(
      feature.geometry as Polygon | MultiPolygon
    );

    // R41-FIX: normalizeGeometry returns null if post-simplification geometry is degenerate
    if (!normalizedGeometry) {
      console.warn('Skipping feature with degenerate post-simplification geometry', { index });
      return null;
    }

    // STEP 2: Extract metadata
    const name = this.extractName(feature, index);
    const jurisdiction = this.extractJurisdiction(provenance);
    const districtType = this.inferDistrictType(feature.properties || {});

    // STEP 3: Compute bounding box
    const bbox = this.computeBoundingBox(normalizedGeometry);

    // STEP 4: Generate deterministic ID
    const id = this.generateID(jurisdiction, name, normalizedGeometry);

    return {
      id,
      name,
      jurisdiction,
      districtType,
      geometry: normalizedGeometry,
      provenance,
      bbox: [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat],
    };
  }

  /**
   * Normalize geometry: simplify, clean, reproject, round coordinates
   *
   * DETERMINISTIC: Each step is deterministic
   */
  private normalizeGeometry(
    geometry: Polygon | MultiPolygon
  ): (Polygon | MultiPolygon) | null {
    // STEP 1: Clean coordinates (remove duplicates, invalid points)
    let feature: Feature = {
      type: 'Feature',
      properties: {},
      geometry,
    };

    feature = cleanCoords(feature) as Feature;

    // STEP 2: Rewind (ensure right-hand rule for exterior rings)
    feature = rewind(feature, { reverse: false }) as Feature;

    // STEP 3: Simplify (reduce vertex count while preserving shape)
    feature = simplify(feature, {
      tolerance: this.options.tolerance,
      highQuality: this.options.highQuality,
    }) as Feature;

    // R40-FIX: Validate post-simplification geometry is not degenerate
    // R41-FIX: Return null instead of throwing — allows batch to continue past bad features
    if (!feature.geometry || !this.hasMinimumVertices(feature.geometry as Polygon | MultiPolygon)) {
      return null;
    }

    // STEP 4: Round coordinates to precision
    const roundedGeometry = this.roundCoordinates(
      feature.geometry as Polygon | MultiPolygon
    );

    return roundedGeometry;
  }

  /**
   * Round coordinates to fixed precision (deterministic)
   */
  private roundCoordinates(
    geometry: Polygon | MultiPolygon
  ): Polygon | MultiPolygon {
    const precision = this.options.coordinatePrecision;

    if (geometry.type === 'Polygon') {
      return {
        type: 'Polygon',
        coordinates: geometry.coordinates.map(ring => {
          const rounded = ring.map(coord => this.roundPosition(coord, precision));
          // R82-Enforce ring closure after rounding — rounding can break first==last invariant
          if (rounded.length >= 4) {
            const first = rounded[0];
            const last = rounded[rounded.length - 1];
            if (first[0] !== last[0] || first[1] !== last[1]) {
              rounded[rounded.length - 1] = [...first];
            }
          }
          return rounded;
        }),
      };
    } else {
      return {
        type: 'MultiPolygon',
        coordinates: geometry.coordinates.map(polygon =>
          polygon.map(ring => {
            const rounded = ring.map(coord => this.roundPosition(coord, precision));
            // R82-Enforce ring closure after rounding — rounding can break first==last invariant
            if (rounded.length >= 4) {
              const first = rounded[0];
              const last = rounded[rounded.length - 1];
              if (first[0] !== last[0] || first[1] !== last[1]) {
                rounded[rounded.length - 1] = [...first];
              }
            }
            return rounded;
          })
        ),
      };
    }
  }

  /**
   * Round a single position to precision
   */
  private roundPosition(
    position: Position,
    precision: number
  ): Position {
    const factor = Math.pow(10, precision);
    return [
      Math.round(position[0] * factor) / factor,
      Math.round(position[1] * factor) / factor,
    ];
  }

  /**
   * Extract district name from feature properties
   */
  private extractName(feature: Feature, index: number): string {
    const props = feature.properties || {};

    // Try common name fields (case-insensitive)
    const nameFields = [
      'NAME',
      'name',
      'Name',
      'DISTRICT_NAME',
      'district_name',
      'DIST_NAME',
      'dist_name',
      'WARD',
      'ward',
      'DISTRICT',
      'district',
    ];

    for (const field of nameFields) {
      if (props[field] !== undefined && props[field] !== null) {
        return String(props[field]);
      }
    }

    // Fallback: Try ID fields
    const idFields = ['OBJECTID', 'FID', 'ID', 'id'];
    for (const field of idFields) {
      if (props[field] !== undefined && props[field] !== null) {
        return `District ${props[field]}`;
      }
    }

    // Last resort: Use index
    return `District ${index + 1}`;
  }

  /**
   * Extract jurisdiction from provenance
   */
  private extractJurisdiction(provenance: ProvenanceMetadata): string {
    // Use provenance jurisdiction if available
    if (provenance.jurisdiction) {
      return provenance.jurisdiction;
    }

    // Try to extract from source URL
    const url = provenance.source;

    // Extract city/state from common patterns
    // Example: "geodata.hawaii.gov" → "Hawaii"
    const hostMatch = url.match(/geodata\.([a-z]+)\.gov/i);
    if (hostMatch) {
      return hostMatch[1];
    }

    // Fallback: "Unknown"
    return 'Unknown';
  }

  /**
   * Infer district type from properties
   */
  private inferDistrictType(
    properties: Record<string, unknown>
  ): 'council' | 'ward' | 'municipal' {
    // R78-H4-T: Check property values directly instead of JSON.stringify per feature.
    // Previous implementation serialized the entire properties object to string
    // (95K unnecessary serializations during national builds) and could misclassify
    // districts whose property values incidentally contained "council" or "ward"
    // (e.g., city name "Council Bluffs").
    for (const val of Object.values(properties)) {
      if (typeof val !== 'string') continue;
      const lower = val.toLowerCase();
      if (lower === 'council' || lower.includes('council district')) {
        return 'council';
      }
      if (lower === 'ward' || lower.includes('ward ')) {
        return 'ward';
      }
    }

    return 'municipal';
  }

  /**
   * Compute bounding box from geometry
   */
  private computeBoundingBox(
    geometry: Polygon | MultiPolygon
  ): BoundingBox {
    const coords = this.extractAllCoordinates(geometry);
    // R40-FIX: Guard against empty coordinate sets (degenerate geometry)
    if (coords.length === 0) {
      throw new Error('Cannot compute bounding box for geometry with zero coordinates');
    }
    // Iterative min/max avoids stack overflow on large polygons
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const c of coords) {
      if (c[0] < minLon) minLon = c[0];
      if (c[0] > maxLon) maxLon = c[0];
      if (c[1] < minLat) minLat = c[1];
      if (c[1] > maxLat) maxLat = c[1];
    }
    // R40-FIX: Sanity-check bbox values are finite (guards against NaN/Infinity propagation)
    if (!Number.isFinite(minLon) || !Number.isFinite(maxLon) || !Number.isFinite(minLat) || !Number.isFinite(maxLat)) {
      throw new Error(`Bounding box contains non-finite values: [${minLon}, ${minLat}, ${maxLon}, ${maxLat}]`);
    }
    return { minLon, maxLon, minLat, maxLat };
  }

  /**
   * Extract all coordinates from geometry
   */
  private extractAllCoordinates(
    geometry: Polygon | MultiPolygon
  ): Position[] {
    const coords: Position[] = [];

    // Use for-of loop instead of spread to avoid stack overflow on large rings (50K+ vertices)
    if (geometry.type === 'Polygon') {
      for (const ring of geometry.coordinates) {
        for (const coord of ring) {
          coords.push(coord);
        }
      }
    } else {
      for (const polygon of geometry.coordinates) {
        for (const ring of polygon) {
          for (const coord of ring) {
            coords.push(coord);
          }
        }
      }
    }

    return coords;
  }

  /**
   * R40-FIX: Check that geometry has minimum vertex count after simplification.
   * A closed polygon ring requires at least 4 coordinates (3 distinct + closing).
   */
  private hasMinimumVertices(geometry: Polygon | MultiPolygon): boolean {
    if (geometry.type === 'Polygon') {
      return geometry.coordinates.length > 0 && geometry.coordinates[0].length >= 4;
    }
    // MultiPolygon: every sub-polygon must have at least one ring with ≥4 vertices
    return geometry.coordinates.length > 0 &&
      geometry.coordinates.every(poly => poly.length > 0 && poly[0].length >= 4);
  }

  /**
   * Generate deterministic district ID
   *
   * Format: hash(jurisdiction + name + geometry) → hex string
   * This ensures same district always gets same ID
   */
  private generateID(
    jurisdiction: string,
    name: string,
    geometry: Polygon | MultiPolygon
  ): string {
    // Create canonical representation
    const canonical = JSON.stringify({
      jurisdiction,
      name: name.toLowerCase().trim(),
      geometry: this.canonicalizeGeometry(geometry),
    });

    // Hash to 16-byte ID
    const hash = createHash('sha256').update(canonical).digest();
    return hash.slice(0, 16).toString('hex'); // 32-character hex string
  }

  /**
   * Canonicalize geometry for hashing (deterministic JSON)
   */
  private canonicalizeGeometry(
    geometry: Polygon | MultiPolygon
  ): Record<string, unknown> {
    // Use same Math.round approach as roundCoordinates for consistency
    const factor = Math.pow(10, this.options.coordinatePrecision);
    // Round to precision and sort (deterministic)
    if (geometry.type === 'Polygon') {
      return {
        type: 'Polygon',
        coordinates: geometry.coordinates.map(ring =>
          ring.map(pos => [
            Math.round(pos[0] * factor) / factor,
            Math.round(pos[1] * factor) / factor,
          ])
        ),
      };
    } else {
      return {
        type: 'MultiPolygon',
        coordinates: geometry.coordinates.map(polygon =>
          polygon.map(ring =>
            ring.map(pos => [
              Math.round(pos[0] * factor) / factor,
              Math.round(pos[1] * factor) / factor,
            ])
          )
        ),
      };
    }
  }

  /**
   * Count vertices in a feature (before normalization)
   */
  private countVertices(feature: Feature): number {
    const geometry = feature.geometry;
    if (geometry.type === 'Polygon') {
      const polygon = geometry as Polygon;
      return polygon.coordinates.reduce((sum, ring) => sum + ring.length, 0);
    } else if (geometry.type === 'MultiPolygon') {
      const multiPolygon = geometry as MultiPolygon;
      return multiPolygon.coordinates.reduce(
        (sum, polygon) =>
          sum + polygon.reduce((ringSum, ring) => ringSum + ring.length, 0),
        0
      );
    }
    return 0;
  }

  /**
   * Count vertices in normalized geometry
   */
  private countVerticesFromGeometry(geometry: Polygon | MultiPolygon): number {
    if (geometry.type === 'Polygon') {
      return geometry.coordinates.reduce((sum, ring) => sum + ring.length, 0);
    } else {
      return geometry.coordinates.reduce(
        (sum, polygon) =>
          sum + polygon.reduce((ringSum, ring) => ringSum + ring.length, 0),
        0
      );
    }
  }
}
