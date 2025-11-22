import fs from 'fs/promises';
import path from 'path';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import { ensureDirectory } from '../utils/files';
import { fetchArcGISFeatures } from '../utils/arcgis';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const FEATURE_SERVICE_URL =
  'https://services1.arcgis.com/q2CglofYX6ACNEeu/arcgis/rest/services/PWWS_All_bnd/FeatureServer/0';
const SOURCE_NAME = 'Kansas Public Wholesale Water Supply Districts';
const PUBLISHER = 'Kansas Water Office / MSDIS';
const WEBSITE = 'https://www.kwo.ks.gov/';
const PAGE_SIZE = 2000;

export class KansasWaterIngestor implements AuthorityIngestor {
  readonly id = 'kansas-public-water-districts';
  readonly state = 'KS';
  readonly dataset = 'water';
  readonly categories = ['water'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'ks', 'water.geojson');
    const rawFeatures = await fetchArcGISFeatures<Polygon | MultiPolygon>(FEATURE_SERVICE_URL, {
      pageSize: PAGE_SIZE
    });

    const features = rawFeatures
      .filter((feature): feature is Feature<Polygon | MultiPolygon> => Boolean(feature.geometry))
      .map(feature => this.normalizeFeature(feature));

    const collection: FeatureCollection = {
      type: 'FeatureCollection',
      features
    };

    await ensureDirectory(path.dirname(outputPath));
    await fs.writeFile(outputPath, JSON.stringify(collection));

    return {
      state: this.state,
      dataset: this.dataset,
      featuresWritten: features.length,
      outputPath,
      metadata: {
        source: FEATURE_SERVICE_URL
      }
    };
  }

  private normalizeFeature(feature: Feature<Polygon | MultiPolygon>): Feature<Polygon | MultiPolygon> {
    const props = feature.properties ?? {};
    const name = this.cleanValue(props.PWWSD) ?? this.cleanValue(props.Name) ?? 'Kansas Water District';
    const id = this.cleanValue(props.FID) ?? this.cleanValue(props.OBJECTID) ?? name;

    const notes: string[] = [SOURCE_NAME];

    return {
      type: 'Feature',
      geometry: feature.geometry!,
      properties: {
        district_id: `KS-WATER-${id}`,
        district_name: name,
        district_type: 'water',
        authority: PUBLISHER,
        website: WEBSITE,
        last_updated: new Date().toISOString().slice(0, 10),
        notes: notes.join(' • '),
        registrySource: SOURCE_NAME,
        registryPublisher: PUBLISHER,
        registryScore: 90,
        registryCategories: ['water']
      }
    };
  }

  private cleanValue(value: unknown): string | null {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed ? trimmed : null;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }

    return null;
  }
}
