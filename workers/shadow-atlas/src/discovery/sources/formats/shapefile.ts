import AdmZip from 'adm-zip';
import shapefile from 'shapefile';
import type GeoJSON from 'geojson';
import path from 'path';
import { promises as fs } from 'fs';
import { ensureCacheNamespace, hashKey, fileExists } from './cache';
import { downloadToFile } from './download';

export interface ShapefileFetchOptions {
  readonly url: string;
  readonly cacheNamespace?: string;
  readonly cacheKeyParts?: Array<string | number | boolean>;
  readonly filePredicate?: (fileName: string) => boolean;
  readonly forceDownload?: boolean;
}

export interface ShapefileFeatureSet {
  readonly features: GeoJSON.Feature[];
  readonly shapefilePath: string;
}

export async function fetchShapefileFeatures(
  options: ShapefileFetchOptions
): Promise<ShapefileFeatureSet> {
  const namespace = await ensureCacheNamespace(options.cacheNamespace ?? 'shapefiles');
  const cacheKey = hashKey([options.url, ...(options.cacheKeyParts ?? [])]);
  const zipPath = path.join(namespace, `${cacheKey}.zip`);
  const extractDir = path.join(namespace, `${cacheKey}-extract`);

  if (options.forceDownload || !(await fileExists(zipPath))) {
    await downloadToFile({ url: options.url, destinationPath: zipPath });
    await fs.rm(extractDir, { recursive: true, force: true });
  }

  if (!(await fileExists(extractDir))) {
    await unzip(zipPath, extractDir);
  }

  const shpPath = await findMatchingShapefile(extractDir, options.filePredicate);
  if (!shpPath) {
    throw new Error(`No shapefile found for ${options.url}`);
  }

  return {
    features: await parseShapefile(shpPath),
    shapefilePath: shpPath
  };
}

export async function parseShapefile(shpPath: string): Promise<GeoJSON.Feature[]> {
  const features: GeoJSON.Feature[] = [];
  const source = await shapefile.open(shpPath);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await source.read();
    if (result.done) {
      break;
    }
    if (result.value) {
      features.push(result.value as GeoJSON.Feature);
    }
  }

  return features;
}

async function unzip(zipPath: string, destination: string): Promise<void> {
  const zip = new AdmZip(zipPath);
  await fs.mkdir(destination, { recursive: true });
  zip.extractAllTo(destination, true);
}

async function findMatchingShapefile(
  directory: string,
  predicate?: (fileName: string) => boolean
): Promise<string | null> {
  const entries = await fs.readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      const nested = await findMatchingShapefile(fullPath, predicate);
      if (nested) {
        return nested;
      }
    } else if (entry.isFile() && entry.name.endsWith('.shp')) {
      if (!predicate || predicate(entry.name)) {
        return fullPath;
      }
    }
  }

  return null;
}
