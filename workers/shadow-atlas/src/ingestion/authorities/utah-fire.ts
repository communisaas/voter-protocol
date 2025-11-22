import crypto from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import { ensureDirectory } from '../utils/files';
import { fetchArcGISFeatures } from '../utils/arcgis';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const FEATURE_SERVICE_URL =
  'https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/FireResponseAreas/FeatureServer/0';
const WEBSITE = 'https://gis.utah.gov/products/sgid/society/fire-response-areas/';
const PAGE_SIZE = 2000;

export class UtahFireIngestor implements AuthorityIngestor {
  readonly id = 'utah-fire-response-areas';
  readonly state = 'UT';
  readonly dataset = 'fire';
  readonly categories = ['fire'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'ut', 'fire.geojson');
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
    const districtId =
      props.RESP_AREA_ID ?? props.AGENCYID ?? props.OBJECTID ?? props.AGENCY_ID ?? props.GLOBALID ?? crypto.randomUUID();
    const agencyName =
      props.AGENCYNAME ?? props.AGENCY ?? props.PRIMARY_AGENCY ?? props.NAME ?? `Utah Fire Agency ${districtId}`;
    const agencyType = props.AGENCYTYPE ?? props.AGENCY_TYPE ?? props.TYPE ?? 'fire';
    const lastUpdated = this.parseEpoch(props.LASTUPDATE) ?? this.parseEpoch(props.EFFECTIVEDATE) ?? null;

    return {
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        district_id: `UT-FIRE-${districtId}`,
        district_name: agencyName,
        district_type: 'fire',
        authority: 'Utah Geospatial Resource Center (UGRC)',
        last_updated: lastUpdated ?? new Date().toISOString().slice(0, 10),
        website: WEBSITE,
        notes: `${agencyType} response area from UGRC SGID dataset`,
        registrySource: 'UGRC Fire Response Areas',
        registryPublisher: 'Utah Geospatial Resource Center',
        registryScore: 96,
        registryCategories: ['fire']
      }
    };
  }

  private parseEpoch(value: unknown): string | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return date.toISOString().slice(0, 10);
      }
    }

    if (typeof value === 'string' && value.trim()) {
      return value.slice(0, 10);
    }

    return null;
  }
}
