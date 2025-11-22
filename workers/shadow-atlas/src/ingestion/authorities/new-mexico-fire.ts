import crypto from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import { ensureDirectory } from '../utils/files';
import { fetchArcGISFeatures } from '../utils/arcgis';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const FEATURE_SERVICE_URL =
  'https://gis.emnrd.nm.gov/arcgis/rest/services/SFDView/Fire_District_Boundaries/FeatureServer/0';
const WEBSITE = 'https://www.emnrd.nm.gov/sfd/';
const SOURCE_NAME = 'New Mexico Fire District Boundaries';
const PUBLISHER = 'New Mexico Energy, Minerals & Natural Resources Department (EMNRD)';
const PAGE_SIZE = 2000;

export class NewMexicoFireIngestor implements AuthorityIngestor {
  readonly id = 'new-mexico-fire-districts';
  readonly state = 'NM';
  readonly dataset = 'fire';
  readonly categories = ['fire'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'nm', 'fire.geojson');
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
    const objectId = props.OBJECTID ?? crypto.randomUUID();
    const districtName =
      this.cleanValue(props.NASF_Name) ?? this.cleanValue(props.description) ?? `New Mexico Fire District ${objectId}`;
    const fdid = this.cleanValue(props.FDID);

    const notes = [SOURCE_NAME];
    if (fdid) {
      notes.push(`FDID ${fdid}`);
    }

    return {
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        district_id: `NM-FIRE-${fdid ?? objectId}`,
        district_name: districtName,
        district_type: 'fire',
        authority: 'New Mexico EMNRD / State Forestry',
        last_updated: new Date().toISOString().slice(0, 10),
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
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }

    return null;
  }
}
