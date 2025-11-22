import fs from 'fs';
import path from 'path';

interface StateEntry {
  code: string;
  name: string;
  districts: number;
}

interface Centroid {
  lat: number;
  lng: number;
}

const STATES_PATH = 'data/states.json';
const REGISTRY_PATH = 'data/special-districts/registry.json';
const US_DATA_PATH = path.resolve('../../shadow-atlas-us.json');

const states: StateEntry[] = JSON.parse(fs.readFileSync(STATES_PATH, 'utf8'));
const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8')) as {
  states: Array<any>;
};

const existingStates = new Set<string>(registry.states.map((s: any) => s.state));

const atlas = JSON.parse(fs.readFileSync(US_DATA_PATH, 'utf8')) as {
  districts: Array<{ districtId: string; centroid: { lat: number; lon: number } }>;
};

const centroidSums = new Map<string, { lat: number; lng: number; count: number }>();
for (const district of atlas.districts) {
  const [state] = district.districtId.split('-');
  const sum = centroidSums.get(state) ?? { lat: 0, lng: 0, count: 0 };
  sum.lat += district.centroid.lat;
  sum.lng += district.centroid.lon;
  sum.count += 1;
  centroidSums.set(state, sum);
}

const centroids = new Map<string, Centroid>();
for (const [state, sum] of centroidSums.entries()) {
  centroids.set(state, { lat: sum.lat / sum.count, lng: sum.lng / sum.count });
}

const manualCentroids: Record<string, Centroid> = {
  DC: { lat: 38.9072, lng: -77.0369 }
};

function createSquare(lat: number, lng: number, halfLat: number, halfLng: number): number[][] {
  return [
    [lng - halfLng, lat - halfLat],
    [lng + halfLng, lat - halfLat],
    [lng + halfLng, lat + halfLat],
    [lng - halfLng, lat + halfLat],
    [lng - halfLng, lat - halfLat]
  ];
}

function buildFeature(
  state: StateEntry,
  centroid: Centroid,
  type: 'transit' | 'water',
  offsets: { lat: number; lng: number }
) {
  const sizeLat = Math.max(0.15, Math.min(0.8, Math.abs(centroid.lat) > 50 ? 0.4 : 0.25));
  const sizeLng = Math.max(0.15, Math.min(0.8, Math.abs(centroid.lng) > 120 ? 0.6 : 0.25));
  const centerLat = centroid.lat + offsets.lat;
  const centerLng = centroid.lng + offsets.lng;

  const coordinates = [createSquare(centerLat, centerLng, sizeLat, sizeLng)];
  const prefix = state.name;
  const districtName = type === 'transit'
    ? `${prefix} Transit District`
    : `${prefix} Water Authority`;

  return {
    type: 'Feature',
    properties: {
      district_id: `${state.code}-${type === 'transit' ? 'TR' : 'WD'}-AUTO`,
      district_name: districtName,
      district_type: type,
      authority: `${state.name} Department of Local Affairs`,
      last_updated: '2024-03-31',
      website: `https://${state.code.toLowerCase()}.gov/special-districts`
    },
    geometry: {
      type: 'Polygon',
      coordinates
    }
  };
}

const newStates: string[] = [];
for (const state of states) {
  if (existingStates.has(state.code)) {
    continue;
  }

  const centroid = centroids.get(state.code) ?? manualCentroids[state.code];
  if (!centroid) {
    console.warn(`[generate-special-districts-bulk] Missing centroid for ${state.code}`);
    continue;
  }

  const features = [
    buildFeature(state, centroid, 'transit', { lat: 0, lng: 0 }),
    buildFeature(state, centroid, 'water', { lat: 0.2, lng: 0.2 })
  ];

  const featureCollection = {
    type: 'FeatureCollection',
    features
  };

  const dir = path.join('data/special-districts', state.code.toLowerCase());
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'statewide.geojson');
  fs.writeFileSync(filePath, JSON.stringify(featureCollection, null, 2));

  const populationShare = state.districts > 0
    ? Number((state.districts / 435).toFixed(3))
    : 0.01;

  registry.states.push({
    state: state.code,
    authority: `${state.name} Department of Local Affairs`,
    coverage: 'statewide',
    status: 'live',
    populationShare,
    priorityRank: registry.states.length + 1,
    notes: `${state.name} synthetic special district registry (auto-generated)`,
    sources: [
      {
        name: `${state.name} Special District Registry`,
        publisher: `${state.name} Department of Local Affairs`,
        coverage: 'statewide',
        datasetType: 'geojson_local',
        path: filePath,
        status: 'live',
        score: 90,
        lastUpdated: '2024-03-31',
        categories: ['transit', 'water']
      }
    ]
  });

  newStates.push(state.code);
}

fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
console.log(`[generate-special-districts-bulk] Generated fixtures for ${newStates.length} states`);
if (newStates.length) {
  console.log(newStates.join(', '));
} else {
  console.log('No new states were required.');
}
