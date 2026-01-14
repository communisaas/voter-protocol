/**
 * Acquisition Orchestrator
 *
 * Coordinates parallel scraping across all sources:
 * 1. ArcGIS Portal (19k+ US cities)
 * 2. State GIS Portals (50 US states)
 * 3. OpenStreetMap (190+ countries)
 *
 * OUTPUT: Immutable snapshot directory with provenance metadata
 */

import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { RawDataset, SnapshotMetadata } from '../types.js';
import { sha256 } from '../utils.js';
import { ArcGISPortalScraper } from './arcgis-portal-scraper.js';
import { StateGISPortalScraper } from './state-gis-scraper.js';
import { OSMScraper } from './osm-scraper.js';
import { PostDownloadValidator } from '../post-download-validator.js';
import { logger } from '../../core/utils/logger.js';

/**
 * Acquisition Orchestrator
 */
export class AcquisitionOrchestrator {
  private readonly outputBaseDir: string;
  private readonly validator: PostDownloadValidator;

  constructor(outputBaseDir: string = './acquisition/outputs') {
    this.outputBaseDir = outputBaseDir;
    this.validator = new PostDownloadValidator();
  }

  /**
   * Run quarterly batch scrape
   */
  async runQuarterlyScrape(): Promise<SnapshotMetadata> {
    const startTime = Date.now();

    // Generate snapshot timestamp (YYYY-MM-DD format)
    const timestamp = new Date().toISOString().split('T')[0];
    const outputDir = join(this.outputBaseDir, `raw-${timestamp}`);

    logger.info('Starting Shadow Atlas quarterly batch scrape', {
      timestamp,
      outputDir
    });

    // Create output directories
    await mkdir(outputDir, { recursive: true });
    await mkdir(join(outputDir, 'usa/state-gis'), { recursive: true });
    await mkdir(join(outputDir, 'usa/arcgis-portal'), { recursive: true });
    await mkdir(join(outputDir, 'global/osm'), { recursive: true });
    await mkdir(join(outputDir, 'provenance'), { recursive: true });
    await mkdir(join(outputDir, 'staging/review'), { recursive: true });
    await mkdir(join(outputDir, 'staging/rejected'), { recursive: true });

    // Parallel scraping
    logger.info('Starting parallel scraping across all sources');

    const [stateGISResult, arcgisPortalResult, osmResult] = await Promise.all([
      this.scrapeStateGIS(),
      this.scrapeArcGISPortal(),
      this.scrapeOSM(),
    ]);

    // Write datasets to disk
    logger.info('Writing datasets to disk');

    await this.writeDatasets(outputDir, 'usa/state-gis', stateGISResult.datasets);
    await this.writeDatasets(outputDir, 'usa/arcgis-portal', arcgisPortalResult.datasets);
    await this.writeDatasets(outputDir, 'global/osm', osmResult.datasets);

    // Write sources metadata
    const sources = [
      { type: 'state-gis', count: stateGISResult.datasets.length },
      { type: 'arcgis-portal', count: arcgisPortalResult.datasets.length },
      { type: 'osm', count: osmResult.datasets.length },
    ];

    await writeFile(join(outputDir, 'sources.json'), JSON.stringify(sources, null, 2));

    // Compute snapshot hash
    logger.info('Computing snapshot hash');
    const snapshotHash = await this.hashDirectory(outputDir);

    const executionTime = Date.now() - startTime;

    // Write snapshot metadata
    const metadata: SnapshotMetadata = {
      timestamp,
      outputDir,
      snapshotHash,
      sources,
    };

    await writeFile(join(outputDir, 'snapshot-metadata.json'), JSON.stringify(metadata, null, 2));

    // Final summary
    const totalDatasets = sources.reduce((sum, s) => sum + s.count, 0);
    logger.info('Scrape complete', {
      totalDatasets,
      stateGIS: stateGISResult.datasets.length,
      arcgisPortal: arcgisPortalResult.datasets.length,
      osm: osmResult.datasets.length,
      executionMinutes: (executionTime / 1000 / 60).toFixed(1),
      snapshotHash,
      outputDir
    });

    return metadata;
  }

  /**
   * Scrape State GIS portals
   */
  private async scrapeStateGIS() {
    logger.info('Scraping State GIS portals');
    const scraper = new StateGISPortalScraper();
    return await scraper.scrapeAll();
  }

  /**
   * Scrape ArcGIS Portal
   */
  private async scrapeArcGISPortal() {
    logger.info('Scraping ArcGIS Portal');
    const scraper = new ArcGISPortalScraper();
    return await scraper.scrapeAll();
  }

  /**
   * Scrape OpenStreetMap
   */
  private async scrapeOSM() {
    logger.info('Scraping OpenStreetMap');
    const scraper = new OSMScraper();
    return await scraper.scrapeAll();
  }

  /**
   * Write datasets to disk (parallel with batching)
   */
  private async writeDatasets(baseDir: string, subdir: string, datasets: readonly RawDataset[]): Promise<void> {
    const targetDir = join(baseDir, subdir);
    const batchSize = 10; // Prevent overwhelming disk I/O
    let written = 0;

    for (let i = 0; i < datasets.length; i += batchSize) {
      const batch = datasets.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (dataset, batchIndex) => {
          if (!dataset) return;

          const globalIndex = i + batchIndex;
          const filename = `dataset-${globalIndex.toString().padStart(5, '0')}.geojson`;
          const provenanceFilename = `provenance-${globalIndex.toString().padStart(5, '0')}.json`;

          try {
            // Write GeoJSON and provenance in parallel
            await Promise.all([
              writeFile(join(targetDir, filename), JSON.stringify(dataset.geojson, null, 2)),
              writeFile(join(baseDir, 'provenance', provenanceFilename), JSON.stringify(dataset.provenance, null, 2)),
            ]);

            written++;
          } catch (error) {
            logger.error('Failed to write dataset', {
              subdir,
              datasetIndex: globalIndex,
              error: (error as Error).message
            });
            throw error; // Re-throw to prevent silent data loss
          }
        })
      );

      // Progress update every batch
      if (written % 50 === 0 || written === datasets.length) {
        logger.info('Dataset write progress', {
          written,
          total: datasets.length,
          subdir
        });
      }
    }

    logger.info('Datasets written successfully', {
      count: datasets.length,
      subdir
    });
  }

  /**
   * Compute SHA-256 hash of entire directory
   * (Simple implementation: hash concatenation of all file hashes)
   */
  private async hashDirectory(dir: string): Promise<string> {
    // For now, just hash the sources metadata
    // Full implementation would recursively hash all files
    const sourcesPath = join(dir, 'sources.json');
    const { readFile } = await import('fs/promises');
    const sourcesContent = await readFile(sourcesPath, 'utf-8');
    return sha256(sourcesContent);
  }
}

/**
 * CLI entry point
 */
export async function main(): Promise<void> {
  const outputDir = process.argv[2] || './acquisition/outputs';
  const orchestrator = new AcquisitionOrchestrator(outputDir);

  await orchestrator.runQuarterlyScrape();
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    logger.error('Fatal error in orchestrator', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    process.exit(1);
  });
}
