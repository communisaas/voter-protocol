import fs from 'fs/promises';
import path from 'path';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import { ensureDirectory } from '../utils/files';
import { fetchArcGISFeatures } from '../utils/arcgis';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const FEATURE_SERVICE_URL =
  'https://risegis.ri.gov/hosting/rest/services/RIDEM/Boundaries_and_Regulatory_Overlays_v2/FeatureServer/16';
const SOURCE_NAME = 'Rhode Island Water District Service Areas';
const PUBLISHER = 'Rhode Island Department of Environmental Management (RIDEM)';
const WEBSITE = 'https://www.rigis.org/datasets/rhode-island-water-district-service-area/about';
const PAGE_SIZE = 1000;

export class RhodeIslandWaterIngestor implements AuthorityIngestor {
  readonly id = 'rhode-island-water-districts';
  readonly state = 'RI';
  readonly dataset = 'water';
  readonly categories = ['water'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'ri', 'water.geojson');
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
    const supplier = this.cleanValue(props.SUPPLIER) ?? 'Rhode Island Water System';
    const systemId = this.cleanValue(props.ID_SDWIS) ?? String(props.OBJECTID ?? supplier);
    const waterSource = this.cleanValue(props.H2O_SOURCE);
    const supplyType = this.cleanValue(props.SUP_TYPE);
    const waterCategory = this.cleanValue(props.SW_OR_GW);
    const population = this.cleanNumber(props.POP_2022);

    const notes: string[] = [SOURCE_NAME];
    if (waterSource) {
      notes.push(`Source: ${waterSource}`);
    }
    if (supplyType) {
      notes.push(`Supply type: ${supplyType}`);
    }
    if (waterCategory) {
      notes.push(`Supply category: ${waterCategory}`);
    }
    if (typeof population === 'number') {
      notes.push(`Population served (2022): ${population.toLocaleString('en-US')}`);
    }

    return {
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        district_id: `RI-WATER-${systemId}`,
        district_name: `${supplier} Service Area`,
        district_type: 'water',
        authority: PUBLISHER,
        website: WEBSITE,
        water_source: waterSource ?? undefined,
        supply_type: supplyType ?? undefined,
        supply_category: waterCategory ?? undefined,
        population_served: population ?? undefined,
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
