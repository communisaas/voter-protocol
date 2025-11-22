import fs from 'fs/promises';
import path from 'path';
import type { Feature, FeatureCollection, LineString, MultiLineString } from 'geojson';

import { ensureDirectory } from '../utils/files';
import { fetchArcGISFeatures } from '../utils/arcgis';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const FEATURE_SERVICE_URL =
  'https://services2.arcgis.com/S8zZg9pg23JUEexQ/arcgis/rest/services/TRANS_RIPTA_Bus_Routes_2024/FeatureServer/5';
const SOURCE_NAME = 'RIPTA Bus Routes (2024)';
const PUBLISHER = 'Rhode Island Public Transit Authority (RIPTA)';
const WEBSITE = 'https://www.ripta.com/';
const PAGE_SIZE = 2000;

export class RhodeIslandTransitIngestor implements AuthorityIngestor {
  readonly id = 'rhode-island-ripta-transit-routes';
  readonly state = 'RI';
  readonly dataset = 'transit';
  readonly categories = ['transit'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'ri', 'transit.geojson');
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
    const routeId = this.cleanValue(props.route_id) ?? this.cleanValue(props.short_name) ?? String(props.OBJECTID ?? 'RIPTA');
    const shortName = this.cleanValue(props.short_name);
    const longName = this.cleanValue(props.long_name) ?? 'RIPTA Route';
    const routeType = this.cleanValue(props.rt_tp_txt) ?? this.cleanValue(props.route_type);
    const routeUrl = this.cleanValue(props.route_url);
    const shapeId = this.cleanValue(props.shape_id);
    const color = this.cleanValue(props.color);
    const textColor = this.cleanValue(props.text_color);

    const notes: string[] = [SOURCE_NAME];
    if (routeType) {
      notes.push(routeType);
    }
    if (shapeId) {
      notes.push(`shape_id ${shapeId}`);
    }

    return {
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        district_id: `RI-TRANSIT-${routeId}`,
        district_name: shortName ? `${shortName} – ${longName}` : longName,
        district_type: 'transit',
        authority: PUBLISHER,
        website: routeUrl ?? WEBSITE,
        route_id: routeId,
        route_short_name: shortName ?? undefined,
        route_long_name: longName,
        route_type: routeType ?? undefined,
        route_url: routeUrl ?? undefined,
        shape_id: shapeId ?? undefined,
        color: color ?? undefined,
        text_color: textColor ?? undefined,
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
