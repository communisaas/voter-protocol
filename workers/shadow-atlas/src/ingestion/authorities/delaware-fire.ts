import crypto from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import { ensureDirectory } from '../utils/files';
import { fetchArcGISFeatures } from '../utils/arcgis';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const FEATURE_SERVICE_URL =
  'https://enterprise.firstmaptest.delaware.gov/arcgis/rest/services/Society/DE_Fire_Districts/FeatureServer/1';
const WEBSITE = 'https://firstmap.delaware.gov/';
const SOURCE_NAME = 'Delaware FirstMap Fire Districts';
const PUBLISHER = 'Delaware Department of Safety and Homeland Security / FirstMap';
const PAGE_SIZE = 2000;

export class DelawareFireIngestor implements AuthorityIngestor {
  readonly id = 'delaware-firstmap-fire-districts';
  readonly state = 'DE';
  readonly dataset = 'fire';
  readonly categories = ['fire'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'de', 'fire.geojson');
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
    const districtName = this.cleanName(props.NAME, objectId);
    const station = this.cleanValue(props.STATION);
    const address = this.cleanValue(props.ADDRESS);
    const phone = this.cleanValue(props.TELE);

    const notes: string[] = [SOURCE_NAME];
    if (station) {
      notes.push(`Station ${station}`);
    }
    if (address) {
      notes.push(address);
    }
    if (phone) {
      notes.push(`Tel ${phone}`);
    }

    return {
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        district_id: `DE-FIRE-${objectId}`,
        district_name: districtName,
        district_type: 'fire',
        authority: 'Delaware Office of State Fire Marshal / FirstMap',
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

  private cleanName(value: unknown, fallback: string | number): string {
    const text = this.cleanValue(value);
    if (text) {
      return `${text} Fire District`;
    }

    return `Delaware Fire District ${fallback}`;
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
