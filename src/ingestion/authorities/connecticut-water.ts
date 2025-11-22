import crypto from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson';

import { ensureDirectory } from '../utils/files';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const FEATURE_SERVICE_URL = 'https://maps.ct.gov/arcgis/rest/services/Test_Map_ESAa_MIL1/MapServer/0';
const SOURCE_NAME = 'Connecticut Exclusive Service Areas';
const PUBLISHER = 'Connecticut Department of Public Health (WUCC Program)';
const WEBSITE = 'https://portal.ct.gov/DPH/Drinking-Water/WUCC/Water-Utility-Coordinating-Committee';
const CHUNK_SIZE = 200;

interface ArcGisIdResponse {
  objectIds?: number[];
}

export class ConnecticutWaterIngestor implements AuthorityIngestor {
  readonly id = 'connecticut-exclusive-service-areas';
  readonly state = 'CT';
  readonly dataset = 'water';
  readonly categories = ['water'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'ct', 'water.geojson');
    const features = await this.fetchAllFeatures();

    const normalized = features
      .filter((feature): feature is Feature<Polygon | MultiPolygon> => Boolean(feature.geometry))
      .map(feature => this.normalizeFeature(feature));

    const collection: FeatureCollection = {
      type: 'FeatureCollection',
      features: normalized
    };

    await ensureDirectory(path.dirname(outputPath));
    await fs.writeFile(outputPath, JSON.stringify(collection));

    return {
      state: this.state,
      dataset: this.dataset,
      featuresWritten: normalized.length,
      outputPath,
      metadata: {
        source: FEATURE_SERVICE_URL
      }
    };
  }

  private async fetchAllFeatures(): Promise<Array<Feature<Polygon | MultiPolygon>>> {
    const objectIds = await this.fetchObjectIds();
    const features: Array<Feature<Polygon | MultiPolygon>> = [];

    for (let i = 0; i < objectIds.length; i += CHUNK_SIZE) {
      const chunkIds = objectIds.slice(i, i + CHUNK_SIZE);
      const params = new URLSearchParams({
        objectIds: chunkIds.join(','),
        outFields: '*',
        returnGeometry: 'true',
        f: 'geojson'
      });

      const response = await fetch(`${FEATURE_SERVICE_URL}/query?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch Connecticut ESA features (status ${response.status})`);
      }

      const page = (await response.json()) as FeatureCollection;
      const pageFeatures = (page.features ?? []) as Array<Feature<Polygon | MultiPolygon>>;
      features.push(...pageFeatures);
    }

    return features;
  }

  private async fetchObjectIds(): Promise<number[]> {
    const params = new URLSearchParams({
      where: '1=1',
      returnIdsOnly: 'true',
      f: 'pjson'
    });

    const response = await fetch(`${FEATURE_SERVICE_URL}/query?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch objectIds for Connecticut ESAs (status ${response.status})`);
    }

    const data = (await response.json()) as ArcGisIdResponse;
    const ids = data.objectIds ?? [];
    return ids.sort((a, b) => a - b);
  }

  private normalizeFeature(feature: Feature<Polygon | MultiPolygon>): Feature<Polygon | MultiPolygon> {
    const props = feature.properties ?? {};
    const fid = typeof props.FID === 'number' ? props.FID : crypto.randomUUID();
    const holder = this.cleanValue(props.Name) ?? 'Unassigned Exclusive Service Area';
    const propertyNote = this.cleanValue(props.Property);

    const notes = [SOURCE_NAME];
    if (propertyNote && holder === 'Unassigned Exclusive Service Area') {
      notes.push(propertyNote);
    }

    return {
      type: 'Feature',
      geometry: feature.geometry!,
      properties: {
        district_id: `CT-WATER-${fid}`,
        district_name: `${holder}`,
        district_type: 'water',
        authority: PUBLISHER,
        website: WEBSITE,
        last_updated: new Date().toISOString().slice(0, 10),
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
}

