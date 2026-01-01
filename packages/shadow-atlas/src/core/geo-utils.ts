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
 * Accepts both standard GeoJSON and readonly variants.
 *
 * @param geometry - Polygon or MultiPolygon geometry
 * @returns Array of exterior ring coordinates
 */
export function extractExteriorCoordinates(
    geometry: Polygon | MultiPolygon | { readonly type: 'Polygon'; readonly coordinates: readonly (readonly [number, number][])[] } | { readonly type: 'MultiPolygon'; readonly coordinates: readonly (readonly (readonly [number, number][])[])[] }
): Position[] {
    if (geometry.type === 'Polygon') {
        return [...geometry.coordinates[0]] as Position[]; // First ring is exterior
    } else {
        // MultiPolygon: all exterior rings
        return geometry.coordinates.flatMap(polygon => [...polygon[0]]) as Position[];
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

/**
 * Extract bounding box from GeoJSON geometry
 *
 * Canonical implementation for all bbox calculations.
 * Used by boundary.ts, types.ts, transformation/utils.ts, integration/state-batch-to-merkle.ts
 *
 * @param geometry - Polygon or MultiPolygon geometry
 * @returns Bounding box [minLon, minLat, maxLon, maxLat]
 */
export function extractBBox(geometry: Polygon | MultiPolygon): BBox {
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;

    const processRing = (ring: Position[]): void => {
        for (const [lon, lat] of ring) {
            minLon = Math.min(minLon, lon);
            minLat = Math.min(minLat, lat);
            maxLon = Math.max(maxLon, lon);
            maxLat = Math.max(maxLat, lat);
        }
    };

    if (geometry.type === 'Polygon') {
        for (const ring of geometry.coordinates) {
            processRing(ring);
        }
    } else {
        // MultiPolygon
        for (const polygon of geometry.coordinates) {
            for (const ring of polygon) {
                processRing(ring);
            }
        }
    }

    return [minLon, minLat, maxLon, maxLat] as const;
}

// ============================================================================
// Geometry-based Centroid (Tuple Return)
// ============================================================================

/**
 * Calculate centroid of a GeoJSON Geometry (returns tuple)
 *
 * Used by spatial-join-places.ts for bbox-based approximation.
 * Returns [lon, lat] tuple instead of GeoPoint object.
 *
 * @param geometry - GeoJSON Geometry
 * @returns Centroid as [lon, lat] tuple
 */
export function calculateCentroidFromGeometry(geometry: Geometry): [number, number] {
    const coords = extractCoordinatesFromGeometry(geometry);

    if (coords.length === 0) {
        throw new Error('Cannot calculate centroid: no coordinates found');
    }

    let totalLat = 0;
    let totalLon = 0;

    for (const [lon, lat] of coords) {
        totalLat += lat;
        totalLon += lon;
    }

    return [totalLon / coords.length, totalLat / coords.length];
}

/**
 * Calculate centroid from bounding box (fast approximation)
 *
 * Used by spatial-join-places.ts for quick centroid estimation.
 * Much faster than coordinate averaging for complex geometries.
 *
 * @param geometry - GeoJSON Geometry
 * @returns Centroid as [lon, lat] tuple (bbox center)
 */
export function calculateCentroidFromBBox(geometry: Geometry): [number, number] {
    // Handle all geometry types via recursive bbox calculation
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    const processCoords = (coords: unknown): void => {
        if (!Array.isArray(coords)) return;

        if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
            // Single coordinate pair [lon, lat]
            minX = Math.min(minX, coords[0]);
            maxX = Math.max(maxX, coords[0]);
            minY = Math.min(minY, coords[1]);
            maxY = Math.max(maxY, coords[1]);
        } else {
            // Nested array - recursively process
            for (const coord of coords) {
                processCoords(coord);
            }
        }
    };

    if (geometry.type === 'GeometryCollection') {
        for (const geom of geometry.geometries) {
            const [lon, lat] = calculateCentroidFromBBox(geom);
            minX = Math.min(minX, lon);
            maxX = Math.max(maxX, lon);
            minY = Math.min(minY, lat);
            maxY = Math.max(maxY, lat);
        }
    } else {
        processCoords((geometry as Polygon | MultiPolygon).coordinates);
    }

    return [(minX + maxX) / 2, (minY + maxY) / 2];
}

// ============================================================================
// Point-in-Polygon Testing
// ============================================================================

/**
 * Ray casting algorithm for point-in-polygon test
 *
 * Tests if a point lies inside a polygon ring using ray casting.
 * This is the core algorithm used by pointInPolygon and pointInGeometry.
 *
 * @param point - Test point [lon, lat]
 * @param ring - Polygon ring coordinates
 * @returns True if point is inside ring
 */
function raycastPointInRing(point: [number, number], ring: Position[]): boolean {
    const [x, y] = point;
    let inside = false;

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];

        const intersect = ((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi);

        if (intersect) inside = !inside;
    }

    return inside;
}

/**
 * Test if point is inside polygon (simple ring array)
 *
 * Used by spatial-join-places.ts for PIP testing.
 * Accepts raw coordinate arrays.
 *
 * @param point - Test point [lon, lat]
 * @param polygon - Polygon ring as coordinate array
 * @returns True if point is inside polygon
 */
export function pointInPolygon(point: [number, number], polygon: number[][]): boolean {
    return raycastPointInRing(point, polygon as Position[]);
}

/**
 * Test if point is inside Polygon or MultiPolygon geometry
 *
 * Tests against exterior rings only (faster).
 * For interior ring handling, use turf.js booleanPointInPolygon.
 *
 * @param point - Test point [lon, lat]
 * @param geometry - Polygon or MultiPolygon geometry
 * @returns True if point is inside any polygon
 */
export function pointInGeometry(
    point: [number, number],
    geometry: Polygon | MultiPolygon
): boolean {
    if (geometry.type === 'Polygon') {
        // Test against exterior ring (first ring)
        return raycastPointInRing(point, geometry.coordinates[0]);
    } else {
        // MultiPolygon: test against any polygon
        for (const polygon of geometry.coordinates) {
            if (raycastPointInRing(point, polygon[0])) {
                return true;
            }
        }
        return false;
    }
}
