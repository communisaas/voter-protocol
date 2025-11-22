import fs from 'fs/promises';
import path from 'path';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import { ensureDirectory } from '../utils/files';
import { fetchArcGISFeatures } from '../utils/arcgis';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const FEATURE_SERVICE_URL =
  'https://services2.arcgis.com/kNS2ppBA4rwAQQZy/arcgis/rest/services/MO_Public_Drinking_Water_Districts/FeatureServer/0';
const SOURCE_NAME = 'Missouri Public Drinking Water Districts';
const PUBLISHER = 'Missouri Spatial Data Information Service (MSDIS)';
const WEBSITE = 'https://msdis.missouri.edu/';
const PAGE_SIZE = 2000;

export class MissouriWaterIngestor implements AuthorityIngestor {
  readonly id = 'missouri-public-water-districts';
  readonly state = 'MO';
  readonly dataset = 'water';
  readonly categories = ['water'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'mo', 'water.geojson');
    const rawFeatures = await fetchArcGISFeatures<Polygon | MultiPolygon>(FEATURE_SERVICE_URL, {
      pageSize: PAGE_SIZE
    });

    const normalized = rawFeatures
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

  private normalizeFeature(feature: Feature<Polygon | MultiPolygon>): Feature<Polygon | MultiPolygon> {
    const props = feature.properties ?? {};
    const systemId = this.cleanValue(props.PWSSID) ?? this.cleanValue(props.IPWS) ?? String(props.FID ?? 'MO');
    const systemName = this.cleanValue(props.PWSSNAME) ?? 'Missouri Public Water System';
    const status = this.cleanValue(props.STATUS);
    const county = this.cleanValue(props.COUNTY);
    const region = this.cleanValue(props.MDNRREG);
    const acres = this.cleanNumber(props.ACRES);
    const squareMiles = this.cleanNumber(props.SQMI);

    const notes: string[] = [SOURCE_NAME];
    if (status) {
      notes.push(`Status: ${status}`);
    }
    if (region) {
      notes.push(`MDNR region ${region}`);
    }
    if (county) {
      notes.push(`${county} County`);
    }

    return {
      type: 'Feature',
      geometry: feature.geometry!,
      properties: {
        district_id: `MO-WATER-${systemId}`,
        district_name: systemName,
        district_type: 'water',
        authority: PUBLISHER,
        website: WEBSITE,
        status: status ?? undefined,
        county: county ?? undefined,
        mdnr_region: region ?? undefined,
        acres: acres ?? undefined,
        square_miles: squareMiles ?? undefined,
        last_updated: new Date().toISOString().slice(0, 10),
        notes: notes.join(' • '),
        registrySource: SOURCE_NAME,
        registryPublisher: PUBLISHER,
        registryScore: 93,
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

  private cleanNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const numeric = Number(value.replace(/,/g, ''));
      if (!Number.isNaN(numeric)) {
        return numeric;
      }
    }

    return null;
  }
}

