import fs from 'fs';
import path from 'path';

const registryPath = path.join('data', 'special-districts', 'registry.json');
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8')) as {
  states: Array<{
    state: string;
    sources: Array<{ name: string; categories?: string[] }>;
  }>;
};

const TRANSIT_SOURCE = {
  name: 'NTAD National Transit Map Routes',
  publisher: 'Bureau of Transportation Statistics (USDOT)',
  coverage: 'statewide',
  datasetType: 'remote_feature_server',
  url: 'https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/NTAD_National_Transit_Map_Routes/FeatureServer/0',
  status: 'live',
  score: 92,
  lastUpdated: '2025-09-02',
  categories: ['transit']
};

for (const entry of registry.states) {
  const hasTransit = entry.sources.some((source) => source.categories?.includes('transit'));
  if (!hasTransit) {
    entry.sources.push({ ...TRANSIT_SOURCE });
  }
}

fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
console.log('[add-transit-source] Transit source added where missing');
