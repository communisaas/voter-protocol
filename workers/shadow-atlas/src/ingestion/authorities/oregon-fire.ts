import fs from 'fs/promises';
import path from 'path';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import { ensureDirectory } from '../utils/files';
import { fetchArcGISFeatures } from '../utils/arcgis';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const FEATURE_SERVICE_URL =
  'https://maps.oda.state.or.us/arcgis/rest/services/Projects/ODA_FieldBurning_Basemap/MapServer/4';
const DATASET_WEBSITE = 'https://maps.oda.state.or.us/portal/apps/sites/#/oda-digital-data/';

export class OregonFireIngestor implements AuthorityIngestor {
  readonly id = 'oregon-oda-fire-districts';
  readonly state = 'OR';
  readonly dataset = 'fire';
  readonly categories = ['fire'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'or', 'fire.geojson');
    const rawFeatures = await fetchArcGISFeatures<Polygon | MultiPolygon>(FEATURE_SERVICE_URL, {
      pageSize: 1000
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
    const districtName = props.DISTNAM ?? 'ODA Fire District';
    const districtId = `OR-FIRE-${(props.OBJECTID ?? Math.random().toString(36).slice(2, 10)).toString()}`;

    return {
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        district_id: districtId,
        district_name: districtName,
        district_type: 'fire',
        authority: 'Oregon Department of Agriculture – Smoke Management Program',
        last_updated: new Date().toISOString().slice(0, 10),
        website: DATASET_WEBSITE,
        notes: 'Fire District boundaries used for Willamette Valley field burning program (ODA).',
        registrySource: 'ODA Field Burning Fire Districts',
        registryPublisher: 'Oregon Department of Agriculture',
        registryScore: 90,
        registryCategories: ['fire']
      }
    };
  }
}
