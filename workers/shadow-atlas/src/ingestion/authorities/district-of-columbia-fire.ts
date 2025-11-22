import crypto from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import { ensureDirectory } from '../utils/files';
import { fetchArcGISFeatures } from '../utils/arcgis';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const FEATURE_SERVICE_URL =
  'https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_APPS/FEMS_Awareness_Viewer/MapServer/8';
const WEBSITE = 'https://fems.dc.gov/';
const SOURCE_NAME = 'DC Fire and EMS Alarm Districts';
const PUBLISHER = 'District of Columbia Fire and EMS Department (FEMS)';
const PAGE_SIZE = 2000;

export class DistrictOfColumbiaFireIngestor implements AuthorityIngestor {
  readonly id = 'district-of-columbia-fems-fire-districts';
  readonly state = 'DC';
  readonly dataset = 'fire';
  readonly categories = ['fire'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'dc', 'fire.geojson');
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
    const name =
      this.cleanValue(props.NAME) ??
      this.cleanValue(props.ENGINE_ID) ??
      `DC Fire/EMS Alarm District ${objectId}`;
    const battalion = this.cleanValue(props.BATTALION);
    const established = this.parseEpoch(props.DATE_EST);

    const notes: string[] = [SOURCE_NAME];
    if (battalion) {
      notes.push(`Battalion ${battalion}`);
    }
    if (established) {
      notes.push(`Established ${established}`);
    }

    return {
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        district_id: `DC-FIRE-${objectId}`,
        district_name: name,
        district_type: 'fire',
        authority: 'DC Fire and EMS Department',
        last_updated: new Date().toISOString().slice(0, 10),
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
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
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
