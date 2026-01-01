/**
 * Census TIGER Multi-Layer Boundary Provider
 *
 * Authoritative federal boundaries for Congressional Districts, State Legislative Districts, and Counties.
 *
 * Data Sources:
 * - Congressional Districts (CD): 435 total, TIGER/Line CD files
 * - State Legislative Upper (SLDU): ~2,000 districts, TIGER/Line SLDU files
 * - State Legislative Lower (SLDL): ~5,400 districts, TIGER/Line SLDL files
 * - Counties (COUNTY): 3,143 total, TIGER/Line COUNTY files
 *
 * Access Methods:
 * 1. FTP Bulk Download: https://www2.census.gov/geo/tiger/TIGER2024/{CD,SLDU,SLDL,COUNTY}/
 * 2. TIGERweb REST API: https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/
 *
 * Authority: Federal government official boundaries (Census Bureau)
 * Cost: $0 (public domain)
 * Update Frequency: Annual (as of January 1, released September)
 *
 * Use Cases:
 * - Congressional district verification for federal representative contact
 * - State legislative district boundaries for state representative contact
 * - County boundaries for county-level governance
 * - Multi-tier geographic hierarchy for address resolution
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import type {
  BoundaryProvider,
  RawBoundaryFile,
  NormalizedBoundary,
  AdministrativeLevel,
} from '../types/provider.js';
import type { FeatureCollection } from 'geojson';
import type { TIGERLayerType } from '../core/types.js';
import { STATE_ABBR_TO_FIPS } from '../core/types.js';
import { getExpectedCount, NATIONAL_TOTALS } from '../validators/tiger-expected-counts.js';
import type { DownloadDLQ } from '../acquisition/download-dlq.js';

/**
 * TIGER layer types supported by FTP bulk download
 *
 * Complete US civic boundary coverage from Census TIGER/Line:
 * - Federal/State Legislative: cd, sldu, sldl
 * - County: county, cousub
 * - Municipal: place (includes CDP via LSAD filter)
 * - School Districts: unsd, elsd, scsd
 * - Electoral: vtd (voting precincts)
 * - Reference: zcta (ZIP codes)
 */
export type TIGERLayer =
  // Legislative districts
  | 'cd'      // Congressional Districts (435)
  | 'sldu'    // State Legislative Upper (~2,000)
  | 'sldl'    // State Legislative Lower (~5,400)

  // County-level
  | 'county'  // Counties (3,143)
  | 'cousub'  // County Subdivisions - townships, boroughs (~34,000)
  | 'submcd'  // Subminor Civil Divisions (~200)

  // Municipal
  | 'place'   // Incorporated Places + CDPs (19,495 + ~9,500)

  // School districts
  | 'unsd'    // Unified School Districts (~9,135)
  | 'elsd'    // Elementary School Districts (~3,064)
  | 'scsd'    // Secondary School Districts (~273)

  // Electoral infrastructure
  | 'vtd'     // Voting Districts - precincts (~200,000)

  // Tribal and Indigenous
  | 'aiannh'  // American Indian/Alaska Native/Native Hawaiian Areas (~700)
  | 'anrc'    // Alaska Native Regional Corporations (12)
  | 'tbg'     // Tribal Block Groups
  | 'ttract'  // Tribal Census Tracts

  // Metropolitan and urban
  | 'cbsa'    // Core Based Statistical Areas - metros (~940)
  | 'csa'     // Combined Statistical Areas (~170)
  | 'metdiv'  // Metropolitan Divisions (~30)
  | 'uac'     // Urban Areas (~3,600)
  | 'necta'   // New England City and Town Areas (~40)
  | 'cnecta'  // Combined NECTA (~10)
  | 'nectadiv' // NECTA Divisions (~7)

  // Reference layers
  | 'zcta'    // ZIP Code Tabulation Areas (~33,000)
  | 'tract'   // Census Tracts (~85,000)
  | 'bg'      // Block Groups (~242,000)
  | 'puma'    // Public Use Microdata Areas (~2,400)

  // Special cases
  | 'estate'  // Estates (US Virgin Islands only) (3)
  | 'concity' // Consolidated Cities (~40)

  // Federal installations (P0-2: Military Bases)
  | 'mil';    // Military Installations (~850)

/**
 * Download options for TIGER boundary files
 */
export interface TIGERDownloadOptions {
  /** Layer type to download */
  layer: TIGERLayer;

  /** Optional: State FIPS code for state-level download (e.g., "06" for California) */
  stateFips?: string;

  /** Optional: Specific year (defaults to provider year) */
  year?: number;

  /** Force re-download even if cached */
  forceRefresh?: boolean;
}

/**
 * Layer metadata for TIGER layers
 *
 * NOTE: expectedCount removed - use getExpectedCountForLayer() instead
 * to query tiger-expected-counts.ts (single source of truth).
 */
export interface TIGERLayerMetadata {
  /** Layer name */
  name: string;

  /** FTP directory name */
  ftpDir: string;

  /** TIGERweb REST API layer ID */
  tigerWebLayerId: number;

  /** File naming pattern (national vs state-level) */
  filePattern: 'national' | 'state';

  /** Field mappings for normalization */
  fields: {
    /** State FIPS field name */
    stateFips: string;
    /** District/entity FIPS field name */
    entityFips: string;
    /** GEOID field name (unique identifier) */
    geoid: string;
    /** Name field (Legal/Statistical Area Description) */
    name: string;
  };

  /** Administrative level mapping */
  adminLevel: AdministrativeLevel;
}

/**
 * TIGER FTP bulk download layer metadata
 *
 * Used for quarterly Census FTP shapefile downloads (nationwide or state-level extractions).
 * These configurations map to FTP directory structures and file naming patterns.
 *
 * For real-time point queries, see TIGERWEB_LAYER_CONFIG in census-tiger-loader.ts
 *
 * NOTE: Expected counts removed from metadata - use getExpectedCountForLayer()
 * to query tiger-expected-counts.ts (single source of truth).
 */
export const TIGER_FTP_LAYERS: Record<TIGERLayer, TIGERLayerMetadata> = {
  cd: {
    name: 'Congressional Districts',
    ftpDir: 'CD',
    tigerWebLayerId: 18,
    filePattern: 'state',
    fields: {
      stateFips: 'STATEFP',
      entityFips: 'CD119FP',  // CD119 for 2024 data
      geoid: 'GEOID',
      name: 'NAMELSAD',
    },
    adminLevel: 'district',
  },
  sldu: {
    name: 'State Legislative Upper',
    ftpDir: 'SLDU',
    tigerWebLayerId: 20,
    filePattern: 'state',
    fields: {
      stateFips: 'STATEFP',
      entityFips: 'SLDUST',
      geoid: 'GEOID',
      name: 'NAMELSAD',
    },
    adminLevel: 'district',
  },
  sldl: {
    name: 'State Legislative Lower',
    ftpDir: 'SLDL',
    tigerWebLayerId: 22,
    filePattern: 'state',
    fields: {
      stateFips: 'STATEFP',
      entityFips: 'SLDLST',
      geoid: 'GEOID',
      name: 'NAMELSAD',
    },
    adminLevel: 'district',
  },
  county: {
    name: 'Counties',
    ftpDir: 'COUNTY',
    tigerWebLayerId: 12,
    filePattern: 'national',
    fields: {
      stateFips: 'STATEFP',
      entityFips: 'COUNTYFP',
      geoid: 'GEOID',
      name: 'NAMELSAD',
    },
    adminLevel: 'county',
  },
  cousub: {
    name: 'County Subdivisions',
    ftpDir: 'COUSUB',
    tigerWebLayerId: 36,  // TIGERweb layer ID for county subdivisions
    filePattern: 'state',
    fields: {
      stateFips: 'STATEFP',
      entityFips: 'COUSUBFP',
      geoid: 'GEOID',
      name: 'NAMELSAD',
    },
    adminLevel: 'city',  // Townships/boroughs are city-equivalent
  },
  place: {
    name: 'Incorporated Places',
    ftpDir: 'PLACE',
    tigerWebLayerId: 46,  // TIGERweb layer ID for places
    filePattern: 'state',
    fields: {
      stateFips: 'STATEFP',
      entityFips: 'PLACEFP',
      geoid: 'GEOID',
      name: 'NAME',
      // LSAD field distinguishes: C1=city, T1=town, V1=village, B1=borough, C3=CDP
    },
    adminLevel: 'city',
  },
  unsd: {
    name: 'Unified School Districts',
    ftpDir: 'UNSD',
    tigerWebLayerId: 90,
    filePattern: 'state',
    fields: {
      stateFips: 'STATEFP',
      entityFips: 'UNSDLEA',
      geoid: 'GEOID',
      name: 'NAME',
    },
    adminLevel: 'district',
  },
  elsd: {
    name: 'Elementary School Districts',
    ftpDir: 'ELSD',
    tigerWebLayerId: 91,
    filePattern: 'state',
    fields: {
      stateFips: 'STATEFP',
      entityFips: 'ELSDLEA',
      geoid: 'GEOID',
      name: 'NAME',
    },
    adminLevel: 'district',
  },
  scsd: {
    name: 'Secondary School Districts',
    ftpDir: 'SCSD',
    tigerWebLayerId: 92,
    filePattern: 'state',
    fields: {
      stateFips: 'STATEFP',
      entityFips: 'SCSDLEA',
      geoid: 'GEOID',
      name: 'NAME',
    },
    adminLevel: 'district',
  },
  vtd: {
    name: 'Voting Districts',
    ftpDir: 'VTD',
    tigerWebLayerId: 52,  // TIGERweb layer ID for voting tabulation districts
    filePattern: 'state',
    fields: {
      stateFips: 'STATEFP20',  // VTD uses 2020 Census vintage fields
      entityFips: 'VTDST20',
      geoid: 'GEOID20',
      name: 'NAME20',
    },
    adminLevel: 'district',  // Finest electoral unit
  },
  zcta: {
    name: 'ZIP Code Tabulation Areas',
    ftpDir: 'ZCTA520',  // ZCTA5 for 5-digit ZIPs (2020 Census)
    tigerWebLayerId: 54,  // TIGERweb layer ID for ZCTAs
    filePattern: 'national',  // Single national file
    fields: {
      stateFips: 'STATEFP20',  // Cross-state ZCTAs use first state
      entityFips: 'ZCTA5CE20',
      geoid: 'GEOID20',
      name: 'ZCTA5CE20',  // ZIP code IS the name
    },
    adminLevel: 'city',  // Reference layer for mail targeting
  },

  // ============================================================================
  // Tribal and Indigenous Governance
  // ============================================================================

  aiannh: {
    name: 'American Indian/Alaska Native/Native Hawaiian Areas',
    ftpDir: 'AIANNH',
    tigerWebLayerId: 72,  // TIGERweb layer ID for tribal areas
    filePattern: 'national',  // Single national file (tribal lands span states)
    fields: {
      stateFips: 'STATEFP',
      entityFips: 'AIANNHCE',
      geoid: 'GEOID',
      name: 'NAMELSAD',
    },
    adminLevel: 'district',  // Sovereign governance
  },

  anrc: {
    name: 'Alaska Native Regional Corporations',
    ftpDir: 'ANRC',
    tigerWebLayerId: 74,  // TIGERweb layer ID for ANRCs
    filePattern: 'national',  // Alaska only (12 total)
    fields: {
      stateFips: 'STATEFP',
      entityFips: 'ANRCFP',
      geoid: 'GEOID',
      name: 'NAMELSAD',
    },
    adminLevel: 'district',  // Corporate governance
  },

  tbg: {
    name: 'Tribal Block Groups',
    ftpDir: 'TBG',
    tigerWebLayerId: 76,  // TIGERweb layer ID for tribal block groups
    filePattern: 'state',  // State-level files
    fields: {
      stateFips: 'STATEFP',
      entityFips: 'TBGCE',
      geoid: 'GEOID',
      name: 'NAMELSAD',
    },
    adminLevel: 'district',  // Fine-grained demographic
  },

  ttract: {
    name: 'Tribal Census Tracts',
    ftpDir: 'TTRACT',
    tigerWebLayerId: 75,  // TIGERweb layer ID for tribal tracts
    filePattern: 'state',  // State-level files
    fields: {
      stateFips: 'STATEFP',
      entityFips: 'TTRACTCE',
      geoid: 'GEOID',
      name: 'NAMELSAD',
    },
    adminLevel: 'district',  // Demographic analysis
  },

  // ============================================================================
  // Metropolitan and Urban Planning
  // ============================================================================

  cbsa: {
    name: 'Core Based Statistical Areas',
    ftpDir: 'CBSA',
    tigerWebLayerId: 84,  // TIGERweb layer ID for metros
    filePattern: 'national',  // Single national file (metros span states)
    fields: {
      stateFips: 'STATEFP',  // Primary state
      entityFips: 'CBSAFP',
      geoid: 'GEOID',
      name: 'NAMELSAD',
    },
    adminLevel: 'county',  // Regional planning
  },

  csa: {
    name: 'Combined Statistical Areas',
    ftpDir: 'CSA',
    tigerWebLayerId: 85,  // TIGERweb layer ID for combined metros
    filePattern: 'national',  // Single national file
    fields: {
      stateFips: 'STATEFP',
      entityFips: 'CSAFP',
      geoid: 'GEOID',
      name: 'NAMELSAD',
    },
    adminLevel: 'county',  // Mega-region planning
  },

  metdiv: {
    name: 'Metropolitan Divisions',
    ftpDir: 'METDIV',
    tigerWebLayerId: 83,  // TIGERweb layer ID for metro divisions
    filePattern: 'national',  // Single national file
    fields: {
      stateFips: 'STATEFP',
      entityFips: 'METDIVFP',
      geoid: 'GEOID',
      name: 'NAMELSAD',
    },
    adminLevel: 'county',  // Sub-metro regions
  },

  uac: {
    name: 'Urban Areas',
    ftpDir: 'UAC',
    tigerWebLayerId: 95,  // TIGERweb layer ID for urban areas
    filePattern: 'national',  // Single national file (urban areas span counties)
    fields: {
      stateFips: 'STATEFP',
      entityFips: 'UACE',
      geoid: 'GEOID',
      name: 'NAMELSAD',
    },
    adminLevel: 'city',  // Urban classification
  },

  necta: {
    name: 'New England City and Town Areas',
    ftpDir: 'NECTA',
    tigerWebLayerId: 86,  // TIGERweb layer ID for NECTAs
    filePattern: 'national',  // New England only (~40 total)
    fields: {
      stateFips: 'STATEFP',
      entityFips: 'NECTAFP',
      geoid: 'GEOID',
      name: 'NAMELSAD',
    },
    adminLevel: 'county',  // New England regional planning
  },

  cnecta: {
    name: 'Combined New England City and Town Areas',
    ftpDir: 'CNECTA',
    tigerWebLayerId: 87,  // TIGERweb layer ID for combined NECTAs
    filePattern: 'national',  // New England only (~10 total)
    fields: {
      stateFips: 'STATEFP',
      entityFips: 'CNECTAFP',
      geoid: 'GEOID',
      name: 'NAMELSAD',
    },
    adminLevel: 'county',  // New England mega-regions
  },

  nectadiv: {
    name: 'NECTA Divisions',
    ftpDir: 'NECTADIV',
    tigerWebLayerId: 88,  // TIGERweb layer ID for NECTA divisions
    filePattern: 'national',  // New England only (~7 total)
    fields: {
      stateFips: 'STATEFP',
      entityFips: 'NECTADIVFP',
      geoid: 'GEOID',
      name: 'NAMELSAD',
    },
    adminLevel: 'county',  // Sub-NECTA regions
  },

  // ============================================================================
  // Reference and Demographic Layers
  // ============================================================================

  tract: {
    name: 'Census Tracts',
    ftpDir: 'TRACT',
    tigerWebLayerId: 8,  // TIGERweb layer ID for tracts
    filePattern: 'state',  // State-level files (~85,000 total)
    fields: {
      stateFips: 'STATEFP',
      entityFips: 'TRACTCE',
      geoid: 'GEOID',
      name: 'NAMELSAD',
    },
    adminLevel: 'city',  // Fine demographic unit
  },

  bg: {
    name: 'Block Groups',
    ftpDir: 'BG',
    tigerWebLayerId: 10,  // TIGERweb layer ID for block groups
    filePattern: 'state',  // State-level files (~242,000 total)
    fields: {
      stateFips: 'STATEFP',
      entityFips: 'BLKGRPCE',
      geoid: 'GEOID',
      name: 'NAMELSAD',
    },
    adminLevel: 'city',  // Finest demographic unit
  },

  puma: {
    name: 'Public Use Microdata Areas',
    ftpDir: 'PUMA',
    tigerWebLayerId: 48,  // TIGERweb layer ID for PUMAs
    filePattern: 'state',  // State-level files (~2,400 total)
    fields: {
      stateFips: 'STATEFP',
      entityFips: 'PUMACE',
      geoid: 'GEOID',
      name: 'NAMELSAD',
    },
    adminLevel: 'county',  // Statistical analysis regions
  },

  // ============================================================================
  // Special Cases
  // ============================================================================

  submcd: {
    name: 'Subminor Civil Divisions',
    ftpDir: 'SUBMCD',
    tigerWebLayerId: 40,  // TIGERweb layer ID for subminor civil divisions
    filePattern: 'state',  // Very rare - only ~200 nationwide
    fields: {
      stateFips: 'STATEFP',
      entityFips: 'SUBMCDFP',
      geoid: 'GEOID',
      name: 'NAMELSAD',
    },
    adminLevel: 'city',  // Fine-grained governance
  },

  estate: {
    name: 'Estates',
    ftpDir: 'ESTATE',
    tigerWebLayerId: 78,  // TIGERweb layer ID for estates
    filePattern: 'state',  // US Virgin Islands only (3 estates)
    fields: {
      stateFips: 'STATEFP',
      entityFips: 'ESTATEFP',
      geoid: 'GEOID',
      name: 'NAMELSAD',
    },
    adminLevel: 'county',  // County-equivalent in USVI
  },

  concity: {
    name: 'Consolidated Cities',
    ftpDir: 'CONCITY',
    tigerWebLayerId: 32,  // TIGERweb layer ID for consolidated cities
    filePattern: 'state',  // Rare - only ~40 nationwide
    fields: {
      stateFips: 'STATEFP',
      entityFips: 'CONCTYFP',
      geoid: 'GEOID',
      name: 'NAMELSAD',
    },
    adminLevel: 'city',  // City-county consolidations
  },

  // ============================================================================
  // Federal Installations (P0-2: Military Bases)
  // ============================================================================

  mil: {
    name: 'Military Installations',
    ftpDir: 'MIL',
    tigerWebLayerId: 64,  // TIGERweb layer ID for military installations
    filePattern: 'national',  // Single national file (~850 installations)
    fields: {
      stateFips: 'STATEFP',
      entityFips: 'AREAID',
      geoid: 'GEOID',
      name: 'FULLNAME',
    },
    adminLevel: 'district',  // Federal jurisdiction overlay (not civic representation)
  },
};

/**
 * @deprecated Use TIGER_FTP_LAYERS instead. This alias exists for backward compatibility only.
 */
export const TIGER_LAYERS = TIGER_FTP_LAYERS;

/**
 * State FIPS codes (for TIGER URL construction)
 */
/**
 * State abbreviation to FIPS mapping
 * Re-exported from core/types.ts for convenience
 * @deprecated Import STATE_ABBR_TO_FIPS from core/types.js directly
 */
const STATE_FIPS = STATE_ABBR_TO_FIPS;

/**
 * Census TIGER Multi-Layer Boundary Provider
 *
 * Implements BoundaryProvider interface for Congressional Districts,
 * State Legislative Districts, and Counties using authoritative federal data.
 */
export class TIGERBoundaryProvider implements BoundaryProvider {
  // BoundaryProvider interface requirements
  readonly countryCode = 'US';
  readonly name = 'US Census Bureau TIGER/Line Boundaries';
  readonly source = 'https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html';
  readonly updateSchedule = 'annual' as const;
  readonly administrativeLevels: readonly AdministrativeLevel[] = ['district', 'county'] as const;

  private cacheDir: string;
  private year: number;
  private maxRetries: number;
  private retryDelayMs: number;
  private dlq?: DownloadDLQ;
  private jobId?: string;
  private autoExpireCache: boolean;
  private gracePeriodDays: number;

  constructor(options: {
    cacheDir?: string;
    year?: number;
    maxRetries?: number;
    retryDelayMs?: number;
    dlq?: DownloadDLQ;
    jobId?: string;
    autoExpireCache?: boolean;
    gracePeriodDays?: number;
  } = {}) {
    // Default cache: packages/crypto/data/tiger-cache
    this.cacheDir = options.cacheDir ||
      join(process.cwd(), 'packages/crypto/data/tiger-cache');

    // Default year: 2024 (latest TIGER vintage)
    this.year = options.year || 2024;

    // Retry configuration for network resilience
    this.maxRetries = options.maxRetries || 3;
    this.retryDelayMs = options.retryDelayMs || 1000;

    // Optional DLQ for failed download persistence
    this.dlq = options.dlq;
    this.jobId = options.jobId;

    // Cache expiration configuration (default: enabled with 30 day grace period)
    this.autoExpireCache = options.autoExpireCache ?? true;
    this.gracePeriodDays = options.gracePeriodDays ?? 30;
  }

  /**
   * Download TIGER boundaries (BoundaryProvider interface)
   */
  async download(params: {
    level: AdministrativeLevel;
    region?: string;
    version?: string;
    forceRefresh?: boolean;
  }): Promise<RawBoundaryFile[]> {
    // Map administrative level to TIGER layer(s)
    const layers = this.mapAdminLevelToLayers(params.level);

    if (layers.length === 0) {
      throw new Error(`Unsupported administrative level: ${params.level}`);
    }

    const results: RawBoundaryFile[] = [];

    for (const layer of layers) {
      const downloadOpts: TIGERDownloadOptions = {
        layer,
        stateFips: params.region,
        year: params.version ? Number.parseInt(params.version, 10) : this.year,
        forceRefresh: params.forceRefresh,
      };

      const layerFiles = await this.downloadLayer(downloadOpts);
      results.push(...layerFiles);
    }

    return results;
  }

  /**
   * Download boundaries for a specific TIGER layer
   */
  async downloadLayer(options: TIGERDownloadOptions): Promise<RawBoundaryFile[]> {
    const metadata = TIGER_FTP_LAYERS[options.layer];
    const year = options.year || this.year;

    console.log(`🗺️  Downloading ${metadata.name} from Census TIGER ${year}...`);

    // Ensure cache directory exists
    await mkdir(join(this.cacheDir, String(year), metadata.ftpDir), { recursive: true });

    const results: RawBoundaryFile[] = [];

    if (metadata.filePattern === 'national') {
      // National file (e.g., Congressional Districts, Counties)
      const geojson = await this.downloadNationalFile(options.layer, year, options.forceRefresh);
      const geojsonBuffer = Buffer.from(JSON.stringify(geojson), 'utf-8');

      results.push({
        url: this.getNationalFileUrl(options.layer, year),
        format: 'geojson',
        data: geojsonBuffer,
        metadata: {
          source: `US Census Bureau TIGER/Line ${year}`,
          provider: 'TIGERBoundaryProvider',
          authority: 'federal',
          retrieved: new Date().toISOString(),
          checksum: this.computeChecksum(geojsonBuffer),
          layer: options.layer,
          scope: 'national',
        },
      });
    } else {
      // State-level files (e.g., State Legislative Districts)
      const stateFips = options.stateFips;

      if (stateFips) {
        // Single state
        const geojson = await this.downloadStateFile(options.layer, stateFips, year, options.forceRefresh);
        const geojsonBuffer = Buffer.from(JSON.stringify(geojson), 'utf-8');

        results.push({
          url: this.getStateFileUrl(options.layer, stateFips, year),
          format: 'geojson',
          data: geojsonBuffer,
          metadata: {
            source: `US Census Bureau TIGER/Line ${year}`,
            provider: 'TIGERBoundaryProvider',
            authority: 'federal',
            retrieved: new Date().toISOString(),
            checksum: this.computeChecksum(geojsonBuffer),
            layer: options.layer,
            scope: 'state',
            stateFips,
          },
        });
      } else {
        // All states (bulk download)
        console.log(`   📊 Bulk download: Processing all 56 states/territories...`);

        for (const [stateCode, fips] of Object.entries(STATE_FIPS)) {
          try {
            const geojson = await this.downloadStateFile(options.layer, fips, year, options.forceRefresh);
            const geojsonBuffer = Buffer.from(JSON.stringify(geojson), 'utf-8');

            results.push({
              url: this.getStateFileUrl(options.layer, fips, year),
              format: 'geojson',
              data: geojsonBuffer,
              metadata: {
                source: `US Census Bureau TIGER/Line ${year}`,
                provider: 'TIGERBoundaryProvider',
                authority: 'federal',
                retrieved: new Date().toISOString(),
                checksum: this.computeChecksum(geojsonBuffer),
                layer: options.layer,
                scope: 'state',
                stateFips: fips,
                stateCode,
              },
            });

            console.log(`   ✅ ${stateCode}: ${geojson.features.length} features`);
          } catch (error) {
            console.error(`   ⚠️  ${stateCode}: ${(error as Error).message}`);
          }
        }
      }
    }

    console.log(`\n✨ Download complete: ${results.length} file(s) for ${metadata.name}`);
    return results;
  }

  /**
   * Transform raw TIGER data to normalized boundaries
   */
  async transform(raw: RawBoundaryFile[]): Promise<NormalizedBoundary[]> {
    const normalized: NormalizedBoundary[] = [];

    for (const file of raw) {
      try {
        // Parse GeoJSON from Buffer
        const geojson = JSON.parse(file.data.toString('utf-8')) as FeatureCollection;
        const layer = file.metadata.layer as TIGERLayer;
        const metadata = TIGER_FTP_LAYERS[layer];

        for (const feature of geojson.features) {
          const props = feature.properties || {};

          // Extract fields using layer-specific field mappings
          const geoid = props[metadata.fields.geoid] as string;
          const name = props[metadata.fields.name] as string;
          const stateFips = props[metadata.fields.stateFips] as string;
          const entityFips = props[metadata.fields.entityFips] as string;

          if (!geoid || !name) {
            console.warn(`   ⚠️  Skipping feature with missing GEOID or name:`, props);
            continue;
          }

          normalized.push({
            id: geoid,
            name,
            level: metadata.adminLevel,
            geometry: feature.geometry,
            properties: {
              stateFips,
              entityFips,
              geoid,
              layer,
              layerName: metadata.name,
              ...props,
            },
            source: {
              provider: this.name,
              url: file.url,
              version: String(this.year),
              license: 'CC0-1.0',
              updatedAt: new Date().toISOString(),
              checksum: file.metadata.checksum as string,
              authorityLevel: 'federal-mandate',
              legalStatus: 'binding',
              collectionMethod: 'census-tiger',
              lastVerified: new Date().toISOString(),
              verifiedBy: 'automated',
              topologyValidated: true,
              geometryRepaired: false,
              coordinateSystem: 'EPSG:4326',
              nextScheduledUpdate: this.getNextCensusRelease(),
              updateMonitoring: 'api-polling',
            },
          });
        }
      } catch (error) {
        console.error(`   ❌ Transform error: ${(error as Error).message}`);
      }
    }

    console.log(`\n🔄 Transformed ${normalized.length} boundaries`);
    return normalized;
  }

  /**
   * Check for updates from Census Bureau
   */
  async checkForUpdates(): Promise<{
    available: boolean;
    latestVersion: string;
    currentVersion: string;
    releaseDate: string;
    releaseNotesUrl?: string;
  }> {
    const nextYear = this.year + 1;
    const testURL = `https://www2.census.gov/geo/tiger/TIGER${nextYear}/CD/`;

    try {
      const response = await fetch(testURL, { method: 'HEAD' });
      if (response.ok) {
        return {
          available: true,
          latestVersion: String(nextYear),
          currentVersion: String(this.year),
          releaseDate: `${nextYear}-09-01`,
          releaseNotesUrl: `https://www.census.gov/programs-surveys/geography/technical-documentation/complete-technical-documentation/tiger-geo-line.${nextYear}.html`,
        };
      }
    } catch {
      // Next year not available yet
    }

    return {
      available: false,
      latestVersion: String(this.year),
      currentVersion: String(this.year),
      releaseDate: `${this.year}-09-01`,
    };
  }

  /**
   * Get source metadata
   */
  async getMetadata() {
    return {
      provider: this.name,
      url: this.source,
      version: String(this.year),
      license: 'CC0-1.0',
      updatedAt: new Date().toISOString(),
      checksum: '',
      authorityLevel: 'federal-mandate' as const,
      legalStatus: 'binding' as const,
      collectionMethod: 'census-tiger' as const,
      lastVerified: new Date().toISOString(),
      verifiedBy: 'automated' as const,
      topologyValidated: true,
      geometryRepaired: false,
      coordinateSystem: 'EPSG:4326' as const,
      nextScheduledUpdate: this.getNextCensusRelease(),
      updateMonitoring: 'api-polling' as const,
    };
  }

  /**
   * Download national TIGER file (e.g., Congressional Districts, Counties)
   */
  private async downloadNationalFile(
    layer: TIGERLayer,
    year: number,
    forceRefresh = false
  ): Promise<FeatureCollection> {
    const metadata = TIGER_FTP_LAYERS[layer];
    const cacheFile = join(this.cacheDir, String(year), metadata.ftpDir, 'national.geojson');

    // Check cache
    if (!forceRefresh) {
      try {
        await access(cacheFile);

        // Check if cache is stale based on TIGER release schedule
        if (this.isCacheStale(cacheFile)) {
          console.log(`   ⏰ Cache stale (past TIGER ${year + 1} release + grace period), downloading fresh data...`);
          // Fall through to download
        } else {
          const content = await readFile(cacheFile, 'utf-8');
          console.log(`   💾 Loaded from cache: ${cacheFile}`);
          return JSON.parse(content) as FeatureCollection;
        }
      } catch {
        // Cache miss, download
      }
    }

    const url = this.getNationalFileUrl(layer, year);
    const zipPath = join(this.cacheDir, String(year), metadata.ftpDir, `tl_${year}_us_${layer}.zip`);

    console.log(`   📥 Downloading ${url}...`);

    // Download ZIP file with retry
    await this.downloadFileWithRetry(url, zipPath, layer);

    console.log(`   🔄 Converting shapefile to GeoJSON...`);

    // Convert to GeoJSON using ogr2ogr
    const geojson = await this.convertShapefileToGeoJSON(zipPath);

    // Cache GeoJSON (compact format to avoid V8 string length limits on large datasets)
    await writeFile(cacheFile, JSON.stringify(geojson));

    console.log(`   💾 Cached to ${cacheFile}`);
    console.log(`   ✅ ${geojson.features.length} features loaded`);

    return geojson;
  }

  /**
   * Download state TIGER file (e.g., State Legislative Districts)
   */
  private async downloadStateFile(
    layer: TIGERLayer,
    stateFips: string,
    year: number,
    forceRefresh = false
  ): Promise<FeatureCollection> {
    const metadata = TIGER_FTP_LAYERS[layer];
    const cacheFile = join(this.cacheDir, String(year), metadata.ftpDir, `${stateFips}.geojson`);

    // Check cache
    if (!forceRefresh) {
      try {
        await access(cacheFile);

        // Check if cache is stale based on TIGER release schedule
        if (this.isCacheStale(cacheFile)) {
          console.log(`   ⏰ Cache stale (past TIGER ${year + 1} release + grace period), downloading fresh data for state ${stateFips}...`);
          // Fall through to download
        } else {
          const content = await readFile(cacheFile, 'utf-8');
          return JSON.parse(content) as FeatureCollection;
        }
      } catch {
        // Cache miss, download
      }
    }

    const url = this.getStateFileUrl(layer, stateFips, year);
    const zipPath = join(this.cacheDir, String(year), metadata.ftpDir, `tl_${year}_${stateFips}_${layer}.zip`);

    // Download ZIP file with retry
    await this.downloadFileWithRetry(url, zipPath, layer, stateFips);

    // Convert to GeoJSON using ogr2ogr
    const geojson = await this.convertShapefileToGeoJSON(zipPath);

    // Cache GeoJSON (compact format to avoid V8 string length limits on large datasets)
    await writeFile(cacheFile, JSON.stringify(geojson));

    return geojson;
  }

  /**
   * Download file via curl with exponential backoff retry
   *
   * On final failure, persists to DLQ for later retry if DLQ is configured.
   */
  private async downloadFileWithRetry(
    url: string,
    outputPath: string,
    layer?: TIGERLayer,
    stateFips?: string
  ): Promise<void> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        await this.downloadFile(url, outputPath);
        return; // Success
      } catch (error) {
        lastError = error as Error;

        if (attempt < this.maxRetries) {
          const delay = this.retryDelayMs * Math.pow(2, attempt);
          console.log(`   ⚠️  Download failed (attempt ${attempt + 1}/${this.maxRetries + 1}), retrying in ${delay}ms...`);
          await this.sleep(delay);
        }
      }
    }

    // Final failure - persist to DLQ if configured
    if (this.dlq && layer) {
      try {
        await this.dlq.persistFailure({
          jobId: this.jobId,
          url,
          layer,
          stateFips,
          year: this.year,
          error: lastError?.message ?? 'Unknown error',
          maxAttempts: this.maxRetries,
          retryDelayMs: this.retryDelayMs,
          retryBackoffMultiplier: 2,
        });
        console.log(`   📝 Persisted failed download to DLQ for later retry`);
      } catch (dlqError) {
        console.error(`   ⚠️  Failed to persist to DLQ: ${(dlqError as Error).message}`);
      }
    }

    throw new Error(`Download failed after ${this.maxRetries + 1} attempts: ${lastError?.message}`);
  }

  /**
   * Download file via curl
   */
  private async downloadFile(url: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const curl = spawn('curl', ['-L', '-o', outputPath, url]);

      curl.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`curl failed with code ${code}`));
        }
      });

      curl.on('error', reject);
    });
  }

  /**
   * Convert shapefile to GeoJSON using ogr2ogr
   */
  private async convertShapefileToGeoJSON(zipPath: string): Promise<FeatureCollection> {
    return new Promise((resolve, reject) => {
      const ogr2ogr = spawn('ogr2ogr', [
        '-f', 'GeoJSON',
        '/vsistdout/',  // Output to stdout
        `/vsizip/${zipPath}`,  // Read from ZIP
        '-t_srs', 'EPSG:4326',  // Convert to WGS84
      ]);

      let stdout = '';
      let stderr = '';

      ogr2ogr.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      ogr2ogr.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ogr2ogr.on('close', (code) => {
        if (code === 0) {
          try {
            const geojson = JSON.parse(stdout) as FeatureCollection;
            resolve(geojson);
          } catch (error) {
            reject(new Error(`Failed to parse GeoJSON: ${(error as Error).message}`));
          }
        } else {
          reject(new Error(`ogr2ogr failed: ${stderr}`));
        }
      });

      ogr2ogr.on('error', (error) => {
        reject(new Error(`Failed to spawn ogr2ogr: ${error.message}. Ensure GDAL is installed.`));
      });
    });
  }

  /**
   * Map administrative level to TIGER layer(s)
   */
  private mapAdminLevelToLayers(level: AdministrativeLevel): TIGERLayer[] {
    switch (level) {
      case 'district':
        return ['cd', 'sldu', 'sldl'];
      case 'county':
        return ['county'];
      default:
        return [];
    }
  }

  /**
   * Get FTP URL for national file
   */
  private getNationalFileUrl(layer: TIGERLayer, year: number): string {
    const metadata = TIGER_FTP_LAYERS[layer];
    return `https://www2.census.gov/geo/tiger/TIGER${year}/${metadata.ftpDir}/tl_${year}_us_${layer}.zip`;
  }

  /**
   * Get FTP URL for state file
   */
  private getStateFileUrl(layer: TIGERLayer, stateFips: string, year: number): string {
    const metadata = TIGER_FTP_LAYERS[layer];
    // Congressional Districts use cd119 suffix (119th Congress)
    const layerSuffix = layer === 'cd' ? 'cd119' : layer;
    return `https://www2.census.gov/geo/tiger/TIGER${year}/${metadata.ftpDir}/tl_${year}_${stateFips}_${layerSuffix}.zip`;
  }

  /**
   * Compute SHA-256 checksum for data integrity
   */
  private computeChecksum(data: Buffer): string {
    const hash = createHash('sha256');
    hash.update(data);
    return hash.digest('hex');
  }

  /**
   * Get next Census release date (September 1st of next year)
   */
  private getNextCensusRelease(): string {
    const nextYear = this.year + 1;
    return `${nextYear}-09-01T00:00:00.000Z`;
  }

  /**
   * Check if cached file is stale based on TIGER release schedule.
   *
   * TIGER data released September 1st annually - cache expires after grace period.
   * Example: 2024 cache expires October 1, 2025 (30 days after Sept 1, 2025 release)
   *
   * @param cachePath - Path to cached file
   * @returns true if cache is stale and should be refreshed
   */
  private isCacheStale(cachePath: string): boolean {
    if (!this.autoExpireCache) {
      return false;
    }

    try {
      const stats = statSync(cachePath);
      const cacheDate = new Date(stats.mtime);

      // TIGER releases on September 1st of year following data year (UTC)
      // e.g., 2024 data released Sept 1, 2025
      const releaseDateMs = Date.UTC(this.year + 1, 8, 1); // Month is 0-indexed (8 = September)
      const releaseDate = new Date(releaseDateMs);

      // Add grace period to allow TIGER data to stabilize across all FTP mirrors
      const expirationMs = releaseDateMs + this.gracePeriodDays * 24 * 60 * 60 * 1000;
      const expirationDate = new Date(expirationMs);

      // Cache is stale if:
      // 1. We're past the expiration date (release + grace period)
      // 2. Cache was created before the release date (old vintage)
      const now = new Date();
      return now > expirationDate && cacheDate < releaseDate;
    } catch {
      // If stat fails, treat as missing cache (not stale)
      return false;
    }
  }

  /**
   * Get cache status for monitoring/alerting.
   *
   * Scans cache directory to identify fresh vs stale files based on TIGER release schedule.
   * Useful for cache health monitoring and automated cleanup decisions.
   *
   * @returns Cache status summary
   */
  async getCacheStatus(): Promise<{
    tigerYear: number;
    autoExpireEnabled: boolean;
    gracePeriodDays: number;
    nextExpiration: Date;
    cacheDir: string;
  }> {
    // Calculate expiration date in UTC to avoid timezone issues
    const releaseDate = Date.UTC(this.year + 1, 8, 1); // September 1st of next year (UTC)
    const expirationMs = releaseDate + this.gracePeriodDays * 24 * 60 * 60 * 1000;
    const nextExpiration = new Date(expirationMs);

    return {
      tigerYear: this.year,
      autoExpireEnabled: this.autoExpireCache,
      gracePeriodDays: this.gracePeriodDays,
      nextExpiration,
      cacheDir: this.cacheDir,
    };
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get expected count for a TIGER layer
 *
 * Queries tiger-expected-counts.ts for authoritative count data.
 * Replaces hardcoded expectedCount fields in TIGER_FTP_LAYERS.
 *
 * @param layer - TIGER layer type (cd, sldu, sldl, county, unsd, elsd, scsd)
 * @param stateFips - Optional state FIPS code for state-level layers
 * @returns Expected count or null if unknown
 *
 * @example
 * ```typescript
 * // National count
 * getExpectedCountForLayer('cd') // 435
 *
 * // State-level count
 * getExpectedCountForLayer('cd', '06') // 52 (California)
 * getExpectedCountForLayer('sldu', '31') // 49 (Nebraska unicameral)
 * ```
 */
export function getExpectedCountForLayer(
  layer: TIGERLayer,
  stateFips?: string
): number | null {
  // Map layer to tiger-expected-counts.ts layer type
  return getExpectedCount(layer, stateFips);
}

/**
 * Get national total for a layer
 *
 * @param layer - TIGER layer type
 * @returns National total or null if not applicable
 */
export function getNationalTotal(layer: TIGERLayer): number | null {
  switch (layer) {
    // Legislative layers
    case 'cd':
      return NATIONAL_TOTALS.cd;
    case 'sldu':
      return NATIONAL_TOTALS.sldu;
    case 'sldl':
      return NATIONAL_TOTALS.sldl;

    // Administrative layers
    case 'county':
      return NATIONAL_TOTALS.county;
    case 'cousub':
      return NATIONAL_TOTALS.cousub;

    // Municipal layers
    case 'place':
      return NATIONAL_TOTALS.place;

    // School districts
    case 'unsd':
      return NATIONAL_TOTALS.unsd;
    case 'elsd':
      return NATIONAL_TOTALS.elsd;
    case 'scsd':
      return NATIONAL_TOTALS.scsd;

    // Electoral infrastructure
    case 'vtd':
      return NATIONAL_TOTALS.vtd;

    // Reference layers
    case 'zcta':
      return NATIONAL_TOTALS.zcta;

    default:
      return null;
  }
}
