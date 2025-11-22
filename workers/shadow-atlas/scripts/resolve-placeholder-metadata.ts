import fs from 'fs';
import path from 'path';

const registryPath = path.join('data', 'special-districts', 'registry.json');
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8')) as {
  states: Array<{
    state: string;
    authority: string;
    notes?: string;
    sources: Array<{ name: string; publisher?: string; score: number; categories?: string[] }>;
  }>;
};

const placeholderStates = new Set([
  'AK','AL','AR','CT','DC','DE','HI','IA','ID','IN','KS','KY','ME','MO','MS','MT','NC','ND','NE','NH','NM','NV','OK','RI','SC','SD','UT','VT','WV','WY'
]);

const EPA_AUTHORITY = 'U.S. Environmental Protection Agency (Office of Water)';
const EPA_NOTES_PREFIX = 'Community Water System Service Area Boundaries (EPA, maintained by Office of Water) for state ';

for (const entry of registry.states) {
  if (!placeholderStates.has(entry.state)) {
    continue;
  }

  entry.authority = EPA_AUTHORITY;
  entry.notes = `${EPA_NOTES_PREFIX}${entry.state}. Dataset: https://www.epa.gov/ground-water-and-drinking-water/community-water-system-service-area-boundaries.`;
  const source = entry.sources[0];
  if (source) {
    source.name = `EPA CWS Service Areas (${entry.state})`;
    source.publisher = EPA_AUTHORITY;
    source.score = 93;
    source.categories = ['water'];
  }
}

fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
console.log('[resolve-placeholder-metadata] Updated EPA metadata for placeholder states');
