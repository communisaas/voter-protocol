import type GeoJSON from 'geojson';
import { promises as fs } from 'fs';

export async function readGeoJSONFile(pathname: string): Promise<GeoJSON.Feature[]> {
  const content = await fs.readFile(pathname, 'utf-8');
  const parsed = JSON.parse(content) as GeoJSON.FeatureCollection;
  if (!Array.isArray(parsed.features)) {
    throw new Error(`GeoJSON file ${pathname} does not contain features array`);
  }
  return parsed.features;
}
