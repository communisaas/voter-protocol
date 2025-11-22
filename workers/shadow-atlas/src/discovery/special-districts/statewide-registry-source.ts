import { promises as fs } from 'fs';
import path from 'path';
import * as turf from '@turf/turf';
import type GeoJSON from 'geojson';

import type { BoundaryDataSource, BoundaryRequest, SourceResult } from '../sources/types';
import type {
  SpecialDistrictFeatureCollection,
  SpecialDistrictFeature,
  SpecialDistrictCategory
} from './types';
import { getStateEntry, PROJECT_ROOT, type SpecialDistrictSourceEntry } from './registry';

const DATASET_CACHE = new Map<string, SpecialDistrictFeatureCollection>();
const MAX_CACHE_ENTRIES = 4;

function getCachedDataset(key: string): SpecialDistrictFeatureCollection | undefined {
  const value = DATASET_CACHE.get(key);
  if (!value) {
    return undefined;
  }
  DATASET_CACHE.delete(key);
  DATASET_CACHE.set(key, value);
  return value;
}

function cacheDataset(key: string, value: SpecialDistrictFeatureCollection) {
  if (DATASET_CACHE.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = DATASET_CACHE.keys().next().value;
    if (oldestKey) {
      DATASET_CACHE.delete(oldestKey);
    }
  }
  DATASET_CACHE.set(key, value);
}

function cloneFeature(feature: SpecialDistrictFeature): SpecialDistrictFeature {
  return JSON.parse(JSON.stringify(feature)) as SpecialDistrictFeature;
}

export class RegistryGeoJSONStatewideSource implements BoundaryDataSource {
  readonly id = 'special_district_authority' as const;
  readonly name: string;
  private cache: SpecialDistrictFeatureCollection | null = null;

  constructor(private readonly state: string) {
    this.name = `${state} Special District Registry`;
  }

  async fetch(request: BoundaryRequest): Promise<SourceResult | null> {
    if (request.location.state !== this.state) {
      return null;
    }

    const { lat, lng } = request.location;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return null;
    }

    const collection = await this.loadDataset();
    const overlaps = this.collectOverlaps(collection, lat, lng);
    const feature = this.pickPrimaryFeature(collection, lat, lng);
    if (!feature) {
      return null;
    }

    const registryEntry = getStateEntry(this.state);
    const sourceMeta = this.extractSourceMetadata(feature);
    const fallbackSource = registryEntry?.sources[0];

    return {
      geometry: feature,
      score: sourceMeta?.score ?? fallbackSource?.score ?? 90,
      metadata: {
        source: sourceMeta?.name ?? this.name,
        publisher: sourceMeta?.publisher ?? registryEntry?.authority ?? this.name,
        districtCode: feature.properties?.district_id,
        districtName: feature.properties?.district_name,
        notes: this.buildNotes(
          registryEntry?.notes,
          overlaps,
          sourceMeta?.notes ?? `${sourceMeta?.name ?? this.name} dataset`
        ),
        overlappingDistricts: overlaps.length > 1 ? overlaps : undefined,
        dataQuality: 'high'
      }
    };
  }

  private getRegistrySources(): readonly SpecialDistrictSourceEntry[] {
    const entry = getStateEntry(this.state);
    return entry?.sources ?? [];
  }

  private async loadDataset(): Promise<SpecialDistrictFeatureCollection> {
    if (this.cache) {
      return this.cache;
    }

    const sources = this.getRegistrySources().filter(
      source => source.datasetType === 'geojson_local' && !!source.path
    );

    if (sources.length === 0) {
      throw new Error(`Registry missing dataset path for ${this.state}`);
    }

    const mergedFeatures: SpecialDistrictFeature[] = [];
    for (const source of sources) {
      const collection = await this.loadCollection(source.path!);
      for (const feature of collection.features) {
        if (!feature.geometry) {
          continue;
        }
        mergedFeatures.push(this.enrichFeature(feature, source));
      }
    }

    this.cache = {
      type: 'FeatureCollection',
      features: mergedFeatures
    };

    return this.cache;
  }

  private async loadCollection(relativePath: string): Promise<SpecialDistrictFeatureCollection> {
    const absolutePath = path.resolve(PROJECT_ROOT, relativePath);
    const cached = getCachedDataset(absolutePath);
    if (cached) {
      return cached;
    }

    const contents = await fs.readFile(absolutePath, 'utf-8');
    const collection = JSON.parse(contents) as SpecialDistrictFeatureCollection;
    cacheDataset(absolutePath, collection);
    return collection;
  }

  private enrichFeature(
    feature: SpecialDistrictFeature,
    source: SpecialDistrictSourceEntry
  ): SpecialDistrictFeature {
    const cloned = cloneFeature(feature);
    const props = (cloned.properties ??= {});
    props.registrySource = source.name;
    props.registryPublisher = source.publisher ?? source.name;
    props.registryScore = source.score;
    props.registryNotes = source.notes;
    props.registryCategories = source.categories as SpecialDistrictCategory[] | undefined;

    if (!props.district_type && source.categories?.length) {
      props.district_type = source.categories[0];
    }

    return cloned;
  }

  private extractSourceMetadata(feature: SpecialDistrictFeature) {
    const props = feature.properties;
    if (!props) {
      return null;
    }

    return {
      name: props.registrySource,
      publisher: props.registryPublisher,
      score: props.registryScore,
      notes: props.registryNotes,
      categories: props.registryCategories
    };
  }

  private pickPrimaryFeature(
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
      if (turf.booleanPointInPolygon(point, feature as SpecialDistrictFeature)) {
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
    notesFromRegistry: string | undefined,
    overlaps: string[],
    sourceNotes?: string
  ): string {
    const pieces = [notesFromRegistry ?? 'Statewide authority dataset'];

    if (sourceNotes && !pieces.includes(sourceNotes)) {
      pieces.push(sourceNotes);
    }

    if (overlaps.length > 1) {
      pieces.push(`Overlapping districts detected: ${overlaps.join(', ')}`);
    }

    return pieces.join(' • ');
  }
}
