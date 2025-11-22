import crypto from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import { ensureDirectory } from '../utils/files';
import { fetchArcGISFeatures } from '../utils/arcgis';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const FEATURE_SERVICE_URL =
  'https://services6.arcgis.com/clPWQMwZfdWn4MQZ/arcgis/rest/services/AZ_NG911_Fire_Boundary_AGOL/FeatureServer/1';
const SOURCE_NAME = 'Arizona NG911 Fire Boundaries';
const PUBLISHER = 'Arizona 911 Program (A911P)';
const WEBSITE = 'https://azgovernor.gov/its/agency-services/9-1-1-program';
const PAGE_SIZE = 2000;

export class ArizonaFireIngestor implements AuthorityIngestor {
  readonly id = 'arizona-ng911-fire-districts';
  readonly state = 'AZ';
  readonly dataset = 'fire';
  readonly categories = ['fire'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'az', 'fire.geojson');
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
    const esNguid = this.cleanValue(props.ES_NGUID) ?? crypto.randomUUID();
    const agencyId = this.cleanValue(props.Agency_ID);
    const displayName = this.cleanValue(props.DisplayName) ?? `Arizona Fire Agency ${esNguid}`;
    const serviceUri = this.cleanValue(props.ServiceURI);
    const serviceNum = this.cleanValue(props.ServiceNum);
    const lastUpdated = this.formatDate(props.DateUpdate ?? props.last_edited_date);

    const notes: string[] = [SOURCE_NAME];
    if (agencyId) {
      notes.push(`Agency ID: ${agencyId}`);
    }
    if (serviceNum) {
      notes.push(`Service: ${serviceNum}`);
    }
    if (serviceUri) {
      notes.push(serviceUri);
    }

    return {
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        district_id: `AZ-FIRE-${esNguid}`,
        district_name: displayName,
        district_type: 'fire',
        authority: 'Arizona 911 Program',
        website: WEBSITE,
        last_updated: lastUpdated ?? new Date().toISOString().slice(0, 10),
        notes: notes.join(' • '),
        registrySource: SOURCE_NAME,
        registryPublisher: PUBLISHER,
        registryScore: 96,
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

  private formatDate(value: unknown): string | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return date.toISOString().slice(0, 10);
      }
    }

    if (typeof value === 'string' && value.trim()) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return date.toISOString().slice(0, 10);
      }
    }

    return null;
  }
}
