#!/usr/bin/env npx tsx
import { KNOWN_PORTALS } from '../src/core/registry/known-portals.js';

const portals = Object.values(KNOWN_PORTALS);
console.log('Total entries in KNOWN_PORTALS:', portals.length);
console.log('First 5:', portals.slice(0, 5).map(p => `${p.cityName}, ${p.state}`));
console.log('Last 5:', portals.slice(-5).map(p => `${p.cityName}, ${p.state}`));
