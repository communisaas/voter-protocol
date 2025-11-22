import crypto from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import { ensureDirectory } from '../utils/files';
import { fetchArcGISFeatures } from '../utils/arcgis';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const FEATURE_SERVICE_URL =
  'https://gis.ne.gov/Enterprise/rest/services/Fire_District_Response_Areas/FeatureServer/0';
const WEBSITE = 'https://psc.nebraska.gov/telecommunications/911-service-system';
const SOURCE_NAME = 'Nebraska Fire District Response Areas';
const PUBLISHER = 'Nebraska Public Service Commission – NG911';
const PAGE_SIZE = 2000;

export class NebraskaFireIngestor implements AuthorityIngestor {
  readonly id = 'nebraska-psc-fire-districts';
  readonly state = 'NE';
  readonly dataset = 'fire';
  readonly categories = ['fire'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'ne', 'fire.geojson');
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
    const nguid = this.cleanValue(props.ES_NGUID);
    const objectId = this.cleanValue(props.OBJECTID) ?? crypto.randomUUID();
    const districtName =
      this.cleanValue(props.DsplayName) ?? this.cleanValue(props.ServiceURN) ?? `Nebraska Fire District ${objectId}`;
    const agencySource = this.cleanValue(props.DiscrpAgID) ?? this.cleanValue(props.Reg_Source);
    const serviceUri = this.cleanValue(props.ServiceURI);
    const lastUpdated = this.parseEpoch(props.DateUpdate);

    const notes: string[] = [SOURCE_NAME];
    if (agencySource) {
      notes.push(`Source agency ${agencySource}`);
    }
    if (serviceUri) {
      notes.push(serviceUri);
    }

    return {
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        district_id: `NE-FIRE-${nguid ?? objectId}`,
        district_name: districtName,
        district_type: 'fire',
        authority: 'Nebraska Public Service Commission (NG911)',
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
