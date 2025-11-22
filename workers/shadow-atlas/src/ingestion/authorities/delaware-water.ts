import crypto from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import { ensureDirectory } from '../utils/files';
import { fetchArcGISFeatures } from '../utils/arcgis';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const FEATURE_SERVICE_URL =
  'https://enterprise.firstmaptest.delaware.gov/arcgis/rest/services/Boundaries/DE_CPCN/FeatureServer/0';
const SOURCE_NAME = 'Delaware PSC Water CPCN';
const PUBLISHER = 'Delaware Public Service Commission / FirstMap';
const WEBSITE = 'https://depsc.delaware.gov/';
const PAGE_SIZE = 1000;

export class DelawareWaterIngestor implements AuthorityIngestor {
  readonly id = 'delaware-psc-water-cpcn';
  readonly state = 'DE';
  readonly dataset = 'water';
  readonly categories = ['water'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'de', 'water.geojson');
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
    const cpcnNumber = this.cleanValue(props.CPCN_) ?? this.cleanValue(props.ORDER_NO) ?? `CPCN-${objectId}`;
    const company = this.cleanValue(props.COMPANY1) ?? 'Unknown Water Utility';
    const county = this.cleanValue(props.COUNTY);
    const issued = this.formatDate(props.ISSUE_DATE);
    const acres = typeof props.ACRES === 'number' ? props.ACRES : null;

    const notes: string[] = [SOURCE_NAME];
    if (issued) {
      notes.push(`Issued ${issued}`);
    }
    if (county) {
      notes.push(`${county} County`);
    }
    if (acres) {
      notes.push(`${acres.toFixed(1)} acres`);
    }

    return {
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        district_id: `DE-WATER-${cpcnNumber}`,
        district_name: `${company} CPCN`,
        district_type: 'water',
        authority: 'Delaware Public Service Commission',
        website: WEBSITE,
        order_number: this.cleanValue(props.ORDER_NO),
        prior_cpcn: this.cleanValue(props.PRIORCPCNC) ?? this.cleanValue(props.PRIORCPCNN),
        service_area_acres: acres ?? undefined,
        last_updated: issued ?? new Date().toISOString().slice(0, 10),
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

  private formatDate(value: unknown): string | null {
    if (typeof value === 'string' && value) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 10);
      }
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      // ArcGIS dates are epoch milliseconds
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 10);
      }
    }

    return null;
  }
}
