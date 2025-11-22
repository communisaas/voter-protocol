import crypto from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import { ensureDirectory } from '../utils/files';
import { fetchArcGISFeatures } from '../utils/arcgis';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const FEATURE_SERVICE_URL =
  'https://services1.arcgis.com/7HDiw78fcUiM2BWn/arcgis/rest/services/Fire_Service_Areas_Public_View/FeatureServer/0';
const WEBSITE = 'https://forestry.alaska.gov/fire';
const SOURCE_NAME = 'Alaska Fire Service Areas';
const PUBLISHER = 'Alaska Division of Forestry & Fire Protection';
const PAGE_SIZE = 2000;

export class AlaskaFireIngestor implements AuthorityIngestor {
  readonly id = 'alaska-dof-fire-service-areas';
  readonly state = 'AK';
  readonly dataset = 'fire';
  readonly categories = ['fire'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'ak', 'fire.geojson');
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
    const serviceName =
      this.cleanValue(props.fire_service_area_name) ?? this.cleanValue(props.borough) ?? 'Alaska Fire Service Area';
    const objectId = this.cleanValue(props.objectid) ?? crypto.randomUUID();
    const acres = typeof props.acres === 'number' ? props.acres : null;
    const borough = this.cleanValue(props.borough);
    const lastEdited = this.parseEpoch(props.last_edited_date) ?? this.parseEpoch(props.created_date);

    const notes: string[] = [SOURCE_NAME];
    if (borough) {
      notes.push(`Borough ${borough}`);
    }
    if (acres) {
      notes.push(`${acres.toLocaleString('en-US')} acres`);
    }

    return {
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        district_id: `AK-FIRE-${objectId}`,
        district_name: `${serviceName} Fire Service Area`,
        district_type: 'fire',
        authority: 'Alaska Division of Forestry & Fire Protection',
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
