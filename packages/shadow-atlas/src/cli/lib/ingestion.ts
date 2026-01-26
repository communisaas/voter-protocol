/**
 * Ingestion Utilities
 *
 * Shared functions for data ingestion from ArcGIS, TIGER, webmaps,
 * and direct GeoJSON sources.
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import { writeFile, mkdir, readFile, stat } from 'fs/promises';
import { dirname, join } from 'path';

// GeoJSON types (inline to avoid external dependency issues)
export interface Geometry {
  readonly type: string;
  readonly coordinates: unknown;
}

export type GeoJsonProperties = Record<string, unknown> | null;

export interface Feature {
  readonly type: 'Feature';
  readonly geometry: Geometry | null;
  readonly properties: GeoJsonProperties;
}

export interface FeatureCollection {
  readonly type: 'FeatureCollection';
  readonly features: Feature[];
}

// ============================================================================
// Types
// ============================================================================

/**
 * ArcGIS fetch options
 */
export interface ArcGISFetchOptions {
  /** Layer index to fetch (default: 0) */
  readonly layer?: number;

  /** SQL WHERE clause filter */
  readonly where?: string;

  /** Fields to include (default: all) */
  readonly fields?: readonly string[];

  /** Output format */
  readonly format?: 'geojson' | 'ndjson';

  /** Page size for pagination */
  readonly pageSize?: number;

  /** Timeout in milliseconds */
  readonly timeout?: number;
}

/**
 * TIGER fetch options
 */
export interface TIGERFetchOptions {
  /** TIGER vintage year */
  readonly vintage?: number;

  /** Cache directory */
  readonly cacheDir?: string;

  /** Force refresh even if cached */
  readonly forceRefresh?: boolean;

  /** Timeout in milliseconds */
  readonly timeout?: number;
}

/**
 * Webmap extraction options
 */
export interface WebmapExtractOptions {
  /** Portal URL (default: arcgis.com) */
  readonly portal?: string;

  /** Target layer name to extract */
  readonly layerName?: string;

  /** Timeout in milliseconds */
  readonly timeout?: number;
}

/**
 * GeoJSON fetch options
 */
export interface GeoJSONFetchOptions {
  /** Timeout in milliseconds */
  readonly timeout?: number;

  /** Validate structure */
  readonly validate?: boolean;
}

/**
 * Ingestion result
 */
export interface IngestionResult {
  /** Whether ingestion succeeded */
  readonly success: boolean;

  /** GeoJSON data (if successful) */
  readonly data?: FeatureCollection;

  /** Feature count */
  readonly featureCount: number;

  /** Path to cached file (if applicable) */
  readonly cachePath?: string;

  /** Error message (if failed) */
  readonly error?: string;

  /** Duration in milliseconds */
  readonly durationMs: number;
}

/**
 * TIGER layer types
 */
export type TIGERLayer =
  | 'place'
  | 'county'
  | 'cd'
  | 'sldu'
  | 'sldl'
  | 'vtd'
  | 'unsd'
  | 'elsd'
  | 'scsd';

// ============================================================================
// ArcGIS REST Response Types
// ============================================================================

interface ArcGISFeature {
  readonly attributes: Record<string, unknown>;
  readonly geometry?: ArcGISGeometry;
}

interface ArcGISGeometry {
  readonly rings?: readonly (readonly [number, number])[][];
  readonly paths?: readonly (readonly [number, number])[][];
  readonly x?: number;
  readonly y?: number;
  readonly points?: readonly (readonly [number, number])[];
}

interface ArcGISQueryResponse {
  readonly features?: readonly ArcGISFeature[];
  readonly exceededTransferLimit?: boolean;
  readonly error?: {
    readonly code: number;
    readonly message: string;
  };
  readonly geometryType?: string;
  readonly spatialReference?: {
    readonly wkid?: number;
    readonly latestWkid?: number;
  };
}

function isArcGISQueryResponse(data: unknown): data is ArcGISQueryResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    ('features' in data || 'error' in data)
  );
}

// ============================================================================
// Webmap Types
// ============================================================================

interface WebmapData {
  readonly operationalLayers?: readonly WebmapLayer[];
  readonly baseMap?: unknown;
  readonly version?: string;
}

interface WebmapLayer {
  readonly id: string;
  readonly title: string;
  readonly url?: string;
  readonly layerType?: string;
  readonly itemId?: string;
}

function isWebmapData(data: unknown): data is WebmapData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'operationalLayers' in data &&
    Array.isArray((data as WebmapData).operationalLayers)
  );
}

// ============================================================================
// ArcGIS REST Ingestion
// ============================================================================

/**
 * Fetch data from ArcGIS REST FeatureServer/MapServer
 *
 * Handles pagination automatically for large datasets.
 *
 * @param url - ArcGIS REST service URL
 * @param options - Fetch options
 * @returns GeoJSON FeatureCollection
 */
export async function fetchArcGIS(
  url: string,
  options: ArcGISFetchOptions = {}
): Promise<FeatureCollection> {
  const startTime = Date.now();
  const {
    layer = 0,
    where = '1=1',
    fields,
    pageSize = 1000,
    timeout = 60000,
  } = options;

  // Normalize URL
  let baseUrl = url.replace(/\/$/, '');

  // Add layer index if not present
  if (!/\/\d+$/.test(baseUrl) && !baseUrl.includes('/query')) {
    baseUrl = `${baseUrl}/${layer}`;
  }

  // Ensure query endpoint
  if (!baseUrl.includes('/query')) {
    baseUrl = `${baseUrl}/query`;
  }

  const allFeatures: Feature[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({
      where,
      outFields: fields?.join(',') ?? '*',
      returnGeometry: 'true',
      resultOffset: String(offset),
      resultRecordCount: String(pageSize),
      f: 'json',
    });

    const response = await fetch(`${baseUrl}?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'VOTER-Protocol/1.0 (Shadow Atlas Ingestion)',
      },
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data: unknown = await response.json();

    if (!isArcGISQueryResponse(data)) {
      throw new Error('Invalid ArcGIS response structure');
    }

    if (data.error) {
      throw new Error(`ArcGIS error ${data.error.code}: ${data.error.message}`);
    }

    if (data.features) {
      for (const feature of data.features) {
        const geoJsonFeature = convertArcGISFeature(feature);
        if (geoJsonFeature) {
          allFeatures.push(geoJsonFeature);
        }
      }
    }

    // Check pagination
    if (
      data.exceededTransferLimit ||
      (data.features && data.features.length === pageSize)
    ) {
      offset += pageSize;
    } else {
      hasMore = false;
    }
  }

  return {
    type: 'FeatureCollection',
    features: allFeatures,
  };
}

/**
 * Convert ArcGIS feature to GeoJSON feature
 */
function convertArcGISFeature(feature: ArcGISFeature): Feature | null {
  const geometry = convertArcGISGeometry(feature.geometry);

  if (!geometry) {
    return null;
  }

  return {
    type: 'Feature',
    properties: feature.attributes as GeoJsonProperties,
    geometry,
  };
}

/**
 * Convert ArcGIS geometry to GeoJSON geometry
 */
function convertArcGISGeometry(
  arcgisGeom: ArcGISGeometry | undefined
): Geometry | null {
  if (!arcgisGeom) {
    return null;
  }

  // Polygon (rings)
  if (arcgisGeom.rings && arcgisGeom.rings.length > 0) {
    const coordinates = arcgisGeom.rings.map((ring) =>
      ring.map(([x, y]) => [x, y] as [number, number])
    );

    if (coordinates.length === 1) {
      return {
        type: 'Polygon',
        coordinates,
      };
    } else {
      // Multiple rings could be holes or multi-polygon
      return {
        type: 'Polygon',
        coordinates,
      };
    }
  }

  // Point
  if (arcgisGeom.x !== undefined && arcgisGeom.y !== undefined) {
    return {
      type: 'Point',
      coordinates: [arcgisGeom.x, arcgisGeom.y],
    };
  }

  // LineString (paths)
  if (arcgisGeom.paths && arcgisGeom.paths.length > 0) {
    const coordinates = arcgisGeom.paths[0]!.map(
      ([x, y]) => [x, y] as [number, number]
    );
    return {
      type: 'LineString',
      coordinates,
    };
  }

  // MultiPoint
  if (arcgisGeom.points && arcgisGeom.points.length > 0) {
    const coordinates = arcgisGeom.points.map(
      ([x, y]) => [x, y] as [number, number]
    );
    return {
      type: 'MultiPoint',
      coordinates,
    };
  }

  return null;
}

// ============================================================================
// Census TIGER Ingestion
// ============================================================================

/**
 * TIGER layer URL templates
 */
const TIGER_LAYERS: Record<TIGERLayer, string> = {
  place: 'PLACE/tl_{{vintage}}_{{state}}_place',
  county: 'COUNTY/tl_{{vintage}}_us_county',
  cd: 'CD/tl_{{vintage}}_us_cd{{cdVersion}}',
  sldu: 'SLDU/tl_{{vintage}}_{{state}}_sldu',
  sldl: 'SLDL/tl_{{vintage}}_{{state}}_sldl',
  vtd: 'VTD/tl_{{vintage}}_{{state}}_vtd{{vtdVersion}}',
  unsd: 'UNSD/tl_{{vintage}}_{{state}}_unsd',
  elsd: 'ELSD/tl_{{vintage}}_{{state}}_elsd',
  scsd: 'SCSD/tl_{{vintage}}_{{state}}_scsd',
};

/**
 * Fetch data from Census TIGER
 *
 * Downloads and caches TIGER/Line shapefiles, converting to GeoJSON.
 *
 * @param layer - TIGER layer type
 * @param state - State FIPS code (2-digit)
 * @param options - Fetch options
 * @returns Path to cached GeoJSON file
 */
export async function fetchTIGER(
  layer: TIGERLayer,
  state: string,
  options: TIGERFetchOptions = {}
): Promise<string> {
  const {
    vintage = 2024,
    cacheDir = '.shadow-atlas/tiger-cache',
    forceRefresh = false,
    timeout = 120000,
  } = options;

  // Determine CD version suffix
  const cdVersion = vintage >= 2024 ? '119' : vintage >= 2022 ? '118' : '117';

  // Determine VTD version suffix
  const vtdVersion = vintage >= 2024 ? '20' : '10';

  // Build file path
  const template = TIGER_LAYERS[layer];
  const fileName = template
    .replace('{{vintage}}', String(vintage))
    .replace('{{state}}', state)
    .replace('{{cdVersion}}', cdVersion)
    .replace('{{vtdVersion}}', vtdVersion);

  const cacheFileName = `${fileName.replace('/', '_')}.geojson`;
  const cachePath = join(cacheDir, cacheFileName);

  // Check cache
  if (!forceRefresh) {
    try {
      await stat(cachePath);
      return cachePath;
    } catch {
      // Cache miss, continue to download
    }
  }

  // Build TIGER FTP URL
  const baseUrl = `https://www2.census.gov/geo/tiger/TIGER${vintage}`;
  const zipUrl = `${baseUrl}/${fileName}.zip`;

  // Download and process
  const response = await fetch(zipUrl, {
    signal: AbortSignal.timeout(timeout),
  });

  if (!response.ok) {
    throw new Error(`Failed to download TIGER data: ${response.status}`);
  }

  const zipBuffer = await response.arrayBuffer();

  // Extract and convert shapefile to GeoJSON
  const geojson = await extractShapefileToGeoJSON(new Uint8Array(zipBuffer));

  // Ensure cache directory exists
  await mkdir(dirname(cachePath), { recursive: true });

  // Write cache
  await writeFile(cachePath, JSON.stringify(geojson, null, 2));

  return cachePath;
}

/**
 * Extract shapefile from ZIP and convert to GeoJSON
 *
 * Uses the shapefile package for conversion.
 */
async function extractShapefileToGeoJSON(
  zipData: Uint8Array
): Promise<FeatureCollection> {
  // Dynamic import for shapefile and jszip
  const [{ default: JSZip }, shapefile] = await Promise.all([
    import('jszip'),
    import('shapefile'),
  ]);

  const zip = await JSZip.loadAsync(zipData);

  // Find .shp and .dbf files
  type ZipFile = { async(type: 'arraybuffer'): Promise<ArrayBuffer> };
  let shpFile: ZipFile | null = null;
  let dbfFile: ZipFile | null = null;

  zip.forEach((path: string, file: ZipFile) => {
    if (path.endsWith('.shp')) {
      shpFile = file;
    } else if (path.endsWith('.dbf')) {
      dbfFile = file;
    }
  });

  if (!shpFile || !dbfFile) {
    throw new Error('Shapefile components not found in ZIP');
  }

  // Assert non-null after check
  const shpFileNonNull = shpFile as ZipFile;
  const dbfFileNonNull = dbfFile as ZipFile;

  const shpBuffer = await shpFileNonNull.async('arraybuffer');
  const dbfBuffer = await dbfFileNonNull.async('arraybuffer');

  // Convert to GeoJSON using shapefile package
  const source = await shapefile.open(shpBuffer, dbfBuffer);

  const features: Feature[] = [];
  let result = await source.read();

  while (!result.done) {
    if (result.value) {
      features.push(result.value as Feature);
    }
    result = await source.read();
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}

// ============================================================================
// ArcGIS Webmap Extraction
// ============================================================================

/**
 * Extract layer data from an ArcGIS webmap
 *
 * Parses webmap JSON to find target layer and fetches its data.
 *
 * @param webmapId - ArcGIS webmap item ID
 * @param options - Extraction options
 * @returns GeoJSON FeatureCollection
 */
export async function extractWebmapLayer(
  webmapId: string,
  options: WebmapExtractOptions = {}
): Promise<FeatureCollection> {
  const {
    portal = 'https://www.arcgis.com',
    layerName,
    timeout = 60000,
  } = options;

  // Fetch webmap JSON
  const webmapUrl = `${portal}/sharing/rest/content/items/${webmapId}/data?f=json`;

  const response = await fetch(webmapUrl, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'VOTER-Protocol/1.0 (Shadow Atlas Webmap Extraction)',
    },
    signal: AbortSignal.timeout(timeout),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch webmap: ${response.status}`);
  }

  const data: unknown = await response.json();

  if (!isWebmapData(data)) {
    throw new Error('Invalid webmap data structure');
  }

  // Find target layer
  const layers = data.operationalLayers ?? [];

  let targetLayer: WebmapLayer | undefined;

  if (layerName) {
    // Find by name
    targetLayer = layers.find(
      (l) => l.title.toLowerCase() === layerName.toLowerCase()
    );
  } else {
    // Find first Feature Service layer
    targetLayer = layers.find(
      (l) =>
        l.url?.includes('FeatureServer') || l.url?.includes('MapServer')
    );
  }

  if (!targetLayer) {
    throw new Error(
      layerName
        ? `Layer "${layerName}" not found in webmap`
        : 'No feature layer found in webmap'
    );
  }

  if (!targetLayer.url) {
    throw new Error(`Layer "${targetLayer.title}" has no URL`);
  }

  // Fetch layer data
  return fetchArcGIS(targetLayer.url, { timeout });
}

/**
 * List layers in an ArcGIS webmap
 *
 * @param webmapId - ArcGIS webmap item ID
 * @param options - Options
 * @returns List of layer info
 */
export async function listWebmapLayers(
  webmapId: string,
  options: { portal?: string; timeout?: number } = {}
): Promise<readonly { name: string; url: string | null; type: string }[]> {
  const { portal = 'https://www.arcgis.com', timeout = 30000 } = options;

  const webmapUrl = `${portal}/sharing/rest/content/items/${webmapId}/data?f=json`;

  const response = await fetch(webmapUrl, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeout),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch webmap: ${response.status}`);
  }

  const data: unknown = await response.json();

  if (!isWebmapData(data)) {
    throw new Error('Invalid webmap data structure');
  }

  return (data.operationalLayers ?? []).map((layer) => ({
    name: layer.title,
    url: layer.url ?? null,
    type: layer.layerType ?? 'unknown',
  }));
}

// ============================================================================
// Direct GeoJSON Fetch
// ============================================================================

/**
 * Fetch GeoJSON directly from URL
 *
 * @param url - GeoJSON URL
 * @param options - Fetch options
 * @returns GeoJSON FeatureCollection
 */
export async function fetchGeoJSON(
  url: string,
  options: GeoJSONFetchOptions = {}
): Promise<FeatureCollection> {
  const { timeout = 60000, validate = true } = options;

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json, application/geo+json',
      'User-Agent': 'VOTER-Protocol/1.0 (Shadow Atlas GeoJSON Fetch)',
    },
    signal: AbortSignal.timeout(timeout),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data: unknown = await response.json();

  if (validate) {
    validateGeoJSON(data);
  }

  return data as FeatureCollection;
}

/**
 * Validate GeoJSON structure
 */
export function validateGeoJSON(data: unknown): void {
  if (typeof data !== 'object' || data === null) {
    throw new Error('GeoJSON must be an object');
  }

  const obj = data as Record<string, unknown>;

  if (obj.type !== 'FeatureCollection') {
    if (obj.type === 'Feature') {
      // Single feature is valid but unexpected
      return;
    }
    throw new Error(`Expected FeatureCollection, got ${obj.type}`);
  }

  if (!Array.isArray(obj.features)) {
    throw new Error('FeatureCollection must have features array');
  }

  // Validate first few features
  const features = obj.features as unknown[];
  for (let i = 0; i < Math.min(features.length, 10); i++) {
    const feature = features[i];
    if (typeof feature !== 'object' || feature === null) {
      throw new Error(`Feature ${i} is not an object`);
    }

    const f = feature as Record<string, unknown>;
    if (f.type !== 'Feature') {
      throw new Error(`Feature ${i} has invalid type: ${f.type}`);
    }

    if (
      f.geometry !== null &&
      typeof f.geometry !== 'object'
    ) {
      throw new Error(`Feature ${i} has invalid geometry`);
    }
  }
}

// ============================================================================
// File Operations
// ============================================================================

/**
 * Save GeoJSON to file
 */
export async function saveGeoJSON(
  data: FeatureCollection,
  outputPath: string
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(data, null, 2));
}

/**
 * Save as NDJSON (newline-delimited JSON)
 */
export async function saveNDJSON(
  data: FeatureCollection,
  outputPath: string
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  const lines = data.features.map((f: Feature) => JSON.stringify(f));
  await writeFile(outputPath, lines.join('\n'));
}

/**
 * Load GeoJSON from file
 */
export async function loadGeoJSON(inputPath: string): Promise<FeatureCollection> {
  const content = await readFile(inputPath, 'utf-8');
  const data = JSON.parse(content);
  validateGeoJSON(data);
  return data as FeatureCollection;
}
