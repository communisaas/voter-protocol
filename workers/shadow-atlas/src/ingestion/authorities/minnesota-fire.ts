import fs from 'fs/promises';
import path from 'path';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import { ensureDirectory } from '../utils/files';
import { fetchArcGISFeatures } from '../utils/arcgis';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const DATASET_NAME = 'Minnesota NG911 Fire Response Districts';
const DEFAULT_DATASET_URL_ENV = 'MN_FIRE_FEATURE_SERVICE_URL';
const DEFAULT_TOKEN_ENV = 'MN_FIRE_FEATURE_SERVICE_TOKEN';

export class MinnesotaFireIngestor implements AuthorityIngestor {
  readonly id = 'minnesota-fire-districts';
  readonly state = 'MN';
  readonly dataset = 'fire';
  readonly categories = ['fire'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const featureServiceUrl = process.env[DEFAULT_DATASET_URL_ENV];
    if (!featureServiceUrl) {
      throw new Error(`Missing ${DEFAULT_DATASET_URL_ENV}; set it to the NG911 FeatureServer URL before ingesting.`);
    }

    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'mn', 'fire.geojson');
    const rawFeatures = await fetchArcGISFeatures<Polygon | MultiPolygon>(featureServiceUrl, {
      pageSize: 1000,
      token: process.env[DEFAULT_TOKEN_ENV]
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
        source: featureServiceUrl
      }
    };
  }

  private normalizeFeature(feature: Feature<Polygon | MultiPolygon>): Feature<Polygon | MultiPolygon> {
    const props = feature.properties ?? {};
    const districtId =
      props.DISTRICTID ??
      props.RESPONSEID ??
      props.OBJECTID ??
      props.GLOBALID ??
      props.ID ??
      `MN-FIRE-${Math.random().toString(36).slice(2, 10)}`;

    const agency = props.AGENCY ?? props.PRIMARY_AGENCY ?? props.NAME ?? 'Minnesota Fire Authority';
    const updated = this.parseDate(props.LAST_UPDATED ?? props.LASTUPDATE ?? props.EFFECTIVE_DATE);

    return {
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        district_id: `MN-FIRE-${districtId}`,
        district_name: agency,
        district_type: 'fire',
        authority: 'Minnesota Emergency Communication Networks (ECN)',
        last_updated: updated ?? new Date().toISOString().slice(0, 10),
        website: 'https://mn.gov/ecn/',
        notes: `${DATASET_NAME} NG911 aggregation`,
        registrySource: DATASET_NAME,
        registryPublisher: 'Minnesota ECN / MnGeo',
        registryScore: 95,
        registryCategories: ['fire']
      }
    };
  }

  private parseDate(value: unknown): string | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const fromEpoch = new Date(value);
      if (!Number.isNaN(fromEpoch.getTime())) {
        return fromEpoch.toISOString().slice(0, 10);
      }
    }

    if (typeof value === 'string' && value.trim()) {
      return value.slice(0, 10);
    }

    return null;
  }
}
