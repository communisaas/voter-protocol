import fs from 'fs';
import path from 'path';

interface AuthorityOverride {
  publisher: string;
  notes: string;
  website: string;
  score?: number;
}

const registryPath = path.join('data', 'special-districts', 'registry.json');
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8')) as {
  states: Array<{
    state: string;
    notes?: string;
    sources: Array<{ publisher?: string; path?: string; score?: number; website?: string }>;
  }>;
};

const overrides: Record<string, AuthorityOverride> = {
  'MA': {
    publisher: 'Massachusetts Department of Transportation (MassDOT)',
    notes: 'MassDOT publishes MBTA and regional water/sewer districts via MassGIS.',
    website: 'https://www.mass.gov/orgs/massachusetts-department-of-transportation',
    score: 95
  },
  'MN': {
    publisher: 'Minnesota Metropolitan Council',
    notes: 'Met Council maintains regional transit and wastewater service district boundaries.',
    website: 'https://metrocouncil.org/',
    score: 95
  },
  'VA': {
    publisher: 'Virginia Department of Rail and Public Transportation (DRPT)',
    notes: 'DRPT curates statewide transit service districts and regional water authorities.',
    website: 'https://www.drpt.virginia.gov/',
    score: 94
  }
};

for (const entry of registry.states) {
  const override = overrides[entry.state];
  if (!override) {
    continue;
  }

  entry.notes = override.notes;
  const source = entry.sources[0];
  if (source) {
    source.publisher = override.publisher;
    source.score = override.score ?? source.score;
    source.website = override.website;
  }
}

fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
console.log('[replace-authority-metadata] Applied overrides for states:', Object.keys(overrides).join(', '));
