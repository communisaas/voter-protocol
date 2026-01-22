/**
 * OSM Street Network Loader
 *
 * Loads street network data from OpenStreetMap via Overpass API.
 * This is the missing piece that connects legal descriptions to real geometry.
 *
 * USAGE:
 * ```typescript
 * const streets = await loadStreetNetwork({
 *   cityName: 'North Kansas City',
 *   state: 'MO',
 *   bbox: [-94.58, 39.12, -94.54, 39.15],
 * });
 * const query = new SimpleStreetNetworkQuery(streets);
 * ```
 */

import type { Feature, LineString, Position } from 'geojson';
import type { StreetSegment } from './types';

// =============================================================================
// Types
// =============================================================================

/**
 * Options for loading street network
 */
export interface StreetNetworkLoadOptions {
  /** Bounding box [minLon, minLat, maxLon, maxLat] */
  readonly bbox: readonly [number, number, number, number];

  /** Highway types to include (default: common road types) */
  readonly highwayTypes?: readonly string[];

  /** Overpass API endpoint (default: public endpoint) */
  readonly overpassEndpoint?: string;

  /** Request timeout in milliseconds */
  readonly timeout?: number;
}

/**
 * Raw OSM way element
 */
interface OsmWay {
  readonly type: 'way';
  readonly id: number;
  readonly tags?: {
    readonly name?: string;
    readonly alt_name?: string;
    readonly highway?: string;
    readonly [key: string]: string | undefined;
  };
  readonly geometry?: readonly { lat: number; lon: number }[];
}

/**
 * Overpass API response
 */
interface OverpassResponse {
  readonly elements: readonly OsmWay[];
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_HIGHWAY_TYPES = [
  // Major roads
  'motorway',
  'motorway_link',
  'trunk',
  'trunk_link',
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link',
  // Minor roads
  'residential',
  'unclassified',
  'living_street',
  'service',
  'road', // Unknown classification
] as const;

const DEFAULT_OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';

// =============================================================================
// Overpass Query Builder
// =============================================================================

/**
 * Build Overpass QL query for streets in a bounding box
 */
function buildOverpassQuery(options: StreetNetworkLoadOptions): string {
  const [minLon, minLat, maxLon, maxLat] = options.bbox;
  const highwayTypes = options.highwayTypes ?? DEFAULT_HIGHWAY_TYPES;

  // Build highway type regex filter (more efficient than multiple queries)
  const typeRegex = highwayTypes.join('|');

  return `
[out:json][timeout:${Math.floor((options.timeout ?? 30000) / 1000)}];
(
  way["highway"~"^(${typeRegex})$"]["name"](${minLat},${minLon},${maxLat},${maxLon});
);
out geom;
`.trim();
}

// =============================================================================
// OSM to StreetSegment Converter
// =============================================================================

/**
 * Convert OSM way to StreetSegment
 */
function osmWayToStreetSegment(way: OsmWay): StreetSegment | null {
  if (!way.tags?.name || !way.geometry || way.geometry.length < 2) {
    return null;
  }

  const coordinates: Position[] = way.geometry.map((pt) => [pt.lon, pt.lat]);
  const lons = coordinates.map(([lon]) => lon);
  const lats = coordinates.map(([, lat]) => lat);

  const altNames: string[] = [];
  if (way.tags.alt_name) {
    altNames.push(way.tags.alt_name);
  }
  // Also check for other name variants
  Object.entries(way.tags).forEach(([key, value]) => {
    if (key.startsWith('alt_name:') && value) {
      altNames.push(value);
    }
  });

  const geometry: Feature<LineString> = {
    type: 'Feature',
    properties: {
      id: `osm-${way.id}`,
      name: way.tags.name,
      highway: way.tags.highway ?? 'unknown',
    },
    geometry: {
      type: 'LineString',
      coordinates,
    },
  };

  return {
    id: `osm-${way.id}`,
    name: way.tags.name,
    altNames: Object.freeze(altNames),
    streetType: extractStreetType(way.tags.name),
    highway: way.tags.highway ?? 'unknown',
    geometry,
    bbox: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
  };
}

/**
 * Extract street type from name
 */
function extractStreetType(name: string): string {
  const suffixes = [
    'street',
    'avenue',
    'boulevard',
    'drive',
    'road',
    'lane',
    'court',
    'place',
    'way',
    'circle',
    'parkway',
    'highway',
    'terrace',
    'trail',
  ];

  const lower = name.toLowerCase();
  for (const suffix of suffixes) {
    if (lower.endsWith(suffix) || lower.endsWith(suffix.substring(0, 2))) {
      return suffix;
    }
  }
  return 'unknown';
}

// =============================================================================
// Main Loader Function
// =============================================================================

/**
 * Load street network from OpenStreetMap via Overpass API
 *
 * @param options - Loading options including bounding box
 * @returns Array of street segments
 *
 * @example
 * ```typescript
 * // Load streets for North Kansas City, MO
 * const streets = await loadStreetNetworkFromOSM({
 *   bbox: [-94.58, 39.12, -94.54, 39.15],
 * });
 * console.log(`Loaded ${streets.length} street segments`);
 * ```
 */
export async function loadStreetNetworkFromOSM(
  options: StreetNetworkLoadOptions
): Promise<readonly StreetSegment[]> {
  const endpoint = options.overpassEndpoint ?? DEFAULT_OVERPASS_ENDPOINT;
  const query = buildOverpassQuery(options);
  const timeout = options.timeout ?? 30000;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Overpass API error: ${response.status} ${response.statusText}`);
    }

    const data: OverpassResponse = await response.json();

    const segments: StreetSegment[] = [];
    for (const element of data.elements) {
      if (element.type === 'way') {
        const segment = osmWayToStreetSegment(element);
        if (segment) {
          segments.push(segment);
        }
      }
    }

    return Object.freeze(segments);
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Overpass API request timed out after ${timeout}ms`);
    }
    throw error;
  }
}

/**
 * Get bounding box for a city from Nominatim
 *
 * @param cityName - City name
 * @param state - State abbreviation
 * @param country - Country code (default: 'US')
 * @returns Bounding box [minLon, minLat, maxLon, maxLat]
 */
export async function getCityBoundingBox(
  cityName: string,
  state: string,
  country: string = 'US'
): Promise<readonly [number, number, number, number]> {
  const query = encodeURIComponent(`${cityName}, ${state}, ${country}`);
  const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'shadow-atlas/1.0 (voter-protocol boundary reconstruction)',
    },
  });

  if (!response.ok) {
    throw new Error(`Nominatim error: ${response.status}`);
  }

  const results = await response.json();
  if (results.length === 0) {
    throw new Error(`City not found: ${cityName}, ${state}`);
  }

  const result = results[0];
  const bbox = result.boundingbox as [string, string, string, string];

  // Nominatim returns [minLat, maxLat, minLon, maxLon]
  // We need [minLon, minLat, maxLon, maxLat]
  return [
    parseFloat(bbox[2]), // minLon
    parseFloat(bbox[0]), // minLat
    parseFloat(bbox[3]), // maxLon
    parseFloat(bbox[1]), // maxLat
  ] as const;
}

/**
 * Load street network for a city by name
 *
 * @param cityName - City name
 * @param state - State abbreviation
 * @param options - Additional options
 * @returns Array of street segments
 *
 * @example
 * ```typescript
 * const streets = await loadStreetNetworkForCity('North Kansas City', 'MO');
 * console.log(`Loaded ${streets.length} streets`);
 * ```
 */
export async function loadStreetNetworkForCity(
  cityName: string,
  state: string,
  options?: Partial<Omit<StreetNetworkLoadOptions, 'bbox'>>
): Promise<readonly StreetSegment[]> {
  const bbox = await getCityBoundingBox(cityName, state);

  // Expand bbox slightly (0.01 degrees ~ 1km) to include streets at boundaries
  const expandedBbox: readonly [number, number, number, number] = [
    bbox[0] - 0.01,
    bbox[1] - 0.01,
    bbox[2] + 0.01,
    bbox[3] + 0.01,
  ];

  return loadStreetNetworkFromOSM({
    ...options,
    bbox: expandedBbox,
  });
}

// =============================================================================
// Convenience: Full Pipeline
// =============================================================================

import { SimpleStreetNetworkQuery } from './segment-matcher';

/**
 * Load street network and create query interface for a city
 *
 * @param cityName - City name
 * @param state - State abbreviation
 * @returns Street network query interface
 *
 * @example
 * ```typescript
 * const query = await createStreetQueryForCity('Crestwood', 'MO');
 * const result = matchWardDescription(wardDesc, query);
 * ```
 */
export async function createStreetQueryForCity(
  cityName: string,
  state: string
): Promise<SimpleStreetNetworkQuery> {
  const segments = await loadStreetNetworkForCity(cityName, state);
  return new SimpleStreetNetworkQuery(segments);
}
