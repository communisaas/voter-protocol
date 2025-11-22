import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { feature as topojsonFeature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import * as turf from '@turf/turf';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import statesTopology from 'us-atlas/states-10m.json' with { type: 'json' };

import { runWithConcurrency } from './lib/async-queue';

interface StateEntry {
  code: string;
  name: string;
}

interface JurisdictionalProperties {
  JurisdictionalUnitID?: string;
  JurisdictionalUnitName?: string;
  LegendJurisdictionalCategory?: string;
  DataSourceYear?: number;
  DataSource?: string;
  LocalName?: string;
}

type JurisdictionalFeature = Feature<Polygon | MultiPolygon, JurisdictionalProperties>;
type SpecialDistrictFeature = Feature<Polygon | MultiPolygon>;

interface CliOptions {
  readonly states?: Set<string>;
  readonly concurrency: number;
  readonly pageConcurrency: number;
  readonly force: boolean;
}

const SERVICE_URL = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/ArcGIS/rest/services/DMP_JurisdictionalUnits_Public/FeatureServer/0/query';
const FIRE_PUBLISHER = 'National Interagency Fire Center (Jurisdictional Unit Program)';
const LAST_UPDATED = '2025-07-01';
const DATA_NOTES = 'Jurisdictional Units Public layer (serviceItemId: 4107b5d1debf4305ba00e929b7e5971a)';
const DEFAULT_CONCURRENCY = Number(process.env.FIRE_CONCURRENCY ?? '6');
const DEFAULT_PAGE_CONCURRENCY = Number(process.env.FIRE_PAGE_CONCURRENCY ?? '4');
const PAGE_SIZE = 2000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data', 'special-districts');
const STATES_PATH = path.join(PROJECT_ROOT, 'data', 'states.json');

const FIPS_TO_CODE: Record<string, string> = {
  '01': 'AL','02': 'AK','04': 'AZ','05': 'AR','06': 'CA','08': 'CO','09': 'CT','10': 'DE','11': 'DC','12': 'FL','13': 'GA','15': 'HI','16': 'ID','17': 'IL','18': 'IN','19': 'IA','20': 'KS','21': 'KY','22': 'LA','23': 'ME','24': 'MD','25': 'MA','26': 'MI','27': 'MN','28': 'MS','29': 'MO','30': 'MT','31': 'NE','32': 'NV','33': 'NH','34': 'NJ','35': 'NM','36': 'NY','37': 'NC','38': 'ND','39': 'OH','40': 'OK','41': 'OR','42': 'PA','44': 'RI','45': 'SC','46': 'SD','47': 'TN','48': 'TX','49': 'UT','50': 'VT','51': 'VA','53': 'WA','54': 'WV','55': 'WI','56': 'WY'
};

function parseCliOptions(): CliOptions {
  const args = process.argv.slice(2);
  let statesSet: Set<string> | undefined;
  let concurrency = DEFAULT_CONCURRENCY;
  let pageConcurrency = DEFAULT_PAGE_CONCURRENCY;
  let force = process.env.FIRE_REBUILD_ALL === 'true';

  for (const arg of args) {
    if (arg.startsWith('--states=')) {
      const raw = arg.split('=')[1];
      if (raw) {
        statesSet = new Set(raw.split(',').map(code => code.trim().toUpperCase()).filter(Boolean));
      }
    } else if (arg.startsWith('--concurrency=')) {
      concurrency = Number(arg.split('=')[1] ?? concurrency);
    } else if (arg.startsWith('--page-concurrency=')) {
      pageConcurrency = Number(arg.split('=')[1] ?? pageConcurrency);
    } else if (arg === '--force') {
      force = true;
    }
  }

  return {
    states: statesSet,
    concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : DEFAULT_CONCURRENCY,
    pageConcurrency: Number.isFinite(pageConcurrency) && pageConcurrency > 0 ? pageConcurrency : DEFAULT_PAGE_CONCURRENCY,
    force
  };
}

async function queryFeatureServer(params: URLSearchParams): Promise<FeatureCollection> {
  const response = await fetch(`${SERVICE_URL}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Jurisdictional Units query failed with status ${response.status}`);
  }

  const data = (await response.json()) as FeatureCollection;
  if (!Array.isArray(data.features)) {
    throw new Error('Jurisdictional Units response missing feature array');
  }

  return data;
}

function loadStateBoundaries(): Map<string, Feature<Polygon | MultiPolygon>> {
  const topo = statesTopology as Topology;
  const collection = topojsonFeature(topo, topo.objects.states) as FeatureCollection<MultiPolygon>;
  const map = new Map<string, Feature<Polygon | MultiPolygon>>();

  for (const feature of collection.features) {
    const idRaw = typeof feature.id === 'string' ? feature.id : String(feature.id ?? '');
    const code = FIPS_TO_CODE[idRaw.padStart(2, '0')];
    if (!code) {
      continue;
    }
    map.set(code.toUpperCase(), feature as Feature<Polygon | MultiPolygon>);
  }

  return map;
}

function normalizeDistrictId(stateCode: string, value?: string): string {
  const fallback = value ?? `UNIT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  return `${stateCode}-FIRE-${fallback.replace(/[^A-Za-z0-9]+/g, '-')}`;
}

function transformFeature(feature: JurisdictionalFeature, stateCode: string): SpecialDistrictFeature {
  const cloned = structuredClone(feature) as SpecialDistrictFeature;
  const props = (cloned.properties ??= {});

  (props as any).district_id = normalizeDistrictId(stateCode, feature.properties?.JurisdictionalUnitID);
  (props as any).district_name = feature.properties?.JurisdictionalUnitName ?? feature.properties?.LocalName ?? 'Jurisdictional Fire Unit';
  (props as any).district_type = 'fire';
  (props as any).authority = FIRE_PUBLISHER;
  (props as any).last_updated = LAST_UPDATED;
  (props as any).notes = `${DATA_NOTES} • Category: ${feature.properties?.LegendJurisdictionalCategory ?? 'Unknown'}`;
  (props as any).registrySource = 'NIFC Jurisdictional Units (Fire/Emergency)';
  (props as any).registryPublisher = FIRE_PUBLISHER;
  (props as any).registryScore = 88;
  (props as any).registryNotes = DATA_NOTES;
  (props as any).registryCategories = ['fire'];

  return cloned;
}

function buildEnvelope(polygon: Feature<Polygon | MultiPolygon>) {
  const [xmin, ymin, xmax, ymax] = turf.bbox(polygon);
  return {
    xmin,
    ymin,
    xmax,
    ymax,
    spatialReference: { wkid: 4326 }
  };
}

async function fetchStatePage(envelope: ReturnType<typeof buildEnvelope>, offset: number): Promise<JurisdictionalFeature[]> {
  const params = new URLSearchParams({
    where: "LegendJurisdictionalCategory IS NOT NULL",
    outFields: 'JurisdictionalUnitID,JurisdictionalUnitName,LegendJurisdictionalCategory,DataSourceYear,DataSource,LocalName',
    returnGeometry: 'true',
    f: 'geojson',
    outSR: '4326',
    geometry: JSON.stringify(envelope),
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    resultOffset: offset.toString(),
    resultRecordCount: PAGE_SIZE.toString()
  });

  const page = await queryFeatureServer(params);
  return (page.features as JurisdictionalFeature[]).filter(feature => !!feature.geometry);
}

async function fetchFeaturesForState(
  polygon: Feature<Polygon | MultiPolygon>,
  pageConcurrency: number
): Promise<JurisdictionalFeature[]> {
  const envelope = buildEnvelope(polygon);
  const features: JurisdictionalFeature[] = [];
  let offset = 0;

  while (true) {
    const offsets = Array.from({ length: pageConcurrency }, (_, idx) => offset + idx * PAGE_SIZE);
    const pages = await Promise.all(offsets.map(pageOffset => fetchStatePage(envelope, pageOffset)));

    let shouldContinue = false;
    for (const page of pages) {
      features.push(...page);
      if (page.length === PAGE_SIZE) {
        shouldContinue = true;
      }
    }

    if (!shouldContinue) {
      break;
    }

    offset += PAGE_SIZE * pageConcurrency;
  }

  return features;
}

async function fetchFeaturesForStateWithRetry(
  polygon: Feature<Polygon | MultiPolygon>,
  stateCode: string,
  pageConcurrency: number
): Promise<JurisdictionalFeature[]> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetchFeaturesForState(polygon, pageConcurrency);
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      const delay = attempt * 750;
      console.warn(
        `[import-fire-districts] ${stateCode} fetch attempt ${attempt} failed (${(error as Error).message}). Retrying in ${delay}ms`
      );
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  return [];
}

async function processState(
  state: StateEntry,
  polygon: Feature<Polygon | MultiPolygon> | undefined,
  options: CliOptions
): Promise<void> {
  if (!polygon) {
    console.warn(`[import-fire-districts] Missing boundary geometry for ${state.code}`);
    return;
  }

  const stateDir = path.join(DATA_DIR, state.code.toLowerCase());
  const filePath = path.join(stateDir, 'fire.geojson');

  if (!options.force && fs.existsSync(filePath)) {
    console.log(`[import-fire-districts] ${state.code}: already generated, skipping`);
    return;
  }

  const rawFeatures = await fetchFeaturesForStateWithRetry(polygon, state.code, options.pageConcurrency);
  const stateFeatures: SpecialDistrictFeature[] = [];

  for (const feature of rawFeatures) {
    const intersects = turf.booleanIntersects(
      feature as unknown as turf.helpers.Feature,
      polygon as unknown as turf.helpers.Feature
    );
    if (intersects) {
      stateFeatures.push(transformFeature(feature, state.code));
    }
  }

  if (stateFeatures.length === 0) {
    console.warn(`[import-fire-districts] No fire features intersect ${state.code}`);
    return;
  }

  fs.mkdirSync(stateDir, { recursive: true });
  const collection: FeatureCollection = {
    type: 'FeatureCollection',
    features: stateFeatures
  };

  fs.writeFileSync(filePath, JSON.stringify(collection, null, 2));
  console.log(`[import-fire-districts] ${state.code}: wrote ${stateFeatures.length} features`);
}

async function main() {
  const options = parseCliOptions();
  const stateEntries = JSON.parse(fs.readFileSync(STATES_PATH, 'utf8')) as StateEntry[];
  const stateBoundaries = loadStateBoundaries();
  const targets = stateEntries.filter(entry => !options.states || options.states.has(entry.code));

  console.log(
    `[import-fire-districts] Starting run for ${targets.length} states ` +
    `(state concurrency=${options.concurrency}, page concurrency=${options.pageConcurrency})`
  );

  await runWithConcurrency(targets, async ({ value: state }) => {
    try {
      await processState(state, stateBoundaries.get(state.code), options);
    } catch (error) {
      console.error(`[import-fire-districts] ${state.code} failed:`, error);
    }
  }, { concurrency: options.concurrency });

  console.log('[import-fire-districts] Completed run');
}

main().catch(error => {
  console.error('[import-fire-districts] Failed:', error);
  process.exit(1);
});
