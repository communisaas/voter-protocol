import crypto from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import { ensureDirectory } from '../utils/files';
import { fetchArcGISFeatures } from '../utils/arcgis';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const FEATURE_SERVICE_URL =
  'https://services.arcgis.com/ZzrwjTRez6FJiOq4/arcgis/rest/services/CulinaryWaterServiceAreas/FeatureServer/0';
const SOURCE_NAME = 'Utah Culinary Water Service Areas';
const PUBLISHER = 'Utah Division of Drinking Water / UGRC';
const WEBSITE = 'https://gis.utah.gov/data/society/water-systems/';
const PAGE_SIZE = 2000;

export class UtahWaterIngestor implements AuthorityIngestor {
  readonly id = 'utah-culinary-water-service-areas';
  readonly state = 'UT';
  readonly dataset = 'water';
  readonly categories = ['water'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'ut', 'water.geojson');
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
    const systemId = this.cleanValue(props.DWSYSNUM) ?? this.cleanValue(props.WRID) ?? crypto.randomUUID();
    const systemName =
      this.cleanValue(props.WRENAME) ?? this.cleanValue(props.WRNAME) ?? `Utah Water System ${systemId}`;
    const status = this.cleanValue(props.STATUS);
    const systemType = this.cleanValue(props.SYSTEMTYPE);
    const wholesaler = this.cleanValue(props.WHOLESALER);
    const county = this.cleanValue(props.COUNTY);
    const basin = this.cleanValue(props.BASIN);
    const lastUpdated = this.formatDate(props.EDITDATE) ?? this.formatDate(props.SOURCEDATE);

    const notes: string[] = [SOURCE_NAME];
    if (systemType) {
      notes.push(systemType);
    }
    if (wholesaler) {
      notes.push(`Wholesaler: ${wholesaler}`);
    }
    if (county) {
      notes.push(`${county} County`);
    }
    if (basin) {
      notes.push(`${basin} Basin`);
    }
    if (status) {
      notes.push(`Status: ${status}`);
    }

    return {
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        district_id: `UT-WATER-${systemId}`,
        district_name: `${systemName} Service Area`,
        district_type: 'water',
        authority: 'Utah Division of Drinking Water',
        website: WEBSITE,
        last_updated: lastUpdated ?? new Date().toISOString().slice(0, 10),
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
      const asDate = new Date(value);
      if (!Number.isNaN(asDate.getTime())) {
        return asDate.toISOString().slice(0, 10);
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
