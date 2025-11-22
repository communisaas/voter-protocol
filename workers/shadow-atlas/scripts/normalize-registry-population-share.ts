import fs from 'fs';

const REGISTRY_PATH = 'data/special-districts/registry.json';
const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8')) as { states: Array<{ populationShare?: number }> };

const total = registry.states.reduce((sum, state) => sum + (state.populationShare ?? 0), 0);
if (total === 0) {
  throw new Error('Population share total is zero');
}

const factor = 1 / total;
let cumulative = 0;
for (let i = 0; i < registry.states.length; i++) {
  const state = registry.states[i];
  if (typeof state.populationShare !== 'number') {
    continue;
  }

  if (i === registry.states.length - 1) {
    state.populationShare = Number((1 - cumulative).toFixed(3));
  } else {
    const scaled = state.populationShare * factor;
    const rounded = Number(scaled.toFixed(3));
    state.populationShare = rounded;
    cumulative += rounded;
  }
}

fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
console.log(`[normalize-registry-population-share] Normalized population shares (factor=${factor.toFixed(6)})`);
