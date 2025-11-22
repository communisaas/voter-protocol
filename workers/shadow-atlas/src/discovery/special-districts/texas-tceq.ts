import { promises as fs } from 'fs';
import path from 'path';
import * as turf from '@turf/turf';
import type GeoJSON from 'geojson';

import type { BoundaryDataSource, BoundaryRequest, SourceResult } from '../sources/types';
import type { SpecialDistrictFeatureCollection, SpecialDistrictFeature } from './types';
import { getStateEntry, PROJECT_ROOT } from './registry';

export class TexasTCEQMUDSource implements BoundaryDataSource {
  readonly id = 'special_district_authority' as const;
  readonly name = 'Texas TCEQ Municipal Utility Districts';
  private cache: SpecialDistrictFeatureCollection | null = null;

  async fetch(request: BoundaryRequest): Promise<SourceResult | null> {
    if (request.location.state !== 'TX') {
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

    return {
      geometry: feature,
      score: 95,
      metadata: {
        source: this.name,
        publisher: 'Texas Commission on Environmental Quality',
        districtCode: feature.properties?.district_id,
        districtName: feature.properties?.district_name,
        notes: this.buildNotes(overlaps),
        overlappingDistricts: overlaps.length > 1 ? overlaps : undefined,
        dataQuality: 'high'
      }
    };
  }

  private async loadDataset(): Promise<SpecialDistrictFeatureCollection> {
    if (this.cache) {
      return this.cache;
    }

    const registryEntry = getStateEntry('TX');
    const source = registryEntry?.sources[0];
    if (!source || !source.path) {
      throw new Error('TCEQ registry entry missing path');
    }

    const filePath = path.resolve(PROJECT_ROOT, source.path);
    const contents = await fs.readFile(filePath, 'utf-8');
    this.cache = JSON.parse(contents) as SpecialDistrictFeatureCollection;
    return this.cache;
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

  private buildNotes(overlaps: string[]): string {
    const base = 'State-filed Municipal Utility District (TCEQ) • Covers Houston/Dallas/Austin suburbs';
    if (overlaps.length > 1) {
      return `${base} • Overlapping districts detected: ${overlaps.join(', ')}`;
    }
    return base;
  }
}
