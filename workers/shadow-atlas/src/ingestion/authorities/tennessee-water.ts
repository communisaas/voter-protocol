import fs from 'fs/promises';
import path from 'path';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import { ensureDirectory } from '../utils/files';
import { fetchArcGISFeatures } from '../utils/arcgis';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const FEATURE_SERVICE_URL =
  'https://services5.arcgis.com/bPacKTm9cauMXVfn/ArcGIS/rest/services/TN_Public_Water_System_Service_Area_Boundaries_WFL1/FeatureServer/0';
const SOURCE_NAME = 'TN Public Water System Service Area Boundaries';
const PUBLISHER = 'Tennessee Department of Environment & Conservation (TDEC)';
const WEBSITE = 'https://www.tn.gov/environment/program-areas/wr-water-resources.html';
const PAGE_SIZE = 2000;

export class TennesseeWaterIngestor implements AuthorityIngestor {
  readonly id = 'tennessee-public-water-systems';
  readonly state = 'TN';
  readonly dataset = 'water';
  readonly categories = ['water'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'tn', 'water.geojson');
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
    const systemId = this.cleanValue(props.PWSID) ?? this.cleanValue(props.TINWSYS_IS_NUMBER) ?? 'UNKNOWN';
    const systemName = this.cleanValue(props.MA_NAME) ?? 'Tennessee Public Water System';
    const fieldOffice = this.cleanValue(props.fieldOffic);
    const population = this.cleanNumber(props.PL_POPL);
    const sourceType = this.cleanValue(props.PL_PSRC);
    const ownership = this.cleanValue(props.OW_TYPE);
    const dwwLink = this.cleanValue(props.DWW_Link);

    const notes: string[] = [SOURCE_NAME];
    if (fieldOffice) {
      notes.push(`${fieldOffice} field office`);
    }
    if (sourceType) {
      notes.push(`Source: ${sourceType}`);
    }
    if (ownership) {
      notes.push(`Owner type: ${ownership}`);
    }

    return {
      type: 'Feature',
      geometry: feature.geometry!,
      properties: {
        district_id: `TN-WATER-${systemId}`,
        district_name: systemName,
        district_type: 'water',
        authority: PUBLISHER,
        website: dwwLink ?? WEBSITE,
        field_office: fieldOffice ?? undefined,
        population_served: population ?? undefined,
        source_type: sourceType ?? undefined,
        ownership_type: ownership ?? undefined,
        last_updated: new Date().toISOString().slice(0, 10),
        notes: notes.join(' • '),
        registrySource: SOURCE_NAME,
        registryPublisher: PUBLISHER,
        registryScore: 94,
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
