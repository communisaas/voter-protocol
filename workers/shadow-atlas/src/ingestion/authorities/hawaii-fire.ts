import crypto from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import { ensureDirectory } from '../utils/files';
import { fetchArcGISFeatures } from '../utils/arcgis';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const FEATURE_SERVICE_URL = 'https://geodata.hawaii.gov/arcgis/rest/services/EmergMgmtPubSafety/MapServer/6';
const WEBSITE = 'https://planning.hawaii.gov/gis/';
const SOURCE_NAME = 'Hawaii Fire Response Zones';
const PUBLISHER = 'Hawaii Statewide GIS Program';
const PAGE_SIZE = 2000;

export class HawaiiFireIngestor implements AuthorityIngestor {
  readonly id = 'hawaii-statewide-fire-response-zones';
  readonly state = 'HI';
  readonly dataset = 'fire';
  readonly categories = ['fire'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'hi', 'fire.geojson');
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
    const objectId = this.cleanValue(props.OBJECTID) ?? crypto.randomUUID();
    const name =
      this.cleanValue(props.RESPONSE) ??
      this.cleanValue(props.DISTNAME) ??
      this.cleanValue(props.FIRE_DIST) ??
      `Hawaii Fire Response ${objectId}`;
    const island = this.cleanValue(props.ISLAND);
    const acres = typeof props.ACRES === 'number' ? props.ACRES : null;
    const lastEdited = this.parseEpoch(props.EditDate) ?? this.parseEpoch(props.CREATIONDATE);

    const notes: string[] = [SOURCE_NAME];
    if (island) {
      notes.push(`Island ${island}`);
    }
    if (acres) {
      notes.push(`${acres.toLocaleString('en-US')} acres`);
    }

    return {
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        district_id: `HI-FIRE-${objectId}`,
        district_name: `${name}`.trim(),
        district_type: 'fire',
        authority: 'Hawaii Statewide GIS Program / County Fire Agencies',
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
