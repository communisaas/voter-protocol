import crypto from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import { ensureDirectory } from '../utils/files';
import { fetchArcGISFeatures } from '../utils/arcgis';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const FEATURE_SERVICE_URL =
  'https://services2.arcgis.com/LYMgRMwHfrWWEg3s/ArcGIS/rest/services/TWDB_Public_Water_Systems/FeatureServer/0';
const SOURCE_NAME = 'TWDB Public Water System Service Areas';
const PUBLISHER = 'Texas Water Development Board';
const WEBSITE = 'https://www.twdb.texas.gov/waterplanning/waterusesurvey/serviceboundaryeditor.asp';
const PAGE_SIZE = 2000;

export class TexasWaterIngestor implements AuthorityIngestor {
  readonly id = 'texas-twdb-public-water-systems';
  readonly state = 'TX';
  readonly dataset = 'water';
  readonly categories = ['water'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'tx', 'water.geojson');
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
    const systemId = this.cleanValue(props.PWSId) ?? crypto.randomUUID();
    const systemName = this.cleanValue(props.pwsName) ?? `Texas Public Water System ${systemId}`;
    const status = this.cleanValue(props.Status);
    const sourceType = this.cleanValue(props.Source);
    const submitDate = this.formatDate(props.SubmitDate);

    const notes: string[] = [SOURCE_NAME];
    if (status) {
      notes.push(`Status: ${status}`);
    }
    if (sourceType) {
      notes.push(`Source: ${sourceType}`);
    }

    return {
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        district_id: `TX-WATER-${systemId}`,
        district_name: `${systemName} Service Area`,
        district_type: 'water',
        authority: 'Texas Water Development Board',
        website: WEBSITE,
        last_updated: submitDate ?? new Date().toISOString().slice(0, 10),
        notes: notes.join(' • '),
        registrySource: SOURCE_NAME,
        registryPublisher: PUBLISHER,
        registryScore: 95,
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

  private formatDate(value: unknown): string | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return date.toISOString().slice(0, 10);
      }
    }

    if (typeof value === 'string' && value.trim()) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 10);
      }
    }

    return null;
  }
}
