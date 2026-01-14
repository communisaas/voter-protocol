#!/usr/bin/env npx tsx
/**
 * Census Place List Loader
 *
 * Loads US Census Bureau's 2020 Decennial Census place population data
 * and filters to top 1,000 cities by population for GIS server discovery.
 *
 * Data source: Pre-compiled Census data (already available at ../data/us-cities-top-1000.json)
 *
 * Output: CensusPlace[] with normalized city slugs for URL generation
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../core/utils/logger.js';

interface CensusPlaceRaw {
  readonly fips: string;
  readonly name: string;
  readonly state: string;
  readonly population: number;
  readonly rank: number;
}

interface CensusPlace extends CensusPlaceRaw {
  readonly city_slug: string;
  readonly state_abbr: string;
}

/**
 * State name to abbreviation mapping (all 50 states + DC)
 */
const STATE_ABBREVIATIONS: Record<string, string> = {
  'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
  'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
  'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
  'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
  'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
  'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
  'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK',
  'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT',
  'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV',
  'Wisconsin': 'WI', 'Wyoming': 'WY', 'District of Columbia': 'DC',

  // Also accept existing abbreviations
  'AL': 'AL', 'AK': 'AK', 'AZ': 'AZ', 'AR': 'AR', 'CA': 'CA', 'CO': 'CO',
  'CT': 'CT', 'DE': 'DE', 'FL': 'FL', 'GA': 'GA', 'HI': 'HI', 'ID': 'ID',
  'IL': 'IL', 'IN': 'IN', 'IA': 'IA', 'KS': 'KS', 'KY': 'KY', 'LA': 'LA',
  'ME': 'ME', 'MD': 'MD', 'MA': 'MA', 'MI': 'MI', 'MN': 'MN', 'MS': 'MS',
  'MO': 'MO', 'MT': 'MT', 'NE': 'NE', 'NV': 'NV', 'NH': 'NH', 'NJ': 'NJ',
  'NM': 'NM', 'NY': 'NY', 'NC': 'NC', 'ND': 'ND', 'OH': 'OH', 'OK': 'OK',
  'OR': 'OR', 'PA': 'PA', 'RI': 'RI', 'SC': 'SC', 'SD': 'SD', 'TN': 'TN',
  'TX': 'TX', 'UT': 'UT', 'VT': 'VT', 'VA': 'VA', 'WA': 'WA', 'WV': 'WV',
  'WI': 'WI', 'WY': 'WY', 'DC': 'DC',
};

/**
 * Normalize city name to URL-safe slug
 *
 * Examples:
 *   "San Francisco" → "san-francisco"
 *   "St. Paul" → "st-paul"
 *   "Winston-Salem" → "winston-salem"
 */
function normalizeCitySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')           // spaces to hyphens
    .replace(/[^a-z0-9-]/g, '')     // remove special chars (periods, apostrophes, etc.)
    .replace(/-+/g, '-')            // collapse multiple hyphens
    .replace(/^-|-$/g, '');         // trim leading/trailing hyphens
}

/**
 * Get state abbreviation from full name or existing abbreviation
 */
function getStateAbbreviation(state: string): string {
  const abbr = STATE_ABBREVIATIONS[state];
  if (!abbr) {
    logger.warn(`⚠️  Unknown state: ${state} (falling back to original)`);
    return state.toLowerCase();
  }
  return abbr.toLowerCase();
}

/**
 * Load Census places and enrich with URL generation metadata
 */
function loadCensusPlaces(inputFile: string): CensusPlace[] {
  logger.info('='.repeat(70));
  logger.info('CENSUS PLACE LOADER');
  logger.info('='.repeat(70));
  logger.info(`Input: ${inputFile}`);
  logger.info('');

  const content = readFileSync(inputFile, 'utf-8');
  const rawPlaces = JSON.parse(content) as CensusPlaceRaw[];

  logger.info(`Loaded ${rawPlaces.length} cities from Census data`);
  logger.info('');

  // Enrich with URL generation metadata
  const enrichedPlaces: CensusPlace[] = rawPlaces.map(place => ({
    ...place,
    city_slug: normalizeCitySlug(place.name),
    state_abbr: getStateAbbreviation(place.state),
  }));

  // Statistics
  const totalPopulation = enrichedPlaces.reduce((sum, p) => sum + p.population, 0);
  const avgPopulation = Math.floor(totalPopulation / enrichedPlaces.length);
  const minPopulation = Math.min(...enrichedPlaces.map(p => p.population));
  const maxPopulation = Math.max(...enrichedPlaces.map(p => p.population));

  logger.info('Census Place Statistics:');
  logger.info(`  Total cities: ${enrichedPlaces.length}`);
  logger.info(`  Total population: ${totalPopulation.toLocaleString()}`);
  logger.info(`  Average population: ${avgPopulation.toLocaleString()}`);
  logger.info(`  Min population: ${minPopulation.toLocaleString()} (${enrichedPlaces.find(p => p.population === minPopulation)?.name})`);
  logger.info(`  Max population: ${maxPopulation.toLocaleString()} (${enrichedPlaces.find(p => p.population === maxPopulation)?.name})`);
  logger.info('');

  // Sample entries
  logger.info('Sample cities (top 5):');
  for (const place of enrichedPlaces.slice(0, 5)) {
    logger.info(`  ${place.rank}. ${place.name}, ${place.state} (pop: ${place.population.toLocaleString()})`);
    logger.info(`     Slug: ${place.city_slug} | State abbr: ${place.state_abbr}`);
  }
  logger.info('');

  return enrichedPlaces;
}

// Run
const inputFile = join(__dirname, '../data/us-cities-top-1000.json');
const outputFile = join(__dirname, 'data/census_top1000_cities_enriched.json');

const places = loadCensusPlaces(inputFile);

writeFileSync(outputFile, JSON.stringify(places, null, 2));

logger.info('✓ Census places enriched and saved');
logger.info(`Output: ${outputFile}`);
logger.info('='.repeat(70));

export type { CensusPlace };
export { loadCensusPlaces, normalizeCitySlug, getStateAbbreviation };
