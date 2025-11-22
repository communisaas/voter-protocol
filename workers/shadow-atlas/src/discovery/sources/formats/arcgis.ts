import type GeoJSON from 'geojson';
import { ensureCacheNamespace, hashKey, fileExists } from './cache';
import { promises as fs } from 'fs';
import path from 'path';

export interface FeatureLayerQueryOptions {
  readonly url: string;
  readonly where?: string;
  readonly outFields?: string;
  readonly spatialRel?: string;
  readonly geometry?: {
    readonly lat: number;
    readonly lng: number;
    readonly bufferMeters?: number;
  };
  readonly cache?: boolean;
}

export async function queryFeatureLayer(
  options: FeatureLayerQueryOptions
): Promise<GeoJSON.Feature[]> {
  const queryUrl = buildQueryUrl(options);

  if (options.cache) {
    const cacheKey = hashKey([queryUrl]);
    const cacheDir = await ensureCacheNamespace('arcgis');
    const cachePath = path.join(cacheDir, `${cacheKey}.json`);
    if (await fileExists(cachePath)) {
      const cached = await fs.readFile(cachePath, 'utf-8');
      return extractFeatures(JSON.parse(cached));
    }

    const json = await fetchGeoJSON(queryUrl);
    await fs.writeFile(cachePath, JSON.stringify(json));
    return extractFeatures(json);
  }

  const json = await fetchGeoJSON(queryUrl);
  return extractFeatures(json);
}

function buildQueryUrl(options: FeatureLayerQueryOptions): string {
  const params = new URLSearchParams({
    where: options.where ?? '1=1',
    outFields: options.outFields ?? '*',
    outSR: '4326',
    f: 'geojson'
  });

  if (options.geometry) {
    params.set('geometry', JSON.stringify({
      x: options.geometry.lng,
      y: options.geometry.lat,
      spatialReference: { wkid: 4326 }
    }));
    params.set('geometryType', 'esriGeometryPoint');
    params.set('spatialRel', options.spatialRel ?? 'esriSpatialRelIntersects');
    if (options.geometry.bufferMeters) {
      params.set('distance', String(options.geometry.bufferMeters));
      params.set('units', 'esriSRUnit_Meter');
    }
  } else if (options.spatialRel) {
    params.set('spatialRel', options.spatialRel);
  }

  const normalizedUrl = options.url.endsWith('/query')
    ? options.url
    : `${options.url.replace(/\/$/, '')}/query`;

  return `${normalizedUrl}?${params.toString()}`;
}

async function fetchGeoJSON(url: string): Promise<GeoJSON.FeatureCollection> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`FeatureServer request failed ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<GeoJSON.FeatureCollection>;
}

function extractFeatures(collection: GeoJSON.FeatureCollection): GeoJSON.Feature[] {
  if (!collection.features) {
    throw new Error('FeatureServer response missing features array');
  }
  return collection.features;
}
