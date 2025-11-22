import crypto from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import { ensureDirectory } from '../utils/files';
import { fetchArcGISFeatures } from '../utils/arcgis';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const FEATURE_SERVICE_URL =
  'https://services.nconemap.gov/secure/rest/services/NC1Map_Water_Sewer_2004/MapServer/4';
const SOURCE_NAME = 'Type A Current Public Water Systems (2004)';
const PUBLISHER = 'NC Center for Geographic Information and Analysis / NC OneMap';
const WEBSITE = 'https://www.nconemap.gov/';
const PAGE_SIZE = 1000;

export class NorthCarolinaWaterIngestor implements AuthorityIngestor {
  readonly id = 'north-carolina-type-a-water-systems';
  readonly state = 'NC';
  readonly dataset = 'water';
  readonly categories = ['water'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'nc', 'water.geojson');
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
    const systemId = this.cleanValue(props.wasyid) ?? this.cleanValue(props.objectid) ?? crypto.randomUUID();
    const systemName = this.cleanValue(props.wasyname) ?? 'North Carolina Water System';
    const county = this.cleanValue(props.wapcs);
    const ownerType = this.cleanValue(props.waownty);
    const contactName = this.cleanValue(props.wapcp);
    const contactTitle = this.cleanValue(props.wapcpt);
    const contactPhone = this.cleanValue(props.waphn);
    const email = this.cleanValue(props.waemail);
    const population = this.cleanNumber(props.wacsp20 ?? props.wacsp10 ?? props.wacsp);

    const notes: string[] = [SOURCE_NAME];
    if (ownerType) {
      notes.push(ownerType);
    }
    if (county) {
      notes.push(`${county} County`);
    }

    return {
      type: 'Feature',
      geometry: feature.geometry!,
      properties: {
        district_id: `NC-WATER-${systemId}`,
        district_name: `${systemName}`,
        district_type: 'water',
        authority: PUBLISHER,
        website: WEBSITE,
        county: county ?? undefined,
        owner_type: ownerType ?? undefined,
        contact_name: contactName ?? undefined,
        contact_title: contactTitle ?? undefined,
        contact_phone: contactPhone ?? undefined,
        contact_email: email ?? undefined,
        population_served: population ?? undefined,
        last_updated: new Date().toISOString().slice(0, 10),
        notes: notes.join(' • '),
        registrySource: SOURCE_NAME,
        registryPublisher: PUBLISHER,
        registryScore: 92,
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
