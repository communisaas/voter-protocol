import crypto from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import { ensureDirectory } from '../utils/files';
import { fetchArcGISFeatures } from '../utils/arcgis';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const FEATURE_SERVICE_URL =
  'https://ndgishub.nd.gov/arcgis/rest/services/All_EmergencyServices/MapServer/10';
const WEBSITE = 'https://www.nd.gov/des/planning/fire-departments';
const SOURCE_NAME = 'North Dakota Fire Districts (NDGIS Hub)';
const PUBLISHER = 'North Dakota Department of Emergency Services';
const PAGE_SIZE = 2000;

export class NorthDakotaFireIngestor implements AuthorityIngestor {
  readonly id = 'north-dakota-ndgishub-fire-districts';
  readonly state = 'ND';
  readonly dataset = 'fire';
  readonly categories = ['fire'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'nd', 'fire.geojson');
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
    const fireId = this.cleanValue(props.FIRE_ID) ?? this.cleanValue(props.OBJECTID) ?? crypto.randomUUID();
    const name = this.cleanValue(props.NAME) ?? `North Dakota Fire District ${fireId}`;
    const lastEdited = this.parseEpoch(props.LAST_EDITED_DATE);

    const notes: string[] = [SOURCE_NAME];
    if (props.FIRE_ID) {
      notes.push(`Fire ID ${props.FIRE_ID}`);
    }

    return {
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        district_id: `ND-FIRE-${fireId}`,
        district_name: name,
        district_type: 'fire',
        authority: 'North Dakota Department of Emergency Services',
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
