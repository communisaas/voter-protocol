import crypto from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import { ensureDirectory } from '../utils/files';
import { fetchArcGISFeatures } from '../utils/arcgis';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const FEATURE_SERVICE_URL =
  'https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Boundaries/MapServer/59';
const WEBSITE = 'https://gis.arkansas.gov/programs/911-resources/';
const SOURCE_NAME = 'Arkansas Fire Districts';
const PUBLISHER = 'Arkansas GIS Office / Arkansas 911 Board';
const PAGE_SIZE = 2000;

export class ArkansasFireIngestor implements AuthorityIngestor {
  readonly id = 'arkansas-fire-districts';
  readonly state = 'AR';
  readonly dataset = 'fire';
  readonly categories = ['fire'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'ar', 'fire.geojson');
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
    const objectId = props.objectid ?? crypto.randomUUID();
    const districtName = this.cleanValue(props.name) ?? `Arkansas Fire District ${objectId}`;
    const fdid = this.cleanValue(props.fdid_nfirsid);
    const serviceArea = this.cleanValue(props.service_area);
    const districtType = this.cleanValue(props.fire_district_type);
    const lastUpdated = this.parseEpoch(props.revision_date);
    const squareMiles = typeof props.square_miles === 'number' ? props.square_miles : null;

    const notes: string[] = [SOURCE_NAME];
    if (fdid) {
      notes.push(`FDID ${fdid}`);
    }
    if (serviceArea) {
      notes.push(`Service area ${serviceArea}`);
    }
    if (districtType) {
      notes.push(districtType);
    }
    if (squareMiles) {
      notes.push(`${squareMiles.toFixed(2)} sq mi`);
    }

    return {
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        district_id: `AR-FIRE-${fdid ?? objectId}`,
        district_name: districtName,
        district_type: 'fire',
        authority: 'Arkansas GIS Office / Arkansas 911 Board',
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
