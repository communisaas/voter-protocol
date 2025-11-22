import crypto from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import { ensureDirectory } from '../utils/files';
import { fetchArcGISFeatures } from '../utils/arcgis';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const FEATURE_SERVICE_URL =
  'https://services.arcgis.com/djZgF6YJCuO8rbmH/arcgis/rest/services/Kansas_Fire_Districts_Public/FeatureServer/0';
const WEBSITE = 'https://www.kansasforests.org/fire/';
const SOURCE_NAME = 'Kansas Forest Service Fire Districts';
const PUBLISHER = 'Kansas Forest Service';
const PAGE_SIZE = 2000;

export class KansasFireIngestor implements AuthorityIngestor {
  readonly id = 'kansas-forest-service-fire-districts';
  readonly state = 'KS';
  readonly dataset = 'fire';
  readonly categories = ['fire'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'ks', 'fire.geojson');
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
    const rawId = this.cleanValue(props.FDID) ?? this.cleanValue(props.OBJECTID) ?? crypto.randomUUID();
    const districtName =
      this.cleanValue(props.Display_Na) ?? this.cleanValue(props.Agency_ID) ?? `Kansas Fire District ${rawId}`;
    const county = this.cleanValue(props.County);
    const departmentType = this.cleanValue(props.DepartmentType);
    const comments = this.cleanValue(props.Comments);

    const notes: string[] = [SOURCE_NAME];
    if (county) {
      notes.push(`County: ${county}`);
    }
    if (departmentType) {
      notes.push(`Department type: ${departmentType}`);
    }
    if (comments) {
      notes.push(comments);
    }

    const lastUpdated = this.parseEpoch(props.Date_Updat);

    return {
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        district_id: `KS-FIRE-${rawId}`,
        district_name: districtName,
        district_type: 'fire',
        authority: 'Kansas Forest Service',
        last_updated: lastUpdated ?? new Date().toISOString().slice(0, 10),
        website: WEBSITE,
        notes: notes.join(' • '),
        registrySource: SOURCE_NAME,
        registryPublisher: PUBLISHER,
        registryScore: 95,
        registryCategories: ['fire']
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

  private parseEpoch(value: unknown): string | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return date.toISOString().slice(0, 10);
      }
    }

    return null;
  }
}
