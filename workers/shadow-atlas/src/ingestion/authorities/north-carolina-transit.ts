import fs from 'fs/promises';
import path from 'path';
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';

import { ensureDirectory } from '../utils/files';
import { fetchArcGISFeatures } from '../utils/arcgis';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const FEATURE_SERVICE_URL =
  'https://services.arcgis.com/NuWFvHYDMVmmxMeM/arcgis/rest/services/NCDOT_ProposedLCPRegions_2023_Numbered/FeatureServer/0';
const SOURCE_NAME = 'NCDOT 2025-2029 Statewide LCP Districts';
const PUBLISHER = 'North Carolina Department of Transportation (Public Transportation Division)';
const WEBSITE = 'https://www.ncdot.gov/divisions/public-transit/Pages/default.aspx';
const PAGE_SIZE = 2000;

interface TransitGroup {
  coordinates: MultiPolygon['coordinates'];
  counties: Set<string>;
  number?: number;
}

export class NorthCarolinaTransitIngestor implements AuthorityIngestor {
  readonly id = 'north-carolina-lcp-transit-districts';
  readonly state = 'NC';
  readonly dataset = 'transit';
  readonly categories = ['transit'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'nc', 'transit.geojson');
    const rawFeatures = await fetchArcGISFeatures<Polygon | MultiPolygon>(FEATURE_SERVICE_URL, {
      pageSize: PAGE_SIZE,
      outFields: 'NAME,LCP_2023,LCP_Num'
    });

    const grouped = this.groupByDistrict(rawFeatures);
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

  private groupByDistrict(features: Array<Feature<Polygon | MultiPolygon>>): Map<string, TransitGroup> {
    const groups = new Map<string, TransitGroup>();

    for (const feature of features) {
      if (!feature.geometry) {
        continue;
      }

      const props = feature.properties ?? {};
      const districtName = this.cleanValue(props.LCP_2023) ?? 'Unassigned Transit District';
      const countyName = this.cleanValue(props.NAME);
      const districtNumber = typeof props.LCP_Num === 'number' ? props.LCP_Num : undefined;

      let bucket = groups.get(districtName);
      if (!bucket) {
        bucket = {
          coordinates: [],
          counties: new Set<string>(),
          number: districtNumber
        };
        groups.set(districtName, bucket);
      }

      this.appendGeometry(bucket.coordinates, feature.geometry);
      if (countyName) {
        bucket.counties.add(countyName);
      }
      if (districtNumber && !bucket.number) {
        bucket.number = districtNumber;
      }
    }

    return groups;
  }

  private appendGeometry(target: MultiPolygon['coordinates'], geometry: Polygon | MultiPolygon): void {
    if (geometry.type === 'Polygon') {
      target.push(geometry.coordinates as Position[][][]);
      return;
    }

    for (const coords of geometry.coordinates) {
      target.push(coords);
    }
  }

  private createDistrictFeature(districtName: string, group: TransitGroup): Feature<MultiPolygon> {
    const slug = districtName
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    const counties = Array.from(group.counties.values()).sort((a, b) => a.localeCompare(b));
    const label = districtName === 'Unassigned Transit District' ? districtName : `${districtName} Transit District`;
    const notes = [`${SOURCE_NAME}`, `${counties.length} counties`];

    return {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: group.coordinates
      },
      properties: {
        district_id: `NC-TRANSIT-${slug || 'UNASSIGNED'}`,
        district_name: label,
        district_type: 'transit',
        authority: PUBLISHER,
        website: WEBSITE,
        transit_district_number: group.number ?? undefined,
        counties,
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
