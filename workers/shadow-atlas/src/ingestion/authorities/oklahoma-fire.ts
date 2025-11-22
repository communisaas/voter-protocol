import crypto from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import { ensureDirectory } from '../utils/files';
import { fetchArcGISFeatures } from '../utils/arcgis';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const FEATURE_SERVICE_URL =
  'https://services.arcgis.com/3xOwF6p0r7IHIjfn/arcgis/rest/services/Fire_Protection_Districts/FeatureServer/0';
const WEBSITE = 'https://oklahoma.gov/tax/individuals/property-tax/fire-protection-districts.html';
const SOURCE_NAME = 'Oklahoma Tax Commission Fire Protection Districts';
const PUBLISHER = 'Oklahoma Tax Commission – Ad Valorem Division';
const PAGE_SIZE = 2000;

export class OklahomaFireIngestor implements AuthorityIngestor {
  readonly id = 'oklahoma-tax-commission-fire-districts';
  readonly state = 'OK';
  readonly dataset = 'fire';
  readonly categories = ['fire'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'ok', 'fire.geojson');
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
    const otcNumber = this.cleanValue(props.OTC_NUM);
    const objectId = this.cleanValue(props.FID) ?? crypto.randomUUID();
    const districtName = this.cleanValue(props.NAME) ?? `Oklahoma Fire Protection District ${otcNumber ?? objectId}`;
    const lastEdited = this.parseDate(props.EDIT_DATE);

    const notes: string[] = [SOURCE_NAME];
    if (otcNumber) {
      notes.push(`OTC district ${otcNumber}`);
    }

    return {
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        district_id: `OK-FIRE-${otcNumber ?? objectId}`,
        district_name: districtName,
        district_type: 'fire',
        authority: 'Oklahoma Tax Commission',
        last_updated: lastEdited ?? new Date().toISOString().slice(0, 10),
        website: WEBSITE,
        notes: notes.join(' • '),
        registrySource: SOURCE_NAME,
        registryPublisher: PUBLISHER,
        registryScore: 94,
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

  private parseDate(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 10);
      }
    }

    return null;
  }
}
