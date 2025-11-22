import fs from 'fs/promises';
import path from 'path';
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';

import { ensureDirectory } from '../utils/files';
import { fetchArcGISFeatures } from '../utils/arcgis';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const FEATURE_SERVICE_URL =
  'https://services1.arcgis.com/FCaUeJ5SOVtImake/arcgis/rest/services/CT_Municipalities/FeatureServer/0';
const SOURCE_NAME = 'CTDOT Municipalities (TransitDistrict dissolve)';
const PUBLISHER = 'Connecticut Department of Transportation';
const WEBSITE = 'https://portal.ct.gov/dot';
const PAGE_SIZE = 2000;

interface TransitGroup {
  coordinates: MultiPolygon['coordinates'];
  municipalities: Set<string>;
}

export class ConnecticutTransitIngestor implements AuthorityIngestor {
  readonly id = 'connecticut-transit-districts';
  readonly state = 'CT';
  readonly dataset = 'transit';
  readonly categories = ['transit'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'ct', 'transit.geojson');
    const rawFeatures = await fetchArcGISFeatures<Polygon | MultiPolygon>(FEATURE_SERVICE_URL, {
      pageSize: PAGE_SIZE,
      outFields: 'Municipality,TransitDistrict'
    });

    const grouped = this.groupByTransitDistrict(rawFeatures);
    const normalized = Array.from(grouped.entries()).map(([districtName, group]) =>
      this.createDistrictFeature(districtName, group)
    );

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

  private groupByTransitDistrict(features: Array<Feature<Polygon | MultiPolygon>>): Map<string, TransitGroup> {
    const groups = new Map<string, TransitGroup>();

    for (const feature of features) {
      if (!feature.geometry) {
        continue;
      }

      const props = feature.properties ?? {};
      const municipality = this.cleanValue(props.Municipality);
      const districtName = this.cleanValue(props.TransitDistrict) ?? 'Unassigned Transit District';

      let existing = groups.get(districtName);
      if (!existing) {
        existing = {
          coordinates: [],
          municipalities: new Set<string>()
        };
        groups.set(districtName, existing);
      }

      this.appendGeometry(existing.coordinates, feature.geometry);
      if (municipality) {
        existing.municipalities.add(municipality);
      }
    }

    return groups;
  }

  private appendGeometry(target: MultiPolygon['coordinates'], geometry: Polygon | MultiPolygon): void {
    if (geometry.type === 'Polygon') {
      target.push(geometry.coordinates as Position[][][]);
      return;
    }

    if (geometry.type === 'MultiPolygon') {
      for (const coords of geometry.coordinates) {
        target.push(coords);
      }
    }
  }

  private createDistrictFeature(districtName: string, group: TransitGroup): Feature<MultiPolygon> {
    const slug = districtName
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    const municipalities = Array.from(group.municipalities.values()).sort((a, b) => a.localeCompare(b));
    const label = districtName === 'Unassigned Transit District' ? districtName : `${districtName} Transit District`;
    const notes = [`${SOURCE_NAME}`, `${municipalities.length} municipalities`];

    return {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: group.coordinates
      },
      properties: {
        district_id: `CT-TRANSIT-${slug || 'UNASSIGNED'}`,
        district_name: label,
        district_type: 'transit',
        authority: PUBLISHER,
        website: WEBSITE,
        served_municipalities: municipalities,
        last_updated: new Date().toISOString().slice(0, 10),
        notes: notes.join(' • '),
        registrySource: SOURCE_NAME,
        registryPublisher: PUBLISHER,
        registryScore: 93,
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

