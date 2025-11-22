import fs from 'fs/promises';
import path from 'path';
import AdmZip from 'adm-zip';
import shapefile from 'shapefile';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import { ensureDirectory, createTempDir, downloadToFile } from '../utils/files';
import type { AuthorityIngestor, IngestOptions, IngestResult } from '../types';

const ZIP_URL = 'https://s3.us-east-1.amazonaws.com/download.massgis.digital.mass.gov/shapefiles/state/state_fire_districts.zip';
const WEBSITE = 'https://www.mass.gov/info-details/massgis-data-department-of-fire-services-state-fire-districts';

export class MassachusettsFireIngestor implements AuthorityIngestor {
  readonly id = 'massachusetts-fire-districts';
  readonly state = 'MA';
  readonly dataset = 'fire';
  readonly categories = ['fire'];

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const outputPath = options.outputPath ?? path.resolve('data', 'special-districts', 'ma', 'fire.geojson');
    const workdir = await createTempDir('ma-fire-');
    const zipPath = path.join(workdir, 'state_fire_districts.zip');

    await downloadToFile(ZIP_URL, zipPath);

    const zip = new AdmZip(zipPath);
    zip.extractAllTo(workdir, true);

    const shapefilePath = path.join(workdir, 'DFS_SFD_POLY.shp');
    const features = await this.readFeatures(shapefilePath);

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
        source: WEBSITE
      }
    };
  }

  private async readFeatures(shapefilePath: string): Promise<Feature<Polygon | MultiPolygon>[]> {
    const source = await shapefile.open(shapefilePath);
    const features: Feature<Polygon | MultiPolygon>[] = [];
    const fetchedAt = new Date().toISOString().slice(0, 10);

    while (true) {
      const { done, value } = await source.read();
      if (done) {
        break;
      }

      if (!value || !value.geometry) {
        continue;
      }

      const props = value.properties ?? {};
      const fireId = props.STATE_FIRE ?? props.OBJECTID ?? features.length + 1;
      const departmentCount = Number(props.COUNT_SF ?? 0);
      const firstDept = (props.FIRST_DEPT ?? '').trim();
      const lastDept = (props.LAST_DEPT ?? '').trim();

      const notes: string[] = ['MassGIS DFS statewide districts'];
      if (departmentCount) {
        notes.push(`${departmentCount} departments`);
      }
      if (firstDept && lastDept) {
        notes.push(`range: ${firstDept} → ${lastDept}`);
      }

      const feature: Feature<Polygon | MultiPolygon> = {
        type: 'Feature',
        geometry: value.geometry as Polygon | MultiPolygon,
        properties: {
          district_id: `MA-FIRE-${fireId}`,
          district_name: `Massachusetts Fire District ${fireId}`,
          district_type: 'fire',
          authority: 'Massachusetts Department of Fire Services',
          last_updated: fetchedAt,
          website: WEBSITE,
          notes: notes.join(' • '),
          registrySource: 'MassGIS State Fire Districts',
          registryPublisher: 'MassGIS / Department of Fire Services',
          registryScore: 97,
          registryCategories: ['fire']
        }
      };

      features.push(feature);
    }

    return features;
  }
}
