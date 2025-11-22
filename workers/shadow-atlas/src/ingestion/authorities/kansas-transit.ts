import crypto from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import { ensureDirectory } from '../utils/files';
import { fetchArcGISFeatures } from '../utils/arcgis';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const FEATURE_SERVICE_URL =
  'https://kanplan.ksdot.gov/arcgis_web_adaptor/rest/services/Boundaries/Coordinated_Transit_Districts/MapServer/0';
const SOURCE_NAME = 'Kansas Coordinated Transit Districts';
const PUBLISHER = 'Kansas Department of Transportation (KanPlan)';
const WEBSITE = 'https://www.ksrides.org/kansas-transit-system';
const PAGE_SIZE = 1000;

export class KansasTransitIngestor implements AuthorityIngestor {
  readonly id = 'kansas-coordinated-transit-districts';
  readonly state = 'KS';
  readonly dataset = 'transit';
  readonly categories = ['transit'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'ks', 'transit.geojson');
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
    const districtCode = this.cleanValue(props.CoordinatedTransitDistrict) ?? String(objectId);
    const districtName = this.cleanValue(props.DistrictName) ?? `Kansas Coordinated Transit District ${districtCode}`;

    return {
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        district_id: `KS-TRANSIT-${districtCode}`,
        district_name: districtName,
        district_type: 'transit',
        authority: 'Kansas Department of Transportation',
        website: WEBSITE,
        last_updated: new Date().toISOString().slice(0, 10),
        notes: `Coordinated Transit District ${districtCode} boundary from KanPlan.`,
        registrySource: SOURCE_NAME,
        registryPublisher: PUBLISHER,
        registryScore: 94,
        registryCategories: ['transit']
      }
    };
  }

  private cleanValue(value: unknown): string | null {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed || null;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }

    return null;
  }
}
