#!/usr/bin/env npx tsx
/**
 * Remove County Entries from Known Portals
 *
 * This script filters county entries from KNOWN_PORTALS and regenerates the file.
 * Safer approach than regex replacement.
 */

import { KNOWN_PORTALS, type KnownPortal } from '../src/core/registry/known-portals.js';
import * as fs from 'fs/promises';
import * as path from 'path';

function isCountyEntry(portal: KnownPortal): boolean {
  const name = portal.cityName.toLowerCase();
  return (
    name.includes(' county') ||
    name.includes(' parish') ||
    name.endsWith(' county') ||
    name.endsWith(' parish')
  );
}

async function main() {
  const allPortals = Object.entries(KNOWN_PORTALS);
  const cityPortals = allPortals.filter(([_, portal]) => !isCountyEntry(portal));
  const countyPortals = allPortals.filter(([_, portal]) => isCountyEntry(portal));

  console.log(`Total entries: ${allPortals.length}`);
  console.log(`County entries to remove: ${countyPortals.length}`);
  console.log(`City entries to keep: ${cityPortals.length}`);

  // Generate the new known-portals.ts content
  const fileContent = `/**
 * Known Council District Data Portals
 *
 * ARCHITECTURE:
 * This registry contains CITY council district portals that have been verified.
 * County/parish commissioner district portals are in county-portals.ts
 *
 * Last updated: ${new Date().toISOString().split('T')[0]}
 * City entries: ${cityPortals.length}
 *
 * NOTE: County entries (${countyPortals.length}) moved to county-portals.ts on 2026-01-17
 */

export type PortalType = 'arcgis' | 'socrata' | 'geojson' | 'shapefile' | 'kml';

export interface KnownPortal {
  /** 7-digit Census PLACE FIPS code */
  readonly cityFips: string;
  /** City name (human-readable) */
  readonly cityName: string;
  /** State abbreviation (e.g., "TX", "WA") */
  readonly state: string;
  /** Portal type */
  readonly portalType: PortalType;
  /** Direct download URL (GeoJSON) */
  readonly downloadUrl: string;
  /** Number of districts/features */
  readonly featureCount: number;
  /** Last successful validation timestamp (ISO 8601) */
  readonly lastVerified: string;
  /** Confidence score (0-100) - higher = more authoritative */
  readonly confidence: number;
  /** Discovery method */
  readonly discoveredBy: 'manual' | 'automated' | 'authoritative';
  /** Additional notes */
  readonly notes?: string;
}

/**
 * Registry of known city council district data portals (indexed by FIPS)
 *
 * CITY ENTRIES ONLY - County entries are in county-portals.ts
 */
export const KNOWN_PORTALS: Record<string, KnownPortal> = {
${cityPortals.map(([fips, portal]) => {
  const json = JSON.stringify(portal, null, 2)
    .split('\n')
    .map((line, i) => (i === 0 ? line : '  ' + line))
    .join('\n');
  return `  '${fips}': ${json},`;
}).join('\n\n')}
};

export const PORTAL_COUNT = ${cityPortals.length};
`;

  // Write the updated file
  const knownPortalsPath = path.join(
    process.cwd(),
    'src/core/registry/known-portals.ts'
  );

  await fs.writeFile(knownPortalsPath, fileContent, 'utf-8');
  console.log(`\nWrote ${cityPortals.length} city entries to known-portals.ts`);
  console.log('County entries preserved in county-portals.ts');
}

main().catch(console.error);
