import crypto from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import { ensureDirectory } from '../utils/files';
import { fetchArcGISFeatures } from '../utils/arcgis';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const FEATURE_SERVICE_URL =
  'https://gis1.idl.idaho.gov/arcgis/rest/services/Portal/IDLFireLayers/FeatureServer/3';
const WEBSITE = 'https://data.idl.idaho.gov/datasets/fdc46192f1df4730a50f884fa4928199/about';
const SOURCE_NAME = 'Idaho Department of Lands – Fire Protective Districts';
const PUBLISHER = 'Idaho Department of Lands';
const PAGE_SIZE = 2000;

export class IdahoFireIngestor implements AuthorityIngestor {
  readonly id = 'idaho-dof-fire-protective-districts';
  readonly state = 'ID';
  readonly dataset = 'fire';
  readonly categories = ['fire'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'id', 'fire.geojson');
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
    const responseName =
      this.cleanValue(props.Fire_Protection_Response) ??
      this.cleanValue(props.Lable) ??
      this.cleanValue(props.MAX_AGENCY) ??
      this.cleanValue(props.Agency) ??
      `Idaho Fire District ${objectId}`;
    const agency = this.cleanValue(props.Agency) ?? 'Fire Protection Agency';
    const acres = typeof props.SUM_GIS_ACRES_ === 'number' ? props.SUM_GIS_ACRES_ : null;
    const lastEdited = this.parseEpoch(props.last_edited_date) ?? this.parseEpoch(props.created_date);

    const notes: string[] = [SOURCE_NAME];
    notes.push(`Agency ${agency}`);
    notes.push(`Response ${responseName}`);
    if (acres && acres > 0) {
      notes.push(`${acres.toLocaleString('en-US', { maximumFractionDigits: 0 })} acres`);
    }

    return {
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        district_id: `ID-FIRE-${objectId}`,
        district_name: `${responseName} Fire Protective District`,
        district_type: 'fire',
        authority: 'Idaho Department of Lands',
        last_updated: lastEdited ?? new Date().toISOString().slice(0, 10),
        website: WEBSITE,
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
