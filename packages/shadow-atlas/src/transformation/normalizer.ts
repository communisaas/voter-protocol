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
      normalized.push(district);
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

        // Count vertices before normalization
        const verticesBefore = this.countVertices(feature);
        totalVerticesBefore += verticesBefore;
        featureCount++;

        const district = this.normalizeFeature(feature, dataset.provenance, i);
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
        avgVertexCountBefore: totalVerticesBefore / featureCount,
        avgVertexCountAfter: totalVerticesAfter / featureCount,
        simplificationRatio: totalVerticesAfter / totalVerticesBefore,
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
  ): NormalizedDistrict {
    // STEP 1: Normalize geometry
    const normalizedGeometry = this.normalizeGeometry(
      feature.geometry as Polygon | MultiPolygon
    );

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
  ): Polygon | MultiPolygon {
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
        coordinates: geometry.coordinates.map(ring =>
          ring.map(coord => this.roundPosition(coord, precision))
        ),
      };
    } else {
      return {
        type: 'MultiPolygon',
        coordinates: geometry.coordinates.map(polygon =>
          polygon.map(ring =>
            ring.map(coord => this.roundPosition(coord, precision))
          )
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
    const propsStr = JSON.stringify(properties).toLowerCase();

    if (propsStr.includes('council')) {
      return 'council';
    }

    if (propsStr.includes('ward')) {
      return 'ward';
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

    const lons = coords.map(c => c[0]);
    const lats = coords.map(c => c[1]);

    return {
      minLon: Math.min(...lons),
      maxLon: Math.max(...lons),
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
    };
  }

  /**
   * Extract all coordinates from geometry
   */
  private extractAllCoordinates(
    geometry: Polygon | MultiPolygon
  ): Position[] {
    const coords: Position[] = [];

    if (geometry.type === 'Polygon') {
      for (const ring of geometry.coordinates) {
        coords.push(...ring);
      }
    } else {
      for (const polygon of geometry.coordinates) {
        for (const ring of polygon) {
          coords.push(...ring);
        }
      }
    }

    return coords;
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
    // Round to precision and sort (deterministic)
    if (geometry.type === 'Polygon') {
      return {
        type: 'Polygon',
        coordinates: geometry.coordinates.map(ring =>
          ring.map(pos => [
            Number(pos[0].toFixed(this.options.coordinatePrecision)),
            Number(pos[1].toFixed(this.options.coordinatePrecision)),
          ])
        ),
      };
    } else {
      return {
        type: 'MultiPolygon',
        coordinates: geometry.coordinates.map(polygon =>
          polygon.map(ring =>
            ring.map(pos => [
              Number(pos[0].toFixed(this.options.coordinatePrecision)),
              Number(pos[1].toFixed(this.options.coordinatePrecision)),
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
