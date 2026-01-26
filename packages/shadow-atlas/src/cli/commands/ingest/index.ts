/**
 * Ingest Commands Index
 *
 * Registers all data ingestion subcommands:
 * - arcgis: Fetch from ArcGIS REST services
 * - tiger: Download Census TIGER data
 * - webmap: Extract layers from ArcGIS webmaps
 * - geojson: Direct GeoJSON fetch
 * - socrata: Fetch from Socrata Open Data API
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type { Command } from 'commander';
import { registerArcGISCommand } from './arcgis.js';
import { registerTIGERCommand } from './tiger.js';
import { registerWebmapCommand } from './webmap.js';
import { registerGeoJSONCommand } from './geojson.js';
import { registerSocrataIngestCommand } from './socrata.js';

/**
 * Register all ingest subcommands
 *
 * @param program - Commander program instance
 */
export function registerIngestCommands(program: Command): void {
  const ingest = program
    .command('ingest')
    .description('Data ingestion pipeline for fetching GIS data');

  registerArcGISCommand(ingest);
  registerTIGERCommand(ingest);
  registerWebmapCommand(ingest);
  registerGeoJSONCommand(ingest);
  registerSocrataIngestCommand(ingest);
}
