import crypto from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import type { Feature, FeatureCollection, LineString, MultiLineString } from 'geojson';

import { ensureDirectory } from '../utils/files';
import { fetchArcGISFeatures } from '../utils/arcgis';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const FEATURE_SERVICE_URL =
  'https://enterprise.firstmaptest.delaware.gov/arcgis/rest/services/Transportation/DE_Multimodal/FeatureServer/26';
const SOURCE_NAME = 'Delaware Transit Routes (DART First State)';
const PUBLISHER = 'Delaware Transit Corporation / DART First State';
const WEBSITE = 'https://dartfirststate.com/';
const PAGE_SIZE = 2000;

export class DelawareTransitIngestor implements AuthorityIngestor {
  readonly id = 'delaware-dart-transit-routes';
  readonly state = 'DE';
  readonly dataset = 'transit';
  readonly categories = ['transit'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'de', 'transit.geojson');
    const rawFeatures = await fetchArcGISFeatures<LineString | MultiLineString>(FEATURE_SERVICE_URL, {
      pageSize: PAGE_SIZE
    });

    const features = rawFeatures
      .filter((feature): feature is Feature<LineString | MultiLineString> => Boolean(feature.geometry))
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

  private normalizeFeature(feature: Feature<LineString | MultiLineString>): Feature<LineString | MultiLineString> {
    const props = feature.properties ?? {};
    const objectId = props.OBJECTID ?? crypto.randomUUID();
    const routeName = this.cleanValue(props.ROUTENAME) ?? 'DART Route';
    const routeNumber = this.cleanValue(props.ROUTENUM) ?? String(objectId);
    const routeType = this.cleanValue(props.ROUTETYPE);
    const serviceChange = this.cleanValue(props.SERVICECHANGE);

    const notes: string[] = [SOURCE_NAME];
    if (routeType) {
      notes.push(routeType);
    }
    if (serviceChange) {
      notes.push(`Service change ${serviceChange}`);
    }

    return {
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        district_id: `DE-TRANSIT-${routeNumber}`,
        district_name: `${routeName}`.trim(),
        district_type: 'transit',
        authority: 'Delaware Transit Corporation (DART First State)',
        website: WEBSITE,
        route_number: routeNumber,
        route_type: routeType,
        service_change: serviceChange,
        last_updated: new Date().toISOString().slice(0, 10),
        notes: notes.join(' • '),
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
      return trimmed ? trimmed : null;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }

    return null;
  }
}
