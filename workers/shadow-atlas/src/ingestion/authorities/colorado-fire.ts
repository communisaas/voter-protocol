import crypto from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import { ensureDirectory } from '../utils/files';
import { fetchArcGISFeatures } from '../utils/arcgis';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const FEATURE_SERVICE_URL =
  'https://services3.arcgis.com/DgjqnJA1rgO92Soi/arcgis/rest/services/Fire_Protection_Districts/FeatureServer/0';
const WEBSITE = 'https://dlg.colorado.gov/special-districts';
const SOURCE_NAME = 'Colorado DOLA Fire Protection Districts';
const PUBLISHER = 'Colorado Department of Local Affairs (DOLA)';
const PAGE_SIZE = 2000;

export class ColoradoFireIngestor implements AuthorityIngestor {
  readonly id = 'colorado-dola-fire-protection-districts';
  readonly state = 'CO';
  readonly dataset = 'fire';
  readonly categories = ['fire'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'co', 'fire.geojson');
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
    const rawId = props.lgid ?? props.OBJECTID ?? crypto.randomUUID();
    const districtName =
      this.cleanValue(props.lgname) ?? this.cleanValue(props.abbrev_name) ?? `Colorado Fire Protection District ${rawId}`;
    const website = this.cleanValue(props.url);
    const addressParts = [
      this.cleanValue(props.mail_address),
      this.cleanValue(props.mail_city),
      this.cleanValue(props.mail_state),
      this.cleanValue(props.mail_zip)
    ].filter(Boolean);

    const notes: string[] = [SOURCE_NAME];
    if (addressParts.length) {
      notes.push(addressParts.join(', '));
    }
    if (website) {
      notes.push(website);
    }

    const lastUpdated = this.parseEpoch(props.lastupdate);

    return {
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        district_id: `CO-FIRE-${rawId}`,
        district_name: districtName,
        district_type: 'fire',
        authority: 'Colorado Department of Local Affairs',
        last_updated: lastUpdated ?? new Date().toISOString().slice(0, 10),
        website: website ?? WEBSITE,
        notes: notes.join(' • '),
        registrySource: SOURCE_NAME,
        registryPublisher: PUBLISHER,
        registryScore: 95,
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
