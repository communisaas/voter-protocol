/**
 * Data Extractors Module
 *
 * Production-grade extractors for canonical GEOID data from authoritative sources.
 * These integrate with the update pipeline via UpdateCoordinator.
 *
 * ARCHITECTURE:
 * - Each extractor handles a specific data source
 * - Outputs are consumed by validators via canonical GEOID reference files
 * - Extractors are invokable via CLI (src/cli/) or programmatically
 *
 * REPLACES: Orphaned scripts/ folder with proper architectural integration
 */

export {
  RDHVTDExtractor,
  type RDHCredentials,
  type RDHDataset,
  type VTDExtractionResult,
  type VTDExtractorOptions,
  loadRDHCredentials,
  createRDHVTDExtractor,
  STATE_FIPS,
  STATE_CODES,
} from './rdh-vtd-extractor.js';
