import fs from 'fs';
import path from 'path';

interface SpecialDistrictSource {
  name: string;
  publisher?: string;
  coverage: 'statewide' | 'county';
  datasetType: 'geojson_local';
  path: string;
  status: string;
  score: number;
  lastUpdated: string;
  categories?: string[];
}

interface RegistryStateEntry {
  state: string;
  sources: SpecialDistrictSource[];
}

const registryPath = path.join('data', 'special-districts', 'registry.json');
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8')) as { states: RegistryStateEntry[] };

const FIRE_TEMPLATE = {
  name: 'NIFC Jurisdictional Units (Fire/Emergency)',
  publisher: 'National Interagency Fire Center (Jurisdictional Unit Program)',
  coverage: 'statewide' as const,
  datasetType: 'geojson_local' as const,
  status: 'live',
  score: 88,
  lastUpdated: '2025-07-01',
  categories: ['fire']
};

let updated = 0;
for (const entry of registry.states) {
  const normalized = entry.state.toLowerCase();
  const firePath = path.join('data', 'special-districts', normalized, 'fire.geojson');
  const hasFire = entry.sources.some(source => source.categories?.includes('fire'));

  if (hasFire) {
    continue;
  }

  if (!fs.existsSync(path.resolve(firePath))) {
    console.warn(`[add-fire-source] Missing fire dataset for ${entry.state}: ${firePath}`);
    continue;
  }

  entry.sources.push({
    ...FIRE_TEMPLATE,
    path: firePath
  });
  updated += 1;
}

fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
console.log(`[add-fire-source] Added fire sources for ${updated} states`);
