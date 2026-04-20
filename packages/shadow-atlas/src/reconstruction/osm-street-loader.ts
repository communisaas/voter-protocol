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

  // R76-C1: Validate bbox values are finite and within geographic range
  if (
    !Number.isFinite(minLon) || !Number.isFinite(minLat) ||
    !Number.isFinite(maxLon) || !Number.isFinite(maxLat)
  ) {
    throw new Error('Bounding box values must be finite numbers');
  }
  if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90) {
    throw new Error('Bounding box out of geographic range (lon: -180..180, lat: -90..90)');
  }
  if (minLon >= maxLon || minLat >= maxLat) {
    throw new Error('Bounding box min values must be less than max values');
  }

  // R76-C1: Sanitize highwayTypes to prevent Overpass QL injection.
  // Only allow alphanumeric characters and underscores in highway type values.
  const SAFE_HIGHWAY_TYPE = /^[a-zA-Z0-9_]+$/;
  for (const ht of highwayTypes) {
    if (!SAFE_HIGHWAY_TYPE.test(ht)) {
      throw new Error(`Invalid highway type "${ht}" — only alphanumeric and underscore allowed`);
    }
  }

  // Build highway type regex filter (more efficient than multiple queries)
  const typeRegex = highwayTypes.join('|');

  // Validate timeout bounds — prevent Infinity, NaN, negative, or
  // unreasonably large values from reaching the Overpass query.
  const timeoutSec = Math.floor((options.timeout ?? 30000) / 1000);
  if (!Number.isFinite(timeoutSec) || timeoutSec < 1 || timeoutSec > 900) {
    throw new Error(`Invalid Overpass timeout: ${timeoutSec}s (must be 1-900)`);
  }

  return `
[out:json][timeout:${timeoutSec}];
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
    // Avoid spread on large arrays (stack overflow risk).
    bbox: [
      lons.reduce((a, b) => a < b ? a : b, Infinity),
      lats.reduce((a, b) => a < b ? a : b, Infinity),
      lons.reduce((a, b) => a > b ? a : b, -Infinity),
      lats.reduce((a, b) => a > b ? a : b, -Infinity),
    ],
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
  // Validate Overpass endpoint against allowlist to prevent SSRF.
  // Only well-known public Overpass API mirrors are permitted.
  const ALLOWED_OVERPASS_HOSTS = [
    'overpass-api.de',
    'overpass.kumi.systems',
    'overpass.openstreetmap.ru',
    'overpass.nchc.org.tw',
    'maps.mail.ru',
  ];
  const endpoint = options.overpassEndpoint ?? DEFAULT_OVERPASS_ENDPOINT;
  try {
    const endpointUrl = new URL(endpoint);
    if (!ALLOWED_OVERPASS_HOSTS.includes(endpointUrl.hostname)) {
      throw new Error(`Overpass endpoint host '${endpointUrl.hostname}' not in allowlist`);
    }
    if (endpointUrl.protocol !== 'https:') {
      throw new Error('Overpass endpoint must use HTTPS');
    }
  } catch (e) {
    if (e instanceof TypeError) {
      throw new Error(`Invalid Overpass endpoint URL: ${endpoint}`);
    }
    throw e;
  }

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

    // Enforce size limit during streaming, not after full buffer.
    // 50MB is generous for city-scale street data; planet-scale would be gigabytes.
    const MAX_OVERPASS_BYTES = 50 * 1024 * 1024;
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_OVERPASS_BYTES) {
      throw new Error(`Overpass response Content-Length ${contentLength} exceeds ${MAX_OVERPASS_BYTES} byte limit`);
    }

    let responseText = '';
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Overpass response has no readable body');
    }
    const decoder = new TextDecoder();
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_OVERPASS_BYTES) {
        reader.cancel();
        throw new Error(`Overpass response exceeded ${MAX_OVERPASS_BYTES} byte limit (streamed ${totalBytes})`);
      }
      responseText += decoder.decode(value, { stream: true });
    }
    responseText += decoder.decode(); // flush

    const data: OverpassResponse = JSON.parse(responseText);

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

  // R76-H1: Add timeout to prevent indefinite hang on slow/stalled Nominatim
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'shadow-atlas/1.0 (voter-protocol boundary reconstruction)',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Nominatim error: ${response.status}`);
  }

  // R76-H1: Size-limit response to prevent memory exhaustion (1MB generous for geocode JSON)
  const text = await response.text();
  if (text.length > 1024 * 1024) {
    throw new Error('Nominatim response exceeded 1MB size limit');
  }

  const results = JSON.parse(text);
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error(`City not found: ${cityName}, ${state}`);
  }

  const result = results[0];
  if (!result.boundingbox || !Array.isArray(result.boundingbox) || result.boundingbox.length < 4) {
    throw new Error('Nominatim returned invalid boundingbox format');
  }
  const bbox = result.boundingbox as [string, string, string, string];

  // Nominatim returns [minLat, maxLat, minLon, maxLon]
  // We need [minLon, minLat, maxLon, maxLat]
  const parsed = [
    parseFloat(bbox[2]), // minLon
    parseFloat(bbox[0]), // minLat
    parseFloat(bbox[3]), // maxLon
    parseFloat(bbox[1]), // maxLat
  ] as const;

  // R76-H1: NaN guard — prevent silent propagation of unparseable coordinates
  if (parsed.some(v => !Number.isFinite(v))) {
    throw new Error(`Nominatim returned non-numeric boundingbox: ${JSON.stringify(result.boundingbox)}`);
  }

  return parsed;
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
