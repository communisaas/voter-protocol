/**
 * Geographic Utilities - Shared Geometry Functions
 *
 * This file consolidates commonly duplicated geometry utilities:
 * - extractCoordinates: Extract coordinate arrays from GeoJSON features
 * - calculateCentroid: Compute centroid of a feature collection
 * - computeBoundingBox: Compute bounding box of features
 *
 * USAGE: Import these functions instead of defining locally.
 * This eliminates 5+ duplicate extractCoordinates implementations.
 */

import type {
    Feature,
    FeatureCollection,
    Geometry,
    Polygon,
    MultiPolygon,
    Position,
} from 'geojson';

// ============================================================================
// Coordinate Extraction
// ============================================================================

/**
 * Extract all coordinates from a GeoJSON Feature
 *
 * Handles Polygon and MultiPolygon geometries.
 * Returns flattened array of all coordinate positions.
 *
 * @param feature - GeoJSON Feature
 * @returns Array of [lon, lat] positions
 */
export function extractCoordinatesFromFeature(feature: Feature): Position[] {
    if (!feature.geometry) {
        return [];
    }
    return extractCoordinatesFromGeometry(feature.geometry);
}

/**
 * Extract all coordinates from a GeoJSON Geometry
 *
 * Handles Polygon and MultiPolygon geometries.
 * For other geometry types, returns empty array.
 *
 * @param geometry - GeoJSON Geometry
 * @returns Array of [lon, lat] positions
 */
export function extractCoordinatesFromGeometry(geometry: Geometry): Position[] {
    const coords: Position[] = [];

    switch (geometry.type) {
        case 'Polygon': {
            const polygon = geometry as Polygon;
            for (const ring of polygon.coordinates) {
                coords.push(...ring);
            }
            break;
        }
        case 'MultiPolygon': {
            const multiPolygon = geometry as MultiPolygon;
            for (const polygon of multiPolygon.coordinates) {
                for (const ring of polygon) {
                    coords.push(...ring);
                }
            }
            break;
        }
        case 'Point': {
            const point = geometry as { coordinates: Position };
            coords.push(point.coordinates);
            break;
        }
        case 'MultiPoint':
        case 'LineString': {
            const lineOrMultiPoint = geometry as { coordinates: Position[] };
            coords.push(...lineOrMultiPoint.coordinates);
            break;
        }
        case 'MultiLineString': {
            const multiLine = geometry as { coordinates: Position[][] };
            for (const line of multiLine.coordinates) {
                coords.push(...line);
            }
            break;
        }
        // GeometryCollection not handled - returns empty
    }

    return coords;
}

/**
 * Extract exterior ring coordinates only from polygonal geometry
 *
 * Use this for bounding box calculations where only exterior matters.
 *
 * @param geometry - Polygon or MultiPolygon geometry
 * @returns Array of exterior ring coordinates
 */
export function extractExteriorCoordinates(
    geometry: Polygon | MultiPolygon
): Position[] {
    if (geometry.type === 'Polygon') {
        return geometry.coordinates[0]; // First ring is exterior
    } else {
        // MultiPolygon: all exterior rings
        return geometry.coordinates.flatMap(polygon => polygon[0]);
    }
}

// ============================================================================
// Centroid Calculation
// ============================================================================

/**
 * Geographic point (latitude/longitude)
 */
export interface GeoPoint {
    readonly lat: number;
    readonly lon: number;
}

/**
 * Calculate centroid of a GeoJSON FeatureCollection
 *
 * Uses simple average of all coordinates (faster than true geometric centroid).
 * For more precise centroid, use turf.js centroid().
 *
 * @param geojson - GeoJSON FeatureCollection
 * @returns Centroid point
 * @throws Error if no coordinates found
 */
export function calculateCentroid(geojson: FeatureCollection): GeoPoint {
    let totalLat = 0;
    let totalLon = 0;
    let pointCount = 0;

    for (const feature of geojson.features) {
        const coords = extractCoordinatesFromFeature(feature);
        for (const [lon, lat] of coords) {
            totalLat += lat;
            totalLon += lon;
            pointCount++;
        }
    }

    if (pointCount === 0) {
        throw new Error('Cannot calculate centroid: no coordinates found');
    }

    return {
        lat: totalLat / pointCount,
        lon: totalLon / pointCount,
    };
}

/**
 * Calculate centroid of a single feature
 *
 * @param feature - GeoJSON Feature
 * @returns Centroid point
 * @throws Error if no coordinates found
 */
export function calculateFeatureCentroid(feature: Feature): GeoPoint {
    const coords = extractCoordinatesFromFeature(feature);

    if (coords.length === 0) {
        throw new Error('Cannot calculate centroid: no coordinates found');
    }

    let totalLat = 0;
    let totalLon = 0;

    for (const [lon, lat] of coords) {
        totalLat += lat;
        totalLon += lon;
    }

    return {
        lat: totalLat / coords.length,
        lon: totalLon / coords.length,
    };
}

// ============================================================================
// Bounding Box Calculation
// ============================================================================

/**
 * Bounding box type: [minLon, minLat, maxLon, maxLat]
 */
export type BBox = readonly [number, number, number, number];

/**
 * Compute bounding box for a FeatureCollection
 *
 * @param geojson - GeoJSON FeatureCollection
 * @returns Bounding box or undefined if no coordinates
 */
export function computeBoundingBox(geojson: FeatureCollection): BBox | undefined {
    if (geojson.features.length === 0) {
        return undefined;
    }

    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;

    for (const feature of geojson.features) {
        const coords = extractCoordinatesFromFeature(feature);
        for (const [lon, lat] of coords) {
            if (lon < minLon) minLon = lon;
            if (lon > maxLon) maxLon = lon;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
        }
    }

    if (minLon === Infinity) {
        return undefined;
    }

    return [minLon, minLat, maxLon, maxLat] as const;
}

/**
 * Compute bounding box for a single feature
 *
 * @param feature - GeoJSON Feature
 * @returns Bounding box or undefined if no coordinates
 */
export function computeFeatureBoundingBox(feature: Feature): BBox | undefined {
    const coords = extractCoordinatesFromFeature(feature);

    if (coords.length === 0) {
        return undefined;
    }

    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;

    for (const [lon, lat] of coords) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
    }

    return [minLon, minLat, maxLon, maxLat] as const;
}
