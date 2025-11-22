import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as turf from '@turf/turf';
import type GeoJSON from 'geojson';

import type { BoundaryDataSource, BoundaryRequest, SourceResult } from '../sources/types';
import type {
  CountyDatasetConfig,
  SpecialDistrictFeature,
  SpecialDistrictFeatureCollection,
  SpecialDistrictCategory
} from './types';
import { getStateEntry, PROJECT_ROOT } from './registry';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveDatasetPath(relativePath: string): string {
  return path.resolve(PROJECT_ROOT, relativePath);
}

function buildCountyDatasets(): readonly CountyDatasetConfig[] {
  const registryEntry = getStateEntry('CA');
  if (!registryEntry) {
    throw new Error('Missing California registry entry for LAFCo datasets');
  }

  return registryEntry.sources
    .filter(source => source.status === 'live' && source.datasetType === 'geojson_local' && !!source.path)
    .map(source => ({
      county: source.county ?? source.name,
      authority: source.publisher ?? source.name,
      dataPath: resolveDatasetPath(source.path!),
      categories: (source.categories ?? ['unknown']) as SpecialDistrictCategory[],
      score: source.score,
      lastUpdated: source.lastUpdated ?? new Date().toISOString(),
      notes: source.name
    }));
}

const COUNTY_DATASETS: readonly CountyDatasetConfig[] = buildCountyDatasets();

export class CaliforniaLAFCoSource implements BoundaryDataSource {
  readonly id = 'special_district_authority' as const;
  readonly name = 'California LAFCo Special Districts';
  private readonly cache = new Map<string, SpecialDistrictFeatureCollection>();

  async fetch(request: BoundaryRequest): Promise<SourceResult | null> {
    if (request.location.state !== 'CA') {
      return null;
    }

    const { lat, lng } = request.location;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return null; // Need coordinates for point-in-polygon lookup
    }

    const prioritizedDatasets = this.getDatasetsForRequest(request.location.county);

    for (const dataset of prioritizedDatasets) {
      const collection = await this.loadDataset(dataset);
      const match = this.findContainingFeature(collection, lat, lng);
      if (!match) {
        continue;
      }

      const overlaps = this.collectOverlaps(collection, lat, lng);

      return {
        geometry: match,
        score: dataset.score,
        metadata: {
          source: `California LAFCo (${dataset.county} County)`,
          publisher: dataset.authority,
          publishedDate: new Date(dataset.lastUpdated),
          lastModified: new Date(dataset.lastUpdated),
          districtCode: match.properties?.district_id,
          districtName: match.properties?.district_name,
          notes: this.buildNotes(dataset, match, overlaps),
          overlappingDistricts: overlaps.length > 1 ? overlaps : undefined,
          dataQuality: 'high'
        }
      };
    }

    return null;
  }

  private getDatasetsForRequest(countyHint?: string): readonly CountyDatasetConfig[] {
    if (!countyHint) {
      return COUNTY_DATASETS;
    }

    const normalized = countyHint.toLowerCase();
    const prioritized = COUNTY_DATASETS.filter(dataset =>
      dataset.county.toLowerCase() === normalized
    );

    if (prioritized.length === 0) {
      return COUNTY_DATASETS;
    }

    const remaining = COUNTY_DATASETS.filter(dataset =>
      dataset.county.toLowerCase() !== normalized
    );

    return [...prioritized, ...remaining];
  }

  private async loadDataset(config: CountyDatasetConfig): Promise<SpecialDistrictFeatureCollection> {
    if (this.cache.has(config.dataPath)) {
      return this.cache.get(config.dataPath)!;
    }

    const fileContents = await fs.readFile(config.dataPath, 'utf-8');
    const collection = JSON.parse(fileContents) as SpecialDistrictFeatureCollection;
    this.cache.set(config.dataPath, collection);
    return collection;
  }

  private findContainingFeature(
    collection: SpecialDistrictFeatureCollection,
    lat: number,
    lng: number
  ): SpecialDistrictFeature | null {
    const point = turf.point([lng, lat]);

    let best: { feature: SpecialDistrictFeature; area: number } | null = null;

    for (const feature of collection.features) {
      if (!feature.geometry) {
        continue;
      }

      const contains = turf.booleanPointInPolygon(point, feature as SpecialDistrictFeature);
      if (contains) {
        const area = turf.area(feature as unknown as GeoJSON.Feature);
        if (!best || area < best.area) {
          best = { feature, area };
        }
      }
    }

    return best?.feature ?? null;
  }

  private collectOverlaps(
    collection: SpecialDistrictFeatureCollection,
    lat: number,
    lng: number
  ): string[] {
    const point = turf.point([lng, lat]);
    const overlaps = new Set<string>();
    for (const feature of collection.features) {
      if (!feature.geometry) {
        continue;
      }
      if (turf.booleanPointInPolygon(point, feature as SpecialDistrictFeature)) {
        const type = feature.properties?.district_type ?? 'special district';
        overlaps.add(type.toLowerCase());
      }
    }
    return Array.from(overlaps);
  }

  private buildNotes(
    dataset: CountyDatasetConfig,
    feature: SpecialDistrictFeature,
    overlaps: string[]
  ): string {
    const type = feature.properties?.district_type ?? 'special district';
    const pieces = [
      `${dataset.authority} authoritative boundary`,
      `Supported categories: ${dataset.categories.join(', ')}`
    ];

    if (feature.properties?.website) {
      pieces.push(`Dataset: ${feature.properties.website}`);
    }

    if (dataset.notes) {
      pieces.push(dataset.notes);
    }

    if (overlaps.length > 1) {
      pieces.push(`Overlapping districts detected: ${overlaps.join(', ')}`);
    }

    return pieces.join(' • ');
  }
}
