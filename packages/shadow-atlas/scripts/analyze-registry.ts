#!/usr/bin/env npx tsx
import { KNOWN_PORTALS } from '../src/core/registry/known-portals.js';

const portals = Object.values(KNOWN_PORTALS);
const cities = portals.filter(p => /^\d{7}$/.test(p.cityFips));
const counties = portals.filter(p => /^\d{5}$/.test(p.cityFips));
const other = portals.filter(p => !/^\d{5}$/.test(p.cityFips) && !/^\d{7}$/.test(p.cityFips));

console.log('=== Registry Analysis ===\n');
console.log('Total entries:', portals.length);
console.log('City entries (7-digit FIPS):', cities.length);
console.log('County entries (5-digit FIPS):', counties.length);
console.log('Other (invalid FIPS):', other.length);

if (other.length > 0) {
  console.log('\nInvalid FIPS examples:', other.slice(0, 5).map(o => `${o.cityFips}: ${o.cityName}`));
}

console.log('\n=== City Sample ===');
console.log('First 5 cities:', cities.slice(0, 5).map(c => `${c.cityFips}: ${c.cityName}, ${c.state}`));

console.log('\n=== County Sample ===');
console.log('First 5 counties:', counties.slice(0, 5).map(c => `${c.cityFips}: ${c.cityName}, ${c.state}`));
