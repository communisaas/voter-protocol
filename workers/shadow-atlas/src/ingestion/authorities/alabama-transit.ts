import fs from 'fs/promises';
import path from 'path';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import { ensureDirectory } from '../utils/files';
import { fetchArcGISFeatures } from '../utils/arcgis';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const FEATURE_SERVICE_BASE =
  'https://services.arcgis.com/ts4gk3YgS68yLGFl/arcgis/rest/services/Alabama_Public_Transit/FeatureServer';
const SOURCE_NAME = 'Alabama Rural Transit Areas (ALDOT)';
const PUBLISHER = 'Alabama Department of Transportation (ALDOT)';
const WEBSITE = 'https://www.dot.state.al.us/';
const PAGE_SIZE = 2000;
const NAME_PATTERN = /(transit|transport)/i;

export class AlabamaTransitIngestor implements AuthorityIngestor {
  readonly id = 'alabama-rural-transit-districts';
  readonly state = 'AL';
  readonly dataset = 'transit';
  readonly categories = ['transit'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'al', 'transit.geojson');
    const layers = await this.getPolygonLayers();

    const features: Array<Feature<Polygon | MultiPolygon>> = [];
    for (const layer of layers) {
      const layerUrl = `${FEATURE_SERVICE_BASE}/${layer.id}`;
      const raw = await fetchArcGISFeatures<Polygon | MultiPolygon>(layerUrl, { pageSize: PAGE_SIZE });
      raw
        .filter((feature): feature is Feature<Polygon | MultiPolygon> => Boolean(feature.geometry))
        .forEach(feature => features.push(this.normalizeFeature(feature, layer.name)));
    }

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
        source: FEATURE_SERVICE_BASE
      }
    };
  }

  private async getPolygonLayers(): Promise<Array<{ id: number; name: string }>> {
    const response = await fetch(`${FEATURE_SERVICE_BASE}?f=pjson`);
    if (!response.ok) {
      throw new Error('Failed to load Alabama Public Transit service metadata');
    }

    const metadata = (await response.json()) as { layers?: Array<{ id: number; name: string; geometryType?: string }> };
    return (metadata.layers ?? []).filter(layer => layer.geometryType === 'esriGeometryPolygon' && NAME_PATTERN.test(layer.name ?? ''));
  }

  private normalizeFeature(feature: Feature<Polygon | MultiPolygon>, layerName: string): Feature<Polygon | MultiPolygon> {
    const props = feature.properties ?? {};
    const districtName = this.cleanValue(
      props.NAME ??
        props.Name ??
        props.PLACE ??
        props.RURAL_DIST ??
        props.PROVIDER ??
        props.Provider ??
        layerName
    );
    const provider = this.cleanValue(props.PROVIDER ?? props.Provider ?? layerName);
    const region = this.cleanValue(props.REGION ?? props.Region);

    const slug = districtName.replace(/[^A-Za-z0-9]+/g, '-');
    const notes: string[] = [SOURCE_NAME, layerName];
    if (provider && provider !== layerName) {
      notes.push(provider);
    }
    if (region) {
      notes.push(`Region ${region}`);
    }

    return {
      type: 'Feature',
      geometry: feature.geometry!,
      properties: {
        district_id: `AL-TRANSIT-${slug}`,
        district_name: districtName,
        district_type: 'transit',
        authority: PUBLISHER,
        website: WEBSITE,
        provider: provider ?? undefined,
        region: region ?? undefined,
        layer_name: layerName,
        last_updated: new Date().toISOString().slice(0, 10),
        notes: notes.join(' • '),
        registrySource: SOURCE_NAME,
        registryPublisher: PUBLISHER,
        registryScore: 90,
        registryCategories: ['transit']
      }
    };
  }

  private cleanValue(value: unknown): string {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }

    return '';
  }
}
