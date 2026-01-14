#!/usr/bin/env npx tsx
/**
 * State Portal Broad Search - Phase 2 P3
 *
 * Simple strategy: Search major state GIS portals directly for governance keywords
 * without city names. This captures districts from mid-tier cities that wouldn't
 * be in top-1000 list but are indexed in state portals.
 *
 * Key insight: State portals ARE ArcGIS Hub - no need for platform-specific crawlers.
 * We just need to search them broadly without city filters.
 *
 * Usage:
 *   npx tsx agents/crawl-state-portals-v2.ts --test
 *   npx tsx agents/crawl-state-portals-v2.ts --all
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../core/utils/logger.js';

interface LayerDiscovery {
  readonly service_url: string;
  readonly layer_url: string;
  readonly layer_name: string;
  readonly source_state: string;
  readonly source_portal: string;
  readonly discovery_keywords: string;
}

/**
 * Known state GIS portals (ArcGIS Hub instances)
 */
const STATE_ARCGIS_HUB_PORTALS: Record<string, string> = {
  // These are all ArcGIS Hub instances - we can use hub.arcgis.com API
  FL: 'https://geodata.myflorida.com',
  OH: 'https://gis.ohio.gov',
  GA: 'https://data.georgiaspatial.org',
  MI: 'https://gis-michigan.opendata.arcgis.com',
  NJ: 'https://njogis-newjersey.opendata.arcgis.com',
  VA: 'https://vgin-vapublicsafety.opendata.arcgis.com',
  WA: 'https://geo.wa.gov',
  AZ: 'https://azgeo-open-data-agic.hub.arcgis.com',
  TN: 'https://tn-tnmap.opendata.arcgis.com',
  IN: 'https://hub.mph.in.gov',
  MD: 'https://data.imap.maryland.gov',
  CO: 'https://data-cdphe.opendata.arcgis.com',
};

/**
 * Simple governance keyword search
 */
async function searchStatePortal(
  stateCode: string,
  portalUrl: string
): Promise<LayerDiscovery[]> {
  logger.info(`\nSearching ${stateCode} state portal: ${portalUrl}`);

  const discoveries: LayerDiscovery[] = [];
  const keywords = [
    'city council district',
    'council district',
    'municipal district',
    'ward boundaries',
    'city ward',
    'commissioner district',
  ];

  for (const keyword of keywords) {
    try {
      // Use ArcGIS Hub public API (no auth required)
      const searchUrl = `https://hub.arcgis.com/api/v3/datasets?q=${encodeURIComponent(keyword)}&filter[portal]=${encodeURIComponent(portalUrl)}`;

      logger.info(`  Searching: "${keyword}"...`);

      const response = await fetch(searchUrl, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        logger.warn(`    ⚠️  HTTP ${response.status}`);
        continue;
      }

      const data = await response.json() as {
        data?: Array<{
          id: string;
          attributes: {
            name: string;
            url?: string;
            serviceUrl?: string;
          };
        }>;
      };

      if (!data.data || data.data.length === 0) {
        logger.info(`    No results`);
        continue;
      }

      logger.info(`    Found ${data.data.length} datasets`);

      for (const dataset of data.data) {
        const serviceUrl = dataset.attributes.serviceUrl || dataset.attributes.url;

        if (!serviceUrl) {
          continue;
        }

        // Check if it's a Feature/MapServer
        if (serviceUrl.includes('FeatureServer') || serviceUrl.includes('MapServer')) {
          discoveries.push({
            service_url: serviceUrl,
            layer_url: serviceUrl, // Will enumerate layers separately
            layer_name: dataset.attributes.name,
            source_state: stateCode,
            source_portal: portalUrl,
            discovery_keywords: keyword,
          });
        }
      }

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      logger.error(`    Error: ${(error as Error).message}`);
    }
  }

  logger.info(`  ✓ Total discoveries: ${discoveries.length}`);
  return discoveries;
}

/**
 * Enumerate layers in a service
 */
async function enumerateServiceLayers(serviceUrl: string): Promise<Array<{
  layer_url: string;
  layer_number: number;
  layer_name: string;
  geometry_type: string | null;
}>> {
  try {
    const response = await fetch(`${serviceUrl}?f=json`, {
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json() as {
      layers?: Array<{
        id: number;
        name: string;
        geometryType?: string;
      }>;
    };

    if (!data.layers) {
      return [];
    }

    return data.layers.map(layer => ({
      layer_url: `${serviceUrl}/${layer.id}`,
      layer_number: layer.id,
      layer_name: layer.name,
      geometry_type: layer.geometryType || null,
    }));

  } catch (error) {
    return [];
  }
}

/**
 * Main crawler
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const testMode = args.includes('--test');

  logger.info('='.repeat(70));
  logger.info('STATE PORTAL BROAD SEARCH - Phase 2 P3');
  logger.info('='.repeat(70));
  logger.info('');

  // Select portals
  const portals = testMode
    ? [['FL', STATE_ARCGIS_HUB_PORTALS.FL]]
    : Object.entries(STATE_ARCGIS_HUB_PORTALS);

  logger.info(`Searching ${portals.length} state portals${testMode ? ' (test mode)' : ''}...`);

  const allDiscoveries: LayerDiscovery[] = [];

  for (const [stateCode, portalUrl] of portals) {
    const discoveries = await searchStatePortal(stateCode, portalUrl);
    allDiscoveries.push(...discoveries);

    // Rate limit between portals
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  logger.info('\n' + '='.repeat(70));
  logger.info('Enumerating layers in discovered services...');
  logger.info('='.repeat(70));

  const enrichedDiscoveries: Array<LayerDiscovery & {
    layer_number: number;
    geometry_type: string | null;
  }> = [];

  for (const discovery of allDiscoveries) {
    logger.info(`\nEnumerating: ${discovery.layer_name}`);

    const layers = await enumerateServiceLayers(discovery.service_url);

    for (const layer of layers) {
      // Only keep polygon layers
      if (layer.geometry_type === 'esriGeometryPolygon') {
        enrichedDiscoveries.push({
          ...discovery,
          layer_url: layer.layer_url,
          layer_number: layer.layer_number,
          layer_name: `${discovery.layer_name} - ${layer.layer_name}`,
          geometry_type: layer.geometry_type,
        });

        logger.info(`  ✓ Layer ${layer.layer_number}: ${layer.layer_name} (polygon)`);
      }
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Save results
  const outputPath = join(__dirname, 'data', 'state_portal_discoveries.jsonl');
  writeFileSync(
    outputPath,
    enrichedDiscoveries.map(d => JSON.stringify(d)).join('\n')
  );

  // Statistics
  const byState: Record<string, number> = {};
  for (const discovery of enrichedDiscoveries) {
    byState[discovery.source_state] = (byState[discovery.source_state] || 0) + 1;
  }

  logger.info('\n' + '='.repeat(70));
  logger.info('DISCOVERY COMPLETE');
  logger.info('='.repeat(70));
  logger.info(`Total services: ${allDiscoveries.length}`);
  logger.info(`Total polygon layers: ${enrichedDiscoveries.length}`);
  logger.info('');
  logger.info('By state:');
  for (const [state, count] of Object.entries(byState).sort((a, b) => b[1] - a[1])) {
    logger.info(`  ${state}: ${count}`);
  }
  logger.info('');
  logger.info(`Output: ${outputPath}`);
  logger.info('='.repeat(70));
}

main().catch(error => {
  logger.error('Fatal error in main', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
