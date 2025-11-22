import fs from 'fs/promises';
import path from 'path';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import { ensureDirectory } from '../utils/files';
import { fetchArcGISFeatures } from '../utils/arcgis';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const FEATURE_SERVICE_URL =
  'https://services.arcgis.com/jsIt88o09Q0r1j8h/arcgis/rest/services/Emergency_Response_Boundaries/FeatureServer/1';
const DATASET_WEBSITE = 'https://geo.wa.gov/datasets/74981ffe7d1348f9b39f841143b8123e';
const AUTHORITY = 'Washington State Enhanced 911 (WA E911)';

export class WashingtonFireIngestor implements AuthorityIngestor {
  readonly id = 'washington-e911-fire-districts';
  readonly state = 'WA';
  readonly dataset = 'fire';
  readonly categories = ['fire'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'wa', 'fire.geojson');
    const rawFeatures = await fetchArcGISFeatures<Polygon | MultiPolygon>(FEATURE_SERVICE_URL, {
      pageSize: 2000
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
    const agencyId = props.Agency_ID ?? props.ES_NGUID ?? props.GlobalID ?? '';
    const districtId = agencyId ? `WA-FIRE-${agencyId}` : `WA-FIRE-${Math.random().toString(36).slice(2, 10)}`;
    const updated = this.formatDate(props.DateUpdate ?? props.Effective);
    const displayName = props.DsplayName ?? props.ServiceURN ?? 'Washington Fire District';

    return {
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        district_id: districtId,
        district_name: displayName,
        district_type: 'fire',
        authority: AUTHORITY,
        last_updated: updated ?? new Date().toISOString().slice(0, 10),
        website: DATASET_WEBSITE,
        notes: 'Washington State E911 Emergency Response Boundaries (fire service layer)',
        registrySource: 'Washington E911 Emergency Response Boundaries',
        registryPublisher: AUTHORITY,
        registryScore: 96,
        registryCategories: ['fire']
      }
    };
  }

  private formatDate(value: unknown): string | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return date.toISOString().slice(0, 10);
      }
    }

    if (typeof value === 'string' && value.trim()) {
      return value.slice(0, 10);
    }

    return null;
  }
}
