import fs from 'fs/promises';
import path from 'path';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import { ensureDirectory } from '../utils/files';
import { fetchArcGISFeatures } from '../utils/arcgis';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const FEATURE_SERVICE_URL =
  'https://services7.arcgis.com/MfaOiS4R2QNnitCS/arcgis/rest/services/MSFCA_Data/FeatureServer/20';
const DATASET_WEBSITE = 'https://www.mtfirechiefs.org/';
const AUTHORITY = 'Montana State Fire Chiefs Association';

export class MontanaFireIngestor implements AuthorityIngestor {
  readonly id = 'montana-msfca-fire-districts';
  readonly state = 'MT';
  readonly dataset = 'fire';
  readonly categories = ['fire'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'mt', 'fire.geojson');
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
    const name = props.FDname ?? props.FDnameCounty ?? 'Montana Fire District';
    const stateId = props.State_FDID ?? props.FDID ?? props.OBJECTID ?? Math.random().toString(36).slice(2, 10);
    const updated = this.formatDate(props.last_edited_date);

    return {
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        district_id: `MT-FIRE-${stateId}`,
        district_name: name,
        district_type: 'fire',
        authority: AUTHORITY,
        last_updated: updated ?? new Date().toISOString().slice(0, 10),
        website: DATASET_WEBSITE,
        notes: 'Montana State Fire Chiefs Association response districts.',
        registrySource: 'MSFCA Fire Districts',
        registryPublisher: AUTHORITY,
        registryScore: 94,
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
