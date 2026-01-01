/**
 * Geometry Comparison Utilities
 *
 * Provides spatial geometry comparison functions for cross-validation
 * between TIGER Census data and state GIS portal data.
 *
 * VALIDATION APPROACH:
 * - Intersection over Union (IoU/Jaccard) for boundary matching
 * - Area-based similarity for geometry verification
 * - Centroid distance for feature matching fallback
 *
 * PHILOSOPHY:
 * - 95%+ IoU indicates excellent match (typical for same-source data)
 * - 90-95% IoU indicates minor boundary differences (acceptable)
 * - <90% IoU indicates significant discrepancy (manual review required)
 *
 * INTEGRATION:
 * - Used by CrossValidator for TIGER vs state boundary comparison
 * - Provides confidence scores for data quality assessment
 */

import type { Polygon, MultiPolygon, Feature } from 'geojson';
import { area, intersect, featureCollection, centroid, distance, point } from '@turf/turf';
import { polygon as turfPolygon, multiPolygon as turfMultiPolygon } from '@turf/helpers';

/**
 * Geometry match result
 */
export interface GeometryMatchResult {
  /** Whether geometries match within tolerance */
  readonly matches: boolean;

  /** Intersection over Union ratio (0-1) */
  readonly iou: number;

  /** Intersection area in square meters */
  readonly intersectionArea: number;

  /** Union area in square meters */
  readonly unionArea: number;

  /** Area of first geometry in square meters */
  readonly area1: number;

  /** Area of second geometry in square meters */
  readonly area2: number;

  /** Area difference as percentage */
  readonly areaDifferencePercent: number;
}

/**
 * Calculate intersection area between two geometries
 *
 * @param geom1 - First polygon or multipolygon
 * @param geom2 - Second polygon or multipolygon
 * @returns Intersection area in square meters
 */
export function calculateIntersectionArea(
  geom1: Polygon | MultiPolygon,
  geom2: Polygon | MultiPolygon
): number {
  try {
    const feature1 = geom1.type === 'Polygon'
      ? turfPolygon(geom1.coordinates)
      : turfMultiPolygon(geom1.coordinates);

    const feature2 = geom2.type === 'Polygon'
      ? turfPolygon(geom2.coordinates)
      : turfMultiPolygon(geom2.coordinates);

    // Calculate intersection (Turf v7 requires FeatureCollection)
    // Type assertion needed because turf types are strict about Polygon vs MultiPolygon
    const fc = featureCollection([feature1, feature2] as any);
    const intersection = intersect(fc as any);

    if (!intersection) {
      return 0;
    }

    return area(intersection);
  } catch (error) {
    console.warn(`Failed to calculate intersection area: ${(error as Error).message}`);
    return 0;
  }
}

/**
 * Calculate union area between two geometries
 *
 * Uses the formula: Union = Area1 + Area2 - Intersection
 *
 * @param geom1 - First polygon or multipolygon
 * @param geom2 - Second polygon or multipolygon
 * @returns Union area in square meters
 */
export function calculateUnionArea(
  geom1: Polygon | MultiPolygon,
  geom2: Polygon | MultiPolygon
): number {
  try {
    const feature1 = geom1.type === 'Polygon'
      ? turfPolygon(geom1.coordinates)
      : turfMultiPolygon(geom1.coordinates);

    const feature2 = geom2.type === 'Polygon'
      ? turfPolygon(geom2.coordinates)
      : turfMultiPolygon(geom2.coordinates);

    const area1 = area(feature1);
    const area2 = area(feature2);
    const intersectionArea = calculateIntersectionArea(geom1, geom2);

    return area1 + area2 - intersectionArea;
  } catch (error) {
    console.warn(`Failed to calculate union area: ${(error as Error).message}`);
    return 0;
  }
}

/**
 * Calculate Jaccard similarity (Intersection over Union)
 *
 * Jaccard Index = Area(Intersection) / Area(Union)
 * - 1.0 = Perfect match
 * - 0.95+ = Excellent match (typical for same-source data)
 * - 0.90-0.95 = Good match (minor coordinate differences)
 * - <0.90 = Significant discrepancy
 *
 * @param geom1 - First polygon or multipolygon
 * @param geom2 - Second polygon or multipolygon
 * @returns Jaccard similarity coefficient (0-1)
 */
export function calculateJaccardSimilarity(
  geom1: Polygon | MultiPolygon,
  geom2: Polygon | MultiPolygon
): number {
  try {
    const feature1 = geom1.type === 'Polygon'
      ? turfPolygon(geom1.coordinates)
      : turfMultiPolygon(geom1.coordinates);

    const feature2 = geom2.type === 'Polygon'
      ? turfPolygon(geom2.coordinates)
      : turfMultiPolygon(geom2.coordinates);

    const area1 = area(feature1);
    const area2 = area(feature2);

    // If either geometry has zero area, they can't match
    if (area1 === 0 || area2 === 0) {
      return 0;
    }

    const intersectionArea = calculateIntersectionArea(geom1, geom2);
    const unionArea = area1 + area2 - intersectionArea;

    if (unionArea === 0) {
      return 0;
    }

    return intersectionArea / unionArea;
  } catch (error) {
    console.warn(`Failed to calculate Jaccard similarity: ${(error as Error).message}`);
    return 0;
  }
}

/**
 * Check if geometries match within tolerance
 *
 * @param geom1 - First polygon or multipolygon
 * @param geom2 - Second polygon or multipolygon
 * @param tolerancePercent - Minimum IoU percentage for match (default: 0.1% = 99.9% similarity)
 * @returns Match result with detailed metrics
 */
export function geometriesMatch(
  geom1: Polygon | MultiPolygon,
  geom2: Polygon | MultiPolygon,
  tolerancePercent: number = 0.1
): GeometryMatchResult {
  try {
    const feature1 = geom1.type === 'Polygon'
      ? turfPolygon(geom1.coordinates)
      : turfMultiPolygon(geom1.coordinates);

    const feature2 = geom2.type === 'Polygon'
      ? turfPolygon(geom2.coordinates)
      : turfMultiPolygon(geom2.coordinates);

    const area1 = area(feature1);
    const area2 = area(feature2);

    // Calculate intersection and union
    const intersectionArea = calculateIntersectionArea(geom1, geom2);
    const unionArea = area1 + area2 - intersectionArea;

    // Calculate IoU
    const iou = unionArea > 0 ? intersectionArea / unionArea : 0;

    // Calculate area difference
    const avgArea = (area1 + area2) / 2;
    const areaDifferencePercent = avgArea > 0
      ? (Math.abs(area1 - area2) / avgArea) * 100
      : 0;

    // Convert tolerance to decimal (0.1% = 0.999 required IoU)
    const requiredIoU = 1 - (tolerancePercent / 100);
    const matches = iou >= requiredIoU;

    return {
      matches,
      iou,
      intersectionArea,
      unionArea,
      area1,
      area2,
      areaDifferencePercent,
    };
  } catch (error) {
    console.warn(`Failed to match geometries: ${(error as Error).message}`);
    return {
      matches: false,
      iou: 0,
      intersectionArea: 0,
      unionArea: 0,
      area1: 0,
      area2: 0,
      areaDifferencePercent: 100,
    };
  }
}

/**
 * Calculate centroid of a geometry
 *
 * Used for feature matching when IDs don't align between sources.
 *
 * @param geometry - Polygon or MultiPolygon
 * @returns Centroid coordinates [lon, lat]
 */
export function calculateCentroid(
  geometry: Polygon | MultiPolygon
): [number, number] {
  try {
    const feature = geometry.type === 'Polygon'
      ? turfPolygon(geometry.coordinates)
      : turfMultiPolygon(geometry.coordinates);

    const cent = centroid(feature);
    return cent.geometry.coordinates as [number, number];
  } catch (error) {
    console.warn(`Failed to calculate centroid: ${(error as Error).message}`);
    return [0, 0];
  }
}

/**
 * Calculate distance between two centroids in meters
 *
 * @param coord1 - First coordinate [lon, lat]
 * @param coord2 - Second coordinate [lon, lat]
 * @returns Distance in meters
 */
export function calculateCentroidDistance(
  coord1: [number, number],
  coord2: [number, number]
): number {
  try {
    const from = point(coord1);
    const to = point(coord2);
    return distance(from, to, { units: 'meters' });
  } catch (error) {
    console.warn(`Failed to calculate centroid distance: ${(error as Error).message}`);
    return Number.MAX_VALUE;
  }
}

/**
 * Calculate area of a geometry in square meters
 *
 * @param geometry - Polygon or MultiPolygon
 * @returns Area in square meters
 */
export function calculateArea(
  geometry: Polygon | MultiPolygon
): number {
  try {
    const feature = geometry.type === 'Polygon'
      ? turfPolygon(geometry.coordinates)
      : turfMultiPolygon(geometry.coordinates);

    return area(feature);
  } catch (error) {
    console.warn(`Failed to calculate area: ${(error as Error).message}`);
    return 0;
  }
}
